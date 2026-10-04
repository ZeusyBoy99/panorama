# Stage 1 build prompt — Bathurst race companion PWA

You are the lead engineer and product designer for a polished race companion Progressive Web App. Implement the first working version now. This is an implementation task: produce a running, tested application, not only a plan, architecture document, or collection of static mockups.

## 1. Goal and constraints

Build a mobile-first PWA for following the 2026 Bathurst 1000, with a live timing tower, an animated Mount Panorama circuit map, car details, favourites, race events, and a realistic simulated race feed.

The real timing website/link does not exist yet from our perspective. The owner will supply it when timing starts. Stage 1 must work entirely without that link, credentials, paid services, a database, or an external timing provider. Later, the user should be able to enter a supported timing link and use the same interface with real data.

Use the working app name **Panorama**. Make it easy to rename. The event context is Bathurst, but keep provider parsing separate from the event and UI so other events could be supported later.

The deliverable should feel like a finished demonstration of a serious race dashboard. The default experience is a simulated race already in progress. Prominently label it **DEMO — SIMULATED DATA** on every screen. Do not claim any fictional drivers, entries, results, or telemetry are official 2026 data. Use original styling and text; do not imply affiliation with Supercars or copy broadcast assets.

Make routine technical and design decisions yourself. Inspect the repository and follow applicable project instructions before editing. If the project is empty, initialise it. Preserve unrelated existing work. Do not wait for the timing link or stop after creating a skeleton. If something is blocked, complete the remaining work, explain the blocker, and distinguish working functionality from future integration.

## 2. Framework and project setup

Use this default stack unless an existing repository imposes a sensible equivalent:

- React + TypeScript in strict mode, built with Vite.
- Standard React DOM components and responsive CSS. This is a web-first PWA, not an Expo or React Native project.
- CSS variables for design tokens; CSS Modules or a small, consistent styling approach. Tailwind is acceptable if it makes the implementation simpler, but avoid redundant styling systems.
- React Router if needed for `/`, `/map`, `/events`, and `/settings`, with car details accessible through a route or query parameter. Make deep links survive reloads using documented hosting rewrites.
- Zustand with selectors for shared application state, or a comparably small external store. Keep race state, UI preferences, and animation state separate.
- Zod or an equivalent runtime validator at external-data and replay-file boundaries.
- SVG for the circuit, its labelled features, and interactive car markers. Use Canvas only if profiling demonstrates a real need.
- `vite-plugin-pwa` for the manifest, service worker, and update lifecycle. Use an update prompt rather than forcing a reload during a race.
- Vitest for deterministic domain tests, React Testing Library where interaction tests help, and Playwright for browser flows.
- A small icon library or original SVG icons. Bundle essential assets locally.

Choose currently stable, mutually compatible dependency versions by checking official documentation. Commit the lockfile and document the required Node version. Do not assume code samples from older package versions still apply. Avoid experimental dependencies and extra infrastructure without a clear purpose.

Provide scripts for development, type checking, linting, unit tests, browser tests, production build, and production preview. Stage 1 must run with `npm install` followed by `npm run dev`, or the repository's existing package-manager equivalent. No API keys should be required.

## 3. How the systems work together

Use one shared pipeline for all providers:

1. A timing provider emits a validated, provider-independent race snapshot and connection status.
2. A session controller accepts the update, checks its identity/version/order, records receipt time, and updates the race store.
3. Pure selectors derive standings views, gaps for presentation, favourites, recent events, and car detail data.
4. A separate map position resolver selects actual supplied positions, timing-based estimates, or an unavailable state according to the data capabilities.
5. The UI renders the standings and detail views from the store. A dedicated animation loop renders map movement between data updates without rerendering the entire app every frame.
6. A persistence layer stores preferences, a bounded last-known snapshot, and optional replay data. Cached information always retains its original freshness and source labels.

The mock simulator is a provider, not a special UI mode with its own hardcoded tables. Replays are another provider using the same contract. The future live integration must also enter through this contract.

Suggested structure:

```text
src/
  app/                  # routing, layout, error boundaries
  components/           # shared accessible UI
  domain/               # schemas, types, clocks, standings, formatting
  providers/            # common provider contract and registry
    mock/               # deterministic engine, roster, scenarios
    replay/             # validated recordings and playback
    live/               # documented integration seam; no invented endpoint
  state/                # race store, session controller, selectors
  features/
    timing/
    map/                # geometry, position resolver, render loop
    cars/
    events/
    settings/
    demo-controls/
  persistence/
  pwa/
  assets/
tests/
docs/
```

Keep this structure practical; do not create layers of empty abstractions. Implement a minimal provider interface with `connect`, `disconnect`, snapshot/status subscriptions with cleanup, capabilities, and a way to obtain a full snapshot for resynchronisation. Demo playback controls belong to a separate optional interface rather than being mandatory for future live providers.

Stage 1 should be frontend-only. Do not build a speculative scraping server. Document the likely Stage 2 flow: supported timing URL → server-side provider adapter if required → normalised snapshots/events → browser over SSE, WebSocket, or polling. The actual transport must be selected after inspecting the real source.

## 4. Data contract and correctness

Define and document a versioned normalised schema, including:

**Session**

- Stable event and session IDs, display name, season, track ID, session type, and configured race distance.
- Session phase: pre-race, running, suspended, finished, or unknown.
- Track status: green, yellow, safety car, red, chequered, or unknown. Keep this separate from phase and network status.
- Completed leader laps, elapsed session time, optional remaining time, and event timezone.
- Capabilities: classification, gap data, lap timing, timestamped lap crossings, timestamped sector crossings, pit status, current driver, position samples, and race-control messages. Do not equate sector durations with timestamped sector crossings.

**Entry/car**

- Stable entry ID; car number as a string; team ID/name/colour; the two driver IDs and names; nullable current driver ID.
- Nullable classified position and grid position; completed laps; status such as running, pit lane, stopped, retired, finished, or unknown.
- Leader gap and interval as tagged values: leader, seconds, laps, or unknown. Do not force lap deficits into seconds.
- Last lap, best lap, current sector, sector timing, last confirmed crossing, pit stop count, and stint/driver history when known.
- Explicitly distinguish previous-lap sector times from current-lap sector times; a not-yet-completed sector is null, not zero.
- Optional observations for position, pit entry/exit, penalties, and lap history, each with appropriate timestamps/provenance.

**Transport and observations**

- `schemaVersion`, `sessionId`, `streamId` or epoch, monotonically increasing sequence within that stream, source timestamp, and local receipt timestamp.
- Keep source time, simulation/replay time, and monotonic client time conceptually separate. Use milliseconds internally for durations and explicit units for distances/progress.
- A feed heartbeat shows connectivity; it must not falsely make an old car observation fresh.
- Per-car availability and age must be supported even when the provider advertises a capability globally.
- Stable event IDs, event timestamps, affected entry IDs, message category, and whether an event was supplied or inferred.
- An explicitly typed map observation: supplied coordinates/progress, confirmed crossing anchor, or unavailable. The rendered map position additionally carries `simulated`, `reported`, or `estimated` provenance, age, and a qualitative confidence state.

For simplicity, Stage 1 may deliver complete snapshots at its normalised provider boundary. A future adapter may assemble source deltas into full snapshots internally. Document whether fields are authoritative replacements or optional observations; never accidentally preserve values that the provider explicitly invalidates.

Use null/unknown for missing information and render it as `—` with an explanation where useful. Stable IDs must survive position changes and driver swaps. UI rows must not use current rank as their React key. Preserve known source classifications rather than re-ranking cars using inferred map positions. Map estimates must never change official standings or create supposedly confirmed overtakes.

Ignore duplicate/out-of-order sequences within a stream. A new stream or session may reset sequence numbers, so do not reject a valid fresh session forever. On reconnect, replace state from a full snapshot before accepting subsequent updates. Cancel old subscriptions when switching providers/scenarios so late messages cannot mutate the new session. Bound history buffers.

Do not treat a car moving across the start line on the map as proof of an extra completed lap. Race timing and classification remain anchored to provider observations.

## 5. Visual design and screens

Aim for a motorsport broadcast dashboard: charcoal surfaces, clear white typography, restrained accent colours, team colours, compact timing rows, and tabular numerals. Keep data readable rather than surrounding it with decorative cards. Avoid excessive gradients, glow effects, or oversized empty hero sections.

Support light, dark, and system themes, defaulting to a polished dark presentation for the first visit. Important status must use text/icons as well as colour. Use adequate contrast, visible focus, reduced-motion support, accessible dialog behaviour, and comfortable touch targets.

### A. Main race dashboard

- Event title and obvious demo/replay/source label.
- Current phase/track status, lap progress, elapsed race time, connection state, and age of the last accepted update.
- Main timing tower with position, car number, current driver, team indicator, gap/interval, last lap, best lap, completed laps, and pit/retirement status.
- Full timing columns on desktop; a deliberate compact column set on phones with additional detail on tap. Avoid making the entire phone page horizontally scroll.
- Toggle between gap to leader and interval ahead.
- Search by car number, driver, and team.
- Favourite cars; favourites-only filter; optional compact favourite summary. Favouriting must not silently disturb the actual race order.
- Subtle rank-change animation and temporary change indication. Avoid reordering a user's focused control or making every timing tick flash.
- Race-best and personal-best lap/sector styles only when supported by valid timing data. Do not highlight unknown or invalid laps.
- Empty, loading, no-source, reconnecting, stale, offline, and error states designed as real states.

Desktop/tablet layout: standings and circuit side by side, with selected-car details and recent events nearby. Mobile layout: timing and map as clear primary destinations, with a compact race header that does not consume half the screen.

### B. Circuit/map view

Build a recognisable Mount Panorama outline, start/finish marker, direction indicator, labelled major sections, sector anchors, and a separate pit lane path. Use an appropriately licensed or original trace, document provenance/attribution, and store it locally. If exact geometry or official timing-loop locations are unavailable, use an original schematic and visibly identify estimated/demo anchors. Do not present invented coordinates as surveyed track data. Do not depend on paid map tiles or a live external map service.

Required interactions:

- Numbered car markers with team colours.
- Selecting a marker selects the same car everywhere in the app; selecting a timing row highlights it on the map.
- Favourite/selected-car emphasis, tooltip or details panel, and a readable overlap strategy for close cars.
- Zoom/pan and reset-to-fit controls, including touch behaviour. Distinguish tapping a car from dragging the map.
- Legend for simulated/reported/estimated/unknown/stale positions, plus visible source mode.
- Show pit-lane motion only when the necessary observations/model support it. Otherwise place the car in an explicitly non-positional pit status area.
- Stopped/retired cars must not keep circling. If a stopping location is unknown, use an off-track status area rather than inventing a crash location.
- Provide an accessible text equivalent through the standings and selected-car details.

### C. Car details

Show car number, team, both drivers and current driver, classified position, lap deficit/gap, pit status, lap/sector times, recent lap history, a compact lap-time trend, stint/driver-change history, and related events. Support following/favouriting from here. Missing data should result in honest placeholders or hidden sections.

### D. Race event feed

Chronological events for lead changes, supplied/derived position changes, fastest laps, pit entry/exit, driver swaps, track-status changes, penalties, retirement, and finish. Label derived events; a classification update does not establish the exact physical location or moment of an overtake. Deduplicate by ID and offer an all-cars/favourites filter. Use in-app notices sparingly; do not announce every timing update through accessibility live regions.

### E. Settings and source screen

- Theme, compact/comfortable rows, reduced-motion preference, favourite management, and supported display options.
- Source choices: demo simulator and replay file. Explain that live integration is awaiting the actual provider link.
- Include a labelled timing-URL field and syntactic validation as a preview of the future workflow, with a clear “Live provider integration is not available yet” message. Never imply the URL is connected or start arbitrary requests in Stage 1. Do not store URL query-string secrets or render arbitrary HTML from it.
- Install instructions appropriate to the browser, offline status, app version, and a concise data-source/about note.
- Feature-detected “Keep screen awake” control using the Screen Wake Lock API if available; gracefully handle denial/release and reacquire on visibility changes when enabled. Treat it as progressive enhancement.

### F. Demo control panel

Keep advanced demo controls separate from the ordinary fan-facing display, but make them easy to open during development and review. Provide scenario selection, deterministic seed, pause/resume/reset, 1×/5×/20× speed, capability profile, and failure injection. Show when playback is intentionally paused rather than labelling it a network failure.

## 6. Live map model — implement this carefully

The provider's data determines the map's precision. Implement four capability profiles and test them independently:

1. **Simulated position feed:** mock provider supplies timestamped normalised track progress and/or pit-lane progress. Smooth between samples. Always call these simulated positions, never real GPS.
2. **Sector-crossing timing:** expose confirmed sector/lap crossing timestamps and valid recent sector durations, but no hidden continuous progress. Estimate movement within a sector, anchored to the last actual crossing. Label the entire mode estimated.
3. **Lap-crossing timing:** expose timestamped start/finish crossings and recent lap durations only. Estimate within a lap using a documented speed profile. Label the result lower-confidence and estimated.
4. **Classification only:** expose places and supported gaps but no usable position anchors. Keep the track visible and explain that positions are unavailable. Do not distribute cars evenly around the track or invent a credible-looking race map.

Represent the main circuit as an arc-length lookup table where progress 0 and 1 refer to the start/finish boundary. Provide mapping from normalised progress to SVG coordinates and orientation. Sector anchors must map consistently to this geometry. Model the pit path separately with defined entry/exit anchors.

Use a piecewise distance/time speed profile so the schematic demo moves faster along straights and slower through corners. It is an illustrative model, not real telemetry. Normalise each section's profile so the integrated distance matches its boundaries and estimated duration. Do not use one constant speed for the entire lap unless explicitly in a simplified fallback mode.

Use unwrapped progress when interpolating across start/finish so a car at 0.99 followed by 0.01 moves forward across the line. Guard against long-gap interpolation inventing extra laps. Small corrections may ease visually, while large discontinuities should reset with an honest state rather than animate backwards across the circuit.

Sparse timing requires bounded extrapolation. After an expected crossing is overdue beyond a configurable grace period, reduce confidence and then freeze/hide the position; do not keep inventing lap after lap. Handle unknown pit entry, red flags, safety cars, stopped cars, and missing updates conservatively. A yellow flag alone does not prove a car's exact speed. The truth simulator can model safety-car bunching; a timing-only estimator cannot magically know the exact queue.

Separate race ordering from physical order around the circuit: a lapped car may be physically ahead of the leader while classified behind. Retired/finished entries and pit-lane entries need explicit treatment.

Most importantly, the timing-only adapters must remove hidden simulator position fields before publishing snapshots. The map resolver must not import simulator internals. Otherwise the demo would appear to prove an estimation method that cannot work on the real feed.

## 7. Synthetic data specification

Create 24 fictional entries and 48 fictional drivers. The following fixture is an exact starting roster, not a real 2026 entry list. Cars in each adjacent pair share a team colour. Current driver initially means the first named driver. Preserve IDs independently of these display names.

| Car | Fictional team       | Driver A      | Driver B     | Team colour |
| --- | -------------------- | ------------- | ------------ | ----------- |
| 07  | Summit Racing        | Alex Rowan    | Blake Mercer | #E85D75     |
| 08  | Summit Racing        | Casey Vale    | Drew Hart    | #E85D75     |
| 12  | Coastline Motorsport | Ellis Reed    | Finley Shaw  | #4EA5FF     |
| 13  | Coastline Motorsport | Gray Nolan    | Harper Quinn | #4EA5FF     |
| 21  | Ironbark Racing      | Jamie Wells   | Kai Lawson   | #F0B44D     |
| 22  | Ironbark Racing      | Logan Hayes   | Morgan Pike  | #F0B44D     |
| 31  | Apex Valley          | Nico West     | Oakley Frost | #A78BFA     |
| 32  | Apex Valley          | Parker Lane   | Quinn Brooks | #A78BFA     |
| 41  | Southern Cross Sport | Riley Stone   | Sam Archer   | #3ECFAD     |
| 42  | Southern Cross Sport | Taylor Dean   | Avery Moss   | #3ECFAD     |
| 51  | Redgum Performance   | Cameron Finch | Devon Marsh  | #FF8A65     |
| 52  | Redgum Performance   | Eden Cole     | Frankie Knox | #FF8A65     |
| 61  | Harbour Works        | Hayden Bell   | Indigo Fox   | #51C4DF     |
| 62  | Harbour Works        | Jesse North   | Kendall Lake | #51C4DF     |
| 71  | Mountain Line        | Lee Dawson    | Marley Kent  | #D784DD     |
| 72  | Mountain Line        | Noel Rivers   | Peyton Miles | #D784DD     |
| 81  | Outback Engineering  | Remy Grant    | Sydney Cross | #BDC96A     |
| 82  | Outback Engineering  | Toby Blair    | Arden Chase  | #BDC96A     |
| 91  | Westbound Racing     | Bailey Wren   | Darcy Flynn  | #F28AB2     |
| 92  | Westbound Racing     | Emery Tate    | Hollis Price | #F28AB2     |
| 101 | Silver Fern Speed    | Jordan Ash    | Kit Monroe   | #9DB2CE     |
| 102 | Silver Fern Speed    | Luca Voss     | Micah Wynn   | #9DB2CE     |
| 111 | Horizon Autosport    | Phoenix Hale  | Robin Shea   | #D9AD7C     |
| 112 | Horizon Autosport    | Sasha York    | Terry Ames   | #D9AD7C     |

Bathurst configuration: 6.213 km main circuit and 161 scheduled laps. Treat three sector regions as configurable demo regions until real timing-loop locations are known. These constants do not establish the 2026 entry list or feed capabilities.

Use a seeded PRNG, default seed `10002026`, and a deterministic simulation clock. For fixture index `i = 0..23`, use a target green-flag lap time of `126000 + 180*i` ms before small seeded lap-to-lap variation (for example ±600 ms). Suggested synthetic sector-time proportions are 0.29, 0.36, and 0.35; they must sum to the whole lap. These are chosen demo parameters, not claimed Bathurst telemetry.

Suggested mock parameters:

- Internal fixed simulation step around 50 ms; publish position-capable snapshots about twice per simulated second.
- Timing-only profiles publish crossings when they occur, with snapshots/heartbeats on a separate cadence. Do not fabricate a new measured position at each heartbeat.
- Demonstration pit-lane traversal roughly 20–30 simulated seconds plus a scripted stationary service period of roughly 20–35 seconds; driver changes only on chosen stops. Treat these as synthetic tuning values.
- Bounded recent lap history, events, and observation buffers.
- Default dashboard checkpoint around leader lap 42, with close battles, midfield gaps, and one or two cars a lap behind. Generate a coherent checkpoint from the engine or replay; do not hand-enter contradictory laps, crossings, and gaps.
- At accelerated speeds, advance the simulation clock and process all crossing/event boundaries correctly. Decouple this from browser rendering and coalesce UI updates so 20× playback does not trigger excessive React renders.

Calculate mock classification from coherent simulated race state, with an explicit documented policy for retirement and race finish. This is a demonstration scoring model, not an implementation of the full sporting regulations. Compute timing gaps from common timing-point histories where feasible; show unknown until comparable observations exist. Do not convert geometric separation directly into purported measured time gaps.

Provide at least one compact, versioned recording fixture and a reproducible way to generate longer recordings. An initial checkpoint plus a deterministic event timeline is preferable to megabytes of arbitrary random JSON.

## 8. Required scenarios and fault cases

Each scenario must be repeatable, resettable, and selectable. Use documented simulation times or checkpoints so reviewers can reach each state quickly. Events such as pits must be scheduled at the relevant track location rather than teleporting a car into a pit box at an arbitrary timestamp.

| Scenario                    | Required behaviour                                                                                                                                               |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Normal racing               | 24 cars circulate, lap/sector times update, gaps change coherently, and a close pair trades positions through scripted pace changes.                             |
| Pit cycle                   | Multiple cars enter/stop/leave the pit lane, classification changes, and one changes drivers while retaining entry identity and favourites.                      |
| Safety car and restart      | Track status changes, the truth simulation gradually bunches cars under its demo rules, then resumes green running; timing-only views retain honest uncertainty. |
| Red flag                    | Racing motion stops under the demo model, status changes clearly, and resumption does not add fictitious laps.                                                   |
| Lap deficit                 | A car is one or more laps down; its physical location differs from its classified order, and gap formatting uses laps.                                           |
| Retirement                  | A car stops/retires, remains correctly represented in classification, and its marker freezes at a known location or moves to the unknown-location status area.   |
| Missing capabilities        | Switch among position, sector-crossing, lap-crossing, and classification-only profiles; unsupported UI degrades truthfully.                                      |
| One car goes silent         | Other entries stay current while one observation ages and loses map confidence. A global heartbeat must not conceal that.                                        |
| Feed outage                 | Stop provider data for 10–20 real seconds while the engine continues. Show stale/reconnecting state and bounded estimates, then recover from a full snapshot.    |
| Duplicate/out-of-order data | Inject an old sequence and duplicate events. Race state must not move backwards or show duplicate notices.                                                       |
| New stream/session          | Reset sequence numbers with a new identity and correctly clear incompatible old state.                                                                           |
| Schema errors               | Reject malformed fields/messages without crashing; keep the last valid snapshot clearly marked and recover.                                                      |
| Race finish                 | Start from a coherent late-race checkpoint, reach 161 laps, show chequered/finished behaviour, and stop treating finished cars as indefinitely racing.           |
| Browser/offline lifecycle   | Lose network, reopen the cached app, return from a hidden tab, and display cached data with its original timestamp.                                              |

Keep playback pause, a deliberate feed fault, and actual browser offline status distinct. Define which fault durations use wall time versus simulation time and test that distinction. Demo simulation may work offline; label that as offline demo operation rather than a live feed.

## 9. Replay, persistence, and PWA behaviour

Implement a replay provider with play/pause, speed, reset, and seek over the provided recording. Seeking backwards must rebuild state from a checkpoint rather than merge future state into the past. Replay must use the same selectors/map resolver as the mock and future live providers. A visible REPLAY badge must remain distinct from DEMO and LIVE labels.

Allow exporting a short recording and importing a versioned replay JSON file. Validate shape, schema version, file size, and record counts before use; give readable errors. Do not eval replay contents or render strings as HTML. Bound recordings and avoid retaining every animation frame. Replay transport data—not private simulator truth—so timing-only recordings genuinely test estimation.

Persist favourites and display settings locally. Persist the latest valid snapshot separately, tagged with session/provider/schema identity and original timestamps. Use IndexedDB for recordings or larger snapshots if needed; localStorage is enough for small preferences. Handle unavailable storage, quota errors, and incompatible saved versions gracefully. Do not silently resume old cached data as a live session.

Configure:

- A proper manifest with app name, short name, start URL, scope, standalone display, theme/background colours, correctly sized regular/maskable icons, and an Apple touch icon.
- Responsive viewport and iPhone safe-area handling. Prefer modern dynamic viewport sizing with a sensible fallback.
- HTTPS deployment readiness; localhost development is fine.
- Precache the app shell, local track geometry, icons, and other essential static assets.
- Deliberate caching rules: never serve cached timing responses as fresh. Keep timing transport outside stale-while-revalidate asset caching.
- Useful offline launch after the first successful visit: show an offline notice and either explicitly labelled last-known information or the offline demo.
- A user-controlled “Update available” action; do not interrupt a race with an automatic reload.
- Installation guidance and feature detection. Do not display an Install button that does nothing on unsupported browsers. On iPhone, provide the applicable Add to Home Screen guidance.

Do not promise background WebSocket continuity when the browser is suspended. On visibility restoration, refresh/resynchronise, check age, and then resume animations. Keep actual push notifications outside Stage 1; implement in-app event notices only. Future Web Push would require its own server/subscription work and permission UX.

## 10. Performance and quality

- Target smooth map motion on a typical phone, while ensuring correctness does not depend on frame rate.
- Use requestAnimationFrame for visible animation and cancel it on unmount/when hidden. Use monotonic elapsed time, not frame counts. Honour reduced motion.
- Avoid updating the global React store at animation frame rate. Update data at its intended cadence, and keep smooth marker movement local to the renderer.
- Use stable memoised selectors and bounded buffers. Twenty-four timing rows do not automatically need a complicated virtualised table.
- Correctly clean up subscriptions, timers, event listeners, and reconnect attempts. Switching scenarios repeatedly must not accelerate the engine or duplicate messages.
- Reconnect with a documented bounded backoff policy where a transport needs it; avoid a busy retry loop. A provider status should distinguish connecting, connected, reconnecting, stopped, and error from the age of its data.
- Show times consistently using tabular digits: lap times such as `2:06.432`, positive second gaps such as `+1.234`, and lap deficits such as `+1 LAP`.
- Never request notification permission on first page load.
- Use text-safe rendering for provider-controlled strings, validate imported data, and keep any future provider secrets on the backend.

## 11. Tests and acceptance criteria

Write meaningful tests for the risks in this application. Do not inflate coverage with tests that merely repeat the implementation.

**Domain tests**

- Same seed and simulated time produce the same engine state, regardless of playback speed or frame cadence.
- Lap/sector boundary processing, 0.99 → 0.01 map wrap, pit entry/exit, and finish transitions.
- Gap formatting and unknown values; lapped-car handling; stable entry identity across driver changes.
- Out-of-order/duplicate handling, valid sequence reset on new stream, cleanup when switching sources.
- Sector/lap-only estimation uses only visible observations and stops making confident predictions beyond its horizon.
- Safety-car/red-flag/missing-pit-data fallbacks do not pretend to know missing positions.
- Replay seek yields the same state as playback to that timestamp.
- Invalid replay and snapshot rejection; cached data remains visibly stale.

**Browser flows**

- App opens directly into a working demo with clear simulated-data labelling.
- Search/filter/favourite, reload persistence, car selection from both table and map, and event filtering.
- All four capability profiles and at least pit cycle, outage/recovery, and finish scenarios.
- Usable mobile and desktop layouts, keyboard navigation, dialog focus, and reduced-motion settings.
- Production-build service-worker registration, manifest/assets, offline reload after a successful online load, and safe update behaviour where the test environment allows it.
- No obvious console errors, failed essential asset requests, horizontal overflow, or unreadable selected states.

Check roughly 390×844, 768×1024, and 1440×900 layouts. Run Chromium and WebKit browser tests when available, but do not claim that automated WebKit tests prove Home Screen installation or all behaviour on a real iPhone. List real-device checks still needed.

Stage 1 is complete when the owner can run the app, watch a coherent simulated race, use every primary screen, switch map capability modes, test failure/recovery, load a replay, build the production PWA, and understand exactly where the future live adapter fits. If any item remains incomplete, state it explicitly rather than calling a mock button a finished feature.

## 12. Implementation sequence

1. Inspect the workspace and existing instructions. Write a short plan, then begin implementing immediately.
2. Create the app, design tokens, domain schema, provider interface, and coherent seeded mock engine.
3. Deliver a vertical slice: working timing tower, shared selected-car state, and map driven by provider snapshots.
4. Complete car details, favourites, event feed, responsive layout, and the capability-based map resolver.
5. Add the demo scenarios, feed failures, replay provider, and local persistence.
6. Add installability, offline/update behaviour, accessibility, and browser lifecycle handling.
7. Run the meaningful tests, inspect the rendered interface, fix problems, and document the result.

Prioritise this sequence so the core race experience becomes usable early, but continue until the agreed Stage 1 scope is complete or a real blocker is identified. Avoid spending the entire effort polishing setup files while the map and timing remain placeholders.

## 13. Handoff documentation and final report

Create:

- `README.md`: install/run/build/test instructions, demo controls, implemented features, and known limitations.
- `docs/architecture.md`: provider-to-store-to-map/UI data flow, clocks, state ownership, and extension points.
- `docs/data-contract.md`: the versioned schema, units, timestamp semantics, null behaviour, capability degradation, and a valid example snapshot.
- `docs/demo-scenarios.md`: roster, seed, synthetic assumptions, reproduction steps, checkpoints, and expected outcomes.
- `docs/live-integration.md`: how to inspect the future timing link, identify supported data, map fields, and replace the adapter without rewriting the interface.
- `docs/verification.md`: commands actually run and their results, inspected viewport screenshots, browser coverage, remaining real-device checks, and any unresolved issues.

For future integration, explicitly cover: whether the source offers JSON/SSE/WebSocket/HTML; session IDs and cadence; permissions/authentication and browser restrictions; source timestamps and measured versus derived fields; CORS; server-side connection sharing; bounded retries and rate limits; sanitisation; and per-entry freshness. A supported URL resolver must not become an unrestricted fetch proxy: use explicit provider support and validate destinations, including redirects, if server-side fetching is introduced.

Do not invent a provider endpoint, scrape an unrelated event as though it were the 2026 race, or claim true GPS exists without evidence. The actual feed may only support the standings. Keep that a valid product configuration.

After implementation, report what works, how to run it, what was tested, what is simulated, what remains blocked, and the exact next step when the owner supplies the real link. Stop at a completed Stage 1; do not deploy publicly, create paid services, or publish to an app store unless separately requested.

Future enhancements, not Stage 1 requirements: real timing adapter/backend; Web Push; TV broadcast delay synchronisation; accounts/cloud sync; official entry import; weather; sophisticated strategy predictions; 3D maps; additional circuits; native wrappers. Keep extension points where useful, but do not build placeholder UI for every possible feature.

## 14. Reference starting points

Consult current official documentation when implementing; these links are starting points, not a substitute for checking installed versions:

- React: https://react.dev/
- Vite: https://vite.dev/guide/
- Vite PWA guide: https://vite-pwa-org.netlify.app/guide/
- PWA update prompt: https://vite-pwa-org.netlify.app/guide/prompt-for-update.html
- PWA installation: https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable
- Offline/background behaviour: https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Offline_and_background_operation
- Browser cross-origin restrictions: https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS
- Bathurst event context/track constants: https://www.supercars.com/events/2026-bathurst-1000

Begin now by inspecting the project, then build and verify the working Stage 1 application.
