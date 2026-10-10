(() => {
  const { BLOCK_SIZES, THUMB } = window.CONFIG;
  const $ = id => document.getElementById(id);
  const home = $("home"), grid = $("grid"), statusEl = $("status"), watch = $("watch");
  const frame = $("frame"), side = $("side"), wtitle = $("wtitle"), search = $("search");
  const BASE_TITLE = document.title;
  const ID_RE = /^#\/watch\/([A-Za-z0-9_-]{11})$/;

  let approved = [];   // videos that passed the block check, in original order
  let loaded = false;
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

  /* ---------- thumbnail check (runs in the viewer's browser, i.e. behind their filter) ---------- */
  function loadImg(url) {
    return new Promise(resolve => {
      const img = new Image();
      const timer = setTimeout(() => resolve(null), 12000);
      img.onload = () => { clearTimeout(timer); resolve(img); };
      img.onerror = () => { clearTimeout(timer); resolve(null); };
      img.src = url;
    });
  }

  // A real video returns thumbnails of different sizes (480x360 and 320x180).
  // A filter's block image is one fixed picture, so both URLs come back with the same size.
  // Fail closed: any failure to load counts as blocked.
  async function checkThumb(v) {
    const hqUrl = THUMB(v.id);
    const [hq, mq] = await Promise.all([loadImg(hqUrl), loadImg(hqUrl.replace("hqdefault", "mqdefault"))]);
    if (!hq || !mq) return null;
    if (hq.naturalWidth === mq.naturalWidth && hq.naturalHeight === mq.naturalHeight) return null;
    if (BLOCK_SIZES.some(([w, h]) => hq.naturalWidth === w && hq.naturalHeight === h)) return null;
    return { id: v.id, title: v.title, src: hq.src };
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

  function renderGrid(list) {
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

  function renderSkeleton() {
    grid.replaceChildren();
    for (let i = 0; i < 12; i++) {
      const c = el("div", "card skel");
      c.append(el("div", "thumb"), el("div", "skel-line"), el("div", "skel-line short"));
      grid.append(c);
    }
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
    if (!v) { location.replace("#/"); return; }   // only approved videos can be played
    home.classList.add("off");
    watch.classList.remove("off", "mini");
    if (current !== id) {
      current = id;
      frame.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1&rel=0`;
      wtitle.textContent = v.title;
      document.title = `${v.title} – ${BASE_TITLE}`;
      renderSide();
    } else {
      document.title = `${v.title} – ${BASE_TITLE}`;
    }
    window.scrollTo(0, 0);
  }

  function route() {
    if (!loaded) return;
    const m = location.hash.match(ID_RE);
    if (m) showWatch(m[1]); else showHome();
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

  function applySearch() {
    const q = search.value.trim().toLowerCase();
    renderGrid(q ? approved.filter(v => v.title.toLowerCase().includes(q)) : approved);
  }
  $("searchForm").addEventListener("submit", e => {
    e.preventDefault();
    if (location.hash !== "#/" && location.hash !== "") location.hash = "#/";
    applySearch();
  });
  search.addEventListener("input", () => {
    if (loaded && ID_RE.test(location.hash)) location.hash = "#/";
    if (loaded) applySearch();
  });

  /* ---------- start ---------- */
  renderSkeleton();
  fetch("videos.json", { cache: "no-cache" })
    .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(list => Promise.all(list.map(checkThumb)))
    .then(results => {
      approved = results.filter(Boolean);
      loaded = true;
      renderGrid(approved);
      route();
    })
    .catch(() => {
      grid.replaceChildren();
      statusEl.hidden = false;
      statusEl.textContent = "שגיאה בטעינת הסרטונים";
    });
})();
