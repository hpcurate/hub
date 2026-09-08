/* ── HUB ──────────────────────────────────────────────────────────────────────
   The board, its controls, and the two sheets. One render function drives
   everything: change state, call render(), and the DOM is reconciled against
   the list it produces. Nothing else touches the grid.
*/
(() => {

const $  = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

const grid   = $('#grid');
const chips  = $('#chips');
const empty  = $('#empty');
const scrim  = $('#scrim');
const SHEETS = { ch:$('#sheet-ch'), cat:$('#sheet-cat'), set:$('#sheet-set') };

/* Board state. Not persisted beyond the two dials the eye notices across a
   reload — the size of the cards and how they are sorted. A search term and a
   category filter are things you are in the middle of, not settings. */
let ui = { ...HubModel.DEFAULT_UI };   /* replaced by the stored one once ready */
let q = '';
let sort = ui.sort;
let size = ui.size;
let picked = new Set();          /* empty = every category */

/* A category's icon, as an <svg> that inherits the colour of whatever it is
   drawn inside. An unknown key draws nothing rather than a broken glyph, which
   is what makes the icon set safe to change later. */
function iconEl(key){
  const markup = HubModel.ICONS[key];
  if (!markup) return null;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'ico');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = markup;
  return svg;
}

const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const D = n => REDUCED ? 0 : n;

/* ── Time since last viewed ──────────────────────────────────────────────────
   Coarse on purpose. "3 weeks" is the answer to "have I watched this lately";
   "23 days" is not a better one, it is the same one with a decimal point. */
const MIN = 60e3, HR = 60 * MIN, DAY = 24 * HR;
function since(ts){
  if (!ts) return 'never';
  const d = Date.now() - ts;
  if (d < MIN)      return 'just now';
  if (d < HR)       return Math.floor(d / MIN) + 'm ago';
  if (d < DAY)      return Math.floor(d / HR) + 'h ago';
  if (d < 7 * DAY)  return Math.floor(d / DAY) + 'd ago';
  if (d < 60 * DAY) return Math.floor(d / (7 * DAY)) + 'w ago';
  if (d < 365 * DAY)return Math.floor(d / (30 * DAY)) + 'mo ago';
  return Math.floor(d / (365 * DAY)) + 'y ago';
}

/* ── The list ────────────────────────────────────────────────────────────────
   Filter, then search, then sort. Every control on the bar funnels into here,
   which is why "sort/filter everything" is one function and not five. */
function list(){
  const cats = Store.cats();
  const order = new Map(cats.map((c, i) => [c.id, i]));
  const term = q.trim().toLowerCase();

  let out = Store.channels();

  if (picked.size) out = out.filter(c => picked.has(c.cat || ''));

  if (term) out = out.filter(c => {
    const cat = Store.cat(c.cat);
    return (c.name + ' ' + c.desc + ' ' + (cat ? cat.name : '')).toLowerCase().includes(term);
  });

  /* Most YouTube names arrive as @handles, and punctuation sorts before
     letters — so a plain localeCompare files every handle in one clump at the
     top and calls it alphabetical. The @ is a prefix of the URL scheme, not
     the first letter of the name, so it is dropped for the comparison only. */
  const key = s => s.replace(/^@+/, '');
  const byName = (a, b) => key(a.name).localeCompare(key(b.name), undefined, { sensitivity:'base' });

  out.sort((a, b) => {
    switch (sort){
      /* never-viewed has no timestamp, so it sorts to the far end of both
         time orders rather than pretending to be 1970 */
      case 'seen':  return (b.seen || 0) - (a.seen || 0) || byName(a, b);
      case 'stale': return (a.seen || 0) - (b.seen || 0) || byName(a, b);
      case 'added': return b.added - a.added;
      /* most opened first. Ties fall back to the name so the board does not
         shuffle every time two channels are level. */
      case 'clicks': return (b.clicks || 0) - (a.clicks || 0) || byName(a, b);
      case 'name':  return byName(a, b);
      case 'cat':   return (order.has(a.cat) ? order.get(a.cat) : 1e6)
                         - (order.has(b.cat) ? order.get(b.cat) : 1e6) || byName(a, b);
    }
  });
  return out;
}

/* ── Cards ───────────────────────────────────────────────────────────────────
   Nodes are kept and reused across renders, keyed by id. That is what makes
   the reorder animation possible at all — a rebuilt DOM has nothing to move —
   and it also keeps hover and focus alive through a re-sort. */
const nodes = new Map();

function build(ch){
  const el = document.createElement('article');
  el.className = 'card';
  el.dataset.id = ch.id;
  el.innerHTML =
    '<a class="card-hit" target="_blank" rel="noopener noreferrer"></a>' +
    '<div class="card-top"><h3 class="card-name"></h3>' +
      '<button class="card-edit" title="Edit">\u22ef</button></div>' +
    '<p class="card-desc"></p>' +
    '<div class="card-foot"><button class="tag" type="button" title="Categorise"></button>' +
      '<span class="count"></span><span class="seen"></span></div>' +
    '<span class="heat"></span>';

  /* The stamp is written on the way out, on the same click that opens the tab,
     so "last viewed" means "last time I actually went there".

     Inside the extension the bridge takes the navigation instead, so the tab it
     opens is granted before it loads and the guard never sees an unpicked one.
     Off disk the bridge declines and the anchor behaves like an anchor. */
  el.querySelector('.card-hit').addEventListener('click', e => {
    Store.touch(ch.id);
    paintSeen(el, Store.channels().find(c => c.id === ch.id));
    if (typeof HubBridge !== 'undefined' && HubBridge.inExt){
      e.preventDefault();
      HubBridge.open(ch);
    }
  });
  el.querySelector('.card-edit').addEventListener('click', e => {
    e.preventDefault(); e.stopPropagation();
    openChannel(ch.id);
  });

  /* Quick categorise: the tag is the control for the thing it names. Filing a
     channel should not need the edit pane — especially since anything added by
     the "+ add" button on YouTube arrives with no category at all. */
  el.querySelector('.tag').addEventListener('click', e => {
    e.preventDefault(); e.stopPropagation();
    openQuick(ch.id, e.currentTarget);
  });
  return el;
}

/* ── The heat line ───────────────────────────────────────────────────────────
   A rule under the card, its colour taken from where this channel sits between
   the least and the most opened. It is the same gradient for the whole board,
   so the line only means anything read across all of them — which is why it is
   mixed against the board's own maximum rather than an absolute number.

   With every channel level (a new board, or nothing clicked yet) there is no
   scale to be on, so every line sits at the cold end rather than all of them
   claiming to be the hottest. */
function paintHeat(el, ch){
  const max = Store.maxClicks();
  const t = max > 0 ? Math.min(1, (ch.clicks || 0) / max) : 0;
  el.style.setProperty('--heat', mix(ui.heatFrom, ui.heatTo, t));
  el.style.setProperty('--heat-t', t.toFixed(3));
}

/* Two hex colours and a position between them. CSS could do this with
   color-mix, but the value is wanted in JS as well — the settings preview
   draws the same ramp — so it is one function rather than two spellings. */
function mix(a, b, t){
  const hex = h => {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(h || '').trim());
    const n = m ? parseInt(m[1], 16) : 0;
    return [n >> 16 & 255, n >> 8 & 255, n & 255];
  };
  const [r1, g1, b1] = hex(a), [r2, g2, b2] = hex(b);
  const c = (x, y) => Math.round(x + (y - x) * t);
  return 'rgb(' + c(r1, r2) + ',' + c(g1, g2) + ',' + c(b1, b2) + ')';
}

function paintSeen(el, ch){
  if (!ch) return;
  const s = el.querySelector('.seen');
  s.textContent = since(ch.seen);
  s.classList.toggle('never', !ch.seen);
  s.classList.toggle('fresh', !!ch.seen && Date.now() - ch.seen < DAY);
}

function paint(el, ch){
  const cat = Store.cat(ch.cat);
  el.style.setProperty('--c', cat ? cat.color : 'var(--tx-2)');

  const hit = el.querySelector('.card-hit');
  hit.href = ch.url;
  hit.setAttribute('aria-label', 'Open ' + ch.name + ' on YouTube');

  el.querySelector('.card-name').textContent = ch.name;

  const d = el.querySelector('.card-desc');
  d.textContent = ch.desc || 'no description';
  d.classList.toggle('none', !ch.desc);

  const t = el.querySelector('.tag');
  t.textContent = '';
  const ic = cat && iconEl(cat.icon);
  if (ic) t.appendChild(ic);
  t.appendChild(document.createTextNode(cat ? cat.name : 'uncategorised'));
  t.classList.toggle('none', !cat);
  t.classList.toggle('has-icon', !!ic);

  const n = el.querySelector('.count');
  n.textContent = (ch.clicks || 0) + (ch.clicks === 1 ? ' open' : ' opens');

  paintHeat(el, ch);
  paintSeen(el, ch);
}

/* ── FLIP ────────────────────────────────────────────────────────────────────
   A grid reorders by changing where boxes are, and there is no CSS transition
   for that. So: measure every card, do the reorder, measure again, and play
   each card from its old position back to its new one. */
function flip(mutate){
  const before = new Map();
  if (!REDUCED) nodes.forEach((el, id) => { if (el.isConnected) before.set(id, el.getBoundingClientRect()) });

  mutate();

  if (REDUCED) return;
  nodes.forEach((el, id) => {
    const b = before.get(id); if (!b || !el.isConnected) return;
    const a = el.getBoundingClientRect();
    const dx = b.left - a.left, dy = b.top - a.top;
    if (!dx && !dy) return;
    el.animate(
      [{ transform:`translate(${dx}px, ${dy}px)` }, { transform:'none' }],
      { duration:340, easing:'cubic-bezier(.4,0,.2,1)' }
    );
  });
}

/* ── Render ──────────────────────────────────────────────────────────────── */
function render(){
  const items = list();
  const total = Store.channels().length;

  grid.dataset.size = size;
  grid.classList.toggle('no-heat', !ui.showHeat);
  grid.classList.toggle('no-counts', !ui.showCounts);
  renderChips();

  const cats = Store.cats().length;
  $('#meta').textContent = total
    ? total + (total === 1 ? ' channel' : ' channels') + ' \u00b7 ' +
      cats + (cats === 1 ? ' category' : ' categories') +
      (items.length !== total ? ' \u00b7 ' + items.length + ' shown' : '')
    : 'no channels yet';

  flip(() => {
    const keep = new Set(items.map(c => c.id));

    /* gone from the board — fade the node out, then drop it */
    nodes.forEach((el, id) => {
      if (keep.has(id)) return;
      nodes.delete(id);
      if (REDUCED){ el.remove(); return }
      el.animate([{ opacity:1, transform:'none' }, { opacity:0, transform:'scale(.97)' }],
                 { duration:160, easing:'cubic-bezier(.4,0,.2,1)' })
        .finished.then(() => el.remove(), () => el.remove());
    });

    items.forEach((ch, i) => {
      let el = nodes.get(ch.id);
      if (!el){
        el = build(ch);
        nodes.set(ch.id, el);
        el.style.setProperty('--i', i);
        el.classList.add('in');
      }
      paint(el, ch);
      grid.appendChild(el);            /* appendChild moves an existing node */
    });
  });

  empty.hidden = items.length > 0;
  if (!items.length){
    $('#empty-t').textContent = total ? 'nothing matches' : 'nothing here yet';
    $('#empty-s').textContent = total
      ? 'try a different category, or clear the search'
      : 'add a channel to start the board';
  }
}

/* ── Category filter chips ───────────────────────────────────────────────────
   Multi-select: no chip on means everything, which is both the empty state and
   the "all" button, so the two can never disagree. */
function renderChips(){
  const chans = Store.channels();
  const loose = chans.filter(c => !c.cat || !Store.cat(c.cat)).length;

  chips.textContent = '';

  const all = document.createElement('button');
  all.className = 'chip all' + (picked.size ? '' : ' on');
  all.textContent = 'all';
  all.addEventListener('click', () => { picked.clear(); render() });
  chips.appendChild(all);

  Store.cats().forEach(c => {
    const n = chans.filter(x => x.cat === c.id).length;
    /* An empty category still exists — it is only kept out of the bar. One that
       is switched on stays, or turning it off would need a trip to settings. */
    if (ui.hideEmpty && !n && !picked.has(c.id)) return;
    const b = document.createElement('button');
    b.className = 'chip' + (picked.has(c.id) ? ' on' : '');
    b.style.setProperty('--c', c.color);
    b.innerHTML = '<span class="t"></span><span class="n"></span>';
    const ic = iconEl(c.icon);
    if (ic) b.insertBefore(ic, b.firstChild);
    b.classList.toggle('has-icon', !!ic);
    b.querySelector('.t').textContent = c.name;
    b.querySelector('.n').textContent = n;
    b.addEventListener('click', () => { toggle(c.id); render() });
    chips.appendChild(b);
  });

  if (loose){
    const b = document.createElement('button');
    b.className = 'chip' + (picked.has('') ? ' on' : '');
    b.style.setProperty('--c', 'var(--mu)');
    b.innerHTML = '<span class="t">uncategorised</span><span class="n"></span>';
    b.querySelector('.n').textContent = loose;
    b.addEventListener('click', () => { toggle(''); render() });
    chips.appendChild(b);
  }
}
function toggle(id){ picked.has(id) ? picked.delete(id) : picked.add(id) }

/* ── Sheets ──────────────────────────────────────────────────────────────────
   One scrim, one panel, two contents. Closing is animated by adding .out and
   waiting for the animation to end, so the panel never disappears on a frame. */
let openName = null;

function openSheet(name){
  const el = SHEETS[name];
  if (!el) return;
  openName = name;
  Object.entries(SHEETS).forEach(([k, s]) => {
    if (k === name) return;
    /* Focus can be sitting in the pane being hidden — the category name field,
       say — and left there every keyboard shortcut stays dead, because they all
       stand down while you are typing. Same bug the sheet close had. */
    if (s.contains(document.activeElement)) document.activeElement.blur();
    s.hidden = true; s.classList.remove('out');
  });
  scrim.hidden = el.hidden = false;
  scrim.classList.remove('out'); el.classList.remove('out');
}

function closeSheet(){
  if (!openName) return;
  const el = SHEETS[openName];
  openName = null;
  /* Focus is still in a field that is about to be hidden. Left there, the
     keyboard shortcuts stay dead until something else is clicked, because
     every one of them stands down while you are typing. */
  if (el.contains(document.activeElement)) document.activeElement.blur();
  if (REDUCED){ scrim.hidden = el.hidden = true; return }
  scrim.classList.add('out'); el.classList.add('out');
  const done = () => {
    if (openName) return;            /* reopened mid-animation, leave it alone */
    scrim.hidden = el.hidden = true;
    scrim.classList.remove('out'); el.classList.remove('out');
  };
  el.addEventListener('animationend', done, { once:true });
  setTimeout(done, 400);             /* animations can be dropped; the sheet can't stick */
}

scrim.addEventListener('click', closeSheet);
$$('[data-close]').forEach(b => b.addEventListener('click', closeSheet));

/* ── Channel sheet ───────────────────────────────────────────────────────── */
let editing = null;                  /* id being edited, or null for a new one */

function catPicker(sel, onPick){
  const box = $('#c-cat');
  box.textContent = '';

  const mk = (id, name, color, on) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip' + (on ? ' on' : '');
    b.style.setProperty('--c', color);
    b.textContent = name;
    b.addEventListener('click', () => onPick(id));
    return b;
  };

  box.appendChild(mk('', 'none', 'var(--mu)', !sel));
  Store.cats().forEach(c => box.appendChild(mk(c.id, c.name, c.color, sel === c.id)));
}

function openChannel(id){
  editing = id || null;
  const ch = id ? Store.channels().find(c => c.id === id) : null;

  $('#f-ch-t').textContent = ch ? 'edit channel' : 'new channel';
  $('#c-url').value  = ch ? ch.url  : '';
  $('#c-name').value = ch ? ch.name : '';
  $('#c-desc').value = ch ? ch.desc : '';
  $('#c-del').hidden = !ch;
  $('#c-del').classList.remove('armed');
  $('#c-del').textContent = 'delete';

  let sel = ch ? ch.cat : (Store.cats()[0] ? Store.cats()[0].id : '');
  const draw = () => catPicker(sel, id2 => { sel = id2; draw() });
  draw();

  /* A category you think of while filing a channel should be makeable here,
     without a trip to the other sheet. The input replaces nothing and vanishes
     on Escape or on an empty Enter. */
  $('#c-newcat').onclick = () => {
    const box = $('#c-cat');
    const open = box.querySelector('.newcat-in');
    if (open){ open.focus(); return }

    const inp = document.createElement('input');
    inp.className = 'newcat-in'; inp.placeholder = 'name'; inp.maxLength = 24;
    inp.addEventListener('keydown', ev => {
      if (ev.key === 'Enter'){
        ev.preventDefault();
        const v = inp.value.trim();
        if (!v){ inp.remove(); return }
        sel = Store.addCat(v).id;
        draw(); render();
      } else if (ev.key === 'Escape'){
        ev.preventDefault(); ev.stopPropagation();   /* Escape closes the input, not the sheet */
        inp.remove();
      }
    });
    box.appendChild(inp);
    inp.focus();
  };

  $('#f-ch').onsubmit = e => {
    e.preventDefault();
    const data = { url:$('#c-url').value, name:$('#c-name').value,
                   desc:$('#c-desc').value, cat:sel };
    if (editing) Store.updateChannel(editing, data);
    else         Store.addChannel(data);
    closeSheet(); render();
  };

  openSheet('ch');
  setTimeout(() => $(ch ? '#c-name' : '#c-url').focus(), 60);
}

/* Two steps, no browser dialog: the first click arms the button, the second
   does it, and anything else disarms it. A confirm() would freeze the page. */
$('#c-del').addEventListener('click', function(){
  if (!this.classList.contains('armed')){
    this.classList.add('armed'); this.textContent = 'sure?';
    return;
  }
  if (editing) Store.removeChannel(editing);
  closeSheet(); render();
});

/* ── Category sheet ──────────────────────────────────────────────────────────
   Rename in place, recolour from the palette, delete in two steps. Every edit
   writes through immediately and re-renders the board, so the colour change is
   visible on the cards behind the sheet as it is picked. */
let newColor = Store.PALETTE[0];

/* The ten are a shortcut, not the choice. The last swatch is a colour input
   wearing the same shape as the other ten, so "any colour" is one click deeper
   than the presets rather than somewhere else entirely. */
function swatches(current, onPick){
  const cur = String(current || '').toLowerCase();
  const wrap = document.createElement('div');
  wrap.className = 'swatches';

  Store.PALETTE.forEach(hex => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sw' + (hex.toLowerCase() === cur ? ' on' : '');
    b.style.setProperty('--c', hex);
    b.title = hex;
    b.addEventListener('click', () => onPick(hex));
    wrap.appendChild(b);
  });

  const custom = Store.PALETTE.every(h => h.toLowerCase() !== cur);
  const lab = document.createElement('label');
  lab.className = 'sw sw-any' + (custom ? ' on' : '');
  lab.title = 'any colour';
  lab.style.setProperty('--c', custom ? current : 'var(--tx-2)');
  const inp = document.createElement('input');
  inp.type = 'color';
  inp.value = /^#[0-9a-f]{6}$/i.test(current || '') ? current : '#A78BFA';
  inp.addEventListener('input', () => onPick(inp.value));
  lab.appendChild(inp);
  wrap.appendChild(lab);

  return wrap;
}

/* Which row has its icon grid open. One at a time: twenty-one buttons is a
   panel, not a control, and five of them open at once is the sheet. */
let openIconFor = null;

/* The grid of twenty, plus none. It draws under the row it belongs to, so the
   choice and the thing being chosen for are never far apart. */
function iconGrid(cat){
  const g = document.createElement('div');
  g.className = 'icon-grid';
  g.style.setProperty('--c', cat.color);

  const cell = (key, label) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ic-b' + (cat.icon === key ? ' on' : '');
    b.title = label;
    const ic = iconEl(key);
    if (ic) b.appendChild(ic); else b.textContent = 'none';
    b.addEventListener('click', () => {
      Store.updateCat(cat.id, { icon:key });
      openIconFor = null;
      renderCats(); render();
    });
    return b;
  };

  g.appendChild(cell('', 'No icon'));
  HubModel.ICON_KEYS.forEach(k => g.appendChild(cell(k, k)));
  return g;
}

function renderCats(){
  const box = $('#cat-list');
  box.textContent = '';

  Store.cats().forEach(c => {
    const wrap = document.createElement('div');
    wrap.className = 'cat-wrap';

    const r = document.createElement('div');
    r.className = 'cat-r';
    r.style.setProperty('--c', c.color);

    /* The icon comes before the colour, because it is the thing you read on a
       card first. */
    const ib = document.createElement('button');
    ib.type = 'button';
    ib.className = 'cat-ico' + (c.icon ? ' on' : '') + (openIconFor === c.id ? ' open' : '');
    ib.title = 'Icon';
    const cur = iconEl(c.icon);
    if (cur) ib.appendChild(cur); else ib.textContent = '—';
    ib.addEventListener('click', () => {
      openIconFor = openIconFor === c.id ? null : c.id;
      renderCats();
    });
    r.appendChild(ib);

    r.appendChild(swatches(c.color, hex => {
      Store.updateCat(c.id, { color:hex });
      renderCats(); render();
    }));

    const name = document.createElement('input');
    name.className = 'cat-n'; name.value = c.name; name.maxLength = 24;
    name.addEventListener('change', () => { Store.updateCat(c.id, { name:name.value }); render() });
    r.appendChild(name);

    const n = document.createElement('span');
    n.className = 'n'; n.textContent = Store.countIn(c.id);
    r.appendChild(n);

    /* Order is the order of the filter bar and of the "category" sort, so it is
       worth being able to set. Buttons rather than a drag: this is five rows in
       a sheet, and a drag is the thing that goes wrong on a trackpad. */
    const cats = Store.cats();
    const i = cats.findIndex(x => x.id === c.id);
    [['↑', -1, i > 0], ['↓', 1, i < cats.length - 1]].forEach(([glyph, dir, can]) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'cat-mv'; b.textContent = glyph;
      b.disabled = !can;
      b.title = dir < 0 ? 'Move up' : 'Move down';
      b.addEventListener('click', () => { if (Store.moveCat(c.id, dir)){ renderCats(); render() } });
      r.appendChild(b);
    });

    const x = document.createElement('button');
    x.className = 'cat-x'; x.type = 'button'; x.textContent = '\u00d7';
    x.title = 'Delete — channels in it become uncategorised';
    x.addEventListener('click', () => {
      if (!x.classList.contains('armed')){ x.classList.add('armed'); x.textContent = '?'; return }
      Store.removeCat(c.id);
      picked.delete(c.id);
      renderCats(); render();
    });
    r.appendChild(x);

    wrap.appendChild(r);
    if (openIconFor === c.id) wrap.appendChild(iconGrid(c));
    box.appendChild(wrap);
  });

  const sw = $('#n-sw');
  sw.textContent = '';
  sw.appendChild(swatches(newColor, hex => { newColor = hex; renderCats() }));
}

$('#f-newcat').addEventListener('submit', e => {
  e.preventDefault();
  const input = $('#n-name');
  if (!input.value.trim()) return;
  Store.addCat(input.value, newColor);
  input.value = '';
  newColor = Store.PALETTE[Store.cats().length % Store.PALETTE.length];
  renderCats(); render();
  input.focus();
});

$('#btn-cats').addEventListener('click', () => { openIconFor = null; renderCats(); openSheet('cat') });
$('#btn-add').addEventListener('click', () => openChannel(null));
$('#btn-set').addEventListener('click', () => { renderSettings(); openSheet('set') });

/* ── Quick categorise ────────────────────────────────────────────────────────
   A menu at the tag you clicked. One element, reused, because only one can be
   open — and it closes on anything: a pick, a click elsewhere, Escape, a
   scroll. A menu that outlives the thing it was anchored to is worse than no
   menu at all. */
const qmenu = $('#qmenu');
let qFor = null;

function closeQuick(){
  if (!qFor) return;
  qFor = null;
  qmenu.hidden = true;
  qmenu.textContent = '';
}

function openQuick(id, anchor){
  const ch = Store.channels().find(c => c.id === id);
  if (!ch) return;
  const reopening = qFor === id;
  closeQuick();
  if (reopening) return;              /* clicking the same tag again shuts it */

  qFor = id;
  qmenu.textContent = '';

  const pick = (catId, name, color, icon, on) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'qi' + (on ? ' on' : '');
    b.style.setProperty('--c', color);
    const ic = iconEl(icon);
    if (ic) b.appendChild(ic);
    b.appendChild(document.createTextNode(name));
    b.addEventListener('click', () => {
      Store.updateChannel(id, { cat:catId });
      closeQuick();
      render();
    });
    return b;
  };

  Store.cats().forEach(c =>
    qmenu.appendChild(pick(c.id, c.name, c.color, c.icon, ch.cat === c.id)));
  qmenu.appendChild(pick('', 'uncategorised', 'var(--mu)', '', !ch.cat));

  qmenu.hidden = false;

  /* Anchored under the tag, then pulled back inside the window if that would
     put it off an edge. */
  const r = anchor.getBoundingClientRect();
  const w = qmenu.offsetWidth || 190, h = qmenu.offsetHeight || 200;
  const left = Math.max(8, Math.min(r.left, innerWidth - w - 8));
  const top = r.bottom + h + 8 > innerHeight ? Math.max(8, r.top - h - 6) : r.bottom + 6;
  qmenu.style.left = left + 'px';
  qmenu.style.top = top + 'px';
}

addEventListener('click', e => { if (!qmenu.contains(e.target)) closeQuick() });
addEventListener('scroll', closeQuick, true);
addEventListener('resize', closeQuick);

/* Settings.
   Every control writes straight through and re-renders the board behind the
   sheet, so the gradient is chosen by watching the cards change rather than by
   imagining what two hex values will look like. */
function renderSettings(){
  $('#s-heat-from').value = ui.heatFrom;
  $('#s-heat-to').value = ui.heatTo;
  $('#s-width').value = ui.maxWidth || 2600;
  $('#s-width-v').textContent = widthLabel(ui.maxWidth);
  $('#s-heat-prev').style.background =
    'linear-gradient(90deg,' + ui.heatFrom + ',' + ui.heatTo + ')';

  $$('#sheet-set .tog').forEach(t => t.classList.toggle('on', !!ui[t.dataset.ui]));

  /* Add mode only means something with a browser around it. */
  $('#s-addmode').hidden = !(typeof HubBridge !== 'undefined' && HubBridge.inExt);
}

/* The top of the range is "as wide as the window" rather than 2600px. An
   ultrawide is wider than any number worth putting on a slider, so the end of
   the track has to mean *off* or the setting cannot express it. */
const WIDTH_FULL = 2600;
const widthLabel = w => (!w || w >= WIDTH_FULL) ? 'full width' : w + 'px';

function applyWidth(){
  const w = ui.maxWidth;
  document.documentElement.style.setProperty(
    '--app-w', (!w || w >= WIDTH_FULL) ? 'none' : w + 'px');
}

$('#s-width').addEventListener('input', e => {
  const v = +e.target.value;
  ui = Store.setUi({ maxWidth: v >= WIDTH_FULL ? 0 : v });
  $('#s-width-v').textContent = widthLabel(ui.maxWidth);
  applyWidth();
});

/* ── Export and import ───────────────────────────────────────────────────── */
const said = msg => { $('#s-said').textContent = msg;
                      setTimeout(() => { if ($('#s-said').textContent === msg) $('#s-said').textContent = '' }, 4000) };

$('#s-export').addEventListener('click', () => {
  const blob = new Blob([Store.exportJSON()], { type:'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'hub-' + new Date().toISOString().slice(0, 10) + '.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  said('exported');
});

$('#s-import').addEventListener('click', () => $('#s-file').click());

$('#s-file').addEventListener('change', async e => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';                 /* so the same file can be picked twice */
  if (!file) return;
  let text;
  try { text = await file.text() } catch { return said('could not read that file') }
  const out = Store.importJSON(text);
  if (!out) return said('that is not a hub export');
  ui = Store.ui();
  sort = ui.sort; size = ui.size;
  sortSel.value = sort;
  $$('#size .seg-b').forEach(b => b.classList.toggle('on', b.dataset.size === size));
  picked.clear();
  applyWidth();
  renderSettings();
  render();
  said('imported ' + out.channels + ' channels, ' + out.cats + ' categories');
});

['From', 'To'].forEach(end => {
  $('#s-heat-' + end.toLowerCase()).addEventListener('input', e => {
    ui = Store.setUi({ ['heat' + end]: e.target.value });
    renderSettings(); render();
  });
});

$$('#sheet-set .tog').forEach(t => t.addEventListener('click', () => {
  const key = t.dataset.ui;
  ui = Store.setUi({ [key]: !ui[key] });
  renderSettings();
  render();
  /* Add mode is the one setting the extension has to hear about. */
  if (key === 'addMode' && typeof HubBridge !== 'undefined' && HubBridge.inExt)
    HubBridge.ask({ type:'setAddMode', on:ui.addMode });
}));

/* ── Bar ─────────────────────────────────────────────────────────────────── */
$('#q').addEventListener('input', e => { q = e.target.value; render() });

const sortSel = $('#sort');
sortSel.addEventListener('change', e => { sort = e.target.value; Store.setUi({ sort }); render() });

$$('#size .seg-b').forEach(b => {
  b.addEventListener('click', () => {
    size = b.dataset.size;
    $$('#size .seg-b').forEach(x => x.classList.toggle('on', x === b));
    Store.setUi({ size });
    render();                        /* FLIP carries the cards to their new boxes */
  });
});

/* ── Keys ────────────────────────────────────────────────────────────────────
   Three, and only where they cannot be mistaken for typing. */
addEventListener('keydown', e => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);

  if (e.key === 'Escape'){
    if (openName){ closeSheet(); return }
    if (typing && document.activeElement.id === 'q'){
      q = ''; document.activeElement.value = ''; document.activeElement.blur(); render();
    }
    return;
  }
  if (typing) return;

  if (e.key === '/'){ e.preventDefault(); $('#q').focus(); $('#q').select() }
  else if (e.key === 'n'){ e.preventDefault(); openChannel(null) }
});

/* ── The clock ───────────────────────────────────────────────────────────────
   "3m ago" is wrong a minute later, and the board is a window left open all
   day. Only the one label is repainted; nothing reorders under the cursor,
   even when the sort is by time. */
setInterval(() => {
  Store.channels().forEach(ch => {
    const el = nodes.get(ch.id);
    if (el) paintSeen(el, ch);
  });
}, 30e3);

/* Another tab of the same board is the same board. Only the data keys, not
   hub.ui.v1 — resizing the cards in one window should not reload the other. */
addEventListener('storage', e => {
  if (e.key === 'hub.channels.v1' || e.key === 'hub.cats.v1') location.reload();
});

/* Inside the extension the store watches chrome.storage instead, which is also
   how a channel added from a YouTube page reaches a board already open. */
Store.onChange(() => { ui = Store.ui(); render() });

/* Start.
   The store may have to be read out of chrome.storage, which is asynchronous.
   Nothing else in the app is: it waits here, once, and every read after this
   comes off the cache. */
(async () => {
  await Store.ready;
  ui = Store.ui();
  sort = ui.sort; size = ui.size;
  sortSel.value = sort;
  $$('#size .seg-b').forEach(b => b.classList.toggle('on', b.dataset.size === size));
  applyWidth();
  render();
})();

})();
