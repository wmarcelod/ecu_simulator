// ============================================================
// ISO-TP (ISO 15765-2) tests — uses VirtualClock for determinism
// ============================================================
import { describe, expect, it } from 'vitest';
import {
  IsoTpStack,
  IsoTpError,
  VirtualClock,
  CanFrame,
  buildSingleFrame,
  buildFirstFrame,
  buildConsecutiveFrame,
  buildFlowControl,
  parsePci,
  decodeStMin,
  encodeStMin,
  defaultIsoTpConfig,
  bytesToHex,
  hexToBytes,
  ISOTP_PCI_SF,
  ISOTP_PCI_FF,
  ISOTP_PCI_CF,
  ISOTP_PCI_FC,
  ISOTP_FC_CTS,
  ISOTP_FC_OVERFLOW,
} from '../lib/iso-tp';

// ----- helpers -----
function makeBus() {
  // "bus" — frames pushed to one stack flow into the other (loopback)
  const frames: CanFrame[] = [];
  return { frames };
}

describe('ISO-TP frame builders', () => {
  it('buildSingleFrame encodes PCI nibble = 0 and length in low nibble', () => {
    const sf = buildSingleFrame(new Uint8Array([0x10, 0x02]));
    expect(sf.length).toBe(8);
    expect(sf[0]).toBe(0x02);
    expect(sf[1]).toBe(0x10);
    expect(sf[2]).toBe(0x02);
    expect(sf[3]).toBe(0xAA); // padding
  });

  it('buildSingleFrame rejects 0 or >7 byte payloads', () => {
    expect(() => buildSingleFrame(new Uint8Array(0))).toThrow(IsoTpError);
    expect(() => buildSingleFrame(new Uint8Array(8))).toThrow(IsoTpError);
  });

  it('buildFirstFrame encodes PCI=1 with 12-bit total length', () => {
    const ff = buildFirstFrame(0x0123, new Uint8Array([1, 2, 3, 4, 5, 6]));
    expect(ff.length).toBe(8);
    expect(ff[0]).toBe(0x11); // FF=1, high nibble of len=0x1
    expect(ff[1]).toBe(0x23); // low byte
    expect(Array.from(ff.slice(2))).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('buildFirstFrame rejects out-of-range lengths', () => {
    expect(() => buildFirstFrame(7, new Uint8Array(6))).toThrow(IsoTpError);
    expect(() => buildFirstFrame(0x1000, new Uint8Array(6))).toThrow(IsoTpError);
  });

  it('buildConsecutiveFrame encodes PCI=2 with sequence in low nibble', () => {
    const cf = buildConsecutiveFrame(5, new Uint8Array([1, 2, 3, 4, 5, 6, 7]));
    expect(cf[0]).toBe(0x25);
  });

  it('buildFlowControl encodes status, BS, STmin', () => {
    const fc = buildFlowControl(ISOTP_FC_CTS, 8, 10);
    expect(fc[0]).toBe(0x30);
    expect(fc[1]).toBe(0x08);
    expect(fc[2]).toBe(0x0A);
  });
});

describe('ISO-TP PCI parsing', () => {
  it('parses SF', () => {
    const p = parsePci(new Uint8Array([0x05, 1, 2, 3, 4, 5, 0xAA, 0xAA]));
    expect(p.type).toBe(ISOTP_PCI_SF);
    expect(p.lowNibble).toBe(5);
  });
  it('parses FF with 12-bit length', () => {
    const p = parsePci(new Uint8Array([0x12, 0x34, 1, 2, 3, 4, 5, 6]));
    expect(p.type).toBe(ISOTP_PCI_FF);
    expect(p.ffLength).toBe(0x234);
  });
  it('parses CF', () => {
    const p = parsePci(new Uint8Array([0x21, 1, 2, 3, 4, 5, 6, 7]));
    expect(p.type).toBe(ISOTP_PCI_CF);
    expect(p.lowNibble).toBe(1);
  });
  it('parses FC', () => {
    const p = parsePci(new Uint8Array([0x30, 0, 10, 0, 0, 0, 0, 0]));
    expect(p.type).toBe(ISOTP_PCI_FC);
    expect(p.lowNibble).toBe(0);
  });
});

describe('STmin codec', () => {
  it('decodes ms range 0..127', () => {
    expect(decodeStMin(0x00)).toBe(0);
    expect(decodeStMin(0x05)).toBe(5);
    expect(decodeStMin(0x7F)).toBe(127);
  });
  it('decodes us range 0xF1..0xF9', () => {
    expect(decodeStMin(0xF1)).toBeCloseTo(0.1, 5);
    expect(decodeStMin(0xF9)).toBeCloseTo(0.9, 5);
  });
  it('decodes reserved values to 127ms', () => {
    expect(decodeStMin(0xFA)).toBe(127);
    expect(decodeStMin(0x80)).toBe(127);
  });
  it('encodes ms back', () => {
    expect(encodeStMin(5)).toBe(5);
    expect(encodeStMin(127)).toBe(0x7F);
    expect(encodeStMin(0.5)).toBe(0xF5);
  });
});

describe('hex helpers', () => {
  it('round-trip', () => {
    const buf = new Uint8Array([0x12, 0xAB, 0xCD, 0xEF]);
    const s = bytesToHex(buf);
    expect(s).toBe('12 AB CD EF');
    const back = hexToBytes(s);
    expect(Array.from(back)).toEqual(Array.from(buf));
  });
});

describe('IsoTpStack — Single Frame round trip', () => {
  it('SF transmitted by sender is received by listener', async () => {
    const out: CanFrame[] = [];
    const cfg = defaultIsoTpConfig({ txId: 0x7E0, rxId: 0x7E8 });
    const stack = new IsoTpStack(cfg, (f) => out.push(f), new VirtualClock());

    const messages: Uint8Array[] = [];
    stack.addListener((m) => messages.push(m));

    const payload = new Uint8Array([0x10, 0x02]);
    await stack.sendBuffer(payload);

    expect(out.length).toBe(1);
    expect(out[0].id).toBe(0x7E0);
    expect(out[0].data[0]).toBe(0x02); // SF len=2
  });
});

describe('IsoTpStack — multi-frame TX with BS=0 and FC=CTS loopback', () => {
  it('20-byte payload transmits as FF + 3 CFs after FC=CTS', async () => {
    const txCfg = defaultIsoTpConfig({ txId: 0x7E0, rxId: 0x7E8 });
    const rxCfg = defaultIsoTpConfig({ txId: 0x7E8, rxId: 0x7E0 });
    const txOut: CanFrame[] = [];
    const rxOut: CanFrame[] = [];
    const clock = new VirtualClock();
    const tx = new IsoTpStack(txCfg, (f) => { txOut.push(f); rx.onCanFrame(f); }, clock);
    const rx = new IsoTpStack(rxCfg, (f) => { rxOut.push(f); tx.onCanFrame(f); }, clock);

    const got: Uint8Array[] = [];
    rx.addListener((m) => got.push(m));

    const payload = new Uint8Array(20);
    for (let i = 0; i < 20; i++) payload[i] = i + 1;

    const sendP = tx.sendBuffer(payload);
    // Drain the virtual clock (N_Br + STmin chains)
    clock.drain(2000);
    await sendP;
    clock.drain(2000); // let any post-completion handlers fire

    expect(got.length).toBe(1);
    expect(Array.from(got[0])).toEqual(Array.from(payload));
    // Frames: FF (20-byte total), 1 FC from rx, then ceil((20-6)/7) = 2 CFs
    expect(txOut.length).toBe(3); // FF + 2 CFs
    expect(rxOut.length).toBe(1); // 1 FC=CTS
    expect((txOut[0].data[0] >> 4) & 0xF).toBe(0x1); // FF
    expect((rxOut[0].data[0] >> 4) & 0xF).toBe(0x3); // FC
    expect((txOut[1].data[0] >> 4) & 0xF).toBe(0x2); // CF
    expect((txOut[2].data[0] >> 4) & 0xF).toBe(0x2); // CF
  });
});

describe('IsoTpStack — overflow on FF too large', () => {
  it('rx side replies FC=Overflow when FF length exceeds maxPayload', async () => {
    const cfg = defaultIsoTpConfig({ txId: 0x7E8, rxId: 0x7E0, maxPayload: 100 });
    const out: CanFrame[] = [];
    const errs: IsoTpError[] = [];
    const clock = new VirtualClock();
    const stack = new IsoTpStack(cfg, (f) => out.push(f), clock);
    stack.onError((e) => errs.push(e));

    // Inject a FF claiming 200 bytes (exceeds maxPayload=100)
    stack.onCanFrame({ id: 0x7E0, data: new Uint8Array([0x10, 0xC8, 1, 2, 3, 4, 5, 6]) });
    expect(errs.some((e) => e.kind === 'fc-overflow')).toBe(true);
    // Reply was FC=Overflow
    expect(out.length).toBe(1);
    expect(out[0].data[0]).toBe(0x32);
  });
});

describe('IsoTpStack — wrong sequence number', () => {
  it('emits wrong-sn error if CF arrives with wrong SN', async () => {
    const cfg = defaultIsoTpConfig({ txId: 0x7E8, rxId: 0x7E0 });
    const out: CanFrame[] = [];
    const errs: IsoTpError[] = [];
    const clock = new VirtualClock();
    const stack = new IsoTpStack(cfg, (f) => out.push(f), clock);
    stack.onError((e) => errs.push(e));

    // FF announcing 14 bytes (so 1 FF + 2 CFs)
    stack.onCanFrame({ id: 0x7E0, data: new Uint8Array([0x10, 14, 1, 2, 3, 4, 5, 6]) });
    clock.drain(100); // let FC fire
    // Send wrong SN (5 instead of 1)
    stack.onCanFrame({ id: 0x7E0, data: new Uint8Array([0x25, 7, 8, 9, 10, 11, 12, 13]) });
    expect(errs.some((e) => e.kind === 'wrong-sn')).toBe(true);
  });
});

describe('IsoTpStack — N_Cr timeout when CF doesnt arrive', () => {
  it('emits timeout-N_Cr if no CF after FF + FC', async () => {
    const cfg = defaultIsoTpConfig({ txId: 0x7E8, rxId: 0x7E0 });
    const errs: IsoTpError[] = [];
    const clock = new VirtualClock();
    const stack = new IsoTpStack(cfg, () => {}, clock);
    stack.onError((e) => errs.push(e));

    stack.onCanFrame({ id: 0x7E0, data: new Uint8Array([0x10, 14, 1, 2, 3, 4, 5, 6]) });
    clock.tick(100); // FC sent
    clock.tick(2000); // wait beyond N_Cr=1000
    expect(errs.some((e) => e.kind === 'timeout-N_Cr')).toBe(true);
  });
});

describe('IsoTpStack — N_Bs timeout when FC never arrives', () => {
  it('rejects sendBuffer with timeout-N_Bs when no FC', async () => {
    const cfg = defaultIsoTpConfig({ txId: 0x7E0, rxId: 0x7E8 });
    const out: CanFrame[] = [];
    const clock = new VirtualClock();
    const stack = new IsoTpStack(cfg, (f) => out.push(f), clock);

    const p = stack.sendBuffer(new Uint8Array(20));
    let caught: IsoTpError | null = null;
    p.catch((e) => { caught = e; });
    clock.tick(2000); // beyond N_Bs=1000
    await Promise.resolve();
    expect(caught?.kind).toBe('timeout-N_Bs');
  });
});
