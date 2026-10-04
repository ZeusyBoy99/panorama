import type { Entry, Gap, Snapshot } from './schema';
export function lapTime(ms: number | null) {
  if (ms === null || !Number.isFinite(ms) || ms <= 0) return '—';
  const r = Math.round(ms);
  return (
    Math.floor(r / 60000) +
    ':' +
    String(Math.floor(r / 1000) % 60).padStart(2, '0') +
    '.' +
    String(r % 1000).padStart(3, '0')
  );
}
export function gapText(gap: Gap) {
  switch (gap.kind) {
    case 'leader':
      return 'LEADER';
    case 'seconds':
      return '+' + (gap.value / 1000).toFixed(3);
    case 'laps':
      return '+' + gap.value + ' LAP' + (gap.value === 1 ? '' : 'S');
    default:
      return '—';
  }
}
export function clockTime(ms: number) {
  const s = Math.floor(ms / 1000);
  return (
    String(Math.floor(s / 3600)).padStart(2, '0') +
    ':' +
    String(Math.floor(s / 60) % 60).padStart(2, '0') +
    ':' +
    String(s % 60).padStart(2, '0')
  );
}
export function driverName(e: Entry) {
  return e.drivers.find((d) => d.id === e.currentDriverId)?.name ?? 'Driver unknown';
}
export function standings(
  s: Snapshot | null,
  search = '',
  favourites: string[] = [],
  only = false,
) {
  return (s?.entries ?? [])
    .filter(
      (e) =>
        (!only || favourites.includes(e.id)) &&
        [e.number, e.team.name, ...e.drivers.map((d) => d.name)]
          .join(' ')
          .toLowerCase()
          .includes(search.toLowerCase()),
    )
    .sort((a, b) => (a.position ?? 999) - (b.position ?? 999));
}
export function bestRaceLap(s: Snapshot | null) {
  const valid = (s?.entries ?? [])
    .map((e) => e.bestLap)
    .filter((n): n is number => n !== null && n > 0);
  return valid.length ? Math.min(...valid) : null;
}
