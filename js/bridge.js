/* ── Bridge ───────────────────────────────────────────────────────────────────
   The one piece of the board that knows the extension exists.

   index.html is three things: a page opened off disk, the extension's own page,
   and — since v0.3.0 — the page a blocked YouTube tab is sent to. It should
   behave differently in each, and this is the only file that cares. app.js asks
   `HubBridge.open(channel)` and carries on if the answer is no.
*/
const HubBridge = (() => {

  /* chrome.runtime.id is the honest test. `chrome` alone exists in plenty of
     places that cannot message anything. */
  const inExt = (() => {
    try { return !!(typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) }
    catch { return false }
  })();

  const params = new URLSearchParams(location.search);
  const blocked = inExt && params.has('blocked');
  const from = params.get('from') || '';

  const askFor = (msg, ms) => new Promise(resolve => {
    let done = false;
    const finish = v => { if (!done){ done = true; resolve(v) } };
    setTimeout(() => finish(null), ms);
    try {
      chrome.runtime.sendMessage(msg, res => { void chrome.runtime.lastError; finish(res || null) });
    } catch { finish(null) }
  });

  /* A second and a half is right for everything the guard does, all of which is
     a storage read away. It is far too short for the one thing that is not: a
     probe has to open a page on a site nobody controls and wait for it to
     render, so it says how long it is prepared to wait. */
  const ask = msg => askFor(msg, 1500);

  /* Opening a channel.
       off disk        — false: the anchor does what anchors do
       the board's tab — a new tab, granted before it loads
       a blocked tab   — this tab, granted, straight to the channel

     `opts.url` is where to land — the videos tab, by default, rather than the
     channel's home page. The **grant** is still read from `ch.url`, because a
     grant is a channel and not a page: every tab of it is inside the same scope,
     so where the tab lands is the board's choice and never the guard's.

     Returns true when it has taken responsibility for the navigation. */
  async function open(ch, opts){
    if (!inExt) return false;
    const scope = HubScope.parse(ch.url);
    if (!scope) return false;                 /* not a channel url — let it through */
    const to = (opts && opts.url) || ch.url;

    if (blocked){
      const ok = await ask({ type:'unlock', scope, url:to });
      /* Without the grant the guard would only send the tab straight back here.
         Doing nothing visible beats a loop. */
      if (!ok) return true;
      location.href = to;
      return true;
    }

    /* A new tab by default, because the board is a place you come back to.
       Turned off, the board's own tab goes in, which is what you want when the
       board is your home page rather than a window you keep open. */
    if (opts && opts.newTab === false){
      const ok = await ask({ type:'unlock', scope, url:to });
      if (!ok) return true;
      location.href = to;
      return true;
    }

    await ask({ type:'openInTab', scope, url:to });
    return true;
  }

  /* ── The way back ────────────────────────────────────────────────────────────
     A blocked tab has arrived at the board with no page behind it, so the ways
     out live here, on the board, in plain sight. This is the whole of "fault
     proof" now that there is no overlay: three buttons on the page you land on,
     each of which ends the block and returns you to where you were going. */
  function mountBlocked(){
    const bar = document.getElementById('blocked');
    if (!bar) return;
    bar.hidden = false;
    document.documentElement.classList.add('blocked');

    const where = document.getElementById('blocked-where');
    if (where && from){
      try {
        const u = new URL(from);
        where.textContent = (u.pathname === '/' ? u.hostname : u.hostname + u.pathname).slice(0, 64);
      } catch { where.textContent = from.slice(0, 64) }
    }

    const leave = async msg => {
      if (msg) await ask(msg);
      await ask({ type:'bypass' });          /* or the guard sends it straight back */
      location.href = from || 'https://www.youtube.com/';
    };

    bar.addEventListener('click', e => {
      const act = e.target && e.target.dataset && e.target.dataset.act;
      if (act === 'back')   leave(null);
      if (act === 'snooze') leave({ type:'snooze', minutes:15 });
      if (act === 'off')    leave({ type:'setEnabled', on:false });
    });
  }

  if (blocked){
    if (document.readyState === 'loading')
      document.addEventListener('DOMContentLoaded', mountBlocked, { once:true });
    else mountBlocked();
  }

  return {
    askFor, inExt, blocked, from, open, ask };
})();
