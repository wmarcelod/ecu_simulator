#include <SPI.h>
#include <mcp_can.h>

// ============================================================================
// ECU Simulator Firmware for Arduino with MCP2515 CAN Controller
// Implements OBD-II (Mode 01, 03, 04, 09), UDS, and serial WebSocket bridge
// ============================================================================

static const uint8_t CAN_CS_PIN  = 10;
static const uint8_t CAN_INT_PIN = 2;
static const uint8_t MCP_CLOCK   = MCP_8MHZ;

MCP_CAN CAN0(CAN_CS_PIN);

struct BusCfg {
  uint8_t proto = 6; // 6/7=500k, 8/9=250k
  uint8_t canSpeed = CAN_500KBPS;
} bus;

// ============================================================================
// Simulated Sensor State
// ============================================================================
struct SensorState {
  uint16_t engineRPM;           // 0-6000 RPM
  uint8_t engineLoad;            // 0-100%
  uint8_t coolantTemp;           // -40 to 215°C (offset: -40)
  uint8_t intakeTemp;            // -40 to 215°C (offset: -40)
  uint8_t throttlePos;           // 0-100%
  uint16_t MAF;                  // 0-655.35 g/s
  uint16_t speed;                // 0-255 km/h
  uint32_t runtime;              // seconds since start
  bool engineRunning;
  uint32_t startTime;
  uint32_t lastUpdate;
  uint8_t numDTCs;
  uint8_t dtcCodes[4];           // Example DTCs
} sensors = {
  0, 0, 40, 25, 0, 0, 0, 0, false, 0, 0, 2,
  {0x03, 0x04, 0x00, 0x00}
};

// UDS Security Access
struct SecurityState {
  bool unlocked = false;
  uint32_t seedValue = 0x12345678;
} security;

// Serial command buffer
static char lineBuf[160];
static uint8_t lineLen = 0;

// ============================================================================
// Utility Functions
// ============================================================================

static void printHexByte(uint8_t b) {
  const char *hex = "0123456789ABCDEF";
  Serial.print(hex[(b >> 4) & 0x0F]);
  Serial.print(hex[b & 0x0F]);
}

static void printFrameLine(const char *tag, uint32_t id, bool ext, uint8_t dlc, const uint8_t *data) {
  Serial.print(tag);
  Serial.print(",");
  Serial.print(id, HEX);
  Serial.print(",");
  Serial.print(ext ? 1 : 0);
  Serial.print(",");
  Serial.print(dlc);
  Serial.print(",");
  for (uint8_t i = 0; i < dlc; i++) printHexByte(data[i]);
  Serial.print(",");
  Serial.println(millis());
}

static void sendInfo(const char* msg) {
  Serial.print("INFO,");
  Serial.println(msg);
}

// ============================================================================
// CAN Bus Configuration
// ============================================================================

static bool applyProto(uint8_t proto) {
  bus.proto = proto;
  switch (proto) {
    case 6:
    case 7:
      bus.canSpeed = CAN_500KBPS;
      break;
    case 8:
    case 9:
      bus.canSpeed = CAN_250KBPS;
      break;
    default:
      return false;
  }

  if (CAN0.begin(MCP_ANY, bus.canSpeed, MCP_CLOCK) != CAN_OK) {
    return false;
  }
  CAN0.setMode(MCP_NORMAL);
  pinMode(CAN_INT_PIN, INPUT);
  return true;
}

// ============================================================================
// Sensor Simulation (realistic sensor value generation)
// ============================================================================

static void updateSensors() {
  uint32_t now = millis();
  if (now - sensors.lastUpdate < 100) return; // Update every 100ms
  sensors.lastUpdate = now;

  if (!sensors.engineRunning) {
    sensors.engineRPM = 0;
    sensors.engineLoad = 0;
    sensors.MAF = 0;
    sensors.speed = 0;
    sensors.throttlePos = 0;
    // Coolant temp drifts to ambient slowly
    if (sensors.coolantTemp > 25) sensors.coolantTemp--;
    return;
  }

  // Engine running: simulate realistic values
  sensors.runtime = (millis() - sensors.startTime) / 1000;

  // RPM oscillates slightly around 2000-3000 when running
  int rpmBase = 2000 + (rand() % 1000);
  sensors.engineRPM = (uint16_t)(rpmBase + (rand() % 200) - 100);
  if (sensors.engineRPM > 6000) sensors.engineRPM = 6000;

  // Engine load: 20-60% under light load
  sensors.engineLoad = 20 + (rand() % 40);

  // Coolant temp warms up over time (0-5 min to reach ~90C)
  if (sensors.coolantTemp < 90) {
    sensors.coolantTemp += (rand() % 3);
  } else if (sensors.coolantTemp > 95) {
    sensors.coolantTemp--;
  }

  // Intake temp slightly cooler than coolant
  sensors.intakeTemp = sensors.coolantTemp - 5;
  if (sensors.intakeTemp < 20) sensors.intakeTemp = 20;

  // Throttle varies: 10-40%
  sensors.throttlePos = 10 + (rand() % 30);

  // MAF: mass air flow, realistic based on load
  sensors.MAF = (20 + (rand() % 100)) * 10; // 200-1200 in 0.01 g/s units

  // Speed varies: 0-100 km/h
  sensors.speed = (rand() % 100);
}

// ============================================================================
// OBD-II Mode 01: Current Data
// ============================================================================

static void handleOBDMode01(uint8_t pid, uint8_t *respData, uint8_t *respLen) {
  uint8_t data[7] = {0};
  uint8_t dataLen = 0;

  // Response format: [Service(0x41), PID, Value...]
  data[0] = 0x41; // Mode 01 response
  data[1] = pid;
  dataLen = 2;

  switch (pid) {
    case 0x00: // Supported PIDs (0x01-0x20)
      data[2] = 0xF1;
      data[3] = 0x99;
      data[4] = 0xB8;
      data[5] = 0x11;
      dataLen = 6;
      break;

    case 0x04: // Engine load (%)
      data[2] = (uint8_t)(((uint16_t)sensors.engineLoad * 255) / 100);
      dataLen = 3;
      break;

    case 0x05: // Coolant temp (-40 to 215°C)
      data[2] = (uint8_t)(sensors.coolantTemp + 40);
      dataLen = 3;
      break;

    case 0x0C: // RPM (0-16383.75)
      {
        uint16_t rpm16 = (sensors.engineRPM * 4) / 10; // Convert to units of 0.25 RPM
        data[2] = (uint8_t)((rpm16 >> 8) & 0xFF);
        data[3] = (uint8_t)(rpm16 & 0xFF);
        dataLen = 4;
      }
      break;

    case 0x0D: // Speed (km/h, 0-255)
      data[2] = (uint8_t)sensors.speed;
      dataLen = 3;
      break;

    case 0x0F: // Intake temp (-40 to 215°C)
      data[2] = (uint8_t)(sensors.intakeTemp + 40);
      dataLen = 3;
      break;

    case 0x10: // MAF (0-655.35 g/s)
      {
        uint16_t mafVal = sensors.MAF;
        data[2] = (uint8_t)((mafVal >> 8) & 0xFF);
        data[3] = (uint8_t)(mafVal & 0xFF);
        dataLen = 4;
      }
      break;

    case 0x11: // Throttle pos (0-100%)
      data[2] = (uint8_t)(((uint16_t)sensors.throttlePos * 255) / 100);
      dataLen = 3;
      break;

    case 0x1C: // OBD standard
      data[2] = 0x01; // OBD-II (SAE J1979)
      dataLen = 3;
      break;

    case 0x1F: // Runtime (seconds)
      {
        uint32_t runtime = sensors.runtime;
        data[2] = (uint8_t)((runtime >> 8) & 0xFF);
        data[3] = (uint8_t)(runtime & 0xFF);
        dataLen = 4;
      }
      break;

    default:
      // Unsupported PID - return NRC 0x31 (request out of range)
      data[0] = 0x7F;
      data[1] = 0x01;
      data[2] = 0x31;
      dataLen = 3;
      break;
  }

  memcpy(respData, data, dataLen);
  *respLen = dataLen;
}

// ============================================================================
// OBD-II Mode 03: Read DTCs
// ============================================================================

static void handleOBDMode03(uint8_t *respData, uint8_t *respLen) {
  uint8_t data[8] = {0};
  data[0] = 0x43; // Mode 03 response
  data[1] = (uint8_t)sensors.numDTCs;

  uint8_t dataLen = 2;
  for (uint8_t i = 0; i < sensors.numDTCs && i < 4; i++) {
    data[dataLen++] = sensors.dtcCodes[i];
    data[dataLen++] = 0x00; // Severity byte
  }

  memcpy(respData, data, dataLen);
  *respLen = dataLen;
}

// ============================================================================
// OBD-II Mode 04: Clear DTCs
// ============================================================================

static void handleOBDMode04(uint8_t *respData, uint8_t *respLen) {
  sensors.numDTCs = 0;
  respData[0] = 0x44; // Mode 04 response
  *respLen = 1;
}

// ============================================================================
// OBD-II Mode 09: VIN Request
// ============================================================================

static void handleOBDMode09(uint8_t subMode, uint8_t *respData, uint8_t *respLen) {
  if (subMode == 0x02) { // Request VIN
    // VIN: "DEMO12345678VIN1"
    const char *vin = "DEMO12345678VIN1";
    respData[0] = 0x49; // Mode 09 response
    respData[1] = 0x02; // Sub-mode
    respData[2] = 0x01; // Part number
    respData[3] = 0x01; // Number of data bytes in response

    uint8_t dataLen = 4;
    for (uint8_t i = 0; i < 8 && vin[i]; i++) {
      if (dataLen >= 8) break;
      respData[dataLen++] = (uint8_t)vin[i];
    }
    *respLen = dataLen;
  } else {
    // Unsupported sub-mode
    respData[0] = 0x7F;
    respData[1] = 0x09;
    respData[2] = 0x31;
    *respLen = 3;
  }
}

// ============================================================================
// OBD-II Request Handler (0x7DF and 0x7E0-0x7E7)
// ============================================================================

static void handleOBDRequest(uint32_t id, uint8_t dlc, const uint8_t *data) {
  if (dlc < 2) return;

  uint8_t numBytes = data[0];
  if (numBytes < 1) return;

  uint8_t mode = data[1];
  uint8_t respData[8] = {0};
  uint8_t respLen = 0;

  // Calculate response ID (add 0x08)
  uint32_t respId = (id == 0x7DF) ? 0x7E8 : (id + 0x08);

  updateSensors();

  switch (mode) {
    case 0x01: // Mode 01: Current data
      if (dlc >= 3) {
        uint8_t pid = data[2];
        handleOBDMode01(pid, respData, &respLen);
      }
      break;

    case 0x03: // Mode 03: Read DTCs
      handleOBDMode03(respData, &respLen);
      break;

    case 0x04: // Mode 04: Clear DTCs
      handleOBDMode04(respData, &respLen);
      break;

    case 0x09: // Mode 09: VIN/calibration
      if (dlc >= 3) {
        uint8_t subMode = data[2];
        handleOBDMode09(subMode, respData, &respLen);
      }
      break;

    default:
      // Unsupported mode - NRC 0x12 (sub-function not supported)
      respData[0] = 0x7F;
      respData[1] = mode;
      respData[2] = 0x12;
      respLen = 3;
      break;
  }

  // Send response
  if (respLen > 0) {
    // OBD-II response frame: [NumBytes, Service, Data...]
    uint8_t frame[8];
    frame[0] = respLen - 1; // NumBytes (excluding the NumBytes field itself)
    memcpy(frame + 1, respData, respLen);
    uint8_t totalLen = respLen + 1;
    if (totalLen > 8) totalLen = 8;

    CAN0.sendMsgBuf(respId, 0, totalLen, frame);
    printFrameLine("TX", respId, false, totalLen, frame);
  }
}

// ============================================================================
// UDS Services
// ============================================================================

static void handleUDSRequest(uint32_t id, uint8_t dlc, const uint8_t *data) {
  if (dlc < 1) return;

  uint8_t service = data[0];
  uint8_t respData[8] = {0};
  uint8_t respLen = 0;
  uint32_t respId = id + 0x08;

  updateSensors();

  switch (service) {
    case 0x10: // DiagnosticSessionControl
      if (dlc >= 2) {
        uint8_t sessionType = data[1];
        respData[0] = 0x50; // Positive response
        respData[1] = sessionType;
        respData[2] = 0x00; // P2* timing
        respData[3] = 0x32;
        respData[4] = 0x00; // P2*Extended
        respData[5] = 0xC8;
        respLen = 6;
      }
      break;

    case 0x3E: // TesterPresent
      respData[0] = 0x7E; // Positive response
      if (dlc >= 2 && (data[1] & 0x80)) {
        respData[1] = data[1]; // Echo sub-function
        respLen = 2;
      } else {
        respLen = 1;
      }
      break;

    case 0x22: // ReadDataByIdentifier
      if (dlc >= 3) {
        uint16_t did = ((uint16_t)data[1] << 8) | data[2];
        respData[0] = 0x62; // Positive response
        respData[1] = data[1];
        respData[2] = data[2];
        respLen = 3;

        switch (did) {
          case 0xF190: // VIN
            memcpy(respData + 3, "DEMO12345678VIN1", 8);
            respLen = 11;
            break;
          case 0xF18E: // Engine type
            respData[3] = 0x04; // 4-cylinder
            respLen = 4;
            break;
          case 0x0110: // Engine RPM
            {
              uint16_t rpm16 = (sensors.engineRPM * 4) / 10;
              respData[3] = (uint8_t)((rpm16 >> 8) & 0xFF);
              respData[4] = (uint8_t)(rpm16 & 0xFF);
              respLen = 5;
            }
            break;
          default:
            // DID not supported
            respData[0] = 0x7F;
            respData[1] = 0x22;
            respData[2] = 0x31;
            respLen = 3;
            break;
        }
      }
      break;

    case 0x27: // SecurityAccess
      if (dlc >= 2) {
        uint8_t subFunc = data[1];
        if ((subFunc & 0x01) == 0) {
          // Seed request (even sub-function)
          respData[0] = 0x67;
          respData[1] = subFunc;
          respData[2] = (uint8_t)((security.seedValue >> 24) & 0xFF);
          respData[3] = (uint8_t)((security.seedValue >> 16) & 0xFF);
          respData[4] = (uint8_t)((security.seedValue >> 8) & 0xFF);
          respData[5] = (uint8_t)(security.seedValue & 0xFF);
          respLen = 6;
        } else {
          // Key submission (odd sub-function)
          // Simple seed/key algorithm: key = seed XOR 0xAAAAAAAA
          uint32_t expectedKey = security.seedValue ^ 0xAAAAAAAA;
          if (dlc >= 6) {
            uint32_t submittedKey = ((uint32_t)data[2] << 24) |
                                    ((uint32_t)data[3] << 16) |
                                    ((uint32_t)data[4] << 8) |
                                    data[5];
            if (submittedKey == expectedKey) {
              security.unlocked = true;
              respData[0] = 0x67;
              respData[1] = subFunc;
              respLen = 2;
            } else {
              respData[0] = 0x7F;
              respData[1] = 0x27;
              respData[2] = 0x35; // Security access denied
              respLen = 3;
            }
          }
        }
      }
      break;

    default:
      // Service not supported
      respData[0] = 0x7F;
      respData[1] = service;
      respData[2] = 0x11; // Service not supported
      respLen = 3;
      break;
  }

  if (respLen > 0) {
    CAN0.sendMsgBuf(respId, 0, respLen, respData);
    printFrameLine("TX", respId, false, respLen, respData);
  }
}

// ============================================================================
// Serial Command Handler
// ============================================================================

static void handleCommand(const char *line) {
  // PROTO,6
  // TX,7DF,0,02010C0000000000
  // ENGINE,ON|OFF
  // STAT

  if (strncmp(line, "PROTO,", 6) == 0) {
    uint8_t p = (uint8_t)atoi(line + 6);
    bool ok = applyProto(p);
    Serial.print("INFO,PROTO,");
    Serial.println(ok ? "OK" : "FAIL");
    return;
  }

  if (strncmp(line, "TX,", 3) == 0) {
    // TX,<ID_HEX>,<EXT>,<DATA_HEX>
    char tmp[160];
    strncpy(tmp, line, sizeof(tmp)-1);
    tmp[sizeof(tmp)-1] = 0;

    char *tok = strtok(tmp, ","); // TX
    char *idHex = strtok(NULL, ",");
    char *extStr = strtok(NULL, ",");
    char *dataHex = strtok(NULL, ",");

    if (!idHex || !extStr || !dataHex) return;

    uint32_t id = strtoul(idHex, NULL, 16);
    bool ext = (atoi(extStr) != 0);

    uint8_t data[8] = {0};
    uint8_t dlc = 0;
    size_t n = strlen(dataHex);
    for (size_t i = 0; i + 1 < n && dlc < 8; i += 2) {
      char hh[3] = { dataHex[i], dataHex[i+1], 0 };
      data[dlc++] = (uint8_t)strtoul(hh, NULL, 16);
    }

    byte st = CAN0.sendMsgBuf(id, ext ? 1 : 0, dlc, data);
    (void)st;
    printFrameLine("TX", id, ext, dlc, data);
    return;
  }

  if (strncmp(line, "ENGINE,", 7) == 0) {
    if (strcmp(line + 7, "ON") == 0) {
      sensors.engineRunning = true;
      sensors.startTime = millis();
      sendInfo("ENGINE_ON");
    } else if (strcmp(line + 7, "OFF") == 0) {
      sensors.engineRunning = false;
      sendInfo("ENGINE_OFF");
    }
    return;
  }

  if (strcmp(line, "STAT") == 0) {
    Serial.print("STAT,RPM=");
    Serial.print(sensors.engineRPM);
    Serial.print(",LOAD=");
    Serial.print(sensors.engineLoad);
    Serial.print(",COOLANT=");
    Serial.print(sensors.coolantTemp);
    Serial.print(",SPEED=");
    Serial.print(sensors.speed);
    Serial.print(",RUNNING=");
    Serial.println(sensors.engineRunning ? 1 : 0);
    return;
  }
}

// ============================================================================
// Setup & Main Loop
// ============================================================================

void setup() {
  Serial.begin(115200);
  while (!Serial) { delay(10); }

  bool ok = applyProto(bus.proto);
  sendInfo(ok ? "BOOT_OK" : "BOOT_FAIL");

  // Set random seed
  randomSeed(millis() ^ micros());
}

void loop() {
  // ========== Serial line reader ==========
  while (Serial.available() > 0) {
    char c = (char)Serial.read();
    if (c == '\r') continue;
    if (c == '\n') {
      lineBuf[lineLen] = 0;
      if (lineLen > 0) handleCommand(lineBuf);
      lineLen = 0;
    } else {
      if (lineLen < sizeof(lineBuf) - 1) lineBuf[lineLen++] = c;
    }
  }

  // ========== CAN RX Handler ==========
  if (digitalRead(CAN_INT_PIN) == LOW) {
    unsigned long rxId = 0;
    unsigned char ext = 0;
    unsigned char len = 0;
    unsigned char buf[8];

    if (CAN0.readMsgBuf(&rxId, &ext, &len, buf) == CAN_OK) {
      printFrameLine("RX", (uint32_t)rxId, ext != 0, (uint8_t)len, buf);

      // Route to appropriate handler
      if (rxId == 0x7DF || (rxId >= 0x7E0 && rxId <= 0x7E7)) {
        // OBD-II request
        handleOBDRequest(rxId, len, buf);
      } else if (rxId >= 0x7E0 && rxId <= 0x7FF) {
        // UDS request (0x7E0-0x7FF range)
        handleUDSRequest(rxId, len, buf);
      }
    }
  }

  // ========== Periodic sensor update ==========
  updateSensors();
}
