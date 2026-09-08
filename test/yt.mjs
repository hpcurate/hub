// Reading YouTube's own pages.
//   cd hub/test && node yt.mjs
// ext/yt.js is the only code in HUB that depends on what YouTube's markup looks
// like, which makes it the most likely thing to break and the most worth
// testing off saved fragments rather than off the live site. Several spellings
// are checked for each fact, because YouTube ships more than one.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(HERE, '..', 'ext', 'yt.js'), 'utf8');
const Y = new Function(src + '\nreturn HubYT;')();

let pass = 0; const fails = [];
const ok = (name, cond, detail = '') => {
  if (cond){ pass++; console.log('  ok   ' + name) }
  else { fails.push(name + (detail ? ' — ' + detail : '')); console.log('  FAIL ' + name + (detail ? ' — ' + detail : '')) }
};
const ID = 'UCHnyfMqiRRG1u-2MsSQLbXA';

console.log('\nthe channel page');
{
  const head = [
    '<link rel="canonical" href="https://www.youtube.com/channel/' + ID + '">',
    '<meta property="og:image" content="https://yt3.googleusercontent.com/abc=s900">',
    '<meta property="og:title" content="Veritasium &amp; friends">',
  ].join('');
  const got = Y.parseChannelPage(head);
  ok('the id comes off the canonical link', got.ytId === ID, got.ytId);
  ok('the avatar comes off og:image', got.avatar === 'https://yt3.googleusercontent.com/abc=s900');
  ok('the name is decoded', got.name === 'Veritasium & friends', got.name);
}
{
  const got = Y.parseChannelPage('<meta itemprop="channelId" content="' + ID + '">');
  ok('itemprop channelId is read too', got.ytId === ID);
}
{
  const got = Y.parseChannelPage('window.ytInitialData = {"channelId":"' + ID + '","x":1}');
  ok('and the id inside ytInitialData', got.ytId === ID);
}
{
  const got = Y.parseChannelPage('{"externalId":"' + ID + '"}');
  ok('externalId counts as the id as well', got.ytId === ID);
}
{
  const got = Y.parseChannelPage(
    '<link rel="canonical" href="https://www.youtube.com/@Veritasium">');
  ok('a canonical handle is kept', got.handle === '@veritasium', got.handle);
  ok('and does not invent an id', got.ytId === null);
}
{
  const esc = '{"avatar":{"thumbnails":[{"url":"https://yt3.ggpht.com/a\u002Fb\u003Ds88"}]}}';
  const got = Y.parseChannelPage(esc);
  ok('a json-escaped avatar url is unescaped',
     got.avatar === 'https://yt3.ggpht.com/a/b=s88', got.avatar);
}
{
  const got = Y.parseChannelPage('<meta property="og:image" content="https://x/a?b=1&amp;c=2">');
  ok('an entity-escaped query survives', got.avatar === 'https://x/a?b=1&c=2', got.avatar);
}
ok('a page with none of it is null', Y.parseChannelPage('<html><body>hi</body></html>') === null);
ok('an empty page is null', Y.parseChannelPage('') === null);
ok('nothing at all is null', Y.parseChannelPage(null) === null);

console.log('\nthe feed');
{
  const entry = (id, title, when) =>
    '<entry><yt:videoId>' + id + '</yt:videoId><title>' + title +
    '</title><published>' + when + '</published></entry>';
  const xml = '<feed>' +
    entry('old1', 'An older one', '2026-08-01T10:00:00+00:00') +
    entry('new1', 'Bread &amp; butter', '2026-09-01T10:00:00+00:00') +
    '</feed>';
  const got = Y.parseFeed(xml);
  ok('both entries are read', got.length === 2);
  ok('newest first, whatever order the feed was in', got[0].videoId === 'new1', got[0].videoId);
  ok('titles are decoded', got[0].title === 'Bread & butter', got[0].title);
  ok('published is a timestamp', got[0].at === Date.parse('2026-09-01T10:00:00+00:00'));
  ok('the older one is still there', got[1].videoId === 'old1');
}
ok('an entry with no video id is skipped',
   Y.parseFeed('<feed><entry><title>x</title></entry></feed>').length === 0);
ok('an unparseable date does not lose the entry',
   Y.parseFeed('<feed><entry><yt:videoId>a</yt:videoId><published>soon</published></entry></feed>')[0].at === 0);
ok('an empty feed is an empty list', Y.parseFeed('<feed></feed>').length === 0);
ok('junk is an empty list', Y.parseFeed('not xml at all').length === 0);
ok('nothing is an empty list', Y.parseFeed(null).length === 0);

console.log('\nthe feed url');
ok('it is the public one, with no key',
   Y.feedUrl(ID) === 'https://www.youtube.com/feeds/videos.xml?channel_id=' + ID);
ok('and the id is escaped', Y.feedUrl('a b').endsWith('a%20b'));

console.log('\n' + pass + ' passed, ' + fails.length + ' failed');
if (fails.length){ fails.forEach(f => console.log('  - ' + f)); process.exit(1) }
