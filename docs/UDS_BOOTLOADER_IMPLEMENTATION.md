# UDS / ISO-TP / Bootloader implementation

**Branch:** `feat/uds-isotp-bootloader-research`
**Author:** Marcelo Duchene (USP/ICMC) — Mestrado Engenharia de Computação
**Last updated:** 2026-04-27

This document describes the multi-frame UDS, ISO-TP, and bootloader emulation
layer added to ECU-HybridLab, the testbed used in the dissertation case-study
chapter to reproduce the Ford / VW T-Cross firmware extraction kill chain.

---

## 1. Architecture overview

```
+--------------------------------------------------------+
|  React UI (Dashboard, KillChain panel, CAN monitor)    |
+--------------------------------------------------------+
                       |
                       v
+--------------------------------------------------------+
|  ECUSimulator (in-process state)                       |
|     +-- bootloader: BootloaderState                    |
|     +-- udsServer:  UdsServer                          |
|     +-- udsServerIsoTp: IsoTpStack (server side)       |
|     +-- udsClientIsoTp: IsoTpStack (tester side)       |
|     +-- udsClient:  UdsClient                          |
|     +-- buildKillChain() / runKillChain() helpers      |
+--------------------------------------------------------+
                       |
        loopback CAN frames (0x7E0 / 0x7E8)
                       |
+--------------------------------------------------------+
|  ISO 15765-2 transport layer                           |
|     +-- SF / FF / CF / FC frame builders + parsers     |
|     +-- TX state machine (BS / STmin / N_Bs / N_Cs)    |
|     +-- RX state machine (sequence check, N_Cr)        |
|     +-- Injectable Clock (WallClock / VirtualClock)    |
+--------------------------------------------------------+
                       |
+--------------------------------------------------------+
|  ISO 14229-1 application layer (UdsServer)             |
|     0x10 0x11 0x14 0x19 0x22 0x23 0x27                |
|     0x2E 0x31 0x34 0x36 0x37 0x3E                     |
+--------------------------------------------------------+
                       |
+--------------------------------------------------------+
|  Bootloader emulator                                   |
|     +-- 5-region memory map (app_flash / cal / vin /   |
|         ram / boot_info)                                |
|     +-- Synthetic 512 KiB firmware (deterministic LCG) |
|     +-- Security profile (weak / hardened) selectable  |
|     +-- Audit trail (every read / write / SA event)    |
|     +-- Download session (0x34 / 0x36 / 0x37)          |
+--------------------------------------------------------+
```

All four layers (transport, application, bootloader, kill chain) live entirely
in TypeScript inside the browser bundle — no native dependency, no Web Serial.
Tests run under Vitest in a Node environment with a virtual clock.

---

## 2. Spec coverage matrix

| Spec | Section | Implemented? | Notes |
|---|---|---|---|
| ISO 15765-2:2016 §6.4.2 PCI types (SF/FF/CF/FC) | full | yes | |
| ISO 15765-2:2016 §6.5.4 Block size + STmin | full | yes | BS=0 stream, STmin µs range 0xF1..0xF9 |
| ISO 15765-2:2016 §6.5.5 Flow status (CTS/Wait/Overflow) | full | yes | |
| ISO 15765-2:2016 §6.5.6 Timeouts N_As/N_Ar/N_Bs/N_Br/N_Cs/N_Cr | partial | yes (N_Bs, N_Cs, N_Br, N_Cr); N_As/N_Ar collapsed (no real bus) | |
| ISO 14229-1:2020 §10 DiagnosticSessionControl 0x10 | full | yes | subs 01..04, P2 timing |
| ISO 14229-1:2020 §11 ECUReset 0x11 | full | yes | subs 01..05 |
| ISO 14229-1:2020 §22 ClearDTC 0x14 | partial | yes | accepts any group, clears all |
| ISO 14229-1:2020 §22 ReadDTCInformation 0x19 | partial | yes | sub 0x02 byStatusMask only |
| ISO 14229-1:2020 §22 ReadDataByIdentifier 0x22 | full | yes | multi-DID concat |
| ISO 14229-1:2020 §22 ReadMemoryByAddress 0x23 | full | yes | ALFID encoded |
| ISO 14229-1:2020 §11 SecurityAccess 0x27 | full | yes | weak (16-bit) and hardened (32-bit) profiles |
| ISO 14229-1:2020 §22 WriteDataByIdentifier 0x2E | full | yes | requires unlock |
| ISO 14229-1:2020 §22 RoutineControl 0x31 | partial | yes | sub 01 + 0xFF00 eraseMemory; other routines accept generic positive |
| ISO 14229-1:2020 §22 RequestDownload 0x34 | full | yes | needs programming session + unlock |
| ISO 14229-1:2020 §22 TransferData 0x36 | full | yes | sequence counter check |
| ISO 14229-1:2020 §22 RequestTransferExit 0x37 | full | yes | size verification |
| ISO 14229-1:2020 §11 TesterPresent 0x3E | full | yes | SPR bit honoured |
| ISO 14229-1:2020 §6.3.6 NRC priority order | full | yes | length → sub → session → security → range |

NRCs implemented: 0x10, 0x11, 0x12, 0x13, 0x14, 0x21, 0x22, 0x24, 0x31, 0x33,
0x35, 0x36, 0x37, 0x70, 0x71, 0x72, 0x73, 0x78, 0x7F.

---

## 3. Reference implementations consulted

Compiled from `sources/research_uds_*.md` (perplexity-sonar-pro, parallel-search,
scopus). Each design decision below is annotated with the reference that
informed it.

| Reference | Lang | Used for | Citation |
|---|---|---|---|
| Linux kernel `can-isotp` | C | STmin encoding (0x00..0x7F ms; 0xF1..0xF9 µs), BS=0 stream semantics | `Documentation/networking/iso15765-2.rst` |
| Hartkopp 2015 (CAN-CIA) | paper | Throughput tuning targets for 500 kbit/s and CAN-FD | `can-cia.org/.../2015_hartkopp.pdf` |
| openxc/isotp-c | C | SF/FF/CF state machine reference | github.com/openxc/isotp-c |
| astand/uds-to-go | C++ | "no-dynamic-alloc" memory model inspiration for our state machine | github.com/astand/uds-to-go |
| ecubus/EcuBus-Pro | TypeScript | Closest existing TS UDS impl; informed our service catalog | github.com/ecubus/EcuBus-Pro |
| AUTOSAR_SWS_Diagnostics R18-10 | spec | NRC priority order; positive response format for 0x10 | autosar.org |
| Daily 2017 (Colorado State) | paper | Documented the weak XOR+rotate seed/key pattern (our Pattern B) | `engr.colostate.edu/~jdaily/.../2017 Seed Key Exchange.pdf` |
| Hooovahh 2020 | blog | Heavy-vehicle ECU seed/key reverse-engineering examples | hooovahh.blogspot.com |
| Auto-ISAC ATM-T0033 | threat matrix | "Defeat UDS SecurityAccess" technique chain | atm.automotiveisac.com |
| Lauser 2024 (CSCS '24) | paper | Threat model for the dissertation case study | DOI 10.1145/3689936.3694695 |
| Çelik 2024 (SAE 2024-01-2799) | paper | Inspired our fuzz-style edge-case tests | DOI 10.4271/2024-01-2799 |
| Matsubayashi 2021 (IEEE VTC) | paper | DoIP variant of UDS attacks (we cite to position our CAN focus) | DOI 10.1109/VTC2021-Spring51267.2021.9448963 |
| Gomez Buquerin 2021 | paper | Forensics-friendly CAN log format (BRAIN CSV) | DOI 10.1016/j.fsidi.2021.301111 |

---

## 4. State-of-the-art positioning

Based on the Scopus query
`TITLE-ABS-KEY("UDS" OR "Unified Diagnostic Services") AND security AND PUBYEAR > 2019`,
the following gap analysis informs our contribution:

- **No browser-native open-source UDS testbed exists.** EcuBus-Pro (TypeScript)
  is the closest, but it is an Electron desktop app, not a teaching/research
  tool that runs in any browser. ECU-HybridLab fills this gap.
- **No academic testbed targets the Brazilian fleet.** Our integration with the
  BRAIN dataset (5 Brazilian vehicles — see dissertation Cap 4) is novel.
- **Few testbeds expose threat-model knobs.** Our `securityProfile: weak |
  hardened` toggle lets the *same* testbed serve both attack reproduction
  (case study, Cap 6) and countermeasure research (IDS, Cap 5).
- **CSV log format compatibility.** Our BRAIN-style CSV output (`timestamp_us,
  can_id, direction, dlc, data_hex, decoded_uds_service`) is directly
  consumable by the dissertation IDS pipelines.

---

## 5. Differentiated design decisions

### 5.1 Injectable clock (testability)

The ISO-TP stack accepts a `Clock` abstraction. Production uses
`WallClock` (real `setTimeout`). Tests use `VirtualClock` which exposes
`tick(ms)` and `drain(ms)` to advance time deterministically. This makes
the timeout state machine (N_Bs, N_Cs, N_Br, N_Cr) **fully unit-testable
without sleeping the test thread**.

Vitest test that exercises N_Cr timeout:
```ts
const clock = new VirtualClock();
const stack = new IsoTpStack(cfg, () => {}, clock);
stack.onError((e) => errs.push(e));
stack.onCanFrame({ id: 0x7E0, data: new Uint8Array([0x10, 14, ...]) });
clock.tick(2000); // beyond N_Cr=1000 → emits timeout-N_Cr
```

### 5.2 Threat model: weak vs hardened SecurityAccess

Two algorithms ship out of the box (`bootloader.ts`):

- **`weakComputeKey(seed)` — Pattern B from the literature.**
  `key = rotate_left(seed XOR 0xC0DE, seed[0] & 0x0F)`. 16-bit seeds, 16-bit
  keys. Recoverable from ~256 captured (seed, key) pairs by a passive observer.
  This is the model we use in the dissertation case-study chapter.
- **`hardenedComputeKey(seed, sharedKey)` — 64-round Davies-Meyer-style mixer
  over a 16-byte shared key.** Not a real cryptographic hash (we keep
  zero-dependency), but sufficient to demonstrate "high entropy ⇒ brute force
  infeasible" experiments.

The bootloader's `cfg.security.profile` selects which algorithm is in force.
The kill-chain orchestrator queries this and computes the right key
automatically.

### 5.3 Three kill-chain scenarios

`KillChainOrchestrator` accepts `scenario: 'fast' | 'realistic' | 'brute-force'`.

- **fast** — minimal pacing, intended for CI/test (4 KiB dump in ~2 s).
- **realistic** — 5 ms STmin, OEM-default P2 delays, designed to match the ~50
  s wall clock of the published Ford T-Cross attack.
- **brute-force** — repeatedly issues 0x27 with random keys, generating high-
  volume traffic suitable for IDS training data (dissertation Cap 5). Falls
  back to honest derivation after `bruteForceMaxAttempts` if the randoms
  never hit.

### 5.4 Per-phase metrics

Every phase tracks `requests`, `bytesIn`, `bytesOut`, `durationMs`. The
report exposes them as `PhaseStats[]` and the UI surfaces them in the phase
ribbon as tooltips. This is what powers the throughput tables in the
dissertation Cap 6 results.

### 5.5 Memory map with declarative permissions

`bootloader.ts` exports a `DEFAULT_MEMORY_MAP: MemoryRegion[]` with five
regions (`app_flash`, `calibration`, `vin_block`, `ram`, `boot_info`), each
flagged `readApp / readBoot / writeBoot`. Reads in the wrong mode return
`null` (UDS layer translates to NRC 0x31 / 0x33). VIN block is read-only;
boot_info is read-only; app_flash is locked in app mode (the canonical kill
chain target).

### 5.6 BRAIN-compatible CSV format

`framesToCsv()` produces:
```
timestamp_us,can_id,direction,dlc,data_hex,decoded_uds_service
12345678,0x7E0,tx,8,0210000000000000,DSC
12345889,0x7E8,rx,8,5002003200C8AAAA,+DSC
...
```
This is the exact schema used by the BRAIN CAN traces in
`01_Dissertacao_e_Qualificacao/Dissertacao_mestrado/datasets/`.

---

## 6. Mapping to the dissertation case-study attack

| Real Ford / VW T-Cross step | ECU-HybridLab demo step |
|---|---|
| 1. Connect to OBD-II port, observe normal traffic | Phase 1 `conditioning` (passive 100–500 ms) |
| 2. Tester polls VIN, calibration ID via 0x22 | Phase 2 `recon` (sweep DIDs 0xF180, 0xF181, 0xF187, 0xF18C, 0xF190, 0xF195) |
| 3. 0x10 02 enter programming session | Phase 3 `session` (0x10 03 then 0x10 02) |
| 4. 0x11 02 keyOffOn → ECU jumps to bootloader | Phase 4 `reset` (0x11 02, then 0x10 02 again post-boot) |
| 5. 0x27 01 seed; compute key; 0x27 02 key | Phase 5 `security` (honest dance OR brute force) |
| 6. Loop 0x23 ReadMemoryByAddress 4 KiB at a time | Phase 6 `dump` (configurable dump size + chunk size) |
| 7. 0x10 01 default; 0x11 03 soft reset; disconnect | Phase 7 `cleanup` (DSC default + ECUReset softReset) |

### Timing comparison

| Run | Wall clock | Frames |
|---|---|---|
| Real Ford T-Cross (published) | ~55 s | ~14 000 (estimated) |
| ECU-HybridLab `realistic` 64 KiB | TBD (~12 s) | TBD |
| ECU-HybridLab `realistic` 512 KiB | TBD (~80 s — slower than real bus due to in-process loopback overhead) | TBD |

Numbers TBD will be filled by running `node scripts/generate_uds_demo_logs.mjs`
(seeds the data/ folder with deterministic CSVs).

---

## 7. How to run the demo

### From the UI

```bash
cd app/frontend
npm install
npm run dev
# open http://localhost:5173
# → click the "KILL CHAIN" tab
# → choose scenario, dump size, chunk size
# → click "Run kill chain"
# → watch the phase ribbon, event log, frame table fill in
# → click "Download CSV" / "Download FW" / "Download JSON"
```

### Programmatically (Node)

```bash
cd ecu_simulator
npm install -g tsx       # or use `npx tsx`
node scripts/generate_uds_demo_logs.mjs
# → writes data/uds_demo_*.csv
```

### Unit tests

```bash
cd app/frontend
npm test                  # Vitest single run
npm run test:watch        # watch mode
```

---

## 8. Limitations and future work

- **No real CAN bus.** The two ISO-TP stacks loopback in-process via JavaScript
  Promises, so wall-clock timings are not directly comparable to real OBD-II
  measurements. They are *qualitatively* faithful (frame ordering, latency
  ordering, NRC behaviour) but not *quantitatively* (real bus contention,
  ECU computation latency, bus arbitration overhead are absent).
- **CAN-FD not modelled.** Classical CAN with 8-byte DLC only. CAN-FD with
  64-byte DLC would change throughput numbers significantly (Hartkopp 2015).
- **Single ECU.** Multi-ECU concurrent sessions (mux on different IDs) are
  out of scope for this demo. The CAN ID configuration is mutable
  (`setUdsCanIds`) but only one server runs at a time.
- **Hardened mode is research-grade only.** The "hardened" mixer is *not* a
  cryptographic hash. Real hardened ECUs use AES-128-CMAC over (seed || nonce)
  with a chip-fused key. Treat the hardened mode as a "what if entropy were
  actually high" experiment, not as a security proof.
- **No DoIP support.** This is CAN-only. Matsubayashi 2021 documents DoIP
  attack variants and would be a natural follow-up if the dissertation needs
  to extend beyond CAN.

---

## 9. References (verified via mcp__research__perplexity_search and Scopus)

Research notes saved under
`01_Dissertacao_e_Qualificacao/Dissertacao_mestrado/sources/`:

- `research_uds_20260426_233646_real_world_attacks.md`
- `research_uds_20260426_233646_service_0x23_alfid.md`
- `research_uds_20260426_233646_implementations_compared.md`
- `research_uds_20260426_233646_security_access_algorithms.md`
- `research_uds_20260426_233646_throughput_optimization.md`
- `research_uds_20260426_233646_download_services.md`
- `research_uds_20260426_233646_testbed_landscape.md`

Plus the prior research note already shipped on the parent branch:
- `search_20260426_233000_iso15765_uds_specs.md`

Key academic citations:

- Lauser, T. (2024). "(Un)authenticated Diagnostic Services: A Practical
  Evaluation of Vulnerabilities in the UDS Authentication Service." CSCS '24
  (Cyber Security in Cars Workshop, co-located with CCS 2024). DOI
  10.1145/3689936.3694695.
- Lauser, T. (2023). "Formal Security Analysis of Vehicle Diagnostic
  Protocols." DOI 10.1145/3600160.3600184.
- Çelik, L. (2024). "Comparing Open-Source UDS Implementations Through Fuzz
  Testing." SAE 2024-01-2799.
- Matsubayashi, M. (2021). "Attacks against UDS on DoIP by Exploiting
  Diagnostic Communications and Their Countermeasures." IEEE
  VTC2021-Spring. DOI 10.1109/VTC2021-Spring51267.2021.9448963.
- Pełechaty, P. (2024). "Analysis of security vulnerabilities in vehicle
  on-board diagnostic systems." Diagnostyka. DOI 10.29354/diag/192162.
- Gomez Buquerin, K.K. (2021). "A generalized approach to automotive
  forensics." Forensic Science International Digital Investigation. DOI
  10.1016/j.fsidi.2021.301111.
- Hartkopp, O. (2015). "CAN-FD performance analysis for ISO 15765-2
  bootloaders." CAN in Automation conference proceedings.
- Daily, J. (2017). "Seed-Key Exchange — Reverse Engineering Diagnostic
  Authentication." Colorado State University presentation.

Specifications:

- ISO 15765-2:2016 (Road vehicles — Diagnostic communication over Controller
  Area Network — Part 2: Transport protocol and network layer services).
- ISO 14229-1:2020 (Road vehicles — Unified diagnostic services — Part 1:
  Application layer).
- AUTOSAR SWS Diagnostics R18-10 / R4.4.0 / R1.5.0.
