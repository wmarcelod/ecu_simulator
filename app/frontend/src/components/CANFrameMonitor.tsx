import { useState, useEffect, useCallback, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { ECUSimulator, CANFrame } from '@/lib/ecu-simulator';
import { useTheme, t } from '@/lib/theme-context';

interface CANFrameMonitorProps {
  simulator: ECUSimulator;
}

const MAX_FRAMES_DISPLAY = 50;
const STATS_WINDOW_MS = 1000; // Calculate messages/sec over last 1 second

export default function CANFrameMonitor({ simulator }: CANFrameMonitorProps) {
  const { theme } = useTheme();
  const [frames, setFrames] = useState<CANFrame[]>(simulator.getCANFrames());
  const [rate, setRate] = useState(() => simulator.getCANFrameRate());
  const [filterById, setFilterById] = useState('');
  const [paused, setPaused] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<number>(0);
  const frameTimestampsRef = useRef<number[]>([]);
  const lastProcessedFrameCountRef = useRef(0);

  const updateFrames = useCallback(() => {
    if (!paused) {
      const allFrames = simulator.getCANFrames();
      setFrames([...allFrames.slice(-MAX_FRAMES_DISPLAY)]);

      // Track only newly observed frames; re-counting the whole buffer on
      // every animation frame inflates the traffic metrics.
      const now = Date.now();
      const previousCount = lastProcessedFrameCountRef.current;
      const newFrames =
        previousCount > 0 && allFrames.length >= previousCount
          ? allFrames.slice(previousCount)
          : allFrames;
      const newTimestamps = newFrames.map(() => now);
      frameTimestampsRef.current = [
        ...frameTimestampsRef.current.filter(ts => now - ts < STATS_WINDOW_MS),
        ...newTimestamps
      ];
      lastProcessedFrameCountRef.current = allFrames.length;

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
    frameTimestampsRef.current = [];
    lastProcessedFrameCountRef.current = 0;
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
    if (id >= 0x100 && id <= 0x1FF) return '#15803D'; // Engine
    if (id >= 0x200 && id <= 0x2FF) return '#1D4ED8'; // Powertrain
    if (id >= 0x300 && id <= 0x3FF) return '#B45309'; // Diagnostic
    if (id >= 0x400 && id <= 0x4FF) return '#7E22CE'; // Body
    if (id >= 0x500 && id <= 0x7FF) return '#0F766E'; // Standard
    return '#991B1B'; // Unknown/Attack
  };

  const getCategoryLabel = (id: number): string => {
    if (id >= 0x100 && id <= 0x1FF) return 'Engine';
    if (id >= 0x200 && id <= 0x2FF) return 'Power';
    if (id >= 0x300 && id <= 0x3FF) return 'Diag';
    if (id >= 0x400 && id <= 0x4FF) return 'Body';
    if (id >= 0x500 && id <= 0x7FF) return 'Std';
    return 'Other';
  };

  // Calculate statistics
  const calculateStats = () => {
    const now = Date.now();
    const recentTimestamps = frameTimestampsRef.current.filter(ts => now - ts < STATS_WINDOW_MS);
    const messagesPerSec = Math.round((recentTimestamps.length / STATS_WINDOW_MS) * 1000);

    // Unique CAN IDs in current buffer
    const uniqueIds = new Set(frames.map(f => f.id));
    const uniqueCount = uniqueIds.size;

    // Bus load estimation
    const theoreticalMaxPerSec = rate * 3; // 3 ECUs
    const busLoadPercent = ((messagesPerSec / theoreticalMaxPerSec) * 100).toFixed(1);

    // Top 5 CAN IDs
    const idFrequency = new Map<number, number>();
    frames.forEach(f => {
      idFrequency.set(f.id, (idFrequency.get(f.id) || 0) + 1);
    });
    const topIds = Array.from(idFrequency.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id, count]) => ({ id, count, percent: ((count / frames.length) * 100).toFixed(1) }));

    // Frame distribution by category
    const categoryCount = new Map<string, number>();
    frames.forEach(f => {
      const cat = getCategoryLabel(f.id);
      categoryCount.set(cat, (categoryCount.get(cat) || 0) + 1);
    });
    const categories = Array.from(categoryCount.entries())
      .map(([label, count]) => ({
        label,
        count,
        percent: ((count / frames.length) * 100).toFixed(1),
        color: getDataColor(getCategoryId(label))
      }));

    return { messagesPerSec, uniqueCount, busLoadPercent, topIds, categories };
  };

  const getCategoryId = (label: string): number => {
    if (label === 'Engine') return 0x150;
    if (label === 'Power') return 0x250;
    if (label === 'Diag') return 0x350;
    if (label === 'Body') return 0x450;
    if (label === 'Std') return 0x550;
    return 0x600;
  };

  const stats = calculateStats();

  return (
    <div className="space-y-3">
      {/* Bus Statistics Panel */}
      <div className={`${bg} border ${border} rounded-md p-3`}>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-1 h-3 bg-blue-500/70 rounded-full" />
          <span className={`text-[10px] font-mono ${textLabel} uppercase tracking-widest`}>Bus Statistics</span>
        </div>

        {/* Key Metrics Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
          {/* Messages/sec */}
          <div className={`${bg2} border ${border} rounded p-2`}>
            <div className={`text-[8px] font-mono ${textMuted} mb-1 uppercase`}>Msg/Sec</div>
            <div className="text-[14px] font-mono text-emerald-400 font-semibold">{stats.messagesPerSec}</div>
          </div>

          {/* Unique CAN IDs */}
          <div className={`${bg2} border ${border} rounded p-2`}>
            <div className={`text-[8px] font-mono ${textMuted} mb-1 uppercase`}>Unique IDs</div>
            <div className="text-[14px] font-mono text-cyan-400 font-semibold">{stats.uniqueCount}</div>
          </div>

          {/* Bus Load */}
          <div className={`${bg2} border ${border} rounded p-2`}>
            <div className={`text-[8px] font-mono ${textMuted} mb-1 uppercase`}>Bus Load</div>
            <div className="text-[14px] font-mono text-amber-400 font-semibold">{stats.busLoadPercent}%</div>
          </div>

          {/* Theoretical Max */}
          <div className={`${bg2} border ${border} rounded p-2`}>
            <div className={`text-[8px] font-mono ${textMuted} mb-1 uppercase`}>Max Frames/Sec</div>
            <div className="text-[14px] font-mono text-slate-400 font-semibold">{rate * 3}</div>
          </div>
        </div>

        {/* Top 5 CAN IDs Bar Chart */}
        {stats.topIds.length > 0 && (
          <div className="mb-4">
            <div className={`text-[9px] font-mono ${textMuted} mb-2 uppercase tracking-wider`}>Top 5 CAN IDs</div>
            <div className="space-y-1.5">
              {stats.topIds.map((item) => (
                <div key={item.id} className="flex items-center gap-2">
                  <div className="w-12 flex-shrink-0">
                    <span className="text-[9px] font-mono text-slate-400">
                      0x{item.id.toString(16).toUpperCase().padStart(3, '0')}
                    </span>
                  </div>
                  <div className="flex-1 h-4 bg-[#0f172a] rounded border border-[#1e293b]/50 overflow-hidden relative">
                    <div
                      className="h-full rounded transition-all"
                      style={{
                        width: `${item.percent}%`,
                        backgroundColor: getDataColor(item.id),
                        opacity: 0.7
                      }}
                    />
                  </div>
                  <div className="w-16 text-right">
                    <span className="text-[9px] font-mono text-slate-400">{item.percent}% ({item.count})</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Frame Distribution by Category */}
        {stats.categories.length > 0 && (
          <div>
            <div className={`text-[9px] font-mono ${textMuted} mb-2 uppercase tracking-wider`}>Frame Distribution</div>
            <div className="flex h-6 rounded border border-[#1e293b] overflow-hidden">
              {stats.categories.map((cat, idx) => (
                <div
                  key={cat.label}
                  className="transition-all relative group"
                  style={{
                    width: `${cat.percent}%`,
                    backgroundColor: cat.color,
                    opacity: 0.65
                  }}
                  title={`${cat.label}: ${cat.percent}% (${cat.count})`}
                >
                  {parseFloat(cat.percent) > 8 && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-[8px] font-mono text-white/80 font-semibold">
                        {cat.label}
                      </span>
                    </div>
                  )}
                  <div className={`absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 rounded text-[8px] font-mono whitespace-nowrap bg-[#0f172a] border border-[#1e293b] text-slate-300 pointer-events-none invisible group-hover:visible z-10`}>
                    {cat.label}: {cat.percent}% ({cat.count})
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-3 mt-2 flex-wrap text-[8px]">
              {stats.categories.map((cat) => (
                <div key={cat.label} className="flex items-center gap-1">
                  <div
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: cat.color, opacity: 0.7 }}
                  />
                  <span className={`font-mono ${textMuted}`}>{cat.label}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

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
