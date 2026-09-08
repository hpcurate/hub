// The scope rules, on their own.
//   cd hub/test && node scope.mjs
// ext/scope.js is pure by design — no chrome, no DOM — so the rules that decide
// what "inside the channel I picked" means can be tested directly, which is
// where the value is. Everything else in the extension is plumbing around this.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(HERE, '..', 'ext', 'scope.js'), 'utf8');
const S = new Function(src + '\nreturn HubScope;')();

let pass = 0; const fails = [];
const ok = (name, cond, detail = '') => {
  if (cond){ pass++; console.log('  ok   ' + name) }
  else { fails.push(name + (detail ? ' — ' + detail : '')); console.log('  FAIL ' + name + (detail ? ' — ' + detail : '')) }
};
const eq = (name, a, b) => ok(name, JSON.stringify(a) === JSON.stringify(b), JSON.stringify(a));

console.log('\nreading a channel out of a url');
eq('a handle',        S.parse('https://www.youtube.com/@veritasium'),        { kind:'handle', key:'@veritasium' });
eq('a handle, cased', S.parse('https://www.youtube.com/@Veritasium'),        { kind:'handle', key:'@veritasium' });
eq('a handle subpage',S.parse('https://www.youtube.com/@veritasium/videos'), { kind:'handle', key:'@veritasium' });
eq('a channel id',    S.parse('https://www.youtube.com/channel/UCHnyfMqiRRG1u-2MsSQLbXA'),
                      { kind:'id', key:'UCHnyfMqiRRG1u-2MsSQLbXA' });
eq('a legacy /c/',    S.parse('https://www.youtube.com/c/Veritasium'),       { kind:'name', key:'veritasium' });
eq('a legacy /user/', S.parse('https://www.youtube.com/user/1veritasium'),   { kind:'name', key:'1veritasium' });
ok('the home page names no channel',   S.parse('https://www.youtube.com/') === null);
ok('a watch page names no channel',    S.parse('https://www.youtube.com/watch?v=abc') === null);
ok('an id is case sensitive, a handle is not',
   S.parse('https://www.youtube.com/channel/UCabc').key === 'UCabc');

console.log('\nwhat kind of page');
eq('channel',  S.classify('https://www.youtube.com/@x').type, 'channel');
eq('watch',    S.classify('https://www.youtube.com/watch?v=dQw4w9WgXcQ'),
               { type:'watch', videoId:'dQw4w9WgXcQ' });
eq('shorts',   S.classify('https://www.youtube.com/shorts/abc123'),  { type:'watch', videoId:'abc123' });
eq('live',     S.classify('https://www.youtube.com/live/abc123'),    { type:'watch', videoId:'abc123' });
eq('youtu.be', S.classify('https://youtu.be/abc123'),                { type:'watch', videoId:'abc123' });
eq('playlist', S.classify('https://www.youtube.com/playlist?list=PL1').type, 'owned');
eq('home',     S.classify('https://www.youtube.com/').type,          'other');
eq('feed',     S.classify('https://www.youtube.com/feed/subscriptions').type, 'other');
eq('search',   S.classify('https://www.youtube.com/results?search_query=x').type, 'other');

console.log('\nhosts');
ok('youtube.com is ours',      S.isYouTube('https://www.youtube.com/'));
ok('m.youtube.com is ours',    S.isYouTube('https://m.youtube.com/'));
ok('youtu.be is ours',         S.isYouTube('https://youtu.be/abc'));
ok('nocookie is ours',         S.isYouTube('https://www.youtube-nocookie.com/embed/a'));
ok('another site is not',      !S.isYouTube('https://example.com/'));
ok('a lookalike host is not',  !S.isYouTube('https://notyoutube.com/'), 'notyoutube.com');
ok('a subdomain trick is not', !S.isYouTube('https://youtube.com.evil.test/'));

console.log('\ngrants');
let g = S.emptyGrant();
ok('a fresh grant holds nothing', !S.holds(g, { kind:'handle', key:'@a' }));
g = S.withAlias(g, { kind:'handle', key:'@a' });
ok('an alias is held',            S.holds(g, { kind:'handle', key:'@a' }));
ok('and only that one',          !S.holds(g, { kind:'handle', key:'@b' }));
g = S.withAlias(g, { kind:'id', key:'UC1' });
ok('a grant holds several names for one channel',
   S.holds(g, { kind:'handle', key:'@a' }) && S.holds(g, { kind:'id', key:'UC1' }));
ok('a handle is never confused with an id',  !S.holds(g, { kind:'id', key:'@a' }));
ok('adding the same alias twice changes nothing',
   S.withAlias(g, { kind:'id', key:'UC1' }).ids.length === 1);
ok('a grant is not mutated in place', S.emptyGrant().handles.length === 0);

let v = S.emptyGrant();
for (let i = 0; i < 260; i++) v = S.withVideo(v, 'v' + i);
ok('cleared videos are capped', v.videos.length === 200, String(v.videos.length));
ok('the newest clearances are the ones kept', S.knowsVideo(v, 'v259') && !S.knowsVideo(v, 'v0'));

console.log('\nthe decision');
const grant = S.withAlias(S.emptyGrant(), { kind:'handle', key:'@keep' });
const d = (url, gr = grant, owner = null) => S.decide(url, gr, owner).state;

ok('somewhere else on the web is never touched', d('https://example.com/x') === 'allow');
ok('youtube with no channel picked is blocked',  d('https://www.youtube.com/', null) === 'block');
ok('the home feed is blocked',                   d('https://www.youtube.com/') === 'block');
ok('search is blocked',                          d('https://www.youtube.com/results?search_query=a') === 'block');
ok('subscriptions is blocked',                   d('https://www.youtube.com/feed/subscriptions') === 'block');
ok('the channel itself is allowed',              d('https://www.youtube.com/@keep') === 'allow');
ok('its subpages are allowed',                   d('https://www.youtube.com/@keep/videos') === 'allow');
ok('another channel is blocked',                 d('https://www.youtube.com/@other') === 'block');

ok('a video waits for its owner',                d('https://www.youtube.com/watch?v=a1') === 'pending');
ok('a video of the channel is allowed',
   d('https://www.youtube.com/watch?v=a1', grant, { kind:'handle', key:'@keep' }) === 'allow');
ok('a video of another channel is blocked',
   d('https://www.youtube.com/watch?v=a1', grant, { kind:'handle', key:'@other' }) === 'block');
ok('a video cleared earlier does not wait again',
   d('https://www.youtube.com/watch?v=a1', S.withVideo(grant, 'a1')) === 'allow');
ok('a short waits the same way',                 d('https://www.youtube.com/shorts/s1') === 'pending');
ok('an owner matching by id works when the grant learnt the id',
   d('https://www.youtube.com/watch?v=a1', S.withAlias(grant, { kind:'id', key:'UC9' }),
     { kind:'id', key:'UC9' }) === 'allow');
ok('an owner is useless without a grant',        d('https://www.youtube.com/watch?v=a1', null,
     { kind:'handle', key:'@keep' }) === 'block');

console.log('\nwhere a channel opens');
eq('a handle', S.channelUrl({ kind:'handle', key:'@keep' }), 'https://www.youtube.com/@keep');
eq('an id',    S.channelUrl({ kind:'id', key:'UC1' }),       'https://www.youtube.com/channel/UC1');
eq('a name',   S.channelUrl({ kind:'name', key:'keep' }),    'https://www.youtube.com/c/keep');
eq('nothing',  S.channelUrl(null),                           'https://www.youtube.com/');

console.log('\n' + pass + ' passed, ' + fails.length + ' failed');
if (fails.length){ fails.forEach(f => console.log('  - ' + f)); process.exit(1) }
