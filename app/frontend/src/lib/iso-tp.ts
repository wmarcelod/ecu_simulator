// ============================================================
// ISO-TP (ISO 15765-2:2016) — CAN transport layer
// ============================================================
//
// Implementation of the four PCI types and TX/RX state machines for
// reliable transfer of payloads up to 4095 bytes (classical CAN, 8-byte DLC).
//
// Design highlights (and differentiators vs a "naive" implementation):
//
//   1. Pure userland — no Web Serial, no Node.js IO, fully unit-testable
//      under Vitest in a JSDOM/Node environment.
//   2. Injectable clock — `now()` and `schedule()` are abstractions, so
//      timeouts (N_As, N_Bs, N_Cs, N_Cr) can be advanced deterministically
//      in tests without sleeping the test thread.
//   3. Decoupled TX and RX state machines — both sides can run in parallel
//      on the same logical channel (full-duplex over the CAN pair).
//   4. Explicit padding policy — frames are padded to exactly 8 bytes (the
//      most common automotive convention; legacy ECUs reject < 8 DLC).
//   5. Length-bounded — rejects FF announcing total > 4095 with `Overflow`
//      flow control, mirroring AUTOSAR CanTp behaviour.
//
// References (see sources/research_uds_*.md for citations):
//   - ISO 15765-2:2016 §6.4–6.5 — PCI types and state machines
//   - Linux kernel docs/networking/iso15765-2.rst — STmin encoding, BS=0
//   - Hartkopp 2015 (CAN-CIA) — throughput tuning for CAN-FD bootloaders
//   - openxc/isotp-c, astand/uds-to-go — reference C implementations
//   - kernel.org can-isotp — production-grade reference
//
// Author: Marcelo Duchene (USP/ICMC) — feat/uds-isotp-bootloader-research
// ============================================================

/* eslint-disable @typescript-eslint/no-explicit-any */

// ------------------------------------------------------------
// Public types
// ------------------------------------------------------------

/** A raw CAN classical frame as exchanged with the surrounding stack. */
export interface CanFrame {
  /** 11-bit or 29-bit CAN identifier. */
  id: number;
  /** Payload bytes (1..8 for classical CAN). */
  data: Uint8Array;
  /** Capture timestamp (ms, milliseconds since epoch or test base). */
  timestamp?: number;
}

/** ISO-TP PCI nibble values (high nibble of byte 0). */
export const ISOTP_PCI_SF = 0x0;
export const ISOTP_PCI_FF = 0x1;
export const ISOTP_PCI_CF = 0x2;
export const ISOTP_PCI_FC = 0x3;

/** Flow control flag values (low nibble of byte 0 in FC frame). */
export const ISOTP_FC_CTS = 0x0;
export const ISOTP_FC_WAIT = 0x1;
export const ISOTP_FC_OVERFLOW = 0x2;

/** Standard 1000 ms timeouts per ISO 15765-2. */
export interface IsoTpTimeouts {
  /** Sender: maximum time for a CAN frame to leave the bus (N_As). */
  N_As: number;
  /** Sender: maximum time waiting for a Flow Control after FF / each block (N_Bs). */
  N_Bs: number;
  /** Sender: minimum delay between consecutive frames (programmed by FC.STmin). */
  N_Cs: number;
  /** Receiver: maximum delay before sending FC after FF / after Nth block (N_Br). */
  N_Br: number;
  /** Receiver: maximum time waiting for next CF (N_Cr). */
  N_Cr: number;
}

/** Default timeouts (1000 ms each, per spec). */
export const DEFAULT_TIMEOUTS: IsoTpTimeouts = {
  N_As: 1000,
  N_Bs: 1000,
  N_Cs: 1000,
  N_Br: 50,
  N_Cr: 1000,
};

/** Stack configuration. */
export interface IsoTpConfig {
  /** CAN ID this stack TRANSMITS on (i.e., responses leave on this ID). */
  txId: number;
  /** CAN ID this stack RECEIVES on (i.e., requests arrive on this ID). */
  rxId: number;
  /** Block size for FC frames we generate (0 = unlimited). Default 0. */
  blockSize: number;
  /** STmin we advertise in our FC (encoded byte). Default 0. */
  stMin: number;
  /** Padding byte (most ECUs use 0xCC or 0xAA). Default 0xAA. */
  padding: number;
  /** Maximum payload we accept (default 4095, ISO classical CAN). */
  maxPayload: number;
  /** Timeouts. */
  timeouts: IsoTpTimeouts;
}

/** Default configuration. */
export function defaultIsoTpConfig(partial: Partial<IsoTpConfig> & Pick<IsoTpConfig, 'txId' | 'rxId'>): IsoTpConfig {
  return {
    blockSize: 0,
    stMin: 0,
    padding: 0xAA,
    maxPayload: 4095,
    timeouts: DEFAULT_TIMEOUTS,
    ...partial,
  };
}

/** Reasons an ISO-TP transfer can fail. */
export type IsoTpErrorKind =
  | 'timeout-N_As'
  | 'timeout-N_Bs'
  | 'timeout-N_Cs'
  | 'timeout-N_Cr'
  | 'fc-overflow'
  | 'fc-invalid'
  | 'wrong-sn'
  | 'len-out-of-range'
  | 'unexpected-frame'
  | 'reset';

export class IsoTpError extends Error {
  constructor(public readonly kind: IsoTpErrorKind, message?: string) {
    super(message || kind);
    this.name = 'IsoTpError';
  }
}

/** Listener types. */
export type MessageListener = (data: Uint8Array) => void;
export type ErrorListener = (error: IsoTpError) => void;
export type FrameSink = (frame: CanFrame) => void;

// ------------------------------------------------------------
// STmin encoding helpers (ISO 15765-2:2016 §6.5.4.5, Linux can-isotp)
// ------------------------------------------------------------

/**
 * Decode STmin byte to milliseconds (floating point ok).
 *
 * - 0x00..0x7F: 0..127 ms
 * - 0xF1..0xF9: 100..900 µs (= 0.1..0.9 ms)
 * - else: reserved -> spec says 'use 127 ms' (fallback safe)
 */
export function decodeStMin(b: number): number {
  if (b <= 0x7F) return b;
  if (b >= 0xF1 && b <= 0xF9) return (b - 0xF0) * 0.1;
  return 127;
}

/** Encode milliseconds (or sub-ms via 0.1..0.9) to STmin byte. */
export function encodeStMin(ms: number): number {
  if (ms < 0) return 0x00;
  if (ms >= 0.1 && ms < 1) return 0xF0 + Math.round(ms * 10);
  if (ms <= 127) return Math.round(ms) & 0x7F;
  return 0x7F;
}

// ------------------------------------------------------------
// Time abstraction (for testability)
// ------------------------------------------------------------

/**
 * The clock used by the stack. Default uses Date.now / setTimeout, but tests
 * may inject a virtual clock that advances on demand.
 *
 * This is the **key differentiator**: it lets us drive the state machine
 * deterministically through every timeout transition without a real wall
 * clock, which is what enables exhaustive Vitest fuzzing.
 */
export interface Clock {
  now(): number;
  /** Schedule a callback after `delayMs`. Returns a token to cancel. */
  schedule(delayMs: number, fn: () => void): TimeoutToken;
  /** Cancel a previously scheduled callback. */
  cancel(token: TimeoutToken): void;
}

export type TimeoutToken = unknown;

export class WallClock implements Clock {
  now(): number {
    return Date.now();
  }
  schedule(delayMs: number, fn: () => void): TimeoutToken {
    return setTimeout(fn, delayMs);
  }
  cancel(token: TimeoutToken): void {
    clearTimeout(token as any);
  }
}

/**
 * A virtual clock for tests. `tick(ms)` advances time and fires any callbacks
 * that should have run by then. Callbacks fired in chronological order.
 */
export class VirtualClock implements Clock {
  private _now = 0;
  private nextId = 1;
  private q: Array<{ id: number; at: number; fn: () => void; cancelled: boolean }> = [];

  now(): number {
    return this._now;
  }
  schedule(delayMs: number, fn: () => void): TimeoutToken {
    const id = this.nextId++;
    this.q.push({ id, at: this._now + delayMs, fn, cancelled: false });
    this.q.sort((a, b) => a.at - b.at);
    return id;
  }
  cancel(token: TimeoutToken): void {
    const e = this.q.find((x) => x.id === token);
    if (e) e.cancelled = true;
  }
  /** Advance the clock by `dt` ms, firing any callbacks that come due. */
  tick(dt: number): void {
    const target = this._now + dt;
    while (this.q.length > 0 && this.q[0].at <= target) {
      const e = this.q.shift()!;
      this._now = e.at;
      if (!e.cancelled) {
        try {
          e.fn();
        } catch (err) {
          // surface but don't crash other timers
          // eslint-disable-next-line no-console
          console.error('[VirtualClock cb]', err);
        }
      }
    }
    this._now = target;
  }
  /** Run until queue empty or until `safetyLimitMs` advanced (avoid infinite loop). */
  drain(safetyLimitMs = 60_000): void {
    const start = this._now;
    while (this.q.length > 0 && this._now - start < safetyLimitMs) {
      const next = this.q[0];
      if (next.cancelled) {
        this.q.shift();
        continue;
      }
      this.tick(next.at - this._now);
    }
  }
}

// ------------------------------------------------------------
// PCI parsing helpers
// ------------------------------------------------------------

export interface ParsedPci {
  type: 0x0 | 0x1 | 0x2 | 0x3;
  /** SF: payload length; CF: sequence number; FC: flow status; FF: 0 (length is in 12 bits) */
  lowNibble: number;
  /** FF only: 12-bit total length encoded in (byte0 low nibble << 8) | byte1 */
  ffLength?: number;
  /** SF/FF data offset (1 for SF, 2 for FF). */
  dataOffset: number;
}

/** Parse the leading PCI of a CAN frame. */
export function parsePci(frame: Uint8Array): ParsedPci {
  if (frame.length === 0) {
    throw new IsoTpError('unexpected-frame', 'empty frame');
  }
  const b0 = frame[0];
  const type = ((b0 >> 4) & 0xF) as 0x0 | 0x1 | 0x2 | 0x3;
  const lowNibble = b0 & 0xF;
  if (type === ISOTP_PCI_FF) {
    if (frame.length < 2) {
      throw new IsoTpError('unexpected-frame', 'FF too short');
    }
    return {
      type,
      lowNibble,
      ffLength: (lowNibble << 8) | frame[1],
      dataOffset: 2,
    };
  }
  return { type, lowNibble, dataOffset: 1 };
}

// ------------------------------------------------------------
// Frame builders
// ------------------------------------------------------------

function pad(buf: Uint8Array, totalLen: number, padByte: number): Uint8Array {
  if (buf.length >= totalLen) return buf;
  const out = new Uint8Array(totalLen);
  out.set(buf);
  for (let i = buf.length; i < totalLen; i++) out[i] = padByte;
  return out;
}

export function buildSingleFrame(payload: Uint8Array, padByte = 0xAA): Uint8Array {
  if (payload.length < 1 || payload.length > 7) {
    throw new IsoTpError('len-out-of-range', `SF length ${payload.length}`);
  }
  const out = new Uint8Array(8);
  out[0] = (ISOTP_PCI_SF << 4) | (payload.length & 0xF);
  out.set(payload, 1);
  for (let i = 1 + payload.length; i < 8; i++) out[i] = padByte;
  return out;
}

export function buildFirstFrame(totalLength: number, first6: Uint8Array, padByte = 0xAA): Uint8Array {
  if (totalLength < 8 || totalLength > 4095) {
    throw new IsoTpError('len-out-of-range', `FF length ${totalLength}`);
  }
  if (first6.length !== 6) {
    throw new IsoTpError('len-out-of-range', `FF expects 6 data bytes, got ${first6.length}`);
  }
  const out = new Uint8Array(8);
  out[0] = (ISOTP_PCI_FF << 4) | ((totalLength >> 8) & 0xF);
  out[1] = totalLength & 0xFF;
  out.set(first6, 2);
  return pad(out, 8, padByte);
}

export function buildConsecutiveFrame(seq: number, data: Uint8Array, padByte = 0xAA): Uint8Array {
  if (data.length < 1 || data.length > 7) {
    throw new IsoTpError('len-out-of-range', `CF data ${data.length}`);
  }
  const out = new Uint8Array(8);
  out[0] = (ISOTP_PCI_CF << 4) | (seq & 0xF);
  out.set(data, 1);
  return pad(out, 8, padByte);
}

export function buildFlowControl(
  status: 0 | 1 | 2,
  blockSize: number,
  stMinByte: number,
  padByte = 0xAA,
): Uint8Array {
  const out = new Uint8Array(8);
  out[0] = (ISOTP_PCI_FC << 4) | (status & 0xF);
  out[1] = blockSize & 0xFF;
  out[2] = stMinByte & 0xFF;
  return pad(out, 8, padByte);
}

// ------------------------------------------------------------
// IsoTpStack — full-duplex transport
// ------------------------------------------------------------

/**
 * RX state of the receiver-side machine.
 */
type RxState =
  | { kind: 'idle' }
  | {
      kind: 'receiving';
      buffer: Uint8Array;
      expected: number;
      received: number;
      nextSeq: number;
      blockCount: number;
      n_cr_token: TimeoutToken | null;
    };

/**
 * TX state of the sender-side machine.
 */
type TxState =
  | { kind: 'idle' }
  | {
      kind: 'sending';
      payload: Uint8Array;
      offset: number;
      seq: number;
      blockRemaining: number;
      stMinMs: number;
      timeoutToken: TimeoutToken | null;
      promiseResolve: () => void;
      promiseReject: (err: IsoTpError) => void;
    };

/**
 * The full ISO-TP stack. One instance handles both RX (incoming requests) and TX
 * (responses) on the configured ID pair.
 */
export class IsoTpStack {
  private rx: RxState = { kind: 'idle' };
  private tx: TxState = { kind: 'idle' };
  private msgListeners: MessageListener[] = [];
  private errListeners: ErrorListener[] = [];
  /** Stats — useful for the UI live counters and tests. */
  public stats = {
    framesRx: 0,
    framesTx: 0,
    messagesRx: 0,
    messagesTx: 0,
    errorsRx: 0,
    errorsTx: 0,
  };

  constructor(
    public readonly cfg: IsoTpConfig,
    private readonly sink: FrameSink,
    public readonly clock: Clock = new WallClock(),
  ) {}

  // ------------- listener API -------------
  addListener(l: MessageListener): () => void {
    this.msgListeners.push(l);
    return () => {
      this.msgListeners = this.msgListeners.filter((x) => x !== l);
    };
  }
  onError(l: ErrorListener): () => void {
    this.errListeners.push(l);
    return () => {
      this.errListeners = this.errListeners.filter((x) => x !== l);
    };
  }
  private emitMessage(buf: Uint8Array) {
    this.stats.messagesRx++;
    for (const l of [...this.msgListeners]) {
      try { l(buf); } catch (e) { /* ignore */ void e; }
    }
  }
  private emitError(err: IsoTpError) {
    this.stats.errorsRx++;
    for (const l of [...this.errListeners]) {
      try { l(err); } catch (e) { /* ignore */ void e; }
    }
  }

  // ------------- RX path -------------

  /** Feed a CAN frame received on the bus into this stack. */
  onCanFrame(frame: CanFrame): void {
    if (frame.id !== this.cfg.rxId) return;
    this.stats.framesRx++;
    let pci: ParsedPci;
    try {
      pci = parsePci(frame.data);
    } catch (e) {
      this.emitError(e as IsoTpError);
      return;
    }

    switch (pci.type) {
      case ISOTP_PCI_SF:
        this.handleSingleFrame(frame.data, pci);
        break;
      case ISOTP_PCI_FF:
        this.handleFirstFrame(frame.data, pci);
        break;
      case ISOTP_PCI_CF:
        this.handleConsecutiveFrame(frame.data, pci);
        break;
      case ISOTP_PCI_FC:
        this.handleFlowControl(frame.data, pci);
        break;
    }
  }

  private resetRx(): void {
    if (this.rx.kind === 'receiving' && this.rx.n_cr_token != null) {
      this.clock.cancel(this.rx.n_cr_token);
    }
    this.rx = { kind: 'idle' };
  }

  private handleSingleFrame(data: Uint8Array, pci: ParsedPci): void {
    // SF interrupts whatever RX was doing (per spec: SF is a complete message).
    this.resetRx();
    const len = pci.lowNibble;
    if (len < 1 || len > 7) {
      this.emitError(new IsoTpError('len-out-of-range', `SF len=${len}`));
      return;
    }
    if (data.length < 1 + len) {
      this.emitError(new IsoTpError('unexpected-frame', `SF too short`));
      return;
    }
    const payload = data.slice(1, 1 + len);
    this.emitMessage(payload);
  }

  private handleFirstFrame(data: Uint8Array, pci: ParsedPci): void {
    // FF resets any RX in progress (incoming new message wins).
    this.resetRx();
    const total = pci.ffLength!;
    if (total < 8 || total > this.cfg.maxPayload) {
      // Reply with FC=Overflow (status=2) per ISO 15765-2:2016 §6.5.5.3
      this.txFlowControl(ISOTP_FC_OVERFLOW);
      this.emitError(new IsoTpError('fc-overflow', `FF total=${total} > max=${this.cfg.maxPayload}`));
      return;
    }
    const first6 = data.slice(2, 8);
    const buffer = new Uint8Array(total);
    buffer.set(first6, 0);
    const received = Math.min(6, total);
    this.rx = {
      kind: 'receiving',
      buffer,
      expected: total,
      received,
      nextSeq: 1,
      blockCount: 0,
      n_cr_token: null,
    };
    // Schedule N_Cr (waiting for next CF)
    this.scheduleNCr();
    // After N_Br (small delay) send first FC=CTS
    this.clock.schedule(this.cfg.timeouts.N_Br, () => {
      if (this.rx.kind === 'receiving') {
        this.txFlowControl(ISOTP_FC_CTS);
      }
    });
  }

  private scheduleNCr(): void {
    if (this.rx.kind !== 'receiving') return;
    if (this.rx.n_cr_token != null) this.clock.cancel(this.rx.n_cr_token);
    this.rx.n_cr_token = this.clock.schedule(this.cfg.timeouts.N_Cr, () => {
      const e = new IsoTpError('timeout-N_Cr', 'N_Cr expired waiting for CF');
      this.resetRx();
      this.emitError(e);
    });
  }

  private handleConsecutiveFrame(data: Uint8Array, pci: ParsedPci): void {
    if (this.rx.kind !== 'receiving') {
      this.emitError(new IsoTpError('unexpected-frame', 'CF without FF'));
      return;
    }
    const expectedSeq = this.rx.nextSeq & 0xF;
    if (pci.lowNibble !== expectedSeq) {
      const e = new IsoTpError('wrong-sn', `expected SN=${expectedSeq}, got ${pci.lowNibble}`);
      this.resetRx();
      this.emitError(e);
      return;
    }
    const remaining = this.rx.expected - this.rx.received;
    const take = Math.min(remaining, 7);
    if (data.length < 1 + take) {
      this.emitError(new IsoTpError('unexpected-frame', 'CF too short'));
      return;
    }
    this.rx.buffer.set(data.slice(1, 1 + take), this.rx.received);
    this.rx.received += take;
    this.rx.nextSeq = (this.rx.nextSeq + 1) & 0xF;
    this.rx.blockCount++;

    if (this.rx.received >= this.rx.expected) {
      const buf = this.rx.buffer;
      this.resetRx();
      this.emitMessage(buf);
      return;
    }

    // BS handling: if we configured a block size, send another FC after BS frames.
    if (this.cfg.blockSize > 0 && this.rx.blockCount >= this.cfg.blockSize) {
      this.rx.blockCount = 0;
      this.clock.schedule(this.cfg.timeouts.N_Br, () => {
        if (this.rx.kind === 'receiving') this.txFlowControl(ISOTP_FC_CTS);
      });
    }
    // Refresh N_Cr
    this.scheduleNCr();
  }

  private handleFlowControl(data: Uint8Array, pci: ParsedPci): void {
    if (this.tx.kind !== 'sending') {
      // FC arriving with no TX in progress is silently ignored per spec.
      return;
    }
    if (data.length < 3) {
      this.failTx(new IsoTpError('fc-invalid', 'FC too short'));
      return;
    }
    const status = pci.lowNibble;
    const bs = data[1];
    const stMinByte = data[2];

    if (status === ISOTP_FC_OVERFLOW) {
      this.failTx(new IsoTpError('fc-overflow', 'remote overflow'));
      return;
    }
    if (status === ISOTP_FC_WAIT) {
      // Reset N_Bs and keep waiting.
      if (this.tx.timeoutToken != null) this.clock.cancel(this.tx.timeoutToken);
      this.tx.timeoutToken = this.clock.schedule(this.cfg.timeouts.N_Bs, () => {
        this.failTx(new IsoTpError('timeout-N_Bs', 'no CTS after Wait'));
      });
      return;
    }
    if (status !== ISOTP_FC_CTS) {
      this.failTx(new IsoTpError('fc-invalid', `unknown FS=${status}`));
      return;
    }

    // CTS — start sending CFs
    this.tx.blockRemaining = bs === 0 ? Number.POSITIVE_INFINITY : bs;
    this.tx.stMinMs = decodeStMin(stMinByte);
    if (this.tx.timeoutToken != null) {
      this.clock.cancel(this.tx.timeoutToken);
      this.tx.timeoutToken = null;
    }
    this.sendNextCf();
  }

  private txFlowControl(status: 0 | 1 | 2): void {
    const fc = buildFlowControl(status, this.cfg.blockSize, this.cfg.stMin, this.cfg.padding);
    this.emitFrame(fc);
  }

  // ------------- TX path -------------

  /**
   * Send a buffer, fragmenting to SF or FF+CF as needed.
   * Resolves when the message is fully transmitted (and last FC accepted).
   * Rejects on any timeout / FC overflow / FC wait expired.
   */
  sendBuffer(payload: Uint8Array): Promise<void> {
    if (this.tx.kind !== 'idle') {
      return Promise.reject(new IsoTpError('unexpected-frame', 'TX busy'));
    }
    if (payload.length === 0 || payload.length > this.cfg.maxPayload) {
      return Promise.reject(new IsoTpError('len-out-of-range', `payload=${payload.length}`));
    }

    if (payload.length <= 7) {
      // Single frame, no FC needed
      const sf = buildSingleFrame(payload, this.cfg.padding);
      this.emitFrame(sf);
      this.stats.messagesTx++;
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      this.tx = {
        kind: 'sending',
        payload,
        offset: 6,
        seq: 1,
        blockRemaining: 0, // set on FC
        stMinMs: 0,
        timeoutToken: null,
        promiseResolve: resolve,
        promiseReject: reject,
      };
      // Send FF
      const first6 = payload.slice(0, 6);
      const ff = buildFirstFrame(payload.length, first6, this.cfg.padding);
      this.emitFrame(ff);
      // Wait for FC (N_Bs)
      this.tx.timeoutToken = this.clock.schedule(this.cfg.timeouts.N_Bs, () => {
        this.failTx(new IsoTpError('timeout-N_Bs', 'no FC after FF'));
      });
    });
  }

  private sendNextCf(): void {
    if (this.tx.kind !== 'sending') return;
    if (this.tx.offset >= this.tx.payload.length) {
      // done
      const resolve = this.tx.promiseResolve;
      this.tx = { kind: 'idle' };
      this.stats.messagesTx++;
      resolve();
      return;
    }

    const remain = this.tx.payload.length - this.tx.offset;
    const take = Math.min(remain, 7);
    const data = this.tx.payload.slice(this.tx.offset, this.tx.offset + take);
    const cf = buildConsecutiveFrame(this.tx.seq, data, this.cfg.padding);
    this.emitFrame(cf);
    this.tx.offset += take;
    this.tx.seq = (this.tx.seq + 1) & 0xF;
    this.tx.blockRemaining--;

    if (this.tx.offset >= this.tx.payload.length) {
      // last CF — done after this emit
      const resolve = this.tx.promiseResolve;
      this.tx = { kind: 'idle' };
      this.stats.messagesTx++;
      resolve();
      return;
    }

    if (this.tx.blockRemaining <= 0 && Number.isFinite(this.tx.blockRemaining)) {
      // Wait for next FC
      this.tx.timeoutToken = this.clock.schedule(this.cfg.timeouts.N_Bs, () => {
        this.failTx(new IsoTpError('timeout-N_Bs', 'no FC mid-stream'));
      });
      return;
    }

    // Honour STmin between CFs
    const delay = Math.max(0, this.tx.stMinMs);
    this.clock.schedule(delay, () => this.sendNextCf());
  }

  private failTx(err: IsoTpError): void {
    if (this.tx.kind !== 'sending') return;
    if (this.tx.timeoutToken != null) this.clock.cancel(this.tx.timeoutToken);
    const reject = this.tx.promiseReject;
    this.tx = { kind: 'idle' };
    this.stats.errorsTx++;
    reject(err);
  }

  private emitFrame(data: Uint8Array): void {
    this.stats.framesTx++;
    this.sink({ id: this.cfg.txId, data, timestamp: this.clock.now() });
  }

  // ------------- lifecycle -------------

  /** Hard reset both state machines (e.g., on profile change or session restart). */
  reset(): void {
    if (this.tx.kind === 'sending') {
      const reject = this.tx.promiseReject;
      if (this.tx.timeoutToken != null) this.clock.cancel(this.tx.timeoutToken);
      this.tx = { kind: 'idle' };
      try { reject(new IsoTpError('reset', 'stack reset')); } catch (e) { void e; }
    }
    this.resetRx();
  }

  /** Snapshot for inspection / UI. */
  snapshot(): { rx: string; tx: string; stats: typeof this.stats } {
    return {
      rx: this.rx.kind,
      tx: this.tx.kind,
      stats: { ...this.stats },
    };
  }
}

// ------------------------------------------------------------
// Convenience: hex helpers
// ------------------------------------------------------------

export function bytesToHex(b: Uint8Array, sep = ' '): string {
  return Array.from(b)
    .map((x) => x.toString(16).padStart(2, '0').toUpperCase())
    .join(sep);
}

export function hexToBytes(s: string): Uint8Array {
  const cleaned = s.replace(/[\s:,-]/g, '');
  if (cleaned.length % 2 !== 0) {
    throw new Error(`hex string must have even length, got ${cleaned.length}`);
  }
  const out = new Uint8Array(cleaned.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(cleaned.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
