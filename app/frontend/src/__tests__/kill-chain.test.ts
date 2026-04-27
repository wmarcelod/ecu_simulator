// End-to-end UDS kill chain tests

import { describe, it, expect } from 'vitest';
import { BootloaderState } from '../lib/bootloader';
import { runKillChain, killChainLogToCsv } from '../lib/kill-chain';

describe('UDS kill-chain end-to-end', () => {
  it('reproduces the firmware image bit-for-bit (small)', async () => {
    const bl = new BootloaderState({ imageSize: 8 * 1024 });
    const result = await runKillChain({
      bootloader: bl,
      busConditionFrames: 5,
      dumpTotalBytes: 8 * 1024,
      dumpChunkBytes: 1024,
      stMin: 0,
    });

    expect(result.firmware.length).toBe(8 * 1024);
    expect(result.firmware).toEqual(bl.getImage());
    expect(result.firmwareHash).toBe(bl.imageHash());
  });

  it('phase log covers all expected phases in order', async () => {
    const bl = new BootloaderState({ imageSize: 4 * 1024 });
    const result = await runKillChain({
      bootloader: bl,
      busConditionFrames: 2,
      dumpTotalBytes: 4 * 1024,
      dumpChunkBytes: 1024,
      stMin: 0,
    });
    const names = result.phases.map((p) => p.name);
    expect(names).toEqual([
      'bus_conditioning',
      'dsc_extended',
      'dsc_programming',
      'ecu_reset_bootloader',
      'dsc_programming_post_reset',
      'security_access',
      'firmware_dump',
    ]);
  });

  it('CAN log contains UDS service identifiers in expected order', async () => {
    const bl = new BootloaderState({ imageSize: 1024 });
    const r = await runKillChain({
      bootloader: bl,
      busConditionFrames: 0,
      dumpTotalBytes: 1024,
      dumpChunkBytes: 1024,
      stMin: 0,
    });
    const services = r.log
      .map((e) => e.udsService)
      .filter((s): s is number => s !== undefined);
    expect(services).toContain(0x10);
    expect(services).toContain(0x11);
    expect(services).toContain(0x27);
    expect(services).toContain(0x23);
  });

  it('CSV export is well-formed', async () => {
    const bl = new BootloaderState({ imageSize: 2048 });
    const r = await runKillChain({
      bootloader: bl,
      busConditionFrames: 0,
      dumpTotalBytes: 2048,
      dumpChunkBytes: 512,
      stMin: 0,
    });
    const csv = killChainLogToCsv(r.log);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('timestamp_us,can_id,direction,dlc,data_hex,decoded_uds_service');
    expect(lines.length).toBeGreaterThan(10);
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',');
      expect(cols.length).toBeGreaterThanOrEqual(6);
    }
  });

  it('runs to completion with the default 512 KB image', async () => {
    const bl = new BootloaderState();
    const r = await runKillChain({
      bootloader: bl,
      busConditionFrames: 10,
      stMin: 0,
    });
    expect(r.firmware.length).toBe(512 * 1024);
    expect(r.firmware).toEqual(bl.getImage());
    expect(r.totalFrames).toBeGreaterThan(2000);
  }, 60_000);
});
