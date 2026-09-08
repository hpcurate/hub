// The board in its three lives (jsdom).
//   cd hub/test && npm install && node bridge.mjs
// index.html is the same file whether it is opened off disk, opened as the
// extension's own page, or landed on by a YouTube tab the guard sent here.
// Only js/bridge.js knows the difference, and this is what it has to get right:
// off disk the anchor must be left alone; in the extension's own tab a click
// opens a granted new tab; on a blocked tab it takes that same tab in.
import { JSDOM, ResourceLoader, VirtualConsole } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP  = path.resolve(HERE, '..');
const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');

class LocalLoader extends ResourceLoader {
  fetch(url){
    const u = new URL(url);
    if (u.hostname === 'localhost' && u.pathname.endsWith('.js'))
      return Promise.resolve(fs.readFileSync(path.join(APP, u.pathname.replace(/^\/hub\//, ''))));
    return Promise.resolve(Buffer.from(''));
  }
}

const CHANNEL = { id:'c1', url:'https://www.youtube.com/@keep', name:'@keep',
                  desc:'', cat:'', added:1, seen:null, clicks:0 };
const BLOCKED_FROM = 'https://www.youtube.com/feed/subscriptions';

/* A chrome.storage.local stand-in: a plain object behind the two methods the
   store uses, so what ends up in it can be read back by the test. */
function fakeArea(seed = {}){
  const bag = { ...seed };
  return {
    bag,
    api: {
      local: {
        get: keys => Promise.resolve(Object.fromEntries(
          (Array.isArray(keys) ? keys : Object.keys(keys)).map(k => [k, bag[k]]))),
        set: obj => { Object.assign(bag, obj); return Promise.resolve() },
      },
      session: { get: () => Promise.resolve({}), set: () => Promise.resolve() },
      onChanged: { addListener(){} },
    },
  };
}

async function boot({ blocked = false, withChrome = true, storage = null, seedLocal = true } = {}){
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(String(e.detail?.message || e.message)));

  const sent = [], posted = [];
  const dom = new JSDOM(html, {
    url: 'http://localhost/hub/index.html'
       + (blocked ? '?blocked=1&from=' + encodeURIComponent(BLOCKED_FROM) : ''),
    runScripts:'dangerously', resources:new LocalLoader(),
    pretendToBeVisual:true, virtualConsole:vc,
    beforeParse(w){
      w.matchMedia = () => ({ matches:false, addEventListener(){}, removeEventListener(){}, addListener(){} });
      if (seedLocal) w.localStorage.setItem('hub.channels.v1', JSON.stringify([CHANNEL]));
      if (withChrome) w.chrome = {
        runtime: {
          id:'test-extension', lastError:undefined,
          getURL: p => 'chrome-extension://test/' + p,
          sendMessage(msg, cb){ sent.push(msg); setTimeout(() => cb({ ok:true, guarding:true }), 0) },
        },
        tabs: { create(){} },
        storage: storage ? storage.api : undefined,
      };
      w.addEventListener('message', e => posted.push(e.data));
    },
  });

  const w = dom.window;
  await new Promise(r => w.addEventListener('load', r));
  await w.eval('Store.ready');
  w.document.addEventListener('click', e => { const a = e.target.closest?.('a'); if (a) e.preventDefault() }, true);
  /* jsdom will not navigate, but it says so, which is the only signal there is
     that the bridge took the tab somewhere. */
  const navigated = () => errors.some(e => /navigation/i.test(e));
  return { dom, w, sent, posted, errors, navigated };
}

let pass = 0; const fails = [];
const ok = (name, cond, detail = '') => {
  if (cond){ pass++; console.log('  ok   ' + name) }
  else { fails.push(name + (detail ? ' — ' + detail : '')); console.log('  FAIL ' + name + (detail ? ' — ' + detail : '')) }
};
const wait = ms => new Promise(r => setTimeout(r, ms));
const clickCard = w => {
  const hit = w.document.querySelector('#grid .card .card-hit');
  const ev = new w.MouseEvent('click', { bubbles:true, cancelable:true });
  hit.dispatchEvent(ev);
  return ev;
};

console.log('\nopened off disk');
{
  const t = await boot({ withChrome:false });
  ok('the bridge knows there is no extension', t.w.eval('HubBridge.inExt') === false);
  const hit = t.w.document.querySelector('#grid .card .card-hit');
  ok('the card is still a plain link to the channel',
     hit.href === CHANNEL.url + '/videos' && hit.target === '_blank', hit.href);
  clickCard(t.w);
  await wait(30);
  ok('the bridge takes no part in it', t.sent.length === 0);
  ok('the blocked bar is nowhere', t.w.document.getElementById('blocked').hidden);
  ok('the card still stamps its view',
     JSON.parse(t.w.localStorage.getItem('hub.channels.v1'))[0].seen !== null);
  ok('and counts the click', JSON.parse(t.w.localStorage.getItem('hub.channels.v1'))[0].clicks === 1);
  ok('the page booted clean', t.errors.length === 0, t.errors[0]);
  t.dom.window.close();
}

console.log('\nthe extension\u2019s own page');
{
  const t = await boot({ withChrome:true });
  ok('the bridge sees the extension', t.w.eval('HubBridge.inExt') === true);
  ok('and knows this tab was not blocked', t.w.eval('HubBridge.blocked') === false);
  ok('so there is no blocked bar', t.w.document.getElementById('blocked').hidden);
  const ev = clickCard(t.w);
  await wait(40);
  ok('the anchor is stopped', ev.defaultPrevented);
  const msg = t.sent.find(m => m.type === 'openInTab');
  ok('a granted tab is asked for', !!msg, JSON.stringify(t.sent));
  ok('and it names the channel', msg && msg.scope.kind === 'handle' && msg.scope.key === '@keep');
  /* Where it lands is the board's choice; what it is allowed to be is the
     channel. The grant is the scope, and the scope is read from the stored url
     however deep into the channel the tab is sent. */
  ok('and lands on the videos tab', msg && msg.url === CHANNEL.url + '/videos', msg && msg.url);
  ok('this tab stays where it is', !t.navigated());
  t.dom.window.close();
}

console.log('\na tab the guard sent here');
{
  const t = await boot({ blocked:true, withChrome:true });
  ok('the bridge knows the tab was blocked', t.w.eval('HubBridge.blocked') === true);
  ok('and where it was going', t.w.eval('HubBridge.from') === BLOCKED_FROM);
  ok('the blocked bar is shown', !t.w.document.getElementById('blocked').hidden);
  ok('and the page says so', t.w.document.documentElement.classList.contains('blocked'));
  ok('it names what was blocked',
     /youtube\.com\/feed\/subscriptions/.test(t.w.document.getElementById('blocked-where').textContent),
     t.w.document.getElementById('blocked-where').textContent);

  const ev = clickCard(t.w);
  await wait(40);
  ok('the anchor is stopped', ev.defaultPrevented);
  const msg = t.sent.find(m => m.type === 'unlock');
  ok('this tab is unlocked first', !!msg, JSON.stringify(t.sent));
  ok('for the channel that was clicked', msg && msg.scope.key === '@keep');
  ok('and taken to its videos tab', msg && msg.url === CHANNEL.url + '/videos', msg && msg.url);
  ok('no second tab is asked for', !t.sent.some(m => m.type === 'openInTab'));
  ok('and this tab is taken in', t.navigated());
  t.dom.window.close();
}

console.log('\nthe ways out, on the board');
for (const [act, expect] of [['back', null], ['snooze', 'snooze'], ['off', 'setEnabled']]){
  const t = await boot({ blocked:true, withChrome:true });
  const btn = t.w.document.querySelector('#blocked [data-act="' + act + '"]');
  ok('the ' + act + ' button is there', !!btn);
  btn.dispatchEvent(new t.w.MouseEvent('click', { bubbles:true }));
  await wait(60);
  if (expect) ok(act + ' tells the background', t.sent.some(m => m.type === expect), JSON.stringify(t.sent));
  ok(act + ' dismisses the tab, or the guard would send it straight back',
     t.sent.some(m => m.type === 'bypass'), JSON.stringify(t.sent));
  ok(act + ' goes back to where it was headed', t.navigated());
  t.dom.window.close();
}

console.log('\nwhen the background will not grant');
{
  const t = await boot({ blocked:true, withChrome:true });
  t.w.chrome.runtime.sendMessage = (msg, cb) => { t.sent.push(msg); setTimeout(() => cb(null), 0) };
  clickCard(t.w);
  await wait(40);
  ok('the tab is not sent anywhere it would only bounce off', !t.navigated());
  t.dom.window.close();
}

console.log('\ncoming across from localStorage');
{
  // v0.3.0 moved the extension's storage. A board that had channels in the old
  // place must not open empty because of an update.
  const store = fakeArea();
  const t = await boot({ withChrome:true, storage:store });
  ok('the old board is read out of localStorage',
     t.w.eval('Store.channels().length') === 1);
  ok('and the store says it carried it over', t.w.eval('Store.migrated()') === true);
  ok('it is written into the new place',
     JSON.parse(store.bag['hub.channels.v1']).length === 1, JSON.stringify(store.bag));
  ok('categories came with it', t.w.eval('Store.cats().length') === 5);
  ok('and the board actually shows it', t.w.document.querySelectorAll('#grid .card').length === 1);
  t.dom.window.close();
}
{
  const other = { id:'c9', url:'https://www.youtube.com/@already', name:'@already',
                  desc:'', cat:'', added:2, seen:null, clicks:0 };
  const store = fakeArea({ 'hub.channels.v1': JSON.stringify([other]) });
  const t = await boot({ withChrome:true, storage:store });
  ok('a store that already has channels is left alone',
     t.w.eval('Store.channels()[0].name') === '@already');
  ok('nothing is reported as carried over', t.w.eval('Store.migrated()') === false);
  ok('and localStorage is not merged in on top', t.w.eval('Store.channels().length') === 1);
  t.dom.window.close();
}
{
  const store = fakeArea();
  const t = await boot({ withChrome:true, storage:store, seedLocal:false });
  ok('a genuinely new board just seeds its categories', t.w.eval('Store.cats().length') === 5);
  ok('with no channels', t.w.eval('Store.channels().length') === 0);
  ok('and nothing claimed to be migrated', t.w.eval('Store.migrated()') === false);
  t.dom.window.close();
}

console.log('\nopening a channel in this tab instead');
{
  const t = await boot({ withChrome:true });
  /* Through the settings pane, not through the store: the board holds its own
     copy of the settings, and writing round it would be testing nothing. */
  t.w.document.getElementById('btn-set').dispatchEvent(new t.w.MouseEvent('click', { bubbles:true }));
  await wait(20);
  const row = t.w.document.querySelector('#set-body [data-k="newTab"]');
  ok('the setting is there in the extension', !!row);
  row.dispatchEvent(new t.w.MouseEvent('click', { bubbles:true }));
  t.w.document.querySelector('#sheet-set [data-close]')
    .dispatchEvent(new t.w.MouseEvent('click', { bubbles:true }));
  await wait(20);
  clickCard(t.w);
  await wait(40);
  ok('no new tab is asked for', !t.sent.some(m => m.type === 'openInTab'), JSON.stringify(t.sent));
  ok('this tab is unlocked instead', t.sent.some(m => m.type === 'unlock'));
  ok('and taken in', t.navigated());
  t.dom.window.close();
}

console.log('\nopening something out of the queue');
{
  const t = await boot({ withChrome:true });
  t.w.eval("Store.enqueue({ videoId:'v1', url:'https://www.youtube.com/watch?v=v1', title:'A video' })");
  t.w.document.getElementById('btn-q').dispatchEvent(new t.w.MouseEvent('click', { bubbles:true }));
  await wait(40);
  const row = t.w.document.querySelector('#q-list .q-open');
  ok('the queue pane lists it', !!row);
  row.dispatchEvent(new t.w.MouseEvent('click', { bubbles:true, cancelable:true }));
  await wait(40);
  const msg = t.sent.find(m => m.type === 'openVideo');
  ok('opening it asks for a tab granted that one video', !!msg, JSON.stringify(t.sent));
  ok('by video id, not by channel', msg && msg.videoId === 'v1');
  t.dom.window.close();
}

console.log('\n' + pass + ' passed, ' + fails.length + ' failed');
if (fails.length){ fails.forEach(f => console.log('  - ' + f)); process.exit(1) }
