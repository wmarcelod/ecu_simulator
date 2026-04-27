import { useEffect, useRef, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ECUSimulator, SensorState, SimScenario, VehicleProfile } from '@/lib/ecu-simulator';
import { ConnectionStatus } from '@/lib/serial-connection';
import { parseDBC, dbcToSensorConfig } from '@/lib/dbc-parser';
import { useTheme, t } from '@/lib/theme-context';

// ============================================================
// Professional Gauge — Telemetry Style
// ============================================================
interface GaugeProps {
  value: number;
  min: number;
  max: number;
  label: string;
  unit: string;
  color?: string;
  decimals?: number;
  warning?: number;
  danger?: number;
  isManual?: boolean;
}

function TelemetryGauge({ value, min, max, label, unit, color = '#15803D', decimals = 0, warning, danger, isManual }: GaugeProps) {
  const { theme } = useTheme();
  const percentage = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const arcLen = circumference * 0.72;
  const offset = arcLen * (1 - percentage);
  const rot = 144;

  let activeColor = color;
  if (isManual) activeColor = '#B45309';
  else if (danger !== undefined && value >= danger) activeColor = '#991B1B';
  else if (warning !== undefined && value >= warning) activeColor = '#B45309';

  const tickStroke = theme === 'dark' ? '#8DA2BE' : '#8DA2BE';
  const trackStroke = theme === 'dark' ? '#CBD5E1' : '#CBD5E1';

  const ticks = [];
  const tickCount = 8;
  for (let i = 0; i <= tickCount; i++) {
    const angle = rot + (i / tickCount) * 252;
    const rad = (angle * Math.PI) / 180;
    ticks.push(
      <line key={i} x1={50 + 32 * Math.cos(rad)} y1={50 + 32 * Math.sin(rad)} x2={50 + 36 * Math.cos(rad)} y2={50 + 36 * Math.sin(rad)} stroke={tickStroke} strokeWidth="1" />
    );
  }

  return (
    <div className="flex flex-col items-center">
      <div className="relative w-[100px] h-[100px]">
        <svg viewBox="0 0 100 100" className="w-full h-full">
          {ticks}
          <circle cx="50" cy="50" r={radius} fill="none" stroke={trackStroke} strokeWidth="5" strokeDasharray={`${arcLen} ${circumference}`} strokeLinecap="butt" transform={`rotate(${rot} 50 50)`} />
          <circle cx="50" cy="50" r={radius} fill="none" stroke={activeColor} strokeWidth="5" strokeDasharray={`${arcLen} ${circumference}`} strokeDashoffset={offset} strokeLinecap="butt" transform={`rotate(${rot} 50 50)`} className="transition-all duration-150 ease-linear" opacity="0.9" />
          <defs><filter id="glow"><feGaussianBlur stdDeviation="2" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter></defs>
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[16px] font-mono font-semibold tabular-nums" style={{ color: activeColor }}>{value.toFixed(decimals)}</span>
          <span className={`text-[9px] font-mono uppercase ${theme === 'dark' ? 'text-slate-500' : 'text-gray-400'}`}>{unit}</span>
        </div>
      </div>
      <div className="flex items-center gap-1 mt-0.5">
        {isManual && <span className="text-[8px] text-amber-400">⚡</span>}
        <span className={`text-[10px] font-mono uppercase tracking-wider ${theme === 'dark' ? 'text-slate-400' : 'text-gray-500'}`}>{label}</span>
      </div>
    </div>
  );
}

// ============================================================
// Data Row
// ============================================================
function DataRow({ label, value, unit, color = '#1A2332' }: { label: string; value: string; unit?: string; color?: string }) {
  const { theme } = useTheme();
  return (
    <div className={`flex items-center justify-between py-1.5 px-2.5 border-b last:border-b-0 ${theme === 'dark' ? 'border-[#1e293b]' : 'border-gray-100'}`}>
      <span className={`text-[10px] font-mono uppercase tracking-wide ${theme === 'dark' ? 'text-slate-500' : 'text-gray-400'}`}>{label}</span>
      <span className="text-[11px] font-mono tabular-nums" style={{ color }}>
        {value}{unit && <span className={`ml-0.5 ${theme === 'dark' ? 'text-slate-600' : 'text-gray-400'}`}>{unit}</span>}
      </span>
    </div>
  );
}

// ============================================================
// Dashboard
// ============================================================
interface DashboardProps {
  simulator: ECUSimulator;
  serialStatus: ConnectionStatus;
  onConnectSerial: () => void;
  onDisconnectSerial: () => void;
  onExportLog: () => void;
}

export default function Dashboard({ simulator, serialStatus, onConnectSerial, onDisconnectSerial, onExportLog }: DashboardProps) {
  const { theme } = useTheme();
  const [state, setState] = useState<SensorState>(simulator.getState());
  const [running, setRunning] = useState(simulator.isRunning());
  const [profileId, setProfileId] = useState(simulator.getProfile().id);
  const [scenario, setScenario] = useState<SimScenario>(simulator.getScenario());
  const [profiles, setProfiles] = useState<VehicleProfile[]>(simulator.getAllProfiles());
  const [dbcInfo, setDbcInfo] = useState<{ name: string; messages: number; signals: number } | null>(null);
  const [manualSensors, setManualSensors] = useState<string[]>([]);
  const animRef = useRef<number>(0);
  const dbcFileRef = useRef<HTMLInputElement>(null);

  const updateState = useCallback(() => {
    setState(simulator.getState());
    setRunning(simulator.isRunning());
    setScenario(simulator.getScenario());
    setManualSensors(simulator.getManualSensors());
    animRef.current = requestAnimationFrame(updateState);
  }, [simulator]);

  useEffect(() => {
    animRef.current = requestAnimationFrame(updateState);
    return () => cancelAnimationFrame(animRef.current);
  }, [updateState]);

  const handleProfileChange = (id: string) => { setProfileId(id); simulator.switchProfile(id); };
  const handleStartStop = () => { if (running) simulator.stop(); else simulator.start(); setRunning(!running); };
  const handleScenario = (s: SimScenario) => { simulator.setScenario(s); setScenario(s); };

  const handleDBCUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = ev.target?.result as string;
      const dbc = parseDBC(content, file.name);
      const config = dbcToSensorConfig(dbc);
      const pidRanges: Record<string, { min: number; max: number; idle: number }> = {};
      for (const sig of config.signals) { pidRanges[sig.key] = { min: sig.min, max: sig.max, idle: sig.idle }; }
      const dbcProfile: VehicleProfile = {
        id: `dbc_${file.name.replace(/[^a-zA-Z0-9]/g, '_')}`,
        name: `DBC: ${config.name}`,
        type: 'dbc',
        vin: 'DBC_IMPORTED_VEHICLE',
        calibrationId: `DBC_${config.name.toUpperCase()}`,
        description: `Imported from ${file.name} — ${dbc.messages.length} messages, ${config.signals.length} signals`,
        supportedPids: { '00': [0xBE, 0x3E, 0xB8, 0x13], '20': [0x80, 0x05, 0x00, 0x00], '40': [0x68, 0x08, 0x00, 0x00] },
        pidRanges,
        dtcs: { stored: [], pending: [], permanent: [] },
      };
      simulator.addDBCProfile(dbcProfile);
      simulator.switchProfile(dbcProfile.id);
      setProfileId(dbcProfile.id);
      setProfiles(simulator.getAllProfiles());
      setDbcInfo({ name: config.name, messages: dbc.messages.length, signals: config.signals.length });
    };
    reader.readAsText(file);
    if (dbcFileRef.current) dbcFileRef.current.value = '';
  };

  const profile = simulator.getProfile();
  const serialColor = serialStatus === 'connected' ? '#15803D' : serialStatus === 'error' ? '#991B1B' : '#475569';
  const formatTime = (seconds: number) => { const m = Math.floor(seconds / 60); const s = seconds % 60; return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`; };
  const isManual = (key: string) => manualSensors.includes(key);

  const bg = t('bg-[#111827]', 'bg-white', theme);
  const border = t('border-[#1e293b]', 'border-gray-200', theme);
  const bg2 = t('bg-[#0f172a]', 'bg-gray-50', theme);
  const textMuted = t('text-slate-500', 'text-gray-500', theme);
  const textLabel = t('text-slate-400', 'text-gray-600', theme);

  return (
    <div className="space-y-3">
      {/* Control Strip */}
      <div className={`${bg} border ${border} rounded-md p-3`}>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className={`text-[10px] font-mono ${textMuted} uppercase`}>Vehicle</span>
            <Select value={profileId} onValueChange={handleProfileChange}>
              <SelectTrigger className={`w-[200px] h-7 ${bg2} ${border} ${theme === 'dark' ? 'text-slate-300' : 'text-gray-700'} text-[11px] font-mono rounded`}><SelectValue /></SelectTrigger>
              <SelectContent className={`${theme === 'dark' ? 'bg-[#1e293b] border-[#334155]' : 'bg-white border-gray-200'} rounded`}>
                {profiles.map((p) => (<SelectItem key={p.id} value={p.id} className={`${theme === 'dark' ? 'text-slate-300 focus:bg-[#334155] focus:text-white' : 'text-gray-700 focus:bg-gray-100'} text-[11px] font-mono`}>{p.name}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>
          <div className={`h-4 w-px ${theme === 'dark' ? 'bg-[#1e293b]' : 'bg-gray-200'}`} />
          <input ref={dbcFileRef} type="file" accept=".dbc" onChange={handleDBCUpload} className="hidden" />
          <button className={`h-7 px-3 text-[10px] font-mono uppercase ${bg2} border ${border} text-cyan-500 hover:text-cyan-400 rounded`} onClick={() => dbcFileRef.current?.click()}>↑ LOAD DBC</button>
          <div className={`h-4 w-px ${theme === 'dark' ? 'bg-[#1e293b]' : 'bg-gray-200'}`} />
          <Button onClick={handleStartStop} size="sm" className={`h-7 rounded text-[11px] font-mono uppercase tracking-wider px-4 ${running ? 'bg-red-950/40 hover:bg-red-950/60 text-red-400 border border-red-800/40' : 'bg-emerald-950/40 hover:bg-emerald-950/60 text-emerald-400 border border-emerald-800/40'}`}>{running ? '■ STOP' : '▶ START'}</Button>
          <div className={`flex gap-0 border ${border} rounded overflow-hidden`}>
            {(['idle', 'acceleration', 'cruise', 'deceleration'] as SimScenario[]).map((s) => (
              <button key={s} className={`h-7 px-3 text-[10px] font-mono uppercase tracking-wider border-r ${border} last:border-r-0 transition-colors ${scenario === s ? `${theme === 'dark' ? 'bg-[#1e293b]' : 'bg-gray-100'} text-emerald-500` : `${bg} ${textMuted} hover:text-slate-300`} ${!running ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`} onClick={() => running && handleScenario(s)} disabled={!running}>{s.slice(0, 5).toUpperCase()}</button>
            ))}
          </div>
          <div className="flex items-center gap-2 ml-auto">
            <button className={`h-7 px-3 text-[10px] font-mono uppercase ${bg2} border ${border} text-sky-400 hover:text-sky-300 rounded`} onClick={onExportLog}>↓ EXPORTAR LOG</button>
            <a href="/arduino_ecu_simulator.ino" download="arduino_ecu_simulator.ino" className={`h-7 px-3 text-[10px] font-mono uppercase ${bg2} border ${border} text-amber-400 hover:text-amber-300 rounded flex items-center`}>↓ ARDUINO</a>
            <div className={`h-4 w-px ${theme === 'dark' ? 'bg-[#1e293b]' : 'bg-gray-200'}`} />
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: serialColor }} />
              <span className={`text-[10px] font-mono ${textMuted} uppercase`}>{serialStatus === 'connected' ? 'SERIAL OK' : serialStatus === 'error' ? 'ERRO' : 'SEM HARDWARE'}</span>
            </div>
            {serialStatus === 'connected' ? (
              <button className={`h-7 px-3 text-[10px] font-mono uppercase ${bg2} border ${border} ${textLabel} hover:text-slate-200 rounded`} onClick={onDisconnectSerial}>DESCONECTAR</button>
            ) : (
              <button className={`h-7 px-3 text-[10px] font-mono uppercase ${bg2} border ${border} ${textMuted} hover:text-slate-300 rounded`} onClick={onConnectSerial} title="Opcional: Conectar Arduino via Web Serial API">SERIAL</button>
            )}
          </div>
        </div>
      </div>

      {dbcInfo && (<div className="bg-cyan-950/20 border border-cyan-800/30 rounded-md px-3 py-1.5 flex items-center gap-2"><span className="text-[10px] font-mono text-cyan-400">📄 DBC CARREGADO:</span><span className="text-[10px] font-mono text-cyan-300">{dbcInfo.name}</span><span className="text-[10px] font-mono text-cyan-600">— {dbcInfo.messages} mensagens, {dbcInfo.signals} sinais</span></div>)}
      {manualSensors.length > 0 && (<div className="bg-amber-950/20 border border-amber-800/30 rounded-md px-3 py-1.5 flex items-center gap-2"><span className="text-[10px] font-mono text-amber-400">⚠ OVERRIDE MANUAL ATIVO:</span><span className="text-[10px] font-mono text-amber-300">{manualSensors.join(', ')}</span><span className="text-[10px] font-mono text-amber-600">— valores fixos (simulação de ataque)</span></div>)}
      {simulator.isMilOn() && (<div className="bg-red-950/20 border border-red-800/30 rounded-md px-3 py-1.5 flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" /><span className="text-[10px] font-mono text-red-400 uppercase tracking-wider">MIL ATIVA — {simulator.getStoredDTCs().length} DTC(s) ARMAZENADO(s)</span></div>)}

      {/* Gauges */}
      <div className={`${bg} border ${border} rounded-md p-4`}>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-1 h-3 bg-emerald-500/70 rounded-full" />
          <span className={`text-[10px] font-mono ${textLabel} uppercase tracking-wider`}>Live Telemetry — {profile.name}</span>
          {running && <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse ml-auto" />}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 justify-items-center">
          <TelemetryGauge value={state.rpm} min={0} max={profile.pidRanges.rpm?.max ?? 8000} label="RPM" unit="rpm" color="#15803D" warning={(profile.pidRanges.rpm?.max ?? 8000) * 0.75} danger={(profile.pidRanges.rpm?.max ?? 8000) * 0.9} isManual={isManual('rpm')} />
          <TelemetryGauge value={state.speed} min={0} max={profile.pidRanges.speed?.max ?? 280} label="Speed" unit="km/h" color="#1D4ED8" isManual={isManual('speed')} />
          <TelemetryGauge value={state.coolantTemp} min={0} max={150} label="Coolant" unit="°C" color="#15803D" warning={100} danger={110} isManual={isManual('coolantTemp')} />
          <TelemetryGauge value={state.engineLoad} min={0} max={100} label="Load" unit="%" color="#1D4ED8" isManual={isManual('engineLoad')} />
          <TelemetryGauge value={state.throttle} min={0} max={100} label="Throttle" unit="%" color="#0F766E" isManual={isManual('throttle')} />
          <TelemetryGauge value={state.intakeMAP} min={0} max={profile.pidRanges.intakeMAP?.max ?? 255} label="MAP" unit="kPa" color="#0F766E" isManual={isManual('intakeMAP')} />
          <TelemetryGauge value={state.mafRate} min={0} max={profile.pidRanges.mafRate?.max ?? 655} label="MAF" unit="g/s" color="#7E22CE" decimals={1} isManual={isManual('mafRate')} />
        </div>
      </div>

      {/* Data Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className={`${bg} border ${border} rounded-md`}>
          <div className={`px-2.5 py-1.5 border-b ${border}`}><span className={`text-[9px] font-mono ${textMuted} uppercase tracking-widest`}>Engine Parameters</span></div>
          <DataRow label="Timing Adv" value={state.timingAdvance.toFixed(1)} unit="°" color={isManual('timingAdvance') ? '#B45309' : '#1A2332'} />
          <DataRow label="Intake Air" value={state.intakeAirTemp.toFixed(1)} unit="°C" color={isManual('intakeAirTemp') ? '#B45309' : '#1A2332'} />
          <DataRow label="Oil Temp" value={state.oilTemp.toFixed(1)} unit="°C" color={isManual('oilTemp') ? '#B45309' : state.oilTemp > 120 ? '#B45309' : '#1A2332'} />
          <DataRow label="Baro Press" value={state.baroPressure.toFixed(0)} unit="kPa" color={isManual('baroPressure') ? '#B45309' : '#1A2332'} />
        </div>
        <div className={`${bg} border ${border} rounded-md`}>
          <div className={`px-2.5 py-1.5 border-b ${border}`}><span className={`text-[9px] font-mono ${textMuted} uppercase tracking-widest`}>Vehicle Status</span></div>
          <DataRow label="Fuel Level" value={state.fuelLevel.toFixed(1)} unit="%" color={isManual('fuelLevel') ? '#B45309' : state.fuelLevel < 15 ? '#B45309' : '#1A2332'} />
          <DataRow label="Battery" value={state.controlVoltage.toFixed(2)} unit="V" color={isManual('controlVoltage') ? '#B45309' : state.controlVoltage < 12.5 ? '#B45309' : '#1A2332'} />
          <DataRow label="Ambient" value={state.ambientTemp.toFixed(1)} unit="°C" color={isManual('ambientTemp') ? '#B45309' : '#1A2332'} />
          <DataRow label="Run Time" value={formatTime(state.runTime)} color="#1A2332" />
        </div>
        <div className={`${bg} border ${border} rounded-md`}>
          <div className={`px-2.5 py-1.5 border-b ${border}`}><span className={`text-[9px] font-mono ${textMuted} uppercase tracking-widest`}>Vehicle Identity</span></div>
          <DataRow label="VIN" value={profile.vin} color="#475569" />
          <DataRow label="Cal ID" value={profile.calibrationId} color="#475569" />
          <DataRow label="Protocol" value="ISO 15765-4" color="#475569" />
          <DataRow label="Type" value={profile.type.toUpperCase()} color="#475569" />
        </div>
      </div>
    </div>
  );
}