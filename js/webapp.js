/* ── The web app ──────────────────────────────────────────────────────────────
   The fourth way HUB is opened. It was already a page off disk, an extension
   page, and the page a blocked YouTube tab lands on; served over https it is
   also an installable app with its own window and no network needed.

   This file is the whole of it, on the page's side: register the worker, notice
   whether the browser is offering to install, and remember whether it did. The
   board does not know any of this is happening, and that is the point — every
   answer here is "no" off disk and inside the extension, and the app is then
   exactly what it was.

   Like bridge.js, it declines rather than throwing. A browser with no service
   workers, a page on file://, a registration the user has blocked: each ends
   with `HubApp.can` false and nothing else different.
*/
const HubApp = (() => {

  /* Not inside the extension. An extension page has its own service worker —
     the guard's — its own origin and its own update rules, and a second one on
     top is a way to break the guard for nothing. Not off disk either: file://
     has no origin a worker can be scoped to. */
  const inExt = (() => {
    try { return !!(typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) }
    catch { return false }
  })();

  const served = location.protocol === 'https:' || location.protocol === 'http:';
  const can = served && !inExt && 'serviceWorker' in navigator;

  /* Chrome fires this instead of showing its own install button, and hands you
     the prompt to fire yourself. Held so settings can offer it; if it never
     arrives there is simply nothing to offer, which is the case in every
     browser that installs by its own menu instead. */
  let prompt = null;
  const listeners = new Set();
  const announce = () => listeners.forEach(fn => { try { fn() } catch {} });

  const standalone = () => {
    try {
      return matchMedia('(display-mode: standalone)').matches ||
             matchMedia('(display-mode: minimal-ui)').matches ||
             navigator.standalone === true;
    } catch { return false }
  };

  if (can){
    addEventListener('beforeinstallprompt', e => {
      e.preventDefault();               /* ours to fire, from settings */
      prompt = e;
      announce();
    });
    addEventListener('appinstalled', () => { prompt = null; announce() });

    /* After load, so registering never competes with the board's first paint.
       A failure is not reported anywhere: the app works without it. */
    addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js', { scope: './' })
        .then(() => announce())
        .catch(() => {});
    });
  }

  /* Fired from a button, and only from a button — a browser will refuse a
     prompt that did not come from a gesture, and it can only be used once. */
  async function install(){
    if (!prompt) return null;
    const p = prompt;
    prompt = null;
    announce();
    try { await p.prompt(); const { outcome } = await p.userChoice; return outcome }
    catch { return null }
  }

  return {
    can, inExt,
    installable: () => !!prompt,
    installed: standalone,
    install,
    onChange(fn){ listeners.add(fn); return () => listeners.delete(fn) },

    /* Whether a worker is actually running this page, for the line in settings
       that says so. */
    ready(){
      if (!can) return Promise.resolve(false);
      try { return navigator.serviceWorker.getRegistration().then(r => !!(r && r.active)) }
      catch { return Promise.resolve(false) }
    },
  };
})();
