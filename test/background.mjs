// The service worker, off its own file (node:vm).
//   cd hub/test && npm install && node background.mjs
// Loads the real ext/background.js into a context with a fake chrome.storage
// behind it, and asks it the questions the content script asks: what is already
// on the board, what could a channel be filed under, and what happens when one
// is filed. This is the write path — the only code that can put a record on the
// board that the board itself never saw — so it is checked against storage
// rather than against its own reply.
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = f => fs.readFileSync(path.join(HERE, '..', 'ext', f), 'utf8');

let pass = 0; const fails = [];
const ok = (name, cond, detail = '') => {
  if (cond){ pass++; console.log('  ok   ' + name) }
  else { fails.push(name + (detail ? ' — ' + detail : '')); console.log('  FAIL ' + name + (detail ? ' — ' + detail : '')) }
};

/* One worker, with the two storages it owns. `local` is seeded with whatever a
   test wants the board to already hold. */
function boot(local = {}){
  const store = { local: { ...local }, session: {} };

  /* chrome.storage.get takes either a list of keys or an object of defaults,
     and the worker uses both spellings. */
  const area = which => ({
    async get(spec){
      const bag = store[which];
      if (Array.isArray(spec)) return Object.fromEntries(spec.filter(k => k in bag).map(k => [k, bag[k]]));
      if (spec && typeof spec === 'object')
        return Object.fromEntries(Object.entries(spec).map(([k, d]) => [k, k in bag ? bag[k] : d]));
      return { ...bag };
    },
    async set(patch){ Object.assign(store[which], patch) },
  });

  let listener = null;
  const tabs = [];
  const ctx = vm.createContext({
    console,
    setTimeout, clearTimeout,
    URL, TextDecoder,
    importScripts: (...files) => files.forEach(f => vm.runInContext(read(f), ctx)),
    chrome: {
      storage: { local: area('local'), session: area('session') },
      runtime: { onMessage: { addListener: fn => { listener = fn } } },
      tabs: { create: async o => { tabs.push(o); return { id: tabs.length } },
              remove: async () => {},
              onRemoved: { addListener: () => {} } },
    },
  });
  ctx.globalThis = ctx;
  vm.runInContext(read('background.js'), ctx);

  const ask = msg => new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('no reply to ' + msg.type)), 2000);
    listener(msg, { tab:{ id:7 } }, res => { clearTimeout(t); resolve(res) });
  });
  const channels = () => JSON.parse(store.local['hub.channels.v1'] || '[]');
  return { ask, store, channels };
}

const CATS = JSON.stringify([
  { id:'c1', name:'learning', color:'#A78BFA', platform:'youtube' },
  { id:'c2', name:'making',   color:'#E0A060', platform:'youtube', fav:true },
  { id:'c3', name:'friends',  color:'#F0A5D0', platform:'instagram' },
]);

console.log('\nwhat the button is told before it is clicked');
{
  const t = boot({ 'hub.cats.v1':CATS });
  const info = await t.ask({ type:'addInfo', url:'https://www.youtube.com/channel/UC9' });
  ok('a url it can read is known', info.known === true);
  ok('a channel that is not on the board says so', info.already === false);
  ok('and the youtube categories come back', info.cats.map(c => c.name).join(',') === 'making,learning',
     JSON.stringify(info.cats));
  ok('favourites first, which is the order every list you pick from uses',
     info.cats[0].id === 'c2');
  ok('a category is three fields and nothing else',
     Object.keys(info.cats[0]).join(',') === 'id,name,color', JSON.stringify(info.cats[0]));
}
{
  const t = boot({ 'hub.cats.v1':CATS, 'hub.ui.v1':JSON.stringify({ favFirst:false }) });
  const info = await t.ask({ type:'addInfo', url:'https://www.youtube.com/channel/UC9' });
  ok('favFirst off hands back the manager’s own order',
     info.cats.map(c => c.name).join(',') === 'learning,making');
}
{
  const t = boot({ 'hub.cats.v1':CATS });
  const info = await t.ask({ type:'addInfo', url:'https://www.instagram.com/someone/' });
  ok('an instagram url is answered with the instagram board’s categories',
     info.cats.length === 1 && info.cats[0].name === 'friends', JSON.stringify(info.cats));
}
{
  const t = boot();
  const info = await t.ask({ type:'addInfo', url:'https://www.youtube.com/results?search_query=x' });
  ok('a url that names no channel is not known', info.known === false);
  ok('and still answers with a list rather than nothing', Array.isArray(info.cats));
}

console.log('\nfiling a channel from a video page');
{
  const t = boot({ 'hub.cats.v1':CATS });
  const res = await t.ask({ type:'addChannel', url:'https://www.youtube.com/@keep',
                            name:'Keep', cat:'c1' });
  ok('it is added', res.added === true && res.already === false);
  const [ch] = t.channels();
  ok('with the name the page gave', ch && ch.name === 'Keep');
  ok('under the category that was picked', ch && ch.cat === 'c1', ch && ch.cat);
  ok('on the board its url belongs to', ch && ch.platform === 'youtube');

  const again = await t.ask({ type:'addInfo', url:'https://www.youtube.com/@KEEP/videos' });
  ok('and the same channel, spelled another way, now reads as already on the board',
     again.already === true);
  const twice = await t.ask({ type:'addChannel', url:'https://www.youtube.com/@keep', name:'Keep' });
  ok('filing it a second time adds nothing', twice.already === true && t.channels().length === 1);
}
{
  const t = boot({ 'hub.cats.v1':CATS });
  await t.ask({ type:'addChannel', url:'https://www.youtube.com/@keep', name:'Keep', cat:'nonesuch' });
  ok('a category id that names nothing files the channel uncategorised, not nowhere',
     t.channels()[0].cat === '');
}
{
  const t = boot({ 'hub.cats.v1':CATS });
  await t.ask({ type:'addChannel', url:'https://www.youtube.com/@keep', name:'Keep', cat:'c3' });
  ok('and neither does the other board’s category', t.channels()[0].cat === '');
}
{
  const t = boot({ 'hub.cats.v1':CATS });
  const res = await t.ask({ type:'addChannel', url:'https://www.youtube.com/results?search_query=x' });
  ok('a url that names no channel is not filed', res.added === false && t.channels().length === 0);
}

console.log('\nthe setting the button is behind');
{
  const t = boot();
  const s = await t.ask({ type:'status' });
  ok('the add button on video pages is on unless it is turned off', s.addOnVideo === true);
}
{
  const t = boot({ 'hub.ui.v1':JSON.stringify({ addOnVideo:false }) });
  const s = await t.ask({ type:'status' });
  ok('and off when it is', s.addOnVideo === false);
}

console.log('\n' + pass + ' passed, ' + fails.length + ' failed');
if (fails.length){ fails.forEach(f => console.log('  - ' + f)); process.exit(1) }
