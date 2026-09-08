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

     Two things make this quick rather than patient.

     **Two clocks, not one.** A channel page is a megabyte of markup and holds
     one thing that ever changes — the avatar, which changes about never. The
     feed is a few kilobytes and holds the only thing worth polling. So they are
     asked about on their own schedules: the feed every `checkEvery` hours, the
     page only when the id or the avatar is missing, or once a fortnight. A
     refresh over a settled board is now forty small XML files instead of forty
     megabytes of HTML.

     **Lanes.** It used to be one channel at a time with a third of a second of
     sleep between them, which on forty channels is most of a minute of doing
     nothing at all. It is now a small pool — five by default — with no sleep,
     because five requests to a site you are already logged into is a page load,
     not a hammering. The pool is the whole speed-up; the two clocks are what
     stops it having to work.

     Nothing here is allowed to be the reason the board does not render: a
     channel that will not answer keeps what it had and is asked again next
     time. */
  async function pass({ force = false, ui } = {}){
    if (!can() || running) return { done:0, failed:0 };
    running = true;
    let done = 0, failed = 0;

    try {
      const feedEvery = Math.max(1, (ui && ui.checkEvery) || 6) * 3600e3;
      const pageEvery = Math.max(1, (ui && ui.pageDays) || 14) * 864e5;
      const wantNew = !ui || ui.checkNew !== false;
      const now = Date.now();

      /* What each channel actually needs, worked out once. A channel that needs
         neither is not in the list at all, which is why a second refresh a
         minute after the first costs nothing. */
      const jobs = [];
      Store.channels().forEach(ch => {
        const needPage = force || !ch.ytId || !ch.avatar
                       || now - (ch.pageAt || 0) > pageEvery;
        const needFeed = wantNew && (force || !ch.latest
                       || now - (ch.checkedAt || 0) > feedEvery);
        if (needPage || needFeed) jobs.push({ ch, needPage, needFeed });
      });

      const total = jobs.length;
      if (!total) return { done:0, failed:0 };

      let next = 0, at = 0;

      async function one(job){
        const { ch } = job;
        const patch = {};
        let ytId = ch.ytId;

        /* When the id is already known the two requests do not depend on each
           other, so they go out together. When it is not, the feed has to wait:
           only the channel's own page knows what a handle's UC id is. */
        if (job.needPage && ytId && job.needFeed){
          const [info, top] = await Promise.all([lookup(ch), newest(ytId)]);
          if (info){ if (info.ytId){ patch.ytId = info.ytId }
                     if (info.avatar) patch.avatar = info.avatar;
                     patch.pageAt = Date.now() }
          else failed++;
          if (top) patch.latest = { videoId:top.videoId, title:top.title, at:top.at };
          patch.checkedAt = Date.now();
        } else {
          if (job.needPage){
            const info = await lookup(ch);
            if (info){
              if (info.ytId){ patch.ytId = info.ytId; ytId = info.ytId }
              if (info.avatar) patch.avatar = info.avatar;
              patch.pageAt = Date.now();
            } else failed++;
          }
          if (job.needFeed && ytId){
            const top = await newest(ytId);
            if (top) patch.latest = { videoId:top.videoId, title:top.title, at:top.at };
            patch.checkedAt = Date.now();
          }
        }

        Store.enrich(ch.id, patch);
        done++;
        say({ at:++at, of:total, name:ch.name });
      }

      /* A fixed number of lanes, each pulling the next job off the pile as it
         finishes its own. No batching: one slow channel holds up its own lane
         and nothing else. */
      const lanes = Math.max(1, Math.min(8, (ui && ui.lanes) || 5));
      say({ at:0, of:total, name:'' });
      await Promise.all(Array.from({ length:Math.min(lanes, total) }, async () => {
        while (next < total) await one(jobs[next++]);
      }));
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
