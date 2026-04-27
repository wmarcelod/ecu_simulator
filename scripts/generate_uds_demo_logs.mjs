// ============================================================
// generate_uds_demo_logs.mjs
// ============================================================
//
// Standalone Node.js script that runs the UDS kill-chain in-process and
// dumps BRAIN-format CSV logs into data/. Used to seed the dissertation
// case-study chapter with reproducible CAN traces.
//
// Usage:
//   node scripts/generate_uds_demo_logs.mjs
//
// Outputs (under data/):
//   uds_demo_session_control.csv     — only the 0x10 phase frames
//   uds_demo_ecu_reset.csv           — only the 0x11 phase frames
//   uds_demo_security_access.csv     — only the 0x27 phase frames
//   uds_demo_firmware_dump.csv       — only the 0x23 phase frames
//   uds_demo_kill_chain_full.csv     — full kill chain
//   uds_demo_brute_force.csv         — brute-force scenario (IDS training)
//
// Author: Marcelo Duchene (USP/ICMC) — feat/uds-isotp-bootloader-research
// ============================================================

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

// We import the simulator via the compiled JS in app/frontend/dist/, but that
// requires a build. To keep this dependency-free we instead inline a minimal
// version that drives the UdsServer + UdsClient pair via a tsx loader.
//
// Simpler approach: compile via npx esbuild when run, or use tsx directly.
// For maximum portability, we use dynamic import with the .ts file via tsx.

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const dataDir = path.join(repoRoot, 'data');
fs.mkdirSync(dataDir, { recursive: true });

// Try tsx loader; if not available, hint how to install.
async function main() {
  let mod;
  try {
    // tsx provides ESM loader for .ts files
    register('tsx/esm', pathToFileURL(__filename));
    mod = await import(pathToFileURL(path.join(repoRoot, 'app/frontend/src/lib/ecu-simulator.ts')).href);
  } catch (e) {
    console.error('Failed to dynamically import ecu-simulator.ts. Try: npm install -g tsx (or use tsx ./scripts/generate_uds_demo_logs.mjs)');
    console.error(e);
    process.exit(1);
  }
  const { ECUSimulator } = mod;
  const kc = await import(pathToFileURL(path.join(repoRoot, 'app/frontend/src/lib/kill-chain.ts')).href);
  const { framesToCsv } = kc;

  // ----- Run kill-chain (fast scenario, 4 KiB sample) -----
  const sim1 = new ECUSimulator('sedan');
  console.log('[*] Running kill-chain (fast, 4 KiB)…');
  const r1 = await sim1.runKillChain({ scenario: 'fast', dumpSize: 4096, chunkSize: 4096 });
  console.log(`    ok=${!r1.report.error} dur=${r1.report.totalDurationMs.toFixed(0)}ms verified=${r1.report.verified}`);
  fs.writeFileSync(path.join(dataDir, 'uds_demo_kill_chain_full.csv'), r1.csv, 'utf8');

  // Slice per-phase (use frame log directly)
  const fullLog = sim1.getKillChainCanLog();
  const phases = {
    'session': /DSC|TesterPresent/i,
    'ecu_reset': /ECUReset/i,
    'security': /SecAccess/i,
    'firmware_dump': /ReadMem/i,
  };
  for (const [name, re] of Object.entries(phases)) {
    const slice = fullLog.filter((r) => (r.decodedUds || '').match(re));
    fs.writeFileSync(path.join(dataDir, `uds_demo_${name === 'session' ? 'session_control' : name === 'ecu_reset' ? 'ecu_reset' : name === 'security' ? 'security_access' : 'firmware_dump'}.csv`), framesToCsv(slice), 'utf8');
  }

  // ----- Run brute-force scenario (small, for IDS training data) -----
  const sim2 = new ECUSimulator('sedan');
  console.log('[*] Running kill-chain (brute-force, 1 KiB, max 8 attempts)…');
  const r2 = await sim2.runKillChain({ scenario: 'brute-force', dumpSize: 1024, chunkSize: 1024, bruteForceMaxAttempts: 8 });
  fs.writeFileSync(path.join(dataDir, 'uds_demo_brute_force.csv'), r2.csv, 'utf8');

  // ----- Realistic scenario, larger dump -----
  const sim3 = new ECUSimulator('sedan');
  console.log('[*] Running kill-chain (realistic, 64 KiB)…');
  const r3 = await sim3.runKillChain({ scenario: 'realistic', dumpSize: 64 * 1024, chunkSize: 4096 });
  fs.writeFileSync(path.join(dataDir, 'uds_demo_realistic_64k.csv'), r3.csv, 'utf8');
  console.log(`    realistic 64K: ${r3.report.totalDurationMs.toFixed(0)}ms, throughput=${(r3.report.bytesPerSecond / 1024).toFixed(1)} KiB/s, verified=${r3.report.verified}`);

  // ----- Summary -----
  const summary = {
    runs: [
      { name: 'fast 4K', duration_ms: r1.report.totalDurationMs, frames: fullLog.length, verified: r1.report.verified, hash: r1.report.dumpChecksum },
      { name: 'brute-force 1K (8 attempts)', duration_ms: r2.report.totalDurationMs, frames: sim2.getKillChainCanLog().length, verified: r2.report.verified, hash: r2.report.dumpChecksum },
      { name: 'realistic 64K', duration_ms: r3.report.totalDurationMs, frames: sim3.getKillChainCanLog().length, verified: r3.report.verified, hash: r3.report.dumpChecksum },
    ],
    generated_at: new Date().toISOString(),
    branch: 'feat/uds-isotp-bootloader-research',
  };
  fs.writeFileSync(path.join(dataDir, 'uds_demo_summary.json'), JSON.stringify(summary, null, 2), 'utf8');
  console.log('[+] All CSVs written under data/. Summary in uds_demo_summary.json');
}

main().catch((e) => { console.error(e); process.exit(2); });
