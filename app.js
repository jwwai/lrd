/* ============================================================
   Live Radio — app.js
   Zero-backend internet radio player.
   Data source: IPRD (https://iprd-org.github.io/iprd/) — free,
   public, no API key or account required.
   ============================================================ */
(() => {
  'use strict';

  /* ---------------- Config ---------------- */
  const IPRD_BASE = 'https://iprd-org.github.io/iprd/site_data/';
  const SUMMARY_URL = IPRD_BASE + 'summary.json';
  const ALL_STATIONS_URL = IPRD_BASE + 'all_stations.m3u';
  const countryM3U = (code) => `${IPRD_BASE}by_country/${code.toLowerCase()}.m3u`;

  const PINNED_CODES = ['IN', 'US']; // "Country List order: Fav, India, USA, ..."

  const LS_FAVS = 'liveradio.favs.v1';
  const LS_LAST_TAB = 'liveradio.lastTab.v1';
  const LS_VOLUME = 'liveradio.volume.v1';

  const TILE_COLORS = ['var(--tile-1)', 'var(--tile-2)', 'var(--tile-3)', 'var(--tile-4)', 'var(--tile-5)', 'var(--tile-6)', 'var(--tile-7)'];

  /* ---------------- DOM refs ---------------- */
  const $ = (id) => document.getElementById(id);
  const el = {
    favTab: $('favTab'), favCount: $('favCount'),
    countryList: $('countryList'),
    sourceBtn: $('sourceBtn'),
    grid: $('grid'), emptyState: $('emptyState'),
    channelsTitle: $('channelsTitle'), channelsCount: $('channelsCount'),
    searchInput: $('searchInput'), checkBtn: $('checkBtn'),
    audio: $('audio'),
    disc: $('disc'), discArt: $('discArt'),
    playFab: $('playFab'), iconPlay: $('iconPlay'), iconPause: $('iconPause'),
    playBtn: $('playBtn'), iconPlay2: $('iconPlay2'), iconPause2: $('iconPause2'),
    prevBtn: $('prevBtn'), nextBtn: $('nextBtn'), npFav: $('npFav'),
    npGenre: $('npGenre'), npName: $('npName'),
    npStatus: $('npStatus'), liveDot: $('liveDot'), npStatusText: $('npStatusText'),
    muteBtn: $('muteBtn'), volumeSlider: $('volumeSlider'),
    castBtn: $('castBtn'), castMenu: $('castMenu'),
    sourceBackdrop: $('sourceBackdrop'), sourceSelect: $('sourceSelect'),
    customUrlWrap: $('customUrlWrap'), customUrlInput: $('customUrlInput'),
    modalError: $('modalError'), sourceCancel: $('sourceCancel'), sourceLoad: $('sourceLoad'),
    toast: $('toast'),
  };

  /* ---------------- State ---------------- */
  const state = {
    countries: [],              // [{code,name,count}]
    countryCache: new Map(),    // code -> stations[]
    favorites: loadFavorites(), // Map(url -> station)
    currentTab: null,           // 'FAV' | ISO code | 'CUSTOM'
    customLabel: '',
    activeList: [],             // full list for current tab (grid renders every filtered station — no pagination)
    searchTerm: '',
    playingUrl: null,
    hls: null,
    checking: false,
  };

  /* ---------------- Utilities ---------------- */
  function toast(msg, ms = 3200) {
    el.toast.textContent = msg;
    el.toast.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.toast.hidden = true; }, ms);
  }

  function flagEmoji(code) {
    if (!code || code.length !== 2) return '🌐';
    const A = 127397;
    return String.fromCodePoint(...[...code.toUpperCase()].map(c => A + c.charCodeAt(0)));
  }

  const nameFormatter = (() => {
    try { return new Intl.DisplayNames(['en'], { type: 'region' }); }
    catch { return null; }
  })();
  function countryName(code) {
    if (!nameFormatter) return code;
    try { return nameFormatter.of(code) || code; } catch { return code; }
  }

  function hashStr(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; }
    return Math.abs(h);
  }

  function tileColorFor(name) { return TILE_COLORS[hashStr(name) % TILE_COLORS.length]; }

  function httpsify(url) {
    if (location.protocol === 'https:' && url.startsWith('http://')) {
      return 'https://' + url.slice(7);
    }
    return url;
  }

  function debounce(fn, wait) {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), wait); };
  }

  function stationKey(s) { return s.url; }

  /* ---------------- Favorites (localStorage) ---------------- */
  function loadFavorites() {
    const map = new Map();
    try {
      const raw = JSON.parse(localStorage.getItem(LS_FAVS) || '[]');
      raw.forEach(s => map.set(s.url, s));
    } catch { /* ignore corrupt storage */ }
    return map;
  }
  function saveFavorites() {
    try { localStorage.setItem(LS_FAVS, JSON.stringify([...state.favorites.values()])); }
    catch { /* storage may be unavailable (private mode / quota) */ }
  }
  function isFav(station) { return state.favorites.has(stationKey(station)); }
  function toggleFav(station) {
    const key = stationKey(station);
    if (state.favorites.has(key)) state.favorites.delete(key);
    else state.favorites.set(key, station);
    saveFavorites();
    el.favCount.textContent = state.favorites.size;
    refreshFavVisuals();
    if (state.currentTab === 'FAV') renderActiveList();
  }
  function refreshFavVisuals() {
    document.querySelectorAll('.tile-fav').forEach(btn => {
      const on = btn.dataset.url && state.favorites.has(btn.dataset.url);
      btn.classList.toggle('active', !!on);
    });
    if (currentStation()) {
      el.npFav.classList.toggle('active', isFav(currentStation()));
    }
  }

  /* ---------------- M3U parsing ---------------- */
  // Parses standard extended M3U: #EXTINF:-1 tvg-logo="..." group-title="...",Name \n URL
  function parseM3U(text) {
    const lines = text.split(/\r?\n/);
    const stations = [];
    let pending = null;
    for (let raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith('#EXTINF')) {
        const logoMatch = line.match(/tvg-logo="([^"]*)"/i);
        const groupMatch = line.match(/group-title="([^"]*)"/i);
        const nameMatch = line.match(/,(.*)$/);
        pending = {
          logo: logoMatch ? logoMatch[1] : '',
          genre: groupMatch ? groupMatch[1].split(';')[0] : '',
          name: nameMatch ? nameMatch[1].trim() : 'Unknown station',
        };
      } else if (line.startsWith('#')) {
        continue; // other metadata tags, ignored
      } else {
        // stream URL line
        if (!pending) pending = { logo: '', genre: '', name: 'Unknown station' };
        stations.push({
          name: pending.name || 'Unknown station',
          logo: pending.logo,
          genre: pending.genre,
          url: httpsify(line),
        });
        pending = null;
      }
    }
    return stations;
  }

  async function fetchM3U(url) {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    return parseM3U(text);
  }

  /* ---------------- Sidebar / countries ---------------- */
  async function loadSummary() {
    try {
      const res = await fetch(SUMMARY_URL, { mode: 'cors' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const list = (data.countries || [])
        .filter(c => c.code && c.code.length === 2)
        .map(c => ({ code: c.code, name: countryName(c.code), count: c.count }));

      const pinned = PINNED_CODES
        .map(code => list.find(c => c.code === code))
        .filter(Boolean);
      const rest = list
        .filter(c => !PINNED_CODES.includes(c.code))
        .sort((a, b) => b.count - a.count);

      state.countries = [...pinned, ...rest];
      renderSidebar();

      const lastTab = localStorage.getItem(LS_LAST_TAB);
      const startCode = (lastTab && (lastTab === 'FAV' || state.countries.some(c => c.code === lastTab)))
        ? lastTab
        : (state.countries[0] ? state.countries[0].code : 'FAV');
      selectTab(startCode);
    } catch (err) {
      console.error('Failed to load country list', err);
      el.countryList.innerHTML = '';
      const msg = document.createElement('p');
      msg.className = 'empty-state';
      msg.style.padding = '10px 4px';
      msg.textContent = 'Could not load the country list. Check your connection and reload.';
      el.countryList.appendChild(msg);
      toast('Could not reach the station directory.');
    }
  }

  function renderSidebar() {
    el.countryList.innerHTML = '';
    state.countries.forEach(c => {
      const row = document.createElement('button');
      row.className = 'country-row' + (PINNED_CODES.includes(c.code) ? ' pinned' : '');
      row.dataset.code = c.code;
      row.setAttribute('role', 'listitem');
      row.title = `${c.name} — ${c.count} stations`;
      row.innerHTML = `
        <span class="flag">${flagEmoji(c.code)}</span>
        <span class="cname">${c.name}</span>
        <span class="ccount">${c.count}</span>`;
      row.addEventListener('click', () => selectTab(c.code));
      el.countryList.appendChild(row);
    });
  }

  function markActiveTab() {
    el.favTab.classList.toggle('active', state.currentTab === 'FAV');
    el.countryList.querySelectorAll('.country-row').forEach(row => {
      row.classList.toggle('active', row.dataset.code === state.currentTab);
    });
  }

  /* ---------------- Tab / list selection ---------------- */
  async function selectTab(code) {
    state.currentTab = code;
    state.searchTerm = '';
    el.searchInput.value = '';
    markActiveTab();
    try { localStorage.setItem(LS_LAST_TAB, code); } catch { /* ignore */ }

    if (code === 'FAV') {
      el.channelsTitle.textContent = 'Favourites';
      state.activeList = [...state.favorites.values()];
      renderActiveList();
      return;
    }

    if (code === 'CUSTOM') {
      el.channelsTitle.textContent = state.customLabel || 'Custom playlist';
      state.activeList = state.countryCache.get('CUSTOM') || [];
      renderActiveList();
      return;
    }

    const meta = state.countries.find(c => c.code === code);
    el.channelsTitle.textContent = meta ? `${flagEmoji(code)} ${meta.name}` : code;
    el.channelsCount.textContent = '';
    el.grid.innerHTML = '';
    el.emptyState.hidden = true;

    if (state.countryCache.has(code)) {
      state.activeList = state.countryCache.get(code);
      renderActiveList();
      return;
    }

    el.channelsCount.textContent = 'Loading…';
    try {
      const stations = await fetchM3U(countryM3U(code));
      stations.forEach(s => { s.country = code; });
      state.countryCache.set(code, stations);
      if (state.currentTab !== code) return; // user navigated away meanwhile
      state.activeList = stations;
      renderActiveList();
    } catch (err) {
      console.error('Failed to load country playlist', err);
      if (state.currentTab !== code) return;
      el.channelsCount.textContent = '';
      el.grid.innerHTML = '';
      el.emptyState.hidden = false;
      el.emptyState.textContent = 'Could not load channels for this country. Try again in a moment.';
      toast(`Couldn't load stations for ${meta ? meta.name : code}.`);
    }
  }

  function filteredList() {
    const term = state.searchTerm.trim().toLowerCase();
    if (!term) return state.activeList;
    return state.activeList.filter(s =>
      s.name.toLowerCase().includes(term) || (s.genre || '').toLowerCase().includes(term)
    );
  }

  function renderActiveList() {
    const list = filteredList();
    el.channelsCount.textContent = list.length ? `${list.length} station${list.length === 1 ? '' : 's'}` : '';
    el.grid.innerHTML = '';

    if (!list.length) {
      el.emptyState.hidden = false;
      el.emptyState.textContent = state.currentTab === 'FAV'
        ? 'No favourites yet — tap the heart on any channel to save it here.'
        : 'No channels here yet. Try another search or country.';
      return;
    }
    el.emptyState.hidden = true;

    const frag = document.createDocumentFragment();
    list.forEach(s => frag.appendChild(makeTile(s)));
    el.grid.appendChild(frag);
  }

  function makeTile(station) {
    const tile = document.createElement('button');
    tile.className = 'tile';
    tile.setAttribute('role', 'listitem');
    if (station.url === state.playingUrl) tile.classList.add('playing');

    const initial = (station.name || '?').trim().charAt(0).toUpperCase() || '?';
    const color = tileColorFor(station.name || station.url);

    const logo = document.createElement('div');
    logo.className = 'tile-logo';
    logo.style.background = color;
    logo.textContent = initial;
    if (station.logo) {
      const img = document.createElement('img');
      img.src = station.logo;
      img.alt = '';
      img.loading = 'lazy';
      img.referrerPolicy = 'no-referrer';
      img.onerror = () => img.remove();
      logo.appendChild(img);
    }

    const favBtn = document.createElement('button');
    favBtn.className = 'tile-fav' + (isFav(station) ? ' active' : '');
    favBtn.dataset.url = station.url;
    favBtn.title = 'Toggle favourite';
    favBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none"><path d="M12 20.5s-7.6-4.6-10-9.4C.4 7.7 2.4 4 6.1 4c2 0 3.6 1.1 4.4 2.8C11.3 5.1 13 4 15 4c3.6 0 5.7 3.7 4 7.1-2.4 4.8-10 9.4-10 9.4z" stroke="currentColor" stroke-width="1.8"/></svg>`;
    favBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleFav(station); });

    const name = document.createElement('div');
    name.className = 'tile-name';
    name.textContent = station.name;

    const genre = document.createElement('div');
    genre.className = 'tile-genre';
    genre.textContent = station.genre || '\u00A0';

    const status = document.createElement('div');
    status.className = 'tile-status';
    status.dataset.role = 'status';
    if (station.url === state.playingUrl) {
      status.classList.add('playing-badge');
      status.innerHTML = `<span class="dot"></span><span>Now playing</span>`;
    } else {
      status.innerHTML = `<span class="dot"></span><span>Tap to play</span>`;
    }

    tile.append(logo, favBtn, name, genre, status);
    tile.addEventListener('click', () => playStation(station));
    return tile;
  }

  /* ---------------- Player ---------------- */
  function currentStation() {
    if (!state.playingUrl) return null;
    return filteredList().find(s => s.url === state.playingUrl)
      || state.activeList.find(s => s.url === state.playingUrl)
      || null;
  }

  function destroyHls() {
    if (state.hls) { try { state.hls.destroy(); } catch { /* ignore */ } state.hls = null; }
  }

  function setStatus(mode, text) {
    el.npStatus.classList.remove('live', 'buffering', 'err');
    if (mode) el.npStatus.classList.add(mode);
    el.npStatusText.textContent = text;
  }

  function setPlayIcon(isPlaying) {
    el.iconPlay.hidden = isPlaying; el.iconPause.hidden = !isPlaying;
    el.iconPlay2.hidden = isPlaying; el.iconPause2.hidden = !isPlaying;
    el.disc.classList.toggle('spinning', isPlaying);
  }

  // Some directory entries point at a .pls/.m3u *wrapper* file rather than
  // the raw stream (VLC follows this transparently; <audio> can't). If the
  // URL literally ends in one of those extensions, resolve it to the real
  // stream URL first. Anything else — including the actual audio stream
  // itself, which never ends in .pls/.m3u — is left untouched so we never
  // try to read an infinite live stream as text.
  async function resolvePlaylistUrl(url) {
    if (!/\.(pls|m3u)(\?|$)/i.test(url)) return url;
    try {
      const res = await fetch(url, { mode: 'cors' });
      if (!res.ok) return url;
      const text = await res.text();
      const plsMatch = text.match(/^\s*File\d*\s*=\s*(\S+)/im);
      if (plsMatch) return httpsify(plsMatch[1].trim());
      const line = text.split(/\r?\n/).map(l => l.trim())
        .find(l => l && !l.startsWith('#') && /^https?:\/\//i.test(l));
      if (line) return httpsify(line);
    } catch { /* network/CORS failure on the wrapper — fall through and let normal playback error handling take over */ }
    return url;
  }

  async function playStation(station) {
    if (!station || !station.url) return;
    destroyHls();
    state.playingUrl = station.url;

    el.npGenre.textContent = station.genre || 'Live radio';
    el.npName.textContent = station.name;
    el.npName.title = station.name;
    el.npFav.classList.toggle('active', isFav(station));
    el.discArt.style.background = station.logo ? '' : tileColorFor(station.name || station.url);
    el.discArt.style.backgroundImage = station.logo ? `url("${station.logo}")` : 'none';
    el.discArt.textContent = station.logo ? '' : (station.name || '?').trim().charAt(0).toUpperCase();

    setStatus('buffering', 'Connecting…');
    setPlayIcon(false);
    renderActiveList();

    const requestedUrl = station.url;
    const url = await resolvePlaylistUrl(requestedUrl);
    if (state.playingUrl !== requestedUrl) return; // user picked something else while this resolved

    const isHls = /\.m3u8($|\?)/i.test(url);

    if (isHls && window.Hls && window.Hls.isSupported()) {
      const hls = new window.Hls({ enableWorker: true });
      state.hls = hls;
      hls.on(window.Hls.Events.ERROR, (_evt, data) => {
        if (data && data.fatal) {
          setStatus('err', 'Stream unavailable');
          toast(`Couldn't play "${station.name}" — the stream may be offline.`);
        }
      });
      hls.loadSource(url);
      hls.attachMedia(el.audio);
    } else if (window.Hls && el.audio.canPlayType && !el.audio.canPlayType('application/vnd.apple.mpegurl') && isHls) {
      // HLS requested but neither hls.js nor native support is available.
      setStatus('err', 'Format unsupported');
      toast(`Couldn't play "${station.name}" — this browser can't decode HLS streams.`);
      return;
    } else {
      el.audio.src = url;
    }

    el.audio.play().catch(() => {
      // Autoplay was blocked or the stream failed; UI reflects via audio events.
    });
  }

  function togglePlayPause() {
    if (!state.playingUrl) {
      const first = filteredList()[0];
      if (first) playStation(first);
      return;
    }
    if (el.audio.paused) el.audio.play().catch(() => {});
    else el.audio.pause();
  }

  function stepStation(dir) {
    const list = filteredList().length ? filteredList() : state.activeList;
    if (!list.length) return;
    const idx = list.findIndex(s => s.url === state.playingUrl);
    const next = idx === -1 ? 0 : (idx + dir + list.length) % list.length;
    playStation(list[next]);
  }

  el.audio.addEventListener('playing', () => { setStatus('live', 'On air'); setPlayIcon(true); });
  el.audio.addEventListener('waiting', () => { setStatus('buffering', 'Buffering…'); });
  el.audio.addEventListener('pause', () => { setPlayIcon(false); if (!el.audio.ended) setStatus(null, 'Paused'); });
  el.audio.addEventListener('error', () => {
    setStatus('err', 'Stream unavailable');
    setPlayIcon(false);
    const st = currentStation();
    if (st) toast(`Couldn't play "${st.name}" — the stream may be offline or blocked.`);
  });

  /* ---------------- Check channels ---------------- */
  async function probeStream(url, timeoutMs = 6000) {
    if (/\.m3u8($|\?)/i.test(url)) return 'unknown'; // HLS probing needs hls.js; skip for speed
    const resolved = await resolvePlaylistUrl(url);
    if (/\.m3u8($|\?)/i.test(resolved)) return 'unknown'; // wrapper resolved to an HLS stream
    return new Promise((resolve) => {
      const a = new Audio();
      a.preload = 'none';
      let done = false;
      const finish = (ok) => {
        if (done) return;
        done = true;
        a.src = '';
        resolve(ok ? 'online' : 'offline');
      };
      const t = setTimeout(() => finish(false), timeoutMs);
      a.addEventListener('canplay', () => { clearTimeout(t); finish(true); }, { once: true });
      a.addEventListener('loadedmetadata', () => { clearTimeout(t); finish(true); }, { once: true });
      a.addEventListener('error', () => { clearTimeout(t); finish(false); }, { once: true });
      try { a.src = resolved; a.load(); } catch { clearTimeout(t); finish(false); }
    });
  }

  async function checkChannels() {
    if (state.checking) return;
    const full = filteredList();
    if (!full.length) return;
    const CAP = 200;
    const list = full.slice(0, CAP);
    state.checking = true;
    el.checkBtn.classList.add('busy');

    const CONCURRENCY = 6;
    let i = 0;
    async function worker() {
      while (i < list.length) {
        const station = list[i++];
        const result = await probeStream(station.url);
        const node = [...el.grid.children].find(t =>
          t.querySelector('.tile-fav')?.dataset.url === station.url
        );
        if (node && station.url !== state.playingUrl) {
          const status = node.querySelector('[data-role="status"]');
          if (status && result !== 'unknown') {
            status.classList.remove('online', 'offline');
            status.classList.add(result);
            status.innerHTML = `<span class="dot"></span><span>${result === 'online' ? 'Online' : 'Offline'}</span>`;
          }
        }
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    state.checking = false;
    el.checkBtn.classList.remove('busy');
    toast(full.length > CAP
      ? `Checked the first ${CAP} of ${full.length} channels — search to narrow it down and check the rest.`
      : 'Finished checking channels.');
  }

  /* ---------------- Channel Source modal ---------------- */
  function openModal() { el.sourceBackdrop.hidden = false; el.modalError.hidden = true; }
  function closeModal() { el.sourceBackdrop.hidden = true; }

  el.sourceSelect.addEventListener('change', () => {
    el.customUrlWrap.hidden = el.sourceSelect.value !== 'custom';
  });

  async function handleLoadSource() {
    el.modalError.hidden = true;
    if (el.sourceSelect.value === 'default') {
      // Re-point to the full IPRD catalog as one flat browsable tab.
      el.sourceLoad.disabled = true;
      el.sourceLoad.textContent = 'Loading…';
      try {
        const stations = await fetchM3U(ALL_STATIONS_URL);
        state.countryCache.set('CUSTOM', stations);
        state.customLabel = 'All IPRD stations';
        closeModal();
        selectTab('CUSTOM');
      } catch (err) {
        el.modalError.textContent = 'Could not load the default catalog. Please try again.';
        el.modalError.hidden = false;
      } finally {
        el.sourceLoad.disabled = false;
        el.sourceLoad.textContent = 'Load';
      }
      return;
    }

    const url = el.customUrlInput.value.trim();
    if (!url) { el.modalError.textContent = 'Enter a playlist URL first.'; el.modalError.hidden = false; return; }
    let parsed;
    try { parsed = new URL(url); if (!/^https?:$/.test(parsed.protocol)) throw new Error(); }
    catch { el.modalError.textContent = 'That doesn\u2019t look like a valid http(s) URL.'; el.modalError.hidden = false; return; }

    el.sourceLoad.disabled = true;
    el.sourceLoad.textContent = 'Loading…';
    try {
      const stations = await fetchM3U(url);
      if (!stations.length) throw new Error('empty');
      state.countryCache.set('CUSTOM', stations);
      state.customLabel = parsed.hostname;
      closeModal();
      selectTab('CUSTOM');
    } catch (err) {
      el.modalError.textContent = 'Couldn\u2019t load that playlist — check the URL or the source\u2019s CORS policy.';
      el.modalError.hidden = false;
    } finally {
      el.sourceLoad.disabled = false;
      el.sourceLoad.textContent = 'Load';
    }
  }

  /* ---------------- Wire up events ---------------- */
  el.favTab.addEventListener('click', () => selectTab('FAV'));
  el.sourceBtn.addEventListener('click', () => { closeCastMenu(); openModal(); });
  el.sourceCancel.addEventListener('click', closeModal);
  el.sourceBackdrop.addEventListener('click', (e) => { if (e.target === el.sourceBackdrop) closeModal(); });
  el.sourceLoad.addEventListener('click', handleLoadSource);

  el.searchInput.addEventListener('input', debounce((e) => {
    state.searchTerm = e.target.value;
    renderActiveList();
  }, 180));

  el.checkBtn.addEventListener('click', checkChannels);

  el.playFab.addEventListener('click', togglePlayPause);
  el.playBtn.addEventListener('click', togglePlayPause);
  el.prevBtn.addEventListener('click', () => stepStation(-1));
  el.nextBtn.addEventListener('click', () => stepStation(1));
  el.npFav.addEventListener('click', () => { const s = currentStation(); if (s) toggleFav(s); });

  /* ---------------- Audio: linked mute + volume ---------------- */
  let lastVolume = 0.8;

  function volumeIcon(level) {
    if (level === 'muted') {
      return '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 9v6h4l5 5V4L8 9z"/><path d="M16.3 8.3l5.4 5.4M21.7 8.3l-5.4 5.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
    }
    if (level === 'low') {
      return '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 9v6h4l5 5V4L8 9z"/><path d="M15.5 10a3 3 0 0 1 0 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/></svg>';
    }
    return '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 9v6h4l5 5V4L8 9z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.2 6a8.5 8.5 0 0 1 0 12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/></svg>';
  }

  function updateVolumeUI() {
    const effective = el.audio.muted ? 0 : el.audio.volume;
    const level = effective === 0 ? 'muted' : (effective < 0.5 ? 'low' : 'high');
    el.muteBtn.innerHTML = volumeIcon(level);
    el.muteBtn.classList.toggle('muted', level === 'muted');
    el.muteBtn.setAttribute('aria-label', level === 'muted' ? 'Unmute' : 'Mute');
    el.muteBtn.title = level === 'muted' ? 'Unmute' : 'Mute';
    el.volumeSlider.value = Math.round(effective * 100);
  }

  function persistVolume() {
    try { localStorage.setItem(LS_VOLUME, String(Math.round((el.audio.muted ? 0 : el.audio.volume) * 100))); }
    catch { /* ignore */ }
  }

  el.muteBtn.addEventListener('click', () => {
    if (el.audio.muted || el.audio.volume === 0) {
      el.audio.muted = false;
      el.audio.volume = lastVolume > 0 ? lastVolume : 0.8;
    } else {
      lastVolume = el.audio.volume;
      el.audio.muted = true;
    }
    updateVolumeUI();
    persistVolume();
  });

  el.volumeSlider.addEventListener('input', (e) => {
    const v = Number(e.target.value) / 100;
    el.audio.muted = false;
    el.audio.volume = v;
    if (v > 0) lastVolume = v;
    updateVolumeUI();
    persistVolume();
  });

  /* ---------------- Cast (AirPlay / Remote Playback / output device) ---------------- */
  function castOption(title, sub) {
    const btn = document.createElement('button');
    btn.className = 'cast-option';
    btn.setAttribute('role', 'menuitem');
    const t = document.createElement('span');
    t.textContent = title;
    btn.appendChild(t);
    if (sub) {
      const s = document.createElement('small');
      s.textContent = sub;
      btn.appendChild(s);
    }
    return btn;
  }

  function closeCastMenu() {
    el.castMenu.hidden = true;
    el.castBtn.setAttribute('aria-expanded', 'false');
  }

  async function buildCastMenu() {
    el.castMenu.innerHTML = '';
    const title = document.createElement('p');
    title.className = 'cast-title';
    title.textContent = 'Cast audio to';
    el.castMenu.appendChild(title);
    let any = false;

    // Apple devices — AirPlay, via Safari/WebKit's native target picker.
    if (typeof el.audio.webkitShowPlaybackTargetPicker === 'function') {
      any = true;
      const btn = castOption('AirPlay', 'Apple TV, HomePod, AirPlay speakers');
      btn.addEventListener('click', () => {
        closeCastMenu();
        try { el.audio.webkitShowPlaybackTargetPicker(); }
        catch { toast('AirPlay is unavailable right now.'); }
      });
      el.castMenu.appendChild(btn);
    }

    // Chromecast / smart TVs — standard Remote Playback API (Chrome/Android, WiFi).
    if ('remote' in el.audio) {
      any = true;
      const btn = castOption('Cast device', 'Chromecast & smart TVs on this network');
      btn.addEventListener('click', async () => {
        closeCastMenu();
        try { await el.audio.remote.prompt(); }
        catch { toast('No cast devices found on this network.'); }
      });
      el.castMenu.appendChild(btn);
    }

    // Already-paired outputs (Bluetooth speakers/headphones, wired, etc.) via the Audio Output Devices API.
    if (navigator.mediaDevices && typeof el.audio.setSinkId === 'function') {
      try {
        const devices = (await navigator.mediaDevices.enumerateDevices())
          .filter(d => d.kind === 'audiooutput' && d.deviceId !== 'default');
        if (devices.length) {
          any = true;
          const sub = document.createElement('p');
          sub.className = 'cast-subtitle';
          sub.textContent = 'Play through';
          el.castMenu.appendChild(sub);
          devices.forEach((d, i) => {
            const btn = castOption(d.label || `Speaker ${i + 1}`, '');
            btn.addEventListener('click', async () => {
              closeCastMenu();
              try { await el.audio.setSinkId(d.deviceId); toast(`Playing through ${d.label || 'selected device'}.`); }
              catch { toast('Couldn\u2019t switch to that output.'); }
            });
            el.castMenu.appendChild(btn);
          });
        }
      } catch { /* device labels can be withheld until a permission grant exists — safe to skip */ }
    }

    const note = document.createElement('p');
    note.className = 'cast-note';
    note.textContent = any
      ? 'Bluetooth speakers already connected in your device settings are used automatically.'
      : 'This browser doesn\u2019t expose a cast API. On iPhone/iPad, use Control Center \u2192 AirPlay. On Android, use the Cast tile in quick settings. Bluetooth speakers work automatically once paired.';
    el.castMenu.appendChild(note);
  }

  function openCastMenu() {
    buildCastMenu();
    el.castMenu.hidden = false;
    el.castBtn.setAttribute('aria-expanded', 'true');
  }

  el.castBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (el.castMenu.hidden) openCastMenu(); else closeCastMenu();
  });
  document.addEventListener('click', (e) => {
    if (!el.castMenu.hidden && !el.castMenu.contains(e.target) && e.target !== el.castBtn) closeCastMenu();
  });

  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (e.code === 'Space') { e.preventDefault(); togglePlayPause(); }
    if (e.key === 'Escape') { if (!el.sourceBackdrop.hidden) closeModal(); if (!el.castMenu.hidden) closeCastMenu(); }
  });

  /* ---------------- Init ---------------- */
  (function init() {
    el.favCount.textContent = state.favorites.size;
    const savedVol = localStorage.getItem(LS_VOLUME);
    const startPct = savedVol !== null ? Math.max(0, Math.min(100, Number(savedVol))) : 80;
    el.audio.volume = startPct / 100;
    lastVolume = startPct > 0 ? startPct / 100 : 0.8;
    updateVolumeUI();
    loadSummary();
  })();
})();
