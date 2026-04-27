// ============================================================
// UDS (ISO 14229) — Service Layer
// ============================================================
//
// This module implements a small but functionally complete UDS
// server that runs on top of the ISO-TP transport. It exposes
// the services needed to reproduce the firmware-extraction kill
// chain documented in the dissertation case study (Ford / VW T-Cross):
//
//   0x10  DiagnosticSessionControl
//   0x11  ECUReset
//   0x22  ReadDataByIdentifier (multi-DID)
//   0x23  ReadMemoryByAddress
//   0x27  SecurityAccess (seed/key)
//   0x3E  TesterPresent
//
// Negative responses follow the ISO 14229-1 format 0x7F SID NRC.
//
// The server is purely functional with respect to its inputs:
// `handleRequest(payload)` returns a `Uint8Array` containing the
// raw UDS response bytes. The caller (the integration layer in
// ecu-simulator.ts) is responsible for routing those bytes through
// ISO-TP and CAN.
//
// Author: Marcelo Duchene (USP/ICMC, dissertation feat/uds-isotp-bootloader)
// ============================================================

import { BootloaderState } from './bootloader';

/** UDS service identifiers handled by this server. */
export const UDS_SID = {
  DiagnosticSessionControl: 0x10,
  ECUReset: 0x11,
  ReadDataByIdentifier: 0x22,
  ReadMemoryByAddress: 0x23,
  SecurityAccess: 0x27,
  TesterPresent: 0x3e,
} as const;

/** UDS negative response codes used by this server. */
export const UDS_NRC = {
  generalReject: 0x10,
  serviceNotSupported: 0x11,
  subFunctionNotSupported: 0x12,
  incorrectMessageLength: 0x13,
  conditionsNotCorrect: 0x22,
  requestSequenceError: 0x24,
  requestOutOfRange: 0x31,
  securityAccessDenied: 0x33,
  invalidKey: 0x35,
  exceededNumberOfAttempts: 0x36,
  requiredTimeDelayNotExpired: 0x37,
  responsePending: 0x78,
} as const;

/** Diagnostic session encoded in DSC sub-functions. */
export type UdsSession = 'default' | 'programming' | 'extended' | 'safety';

/** Security level. 0 = locked, 1/3/5 = various unlocked levels. */
export type UdsSecurityLevel = 0 | 1 | 3 | 5;

/** Configuration knobs for the UDS server. */
export interface UdsServerConfig {
  /**
   * Map of read-only DIDs (4-hex string, uppercase) to their byte content.
   * VIN, ECU serial, etc. Filled in by the integration layer from the
   * vehicle profile so each profile can advertise distinct values.
   */
  dids: Record<string, Uint8Array>;

  /** Bootloader state (for entering programming mode and serving 0x23). */
  bootloader: BootloaderState;

  /**
   * Seed/key algorithm. Given the seed, returns the expected key.
   * Default = simple `(seed XOR 0x01020304) + 0x42` (mod 2^32).
   */
  computeKey?: (seed: Uint32Array) => Uint32Array;

  /**
   * Fixed seed to issue (or function returning one). If absent, a
   * deterministic seed = 0xDEADBEEF is used so tests are reproducible.
   */
  seed?: number;

  /**
   * P2_server_max / P2*_server_max in milliseconds (returned as part
   * of the DSC positive response). Defaults: 50ms / 5000ms.
   */
  p2ServerMaxMs?: number;
  p2StarServerMaxMs?: number;
}

/** Default seed/key algorithm. */
export const defaultComputeKey = (seed: Uint32Array): Uint32Array => {
  const out = new Uint32Array(seed.length);
  for (let i = 0; i < seed.length; i++) {
    // Simple, deterministic, but not trivially seed = key.
    out[i] = (((seed[i] ^ 0x01020304) >>> 0) + 0x42) >>> 0;
  }
  return out;
};

/** The ECU identifies. We always emit a single-server response. */
export class UdsServer {
  private session: UdsSession = 'default';
  private securityLevel: UdsSecurityLevel = 0;
  private currentSeed: Uint8Array | null = null;
  private cfg: Required<UdsServerConfig>;
  /** Listeners for state transitions (used by the integration layer). */
  private sessionListeners: Array<(s: UdsSession) => void> = [];
  private securityListeners: Array<(lvl: UdsSecurityLevel) => void> = [];

  constructor(cfg: UdsServerConfig) {
    this.cfg = {
      dids: cfg.dids,
      bootloader: cfg.bootloader,
      computeKey: cfg.computeKey ?? defaultComputeKey,
      seed: cfg.seed ?? 0xdeadbeef,
      p2ServerMaxMs: cfg.p2ServerMaxMs ?? 50,
      p2StarServerMaxMs: cfg.p2StarServerMaxMs ?? 5000,
    };
  }

  /** Current session. */
  getSession(): UdsSession {
    return this.session;
  }

  /** Current security level. */
  getSecurityLevel(): UdsSecurityLevel {
    return this.securityLevel;
  }

  /** Whether the bootloader is active. */
  isBootloaderActive(): boolean {
    return this.cfg.bootloader.isActive();
  }

  onSessionChange(l: (s: UdsSession) => void): () => void {
    this.sessionListeners.push(l);
    return () => {
      this.sessionListeners = this.sessionListeners.filter((x) => x !== l);
    };
  }

  onSecurityChange(l: (lvl: UdsSecurityLevel) => void): () => void {
    this.securityListeners.push(l);
    return () => {
      this.securityListeners = this.securityListeners.filter((x) => x !== l);
    };
  }

  /**
   * Top-level request handler.
   * Returns `null` if no response should be emitted (e.g., suppressPosRspMsgIndicationBit
   * was set on TesterPresent).
   */
  handleRequest(req: Uint8Array): Uint8Array | null {
    if (req.length === 0) {
      return this.neg(0x00, UDS_NRC.incorrectMessageLength);
    }
    const sid = req[0];
    switch (sid) {
      case UDS_SID.DiagnosticSessionControl:
        return this.handleDsc(req);
      case UDS_SID.ECUReset:
        return this.handleEcuReset(req);
      case UDS_SID.ReadDataByIdentifier:
        return this.handleReadDid(req);
      case UDS_SID.ReadMemoryByAddress:
        return this.handleReadMemoryByAddress(req);
      case UDS_SID.SecurityAccess:
        return this.handleSecurityAccess(req);
      case UDS_SID.TesterPresent:
        return this.handleTesterPresent(req);
      default:
        return this.neg(sid, UDS_NRC.serviceNotSupported);
    }
  }

  // ---- Service handlers --------------------------------------------------

  private handleDsc(req: Uint8Array): Uint8Array {
    if (req.length !== 2) {
      return this.neg(UDS_SID.DiagnosticSessionControl, UDS_NRC.incorrectMessageLength);
    }
    const sub = req[1] & 0x7f; // mask off suppressPosRspMsgIndicationBit
    let next: UdsSession;
    switch (sub) {
      case 0x01:
        next = 'default';
        break;
      case 0x02:
        next = 'programming';
        break;
      case 0x03:
        next = 'extended';
        break;
      case 0x04:
        next = 'safety';
        break;
      default:
        return this.neg(UDS_SID.DiagnosticSessionControl, UDS_NRC.subFunctionNotSupported);
    }

    this.session = next;
    // Spec: any non-default session change resets security to locked.
    if (this.securityLevel !== 0) {
      this.securityLevel = 0;
      this.securityListeners.forEach((l) => l(0));
    }
    this.sessionListeners.forEach((l) => l(next));

    // Positive response: subfn + P2 + P2*. P2 in ms, big-endian. P2* in 10ms.
    const p2 = this.cfg.p2ServerMaxMs;
    const p2Star = Math.round(this.cfg.p2StarServerMaxMs / 10);
    return Uint8Array.from([
      UDS_SID.DiagnosticSessionControl + 0x40,
      sub,
      (p2 >> 8) & 0xff,
      p2 & 0xff,
      (p2Star >> 8) & 0xff,
      p2Star & 0xff,
    ]);
  }

  private handleEcuReset(req: Uint8Array): Uint8Array {
    if (req.length !== 2) {
      return this.neg(UDS_SID.ECUReset, UDS_NRC.incorrectMessageLength);
    }
    const sub = req[1] & 0x7f;
    if (sub < 0x01 || sub > 0x05) {
      return this.neg(UDS_SID.ECUReset, UDS_NRC.subFunctionNotSupported);
    }

    // sub 0x02 (keyOffOn) is commonly used to enter the bootloader in the
    // Ford / VW kill chain when paired with programming session.
    // sub 0x01 = hardReset also enters bootloader if a previous DSC=programming
    // is in effect; otherwise resets to default session in application mode.
    const enterBoot = sub === 0x02 || (sub === 0x01 && this.session === 'programming');
    if (enterBoot) {
      this.cfg.bootloader.enterBootloader();
    } else {
      this.cfg.bootloader.exitBootloader();
    }

    // Reset session and security on hard/key-off resets.
    if (sub === 0x01 || sub === 0x02 || sub === 0x03) {
      this.session = enterBoot ? 'programming' : 'default';
      this.securityLevel = 0;
      this.sessionListeners.forEach((l) => l(this.session));
      this.securityListeners.forEach((l) => l(0));
    }

    return Uint8Array.from([UDS_SID.ECUReset + 0x40, sub]);
  }

  private handleReadDid(req: Uint8Array): Uint8Array {
    // req: [22, DIDhi, DIDlo, ...] (one or more DIDs, each 2 bytes)
    if (req.length < 3 || (req.length - 1) % 2 !== 0) {
      return this.neg(UDS_SID.ReadDataByIdentifier, UDS_NRC.incorrectMessageLength);
    }

    const out: number[] = [UDS_SID.ReadDataByIdentifier + 0x40];
    for (let i = 1; i + 1 < req.length; i += 2) {
      const did = (req[i] << 8) | req[i + 1];
      const key = did.toString(16).toUpperCase().padStart(4, '0');
      const data = this.cfg.dids[key];
      if (!data) {
        return this.neg(UDS_SID.ReadDataByIdentifier, UDS_NRC.requestOutOfRange);
      }
      out.push(req[i], req[i + 1]);
      for (let b = 0; b < data.length; b++) out.push(data[b]);
    }
    return Uint8Array.from(out);
  }

  private handleReadMemoryByAddress(req: Uint8Array): Uint8Array {
    // req: [23, ALFID, addr(N), size(M)] where ALFID = (M<<4 | N)
    if (req.length < 4) {
      return this.neg(UDS_SID.ReadMemoryByAddress, UDS_NRC.incorrectMessageLength);
    }
    const alfid = req[1];
    const addrLen = alfid & 0x0f;
    const sizeLen = (alfid >> 4) & 0x0f;
    if (addrLen < 1 || addrLen > 4 || sizeLen < 1 || sizeLen > 4) {
      return this.neg(UDS_SID.ReadMemoryByAddress, UDS_NRC.requestOutOfRange);
    }
    if (req.length !== 2 + addrLen + sizeLen) {
      return this.neg(UDS_SID.ReadMemoryByAddress, UDS_NRC.incorrectMessageLength);
    }

    // Security gate: ReadMemoryByAddress is restricted to unlocked + non-default
    // (we accept extended OR programming, mirroring real OEM gating).
    if (this.securityLevel === 0) {
      return this.neg(UDS_SID.ReadMemoryByAddress, UDS_NRC.securityAccessDenied);
    }
    if (this.session === 'default') {
      return this.neg(UDS_SID.ReadMemoryByAddress, UDS_NRC.conditionsNotCorrect);
    }

    let addr = 0;
    for (let i = 0; i < addrLen; i++) addr = (addr * 0x100 + req[2 + i]) >>> 0;
    let size = 0;
    for (let i = 0; i < sizeLen; i++) size = size * 0x100 + req[2 + addrLen + i];

    if (size === 0) {
      return this.neg(UDS_SID.ReadMemoryByAddress, UDS_NRC.requestOutOfRange);
    }
    // Cap a single response to fit inside ISO-TP's 12-bit length (max 4095 bytes)
    // including the SID. The real exploit uses 4096-byte chunks; we accept up to
    // 4094 (ISO-TP cap minus 1 SID byte).
    const maxChunk = 4094; // 4095 ISO-TP cap - 1 SID byte
    if (size > maxChunk) {
      return this.neg(UDS_SID.ReadMemoryByAddress, UDS_NRC.requestOutOfRange);
    }

    let data: Uint8Array;
    try {
      data = this.cfg.bootloader.readMemory(addr, size);
    } catch {
      return this.neg(UDS_SID.ReadMemoryByAddress, UDS_NRC.requestOutOfRange);
    }

    const out = new Uint8Array(1 + data.length);
    out[0] = UDS_SID.ReadMemoryByAddress + 0x40;
    out.set(data, 1);
    return out;
  }

  private handleSecurityAccess(req: Uint8Array): Uint8Array {
    if (req.length < 2) {
      return this.neg(UDS_SID.SecurityAccess, UDS_NRC.incorrectMessageLength);
    }
    const sub = req[1];
    const isRequestSeed = sub % 2 === 1; // 0x01, 0x03, 0x05 ...
    const isSendKey = sub % 2 === 0; // 0x02, 0x04, 0x06 ...
    if (!isRequestSeed && !isSendKey) {
      return this.neg(UDS_SID.SecurityAccess, UDS_NRC.subFunctionNotSupported);
    }

    // Real OEMs allow security only in non-default session.
    if (this.session === 'default') {
      return this.neg(UDS_SID.SecurityAccess, UDS_NRC.conditionsNotCorrect);
    }

    if (isRequestSeed) {
      // Issue the seed. If already unlocked at this level, return seed=0.
      const wantedLevel = (sub === 0x01 ? 1 : sub === 0x03 ? 3 : 5) as UdsSecurityLevel;
      if (this.securityLevel === wantedLevel) {
        // Already unlocked → seed = 0 (per ISO 14229).
        const zero = new Uint8Array(4);
        this.currentSeed = zero;
        return Uint8Array.from([UDS_SID.SecurityAccess + 0x40, sub, ...zero]);
      }
      const seedBytes = u32ToBytes(this.cfg.seed);
      this.currentSeed = seedBytes;
      return Uint8Array.from([UDS_SID.SecurityAccess + 0x40, sub, ...seedBytes]);
    }

    // sendKey
    if (req.length !== 2 + 4) {
      return this.neg(UDS_SID.SecurityAccess, UDS_NRC.incorrectMessageLength);
    }
    if (!this.currentSeed) {
      return this.neg(UDS_SID.SecurityAccess, UDS_NRC.requestSequenceError);
    }
    const sentKey = req.slice(2, 6);
    const expectedKey = u32ToBytes(
      this.cfg.computeKey(new Uint32Array([bytesToU32(this.currentSeed)]))[0],
    );
    if (!byteArraysEqual(sentKey, expectedKey)) {
      this.currentSeed = null; // force re-request on retry
      return this.neg(UDS_SID.SecurityAccess, UDS_NRC.invalidKey);
    }

    // Determine which level was unlocked by sub-function (sendKey sub = req-seed sub + 1).
    const reqSeedSub = sub - 1;
    const newLevel = (reqSeedSub === 0x01 ? 1 : reqSeedSub === 0x03 ? 3 : 5) as UdsSecurityLevel;
    this.securityLevel = newLevel;
    this.currentSeed = null;
    this.securityListeners.forEach((l) => l(newLevel));
    return Uint8Array.from([UDS_SID.SecurityAccess + 0x40, sub]);
  }

  private handleTesterPresent(req: Uint8Array): Uint8Array | null {
    if (req.length !== 2) {
      return this.neg(UDS_SID.TesterPresent, UDS_NRC.incorrectMessageLength);
    }
    const sub = req[1];
    const suppressBit = (sub & 0x80) !== 0;
    const subFn = sub & 0x7f;
    if (subFn !== 0x00) {
      return this.neg(UDS_SID.TesterPresent, UDS_NRC.subFunctionNotSupported);
    }
    if (suppressBit) return null;
    return Uint8Array.from([UDS_SID.TesterPresent + 0x40, 0x00]);
  }

  // ---- helpers -----------------------------------------------------------

  private neg(sid: number, nrc: number): Uint8Array {
    return Uint8Array.from([0x7f, sid & 0xff, nrc & 0xff]);
  }
}

// --------------------------------------------------------------------------
// Pure helpers, exported for tests.
// --------------------------------------------------------------------------

export function u32ToBytes(value: number): Uint8Array {
  const v = value >>> 0;
  return Uint8Array.from([(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff]);
}

export function bytesToU32(bytes: Uint8Array): number {
  if (bytes.length < 4) {
    let v = 0;
    for (let i = 0; i < bytes.length; i++) v = (v * 0x100 + bytes[i]) >>> 0;
    return v >>> 0;
  }
  return (((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0);
}

export function byteArraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Format a Uint8Array as space-separated uppercase hex (used by logs and tests). */
export function bytesToHex(bytes: Uint8Array, sep = ' '): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).toUpperCase().padStart(2, '0'))
    .join(sep);
}

/** Parse a string of hex bytes (any whitespace) into a Uint8Array. */
export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/[^0-9a-fA-F]/g, '');
  if (clean.length % 2 !== 0) throw new Error('hexToBytes: odd length');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16);
  }
  return out;
}
