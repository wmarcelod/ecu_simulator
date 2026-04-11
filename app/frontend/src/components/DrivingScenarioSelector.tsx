import { useState, useEffect, useCallback } from 'react';
import { ECUSimulator, DrivingScenario } from '@/lib/ecu-simulator';
import { useTheme, t } from '@/lib/theme-context';

interface DrivingScenariosProps {
  simulator: ECUSimulator;
}

const SCENARIOS: Array<{ id: DrivingScenario; label: string; icon: string; description: string; color: string }> = [
  { id: 'idle', label: 'IDLE', icon: '●', description: 'Engine idle, no motion', color: '#94a3b8' },
  { id: 'city', label: 'CITY', icon: '⤡', description: 'Stop-and-go urban driving', color: '#38bdf8' },
  { id: 'highway', label: 'HIGHWAY', icon: '▶', description: 'Steady cruising at speed', color: '#4ade80' },
  { id: 'aggressive', label: 'AGGRESSIVE', icon: '⚡', description: 'Hard acceleration and braking', color: '#ef4444' },
  { id: 'eco', label: 'ECO', icon: '♻', description: 'Fuel-efficient smooth driving', color: '#a3e635' },
];

export default function DrivingScenarioSelector({ simulator }: DrivingScenariosProps) {
  const { theme } = useTheme();
  const [currentScenario, setCurrentScenario] = useState<DrivingScenario>(simulator.getDrivingScenario());
  const [running, setRunning] = useState(simulator.isRunning());

  const updateState = useCallback(() => {
    setCurrentScenario(simulator.getDrivingScenario());
    setRunning(simulator.isRunning());
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

  const current = SCENARIOS.find((s) => s.id === currentScenario);

  return (
    <div className={`${bg} border ${border} rounded-md p-3`}>
      <div className="flex items-center gap-2 mb-3">
        <div className="w-1 h-3 bg-cyan-500/70 rounded-full" />
        <span className={`text-[10px] font-mono ${textLabel} uppercase tracking-widest`}>Driving Scenario</span>
        {running && <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse ml-auto" />}
      </div>

      {/* Current Scenario Display */}
      <div className="mb-3 pb-3 border-b border-[#1e293b]">
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
                {(() => {
                  const profile = simulator.getDrivingScenarioProfile(currentScenario);
                  return `RPM: ${profile.rpmRange.min}-${profile.rpmRange.max} | Speed: ${profile.speedRange.min}-${profile.speedRange.max} km/h`;
                })()}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Scenario Buttons */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
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
    </div>
  );
}
