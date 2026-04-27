// ============================================================
// UDS Kill-Chain Engine
// ============================================================
//
// Orchestrates the bidirectional ISO-TP / UDS exchange that
// reproduces the firmware-extraction kill chain documented in
// the dissertation case study (Ford / VW T-Cross). Two ISO-TP
// stacks are connected back-to-back through a shared in-memory
// bus so the engine can play both the diagnostic tester and the
// simulated ECU.
//
// The engine logs every CAN frame that traverses the link with a
// monotonically increasing timestamp and a decoded UDS service
// label, producing a stream of `KillChainCanLog` entries that the
// UI displays and the test fixtures assert against.
//
// Author: Marcelo Duchene (USP/ICMC, dissertation feat/uds-isotp-bootloader)
// ============================================================

import { BootloaderState } from './bootloader';
import {
  IsoTp,
  IsoTpCanFrame,
  IsoTpClock,
  IsoTpPciType,
  IsoTpStack,
} from './iso-tp';
import {
  UdsServer,
  UdsServerConfig,
  UDS_NRC,
  UDS_SID,
  bytesToHex,
  defaultComputeKey,
  u32ToBytes,
  bytesToU32,
} from './uds';

/** Direction of a CAN frame on the diagnostic link. */
export type FrameDirection = 'tester→ecu' | 'ecu→tester';

/** Single CAN frame log entry (full timeline of the kill chain). */
export interface KillChainCanLog {
  /** Timestamp in microseconds, relative to engine start. */
  timestampUs: number;
  /** CAN identifier. */
  canId: number;
  /** Direction (request or response). */
  direction: FrameDirection;
  /** Data length code (1..8). */
  dlc: number;
  /** Raw 8 bytes (padded). */
  data: Uint8Array;
  /**
   * Decoded ISO-TP / UDS context for the row, e.g. "UDS 0x10 DSC sub=0x03"
   * or "ISO-TP CF seq=4". Pure-text, used in CSV exports and the UI table.
   */
  decoded: string;
  /** UDS service identifier extracted from this frame, when applicable. */
  udsService?: number;
}

/** Per-phase metadata captured by the engine (used by the UI / CSV split). */
export interface KillChainPhaseLog {
  name: string;
  startUs: number;
  endUs: number;
  framesStart: number;
  framesEnd: number;
  description: string;
}

export interface KillChainOptions {
  /** ECU diagnostic request CAN ID (tester → ECU). Default 0x7E0. */
  ecuRequestId?: number;
  /** ECU diagnostic response CAN ID (ECU → tester). Default 0x7E8. */
  ecuResponseId?: number;
  /** Starting memory address to dump. Default 0x00000000. */
  dumpStartAddr?: number;
  /** Total bytes to dump. Default 512 KB. */
  dumpTotalBytes?: number;
  /** Bytes per UDS 0x23 request. Default 4096. */
  dumpChunkBytes?: number;
  /** Bus conditioning frames to send before starting UDS. Default 50. */
  busConditionFrames?: number;
  /** Block size for ISO-TP FCs. Default 0 (no flow control between blocks). */
  blockSize?: number;
  /** STmin (raw byte). Default 0. */
  stMin?: number;
  /** Override the seed/key algorithm in the simulated ECU (advanced/tests). */
  computeKey?: (seed: Uint32Array) => Uint32Array;
  /** Custom DIDs map (overrides defaults from vehicle profile). */
  dids?: Record<string, Uint8Array>;
  /** Optional clock injection for tests. */
  clock?: IsoTpClock;
  /** Optional bootloader injection for tests (so the test can inspect the image). */
  bootloader?: BootloaderState;
  /** Optional callback fired on each new log entry. */
  onLog?: (entry: KillChainCanLog) => void;
  /** Optional callback fired on each phase transition. */
  onPhase?: (phase: KillChainPhaseLog) => void;
  /** Optional progress callback (0..1, message). */
  onProgress?: (fraction: number, message: string) => void;
}

/** Result of running the kill chain. */
export interface KillChainResult {
  /** All logged CAN frames, ordered by timestamp. */
  log: KillChainCanLog[];
  /** Per-phase logs. */
  phases: KillChainPhaseLog[];
  /** Reconstructed firmware dump (Uint8Array of dumpTotalBytes bytes). */
  firmware: Uint8Array;
  /** FNV-1a hash of the dump for quick equality checks in tests. */
  firmwareHash: number;
  /** Total wall-clock duration (us). */
  totalDurationUs: number;
  /** Total CAN frames exchanged. */
  totalFrames: number;
  /** Bootloader state at the end of the run (for inspection). */
  bootloader: BootloaderState;
}

/** Default DIDs used by the simulator if the caller does not override them. */
export function defaultDids(opts?: { vin?: string; partNumber?: string }): Record<string, Uint8Array> {
  const enc = (s: string) => new TextEncoder().encode(s);
  return {
    F190: enc(opts?.vin ?? '9BFZH54P0LB123456'), // Brazilian-style VIN
    F18C: enc('ECU_HYBRIDLAB_001'),
    F191: enc('HW_REV_A2'),
    F187: enc(opts?.partNumber ?? 'ECU-HYBRIDLAB-PN-0001'),
    F195: enc('SW_BL_v1.0'),
  };
}

/** Convenience to format a hex u8. */
const hex2 = (b: number) => b.toString(16).toUpperCase().padStart(2, '0');
const hex4 = (b: number) => b.toString(16).toUpperCase().padStart(4, '0');
const hex8 = (b: number) => b.toString(16).toUpperCase().padStart(8, '0');

const UDS_NAMES: Record<number, string> = {
  [UDS_SID.DiagnosticSessionControl]: 'DSC',
  [UDS_SID.ECUReset]: 'ECUReset',
  [UDS_SID.ReadDataByIdentifier]: 'ReadDID',
  [UDS_SID.ReadMemoryByAddress]: 'ReadMemoryByAddress',
  [UDS_SID.SecurityAccess]: 'SecurityAccess',
  [UDS_SID.TesterPresent]: 'TesterPresent',
};

const NRC_NAMES: Record<number, string> = Object.fromEntries(
  Object.entries(UDS_NRC).map(([k, v]) => [v, k]),
);

/**
 * Decode an ISO-TP frame into a human-readable label. Pure function for tests.
 */
export function describeFrame(data: Uint8Array, lastUdsSid: number | null = null): {
  label: string;
  udsSid?: number;
} {
  const pci = IsoTp.pciType(data);
  const tag = ['SF', 'FF', 'CF', 'FC'][pci] ?? '??';
  const head = `ISO-TP ${tag}`;
  switch (pci) {
    case IsoTpPciType.SF: {
      const sid = data[1];
      let txt = `${head} len=${data[0] & 0x0f}`;
      if (sid === 0x7f) {
        const inner = data[2];
        const nrc = data[3];
        const name = UDS_NAMES[inner] ?? `0x${hex2(inner)}`;
        const nrcName = NRC_NAMES[nrc] ?? `0x${hex2(nrc)}`;
        txt += ` | UDS NEG ${name} NRC=${nrcName}`;
        return { label: txt, udsSid: inner };
      }
      const isResponse = (sid & 0x40) !== 0 && (sid & 0xbf) !== sid; // crude
      const baseSid = isResponse ? sid - 0x40 : sid;
      const name = UDS_NAMES[baseSid] ?? `SID=0x${hex2(sid)}`;
      txt += ` | UDS ${isResponse ? 'RESP' : 'REQ '} ${name}`;
      return { label: txt, udsSid: baseSid };
    }
    case IsoTpPciType.FF: {
      const total = ((data[0] & 0x0f) << 8) | data[1];
      const sid = data[2];
      const isResponse = (sid & 0x40) !== 0;
      const baseSid = isResponse ? sid - 0x40 : sid;
      const name = UDS_NAMES[baseSid] ?? `SID=0x${hex2(sid)}`;
      return {
        label: `${head} total=${total}B | UDS ${isResponse ? 'RESP' : 'REQ '} ${name}`,
        udsSid: baseSid,
      };
    }
    case IsoTpPciType.CF: {
      const seq = data[0] & 0x0f;
      return {
        label: `${head} seq=${seq}${lastUdsSid ? ` (cont. ${UDS_NAMES[lastUdsSid] ?? 'SID 0x' + hex2(lastUdsSid)})` : ''}`,
        udsSid: lastUdsSid ?? undefined,
      };
    }
    case IsoTpPciType.FC: {
      const flag = data[0] & 0x0f;
      const flagName = ['CTS', 'WAIT', 'OVFLW'][flag] ?? `0x${hex2(flag)}`;
      return { label: `${head} ${flagName} BS=${data[1]} STmin=0x${hex2(data[2])}` };
    }
    default:
      return { label: `${head} (raw=${bytesToHex(data)})` };
  }
}

/**
 * In-memory CAN bus that connects the tester and ECU stacks back-to-back.
 * Frames written by one side are delivered synchronously to the other, with
 * each delivery routed through the engine's logger.
 */
class VirtualCanBus {
  private testerInbox: ((f: IsoTpCanFrame) => void) | null = null;
  private ecuInbox: ((f: IsoTpCanFrame) => void) | null = null;
  constructor(private readonly logger: (f: IsoTpCanFrame, dir: FrameDirection) => void) {}

  attachTester(rx: (f: IsoTpCanFrame) => void) {
    this.testerInbox = rx;
  }
  attachEcu(rx: (f: IsoTpCanFrame) => void) {
    this.ecuInbox = rx;
  }
  /** Tester-side send → goes to ECU. */
  sendFromTester(f: IsoTpCanFrame): void {
    this.logger(f, 'tester→ecu');
    this.ecuInbox?.(f);
  }
  /** ECU-side send → goes back to tester. */
  sendFromEcu(f: IsoTpCanFrame): void {
    this.logger(f, 'ecu→tester');
    this.testerInbox?.(f);
  }
}

/**
 * Tester-side helper that wraps an IsoTpStack with a "request → wait for one
 * response" idiom. Concurrent requests on the same ID are not allowed.
 */
class TesterClient {
  private pending: ((payload: Uint8Array) => void) | null = null;
  constructor(private readonly stack: IsoTpStack) {
    stack.addListener((payload) => {
      const cb = this.pending;
      this.pending = null;
      cb?.(payload);
    });
  }

  /** Send a UDS request and wait for the response (resolves with raw UDS bytes). */
  request(payload: Uint8Array, timeoutMs = 5000): Promise<Uint8Array> {
    return new Promise<Uint8Array>((resolve, reject) => {
      if (this.pending) {
        reject(new Error('TesterClient: request already pending'));
        return;
      }
      const timer = setTimeout(() => {
        this.pending = null;
        reject(new Error('TesterClient: response timeout'));
      }, timeoutMs);
      this.pending = (resp) => {
        clearTimeout(timer);
        resolve(resp);
      };
      this.stack.sendBuffer(payload).catch((e) => {
        clearTimeout(timer);
        this.pending = null;
        reject(e);
      });
    });
  }
}

/**
 * Run the full firmware-extraction kill chain.
 *
 * Phases:
 *   1. Bus conditioning (passive benign frames on 0x100..0x103 to mimic real bus)
 *   2. UDS DSC: enter extended (0x10 03)
 *   3. UDS DSC: enter programming (0x10 02)
 *   4. UDS ECUReset: enter bootloader (0x11 02)
 *   5. UDS DSC: re-enter programming after reset
 *   6. UDS SecurityAccess: requestSeed (0x27 01) + sendKey (0x27 02)
 *   7. UDS ReadMemoryByAddress: loop chunked read (0x23) over the full image
 *   8. Reassemble firmware, compute hash, return result
 */
export async function runKillChain(opts: KillChainOptions = {}): Promise<KillChainResult> {
  const ecuReqId = opts.ecuRequestId ?? 0x7e0;
  const ecuRespId = opts.ecuResponseId ?? 0x7e8;
  const dumpStart = opts.dumpStartAddr ?? 0x00000000;
  const dumpTotal = opts.dumpTotalBytes ?? 512 * 1024;
  const chunk = opts.dumpChunkBytes ?? 4094; // ISO-TP cap - 1 SID byte
  const busFrames = opts.busConditionFrames ?? 50;
  const blockSize = opts.blockSize ?? 0;
  const stMin = opts.stMin ?? 0;
  const clock = opts.clock; // undefined → real clock inside the stack

  const bootloader = opts.bootloader ?? new BootloaderState();
  const dids = opts.dids ?? defaultDids();

  const log: KillChainCanLog[] = [];
  const phases: KillChainPhaseLog[] = [];
  const startMs =
    typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
  let lastUdsSid: number | null = null;

  const pushFrame = (f: IsoTpCanFrame, dir: FrameDirection) => {
    const nowMs =
      (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()) -
      startMs;
    const decoded = describeFrame(f.data, lastUdsSid);
    if (decoded.udsSid !== undefined) lastUdsSid = decoded.udsSid;
    const entry: KillChainCanLog = {
      timestampUs: Math.round(nowMs * 1000),
      canId: f.id,
      direction: dir,
      dlc: f.data.length,
      data: f.data,
      decoded: decoded.label,
      udsService: decoded.udsSid,
    };
    log.push(entry);
    opts.onLog?.(entry);
  };

  const bus = new VirtualCanBus(pushFrame);

  // ECU side: server using the synthetic image
  const ecuStack = new IsoTpStack(
    {
      txId: ecuRespId,
      rxId: ecuReqId,
      blockSize,
      stMin,
    },
    (f) => bus.sendFromEcu(f),
    clock,
  );
  bus.attachEcu((f) => ecuStack.onCanFrame(f));

  const serverCfg: UdsServerConfig = {
    dids,
    bootloader,
    computeKey: opts.computeKey ?? defaultComputeKey,
  };
  const server = new UdsServer(serverCfg);
  ecuStack.addListener((req) => {
    const resp = server.handleRequest(req);
    if (resp) {
      ecuStack.sendBuffer(resp).catch(() => void 0);
    }
  });

  // Tester side: client
  const testerStack = new IsoTpStack(
    {
      txId: ecuReqId,
      rxId: ecuRespId,
      blockSize,
      stMin,
    },
    (f) => bus.sendFromTester(f),
    clock,
  );
  bus.attachTester((f) => testerStack.onCanFrame(f));
  const tester = new TesterClient(testerStack);

  const phaseStart = (name: string, description: string): KillChainPhaseLog => {
    const startUs = log.length === 0 ? 0 : log[log.length - 1].timestampUs;
    return { name, description, startUs, endUs: startUs, framesStart: log.length, framesEnd: log.length };
  };
  const phaseEnd = (p: KillChainPhaseLog) => {
    p.endUs = log.length === 0 ? p.startUs : log[log.length - 1].timestampUs;
    p.framesEnd = log.length;
    phases.push(p);
    opts.onPhase?.(p);
  };

  const totalSteps =
    busFrames /* phase 1 */ +
    1 /* DSC ext */ +
    1 /* DSC prog */ +
    1 /* ECUReset */ +
    1 /* DSC prog post-reset */ +
    2 /* SecurityAccess */ +
    Math.ceil(dumpTotal / chunk); /* dump chunks */
  let stepsDone = 0;
  const tickProgress = (msg: string) => {
    stepsDone += 1;
    opts.onProgress?.(stepsDone / totalSteps, msg);
  };

  // ── Phase 1: bus conditioning ───────────────────────────────────
  {
    const p = phaseStart('bus_conditioning', 'Benign powertrain frames to mimic real bus traffic.');
    for (let i = 0; i < busFrames; i++) {
      const fid = 0x100 + (i & 0x3); // rotate among 0x100..0x103
      const data = new Uint8Array(8);
      // Simulated RPM/speed rolling pattern
      const rpm = 700 + ((i * 17) % 200);
      const spd = (i * 3) % 60;
      data[0] = (rpm >> 8) & 0xff;
      data[1] = rpm & 0xff;
      data[2] = spd & 0xff;
      data[3] = (i & 0xff);
      data[4] = 0x00;
      data[5] = 0x00;
      data[6] = 0x00;
      data[7] = 0x00;
      bus.sendFromTester({ id: fid, data });
      tickProgress(`bus conditioning ${i + 1}/${busFrames}`);
    }
    phaseEnd(p);
  }

  // ── Phase 2: enter extended diagnostic session ──────────────────
  {
    const p = phaseStart('dsc_extended', 'UDS 0x10 sub=0x03 — Extended Diagnostic Session.');
    const resp = await tester.request(Uint8Array.from([UDS_SID.DiagnosticSessionControl, 0x03]));
    if (resp[0] !== UDS_SID.DiagnosticSessionControl + 0x40) {
      throw new Error('DSC extended: negative response: ' + bytesToHex(resp));
    }
    tickProgress('DSC extended');
    phaseEnd(p);
  }

  // ── Phase 3: enter programming session ─────────────────────────
  {
    const p = phaseStart('dsc_programming', 'UDS 0x10 sub=0x02 — Programming Session.');
    const resp = await tester.request(Uint8Array.from([UDS_SID.DiagnosticSessionControl, 0x02]));
    if (resp[0] !== UDS_SID.DiagnosticSessionControl + 0x40) {
      throw new Error('DSC programming: negative response: ' + bytesToHex(resp));
    }
    tickProgress('DSC programming');
    phaseEnd(p);
  }

  // ── Phase 4: ECU reset → enter bootloader ──────────────────────
  {
    const p = phaseStart('ecu_reset_bootloader', 'UDS 0x11 sub=0x02 — KeyOffOnReset → bootloader.');
    const resp = await tester.request(Uint8Array.from([UDS_SID.ECUReset, 0x02]));
    if (resp[0] !== UDS_SID.ECUReset + 0x40) {
      throw new Error('ECUReset: negative response: ' + bytesToHex(resp));
    }
    if (!bootloader.isActive()) {
      throw new Error('ECUReset: bootloader did not enter active mode');
    }
    tickProgress('ECU reset → bootloader');
    phaseEnd(p);
  }

  // ── Phase 5: re-enter programming session inside bootloader ────
  {
    const p = phaseStart(
      'dsc_programming_post_reset',
      'UDS 0x10 sub=0x02 — re-establish session after reset (now in bootloader).',
    );
    const resp = await tester.request(Uint8Array.from([UDS_SID.DiagnosticSessionControl, 0x02]));
    if (resp[0] !== UDS_SID.DiagnosticSessionControl + 0x40) {
      throw new Error('DSC post-reset: negative response: ' + bytesToHex(resp));
    }
    tickProgress('DSC post-reset');
    phaseEnd(p);
  }

  // ── Phase 6: security access (request seed + send key) ─────────
  {
    const p = phaseStart('security_access', 'UDS 0x27 sub=0x01 (seed) + sub=0x02 (key).');
    const seedResp = await tester.request(Uint8Array.from([UDS_SID.SecurityAccess, 0x01]));
    if (seedResp[0] !== UDS_SID.SecurityAccess + 0x40) {
      throw new Error('SecurityAccess seed: negative response: ' + bytesToHex(seedResp));
    }
    if (seedResp[1] !== 0x01) {
      throw new Error('SecurityAccess seed: unexpected sub-fn echo: ' + hex2(seedResp[1]));
    }
    const seed = seedResp.slice(2);
    if (seed.length !== 4) {
      throw new Error(`SecurityAccess seed: unexpected seed length ${seed.length}`);
    }
    const computeKey = opts.computeKey ?? defaultComputeKey;
    const key = u32ToBytes(computeKey(new Uint32Array([bytesToU32(seed)]))[0]);
    const keyResp = await tester.request(
      Uint8Array.from([UDS_SID.SecurityAccess, 0x02, ...key]),
    );
    if (keyResp[0] !== UDS_SID.SecurityAccess + 0x40) {
      throw new Error('SecurityAccess key: negative response: ' + bytesToHex(keyResp));
    }
    if (server.getSecurityLevel() !== 1) {
      throw new Error('SecurityAccess: server still locked');
    }
    tickProgress('Security unlocked');
    phaseEnd(p);
  }

  // ── Phase 7: ReadMemoryByAddress loop ───────────────────────────
  const firmware = new Uint8Array(dumpTotal);
  {
    const p = phaseStart(
      'firmware_dump',
      `UDS 0x23 ALFID=0x44 — ${Math.ceil(dumpTotal / chunk)} chunks of ${chunk} B.`,
    );
    let cursor = 0;
    while (cursor < dumpTotal) {
      const thisChunk = Math.min(chunk, dumpTotal - cursor);
      const addr = dumpStart + cursor;
      // ALFID 0x44 = 4-byte size, 4-byte address
      const req = new Uint8Array(2 + 4 + 4);
      req[0] = UDS_SID.ReadMemoryByAddress;
      req[1] = 0x44;
      req[2] = (addr >>> 24) & 0xff;
      req[3] = (addr >>> 16) & 0xff;
      req[4] = (addr >>> 8) & 0xff;
      req[5] = addr & 0xff;
      req[6] = (thisChunk >>> 24) & 0xff;
      req[7] = (thisChunk >>> 16) & 0xff;
      req[8] = (thisChunk >>> 8) & 0xff;
      req[9] = thisChunk & 0xff;
      const resp = await tester.request(req, 10000);
      if (resp[0] !== UDS_SID.ReadMemoryByAddress + 0x40) {
        throw new Error(
          `ReadMemoryByAddress @0x${hex8(addr)}: negative response ${bytesToHex(resp)}`,
        );
      }
      const data = resp.slice(1);
      if (data.length !== thisChunk) {
        throw new Error(
          `ReadMemoryByAddress @0x${hex8(addr)}: expected ${thisChunk} B, got ${data.length}`,
        );
      }
      firmware.set(data, cursor);
      cursor += thisChunk;
      tickProgress(
        `dump ${Math.floor((cursor / dumpTotal) * 100)}% (${cursor}/${dumpTotal} B)`,
      );
    }
    phaseEnd(p);
  }

  // FNV-1a hash of the dump for quick equality checks
  let h = 0x811c9dc5;
  for (let i = 0; i < firmware.length; i++) {
    h ^= firmware[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }

  const totalDurationUs = log.length === 0 ? 0 : log[log.length - 1].timestampUs;

  // Cleanup
  testerStack.reset();
  ecuStack.reset();

  return {
    log,
    phases,
    firmware,
    firmwareHash: h >>> 0,
    totalDurationUs,
    totalFrames: log.length,
    bootloader,
  };
}

/** Convert a kill-chain log into a CSV string matching the data/uds_demo_*.csv schema. */
export function killChainLogToCsv(log: KillChainCanLog[]): string {
  const lines: string[] = ['timestamp_us,can_id,direction,dlc,data_hex,decoded_uds_service'];
  for (const e of log) {
    const dataHex = bytesToHex(e.data, '');
    const decoded = e.decoded.replace(/,/g, ';');
    const dirShort = e.direction === 'tester→ecu' ? 'TX' : 'RX';
    lines.push(
      `${e.timestampUs},0x${hex4(e.canId)},${dirShort},${e.dlc},${dataHex},${decoded}`,
    );
  }
  return lines.join('\n');
}

/** Helper for the UI: format us → "ss.mmm s". */
export function formatUs(us: number): string {
  const ms = us / 1000;
  if (ms < 1000) return `${ms.toFixed(1)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}
