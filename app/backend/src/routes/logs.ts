import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import {
  createSession,
  getSession,
  getAllSessions,
  updateSession,
  createLog,
  getLog,
  getLogs,
  getSessionLogs,
  deleteSessionLogs,
  exportSessionLogsAsJSON,
  exportSessionLogsAsCSV,
  clearOldLogs,
  createLogAsync,
} from '../db.js';

const router = Router();

// Get all sessions
router.get('/sessions', (req: Request, res: Response) => {
  try {
    const sessions = getAllSessions();
    res.json({
      success: true,
      data: sessions,
      count: sessions.length,
    });
  } catch (error) {
    console.error('Error fetching sessions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch sessions',
    });
  }
});

// Create new session
router.post('/sessions', (req: Request, res: Response) => {
  try {
    const { name, mode = 'virtual', hardwareAddress } = req.body;

    if (!name) {
      res.status(400).json({
        success: false,
        error: 'Session name is required',
      });
      return;
    }

    const sessionId = uuidv4();
    const session = createSession(sessionId, name, mode, hardwareAddress);

    res.status(201).json({
      success: true,
      data: session,
    });
  } catch (error) {
    console.error('Error creating session:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create session',
    });
  }
});

// Get specific session
router.get('/sessions/:id', (req: Request, res: Response) => {
  try {
    const session = getSession(req.params.id);

    if (!session) {
      res.status(404).json({
        success: false,
        error: 'Session not found',
      });
      return;
    }

    res.json({
      success: true,
      data: session,
    });
  } catch (error) {
    console.error('Error fetching session:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch session',
    });
  }
});

// Update session
router.put('/sessions/:id', (req: Request, res: Response) => {
  try {
    const { name, mode, hardwareAddress } = req.body;
    const updates: any = {};

    if (name !== undefined) updates.name = name;
    if (mode !== undefined) updates.mode = mode;
    if (hardwareAddress !== undefined) updates.hardwareAddress = hardwareAddress;

    const updated = updateSession(req.params.id, updates);

    if (!updated) {
      res.status(404).json({
        success: false,
        error: 'Session not found',
      });
      return;
    }

    res.json({
      success: true,
      data: updated,
    });
  } catch (error) {
    console.error('Error updating session:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update session',
    });
  }
});

// Get logs with optional filtering and pagination
router.get('/logs', (req: Request, res: Response) => {
  try {
    const sessionId = req.query.sessionId as string | undefined;
    const commandType = req.query.commandType as 'OBD2' | 'UDS' | 'CAN' | undefined;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 500);
    const offset = parseInt(req.query.offset as string) || 0;

    const result = getLogs({
      sessionId,
      commandType,
      limit,
      offset,
    });

    res.json({
      success: true,
      data: result.logs,
      pagination: {
        limit,
        offset,
        total: result.total,
        hasMore: offset + limit < result.total,
      },
    });
  } catch (error) {
    console.error('Error fetching logs:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch logs',
    });
  }
});

// Get specific log
router.get('/logs/:id', (req: Request, res: Response) => {
  try {
    const log = getLog(req.params.id);

    if (!log) {
      res.status(404).json({
        success: false,
        error: 'Log not found',
      });
      return;
    }

    res.json({
      success: true,
      data: log,
    });
  } catch (error) {
    console.error('Error fetching log:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch log',
    });
  }
});

// Create new log entry
router.post('/logs', async (req: Request, res: Response) => {
  try {
    const {
      sessionId,
      commandType,
      command,
      response,
      responseTime,
      source,
    } = req.body;

    if (!sessionId || !commandType || !command) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: sessionId, commandType, command',
      });
      return;
    }

    const log = await createLogAsync({
      sessionId,
      timestamp: Date.now(),
      commandType,
      command,
      response: response || '',
      responseTime: responseTime || 0,
      source: source || 'browser',
    });

    res.status(201).json({
      success: true,
      data: log,
    });
  } catch (error) {
    console.error('Error creating log:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create log',
    });
  }
});

// Get logs for a specific session
router.get('/sessions/:sessionId/logs', (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
    const offset = parseInt(req.query.offset as string) || 0;

    const logs = getSessionLogs(req.params.sessionId, limit, offset);
    const total = logs.length;

    res.json({
      success: true,
      data: logs,
      pagination: {
        limit,
        offset,
        total,
        hasMore: offset + limit < total,
      },
    });
  } catch (error) {
    console.error('Error fetching session logs:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch session logs',
    });
  }
});

// Export session logs as JSON
router.get('/sessions/:sessionId/export/json', (req: Request, res: Response) => {
  try {
    const json = exportSessionLogsAsJSON(req.params.sessionId);

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="session-${req.params.sessionId}.json"`);
    res.send(json);
  } catch (error) {
    console.error('Error exporting logs:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to export logs',
    });
  }
});

// Export session logs as CSV
router.get('/sessions/:sessionId/export/csv', (req: Request, res: Response) => {
  try {
    const csv = exportSessionLogsAsCSV(req.params.sessionId);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="session-${req.params.sessionId}.csv"`);
    res.send(csv);
  } catch (error) {
    console.error('Error exporting logs:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to export logs',
    });
  }
});

// Delete session logs
router.delete('/sessions/:sessionId/logs', (req: Request, res: Response) => {
  try {
    const changes = deleteSessionLogs(req.params.sessionId);

    res.json({
      success: true,
      message: `Deleted ${changes} log entries`,
      deleted: changes,
    });
  } catch (error) {
    console.error('Error deleting logs:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete logs',
    });
  }
});

// Clear old logs
router.post('/logs/cleanup', (req: Request, res: Response) => {
  try {
    const { daysOld = 30 } = req.body;
    const deleted = clearOldLogs(daysOld);

    res.json({
      success: true,
      message: `Deleted ${deleted} log entries older than ${daysOld} days`,
      deleted,
    });
  } catch (error) {
    console.error('Error cleaning up logs:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to clean up logs',
    });
  }
});

export default router;
