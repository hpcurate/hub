/* ── Reading Instagram ────────────────────────────────────────────────────────
   The Instagram half of HUB, in one pure file: which urls are an account, which
   are a post, and how to read the two pages once they are open.

   Pure like scope.js, yt.js and model.js, and for a sharper reason than any of
   them. Instagram gives HUB nothing to ask: there is no per-account feed, and a
   logged-out fetch of a profile is answered with a login wall. So the only
   honest way to learn anything is to open the page in a tab, in the session
   that is already signed in, and read the document — which means the readers
   here take a `document` rather than a string of html, and can therefore be
   tested against a saved page in jsdom exactly like `HubYT.parseChannelPage`
   is tested against saved markup.

   Everything fails to null rather than throwing or guessing. Instagram's markup
   is class-name soup that changes without notice, so nothing here reads a class
   name: it reads og: metas, canonical links, `<time datetime>` and hrefs, which
   are the parts of the page that mean something to anyone other than Instagram
   and so are the parts least likely to move.
*/
const HubIG = (() => {

  const HOSTS = /(^|\.)(instagram\.com|instagr\.am)$/i;

  /* Everything on instagram.com that looks like /<word> but is not somebody's
     account. Getting this wrong in the generous direction is what would put
     "explore" on the board as an account, so the list is deliberately long. */
  const RESERVED = new Set([
    'p','reel','reels','tv','stories','s','explore','direct','accounts','about',
    'developer','legal','api','graphql','ajax','challenge','emails','session',
    'web','oauth','privacy','terms','press','blog','help','support','directory',
    'topics','locations','create','your_activity','archive','saved','settings',
    'lite','download','nametag','qr','igtv','ads','business','creators','shop',
  ]);

  const isInstagram = url => {
    let u; try { u = new URL(url) } catch { return false }
    return HOSTS.test(u.hostname);
  };

  /* An Instagram username: letters, digits, dots and underscores, up to thirty.
     One spelling, unlike YouTube's four — which is why there is no alias set
     here and no grant to collect them in. */
  const USER = /^[A-Za-z0-9._]{1,30}$/;

  function fromPath(pathname){
    const seg = String(pathname || '').split('/').filter(Boolean);
    if (!seg.length) return null;
    const first = decodeURIComponent(seg[0]);
    if (RESERVED.has(first.toLowerCase())) return null;
    if (!USER.test(first)) return null;
    return { kind:'user', key:first.toLowerCase() };
  }

  function parse(url){
    let u; try { u = new URL(url, 'https://www.instagram.com') } catch { return null }
    return fromPath(u.pathname);
  }

  /* What kind of page this is. The board only needs three answers — an account,
     one post, or something else — because there is no guard on this half and so
     nothing has to decide whether a page is "inside" anything. */
  function classify(url){
    let u; try { u = new URL(url, 'https://www.instagram.com') } catch { return { type:'other' } }
    const seg = u.pathname.split('/').filter(Boolean);
    const first = (seg[0] || '').toLowerCase();

    if ((first === 'p' || first === 'reel' || first === 'tv') && seg[1])
      return { type:'post', shortcode: decodeURIComponent(seg[1]) };
    if (first === 'stories' && seg[1]) return { type:'story', scope:{ kind:'user', key:decodeURIComponent(seg[1]).toLowerCase() } };

    const scope = fromPath(u.pathname);
    if (scope) return { type:'profile', scope };

    if (!seg.length) return { type:'feed' };
    if (first === 'explore' || first === 'reels') return { type:'feed' };
    return { type:'other' };
  }

  const profileUrl = user => 'https://www.instagram.com/' + encodeURIComponent(String(user || '').replace(/^@+/, '')) + '/';
  const postUrl = code => 'https://www.instagram.com/p/' + encodeURIComponent(String(code || '')) + '/';

  /* Which of an account's own tabs a card lands on. `posts` is the profile
     itself, so it is the url unchanged — Instagram has no equivalent of
     YouTube's home page being a trailer you have to click past. */
  const TABS = { posts:'', reels:'reels/', tagged:'tagged/' };
  function onTab(url, tab){
    const scope = parse(url);
    if (!scope) return url;
    const suffix = TABS[tab] || '';
    return profileUrl(scope.key) + suffix;
  }

  /* ── Reading a profile page ────────────────────────────────────────────────
     Wanted: the picture, the real name, and enough of the grid to answer "is
     there anything here I have not seen".

     Not a timestamp. The grid does not carry one, and the shortcodes are better
     than a timestamp would be anyway: they are stable ids, so "new" is a
     shortcode this account has never shown before rather than a clock
     comparison. That also disposes of pinned posts for free — a pinned post
     sits at the front forever and its shortcode is always already known, so it
     never reads as new twice. */
  const TOP = 6;

  function meta(doc, prop){
    const el = doc.querySelector('meta[property="' + prop + '"], meta[name="' + prop + '"]');
    const v = el && el.getAttribute('content');
    return v ? String(v).trim() : '';
  }

  function readProfile(doc){
    if (!doc || typeof doc.querySelector !== 'function') return null;

    /* "Name (@handle) • Instagram photos and videos" is the shape og:title has
       had for years. The handle in the parentheses is the reliable half; the
       name in front of it is what a person would call the account. */
    const title = meta(doc, 'og:title');
    const m = /^(.*?)\s*\(@([A-Za-z0-9._]{1,30})\)/.exec(title);

    let handle = m ? m[2].toLowerCase() : '';
    let name = m ? m[1].trim() : '';

    if (!handle){
      const canon = doc.querySelector('link[rel="canonical"]');
      const scope = canon && parse(canon.getAttribute('href') || '');
      if (scope) handle = scope.key;
    }
    if (!handle) return null;          /* not a profile, or a login wall */

    /* og:image on a profile is the profile picture. The header <img> is the
       same picture and is there when the metas have been trimmed. */
    let avatar = meta(doc, 'og:image');
    if (!avatar){
      const img = doc.querySelector('header img[src], img[alt*="profile picture" i][src]');
      avatar = img ? img.getAttribute('src') || '' : '';
    }

    /* The grid, in document order. Deduplicated, because a post that is both
       pinned and recent is linked twice on the page and would otherwise take
       two of the six places. */
    const seen = new Set();
    const posts = [];
    for (const a of doc.querySelectorAll('a[href*="/p/"], a[href*="/reel/"], a[href*="/tv/"]')){
      const info = classify(a.getAttribute('href') || '');
      if (info.type !== 'post' || seen.has(info.shortcode)) continue;
      seen.add(info.shortcode);
      posts.push(info.shortcode);
      if (posts.length >= TOP) break;
    }

    return { handle, name: name || '@' + handle, avatar, posts };
  }

  /* ── Reading one post ──────────────────────────────────────────────────────
     Only ever asked for when a shortcode has turned up that this account has
     not shown before, which is why it is affordable: a board of forty accounts
     with two new posts between them is forty-two page loads, not eighty.

     `<time datetime>` is the real posted-at, which is the whole reason for the
     second load — with it, every part of HUB that was built around "posted in
     the last 24 hours" works on this board exactly as it does on the other. */
  function readPost(doc){
    if (!doc || typeof doc.querySelector !== 'function') return null;

    const t = doc.querySelector('time[datetime]');
    const raw = t && t.getAttribute('datetime');
    const at = raw ? Date.parse(raw) : NaN;

    const canon = doc.querySelector('link[rel="canonical"]');
    const info = canon ? classify(canon.getAttribute('href') || '') : { type:'other' };

    /* og:description carries the caption wrapped in counts and a date:
         "1,234 likes, 56 comments - someone on January 1, 2024: "the caption""
       The caption is what a person would read, so it is dug out when it is
       there and the whole string is used when it is not. */
    const desc = meta(doc, 'og:description');
    const cap = /:\s*[""](.*)[""]\s*$/s.exec(desc);
    const title = (cap ? cap[1] : desc).trim().slice(0, 200);

    return {
      shortcode: info.type === 'post' ? info.shortcode : '',
      at: Number.isFinite(at) ? at : 0,
      title,
      thumb: meta(doc, 'og:image'),
    };
  }

  return { HOSTS, RESERVED, isInstagram, parse, classify, profileUrl, postUrl,
           onTab, TABS, readProfile, readPost, TOP };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = HubIG;
