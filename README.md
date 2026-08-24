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

## HLS streams

A handful of stations serve `.m3u8` (HLS) streams rather than plain MP3/AAC.
Those are played through [hls.js](https://github.com/video-dev/hls.js)
(loaded from a public CDN, MIT-licensed, no key required). Safari plays HLS
natively and doesn't need it.

## Known limitations (inherent to a static, keyless setup)

- **Mixed content**: GitHub Pages serves over HTTPS, and browsers block plain
  `http://` streams on an HTTPS page. The app auto-upgrades `http://` stream
  URLs to `https://`, which fixes most cases, but a station whose stream
  truly has no HTTPS endpoint will fail to play. There's no way around this
  without running a proxy server, which would defeat the "no backend" goal.
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
