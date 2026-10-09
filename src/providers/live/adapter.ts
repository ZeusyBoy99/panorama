/**
 * Natsoft feed state -> Panorama Snapshot (schemaVersion 1) adapter.
 *
 * Mapping notes (all approximations are documented, never presented as
 * surveyed truth):
 * - Classification, gaps (seconds or laps), lap/sector durations and pit-stop
 *   counts come straight from the feed and are authoritative.
 * - Track position (LP) is a coarse 7-segment (occasionally "Main") position
 *   report, published with provenance `reported`. Markers will sit at segment
 *   midpoints and go stale between reports; that jumpiness is honest.
 * - No timestamped sector/lap crossings are exposed, so sectorCrossings and
 *   lapCrossings stay false and no crossing anchors are published. The map
 *   resolver therefore never invents timing estimates for live data.
 * - Session type (race/practice/qualifying), series and meeting are parsed
 *   from the feed's labels; the scheduled lap count of timed support races is
 *   unknown, so raceLaps falls back to the leader's completed laps.
 */

import type { Capabilities, Entry, Gap, RaceEvent, Snapshot } from '../../domain/schema';
import type { BoardRow, EntryDef, LiveFeedState } from './state';
import { IncidentDetector } from './incidents';

export const LIVE_CAPABILITIES: Capabilities = {
  classification: true,
  gapData: true,
  lapTiming: true,
  lapCrossings: false,
  sectorCrossings: false,
  pitStatus: true,
  currentDriver: true,
  positionSamples: true,
  raceControl: true,
};

const TEAM_COLOURS = [
  '#E85D75', '#4EA5FF', '#F0B44D', '#A78BFA', '#3ECFAD', '#FF8A65',
  '#51C4DF', '#D784DD', '#BDC96A', '#F28AB2', '#9DB2CE', '#D9AD7C',
  '#7CE3A8', '#E8C547', '#5DA9E9', '#EF8354',
];

export function parseTimeSeconds(value: string | undefined): number | null {
  if (!value || value === '?') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 1000);
}

/**
 * Natsoft clock/counter values use a trailing "-" for negatives ("238-").
 * Returns milliseconds (may be negative = expired) or null when unreadable.
 */
export function parseClockMs(value: string | undefined): number | null {
  if (value === undefined || value === '' || value === '?') return null;
  const negative = value.endsWith('-');
  const n = Number(negative ? value.slice(0, -1) : value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 1000) * (negative ? -1 : 1);
}

export function parseGap(lapsStr: string | undefined, secStr: string | undefined): Gap {
  const laps = lapsStr === '?' ? NaN : Number(lapsStr);
  if (Number.isFinite(laps) && laps > 0) return { kind: 'laps', value: Math.floor(laps) };
  const ms = parseTimeSeconds(secStr);
  if (ms !== null) return { kind: 'seconds', value: ms };
  return { kind: 'unknown' };
}

export function mapSessionType(kind: string): 'race' | 'practice' | 'qualifying' {
  const k = kind.toLowerCase();
  if (k.includes('qual') || k.includes('shootout') || k.includes('top ten')) return 'qualifying';
  if (k.includes('prac') || k.includes('warm')) return 'practice';
  return 'race';
}

export function mapTrackStatus(status: string): Snapshot['session']['trackStatus'] {
  const s = status.toLowerCase();
  if (s.startsWith('green')) return 'green';
  if (s.startsWith('yellow')) return 'yellow';
  if (s.includes('safety')) return 'safety-car';
  if (s.startsWith('red')) return 'red';
  if (s.startsWith('check') || s.startsWith('cheq') || s.startsWith('finish')) return 'chequered';
  return 'unknown';
}

export function mapPhase(
  status: string,
  waiting: boolean,
  elapsedMs: number,
): Snapshot['session']['phase'] {
  const s = status.toLowerCase();
  if (waiting || s.startsWith('w')) return 'pre-race';
  if (s.startsWith('e')) return 'finished';
  if (mapTrackStatus(status) === 'chequered') return 'finished';
  if (mapTrackStatus(status) === 'red') return 'suspended';
  if (elapsedMs <= 0) return 'pre-race';
  return 'running';
}

export function parseSeason(...names: string[]): number {
  for (const name of names) {
    const m = /(19|20)\d{2}/.exec(name);
    if (m) return Number(m[0]);
  }
  return new Date().getFullYear();
}

export function parseSeries(eventName: string, categoryCode: string): string | null {
  const parts = eventName.split(' - ');
  if (parts.length > 1) return parts.slice(0, -1).join(' - ').trim() || null;
  return categoryCode || null;
}

/** Feed segment name to map label: "Int1" -> "INT 1". */
export function prettySegmentName(name: string): string {
  return name
    .replace(/([A-Za-z])(\d)/g, '$1 $2')
    .replace(/_/g, ' ')
    .trim()
    .toUpperCase();
}

/** Timing-loop labels at the same estimated positions the markers use. */
export function feedSectorLabels(state: LiveFeedState): { name: string; progress: number }[] {
  const count = Math.max(1, state.segments.length);
  return state.segments
    .map((name, i) => ({ name, id: i + 1, progress: (i + 0.5) / count }))
    .filter((s) => state.intermediateIds.includes(s.id))
    .map((s) => ({ name: prettySegmentName(s.name), progress: s.progress }));
}

/** Coarse segment label -> normalised progress. "Main" sits near start/finish. */
export function segmentProgress(lp: string | undefined, segmentCount: number): number | null {
  if (!lp) return null;
  if (lp.charAt(0) === 'M') return 0.97;
  const index = Number(lp) - 1;
  if (!Number.isFinite(index) || index < 0 || index >= Math.max(1, segmentCount)) return null;
  return (index + 0.5) / Math.max(1, segmentCount);
}

export function formatLap(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  const milli = ms % 1000;
  return m + ':' + String(s).padStart(2, '0') + '.' + String(milli).padStart(3, '0');
}

interface CarMemory {
  laps: number;
  sectors: [number | null, number | null, number | null];
  prevSectors: [number | null, number | null, number | null];
  lastLapComputed: number | null;
  history: Entry['lapHistory'];
  pits: number;
  /** First time this car was seen; previous sectors adopt the current values. */
  fresh: boolean;
}

export class NatsoftAdapter {
  private mem = new Map<string, CarMemory>();
  private events: RaceEvent[] = [];
  private detector = new IncidentDetector();
  private lastLeaderId: string | null = null;
  private lastStatus = '';
  private lastMessage = '';
  private lastBest: number | null = null;
  private lastPhase: Snapshot['session']['phase'] | '' = '';
  private sequence = 0;

  constructor(
    private readonly fileSlug: string,
    private readonly streamId: string,
  ) {}

  private addEvent(event: RaceEvent): void {
    const existing = this.events.findIndex((e) => e.id === event.id);
    if (existing !== -1) this.events[existing] = event;
    else this.events.push(event);
    this.events = this.events.slice(-100);
  }

  private entryId(number: string): string {
    return 'live-' + this.fileSlug + '-' + number.toLowerCase().replace(/[^a-z0-9]+/g, '');
  }

  build(state: LiveFeedState): Snapshot | null {
    const trackCode = (state.trackCode || 'natsoft').toLowerCase();
    const elapsedMs = Math.max(0, parseClockMs(state.clock?.elapsed) ?? 0);
    let remainingMs: number | null = null;
    if (state.clock?.kind === 'T') {
      const candidate = parseClockMs(state.clock.value);
      // An expired countdown ("238-") reads as time-up: zero remaining.
      if (candidate !== null) remainingMs = Math.max(0, candidate);
    }
    const trackStatus = mapTrackStatus(state.trackStatus);
    const phase = mapPhase(state.trackStatus, state.waiting, elapsedMs);

    const rows = [...state.board.values()].sort((a, b) => a.pos - b.pos || a.carIdx - b.carIdx);
    if (!rows.length) return null;
    this.pitsChanged.clear();
    const leaderLaps = Math.max(0, ...rows.map((r) => num(r.data['L'])));
    const scheduled = Number(state.eventLaps);
    const lapsCountdown =
      state.clock?.kind === 'L' && state.clock.value !== ''
        ? Math.max(0, Math.round(Number(state.clock.value)))
        : null;
    const lapsKnown =
      (Number.isFinite(scheduled) && scheduled > 0) ||
      (lapsCountdown !== null && Number.isFinite(lapsCountdown));
    const type = mapSessionType(state.eventKind);
    // Timed sessions (sprints to a clock, practice, qualifying) have no
    // scheduled lap total: raceLaps below is only a structural fallback.
    const timed = type !== 'race' || !lapsKnown;
    const raceLaps =
      lapsCountdown !== null
        ? Math.max(1, leaderLaps + lapsCountdown)
        : Number.isFinite(scheduled) && scheduled > 0
          ? Math.floor(scheduled)
          : Math.max(1, leaderLaps);

    const sessionId = 'natsoft-' + this.fileSlug + '-' + (state.eventCode || 'cev').toLowerCase();
    const entries: Entry[] = [];
    const seen = new Set<string>();

    for (let rank = 0; rank < rows.length; rank++) {
      const row = rows[rank];
      const def = state.entries.get(row.carIdx);
      if (!def || !def.number) continue;
      const id = this.entryId(def.number);
      if (seen.has(id)) continue;
      seen.add(id);
      entries.push(this.buildEntry(state, row, def, id, rank + 1, leaderLaps, elapsedMs, trackCode));
    }
    if (!entries.length) return null;

    const at = elapsedMs;
    const leaderId = entries[0].id;
    if (this.lastLeaderId !== null && this.lastLeaderId !== leaderId && leaderLaps >= 1) {
      const car = entries[0];
      this.addEvent({
        id: 'live-lead-' + leaderLaps + '-' + car.id,
        at,
        entryIds: [car.id],
        category: 'position',
        message: 'Lead change — car ' + car.number + ' takes P1',
        origin: 'derived',
      });
    }
    this.lastLeaderId = leaderId;

    if (state.trackStatus && state.trackStatus !== this.lastStatus) {
      if (this.lastStatus !== '') {
        this.addEvent({
          id: 'live-status-' + state.trackStatus + '-' + Math.round(at / 1000),
          at,
          entryIds: [],
          category: 'status',
          message: 'Track status: ' + state.trackStatus,
          origin: 'supplied',
        });
      }
      this.lastStatus = state.trackStatus;
    }
    const messageText = state.message.race || state.message.comment;
    if (messageText && messageText !== this.lastMessage) {
      this.lastMessage = messageText;
      this.addEvent({
        id: 'live-msg-' + Math.round(at / 1000) + '-' + messageText.length,
        at,
        entryIds: [],
        category: 'status',
        message: 'Race control: ' + messageText.slice(0, 200),
        origin: 'supplied',
      });
    }
    let best: { ms: number; car: Entry } | null = null;
    for (const e of entries) {
      if (e.bestLap !== null && (best === null || e.bestLap < best.ms)) best = { ms: e.bestLap, car: e };
    }
    if (best && (this.lastBest === null || best.ms < this.lastBest)) {
      this.lastBest = best.ms;
      this.addEvent({
        id: 'live-fastest-' + best.ms,
        at,
        entryIds: [best.car.id],
        category: 'fastest',
        message: 'Fastest lap — car ' + best.car.number + ', ' + formatLap(best.ms),
        origin: 'supplied',
      });
    }
    if (phase === 'finished' && this.lastPhase !== '' && this.lastPhase !== 'finished') {
      this.addEvent({
        id: 'live-finished-' + sessionId,
        at,
        entryIds: [],
        category: 'status',
        message: 'Chequered flag — session finished',
        origin: 'supplied',
      });
    }
    this.lastPhase = phase;

    const running = phase === 'running';
    for (const e of entries) {
      const alert = this.detector.check(e.id, e.position ?? 99, at, {
        pitting: e.status === 'pit' || this.pitsChanged.has(e.id),
        leaderLaps,
        running,
      });
      if (alert) {
        this.addEvent({
          id: 'live-incident-' + e.id + '-' + Math.round(at / 1000),
          at,
          entryIds: [e.id],
          category: 'position',
          message:
            'Possible incident — car ' +
            e.number +
            ' fell P' +
            alert.from +
            ' to P' +
            alert.to +
            ' in ' +
            alert.seconds +
            's. Positions only; cause unknown.',
          origin: 'derived',
        });
      }
    }

    const season = parseSeason(state.meetingName, state.eventName);
    return {
      schemaVersion: 1,
      sessionId,
      streamId: this.streamId,
      sequence: ++this.sequence,
      sourceTimestamp: state.lastT > 0 ? Math.round(state.lastT * 1000) : Date.now(),
      receiptTimestamp: null,
      source: 'live',
      profile: 'position',
      session: {
        eventId: 'natsoft-' + this.fileSlug,
        id: sessionId,
        name: state.eventName || state.meetingName || 'Live timing',
        meeting: state.meetingName || null,
        series: parseSeries(state.eventName, state.categories[0]?.code ?? ''),
        season,
        trackId: trackCode === 'moun' ? 'mount-panorama' : 'natsoft-' + trackCode,
        type,
        raceLaps,
        timed,
        sectorLabels: feedSectorLabels(state),
        trackKm: trackCode === 'moun' ? 6.213 : null,
        phase,
        trackStatus,
        leaderLaps,
        elapsed: elapsedMs,
        remaining: remainingMs,
        timezone: 'Australia/Sydney',
        capabilities: { ...LIVE_CAPABILITIES },
      },
      entries,
      events: [...this.events],
    };
  }

  private buildEntry(
    state: LiveFeedState,
    row: BoardRow,
    def: EntryDef,
    id: string,
    position: number,
    leaderLaps: number,
    elapsedMs: number,
    trackCode: string,
  ): Entry {
    void trackCode;
    const d = row.data;
    const laps = Math.max(0, num(d['L']));
    const fullName = driverName(def, row.driverSlot);
    const base = id + '-d0';
    const mem = this.mem.get(id) ?? {
      laps,
      sectors: [null, null, null] as [number | null, number | null, number | null],
      prevSectors: [null, null, null] as [number | null, number | null, number | null],
      lastLapComputed: null,
      history: [],
      pits: num(d['PS']),
      fresh: true,
    };
    const sectors: [number | null, number | null, number | null] = [
      parseTimeSeconds(d['S1']),
      parseTimeSeconds(d['S2']),
      parseTimeSeconds(d['S3']),
    ];
    if (laps > mem.laps) {
      if (mem.sectors[0] !== null) {
        mem.prevSectors = [...mem.sectors];
        const parts = mem.sectors.filter((s): s is number => s !== null);
        mem.lastLapComputed = parts.length ? parts.reduce((a, b) => a + b, 0) : null;
        if (mem.lastLapComputed !== null) {
          mem.history.push({ lap: laps, time: mem.lastLapComputed, at: elapsedMs, valid: true });
          mem.history = mem.history.slice(-16);
        }
      }
      mem.laps = laps;
    }
    mem.sectors = sectors;
    if (mem.fresh) {
      mem.fresh = false;
      mem.prevSectors = [...sectors];
    }
    const pitCount = num(d['PS'], mem.pits);
    if (pitCount !== mem.pits) this.pitsChanged.add(id);
    mem.pits = pitCount;
    this.mem.set(id, mem);

    const pitFlag = (d['PF'] ?? '').trim();
    const speed = num(d['SP'], -1);
    const status: Entry['status'] =
      pitFlag !== ''
        ? 'pit'
        : laps === 0 && leaderLaps >= 1 && speed === 0
          ? 'unknown'
          : 'running';

    const ageMs = Math.max(0, Math.round((state.lastT - row.updatedT) * 1000));
    const observedAt = Math.max(0, elapsedMs - ageMs);
    const progress =
      status === 'pit' || status === 'unknown'
        ? null
        : segmentProgress((d['LP'] ?? '').trim(), Math.max(1, state.segments.length));
    const segAgeMs = Math.max(0, Math.round((state.lastT - row.segmentT) * 1000));
    const observation: Entry['observation'] =
      progress === null
        ? { kind: 'unavailable' }
        : {
            kind: 'position',
            progress,
            pitProgress: null,
            at: Math.max(0, elapsedMs - segAgeMs),
            provenance: 'reported',
          };

    const gap = position === 1 ? { kind: 'leader' as const } : parseGap(d['GL'], d['GI']);
    const interval =
      position === 1 ? { kind: 'leader' as const } : parseGap(d['GNL'], d['GNI']);
    this.emitPitStop(id, def.number, pitCount, elapsedMs);

    return {
      id,
      number: def.number,
      team: {
        id: 'live-team-' + def.index,
        name: def.vehicle || 'Independent',
        colour: TEAM_COLOURS[def.index % TEAM_COLOURS.length],
      },
      drivers: [
        { id: base, name: fullName },
        { id: base + '-solo', name: '—' },
      ],
      currentDriverId: base,
      position,
      grid: null,
      laps,
      status,
      gap,
      interval,
      lastLap: parseTimeSeconds(d['I']) ?? mem.lastLapComputed,
      bestLap: parseTimeSeconds(d['FI']),
      currentSector: null,
      previousSectors: [...mem.prevSectors],
      currentSectors: [...sectors],
      lastCrossing: null,
      lastLapCrossing: null,
      observation,
      pits: pitCount,
      observedAt,
      lapHistory: mem.history.map((h) => ({ ...h })),
      stints: [{ driverId: base, fromLap: 0, at: 0 }],
      pitObservation: null,
      penalty: null,
    };
  }

  private pitLogged = new Map<string, number>();
  private pitsChanged = new Set<string>();

  private emitPitStop(id: string, number: string, count: number, at: number): void {
    if (!this.pitLogged.has(id)) {
      // First sighting (possibly mid-race): adopt the count silently so we
      // do not announce stops that happened before we connected.
      this.pitLogged.set(id, count);
      return;
    }
    const logged = this.pitLogged.get(id) ?? 0;
    if (count > logged) {
      this.pitLogged.set(id, count);
      this.addEvent({
        id: 'live-pit-' + id + '-' + count,
        at,
        entryIds: [id],
        category: 'pit',
        message: 'Car ' + number + ' pit stop (' + count + ')',
        origin: 'supplied',
      });
    }
  }
}

function num(value: string | undefined, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function driverName(def: EntryDef, slot: number): string {
  const match = def.drivers.find((v) => v.slot === slot) ?? def.drivers[0];
  const name = (match?.name ?? '').trim();
  return name || 'Car ' + def.number;
}
