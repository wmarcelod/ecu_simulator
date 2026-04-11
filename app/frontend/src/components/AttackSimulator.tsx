import { useState, useEffect, useCallback, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { ECUSimulator, CANFrame } from '@/lib/ecu-simulator';
import { useTheme, t } from '@/lib/theme-context';

interface AttackSimulatorProps {
  simulator: ECUSimulator;
}

const MAX_ATTACK_FRAMES = 100;

export default function AttackSimulator({ simulator }: AttackSimulatorProps) {
  const { theme } = useTheme();
  const [attackFrames, setAttackFrames] = useState<CANFrame[]>(simulator.getAttackFrames());
  const [dosActive, setDosActive] = useState(simulator.isDoSActive());

  // Inject CAN Frame
  const [injectId, setInjectId] = useState('0x123');
  const [injectData, setInjectData] = useState('00 11 22 33 44 55 66 77');

  // DoS Attack
  const [dosFrameId, setDosFrameId] = useState('0x100');
  const [dosRate, setDosRate] = useState('1000');

  // Fuzzing
  const [fuzzIdMin, setFuzzIdMin] = useState('0x100');
  const [fuzzIdMax, setFuzzIdMax] = useState('0x7FF');
  const [fuzzDuration, setFuzzDuration] = useState('5000');

  // GPS Spoofing
  const [gpsLat, setGpsLat] = useState('40.7128');
  const [gpsLon, setGpsLon] = useState('-74.0060');

  // Replay
  const [replaySpeed, setReplaySpeed] = useState('1.0');

  const fuzzIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const animRef = useRef<number>(0);

  const updateAttackFrames = useCallback(() => {
    const frames = simulator.getAttackFrames();
    setAttackFrames([...frames.slice(-MAX_ATTACK_FRAMES)]);
    setDosActive(simulator.isDoSActive());
  }, [simulator]);

  useEffect(() => {
    animRef.current = requestAnimationFrame(() => {
      updateAttackFrames();
      setTimeout(() => {
        animRef.current = requestAnimationFrame(() => updateAttackFrames());
      }, 100);
    });
    return () => cancelAnimationFrame(animRef.current);
  }, [updateAttackFrames]);

  const parseHex = (hex: string): number => {
    if (hex.startsWith('0x') || hex.startsWith('0X')) {
      return parseInt(hex, 16);
    }
    return parseInt(hex, 16);
  };

  const handleInjectFrame = () => {
    try {
      const id = parseHex(injectId);
      const bytes = injectData
        .split(/[\s,]+/)
        .filter((b) => b.length > 0)
        .map((b) => parseHex(b));

      if (bytes.length > 8) {
        alert('Maximum 8 bytes allowed');
        return;
      }

      simulator.injectCANFrame(id, new Uint8Array(bytes));
      updateAttackFrames();
    } catch (e) {
      alert('Invalid hex data');
    }
  };

  const handleStartDoS = () => {
    try {
      const id = parseHex(dosFrameId);
      const rate = Math.min(Math.max(parseInt(dosRate), 1), 10000);
      simulator.startDoSAttack(id, rate);
      setDosActive(true);
      updateAttackFrames();
    } catch (e) {
      alert('Invalid parameters');
    }
  };

  const handleStopDoS = () => {
    simulator.stopDoSAttack();
    setDosActive(false);
  };

  const handleStartFuzzing = () => {
    try {
      const idMin = parseHex(fuzzIdMin);
      const idMax = parseHex(fuzzIdMax);
      const duration = Math.min(Math.max(parseInt(fuzzDuration), 100), 60000);
      simulator.startFuzzing(idMin, idMax, duration);
      updateAttackFrames();
    } catch (e) {
      alert('Invalid parameters');
    }
  };

  const handleInjectGPSSpoofing = () => {
    try {
      const lat = parseFloat(gpsLat);
      const lon = parseFloat(gpsLon);

      if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
        alert('Invalid GPS coordinates');
        return;
      }

      simulator.injectGPSSpoofing(lat, lon);
      updateAttackFrames();
    } catch (e) {
      alert('Invalid GPS coordinates');
    }
  };

  const handleReplayFrames = () => {
    try {
      if (attackFrames.length === 0) {
        alert('No attack frames to replay');
        return;
      }
      const speed = Math.max(0.1, parseFloat(replaySpeed));
      simulator.replayCANFrames(attackFrames, speed);
      updateAttackFrames();
    } catch (e) {
      alert('Invalid replay parameters');
    }
  };

  const handleClearAttackFrames = () => {
    simulator.clearAttackFrames();
    setAttackFrames([]);
  };

  const formatData = (data: Uint8Array) => {
    let hex = '';
    for (let i = 0; i < data.length; i++) {
      hex += data[i].toString(16).toUpperCase().padStart(2, '0') + ' ';
    }
    return hex.trim();
  };

  const bg = t('bg-[#111827]', 'bg-white', theme);
  const border = t('border-[#1e293b]', 'border-gray-200', theme);
  const textMuted = t('text-slate-500', 'text-gray-500', theme);
  const textLabel = t('text-slate-400', 'text-gray-600', theme);
  const bg2 = t('bg-[#0f172a]', 'bg-gray-50', theme);

  return (
    <div className="space-y-3">
      {/* Warning Banner */}
      <div className="bg-red-950/30 border border-red-800/50 rounded-md px-3 py-2 flex items-start gap-2">
        <span className="text-red-500 text-[14px]">⚠</span>
        <div>
          <div className="text-[10px] font-mono text-red-400 uppercase font-semibold">Attack Simulation Mode</div>
          <div className="text-[9px] font-mono text-red-300 mt-0.5">For testing IDS/IPS systems only. Use responsibly.</div>
        </div>
      </div>

      {/* Inject CAN Frame */}
      <div className={`${bg} border ${border} rounded-md p-3`}>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-1 h-3 bg-red-500/70 rounded-full" />
          <span className={`text-[10px] font-mono ${textLabel} uppercase tracking-widest`}>Inject CAN Frame</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-2">
          <div>
            <label className={`text-[9px] font-mono ${textMuted} mb-1 block`}>CAN ID (hex)</label>
            <Input
              value={injectId}
              onChange={(e) => setInjectId(e.target.value)}
              placeholder="0x123"
              className={`h-7 ${bg2} ${border} text-[11px] font-mono rounded text-emerald-300`}
            />
          </div>
          <div className="sm:col-span-2">
            <label className={`text-[9px] font-mono ${textMuted} mb-1 block`}>Data (hex, space-separated)</label>
            <Input
              value={injectData}
              onChange={(e) => setInjectData(e.target.value)}
              placeholder="00 11 22 33 44 55 66 77"
              className={`h-7 ${bg2} ${border} text-[11px] font-mono rounded text-emerald-300`}
            />
          </div>
        </div>
        <button
          onClick={handleInjectFrame}
          className="h-7 px-3 text-[10px] font-mono uppercase bg-red-950/40 border border-red-800/40 text-red-400 hover:bg-red-950/60 rounded"
        >
          ✦ Inject Frame
        </button>
      </div>

      {/* DoS Attack */}
      <div className={`${bg} border ${border} rounded-md p-3`}>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-1 h-3 bg-red-600/70 rounded-full" />
          <span className={`text-[10px] font-mono ${textLabel} uppercase tracking-widest`}>Denial of Service (DoS)</span>
          {dosActive && <span className="text-[9px] font-mono text-red-500 animate-pulse font-semibold ml-auto">● ACTIVE</span>}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-2">
          <div>
            <label className={`text-[9px] font-mono ${textMuted} mb-1 block`}>Frame ID (hex)</label>
            <Input
              value={dosFrameId}
              onChange={(e) => setDosFrameId(e.target.value)}
              disabled={dosActive}
              placeholder="0x100"
              className={`h-7 ${bg2} ${border} text-[11px] font-mono rounded text-emerald-300 disabled:opacity-50`}
            />
          </div>
          <div>
            <label className={`text-[9px] font-mono ${textMuted} mb-1 block`}>Rate (Hz)</label>
            <Input
              value={dosRate}
              onChange={(e) => setDosRate(e.target.value)}
              disabled={dosActive}
              placeholder="1000"
              className={`h-7 ${bg2} ${border} text-[11px] font-mono rounded text-emerald-300 disabled:opacity-50`}
            />
          </div>
          <div className="flex gap-2 pt-5">
            {dosActive ? (
              <button
                onClick={handleStopDoS}
                className="flex-1 h-7 text-[10px] font-mono uppercase bg-red-950/60 border border-red-800/60 text-red-400 hover:bg-red-950/80 rounded"
              >
                ■ Stop DoS
              </button>
            ) : (
              <button
                onClick={handleStartDoS}
                className="flex-1 h-7 text-[10px] font-mono uppercase bg-red-950/40 border border-red-800/40 text-red-400 hover:bg-red-950/60 rounded"
              >
                ▶ Start DoS
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Fuzzing */}
      <div className={`${bg} border ${border} rounded-md p-3`}>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-1 h-3 bg-orange-600/70 rounded-full" />
          <span className={`text-[10px] font-mono ${textLabel} uppercase tracking-widest`}>Fuzzing Attack</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 mb-2">
          <div>
            <label className={`text-[9px] font-mono ${textMuted} mb-1 block`}>ID Min (hex)</label>
            <Input
              value={fuzzIdMin}
              onChange={(e) => setFuzzIdMin(e.target.value)}
              placeholder="0x100"
              className={`h-7 ${bg2} ${border} text-[11px] font-mono rounded text-emerald-300`}
            />
          </div>
          <div>
            <label className={`text-[9px] font-mono ${textMuted} mb-1 block`}>ID Max (hex)</label>
            <Input
              value={fuzzIdMax}
              onChange={(e) => setFuzzIdMax(e.target.value)}
              placeholder="0x7FF"
              className={`h-7 ${bg2} ${border} text-[11px] font-mono rounded text-emerald-300`}
            />
          </div>
          <div>
            <label className={`text-[9px] font-mono ${textMuted} mb-1 block`}>Duration (ms)</label>
            <Input
              value={fuzzDuration}
              onChange={(e) => setFuzzDuration(e.target.value)}
              placeholder="5000"
              className={`h-7 ${bg2} ${border} text-[11px] font-mono rounded text-emerald-300`}
            />
          </div>
          <div className="flex items-end pt-1">
            <button
              onClick={handleStartFuzzing}
              className="w-full h-7 text-[10px] font-mono uppercase bg-orange-950/40 border border-orange-800/40 text-orange-400 hover:bg-orange-950/60 rounded"
            >
              ▶ Fuzz
            </button>
          </div>
        </div>
      </div>

      {/* GPS Spoofing */}
      <div className={`${bg} border ${border} rounded-md p-3`}>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-1 h-3 bg-yellow-600/70 rounded-full" />
          <span className={`text-[10px] font-mono ${textLabel} uppercase tracking-widest`}>GPS Spoofing</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-2">
          <div>
            <label className={`text-[9px] font-mono ${textMuted} mb-1 block`}>Latitude (±90)</label>
            <Input
              value={gpsLat}
              onChange={(e) => setGpsLat(e.target.value)}
              placeholder="40.7128"
              className={`h-7 ${bg2} ${border} text-[11px] font-mono rounded text-emerald-300`}
            />
          </div>
          <div>
            <label className={`text-[9px] font-mono ${textMuted} mb-1 block`}>Longitude (±180)</label>
            <Input
              value={gpsLon}
              onChange={(e) => setGpsLon(e.target.value)}
              placeholder="-74.0060"
              className={`h-7 ${bg2} ${border} text-[11px] font-mono rounded text-emerald-300`}
            />
          </div>
          <div className="flex items-end pt-1">
            <button
              onClick={handleInjectGPSSpoofing}
              className="w-full h-7 text-[10px] font-mono uppercase bg-yellow-950/40 border border-yellow-800/40 text-yellow-400 hover:bg-yellow-950/60 rounded"
            >
              ✦ Inject GPS
            </button>
          </div>
        </div>
      </div>

      {/* Replay */}
      <div className={`${bg} border ${border} rounded-md p-3`}>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-1 h-3 bg-purple-600/70 rounded-full" />
          <span className={`text-[10px] font-mono ${textLabel} uppercase tracking-widest`}>Replay Captured Frames</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-2">
          <div>
            <label className={`text-[9px] font-mono ${textMuted} mb-1 block`}>Speed Multiplier</label>
            <Input
              value={replaySpeed}
              onChange={(e) => setReplaySpeed(e.target.value)}
              placeholder="1.0"
              className={`h-7 ${bg2} ${border} text-[11px] font-mono rounded text-emerald-300`}
            />
          </div>
          <div className="flex items-end pt-1 col-span-2">
            <button
              onClick={handleReplayFrames}
              disabled={attackFrames.length === 0}
              className={`flex-1 h-7 text-[10px] font-mono uppercase rounded ${
                attackFrames.length === 0
                  ? 'opacity-40 cursor-not-allowed bg-purple-950/20 border border-purple-800/20 text-purple-400/50'
                  : 'bg-purple-950/40 border border-purple-800/40 text-purple-400 hover:bg-purple-950/60'
              }`}
            >
              ⟳ Replay ({attackFrames.length})
            </button>
          </div>
        </div>
      </div>

      {/* Attack Frames Log */}
      <div className={`${bg} border ${border} rounded-md overflow-hidden flex flex-col h-64`}>
        <div className="px-3 py-1.5 border-b border-[#1e293b] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-red-500" />
            <span className={`text-[10px] font-mono ${textLabel} uppercase tracking-widest`}>Attack Frames Log</span>
          </div>
          <button
            onClick={handleClearAttackFrames}
            className="text-[9px] font-mono text-slate-600 hover:text-red-400 transition-colors"
          >
            Clear
          </button>
        </div>

        <div className="flex-1 overflow-y-auto font-mono text-[8px]">
          {attackFrames.length === 0 ? (
            <div className={`p-3 text-center ${textMuted}`}>No attack frames injected yet</div>
          ) : (
            <div>
              {attackFrames.map((frame, idx) => (
                <div key={`${frame.id}-${frame.timestamp}-${idx}`} className={`px-3 py-0.5 border-b border-[#1e293b]/30 last:border-b-0 ${idx % 2 === 0 ? 'bg-[#0f172a]/30' : ''}`}>
                  <div className="text-red-400">
                    <span className="font-semibold">0x{frame.id.toString(16).toUpperCase().padStart(3, '0')}</span>
                    <span className="text-slate-600 ml-2">{formatData(frame.data)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
