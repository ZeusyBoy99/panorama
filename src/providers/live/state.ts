/**
 * Natsoft live-timing message parsing and merged-state tracking.
 *
 * The feed sends one XML element per packet: <New>/<Change> full snapshots
 * followed by deltas (<C> countdown/clock, <S> track status, <G> messages,
 * <A> session best, <F> fastest, <L> leaderboard full or partial, plus
 * structural M/T/E/OL/RL updates). Partial <L Y="p"> packets carry only the
 * changed attributes for the affected cars, so the adapter keeps the last full
 * picture and merges deltas into it. Parsing is a small purpose-built reader
 * (no DOM dependency) that preserves unknown attributes for forward
 * compatibility.
 */

export type Attrs = Record<string, string>;

const ATTR_RE = /([A-Za-z0-9_]+)="([^"]*)"/g;

export function parseAttrs(tag: string): Attrs {
  const out: Attrs = {};
  ATTR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR_RE.exec(tag)) !== null) out[m[1]] = m[2];
  return out;
}

/** Split an element's inner XML into top-level child elements (flat only). */
export function childElements(xml: string): { name: string; attrs: Attrs; inner: string }[] {
  const out: { name: string; attrs: Attrs; inner: string }[] = [];
  // Manual scan so nested same-name elements cannot confuse the match.
  let i = 0;
  while (i < xml.length) {
    const open = xml.indexOf('<', i);
    if (open === -1) break;
    if (xml[open + 1] === '/') {
      i = open + 2;
      continue;
    }
    const end = xml.indexOf('>', open);
    if (end === -1) break;
    const tag = xml.slice(open, end + 1);
    const nameMatch = /^<([A-Za-z]+)/.exec(tag);
    if (!nameMatch) {
      i = end + 1;
      continue;
    }
    const name = nameMatch[1];
    const attrs = parseAttrs(tag);
    if (tag.endsWith('/>')) {
      out.push({ name, attrs, inner: '' });
      i = end + 1;
    } else {
      const close = xml.indexOf('</' + name + '>', end);
      if (close === -1) break;
      out.push({ name, attrs, inner: xml.slice(end + 1, close) });
      i = close + name.length + 3;
    }
  }
  return out;
}

export interface EntryDef {
  index: number;
  number: string;
  vehicle: string;
  subClass: string;
  drivers: { slot: number; name: string }[];
}

export interface BoardRow {
  /** Classified position (1-based). */
  pos: number;
  /** Entry index into the RL entry list (P@C). */
  carIdx: number;
  /** Driver slot (P@D -> V@ID). */
  driverSlot: number;
  /** Merged D attributes; only keys ever sent are present. */
  data: Attrs;
  /** Server timestamp (seconds) of the last packet touching this row. */
  updatedT: number;
  /** Server timestamp (seconds) of the last track-segment (LP) change. */
  segmentT: number;
}

export interface LiveFeedState {
  meetingName: string;
  meetingKind: string;
  trackCode: string;
  trackName: string;
  segments: string[];
  pitSegmentIds: [number, number];
  eventCode: string;
  eventName: string;
  eventKind: string;
  eventLaps: string;
  categories: { code: string; name: string; kind: string }[];
  entries: Map<number, EntryDef>;
  board: Map<number, BoardRow>;
  /** Countdown node: Y kind, C value, E elapsed, T server time. */
  clock: { kind: string; value: string; elapsed: string; at: number } | null;
  trackStatus: string;
  statusRef: Attrs;
  message: { comment: string; race: string };
  sessionBest: Attrs | null;
  fastest: Attrs | null;
  waiting: boolean;
  lastT: number;
}

export function emptyState(): LiveFeedState {
  return {
    meetingName: '',
    meetingKind: '',
    trackCode: '',
    trackName: '',
    segments: [],
    pitSegmentIds: [0, 0],
    eventCode: '',
    eventName: '',
    eventKind: '',
    eventLaps: '',
    categories: [],
    entries: new Map(),
    board: new Map(),
    clock: null,
    trackStatus: '',
    statusRef: {},
    message: { comment: '', race: '' },
    sessionBest: null,
    fastest: null,
    waiting: false,
    lastT: 0,
  };
}

function num(value: string | undefined, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function importEntryList(state: LiveFeedState, inner: string): void {
  state.entries.clear();
  for (const child of childElements(inner)) {
    if (child.name !== 'R') continue;
    const index = num(child.attrs['ID']);
    const drivers = childElements(child.inner)
      .filter((v) => v.name === 'V')
      .map((v) => ({
        slot: num(v.attrs['ID'], 1),
        name: (v.attrs['N'] ?? '').replace(/_/g, ' '),
      }));
    state.entries.set(index, {
      index,
      number: child.attrs['N'] ?? String(index),
      vehicle: (child.attrs['V'] ?? '').replace(/_/g, ' '),
      subClass: child.attrs['S'] ?? '',
      drivers,
    });
  }
}

function importBoardRow(state: LiveFeedState, p: Attrs, d: Attrs, serverT: number): void {
  const carIdx = num(p['C']);
  if (!carIdx) return;
  const existing = state.board.get(carIdx);
  const merged = { ...(existing?.data ?? {}), ...d };
  const row: BoardRow = {
    pos: num(p['L'], existing?.pos ?? 0),
    carIdx,
    driverSlot: num(p['D'], existing?.driverSlot ?? 1),
    data: merged,
    updatedT: serverT,
    segmentT:
      d['LP'] !== undefined && d['LP'] !== existing?.data['LP']
        ? serverT
        : (existing?.segmentT ?? serverT),
  };
  state.board.set(carIdx, row);
}

function importLeaderboard(
  state: LiveFeedState,
  attrs: Attrs,
  inner: string,
  serverT: number,
): void {
  if (attrs['Y'] === 'f') state.board.clear();
  for (const child of childElements(inner)) {
    if (child.name !== 'P') continue;
    const dNode = childElements(child.inner).find((c) => c.name === 'D');
    importBoardRow(state, child.attrs, dNode?.attrs ?? {}, serverT);
  }
}

/**
 * Apply one decoded XML packet to the merged state. Returns a hint about what
 * changed: 'reset' (full snapshot arrived), 'board', 'clock', 'status',
 * 'meta' or 'none'. Throws on <NotFound>; returns {redirect} for <Redirect>.
 */
export function applyPacket(
  state: LiveFeedState,
  xml: string,
): { change: 'reset' | 'board' | 'clock' | 'status' | 'meta' | 'none'; redirect?: string } {
  const trimmed = xml.trim();
  if (trimmed.startsWith('<NotFound'))
    throw new Error('Live timing is not available for this meeting.');
  if (trimmed.startsWith('<Redirect')) {
    const url = parseAttrs(trimmed)['URL'] ?? '';
    return { change: 'none', redirect: url };
  }
  const rootMatch = /^<([A-Za-z]+)((?:\s+[A-Za-z0-9_]+="[^"]*")*)\s*(\/>|>)/.exec(trimmed);
  if (!rootMatch) return { change: 'none' };
  const name = rootMatch[1];
  const attrs = parseAttrs(rootMatch[0]);
  const serverT = num(attrs['T'], state.lastT);
  if (serverT > state.lastT) state.lastT = serverT;
  const inner = rootMatch[3] === '/>'
    ? ''
    : (() => {
        const close = trimmed.lastIndexOf('</' + name + '>');
        return close === -1 ? '' : trimmed.slice(rootMatch[0].length, close);
      })();

  switch (name) {
    case 'New':
    case 'Change':
    case 'WaitCat': {
      const fresh = emptyState();
      fresh.lastT = state.lastT;
      // A Change packet carries deltas against the current board; a New (or
      // WaitCat) packet starts a new full picture.
      if (name === 'Change') fresh.board = state.board;
      Object.assign(state, fresh);
      state.waiting = name === 'WaitCat';
      for (const child of childElements(inner)) {
        routeElement(state, child, serverT);
      }
      return { change: 'reset' };
    }
    case 'L':
      importLeaderboard(state, attrs, inner, serverT);
      return { change: 'board' };
    case 'C':
      state.clock = {
        kind: attrs['Y'] ?? '',
        value: attrs['C'] ?? '',
        elapsed: attrs['E'] ?? '',
        at: serverT,
      };
      return { change: 'clock' };
    case 'S':
      state.trackStatus = attrs['S'] ?? state.trackStatus;
      state.statusRef = { ...attrs };
      return { change: 'status' };
    case 'G':
      state.message = { comment: attrs['C'] ?? '', race: attrs['R'] ?? '' };
      return { change: 'status' };
    case 'A':
      state.sessionBest = { ...attrs };
      return { change: 'meta' };
    case 'F':
      state.fastest = { ...attrs };
      return { change: 'meta' };
    default:
      if (routeElement(state, { name, attrs, inner }, serverT)) return { change: 'meta' };
      return { change: 'none' };
  }
}

function routeElement(
  state: LiveFeedState,
  child: { name: string; attrs: Attrs; inner: string },
  serverT: number,
): boolean {
  switch (child.name) {
    case 'M':
      state.meetingName = child.attrs['D'] ?? state.meetingName;
      state.meetingKind = child.attrs['Y'] ?? state.meetingKind;
      return true;
    case 'T':
      state.trackCode = child.attrs['C'] ?? state.trackCode;
      state.trackName = child.attrs['N'] ?? state.trackName;
      state.pitSegmentIds = [num(child.attrs['PI1']), num(child.attrs['PI2'])];
      state.segments = childElements(child.inner)
        .filter((t) => t.name === 'TP')
        .sort((a, b) => num(a.attrs['ID']) - num(b.attrs['ID']))
        .map((t) => t.attrs['Y'] ?? '');
      return true;
    case 'E':
      state.eventCode = child.attrs['C'] ?? state.eventCode;
      state.eventName = child.attrs['D'] ?? state.eventName;
      state.eventKind = child.attrs['Y'] ?? state.eventKind;
      state.eventLaps = child.attrs['L'] ?? state.eventLaps;
      return true;
    case 'OL':
      state.categories = childElements(child.inner)
        .filter((o) => o.name === 'O')
        .map((o) => ({ code: o.attrs['C'] ?? '', name: o.attrs['D'] ?? '', kind: o.attrs['Y'] ?? '' }));
      return true;
    case 'RL':
      importEntryList(state, child.inner);
      return true;
    case 'L':
      importLeaderboard(state, child.attrs, child.inner, serverT);
      return true;
    case 'C':
      state.clock = {
        kind: child.attrs['Y'] ?? '',
        value: child.attrs['C'] ?? '',
        elapsed: child.attrs['E'] ?? '',
        at: serverT,
      };
      return true;
    case 'S':
      state.trackStatus = child.attrs['S'] ?? state.trackStatus;
      state.statusRef = { ...child.attrs };
      return true;
    case 'G':
      state.message = { comment: child.attrs['C'] ?? '', race: child.attrs['R'] ?? '' };
      return true;
    case 'A':
      state.sessionBest = { ...child.attrs };
      return true;
    case 'F':
      state.fastest = { ...child.attrs };
      return true;
    default:
      return false;
  }
}
