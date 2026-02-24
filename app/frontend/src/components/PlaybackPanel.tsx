import { useState, useRef, useCallback, useEffect } from 'react';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ECUSimulator } from '@/lib/ecu-simulator';
import { useTheme, t } from '@/lib/theme-context';

interface PlaybackEntry {
  timestamp: number;
  messageId: string;
  data: string;
  rpm?: number;
  speed?: number;
  coolantTemp?: number;
  engineLoad?: number;
  throttle?: number;
}

interface PlaybackPanelProps {
  simulator: ECUSimulator;
}

function parseCSV(text: string): PlaybackEntry[] {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  const header = lines[0].toLowerCase().split(',').map((h) => h.trim());
  const entries: PlaybackEntry[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map((c) => c.trim());
    if (cols.length < 2) continue;
    const entry: PlaybackEntry = { timestamp: 0, messageId: '', data: '' };

    header.forEach((h, idx) => {
      const val = cols[idx] || '';
      if (h.includes('time') || h.includes('timestamp')) entry.timestamp = parseFloat(val) || i * 0.1;
      else if (h.includes('id') || h.includes('message')) entry.messageId = val;
      else if (h.includes('data') || h.includes('bytes')) entry.data = val;
      else if (h.includes('rpm')) entry.rpm = parseFloat(val);
      else if (h.includes('speed')) entry.speed = parseFloat(val);
      else if (h.includes('coolant') || h.includes('temp')) entry.coolantTemp = parseFloat(val);
      else if (h.includes('load')) entry.engineLoad = parseFloat(val);
      else if (h.includes('throttle')) entry.throttle = parseFloat(val);
    });

    if (entry.timestamp === 0) entry.timestamp = i * 0.1;
    entries.push(entry);
  }
  return entries;
}

export default function PlaybackPanel({ simulator }: PlaybackPanelProps) {
  const { theme } = useTheme();
  const bg = t('bg-[#111827]', 'bg-white', theme);
  const border = t('border-[#1e293b]', 'border-gray-200', theme);
  const bg2 = t('bg-[#0f172a]', 'bg-gray-50', theme);
  const textMuted = t('text-slate-500', 'text-gray-500', theme);
  const [entries, setEntries] = useState<PlaybackEntry[]>([]);
  const [fileName, setFileName] = useState('');
  const [playing, setPlaying] = useState(false);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [speed, setSpeed] = useState('1');
  const fileRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const totalDur = entries.length > 0 ? entries[entries.length - 1].timestamp - entries[0].timestamp : 0;
  const curTime = entries.length > 0 && currentIdx < entries.length ? entries[currentIdx].timestamp - entries[0].timestamp : 0;
  const progress = totalDur > 0 ? (curTime / totalDur) * 100 : 0;

  const applyEntry = useCallback((e: PlaybackEntry) => {
    if (e.rpm !== undefined) simulator.setSensorValue('rpm', e.rpm);
    if (e.speed !== undefined) simulator.setSensorValue('speed', e.speed);
    if (e.coolantTemp !== undefined) simulator.setSensorValue('coolantTemp', e.coolantTemp);
    if (e.engineLoad !== undefined) simulator.setSensorValue('engineLoad', e.engineLoad);
    if (e.throttle !== undefined) simulator.setSensorValue('throttle', e.throttle);
  }, [simulator]);

  const stopPlayback = useCallback(() => {
    setPlaying(false);
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
  }, []);

  const playNext = useCallback(() => {
    setCurrentIdx((prev) => {
      const next = prev + 1;
      if (next >= entries.length) { stopPlayback(); return prev; }
      applyEntry(entries[next]);
      const mult = parseFloat(speed);
      const delay = entries.length > next + 1
        ? ((entries[next + 1].timestamp - entries[next].timestamp) * 1000) / mult
        : 100;
      timerRef.current = setTimeout(playNext, Math.max(10, delay));
      return next;
    });
  }, [entries, speed, applyEntry, stopPlayback]);

  const startPlayback = useCallback(() => {
    if (entries.length === 0) return;
    setPlaying(true);
    applyEntry(entries[currentIdx]);
    playNext();
  }, [entries, currentIdx, applyEntry, playNext]);

  useEffect(() => {
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const parsed = parseCSV(ev.target?.result as string);
      setEntries(parsed);
      setCurrentIdx(0);
      stopPlayback();
    };
    reader.readAsText(file);
  };

  const handleSeek = (v: number[]) => {
    const idx = Math.round((v[0] / 100) * (entries.length - 1));
    setCurrentIdx(idx);
    if (entries[idx]) applyEntry(entries[idx]);
  };

  const handleReset = () => {
    stopPlayback();
    setCurrentIdx(0);
    if (entries[0]) applyEntry(entries[0]);
  };

  const generateSample = () => {
    const lines = ['timestamp,rpm,speed,coolantTemp,engineLoad,throttle'];
    for (let i = 0; i < 200; i++) {
      const t = i * 0.2;
      const p = i / 200;
      let rpm: number, spd: number, load: number, thr: number;
      if (p < 0.2) { rpm = 750 + Math.random() * 50; spd = 0; load = 20 + Math.random() * 5; thr = 12 + Math.random() * 3; }
      else if (p < 0.5) { const a = (p - 0.2) / 0.3; rpm = 750 + a * 4000 + Math.random() * 100; spd = a * 120 + Math.random() * 5; load = 40 + a * 40 + Math.random() * 10; thr = 30 + a * 50 + Math.random() * 10; }
      else if (p < 0.75) { rpm = 2800 + Math.random() * 200; spd = 100 + Math.random() * 10; load = 35 + Math.random() * 10; thr = 25 + Math.random() * 5; }
      else { const d = (p - 0.75) / 0.25; rpm = 2800 - d * 2000 + Math.random() * 100; spd = 100 - d * 100 + Math.random() * 5; load = 35 - d * 25 + Math.random() * 5; thr = 25 - d * 20 + Math.random() * 3; }
      const cool = 88 + (p > 0.3 ? (p - 0.3) * 15 : 0) + Math.random() * 2;
      lines.push(`${t.toFixed(1)},${rpm.toFixed(0)},${spd.toFixed(0)},${cool.toFixed(1)},${load.toFixed(0)},${thr.toFixed(0)}`);
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'sample_ecu_log.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-3">
      {/* Upload */}
      <div className="bg-[#111827] border border-[#1e293b] rounded-md p-3">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-1 h-3 bg-emerald-500/70 rounded-full" />
          <span className="text-[10px] font-mono text-slate-500 uppercase tracking-widest">Historical Data Playback</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input ref={fileRef} type="file" accept=".csv,.txt,.log" onChange={handleFile} className="hidden" />
          <button
            className="h-7 px-3 text-[10px] font-mono uppercase bg-[#0f172a] border border-[#1e293b] text-emerald-400 hover:text-emerald-300 hover:border-emerald-800/40 rounded"
            onClick={() => fileRef.current?.click()}
          >
            UPLOAD CSV
          </button>
          <button
            className="h-7 px-3 text-[10px] font-mono uppercase bg-[#0f172a] border border-[#1e293b] text-slate-500 hover:text-slate-300 rounded"
            onClick={generateSample}
          >
            SAMPLE CSV
          </button>
          {fileName && (
            <span className="text-[10px] font-mono text-slate-400">
              {fileName} — {entries.length} entries
            </span>
          )}
        </div>
        <div className="text-[9px] font-mono text-slate-600 mt-2">
          FORMAT: timestamp, rpm, speed, coolantTemp, engineLoad, throttle
        </div>
      </div>

      {/* Controls */}
      {entries.length > 0 && (
        <div className="bg-[#111827] border border-[#1e293b] rounded-md p-3 space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-mono text-slate-500 uppercase tracking-widest">Playback Control</span>
          </div>

          {/* Timeline */}
          <div className="space-y-1">
            <Slider value={[progress]} min={0} max={100} step={0.1} onValueChange={handleSeek} className="cursor-pointer" />
            <div className="flex justify-between text-[9px] font-mono text-slate-500">
              <span>{curTime.toFixed(1)}s</span>
              <span>{currentIdx + 1} / {entries.length}</span>
              <span>{totalDur.toFixed(1)}s</span>
            </div>
          </div>

          {/* Buttons */}
          <div className="flex items-center gap-2">
            {!playing ? (
              <button className="h-7 px-4 text-[10px] font-mono uppercase bg-emerald-950/40 border border-emerald-800/40 text-emerald-400 hover:bg-emerald-950/60 rounded" onClick={startPlayback}>
                ▶ PLAY
              </button>
            ) : (
              <button className="h-7 px-4 text-[10px] font-mono uppercase bg-amber-950/40 border border-amber-800/40 text-amber-400 hover:bg-amber-950/60 rounded" onClick={stopPlayback}>
                ‖ PAUSE
              </button>
            )}
            <button className="h-7 px-3 text-[10px] font-mono uppercase bg-[#0f172a] border border-[#1e293b] text-slate-400 hover:text-slate-200 rounded" onClick={handleReset}>
              ■ RESET
            </button>

            <div className="flex items-center gap-1.5 ml-auto">
              <span className="text-[9px] font-mono text-slate-500 uppercase">Speed</span>
              <Select value={speed} onValueChange={setSpeed}>
                <SelectTrigger className="w-[65px] h-7 bg-[#0f172a] border-[#1e293b] text-slate-300 text-[10px] font-mono rounded">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#1e293b] border-[#334155] rounded">
                  {['0.5', '1', '2', '4'].map((v) => (
                    <SelectItem key={v} value={v} className="text-slate-300 text-[10px] font-mono focus:bg-[#334155]">{v}x</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Current Data */}
          {entries[currentIdx] && (
            <div className="bg-[#0f172a] border border-[#1e293b] rounded p-2">
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-x-4 gap-y-1 text-[10px] font-mono">
                {entries[currentIdx].rpm !== undefined && (
                  <div><span className="text-slate-500">RPM</span> <span className="text-emerald-400">{entries[currentIdx].rpm?.toFixed(0)}</span></div>
                )}
                {entries[currentIdx].speed !== undefined && (
                  <div><span className="text-slate-500">SPD</span> <span className="text-sky-400">{entries[currentIdx].speed?.toFixed(0)}</span></div>
                )}
                {entries[currentIdx].coolantTemp !== undefined && (
                  <div><span className="text-slate-500">CLT</span> <span className="text-lime-400">{entries[currentIdx].coolantTemp?.toFixed(1)}</span></div>
                )}
                {entries[currentIdx].engineLoad !== undefined && (
                  <div><span className="text-slate-500">LOAD</span> <span className="text-blue-400">{entries[currentIdx].engineLoad?.toFixed(0)}%</span></div>
                )}
                {entries[currentIdx].throttle !== undefined && (
                  <div><span className="text-slate-500">TPS</span> <span className="text-teal-400">{entries[currentIdx].throttle?.toFixed(0)}%</span></div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}