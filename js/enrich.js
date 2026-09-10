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
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch(url, { credentials:'omit', cache:'no-cache', signal:controller.signal });
      if (!res.ok) return null;
      return await res.text();
    } catch { return null }
    finally { clearTimeout(timeout) }
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
    if (xml === null) return undefined; // failed request; an empty feed is still a success
    const items = xml ? HubYT.parseFeed(xml) : [];
    return items.length ? items[0] : null;
  }

  /* ── Instagram ─────────────────────────────────────────────────────────────
     The same job with none of the same tools. There is no feed to poll and no
     page that answers a logged-out fetch, so an account is looked at by opening
     it in a background tab and reading the document — which the worker does,
     because only the worker can open a tab and still be listening when the
     content script inside it reports.

     Two loads at most per account, and the second only when it has earned it:
     the profile for the picture and the top of the grid, and then, if a
     shortcode has appeared that this account has never shown before, that one
     post for its real `<time datetime>`. That timestamp is the point of the
     second load — with it, `latest` on this board means exactly what it means
     on the other, and the fresh card, the new chip, the newest-first sort and
     the latest-post box all work without knowing which site they are looking
     at. */
  const probe = (url, ms = 25000) =>
    HubBridge.askFor({ type:'igProbe', url, timeout:ms }, ms + 4000);

  async function instagram(ch, job){
    const patch = {};
    const facts = await probe(HubIG.profileUrl(HubIG.parse(ch.url)?.key || ''));

    /* A login wall, a timeout, or a tab that would not open. The account keeps
       everything it had and is asked again next time — the one thing that must
       not happen is a signed-out moment quietly emptying the board. */
    if (!facts || facts.kind !== 'profile' || !facts.profile) return { patch, failed:true };

    const p = facts.profile;
    if (p.avatar) patch.avatar = p.avatar;
    if (p.handle) patch.handle = p.handle;
    patch.pageAt = Date.now();
    patch.checkedAt = Date.now();
    patch.igPosts = p.posts.slice();

    if (!job.needFeed || !p.posts.length) return { patch, failed:false };

    /* What is new here. On an account HUB has never looked at there is no
       "new" to speak of, so the newest post is taken simply to give the card
       something to show; after that it is strictly the codes that were not
       here before, in the order the grid lists them — which puts a pinned post
       out of the running without having to detect that it is pinned. */
    const known = new Set(ch.igPosts || []);
    const fresh = p.posts.filter(code => !known.has(code));
    const pick = known.size ? fresh[0] : p.posts[0];
    if (!pick || (ch.latest && ch.latest.videoId === pick)) return { patch, failed:false };

    const post = await probe(HubIG.postUrl(pick));
    if (!post || post.kind !== 'post' || !post.post || !post.post.at)
      /* The grid was read and the post was not. Recording the codes anyway
         would make this post permanently un-new, so they are dropped and the
         whole thing is tried again next time. */
      return { patch:{ ...patch, igPosts:ch.igPosts || [] }, failed:true };

    patch.latest = { videoId:pick, at:post.post.at, title:post.post.title || '', thumb:post.post.thumb || '' };
    return { patch, failed:false };
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
  async function pass({ force = false, ui, platform = 'youtube' } = {}){
    if (!can() || running) return { done:0, failed:0 };
    running = true;
    let done = 0, failed = 0;
    const isIG = platform === 'instagram';

    try {
      const feedEvery = Math.max(1, (ui && ui.checkEvery) || 6) * 3600e3;
      const pageEvery = Math.max(1, (ui && ui.pageDays) || 14) * 864e5;
      const wantNew = !ui || ui.checkNew !== false;
      const now = Date.now();

      /* What each channel actually needs, worked out once. A channel that needs
         neither is not in the list at all, which is why a second refresh a
         minute after the first costs nothing. */
      const jobs = [];
      Store.channels().filter(ch => ch.platform === platform).forEach(ch => {
        /* Instagram has one page and it carries both answers, so there is no
           second clock to keep: whichever of the two is due, the same single
           load settles them both. */
        const needPage = isIG
          ? (force || !ch.avatar || now - (ch.pageAt || 0) > pageEvery)
          : (force || !ch.ytId || !ch.avatar || now - (ch.pageAt || 0) > pageEvery);
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
        let didFail = false;
        say({ at, of:total, id:ch.id, phase:'start', name:ch.name });

        if (isIG){
          const out = await instagram(ch, job);
          Store.enrich(ch.id, out.patch);
          done++;
          if (out.failed) failed++;
          say({ at:++at, of:total, id:ch.id, phase:'done', name:ch.name, failed });
          return;
        }

        /* When the id is already known the two requests do not depend on each
           other, so they go out together. When it is not, the feed has to wait:
           only the channel's own page knows what a handle's UC id is. */
        if (job.needPage && ytId && job.needFeed){
          const [info, top] = await Promise.all([lookup(ch), newest(ytId)]);
          if (info){ if (info.ytId){ patch.ytId = info.ytId }
                     if (info.avatar) patch.avatar = info.avatar;
                     patch.pageAt = Date.now() }
          else didFail = true;
          if (top) patch.latest = { videoId:top.videoId, title:top.title, at:top.at };
          if (top === undefined) didFail = true;
          else patch.checkedAt = Date.now();
        } else {
          if (job.needPage){
            const info = await lookup(ch);
            if (info){
              if (info.ytId){ patch.ytId = info.ytId; ytId = info.ytId }
              if (info.avatar) patch.avatar = info.avatar;
              patch.pageAt = Date.now();
            } else didFail = true;
          }
          if (job.needFeed && ytId){
            const top = await newest(ytId);
            if (top) patch.latest = { videoId:top.videoId, title:top.title, at:top.at };
            if (top === undefined) didFail = true;
            else patch.checkedAt = Date.now();
          }
        }

        Store.enrich(ch.id, patch);
        done++;
        if (didFail) failed++;
        say({ at:++at, of:total, id:ch.id, phase:'done', name:ch.name, failed });
      }

      /* A fixed number of lanes, each pulling the next job off the pile as it
         finishes its own. No batching: one slow channel holds up its own lane
         and nothing else. */
      /* Two lanes on Instagram, not five. A lane there is a whole page load in
         a real tab rather than a few kilobytes of XML, and the difference
         between two at a time and five at a time is the difference between
         something that reads as browsing and something that reads as a script.
         It is a dial of its own for the same reason. */
      const lanes = isIG
        ? Math.max(1, Math.min(4, (ui && ui.igLanes) || 2))
        : Math.max(1, Math.min(8, (ui && ui.lanes) || 5));
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
