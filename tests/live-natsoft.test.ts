import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { decodePacket, encodePacket, resolveTimingUrl } from '../src/providers/live/decode';
import {
  applyPacket,
  childElements,
  emptyState,
  parseAttrs,
} from '../src/providers/live/state';
import {
  NatsoftAdapter,
  formatLap,
  mapSessionType,
  mapTrackStatus,
  parseClockMs,
  parseGap,
  parseSeries,
  parseTimeSeconds,
  segmentProgress,
} from '../src/providers/live/adapter';
import { IncidentDetector } from '../src/providers/live/incidents';
import { snapshotSchema } from '../src/domain/schema';
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
    // A fresh build emits no incident alerts.
    expect(s.events.some((e) => e.message.startsWith('Possible incident'))).toBe(false);
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
  it('boots live by default, demo only when asked or offline', () => {
    expect(shouldBootLive('', true)).toBe(true);
    expect(shouldBootLive('?live', true)).toBe(true);
    expect(shouldBootLive('?car=entry-1', true)).toBe(true);
    expect(shouldBootLive('?demo', true)).toBe(false);
    expect(shouldBootLive('?demo&car=entry-1', true)).toBe(false);
    expect(shouldBootLive('', false)).toBe(false);
  });  const opts = { pitting: false, leaderLaps: 5, running: true };
  it('alerts on a 5+ place fall inside 90 seconds, once per episode', () => {
    const detector = new IncidentDetector();
    expect(detector.check('car', 8, 0, opts)).toBeNull();
    const alert = detector.check('car', 15, 45_000, opts);
    expect(alert).toMatchObject({ from: 8, to: 15, drop: 7 });
    expect(detector.check('car', 16, 50_000, opts)).toBeNull();
  });
  it('ignores overtakes, pit stops, starts and non-running sessions', () => {
    const detector = new IncidentDetector();
    detector.check('a', 8, 0, opts);
    expect(detector.check('a', 10, 30_000, opts)).toBeNull();
    const pitting = new IncidentDetector();
    pitting.check('b', 3, 0, opts);
    expect(pitting.check('b', 12, 30_000, { ...opts, pitting: true })).toBeNull();
    const early = new IncidentDetector();
    early.check('c', 3, 0, { ...opts, leaderLaps: 1 });
    expect(early.check('c', 12, 30_000, { ...opts, leaderLaps: 1 })).toBeNull();
    const stopped = new IncidentDetector();
    stopped.check('d', 3, 0, opts);
    expect(stopped.check('d', 12, 30_000, { ...opts, running: false })).toBeNull();
  });
});
