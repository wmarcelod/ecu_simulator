// ============================================================
// Kill chain end-to-end tests
// ============================================================
import { describe, expect, it } from 'vitest';
import { ECUSimulator } from '../lib/ecu-simulator';
import { hash32 } from '../lib/kill-chain';

describe('Kill chain — fast scenario, small dump', () => {
  it('completes end-to-end and verifies dump byte-for-byte', async () => {
    const sim = new ECUSimulator('sedan');
    // Use a small dump for fast CI: 4096 bytes (one chunk of one service call)
    const { report, csv } = await sim.runKillChain({
      scenario: 'fast',
      dumpAddress: 0,
      dumpSize: 4096,
      chunkSize: 4096,
    });
    expect(report.error).toBeUndefined();
    expect(report.dumpedBytes).toBe(4096);
    expect(report.verified).toBe(true);
    expect(report.dumpChecksum).toBe(report.expectedChecksum);
    // CSV has at least the kill-chain frames
    expect(csv.split('\n').length).toBeGreaterThan(20);
    expect(csv.split('\n')[0]).toBe('timestamp_us,can_id,direction,dlc,data_hex,decoded_uds_service');
  }, 30_000);

  it('phases all completed in order', async () => {
    const sim = new ECUSimulator('sedan');
    const { report } = await sim.runKillChain({
      scenario: 'fast',
      dumpAddress: 0,
      dumpSize: 1024,
      chunkSize: 1024,
    });
    const phaseNames = report.phases.map((p) => p.phase);
    // init, conditioning, recon, session, reset, security, dump, cleanup, verify, done
    expect(phaseNames).toContain('init');
    expect(phaseNames).toContain('conditioning');
    expect(phaseNames).toContain('recon');
    expect(phaseNames).toContain('session');
    expect(phaseNames).toContain('reset');
    expect(phaseNames).toContain('security');
    expect(phaseNames).toContain('dump');
    expect(phaseNames).toContain('cleanup');
    expect(phaseNames).toContain('verify');
    expect(phaseNames).toContain('done');
    // Order: init must come first
    expect(phaseNames[0]).toBe('init');
  }, 20_000);
});

describe('Kill chain — multiple chunks', () => {
  it('reconstructs 16 KiB across 4 chunks', async () => {
    const sim = new ECUSimulator('sedan');
    const { report } = await sim.runKillChain({
      scenario: 'fast',
      dumpAddress: 0,
      dumpSize: 16 * 1024,
      chunkSize: 4096,
    });
    expect(report.verified).toBe(true);
    expect(report.dumpedBytes).toBe(16 * 1024);
    // Check that the dump phase did 4 service calls
    const dumpPhase = report.phases.find((p) => p.phase === 'dump');
    expect(dumpPhase?.requests).toBe(4);
  }, 30_000);
});

describe('Kill chain — reproducibility (deterministic)', () => {
  it('same dump hash across two runs', async () => {
    const s1 = new ECUSimulator('sedan');
    const r1 = await s1.runKillChain({ scenario: 'fast', dumpSize: 4096, chunkSize: 4096 });
    const s2 = new ECUSimulator('sedan');
    const r2 = await s2.runKillChain({ scenario: 'fast', dumpSize: 4096, chunkSize: 4096 });
    expect(r1.report.dumpChecksum).toBe(r2.report.dumpChecksum);
  }, 30_000);
});

describe('Kill chain — CSV log format (BRAIN-compatible)', () => {
  it('log header matches BRAIN convention', async () => {
    const sim = new ECUSimulator('sedan');
    const { csv } = await sim.runKillChain({ scenario: 'fast', dumpSize: 1024, chunkSize: 1024 });
    const lines = csv.split('\n');
    expect(lines[0]).toBe('timestamp_us,can_id,direction,dlc,data_hex,decoded_uds_service');
    // Check data row format
    expect(lines[1]).toMatch(/^\d+,0x[0-9A-F]{3},(tx|rx),\d+,[0-9A-F]+,/);
  }, 20_000);

  it('CSV contains both 0x7E0 (request) and 0x7E8 (response) IDs', async () => {
    const sim = new ECUSimulator('sedan');
    const { csv } = await sim.runKillChain({ scenario: 'fast', dumpSize: 1024, chunkSize: 1024 });
    expect(csv).toMatch(/0x7E0/);
    expect(csv).toMatch(/0x7E8/);
  }, 20_000);
});

describe('hash32 helper', () => {
  it('FNV-1a known vector (empty)', () => {
    const h = hash32(new Uint8Array(0));
    expect(h).toBe('811c9dc5'); // FNV-1a 32-bit offset basis
  });
  it('changes on any byte change', () => {
    const h1 = hash32(new Uint8Array([1, 2, 3, 4]));
    const h2 = hash32(new Uint8Array([1, 2, 3, 5]));
    expect(h1).not.toBe(h2);
  });
});
