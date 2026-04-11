import { useState, useEffect, useCallback, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { ECUSimulator, CANFrame } from '@/lib/ecu-simulator';
import { useTheme, t } from '@/lib/theme-context';

interface CANFrameMonitorProps {
  simulator: ECUSimulator;
}

const MAX_FRAMES_DISPLAY = 50;

export default function CANFrameMonitor({ simulator }: CANFrameMonitorProps) {
  const { theme } = useTheme();
  const [frames, setFrames] = useState<CANFrame[]>(simulator.getCANFrames());
  const [rate, setRate] = useState(100);
  const [filterById, setFilterById] = useState('');
  const [paused, setPaused] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<number>(0);

  const updateFrames = useCallback(() => {
    if (!paused) {
      const allFrames = simulator.getCANFrames();
      setFrames([...allFrames.slice(-MAX_FRAMES_DISPLAY)]);
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    }
    animRef.current = requestAnimationFrame(updateFrames);
  }, [simulator, paused]);

  useEffect(() => {
    animRef.current = requestAnimationFrame(updateFrames);
    return () => cancelAnimationFrame(animRef.current);
  }, [updateFrames]);

  const handleRateChange = (newRate: string) => {
    const hz = parseInt(newRate);
    if (!isNaN(hz) && hz >= 1 && hz <= 100) {
      simulator.setCANFrameRate(hz);
      setRate(hz);
    }
  };

  const handleClear = () => {
    simulator.clearCANFrames();
    setFrames([]);
  };

  const bg = t('bg-[#111827]', 'bg-white', theme);
  const border = t('border-[#1e293b]', 'border-gray-200', theme);
  const textMuted = t('text-slate-500', 'text-gray-500', theme);
  const textLabel = t('text-slate-400', 'text-gray-600', theme);
  const bg2 = t('bg-[#0f172a]', 'bg-gray-50', theme);

  const filteredFrames = filterById
    ? frames.filter((f) => f.id.toString(16).toUpperCase().includes(filterById.toUpperCase()))
    : frames;

  const formatData = (data: Uint8Array) => {
    let hex = '';
    for (let i = 0; i < data.length; i++) {
      hex += data[i].toString(16).toUpperCase().padStart(2, '0') + ' ';
    }
    return hex.trim();
  };

  const getDataColor = (id: number) => {
    if (id >= 0x100 && id <= 0x1FF) return '#4ade80'; // Engine
    if (id >= 0x200 && id <= 0x2FF) return '#38bdf8'; // Powertrain
    if (id >= 0x300 && id <= 0x3FF) return '#f59e0b'; // Diagnostic
    if (id >= 0x400 && id <= 0x4FF) return '#a78bfa'; // Body
    if (id >= 0x500 && id <= 0x7FF) return '#2dd4bf'; // Standard
    return '#ef4444'; // Unknown/Attack
  };

  return (
    <div className="space-y-3">
      {/* Controls */}
      <div className={`${bg} border ${border} rounded-md p-3`}>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-1 h-3 bg-orange-500/70 rounded-full" />
          <span className={`text-[10px] font-mono ${textLabel} uppercase tracking-widest`}>CAN Frame Monitor</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
          {/* Rate Control */}
          <div className="flex flex-col">
            <label className={`text-[9px] font-mono ${textMuted} mb-1`}>Frame Rate (Hz)</label>
            <Input
              type="number"
              min="1"
              max="100"
              value={rate}
              onChange={(e) => handleRateChange(e.target.value)}
              className={`h-7 ${bg2} ${border} text-[11px] font-mono rounded text-emerald-300`}
            />
          </div>

          {/* Filter */}
          <div className="flex flex-col">
            <label className={`text-[9px] font-mono ${textMuted} mb-1`}>Filter by CAN ID</label>
            <Input
              placeholder="e.g., 0x100 or 100"
              value={filterById}
              onChange={(e) => setFilterById(e.target.value)}
              className={`h-7 ${bg2} ${border} text-[11px] font-mono rounded text-slate-300 placeholder-slate-600`}
            />
          </div>

          {/* Frame Count */}
          <div className="flex flex-col">
            <label className={`text-[9px] font-mono ${textMuted} mb-1`}>Total Frames</label>
            <div className={`h-7 rounded border ${border} ${bg2} flex items-center justify-center`}>
              <span className="text-[11px] font-mono text-cyan-400">{frames.length}</span>
            </div>
          </div>

          {/* Buttons */}
          <div className="flex gap-2 pt-5">
            <button
              onClick={() => setPaused(!paused)}
              className={`flex-1 h-7 text-[10px] font-mono uppercase rounded border transition-colors ${
                paused
                  ? 'bg-amber-950/40 border-amber-800/40 text-amber-400 hover:bg-amber-950/60'
                  : 'bg-emerald-950/40 border-emerald-800/40 text-emerald-400 hover:bg-emerald-950/60'
              }`}
            >
              {paused ? '▶ RESUME' : '⏸ PAUSE'}
            </button>
            <button
              onClick={handleClear}
              className="flex-1 h-7 text-[10px] font-mono uppercase rounded border border-red-800/40 bg-red-950/40 text-red-400 hover:bg-red-950/60"
            >
              CLEAR
            </button>
          </div>
        </div>
      </div>

      {/* Frame List */}
      <div className={`${bg} border ${border} rounded-md overflow-hidden flex flex-col h-80`}>
        <div className="px-3 py-1.5 border-b border-[#1e293b] flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-orange-500" />
          <span className={`text-[10px] font-mono ${textLabel} uppercase tracking-widest`}>CAN Frames — {filteredFrames.length} displayed</span>
          {!paused && <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse ml-auto" />}
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto font-mono text-[9px]">
          {filteredFrames.length === 0 ? (
            <div className={`p-3 text-center ${textMuted}`}>No frames to display</div>
          ) : (
            <div>
              {filteredFrames.map((frame, idx) => {
                const color = getDataColor(frame.id);
                const timestamp = frame.timestamp ? `+${(frame.timestamp / 1000).toFixed(3)}s` : '?';
                return (
                  <div key={`${frame.id}-${frame.timestamp}-${idx}`} className={`px-3 py-1 border-b border-[#1e293b]/30 last:border-b-0 ${idx % 2 === 0 ? 'bg-[#0f172a]/50' : ''} hover:bg-[#1e293b] transition-colors group`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-shrink-0 min-w-fit">
                        <span className={`font-semibold`} style={{ color }}>
                          0x{frame.id.toString(16).toUpperCase().padStart(3, '0')}
                        </span>
                        <span className={`ml-2 text-slate-600`}>{timestamp}</span>
                      </div>
                      <div className="flex-1 text-slate-400 break-all">
                        {formatData(frame.data)}
                      </div>
                      <div className="flex-shrink-0 text-slate-600 group-hover:text-slate-500">
                        {frame.data.length} bytes
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Legend */}
      <div className={`${bg} border ${border} rounded-md p-3`}>
        <div className="text-[9px] font-mono text-slate-500 mb-2">CAN ID Ranges (Color Legend)</div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-[9px]">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-[#4ade80]" />
            <span className="text-slate-400">0x100-0x1FF (Engine)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-[#38bdf8]" />
            <span className="text-slate-400">0x200-0x2FF (Power)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-[#f59e0b]" />
            <span className="text-slate-400">0x300-0x3FF (Diag)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-[#a78bfa]" />
            <span className="text-slate-400">0x400-0x4FF (Body)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-[#ef4444]" />
            <span className="text-slate-400">Attack/Other</span>
          </div>
        </div>
      </div>
    </div>
  );
}
