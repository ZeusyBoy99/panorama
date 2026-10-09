# Live timing provider (Natsoft)

Implemented `TimingProvider` for Natsoft Race Results live timing
(`src/providers/live/`), reached from a `LiveMeeting/<file>` page URL such as
`http://server.natsoft.com.au:8080/LiveMeeting/20261011.MOUN`.

- `decode.ts` — rolling-XOR packet decode plus page URL to WebSocket URL
  resolution (`http->ws`, `https->wss`, `?ConnectTo=` override). Credential
  URLs and non-web schemes are rejected; the resolver cannot be used as an
  open proxy.
- `state.ts` — dependency-free XML reader that merges `<New>` full snapshots
  with `<L>` full/partial leaderboard deltas, countdown/clock (`<C>`), track
  status (`<S>`), messages (`<G>`), bests (`<A>`) and session status (`<F>`).
  Partial packets carry only changed attributes; untouched cars keep their
  last observations with honest ageing. `<NotFound>` surfaces as an error and
  `<Redirect>` destinations are revalidated (max 3 hops).
- `adapter.ts` — merged state to authoritative schemaVersion 1 snapshots
  (`source: 'live'`, `profile: 'position'` with `positionSamples: true` and
  both crossing capabilities false, so the map never invents estimates).
- `incidents.ts` — possible-incident detection (5+ places in 90 s, pit stops
  and race starts excluded).
- `provider.ts` — browser WebSocket connection with bounded exponential
  backoff (1–30 s), ~1 Hz heartbeat handling, 500 ms publish coalescing and a
  new stream identity per upstream epoch/reconnect.

See `docs/live-integration.md` for the inspected protocol, field mapping and
operating limits.
