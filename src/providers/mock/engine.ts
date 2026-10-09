import {
  capabilities,
  type Crossing,
  type Entry,
  type Gap,
  type Profile,
  type RaceEvent,
  type Snapshot,
} from '../../domain/schema';
import { lapProgress, timeAnchors, timeFraction } from '../../domain/speed';
import {
  pitEntryAnchor,
  pitExitAnchor,
  pitServiceProgress,
  pitFinishProgress,
} from '../../assets/track';
import { roster } from './roster';
export const scenarios = [
  'Normal racing',
  'Pit cycle',
  'Safety car and restart',
  'Red flag',
  'Lap deficit',
  'Retirement',
  'Missing capabilities',
  'One car goes silent',
  'Feed outage',
  'Duplicate / out-of-order',
  'New stream / session',
  'Schema errors',
  'Race finish',
] as const;
export type Scenario = (typeof scenarios)[number];
const EVENT_EPOCH = Date.parse('2026-10-11T00:00:00Z');
const STEP = 50;
interface Car {
  index: number;
  laps: number;
  age: number;
  plan: number;
  lapStart: number;
  sectorStart: number;
  crossings: Crossing[];
  previous: Entry['previousSectors'];
  current: Entry['currentSectors'];
  lastLap: number | null;
  best: number | null;
  /** Fastest completed sector durations for this car. */
  sectorBest: [number | null, number | null, number | null];
  history: Entry['lapHistory'];
  status: Entry['status'];
  driver: number;
  stints: Entry['stints'];
  pits: number;
  pitAge: number | null;
  pitRequest: boolean;
  pitCrossed: boolean;
  pitObservation: Entry['pitObservation'];
  frozen: number | null;
  penalty: Entry['penalty'];
  finishAt: number | null;
}
interface EngineState {
  time: number;
  cars: Car[];
  events: RaceEvent[];
  eventCounter: number;
  winner: boolean;
  track: Snapshot['session']['trackStatus'];
  phase: Snapshot['session']['phase'];
  /** Fastest completed sector durations seen anywhere in the field. */
  bestSectors: [number | null, number | null, number | null];
}
const checkpoints = new Map<string, EngineState>();
function jitter(seed: number, index: number, lap: number) {
  let x = (seed ^ Math.imul(index + 1, 2654435761) ^ Math.imul(lap + 1, 1597334677)) >>> 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return ((x >>> 0) / 4294967296 - 0.5) * 1200;
}
export class RaceEngine {
  private state: EngineState;
  private remainder = 0;
  readonly checkpoint: number;
  private warming = true;
  private lastOrder: string[] = [];
  private silent: Entry | null = null;
  constructor(
    readonly seed = 10002026,
    readonly scenario: Scenario = 'Normal racing',
  ) {
    const target = scenario === 'Race finish' ? 160 : 42;
    const key = seed + ':' + target;
    this.state = {
      time: 0,
      cars: roster.map((_, i) => ({
        index: i,
        laps: 0,
        age: 0,
        plan: this.plan(i, 0),
        lapStart: i * 650,
        sectorStart: i * 650,
        crossings: [],
        previous: [null, null, null],
        current: [null, null, null],
        lastLap: null,
        best: null,
        sectorBest: [null, null, null],
        history: [],
        status: 'running',
        driver: 0,
        stints: [{ driverId: 'driver-' + i + '-0', fromLap: 0, at: 0 }],
        pits: 0,
        pitAge: null,
        pitRequest: false,
        pitCrossed: false,
        pitObservation: null,
        frozen: null,
        penalty: null,
        finishAt: null,
      })),
      events: [],
      eventCounter: 0,
      winner: false,
      track: 'green',
      phase: 'running',
      bestSectors: [null, null, null],
    };
    const cached = checkpoints.get(key);
    if (cached) this.state = structuredClone(cached);
    else {
      while (this.state.cars[0].laps < target) this.tick();
      for (let n = 0; n < (target === 160 ? 115000 : 12000) / STEP; n++) this.tick();
      checkpoints.set(key, structuredClone(this.state));
    }
    this.checkpoint = this.state.time;
    this.warming = false;
    this.lastOrder = this.ordered().map((c) => 'entry-' + c.index);
    this.event('status', [], 'Demo checkpoint loaded · fictional entries and timing', 'supplied');
  }
  private plan(index: number, lap: number) {
    return 126000 + 180 * index + jitter(this.seed, index, lap);
  }
  get time() {
    return this.state.time;
  }
  get relativeTime() {
    return this.time - this.checkpoint;
  }
  advance(delta: number) {
    if (!Number.isFinite(delta) || delta < 0) throw new Error('Invalid elapsed time');
    this.remainder += delta;
    while (this.remainder >= STEP) {
      this.tick();
      this.remainder -= STEP;
    }
  }
  private event(
    category: RaceEvent['category'],
    entryIds: string[],
    message: string,
    origin: RaceEvent['origin'] = 'supplied',
  ) {
    this.state.events.push({
      id: 'event-' + this.seed + '-' + ++this.state.eventCounter,
      at: this.time,
      entryIds,
      category,
      message,
      origin,
    });
    this.state.events = this.state.events.slice(-100);
  }
  private progress(c: Car) {
    if (c.frozen !== null) return c.frozen;
    if (c.pitAge !== null) {
      const p = this.pitProgress(c.pitAge),
        cross = pitFinishProgress;
      return c.pitCrossed
        ? (pitExitAnchor.mainProgress * (p - cross)) / (1 - cross)
        : pitEntryAnchor.mainProgress + ((1 - pitEntryAnchor.mainProgress) * p) / cross;
    }
    return lapProgress(c.age / c.plan);
  }
  private scoring(c: Car) {
    return c.laps + this.progress(c);
  }
  private ordered() {
    return [...this.state.cars].sort((a, b) => {
      if (a.status === 'retired' && b.status !== 'retired') return 1;
      if (b.status === 'retired' && a.status !== 'retired') return -1;
      if (a.status === 'finished' && b.status === 'finished')
        return (
          b.laps - a.laps ||
          (a.finishAt ?? Infinity) - (b.finishAt ?? Infinity) ||
          a.index - b.index
        );
      return this.scoring(b) - this.scoring(a) || a.index - b.index;
    });
  }
  private pitCrossingTime() {
    return 37000 + (12000 * (pitFinishProgress - pitServiceProgress)) / (1 - pitServiceProgress);
  }
  private pitProgress(age: number) {
    if (age < 12000) return (age / 12000) * pitServiceProgress;
    if (age < 37000) return pitServiceProgress;
    return pitServiceProgress + ((age - 37000) / 12000) * (1 - pitServiceProgress);
  }
  private crossing(c: Car, sector: number, at: number) {
    const lap = sector === 2;
    const duration = at - c.sectorStart;
    c.current[sector] = duration;
    c.sectorStart = at;
    const cross: Crossing = {
      kind: lap ? 'lap' : 'sector',
      sector: lap ? 0 : sector + 1,
      lap: c.laps + 1,
      at,
      progress: lap ? 0 : lapProgress(timeAnchors[sector + 1]),
      duration,
    };
    c.crossings.push(cross);
    c.crossings = c.crossings.slice(-96);
    if (lap) {
      const last = at - c.lapStart;
      c.laps++;
      c.lastLap = last;
      c.best = c.best === null ? last : Math.min(c.best, last);
      c.history.push({ lap: c.laps, time: last, at, valid: true });
      c.history = c.history.slice(-16);
      for (let s = 0; s < 3; s++) {
        const sector = c.current[s];
        if (sector !== null && (this.state.bestSectors[s] === null || sector < this.state.bestSectors[s]!))
          this.state.bestSectors[s] = sector;
        if (sector !== null && (c.sectorBest[s] === null || sector < c.sectorBest[s]!))
          c.sectorBest[s] = sector;
      }
      c.previous = [...c.current];
      c.current = [null, null, null];
      c.lapStart = at;
      c.sectorStart = at;
      c.plan = this.plan(c.index, c.laps);
      if (!this.warming) {
        const otherBest = Math.min(
          ...this.state.cars.filter((x) => x.index !== c.index).map((x) => x.best ?? Infinity),
        );
        if (last < otherBest)
          this.event(
            'fastest',
            ['entry-' + c.index],
            '#' + roster[c.index][0] + ' sets the demo race-best lap',
          );
      }
      if (c.laps >= 161 && !this.state.winner) {
        this.state.winner = true;
        this.state.track = 'chequered';
        this.event(
          'finish',
          ['entry-' + c.index],
          'Chequered flag · #' + roster[c.index][0] + ' completes 161 laps',
        );
      }
      if (this.state.winner) {
        c.status = 'finished';
        c.frozen = 0;
        c.finishAt = at;
        this.event(
          'finish',
          ['entry-' + c.index],
          '#' + roster[c.index][0] + ' finishes the demonstration race',
        );
      }
    }
  }
  private tick() {
    const before = this.time;
    this.state.time += STEP;
    const rel = this.warming ? -1 : this.relativeTime;
    let track: Snapshot['session']['trackStatus'] = this.state.winner ? 'chequered' : 'green';
    if (this.scenario === 'Safety car and restart' && rel >= 5000 && rel < 65000)
      track = 'safety-car';
    if (this.scenario === 'Red flag' && rel >= 5000 && rel < 30000) track = 'red';
    if (track !== this.state.track) {
      this.state.track = track;
      this.state.phase = track === 'red' ? 'suspended' : 'running';
      this.event(
        'status',
        [],
        track === 'green'
          ? 'Green flag · racing resumes'
          : track === 'red'
            ? 'Red flag · demonstration race suspended'
            : 'Safety car · field gathering',
      );
    }
    for (const c of this.state.cars) {
      if (
        before < c.index * 650 ||
        c.status === 'finished' ||
        c.status === 'retired' ||
        c.status === 'stopped' ||
        track === 'red'
      )
        continue;
      if (!this.warming && this.scenario === 'Retirement' && rel >= 12000 && c.index === 7) {
        c.frozen = this.progress(c);
        c.status = 'retired';
        this.event('retirement', ['entry-7'], '#32 retires · position known in simulated feed');
        continue;
      }
      if (
        !this.warming &&
        this.scenario === 'Pit cycle' &&
        rel >= 3000 &&
        [0, 2, 6].includes(c.index) &&
        c.pits === 0
      )
        c.pitRequest = true;
      if (c.pitAge !== null) {
        const old = c.pitAge;
        c.pitAge += STEP;
        if (!c.pitCrossed && c.pitAge >= this.pitCrossingTime()) {
          c.pitCrossed = true;
          this.crossing(c, 2, before + (this.pitCrossingTime() - old));
          c.age = 0;
        }
        if (old < 12000 && c.pitAge >= 12000) {
          c.pitObservation = { kind: 'service', at: this.time, provenance: 'simulated' };
          if (c.index === 0) {
            c.driver = 1;
            c.stints.push({ driverId: 'driver-' + c.index + '-1', fromLap: c.laps, at: this.time });
            this.event('driver', ['entry-0'], '#07 · Blake Mercer takes over');
          }
        }
        if (c.pitAge >= 49000) {
          c.pitAge = null;
          c.age = c.plan * timeFraction(pitExitAnchor.mainProgress);
          c.status = 'running';
          c.pitObservation = { kind: 'exit', at: this.time, provenance: 'simulated' };
          this.event('pit', ['entry-' + c.index], '#' + roster[c.index][0] + ' exits pit lane');
        }
        continue;
      }
      let rate = 1;
      if (!this.warming && c.index < 2 && this.scenario === 'Normal racing')
        rate = (Math.floor(rel / 80000) % 2 === 0) === (c.index === 0) ? 0.92 : 1.08;
      if (track === 'safety-car') {
        const leader = this.ordered()[0];
        const distance = this.scoring(leader) - this.scoring(c);
        rate = c === leader ? 0.42 : distance > 0.012 * (c.index + 1) ? 0.68 : 0.42;
      }
      const oldAge = c.age,
        oldPlan = c.plan;
      let newAge = oldAge + STEP * rate;
      if (
        c.pitRequest &&
        lapProgress(oldAge / oldPlan) < pitEntryAnchor.mainProgress &&
        lapProgress(newAge / oldPlan) >= pitEntryAnchor.mainProgress
      ) {
        c.pitRequest = false;
        c.pitAge = 0;
        c.pitCrossed = false;
        c.status = 'pit';
        c.pits++;
        c.pitObservation = { kind: 'entry', at: this.time, provenance: 'simulated' };
        this.event('pit', ['entry-' + c.index], '#' + roster[c.index][0] + ' enters pit lane');
        continue;
      }
      for (let s = 0; s < 3; s++) {
        const boundary = oldPlan * timeAnchors[s + 1];
        if (oldAge < boundary && newAge >= boundary) {
          this.crossing(c, s, before + (boundary - oldAge) / rate);
          if (s === 2) newAge -= oldPlan;
        }
      }
      c.age = newAge;
    }
    if (!this.warming) {
      const order = this.ordered().map((c) => 'entry-' + c.index);
      if (order[0] !== this.lastOrder[0])
        this.event(
          'lead',
          [order[0]],
          '#' + roster[Number(order[0].split('-')[1])][0] + ' leads the classification',
          'derived',
        );
      for (let i = 0; i < Math.min(4, order.length); i++)
        if (order[i] !== this.lastOrder[i] && this.lastOrder.includes(order[i])) {
          this.event(
            'position',
            [order[i]],
            '#' + roster[Number(order[i].split('-')[1])][0] + ' classified P' + (i + 1),
            'derived',
          );
          break;
        }
      this.lastOrder = order;
      if (this.scenario === 'Pit cycle' && rel >= 70000 && !this.state.cars[2].penalty) {
        this.state.cars[2].penalty = {
          message: 'Synthetic 5-second penalty',
          at: this.time,
          provenance: 'supplied',
        };
        this.event('penalty', ['entry-2'], '#12 receives a synthetic 5-second penalty');
      }
    }
    if (
      this.state.winner &&
      this.state.cars.every((c) => c.status === 'finished' || c.status === 'retired')
    )
      this.state.phase = 'finished';
  }
  private gap(lead: Car, car: Car): Gap {
    if (lead.index === car.index) return { kind: 'leader' };
    const deficit = Math.floor(this.scoring(lead) - this.scoring(car));
    if (deficit >= 1) return { kind: 'laps', value: deficit };
    for (let i = car.crossings.length - 1; i >= 0; i--) {
      const b = car.crossings[i];
      const a = lead.crossings.find(
        (c) => c.lap === b.lap && c.kind === b.kind && c.sector === b.sector,
      );
      if (a) return b.at >= a.at ? { kind: 'seconds', value: b.at - a.at } : { kind: 'unknown' };
    }
    return { kind: 'unknown' };
  }
  snapshot(profile: Profile = 'position', streamId = 'demo-stream', sequence = 0): Snapshot {
    const ordered = this.ordered(),
      caps = capabilities(profile);
    const entries = ordered.map((c, pos): Entry => {
      const r = roster[c.index],
        last = c.crossings.at(-1) ?? null,
        lap = [...c.crossings].reverse().find((x) => x.kind === 'lap') ?? null;
      const observation: Entry['observation'] =
        profile === 'position'
          ? {
              kind: 'position',
              progress: Math.max(0, Math.min(1, this.progress(c))),
              pitProgress:
                c.pitAge === null ? null : Math.max(0, Math.min(1, this.pitProgress(c.pitAge))),
              at: this.time,
              provenance: 'simulated',
            }
          : profile === 'sector' && last
            ? { kind: 'crossing', anchor: last }
            : profile === 'lap' && lap
              ? { kind: 'crossing', anchor: lap }
              : { kind: 'unavailable' };
      return {
        id: 'entry-' + c.index,
        number: r[0],
        team: { id: 'team-' + Math.floor(c.index / 2), name: r[1], colour: r[4] },
        drivers: [
          { id: 'driver-' + c.index + '-0', name: r[2] },
          { id: 'driver-' + c.index + '-1', name: r[3] },
        ],
        currentDriverId: 'driver-' + c.index + '-' + c.driver,
        position: pos + 1,
        grid: c.index + 1,
        laps: c.laps,
        status: c.status,
        gap: this.gap(ordered[0], c),
        interval: pos === 0 ? { kind: 'leader' } : this.gap(ordered[pos - 1], c),
        lastLap: caps.lapTiming ? c.lastLap : null,
        bestLap: caps.lapTiming ? c.best : null,
        currentSector: caps.sectorCrossings
          ? c.age / c.plan < 0.29
            ? 0
            : c.age / c.plan < 0.65
              ? 1
              : 2
          : null,
        previousSectors: caps.sectorCrossings ? [...c.previous] : [null, null, null],
        currentSectors: caps.sectorCrossings ? [...c.current] : [null, null, null],
        personalBestSectors: caps.sectorCrossings
          ? ([...c.sectorBest] as [number | null, number | null, number | null])
          : [null, null, null],
        lastCrossing: caps.sectorCrossings ? last : caps.lapCrossings ? lap : null,
        lastLapCrossing: caps.lapCrossings ? lap : null,
        observation,
        pits: c.pits,
        observedAt: this.time,
        lapHistory: caps.lapTiming ? c.history.map((h) => ({ ...h })) : [],
        stints: c.stints.map((s) => ({ ...s })),
        pitObservation: c.pitObservation,
        penalty: c.penalty,
      };
    });
    if (this.scenario === 'One car goes silent' && this.relativeTime >= 5000) {
      const i = entries.findIndex((e) => e.id === 'entry-4');
      if (!this.silent) this.silent = structuredClone(entries[i]);
      else
        entries[i] = {
          ...structuredClone(this.silent),
          position: entries[i].position,
          gap: entries[i].gap,
          interval: entries[i].interval,
        };
    }
    return {
      schemaVersion: 1,
      sessionId: 'bathurst-demo-2026',
      streamId,
      sequence,
      sourceTimestamp: EVENT_EPOCH + this.time,
      receiptTimestamp: null,
      source: 'demo',
      profile,
      session: {
        eventId: 'bathurst-2026-demo',
        id: 'bathurst-demo-2026',
        name: 'Bathurst 1000',
        season: 2026,
        trackId: 'mount-panorama',
        type: 'race',
        raceLaps: 161,
        trackKm: 6.213,
        phase: this.state.phase,
        trackStatus: this.state.track,
        leaderLaps: Math.max(...entries.map((e) => e.laps)),
        elapsed: this.time,
        remaining: null,
        timezone: 'Australia/Sydney',
        capabilities: caps,
        bestSectors: caps.sectorCrossings
          ? [...this.state.bestSectors] as [number | null, number | null, number | null]
          : [null, null, null],
      },
      entries,
      events: this.state.events.map((e) => ({ ...e, entryIds: [...e.entryIds] })),
    };
  }
}
