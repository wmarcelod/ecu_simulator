# Arquitetura do Sistema — Simulador ECU Web-Based

**Autor:** Marcelo Duchene  
**Data:** 2026  
**Versão:** 2.0

---

## 1. Visão Geral do Sistema

O Simulador ECU Web-Based é uma plataforma para simulação de unidades de controle eletrônico (ECU) automotivas, projetada para pesquisa em segurança cibernética automotiva. O sistema permite:

- Simular dados realistas de sensores OBD-II com modelo baseado em física
- Conectar-se a hardware real (Arduino + MCP2515) via Web Serial API
- Injetar valores anômalos para simulação de ataques CAN bus (spoofing, replay, fuzzing)
- Carregar perfis de veículos via arquivos DBC (Vector CANdb++)
- Integrar modelo de ML para coerência entre sensores

### 1.1 Componentes Principais

| Componente | Tecnologia | Responsabilidade |
|---|---|---|
| Frontend Web | React + TypeScript + Tailwind CSS + shadcn/ui | Interface do usuário, visualização, controle |
| ECU Simulator Engine | TypeScript (browser) | Motor de simulação com modelo físico |
| ML Correlation Model | JSON (pré-treinado em Python) | Parâmetros de correlação entre sensores |
| DBC Parser | TypeScript (browser) | Parser de arquivos DBC para perfis de veículos |
| Web Serial Bridge | Web Serial API (browser) | Comunicação serial com Arduino |
| Arduino Firmware | C++ (Arduino IDE) | Controlador de hardware CAN |
| MCP2515 + TJA1050 | Hardware SPI | Transceiver CAN bus |
| CAN Bus | Barramento físico | Rede de comunicação automotiva |

---

## 2. Arquitetura Geral do Sistema

```plantuml
@startuml system_architecture
!theme plain
skinparam backgroundColor #FEFEFE
skinparam componentStyle rectangle

title Arquitetura Geral — Simulador ECU Web-Based

package "Navegador Web (Chrome/Edge)" as Browser {
  package "Frontend React" as FE {
    [Dashboard] as dash
    [SensorPanel] as sensor
    [Terminal ELM327] as term
    [DTCPanel] as dtc
    [PlaybackPanel] as play
    [SchematicPanel] as schem
    [ThemeProvider] as theme
  }

  package "Core Engine" as Core {
    [ECU Simulator\n(ecu-simulator.ts)] as ecu
    [DBC Parser\n(dbc-parser.ts)] as dbc
    [ML Model\n(sensor_correlation_model.json)] as ml
  }

  package "Communication" as Comm {
    [Serial Connection\n(serial-connection.ts)\nWeb Serial API] as serial
  }
}

package "Hardware" as HW {
  [Arduino Uno/Nano\n(arduino_ecu_simulator.ino)] as arduino
  [MCP2515\nCAN Controller\n(SPI Interface)] as mcp
  [TJA1050/MCP2551\nCAN Transceiver] as xcvr
}

cloud "CAN Bus\n(ISO 11898)" as canbus {
  [CANH / CANL\n500 kbps\n120Ω terminação] as canphy
}

package "Dispositivos Externos" as External {
  [Scanner OBD-II\n(ELM327/STN1110)] as scanner
  [ECU Real\n(veículo)] as realecu
  [Ferramenta de\nDiagnóstico] as diag
}

' Conexões Frontend → Core
dash --> ecu : Estado dos sensores\nControle de cenários
sensor --> ecu : Modo AUTO/MANUAL\nValores manuais
term --> ecu : Comandos ELM327\nRespostas OBD-II
dtc --> ecu : Gerenciar DTCs
play --> ecu : Logs de sessão
dbc --> ecu : Perfis de veículos\n(DBC → VehicleProfile)
ml --> ecu : Coeficientes de regressão\nCorrelações\nRegras físicas

' Conexões Core → Hardware
ecu --> serial : Dados serializados\n(JSON/texto)
serial --> arduino : USB Serial\n115200 bps
arduino --> mcp : SPI Bus\n(SCK, MOSI, MISO, CS)
mcp --> xcvr : CAN frames\n(TX/RX)
xcvr --> canphy : Sinal diferencial\nCANH/CANL

' Conexões externas
canphy --> scanner : OBD-II Request\n(0x7DF)
canphy --> realecu : CAN Messages
canphy --> diag : Diagnóstico

@enduml
```

---

## 3. Diagrama do Barramento CAN

### 3.1 Topologia do Barramento CAN

```plantuml
@startuml can_bus_topology
!theme plain
skinparam backgroundColor #FEFEFE

title Topologia do Barramento CAN — Simulador ECU

rectangle "Nó 1: Simulador ECU\n(Arduino + MCP2515)" as node1 {
  rectangle "Arduino Uno" as ard1
  rectangle "MCP2515" as mcp1
  rectangle "TJA1050" as xcvr1
  ard1 -right-> mcp1 : SPI
  mcp1 -right-> xcvr1 : TX/RX
}

rectangle "Nó 2: Scanner OBD-II\n(ELM327 / Ferramenta)" as node2 {
  rectangle "ELM327" as elm
  rectangle "Transceiver" as xcvr2
  elm -right-> xcvr2 : CAN
}

rectangle "Nó 3: ECU Real\n(opcional)" as node3 {
  rectangle "ECU Motor" as ecum
  rectangle "Transceiver" as xcvr3
  ecum -right-> xcvr3 : CAN
}

rectangle "120Ω" as term1
rectangle "120Ω" as term2

xcvr1 -down- term1
term1 -right-[#blue,bold] xcvr2 : **CANH**
xcvr2 -right- term2
term2 -right- xcvr3

note bottom of term1
  Resistor de terminação
  no início do barramento
end note

note bottom of term2
  Resistor de terminação
  no final do barramento
end note

note as N1
  **Barramento CAN 2.0A**
  - Velocidade: 500 kbps (ISO 15765-4)
  - 2 fios: CANH (dominante ~3.5V) / CANL (dominante ~1.5V)
  - Comprimento máx: ~40m a 500kbps
  - Terminação: 120Ω em cada extremidade
  - Arbitragem: CSMA/CD + prioridade por ID
end note
@enduml
```

### 3.2 Formato do Frame CAN 2.0A (Standard)

```plantuml
@startuml can_frame_format
!theme plain
skinparam backgroundColor #FEFEFE

title Formato do Frame CAN 2.0A (Standard Frame)

rectangle "**CAN 2.0A Standard Frame**" {
  rectangle "SOF\n1 bit" as sof #LightBlue
  rectangle "**Arbitration Field**\n11-bit ID + RTR\n12 bits" as arb #LightGreen
  rectangle "Control\nIDE+r0+DLC\n6 bits" as ctrl #LightYellow
  rectangle "**Data Field**\n0-8 bytes\n(0-64 bits)" as data #LightCoral
  rectangle "CRC\n15+1 bits" as crc #Lavender
  rectangle "ACK\n2 bits" as ack #LightGray
  rectangle "EOF\n7 bits" as eof #LightBlue
}

sof -right-> arb
arb -right-> ctrl
ctrl -right-> data
data -right-> crc
crc -right-> ack
ack -right-> eof

note bottom of arb
  **ID para OBD-II:**
  - 0x7DF = Request funcional (broadcast)
  - 0x7E0 = Request físico ECU motor
  - 0x7E8 = Response ECU motor
  
  **Arbitragem:**
  ID menor = maior prioridade
  0x000 > 0x7FF
end note

note bottom of data
  **Formato OBD-II (ISO 15765-4):**
  Byte 0: Comprimento dos dados
  Byte 1: Modo de serviço (01-0A)
  Byte 2: PID solicitado
  Bytes 3-7: Dados / Padding (0x55)
  
  **Exemplo — Request RPM:**
  [02] [01] [0C] [55] [55] [55] [55] [55]
  
  **Exemplo — Response RPM (3000 rpm):**
  [04] [41] [0C] [2E] [E0] [55] [55] [55]
  RPM = ((0x2E × 256) + 0xE0) / 4 = 3000
end note
@enduml
```

### 3.3 Tabela de CAN IDs OBD-II

| CAN ID | Direção | Descrição |
|--------|---------|-----------|
| 0x7DF | Request → | Endereço funcional (broadcast para todas as ECUs) |
| 0x7E0 | Request → | Endereço físico da ECU do motor |
| 0x7E1 | Request → | Endereço físico da ECU da transmissão |
| 0x7E8 | ← Response | Resposta da ECU do motor |
| 0x7E9 | ← Response | Resposta da ECU da transmissão |

### 3.4 Modos de Serviço OBD-II Suportados

| Modo | Request | Response | Descrição |
|------|---------|----------|-----------|
| 01 | 01 XX | 41 XX DD | Dados em tempo real (PIDs) |
| 02 | 02 XX | 42 XX DD | Freeze frame data |
| 03 | 03 | 43 NN DD | DTCs armazenados |
| 04 | 04 | 44 | Limpar DTCs e MIL |
| 07 | 07 | 47 NN DD | DTCs pendentes |
| 09 | 09 XX | 49 XX DD | Informações do veículo (VIN, Cal ID) |
| 0A | 0A | 4A NN DD | DTCs permanentes |

---

## 4. Fluxo de Dados entre Componentes

### 4.1 Fluxo Principal: Dashboard ↔ ECU Simulator ↔ Arduino ↔ CAN Bus

```plantuml
@startuml data_flow_sequence
!theme plain
skinparam backgroundColor #FEFEFE

title Fluxo de Dados — Simulação e Comunicação CAN

actor "Usuário" as user
participant "Dashboard\n(React)" as dash
participant "ECU Simulator\n(TypeScript)" as ecu
participant "Serial Connection\n(Web Serial API)" as serial
participant "Arduino\n(Firmware C++)" as arduino
participant "MCP2515\n(CAN Controller)" as mcp
participant "CAN Bus" as can
participant "Scanner OBD-II" as scanner

== Inicialização ==
user -> dash : Selecionar perfil de veículo
dash -> ecu : switchProfile("sedan")
ecu -> ecu : Carregar pidRanges,\nDTCs, VIN
dash -> ecu : start()
ecu -> ecu : Iniciar tick() a cada 200ms

== Simulação em Tempo Real (tick loop) ==
loop Cada 200ms
  ecu -> ecu : tick()
  note right of ecu
    **Cadeia causal do modelo físico:**
    1. Cenário → throttle_target
    2. throttle = approach(current, target, τ=0.3s)
    3. RPM = f(throttle, inércia τ=1.5s)
    4. engineLoad = f(throttle, RPM)
    5. MAF = f(RPM, engineLoad)
    6. MAP = f(throttle, baroPressure)
    7. speed = f(RPM, gear, inércia τ=3s)
    8. coolantTemp = modelo térmico (τ=30s)
    9. oilTemp = segue coolant (τ=40s)
    10. IAT ≈ ambient + offset
    11. voltage = f(RPM > idle)
    12. fuelLevel -= f(MAF)
    13. timingAdvance = f(RPM, load)
    
    **Sensores MANUAL:** valor fixo
    (não alterado pelo tick)
  end note
  ecu -> dash : emitState(sensorState)
  dash -> dash : Atualizar gauges,\ngráficos, indicadores
end

== Comunicação com Hardware (opcional) ==
user -> dash : Conectar Arduino
dash -> serial : connect()
serial -> arduino : USB Serial 115200bps
arduino --> serial : "ECU Simulator Arduino v1.0"

== Request OBD-II via CAN Bus ==
scanner -> can : CAN Frame\nID: 0x7DF\n[02 01 0C 55 55 55 55 55]
can -> mcp : Receber frame
mcp -> arduino : Interrupção INT\n+ leitura SPI
arduino -> arduino : handleMode01(0x0C)\nRPM = 3000\nraw = 3000 × 4 = 12000\nA = 0x2E, B = 0xE0
arduino -> mcp : sendMsgBuf(0x7E8, ...)\n[04 41 0C 2E E0 55 55 55]
mcp -> can : CAN Frame TX
can -> scanner : Response\nRPM = 3000 rpm

== Request OBD-II via Terminal Web ==
user -> dash : Digitar "010C" no terminal
dash -> ecu : sendCommand("010C")
ecu -> ecu : handleMode01("0C")\nRPM = sensors.rpm\nEncode para bytes hex
ecu --> dash : "41 0C 2E E0"
dash -> dash : Exibir resposta no terminal

== Simulação de Ataque (Modo MANUAL) ==
user -> dash : Sensor RPM → MANUAL\nValor: 0
dash -> ecu : setManualValue("rpm", 0)
ecu -> ecu : sensorModes["rpm"] =\n{mode: "manual", value: 0}
note right of ecu
  **Ataque simulado:**
  RPM = 0 (fixo)
  mas speed = 120 km/h (AUTO)
  → Inconsistência detectável
  por sistema IDS
end note
scanner -> can : Request RPM
arduino -> mcp : Response RPM = 0
note right of scanner
  Scanner mostra RPM=0
  enquanto velocidade=120
  → Anomalia!
end note

@enduml
```

### 4.2 Fluxo de Carregamento DBC

```plantuml
@startuml dbc_flow
!theme plain
skinparam backgroundColor #FEFEFE

title Fluxo de Carregamento de Arquivo DBC

actor "Usuário" as user
participant "Dashboard" as dash
participant "DBC Parser\n(dbc-parser.ts)" as parser
participant "ECU Simulator" as ecu

user -> dash : Clicar "↑ LOAD DBC"
dash -> dash : FileReader.readAsText()
dash -> parser : parseDBC(content, filename)

parser -> parser : Extrair VERSION
parser -> parser : Extrair BU_ (nodes)
parser -> parser : Extrair BO_ (messages)\n+ SG_ (signals)
parser -> parser : Extrair CM_ (comments)

parser --> dash : DBCFile {\n  messages: [{id, name, signals}],\n  nodes: [...]\n}

dash -> parser : dbcToSensorConfig(dbcFile)
parser --> dash : {\n  name: "vehicle_name",\n  signals: [{key, label, unit,\n    min, max, idle, messageId}],\n  messages: [...]\n}

dash -> ecu : addDBCProfile(vehicleProfile)
dash -> ecu : switchProfile(dbcProfileId)
ecu -> ecu : Inicializar sensorModes\npara cada sinal DBC
ecu --> dash : emitState(newState)
dash -> dash : Exibir sinais DBC\nno SensorPanel

@enduml
```

---

## 5. Estrutura das Mensagens CAN/OBD-II

### 5.1 Encoding de PIDs OBD-II

| PID | Sensor | Fórmula de Encoding | Bytes | Exemplo |
|-----|--------|---------------------|-------|---------|
| 0x04 | Engine Load (%) | A = Load × 255 / 100 | 1 | 50% → 0x80 |
| 0x05 | Coolant Temp (°C) | A = Temp + 40 | 1 | 90°C → 0x82 |
| 0x0B | MAP (kPa) | A = MAP | 1 | 35 kPa → 0x23 |
| 0x0C | RPM | raw = RPM × 4; A = raw>>8; B = raw&0xFF | 2 | 3000 → 0x2E 0xE0 |
| 0x0D | Speed (km/h) | A = Speed | 1 | 100 → 0x64 |
| 0x0E | Timing Advance (°) | A = Advance × 2 + 128 | 1 | 10° → 0x94 |
| 0x0F | IAT (°C) | A = Temp + 40 | 1 | 25°C → 0x41 |
| 0x10 | MAF (g/s) | raw = MAF × 100; A = raw>>8; B = raw&0xFF | 2 | 15.5 → 0x06 0x0E |
| 0x11 | Throttle (%) | A = Throttle × 255 / 100 | 1 | 25% → 0x40 |
| 0x1F | Run Time (s) | A = time>>8; B = time&0xFF | 2 | 300s → 0x01 0x2C |
| 0x2F | Fuel Level (%) | A = Fuel × 255 / 100 | 1 | 65% → 0xA6 |
| 0x33 | Baro Pressure (kPa) | A = Pressure | 1 | 101 → 0x65 |
| 0x42 | Voltage (V) | raw = V × 1000; A = raw>>8; B = raw&0xFF | 2 | 13.8V → 0x35 0xE8 |
| 0x46 | Ambient Temp (°C) | A = Temp + 40 | 1 | 22°C → 0x3E |
| 0x5C | Oil Temp (°C) | A = Temp + 40 | 1 | 95°C → 0x87 |

### 5.2 Formato de Frame CAN para Request/Response OBD-II

**Request (Scanner → ECU):**
```
CAN ID: 0x7DF (broadcast) ou 0x7E0 (físico)
DLC: 8
Data: [NumBytes] [Mode] [PID] [0x55] [0x55] [0x55] [0x55] [0x55]

Exemplo — Request RPM:
0x7DF [02] [01] [0C] [55] [55] [55] [55] [55]
```

**Response (ECU → Scanner):**
```
CAN ID: 0x7E8
DLC: 8
Data: [NumBytes] [Mode+0x40] [PID] [DataA] [DataB] ... [0x55 padding]

Exemplo — Response RPM = 3000:
0x7E8 [04] [41] [0C] [2E] [E0] [55] [55] [55]
```

### 5.3 Formato de Sinais DBC (Vector CANdb++)

```
BO_ <CAN_ID> <MessageName>: <DLC> <Sender>
 SG_ <SignalName> : <StartBit>|<BitSize>@<ByteOrder><ValueType> (<Factor>,<Offset>) [<Min>|<Max>] "<Unit>" <Receivers>
```

**Parâmetros de um sinal DBC:**

| Campo | Descrição | Exemplo |
|-------|-----------|---------|
| StartBit | Posição do bit inicial no frame | 24 |
| BitSize | Número de bits do sinal | 16 |
| ByteOrder | 1 = Little Endian (Intel), 0 = Big Endian (Motorola) | 1 |
| ValueType | + = Unsigned, - = Signed | + |
| Factor | Fator de escala: physical = raw × factor + offset | 0.25 |
| Offset | Offset de conversão | 0 |
| Min/Max | Range físico do sinal | [0\|16383.75] |
| Unit | Unidade de medida | "rpm" |

**Conversão:**
- Physical → Raw: `raw = (physical - offset) / factor`
- Raw → Physical: `physical = raw × factor + offset`

---

## 6. Integração do Modelo de ML

### 6.1 Arquitetura de Integração

```plantuml
@startuml ml_integration
!theme plain
skinparam backgroundColor #FEFEFE

title Integração do Modelo de ML no Simulador ECU

package "Fase Offline (Python)" as offline {
  [Dataset Sintético\n10.000 amostras] as dataset
  [Treinamento\n(train_sensor_model.py)] as train
  [Modelos Treinados\n- Polynomial Regression\n- Random Forest] as models
  [sensor_correlation_model.json\n- Coeficientes de regressão\n- Correlações\n- Regras físicas\n- Perfis de ruído\n- Constantes de transição] as json
  
  dataset -> train
  train -> models
  models -> json
}

package "Fase Online (TypeScript/Browser)" as online {
  [ECU Simulator\n(ecu-simulator.ts)] as ecu
  [ML Parameters\n(importados do JSON)] as params
  
  json -down-> params : Carregado em\nbuild time ou\nruntime
  params -> ecu : Alimentar tick()
}

note right of ecu
  **Uso dos parâmetros ML no tick():**
  
  1. **Regressão Polinomial (R² > 0.97):**
     - throttle_rpm_to_load:
       load = 0.297×throttle - 0.003×rpm
             + 0.004×throttle² + ...
       (intercept: 12.57)
     
     - throttle_rpm_to_map:
       MAP = 0.701×throttle + 0.001×rpm
             + ... (intercept: 29.43)
  
  2. **Constantes de Transição:**
     - throttle_tau: 0.3s
     - rpm_accel_tau: 1.0s
     - rpm_decel_tau: 1.5s
     - speed_tau: 3.0s
     - coolant_warmup_tau: 300s
  
  3. **Perfis de Ruído Gaussiano:**
     - rpm: σ = 15
     - speed: σ = 0.5
     - coolant_temp: σ = 0.3
     - throttle: σ = 0.3
     - voltage: σ = 0.2
  
  4. **Modelo de Câmbio:**
     - gear_ratios: [3.6, 2.0, 1.4, 1.0, 0.8]
     - shift_points: [0, 15, 30, 50, 80] km/h
  
  5. **Modelo Térmico:**
     - warmup_rate: 0.05°C/s
     - target: 90°C
     - thermostat: 85°C
end note

@enduml
```

### 6.2 Parâmetros do Modelo ML Utilizados

| Modelo | Inputs | Output | R² | Uso no Simulador |
|--------|--------|--------|-----|------------------|
| throttle_rpm_to_load | throttle, RPM | Engine Load (%) | 0.974 | Calcular carga do motor a cada tick |
| throttle_rpm_to_map | throttle, RPM | MAP (kPa) | 0.992 | Calcular pressão do coletor |
| rpm_to_speed | RPM + gear | Speed (km/h) | 0.759 | Calcular velocidade com modelo de marchas |
| rpm_throttle_to_maf | RPM, throttle | MAF (g/s) | 0.001* | Substituído por modelo físico (RPM × VE × density) |

*\* O modelo MAF teve R² muito baixo, indicando que MAF depende de mais variáveis. Usamos modelo físico baseado em cilindrada e eficiência volumétrica.*

### 6.3 Correlações Principais (da Matriz de Correlação)

```
throttle ←→ MAP:          r = +0.996 (quase linear)
throttle ←→ engine_load:  r = +0.977 (forte)
engine_load ←→ MAP:       r = +0.975 (forte)
RPM ←→ speed:             r = +0.935 (forte, via marchas)
IAT ←→ throttle:          r = +0.796 (moderada, aquecimento)
coolant_temp ←→ fuel_level: r = -0.669 (inversa, tempo de uso)
```

### 6.4 Fluxo de Cálculo no tick() com ML

```plantuml
@startuml tick_flow
!theme plain
skinparam backgroundColor #FEFEFE

title Fluxo de Cálculo do tick() — Modelo Físico + ML

start

:Cenário atual\n(idle/accel/cruise/decel);

:Aplicar overrides MANUAIS\n(sensores em modo ataque);

if (Sensor em modo AUTO?) then (sim)

  :1. **Throttle Target**\n   idle→3%, accel→65%\n   cruise→22%, decel→0%;
  
  :2. **Throttle** = approach(\n   current, target, τ=0.3s)\n   + ruído σ=0.3;
  
  :3. **RPM** = approach(\n   idle + throttle% × (max-idle) × 0.85,\n   τ=1.5s) + ruído σ=15;
  
  :4. **Engine Load** = \n   throttle×0.7 + rpmFraction×30\n   (ML: R²=0.974);
  
  :5. **MAF** = (RPM/1000) × (load/100)\n   × (mafMax / (rpmMax/1000))\n   + ruído σ=0.3;
  
  :6. **MAP** = baro×0.28 + \n   (baro - baro×0.28) × throttle/100\n   (ML: R²=0.992);
  
  :7. **Speed** = f(RPM, gear)\n   com inércia τ=3s\n   + ruído σ=0.5;
  
  :8. **Coolant Temp** = approach(\n   thermostat + heatInput×15,\n   τ=30s) + ruído σ=0.05;
  
  :9. **Oil Temp** = approach(\n   coolant + 5 + load×10,\n   τ=40s) + ruído σ=0.04;
  
  :10. **IAT** = ambient + 3\n    + heatInput×5;
  
  :11. **Voltage** = \n    running? 13.8+rpmFrac×0.5 : 12.3;
  
  :12. **Fuel Level** -= \n    (MAF/500) × 0.005 × dt;
  
  :13. **Timing** = 10 + rpmFrac×25\n    - load/100×10;

else (não — MANUAL)
  :Manter valor fixo\ndefinido pelo usuário\n(simulação de ataque);
endif

:emitState() → Dashboard;

stop

@enduml
```

---

## 7. Esquemático de Hardware

### 7.1 Conexão Arduino ↔ MCP2515

```plantuml
@startuml arduino_schematic
!theme plain
skinparam backgroundColor #FEFEFE

title Esquemático de Conexão — Arduino Uno ↔ MCP2515 ↔ CAN Bus

rectangle "**Arduino Uno**" as arduino #LightBlue {
  rectangle "D13 (SCK)" as d13
  rectangle "D12 (MISO)" as d12
  rectangle "D11 (MOSI)" as d11
  rectangle "D10 (SS/CS)" as d10
  rectangle "D2 (INT)" as d2
  rectangle "5V" as v5
  rectangle "GND" as gnd
}

rectangle "**MCP2515 + TJA1050\nMódulo CAN**" as mcp #LightGreen {
  rectangle "SCK" as msck
  rectangle "SO (MISO)" as mso
  rectangle "SI (MOSI)" as msi
  rectangle "CS" as mcs
  rectangle "INT" as mint
  rectangle "VCC" as mvcc
  rectangle "GND" as mgnd
  rectangle "CANH" as canh
  rectangle "CANL" as canl
}

rectangle "**Conector OBD-II\n(DB9 ou J1962)**" as obd #LightCoral {
  rectangle "Pin 6: CANH" as obdh
  rectangle "Pin 14: CANL" as obdl
  rectangle "Pin 4/5: GND" as obdg
  rectangle "Pin 16: +12V" as obdv
}

' SPI connections
d13 --> msck : **SCK** (clock)
d12 <-- mso : **MISO** (data out)
d11 --> msi : **MOSI** (data in)
d10 --> mcs : **CS** (chip select)
d2 <-- mint : **INT** (interrupt)

' Power
v5 --> mvcc : **5V**
gnd --> mgnd : **GND**

' CAN Bus
canh --> obdh : **CANH**
canl --> obdl : **CANL**

note bottom of mcp
  **MCP2515 Specs:**
  - Cristal: 8 MHz
  - CAN Speed: 500 kbps
  - Interface: SPI (até 10 MHz)
  - Biblioteca: mcp_can (Seeed Studio)
  
  **TJA1050 Specs:**
  - Transceiver CAN de alta velocidade
  - Compatível ISO 11898
  - VCC: 5V
end note

note bottom of obd
  **Pinagem OBD-II (J1962):**
  Pin 4: Chassis Ground
  Pin 5: Signal Ground
  Pin 6: CAN High (ISO 15765)
  Pin 14: CAN Low (ISO 15765)
  Pin 16: Battery Power (+12V)
  
  **Terminação:**
  120Ω entre CANH e CANL
  (se for extremidade do bus)
end note
@enduml
```

### 7.2 Tabela de Pinagem Detalhada

| Arduino Uno | Pino | MCP2515 | Função | Protocolo |
|-------------|------|---------|--------|-----------|
| D13 | 13 | SCK | Serial Clock | SPI |
| D12 | 12 | SO (MISO) | Master In Slave Out | SPI |
| D11 | 11 | SI (MOSI) | Master Out Slave In | SPI |
| D10 | 10 | CS | Chip Select (ativo LOW) | SPI |
| D2 | 2 | INT | Interrupção (ativo LOW) | GPIO |
| 5V | — | VCC | Alimentação | Power |
| GND | — | GND | Terra | Power |

| MCP2515/TJA1050 | Conector OBD-II | Função |
|------------------|-----------------|--------|
| CANH | Pin 6 | CAN High |
| CANL | Pin 14 | CAN Low |
| GND | Pin 4/5 | Ground |

---

## 8. Diagrama de Classes

```plantuml
@startuml class_diagram
!theme plain
skinparam backgroundColor #FEFEFE

title Diagrama de Classes — Simulador ECU

interface ISensorState {
  +rpm: number
  +speed: number
  +coolantTemp: number
  +engineLoad: number
  +throttle: number
  +intakeMAP: number
  +mafRate: number
  +timingAdvance: number
  +intakeAirTemp: number
  +fuelLevel: number
  +ambientTemp: number
  +controlVoltage: number
  +oilTemp: number
  +baroPressure: number
  +runTime: number
  +[key: string]: number
}

interface IVehicleProfile {
  +id: string
  +name: string
  +type: 'sedan' | 'suv' | 'sport' | 'dbc'
  +vin: string
  +calibrationId: string
  +supportedPids: Record<string, number[]>
  +pidRanges: Record<string, {min, max, idle}>
  +dtcs: {stored, pending, permanent}
  +description: string
}

interface ISimulatorConfig {
  +echoEnabled: boolean
  +headersEnabled: boolean
  +spacesEnabled: boolean
  +linefeedsEnabled: boolean
  +protocol: string
  +milOn: boolean
}

enum SimScenario {
  idle
  acceleration
  cruise
  deceleration
}

enum SensorMode {
  auto
  manual
}

class SensorModeState {
  +mode: SensorMode
  +manualValue: number
}

class ECUSimulator {
  -profile: VehicleProfile
  -config: SimulatorConfig
  -sensors: SensorState
  -running: boolean
  -scenario: SimScenario
  -sensorModes: Record<string, SensorModeState>
  -customProfiles: VehicleProfile[]
  -sensorLog: Array<{timestamp, state}>
  -commandLog: Array<{timestamp, command, response}>
  -listeners: Array<(state) => void>
  --
  +constructor(profileId: string)
  +start(): void
  +stop(): void
  +tick(): void
  +getState(): SensorState
  +setScenario(scenario: SimScenario): void
  +switchProfile(profileId: string): void
  +setSensorValue(key: string, value: number): void
  +setSensorMode(key: string, mode: SensorMode): void
  +setManualValue(key: string, value: number): void
  +getManualSensors(): string[]
  +setAllSensorsMode(mode: SensorMode): void
  +addDBCProfile(profile: VehicleProfile): void
  +getAllProfiles(): VehicleProfile[]
  +processCommand(rawCmd: string): string
  +sendCommand(rawCmd: string): string
  +exportSessionLog(): string
  +onStateChange(listener): () => void
  +onLog(listener): () => void
  -processATCommand(cmd: string): string
  -processOBDCommand(cmd: string): string
  -handleMode01(pidHex: string): string
  -handleMode03(): string
  -handleMode04(): string
  -handleMode07(): string
  -handleMode09(pidHex: string): string
  -handleMode0A(): string
  -formatResponse(mode, pid, dataBytes): string
  -encodeDTC(code: string): [number, number]
  -approach(current, target, tau, noise): number
  -isManual(key: string): boolean
  -val(key: string): number
}

class SerialConnection {
  -port: SerialPort | null
  -reader: ReadableStreamDefaultReader | null
  -writer: WritableStreamDefaultWriter | null
  -status: ConnectionStatus
  -options: SerialConnectionOptions
  --
  +{static} isSupported(): boolean
  +connect(): Promise<boolean>
  +write(data: string): Promise<boolean>
  +disconnect(): Promise<void>
  +getStatus(): ConnectionStatus
  -startReading(): void
  -setStatus(status: ConnectionStatus): void
}

enum ConnectionStatus {
  disconnected
  connecting
  connected
  error
}

class DBCParser {
  +{static} parseDBC(content, filename): DBCFile
  +{static} encodeSignalValue(signal, value): number
  +{static} decodeSignalValue(signal, rawValue): number
  +{static} packSignalIntoData(data, signal, raw): void
  +{static} buildCANFrame(message, values): Uint8Array
  +{static} dbcToSensorConfig(dbc): SensorConfig
}

class DBCFile {
  +version: string
  +messages: DBCMessage[]
  +nodes: string[]
  +comments: Record<string, string>
  +filename: string
}

class DBCMessage {
  +id: number
  +name: string
  +size: number
  +sender: string
  +signals: DBCSignal[]
  +comment?: string
}

class DBCSignal {
  +name: string
  +startBit: number
  +bitSize: number
  +byteOrder: 'little_endian' | 'big_endian'
  +valueType: 'unsigned' | 'signed'
  +factor: number
  +offset: number
  +min: number
  +max: number
  +unit: string
  +receivers: string[]
}

class MLCorrelationModel <<JSON>> {
  +sensor_ranges: Record<string, Range>
  +correlation_matrix: Record<string, Record<string, number>>
  +regression_models: Record<string, RegressionModel>
  +scenario_statistics: Record<string, Stats>
  +physical_rules: PhysicalRules
  +noise_profiles: Record<string, NoiseProfile>
  +transition_time_constants: TimeConstants
}

' Relationships
ECUSimulator *-- ISensorState : sensors
ECUSimulator *-- IVehicleProfile : profile
ECUSimulator *-- ISimulatorConfig : config
ECUSimulator *-- SensorModeState : sensorModes
ECUSimulator o-- SimScenario : scenario
ECUSimulator ..> DBCParser : usa para DBC
ECUSimulator ..> MLCorrelationModel : parâmetros do tick()
SerialConnection ..> ECUSimulator : bridge serial
DBCParser --> DBCFile : produz
DBCFile *-- DBCMessage
DBCMessage *-- DBCSignal

@enduml
```

---

## 9. Navegação da Interface (UI Navigation)

```plantuml
@startuml ui_navigation
!theme plain
skinparam backgroundColor #FEFEFE

title Navegação da Interface — Simulador ECU

state "🏠 Dashboard (Tab Principal)" as Dashboard {
  state "Controles do Motor" as Controls
  state "Gauges (RPM, Speed, Temp)" as Gauges
  state "Indicadores (MIL, Status)" as Indicators
  state "Seleção de Perfil" as Profile
  state "Seleção de Cenário" as Scenario
  state "Conexão Arduino" as Connect
  state "Load DBC" as LoadDBC
  state "Toggle Tema ☀️/🌙" as Theme
  
  [*] --> Controls
  Controls --> Gauges
  Controls --> Profile
  Controls --> Scenario
  Controls --> Connect
  Controls --> LoadDBC
  Controls --> Theme
}

state "📊 Sensors (Tab)" as Sensors {
  state "Independent Sensor Controls" as SensorCtrl
  state "AUTO/MANUAL Toggle" as ModeToggle
  state "Sliders (min-max)" as Sliders
  state "Gráficos em Tempo Real" as Charts
  state "Escala Manual/Auto" as Scale
  
  [*] --> SensorCtrl
  SensorCtrl --> ModeToggle
  SensorCtrl --> Sliders
  SensorCtrl --> Charts
  Charts --> Scale
}

state "💻 Terminal (Tab)" as Terminal {
  state "Linha de Comando ELM327" as CmdLine
  state "Histórico de Comandos" as History
  state "Respostas OBD-II" as Responses
  
  [*] --> CmdLine
  CmdLine --> History
  CmdLine --> Responses
}

state "⚠️ DTCs (Tab)" as DTCs {
  state "DTCs Armazenados" as Stored
  state "DTCs Pendentes" as Pending
  state "Adicionar/Remover DTC" as ManageDTC
  state "Limpar Todos" as ClearDTC
  
  [*] --> Stored
  Stored --> Pending
  Stored --> ManageDTC
  ManageDTC --> ClearDTC
}

state "📼 Playback (Tab)" as Playback {
  state "Log de Sessão" as SessionLog
  state "Exportar CSV" as Export
  
  [*] --> SessionLog
  SessionLog --> Export
}

state "🔧 Schematic (Tab)" as Schematic {
  state "Diagrama SVG Arduino↔MCP2515" as Diagram
  state "Tabela de Pinagem" as Pinout
  state "Notas Técnicas" as Notes
  
  [*] --> Diagram
  Diagram --> Pinout
  Pinout --> Notes
}

Dashboard --> Sensors : Tab
Dashboard --> Terminal : Tab
Dashboard --> DTCs : Tab
Dashboard --> Playback : Tab
Dashboard --> Schematic : Tab
Sensors --> Dashboard : Tab
Terminal --> Dashboard : Tab
DTCs --> Dashboard : Tab
Playback --> Dashboard : Tab
Schematic --> Dashboard : Tab

@enduml
```

---

## 10. Cenários de Uso para Segurança Cibernética

### 10.1 Ataques Simuláveis

| Ataque | Configuração no Simulador | Detecção Esperada |
|--------|---------------------------|-------------------|
| **Spoofing de RPM** | RPM → MANUAL = 0, Speed → AUTO (alto) | RPM=0 com velocidade alta é impossível |
| **Replay Attack** | Todos sensores → MANUAL com valores fixos | Valores estáticos sem variação natural (sem ruído) |
| **Fuzzing** | Valores aleatórios extremos em sensores MANUAL | Valores fora dos ranges físicos possíveis |
| **DoS (Denial of Service)** | Enviar muitos comandos OBD-II rapidamente | Sobrecarga de respostas no barramento |
| **Injeção de DTC** | Adicionar DTCs falsos via DTCPanel | DTCs inconsistentes com estado do motor |
| **Temperatura Anômala** | Coolant → MANUAL = 150°C | Temperatura impossível em operação normal |

### 10.2 Modo Normal vs. Modo Ataque

```
Modo Normal (AUTO):
  RPM=750 → Speed=0 → Load=20% → MAF=4 g/s → MAP=35 kPa
  (Todos coerentes, com ruído gaussiano natural)

Modo Ataque (MANUAL em RPM):
  RPM=0 (MANUAL) → Speed=100 (AUTO) → Load=35% (AUTO) → MAF=15 (AUTO)
  ⚠️ ANOMALIA: RPM=0 impossível com velocidade e carga altas
  → Sistema IDS deve detectar esta inconsistência
```

---

## 11. Estrutura de Arquivos do Projeto

```
/workspace/
├── app/
│   └── frontend/
│       ├── public/
│       │   └── arduino_ecu_simulator.ino    # Firmware Arduino
│       ├── src/
│       │   ├── components/
│       │   │   ├── Dashboard.tsx             # Painel principal
│       │   │   ├── SensorPanel.tsx           # Controles de sensores
│       │   │   ├── Terminal.tsx              # Terminal ELM327
│       │   │   ├── DTCPanel.tsx              # Gerenciamento de DTCs
│       │   │   ├── PlaybackPanel.tsx         # Reprodução de logs
│       │   │   └── SchematicPanel.tsx        # Esquemático Arduino
│       │   ├── lib/
│       │   │   ├── ecu-simulator.ts          # Motor de simulação ECU
│       │   │   ├── serial-connection.ts      # Web Serial API
│       │   │   ├── dbc-parser.ts             # Parser de arquivos DBC
│       │   │   └── theme-context.tsx         # Contexto de tema
│       │   ├── pages/
│       │   │   └── Index.tsx                 # Página principal
│       │   └── hooks/
│       ├── index.html
│       ├── package.json
│       └── tailwind.config.ts
├── data/
│   ├── can_bus_analysis_report.md            # Relatório de análise
│   ├── can_bus_research_findings.md          # Pesquisa de datasets
│   ├── sensor_correlation_model.json         # Modelo ML (JSON)
│   ├── datasets/
│   │   └── synthetic_obd2_driving_data.csv   # Dataset sintético
│   └── ml_model/
│       └── train_sensor_model.py             # Script de treinamento
├── docs/
│   └── system_architecture.md                # Este documento
└── capitulo_simulador_ecu.tex                # Documentação LaTeX
```

---

## 12. Aspectos Não Claros / Suposições

1. **ISO-TP (ISO 15765-2):** A implementação atual não suporta multi-frame ISO-TP completo. O VIN (17 caracteres) requer multi-frame mas está simplificado para single-frame. Para produção, implementar segmentação First Frame / Consecutive Frame / Flow Control.

2. **Modelo MAF:** O modelo de regressão para MAF teve R² = 0.001 (muito baixo). Isso indica que MAF depende de variáveis não capturadas (cilindrada, eficiência volumétrica, temperatura, altitude). O simulador usa modelo físico simplificado: `MAF ≈ (RPM/1000) × (load/100) × fator_motor`.

3. **Velocidade do CAN Bus:** Assumimos 500 kbps (padrão OBD-II / ISO 15765-4). Alguns veículos usam 250 kbps. O cristal do MCP2515 é assumido como 8 MHz.

4. **Modelo de Câmbio:** O simulador usa modelo simplificado de 5 marchas com shift points fixos. Um modelo real teria curvas de torque do motor e lógica de transmissão automática/manual.

5. **Integração ML em Runtime:** Os parâmetros do modelo ML estão em JSON estático. Para integração mais sofisticada, poderia-se usar TensorFlow.js ou ONNX.js para inferência de Random Forest diretamente no browser.

6. **Segurança da Web Serial API:** A Web Serial API requer HTTPS e interação do usuário (click) para solicitar acesso à porta serial. Não funciona em HTTP puro ou sem gesto do usuário.

7. **Terminação CAN Bus:** Se o módulo MCP2515 for a única extremidade do barramento, precisa de resistor de terminação de 120Ω entre CANH e CANL. Muitos módulos já incluem este resistor soldado na placa.

---

© 2026 Marcelo Duchene — Todos os direitos reservados