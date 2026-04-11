import { useState, useEffect, useCallback, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { ECUSimulator, CANFrame } from '@/lib/ecu-simulator';
import { useTheme, t } from '@/lib/theme-context';

interface AttackSimulatorProps {
  simulator: ECUSimulator;
}

interface AttackStats {
  totalFramesInjected: number;
  uniqueAttackIds: Set<number>;
  firstAttackTime: number | null;
  currentDoSRate: number;
}

const MAX_ATTACK_FRAMES = 100;

interface PresetAttack {
  id: string;
  name: string;
  description: string;
  riskLevel: 'LOW' | 'MED' | 'HIGH' | 'CRITICAL';
  execute: () => void;
}

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
  const [currentDoSRate, setCurrentDoSRate] = useState(0);

  // Fuzzing
  const [fuzzIdMin, setFuzzIdMin] = useState('0x100');
  const [fuzzIdMax, setFuzzIdMax] = useState('0x7FF');
  const [fuzzDuration, setFuzzDuration] = useState('5000');

  // GPS Spoofing
  const [gpsLat, setGpsLat] = useState('40.7128');
  const [gpsLon, setGpsLon] = useState('-74.0060');

  // Replay
  const [replaySpeed, setReplaySpeed] = useState('1.0');

  // Attack Stats
  const [attackStats, setAttackStats] = useState<AttackStats>({
    totalFramesInjected: 0,
    uniqueAttackIds: new Set(),
    firstAttackTime: null,
    currentDoSRate: 0,
  });

  const fuzzIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const animRef = useRef<number>(0);

  const updateAttackFrames = useCallback(() => {
    const frames = simulator.getAttackFrames();
    const framesSlice = [...frames.slice(-MAX_ATTACK_FRAMES)];
    setAttackFrames(framesSlice);
    setDosActive(simulator.isDoSActive());

    // Update statistics
    const uniqueIds = new Set<number>();
    frames.forEach((frame) => uniqueIds.add(frame.id));
    const firstTime = frames.length > 0 ? frames[0].timestamp : null;
    const dosRateValue = simulator.isDoSActive() ? parseInt(dosRate) : 0;

    setAttackStats({
      totalFramesInjected: frames.length,
      uniqueAttackIds: uniqueIds,
      firstAttackTime: firstTime,
      currentDoSRate: dosRateValue,
    });
    setCurrentDoSRate(dosRateValue);
  }, [simulator, dosRate]);

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
    setAttackStats({
      totalFramesInjected: 0,
      uniqueAttackIds: new Set(),
      firstAttackTime: null,
      currentDoSRate: 0,
    });
  };

  const getRiskLevelColor = (level: string) => {
    switch (level) {
      case 'LOW':
        return t('bg-emerald-950/30 border-emerald-800/50 text-emerald-400', 'bg-emerald-50 border-emerald-200 text-emerald-700', theme);
      case 'MED':
        return t('bg-yellow-950/30 border-yellow-800/50 text-yellow-400', 'bg-yellow-50 border-yellow-200 text-yellow-700', theme);
      case 'HIGH':
        return t('bg-orange-950/30 border-orange-800/50 text-orange-400', 'bg-orange-50 border-orange-200 text-orange-700', theme);
      case 'CRITICAL':
        return t('bg-red-950/30 border-red-800/50 text-red-400', 'bg-red-50 border-red-200 text-red-700', theme);
      default:
        return t('bg-slate-950/30 border-slate-800/50 text-slate-400', 'bg-slate-50 border-slate-200 text-slate-700', theme);
    }
  };

  const formatData = (data: Uint8Array) => {
    let hex = '';
    for (let i = 0; i < data.length; i++) {
      hex += data[i].toString(16).toUpperCase().padStart(2, '0') + ' ';
    }
    return hex.trim();
  };

  const executeEngineTakeover = () => {
    try {
      simulator.injectCANFrame(0x7e0, new Uint8Array([0x00, 0xFF, 0xFF, 0x00, 0x00, 0x00, 0x00, 0x00]));
      simulator.startDoSAttack(0x7e0, 5000);
      setDosFrameId('0x7E0');
      setDosRate('5000');
      setDosActive(true);
      updateAttackFrames();
    } catch (e) {
      alert('Engine Takeover preset failed');
    }
  };

  const executeBrakeOverride = () => {
    try {
      simulator.injectCANFrame(0x7e2, new Uint8Array([0x00, 0x00, 0xFF, 0x01, 0x00, 0x00, 0x00, 0x00]));
      updateAttackFrames();
    } catch (e) {
      alert('Brake Override preset failed');
    }
  };

  const executeSpeedSpoof = () => {
    try {
      simulator.injectCANFrame(0x7e0, new Uint8Array([0x00, 0x00, 0x00, 0x00, 0xFF, 0x00, 0x00, 0x00]));
      updateAttackFrames();
    } catch (e) {
      alert('Speed Spoof preset failed');
    }
  };

  const executeStealthDTCClear = () => {
    try {
      simulator.injectCANFrame(0x7DF, new Uint8Array([0x02, 0x14, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]));
      updateAttackFrames();
    } catch (e) {
      alert('Stealth DTC Clear preset failed');
    }
  };

  const executeBusFlood = () => {
    try {
      const randomId = Math.floor(Math.random() * 0x800);
      simulator.startDoSAttack(randomId, 5000);
      setDosFrameId(`0x${randomId.toString(16).toUpperCase()}`);
      setDosRate('5000');
      setDosActive(true);
      updateAttackFrames();
    } catch (e) {
      alert('Bus Flood preset failed');
    }
  };

  const executeRandomFuzzing = () => {
    try {
      simulator.startFuzzing(0x100, 0x7FF, 10000);
      setFuzzIdMin('0x100');
      setFuzzIdMax('0x7FF');
      setFuzzDuration('10000');
      updateAttackFrames();
    } catch (e) {
      alert('Random Fuzzing preset failed');
    }
  };

  const presetAttacks: PresetAttack[] = [
    {
      id: 'engine-takeover',
      name: 'Engine Takeover',
      description: 'Max RPM injection + DoS on 0x7E0',
      riskLevel: 'CRITICAL',
      execute: executeEngineTakeover,
    },
    {
      id: 'brake-override',
      name: 'Brake Override',
      description: 'Inject brake pressure 0xFF + ABS active',
      riskLevel: 'CRITICAL',
      execute: executeBrakeOverride,
    },
    {
      id: 'speed-spoof',
      name: 'Speed Spoof',
      description: 'Set speed byte to 0xFF (255 km/h)',
      riskLevel: 'HIGH',
      execute: executeSpeedSpoof,
    },
    {
      id: 'stealth-dtc',
      name: 'Stealth DTC Clear',
      description: 'Inject OBD-II service 0x14 DTC clear',
      riskLevel: 'HIGH',
      execute: executeStealthDTCClear,
    },
    {
      id: 'bus-flood',
      name: 'Bus Flood',
      description: 'DoS attack at 5000Hz on random ID',
      riskLevel: 'MED',
      execute: executeBusFlood,
    },
    {
      id: 'random-fuzzing',
      name: 'Random Fuzzing',
      description: '10-second fuzzing on full ID range',
      riskLevel: 'LOW',
      execute: executeRandomFuzzing,
    },
  ];

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

      {/* Attack Presets Panel */}
      <div className={`${bg} border ${border} rounded-md p-3`}>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-1 h-3 bg-amber-500/70 rounded-full" />
          <span className={`text-[10px] font-mono ${textLabel} uppercase tracking-widest`}>Quick Attack Presets</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {presetAttacks.map((preset) => (
            <div
              key={preset.id}
              className={`border rounded-md p-2.5 flex flex-col gap-1.5 transition-all hover:shadow-md ${getRiskLevelColor(preset.riskLevel)}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <div className="text-[10px] font-mono font-semibold">{preset.name}</div>
                  <div className={`text-[8px] font-mono mt-0.5 ${textMuted}`}>{preset.description}</div>
                </div>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className={`text-[7px] font-mono font-bold uppercase px-1.5 py-0.5 rounded ${getRiskLevelColor(preset.riskLevel)}`}>
                  {preset.riskLevel}
                </span>
                <button
                  onClick={preset.execute}
                  className={`h-6 px-2.5 text-[9px] font-mono uppercase rounded border transition-colors ${
                    preset.riskLevel === 'CRITICAL'
                      ? 'bg-red-950/40 border-red-800/40 text-red-400 hover:bg-red-950/60'
                      : preset.riskLevel === 'HIGH'
                        ? 'bg-orange-950/40 border-orange-800/40 text-orange-400 hover:bg-orange-950/60'
                        : preset.riskLevel === 'MED'
                          ? 'bg-yellow-950/40 border-yellow-800/40 text-yellow-400 hover:bg-yellow-950/60'
                          : 'bg-emerald-950/40 border-emerald-800/40 text-emerald-400 hover:bg-emerald-950/60'
                  }`}
                >
                  ▶ Launch
                </button>
              </div>
            </div>
          ))}
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

      {/* Attack Statistics Summary */}
      <div className={`${bg} border ${border} rounded-md p-3`}>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-1 h-3 bg-purple-500/70 rounded-full" />
          <span className={`text-[10px] font-mono ${textLabel} uppercase tracking-widest`}>Attack Statistics</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {/* Total Frames Injected */}
          <div className={`${bg2} border ${border} rounded p-2`}>
            <div className={`text-[8px] font-mono ${textMuted} uppercase mb-1`}>Total Frames</div>
            <div className="text-[14px] font-mono font-semibold text-red-400">{attackStats.totalFramesInjected}</div>
          </div>

          {/* Unique Attack IDs */}
          <div className={`${bg2} border ${border} rounded p-2`}>
            <div className={`text-[8px] font-mono ${textMuted} uppercase mb-1`}>Unique IDs</div>
            <div className="text-[14px] font-mono font-semibold text-amber-400">{attackStats.uniqueAttackIds.size}</div>
          </div>

          {/* Attack Duration */}
          <div className={`${bg2} border ${border} rounded p-2`}>
            <div className={`text-[8px] font-mono ${textMuted} uppercase mb-1`}>Duration (s)</div>
            <div className="text-[14px] font-mono font-semibold text-blue-400">
              {attackStats.firstAttackTime && attackStats.totalFramesInjected > 0
                ? ((Date.now() - attackStats.firstAttackTime) / 1000).toFixed(1)
                : '0.0'}
            </div>
          </div>

          {/* Current DoS Rate */}
          <div className={`${bg2} border ${border} rounded p-2`}>
            <div className={`text-[8px] font-mono ${textMuted} uppercase mb-1`}>DoS Rate (Hz)</div>
            <div className={`text-[14px] font-mono font-semibold ${dosActive ? 'text-red-400 animate-pulse' : 'text-slate-500'}`}>
              {dosActive ? currentDoSRate : '—'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
