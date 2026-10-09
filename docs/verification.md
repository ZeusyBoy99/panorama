# Stage 1 verification

Verified locally on **4 October 2026 (Australia/Perth)** with Node 24.11.0 / npm 11.6.1. There is no public deployment, server/database, or API key. Live timing (Natsoft, no login) was connected and verified on **9 October 2026** against the public 2026 Repco Bathurst 1000 meeting feed; see the live section below.

## Commands actually run

| Command                                          | Result                                                                                         |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| npm install                                      | Dependencies installed and package-lock.json generated                                         |
| npm run recording:generate                       | Compact, versioned sector replay generated from engine; 7 snapshots / 60 seconds, about 390 KB |
| node scripts/generate-icons.mjs                  | 192/512px regular icons, 512px maskable and 180px Apple icon generated                         |
| python3 scripts/generate-track.py                | Closed, locally projected OSM centerline and pit path generated                                |
| npm run typecheck                                | Passed, strict TypeScript                                                                      |
| npm run format:check                             | Passed                                                                                         |
| npm run lint                                     | Passed                                                                                         |
| npm test                                         | 27 domain/pipeline/geometry checks passed before final handoff                                 |
| npm run build                                    | Passed; app bundle and manifest/service worker generated; about 889 KiB precache               |
| npm run preview + HTTP readiness request         | Local production preview returned 200                                                          |
| npm run test:browser -- tests/browser.spec.ts    | 14 existing browser flows passed: 7 Chromium + 7 WebKit, 43.3 seconds                          |
| npx playwright test tests/map-regression.spec.ts | 8 map/theme regressions passed: 4 Chromium + 4 WebKit, 14.0 seconds                            |
| npm audit                                        | Final installation reported 0 vulnerabilities after upgrading sharp to its patched release     |

Early failures were repaired and rerun: platform AppleDouble metadata excluded from lint/test/cache patterns; compact replay brought below the Workbox asset limit; URL-selection feedback loop removed; controls explicitly labelled; mobile row taps open details; reduced-motion freshness timer added; range scrubber subscribed to accepted data; initial service-worker claiming enabled without forcing updates. Browser tests use real keyboard range interaction rather than programmatically filling a slider. Advanced-options tests preserve the expanded disclosure across dialog reopen.

## What the domain checks cover

Deterministic seeded clock across cadence/acceleration; valid summed sector timings and bounded histories; all four capability projections stripping hidden truth; forward wrap and track geometry; measured-point gap formatting/lap deficits; suspended/red motion and resume; scheduled pit entry/service/exit and stable driver identity; retirement freeze and conservative sparse fallbacks; silent per-car observation expiry despite heartbeat; graceful unknown/overdue timing estimates; race finish and stopped cars; stream/session reset, ordering/duplicate/schema rejection, event deduplication and authoritative null replacement; source-switch cleanup; 15 real-second outage at 20× including visibility-resync protection; backward replay seeking and continuous replay clock; invalid JSON/version/order/size rejection; original cache receipt retained and storage failures handled. Additional checks verify scripted lead changes, gradual safety-car bunching, unsupported imported anchors, and sourced circuit shape/pit connections.

## Browser coverage

Both Chromium 153 and WebKit 26.6 covered the demo (pinned via `?demo` now that live is the default boot), demo labels, driver search, favourite/reload persistence, row/map shared selection, car deep links/navigation, all map profiles, pause, dialog Escape, friendly/Hacker UI switch, theme/reduced motion, pit driver changes, stable favourites, chequered/finished state, real-time outage/recovery, malformed and duplicate data, bundled replay/seek/export/import/errors, and live timing URL checks that make no request on format check and never persist query-string secrets.

The map/theme regression suite additionally checks repeated selection during animation, all car centres remaining within 0.8 SVG units of the appropriate main/pit path through a pit cycle, visible pit-lane separation, non-overlapping Griffin’s Bend and Panorama text, fresh system-theme defaults, system appearance changes, and persisted manual overrides. Selection no longer restarts the smoothing interval; overlap handling offsets number labels rather than car bodies. The driving-direction arrow has been removed.

Both verified production manifest, icon requests and service-worker readiness/controller. **Chromium additionally verified offline reload and loading the precached replay while offline. WebKit offline reload is not claimed:** Playwright's WebKit encountered an internal reload error under emulated offline mode, so its automated case stops after registration/asset checks. Real Safari/iPhone offline testing remains necessary.

No page errors were recorded in the basic interaction and viewport flows. Essential manifest/icon requests succeeded. No horizontal page overflow at 390×844, 768×1024 or 1440×900 on either engine. Direct `/map` reload worked. Screenshots were captured and visually inspected for both small and large layouts; the circuit shape/orientation was compared with the Supercars circuit-map reference. The official graphic is not bundled; geometry is from attributed OSM data.

## Inspected screenshots

- [Chromium 390×844](screenshots/chromium-390.png)
- [Chromium 768×1024](screenshots/chromium-768.png)
- [Chromium 1440×900](screenshots/chromium-1440.png)
- [WebKit 390×844](screenshots/webkit-390.png)
- [WebKit 768×1024](screenshots/webkit-768.png)
- [WebKit 1440×900](screenshots/webkit-1440.png)

## Live timing verification (9 October 2026)

Inspected the supplied `http://server.natsoft.com.au:8080/LiveMeeting/20261011.MOUN` page, decoded its WebSocket protocol from the served `Client_Obfs.js`/`Live_Obfs.js`, and captured ~700 real packets (GR Cup Race 1: Yellow running, Green flag, lap completions, `Ended` finish). Captured fixtures are checked in under `tests/fixtures/natsoft/`.

| Command / check | Result |
| --------------- | ------ |
| `npx vitest run tests/live-natsoft.test.ts` | 11 checks passed: XOR round-trip, URL resolution/rejection, New import, partial merge, clock/status, snapshot validity, controller acceptance, incident rules |
| `npm test` | 38 checks passed (27 existing + 11 live) |
| `npm run typecheck` / `npm run lint` / `npm run build` | Passed |
| Live smoke (`NatsoftLiveProvider` against the real feed, 20 s) | Connected, 4 snapshots, all schema-valid; session/entries/events sane (29 cars, leader lap 4, finished phase). One defect found and fixed: non-numeric countdown produced `remaining: NaN`; countdown values are now validated with trailing-dash negative support |

Remaining live checks: browser UI pass against a running session (next live window), real-device install/offline behaviour, and a multi-session observation (practice/qualifying type mapping and pit-flag values are inferred from client code, not yet seen live).

## Remaining checks and deliberate limits

- Real iPhone Safari Add to Home Screen, standalone safe areas, WebKit/Safari offline reload, browser-specific install/update prompts and wake-lock denial/release behaviour.
- Real Android installation and pinch/tap/pan behaviour; representative phone performance during a long race. 24 markers render outside React at animation cadence, but no claim of hardware profiling on a physical phone is made.
- Real device background suspension/restoration; the simulator bounds catch-up, and the future live provider must resynchronise rather than assume background socket continuity.
- A two-version production update on actual installed browsers. Prompt-mode service worker and user-controlled Update now are configured and built; no automatic reload is configured.
- The real adapter remains deliberately unavailable until the owner supplies the timing URL. Follow live-integration.md to inspect transport, source fields, permissions, CORS and per-entry age. No official 2026 results/entries/telemetry are claimed.
- Scoring, safety-car/pit times and source-map sector anchors are synthetic. Penalties are timestamped demo observations; this does not implement a complete sporting-rules penalty scoring engine.
