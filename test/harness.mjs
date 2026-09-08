// HUB boot + behaviour harness (jsdom).
//   cd hub/test && npm install && node harness.mjs [path-to-hub]
// Boots the real index.html with the scripts read from disk — stylesheets and
// fonts are skipped, because jsdom neither lays out nor paints — then drives
// the app through DOM events. Same shape as root/test/harness.mjs, and the
// same rule: a behaviour that has a check here does not silently come back.
import { JSDOM, ResourceLoader, VirtualConsole } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP  = path.resolve(process.argv[2] || path.join(HERE, '..'));
const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');

class LocalLoader extends ResourceLoader {
  fetch(url) {
    const u = new URL(url);
    if (u.hostname === 'localhost' && u.pathname.endsWith('.js'))
      return Promise.resolve(fs.readFileSync(path.join(APP, u.pathname.replace(/^\/hub\//, ''))));
    return Promise.resolve(Buffer.from(''));    // css, fonts, favicon: nothing to run
  }
}

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => errors.push('jsdomError: ' + (e.detail?.message || e.message)));
vc.on('error', (...a) => errors.push('console.error: ' + a.map(String).join(' ')));

// Nothing in HUB may reach a system dialog — one of them freezes the page and
// takes the board with it. Counted here, asserted at the bottom.
let systemDialogs = 0;

const dom = new JSDOM(html, {
  url: 'http://localhost/hub/index.html',
  runScripts: 'dangerously',
  resources: new LocalLoader(),
  pretendToBeVisual: true,
  virtualConsole: vc,
  beforeParse(w) {
    w.matchMedia = () => ({ matches:false, addEventListener(){}, removeEventListener(){}, addListener(){} });
    w.confirm = () => { systemDialogs++; return true };
    w.alert   = () => { systemDialogs++ };
    w.prompt  = () => { systemDialogs++; return '' };
    // jsdom has no Web Animations. The FLIP and the exit fade both call it, so
    // it has to exist and it has to resolve, or a removed card never leaves.
    w.Element.prototype.animate = function () {
      return { finished: Promise.resolve(), cancel(){}, finish(){}, onfinish:null };
    };
  },
});

const w = dom.window, d = w.document;
await new Promise(r => w.addEventListener('load', r));
// store.js declares Store with const, so it is a script-scoped lexical binding
// and never a window property. eval runs in that same scope; this is the only
// way in from outside, and it is the harness reaching in, not the app leaking.
w.eval('window.Store = Store');
// Since v0.3.0 the store may have to be read out of chrome.storage, so it
// resolves a promise before the first render. Off disk that is a microtask,
// but waiting on it is what the app itself does.
await w.eval('Store.ready');
// target=_blank would raise "Not implemented: navigation" on every card click.
d.addEventListener('click', e => { const a = e.target.closest?.('a'); if (a) e.preventDefault() }, true);

const $  = s => d.querySelector(s);
const $$ = s => [...d.querySelectorAll(s)];
const click = el => el.dispatchEvent(new w.MouseEvent('click', { bubbles:true, cancelable:true }));
const submit = f => f.dispatchEvent(new w.Event('submit', { bubbles:true, cancelable:true }));
const set = (el, v) => { el.value = v; el.dispatchEvent(new w.Event('input', { bubbles:true })) };
const tick = () => new Promise(r => setTimeout(r, 0));

let pass = 0; const fails = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('  ok   ' + name) }
  else { fails.push(name + (detail ? ' — ' + detail : '')); console.log('  FAIL ' + name + (detail ? ' — ' + detail : '')) }
};

console.log('\nboot');
ok('the page boots with no errors', errors.length === 0, errors[0]);
ok('five default categories are seeded', w.Store.cats().length === 5,
   JSON.stringify(w.Store.cats().map(c => c.name)));
ok('the board starts empty', w.Store.channels().length === 0);
ok('the empty state is showing', !$('#empty').hidden);
ok('every default category has a colour', w.Store.cats().every(c => /^#[0-9a-f]{6}$/i.test(c.color)));

console.log('\nadding a channel');
const cats = w.Store.cats();
click($('#btn-add'));
await tick();
ok('the sheet opened on the channel pane', !$('#sheet-ch').hidden);
ok('and the other panes stayed shut', $('#sheet-cat').hidden && $('#sheet-set').hidden);
ok('no system dialog was reached', systemDialogs === 0);

$('#c-url').value  = 'youtube.com/@veritasium';
$('#c-desc').value = 'physics and engineering explainers';
click([...$('#c-cat').children].find(b => b.textContent === cats[0].name));
submit($('#f-ch'));
await tick();

let chans = w.Store.channels();
ok('the channel was stored', chans.length === 1);
ok('a bare url is normalised to https', chans[0].url === 'https://youtube.com/@veritasium', chans[0].url);
ok('a blank name is taken from the url', chans[0].name === '@veritasium', chans[0].name);
ok('the chosen category stuck', chans[0].cat === cats[0].id);
ok('it survives a reload (localStorage)',
   JSON.parse(w.localStorage.getItem('hub.channels.v1')).length === 1);
ok('a card is on the board', $$('#grid .card').length === 1);
ok('the card is a real link to the channel',
   $('#grid .card .card-hit').getAttribute('href') === 'https://youtube.com/@veritasium');
ok('the description is on the card',
   $('#grid .card .card-desc').textContent === 'physics and engineering explainers');
ok('the category tag is on the card', $('#grid .card .tag').textContent === cats[0].name);
ok('the card carries the category colour',
   $('#grid .card').style.getPropertyValue('--c') === cats[0].color);
ok('the empty state is gone', $('#empty').hidden);

console.log('\ntime since last viewed');
ok('a new channel reads as never viewed', $('#grid .card .b-seen').textContent === 'never');
click($('#grid .card .card-hit'));
await tick();
ok('clicking the card stamps a view', typeof w.Store.channels()[0].seen === 'number');
ok('the card now reads just now', $('#grid .card .b-seen').textContent === 'just now');
ok('the stamp was persisted',
   JSON.parse(w.localStorage.getItem('hub.channels.v1'))[0].seen !== null);

console.log('\nsorting and filtering');
// two more channels, planted directly so the timestamps are controllable
w.Store.addChannel({ url:'https://youtube.com/@aardvark', name:'aardvark', desc:'first alphabetically', cat:cats[1].id });
w.Store.addChannel({ url:'https://youtube.com/@zulu',     name:'zulu',     desc:'last alphabetically',  cat:'' });
const all = w.Store.channels();
all[1].seen = Date.now() - 40 * 24 * 3600e3;      // 40 days ago
w.Store.updateChannel(all[1].id, {});             // write the mutation through
click($('#btn-cats')); click($('#sheet-cat [data-close]'));   // close whatever is open
$('#sort').value = 'name'; $('#sort').dispatchEvent(new w.Event('change', { bubbles:true }));
await tick();

const names = () => $$('#grid .card .card-name').map(e => e.textContent);
ok('sort by name orders A to Z', names().join() === 'aardvark,@veritasium,zulu', names().join());

$('#sort').value = 'seen'; $('#sort').dispatchEvent(new w.Event('change', { bubbles:true }));
await tick();
ok('sort by last viewed puts the newest view first', names()[0] === '@veritasium', names().join());
ok('never-viewed sorts to the end of last viewed', names()[2] === 'zulu', names().join());

$('#sort').value = 'stale'; $('#sort').dispatchEvent(new w.Event('change', { bubbles:true }));
await tick();
ok('longest unwatched puts never-viewed first', names()[0] === 'zulu', names().join());
ok('longest unwatched puts the freshest last', names()[2] === '@veritasium', names().join());
ok('the sort choice is remembered', JSON.parse(w.localStorage.getItem('hub.ui.v1')).sort === 'stale');

set($('#q'), 'alphabetically');
await tick();
ok('search matches on description', $$('#grid .card').length === 2, names().join());
set($('#q'), 'aard');
await tick();
ok('search matches on name', names().join() === 'aardvark');
set($('#q'), '');
await tick();
ok('clearing the search restores the board', $$('#grid .card').length === 3);

const chip = [...$('#chips').children].find(c => c.textContent.startsWith(cats[1].name));
click(chip);
await tick();
ok('a category chip filters the board', names().join() === 'aardvark', names().join());
ok('the header says how many are shown', /1 shown/.test($('#meta').textContent), $('#meta').textContent);
click([...$('#chips').children].find(c => c.textContent === 'all'));
await tick();
ok('all clears the filter', $$('#grid .card').length === 3);

const loose = [...$('#chips').children].find(c => c.textContent.startsWith('uncategorised'));
ok('an uncategorised chip appears when something is uncategorised', !!loose);
click(loose); await tick();
ok('the uncategorised chip filters to it', names().join() === 'zulu', names().join());
click(loose); await tick();

console.log('\ncard size');
click($$('#size .seg-b').find(b => b.dataset.size === 'l'));
await tick();
ok('the size control moves the grid minimum', $('#grid').dataset.size === 'l');
ok('the size choice is remembered', JSON.parse(w.localStorage.getItem('hub.ui.v1')).size === 'l');

console.log('\ncategories');
click($('#btn-cats'));
await tick();
ok('the category pane opens', !$('#sheet-cat').hidden);
ok('and it is a different pane from the channel one', $('#sheet-ch').hidden);
ok('every category has a row', $$('#cat-list .cat-r').length === 5);

const row = $$('#cat-list .cat-r')[1];
const swatch = row.querySelectorAll('.sw')[4];
click(swatch);
await tick();
ok('picking a swatch recolours the category',
   w.Store.cats()[1].color === w.Store.PALETTE[4], w.Store.cats()[1].color);
ok('the card behind the sheet took the new colour',
   $$('#grid .card').find(c => c.querySelector('.card-name').textContent === 'aardvark')
     .style.getPropertyValue('--c') === w.Store.PALETTE[4]);

const nameInput = $$('#cat-list .cat-r')[1].querySelector('.cat-n');
nameInput.value = 'renamed';
nameInput.dispatchEvent(new w.Event('change', { bubbles:true }));
await tick();
ok('a category can be renamed in place', w.Store.cats()[1].name === 'renamed');
ok('the rename shows on the card',
   $$('#grid .card').find(c => c.querySelector('.card-name').textContent === 'aardvark')
     .querySelector('.tag').textContent === 'renamed');

$('#n-name').value = 'brand new';
submit($('#f-newcat'));
await tick();
ok('a new category can be added', w.Store.cats().length === 6);
ok('the new category appears as a filter chip',
   [...$('#chips').children].some(c => c.textContent.startsWith('brand new')));

// deleting: first click arms, second does it, and the channel must survive
const del = $$('#cat-list .cat-r')[1].querySelector('.cat-x');
click(del);
ok('the first delete click only arms the button',
   del.classList.contains('armed') && w.Store.cats().length === 6);
ok('still no system dialog', systemDialogs === 0);
click(del);
await tick();
ok('the second click deletes the category', w.Store.cats().length === 5);
ok('its channel survives, uncategorised',
   w.Store.channels().some(c => c.name === 'aardvark' && !c.cat));
ok('the card reads uncategorised',
   $$('#grid .card').find(c => c.querySelector('.card-name').textContent === 'aardvark')
     .querySelector('.tag').textContent === 'uncategorised');

console.log('\nediting a channel');
const card = $$('#grid .card').find(c => c.querySelector('.card-name').textContent === 'zulu');
click(card.querySelector('.card-edit'));
await tick();
ok('the edit sheet opens on that channel', $('#c-name').value === 'zulu');
ok('the delete button is offered when editing', !$('#c-del').hidden);
$('#c-name').value = 'zulu renamed';
submit($('#f-ch'));
await tick();
ok('the edit is saved', w.Store.channels().some(c => c.name === 'zulu renamed'));
ok('the pane closed', $('#sheet-ch').hidden || $('#sheet-ch').classList.contains('out'));

click($$('#grid .card').find(c => c.querySelector('.card-name').textContent === 'zulu renamed')
        .querySelector('.card-edit'));
await tick();
click($('#c-del'));
ok('deleting a channel also takes two clicks', w.Store.channels().length === 3);
click($('#c-del'));
await tick();
ok('the second click deletes it', w.Store.channels().length === 2);

console.log('\nclick heat');
{
  const chans = w.Store.channels();
  const hot = chans.find(c => c.name === 'aardvark');
  const cold = chans.find(c => c.name !== 'aardvark');
  w.Store.touch(hot.id); w.Store.touch(hot.id); w.Store.touch(hot.id);
  /* cold already has exactly one open: its card was clicked back in the
     "time since last viewed" section, which is what put a stamp on it. */
  await tick();

  $('#sort').value = 'clicks'; $('#sort').dispatchEvent(new w.Event('change', { bubbles:true }));
  await tick();
  ok('most clicked sorts the most opened first',
     $$('#grid .card .card-name').map(e => e.textContent)[0] === 'aardvark');
  /* A badge that is switched off is not on the card at all now, rather than on
     it and hidden. Its text is checked in the settings section, once it is on. */
  ok('a badge that is off is not in the card',
     !$('#grid .card .b-count'));

  /* jsdom serialises rgb() without the spaces a browser keeps, so the two are
     compared with whitespace out of the way rather than by exact string. */
  const rgb = s => s.replace(/\s+/g, '');
  const heatOf = name => rgb($$('#grid .card')
    .find(c => c.querySelector('.card-name').textContent === name)
    .style.getPropertyValue('--heat'));
  ok('the hottest card sits at the top of the gradient',
     heatOf('aardvark') === rgb('rgb(167, 139, 250)'), heatOf('aardvark'));
  ok('a colder card does not', heatOf('aardvark') !== heatOf(cold.name));
}

console.log('\nsettings');
click($('#btn-set'));
await tick();
ok('the settings pane opens', !$('#sheet-set').hidden);
ok('and it is its own pane', $('#sheet-ch').hidden && $('#sheet-cat').hidden);

ok('the controls are built from the list', $$('#set-body .set-r').length > 10,
   String($$('#set-body .set-r').length));
ok('and grouped into sections', $$('#set-body .set-h').length >= 3);

ok('click counts are off by default', !$('#grid .card .b-count'));
click($('#set-body [data-k="showCounts"]'));
await tick();
ok('the toggle puts the badge on the card', !!$('#grid .card .b-count'));
ok('and it is remembered', JSON.parse(w.localStorage.getItem('hub.ui.v1')).showCounts === true);
ok('the count reads right',
   $$('#grid .card').find(c => c.querySelector('.card-name').textContent === 'aardvark')
     .querySelector('.b-count').textContent === '3 opens',
   $('#grid .card .b-count').textContent);
ok('one open is not "1 opens"',
   $$('#grid .card').find(c => c.querySelector('.card-name').textContent !== 'aardvark')
     .querySelector('.b-count').textContent === '1 open');

click($('#set-body [data-k="showHeat"]'));
await tick();
ok('the heat line can be turned off', $('#grid').classList.contains('no-heat'));
click($('#set-body [data-k="showHeat"]'));
await tick();

set($('#s-heat-to'), '#ff0000');
await tick();
ok('the gradient can be recoloured',
   $$('#grid .card').find(c => c.querySelector('.card-name').textContent === 'aardvark')
     .style.getPropertyValue('--heat').replace(/\s+/g, '') === 'rgb(255,0,0)');
ok('and that is remembered too', JSON.parse(w.localStorage.getItem('hub.ui.v1')).heatTo === '#ff0000');

const chipNames = () => [...$('#chips').children].map(c => c.textContent);
const emptyCat = w.Store.cats().find(c => w.Store.countIn(c.id) === 0);
ok('an empty category is in the bar to begin with',
   chipNames().some(t => t.startsWith(emptyCat.name)));
click($('#set-body [data-k="hideEmpty"]'));
await tick();
ok('hide empty keeps it out of the bar', !chipNames().some(t => t.startsWith(emptyCat.name)));
ok('categories that hold something stay', chipNames().length > 1, chipNames().join());
click($('#set-body [data-k="hideEmpty"]'));
await tick();
click($('#sheet-set [data-close]'));
await tick();

console.log('\nordering and colouring categories');
click($('#btn-cats'));
await tick();
{
  const before = w.Store.cats().map(c => c.name);
  const row = $$('#cat-list .cat-r')[2];
  click(row.querySelectorAll('.cat-mv')[0]);          // up
  await tick();
  const after = w.Store.cats().map(c => c.name);
  ok('a category can be moved up', after[1] === before[2] && after[2] === before[1],
     after.join());
  ok('the order is persisted',
     JSON.parse(w.localStorage.getItem('hub.cats.v1'))[1].name === before[2]);
  ok('the filter bar follows it',
     [...$('#chips').children][2].textContent.startsWith(after[1]));

  ok('the first row cannot move up', $$('#cat-list .cat-r')[0].querySelectorAll('.cat-mv')[0].disabled);
  ok('the last row cannot move down',
     [...$$('#cat-list .cat-r')].pop().querySelectorAll('.cat-mv')[1].disabled);
}
{
  const c = w.Store.cats()[0];
  const any = $$('#cat-list .cat-r')[0].querySelector('.sw-any input[type="color"]');
  ok('there is a colour well beside the ten swatches', !!any);
  set(any, '#123456');
  await tick();
  ok('a category can take a colour that is not in the palette',
     w.Store.cat(c.id).color === '#123456', w.Store.cat(c.id).color);
  ok('and the board takes it',
     !!$$('#grid .card').find(el => el.style.getPropertyValue('--c') === '#123456')
     || w.Store.countIn(c.id) === 0);
}
click($('#sheet-cat [data-close]'));
await tick();

console.log('\ncategory icons');
click($('#btn-cats'));
await tick();
{
  const c = w.Store.cats()[0];
  const row = $$('#cat-list .cat-r')[0];
  const ib = row.querySelector('.cat-ico');
  ok('every row has an icon button', !!ib);
  ok('and it starts with no icon', ib.textContent.trim() === '\u2014');

  click(ib);
  await tick();
  const grid = $('#cat-list .icon-grid');
  ok('clicking it opens the grid under that row', !!grid);
  ok('twenty icons plus none', grid.querySelectorAll('.ic-b').length === 21,
     String(grid && grid.querySelectorAll('.ic-b').length));
  ok('only one grid is ever open', $$('#cat-list .icon-grid').length === 1);

  click(grid.querySelectorAll('.ic-b')[3]);      // none, play, music, code
  await tick();
  ok('picking one sets the icon', w.Store.cat(c.id).icon === 'code', w.Store.cat(c.id).icon);
  ok('and closes the grid', !$('#cat-list .icon-grid'));
  ok('the choice is persisted',
     JSON.parse(w.localStorage.getItem('hub.cats.v1'))[0].icon === 'code');

  ok('the icon reaches the filter chip',
     !![...$('#chips').children].find(el => el.textContent.startsWith(c.name))
       .querySelector('svg.ico'));

  const carded = $$('#grid .card').find(el => el.querySelector('.tag').textContent.includes(c.name));
  if (carded) ok('and the card it names', !!carded.querySelector('.tag svg.ico'));
  else ok('and the card it names (none on the board to check)', true);

  click($('#cat-list .cat-r .cat-ico'));
  await tick();
  click($('#cat-list .icon-grid .ic-b')[0] || $('#cat-list .icon-grid .ic-b'));
  await tick();
  ok('no icon can be chosen again', w.Store.cat(c.id).icon === '');
}
click($('#sheet-cat [data-close]'));
await tick();

console.log('\nquick categorise');
{
  const card = $$('#grid .card')[0];
  const id = card.dataset.id;
  const target = w.Store.cats()[1];

  click(card.querySelector('.tag'));
  await tick();
  ok('clicking a card\u2019s tag opens the menu', !$('#qmenu').hidden);
  ok('with every category plus uncategorised',
     $$('#qmenu .qi').length === w.Store.cats().length + 1);
  ok('and it marks the one it is in now', $$('#qmenu .qi.on').length === 1);

  click([...$('#qmenu').children].find(b => b.textContent.includes(target.name)));
  await tick();
  ok('picking one files the channel',
     w.Store.channels().find(c => c.id === id).cat === target.id);
  ok('the menu closes behind it', $('#qmenu').hidden);
  ok('and the card says so',
     $$('#grid .card').find(el => el.dataset.id === id).querySelector('.tag')
       .textContent.includes(target.name));
  ok('the edit pane was never opened', $('#sheet-ch').hidden);

  const card2 = $$('#grid .card')[0];
  click(card2.querySelector('.tag'));
  await tick();
  ok('the menu opens again', !$('#qmenu').hidden);
  click(card2.querySelector('.tag'));
  await tick();
  ok('clicking the same tag shuts it', $('#qmenu').hidden);
}

console.log('\ncontent width');
click($('#btn-set'));
await tick();
{
  const root = d.documentElement;
  const wOut = () => $('#set-body [data-k="maxWidth"] output').textContent;
  ok('the slider shows the current width', wOut() === '1560px', wOut());
  set($('#s-maxWidth'), '1200');
  await tick();
  ok('moving it narrows the board', root.style.getPropertyValue('--app-w') === '1200px');
  ok('and the label follows', wOut() === '1200px');
  ok('it is remembered', JSON.parse(w.localStorage.getItem('hub.ui.v1')).maxWidth === 1200);

  set($('#s-maxWidth'), '2600');
  await tick();
  ok('the top of the range is the whole window', root.style.getPropertyValue('--app-w') === 'none');
  ok('and says so', wOut() === 'full width');
  ok('stored as 0, not as a number that is only nearly full',
     JSON.parse(w.localStorage.getItem('hub.ui.v1')).maxWidth === 0);
  set($('#s-maxWidth'), '1560');
  await tick();
}

console.log('\nexport and import');
{
  const before = w.Store.channels().length;
  const text = w.Store.exportJSON();
  const parsed = JSON.parse(text);
  ok('an export is a hub export', parsed.kind === 'hub.export' && parsed.version === 2,
     String(parsed.version));
  ok('and carries all four', Array.isArray(parsed.channels) && Array.isArray(parsed.cats)
     && !!parsed.ui && Array.isArray(parsed.queue));
  ok('with everything on the board', parsed.channels.length === before);

  w.Store.removeChannel(w.Store.channels()[0].id);
  ok('something was lost', w.Store.channels().length === before - 1);

  const out = w.Store.importJSON(text);
  ok('importing gives it back', !!out && w.Store.channels().length === before);
  ok('and says what it restored', out.channels === before);
  ok('it lands in storage, not only in memory',
     JSON.parse(w.localStorage.getItem('hub.channels.v1')).length === before);

  ok('junk is refused', w.Store.importJSON('{"hello":1}') === null);
  ok('so is a json file that is not ours',
     w.Store.importJSON(JSON.stringify({ channels:[], cats:[] })) === null);
  ok('and nothing was touched by either', w.Store.channels().length === before);
}
click($('#sheet-set [data-close]'));
await tick();

console.log('\n avatars and what is new');
{
  const ch = w.Store.channels()[0];
  w.Store.enrich(ch.id, { ytId:'UC9', avatar:'https://yt3.example/a.jpg',
                          latest:{ videoId:'v1', title:'A new one', at:Date.now() } });
  /* Store.enrich is the extension writing through, not a click, so nothing has
     asked the board to redraw yet. Touching the search box is the cheapest
     honest way to ask for one. */
  set($('#q'), '');
  await tick();
  const card = $$('#grid .card').find(el => el.dataset.id === ch.id);
  ok('the avatar lands on the card', card.querySelector('.av').classList.contains('has'));
  ok('with the url it was given',
     card.querySelector('.av img').getAttribute('src') === 'https://yt3.example/a.jpg');
  ok('a channel posted since you looked reads as new', card.classList.contains('is-new'));
  ok('and the dot says what it is', card.querySelector('.new').title === 'A new one');

  w.Store.touch(ch.id);
  set($('#q'), '');
  await tick();
  ok('opening it clears the new mark',
     !$$('#grid .card').find(el => el.dataset.id === ch.id).classList.contains('is-new'));

  const other = w.Store.channels().find(c => c.id !== ch.id);
  ok('a channel with nothing fetched is not new', w.Store.isNew(other) === false);
}
click($('#btn-set'));
await tick();
click($('#set-body [data-k="showAvatars"]'));
await tick();
ok('avatars can be turned off', $('#grid').classList.contains('no-avatar'));
click($('#set-body [data-k="showAvatars"]'));
await tick();
click($('#set-body [data-k="showNew"]'));
await tick();
ok('so can the new dot', $('#grid').classList.contains('no-new'));
click($('#set-body [data-k="showNew"]'));
await tick();

ok('the accent is a real token', !!$('#set-body [data-k="accent"] input[type="color"]'));
set($('#s-accent'), '#00ff00');
await tick();
ok('changing it moves the whole system', d.documentElement.style.getPropertyValue('--y') === '#00ff00');
set($('#s-radius'), '10');
await tick();
ok('so does the corner radius', d.documentElement.style.getPropertyValue('--r-base') === '10px');
set($('#s-descLines'), '2');
await tick();
ok('and the description clamp', d.documentElement.style.getPropertyValue('--desc-lines') === '2');
click($('#set-body [data-k="avatarShape"] .seg-b[data-v="square"]'));
await tick();
ok('the avatar shape is a choice', $('#grid').dataset.avatar === 'square');
click($('#sheet-set [data-close]'));
await tick();

console.log('\n enter opens the first result');
{
  const names = $$('#grid .card .card-name').map(e => e.textContent);
  set($('#q'), names[0].slice(0, 4));
  await tick();
  const first = $('#grid .card');
  let opened = 0;
  first.querySelector('.card-hit').addEventListener('click', () => { opened++ });
  $('#q').dispatchEvent(new w.KeyboardEvent('keydown', { key:'Enter', bubbles:true, cancelable:true }));
  await tick();
  ok('enter opens the top card', opened === 1);
  set($('#q'), '');
  await tick();
}

console.log('\n the queue');
{
  ok('the queue starts empty', w.Store.queue().length === 0);
  w.Store.enqueue({ videoId:'v1', url:'https://www.youtube.com/watch?v=v1',
                    title:'Something to watch', channel:'@keep' });
  w.Store.enqueue({ videoId:'v2', url:'https://www.youtube.com/watch?v=v2', title:'Another' });
  ok('two go in', w.Store.queue().length === 2);
  ok('the same video twice does not',
     w.Store.enqueue({ videoId:'v1', url:'x', title:'dupe' }) === null && w.Store.queue().length === 2);
  ok('newest is first', w.Store.queue()[0].videoId === 'v2');
  set($('#q'), '');
  await tick();
  ok('the bar shows the count', $('#q-n').textContent === '2', $('#q-n').textContent);

  click($('#btn-q'));
  await tick();
  ok('the queue pane opens', !$('#sheet-q').hidden);
  ok('with a row each', $$('#q-list .q-r').length === 2);
  ok('and the title on it', $$('#q-list .q-t')[0].textContent === 'Another');

  click($$('#q-list .cat-x')[0]);
  await tick();
  ok('a row can be dropped', w.Store.queue().length === 1);
  click($('#q-clear'));
  ok('clear takes two clicks', w.Store.queue().length === 1);
  click($('#q-clear'));
  await tick();
  ok('and then empties it', w.Store.queue().length === 0);
  ok('the pane says so', !!$('#q-list .q-empty'));
  click($('#sheet-q [data-close]'));
  await tick();
}

console.log('\nthe colour picker staying open');
click($('#btn-cats'));
await tick();
{
  const well = $('#cat-list .cat-r .sw-any input[type="color"]');
  ok('a category row has a colour well', !!well);

  /* The bug: a native colour dialog fires input on every drag, and the row
     redrew itself on the first one - replacing the element the dialog belonged
     to, which shut it. Nothing on screen may be rebuilt while it is open, so
     the same element has to still be there afterwards. */
  well.value = '#112233';
  well.dispatchEvent(new w.Event('input', { bubbles:true }));
  await tick();
  ok('the well is still the same element after an input',
     $('#cat-list .cat-r .sw-any input[type="color"]') === well);
  ok('and it kept its value', well.value === '#112233');
  ok('the colour was applied anyway', w.Store.cats()[0].color === '#112233',
     w.Store.cats()[0].color);

  well.value = '#445566';
  well.dispatchEvent(new w.Event('change', { bubbles:true }));
  await tick();
  ok('closing the dialog commits', w.Store.cats()[0].color === '#445566');

  const preset = $$('#cat-list .cat-r .sw')[2];
  preset.dispatchEvent(new w.MouseEvent('click', { bubbles:true }));
  await tick();
  ok('a preset swatch still redraws the row', w.Store.cats()[0].color === w.Store.PALETTE[2]);
}
click($('#sheet-cat [data-close]'));
await tick();

console.log('\ncategorise mode');
{
  const target = w.Store.cats()[3];
  const id = $$('#grid .card')[0].dataset.id;
  ok('the board is not in it to begin with', $('#catbar').hidden);

  click($('#btn-catmode'));
  await tick();
  ok('the toggle opens the strip', !$('#catbar').hidden);
  ok('and the page says which mode it is in', d.documentElement.classList.contains('cat-mode'));
  ok('every category is offered, plus uncategorised',
     $$('#cb-pick .chip').length === w.Store.cats().length + 1);
  ok('one is already chosen', $$('#cb-pick .chip.on').length === 1);

  click([...$('#cb-pick').children].find(b => b.textContent.includes(target.name)));
  await tick();
  ok('picking one marks it', $('#cb-pick .chip.on').textContent.includes(target.name));

  const ev = new w.MouseEvent('click', { bubbles:true, cancelable:true });
  $$('#grid .card').find(el => el.dataset.id === id).querySelector('.card-hit').dispatchEvent(ev);
  await tick();
  ok('clicking a card files it', w.Store.channels().find(c => c.id === id).cat === target.id);
  ok('and does not open youtube', ev.defaultPrevented);

  d.dispatchEvent(new w.KeyboardEvent('keydown', { key:'Escape', bubbles:true }));
  await tick();
  ok('escape leaves the mode', $('#catbar').hidden);
  ok('and the page stops saying it', !d.documentElement.classList.contains('cat-mode'));

  /* defaultPrevented cannot say this: the harness itself cancels every anchor
     click so jsdom does not try to navigate. What a card being a link again
     actually means is that clicking it counts as an open and files nothing. */
  const after = $$('#grid .card')[0].dataset.id;
  const before = w.Store.channels().find(c => c.id === after);
  const cat0 = before.cat, clicks0 = before.clicks || 0;
  $$('#grid .card')[0].querySelector('.card-hit')
    .dispatchEvent(new w.MouseEvent('click', { bubbles:true, cancelable:true }));
  await tick();
  const now = w.Store.channels().find(c => c.id === after);
  ok('afterwards a card counts as an open again', (now.clicks || 0) === clicks0 + 1);
  ok('and files nothing', now.cat === cat0);
}

console.log('\nbadges, layout and presets');
click($('#btn-set'));
await tick();
{
  const ch = w.Store.channels()[0];
  w.Store.enrich(ch.id, { latest:{ videoId:'v9', title:'newest', at:Date.now() - 3 * 86400000 } });

  const on = k => click($('#set-body [data-k="' + k + '"]'));
  const badge = cls => $$('#grid .card .b-' + cls).length;

  on('showPosted'); await tick();
  ok('when it last posted can be shown', badge('posted') >= 1);
  ok('and reads as an age', /posted .*ago/.test($('#grid .card .b-posted').textContent),
     $('#grid .card .b-posted').textContent);

  on('showAdded'); await tick();
  ok('when you added it can be shown', badge('added') >= 1);
  on('showRank'); await tick();
  ok('its rank by clicks can be shown', badge('rank') >= 1);
  ok('and it is a number with a hash', /^#[0-9]+$/.test($('#grid .card .b-rank').textContent));
  on('showHandle'); await tick();
  ok('its handle can be shown', badge('handle') >= 1);

  on('showPosted'); on('showAdded'); on('showRank'); on('showHandle'); await tick();
  ok('and every one of them switches back off',
     badge('posted') + badge('added') + badge('rank') + badge('handle') === 0);
}
{
  click($('#set-body [data-k="layout"] .seg-b[data-v="list"]'));
  await tick();
  ok('the card shape is a setting', $('#grid').dataset.layout === 'list');
  click($('#set-body [data-k="badgePos"] .seg-b[data-v="top"]'));
  await tick();
  ok('so is where the badges sit', $('#grid').dataset.badges === 'top');
  click($('#set-body [data-k="avatarPos"] .seg-b[data-v="top"]'));
  await tick();
  /* dataset.avatarPos writes data-avatar-pos, not data-avatarPos. The
     stylesheet has to select the attribute that actually exists, so the
     attribute is what gets asserted here, not the property that set it. */
  ok('and the avatar', $('#grid').getAttribute('data-avatar-pos') === 'top');
  set($('#s-gap'), '20');
  await tick();
  ok('the space between cards is a dial',
     d.documentElement.style.getPropertyValue('--grid-gap') === '20px');
  set($('#s-nameLines'), '3');
  await tick();
  ok('so is how many lines the name gets',
     d.documentElement.style.getPropertyValue('--name-lines') === '3');
  set($('#s-avatarSize'), '44');
  await tick();
  ok('and the avatar size', d.documentElement.style.getPropertyValue('--av-size') === '44px');
  click($('#set-body [data-k="border"] .seg-b[data-v="none"]'));
  await tick();
  ok('the card edge is a choice', $('#grid').dataset.border === 'none');
  click($('#set-body [data-k="surface"] .seg-b[data-v="flat"]'));
  await tick();
  ok('so is its ground', $('#grid').dataset.surface === 'flat');

  ok('there are presets', $$('#set-body .presets .btn').length === 4);
  click($('#set-body .presets [data-preset="classic"]'));
  await tick();
  ok('one sets several dials at once',
     $('#grid').dataset.layout === 'card' && $('#grid').dataset.border === 'hairline'
     && $('#grid').dataset.surface === 'raised' && $('#grid').dataset.badges === 'bottom');
  ok('and it is stored, not just drawn',
     JSON.parse(w.localStorage.getItem('hub.ui.v1')).layout === 'card');
  click($('#set-body .presets [data-preset="poster"]'));
  await tick();
  ok('another sets different ones',
     $('#grid').dataset.avatarPos === 'top' && $('#grid').dataset.border === 'accent');
  click($('#set-body [data-k="border"] .seg-b[data-v="none"]'));
  await tick();
  ok('a dial moved afterwards is still yours', $('#grid').dataset.border === 'none');
  click($('#set-body .presets [data-preset="classic"]'));
  await tick();
}
click($('#sheet-set [data-close]'));
await tick();


console.log('\nthe dot, the avatar and the type sizes');
click($('#btn-set'));
await tick();
{
  const ch = w.Store.channels()[0];
  w.Store.enrich(ch.id, { avatar:'https://yt3.example/a.jpg',
                          latest:{ videoId:'vX', title:'fresh', at:Date.now() } });
  set($('#q'), '');
  await tick();

  click($('#set-body [data-k="newDotPos"] .seg-b[data-v="avatar"]'));
  await tick();
  ok('the dot can be moved', $('#grid').dataset.dot === 'avatar');
  set($('#s-newDotSize'), '11');
  await tick();
  ok('and sized', d.documentElement.style.getPropertyValue('--dot-size') === '11px');
  ok('it follows the accent to begin with',
     d.documentElement.style.getPropertyValue('--dot-c') === 'var(--y)');
  set($('#s-newDotColor'), '#ff8800');
  await tick();
  ok('and can be given its own colour',
     d.documentElement.style.getPropertyValue('--dot-c') === '#ff8800');
  click($('#set-body [data-k="newDotColor"] .btn'));
  await tick();
  ok('and handed back to the accent',
     d.documentElement.style.getPropertyValue('--dot-c') === 'var(--y)');

  click($('#set-body [data-k="avatarShape"] .seg-b[data-v="rounded"]'));
  await tick();
  ok('there is a third avatar shape', $('#grid').dataset.avatar === 'rounded');
  click($('#set-body [data-k="avatarBorder"] .seg-b[data-v="accent"]'));
  await tick();
  ok('the avatar can take an edge',
     $('#grid').getAttribute('data-avatar-border') === 'accent');
  click($('#set-body [data-k="nameAlign"] .seg-b[data-v="top"]'));
  await tick();
  ok('the name can sit at the top of the picture instead of level with it',
     $('#grid').getAttribute('data-name-align') === 'top');
  click($('#set-body [data-k="nameAlign"] .seg-b[data-v="center"]'));
  await tick();

  set($('#s-nameSize'), '21');
  await tick();
  ok('the name has a size', d.documentElement.style.getPropertyValue('--name-px') === '21px');
  set($('#s-descSize'), '11');
  await tick();
  ok('so does the description', d.documentElement.style.getPropertyValue('--desc-px') === '11px');
  set($('#s-badgeSize'), '12');
  await tick();
  ok('and the badges', d.documentElement.style.getPropertyValue('--badge-px') === '12px');
  set($('#s-titleSize'), '40');
  await tick();
  ok('and the wordmark', d.documentElement.style.getPropertyValue('--title-px') === '40px');
}
{
  ok('the count is a badge to begin with', !!$('#grid .card .b-count'));
  ok('and there is no number', $('#grid .card .card-n').hidden);

  click($('#set-body [data-k="countStyle"] .seg-b[data-v="number"]'));
  await tick();
  ok('the number mode says so on the grid', $('#grid').dataset.count === 'number');
  ok('the badge stands down', !$('#grid .card .b-count'));
  const n = $$('#grid .card').find(c => c.querySelector('.card-name').textContent === 'aardvark')
              .querySelector('.card-n');
  ok('the number is shown', !n.hidden);
  ok('and it is only a number', /^[0-9]+$/.test(n.textContent), n.textContent);
  ok('and it is that channel’s own count',
     n.textContent === String(w.Store.channels().find(c => c.name === 'aardvark').clicks),
     n.textContent);

  click($('#set-body [data-k="countStyle"] .seg-b[data-v="badge"]'));
  await tick();
  ok('and back to a badge', !!$('#grid .card .b-count') && $('#grid .card .card-n').hidden);
}
click($('#sheet-set [data-close]'));
await tick();

console.log('\nhidden really means hidden');
{
  /* A user-agent [hidden] rule loses to any class in the sheet that sets
     display, and most of what HUB hides also carries .btn or .catbar. jsdom
     does not apply the stylesheet, so this is checked as a fact about the file
     rather than as a computed style - which is still the fact that matters. */
  const css = fs.readFileSync(path.join(APP, 'css', 'hub.css'), 'utf8');
  const rule = css.indexOf('[hidden]{display:none !important}');
  ok('the sheet forces hidden to win', rule > -1);
  ok('and does it before anything that sets display',
     rule > -1 && rule < css.indexOf('display:flex'));
}

console.log('\nkeys');
d.dispatchEvent(new w.KeyboardEvent('keydown', { key:'n', bubbles:true }));
await tick();
ok('n opens a new channel', !$('#sheet-ch').hidden && $('#c-url').value === '');
d.dispatchEvent(new w.KeyboardEvent('keydown', { key:'Escape', bubbles:true }));
await tick();
ok('escape closes the pane', $('#sheet-ch').hidden || $('#sheet-ch').classList.contains('out'));

console.log('\nsummary');
ok('no system dialog was reached at any point', systemDialogs === 0, systemDialogs + ' calls');
ok('no errors on the console', errors.length === 0, errors.join(' | '));

w.close();
console.log('\n' + pass + ' passed, ' + fails.length + ' failed');
if (fails.length){ fails.forEach(f => console.log('  - ' + f)); process.exit(1) }
