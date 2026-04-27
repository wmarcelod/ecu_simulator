// ============================================================
// BootloaderState tests
// ============================================================
import { describe, expect, it } from 'vitest';
import {
  BootloaderState,
  buildSyntheticFirmware,
  weakComputeKey,
  hardenedComputeKey,
  DEFAULT_BOOTLOADER_CONFIG,
  DEFAULT_MEMORY_MAP,
} from '../lib/bootloader';

describe('Synthetic firmware image', () => {
  it('is deterministic across calls', () => {
    const a = buildSyntheticFirmware(DEFAULT_BOOTLOADER_CONFIG);
    const b = buildSyntheticFirmware(DEFAULT_BOOTLOADER_CONFIG);
    expect(a.length).toBe(512 * 1024);
    expect(Array.from(a.slice(0, 16))).toEqual(Array.from(b.slice(0, 16)));
    // Check magic header
    expect(a[0]).toBe(0xAA);
    expect(a[1]).toBe(0x55);
  });

  it('contains BRAIN markers every 4096 bytes', () => {
    const fw = buildSyntheticFirmware(DEFAULT_BOOTLOADER_CONFIG);
    // marker at offset 4096: 'B' 'R' 'A' 'I' 'N' + 3 bytes of offset
    expect(fw[4096]).toBe(0x42); // 'B'
    expect(fw[4097]).toBe(0x52); // 'R'
    expect(fw[4098]).toBe(0x41); // 'A'
    expect(fw[4099]).toBe(0x49); // 'I'
    expect(fw[4100]).toBe(0x4E); // 'N'
  });
});

describe('Weak SecurityAccess (Pattern B: XOR + rotate)', () => {
  it('produces deterministic key for given seed', () => {
    const seed = new Uint8Array([0x12, 0x34]);
    const k1 = weakComputeKey(seed);
    const k2 = weakComputeKey(seed);
    expect(Array.from(k1)).toEqual(Array.from(k2));
  });

  it('rotates by seed[0] low nibble (different rotation per seed)', () => {
    const k1 = weakComputeKey(new Uint8Array([0x10, 0x00]));
    const k2 = weakComputeKey(new Uint8Array([0x20, 0x00]));
    expect(Array.from(k1)).not.toEqual(Array.from(k2));
  });

  it('throws on non-2-byte seed', () => {
    expect(() => weakComputeKey(new Uint8Array(4))).toThrow();
  });
});

describe('Hardened SecurityAccess (mixer)', () => {
  it('is sensitive to shared key', () => {
    const seed = new Uint8Array([0x12, 0x34, 0x56, 0x78]);
    const sk1 = new Uint8Array(16); for (let i = 0; i < 16; i++) sk1[i] = i;
    const sk2 = new Uint8Array(16); for (let i = 0; i < 16; i++) sk2[i] = i + 1;
    const k1 = hardenedComputeKey(seed, sk1);
    const k2 = hardenedComputeKey(seed, sk2);
    expect(k1.length).toBe(4);
    expect(Array.from(k1)).not.toEqual(Array.from(k2));
  });
});

describe('BootloaderState — mode transitions', () => {
  it('starts in application mode', () => {
    const b = new BootloaderState();
    expect(b.getMode()).toBe('application');
    expect(b.isActive()).toBe(false);
  });

  it('enterBootloader switches to boot mode', () => {
    const b = new BootloaderState();
    b.enterBootloader(0);
    expect(b.getMode()).toBe('bootloader');
    expect(b.isActive()).toBe(true);
  });

  it('reset returns to application + clears unlock', () => {
    const b = new BootloaderState();
    b.enterBootloader(0);
    const seed = b.generateSeed(1, 0);
    expect(seed).not.toBeNull();
    b.verifyKey(1, weakComputeKey(seed!), 0);
    expect(b.isUnlocked()).toBe(true);
    b.reset(0);
    expect(b.getMode()).toBe('application');
    expect(b.isUnlocked()).toBe(false);
  });
});

describe('BootloaderState — security access', () => {
  it('seed -> compute key -> verify unlocks', () => {
    const b = new BootloaderState();
    b.enterBootloader(0);
    const seed = b.generateSeed(1, 0)!;
    const key = weakComputeKey(seed);
    expect(b.verifyKey(1, key, 0)).toBe(true);
    expect(b.isUnlocked()).toBe(true);
  });

  it('wrong key fails and increments failedAttempts', () => {
    const b = new BootloaderState();
    b.enterBootloader(0);
    b.generateSeed(1, 0);
    expect(b.verifyKey(1, new Uint8Array([0, 0]), 0)).toBe(false);
    expect(b.getFailedAttempts()).toBe(1);
  });

  it('triggers lockout after maxFailedAttempts', () => {
    const b = new BootloaderState({
      ...DEFAULT_BOOTLOADER_CONFIG,
      security: { ...DEFAULT_BOOTLOADER_CONFIG.security, maxFailedAttempts: 2, lockoutMs: 5000 },
    });
    b.enterBootloader(0);
    b.generateSeed(1, 0);
    b.verifyKey(1, new Uint8Array([0, 0]), 0);
    b.generateSeed(1, 1);
    b.verifyKey(1, new Uint8Array([0, 0]), 1);
    expect(b.generateSeed(1, 2)).toBeNull(); // locked out
    expect(b.getLockoutRemaining(2)).toBeGreaterThan(0);
  });
});

describe('BootloaderState — readMemory', () => {
  it('reads from app_flash in bootloader mode (allowed)', () => {
    const b = new BootloaderState();
    b.enterBootloader(0);
    const seed = b.generateSeed(1, 0)!;
    b.verifyKey(1, weakComputeKey(seed), 0);
    const data = b.readMemory(0, 16);
    expect(data).not.toBeNull();
    expect(data!.length).toBe(16);
    expect(data![0]).toBe(0xAA);
    expect(data![1]).toBe(0x55);
  });

  it('returns null for unmapped address', () => {
    const b = new BootloaderState();
    b.enterBootloader(0);
    expect(b.readMemory(0xFFFFFFF0, 4)).toBeNull();
  });

  it('VIN region returns the configured VIN bytes', () => {
    const b = new BootloaderState({ ...DEFAULT_BOOTLOADER_CONFIG, vin: 'TEST123456789ABCD' });
    b.enterBootloader(0);
    const data = b.readMemory(0x1FFF0000, 17);
    expect(data).not.toBeNull();
    expect(new TextDecoder().decode(data!)).toBe('TEST123456789ABCD');
  });
});

describe('BootloaderState — download session (0x34/0x36/0x37)', () => {
  it('startDownload + transferData + finishDownload commits to memory', () => {
    const b = new BootloaderState();
    b.enterBootloader(0);
    const seed = b.generateSeed(1, 0)!;
    b.verifyKey(1, weakComputeKey(seed), 0);
    expect(b.startDownload(0, 8)).toBe(true);
    const r1 = b.transferData(1, new Uint8Array([1, 2, 3, 4]));
    expect(r1.ok).toBe(true);
    const r2 = b.transferData(2, new Uint8Array([5, 6, 7, 8]));
    expect(r2.ok).toBe(true);
    const r3 = b.finishDownload();
    expect(r3.ok).toBe(true);
    const back = b.readMemory(0, 8);
    expect(Array.from(back!)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('rejects out-of-sequence block', () => {
    const b = new BootloaderState();
    b.enterBootloader(0);
    const seed = b.generateSeed(1, 0)!;
    b.verifyKey(1, weakComputeKey(seed), 0);
    expect(b.startDownload(0, 16)).toBe(true);
    expect(b.transferData(1, new Uint8Array(8)).ok).toBe(true);
    const r = b.transferData(99, new Uint8Array(8));
    expect(r.ok).toBe(false);
  });
});

describe('Memory map — region permissions', () => {
  it('app_flash is NOT readable in application mode', () => {
    const b = new BootloaderState();
    expect(b.findRegion(0x1000)?.readApp).toBe(false);
    expect(b.readMemory(0x1000, 4)).toBeNull();
  });

  it('vin_block IS readable in application mode', () => {
    const b = new BootloaderState();
    expect(b.findRegion(0x1FFF0000)?.readApp).toBe(true);
    expect(b.readMemory(0x1FFF0000, 4)).not.toBeNull();
  });

  it('default memory map has 5 regions', () => {
    expect(DEFAULT_MEMORY_MAP.length).toBe(5);
  });
});
