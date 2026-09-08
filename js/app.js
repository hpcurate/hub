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
const SHEETS = { ch:$('#sheet-ch'), cat:$('#sheet-cat'), set:$('#sheet-set'),
                q:$('#sheet-q'), card:$('#sheet-card') };

/* Board state. Not persisted beyond the two dials the eye notices across a
   reload — the size of the cards and how they are sorted. A search term and a
   category filter are things you are in the middle of, not settings. */
let ui = { ...HubModel.DEFAULT_UI };   /* replaced by the stored one once ready */
let q = '';
let sort = ui.sort;
let size = ui.size;
let picked = new Set();          /* empty = every category */
let onlyNew = false;             /* the "new" chip: only what has posted since */

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

/* Where a card goes. A channel's home page is a trailer and three shelves you
   have mostly seen; its videos tab is what was actually clicked for. Which tab
   is a setting, and `home` is still one of the answers.

   The scope — what the guard grants, and what the queue matches against — is
   always read from the stored URL, never from this. This decides where the tab
   lands, not what it is allowed to be. */
const openUrl = ch => HubScope.onTab(ch.url, ui.openTab);

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

  /* "Only what has something new" is a filter and not a sort, because the
     question it answers is "is there anything to watch", and the answer to that
     is allowed to be an empty board. */
  if (onlyNew) out = out.filter(c => Store.isNew(c));

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
      /* Newest upload first. The board has known each channel's latest video
         since v0.5.0 and could not be ordered by it, which is the one order a
         board of channels is actually asked for: what is new. Channels with
         nothing known sort to the end rather than to 1970. */
      case 'posted': return ((b.latest && b.latest.at) || 0) - ((a.latest && a.latest.at) || 0)
                          || byName(a, b);
      case 'name':  return byName(a, b);
      case 'cat':   return (order.has(a.cat) ? order.get(a.cat) : 1e6)
                         - (order.has(b.cat) ? order.get(b.cat) : 1e6) || byName(a, b);
    }
  });

  /* Pins are an exception to whichever sort is on, not a sort of their own, so
     they are lifted afterwards and keep their order among themselves. */
  if (ui.pinFirst) out = out.filter(c => c.pin).concat(out.filter(c => !c.pin));

  return out;
}

/* ── Cards ───────────────────────────────────────────────────────────────────
   Nodes are kept and reused across renders, keyed by id. That is what makes
   the reorder animation possible at all — a rebuilt DOM has nothing to move —
   and it also keeps hover and focus alive through a re-sort. */
const nodes = new Map();

/* ── The parts, and where they sit ───────────────────────────────────────────
   A card is six zones — two to a row, three rows — and every part of it names
   the one it is in. That is the whole model behind the card editor: nothing on
   a card has a place of its own any more, it has a slot, and a slot is
   somewhere you can move it to.

   The parts are built once with the card and kept on it. Placing is appending
   them into their zone in a fixed order, which only happens when the layout or
   the set of live parts actually changed — a card whose slots have not moved is
   not touched, so nothing loses focus or restarts an animation on a re-render. */
const ZONES = HubModel.ZONES;

function build(ch){
  const el = document.createElement('article');
  el.className = 'card';
  el.dataset.id = ch.id;
  el.innerHTML =
    '<a class="card-hit" target="_blank" rel="noopener noreferrer"></a>' +
    ZONES.filter((_, i) => i % 2 === 0).map((z, i) =>
      '<div class="zrow" data-r="' + 'tmb'[i] + '">' +
        '<div class="zone" data-z="' + ZONES[i * 2] + '"></div>' +
        '<div class="zone" data-z="' + ZONES[i * 2 + 1] + '"></div>' +
      '</div>').join('') +
    '<span class="wash"></span><span class="heat"></span>';

  /* Every movable part, made once. They live on the node rather than being
     looked up by selector, because half of them are not in the card at any
     given moment — a part that is switched off is detached, not hidden, so an
     empty zone is genuinely empty and its row can stand down. */
  const mk = (tag, cls, html) => {
    const n = document.createElement(tag);
    n.className = cls;
    if (html) n.innerHTML = html;
    return n;
  };
  const parts = {
    /* The picture, and what stands in for it. Both are always in the slot; which
       one is drawn is a class, because a channel gets its avatar minutes after
       it is added and the card should not be rebuilt when it arrives. */
    avatar: mk('span', 'av', '<img alt="" loading="lazy"><span class="av-fb"></span>'),
    dot:    mk('button', 'new'),
    name:   mk('h3', 'card-name'),
    desc:   mk('p', 'card-desc'),
    tag:    mk('button', 'tag'),
    badges: mk('span', 'badges'),
    count:  mk('span', 'card-n'),
    edit:   mk('button', 'card-edit'),
  };
  parts.dot.type = parts.tag.type = parts.edit.type = 'button';
  parts.dot.title = 'new since you last looked — click to clear';
  parts.tag.title = 'Categorise';
  parts.edit.title = 'Edit';
  parts.edit.textContent = '⋯';
  el._parts = parts;

  /* The stamp is written on the way out, on the same click that opens the tab,
     so "last viewed" means "last time I actually went there".

     Inside the extension the bridge takes the navigation instead, so the tab it
     opens is granted before it loads and the guard never sees an unpicked one.
     Off disk the bridge declines and the anchor behaves like an anchor. */
  el.querySelector('.card-hit').addEventListener('click', e => {
    /* Categorise mode: a click files the channel instead of opening it. The
       card is still a link, so the navigation has to be stopped first. */
    if (catMode){
      e.preventDefault(); e.stopPropagation();
      Store.updateChannel(ch.id, { cat: catModeTo });
      render();
      return;
    }
    Store.touch(ch.id);
    paintBadges(el, Store.channels().find(c => c.id === ch.id));
    if (typeof HubBridge !== 'undefined' && HubBridge.inExt){
      e.preventDefault();
      HubBridge.open(ch, { newTab: ui.newTab, url: openUrl(ch) });
    }
  });
  parts.edit.addEventListener('click', e => {
    e.preventDefault(); e.stopPropagation();
    openChannel(ch.id);
  });

  /* The dot is the control for the thing it means. One card's dot is cleared
     by clicking it; the whole board's by the button on the bar. */
  parts.dot.addEventListener('click', e => {
    e.preventDefault(); e.stopPropagation();
    Store.clearNew(ch.id);
    render();
  });

  /* Quick categorise: the tag is the control for the thing it names. Filing a
     channel should not need the edit pane — especially since anything added by
     the "+ add" button on YouTube arrives with no category at all. */
  parts.tag.addEventListener('click', e => {
    e.preventDefault(); e.stopPropagation();
    openQuick(ch.id, e.currentTarget);
  });
  return el;
}

/* Which parts this card is showing, in the order they sit inside a zone. A part
   that is off is not here, and so is not in the card at all. */
function liveParts(el, ch){
  const has = {
    avatar: ui.showAvatars && (!!ch.avatar || ui.avatarFallback !== 'none'),
    dot:    ui.showNew && Store.isNew(ch),
    name:   true,
    desc:   ui.showDesc,
    tag:    ui.showTag,
    badges: el._parts.badges.childElementCount > 0,
    count:  ui.showCounts && ui.countStyle === 'number',
    edit:   true,
  };
  return HubModel.PART_KEYS.filter(k => has[k]);
}

function place(el, ch){
  const live = liveParts(el, ch);
  const sig = live.map(k => k + ':' + ui.slots[k]).join('|');
  if (el.dataset.sig === sig) return;
  el.dataset.sig = sig;

  const zone = z => el.querySelector('.zone[data-z="' + z + '"]');
  ZONES.forEach(z => { zone(z).textContent = '' });
  HubModel.PART_KEYS.forEach(k => {
    const node = el._parts[k];
    if (!live.includes(k)){ node.remove(); return }
    zone(ui.slots[k]).appendChild(node);
  });
}

/* ── Badges ──────────────────────────────────────────────────────────────────
   The small facts along the bottom of a card. Each is a row in this list and a
   switch in settings, so adding one is a line rather than a pass through the
   renderer, the stylesheet and the settings pane.

   `get` returns the text, or null for "this card has nothing to say here" —
   which is not the same as the badge being off. A channel with no upload date
   known simply shows no upload badge, whatever the setting says. */
const BADGES = [
  { k:'showPin',    label:'a mark on a pinned channel', cls:'pin',
    note:'only ever on the pinned ones, so it costs the rest nothing',
    get: ch => ch.pin ? 'pinned' : null },
  { k:'showSeen',   label:'time since last viewed', cls:'seen',
    get: ch => since(ch.seen) },
  { k:'showCounts', label:'click count', cls:'count',
    get: ch => (ch.clicks || 0) + (ch.clicks === 1 ? ' open' : ' opens') },
  { k:'showPosted', label:'when the channel last posted', cls:'posted',
    note:'from its feed, in the extension only',
    get: ch => ch.latest && ch.latest.at ? 'posted ' + since(ch.latest.at) : null },
  { k:'showAdded',  label:'when you added it', cls:'added',
    get: ch => ch.added ? 'added ' + since(ch.added) : null },
  { k:'showRank',   label:'its place by clicks', cls:'rank',
    get: (ch, ctx) => ctx.rank.has(ch.id) ? '#' + ctx.rank.get(ch.id) : null },
  { k:'showQueued', label:'how many of its videos are queued', cls:'queued',
    get: (ch, ctx) => ctx.queued.get(ch.id) ? ctx.queued.get(ch.id) + ' queued' : null },
  { k:'showHandle', label:'its youtube handle', cls:'handle',
    get: ch => {
      const s = HubScope.parse(ch.url);
      return s && s.kind === 'handle' ? s.key : null;
    } },
];

/* Facts that are about the board rather than about one channel, worked out once
   per render instead of once per card. */
function badgeContext(){
  const rank = new Map();
  Store.channels()
    .filter(c => (c.clicks || 0) > 0)
    .sort((a, b) => (b.clicks || 0) - (a.clicks || 0))
    .forEach((c, i) => rank.set(c.id, i + 1));

  const queued = new Map();
  const byScope = new Map();
  Store.channels().forEach(c => {
    const s = HubScope.parse(c.url);
    if (s) byScope.set(s.kind + ':' + s.key, c.id);
  });
  Store.queue().forEach(q => {
    const s = q.channelUrl && HubScope.parse(q.channelUrl);
    const id = s && byScope.get(s.kind + ':' + s.key);
    if (id) queued.set(id, (queued.get(id) || 0) + 1);
  });

  return { rank, queued };
}

let badgeCtx = { rank:new Map(), queued:new Map() };

function paintBadges(el, ch){
  /* Opens can be a badge among the others, or a plain number of its own at the
     name's size. The second is a different thing to read, not a restyled
     version of the first, so it is its own part with its own slot and the badge
     stands down while it is on. */
  const asNumber = ui.showCounts && ui.countStyle === 'number';
  el._parts.count.textContent = asNumber ? String(ch.clicks || 0) : '';

  const box = el._parts.badges;
  box.textContent = '';
  BADGES.forEach(b => {
    if (!ui[b.k]) return;
    if (b.k === 'showCounts' && asNumber) return;
    const text = b.get(ch, badgeCtx);
    if (text == null) return;
    const s = document.createElement('span');
    s.className = 'badge b-' + b.cls;
    s.textContent = text;
    if (b.cls === 'seen'){
      s.classList.toggle('never', !ch.seen);
      s.classList.toggle('fresh', !!ch.seen && Date.now() - ch.seen < DAY);
    }
    box.appendChild(s);
  });
  el.classList.toggle('no-badges', !box.childElementCount);
  /* Whether there are any badges is part of what the card is showing, so where
     everything sits is settled here rather than a step later. */
  place(el, ch);
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
  const raw = max > 0 ? Math.min(1, (ch.clicks || 0) / max) : 0;
  /* Quantised. A continuous ramp over forty cards is forty colours nobody can
     tell apart, and a scale you cannot read is not a scale — it is a texture.
     Ten steps by default: few enough that two cards a step apart are visibly a
     step apart, many enough that the board still has a gradient across it. */
  const steps = Math.max(2, Math.round(ui.heatSteps || 10));
  const t = Math.round(raw * (steps - 1)) / (steps - 1);
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

function paint(el, ch){
  const cat = Store.cat(ch.cat);
  el.style.setProperty('--c', cat ? cat.color : 'var(--tx-2)');

  const hit = el.querySelector('.card-hit');
  hit.href = openUrl(ch);
  hit.setAttribute('aria-label', 'Open ' + ch.name + ' on YouTube');

  el._parts.name.textContent = ch.name;

  /* ── The avatar ────────────────────────────────────────────────────────────
     The fastest way to find a channel on a board of forty. When there is no
     picture — which is every channel on a board opened off disk, because a
     file:// page cannot fetch youtube.com — something stands in for it: the
     channel's initial, its category's icon, or a silhouette. */
  const av = el._parts.avatar;
  const img = av.querySelector('img');
  av.classList.toggle('has', !!ch.avatar);
  if (ch.avatar && img.getAttribute('src') !== ch.avatar) img.src = ch.avatar;
  if (!ch.avatar) img.removeAttribute('src');
  /* An avatar url can rotate. A broken image should read as "no avatar", which
     now means the fallback, not a torn page. */
  img.onerror = () => { av.classList.remove('has'); img.removeAttribute('src'); paintFallback(av, ch, cat) };
  paintFallback(av, ch, cat);

  /* The same picture again, huge and faint, behind the whole card. Off by
     default and a range rather than a switch, because the line between "a
     texture" and "a poster you cannot read the name on" is a number and it is
     not the same number for every board. */
  const wash = el.querySelector('.wash');
  const useWash = ch.avatar && ui.avatarWash > 0;
  /* encodeURI, and only then quoted: a url is data from YouTube's markup, and
     a quote inside one would otherwise end the CSS string and start something
     of its own. */
  wash.style.backgroundImage = useWash ? 'url("' + encodeURI(ch.avatar) + '")' : '';
  el.style.setProperty('--wash', useWash ? (ui.avatarWash / 100).toFixed(3) : '0');

  el.classList.toggle('is-new', Store.isNew(ch));
  /* Posted in the last day: not a dot but a whole card — a lit edge, a warmer
     ground and a glow, so what is worth opening right now is visible from the
     other side of the board. */
  el.classList.toggle('is-fresh', Store.isFresh(ch));
  if (ch.latest && ch.latest.title)
    el._parts.dot.title = ch.latest.title + ' — click to clear';

  const d = el._parts.desc;
  d.textContent = ch.desc || 'no description';
  d.classList.toggle('none', !ch.desc);

  const t = el._parts.tag;
  t.textContent = '';
  const ic = cat && iconEl(cat.icon);
  if (ic) t.appendChild(ic);
  t.appendChild(document.createTextNode(cat ? cat.name : 'uncategorised'));
  t.classList.toggle('none', !cat);
  t.classList.toggle('has-icon', !!ic);

  paintHeat(el, ch);
  paintBadges(el, ch);              /* which ends by placing everything */
}

/* What is drawn where the picture would be. `initial` is the first letter of
   the name with any @ dropped — the handle's @ is part of the URL, not of the
   name — `icon` is the category's own glyph, and `ghost` is a silhouette. All
   three take the category's colour from the card, so a board with no pictures
   at all still reads as a coloured board. */
const GHOST = '<circle cx="12" cy="9" r="3.6"/><path d="M4.5 20.5c0-4 3.4-6.4 7.5-6.4s7.5 2.4 7.5 6.4"/>';

function paintFallback(av, ch, cat){
  const box = av.querySelector('.av-fb');
  const how = ui.avatarFallback;
  box.textContent = '';
  av.dataset.fb = how;
  if (how === 'none' || ch.avatar) return;

  if (how === 'initial'){
    const name = String(ch.name || '').replace(/^@+/, '').trim();
    box.textContent = (name[0] || '?').toUpperCase();
    return;
  }
  if (how === 'icon'){
    const ic = cat && iconEl(cat.icon);
    if (ic){ box.appendChild(ic); return }
    /* A category with no icon, or none at all, has nothing to draw — the
       silhouette is the honest answer rather than an empty ring. */
  }
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'ico');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = GHOST;
  box.appendChild(svg);
}

/* ── FLIP ────────────────────────────────────────────────────────────────────
   A grid reorders by changing where boxes are, and there is no CSS transition
   for that. So: measure every card, do the reorder, measure again, and play
   each card from its old position back to its new one. */
function flip(mutate){
  const before = new Map();
  /* Measured against the document, not the viewport. Filtering the board makes
     it shorter, a shorter page makes the browser clamp the scroll position, and
     a rect taken before that clamp is in a different frame from one taken
     after. Every card then looks like it moved by the scroll delta, which is
     what "all the cards fly in from the top of the screen" was: they were
     animating from where they would have been if the page had not scrolled. */
  const sx0 = scrollX, sy0 = scrollY;
  if (!REDUCED) nodes.forEach((el, id) => {
    if (!el.isConnected) return;
    const r = el.getBoundingClientRect();
    before.set(id, { left:r.left + sx0, top:r.top + sy0 });
  });

  mutate();

  if (REDUCED) return;
  const sx1 = scrollX, sy1 = scrollY;
  nodes.forEach((el, id) => {
    const b = before.get(id); if (!b || !el.isConnected) return;
    const r = el.getBoundingClientRect();
    const dx = b.left - (r.left + sx1), dy = b.top - (r.top + sy1);
    if (!dx && !dy) return;
    /* A card that has genuinely moved most of a page is not worth watching
       travel. Past this it simply appears where it now is. */
    if (Math.abs(dx) > 1600 || Math.abs(dy) > 1600) return;
    el.animate(
      [{ transform:`translate(${dx}px, ${dy}px)` }, { transform:'none' }],
      { duration:340, easing:'cubic-bezier(.4,0,.2,1)' }
    );
  });
}

/* ── Render ────────────────────────────────────────────────────────────────
   Two ways a board can change shape, and they want different animations.

   A **reorder** — a different sort, a different card size — is the same set of
   cards in new boxes, so it is a FLIP: measure, move, play each card back from
   where it was. A **filter** is not that. Turning on a category leaves a board
   that mostly has nothing to do with the one before it, and FLIPping it makes
   the survivors slide in from wherever they happened to have been, which is the
   "sliding into place" this was asked to stop doing. So a filter change replays
   the board's own entry instead: the same staggered rise as opening HUB. */
let reintro = false;

function render(){
  const items = list();
  const total = Store.channels().length;

  grid.dataset.size = size;
  badgeCtx = badgeContext();
  renderCatBar();
  renderChips();
  renderQueue();
  renderDots();

  const cats = Store.cats().length;
  $('#meta').textContent = total
    ? total + (total === 1 ? ' channel' : ' channels') + ' · ' +
      cats + (cats === 1 ? ' category' : ' categories') +
      (items.length !== total ? ' · ' + items.length + ' shown' : '')
    : 'no channels yet';

  const intro = reintro; reintro = false;
  const entering = [];

  const mutate = () => {
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
        entering.push([el, i]);
      } else if (intro) entering.push([el, i]);
      paint(el, ch);
      grid.appendChild(el);            /* appendChild moves an existing node */
    });

    /* Off first, all of them, so the class can be put back on a card that
       already had it and actually restart the animation. */
    entering.forEach(([el]) => el.classList.remove('in'));
  };

  if (intro || REDUCED) mutate();
  else flip(mutate);

  if (entering.length && !REDUCED){
    void grid.offsetWidth;             /* one reflow for the lot, then play */
    entering.forEach(([el, i]) => {
      el.style.setProperty('--i', i);
      el.classList.add('in');
    });
  }

  empty.hidden = items.length > 0;
  if (!items.length){
    $('#empty-t').textContent = total ? 'nothing matches' : 'nothing here yet';
    $('#empty-s').textContent = total
      ? 'try a different category, or clear the search'
      : 'add a channel to start the board';
  }
}

/* ── The dots, all at once ───────────────────────────────────────────────────
   A board seeded in one go — the "+ add" button over a subscriptions page adds
   forty channels in a pass — arrives with a dot on every card, because every
   one of them has posted since a `seen` it has never had. That is forty marks
   saying the same nothing. This clears the lot.

   It stamps an acknowledgement, not a view: the cards still say never opened,
   because they have not been. */
function renderDots(){
  const btn = $('#btn-dots');
  if (!btn) return;
  const n = Store.countNew();
  btn.hidden = !n;
  $('#dots-n').textContent = n ? String(n) : '';

  /* The same count in the tab's own title. A board left open in a pinned tab —
     or installed, where the title is the window's — can then answer "is there
     anything new" without being looked at. */
  document.title = (ui.titleCount && n) ? 'HUB \u00b7 ' + n + ' new' : 'HUB';
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
  all.addEventListener('click', () => { picked.clear(); reintro = true; render() });
  chips.appendChild(all);

  /* Not a category — a question the board can be asked across all of them: is
     there anything to watch. It is only there when the answer is yes, or when
     it is already on and about to become no. */
  const newN = Store.countNew();
  if (newN || onlyNew){
    const b = document.createElement('button');
    b.className = 'chip only-new' + (onlyNew ? ' on' : '');
    b.id = 'chip-new';
    b.style.setProperty('--c', ui.newDotColor || 'var(--y)');
    b.innerHTML = '<span class="t">new</span><span class="n"></span>';
    b.querySelector('.n').textContent = newN;
    b.title = 'Only channels that have posted since you last looked';
    b.addEventListener('click', () => { onlyNew = !onlyNew; reintro = true; render() });
    chips.appendChild(b);
  }

  /* Favourites first. The manager's order is Hugo's and stays his; this is the
     order of the bar you actually pick from, where the four categories used
     every day should not be somewhere in the middle of eleven. */
  Store.pickCats().forEach(c => {
    const n = chans.filter(x => x.cat === c.id).length;
    /* An empty category still exists — it is only kept out of the bar. One that
       is switched on stays, or turning it off would need a trip to settings. */
    if (ui.hideEmpty && !n && !picked.has(c.id)) return;
    const b = document.createElement('button');
    b.className = 'chip' + (picked.has(c.id) ? ' on' : '') + (c.fav ? ' fav' : '');
    b.style.setProperty('--c', c.color);
    b.innerHTML = '<span class="t"></span><span class="n"></span>';
    const ic = iconEl(c.icon);
    if (ic) b.insertBefore(ic, b.firstChild);
    b.classList.toggle('has-icon', !!ic);
    b.querySelector('.t').textContent = c.name;
    b.querySelector('.n').textContent = n;
    b.addEventListener('click', () => { toggle(c.id); reintro = true; render() });
    chips.appendChild(b);
  });

  if (loose){
    const b = document.createElement('button');
    b.className = 'chip' + (picked.has('') ? ' on' : '');
    b.style.setProperty('--c', 'var(--mu)');
    b.innerHTML = '<span class="t">uncategorised</span><span class="n"></span>';
    b.querySelector('.n').textContent = loose;
    b.addEventListener('click', () => { toggle(''); reintro = true; render() });
    chips.appendChild(b);
  }
}
function toggle(id){ picked.has(id) ? picked.delete(id) : picked.add(id) }

/* ── Categorise mode ─────────────────────────────────────────────────────────
   The quick menu on a tag files one channel. This files many: pick a category
   once, then click through the cards. Asked for as "hit the toggle, select a
   category, tap the channel card".

   While it is on the board is not a set of links, and it says so loudly — a
   mode you can be in without noticing is a mode that opens YouTube when you
   meant to file something. It ends on the toggle, on "done", or on Escape. */
let catMode = false;
let catModeTo = '';

function renderCatBar(){
  const bar = $('#catbar');
  bar.hidden = !catMode;
  document.documentElement.classList.toggle('cat-mode', catMode);
  $('#btn-catmode').classList.toggle('on', catMode);
  if (!catMode) return;

  const box = $('#cb-pick');
  box.textContent = '';

  const pick = (id, name, color, icon) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip' + (catModeTo === id ? ' on' : '');
    b.style.setProperty('--c', color);
    const ic = iconEl(icon);
    if (ic){ b.appendChild(ic); b.classList.add('has-icon') }
    b.appendChild(document.createTextNode(name));
    b.addEventListener('click', () => { catModeTo = id; renderCatBar() });
    box.appendChild(b);
  };

  Store.pickCats().forEach(c => pick(c.id, c.name, c.color, c.icon));
  pick('', 'uncategorised', 'var(--mu)', '');
}

function setCatMode(on){
  catMode = on;
  if (on){
    closeQuick();
    /* Start on whichever category is being filtered for, if exactly one is —
       filtering to a category and then filing into it is the obvious pass. */
    if (!catModeTo && picked.size === 1) catModeTo = [...picked][0];
    if (!catModeTo && Store.cats().length) catModeTo = Store.cats()[0].id;
  }
  renderCatBar();
  render();
}

$('#btn-catmode').addEventListener('click', () => setCatMode(!catMode));
$('#cb-done').addEventListener('click', () => setCatMode(false));

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
  Store.pickCats().forEach(c => box.appendChild(mk(c.id, c.name, c.color, sel === c.id)));
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

  /* Pinning is not a property of the channel you are typing, it is a thing you
     do to one that exists — so it writes through immediately rather than
     waiting for save, and it is not on the new-channel pane at all. */
  const pin = $('#c-pin');
  pin.hidden = !ch;
  const drawPin = () => {
    const on = !!(editing && Store.channels().find(c => c.id === editing) || {}).pin;
    pin.classList.toggle('on', on);
    pin.textContent = on ? '\u2605 pinned' : '\u2606 pin';
    pin.title = on ? 'Pinned to the front of the board' : 'Pin to the front of the board';
    pin.setAttribute('aria-pressed', on ? 'true' : 'false');
  };
  drawPin();
  pin.onclick = () => { Store.togglePin(editing); drawPin(); render() };

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
   than the presets rather than somewhere else entirely.

   `onPick` is called with (hex, live). A native colour picker fires `input` on
   every drag, and the caller must not rebuild this row while it does — the
   element the picker belongs to would be replaced and the picker would shut.
   That was the "menu pops up and immediately disappears" bug: the row redrew
   itself out from under the dialog on the first event it sent. `live` is true
   for those, false for a preset click and for the final `change`. */
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
    b.addEventListener('click', () => onPick(hex, false));
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
  /* input while the dialog is open, change when it closes. The first is a
     preview and must not disturb the DOM; the second is the commit. */
  inp.addEventListener('input', () => onPick(inp.value, true));
  inp.addEventListener('change', () => onPick(inp.value, false));
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

    /* ── Favourite ───────────────────────────────────────────────────────────
       A star, first in the row, because it is the only thing here that changes
       where the category shows up rather than what it looks like. Favourites
       are pinned to the front of the chips, the quick menu and the filing bar —
       every list you pick a category from — while the order in this pane, which
       is set by hand with the arrows, is left exactly as it is. */
    const fb = document.createElement('button');
    fb.type = 'button';
    fb.className = 'cat-fav' + (c.fav ? ' on' : '');
    fb.dataset.fav = c.id;
    fb.title = c.fav ? 'A favourite — first in every picker' : 'Make it a favourite';
    fb.setAttribute('aria-pressed', c.fav ? 'true' : 'false');
    fb.textContent = c.fav ? '★' : '☆';
    fb.addEventListener('click', () => { Store.toggleFav(c.id); renderCats(); render() });
    r.appendChild(fb);

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

    r.appendChild(swatches(c.color, (hex, live) => {
      Store.updateCat(c.id, { color:hex });
      /* Live: paint what is already on screen and touch nothing else, so the
         open colour dialog keeps the element it belongs to. */
      r.style.setProperty('--c', hex);
      render();
      if (!live) renderCats();
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
  sw.appendChild(swatches(newColor, (hex, live) => {
    newColor = hex;
    if (!live) renderCats();
  }));
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
$('#btn-card').addEventListener('click', () => { renderCard(); openSheet('card') });

/* Every dot at once. Two steps, like every other clearing button on the board:
   the first arms it, the second does it. Nothing is destroyed — the dots come
   back the moment any of these channels posts again — but forty of them is not
   a thing to undo by hand, so it asks. */
$('#btn-dots').addEventListener('click', function(){
  if (!this.classList.contains('armed')){
    this.classList.add('armed');
    setTimeout(() => this.classList.remove('armed'), 3000);
    return;
  }
  this.classList.remove('armed');
  Store.clearNew();
  render();          /* the button going away is the answer */
});
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

  Store.pickCats().forEach(c =>
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

/* ── Settings ────────────────────────────────────────────────────────────────
   The controls are a list, not markup. There are enough of them now that
   writing each one out by hand is how two of them end up behaving differently,
   and adding one should be a line rather than a form.

   Every entry names a key in the stored ui object. Writing it is the same three
   steps whatever the control is: store it, apply the look, redraw the board.
   `ext` marks the ones that only mean something with a browser around them. */
const WIDTH_FULL = 2600;
const widthLabel = w => (!w || w >= WIDTH_FULL) ? 'full width' : w + 'px';

/* Four bundles. A preset is not a mode — it writes the same dials the rows
   below write, and every one of them is still yours afterwards. That is why
   there is no "custom" preset and nothing is highlighted: once you move a dial
   you are not on a preset any more, and pretending otherwise would be a lie the
   settings pane tells about itself.

   Since the card editor, a preset writes slots and zones too, which is what
   makes "poster" a different card rather than the same card with a bigger
   picture: the avatar and the name are stacked in the top-left zone instead of
   sitting side by side in it. */
const PRESETS = [
  { name:'classic', ui:{ layout:'card',
      slots:{ avatar:'tl', dot:'tr', name:'tl', desc:'ml', tag:'bl', badges:'br',
              count:'br', edit:'tr' },
      zones:{ tl:'row', tr:'row', ml:'top', mr:'top', bl:'row', br:'row' },
      avatarSize:30, nameLines:2, gap:12, border:'hairline', surface:'raised',
      showDesc:true, descLines:4, showAvatars:true,
      avatarShape:'circle', avatarBorder:'hairline', dotOnAvatar:false,
      countStyle:'badge', nameSize:17, descSize:12.5, badgeSize:10 } },
  { name:'compact', ui:{ layout:'compact',
      slots:{ avatar:'tl', dot:'tl', name:'tl', desc:'ml', tag:'bl', badges:'br',
              count:'br', edit:'tr' },
      zones:{ tl:'row', tr:'row', ml:'top', mr:'top', bl:'row', br:'row' },
      avatarSize:24, nameLines:1, gap:8, border:'hairline', surface:'raised',
      showDesc:false, showAvatars:true,
      avatarShape:'circle', avatarBorder:'none', dotOnAvatar:false,
      countStyle:'badge', nameSize:15, badgeSize:9.5 } },
  { name:'list', ui:{ layout:'list',
      slots:{ avatar:'tl', dot:'tl', name:'tl', desc:'ml', tag:'bl', badges:'br',
              count:'br', edit:'tr' },
      zones:{ tl:'row', tr:'row', ml:'top', mr:'top', bl:'row', br:'row' },
      avatarSize:28, nameLines:1, gap:6, border:'hairline', surface:'flat',
      showDesc:false, showAvatars:true,
      avatarShape:'rounded', avatarBorder:'none', dotOnAvatar:false,
      countStyle:'number', nameSize:14.5, badgeSize:9.5 } },
  { name:'poster', ui:{ layout:'card',
      slots:{ avatar:'tl', dot:'tr', name:'tl', desc:'ml', tag:'bl', badges:'bl',
              count:'br', edit:'tr' },
      zones:{ tl:'column', tr:'row', ml:'top', mr:'top', bl:'column', br:'row' },
      avatarSize:52, nameLines:2, gap:16, border:'accent', surface:'raised',
      showDesc:true, descLines:3, showAvatars:true,
      avatarShape:'rounded', avatarBorder:'accent', dotOnAvatar:true,
      countStyle:'number', nameSize:19, descSize:12, badgeSize:10 } },
];

/* ── The card editor ─────────────────────────────────────────────────────────
   Its own pane, because a card is its own thing: a live one at the top, built
   and painted by the same two functions the board uses, and under it every dial
   that decides what it looks like. Nothing there is a preview in the sense of
   an approximation — it is a card, drawn by the renderer, from the settings as
   they stand this instant.

   `part` rows are the new control: a switch for whether the part is on the card
   at all, and a six-cell map of the card for where it goes. */
const CARD_SETTINGS = [
  ['shape', [
    { k:'preset', t:'preset', label:'presets',
      note:'a starting point, not a mode: every dial below stays yours' },
    { k:'layout',  t:'seg',   label:'card shape', opts:['card', 'compact', 'list'] },
    { k:'gap',     t:'range', label:'space between cards', min:4, max:28, step:2, fmt:v => v + 'px' },
    { k:'border',  t:'seg',   label:'card edge', opts:['hairline', 'none', 'accent'] },
    { k:'surface', t:'seg',   label:'card ground', opts:['raised', 'flat'] },
  ]],
  ['where each part sits', HubModel.PARTS.map(pt =>
    ({ k:'slot-' + pt.k, t:'part', part:pt.k, label:pt.label, show:pt.show }))],
  ['how each zone stacks', [
    { k:'zones', t:'zones', label:'the six zones',
      note:'side by side, hung from the top, or stacked' },
  ]],
  ['the avatar', [
    { k:'avatarSize',     t:'range', label:'size', min:20, max:96, step:2, fmt:v => v + 'px' },
    { k:'avatarShape',    t:'seg',   label:'shape',
      opts:['circle', 'rounded', 'squircle', 'square', 'hex'] },
    { k:'avatarBorder',   t:'seg',   label:'edge', opts:['hairline', 'none', 'accent', 'ring'] },
    { k:'avatarFit',      t:'seg',   label:'how the picture fills it',
      opts:['cover', 'contain'], note:'cover crops it, contain fits the whole of it in' },
    { k:'avatarTone',     t:'seg',   label:'colour',
      opts:['full', 'mono', 'hover', 'tint'],
      note:'hover is grey until you point at it; tint takes the category colour' },
    { k:'avatarFallback', t:'seg',   label:'when there is no picture',
      opts:['initial', 'icon', 'ghost', 'none'],
      note:'off disk there are never any — the board cannot fetch youtube' },
    { k:'avatarWash',     t:'range', label:'the picture, behind the card',
      min:0, max:30, step:1, fmt:v => v ? v + '%' : 'off',
      note:'huge and faint, as the card\u2019s own ground' },
  ]],
  ['the parts themselves', [
    { k:'nameLines',    t:'range', label:'lines for the name', min:1, max:4, step:1, fmt:String },
    { k:'descLines',    t:'range', label:'description lines', min:1, max:8, step:1, fmt:String },
    { k:'countStyle',   t:'seg',   label:'how the count reads',
      opts:['badge', 'number'], note:'a badge among the others, or a number of its own' },
    { k:'dotOnAvatar',  t:'toggle', label:'pin the dot to the avatar',
      note:'the corner of the picture, which is the one place that is not a zone' },
    { k:'newDotSize',   t:'range', label:'dot size', min:4, max:14, step:1, fmt:v => v + 'px' },
    { k:'newDotColor',  t:'color', label:'dot colour', accent:true },
  ]],
  ['posted today', [
    { k:'showFresh',  t:'toggle', label:'light up a card with a fresh upload',
      note:'a lit edge and a glow, so it reads from across the board' },
    { k:'freshHours', t:'range', label:'how fresh is fresh', min:1, max:72, step:1,
      fmt:v => v + 'h' },
  ]],
];

const SETTINGS = [
  ['type', [
    { k:'titleSize', t:'range', label:'the wordmark', min:28, max:80, step:2, fmt:v => v + 'px' },
    { k:'nameSize',  t:'range', label:'channel name', min:12, max:26, step:.5, fmt:v => v + 'px' },
    { k:'descSize',  t:'range', label:'description', min:9, max:17, step:.5, fmt:v => v + 'px' },
    { k:'badgeSize', t:'range', label:'badges', min:8, max:14, step:.5, fmt:v => v + 'px' },
  ]],
  ['look', [
    { k:'accent',   t:'color', label:'accent colour' },
    { k:'maxWidth', t:'range', label:'content width', min:880, max:WIDTH_FULL, step:40,
      note:'an ultrawide does not want the whole screen', fmt:widthLabel, full:WIDTH_FULL },
    { k:'radius',   t:'range', label:'corner radius', min:0, max:16, step:1, fmt:v => v + 'px' },
    { k:'motion',   t:'range', label:'motion', min:0, max:2, step:0.1,
      fmt:v => v <= 0 ? 'none' : (+v).toFixed(1) + 'x' },
  ]],
  ['the card', [
    { k:'cardeditor', t:'link', label:'open the card editor',
      note:'what a card shows, and where on it each part sits' },
  ]],
  ['what a card says', [
    { k:'showPin',    t:'toggle', label:'a mark on a pinned channel' },
    { k:'showSeen',   t:'toggle', label:'time since last viewed' },
    { k:'showCounts', t:'toggle', label:'click counts' },
    { k:'showHeat',   t:'toggle', label:'click heat line' },
    { k:'heat',       t:'heat',   label:'heat gradient',
      note:'from the channel you open least to the one you open most' },
    { k:'heatSteps',  t:'range',  label:'how many colours the heat has',
      min:2, max:20, step:1, fmt:v => v + ' steps',
      note:'a scale you can read one card against another with' },
    { k:'showPosted', t:'toggle', label:'when the channel last posted',
      note:'read from its feed, in the extension only' },
    { k:'showAdded',  t:'toggle', label:'when you added it' },
    { k:'showRank',   t:'toggle', label:'its place on the board by clicks' },
    { k:'showQueued', t:'toggle', label:'how many of its videos you have queued' },
    { k:'showHandle', t:'toggle', label:'its youtube handle' },
  ]],
  ['board', [
    { k:'hideEmpty',  t:'toggle', label:'hide empty categories' },
    { k:'pinFirst',   t:'toggle', label:'pinned channels first',
      note:'ahead of whatever the board is sorted by' },
    { k:'titleCount', t:'toggle', label:'the number of new videos in the tab title',
      note:'what makes a pinned tab, or an installed app, worth having' },
    { k:'favFirst',   t:'toggle', label:'favourite categories first',
      note:'in the chips, the quick menu and the filing bar' },
    { k:'openTab',    t:'seg',    label:'where a card lands',
      opts:['videos', 'home'], note:'a channel home page is a trailer and three shelves' },
    { k:'enterOpens', t:'toggle', label:'enter opens the first result',
      note:'type in search, press enter' },
    { k:'newTab',     t:'toggle', label:'open channels in a new tab', ext:true },
  ]],
  ['this app', [
    { k:'install', t:'install', label:'install hub',
      note:'its own window, its own icon, and it opens with no network' },
  ]],
  ['youtube', [
    { k:'addMode',     t:'toggle', label:'add mode',
      note:'stops the guard and puts a + add button on channel pages', ext:true },
    { k:'queueButton', t:'toggle', label:'a + queue button on video pages', ext:true },
    { k:'checkNew',    t:'toggle', label:'check channels for new videos', ext:true },
    { k:'checkEvery',  t:'range',  label:'how often the feed is checked', min:1, max:48, step:1,
      fmt:v => v + 'h', ext:true },
    { k:'pageDays',    t:'range',  label:'how long an avatar is trusted', min:1, max:60, step:1,
      fmt:v => v + (v === 1 ? ' day' : ' days'),
      note:'a channel page is a megabyte and an avatar never changes', ext:true },
    { k:'lanes',       t:'range',  label:'channels asked at once', min:1, max:8, step:1,
      fmt:String, note:'the whole of how fast a refresh is', ext:true },
  ]],
];

const inExt = () => typeof HubBridge !== 'undefined' && HubBridge.inExt;

/* ── Applying it ─────────────────────────────────────────────────────────────
   Four of the dials are tokens the whole stylesheet already draws with, so
   setting them here moves the system rather than one rule. The card toggles are
   classes on the grid, for the same reason: one switch, not a pass over every
   card.

   `boards` is the board itself plus the card editor's own one-card grid, so the
   card in the editor is drawn by exactly the rules the board is drawn by. */
function boards(){
  const prev = $('#card-prev');
  return prev ? [grid, prev] : [grid];
}

function applyLook(){
  const r = document.documentElement.style;
  r.setProperty('--app-w', (!ui.maxWidth || ui.maxWidth >= WIDTH_FULL) ? 'none' : ui.maxWidth + 'px');
  r.setProperty('--y', ui.accent);
  r.setProperty('--r-base', ui.radius + 'px');
  r.setProperty('--mo', String(ui.motion));
  r.setProperty('--desc-lines', String(ui.descLines));
  r.setProperty('--name-lines', String(ui.nameLines));
  r.setProperty('--av-size', ui.avatarSize + 'px');
  r.setProperty('--grid-gap', ui.gap + 'px');

  boards().forEach(g => {
    g.dataset.layout = ui.layout;
    g.dataset.border = ui.border;
    g.dataset.surface = ui.surface;
    g.dataset.avatarBorder = ui.avatarBorder;
    g.dataset.count = ui.countStyle;
    g.dataset.avatar = ui.avatarShape;
    g.dataset.avatarFit = ui.avatarFit;
    g.dataset.avatarTone = ui.avatarTone;
    g.dataset.dot = ui.dotOnAvatar ? 'avatar' : 'slot';
    /* Every zone's own direction, as one attribute each. A zone is a flex box
       and this is which way it runs, which is the only thing the stylesheet
       needs to be told about the card editor at all. */
    /* setAttribute, not dataset: `dataset.zoneTL` spells itself data-zone-t-l,
       which is a different attribute from the one the stylesheet selects. */
    HubModel.ZONES.forEach(z => { g.setAttribute('data-zone-' + z, ui.zones[z]) });

    g.classList.toggle('no-heat',   !ui.showHeat);
    g.classList.toggle('no-counts', !ui.showCounts);
    g.classList.toggle('no-avatar', !ui.showAvatars);
    g.classList.toggle('no-desc',   !ui.showDesc);
    g.classList.toggle('no-tag',    !ui.showTag);
    g.classList.toggle('no-seen',   !ui.showSeen);
    g.classList.toggle('no-new',    !ui.showNew);
    g.classList.toggle('no-fresh',  !ui.showFresh);
  });

  r.setProperty('--name-px', ui.nameSize + 'px');
  r.setProperty('--desc-px', ui.descSize + 'px');
  r.setProperty('--badge-px', ui.badgeSize + 'px');
  r.setProperty('--title-px', ui.titleSize + 'px');
  r.setProperty('--dot-size', ui.newDotSize + 'px');
  r.setProperty('--dot-c', ui.newDotColor || 'var(--y)');
}

function write(key, value){
  ui = Store.setUi({ [key]: value });
  applyLook();
  render();
  renderPreview();
  if (key === 'addMode' && inExt()) HubBridge.ask({ type:'setAddMode', on:ui.addMode });
}

/* A slot and a zone direction are one key each inside an object, so they are
   written as the whole object. The store fills anything missing back in, which
   is what keeps a half-written slots map from ever reaching storage. */
const writeSlot = (part, zone) => write('slots', { ...ui.slots, [part]:zone });
const writeZone = (zone, dir)  => write('zones', { ...ui.zones, [zone]:dir });

function renderSettings(){
  buildPane($('#set-body'), SETTINGS);
  $('#s-refresh').hidden = !(typeof HubEnrich !== 'undefined' && HubEnrich.can());
}

function buildPane(box, spec){
  box.textContent = '';
  spec.forEach(([name, items]) => {
    /* `ext` rows only mean something with a browser extension around them;
       `web` rows only mean something when the board is being served, which is
       neither the extension nor a file off disk. */
    const live = items.filter(it => (!it.ext || inExt()) && (it.t !== 'install' || HubApp.can));
    if (!live.length) return;
    const h = document.createElement('p');
    h.className = 'set-h';
    h.textContent = name;
    box.appendChild(h);
    live.forEach(it => box.appendChild(control(it)));
  });
}

/* ── The card editor ─────────────────────────────────────────────────────────
   One real card at the top and every dial under it. The card is built by
   `build` and painted by `paint` — the board's own two functions — inside a
   `.grid` of its own, so it inherits every rule the board's cards do and there
   is no second renderer to keep in step.

   It stands in for a channel when the board is empty, and is the first channel
   on it otherwise: editing the look of a card you recognise beats editing the
   look of a sample. */
const SAMPLE_AVATAR =
  'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
    '<rect width="64" height="64" fill="#252525"/>' +
    '<circle cx="32" cy="26" r="11" fill="#4a4a4a"/>' +
    '<path d="M10 62c0-13 10-21 22-21s22 8 22 21z" fill="#4a4a4a"/></svg>');

function sampleChannel(){
  const real = Store.channels()[0];
  const base = {
    id:'__preview__', url:'https://www.youtube.com/@example', name:'@example',
    desc:'what it is, and why it is on the board',
    cat:(Store.cats()[0] || {}).id || '',
    added:Date.now() - 12 * DAY, seen:Date.now() - 5 * HR, clicks:Store.maxClicks() || 8,
    ytId:'UCpreview', avatar:SAMPLE_AVATAR, checkedAt:Date.now(), pageAt:Date.now(), dotAt:0,
    latest:{ videoId:'preview', title:'a video from two hours ago', at:Date.now() - 2 * HR },
  };
  if (!real) return base;
  return { ...base, name:real.name, desc:real.desc || base.desc, cat:real.cat,
           url:real.url, clicks:real.clicks || base.clicks,
           avatar:real.avatar || SAMPLE_AVATAR, added:real.added || base.added,
           seen:real.seen || base.seen };
}

let previewCard = null;

function renderPreview(){
  const box = $('#card-prev');
  if (!box) return;
  const ch = sampleChannel();
  if (!previewCard || !previewCard.isConnected){
    box.textContent = '';
    previewCard = build(ch);
    box.appendChild(previewCard);
  }
  paint(previewCard, ch);
}

function renderCard(){
  buildPane($('#card-body'), CARD_SETTINGS);
  previewCard = null;
  renderPreview();
}

function control(it){
  const row = document.createElement('div');
  row.className = 'set-r set-' + it.t;
  row.dataset.k = it.k;      /* the key this row writes, for tests and for hooks */

  const lab = document.createElement('div');
  lab.className = 'set-l';
  const t = document.createElement('span');
  t.className = 'set-t';
  t.textContent = it.label;
  lab.appendChild(t);
  if (it.note){
    const n = document.createElement('em');
    n.textContent = it.note;
    lab.appendChild(n);
  }
  row.appendChild(lab);

  if (it.t === 'toggle'){
    row.classList.add('as-button');
    row.appendChild(document.createElement('b'));
    row.classList.toggle('on', !!ui[it.k]);
    row.setAttribute('role', 'button');
    row.tabIndex = 0;
    const flip = () => { write(it.k, !ui[it.k]); row.classList.toggle('on', !!ui[it.k]) };
    row.addEventListener('click', flip);
    row.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); flip() }
    });
  }

  if (it.t === 'range'){
    const wrap = document.createElement('div');
    /* Not `set-range`: the row itself is `set-r set-<type>`, so a wrapper by
       that name was the same class as its own parent. `#set-body` is a column
       flex box, so the row inherited `flex:0 0 210px` as a *height* and every
       slider in settings sat in a 210px-tall row. */
    wrap.className = 'set-slide';
    const inp = document.createElement('input');
    inp.type = 'range'; inp.min = it.min; inp.max = it.max; inp.step = it.step;
    inp.value = (it.full && !ui[it.k]) ? it.full : ui[it.k];
    inp.id = 's-' + it.k;
    const out = document.createElement('output');
    out.textContent = it.fmt(ui[it.k]);
    inp.addEventListener('input', () => {
      const raw = +inp.value;
      /* The top of a "full" range means off, not its own number: an ultrawide
         is wider than anything worth putting on a track. */
      const v = (it.full && raw >= it.full) ? 0 : raw;
      write(it.k, v);
      out.textContent = it.fmt(v);
    });
    wrap.append(inp, out);
    row.appendChild(wrap);
  }

  if (it.t === 'color'){
    const wrap = document.createElement('div');
    wrap.className = 'col-wrap';
    const inp = document.createElement('input');
    inp.type = 'color';
    inp.value = /^#[0-9a-f]{6}$/i.test(ui[it.k] || '') ? ui[it.k] : ui.accent;
    inp.id = 's-' + it.k;
    inp.addEventListener('input', () => write(it.k, inp.value));
    wrap.appendChild(inp);

    /* Some colours are allowed to mean "whatever the accent is", which is not
       something a colour input can say on its own. */
    if (it.accent){
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn btn-s' + (ui[it.k] ? '' : ' on');
      b.textContent = 'accent';
      b.addEventListener('click', () => { write(it.k, ''); renderSettings() });
      wrap.appendChild(b);
    }
    row.appendChild(wrap);
  }

  if (it.t === 'seg'){
    const seg = document.createElement('div');
    seg.className = 'seg';
    it.opts.forEach(o => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'seg-b wide' + (ui[it.k] === o ? ' on' : '');
      b.textContent = o;
      b.dataset.v = o;
      b.addEventListener('click', () => {
        write(it.k, o);
        [...seg.children].forEach(x => x.classList.toggle('on', x === b));
      });
      seg.appendChild(b);
    });
    row.appendChild(seg);
  }

  if (it.t === 'preset'){
    const row2 = document.createElement('div');
    row2.className = 'presets';
    PRESETS.forEach(p2 => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'btn btn-s'; b.textContent = p2.name;
      b.dataset.preset = p2.name;
      b.addEventListener('click', () => {
        ui = Store.setUi(p2.ui);
        applyLook();
        render();
        /* Both panes carry the presets row, and a preset moves dials in both,
           so both are redrawn — whichever one it was pressed in. */
        renderSettings();
        renderCard();
        said('applied ' + p2.name);
      });
      row2.appendChild(b);
    });
    row.appendChild(row2);
  }

  /* ── A part, and where it sits ─────────────────────────────────────────────
     The row for one movable piece of a card: a switch for whether it is on the
     card at all, and a map of the card — six cells, two to a row, in the shape
     of the thing being edited — for which zone it lives in. Clicking a cell is
     the whole gesture; there is nothing to drag and nothing to drop. */
  if (it.t === 'part'){
    if (it.show){
      const sw = document.createElement('button');
      sw.type = 'button';
      sw.className = 'part-sw' + (ui[it.show] ? ' on' : '');
      sw.dataset.show = it.show;
      sw.title = ui[it.show] ? 'on the card' : 'off the card';
      sw.setAttribute('aria-pressed', ui[it.show] ? 'true' : 'false');
      sw.appendChild(document.createElement('b'));
      sw.addEventListener('click', () => {
        write(it.show, !ui[it.show]);
        sw.classList.toggle('on', !!ui[it.show]);
        sw.setAttribute('aria-pressed', ui[it.show] ? 'true' : 'false');
        sw.title = ui[it.show] ? 'on the card' : 'off the card';
      });
      row.appendChild(sw);
    }

    const map = document.createElement('div');
    map.className = 'zone-map';
    HubModel.ZONES.forEach(z => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'zc' + (ui.slots[it.part] === z ? ' on' : '');
      b.dataset.z = z;
      b.title = HubModel.ZONE_NAMES[z];
      b.setAttribute('aria-label', it.label + ': ' + HubModel.ZONE_NAMES[z]);
      b.addEventListener('click', () => {
        writeSlot(it.part, z);
        [...map.children].forEach(x => x.classList.toggle('on', x === b));
      });
      map.appendChild(b);
    });
    row.appendChild(map);
  }

  /* ── The zones ─────────────────────────────────────────────────────────────
     Six cells again, in the same shape, but each one is a choice rather than a
     target: whether what is in that zone sits side by side, hangs from the top,
     or stacks. That last one is how the avatar gets above the name rather than
     beside it, which used to be its own setting and is now a property of the
     place it is in. */
  if (it.t === 'zones'){
    row.classList.add('as-block');
    const map = document.createElement('div');
    map.className = 'zone-grid';
    const DIRS = [['row', '↔', 'side by side'],
                  ['top', '↱', 'hung from the top'],
                  ['column', '↕', 'stacked']];
    HubModel.ZONES.forEach(z => {
      const cell = document.createElement('div');
      cell.className = 'zg';
      cell.dataset.z = z;
      const k = document.createElement('span');
      k.className = 'zg-k';
      k.textContent = HubModel.ZONE_NAMES[z];
      cell.appendChild(k);
      const seg = document.createElement('div');
      seg.className = 'seg';
      DIRS.forEach(([v, glyph, label]) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'seg-b' + (ui.zones[z] === v ? ' on' : '');
        b.dataset.v = v;
        b.textContent = glyph;
        b.title = label;
        b.setAttribute('aria-label', HubModel.ZONE_NAMES[z] + ': ' + label);
        b.addEventListener('click', () => {
          writeZone(z, v);
          [...seg.children].forEach(x => x.classList.toggle('on', x === b));
        });
        seg.appendChild(b);
      });
      cell.appendChild(seg);
      map.appendChild(cell);
    });
    row.appendChild(map);
  }

  /* ── Installing ────────────────────────────────────────────────────────────
     The one row in settings that is not a setting: it is a state, and which of
     four it is decides what the row says. Off disk and inside the extension it
     is not there at all — `ext` marks the extension-only rows, and this is the
     opposite, so it is checked here. */
  if (it.t === 'install'){
    const out = document.createElement('div');
    out.className = 'inst';
    const draw = async () => {
      out.textContent = '';
      if (HubApp.installed()){
        const b = document.createElement('span');
        b.className = 'inst-said';
        b.textContent = 'installed';
        out.appendChild(b);
        return;
      }
      if (HubApp.installable()){
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'btn btn-s btn-y'; b.textContent = 'install';
        b.addEventListener('click', async () => { await HubApp.install(); draw() });
        out.appendChild(b);
        return;
      }
      const n = document.createElement('span');
      n.className = 'inst-note';
      /* Safari and Firefox install from their own menus and never offer a
         prompt to fire, so "there is no button" is not the same as "you
         cannot". Saying which it is beats a button that does nothing. */
      n.textContent = await HubApp.ready()
        ? 'ready — install it from the browser\u2019s own menu'
        : 'served over https, this installs';
      out.appendChild(n);
    };
    draw();
    /* The browser decides when it is willing to offer this, which can be after
       the pane is already open. */
    HubApp.onChange(draw);
    row.appendChild(out);
  }

  /* A row that is a door to another pane rather than a setting of its own. */
  if (it.t === 'link'){
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn-s';
    b.textContent = 'open';
    b.addEventListener('click', () => { renderCard(); openSheet('card') });
    row.appendChild(b);
  }

  if (it.t === 'heat'){
    const wrap = document.createElement('div');
    wrap.className = 'heat-pick';
    const prev = document.createElement('div');
    prev.className = 'heat-prev'; prev.id = 's-heat-prev';
    const paint = () => { prev.style.background =
      'linear-gradient(90deg,' + ui.heatFrom + ',' + ui.heatTo + ')' };
    const well = (key, tag, label) => {
      const l = document.createElement('label');
      l.className = 'col-in';
      const i2 = document.createElement('input');
      i2.type = 'color'; i2.value = ui[key]; i2.id = 's-heat-' + tag;
      i2.addEventListener('input', () => { write(key, i2.value); paint() });
      const s2 = document.createElement('span');
      s2.textContent = label;
      l.append(i2, s2);
      return l;
    };
    paint();
    wrap.append(well('heatFrom', 'from', 'least'), prev, well('heatTo', 'to', 'most'));
    row.appendChild(wrap);
  }

  return row;
}

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
  applyLook();
  renderSettings();
  render();
  said('imported ' + out.channels + ' channels, ' + out.cats + ' categories'
       + (out.queue ? ', ' + out.queue + ' queued' : ''));
});

/* ── Bar ─────────────────────────────────────────────────────────────────── */
$('#q').addEventListener('input', e => { q = e.target.value; render() });

/* Type three letters, press enter, you are on the channel. It is the difference
   between a board you read and a launcher you use. */
$('#q').addEventListener('keydown', e => {
  if (e.key !== 'Enter' || !ui.enterOpens) return;
  const first = grid.querySelector('.card .card-hit');
  if (!first) return;
  e.preventDefault();
  first.click();
});

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


/* ── The queue ───────────────────────────────────────────────────────────────
   Watch Later lives behind the feed, and the feed is the thing the guard takes
   away. This is the replacement, and it belongs to HUB: filled by the "+ queue"
   button on a video page, emptied here.

   Opening one grants that single video rather than its channel. A video you put
   aside is a thing you chose, not a door into everything its channel has posted. */
function renderQueue(){
  const list = Store.queue();
  const btn = $('#btn-q');
  btn.hidden = !list.length && !HubBridge.inExt;
  $('#q-n').textContent = list.length ? String(list.length) : '';
  btn.classList.toggle('has', !!list.length);

  const box = $('#q-list');
  if (!box) return;
  box.textContent = '';
  $('#q-clear').hidden = !list.length;

  if (!list.length){
    const p = document.createElement('p');
    p.className = 'q-empty';
    p.textContent = HubBridge.inExt
      ? 'nothing put aside yet. the + queue button on a video page fills this.'
      : 'the queue is filled from youtube, which needs the extension.';
    box.appendChild(p);
    return;
  }

  list.forEach(item => {
    const r = document.createElement('div');
    r.className = 'q-r';

    const a = document.createElement('a');
    a.className = 'q-open';
    a.href = item.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.addEventListener('click', e => {
      if (!HubBridge.inExt) return;
      e.preventDefault();
      HubBridge.ask({ type:'openVideo', url:item.url, videoId:item.videoId });
    });

    const t = document.createElement('span');
    t.className = 'q-t';
    t.textContent = item.title;
    a.appendChild(t);

    if (item.channel){
      const c = document.createElement('span');
      c.className = 'q-c';
      c.textContent = item.channel;
      a.appendChild(c);
    }
    r.appendChild(a);

    const x = document.createElement('button');
    x.type = 'button'; x.className = 'cat-x';
    x.textContent = String.fromCharCode(215);
    x.title = 'Remove from the queue';
    x.addEventListener('click', () => { Store.dequeue(item.id); renderQueue() });
    r.appendChild(x);

    box.appendChild(r);
  });
}

$('#btn-q').addEventListener('click', () => { renderQueue(); openSheet('q') });
$('#q-clear').addEventListener('click', function(){
  if (!this.classList.contains('armed')){
    this.classList.add('armed'); this.textContent = 'sure?';
    return;
  }
  Store.clearQueue();
  this.classList.remove('armed'); this.textContent = 'clear all';
  renderQueue();
});

/* ── Looking channels up ─────────────────────────────────────────────────────
   The button is the manual pass; the automatic one runs once on a cold start,
   and only over what is missing or stale. */
$('#s-refresh').addEventListener('click', async () => {
  if (HubEnrich.busy()) return;
  const out = await HubEnrich.pass({ force:true, ui });
  said('looked up ' + out.done + (out.failed ? ', ' + out.failed + ' would not answer' : ''));
  render();
});

if (typeof HubEnrich !== 'undefined'){
  /* Each channel is written the moment its answer comes back, so the board is
     redrawn as the pass runs rather than all at once at the end. Avatars
     arriving one at a time reads as the thing working; forty of them appearing
     together a minute later reads as a reload. */
  HubEnrich.onProgress(p => {
    if (p) said('looking up ' + p.at + ' of ' + p.of);
    render();
  });
}

/* ── Keys ────────────────────────────────────────────────────────────────────
   Three, and only where they cannot be mistaken for typing. */
addEventListener('keydown', e => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);

  if (e.key === 'Escape'){
    if (openName){ closeSheet(); return }
    if (catMode){ setCatMode(false); return }
    if (typing && document.activeElement.id === 'q'){
      q = ''; document.activeElement.value = ''; document.activeElement.blur(); render();
    }
    return;
  }
  if (typing) return;

  if (e.key === '/'){ e.preventDefault(); $('#q').focus(); $('#q').select() }
  else if (e.key === 'n'){ e.preventDefault(); openChannel(null) }
  /* One of whatever is on screen, opened. A board is a list of things worth
     watching and the hardest question it asks is which one — so `r` answers it,
     from the filtered board rather than from everything, because the filter is
     already half the choice. */
  else if (e.key === 'r'){
    const cards = $$('#grid .card');
    if (!cards.length) return;
    e.preventDefault();
    cards[Math.floor(Math.random() * cards.length)].querySelector('.card-hit').click();
  }
});

/* ── The clock ───────────────────────────────────────────────────────────────
   "3m ago" is wrong a minute later, and the board is a window left open all
   day. Only the one label is repainted; nothing reorders under the cursor,
   even when the sort is by time. */
setInterval(() => {
  Store.channels().forEach(ch => {
    const el = nodes.get(ch.id);
    if (el) paintBadges(el, ch);
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
  applyLook();
  render();

  /* One quiet pass in the background, over whatever is missing or stale. It
     never blocks the board: the cards are already on screen, and each channel
     redraws as its own answer comes back. */
  if (typeof HubEnrich !== 'undefined' && HubEnrich.can() && ui.checkNew !== false){
    HubEnrich.pass({ ui }).then(out => { if (out.done) render() });
  }
})();

})();
