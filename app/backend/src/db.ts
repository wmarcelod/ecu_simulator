import Database from 'better-sqlite3';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = import.meta.url ? join(fileURLToPath(import.meta.url), '..') : process.cwd();
const dbPath = join(__dirname, '../../data/simulator.db');

let db: Database.Database;

export interface LogEntry {
  id: string;
  sessionId: string;
  timestamp: number;
  commandType: 'OBD2' | 'UDS' | 'CAN';
  command: string;
  response: string;
  responseTime: number;
  source: 'browser' | 'hardware';
}

export interface Session {
  id: string;
  createdAt: number;
  updatedAt: number;
  name: string;
  mode: 'virtual' | 'hardware';
  hardwareAddress?: string;
}

export interface SimulatorConfig {
  id: string;
  key: string;
  value: string;
  description?: string;
}

export function initializeDatabase() {
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  // Sessions table
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      name TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'virtual',
      hardwareAddress TEXT
    );
  `);

  // Logs table
  db.exec(`
    CREATE TABLE IF NOT EXISTS logs (
      id TEXT PRIMARY KEY,
      sessionId TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      commandType TEXT NOT NULL,
      command TEXT NOT NULL,
      response TEXT,
      responseTime INTEGER,
      source TEXT NOT NULL,
      FOREIGN KEY (sessionId) REFERENCES sessions(id) ON DELETE CASCADE
    );
  `);

  // Create indexes for better query performance
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_logs_sessionId ON logs(sessionId);
    CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp);
    CREATE INDEX IF NOT EXISTS idx_logs_commandType ON logs(commandType);
  `);

  // Configuration table
  db.exec(`
    CREATE TABLE IF NOT EXISTS config (
      id TEXT PRIMARY KEY,
      key TEXT UNIQUE NOT NULL,
      value TEXT NOT NULL,
      description TEXT
    );
  `);

  // Initialize default config values
  const defaultConfig = [
    { key: 'simulator_mode', value: 'virtual', description: 'Virtual or hardware mode' },
    { key: 'log_retention_days', value: '30', description: 'Days to retain logs' },
    { key: 'max_connections', value: '10', description: 'Max concurrent WebSocket connections' },
  ];

  for (const config of defaultConfig) {
    try {
      db.prepare('INSERT INTO config (id, key, value, description) VALUES (?, ?, ?, ?)').run(
        `config_${config.key}`,
        config.key,
        config.value,
        config.description
      );
    } catch {
      // Config already exists, skip
    }
  }

  return db;
}

export function getDatabase() {
  if (!db) {
    return initializeDatabase();
  }
  return db;
}

// Session queries
export function createSession(id: string, name: string, mode: 'virtual' | 'hardware' = 'virtual', hardwareAddress?: string): Session {
  const now = Date.now();
  const stmt = db.prepare(`
    INSERT INTO sessions (id, createdAt, updatedAt, name, mode, hardwareAddress)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  stmt.run(id, now, now, name, mode, hardwareAddress || null);
  return { id, createdAt: now, updatedAt: now, name, mode, hardwareAddress };
}

export function getSession(id: string): Session | undefined {
  const stmt = db.prepare('SELECT * FROM sessions WHERE id = ?');
  return stmt.get(id) as Session | undefined;
}

export function getAllSessions(): Session[] {
  const stmt = db.prepare('SELECT * FROM sessions ORDER BY updatedAt DESC');
  return stmt.all() as Session[];
}

export function updateSession(id: string, updates: Partial<Session>): Session | undefined {
  const now = Date.now();
  const current = getSession(id);
  if (!current) return undefined;

  const updated = { ...current, ...updates, updatedAt: now };
  const stmt = db.prepare(`
    UPDATE sessions
    SET name = ?, mode = ?, hardwareAddress = ?, updatedAt = ?
    WHERE id = ?
  `);
  stmt.run(updated.name, updated.mode, updated.hardwareAddress || null, updated.updatedAt, id);
  return updated;
}

// Log queries
export async function createLog(entry: Omit<LogEntry, 'id'>): Promise<LogEntry> {
  const { v4: uuidv4 } = await import('uuid');
  const id = uuidv4();
  const stmt = db.prepare(`
    INSERT INTO logs (id, sessionId, timestamp, commandType, command, response, responseTime, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(id, entry.sessionId, entry.timestamp, entry.commandType, entry.command, entry.response, entry.responseTime, entry.source);
  return { ...entry, id };
}

export async function createLogAsync(entry: Omit<LogEntry, 'id'>): Promise<LogEntry> {
  const { v4: uuidv4 } = await import('uuid');
  const id = uuidv4();
  const stmt = db.prepare(`
    INSERT INTO logs (id, sessionId, timestamp, commandType, command, response, responseTime, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(id, entry.sessionId, entry.timestamp, entry.commandType, entry.command, entry.response, entry.responseTime, entry.source);
  return { ...entry, id };
}

export function getLog(id: string): LogEntry | undefined {
  const stmt = db.prepare('SELECT * FROM logs WHERE id = ?');
  return stmt.get(id) as LogEntry | undefined;
}

export interface LogsQuery {
  sessionId?: string;
  commandType?: 'OBD2' | 'UDS' | 'CAN';
  limit?: number;
  offset?: number;
}

export function getLogs(query: LogsQuery): { logs: LogEntry[]; total: number } {
  let sql = 'SELECT * FROM logs WHERE 1=1';
  const params: unknown[] = [];

  if (query.sessionId) {
    sql += ' AND sessionId = ?';
    params.push(query.sessionId);
  }

  if (query.commandType) {
    sql += ' AND commandType = ?';
    params.push(query.commandType);
  }

  // Get total count
  const countSql = sql.replace('SELECT *', 'SELECT COUNT(*) as count');
  const countStmt = db.prepare(countSql);
  const { count } = countStmt.get(...params) as { count: number };

  // Get paginated results
  sql += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
  params.push(query.limit || 50);
  params.push(query.offset || 0);

  const stmt = db.prepare(sql);
  const logs = stmt.all(...params) as LogEntry[];

  return { logs, total: count };
}

export function getSessionLogs(sessionId: string, limit: number = 100, offset: number = 0): LogEntry[] {
  const stmt = db.prepare(`
    SELECT * FROM logs
    WHERE sessionId = ?
    ORDER BY timestamp DESC
    LIMIT ? OFFSET ?
  `);
  return stmt.all(sessionId, limit, offset) as LogEntry[];
}

export function deleteSessionLogs(sessionId: string): number {
  const stmt = db.prepare('DELETE FROM logs WHERE sessionId = ?');
  const result = stmt.run(sessionId);
  return result.changes;
}

// Configuration queries
export function getConfig(key: string): string | undefined {
  const stmt = db.prepare('SELECT value FROM config WHERE key = ?');
  const result = stmt.get(key) as { value: string } | undefined;
  return result?.value;
}

export function getAllConfig(): Record<string, string> {
  const stmt = db.prepare('SELECT key, value FROM config');
  const rows = stmt.all() as { key: string; value: string }[];
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

export async function setConfig(key: string, value: string, description?: string): Promise<void> {
  const stmt = db.prepare(`
    INSERT INTO config (id, key, value, description)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = ?, description = ?
  `);
  stmt.run(`config_${key}`, key, value, description, value, description);
}

export async function setConfigAsync(key: string, value: string, description?: string): Promise<void> {
  const stmt = db.prepare(`
    INSERT INTO config (id, key, value, description)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = ?, description = ?
  `);
  stmt.run(`config_${key}`, key, value, description, value, description);
}

export function deleteConfig(key: string): number {
  const stmt = db.prepare('DELETE FROM config WHERE key = ?');
  const result = stmt.run(key);
  return result.changes;
}

// Bulk operations
export function clearOldLogs(daysOld: number): number {
  const cutoffTime = Date.now() - daysOld * 24 * 60 * 60 * 1000;
  const stmt = db.prepare('DELETE FROM logs WHERE timestamp < ?');
  const result = stmt.run(cutoffTime);
  return result.changes;
}

export function exportSessionLogsAsJSON(sessionId: string): string {
  const session = getSession(sessionId);
  const logs = getSessionLogs(sessionId, 10000);

  return JSON.stringify({
    session,
    logs,
    exportedAt: new Date().toISOString(),
  }, null, 2);
}

export function exportSessionLogsAsCSV(sessionId: string): string {
  const logs = getSessionLogs(sessionId, 10000);

  if (logs.length === 0) {
    return 'id,sessionId,timestamp,commandType,command,response,responseTime,source\n';
  }

  const headers = Object.keys(logs[0]).join(',');
  const rows = logs.map(log =>
    Object.values(log)
      .map(v => {
        if (typeof v === 'string' && (v.includes(',') || v.includes('"') || v.includes('\n'))) {
          return `"${v.replace(/"/g, '""')}"`;
        }
        return v;
      })
      .join(',')
  );

  return [headers, ...rows].join('\n');
}
