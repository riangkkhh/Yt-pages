(() => {
  const { BLOCK_SIZES, THUMB } = window.CONFIG;
  const grid = document.getElementById("grid");
  const statusEl = document.getElementById("status");
  const search = document.getElementById("search");
  const modal = document.getElementById("modal");
  const player = document.getElementById("player");
  const modalTitle = document.getElementById("modal-title");
  let approved = [];

  document.getElementById("notice").hidden = BLOCK_SIZES.length > 0;

  // Loads the thumbnail in THIS browser (so it passes through the viewer's filter).
  // Approved only if it loads and its size is not that of the block image.
  function checkThumb(v) {
    return new Promise(resolve => {
      const img = new Image();
      const timer = setTimeout(() => resolve(null), 12000);
      img.onload = () => {
        clearTimeout(timer);
        const blocked = BLOCK_SIZES.some(([w, h]) => img.naturalWidth === w && img.naturalHeight === h);
        resolve(blocked ? null : { ...v, img });
      };
      img.onerror = () => { clearTimeout(timer); resolve(null); };
      img.src = THUMB(v.id);
    });
  }

  function render(list) {
    grid.replaceChildren();
    statusEl.hidden = list.length > 0;
    if (!list.length) statusEl.textContent = approved.length ? "לא נמצאו תוצאות" : "אין סרטונים זמינים כרגע";
    for (const v of list) {
      const card = document.createElement("button");
      card.className = "card";
      card.type = "button";

      const img = document.createElement("img");
      img.src = v.img.src;
      img.alt = "";
      img.loading = "lazy";

      const title = document.createElement("div");
      title.className = "title";
      title.textContent = v.title;

      card.append(img, title);
      card.addEventListener("click", () => openPlayer(v));
      grid.append(card);
    }
  }

  function openPlayer(v) {
    modalTitle.textContent = v.title;
    player.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(v.id)}?autoplay=1&rel=0`;
    modal.hidden = false;
    document.getElementById("close").focus();
  }

  function closePlayer() {
    modal.hidden = true;
    player.src = "about:blank";
  }

  document.getElementById("close").addEventListener("click", closePlayer);
  modal.addEventListener("click", e => { if (e.target === modal) closePlayer(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !modal.hidden) closePlayer(); });

  search.addEventListener("input", () => {
    const q = search.value.trim().toLowerCase();
    render(q ? approved.filter(v => v.title.toLowerCase().includes(q)) : approved);
  });

  fetch("videos.json", { cache: "no-cache" })
    .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(list => Promise.all(list.map(checkThumb)))
    .then(results => { approved = results.filter(Boolean); render(approved); })
    .catch(() => { statusEl.textContent = "שגיאה בטעינת הסרטונים"; });
})();
