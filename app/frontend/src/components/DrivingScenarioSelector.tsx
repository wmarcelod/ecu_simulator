import { useState, useEffect, useCallback } from 'react';
import { ECUSimulator, DrivingScenario } from '@/lib/ecu-simulator';
import { useTheme, t } from '@/lib/theme-context';

interface DrivingScenariosProps {
  simulator: ECUSimulator;
}

interface TelemetryPoint {
  rpm: number;
  speed: number;
  throttle: number;
  load: number;
}

interface ScenarioTimelineEntry {
  scenario: DrivingScenario;
  startTime: number;
  duration: number;
}

const SCENARIOS: Array<{ id: DrivingScenario; label: string; icon: string; description: string; color: string }> = [
  { id: 'idle', label: 'IDLE', icon: '●', description: 'Engine idle, no motion', color: '#475569' },
  { id: 'city', label: 'CITY', icon: '⤡', description: 'Stop-and-go urban driving', color: '#1D4ED8' },
  { id: 'highway', label: 'HIGHWAY', icon: '▶', description: 'Steady cruising at speed', color: '#15803D' },
  { id: 'aggressive', label: 'AGGRESSIVE', icon: '⚡', description: 'Hard acceleration and braking', color: '#991B1B' },
  { id: 'eco', label: 'ECO', icon: '♻', description: 'Fuel-efficient smooth driving', color: '#0F766E' },
];

// Mini gauge component for telemetry
function MiniGauge({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const percent = Math.min(100, (value / max) * 100);
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[9px] font-mono text-slate-500 uppercase tracking-wider">{label}</span>
        <span className="text-[10px] font-mono font-semibold" style={{ color }}>
          {Math.round(value)}
        </span>
      </div>
      <div className="w-full h-1.5 rounded-full bg-slate-700 overflow-hidden">
        <div
          className="h-full transition-all duration-150"
          style={{ width: `${percent}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

// Scenario range indicator
function ScenarioRangeIndicator({
  label,
  current,
  min,
  max,
  color,
  unit,
}: {
  label: string;
  current: number;
  min: number;
  max: number;
  color: string;
  unit: string;
}) {
  const percent = ((current - min) / (max - min)) * 100;
  const clampedPercent = Math.max(0, Math.min(100, percent));

  return (
    <div className="space-y-1">
      <div className="flex justify-between items-center">
        <span className="text-[9px] font-mono text-slate-400">{label}</span>
        <span className="text-[9px] font-mono text-slate-300">{Math.round(current)} {unit}</span>
      </div>
      <div className="relative h-2 rounded bg-slate-700/50 overflow-hidden">
        <div className="absolute inset-0 flex">
          <div className="flex-1 border-r border-slate-600/50 text-[7px] text-slate-600 flex items-center justify-start px-0.5">
            {Math.round(min)}
          </div>
          <div className="flex-1 border-r border-slate-600/50" />
          <div className="flex-1" />
        </div>
        <div
          className="absolute top-0 h-full transition-all duration-150"
          style={{ left: '0%', width: `${clampedPercent}%`, backgroundColor: color, opacity: 0.7 }}
        />
      </div>
    </div>
  );
}

export default function DrivingScenarioSelector({ simulator }: DrivingScenariosProps) {
  const { theme } = useTheme();
  const [currentScenario, setCurrentScenario] = useState<DrivingScenario>(simulator.getDrivingScenario());
  const [running, setRunning] = useState(simulator.isRunning());
  const [sensorState, setSensorState] = useState(simulator.getState());
  const [scenarioHistory, setScenarioHistory] = useState<ScenarioTimelineEntry[]>([
    { scenario: simulator.getDrivingScenario(), startTime: 0, duration: 0 },
  ]);

  const updateState = useCallback(() => {
    const newScenario = simulator.getDrivingScenario();
    const newRunning = simulator.isRunning();
    const newSensorState = simulator.getState();

    setCurrentScenario(newScenario);
    setRunning(newRunning);
    setSensorState(newSensorState);

    // Update scenario history
    setScenarioHistory((prev) => {
      const lastEntry = prev[prev.length - 1];
      const now = Date.now() / 1000;

      if (newScenario !== lastEntry.scenario) {
        // Scenario changed
        return [...prev.slice(-59), { scenario: newScenario, startTime: now, duration: 0 }];
      } else {
        // Update duration of current scenario
        return [
          ...prev.slice(0, -1),
          { ...lastEntry, duration: now - lastEntry.startTime },
        ];
      }
    });
  }, [simulator]);

  useEffect(() => {
    const iv = setInterval(updateState, 250);
    return () => clearInterval(iv);
  }, [updateState]);

  const handleScenario = (scenario: DrivingScenario) => {
    simulator.setDrivingScenario(scenario);
    setCurrentScenario(scenario);
  };

  const bg = t('bg-[#111827]', 'bg-white', theme);
  const border = t('border-[#1e293b]', 'border-gray-200', theme);
  const textMuted = t('text-slate-500', 'text-gray-500', theme);
  const textLabel = t('text-slate-400', 'text-gray-600', theme);
  const panelBg = t('bg-[#0f172a]', 'bg-gray-50', theme);
  const panelBorder = t('border-[#1e293b]', 'border-gray-200', theme);

  const current = SCENARIOS.find((s) => s.id === currentScenario);
  const profile = current ? simulator.getDrivingScenarioProfile(currentScenario) : null;

  return (
    <div className={`${bg} border ${border} rounded-md p-3 space-y-3`}>
      {/* Header */}
      <div className="flex items-center gap-2">
        <div className="w-1 h-3 bg-cyan-500/70 rounded-full" />
        <span className={`text-[10px] font-mono ${textLabel} uppercase tracking-widest`}>Driving Scenario</span>
        {running && <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse ml-auto" />}
      </div>

      {/* Current Scenario Display */}
      <div className="pb-3 border-b border-[#1e293b]">
        <div className="flex items-center gap-3">
          <div
            className="w-3 h-3 rounded-full"
            style={{ backgroundColor: current?.color || '#94a3b8' }}
          />
          <div>
            <div className={`text-[11px] font-mono font-semibold ${textMuted}`}>
              {current?.label} — {current?.description}
            </div>
            {current && (
              <div className={`text-[9px] font-mono ${textLabel} mt-0.5`}>
                {profile && `RPM: ${profile.rpmRange.min}-${profile.rpmRange.max} | Speed: ${profile.speedRange.min}-${profile.speedRange.max} km/h`}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Telemetry + Scenario Profile side-by-side (dense 2-column layout) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Live Telemetry Strip */}
        <div className={`${panelBg} border ${panelBorder} rounded p-2.5`}>
          <div className={`text-[8px] font-mono ${textLabel} uppercase tracking-wider mb-2`}>Live Telemetry</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            <MiniGauge label="RPM" value={sensorState.rpm} max={7000} color="#0F766E" />
            <MiniGauge label="Speed" value={sensorState.speed} max={200} color="#15803D" />
            <MiniGauge label="Throttle" value={sensorState.throttle * 100} max={100} color="#B45309" />
            <MiniGauge label="Load" value={sensorState.engineLoad * 100} max={100} color="#991B1B" />
          </div>
        </div>

        {/* Scenario Detail Panel */}
        {profile && (
          <div className={`${panelBg} border ${panelBorder} rounded p-3 space-y-2.5`}>
            <div className={`text-[8px] font-mono ${textLabel} uppercase tracking-wider`}>Scenario Profile</div>

            <ScenarioRangeIndicator
              label="RPM Range"
              current={sensorState.rpm}
              min={profile.rpmRange.min}
              max={profile.rpmRange.max}
              color="#0F766E"
              unit="rpm"
            />

            <ScenarioRangeIndicator
              label="Speed Range"
              current={sensorState.speed}
              min={profile.speedRange.min}
              max={profile.speedRange.max}
              color="#15803D"
              unit="km/h"
            />

            <ScenarioRangeIndicator
              label="Throttle Range"
              current={sensorState.throttle * 100}
              min={profile.throttleRange.min * 100}
              max={profile.throttleRange.max * 100}
              color="#B45309"
              unit="%"
            />

            {/* Coolant Temp Display */}
            <div className="pt-1">
              <div className="flex justify-between items-center">
                <span className="text-[9px] font-mono text-slate-400">Coolant Temp</span>
                <span className="text-[9px] font-mono text-slate-300">{Math.round(sensorState.coolantTemp)}°C</span>
              </div>
              <div className="h-1.5 rounded bg-slate-700/50 mt-1 overflow-hidden">
                <div
                  className="h-full transition-all duration-150"
                  style={{
                    width: `${Math.min(100, (sensorState.coolantTemp / 120) * 100)}%`,
                    backgroundColor: sensorState.coolantTemp > 100 ? '#991B1B' : '#15803D',
                  }}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Scenario Buttons (compactos, centralizados) */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 max-w-3xl mx-auto w-full">
        {SCENARIOS.map((scenario) => (
          <button
            key={scenario.id}
            onClick={() => handleScenario(scenario.id)}
            disabled={!running}
            className={`
              h-16 rounded border transition-all flex flex-col items-center justify-center gap-1
              ${currentScenario === scenario.id
                ? `border-white/50 bg-[#1e293b] shadow-lg shadow-${scenario.color.split('#')[1]}/20`
                : `${border} ${theme === 'dark' ? 'bg-[#0f172a] hover:bg-[#1e293b]' : 'bg-gray-50 hover:bg-gray-100'}`
              }
              ${!running ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}
            `}
            title={!running ? 'Start simulator to change scenario' : scenario.description}
          >
            <span className="text-[16px]">{scenario.icon}</span>
            <span
              className="text-[9px] font-mono font-semibold uppercase"
              style={{ color: scenario.color }}
            >
              {scenario.label}
            </span>
          </button>
        ))}
      </div>

      {/* Scenario Transition Timeline */}
      <div className="pt-2 border-t border-[#1e293b]">
        <div className={`text-[8px] font-mono ${textLabel} uppercase tracking-wider mb-2`}>60s Timeline</div>
        <div
          className="flex h-2 rounded overflow-hidden gap-0.5"
          style={{ backgroundColor: '#E8E3D3' }}
        >
          {scenarioHistory.map((entry, idx) => {
            const scenarioColor = SCENARIOS.find((s) => s.id === entry.scenario)?.color || '#94a3b8';
            // IDLE uses a slate color (#475569) which appears visually "dark" on the
            // cream palette. Remap it to the cream accent so the timeline reads as a
            // soft pastel track rather than a gray bar.
            const displayColor = entry.scenario === 'idle' ? '#CBD5E1' : scenarioColor;
            return (
              <div
                key={idx}
                className="flex-1 rounded-sm transition-all duration-150"
                style={{ backgroundColor: displayColor, opacity: 0.8 }}
                title={`${entry.scenario} (${entry.duration.toFixed(1)}s)`}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
