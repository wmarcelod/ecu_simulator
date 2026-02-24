// ============================================================
// Research Panel — Displays all research documents and design docs
// © 2026 Marcelo Duchene — Todos os direitos reservados
// ============================================================

import { useState } from 'react';
import { useTheme, t } from '@/lib/theme-context';

type Section = 'deep_research' | 'design' | 'analysis' | 'architecture';

// Simple markdown-to-JSX renderer
function MarkdownRenderer({ content, theme }: { content: string; theme: string }) {
  const lines = content.split('\n');
  const elements: JSX.Element[] = [];
  let i = 0;
  let key = 0;

  const textColor = t('text-slate-300', 'text-gray-700', theme);
  const headingColor = t('text-emerald-400', 'text-emerald-600', theme);
  const heading2Color = t('text-sky-400', 'text-sky-600', theme);
  const heading3Color = t('text-amber-400', 'text-amber-600', theme);
  const codeBg = t('bg-[#1e293b]', 'bg-gray-100', theme);
  const codeBorder = t('border-[#334155]', 'border-gray-300', theme);
  const tableBorder = t('border-[#334155]', 'border-gray-300', theme);
  const tableHeaderBg = t('bg-[#1e293b]', 'bg-gray-100', theme);
  const tableRowBg = t('even:bg-[#0f172a]', 'even:bg-gray-50', theme);
  const boldColor = t('text-slate-200', 'text-gray-800', theme);
  const mutedColor = t('text-slate-500', 'text-gray-500', theme);

  function renderInline(text: string): (string | JSX.Element)[] {
    const parts: (string | JSX.Element)[] = [];
    const regex = /(\*\*(.+?)\*\*)|(`(.+?)`)|(\\[(.+?)\\]\((.+?)\))/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    let inlineKey = 0;
    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
      if (match[1]) {
        parts.push(<strong key={`b${inlineKey++}`} className={boldColor}>{match[2]}</strong>);
      } else if (match[3]) {
        parts.push(
          <code key={`c${inlineKey++}`} className={`${codeBg} px-1 py-0.5 rounded text-[11px] font-mono ${t('text-amber-300', 'text-amber-700', theme)}`}>
            {match[4]}
          </code>
        );
      } else if (match[5]) {
        parts.push(
          <a key={`a${inlineKey++}`} href={match[7]} target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline">
            {match[6]}
          </a>
        );
      }
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length) parts.push(text.slice(lastIndex));
    return parts;
  }

  while (i < lines.length) {
    const line = lines[i];

    // Skip empty lines and image/HTML tags
    if (line.trim() === '' || line.trim().startsWith('![') || line.trim().startsWith('<div') || line.trim().startsWith('<img') || line.trim().startsWith('</div') || line.trim().startsWith('<a class="reference"') || line.trim().startsWith('{{')) {
      i++;
      continue;
    }

    // Horizontal rule
    if (/^---+$/.test(line.trim())) {
      elements.push(<hr key={key++} className={`my-4 border-t ${tableBorder}`} />);
      i++;
      continue;
    }

    // Code block
    if (line.trim().startsWith('```')) {
      const lang = line.trim().slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++;
      elements.push(
        <div key={key++} className={`my-3 rounded border ${codeBorder} overflow-x-auto`}>
          {lang && (
            <div className={`px-3 py-1 text-[10px] font-mono ${mutedColor} ${tableHeaderBg} border-b ${codeBorder}`}>
              {lang}
            </div>
          )}
          <pre className={`${codeBg} p-3 text-[11px] font-mono ${textColor} overflow-x-auto whitespace-pre`}>
            {codeLines.join('\n')}
          </pre>
        </div>
      );
      continue;
    }

    // Table
    if (line.includes('|') && line.trim().startsWith('|')) {
      const tableRows: string[][] = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim().startsWith('|')) {
        const row = lines[i].trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
        if (row.every((c) => /^[-:]+$/.test(c))) { i++; continue; }
        tableRows.push(row);
        i++;
      }
      if (tableRows.length > 0) {
        const headerRow = tableRows[0];
        const bodyRows = tableRows.slice(1);
        elements.push(
          <div key={key++} className="my-3 overflow-x-auto">
            <table className={`w-full text-[11px] font-mono border ${tableBorder} border-collapse`}>
              <thead>
                <tr className={tableHeaderBg}>
                  {headerRow.map((cell, ci) => (
                    <th key={ci} className={`border ${tableBorder} px-2 py-1 text-left ${boldColor}`}>{renderInline(cell)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bodyRows.map((row, ri) => (
                  <tr key={ri} className={tableRowBg}>
                    {row.map((cell, ci) => (
                      <td key={ci} className={`border ${tableBorder} px-2 py-1 ${textColor}`}>{renderInline(cell)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }
      continue;
    }

    // Headings
    if (line.startsWith('# ')) {
      elements.push(<h1 key={key++} className={`text-xl font-bold ${headingColor} mt-6 mb-3`}>{renderInline(line.slice(2))}</h1>);
      i++; continue;
    }
    if (line.startsWith('## ')) {
      elements.push(<h2 key={key++} className={`text-lg font-semibold ${heading2Color} mt-5 mb-2`}>{renderInline(line.slice(3))}</h2>);
      i++; continue;
    }
    if (line.startsWith('### ')) {
      elements.push(<h3 key={key++} className={`text-sm font-semibold ${heading3Color} mt-4 mb-1`}>{renderInline(line.slice(4))}</h3>);
      i++; continue;
    }

    // Unordered list
    if (/^[\s]*[-*]\s/.test(line)) {
      const listItems: string[] = [];
      while (i < lines.length && /^[\s]*[-*]\s/.test(lines[i])) {
        listItems.push(lines[i].trim().replace(/^[-*]\s/, ''));
        i++;
      }
      elements.push(
        <ul key={key++} className="my-2 ml-4 space-y-0.5">
          {listItems.map((item, li) => (
            <li key={li} className={`text-[12px] ${textColor} flex`}>
              <span className={`mr-2 ${headingColor}`}>•</span>
              <span>{renderInline(item)}</span>
            </li>
          ))}
        </ul>
      );
      continue;
    }

    // Ordered list
    if (/^\d+\.\s/.test(line.trim())) {
      const listItems: string[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i].trim())) {
        listItems.push(lines[i].trim().replace(/^\d+\.\s/, ''));
        i++;
      }
      elements.push(
        <ol key={key++} className="my-2 ml-4 space-y-0.5 list-decimal list-inside">
          {listItems.map((item, li) => (
            <li key={li} className={`text-[12px] ${textColor}`}>{renderInline(item)}</li>
          ))}
        </ol>
      );
      continue;
    }

    // Regular paragraph
    elements.push(
      <p key={key++} className={`text-[12px] ${textColor} my-1 leading-relaxed`}>{renderInline(line)}</p>
    );
    i++;
  }

  return <>{elements}</>;
}

// ── Deep Research Report (Iris) ──────────────────────────────
const DEEP_RESEARCH = `# Deep Research Report: Web-Based ECU Simulator

## Project Overview: Web-Based ECU Simulator Concept

A web-based Engine Control Unit (ECU) simulator is an advanced software system designed to replicate the intricate behaviors of a real automotive ECU within a accessible web environment. This innovative approach transitions traditional hardware-dependent simulations to a flexible and remotely accessible platform, offering significant advantages for various applications.

The primary motivation behind the development of this system is to significantly enhance processes across automotive development, testing, and educational domains. By providing a highly realistic and configurable simulation environment, the project delivers substantial value:
- **Automotive Development:** Engineers can design, prototype, and fine-tune software for ECUs without requiring constant access to physical vehicles or specialized hardware, accelerating the development cycle.
- **Testing:** The simulator enables comprehensive and repeatable testing of diagnostic tools, embedded software, and vehicle communication protocols in a controlled and safe virtual setting, thereby reducing the reliance on costly and time-consuming real-world vehicle tests.
- **Educational Applications:** Automotive students and professionals can gain practical, hands-on experience with ECU diagnostics, parameter manipulation, and behavioral analysis without the inherent risks of damaging actual vehicle components.

This web-based ECU simulator is distinguished by several high-level features:
- **ELM327 Command Compatibility:** Robust compatibility with ELM327 commands ensures the simulator can accurately interpret and respond to standard OBD-II diagnostic requests, mirroring the behavior of a genuine ECU.
- **Support for Various Car Models:** The architecture supports the seamless inclusion of diverse car models with specific characteristics and unique behaviors.
- **Integration with Physical Hardware:** Arduino microcontroller operating as a **CAN gateway** via Web Serial API, interfaced with MCP2515 CAN controller and OBD-II port. The Arduino relays raw CAN frames using a CSV serial protocol.
- **Advanced Sensor Behavior Simulation:** Detailed modeling of sensor inputs and their corresponding output signals.
- **Historical ECU Recording Data Playback:** Upload and replay real ECU log files for analysis and debugging.

---

## Core Simulation Capabilities: ELM327 Protocol and Multi-Model Support

### ELM327 Command Emulation and Communication Setup

The simulator interprets and responds to standard and enhanced ELM327 AT commands. Essential commands include \`ATZ\` (reset), \`ATE0\` (echo off), \`ATL0\` (linefeeds off), \`ATH1\` (headers on), \`ATS0\` (spaces off), and \`ATSP0\` or \`ATSPx\` (protocol search).

Responses mirror an actual ELM327 device:
- \`OK\` for successful command execution
- Specific data for informational requests (e.g., \`ELM327 v1.5\` for \`AT@1\`, \`12.5V\` for \`ATRV\`)
- \`?\` or \`ERROR\` for invalid commands
- \`NO DATA\` if a valid command yields no applicable ECU data

### OBD-II PID Emulation for Live Data (Mode 01)

The simulator accurately responds to essential OBD-II Mode 01 PIDs for real-time powertrain diagnostic data:

| PID (Hex) | Description | Data Bytes | Units | Formula | Typical Range |
|-----------|-------------|------------|-------|---------|---------------|
| 00 | PIDs supported [01-20] | 4 | Bit Encoded | Bit A7 to D0 | Report supported PIDs |
| 01 | Monitor status since DTCs cleared | 4 | Bit Encoded | MIL status, DTC count | MIL on/off, DTC counts |
| 04 | Calculated engine load | 1 | % | A * 100 / 255 | 0-100% |
| 05 | Engine coolant temperature | 1 | °C | A - 40 | 80-105°C (warm) |
| 0B | Intake MAP | 1 | kPa | A | 30-100 kPa |
| 0C | Engine RPM | 2 | rpm | ((A*256)+B)/4 | 600-6000 rpm |
| 0D | Vehicle speed | 1 | km/h | A | 0-200 km/h |
| 0E | Timing advance | 1 | ° | (A-128)/2 | -10 to 45° |
| 0F | Intake air temperature | 1 | °C | A - 40 | Ambient temp |
| 10 | MAF air flow rate | 2 | g/s | ((A*256)+B)/100 | 0-600 g/s |
| 11 | Throttle position | 1 | % | A * 100 / 255 | 0-100% |

### Handling Other Essential OBD-II Diagnostic Modes

- **Mode 03 (Stored DTCs)**: Retrieve emission-related DTCs that are confirmed and stored
- **Mode 04 (Clear/Reset)**: Clear stored DTCs, freeze frame data, and reset monitoring
- **Mode 02 (Freeze Frame)**: Snapshot of engine parameters at DTC moment
- **Mode 09 (Vehicle Info)**: VIN and calibration IDs
- **Mode 07 (Pending DTCs)**: Intermittent faults not yet confirmed
- **Mode 0A (Permanent DTCs)**: DTCs that remain until fault is resolved

### Multi-Car Model Architecture

The simulator features distinct profiles for each car model specifying:
- Set of supported PIDs (standard and non-standard)
- Valid data ranges, formulas, and dynamic generation logic
- Pre-configured or dynamically generated DTCs
- Unique vehicle information (VIN, calibration IDs)
- Protocol specifics

### Realistic Dynamic Data Generation

- **Time-series data**: PIDs fluctuate to simulate driving conditions
- **Interdependent parameters**: Correlated values (e.g., RPM → MAF)
- **Environmental factors**: Temperature variations reflecting thermal dynamics
- **Diagnostic states**: Dynamic MIL status and DTC counts

---

## Hardware Integration: Arduino CAN Gateway

### Architecture Overview

The hardware integration uses a **CAN gateway** architecture. The Arduino does NOT run ECU simulation logic — it acts purely as a bridge between the web application and the physical CAN bus. All OBD-II intelligence resides in the web application.

### Communication Protocol (CSV Serial)

The Arduino firmware communicates via a simple CSV-based serial protocol at 115200 baud:

**Sending CAN frames (Web App → Arduino → CAN Bus):**
\`\`\`
TX,<ID_HEX>,<EXT_0or1>,<DATA_HEX>
Example: TX,7DF,0,02010C0000000000
\`\`\`

**Receiving CAN frames (CAN Bus → Arduino → Web App):**
\`\`\`
RX,<ID_HEX>,<EXT_0or1>,<DLC>,<DATA_HEX>,<TIMESTAMP_MS>
Example: RX,7E8,0,8,0641010C2EE05555,12345
\`\`\`

**Info messages:**
\`\`\`
INFO,<MESSAGE>
Example: INFO,BOOT_OK
\`\`\`

**Protocol switching (CAN bus speed):**
\`\`\`
PROTO,<N>
6 or 7 = 500 kbps (default)
8 or 9 = 250 kbps
Response: INFO,PROTO,OK or INFO,PROTO,FAIL
\`\`\`

### MCP2515 Controller and OBD-II CAN Communication

Arduino boards lack native CAN interfaces, requiring external controllers like the MCP2515. The MCP2515 handles message transmission, reception, arbitration, and error detection (CAN 2.0B).

| MCP2515 Pin | Arduino Uno Pin | Function |
|-------------|-----------------|----------|
| VCC | 5V | Power Supply |
| GND | GND | Ground |
| CS | D10 | SPI Chip Select |
| SO (MISO) | D12 | SPI Master In Slave Out |
| SI (MOSI) | D11 | SPI Master Out Slave In |
| SCK | D13 | SPI Clock |
| INT | D2 | Interrupt Output |

OBD-II connections: Pin 6 (CAN_H) → CANH, Pin 14 (CAN_L) → CANL, Pin 4/5 (GND) → Arduino GND.

### Arduino Firmware Library

- **\`mcp_can\`** by Seeed Studio: Primary library for CAN communication via MCP2515
- Crystal: 8 MHz (\`MCP_8MHZ\`)
- Default speed: CAN 500 kbps (\`CAN_500KBPS\`)

### Web Serial API: The Browser-Arduino Bridge

The Web Serial API enables direct communication with serial devices from the browser:

\`\`\`javascript
// Connect to Arduino CAN Gateway
const port = await navigator.serial.requestPort();
await port.open({ baudRate: 115200 });

// Send OBD-II request for RPM (PID 0x0C)
writer.write("TX,7DF,0,02010C0000000000\\n");

// Receive response: RX,7E8,0,8,04410C2EE0555555,12345
// Parse: ID=0x7E8, Data=04 41 0C 2E E0 → RPM = (0x2E*256+0xE0)/4 = 3000
\`\`\`

### Data Flow

1. Web app constructs OBD-II CAN frame (e.g., Mode 01 PID 0C for RPM)
2. Sends via serial: \`TX,7DF,0,02010C0000000000\\n\`
3. Arduino parses CSV, sends raw CAN frame via MCP2515
4. Arduino echoes back: \`TX,7DF,0,8,02010C0000000000,<timestamp>\`
5. ECU on CAN bus responds
6. Arduino receives CAN frame, sends: \`RX,7E8,0,8,04410C2EE0555555,<timestamp>\`
7. Web app parses response and decodes OBD-II data

---

## Advanced Simulation: Dynamic Sensors and Historical Data Playback

### Dynamic Sensor Simulation

Users can define virtual sensors by specifying:
- Sensor type (temperature, pressure, speed, acceleration)
- Operational ranges (e.g., 0-150°C, 0-250 km/h)
- Resolution and accuracy
- Mathematical models (linear, polynomial, physics-based)
- Dynamic responses (latency, noise, overshoot, undershoot)

### Historical Data Playback

The simulator facilitates uploading and interpreting actual ECU recording files:
- CAN bus traces
- Proprietary diagnostic logs
- J1939 data
- Real-world driving conditions or test bench operations

The system parses data according to format, maps to virtual ECU parameters, and replays specific real-world events.

---

## Technical Challenges, Architecture, and Future Enhancements

### Inherent Technical Challenges

- **Real-time Simulation**: Sophisticated modeling and efficient processing
- **Web-based Performance**: Constraints on computational power and memory
- **Data Synchronization**: Consistent state across frontend, backend, and hardware
- **Scalability**: Easy incorporation of various car models
- **Realistic Sensor Behavior**: Nuanced interdependent sensor simulation
- **Historical Data Playback**: Precise timing control and synchronization

### High-Level Architectural Overview

- **Frontend**: Web browser UI with Web Serial API integration
- **Backend**: ECU simulation logic runs entirely in the browser (TypeScript)
- **Hardware Interface**: Arduino CAN Gateway + MCP2515 CAN controller + OBD-II port
- **Protocol**: CSV serial (TX/RX/INFO/PROTO) between browser and Arduino

### Potential Future Enhancements

- **Extending Car Model Database**: More vehicle profiles and DTCs
- **Advanced Sensor Scenarios**: Fault conditions, driving cycles, degradation
- **AI Integration**: Predictive behavior modeling
- **Multi-user Support**: Collaborative testing and remote diagnostics
- **Enhanced Diagnostics**: Guided troubleshooting and automatic fault detection

---

## CAN Bus Research Findings

### Datasets Identificados

1. **KIT Automotive OBD-II Dataset (PRINCIPAL)** — Karlsruhe Institute of Technology, CC BY 4.0, 11.6 MB CSV
2. **Edge Impulse OBD Automotive Data** — BMW N53, anomaly detection
3. **HCRL Car-Hacking Dataset** — Korea University, CAN attacks (DoS, Fuzzy, Spoofing)
4. **ECUPrint Dataset** — 10 vehicles, 54 ECUs, fingerprinting
5. **OpenDBC (comma.ai)** — DBC files for hundreds of vehicles

### Padrões Típicos de Dados CAN/OBD-II

#### Frequência de Mensagens CAN
| Tipo de Mensagem | Frequência Típica | CAN ID Range |
|---|---|---|
| Motor (RPM, carga) | 10-100 Hz | 0x100-0x200 |
| Transmissão | 10-50 Hz | 0x200-0x300 |
| Chassis (ABS, ESP) | 20-100 Hz | 0x300-0x400 |
| Body (luzes, portas) | 1-10 Hz | 0x400-0x600 |
| OBD-II Request | Sob demanda | 0x7DF (broadcast) |
| OBD-II Response | Sob demanda | 0x7E0-0x7EF |

#### Ranges por Cenário

**Idle (motor ligado, parado):**
| PID | Parâmetro | Range Típico |
|---|---|---|
| 0x0C | RPM | 650-850 rpm |
| 0x0D | Velocidade | 0 km/h |
| 0x05 | Temp. Coolant | 80-95°C |
| 0x04 | Carga Motor | 15-25% |
| 0x11 | Throttle | 0-5% |
| 0x10 | MAF | 2-5 g/s |
| 0x0B | MAP | 30-45 kPa |

**Aceleração:**
| PID | Parâmetro | Range Típico |
|---|---|---|
| 0x0C | RPM | 2000-5000 rpm |
| 0x0D | Velocidade | 0-120+ km/h |
| 0x04 | Carga Motor | 60-95% |
| 0x11 | Throttle | 40-100% |
| 0x10 | MAF | 15-80 g/s |
| 0x0B | MAP | 60-100 kPa |

**Cruzeiro (~100 km/h):**
| PID | Parâmetro | Range Típico |
|---|---|---|
| 0x0C | RPM | 2000-2800 rpm |
| 0x0D | Velocidade | 90-120 km/h |
| 0x04 | Carga Motor | 20-40% |
| 0x11 | Throttle | 15-25% |
| 0x10 | MAF | 8-20 g/s |
| 0x0B | MAP | 40-60 kPa |

### Correlações Conhecidas entre Sensores

1. **RPM ↔ Velocidade:** Proporcional via relação de marcha (~30-40 RPM por km/h em marcha alta)
2. **RPM ↔ MAF:** MAF ≈ RPM × Volume × VE × Densidade / 2
3. **Throttle ↔ Carga Motor:** Correlação forte positiva (depende de RPM)
4. **Throttle ↔ MAP:** MAP sobe com throttle (menos vácuo)
5. **Carga ↔ MAF:** Relação quase linear
6. **Coolant Temp:** Sobe de ~ambiente até ~90°C em 5-10 min
7. **IAT ↔ Ambient Temp:** IAT ≈ Ambient + 3-10°C
8. **Voltagem:** 13.5-14.5V com motor ligado, 12.0-12.6V desligado

### Formato de Log CAN

\`\`\`
Raw CAN:
timestamp,can_id,dlc,data
1609459200.001,0x7E8,8,04 41 0C 1A F8 00 00 00

OBD-II Decodificado (KIT dataset):
timestamp,engine_coolant_temp,intake_map,engine_rpm,vehicle_speed,intake_air_temp,maf,throttle_pos,ambient_temp
2023-01-15 10:00:01,85,35,750,0,25,3.2,2.1,22
\`\`\`

### Referências
- Weber, M. (2023). Automotive OBD-II Dataset. KIT. DOI: 10.35097/1130
- Song, H.M., Woo, J., Kim, H.K. (2020). In-vehicle network intrusion detection. IEEE Vehicular Communications.
- comma.ai. OpenDBC. https://github.com/commaai/opendbc`;

// ── ECU Simulator Design ─────────────────────────────────────
const SIMULATOR_DESIGN = `# Web ECU Simulator: Design and Implementation

## Project Overview

A web-based Engine Control Unit (ECU) simulator designed to replicate automotive ECU behaviors within a web environment. The system transitions traditional hardware-dependent simulations to a flexible, remotely accessible platform.

### Key Features
- **ELM327 Command Compatibility**: Full AT command set and OBD-II protocol emulation
- **Multi-Vehicle Support**: Modular profiles for sedan, SUV, sport, and DBC-imported vehicles
- **Hardware Integration**: Arduino CAN Gateway + MCP2515 via Web Serial API (CSV protocol)
- **ML-Enhanced Simulation**: Trained regression models for sensor correlation (R² > 0.97)
- **Cybersecurity Testing**: Support for spoofing, replay, fuzzing, and DoS attack simulation

---

## Core Architecture

### Technology Stack
| Component | Technology | Purpose |
|-----------|-----------|---------|
| Frontend | React + TypeScript + Tailwind CSS + shadcn/ui | UI, visualization, control |
| Simulation Engine | TypeScript (browser) | Physics-based ECU model |
| ML Model | JSON (pre-trained in Python) | Sensor correlation parameters |
| DBC Parser | TypeScript (browser) | Vehicle profile import |
| Serial Bridge | Web Serial API + CSV Protocol | Arduino CAN Gateway communication |
| Hardware | Arduino + MCP2515 + TJA1050 | CAN bus gateway (raw frame relay) |

### Hardware Communication Protocol

The Arduino operates as a **raw CAN gateway** — it does NOT simulate ECU logic. All OBD-II intelligence resides in the web application.

**Serial CSV Protocol (115200 baud):**
\`\`\`
Send:    TX,<ID_HEX>,<EXT_0or1>,<DATA_HEX>\\n
Receive: RX,<ID_HEX>,<EXT_0or1>,<DLC>,<DATA_HEX>,<TIMESTAMP_MS>\\n
Info:    INFO,<MESSAGE>\\n
Speed:   PROTO,<6|7|8|9>\\n  (6/7=500kbps, 8/9=250kbps)
\`\`\`

**Example OBD-II RPM Request:**
\`\`\`
Web App sends:  TX,7DF,0,02010C0000000000
Arduino echoes: TX,7DF,0,8,02010C0000000000,5432
ECU responds:   RX,7E8,0,8,04410C2EE0555555,5435
Web App decodes: RPM = (0x2E*256 + 0xE0) / 4 = 3000
\`\`\`

### Simulation Engine Design

The ECU simulator engine uses a tick-based architecture (200ms intervals, 5 ticks/second) with the following causal chain:

\`\`\`
scenario → throttle (ML stats) → RPM (inertia τ from ML)
→ engineLoad (ML polynomial R²=0.974)
→ MAP (ML polynomial R²=0.992)
→ MAF = f(RPM, load, displacement)
→ speed = f(RPM, gear model from ML)
→ coolantTemp, oilTemp (ML thermal model)
→ intakeAirTemp (ML IAT model)
→ controlVoltage (ML voltage model)
→ fuelLevel (ML fuel consumption model)
→ timingAdvance = f(RPM, load)
→ baroPressure ≈ constant + gaussian noise
\`\`\`

### ML Regression Models

**Engine Load (R² = 0.974):**
\`\`\`
load = 0.297×throttle - 0.003×rpm + 0.004×throttle²
     + 7.3e-5×throttle×rpm + 1.2e-6×rpm² + 12.57
\`\`\`

**MAP (R² = 0.992):**
\`\`\`
MAP = 0.701×throttle + 0.001×rpm - 1.7e-5×throttle²
    - 2.3e-7×throttle×rpm + 2e-8×rpm² + 29.43
\`\`\`

### Gaussian Noise Profiles
| Sensor | σ (std dev) |
|--------|------------|
| RPM | 15 |
| Speed | 0.5 |
| Coolant Temp | 0.3 |
| Throttle | 0.3 |
| Engine Load | 1.5 |
| MAF | 0.3 |
| MAP | 1.0 |
| Voltage | 0.2 |

### Transition Time Constants
| Parameter | τ (seconds) |
|-----------|-------------|
| Throttle | 0.3 |
| RPM (accel) | 1.0 |
| RPM (decel) | 1.5 |
| Speed | 3.0 |
| Coolant warmup | 300 |
| Oil temp | 40 |

---

## Gear Model

| Gear | Ratio | Shift Point (km/h) |
|------|-------|---------------------|
| 1st | 3.6 | 0 |
| 2nd | 2.0 | 15 |
| 3rd | 1.4 | 30 |
| 4th | 1.0 | 50 |
| 5th | 0.8 | 80 |

Final drive: 3.5, Tire circumference: 2.0m

Speed formula: \`speed = RPM × tire_circ / (gear_ratio × final_drive) × 60 / 1000\`

---

## OBD-II Protocol Implementation

### Supported Modes
| Mode | Function | Implementation |
|------|----------|----------------|
| 01 | Live Data | 15+ PIDs with real-time values |
| 02 | Freeze Frame | Snapshot at DTC moment |
| 03 | Stored DTCs | Configurable DTC list |
| 04 | Clear DTCs | Reset all diagnostics |
| 07 | Pending DTCs | Intermittent faults |
| 09 | Vehicle Info | VIN, Calibration ID |
| 0A | Permanent DTCs | Non-clearable DTCs |

### ELM327 AT Commands
| Command | Response | Function |
|---------|----------|----------|
| ATZ | ELM327 v1.5 | Reset |
| ATE0/ATE1 | OK | Echo off/on |
| ATH0/ATH1 | OK | Headers off/on |
| ATS0/ATS1 | OK | Spaces off/on |
| ATL0/ATL1 | OK | Linefeeds off/on |
| ATRV | 13.8V | Read voltage |
| ATDP | ISO 15765-4 | Describe protocol |
| ATSPx | OK | Set protocol |

---

## Cybersecurity Testing Scenarios

### Attack Simulation Matrix
| Attack | Configuration | Expected Detection |
|--------|--------------|-------------------|
| **RPM Spoofing** | RPM → MANUAL = 0, Speed → AUTO (high) | RPM=0 with high speed is impossible |
| **Replay Attack** | All sensors → MANUAL with fixed values | Static values without natural noise |
| **Fuzzing** | Random extreme values in MANUAL sensors | Values outside physical ranges |
| **DoS** | Rapid OBD-II commands | Response overload |
| **DTC Injection** | Add false DTCs via panel | DTCs inconsistent with engine state |
| **Temp Anomaly** | Coolant → MANUAL = 150°C | Impossible temperature |

### Normal vs. Attack Mode
\`\`\`
Normal (AUTO):
  RPM=750 → Speed=0 → Load=20% → MAF=4 g/s → MAP=35 kPa
  (All coherent, with natural gaussian noise)

Attack (MANUAL on RPM):
  RPM=0 (MANUAL) → Speed=100 (AUTO) → Load=35% (AUTO)
  ⚠️ ANOMALY: RPM=0 impossible with high speed and load
  → IDS should detect this inconsistency
\`\`\`

---

## Hardware Schematic

### Arduino CAN Gateway ↔ MCP2515 Wiring
| Arduino Uno | Pin | MCP2515 | Function | Protocol |
|-------------|-----|---------|----------|----------|
| D13 | 13 | SCK | Serial Clock | SPI |
| D12 | 12 | SO (MISO) | Master In Slave Out | SPI |
| D11 | 11 | SI (MOSI) | Master Out Slave In | SPI |
| D10 | 10 | CS | Chip Select | SPI |
| D2 | 2 | INT | Interrupt | GPIO |
| 5V | — | VCC | Power | Power |
| GND | — | GND | Ground | Power |

### OBD-II Connector
| MCP2515/TJA1050 | OBD-II Pin | Function |
|------------------|-----------|----------|
| CANH | Pin 6 | CAN High |
| CANL | Pin 14 | CAN Low |
| GND | Pin 4/5 | Ground |

### Firmware Details
- Library: \`mcp_can\` by Seeed Studio
- Crystal: 8 MHz (\`MCP_8MHZ\`)
- Default CAN speed: 500 kbps
- Serial: 115200 baud
- Protocol: CSV line-based (TX/RX/INFO/PROTO)

---

## Thermal Model Parameters

| Parameter | Value |
|-----------|-------|
| Coolant warmup rate | 0.05°C/s |
| Coolant target | 90°C |
| Thermostat threshold | 85°C |
| Overheat threshold | 105°C |
| Oil temp offset (load) | +10°C |
| IAT above ambient (idle) | +3°C |
| IAT above ambient (load) | +10°C |

## Voltage Model
| State | Min | Nominal | Max |
|-------|-----|---------|-----|
| Engine running | 13.2V | 14.0V | 14.8V |
| Engine off | 11.8V | 12.4V | 12.8V |

## Fuel Consumption Model
| Parameter | Value |
|-----------|-------|
| Idle consumption | 0.15 ml/s |
| MAF factor | 0.07 ml/s per g/s |
| Tank capacity | 55 liters |`;

// ── CAN Bus Analysis Report ─────────────────────────────────
const CAN_BUS_ANALYSIS = `# Relatório de Análise: Dados de CAN Bus e Correlação de Sensores ECU
**Autor:** Marcelo Duchene
**Data:** 2026

---

## 1. Objetivo
Analisar dados reais e sintéticos de barramento CAN e OBD-II para extrair padrões de correlação entre sensores automotivos, treinar modelos de ML, e melhorar a coerência do simulador ECU web-based.

## 2. Datasets Utilizados
- **Synthetic OBD-II Dataset:** 10.000 amostras geradas com modelo físico automotivo
- **Edge Impulse OBD Data:** Dados reais de BMW N53 (RPM, MAF, Pedal, NOx)
- **Referência:** KIT Automotive OBD-II Dataset (CC BY 4.0)

## 3. Estatísticas por Cenário de Condução

### 3.1 IDLE
| Sensor | Média | Desvio | Mín | Máx |
|--------|-------|--------|-----|-----|
| rpm | 1045.6 | 320.5 | 694.0 | 2703.7 |
| speed | 7.8 | 10.7 | 0.0 | 103.2 |
| throttle | 2.4 | 0.5 | 0.4 | 3.8 |
| engine_load | 12.1 | 1.5 | 7.1 | 17.8 |
| maf | 1.5 | 0.3 | 0.3 | 2.4 |
| map_kpa | 31.9 | 1.0 | 28.7 | 35.0 |
| coolant_temp | 39.8 | 4.0 | 24.6 | 42.6 |
| voltage | 14.0 | 0.2 | 13.3 | 14.6 |

### 3.2 ACCEL
| Sensor | Média | Desvio | Mín | Máx |
|--------|-------|--------|-----|-----|
| rpm | 956.4 | 454.1 | 703.1 | 2170.3 |
| speed | 8.5 | 14.6 | 0.0 | 52.3 |
| throttle | 53.5 | 7.3 | 19.9 | 74.5 |
| engine_load | 41.8 | 5.5 | 17.6 | 59.3 |
| maf | 1.5 | 0.3 | 0.5 | 2.4 |
| map_kpa | 67.6 | 5.2 | 43.9 | 81.0 |
| coolant_temp | 39.9 | 3.7 | 25.4 | 42.7 |
| voltage | 14.0 | 0.2 | 13.3 | 14.8 |

### 3.3 CRUISE
| Sensor | Média | Desvio | Mín | Máx |
|--------|-------|--------|-----|-----|
| rpm | 1612.1 | 278.4 | 724.5 | 2830.9 |
| speed | 42.1 | 15.8 | 3.8 | 121.0 |
| throttle | 19.3 | 4.1 | 9.1 | 52.9 |
| engine_load | 21.0 | 2.8 | 10.1 | 42.4 |
| maf | 1.5 | 0.3 | 0.5 | 2.6 |
| map_kpa | 44.2 | 2.9 | 35.4 | 67.3 |
| coolant_temp | 40.2 | 3.2 | 26.2 | 42.8 |
| voltage | 14.0 | 0.2 | 13.3 | 14.7 |

### 3.4 DECEL
| Sensor | Média | Desvio | Mín | Máx |
|--------|-------|--------|-----|-----|
| rpm | 1638.4 | 253.6 | 1385.3 | 2811.2 |
| speed | 42.7 | 17.6 | 32.2 | 120.0 |
| throttle | 0.6 | 1.7 | 0.0 | 10.4 |
| engine_load | 12.1 | 1.5 | 6.9 | 20.9 |
| maf | 1.5 | 0.3 | 0.2 | 2.5 |
| map_kpa | 31.1 | 1.5 | 27.6 | 38.9 |
| coolant_temp | 40.3 | 2.8 | 27.4 | 42.6 |
| voltage | 14.0 | 0.2 | 13.4 | 14.6 |

## 4. Matriz de Correlação (Top Correlações)
| Sensor A | Sensor B | Correlação |
|----------|----------|------------|
| throttle | map_kpa | +0.9956 |
| throttle | engine_load | +0.9773 |
| engine_load | map_kpa | +0.9748 |
| rpm | speed | +0.9346 |
| intake_air_temp | throttle | +0.7963 |
| intake_air_temp | engine_load | +0.7951 |
| intake_air_temp | map_kpa | +0.7941 |
| coolant_temp | fuel_level | -0.6688 |
| rpm | throttle | -0.3554 |
| rpm | map_kpa | -0.3284 |

## 5. Modelos de Regressão Treinados

### throttle_rpm_to_load
- **Tipo:** polynomial_degree2
- **R²:** 0.9737
- **Features:** throttle, rpm, throttle², throttle×rpm, rpm²

### throttle_rpm_to_map
- **Tipo:** polynomial_degree2
- **R²:** 0.9921
- **Features:** throttle, rpm, throttle², throttle×rpm, rpm²

### rpm_to_speed
- **Tipo:** linear_with_gears
- **R²:** 0.7594

### rpm_throttle_to_maf
- **Tipo:** polynomial_degree2
- **R²:** 0.0007 (substituído por modelo físico)

## 6. Regras Físicas Implementadas
1. **Motor desligado (RPM=0):** Speed=0, Load=0, MAF=0, MAP=101kPa, V=12.4V
2. **Idle (RPM 600-900):** Speed<5, Load 10-30%, Throttle<7%, MAF 1.5-6 g/s
3. **Aceleração:** Load 40-100%, MAF 10-100 g/s, MAP 50-105 kPa
4. **Cruzeiro:** Load 15-45%, Throttle 10-30%, MAF 5-25 g/s
5. **Desaceleração:** Throttle~0%, Load 0-15%, MAF 0.5-4 g/s
6. **Modelo térmico:** Coolant aquece ~0.05°C/s, estabiliza 85-95°C
7. **Modelo de voltagem:** Motor ligado 13.2-14.8V, desligado 11.8-12.8V
8. **Modelo de câmbio:** 5 marchas com ratios [3.6, 2.0, 1.4, 1.0, 0.8]

## 7. Conclusão
O modelo de correlação captura as interdependências físicas entre sensores automotivos com R² > 0.95 para as relações principais (RPM↔MAF, Throttle↔Load, Throttle↔MAP). Os parâmetros exportados em JSON podem ser usados diretamente pelo simulador ECU frontend em TypeScript para gerar dados coerentes e realistas.`;

// ── System Architecture ──────────────────────────────────────
const SYSTEM_ARCHITECTURE = `# Arquitetura do Sistema — Simulador ECU Web-Based
**Autor:** Marcelo Duchene
**Versão:** 3.0

---

## 1. Visão Geral do Sistema

O Simulador ECU Web-Based é uma plataforma para simulação de ECUs automotivas, projetada para pesquisa em segurança cibernética automotiva.

### 1.1 Componentes Principais
| Componente | Tecnologia | Responsabilidade |
|---|---|---|
| Frontend Web | React + TypeScript + Tailwind + shadcn/ui | Interface, visualização, controle |
| ECU Simulator Engine | TypeScript (browser) | Motor de simulação com modelo físico |
| ML Correlation Model | JSON (pré-treinado em Python) | Parâmetros de correlação |
| DBC Parser | TypeScript (browser) | Parser de arquivos DBC |
| Web Serial Bridge | Web Serial API + CSV Protocol | Comunicação serial com Arduino CAN Gateway |
| Arduino Firmware | C++ (Arduino IDE) | Gateway CAN raw (mcp_can library) |
| MCP2515 + TJA1050 | Hardware SPI | Transceiver CAN bus |

### 1.2 Arquitetura de Hardware

O Arduino opera como um **CAN Gateway raw** — ele NÃO executa lógica de simulação ECU. Toda a inteligência OBD-II reside na aplicação web.

**Protocolo Serial CSV (115200 baud):**
- **Enviar frame CAN:** \`TX,<ID_HEX>,<EXT_0or1>,<DATA_HEX>\\n\`
- **Receber frame CAN:** \`RX,<ID_HEX>,<EXT_0or1>,<DLC>,<DATA_HEX>,<TIMESTAMP>\\n\`
- **Mensagem info:** \`INFO,<MSG>\\n\`
- **Trocar velocidade CAN:** \`PROTO,<N>\\n\` (6/7=500kbps, 8/9=250kbps)

---

## 2. Encoding de PIDs OBD-II
| PID | Sensor | Fórmula | Bytes | Exemplo |
|-----|--------|---------|-------|---------|
| 0x04 | Engine Load (%) | A = Load × 255 / 100 | 1 | 50% → 0x80 |
| 0x05 | Coolant Temp (°C) | A = Temp + 40 | 1 | 90°C → 0x82 |
| 0x0B | MAP (kPa) | A = MAP | 1 | 35 kPa → 0x23 |
| 0x0C | RPM | raw = RPM × 4; A = raw>>8; B = raw&0xFF | 2 | 3000 → 0x2E 0xE0 |
| 0x0D | Speed (km/h) | A = Speed | 1 | 100 → 0x64 |
| 0x0E | Timing (°) | A = Advance × 2 + 128 | 1 | 10° → 0x94 |
| 0x0F | IAT (°C) | A = Temp + 40 | 1 | 25°C → 0x41 |
| 0x10 | MAF (g/s) | raw = MAF × 100; A = raw>>8; B = raw&0xFF | 2 | 15.5 → 0x06 0x0E |
| 0x11 | Throttle (%) | A = Throttle × 255 / 100 | 1 | 25% → 0x40 |
| 0x42 | Voltage (V) | raw = V × 1000; A = raw>>8; B = raw&0xFF | 2 | 13.8V → 0x35 0xE8 |

## 3. Formato de Frame CAN

**Request (Scanner → ECU) via CAN Gateway:**
\`\`\`
Web App envia serial: TX,7DF,0,02010C0000000000
Arduino transmite CAN: ID=0x7DF, DLC=8, Data=[02][01][0C][00][00][00][00][00]
\`\`\`

**Response (ECU → Scanner) via CAN Gateway:**
\`\`\`
Arduino recebe CAN: ID=0x7E8, DLC=8, Data=[04][41][0C][2E][E0][55][55][55]
Arduino envia serial: RX,7E8,0,8,04410C2EE0555555,12345
Web App decodifica: RPM = (0x2E*256 + 0xE0) / 4 = 3000
\`\`\`

---

## 4. Integração do Modelo de ML

### Modelos Utilizados
| Modelo | Inputs | Output | R² | Uso |
|--------|--------|--------|-----|-----|
| throttle_rpm_to_load | throttle, RPM | Engine Load | 0.974 | Carga do motor |
| throttle_rpm_to_map | throttle, RPM | MAP (kPa) | 0.992 | Pressão do coletor |
| rpm_to_speed | RPM + gear | Speed | 0.759 | Velocidade |
| rpm_throttle_to_maf | RPM, throttle | MAF | 0.001* | Modelo físico |

### Correlações Principais
\`\`\`
throttle ↔ MAP:          r = +0.996
throttle ↔ engine_load:  r = +0.977
engine_load ↔ MAP:       r = +0.975
RPM ↔ speed:             r = +0.935
IAT ↔ throttle:          r = +0.796
coolant_temp ↔ fuel_level: r = -0.669
\`\`\`

---

## 5. Cenários de Segurança Cibernética

### Ataques Simuláveis
| Ataque | Configuração | Detecção Esperada |
|--------|-------------|-------------------|
| **Spoofing de RPM** | RPM → MANUAL = 0, Speed → AUTO | RPM=0 com velocidade alta |
| **Replay Attack** | Todos MANUAL com valores fixos | Sem variação natural |
| **Fuzzing** | Valores extremos aleatórios | Fora dos ranges físicos |
| **DoS** | Muitos comandos OBD-II | Sobrecarga |
| **Injeção de DTC** | DTCs falsos | Inconsistentes com estado |
| **Temp Anômala** | Coolant = 150°C | Impossível em operação |

---

## 6. Pinagem Arduino CAN Gateway ↔ MCP2515
| Arduino Uno | Pino | MCP2515 | Função | Protocolo |
|-------------|------|---------|--------|-----------|
| D13 | 13 | SCK | Serial Clock | SPI |
| D12 | 12 | SO (MISO) | Master In Slave Out | SPI |
| D11 | 11 | SI (MOSI) | Master Out Slave In | SPI |
| D10 | 10 | CS | Chip Select | SPI |
| D2 | 2 | INT | Interrupção | GPIO |
| 5V | — | VCC | Alimentação | Power |
| GND | — | GND | Terra | Power |

### Firmware Arduino
- **Biblioteca:** \`mcp_can\` by Seeed Studio
- **Crystal:** 8 MHz (\`MCP_8MHZ\`)
- **CAN Speed padrão:** 500 kbps (\`CAN_500KBPS\`)
- **Serial:** 115200 baud
- **Protocolo:** CSV line-based (TX/RX/INFO/PROTO)
- **Funcionalidade:** Gateway CAN raw — relay de frames entre serial e barramento CAN

---

## 7. Estrutura de Arquivos
\`\`\`
/workspace/
├── app/frontend/
│   ├── public/arduino_ecu_simulator.ino  (CAN Gateway firmware)
│   ├── public/web_ecu_simulator_design.html
│   ├── src/
│   │   ├── components/ (Dashboard, SensorPanel, Terminal, DTCPanel, PlaybackPanel, SchematicPanel, ResearchPanel)
│   │   ├── lib/ (ecu-simulator, serial-connection, dbc-parser, theme-context)
│   │   └── pages/Index.tsx
├── data/ (sensor_correlation_model.json, can_bus_analysis_report.md, datasets/)
├── docs/ (system_architecture.md)
└── capitulo_simulador_ecu.tex
\`\`\`

---

© 2026 Marcelo Duchene — Todos os direitos reservados`;

export default function ResearchPanel() {
  const { theme } = useTheme();
  const [activeSection, setActiveSection] = useState<Section>('deep_research');

  const bgCard = t('bg-[#111827]', 'bg-white', theme);
  const border = t('border-[#1e293b]', 'border-gray-200', theme);
  const textMuted = t('text-slate-500', 'text-gray-500', theme);
  const textLabel = t('text-slate-400', 'text-gray-600', theme);
  const accentColor = t('text-emerald-400', 'text-emerald-600', theme);
  const activeBg = t('bg-[#1e293b]', 'bg-gray-100', theme);
  const hoverBg = t('hover:bg-[#1e293b]/50', 'hover:bg-gray-50', theme);

  const sections: { key: Section; label: string; icon: string; description: string }[] = [
    {
      key: 'deep_research',
      label: 'Deep Research Report',
      icon: '🔬',
      description: 'Pesquisa completa: conceito, protocolos, hardware, sensores e desafios',
    },
    {
      key: 'design',
      label: 'ECU Simulator Design',
      icon: '📐',
      description: 'Design e implementação: arquitetura, ML, OBD-II, segurança',
    },
    {
      key: 'analysis',
      label: 'CAN Bus Analysis',
      icon: '📊',
      description: 'Relatório de análise de dados CAN bus e correlação de sensores',
    },
    {
      key: 'architecture',
      label: 'System Architecture',
      icon: '🏗️',
      description: 'Arquitetura do sistema, mensagens CAN/OBD-II e integração ML',
    },
  ];

  const contentMap: Record<Section, string> = {
    deep_research: DEEP_RESEARCH,
    design: SIMULATOR_DESIGN,
    analysis: CAN_BUS_ANALYSIS,
    architecture: SYSTEM_ARCHITECTURE,
  };

  return (
    <div className="space-y-3">
      {/* Section Selector */}
      <div className={`${bgCard} border ${border} rounded-md p-3`}>
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[14px]">📚</span>
          <span className={`text-[12px] font-mono font-semibold ${textLabel} uppercase tracking-wider`}>
            Research <span className={accentColor}>Documents</span>
          </span>
          <span className={`text-[10px] ${textMuted} font-mono ml-auto`}>
            Documentação técnica, pesquisa e design
          </span>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          {sections.map((sec) => (
            <button
              key={sec.key}
              onClick={() => setActiveSection(sec.key)}
              className={`flex items-center gap-2 px-3 py-2 rounded border ${border} text-left transition-colors ${
                activeSection === sec.key
                  ? `${activeBg} ${accentColor}`
                  : `${hoverBg} ${textMuted}`
              }`}
            >
              <span className="text-[16px]">{sec.icon}</span>
              <div className="min-w-0">
                <div className={`text-[11px] font-mono font-semibold truncate ${activeSection === sec.key ? accentColor : textLabel}`}>
                  {sec.label}
                </div>
                <div className={`text-[9px] ${textMuted} truncate`}>{sec.description}</div>
              </div>
            </button>
          ))}
          {/* External Design Page Link */}
          <a
            href="/web_ecu_simulator_design.html"
            target="_blank"
            rel="noopener noreferrer"
            className={`flex items-center gap-2 px-3 py-2 rounded border ${border} text-left transition-colors ${hoverBg} ${textMuted}`}
          >
            <span className="text-[16px]">🌐</span>
            <div className="min-w-0">
              <div className={`text-[11px] font-mono font-semibold truncate ${textLabel}`}>
                Design Page (HTML)
              </div>
              <div className={`text-[9px] ${textMuted} truncate`}>Página visual do design do simulador</div>
            </div>
          </a>
        </div>
      </div>

      {/* Content Area */}
      <div className={`${bgCard} border ${border} rounded-md p-4 max-h-[calc(100vh-280px)] overflow-y-auto`}>
        <MarkdownRenderer content={contentMap[activeSection]} theme={theme} />
      </div>
    </div>
  );
}