import { useEffect, useRef, useState } from 'react';
import { useRace, useUI } from '../../state/store';
import { useRuntime } from '../../state/runtime';
import { scenarios, type Scenario } from '../../providers/mock/engine';
import { MockProvider, type Fault } from '../../providers/mock/provider';
import { ReplayProvider } from '../../providers/replay/provider';
import type { Profile } from '../../domain/schema';
import { Icon } from '../../components/Icon';
import { clockTime } from '../../domain/format';
import { useTicker } from '../../app/hooks';
export function DemoControls() {
  useRace((s) => s.accepted);
  const friendly = useUI((s) => s.preferences.uiStyle) === 'fan';
  const open = useUI((s) => s.controlsOpen);
  const provider = useRuntime((s) => s.provider);
  const scenario = useRuntime((s) => s.scenario);
  const profile = useRuntime((s) => s.profile);
  const seed = useRuntime((s) => s.seed);
  const startDemo = useRuntime((s) => s.startDemo);
  const status = useRace((s) => s.status);
  const rejected = useRace((s) => s.rejected);
  const [seedInput, setSeedInput] = useState(String(seed));
  const [seedError, setSeedError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  useTicker();
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    if (!open && dialog.current?.open) dialog.current.close();
  }, [open]);
  function updateSeed() {
    const n = Number(seedInput);
    if (!Number.isInteger(n) || n < 0 || n > 4294967295) {
      setSeedError('Enter an integer from 0 to 4294967295.');
      return;
    }
    setSeedError('');
    startDemo({ seed: n });
  }
  return (
    <dialog
      ref={dialog}
      className="dialog controls-dialog"
      onClose={() => useUI.setState({ controlsOpen: false })}
      onClick={(e) => {
        if (e.target === e.currentTarget) dialog.current?.close();
      }}
    >
      <div className="dialog-heading">
        <div>
          <span className="eyebrow">
            {provider instanceof ReplayProvider
              ? 'REPLAY — SIMULATED DATA'
              : 'DEMO — SIMULATED DATA'}
          </span>
          <h2>{friendly ? 'Demo controls' : 'Race lab'}</h2>
        </div>
        <button
          className="icon-button"
          aria-label={friendly ? 'Close demo controls' : 'Close race lab'}
          onClick={() => dialog.current?.close()}
        >
          <Icon name="close" />
        </button>
      </div>
      <p className="muted">
        Try a race situation, change playback speed, or explore different map detail.
      </p>
      <div className="playback-bar">
        <button
          className="button accent-button"
          onClick={() => provider?.setPaused(!status.paused)}
        >
          <Icon name={status.paused ? 'play' : 'pause'} />
          {status.paused ? 'Resume' : 'Pause'}
        </button>
        <button className="button" onClick={() => provider?.reset()}>
          <Icon name="reset" />
          Reset
        </button>
        <div className="segmented">
          {[1, 5, 20].map((s) => (
            <button
              key={s}
              className={status.speed === s ? 'active' : ''}
              onClick={() => provider?.setSpeed(s)}
              aria-pressed={status.speed === s}
            >
              {s}×
            </button>
          ))}
        </div>
      </div>
      <p className="playback-status">
        {status.paused ? 'Playback intentionally paused' : status.message}
      </p>
      {provider instanceof ReplayProvider ? (
        <>
          <label className="field">
            Replay position{' '}
            <span>
              {clockTime(provider.offset)} / {clockTime(provider.duration)}
            </span>
            <input
              aria-label="Replay position"
              type="range"
              step="1000"
              min="0"
              max={provider.duration}
              value={provider.offset}
              onChange={(e) => provider.seek(Number(e.target.value))}
            />
          </label>
          <button className="button" onClick={() => startDemo()}>
            Return to demo simulator
          </button>
        </>
      ) : (
        <>
          <label className="field">
            Scenario
            <select
              aria-label="Scenario"
              value={scenario}
              onChange={(e) => startDemo({ scenario: e.target.value as Scenario })}
            >
              {scenarios.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label className="field">
            Map detail
            <select
              aria-label="Map capability profile"
              value={profile}
              onChange={(e) => startDemo({ profile: e.target.value as Profile })}
            >
              <option value="position">Full simulated positions</option>
              <option value="sector">Estimates from sector timing</option>
              <option value="lap">Estimates from lap timing</option>
              <option value="classification">Standings only · no map positions</option>
            </select>
          </label>
          <details className="advanced-controls">
            <summary>Advanced demo options</summary>
            <label className="field">
              Random seed
              <div className="inline-field">
                <input
                  aria-label="Deterministic seed"
                  value={seedInput}
                  onChange={(e) => setSeedInput(e.target.value)}
                  inputMode="numeric"
                />
                <button className="button" onClick={updateSeed}>
                  Apply seed
                </button>
              </div>
            </label>
            {seedError && (
              <p role="alert" className="error-text">
                {seedError}
              </p>
            )}
            <div className="detail-section">
              <h4>Inject a feed fault</h4>
              <div className="fault-grid">
                {(
                  [
                    ['outage', '15s feed outage'],
                    ['duplicate', 'Old / duplicate data'],
                    ['stream', 'New stream'],
                    ['session', 'New session'],
                    ['schema', 'Malformed schema'],
                  ] as [Fault, string][]
                ).map(([fault, label]) => (
                  <button
                    className="button"
                    key={fault}
                    onClick={() => {
                      if (provider instanceof MockProvider) provider.inject(fault);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="muted">
                Outage uses real time while the race continues. Rejected messages: {rejected}.
              </p>
            </div>
          </details>
        </>
      )}
      <p className="notice">
        Changing a scenario restarts the demo at a preset race point. All entries, timing, events,
        and positions are fictional.
      </p>
    </dialog>
  );
}
