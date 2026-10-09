import { useEffect, useState } from 'react';
import { NavLink, Route, Routes, useSearchParams } from 'react-router-dom';
import { useRace, useUI } from '../state/store';
import { useRuntime } from '../state/runtime';
import { controller } from '../state/controller';
import { useOnline, useTheme, useTicker, useVisibilityResync, useWakeLock } from './hooks';
import { APP_NAME } from '../domain/schema';
import { DEFAULT_LIVE_URL } from '../providers/live/decode';
import { readLiveUrl } from '../persistence/storage';
import { shouldBootLive } from '../state/runtime';
import { clockTime } from '../domain/format';
import { Icon } from '../components/Icon';
import { TimingTower } from '../features/timing/TimingTower';
import { CircuitMap } from '../features/map/CircuitMap';
import { CarDetails } from '../features/cars/CarDetails';
import { EventFeed } from '../features/events/EventFeed';
import { IncidentBanner } from '../features/events/IncidentBanner';
import { DemoControls } from '../features/demo-controls/DemoControls';
import { Settings } from '../features/settings/Settings';
import { UpdatePrompt } from '../pwa/UpdatePrompt';
interface InstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
}
function Dashboard() {
  return (
    <div className="dashboard-grid">
      <TimingTower />
      <div className="dashboard-aside">
        <CircuitMap />
        <CarDetails />
        <EventFeed compact />
      </div>
    </div>
  );
}
function Header() {
  const snapshot = useRace((s) => s.snapshot),
    status = useRace((s) => s.status),
    cached = useRace((s) => s.cached),
    error = useRace((s) => s.validationError),
    storageError = useUI((s) => s.storageError);
  const friendly = useUI((s) => s.preferences.uiStyle) === 'fan';
  const selected = useUI((s) => s.selectedId);
  const route = (pathname: string) => ({
    pathname,
    search: selected ? '?car=' + encodeURIComponent(selected) : '',
  });
  const online = useOnline(),
    now = useTicker();
  const age =
    snapshot?.receiptTimestamp === null || !snapshot
      ? 0
      : Math.max(0, now - snapshot.receiptTimestamp);
  const stale = !status.paused && age > 3000;
  const track = snapshot?.session.trackStatus ?? 'unknown';
  const liveProvider = useRuntime((s) => s.provider?.id === 'live');
  const live = snapshot?.source === 'live' || liveProvider;
  const sessionType = snapshot?.session.type;
  const raceLaps = snapshot?.session.raceLaps ?? 161;
  const remaining = snapshot?.session.remaining ?? null;
  const timed = snapshot?.session.timed ?? false;
  const elapsed = snapshot?.session.elapsed ?? 0;
  const leaderLaps = snapshot?.session.leaderLaps ?? 0;
  // Timed sessions (sprints to a clock, practice) have no lap total: show
  // time-based progress instead of a lap fraction. Otherwise use laps.
  const progress =
    timed && remaining !== null && elapsed + remaining > 0
      ? Math.min(100, (elapsed / (elapsed + remaining)) * 100)
      : !timed && raceLaps > 0
        ? Math.min(100, (leaderLaps / raceLaps) * 100)
        : null;
  return (
    <>
      <header className="topbar">
        <NavLink to="/" className="brand" aria-label="Panorama home">
          <span className="brand-mark">
            P<span />
          </span>
          {APP_NAME.toLowerCase()}
          <span className="brand-slash">/</span>
        </NavLink>
        <nav className="main-nav" aria-label="Main navigation">
          <NavLink to={route('/')} end>
            <Icon name="activity" />
            <span>{friendly ? 'Standings' : 'Timing'}</span>
          </NavLink>
          <NavLink to={route('/map')}>
            <Icon name="map" />
            <span>{friendly ? 'Track map' : 'Circuit'}</span>
          </NavLink>
          <NavLink to={route('/events')}>
            <Icon name="flag" />
            <span>{friendly ? 'Race updates' : 'Events'}</span>
          </NavLink>
          <NavLink to={route('/settings')}>
            <Icon name="settings" />
            <span>Settings</span>
          </NavLink>
        </nav>
        <button
          className="button lab-button"
          onClick={() => useUI.setState({ controlsOpen: true })}
        >
          <Icon name="controls" />
          <span>{friendly ? 'Demo controls' : 'Race lab'}</span>
        </button>
      </header>
      <div className="race-header">
        <div className="race-heading">
          <div className="event-kicker">
            <span>{live ? 'Live timing' : friendly ? '2026 race companion' : '2026'}</span>
            <span className="source-badge">
              {snapshot?.source === 'live'
                ? 'LIVE — NATSOFT FEED'
                : snapshot?.source === 'replay'
                  ? 'REPLAY — SIMULATED DATA'
                  : liveProvider
                    ? 'LIVE — CONNECTING'
                    : 'DEMO — SIMULATED DATA'}
            </span>
            {live && sessionType && (
              <span className="source-badge">
                {sessionType === 'race'
                  ? 'RACE'
                  : sessionType === 'qualifying'
                    ? 'QUALIFYING'
                    : 'PRACTICE'}
              </span>
            )}
            {cached && <span className="source-badge">LAST-KNOWN CACHE</span>}
          </div>
          <h1>
            {live ? (
              (snapshot?.session.name ?? 'Live timing')
            ) : (
              <>
                Bathurst <span>1000</span>
              </>
            )}
          </h1>
          <p>
            {live ? (
              <>
                {snapshot
                  ? [snapshot.session.series, snapshot.session.meeting]
                      .filter(Boolean)
                      .join(' · ') || 'Live session'
                  : 'Connecting to the timing feed…'}
              </>
            ) : (
              <>
                Mount Panorama <span>·</span> Independent race companion
              </>
            )}
          </p>
        </div>
        <div className="race-metrics">
          <div className={'track-status ' + track}>
            <Icon name="flag" />
            <strong>
              {friendly
                ? track === 'green'
                  ? 'Green flag'
                  : track === 'safety-car'
                    ? 'Safety car'
                    : track === 'chequered'
                      ? 'Race complete'
                      : track === 'red'
                        ? 'Red flag'
                        : track === 'yellow'
                          ? 'Yellow flag'
                          : 'Status unknown'
                : track.replace('-', ' ').toUpperCase()}
            </strong>
            <small>
              {snapshot?.session.phase === 'finished'
                ? 'RACE FINISHED'
                : snapshot?.session.phase === 'suspended'
                  ? 'SESSION SUSPENDED'
                  : snapshot?.session.phase === 'running'
                    ? 'RACE IN PROGRESS'
                    : snapshot?.session.phase === 'pre-race'
                      ? 'PRE-RACE'
                      : 'PHASE UNKNOWN'}
            </small>
          </div>
          <div className="race-lap">
            <span>{friendly ? (timed ? 'Laps' : 'Leader’s lap') : 'LAP'}</span>
            <strong>
              {snapshot?.session.leaderLaps ?? '—'}
              {!timed && <small> / {raceLaps}</small>}
            </strong>
            {progress !== null && (
              <div className="progress-track">
                <i style={{ width: progress + '%' }} />
              </div>
            )}
          </div>
          <div className="race-clock">
            <span>{friendly ? 'Race time' : 'RACE TIME'}</span>
            <strong>{clockTime(snapshot?.session.elapsed ?? 0)}</strong>
            {live && remaining !== null && (
              <span className="remaining-time">{clockTime(remaining)} left</span>
            )}
            <span
              className={
                'connection ' +
                (stale || status.connection === 'reconnecting' || status.connection === 'error'
                  ? 'connection-warning'
                  : '')
              }
            >
              <Icon name={!online ? 'offline' : 'radio'} size={13} />
              {cached
                ? 'Cached · original timestamps'
                : !online
                  ? 'Offline demo'
                  : status.paused
                    ? 'Playback paused'
                    : status.connection === 'reconnecting'
                      ? 'Reconnecting'
                      : status.connection === 'error'
                        ? 'Feed error'
                        : stale
                          ? 'Stale data'
                          : status.connection === 'connecting'
                            ? 'Connecting'
                            : status.connection === 'stopped'
                              ? 'Feed stopped'
                              : 'Feed connected'}
              <b>· {Math.floor(age / 1000)}s</b>
            </span>
          </div>
        </div>
      </div>
      {(!online ||
        stale ||
        cached ||
        error ||
        storageError ||
        status.connection === 'reconnecting') && (
        <div className="state-notice" role="status">
          <Icon name="alert" size={16} />
          <span>
            {error ??
              (cached
                ? 'Showing last-known cached data with original freshness.'
                : !online
                  ? 'Offline demo operation · no live feed connection is required.'
                  : status.connection === 'reconnecting'
                    ? status.message
                    : storageError
                      ? 'Local storage is unavailable. Changes remain in this session.'
                      : 'Feed is stale · last accepted snapshot retained.')}
          </span>
        </div>
      )}
    </>
  );
}
function LiveFooter() {
  const snapshot = useRace((s) => s.snapshot);
  const liveProvider = useRuntime((s) => s.provider?.id === 'live');
  if (snapshot?.source === 'live' || liveProvider)
    return <span>Live timing · Natsoft Race Results · Positions are coarse track segments</span>;
  return <span>Fictional demo · OpenStreetMap circuit geometry · No official affiliation</span>;
}
export function App() {
  useTheme();
  useVisibilityResync();
  const wakeMessage = useWakeLock();
  const start = useRuntime((s) => s.startDemo);
  const startLive = useRuntime((s) => s.startLive);
  const [params] = useSearchParams();
  const [install, setInstall] = useState<InstallEvent | null>(null);
  useEffect(() => {
    const handler = (event: Event) => {
      event.preventDefault();
      setInstall(event as InstallEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);
  useEffect(() => {
    controller.hydrate();
    // Live is the default: connect to the timing feed unless the visitor
    // asked for the demo (?demo) or is offline. `?live` links keep working.
    if (shouldBootLive(window.location.search, navigator.onLine)) {
      try {
        startLive(readLiveUrl() || DEFAULT_LIVE_URL);
      } catch {
        start();
      }
    } else {
      start();
    }
    return () => controller.stop();
  }, [start, startLive]);
  useEffect(() => {
    const from = params.get('car');
    if (from !== useUI.getState().selectedId) useUI.getState().select(from);
  }, [params]);

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to race dashboard
      </a>
      <Header />
      <main id="main">
        <IncidentBanner />
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route
            path="/map"
            element={
              <div className="map-page">
                <CircuitMap large />
                <div>
                  <CarDetails />
                  <EventFeed compact />
                </div>
              </div>
            }
          />
          <Route
            path="/events"
            element={
              <div className="events-page">
                <EventFeed />
                <CarDetails />
              </div>
            }
          />
          <Route
            path="/settings"
            element={
              <Settings
                wakeMessage={wakeMessage}
                installEvent={install}
                onInstalled={() => setInstall(null)}
              />
            }
          />
          <Route
            path="*"
            element={
              <div className="empty">
                <h2>Page not found</h2>
                <NavLink className="button" to="/">
                  Return to timing
                </NavLink>
              </div>
            }
          />
        </Routes>
      </main>
      <footer className="app-footer">
        <span>Panorama · Stay close to the race.</span>
        <LiveFooter />
      </footer>
      <DemoControls />
      <UpdatePrompt />
    </>
  );
}
