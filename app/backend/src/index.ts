import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { initializeDatabase } from './db.js';
import { WebSocketManager } from './websocket.js';
import logsRouter from './routes/logs.js';
import configRouter from './routes/config.js';

const PORT = process.env.PORT || 8000;
const HOST = process.env.HOST || '0.0.0.0';

const app = express();
const httpServer = createServer(app);

// Initialize database
console.log('Initializing database...');
initializeDatabase();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize WebSocket manager
console.log('Initializing WebSocket manager...');
const wsManager = new WebSocketManager(httpServer);

// Request logging middleware
app.use((req: Request, res: Response, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

// Health check endpoint
app.get('/api/health', (req: Request, res: Response) => {
  const clients = wsManager.getConnectedClients();
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    websocket: {
      browsers: clients.browsers,
      hardware: clients.hardware,
    },
  });
});

// API routes
app.use('/api', logsRouter);
app.use('/api', configRouter);

// Root endpoint
app.get('/', (req: Request, res: Response) => {
  res.json({
    name: 'ECU Simulator Backend',
    version: '1.0.0',
    status: 'running',
    timestamp: new Date().toISOString(),
    endpoints: {
      health: 'GET /api/health',
      logs: {
        list: 'GET /api/logs',
        create: 'POST /api/logs',
        get: 'GET /api/logs/:id',
      },
      sessions: {
        list: 'GET /api/sessions',
        create: 'POST /api/sessions',
        get: 'GET /api/sessions/:id',
        update: 'PUT /api/sessions/:id',
        logs: 'GET /api/sessions/:sessionId/logs',
        exportJSON: 'GET /api/sessions/:sessionId/export/json',
        exportCSV: 'GET /api/sessions/:sessionId/export/csv',
        deleteLogs: 'DELETE /api/sessions/:sessionId/logs',
      },
      config: {
        list: 'GET /api/config',
        get: 'GET /api/config/:key',
        set: 'PUT /api/config/:key',
        delete: 'DELETE /api/config/:key',
      },
      websocket: 'ws://localhost:8000/ws',
    },
  });
});

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: 'Not Found',
    path: req.path,
  });
});

// Error handler
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('Server error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

// Start server
httpServer.listen(Number(PORT), HOST as string, () => {
  console.log(`ECU Simulator Backend listening on ${HOST}:${PORT}`);
  console.log(`WebSocket: ws://${HOST}:${PORT}/ws`);
  console.log(`API Docs: http://${HOST}:${PORT}/`);
  console.log('Environment:', process.env.NODE_ENV || 'development');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  httpServer.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully...');
  httpServer.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
