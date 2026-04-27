import { useState, useRef, useCallback, useEffect } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ECUSimulator } from '@/lib/ecu-simulator';
import { SerialConnection, ConnectionStatus } from '@/lib/serial-connection';
import { useTheme, t } from '@/lib/theme-context';
import Dashboard from '@/components/Dashboard';
import Terminal from '@/components/Terminal';
import SensorPanel from '@/components/SensorPanel';
import PlaybackPanel from '@/components/PlaybackPanel';
import DTCPanel from '@/components/DTCPanel';
import SchematicPanel from '@/components/SchematicPanel';
import ResearchPanel from '@/components/ResearchPanel';
import DrivingScenarioSelector from '@/components/DrivingScenarioSelector';
import MultiECUPanel from '@/components/MultiECUPanel';
import CANFrameMonitor from '@/components/CANFrameMonitor';
import AttackSimulator from '@/components/AttackSimulator';
import UdsKillChain from '@/components/UdsKillChain';

function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
}

export default function IndexPage() {
  const { theme } = useTheme();
  const simulatorRef = useRef<ECUSimulator>(new ECUSimulator('sedan'));
  const serialRef = useRef<SerialConnection | null>(null);
  const [serialStatus, setSerialStatus] = useState<ConnectionStatus>('disconnected');
  const [activeTab, setActiveTab] = useState('dashboard');

  const handleConnectSerial = useCallback(async () => {
    if (!SerialConnection.isSupported()) { alert('Web Serial API is not supported. Please use a Chromium-based browser.'); return; }
    const connection = new SerialConnection({
      baudRate: 115200,
      onStatusChange: setSerialStatus,
      onData: (data) => { data.split(/[\r\n]+/).filter((l) => l.trim()).forEach((line) => { const response = simulatorRef.current.sendCommand(line.trim()); connection.write(response + '\r\n>'); }); },
      onError: (err) => { console.error('Serial error:', err); },
    });
    serialRef.current = connection;
    await connection.connect();
  }, []);

  const handleDisconnectSerial = useCallback(async () => { if (serialRef.current) { await serialRef.current.disconnect(); serialRef.current = null; } }, []);

  const handleExportLog = useCallback(() => {
    const sim = simulatorRef.current;
    const logContent = sim.exportSessionLog();
    const dateStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    downloadFile(logContent, `ecu_session_${sim.getProfile().id}_${dateStr}.log`, 'text/plain');
  }, []);

  useEffect(() => { return () => { simulatorRef.current.destroy(); if (serialRef.current) { serialRef.current.disconnect(); } }; }, []);

  const bgPage = t('bg-[#0f172a]', 'bg-gray-50', theme);
  const textPage = t('text-slate-300', 'text-gray-700', theme);
  const bgHeader = t('bg-[#111827]', 'bg-white', theme);
  const border = t('border-[#1e293b]', 'border-gray-200', theme);
  const textMuted = t('text-slate-500', 'text-gray-500', theme);
  const textLabel = t('text-slate-400', 'text-gray-600', theme);
  const textAccent = t('text-emerald-400', 'text-emerald-600', theme);

  return (
    <div className={`min-h-screen ${bgPage} ${textPage} font-sans selection:bg-emerald-900/40`}>
      {/* Header */}
      <header className={`border-b ${border} ${bgHeader}`}>
        <div className="max-w-[1400px] mx-auto px-4 h-11 flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-500" />
            <span className={`text-[13px] font-semibold tracking-wide ${textLabel} uppercase`}>
              ECU<span className={textAccent}>SIM</span>
            </span>
            <span className={`text-[10px] ${textMuted} font-mono ml-1`}>v0.11</span>
          </div>
          <div className={`h-3 w-px ${theme === 'dark' ? 'bg-[#1e293b]' : 'bg-gray-200'} mx-1`} />
          <span className={`text-[11px] ${textMuted} font-mono`}>Emulador de Protocolo ELM327 / OBD-II</span>
          <div className="ml-auto flex items-center gap-3">
            <span className={`text-[10px] ${textMuted} font-mono hidden sm:inline`}>Desenvolvido por Marcelo Duchene</span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-[1400px] mx-auto px-4 py-3">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className={`${bgHeader} border ${border} rounded-md mb-3 h-8 gap-0 p-0`}>
            {[
              { value: 'dashboard', label: 'Painel Geral' },
              { value: 'driving', label: 'Simular Direção' },
              { value: 'multi-ecu', label: 'Múltiplas ECUs' },
              { value: 'can', label: 'Tráfego CAN ao Vivo' },
              { value: 'attacks', label: 'Ataques Comuns' },
              { value: 'kill-chain', label: 'Reproduzir Ataque (UDS/Bootloader)' },
              { value: 'terminal', label: 'Terminal ELM327' },
              { value: 'sensors', label: 'Sensores' },
              { value: 'playback', label: 'Replay de Captura' },
              { value: 'dtc', label: 'Códigos de Falha (DTC)' },
              { value: 'schematic', label: 'Diagrama do Sistema' },
              { value: 'research', label: 'Documentação e Pesquisa' },
            ].map((tab) => (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                className={`rounded-none border-r ${border} last:border-r-0 h-full px-3 text-[11px] font-medium tracking-tight whitespace-nowrap ${textMuted} ${theme === 'dark' ? 'data-[state=active]:bg-[#1e293b]' : 'data-[state=active]:bg-gray-100'} data-[state=active]:${textAccent} data-[state=active]:shadow-none hover:text-slate-300 transition-colors`}
              >
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="dashboard" className="mt-0">
            <Dashboard simulator={simulatorRef.current} serialStatus={serialStatus} onConnectSerial={handleConnectSerial} onDisconnectSerial={handleDisconnectSerial} onExportLog={handleExportLog} />
          </TabsContent>
          <TabsContent value="driving" className="mt-0"><DrivingScenarioSelector simulator={simulatorRef.current} /></TabsContent>
          <TabsContent value="multi-ecu" className="mt-0"><MultiECUPanel simulator={simulatorRef.current} /></TabsContent>
          <TabsContent value="can" className="mt-0"><CANFrameMonitor simulator={simulatorRef.current} /></TabsContent>
          <TabsContent value="attacks" className="mt-0"><AttackSimulator simulator={simulatorRef.current} /></TabsContent>
          <TabsContent value="kill-chain" className="mt-0"><UdsKillChain simulator={simulatorRef.current} /></TabsContent>
          <TabsContent value="terminal" className="mt-0"><Terminal simulator={simulatorRef.current} /></TabsContent>
          <TabsContent value="sensors" className="mt-0"><SensorPanel simulator={simulatorRef.current} /></TabsContent>
          <TabsContent value="playback" className="mt-0"><PlaybackPanel simulator={simulatorRef.current} /></TabsContent>
          <TabsContent value="dtc" className="mt-0"><DTCPanel simulator={simulatorRef.current} /></TabsContent>
          <TabsContent value="schematic" className="mt-0"><SchematicPanel /></TabsContent>
          <TabsContent value="research" className="mt-0"><ResearchPanel /></TabsContent>
        </Tabs>
      </main>

      {/* Footer */}
      <footer className={`border-t ${border} mt-4`}>
        <div className={`max-w-[1400px] mx-auto px-4 py-2 flex items-center justify-between text-[10px] font-mono ${textMuted}`}>
          <span>© 2026 Marcelo Duchene — Todos os direitos reservados</span>
          <span>SIMULADOR DE ECU — EMULAÇÃO ELM327 SEM HARDWARE</span>
        </div>
      </footer>
    </div>
  );
}