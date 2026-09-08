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
const sheet  = $('#sheet');

/* Board state. Not persisted beyond the two dials the eye notices across a
   reload — the size of the cards and how they are sorted. A search term and a
   category filter are things you are in the middle of, not settings. */
const ui = Store.ui();
let q = '';
let sort = ui.sort || 'seen';
let size = ui.size || 'm';
let picked = new Set();          /* empty = every category */

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
    '<div class="card-foot"><span class="tag"></span><span class="seen"></span></div>';

  /* The stamp is written on the way out, on the same click that opens the tab,
     so "last viewed" means "last time I actually went there". */
  el.querySelector('.card-hit').addEventListener('click', () => {
    Store.touch(ch.id);
    paintSeen(el, Store.channels().find(c => c.id === ch.id));
  });
  el.querySelector('.card-edit').addEventListener('click', e => {
    e.preventDefault(); e.stopPropagation();
    openChannel(ch.id);
  });
  return el;
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
  t.textContent = cat ? cat.name : 'uncategorised';
  t.classList.toggle('none', !cat);

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
    const b = document.createElement('button');
    b.className = 'chip' + (picked.has(c.id) ? ' on' : '');
    b.style.setProperty('--c', c.color);
    b.innerHTML = '<span class="t"></span><span class="n"></span>';
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
  openName = name;
  $('#f-ch').hidden  = name !== 'ch';
  $('#f-cat').hidden = name !== 'cat';
  scrim.hidden = sheet.hidden = false;
  scrim.classList.remove('out'); sheet.classList.remove('out');
}

function closeSheet(){
  if (!openName) return;
  openName = null;
  /* Focus is still in a field that is about to be hidden. Left there, the
     keyboard shortcuts stay dead until something else is clicked, because
     every one of them stands down while you are typing. */
  if (sheet.contains(document.activeElement)) document.activeElement.blur();
  if (REDUCED){ scrim.hidden = sheet.hidden = true; return }
  scrim.classList.add('out'); sheet.classList.add('out');
  const done = () => {
    if (openName) return;            /* reopened mid-animation — leave it alone */
    scrim.hidden = sheet.hidden = true;
    scrim.classList.remove('out'); sheet.classList.remove('out');
  };
  sheet.addEventListener('animationend', done, { once:true });
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

function swatches(current, onPick){
  const wrap = document.createElement('div');
  wrap.className = 'swatches';
  Store.PALETTE.forEach(hex => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sw' + (hex.toLowerCase() === (current || '').toLowerCase() ? ' on' : '');
    b.style.setProperty('--c', hex);
    b.title = hex;
    b.addEventListener('click', () => onPick(hex));
    wrap.appendChild(b);
  });
  return wrap;
}

function renderCats(){
  const box = $('#cat-list');
  box.textContent = '';

  Store.cats().forEach(c => {
    const r = document.createElement('div');
    r.className = 'cat-r';
    r.style.setProperty('--c', c.color);

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

    box.appendChild(r);
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

$('#btn-cats').addEventListener('click', () => { renderCats(); openSheet('cat') });
$('#btn-add').addEventListener('click', () => openChannel(null));

/* ── Bar ─────────────────────────────────────────────────────────────────── */
$('#q').addEventListener('input', e => { q = e.target.value; render() });

const sortSel = $('#sort');
sortSel.value = sort;
sortSel.addEventListener('change', e => { sort = e.target.value; Store.setUi({ sort }); render() });

$$('#size .seg-b').forEach(b => {
  b.classList.toggle('on', b.dataset.size === size);
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

render();

})();
