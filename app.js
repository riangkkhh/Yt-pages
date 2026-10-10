(() => {
  const CFG = window.CONFIG || {};
  const THUMB = CFG.THUMB || (id => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`);
  const READY_TIMEOUT = CFG.READY_TIMEOUT || 7000;   // ms to wait for the player of one video
  const CONCURRENCY = CFG.CONCURRENCY || 8;           // players checked at the same time
  const CACHE_MS = CFG.CACHE_MS != null ? CFG.CACHE_MS : 3600e3;  // remember results for an hour
  const EMBED_HOST = "https://www.youtube-nocookie.com";

  const $ = id => document.getElementById(id);
  const home = $("home"), grid = $("grid"), statusEl = $("status"), watch = $("watch");
  const frame = $("frame"), side = $("side"), wtitle = $("wtitle"), search = $("search");
  const BASE_TITLE = document.title;
  const ID_RE = /^#\/watch\/([A-Za-z0-9_-]{11})$/;

  let approved = [];   // verified videos, in original order
  let loading = true;
  let current = null;  // id of the video loaded in the player (playing or minimized)

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /* ---------- theme ---------- */
  const root = document.documentElement;
  try { const t = localStorage.getItem("theme"); if (t) root.dataset.theme = t; } catch (e) {}
  $("theme").addEventListener("click", () => {
    const dark = root.dataset.theme
      ? root.dataset.theme === "dark"
      : matchMedia("(prefers-color-scheme: dark)").matches;
    const next = dark ? "light" : "dark";
    root.dataset.theme = next;
    try { localStorage.setItem("theme", next); } catch (e) {}
  });

  /* ---------- verification (runs in the viewer's browser, i.e. behind their filter) ----------
     A video the filter blocks never gets its YouTube player ready (or the player reports an error).
     Only videos whose player becomes ready are shown. Any failure counts as blocked. */
  let ytLoading;
  function loadYT() {
    if (ytLoading) return ytLoading;
    ytLoading = new Promise((resolve, reject) => {
      if (window.YT && window.YT.Player) return resolve();
      const s = document.createElement("script");
      s.src = "https://www.youtube.com/iframe_api";
      s.onerror = () => reject(new Error("script"));
      window.onYouTubeIframeAPIReady = () => resolve();
      document.head.append(s);
      setTimeout(() => reject(new Error("timeout")), 10000);
    });
    return ytLoading;
  }

  function probe(id) {
    return new Promise(resolve => {
      const div = document.createElement("div");
      $("probe").append(div);
      let done = false, player, timer;
      const finish = ok => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try { player.destroy(); } catch (e) {}
        div.remove();
        resolve(ok);
      };
      timer = setTimeout(() => finish(false), READY_TIMEOUT);
      try {
        player = new YT.Player(div, {
          videoId: id, host: EMBED_HOST, width: 320, height: 180, playerVars: { playsinline: 1 },
          events: {
            // ready, then a short grace period for an error event (removed/private videos)
            onReady: () => { clearTimeout(timer); timer = setTimeout(() => finish(true), 1500); },
            onError: () => finish(false),
          },
        });
      } catch (e) { finish(false); }
    });
  }

  function loadImg(url) {
    return new Promise(resolve => {
      const img = new Image();
      const t = setTimeout(() => resolve(false), 12000);
      img.onload = () => { clearTimeout(t); resolve(true); };
      img.onerror = () => { clearTimeout(t); resolve(false); };
      img.src = url;
    });
  }

  const CACHE_KEY = "ytf-verify-v1";
  function readCache() { try { return JSON.parse(localStorage.getItem(CACHE_KEY) || "{}"); } catch (e) { return {}; } }
  function writeCache(c) { try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch (e) {} }

  async function verifyAll(list, onProgress) {
    const results = new Array(list.length).fill(null);
    const cache = readCache();
    const now = Date.now();
    let next = 0, scriptFailed = false;

    async function worker() {
      while (next < list.length) {
        const idx = next++;
        const v = list[idx];
        const hit = cache[v.id];
        let ok;
        if (hit && now - hit[1] < CACHE_MS) {
          ok = !!hit[0];
        } else {
          try {
            await loadYT();
            const [img, played] = await Promise.all([loadImg(THUMB(v.id)), probe(v.id)]);
            ok = img && played;
            cache[v.id] = [ok ? 1 : 0, Date.now()];
          } catch (e) {
            scriptFailed = true;   // could not verify: fail closed, and do not remember it
            ok = false;
          }
        }
        results[idx] = ok ? { id: v.id, title: v.title, src: THUMB(v.id) } : null;
        onProgress(results);
      }
    }

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, list.length) }, worker));

    const keep = {};
    for (const v of list) if (cache[v.id]) keep[v.id] = cache[v.id];
    writeCache(keep);
    return { results, scriptFailed };
  }

  /* ---------- rendering ---------- */
  function thumb(v) {
    const t = el("div", "thumb");
    const img = new Image();
    img.src = v.src;
    img.alt = "";
    img.loading = "lazy";
    t.append(img);
    return t;
  }

  function link(v) {
    const a = el("a");
    a.href = "#/watch/" + encodeURIComponent(v.id);
    return a;
  }

  function renderSkeleton() {
    grid.replaceChildren();
    statusEl.hidden = true;
    for (let i = 0; i < 12; i++) {
      const c = el("div", "card skel");
      c.append(el("div", "thumb"), el("div", "skel-line"), el("div", "skel-line short"));
      grid.append(c);
    }
  }

  function renderGrid(list) {
    if (!list.length && loading) { renderSkeleton(); return; }
    grid.replaceChildren();
    statusEl.hidden = list.length > 0;
    if (!list.length) statusEl.textContent = approved.length ? "לא נמצאו תוצאות" : "אין סרטונים זמינים כרגע";
    for (const v of list) {
      const a = link(v);
      a.className = "card";
      a.append(thumb(v), el("div", "title", v.title));
      grid.append(a);
    }
  }

  function applySearch() {
    const q = search.value.trim().toLowerCase();
    renderGrid(q ? approved.filter(v => v.title.toLowerCase().includes(q)) : approved);
  }

  function renderSide() {
    side.replaceChildren();
    const i = approved.findIndex(v => v.id === current);
    const ordered = approved.slice(i + 1).concat(approved.slice(0, Math.max(i, 0)));
    for (const v of ordered.slice(0, 40)) {
      const a = link(v);
      a.className = "side-item";
      const info = el("div", "info");
      info.append(el("div", "title", v.title));
      a.append(thumb(v), info);
      side.append(a);
    }
  }

  /* ---------- views ---------- */
  function showHome() {
    home.classList.remove("off");
    document.title = BASE_TITLE;
    watch.classList.remove("off");
    if (current) watch.classList.add("mini");   // keep playing in the corner
    else watch.classList.add("off");
  }

  function showWatch(id) {
    const v = approved.find(x => x.id === id);
    if (!v) return false;
    home.classList.add("off");
    watch.classList.remove("off", "mini");
    document.title = `${v.title} – ${BASE_TITLE}`;
    if (current !== id) {
      current = id;
      frame.src = `${EMBED_HOST}/embed/${encodeURIComponent(id)}?autoplay=1&rel=0`;
      wtitle.textContent = v.title;
      renderSide();
    }
    window.scrollTo(0, 0);
    return true;
  }

  function route() {
    const m = location.hash.match(ID_RE);
    if (!m) return showHome();
    if (showWatch(m[1])) return;
    if (!loading) location.replace("#/");   // not approved: never play it
  }

  function closePlayer() {
    frame.src = "about:blank";
    current = null;
    watch.classList.remove("mini");
    watch.classList.add("off");
  }

  /* ---------- events ---------- */
  window.addEventListener("hashchange", route);
  $("btnMini").addEventListener("click", () => { location.hash = "#/"; });
  $("miniClose").addEventListener("click", closePlayer);
  $("miniExpand").addEventListener("click", () => { if (current) location.hash = "#/watch/" + current; });
  $("btnCopy").addEventListener("click", async e => {
    const btn = e.currentTarget, old = btn.textContent;
    try { await navigator.clipboard.writeText(location.href); btn.textContent = "הקישור הועתק"; }
    catch (err) { btn.textContent = "ההעתקה נכשלה"; }
    setTimeout(() => { btn.textContent = old; }, 1500);
  });

  $("searchForm").addEventListener("submit", e => {
    e.preventDefault();
    if (location.hash !== "#/" && location.hash !== "") location.hash = "#/";
    applySearch();
  });
  search.addEventListener("input", () => {
    if (ID_RE.test(location.hash)) location.hash = "#/";
    applySearch();
  });

  /* ---------- start ---------- */
  renderSkeleton();
  let pendingWatch = (location.hash.match(ID_RE) || [])[1] || null;
  let renderTimer = null;

  fetch("videos.json", { cache: "no-cache" })
    .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(list => verifyAll(list, results => {
      // show videos as soon as they are verified (throttled)
      if (renderTimer) return;
      renderTimer = setTimeout(() => {
        renderTimer = null;
        approved = results.filter(Boolean);
        applySearch();
        if (pendingWatch && approved.some(v => v.id === pendingWatch)) { pendingWatch = null; route(); }
      }, 150);
    }))
    .then(({ results, scriptFailed }) => {
      clearTimeout(renderTimer);
      renderTimer = null;
      approved = results.filter(Boolean);
      loading = false;
      pendingWatch = null;
      if (scriptFailed && !approved.length) {
        grid.replaceChildren();
        statusEl.hidden = false;
        statusEl.textContent = "לא ניתן לאמת את הסרטונים כרגע";
        return;
      }
      applySearch();
      if (current) renderSide();
      route();
    })
    .catch(() => {
      loading = false;
      grid.replaceChildren();
      statusEl.hidden = false;
      statusEl.textContent = "שגיאה בטעינת הסרטונים";
    });
})();
