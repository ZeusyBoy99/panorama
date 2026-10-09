import { useState } from 'react';
import { useRace, useUI } from '../../state/store';
import { clockTime } from '../../domain/format';
import { Icon } from '../../components/Icon';
export function EventFeed({ compact = false }: { compact?: boolean }) {
  const snapshot = useRace((s) => s.snapshot);
  const favourites = useUI((s) => s.preferences.favourites);
  const select = useUI((s) => s.select);
  const [only, setOnly] = useState(false);
  const live = snapshot?.source === 'live';
  const events = (snapshot?.events ?? [])
    .filter((e) => !only || e.entryIds.some((id) => favourites.includes(id)))
    .slice(compact ? -5 : -100)
    .reverse();
  return (
    <section
      className={'panel events-panel ' + (compact ? 'compact-events' : '')}
      aria-label="Race events"
    >
      <div className="panel-heading">
        <div className="section-title">
          <span className="eyebrow">RACE CONTROL & TIMING</span>
          <h2>{compact ? 'Latest activity' : 'Race events'}</h2>
        </div>
        <button
          className={'button small ' + (only ? 'active' : '')}
          onClick={() => setOnly(!only)}
          aria-pressed={only}
        >
          <Icon name="star" />
          <span>Favourites</span>
        </button>
      </div>
      <div className="event-list">
        {events.map((e) => (
          <article key={e.id} className={'race-event event-' + e.category}>
            <div className="event-symbol">
              <Icon
                name={
                  e.message.startsWith('Possible incident')
                    ? 'alert'
                    : e.category === 'pit'
                    ? 'gauge'
                    : e.category === 'status' || e.category === 'finish'
                      ? 'flag'
                      : e.category === 'fastest'
                        ? 'clock'
                        : e.category === 'retirement'
                          ? 'alert'
                          : 'activity'
                }
                size={16}
              />
            </div>
            <div className="event-content">
              <div>
                <span className="event-category">{e.category.toUpperCase()}</span>
                <time className="mono">{clockTime(e.at)}</time>
              </div>
              {e.entryIds.length ? (
                <button className="event-message" onClick={() => select(e.entryIds[0])}>
                  {e.message}
                </button>
              ) : (
                <p>{e.message}</p>
              )}
              <small>
                {e.message.startsWith('Possible incident')
                  ? 'Derived · position drop — cause unknown, not a crash claim'
                  : e.origin === 'derived'
                    ? 'Derived · classification change'
                    : live
                      ? 'Supplied · live feed'
                      : 'Supplied · simulated feed'}
              </small>
            </div>
          </article>
        ))}
        {!events.length && (
          <div className="empty">
            <Icon name="flag" />
            <strong>No matching events</strong>
            <p>New race events will appear here.</p>
          </div>
        )}
      </div>
      {!compact && (
        <p className="panel-footnote">
          Derived classification changes do not establish the physical location or exact moment of
          an overtake.
        </p>
      )}
    </section>
  );
}
