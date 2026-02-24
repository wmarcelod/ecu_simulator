# Pesquisa: Datasets Públicos de CAN Bus e Logs de ECU OBD-II

## Objetivo
Identificar e analisar datasets públicos contendo dados reais de barramento CAN e logs OBD-II
para extrair padrões de correlação entre sensores automotivos e melhorar a coerência do
simulador ECU web-based.

---

## 1. Datasets Identificados

### 1.1 KIT Automotive OBD-II Dataset (PRINCIPAL)
- **Instituição:** Karlsruhe Institute of Technology (KIT), Alemanha
- **DOI:** 10.35097/1130
- **URL:** https://radar.kit.edu/radar/en/dataset/bCtGxdTklQlfQcAq
- **Publicação:** Junho 2023
- **Licença:** CC BY 4.0
- **Tamanho:** 11.6 MB
- **Autor:** Marc Weber
- **Formato:** CSV
- **Coleta:** KIWI 3 OBD-II dongle + OBD Auto Doctor app (iOS)
- **Parâmetros incluídos:**
  - Engine coolant temperature (C)
  - Intake manifold absolute pressure (kPa)
  - Engine RPM
  - Vehicle speed sensor (km/h)
  - Intake air temperature (C)
  - Air flow rate / MAF (g/s)
  - Absolute throttle position (%)
  - Ambient air temperature (C)
  - Accelerator pedal positions D e E (%)
- **Cenários:** Condução normal, trânsito livre, trânsito congestionado
- **Veículos:** Múltiplos modelos (nomes nos arquivos CSV)
- **Relevância:** 5/5 - Dataset ideal para nosso projeto

### 1.2 Edge Impulse OBD Automotive Data
- **URL:** https://github.com/edgeimpulse/obd-automotive-data
- **Licença:** BSD-3-Clause
- **Formato:** CSV + scripts Python
- **Parâmetros:** RPM, Pedal Input (%), MAF (g/s), NOx (ppm)
- **Foco:** Detecção de anomalias (veículo saudável vs. com defeito)
- **Veículo:** BMW N53
- **Relevância:** 3/5 - Útil para validação de anomalias

### 1.3 HCRL Car-Hacking Dataset
- **Instituição:** Korea University (HCRL Lab)
- **Autores:** Song, Woo, Kim
- **Publicação:** IEEE Vehicular Communications, 2020
- **Formato:** CSV (Timestamp, CAN ID, DLC, DATA[0-7], Flag)
- **Conteúdo:** Tráfego CAN normal + ataques (DoS, Fuzzy, Spoofing)
- **Relevância:** 4/5 - Excelente para validar detecção de ataques

### 1.4 ECUPrint Dataset
- **URL:** https://github.com/LucianPopaLP/ECUPrint
- **Formato:** Voltagem CAN raw + CAN logs
- **Veículos:** 10 veículos, 54 ECUs
- **Relevância:** 2/5 - Foco em fingerprinting de ECU

### 1.5 OpenDBC (comma.ai)
- **URL:** https://github.com/commaai/opendbc
- **Formato:** Arquivos DBC (Database CAN)
- **Conteúdo:** Definições de mensagens CAN para centenas de veículos
- **Relevância:** 4/5 - Excelente fonte de arquivos DBC

### 1.6 GVSETS / U.S. Army GVSC
- **Instituição:** U.S. Army Ground Vehicle Systems Center
- **Disponibilidade:** Limitada (CUI/ITAR)
- **Relevância:** 2/5 - Difícil acesso

---

## 2. Dataset Selecionado para Análise

**KIT Automotive OBD-II Dataset** foi selecionado como dataset principal porque:
1. Contém todos os PIDs OBD-II relevantes
2. Dados reais de condução em diferentes condições
3. Formato CSV fácil de processar
4. Licença CC BY 4.0 permite uso livre
5. Múltiplos veículos e rotas

---

## 3. Padrões Típicos de Dados CAN/OBD-II

### 3.1 Frequência de Mensagens CAN
| Tipo de Mensagem | Frequência Típica | CAN ID Range |
|---|---|---|
| Motor (RPM, carga) | 10-100 Hz | 0x100-0x200 |
| Transmissão | 10-50 Hz | 0x200-0x300 |
| Chassis (ABS, ESP) | 20-100 Hz | 0x300-0x400 |
| Body (luzes, portas) | 1-10 Hz | 0x400-0x600 |
| OBD-II Request | Sob demanda | 0x7DF (broadcast) |
| OBD-II Response | Sob demanda | 0x7E0-0x7EF |

### 3.2 Ranges Típicos de PIDs OBD-II por Cenário

#### Idle (motor ligado, parado)
| PID | Parâmetro | Range Típico |
|---|---|---|
| 0x0C | RPM | 650-850 rpm |
| 0x0D | Velocidade | 0 km/h |
| 0x05 | Temp. Coolant | 80-95 C (aquecido) |
| 0x04 | Carga Motor | 15-25% |
| 0x11 | Throttle | 0-5% |
| 0x10 | MAF | 2-5 g/s |
| 0x0B | MAP | 30-45 kPa |
| 0x0F | IAT | 20-40 C |

#### Aceleração
| PID | Parâmetro | Range Típico |
|---|---|---|
| 0x0C | RPM | 2000-5000 rpm |
| 0x0D | Velocidade | Subindo (0-120+ km/h) |
| 0x04 | Carga Motor | 60-95% |
| 0x11 | Throttle | 40-100% |
| 0x10 | MAF | 15-80 g/s |
| 0x0B | MAP | 60-100 kPa |

#### Cruzeiro (velocidade constante ~100 km/h)
| PID | Parâmetro | Range Típico |
|---|---|---|
| 0x0C | RPM | 2000-2800 rpm |
| 0x0D | Velocidade | 90-120 km/h |
| 0x04 | Carga Motor | 20-40% |
| 0x11 | Throttle | 15-25% |
| 0x10 | MAF | 8-20 g/s |
| 0x0B | MAP | 40-60 kPa |

#### Desaceleração / Engine Braking
| PID | Parâmetro | Range Típico |
|---|---|---|
| 0x0C | RPM | Descendo (2500-800 rpm) |
| 0x0D | Velocidade | Descendo |
| 0x04 | Carga Motor | 0-10% |
| 0x11 | Throttle | 0% |
| 0x10 | MAF | 1-3 g/s |
| 0x0B | MAP | 25-35 kPa (alto vácuo) |

### 3.3 Correlações Conhecidas entre Sensores

1. **RPM <-> Velocidade:** Proporcional (via relação de marcha). ~30-40 RPM por km/h em marcha alta
2. **RPM <-> MAF:** MAF aprox RPM x VolumeMotor x VolumetricEfficiency x DensidadeAr / 2
   - Aproximação: MAF aprox RPM x 0.01 a 0.02 (motor 2.0L)
3. **Throttle <-> Carga Motor:** Correlação forte positiva, mas não linear (depende de RPM)
4. **Throttle <-> MAP:** MAP sobe com throttle (menos vácuo no coletor)
5. **Carga <-> MAF:** Carga = (MAF / MAF_max) x 100, relação quase linear
6. **Coolant Temp:** Sobe de ~ambiente até ~90C em 5-10 min, estabiliza com termostato
7. **IAT <-> Ambient Temp:** IAT aprox Ambient + 3-10C (aquecimento pelo motor)
8. **Voltagem:** 13.5-14.5V com motor ligado (alternador), 12.0-12.6V desligado

---

## 4. Estrutura Típica de um Log CAN

### Formato Raw CAN (mais comum):
```
timestamp,can_id,dlc,data
1609459200.001,0x7E8,8,04 41 0C 1A F8 00 00 00
1609459200.012,0x7E8,8,03 41 0D 3C 00 00 00 00
```

### Formato OBD-II Decodificado (KIT dataset):
```
timestamp,engine_coolant_temp,intake_map,engine_rpm,vehicle_speed,intake_air_temp,maf,throttle_pos,ambient_temp
2023-01-15 10:00:01,85,35,750,0,25,3.2,2.1,22
2023-01-15 10:00:02,85,42,1200,15,26,8.5,15.3,22
```

---

## 5. Próximos Passos

1. Baixar o KIT Automotive OBD-II Dataset
2. Análise exploratória dos dados (distribuições, correlações)
3. Treinar modelo de ML para capturar correlações entre sensores
4. Exportar parâmetros do modelo em JSON para uso no frontend do simulador

---

## Referências

- Weber, M. (2023). Automotive OBD-II Dataset. KIT. DOI: 10.35097/1130
- Song, H.M., Woo, J., Kim, H.K. (2020). In-vehicle network intrusion detection using deep convolutional neural network. Vehicular Communications, 21.
- Lucian Popa et al. ECUPrint: Physical Fingerprinting Electronic Control Units on CAN Buses.
- comma.ai. OpenDBC. https://github.com/commaai/opendbc
