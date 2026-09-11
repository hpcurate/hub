/* ── Guard ────────────────────────────────────────────────────────────────────
   Runs on every YouTube page at document_start.

   v0.2.0 covered a blocked page: blur it, put the board over it in an iframe.
   That did not work, and covering was never really blocking anyway — the page
   was still loaded, still playing, still one Escape from being underneath you.
   Since v0.3.0 a blocked page **changes address**. The tab goes to the board,
   the YouTube document is gone, and the thing that decides where you end up is
   the board rather than a layer on top of something you did not choose.

   The veil stays, but only as cover: it hides the page for the few milliseconds
   between document_start and the decision, so nothing of the feed is ever seen.

   The rule this file is written around is unchanged: **a failure must leave
   YouTube alone.** Every path that could hang ends in an unveil, never in a
   redirect — a wrong redirect is a page you cannot reach, which is the one
   outcome worse than a video that slipped through.
*/
(() => {
  if (window.top !== window) return;         /* embeds and ad frames are not pages */

  const html = document.documentElement;
  const ADD_ID = 'hub-add-root';

  let bypass = false;                        /* set by the board, or by escape */
  let addBtn = null;                         /* the host, one per page */
  let addBar = null;                         /* the row of buttons inside it */
  let addKeys = new Set();                   /* which buttons are already in it */
  let addKind = null;                        /* what the injected bar is for */
  let closePicker = null;                    /* the one open category menu */
  let lastUrl = location.href;
  let seq = 0;                               /* cancels the work of a stale url */
  let gone = false;                          /* a redirect is under way */

  /* ── The veil ──────────────────────────────────────────────────────────────
     The class on <html> is the only record of whether it is on. A boolean
     beside it is a second source of truth, and the two coming apart is how a
     page ends up blurred with nothing willing to take it off. */
  const isVeiled = () => html.classList.contains('hub-veil');

  function veil(){
    if (isVeiled() || bypass) return;
    html.classList.remove('hub-unveiling');
    html.classList.add('hub-veil');
    try { document.querySelectorAll('video,audio').forEach(v => v.pause()) } catch {}
  }

  function unveil(){
    if (isVeiled()){
      html.classList.add('hub-unveiling');
      html.classList.remove('hub-veil');
      setTimeout(() => html.classList.remove('hub-unveiling'), 400);
    }
  }

  /* The failsafe, armed before anything else can go wrong. */
  let deadman = setTimeout(unveil, 4000);
  const rearm = ms => { clearTimeout(deadman); deadman = setTimeout(unveil, ms) };

  veil();                                    /* before the first paint, then decide */

  /* ── Talking to the background ───────────────────────────────────────────────
     Never rejects and never hangs: a dead worker answers `null`, and null means
     no guard, which means the page is left alone. */
  const ask = msg => new Promise(resolve => {
    let done = false;
    const finish = v => { if (!done){ done = true; resolve(v) } };
    setTimeout(() => finish(null), 1500);
    try {
      chrome.runtime.sendMessage(msg, res => {
        void chrome.runtime.lastError;        /* read it so it is not logged */
        finish(res && !res.error ? res : null);
      });
    } catch { finish(null) }
  });

  /* ── Leaving ────────────────────────────────────────────────────────────────
     The whole of blocking, in four lines. `replace` rather than `href` so the
     blocked page does not sit in the back button waiting to be walked into
     again, and `gone` so nothing that was already in flight tries to undo it. */
  function sendToBoard(){
    if (gone) return;
    let url;
    try { url = chrome.runtime.getURL('index.html') }
    catch { unveil(); bypass = true; return }  /* extension reloaded under us */
    gone = true;
    location.replace(url + '?blocked=1&from=' + encodeURIComponent(location.href));
  }

  /* ── Reading who owns a video ──────────────────────────────────────────────
     YouTube says it in several places and not all of them are there at once, so
     every known spelling is tried and the first that parses wins. */
  const OWNER_SEL = [
    'ytd-video-owner-renderer a[href]',
    '#owner a[href^="/@"]', '#owner a[href^="/channel/"]',
    '#upload-info a[href]',
    'ytd-channel-name a[href]',
    'ytd-reel-player-header-renderer a[href]',
    'link[itemprop="url"][href*="/channel/"]', 'link[itemprop="url"][href*="/@"]',
    '#above-the-fold #owner a[href]',
  ];

  function readOwner(){
    const meta = document.querySelector('meta[itemprop="channelId"]');
    if (meta && meta.content) return { kind:'id', key:meta.content };
    for (const sel of OWNER_SEL){
      for (const a of document.querySelectorAll(sel)){
        const href = a.getAttribute('href');
        const scope = href && HubScope.parse(href);
        if (scope) return scope;
      }
    }
    return null;
  }

  function waitForOwner(ms){
    return new Promise(resolve => {
      const now = readOwner();
      if (now) return resolve(now);
      let obs;
      const stop = v => { try { obs && obs.disconnect() } catch {} ; resolve(v) };
      const t = setTimeout(() => stop(null), ms);
      obs = new MutationObserver(() => {
        const o = readOwner();
        if (o){ clearTimeout(t); stop(o) }
      });
      obs.observe(document.documentElement, { childList:true, subtree:true });
    });
  }

  /* Only ever read from things that describe *this* page. A channel page is
     full of links to other channels, and widening a grant from one of those
     would unlock exactly what the guard is for. */
  function readSelfId(){
    const meta = document.querySelector('meta[itemprop="channelId"]');
    if (meta && meta.content) return { kind:'id', key:meta.content };
    const canon = document.querySelector('link[rel="canonical"]');
    if (canon && canon.href){
      const s = HubScope.parse(canon.href);
      if (s) return s;
    }
    return null;
  }

  function learnAliases(){
    let tries = 0;
    const look = () => {
      const self = readSelfId();
      if (self) return void ask({ type:'alias', scope:self });
      if (++tries < 12) setTimeout(look, 250);     /* head fills in as it parses */
    };
    look();
  }

  /* ── Add mode ────────────────────────────────────────────────────────────────
     The guard stands down, and a channel page grows a button that files it into
     the board. This is the way in for a channel you found rather than one you
     already had — before it, the only way to add one was to type its url.

     The button writes through the background, because the board's channel list
     lives in chrome.storage and a content script on youtube.com cannot reach it. */
  function channelTitle(){
    /* "Veritasium - YouTube" -> "Veritasium". The og:title has it clean when
       it is there, which it usually is by the time the button is clicked. */
    const og = document.querySelector('meta[property="og:title"]');
    if (og && og.content) return og.content.trim();
    return document.title.replace(/\s*[-|]\s*YouTube\s*$/i, '').trim();
  }

  function dropAdd(){
    addKind = null;
    addBar = null;
    addKeys = new Set();
    closePicker = null;
    if (!addBtn) return;
    addBtn.remove(); addBtn = null;
  }

  /* ── Where the button goes ───────────────────────────────────────────────────
     Asked for: in the channel page's own action row, beside Subscribe and Join.
     That row has been re-spelled several times, so several spellings are tried
     and the first that is actually on the page wins. If none is — a layout that
     has moved on, or a page that has not finished building — it falls back to
     the floating position rather than not appearing at all. A button you cannot
     find is the same as no button. */
  const ROW_SEL = [
    'yt-flexible-actions-view-model',
    '#page-header yt-flexible-actions-view-model',
    'ytd-c4-tabbed-header-renderer #buttons',
    '#channel-header-container #buttons',
    'ytd-channel-header-renderer #buttons',
    '#inner-header-container #buttons',
  ];

  function findRow(){
    for (const sel of ROW_SEL){
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function whenRow(ms, then){
    const now = findRow();
    if (now) return then(now);
    let obs;
    const stop = el => { try { obs && obs.disconnect() } catch {} ; then(el) };
    const t = setTimeout(() => stop(null), ms);
    obs = new MutationObserver(() => {
      const el = findRow();
      if (el){ clearTimeout(t); stop(el) }
    });
    obs.observe(document.documentElement, { childList:true, subtree:true });
  }

  /* One host, one shadow root, and a row inside it. `kind` is what stops the
     row being rebuilt on every SPA tick, and what lets a page change its mind.

     It is a row rather than a single button because a video page has two
     things to offer — keep the video, keep whoever made it — and they arrive
     at different times: the queue button knows everything it needs from the
     url, while the add button has to read the owner and ask the board about it
     first. Appending the second into a row that is already up is what keeps
     the first from being rebuilt underneath a click. */
  function mountBar(kind, { inline } = {}){
    if (addBtn && addKind === kind) return true;
    dropAdd();

    let cssUrl;
    try { cssUrl = chrome.runtime.getURL('ext/add.css') } catch { return false }

    addKind = kind;
    addBtn = document.createElement('div');
    addBtn.id = ADD_ID;
    const root = addBtn.attachShadow({ mode:'open' });

    const css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = cssUrl;

    addBar = document.createElement('div');
    addBar.className = 'bar';
    root.append(css, addBar);

    /* Shown at once, floating, and moved into the channel's action row when
       that row turns up. Waiting for the row before showing anything would mean
       seconds with no button on a page that is still building itself, and the
       row does not always arrive at all. */
    html.appendChild(addBtn);

    if (inline) whenRow(6000, row => {
      if (!row || !addBtn) return;
      addBtn.classList.add('inline');
      row.appendChild(addBtn);
    });
    return true;
  }

  /* A click anywhere else closes the open menu. One listener for the page
     rather than one per button: a session on YouTube is one document for hours,
     and a listener left behind by every button that was ever mounted is a leak
     with nothing to end it. A click inside the shadow root is retargeted to the
     host, which is the one case ignored. */
  addEventListener('pointerdown', e => {
    if (closePicker && e.target !== addBtn) closePicker();
  }, true);

  /* ── One button in the row ────────────────────────────────────────────────
     `state` is what it says before it is touched — `have` is the answer to
     "make it know if you have already added a channel", which is a thing the
     board can be asked rather than something to find out by clicking.

     `pick` turns the click into a menu instead of an action: the categories,
     as the board orders them, and then the action with the one chosen. */
  function makeButton({ label, sub, state, onClick, pick }){
    const slot = document.createElement('div');
    slot.className = 'slot';

    const b = document.createElement('button');
    b.className = 'btn' + (state ? ' ' + state : '');
    const say = (text, note) => {
      b.textContent = text;
      if (note){ const s = document.createElement('small'); s.textContent = note; b.appendChild(s) }
    };
    say(label, sub);

    let menu = null;
    const closeMenu = () => {
      if (!menu) return;
      menu.remove(); menu = null;
      if (closePicker === closeMenu) closePicker = null;
    };

    const settle = res => {
      closeMenu();
      b.className = 'btn' + (res.already ? ' have' : ' done');
      say(res.text, res.sub || '');
    };

    const spent = () => b.classList.contains('done') || b.classList.contains('have');

    /* The menu, built on demand and thrown away on every close, because the
       board's categories can have changed between two openings of it.

       Escape is not a way out of it on purpose: three of those inside two
       seconds is the guard's own hatch, and a menu that quietly eats the first
       one would make that hatch unreliable on exactly the pages it is for.
       A click anywhere else, or on the button again, closes it. */
    function openMenu(){
      const items = (pick && pick.items) || [];
      menu = document.createElement('div');
      menu.className = 'menu';

      const head = document.createElement('div');
      head.className = 'menu-head';
      head.textContent = pick.head || 'file it under';
      menu.appendChild(head);

      const row = (item, none) => {
        const el = document.createElement('button');
        el.className = 'item' + (none ? ' none' : '');
        const dot = document.createElement('i');
        if (!none) dot.style.background = item.color || '#555';
        el.append(dot, document.createTextNode(item.name));
        el.addEventListener('click', async () => {
          if (spent()) return;
          const res = await pick.onPick(item);
          if (res) settle(res);
          else closeMenu();
        });
        return el;
      };

      items.forEach(c => menu.appendChild(row(c, false)));
      menu.appendChild(row({ id:'', name:'no category' }, true));
      slot.appendChild(menu);
      closePicker = closeMenu;
    }

    b.addEventListener('click', async () => {
      if (spent()) return;
      if (pick){
        if (menu) return closeMenu();
        return openMenu();
      }
      const res = await onClick();
      if (res) settle(res);
    });

    slot.appendChild(b);
    return slot;
  }

  /* Into the row that is already up, once, by key. */
  function addToBar(key, spec){
    if (!addBar || addKeys.has(key)) return;
    addKeys.add(key);
    addBar.appendChild(makeButton(spec));
  }

  /* ── The three things it can be ─────────────────────────────────────────── */
  function addOnChannel(scope){
    if (!mountBar('channel:' + scope.kind + scope.key, { inline:true })) return;
    addToBar('add', {
      label:'+ add to hub', sub:'add mode',
      onClick: async () => {
        const res = await ask({ type:'addChannel',
                                url: HubScope.channelUrl(scope), name: channelTitle() });
        if (!res) return null;
        return { text: res.already ? 'already on the board' : 'added',
                 sub: res.already ? '' : 'add mode', already: res.already };
      },
    });
  }

  /* Every channel linked from the subscriptions page, in one pass. */
  function collectChannels(){
    const seen = new Set(), out = [];
    document.querySelectorAll('a[href]').forEach(a => {
      const href = a.getAttribute('href') || '';
      const scope = HubScope.parse(href);
      if (!scope) return;
      const key = scope.kind + ':' + scope.key;
      if (seen.has(key)) return;
      seen.add(key);
      const row = a.closest('ytd-channel-renderer, ytd-grid-channel-renderer, ytd-item-section-renderer') || a;
      const titled = row.querySelector && row.querySelector('#channel-title, #text, yt-formatted-string');
      const name = ((titled && titled.textContent) || a.textContent || '').trim().split(String.fromCharCode(10))[0];
      out.push({ url: HubScope.channelUrl(scope), name: name.slice(0, 80) });
    });
    return out;
  }

  function addAllHere(){
    if (!mountBar('bulk')) return;
    addToBar('bulk', {
      label:'+ add every channel here', sub:'add mode',
      onClick: async () => {
        const items = collectChannels();
        if (!items.length) return { text:'nothing to add here', already:true };
        const res = await ask({ type:'addMany', items });
        if (!res) return null;
        return { text: res.added ? 'added ' + res.added : 'all of them were already on the board',
                 sub: res.added ? 'of ' + res.seen + ' found' : '', already: !res.added };
      },
    });
  }

  function queueHere(page){
    if (!page.videoId) return;
    addToBar('queue', {
      label:'+ queue', sub:'watch later',
      onClick: async () => {
        const owner = readOwner();
        const res = await ask({ type:'enqueue', videoId:page.videoId, url:location.href,
                                title:channelTitle(),
                                channelUrl: owner ? HubScope.channelUrl(owner) : '' });
        if (!res) return null;
        return { text: res.already ? 'already queued' : 'queued',
                 sub:'', already: res.already };
      },
    });
  }

  /* ── The channel behind the video ──────────────────────────────────────────
     Adding a channel used to mean going to its page first. The thing you are
     actually looking at when you decide you want more of someone is one of
     their videos, and this is that decision made where it happens.

     Three things the button has to do before it is any use: read who owns the
     video, say whether that channel is already on the board rather than
     waiting for a click to find out, and let the channel be filed into a
     category on the way in — a board of forty uncategorised cards is the
     thing categories exist to avoid.

     `mine` is the navigation this was started for. YouTube is one document for
     a whole session, so by the time the owner has been read and the board has
     answered, the page may be a different video entirely — and a button for
     the last one is worse than no button. */
  async function addChannelHere(){
    const mine = seq;
    const stale = () => mine !== seq || gone || bypass;

    const owner = readOwner() || await waitForOwner(6000);
    if (stale() || !owner) return;

    const url = HubScope.channelUrl(owner);
    const info = await ask({ type:'addInfo', url });
    if (stale() || !info) return;

    const cats = Array.isArray(info.cats) ? info.cats : [];
    const file = async cat => {
      const res = await ask({ type:'addChannel', url, name:videoChannelName(), cat:cat.id });
      if (!res) return null;
      return { text: res.already ? 'already on the board' : 'added',
               sub: res.added && cat.id ? cat.name : '', already: res.already };
    };

    addToBar('add', info.already
      ? { label:'on the board', sub:'this channel', state:'have' }
      : { label:'+ add channel', sub:'this channel',
          /* One click opens the categories, the second files it. With no
             categories on the board there is nothing to choose between, so the
             click is the whole action. */
          pick: cats.length ? { items:cats, head:'file it under', onPick:file } : null,
          onClick: () => file({ id:'', name:'' }) });
  }

  /* The channel's name on a watch page, which is not `channelTitle()` — the
     title of this document is the video. YouTube spells the owner's name in
     several places and not all of them are there at once, so the first that
     reads as a name wins and the url's own spelling is the fallback. */
  const OWNER_NAME_SEL = [
    'ytd-video-owner-renderer ytd-channel-name #text',
    'ytd-video-owner-renderer #channel-name #text',
    '#owner ytd-channel-name a',
    '#upload-info ytd-channel-name a',
    'ytd-channel-name a',
    'link[itemprop="name"]',
  ];

  function videoChannelName(){
    for (const sel of OWNER_NAME_SEL){
      const el = document.querySelector(sel);
      const name = el && (el.textContent || el.getAttribute('content') || '').trim();
      if (name) return name.slice(0, 80);
    }
    return '';
  }

  /* What, if anything, gets drawn on this page. One place, so a page's buttons
     can never be the last page's and none is left behind by an SPA navigation.
     A video page is the one that can carry two. */
  const FEED_PAGES = ['/feed/channels', '/feed/subscriptions'];

  function draw(status, page){
    if (!status) return dropAdd();

    if (status.addMode){
      if (page && page.type === 'channel') return addOnChannel(page.scope);
      if (FEED_PAGES.some(p => location.pathname.startsWith(p))) return addAllHere();
    }

    /* Neither of these is part of add mode: queueing a video you are already
       allowed to be watching is an ordinary thing to want, and so is keeping
       the person who made it. */
    if (page && page.type === 'watch'){
      const queue = status.queueButton !== false && !!page.videoId;
      const add = status.addOnVideo !== false;
      if (queue || add){
        if (!mountBar('watch:' + (page.videoId || location.pathname))) return;
        if (queue) queueHere(page);
        if (add) addChannelHere();
        return;
      }
    }

    dropAdd();
  }

  function block(){
    veil();
    dropAdd();
    try { sendToBoard() }
    catch (err){
      /* A board that cannot even be addressed must not leave a veiled page.
         That is the trap this whole file is written to avoid. */
      console.warn('[HUB] could not reach the board, standing down', err);
      bypass = true;
      unveil();
    }
  }

  /* ── The decision ────────────────────────────────────────────────────────── */
  async function evaluate(){
    const mine = ++seq;
    if (gone) return;
    if (bypass){ dropAdd(); return unveil() }
    rearm(6000);

    const status = await ask({ type:'status' });
    if (mine !== seq || gone) return;

    /* No answer, guard off, paused, dismissed for this tab, or add mode — all
       the same thing here: not our page. */
    if (!status || !status.guarding){
      unveil();
      draw(status, HubScope.classify(location.href));
      return;
    }

    const first = HubScope.decide(location.href, status.grant, null);

    if (first.state === 'allow'){
      unveil();
      draw(status, first.page);
      if (first.page && first.page.type === 'channel') learnAliases();
      return;
    }
    dropAdd();

    if (first.state === 'block') return block();

    /* Pending: a watch page whose owner has not been read yet.
       v0.2.0 unveiled here and checked afterwards, which let a video of anyone
       run for a second before the guard caught up — "the overlay doesn't work"
       was partly that. The veil stays on while we find out. A video reached
       from the channel's own page never gets here: the click cleared it before
       the navigation, so it is already allowed. */
    const owner = await waitForOwner(2500);
    if (mine !== seq || gone || bypass) return;

    /* Unknowable. Left alone, on purpose — this is the fail-open. */
    if (!owner) return unveil();

    const again = HubScope.decide(location.href, status.grant, owner);
    if (again.state === 'allow'){
      if (first.page && first.page.videoId) ask({ type:'cleared', videoId:first.page.videoId });
      unveil();
      return draw(status, first.page);
    }
    block();
  }

  /* ── Pre-clearing a click ────────────────────────────────────────────────────
     A video clicked from the channel's own page is that channel's video, and
     saying so before the navigation happens is what keeps it instant.

     Only from a channel page. On a watch page the sidebar is full of other
     people's videos, and clearing whatever was clicked there would quietly
     unlock exactly what this is meant to keep out — which is the other half of
     "every video click that didn't come from a channel page". */
  addEventListener('click', e => {
    if (isVeiled() || bypass || gone) return;
    if (HubScope.classify(location.href).type !== 'channel') return;
    const a = e.target && e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    const page = HubScope.classify(a.href || a.getAttribute('href'));
    if (page.type === 'watch' && page.videoId) ask({ type:'cleared', videoId:page.videoId });
  }, true);

  /* Esc three times inside two seconds. The board carries the buttons now, so
     this is the hatch for a page that is somehow still veiled without one. */
  let escs = [];
  addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const now = Date.now();
    escs = escs.filter(t => now - t < 2000).concat(now);
    if (escs.length >= 3){ escs = []; bypass = true; ask({ type:'bypass' }); unveil() }
  }, true);

  /* ── Following YouTube ───────────────────────────────────────────────────────
     It is one document for a whole session, so there is no second
     document_start to hang anything on. The poll is the reliable one; the
     events just make it feel instant. */
  function onNav(){
    if (location.href === lastUrl || gone) return;
    lastUrl = location.href;
    veil();                                   /* cover it again while we re-decide */
    evaluate();
  }
  setInterval(onNav, 400);
  addEventListener('popstate', onNav);
  ['yt-navigate-start', 'yt-navigate-finish'].forEach(e => addEventListener(e, onNav, true));

  evaluate();
})();
