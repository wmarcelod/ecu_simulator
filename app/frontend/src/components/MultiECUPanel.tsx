import { useState, useEffect, useCallback } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ECUSimulator } from '@/lib/ecu-simulator';
import { useTheme, t } from '@/lib/theme-context';

interface MultiECUPanelProps {
  simulator: ECUSimulator;
}

const ECU_CONFIG = [
  { name: 'Engine', address: 0x7E0, responseId: 0x7E8, color: '#4ade80', accentClass: 'emerald', icon: '⚙' },
  { name: 'Transmission', address: 0x7E1, responseId: 0x7E9, color: '#38bdf8', accentClass: 'blue', icon: '⚙' },
  { name: 'ABS', address: 0x7E2, responseId: 0x7EA, color: '#f59e0b', accentClass: 'amber', icon: '⚙' },
];

const DTC_DESC: Record<string, string> = {
  P0100: 'MAF Circuit Malfunction',
  P0101: 'MAF Circuit Range/Performance',
  P0110: 'IAT Circuit Malfunction',
  P0115: 'ECT Circuit Malfunction',
  P0120: 'TPS A Circuit Malfunction',
  P0128: 'Thermostat Below Regulating Temp',
  P0130: 'O2 Sensor Circuit (B1S1)',
  P0131: 'O2 Sensor Low Voltage (B1S1)',
  P0171: 'System Too Lean (Bank 1)',
  P0172: 'System Too Rich (Bank 1)',
  P0300: 'Random/Multiple Cylinder Misfire',
  P0301: 'Cylinder 1 Misfire',
  P0302: 'Cylinder 2 Misfire',
  P0420: 'Catalyst Efficiency Below Threshold (B1)',
  P0440: 'EVAP System Malfunction',
  P0442: 'EVAP System Leak (Small)',
  P0455: 'EVAP System Leak (Large)',
  P0500: 'VSS Malfunction',
  P0505: 'Idle Control System Malfunction',
  P0600: 'Serial Communication Link Error',
  P0700: 'Transmission Control System Malfunction',
  C0035: 'ABS Sensor Circuit High',
  C0036: 'ABS Sensor Circuit Low',
  C0040: 'ABS Sensor Circuit Open',
  C0100: 'ABS Wheel Speed Sensor Malfunction',
};

const COMMON_DTCS = {
  engine: ['P0100', 'P0171', 'P0172', 'P0300', 'P0301', 'P0420', 'P0442', 'P0128', 'P0505', 'P0500'],
  transmission: ['P0700', 'P0740', 'P0755', 'P0808'],
  abs: ['C0035', 'C0036', 'C0040', 'C0100', 'C0200'],
};

export default function MultiECUPanel({ simulator }: MultiECUPanelProps) {
  const { theme } = useTheme();
  const [ecuStates, setEcuStates] = useState<Record<number, { stored: string[]; pending: string[]; permanent: string[] }>>({});
  const [newDTC, setNewDTC] = useState('');
  const [addType, setAddType] = useState<'stored' | 'pending' | 'permanent'>('stored');
  const [selectedECU, setSelectedECU] = useState(0x7E0);
  const [transmissionState, setTransmissionState] = useState(simulator.getTransmissionState());
  const [absState, setAbsState] = useState(simulator.getABSState());
  const [engineState, setEngineState] = useState(simulator.getState());
  const [isRunning, setIsRunning] = useState(false);

  const refresh = useCallback(() => {
    const newStates: Record<number, { stored: string[]; pending: string[]; permanent: string[] }> = {};
    for (const ecu of ECU_CONFIG) {
      newStates[ecu.address] = simulator.getECUDTCs(ecu.address);
    }
    setEcuStates(newStates);
    setTransmissionState(simulator.getTransmissionState());
    setAbsState(simulator.getABSState());
    setEngineState(simulator.getState());
    setIsRunning(simulator.isRunning());
  }, [simulator]);

  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, 500);
    return () => clearInterval(iv);
  }, [refresh]);

  const handleAdd = () => {
    const code = newDTC.trim().toUpperCase();
    if (/^[PCBU|C][0-9A-F]{4}$/.test(code)) {
      simulator.addECUDTC(selectedECU, code, addType);
      setNewDTC('');
      refresh();
    }
  };

  const handleRemove = (ecuAddress: number, code: string, type: 'stored' | 'pending' | 'permanent') => {
    simulator.removeECUDTC(ecuAddress, code, type);
    refresh();
  };

  const bg = t('bg-[#111827]', 'bg-white', theme);
  const bgSecondary = t('bg-[#0f172a]', 'bg-gray-50', theme);
  const border = t('border-[#1e293b]', 'border-gray-200', theme);
  const textMuted = t('text-slate-500', 'text-gray-500', theme);
  const textLabel = t('text-slate-400', 'text-gray-600', theme);

  const getDTCIndicatorColor = (dtcCount: number) => {
    if (dtcCount === 0) return 'bg-emerald-500/60';
    if (dtcCount <= 2) return 'bg-amber-500/60';
    return 'bg-red-500/60';
  };

  const getDTCIndicatorColorText = (dtcCount: number) => {
    if (dtcCount === 0) return 'text-emerald-400';
    if (dtcCount <= 2) return 'text-amber-400';
    return 'text-red-400';
  };

  const renderDTCList = (dtcs: string[], type: 'stored' | 'pending' | 'permanent', label: string, mode: string, color: string) => (
    <div className={`${bg} border ${border} rounded-md`}>
      <div className="px-3 py-1.5 border-b border-[#1e293b] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color, opacity: 0.8 }} />
          <span className="text-[10px] font-mono uppercase tracking-widest" style={{ color }}>{label}</span>
          <span className="text-[10px] font-mono text-slate-500">({dtcs.length})</span>
        </div>
        <span className="text-[9px] font-mono text-slate-600">MODE {mode}</span>
      </div>
      {dtcs.length === 0 ? (
        <div className="px-3 py-3 text-[10px] font-mono text-slate-600 text-center">NO CODES</div>
      ) : (
        <div>
          {dtcs.map((dtc) => (
            <div key={`${selectedECU}-${type}-${dtc}`} className="flex items-center justify-between px-3 py-1.5 border-b border-[#1e293b]/50 last:border-b-0 group">
              <div className="flex items-center gap-3">
                <span className="text-[11px] font-mono font-semibold" style={{ color }}>{dtc}</span>
                <span className="text-[10px] font-mono text-slate-400">{DTC_DESC[dtc] || 'Unknown'}</span>
              </div>
              <button
                className="text-[9px] font-mono text-slate-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={() => handleRemove(selectedECU, dtc, type)}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const ecuConfig = ECU_CONFIG.find((e) => e.address === selectedECU);
  const ecuDtcs = ecuStates[selectedECU] || { stored: [], pending: [], permanent: [] };

  return (
    <div className="space-y-3">
      {/* Network Topology Visualization */}
      <style>{`
        @keyframes pulse-flow {
          0% { opacity: 0.4; }
          50% { opacity: 1; }
          100% { opacity: 0.4; }
        }
        .pulse-active {
          animation: pulse-flow 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
        }
      `}</style>

      <div className={`${bg} border ${border} rounded-md p-4`}>
        <div className="flex items-center gap-2 mb-4">
          <div className="w-1 h-3 bg-violet-500/70 rounded-full" />
          <span className={`text-[10px] font-mono ${textLabel} uppercase tracking-widest`}>CAN Bus Network Topology</span>
        </div>

        {/* Horizontal CAN Bus Line with ECU Connectors */}
        <div className="relative px-2 py-6">
          {/* CAN Bus Main Line */}
          <div className="absolute top-1/2 left-0 right-0 h-0.5 bg-gradient-to-r from-violet-500/30 via-violet-500/60 to-violet-500/30 transform -translate-y-1/2" />

          {/* ECU Nodes */}
          <div className="flex justify-between items-start px-4">
            {ECU_CONFIG.map((ecu) => {
              const dtcs = ecuStates[ecu.address];
              const totalCodes = (dtcs?.stored.length ?? 0) + (dtcs?.pending.length ?? 0) + (dtcs?.permanent.length ?? 0);

              return (
                <div key={ecu.address} className="flex flex-col items-center flex-1 max-w-[120px]">
                  {/* Vertical Connector Line */}
                  <div className={`w-0.5 h-5 ${isRunning ? 'pulse-active' : ''}`} style={{ backgroundColor: ecu.color }} />

                  {/* ECU Node Card */}
                  <div className={`${bgSecondary} border ${border} rounded p-2.5 w-full text-center relative`}>
                    {/* DTC Status Indicator Dot */}
                    <div className={`absolute top-1 right-1 w-2 h-2 rounded-full ${getDTCIndicatorColor(totalCodes)}`} />

                    {/* ECU Name and Address */}
                    <div className="text-[10px] font-mono font-semibold mb-1" style={{ color: ecu.color }}>
                      {ecu.name}
                    </div>
                    <div className="text-[8px] font-mono text-slate-500 mb-1.5">
                      0x{ecu.address.toString(16).toUpperCase()}
                    </div>

                    {/* DTC Count Badge */}
                    <div className={`text-[9px] font-mono font-semibold ${getDTCIndicatorColorText(totalCodes)}`}>
                      {totalCodes === 0 ? '0 DTCs' : `${totalCodes} DTC${totalCodes !== 1 ? 's' : ''}`}
                    </div>

                    {/* Activity Pulse */}
                    {isRunning && (
                      <div className="mt-1.5 flex items-center justify-center">
                        <div className="w-1 h-1 rounded-full bg-emerald-400 pulse-active" />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ECU State Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* Engine ECU Overview */}
        <div className={`${bg} border ${border} rounded-md p-3`}>
          <div className="flex items-center gap-2 mb-3">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500/80" />
            <span className="text-[9px] font-mono uppercase tracking-widest text-emerald-400">Engine ECU</span>
          </div>
          <div className="space-y-2 text-[10px]">
            <div className="flex justify-between items-center">
              <span className={textMuted}>RPM</span>
              <span className="text-emerald-400 font-mono font-semibold">{Math.round(engineState.rpm)}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className={textMuted}>Speed</span>
              <span className="text-emerald-400 font-mono font-semibold">{engineState.speed.toFixed(1)} km/h</span>
            </div>
            <div className="flex justify-between items-center">
              <span className={textMuted}>Load</span>
              <span className="text-emerald-400 font-mono font-semibold">{engineState.engineLoad.toFixed(1)}%</span>
            </div>
            <div className="flex justify-between items-center">
              <span className={textMuted}>Coolant</span>
              <span className="text-emerald-400 font-mono font-semibold">{engineState.coolantTemp.toFixed(0)}°C</span>
            </div>
          </div>
        </div>

        {/* Transmission ECU Overview */}
        <div className={`${bg} border ${border} rounded-md p-3`}>
          <div className="flex items-center gap-2 mb-3">
            <div className="w-1.5 h-1.5 rounded-full bg-blue-500/80" />
            <span className="text-[9px] font-mono uppercase tracking-widest text-blue-400">Transmission ECU</span>
          </div>
          <div className="space-y-2 text-[10px]">
            <div className="flex justify-between items-center">
              <span className={textMuted}>Gear</span>
              <span className="text-blue-400 font-mono font-semibold">
                {transmissionState.gear === 0 ? 'P' : transmissionState.gear === -1 ? 'R' : transmissionState.gear}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className={textMuted}>Temperature</span>
              <span className="text-blue-400 font-mono font-semibold">{transmissionState.temperature.toFixed(0)}°C</span>
            </div>
            <div className="flex justify-between items-center">
              <span className={textMuted}>Shift Count</span>
              <span className="text-blue-400 font-mono font-semibold">{transmissionState.shiftCount}</span>
            </div>
            <div className="h-3" />
          </div>
        </div>

        {/* ABS ECU Overview */}
        <div className={`${bg} border ${border} rounded-md p-3`}>
          <div className="flex items-center gap-2 mb-3">
            <div className="w-1.5 h-1.5 rounded-full bg-amber-500/80" />
            <span className="text-[9px] font-mono uppercase tracking-widest text-amber-400">ABS ECU</span>
          </div>
          <div className="space-y-2 text-[10px]">
            <div className="flex justify-between items-center">
              <span className={textMuted}>Wheel Avg</span>
              <span className="text-amber-400 font-mono font-semibold">
                {(
                  (absState.wheelSpeedFL + absState.wheelSpeedFR + absState.wheelSpeedRL + absState.wheelSpeedRR) / 4
                ).toFixed(0)} km/h
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className={textMuted}>Brake Press</span>
              <span className="text-amber-400 font-mono font-semibold">{absState.brakePressure.toFixed(0)} bar</span>
            </div>
            <div className="flex justify-between items-center">
              <span className={textMuted}>ABS Active</span>
              <span className={`font-mono font-semibold ${absState.absActive ? 'text-red-400' : 'text-emerald-400'}`}>
                {absState.absActive ? 'YES' : 'NO'}
              </span>
            </div>
            <div className="h-3" />
          </div>
        </div>
      </div>

      {/* ECU Selector */}
      <div className={`${bg} border ${border} rounded-md p-3`}>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-1 h-3 bg-violet-500/70 rounded-full" />
          <span className={`text-[10px] font-mono ${textLabel} uppercase tracking-widest`}>Multi-ECU Status</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {ECU_CONFIG.map((ecu) => {
            const dtcs = ecuStates[ecu.address];
            const totalCodes = (dtcs?.stored.length ?? 0) + (dtcs?.pending.length ?? 0) + (dtcs?.permanent.length ?? 0);
            return (
              <button
                key={ecu.address}
                onClick={() => setSelectedECU(ecu.address)}
                className={`
                  h-12 rounded border transition-all p-2 flex flex-col items-start gap-0.5
                  ${selectedECU === ecu.address
                    ? `border-white/50 ${theme === 'dark' ? 'bg-[#1e293b]' : 'bg-gray-100'}`
                    : `${border} ${theme === 'dark' ? 'bg-[#0f172a] hover:bg-[#1e293b]' : 'bg-gray-50 hover:bg-gray-100'}`
                  }
                `}
              >
                <div className="text-[10px] font-mono font-semibold" style={{ color: ecu.color }}>
                  {ecu.icon} {ecu.name}
                </div>
                <div className="text-[9px] font-mono text-slate-500">
                  ID: 0x{ecu.address.toString(16).toUpperCase()} {totalCodes > 0 && `• ${totalCodes} code(s)`}
                </div>
              </button>
            );
          })}
        </div>
      </div>


      {/* Add DTC */}
      <div className={`${bg} border ${border} rounded-md p-3`}>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-1 h-3 bg-emerald-500/70 rounded-full" />
          <span className={`text-[10px] font-mono ${textLabel} uppercase tracking-widest`}>Add DTC to {ecuConfig?.name}</span>
        </div>
        <div className="flex items-center gap-2 mb-3">
          <Input
            value={newDTC}
            onChange={(e) => setNewDTC(e.target.value.toUpperCase())}
            placeholder={ecuConfig?.name === 'ABS' ? 'C0035' : 'P0300'}
            className="w-[100px] h-7 bg-[#0f172a] border-[#1e293b] text-emerald-300 font-mono text-[11px] rounded"
            maxLength={5}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          />
          <Select value={addType} onValueChange={(v) => setAddType(v as 'stored' | 'pending' | 'permanent')}>
            <SelectTrigger className="w-[110px] h-7 bg-[#0f172a] border-[#1e293b] text-slate-300 text-[10px] font-mono rounded">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-[#1e293b] border-[#334155] rounded">
              <SelectItem value="stored" className="text-slate-300 text-[10px] font-mono">STORED</SelectItem>
              <SelectItem value="pending" className="text-slate-300 text-[10px] font-mono">PENDING</SelectItem>
              <SelectItem value="permanent" className="text-slate-300 text-[10px] font-mono">PERMANENT</SelectItem>
            </SelectContent>
          </Select>
          <button
            className="h-7 px-3 text-[10px] font-mono uppercase bg-emerald-950/40 border border-emerald-800/40 text-emerald-400 hover:bg-emerald-950/60 rounded"
            onClick={handleAdd}
          >
            + ADD
          </button>
        </div>
        <div className="flex flex-wrap gap-1">
          {(ecuConfig?.name === 'ABS' ? COMMON_DTCS.abs : ecuConfig?.name === 'Transmission' ? COMMON_DTCS.transmission : COMMON_DTCS.engine).map((dtc) => (
            <button
              key={dtc}
              className="h-5 px-2 text-[9px] font-mono text-slate-500 bg-[#0f172a] border border-[#1e293b] hover:border-emerald-800/40 hover:text-emerald-400 rounded"
              onClick={() => {
                simulator.addECUDTC(selectedECU, dtc, addType);
                refresh();
              }}
            >
              {dtc}
            </button>
          ))}
        </div>
      </div>

      {/* DTC Lists */}
      <div className="space-y-3">
        {renderDTCList(ecuDtcs.stored, 'stored', 'Stored DTCs', '03', '#ef4444')}
        {renderDTCList(ecuDtcs.pending, 'pending', 'Pending DTCs', '07', '#f59e0b')}
        {renderDTCList(ecuDtcs.permanent, 'permanent', 'Permanent DTCs', '0A', '#a78bfa')}
      </div>
    </div>
  );
}
