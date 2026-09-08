/* ── Reading YouTube ──────────────────────────────────────────────────────────
   Two parsers and the two URLs they belong to. Pure, like scope.js and model.js
   — string in, object out — because this is the part most likely to break: it
   is the only code in HUB that depends on what YouTube's own pages look like,
   and the only way to keep that honest is to be able to test it off a saved
   page rather than off the live site.

   Everything here fails to `null` rather than throwing or guessing. A channel
   whose id cannot be read simply has no id yet, and is asked again later.
*/
const HubYT = (() => {

  /* The per-channel feed. No key, no quota, no API console — it has been on
     this URL for as long as YouTube has had channels. It carries the last
     fifteen uploads, which is far more than "is there anything new". */
  const feedUrl = ytId => 'https://www.youtube.com/feeds/videos.xml?channel_id=' + encodeURIComponent(ytId);

  /* ── The channel page ──────────────────────────────────────────────────────
     Wanted: the UC id (the feed needs it, and a handle cannot be converted to
     one without asking), the avatar, and the real name.

     Several spellings are tried for each, because YouTube ships more than one
     and which you get depends on the day. The canonical link and the og: metas
     are the oldest and least likely to move; the ytInitialData shapes are the
     fallback when the head has been trimmed. */
  function parseChannelPage(html){
    const s = String(html || '');
    if (!s) return null;

    const first = (...res) => {
      for (const re of res){
        const m = re.exec(s);
        if (m && m[1]) return m[1];
      }
      return null;
    };

    const ytId = first(
      /<link[^>]+rel="canonical"[^>]+href="https?:\/\/(?:www\.)?youtube\.com\/channel\/(UC[\w-]{20,})"/i,
      /<meta[^>]+itemprop="(?:identifier|channelId)"[^>]+content="(UC[\w-]{20,})"/i,
      /"channelId"\s*:\s*"(UC[\w-]{20,})"/,
      /"externalId"\s*:\s*"(UC[\w-]{20,})"/,
    );

    const avatar = first(
      /<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i,
      /<link[^>]+rel="image_src"[^>]+href="([^"]+)"/i,
      /"avatar"\s*:\s*\{\s*"thumbnails"\s*:\s*\[\s*\{\s*"url"\s*:\s*"([^"]+)"/,
    );

    const name = first(
      /<meta[^>]+property="og:title"[^>]+content="([^"]*)"/i,
      /<meta[^>]+itemprop="name"[^>]+content="([^"]*)"/i,
    );

    const handle = first(
      /<link[^>]+rel="canonical"[^>]+href="https?:\/\/(?:www\.)?youtube\.com\/(@[^"/?]+)"/i,
    );

    /* Null means "this page told us nothing", and a canonical handle is not
       nothing — it is how a page that has been trimmed down still identifies
       itself. Only when every one of the four is missing is there no answer. */
    if (!ytId && !avatar && !name && !handle) return null;
    return {
      ytId,
      avatar: avatar ? unescapeUrl(avatar) : null,
      name: name ? decodeEntities(name).trim() || null : null,
      handle: handle ? handle.toLowerCase() : null,
    };
  }

  /* JSON-escaped slashes and unicode escapes turn up in the ytInitialData
     spellings, and an avatar url with a literal \u003d in it is not a url. */
  const ESCAPED = [
    [/\\u002F/gi, '/'], [/\\\//g, '/'],
    [/\\u003d/gi, '='], [/\\u0026/gi, '&'],
    [/&amp;/g, '&'],
  ];
  function unescapeUrl(u){
    let s = String(u);
    for (const [re, to] of ESCAPED) s = s.replace(re, to);
    return s.trim();
  }

  const ENTITIES = { amp:'&', lt:'<', gt:'>', quot:'"', apos:"'", '#39':"'", nbsp:' ' };
  function decodeEntities(t){
    return String(t).replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
      const k = e.toLowerCase();
      if (ENTITIES[k] !== undefined) return ENTITIES[k];
      if (k[0] === '#'){
        const n = k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
        return Number.isFinite(n) ? String.fromCodePoint(n) : m;
      }
      return m;
    });
  }

  /* ── The feed ──────────────────────────────────────────────────────────────
     Regex rather than DOMParser: this runs in the service worker, which has no
     DOM at all. The shape is fixed and small, so it is the right amount of
     parser for the job. Entries come back newest first, which is the order the
     feed is in, but they are sorted anyway rather than trusted. */
  function parseFeed(xml){
    const s = String(xml || '');
    const out = [];
    const entry = /<entry>([\s\S]*?)<\/entry>/g;
    let m;
    while ((m = entry.exec(s))){
      const e = m[1];
      const id = /<yt:videoId>([^<]+)<\/yt:videoId>/.exec(e);
      if (!id) continue;
      const title = /<title>([\s\S]*?)<\/title>/.exec(e);
      const pub = /<published>([^<]+)<\/published>/.exec(e);
      const at = pub ? Date.parse(pub[1]) : NaN;
      out.push({
        videoId: id[1],
        title: title ? decodeEntities(title[1]).trim() : '',
        at: Number.isFinite(at) ? at : 0,
      });
    }
    out.sort((a, b) => b.at - a.at);
    return out;
  }

  return { feedUrl, parseChannelPage, parseFeed, decodeEntities, unescapeUrl };
})();

if (typeof globalThis !== 'undefined') globalThis.HubYT = HubYT;
if (typeof module !== 'undefined' && module.exports) module.exports = HubYT;
