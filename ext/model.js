/* ── Model ────────────────────────────────────────────────────────────────────
   What a channel is, what a category is, and what the keys are called.

   Pure, like ext/scope.js, and for the same reason: since v0.3.0 the board is
   not the only thing that writes channels. The "+ add" button on a YouTube
   channel page files one from a content script, through the service worker,
   which has no localStorage and never loads the app. Both ends have to agree on
   the record shape, so the shape lives in one file that both read.
*/
const HubModel = (() => {

  const KEYS = { CH:'hub.channels.v1', CAT:'hub.cats.v1', UI:'hub.ui.v1' };

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
  };

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
  const fillChannel = c => ({ clicks:0, seen:null, desc:'', cat:'', ...c });
  const fillCat = (c, i) => ({ order:i, ...c });

  const seedCats = () => DEFAULT_CATS.map((c, i) => ({ id:uid(), order:i, ...c }));

  return { KEYS, PALETTE, DEFAULT_CATS, DEFAULT_UI, uid,
           normUrl, nameFromUrl, makeChannel, fillChannel, fillCat, seedCats };
})();

if (typeof globalThis !== 'undefined') globalThis.HubModel = HubModel;
if (typeof module !== 'undefined' && module.exports) module.exports = HubModel;
