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
  let addBtn = null;
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
    if (!addBtn) return;
    addBtn.remove(); addBtn = null;
  }

  function mountAdd(scope){
    if (addBtn) return;
    let cssUrl, root;
    try { cssUrl = chrome.runtime.getURL('ext/add.css') } catch { return }

    addBtn = document.createElement('div');
    addBtn.id = ADD_ID;
    root = addBtn.attachShadow({ mode:'open' });

    const css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = cssUrl;

    const b = document.createElement('button');
    b.className = 'btn';
    b.innerHTML = '+ add to hub<small>add mode</small>';

    b.addEventListener('click', async () => {
      if (b.classList.contains('done') || b.classList.contains('have')) return;
      const res = await ask({ type:'addChannel',
                              url: HubScope.channelUrl(scope),
                              name: channelTitle() });
      if (!res) return;
      b.classList.add(res.already ? 'have' : 'done');
      b.innerHTML = (res.already ? 'already on the board' : 'added')
                  + '<small>' + (res.already ? '' : 'add mode') + '</small>';
    });

    root.append(css, b);
    html.appendChild(addBtn);
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
      /* Add mode is the one "not guarding" that still draws something. */
      const page = HubScope.classify(location.href);
      if (status && status.addMode && page.type === 'channel') mountAdd(page.scope);
      else dropAdd();
      return;
    }
    dropAdd();

    const first = HubScope.decide(location.href, status.grant, null);

    if (first.state === 'allow'){
      unveil();
      if (first.page && first.page.type === 'channel') learnAliases();
      return;
    }

    if (first.state === 'block') return sendToBoard();

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
      return unveil();
    }
    sendToBoard();
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
