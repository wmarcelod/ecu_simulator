# ECU Simulator Backend

A Node.js backend server for the ECU Simulator providing WebSocket communication and REST API for automotive cybersecurity research.

## Features

- **WebSocket Server** for real-time communication between frontend and hardware gateways
- **REST API** for log management, session tracking, and configuration
- **SQLite Database** with better-sqlite3 for persistent storage
- **Virtual Mode** for in-browser command simulation
- **Hardware Mode** for real CAN bus communication via Arduino/RPi
- **Logging System** with command tracking, responses, and export capabilities

## Getting Started

### Prerequisites

- Node.js 18+
- npm or pnpm

### Installation

```bash
npm install
# or
pnpm install
```

### Development

```bash
npm run dev
```

The server will start on `http://localhost:8000` by default.

### Production Build

```bash
npm run build
npm start
```

## Environment Variables

```
PORT=8000              # Server port (default: 8000)
HOST=0.0.0.0          # Server host (default: 0.0.0.0)
NODE_ENV=production   # Environment mode
```

## API Endpoints

### Health Check

```
GET /api/health
```

Returns server health and WebSocket connection count.

### Logs

```
GET /api/logs?sessionId=:id&commandType=OBD2&limit=50&offset=0
GET /api/logs/:id
POST /api/logs
```

Retrieve, list, and create command logs.

### Sessions

```
GET /api/sessions
POST /api/sessions
GET /api/sessions/:id
PUT /api/sessions/:id
GET /api/sessions/:sessionId/logs
DELETE /api/sessions/:sessionId/logs
GET /api/sessions/:sessionId/export/json
GET /api/sessions/:sessionId/export/csv
```

Manage simulation sessions and export logs.

### Configuration

```
GET /api/config
GET /api/config/:key
PUT /api/config
PUT /api/config/:key
DELETE /api/config/:key
```

Manage server configuration.

## WebSocket Protocol

### Connection

Connect to `ws://localhost:8000/ws`

### Message Types

#### Identify Connection

```json
{
  "type": "status",
  "connectionType": "browser" | "hardware"
}
```

#### Send Command

```json
{
  "type": "command",
  "commandId": "uuid",
  "sessionId": "session-uuid",
  "commandType": "OBD2" | "UDS" | "CAN",
  "command": "hex-encoded-command"
}
```

#### Receive Response

```json
{
  "type": "response",
  "commandId": "uuid",
  "response": "hex-encoded-response",
  "responseTime": 150,
  "timestamp": 1234567890000
}
```

#### Heartbeat

```json
{
  "type": "heartbeat"
}
```

## Database

The database is stored at `data/simulator.db` and includes tables for:

- **sessions** - Simulation sessions
- **logs** - Command/response logs
- **config** - Server configuration

## File Structure

```
app/backend/
├── src/
│   ├── index.ts           # Main server entry point
│   ├── db.ts              # Database setup and queries
│   ├── websocket.ts       # WebSocket manager
│   ├── routes/
│   │   ├── logs.ts        # Log endpoints
│   │   └── config.ts      # Config endpoints
├── dist/                  # Compiled JavaScript (build output)
├── package.json
├── tsconfig.json
└── README.md
```

## Architecture

### WebSocket Flow

1. Browser connects and identifies as "browser"
2. Hardware gateway connects and identifies as "hardware"
3. Browser sends OBD2/UDS/CAN command via WebSocket
4. If virtual mode: command is simulated and response sent back
5. If hardware mode: command is routed to hardware gateway
6. Hardware processes and sends response
7. Response is logged and sent back to browser

### Command Logging

All commands and responses are logged to the database with:
- Session ID for grouping
- Timestamp for ordering
- Response time for performance analysis
- Source (browser or hardware) for tracking

## Development Notes

- Uses TypeScript for type safety
- ES modules throughout
- SQLite database with WAL mode for performance
- CORS enabled for cross-origin requests
- Graceful shutdown handling

## Docker

See docker-compose.yml in the repository root for containerization.

## License

Part of the ECU Simulator project for automotive cybersecurity research.
