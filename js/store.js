/* ── Store ────────────────────────────────────────────────────────────────────
   Everything HUB knows lives in two localStorage keys, and every mutation goes
   through here so there is exactly one place that writes them. Same choice ROOT
   makes: no backend, no build step, open the file and it works.

   The keys carry a version suffix so a future shape change can migrate rather
   than silently mis-read the old one.
*/
const Store = (() => {

  const K_CH = 'hub.channels.v1';
  const K_CAT = 'hub.cats.v1';
  const K_UI  = 'hub.ui.v1';

  /* The colour-coding palette. Ten hues that all sit at roughly the same
     lightness, so no category shouts louder than another on a dark ground —
     the first is ROOT's accent, and the rest are picked to stay apart from it
     and from each other. */
  const PALETTE = ['#A78BFA','#7DD3FC','#5CDB7D','#E0A060','#E06060',
                   '#F0A5D0','#8FE3D0','#9AA8FF','#D6E060','#C4B5A0'];

  /* Defaults, not law: they are seeded once on a cold start and are renamable,
     recolourable and deletable like any category made later. */
  const DEFAULT_CATS = [
    { name:'learning', color:'#A78BFA' },
    { name:'making',   color:'#E0A060' },
    { name:'tech',     color:'#7DD3FC' },
    { name:'music',    color:'#F0A5D0' },
    { name:'watch',    color:'#5CDB7D' },
  ];

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  function read(key, fallback){
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback }
    catch { return fallback }          /* a corrupt key is an empty board, not a crash */
  }
  function write(key, val){
    try { localStorage.setItem(key, JSON.stringify(val)) } catch {}
  }

  let cats = read(K_CAT, null);
  if (!Array.isArray(cats) || !cats.length){
    cats = DEFAULT_CATS.map(c => ({ id:uid(), ...c }));
    write(K_CAT, cats);
  }
  let channels = read(K_CH, []);
  if (!Array.isArray(channels)) channels = [];

  const saveCh  = () => write(K_CH, channels);
  const saveCat = () => write(K_CAT, cats);

  /* ── URL handling ──────────────────────────────────────────────────────────
     A pasted URL is the one field that is always there, so the name is derived
     from it when the name box is left blank. YouTube spells a channel four
     ways; the handle is the only one that reads like a name, and for /channel/
     ids there is nothing better to show without a network call. */
  function normUrl(raw){
    const s = (raw || '').trim();
    if (!s) return '';
    return /^https?:\/\//i.test(s) ? s : 'https://' + s.replace(/^\/+/, '');
  }

  function nameFromUrl(raw){
    const s = normUrl(raw);
    if (!s) return '';
    let path;
    try { path = new URL(s).pathname } catch { return '' }
    const seg = path.split('/').filter(Boolean);
    if (!seg.length) return '';
    if (seg[0].startsWith('@')) return seg[0];
    if (['c','user','channel'].includes(seg[0]) && seg[1]) return decodeURIComponent(seg[1]);
    return decodeURIComponent(seg[0]);
  }

  return {
    PALETTE,

    /* ── Reads ─────────────────────────────────────────────────────────── */
    channels: () => channels.slice(),
    cats:     () => cats.slice(),
    cat:      id => cats.find(c => c.id === id) || null,
    countIn:  id => channels.filter(c => c.cat === id).length,
    nameFromUrl, normUrl,

    ui:      () => read(K_UI, {}),
    setUi:   patch => write(K_UI, { ...read(K_UI, {}), ...patch }),

    /* ── Channels ──────────────────────────────────────────────────────── */
    addChannel({ url, name, desc, cat }){
      const u = normUrl(url);
      const ch = {
        id: uid(),
        url: u,
        name: (name || '').trim() || nameFromUrl(u) || 'untitled',
        desc: (desc || '').trim(),
        cat: cat || '',
        added: Date.now(),
        seen: null,                    /* null is "never viewed", not "viewed at 0" */
      };
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

    /* The whole point of "time since last viewed": one stamp, written on the
       click that opens YouTube. */
    touch(id){
      const ch = channels.find(c => c.id === id);
      if (!ch) return;
      ch.seen = Date.now(); saveCh();
    },

    /* ── Categories ────────────────────────────────────────────────────── */
    addCat(name, color){
      const c = { id:uid(), name:(name || '').trim() || 'untitled',
                  color: color || PALETTE[cats.length % PALETTE.length] };
      cats.push(c); saveCat();
      return c;
    },

    updateCat(id, patch){
      const c = cats.find(x => x.id === id);
      if (!c) return null;
      if (patch.name  !== undefined) c.name  = patch.name.trim() || c.name;
      if (patch.color !== undefined) c.color = patch.color;
      saveCat();
      return c;
    },

    /* Deleting a category never deletes channels — they fall back to
       uncategorised, which the board shows in muted grey and the filter can
       still reach. Losing a channel because its category went is not a trade
       anyone would take. */
    removeCat(id){
      cats = cats.filter(c => c.id !== id);
      let touched = false;
      channels.forEach(ch => { if (ch.cat === id){ ch.cat = ''; touched = true } });
      saveCat(); if (touched) saveCh();
    },
  };
})();
