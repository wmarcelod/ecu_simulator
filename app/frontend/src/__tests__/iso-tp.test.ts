// ISO-TP layer tests (ISO 15765-2)

import { describe, it, expect } from 'vitest';
import {
  IsoTp,
  IsoTpCanFrame,
  IsoTpClock,
  IsoTpFlowStatus,
  IsoTpStack,
  IsoTpPciType,
  decodeStMin,
  encodeStMin,
} from '../lib/iso-tp';

// ----------------------------------------------------------------
// Synthetic clock that advances on demand. Does NOT use real time.
// ----------------------------------------------------------------
function makeFakeClock() {
  let nowMs = 0;
  let nextHandle = 1;
  type Timer = { id: number; deadline: number; cb: () => void; cancelled: boolean };
  const timers: Timer[] = [];

  const advance = (ms: number) => {
    nowMs += ms;
    let safety = 0;
    while (safety++ < 1000) {
      const t = timers.find((x) => !x.cancelled && x.deadline <= nowMs);
      if (!t) break;
      t.cancelled = true;
      t.cb();
    }
  };

  const clock: IsoTpClock = {
    now: () => nowMs,
    setTimeout: (cb, ms) => {
      const t: Timer = { id: nextHandle++, deadline: nowMs + ms, cb, cancelled: false };
      timers.push(t);
      return t;
    },
    clearTimeout: (h) => {
      const t = h as Timer;
      if (t) t.cancelled = true;
    },
    sleep: (ms) =>
      new Promise<void>((resolve) => {
        clock.setTimeout(() => resolve(), ms);
      }),
  };

  return { clock, advance };
}

function makeBus() {
  const aId = 0x7e0;
  const bId = 0x7e8;
  const log: IsoTpCanFrame[] = [];
  let stackA: IsoTpStack | null = null;
  let stackB: IsoTpStack | null = null;
  return {
    aId,
    bId,
    log,
    bind(a: IsoTpStack, b: IsoTpStack) {
      stackA = a;
      stackB = b;
    },
    sendFromA(f: IsoTpCanFrame) {
      log.push(f);
      stackB?.onCanFrame(f);
    },
    sendFromB(f: IsoTpCanFrame) {
      log.push(f);
      stackA?.onCanFrame(f);
    },
  };
}

describe('ISO-TP frame builders / decoders (pure)', () => {
  it('builds a Single Frame and round-trips', () => {
    const data = Uint8Array.from([0x01, 0x02, 0x03]);
    const sf = IsoTp.buildSingleFrame(data, 0xaa);
    expect(sf.length).toBe(8);
    expect(sf[0]).toBe(0x03);
    expect(IsoTp.pciType(sf)).toBe(IsoTpPciType.SF);
    expect(IsoTp.decodeSingleFrame(sf)).toEqual(data);
    expect(sf[7]).toBe(0xaa);
  });

  it('builds a First Frame and round-trips', () => {
    const total = 100;
    const firstSix = Uint8Array.from([10, 11, 12, 13, 14, 15]);
    const ff = IsoTp.buildFirstFrame(total, firstSix);
    expect(IsoTp.pciType(ff)).toBe(IsoTpPciType.FF);
    expect(ff[1]).toBe(total & 0xff);
    const decoded = IsoTp.decodeFirstFrame(ff);
    expect(decoded.totalLen).toBe(total);
    expect(decoded.firstSix).toEqual(firstSix);
  });

  it('builds a Consecutive Frame with 4-bit seq', () => {
    const cf = IsoTp.buildConsecutiveFrame(5, Uint8Array.from([0xa, 0xb, 0xc]));
    expect(IsoTp.pciType(cf)).toBe(IsoTpPciType.CF);
    expect(cf[0]).toBe(0x25);
    expect(IsoTp.decodeConsecutiveFrame(cf).seq).toBe(5);
  });

  it('builds a Flow Control frame', () => {
    const fc = IsoTp.buildFlowControl(IsoTpFlowStatus.ContinueToSend, 8, 0x14);
    expect(IsoTp.pciType(fc)).toBe(IsoTpPciType.FC);
    expect(fc[0]).toBe(0x30);
    expect(fc[1]).toBe(8);
    expect(fc[2]).toBe(0x14);
  });

  it('rejects oversized SF and undersized FF', () => {
    expect(() => IsoTp.buildSingleFrame(new Uint8Array(8))).toThrow();
    expect(() => IsoTp.buildFirstFrame(7, new Uint8Array(6))).toThrow();
    expect(() => IsoTp.buildFirstFrame(0x1000, new Uint8Array(6))).toThrow();
  });

  it('decodes STmin per ISO 15765-2 spec', () => {
    expect(decodeStMin(0)).toBe(0);
    expect(decodeStMin(10)).toBe(10);
    expect(decodeStMin(0x7f)).toBe(127);
    expect(decodeStMin(0xf1)).toBeCloseTo(0.1, 5);
    expect(decodeStMin(0xf9)).toBeCloseTo(0.9, 5);
    expect(decodeStMin(0x80)).toBe(0);
  });

  it('encodeStMin is inverse of decodeStMin for valid range', () => {
    for (let ms = 0; ms <= 127; ms++) {
      expect(decodeStMin(encodeStMin(ms))).toBe(ms);
    }
  });
});

describe('IsoTpStack — Single Frame round-trip', () => {
  it('SF tester→ECU then SF ECU→tester', async () => {
    const bus = makeBus();
    const fakeClock = makeFakeClock();
    const aRecv: Uint8Array[] = [];
    const bRecv: Uint8Array[] = [];

    const a = new IsoTpStack({ txId: bus.aId, rxId: bus.bId }, bus.sendFromA, fakeClock.clock);
    const b = new IsoTpStack({ txId: bus.bId, rxId: bus.aId }, bus.sendFromB, fakeClock.clock);
    bus.bind(a, b);
    a.addListener((p) => aRecv.push(p));
    b.addListener((p) => bRecv.push(p));

    await a.sendBuffer(Uint8Array.from([0x10, 0x03]));
    expect(bRecv.length).toBe(1);
    expect(bRecv[0]).toEqual(Uint8Array.from([0x10, 0x03]));

    await b.sendBuffer(Uint8Array.from([0x50, 0x03, 0x00, 0x32, 0x01, 0xf4]));
    expect(aRecv.length).toBe(1);
    expect(aRecv[0]).toEqual(Uint8Array.from([0x50, 0x03, 0x00, 0x32, 0x01, 0xf4]));
  });
});

describe('IsoTpStack — multi-frame transfer (BS=0)', () => {
  it('sends a 100-byte payload via FF + 14 CF', async () => {
    const bus = makeBus();
    const fakeClock = makeFakeClock();
    const received: Uint8Array[] = [];

    const a = new IsoTpStack(
      { txId: bus.aId, rxId: bus.bId, blockSize: 0, stMin: 0 },
      bus.sendFromA,
      fakeClock.clock,
    );
    const b = new IsoTpStack(
      { txId: bus.bId, rxId: bus.aId, blockSize: 0, stMin: 0 },
      bus.sendFromB,
      fakeClock.clock,
    );
    bus.bind(a, b);
    b.addListener((p) => received.push(p));

    const payload = new Uint8Array(100);
    for (let i = 0; i < payload.length; i++) payload[i] = (i * 7 + 1) & 0xff;

    await a.sendBuffer(payload);

    expect(received.length).toBe(1);
    expect(received[0]).toEqual(payload);

    const aTx = bus.log.filter((f) => f.id === bus.aId);
    const bTx = bus.log.filter((f) => f.id === bus.bId);
    expect(aTx.length).toBe(1 + 14);
    expect(bTx.length).toBe(1);
  });
});

describe('IsoTpStack — multi-frame transfer (BS=4)', () => {
  it('sends 100 bytes with BS=4 → 4 FCs total', async () => {
    const bus = makeBus();
    const fakeClock = makeFakeClock();
    const received: Uint8Array[] = [];

    const a = new IsoTpStack(
      { txId: bus.aId, rxId: bus.bId, blockSize: 0, stMin: 0 },
      bus.sendFromA,
      fakeClock.clock,
    );
    const b = new IsoTpStack(
      { txId: bus.bId, rxId: bus.aId, blockSize: 4, stMin: 0 },
      bus.sendFromB,
      fakeClock.clock,
    );
    bus.bind(a, b);
    b.addListener((p) => received.push(p));

    const payload = new Uint8Array(100);
    for (let i = 0; i < payload.length; i++) payload[i] = i & 0xff;

    await a.sendBuffer(payload);
    expect(received.length).toBe(1);
    expect(received[0]).toEqual(payload);

    const fcs = bus.log.filter((f) => (f.data[0] & 0xf0) === 0x30);
    expect(fcs.length).toBe(4);
  });
});

describe('IsoTpStack — sequence error', () => {
  it('triggers sequence-error if a CF arrives out of order', () => {
    const bus = makeBus();
    const fakeClock = makeFakeClock();
    const errors: Error[] = [];

    const a = new IsoTpStack({ txId: bus.aId, rxId: bus.bId }, bus.sendFromA, fakeClock.clock);
    const b = new IsoTpStack({ txId: bus.bId, rxId: bus.aId }, bus.sendFromB, fakeClock.clock);
    bus.bind(a, b);
    b.addErrorListener((e) => errors.push(e));

    const ff = IsoTp.buildFirstFrame(20, new Uint8Array([1, 2, 3, 4, 5, 6]));
    bus.sendFromA({ id: bus.aId, data: ff });
    const wrongCf = IsoTp.buildConsecutiveFrame(7, new Uint8Array([7, 7, 7, 7, 7, 7, 7]));
    bus.sendFromA({ id: bus.aId, data: wrongCf });

    expect(errors.length).toBe(1);
    expect((errors[0] as { kind?: string }).kind).toBe('sequence-error');
  });
});

describe('IsoTpStack — Bs timeout', () => {
  it('rejects sendBuffer with timeout-bs if FC never arrives', async () => {
    const bus = makeBus();
    const fakeClock = makeFakeClock();
    const a = new IsoTpStack(
      { txId: bus.aId, rxId: bus.bId, timeoutBsMs: 100 },
      bus.sendFromA,
      fakeClock.clock,
    );
    const promise = a.sendBuffer(new Uint8Array(20));
    fakeClock.advance(101);
    await expect(promise).rejects.toMatchObject({ kind: 'timeout-bs' });
  });
});

describe('IsoTpStack — overflow handling', () => {
  it('rejects TX when receiver sends FC=Overflow', async () => {
    const bus = makeBus();
    const fakeClock = makeFakeClock();
    const a = new IsoTpStack(
      { txId: bus.aId, rxId: bus.bId, timeoutBsMs: 1000 },
      bus.sendFromA,
      fakeClock.clock,
    );
    const promise = a.sendBuffer(new Uint8Array(20));
    const fcOvfl = IsoTp.buildFlowControl(IsoTpFlowStatus.Overflow, 0, 0);
    bus.sendFromB({ id: bus.bId, data: fcOvfl });
    await expect(promise).rejects.toMatchObject({ kind: 'overflow' });
  });
});

describe('IsoTpStack — concurrent sends', () => {
  it('the second sendBuffer rejects while the first is in progress', async () => {
    const bus = makeBus();
    const fakeClock = makeFakeClock();
    const a = new IsoTpStack(
      { txId: bus.aId, rxId: bus.bId, timeoutBsMs: 5000 },
      bus.sendFromA,
      fakeClock.clock,
    );
    const first = a.sendBuffer(new Uint8Array(20));
    const second = a.sendBuffer(new Uint8Array(8));
    await expect(second).rejects.toMatchObject({ kind: 'aborted' });
    fakeClock.advance(5001);
    await expect(first).rejects.toBeDefined();
  });
});
