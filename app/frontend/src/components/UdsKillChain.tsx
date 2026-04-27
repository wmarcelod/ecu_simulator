// ============================================================
// UdsKillChain — UI demo for the firmware-extraction kill chain
// ============================================================
//
// This panel runs the end-to-end UDS kill chain documented in the
// dissertation case study, surfaces the CAN frame timeline as a
// scrollable table, shows phase progress and timing, and offers
// a one-click download of the reconstructed firmware image plus
// the full CSV log.
//
// Author: Marcelo Duchene (USP/ICMC)
// ============================================================

import { useCallback, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  KillChainCanLog,
  KillChainPhaseLog,
  KillChainResult,
  formatUs,
  killChainLogToCsv,
  runKillChain,
} from '@/lib/kill-chain';
import { ECUSimulator } from '@/lib/ecu-simulator';
import { useTheme, t } from '@/lib/theme-context';
import { bytesToHex } from '@/lib/uds';

interface UdsKillChainProps {
  simulator: ECUSimulator;
}

/** Format bytes as a Wireshark-style hex dump (8 bytes per row). */
function bytesToDumpHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).toUpperCase().padStart(2, '0'))
    .join(' ');
}

function downloadBlob(content: BlobPart, filename: string, mimeType: string) {
  const blob = new Blob([content as BlobPart], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function UdsKillChain({ simulator }: UdsKillChainProps) {
  const { theme } = useTheme();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressMsg, setProgressMsg] = useState('');
  const [result, setResult] = useState<KillChainResult | null>(null);
  const [phases, setPhases] = useState<KillChainPhaseLog[]>([]);
  const [logTail, setLogTail] = useState<KillChainCanLog[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Demo defaults aligned with the case study (matches Ford / VW T-Cross sequence).
  const [busFrames, setBusFrames] = useState(50);
  const [chunkBytes, setChunkBytes] = useState(4096);
  const [stMin, setStMin] = useState(1); // 1 ms STmin to keep wall-clock realistic
  const liveLogRef = useRef<KillChainCanLog[]>([]);

  const run = useCallback(async () => {
    setRunning(true);
    setError(null);
    setResult(null);
    setProgress(0);
    setProgressMsg('starting');
    setPhases([]);
    setLogTail([]);
    liveLogRef.current = [];

    try {
      const r = await runKillChain({
        bootloader: simulator.getBootloaderState(),
        busConditionFrames: busFrames,
        dumpChunkBytes: chunkBytes,
        stMin,
        onProgress: (frac, msg) => {
          setProgress(frac);
          setProgressMsg(msg);
        },
        onPhase: (p) => {
          setPhases((prev) => [...prev, p]);
        },
        onLog: (entry) => {
          liveLogRef.current.push(entry);
          // Keep the on-screen tail bounded for performance.
          if (liveLogRef.current.length % 20 === 0) {
            setLogTail(liveLogRef.current.slice(-40));
          }
        },
      });
      setLogTail(r.log.slice(-60));
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }, [busFrames, chunkBytes, simulator, stMin]);

  const downloadCsv = useCallback(() => {
    if (!result) return;
    const csv = killChainLogToCsv(result.log);
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    downloadBlob(csv, `uds_kill_chain_${ts}.csv`, 'text/csv');
  }, [result]);

  const downloadFirmware = useCallback(() => {
    if (!result) return;
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    downloadBlob(result.firmware, `uds_firmware_dump_${ts}.bin`, 'application/octet-stream');
  }, [result]);

  const headerSummary = useMemo(() => {
    if (!result) return null;
    return {
      durationS: (result.totalDurationUs / 1_000_000).toFixed(2),
      frames: result.totalFrames,
      bytes: result.firmware.length,
      hash: result.firmwareHash.toString(16).padStart(8, '0').toUpperCase(),
    };
  }, [result]);

  const bgPanel = t('bg-[#111827]', 'bg-white', theme);
  const border = t('border-[#1e293b]', 'border-gray-200', theme);
  const textMuted = t('text-slate-500', 'text-gray-500', theme);
  const textLabel = t('text-slate-400', 'text-gray-600', theme);
  const textAccent = t('text-emerald-400', 'text-emerald-600', theme);
  const textHi = t('text-slate-200', 'text-gray-900', theme);

  return (
    <div className={`${bgPanel} border ${border} rounded-md p-4 font-mono text-[11px] ${textHi}`}>
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <span className={`text-[12px] ${textLabel} uppercase tracking-wider`}>
          UDS Kill-Chain Demo
        </span>
        <span className={`text-[10px] ${textMuted}`}>
          ISO-TP + UDS 0x10/0x11/0x22/0x23/0x27/0x3E + bootloader emulation
        </span>
      </div>

      <div className={`flex flex-wrap gap-3 items-end mb-4 border-b ${border} pb-3`}>
        <div className="flex flex-col gap-1">
          <label className={`text-[9px] ${textMuted} uppercase`}>Bus conditioning</label>
          <input
            type="number"
            min={0}
            max={1000}
            value={busFrames}
            onChange={(e) => setBusFrames(parseInt(e.target.value || '0', 10))}
            className={`w-24 px-2 py-1 ${border} bg-transparent border rounded text-[11px]`}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className={`text-[9px] ${textMuted} uppercase`}>Chunk bytes</label>
          <input
            type="number"
            min={64}
            max={4093}
            step={64}
            value={chunkBytes}
            onChange={(e) => setChunkBytes(parseInt(e.target.value || '64', 10))}
            className={`w-28 px-2 py-1 ${border} bg-transparent border rounded text-[11px]`}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className={`text-[9px] ${textMuted} uppercase`}>STmin (ms)</label>
          <input
            type="number"
            min={0}
            max={127}
            value={stMin}
            onChange={(e) => setStMin(parseInt(e.target.value || '0', 10))}
            className={`w-20 px-2 py-1 ${border} bg-transparent border rounded text-[11px]`}
          />
        </div>
        <Button
          onClick={run}
          disabled={running}
          className="h-8 px-4 text-[11px] font-mono"
        >
          {running ? 'Running…' : 'Run Kill Chain Demo'}
        </Button>
        {result && (
          <>
            <Button onClick={downloadCsv} variant="secondary" className="h-8 text-[11px]">
              Download CSV log
            </Button>
            <Button onClick={downloadFirmware} variant="secondary" className="h-8 text-[11px]">
              Download firmware.bin
            </Button>
          </>
        )}
      </div>

      {/* progress + summary */}
      <div className="flex flex-wrap gap-6 mb-3">
        <div className="flex flex-col">
          <span className={`text-[9px] ${textMuted} uppercase`}>Progress</span>
          <span className={`${textAccent} text-[18px]`}>{(progress * 100).toFixed(0)}%</span>
          <span className={`text-[10px] ${textMuted}`}>{progressMsg}</span>
        </div>
        {headerSummary && (
          <>
            <div className="flex flex-col">
              <span className={`text-[9px] ${textMuted} uppercase`}>Total time</span>
              <span className={`${textHi} text-[18px]`}>{headerSummary.durationS} s</span>
            </div>
            <div className="flex flex-col">
              <span className={`text-[9px] ${textMuted} uppercase`}>CAN frames</span>
              <span className={`${textHi} text-[18px]`}>{headerSummary.frames}</span>
            </div>
            <div className="flex flex-col">
              <span className={`text-[9px] ${textMuted} uppercase`}>Dump size</span>
              <span className={`${textHi} text-[18px]`}>
                {headerSummary.bytes / 1024} KB
              </span>
            </div>
            <div className="flex flex-col">
              <span className={`text-[9px] ${textMuted} uppercase`}>FNV-1a hash</span>
              <span className={`${textHi} text-[14px]`}>0x{headerSummary.hash}</span>
            </div>
          </>
        )}
      </div>

      {error && (
        <div className="text-red-400 mb-3">
          ERROR: <span className="font-normal">{error}</span>
        </div>
      )}

      {/* phase timeline */}
      {phases.length > 0 && (
        <div className={`mb-3 border ${border} rounded`}>
          <table className="w-full text-[10px]">
            <thead>
              <tr className={`${textMuted} text-left uppercase`}>
                <th className="px-2 py-1">Phase</th>
                <th className="px-2 py-1">Duration</th>
                <th className="px-2 py-1">Frames</th>
                <th className="px-2 py-1">Description</th>
              </tr>
            </thead>
            <tbody>
              {phases.map((p) => (
                <tr key={p.name} className={`border-t ${border}`}>
                  <td className={`px-2 py-1 ${textAccent}`}>{p.name}</td>
                  <td className={`px-2 py-1 ${textHi}`}>{formatUs(p.endUs - p.startUs)}</td>
                  <td className={`px-2 py-1 ${textHi}`}>{p.framesEnd - p.framesStart}</td>
                  <td className={`px-2 py-1 ${textMuted}`}>{p.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* live log tail */}
      {logTail.length > 0 && (
        <div className={`border ${border} rounded`}>
          <div className={`px-2 py-1 ${textMuted} text-[9px] uppercase border-b ${border}`}>
            CAN frame trace (last {logTail.length} of {result?.totalFrames ?? '...'})
          </div>
          <div className="overflow-x-auto max-h-[460px] overflow-y-auto">
            <table className="w-full text-[10px]">
              <thead className="sticky top-0">
                <tr className={`${textMuted} text-left uppercase ${bgPanel}`}>
                  <th className="px-2 py-0.5">t (us)</th>
                  <th className="px-2 py-0.5">CAN ID</th>
                  <th className="px-2 py-0.5">DIR</th>
                  <th className="px-2 py-0.5">DLC</th>
                  <th className="px-2 py-0.5">Data</th>
                  <th className="px-2 py-0.5">Decoded</th>
                </tr>
              </thead>
              <tbody>
                {logTail.map((e, i) => (
                  <tr key={`${e.timestampUs}-${i}`} className={`border-t ${border}`}>
                    <td className={`px-2 py-0.5 ${textMuted}`}>{e.timestampUs}</td>
                    <td className={`px-2 py-0.5 ${textHi}`}>
                      0x{e.canId.toString(16).toUpperCase().padStart(3, '0')}
                    </td>
                    <td
                      className={`px-2 py-0.5 ${
                        e.direction === 'tester→ecu' ? 'text-amber-400' : 'text-emerald-400'
                      }`}
                    >
                      {e.direction === 'tester→ecu' ? 'TX' : 'RX'}
                    </td>
                    <td className={`px-2 py-0.5 ${textHi}`}>{e.dlc}</td>
                    <td className={`px-2 py-0.5 ${textHi}`}>{bytesToDumpHex(e.data)}</td>
                    <td className={`px-2 py-0.5 ${textMuted}`}>{e.decoded}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* firmware header preview */}
      {result && (
        <div className={`mt-3 border ${border} rounded p-2`}>
          <div className={`text-[9px] ${textMuted} uppercase mb-1`}>
            Reconstructed firmware header (first 64 bytes)
          </div>
          <pre className={`text-[10px] whitespace-pre-wrap ${textHi}`}>
            {bytesToHex(result.firmware.slice(0, 64))}
          </pre>
          <div className={`text-[10px] ${textMuted} mt-1`}>
            ASCII window: <span className={textHi}>
              {Array.from(result.firmware.slice(2, 32))
                .map((b) => (b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '.'))
                .join('')}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
