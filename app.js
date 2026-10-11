(() => {
  const CFG = window.CONFIG || {};
  const THUMB = CFG.THUMB || (id => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`);
  const READY_TIMEOUT = CFG.READY_TIMEOUT || 7000;   // ms to wait for the player of one video
  const CONCURRENCY = CFG.CONCURRENCY || 8;           // players checked at the same time
  const CACHE_MS = CFG.CACHE_MS != null ? CFG.CACHE_MS : 10 * 60e3;
  const EMBED_HOST = "https://www.youtube-nocookie.com";
  const FILE_PATH = "videos.txt";
  const KEY = { theme: "theme", token: "ytf-gh-token", cache: "ytf-verify-v2", known: "ytf-known-open" };
  const FILE_ID_RE = /(?:v=|youtu\.be\/|\/embed\/|\/shorts\/|\/live\/)([A-Za-z0-9_-]{11})|^([A-Za-z0-9_-]{11})$/;

  const $ = id => document.getElementById(id);
  const home = $("home"), grid = $("grid"), statusEl = $("status"), watch = $("watch");
  const frame = $("frame"), side = $("side"), wtitle = $("wtitle"), search = $("search");
  const loader = $("loader"), loaderText = $("loaderText");
  const BASE_TITLE = document.title;
  const ID_RE = /^#\/watch\/([A-Za-z0-9_-]{11})$/;

  let approved = [];   // videos shown now: verified open (or, while checking, remembered as open)
  let loading = true;
  let current = null;  // id of the video loaded in the player (playing or minimized)

  /* ---------- helpers ---------- */
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };
  const getToken = () => { try { return localStorage.getItem(KEY.token) || ""; } catch (e) { return ""; } };
  const mk = v => ({ id: v.id, title: v.title, src: THUMB(v.id) });

  let toastTimer;
  function toast(text) {
    const t = $("toast");
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 7000);
  }
  function setLoader(text) {
    loader.hidden = !text;
    if (text) loaderText.textContent = text;
  }
  function showMessage(text) {
    grid.replaceChildren();
    statusEl.hidden = false;
    statusEl.textContent = text;
  }

  /* ---------- theme ---------- */
  const root = document.documentElement;
  try { const t = localStorage.getItem(KEY.theme); if (t) root.dataset.theme = t; } catch (e) {}
  $("theme").addEventListener("click", () => {
    const dark = root.dataset.theme
      ? root.dataset.theme === "dark"
      : matchMedia("(prefers-color-scheme: dark)").matches;
    const next = dark ? "light" : "dark";
    root.dataset.theme = next;
    try { localStorage.setItem(KEY.theme, next); } catch (e) {}
  });

  /* ---------- verification (runs in the viewer's browser, i.e. behind their filter) ----------
     A video the filter blocks never gets its YouTube player ready (or the player reports an error).
     Only videos whose player becomes ready are shown. */
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

  // resolves "ready" | "error" | "timeout"
  function probe(id, timeoutMs) {
    return new Promise(resolve => {
      const div = document.createElement("div");
      $("probe").append(div);
      let done = false, player, timer;
      const finish = result => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try { player.destroy(); } catch (e) {}
        div.remove();
        resolve(result);
      };
      timer = setTimeout(() => finish("timeout"), timeoutMs);
      try {
        player = new YT.Player(div, {
          videoId: id, host: EMBED_HOST, width: 320, height: 180, playerVars: { playsinline: 1 },
          events: {
            // ready, then a short grace period for an error event (removed/private videos)
            onReady: () => { clearTimeout(timer); timer = setTimeout(() => finish("ready"), 1500); },
            onError: () => finish("error"),
          },
        });
      } catch (e) { finish("error"); }
    });
  }

  // A silent player may just be slow, so a timeout gets one more, longer attempt.
  async function isOpen(id) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await probe(id, attempt ? Math.round(READY_TIMEOUT * 1.5) : READY_TIMEOUT);
      if (r === "ready") return true;
      if (r === "error") return false;
    }
    return false;
  }

  async function verifyAll(list, onProgress) {
    const cache = store.get(KEY.cache, {});
    const now = Date.now();
    const open = new Array(list.length).fill(false);
    let next = 0, done = 0;

    async function worker() {
      while (next < list.length) {
        const i = next++, id = list[i].id, hit = cache[id];
        let ok;
        if (hit && now - hit[1] < CACHE_MS) {
          ok = !!hit[0];
        } else {
          ok = await isOpen(id);
          cache[id] = [ok ? 1 : 0, Date.now()];
        }
        open[i] = ok;
        onProgress(++done, list.length);
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, list.length) }, worker));

    const keep = {};
    for (const v of list) if (cache[v.id]) keep[v.id] = cache[v.id];
    store.set(KEY.cache, keep);
    return open;
  }

  /* ---------- removing blocked links from videos.txt (GitHub API) ---------- */
  function repoInfo() {
    if (CFG.REPO && CFG.REPO.includes("/")) {
      const [owner, repo] = CFG.REPO.split("/");
      return { owner, repo };
    }
    const m = location.hostname.match(/^([^.]+)\.github\.io$/);
    if (!m) return null;
    const seg = location.pathname.split("/").filter(Boolean)[0];
    return { owner: m[1], repo: seg && !seg.includes(".") ? seg : `${m[1]}.github.io` };
  }
  const b64decode = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s/g, "")), c => c.charCodeAt(0)));
  const b64encode = s => { let bin = ""; new TextEncoder().encode(s).forEach(b => { bin += String.fromCharCode(b); }); return btoa(bin); };

  async function removeFromFile(ids, token) {
    const r = repoInfo();
    if (!r) throw new Error("לא זוהה הריפו של האתר");
    const url = `https://api.github.com/repos/${r.owner}/${r.repo}/contents/${FILE_PATH}`;
    const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
    const blocked = new Set(ids);

    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(url, { headers, cache: "no-store" });
      if (res.status === 401) throw new Error("הטוקן לא תקין או שפג תוקפו");
      if (res.status === 403 || res.status === 404) throw new Error("אין לטוקן הרשאה לקרוא את הקובץ בריפו הזה");
      if (!res.ok) throw new Error("שגיאה " + res.status);
      const file = await res.json();

      let removed = 0;
      const kept = [];
      for (const line of b64decode(file.content).split("\n")) {
        const code = line.split("#", 1)[0].trim();
        const m = code && code.match(FILE_ID_RE);
        const id = m && (m[1] || m[2]);
        if (id && blocked.has(id)) removed++; else kept.push(line);
      }
      if (!removed) return 0;

      const put = await fetch(url, {
        method: "PUT",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          message: `Remove ${removed} blocked video(s)`,
          content: b64encode(kept.join("\n")),
          sha: file.sha,
        }),
      });
      if (put.ok) return removed;
      if (put.status === 409 || put.status === 422) continue;   // the file changed meanwhile: read it again
      if (put.status === 401) throw new Error("הטוקן לא תקין או שפג תוקפו");
      if (put.status === 403 || put.status === 404) throw new Error("לטוקן אין הרשאת כתיבה (Contents: Read and write)");
      throw new Error("שגיאה " + put.status);
    }
    throw new Error("הקובץ השתנה בזמן העדכון, ננסה בביקור הבא");
  }

  async function cleanup(ids) {
    const token = getToken();
    if (!token || !ids.length) return;
    try {
      const n = await removeFromFile(ids, token);
      if (n) toast(n === 1 ? "הוסר סרטון חסום אחד מהרשימה" : `הוסרו ${n} סרטונים חסומים מהרשימה`);
    } catch (e) {
      toast("לא הצלחתי להסיר סרטונים חסומים מהקובץ: " + e.message);
    }
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
    if (!list.length) {
      if (loading) { statusEl.hidden = true; return; }   // the loader is showing
      statusEl.hidden = false;
      statusEl.textContent = approved.length ? "לא נמצאו תוצאות" : "אין סרטונים זמינים כרגע";
      return;
    }
    statusEl.hidden = true;
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

  /* settings dialog: the token that lets the site remove blocked links from videos.txt */
  const dlg = $("adminDlg");
  function updateTokenState() {
    $("tokenState").textContent = getToken()
      ? "יש טוקן שמור בדפדפן הזה: הניקוי האוטומטי פעיל."
      : "אין טוקן שמור: סרטונים חסומים רק מוסתרים, והקישור שלהם נשאר בקובץ.";
  }
  $("admin").addEventListener("click", () => {
    $("tokenInput").value = "";
    updateTokenState();
    dlg.showModal();
  });
  $("tokenSave").addEventListener("click", () => {
    const t = $("tokenInput").value.trim();
    if (!t) return;
    try { localStorage.setItem(KEY.token, t); } catch (e) { toast("הדפדפן לא מאפשר לשמור את הטוקן"); return; }
    location.reload();   // run the check again, now with cleanup enabled
  });
  $("tokenClear").addEventListener("click", () => {
    try { localStorage.removeItem(KEY.token); } catch (e) {}
    updateTokenState();
  });

  /* ---------- start ---------- */
  async function start() {
    let list;
    try {
      const r = await fetch("videos.json", { cache: "no-cache" });
      if (!r.ok) throw new Error(r.status);
      list = await r.json();
    } catch (e) {
      loading = false;
      setLoader("");
      showMessage("שגיאה בטעינת הסרטונים");
      return;
    }

    // While everything is checked again, show the videos that were found open before.
    const known = new Set(store.get(KEY.known, []));
    approved = list.filter(v => known.has(v.id)).map(mk);
    setLoader("טוען סרטונים…");
    applySearch();
    route();

    try { await loadYT(); }
    catch (e) {   // cannot verify anything: show nothing (fail closed)
      loading = false;
      approved = [];
      setLoader("");
      showMessage("לא ניתן לאמת את הסרטונים כרגע");
      return;
    }

    const open = await verifyAll(list, (d, n) => setLoader(`טוען סרטונים… ${d} מתוך ${n}`));
    approved = list.filter((v, i) => open[i]).map(mk);
    store.set(KEY.known, approved.map(v => v.id));
    loading = false;
    setLoader("");
    applySearch();
    if (current) renderSide();
    route();

    // Remove blocked links from the file. Never when nothing at all passed:
    // that points to a connection problem rather than blocked videos.
    if (approved.length) cleanup(list.filter((v, i) => !open[i]).map(v => v.id));
  }

  start();
})();
