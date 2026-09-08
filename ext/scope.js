/* ── Scope ────────────────────────────────────────────────────────────────────
   Which YouTube URLs count as "inside the channel I picked".

   This file is deliberately pure: no chrome APIs, no DOM, no state. The service
   worker importScripts() it, the content script lists it first, and the test
   harness reads it off disk and evaluates it. One copy of the rules, three
   readers, and the rules are the part that has to be right — everything else in
   the extension is plumbing around this decision.
*/
const HubScope = (() => {

  const HOSTS = /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/i;

  /* YouTube spells one channel four ways, and which one you get depends on
     where the link came from. They are kept apart rather than normalised
     because there is no way to convert between them without asking YouTube —
     so instead a grant collects whichever forms it meets. */
  function fromPath(pathname){
    const seg = String(pathname || '').split('/').filter(Boolean);
    if (!seg.length) return null;
    const first = decodeURIComponent(seg[0]);
    if (first.startsWith('@') && first.length > 1) return { kind:'handle', key:first.toLowerCase() };
    if (first === 'channel' && seg[1]) return { kind:'id',   key:decodeURIComponent(seg[1]) };
    if ((first === 'c' || first === 'user') && seg[1])
      return { kind:'name', key:decodeURIComponent(seg[1]).toLowerCase() };
    return null;
  }

  function parse(url){
    let u; try { u = new URL(url, 'https://www.youtube.com') } catch { return null }
    return fromPath(u.pathname);
  }

  const isYouTube = url => {
    let u; try { u = new URL(url) } catch { return false }
    return HOSTS.test(u.hostname);
  };

  /* ── What kind of page is this ─────────────────────────────────────────── */
  function classify(url){
    let u; try { u = new URL(url, 'https://www.youtube.com') } catch { return { type:'other' } }
    const seg = u.pathname.split('/').filter(Boolean);

    if (u.hostname.toLowerCase() === 'youtu.be' && seg[0])
      return { type:'watch', videoId:seg[0] };

    const scope = fromPath(u.pathname);
    if (scope) return { type:'channel', scope };

    if (seg[0] === 'watch')  return { type:'watch',  videoId:u.searchParams.get('v') || null };
    if (seg[0] === 'shorts') return { type:'watch',  videoId:seg[1] ? decodeURIComponent(seg[1]) : null };
    if (seg[0] === 'live')   return { type:'watch',  videoId:seg[1] ? decodeURIComponent(seg[1]) : null };
    if (seg[0] === 'playlist') return { type:'owned', videoId:null };
    if (seg[0] === 'embed') return { type:'watch', videoId:seg[1] ? decodeURIComponent(seg[1]) : null };

    return { type:'other' };
  }

  /* ── Grants ──────────────────────────────────────────────────────────────
     A grant is one channel, held as every alias of it we have met so far, plus
     the videos already cleared. Plain arrays because it lives in
     chrome.storage.session and has to survive being JSON. */
  const emptyGrant = () => ({ handles:[], ids:[], names:[], videos:[] });

  const BUCKET = { handle:'handles', id:'ids', name:'names' };

  function withAlias(grant, scope){
    if (!grant || !scope) return grant;
    const b = BUCKET[scope.kind];
    if (!b || grant[b].includes(scope.key)) return grant;
    return { ...grant, [b]: grant[b].concat(scope.key) };
  }

  function withVideo(grant, videoId){
    if (!grant || !videoId || grant.videos.includes(videoId)) return grant;
    /* Bounded: a long session on one channel should not grow a grant without
       end. The oldest clearances are the ones least likely to be revisited. */
    const videos = grant.videos.concat(videoId).slice(-200);
    return { ...grant, videos };
  }

  const holds = (grant, scope) =>
    !!grant && !!scope && !!BUCKET[scope.kind] && grant[BUCKET[scope.kind]].includes(scope.key);

  const knowsVideo = (grant, videoId) => !!grant && !!videoId && grant.videos.includes(videoId);

  /* ── The decision ────────────────────────────────────────────────────────
     Three answers, not two. "pending" is the one that makes this seamless: a
     watch page cannot say whose video it is until the page has said so, and
     blurring first and asking afterwards would flash the overlay over every
     video of the channel you are allowed to be on.

     `owner` is what the content script read out of the page, once it could.
     While it is unknown the answer is pending, and the caller waits. */
  function decide(url, grant, owner){
    if (!isYouTube(url)) return { state:'allow', why:'not youtube' };

    const page = classify(url);
    if (!grant) return { state:'block', why:'no channel picked', page };

    if (page.type === 'channel')
      return holds(grant, page.scope)
        ? { state:'allow', why:'the channel itself', page }
        : { state:'block', why:'a different channel', page };

    if (page.type === 'watch' || page.type === 'owned'){
      if (knowsVideo(grant, page.videoId)) return { state:'allow', why:'already cleared', page };
      if (!owner) return { state:'pending', why:'owner not read yet', page };
      return holds(grant, owner)
        ? { state:'allow', why:'a video of the channel', page }
        : { state:'block', why:'a video of another channel', page };
    }

    return { state:'block', why:'not a channel page', page };
  }

  /* Where "open this channel" should land. Handles get the handle URL, ids get
     /channel/, and the legacy two get theirs — the same shape the link in the
     hub board had, so nothing is invented on the way through. */
  function channelUrl(scope){
    if (!scope) return 'https://www.youtube.com/';
    const base = 'https://www.youtube.com';
    if (scope.kind === 'handle') return base + '/' + scope.key;
    if (scope.kind === 'id')     return base + '/channel/' + scope.key;
    return base + '/c/' + scope.key;
  }

  /* ── A channel's own tabs ──────────────────────────────────────────────────
     The same channel, pointed at one of its tabs. A channel's home page is a
     trailer and three shelves; its videos tab is what you came for, so that is
     where "open this channel" lands by default.

     The root of the URL is kept exactly as it was written rather than rebuilt
     from the scope — a handle URL stays a handle URL, an id URL stays an id URL,
     and whatever host and search the board had is still there. A URL that names
     no channel is handed back untouched, and so is one already on the tab
     asked for: the tab replaces whatever subpage was there, it does not stack
     on top of it.

     Every one of these is inside the channel by `fromPath`, which reads the
     first segment only — so the guard lets a videos tab through on the same
     grant as the channel itself, with nothing to teach it. */
  const TABS = ['videos', 'streams', 'shorts', 'playlists', 'podcasts'];

  function onTab(url, tab){
    if (!tab || tab === 'home' || !TABS.includes(tab)) return url;
    let u; try { u = new URL(url, 'https://www.youtube.com') } catch { return url }
    const seg = u.pathname.split('/').filter(Boolean);
    if (!fromPath(u.pathname)) return url;
    /* A handle is one segment; /channel/, /c/ and /user/ are two. */
    const root = seg[0].startsWith('@') ? seg.slice(0, 1) : seg.slice(0, 2);
    u.pathname = '/' + root.concat(tab).join('/');
    return u.toString();
  }

  return { HOSTS, TABS, isYouTube, fromPath, parse, classify,
           emptyGrant, withAlias, withVideo, holds, knowsVideo, decide,
           channelUrl, onTab };
})();

/* Content scripts in one world, and importScripts in the worker, already share
   the global lexical scope this `const` lives in — guard.js and background.js
   see it without help. Publishing it on globalThis as well costs nothing and is
   how anything that is not in that scope, the test harness included, reaches it. */
if (typeof globalThis !== 'undefined') globalThis.HubScope = HubScope;
if (typeof module !== 'undefined' && module.exports) module.exports = HubScope;
