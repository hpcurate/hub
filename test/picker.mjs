// The board in its three lives (jsdom).
//   cd hub/test && npm install && node picker.mjs
// index.html is the same file whether it is opened off disk, opened as the
// extension's own page, or embedded in the overlay on a blurred YouTube tab.
// Only js/bridge.js knows the difference, and this is what it has to get right:
// off disk the anchor must be left alone, and in the other two the click must
// become a granted tab rather than an ungranted one.
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
                  desc:'', cat:'', added:1, seen:null };

async function boot({ picker = false, withChrome = true } = {}){
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(String(e.detail?.message || e.message)));

  const sent = [], posted = [];
  const dom = new JSDOM(html, {
    url: 'http://localhost/hub/index.html' + (picker ? '?picker=1' : ''),
    runScripts:'dangerously', resources:new LocalLoader(),
    pretendToBeVisual:true, virtualConsole:vc,
    beforeParse(w){
      w.matchMedia = () => ({ matches:false, addEventListener(){}, removeEventListener(){}, addListener(){} });
      w.localStorage.setItem('hub.channels.v1', JSON.stringify([CHANNEL]));
      if (withChrome) w.chrome = {
        runtime: {
          id:'test-extension', lastError:undefined,
          getURL: p => 'chrome-extension://test/' + p,
          sendMessage(msg, cb){ sent.push(msg); setTimeout(() => cb({ ok:true, guarding:true }), 0) },
        },
        tabs: { create(){} },
      };
      w.addEventListener('message', e => posted.push(e.data));
    },
  });

  const w = dom.window;
  await new Promise(r => w.addEventListener('load', r));
  w.document.addEventListener('click', e => { const a = e.target.closest?.('a'); if (a) e.preventDefault() }, true);
  return { dom, w, sent, posted, errors };
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
     hit.href === CHANNEL.url && hit.target === '_blank');
  clickCard(t.w);
  await wait(30);
  ok('the bridge takes no part in it', t.sent.length === 0 && t.posted.length === 0);
  ok('the card still stamps its view',
     JSON.parse(t.w.localStorage.getItem('hub.channels.v1'))[0].seen !== null);
  ok('the page booted clean', t.errors.length === 0, t.errors[0]);
  t.dom.window.close();
}

console.log('\nthe extension\u2019s own page');
{
  const t = await boot({ picker:false, withChrome:true });
  ok('the bridge sees the extension', t.w.eval('HubBridge.inExt') === true);
  ok('and knows it is not the picker', t.w.eval('HubBridge.picker') === false);
  const ev = clickCard(t.w);
  await wait(40);
  ok('the anchor is stopped', ev.defaultPrevented);
  const msg = t.sent.find(m => m.type === 'openInTab');
  ok('a granted tab is asked for', !!msg, JSON.stringify(t.sent));
  ok('and it names the channel', msg && msg.scope.kind === 'handle' && msg.scope.key === '@keep',
     JSON.stringify(msg));
  ok('the url goes with it', msg && msg.url === CHANNEL.url);
  ok('nothing was posted at a parent', t.posted.length === 0);
  t.dom.window.close();
}

console.log('\nthe picker, over a blurred youtube');
{
  const t = await boot({ picker:true, withChrome:true });
  ok('the bridge knows it is the picker', t.w.eval('HubBridge.picker') === true);
  ok('and says so on the document', t.w.document.documentElement.classList.contains('picker'));
  const ev = clickCard(t.w);
  await wait(40);
  ok('the anchor is stopped', ev.defaultPrevented);
  const msg = t.sent.find(m => m.type === 'unlock');
  ok('this tab is unlocked first', !!msg, JSON.stringify(t.sent));
  ok('for the channel that was clicked', msg && msg.scope.key === '@keep');
  ok('no second tab is asked for', !t.sent.some(m => m.type === 'openInTab'));
  const go = t.posted.find(d => d && d.hub === 'go');
  ok('and only then is the page asked to go', !!go, JSON.stringify(t.posted));
  ok('to the channel', go && go.url === CHANNEL.url);
  ok('the view is stamped here too',
     JSON.parse(t.w.localStorage.getItem('hub.channels.v1'))[0].seen !== null);
  t.dom.window.close();
}

console.log('\nwhen the background will not grant');
{
  const t = await boot({ picker:true, withChrome:true });
  t.w.chrome.runtime.sendMessage = (msg, cb) => { t.sent.push(msg); setTimeout(() => cb(null), 0) };
  clickCard(t.w);
  await wait(40);
  ok('the tab is not sent anywhere it would only bounce off',
     !t.posted.some(d => d && d.hub === 'go'), JSON.stringify(t.posted));
  t.dom.window.close();
}

console.log('\n' + pass + ' passed, ' + fails.length + ' failed');
if (fails.length){ fails.forEach(f => console.log('  - ' + f)); process.exit(1) }
