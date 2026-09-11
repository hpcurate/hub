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
let uploadView = 'all';
let beforeLook = null, showingBefore = false;
const undoStack = [];
let lastEdit = {key:'',at:0};

const FONT_STACKS = {
  space:'"Space Grotesk",sans-serif', archivo:'Archivo,sans-serif', dmsans:'"DM Sans",sans-serif',
  inter:'Inter,sans-serif', manrope:'Manrope,sans-serif', outfit:'Outfit,sans-serif',
  syne:'Syne,sans-serif', jetbrains:'"JetBrains Mono",monospace', spacemono:'"Space Mono",monospace',
  system:'system-ui,-apple-system,"Segoe UI",sans-serif',
};

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
/* Which of an account's own pages a card opens. YouTube's home page is a
   trailer and three shelves, so the videos tab is the thing you clicked for;
   Instagram's profile *is* the grid, so there is nothing to skip past and the
   url is already right. */
const openUrl = ch => ch.platform === 'instagram'
  ? HubIG.onTab(ch.url, ui.igTab)
  : HubScope.onTab(ch.url, ui.openTab);

/* The newest post or video, as a link. Both boards store it in `latest`, which
   is what lets one set of machinery — the fresh card, the new chip, the sort,
   the box — serve two sites that have nothing else in common. */
const itemUrl = ch => ch.platform === 'instagram'
  ? HubIG.postUrl(ch.latest.videoId)
  : 'https://www.youtube.com/watch?v=' + encodeURIComponent(ch.latest.videoId);

const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const D = n => REDUCED ? 0 : n * ui.motion;

/* ── Time since last viewed ──────────────────────────────────────────────────
   Coarse on purpose. "3 weeks" is the answer to "have I watched this lately";
   "23 days" is not a better one, it is the same one with a decimal point. */
const MIN = 60e3, HR = 60 * MIN, DAY = 24 * HR;
const isFresh = ch => {
  const age = HubModel.uploadAge(ch);
  return ui.showFresh && age >= 0 && age < ui.freshHours * HR;
};
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

/* ── Which board ─────────────────────────────────────────────────────────────
   The platform row for the tab that is showing. Everything that has to say a
   word for what is on the board — "channel" or "account", "video" or "post" —
   asks this rather than hard-coding one of them, so the second tab does not
   read like the first one with the wrong links on it. */
const platform = () => HubModel.PLATFORMS[ui.tab] || HubModel.PLATFORMS.youtube;

/* ── The tab strip ───────────────────────────────────────────────────────────
   Two boards, one page. Built from the model so a third is a row in the table
   rather than more markup: the label, the count of what is on it, and a dot
   when that board has something new — which is the whole reason the strip is
   worth having, because otherwise a tab you are not looking at cannot tell you
   anything. */
/* The controls are shared, so the words on them have to move. A board of
   Instagram accounts whose search box says "search channels" and whose sort
   offers "newest upload" is the YouTube board with different links on it, which
   is exactly what this is not meant to be. */
function speakPlatform(){
  const P = platform();
  const search = $('#q');
  if (search) search.placeholder = 'search ' + P.nouns;
  const add = $('#btn-add');
  if (add){
    add.textContent = '+ ' + P.noun;
    add.title = 'Add ' + (P.id === 'instagram' ? 'an ' : 'a ') + P.noun + '  (n)';
  }
  const posted = $('#sort-posted');
  if (posted) posted.textContent = 'newest ' + P.item;
  const dots = $('#btn-dots');
  if (dots) dots.title = 'Clear every new-' + P.item + ' dot';
}

function renderTabs(){
  const box = $('#tabs');
  if (!box) return;
  box.textContent = '';
  HubModel.PLATFORM_KEYS.forEach(key => {
    const P = HubModel.PLATFORMS[key];
    const on = ui.tab === key;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tab' + (on ? ' on' : '');
    b.dataset.tab = key;
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(on));
    const n = Store.channels().filter(c => c.platform === key).length;
    const fresh = Store.countNewOn(key);
    b.innerHTML = '<span class="tab-k"></span><span class="tab-n"></span>' +
                  (fresh ? '<span class="tab-new" aria-hidden="true"></span>' : '');
    b.querySelector('.tab-k').textContent = P.label;
    b.querySelector('.tab-n').textContent = n ? String(n) : '';
    b.title = fresh ? fresh + ' with something new' : n + ' ' + (n === 1 ? P.noun : P.nouns);
    b.addEventListener('click', () => switchTab(key));
    box.appendChild(b);
  });
}

/* Changing boards clears the things that only meant something on the old one:
   a category chip from the other tab would filter every card away, and a search
   for a channel name is not a search for an account name. The sort survives,
   because "last viewed" means the same thing on both. */
function switchTab(key){
  if (ui.tab === key) return;
  Store.setTab(key);
  ui = Store.ui();
  picked.clear();
  onlyNew = false;
  q = '';
  const box = $('#q');
  if (box) box.value = '';
  reintro = true;
  applyLook();
  render();
  said('showing ' + HubModel.PLATFORMS[key].label);
}

/* ── The list ────────────────────────────────────────────────────────────────
   Filter, then search, then sort. Every control on the bar funnels into here,
   which is why "sort/filter everything" is one function and not five. */
function list(){
  const cats = Store.cats();
  const order = new Map(cats.map((c, i) => [c.id, i]));
  const term = q.trim().toLowerCase();

  /* This board, not both. Every control on the bar means "on this tab", so the
     tab is applied before any of them rather than being one more filter that
     could be switched off. */
  let out = Store.onTab();

  if (picked.size) out = out.filter(c => picked.has(c.cat || ''));

  /* "Only what has something new" is a filter and not a sort, because the
     question it answers is "is there anything to watch", and the answer to that
     is allowed to be an empty board. */
  if (onlyNew) out = out.filter(c => Store.isNew(c));
  if (uploadView !== 'all') out = out.filter(c => {
    const age = HubModel.uploadAge(c);
    return age >= 0 && age < (uploadView === 'today' ? DAY : 7 * DAY);
  });

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
  if (ui.groupUploads){
    const order = ['today','week','older','unknown'];
    out.sort((a,b)=>order.indexOf(HubModel.uploadGroup(a))-order.indexOf(HubModel.uploadGroup(b)));
  }

  return out;
}

/* ── Cards ───────────────────────────────────────────────────────────────────
   Nodes are kept and reused across renders, keyed by id. That is what makes
   the reorder animation possible at all — a rebuilt DOM has nothing to move —
   and it also keeps hover and focus alive through a re-sort. */
const nodes = new Map();
const ZONES = HubModel.ZONES;
const effectObserver = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => {
  entries.forEach(({target,isIntersecting})=>{
    target.classList.toggle('offscreen', !isIntersecting);
    const ch = Store.channels().find(c=>c.id === target.dataset.id);
    if (ch) scheduleEffects(target,ch);
  });
});

function build(ch){
  const el = document.createElement('article');
  el.className = 'card';
  if (effectObserver && ch.id !== '__preview__') el.classList.add('offscreen');
  el.dataset.id = ch.id;
  el.innerHTML =
    '<a class="card-hit" target="_blank" rel="noopener noreferrer"></a>' +
    ['t','m','b'].map(r =>
      '<div class="zrow" data-r="' + r + '">' +
        ['l','c','r'].map(c=>'<div class="zone" data-z="'+r+c+'"></div>').join('') +
      '</div>').join('') +
    '<span class="ground" aria-hidden="true"></span><span class="texture" aria-hidden="true"></span><span class="wash" aria-hidden="true"></span><span class="logo-overlay" aria-hidden="true"></span><span class="fresh-fx" aria-hidden="true"></span><span class="refresh-fx" aria-hidden="true"></span><span class="preview-cue-fx" aria-hidden="true"></span><span class="heat"></span>';

  /* Movable parts are reused so repainting does not restart their animations. */
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
    catIcon:mk('span', 'card-cat-icon'),
    seen:   mk('span', 'badge b-seen'),
    opens:  mk('span', 'badge b-count'),
    posted: mk('span', 'badge b-posted'),
    added:  mk('span', 'badge b-added'),
    rank:   mk('span', 'badge b-rank'),
    queued: mk('span', 'badge b-queued'),
    handle: mk('span', 'badge b-handle'),
    pin:    mk('span', 'badge b-pin'),
    freshBadge:mk('span', 'badge b-fresh'),
    count:  mk('span', 'card-n'),
    edit:   mk('button', 'card-edit'),
  };
  parts.dot.type = parts.tag.type = parts.edit.type = 'button';
  parts.dot.title = 'new since you last looked — click to clear';
  parts.tag.title = 'Categorise';
  parts.edit.title = 'Edit';
  parts.edit.textContent = '⋯';
  Object.entries(parts).forEach(([key,node]) => node.dataset.part = key);
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
  addVideoPreview(el, ch);
  const move = e => {
    if (REDUCED || ui.motion === 0 || !['parallax','spotlight'].includes(el.dataset.washEffect)) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--pointer-x', ((e.clientX-r.left)/r.width*100) + '%');
    el.style.setProperty('--pointer-y', ((e.clientY-r.top)/r.height*100) + '%');
    el.style.setProperty('--parallax-x', ((e.clientX-r.left)/r.width-.5)*12 + 'px');
    el.style.setProperty('--parallax-y', ((e.clientY-r.top)/r.height-.5)*12 + 'px');
  };
  el.addEventListener('pointermove', move);
  const settlePreviewCue = () => {
    if (el.classList.contains('has-preview-cue')) el.classList.add('preview-cue-seen');
  };
  el.addEventListener('pointerenter', settlePreviewCue);
  el.addEventListener('focusin', settlePreviewCue);
  el.addEventListener('pointerleave', () => {
    for (const key of ['pointer-x','pointer-y','parallax-x','parallax-y']) el.style.removeProperty('--'+key);
  });
  effectObserver?.observe(el);
  return el;
}

function addVideoPreview(el, ch){
  const panel = document.createElement('div');
  panel.className = 'video-panel';
  panel.innerHTML = '<button type="button" class="video-toggle" aria-expanded="false"><span class="video-toggle-text">latest video</span><span class="video-indicator" aria-hidden="true"></span></button>' +
    '<div class="video-detail"><img class="video-thumb" alt="" loading="lazy"><span class="video-title"></span>' +
    '<span class="video-age"></span><div class="video-actions"><a class="btn btn-s video-open" target="_blank" rel="noopener noreferrer">open video</a>' +
    '<button type="button" class="btn btn-s video-queue">queue</button>' +
    '<button type="button" class="btn btn-s video-hide" title="Hide the latest video box on this card">hide</button></div></div>';
  const current = () => Store.channels().find(c=>c.id===ch.id) || ch;
  panel.querySelector('.video-toggle').addEventListener('click',()=>{
    const on = el.classList.toggle('preview-open');
    panel.querySelector('.video-toggle').setAttribute('aria-expanded',String(on));
  });
  panel.querySelector('.video-detail').addEventListener('click', e => {
    if (e.target.closest('button,a')) return;
    e.preventDefault(); e.stopPropagation();
    dismissVideoPreview(el, current());
  });
  panel.querySelector('.video-open').addEventListener('click',e=>{
    const item = current();
    if (HubBridge.inExt){
      e.preventDefault();
      HubBridge.ask({type:'openVideo',videoId:item.latest.videoId,url:videoUrl(item)});
    }
    Store.touch(item.id);
  });
  /* The switch that is on the card. It writes the same `hidePreview` the edit
     pane writes — one channel saying "not here", which is the exception to the
     board's own answer rather than a second setting arguing with it. The board
     is re-rendered because the card it was clicked on is about to be a card
     without a box, and `said` is how you get it back. */
  panel.querySelector('.video-hide').addEventListener('click',e=>{
    e.preventDefault(); e.stopPropagation();
    const item = current();
    Store.togglePreview(item.id);
    said('latest video hidden on ' + item.name + ' \u2014 turn it back on in that channel\u2019s edit pane');
    render();
  });
  panel.querySelector('.video-queue').addEventListener('click',()=>{
    const item = current();
    const added = Store.enqueue({videoId:item.latest.videoId,url:videoUrl(item),title:item.latest.title,channel:item.name,channelUrl:item.url});
    said(added ? 'added to queue' : 'already queued');
    paintVideoPreview(el,item); renderQueue();
  });
  el.appendChild(panel);
}
const videoUrl = ch => itemUrl(ch);
const previewKey = ch => ch?.latest ? ch.latest.videoId + ':' + ch.latest.at : '';
const hasUnreadUpload = ch => !!(ch?.latest?.at && ch.latest.at <= Date.now() &&
  ch.latest.at > Math.max(ch.seen || 0, ch.dotAt || 0));

function dismissVideoPreview(el,ch){
  const panel = el.querySelector('.video-panel');
  if (!panel || panel.hidden || panel.classList.contains('dismissing')) return;
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    panel.classList.remove('dismissing');
    if (ch.id === '__preview__'){ panel.hidden = true; return }
    Store.dismissPreview(ch.id, previewKey(ch));
    const current = Store.channels().find(c=>c.id===ch.id);
    if (current) paintVideoPreview(el,current);
  };
  if (REDUCED || ui.motion === 0 || ui.previewDismissAnimation === 'none' || ui.previewDismissSpeed <= 0) return finish();
  panel.dataset.dismissAnimation = ui.previewDismissAnimation;
  panel.classList.add('dismissing');
  const ended = e => {
    if (e.target !== panel) return;
    panel.removeEventListener('animationend', ended);
    finish();
  };
  panel.addEventListener('animationend', ended);
  setTimeout(finish, ui.previewDismissSpeed * 1000 + 120);
}
/* Whether this card carries the latest-video box at all. Three answers, in the
   order they are asked: the board's own switch, the channel's exception to it,
   and — when the board is set that way — whether there is anything fresh to
   announce. A channel with no known upload never has one. */
function showsPreview(ch){
  if (ch.id === '__preview__' && previewState === 'manual') return true;
  if (!ui.latestPreview || ch.hidePreview || !ch.latest?.videoId || ch.previewDismissed === previewKey(ch)) return false;
  return !ui.previewOnlyFresh || isFresh(ch);
}

function paintVideoPreview(el,ch){
  const panel = el.querySelector('.video-panel');
  panel.hidden = !showsPreview(ch);
  if (panel.hidden){ el.classList.remove('preview-open','has-preview-cue'); return }
  el.dataset.videoPreview = ui.previewMode;
  el.dataset.thumbSize = ui.previewThumbSize;
  el.dataset.previewAnimation = ui.previewAnimation;
  el.dataset.previewCue = ui.previewCueAnimation;
  const key = previewKey(ch);
  if (el._previewKey !== key){ el._previewKey = key; el.classList.remove('preview-cue-seen') }
  el.classList.toggle('has-preview-cue', !!ui.previewCue && hasUnreadUpload(ch));
  const toggle = panel.querySelector('.video-toggle');
  toggle.classList.toggle('label-hidden', !ui.previewLabel);
  toggle.title = ui.previewLabel ? '' : 'Latest video';
  if (ui.previewLabel) toggle.removeAttribute('aria-label');
  else toggle.setAttribute('aria-label','Latest video');
  const title = panel.querySelector('.video-title');
  title.textContent = ch.latest.title || 'Latest upload';
  title.hidden = !ui.previewTitle;
  const age = panel.querySelector('.video-age');
  age.textContent = 'posted ' + since(ch.latest.at);
  age.hidden = !ui.previewAge;
  const image = panel.querySelector('.video-thumb');
  image.hidden = !ui.previewThumbnail;
  /* YouTube's thumbnail is on a stable url built from the video id and will be
     there forever. Instagram's is a signed CDN link read off the post when it
     was checked, and it expires — so it is stored rather than derived, and when
     it dies `onerror` takes the picture out of the card rather than leaving a
     broken frame. */
  const src = ch.platform === 'instagram'
    ? (ch.latest.thumb || '')
    : 'https://i.ytimg.com/vi/'+encodeURIComponent(ch.latest.videoId)+'/mqdefault.jpg';
  if (!src) image.hidden = true;
  else if (ui.previewThumbnail && image.getAttribute('src') !== src) image.src = src;
  image.onerror = ()=>{image.hidden=true};
  const hide = panel.querySelector('.video-hide');
  hide.hidden = !ui.previewHideButton;
  /* The actions row is the open and queue buttons *and* the hide button, so it
     only stands down when none of the three is wanted. */
  panel.querySelector('.video-actions').hidden = !ui.previewActions && !ui.previewHideButton;
  panel.querySelector('.video-open').hidden = !ui.previewActions;
  panel.querySelector('.video-queue').hidden = !ui.previewActions;
  panel.querySelector('.video-open').href = videoUrl(ch);
  const queued = Store.queue().some(q=>q.videoId===ch.latest.videoId);
  panel.querySelector('.video-queue').textContent = queued ? 'queued' : '+ queue';
  panel.querySelector('.video-queue').disabled = queued;
}

function scheduleEffects(el,ch){
  const look = HubModel.effectiveLook(ui,ch);
  el.dataset.schedule = look.animationSchedule;
  el.classList.toggle('pause-offscreen',look.pauseOffscreen);
  if (look.animationSchedule !== 'once'){el.classList.remove('play-once');return}
  const key = ch.latest ? ch.latest.videoId + ':' + ch.latest.at : '';
  const fresh = isFresh(ch);
  if (!REDUCED && ui.motion > 0 && !el.classList.contains('offscreen') && fresh && key && ch.animationSeen !== key && el._onceKey !== key){
    if(el._onceKey){el.classList.remove('play-once');void el.offsetWidth}
    el._onceKey = key;
    Store.markAnimation(ch.id,key);
    el.classList.add('play-once');
  }
  if (!fresh) el.classList.remove('play-once');
}
/* The five curves an effect can run on, and what each one is in CSS. Named
   rather than typed: "spring" is a thing you can pick, `cubic-bezier(.34,1.56,
   .64,1)` is not. */
const EASES = {
  ease:'var(--ease)', linear:'linear', steady:'ease-in-out',
  spring:'cubic-bezier(.34,1.56,.64,1)', bounce:'cubic-bezier(.68,-.55,.27,1.55)',
  /* snap sits still and then goes; elastic overshoots at both ends. */
  snap:'cubic-bezier(.9,0,.1,1)', elastic:'cubic-bezier(.5,-.6,.3,1.6)',
};
/* Arriving has one curve the loops do not: the sheet's own --ease-out, which
   is what a card has always come in on. */
const ENTER_EASES = { out:'var(--ease-out)', ...EASES };
const WAAPI_EASES = {
  out:'cubic-bezier(.34,1.4,.5,1)', ease:'cubic-bezier(.4,0,.2,1)', linear:'linear',
  steady:'ease-in-out', spring:'cubic-bezier(.34,1.56,.64,1)', bounce:'cubic-bezier(.68,-.55,.27,1.55)',
  snap:'cubic-bezier(.9,0,.1,1)', elastic:'cubic-bezier(.5,-.6,.3,1.6)',
};

/* Where a highlight colour comes from, for the three things that ask: the
   fresh look, the background overlay and the card's own tint. */
const sourceColor = (source, custom) =>
  source === 'category' ? 'var(--c)' :
  source === 'ground'   ? 'var(--bg)' :
  source === 'custom'   ? (custom || ui.accent) : ui.accent;

function paintEffects(el,ch){
  const look = HubModel.effectiveLook(ui,ch);
  for (const [attr,key] of Object.entries({freshStyle:'freshStyle',freshAnimation:'freshAnimation',washEffect:'washEffect',washPosition:'washPosition',hover:'hoverEffect',refreshEffect:'refreshEffect',washOverlay:'washOverlay',
    washMask:'washMask',washBlend:'washBlend',washFit:'washFit',washOverlayColor:'washOverlayColor',
    cardTint:'cardTint',cardGradient:'cardGradient',avatarHover:'avatarHover',dotAnimation:'dotAnimation',
    texture:'cardTexture',cardShadow:'cardShadow',washOverlayBlend:'washOverlayBlend'})) el.dataset[attr] = look[key];
  el.classList.toggle('tint-hover',!!look.cardTintHover && look.cardTint !== 'none');
  const age = HubModel.uploadAge(ch);
  const fade = look.freshAging ? Math.max(0,1-Math.max(0,age)/(ui.freshHours*HR)) : 1;
  el.style.setProperty('--fresh-strength',look.freshIntensity/100*fade);
  el.style.setProperty('--fresh-cycle',look.freshSpeed+'s');
  el.style.setProperty('--wash-blur',look.washBlur+'px');
  el.style.setProperty('--wash-scale',look.washScale/100);
  el.style.setProperty('--wash-x',look.washX+'%');
  el.style.setProperty('--wash-y',look.washY+'%');
  el.style.setProperty('--overlay-opacity',look.washOverlayOpacity/100);
  el.style.setProperty('--wash',ch.avatar && look.avatarWash > 0 ? (look.avatarWash/100).toFixed(3) : '0');
  el.style.setProperty('--fresh-c',sourceColor(look.freshColorSource,look.freshColor));
  /* The rest of the background: how much colour is left in the picture, how
     hard it is drawn, how far it is turned, and how much brighter it gets when
     the card is pointed at. All four are numbers the stylesheet reads. */
  el.style.setProperty('--wash-sat',look.washSaturate/100);
  el.style.setProperty('--wash-contrast',look.washContrast/100);
  el.style.setProperty('--wash-rot',look.washRotate+'deg');
  el.style.setProperty('--wash-boost',look.washHoverBoost/100);
  /* The four newest background numbers, and the two that govern how the
     backgrounds that move actually move. */
  el.style.setProperty('--wash-bright',look.washBrightness/100);
  el.style.setProperty('--wash-hue',look.washHue+'deg');
  el.style.setProperty('--wash-speed',look.washSpeed/100);
  el.style.setProperty('--wash-cycle',look.washAnimationSpeed+'s');
  el.style.setProperty('--wash-fade',look.washFade/100);
  el.style.setProperty('--overlay-angle',look.washOverlayAngle+'deg');
  el.style.setProperty('--grad-strength',look.cardGradientStrength/100);
  el.style.setProperty('--texture-opacity',look.cardTexture === 'none' ? '0' : (look.cardTextureOpacity/100).toFixed(3));
  el.style.setProperty('--texture-size',look.cardTextureScale+'px');
  el.style.setProperty('--hover-dur',(look.hoverSpeed/100)+'s');
  el.style.setProperty('--avatar-cycle',look.avatarSpeed+'s');
  el.style.setProperty('--dot-cycle',look.dotSpeed+'s');
  el.style.setProperty('--refresh-cycle',look.refreshSpeed+'s');
  el.style.setProperty('--preview-cycle',look.previewSpeed+'s');
  el.style.setProperty('--preview-dismiss-cycle',look.previewDismissSpeed+'s');
  el.style.setProperty('--preview-cue-cycle',look.previewCueSpeed+'s');
  el.style.setProperty('--preview-grow',look.previewGrowSpeed+'s');
  el.style.setProperty('--fresh-loops',look.freshLoops ? String(look.freshLoops) : 'infinite');
  el.style.setProperty('--overlay-c',sourceColor(look.washOverlayColor,look.washOverlayCustom));
  el.style.setProperty('--tint-c',sourceColor(look.cardTint === 'none' ? 'accent' : look.cardTint,look.cardTintColor));
  el.style.setProperty('--tint-strength',look.cardTintStrength/100);
  el.style.setProperty('--hover-k',look.hoverStrength/100);
  el.style.setProperty('--fresh-ease',EASES[look.freshEasing] || EASES.ease);
  el.style.setProperty('--fresh-dir',look.freshDirection);
  el.style.setProperty('--fx-stagger',look.animationStagger+'ms');
  el.classList.toggle('fresh-name',look.freshName);
  scheduleEffects(el,ch);
}

function visibleParts(el, ch){
  const has = {
    avatar: ui.showAvatars && (!!ch.avatar || ui.avatarFallback !== 'none'),
    dot:    ui.showNew && Store.isNew(ch),
    name:   true,
    desc:   ui.showDesc,
    tag:    ui.showTag,
    catIcon:ui.showCategoryIcon && !!Store.cat(ch.cat)?.icon,
    seen:   !!el._parts.seen.textContent,
    opens:  !!el._parts.opens.textContent,
    posted: !!el._parts.posted.textContent,
    added:  !!el._parts.added.textContent,
    rank:   !!el._parts.rank.textContent,
    queued: !!el._parts.queued.textContent,
    handle: !!el._parts.handle.textContent,
    pin:    !!el._parts.pin.textContent,
    freshBadge:!!el._parts.freshBadge.textContent,
    count:  ui.showCounts && ui.countStyle === 'number',
    edit:   true,
  };
  return HubModel.PART_KEYS.filter(k => has[k]);
}

function liveParts(el, ch){
  const visible = visibleParts(el,ch);
  el._visibleParts = visible;
  return el.dataset.manual === 'true' && previewShowHidden ? HubModel.PART_KEYS.slice() : visible;
}

function place(el, ch){
  ZONES.forEach(z => { el.querySelector('.zone[data-z="'+z+'"]').dataset.direction = ui.zones[z] });
  const live = liveParts(el, ch);
  const sig = el._visibleParts.join(',')+'|'+ZONES.map(z =>
    z+':'+ui.zones[z]+':'+ui.orders[z].filter(k=>live.includes(k)).join(',')).join('|');
  if (el.dataset.sig === sig) return;
  el.dataset.sig = sig;
  const zone = z => el.querySelector('.zone[data-z="'+z+'"]');
  ZONES.forEach(z => { zone(z).textContent=''; zone(z).dataset.direction=ui.zones[z] });
  HubModel.PART_KEYS.filter(k => !live.includes(k)).forEach(k => el._parts[k].remove());
  ZONES.forEach(z => ui.orders[z].forEach(k => {
    if (!live.includes(k)) return;
    el._parts[k].classList.toggle('manual-hidden',!el._visibleParts.includes(k));
    zone(z).appendChild(el._parts[k]);
  }));
}

/* Each card fact has its own node and slot. */
const BADGES = [
  { part:'pin', k:'showPin',    label:'pinned', cls:'pin',
    note:'only ever on the pinned ones, so it costs the rest nothing',
    get: ch => ch.pin ? 'pinned' : null },
  { part:'seen', k:'showSeen',   label:'last viewed', cls:'seen',
    get: ch => since(ch.seen) },
  { part:'opens', k:'showCounts', label:'opens', cls:'count',
    get: ch => (ch.clicks || 0) + (ch.clicks === 1 ? ' open' : ' opens') },
  { part:'posted', k:'showPosted', label:'last posted', cls:'posted',
    note:'from its feed, in the extension only',
    get: ch => ch.latest && ch.latest.at ? 'posted ' + since(ch.latest.at) : null },
  { part:'added', k:'showAdded',  label:'added', cls:'added',
    get: ch => ch.added ? 'added ' + since(ch.added) : null },
  { part:'rank', k:'showRank',   label:'rank', cls:'rank',
    get: (ch, ctx) => ctx.rank.has(ch.id) ? '#' + ctx.rank.get(ch.id) : null },
  { part:'queued', k:'showQueued', label:'queued', cls:'queued',
    get: (ch, ctx) => ctx.queued.get(ch.id) ? ctx.queued.get(ch.id) + ' queued' : null },
  { part:'handle', k:'showHandle', label:'handle', cls:'handle',
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
  el._parts.count.textContent = asNumber || el.dataset.manual === 'true' ? String(ch.clicks || 0) : '';

  const manual = el.dataset.manual === 'true';
  const fresh = el._parts.freshBadge;
  fresh.textContent = (HubModel.effectiveLook(ui,ch).freshBadge && isFresh(ch)) || manual ? 'fresh upload' : '';
  fresh.title = ch.latest?.title || (ch.latest?.at ? 'Posted ' + since(ch.latest.at) : 'Fresh upload');
  BADGES.forEach(b => {
    const s = el._parts[b.part];
    const text = b.get(ch, badgeCtx);
    s.textContent = manual ? (text ?? b.label) : ((!ui[b.k] || (b.k === 'showCounts' && asNumber)) ? '' : (text || ''));
    if (b.cls === 'seen'){
      s.classList.toggle('never', !ch.seen);
      s.classList.toggle('fresh', !!ch.seen && Date.now() - ch.seen < DAY);
    }
  });
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
  hit.setAttribute('aria-label',
    'Open ' + ch.name + ' on ' + (HubModel.PLATFORMS[ch.platform] || platform()).label);

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
  const useWash = ch.avatar && HubModel.effectiveLook(ui,ch).avatarWash > 0;
  /* Escape CSS delimiters while preserving an already encoded image URL. */
  wash.style.backgroundImage = useWash ? 'url("' + ch.avatar.replace(/["\\\r\n\f]/g, c => encodeURIComponent(c)) + '")' : '';
  el.style.setProperty('--wash', useWash ? (ui.avatarWash / 100).toFixed(3) : '0');

  el.classList.toggle('is-new', Store.isNew(ch));
  /* Posted in the last day: not a dot but a whole card — a lit edge, a warmer
     ground and a glow, so what is worth opening right now is visible from the
     other side of the board. */
  el.classList.toggle('is-fresh', isFresh(ch));
  el.classList.toggle('is-refreshing', refreshing.has(ch.id));
  el.style.setProperty('--fresh-c', ui.freshColorSource === 'category' ? 'var(--c)' :
    ui.freshColorSource === 'custom' ? (ui.freshColor || ui.accent) : ui.accent);
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

  const ci = el._parts.catIcon;
  ci.textContent = '';
  const standaloneIcon = cat && iconEl(cat.icon);
  if (standaloneIcon) ci.appendChild(standaloneIcon);
  else if (el.dataset.manual === 'true') ci.appendChild(iconEl('star'));
  ci.title = cat ? cat.name : 'Category icon';

  paintHeat(el, ch);
  paintEffects(el,ch);
  paintVideoPreview(el,ch);
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
  if (!REDUCED && ui.motion > 0) nodes.forEach((el, id) => {
    if (!el.isConnected) return;
    const r = el.getBoundingClientRect();
    before.set(id, { left:r.left + sx0, top:r.top + sy0 });
  });

  mutate();

  if (REDUCED || ui.motion === 0) return;
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
      { duration:ui.reorderSpeed * 1000, easing:WAAPI_EASES[ui.reorderEasing] || WAAPI_EASES.ease }
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
  $$('[data-upload-view]').forEach(b=>{
    b.classList.toggle('on',b.dataset.uploadView===uploadView);
    b.setAttribute('aria-pressed',String(b.dataset.uploadView===uploadView));
  });
  $('#group-uploads').setAttribute('aria-pressed',String(ui.groupUploads));
  $('#group-uploads').classList.toggle('on',ui.groupUploads);
  const items = list();
  const total = Store.onTab().length;

  grid.dataset.size = size;
  badgeCtx = badgeContext();
  renderTabs();
  speakPlatform();
  renderCatBar();
  renderChips();
  renderQueue();
  renderDots();

  const cats = Store.cats().length;
  const P = platform();
  $('#meta').textContent = total
    ? total + ' ' + (total === 1 ? P.noun : P.nouns) + ' · ' +
      cats + (cats === 1 ? ' category' : ' categories') +
      (items.length !== total ? ' · ' + items.length + ' shown' : '')
    : 'no ' + P.nouns + ' yet';

  const filtering = reintro && ui.filterAnimation !== 'none';
  const intro = filtering; reintro = false;
  grid.classList.toggle('filtering',filtering);
  const entering = [];

  const mutate = () => {
    grid.querySelectorAll('.upload-heading').forEach(el=>el.remove());
    const keep = new Set(items.map(c => c.id));

    /* gone from the board — fade the node out, then drop it */
    nodes.forEach((el, id) => {
      if (keep.has(id)) return;
      nodes.delete(id);
      effectObserver?.unobserve(el);
      if (REDUCED || ui.motion === 0 || ui.cardExit === 'none' || ui.exitSpeed <= 0){ el.remove(); return }
      const frames = {
        fade:[{opacity:1},{opacity:0}],
        shrink:[{opacity:1,transform:'none'},{opacity:0,transform:'scale(.9)'}],
        slide:[{opacity:1,transform:'none'},{opacity:0,transform:'translateY(18px)'}],
        blur:[{opacity:1,filter:'none'},{opacity:0,filter:'blur(8px)'}],
        fold:[{opacity:1,transform:'none',transformOrigin:'top'},{opacity:0,transform:'perspective(700px) rotateX(75deg)',transformOrigin:'top'}],
        fly:[{opacity:1,transform:'none'},{opacity:0,transform:'translateX(60px) rotate(3deg)'}],
        drop:[{opacity:1,transform:'none'},{opacity:0,transform:'translateY(60px)'}],
        implode:[{opacity:1,transform:'none',filter:'none'},{opacity:0,transform:'scale(.25)',filter:'blur(5px)'}],
        spin:[{opacity:1,transform:'none'},{opacity:0,transform:'rotate(14deg) scale(.72)'}],
      }[ui.cardExit] || [{opacity:1},{opacity:0}];
      el.animate(frames,
                 { duration:ui.exitSpeed * 1000, easing:WAAPI_EASES[ui.enterEasing] || WAAPI_EASES.out })
        .finished.then(() => el.remove(), () => el.remove());
    });

    let lastGroup = '';
    items.forEach((ch, i) => {
      const group = HubModel.uploadGroup(ch);
      if (ui.groupUploads && group !== lastGroup){
        const h = document.createElement('h2'); h.className = 'upload-heading';
        h.textContent = {today:'Today · last 24 hours',week:'This week · 1–7 days',older:'Older uploads',unknown:'No upload date'}[group];
        grid.appendChild(h); lastGroup = group;
      }
      let el = nodes.get(ch.id);
      if (!el){
        el = build(ch);
        nodes.set(ch.id, el);
        entering.push([el, i]);
      } else if (intro) entering.push([el, i]);
      /* Where this card sits on the board, which is what a stagger counts: the
         entry animation reads it, and so does every looping effect, so a board
         of forty breathes as a wave rather than as one thing forty times. */
      el.style.setProperty('--i', staggerIndex(i, items.length));
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
      el.style.setProperty('--i', staggerIndex(i, items.length));
      el.style.setProperty('--card-enter-duration',(filtering ? ui.filterSpeed : ui.enterSpeed)+'s');
      el.classList.add('in');
      const clear = e => {
        if (e && e.target !== el) return;
        el.classList.remove('in');
        el.removeEventListener('animationend', clear);
      };
      el.addEventListener('animationend', clear);
      setTimeout(clear, ((filtering ? ui.filterSpeed : ui.enterSpeed) * 1000) + (staggerIndex(i, items.length) * ui.enterStagger) + 80);
    });
  }
  if (filtering) setTimeout(()=>grid.classList.remove('filtering'),ui.filterSpeed*1000+ui.enterStagger*items.length+100);

  empty.hidden = items.length > 0;
  if (!items.length){
    $('#empty-t').textContent = total ? 'nothing matches' : 'nothing here yet';
    $('#empty-s').textContent = total
      ? 'try a different category, or clear the search'
      : 'add ' + (platform().id === 'instagram' ? 'an ' : 'a ') + platform().noun + ' to start the board';
  }
}

/* Which card counts as first for a stagger. The renderer knows a card's place
   on the board; this turns that place into the number the delay is counted in,
   so the same wave can start at the end, in the middle, at both edges, or
   nowhere in particular. `random` is stable per position, not per render — a
   scatter that reshuffled on every repaint would be a flicker, not a look. */
function staggerIndex(i, n){
  const last = Math.max(n - 1, 0);
  switch (ui.staggerOrder){
    case 'reverse': return last - i;
    case 'random':  return (Math.imul(i + 1, 2654435761) >>> 8) % Math.max(n, 1);
    case 'center':  return Math.round(Math.abs(i - last / 2));
    case 'edges':   return Math.round(last / 2 - Math.abs(i - last / 2));
    default:        return i;
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
  const chans = Store.onTab();
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
    b.title = 'Only ' + platform().nouns + ' that have posted since you last looked';
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
  if (manualFullscreen) setManualFullscreen(false);
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
  setTimeout(done, Math.max(100, ui.sheetSpeed * 1000 + 100));
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

  const P = ch ? (HubModel.PLATFORMS[ch.platform] || platform()) : platform();
  $('#f-ch-t').textContent = (ch ? 'edit ' : 'new ') + P.noun;
  $('#c-url').placeholder = P.home + (P.id === 'instagram' ? 'someone' : '@someone');
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

  /* And the same door for the latest-video box. The board decides whether cards
     carry one at all; this decides whether this card is an exception — a
     channel whose newest upload you would rather not have announced. */
  const prev = $('#c-preview');
  prev.hidden = !ch;
  const drawPreview = () => {
    const off = !!(editing && Store.channels().find(c => c.id === editing) || {}).hidePreview;
    prev.classList.toggle('on', !off);
    prev.textContent = off ? 'latest video: off' : 'latest video: on';
    prev.title = off ? 'The latest-video box is hidden on this card'
                     : 'This card carries the latest-video box when the board is showing them';
    prev.setAttribute('aria-pressed', off ? 'false' : 'true');
  };
  drawPreview();
  prev.onclick = () => { Store.togglePreview(editing); drawPreview(); render() };

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
    else {
      /* The url says which board this belongs on, not the tab that happened to
         be open — a YouTube link filed as an Instagram account would point at
         the wrong site and be checked the wrong way. So the record goes where
         its url says, and the board follows it rather than swallowing it. */
      const made = Store.addChannel(data);
      if (made.platform !== ui.tab){
        const to = HubModel.PLATFORMS[made.platform];
        Store.setTab(made.platform); ui = Store.ui();
        picked.clear(); onlyNew = false; reintro = true;
        said('that is a ' + to.noun + ' \u2014 filed on ' + to.label);
      }
    }
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
    x.title = 'Delete — ' + platform().nouns + ' in it become uncategorised';
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
$('#btn-card').addEventListener('click', () => openCard());

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
const presetSlots = changes => ({...HubModel.DEFAULT_SLOTS,...changes});
const badgeSlots = zone => Object.fromEntries(
  ['seen','opens','posted','added','rank','queued','handle','pin','freshBadge'].map(k=>[k,zone]));

/* Presets write ordinary settings and remain editable. */
const PRESETS = [
  { name:'classic', ui:{ layout:'card',
      slots:presetSlots({}),zones:{...HubModel.DEFAULT_ZONES},
      avatarSize:30, nameLines:2, gap:12, border:'hairline', surface:'raised',
      showDesc:true, descLines:4, showAvatars:true,
      avatarShape:'circle', avatarBorder:'hairline', dotOnAvatar:false,
      countStyle:'badge', nameSize:17, descSize:12.5, badgeSize:10 } },
  { name:'compact', ui:{ layout:'compact',
      slots:presetSlots({dot:'tl'}),zones:{...HubModel.DEFAULT_ZONES},
      avatarSize:24, nameLines:1, gap:8, border:'hairline', surface:'raised',
      showDesc:false, showAvatars:true,
      avatarShape:'circle', avatarBorder:'none', dotOnAvatar:false,
      countStyle:'badge', nameSize:15, badgeSize:9.5 } },
  { name:'list', ui:{ layout:'list',
      slots:presetSlots({dot:'tl'}),zones:{...HubModel.DEFAULT_ZONES},
      avatarSize:28, nameLines:1, gap:6, border:'hairline', surface:'flat',
      showDesc:false, showAvatars:true,
      avatarShape:'rounded', avatarBorder:'none', dotOnAvatar:false,
      countStyle:'number', nameSize:14.5, badgeSize:9.5 } },
  { name:'poster', ui:{ layout:'card',
      slots:presetSlots({...badgeSlots('bl')}),zones:{...HubModel.DEFAULT_ZONES,tl:'column',bl:'column'},
      avatarSize:52, nameLines:2, gap:16, border:'accent', surface:'raised',
      showDesc:true, descLines:3, showAvatars:true,
      avatarShape:'rounded', avatarBorder:'accent', dotOnAvatar:true,
      countStyle:'number', nameSize:19, descSize:12, badgeSize:10 } },
];

const BACKGROUND_PRESETS = [
  {name:'soft',ui:{avatarWash:18,washFit:'cover',washEffect:'soft',washMask:'diagonal',washBlur:2,washSaturate:85,washContrast:100,washBrightness:100,washOverlay:'none'}},
  {name:'full image',ui:{avatarWash:42,washFit:'contain',washEffect:'soft',washMask:'none',washBlur:0,washSaturate:100,washContrast:100,washBrightness:100,washOverlay:'none'}},
  {name:'mono',ui:{avatarWash:28,washFit:'cover',washEffect:'mono',washMask:'vignette',washBlur:1,washSaturate:0,washContrast:115,washBrightness:90,washOverlay:'none'}},
  {name:'cinematic',ui:{avatarWash:34,washFit:'cover',washEffect:'kenburns',washMask:'bottom',washBlur:1,washSaturate:120,washContrast:115,washBrightness:85,washOverlay:'gradient'}},
  {name:'pattern',ui:{avatarWash:16,washFit:'tile',washEffect:'mono',washMask:'none',washBlur:0,washSaturate:60,washContrast:120,washBrightness:90,washOverlay:'none'}},
];

/* The preview uses the same renderer as the board. */
const CARD_SETTINGS = [
  ['shape', [
    { k:'preset', t:'preset', label:'presets',
      note:'a starting point, not a mode: every dial below stays yours' },
    { k:'layout',  t:'seg',   label:'card shape', opts:['card', 'compact', 'list'] },
    { k:'cardWidth', t:'range', label:'card width', min:180, max:520, step:4, fmt:v=>v+'px' },
    { k:'cardHeight', t:'range', label:'card height', min:88, max:360, step:4, fmt:v=>v+'px' },
    { k:'cardRadius', t:'range', label:'card corner radius', min:0, max:40, step:1, fmt:v=>v+'px' },
    { k:'gap',     t:'range', label:'space between cards', min:4, max:28, step:2, fmt:v => v + 'px' },
    { k:'border',  t:'seg',   label:'card edge', opts:['hairline', 'none', 'accent'] },
    { k:'surface', t:'seg',   label:'card ground', opts:['raised', 'flat'] },
    { k:'stickyPreview',t:'toggle',label:'keep the editor preview visible while scrolling' },
  ]],
  ['where each element sits', HubModel.PARTS.map(pt =>
    ({ k:'slot-' + pt.k, t:'part', part:pt.k, label:pt.label, show:pt.show }))],
  ['how each grid cell stacks', [
    { k:'zones', t:'zones', label:'the nine grid cells',
      note:'place items side by side, align them at the top, or stack them vertically' },
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
  ]],
  ['background image', [
    { k:'background-presets', t:'bg-presets', label:'quick starting points' },
    { k:'avatarWash',     t:'range', label:'background opacity',
      min:0, max:100, step:1, fmt:v => v ? v + '%' : 'off',
      note:'turn this up to show the channel image behind the card' },
    { k:'washEffect', t:'seg', label:'background effect',
      opts:['soft','mono','vivid','duotone','sepia','glass','invert','bloom',
            'drift','pan','rotate','breathe','sway','kenburns','float','orbit','pulse','diagonal',
            'zoom','tilt','parallax','spotlight'],
      note:'moving effects have their speed in the animations section' },
    { k:'washFit', t:'seg', label:'image fit',
      opts:['cover','contain','tile','width','height','stretch'],
      note:'cover crops it, contain fits the whole of it in, tile repeats it as a pattern' },
    { k:'washMask', t:'seg', label:'fade at the edges',
      opts:['diagonal','bottom','top','radial','left','right','vignette','corner','edges','none'],
      note:'choose none to keep the whole image visible' },
    { k:'washFade', t:'range', label:'fade reach', min:20, max:200, step:5, fmt:v => v + '%' },
    { k:'washBlend', t:'seg', label:'blend with card colour',
      opts:['normal','multiply','screen','overlay','soft-light','luminosity','hard-light',
            'color-dodge','color-burn','difference','exclusion','lighten','darken',
            'hue','saturation','color'] },
    { k:'washBlur', t:'range', label:'softness', min:0, max:12, step:1, fmt:v => v + 'px' },
    { k:'washSaturate', t:'range', label:'colour saturation', min:0, max:200, step:5,
      fmt:v => +v === 0 ? 'grey' : v + '%' },
    { k:'washContrast', t:'range', label:'contrast', min:50, max:200, step:5, fmt:v=>v+'%' },
    { k:'washBrightness', t:'range', label:'brightness', min:50, max:200, step:5, fmt:v=>v+'%' },
    { k:'washHue', t:'range', label:'hue', min:-180, max:180, step:5,
      fmt:v => +v ? v + '\u00b0' : 'as it is',
      note:'turns the logo\u2019s own colours round the wheel' },
    { k:'washScale', t:'range',label:'image size',min:50,max:200,step:5,fmt:v=>v+'%' },
    { k:'washRotate', t:'range',label:'rotate image',min:-45,max:45,step:1,
      fmt:v => +v ? v + '\u00b0' : 'straight' },
    { k:'washX',t:'range',label:'move left / right',min:0,max:100,step:1,fmt:v=>v+'%' },
    { k:'washY',t:'range',label:'move up / down',min:0,max:100,step:1,fmt:v=>v+'%' },
    { k:'washHoverBoost',t:'range',label:'brighter on hover',min:100,max:200,step:5,
      fmt:v => +v === 100 ? 'no change' : v + '%' },
    { k:'washOverlay',t:'seg',label:'background overlay',
      opts:['none','gradient','vignette','top','bottom','scanlines','grid',
            'dots','noise','diagonal','mesh','frame','corners'] },
    { k:'washOverlayBlend',t:'seg',label:'how the overlay sits on it',
      opts:['normal','multiply','screen','overlay','soft-light','color-dodge'] },
    { k:'washOverlayAngle',t:'range',label:'overlay angle',min:0,max:360,step:5,
      fmt:v => v + '\u00b0', note:'used by the gradient and the diagonal lines' },
    { k:'washOverlayColor',t:'seg',label:'overlay colour from',opts:['category','accent','ground','custom'] },
    { k:'washOverlayCustom',t:'color',label:'custom overlay colour',note:'used when the overlay colour is set to custom' },
    { k:'washOverlayOpacity',t:'range',label:'overlay strength',min:0,max:80,step:5,fmt:v=>v+'%' },
  ]],
  ['the card ground', [
    { k:'cardTint', t:'seg', label:'wash the whole card in a colour',
      opts:['none','category','accent','custom'],
      note:'under everything, including the logo background' },
    { k:'cardTintColor', t:'color', label:'custom card colour', note:'used when the card colour is set to custom' },
    { k:'cardTintStrength', t:'range', label:'how strong the wash is', min:0, max:40, step:1,
      fmt:v => v ? v + '%' : 'off' },
    { k:'cardTintHover', t:'toggle', label:'stronger under the pointer',
      note:'the same wash, roughly twice as much, while the card is hovered' },
    { k:'cardGradient', t:'seg', label:'gradient across the card',
      opts:['none','top','bottom','diagonal','radial','edge','conic','corner','sweep'] },
    { k:'cardGradientStrength', t:'range', label:'how strong the gradient is', min:0, max:200, step:5,
      fmt:v => +v ? v + '%' : 'off' },
    { k:'cardTexture', t:'seg', label:'texture over the ground',
      opts:['none','noise','grain','grid','dots','lines','crosshatch'],
      note:'the one background that is neither a picture nor a colour' },
    { k:'cardTextureOpacity', t:'range', label:'how visible the texture is', min:0, max:40, step:1,
      fmt:v => v ? v + '%' : 'off' },
    { k:'cardTextureScale', t:'range', label:'how big the texture is', min:2, max:40, step:1,
      fmt:v => v + 'px' },
    { k:'cardShadow', t:'seg', label:'the card\u2019s shadow',
      opts:['none','soft','deep','glow','inner'],
      note:'a card on a background sometimes needs one to stay a card' },
  ]],
  ['the parts themselves', [
    { k:'nameLines',    t:'range', label:'lines for the name', min:1, max:4, step:1, fmt:String },
    { k:'descLines',    t:'range', label:'description lines', min:1, max:8, step:1, fmt:String },
    { k:'countStyle',   t:'seg',   label:'how the count reads',
      opts:['badge', 'number'], note:'a badge among the others, or a number of its own' },
    { k:'newDotSize',   t:'range', label:'dot size', min:4, max:14, step:1, fmt:v => v + 'px' },
    { k:'newDotColor',  t:'color', label:'dot colour', accent:true },
    { k:'headFont', t:'seg', label:'headings and channel names', opts:['space','archivo','dmsans','inter','manrope','outfit','syne','system'] },
    { k:'bodyFont', t:'seg', label:'body and descriptions', opts:['jetbrains','archivo','dmsans','inter','manrope','outfit','space','system'] },
    { k:'metaFont', t:'seg', label:'labels, times and facts', opts:['jetbrains','spacemono','inter','dmsans','archivo','system'] },
  ]],
  ['posted today', [
    { k:'showFresh',  t:'toggle', label:'light up a card with a fresh upload',
      note:'a lit edge and a glow, so it reads from across the board' },
    { k:'freshHours', t:'range', label:'how fresh is fresh', min:1, max:72, step:1,
      fmt:v => v + 'h' },
    { k:'freshStyle', t:'seg', label:'fresh card style', opts:['glow','edge','tint','minimal'] },
    { k:'freshColorSource', t:'seg', label:'highlight colour from', opts:['accent','category','custom'] },
    { k:'freshColor', t:'color', label:'custom highlight colour', note:'used when highlight colour is set to custom' },
    { k:'freshIntensity', t:'range', label:'highlight intensity', min:0, max:100, step:5, fmt:v => v + '%' },
    { k:'freshName', t:'toggle', label:'tint the channel name' },
    { k:'freshBadge', t:'toggle', label:'show a fresh upload badge' },
    { k:'freshAging',t:'toggle',label:'soften highlights as uploads age',note:'full intensity at publication, gradually fading through the fresh window' },
  ]],
];

CARD_SETTINGS.unshift(['saved looks', [{k:'looks',t:'looks',label:'saved looks',note:'save a complete card design; share it as a small JSON file'}]]);
CARD_SETTINGS.push(
  ['category styles', [{k:'category-styles',t:'category-styles',label:'effects by category',note:'apply the effects from a saved look; the board layout stays shared'}]],
  ['latest video', [
    {k:'latestPreview',t:'toggle',label:'show the latest video box',
      note:'off hides it on every card; one channel can refuse it on its own, in that channel’s edit pane'},
    {k:'previewOnlyFresh',t:'toggle',label:'only on cards with a fresh upload',
      note:'the box where there is something posted today, and nowhere else'},
    {k:'previewMode',t:'seg',label:'reveal the preview',opts:['hover','always','click'],
      note:'hover also responds to keyboard focus; click opens it from the latest video button alone'},
    {k:'previewLabel',t:'toggle',label:'show “latest video” text',
      note:'turn it off for an icon-only indicator in hover mode'},
    {k:'previewCue',t:'toggle',label:'animate the card when a new video is waiting',
      note:'hovering settles the cue; a small indicator remains when you move away'},
    {k:'previewThumbnail',t:'toggle',label:'show the video thumbnail'},
    {k:'previewThumbSize',t:'seg',label:'thumbnail size',opts:['s','m','l']},
    {k:'previewTitle',t:'toggle',label:'show the video title'},
    {k:'previewAge',t:'toggle',label:'show how long ago it was posted'},
    {k:'previewActions',t:'toggle',label:'show open and queue buttons'},
    {k:'previewHideButton',t:'toggle',label:'a hide button on the box itself',
      note:'takes the box off that one card, which is the channel\u2019s own switch \u2014 the same one in its edit pane, reached from where you are standing when you decide'},
  ]],
  ['animations', [
    {k:'animationSchedule',t:'seg',label:'play decorative effects',opts:['continuous','hover','once','new'],
      note:'once plays when a fresh upload is first displayed; hover also includes keyboard focus; new runs only while the card still carries an unread dot'},
    {k:'pauseOffscreen',t:'toggle',label:'pause effects outside the viewport'},
    {k:'hoverEffect',t:'seg',label:'card hover',opts:['none','lift','zoom','glow','tilt','sink','pop','border','bright','shake','swing','flip','outline','saturate','rotate','skew','wobble']},
    {k:'hoverStrength',t:'range',label:'card hover distance',min:25,max:200,step:5,fmt:v=>v+'%'},
    {k:'hoverSpeed',t:'range',label:'card hover speed',min:0,max:400,step:5,fmt:v=>+v<=0?'instant':(+v/100).toFixed(2)+'s'},
    {k:'cardEnter',t:'seg',label:'card arrival',opts:['none','fade','rise','drop','scale','slide','flip','blur','pop','swing','unfold','zoomout','wipe','spin','glide','tumble']},
    {k:'enterSpeed',t:'range',label:'card arrival speed',min:0,max:4,step:.02,fmt:v=>+v<=0?'instant':(+v).toFixed(2)+'s'},
    {k:'enterEasing',t:'seg',label:'card arrival curve',opts:['out','ease','linear','steady','spring','bounce','snap','elastic']},
    {k:'enterStagger',t:'range',label:'delay between cards',min:0,max:300,step:2,fmt:v=>+v?v+'ms':'all at once'},
    {k:'cardExit',t:'seg',label:'card exit',opts:['none','fade','shrink','slide','blur','fold','fly','drop','implode','spin']},
    {k:'exitSpeed',t:'range',label:'card exit speed',min:0,max:4,step:.02,fmt:v=>+v<=0?'instant':(+v).toFixed(2)+'s'},
    {k:'filterAnimation',t:'seg',label:'filter change',opts:['none','entry','fade','slide','scale','blur']},
    {k:'filterSpeed',t:'range',label:'filter change speed',min:0,max:4,step:.02,fmt:v=>+v<=0?'instant':(+v).toFixed(2)+'s'},
    {k:'reorderSpeed',t:'range',label:'card reorder speed',min:0,max:4,step:.02,fmt:v=>+v<=0?'instant':(+v).toFixed(2)+'s'},
    {k:'reorderEasing',t:'seg',label:'reorder curve',opts:['ease','linear','steady','spring','snap']},
    {k:'freshAnimation',t:'seg',label:'fresh-upload highlight',opts:['none','sheen','glint','breathe','float','wave','ripple','halo','pulse','shimmer','scan','corners','orbit','rays','flicker','neon','bounce','aurora']},
    {k:'freshSpeed',t:'range',label:'fresh highlight speed',min:.1,max:10,step:.1,fmt:v=>(+v).toFixed(1)+'s'},
    {k:'freshEasing',t:'seg',label:'fresh highlight curve',opts:['ease','linear','steady','spring','bounce','snap','elastic']},
    {k:'freshDirection',t:'seg',label:'fresh highlight direction',opts:['normal','reverse','alternate','alternate-reverse']},
    {k:'freshLoops',t:'range',label:'fresh highlight repeats',min:0,max:10,step:1,fmt:v=>+v?v+'\u00d7':'forever'},
    {k:'animationStagger',t:'range',label:'fresh highlight stagger',min:0,max:1500,step:10,fmt:v=>+v?v+'ms':'in step'},
    {k:'staggerOrder',t:'seg',label:'stagger starts at',opts:['index','reverse','random','center','edges']},
    {k:'washAnimationSpeed',t:'range',label:'background image speed',min:.1,max:120,step:.1,fmt:v=>(+v).toFixed(1)+'s'},
    {k:'avatarHover',t:'seg',label:'avatar hover',opts:['none','zoom','spin','tilt','bounce','flip','pop','shake','swing','glow','breathe','wobble']},
    {k:'avatarSpeed',t:'range',label:'avatar hover speed',min:.1,max:10,step:.1,fmt:v=>(+v).toFixed(1)+'s'},
    {k:'dotAnimation',t:'seg',label:'new dot',opts:['none','pulse','blink','ping','bounce','wobble','breathe','flash','spin','orbit','shake']},
    {k:'dotSpeed',t:'range',label:'new dot speed',min:.1,max:10,step:.1,fmt:v=>(+v).toFixed(1)+'s'},
    {k:'refreshEffect',t:'seg',label:'channel refresh',opts:['none','sweep','pulse','bar','blink','dim','glow','stripe','spin','ripple','shimmer']},
    {k:'refreshSpeed',t:'range',label:'channel refresh speed',min:.1,max:10,step:.1,fmt:v=>(+v).toFixed(1)+'s'},
    {k:'previewCueAnimation',t:'seg',label:'new-video cue',opts:['none','pulse','glow','sweep','ring','bounce','border','blink']},
    {k:'previewCueSpeed',t:'range',label:'new-video cue speed',min:.1,max:10,step:.1,fmt:v=>(+v).toFixed(1)+'s'},
    {k:'previewAnimation',t:'seg',label:'video preview reveal',opts:['none','fade','slide','expand','zoom','blur','flip','wipe']},
    {k:'previewSpeed',t:'range',label:'video preview reveal speed',min:0,max:4,step:.02,fmt:v=>+v<=0?'instant':(+v).toFixed(2)+'s'},
    {k:'previewDismissAnimation',t:'seg',label:'video preview dismissal',opts:['none','fade','shrink','slide','blur','fold','fly','drop','implode','spin']},
    {k:'previewDismissSpeed',t:'range',label:'video preview dismissal speed',min:0,max:4,step:.02,fmt:v=>+v<=0?'instant':(+v).toFixed(2)+'s'},
    {k:'previewGrowSpeed',t:'range',label:'card growth on hover',min:0,max:2,step:.02,
     note:'how long the card takes to double when a hover preview opens',
     fmt:v=>+v<=0?'instant':(+v).toFixed(2)+'s'},
    {k:'sheetAnimation',t:'seg',label:'settings panel',opts:['none','scale','slide','fade','blur','drop']},
    {k:'sheetSpeed',t:'range',label:'settings panel speed',min:0,max:4,step:.02,fmt:v=>+v<=0?'instant':(+v).toFixed(2)+'s'},
    {k:'pageBgAnimate',t:'toggle',label:'animate the page background'},
    {k:'pageBgSpeed',t:'range',label:'page background speed',min:1,max:300,step:1,fmt:v=>v+'s'},
    {k:'resizeSpeed',t:'range',label:'card resize speed',min:0,max:4,step:.02,fmt:v=>+v<=0?'instant':(+v).toFixed(2)+'s'},
    {k:'interfaceSpeed',t:'range',label:'menus and feedback speed',min:0,max:4,step:.02,fmt:v=>+v<=0?'instant':(+v).toFixed(2)+'s'},
  ]]
);

const SETTINGS = [
  ['type', [
    { k:'headFont', t:'seg', label:'headings and channel names', opts:['space','archivo','dmsans','inter','manrope','outfit','syne','system'] },
    { k:'bodyFont', t:'seg', label:'body and descriptions', opts:['jetbrains','archivo','dmsans','inter','manrope','outfit','space','system'] },
    { k:'metaFont', t:'seg', label:'labels, times and facts', opts:['jetbrains','spacemono','inter','dmsans','archivo','system'] },
    { k:'titleSize', t:'range', label:'the wordmark', min:28, max:80, step:2, fmt:v => v + 'px' },
    { k:'nameSize',  t:'range', label:'channel name', min:12, max:26, step:.5, fmt:v => v + 'px' },
    { k:'descSize',  t:'range', label:'description', min:9, max:17, step:.5, fmt:v => v + 'px' },
    { k:'badgeSize', t:'range', label:'badges', min:8, max:14, step:.5, fmt:v => v + 'px' },
  ]],
  ['look', [
    { k:'accent',   t:'color', label:'accent colour' },
    /* The board always answered the window and the chrome never did; these two
       are the missing half. Kept apart on purpose — "bigger text" and "more
       room" are different complaints, and setting one to fix the other is how
       a layout ends up wrong in both directions. */
    { k:'uiScale',  t:'range', label:'text size', min:0.8, max:1.5, step:0.05,
      note:'every size in the app at once — the chrome as well as the cards',
      fmt:v => Math.round(v * 100) + '%' },
    { k:'uiDensity',t:'range', label:'spacing', min:0.8, max:1.4, step:0.05,
      note:'the air around everything, without changing how big it is',
      fmt:v => Math.round(v * 100) + '%' },
    { k:'maxWidth', t:'range', label:'content width', min:880, max:WIDTH_FULL, step:40,
      note:'an ultrawide does not want the whole screen', fmt:widthLabel, full:WIDTH_FULL },
    { k:'radius',   t:'range', label:'corner radius', min:0, max:16, step:1, fmt:v => v + 'px' },
    { k:'motion',   t:'range', label:'motion', min:0, max:2, step:0.1,
      fmt:v => v <= 0 ? 'none' : (+v).toFixed(1) + 'x' },
  ]],
  /* The largest background on the board is the one behind it, and until now it
     was one flat colour with no dial at all. Every answer draws over the ground
     rather than replacing it, so none of them can leave the cards floating. */
  ['the page behind the board', [
    { k:'pageBg', t:'seg', label:'background',
      opts:['plain','gradient','glow','grid','dots','noise','vignette','aurora','rays'],
      note:'drawn over the ground, never instead of it \u2014 plain is the board as it was' },
    { k:'pageBgColor', t:'color', label:'background colour', accent:true,
      note:'empty follows the accent' },
    { k:'pageBgStrength', t:'range', label:'how strong it is', min:0, max:100, step:5,
      fmt:v => v ? v + '%' : 'off' },
    { k:'pageBgScale', t:'range', label:'how big the pattern is', min:8, max:80, step:2,
      fmt:v => v + 'px', note:'used by grid, dots and noise' },
    { k:'pageBgAngle', t:'range', label:'angle', min:0, max:360, step:5,
      fmt:v => v + '\u00b0', note:'used by the gradient and the rays' },
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
    { k:'igLanes', t:'range', label:'instagram accounts checked at once', min:1, max:4, step:1,
      ext:true, fmt:v => v + (+v === 1 ? ' at a time' : ' at a time'),
      note:'each one is a real page load in a real tab, so this is deliberately smaller than youtube\u2019s' },
    { k:'igTab', t:'seg', label:'where an instagram card lands',
      opts:['posts','reels','tagged'],
      note:'a profile is already the grid, so posts is the account itself' },
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
    { k:'addOnVideo',  t:'toggle', label:'an + add channel button on video pages',
      note:'files the channel you are watching, into a category you pick', ext:true },
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
SETTINGS.unshift(['card design', [
  {k:'cardeditor',t:'link',label:'saved looks and category styles',section:'saved looks',note:'quiet, neon, cinematic, your presets, import and export'},
  {k:'design-layout',t:'link',label:'layout and item positions',section:'where each element sits',note:'move elements between the nine responsive grid cells in manual mode'},
  {k:'design-effects',t:'link',label:'upload highlights and animations',section:'animations',note:'every animation type, speed, curve and schedule in one section'},
  {k:'design-ground',t:'link',label:'background image and card ground',section:'background image',note:'quick presets, fit, placement, fade, colour and overlays'},
  {k:'design-video',t:'link',label:'latest-video previews',section:'latest video',note:'thumbnail, title, age, open and queue actions'},
  {k:'design-motion',t:'link',label:'animation controls',section:'animations',note:'all motion options and speeds together'},
]]);
SETTINGS.push(['upload views', [
  {k:'uploadView',t:'seg',label:'default upload view',opts:['all','today','week'],note:'today means the last 24 hours, independently of unread dots'},
  {k:'groupUploads',t:'toggle',label:'group cards by upload age',note:'today, this week, older and unknown; pins stay first within their group'},
]], ['extension popup', [
  {k:'popupFresh',t:'toggle',label:'fresh-upload previews in the popup'},
  {k:'popupLimit',t:'range',label:'maximum fresh uploads',min:1,max:12,step:1,fmt:String},
  {k:'popupThumbnails',t:'toggle',label:'popup thumbnails'},
  {k:'popupQueue',t:'toggle',label:'queue shortcut'},
  {k:'popupQuickActions',t:'toggle',label:'refresh, clear dots and random channel actions'},
  {k:'popupGuard',t:'toggle',label:'show guard controls'},
]]);

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
  r.setProperty('--card-radius', ui.cardRadius + 'px');
  r.setProperty('--head', FONT_STACKS[ui.headFont] || FONT_STACKS.space);
  r.setProperty('--body', FONT_STACKS[ui.bodyFont] || FONT_STACKS.jetbrains);
  r.setProperty('--mono', FONT_STACKS[ui.metaFont] || FONT_STACKS.jetbrains);
  r.setProperty('--mo', String(ui.motion));
  document.documentElement.classList.toggle('motion-off', ui.motion === 0);
  document.documentElement.dataset.sheetAnimation = ui.sheetAnimation;
  r.setProperty('--sheet-dur', ui.sheetSpeed + 's');
  r.setProperty('--fresh-strength', ui.freshIntensity / 100);
  r.setProperty('--fresh-cycle', ui.freshSpeed + 's');
  r.setProperty('--wash-blur', ui.washBlur + 'px');
  r.setProperty('--desc-lines', String(ui.descLines));
  r.setProperty('--name-lines', String(ui.nameLines));
  r.setProperty('--av-size', ui.avatarSize + 'px');
  r.setProperty('--grid-gap', ui.gap + 'px');
  r.setProperty('--page-bg-cycle', ui.pageBgSpeed + 's');
  r.setProperty('--interface-cycle',ui.interfaceSpeed+'s');
  r.setProperty('--refresh-cycle',ui.refreshSpeed+'s');

  boards().forEach(g => applyGridLook(g,ui));

  /* One dial over the whole app. Every type size below is expressed *through*
     it, and hub.css restates the chrome's own sizes the same way, so "make it
     bigger" is one number rather than six — and the two remain independent
     afterwards, because the per-part dials are still the per-part dials. */
  r.setProperty('--ui', String(ui.uiScale));
  r.setProperty('--dens', String(ui.uiDensity));
  r.setProperty('--name-px', `calc(${ui.nameSize}px * var(--ui))`);
  r.setProperty('--desc-px', `calc(${ui.descSize}px * var(--ui))`);
  r.setProperty('--badge-px', `calc(${ui.badgeSize}px * var(--ui))`);
  r.setProperty('--title-px', `calc(${ui.titleSize}px * var(--ui))`);
  r.setProperty('--dot-size', ui.newDotSize + 'px');
  r.setProperty('--dot-c', ui.newDotColor || 'var(--y)');
  applyPageBackground();
}

/* ── The page's own background ────────────────────────────────────────────────
   One attribute on <html> and four numbers. Everything it draws is a layer over
   --bg rather than a replacement for it, so `plain` costs nothing and no
   setting here can leave the board without a ground under it. */
function applyPageBackground(){
  const r = document.documentElement.style;
  document.documentElement.dataset.pageBg = ui.pageBg;
  document.documentElement.classList.toggle('page-bg-animate',
    !!ui.pageBgAnimate && ui.pageBg !== 'plain' && ui.motion > 0 && !REDUCED);
  r.setProperty('--page-bg-c', ui.pageBgColor || ui.accent);
  r.setProperty('--page-bg-a', String(ui.pageBgStrength / 100));
  r.setProperty('--page-bg-size', ui.pageBgScale + 'px');
  r.setProperty('--page-bg-angle', ui.pageBgAngle + 'deg');
}

function applyGridLook(g,ui){

    g.dataset.layout = ui.layout;
    g.dataset.border = ui.border;
    g.dataset.surface = ui.surface;
    g.dataset.avatarBorder = ui.avatarBorder;
    g.dataset.count = ui.countStyle;
    g.dataset.avatar = ui.avatarShape;
    g.dataset.avatarFit = ui.avatarFit;
    g.dataset.avatarTone = ui.avatarTone;
    g.dataset.dot = 'slot';
    g.dataset.freshStyle = ui.freshStyle;
    g.dataset.freshAnimation = ui.freshAnimation;
    g.dataset.washEffect = ui.washEffect;
    g.dataset.washPosition = ui.washPosition;
    g.dataset.hover = ui.hoverEffect;
    g.dataset.refreshEffect = ui.refreshEffect;
    g.dataset.enter = ui.cardEnter;
    g.dataset.washMask = ui.washMask;
    g.dataset.washBlend = ui.washBlend;
    g.dataset.washFit = ui.washFit;
    g.dataset.cardTint = ui.cardTint;
    g.dataset.cardGradient = ui.cardGradient;
    g.dataset.avatarHover = ui.avatarHover;
    g.dataset.dotAnimation = ui.dotAnimation;
    g.dataset.texture = ui.cardTexture;
    g.dataset.cardShadow = ui.cardShadow;
    g.dataset.washOverlayBlend = ui.washOverlayBlend;
    g.dataset.previewAnimation = ui.previewAnimation;
    g.dataset.filterAnimation = ui.filterAnimation;
    g.dataset.size = ui.size;
    g.classList.toggle('fresh-name', ui.freshName);
    HubModel.ZONES.forEach(z => { g.setAttribute('data-zone-' + z, ui.zones[z]) });
    g.classList.toggle('no-heat',   !ui.showHeat);
    g.classList.toggle('no-counts', !ui.showCounts);
    g.classList.toggle('no-avatar', !ui.showAvatars);
    g.classList.toggle('no-desc',   !ui.showDesc);
    g.classList.toggle('no-tag',    !ui.showTag);
    g.classList.toggle('no-seen',   !ui.showSeen);
    g.classList.toggle('no-new',    !ui.showNew);
    g.classList.toggle('no-fresh',  !ui.showFresh);
  const vars = {'--name-px':`calc(${ui.nameSize}px * var(--ui))`,
    '--desc-px':`calc(${ui.descSize}px * var(--ui))`,
    '--badge-px':`calc(${ui.badgeSize}px * var(--ui))`,
    '--name-lines':ui.nameLines,'--desc-lines':ui.descLines,'--av-size':ui.avatarSize+'px',
    '--grid-gap':ui.gap+'px','--dot-size':ui.newDotSize+'px','--dot-c':ui.newDotColor || ui.accent,
    '--enter-stagger':ui.enterStagger+'ms','--enter-dur':ui.enterSpeed+'s',
    '--fx-stagger':ui.animationStagger+'ms','--hover-k':ui.hoverStrength/100,
    '--hover-dur':(ui.hoverSpeed/100)+'s','--enter-ease':ENTER_EASES[ui.enterEasing] || ENTER_EASES.out,
    '--wash-speed':ui.washSpeed/100,'--wash-cycle':ui.washAnimationSpeed+'s','--wash-fade':ui.washFade/100,
    '--wash-bright':ui.washBrightness/100,'--wash-hue':ui.washHue+'deg',
    '--overlay-angle':ui.washOverlayAngle+'deg','--grad-strength':ui.cardGradientStrength/100,
    '--texture-opacity':ui.cardTexture === 'none' ? 0 : ui.cardTextureOpacity/100,
    '--texture-size':ui.cardTextureScale+'px',
    '--fresh-loops':ui.freshLoops ? String(ui.freshLoops) : 'infinite',
    '--avatar-cycle':ui.avatarSpeed+'s','--dot-cycle':ui.dotSpeed+'s','--refresh-cycle':ui.refreshSpeed+'s',
    '--preview-cycle':ui.previewSpeed+'s','--preview-dismiss-cycle':ui.previewDismissSpeed+'s',
    '--preview-cue-cycle':ui.previewCueSpeed+'s','--resize-cycle':ui.resizeSpeed+'s',
    '--preview-grow':ui.previewGrowSpeed+'s',
    '--card-width':ui.cardWidth+'px','--card-height':ui.cardHeight+'px','--card-radius':ui.cardRadius+'px'};
  Object.entries(vars).forEach(([k,v])=>g.style.setProperty(k,v));
}

function write(key, value){
  remember(key);
  ui = Store.setUi({ [key]: value });
  if (key === 'uploadView') uploadView = ui.uploadView;
  applyLook();
  render();
  renderPreview();
  if (key === 'addMode' && inExt()) HubBridge.ask({ type:'setAddMode', on:ui.addMode });
}

function remember(key='batch'){
  if (lastEdit.key !== key || Date.now()-lastEdit.at > 500){
    undoStack.push(Store.ui()); if (undoStack.length > 40) undoStack.shift();
  }
  lastEdit = {key,at:Date.now()};
  for (const id of ['settings-undo','card-undo']) $('#'+id).disabled = !undoStack.length;
}
function commit(patch){
  remember(); ui = Store.setUi(patch); uploadView = ui.uploadView;
  applyLook(); render(); renderSettings(); renderCard();
}
function undoChange(){
  const previous = undoStack.pop(); if (!previous) return;
  const addChanged = previous.addMode !== ui.addMode;
  ui = Store.setUi(previous); uploadView = ui.uploadView; lastEdit={key:'',at:0};
  if (addChanged && inExt()) HubBridge.ask({type:'setAddMode',on:ui.addMode});
  applyLook(); render(); renderSettings(); renderCard();
  for (const id of ['settings-undo','card-undo']) $('#'+id).disabled = !undoStack.length;
}
$('#settings-undo').addEventListener('click',undoChange);
$('#card-undo').addEventListener('click',undoChange);
$$('[data-upload-view]').forEach(b=>b.addEventListener('click',()=>write('uploadView',b.dataset.uploadView)));
$('#group-uploads').addEventListener('click',()=>write('groupUploads',!ui.groupUploads));

function openCard(section){
  beforeLook = Store.ui(); showingBefore = false;
  $('#preview-before').setAttribute('aria-pressed','false');
  $('#preview-before').textContent = 'show before';
  renderCard(); openSheet('card');
  if (section){
    const group = [...$('#card-body').children].find(el=>el.dataset.section===section);
    if (group){group.open=true;group.scrollIntoView?.({block:'start'})}
  }
}

function writePlacement(part, zone, anchor='', after=false){
  const slots={...ui.slots,[part]:zone};
  const orders=Object.fromEntries(HubModel.ZONES.map(z=>
    [z,(ui.orders[z]||[]).filter(k=>k!==part)]));
  const list=orders[zone];
  const anchorIndex=list.indexOf(anchor);
  list.splice(anchorIndex<0?list.length:anchorIndex+(after?1:0),0,part);
  remember('placement-'+part);
  ui=Store.setUi({slots,orders});
  applyLook(); render(); renderPreview();
}
const writeSlot=(part,zone)=>writePlacement(part,zone);
const writeZone=(zone,direction)=>write('zones',{...ui.zones,[zone]:direction});

function renderSettings(){
  buildPane($('#set-body'), SETTINGS);
  $('#s-refresh').hidden = !(typeof HubEnrich !== 'undefined' && HubEnrich.can());
}

function buildPane(box, spec){
  const opened = new Set([...box.children].filter(el=>el.open).map(el=>el.dataset.section));
  box.textContent = '';
  spec.forEach(([name, items]) => {
    /* `ext` rows only mean something with a browser extension around them;
       `web` rows only mean something when the board is being served, which is
       neither the extension nor a file off disk. */
    const live = items.filter(it => (!it.ext || inExt()) && (it.t !== 'install' || HubApp.can));
    if (!live.length) return;
    const group = document.createElement('details');
    group.className = 'settings-section'; group.dataset.section = name;
    group.open = opened.has(name) || (!opened.size && box.childElementCount === 0);
    const h = document.createElement('summary');
    h.className = 'set-h';
    h.textContent = name;
    group.appendChild(h);
    live.forEach(it => group.appendChild(control(it)));
    const reset = document.createElement('button');
    reset.type='button'; reset.className='btn btn-s section-reset';reset.textContent='reset this section';
    reset.addEventListener('click',()=>{
      const patch={};
      live.forEach(it=>{
        if (it.t==='part') {
          patch.slots={...HubModel.DEFAULT_SLOTS};
          patch.orders=Object.fromEntries(HubModel.ZONES.map(z=>[z,HubModel.DEFAULT_ORDERS[z].slice()]));
          if(it.show) patch[it.show]=HubModel.DEFAULT_UI[it.show];
        }
        else if (Object.hasOwn(HubModel.DEFAULT_UI,it.k)) patch[it.k]=HubModel.DEFAULT_UI[it.k];
        else if(it.k==='category-styles'){patch.categoryLooks={};patch.pinnedLook=''}
      });
      if (Object.keys(patch).length) commit(patch);
    });
    if (live.some(it=>Object.hasOwn(HubModel.DEFAULT_UI,it.k) || it.t==='part' || it.t==='category-styles')) group.appendChild(reset);
    box.appendChild(group);
  });
  filterSettings(box);
}
function filterSettings(box){
  const query = $(box.id==='card-body' ? '#card-search' : '#settings-search').value.trim().toLowerCase();
  [...box.children].forEach(group=>{
    let visible=0;
    group.querySelectorAll('.set-r').forEach(row=>{
      row.hidden=!!query && !(group.dataset.section+' '+row.textContent).toLowerCase().includes(query);
      if(!row.hidden) visible++;
    });
    group.hidden=!visible;
    if(query && visible) group.open=true;
  });
}
$('#settings-search').addEventListener('input',()=>filterSettings($('#set-body')));
$('#card-search').addEventListener('input',()=>filterSettings($('#card-body')));

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
let previewState = 'fresh';
let previewShowHidden = true;
let manualFullscreen = false;
$('#preview-before').addEventListener('click',()=>{
  showingBefore=!showingBefore;
  $('#preview-before').setAttribute('aria-pressed',String(showingBefore));
  $('#preview-before').textContent=showingBefore ? 'show after' : 'show before';
  renderPreview();
});
$$('[data-preview]').forEach(b => b.addEventListener('click', () => {
  previewState = b.dataset.preview;
  if (previewState !== 'manual') setManualFullscreen(false);
  $$('[data-preview]').forEach(x => {
    x.classList.toggle('on', x === b);
    x.setAttribute('aria-pressed', String(x === b));
  });
  renderPreview();
}));
$('#preview-hidden').addEventListener('click',()=>{
  previewShowHidden=!previewShowHidden;
  $('#preview-hidden').setAttribute('aria-pressed',String(previewShowHidden));
  $('#preview-hidden').textContent=previewShowHidden?'hide hidden elements':'show hidden elements';
  if(previewCard) previewCard.dataset.sig='';
  renderPreview();
});

function syncManualFullscreenScale(){
  const box=$('#card-prev');
  if (!manualFullscreen){box.style.removeProperty('--manual-scale');return}
  const controls=$('.card-stage .preview-controls');
  const availableWidth=Math.max(1,innerWidth-96);
  const availableHeight=Math.max(1,innerHeight-controls.getBoundingClientRect().height-96);
  const scale=Math.max(1,Math.min(3,availableWidth/ui.cardWidth,availableHeight/ui.cardHeight));
  box.style.setProperty('--manual-scale',String(Math.round(scale*1000)/1000));
}
function setManualFullscreen(on){
  manualFullscreen=!!on && previewState==='manual';
  $('.card-stage').classList.toggle('manual-fullscreen',manualFullscreen);
  document.documentElement.classList.toggle('manual-editor-fullscreen',manualFullscreen);
  const button=$('#manual-fullscreen');
  button.classList.toggle('on',manualFullscreen);
  button.setAttribute('aria-pressed',String(manualFullscreen));
  button.textContent=manualFullscreen?'exit fullscreen':'fullscreen';
  syncManualFullscreenScale();
}
$('#manual-fullscreen').addEventListener('click',()=>setManualFullscreen(!manualFullscreen));
addEventListener('resize',syncManualFullscreenScale);

function renderPreview(){
  const box = $('#card-prev');
  if (!box) return;
  const currentUi = ui;
  if (showingBefore && beforeLook) ui=beforeLook;
  applyGridLook(box,ui);
  const ch = sampleChannel();
  ch.latest.at = Date.now() - (['fresh','manual'].includes(previewState) ? Math.min(ui.freshHours / 2, 2) * HR : 96 * HR);
  if (!previewCard || !previewCard.isConnected){
    if(previewCard) effectObserver?.unobserve(previewCard);
    box.textContent = '';
    previewCard = build(ch);
    enableManualPlacement(previewCard);
    box.appendChild(previewCard);
  }
  previewCard.dataset.manual = String(previewState === 'manual');
  previewCard.inert = previewState !== 'manual';
  box.setAttribute('aria-hidden',String(previewState !== 'manual'));
  box.classList.toggle('manual-mode', previewState === 'manual');
  $('.card-stage').classList.toggle('is-manual',previewState === 'manual');
  Object.values(previewCard._parts).forEach(part => { part.draggable = previewState === 'manual' });
  paint(previewCard, ch);
  previewCard.classList.toggle('is-refreshing', previewState === 'refresh');
  ui=currentUi;
  $('.card-stage').classList.toggle('sticky',ui.stickyPreview);
  syncManualFullscreenScale();
}

function enableManualPlacement(card){
  let moving = '';
  let anchor = '';
  let after = false;
  const clearTargets=()=>card.querySelectorAll('.drop-target,.drop-before,.drop-after').forEach(target=>
    target.classList.remove('drop-target','drop-before','drop-after'));
  Object.entries(card._parts).forEach(([key,part]) => {
    part.addEventListener('dragstart', e => {
      if (card.dataset.manual !== 'true'){ e.preventDefault(); return }
      moving = key;
      card.classList.add('manual-dragging');
      e.dataTransfer?.setData('text/plain', key);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    });
    part.addEventListener('dragend', () => {
      moving = ''; card.classList.remove('manual-dragging');
      anchor='';clearTargets();
    });
  });
  card.querySelectorAll('.zone').forEach(zone=>{
    zone.addEventListener('dragover',e=>{
      if(card.dataset.manual!=='true') return;
      e.preventDefault();clearTargets();zone.classList.add('drop-target');
      const target=e.target.closest?.('[data-part]');
      anchor=target&&target.dataset.part!==moving?target.dataset.part:'';
      after=false;
      if(anchor){
        const rect=target.getBoundingClientRect();
        const column=zone.dataset.direction==='column';
        after=column?e.clientY>=rect.top+rect.height/2:e.clientX>=rect.left+rect.width/2;
        target.classList.add(after?'drop-after':'drop-before');
      }
    });
    zone.addEventListener('drop',e=>{
      if(card.dataset.manual!=='true') return;
      e.preventDefault();
      const key=moving||e.dataTransfer?.getData('text/plain');
      if(HubModel.PART_KEYS.includes(key)) writePlacement(key,zone.dataset.z,anchor,after);
      moving='';anchor='';card.classList.remove('manual-dragging');clearTargets();
    });
  });
}

function renderCard(){
  const first = ['saved looks','animations','background image','the card ground','posted today','category styles','latest video'];
  buildPane($('#card-body'), [
    ...first.map(name => CARD_SETTINGS.find(([section]) => section === name)),
    ...CARD_SETTINGS.filter(([section]) => !first.includes(section)),
  ]);
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
  if (it.t === 'looks') buildLooksControl(row);
  if (it.t === 'category-styles') buildCategoryStyles(row);

  if (it.t === 'toggle'){
    row.classList.add('as-button');
    row.appendChild(document.createElement('b'));
    row.classList.toggle('on', !!ui[it.k]);
    row.setAttribute('role', 'button');
    row.setAttribute('aria-pressed', String(!!ui[it.k]));
    row.tabIndex = 0;
    const flip = () => {
      write(it.k, !ui[it.k]); row.classList.toggle('on', !!ui[it.k]);
      row.setAttribute('aria-pressed', String(!!ui[it.k]));
    };
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
    inp.setAttribute('aria-label', it.label);
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
    inp.setAttribute('aria-label', it.label);
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
        remember(); ui = Store.setUi(p2.ui);
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

  if (it.t === 'bg-presets'){
    const choices=document.createElement('div');
    choices.className='presets';
    BACKGROUND_PRESETS.forEach(preset=>{
      const button=document.createElement('button');
      button.type='button';button.className='btn btn-s';button.textContent=preset.name;
      button.dataset.backgroundPreset=preset.name;
      button.addEventListener('click',()=>commit(preset.ui));
      choices.appendChild(button);
    });
    row.appendChild(choices);
  }

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

    const map=document.createElement('div');
    map.className='zone-map';
    HubModel.ZONES.forEach(zone=>{
      const b = document.createElement('button');
      b.type = 'button';
      b.className='zc'+(ui.slots[it.part]===zone?' on':'');
      b.dataset.z=zone;b.title=HubModel.ZONE_NAMES[zone];
      b.setAttribute('aria-label',it.label+': '+HubModel.ZONE_NAMES[zone]);
      b.addEventListener('click', () => {
        writeSlot(it.part,zone);
        [...map.children].forEach(x=>x.classList.toggle('on',x===b));
      });
      map.appendChild(b);
    });
    row.appendChild(map);
  }

  if(it.t==='zones'){
    row.classList.add('as-block');
    const map=document.createElement('div');
    map.className='zone-grid';
    const directions=[['row','↔','side by side'],['top','↱','align at top'],['column','↕','stacked']];
    HubModel.ZONES.forEach(zone=>{
      const cell=document.createElement('div');
      cell.className='zg';cell.dataset.z=zone;
      const name=document.createElement('span');
      name.className='zg-k';name.textContent=HubModel.ZONE_NAMES[zone];cell.appendChild(name);
      const seg=document.createElement('div');seg.className='seg';
      directions.forEach(([direction,glyph,title])=>{
        const b=document.createElement('button');
        b.type='button';b.className='seg-b'+(ui.zones[zone]===direction?' on':'');
        b.dataset.v=direction;b.textContent=glyph;b.title=title;
        b.setAttribute('aria-label',HubModel.ZONE_NAMES[zone]+': '+title);
        b.addEventListener('click',()=>{
          writeZone(zone,direction);
          [...seg.children].forEach(x=>x.classList.toggle('on',x===b));
        });
        seg.appendChild(b);
      });
      cell.appendChild(seg);map.appendChild(cell);
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
    b.addEventListener('click', () => openCard(it.section));
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

let selectedLook = 'quiet';
function lookSelect(value, label, inherit=false){
  const select=document.createElement('select'); select.setAttribute('aria-label',label);
  const options = [...(inherit ? [{id:'',name:'Inherit board effects'}] : []),...HubModel.looks(ui)];
  options.forEach(p=>{const o=document.createElement('option');o.value=p.id;o.textContent=p.name;select.appendChild(o)});
  select.value=value; return select;
}
function buildLooksControl(row){
  row.classList.add('as-block');
  const select=lookSelect(selectedLook,'Saved look');select.id='look-select';
  const name=document.createElement('input');name.type='text';name.maxLength=60;name.placeholder='Name this look';name.setAttribute('aria-label','New look name');name.id='look-name';
  const actions=document.createElement('div');actions.className='look-actions';
  const button=(text,act,id)=>{const b=document.createElement('button');b.type='button';b.className='btn btn-s';b.textContent=text;b.id=id;b.addEventListener('click',act);actions.appendChild(b);return b};
  const custom=()=>ui.savedLooks.some(p=>p.id===select.value);
  select.addEventListener('change',()=>{selectedLook=select.value;update.disabled=remove.disabled=!custom()});
  button('apply',()=>{const p=HubModel.looks(ui).find(p=>p.id===select.value);if(p){commit(p.look);said('applied '+p.name)}},'look-apply');
  button('save as new',()=>{
    if(!name.value.trim()){name.focus();return}
    if(ui.savedLooks.length>=40){said('40 saved looks; remove one before adding another');return}
    const p={id:'look-'+HubModel.uid(),name:name.value.trim(),look:HubModel.pickLook(ui)};
    selectedLook=p.id;commit({savedLooks:[...ui.savedLooks,p]});said('saved '+p.name);
  },'look-save');
  const update=button('update saved',()=>{
    commit({savedLooks:ui.savedLooks.map(p=>p.id===select.value?{...p,look:HubModel.pickLook(ui)}:p)});
  },'look-update');
  const remove=button('delete saved',()=>{
    const id=select.value;selectedLook='quiet';
    commit({savedLooks:ui.savedLooks.filter(p=>p.id!==id)});said('look removed; undo restores it');
  },'look-delete');
  update.disabled=remove.disabled=!custom();
  button('export selected',()=>{
    const p=HubModel.looks(ui).find(p=>p.id===select.value);if(!p)return;
    downloadJSON({kind:'hub.look',version:1,name:p.name,look:p.look},'hub-look.json');
  },'look-export');
  button('import look',()=>$('#look-file').click(),'look-import');
  row.append(select,name,actions);
}
function downloadJSON(data,name){
  const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download=name;a.hidden=true;
  document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
$('#look-file').addEventListener('change',async e=>{
  const file=e.target.files[0];if(!file)return;
  try{
    if(file.size>200000) throw Error('file too large');
    const data=JSON.parse(await file.text());
    if(data.kind!=='hub.look'||data.version!==1||!data.look||typeof data.look!=='object'||Array.isArray(data.look)) throw Error('not a HUB look');
    if(ui.savedLooks.length>=40) throw Error('saved-look limit reached');
    const p={id:'look-'+HubModel.uid(),name:String(data.name||'Imported look').slice(0,60),look:HubModel.pickLook(HubModel.fillUi({...data.look,savedLooks:[],categoryLooks:{}}))};
    selectedLook=p.id;commit({savedLooks:[...ui.savedLooks,p]});said('imported '+p.name+'; choose apply to use it');
  }catch(err){said('could not import look: '+err.message)}
  e.target.value='';
});
function buildCategoryStyles(row){
  row.classList.add('as-block');
  const add=(label,id,value)=>{
    const wrap=document.createElement('label');wrap.className='category-look';
    const title=document.createElement('span');title.textContent=label;
    const select=lookSelect(value,label+' effects',true);select.dataset.category=id;
    select.addEventListener('change',()=>{
      if(id==='__pinned')write('pinnedLook',select.value);
      else write('categoryLooks',{...ui.categoryLooks,[id]:select.value});
    });wrap.append(title,select);row.appendChild(wrap);
  };
  Store.cats().forEach(cat=>add(cat.name,cat.id,ui.categoryLooks[cat.id]||''));
  add('Uncategorised','',ui.categoryLooks['']||'');
  add('Pinned channels (takes priority)','__pinned',ui.pinnedLook);
}

/* ── Export and import ───────────────────────────────────────────────────── */
const said = msg => {
  $('#s-said').textContent = msg;
  $('#notice').textContent=msg;$('#notice').hidden=false;
  setTimeout(()=>{
    if($('#s-said').textContent===msg)$('#s-said').textContent='';
    if($('#notice').textContent===msg)$('#notice').hidden=true;
  },4000);
};

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
  syncResizeBar();
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
    const widths = {s:200,m:268,l:352};
    ui = Store.setUi({ size, cardWidth:widths[size] });
    applyLook(); syncResizeBar();
    render();                        /* FLIP carries the cards to their new boxes */
  });
});

function syncResizeBar(){
  $$('[data-resize]').forEach(inp => {
    const key = inp.dataset.resize;
    inp.value = ui[key];
    inp.nextElementSibling.textContent = ui[key] + (key === 'washScale' ? '%' : 'px');
  });
}
$('#btn-resize').addEventListener('click', () => {
  const bar = $('#resizebar');
  bar.hidden = !bar.hidden;
  $('#btn-resize').classList.toggle('on', !bar.hidden);
  $('#btn-resize').setAttribute('aria-expanded', String(!bar.hidden));
  if (!bar.hidden) syncResizeBar();
});
$('#resize-done').addEventListener('click', () => $('#btn-resize').click());
$$('[data-resize]').forEach(inp => inp.addEventListener('input', () => {
  const key = inp.dataset.resize;
  const patch = {[key]:+inp.value};
  if (key === 'cardWidth'){ patch.size = 'custom'; size = 'custom'; $$('#size .seg-b').forEach(b=>b.classList.remove('on')) }
  ui = Store.setUi(patch);
  inp.nextElementSibling.textContent = ui[key] + (key === 'washScale' ? '%' : 'px');
  applyLook(); renderPreview();
}));


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
const refreshing = new Set();
let refreshLast = null;
/* The board in front of you, and not the other one. Refresh on the YouTube tab
   quietly opening a dozen Instagram tabs would be a surprise, and a surprise
   that shows up as tabs appearing in your window is the worst kind. */
async function refreshChannels(){
  if (HubEnrich.busy()) return;
  const P = platform();
  try {
    const out = await HubEnrich.pass({ force:true, ui, platform:ui.tab });
    said(out.done
      ? 'checked ' + out.done + ' ' + (out.done === 1 ? P.noun : P.nouns) +
        (out.failed ? ', ' + out.failed + ' could not be read' : '')
      : 'nothing to check on ' + P.label);
  } catch {
    said('refresh interrupted; try again');
  } finally { render() }
}
$('#s-refresh').addEventListener('click', refreshChannels);
$('#btn-refresh').addEventListener('click', refreshChannels);
$('#btn-refresh').hidden = !(typeof HubEnrich !== 'undefined' && HubEnrich.can());

if (typeof HubEnrich !== 'undefined'){
  /* Each channel is written the moment its answer comes back, so the board is
     redrawn as the pass runs rather than all at once at the end. Avatars
     arriving one at a time reads as the thing working; forty of them appearing
     together a minute later reads as a reload. */
  HubEnrich.onProgress(p => {
    const busy = !!p;
    for (const button of [$('#s-refresh'), $('#btn-refresh')]){
      button.disabled = busy;
      button.classList.toggle('busy', busy);
      button.setAttribute('aria-busy', String(busy));
    }
    grid.setAttribute('aria-busy', String(busy));
    if (p){
      refreshLast = p;
      if (p.phase === 'start'){
        refreshing.add(p.id);
        nodes.get(p.id)?.classList.add('is-refreshing');
      }
      if (p.phase === 'done'){
        refreshing.delete(p.id);
        const el = nodes.get(p.id);
        const ch = Store.channels().find(c=>c.id===p.id);
        if (el && ch) paint(el,ch);
        el?.classList.remove('is-refreshing');
      }
      $('#refresh-status').hidden = false;
      $('#refresh-label').textContent = 'refreshing ' + p.at + ' / ' + p.of;
      $('#refresh-progress').max = p.of;
      $('#refresh-progress').value = p.at;
    } else {
      refreshing.clear();
      if (refreshLast){
        const p = refreshLast;
        $('#refresh-label').textContent = p.at < p.of ? 'refresh interrupted; try again' :
          'checked ' + p.at + ' channels' + (p.failed ? ' · ' + p.failed + ' could not fully refresh' : ' · up to date');
        refreshLast = null;
      }
      render();
    }
  });
}

/* ── Keys ────────────────────────────────────────────────────────────────────
   Three, and only where they cannot be mistaken for typing. */
addEventListener('keydown', e => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);

  if (e.key === 'Escape'){
    if (manualFullscreen){ setManualFullscreen(false); return }
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
let clockTicks = 0;
setInterval(() => {
  clockTicks++;
  Store.channels().forEach(ch => {
    const el = nodes.get(ch.id);
    if (el){
      el.classList.toggle('is-fresh', isFresh(ch));
      paintEffects(el,ch); paintVideoPreview(el,ch);
      paintBadges(el, ch);
    }
  });
  if((uploadView !== 'all' || ui.groupUploads) && clockTicks % 5 === 0) render();
}, 60e3);

/* Another tab of the same board is the same board. Only the data keys, not
   hub.ui.v1 — resizing the cards in one window should not reload the other. */
addEventListener('storage', e => {
  if (e.key === 'hub.channels.v1' || e.key === 'hub.cats.v1') location.reload();
});

/* Inside the extension the store watches chrome.storage instead, which is also
   how a channel added from a YouTube page reaches a board already open. */
Store.onChange(() => { ui = Store.ui(); applyLook(); render(); renderPreview() });

/* Start.
   The store may have to be read out of chrome.storage, which is asynchronous.
   Nothing else in the app is: it waits here, once, and every read after this
   comes off the cache. */
(async () => {
  await Store.ready;
  ui = Store.ui();
  const launch = new URLSearchParams(location.search);
  uploadView = ['all','today','week'].includes(launch.get('view')) ? launch.get('view') : ui.uploadView;
  sort = ui.sort; size = ui.size;
  sortSel.value = sort;
  $$('#size .seg-b').forEach(b => b.classList.toggle('on', b.dataset.size === size));
  applyLook();
  syncResizeBar();
  render();

  if (launch.get('panel') === 'settings'){renderSettings();openSheet('set')}
  if (launch.get('panel') === 'card') openCard();
  if (launch.get('panel') === 'queue'){renderQueue();openSheet('q')}
  if (launch.get('refresh') === '1' && HubEnrich.can()) refreshChannels();

  /* One quiet pass in the background, over whatever is missing or stale. It
     never blocks the board: the cards are already on screen, and each channel
     redraws as its own answer comes back. */
  if (typeof HubEnrich !== 'undefined' && HubEnrich.can() && ui.checkNew !== false && launch.get('refresh') !== '1'){
    HubEnrich.pass({ ui, platform:ui.tab }).then(out => { if (out.done) render() })
      .catch(() => said('refresh interrupted; try again'));
  }
})();

})();
