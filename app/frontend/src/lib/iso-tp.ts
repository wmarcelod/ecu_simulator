// ============================================================
// ISO-TP (ISO 15765-2) — Transport Layer for CAN
// ============================================================
//
// Implements the four PCI frame types and the TX/RX state machines
// needed to send and receive arbitrary-length payloads (up to 4095 bytes
// per ISO 15765-2:2016, classical CAN with 8-byte DLC) on top of raw CAN.
//
// Frame layout (CAN classical, DLC = 8):
//
//   Single Frame (SF)         [0x0L][D1..DL]                   L = 1..7
//   First Frame  (FF)         [0x1H][LL ][D1..D6]              total len = 0xHLL (12-bit)
//   Consecutive Frame (CF)    [0x2N][D1..D7]                   N = 1..F, 0, 1, ...
//   Flow Control (FC)         [0x3F][BS][STmin][padding......] F = 0 CTS, 1 Wait, 2 Ovflw
//
// STmin encoding (byte 2 of FC):
//   0x00..0x7F  =>  N milliseconds (0..127)
//   0xF1..0xF9  =>  100..900 microseconds in 100us steps
//
// This implementation is intentionally synchronous-friendly (it returns
// promises that resolve when the transfer completes) and runs entirely in
// userland — it does not require Web Serial or browser-only APIs, so it
// is fully unit-testable under Vitest in a node environment.
//
// Author: Marcelo Duchene (USP/ICMC, dissertation feat/uds-isotp-bootloader)
// ============================================================

/**
 * A raw CAN frame as exchanged with the surrounding stack.
 * `data.length` is always 1..8 for classical CAN.
 */
export interface IsoTpCanFrame {
  /** 11-bit or 29-bit CAN identifier. */
  id: number;
  /** Payload bytes (DLC). */
  data: Uint8Array;
  /** Optional capture timestamp in ms relative to some base. */
  timestamp?: number;
}

/** ISO-TP PCI types. */
export const enum IsoTpPciType {
  SF = 0x0,
  FF = 0x1,
  CF = 0x2,
  FC = 0x3,
}

/** ISO-TP Flow Control flag. */
export const enum IsoTpFlowStatus {
  ContinueToSend = 0x0,
  Wait = 0x1,
  Overflow = 0x2,
}

/** Reasons for which an ISO-TP transfer can fail. */
export type IsoTpErrorKind =
  | 'timeout-as'
  | 'timeout-bs'
  | 'timeout-cr'
  | 'sequence-error'
  | 'overflow'
  | 'invalid-frame'
  | 'aborted';

export class IsoTpError extends Error {
  public readonly kind: IsoTpErrorKind;
  constructor(kind: IsoTpErrorKind, message?: string) {
    super(`[iso-tp] ${kind}${message ? ': ' + message : ''}`);
    this.kind = kind;
    this.name = 'IsoTpError';
  }
}

/** Configuration for a single ISO-TP endpoint (one txId / rxId pair). */
export interface IsoTpConfig {
  /** CAN ID we transmit on (e.g. 0x7E0 for engine ECU diagnostic request). */
  txId: number;
  /** CAN ID we receive on (e.g. 0x7E8 for engine ECU diagnostic response). */
  rxId: number;
  /** Padding byte to fill 8-byte DLC. ISO 15765-2 default is 0xCC, common alt 0xAA / 0x00. */
  padByte?: number;
  /** Block size we send in our outgoing FC frames. 0 = no flow control between blocks. */
  blockSize?: number;
  /** STmin we send in our outgoing FC frames (raw byte, see spec encoding). */
  stMin?: number;
  /** Local timeout overrides (ms). */
  timeoutAsMs?: number; // sender waiting for own frame to be sent (we use as global tx timeout)
  timeoutBsMs?: number; // sender waiting for FC after FF or after BS reached
  timeoutCrMs?: number; // receiver waiting for next CF
}

/** Internal: complete config with defaults applied. */
interface IsoTpConfigResolved {
  txId: number;
  rxId: number;
  padByte: number;
  blockSize: number;
  stMin: number;
  timeoutAsMs: number;
  timeoutBsMs: number;
  timeoutCrMs: number;
}

/** Listener fired when a complete payload has been received. */
export type IsoTpMessageListener = (payload: Uint8Array, sourceId: number) => void;

/** Listener fired on transport-level error. */
export type IsoTpErrorListener = (err: IsoTpError) => void;

/**
 * Decode STmin byte to milliseconds.
 *
 * Returns a fractional value for sub-millisecond gaps (100us..900us).
 * Reserved values are coerced to 0.
 */
export function decodeStMin(stmin: number): number {
  if (stmin <= 0x7f) return stmin;
  if (stmin >= 0xf1 && stmin <= 0xf9) return (stmin - 0xf0) * 0.1;
  return 0;
}

/**
 * Encode milliseconds to STmin byte.
 * Whole ms (0..127) preserved; 0.1..0.9 collapses to 0xF1..0xF9.
 */
export function encodeStMin(ms: number): number {
  if (ms >= 1 && ms <= 127) return Math.floor(ms);
  if (ms > 0 && ms < 1) {
    const tenths = Math.max(1, Math.min(9, Math.round(ms * 10)));
    return 0xf0 | tenths;
  }
  return 0;
}

/** Internal TX state. */
interface TxSession {
  payload: Uint8Array;
  /** Index of the NEXT data byte to transmit. */
  cursor: number;
  /** Sequence number for the NEXT consecutive frame (1..F, 0, 1, ...). */
  nextSeq: number;
  /** Frames remaining in the current block before another FC is required. 0 = unlimited. */
  framesUntilFc: number;
  /** STmin in ms (decoded). */
  stMinMs: number;
  /** Resolve / reject pair for the awaiting promise. */
  resolve: () => void;
  reject: (e: IsoTpError) => void;
  /** Active timer for waiting FC (Bs). */
  bsTimer?: ReturnType<typeof setTimeout>;
  /** Whether the session has finished (success or failure). */
  done: boolean;
}

/** Internal RX state. */
interface RxSession {
  /** Total payload length declared by the FF. */
  totalLen: number;
  /** Buffer collecting received bytes. */
  buffer: Uint8Array;
  /** Position of next byte to write. */
  cursor: number;
  /** Expected next sequence number (1..F, 0, ...). */
  nextSeq: number;
  /** Bytes remaining to receive in the current block before we send next FC. */
  framesUntilFc: number;
  /** Source ID we are receiving from. */
  sourceId: number;
  /** Active timer for waiting next CF (Cr). */
  crTimer?: ReturnType<typeof setTimeout>;
}

/**
 * Pure-function helpers exported for unit tests.
 * They do NOT touch state; given a buffer they produce frame payloads.
 */
export const IsoTp = {
  /**
   * Build a Single Frame payload for `data` (length 1..7).
   */
  buildSingleFrame(data: Uint8Array, padByte = 0xcc): Uint8Array {
    if (data.length < 1 || data.length > 7) {
      throw new IsoTpError('invalid-frame', `SF length out of range: ${data.length}`);
    }
    const out = new Uint8Array(8).fill(padByte);
    out[0] = (IsoTpPciType.SF << 4) | (data.length & 0x0f);
    out.set(data, 1);
    return out;
  },

  /**
   * Build a First Frame payload. Total length is the *whole* payload size,
   * not just the bytes carried by this frame.
   */
  buildFirstFrame(totalLen: number, firstSix: Uint8Array, padByte = 0xcc): Uint8Array {
    if (totalLen < 8 || totalLen > 0xfff) {
      throw new IsoTpError('invalid-frame', `FF total length out of range: ${totalLen}`);
    }
    if (firstSix.length !== 6) {
      throw new IsoTpError('invalid-frame', `FF must carry exactly 6 data bytes`);
    }
    const out = new Uint8Array(8).fill(padByte);
    out[0] = (IsoTpPciType.FF << 4) | ((totalLen >> 8) & 0x0f);
    out[1] = totalLen & 0xff;
    out.set(firstSix, 2);
    return out;
  },

  /**
   * Build a Consecutive Frame. seq is the 4-bit sequence number (1..F, 0, ...).
   */
  buildConsecutiveFrame(seq: number, chunk: Uint8Array, padByte = 0xcc): Uint8Array {
    if (chunk.length < 1 || chunk.length > 7) {
      throw new IsoTpError('invalid-frame', `CF chunk size out of range: ${chunk.length}`);
    }
    const out = new Uint8Array(8).fill(padByte);
    out[0] = (IsoTpPciType.CF << 4) | (seq & 0x0f);
    out.set(chunk, 1);
    return out;
  },

  /**
   * Build a Flow Control frame.
   */
  buildFlowControl(
    flag: IsoTpFlowStatus,
    blockSize: number,
    stMin: number,
    padByte = 0xcc,
  ): Uint8Array {
    const out = new Uint8Array(8).fill(padByte);
    out[0] = (IsoTpPciType.FC << 4) | (flag & 0x0f);
    out[1] = blockSize & 0xff;
    out[2] = stMin & 0xff;
    return out;
  },

  /** Read the PCI type from a frame's first byte. */
  pciType(frame: Uint8Array): IsoTpPciType {
    return ((frame[0] ?? 0) >> 4) as IsoTpPciType;
  },

  /** Decode SF payload (data only, without padding). */
  decodeSingleFrame(frame: Uint8Array): Uint8Array {
    const len = frame[0] & 0x0f;
    if (len < 1 || len > 7) {
      throw new IsoTpError('invalid-frame', `SF length out of range: ${len}`);
    }
    return frame.slice(1, 1 + len);
  },

  /** Decode FF: returns { totalLen, firstSix }. */
  decodeFirstFrame(frame: Uint8Array): { totalLen: number; firstSix: Uint8Array } {
    const totalLen = ((frame[0] & 0x0f) << 8) | frame[1];
    if (totalLen < 8 || totalLen > 0xfff) {
      throw new IsoTpError('invalid-frame', `FF total length out of range: ${totalLen}`);
    }
    return { totalLen, firstSix: frame.slice(2, 8) };
  },

  /** Decode CF: returns { seq, chunk }. The caller must know how many bytes to keep. */
  decodeConsecutiveFrame(frame: Uint8Array): { seq: number; chunk: Uint8Array } {
    return { seq: frame[0] & 0x0f, chunk: frame.slice(1, 8) };
  },

  /** Decode FC: returns { flag, blockSize, stMin }. */
  decodeFlowControl(frame: Uint8Array): {
    flag: IsoTpFlowStatus;
    blockSize: number;
    stMin: number;
  } {
    return {
      flag: (frame[0] & 0x0f) as IsoTpFlowStatus,
      blockSize: frame[1],
      stMin: frame[2],
    };
  },
};

/**
 * Wall-clock function abstraction so tests can use fake timers or simulated time.
 */
export interface IsoTpClock {
  now(): number;
  setTimeout(cb: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  /** Sleep N ms (used to honor STmin between CF). */
  sleep(ms: number): Promise<void>;
}

const RealClock: IsoTpClock = {
  now: () => Date.now(),
  setTimeout: (cb, ms) => setTimeout(cb, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  sleep: (ms) => new Promise((res) => setTimeout(res, ms)),
};

/**
 * IsoTpStack — bidirectional ISO-TP endpoint over a virtual CAN link.
 *
 * The application instantiates one stack per logical endpoint pair
 * (e.g. the diagnostic tester side or the simulated ECU side) and
 * connects two stacks through a `sendCanFrame` callback.
 *
 * Receive is event-driven: feed inbound frames via `onCanFrame`; the
 * stack re-assembles full payloads and emits them via the message
 * listeners registered with `addListener`.
 */
export class IsoTpStack {
  private cfg: IsoTpConfigResolved;
  private clock: IsoTpClock;
  private send: (frame: IsoTpCanFrame) => void;
  private msgListeners: IsoTpMessageListener[] = [];
  private errListeners: IsoTpErrorListener[] = [];
  private rx: RxSession | null = null;
  private tx: TxSession | null = null;

  constructor(
    cfg: IsoTpConfig,
    sendCanFrame: (frame: IsoTpCanFrame) => void,
    clock: IsoTpClock = RealClock,
  ) {
    this.cfg = {
      txId: cfg.txId,
      rxId: cfg.rxId,
      padByte: cfg.padByte ?? 0xcc,
      blockSize: cfg.blockSize ?? 0,
      stMin: cfg.stMin ?? 0,
      timeoutAsMs: cfg.timeoutAsMs ?? 1000,
      timeoutBsMs: cfg.timeoutBsMs ?? 1000,
      timeoutCrMs: cfg.timeoutCrMs ?? 1000,
    };
    this.send = sendCanFrame;
    this.clock = clock;
  }

  /** Register a listener fired when a full payload is reassembled. */
  addListener(l: IsoTpMessageListener): () => void {
    this.msgListeners.push(l);
    return () => {
      this.msgListeners = this.msgListeners.filter((x) => x !== l);
    };
  }

  /** Register a listener fired on transport-level errors. */
  addErrorListener(l: IsoTpErrorListener): () => void {
    this.errListeners.push(l);
    return () => {
      this.errListeners = this.errListeners.filter((x) => x !== l);
    };
  }

  /** Return the resolved config for inspection. */
  getConfig(): Readonly<IsoTpConfigResolved> {
    return this.cfg;
  }

  /**
   * Enqueue an outbound payload. Promise resolves when:
   *  - the SF was emitted (single-frame case), or
   *  - all CFs of the multi-frame transfer were emitted and the receiver
   *    sent the final FC = CTS (or the transfer ended otherwise).
   *
   * Concurrent sends on the same stack are not allowed — the second call
   * rejects immediately with `aborted`.
   */
  send_(payload: Uint8Array): Promise<void> {
    return this.sendBuffer(payload);
  }

  sendBuffer(payload: Uint8Array): Promise<void> {
    if (this.tx && !this.tx.done) {
      return Promise.reject(new IsoTpError('aborted', 'tx already in progress'));
    }
    if (payload.length === 0) {
      return Promise.reject(new IsoTpError('invalid-frame', 'empty payload'));
    }
    if (payload.length > 0xfff) {
      return Promise.reject(
        new IsoTpError('invalid-frame', `payload too large: ${payload.length}`),
      );
    }

    return new Promise<void>((resolve, reject) => {
      // Single Frame fast path.
      if (payload.length <= 7) {
        try {
          const frame = IsoTp.buildSingleFrame(payload, this.cfg.padByte);
          this.send({ id: this.cfg.txId, data: frame });
          this.tx = {
            payload,
            cursor: payload.length,
            nextSeq: 1,
            framesUntilFc: 0,
            stMinMs: 0,
            resolve,
            reject,
            done: true,
          };
          resolve();
        } catch (e) {
          reject(e instanceof IsoTpError ? e : new IsoTpError('invalid-frame', String(e)));
        }
        return;
      }

      // Multi-frame path: install TX state FIRST so a synchronously-delivered
      // FC (in unit tests with an in-memory bus) finds an active session.
      this.tx = {
        payload,
        cursor: 6,
        nextSeq: 1,
        framesUntilFc: 0,
        stMinMs: 0,
        resolve,
        reject,
        done: false,
      };
      // Arm Bs timer BEFORE sending so that the FC handler can clear it.
      this.tx.bsTimer = this.clock.setTimeout(() => {
        this.failTx(new IsoTpError('timeout-bs', 'no FC after FF'));
      }, this.cfg.timeoutBsMs) as ReturnType<typeof setTimeout>;

      const firstSix = payload.slice(0, 6);
      const ff = IsoTp.buildFirstFrame(payload.length, firstSix, this.cfg.padByte);
      this.send({ id: this.cfg.txId, data: ff });
    });
  }

  /** Feed an inbound CAN frame into the stack. */
  onCanFrame(frame: IsoTpCanFrame): void {
    if (frame.id !== this.cfg.rxId) return;
    if (!frame.data || frame.data.length === 0) return;

    const pci = IsoTp.pciType(frame.data);

    switch (pci) {
      case IsoTpPciType.SF:
        this.handleSF(frame);
        return;
      case IsoTpPciType.FF:
        this.handleFF(frame);
        return;
      case IsoTpPciType.CF:
        this.handleCF(frame);
        return;
      case IsoTpPciType.FC:
        this.handleFC(frame);
        return;
      default:
        this.emitError(new IsoTpError('invalid-frame', `unknown PCI ${pci}`));
    }
  }

  // ------------------------------------------------------------
  // RX path
  // ------------------------------------------------------------

  private handleSF(frame: IsoTpCanFrame): void {
    try {
      const payload = IsoTp.decodeSingleFrame(frame.data);
      this.emitMessage(payload, frame.id);
    } catch (e) {
      this.emitError(e instanceof IsoTpError ? e : new IsoTpError('invalid-frame', String(e)));
    }
  }

  private handleFF(frame: IsoTpCanFrame): void {
    try {
      const { totalLen, firstSix } = IsoTp.decodeFirstFrame(frame.data);
      // Discard any in-progress RX (sender restarted).
      if (this.rx?.crTimer) this.clock.clearTimeout(this.rx.crTimer);
      this.rx = {
        totalLen,
        buffer: new Uint8Array(totalLen),
        cursor: 0,
        nextSeq: 1,
        framesUntilFc: this.cfg.blockSize === 0 ? Number.POSITIVE_INFINITY : this.cfg.blockSize,
        sourceId: frame.id,
      };
      const take = Math.min(6, totalLen);
      this.rx.buffer.set(firstSix.slice(0, take), 0);
      this.rx.cursor = take;

      // Send our FC = CTS allowing the sender to push CFs.
      const fc = IsoTp.buildFlowControl(
        IsoTpFlowStatus.ContinueToSend,
        this.cfg.blockSize,
        this.cfg.stMin,
        this.cfg.padByte,
      );
      this.send({ id: this.cfg.txId, data: fc });

      // Arm Cr.
      this.rx.crTimer = this.clock.setTimeout(() => {
        this.emitError(new IsoTpError('timeout-cr', 'no CF after FC=CTS'));
        this.rx = null;
      }, this.cfg.timeoutCrMs) as ReturnType<typeof setTimeout>;
    } catch (e) {
      this.emitError(e instanceof IsoTpError ? e : new IsoTpError('invalid-frame', String(e)));
    }
  }

  private handleCF(frame: IsoTpCanFrame): void {
    if (!this.rx) {
      this.emitError(new IsoTpError('invalid-frame', 'CF without active RX'));
      return;
    }
    const rx = this.rx;
    if (rx.crTimer) this.clock.clearTimeout(rx.crTimer);

    const { seq, chunk } = IsoTp.decodeConsecutiveFrame(frame.data);
    if (seq !== rx.nextSeq) {
      this.emitError(
        new IsoTpError('sequence-error', `expected seq ${rx.nextSeq}, got ${seq}`),
      );
      this.rx = null;
      return;
    }

    const remaining = rx.totalLen - rx.cursor;
    const take = Math.min(chunk.length, remaining);
    rx.buffer.set(chunk.slice(0, take), rx.cursor);
    rx.cursor += take;
    rx.nextSeq = (rx.nextSeq + 1) & 0x0f;

    if (rx.framesUntilFc !== Number.POSITIVE_INFINITY) {
      rx.framesUntilFc -= 1;
    }

    if (rx.cursor >= rx.totalLen) {
      this.emitMessage(rx.buffer, rx.sourceId);
      this.rx = null;
      return;
    }

    if (rx.framesUntilFc === 0) {
      // Reset block counter BEFORE sending FC: under a synchronous virtual
      // bus, the FC may be delivered to the sender immediately, which can
      // synchronously push the next block of CFs through this same handler.
      rx.framesUntilFc =
        this.cfg.blockSize === 0 ? Number.POSITIVE_INFINITY : this.cfg.blockSize;
      const fc = IsoTp.buildFlowControl(
        IsoTpFlowStatus.ContinueToSend,
        this.cfg.blockSize,
        this.cfg.stMin,
        this.cfg.padByte,
      );
      this.send({ id: this.cfg.txId, data: fc });
    }

    rx.crTimer = this.clock.setTimeout(() => {
      this.emitError(new IsoTpError('timeout-cr', 'no further CF'));
      this.rx = null;
    }, this.cfg.timeoutCrMs) as ReturnType<typeof setTimeout>;
  }

  private handleFC(frame: IsoTpCanFrame): void {
    if (!this.tx || this.tx.done) {
      this.emitError(new IsoTpError('invalid-frame', 'FC without active TX'));
      return;
    }
    const tx = this.tx;
    if (tx.bsTimer) {
      this.clock.clearTimeout(tx.bsTimer);
      tx.bsTimer = undefined;
    }

    const { flag, blockSize, stMin } = IsoTp.decodeFlowControl(frame.data);
    if (flag === IsoTpFlowStatus.Overflow) {
      this.failTx(new IsoTpError('overflow', 'receiver reported buffer overflow'));
      return;
    }
    if (flag === IsoTpFlowStatus.Wait) {
      // Re-arm Bs and wait for another FC.
      tx.bsTimer = this.clock.setTimeout(() => {
        this.failTx(new IsoTpError('timeout-bs', 'wait timeout'));
      }, this.cfg.timeoutBsMs) as ReturnType<typeof setTimeout>;
      return;
    }
    // CTS — proceed to send the next block of CFs.
    tx.framesUntilFc = blockSize === 0 ? Number.POSITIVE_INFINITY : blockSize;
    tx.stMinMs = decodeStMin(stMin);
    void this.pumpTxBlock();
  }

  /** Send CFs until the block size is exhausted or the payload is fully sent. */
  private async pumpTxBlock(): Promise<void> {
    if (!this.tx || this.tx.done) return;
    const tx = this.tx;

    while (
      !tx.done &&
      tx.cursor < tx.payload.length &&
      tx.framesUntilFc !== 0
    ) {
      const remaining = tx.payload.length - tx.cursor;
      const take = Math.min(7, remaining);
      const chunk = tx.payload.slice(tx.cursor, tx.cursor + take);
      const cfSeq = tx.nextSeq;
      // Advance cursor / sequence / block counter BEFORE calling this.send,
      // because under a synchronous virtual bus the receiver may immediately
      // send back an FC that re-enters pumpTxBlock — we must not double-account.
      tx.cursor += take;
      tx.nextSeq = (tx.nextSeq + 1) & 0x0f;
      if (tx.framesUntilFc !== Number.POSITIVE_INFINITY) {
        tx.framesUntilFc -= 1;
      }
      const isLast = tx.cursor >= tx.payload.length;
      const cf = IsoTp.buildConsecutiveFrame(cfSeq, chunk, this.cfg.padByte);
      this.send({ id: this.cfg.txId, data: cf });
      if (tx.done) return; // re-entrant inner pump may have completed the transfer
      if (isLast) {
        tx.done = true;
        tx.resolve();
        this.tx = null;
        return;
      }

      if (tx.stMinMs > 0) {
        await this.clock.sleep(tx.stMinMs);
        if (tx.done) return;
      }
    }

    // Block size exhausted but payload incomplete — wait for next FC.
    if (!tx.done && tx.cursor < tx.payload.length) {
      tx.bsTimer = this.clock.setTimeout(() => {
        this.failTx(new IsoTpError('timeout-bs', 'no FC for next block'));
      }, this.cfg.timeoutBsMs) as ReturnType<typeof setTimeout>;
    }
  }

  // ------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------

  private failTx(err: IsoTpError): void {
    if (!this.tx) return;
    if (this.tx.bsTimer) this.clock.clearTimeout(this.tx.bsTimer);
    if (!this.tx.done) {
      this.tx.done = true;
      this.tx.reject(err);
    }
    this.tx = null;
    this.emitError(err);
  }

  private emitMessage(payload: Uint8Array, sourceId: number): void {
    for (const l of [...this.msgListeners]) {
      try {
        l(payload, sourceId);
      } catch (e) {
        // Listener errors are non-fatal for the stack.
        // eslint-disable-next-line no-console
        console.error('[iso-tp] listener threw:', e);
      }
    }
  }

  private emitError(err: IsoTpError): void {
    for (const l of [...this.errListeners]) {
      try {
        l(err);
      } catch {
        /* ignore */
      }
    }
  }

  /** Cancel any in-flight transfer. Used on shutdown. */
  reset(): void {
    if (this.rx?.crTimer) this.clock.clearTimeout(this.rx.crTimer);
    this.rx = null;
    if (this.tx) {
      if (this.tx.bsTimer) this.clock.clearTimeout(this.tx.bsTimer);
      if (!this.tx.done) {
        this.tx.done = true;
        this.tx.reject(new IsoTpError('aborted', 'stack reset'));
      }
      this.tx = null;
    }
  }
}
