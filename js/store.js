/* ── Store ────────────────────────────────────────────────────────────────────
   One cache, two backings.

   Off disk the board is the only writer and localStorage is the whole story.
   Inside the extension it is not: the "+ add" button on a YouTube channel page
   writes through the service worker, which has no localStorage at all. So the
   extension backs onto chrome.storage.local, which every part of the extension
   can reach, and watches it for writes that came from somewhere else.

   The cache is what keeps that from spreading. Reads stay synchronous — the
   whole of app.js is unchanged by this — and the only new rule is that the
   first render waits on `Store.ready`.
*/
const Store = (() => {

  const { KEYS, PALETTE, DEFAULT_UI, uid,
          normUrl, nameFromUrl, makeChannel, makeQueued, fillChannel, fillCat, seedCats,
          buildExport, readExport } = HubModel;

  /* chrome.storage.local, or nothing. `chrome` exists in places that cannot
     store anything, so the capability is what gets tested, not the namespace. */
  const area = (() => {
    try { return (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) || null }
    catch { return null }
  })();

  let channels = [], cats = [], ui = { ...DEFAULT_UI }, queue = [];
  let migrated = false;                             /* carried over from localStorage */
  const listeners = new Set();

  /* Our own writes come back through the change listener. Remembering what we
     last wrote is what stops a save turning into a reload turning into a
     re-render, on every keystroke. */
  const written = new Map();

  const parse = (raw, fallback) => {
    if (raw == null) return fallback;
    if (typeof raw !== 'string') return raw;          /* chrome.storage keeps types */
    try { return JSON.parse(raw) } catch { return fallback }
  };

  function adopt(bag){
    const rawCh  = parse(bag[KEYS.CH],  null);
    const rawCat = parse(bag[KEYS.CAT], null);
    const rawUi  = parse(bag[KEYS.UI],  null);

    const rawQ = parse(bag[KEYS.Q], null);
    channels = Array.isArray(rawCh) ? rawCh.map(fillChannel) : [];
    queue = Array.isArray(rawQ) ? rawQ : [];
    cats = Array.isArray(rawCat) && rawCat.length
      ? rawCat.map(fillCat).sort((a, b) => a.order - b.order)
      : null;
    ui = { ...DEFAULT_UI, ...(rawUi && typeof rawUi === 'object' ? rawUi : {}) };
    return cats === null;                             /* true: needs seeding */
  }

  async function readAll(){
    if (!area){
      const bag = {};
      for (const k of Object.values(KEYS)){
        try { bag[k] = localStorage.getItem(k) } catch { bag[k] = null }
      }
      return bag;
    }
    return area.get(Object.values(KEYS));
  }

  function save(key, value){
    const json = JSON.stringify(value);
    written.set(key, json);
    if (area) area.set({ [key]: json }).catch(() => {});
    else { try { localStorage.setItem(key, json) } catch {} }
  }

  const saveCh  = () => save(KEYS.CH, channels);
  const saveQ   = () => save(KEYS.Q, queue);
  const saveCat = () => { cats.forEach((c, i) => { c.order = i }); save(KEYS.CAT, cats) };
  const saveUi  = () => save(KEYS.UI, ui);

  const announce = () => listeners.forEach(fn => { try { fn() } catch {} });

  /* ── Coming across from localStorage ───────────────────────────────────────
     v0.3.0 moved the extension's storage from localStorage to
     chrome.storage.local, because a service worker has no localStorage and the
     "+ add" button writes through one. A board that had channels in the old
     place would have opened empty, which is not an acceptable way for an update
     to behave — so the old place is read once, on a cold start, and carried
     over. It never overwrites: this only ever runs when the new store is empty. */
  function localBag(){
    const bag = {};
    for (const k of Object.values(KEYS)){
      try { bag[k] = localStorage.getItem(k) } catch { bag[k] = null }
    }
    return bag;
  }

  const ready = (async () => {
    let seed = adopt(await readAll());

    if (area && seed && !channels.length){
      const old = localBag();
      if (old[KEYS.CH] || old[KEYS.CAT]){
        seed = adopt(old);
        save(KEYS.CH, channels);
        save(KEYS.UI, ui);
        if (!seed) saveCat();
        migrated = true;
      }
    }

    if (seed){ cats = seedCats(); saveCat() }
  })();

  /* Somebody else wrote — the "+ add" button, or the board in another tab.
     Only the extension has anyone else; off disk this never fires. */
  if (area && chrome.storage.onChanged){
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local') return;
      let mine = true;
      for (const k of Object.keys(changes)){
        if (!Object.values(KEYS).includes(k)) continue;
        if (written.get(k) !== changes[k].newValue) mine = false;
      }
      if (mine) return;
      readAll().then(bag => { adopt(bag); announce() });
    });
  }

  return {
    ready, PALETTE,
    onChange(fn){ listeners.add(fn); return () => listeners.delete(fn) },
    migrated: () => migrated,

    /* ── Export / import ───────────────────────────────────────────────────
       The other half of "remember my data when it updates": whatever the
       storage does underneath, a file you hold is a copy nothing can take. */
    exportJSON: () => JSON.stringify(buildExport(channels, cats, ui, queue), null, 2),

    importJSON(text){
      const d = readExport(text);
      if (!d) return null;
      channels = d.channels;
      cats = d.cats.length ? d.cats : seedCats();
      ui = d.ui;
      queue = d.queue;
      saveCh(); saveCat(); saveUi(); saveQ();
      return { channels:channels.length, cats:cats.length, queue:queue.length };
    },

    /* ── Reads ─────────────────────────────────────────────────────────── */
    channels: () => channels.slice(),
    cats:     () => cats.slice(),
    cat:      id => cats.find(c => c.id === id) || null,
    countIn:  id => channels.filter(c => c.cat === id).length,
    maxClicks: () => channels.reduce((m, c) => Math.max(m, c.clicks || 0), 0),
    nameFromUrl, normUrl,

    ui:    () => ({ ...ui }),
    setUi(patch){ ui = { ...ui, ...patch }; saveUi(); return { ...ui } },

    /* ── Channels ──────────────────────────────────────────────────────── */
    addChannel(data){
      const ch = makeChannel(data);
      channels.push(ch); saveCh();
      return ch;
    },

    updateChannel(id, patch){
      const ch = channels.find(c => c.id === id);
      if (!ch) return null;
      if (patch.url  !== undefined) ch.url  = normUrl(patch.url);
      if (patch.name !== undefined) ch.name = patch.name.trim() || nameFromUrl(ch.url) || 'untitled';
      if (patch.desc !== undefined) ch.desc = patch.desc.trim();
      if (patch.cat  !== undefined) ch.cat  = patch.cat;
      saveCh();
      return ch;
    },

    removeChannel(id){ channels = channels.filter(c => c.id !== id); saveCh() },

    /* ── What the extension looked up ──────────────────────────────────────
       The id, the avatar and the newest upload all come from YouTube rather
       than from Hugo, so they are written by their own door — nothing here
       touches a field a person typed. */
    enrich(id, info){
      const ch = channels.find(c => c.id === id);
      if (!ch) return null;
      if (info.ytId)   ch.ytId = info.ytId;
      if (info.avatar) ch.avatar = info.avatar;
      if (info.latest) ch.latest = info.latest;
      if (info.checkedAt) ch.checkedAt = info.checkedAt;
      saveCh();
      return ch;
    },

    /* A channel has something new when its newest upload is newer than the last
       time you opened it. No second piece of state: "new" is a comparison
       between two facts already on the record. */
    isNew(ch){
      if (!ui.showNew || !ch || !ch.latest || !ch.latest.at) return false;
      return ch.latest.at > (ch.seen || 0);
    },

    /* ── The queue ─────────────────────────────────────────────────────────
       Watch Later lives behind the feed, and the feed is what the guard takes
       away. This is the replacement, and it is HUB's, not YouTube's. */
    queue: () => queue.slice(),

    enqueue(data){
      const q = makeQueued(data);
      if (q.videoId && queue.some(x => x.videoId === q.videoId)) return null;
      queue.unshift(q); saveQ();
      return q;
    },

    dequeue(id){ queue = queue.filter(q => q.id !== id); saveQ() },
    clearQueue(){ queue = []; saveQ() },

    /* One click is two facts: when it last happened, and how often it has.
       The first orders "last viewed", the second is the heat. */
    touch(id){
      const ch = channels.find(c => c.id === id);
      if (!ch) return;
      ch.seen = Date.now();
      ch.clicks = (ch.clicks || 0) + 1;
      saveCh();
    },

    /* ── Categories ────────────────────────────────────────────────────── */
    addCat(name, color, icon){
      const c = { id:uid(), order:cats.length, icon: icon || '',
                  name:(name || '').trim() || 'untitled',
                  color: color || PALETTE[cats.length % PALETTE.length] };
      cats.push(c); saveCat();
      return c;
    },

    updateCat(id, patch){
      const c = cats.find(x => x.id === id);
      if (!c) return null;
      if (patch.name  !== undefined) c.name  = patch.name.trim() || c.name;
      if (patch.color !== undefined) c.color = patch.color;
      if (patch.icon  !== undefined) c.icon  = patch.icon || '';
      saveCat();
      return c;
    },

    /* Reorder by one place. Buttons rather than dragging: the list is five or
       six rows in a sheet, and a drag is a thing to get wrong on a trackpad. */
    moveCat(id, dir){
      const i = cats.findIndex(c => c.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= cats.length) return false;
      [cats[i], cats[j]] = [cats[j], cats[i]];
      saveCat();
      return true;
    },

    /* Deleting a category never deletes channels — they fall back to
       uncategorised, which the board shows in muted grey and the filter can
       still reach. */
    removeCat(id){
      cats = cats.filter(c => c.id !== id);
      let touched = false;
      channels.forEach(ch => { if (ch.cat === id){ ch.cat = ''; touched = true } });
      saveCat(); if (touched) saveCh();
    },
  };
})();
