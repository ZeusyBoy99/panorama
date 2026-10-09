# Hosting Panorama publicly

The app is a static site: `npm run build` produces `dist/`, which is
everything a host needs. There is no server code, database or secret — live
timing opens straight from each visitor's browser to the Natsoft feed, so any
static host with HTTPS works.

Requirements (all covered below):

- Serve `dist/` over **HTTPS** (browsers require it for PWA install and for
  the `wss://` live feed from a secure page).
- **SPA fallback:** `/`, `/map`, `/events`, `/settings` (plus `?car=` and
  `?live` links) must all return `/index.html` with status 200. Without this,
  reloading or sharing those links gives a 404.
- The included `public/_redirects` (`/* /index.html 200`) is honoured by
  Netlify and Cloudflare Pages automatically; `vercel.json` does the same for
  Vercel.

## Easiest: Netlify Drop (no account setup, free)

1. Run `npm run build`.
2. Open <https://app.netlify.com/drop> and drag the `dist/` folder onto it.
3. You get a public `https://<name>.netlify.app` link instantly. It opens live timing by default when online; `?demo` opens the simulated demo instead. Share the bare link.

## Recommended: Cloudflare Pages (free, fast, stays free)

1. Push this folder to a GitHub repository.
2. Cloudflare dashboard → Pages → Create → Connect to Git → pick the repo.
3. Build command `npm run build`, output directory `dist`, Node 24.
4. Deploy → public `https://<project>.pages.dev`. Custom domains are free.

## Alternative: Vercel (free hobby)

1. `npx vercel` in this folder (or import the GitHub repo).
2. Defaults work; `vercel.json` already contains the SPA rewrite.
3. You get a public `https://<project>.vercel.app` link.

## Alternative: GitHub Pages (free, one wrinkle)

GitHub Pages serves a subpath (`https://<user>.github.io/<repo>/`), so set
`base: '/<repo>/'` in `vite.config.ts` plus matching manifest `start_url` /
`scope` before building, and add a `dist/404.html` copy of `index.html` as
the SPA fallback. Prefer one of the options above unless you already live on
GitHub Pages.

## Any server (Nginx example)

```nginx
root /var/www/panorama/dist;
location / { try_files $uri $uri/ /index.html; }
```

## After deploying

- Open the public link and confirm it connects on load (`LIVE — NATSOFT FEED` badge, live session name in the header); open it with `?demo` to check the simulated fallback.
- Install prompt, offline reload and the `Update now` flow only appear on
  the HTTPS production build, never on localhost.
