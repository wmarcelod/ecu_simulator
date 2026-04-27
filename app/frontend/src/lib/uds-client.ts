// ============================================================
// UDS client — promise-based, ISO-TP backed
// ============================================================
//
// Tester-side client that talks to a remote UDS server through an
// ISO-TP stack. Single-flight (one request at a time). Every request
// is timestamped and measured (latency, bytes) to power the kill-chain
// metrics in the UI.
//
// Author: Marcelo Duchene (USP/ICMC) — feat/uds-isotp-bootloader-research
// ============================================================

import { IsoTpStack, IsoTpError, bytesToHex } from './iso-tp';
import {
  buildSessionControlReq,
  buildEcuResetReq,
  buildReadDidReq,
  buildReadMemoryReq,
  buildSecurityAccessSeedReq,
  buildSecurityAccessKeyReq,
  buildTesterPresentReq,
  buildRequestDownloadReq,
  buildTransferDataReq,
  buildRequestTransferExitReq,
  buildEraseMemoryReq,
} from './uds';

export interface UdsClientResponse {
  request: Uint8Array;
  response: Uint8Array;
  latencyMs: number;
  isPositive: boolean;
  nrc?: number;
}

export class UdsTimeoutError extends Error {
  constructor(public readonly latencyMs: number, public readonly request: Uint8Array) {
    super(`UDS request timed out after ${latencyMs}ms (req=${bytesToHex(request)})`);
    this.name = 'UdsTimeoutError';
  }
}

export class UdsClient {
  private pending: ((resp: Uint8Array) => void) | null = null;
  private pendingErr: ((err: IsoTpError | Error) => void) | null = null;
  private unsubMsg: () => void;
  private unsubErr: () => void;
  // 30s default — multi-frame ISO-TP responses (e.g. 2 KiB ReadMemoryByAddress)
  // can take several seconds in the browser due to setTimeout(0) ≈ 4 ms granularity
  // (293 CFs × 4 ms ≈ 1.2 s nominal, but Promise scheduling overhead pushes it higher).
  // 5 s was too tight — produced spurious "UDS request timed out" on the first dump
  // chunk even though the server eventually responded.
  public defaultTimeoutMs = 30000;

  constructor(
    public readonly stack: IsoTpStack,
    public readonly delay: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {
    this.unsubMsg = stack.addListener((data) => {
      const cb = this.pending;
      if (cb) { this.pending = null; this.pendingErr = null; cb(data); }
    });
    this.unsubErr = stack.onError((err) => {
      const cb = this.pendingErr;
      if (cb) { this.pending = null; this.pendingErr = null; cb(err); }
    });
  }

  dispose(): void {
    try { this.unsubMsg(); } catch (e) { void e; }
    try { this.unsubErr(); } catch (e) { void e; }
  }

  async request(req: Uint8Array, timeoutMs = this.defaultTimeoutMs): Promise<UdsClientResponse> {
    if (this.pending) throw new Error('UdsClient: previous request still pending');
    const start = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

    const respPromise = new Promise<Uint8Array>((resolve, reject) => {
      this.pending = (data) => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        resolve(data);
      };
      this.pendingErr = (err) => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        reject(err);
      };
      timeoutHandle = setTimeout(() => {
        if (this.pending) {
          this.pending = null;
          this.pendingErr = null;
          reject(new UdsTimeoutError(timeoutMs, req));
        }
      }, timeoutMs);
    });

    try {
      await this.stack.sendBuffer(req);
    } catch (e) {
      this.pending = null; this.pendingErr = null;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      throw e;
    }

    const resp = await respPromise;
    const end = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    const latencyMs = end - start;
    const isPositive = resp.length > 0 && resp[0] !== 0x7F;
    return { request: req, response: resp, latencyMs, isPositive, nrc: isPositive ? undefined : resp[2] };
  }

  diagnosticSessionControl(sub: number) { return this.request(buildSessionControlReq(sub)); }
  ecuReset(sub: number) { return this.request(buildEcuResetReq(sub)); }
  readDid(...dids: number[]) { return this.request(buildReadDidReq(...dids)); }
  readMemory(addr: number, size: number, addrBytes = 4, sizeBytes = 2) { return this.request(buildReadMemoryReq(addr, size, addrBytes, sizeBytes)); }
  securityAccessSeed(level: number) { return this.request(buildSecurityAccessSeedReq(level)); }
  securityAccessKey(level: number, key: Uint8Array) { return this.request(buildSecurityAccessKeyReq(level, key)); }
  testerPresent(suppressPos = false) { return this.request(buildTesterPresentReq(suppressPos)); }
  requestDownload(addr: number, size: number, addrBytes = 4, sizeBytes = 4) { return this.request(buildRequestDownloadReq(addr, size, addrBytes, sizeBytes)); }
  transferData(seq: number, data: Uint8Array) { return this.request(buildTransferDataReq(seq, data)); }
  requestTransferExit() { return this.request(buildRequestTransferExitReq()); }
  eraseMemory(addr: number, size: number, addrBytes = 4, sizeBytes = 4) { return this.request(buildEraseMemoryReq(addr, size, addrBytes, sizeBytes)); }
  sleep(ms: number): Promise<void> { return this.delay(ms); }
}
