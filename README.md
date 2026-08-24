# Live Radio

A free, no-signup, no-backend internet radio player. Browse thousands of
stations by country, save favourites, and (optionally) load any other M3U/M3U8
playlist you like.

It's a static site — three files, no build step, no server, no API keys.

## Deploy to GitHub Pages

1. Create a new GitHub repo (public or private).
2. Add `index.html`, `styles.css`, and `app.js` to the repo root (or to a
   `/docs` folder — either works).
3. Push to GitHub.
4. In the repo, go to **Settings → Pages**, set **Source** to the branch/folder
   you used, and save.
5. GitHub gives you a URL like `https://<username>.github.io/<repo>/` — that's
   your live app. No secrets, no `.env`, nothing else to configure.

## Where the stations come from

Station data comes from [IPRD](https://iprd-org.github.io/iprd/), a free,
public directory of internet radio streams (~24,500 stations, ~225
countries), served as static JSON/M3U files with open CORS — so the browser
can fetch it directly, with nothing for you to sign up for or key in:

- `summary.json` — builds the country list in the sidebar (name, flag, count).
- `by_country/{code}.m3u` — fetched on demand, the first time you open a
  country tab (then cached in memory for the session).

Country names come from the browser's built-in `Intl.DisplayNames`, and flags
are generated from the ISO country code — no icon packs or geo APIs needed.

The **Channel Source** panel (icon next to the "Live Radio" title) lets
anyone load a different playlist on top of this: either IPRD's complete
`all_stations.m3u` catalog, or any other public M3U/M3U8 URL, parsed the same
way and shown under a "Custom" tab.

## HTTP-only streams

A minority of stations only serve `http://`, not `https://`. Browsers
(Chrome, Firefox, Safari — this is standardized behavior, not a quirk of one
browser) automatically try HTTPS first for any embedded `<audio>` source on
an HTTPS page, and **block it outright if that fails, with no fallback to
plain HTTP.** This is enforced at the browser's network layer specifically
so client-side JavaScript *can't* bypass it — so there is no code trick that
makes this "just work" invisibly for every visitor. There are two things
that genuinely do work:

**1. Deploy the included relay (recommended — fixes it for every visitor, no browser settings)**

`proxy-worker/worker.js` is a small [Cloudflare Worker](https://workers.cloudflare.com/)
that fetches the `http://` stream server-side and re-serves it over
`https://`, so the browser only ever sees a secure URL. It streams the audio
through without buffering, so it works for continuous live radio, not just
one-off files. Free tier, no credit card:

1. Go to the [Cloudflare dashboard](https://dash.cloudflare.com), sign up free if needed.
2. Workers & Pages → Create → Create Worker → give it any name → Deploy.
3. Click "Edit code", replace the placeholder with the full contents of
   `proxy-worker/worker.js`, then Deploy again.
4. Copy the worker's URL (e.g. `https://live-radio-relay.you.workers.dev`).
5. In `app.js`, set:
   ```js
   const STREAM_PROXY_BASE = 'https://live-radio-relay.you.workers.dev/?url=';
   ```
6. Redeploy the site. HTTP-only stations now play in-app automatically —
   the app tries the direct HTTPS-upgraded stream first, and only routes
   through the relay for the specific stations that actually need it.

Leaving `STREAM_PROXY_BASE` as `''` (the default) disables all of this —
nothing changes until you opt in.

**2. Or: allow insecure content in your own browser (zero setup, one visitor at a time)**

When a station fails for this reason, the app now shows an explanation plus
two options: "Open this stream directly" (opens the raw stream as a new
tab — visiting an insecure site directly isn't restricted the way embedding
one is, so this always works), and a collapsible note with the exact steps
to allow insecure content for this site in Chrome/Edge or Firefox (Safari
doesn't expose a per-site toggle for this). That only affects the browser
of whoever does it — it's not something a site can turn on for its visitors.

## HLS streams

A handful of stations serve `.m3u8` (HLS) streams rather than plain MP3/AAC.
Those are played through [hls.js](https://github.com/video-dev/hls.js)
(loaded from a public CDN, MIT-licensed, no key required). Safari plays HLS
natively and doesn't need it.

## Known limitations (inherent to a static, keyless setup)

- **HTTP-only streams**: see the dedicated section above — this is now
  handled with a real fix (optional relay) plus honest fallbacks, rather
  than silently failing.
- **"Check channels"** does a best-effort playability probe (load the stream
  briefly, see if it responds) for the channels currently on screen. It skips
  HLS streams (probing those needs a heavier check) and isn't a guarantee —
  some stations rate-limit rapid connects.
- **Favourites and last-viewed tab** are stored in the browser's
  `localStorage`, so they're per-device/per-browser, not synced anywhere.
- Station uptime is only as good as IPRD's own listing — dead links do exist
  in any public radio directory.

## Local preview

Just open `index.html` in a browser — no server needed for the app itself.
(Some browsers restrict `fetch()` from `file://` pages; if the country list
doesn't load, run any static file server, e.g. `python3 -m http.server`, and
open the printed `localhost` URL instead.)
