# Quick Start - ECU Simulator Backend

Get the backend running in 2 minutes.

## Option 1: Docker (Recommended)

```bash
# From project root
docker-compose up

# Backend: http://localhost:8000
# Frontend: http://localhost:3000
```

Done! Both services start automatically.

## Option 2: Manual (Development)

```bash
# Install dependencies
cd app/backend
npm install

# Start development server
npm run dev

# Server runs on http://localhost:8000
```

## Option 3: Production Build

```bash
cd app/backend
npm install
npm run build
npm start
```

## Verify It Works

Open in browser:
- **API Root**: http://localhost:8000
- **Health Check**: http://localhost:8000/api/health
- **WebSocket Test**: Open `app/backend/examples/browser-client.html`

## Key URLs

| Purpose | URL |
|---------|-----|
| API Base | http://localhost:8000/api |
| Health Check | http://localhost:8000/api/health |
| List Sessions | http://localhost:8000/api/sessions |
| WebSocket | ws://localhost:8000/ws |
| Browser Client | `app/backend/examples/browser-client.html` |

## Common Commands

```bash
cd app/backend

# Development with auto-reload
npm run dev

# Production build
npm run build

# Start production server
npm start

# Install dependencies
npm install

# Lint code
npm run lint
```

## Environment Variables

Create `.env` file in `app/backend/`:

```env
PORT=8000
HOST=0.0.0.0
NODE_ENV=development
CORS_ORIGIN=http://localhost:3000
```

See `.env.example` for all options.

## Database

- **Location**: `data/simulator.db`
- **Type**: SQLite with WAL mode
- **Tables**: sessions, logs, config
- **Auto-initialized**: On server startup

## Testing

### Using Browser Client

1. Open `app/backend/examples/browser-client.html`
2. Click "Connect"
3. Enter command (e.g., `01 00` for OBD2)
4. Click "Send Command"
5. See response in message log

### Using curl

```bash
# Health check
curl http://localhost:8000/api/health

# Create session
curl -X POST http://localhost:8000/api/sessions \
  -H "Content-Type: application/json" \
  -d '{"name":"Test","mode":"virtual"}'

# List sessions
curl http://localhost:8000/api/sessions

# Get logs
curl 'http://localhost:8000/api/logs?limit=10'
```

## Troubleshooting

### Port 8000 in use
```bash
PORT=3001 npm run dev
```

### Database locked
```bash
rm data/simulator.db-wal data/simulator.db-shm
```

### Dependencies not installed
```bash
npm install --force
```

### Module not found errors
```bash
rm -rf node_modules package-lock.json
npm install
```

## File Structure

```
app/backend/
├── src/
│   ├── index.ts           ← Main server
│   ├── db.ts              ← Database
│   ├── websocket.ts       ← WebSocket handler
│   └── routes/
│       ├── logs.ts        ← Log endpoints
│       └── config.ts      ← Config endpoints
├── dist/                  ← Build output (after npm run build)
├── package.json
├── tsconfig.json
└── examples/
    ├── browser-client.html
    └── hardware-gateway.js
```

## Features

- ✓ WebSocket for real-time communication
- ✓ REST API for logs and configuration
- ✓ SQLite database with session tracking
- ✓ Virtual command simulation (OBD2, UDS, CAN)
- ✓ Hardware gateway support
- ✓ Log export (JSON/CSV)
- ✓ TypeScript throughout
- ✓ Docker ready

## Next Steps

1. **Frontend**: Update React app to connect to backend APIs
2. **Hardware**: Run `app/backend/examples/hardware-gateway.js` to connect real hardware
3. **Testing**: Use browser client example to test WebSocket
4. **Documentation**: See `BACKEND_SETUP.md` for detailed guides

## API Quick Reference

```
GET /api/health              - Server status
GET /api/sessions            - List sessions
POST /api/sessions           - Create session
GET /api/sessions/:id        - Get session
PUT /api/sessions/:id        - Update session
GET /api/logs                - List logs
POST /api/logs               - Create log
GET /api/logs/:id            - Get log
GET /api/sessions/:id/logs   - Session logs
GET /api/config              - List config
PUT /api/config/:key         - Set config
```

## WebSocket Example

```javascript
const ws = new WebSocket('ws://localhost:8000/ws');

ws.onopen = () => {
  ws.send(JSON.stringify({
    type: 'status',
    connectionType: 'browser',
    sessionId: 'my-session-id'
  }));
};

ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  console.log('Response:', msg);
};

// Send command
ws.send(JSON.stringify({
  type: 'command',
  commandId: 'cmd-1',
  sessionId: 'my-session-id',
  commandType: 'OBD2',
  command: '01 00'
}));
```

## Help

- **Setup Guide**: Read `BACKEND_SETUP.md`
- **Full Docs**: See `app/backend/README.md`
- **Examples**: Check `app/backend/examples/`
- **Full Implementation**: See `BACKEND_COMPLETE.md`

---

**Ready?** Run `docker-compose up` and open http://localhost:3000
