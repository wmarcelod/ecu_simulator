// Bootloader emulation tests

import { describe, it, expect } from 'vitest';
import { BootloaderState, buildSyntheticImage, xorshift32 } from '../lib/bootloader';

describe('BootloaderState — mode transitions', () => {
  it('starts in application mode', () => {
    const bl = new BootloaderState();
    expect(bl.getMode()).toBe('application');
    expect(bl.isActive()).toBe(false);
  });

  it('enterBootloader / exitBootloader transitions', () => {
    const bl = new BootloaderState();
    const events: string[] = [];
    bl.onModeChange((m) => events.push(m));
    bl.enterBootloader();
    expect(bl.getMode()).toBe('bootloader');
    bl.exitBootloader();
    expect(bl.getMode()).toBe('application');
    expect(events).toEqual(['bootloader', 'application']);
  });

  it('enterBootloader is idempotent', () => {
    const bl = new BootloaderState();
    const events: string[] = [];
    bl.onModeChange((m) => events.push(m));
    bl.enterBootloader();
    bl.enterBootloader();
    expect(events).toEqual(['bootloader']);
  });
});

describe('BootloaderState — synthetic image', () => {
  it('image starts with the BootImage magic word', () => {
    const bl = new BootloaderState();
    const head = bl.readMemory(0, 32);
    expect(head[0]).toBe(0x55);
    expect(head[1]).toBe(0xaa);
    const tag = new TextDecoder().decode(head.slice(2, 30));
    expect(tag).toContain('ECU-HybridLab');
  });

  it('full 512 KB image is produced and hash is deterministic', () => {
    const bl1 = new BootloaderState();
    const bl2 = new BootloaderState();
    expect(bl1.imageHash()).toBe(bl2.imageHash());
    expect(bl1.getImage().length).toBe(512 * 1024);
  });

  it('reads beyond image bounds throw RangeError', () => {
    const bl = new BootloaderState({ imageSize: 1024, memBase: 0 });
    expect(() => bl.readMemory(900, 200)).toThrow(RangeError);
    expect(() => bl.readMemory(0, 0)).toThrow(RangeError);
  });

  it('readMemory across the 512-byte header / payload boundary returns expected slice', () => {
    const bl = new BootloaderState();
    const slice = bl.readMemory(500, 24);
    const full = bl.getImage();
    expect(slice).toEqual(full.slice(500, 524));
  });

  it('honors a custom memBase offset', () => {
    const bl = new BootloaderState({ imageSize: 512, memBase: 0x80000000 });
    const slice = bl.readMemory(0x80000000, 32);
    expect(slice.length).toBe(32);
    expect(slice[0]).toBe(0x55);
    expect(() => bl.readMemory(0, 32)).toThrow(RangeError);
  });
});

describe('xorshift32', () => {
  it('produces deterministic stream for fixed seed', () => {
    const r1 = xorshift32(0xdead);
    const r2 = xorshift32(0xdead);
    for (let i = 0; i < 10; i++) {
      expect(r1()).toBe(r2());
    }
  });

  it('cycle does not include zero', () => {
    const rng = xorshift32(0);
    for (let i = 0; i < 1000; i++) expect(rng()).not.toBe(0);
  });
});

describe('buildSyntheticImage — independent reproducibility', () => {
  it('produces identical bytes when called with same params', () => {
    const a = buildSyntheticImage(1024, 0xc0ffee42, 'TEST_TAG');
    const b = buildSyntheticImage(1024, 0xc0ffee42, 'TEST_TAG');
    expect(a).toEqual(b);
  });

  it('produces different bytes for different seeds', () => {
    const a = buildSyntheticImage(1024, 1);
    const b = buildSyntheticImage(1024, 2);
    expect(a).not.toEqual(b);
  });
});
