import { useEffect, useRef } from 'react';
import { useRace, useUI } from '../../state/store';
import { clockTime, driverName, gapText, lapTime } from '../../domain/format';
import { resolvePosition } from '../map/resolver';
import { Icon } from '../../components/Icon';
import { ManufacturerBadge } from '../../components/ManufacturerBadge';
import type { Entry } from '../../domain/schema';
function Trend({ entry }: { entry: Entry }) {
  const values = entry.lapHistory.filter((l) => l.valid && l.time > 0).slice(-12);
  if (values.length < 2) return <p className="muted">Lap history unavailable</p>;
  const min = Math.min(...values.map((v) => v.time)),
    max = Math.max(...values.map((v) => v.time));
  const points = values
    .map(
      (v, i) =>
        (i / (values.length - 1)) * 290 +
        5 +
        ',' +
        (55 - ((v.time - min) / Math.max(1, max - min)) * 40),
    )
    .join(' ');
  return (
    <div className="lap-trend">
      <svg
        viewBox="0 0 300 70"
        role="img"
        aria-label={
          'Last ' +
          values.length +
          ' lap times, fastest ' +
          lapTime(min) +
          ', slowest ' +
          lapTime(max)
        }
      >
        <path d="M5 55H295 M5 15H295" className="trend-grid" />
        <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" />
        {values.map((v, i) => (
          <circle
            key={v.lap}
            cx={(i / (values.length - 1)) * 290 + 5}
            cy={55 - ((v.time - min) / Math.max(1, max - min)) * 40}
            r="2.5"
          />
        ))}
      </svg>
      <span>LAST {values.length} LAPS</span>
      <span>
        {lapTime(min)} – {lapTime(max)}
      </span>
    </div>
  );
}
function Contents({ entry, full = false }: { entry: Entry; full?: boolean }) {
  const snapshot = useRace((s) => s.snapshot)!;
  const favourites = useUI((s) => s.preferences.favourites);
  const toggle = useUI((s) => s.toggleFavourite);
  const position = resolvePosition(entry, snapshot, snapshot.session.elapsed);
  const events = snapshot.events
    .filter((e) => e.entryIds.includes(entry.id))
    .slice(-6)
    .reverse();
  return (
    <>
      <div
        className="car-detail-title"
        style={{ '--team': entry.team.colour } as React.CSSProperties}
      >
        <div className="large-number">{entry.number}</div>
        <div>
          <span className="eyebrow">
            <ManufacturerBadge vehicle={entry.team.name} /> {entry.team.name}
          </span>
          <h3>{driverName(entry)}</h3>
          <span className="muted">
            {entry.status === 'running' ? 'On track' : entry.status.toUpperCase()} ·{' '}
            {position.provenance === 'unavailable'
              ? 'Location unavailable'
              : position.provenance + ' position'}
          </span>
        </div>
        <button
          className={
            'icon-button favourite ' + (favourites.includes(entry.id) ? 'is-favourite' : '')
          }
          aria-label={
            (favourites.includes(entry.id) ? 'Unfavourite' : 'Favourite') +
            ' selected car ' +
            entry.number
          }
          aria-pressed={favourites.includes(entry.id)}
          onClick={() => toggle(entry.id)}
        >
          <Icon name="star" />
        </button>
      </div>
      <div className="detail-stats">
        <div>
          <span>POSITION</span>
          <strong>P{entry.position ?? '—'}</strong>
        </div>
        <div>
          <span>TO LEADER</span>
          <strong>{gapText(entry.gap)}</strong>
        </div>
        <div>
          <span>LAPS</span>
          <strong>{entry.laps}</strong>
        </div>
        <div>
          <span>PIT STOPS</span>
          <strong>{entry.pits ?? '—'}</strong>
        </div>
      </div>
      <div className="lap-pair">
        <div>
          <span>LAST LAP</span>
          <strong>{lapTime(entry.lastLap)}</strong>
        </div>
        <div>
          <span>BEST LAP</span>
          <strong>{lapTime(entry.bestLap)}</strong>
        </div>
      </div>
      <Trend entry={entry} />
      {full && (
        <>
          <div className="detail-section">
            <h4>Driver pairing</h4>
            {entry.drivers.map((d) => (
              <div className="driver-pair" key={d.id}>
                <span>{d.name}</span>
                <span className={d.id === entry.currentDriverId ? 'accent' : 'muted'}>
                  {d.id === entry.currentDriverId ? 'CURRENT DRIVER' : 'CO-DRIVER'}
                </span>
              </div>
            ))}
          </div>
          <div className="detail-section">
            <h4>Sector timing</h4>
            <table className="sector-table">
              <thead>
                <tr>
                  <th>SECTOR</th>
                  <th>PREVIOUS LAP</th>
                  <th>CURRENT LAP</th>
                </tr>
              </thead>
              <tbody>
                {[0, 1, 2].map((i) => (
                  <tr key={i}>
                    <td>S{i + 1}</td>
                    <td>{lapTime(entry.previousSectors[i])}</td>
                    <td>{lapTime(entry.currentSectors[i])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted">Uncompleted or unsupported sectors appear as —.</p>
          </div>
          <div className="detail-section">
            <h4>Recent laps</h4>
            {entry.lapHistory.length ? (
              <div className="history-list">
                {[...entry.lapHistory].reverse().map((l) => (
                  <div key={l.lap}>
                    <span>LAP {l.lap}</span>
                    <strong>{lapTime(l.time)}</strong>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">This source does not supply lap timing.</p>
            )}
          </div>
          <div className="detail-section">
            <h4>Stint history</h4>
            {entry.stints.map((s, i) => (
              <div className="driver-pair" key={i}>
                <span>
                  {entry.drivers.find((d) => d.id === s.driverId)?.name ?? 'Unknown driver'}
                </span>
                <span className="muted">
                  FROM LAP {s.fromLap} · {clockTime(s.at)}
                </span>
              </div>
            ))}
          </div>
          {entry.penalty && (
            <p className="notice warning">{entry.penalty.message} · supplied demo event</p>
          )}
          <div className="detail-section">
            <h4>Related events</h4>
            {events.length ? (
              events.map((e) => (
                <div className="detail-event" key={e.id}>
                  <span className="mono muted">{clockTime(e.at)}</span>
                  <p>
                    {e.message}
                    <small>
                      {e.origin === 'derived'
                        ? 'Derived from classification'
                        : 'Supplied demo event'}
                    </small>
                  </p>
                </div>
              ))
            ) : (
              <p className="muted">No recent events for this car.</p>
            )}
          </div>
          <p className="muted">{position.reason}. Map positions never change classification.</p>
        </>
      )}
    </>
  );
}
export function CarDetails() {
  const snapshot = useRace((s) => s.snapshot);
  const selected = useUI((s) => s.selectedId);
  const detailsOpen = useUI((s) => s.detailsOpen);
  const entry = snapshot?.entries.find((e) => e.id === selected) ?? snapshot?.entries[0];
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (detailsOpen && !dialog.current?.open) dialog.current?.showModal();
    if (!detailsOpen && dialog.current?.open) dialog.current.close();
  }, [detailsOpen]);
  if (!entry) return null;
  return (
    <>
      <section className="panel selected-panel">
        <div className="panel-heading">
          <span className="eyebrow">FOLLOWING CAR {entry.number}</span>
          <button className="text-button" onClick={() => useUI.setState({ detailsOpen: true })}>
            Full details <Icon name="chevron" size={14} />
          </button>
        </div>
        <Contents entry={entry} />
      </section>
      <dialog
        className="dialog car-dialog"
        ref={dialog}
        onClose={() => useUI.setState({ detailsOpen: false })}
        onClick={(e) => {
          if (e.target === e.currentTarget) dialog.current?.close();
        }}
      >
        <div className="dialog-heading">
          <div>
            <span className="eyebrow">
              {snapshot?.source === 'replay' ? 'REPLAY — SIMULATED DATA' : 'DEMO — SIMULATED DATA'}
            </span>
            <h2>Car {entry.number}</h2>
          </div>
          <button
            className="icon-button"
            aria-label="Close car details"
            onClick={() => dialog.current?.close()}
          >
            <Icon name="close" />
          </button>
        </div>
        <Contents entry={entry} full />
      </dialog>
    </>
  );
}
