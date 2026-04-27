// ============================================================
// UDS server tests — service-by-service
// ============================================================
import { describe, expect, it } from 'vitest';
import {
  UdsServer,
  defaultUdsServerConfig,
  defaultDidMap,
  SID,
  NRC,
  buildSessionControlReq,
  buildEcuResetReq,
  buildReadDidReq,
  buildReadMemoryReq,
  buildSecurityAccessSeedReq,
  buildSecurityAccessKeyReq,
  buildTesterPresentReq,
  buildRequestDownloadReq,
  buildTransferDataReq,
  buildRequestTransferExitReq,
  buildEraseMemoryReq,
} from '../lib/uds';
import { BootloaderState, weakComputeKey } from '../lib/bootloader';

function mkServer(): { server: UdsServer; boot: BootloaderState } {
  const boot = new BootloaderState();
  const dids = defaultDidMap({ vin: 'TEST1234567890ABC', partNumber: 'PART-001', bootSoftwareId: 'BOOT-1.0' });
  const server = new UdsServer(defaultUdsServerConfig(boot, dids));
  return { server, boot };
}

describe('UDS 0x10 DiagnosticSessionControl', () => {
  it('positive response for sub 01..04', () => {
    const { server } = mkServer();
    for (const sub of [0x01, 0x02, 0x03, 0x04]) {
      const r = server.handleRequest(buildSessionControlReq(sub));
      expect(r[0]).toBe(0x50); // SID + 0x40
      expect(r[1]).toBe(sub);
      expect(r.length).toBe(6); // sub + P2 (2B) + P2* (2B)
    }
  });

  it('NRC 0x12 for unsupported sub', () => {
    const { server } = mkServer();
    const r = server.handleRequest(buildSessionControlReq(0x55));
    expect(r[0]).toBe(0x7F);
    expect(r[1]).toBe(SID.DiagnosticSessionControl);
    expect(r[2]).toBe(NRC.subFunctionNotSupported);
  });

  it('switching to programming activates bootloader', () => {
    const { server, boot } = mkServer();
    server.handleRequest(buildSessionControlReq(0x02));
    expect(boot.isActive()).toBe(true);
  });

  it('SPR bit suppresses positive response', () => {
    const { server } = mkServer();
    const r = server.handleRequest(buildSessionControlReq(0x02 | 0x80));
    expect(r.length).toBe(0);
  });
});

describe('UDS 0x11 ECUReset', () => {
  it('positive for sub 01..05', () => {
    const { server } = mkServer();
    for (const sub of [0x01, 0x02, 0x03, 0x04, 0x05]) {
      const r = server.handleRequest(buildEcuResetReq(sub));
      expect(r[0]).toBe(0x51);
      expect(r[1]).toBe(sub);
    }
  });

  it('NRC for unsupported sub', () => {
    const { server } = mkServer();
    const r = server.handleRequest(buildEcuResetReq(0x42));
    expect(r[2]).toBe(NRC.subFunctionNotSupported);
  });

  it('keyOffOn (sub 0x02) lands in bootloader mode', () => {
    const { server, boot } = mkServer();
    server.handleRequest(buildEcuResetReq(0x02));
    expect(boot.isActive()).toBe(true);
  });
});

describe('UDS 0x22 ReadDataByIdentifier', () => {
  it('returns DID data for known DID', () => {
    const { server } = mkServer();
    const r = server.handleRequest(buildReadDidReq(0xF190)); // VIN
    expect(r[0]).toBe(0x62);
    expect(r[1]).toBe(0xF1);
    expect(r[2]).toBe(0x90);
    expect(new TextDecoder().decode(r.slice(3))).toBe('TEST1234567890ABC');
  });

  it('NRC 0x31 for unknown DID', () => {
    const { server } = mkServer();
    const r = server.handleRequest(buildReadDidReq(0xDEAD));
    expect(r[2]).toBe(NRC.requestOutOfRange);
  });

  it('multi-DID concatenated', () => {
    const { server } = mkServer();
    const r = server.handleRequest(buildReadDidReq(0xF190, 0xF180));
    expect(r[0]).toBe(0x62);
    // first record DID + data length, then second
    expect(r[1]).toBe(0xF1); expect(r[2]).toBe(0x90);
  });
});

describe('UDS 0x23 ReadMemoryByAddress', () => {
  it('NRC 0x33 if not unlocked', () => {
    const { server } = mkServer();
    server.handleRequest(buildSessionControlReq(0x02));
    const r = server.handleRequest(buildReadMemoryReq(0, 16, 4, 2));
    expect(r[2]).toBe(NRC.securityAccessDenied);
  });

  it('returns memory bytes when unlocked in bootloader', () => {
    const { server } = mkServer();
    server.handleRequest(buildSessionControlReq(0x02));
    // SecurityAccess dance
    const seedResp = server.handleRequest(buildSecurityAccessSeedReq(1));
    const seed = seedResp.slice(2);
    const key = weakComputeKey(seed);
    server.handleRequest(buildSecurityAccessKeyReq(1, key));
    const r = server.handleRequest(buildReadMemoryReq(0, 16, 4, 2));
    expect(r[0]).toBe(0x63);
    expect(r.length).toBe(17);
    expect(r[1]).toBe(0xAA); // firmware magic byte 0
  });

  it('NRC 0x13 on length mismatch', () => {
    const { server } = mkServer();
    server.handleRequest(buildSessionControlReq(0x02));
    // Malformed: ALFID says 4 addr + 2 size = 6 extra bytes, but we send only 3
    const r = server.handleRequest(new Uint8Array([0x23, 0x24, 1, 2, 3]));
    expect(r[2]).toBe(NRC.incorrectMessageLengthOrInvalidFormat);
  });
});

describe('UDS 0x27 SecurityAccess', () => {
  it('seed/key dance unlocks', () => {
    const { server, boot } = mkServer();
    server.handleRequest(buildSessionControlReq(0x02));
    const sr = server.handleRequest(buildSecurityAccessSeedReq(1));
    expect(sr[0]).toBe(0x67);
    expect(sr[1]).toBe(1);
    const seed = sr.slice(2);
    const key = weakComputeKey(seed);
    const kr = server.handleRequest(buildSecurityAccessKeyReq(1, key));
    expect(kr[0]).toBe(0x67);
    expect(kr[1]).toBe(2);
    expect(boot.isUnlocked()).toBe(true);
  });

  it('wrong key returns NRC 0x35 invalidKey', () => {
    const { server } = mkServer();
    server.handleRequest(buildSessionControlReq(0x02));
    server.handleRequest(buildSecurityAccessSeedReq(1));
    const r = server.handleRequest(buildSecurityAccessKeyReq(1, new Uint8Array([0, 0])));
    expect(r[2]).toBe(NRC.invalidKey);
  });

  it('zero-seed returned when already unlocked', () => {
    const { server } = mkServer();
    server.handleRequest(buildSessionControlReq(0x02));
    const sr = server.handleRequest(buildSecurityAccessSeedReq(1));
    server.handleRequest(buildSecurityAccessKeyReq(1, weakComputeKey(sr.slice(2))));
    const sr2 = server.handleRequest(buildSecurityAccessSeedReq(1));
    expect(Array.from(sr2.slice(2))).toEqual([0, 0]);
  });
});

describe('UDS 0x3E TesterPresent', () => {
  it('positive for sub 0', () => {
    const { server } = mkServer();
    const r = server.handleRequest(buildTesterPresentReq(false));
    expect(r[0]).toBe(0x7E);
    expect(r[1]).toBe(0x00);
  });

  it('SPR bit suppresses positive response', () => {
    const { server } = mkServer();
    const r = server.handleRequest(buildTesterPresentReq(true));
    expect(r.length).toBe(0);
  });
});

describe('UDS 0x34/0x36/0x37 download/transfer/exit', () => {
  function unlock() {
    const { server, boot } = mkServer();
    server.handleRequest(buildSessionControlReq(0x02));
    const sr = server.handleRequest(buildSecurityAccessSeedReq(1));
    server.handleRequest(buildSecurityAccessKeyReq(1, weakComputeKey(sr.slice(2))));
    return { server, boot };
  }

  it('full programming cycle commits 8 bytes to flash', () => {
    const { server, boot } = unlock();
    const dl = server.handleRequest(buildRequestDownloadReq(0, 8));
    expect(dl[0]).toBe(0x74);
    const td1 = server.handleRequest(buildTransferDataReq(1, new Uint8Array([0xDE, 0xAD, 0xBE, 0xEF])));
    expect(td1[0]).toBe(0x76);
    const td2 = server.handleRequest(buildTransferDataReq(2, new Uint8Array([0xCA, 0xFE, 0xF0, 0x0D])));
    expect(td2[0]).toBe(0x76);
    const ex = server.handleRequest(buildRequestTransferExitReq());
    expect(ex[0]).toBe(0x77);
    const back = boot.readMemory(0, 8);
    expect(Array.from(back!)).toEqual([0xDE, 0xAD, 0xBE, 0xEF, 0xCA, 0xFE, 0xF0, 0x0D]);
  });

  it('NRC for download without security', () => {
    const { server } = mkServer();
    server.handleRequest(buildSessionControlReq(0x02));
    const r = server.handleRequest(buildRequestDownloadReq(0, 8));
    expect(r[2]).toBe(NRC.securityAccessDenied);
  });
});

describe('UDS 0x31 RoutineControl eraseMemory (0xFF00)', () => {
  it('erases a range when unlocked', () => {
    const { server, boot } = mkServer();
    server.handleRequest(buildSessionControlReq(0x02));
    const sr = server.handleRequest(buildSecurityAccessSeedReq(1));
    server.handleRequest(buildSecurityAccessKeyReq(1, weakComputeKey(sr.slice(2))));
    const r = server.handleRequest(buildEraseMemoryReq(0, 16));
    expect(r[0]).toBe(0x71);
    expect(r[1]).toBe(0x01);
    expect(r[2]).toBe(0xFF); expect(r[3]).toBe(0x00);
    const back = boot.readMemory(0, 16);
    expect(Array.from(back!).every((b) => b === 0xFF)).toBe(true);
  });
});

describe('UDS unknown service', () => {
  it('NRC 0x11 serviceNotSupported', () => {
    const { server } = mkServer();
    const r = server.handleRequest(new Uint8Array([0xFF]));
    expect(r[2]).toBe(NRC.serviceNotSupported);
  });
});
