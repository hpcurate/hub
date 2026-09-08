/* ── Model ────────────────────────────────────────────────────────────────────
   What a channel is, what a category is, and what the keys are called.

   Pure, like ext/scope.js, and for the same reason: since v0.3.0 the board is
   not the only thing that writes channels. The "+ add" button on a YouTube
   channel page files one from a content script, through the service worker,
   which has no localStorage and never loads the app. Both ends have to agree on
   the record shape, so the shape lives in one file that both read.
*/
const HubModel = (() => {

  const KEYS = { CH:'hub.channels.v1', CAT:'hub.cats.v1', UI:'hub.ui.v1', Q:'hub.queue.v1' };

  /* Ten hues at roughly one lightness, so no category shouts louder than
     another on a dark ground. Since v0.3.0 they are a starting point rather
     than the whole choice — a category can hold any colour. */
  const PALETTE = ['#A78BFA','#7DD3FC','#5CDB7D','#E0A060','#E06060',
                   '#F0A5D0','#8FE3D0','#9AA8FF','#D6E060','#C4B5A0'];

  const DEFAULT_CATS = [
    { name:'learning', color:'#A78BFA' },
    { name:'making',   color:'#E0A060' },
    { name:'tech',     color:'#7DD3FC' },
    { name:'music',    color:'#F0A5D0' },
    { name:'watch',    color:'#5CDB7D' },
  ];

  /* Everything on the board that is a preference rather than data. The two
     heat colours are the gradient the request asked to be able to choose. */
  const DEFAULT_UI = {
    sort:'seen', size:'m',
    heatFrom:'#3a3a3a', heatTo:'#A78BFA',
    showHeat:true, showCounts:false, hideEmpty:false,
    addMode:false,

    /* Look. Each of these is a token the whole sheet already draws with, so a
       dial here moves the system rather than one rule. */
    accent:'#A78BFA', radius:4, motion:1,

    /* Layout. `layout` is the shape of a card, the rest are where things sit
       inside it. Presets in settings set several of these at once; every one of
       them is still a dial on its own afterwards. */
    layout:'card',            /* card | compact | list */
    avatarPos:'left',         /* left | top */
    avatarSize:30,
    badgePos:'bottom',        /* bottom | top */
    nameLines:2,
    gap:12,
    border:'hairline',        /* hairline | none | accent */
    surface:'raised',         /* raised | flat */

    /* What a card shows. Off is a real answer for every one of them. */
    showAvatars:true, avatarShape:'circle', showDesc:true, descLines:4,
    showTag:true, showSeen:true, showNew:true,

    /* The rest of the badges. Off by default: a card that says nine things
       says nothing, and these are the ones you would go looking for rather
       than the ones you read at a glance. */
    showPosted:false, showAdded:false, showRank:false,
    showQueued:false, showHandle:false,

    /* Board behaviour. */
    enterOpens:true, newTab:true,

    /* The extension. checkEvery is in hours; a feed that is polled harder than
       this tells you nothing more, because uploads are not that frequent. */
    queueButton:true, checkNew:true, checkEvery:6,
    /* 0 is "as wide as the window". Anything else is a pixel measure, which is
       what an ultrawide needs: the board reflows to any width, but a board four
       thousand pixels across is a wall, not a page. */
    maxWidth:1560,
  };

  /* ── Category icons ────────────────────────────────────────────────────────
     Twenty, plus none. Inner SVG markup rather than a font or a sprite, so
     there is nothing to load and they inherit currentColor — which is the
     category's own colour wherever they are drawn. Stroke-only and on the same
     24-unit grid, so they sit at any size without going soft.

     They are drawn with innerHTML, which is safe because this object is the
     only source: an icon is a key, and a key that is not in here draws nothing. */
  const ICONS = {
    play:   '<path d="M9 6l10 6-10 6z"/>',
    music:  '<circle cx="7" cy="18" r="2.5"/><circle cx="18" cy="16" r="2.5"/><path d="M9.5 18V6l11-2v12"/>',
    code:   '<path d="M9 7l-5 5 5 5M15 7l5 5-5 5"/>',
    book:   '<path d="M4 5a2 2 0 0 1 2-2h12v16H6a2 2 0 0 0-2 2z"/><path d="M18 17H6"/>',
    tool:   '<path d="M17 3a5 5 0 0 0-4.6 7L4 18.4 5.6 20l8.4-8.4A5 5 0 0 0 21 7l-3 3-2-2z"/>',
    camera: '<path d="M3 8h4l1.5-2h7L17 8h4v11H3z"/><circle cx="12" cy="13" r="3.5"/>',
    game:   '<rect x="3" y="8" width="18" height="10" rx="4"/><path d="M8 11v4M6 13h4M16 12h.01M18 15h.01"/>',
    chip:   '<rect x="7" y="7" width="10" height="10" rx="1"/><path d="M10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4"/>',
    flask:  '<path d="M10 3v6L4 19a2 2 0 0 0 2 3h12a2 2 0 0 0 2-3l-6-10V3"/><path d="M9 3h6"/>',
    art:    '<path d="M12 3a9 9 0 1 0 0 18 2 2 0 0 0 1.6-3.2 2 2 0 0 1 1.6-3.2H18a3 3 0 0 0 3-3A9 9 0 0 0 12 3z"/><circle cx="8" cy="10" r="1"/><circle cx="12" cy="7.5" r="1"/><circle cx="16" cy="10" r="1"/>',
    lift:   '<path d="M3 9v6M6 7v10M18 7v10M21 9v6M6 12h12"/>',
    plane:  '<path d="M21 15l-9-4V5a1.5 1.5 0 0 0-3 0v6l-9 4v2l9-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L12 19v-4.5L21 17z"/>',
    food:   '<path d="M6 3v8a2 2 0 0 0 4 0V3M8 11v10"/><path d="M17 3c-1.5 2-2 4-2 6s.7 3 2 3v9"/>',
    car:    '<path d="M3 17v-4l2-5h14l2 5v4z"/><path d="M5 17v2h3v-2M16 17v2h3v-2"/><circle cx="8" cy="14" r="1"/><circle cx="16" cy="14" r="1"/>',
    leaf:   '<path d="M4 20c0-9 6-14 16-14 0 10-5 15-13 15-1 0-3-.5-3-1z"/><path d="M9 15c2-3 5-5 8-6"/>',
    home:   '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>',
    star:   '<path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2-5.5-2.9L6.5 20l1-6.2L3 9.6l6.2-.9z"/>',
    heart:  '<path d="M12 20S3 14.5 3 8.8A4.8 4.8 0 0 1 12 6a4.8 4.8 0 0 1 9 2.8C21 14.5 12 20 12 20z"/>',
    globe:  '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 3 2.5 15 0 18-2.5-3-2.5-15 0-18z"/>',
    bolt:   '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  };
  const ICON_KEYS = Object.keys(ICONS);

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  function normUrl(raw){
    const s = String(raw || '').trim();
    if (!s) return '';
    return /^https?:\/\//i.test(s) ? s : 'https://' + s.replace(/^\/+/, '');
  }

  /* A pasted URL is the one field that is always there, so the name comes off
     it when the name box is blank. The handle is the only spelling that reads
     like a name; for a /channel/ id there is nothing better without a network
     call, and the "+ add" button passes the page's title instead. */
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

  function makeChannel({ url, name, desc, cat }){
    const u = normUrl(url);
    return {
      id: uid(),
      url: u,
      name: String(name || '').trim() || nameFromUrl(u) || 'untitled',
      desc: String(desc || '').trim(),
      cat: cat || '',
      added: Date.now(),
      seen: null,         /* null is "never viewed", not "viewed at 0" */
      clicks: 0,
    };
  }

  /* Records written before v0.3.0 have no click count and no category order.
     Filling them in on read rather than migrating on write means an old board
     opened in a new build is simply correct, with nothing to run first. */
  const fillChannel = c => ({
    clicks:0, seen:null, desc:'', cat:'',
    /* Filled in later by the extension, from the channel's own page and feed.
       Empty is not an error, it is "not looked up yet". */
    ytId:'', avatar:'', latest:null, checkedAt:0,
    ...c,
  });
  const fillCat = (c, i) => ({ order:i, icon:'', ...c });

  const seedCats = () => DEFAULT_CATS.map((c, i) => ({ id:uid(), order:i, ...c }));

  /* ── Export ────────────────────────────────────────────────────────────────
     One file, all three keys, stamped. `kind` is what an import checks before
     it replaces anything — a JSON file that happens to have the right-looking
     fields is not the same as a file this wrote. */
  const EXPORT_KIND = 'hub.export';

  const buildExport = (channels, cats, ui, queue) => ({
    kind: EXPORT_KIND, version: 2, at: new Date().toISOString(),
    channels, cats, ui, queue: queue || [],
  });

  /* A queued video. It carries its own title and channel, because the queue has
     to be readable without going back to YouTube to ask what any of it was. */
  const makeQueued = ({ videoId, url, title, channel, channelUrl }) => ({
    id: uid(),
    videoId: String(videoId || ''),
    url: normUrl(url) || ('https://www.youtube.com/watch?v=' + videoId),
    title: String(title || '').trim() || 'untitled',
    channel: String(channel || '').trim(),
    channelUrl: normUrl(channelUrl),
    added: Date.now(),
  });

  /* Returns { channels, cats, ui } or null. Deliberately forgiving about what
     is inside — an old export missing a field is still worth restoring — and
     unforgiving about what the file is. */
  function readExport(text){
    let d;
    try { d = JSON.parse(text) } catch { return null }
    if (!d || d.kind !== EXPORT_KIND) return null;
    if (!Array.isArray(d.channels) || !Array.isArray(d.cats)) return null;
    return {
      channels: d.channels.map(fillChannel),
      cats: d.cats.map(fillCat).sort((a, b) => a.order - b.order),
      ui: { ...DEFAULT_UI, ...(d.ui && typeof d.ui === 'object' ? d.ui : {}) },
      queue: Array.isArray(d.queue) ? d.queue : [],
    };
  }

  return { KEYS, PALETTE, DEFAULT_CATS, DEFAULT_UI, ICONS, ICON_KEYS, uid,
           normUrl, nameFromUrl, makeChannel, makeQueued, fillChannel, fillCat, seedCats,
           EXPORT_KIND, buildExport, readExport };
})();

if (typeof globalThis !== 'undefined') globalThis.HubModel = HubModel;
if (typeof module !== 'undefined' && module.exports) module.exports = HubModel;
