import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { decodePacket, encodePacket, resolveTimingUrl, upgradeToSecureSocket } from '../src/providers/live/decode';
import {
  applyPacket,
  childElements,
  emptyState,
  parseAttrs,
} from '../src/providers/live/state';
import {
  NatsoftAdapter,
  feedSectorLabels,
  formatLap,
  mapSessionType,
  mapTrackStatus,
  parseClockMs,
  parseGap,
  parseSeries,
  parseTimeSeconds,
  prettySegmentName,
  segmentProgress,
} from '../src/providers/live/adapter';
import { IncidentDetector } from '../src/providers/live/incidents';
import { snapshotSchema } from '../src/domain/schema';
import { currentLapTime, paceClass, pitDwellMs } from '../src/domain/format';
import { manufacturerOf } from '../src/components/ManufacturerBadge';
import { shouldBootLive } from '../src/state/runtime';
import { SessionController } from '../src/state/controller';
import { useRace } from '../src/state/store';

const fixture = (name: string) =>
  readFileSync(new URL('./fixtures/natsoft/' + name, import.meta.url), 'utf8');
const lines = (name: string) =>
  fixture(name)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

describe('natsoft transport decoding', () => {
  it('round-trips the rolling XOR obfuscation and passes plain XML through', () => {
    const xml = fixture('partial-1.xml').trim();
    expect(decodePacket(encodePacket(xml))).toBe(xml);
    expect(decodePacket(xml)).toBe(xml);
    expect(decodePacket('')).toBe('');
  });
  it('resolves page URLs to socket URLs and rejects unsafe input', () => {
    expect(
      resolveTimingUrl('http://server.natsoft.com.au:8080/LiveMeeting/20261011.MOUN').socketUrl,
    ).toBe('ws://server.natsoft.com.au:8080/LiveMeeting/20261011.MOUN');
    expect(
      resolveTimingUrl('https://example.com/LiveMeeting/x').socketUrl,
    ).toBe('wss://example.com/LiveMeeting/x');
    expect(
      resolveTimingUrl('http://a.com/LiveMeeting/x?ConnectTo=ws://b.com/y').socketUrl,
    ).toBe('ws://b.com/y');
    expect(resolveTimingUrl('ws://a.com/y').socketUrl).toBe('ws://a.com/y');
    expect(() => resolveTimingUrl('http://user:pass@a.com/y')).toThrow();
    expect(() => resolveTimingUrl('ftp://a.com/y')).toThrow();
    expect(() => resolveTimingUrl('not a url')).toThrow();
  });
  it('upgrades insecure sockets on secure pages (mixed-content rule)', () => {
    expect(upgradeToSecureSocket('ws://h:8080/x', 'https:')).toBe('wss://h:8080/x');
    expect(upgradeToSecureSocket('ws://h:8080/x', 'http:')).toBe('ws://h:8080/x');
    expect(upgradeToSecureSocket('wss://h:8080/x', 'https:')).toBe('wss://h:8080/x');
  });
});

describe('natsoft packet parsing and merge', () => {
  it('reads attributes and flat child elements', () => {
    expect(parseAttrs('<P L="1" LP="Main" C="17" />')).toEqual({ L: '1', LP: 'Main', C: '17' });
    const kids = childElements('<P L="1"><D LP="4" /></P>');
    expect(kids.map((k) => k.name)).toEqual(['P']);
    expect(kids[0].inner).toContain('<D');
  });
  it('imports a full New snapshot with entries and leaderboard', () => {
    const state = emptyState();
    const result = applyPacket(state, fixture('new.xml'));
    expect(result.change).toBe('reset');
    expect(state.meetingName).toBe('2026 Repco Bathurst 1000');
    expect(state.eventName).toContain('GR CUP');
    expect(state.eventKind).toBe('Race');
    expect(state.trackCode).toBe('MOUN');
    expect(state.segments).toEqual(['Pos1', 'Pos2', 'Int1', 'Pos3', 'Int2', 'Pos4', 'Pos5']);
    expect(state.entries.size).toBe(29);
    expect(state.entries.get(17)?.number).toBe('67');
    // The leaderboard arrives as a separate full L packet after New.
    expect(state.board.size).toBe(0);
    applyPacket(state, fixture('full-late.xml'));
    expect(state.board.size).toBe(29);
  });
  it('merges partial leaderboard deltas without losing untouched fields', () => {
    const state = emptyState();
    applyPacket(state, fixture('new.xml'));
    applyPacket(state, fixture('full-late.xml'));
    const before = state.board.get(17)!.data['LP'];
    applyPacket(state, lines('partial-0.xml')[0]);
    const row = state.board.get(17)!;
    expect(row.data['LP']).toBe('2');
    expect(row.data['L']).toBe('2');
    expect(before).toBe('1');
    // A car untouched by the partial keeps its segment.
    expect(state.board.get(29)!.data['LP']).toBe('1');
  });
  it('tracks clock, track status and rejects unavailable meetings', () => {
    const state = emptyState();
    applyPacket(state, fixture('new.xml'));
    expect(state.intermediateIds).toEqual([3, 5]);
    applyPacket(state, lines('countdown.xml')[0]);
    expect(state.clock?.elapsed).toBe('887');
    expect(state.clock?.value).toBe('133');
    const statuses = lines('status.xml');
    applyPacket(state, statuses[0]);
    expect(state.trackStatus).toBe('Yellow');
    applyPacket(state, statuses[1]);
    expect(state.trackStatus).toBe('Green');
    expect(() => applyPacket(state, '<NotFound />')).toThrow();
    expect(applyPacket(state, '<Redirect URL="ws://other/x" />').redirect).toBe('ws://other/x');
  });
});

describe('natsoft snapshot adapter', () => {
  function liveState() {
    const state = emptyState();
    applyPacket(state, fixture('new.xml'));
    applyPacket(state, lines('countdown.xml')[0]);
    const statuses = lines('status.xml');
    applyPacket(state, statuses[0]);
    applyPacket(state, statuses[1]);
    applyPacket(state, fixture('full-late.xml'));
    return state;
  }
  it('builds a valid live v1 snapshot with honest capabilities', () => {
    const snapshot = new NatsoftAdapter('test', 's1').build(liveState());
    expect(snapshot).not.toBeNull();
    const parsed = snapshotSchema.safeParse(snapshot);
    expect(parsed.success, JSON.stringify(parsed.error?.issues.slice(0, 3))).toBe(true);
    const s = snapshot!;
    expect(s.source).toBe('live');
    expect(s.profile).toBe('position');
    expect(s.entries).toHaveLength(29);
    expect(s.session.name).toContain('GR CUP');
    expect(s.session.meeting).toBe('2026 Repco Bathurst 1000');
    expect(s.session.series).toBe('2026 TOYOTA GAZOO Racing Australia GR CUP');
    expect(s.session.type).toBe('race');
    expect(s.session.trackStatus).toBe('green');
    expect(s.session.phase).toBe('running');
    expect(s.session.elapsed).toBe(887000);
    expect(s.session.remaining).toBe(133000);
    // Timed sprint (no scheduled laps): no lap total is claimed.
    expect(s.session.timed).toBe(true);
    expect(s.session.raceLaps).toBe(2);
    expect(s.session.capabilities.positionSamples).toBe(true);
    expect(s.session.capabilities.sectorCrossings).toBe(false);
    expect(s.session.capabilities.lapCrossings).toBe(false);
    const [first, second] = s.entries;
    expect(first.number).toBe('67');
    expect(first.gap).toEqual({ kind: 'leader' });
    expect(first.lastLap).toBe(329830);
    expect(first.bestLap).toBe(329830);
    expect(second.gap).toEqual({ kind: 'seconds', value: 858 });
    expect(second.observation.kind).toBe('position');
    if (second.observation.kind === 'position') {
      expect(second.observation.provenance).toBe('reported');
      expect(second.observation.progress).toBeCloseTo(0.5 / 7, 5);
    }
    // No crossing anchors are ever published for live data.
    expect(s.entries.every((e) => e.lastCrossing === null)).toBe(true);
    // Feed intermediates replace the demo sector anchors.
    expect(s.session.sectorLabels).toEqual([
      { name: 'INT 1', progress: 2.5 / 7 },
      { name: 'INT 2', progress: 4.5 / 7 },
    ]);
    expect(prettySegmentName('Int1')).toBe('INT 1');
    expect(feedSectorLabels(liveState())).toHaveLength(2);
    // A fresh build emits no incident alerts.
    expect(s.events.some((e) => e.message.startsWith('Possible incident'))).toBe(false);
  });
  it('marks circulating cars finished when the session ends', () => {
    const state = emptyState();
    applyPacket(state, fixture('new.xml'));
    applyPacket(state, lines('countdown.xml')[0]);
    applyPacket(state, fixture('full-late.xml'));
    const adapter = new NatsoftAdapter('test', 'fin');
    const running = adapter.build(state)!;
    expect(running.session.phase).toBe('running');
    expect(running.entries[0].status).toBe('running');
    applyPacket(state, '<S T="1791546059.3640" S="Ended" I="0" R="0" E="R3" P="1" SN="0" />');
    const done = adapter.build(state)!;
    expect(done.session.phase).toBe('finished');
    expect(done.entries[0].status).toBe('finished');
    // DNS cars stay unknown rather than being called finishers.
    expect(done.entries.find((e) => e.laps === 0)?.status).toBe('unknown');
  });
  it('records pit entry/exit observations from flag transitions', () => {
    const state = emptyState();
    applyPacket(state, fixture('new.xml'));
    applyPacket(state, lines('countdown.xml')[0]);
    applyPacket(state, fixture('full-late.xml'));
    const adapter = new NatsoftAdapter('test', 'pit');
    const before = adapter.build(state)!;
    expect(before.entries[0].status).toBe('running');
    expect(before.entries[0].pitObservation).toBeNull();
    const row = '<L T="1791545900.0000" Y="p" L="29"><P L="1" LL="1" P="1" LP="1" C="17" D="1" T="17"><D PF="P" PS="1" LP="1" /></P></L>';
    applyPacket(state, row);
    const pitting = adapter.build(state)!;
    expect(pitting.entries[0].status).toBe('pit');
    expect(pitting.entries[0].pitObservation?.kind).toBe('entry');
    expect(pitting.events.some((e) => e.category === 'pit')).toBe(true);
    const out = '<L T="1791545950.0000" Y="p" L="29"><P L="1" LL="1" P="1" LP="1" C="17" D="1" T="17"><D PF="" PS="1" LP="2" /></P></L>';
    applyPacket(state, out);
    const exited = adapter.build(state)!;
    expect(exited.entries[0].status).toBe('running');
    expect(exited.entries[0].pitObservation?.kind).toBe('exit');
  });
  it('maps session and personal best sectors from the feed', () => {    const state = emptyState();
    applyPacket(state, fixture('new.xml'));
    applyPacket(state, lines('countdown.xml')[0]);
    applyPacket(state, fixture('full-late.xml'));
    applyPacket(
      state,
      '<A T="1791546059.3640" Y="p" I2="217.8610" S2="91.4978" S1="126.0526" S3="78.2668" />',
    );
    const snapshot = new NatsoftAdapter('test', 'bests').build(state)!;
    expect(snapshot.session.bestSectors).toEqual([126053, 91498, 78267]);
    const leader = snapshot.entries[0];
    expect(leader.personalBestSectors).toEqual([126235, 40204, 78267]);
  });
  it('uses the feed’s scheduled lap total when one is given', () => {    const state = emptyState();
    applyPacket(state, fixture('new.xml'));
    applyPacket(state, lines('countdown.xml')[0]);
    applyPacket(state, fixture('full-late.xml'));
    applyPacket(
      state,
      '<E C="R3" D="2026 TOYOTA GAZOO Racing Australia GR CUP - Race 1" Y="Race" MP="N" MPD="0" L="161" TY="" ST="0" RY="Race" RI="0.0000" RD="0" RC="" RS="" RV="" />',
    );
    const snapshot = new NatsoftAdapter('test', 'sched').build(state)!;
    expect(snapshot.session.raceLaps).toBe(161);
    expect(snapshot.session.timed).toBe(false);
  });
  it('is accepted by the session controller as a live source', () => {
    useRace.setState({ snapshot: null, rejected: 0, accepted: 0, validationError: null });
    const controller = new SessionController();
    const snapshot = new NatsoftAdapter('test', 's9').build(liveState())!;
    expect(controller.accept(snapshot)).toBe(true);
    expect(useRace.getState().snapshot?.source).toBe('live');
    controller.stop();
  });
  it('maps helpers honestly', () => {
    expect(parseTimeSeconds('126.0526')).toBe(126053);
    expect(parseTimeSeconds('?')).toBeNull();
    expect(parseTimeSeconds('0.0000')).toBeNull();
    expect(parseGap('2', '0.0000')).toEqual({ kind: 'laps', value: 2 });
    expect(parseGap('0', '1.7575')).toEqual({ kind: 'seconds', value: 1758 });
    expect(parseGap('?', '?')).toEqual({ kind: 'unknown' });
    expect(segmentProgress('4', 7)).toBeCloseTo(3.5 / 7, 5);
    expect(segmentProgress('M', 7)).toBe(0.97);
    expect(segmentProgress('9', 7)).toBeNull();
    expect(mapSessionType('Race')).toBe('race');
    expect(mapSessionType('Qualifying')).toBe('qualifying');
    expect(mapSessionType('Practice 2')).toBe('practice');
    expect(mapTrackStatus('Yellow')).toBe('yellow');
    expect(mapTrackStatus('Checkered')).toBe('chequered');
    expect(parseSeries('2026 Series X - Race 1', '')).toBe('2026 Series X');
    expect(formatLap(126432)).toBe('2:06.432');
    expect(parseClockMs('238-')).toBe(-238000);
    expect(parseClockMs('133')).toBe(133000);
    expect(parseClockMs('?')).toBeNull();
  });
});

describe('incident detector', () => {
  it('sums in-progress sectors into the ticking current lap time', () => {
    expect(currentLapTime({ currentSectors: [126235, 91707, null] })).toBe(217942);
    expect(currentLapTime({ currentSectors: [null, null, null] })).toBeNull();
    expect(currentLapTime({ currentSectors: [90000, 0, null] })).toBe(90000);
  });
  it('grades record pace purple before personal pace green', () => {    const session = [126000, 40000, 78000];
    const personal = [127000, 41000, 79000];
    // Latest completed sector decides, like a broadcast screen.
    expect(paceClass([125000, null, null], session, personal)).toBe('race-best');
    expect(paceClass([125000, 40500, null], session, personal)).toBe('personal-best');
    expect(paceClass([125000, 41500, null], session, personal)).toBe('');
    expect(paceClass([126000, null, null], session, personal)).toBe('personal-best');
    expect(paceClass([null, null, null], session, personal)).toBe('');
    expect(paceClass([125000, null, null], [null, null, null], personal)).toBe('personal-best');
    expect(paceClass([125000, null, null], undefined, undefined)).toBe('');
  });
  it('measures pit dwell from the entry observation and parses makers', () => {
    expect(pitDwellMs({ status: 'pit', pitObservation: { kind: 'entry', at: 1000, provenance: 'supplied' } }, 46000)).toBe(45000);
    expect(pitDwellMs({ status: 'running', pitObservation: { kind: 'exit', at: 1000, provenance: 'supplied' } }, 46000)).toBeNull();
    expect(pitDwellMs({ status: 'running', pitObservation: null }, 46000)).toBeNull();
    expect(manufacturerOf('TOYOTA GR86')).toEqual({ brand: 'Toyota', short: 'TOYOTA', model: 'GR86' });
    expect(manufacturerOf('Summit Racing')).toBeNull();
  });
  it('boots live by default, demo only when asked or offline', () => {
    expect(shouldBootLive('', true)).toBe(true);
    expect(shouldBootLive('?live', true)).toBe(true);
    expect(shouldBootLive('?car=entry-1', true)).toBe(true);
    expect(shouldBootLive('?demo', true)).toBe(false);
    expect(shouldBootLive('?demo&car=entry-1', true)).toBe(false);
    expect(shouldBootLive('', false)).toBe(false);
  });
  const opts = { pitting: false, leaderLaps: 5, running: true };
  it('alerts only after a 5+ place fall is confirmed 20 s later', () => {
    const detector = new IncidentDetector();
    expect(detector.check('car', 8, 0, opts)).toBeNull();
    // First sighting arms but does not alert.
    expect(detector.check('car', 15, 45_000, opts)).toBeNull();
    // Still down after the confirmation window: alert.
    const alert = detector.check('car', 15, 65_000, opts);
    expect(alert).toMatchObject({ from: 8, to: 15, drop: 7 });
    // Cooldown suppresses repeats for the same episode.
    expect(detector.check('car', 16, 70_000, opts)).toBeNull();
  });
  it('drops the alert when the car pits or recovers first', () => {
    const pitting = new IncidentDetector();
    pitting.check('b', 3, 0, opts);
    expect(pitting.check('b', 12, 30_000, opts)).toBeNull();
    // Pit flag arrives during confirmation: no alert, ever.
    expect(pitting.check('b', 12, 55_000, { ...opts, pitting: true })).toBeNull();
    const recovered = new IncidentDetector();
    recovered.check('c', 3, 0, opts);
    expect(recovered.check('c', 12, 30_000, opts)).toBeNull();
    // Back within range before confirmation: no alert.
    expect(recovered.check('c', 6, 55_000, opts)).toBeNull();
  });
  it('ignores overtakes, starts and non-running sessions', () => {
    const detector = new IncidentDetector();
    detector.check('a', 8, 0, opts);
    expect(detector.check('a', 10, 30_000, opts)).toBeNull();
    const early = new IncidentDetector();
    early.check('d', 3, 0, { ...opts, leaderLaps: 1 });
    expect(early.check('d', 12, 30_000, { ...opts, leaderLaps: 1 })).toBeNull();
    const stopped = new IncidentDetector();
    stopped.check('e', 3, 0, opts);
    expect(stopped.check('e', 12, 30_000, { ...opts, running: false })).toBeNull();
  });
});
