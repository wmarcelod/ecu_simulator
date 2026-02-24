import { useState, useEffect, useCallback } from 'react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ECUSimulator } from '@/lib/ecu-simulator';
import { useTheme } from '@/lib/theme-context';

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
};

const COMMON_DTCS = ['P0130', 'P0171', 'P0172', 'P0300', 'P0301', 'P0420', 'P0442', 'P0455', 'P0128', 'P0505', 'P0500', 'P0100'];

interface DTCPanelProps {
  simulator: ECUSimulator;
}

export default function DTCPanel({ simulator }: DTCPanelProps) {
  const [stored, setStored] = useState<string[]>(simulator.getStoredDTCs());
  const [pending, setPending] = useState<string[]>(simulator.getPendingDTCs());
  const [permanent, setPermanent] = useState<string[]>(simulator.getPermanentDTCs());
  const [mil, setMil] = useState(simulator.isMilOn());
  const [newDTC, setNewDTC] = useState('');
  const [addType, setAddType] = useState<'stored' | 'pending' | 'permanent'>('stored');

  const refresh = useCallback(() => {
    setStored(simulator.getStoredDTCs());
    setPending(simulator.getPendingDTCs());
    setPermanent(simulator.getPermanentDTCs());
    setMil(simulator.isMilOn());
  }, [simulator]);

  useEffect(() => {
    const iv = setInterval(refresh, 500);
    return () => clearInterval(iv);
  }, [refresh]);

  const handleAdd = () => {
    const code = newDTC.trim().toUpperCase();
    if (/^[PCBU][0-9A-F]{4}$/.test(code)) {
      simulator.addDTC(code, addType);
      setNewDTC('');
      refresh();
    }
  };

  const handleRemove = (code: string, type: 'stored' | 'pending' | 'permanent') => {
    simulator.removeDTC(code, type);
    refresh();
  };

  const handleClear = () => {
    simulator.clearDTCs();
    refresh();
  };

  const handleToggleMil = () => {
    simulator.setMil(!mil);
    setMil(!mil);
  };

  const renderList = (dtcs: string[], type: 'stored' | 'pending' | 'permanent', label: string, mode: string, color: string) => (
    <div className="bg-[#111827] border border-[#1e293b] rounded-md">
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
            <div key={`${type}-${dtc}`} className="flex items-center justify-between px-3 py-1.5 border-b border-[#1e293b]/50 last:border-b-0 group">
              <div className="flex items-center gap-3">
                <span className="text-[11px] font-mono font-semibold" style={{ color }}>{dtc}</span>
                <span className="text-[10px] font-mono text-slate-400">{DTC_DESC[dtc] || 'Unknown'}</span>
              </div>
              <button
                className="text-[9px] font-mono text-slate-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={() => handleRemove(dtc, type)}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-3">
      {/* MIL & Clear */}
      <div className="bg-[#111827] border border-[#1e293b] rounded-md p-3">
        <div className="flex flex-wrap items-center gap-4">
          <button className="flex items-center gap-2 group" onClick={handleToggleMil}>
            <div
              className={`w-2.5 h-2.5 rounded-full transition-colors ${mil ? 'bg-red-500 animate-pulse' : 'bg-emerald-900/50'}`}
            />
            <div>
              <span className={`text-[11px] font-mono font-semibold ${mil ? 'text-red-400' : 'text-emerald-600'}`}>
                MIL {mil ? 'ON' : 'OFF'}
              </span>
              <span className="text-[9px] font-mono text-slate-500 ml-2">CLICK TO TOGGLE</span>
            </div>
          </button>

          <div className="h-4 w-px bg-[#1e293b]" />

          <button
            className="h-7 px-3 text-[10px] font-mono uppercase bg-red-950/30 border border-red-800/30 text-red-400 hover:bg-red-950/50 rounded"
            onClick={handleClear}
          >
            CLEAR DTCS (MODE 04)
          </button>

          <div className="flex gap-4 ml-auto text-[10px] font-mono">
            <span className="text-red-400">STORED: {stored.length}</span>
            <span className="text-amber-400">PENDING: {pending.length}</span>
            <span className="text-violet-400">PERM: {permanent.length}</span>
          </div>
        </div>
      </div>

      {/* Add DTC */}
      <div className="bg-[#111827] border border-[#1e293b] rounded-md p-3">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-1 h-3 bg-emerald-500/70 rounded-full" />
          <span className="text-[10px] font-mono text-slate-500 uppercase tracking-widest">Add DTC</span>
        </div>
        <div className="flex items-center gap-2 mb-3">
          <Input
            value={newDTC}
            onChange={(e) => setNewDTC(e.target.value.toUpperCase())}
            placeholder="P0300"
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
          {COMMON_DTCS.map((dtc) => (
            <button
              key={dtc}
              className="h-5 px-2 text-[9px] font-mono text-slate-500 bg-[#0f172a] border border-[#1e293b] hover:border-emerald-800/40 hover:text-emerald-400 rounded"
              onClick={() => { simulator.addDTC(dtc, addType); refresh(); }}
            >
              {dtc}
            </button>
          ))}
        </div>
      </div>

      {/* DTC Lists */}
      {renderList(stored, 'stored', 'Stored DTCs', '03', '#ef4444')}
      {renderList(pending, 'pending', 'Pending DTCs', '07', '#f59e0b')}
      {renderList(permanent, 'permanent', 'Permanent DTCs', '0A', '#a78bfa')}
    </div>
  );
}