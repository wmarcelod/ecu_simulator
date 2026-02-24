// ============================================================
// DBC File Parser — Vector CANdb++ format
// ============================================================

export interface DBCSignal {
  name: string;
  startBit: number;
  bitSize: number;
  byteOrder: 'little_endian' | 'big_endian';
  valueType: 'unsigned' | 'signed';
  factor: number;
  offset: number;
  min: number;
  max: number;
  unit: string;
  receivers: string[];
  comment?: string;
}

export interface DBCMessage {
  id: number;
  name: string;
  size: number;
  sender: string;
  signals: DBCSignal[];
  comment?: string;
}

export interface DBCFile {
  version: string;
  messages: DBCMessage[];
  nodes: string[];
  comments: Record<string, string>;
  filename: string;
}

/**
 * Parse a .dbc file content into a structured DBCFile object.
 * Supports: VERSION, BU_, BO_, SG_, CM_, VAL_
 */
export function parseDBC(content: string, filename: string = 'unknown.dbc'): DBCFile {
  const result: DBCFile = {
    version: '',
    messages: [],
    nodes: [],
    comments: {},
    filename,
  };

  const lines = content.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();

    // VERSION
    if (line.startsWith('VERSION')) {
      const match = line.match(/VERSION\s+"([^"]*)"/);
      if (match) result.version = match[1];
      i++;
      continue;
    }

    // BU_ (Nodes)
    if (line.startsWith('BU_')) {
      const parts = line.replace('BU_', '').replace(':', '').trim().split(/\s+/);
      result.nodes = parts.filter((p) => p.length > 0);
      i++;
      continue;
    }

    // BO_ (Message)
    if (line.startsWith('BO_')) {
      const msgMatch = line.match(/BO_\s+(\d+)\s+(\w+)\s*:\s*(\d+)\s+(\w+)/);
      if (msgMatch) {
        const msg: DBCMessage = {
          id: parseInt(msgMatch[1], 10),
          name: msgMatch[2],
          size: parseInt(msgMatch[3], 10),
          sender: msgMatch[4],
          signals: [],
        };

        // Parse signals that follow (indented lines starting with SG_)
        i++;
        while (i < lines.length) {
          const sigLine = lines[i].trim();
          if (!sigLine.startsWith('SG_')) break;

          const signal = parseSignalLine(sigLine);
          if (signal) msg.signals.push(signal);
          i++;
        }

        result.messages.push(msg);
        continue;
      }
    }

    // CM_ (Comments)
    if (line.startsWith('CM_')) {
      // Message comment: CM_ BO_ 2024 "Some comment";
      const msgCmMatch = line.match(/CM_\s+BO_\s+(\d+)\s+"([^"]*)"\s*;/);
      if (msgCmMatch) {
        const msgId = parseInt(msgCmMatch[1], 10);
        const msg = result.messages.find((m) => m.id === msgId);
        if (msg) msg.comment = msgCmMatch[2];
        i++;
        continue;
      }

      // Signal comment: CM_ SG_ 2024 engine_rpm "Some comment";
      const sigCmMatch = line.match(/CM_\s+SG_\s+(\d+)\s+(\w+)\s+"([^"]*)"\s*;/);
      if (sigCmMatch) {
        const msgId = parseInt(sigCmMatch[1], 10);
        const sigName = sigCmMatch[2];
        const msg = result.messages.find((m) => m.id === msgId);
        if (msg) {
          const sig = msg.signals.find((s) => s.name === sigName);
          if (sig) sig.comment = sigCmMatch[3];
        }
        i++;
        continue;
      }

      // General comment
      const genCmMatch = line.match(/CM_\s+"([^"]*)"\s*;/);
      if (genCmMatch) {
        result.comments['general'] = genCmMatch[1];
      }
    }

    i++;
  }

  return result;
}

/**
 * Parse a single SG_ line into a DBCSignal object.
 * Format: SG_ signal_name : start_bit|bit_size@byte_order value_type (factor,offset) [min|max] "unit" receivers
 */
function parseSignalLine(line: string): DBCSignal | null {
  // SG_ engine_rpm : 24|16@1+ (0.25,0) [0|16383.75] "rpm" Vector__XXX
  const match = line.match(
    /SG_\s+(\w+)\s*:\s*(\d+)\|(\d+)@([01])([+-])\s*\(([^,]+),([^)]+)\)\s*\[([^|]+)\|([^\]]+)\]\s*"([^"]*)"\s*(.*)/
  );

  if (!match) return null;

  return {
    name: match[1],
    startBit: parseInt(match[2], 10),
    bitSize: parseInt(match[3], 10),
    byteOrder: match[4] === '1' ? 'little_endian' : 'big_endian',
    valueType: match[5] === '+' ? 'unsigned' : 'signed',
    factor: parseFloat(match[6]),
    offset: parseFloat(match[7]),
    min: parseFloat(match[8]),
    max: parseFloat(match[9]),
    unit: match[10],
    receivers: match[11].trim().split(/[,\s]+/).filter((r) => r.length > 0),
  };
}

/**
 * Encode a physical value into raw CAN signal bits.
 * raw = (physical - offset) / factor
 */
export function encodeSignalValue(signal: DBCSignal, physicalValue: number): number {
  const raw = Math.round((physicalValue - signal.offset) / signal.factor);
  const maxRaw = (1 << signal.bitSize) - 1;
  return Math.max(0, Math.min(maxRaw, raw));
}

/**
 * Decode raw CAN signal bits into a physical value.
 * physical = raw * factor + offset
 */
export function decodeSignalValue(signal: DBCSignal, rawValue: number): number {
  return rawValue * signal.factor + signal.offset;
}

/**
 * Pack a signal's raw value into a CAN data byte array.
 */
export function packSignalIntoData(
  data: Uint8Array,
  signal: DBCSignal,
  rawValue: number
): void {
  if (signal.byteOrder === 'little_endian') {
    // Intel byte order
    let startBit = signal.startBit;
    let bitsRemaining = signal.bitSize;
    let value = rawValue;

    while (bitsRemaining > 0) {
      const byteIdx = Math.floor(startBit / 8);
      const bitInByte = startBit % 8;
      const bitsInThisByte = Math.min(bitsRemaining, 8 - bitInByte);
      const mask = ((1 << bitsInThisByte) - 1) << bitInByte;

      data[byteIdx] = (data[byteIdx] & ~mask) | ((value << bitInByte) & mask);

      value >>= bitsInThisByte;
      startBit += bitsInThisByte;
      bitsRemaining -= bitsInThisByte;
    }
  } else {
    // Motorola byte order
    const startBit = signal.startBit;
    const bitsRemaining = signal.bitSize;
    const value = rawValue;

    // For big endian, we need to work from MSB to LSB
    const bitPositions: number[] = [];
    let currentBit = startBit;
    for (let b = 0; b < signal.bitSize; b++) {
      bitPositions.push(currentBit);
      const byteNum = Math.floor(currentBit / 8);
      const bitInByte = currentBit % 8;
      if (bitInByte === 0) {
        currentBit = (byteNum + 1) * 8 + 7;
      } else {
        currentBit--;
      }
    }

    for (let b = 0; b < bitPositions.length; b++) {
      const bitPos = bitPositions[b];
      const byteIdx = Math.floor(bitPos / 8);
      const bitInByte = bitPos % 8;
      const bitValue = (value >> (signal.bitSize - 1 - b)) & 1;

      if (bitValue) {
        data[byteIdx] |= (1 << bitInByte);
      } else {
        data[byteIdx] &= ~(1 << bitInByte);
      }
    }
  }
}

/**
 * Build a CAN data frame for a message with given signal values.
 */
export function buildCANFrame(
  message: DBCMessage,
  signalValues: Record<string, number>
): Uint8Array {
  const data = new Uint8Array(message.size);

  for (const signal of message.signals) {
    const physValue = signalValues[signal.name] ?? signal.min;
    const rawValue = encodeSignalValue(signal, physValue);
    packSignalIntoData(data, signal, rawValue);
  }

  return data;
}

/**
 * Convert a DBC file into a vehicle profile format compatible with the ECU simulator.
 */
export function dbcToSensorConfig(dbc: DBCFile): {
  name: string;
  signals: Array<{
    key: string;
    label: string;
    unit: string;
    min: number;
    max: number;
    idle: number;
    messageId: number;
    messageName: string;
    signal: DBCSignal;
  }>;
  messages: DBCMessage[];
} {
  const signals: Array<{
    key: string;
    label: string;
    unit: string;
    min: number;
    max: number;
    idle: number;
    messageId: number;
    messageName: string;
    signal: DBCSignal;
  }> = [];

  for (const msg of dbc.messages) {
    for (const sig of msg.signals) {
      const idle = sig.min + (sig.max - sig.min) * 0.3; // Default idle at 30% of range
      signals.push({
        key: sig.name,
        label: sig.name.replace(/_/g, ' ').toUpperCase(),
        unit: sig.unit,
        min: sig.min,
        max: sig.max,
        idle: Math.round(idle * 100) / 100,
        messageId: msg.id,
        messageName: msg.name,
        signal: sig,
      });
    }
  }

  return {
    name: dbc.filename.replace('.dbc', ''),
    signals,
    messages: dbc.messages,
  };
}