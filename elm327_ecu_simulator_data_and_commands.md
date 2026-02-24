This report details common ELM327 PIDs (Parameter IDs) and diagnostic commands critical for developing a realistic web-based ECU simulator. It covers essential commands, their formats, data ranges, and considerations for underlying OBD-II protocols and simulator behavior.

## 1. ELM327 AT Commands for Communication Setup and Control

ELM327 devices use AT (Attention) commands for configuring the interface, selecting protocols, and managing communication. Key commands for a simulator include [ref: 0-0, 0-1, 0-4, 0-6, 0-9]:

|Command|Description|Group|Common Usage for Simulator|
|---|---|---|---|
|ATZ|Reset all|General|Initial device reset|
|AT@1|Display the device description|General|Identify ELM327 version (e.g., "ELM327 v1.5")|
|AT@2|Display the device identifier|General|Get unique device ID|
|ATE0|Echo Off|General|Disable echoing of commands for cleaner responses|
|ATE1|Echo On|General|Enable echoing of commands|
|ATL0|Linefeeds Off|General|Suppress linefeeds after carriage returns for compact responses|
|ATL1|Linefeeds On|General|Enable linefeeds|
|ATH0|Headers Off|OBD|Suppress header bytes in responses|
|ATH1|Headers On|OBD|Include header bytes in responses (often needed for full context)|
|ATS0|Printing of Spaces Off|OBD|Suppress spaces in responses for compact data|
|ATS1|Printing of Spaces On|OBD|Include spaces for readability|
|ATDP|Describe the current Protocol|OBD|Report the active OBD protocol|
|ATDPN|Describe the Protocol by Number|OBD|Report the active OBD protocol by its number|
|ATSP0|Set Protocol to Auto and save it|OBD|Automatically detect and set the communication protocol|
|ATSPh|Set Protocol to h and save it|OBD|Manually set protocol (e.g., `ATSP6` for ISO 15765-4 CAN 11-bit 500kbps) [ref: 0-5]|
|ATSThh|Set Timeout to hh x 4 msec|OBD|Adjust response timeout (default often 200ms with `ST32`)|
|ATRV|Read the Voltage|Voltage|Read battery voltage|
|ATCAF0|CAN Automatic Formatting Off|CAN|Disable automatic CAN formatting|
|ATCAF1|CAN Automatic Formatting On|CAN|Enable automatic CAN formatting (often used with ISO-15765)|
|ATCFC0|CAN Flow Control Off|CAN|Disable CAN flow control|
|ATCFC1|CAN Flow Control On|CAN|Enable CAN flow control|
|ATFI|Perform a Fast Initiation|ISO|For ISO protocols|
|ATSI|Perform a Slow Initiation|ISO|For ISO protocols|
|ATWM|Set the Wakeup Message|ISO|Configure wake-up messages for ISO protocols|

**Typical Initialization Sequence for Simulator:**
A common initialization sequence for an ELM327 simulator to prepare for OBD-II communication might involve [ref: 0-5]:
`ATZ` (Reset ELM327)
`ATE0` (Echo Off)
`ATL0` (Linefeeds Off)
`ATH1` (Headers On - often desired for parsing full CAN frames)
`ATS0` (Spaces Off)
`ATSP0` (Auto Protocol Search) or `ATSP6` (Force CAN 11-bit, 500kbps)

## 2. Essential OBD-II Diagnostic Commands (Modes) and PIDs

OBD-II communication operates through various "Modes" (or services), each providing a different type of diagnostic information [ref: 1-3, 2-2, 2-9].

### 2.1 Mode 01: Request Current Powertrain Diagnostic Data (Live Data)

Mode 01 PIDs are crucial for real-time engine parameter monitoring [ref: 1-0, 1-3, 2-2, 2-9].

|PID (Hex)|Description|Data Bytes|Units|Min Value|Max Value|Formula (A, B are hex data bytes converted to decimal)|Typical Range for Simulation|
|---|---|---|---|---|---|---|---|
|00|PIDs supported [01 - 20]|4|Bit Encoded|N/A|N/A|Bit A7 to D0 map to PIDs 01-20 supported [ref: 1-0, 1-2]|Simulator must report `01-20` if supported.|
|01|Monitor status since DTCs cleared|4|Bit Encoded|N/A|N/A|MIL status (A7), DTC count (A6-A0), Monitor completion status (B,C,D) [ref: 1-0, 1-3]|Simulate MIL on/off, varying DTC counts.|
|04|Calculated engine load value|1|%|0|100|A * 100 / 255 [ref: 1-2, 1-5]|0-100%|
|05|Engine coolant temperature|1|°C|-40|215|A - 40 [ref: 1-0, 1-2, 1-5]|80-105°C (warm engine)|
|0B|Intake manifold absolute pressure|1|kPa|0|255|A [ref: 1-2, 1-5]|30-100 kPa (idle to WOT)|
|0C|Engine RPM|2|rpm|0|16383.75|((A * 256) + B) / 4 [ref: 1-0, 1-2, 1-5]|600-6000 rpm|
|0D|Vehicle speed|1|km/h|0|255|A [ref: 1-0, 1-2, 1-5]|0-200 km/h|
|0E|Timing advance|1|°|-64|63.5|(A - 128) / 2 [ref: 1-2, 1-5]|-10 to 45°|
|0F|Intake air temperature|1|°C|-40|215|A - 40 [ref: 1-2, 1-5]|Current ambient temp|
|10|MAF air flow rate|2|grams/sec|0|655.35|((A * 256) + B) / 100 [ref: 1-2, 1-5]|0-600 g/s|
|11|Throttle position|1|%|0|100|A * 100 / 255 [ref: 1-2, 1-5]|0-100%|
|1F|Run time since engine start|2|seconds|0|65535|(A * 256) + B [ref: 1-0, 1-2]|0-Max|
|20|PIDs supported [21 - 40]|4|Bit Encoded|N/A|N/A|Bit A7 to D0 map to PIDs 21-40 supported [ref: 1-0, 1-2]|Simulator must report `21-40` if supported.|
|2F|Fuel Level Input|1|%|0|100|A * 100 / 255 [ref: 1-2, 2-1]|0-100%|
|31|Distance traveled since codes cleared|2|km|0|65535|(A * 256) + B [ref: 1-2, 1-5]|0-Max|
|33|Barometric pressure|1|kPa|0|255|A [ref: 1-2, 2-1]|70-105 kPa|
|40|PIDs supported [41 - 60]|4|Bit Encoded|N/A|N/A|Bit A7 to D0 map to PIDs 41-60 supported [ref: 1-0, 1-2]|Simulator must report `41-60` if supported.|
|42|Control module voltage|2|V|0|65.535|((A * 256) + B) / 1000 [ref: 2-1]|11-15V|
|46|Ambient air temperature|1|°C|-40|215|A - 40 [ref: 2-1]|Current ambient temp|
|4F|Engine oil temperature|1|°C|-40|215|A - 40 [ref: 2-1]|70-130°C|

### 2.2 Other Essential OBD-II Modes

|Mode (Hex)|Description|Usage for Simulator|
|---|---|---|
|02|Request Powertrain Freeze Frame Data|Retrieve a snapshot of engine parameters at the moment an emissions-related DTC was stored [ref: 1-3, 2-0, 2-2, 2-9]. Simulator must store and provide consistent data for a *specific* DTC.|
|03|Show Stored Diagnostic Trouble Codes (DTCs)|Retrieve emission-related Diagnostic Trouble Codes (DTCs) that are confirmed and stored [ref: 1-3, 2-2, 2-9]. Simulator should generate realistic DTCs (e.g., P0130 [ref: 2-0]).|
|04|Clear/Reset Emission Related Diagnostic Information|Clear stored DTCs, freeze frame data, and reset diagnostic monitoring information [ref: 1-3, 2-2, 2-9]. Simulator must clear these states.|
|07|Show Pending Diagnostic Trouble Codes|Retrieve DTCs detected during the current or last driving cycle that haven't matured into stored DTCs [ref: 1-3, 2-2, 2-9]. Simulator should simulate intermittent faults that become pending.|
|09|Request Vehicle Information|Retrieve vehicle information such as VIN (Vehicle Identification Number) and calibration IDs [ref: 1-3, 2-2, 2-9]. Simulator must provide static VIN/calibration data.|
|0A|Permanent Diagnostic Trouble Codes (DTCs)|Retrieve DTCs that are "permanent" and cannot be cleared until the system confirms the fault is resolved over multiple drive cycles [ref: 1-3, 2-2, 2-9]. Simulator should manage these based on resolution criteria.|

### 2.3 Non-Standard / Extended PIDs

While SAE J1979 defines standard PIDs, manufacturers often implement additional, non-standard PIDs for vehicle-specific data (e.g., EV battery state of health) [ref: 0-5, 1-3, 1-7]. Simulating these requires reverse-engineered data (e.g., Hyundai Ioniq 9 `2201019` for SoC) [ref: 0-5].

## 3. Request and Response Formats

### 3.1 ELM327 AT Command Format

*   **Request:** AT command string (e.g., `ATZ`, `ATSP6`, `ATE0`) [ref: 0-5].
*   **Response:**
    *   `OK`: Command successful (e.g., after `ATE0`) [ref: 0-5].
    *   Specific data: (e.g., `ELM327 v1.5` for `AT@1`, `12.5V` for `ATRV`) [ref: 0-9].
    *   `?` or `ERROR`: Invalid command.
    *   `NO DATA`: Valid command, but no data received from ECU or data is not applicable [ref: 0-9].

### 3.2 OBD-II PID Request and Response Format (CAN Example)

The ELM327 acts as a bridge between a diagnostic tool and the vehicle's ECU. For CAN-based systems (ISO 15765-4), the communication structure typically involves [ref: 1-0, 1-5, 2-1, 2-9]:

*   **Request Message (e.g., requesting Engine RPM):**
    *   **CAN ID:** `7DF` (Diagnostic Tester physical address) [ref: 1-5, 2-1].
    *   **Payload (Data Bytes):** `02 01 0C`
        *   `02`: Number of data bytes following (2 bytes: Mode and PID) [ref: 1-5, 2-1, 2-9].
        *   `01`: Service Mode (Request Current Powertrain Diagnostic Data) [ref: 1-0, 2-1, 2-9].
        *   `0C`: PID (Engine RPM) [ref: 1-0, 2-1, 2-9].

*   **Response Message (e.g., for Engine RPM 643 rpm):**
    *   **CAN ID:** `7E8` (ECU physical address, usually `7E0 + 8` for the response) [ref: 1-5, 2-1].
    *   **Payload (Data Bytes):** `03 41 0C 0A 0C`
        *   `03`: Number of data bytes following (3 bytes: Response Mode, PID, Data) [ref: 1-5, 2-1, 2-9].
        *   `41`: Positive response to Mode `01` (original mode `01` + `0x40`) [ref: 1-0, 2-1, 2-9].
        *   `0C`: Responding PID (Engine RPM) [ref: 1-0, 2-1, 2-9].
        *   `0A 0C`: Data bytes (A=0A, B=0C in hex; 10, 12 in decimal) [ref: 1-5].

**Interpretation of Data Bytes:**
For the Engine RPM example, data `0A 0C` (decimal 10, 12):
*   `raw_value_decimal` = `(10 * 256) + 12 = 2572` [ref: 1-5].
*   Formula: `physical_value = ((A * 256) + B) / 4` [ref: 1-0, 1-2, 1-5].
*   `643 rpm = 2572 / 4` [ref: 1-5].

**Negative Responses:**
If a request is unsupported or invalid, the ECU typically responds with a negative response. The ELM327 interface would translate this to `NO DATA` [ref: 0-9]. For example, a negative response for mode `01` would be `7F 01 XX` where `XX` is the negative response code. A simulator should mimic `NO DATA` or specific negative responses for unsupported PIDs.

## 4. Influence of OBD-II Protocols

The ELM327 chip supports several OBD-II protocols, including [ref: 0-2, 0-3, 0-7, 1-6, 2-3, 2-7]:
*   ISO 9141-2
*   ISO 14230-4 (KWP2000)
*   SAE J1850 PWM
*   SAE J1850 VPW
*   ISO 15765-4 (CAN)
*   SAE J1939 (for heavy-duty vehicles/trucks)

Since 2008, all vehicles sold in the US are required to use ISO 15765-4 (CAN) as the OBD-II basis [ref: 1-6, 2-3]. CAN systems transmit data faster and allow for expanded data lists [ref: 1-1]. The choice of protocol affects the physical layer communication, but the ELM327 abstracts much of this away, allowing a consistent AT command interface. However, a simulator must correctly implement the chosen protocol's message formatting (e.g., CAN IDs, data length codes (DLC), flow control for multi-frame messages) [ref: 0-0, 0-5, 0-9, 2-6]. For instance, `ATCF` (CAN Filter) and `ATCM` (CAN Mask) commands are specific to CAN protocol filtering [ref: 0-0, 0-9].

## 5. Simulator Behavior for Uncommon Scenarios

A realistic ECU simulator should handle:
*   **Unsupported PIDs:** When a request for an unsupported PID is made, the simulator should respond with `NO DATA` (as ELM327 does) or a negative response indicating non-support [ref: 0-9].
*   **Invalid Commands:** Invalid AT commands or malformed OBD requests should result in `?` or `ERROR` responses.
*   **Specific Diagnostic States:**
    *   **Pending DTCs:** Simulate scenarios where faults are detected but not yet confirmed, providing a list of pending codes via Mode `07` [ref: 2-2].
    *   **Freeze Frame Data:** If no DTCs are stored, a Mode `02` request should return no data or indicate no freeze frame data is available [ref: 1-2]. If DTCs exist, freeze frame data should correspond to the conditions when the DTC was logged [ref: 2-0, 2-5].

## 6. Prioritization for Simulation

For a general-purpose ECU simulator, prioritization should focus on:
1.  **Core ELM327 AT Commands:** `ATZ`, `ATE0`, `ATL0`, `ATH1`, `ATS0`, `ATSP0`/`ATSPx` are essential for establishing and configuring communication [ref: 0-5].
2.  **Universally Supported Mode 01 PIDs:** The PIDs listed in section 2.1 (RPM, speed, coolant temp, engine load, throttle position, intake air temp) are fundamental and frequently requested [ref: 1-0, 1-2, 1-5]. The `0100` PID for supported PIDs is critical for discoverability [ref: 1-0].
3.  **Essential Diagnostic Modes:** Mode `03` (read DTCs) and `04` (clear DTCs) are core diagnostic functions. Mode `02` (freeze frame) and `09` (vehicle info) are also highly important for a comprehensive simulator [ref: 1-3, 2-2, 2-9].
4.  **Realistic Data Generation:** For key PIDs, the simulator should generate dynamic data within specified min/max ranges and apply the correct scaling/conversion formulas to produce realistic values that change over time, mimicking vehicle operation (e.g., increasing RPM and speed, fluctuating temperatures) [ref: 1-0, 1-2, 1-5, 1-7].

By accurately mimicking these commands, PIDs, and their expected behaviors, a web-based ECU simulator can provide a robust and realistic testing environment for ELM327 protocol emulation.