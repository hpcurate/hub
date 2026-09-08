/* ── Guard ────────────────────────────────────────────────────────────────────
   Runs on every YouTube page at document_start. Decides, out of HubScope, and
   then does exactly one of three things: nothing, take the veil off, or put the
   board over the page.

   The rule this file is written around: **a failure must leave YouTube alone.**
   Every path that could hang — the message to the background, the owner of a
   video, the board's own iframe — has a timeout that ends in an unveil. Being
   stuck on a blurred page with no way forward is a worse bug than a video that
   slipped through, so every uncertainty resolves the same way.
*/
(() => {
  if (window.top !== window) return;         /* embeds and ad frames are not pages */

  const html = document.documentElement;
  const ID = 'hub-guard-root';

  let overlay = null;                        /* the shadow host, when mounted */
  let board = null;                          /* the iframe inside it */
  let bypass = false;                        /* dismissed for this page load */
  let lastUrl = location.href;
  let seq = 0;                               /* cancels the work of a stale url */

  /* ── The veil ──────────────────────────────────────────────────────────
     The class on <html> is the only record of whether the veil is on. A boolean
     beside it is a second source of truth, and the two coming apart is how a
     page ends up blurred with nothing willing to take it off. */
  const isVeiled = () => html.classList.contains('hub-veil');

  function veil(){
    if (isVeiled() || bypass) return;
    html.classList.remove('hub-unveiling');
    html.classList.add('hub-veil');
    /* "Locks me into" has to include the sound. A blurred page still playing is
       the one thing that would make this feel broken. */
    try { document.querySelectorAll('video,audio').forEach(v => v.pause()) } catch {}
  }

  function unveil(){
    if (isVeiled()){
      html.classList.add('hub-unveiling');
      html.classList.remove('hub-veil');
      setTimeout(() => html.classList.remove('hub-unveiling'), 400);
    }
    dropOverlay();
  }

  /* The failsafe, armed before anything else can go wrong. Nothing in this file
     is allowed to hold the veil for longer than this without having decided to. */
  let deadman = setTimeout(unveil, 4000);
  const rearm = ms => { clearTimeout(deadman); deadman = setTimeout(unveil, ms) };

  veil();                                    /* before the first paint, then decide */

  /* ── Talking to the background ───────────────────────────────────────────────
     Never rejects and never hangs: a dead worker answers `null`, and null means
     "no guard", which means the page is left alone. */
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

  /* ── Reading who owns a video ────────────────────────────────────────────────
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

  /* Wait for it, but not for long. Whatever has not appeared in a couple of
     seconds is not going to, and the answer to not knowing is to allow. */
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

  /* ── The overlay ─────────────────────────────────────────────────────────────
     A shadow root, so YouTube's stylesheet cannot reach the board's chrome and
     ours cannot reach theirs. The escape bar is built here, outside the iframe,
     which is what makes it survive the board failing to load. */
  function mountOverlay(){
    if (overlay) return;

    overlay = document.createElement('div');
    overlay.id = ID;
    /* Open, not closed. Closed buys almost nothing here — YouTube's scripts
       could reach the host element either way — and it would put the three
       escape buttons out of reach of any test. The part that has to be provably
       reachable is the way out. */
    const root = overlay.attachShadow({ mode:'open' });

    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = chrome.runtime.getURL('ext/overlay.css');

    const wrap = document.createElement('div');
    wrap.className = 'wrap';
    wrap.innerHTML =
      '<div class="frame"><iframe title="HUB"></iframe>' +
        '<div class="dead"><h2>HUB.</h2><p>the board did not load \u2014 use the buttons below</p></div>' +
      '</div>' +
      '<div class="bar">' +
        '<span class="note">pick a channel to open this tab \u2014 or <b>esc</b> three times to dismiss</span>' +
        '<button data-act="dismiss">dismiss this tab</button>' +
        '<button data-act="snooze">pause 15 min</button>' +
        '<button data-act="off">turn guard off</button>' +
      '</div>';

    const frame = wrap.querySelector('.frame');
    const iframe = wrap.querySelector('iframe');
    /* If the board has not said hello in three seconds, say so rather than
       showing a black rectangle over a blurred page. */
    const dead = setTimeout(() => frame.classList.add('dead-on'), 3000);
    iframe.addEventListener('load', () => { clearTimeout(dead); iframe.classList.add('ready') });
    iframe.src = chrome.runtime.getURL('index.html') + '?picker=1';
    board = iframe;

    wrap.addEventListener('click', e => {
      const act = e.target && e.target.dataset && e.target.dataset.act;
      if (act) escape(act);
    });

    root.append(css, wrap);
    html.appendChild(overlay);                /* sibling of body, so it stays sharp */
  }

  function dropOverlay(){
    if (!overlay) return;
    const el = overlay; overlay = null; board = null;
    el.remove();
  }

  /* ── The ways out ────────────────────────────────────────────────────────────
     Three, and they are the whole of the fault-proofing that the user can see.
     Each one ends the block now; two of them end it beyond this page. */
  async function escape(act){
    if (act === 'snooze') await ask({ type:'snooze', minutes:15 });
    if (act === 'off')    await ask({ type:'setEnabled', on:false });
    bypass = true;                            /* 'dismiss', and the other two as well */
    unveil();
  }

  /* ── The board asking for a tab ──────────────────────────────────────────────
     The picker cannot navigate this page itself: it is an extension frame on a
     youtube.com document, and top navigation across origins is not a thing to
     rely on. So it asks, and only it can — the message is refused unless it came
     from the frame this script created, and unless it names a YouTube url.

     The grant is already recorded by the time this arrives; the picker waits for
     the background to confirm before it asks. */
  addEventListener('message', e => {
    if (!board || !e.source || e.source !== board.contentWindow) return;
    const d = e.data;
    if (!d || d.hub !== 'go' || typeof d.url !== 'string') return;
    if (!HubScope.isYouTube(d.url)) return;
    bypass = false;
    location.href = d.url;
  });

  /* Esc three times inside two seconds. The button is the one you find; this is
     the one that works when the overlay itself has not come up. */
  let escs = [];
  addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const now = Date.now();
    escs = escs.filter(t => now - t < 2000).concat(now);
    if (escs.length >= 3){ escs = []; escape('dismiss') }
  }, true);

  /* ── Pre-clearing a click ────────────────────────────────────────────────────
     A video clicked from the channel's own page is that channel's video, and
     saying so before the navigation happens is what stops the overlay flashing
     over it while its owner is read.

     Only from a channel page. On a watch page the sidebar is full of other
     people's videos, and clearing whatever was clicked there would quietly
     unlock exactly what this is meant to keep out. */
  addEventListener('click', e => {
    if (isVeiled() || bypass) return;
    if (HubScope.classify(location.href).type !== 'channel') return;
    const a = e.target && e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    const page = HubScope.classify(a.href || a.getAttribute('href'));
    if (page.type === 'watch' && page.videoId) ask({ type:'cleared', videoId:page.videoId });
  }, true);

  /* ── Learning the channel's other names ──────────────────────────────────────
     A grant made from the board holds a handle; a watch page usually offers an
     id. Both name the same channel and there is no way to convert one to the
     other without asking YouTube — so the channel's own page is asked instead,
     where the two sit side by side.

     Only ever read from things that describe *this* page. A channel page is
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

  /* ── The decision ────────────────────────────────────────────────────────── */
  async function evaluate(){
    const mine = ++seq;
    if (bypass) return unveil();
    rearm(6000);

    const status = await ask({ type:'status' });
    if (mine !== seq) return;                       /* the url moved on under us */

    /* No answer, guard off, or paused — all the same thing: not our page. */
    if (!status || !status.guarding) return unveil();

    const first = HubScope.decide(location.href, status.grant, null);

    if (first.state === 'allow'){
      unveil();
      if (first.page && first.page.type === 'channel') learnAliases();
      return;
    }

    if (first.state === 'block') return block();

    /* Pending: a watch page whose owner has not been read yet. Let it run while
       we find out. An optimistic unveil is the seamless choice *and* the safe
       one — if the answer never comes, the page is already free. */
    unveil();
    const owner = await waitForOwner(2500);
    if (mine !== seq || bypass) return;
    if (!owner) return;                             /* unknowable → left alone */

    const again = HubScope.decide(location.href, status.grant, owner);
    if (again.state === 'allow'){
      if (first.page && first.page.videoId) ask({ type:'cleared', videoId:first.page.videoId });
      return;
    }
    block();
  }

  function block(){
    veil();
    try { mountOverlay() }
    catch (err){
      /* getURL throws once the extension has been reloaded under a live page.
         A veil with no board on it is the trap this whole file is written to
         avoid, so it comes straight off. */
      console.warn('[HUB] overlay failed, standing down', err);
      bypass = true;
      unveil();
    }
  }

  /* ── Following YouTube ───────────────────────────────────────────────────────
     It is one document for a whole session, so there is no second document_start
     to hang anything on. The poll is the reliable one; the events just make it
     feel instant. */
  function onNav(){
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    evaluate();                                     /* decided again from scratch */
  }
  setInterval(onNav, 400);
  addEventListener('popstate', onNav);
  ['yt-navigate-start', 'yt-navigate-finish'].forEach(e => addEventListener(e, onNav, true));

  evaluate();
})();
