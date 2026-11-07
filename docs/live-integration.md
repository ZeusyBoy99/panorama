# Live integration: Natsoft Race Results (implemented)

Stage 1 ended with an empty seam. The owner then supplied a public Natsoft
URL (`http://server.natsoft.com.au:8080/LiveMeeting/20261011.MOUN`, no
login), and this document records what the source was found to offer and how
it is connected. Paste a `LiveMeeting/<file>` page URL into Settings → Live
timing to connect; the app opens the feed's WebSocket directly. The current
default is `http://server.natsoft.com.au:8080/LiveMeeting/20261108.SAN`.
Previously saved meeting URLs still take precedence.

## Meeting 20261108.SAN (verified 7 November 2026)

The supplied meeting page returned HTTP 200 and exposes a temporary
`gsLiveToken`. The Natsoft client appends it to its WebSocket URL. The HTTPS
page allows cross-origin requests, so Panorama can fetch the token directly
and open the secure socket on port 8080. It does not execute the meeting
page or persist the token. The handshake worked in Chromium, but Natsoft
returned `<NotFound />`; no SAN classification was available to verify.
Panorama shows the unavailable state and retries with a fresh token every
30 seconds. A synthetic browser fixture verifies recovery into standings
when the feed subsequently sends a session and classification.
Chromium and WebKit both passed the fixture covering retry, standings and
a driver change without losing the car's favourite. The full checks passed:
53 domain tests, 24 browser tests, lint and the production build.

The standings, event feed and driver details work independently of the
circuit map. A live meeting shows the Bathurst outline only once its feed
identifies Mount Panorama. Other circuits show an unavailable map notice.

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
generic fetch proxy. The app upgrades `ws://` to `wss://` whenever it is
served over HTTPS (browsers block insecure sockets from secure pages).

## Behaviour and limits

- Retries use bounded exponential backoff (1, 2, 4, 8, 16, then 30 s),
  cancelled on disconnect/source switch; every reconnect resynchronises from
  the server's next full `<New>` under a new stream identity.
- Map markers are **coarse segment reports** (segment midpoints,
  `reported` provenance, fading to stale between ~30 s updates). Timed
  support races have no scheduled lap count, so `raceLaps` falls back to the
  leader's laps and the header emphasises remaining time.
- Possible-incident alerts fire only in races, only when a car falls 5+
  places within 90 s while running, and only once the drop is still there 20
  s later (pit stops, opening laps and non-running phases excluded, one
  alert per car per 3 min). Qualifying and practice orders swing
  legitimately, so drops there never alert. They are labelled
  derived/possible in the event feed and as a dismissible banner — positions
  only, never a crash claim.
- A provider watchdog republishes at least every 2 s so the UI keeps
  refreshing with honestly growing ages through packet stalls, and
  resynchronises when a running session goes quiet for 30 s. A finished
  session going quiet is normal: the last classification stands.
- The adapter keeps registered drivers from `R/V` and selects the driver
  in the car using the leaderboard's `P@D` slot. Observed slot changes
  append a stint and race update under the same car identity. An unknown
  slot is left unknown; the feed does not establish permanent main-driver
  or co-driver roles. DNS cars (0 laps once the leader is away, zero speed)
  are `unknown`, not invented retirements.
- `trackKm` is 6.213 for Mount Panorama and null elsewhere; `meeting` and
  `series` are optional session fields so older replays still validate.
