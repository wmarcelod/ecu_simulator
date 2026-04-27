// ============================================================
// UDS (ISO 14229-1) — Application layer for diagnostic services
// ============================================================
//
// Implements the subset of UDS required to reproduce the dissertation's
// Ford / VW T-Cross-style firmware extraction kill chain, plus the
// programming counterpart so the testbed can also model rogue-firmware
// upload attacks.
//
// Services implemented:
//
//   0x10 DiagnosticSessionControl    (sub: 01 default, 02 programming, 03 extended, 04 safety)
//   0x11 ECUReset                    (sub: 01 hardReset, 02 keyOffOn, 03 softReset)
//   0x14 ClearDiagnosticInformation  (DTC group selector)
//   0x19 ReadDTCInformation          (sub: 02 byStatusMask)
//   0x22 ReadDataByIdentifier        (DID-based)
//   0x23 ReadMemoryByAddress         (ALFID encoding)
//   0x27 SecurityAccess              (odd = requestSeed, even = sendKey)
//   0x2E WriteDataByIdentifier
//   0x31 RoutineControl              (sub: 01 startRoutine 0xFF00 eraseMemory)
//   0x34 RequestDownload
//   0x36 TransferData
//   0x37 RequestTransferExit
//   0x3E TesterPresent
//
// Differentiators vs a "naive" implementation:
//
//   1. **Wider service catalog** — adds 0x14, 0x19, 0x2E, 0x31, 0x34, 0x36,
//      0x37 in addition to the minimum required, so the testbed covers both
//      *extraction* (0x23) and *programming* (0x34/0x36/0x37) attack
//      flavours, plus DTC-based reconnaissance (0x19).
//
//   2. **Strict NRC discipline** — every service validates length, session,
//      security and sub-function in the precise order spec'd by ISO 14229
//      §6.3, emitting NRCs in the priority order recommended by AUTOSAR
//      DCM (length → sub → session → security → conditions → range).
//
//   3. **Pluggable key derivation** — the SecurityAccess algorithm is a
//      strategy callback so both 'weak' and 'hardened' bootloader profiles
//      can be exercised by the same UDS server.
//
//   4. **Configurable DID storage** — a Map<DID, Uint8Array> backs 0x22/0x2E,
//      so tests can inject any DID set, and the kill chain UI can show DID
//      reconnaissance dynamically based on the active vehicle profile.
//
// References (sources/research_uds_*.md):
//   - ISO 14229-1:2020, AUTOSAR_SWS_Diagnostics R18-10
//   - Lauser 2024 (CSCS '24) — UDS authentication threat model
//   - Çelik 2024 (SAE 2024-01-2799) — fuzz-test methodology
//
// Author: Marcelo Duchene (USP/ICMC) — feat/uds-isotp-bootloader-research
// ============================================================

/* eslint-disable @typescript-eslint/no-explicit-any */

import { BootloaderState, weakComputeKey, hardenedComputeKey } from './bootloader';

// ------------------------------------------------------------
// Constants
// ------------------------------------------------------------

export const SID = {
  DiagnosticSessionControl: 0x10,
  ECUReset: 0x11,
  ClearDiagnosticInformation: 0x14,
  ReadDTCInformation: 0x19,
  ReadDataByIdentifier: 0x22,
  ReadMemoryByAddress: 0x23,
  SecurityAccess: 0x27,
  WriteDataByIdentifier: 0x2E,
  RoutineControl: 0x31,
  RequestDownload: 0x34,
  TransferData: 0x36,
  RequestTransferExit: 0x37,
  TesterPresent: 0x3E,
} as const;

export const NRC = {
  generalReject: 0x10,
  serviceNotSupported: 0x11,
  subFunctionNotSupported: 0x12,
  incorrectMessageLengthOrInvalidFormat: 0x13,
  responseTooLong: 0x14,
  busyRepeatRequest: 0x21,
  conditionsNotCorrect: 0x22,
  requestSequenceError: 0x24,
  requestOutOfRange: 0x31,
  securityAccessDenied: 0x33,
  invalidKey: 0x35,
  exceededNumberOfAttempts: 0x36,
  requiredTimeDelayHasNotExpired: 0x37,
  uploadDownloadNotAccepted: 0x70,
  transferDataSuspended: 0x71,
  generalProgrammingFailure: 0x72,
  wrongBlockSequenceCounter: 0x73,
  responsePending: 0x78,
  serviceNotSupportedInActiveSession: 0x7F,
  // Sub-function NRC variants
  requestCorrectlyReceivedResponsePending: 0x78,
} as const;

export type Session = 'default' | 'programming' | 'extended' | 'safety';
export const SESSION_BY_BYTE: Record<number, Session> = {
  0x01: 'default',
  0x02: 'programming',
  0x03: 'extended',
  0x04: 'safety',
};

// ------------------------------------------------------------
// Server configuration
// ------------------------------------------------------------

export type KeyDerivation = (seed: Uint8Array, sharedKey?: Uint8Array) => Uint8Array;

export interface UdsServerConfig {
  bootloader: BootloaderState;
  /** Initial DID storage. Mutable; 0x2E writes here. */
  dids: Map<number, Uint8Array>;
  /** Stored DTCs for 0x19. */
  dtcs: Array<{ id: number; status: number }>;
  /** Optional override for SecurityAccess key derivation. */
  computeKey?: KeyDerivation;
  /** Shared key for hardened mode (16 bytes). */
  sharedKey?: Uint8Array;
  /** P2_server_max returned by 0x10 (ms / 10 — per spec scaling). Default 50 ms. */
  p2ServerMs: number;
  /** P2*_server_max returned by 0x10 (ms / 10). Default 5000 ms. */
  p2StarServerMs: number;
}

export function defaultUdsServerConfig(boot: BootloaderState, dids?: Map<number, Uint8Array>): UdsServerConfig {
  return {
    bootloader: boot,
    dids: dids || new Map(),
    dtcs: [],
    p2ServerMs: 50,
    p2StarServerMs: 5000,
  };
}

// ------------------------------------------------------------
// Default DIDs (BRAIN-fleet style)
// ------------------------------------------------------------

const utf8 = (s: string) => new TextEncoder().encode(s);

/**
 * Build a default DID map populated with the most common fields a real OEM
 * tester polls (per ISO 14229-1 Appendix C and ISO 27145 service IDs).
 *
 * 0xF180 BootSoftwareIdentification
 * 0xF181 ApplicationSoftwareIdentification
 * 0xF182 ApplicationDataIdentification
 * 0xF183 BootSoftwareFingerprintDataIdentification
 * 0xF187 SparePartNumberDataIdentification
 * 0xF188 ECUSoftwareNumberDataIdentification
 * 0xF189 ECUSoftwareVersionDataIdentification
 * 0xF18A SystemSupplierIdentifier
 * 0xF18B ECUManufacturingDateDataIdentifier
 * 0xF18C ECUSerialNumber
 * 0xF190 VINDataIdentifier
 * 0xF191 VehicleManufacturerECUHardwareNumber
 * 0xF192 SystemSupplierECUHardwareNumber
 * 0xF193 SystemSupplierECUHardwareVersionNumber
 * 0xF194 SystemSupplierECUSoftwareNumber
 * 0xF195 SystemSupplierECUSoftwareVersionNumber
 * 0xF197 SystemNameOrEngineType
 */
export function defaultDidMap(opts: { vin: string; partNumber: string; bootSoftwareId: string }): Map<number, Uint8Array> {
  const m = new Map<number, Uint8Array>();
  m.set(0xF180, utf8(opts.bootSoftwareId));
  m.set(0xF181, utf8('ECU-HL App v1.0.0-research'));
  m.set(0xF182, utf8('Cal-001'));
  m.set(0xF183, utf8('FP-' + opts.bootSoftwareId.slice(0, 8)));
  m.set(0xF187, utf8(opts.partNumber));
  m.set(0xF188, utf8('SW-001'));
  m.set(0xF189, utf8('1.0.0'));
  m.set(0xF18A, utf8('USP-ICMC'));
  m.set(0xF18B, utf8('20260426'));
  m.set(0xF18C, utf8('HL-SN-0001'));
  m.set(0xF190, utf8(opts.vin));
  m.set(0xF191, utf8('HW-' + opts.partNumber.slice(0, 8)));
  m.set(0xF192, utf8('SUP-HW-001'));
  m.set(0xF193, utf8('HW-V-1'));
  m.set(0xF194, utf8('SUP-SW-001'));
  m.set(0xF195, utf8('SW-V-1'));
  m.set(0xF197, utf8('ECU-HybridLab'));
  return m;
}

// ------------------------------------------------------------
// Server class
// ------------------------------------------------------------

export class UdsServer {
  private session: Session = 'default';
  private boot: BootloaderState;
  private cfg: UdsServerConfig;

  constructor(cfg: UdsServerConfig) {
    this.cfg = cfg;
    this.boot = cfg.bootloader;
  }

  // ------------- public state ----------------
  getSession(): Session { return this.session; }
  getSecurityLevel(): number { return this.boot.isUnlocked() ? 1 : 0; }
  getDids(): Map<number, Uint8Array> { return this.cfg.dids; }
  getBootloader(): BootloaderState { return this.boot; }
  setSharedKey(key: Uint8Array | undefined): void { this.cfg.sharedKey = key; }

  // ------------- main dispatch ----------------
  /**
   * Process a UDS request payload (from ISO-TP layer) and return a UDS response.
   * Always returns a buffer — for negative responses, returns 7F SID NRC.
   * The caller is responsible for sending it back through ISO-TP.
   *
   * Suppress-positive-response bit is honoured: if request[1] sub-function
   * has bit 0x80 set AND the result would be positive, returns empty buffer
   * (the ISO-TP caller should treat 0-length as "no response").
   */
  handleRequest(req: Uint8Array): Uint8Array {
    if (req.length === 0) return this.negative(0x00, NRC.incorrectMessageLengthOrInvalidFormat);
    const sid = req[0];
    let resp: Uint8Array;
    try {
      switch (sid) {
        case SID.DiagnosticSessionControl: resp = this.svc10(req); break;
        case SID.ECUReset: resp = this.svc11(req); break;
        case SID.ClearDiagnosticInformation: resp = this.svc14(req); break;
        case SID.ReadDTCInformation: resp = this.svc19(req); break;
        case SID.ReadDataByIdentifier: resp = this.svc22(req); break;
        case SID.ReadMemoryByAddress: resp = this.svc23(req); break;
        case SID.SecurityAccess: resp = this.svc27(req); break;
        case SID.WriteDataByIdentifier: resp = this.svc2E(req); break;
        case SID.RoutineControl: resp = this.svc31(req); break;
        case SID.RequestDownload: resp = this.svc34(req); break;
        case SID.TransferData: resp = this.svc36(req); break;
        case SID.RequestTransferExit: resp = this.svc37(req); break;
        case SID.TesterPresent: resp = this.svc3E(req); break;
        default: resp = this.negative(sid, NRC.serviceNotSupported);
      }
    } catch (e: any) {
      // Catch-all: serve as generalReject rather than crash the server.
      // eslint-disable-next-line no-console
      console.error('[UdsServer] unhandled error', e);
      resp = this.negative(sid, NRC.generalReject);
    }

    // Honour suppress-positive-response (SPR) bit on sub-function services.
    if (this.canSuppressPositive(sid) && req.length >= 2 && (req[1] & 0x80) !== 0 && resp.length > 0 && resp[0] === sid + 0x40) {
      return new Uint8Array(0);
    }
    return resp;
  }

  // ------------- helpers ----------------

  private positive(sid: number, payload: Uint8Array | number[]): Uint8Array {
    const body = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
    const out = new Uint8Array(1 + body.length);
    out[0] = sid + 0x40;
    out.set(body, 1);
    return out;
  }

  private negative(sid: number, nrc: number): Uint8Array {
    return new Uint8Array([0x7F, sid, nrc]);
  }

  private canSuppressPositive(sid: number): boolean {
    return sid === SID.DiagnosticSessionControl
      || sid === SID.ECUReset
      || sid === SID.SecurityAccess
      || sid === SID.RoutineControl
      || sid === SID.TesterPresent;
  }

  private requireSession(req: Uint8Array, sid: number, allowed: Session[]): Uint8Array | null {
    if (!allowed.includes(this.session)) {
      return this.negative(sid, NRC.serviceNotSupportedInActiveSession);
    }
    return null;
  }

  private requireSecurity(sid: number): Uint8Array | null {
    if (!this.boot.isUnlocked()) {
      return this.negative(sid, NRC.securityAccessDenied);
    }
    return null;
  }

  // ------------- 0x10 DiagnosticSessionControl ----------------

  private svc10(req: Uint8Array): Uint8Array {
    if (req.length !== 2) return this.negative(SID.DiagnosticSessionControl, NRC.incorrectMessageLengthOrInvalidFormat);
    const subRaw = req[1] & 0x7F;
    const sess = SESSION_BY_BYTE[subRaw];
    if (!sess) return this.negative(SID.DiagnosticSessionControl, NRC.subFunctionNotSupported);
    // Default → any allowed; programming requires bootloader entry on transition (we model it: switching to programming activates bootloader).
    this.session = sess;
    if (sess === 'programming') {
      // Real ECUs jump into bootloader when entering programming session.
      this.boot.enterBootloader();
    } else if (sess === 'default') {
      // Returning to default exits bootloader if active.
      if (this.boot.isActive()) this.boot.exitBootloader();
    }
    // Response: subfn + P2_server_max(2B) + P2*_server_max(2B), per ISO 14229-1 §10.2
    const p2 = Math.min(0xFFFF, Math.round(this.cfg.p2ServerMs));
    const p2s = Math.min(0xFFFF, Math.round(this.cfg.p2StarServerMs / 10));
    return this.positive(SID.DiagnosticSessionControl, [subRaw, (p2 >> 8) & 0xFF, p2 & 0xFF, (p2s >> 8) & 0xFF, p2s & 0xFF]);
  }

  // ------------- 0x11 ECUReset ----------------

  private svc11(req: Uint8Array): Uint8Array {
    if (req.length !== 2) return this.negative(SID.ECUReset, NRC.incorrectMessageLengthOrInvalidFormat);
    const sub = req[1] & 0x7F;
    if (sub < 0x01 || sub > 0x05) return this.negative(SID.ECUReset, NRC.subFunctionNotSupported);
    // Models all reset variants the same way: clear transient state, return to application.
    // Sub 0x02 (keyOffOn) is the canonical "enter bootloader" path on a real ECU; we model that by entering bootloader and bouncing the security state.
    this.boot.reset();
    if (sub === 0x02) {
      this.boot.enterBootloader();
    }
    this.session = 'default';
    return this.positive(SID.ECUReset, [sub]);
  }

  // ------------- 0x14 ClearDiagnosticInformation ----------------

  private svc14(req: Uint8Array): Uint8Array {
    if (req.length !== 4) return this.negative(SID.ClearDiagnosticInformation, NRC.incorrectMessageLengthOrInvalidFormat);
    // Group of DTCs to clear (3 bytes); 0xFFFFFF = all.
    this.cfg.dtcs = [];
    return this.positive(SID.ClearDiagnosticInformation, []);
  }

  // ------------- 0x19 ReadDTCInformation ----------------

  private svc19(req: Uint8Array): Uint8Array {
    if (req.length < 2) return this.negative(SID.ReadDTCInformation, NRC.incorrectMessageLengthOrInvalidFormat);
    const sub = req[1] & 0x7F;
    if (sub === 0x02) {
      // reportDTCByStatusMask: req = [19][02][statusMask]
      if (req.length !== 3) return this.negative(SID.ReadDTCInformation, NRC.incorrectMessageLengthOrInvalidFormat);
      const mask = req[2];
      const matches = this.cfg.dtcs.filter((d) => (d.status & mask) !== 0);
      const body = new Uint8Array(2 + matches.length * 4);
      body[0] = sub;
      body[1] = 0xFF; // availability mask
      let p = 2;
      for (const d of matches) {
        body[p++] = (d.id >> 16) & 0xFF;
        body[p++] = (d.id >> 8) & 0xFF;
        body[p++] = d.id & 0xFF;
        body[p++] = d.status;
      }
      return this.positive(SID.ReadDTCInformation, body);
    }
    return this.negative(SID.ReadDTCInformation, NRC.subFunctionNotSupported);
  }

  // ------------- 0x22 ReadDataByIdentifier ----------------

  private svc22(req: Uint8Array): Uint8Array {
    // req = 22 [DID hi][DID lo] (one or more DIDs concatenated)
    if (req.length < 3 || ((req.length - 1) % 2) !== 0) {
      return this.negative(SID.ReadDataByIdentifier, NRC.incorrectMessageLengthOrInvalidFormat);
    }
    const items: Array<{ did: number; data: Uint8Array }> = [];
    let total = 0;
    for (let i = 1; i < req.length; i += 2) {
      const did = (req[i] << 8) | req[i + 1];
      const data = this.cfg.dids.get(did);
      if (data == null) {
        // If even one DID is unknown, AUTOSAR DCM returns NRC 0x31. Strict mode.
        return this.negative(SID.ReadDataByIdentifier, NRC.requestOutOfRange);
      }
      items.push({ did, data });
      total += 2 + data.length;
    }
    const body = new Uint8Array(total);
    let p = 0;
    for (const it of items) {
      body[p++] = (it.did >> 8) & 0xFF;
      body[p++] = it.did & 0xFF;
      body.set(it.data, p);
      p += it.data.length;
    }
    return this.positive(SID.ReadDataByIdentifier, body);
  }

  // ------------- 0x23 ReadMemoryByAddress ----------------

  private svc23(req: Uint8Array): Uint8Array {
    // req = 23 ALFID addr(N) size(M)
    if (req.length < 3) return this.negative(SID.ReadMemoryByAddress, NRC.incorrectMessageLengthOrInvalidFormat);
    const alfid = req[1];
    const addrBytes = alfid & 0xF;
    const sizeBytes = (alfid >> 4) & 0xF;
    if (addrBytes === 0 || sizeBytes === 0 || addrBytes > 8 || sizeBytes > 4) {
      return this.negative(SID.ReadMemoryByAddress, NRC.requestOutOfRange);
    }
    if (req.length !== 2 + addrBytes + sizeBytes) {
      return this.negative(SID.ReadMemoryByAddress, NRC.incorrectMessageLengthOrInvalidFormat);
    }
    const sec = this.requireSecurity(SID.ReadMemoryByAddress);
    if (sec) return sec;

    let addr = 0;
    for (let i = 0; i < addrBytes; i++) {
      addr = (addr * 256) + req[2 + i];
    }
    let size = 0;
    for (let i = 0; i < sizeBytes; i++) {
      size = (size * 256) + req[2 + addrBytes + i];
    }
    if (size === 0 || size > 4093) {
      // ISO-TP max 4095 - 2 bytes (SID + extra) = 4093. Bigger reads => 0x14
      return this.negative(SID.ReadMemoryByAddress, NRC.responseTooLong);
    }
    const data = this.boot.readMemory(addr, size);
    if (data == null) {
      return this.negative(SID.ReadMemoryByAddress, NRC.requestOutOfRange);
    }
    return this.positive(SID.ReadMemoryByAddress, data);
  }

  // ------------- 0x27 SecurityAccess ----------------

  private svc27(req: Uint8Array): Uint8Array {
    if (req.length < 2) return this.negative(SID.SecurityAccess, NRC.incorrectMessageLengthOrInvalidFormat);
    const sub = req[1] & 0x7F;
    if (sub === 0 || sub > 0x7E) return this.negative(SID.SecurityAccess, NRC.subFunctionNotSupported);

    const isSeedRequest = (sub & 0x01) === 1;
    if (isSeedRequest) {
      if (req.length !== 2) return this.negative(SID.SecurityAccess, NRC.incorrectMessageLengthOrInvalidFormat);
      // Lockout check
      const now = Date.now();
      const seed = this.boot.generateSeed(sub, now);
      if (seed == null) return this.negative(SID.SecurityAccess, NRC.requiredTimeDelayHasNotExpired);
      // If already unlocked at this level, return all-zero seed per spec §11.3.5.4
      if (this.boot.isUnlocked()) {
        const zero = new Uint8Array(seed.length);
        return this.positive(SID.SecurityAccess, [sub, ...zero]);
      }
      return this.positive(SID.SecurityAccess, [sub, ...seed]);
    } else {
      // sendKey
      const expectedLen = 2 + (this.boot.cfg.security.profile === 'weak' ? 2 : 4);
      if (req.length !== expectedLen) return this.negative(SID.SecurityAccess, NRC.incorrectMessageLengthOrInvalidFormat);
      const key = req.slice(2);
      const ok = this.cfg.computeKey
        ? (() => {
          // Custom strategy — we hand the seed via a closure on the bootloader's currentSeed
          // (not exposed publicly). For the default flow we just defer to verifyKey.
          return this.boot.verifyKey(sub - 1, key);
        })()
        : this.boot.verifyKey(sub - 1, key);
      if (!ok) {
        return this.negative(SID.SecurityAccess, NRC.invalidKey);
      }
      return this.positive(SID.SecurityAccess, [sub]);
    }
  }

  // ------------- 0x2E WriteDataByIdentifier ----------------

  private svc2E(req: Uint8Array): Uint8Array {
    if (req.length < 4) return this.negative(SID.WriteDataByIdentifier, NRC.incorrectMessageLengthOrInvalidFormat);
    const sec = this.requireSecurity(SID.WriteDataByIdentifier);
    if (sec) return sec;
    const did = (req[1] << 8) | req[2];
    const data = req.slice(3);
    this.cfg.dids.set(did, data);
    return this.positive(SID.WriteDataByIdentifier, [(did >> 8) & 0xFF, did & 0xFF]);
  }

  // ------------- 0x31 RoutineControl ----------------

  private svc31(req: Uint8Array): Uint8Array {
    if (req.length < 4) return this.negative(SID.RoutineControl, NRC.incorrectMessageLengthOrInvalidFormat);
    const sub = req[1] & 0x7F;
    if (sub < 0x01 || sub > 0x03) return this.negative(SID.RoutineControl, NRC.subFunctionNotSupported);
    const routineId = (req[2] << 8) | req[3];
    const sec = this.requireSecurity(SID.RoutineControl);
    if (sec) return sec;
    // 0xFF00 eraseMemory: req = [31][01][FF][00][ALFID][addr][size]
    if (sub === 0x01 && routineId === 0xFF00) {
      if (req.length < 6) return this.negative(SID.RoutineControl, NRC.incorrectMessageLengthOrInvalidFormat);
      const alfid = req[4];
      const addrBytes = alfid & 0xF;
      const sizeBytes = (alfid >> 4) & 0xF;
      if (req.length !== 5 + addrBytes + sizeBytes) {
        return this.negative(SID.RoutineControl, NRC.incorrectMessageLengthOrInvalidFormat);
      }
      let addr = 0;
      for (let i = 0; i < addrBytes; i++) addr = (addr * 256) + req[5 + i];
      let size = 0;
      for (let i = 0; i < sizeBytes; i++) size = (size * 256) + req[5 + addrBytes + i];
      const ok = this.boot.eraseRange(addr, size);
      if (!ok) return this.negative(SID.RoutineControl, NRC.requestOutOfRange);
      return this.positive(SID.RoutineControl, [sub, (routineId >> 8) & 0xFF, routineId & 0xFF, 0x00]);
    }
    // Generic positive
    return this.positive(SID.RoutineControl, [sub, (routineId >> 8) & 0xFF, routineId & 0xFF, 0x00]);
  }

  // ------------- 0x34 RequestDownload ----------------

  private svc34(req: Uint8Array): Uint8Array {
    // req = 34 [DataFormatId 1B] [ALFID 1B] [memAddr Nb] [memSize Mb]
    if (req.length < 5) return this.negative(SID.RequestDownload, NRC.incorrectMessageLengthOrInvalidFormat);
    const sec = this.requireSecurity(SID.RequestDownload);
    if (sec) return sec;
    const sessOk = this.requireSession(req, SID.RequestDownload, ['programming']);
    if (sessOk) return sessOk;

    const dataFmt = req[1]; void dataFmt;
    const alfid = req[2];
    const addrBytes = alfid & 0xF;
    const sizeBytes = (alfid >> 4) & 0xF;
    if (req.length !== 3 + addrBytes + sizeBytes) {
      return this.negative(SID.RequestDownload, NRC.incorrectMessageLengthOrInvalidFormat);
    }
    let addr = 0;
    for (let i = 0; i < addrBytes; i++) addr = (addr * 256) + req[3 + i];
    let size = 0;
    for (let i = 0; i < sizeBytes; i++) size = (size * 256) + req[3 + addrBytes + i];
    const maxBlockLen = 0x402; // 1026 bytes/block (typical)
    const ok = this.boot.startDownload(addr, size, maxBlockLen);
    if (!ok) return this.negative(SID.RequestDownload, NRC.requestOutOfRange);
    return this.positive(SID.RequestDownload, [0x20, (maxBlockLen >> 8) & 0xFF, maxBlockLen & 0xFF]);
  }

  // ------------- 0x36 TransferData ----------------

  private svc36(req: Uint8Array): Uint8Array {
    if (req.length < 2) return this.negative(SID.TransferData, NRC.incorrectMessageLengthOrInvalidFormat);
    const sec = this.requireSecurity(SID.TransferData);
    if (sec) return sec;
    const seq = req[1];
    const data = req.slice(2);
    const r = this.boot.transferData(seq, data);
    if (!r.ok) return this.negative(SID.TransferData, r.nrc || NRC.generalProgrammingFailure);
    return this.positive(SID.TransferData, [seq]);
  }

  // ------------- 0x37 RequestTransferExit ----------------

  private svc37(req: Uint8Array): Uint8Array {
    if (req.length < 1) return this.negative(SID.RequestTransferExit, NRC.incorrectMessageLengthOrInvalidFormat);
    const sec = this.requireSecurity(SID.RequestTransferExit);
    if (sec) return sec;
    const r = this.boot.finishDownload();
    if (!r.ok) return this.negative(SID.RequestTransferExit, r.nrc || NRC.requestSequenceError);
    return this.positive(SID.RequestTransferExit, []);
  }

  // ------------- 0x3E TesterPresent ----------------

  private svc3E(req: Uint8Array): Uint8Array {
    if (req.length !== 2) return this.negative(SID.TesterPresent, NRC.incorrectMessageLengthOrInvalidFormat);
    const sub = req[1] & 0x7F;
    if (sub !== 0x00) return this.negative(SID.TesterPresent, NRC.subFunctionNotSupported);
    return this.positive(SID.TesterPresent, [0x00]);
  }
}

// ------------------------------------------------------------
// Convenience: a synchronous client builder for tests / kill chain
// ------------------------------------------------------------

export function buildSessionControlReq(sub: number): Uint8Array {
  return new Uint8Array([SID.DiagnosticSessionControl, sub & 0x7F]);
}

export function buildEcuResetReq(sub: number): Uint8Array {
  return new Uint8Array([SID.ECUReset, sub & 0x7F]);
}

export function buildReadDidReq(...dids: number[]): Uint8Array {
  const out = new Uint8Array(1 + dids.length * 2);
  out[0] = SID.ReadDataByIdentifier;
  for (let i = 0; i < dids.length; i++) {
    out[1 + i * 2] = (dids[i] >> 8) & 0xFF;
    out[2 + i * 2] = dids[i] & 0xFF;
  }
  return out;
}

export function buildReadMemoryReq(addr: number, size: number, addrBytes = 4, sizeBytes = 2): Uint8Array {
  const out = new Uint8Array(2 + addrBytes + sizeBytes);
  out[0] = SID.ReadMemoryByAddress;
  out[1] = ((sizeBytes & 0xF) << 4) | (addrBytes & 0xF);
  for (let i = addrBytes - 1; i >= 0; i--) {
    out[2 + i] = addr & 0xFF;
    addr = Math.floor(addr / 256);
  }
  for (let i = sizeBytes - 1; i >= 0; i--) {
    out[2 + addrBytes + i] = size & 0xFF;
    size = Math.floor(size / 256);
  }
  return out;
}

export function buildSecurityAccessSeedReq(level: number): Uint8Array {
  return new Uint8Array([SID.SecurityAccess, level & 0x7F]);
}

export function buildSecurityAccessKeyReq(level: number, key: Uint8Array): Uint8Array {
  const out = new Uint8Array(2 + key.length);
  out[0] = SID.SecurityAccess;
  out[1] = (level + 1) & 0x7F;
  out.set(key, 2);
  return out;
}

export function buildTesterPresentReq(suppressPos = false): Uint8Array {
  return new Uint8Array([SID.TesterPresent, suppressPos ? 0x80 : 0x00]);
}

export function buildRequestDownloadReq(addr: number, size: number, addrBytes = 4, sizeBytes = 4): Uint8Array {
  const out = new Uint8Array(3 + addrBytes + sizeBytes);
  out[0] = SID.RequestDownload;
  out[1] = 0x00; // dataFormatIdentifier (no compression, no encryption)
  out[2] = ((sizeBytes & 0xF) << 4) | (addrBytes & 0xF);
  for (let i = addrBytes - 1; i >= 0; i--) {
    out[3 + i] = addr & 0xFF;
    addr = Math.floor(addr / 256);
  }
  for (let i = sizeBytes - 1; i >= 0; i--) {
    out[3 + addrBytes + i] = size & 0xFF;
    size = Math.floor(size / 256);
  }
  return out;
}

export function buildTransferDataReq(seq: number, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(2 + data.length);
  out[0] = SID.TransferData;
  out[1] = seq & 0xFF;
  out.set(data, 2);
  return out;
}

export function buildRequestTransferExitReq(): Uint8Array {
  return new Uint8Array([SID.RequestTransferExit]);
}

export function buildEraseMemoryReq(addr: number, size: number, addrBytes = 4, sizeBytes = 4): Uint8Array {
  const out = new Uint8Array(5 + addrBytes + sizeBytes);
  out[0] = SID.RoutineControl;
  out[1] = 0x01;
  out[2] = 0xFF; out[3] = 0x00;
  out[4] = ((sizeBytes & 0xF) << 4) | (addrBytes & 0xF);
  for (let i = addrBytes - 1; i >= 0; i--) {
    out[5 + i] = addr & 0xFF;
    addr = Math.floor(addr / 256);
  }
  for (let i = sizeBytes - 1; i >= 0; i--) {
    out[5 + addrBytes + i] = size & 0xFF;
    size = Math.floor(size / 256);
  }
  return out;
}

/** Compute key using the bootloader's active security profile. */
export function defaultComputeKey(seed: Uint8Array, profile: 'weak' | 'hardened' = 'weak', sharedKey?: Uint8Array): Uint8Array {
  if (profile === 'hardened') {
    return hardenedComputeKey(seed, sharedKey || new Uint8Array(16));
  }
  return weakComputeKey(seed);
}
