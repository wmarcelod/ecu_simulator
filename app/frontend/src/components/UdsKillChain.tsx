// ============================================================
// UdsKillChain — UI panel for the firmware-extraction kill chain demo
// ============================================================
//
// Surfaces the in-process UDS / ISO-TP / bootloader stack:
//   - Run / configure the kill chain (3 scenarios, dump size, chunk size)
//   - Live phase progress with timing per phase
//   - Visual data-flow diagram (Tester → ISO-TP → UDS Server → Bootloader)
//   - Frame-by-frame CAN log table (filterable)
//   - Visible error panel when the orchestrator captures an internal failure
//   - One-click downloads:
//       * Reconstructed firmware (.bin)
//       * BRAIN-format CSV log
//       * JSON report
//
// Theme-aware: respects the global light/dark theme.
//
// Author: Marcelo Duchene (USP/ICMC) — feat/uds-isotp-bootloader-research
// ============================================================

import { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ECUSimulator } from '@/lib/ecu-simulator';
import { KillChainEvent, KillChainPhase, KillChainReport, KillChainScenario, decodeUdsLabel } from '@/lib/kill-chain';
import { CanFrame, bytesToHex } from '@/lib/iso-tp';
import { useTheme } from '@/lib/theme-context';

interface Props {
  simulator: ECUSimulator;
}

interface FrameRecord {
  index: number;
  timestampMs: number;
  canId: number;
  direction: 'tx' | 'rx';
  dlc: number;
  hex: string;
  decoded: string;
}

function downloadBlob(content: BlobPart, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Phases in execution order, with PT-BR friendly labels and short hints
const PHASE_ORDER: KillChainPhase[] = ['init', 'conditioning', 'recon', 'session', 'reset', 'security', 'dump', 'cleanup', 'verify', 'done'];
const PHASE_META: Record<KillChainPhase, { label: string; hint: string }> = {
  init:         { label: 'Init',         hint: 'Inicialização do orquestrador' },
  conditioning: { label: 'Condicionar',  hint: 'Observa o barramento por 100–500 ms' },
  recon:        { label: 'Reconhecer',   hint: 'Lê 6 DIDs (0xF180..0xF195) com 0x22' },
  session:      { label: 'Sessão',       hint: '0x10 03 (extended) → 0x10 02 (programming)' },
  reset:        { label: 'Reset ECU',    hint: '0x11 02 — boot em modo bootloader' },
  security:     { label: 'SecurityAccess', hint: '0x27: pede seed, calcula key, envia' },
  dump:         { label: 'Dump',         hint: '0x23 ReadMemoryByAddress segmentado' },
  cleanup:      { label: 'Limpar',       hint: '0x10 01 — volta para sessão default' },
  verify:       { label: 'Verificar',    hint: 'Compara checksum do dump com a memória' },
  done:         { label: 'Done',         hint: 'Kill chain terminada' },
};

// Map each phase to which actor pair is "active" so the data-flow diagram lights up
const PHASE_ACTORS: Record<KillChainPhase, Array<'tester' | 'isotp' | 'server' | 'boot'>> = {
  init:         ['tester'],
  conditioning: ['tester', 'isotp'],
  recon:        ['tester', 'isotp', 'server'],
  session:      ['tester', 'isotp', 'server'],
  reset:        ['tester', 'isotp', 'server', 'boot'],
  security:     ['tester', 'isotp', 'server', 'boot'],
  dump:         ['tester', 'isotp', 'server', 'boot'],
  cleanup:      ['tester', 'isotp', 'server'],
  verify:       ['tester'],
  done:         [],
};

export default function UdsKillChain({ simulator }: Props) {
  const { theme } = useTheme();
  const dark = theme === 'dark';

  const [scenario, setScenario] = useState<KillChainScenario>('fast');
  const [dumpSize, setDumpSize] = useState(64 * 1024); // 64 KiB default for demo
  const [chunkSize, setChunkSize] = useState(2048);    // safe under ISO-TP 4093-byte cap
  const [running, setRunning] = useState(false);
  const [events, setEvents] = useState<KillChainEvent[]>([]);
  const [frames, setFrames] = useState<FrameRecord[]>([]);
  const [report, setReport] = useState<KillChainReport | null>(null);
  const [csv, setCsv] = useState<string>('');
  const [reconstructedFw, setReconstructedFw] = useState<Uint8Array | null>(null);
  const [activePhase, setActivePhase] = useState<KillChainPhase | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const frameCounter = useRef(0);

  // Theme-aware palette
  const bgCard      = dark ? 'bg-slate-900/40 border-slate-700' : 'bg-white border-gray-200';
  const bgPanel     = dark ? 'bg-slate-900/60 border-slate-700' : 'bg-gray-50 border-gray-200';
  const bgInput     = dark ? 'bg-slate-900 text-slate-200 border-slate-700' : 'bg-white text-gray-900 border-gray-300';
  const txMuted     = dark ? 'text-slate-400' : 'text-gray-600';
  const txDim       = dark ? 'text-slate-500' : 'text-gray-500';
  const txMain      = dark ? 'text-slate-200' : 'text-gray-900';
  const txMono      = dark ? 'text-slate-300' : 'text-gray-700';
  const codeBg      = dark ? 'bg-slate-800 text-amber-300' : 'bg-amber-100 text-amber-900';
  const phaseDoneBg = dark ? 'bg-emerald-900/40 text-emerald-200 border-emerald-700/50' : 'bg-emerald-100 text-emerald-800 border-emerald-300';
  const phasePendBg = dark ? 'bg-slate-800 text-slate-500 border-slate-700' : 'bg-gray-100 text-gray-500 border-gray-300';
  const phaseActBg  = dark ? 'bg-amber-500/30 text-amber-200 border-amber-500 ring-1 ring-amber-400' : 'bg-amber-100 text-amber-800 border-amber-400 ring-1 ring-amber-400';
  const txTx        = dark ? 'bg-blue-950/40 text-blue-200' : 'bg-blue-50 text-blue-900';
  const txRx        = dark ? 'bg-orange-950/40 text-orange-200' : 'bg-orange-50 text-orange-900';
  const tableHead   = dark ? 'bg-slate-800 text-slate-300 border-slate-700' : 'bg-gray-100 text-gray-700 border-gray-300';
  const errorBg     = dark ? 'bg-red-950/40 border-red-700 text-red-200' : 'bg-red-50 border-red-300 text-red-900';

  // Live frame subscription
  useEffect(() => {
    const unsub = simulator.onUdsFrame((f: CanFrame, dir: 'tx' | 'rx') => {
      const rec: FrameRecord = {
        index: ++frameCounter.current,
        timestampMs: f.timestamp || Date.now(),
        canId: f.id,
        direction: dir,
        dlc: f.data.length,
        hex: bytesToHex(f.data, ' '),
        decoded: decodeUdsLabel(f.data) || '',
      };
      setFrames((prev) => [...prev.slice(-499), rec]);
    });
    return unsub;
  }, [simulator]);

  const onRun = useCallback(async () => {
    if (running) return;
    setRunning(true);
    setEvents([]);
    setFrames([]);
    setReport(null);
    setReconstructedFw(null);
    setActivePhase('init');
    setRuntimeError(null);
    frameCounter.current = 0;
    try {
      const kc = simulator.buildKillChain({
        scenario,
        dumpSize,
        chunkSize,
        onProgress: (e) => {
          setEvents((prev) => [...prev, e]);
          if (e.phase && e.phase !== ('error' as any)) {
            setActivePhase(e.phase as KillChainPhase);
          }
        },
      });
      simulator.resetKillChainLog();
      const r = await kc.run();
      const csvText = (await import('@/lib/kill-chain')).framesToCsv(simulator.getKillChainCanLog());
      setReport(r);
      setCsv(csvText);
      // Surface internal error captured by the orchestrator
      if (r.error) setRuntimeError(r.error);
      else if (r.dumpedBytes < dumpSize) setRuntimeError(`Dump truncado: ${r.dumpedBytes}/${dumpSize} bytes extraídos. Verifique o log de eventos para a fase que parou.`);
      // Re-read the dump bytes from the bootloader (deterministic)
      setReconstructedFw(simulator.bootloader.getCurrentMemory().slice(0, Math.min(dumpSize, r.dumpedBytes || dumpSize)));
      setActivePhase('done');
    } catch (e: any) {
      // eslint-disable-next-line no-console
      console.error('[UdsKillChain] error', e);
      setRuntimeError(e?.message || String(e));
    } finally {
      setRunning(false);
    }
  }, [simulator, scenario, dumpSize, chunkSize, running]);

  const phaseSummary = useMemo(() => {
    if (!report) return null;
    return PHASE_ORDER.map((p) => report.phases.find((x) => x.phase === p));
  }, [report]);

  const stateText = useMemo(() => {
    const s = simulator.getUdsServerState();
    return `session=${s.session} | secLvl=${s.securityLevel} | bootActive=${s.bootActive}`;
  }, [simulator, events]);

  // Which actors are currently active (drives the data-flow diagram glow)
  const activeActors = useMemo(() => {
    if (!running || !activePhase) return new Set<'tester' | 'isotp' | 'server' | 'boot'>();
    return new Set(PHASE_ACTORS[activePhase] || []);
  }, [running, activePhase]);

  return (
    <div className="space-y-4 p-4">
      {/* Didactic intro banner */}
      <div className={`rounded-md border ${dark ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-emerald-300 bg-emerald-50'} p-4`}>
        <div className="flex items-start gap-3">
          <div className="text-2xl leading-none">🎯</div>
          <div className="space-y-1">
            <h2 className={`text-base font-bold ${dark ? 'text-emerald-400' : 'text-emerald-700'}`}>
              Demonstração Reprodutível — Ataque Ford / VW T-Cross (UDS Kill Chain)
            </h2>
            <p className={`text-[12px] ${txMono} leading-relaxed`}>
              Esta é uma <strong>demonstração reprodutível</strong> do ataque Ford/VW T-Cross documentado na dissertação.
              A simulação executa a kill chain UDS completa
              (<code className={`px-1 rounded ${codeBg} text-[11px]`}>DiagnosticSessionControl 0x10</code>{' → '}
              <code className={`px-1 rounded ${codeBg} text-[11px]`}>ECUReset 0x11</code>{' → '}
              <code className={`px-1 rounded ${codeBg} text-[11px]`}>SecurityAccess 0x27</code>{' → '}
              <code className={`px-1 rounded ${codeBg} text-[11px]`}>ReadMemoryByAddress 0x23</code>)
              e gera <strong>~75.000 quadros CAN reais</strong>. Você pode baixar os logs em formato CSV BRAIN-compatível,
              o firmware reconstruído (.bin) e um relatório JSON detalhado para análise externa.
            </p>
          </div>
        </div>
      </div>

      {/* Step ribbon — 4 user-facing stages */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
        {[
          { n: '1', t: 'Configure', d: 'Cenário, tamanho do dump e chunk' },
          { n: '2', t: 'Execute', d: 'Clique em "Executar Kill Chain"' },
          { n: '3', t: 'Visualize', d: 'Fases ao vivo + frames CAN' },
          { n: '4', t: 'Baixe', d: 'CSV, firmware (.bin), JSON' },
        ].map((s) => (
          <div key={s.n} className={`rounded border ${bgCard} p-2`}>
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-emerald-500 text-white font-bold text-xs flex items-center justify-center">{s.n}</div>
              <div className={`text-sm font-semibold ${dark ? 'text-emerald-300' : 'text-emerald-700'}`}>{s.t}</div>
            </div>
            <div className={`text-[11px] ${txMuted} mt-1 leading-snug`}>{s.d}</div>
          </div>
        ))}
      </div>

      {/* Visual data-flow diagram (Tester → ISO-TP → UDS Server → Bootloader) */}
      <div className={`rounded-md border ${bgPanel} p-3`}>
        <div className={`text-[11px] uppercase tracking-wider ${txDim} mb-2`}>
          Fluxo de dados em tempo real {activePhase ? <span className={`ml-2 ${dark ? 'text-amber-300' : 'text-amber-700'}`}>— fase atual: {PHASE_META[activePhase].label}</span> : null}
        </div>
        <div className="flex items-stretch justify-between gap-2 overflow-x-auto">
          {([
            { id: 'tester' as const, name: 'Tester (UDS Client)', sub: 'browser → 0x7E0', icon: '💻' },
            { id: 'isotp'  as const, name: 'ISO 15765-2',         sub: 'SF/FF/CF/FC + BS/STmin', icon: '🔄' },
            { id: 'server' as const, name: 'UDS Server',          sub: 'ISO 14229-1, 13 serviços', icon: '⚙️' },
            { id: 'boot'   as const, name: 'Bootloader',          sub: '512 KiB flash sintética', icon: '🔐' },
          ]).map((node, idx, arr) => {
            const active = activeActors.has(node.id);
            const baseColor = dark
              ? (active ? 'bg-amber-500/20 border-amber-500 text-amber-200 ring-2 ring-amber-400/60' : 'bg-slate-900/60 border-slate-700 text-slate-400')
              : (active ? 'bg-amber-100 border-amber-400 text-amber-900 ring-2 ring-amber-300' : 'bg-white border-gray-300 text-gray-600');
            return (
              <div key={node.id} className="flex items-center gap-2 flex-1 min-w-[150px]">
                <div className={`flex-1 rounded-md border-2 px-3 py-2 text-center transition-all duration-150 ${baseColor}`}>
                  <div className="text-2xl leading-none mb-1">{node.icon}</div>
                  <div className="text-xs font-semibold">{node.name}</div>
                  <div className={`text-[10px] ${active ? '' : txDim}`}>{node.sub}</div>
                </div>
                {idx < arr.length - 1 && (
                  <div className={`text-2xl ${active && activeActors.has(arr[idx + 1].id) ? (dark ? 'text-amber-400' : 'text-amber-600') : txDim}`}>→</div>
                )}
              </div>
            );
          })}
        </div>
        <div className={`mt-2 text-[10px] ${txDim} font-mono`}>
          IDs canônicos: <code className={`px-1 rounded ${codeBg}`}>0x7E0</code> tester→ECU · <code className={`px-1 rounded ${codeBg}`}>0x7E8</code> ECU→tester
        </div>
      </div>

      {/* Status + Controls */}
      <div className={`flex items-center justify-between flex-wrap gap-3 border-t ${dark ? 'border-slate-700' : 'border-gray-200'} pt-3`}>
        <div>
          <div className={`text-[11px] uppercase tracking-wider ${txDim}`}>Estado do Servidor UDS</div>
          <div className={`text-xs ${txMono} font-mono`}>{stateText}</div>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <div className="flex flex-col">
            <label className={`text-[10px] uppercase ${txDim} mb-0.5`} title="Define o ritmo da kill chain. 'fast' usa STmin=0 (~200 ms). 'realistic' replica timing veicular real (~50–60 s). 'brute-force' gera ~75 mil frames com tentativas de SecurityAccess.">Cenário</label>
            <Select value={scenario} onValueChange={(v) => setScenario(v as KillChainScenario)}>
              <SelectTrigger className="w-[200px]" title="Define o ritmo da kill chain.">
                <SelectValue placeholder="Cenário" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="fast">fast — CI/teste (~200 ms)</SelectItem>
                <SelectItem value="realistic">realistic — timing real (~50–60 s)</SelectItem>
                <SelectItem value="brute-force">brute-force — training set IDS</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col">
            <label className={`text-[10px] uppercase ${txDim} mb-0.5`} title="Quantidade total de bytes a extrair do bootloader emulado. 512 KiB = dump completo da flash simulada.">Tamanho do dump</label>
            <select
              className={`border rounded px-2 py-1 text-sm ${bgInput}`}
              value={dumpSize}
              onChange={(e) => setDumpSize(parseInt(e.target.value, 10))}
              disabled={running}
              title="Quantidade total de bytes a extrair do bootloader emulado."
            >
              <option value={4096}>4 KiB</option>
              <option value={16384}>16 KiB</option>
              <option value={65536}>64 KiB</option>
              <option value={262144}>256 KiB</option>
              <option value={524288}>512 KiB (flash completa)</option>
            </select>
          </div>
          <div className="flex flex-col">
            <label className={`text-[10px] uppercase ${txDim} mb-0.5`} title="Tamanho de cada bloco lido por ReadMemoryByAddress 0x23. ISO-TP limita a resposta a 4093 bytes — qualquer valor maior produz NRC 0x14.">Chunk</label>
            <select
              className={`border rounded px-2 py-1 text-sm ${bgInput}`}
              value={chunkSize}
              onChange={(e) => setChunkSize(parseInt(e.target.value, 10))}
              disabled={running}
              title="Tamanho de cada bloco em ReadMemoryByAddress 0x23. Máximo seguro: 4093 bytes (ISO-TP)."
            >
              <option value={512}>chunk = 512 B</option>
              <option value={1024}>chunk = 1 KiB</option>
              <option value={2048}>chunk = 2 KiB (recomendado)</option>
              <option value={4093}>chunk = 4093 B (limite ISO-TP)</option>
            </select>
          </div>
          <Button onClick={onRun} disabled={running} className="self-end">
            {running ? 'Executando...' : '▶ Executar Kill Chain'}
          </Button>
        </div>
      </div>

      {/* Phase ribbon (live: pending → active → done) */}
      <div className="flex flex-wrap gap-1.5">
        {PHASE_ORDER.map((p) => {
          const stat = phaseSummary?.find((s) => s?.phase === p);
          const isDone = !!stat;
          const isActive = running && activePhase === p && !isDone;
          const cls = isActive ? phaseActBg : isDone ? phaseDoneBg : phasePendBg;
          return (
            <div
              key={p}
              className={`text-xs px-2 py-1 rounded border ${cls} font-mono`}
              title={`${PHASE_META[p].hint}${stat ? ` — ${stat.durationMs.toFixed(0)}ms, ${stat.requests}reqs, ${stat.bytesIn}B in / ${stat.bytesOut}B out` : ''}`}
            >
              {PHASE_META[p].label}{stat ? ` ${stat.durationMs.toFixed(0)}ms` : (isActive ? ' …' : '')}
            </div>
          );
        })}
      </div>

      {/* ERROR PANEL — visível quando algo falha */}
      {runtimeError && (
        <div className={`rounded-md border ${errorBg} p-3`}>
          <div className="flex items-start gap-2">
            <div className="text-xl leading-none">⚠️</div>
            <div className="flex-1">
              <div className="text-sm font-bold">Falha durante a kill chain</div>
              <div className="text-xs font-mono mt-1 break-all">{runtimeError}</div>
              <div className={`text-[11px] mt-2 ${txMuted}`}>
                Causas comuns: <code className={`px-1 rounded ${codeBg}`}>NRC 0x14</code> (responseTooLong) → reduzir chunk; <code className={`px-1 rounded ${codeBg}`}>NRC 0x33</code> (securityAccessDenied) → estado do servidor; <code className={`px-1 rounded ${codeBg}`}>NRC 0x37</code> (lockout) → aguardar antes de retentar SecurityAccess.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Report summary + downloads */}
      {report && (
        <div className={`flex flex-wrap gap-2 items-center text-sm border-t ${dark ? 'border-slate-700' : 'border-gray-200'} pt-2 ${txMain}`}>
          <span><strong>Total:</strong> {report.totalDurationMs.toFixed(0)} ms</span>
          <span><strong>Extraído:</strong> {report.dumpedBytes.toLocaleString('pt-BR')} / {dumpSize.toLocaleString('pt-BR')} bytes</span>
          <span><strong>Taxa:</strong> {(report.bytesPerSecond / 1024).toFixed(1)} KiB/s</span>
          <span>
            <strong>Hash:</strong> <code className={`px-1 rounded ${codeBg}`}>{report.dumpChecksum || 'n/a'}</code>{' '}
            {report.verified ? <span className={dark ? 'text-emerald-400' : 'text-emerald-700'}>✓ verificado</span> : <span className={dark ? 'text-red-400' : 'text-red-700'}>✗ divergência</span>}
          </span>
          <Button size="sm" variant="outline" disabled={!csv} title="Log de frames CAN no formato CSV BRAIN-compatível" onClick={() => csv && downloadBlob(csv, `uds_demo_kill_chain_${scenario}_${Date.now()}.csv`, 'text/csv')}>
            ⬇ Baixar CSV (BRAIN)
          </Button>
          <Button size="sm" variant="outline" disabled={!reconstructedFw || reconstructedFw.length === 0} title="Bytes brutos do firmware reconstruído" onClick={() => reconstructedFw && downloadBlob(reconstructedFw, `uds_demo_firmware_${scenario}_${Date.now()}.bin`, 'application/octet-stream')}>
            ⬇ Baixar Firmware (.bin)
          </Button>
          <Button size="sm" variant="outline" title="Relatório completo de cada fase (JSON)" onClick={() => report && downloadBlob(JSON.stringify(report, (k, v) => v instanceof Uint8Array ? bytesToHex(v) : v, 2), `uds_demo_report_${scenario}_${Date.now()}.json`, 'application/json')}>
            ⬇ Baixar Relatório (JSON)
          </Button>
        </div>
      )}

      {/* Live event log (last 100) */}
      <div>
        <div className={`text-[11px] uppercase tracking-wider ${txDim} mb-1`}>Log de eventos da kill chain (últimos 100)</div>
        <div className={`border rounded ${bgPanel} max-h-72 overflow-y-auto p-2 text-xs font-mono`}>
          {events.slice(-100).map((e, i) => (
            <div key={i} className="grid grid-cols-[80px_1fr] gap-2">
              <span className={txDim}>{e.timestampMs.toFixed(0).padStart(7, ' ')}</span>
              <span className={txMain}><strong className={dark ? 'text-emerald-400' : 'text-emerald-700'}>[{e.phase}]</strong> {e.message}</span>
            </div>
          ))}
          {events.length === 0 && <span className={txMuted}>Sem atividade. Clique em "▶ Executar Kill Chain" para iniciar.</span>}
        </div>
      </div>

      {/* CAN frame log */}
      <div>
        <div className={`text-sm font-semibold mb-1 ${txMain}`}>Frames CAN capturados: {frames.length}</div>
        <div className={`border ${dark ? 'border-slate-700' : 'border-gray-300'} rounded max-h-72 overflow-y-auto text-xs font-mono`}>
          <table className="w-full">
            <thead className={`sticky top-0 ${tableHead} border-b`}>
              <tr>
                <th className="text-left px-2 py-1">#</th>
                <th className="text-left px-2 py-1">t (ms)</th>
                <th className="text-left px-2 py-1">ID</th>
                <th className="text-left px-2 py-1">dir</th>
                <th className="text-left px-2 py-1">DLC</th>
                <th className="text-left px-2 py-1">data</th>
                <th className="text-left px-2 py-1">decoded</th>
              </tr>
            </thead>
            <tbody>
              {frames.slice(-300).map((f) => (
                <tr key={f.index} className={f.direction === 'tx' ? txTx : txRx}>
                  <td className="px-2 py-0">{f.index}</td>
                  <td className="px-2 py-0">{f.timestampMs.toFixed(0)}</td>
                  <td className="px-2 py-0">0x{f.canId.toString(16).toUpperCase().padStart(3, '0')}</td>
                  <td className="px-2 py-0">{f.direction}</td>
                  <td className="px-2 py-0">{f.dlc}</td>
                  <td className="px-2 py-0">{f.hex}</td>
                  <td className="px-2 py-0">{f.decoded}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
