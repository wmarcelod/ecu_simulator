import { useTheme, t } from '@/lib/theme-context';

const CONNECTIONS = [
  { arduino: 'D13 (SCK)', mcp: 'SCK', color: '#B45309', desc: 'SPI Clock' },
  { arduino: 'D12 (MISO)', mcp: 'SO', color: '#1D4ED8', desc: 'SPI Master In Slave Out' },
  { arduino: 'D11 (MOSI)', mcp: 'SI', color: '#15803D', desc: 'SPI Master Out Slave In' },
  { arduino: 'D10 (SS)', mcp: 'CS', color: '#7E22CE', desc: 'SPI Chip Select' },
  { arduino: 'D2 (INT0)', mcp: 'INT', color: '#0F766E', desc: 'Interrupt (CAN message received)' },
  { arduino: '5V', mcp: 'VCC', color: '#991B1B', desc: 'Power Supply 5V' },
  { arduino: 'GND', mcp: 'GND', color: '#475569', desc: 'Ground' },
];

const CAN_BUS = [
  { pin: 'CANH', desc: 'CAN Bus High', color: '#B45309' },
  { pin: 'CANL', desc: 'CAN Bus Low', color: '#1D4ED8' },
];

export default function SchematicPanel() {
  const { theme } = useTheme();

  const bg = t('bg-[#111827]', 'bg-white', theme);
  const border = t('border-[#1e293b]', 'border-gray-200', theme);
  const bg2 = t('bg-[#0f172a]', 'bg-gray-50', theme);
  const textMuted = t('text-slate-500', 'text-gray-500', theme);
  const textLabel = t('text-slate-400', 'text-gray-600', theme);
  const textMain = t('text-slate-300', 'text-gray-700', theme);

  return (
    <div className="space-y-3">
      {/* Title */}
      <div className={`${bg} border ${border} rounded-md p-3`}>
        <div className="flex items-center gap-2 mb-2">
          <div className="w-1 h-3 bg-emerald-500/70 rounded-full" />
          <span className={`text-[11px] font-mono ${textLabel} uppercase tracking-widest`}>Arduino + MCP2515 Wiring Schematic</span>
        </div>
        <p className={`text-[10px] font-mono ${textMuted}`}>
          Connection diagram for the CAN Gateway hardware. Arduino Uno/Nano communicates with MCP2515 CAN controller via SPI bus. The Arduino acts as a raw CAN gateway — OBD-II frames are built by the web app and relayed via CSV serial protocol.
        </p>
      </div>

      {/* Visual Schematic SVG */}
      <div className={`${bg} border ${border} rounded-md p-4`}>
        <svg viewBox="0 0 800 420" className="w-full h-auto" style={{ maxHeight: '420px' }}>
          {/* Background */}
          <rect x="0" y="0" width="800" height="420" fill={theme === 'dark' ? '#0f172a' : '#f8fafc'} rx="8" />

          {/* Arduino Uno Box */}
          <rect x="40" y="40" width="220" height="340" rx="8" fill={theme === 'dark' ? '#1e293b' : '#e2e8f0'} stroke={theme === 'dark' ? '#334155' : '#94a3b8'} strokeWidth="2" />
          <rect x="40" y="40" width="220" height="36" rx="8" fill="#2563eb" />
          <rect x="40" y="68" width="220" height="8" fill="#2563eb" />
          <text x="150" y="62" textAnchor="middle" fill="white" fontSize="13" fontFamily="monospace" fontWeight="bold">ARDUINO UNO</text>

          {/* Arduino Pins */}
          {CONNECTIONS.map((conn, i) => {
            const y = 100 + i * 38;
            return (
              <g key={conn.arduino}>
                <rect x="60" y={y - 10} width="180" height="28" rx="4" fill={theme === 'dark' ? '#0f172a' : '#f1f5f9'} stroke={conn.color} strokeWidth="1.5" />
                <text x="150" y={y + 6} textAnchor="middle" fill={conn.color} fontSize="11" fontFamily="monospace" fontWeight="bold">{conn.arduino}</text>
                {/* Wire line */}
                <line x1="240" y1={y} x2="520" y2={y} stroke={conn.color} strokeWidth="2" strokeDasharray={i === 6 ? '4,4' : 'none'} opacity="0.7" />
                <circle cx="240" cy={y} r="3" fill={conn.color} />
                <circle cx="520" cy={y} r="3" fill={conn.color} />
              </g>
            );
          })}

          {/* MCP2515 Module Box */}
          <rect x="520" y="40" width="240" height="340" rx="8" fill={theme === 'dark' ? '#1e293b' : '#e2e8f0'} stroke={theme === 'dark' ? '#334155' : '#94a3b8'} strokeWidth="2" />
          <rect x="520" y="40" width="240" height="36" rx="8" fill="#059669" />
          <rect x="520" y="68" width="240" height="8" fill="#059669" />
          <text x="640" y="62" textAnchor="middle" fill="white" fontSize="12" fontFamily="monospace" fontWeight="bold">MCP2515 + TJA1050</text>

          {/* MCP Pins */}
          {CONNECTIONS.map((conn, i) => {
            const y = 100 + i * 38;
            return (
              <g key={conn.mcp}>
                <rect x="540" y={y - 10} width="200" height="28" rx="4" fill={theme === 'dark' ? '#0f172a' : '#f1f5f9'} stroke={conn.color} strokeWidth="1.5" />
                <text x="640" y={y + 6} textAnchor="middle" fill={conn.color} fontSize="11" fontFamily="monospace" fontWeight="bold">{conn.mcp}</text>
              </g>
            );
          })}

          {/* CAN Bus Output */}
          <rect x="560" y="360" width="80" height="24" rx="4" fill="#f59e0b" opacity="0.2" stroke="#f59e0b" strokeWidth="1" />
          <text x="600" y="376" textAnchor="middle" fill="#f59e0b" fontSize="10" fontFamily="monospace" fontWeight="bold">CANH</text>
          <rect x="660" y="360" width="80" height="24" rx="4" fill="#38bdf8" opacity="0.2" stroke="#38bdf8" strokeWidth="1" />
          <text x="700" y="376" textAnchor="middle" fill="#38bdf8" fontSize="10" fontFamily="monospace" fontWeight="bold">CANL</text>

          {/* CAN Bus label */}
          <text x="650" y="400" textAnchor="middle" fill={theme === 'dark' ? '#64748b' : '#9ca3af'} fontSize="9" fontFamily="monospace">→ TO OBD-II / CAN BUS</text>

          {/* Title */}
          <text x="400" y="18" textAnchor="middle" fill={theme === 'dark' ? '#94a3b8' : '#6b7280'} fontSize="10" fontFamily="monospace">SPI BUS CONNECTION — 500 kbps CAN — ISO 15765-4</text>
        </svg>
      </div>

      {/* Pin Table */}
      <div className={`${bg} border ${border} rounded-md`}>
        <div className={`px-3 py-2 border-b ${border}`}>
          <span className={`text-[10px] font-mono ${textMuted} uppercase tracking-widest`}>Pin Connection Table</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px] font-mono">
            <thead>
              <tr className={`border-b ${border}`}>
                <th className={`px-3 py-2 text-left ${textMuted} uppercase text-[9px]`}>Arduino Pin</th>
                <th className={`px-3 py-2 text-left ${textMuted} uppercase text-[9px]`}>MCP2515 Pin</th>
                <th className={`px-3 py-2 text-left ${textMuted} uppercase text-[9px]`}>Signal</th>
                <th className={`px-3 py-2 text-left ${textMuted} uppercase text-[9px]`}>Description</th>
              </tr>
            </thead>
            <tbody>
              {CONNECTIONS.map((conn) => (
                <tr key={conn.arduino} className={`border-b ${border} last:border-b-0`}>
                  <td className={`px-3 py-1.5 ${textMain}`}>{conn.arduino}</td>
                  <td className="px-3 py-1.5" style={{ color: conn.color }}>{conn.mcp}</td>
                  <td className={`px-3 py-1.5 ${textLabel}`}>{conn.arduino.includes('D13') ? 'SPI CLK' : conn.arduino.includes('D12') ? 'SPI MISO' : conn.arduino.includes('D11') ? 'SPI MOSI' : conn.arduino.includes('D10') ? 'SPI CS' : conn.arduino.includes('D2') ? 'INT' : conn.arduino.includes('5V') ? 'VCC' : 'GND'}</td>
                  <td className={`px-3 py-1.5 ${textMuted}`}>{conn.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* CAN Bus Output */}
      <div className={`${bg} border ${border} rounded-md`}>
        <div className={`px-3 py-2 border-b ${border}`}>
          <span className={`text-[10px] font-mono ${textMuted} uppercase tracking-widest`}>CAN Bus Output (to OBD-II connector)</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px] font-mono">
            <thead>
              <tr className={`border-b ${border}`}>
                <th className={`px-3 py-2 text-left ${textMuted} uppercase text-[9px]`}>MCP2515 Pin</th>
                <th className={`px-3 py-2 text-left ${textMuted} uppercase text-[9px]`}>OBD-II Pin</th>
                <th className={`px-3 py-2 text-left ${textMuted} uppercase text-[9px]`}>Description</th>
              </tr>
            </thead>
            <tbody>
              <tr className={`border-b ${border}`}>
                <td className="px-3 py-1.5 text-amber-400">CANH</td>
                <td className={`px-3 py-1.5 ${textMain}`}>Pin 6</td>
                <td className={`px-3 py-1.5 ${textMuted}`}>CAN High — ISO 15765-4</td>
              </tr>
              <tr>
                <td className="px-3 py-1.5 text-sky-400">CANL</td>
                <td className={`px-3 py-1.5 ${textMain}`}>Pin 14</td>
                <td className={`px-3 py-1.5 ${textMuted}`}>CAN Low — ISO 15765-4</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Notes */}
      <div className={`${bg} border ${border} rounded-md p-3`}>
        <div className="flex items-center gap-2 mb-2">
          <div className="w-1 h-3 bg-amber-500/70 rounded-full" />
          <span className={`text-[10px] font-mono ${textLabel} uppercase tracking-widest`}>Important Notes</span>
        </div>
        <ul className={`text-[10px] font-mono ${textMuted} space-y-1 list-disc list-inside`}>
          <li><strong className={t('text-slate-200', 'text-gray-800', theme)}>Arduino operates as a CAN Gateway</strong> — raw CAN frame relay, not an ECU simulator</li>
          <li>Serial CSV protocol: <code className={`${t('bg-[#1e293b]', 'bg-gray-100', theme)} px-1 rounded text-[10px]`}>TX,ID,EXT,DATA</code> / <code className={`${t('bg-[#1e293b]', 'bg-gray-100', theme)} px-1 rounded text-[10px]`}>RX,ID,EXT,DLC,DATA,TS</code> / <code className={`${t('bg-[#1e293b]', 'bg-gray-100', theme)} px-1 rounded text-[10px]`}>INFO,MSG</code> / <code className={`${t('bg-[#1e293b]', 'bg-gray-100', theme)} px-1 rounded text-[10px]`}>PROTO,N</code></li>
          <li>OBD-II commands are constructed by the web app and sent as raw CAN frames via serial</li>
          <li>Crystal oscillator on MCP2515: 8 MHz (set MCP_8MHZ in firmware)</li>
          <li>Default CAN speed: 500 kbps — switchable via <code className={`${t('bg-[#1e293b]', 'bg-gray-100', theme)} px-1 rounded text-[10px]`}>PROTO</code> command (6/7 = 500kbps, 8/9 = 250kbps)</li>
          <li>Serial baud rate: 115200 bps (for Web Serial API communication)</li>
          <li>Install library: <strong className={t('text-slate-200', 'text-gray-800', theme)}>mcp_can</strong> by Seeed Studio (Arduino Library Manager)</li>
          <li>MCP2515 module must include CAN transceiver (TJA1050 or MCP2551)</li>
          <li>Optional: 120Ω termination resistor between CANH and CANL</li>
          <li>Power: Arduino can be powered via USB or external 7-12V supply</li>
        </ul>
      </div>
    </div>
  );
}