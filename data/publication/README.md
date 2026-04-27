# UDS Kill-Chain Reproduction Dataset — ECU-HybridLab

**Version:** v0.1 (seed dataset)
**Date:** 2026-04-27
**License:** CC-BY 4.0
**Authors:** Marcelo Duchene (USP/ICMC) — orientadora: Kalinka R. L. J. C. Branco
**DOI:** _to be assigned via Zenodo upon publication_

## Overview

This dataset contains CAN bus traces and synthetic firmware images produced by the **ECU-HybridLab** testbed reproducing the kill-chain documented in the master's dissertation case study:

```
bus conditioning → UDS 0x10 (DSC) → UDS 0x11 (ECU Reset) → bootloader entry →
  UDS 0x27 (SecurityAccess seed/key) → UDS 0x23 (ReadMemoryByAddress segmented) →
  firmware dump
```

The traces are reproducible runs of the kill-chain originally observed in **Ford instrument clusters** and replicated in a **Volkswagen T-Cross Highline 1.4 TSI 250** in field conditions during the dissertation work.

## Contents (seed v0.1)

```
data/publication/
├── README.md                  # this file
├── METHODOLOGY.md             # how each artifact was generated (TODO: expand)
├── CITATION.cff               # citation metadata
├── manifest.json              # SHA256 hashes
├── runs/                      # 50+ runs of the full kill-chain (TODO)
├── matrix/                    # bitrate × BS × STmin matrix (TODO)
├── edge_cases/                # 10+ negative/error scenarios (TODO)
├── brain_comparison/          # statistical comparison vs BRAIN corpus (TODO)
├── figures/                   # publication-ready plots (TODO)
└── seed_run/                  # → see ../uds_demo_*.csv
```

The **seed run** (`../uds_demo_*.csv` in repo root `data/`) is the first reproducible execution of the kill-chain, captured directly from `runKillChain()` orchestrator. It contains:

| File | Frames | Size | Content |
|---|---|---|---|
| `uds_demo_session_control.csv` | 8 | 600 B | Diagnostic Session Control (0x10) phase |
| `uds_demo_ecu_reset.csv` | 2 | 204 B | ECU Reset (0x11 sub 0x02) |
| `uds_demo_security_access.csv` | 4 | 370 B | SecurityAccess seed/key (0x27) |
| `uds_demo_firmware_dump.csv` | 75561 | 6.12 MB | ReadMemoryByAddress (0x23) segmented dump |
| `uds_demo_kill_chain_full.csv` | 75623 | 6.12 MB | Complete sequence in temporal order |
| `uds_demo_phase_summary.csv` | 7 | 669 B | Phase-by-phase timing summary |

CSV format (BRAIN-compatible):
```
timestamp_us,can_id,direction,dlc,data_hex,decoded_uds_service
```

## Reproducibility

### Requirements
- Node.js 20+ (tested with 24.12.0)
- `pnpm` 8.10.0 or `npm` 11+
- Optional: `tsx` for direct TypeScript execution (`npm install -g tsx`)

### Quick start
```bash
git clone https://github.com/wmarcelod/ecu_simulator.git
cd ecu_simulator
git checkout main  # after the merged branch lands
cd app/frontend
npm install      # or pnpm install
npm test         # runs 60+ Vitest tests covering ISO-TP, UDS, bootloader, kill-chain
npm run dev      # opens UI at http://localhost:5173 — go to "UDS KILL CHAIN" tab
```

### Generate fresh seed_run CSVs
```bash
cd ../..  # repo root
node scripts/generate_uds_demo_logs.mjs
# Outputs to data/uds_demo_*.csv
```

### Generate full publication dataset (TODO — expansion script needed)
```bash
node scripts/generate_publication_dataset.mjs --runs 50 --matrix --edge-cases
# Outputs to data/publication/{runs,matrix,edge_cases}/
```

## Comparison with field case-study

| Metric | Ford (real) | VW T-Cross (real) | ECU-HybridLab (default) | ECU-HybridLab (STmin=8 ms, BS=4) |
|---|---|---|---|---|
| Wall-clock total | ~55 s | ~58 s | 187 ms | ~50–60 s (configurable) |
| Frames exchanged | ~75 000 | ~75 000 | 75 623 | similar |
| UDS sequence | 0x10→0x11→0x10→0x27→0x23 loop | identical | identical | identical |
| Dump chunks | ~128 (4 KB) | ~128 (4 KB) | 129 (4094 B) | identical |

**Validity caveat:** the testbed reproduces the **structural sequence** of the attack, not its **cryptographic vulnerabilities**. SecurityAccess seed/key uses a deterministic toy algorithm (XOR + add); a real OEM seed/key challenge would resist the same brute-force.

## What's NOT in this dataset (yet)

The full publication-grade dataset is planned to include:

- [ ] **50+ statistical runs** (same scenario, different seeds, mean/median/IQR/IC95% via bootstrap)
- [ ] **24-config matrix:** {500, 250} kbps × {0, 4, 8, 16} BS × {0, 10, 50} ms STmin × 5 runs each = 120 runs
- [ ] **10+ edge cases:** timeout during CF, FC Wait/Overflow, sequence error, NRC 0x35/0x7E/0x78, ReadMemory bounds, tester disconnect
- [ ] **BRAIN comparison:** replicate UDS patterns from BRAIN corpus sessions and KS-test for statistical equivalence
- [ ] **Publication figures:** kill-chain duration histogram, ECDFs by phase, config × latency heatmap, sequence diagrams, BRAIN-vs-testbed scatter

These will be added once the testbed is deployed in production and the comprehensive test bench script (`scripts/generate_publication_dataset.mjs`) is run on a stable environment.

## Citation

```bibtex
@misc{duchene2026ecuhybridlab,
  author = {Duchene, Marcelo and Branco, Kalinka R. L. J. C.},
  title = {{ECU-HybridLab UDS Kill-Chain Dataset v0.1}},
  year = {2026},
  publisher = {Zenodo},
  note = {Reproduction of the bootloader-extraction attack from the dissertation case study},
  url = {https://github.com/wmarcelod/ecu_simulator},
  doi = {10.5281/zenodo.XXXXXX}
}
```

See `CITATION.cff` for the YAML-formatted citation metadata.

## License

Released under [Creative Commons Attribution 4.0 International (CC-BY 4.0)](https://creativecommons.org/licenses/by/4.0/).

## Acknowledgments

- Implementation: ECU-HybridLab branch `feat/uds-isotp-bootloader-research` (merged into `feat/uds-isotp-bootloader-merged` 2026-04-27)
- Verification: 52/52 + 60+ Vitest tests across iso-tp, uds, bootloader, kill-chain modules
- ISO 14229 / ISO 15765-2 spec consulted via `mcp__research__perplexity_search` and AUTOSAR R21-11 CanTransportLayer SWS
