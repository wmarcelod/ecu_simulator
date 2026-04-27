// ============================================================
// Bootloader Emulation
// ============================================================
//
// Two responsibilities:
//
//   1. Track whether the simulated ECU is currently running its
//      application image or its bootloader image (state machine).
//   2. Hold a synthetic 512 KB firmware image with a recognizable
//      header so that a captured "dump" is inspectable after the
//      kill chain runs.
//
// The synthetic image is generated lazily on first access using a
// deterministic xorshift32 PRNG seeded with a fixed value so the
// produced bytes are byte-for-byte reproducible across runs (this is
// what allows the kill-chain test to assert that the dump matches the
// plant).
//
// The image starts with:
//   bytes 0..1 : 0x55 0xAA  (BootImage magic word, little-endian 0xAA55)
//   bytes 2..29: ASCII "ECU-HybridLab BootImage v1.0"  (28 bytes)
//   bytes 30..511 of header zeroed for visual cleanliness
//   byte 512..end : pseudo-random payload from xorshift32(seed=0xC0FFEE42)
//
// Author: Marcelo Duchene (USP/ICMC, dissertation feat/uds-isotp-bootloader)
// ============================================================

export type EcuRuntimeMode = 'application' | 'bootloader';

export interface BootloaderConfig {
  /** Total size of the synthetic firmware image in bytes. Default 512 KB. */
  imageSize?: number;
  /** Lowest valid memory address (default 0). */
  memBase?: number;
  /** Random seed for xorshift32 fill. */
  seed?: number;
  /** Image header magic + ASCII tag. Defaults to 'ECU-HybridLab BootImage v1.0'. */
  headerTag?: string;
}

const DEFAULT_IMAGE_SIZE = 512 * 1024; // 512 KB
const DEFAULT_HEADER_TAG = 'ECU-HybridLab BootImage v1.0';
const DEFAULT_SEED = 0xc0ffee42;

/** Deterministic 32-bit xorshift PRNG. */
export function xorshift32(seed: number): () => number {
  let state = seed >>> 0;
  if (state === 0) state = 1; // xorshift cannot start from 0
  return function next() {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state;
  };
}

/**
 * Build the deterministic 512 KB synthetic image.
 *
 * Exposed for tests so they can recompute the expected bytes
 * independently of the BootloaderState instance.
 */
export function buildSyntheticImage(
  size = DEFAULT_IMAGE_SIZE,
  seed = DEFAULT_SEED,
  headerTag = DEFAULT_HEADER_TAG,
): Uint8Array {
  if (size < 32) throw new Error(`buildSyntheticImage: size too small (${size})`);
  const out = new Uint8Array(size);

  // Magic word: 0x55 0xAA at bytes 0/1 — little-endian 0xAA55.
  out[0] = 0x55;
  out[1] = 0xaa;

  // ASCII tag immediately after.
  for (let i = 0; i < headerTag.length && 2 + i < size; i++) {
    out[2 + i] = headerTag.charCodeAt(i) & 0x7f;
  }

  // Pseudo-random fill from offset 512 onward.
  const rng = xorshift32(seed);
  for (let i = 512; i + 4 <= size; i += 4) {
    const v = rng();
    out[i + 0] = (v >>> 24) & 0xff;
    out[i + 1] = (v >>> 16) & 0xff;
    out[i + 2] = (v >>> 8) & 0xff;
    out[i + 3] = v & 0xff;
  }
  // Tail bytes if size not multiple of 4.
  if (size % 4 !== 0) {
    const tailStart = size - (size % 4);
    if (tailStart >= 512) {
      const v = rng();
      const tail = [
        (v >>> 24) & 0xff,
        (v >>> 16) & 0xff,
        (v >>> 8) & 0xff,
        v & 0xff,
      ];
      for (let i = tailStart, j = 0; i < size; i++, j++) {
        out[i] = tail[j];
      }
    }
  }
  return out;
}

/**
 * BootloaderState — runtime mode + memory map for ReadMemoryByAddress.
 */
export class BootloaderState {
  private mode: EcuRuntimeMode = 'application';
  private image: Uint8Array | null = null;
  private cfg: Required<BootloaderConfig>;
  private listeners: Array<(m: EcuRuntimeMode) => void> = [];

  constructor(cfg: BootloaderConfig = {}) {
    this.cfg = {
      imageSize: cfg.imageSize ?? DEFAULT_IMAGE_SIZE,
      memBase: cfg.memBase ?? 0x00000000,
      seed: cfg.seed ?? DEFAULT_SEED,
      headerTag: cfg.headerTag ?? DEFAULT_HEADER_TAG,
    };
  }

  /** Current runtime mode (application or bootloader). */
  getMode(): EcuRuntimeMode {
    return this.mode;
  }

  /** Whether the bootloader is currently active. */
  isActive(): boolean {
    return this.mode === 'bootloader';
  }

  /**
   * Subscribe to mode transitions (called after the change has happened).
   * Returns an unsubscribe function.
   */
  onModeChange(l: (m: EcuRuntimeMode) => void): () => void {
    this.listeners.push(l);
    return () => {
      this.listeners = this.listeners.filter((x) => x !== l);
    };
  }

  /** Switch from application to bootloader (no-op if already in boot). */
  enterBootloader(): void {
    if (this.mode === 'bootloader') return;
    this.mode = 'bootloader';
    this.listeners.forEach((l) => l('bootloader'));
  }

  /** Switch back to application (no-op if already in app). */
  exitBootloader(): void {
    if (this.mode === 'application') return;
    this.mode = 'application';
    this.listeners.forEach((l) => l('application'));
  }

  /** Memory base address. */
  getMemBase(): number {
    return this.cfg.memBase;
  }

  /** Memory size (== image size, 1:1 mapped). */
  getImageSize(): number {
    return this.cfg.imageSize;
  }

  /**
   * Read `size` bytes starting at address `addr` (absolute memory address).
   * Throws RangeError if the request is out of range.
   *
   * NOTE: We allow reads in BOTH application and bootloader modes from
   * the integration layer's perspective — the UDS server itself enforces
   * security/session preconditions via UDS NRCs. This helper is purely
   * about address arithmetic.
   */
  readMemory(addr: number, size: number): Uint8Array {
    if (size <= 0) throw new RangeError(`readMemory: size must be positive (${size})`);
    const base = this.cfg.memBase;
    const end = base + this.cfg.imageSize;
    if (addr < base || addr + size > end) {
      throw new RangeError(
        `readMemory: out of range (addr=0x${addr.toString(16)} size=${size}, image=[0x${base.toString(16)},0x${end.toString(16)}))`,
      );
    }
    const img = this.getImage();
    const offset = addr - base;
    return img.slice(offset, offset + size);
  }

  /** Get (and lazily build) the full firmware image. Mostly for tests. */
  getImage(): Uint8Array {
    if (!this.image) {
      this.image = buildSyntheticImage(this.cfg.imageSize, this.cfg.seed, this.cfg.headerTag);
    }
    return this.image;
  }

  /**
   * Compute a simple FNV-1a 32-bit hash of the current image, useful as a
   * lightweight integrity check in tests / logs.
   */
  imageHash(): number {
    const img = this.getImage();
    let h = 0x811c9dc5;
    for (let i = 0; i < img.length; i++) {
      h ^= img[i];
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }
}
