import { useState, useRef, useEffect, useCallback } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ECUSimulator } from '@/lib/ecu-simulator';
import { useTheme, t } from '@/lib/theme-context';

interface LogEntry {
  id: number;
  type: 'cmd' | 'resp' | 'info';
  text: string;
  ts: string;
}

interface TerminalProps {
  simulator: ECUSimulator;
}

const QUICK_CMDS = [
  { label: 'ATZ', cmd: 'ATZ' }, { label: 'ATE0', cmd: 'ATE0' }, { label: 'ATH1', cmd: 'ATH1' },
  { label: 'ATSP0', cmd: 'ATSP0' }, { label: 'ATRV', cmd: 'ATRV' }, { label: '0100', cmd: '0100' },
  { label: '010C', cmd: '010C' }, { label: '010D', cmd: '010D' }, { label: '0105', cmd: '0105' },
  { label: '0104', cmd: '0104' }, { label: '0111', cmd: '0111' }, { label: '03', cmd: '03' },
  { label: '04', cmd: '04' }, { label: '0902', cmd: '0902' },
];

export default function Terminal({ simulator }: TerminalProps) {
  const { theme } = useTheme();
  const [logs, setLogs] = useState<LogEntry[]>([
    { id: 0, type: 'info', text: 'ELM327 v1.5 — ECU Simulator Terminal', ts: new Date().toLocaleTimeString('en-US', { hour12: false }) },
  ]);
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const idCounter = useRef(1);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => {
      if (scrollRef.current) {
        const vp = scrollRef.current.querySelector('[data-radix-scroll-area-viewport]');
        if (vp) vp.scrollTop = vp.scrollHeight;
      }
    }, 30);
  }, []);

  useEffect(() => { scrollToBottom(); }, [logs, scrollToBottom]);

  const addLog = useCallback((type: LogEntry['type'], text: string) => {
    setLogs((prev) => [...prev.slice(-500), { id: idCounter.current++, type, text, ts: new Date().toLocaleTimeString('en-US', { hour12: false }) }]);
  }, []);

  const sendCommand = useCallback((cmd: string) => {
    if (!cmd.trim()) return;
    addLog('cmd', cmd.trim());
    const response = simulator.sendCommand(cmd.trim());
    addLog('resp', response);
    setHistory((prev) => [cmd.trim(), ...prev.slice(0, 49)]);
    setHistoryIdx(-1);
    setInput('');
    inputRef.current?.focus();
  }, [simulator, addLog]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { sendCommand(input); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (history.length > 0) { const idx = Math.min(historyIdx + 1, history.length - 1); setHistoryIdx(idx); setInput(history[idx]); } }
    else if (e.key === 'ArrowDown') { e.preventDefault(); if (historyIdx > 0) { const idx = historyIdx - 1; setHistoryIdx(idx); setInput(history[idx]); } else { setHistoryIdx(-1); setInput(''); } }
  };

  const handleExportTerminalLog = useCallback(() => {
    const lines: string[] = ['# ECU SIMULATOR — TERMINAL LOG', `# Exported: ${new Date().toISOString()}`, `# Vehicle: ${simulator.getProfile().name}`, '#', 'timestamp,type,content'];
    for (const entry of logs) { lines.push(`${entry.ts},${entry.type},${entry.text.replace(/,/g, ';').replace(/\n/g, ' | ')}`); }
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `terminal_log_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.log`; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  }, [logs, simulator]);

  const bg = t('bg-[#111827]', 'bg-white', theme);
  const border = t('border-[#1e293b]', 'border-gray-200', theme);
  const bg2 = t('bg-[#0f172a]', 'bg-gray-50', theme);
  const bgTerminal = t('bg-[#0b1120]', 'bg-gray-50', theme);
  const textMuted = t('text-slate-500', 'text-gray-500', theme);

  return (
    <div className="space-y-3">
      <div className={`${bg} border ${border} rounded-md p-2`}>
        <div className="flex items-center gap-2 mb-2">
          <div className="w-1 h-3 bg-emerald-500/70 rounded-full" />
          <span className={`text-[10px] font-mono ${textMuted} uppercase tracking-widest`}>Comandos Rápidos</span>
          <span className={`text-[9px] font-mono ${textMuted} ml-auto`}>SEM HARDWARE — TUDO NO NAVEGADOR</span>
        </div>
        <div className="flex flex-wrap gap-1">
          {QUICK_CMDS.map((qc) => (
            <button key={qc.cmd} className={`h-6 px-2.5 text-[10px] font-mono text-emerald-500 ${bg2} border ${border} hover:border-emerald-800/40 hover:text-emerald-400 transition-colors rounded`} onClick={() => sendCommand(qc.cmd)}>{qc.label}</button>
          ))}
        </div>
      </div>

      <div className={`${bgTerminal} border ${border} rounded-md overflow-hidden`}>
        <div className={`px-3 py-1.5 border-b ${border} flex items-center justify-between`}>
          <span className={`text-[10px] font-mono ${textMuted} uppercase tracking-widest`}>ELM327 Terminal</span>
          <div className="flex items-center gap-3">
            <button className="text-[10px] font-mono text-sky-400 hover:text-sky-300 uppercase" onClick={handleExportTerminalLog}>↓ EXPORT</button>
            <button className={`text-[10px] font-mono ${textMuted} hover:text-slate-300 uppercase`} onClick={() => { setLogs([]); addLog('info', 'Terminal cleared'); }}>CLEAR</button>
          </div>
        </div>
        <ScrollArea className="h-[420px]" ref={scrollRef}>
          <div className="font-mono text-[12px] leading-[18px] p-3 space-y-0">
            {logs.map((entry) => (
              <div key={entry.id} className="flex">
                <span className={`w-[70px] shrink-0 text-[10px] ${theme === 'dark' ? 'text-slate-600' : 'text-gray-400'}`}>{entry.ts}</span>
                {entry.type === 'cmd' && <span className={`${theme === 'dark' ? 'text-emerald-400' : 'text-emerald-600'}`}><span className={theme === 'dark' ? 'text-emerald-700' : 'text-emerald-400'}>&gt;</span> {entry.text}</span>}
                {entry.type === 'resp' && <span className={theme === 'dark' ? 'text-sky-300' : 'text-sky-600'}>{entry.text}</span>}
                {entry.type === 'info' && <span className={textMuted}>— {entry.text}</span>}
              </div>
            ))}
          </div>
        </ScrollArea>
        <div className={`flex items-center border-t ${border} px-3 py-1.5`}>
          <span className={`font-mono text-[12px] mr-2 ${theme === 'dark' ? 'text-emerald-600' : 'text-emerald-500'}`}>&gt;</span>
          <input ref={inputRef} value={input} onChange={(e) => setInput(e.target.value.toUpperCase())} onKeyDown={handleKeyDown} placeholder="AT command or OBD-II PID..." className={`flex-1 bg-transparent font-mono text-[12px] outline-none ${theme === 'dark' ? 'text-emerald-300 placeholder:text-slate-700' : 'text-emerald-700 placeholder:text-gray-400'}`} autoComplete="off" spellCheck={false} />
          <button className={`text-[10px] font-mono ${theme === 'dark' ? 'text-emerald-600 hover:text-emerald-400' : 'text-emerald-500 hover:text-emerald-700'} uppercase ml-2`} onClick={() => sendCommand(input)}>SEND</button>
        </div>
      </div>
    </div>
  );
}