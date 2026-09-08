/* ── Bridge ───────────────────────────────────────────────────────────────────
   The one piece of the board that knows the extension exists.

   The same index.html is three things: a page opened off disk, the extension's
   own page, and the picker inside the overlay on a blurred YouTube tab. It
   should behave differently in each, and this is the only file that cares —
   app.js asks `HubBridge.open(channel)` and carries on if the answer is no.
*/
const HubBridge = (() => {

  /* chrome.runtime.id is the honest test. `chrome` alone exists in plenty of
     places that cannot message anything. */
  const inExt = (() => {
    try { return !!(typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) }
    catch { return false }
  })();

  const picker = new URLSearchParams(location.search).has('picker');

  const ask = msg => new Promise(resolve => {
    let done = false;
    const finish = v => { if (!done){ done = true; resolve(v) } };
    setTimeout(() => finish(null), 1500);
    try {
      chrome.runtime.sendMessage(msg, res => { void chrome.runtime.lastError; finish(res || null) });
    } catch { finish(null) }
  });

  /* Opening a channel.
       off disk      — false: the anchor does what anchors do
       extension tab — a new tab, granted before it loads
       picker        — this tab, granted, then the page navigates itself

     Returns true when it has taken responsibility for the navigation. */
  async function open(ch){
    if (!inExt) return false;
    const scope = HubScope.parse(ch.url);
    if (!scope) return false;                 /* not a channel url — let it through */

    if (picker){
      const ok = await ask({ type:'unlock', scope, url:ch.url });
      /* If the grant did not land, navigating would only bounce off the guard
         and put the board straight back up. Better to do nothing visible. */
      if (!ok) return true;
      parent.postMessage({ hub:'go', url:ch.url }, '*');
      return true;
    }

    await ask({ type:'openInTab', scope, url:ch.url });
    return true;
  }

  if (picker) document.documentElement.classList.add('picker');

  return { inExt, picker, open, ask };
})();
