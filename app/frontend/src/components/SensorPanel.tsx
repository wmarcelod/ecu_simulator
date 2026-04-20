import { useState, useEffect, useRef, useCallback } from 'react';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import { ECUSimulator, SensorState, SensorMode } from '@/lib/ecu-simulator';
import { useTheme, t } from '@/lib/theme-context';
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts';

interface SensorConfig {
  key: keyof SensorState;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  color: string;
}

// OBD-II full-range scales per sensor
const SENSORS: SensorConfig[] = [
  { key: 'rpm', label: 'RPM', unit: 'rpm', min: 0, max: 8000, step: 10, color: '#15803D' },
  { key: 'speed', label: 'SPEED', unit: 'km/h', min: 0, max: 255, step: 1, color: '#1D4ED8' },
  { key: 'coolantTemp', label: 'COOLANT', unit: '°C', min: -40, max: 215, step: 1, color: '#15803D' },
  { key: 'engineLoad', label: 'LOAD', unit: '%', min: 0, max: 100, step: 1, color: '#1D4ED8' },
  { key: 'throttle', label: 'THROTTLE', unit: '%', min: 0, max: 100, step: 1, color: '#0F766E' },
  { key: 'intakeMAP', label: 'MAP', unit: 'kPa', min: 0, max: 255, step: 1, color: '#0F766E' },
  { key: 'mafRate', label: 'MAF', unit: 'g/s', min: 0, max: 655.35, step: 0.01, color: '#7E22CE' },
  { key: 'timingAdvance', label: 'TIMING', unit: '°', min: -64, max: 63.5, step: 0.5, color: '#4338CA' },
  { key: 'intakeAirTemp', label: 'IAT', unit: '°C', min: -40, max: 215, step: 1, color: '#C2410C' },
  { key: 'fuelLevel', label: 'FUEL', unit: '%', min: 0, max: 100, step: 0.1, color: '#B45309' },
  { key: 'ambientTemp', label: 'AMBIENT', unit: '°C', min: -40, max: 215, step: 1, color: '#BE185D' },
  { key: 'controlVoltage', label: 'VOLTAGE', unit: 'V', min: 0, max: 16, step: 0.1, color: '#7E22CE' },
  { key: 'oilTemp', label: 'OIL TEMP', unit: '°C', min: -40, max: 215, step: 1, color: '#991B1B' },
  { key: 'baroPressure', label: 'BARO', unit: 'kPa', min: 0, max: 255, step: 1, color: '#475569' },
];

const MAX_HISTORY = 60;

interface ChartPoint {
  t: number;
  [key: string]: number;
}

interface SensorPanelProps {
  simulator: ECUSimulator;
}

export default function SensorPanel({ simulator }: SensorPanelProps) {
  const { theme } = useTheme();
  const [state, setState] = useState<SensorState>(simulator.getState());
  const [chartData, setChartData] = useState<ChartPoint[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set(['rpm', 'speed', 'coolantTemp']));
  const [sensorModes, setSensorModes] = useState<Record<string, SensorMode>>({});
  const [yMin, setYMin] = useState<string>('');
  const [yMax, setYMax] = useState<string>('');
  const [autoScale, setAutoScale] = useState(true);
  const tickRef = useRef(0);
  const animRef = useRef<number>(0);

  const refreshModes = useCallback(() => {
    const modes: Record<string, SensorMode> = {};
    const allModes = simulator.getAllSensorModes();
    for (const key of Object.keys(allModes)) {
      modes[key] = allModes[key].mode;
    }
    setSensorModes(modes);
  }, [simulator]);

  const loop = useCallback(() => {
    const s = simulator.getState();
    setState(s);
    tickRef.current++;
    if (tickRef.current % 5 === 0) {
      const pt: ChartPoint = { t: tickRef.current / 5 };
      SENSORS.forEach((sc) => { pt[sc.key] = Number((s[sc.key] ?? 0).toFixed(2)); });
      setChartData((prev) => [...prev.slice(-MAX_HISTORY), pt]);
    }
    if (tickRef.current % 10 === 0) {
      refreshModes();
    }
    animRef.current = requestAnimationFrame(loop);
  }, [simulator, refreshModes]);

  useEffect(() => {
    refreshModes();
    animRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animRef.current);
  }, [loop, refreshModes]);

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const toggleSensorMode = (key: string) => {
    const current = sensorModes[key] || 'auto';
    const newMode: SensorMode = current === 'auto' ? 'manual' : 'auto';
    simulator.setSensorMode(key, newMode);
    setSensorModes((prev) => ({ ...prev, [key]: newMode }));
  };

  const handleManualChange = (key: string, value: number) => {
    simulator.setManualValue(key, value);
  };

  const setAllMode = (mode: SensorMode) => {
    simulator.setAllSensorsMode(mode);
    refreshModes();
  };

  const manualCount = Object.values(sensorModes).filter((m) => m === 'manual').length;

  // Compute auto Y-axis domain from visible chart data
  const computeYDomain = (): [number, number] | undefined => {
    if (!autoScale) {
      const min = parseFloat(yMin);
      const max = parseFloat(yMax);
      if (!isNaN(min) && !isNaN(max) && min < max) return [min, max];
    }
    if (chartData.length < 2) return undefined;
    const activeKeys = SENSORS.filter((sc) => selected.has(sc.key)).map((sc) => sc.key);
    if (activeKeys.length === 0) return undefined;
    let lo = Infinity;
    let hi = -Infinity;
    for (const pt of chartData) {
      for (const k of activeKeys) {
        const v = pt[k];
        if (v !== undefined) {
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
      }
    }
    if (!isFinite(lo) || !isFinite(hi)) return undefined;
    const margin = (hi - lo) * 0.1 || 10;
    return [Math.floor(lo - margin), Math.ceil(hi + margin)];
  };

  const yDomain = computeYDomain();

  // Theme colors
  const bg = t('bg-[#111827]', 'bg-white', theme);
  const border = t('border-[#1e293b]', 'border-gray-200', theme);
  const bg2 = t('bg-[#0f172a]', 'bg-gray-50', theme);
  const textMuted = t('text-slate-500', 'text-gray-500', theme);
  const textLabel = t('text-slate-400', 'text-gray-600', theme);
  const textValue = t('text-slate-600', 'text-gray-400', theme);

  return (
    <div className="space-y-3">
      {/* Mode Controls */}
      <div className={`${bg} border ${border} rounded-md p-3`}>
        <div className="flex items-center gap-3 mb-2">
          <div className="w-1 h-3 bg-emerald-500/70 rounded-full" />
          <span className={`text-[11px] font-mono ${textLabel} uppercase tracking-widest`}>Sensor Control Mode</span>
          {manualCount > 0 && (
            <span className="text-[10px] font-mono text-amber-400 bg-amber-950/40 border border-amber-800/40 px-2 py-0.5 rounded flex items-center gap-1">
              ⚠ {manualCount} MANUAL OVERRIDE{manualCount > 1 ? 'S' : ''} ACTIVE
            </span>
          )}
          <div className="ml-auto flex gap-1">
            <button
              className="h-6 px-2.5 text-[10px] font-mono rounded border border-emerald-800/40 bg-emerald-950/30 text-emerald-400 hover:bg-emerald-900/40"
              onClick={() => setAllMode('auto')}
            >
              ALL AUTO
            </button>
            <button
              className="h-6 px-2.5 text-[10px] font-mono rounded border border-amber-800/40 bg-amber-950/30 text-amber-400 hover:bg-amber-900/40"
              onClick={() => setAllMode('manual')}
            >
              ALL MANUAL
            </button>
          </div>
        </div>
        <p className={`text-[10px] font-mono ${textMuted}`}>
          AUTO = realistic simulation · MANUAL = fixed value (attack/injection simulation)
        </p>
      </div>

      {/* Chart Channels */}
      <div className={`${bg} border ${border} rounded-md p-2`}>
        <div className="flex items-center gap-2 mb-2">
          <div className="w-1 h-3 bg-emerald-500/70 rounded-full" />
          <span className={`text-[10px] font-mono ${textMuted} uppercase tracking-widest`}>Chart Channels</span>
        </div>
        <div className="flex flex-wrap gap-1">
          {SENSORS.map((sc) => {
            const isManual = sensorModes[sc.key] === 'manual';
            return (
              <button
                key={sc.key}
                className={`h-6 px-2.5 text-[10px] font-mono rounded border transition-colors ${
                  selected.has(sc.key)
                    ? isManual
                      ? 'border-amber-700/50 text-amber-400 bg-amber-950/30'
                      : 'border-emerald-700/50 text-emerald-400 bg-emerald-950/20'
                    : `border-[#1e293b] ${textMuted} ${bg2} hover:text-slate-400`
                }`}
                onClick={() => toggle(sc.key)}
              >
                {isManual && '⚡ '}{sc.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Chart */}
      <div className={`${bg} border ${border} rounded-md p-3`}>
        <div className="flex items-center gap-2 mb-2">
          <span className={`text-[10px] font-mono ${textMuted} uppercase tracking-widest`}>Real-Time Data</span>
          <div className="ml-auto flex items-center gap-2">
            <button
              className={`h-5 px-2 text-[9px] font-mono rounded border ${
                autoScale
                  ? 'border-emerald-800/40 bg-emerald-950/20 text-emerald-400'
                  : `border-[#1e293b] ${textMuted} ${bg2}`
              }`}
              onClick={() => setAutoScale(true)}
            >
              AUTO SCALE
            </button>
            <button
              className={`h-5 px-2 text-[9px] font-mono rounded border ${
                !autoScale
                  ? 'border-sky-800/40 bg-sky-950/20 text-sky-400'
                  : `border-[#1e293b] ${textMuted} ${bg2}`
              }`}
              onClick={() => setAutoScale(false)}
            >
              MANUAL SCALE
            </button>
            {!autoScale && (
              <>
                <Input
                  value={yMin}
                  onChange={(e) => setYMin(e.target.value)}
                  placeholder="Y Min"
                  className={`w-[60px] h-5 ${bg2} border-[#1e293b] text-[10px] font-mono rounded px-1`}
                />
                <Input
                  value={yMax}
                  onChange={(e) => setYMax(e.target.value)}
                  placeholder="Y Max"
                  className={`w-[60px] h-5 ${bg2} border-[#1e293b] text-[10px] font-mono rounded px-1`}
                />
              </>
            )}
          </div>
        </div>
        <div className="h-[220px]">
          {chartData.length > 1 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <XAxis
                  dataKey="t"
                  stroke={theme === 'dark' ? '#334155' : '#d1d5db'}
                  tick={{ fontSize: 9, fill: theme === 'dark' ? '#64748b' : '#6b7280', fontFamily: 'monospace' }}
                />
                <YAxis
                  stroke={theme === 'dark' ? '#334155' : '#d1d5db'}
                  tick={{ fontSize: 9, fill: theme === 'dark' ? '#64748b' : '#6b7280', fontFamily: 'monospace' }}
                  domain={yDomain || ['auto', 'auto']}
                  allowDataOverflow={!autoScale}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: theme === 'dark' ? '#1e293b' : '#ffffff',
                    border: `1px solid ${theme === 'dark' ? '#334155' : '#e5e7eb'}`,
                    borderRadius: '4px',
                    fontSize: '10px',
                    fontFamily: 'monospace',
                    color: theme === 'dark' ? '#e2e8f0' : '#1f2937',
                  }}
                  labelStyle={{ color: theme === 'dark' ? '#94a3b8' : '#6b7280' }}
                />
                {SENSORS.filter((sc) => selected.has(sc.key)).map((sc) => (
                  <Line
                    key={sc.key}
                    type="monotone"
                    dataKey={sc.key}
                    stroke={sc.color}
                    strokeWidth={1.5}
                    dot={false}
                    name={sc.label}
                    isAnimationActive={false}
                    opacity={0.9}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className={`h-full flex items-center justify-center text-[11px] font-mono ${textMuted}`}>
              START SIMULATION FOR DATA
            </div>
          )}
        </div>
      </div>

      {/* Individual Sensor Controls */}
      <div className={`${bg} border ${border} rounded-md p-3`}>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-1 h-3 bg-emerald-500/70 rounded-full" />
          <span className={`text-[10px] font-mono ${textMuted} uppercase tracking-widest`}>Independent Sensor Controls</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {SENSORS.map((sc) => {
            const isManual = sensorModes[sc.key] === 'manual';
            const value = state[sc.key] ?? 0;
            return (
              <div
                key={sc.key}
                className={`space-y-1.5 p-2 rounded border transition-colors ${
                  isManual
                    ? 'border-amber-700/40 bg-amber-950/20'
                    : 'border-transparent bg-transparent'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => toggleSensorMode(sc.key)}
                      className={`h-5 px-2 text-[9px] font-mono rounded border transition-all ${
                        isManual
                          ? 'border-amber-600/60 bg-amber-900/40 text-amber-300 hover:bg-amber-900/60'
                          : 'border-emerald-800/40 bg-emerald-950/20 text-emerald-500 hover:bg-emerald-900/30'
                      }`}
                    >
                      {isManual ? '⚡ MANUAL' : '● AUTO'}
                    </button>
                    <span className={`text-[10px] font-mono ${textLabel} uppercase`}>{sc.label}</span>
                    {isManual && (
                      <span className="text-[8px] font-mono text-amber-500/70 uppercase">OVERRIDE</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-[11px] font-mono tabular-nums" style={{ color: isManual ? '#fbbf24' : sc.color }}>
                      {value.toFixed(sc.step < 1 ? (sc.step < 0.1 ? 2 : 1) : 0)}
                    </span>
                    <span className={`text-[10px] font-mono ${textValue}`}>{sc.unit}</span>
                    <span className={`text-[8px] font-mono ${textValue} ml-1`}>
                      [{sc.min}–{sc.max}]
                    </span>
                  </div>
                </div>
                <Slider
                  value={[value]}
                  min={sc.min}
                  max={sc.max}
                  step={sc.step}
                  onValueChange={(v) => {
                    // Always switch to MANUAL when user drags the slider
                    // This prevents tick() from overwriting the value
                    if (!isManual) {
                      simulator.setSensorMode(sc.key, 'manual');
                      setSensorModes((prev) => ({ ...prev, [sc.key]: 'manual' }));
                    }
                    handleManualChange(sc.key, v[0]);
                  }}
                  className="cursor-pointer"
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}