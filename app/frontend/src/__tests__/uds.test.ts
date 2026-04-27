// UDS server tests (ISO 14229)

import { describe, it, expect } from 'vitest';
import { BootloaderState } from '../lib/bootloader';
import {
  UdsServer,
  UDS_NRC,
  UDS_SID,
  bytesToHex,
  bytesToU32,
  defaultComputeKey,
  hexToBytes,
  u32ToBytes,
} from '../lib/uds';

function dids() {
  const enc = (s: string) => new TextEncoder().encode(s);
  return {
    F190: enc('TESTVIN1234567890'),
    F18C: enc('SN123456'),
    F191: enc('HW1'),
    F187: enc('PN0001'),
  };
}

function makeServer() {
  const bl = new BootloaderState();
  const srv = new UdsServer({ bootloader: bl, dids: dids() });
  return { srv, bl };
}

describe('UDS 0x10 DiagnosticSessionControl', () => {
  it('switches to extended session and returns timing parameters', () => {
    const { srv } = makeServer();
    const resp = srv.handleRequest(Uint8Array.from([UDS_SID.DiagnosticSessionControl, 0x03]))!;
    expect(resp[0]).toBe(0x50);
    expect(resp[1]).toBe(0x03);
    expect(srv.getSession()).toBe('extended');
    expect(resp.length).toBe(6);
  });

  it('rejects unknown sub-function with NRC=0x12', () => {
    const { srv } = makeServer();
    const resp = srv.handleRequest(Uint8Array.from([UDS_SID.DiagnosticSessionControl, 0x99]))!;
    expect(resp[0]).toBe(0x7f);
    expect(resp[2]).toBe(UDS_NRC.subFunctionNotSupported);
  });

  it('switching sessions resets security level to 0', () => {
    const { srv } = makeServer();
    srv.handleRequest(Uint8Array.from([UDS_SID.DiagnosticSessionControl, 0x03]));
    const seedResp = srv.handleRequest(Uint8Array.from([UDS_SID.SecurityAccess, 0x01]))!;
    const seed = seedResp.slice(2);
    const key = u32ToBytes(defaultComputeKey(new Uint32Array([bytesToU32(seed)]))[0]);
    srv.handleRequest(Uint8Array.from([UDS_SID.SecurityAccess, 0x02, ...key]));
    expect(srv.getSecurityLevel()).toBe(1);
    srv.handleRequest(Uint8Array.from([UDS_SID.DiagnosticSessionControl, 0x02]));
    expect(srv.getSecurityLevel()).toBe(0);
  });
});

describe('UDS 0x11 ECUReset', () => {
  it('hardReset (sub 0x01) returns to default session, application mode', () => {
    const { srv, bl } = makeServer();
    bl.enterBootloader();
    const resp = srv.handleRequest(Uint8Array.from([UDS_SID.ECUReset, 0x01]))!;
    expect(resp[0]).toBe(0x51);
    expect(resp[1]).toBe(0x01);
    expect(bl.isActive()).toBe(false);
    expect(srv.getSession()).toBe('default');
  });

  it('keyOffOn (sub 0x02) enters bootloader and programming session', () => {
    const { srv, bl } = makeServer();
    const resp = srv.handleRequest(Uint8Array.from([UDS_SID.ECUReset, 0x02]))!;
    expect(resp[0]).toBe(0x51);
    expect(bl.isActive()).toBe(true);
    expect(srv.getSession()).toBe('programming');
  });

  it('hardReset within programming session also enters bootloader', () => {
    const { srv, bl } = makeServer();
    srv.handleRequest(Uint8Array.from([UDS_SID.DiagnosticSessionControl, 0x02]));
    srv.handleRequest(Uint8Array.from([UDS_SID.ECUReset, 0x01]));
    expect(bl.isActive()).toBe(true);
  });

  it('rejects out-of-range sub-function', () => {
    const { srv } = makeServer();
    const resp = srv.handleRequest(Uint8Array.from([UDS_SID.ECUReset, 0x77]))!;
    expect(resp[0]).toBe(0x7f);
    expect(resp[2]).toBe(UDS_NRC.subFunctionNotSupported);
  });
});

describe('UDS 0x22 ReadDataByIdentifier', () => {
  it('returns DID payload for VIN (F190)', () => {
    const { srv } = makeServer();
    const resp = srv.handleRequest(Uint8Array.from([UDS_SID.ReadDataByIdentifier, 0xf1, 0x90]))!;
    expect(resp[0]).toBe(0x62);
    expect(resp[1]).toBe(0xf1);
    expect(resp[2]).toBe(0x90);
    const text = new TextDecoder().decode(resp.slice(3));
    expect(text).toBe('TESTVIN1234567890');
  });

  it('returns NRC=0x31 for unknown DID', () => {
    const { srv } = makeServer();
    const resp = srv.handleRequest(Uint8Array.from([UDS_SID.ReadDataByIdentifier, 0xfa, 0xfa]))!;
    expect(resp[0]).toBe(0x7f);
    expect(resp[2]).toBe(UDS_NRC.requestOutOfRange);
  });
});

describe('UDS 0x27 SecurityAccess', () => {
  function setupExtended() {
    const m = makeServer();
    m.srv.handleRequest(Uint8Array.from([UDS_SID.DiagnosticSessionControl, 0x03]));
    return m;
  }

  it('seed/key flow unlocks the server', () => {
    const { srv } = setupExtended();
    const seedResp = srv.handleRequest(Uint8Array.from([UDS_SID.SecurityAccess, 0x01]))!;
    expect(seedResp[0]).toBe(0x67);
    expect(seedResp[1]).toBe(0x01);
    const seed = seedResp.slice(2);
    expect(seed.length).toBe(4);
    const expectedKey = u32ToBytes(defaultComputeKey(new Uint32Array([bytesToU32(seed)]))[0]);
    const keyResp = srv.handleRequest(
      Uint8Array.from([UDS_SID.SecurityAccess, 0x02, ...expectedKey]),
    )!;
    expect(keyResp[0]).toBe(0x67);
    expect(keyResp[1]).toBe(0x02);
    expect(srv.getSecurityLevel()).toBe(1);
  });

  it('returns NRC=0x35 when invalid key is sent', () => {
    const { srv } = setupExtended();
    srv.handleRequest(Uint8Array.from([UDS_SID.SecurityAccess, 0x01]));
    const resp = srv.handleRequest(
      Uint8Array.from([UDS_SID.SecurityAccess, 0x02, 0x00, 0x00, 0x00, 0x00]),
    )!;
    expect(resp[0]).toBe(0x7f);
    expect(resp[2]).toBe(UDS_NRC.invalidKey);
    expect(srv.getSecurityLevel()).toBe(0);
  });

  it('rejects sendKey before requestSeed (sequence error)', () => {
    const { srv } = setupExtended();
    const resp = srv.handleRequest(
      Uint8Array.from([UDS_SID.SecurityAccess, 0x02, 1, 2, 3, 4]),
    )!;
    expect(resp[0]).toBe(0x7f);
    expect(resp[2]).toBe(UDS_NRC.requestSequenceError);
  });

  it('rejects when in default session (conditionsNotCorrect)', () => {
    const { srv } = makeServer();
    const resp = srv.handleRequest(Uint8Array.from([UDS_SID.SecurityAccess, 0x01]))!;
    expect(resp[0]).toBe(0x7f);
    expect(resp[2]).toBe(UDS_NRC.conditionsNotCorrect);
  });
});

describe('UDS 0x23 ReadMemoryByAddress', () => {
  function setupUnlocked() {
    const m = makeServer();
    m.srv.handleRequest(Uint8Array.from([UDS_SID.DiagnosticSessionControl, 0x03]));
    const seedResp = m.srv.handleRequest(Uint8Array.from([UDS_SID.SecurityAccess, 0x01]))!;
    const seed = seedResp.slice(2);
    const key = u32ToBytes(defaultComputeKey(new Uint32Array([bytesToU32(seed)]))[0]);
    m.srv.handleRequest(Uint8Array.from([UDS_SID.SecurityAccess, 0x02, ...key]));
    return m;
  }

  it('returns the requested chunk for a valid address range', () => {
    const { srv, bl } = setupUnlocked();
    const req = new Uint8Array([
      UDS_SID.ReadMemoryByAddress,
      0x44,
      0, 0, 0, 0,
      0, 0, 0, 64,
    ]);
    const resp = srv.handleRequest(req)!;
    expect(resp[0]).toBe(0x63);
    expect(resp.length).toBe(1 + 64);
    expect(resp[1]).toBe(0x55);
    expect(resp[2]).toBe(0xaa);
    expect(resp.slice(1)).toEqual(bl.readMemory(0, 64));
  });

  it('returns NRC=0x33 (securityAccessDenied) when locked', () => {
    const { srv } = makeServer();
    srv.handleRequest(Uint8Array.from([UDS_SID.DiagnosticSessionControl, 0x03]));
    const req = new Uint8Array([UDS_SID.ReadMemoryByAddress, 0x44, 0, 0, 0, 0, 0, 0, 0, 16]);
    const resp = srv.handleRequest(req)!;
    expect(resp[0]).toBe(0x7f);
    expect(resp[2]).toBe(UDS_NRC.securityAccessDenied);
  });

  it('returns NRC=0x31 for out-of-range address', () => {
    const { srv } = setupUnlocked();
    const req = new Uint8Array([
      UDS_SID.ReadMemoryByAddress,
      0x44,
      0xff, 0xff, 0xff, 0x00,
      0, 0, 0, 16,
    ]);
    const resp = srv.handleRequest(req)!;
    expect(resp[0]).toBe(0x7f);
    expect(resp[2]).toBe(UDS_NRC.requestOutOfRange);
  });

  it('reads a chunk that crosses the 1KB boundary', () => {
    const { srv, bl } = setupUnlocked();
    const addr = 1000;
    const size = 100;
    const req = new Uint8Array([
      UDS_SID.ReadMemoryByAddress,
      0x44,
      0, 0, (addr >> 8) & 0xff, addr & 0xff,
      0, 0, (size >> 8) & 0xff, size & 0xff,
    ]);
    const resp = srv.handleRequest(req)!;
    expect(resp[0]).toBe(0x63);
    expect(resp.slice(1)).toEqual(bl.readMemory(addr, size));
  });
});

describe('UDS 0x3E TesterPresent', () => {
  it('responds 7E 00 to standard request', () => {
    const { srv } = makeServer();
    const resp = srv.handleRequest(Uint8Array.from([UDS_SID.TesterPresent, 0x00]))!;
    expect(resp[0]).toBe(0x7e);
    expect(resp[1]).toBe(0x00);
  });

  it('returns null when suppressPosRsp bit is set', () => {
    const { srv } = makeServer();
    const resp = srv.handleRequest(Uint8Array.from([UDS_SID.TesterPresent, 0x80]));
    expect(resp).toBeNull();
  });
});

describe('UDS unknown SID', () => {
  it('returns NRC=0x11 for unsupported service', () => {
    const { srv } = makeServer();
    const resp = srv.handleRequest(Uint8Array.from([0x99, 0x00]))!;
    expect(resp[0]).toBe(0x7f);
    expect(resp[2]).toBe(UDS_NRC.serviceNotSupported);
  });
});

describe('hex helpers', () => {
  it('bytesToHex round-trips with hexToBytes', () => {
    const original = Uint8Array.from([0x10, 0x03, 0xfe, 0x42, 0xab]);
    const txt = bytesToHex(original);
    expect(txt).toBe('10 03 FE 42 AB');
    const parsed = hexToBytes(txt);
    expect(parsed).toEqual(original);
  });
});
