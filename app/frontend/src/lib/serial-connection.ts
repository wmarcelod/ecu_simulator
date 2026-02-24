// ============================================================
// Web Serial API Integration — CAN Gateway Protocol (CSV)
// Protocol: TX,<ID_HEX>,<EXT>,<DATA_HEX>\n (send)
//           RX,<ID_HEX>,<EXT>,<DLC>,<DATA_HEX>,<TIMESTAMP>\n (receive)
//           TX,<ID_HEX>,<EXT>,<DLC>,<DATA_HEX>,<TIMESTAMP>\n (echo)
//           INFO,<MSG>\n (info message)
//           PROTO,<N>\n (set protocol/speed)
// ============================================================

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface CANFrame {
  tag: string;       // "RX" or "TX"
  id: number;        // CAN ID (numeric)
  ext: boolean;      // Extended frame flag
  dlc: number;       // Data Length Code
  data: string;      // Hex data string (e.g. "02010C0000000000")
  timestamp: number;  // Millis timestamp from Arduino
}

export interface SerialConnectionOptions {
  baudRate?: number;
  onData?: (data: string) => void;
  onCANFrame?: (frame: CANFrame) => void;
  onInfo?: (msg: string) => void;
  onStatusChange?: (status: ConnectionStatus) => void;
  onError?: (error: string) => void;
}

export class SerialConnection {
  private port: SerialPort | null = null;
  private reader: ReadableStreamDefaultReader<string> | null = null;
  private writer: WritableStreamDefaultWriter<string> | null = null;
  private readableStreamClosed: Promise<void> | null = null;
  private writableStreamClosed: Promise<void> | null = null;
  private status: ConnectionStatus = 'disconnected';
  private options: SerialConnectionOptions;
  private reading: boolean = false;
  private lineBuffer: string = '';

  constructor(options: SerialConnectionOptions = {}) {
    this.options = {
      baudRate: 115200,
      ...options,
    };
  }

  static isSupported(): boolean {
    return 'serial' in navigator;
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  private setStatus(status: ConnectionStatus) {
    this.status = status;
    this.options.onStatusChange?.(status);
  }

  async connect(): Promise<boolean> {
    if (!SerialConnection.isSupported()) {
      this.options.onError?.('Web Serial API is not supported in this browser. Use a Chromium-based browser.');
      this.setStatus('error');
      return false;
    }

    try {
      this.setStatus('connecting');
      this.port = await navigator.serial.requestPort();
      await this.port.open({ baudRate: this.options.baudRate! });

      // Setup read stream
      const textDecoder = new TextDecoderStream();
      this.readableStreamClosed = this.port.readable!.pipeTo(textDecoder.writable);
      this.reader = textDecoder.readable.getReader();

      // Setup write stream
      const textEncoder = new TextEncoderStream();
      this.writableStreamClosed = textEncoder.readable.pipeTo(this.port.writable!);
      this.writer = textEncoder.writable.getWriter();

      this.lineBuffer = '';
      this.setStatus('connected');
      this.startReading();
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to connect';
      this.options.onError?.(message);
      this.setStatus('error');
      return false;
    }
  }

  private async startReading() {
    if (!this.reader) return;
    this.reading = true;

    try {
      while (this.reading) {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (value) {
          // Forward raw data for compatibility
          this.options.onData?.(value);
          // Accumulate into line buffer and process complete lines
          this.lineBuffer += value;
          this.processLineBuffer();
        }
      }
    } catch (err) {
      if (this.reading) {
        const message = err instanceof Error ? err.message : 'Read error';
        this.options.onError?.(message);
        this.setStatus('error');
      }
    }
  }

  /**
   * Process the line buffer, extracting complete lines terminated by \n.
   * Each complete line is parsed according to the CSV protocol.
   */
  private processLineBuffer() {
    let newlineIndex: number;
    while ((newlineIndex = this.lineBuffer.indexOf('\n')) !== -1) {
      let line = this.lineBuffer.substring(0, newlineIndex);
      this.lineBuffer = this.lineBuffer.substring(newlineIndex + 1);

      // Strip trailing \r if present
      if (line.endsWith('\r')) {
        line = line.substring(0, line.length - 1);
      }

      if (line.length === 0) continue;
      this.parseLine(line);
    }
  }

  /**
   * Parse a single line from the Arduino CAN gateway.
   * Formats:
   *   RX,<ID_HEX>,<EXT>,<DLC>,<DATA_HEX>,<TIMESTAMP>
   *   TX,<ID_HEX>,<EXT>,<DLC>,<DATA_HEX>,<TIMESTAMP>
   *   INFO,<MSG>
   *   INFO,PROTO,OK|FAIL
   */
  private parseLine(line: string) {
    if (line.startsWith('RX,') || line.startsWith('TX,')) {
      // CAN frame: TAG,ID,EXT,DLC,DATA,TIMESTAMP
      const parts = line.split(',');
      if (parts.length >= 6) {
        const frame: CANFrame = {
          tag: parts[0],
          id: parseInt(parts[1], 16),
          ext: parts[2] === '1',
          dlc: parseInt(parts[3], 10),
          data: parts[4],
          timestamp: parseInt(parts[5], 10),
        };
        this.options.onCANFrame?.(frame);
      }
    } else if (line.startsWith('INFO,')) {
      const msg = line.substring(5);
      this.options.onInfo?.(msg);
    }
  }

  /**
   * Write raw string to serial port. Appends \n (not \r).
   */
  async write(data: string): Promise<boolean> {
    if (!this.writer || this.status !== 'connected') {
      return false;
    }

    try {
      await this.writer.write(data + '\n');
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Write error';
      this.options.onError?.(message);
      return false;
    }
  }

  /**
   * Send a CAN frame through the Arduino gateway.
   * Format: TX,<ID_HEX>,<EXT_0or1>,<DATA_HEX>\n
   *
   * @param id - CAN ID (e.g. 0x7DF)
   * @param ext - Extended frame flag
   * @param data - Data bytes as Uint8Array (up to 8 bytes)
   */
  async sendCANFrame(id: number, ext: boolean, data: Uint8Array): Promise<boolean> {
    const idHex = id.toString(16).toUpperCase();
    const extFlag = ext ? '1' : '0';
    const dataHex = Array.from(data)
      .map((b) => b.toString(16).toUpperCase().padStart(2, '0'))
      .join('');
    const cmd = `TX,${idHex},${extFlag},${dataHex}`;
    return this.write(cmd);
  }

  /**
   * Send an OBD-II request via CAN.
   * Builds a standard OBD-II CAN frame (ID 0x7DF, 8 bytes, padded with 0x55).
   *
   * @param mode - OBD-II mode (e.g. 0x01)
   * @param pid - OBD-II PID (e.g. 0x0C for RPM)
   */
  async sendOBDRequest(mode: number, pid: number): Promise<boolean> {
    const data = new Uint8Array([0x02, mode, pid, 0x55, 0x55, 0x55, 0x55, 0x55]);
    return this.sendCANFrame(0x7DF, false, data);
  }

  /**
   * Set the CAN bus protocol/speed on the Arduino gateway.
   * Format: PROTO,<N>\n
   * Protocols: 6/7 = 500kbps, 8/9 = 250kbps
   *
   * @param proto - Protocol number (6, 7, 8, or 9)
   */
  async setProtocol(proto: number): Promise<boolean> {
    const cmd = `PROTO,${proto}`;
    return this.write(cmd);
  }

  async disconnect(): Promise<void> {
    this.reading = false;

    try {
      if (this.reader) {
        await this.reader.cancel();
        this.reader.releaseLock();
        this.reader = null;
      }
      if (this.readableStreamClosed) {
        await this.readableStreamClosed.catch(() => {});
        this.readableStreamClosed = null;
      }
      if (this.writer) {
        await this.writer.close();
        this.writer = null;
      }
      if (this.writableStreamClosed) {
        await this.writableStreamClosed.catch(() => {});
        this.writableStreamClosed = null;
      }
      if (this.port) {
        await this.port.close();
        this.port = null;
      }
    } catch {
      // Ignore close errors
    }

    this.lineBuffer = '';
    this.setStatus('disconnected');
  }
}