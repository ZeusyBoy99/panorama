# Live integration: Natsoft Race Results (implemented)

Stage 1 ended with an empty seam. The owner then supplied a public Natsoft
URL (`http://server.natsoft.com.au:8080/LiveMeeting/20261011.MOUN`, no
login), and this document records what the source was found to offer and how
it is connected. Paste a `LiveMeeting/<file>` page URL into Settings → Live
timing to connect; the app opens the feed's WebSocket directly.

## Inspected source (11 October 2026, 2026 Repco Bathurst 1000)

1. **Transport:** the page loads `Client_Obfs.js`/`Live_Obfs.js` and opens a
   WebSocket to the *same* URL with `ws(s):` substituted for `http(s):`
   (`wss://` works on the 8080 port, so HTTPS deployments need no proxy).
   Packets are single XML elements obfuscated with a rolling XOR from `0x7f`
   plus shorthand tokens for common fragments. No authentication, no CORS
   issue (WebSocket), ~1 Hz `<C>` countdown/clock heartbeat plus per-car
   `<L Y="p">` partials. Captured fixtures live in
   `tests/fixtures/natsoft/`.
2. **Session identity:** `<M D="2026 Repco Bathurst 1000">` meeting,
   `<T C="MOUN" N="MOUNT PANORAMA - BATHURST">` track with 7 position
   segments (`Pos1, Pos2, Int1, Pos3, Int2, Pos4, Pos5`), `<E C="R3"
   D="2026 TOYOTA GAZOO Racing Australia GR CUP - Race 1" Y="Race">`
   session. The observed session was a support-race sprint, addressed here as
   proof that any session on the meeting file works — the header shows the
   session name, series, meeting and a RACE/PRACTICE/QUALIFYING badge parsed
   from `E@Y`. `S@S` carries Green/Yellow/Red/Checkered plus `Ended`;
   `S="Safety…"` would map to safety-car.
3. **Measured vs derived:** classification order, gap seconds (`GI`/`GNI`)
   or lap deficits (`GL`/`GNL`), sector durations (`S1/S2/S3`), last lap
   (`I` = S1+S2+S3 on completion), best lap (`FI`), pit-stop counts (`PS`)
   and the coarse segment (`LP` 1–7 or `M` for Main) are measured. Nothing
   else is claimed: there are no timestamped sector/lap crossings, no GPS,
   no per-car pit in/out timestamps and no retirement flag, so those
   capabilities stay off and the corresponding snapshot fields stay null.
4. **Clocks:** `<C Y="T" C="…" E="…">` is remaining/elapsed seconds
   (trailing `-` marks expired, e.g. `238-`); per-car `T`/`I` values are Unix
   seconds with 4 decimals. `session.elapsed`/`remaining` come from the
   countdown; each car's `observedAt`/position age comes from the server time
   of the last packet touching that car — a global heartbeat never refreshes
   a silent car.

## Flow (as built)

```text
Natsoft page URL -> explicit resolver (scheme/host checks, no credentials)
  -> browser WebSocket (wss under HTTPS) -> decode -> merged state
  -> authoritative full v1 snapshots -> TimingProvider -> controller/store/UI
```

No server adapter was needed. If a future meeting requires authentication or
blocks sockets, add a same-origin relay that allowlists one
scheme/host/path, revalidates redirects, keeps secrets server-side, shares
one upstream connection and republishes validated snapshots — never a
generic fetch proxy.

## Behaviour and limits

- Retries use bounded exponential backoff (1, 2, 4, 8, 16, then 30 s),
  cancelled on disconnect/source switch; every reconnect resynchronises from
  the server's next full `<New>` under a new stream identity.
- Map markers are **coarse segment reports** (segment midpoints,
  `reported` provenance, fading to stale between ~30 s updates). Timed
  support races have no scheduled lap count, so `raceLaps` falls back to the
  leader's laps and the header emphasises remaining time.
- Possible-incident alerts fire when a car falls 5+ places within 90 s while
  running (pit stops, opening laps and non-running phases excluded, one
  alert per car per 3 min). They are labelled derived/possible in the event
  feed and as a dismissible banner — positions only, never a crash claim.
- Single-driver sprint entries show the driver plus a `—` second slot, as
  the schema requires a driver pair. DNS cars (0 laps once the leader is
  away, zero speed) are `unknown`, not invented retirements.
- `trackKm` is 6.213 for Mount Panorama and null elsewhere; `meeting` and
  `series` are optional session fields so older replays still validate.
