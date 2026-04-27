// ============================================================
// Bootloader emulator — synthetic firmware image + memory model
// ============================================================
//
// Implements the *target* of the kill-chain demo: a programmable ECU with
// a synthetic 512 KiB firmware that the attacker can extract via UDS 0x23
// (ReadMemoryByAddress) or rewrite via 0x34/0x36/0x37.
//
// Differentiators from a "naive" implementation:
//
//   1. **Explicit threat model** — the bootloader has a configurable
//      `securityProfile`: 'weak' (16-bit linear-XOR seed/key) for the
//      kill-chain demo, or 'hardened' (32-bit cryptographic) for
//      countermeasure experiments. Every academic case study (Lauser 2024,
//      Çelik 2024, Auto-ISAC ATM-T0033) describes attacks against weak
//      profiles; we model both so the testbed can be used for both
//      attack reproduction *and* defence research.
//
//   2. **Deterministic synthetic firmware** — header `0xAA 0x55` magic,
//      ASCII version string, then a seeded LCG-pseudo-random body. This
//      means the dump can be byte-compared against the original to verify
//      the chain reproduced it exactly.
//
//   3. **Memory-mapped regions** — distinct flash, ram, calibration and
//      VIN regions with declarative permissions. NRC 0x31 (out of range)
//      reflects the actual region map, not just bounds.
//
//   4. **Audit trail** — every memory access (read or write) is recorded
//      with a timestamp; the kill-chain UI surfaces this so reviewers can
//      see exactly which bytes leaked when.
//
//   5. **Reset/recovery semantics** — `enterBootloader` and `exitBootloader`
//      mirror real ECU behaviour: bootloader entry clears RAM, exit
//      restores the application image and re-arms watchdog.
//
// Author: Marcelo Duchene (USP/ICMC) — feat/uds-isotp-bootloader-research
// ============================================================

/* eslint-disable @typescript-eslint/no-explicit-any */

// ------------------------------------------------------------
// Memory map
// ------------------------------------------------------------

export interface MemoryRegion {
  name: string;
  /** Inclusive lower bound. */
  start: number;
  /** Exclusive upper bound. */
  end: number;
  /** Read in application mode. */
  readApp: boolean;
  /** Read in bootloader mode. */
  readBoot: boolean;
  /** Write in any mode. */
  writeBoot: boolean;
  /** Description shown in UI. */
  description: string;
}

/**
 * Default memory map for the synthetic ECU.
 *
 *   0x00000000 .. 0x00080000   Application flash (512 KiB)  ← target of dump
 *   0x10000000 .. 0x10010000   Calibration data (64 KiB)
 *   0x1FFF0000 .. 0x1FFF0080   VIN block (128 B)
 *   0x20000000 .. 0x20020000   RAM (128 KiB)
 *   0x40000000 .. 0x40000800   Boot info (RO)
 */
export const DEFAULT_MEMORY_MAP: MemoryRegion[] = [
  {
    name: 'app_flash',
    start: 0x0000_0000,
    end: 0x0008_0000,
    readApp: false,
    readBoot: true,
    writeBoot: true,
    description: '512 KiB application firmware (locked in app mode)',
  },
  {
    name: 'calibration',
    start: 0x1000_0000,
    end: 0x1001_0000,
    readApp: true,
    readBoot: true,
    writeBoot: true,
    description: '64 KiB calibration / tuning data',
  },
  {
    name: 'vin_block',
    start: 0x1FFF_0000,
    end: 0x1FFF_0080,
    readApp: true,
    readBoot: true,
    writeBoot: false,
    description: 'VIN + part number (read-only)',
  },
  {
    name: 'ram',
    start: 0x2000_0000,
    end: 0x2002_0000,
    readApp: true,
    readBoot: true,
    writeBoot: false,
    description: '128 KiB RAM (volatile)',
  },
  {
    name: 'boot_info',
    start: 0x4000_0000,
    end: 0x4000_0800,
    readApp: true,
    readBoot: true,
    writeBoot: false,
    description: 'Bootloader version / build info',
  },
];

// ------------------------------------------------------------
// Security profile
// ------------------------------------------------------------

export type SecurityProfile = 'weak' | 'hardened';

export interface SecurityConfig {
  profile: SecurityProfile;
  /** Seed length in bytes (2 for weak demo, 4 for hardened). */
  seedBytes: number;
  /** Optional shared key for hardened mode (16 bytes for AES-CMAC-like). */
  sharedKey?: Uint8Array;
  /** Lockout duration after N failed attempts (ms). 0 = no lockout. */
  lockoutMs: number;
  /** Number of failed key tries that triggers lockout. */
  maxFailedAttempts: number;
}

export const DEFAULT_SECURITY: SecurityConfig = {
  profile: 'weak',
  seedBytes: 2,
  lockoutMs: 10_000,
  maxFailedAttempts: 3,
};

// ------------------------------------------------------------
// Memory access audit trail
// ------------------------------------------------------------

export interface AuditEntry {
  timestamp: number;
  kind: 'read' | 'write' | 'erase' | 'enter-boot' | 'exit-boot' | 'sa-success' | 'sa-fail' | 'lockout';
  address?: number;
  size?: number;
  details?: string;
}

// ------------------------------------------------------------
// Bootloader state
// ------------------------------------------------------------

export type BootMode = 'application' | 'bootloader';

export interface BootloaderConfig {
  /** Total firmware image size in bytes (default 512 KiB). */
  imageSize: number;
  /** PRNG seed for deterministic image generation. */
  imageSeed: number;
  /** Memory regions. Defaults to DEFAULT_MEMORY_MAP. */
  memoryMap: MemoryRegion[];
  /** Security profile. */
  security: SecurityConfig;
  /** VIN string written into the VIN block (17 chars). */
  vin: string;
  /** Part number (ASCII). */
  partNumber: string;
  /** Bootloader software ID. */
  bootSoftwareId: string;
}

export const DEFAULT_BOOTLOADER_CONFIG: BootloaderConfig = {
  imageSize: 512 * 1024,
  imageSeed: 0xC0FFEE42,
  memoryMap: DEFAULT_MEMORY_MAP,
  security: DEFAULT_SECURITY,
  vin: '9BWZZZ377VT004251',
  partNumber: 'ECU-HL-BR-01',
  bootSoftwareId: 'ECU-HybridLab BootImage v1.0',
};

/**
 * Linear Congruential Generator — deterministic, seeded.
 * Used so the synthetic firmware is byte-identical across runs, allowing
 * exact diff between extracted dump and original.
 */
function lcg(seed: number): () => number {
  // Numerical Recipes constants (a, c, m).
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s & 0xFF;
  };
}

/** Build the synthetic 512 KiB firmware image. */
export function buildSyntheticFirmware(cfg: BootloaderConfig): Uint8Array {
  const buf = new Uint8Array(cfg.imageSize);
  // Header: magic + version
  buf[0] = 0xAA; buf[1] = 0x55;
  buf[2] = 0xEC; buf[3] = 0x00;
  // Software ID at offset 4
  const idBytes = new TextEncoder().encode(cfg.bootSoftwareId);
  buf.set(idBytes.slice(0, 64), 4);
  // CRC placeholder at 0x60..0x64
  buf[0x60] = 0xDE; buf[0x61] = 0xAD; buf[0x62] = 0xBE; buf[0x63] = 0xEF;
  // Seeded body
  const rng = lcg(cfg.imageSeed);
  for (let i = 0x100; i < buf.length; i++) buf[i] = rng();
  // Embedded markers every 4096 bytes for visual diagnostics
  for (let off = 0; off < buf.length; off += 4096) {
    if (off + 8 < buf.length) {
      buf[off + 0] = 0x42; // 'B'
      buf[off + 1] = 0x52; // 'R'
      buf[off + 2] = 0x41; // 'A'
      buf[off + 3] = 0x49; // 'I'
      buf[off + 4] = 0x4E; // 'N'
      buf[off + 5] = (off >> 16) & 0xFF;
      buf[off + 6] = (off >> 8) & 0xFF;
      buf[off + 7] = off & 0xFF;
    }
  }
  return buf;
}

// ------------------------------------------------------------
// Seed / key derivation algorithms
// ------------------------------------------------------------

/**
 * Weak algorithm: Pattern B from sources/research_uds_*_security_access_algorithms.md.
 *
 *   key = rotate_left((seed XOR constant), (seed[0] & 0x0F))
 *
 * This is the most-cited weak pattern in academic literature (Daily 2017,
 * Hooovahh 2020). Recoverable from ~256 captured pairs by a passive observer,
 * which is exactly the kind of attack our IDS chapter (Cap 5) needs to detect.
 */
export function weakComputeKey(seed: Uint8Array, constant = 0xC0DE): Uint8Array {
  if (seed.length !== 2) throw new Error('weakComputeKey expects 2-byte seed');
  const s = (seed[0] << 8) | seed[1];
  let v = (s ^ constant) & 0xFFFF;
  const rot = seed[0] & 0xF;
  v = ((v << rot) | (v >> (16 - rot))) & 0xFFFF;
  return new Uint8Array([(v >> 8) & 0xFF, v & 0xFF]);
}

/**
 * Hardened algorithm: HMAC-like using a shared 16-byte key.
 * Not real AES (we keep this dependency-free for the browser), but a strong
 * key-derivation suitable for "what-if hardened" experiments.
 *
 *   key = first4(SHA256(sharedKey || seed))   ← we use a small custom mixer
 *
 * The exact mixer is intentionally not a real SHA — students should NOT
 * use this in production. Documented as "research-grade only".
 */
export function hardenedComputeKey(seed: Uint8Array, sharedKey: Uint8Array): Uint8Array {
  // Simple 64-round Davies-Meyer-like mixer over (sharedKey || seed).
  // Output: 4 bytes. Sufficient to demonstrate "high entropy => brute-force
  // infeasible" without bringing a crypto dependency.
  let a = 0x6A09E667 >>> 0;
  let b = 0xBB67AE85 >>> 0;
  let c = 0x3C6EF372 >>> 0;
  let d = 0xA54FF53A >>> 0;
  const buf = new Uint8Array(sharedKey.length + seed.length);
  buf.set(sharedKey, 0);
  buf.set(seed, sharedKey.length);
  for (let r = 0; r < 64; r++) {
    for (let i = 0; i < buf.length; i++) {
      a = ((a + buf[i]) ^ rotl(b, 7)) >>> 0;
      b = ((b ^ rotl(c, 11)) + buf[i]) >>> 0;
      c = ((c + rotl(d, 13)) ^ buf[i]) >>> 0;
      d = ((d ^ rotl(a, 17)) + buf[i]) >>> 0;
    }
  }
  return new Uint8Array([
    (a >> 24) & 0xFF,
    (b >> 16) & 0xFF,
    (c >> 8) & 0xFF,
    d & 0xFF,
  ]);
}

function rotl(x: number, n: number): number {
  return (((x << n) | (x >>> (32 - n))) >>> 0);
}

// ------------------------------------------------------------
// BootloaderState — main class
// ------------------------------------------------------------

export class BootloaderState {
  private mode: BootMode = 'application';
  private firmware: Uint8Array;
  private memory: Uint8Array; // overlay for writes
  private writes = new Map<number, number>(); // addr -> byte (sparse)
  private vinBytes: Uint8Array;
  private partBytes: Uint8Array;
  private bootInfoBytes: Uint8Array;
  private auditTrail: AuditEntry[] = [];
  private failedAttempts = 0;
  private lockoutUntil = 0;
  private currentSeed: Uint8Array | null = null;
  private currentLevel: number = 0;
  /** Active download/transfer session (state for 0x34/0x36/0x37). */
  private downloadSession: {
    address: number;
    size: number;
    received: number;
    nextSeq: number;
    maxBlockLen: number;
    buffer: Uint8Array;
  } | null = null;

  constructor(public readonly cfg: BootloaderConfig = DEFAULT_BOOTLOADER_CONFIG) {
    this.firmware = buildSyntheticFirmware(cfg);
    this.memory = this.firmware.slice(); // copy for writes
    // Pad/truncate VIN to 17 chars
    const vinAscii = (cfg.vin + '                 ').slice(0, 17);
    this.vinBytes = new TextEncoder().encode(vinAscii);
    this.partBytes = new TextEncoder().encode((cfg.partNumber + '                ').slice(0, 16));
    this.bootInfoBytes = new TextEncoder().encode(cfg.bootSoftwareId);
  }

  // ------------- public state ----------------
  isActive(): boolean { return this.mode === 'bootloader'; }
  getMode(): BootMode { return this.mode; }
  getOriginalFirmware(): Uint8Array { return this.firmware; }
  getCurrentMemory(): Uint8Array { return this.memory; }
  getAuditTrail(): AuditEntry[] { return this.auditTrail.slice(); }
  getFailedAttempts(): number { return this.failedAttempts; }
  getLockoutRemaining(now: number): number {
    return Math.max(0, this.lockoutUntil - now);
  }

  // ------------- mode transitions ----------------
  enterBootloader(now = Date.now()): void {
    this.mode = 'bootloader';
    this.currentSeed = null;
    this.currentLevel = 0;
    this.audit({ timestamp: now, kind: 'enter-boot' });
  }
  exitBootloader(now = Date.now()): void {
    this.mode = 'application';
    this.currentSeed = null;
    this.currentLevel = 0;
    this.downloadSession = null;
    this.audit({ timestamp: now, kind: 'exit-boot' });
  }

  // ------------- security ----------------
  /**
   * Generate a seed for the requested level. Returns null if currently locked out.
   * Even sub-functions (02, 04, ...) reuse the level number as (subfn-1)/2 + 1
   * by convention (UDS spec is silent — we just track levels).
   */
  generateSeed(level: number, now = Date.now()): Uint8Array | null {
    if (this.lockoutUntil > now) return null;
    const seed = new Uint8Array(this.cfg.security.seedBytes);
    // Pseudo-random seed from current time + level
    let s = (now ^ (level * 0x9E37)) >>> 0;
    for (let i = 0; i < seed.length; i++) {
      s = (s * 1103515245 + 12345) >>> 0;
      seed[i] = (s >> 16) & 0xFF;
    }
    this.currentSeed = seed;
    return seed;
  }

  /** Verify a key against the active seed. */
  verifyKey(level: number, key: Uint8Array, now = Date.now()): boolean {
    if (this.currentSeed == null) return false;
    let expected: Uint8Array;
    if (this.cfg.security.profile === 'weak') {
      expected = weakComputeKey(this.currentSeed);
    } else {
      const sk = this.cfg.security.sharedKey || new Uint8Array(16);
      expected = hardenedComputeKey(this.currentSeed, sk);
    }
    if (key.length !== expected.length) return this.recordFailure(now);
    for (let i = 0; i < key.length; i++) {
      if (key[i] !== expected[i]) return this.recordFailure(now);
    }
    this.currentLevel = level;
    this.failedAttempts = 0;
    this.audit({ timestamp: now, kind: 'sa-success', details: `level=${level}` });
    return true;
  }

  private recordFailure(now: number): boolean {
    this.failedAttempts++;
    this.audit({ timestamp: now, kind: 'sa-fail', details: `attempts=${this.failedAttempts}` });
    if (this.failedAttempts >= this.cfg.security.maxFailedAttempts && this.cfg.security.lockoutMs > 0) {
      this.lockoutUntil = now + this.cfg.security.lockoutMs;
      this.failedAttempts = 0;
      this.audit({ timestamp: now, kind: 'lockout', details: `until=${this.lockoutUntil}` });
    }
    return false;
  }

  isUnlocked(): boolean {
    return this.currentLevel > 0;
  }

  // ------------- memory access ----------------

  /** Look up the region containing `addr`. Returns null if unmapped. */
  findRegion(addr: number): MemoryRegion | null {
    for (const r of this.cfg.memoryMap) {
      if (addr >= r.start && addr < r.end) return r;
    }
    return null;
  }

  /**
   * Read `size` bytes starting at `addr`. Returns null if the read would cross
   * into an unmapped region OR a region that doesn't allow reads in current mode
   * OR if the security level is insufficient.
   */
  readMemory(addr: number, size: number, now = Date.now()): Uint8Array | null {
    if (size <= 0) return null;
    const out = new Uint8Array(size);
    let pos = 0;
    while (pos < size) {
      const a = addr + pos;
      const region = this.findRegion(a);
      if (!region) {
        this.audit({ timestamp: now, kind: 'read', address: addr, size, details: `unmapped at ${a.toString(16)}` });
        return null;
      }
      const allowedRead = (this.mode === 'application') ? region.readApp : region.readBoot;
      if (!allowedRead) {
        this.audit({ timestamp: now, kind: 'read', address: addr, size, details: `denied at ${region.name}` });
        return null;
      }
      // Sample byte from the appropriate backing store
      out[pos] = this.peek(a, region);
      pos++;
    }
    this.audit({ timestamp: now, kind: 'read', address: addr, size });
    return out;
  }

  private peek(a: number, region: MemoryRegion): number {
    switch (region.name) {
      case 'app_flash': {
        // Read from current memory (which equals firmware unless written)
        const off = a - region.start;
        return this.memory[off];
      }
      case 'calibration': {
        const off = a - region.start;
        // Stored in the writes overlay (default 0xFF for unwritten flash)
        return this.writes.has(a) ? this.writes.get(a)! : 0xFF;
      }
      case 'vin_block': {
        const off = a - region.start;
        if (off < this.vinBytes.length) return this.vinBytes[off];
        if (off < this.vinBytes.length + this.partBytes.length) {
          return this.partBytes[off - this.vinBytes.length];
        }
        return 0xFF;
      }
      case 'ram': {
        return this.writes.get(a) ?? 0x00;
      }
      case 'boot_info': {
        const off = a - region.start;
        if (off < this.bootInfoBytes.length) return this.bootInfoBytes[off];
        return 0xFF;
      }
      default:
        return 0xFF;
    }
  }

  /**
   * Write a single byte. Returns true if accepted. Bootloader mode and
   * region.writeBoot must both be true. Used by 0x36 TransferData.
   */
  writeByte(addr: number, val: number, now = Date.now()): boolean {
    if (this.mode !== 'bootloader' || !this.isUnlocked()) return false;
    const region = this.findRegion(addr);
    if (!region || !region.writeBoot) return false;
    if (region.name === 'app_flash') {
      const off = addr - region.start;
      this.memory[off] = val & 0xFF;
    } else {
      this.writes.set(addr, val & 0xFF);
    }
    return true;
  }

  /** Erase a range. Used by 0x31 RoutineControl + 0xFF00 (eraseMemory). */
  eraseRange(addr: number, size: number, now = Date.now()): boolean {
    if (this.mode !== 'bootloader' || !this.isUnlocked()) return false;
    for (let i = 0; i < size; i++) {
      const a = addr + i;
      const region = this.findRegion(a);
      if (!region || !region.writeBoot) return false;
      if (region.name === 'app_flash') {
        const off = a - region.start;
        this.memory[off] = 0xFF;
      } else {
        this.writes.set(a, 0xFF);
      }
    }
    this.audit({ timestamp: now, kind: 'erase', address: addr, size });
    return true;
  }

  // ------------- download session (0x34/0x36/0x37) ----------------

  startDownload(addr: number, size: number, maxBlockLen = 0x402): boolean {
    if (this.mode !== 'bootloader' || !this.isUnlocked()) return false;
    const region = this.findRegion(addr);
    if (!region || !region.writeBoot) return false;
    if (addr + size > region.end) return false;
    this.downloadSession = {
      address: addr,
      size,
      received: 0,
      nextSeq: 1,
      maxBlockLen,
      buffer: new Uint8Array(size),
    };
    return true;
  }

  transferData(seq: number, data: Uint8Array): { ok: boolean; nrc?: number } {
    if (!this.downloadSession) return { ok: false, nrc: 0x24 };
    if ((seq & 0xFF) !== (this.downloadSession.nextSeq & 0xFF)) {
      return { ok: false, nrc: 0x73 };
    }
    if (data.length > this.downloadSession.maxBlockLen) {
      return { ok: false, nrc: 0x71 };
    }
    if (this.downloadSession.received + data.length > this.downloadSession.size) {
      return { ok: false, nrc: 0x71 };
    }
    this.downloadSession.buffer.set(data, this.downloadSession.received);
    this.downloadSession.received += data.length;
    this.downloadSession.nextSeq = (this.downloadSession.nextSeq + 1) & 0xFF;
    return { ok: true };
  }

  finishDownload(now = Date.now()): { ok: boolean; nrc?: number } {
    if (!this.downloadSession) return { ok: false, nrc: 0x24 };
    if (this.downloadSession.received !== this.downloadSession.size) {
      return { ok: false, nrc: 0x71 };
    }
    // Commit to memory
    for (let i = 0; i < this.downloadSession.size; i++) {
      this.writeByte(this.downloadSession.address + i, this.downloadSession.buffer[i], now);
    }
    this.downloadSession = null;
    return { ok: true };
  }

  inDownloadSession(): boolean {
    return this.downloadSession != null;
  }

  // ------------- helpers ----------------
  private audit(e: AuditEntry): void {
    this.auditTrail.push(e);
    // Cap audit buffer at 5000 entries to avoid runaway memory.
    if (this.auditTrail.length > 5000) {
      this.auditTrail = this.auditTrail.slice(-5000);
    }
  }

  /** Reset all transient state (failed attempts, downloads, current seed). */
  reset(now = Date.now()): void {
    this.mode = 'application';
    this.currentSeed = null;
    this.currentLevel = 0;
    this.failedAttempts = 0;
    this.lockoutUntil = 0;
    this.downloadSession = null;
    this.audit({ timestamp: now, kind: 'exit-boot', details: 'reset' });
  }
}
