/* ── Enrich ───────────────────────────────────────────────────────────────────
   What the board can learn about a channel by asking YouTube: its UC id, its
   avatar, and whether it has posted since you last opened it.

   This runs on the board page, not in the worker. An extension page holds the
   same host permissions, so it can fetch youtube.com directly — one less hop,
   and the store is right here. Off disk none of it runs: a file:// page cannot
   fetch youtube.com and never will, so the board simply has no avatars there.
   That is a real difference between the two, and it is the honest one to make:
   the extension is where this app lives now.

   Everything is best-effort. A channel that cannot be looked up keeps whatever
   it had and is asked again next time — nothing here is allowed to be the
   reason the board does not render.
*/
const HubEnrich = (() => {

  const can = () => {
    try { return !!(typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) }
    catch { return false }
  };

  let running = false;
  const listeners = new Set();
  const say = msg => listeners.forEach(fn => { try { fn(msg) } catch {} });

  async function get(url){
    try {
      const res = await fetch(url, { credentials:'omit', cache:'no-cache' });
      if (!res.ok) return null;
      return await res.text();
    } catch { return null }
  }

  /* The channel's own page, for the id and the avatar. A handle cannot be
     turned into a UC id by any amount of string work — only the page knows —
     and the feed needs the id, so this is the step everything else waits on. */
  async function lookup(ch){
    const html = await get(ch.url);
    const info = html && HubYT.parseChannelPage(html);
    if (!info) return null;
    return {
      ytId: info.ytId || '',
      avatar: info.avatar || '',
    };
  }

  /* The feed, for the newest upload. Fifteen entries come back; only the first
     is kept, because the question is "anything new", not "what have they done". */
  async function newest(ytId){
    const xml = await get(HubYT.feedUrl(ytId));
    const items = xml ? HubYT.parseFeed(xml) : [];
    return items.length ? items[0] : null;
  }

  /* ── A pass over the board ─────────────────────────────────────────────────
     `force` is the settings button: look at everything again, however recently
     it was checked. Without it, only what is missing or stale is fetched.

     Serial, with a pause between channels. This is someone's own browser
     talking to a site they are logged into; a hundred parallel requests is not
     a neighbourly way to ask, and nothing here is urgent. */
  async function pass({ force = false, ui } = {}){
    if (!can() || running) return { done:0 };
    running = true;
    let done = 0, failed = 0;

    try {
      const every = Math.max(1, (ui && ui.checkEvery) || 6) * 3600e3;
      const list = Store.channels().filter(ch =>
        force || !ch.ytId || !ch.avatar || Date.now() - (ch.checkedAt || 0) > every);

      for (let i = 0; i < list.length; i++){
        const ch = list[i];
        say({ at:i + 1, of:list.length, name:ch.name });

        const patch = { checkedAt: Date.now() };
        let ytId = ch.ytId;

        if (force || !ytId || !ch.avatar){
          const info = await lookup(ch);
          if (info){
            if (info.ytId){ patch.ytId = info.ytId; ytId = info.ytId }
            if (info.avatar) patch.avatar = info.avatar;
          } else failed++;
        }

        if (ytId && (!ui || ui.checkNew !== false)){
          const top = await newest(ytId);
          if (top) patch.latest = { videoId:top.videoId, title:top.title, at:top.at };
        }

        Store.enrich(ch.id, patch);
        done++;
        if (i < list.length - 1) await new Promise(r => setTimeout(r, 350));
      }
    } finally {
      running = false;
      say(null);
    }
    return { done, failed };
  }

  return {
    can, pass,
    busy: () => running,
    onProgress(fn){ listeners.add(fn); return () => listeners.delete(fn) },
  };
})();
