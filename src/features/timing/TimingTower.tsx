import { useEffect, useRef, useState } from 'react';
import { useRace, useUI } from '../../state/store';
import { bestRaceLap, currentLapTime, driverName, gapText, lapTime, paceClass, pitDwellMs, shortTime, standings } from '../../domain/format';
import { ManufacturerBadge, manufacturerOf } from '../../components/ManufacturerBadge';
import { Icon } from '../../components/Icon';
export function TimingTower() {
  const friendly = useUI((s) => s.preferences.uiStyle) === 'fan';
  const snapshot = useRace((s) => s.snapshot);
  const preferences = useUI((s) => s.preferences);
  const search = useUI((s) => s.search);
  const only = useUI((s) => s.onlyFavourites);
  const selected = useUI((s) => s.selectedId);
  const select = useUI((s) => s.select);
  const toggle = useUI((s) => s.toggleFavourite);
  const setPref = useUI((s) => s.setPreferences);
  const cars = standings(snapshot, search, preferences.favourites, only),
    best = bestRaceLap(snapshot);
  // Phones show best lap plus gap and split side by side.
  const nonRace = snapshot?.session.type === 'practice' || snapshot?.session.type === 'qualifying';
  const previous = useRef(new Map<string, number | null>());
  const [changes, setChanges] = useState<Record<string, number>>({});
  const rankTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (rankTimer.current) clearTimeout(rankTimer.current);
    },
    [],
  );
  useEffect(() => {
    const next: Record<string, number> = {};
    for (const e of snapshot?.entries ?? []) {
      const p = previous.current.get(e.id);
      if (p && e.position && p !== e.position) next[e.id] = p - e.position;
      previous.current.set(e.id, e.position);
    }
    if (Object.keys(next).length) {
      setChanges(next);
      if (rankTimer.current) clearTimeout(rankTimer.current);
      rankTimer.current = setTimeout(() => setChanges({}), 4500);
    }
  }, [snapshot]);
  return (
    <section className="panel tower" aria-label="Race classification">
      <div className="panel-heading">
        <div className="section-title">
          <span className="eyebrow">{friendly ? 'How the race stands' : 'CLASSIFICATION'}</span>
          <h2>
            {friendly ? 'Race standings' : 'Timing tower'}{' '}
            <span className="count">{snapshot?.entries.length ?? 0}</span>
          </h2>
        </div>
        <button
          className={'button small ' + (only ? 'active' : '')}
          onClick={() => useUI.setState({ onlyFavourites: !only })}
          aria-pressed={only}
        >
          <Icon name="star" /> <span>Favourites</span>
        </button>
      </div>
      <div className="tower-tools">
        <label className="search">
          <Icon name="search" />
          <input
            type="search"
            aria-label="Search cars, drivers or teams"
            placeholder="Find a car, driver or team"
            value={search}
            onChange={(e) => useUI.setState({ search: e.target.value })}
          />
        </label>
        <button
          className="button small gap-toggle"
          onClick={() => setPref({ gapMode: preferences.gapMode === 'gap' ? 'interval' : 'gap' })}
        >
          <Icon name="sort" />
          {preferences.gapMode === 'gap'
            ? friendly
              ? 'To leader'
              : 'Gap'
            : friendly
              ? 'Car ahead'
              : 'Interval'}
        </button>
      </div>
      <table className={'timing-table ' + (nonRace ? 'session-nonrace' : 'session-race')}>
        <thead>
          <tr>
            <th scope="col">{friendly ? 'Pos.' : 'POS'}</th>
            <th scope="col">{friendly ? 'Car & driver' : 'CAR / DRIVER'}</th>
            <th className="gap-col" scope="col">
              {preferences.gapMode === 'gap'
                ? friendly
                  ? 'Gap'
                  : 'GAP'
                : friendly
                  ? 'Ahead'
                  : 'INT.'}
            </th>
            <th className="last-col" scope="col">
              {friendly ? 'Last lap' : 'LAST LAP'}
            </th>
            <th className="current-col" scope="col">
              {friendly ? 'Split' : 'SPLIT'}
            </th>
            <th className="best-col" scope="col">
              {friendly ? 'Best lap' : 'BEST LAP'}
            </th>
            <th className="wide-col" scope="col">
              {friendly ? 'Laps' : 'LAPS'}
            </th>
            <th scope="col">
              <span className="sr-only">Favourite</span>
              <Icon name="star" size={14} />
            </th>
          </tr>
        </thead>
        <tbody>
          {cars.map((e) => {
            const dwell = pitDwellMs(e, snapshot?.session.elapsed ?? 0);
            const narrow =
              typeof matchMedia !== 'undefined' && matchMedia('(max-width:720px)').matches;
            const dwellText =
              dwell !== null ? 'PIT +' + (narrow ? shortTime(dwell) : lapTime(dwell)) : null;
            // Personal-best pace colours only the split; session-best pace
            // additionally tints the whole name plate. Never while pitting.
            const pace = dwell !== null ? '' : paceClass(e.currentSectors, snapshot?.session.bestSectors, e.personalBestSectors);
            const mfr = manufacturerOf(e.team.name);
            return (
            <tr
              key={e.id}
              className={
                (e.id === selected ? 'selected ' : '') +
                (e.status === 'retired' ? 'retired ' : '') +
                (changes[e.id] ? 'changed' : '')
              }
              style={{ '--team': e.team.colour } as React.CSSProperties}
            >
              <td>
                <span className="position">{String(e.position ?? '—').padStart(2, '0')}</span>
                {changes[e.id] && (
                  <span
                    className={'rank-change ' + (changes[e.id] > 0 ? 'up' : 'down')}
                    aria-label={'Position change ' + changes[e.id]}
                  >
                    {changes[e.id] > 0 ? '↑' : '↓'}
                  </span>
                )}
              </td>
              <td>
                <button
                  className={'car-select' + (pace === 'race-best' ? ' pace-best' : '')}
                  onClick={() => {
                    select(e.id);
                    if (matchMedia('(max-width:720px)').matches)
                      useUI.setState({ detailsOpen: true });
                  }}
                  aria-pressed={e.id === selected}
                  aria-label={'View car ' + e.number + ', ' + driverName(e)}
                >
                  <span className="car-number">{e.number}</span>
                  <span className="driver">
                    <strong>{driverName(e)}</strong>
                    <span>
                      {mfr ? (
                        <>
                          <ManufacturerBadge vehicle={e.team.name} />{' '}
                          <span className="mfr-model">{mfr.model || mfr.brand}</span>
                        </>
                      ) : (
                        e.team.name
                      )}
                      {e.status !== 'running' && (
                        <b className={'status-tag ' + e.status}>
                          {e.status === 'pit'
                            ? 'PIT LANE'
                            : e.status === 'finished'
                              ? 'FINISHED'
                              : e.status.toUpperCase()}
                        </b>
                      )}
                    </span>
                  </span>
                </button>
              </td>
              <td className={'gap gap-col ' + (e.gap.kind === 'leader' ? 'leader' : '')}>
                {dwellText ?? gapText(preferences.gapMode === 'gap' ? e.gap : e.interval)}
              </td>
              <td
                className={
                  'last-col lap ' +
                  (e.lastLap !== null && e.lastLap > 0 && e.lastLap === best
                    ? 'race-best'
                    : e.lastLap !== null && e.lastLap > 0 && e.lastLap === e.bestLap
                      ? 'personal-best'
                      : '')
                }
              >
                {lapTime(e.lastLap)}
              </td>
              <td className={'current-col lap ' + pace}>
                {dwellText ?? lapTime(currentLapTime(e))}
              </td>
              <td
                className={
                  'best-col lap ' +
                  (e.bestLap !== null && e.bestLap > 0 && e.bestLap === best ? 'race-best' : '')
                }
              >
                {lapTime(e.bestLap)}
              </td>
              <td className="wide-col laps">{e.laps}</td>
              <td>
                <button
                  className={
                    'icon-button favourite ' +
                    (preferences.favourites.includes(e.id) ? 'is-favourite' : '')
                  }
                  aria-label={
                    (preferences.favourites.includes(e.id) ? 'Unfavourite' : 'Favourite') +
                    ' car ' +
                    e.number
                  }
                  aria-pressed={preferences.favourites.includes(e.id)}
                  onClick={() => toggle(e.id)}
                >
                  <Icon name="star" size={16} />
                </button>
              </td>
            </tr>
            );
          })}
        </tbody>
      </table>
      {!cars.length && (
        <div className="empty">
          <Icon name="search" />
          <strong>No cars match</strong>
          <p>Try another search or clear the favourites filter.</p>
          <button
            className="button"
            onClick={() => useUI.setState({ search: '', onlyFavourites: false })}
          >
            Clear filters
          </button>
        </div>
      )}
      <div className="tower-footer">
        <span>
          <i className="legend-dot purple" /> Race best
        </span>
        <span>
          <i className="legend-dot green" /> Personal best
        </span>
        <span className="muted">
          {snapshot?.entries.length ?? 0}{' '}
          {snapshot?.source === 'live'
            ? 'live cars'
            : snapshot?.source === 'replay'
              ? 'replay cars'
              : 'demo cars'}
        </span>
      </div>
    </section>
  );
}
