import { useState } from 'react';
import { useUI, useRace } from '../../state/store';
import { useRuntime } from '../../state/runtime';
import { controller } from '../../state/controller';
import { parseRecording, MAX_REPLAY_BYTES } from '../../providers/replay/provider';
import { NatsoftLiveProvider } from '../../providers/live/provider';
import { DEFAULT_LIVE_URL, resolveTimingUrl } from '../../providers/live/decode';
import { readLiveUrl, saveLiveUrl } from '../../persistence/storage';
import { APP_NAME, APP_VERSION } from '../../domain/schema';
import { useOnline } from '../../app/hooks';
import { Icon } from '../../components/Icon';
interface InstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
}
export function Settings({
  wakeMessage,
  installEvent,
  onInstalled,
}: {
  wakeMessage: string;
  installEvent: InstallEvent | null;
  onInstalled: () => void;
}) {
  const prefs = useUI((s) => s.preferences),
    set = useUI((s) => s.setPreferences),
    snapshot = useRace((s) => s.snapshot),
    status = useRace((s) => s.status),
    loadFixture = useRuntime((s) => s.loadFixture),
    loadReplay = useRuntime((s) => s.loadReplay),
    startDemo = useRuntime((s) => s.startDemo),
    startLive = useRuntime((s) => s.startLive),
    provider = useRuntime((s) => s.provider);
  const [url, setUrl] = useState(() => readLiveUrl() || DEFAULT_LIVE_URL),
    [validation, setValidation] = useState(''),
    [error, setError] = useState(''),
    [success, setSuccess] = useState('');
  const liveActive = provider instanceof NatsoftLiveProvider;
  const online = useOnline();
  async function importFile(file: File | undefined) {
    if (!file) return;
    setError('');
    try {
      if (file.size > MAX_REPLAY_BYTES)
        throw new Error('Replay is too large. Maximum size is 8 MB.');
      const replay = parseRecording(await file.text());
      loadReplay(replay);
      setSuccess('Loaded ' + replay.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Replay could not be loaded');
    }
  }
  function exportFile() {
    const recording = controller.getRecording();
    if (!recording.records.length) {
      setError('Wait for a race snapshot before exporting.');
      return;
    }
    const blob = new Blob([JSON.stringify(recording)], { type: 'application/json' });
    if (blob.size > MAX_REPLAY_BYTES) {
      setError('Recording exceeds 8 MB. Switch source and try a shorter recording.');
      return;
    }
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = 'panorama-replay.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
    setSuccess('Recording exported with race data from the current source.');
  }
  function validateURL() {
    try {
      resolveTimingUrl(url);
      setValidation('Valid timing URL format. Press Connect for live timing to join.');
    } catch (e) {
      setValidation(e instanceof Error ? e.message : 'Enter a full timing URL.');
    }
  }
  function connectLive() {
    setError('');
    setSuccess('');
    try {
      const resolved = resolveTimingUrl(url);
      // Persist the meeting address without query/hash: Natsoft meeting URLs
      // carry no secrets, and anything after `?` (tokens, overrides) is
      // never stored. The full URL is used for this session only.
      const stripped = new URL(resolved.pageUrl);
      stripped.search = '';
      stripped.hash = '';
      saveLiveUrl(stripped.toString());
      startLive(resolved.pageUrl);
      setSuccess('Connecting to live timing…');
      setValidation('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Live timing could not start.');
    }
  }
  function disconnectLive() {
    saveLiveUrl('');
    startDemo();
    setSuccess('Disconnected. Demo simulator restarted.');
  }
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  return (
    <div className="settings-layout">
      <section className="panel settings-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">MAKE IT YOURS</span>
            <h2>Display & preferences</h2>
          </div>
          <Icon name="settings" />
        </div>
        <div className="settings-body">
          <label className="field">
            Interface style
            <select
              aria-label="Interface style"
              value={prefs.uiStyle}
              onChange={(e) => set({ uiStyle: e.target.value as typeof prefs.uiStyle })}
            >
              <option value="fan">Friendly race companion</option>
              <option value="hacker">Hacker UI · compact technical style</option>
            </select>
            <small className="muted">
              A clear, comfortable race view is the default. Choose Hacker UI for the original dense
              dashboard.
            </small>
          </label>
          <label className="field">
            Theme
            <select
              aria-label="Theme"
              value={prefs.theme}
              onChange={(e) => set({ theme: e.target.value as typeof prefs.theme })}
            >
              <option value="dark">Dark</option>
              <option value="light">Light</option>
              <option value="system">Follow system</option>
            </select>
          </label>
          <label className="field">
            Timing row density
            <select
              aria-label="Timing row density"
              value={prefs.density}
              onChange={(e) => set({ density: e.target.value as typeof prefs.density })}
            >
              <option value="comfortable">Comfortable</option>
              <option value="compact">Compact</option>
            </select>
          </label>
          <label className="field">
            Motion
            <select
              aria-label="Motion"
              value={prefs.motion}
              onChange={(e) => set({ motion: e.target.value as typeof prefs.motion })}
            >
              <option value="system">Follow reduced-motion system preference</option>
              <option value="reduced">Reduce motion</option>
              <option value="full">Full animation</option>
            </select>
          </label>
          <label className="check-field">
            <input
              type="checkbox"
              checked={prefs.awake}
              disabled={!('wakeLock' in navigator)}
              onChange={(e) => set({ awake: e.target.checked })}
            />
            <span>
              Keep screen awake<small>{wakeMessage}</small>
            </span>
          </label>
          <div className="detail-section">
            <h4>
              Favourite cars <span className="count">{prefs.favourites.length}</span>
            </h4>
            <div className="favourite-chips">
              {prefs.favourites.map((id) => (
                <button
                  className="button small"
                  key={id}
                  onClick={() => useUI.getState().toggleFavourite(id)}
                >
                  #{snapshot?.entries.find((e) => e.id === id)?.number ?? id}{' '}
                  <Icon name="close" size={14} />
                </button>
              ))}
            </div>
            {!prefs.favourites.length && (
              <p className="muted">Star a car in the standings to follow it.</p>
            )}
            {prefs.favourites.length > 0 && (
              <button className="text-button" onClick={() => set({ favourites: [] })}>
                Clear all favourites
              </button>
            )}
          </div>
        </div>
      </section>
      <section className="panel settings-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">DATA SOURCE</span>
            <h2>Demo & replay</h2>
          </div>
          <Icon name="radio" />
        </div>
        <div className="settings-body">
          <p>
            The simulator is available offline. Fictional drivers and entries are independent of the
            official 2026 field.
          </p>
          <div className="source-actions">
            <button className="button" onClick={() => startDemo()}>
              <Icon name="play" />
              Demo simulator
            </button>
            <button
              className="button"
              onClick={() => {
                void loadFixture()
                  .then(() => {
                    setSuccess('Bundled replay loaded');
                    setError('');
                  })
                  .catch((e) => setError(String(e)));
              }}
            >
              Load sample replay
            </button>
            <button className="button" onClick={() => useUI.setState({ controlsOpen: true })}>
              <Icon name="controls" />
              {prefs.uiStyle === 'fan' ? 'Open demo controls' : 'Open race lab'}
            </button>
          </div>
          <div className="detail-section">
            <h4>Replay recordings</h4>
            <p className="muted">
              Import a validated Panorama JSON recording (up to 8 MB). Export captures up to 60
              recent updates.
            </p>
            <div className="source-actions">
              <label className="button file-button">
                <Icon name="upload" />
                Import replay
                <input
                  type="file"
                  accept="application/json,.json"
                  aria-label="Import replay file"
                  onChange={(e) => {
                    void importFile(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
              </label>
              <button className="button" onClick={exportFile}>
                <Icon name="download" />
                Export recording
              </button>
            </div>
            {error && (
              <p className="error-text" role="alert">
                {error}
              </p>
            )}
            {success && (
              <p className="success-text" role="status">
                {success}
              </p>
            )}
          </div>
          <div className="detail-section">
            <h4>Live timing (Natsoft)</h4>
            {liveActive ? (
              <>
                <p className="muted">
                  Connected source:{' '}
                  <span className="mono">{(provider as NatsoftLiveProvider).pageUrl}</span>
                </p>
                <p className="muted" role="status">
                  Feed: {status.connection} · {status.message}
                </p>
                <div className="source-actions">
                  <button className="button" onClick={disconnectLive}>
                    <Icon name="close" />
                    Disconnect live timing
                  </button>
                </div>
                <small className="muted">
                  Positions are coarse track-segment reports from the timing feed — the map
                  shows genuine observations, never invented GPS.
                </small>
              </>
            ) : (
              <>
                <label className="field">
                  Timing URL{' '}
                  <input
                    type="url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="http://server.natsoft.com.au:8080/LiveMeeting/20261011.MOUN"
                    autoComplete="off"
                  />
                </label>
                <div className="source-actions">
                  <button className="button" onClick={validateURL}>
                    Check URL format
                  </button>
                  <button className="button accent-button" onClick={connectLive}>
                    <Icon name="radio" />
                    Connect live timing
                  </button>
                </div>
                <p className="muted" role="status">
                  {validation ||
                    'Paste a Natsoft LiveMeeting page URL. The app opens its timing feed directly — no login, no proxy.'}
                </p>
                <small className="muted">
                  Only explicit timing URLs are ever opened. Redirects are revalidated and
                  credential-bearing URLs are rejected.
                </small>
              </>
            )}
          </div>
        </div>
      </section>
      <section className="panel settings-panel about-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">TAKE IT TRACKSIDE</span>
            <h2>Install & offline</h2>
          </div>
          <Icon name="bookmark" />
        </div>
        <div className="settings-body">
          <p>
            {online ? 'Browser is online.' : 'Browser is offline · the demo still works.'} After
            your first successful visit to the production app, its essential files are available
            offline.
          </p>
          {installEvent ? (
            <button
              className="button accent-button"
              onClick={() => {
                void installEvent
                  .prompt()
                  .then(() => installEvent.userChoice)
                  .then(onInstalled);
              }}
            >
              Install {APP_NAME}
            </button>
          ) : (
            <p className="notice">
              {ios
                ? 'On iPhone or iPad: open in Safari, tap Share, then Add to Home Screen.'
                : 'Use your browser’s Install app option when available. Installation requires HTTPS or localhost and the production build.'}
            </p>
          )}
          <p className="muted">
            Updates wait for your confirmation. Browsers may suspend the app in the background; it
            resynchronises when you return.
          </p>
          <div className="about-line">
            <span>
              {APP_NAME} v{APP_VERSION}
            </span>
            <span>Independent · unaffiliated</span>
          </div>
          <p className="muted">
            All demo timing, telemetry, entries, and events are simulated. Circuit geometry is
            adapted from OpenStreetMap. Sector and pit-service anchors are demo estimates.
          </p>
        </div>
      </section>
    </div>
  );
}
