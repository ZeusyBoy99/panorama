import { useState } from 'react';
import { useRace, useUI } from '../../state/store';
import { useTicker } from '../../app/hooks';
import { Icon } from '../../components/Icon';

/**
 * Pops up when the live feed shows a car falling 5+ places in ~90 seconds —
 * more than an ordinary overtake. Every alert is a *possible* incident: the
 * timing feed reports positions only, never the cause, and pit stops are
 * already filtered out before an alert can fire.
 */
export function IncidentBanner() {
  const snapshot = useRace((s) => s.snapshot);
  const select = useUI((s) => s.select);
  const [dismissed, setDismissed] = useState<string[]>([]);
  useTicker();
  if (!snapshot || snapshot.source !== 'live') return null;
  const incidents = snapshot.events.filter(
    (e) =>
      e.origin === 'derived' &&
      e.category === 'position' &&
      e.message.startsWith('Possible incident') &&
      !dismissed.includes(e.id) &&
      snapshot.session.elapsed - e.at < 120_000,
  );
  const latest = incidents.at(-1);
  if (!latest) return null;
  const carId = latest.entryIds[0];
  const number = snapshot.entries.find((e) => e.id === carId)?.number ?? carId;
  return (
    <div className="state-notice incident-notice" role="alert">
      <Icon name="alert" size={16} />
      <span>
        <strong>Possible incident — car {number}.</strong> {latest.message}
      </span>
      <span className="incident-actions">
        {carId && (
          <button className="button small" onClick={() => select(carId)}>
            View car
          </button>
        )}
        <button
          className="button small"
          aria-label="Dismiss incident warning"
          onClick={() => setDismissed([...dismissed, latest.id])}
        >
          Dismiss
        </button>
      </span>
    </div>
  );
}
