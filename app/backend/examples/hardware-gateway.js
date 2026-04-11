/**
 * Example Hardware Gateway Client
 *
 * This is an example Node.js script for a hardware gateway (Arduino/RPi)
 * that connects to the ECU Simulator backend WebSocket and processes
 * OBD2/UDS/CAN commands.
 *
 * Usage:
 *   node hardware-gateway.js
 */

const WebSocket = require('ws');

const BACKEND_URL = process.env.BACKEND_URL || 'ws://localhost:8000/ws';
const GATEWAY_ID = process.env.GATEWAY_ID || 'gateway-001';

class HardwareGateway {
  constructor(backendUrl) {
    this.backendUrl = backendUrl;
    this.ws = null;
    this.connected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 3000;
  }

  connect() {
    console.log(`[${new Date().toISOString()}] Connecting to backend: ${this.backendUrl}`);

    this.ws = new WebSocket(this.backendUrl);

    this.ws.onopen = () => this.onOpen();
    this.ws.onmessage = (event) => this.onMessage(event);
    this.ws.onerror = (error) => this.onError(error);
    this.ws.onclose = () => this.onClose();
  }

  onOpen() {
    console.log(`[${new Date().toISOString()}] Connected to backend`);
    this.connected = true;
    this.reconnectAttempts = 0;

    // Identify as hardware gateway
    this.send({
      type: 'status',
      connectionType: 'hardware',
      hardwareId: GATEWAY_ID,
    });
  }

  onMessage(event) {
    try {
      const message = JSON.parse(event.data);

      switch (message.type) {
        case 'status':
          console.log(`[${new Date().toISOString()}] Status: ${message.message}`);
          if (message.hardwareId) {
            console.log(`[${new Date().toISOString()}] Hardware ID: ${message.hardwareId}`);
          }
          break;

        case 'command':
          this.handleCommand(message);
          break;

        case 'heartbeat':
          this.handleHeartbeat(message);
          break;

        default:
          console.log(`[${new Date().toISOString()}] Unknown message type: ${message.type}`);
      }
    } catch (error) {
      console.error(`[${new Date().toISOString()}] Error parsing message:`, error);
    }
  }

  async handleCommand(message) {
    const { commandId, commandType, command, sessionId } = message;

    console.log(`[${new Date().toISOString()}] Received command:`, {
      commandId,
      commandType,
      command,
      sessionId,
    });

    try {
      // Simulate command processing
      // In a real implementation, this would interface with actual hardware (CAN bus, etc.)
      const response = await this.processCommand(commandType, command);
      const responseTime = Math.random() * 500 + 50; // Simulate response delay

      console.log(`[${new Date().toISOString()}] Sending response:`, {
        commandId,
        response,
        responseTime: Math.round(responseTime),
      });

      this.send({
        type: 'response',
        commandId,
        response,
        responseTime: Math.round(responseTime),
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error(`[${new Date().toISOString()}] Error processing command:`, error);

      this.send({
        type: 'error',
        commandId,
        error: error.message,
      });
    }
  }

  async processCommand(commandType, command) {
    // Simulate actual hardware processing
    // Replace this with real CAN/OBD2/UDS handling

    // Simulate processing delay
    await new Promise((resolve) => setTimeout(resolve, Math.random() * 500 + 50));

    switch (commandType) {
      case 'OBD2':
        return this.processOBD2(command);
      case 'UDS':
        return this.processUDS(command);
      case 'CAN':
        return this.processCANFrame(command);
      default:
        throw new Error(`Unknown command type: ${commandType}`);
    }
  }

  processOBD2(command) {
    // Mock OBD2 processing
    console.log(`[${new Date().toISOString()}] Processing OBD2 command: ${command}`);

    // In a real implementation, send to actual OBD2 interface
    const hex = command.toUpperCase().replace(/\s/g, '');

    // Return simulated response
    const responses = {
      '0100': '41 00 98 19 A8 13',
      '0101': '41 01 FF 00',
      '0102': '41 02 7E',
      '0105': '41 05 64',
      '010C': '41 0C 1A F0',
      '010D': '41 0D 58',
    };

    return responses[hex] || '7F 01 12'; // Negative response
  }

  processUDS(command) {
    // Mock UDS processing
    console.log(`[${new Date().toISOString()}] Processing UDS command: ${command}`);

    const hex = command.toUpperCase().replace(/\s/g, '');

    if (hex.startsWith('10')) {
      return '50 01 00 32 01 F4';
    } else if (hex.startsWith('22')) {
      return '62' + hex.substring(2) + '00 01 02 03';
    } else if (hex.startsWith('3E')) {
      return '7E 00';
    }

    return '7F' + hex.substring(0, 2) + '12';
  }

  processCANFrame(command) {
    // Mock CAN frame processing
    console.log(`[${new Date().toISOString()}] Processing CAN frame: ${command}`);

    // In a real implementation, forward to actual CAN bus and receive response
    return `PROCESSED: ${command}`;
  }

  handleHeartbeat(message) {
    // Respond to heartbeat
    this.send({
      type: 'heartbeat',
      timestamp: Date.now(),
    });
  }

  onError(error) {
    console.error(`[${new Date().toISOString()}] WebSocket error:`, error);
  }

  onClose() {
    console.log(`[${new Date().toISOString()}] Disconnected from backend`);
    this.connected = false;

    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      console.log(
        `[${new Date().toISOString()}] Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`
      );
      setTimeout(() => this.connect(), this.reconnectDelay);
    } else {
      console.error(`[${new Date().toISOString()}] Max reconnection attempts reached`);
      process.exit(1);
    }
  }

  send(message) {
    if (this.connected && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      console.warn(`[${new Date().toISOString()}] Not connected, cannot send message`);
    }
  }

  close() {
    if (this.ws) {
      this.ws.close();
    }
  }
}

// Main execution
const gateway = new HardwareGateway(BACKEND_URL);
gateway.connect();

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log(`[${new Date().toISOString()}] Shutting down gracefully...`);
  gateway.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log(`[${new Date().toISOString()}] Shutting down gracefully...`);
  gateway.close();
  process.exit(0);
});

// Periodic heartbeat (optional)
setInterval(() => {
  if (gateway.connected) {
    gateway.send({
      type: 'heartbeat',
    });
  }
}, 30000);
