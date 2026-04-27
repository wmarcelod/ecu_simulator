# UDS multiquadro + ISO-TP + bootloader emulado — implementacao no ECU-HybridLab

Branch: `feat/uds-isotp-bootloader`

Esta nota documenta as quatro camadas adicionadas ao testbed para reproduzir
a kill chain do estudo de caso da dissertacao (extracao de firmware via UDS
em Ford / VW T-Cross).

## 1. Visao arquitetural

```
                          +----------------------------------------+
                          |          UI: UdsKillChain              |
                          |   (botao "Run Kill Chain Demo")        |
                          +-------------------+--------------------+
                                              | runKillChain()
                                              v
       +----------------------------------------------------------+
       |                   kill-chain.ts (engine)                 |
       |  - cria 2 IsoTpStack (tester + ECU) com VirtualCanBus    |
       |  - executa fases 1..7 e produz log + firmware            |
       +-------+--------------------------------------------+-----+
               |                                            |
               v                                            v
        +-------------+                              +-------------+
        | IsoTpStack  |                              | IsoTpStack  |
        | (tester)    | <-- VirtualCanBus -- CAN --> | (ECU)       |
        +-------------+                              +------+------+
                                                            | UDS bytes
                                                            v
                                                   +-----------------+
                                                   |   UdsServer     |
                                                   |   (ISO 14229)   |
                                                   +--------+--------+
                                                            | readMemory()
                                                            v
                                                +------------------------+
                                                | BootloaderState        |
                                                | + image 512KB c/ magic |
                                                | 0xAA55 + ASCII tag     |
                                                +------------------------+
```

Arquivos criados:

- `app/frontend/src/lib/iso-tp.ts` (~680 linhas) - camada ISO 15765-2
- `app/frontend/src/lib/uds.ts` (~450 linhas) - camada ISO 14229
- `app/frontend/src/lib/bootloader.ts` (~200 linhas) - emulacao de bootloader
- `app/frontend/src/lib/kill-chain.ts` (~520 linhas) - orquestrador end-to-end
- `app/frontend/src/components/UdsKillChain.tsx` (~330 linhas) - UI da demo
- `app/frontend/src/__tests__/{iso-tp,uds,bootloader,kill-chain}.test.ts` - 52 testes
- `app/frontend/scripts/generate-uds-captures.ts` - gerador de CSVs

Arquivos modificados:

- `app/frontend/src/lib/ecu-simulator.ts` - instancia BootloaderState +
  UdsServer + IsoTpStack; expoe `processIsoTpCanFrame()`, `onUdsFrame()`,
  `getBootloaderState()`, `getUdsServerState()`, `setUdsCanIds()`.
- `app/frontend/src/pages/Index.tsx` - adiciona aba `UDS KILL-CHAIN`.
- `app/frontend/package.json` - scripts test, test:watch, tsc; devDep vitest.
- `app/frontend/vitest.config.ts` - config Vitest (env node, alias @).

## 2. Cobertura de especificacao

### ISO 15765-2 (ISO-TP) - iso-tp.ts

Implementado:

- Single Frame, First Frame, Consecutive Frame, Flow Control com PCI nibble alto correto.
- Encode/decode STmin: 0x00..0x7F (ms) e 0xF1..0xF9 (100us..900us).
- Block size: BS=0 (sem FC intermediario) e BS>0 (FC a cada N CFs).
- TX state machine: SF direto, FF + Bs timer, CF loop honrando STmin.
- RX state machine: SF direto, FF entao FC=CTS, CF loop, sequence error,
  reassembly ate totalLen (12-bit, max 4095 bytes).
- Erros expostos: timeout-as / timeout-bs / timeout-cr / sequence-error /
  overflow / invalid-frame / aborted.
- Padding configuravel (0xCC default).
- Clock injetavel para testes deterministicos.

Nao implementado por escopo:

- N_PDU 29-bit (CAN extended) - so 11-bit testado.
- CAN-FD (DLC > 8) - so CAN classical.
- Negotiation BS/STmin no FC do receiver (usamos os valores configurados).

### ISO 14229 (UDS) - uds.ts

Implementado:

| SID  | Nome                       | Sub-funcoes              | NRCs cobertos                   |
|------|----------------------------|--------------------------|---------------------------------|
| 0x10 | DiagnosticSessionControl   | 01/02/03/04              | 0x12, 0x13                       |
| 0x11 | ECUReset                   | 01/02/03/04/05           | 0x12, 0x13                       |
| 0x22 | ReadDataByIdentifier       | DIDs multiplos           | 0x13, 0x31                       |
| 0x23 | ReadMemoryByAddress        | ALFID 0x44 (default)     | 0x13, 0x22, 0x31, 0x33           |
| 0x27 | SecurityAccess             | seed (impar) + key (par) | 0x12, 0x13, 0x22, 0x24, 0x35     |
| 0x3E | TesterPresent              | 0x00, suppressBit        | 0x12, 0x13                       |

Resposta positiva: SID + 0x40. Resposta negativa: 0x7F SID NRC.
Algoritmo seed-key default: ((seed XOR 0x01020304) + 0x42) mod 2^32,
trivialmente reversivel mas deterministico (configuravel via computeKey).
Troca de DSC reseta SecurityLevel para 0. 0x23 so responde positivo se
sessao != default e SecurityLevel >= 1.

### Bootloader - bootloader.ts

- State machine application <-> bootloader com listeners.
- enterBootloader chamado por 0x11 0x02 (KeyOffOn) ou por 0x11 0x01
  quando a sessao atual e programming.
- Imagem sintetica 512 KB:
  - bytes 0..1 = 0x55 0xAA (magic LE 0xAA55)
  - bytes 2..29 = ASCII "ECU-HybridLab BootImage v1.0"
  - bytes 512..fim = xorshift32(seed=0xC0FFEE42), deterministico
- readMemory(addr, size) valida bounds; FNV-1a 32-bit hash exposto.

## 3. Mapeamento com o ataque real

| Fase real Ford / VW T-Cross           | Fase ECU-HybridLab          | Service(s) UDS    |
|---------------------------------------|-----------------------------|-------------------|
| Bus conditioning (5..10 s)            | bus_conditioning            | (frames CAN benignos) |
| Entrar extended diagnostic            | dsc_extended                | 0x10 03           |
| Entrar programming session            | dsc_programming             | 0x10 02           |
| ECU reset para bootloader             | ecu_reset_bootloader        | 0x11 02           |
| Re-estabelecer programming no boot    | dsc_programming_post_reset  | 0x10 02           |
| SecurityAccess (seed + key)           | security_access             | 0x27 01, 0x27 02  |
| ReadMemoryByAddress (loop chunked)    | firmware_dump               | 0x23 44 ...       |

Diferenca fundamental vs ataque real: o algoritmo seed-key real do Ford /
VW exige reverse engineering do firmware. Aqui usamos um algoritmo
trivial deterministico - o objetivo e provar que o testbed exercita a
sequencia completa de quadros UDS, nao criptanalise.

## 4. Metricas observadas (rodada de referencia)

Capturadas em `data/uds_demo_kill_chain_full.csv`:

```
busFrames=50, dumpTotal=512KB, chunk=4094B, stMin=0, BS=0
duracao simulada: 187 ms
frames CAN totais: 75 623
chunks UDS 0x23: 129
hash FNV-1a do dump: 0x7FA9A043
firmware verificado byte-a-byte: ok
```

Note que duracao simulada reflete so o overhead in-memory (sem STmin
real e sem latencia CAN). Para reproduzir a wall-clock do ataque real
(~55 s no Ford), basta passar `stMin=8` e `blockSize=4` ao
`runKillChain()`. A UI da demo expoe esses parametros como inputs.

## 5. Como rodar

### Demo no navegador

```
cd app/frontend
npm install
npm run dev
# abrir http://localhost:3000, aba "UDS KILL-CHAIN", clicar "Run Kill Chain Demo"
```

### Suite de testes

```
cd app/frontend
npm install
npm test
```

Resultado esperado: 52/52 testes passando (4 arquivos: iso-tp, uds,
bootloader, kill-chain), incluindo um teste end-to-end de 512 KB.

### Regenerar capturas CSV

```
cd app/frontend
npx tsx scripts/generate-uds-captures.ts
# saida em ../../data/uds_demo_*.csv
```

### Build de producao

```
cd app/frontend
npm run build
# saida em dist/, ~1 MB total gzip
```

## 6. Proximos passos sugeridos

1. Algoritmo seed-key OEM-realista: substituir o XOR-rotate por uma
   variante das funcoes publicadas para Ford SCAN-Pro.
2. CAN extended (29-bit): adicionar 29-bit ID no IsoTpConfig para
   suportar VAG normal addressing.
3. `0x34/0x36/0x37` (Request/Transfer/Exit Download): completaria o
   ciclo write-firmware (atualmente so lemos via 0x23).
4. Seed-key brute-force scenario: registrar tentativas invalidas e
   gerar dataset para o capitulo de IDS.
5. STmin real wall-clock: o setTimeout do navegador tem granularidade
   ~4 ms; para emular o `BS=8/STmin=2ms` do Ford precisa worker thread.
