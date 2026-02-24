# Web-Based ECU Simulator - Development Plan

## Design Guidelines

### Design References
- **Automotive Dashboard Style**: Dark theme inspired by car instrument clusters
- **Tesla Dashboard**: Clean, modern, dark interface with real-time data
- **OBD-II Diagnostic Tools**: Professional technical interface

### Color Palette
- Background: #0a0f1a (Deep Navy Black)
- Surface: #111827 (Dark Gray-Blue)
- Card: #1e293b (Slate)
- Border: #334155 (Slate Border)
- Primary Accent: #22d3ee (Cyan - gauges/active)
- Secondary Accent: #10b981 (Emerald Green - connected/ok)
- Warning: #f59e0b (Amber - warnings)
- Error: #ef4444 (Red - errors/MIL)
- Text Primary: #f1f5f9 (Light)
- Text Secondary: #94a3b8 (Muted)

### Typography
- Headings: Inter font-weight 700
- Body: Inter font-weight 400
- Monospace (terminal): JetBrains Mono / monospace

### Key Component Styles
- Gauges: Circular SVG with gradient arcs (cyan to green)
- Cards: Dark slate with subtle border, rounded-xl
- Terminal: Black background with green/cyan monospace text
- Buttons: Cyan accent, hover brighten
- Status indicators: Colored dots (green=connected, red=error, yellow=warning)

### Images to Generate
1. **hero-ecu-dashboard.jpg** - Dark automotive dashboard with glowing gauges and digital displays, futuristic style (photorealistic, dark mood)
2. **car-engine-bay.jpg** - Close-up of a modern car engine bay with ECU visible, dark dramatic lighting (photorealistic)
3. **obd2-connector.jpg** - OBD-II diagnostic port connector with blue LED glow, technical style (photorealistic, dark mood)
4. **circuit-board-pattern.jpg** - Abstract circuit board pattern with glowing traces, dark background (minimalist, dark)

---

## Development Tasks

### Files to Create (8 files max):

1. **src/lib/ecu-simulator.ts** - Core ECU simulation engine
   - ELM327 AT command handler
   - OBD-II PID response generator (Mode 01, 02, 03, 04, 07, 09, 0A)
   - Vehicle profiles (Sedan, SUV, Sport)
   - Dynamic data generation with noise, interdependencies
   - DTC management (stored, pending, permanent)
   - Conversion formulas for all PIDs

2. **src/lib/serial-connection.ts** - Web Serial API integration
   - Browser support check
   - Port request/open/close
   - Read/write streams with TextDecoder/Encoder
   - Connection status management
   - Event handlers for connect/disconnect

3. **src/pages/Index.tsx** - Main Dashboard page
   - Layout with sidebar navigation tabs
   - All panels integrated via tabs: Dashboard, Terminal, Sensors, Playback, DTCs

4. **src/components/Dashboard.tsx** - Main dashboard with gauges
   - Vehicle model selector dropdown
   - Start/Stop simulation controls
   - Serial connection status + connect button
   - Animated gauge components for RPM, Speed, Temp, Load, Throttle, MAP, MAF
   - Real-time value displays

5. **src/components/Terminal.tsx** - ELM327 command terminal
   - Command input field
   - Log area with sent/received formatting
   - Quick command buttons (ATZ, ATE0, 010C, 010D, 0105, 03, 04)
   - Auto-scroll history

6. **src/components/SensorPanel.tsx** - Dynamic sensor simulation panel
   - Sensor list with sliders for manual adjustment
   - Real-time line charts (using recharts)
   - Scenario buttons: Idle, Acceleration, Cruise, Deceleration
   - Noise/latency config per sensor

7. **src/components/PlaybackPanel.tsx** - Historical data playback
   - CSV file upload
   - Play/Pause/Stop controls
   - Speed selector (0.5x, 1x, 2x, 4x)
   - Progress bar/timeline
   - Data sync with dashboard gauges

8. **src/components/DTCPanel.tsx** - DTC management
   - Lists: Stored, Pending, Permanent DTCs
   - Add/Remove DTC buttons
   - Clear DTCs (Mode 04) button
   - MIL indicator (on/off)
   - Pre-configured DTCs per vehicle profile