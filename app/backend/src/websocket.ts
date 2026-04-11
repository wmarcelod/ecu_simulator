import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import { createLogAsync, getSession } from './db.js';
import { v4 as uuidv4 } from 'uuid';

export interface WebSocketMessage {
  type: 'command' | 'response' | 'error' | 'status' | 'heartbeat';
  commandId?: string;
  sessionId?: string;
  commandType?: 'OBD2' | 'UDS' | 'CAN';
  command?: string;
  response?: string;
  responseTime?: number;
  timestamp?: number;
  source?: 'browser' | 'hardware';
  error?: string;
  connectionType?: 'browser' | 'hardware';
}

interface ActiveConnection {
  ws: WebSocket;
  type: 'browser' | 'hardware';
  sessionId?: string;
  hardwareId?: string;
}

export class WebSocketManager {
  private wss: WebSocketServer;
  private connections: Map<WebSocket, ActiveConnection> = new Map();
  private pendingCommands: Map<string, { sessionId: string; timestamp: number }> = new Map();
  private hardwareGateways: Map<string, WebSocket> = new Map(); // hardwareId -> WebSocket

  constructor(httpServer: Server) {
    this.wss = new WebSocketServer({ server: httpServer, path: '/ws' });
    this.setupConnectionHandler();
  }

  private setupConnectionHandler() {
    this.wss.on('connection', (ws: WebSocket) => {
      console.log('New WebSocket connection');

      // Send initial message requesting connection type
      ws.send(JSON.stringify({
        type: 'status',
        message: 'Connected to WebSocket server. Please identify as browser or hardware.',
      }));

      ws.on('message', async (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString()) as WebSocketMessage;
          await this.handleMessage(ws, message);
        } catch (error) {
          console.error('WebSocket message error:', error);
          ws.send(JSON.stringify({
            type: 'error',
            error: 'Invalid message format',
          }));
        }
      });

      ws.on('close', () => {
        const connection = this.connections.get(ws);
        if (connection) {
          console.log(`Connection closed: ${connection.type}`, connection.sessionId);
          this.connections.delete(ws);
          if (connection.hardwareId) {
            this.hardwareGateways.delete(connection.hardwareId);
          }
        }
      });

      ws.on('error', (error: Error) => {
        console.error('WebSocket error:', error);
      });
    });
  }

  private async handleMessage(ws: WebSocket, message: WebSocketMessage) {
    const connection = this.connections.get(ws);

    // First message should identify connection type
    if (!connection && message.type !== 'status') {
      if (!message.connectionType) {
        ws.send(JSON.stringify({
          type: 'error',
          error: 'Must identify connection type first',
        }));
        return;
      }

      const newConnection: ActiveConnection = {
        ws,
        type: message.connectionType,
        sessionId: message.sessionId,
        hardwareId: message.connectionType === 'hardware' ? uuidv4() : undefined,
      };

      this.connections.set(ws, newConnection);

      if (message.connectionType === 'hardware' && newConnection.hardwareId) {
        this.hardwareGateways.set(newConnection.hardwareId, ws);
      }

      ws.send(JSON.stringify({
        type: 'status',
        message: `Identified as ${message.connectionType}`,
        connectionType: message.connectionType,
        hardwareId: newConnection.hardwareId,
      }));

      console.log(`Connection identified: ${message.connectionType}`, newConnection.hardwareId);
      return;
    }

    if (!connection) {
      ws.send(JSON.stringify({
        type: 'error',
        error: 'Connection not identified',
      }));
      return;
    }

    switch (message.type) {
      case 'command':
        await this.handleCommand(ws, connection, message);
        break;
      case 'response':
        await this.handleResponse(ws, connection, message);
        break;
      case 'heartbeat':
        ws.send(JSON.stringify({
          type: 'heartbeat',
          timestamp: Date.now(),
        }));
        break;
      default:
        console.log('Unknown message type:', message.type);
    }
  }

  private async handleCommand(ws: WebSocket, connection: ActiveConnection, message: WebSocketMessage) {
    if (!message.sessionId || !message.commandId || !message.command || !message.commandType) {
      ws.send(JSON.stringify({
        type: 'error',
        commandId: message.commandId,
        error: 'Missing required fields: sessionId, commandId, command, commandType',
      }));
      return;
    }

    const session = getSession(message.sessionId);
    if (!session) {
      ws.send(JSON.stringify({
        type: 'error',
        commandId: message.commandId,
        error: `Session not found: ${message.sessionId}`,
      }));
      return;
    }

    // Store command metadata
    this.pendingCommands.set(message.commandId, {
      sessionId: message.sessionId,
      timestamp: Date.now(),
    });

    if (connection.type === 'browser') {
      // Browser sending command
      if (session.mode === 'virtual') {
        // Simulate response in virtual mode
        await this.handleVirtualCommand(ws, message);
      } else if (session.mode === 'hardware') {
        // Route to hardware gateway
        await this.routeToHardware(ws, message);
      }
    } else if (connection.type === 'hardware') {
      // Hardware receiving command - this shouldn't happen in normal flow
      console.warn('Hardware gateway received command message (should only send responses)');
    }
  }

  private async handleVirtualCommand(ws: WebSocket, message: WebSocketMessage) {
    const commandId = message.commandId!;
    const responseTime = Math.random() * 500 + 50; // Simulate 50-550ms response time

    // Simulate response based on command type
    let response = '';
    switch (message.commandType) {
      case 'OBD2':
        response = this.simulateOBD2Response(message.command!);
        break;
      case 'UDS':
        response = this.simulateUDSResponse(message.command!);
        break;
      case 'CAN':
        response = this.simulateCANResponse(message.command!);
        break;
      default:
        response = 'UNKNOWN_COMMAND';
    }

    // Log the command and response
    if (message.sessionId) {
      try {
        await createLogAsync({
          sessionId: message.sessionId,
          timestamp: Date.now(),
          commandType: message.commandType,
          command: message.command!,
          response,
          responseTime: Math.round(responseTime),
          source: 'browser',
        });
      } catch (error) {
        console.error('Failed to log command:', error);
      }
    }

    // Send response after simulated delay
    setTimeout(() => {
      ws.send(JSON.stringify({
        type: 'response',
        commandId,
        response,
        responseTime: Math.round(responseTime),
        timestamp: Date.now(),
      }));
      this.pendingCommands.delete(commandId);
    }, responseTime);
  }

  private async routeToHardware(browserWs: WebSocket, message: WebSocketMessage) {
    const command = message.command!;
    const sessionId = message.sessionId!;

    // Find connected hardware gateway
    let targetHardware: WebSocket | undefined;
    for (const [, hw] of this.hardwareGateways) {
      if (hw.readyState === 1) { // OPEN
        targetHardware = hw;
        break;
      }
    }

    if (!targetHardware) {
      browserWs.send(JSON.stringify({
        type: 'error',
        commandId: message.commandId,
        error: 'No hardware gateway connected',
      }));
      return;
    }

    // Forward command to hardware
    targetHardware.send(JSON.stringify({
      type: 'command',
      commandId: message.commandId,
      sessionId,
      commandType: message.commandType,
      command,
    }));

    // Store mapping for response routing
    const commandMetadata = this.pendingCommands.get(message.commandId!);
    if (commandMetadata) {
      // Store browser ws for response routing
      (commandMetadata as any).browserWs = browserWs;
    }
  }

  private async handleResponse(ws: WebSocket, connection: ActiveConnection, message: WebSocketMessage) {
    const { commandId, response, responseTime } = message;

    if (!commandId) {
      console.warn('Response missing commandId');
      return;
    }

    const commandMetadata = this.pendingCommands.get(commandId);
    if (!commandMetadata) {
      console.warn(`No pending command found for commandId: ${commandId}`);
      return;
    }

    // Log the response
    try {
      await createLogAsync({
        sessionId: commandMetadata.sessionId,
        timestamp: Date.now(),
        commandType: message.commandType ?? 'OBD2' as const,
        command: '', // Response doesn't have the original command
        response: response || '',
        responseTime: responseTime || 0,
        source: connection.type,
      });
    } catch (error) {
      console.error('Failed to log response:', error);
    }

    // Route response back to browser if hardware sent it
    if (connection.type === 'hardware') {
      const browserWs = (commandMetadata as any).browserWs;
      if (browserWs && browserWs.readyState === 1) {
        browserWs.send(JSON.stringify({
          type: 'response',
          commandId,
          response,
          responseTime,
          timestamp: Date.now(),
        }));
      }
    }

    this.pendingCommands.delete(commandId);
  }

  private simulateOBD2Response(command: string): string {
    // Simple OBD2 response simulation
    const hex = command.toUpperCase().replace(/\s/g, '');

    // Map common OBD2 PIDs to responses
    const responses: Record<string, string> = {
      '0100': '41 00 98 19 A8 13',
      '0101': '41 01 FF 00',
      '0102': '41 02 7E',
      '0105': '41 05 64',
      '010C': '41 0C 1A F0',
      '010D': '41 0D 58',
      '0110': '41 10 00 00',
    };

    return responses[hex] || '41 00 00 00 00';
  }

  private simulateUDSResponse(command: string): string {
    // Simple UDS response simulation
    const hex = command.toUpperCase().replace(/\s/g, '');

    // UDS responses (simplified)
    if (hex.startsWith('10')) {
      // Diagnostic Session Control
      return '50 01 00 32 01 F4';
    } else if (hex.startsWith('22')) {
      // Read DID
      return '62' + hex.substring(2) + '00 01 02 03';
    } else if (hex.startsWith('2E')) {
      // Write DID
      return '6E' + hex.substring(2, 4) + '00';
    } else if (hex.startsWith('3E')) {
      // Tester Present
      return '7E' + hex.substring(2) + '00';
    }

    return '7F' + hex.substring(0, 2) + '12'; // Negative response
  }

  private simulateCANResponse(command: string): string {
    // CAN frame echo response
    return `ECHO: ${command}`;
  }

  public broadcast(message: WebSocketMessage, excludeWs?: WebSocket) {
    const data = JSON.stringify(message);
    for (const connection of this.connections.values()) {
      if (connection.ws.readyState === 1 && connection.ws !== excludeWs) {
        connection.ws.send(data);
      }
    }
  }

  public broadcastToType(type: 'browser' | 'hardware', message: WebSocketMessage) {
    const data = JSON.stringify(message);
    for (const connection of this.connections.values()) {
      if (connection.type === type && connection.ws.readyState === 1) {
        connection.ws.send(data);
      }
    }
  }

  public getConnectedClients(): { browsers: number; hardware: number } {
    let browsers = 0;
    let hardware = 0;

    for (const connection of this.connections.values()) {
      if (connection.ws.readyState === 1) {
        if (connection.type === 'browser') browsers++;
        else if (connection.type === 'hardware') hardware++;
      }
    }

    return { browsers, hardware };
  }
}
