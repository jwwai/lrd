/**
 * Live Radio — optional HTTPS relay worker.
 *
 * Browsers refuse to load a plain http:// audio stream on an https:// page
 * (mixed content) — this is enforced by the browser itself and can't be
 * worked around with client-side JavaScript. The only real fix is to have
 * something fetch the http:// stream on the server side and re-serve the
 * bytes over https:// instead. That's all this file does.
 *
 * It streams the response straight through (no buffering), so it works for
 * continuous, infinite radio streams, not just one-off files — and it stays
 * on Cloudflare's free tier (no credit card required).
 *
 * ---- Deploy (about 2 minutes, one-time) ----
 * 1. Go to https://dash.cloudflare.com → sign up free if you don't have an
 *    account (email + password, no card).
 * 2. Workers & Pages → Create → Create Worker.
 * 3. Give it any name, e.g. "live-radio-relay" → Deploy.
 * 4. Click "Edit code", delete the placeholder, paste in this whole file,
 *    then Deploy again.
 * 5. Copy the worker's URL, e.g. https://live-radio-relay.YOUR-NAME.workers.dev
 * 6. In app.js, set STREAM_PROXY_BASE to that URL + "/?url=", e.g.:
 *      const STREAM_PROXY_BASE = 'https://live-radio-relay.YOUR-NAME.workers.dev/?url=';
 * 7. Redeploy the site. HTTP-only stations will now play in-app for every
 *    visitor automatically, with no browser settings to change.
 *
 * Leaving STREAM_PROXY_BASE as an empty string (the default) disables all of
 * this — the app behaves exactly as it did before you deploy a worker.
 */

// Restrict who can use this relay, if you want. '*' allows any site to call
// it — fine for personal use, since it only relays audio, nothing sensitive.
const ALLOWED_ORIGIN = '*';

export default {
  async fetch(request) {
    const reqUrl = new URL(request.url);
    const target = reqUrl.searchParams.get('url');

    if (!target) {
      return new Response('Live Radio relay is running. Pass a stream with ?url=', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      });
    }

    let targetUrl;
    try {
      targetUrl = new URL(target);
    } catch {
      return new Response('Invalid url parameter', { status: 400 });
    }
    if (!/^https?:$/.test(targetUrl.protocol)) {
      return new Response('Only http/https URLs are allowed', { status: 400 });
    }

    let upstream;
    try {
      upstream = await fetch(targetUrl.toString(), {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; LiveRadioRelay/1.0)',
          // Icecast/Shoutcast servers use this to decide whether to inject
          // ICY metadata into the stream; we don't want that mixed into
          // the audio bytes, so explicitly ask for none.
          'Icy-MetaData': '0',
        },
        cf: { cacheTtl: 0 },
      });
    } catch {
      return new Response('Could not reach the upstream stream', { status: 502 });
    }

    const headers = new Headers(upstream.headers);
    headers.set('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
    headers.delete('content-security-policy');
    headers.delete('x-frame-options');

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
  },
};
