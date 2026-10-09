# Panorama

An independent, mobile-first race companion PWA for the Bathurst 1000. It opens on **fictional simulated data** (labelled DEMO), and can also connect **live timing** from a public Natsoft `LiveMeeting` URL — for example the 2026 event feed at `http://server.natsoft.com.au:8080/LiveMeeting/20261011.MOUN`. Live mode has no credentials, backend, database, paid service, or external map dependency: the app opens the feed's WebSocket directly from the browser.

## Run locally

Use **Node 22.12 or newer** (Node 24 LTS recommended; `.nvmrc` selects 24).

```sh
npm install
npm run dev
```

Open the Local URL printed by Vite (normally http://127.0.0.1:5173). The demo opens at a coherently generated checkpoint near lap 42. Name/version constants live in `src/domain/schema.ts`; update the manifest and document title when renaming.

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run preview
```

Production preview is http://127.0.0.1:4173. The production build registers the service worker and supports offline launch after its first successful visit. Development intentionally does not register it.

For browser checks:

```sh
npx playwright install chromium webkit
npm run build
npm run test:browser
```

## Use the race companion

- **Standings:** search by number, either driver, or team; toggle leader gaps/intervals; star favourites; select a row. Mobile row taps open details immediately.
- **Track map:** pan by dragging, zoom with buttons or a two-finger pinch, reset to fit, select numbered markers. Keyboard users can tab to markers and press Enter/Space. Car bodies stay on the path; crowded number labels use small connector lines. Selecting a car does not restart its motion.
- **Car details:** classification, drivers, lap/sector history, trend, stints, pit stops, penalties and related events. Selection survives navigation and reload through `?car=entry-…`.
- **Race updates:** supplied and derived events are labelled separately, with a favourites filter. Derived classification changes are not claims about physical overtaking locations.
- **Live timing:** the app opens on the real meeting when online — timing tower, coarse track-segment map positions, session name/series/type (race/practice/qualifying), track status and remaining time. The feed URL defaults to the 2026 Bathurst meeting and can be changed in Settings → Live timing; `?demo` opens the simulated demo instead. A banner warns of *possible* incidents when a car falls 5+ places in ~90 seconds (pit stops excluded) — positions only, never a crash claim. See [live integration](docs/live-integration.md).
- **Settings:** a friendly default interface with optional Hacker UI, dark/light/system theme (Follow system by default), row density, reduced motion, favourites, feature-detected wake lock, replay import/export, installation guidance and an inert timing-URL format preview.
- **Demo controls (Race lab in Hacker UI):** scenario, deterministic seed, four map capability modes, pause/resume/reset, 1×/5×/20×, and injected feed failures. It is separate from the normal fan-facing display.

All transport snapshots pass the same runtime schema and session controller. Favourites and preferences are stored locally. A bounded last-known snapshot retains its original receipt timestamp; restarting opens a fresh, visibly labelled demo rather than implying cached information is live.

## Replay

Settings can load the bundled sector-timing replay, import a versioned JSON file, or export up to 60 recent provider updates. Open Demo controls for play/pause, speed and seek. Seeking rebuilds from the latest full checkpoint at/before the cursor, with a new stream identity.

Generate another recording:

```sh
# profile, duration ms, output path, snapshot interval ms
npm run recording:generate -- sector 60000 public/demo-replay.json 10000
npm run recording:generate -- position 60000 /tmp/panorama-position.json 1000
```

Keep recordings under 8 MB and 180 records. Imported JSON is never evaluated or rendered as HTML. Recordings contain only the selected provider's visible observations.

## Production hosting readiness

Serve `dist` over HTTPS. Configure SPA rewrites for `/`, `/map`, `/events`, `/settings` and car query parameters: unknown non-asset routes should return `/index.html` with status 200. Keep `/api/*` out of the app-shell fallback. Example Netlify rule: `/* /index.html 200`; on Nginx use `try_files $uri $uri/ /index.html`. The Vite dev/preview servers already handle these reloads. `public/_redirects` (Netlify/Cloudflare) and `vercel.json` (Vercel) ship the fallback. No public deployment has been performed. See [hosting](docs/hosting.md) for free public options (Netlify Drop, Cloudflare Pages, Vercel).

The service worker precaches only local essential assets. No timing transport is cached. Updates show an **Update now** action; no forced race-time reload. Browsers may suspend background execution; the simulator bounds catch-up work and a visible tab resynchronises before animation continues.

## Scope and limits

The 24 entries / 48 drivers are fictional. Lap pace, pit traversal, race-control scenarios and timing regions are synthetic. The 6.213 km / 161 lap configuration is event context, not evidence of real feed capabilities. Circuit centerline geometry is derived from OpenStreetMap, with its attribution and ODbL source bundled locally. Sector and service anchors are demo estimates, not surveyed timing loops. See [geometry attribution](docs/geometry-attribution.md). The scoring, safety-car and finish models are intentionally simplified and documented.

Real timing integration is live for public Natsoft feeds: the URL field validates the address, `wss://` works under HTTPS with no proxy, and only explicit timing URLs are ever opened (redirects revalidated, credentials rejected). A feed may expose classification only — that remains a valid mode with no invented car positions. Map markers from live data are coarse segment reports, never GPS. See [live integration](docs/live-integration.md).

Real iPhone/Android installation, wake-lock behaviour, long races on representative phones and browser-specific update UX still need device checks. Automated WebKit is not a Home Screen installation test. No background feed continuity, push notifications, official GPS, or full sporting regulations are claimed.

See [architecture](docs/architecture.md), [data contract](docs/data-contract.md), [demo scenarios](docs/demo-scenarios.md) and [verification](docs/verification.md).
