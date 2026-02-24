// ============================================================
// Web Serial API Integration
// ============================================================

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface SerialConnectionOptions {
  baudRate?: number;
  onData?: (data: string) => void;
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
          this.options.onData?.(value);
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

  async write(data: string): Promise<boolean> {
    if (!this.writer || this.status !== 'connected') {
      return false;
    }

    try {
      await this.writer.write(data + '\r');
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Write error';
      this.options.onError?.(message);
      return false;
    }
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

    this.setStatus('disconnected');
  }
}