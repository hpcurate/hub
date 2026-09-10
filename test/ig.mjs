// The Instagram rules and readers, on their own.
//   cd hub/test && node ig.mjs
// ext/ig.js is pure like ext/scope.js, and for a sharper reason: it is the only
// code in HUB that depends on what somebody else's pages look like, and the
// only way to keep that honest is to be able to test it off a page built here
// rather than off the live site. The readers take a document, so jsdom is
// enough — no network, no login, no account.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(HERE, '..', 'ext', 'ig.js'), 'utf8');
const IG = new Function(src + '\nreturn HubIG;')();

let pass = 0; const fails = [];
const ok = (name, cond, detail = '') => {
  if (cond){ pass++; console.log('  ok   ' + name) }
  else { fails.push(name + (detail ? ' — ' + detail : '')); console.log('  FAIL ' + name + (detail ? ' — ' + detail : '')) }
};
const eq = (name, a, b) => ok(name, JSON.stringify(a) === JSON.stringify(b), JSON.stringify(a));

const doc = html => new JSDOM(html).window.document;

console.log('\nreading an account out of a url');
eq('a plain profile',   IG.parse('https://www.instagram.com/someone/'),   { kind:'user', key:'someone' });
eq('cased and dotted',  IG.parse('https://www.instagram.com/Some.One/'),  { kind:'user', key:'some.one' });
eq('with underscores',  IG.parse('https://instagram.com/a_b_c/'),         { kind:'user', key:'a_b_c' });
eq('a subpage of one',  IG.parse('https://www.instagram.com/someone/reels/'), { kind:'user', key:'someone' });
ok('the feed names nobody',    IG.parse('https://www.instagram.com/') === null);
ok('explore names nobody',     IG.parse('https://www.instagram.com/explore/') === null);
ok('a post names nobody',      IG.parse('https://www.instagram.com/p/AbC123/') === null);
ok('direct names nobody',      IG.parse('https://www.instagram.com/direct/inbox/') === null);
ok('accounts names nobody',    IG.parse('https://www.instagram.com/accounts/login/') === null);
ok('a name too long is not a name',
   IG.parse('https://www.instagram.com/' + 'a'.repeat(31) + '/') === null);
ok('a name with a dash is not a name', IG.parse('https://www.instagram.com/a-b/') === null);

console.log('\nwhat kind of page is this');
eq('a profile', IG.classify('https://www.instagram.com/someone/'), { type:'profile', scope:{ kind:'user', key:'someone' } });
eq('a post',    IG.classify('https://www.instagram.com/p/AbC123/'),   { type:'post', shortcode:'AbC123' });
eq('a reel',    IG.classify('https://www.instagram.com/reel/XyZ789/'), { type:'post', shortcode:'XyZ789' });
eq('an old tv link', IG.classify('https://www.instagram.com/tv/QqQ/'), { type:'post', shortcode:'QqQ' });
eq('the feed',  IG.classify('https://www.instagram.com/'),            { type:'feed' });
eq('explore',   IG.classify('https://www.instagram.com/explore/tags/x/'), { type:'feed' });
eq('a story',   IG.classify('https://www.instagram.com/stories/someone/123/'),
                { type:'story', scope:{ kind:'user', key:'someone' } });
ok('another site is not instagram', IG.isInstagram('https://www.youtube.com/@x') === false);
ok('instagram is', IG.isInstagram('https://www.instagram.com/x/') === true);

console.log('\nbuilding urls');
eq('a profile url drops the @', IG.profileUrl('@someone'), 'https://www.instagram.com/someone/');
eq('posts is the account itself', IG.onTab('https://instagram.com/Some.One/', 'posts'),
   'https://www.instagram.com/some.one/');
eq('reels is a page of its own', IG.onTab('https://instagram.com/someone/', 'reels'),
   'https://www.instagram.com/someone/reels/');
eq('an unknown tab falls back to the account', IG.onTab('https://instagram.com/someone/', 'nonsense'),
   'https://www.instagram.com/someone/');
eq('a url that names nobody is left alone', IG.onTab('https://www.instagram.com/explore/', 'reels'),
   'https://www.instagram.com/explore/');

console.log('\nreading a profile page');
{
  const page = doc(`
    <html><head>
      <meta property="og:title" content="Some Person (@some.one) • Instagram photos and videos">
      <meta property="og:image" content="https://cdn.example.com/avatar.jpg">
      <link rel="canonical" href="https://www.instagram.com/some.one/">
    </head><body>
      <header><img src="https://cdn.example.com/avatar.jpg" alt="Some Person's profile picture"></header>
      <main>
        <a href="/p/AAA111/"><img></a>
        <a href="/reel/BBB222/"><img></a>
        <a href="/p/AAA111/">the same post linked twice</a>
        <a href="/p/CCC333/"><img></a>
        <a href="/explore/tags/nope/">not a post</a>
      </main>
    </body></html>`);
  const p = IG.readProfile(page);
  eq('the handle comes out of og:title', p.handle, 'some.one');
  eq('and the name in front of it',      p.name,   'Some Person');
  eq('the avatar is the og image',       p.avatar, 'https://cdn.example.com/avatar.jpg');
  eq('the grid is read in order',        p.posts,  ['AAA111','BBB222','CCC333']);
  ok('a post linked twice takes one place', p.posts.length === 3);
}
{
  const page = doc(`<html><head>
      <link rel="canonical" href="https://www.instagram.com/quiet/">
    </head><body><header><img src="/pic.jpg" alt="quiet's profile picture"></header></body></html>`);
  const p = IG.readProfile(page);
  eq('a trimmed head still names the account', p.handle, 'quiet');
  eq('and falls back to the header picture',   p.avatar, '/pic.jpg');
  eq('an account with nothing posted is still an answer', p.posts, []);
}
ok('a login wall is not a profile',
   IG.readProfile(doc('<html><head><title>Login</title></head><body><form id="loginForm"><input name="password"></form></body></html>')) === null);
ok('an empty document is not a profile', IG.readProfile(doc('<html><body></body></html>')) === null);
ok('something that is not a document is not a profile', IG.readProfile(null) === null);

console.log('\nreading one post');
{
  const page = doc(`
    <html><head>
      <meta property="og:description" content="1,234 likes, 56 comments - some.one on January 1, 2026: &quot;a caption worth reading&quot;">
      <meta property="og:image" content="https://cdn.example.com/thumb.jpg">
      <link rel="canonical" href="https://www.instagram.com/p/AAA111/">
    </head><body><time datetime="2026-01-01T12:00:00.000Z">1 January</time></body></html>`);
  const post = IG.readPost(page);
  eq('the shortcode comes off the canonical link', post.shortcode, 'AAA111');
  eq('the time is the real posted-at', post.at, Date.parse('2026-01-01T12:00:00.000Z'));
  eq('the caption is dug out of the description', post.title, 'a caption worth reading');
  eq('and the thumbnail is the og image', post.thumb, 'https://cdn.example.com/thumb.jpg');
}
{
  const post = IG.readPost(doc('<html><body><p>nothing here</p></body></html>'));
  eq('a post with no time reads as no time', post.at, 0);
  eq('and names no shortcode', post.shortcode, '');
}

console.log('\n' + pass + ' passed, ' + fails.length + ' failed');
if (fails.length){ fails.forEach(f => console.log('  - ' + f)); process.exit(1) }
