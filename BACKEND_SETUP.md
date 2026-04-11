# Backend Setup Guide

This guide will help you get the ECU Simulator backend up and running.

## Quick Start (Local Development)

### Prerequisites

- Node.js 18.0.0 or higher
- npm (included with Node.js) or pnpm

### Setup

1. Install backend dependencies:

```bash
cd app/backend
npm install
```

2. Build the TypeScript code:

```bash
npm run build
```

3. Start the development server:

```bash
npm run dev
```

The server will start on `http://localhost:8000`.

### Verify the Installation

Open your browser and visit:

- **API Root**: http://localhost:8000
- **Health Check**: http://localhost:8000/api/health
- **WebSocket**: ws://localhost:8000/ws (from frontend)

You should see a JSON response with status and available endpoints.

## Docker Setup

### Build and Run with Docker

```bash
# Build the backend image
docker build -f Dockerfile.backend -t ecu-backend:latest .

# Run the backend container
docker run -p 8000:8000 -v $(pwd)/data:/app/data ecu-backend:latest
```

### Using Docker Compose

```bash
# Start both backend and frontend
docker-compose up

# Start in background
docker-compose up -d

# View logs
docker-compose logs -f backend

# Stop services
docker-compose down
```

## Project Structure

```
app/backend/
├── src/
│   ├── index.ts              # Main Express server
│   ├── db.ts                 # SQLite database setup & queries
│   ├── websocket.ts          # WebSocket connection manager
│   ├── routes/
│   │   ├── logs.ts          # Logging REST endpoints
│   │   └── config.ts        # Configuration REST endpoints
│   └── types.ts (if needed)  # TypeScript type definitions
├── dist/                     # Compiled JavaScript (created on build)
├── package.json              # Dependencies
├── tsconfig.json             # TypeScript configuration
├── .env.example              # Environment variables template
└── README.md                 # Backend documentation
```

## Database

The database is automatically initialized on server startup at `data/simulator.db`.

### Database Schema

**Sessions Table**
- `id` (TEXT, PK) - Unique session ID
- `createdAt` (INTEGER) - Creation timestamp
- `updatedAt` (INTEGER) - Last update timestamp
- `name` (TEXT) - Session name
- `mode` (TEXT) - 'virtual' or 'hardware'
- `hardwareAddress` (TEXT) - Optional hardware connection string

**Logs Table**
- `id` (TEXT, PK) - Unique log entry ID
- `sessionId` (TEXT, FK) - Associated session
- `timestamp` (INTEGER) - When command was sent
- `commandType` (TEXT) - 'OBD2', 'UDS', or 'CAN'
- `command` (TEXT) - The command sent
- `response` (TEXT) - The response received
- `responseTime` (INTEGER) - Response time in milliseconds
- `source` (TEXT) - 'browser' or 'hardware'

**Config Table**
- `id` (TEXT, PK) - Config ID
- `key` (TEXT, UNIQUE) - Configuration key
- `value` (TEXT) - Configuration value
- `description` (TEXT) - Configuration description

## API Endpoints Reference

### Health Check

```
GET /api/health
```

Response:
```json
{
  "status": "healthy",
  "timestamp": "2024-04-10T12:34:56.789Z",
  "uptime": 123.456,
  "websocket": {
    "browsers": 2,
    "hardware": 1
  }
}
```

### Sessions

**List all sessions:**
```
GET /api/sessions
```

**Create new session:**
```
POST /api/sessions
Content-Type: application/json

{
  "name": "Test Session",
  "mode": "virtual",
  "hardwareAddress": "192.168.1.100"
}
```

**Get specific session:**
```
GET /api/sessions/:sessionId
```

**Update session:**
```
PUT /api/sessions/:sessionId
Content-Type: application/json

{
  "name": "Updated Name",
  "mode": "hardware"
}
```

**Get session logs:**
```
GET /api/sessions/:sessionId/logs?limit=50&offset=0
```

**Export session logs:**
```
GET /api/sessions/:sessionId/export/json
GET /api/sessions/:sessionId/export/csv
```

**Delete session logs:**
```
DELETE /api/sessions/:sessionId/logs
```

### Logs

**List logs with filtering:**
```
GET /api/logs?sessionId=:sessionId&commandType=OBD2&limit=50&offset=0
```

**Get specific log:**
```
GET /api/logs/:logId
```

**Create log entry:**
```
POST /api/logs
Content-Type: application/json

{
  "sessionId": "session-uuid",
  "commandType": "OBD2",
  "command": "01 00",
  "response": "41 00 98 19 A8 13",
  "responseTime": 150,
  "source": "browser"
}
```

### Configuration

**Get all config:**
```
GET /api/config
```

**Get specific config:**
```
GET /api/config/:key
```

**Set config:**
```
PUT /api/config/:key
Content-Type: application/json

{
  "value": "new_value",
  "description": "Optional description"
}
```

**Delete config:**
```
DELETE /api/config/:key
```

## WebSocket Usage

### Connection

```javascript
const ws = new WebSocket('ws://localhost:8000/ws');

ws.onopen = () => {
  // Identify as browser
  ws.send(JSON.stringify({
    type: 'status',
    connectionType: 'browser',
    sessionId: 'session-uuid'
  }));
};

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  console.log('Received:', message);
};
```

### Send Command

```javascript
ws.send(JSON.stringify({
  type: 'command',
  commandId: 'unique-id',
  sessionId: 'session-uuid',
  commandType: 'OBD2',
  command: '01 00'
}));
```

### Receive Response

```javascript
// After sending command, listen for response with same commandId
{
  "type": "response",
  "commandId": "unique-id",
  "response": "41 00 98 19 A8 13",
  "responseTime": 150,
  "timestamp": 1712768096789
}
```

## Environment Variables

Create an `.env` file in `app/backend/`:

```env
PORT=8000
HOST=0.0.0.0
NODE_ENV=development
CORS_ORIGIN=http://localhost:3000
WS_HEARTBEAT_INTERVAL=30000
WS_MAX_CONNECTIONS=10
```

## Development Commands

```bash
cd app/backend

# Install dependencies
npm install

# Watch mode (auto-reload on changes)
npm run dev

# Build for production
npm run build

# Start production server
npm start

# Lint code
npm run lint
```

## Troubleshooting

### Port Already in Use

If port 8000 is already in use:

```bash
# Find what's using port 8000
lsof -i :8000

# Use a different port
PORT=3001 npm run dev
```

### Database Locked

If you see "database is locked" errors:

1. Stop all running processes
2. Delete `data/simulator.db-wal` and `data/simulator.db-shm`
3. Restart the server

### WebSocket Connection Issues

- Ensure CORS is configured correctly
- Check that the frontend URL matches `CORS_ORIGIN`
- Verify the WebSocket path is `/ws`

## Performance Tips

1. **Connection Pooling**: The server supports multiple concurrent connections
2. **Database Indexes**: Logs are indexed on sessionId, timestamp, and commandType
3. **WAL Mode**: SQLite WAL mode is enabled for better concurrency
4. **Pagination**: Always use pagination for log queries to avoid loading too much data

## Production Deployment

1. Build the Docker image:
   ```bash
   docker build -f Dockerfile.backend -t ecu-backend:latest .
   ```

2. Push to container registry
3. Deploy with docker-compose or Kubernetes
4. Set `NODE_ENV=production`
5. Configure proper CORS_ORIGIN for your frontend domain
6. Use environment variables for sensitive configuration

## Support

For issues or questions, refer to:
- `app/backend/README.md` - Backend API documentation
- `docker-compose.yml` - Docker configuration
- `Dockerfile.backend` - Container setup
