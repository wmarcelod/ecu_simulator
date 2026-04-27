// ============================================================
// Generate the CAN trace CSV captures referenced by the
// dissertation case-study chapter.
// ============================================================
//
// Runs the kill chain end-to-end (or specific phases of it) and
// writes the resulting frame logs as data/uds_demo_*.csv files.
//
// Usage (from /app/frontend after npm install):
//   npx tsx scripts/generate-uds-captures.ts
//
// Author: Marcelo Duchene (USP/ICMC)
// ============================================================

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { BootloaderState } from '../src/lib/bootloader';
import {
  KillChainCanLog,
  KillChainPhaseLog,
  killChainLogToCsv,
  runKillChain,
} from '../src/lib/kill-chain';

const OUT_DIR = path.resolve(__dirname, '..', '..', '..', 'data');

function csvForPhases(log: KillChainCanLog[], phases: KillChainPhaseLog[], names: string[]): string {
  const wanted = phases.filter((p) => names.includes(p.name));
  if (wanted.length === 0) return killChainLogToCsv([]);
  const start = Math.min(...wanted.map((p) => p.framesStart));
  const end = Math.max(...wanted.map((p) => p.framesEnd));
  return killChainLogToCsv(log.slice(start, end));
}

async function writeCsv(filename: string, content: string): Promise<void> {
  const fp = path.join(OUT_DIR, filename);
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(fp, content, 'utf-8');
  console.log(`wrote ${filename} (${content.length} bytes, ${content.split('\n').length - 1} rows)`);
}

async function main() {
  console.log('Running full kill-chain (512 KB image)…');
  const bl = new BootloaderState();
  const t0 = Date.now();
  const r = await runKillChain({
    bootloader: bl,
    busConditionFrames: 50,
    dumpTotalBytes: 512 * 1024,
    dumpChunkBytes: 4094,
    stMin: 0,
  });
  const wallMs = Date.now() - t0;

  console.log(`Done in ${wallMs} ms — ${r.totalFrames} frames, hash 0x${r.firmwareHash.toString(16).toUpperCase()}`);

  if (r.firmware.length !== 512 * 1024) throw new Error('unexpected firmware size');
  for (let i = 0; i < r.firmware.length; i++) {
    if (r.firmware[i] !== bl.getImage()[i]) {
      throw new Error(`firmware mismatch at offset ${i}`);
    }
  }
  console.log('Firmware byte-for-byte verified against synthetic image.');

  await writeCsv(
    'uds_demo_session_control.csv',
    csvForPhases(r.log, r.phases, ['dsc_extended', 'dsc_programming', 'dsc_programming_post_reset']),
  );
  await writeCsv(
    'uds_demo_ecu_reset.csv',
    csvForPhases(r.log, r.phases, ['ecu_reset_bootloader']),
  );
  await writeCsv(
    'uds_demo_security_access.csv',
    csvForPhases(r.log, r.phases, ['security_access']),
  );
  await writeCsv(
    'uds_demo_firmware_dump.csv',
    csvForPhases(r.log, r.phases, ['firmware_dump']),
  );
  await writeCsv('uds_demo_kill_chain_full.csv', killChainLogToCsv(r.log));

  const summary: string[] = [
    'phase,start_us,end_us,duration_ms,frames,description',
    ...r.phases.map((p) => {
      const dur = (p.endUs - p.startUs) / 1000;
      const frames = p.framesEnd - p.framesStart;
      const desc = p.description.replace(/,/g, ';');
      return `${p.name},${p.startUs},${p.endUs},${dur.toFixed(2)},${frames},${desc}`;
    }),
  ];
  await writeCsv('uds_demo_phase_summary.csv', summary.join('\n'));

  console.log('All captures generated successfully.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
