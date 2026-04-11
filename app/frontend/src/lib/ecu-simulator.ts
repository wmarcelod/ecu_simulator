// ============================================================
// ECU Simulator Engine - Core simulation logic
// ============================================================

export interface VehicleProfile {
  id: string;
  name: string;
  type: 'sedan' | 'suv' | 'sport' | 'dbc';
  vin: string;
  calibrationId: string;
  supportedPids: Record<string, number[]>;
  pidRanges: Record<string, { min: number; max: number; idle: number }>;
  dtcs: { stored: string[]; pending: string[]; permanent: string[] };
  description: string;
}

export interface SensorState {
  rpm: number;
  speed: number;
  coolantTemp: number;
  engineLoad: number;
  throttle: number;
  intakeMAP: number;
  mafRate: number;
  timingAdvance: number;
  intakeAirTemp: number;
  fuelLevel: number;
  ambientTemp: number;
  controlVoltage: number;
  oilTemp: number;
  baroPressure: number;
  runTime: number;
  [key: string]: number; // Allow dynamic DBC signals
}

export type SensorMode = 'auto' | 'manual';

export interface SensorModeState {
  mode: SensorMode;
  manualValue: number;
}

export interface SimulatorConfig {
  echoEnabled: boolean;
  headersEnabled: boolean;
  spacesEnabled: boolean;
  linefeedsEnabled: boolean;
  protocol: string;
  milOn: boolean;
}

export type SimScenario = 'idle' | 'acceleration' | 'cruise' | 'deceleration';

// Vehicle Profiles
const VEHICLE_PROFILES: VehicleProfile[] = [
  {
    id: 'sedan',
    name: 'Generic Sedan 2.0L',
    type: 'sedan',
    vin: '1HGBH41JXMN109186',
    calibrationId: 'SED20L_CAL_V1',
    description: '2.0L 4-cylinder sedan, typical commuter vehicle',
    supportedPids: {
      '00': [0xBE, 0x3E, 0xB8, 0x13],
      '20': [0x80, 0x05, 0x00, 0x00],
      '40': [0x68, 0x08, 0x00, 0x00],
    },
    pidRanges: {
      rpm: { min: 650, max: 6500, idle: 750 },
      speed: { min: 0, max: 200, idle: 0 },
      coolantTemp: { min: 80, max: 105, idle: 90 },
      engineLoad: { min: 0, max: 100, idle: 20 },
      throttle: { min: 0, max: 100, idle: 12 },
      intakeMAP: { min: 20, max: 100, idle: 35 },
      mafRate: { min: 1, max: 250, idle: 4 },
      timingAdvance: { min: -10, max: 40, idle: 10 },
      intakeAirTemp: { min: 15, max: 50, idle: 25 },
      fuelLevel: { min: 0, max: 100, idle: 65 },
      ambientTemp: { min: -10, max: 45, idle: 22 },
      controlVoltage: { min: 12, max: 14.5, idle: 13.8 },
      oilTemp: { min: 70, max: 130, idle: 95 },
      baroPressure: { min: 95, max: 105, idle: 101 },
    },
    dtcs: {
      stored: ['P0130', 'P0420'],
      pending: ['P0171'],
      permanent: ['P0130'],
    },
  },
  {
    id: 'suv',
    name: 'Generic SUV 3.5L V6',
    type: 'suv',
    vin: '5YJSA1DG9DFP14705',
    calibrationId: 'SUV35V6_CAL_V2',
    description: '3.5L V6 SUV, higher torque and fuel consumption',
    supportedPids: {
      '00': [0xBE, 0x3E, 0xB8, 0x13],
      '20': [0x80, 0x05, 0x00, 0x00],
      '40': [0x68, 0x08, 0x00, 0x00],
    },
    pidRanges: {
      rpm: { min: 600, max: 6000, idle: 700 },
      speed: { min: 0, max: 220, idle: 0 },
      coolantTemp: { min: 82, max: 110, idle: 92 },
      engineLoad: { min: 0, max: 100, idle: 25 },
      throttle: { min: 0, max: 100, idle: 14 },
      intakeMAP: { min: 22, max: 105, idle: 38 },
      mafRate: { min: 2, max: 350, idle: 6 },
      timingAdvance: { min: -8, max: 38, idle: 12 },
      intakeAirTemp: { min: 15, max: 55, idle: 25 },
      fuelLevel: { min: 0, max: 100, idle: 55 },
      ambientTemp: { min: -10, max: 45, idle: 22 },
      controlVoltage: { min: 12, max: 14.8, idle: 14.0 },
      oilTemp: { min: 72, max: 135, idle: 98 },
      baroPressure: { min: 95, max: 105, idle: 101 },
    },
    dtcs: {
      stored: ['P0300', 'P0442'],
      pending: ['P0455'],
      permanent: ['P0300'],
    },
  },
  {
    id: 'sport',
    name: 'Sport Coupe 3.0L Turbo',
    type: 'sport',
    vin: 'WBAJB0C51JB084264',
    calibrationId: 'SPT30T_CAL_V3',
    description: '3.0L Turbocharged sport coupe, high performance',
    supportedPids: {
      '00': [0xBE, 0x3E, 0xB8, 0x13],
      '20': [0x80, 0x05, 0x00, 0x00],
      '40': [0x68, 0x08, 0x00, 0x00],
    },
    pidRanges: {
      rpm: { min: 700, max: 8000, idle: 850 },
      speed: { min: 0, max: 280, idle: 0 },
      coolantTemp: { min: 78, max: 115, idle: 88 },
      engineLoad: { min: 0, max: 100, idle: 18 },
      throttle: { min: 0, max: 100, idle: 10 },
      intakeMAP: { min: 25, max: 250, idle: 40 },
      mafRate: { min: 2, max: 500, idle: 5 },
      timingAdvance: { min: -15, max: 45, idle: 14 },
      intakeAirTemp: { min: 10, max: 60, idle: 25 },
      fuelLevel: { min: 0, max: 100, idle: 70 },
      ambientTemp: { min: -10, max: 45, idle: 22 },
      controlVoltage: { min: 12, max: 14.6, idle: 13.9 },
      oilTemp: { min: 75, max: 140, idle: 100 },
      baroPressure: { min: 95, max: 105, idle: 101 },
    },
    dtcs: {
      stored: ['P0172', 'P0301'],
      pending: ['P0128'],
      permanent: [],
    },
  },
];

export function getVehicleProfiles(): VehicleProfile[] {
  return VEHICLE_PROFILES;
}

export function getProfileById(id: string): VehicleProfile | undefined {
  return VEHICLE_PROFILES.find((p) => p.id === id);
}

// Noise generator (uniform)
function addNoise(value: number, amplitude: number): number {
  return value + (Math.random() - 0.5) * 2 * amplitude;
}

// Gaussian noise using Box-Muller transform (more realistic sensor noise)
function gaussianNoise(std: number): number {
  const u1 = Math.random();
  const u2 = Math.random();
  return std * Math.sqrt(-2 * Math.log(Math.max(u1, 1e-10))) * Math.cos(2 * Math.PI * u2);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// ============================================================
// ML Correlation Model Parameters
// Derived from sensor_correlation_model.json (David's analysis)
// ============================================================
const ML_MODEL = {
  // Regression: throttle + RPM → Engine Load (R² = 0.974)
  // load = c0*throttle + c1*rpm + c2*throttle² + c3*throttle*rpm + c4*rpm² + intercept
  throttle_rpm_to_load: {
    coefficients: [0.29684996, -0.00257813, 0.00365512, 7.3e-05, 1.2e-06],
    intercept: 12.56645,
  },
  // Regression: throttle + RPM → MAP (R² = 0.992)
  // MAP = c0*throttle + c1*rpm + c2*throttle² + c3*throttle*rpm + c4*rpm² + intercept
  throttle_rpm_to_map: {
    coefficients: [0.70110757, 0.00072796, -1.709e-05, -2.3e-07, 2e-08],
    intercept: 29.430312,
  },
  // Gear model for speed calculation
  gear_model: {
    gear_ratios: [3.6, 2.0, 1.4, 1.0, 0.8],
    final_drive: 3.5,
    tire_circumference_m: 2.0,
    shift_points_kmh: [0, 15, 30, 50, 80],
  },
  // Gaussian noise profiles (σ per sensor)
  noise: {
    rpm: 15,
    speed: 0.5,
    coolant_temp: 0.3,
    intake_air_temp: 0.5,
    throttle: 0.3,
    engine_load: 1.5,
    maf: 0.3,
    map_kpa: 1.0,
    voltage: 0.2,
    fuel_level: 0.1,
    oil_temp: 0.3,
    baro: 0.2,
    timing: 0.5,
  },
  // Transition time constants (seconds → converted to ticks in tick())
  transition: {
    throttle_tau_s: 0.3,
    rpm_accel_tau_s: 1.0,
    rpm_decel_tau_s: 1.5,
    speed_tau_s: 3.0,
    coolant_warmup_tau_s: 300,
    oil_temp_tau_s: 40,
  },
  // Thermal model
  thermal: {
    coolant_warmup_rate_degC_per_sec: 0.05,
    coolant_target_temp: 90,
    coolant_thermostat_threshold: 85,
    coolant_overheat_threshold: 105,
    oil_temp_follows_coolant_delay_sec: 40,
    oil_temp_offset_under_load: 10,
    iat_above_ambient_idle: 3,
    iat_above_ambient_load: 10,
  },
  // Fuel consumption
  fuel: {
    idle_consumption_ml_per_sec: 0.15,
    consumption_factor_per_maf: 0.07,
    tank_capacity_liters: 55,
  },
  // Voltage model
  voltage: {
    engine_running_min: 13.2,
    engine_running_max: 14.8,
    engine_running_nominal: 14.0,
    engine_off_min: 11.8,
    engine_off_max: 12.8,
    engine_off_nominal: 12.4,
  },
  // Scenario throttle targets (from scenario_statistics)
  scenario_targets: {
    idle: { throttle_mean: 2.4, throttle_std: 0.5 },
    acceleration: { throttle_mean: 53.5, throttle_std: 7.3 },
    cruise: { throttle_mean: 19.3, throttle_std: 4.1 },
    deceleration: { throttle_mean: 0.6, throttle_std: 1.7 },
  },
} as const;

// Default sensor keys (built-in)
const DEFAULT_SENSOR_KEYS: (keyof SensorState)[] = [
  'rpm', 'speed', 'coolantTemp', 'engineLoad', 'throttle',
  'intakeMAP', 'mafRate', 'timingAdvance', 'intakeAirTemp',
  'fuelLevel', 'ambientTemp', 'controlVoltage', 'oilTemp',
  'baroPressure',
];

// ============================================================
// UDS (ISO 14229) Service Constants
// ============================================================
export const UDS_SERVICES = {
  0x10: 'DiagnosticSessionControl',
  0x11: 'ECUReset',
  0x14: 'ClearDiagnosticInformation',
  0x19: 'ReadDTCInformation',
  0x22: 'ReadDataByIdentifier',
  0x27: 'SecurityAccess',
  0x28: 'CommunicationControl',
  0x2E: 'WriteDataByIdentifier',
  0x3E: 'TesterPresent',
  0x85: 'ControlDTCSetting',
} as const;

export const UDS_NRC = {
  0x10: 'generalReject',
  0x11: 'serviceNotSupported',
  0x12: 'subFunctionNotSupported',
  0x13: 'incorrectMessageLength',
  0x22: 'conditionsNotCorrect',
  0x31: 'requestOutOfRange',
  0x33: 'securityAccessDenied',
  0x35: 'invalidKey',
  0x78: 'responsePending',
} as const;

// ============================================================
// ECU Simulator Class
// ============================================================
export class ECUSimulator {
  private profile: VehicleProfile;
  private config: SimulatorConfig;
  private sensors: SensorState;
  private running: boolean = false;
  private scenario: SimScenario = 'idle';
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private startTime: number = Date.now();
  private storedDTCs: string[];
  private pendingDTCs: string[];
  private permanentDTCs: string[];
  private listeners: Array<(state: SensorState) => void> = [];
  private logListeners: Array<(cmd: string, resp: string) => void> = [];
  private sensorLog: Array<{ timestamp: number; state: SensorState }> = [];
  private commandLog: Array<{ timestamp: number; command: string; response: string }> = [];
  private logStartTime: number = Date.now();
  private sensorLogInterval: ReturnType<typeof setInterval> | null = null;

  // Independent sensor modes
  private sensorModes: Record<string, SensorModeState> = {};

  // DBC custom profiles
  private customProfiles: VehicleProfile[] = [];
  private dbcSignals: Record<string, number> = {};

  // ============================================================
  // UDS Session and Security State
  // ============================================================
  private udsSession: number = 0x01; // 0x01 = Default Session
  private securityLevel: number = 0; // 0 = locked, 1 = unlocked
  private securitySeed: number = 0; // Current seed value
  private dtcSettingEnabled: boolean = true; // DTC recording enabled
  private communicationEnabled: boolean = true; // Communication enabled
  private didStorage: Record<string, number[]> = {}; // Writable DID storage

  constructor(profileId: string = 'sedan') {
    this.profile = getProfileById(profileId) || VEHICLE_PROFILES[0];
    this.config = {
      echoEnabled: true,
      headersEnabled: false,
      spacesEnabled: true,
      linefeedsEnabled: true,
      protocol: 'AUTO',
      milOn: this.profile.dtcs.stored.length > 0,
    };
    this.sensors = this.getIdleState();
    this.storedDTCs = [...this.profile.dtcs.stored];
    this.pendingDTCs = [...this.profile.dtcs.pending];
    this.permanentDTCs = [...this.profile.dtcs.permanent];

    // Initialize all default sensors to AUTO mode
    for (const key of DEFAULT_SENSOR_KEYS) {
      this.sensorModes[key] = { mode: 'auto', manualValue: this.sensors[key] };
    }
  }

  private getIdleState(): SensorState {
    const r = this.profile.pidRanges;
    return {
      rpm: r.rpm?.idle ?? 750,
      speed: r.speed?.idle ?? 0,
      coolantTemp: r.coolantTemp?.idle ?? 90,
      engineLoad: r.engineLoad?.idle ?? 20,
      throttle: r.throttle?.idle ?? 12,
      intakeMAP: r.intakeMAP?.idle ?? 35,
      mafRate: r.mafRate?.idle ?? 4,
      timingAdvance: r.timingAdvance?.idle ?? 10,
      intakeAirTemp: r.intakeAirTemp?.idle ?? 25,
      fuelLevel: r.fuelLevel?.idle ?? 65,
      ambientTemp: r.ambientTemp?.idle ?? 22,
      controlVoltage: r.controlVoltage?.idle ?? 13.8,
      oilTemp: r.oilTemp?.idle ?? 95,
      baroPressure: r.baroPressure?.idle ?? 101,
      runTime: 0,
    };
  }

  // ============================================================
  // Sensor Mode Management (AUTO / MANUAL)
  // ============================================================
  getSensorMode(key: string): SensorModeState {
    return this.sensorModes[key] || { mode: 'auto', manualValue: 0 };
  }

  getAllSensorModes(): Record<string, SensorModeState> {
    return { ...this.sensorModes };
  }

  setSensorMode(key: string, mode: SensorMode) {
    if (!this.sensorModes[key]) {
      this.sensorModes[key] = { mode: 'auto', manualValue: this.sensors[key] ?? 0 };
    }
    this.sensorModes[key].mode = mode;
    if (mode === 'manual') {
      this.sensorModes[key].manualValue = this.sensors[key] ?? 0;
    }
  }

  setManualValue(key: string, value: number) {
    if (!this.sensorModes[key]) {
      this.sensorModes[key] = { mode: 'manual', manualValue: value };
    }
    this.sensorModes[key].manualValue = value;
    this.sensorModes[key].mode = 'manual';
    (this.sensors as Record<string, number>)[key] = value;
    this.emitState();
  }

  getManualSensors(): string[] {
    return Object.entries(this.sensorModes)
      .filter(([, v]) => v.mode === 'manual')
      .map(([k]) => k);
  }

  setAllSensorsMode(mode: SensorMode) {
    for (const key of Object.keys(this.sensorModes)) {
      this.sensorModes[key].mode = mode;
      if (mode === 'manual') {
        this.sensorModes[key].manualValue = this.sensors[key] ?? 0;
      }
    }
  }

  // ============================================================
  // DBC Profile Management
  // ============================================================
  addDBCProfile(profile: VehicleProfile) {
    // Remove existing DBC profile with same id
    this.customProfiles = this.customProfiles.filter((p) => p.id !== profile.id);
    this.customProfiles.push(profile);
  }

  getAllProfiles(): VehicleProfile[] {
    return [...VEHICLE_PROFILES, ...this.customProfiles];
  }

  getDBCSignals(): Record<string, number> {
    return { ...this.dbcSignals };
  }

  setDBCSignalValue(key: string, value: number) {
    this.dbcSignals[key] = value;
    (this.sensors as Record<string, number>)[key] = value;
  }

  // ============================================================
  // Event Listeners
  // ============================================================
  onStateChange(listener: (state: SensorState) => void) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  onLog(listener: (cmd: string, resp: string) => void) {
    this.logListeners.push(listener);
    return () => {
      this.logListeners = this.logListeners.filter((l) => l !== listener);
    };
  }

  private emitState() {
    this.listeners.forEach((l) => l({ ...this.sensors }));
  }

  private emitLog(cmd: string, resp: string) {
    this.commandLog.push({
      timestamp: Date.now() - this.logStartTime,
      command: cmd,
      response: resp,
    });
    this.logListeners.forEach((l) => l(cmd, resp));
  }

  private recordSensorSnapshot() {
    this.sensorLog.push({
      timestamp: Date.now() - this.logStartTime,
      state: { ...this.sensors },
    });
    if (this.sensorLog.length > 10000) {
      this.sensorLog = this.sensorLog.slice(-10000);
    }
  }

  getState(): SensorState {
    return { ...this.sensors };
  }

  getProfile(): VehicleProfile {
    return this.profile;
  }

  getConfig(): SimulatorConfig {
    return { ...this.config };
  }

  isRunning(): boolean {
    return this.running;
  }

  getScenario(): SimScenario {
    return this.scenario;
  }

  setScenario(scenario: SimScenario) {
    this.scenario = scenario;
  }

  getStoredDTCs(): string[] {
    return [...this.storedDTCs];
  }

  getPendingDTCs(): string[] {
    return [...this.pendingDTCs];
  }

  getPermanentDTCs(): string[] {
    return [...this.permanentDTCs];
  }

  isMilOn(): boolean {
    return this.config.milOn;
  }

  setMil(on: boolean) {
    this.config.milOn = on;
  }

  addDTC(code: string, type: 'stored' | 'pending' | 'permanent') {
    if (type === 'stored' && !this.storedDTCs.includes(code)) {
      this.storedDTCs.push(code);
      this.config.milOn = true;
    } else if (type === 'pending' && !this.pendingDTCs.includes(code)) {
      this.pendingDTCs.push(code);
    } else if (type === 'permanent' && !this.permanentDTCs.includes(code)) {
      this.permanentDTCs.push(code);
    }
  }

  removeDTC(code: string, type: 'stored' | 'pending' | 'permanent') {
    if (type === 'stored') {
      this.storedDTCs = this.storedDTCs.filter((d) => d !== code);
      if (this.storedDTCs.length === 0) this.config.milOn = false;
    } else if (type === 'pending') {
      this.pendingDTCs = this.pendingDTCs.filter((d) => d !== code);
    } else if (type === 'permanent') {
      this.permanentDTCs = this.permanentDTCs.filter((d) => d !== code);
    }
  }

  clearDTCs() {
    this.storedDTCs = [];
    this.pendingDTCs = [];
    this.config.milOn = false;
  }

  switchProfile(profileId: string) {
    const allProfiles = this.getAllProfiles();
    const newProfile = allProfiles.find((p) => p.id === profileId);
    if (newProfile) {
      this.profile = newProfile;
      this.storedDTCs = [...newProfile.dtcs.stored];
      this.pendingDTCs = [...newProfile.dtcs.pending];
      this.permanentDTCs = [...newProfile.dtcs.permanent];
      this.config.milOn = newProfile.dtcs.stored.length > 0;
      this.sensors = this.getIdleState();

      // Re-initialize sensor modes for the new profile
      this.sensorModes = {};
      for (const key of DEFAULT_SENSOR_KEYS) {
        this.sensorModes[key] = { mode: 'auto', manualValue: this.sensors[key] ?? 0 };
      }
      // Add DBC signal modes if applicable
      if (newProfile.type === 'dbc') {
        for (const key of Object.keys(newProfile.pidRanges)) {
          if (!this.sensorModes[key]) {
            const range = newProfile.pidRanges[key];
            this.sensorModes[key] = { mode: 'auto', manualValue: range.idle };
            (this.sensors as Record<string, number>)[key] = range.idle;
          }
        }
      }

      this.emitState();
    }
  }

  setSensorValue(key: keyof SensorState, value: number) {
    // No clamping to profile ranges — allow full OBD-II range from the slider
    (this.sensors as Record<string, number>)[key as string] = value;
    this.emitState();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.startTime = Date.now();
    this.logStartTime = Date.now();
    this.tickInterval = setInterval(() => this.tick(), 200);
    this.sensorLogInterval = setInterval(() => this.recordSensorSnapshot(), 1000);
  }

  stop() {
    this.running = false;
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
    if (this.sensorLogInterval) {
      clearInterval(this.sensorLogInterval);
      this.sensorLogInterval = null;
    }
  }

  getSensorLog(): Array<{ timestamp: number; state: SensorState }> {
    return [...this.sensorLog];
  }

  getCommandLog(): Array<{ timestamp: number; command: string; response: string }> {
    return [...this.commandLog];
  }

  getLogStartTime(): number {
    return this.logStartTime;
  }

  clearLog() {
    this.sensorLog = [];
    this.commandLog = [];
    this.logStartTime = Date.now();
  }

  exportSessionLog(): string {
    const now = new Date();
    const startDate = new Date(this.logStartTime);
    const durationMs = now.getTime() - this.logStartTime;
    const durationSec = Math.floor(durationMs / 1000);
    const durationMin = Math.floor(durationSec / 60);
    const durationRemSec = durationSec % 60;

    const manualSensors = this.getManualSensors();

    const lines: string[] = [];
    lines.push('# ECU SIMULATOR SESSION LOG');
    lines.push(`# Vehicle: ${this.profile.name}`);
    lines.push(`# VIN: ${this.profile.vin}`);
    lines.push(`# Session Start: ${startDate.toISOString()}`);
    lines.push(`# Session End: ${now.toISOString()}`);
    lines.push(`# Duration: ${durationMin}m ${durationRemSec}s`);
    lines.push(`# Sensor Entries: ${this.sensorLog.length}`);
    lines.push(`# Command Entries: ${this.commandLog.length}`);
    if (manualSensors.length > 0) {
      lines.push(`# Manual Override Sensors: ${manualSensors.join(', ')}`);
    }
    lines.push('#');
    lines.push('');

    if (this.commandLog.length > 0) {
      lines.push('## COMMAND LOG');
      lines.push('timestamp_ms,command,response');
      for (const entry of this.commandLog) {
        const resp = entry.response.replace(/,/g, ';').replace(/\n/g, ' | ');
        lines.push(`${entry.timestamp},${entry.command},${resp}`);
      }
      lines.push('');
    }

    if (this.sensorLog.length > 0) {
      lines.push('## SENSOR DATA');
      lines.push('timestamp_ms,rpm,speed,coolantTemp,engineLoad,throttle,intakeMAP,mafRate,timingAdvance,intakeAirTemp,fuelLevel,ambientTemp,controlVoltage,oilTemp,baroPressure,runTime');
      for (const entry of this.sensorLog) {
        const s = entry.state;
        lines.push(
          `${entry.timestamp},${s.rpm.toFixed(0)},${s.speed.toFixed(0)},${s.coolantTemp.toFixed(1)},${s.engineLoad.toFixed(0)},${s.throttle.toFixed(0)},${s.intakeMAP.toFixed(0)},${s.mafRate.toFixed(1)},${s.timingAdvance.toFixed(1)},${s.intakeAirTemp.toFixed(1)},${s.fuelLevel.toFixed(1)},${s.ambientTemp.toFixed(1)},${s.controlVoltage.toFixed(2)},${s.oilTemp.toFixed(1)},${s.baroPressure.toFixed(0)},${s.runTime}`
        );
      }
    }

    return lines.join('\n');
  }

  // ============================================================
  // Simulation Tick — ML-Enhanced Physics-Based Coherent Model
  // ============================================================
  // Uses regression coefficients from sensor_correlation_model.json
  // trained on synthetic + real OBD-II data (David's ML analysis).
  //
  // Causal chain:
  //   scenario → throttle (ML stats) → RPM (inertia τ from ML)
  //   → engineLoad (ML polynomial R²=0.974)
  //   → MAP (ML polynomial R²=0.992)
  //   → MAF = f(RPM, load, displacement)
  //   → speed = f(RPM, gear model from ML)
  //   → coolantTemp, oilTemp (ML thermal model)
  //   → intakeAirTemp (ML IAT model)
  //   → controlVoltage (ML voltage model)
  //   → fuelLevel (ML fuel consumption model)
  //   → timingAdvance = f(RPM, load)
  //   → baroPressure ≈ constant + gaussian noise
  //
  // All noise uses gaussian profiles (σ from ML noise_profiles).
  // All transitions use exponential approach with τ from ML.
  // MANUAL sensors are NEVER modified by auto logic.
  // ============================================================

  private isManual(key: string): boolean {
    const mode = this.sensorModes[key];
    return mode !== undefined && mode.mode === 'manual';
  }

  /** Read the effective value of a sensor (manual value if overridden). */
  private val(key: string): number {
    if (this.isManual(key)) return this.sensorModes[key].manualValue;
    return this.sensors[key] ?? 0;
  }

  /**
   * Smooth exponential approach: current → target.
   * @param tau Time constant in ticks (1 tick = 0.2s).
   *            Use tauFromSeconds() to convert from ML time constants.
   * @param noiseStd Gaussian noise standard deviation to add.
   */
  private approach(current: number, target: number, tau: number, noiseStd: number = 0): number {
    const alpha = 1 - Math.exp(-1 / Math.max(tau, 0.1));
    return current + alpha * (target - current) + gaussianNoise(noiseStd);
  }

  /** Convert seconds to ticks (tick interval = 200ms = 0.2s). */
  private tauTicks(seconds: number): number {
    return seconds / 0.2;
  }

  /**
   * Evaluate ML polynomial regression:
   *   y = c0*x1 + c1*x2 + c2*x1² + c3*x1*x2 + c4*x2² + intercept
   */
  private mlPolynomial(
    model: { coefficients: readonly number[]; intercept: number },
    x1: number,
    x2: number,
  ): number {
    const c = model.coefficients;
    return (
      c[0] * x1 +
      c[1] * x2 +
      c[2] * x1 * x1 +
      c[3] * x1 * x2 +
      c[4] * x2 * x2 +
      model.intercept
    );
  }

  /**
   * Determine current gear based on speed using ML gear model shift points.
   * Returns gear index (0-4) for gear_ratios array.
   */
  private getCurrentGear(speedKmh: number): number {
    const shifts = ML_MODEL.gear_model.shift_points_kmh;
    let gear = 0;
    for (let i = shifts.length - 1; i >= 0; i--) {
      if (speedKmh >= shifts[i]) {
        gear = i;
        break;
      }
    }
    return gear;
  }

  /**
   * Calculate speed from RPM using ML gear model.
   * speed (km/h) = RPM × tire_circumference / (gear_ratio × final_drive) × 60 / 1000
   */
  private rpmToSpeed(rpm: number, gear: number): number {
    const gm = ML_MODEL.gear_model;
    const gearRatio = gm.gear_ratios[gear] ?? gm.gear_ratios[0];
    // RPM → wheel RPM → m/min → km/h
    const wheelRpm = rpm / (gearRatio * gm.final_drive);
    const speedMPerMin = wheelRpm * gm.tire_circumference_m;
    return (speedMPerMin * 60) / 1000;
  }

  private tick() {
    const r = this.profile.pidRanges;
    const s = this.sensors;
    const elapsed = (Date.now() - this.startTime) / 1000;
    s.runTime = Math.floor(elapsed);

    const DT = 0.2; // seconds per tick
    const ml = ML_MODEL;
    const noise = ml.noise;
    const trans = ml.transition;

    // Apply all manual overrides first — these are NEVER changed by auto logic
    for (const [key, modeState] of Object.entries(this.sensorModes)) {
      if (modeState.mode === 'manual') {
        (s as Record<string, number>)[key] = modeState.manualValue;
      }
    }

    // Helper: only update if sensor is in AUTO mode
    const autoSet = (key: string, value: number) => {
      if (this.isManual(key)) return;
      (s as Record<string, number>)[key] = value;
    };

    // ── 1. AMBIENT CONDITIONS (nearly constant) ──────────────
    const baro = this.approach(
      this.val('baroPressure'),
      r.baroPressure.idle,
      this.tauTicks(60), // very slow drift
      noise.baro,
    );
    autoSet('baroPressure', clamp(baro, 90, 110));

    const ambient = this.approach(
      this.val('ambientTemp'),
      r.ambientTemp.idle,
      this.tauTicks(120),
      0.05,
    );
    autoSet('ambientTemp', clamp(ambient, -40, 60));

    // ── 2. THROTTLE (driven by scenario, ML statistics) ──────
    // Use mean ± std from ML scenario_statistics
    const scenarioKey = this.scenario === 'acceleration' ? 'acceleration' : this.scenario;
    const scenarioStats = ml.scenario_targets[scenarioKey];
    const throttleTarget = scenarioStats.throttle_mean + gaussianNoise(scenarioStats.throttle_std);

    const throttle = this.approach(
      this.val('throttle'),
      clamp(throttleTarget, 0, 100),
      this.tauTicks(trans.throttle_tau_s),
      noise.throttle,
    );
    autoSet('throttle', clamp(throttle, 0, 100));

    // ── 3. RPM (driven by throttle, with engine inertia) ─────
    const throttleEff = this.val('throttle');
    const rpmIdle = r.rpm.idle;
    const rpmMax = r.rpm.max;
    // RPM target: idle + throttle proportion of usable range
    const rpmTarget = rpmIdle + (throttleEff / 100) * (rpmMax - rpmIdle) * 0.85;
    // Use different tau for acceleration vs deceleration
    const rpmTauS = rpmTarget > this.val('rpm') ? trans.rpm_accel_tau_s : trans.rpm_decel_tau_s;
    const rpm = this.approach(
      this.val('rpm'),
      rpmTarget,
      this.tauTicks(rpmTauS),
      noise.rpm,
    );
    autoSet('rpm', clamp(rpm, rpmIdle * 0.95, rpmMax));

    // ── 4. ENGINE LOAD (ML polynomial regression, R²=0.974) ──
    // load = f(throttle, rpm) using trained coefficients
    const rpmEff = this.val('rpm');
    const mlLoadTarget = this.mlPolynomial(ml.throttle_rpm_to_load, throttleEff, rpmEff);
    const engineLoad = this.approach(
      this.val('engineLoad'),
      clamp(mlLoadTarget, 0, 100),
      this.tauTicks(0.5),
      noise.engine_load,
    );
    autoSet('engineLoad', clamp(engineLoad, 0, 100));

    // ── 5. MAP (ML polynomial regression, R²=0.992) ──────────
    // MAP = f(throttle, rpm) using trained coefficients
    const mlMapTarget = this.mlPolynomial(ml.throttle_rpm_to_map, throttleEff, rpmEff);
    const intakeMAP = this.approach(
      this.val('intakeMAP'),
      clamp(mlMapTarget, 15, 255),
      this.tauTicks(0.3),
      noise.map_kpa,
    );
    autoSet('intakeMAP', clamp(intakeMAP, 0, 255));

    // ── 6. MAF = f(RPM, engineLoad, displacement) ────────────
    // Physical model: MAF ∝ RPM × volumetric_efficiency × displacement
    // VE approximated by engineLoad/100
    // Scaled to match profile's mafRate range
    const loadEff = this.val('engineLoad');
    const mafScale = r.mafRate.max / (rpmMax / 1000); // g/s per 1000rpm at 100% VE
    const mafBase = (rpmEff / 1000) * (loadEff / 100) * mafScale;
    const mafIdle = r.mafRate.idle;
    const mafTarget = Math.max(mafIdle * 0.5, mafBase);
    const mafRate = this.approach(
      this.val('mafRate'),
      mafTarget,
      this.tauTicks(0.5),
      noise.maf,
    );
    autoSet('mafRate', clamp(mafRate, 0, 655.35));

    // ── 7. SPEED (ML gear model with vehicle inertia) ────────
    // Use gear ratios and shift points from ML model
    const currentSpeed = this.val('speed');
    let speedTarget: number;
    if (this.scenario === 'idle') {
      speedTarget = 0;
    } else {
      // Determine gear from current speed
      const gear = this.getCurrentGear(currentSpeed);
      // Calculate theoretical speed from RPM in current gear
      speedTarget = this.rpmToSpeed(rpmEff, gear);
      // In deceleration, speed target decreases toward 0
      if (this.scenario === 'deceleration') {
        speedTarget = Math.max(0, currentSpeed - 2 * DT * 5); // ~2 km/h per second decel
      }
    }
    const speed = this.approach(
      currentSpeed,
      clamp(speedTarget, 0, r.speed.max),
      this.tauTicks(trans.speed_tau_s),
      noise.speed,
    );
    autoSet('speed', clamp(speed, 0, 255));

    // Auto-transition: if decelerating and stopped, go to idle
    if (this.scenario === 'deceleration') {
      const curSpeed = this.val('speed');
      const curRpm = this.val('rpm');
      if (curSpeed <= 1 && curRpm <= rpmIdle * 1.1) {
        this.scenario = 'idle';
      }
    }

    // ── 8. TIMING ADVANCE = f(RPM, load) ─────────────────────
    // Higher RPM → more advance, higher load → less advance
    const rpmFraction = (rpmEff - rpmIdle) / Math.max(rpmMax - rpmIdle, 1);
    const timingBase = 10 + (rpmFraction * 25) - (loadEff / 100) * 10;
    const timingTarget = clamp(timingBase, r.timingAdvance.min, r.timingAdvance.max);
    const timingAdvance = this.approach(
      this.val('timingAdvance'),
      timingTarget,
      this.tauTicks(0.5),
      noise.timing,
    );
    autoSet('timingAdvance', clamp(timingAdvance, -64, 63.5));

    // ── 9. COOLANT TEMPERATURE (ML thermal model) ────────────
    // Uses parameters from physical_rules.thermal_model
    const ambientEff = this.val('ambientTemp');
    const thermostatTarget = ml.thermal.coolant_target_temp; // 90°C
    const heatInput = loadEff / 100; // 0..1
    // Target: thermostat temp + extra heat from high load
    // Below thermostat threshold, warm up; above, thermostat regulates
    const coolantCurrent = this.val('coolantTemp');
    let coolantTarget: number;
    if (coolantCurrent < ml.thermal.coolant_thermostat_threshold) {
      // Warming up: approach thermostat target at warmup rate
      coolantTarget = thermostatTarget;
    } else {
      // Thermostat regulating: target depends on load
      coolantTarget = thermostatTarget + heatInput * 15 - (1 - heatInput) * 2;
    }
    const coolantTemp = this.approach(
      coolantCurrent,
      coolantTarget,
      this.tauTicks(ml.transition.coolant_warmup_tau_s),
      noise.coolant_temp,
    );
    autoSet('coolantTemp', clamp(coolantTemp, Math.max(ambientEff - 5, -40), 215));

    // ── 10. OIL TEMPERATURE (follows coolant with ML delay) ──
    const coolantEff = this.val('coolantTemp');
    const oilTarget = coolantEff + 5 + heatInput * ml.thermal.oil_temp_offset_under_load;
    const oilTemp = this.approach(
      this.val('oilTemp'),
      oilTarget,
      this.tauTicks(ml.transition.oil_temp_tau_s),
      noise.oil_temp,
    );
    autoSet('oilTemp', clamp(oilTemp, Math.max(ambientEff - 5, -40), 215));

    // ── 11. INTAKE AIR TEMPERATURE (ML IAT model) ────────────
    // IAT = ambient + idle_offset + load_offset
    const iatTarget =
      ambientEff +
      ml.thermal.iat_above_ambient_idle +
      heatInput * (ml.thermal.iat_above_ambient_load - ml.thermal.iat_above_ambient_idle);
    const intakeAirTemp = this.approach(
      this.val('intakeAirTemp'),
      iatTarget,
      this.tauTicks(10),
      noise.intake_air_temp,
    );
    autoSet('intakeAirTemp', clamp(intakeAirTemp, -40, 215));

    // ── 12. CONTROL VOLTAGE (ML voltage model) ───────────────
    const vModel = ml.voltage;
    const engineRunning = rpmEff > rpmIdle * 0.5;
    const voltageTarget = engineRunning
      ? vModel.engine_running_nominal + rpmFraction * (vModel.engine_running_max - vModel.engine_running_nominal) * 0.5
      : vModel.engine_off_nominal;
    const controlVoltage = this.approach(
      this.val('controlVoltage'),
      voltageTarget,
      this.tauTicks(2),
      noise.voltage,
    );
    const vMin = engineRunning ? vModel.engine_running_min : vModel.engine_off_min;
    const vMax = engineRunning ? vModel.engine_running_max : vModel.engine_off_max;
    autoSet('controlVoltage', clamp(controlVoltage, vMin, vMax));

    // ── 13. FUEL LEVEL (ML fuel consumption model) ───────────
    // Consumption based on MAF: ml/s = idle_rate + maf * factor
    // Convert ml/s to % of tank per tick
    if (!this.isManual('fuelLevel')) {
      const mafEff = this.val('mafRate');
      const fuelMlPerSec =
        ml.fuel.idle_consumption_ml_per_sec + mafEff * ml.fuel.consumption_factor_per_maf;
      const fuelMlPerTick = fuelMlPerSec * DT;
      const tankMl = ml.fuel.tank_capacity_liters * 1000;
      const fuelPercentPerTick = (fuelMlPerTick / tankMl) * 100;
      s.fuelLevel = clamp(
        s.fuelLevel - fuelPercentPerTick + gaussianNoise(noise.fuel_level * 0.01),
        0,
        100,
      );
    }

    this.emitState();
  }

  // ============================================================
  // ELM327 Command Processor
  // ============================================================
  processCommand(rawCmd: string): string {
    const cmd = rawCmd.trim().toUpperCase().replace(/\s+/g, '');

    if (cmd.startsWith('AT')) {
      return this.processATCommand(cmd);
    }

    if (/^[0-9A-F]+$/.test(cmd) && cmd.length >= 2) {
      return this.processOBDCommand(cmd);
    }

    return '?';
  }

  sendCommand(rawCmd: string): string {
    const response = this.processCommand(rawCmd);
    this.emitLog(rawCmd, response);
    return response;
  }

  private processATCommand(cmd: string): string {
    const atCmd = cmd.substring(2);

    switch (atCmd) {
      case 'Z':
        this.config.echoEnabled = true;
        this.config.headersEnabled = false;
        this.config.spacesEnabled = true;
        this.config.linefeedsEnabled = true;
        this.config.protocol = 'AUTO';
        return 'ELM327 v1.5';
      case 'E0':
        this.config.echoEnabled = false;
        return 'OK';
      case 'E1':
        this.config.echoEnabled = true;
        return 'OK';
      case 'L0':
        this.config.linefeedsEnabled = false;
        return 'OK';
      case 'L1':
        this.config.linefeedsEnabled = true;
        return 'OK';
      case 'H0':
        this.config.headersEnabled = false;
        return 'OK';
      case 'H1':
        this.config.headersEnabled = true;
        return 'OK';
      case 'S0':
        this.config.spacesEnabled = false;
        return 'OK';
      case 'S1':
        this.config.spacesEnabled = true;
        return 'OK';
      case 'RV':
        return `${this.sensors.controlVoltage.toFixed(1)}V`;
      case 'DP':
        return this.config.protocol === 'AUTO' ? 'AUTO, ISO 15765-4 (CAN 11/500)' : `ISO 15765-4 (CAN 11/500)`;
      case 'DPN':
        return '6';
      case '@1':
        return 'ELM327 v1.5';
      case '@2':
        return 'ECU_SIM_WEB';
      case 'CAF0':
      case 'CAF1':
      case 'CFC0':
      case 'CFC1':
        return 'OK';
      default:
        if (atCmd.startsWith('SP')) {
          const proto = atCmd.substring(2);
          this.config.protocol = proto === '0' ? 'AUTO' : proto;
          return 'OK';
        }
        if (atCmd.startsWith('ST')) {
          return 'OK';
        }
        return 'OK';
    }
  }

  private processOBDCommand(cmd: string): string {
    const mode = cmd.substring(0, 2);

    // Check for UDS Service IDs (0x10-0x3E, 0x85)
    // UDS commands use hex bytes directly, not the OBD mode format
    const isUDSService =
      (mode === '10' || mode === '11' || mode === '14' || mode === '19' ||
       mode === '22' || mode === '27' || mode === '28' || mode === '2E' ||
       mode === '3E' || mode === '85');

    if (isUDSService) {
      return this.processUDSCommand(cmd);
    }

    // Standard OBD-II modes (01-0A)
    switch (mode) {
      case '01':
        return this.handleMode01(cmd.substring(2));
      case '02':
        return this.handleMode02(cmd.substring(2));
      case '03':
        return this.handleMode03();
      case '04':
        return this.handleMode04();
      case '07':
        return this.handleMode07();
      case '09':
        return this.handleMode09(cmd.substring(2));
      case '0A':
        return this.handleMode0A();
      default:
        return 'NO DATA';
    }
  }

  private formatResponse(mode: string, pid: string, dataBytes: number[]): string {
    const responseMode = (parseInt(mode, 16) + 0x40).toString(16).toUpperCase().padStart(2, '0');
    const parts = [responseMode, pid, ...dataBytes.map((b) => b.toString(16).toUpperCase().padStart(2, '0'))];

    if (this.config.headersEnabled) {
      const header = '7E8';
      const len = parts.length.toString(16).toUpperCase().padStart(2, '0');
      return this.config.spacesEnabled
        ? `${header} ${len} ${parts.join(' ')}`
        : `${header}${len}${parts.join('')}`;
    }

    return this.config.spacesEnabled ? parts.join(' ') : parts.join('');
  }

  private handleMode01(pidHex: string): string {
    const s = this.sensors;

    switch (pidHex) {
      case '00': {
        const bytes = this.profile.supportedPids['00'] || [0xBE, 0x3E, 0xB8, 0x13];
        return this.formatResponse('01', '00', bytes);
      }
      case '01': {
        const milBit = this.config.milOn ? 0x80 : 0x00;
        const dtcCount = this.storedDTCs.length & 0x7F;
        return this.formatResponse('01', '01', [milBit | dtcCount, 0x07, 0xE5, 0x00]);
      }
      case '04': {
        const a = Math.round((s.engineLoad * 255) / 100);
        return this.formatResponse('01', '04', [clamp(a, 0, 255)]);
      }
      case '05': {
        const a = Math.round(s.coolantTemp + 40);
        return this.formatResponse('01', '05', [clamp(a, 0, 255)]);
      }
      case '0B': {
        const a = Math.round(s.intakeMAP);
        return this.formatResponse('01', '0B', [clamp(a, 0, 255)]);
      }
      case '0C': {
        const raw = Math.round(s.rpm * 4);
        const a = (raw >> 8) & 0xFF;
        const b = raw & 0xFF;
        return this.formatResponse('01', '0C', [a, b]);
      }
      case '0D': {
        const a = Math.round(s.speed);
        return this.formatResponse('01', '0D', [clamp(a, 0, 255)]);
      }
      case '0E': {
        const a = Math.round(s.timingAdvance * 2 + 128);
        return this.formatResponse('01', '0E', [clamp(a, 0, 255)]);
      }
      case '0F': {
        const a = Math.round(s.intakeAirTemp + 40);
        return this.formatResponse('01', '0F', [clamp(a, 0, 255)]);
      }
      case '10': {
        const raw = Math.round(s.mafRate * 100);
        const a = (raw >> 8) & 0xFF;
        const b = raw & 0xFF;
        return this.formatResponse('01', '10', [a, b]);
      }
      case '11': {
        const a = Math.round((s.throttle * 255) / 100);
        return this.formatResponse('01', '11', [clamp(a, 0, 255)]);
      }
      case '1F': {
        const a = (s.runTime >> 8) & 0xFF;
        const b = s.runTime & 0xFF;
        return this.formatResponse('01', '1F', [a, b]);
      }
      case '20': {
        const bytes = this.profile.supportedPids['20'] || [0x80, 0x05, 0x00, 0x00];
        return this.formatResponse('01', '20', bytes);
      }
      case '2F': {
        const a = Math.round((s.fuelLevel * 255) / 100);
        return this.formatResponse('01', '2F', [clamp(a, 0, 255)]);
      }
      case '33': {
        const a = Math.round(s.baroPressure);
        return this.formatResponse('01', '33', [clamp(a, 0, 255)]);
      }
      case '40': {
        const bytes = this.profile.supportedPids['40'] || [0x68, 0x08, 0x00, 0x00];
        return this.formatResponse('01', '40', bytes);
      }
      case '42': {
        const raw = Math.round(s.controlVoltage * 1000);
        const a = (raw >> 8) & 0xFF;
        const b = raw & 0xFF;
        return this.formatResponse('01', '42', [a, b]);
      }
      case '46': {
        const a = Math.round(s.ambientTemp + 40);
        return this.formatResponse('01', '46', [clamp(a, 0, 255)]);
      }
      case '4F': {
        const a = Math.round(s.oilTemp + 40);
        return this.formatResponse('01', '4F', [clamp(a, 0, 255)]);
      }
      default:
        return 'NO DATA';
    }
  }

  private handleMode02(pidHex: string): string {
    if (this.storedDTCs.length === 0) return 'NO DATA';
    const mode01Response = this.handleMode01(pidHex);
    if (mode01Response === 'NO DATA') return 'NO DATA';
    return mode01Response.replace(/^41/, '42').replace(/^7E8 \d+ 41/, (m) => m.replace('41', '42'));
  }

  private encodeDTC(code: string): [number, number] {
    const typeMap: Record<string, number> = { P: 0, C: 1, B: 2, U: 3 };
    const type = typeMap[code[0]] || 0;
    const d1 = parseInt(code[1], 16);
    const d2 = parseInt(code[2], 16);
    const d3 = parseInt(code[3], 16);
    const d4 = parseInt(code[4], 16);
    const byte1 = (type << 6) | (d1 << 4) | d2;
    const byte2 = (d3 << 4) | d4;
    return [byte1, byte2];
  }

  private handleMode03(): string {
    if (this.storedDTCs.length === 0) return '43 00';
    const bytes: number[] = [];
    for (const dtc of this.storedDTCs) {
      const [b1, b2] = this.encodeDTC(dtc);
      bytes.push(b1, b2);
    }
    const count = this.storedDTCs.length;
    const parts = [
      '43',
      count.toString(16).toUpperCase().padStart(2, '0'),
      ...bytes.map((b) => b.toString(16).toUpperCase().padStart(2, '0')),
    ];
    return this.config.spacesEnabled ? parts.join(' ') : parts.join('');
  }

  private handleMode04(): string {
    this.clearDTCs();
    return '44';
  }

  private handleMode07(): string {
    if (this.pendingDTCs.length === 0) return '47 00';
    const bytes: number[] = [];
    for (const dtc of this.pendingDTCs) {
      const [b1, b2] = this.encodeDTC(dtc);
      bytes.push(b1, b2);
    }
    const count = this.pendingDTCs.length;
    const parts = [
      '47',
      count.toString(16).toUpperCase().padStart(2, '0'),
      ...bytes.map((b) => b.toString(16).toUpperCase().padStart(2, '0')),
    ];
    return this.config.spacesEnabled ? parts.join(' ') : parts.join('');
  }

  private handleMode09(pidHex: string): string {
    switch (pidHex) {
      case '02': {
        const vin = this.profile.vin;
        const vinBytes = Array.from(vin).map((c) => c.charCodeAt(0));
        const parts = ['49', '02', ...vinBytes.map((b) => b.toString(16).toUpperCase().padStart(2, '0'))];
        return this.config.spacesEnabled ? parts.join(' ') : parts.join('');
      }
      case '04': {
        const calId = this.profile.calibrationId;
        const calBytes = Array.from(calId).map((c) => c.charCodeAt(0));
        const parts = ['49', '04', ...calBytes.map((b) => b.toString(16).toUpperCase().padStart(2, '0'))];
        return this.config.spacesEnabled ? parts.join(' ') : parts.join('');
      }
      default:
        return 'NO DATA';
    }
  }

  private handleMode0A(): string {
    if (this.permanentDTCs.length === 0) return '4A 00';
    const bytes: number[] = [];
    for (const dtc of this.permanentDTCs) {
      const [b1, b2] = this.encodeDTC(dtc);
      bytes.push(b1, b2);
    }
    const count = this.permanentDTCs.length;
    const parts = [
      '4A',
      count.toString(16).toUpperCase().padStart(2, '0'),
      ...bytes.map((b) => b.toString(16).toUpperCase().padStart(2, '0')),
    ];
    return this.config.spacesEnabled ? parts.join(' ') : parts.join('');
  }

  // ============================================================
  // UDS (ISO 14229) Service Handlers
  // ============================================================

  /**
   * Process UDS (Unified Diagnostic Services) commands
   * Format: [SID][SubFunction/Data]
   * Response: [SID+0x40][Data] or [0x7F][SID][NRC]
   */
  private processUDSCommand(cmd: string): string {
    const sid = cmd.substring(0, 2).toUpperCase();
    const data = cmd.substring(2).toUpperCase();

    switch (sid) {
      case '10': // DiagnosticSessionControl
        return this.handleUDSSessionControl(data);
      case '11': // ECUReset
        return this.handleUDSECUReset(data);
      case '14': // ClearDiagnosticInformation
        return this.handleUDSClearDTC(data);
      case '19': // ReadDTCInformation
        return this.handleUDSReadDTC(data);
      case '22': // ReadDataByIdentifier
        return this.handleUDSReadDID(data);
      case '27': // SecurityAccess
        return this.handleUDSSecurityAccess(data);
      case '28': // CommunicationControl
        return this.handleUDSCommunicationControl(data);
      case '2E': // WriteDataByIdentifier
        return this.handleUDSWriteDID(data);
      case '3E': // TesterPresent
        return this.handleUDSTesterPresent(data);
      case '85': // ControlDTCSetting
        return this.handleUDSControlDTCSetting(data);
      default:
        return this.formatUDSNegativeResponse(sid, 0x11); // serviceNotSupported
    }
  }

  /**
   * Format UDS positive response
   */
  private formatUDSPositiveResponse(sid: string, responseData: number[]): string {
    const responseSID = (parseInt(sid, 16) + 0x40).toString(16).toUpperCase().padStart(2, '0');
    const parts = [responseSID, ...responseData.map((b) => b.toString(16).toUpperCase().padStart(2, '0'))];

    if (this.config.headersEnabled) {
      const header = '7E8';
      const len = (parts.length).toString(16).toUpperCase().padStart(2, '0');
      return this.config.spacesEnabled
        ? `${header} ${len} ${parts.join(' ')}`
        : `${header}${len}${parts.join('')}`;
    }

    return this.config.spacesEnabled ? parts.join(' ') : parts.join('');
  }

  /**
   * Format UDS negative response: [0x7F][SID][NRC]
   */
  private formatUDSNegativeResponse(sid: string, nrc: number): string {
    const parts = [
      '7F',
      sid.toUpperCase(),
      nrc.toString(16).toUpperCase().padStart(2, '0'),
    ];

    if (this.config.headersEnabled) {
      const header = '7E8';
      const len = parts.length.toString(16).toUpperCase().padStart(2, '0');
      return this.config.spacesEnabled
        ? `${header} ${len} ${parts.join(' ')}`
        : `${header}${len}${parts.join('')}`;
    }

    return this.config.spacesEnabled ? parts.join(' ') : parts.join('');
  }

  /**
   * UDS 0x10: DiagnosticSessionControl
   * Sub-functions: 0x01=DefaultSession, 0x02=Programming, 0x03=ExtendedDiagnostic
   */
  private handleUDSSessionControl(data: string): string {
    if (data.length < 2) {
      return this.formatUDSNegativeResponse('10', 0x13); // incorrectMessageLength
    }

    const subfunc = parseInt(data.substring(0, 2), 16);

    switch (subfunc) {
      case 0x01: // Default Session
        this.udsSession = 0x01;
        this.securityLevel = 0; // Reset security
        return this.formatUDSPositiveResponse('10', [0x01, 0x00, 0x32, 0x01, 0xF4]);
      case 0x02: // Programming Session
        this.udsSession = 0x02;
        this.securityLevel = 0; // Reset security
        return this.formatUDSPositiveResponse('10', [0x02, 0x00, 0x32, 0x01, 0xF4]);
      case 0x03: // Extended Diagnostic Session
        this.udsSession = 0x03;
        this.securityLevel = 0; // Reset security
        return this.formatUDSPositiveResponse('10', [0x03, 0x00, 0x32, 0x01, 0xF4]);
      default:
        return this.formatUDSNegativeResponse('10', 0x12); // subFunctionNotSupported
    }
  }

  /**
   * UDS 0x11: ECUReset
   * Sub-functions: 0x01=HardReset, 0x02=KeyOffOnReset, 0x03=SoftReset, 0x04=EnableRapidPowerShutDown
   */
  private handleUDSECUReset(data: string): string {
    if (data.length < 2) {
      return this.formatUDSNegativeResponse('11', 0x13);
    }

    const subfunc = parseInt(data.substring(0, 2), 16);

    // Reset state for all sub-functions
    this.udsSession = 0x01;
    this.securityLevel = 0;
    this.storedDTCs = [...this.profile.dtcs.stored];
    this.pendingDTCs = [...this.profile.dtcs.pending];

    return this.formatUDSPositiveResponse('11', [subfunc]);
  }

  /**
   * UDS 0x14: ClearDiagnosticInformation
   * Clears DTCs similar to OBD Mode 04
   */
  private handleUDSClearDTC(data: string): string {
    if (data.length < 6) {
      return this.formatUDSNegativeResponse('14', 0x13);
    }

    this.clearDTCs();
    return this.formatUDSPositiveResponse('14', [0x00, 0x00, 0x00]);
  }

  /**
   * UDS 0x19: ReadDTCInformation
   * Sub-functions: 0x01=reportNumberOfDTCByStatusMask, 0x02=reportDTCByStatusMask
   */
  private handleUDSReadDTC(data: string): string {
    if (data.length < 2) {
      return this.formatUDSNegativeResponse('19', 0x13);
    }

    const subfunc = parseInt(data.substring(0, 2), 16);
    let responseData: number[] = [subfunc];

    switch (subfunc) {
      case 0x01: // reportNumberOfDTCByStatusMask
        if (data.length < 4) {
          return this.formatUDSNegativeResponse('19', 0x13);
        }
        const statusMask = parseInt(data.substring(2, 4), 16);
        // Count DTCs matching status mask (simplified)
        const dtcCount = this.storedDTCs.length;
        responseData.push(0x00); // Reserved
        responseData.push(dtcCount); // Number of DTCs
        break;

      case 0x02: // reportDTCByStatusMask
        if (data.length < 4) {
          return this.formatUDSNegativeResponse('19', 0x13);
        }
        // Return all stored DTCs encoded as UDS format
        for (const dtc of this.storedDTCs) {
          const [b1, b2] = this.encodeDTC(dtc);
          responseData.push(b1, b2, 0x00); // statusAvailabilityMask = 0
        }
        break;

      default:
        return this.formatUDSNegativeResponse('19', 0x12);
    }

    return this.formatUDSPositiveResponse('19', responseData);
  }

  /**
   * UDS 0x22: ReadDataByIdentifier (DID)
   * Common DIDs: 0xF190=VIN, 0xF18C=ECU Serial, 0xF191=HW Version, 0xF187=PartNumber, 0xD001=CustomState
   */
  private handleUDSReadDID(data: string): string {
    if (data.length < 4) {
      return this.formatUDSNegativeResponse('22', 0x13);
    }

    let responseData: number[] = [];
    let offset = 0;

    // Parse DIDs (2 bytes each)
    while (offset < data.length) {
      if (offset + 4 > data.length) {
        return this.formatUDSNegativeResponse('22', 0x13);
      }

      const did = data.substring(offset, offset + 4).toUpperCase();
      offset += 4;

      switch (did) {
        case 'F190': { // VIN
          const vin = this.profile.vin;
          const vinBytes = Array.from(vin).map((c) => c.charCodeAt(0));
          responseData.push(...vinBytes);
          break;
        }
        case 'F18C': { // ECU Serial Number
          const serial = `ECU_${this.profile.id.toUpperCase()}_001`;
          const serialBytes = Array.from(serial).map((c) => c.charCodeAt(0));
          responseData.push(...serialBytes);
          break;
        }
        case 'F191': { // Hardware Version
          const hwVersion = Array.from('HW_V1.0').map((c) => c.charCodeAt(0));
          responseData.push(...hwVersion);
          break;
        }
        case 'F187': { // Part Number
          const partNum = Array.from(this.profile.calibrationId).map((c) => c.charCodeAt(0));
          responseData.push(...partNum);
          break;
        }
        case 'D001': { // Custom State (RPM encoded as 2 bytes)
          const rpm = Math.round(this.sensors.rpm);
          responseData.push((rpm >> 8) & 0xFF, rpm & 0xFF);
          break;
        }
        default:
          return this.formatUDSNegativeResponse('22', 0x31); // requestOutOfRange
      }
    }

    return this.formatUDSPositiveResponse('22', responseData);
  }

  /**
   * UDS 0x27: SecurityAccess (Seed/Key)
   * Seed: 0xDEAD, Key = Seed XOR 0xBEEF
   */
  private handleUDSSecurityAccess(data: string): string {
    if (data.length < 2) {
      return this.formatUDSNegativeResponse('27', 0x13);
    }

    const subfunc = parseInt(data.substring(0, 2), 16);

    if (subfunc === 0x01) {
      // Request seed
      this.securitySeed = 0xDEAD; // Fixed seed for simulation
      return this.formatUDSPositiveResponse('27', [0x01, 0xDE, 0xAD]);
    } else if (subfunc === 0x02) {
      // Send key
      if (data.length < 6) {
        return this.formatUDSNegativeResponse('27', 0x13);
      }

      const keyBytes = data.substring(2);
      const keyValue = parseInt(keyBytes, 16);
      const expectedKey = this.securitySeed ^ 0xBEEF;

      if (keyValue === expectedKey) {
        this.securityLevel = 1; // Unlock
        return this.formatUDSPositiveResponse('27', [0x02]);
      } else {
        return this.formatUDSNegativeResponse('27', 0x35); // invalidKey
      }
    } else {
      return this.formatUDSNegativeResponse('27', 0x12);
    }
  }

  /**
   * UDS 0x28: CommunicationControl
   * Sub-functions: 0x00=enableRxAndTx, 0x01=enableRxAndDisableTx, 0x02=disableRxAndEnableTx, 0x03=disableRxAndTx
   */
  private handleUDSCommunicationControl(data: string): string {
    if (data.length < 4) {
      return this.formatUDSNegativeResponse('28', 0x13);
    }

    const subfunc = parseInt(data.substring(0, 2), 16);
    const commType = parseInt(data.substring(2, 4), 16);

    switch (subfunc) {
      case 0x00: // enableRxAndTx
        this.communicationEnabled = true;
        return this.formatUDSPositiveResponse('28', [subfunc, commType]);
      case 0x01: // enableRxAndDisableTx
        this.communicationEnabled = true;
        return this.formatUDSPositiveResponse('28', [subfunc, commType]);
      case 0x02: // disableRxAndEnableTx
        this.communicationEnabled = false;
        return this.formatUDSPositiveResponse('28', [subfunc, commType]);
      case 0x03: // disableRxAndTx
        this.communicationEnabled = false;
        return this.formatUDSPositiveResponse('28', [subfunc, commType]);
      default:
        return this.formatUDSNegativeResponse('28', 0x12);
    }
  }

  /**
   * UDS 0x2E: WriteDataByIdentifier (DID)
   * Requires security level 1 (unlocked)
   */
  private handleUDSWriteDID(data: string): string {
    // Check security level
    if (this.securityLevel === 0) {
      return this.formatUDSNegativeResponse('2E', 0x33); // securityAccessDenied
    }

    if (data.length < 4) {
      return this.formatUDSNegativeResponse('2E', 0x13);
    }

    const did = data.substring(0, 4).toUpperCase();
    const didData = data.substring(4);

    if (didData.length % 2 !== 0) {
      return this.formatUDSNegativeResponse('2E', 0x13);
    }

    // Store writable DID
    const bytes: number[] = [];
    for (let i = 0; i < didData.length; i += 2) {
      bytes.push(parseInt(didData.substring(i, i + 2), 16));
    }

    this.didStorage[did] = bytes;

    return this.formatUDSPositiveResponse('2E', []);
  }

  /**
   * UDS 0x3E: TesterPresent (Keep-Alive)
   * Sub-function: 0x00 with service not suppressed response
   */
  private handleUDSTesterPresent(data: string): string {
    if (data.length < 2) {
      return this.formatUDSNegativeResponse('3E', 0x13);
    }

    const subfunc = parseInt(data.substring(0, 2), 16);

    if ((subfunc & 0x7F) === 0x00) {
      // Service not suppressed by default
      return this.formatUDSPositiveResponse('3E', [0x00]);
    }

    return this.formatUDSNegativeResponse('3E', 0x12);
  }

  /**
   * UDS 0x85: ControlDTCSetting
   * Sub-functions: 0x01=on, 0x02=off
   */
  private handleUDSControlDTCSetting(data: string): string {
    if (data.length < 2) {
      return this.formatUDSNegativeResponse('85', 0x13);
    }

    const subfunc = parseInt(data.substring(0, 2), 16);

    switch (subfunc) {
      case 0x01: // on
        this.dtcSettingEnabled = true;
        return this.formatUDSPositiveResponse('85', [0x01]);
      case 0x02: // off
        this.dtcSettingEnabled = false;
        return this.formatUDSPositiveResponse('85', [0x02]);
      default:
        return this.formatUDSNegativeResponse('85', 0x12);
    }
  }

  // ============================================================
  // UDS ISO-TP Framing (for reference, not used in response yet)
  // ============================================================

  /**
   * Split a response into ISO-TP frames if needed
   * Returns array of frame strings for multi-frame responses
   */
  private formatISO_TPFrames(response: string): string[] {
    const bytes = response.split(' ').map((b) => parseInt(b, 16));

    if (bytes.length <= 7) {
      return [response]; // Single frame
    }

    const frames: string[] = [];
    const dataLength = bytes.length;

    // First Frame: [0x10 | (len>>8), len & 0xFF, data(0-5)]
    const firstFrame = [0x10 | (dataLength >> 8), dataLength & 0xFF, ...bytes.slice(0, 5)];
    frames.push(
      firstFrame
        .map((b) => b.toString(16).toUpperCase().padStart(2, '0'))
        .join(this.config.spacesEnabled ? ' ' : ''),
    );

    // Consecutive Frames: [0x20 + seqNum, data(6-?)]
    let seqNum = 0;
    for (let i = 5; i < bytes.length; i += 7) {
      seqNum++;
      const frameData = bytes.slice(i, Math.min(i + 7, bytes.length));
      const consecutiveFrame = [0x20 + seqNum, ...frameData];
      frames.push(
        consecutiveFrame
          .map((b) => b.toString(16).toUpperCase().padStart(2, '0'))
          .join(this.config.spacesEnabled ? ' ' : ''),
      );
    }

    return frames;
  }

  destroy() {
    this.stop();
    this.listeners = [];
    this.logListeners = [];
    this.sensorLog = [];
    this.commandLog = [];
  }
}