// ============================================================
// Simulador ECU com Arduino e MCP2515
// © 2026 Marcelo Duchene — Todos os direitos reservados
// ============================================================
// Este sketch implementa um simulador de ECU automotiva que:
// - Recebe requisições OBD-II via barramento CAN (MCP2515)
// - Responde com dados simulados realistas
// - Comunica-se via Serial com o simulador web (Web Serial API)
// - Suporta Mode 01 (dados em tempo real), Mode 03 (DTCs),
//   Mode 04 (limpar DTCs) e Mode 09 (info do veículo)
//
// Hardware necessário:
//   - Arduino Uno/Nano
//   - Módulo MCP2515 com transceiver CAN (TJA1050/MCP2551)
//   - Conector OBD-II (opcional, para conexão com scanner real)
//
// Pinagem (Arduino Uno):
//   MCP2515 CS   -> D10
//   MCP2515 SO   -> D12 (MISO)
//   MCP2515 SI   -> D11 (MOSI)
//   MCP2515 SCK  -> D13
//   MCP2515 INT  -> D2
//   MCP2515 VCC  -> 5V
//   MCP2515 GND  -> GND
//
// Bibliotecas necessárias:
//   - mcp_can (Seeed Studio / Longan Labs)
//   Instalar via Arduino IDE: Sketch > Include Library > Manage Libraries
//   Buscar por "mcp_can" e instalar
//
// Baud rates:
//   CAN Bus: 500 kbps (ISO 15765-4 padrão OBD-II)
//   Serial:  115200 bps (comunicação com PC/navegador)
// ============================================================

#include <SPI.h>
#include <mcp_can.h>

// ============================================================
// Configuração de pinos
// ============================================================
#define CAN_CS_PIN   10    // Chip Select do MCP2515
#define CAN_INT_PIN   2    // Pino de interrupção do MCP2515

// ============================================================
// Constantes OBD-II
// ============================================================
#define OBD_REQUEST_ID   0x7DF   // Endereço funcional (broadcast)
#define OBD_RESPONSE_ID  0x7E8   // Endereço de resposta da ECU do motor
#define OBD_PHYS_REQ_ID  0x7E0   // Endereço físico da ECU do motor

// ============================================================
// Instância do controlador CAN
// ============================================================
MCP_CAN CAN(CAN_CS_PIN);

// ============================================================
// Estado dos sensores simulados
// ============================================================
struct SensorState {
  float rpm;
  float speed;
  float coolantTemp;
  float engineLoad;
  float throttle;
  float intakeMAP;
  float mafRate;
  float timingAdvance;
  float intakeAirTemp;
  float fuelLevel;
  float ambientTemp;
  float controlVoltage;
  float oilTemp;
  float baroPressure;
  unsigned long runTime;     // segundos desde o início
};

SensorState sensors;

// ============================================================
// Estado dos DTCs (Códigos de Diagnóstico de Falha)
// ============================================================
#define MAX_DTCS 8
uint16_t storedDTCs[MAX_DTCS];
uint8_t  storedDTCCount = 0;
uint16_t pendingDTCs[MAX_DTCS];
uint8_t  pendingDTCCount = 0;
bool milOn = false;

// ============================================================
// Bitmap de PIDs suportados
// ============================================================
// PIDs 01-20: BE 3E B8 13
//   Suporta: 01,04,05,0B,0C,0D,0E,0F,10,11,1C,1F,20
// PIDs 21-40: 80 05 00 00
//   Suporta: 2F,33
// PIDs 41-60: 68 08 00 00
//   Suporta: 42,46,4F
const uint8_t SUPPORTED_PIDS_00[4] = {0xBE, 0x3E, 0xB8, 0x13};
const uint8_t SUPPORTED_PIDS_20[4] = {0x80, 0x05, 0x00, 0x00};
const uint8_t SUPPORTED_PIDS_40[4] = {0x68, 0x08, 0x00, 0x00};

// ============================================================
// VIN (Vehicle Identification Number)
// ============================================================
const char VIN[] = "1HGBH41JXMN109186";
const char CAL_ID[] = "SED20L_CAL_V1";

// ============================================================
// Cenário de simulação
// ============================================================
enum SimScenario {
  SCENARIO_IDLE,
  SCENARIO_ACCELERATION,
  SCENARIO_CRUISE,
  SCENARIO_DECELERATION
};

SimScenario currentScenario = SCENARIO_IDLE;
unsigned long startTime = 0;
unsigned long lastTickTime = 0;
const unsigned long TICK_INTERVAL = 200; // ms entre atualizações

// ============================================================
// Buffer para comunicação serial
// ============================================================
#define SERIAL_BUF_SIZE 64
char serialBuffer[SERIAL_BUF_SIZE];
uint8_t serialBufIdx = 0;
bool serialCommandReady = false;

// ============================================================
// Protótipos de funções
// ============================================================
void initSensors();
void updateSensors();
float addNoise(float value, float amplitude);
float clampValue(float value, float minVal, float maxVal);
void processCAN();
void sendOBDResponse(uint8_t* data, uint8_t len);
void handleMode01(uint8_t pid);
void handleMode03();
void handleMode04();
void handleMode09(uint8_t pid);
void processSerialCommand(const char* cmd);
void addDefaultDTCs();
uint16_t encodeDTC(const char* code);

// ============================================================
// SETUP
// ============================================================
void setup() {
  // Inicializar comunicação serial com PC
  Serial.begin(115200);
  while (!Serial) {
    ; // Aguardar conexão serial (necessário para Leonardo/Micro)
  }
  Serial.println(F("ECU Simulator Arduino v1.0"));
  Serial.println(F("Inicializando MCP2515..."));

  // Inicializar MCP2515
  // Parâmetros: modo de filtro, velocidade CAN, frequência do cristal
  if (CAN.begin(MCP_ANY, CAN_500KBPS, MCP_8MHZ) == CAN_OK) {
    Serial.println(F("MCP2515 inicializado com sucesso!"));
  } else {
    Serial.println(F("ERRO: Falha ao inicializar MCP2515!"));
    Serial.println(F("Verifique as conexões SPI e alimentação."));
    Serial.println(F("Continuando em modo somente serial..."));
  }

  // Configurar modo normal de operação
  CAN.setMode(MCP_NORMAL);

  // Configurar filtros para aceitar apenas requisições OBD-II
  // Máscara: aceitar IDs 0x7DF e 0x7E0-0x7E7
  CAN.init_Mask(0, 0, 0x7F0);
  CAN.init_Filt(0, 0, 0x7E0);
  CAN.init_Filt(1, 0, 0x7DF);
  CAN.init_Mask(1, 0, 0x7FF);
  CAN.init_Filt(2, 0, 0x7DF);

  // Configurar pino de interrupção
  pinMode(CAN_INT_PIN, INPUT);

  // Inicializar estado dos sensores
  initSensors();

  // Adicionar DTCs padrão para demonstração
  addDefaultDTCs();

  // Registrar tempo de início
  startTime = millis();
  lastTickTime = millis();

  Serial.println(F("Simulador ECU pronto!"));
  Serial.println(F("Comandos serial: ATZ, ATE0, 010C, 010D, etc."));
  Serial.print(F(">"));
}

// ============================================================
// LOOP PRINCIPAL
// ============================================================
void loop() {
  // 1. Atualizar sensores a cada TICK_INTERVAL ms
  unsigned long now = millis();
  if (now - lastTickTime >= TICK_INTERVAL) {
    lastTickTime = now;
    updateSensors();
  }

  // 2. Verificar mensagens CAN recebidas
  processCAN();

  // 3. Verificar comandos recebidos via Serial
  processSerialInput();
}

// ============================================================
// Inicialização dos sensores com valores de marcha lenta
// ============================================================
void initSensors() {
  sensors.rpm           = 750.0;
  sensors.speed         = 0.0;
  sensors.coolantTemp   = 90.0;
  sensors.engineLoad    = 20.0;
  sensors.throttle      = 12.0;
  sensors.intakeMAP     = 35.0;
  sensors.mafRate       = 4.0;
  sensors.timingAdvance = 10.0;
  sensors.intakeAirTemp = 25.0;
  sensors.fuelLevel     = 65.0;
  sensors.ambientTemp   = 22.0;
  sensors.controlVoltage = 13.8;
  sensors.oilTemp       = 95.0;
  sensors.baroPressure  = 101.0;
  sensors.runTime       = 0;
}

// ============================================================
// Adicionar DTCs padrão para demonstração
// ============================================================
void addDefaultDTCs() {
  // P0130 - Sensor O2 Circuit Malfunction (Bank 1, Sensor 1)
  storedDTCs[0] = encodeDTC("P0130");
  // P0420 - Catalyst System Efficiency Below Threshold
  storedDTCs[1] = encodeDTC("P0420");
  storedDTCCount = 2;

  // P0171 - System Too Lean (Bank 1) - pendente
  pendingDTCs[0] = encodeDTC("P0171");
  pendingDTCCount = 1;

  milOn = true;
}

// ============================================================
// Codificar DTC string (ex: "P0130") em 2 bytes
// ============================================================
uint16_t encodeDTC(const char* code) {
  uint8_t typeMap = 0;
  switch (code[0]) {
    case 'P': typeMap = 0; break;
    case 'C': typeMap = 1; break;
    case 'B': typeMap = 2; break;
    case 'U': typeMap = 3; break;
  }

  uint8_t d1 = (code[1] >= 'A') ? (code[1] - 'A' + 10) : (code[1] - '0');
  uint8_t d2 = (code[2] >= 'A') ? (code[2] - 'A' + 10) : (code[2] - '0');
  uint8_t d3 = (code[3] >= 'A') ? (code[3] - 'A' + 10) : (code[3] - '0');
  uint8_t d4 = (code[4] >= 'A') ? (code[4] - 'A' + 10) : (code[4] - '0');

  uint8_t byte1 = (typeMap << 6) | (d1 << 4) | d2;
  uint8_t byte2 = (d3 << 4) | d4;

  return ((uint16_t)byte1 << 8) | byte2;
}

// ============================================================
// Funções auxiliares de ruído e limitação
// ============================================================
float addNoise(float value, float amplitude) {
  return value + ((float)random(-1000, 1001) / 1000.0) * amplitude;
}

float clampValue(float value, float minVal, float maxVal) {
  if (value < minVal) return minVal;
  if (value > maxVal) return maxVal;
  return value;
}

// ============================================================
// Atualização dos sensores baseada no cenário atual
// ============================================================
void updateSensors() {
  // Atualizar tempo de funcionamento
  sensors.runTime = (millis() - startTime) / 1000;

  switch (currentScenario) {
    case SCENARIO_IDLE:
      sensors.rpm         = clampValue(addNoise(750.0, 30.0), 650.0, 900.0);
      sensors.speed       = 0.0;
      sensors.engineLoad  = clampValue(addNoise(20.0, 3.0), 0.0, 100.0);
      sensors.throttle    = clampValue(addNoise(12.0, 2.0), 0.0, 100.0);
      sensors.intakeMAP   = clampValue(addNoise(35.0, 3.0), 20.0, 100.0);
      sensors.mafRate     = clampValue(addNoise(4.0, 0.5), 1.0, 250.0);
      sensors.timingAdvance = clampValue(addNoise(10.0, 2.0), -10.0, 40.0);
      break;

    case SCENARIO_ACCELERATION:
      sensors.rpm   = clampValue(sensors.rpm + addNoise(80.0, 20.0), 650.0, 4550.0);
      sensors.speed = clampValue(sensors.speed + addNoise(3.0, 1.0), 0.0, 160.0);
      sensors.engineLoad  = clampValue(addNoise(60.0, 10.0), 0.0, 100.0);
      sensors.throttle    = clampValue(addNoise(50.0, 15.0), 0.0, 100.0);
      sensors.intakeMAP   = clampValue(addNoise(70.0, 10.0), 20.0, 100.0);
      sensors.mafRate     = clampValue(sensors.rpm * 0.04 + addNoise(0.0, 5.0), 1.0, 250.0);
      sensors.timingAdvance = clampValue(addNoise(25.0, 5.0), -10.0, 40.0);
      break;

    case SCENARIO_CRUISE:
      sensors.rpm   = clampValue(addNoise(2275.0, 50.0), 650.0, 6500.0);
      sensors.speed = clampValue(addNoise(100.0, 2.0), 0.0, 200.0);
      sensors.engineLoad  = clampValue(addNoise(35.0, 5.0), 0.0, 100.0);
      sensors.throttle    = clampValue(addNoise(25.0, 3.0), 0.0, 100.0);
      sensors.intakeMAP   = clampValue(addNoise(50.0, 5.0), 20.0, 100.0);
      sensors.mafRate     = clampValue(sensors.rpm * 0.03 + addNoise(0.0, 3.0), 1.0, 250.0);
      sensors.timingAdvance = clampValue(addNoise(20.0, 3.0), -10.0, 40.0);
      break;

    case SCENARIO_DECELERATION:
      sensors.rpm   = clampValue(sensors.rpm - addNoise(60.0, 15.0), 750.0, 6500.0);
      sensors.speed = clampValue(sensors.speed - addNoise(4.0, 1.0), 0.0, 200.0);
      sensors.engineLoad  = clampValue(addNoise(10.0, 5.0), 0.0, 100.0);
      sensors.throttle    = clampValue(addNoise(5.0, 2.0), 0.0, 100.0);
      sensors.intakeMAP   = clampValue(addNoise(30.0, 5.0), 20.0, 100.0);
      sensors.mafRate     = clampValue(sensors.rpm * 0.015 + addNoise(0.0, 2.0), 1.0, 250.0);
      sensors.timingAdvance = clampValue(addNoise(5.0, 3.0), -10.0, 40.0);
      // Transição automática para idle
      if (sensors.speed <= 0.0 && sensors.rpm <= 850.0) {
        currentScenario = SCENARIO_IDLE;
      }
      break;
  }

  // Parâmetros interdependentes
  // Temperatura do líquido de arrefecimento: aquece com carga alta
  if (sensors.engineLoad > 50.0) {
    sensors.coolantTemp = clampValue(sensors.coolantTemp + 0.05 + addNoise(0.0, 0.1), 80.0, 105.0);
  } else {
    sensors.coolantTemp = clampValue(sensors.coolantTemp - 0.02 + addNoise(0.0, 0.1), 80.0, 105.0);
  }

  // Temperatura do óleo: comportamento similar
  if (sensors.engineLoad > 50.0) {
    sensors.oilTemp = clampValue(sensors.oilTemp + 0.04 + addNoise(0.0, 0.1), 70.0, 130.0);
  } else {
    sensors.oilTemp = clampValue(sensors.oilTemp - 0.015 + addNoise(0.0, 0.1), 70.0, 130.0);
  }

  // Temperatura do ar de admissão e ambiente: variação lenta
  sensors.intakeAirTemp = clampValue(addNoise(25.0, 1.0), 15.0, 50.0);
  sensors.ambientTemp   = clampValue(addNoise(22.0, 0.3), -10.0, 45.0);

  // Tensão da bateria e pressão barométrica: estáveis com ruído
  sensors.controlVoltage = clampValue(addNoise(13.8, 0.1), 12.0, 14.5);
  sensors.baroPressure   = clampValue(addNoise(101.0, 0.5), 95.0, 105.0);

  // Nível de combustível: decresce lentamente
  sensors.fuelLevel = clampValue(sensors.fuelLevel - 0.001, 0.0, 100.0);
}

// ============================================================
// Processar mensagens CAN recebidas
// ============================================================
void processCAN() {
  unsigned char len = 0;
  unsigned char buf[8];
  unsigned long canId;

  // Verificar se há mensagem disponível
  if (CAN.checkReceive() != CAN_MSGAVAIL) return;

  // Ler mensagem
  CAN.readMsgBuf(&len, buf);
  canId = CAN.getCanId();

  // Aceitar apenas requisições OBD-II (0x7DF ou 0x7E0)
  if (canId != OBD_REQUEST_ID && canId != OBD_PHYS_REQ_ID) return;

  // Verificar formato válido: pelo menos 2 bytes de dados
  if (len < 3) return;

  uint8_t dataLen = buf[0];  // Número de bytes de dados
  uint8_t mode    = buf[1];  // Modo de serviço OBD-II
  uint8_t pid     = buf[2];  // PID solicitado

  // Log da requisição recebida via Serial
  Serial.print(F("[CAN RX] ID:0x"));
  Serial.print(canId, HEX);
  Serial.print(F(" Mode:0x"));
  Serial.print(mode, HEX);
  Serial.print(F(" PID:0x"));
  Serial.println(pid, HEX);

  // Processar por modo
  switch (mode) {
    case 0x01:  // Mode 01: Dados atuais do trem de força
      handleMode01(pid);
      break;

    case 0x02:  // Mode 02: Freeze frame (simplificado = Mode 01)
      handleMode01(pid);  // Responder com dados atuais
      break;

    case 0x03:  // Mode 03: DTCs armazenados
      handleMode03();
      break;

    case 0x04:  // Mode 04: Limpar DTCs
      handleMode04();
      break;

    case 0x07:  // Mode 07: DTCs pendentes
      handleMode07();
      break;

    case 0x09:  // Mode 09: Informações do veículo
      handleMode09(pid);
      break;

    default:
      // Modo não suportado - não responder
      Serial.print(F("[CAN] Modo nao suportado: 0x"));
      Serial.println(mode, HEX);
      break;
  }
}

// ============================================================
// Enviar resposta OBD-II via CAN
// ============================================================
void sendOBDResponse(uint8_t* data, uint8_t len) {
  uint8_t txBuf[8] = {0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00};

  // Primeiro byte: comprimento dos dados que seguem
  txBuf[0] = len;

  // Copiar dados
  for (uint8_t i = 0; i < len && i < 7; i++) {
    txBuf[i + 1] = data[i];
  }

  // Preencher bytes restantes com 0x55 (padding padrão OBD-II)
  for (uint8_t i = len + 1; i < 8; i++) {
    txBuf[i] = 0x55;
  }

  // Enviar mensagem CAN
  if (CAN.sendMsgBuf(OBD_RESPONSE_ID, 0, 8, txBuf) == CAN_OK) {
    Serial.print(F("[CAN TX] "));
    for (uint8_t i = 0; i < 8; i++) {
      if (txBuf[i] < 0x10) Serial.print('0');
      Serial.print(txBuf[i], HEX);
      Serial.print(' ');
    }
    Serial.println();
  } else {
    Serial.println(F("[CAN TX] ERRO ao enviar resposta!"));
  }
}

// ============================================================
// Mode 01: Dados atuais do trem de força
// ============================================================
void handleMode01(uint8_t pid) {
  uint8_t resp[6];  // Máximo: responseMode + PID + 4 bytes de dados
  resp[0] = 0x41;   // Resposta positiva ao Mode 01

  switch (pid) {
    case 0x00: {
      // PIDs suportados [01-20]
      resp[1] = 0x00;
      resp[2] = SUPPORTED_PIDS_00[0];
      resp[3] = SUPPORTED_PIDS_00[1];
      resp[4] = SUPPORTED_PIDS_00[2];
      resp[5] = SUPPORTED_PIDS_00[3];
      sendOBDResponse(resp, 6);
      break;
    }

    case 0x01: {
      // Status do monitor desde DTCs limpos
      uint8_t milBit = milOn ? 0x80 : 0x00;
      uint8_t dtcCount = storedDTCCount & 0x7F;
      resp[1] = 0x01;
      resp[2] = milBit | dtcCount;
      resp[3] = 0x07;  // Monitores disponíveis
      resp[4] = 0xE5;  // Monitores completos
      resp[5] = 0x00;
      sendOBDResponse(resp, 6);
      break;
    }

    case 0x04: {
      // Carga calculada do motor (%)
      uint8_t a = (uint8_t)clampValue(sensors.engineLoad * 255.0 / 100.0, 0.0, 255.0);
      resp[1] = 0x04;
      resp[2] = a;
      sendOBDResponse(resp, 3);
      break;
    }

    case 0x05: {
      // Temperatura do líquido de arrefecimento (°C)
      // Fórmula: A - 40
      uint8_t a = (uint8_t)clampValue(sensors.coolantTemp + 40.0, 0.0, 255.0);
      resp[1] = 0x05;
      resp[2] = a;
      sendOBDResponse(resp, 3);
      break;
    }

    case 0x0B: {
      // Pressão absoluta do coletor de admissão (kPa)
      uint8_t a = (uint8_t)clampValue(sensors.intakeMAP, 0.0, 255.0);
      resp[1] = 0x0B;
      resp[2] = a;
      sendOBDResponse(resp, 3);
      break;
    }

    case 0x0C: {
      // RPM do motor
      // Fórmula: ((A * 256) + B) / 4
      uint16_t raw = (uint16_t)(sensors.rpm * 4.0);
      resp[1] = 0x0C;
      resp[2] = (raw >> 8) & 0xFF;
      resp[3] = raw & 0xFF;
      sendOBDResponse(resp, 4);
      break;
    }

    case 0x0D: {
      // Velocidade do veículo (km/h)
      uint8_t a = (uint8_t)clampValue(sensors.speed, 0.0, 255.0);
      resp[1] = 0x0D;
      resp[2] = a;
      sendOBDResponse(resp, 3);
      break;
    }

    case 0x0E: {
      // Avanço de ignição (°)
      // Fórmula: (A - 128) / 2
      uint8_t a = (uint8_t)clampValue(sensors.timingAdvance * 2.0 + 128.0, 0.0, 255.0);
      resp[1] = 0x0E;
      resp[2] = a;
      sendOBDResponse(resp, 3);
      break;
    }

    case 0x0F: {
      // Temperatura do ar de admissão (°C)
      // Fórmula: A - 40
      uint8_t a = (uint8_t)clampValue(sensors.intakeAirTemp + 40.0, 0.0, 255.0);
      resp[1] = 0x0F;
      resp[2] = a;
      sendOBDResponse(resp, 3);
      break;
    }

    case 0x10: {
      // Fluxo de ar MAF (g/s)
      // Fórmula: ((A * 256) + B) / 100
      uint16_t raw = (uint16_t)(sensors.mafRate * 100.0);
      resp[1] = 0x10;
      resp[2] = (raw >> 8) & 0xFF;
      resp[3] = raw & 0xFF;
      sendOBDResponse(resp, 4);
      break;
    }

    case 0x11: {
      // Posição do acelerador (%)
      // Fórmula: A * 100 / 255
      uint8_t a = (uint8_t)clampValue(sensors.throttle * 255.0 / 100.0, 0.0, 255.0);
      resp[1] = 0x11;
      resp[2] = a;
      sendOBDResponse(resp, 3);
      break;
    }

    case 0x1C: {
      // Padrão OBD suportado
      // 0x06 = OBD and OBD-II
      resp[1] = 0x1C;
      resp[2] = 0x06;
      sendOBDResponse(resp, 3);
      break;
    }

    case 0x1F: {
      // Tempo de funcionamento desde o início (s)
      uint16_t rt = (uint16_t)sensors.runTime;
      resp[1] = 0x1F;
      resp[2] = (rt >> 8) & 0xFF;
      resp[3] = rt & 0xFF;
      sendOBDResponse(resp, 4);
      break;
    }

    case 0x20: {
      // PIDs suportados [21-40]
      resp[1] = 0x20;
      resp[2] = SUPPORTED_PIDS_20[0];
      resp[3] = SUPPORTED_PIDS_20[1];
      resp[4] = SUPPORTED_PIDS_20[2];
      resp[5] = SUPPORTED_PIDS_20[3];
      sendOBDResponse(resp, 6);
      break;
    }

    case 0x2F: {
      // Nível de combustível (%)
      uint8_t a = (uint8_t)clampValue(sensors.fuelLevel * 255.0 / 100.0, 0.0, 255.0);
      resp[1] = 0x2F;
      resp[2] = a;
      sendOBDResponse(resp, 3);
      break;
    }

    case 0x33: {
      // Pressão barométrica (kPa)
      uint8_t a = (uint8_t)clampValue(sensors.baroPressure, 0.0, 255.0);
      resp[1] = 0x33;
      resp[2] = a;
      sendOBDResponse(resp, 3);
      break;
    }

    case 0x40: {
      // PIDs suportados [41-60]
      resp[1] = 0x40;
      resp[2] = SUPPORTED_PIDS_40[0];
      resp[3] = SUPPORTED_PIDS_40[1];
      resp[4] = SUPPORTED_PIDS_40[2];
      resp[5] = SUPPORTED_PIDS_40[3];
      sendOBDResponse(resp, 6);
      break;
    }

    case 0x42: {
      // Tensão do módulo de controle (V)
      // Fórmula: ((A * 256) + B) / 1000
      uint16_t raw = (uint16_t)(sensors.controlVoltage * 1000.0);
      resp[1] = 0x42;
      resp[2] = (raw >> 8) & 0xFF;
      resp[3] = raw & 0xFF;
      sendOBDResponse(resp, 4);
      break;
    }

    case 0x46: {
      // Temperatura ambiente (°C)
      // Fórmula: A - 40
      uint8_t a = (uint8_t)clampValue(sensors.ambientTemp + 40.0, 0.0, 255.0);
      resp[1] = 0x46;
      resp[2] = a;
      sendOBDResponse(resp, 3);
      break;
    }

    case 0x4F: {
      // Temperatura do óleo do motor (°C)
      // Fórmula: A - 40
      uint8_t a = (uint8_t)clampValue(sensors.oilTemp + 40.0, 0.0, 255.0);
      resp[1] = 0x4F;
      resp[2] = a;
      sendOBDResponse(resp, 3);
      break;
    }

    default:
      // PID não suportado - não enviar resposta (scanner interpretará como timeout)
      Serial.print(F("[CAN] PID nao suportado: 0x"));
      Serial.println(pid, HEX);
      break;
  }
}

// ============================================================
// Mode 03: DTCs armazenados
// ============================================================
void handleMode03() {
  uint8_t resp[7];
  resp[0] = 0x43;  // Resposta positiva ao Mode 03
  resp[1] = storedDTCCount;

  if (storedDTCCount == 0) {
    sendOBDResponse(resp, 2);
    return;
  }

  // Enviar DTCs (máximo 2 por frame CAN)
  for (uint8_t i = 0; i < storedDTCCount && i < 3; i++) {
    resp[2 + i * 2] = (storedDTCs[i] >> 8) & 0xFF;
    resp[3 + i * 2] = storedDTCs[i] & 0xFF;
  }

  uint8_t len = 2 + (storedDTCCount > 3 ? 6 : storedDTCCount * 2);
  sendOBDResponse(resp, len);
}

// ============================================================
// Mode 04: Limpar DTCs e informações diagnósticas
// ============================================================
void handleMode04() {
  storedDTCCount = 0;
  pendingDTCCount = 0;
  milOn = false;

  uint8_t resp[1] = {0x44};  // Resposta positiva ao Mode 04
  sendOBDResponse(resp, 1);

  Serial.println(F("[ECU] DTCs limpos, MIL desativado"));
}

// ============================================================
// Mode 07: DTCs pendentes
// ============================================================
void handleMode07() {
  uint8_t resp[7];
  resp[0] = 0x47;  // Resposta positiva ao Mode 07
  resp[1] = pendingDTCCount;

  if (pendingDTCCount == 0) {
    sendOBDResponse(resp, 2);
    return;
  }

  for (uint8_t i = 0; i < pendingDTCCount && i < 3; i++) {
    resp[2 + i * 2] = (pendingDTCs[i] >> 8) & 0xFF;
    resp[3 + i * 2] = pendingDTCs[i] & 0xFF;
  }

  uint8_t len = 2 + (pendingDTCCount > 3 ? 6 : pendingDTCCount * 2);
  sendOBDResponse(resp, len);
}

// ============================================================
// Mode 09: Informações do veículo
// ============================================================
void handleMode09(uint8_t pid) {
  switch (pid) {
    case 0x02: {
      // VIN - Vehicle Identification Number
      // Multi-frame: enviar em múltiplos frames CAN
      // Primeiro frame: tipo, contagem de mensagens
      uint8_t resp[7];
      resp[0] = 0x49;
      resp[1] = 0x02;
      resp[2] = 0x01;  // Número de itens de dados
      // Enviar primeiros 4 caracteres do VIN
      for (uint8_t i = 0; i < 4 && i < strlen(VIN); i++) {
        resp[3 + i] = VIN[i];
      }
      sendOBDResponse(resp, 7);
      // Nota: VIN completo requer multi-frame ISO-TP
      // Esta é uma implementação simplificada
      break;
    }

    case 0x04: {
      // Calibration ID
      uint8_t resp[7];
      resp[0] = 0x49;
      resp[1] = 0x04;
      resp[2] = 0x01;
      for (uint8_t i = 0; i < 4 && i < strlen(CAL_ID); i++) {
        resp[3 + i] = CAL_ID[i];
      }
      sendOBDResponse(resp, 7);
      break;
    }

    default:
      Serial.print(F("[CAN] Mode 09 PID nao suportado: 0x"));
      Serial.println(pid, HEX);
      break;
  }
}

// ============================================================
// Processamento de entrada serial (comandos ELM327)
// ============================================================
void processSerialInput() {
  while (Serial.available() > 0) {
    char c = Serial.read();

    // Fim de comando: CR ou LF
    if (c == '\r' || c == '\n') {
      if (serialBufIdx > 0) {
        serialBuffer[serialBufIdx] = '\0';
        processSerialCommand(serialBuffer);
        serialBufIdx = 0;
      }
      continue;
    }

    // Acumular caracteres no buffer
    if (serialBufIdx < SERIAL_BUF_SIZE - 1) {
      serialBuffer[serialBufIdx++] = c;
    }
  }
}

// ============================================================
// Processar comando serial (ELM327 ou OBD-II)
// ============================================================
void processSerialCommand(const char* cmd) {
  // Converter para maiúsculas e remover espaços
  char cleaned[SERIAL_BUF_SIZE];
  uint8_t j = 0;
  for (uint8_t i = 0; cmd[i] != '\0' && j < SERIAL_BUF_SIZE - 1; i++) {
    char c = cmd[i];
    if (c == ' ') continue;  // Ignorar espaços
    if (c >= 'a' && c <= 'z') c -= 32;  // Maiúscula
    cleaned[j++] = c;
  }
  cleaned[j] = '\0';

  // Verificar se é comando AT
  if (cleaned[0] == 'A' && cleaned[1] == 'T') {
    processATCommand(cleaned + 2);
    return;
  }

  // Verificar se é comando OBD-II (hexadecimal)
  bool isHex = true;
  for (uint8_t i = 0; cleaned[i] != '\0'; i++) {
    char c = cleaned[i];
    if (!((c >= '0' && c <= '9') || (c >= 'A' && c <= 'F'))) {
      isHex = false;
      break;
    }
  }

  if (isHex && j >= 4) {
    processOBDSerialCommand(cleaned);
    return;
  }

  // Comando inválido
  Serial.println(F("?"));
  Serial.print(F(">"));
}

// ============================================================
// Processar comandos AT via serial
// ============================================================
void processATCommand(const char* atCmd) {
  if (strcmp(atCmd, "Z") == 0) {
    // Reset
    Serial.println();
    Serial.println(F("ELM327 v1.5"));
  }
  else if (strcmp(atCmd, "E0") == 0) {
    Serial.println(F("OK"));
  }
  else if (strcmp(atCmd, "E1") == 0) {
    Serial.println(F("OK"));
  }
  else if (strcmp(atCmd, "L0") == 0) {
    Serial.println(F("OK"));
  }
  else if (strcmp(atCmd, "L1") == 0) {
    Serial.println(F("OK"));
  }
  else if (strcmp(atCmd, "H0") == 0) {
    Serial.println(F("OK"));
  }
  else if (strcmp(atCmd, "H1") == 0) {
    Serial.println(F("OK"));
  }
  else if (strcmp(atCmd, "S0") == 0) {
    Serial.println(F("OK"));
  }
  else if (strcmp(atCmd, "S1") == 0) {
    Serial.println(F("OK"));
  }
  else if (strcmp(atCmd, "RV") == 0) {
    Serial.print(sensors.controlVoltage, 1);
    Serial.println(F("V"));
  }
  else if (strcmp(atCmd, "DP") == 0) {
    Serial.println(F("AUTO, ISO 15765-4 (CAN 11/500)"));
  }
  else if (strcmp(atCmd, "DPN") == 0) {
    Serial.println(F("6"));
  }
  else if (strcmp(atCmd, "@1") == 0) {
    Serial.println(F("ELM327 v1.5"));
  }
  else if (strcmp(atCmd, "@2") == 0) {
    Serial.println(F("ECU_SIM_ARDUINO"));
  }
  else if (strncmp(atCmd, "SP", 2) == 0) {
    Serial.println(F("OK"));
  }
  else if (strncmp(atCmd, "ST", 2) == 0) {
    Serial.println(F("OK"));
  }
  else if (strcmp(atCmd, "CAF0") == 0 || strcmp(atCmd, "CAF1") == 0) {
    Serial.println(F("OK"));
  }
  else if (strcmp(atCmd, "CFC0") == 0 || strcmp(atCmd, "CFC1") == 0) {
    Serial.println(F("OK"));
  }
  // Comando para mudar cenário (extensão personalizada)
  else if (strcmp(atCmd, "SC0") == 0) {
    currentScenario = SCENARIO_IDLE;
    Serial.println(F("SCENARIO: IDLE"));
  }
  else if (strcmp(atCmd, "SC1") == 0) {
    currentScenario = SCENARIO_ACCELERATION;
    Serial.println(F("SCENARIO: ACCEL"));
  }
  else if (strcmp(atCmd, "SC2") == 0) {
    currentScenario = SCENARIO_CRUISE;
    Serial.println(F("SCENARIO: CRUISE"));
  }
  else if (strcmp(atCmd, "SC3") == 0) {
    currentScenario = SCENARIO_DECELERATION;
    Serial.println(F("SCENARIO: DECEL"));
  }
  else {
    // Comando AT desconhecido - responder OK por padrão
    Serial.println(F("OK"));
  }

  Serial.print(F(">"));
}

// ============================================================
// Processar comandos OBD-II via serial
// Formato: "010C" -> Mode 01, PID 0C
// ============================================================
void processOBDSerialCommand(const char* cmd) {
  // Extrair modo (primeiros 2 caracteres hex)
  uint8_t mode = 0;
  mode = (hexCharToVal(cmd[0]) << 4) | hexCharToVal(cmd[1]);

  // Extrair PID (próximos 2 caracteres hex, se existirem)
  uint8_t pid = 0;
  if (cmd[2] != '\0' && cmd[3] != '\0') {
    pid = (hexCharToVal(cmd[2]) << 4) | hexCharToVal(cmd[3]);
  }

  switch (mode) {
    case 0x01: {
      // Gerar resposta formatada como ELM327
      char response[32];
      formatMode01Response(pid, response);
      if (response[0] != '\0') {
        Serial.println(response);
      } else {
        Serial.println(F("NO DATA"));
      }
      break;
    }

    case 0x03: {
      // DTCs armazenados
      if (storedDTCCount == 0) {
        Serial.println(F("43 00"));
      } else {
        Serial.print(F("43 "));
        Serial.print(storedDTCCount < 16 ? "0" : "");
        Serial.print(storedDTCCount, HEX);
        for (uint8_t i = 0; i < storedDTCCount; i++) {
          uint8_t b1 = (storedDTCs[i] >> 8) & 0xFF;
          uint8_t b2 = storedDTCs[i] & 0xFF;
          Serial.print(' ');
          if (b1 < 0x10) Serial.print('0');
          Serial.print(b1, HEX);
          Serial.print(' ');
          if (b2 < 0x10) Serial.print('0');
          Serial.print(b2, HEX);
        }
        Serial.println();
      }
      break;
    }

    case 0x04: {
      storedDTCCount = 0;
      pendingDTCCount = 0;
      milOn = false;
      Serial.println(F("44"));
      break;
    }

    case 0x07: {
      if (pendingDTCCount == 0) {
        Serial.println(F("47 00"));
      } else {
        Serial.print(F("47 "));
        Serial.print(pendingDTCCount < 16 ? "0" : "");
        Serial.print(pendingDTCCount, HEX);
        for (uint8_t i = 0; i < pendingDTCCount; i++) {
          uint8_t b1 = (pendingDTCs[i] >> 8) & 0xFF;
          uint8_t b2 = pendingDTCs[i] & 0xFF;
          Serial.print(' ');
          if (b1 < 0x10) Serial.print('0');
          Serial.print(b1, HEX);
          Serial.print(' ');
          if (b2 < 0x10) Serial.print('0');
          Serial.print(b2, HEX);
        }
        Serial.println();
      }
      break;
    }

    case 0x09: {
      if (pid == 0x02) {
        // VIN
        Serial.print(F("49 02 "));
        for (uint8_t i = 0; i < strlen(VIN); i++) {
          if (VIN[i] < 0x10) Serial.print('0');
          Serial.print((uint8_t)VIN[i], HEX);
          if (i < strlen(VIN) - 1) Serial.print(' ');
        }
        Serial.println();
      } else if (pid == 0x04) {
        // Cal ID
        Serial.print(F("49 04 "));
        for (uint8_t i = 0; i < strlen(CAL_ID); i++) {
          if (CAL_ID[i] < 0x10) Serial.print('0');
          Serial.print((uint8_t)CAL_ID[i], HEX);
          if (i < strlen(CAL_ID) - 1) Serial.print(' ');
        }
        Serial.println();
      } else {
        Serial.println(F("NO DATA"));
      }
      break;
    }

    default:
      Serial.println(F("NO DATA"));
      break;
  }

  Serial.print(F(">"));
}

// ============================================================
// Formatar resposta Mode 01 como string ELM327
// ============================================================
void formatMode01Response(uint8_t pid, char* response) {
  response[0] = '\0';  // Inicializar vazio

  switch (pid) {
    case 0x00:
      sprintf(response, "41 00 %02X %02X %02X %02X",
        SUPPORTED_PIDS_00[0], SUPPORTED_PIDS_00[1],
        SUPPORTED_PIDS_00[2], SUPPORTED_PIDS_00[3]);
      break;

    case 0x01: {
      uint8_t milBit = milOn ? 0x80 : 0x00;
      sprintf(response, "41 01 %02X 07 E5 00", milBit | (storedDTCCount & 0x7F));
      break;
    }

    case 0x04: {
      uint8_t a = (uint8_t)clampValue(sensors.engineLoad * 255.0 / 100.0, 0.0, 255.0);
      sprintf(response, "41 04 %02X", a);
      break;
    }

    case 0x05: {
      uint8_t a = (uint8_t)clampValue(sensors.coolantTemp + 40.0, 0.0, 255.0);
      sprintf(response, "41 05 %02X", a);
      break;
    }

    case 0x0B: {
      uint8_t a = (uint8_t)clampValue(sensors.intakeMAP, 0.0, 255.0);
      sprintf(response, "41 0B %02X", a);
      break;
    }

    case 0x0C: {
      uint16_t raw = (uint16_t)(sensors.rpm * 4.0);
      sprintf(response, "41 0C %02X %02X", (raw >> 8) & 0xFF, raw & 0xFF);
      break;
    }

    case 0x0D: {
      uint8_t a = (uint8_t)clampValue(sensors.speed, 0.0, 255.0);
      sprintf(response, "41 0D %02X", a);
      break;
    }

    case 0x0E: {
      uint8_t a = (uint8_t)clampValue(sensors.timingAdvance * 2.0 + 128.0, 0.0, 255.0);
      sprintf(response, "41 0E %02X", a);
      break;
    }

    case 0x0F: {
      uint8_t a = (uint8_t)clampValue(sensors.intakeAirTemp + 40.0, 0.0, 255.0);
      sprintf(response, "41 0F %02X", a);
      break;
    }

    case 0x10: {
      uint16_t raw = (uint16_t)(sensors.mafRate * 100.0);
      sprintf(response, "41 10 %02X %02X", (raw >> 8) & 0xFF, raw & 0xFF);
      break;
    }

    case 0x11: {
      uint8_t a = (uint8_t)clampValue(sensors.throttle * 255.0 / 100.0, 0.0, 255.0);
      sprintf(response, "41 11 %02X", a);
      break;
    }

    case 0x1C:
      sprintf(response, "41 1C 06");
      break;

    case 0x1F: {
      uint16_t rt = (uint16_t)sensors.runTime;
      sprintf(response, "41 1F %02X %02X", (rt >> 8) & 0xFF, rt & 0xFF);
      break;
    }

    case 0x20:
      sprintf(response, "41 20 %02X %02X %02X %02X",
        SUPPORTED_PIDS_20[0], SUPPORTED_PIDS_20[1],
        SUPPORTED_PIDS_20[2], SUPPORTED_PIDS_20[3]);
      break;

    case 0x2F: {
      uint8_t a = (uint8_t)clampValue(sensors.fuelLevel * 255.0 / 100.0, 0.0, 255.0);
      sprintf(response, "41 2F %02X", a);
      break;
    }

    case 0x33: {
      uint8_t a = (uint8_t)clampValue(sensors.baroPressure, 0.0, 255.0);
      sprintf(response, "41 33 %02X", a);
      break;
    }

    case 0x40:
      sprintf(response, "41 40 %02X %02X %02X %02X",
        SUPPORTED_PIDS_40[0], SUPPORTED_PIDS_40[1],
        SUPPORTED_PIDS_40[2], SUPPORTED_PIDS_40[3]);
      break;

    case 0x42: {
      uint16_t raw = (uint16_t)(sensors.controlVoltage * 1000.0);
      sprintf(response, "41 42 %02X %02X", (raw >> 8) & 0xFF, raw & 0xFF);
      break;
    }

    case 0x46: {
      uint8_t a = (uint8_t)clampValue(sensors.ambientTemp + 40.0, 0.0, 255.0);
      sprintf(response, "41 46 %02X", a);
      break;
    }

    case 0x4F: {
      uint8_t a = (uint8_t)clampValue(sensors.oilTemp + 40.0, 0.0, 255.0);
      sprintf(response, "41 4F %02X", a);
      break;
    }

    default:
      // PID não suportado
      break;
  }
}

// ============================================================
// Converter caractere hexadecimal para valor numérico
// ============================================================
uint8_t hexCharToVal(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  return 0;
}