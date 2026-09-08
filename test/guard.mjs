// The guard, in a fake YouTube page (jsdom).
//   cd hub/test && npm install && node guard.mjs
// Loads the real ext/scope.js + ext/guard.js into a document that looks enough
// like YouTube, with a stubbed background behind it, and checks the two things
// that matter: that the right pages are blocked, and that every way this can go
// wrong ends with the page unblocked.
import { JSDOM, VirtualConsole } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = f => fs.readFileSync(path.join(HERE, '..', 'ext', f), 'utf8');
const SCOPE = read('scope.js'), GUARD = read('guard.js');

let pass = 0; const fails = [];
const ok = (name, cond, detail = '') => {
  if (cond){ pass++; console.log('  ok   ' + name) }
  else { fails.push(name + (detail ? ' — ' + detail : '')); console.log('  FAIL ' + name + (detail ? ' — ' + detail : '')) }
};
const wait = ms => new Promise(r => setTimeout(r, ms));

/* One fake tab. `answer` stands in for the background: return a status object,
   or null to say nothing at all and let the guard's own timeouts take over. */
function boot({ url, head = '', body = '', answer, getURLThrows = false }){
  const vc = new VirtualConsole();
  const logged = [];
  vc.on('jsdomError', e => logged.push(String(e.detail?.message || e.message)));

  const dom = new JSDOM(
    `<!DOCTYPE html><html><head>${head}</head><body>${body}<video></video></body></html>`,
    { url, runScripts:'outside-only', pretendToBeVisual:true, virtualConsole:vc });

  const w = dom.window;
  const sent = [];
  w.HTMLMediaElement.prototype.pause = function(){ this.__paused = true };
  w.chrome = {
    runtime: {
      id: 'test-extension',
      lastError: undefined,
      getURL(p){ if (getURLThrows) throw new Error('context invalidated'); return 'chrome-extension://test/' + p },
      sendMessage(msg, cb){
        sent.push(msg);
        const res = answer(msg);
        if (res === undefined) return;              /* a background that never replies */
        setTimeout(() => cb(res), 0);
      },
    },
  };

  w.eval(SCOPE);
  w.eval(GUARD);

  const veiled = () => w.document.documentElement.classList.contains('hub-veil');
  const addBtn = () => w.document.getElementById('hub-add-root');
  /* jsdom will not navigate, but it says so - which is exactly the signal
     wanted here, since "sent to the board" is a navigation and nothing else. */
  const redirected = () => logged.some(l => /navigation/i.test(l));
  return { dom, w, sent, veiled, addBtn, redirected, logged };
}

const GRANT = { handles:['@keep'], ids:[], names:[], videos:[] };
const guarded = (grant = GRANT) => () => ({ enabled:true, guarding:true, snoozeUntil:0, grant });

console.log('\nsending a blocked page to the board');
{
  const t = boot({ url:'https://www.youtube.com/', answer: guarded() });
  ok('the veil goes on before anything is decided', t.veiled());
  await wait(30);
  ok('the home feed is sent to the board', t.redirected());
  ok('nothing is drawn over the page instead', !t.addBtn());
  ok('the video was paused on the way', t.w.document.querySelector('video').__paused === true);
  t.dom.window.close();
}
{
  const t = boot({ url:'https://www.youtube.com/@other', answer: guarded() });
  await wait(30);
  ok('another channel is sent to the board', t.redirected());
  t.dom.window.close();
}
{
  const t = boot({ url:'https://www.youtube.com/results?search_query=x', answer: guarded() });
  await wait(30);
  ok('search is sent to the board', t.redirected());
  t.dom.window.close();
}

console.log('\nletting through');
{
  const t = boot({ url:'https://www.youtube.com/@keep/videos', answer: guarded() });
  await wait(30);
  ok('the channel that was picked comes through', !t.veiled());
  ok('and is not sent anywhere', !t.redirected());
  t.dom.window.close();
}
{
  const t = boot({ url:'https://www.youtube.com/watch?v=vid1',
                   head:'<meta itemprop="channelId" content="UC9">',
                   answer: guarded({ handles:['@keep'], ids:['UC9'], names:[], videos:[] }) });
  await wait(60);
  ok('a video of that channel plays', !t.veiled() && !t.redirected());
  ok('and is remembered as cleared', t.sent.some(m => m.type === 'cleared' && m.videoId === 'vid1'));
  t.dom.window.close();
}
{
  const t = boot({ url:'https://www.youtube.com/watch?v=vid2',
                   head:'<meta itemprop="channelId" content="UCsomeoneelse">',
                   answer: guarded() });
  ok('a video whose owner is unread stays covered', t.veiled());
  await wait(60);
  ok("a video of someone else's channel is sent to the board", t.redirected());
  t.dom.window.close();
}
{
  const t = boot({ url:'https://www.youtube.com/watch?v=vid3',
                   answer: guarded({ handles:['@keep'], ids:[], names:[], videos:['vid3'] }) });
  await wait(30);
  ok('a video cleared on the way in never waits', !t.veiled() && !t.redirected());
  t.dom.window.close();
}
{
  const t = boot({ url:'https://www.youtube.com/@keep',
                   head:'<link rel="canonical" href="https://www.youtube.com/channel/UC9">',
                   answer: guarded() });
  await wait(60);
  ok('the channel page teaches the grant its other name',
     t.sent.some(m => m.type === 'alias' && m.scope.kind === 'id' && m.scope.key === 'UC9'));
  t.dom.window.close();
}

console.log('\nfailing open');
{
  const t = boot({ url:'https://www.youtube.com/', answer: () => undefined });
  ok('the veil starts on while the background is asked', t.veiled());
  await wait(1700);
  ok('a background that never answers ends with the page free', !t.veiled());
  ok('and never sends it anywhere', !t.redirected());
  t.dom.window.close();
}
{
  const t = boot({ url:'https://www.youtube.com/', answer: () => null });
  await wait(30);
  ok('a background that answers nothing leaves the page alone', !t.veiled() && !t.redirected());
  t.dom.window.close();
}
{
  const t = boot({ url:'https://www.youtube.com/',
                   answer: () => ({ enabled:false, guarding:false, grant:null }) });
  await wait(30);
  ok('the guard turned off leaves the page alone', !t.veiled() && !t.redirected());
  t.dom.window.close();
}
{
  const t = boot({ url:'https://www.youtube.com/',
                   answer: () => ({ enabled:true, guarding:false, snoozeUntil:Date.now() + 6e5, grant:null }) });
  await wait(30);
  ok('the guard paused leaves the page alone', !t.veiled() && !t.redirected());
  t.dom.window.close();
}
{
  const t = boot({ url:'https://www.youtube.com/',
                   answer: () => ({ enabled:true, guarding:false, bypassed:true, grant:null }) });
  await wait(30);
  ok('a tab that was dismissed stays dismissed across the reload', !t.veiled() && !t.redirected());
  t.dom.window.close();
}
{
  const t = boot({ url:'https://www.youtube.com/watch?v=nobody', answer: guarded() });
  await wait(2700);
  ok('a video whose owner can never be read is let through, not blocked',
     !t.veiled() && !t.redirected());
  t.dom.window.close();
}
{
  const t = boot({ url:'https://www.youtube.com/', answer: guarded(), getURLThrows:true });
  await wait(30);
  ok('a board that cannot even be addressed does not leave a blurred page',
     !t.veiled() && !t.redirected());
  t.dom.window.close();
}

console.log('\nthe escape hatch');
{
  const t = boot({ url:'https://www.youtube.com/watch?v=slow', answer: guarded() });
  ok('covered while the owner is read', t.veiled());
  const esc = () => t.w.dispatchEvent(new t.w.KeyboardEvent('keydown', { key:'Escape', bubbles:true }));
  esc(); esc();
  ok('two escapes are not enough', t.veiled());
  esc();
  await wait(30);
  ok('three escapes inside two seconds get the page back', !t.veiled());
  ok('and the dismissal is told to the background, so it survives a reload',
     t.sent.some(m => m.type === 'bypass'), JSON.stringify(t.sent));
  await wait(2600);
  ok('and nothing sends it away afterwards', !t.redirected());
  t.dom.window.close();
}

console.log('\nadd mode');
const adding = () => ({ enabled:true, guarding:false, addMode:true, snoozeUntil:0, grant:null });
{
  const t = boot({ url:'https://www.youtube.com/@anyone',
                   head:'<meta property="og:title" content="Anyone">', answer: adding });
  await wait(30);
  ok('the guard stands down', !t.veiled() && !t.redirected());
  ok('and a channel page grows an add button', !!t.addBtn());

  const b = t.addBtn().shadowRoot.querySelector('button');
  b.dispatchEvent(new t.w.MouseEvent('click', { bubbles:true }));
  await wait(40);
  const msg = t.sent.find(m => m.type === 'addChannel');
  ok('clicking it files the channel', !!msg, JSON.stringify(t.sent));
  ok('with the channel url, not the page url', msg && msg.url === 'https://www.youtube.com/@anyone');
  ok('and the channel name off the page', msg && msg.name === 'Anyone');
  t.dom.window.close();
}
{
  const t = boot({ url:'https://www.youtube.com/', answer: adding });
  await wait(30);
  ok('the home feed gets no add button', !t.addBtn());
  t.dom.window.close();
}
{
  const t = boot({ url:'https://www.youtube.com/@anyone', answer: guarded() });
  await wait(30);
  ok('and neither does a channel page with add mode off', !t.addBtn());
  t.dom.window.close();
}

console.log('\n' + pass + ' passed, ' + fails.length + ' failed');
if (fails.length){ fails.forEach(f => console.log('  - ' + f)); process.exit(1) }
