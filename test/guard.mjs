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

console.log('\nwhere the add button goes');
{
  const t = boot({ url:'https://www.youtube.com/@anyone',
                   body:'<yt-flexible-actions-view-model><button>Subscribe</button></yt-flexible-actions-view-model>',
                   answer: adding });
  await wait(60);
  const host = t.addBtn();
  ok('it finds the channel page action row',
     !!host && host.parentElement.tagName.toLowerCase() === 'yt-flexible-actions-view-model',
     host && host.parentElement.tagName);
  ok('and says it is inline', host.classList.contains('inline'));
  t.dom.window.close();
}
{
  const t = boot({ url:'https://www.youtube.com/@anyone', answer: adding });
  await wait(60);
  const host = t.addBtn();
  ok('with no row to find it still appears', !!host);
  ok('floating, rather than not at all', !host.classList.contains('inline'));
  t.dom.window.close();
}

console.log('\nadding every channel on the subscriptions page');
{
  const t = boot({ url:'https://www.youtube.com/feed/channels',
                   body:'<a href="/@one">One</a><a href="/@two">Two</a>' +
                        '<a href="/@one">One again</a><a href="/watch?v=x">a video</a>' +
                        '<a href="/feed/history">history</a>',
                   answer: adding });
  await wait(60);
  ok('the subscriptions page gets a button', !!t.addBtn());

  t.addBtn().shadowRoot.querySelector('button')
    .dispatchEvent(new t.w.MouseEvent('click', { bubbles:true }));
  await wait(40);
  const msg = t.sent.find(m => m.type === 'addMany');
  ok('clicking it sends every channel at once', !!msg, JSON.stringify(t.sent));
  ok('the same channel twice is sent once', msg && msg.items.length === 2,
     JSON.stringify(msg && msg.items));
  ok('videos and feeds are not channels',
     msg && msg.items.every(i => i.url.includes('/@')));
  ok('and each carries a name', msg && msg.items[0].name === 'One', JSON.stringify(msg.items[0]));
  t.dom.window.close();
}
{
  const t = boot({ url:'https://www.youtube.com/feed/channels', answer: guarded() });
  await wait(30);
  ok('with the guard on, that page is sent to the board instead', t.redirected());
  ok('and grows no button', !t.addBtn());
  t.dom.window.close();
}

console.log('\nputting a video aside');
{
  const t = boot({ url:'https://www.youtube.com/watch?v=vid1',
                   head:'<meta itemprop="channelId" content="UC9">' +
                        '<meta property="og:title" content="A good video">',
                   answer: guarded({ handles:['@keep'], ids:['UC9'], names:[], videos:[] }) });
  await wait(60);
  ok('a video you are allowed to watch gets a queue button', !!t.addBtn());

  t.addBtn().shadowRoot.querySelector('button')
    .dispatchEvent(new t.w.MouseEvent('click', { bubbles:true }));
  await wait(40);
  const msg = t.sent.find(m => m.type === 'enqueue');
  ok('clicking it queues the video', !!msg, JSON.stringify(t.sent));
  ok('with its id', msg && msg.videoId === 'vid1');
  ok('its title', msg && msg.title === 'A good video', msg && msg.title);
  ok('and whose channel it is', msg && msg.channelUrl.includes('UC9'), msg && msg.channelUrl);
  t.dom.window.close();
}
{
  const t = boot({ url:'https://www.youtube.com/watch?v=vid1',
                   head:'<meta itemprop="channelId" content="UC9">',
                   answer: () => ({ enabled:true, guarding:false, addMode:false,
                                    queueButton:false, addOnVideo:false,
                                    snoozeUntil:0, grant:null }) });
  await wait(60);
  ok('turned off in settings, there is no queue button', !t.addBtn());
  t.dom.window.close();
}
{
  const t = boot({ url:'https://www.youtube.com/@keep', answer: guarded() });
  await wait(60);
  ok('a channel page gets no queue button', !t.addBtn());
  t.dom.window.close();
}

console.log('\nkeeping the channel behind the video');

/* The watch page the add button is for: a video that is allowed to play, whose
   owner the page says is UC9, on a board that answers what it holds. */
const watching = ({ already = false, cats = [] } = {}) => msg => {
  if (msg.type === 'addInfo') return { already, known:true, cats };
  if (msg.type === 'addChannel') return { added:!already, already };
  return { enabled:true, guarding:true, snoozeUntil:0,
           grant:{ handles:[], ids:['UC9'], names:[], videos:[] } };
};
const WATCH = { url:'https://www.youtube.com/watch?v=vid1',
                head:'<meta itemprop="channelId" content="UC9">' +
                     '<meta property="og:title" content="A good video">',
                body:'<ytd-channel-name><a href="/@keep">Keep</a></ytd-channel-name>' };
const CATS = [{ id:'c1', name:'learning', color:'#A78BFA' },
              { id:'c2', name:'making', color:'#E0A060' }];
const buttons = t => [...t.addBtn().shadowRoot.querySelectorAll('button.btn')];
const text = b => b.childNodes[0].textContent;

{
  const t = boot({ ...WATCH, answer: watching({ cats:CATS }) });
  await wait(60);
  ok('a video page carries the queue button and the add button, in that order',
     buttons(t).length === 2 && text(buttons(t)[0]) === '+ queue'
       && text(buttons(t)[1]) === '+ add channel',
     buttons(t).map(text).join(' | '));
  ok('and the board was asked about this video\u2019s channel, not the page',
     t.sent.some(m => m.type === 'addInfo' && m.url === 'https://www.youtube.com/channel/UC9'),
     JSON.stringify(t.sent.filter(m => m.type === 'addInfo')));

  const add = buttons(t)[1];
  add.dispatchEvent(new t.w.MouseEvent('click', { bubbles:true }));
  await wait(20);
  const menu = t.addBtn().shadowRoot.querySelector('.menu');
  ok('clicking it opens the categories rather than filing it straight away',
     !!menu && !t.sent.some(m => m.type === 'addChannel'));
  const items = menu ? [...menu.querySelectorAll('.item')] : [];
  ok('every category on the board is in it, and no category as well',
     items.map(i => i.textContent).join(',') === 'learning,making,no category',
     items.map(i => i.textContent).join(','));

  items[1].dispatchEvent(new t.w.MouseEvent('click', { bubbles:true }));
  await wait(40);
  const msg = t.sent.find(m => m.type === 'addChannel');
  ok('picking one files the channel', !!msg, JSON.stringify(t.sent));
  ok('with the channel url', msg && msg.url === 'https://www.youtube.com/channel/UC9');
  ok('the category that was picked', msg && msg.cat === 'c2', msg && msg.cat);
  ok('and the channel\u2019s name, not the video\u2019s title', msg && msg.name === 'Keep', msg && msg.name);
  ok('the menu closes behind it', !t.addBtn().shadowRoot.querySelector('.menu'));
  ok('and the button says what happened', text(buttons(t)[1]) === 'added'
     && buttons(t)[1].classList.contains('done'));
  t.dom.window.close();
}
{
  const t = boot({ ...WATCH, answer: watching({ already:true, cats:CATS }) });
  await wait(60);
  const add = buttons(t)[1];
  ok('a channel already on the board says so before it is clicked',
     text(add) === 'on the board' && add.classList.contains('have'), text(add));
  add.dispatchEvent(new t.w.MouseEvent('click', { bubbles:true }));
  await wait(40);
  ok('and clicking it files nothing and opens nothing',
     !t.sent.some(m => m.type === 'addChannel')
       && !t.addBtn().shadowRoot.querySelector('.menu'));
  t.dom.window.close();
}
{
  const t = boot({ ...WATCH, answer: watching({ cats:[] }) });
  await wait(60);
  buttons(t)[1].dispatchEvent(new t.w.MouseEvent('click', { bubbles:true }));
  await wait(40);
  const msg = t.sent.find(m => m.type === 'addChannel');
  ok('with no categories to choose between, one click is the whole thing',
     !!msg && msg.cat === '', JSON.stringify(msg));
  t.dom.window.close();
}
{
  const t = boot({ ...WATCH,
                   answer: msg => msg.type === 'addInfo' ? null
                     : ({ enabled:true, guarding:true, snoozeUntil:0,
                          grant:{ handles:[], ids:['UC9'], names:[], videos:[] } }) });
  await wait(60);
  ok('a board that cannot answer leaves the queue button and adds nothing else',
     buttons(t).length === 1 && text(buttons(t)[0]) === '+ queue',
     buttons(t).map(text).join(' | '));
  t.dom.window.close();
}
{
  const t = boot({ ...WATCH,
                   answer: msg => ({ ...watching({ cats:CATS })(msg), addOnVideo:false }) });
  await wait(60);
  ok('turned off in settings, a video page is back to one button',
     buttons(t).length === 1 && text(buttons(t)[0]) === '+ queue');
  t.dom.window.close();
}
{
  const t = boot({ url:'https://www.youtube.com/@keep',
                   answer: msg => ({ ...watching({ cats:CATS })(msg),
                                     grant:{ handles:['@keep'], ids:[], names:[], videos:[] } }) });
  await wait(60);
  ok('and a channel page still gets neither of them', !t.addBtn());
  t.dom.window.close();
}

console.log('\n' + pass + ' passed, ' + fails.length + ' failed');
if (fails.length){ fails.forEach(f => console.log('  - ' + f)); process.exit(1) }
