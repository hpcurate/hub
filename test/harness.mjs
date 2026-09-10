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
   $('#grid .card .card-hit').getAttribute('href') === 'https://youtube.com/@veritasium/videos',
   $('#grid .card .card-hit').getAttribute('href'));
ok('and it lands on the videos tab, not the home page',
   $('#grid .card .card-hit').getAttribute('href').endsWith('/videos'));
ok('the stored url is untouched by that', w.Store.channels()[0].url === 'https://youtube.com/@veritasium');
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
  ok('and the dot says what it is and what clicking does',
     card.querySelector('.new').title === 'A new one — click to clear');

  w.Store.touch(ch.id);
  set($('#q'), '');
  await tick();
  ok('opening it clears the new mark',
     !$$('#grid .card').find(el => el.dataset.id === ch.id).classList.contains('is-new'));

  const other = w.Store.channels().find(c => c.id !== ch.id);
  ok('a channel with nothing fetched is not new', w.Store.isNew(other) === false);
}
click($('#btn-card'));
await tick();
click($('#card-body [data-k="slot-avatar"] .part-sw'));
await tick();
ok('avatars can be turned off', $('#grid').classList.contains('no-avatar'));
click($('#card-body [data-k="slot-avatar"] .part-sw'));
await tick();
click($('#card-body [data-k="slot-dot"] .part-sw'));
await tick();
ok('so can the new dot', $('#grid').classList.contains('no-new'));
click($('#card-body [data-k="slot-dot"] .part-sw'));
await tick();
click($('#sheet-card [data-close]'));
await tick();

click($('#btn-set'));
await tick();
ok('the accent is a real token', !!$('#set-body [data-k="accent"] input[type="color"]'));
set($('#s-accent'), '#00ff00');
await tick();
ok('changing it moves the whole system', d.documentElement.style.getPropertyValue('--y') === '#00ff00');
set($('#s-radius'), '10');
await tick();
ok('so does the corner radius', d.documentElement.style.getPropertyValue('--r-base') === '10px');
click($('#sheet-set [data-close]'));
await tick();

click($('#btn-card'));
await tick();
set($('#s-descLines'), '2');
await tick();
ok('and the description clamp', d.documentElement.style.getPropertyValue('--desc-lines') === '2');
click($('#card-body [data-k="avatarShape"] .seg-b[data-v="square"]'));
await tick();
ok('the avatar shape is a choice', $('#grid').dataset.avatar === 'square');
click($('#sheet-card [data-close]'));
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
click($('#sheet-set [data-close]'));
await tick();


console.log('\nthe card editor');
click($('#btn-card'));
await tick();
{
  ok('the card editor is its own pane', !$('#sheet-card').hidden && $('#sheet-set').hidden);
  ok('and it holds a real card, built by the board',
     !!$('#card-prev .card') && !!$('#card-prev .card .card-name'));
  ok('a row for every part there is',
     $$('#card-body .set-part').length === w.HubModel.PARTS.length,
     String($$('#card-body .set-part').length));
  ok('and a nine-cell placement grid for each element',
     $$('#card-body [data-k="slot-name"] .zone-map .zc').length === 9);

  click($('#card-body [data-k="layout"] .seg-b[data-v="list"]'));
  await tick();
  ok('the card shape is a setting', $('#grid').dataset.layout === 'list');
  click($('#card-body [data-k="layout"] .seg-b[data-v="card"]'));
  await tick();

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
  click($('#card-body [data-k="border"] .seg-b[data-v="none"]'));
  await tick();
  ok('the card edge is a choice', $('#grid').dataset.border === 'none');
  click($('#card-body [data-k="surface"] .seg-b[data-v="flat"]'));
  await tick();
  ok('so is its ground', $('#grid').dataset.surface === 'flat');
}
{
  const name=$('#grid .card .card-name');
  ok('elements render inside the responsive card grid',name.parentElement.classList.contains('zone'));
  click($('#card-body [data-k="slot-name"] [data-z="mc"]'));
  await tick();
  ok('an element can move to any of the nine grid cells',
    $('#grid .card .card-name').closest('.zone').dataset.z==='mc' && w.Store.ui().slots.name==='mc');
  click($('#card-body [data-k="slot-name"] [data-z="tl"]'));
  await tick();

  click($('#card-body [data-k="slot-desc"] .part-sw'));
  await tick();
  ok('a part switched off leaves the card', !$('#grid .card .card-desc'));
  click($('#card-body [data-k="slot-desc"] .part-sw'));
  await tick();
  ok('and comes back', !!$('#grid .card .card-desc'));
}
{
  ok('there are presets', $$('#card-body .presets [data-preset]').length === 4);
  click($('#card-body .presets [data-preset="classic"]'));
  await tick();
  ok('one sets several dials at once',
     $('#grid').dataset.layout === 'card' && $('#grid').dataset.border === 'hairline'
     && $('#grid').dataset.surface === 'raised');
  ok('and it is stored, not just drawn',
     JSON.parse(w.localStorage.getItem('hub.ui.v1')).layout === 'card');
  click($('#card-body .presets [data-preset="poster"]'));
  await tick();
  ok('another sets different ones',
     $('#grid').dataset.border === 'accent' && w.Store.ui().avatarSize===52);
  click($('#card-body [data-k="border"] .seg-b[data-v="none"]'));
  await tick();
  ok('a dial moved afterwards is still yours', $('#grid').dataset.border === 'none');
  click($('#card-body .presets [data-preset="classic"]'));
  await tick();
}

console.log('\nthe dot, the avatar and the fresh card');
{
  const ch = w.Store.channels()[0];
  w.Store.enrich(ch.id, { avatar:'https://yt3.example/a.jpg',
                          latest:{ videoId:'vX', title:'fresh', at:Date.now() } });
  set($('#q'), '');
  await tick();

  set($('#s-newDotSize'), '11');
  await tick();
  ok('and sized', d.documentElement.style.getPropertyValue('--dot-size') === '11px');
  ok('it follows the accent to begin with',
     d.documentElement.style.getPropertyValue('--dot-c') === 'var(--y)');
  set($('#s-newDotColor'), '#ff8800');
  await tick();
  ok('and can be given its own colour',
     d.documentElement.style.getPropertyValue('--dot-c') === '#ff8800');
  click($('#card-body [data-k="newDotColor"] .btn'));
  await tick();
  ok('and handed back to the accent',
     d.documentElement.style.getPropertyValue('--dot-c') === 'var(--y)');

  click($('#card-body [data-k="avatarShape"] .seg-b[data-v="rounded"]'));
  await tick();
  ok('there is a third avatar shape', $('#grid').dataset.avatar === 'rounded');
  click($('#card-body [data-k="avatarBorder"] .seg-b[data-v="accent"]'));
  await tick();
  ok('the avatar can take an edge',
     $('#grid').getAttribute('data-avatar-border') === 'accent');
}
{
  /* ── Posted in the last day ────────────────────────────────────────────────
     A different fact from "new to you", and a different mark: the whole card,
     not a dot on it. It does not care whether the dot has been cleared. */
  const ch = w.Store.channels()[0];
  const cardOf = id => $$('#grid .card').find(el => el.dataset.id === id);
  w.Store.enrich(ch.id, { latest:{ videoId:'vF', title:'an hour ago', at:Date.now() - 3600e3 } });
  set($('#q'), '');
  await tick();
  ok('a channel that posted an hour ago lights its card',
     cardOf(ch.id).classList.contains('is-fresh'));

  w.Store.clearNew(ch.id);
  set($('#q'), '');
  await tick();
  ok('and clearing the dot does not put it out',
     cardOf(ch.id).classList.contains('is-fresh')
     && !cardOf(ch.id).classList.contains('is-new'));

  w.Store.enrich(ch.id, { latest:{ videoId:'vO', title:'last week', at:Date.now() - 8 * 86400000 } });
  set($('#q'), '');
  await tick();
  ok('last week does not', !cardOf(ch.id).classList.contains('is-fresh'));

  w.Store.enrich(ch.id, { latest:{ videoId:'vF2', title:'an hour ago', at:Date.now() - 3600e3 } });
  set($('#q'), '');
  await tick();
  set($('#s-freshHours'), '1');
  await tick();
  ok('how fresh is fresh is a dial', !cardOf(ch.id).classList.contains('is-fresh'));
  set($('#s-freshHours'), '24');
  await tick();
  click($('#card-body [data-k="showFresh"]'));
  await tick();
  ok('and it can be switched off altogether', $('#grid').classList.contains('no-fresh'));
  click($('#card-body [data-k="showFresh"]'));
  await tick();
}
{
  const aardvark = () => $$('#grid .card')
    .find(c => c.querySelector('.card-name').textContent === 'aardvark');
  ok('the count is a badge to begin with', !!$('#grid .card .b-count'));
  ok('and there is no number', !$('#grid .card .card-n'));

  click($('#card-body [data-k="countStyle"] .seg-b[data-v="number"]'));
  await tick();
  ok('the number mode says so on the grid', $('#grid').dataset.count === 'number');
  ok('the badge stands down', !$('#grid .card .b-count'));
  const n = aardvark().querySelector('.card-n');
  ok('the number is shown', !!n);
  ok('and it is only a number', /^[0-9]+$/.test(n.textContent), n.textContent);
  ok('and it is that channel’s own count',
     n.textContent === String(w.Store.channels().find(c => c.name === 'aardvark').clicks),
     n.textContent);

  click($('#card-body [data-k="countStyle"] .seg-b[data-v="badge"]'));
  await tick();
  ok('and back to a badge', !!$('#grid .card .b-count') && !$('#grid .card .card-n'));
}
click($('#sheet-card [data-close]'));
await tick();

console.log('\nthe type sizes');
click($('#btn-set'));
await tick();
{
  /* 0.17 puts every type dial through the app-wide scale, so what is written
     is the number and the multiplier rather than a finished pixel. `--ui`
     defaults to 1, so the sizes are unchanged until the scale is moved. */
  const px = v => d.documentElement.style.getPropertyValue(v).replace(/\s+/g, '');
  set($('#s-nameSize'), '21');
  await tick();
  ok('the name has a size', px('--name-px') === 'calc(21px*var(--ui))', px('--name-px'));
  set($('#s-descSize'), '11');
  await tick();
  ok('so does the description', px('--desc-px') === 'calc(11px*var(--ui))', px('--desc-px'));
  set($('#s-badgeSize'), '12');
  await tick();
  ok('and the badges', px('--badge-px') === 'calc(12px*var(--ui))', px('--badge-px'));
  set($('#s-titleSize'), '40');
  await tick();
  ok('and the wordmark', px('--title-px') === 'calc(40px*var(--ui))', px('--title-px'));
  ok('and settings opens the card editor', !!$('#set-body [data-k="cardeditor"] .btn'));

  /* The two new dials. The board always answered the window; the chrome around
     it never answered anything, which is what "the content does not scale"
     was. One number now moves both, and the air around them is its own. */
  set($('#s-uiScale'), '1.25');
  await tick();
  ok('text size is one dial over the whole app', px('--ui') === '1.25', px('--ui'));
  ok('and the card sizes are expressed through it, so one move takes all of them',
    px('--name-px') === 'calc(21px*var(--ui))' && px('--desc-px') === 'calc(11px*var(--ui))',
    px('--name-px'));
  set($('#s-uiDensity'), '1.2');
  await tick();
  ok('spacing is a second dial, kept apart from it', px('--dens') === '1.2', px('--dens'));
  {
    const css = fs.readFileSync(path.join(APP, 'css/hub.css'), 'utf8');
    ok('the chrome restates its own sizes through the scale',
      /\.btn\{height:calc\(34px \* var\(--ui,1\)\)/.test(css) &&
      /\.chip\{height:calc\(28px \* var\(--ui,1\)\)/.test(css) &&
      /body\{font-size:calc\(14px \* var\(--ui,1\)\)\}/.test(css));
    ok('and the density dial never touches a font size',
      /\.bar\{gap:calc\(10px \* var\(--dens,1\)\)/.test(css) &&
      !/font-size:calc\([\d.]+px \* var\(--dens/.test(css));
    /* The one type on a card that had no dial at all, which is what the badges
       setting was quietly not reaching. */
    ok('the card badges read the badge dial', /\.tag,\.seen\{font-size:var\(--badge-px/.test(css));
  }
  set($('#s-uiScale'), '1');
  set($('#s-uiDensity'), '1');
  await tick();
}

console.log('\nthe heat has steps now');
{
  /* Ten colours, not two hundred. Two channels a click apart on a big board
     land on the same step; a scale you cannot read is not a scale. */
  const heatOf = name => $$('#grid .card')
    .find(c => c.querySelector('.card-name').textContent === name)
    .style.getPropertyValue('--heat-t');
  set($('#s-heatSteps'), '2');
  await tick();
  const two = $$('#grid .card').map(c => c.style.getPropertyValue('--heat-t'));
  ok('two steps means two values', new Set(two).size <= 2, [...new Set(two)].join(' '));
  ok('and they are the ends of the ramp',
     two.every(v => v === '0.000' || v === '1.000'), [...new Set(two)].join(' '));
  set($('#s-heatSteps'), '10');
  await tick();
  const ten = $$('#grid .card').map(c => c.style.getPropertyValue('--heat-t'));
  ok('ten steps is ten values at most', new Set(ten).size <= 10);
  ok('and every one of them is on a tenth',
     ten.every(v => Math.abs(Number(v) * 9 - Math.round(Number(v) * 9)) < 0.01),
     [...new Set(ten)].join(' '));
  ok('the hottest card is still the hottest', heatOf('aardvark') === '1.000', heatOf('aardvark'));
  ok('and it is remembered', JSON.parse(w.localStorage.getItem('hub.ui.v1')).heatSteps === 10);
}
click($('#sheet-set [data-close]'));
await tick();

console.log('\nclearing the dots');
{
  /* A board seeded in one pass arrives with a dot on every card. The button is
     only there while there is something to clear, and it clears without
     claiming any of them was opened. */
  const chans = w.Store.channels();
  chans.forEach(c => w.Store.enrich(c.id, {
    latest:{ videoId:'seed' + c.id, title:'seeded', at:Date.now() } }));
  set($('#q'), '');
  await tick();
  const seenBefore = w.Store.channels().map(c => c.seen);
  ok('every card has a dot', $$('#grid .card.is-new').length === chans.length,
     $$('#grid .card.is-new').length + ' of ' + chans.length);
  ok('the button says how many', !$('#btn-dots').hidden
     && $('#dots-n').textContent === String(chans.length));

  click($('#btn-dots'));
  await tick();
  ok('one click only arms it', $('#btn-dots').classList.contains('armed')
     && $$('#grid .card.is-new').length === chans.length);
  click($('#btn-dots'));
  await tick();
  ok('the second clears the lot', $$('#grid .card.is-new').length === 0);
  ok('and the button goes away', $('#btn-dots').hidden);
  ok('nothing claims to have been opened',
     w.Store.channels().every((c, i) => c.seen === seenBefore[i]));
  ok('it is written down, not only drawn',
     JSON.parse(w.localStorage.getItem('hub.channels.v1')).every(c => c.dotAt > 0));

  /* One card at a time, by clicking the dot itself. */
  const one = w.Store.channels()[0];
  w.Store.enrich(one.id, { latest:{ videoId:'again', title:'again', at:Date.now() } });
  set($('#q'), '');
  await tick();
  const card = $$('#grid .card').find(el => el.dataset.id === one.id);
  ok('a new upload brings its dot back', card.classList.contains('is-new'));
  click(card.querySelector('.new'));
  await tick();
  ok('and clicking that dot clears just that one',
     !$$('#grid .card').find(el => el.dataset.id === one.id).classList.contains('is-new'));
  ok('without opening the channel',
     w.Store.channels().find(c => c.id === one.id).seen === one.seen);
}

console.log('\nwhere a card lands');
{
  const href = () => $('#grid .card .card-hit').getAttribute('href');
  ok('a card goes to the videos tab by default', href().endsWith('/videos'), href());

  click($('#btn-set'));
  await tick();
  click($('#set-body [data-k="openTab"] .seg-b[data-v="home"]'));
  await tick();
  ok('it can be sent to the channel home page instead',
     !href().endsWith('/videos') && href().includes('youtube'), href());
  ok('and that is the stored url itself',
     href() === w.Store.channels().find(c => c.id === $('#grid .card').dataset.id).url);
  ok('the choice is remembered',
     JSON.parse(w.localStorage.getItem('hub.ui.v1')).openTab === 'home');
  click($('#set-body [data-k="openTab"] .seg-b[data-v="videos"]'));
  await tick();
  ok('and back to the videos tab', href().endsWith('/videos'));
  click($('#sheet-set [data-close]'));
  await tick();

  /* The tab is where it lands, not what it is allowed to be: opening one still
     stamps the same channel and still counts as one open. */
  const id = $('#grid .card').dataset.id;
  const before = w.Store.channels().find(c => c.id === id).clicks || 0;
  click($('#grid .card .card-hit'));
  await tick();
  ok('opening the videos tab still counts as opening the channel',
     (w.Store.channels().find(c => c.id === id).clicks || 0) === before + 1);
}

console.log('\nfavourite categories');
{
  click($('#btn-cats'));
  await tick();
  const cats = w.Store.cats();
  const last = cats[cats.length - 1];
  ok('every category row has a star', $$('#cat-list .cat-fav').length === cats.length);
  ok('and none of them is on to begin with', $$('#cat-list .cat-fav.on').length === 0);

  click($('#cat-list [data-fav="' + last.id + '"]'));
  await tick();
  ok('starring one says so', w.Store.cats().find(c => c.id === last.id).fav === true);
  ok('and it is written down',
     JSON.parse(w.localStorage.getItem('hub.cats.v1')).find(c => c.id === last.id).fav === true);
  click($('#sheet-cat [data-close]'));
  await tick();

  const chipNames = () => $$('#chips .chip').slice(1).map(c =>
    (c.querySelector('.t') || c).textContent);
  ok('a favourite is first on the filter bar', chipNames()[0] === last.name, chipNames().join(','));
  ok('and it is marked as one',
     $$('#chips .chip')[1].classList.contains('fav'));
  ok('the manager keeps its own order',
     w.Store.cats()[w.Store.cats().length - 1].id === last.id);

  click($('#btn-set'));
  await tick();
  click($('#set-body [data-k="favFirst"]'));
  await tick();
  click($('#sheet-set [data-close]'));
  await tick();
  ok('pinning can be switched off', chipNames()[0] !== last.name);
  click($('#btn-set'));
  await tick();
  click($('#set-body [data-k="favFirst"]'));
  await tick();
  click($('#sheet-set [data-close]'));
  await tick();
}

console.log('\nthe filter plays the board’s own entry');
{
  /* Turning a category on leaves a board that mostly has nothing to do with the
     one before it, so the cards arrive rather than slide. Every card that ends
     up on screen carries the entry class and its own place in the stagger. */
  const cat = w.Store.cats().find(c => w.Store.countIn(c.id) > 0);
  const chip = $$('#chips .chip').find(b => (b.querySelector('.t') || {}).textContent === cat.name);
  click(chip);
  await tick();
  const cards = $$('#grid .card');
  ok('there is something to look at', cards.length > 0);
  ok('every card on the filtered board is arriving, not sliding',
     cards.every(c => c.classList.contains('in')));
  ok('and each has its own place in the stagger',
     cards.every((c, i) => c.style.getPropertyValue('--i') === String(i)));
  click($('#chips .chip.all'));
  await tick();
  ok('clearing the filter plays it too',
     $$('#grid .card').every(c => c.classList.contains('in')));
  const entered = $('#grid .card.in');
  entered.dispatchEvent(new w.Event('animationend', { bubbles:true }));
  ok('the opening animation is removed after its first play', !entered.classList.contains('in'));
}

console.log('\nthe avatar, every way of showing one');
click($('#btn-card'));
await tick();
{
  const card = () => $$('#grid .card').find(el => el.dataset.id === withPic);
  /* One channel with a picture, one without — the second is the case that
     matters, because off disk every channel is that case. */
  const withPic = w.Store.channels()[0].id;
  const noPic = w.Store.channels().find(c => c.id !== withPic && !c.avatar);
  w.Store.enrich(withPic, { avatar:'https://yt3.example/a.jpg' });
  set($('#q'), '');
  await tick();

  const bare = () => $$('#grid .card').find(el => el.dataset.id === noPic.id);
  ok('a channel with no picture still has an avatar box', !!bare().querySelector('.av'));
  ok('and it is not pretending to have one', !bare().querySelector('.av').classList.contains('has'));
  ok('what it draws instead is the channel’s initial',
     bare().querySelector('.av-fb').textContent ===
       noPic.name.replace(/^@+/, '')[0].toUpperCase(),
     bare().querySelector('.av-fb').textContent);
  ok('the one with a picture draws the picture',
     card().querySelector('.av').classList.contains('has') &&
     card().querySelector('.av img').getAttribute('src') === 'https://yt3.example/a.jpg');

  click($('#card-body [data-k="avatarFallback"] .seg-b[data-v="icon"]'));
  await tick();
  ok('the fallback can be the category’s icon instead',
     bare().querySelector('.av').dataset.fb === 'icon');
  click($('#card-body [data-k="avatarFallback"] .seg-b[data-v="none"]'));
  await tick();
  ok('or nothing at all, and then the box leaves the card', !bare().querySelector('.av'));
  ok('while a channel that has a picture keeps its box', !!card().querySelector('.av'));
  click($('#card-body [data-k="avatarFallback"] .seg-b[data-v="initial"]'));
  await tick();
  ok('and back', !!bare().querySelector('.av-fb'));

  click($('#card-body [data-k="avatarShape"] .seg-b[data-v="hex"]'));
  await tick();
  ok('there are five shapes now, including a hexagon', $('#grid').dataset.avatar === 'hex');
  click($('#card-body [data-k="avatarShape"] .seg-b[data-v="squircle"]'));
  await tick();
  ok('and a squircle', $('#grid').dataset.avatar === 'squircle');
  click($('#card-body [data-k="avatarShape"] .seg-b[data-v="circle"]'));
  await tick();

  click($('#card-body [data-k="avatarBorder"] .seg-b[data-v="ring"]'));
  await tick();
  ok('the edge can be a ring', $('#grid').getAttribute('data-avatar-border') === 'ring');
  click($('#card-body [data-k="avatarFit"] .seg-b[data-v="contain"]'));
  await tick();
  ok('the picture can be fitted rather than cropped',
     $('#grid').getAttribute('data-avatar-fit') === 'contain');
  click($('#card-body [data-k="avatarTone"] .seg-b[data-v="hover"]'));
  await tick();
  ok('and it can be grey until you point at it',
     $('#grid').getAttribute('data-avatar-tone') === 'hover');
  click($('#card-body [data-k="avatarTone"] .seg-b[data-v="full"]'));
  await tick();

  ok('the wash is off to begin with', card().style.getPropertyValue('--wash') === '0');
  set($('#s-avatarWash'), '12');
  await tick();
  ok('and can be turned up', card().style.getPropertyValue('--wash') === '0.120',
     card().style.getPropertyValue('--wash'));
  ok('it is the channel’s own picture behind the card',
     card().querySelector('.wash').style.backgroundImage.includes('yt3.example'));
  ok('a channel with no picture has no wash to show',
     !bare().querySelector('.wash').style.backgroundImage);
  set($('#s-avatarWash'), '0');
  await tick();
  ok('and off again', card().style.getPropertyValue('--wash') === '0');
  ok('every dial of it is remembered', (() => {
    const u = JSON.parse(w.localStorage.getItem('hub.ui.v1'));
    return u.avatarShape === 'circle' && u.avatarBorder === 'ring'
        && u.avatarFit === 'contain' && u.avatarTone === 'full'
        && u.avatarFallback === 'initial' && u.avatarWash === 0;
  })());
  click($('#card-body [data-k="avatarBorder"] .seg-b[data-v="hairline"]'));
  click($('#card-body [data-k="avatarFit"] .seg-b[data-v="cover"]'));
  await tick();
}
click($('#sheet-card [data-close]'));
await tick();

console.log('\nnewest upload, as an order and as a filter');
{
  /* Three channels are wanted here and the board is not guaranteed to have
     three by this point, so any that are missing are added rather than
     assumed. */
  while (w.Store.channels().length < 3)
    w.Store.addChannel({ url:'https://www.youtube.com/@filler' + w.Store.channels().length });
  const chans = w.Store.channels();
  const now = Date.now();
  w.Store.enrich(chans[0].id, { latest:{ videoId:'a', title:'oldest', at:now - 40 * 86400000 } });
  w.Store.enrich(chans[1].id, { latest:{ videoId:'b', title:'newest', at:now - 60e3 } });
  w.Store.enrich(chans[2].id, { latest:{ videoId:'c', title:'middle', at:now - 5 * 86400000 } });
  w.Store.clearNew();                      /* start from no dots at all */
  set($('#sort'), 'posted');
  $('#sort').dispatchEvent(new w.Event('change', { bubbles:true }));
  await tick();
  const ids = $$('#grid .card').map(el => el.dataset.id);
  ok('newest upload is a sort', ids[0] === chans[1].id, ids.slice(0, 3).join(','));
  ok('and the older one is behind it',
     ids.indexOf(chans[2].id) < ids.indexOf(chans[0].id));
  ok('a channel with nothing known sorts to the end, not to 1970', (() => {
    const none = w.Store.channels().find(c => !c.latest);
    return !none || ids.indexOf(none.id) > ids.indexOf(chans[0].id);
  })());

  /* Only what is new. Two of the three have been acknowledged, so the chip
     should be counting one. */
  w.Store.enrich(chans[1].id, { latest:{ videoId:'b2', title:'brand new', at:Date.now() } });
  set($('#q'), '');
  await tick();
  ok('the new chip is on the bar when there is something new', !!$('#chip-new'));
  ok('and says how many', $('#chip-new .n').textContent === String(w.Store.countNew()));
  click($('#chip-new'));
  await tick();
  ok('turning it on leaves only what is new',
     $$('#grid .card').length === w.Store.countNew() && $$('#grid .card').length > 0,
     $$('#grid .card').length + ' of ' + w.Store.countNew());
  ok('and it is every card with a dot',
     $$('#grid .card').every(el => el.classList.contains('is-new')));
  click($('#chip-new'));
  await tick();
  ok('turning it off gives the board back', $$('#grid .card').length > w.Store.countNew());
  set($('#sort'), 'name');
  $('#sort').dispatchEvent(new w.Event('change', { bubbles:true }));
  await tick();
}

console.log('\npinning a channel');
{
  const names = () => $$('#grid .card .card-name').map(e => e.textContent);
  const last = w.Store.channels().find(c => c.name === names()[names().length - 1]);
  ok('nothing is pinned to begin with', w.Store.pinned() === 0);

  const card = $$('#grid .card').find(el => el.dataset.id === last.id);
  click(card.querySelector('.card-edit'));
  await tick();
  ok('the channel pane offers a pin', !$('#c-pin').hidden);
  click($('#c-pin'));
  await tick();
  ok('clicking it pins the channel', w.Store.channels().find(c => c.id === last.id).pin === true);
  ok('and it is written down, not held until save',
     JSON.parse(w.localStorage.getItem('hub.channels.v1')).find(c => c.id === last.id).pin === true);
  ok('the button says so', $('#c-pin').classList.contains('on'));
  click($('#sheet-ch [data-close]'));
  await tick();

  ok('a pinned channel is first whatever the sort', names()[0] === last.name, names()[0]);
  ok('and it is marked as one', $('#grid .card .b-pin').textContent === 'pinned');
  set($('#sort'), 'clicks');
  $('#sort').dispatchEvent(new w.Event('change', { bubbles:true }));
  await tick();
  ok('still first under another sort', names()[0] === last.name);

  click($('#btn-set'));
  await tick();
  click($('#set-body [data-k="pinFirst"]'));
  await tick();
  ok('pinning first can be switched off', names()[0] !== last.name);
  click($('#set-body [data-k="pinFirst"]'));
  await tick();
  click($('#sheet-set [data-close]'));
  await tick();

  click($$('#grid .card').find(el => el.dataset.id === last.id).querySelector('.card-edit'));
  await tick();
  click($('#c-pin'));
  await tick();
  ok('and a pin comes off the same way',
     w.Store.channels().find(c => c.id === last.id).pin === false);
  ok('the mark goes with it', !$('#grid .card .b-pin'));
  click($('#sheet-ch [data-close]'));
  await tick();
  set($('#sort'), 'name');
  $('#sort').dispatchEvent(new w.Event('change', { bubbles:true }));
  await tick();
}

console.log('\nthe tab says how many are new');
{
  w.Store.clearNew();
  set($('#q'), '');
  await tick();
  ok('nothing new, and the title is just the app', d.title === 'HUB', d.title);
  const ch = w.Store.channels()[0];
  w.Store.enrich(ch.id, { latest:{ videoId:'t1', title:'one', at:Date.now() } });
  set($('#q'), '');
  await tick();
  ok('one new, and the title counts it', d.title === 'HUB · 1 new', d.title);

  click($('#btn-set'));
  await tick();
  click($('#set-body [data-k="titleCount"]'));
  await tick();
  ok('and it can be switched off', d.title === 'HUB');
  click($('#set-body [data-k="titleCount"]'));
  await tick();
  click($('#sheet-set [data-close]'));
  await tick();
}

console.log('\nr opens one of them');
{
  set($('#q'), '');
  await tick();
  d.activeElement?.blur(); // exercise the shortcut outside a text field
  let opened = 0;
  $$('#grid .card .card-hit').forEach(a => a.addEventListener('click', () => { opened++ }));
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key:'r', bubbles:true }));
  await tick();
  ok('r opens exactly one card', opened === 1, String(opened));

  /* From what is on screen, not from everything: the filter is already half of
     the choice. */
  set($('#q'), 'zzzzzznothingmatchesthis');
  await tick();
  let opened2 = 0;
  $$('#grid .card .card-hit').forEach(a => a.addEventListener('click', () => { opened2++ }));
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key:'r', bubbles:true }));
  await tick();
  ok('and does nothing at all on an empty board', opened2 === 0);
  set($('#q'), '');
  await tick();
}

console.log('\nthe web app');
{
  /* jsdom has no service worker, so this is the "there is no web app here"
     path — which is the one that has to be silent. Off disk and inside the
     extension take the same path. */
  ok('the page knows it cannot be installed here', w.eval('HubApp.can') === false);
  ok('and says nothing about installing', (() => {
    click($('#btn-set'));
    const row = $('#set-body [data-k="install"]');
    click($('#sheet-set [data-close]'));
    return !row;
  })());
  ok('the board booted anyway', $$('#grid .card').length > 0);

  /* The manifest and the worker are files the page names, so a typo in either
     is a 404 nobody sees until they try to install. Checked as facts about the
     repo, the way the [hidden] rule is. */
  const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
  ok('the page links a web app manifest', /rel="manifest" href="app\.webmanifest"/.test(html));
  const man = JSON.parse(fs.readFileSync(path.join(APP, 'app.webmanifest'), 'utf8'));
  ok('the manifest is json, and its own app', man.name && man.start_url && man.display === 'standalone');
  ok('every icon it names is really there',
     man.icons.every(i => fs.existsSync(path.join(APP, i.src))),
     man.icons.map(i => i.src).join(' '));
  ok('one of them is maskable', man.icons.some(i => i.purpose === 'maskable'));
  const sw = fs.readFileSync(path.join(APP, 'sw.js'), 'utf8');
  ok('the worker precaches every file the board is made of',
     ['index.html', 'css/hub.css', 'js/app.js', 'js/store.js', 'ext/model.js', 'ext/scope.js']
       .every(f => sw.includes('./' + f)));
  ok('and it is registered from its own file, not from the board',
     fs.readFileSync(path.join(APP, 'js', 'webapp.js'), 'utf8').includes('serviceWorker.register')
     && !fs.readFileSync(path.join(APP, 'js', 'app.js'), 'utf8').includes('serviceWorker.register'));
}

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

console.log('\ncard effects and preview states');
{
  click($('#btn-card'));
  const choose = (key, value) => click($('#card-body [data-k="' + key + '"] [data-v="' + value + '"]'));
  choose('freshStyle', 'tint');
  choose('freshAnimation', 'ripple');
  choose('freshColorSource', 'custom');
  set($('#s-freshColor'), '#00ffaa');
  set($('#s-freshIntensity'), 85);
  click($('#card-body [data-k="freshBadge"]'));
  ok('fresh styling is persisted', w.Store.ui().freshStyle === 'tint' && w.Store.ui().freshIntensity === 85);
  ok('preview uses the custom highlight colour', $('#card-prev .card').style.getPropertyValue('--fresh-c') === '#00ffaa');
  ok('the optional fresh badge is visible', !!$('#card-prev .b-fresh'));
  click($('[data-preview="normal"]'));
  ok('normal preview removes fresh styling and badge', !$('#card-prev .is-fresh') && !$('#card-prev .b-fresh'));
  click($('[data-preview="refresh"]'));
  ok('refresh can be previewed without a request', !!$('#card-prev .is-refreshing'));
  choose('refreshEffect', 'pulse');
  ok('refresh effect updates both grids', $('#grid').dataset.refreshEffect === 'pulse' && $('#card-prev').dataset.refreshEffect === 'pulse');
  choose('washEffect', 'drift');
  set($('#s-washX'), 80);
  set($('#s-avatarWash'), 20);
  set($('#s-washBlur'), 4);
  ok('image effect and position reach the preview',
    $('#card-prev').dataset.washEffect === 'drift' && $('#card-prev .card').style.getPropertyValue('--wash-x') === '80%');
  ok('preview has a logo background', !!$('#card-prev .wash').style.backgroundImage);
  choose('hoverEffect', 'zoom');
  ok('hover choice reaches the board', $('#grid').dataset.hover === 'zoom');
  click($('[data-preview="fresh"]'));
  set($('#s-freshHours'), 1);
  ok('fresh preview stays fresh for a one-hour window', !!$('#card-prev .is-fresh'));
  const now = Date.now();
  ok('future upload is not fresh', !w.Store.isFresh({latest:{at:now + 3600000}}));
  ok('expired upload is not fresh', !w.Store.isFresh({latest:{at:now - 3600001}}));
  ok('recent upload stays fresh after acknowledgement', w.Store.isFresh({latest:{at:now - 1000}, dotAt:now, seen:now}));
  const exported = JSON.parse(w.Store.exportJSON());
  w.Store.setUi({washEffect:'mono'});
  w.Store.importJSON(JSON.stringify(exported));
  ok('effects survive export and import', w.Store.ui().washEffect === 'drift' && w.Store.ui().freshColor === '#00ffaa');
  const clean = w.eval('HubModel.fillUi({freshStyle:"junk",washBlur:999,freshSpeed:"bad",freshColor:"red"})');
  ok('invalid imported effects fall back safely', clean.freshStyle === 'glow' && clean.washBlur === 12 && clean.freshSpeed === 3.4 && clean.freshColor === '');
  click($('#sheet-card [data-close]'));
  click($('#btn-set'));
  set($('#s-motion'), 0);
  ok('motion off disables continuous effects', d.documentElement.classList.contains('motion-off'));
  set($('#s-motion'), 1);
  click($('#sheet-set [data-close]'));
}

console.log('\nrefresh progress and failures');
{
  w.chrome = {runtime:{id:'test'}};
  const waiting = [];
  w.fetch = (url, options) => new Promise(resolve => waiting.push({url, options, resolve}));
  const finish = () => waiting.splice(0).forEach(r => r.resolve({ok:true, text:async () =>
    r.url.includes('/feeds/') ? '<feed></feed>' : '<meta itemprop="channelId" content="UCabcdefghijklmnopqrstuv">'}));
  const run = w.eval('HubEnrich.pass({force:true,ui:{lanes:1}})');
  await tick();
  ok('refresh starts with visible progress', !$('#refresh-status').hidden && $('#refresh-progress').value === 0);
  ok('board and buttons report busy', $('#grid').getAttribute('aria-busy') === 'true' && $('#btn-refresh').disabled && $('#s-refresh').disabled);
  ok('only the active lane has a loading card', $$('#grid .is-refreshing').length === 1);
  ok('requests carry an abort signal', waiting.every(r => !!r.options.signal));
  const duplicate = await w.eval('HubEnrich.pass({force:true})');
  ok('a duplicate refresh does not start another pass', duplicate.done === 0 && $('#btn-refresh').disabled);
  while (w.eval('HubEnrich.busy()')) { finish(); await tick() }
  const out = await run;
  ok('completed progress matches channel count', out.done === w.Store.channels().length && $('#refresh-progress').value === out.done);
  ok('refresh clears all busy states', !$('#btn-refresh').disabled && $('#grid').getAttribute('aria-busy') === 'false' && !$('#grid .is-refreshing'));
  ok('completion is announced', $('#refresh-label').textContent.includes('up to date'));
  w.fetch = async () => ({ok:false});
  const oldLatest = JSON.stringify(w.Store.channels().map(c => c.latest));
  const failed = await w.eval('HubEnrich.pass({force:true})');
  ok('failure is counted once per channel', failed.failed === failed.done);
  ok('failed refresh keeps known uploads', oldLatest === JSON.stringify(w.Store.channels().map(c => c.latest)));
  ok('failure releases buttons and reports it', !$('#btn-refresh').disabled && $('#refresh-label').textContent.includes('could not fully refresh'));
  const originalTimer = w.setTimeout;
  w.setTimeout = (fn,ms,...args) => originalTimer(fn,ms === 15000 ? 1 : ms,...args);
  w.fetch = (url,{signal}) => new Promise((resolve,reject) => signal.addEventListener('abort',()=>reject(new Error('timeout'))));
  const timedOut = await w.eval('HubEnrich.pass({force:true})');
  w.setTimeout = originalTimer;
  ok('timed-out requests finish the pass and release loading state', timedOut.failed === timedOut.done && !$('#btn-refresh').disabled && !$('#grid .is-refreshing'));
  delete w.chrome;
}

console.log('\nsettings expansion');
{
  w.Store.setUi({savedLooks:[],categoryLooks:{},pinnedLook:'',freshAging:false,animationSchedule:'continuous',latestPreview:true,uploadView:'all',groupUploads:false});
  click($('#btn-set'));set($('#s-motion'),1);click($('#sheet-set [data-close]'));click($('#btn-card'));
  const choose=(key,value)=>click($('#card-body [data-k="'+key+'"] [data-v="'+value+'"]'));
  const change=(el,value)=>{el.value=value;el.dispatchEvent(new w.Event('change',{bubbles:true}))};
  const gridded=w.HubModel.fillUi({slots:{name:'mr',desc:'ml'},zones:{ml:'top'}});
  ok('grid positions and their stacking mode are validated',gridded.slots.name==='mr' && gridded.zones.ml==='top');
  choose('freshStyle','edge');set($('#s-freshHours'),24);
  $('#look-name').value='My saved look';click($('#look-save'));
  const saved=w.Store.ui().savedLooks[0];
  ok('saving a look captures layout and effects',saved.name==='My saved look' && saved.look.slots.name==='tl' && saved.look.freshStyle==='edge');
  change($('#look-select'),'neon');click($('#look-apply'));
  ok('built-in looks apply immediately',w.Store.ui().freshStyle==='glow');
  change($('#look-select'),saved.id);click($('#look-apply'));
  ok('a saved look restores complete card settings',w.Store.ui().freshStyle==='edge' && w.Store.ui().slots.name==='tl');
  click($('#sheet-card [data-close]'));click($('#btn-card'));
  choose('freshStyle','tint');click($('#preview-before'));
  ok('before comparison affects only the preview',$('#card-prev .card').dataset.freshStyle==='edge' && $('#grid .card').dataset.freshStyle==='tint');
  click($('#preview-before'));
  ok('after comparison restores current preview',$('#card-prev .card').dataset.freshStyle==='tint');
  click($('#card-undo'));
  ok('undo restores the previous setting',w.Store.ui().freshStyle==='edge');
  set($('#s-freshIntensity'),95);
  const section=$('#s-freshIntensity').closest('details');click(section.querySelector('.section-reset'));
  ok('section reset restores its defaults',w.Store.ui().freshIntensity===60 && w.Store.ui().freshStyle==='glow');
  click($('#card-undo'));
  ok('section reset can be undone',w.Store.ui().freshIntensity===95 && w.Store.ui().freshStyle==='edge');
  set($('#card-search'),'parallax');
  ok('settings search reveals relevant controls',!$('#card-body [data-k="washEffect"]').hidden && $('#card-body [data-k="freshStyle"]').hidden);
  set($('#card-search'),'');
  const cat=w.Store.addCat('Effect tests','#44bbff');
  const ch=w.Store.addChannel({url:'https://www.youtube.com/@effects',name:'Effect fixture',cat:cat.id});
  const ageCh=w.Store.addChannel({url:'https://www.youtube.com/@aging',name:'Aging fixture'});
  w.Store.enrich(ch.id,{latest:{videoId:'freshEffect',at:Date.now()-1000,title:'Fresh title'},avatar:'https://example.com/avatar.png'});
  w.Store.enrich(ageCh.id,{latest:{videoId:'agingVideo',at:Date.now()-12*3600000,title:'Aged title'}});
  click($('#sheet-card [data-close]'));click($('#btn-card'));set($('#s-freshHours'),24);
  change($('#card-body [data-category="'+cat.id+'"]'),saved.id);
  const card=()=>$('#grid .card[data-id="'+ch.id+'"]');
  ok('category look overrides effects',card().dataset.freshStyle==='edge');
  change($('#card-body [data-category="__pinned"]'),'neon');w.Store.togglePin(ch.id);set($('#q'),'');
  ok('pinned-channel style takes precedence',card().dataset.freshStyle==='glow');
  set($('#s-freshIntensity'),100);click($('#card-body [data-k="freshAging"]'));
  const strength=parseFloat($('#grid .card[data-id="'+ageCh.id+'"]').style.getPropertyValue('--fresh-strength'));
  ok('a halfway-aged upload has half the highlight strength',strength>.49 && strength<.51,String(strength));
  choose('animationSchedule','once');
  ok('first discovery records a played upload',!!w.Store.channels().find(c=>c.id===ageCh.id).animationSeen);
  set($('#q'),'no fixture can match this');await tick();set($('#q'),'');await tick();
  ok('filtering back does not replay a discovered upload',!$('#grid .card[data-id="'+ageCh.id+'"]').classList.contains('play-once'));
  w.Store.enrich(ageCh.id,{latest:{videoId:'nextVideo',at:Date.now(),title:'Next title'}});set($('#q'),'');
  ok('a newer upload gets its own one-time animation',$('#grid .card[data-id="'+ageCh.id+'"]').classList.contains('play-once'));
  choose('animationSchedule','continuous');
  w.Store.clearNew();click($('[data-upload-view="today"]'));await tick();
  ok('posted-today filtering is independent of unread dots',!!card() && !card().classList.contains('is-new'));
  ok('posted-today filtering includes only the last 24 hours',$$('#grid .card').every(el=>w.HubModel.uploadGroup(w.Store.channels().find(c=>c.id===el.dataset.id))==='today'));
  click($('[data-upload-view="all"]'));click($('#group-uploads'));
  ok('age groups add headings to the board',$$('#grid .upload-heading').length>0);
  const queue=card().querySelector('.video-queue');click(queue);
  ok('latest-video preview adds the right upload to the queue',w.Store.queue().some(q=>q.videoId==='freshEffect') && card().querySelector('.video-queue').disabled);
  ok('latest-video preview carries its title and link',card().querySelector('.video-title').textContent==='Fresh title' && card().querySelector('.video-open').href.endsWith('freshEffect'));
  let exported;
  w.URL.createObjectURL=blob=>{exported=blob;return 'blob:test'};w.URL.revokeObjectURL=()=>{};
  change($('#look-select'),saved.id);click($('#look-export'));
  const content=await new Promise(resolve=>{const reader=new w.FileReader();reader.onload=()=>resolve(reader.result);reader.readAsText(exported)});
  ok('look export is separate from board data',JSON.parse(content).kind==='hub.look' && !JSON.parse(content).channels);
  Object.defineProperty($('#look-file'),'files',{configurable:true,value:[{size:content.length,text:async()=>content}]});
  $('#look-file').dispatchEvent(new w.Event('change'));await tick();
  ok('look import adds a preset without replacing channels',w.Store.ui().savedLooks.length===2 && !!w.Store.channels().find(c=>c.id===ch.id));
  const persisted=JSON.parse(w.Store.exportJSON());
  ok('board export includes saved looks and category assignments',persisted.ui.savedLooks.length===2 && persisted.ui.categoryLooks[cat.id]===saved.id);
  const snapshot=w.Store.ui();snapshot.categoryLooks[cat.id]='quiet';
  ok('returned settings cannot mutate stored category styles',w.Store.ui().categoryLooks[cat.id]===saved.id);
  click($('#sheet-card [data-close]'));click($('#btn-set'));
  ok('settings exposes design and popup sections',!!$('#set-body [data-k="design-layout"]') && !!$('#set-body [data-k="popupFresh"]'));
  click($('#set-body [data-k="design-layout"] .btn'));
  ok('settings opens the positioning section',$('#card-body [data-k="slot-name"]').closest('details').open);
}

console.log('\nmore dials');
{
  w.Store.setUi({...w.HubModel.DEFAULT_UI,savedLooks:[],categoryLooks:{},pinnedLook:''});
  click($('#btn-card'));
  const choose=(key,value)=>click($('#card-body [data-k="'+key+'"] [data-v="'+value+'"]'));
  const cardOf=id=>$('#grid .card[data-id="'+id+'"]');
  const cat=w.Store.cats()[0];
  const dials=w.Store.addChannel({url:'https://www.youtube.com/@dials',name:'Dials fixture',cat:cat.id});
  w.Store.enrich(dials.id,{latest:{videoId:'dialsVideo',at:Date.now()-1000,title:'Dials title'},avatar:'https://example.com/dials.png'});
  set($('#q'),'');

  /* animations */
  const animationSection=$('#card-body [data-section="animations"]');
  const speedKeys=['hoverSpeed','enterSpeed','exitSpeed','filterSpeed','reorderSpeed','freshSpeed','washAnimationSpeed','avatarSpeed','dotSpeed','refreshSpeed','previewCueSpeed','previewSpeed','previewDismissSpeed','sheetSpeed','pageBgSpeed','resizeSpeed','interfaceSpeed'];
  ok('every animation speed is grouped in one section',
    speedKeys.every(key=>animationSection.querySelector('[data-k="'+key+'"]')));
  ok('each animation family has more choices',
    !!animationSection.querySelector('[data-k="cardEnter"] [data-v="glide"]') &&
    !!animationSection.querySelector('[data-k="cardExit"] [data-v="implode"]') &&
    !!animationSection.querySelector('[data-k="refreshEffect"] [data-v="ripple"]') &&
    !!animationSection.querySelector('[data-k="previewAnimation"] [data-v="flip"]'));
  set($('#s-avatarSpeed'),1.1);set($('#s-dotSpeed'),2.3);set($('#s-refreshSpeed'),1.7);
  set($('#s-previewSpeed'),.4);set($('#s-previewDismissSpeed'),.5);set($('#s-previewCueSpeed'),2.6);
  ok('per-family speeds reach the rendered card',
    cardOf(dials.id).style.getPropertyValue('--avatar-cycle')==='1.1s' &&
    cardOf(dials.id).style.getPropertyValue('--dot-cycle')==='2.3s' &&
    cardOf(dials.id).style.getPropertyValue('--refresh-cycle')==='1.7s' &&
    cardOf(dials.id).style.getPropertyValue('--preview-cycle')==='0.4s' &&
    cardOf(dials.id).style.getPropertyValue('--preview-dismiss-cycle')==='0.5s' &&
    cardOf(dials.id).style.getPropertyValue('--preview-cue-cycle')==='2.6s');
  choose('freshAnimation','orbit');
  choose('freshEasing','spring');
  choose('freshDirection','alternate');
  set($('#s-animationStagger'),120);
  const fx=cardOf(dials.id);
  ok('a new fresh animation reaches the card',fx.dataset.freshAnimation==='orbit');
  ok('the curve and direction are the card\u2019s own',
    fx.style.getPropertyValue('--fresh-ease').includes('cubic-bezier') && fx.style.getPropertyValue('--fresh-dir')==='alternate');
  ok('a stagger is a per-card delay',fx.style.getPropertyValue('--fx-stagger')==='120ms' && fx.style.getPropertyValue('--i')!=='');
  choose('cardEnter','flip');
  set($('#s-enterStagger'),60);
  ok('the entry animation and its stagger reach the board',
    $('#grid').dataset.enter==='flip' && $('#grid').style.getPropertyValue('--enter-stagger')==='60ms');
  choose('hoverEffect','tilt');
  set($('#s-hoverStrength'),175);
  ok('hover strength scales whichever hover is on',
    $('#grid').dataset.hover==='tilt' && cardOf(dials.id).style.getPropertyValue('--hover-k')==='1.75');
  choose('dotAnimation','ping');
  ok('the dot has an animation of its own',$('#grid').dataset.dotAnimation==='ping');
  choose('refreshEffect','bar');
  ok('the new refresh effects apply',$('#grid').dataset.refreshEffect==='bar');
  choose('animationSchedule','new');
  ok('effects can be limited to unread cards',w.Store.ui().animationSchedule==='new');
  choose('animationSchedule','continuous');

  /* backgrounds */
  click($('#card-body [data-background-preset="cinematic"]'));
  ok('background presets set the related controls together',
    w.Store.ui().washEffect==='kenburns' && w.Store.ui().washMask==='bottom' && w.Store.ui().avatarWash===34);
  set($('#s-avatarWash'),60);
  choose('washFit','tile');
  choose('washMask','radial');
  choose('washBlend','screen');
  choose('washOverlay','scanlines');
  choose('washOverlayColor','accent');
  set($('#s-washSaturate'),140);
  set($('#s-washContrast'),120);
  set($('#s-washRotate'),12);
  set($('#s-washHoverBoost'),160);
  const bg=cardOf(dials.id);
  ok('background opacity is no longer capped at a third',w.Store.ui().avatarWash===60 && bg.style.getPropertyValue('--wash')==='0.600');
  ok('fit, mask and blend are the card\u2019s own attributes',
    bg.dataset.washFit==='tile' && bg.dataset.washMask==='radial' && bg.dataset.washBlend==='screen');
  ok('colour, contrast, angle and hover boost are numbers on the card',
    bg.style.getPropertyValue('--wash-sat')==='1.4' && bg.style.getPropertyValue('--wash-contrast')==='1.2' &&
    bg.style.getPropertyValue('--wash-rot')==='12deg' && bg.style.getPropertyValue('--wash-boost')==='1.6');
  ok('an overlay carries the colour it was told to take',
    bg.dataset.washOverlay==='scanlines' && bg.style.getPropertyValue('--overlay-c')===w.Store.ui().accent);
  choose('cardTint','category');
  set($('#s-cardTintStrength'),24);
  choose('cardGradient','radial');
  const ground=cardOf(dials.id);
  ok('the card ground is a layer of its own',!!ground.querySelector('.ground'));
  ok('a card tint takes the category colour',
    ground.dataset.cardTint==='category' && ground.style.getPropertyValue('--tint-c')==='var(--c)' &&
    ground.style.getPropertyValue('--tint-strength')==='0.24' && ground.dataset.cardGradient==='radial');

  /* the latest video box */
  choose('previewThumbSize','l');
  choose('previewMode','click');
  ok('the box knows its size and how it is opened',
    cardOf(dials.id).dataset.thumbSize==='l' && cardOf(dials.id).dataset.videoPreview==='click');
  click($('#card-body [data-k="previewTitle"]'));
  click($('#card-body [data-k="previewAge"]'));
  ok('the title and the age can each be switched off',
    cardOf(dials.id).querySelector('.video-title').hidden && cardOf(dials.id).querySelector('.video-age').hidden);
  click($('#card-body [data-k="previewTitle"]'));
  click($('#card-body [data-k="previewAge"]'));
  click($('#card-body [data-k="previewOnlyFresh"]'));
  const stale=w.Store.addChannel({url:'https://www.youtube.com/@stale',name:'Stale fixture'});
  w.Store.enrich(stale.id,{latest:{videoId:'staleVideo',at:Date.now()-96*3600000,title:'Stale title'}});
  set($('#q'),'');
  ok('the box can be kept to fresh uploads only',
    !cardOf(dials.id).querySelector('.video-panel').hidden && cardOf(stale.id).querySelector('.video-panel').hidden);
  click($('#card-body [data-k="previewOnlyFresh"]'));
  click($('#sheet-card [data-close]'));

  /* one channel refusing it */
  click(cardOf(dials.id).querySelector('.card-edit'));
  ok('the channel pane offers the box as an exception',!$('#c-preview').hidden && $('#c-preview').textContent.includes('on'));
  click($('#c-preview'));
  ok('one channel can hide its own latest video box',
    w.Store.channels().find(c=>c.id===dials.id).hidePreview && cardOf(dials.id).querySelector('.video-panel').hidden);
  ok('and the rest of the board keeps theirs',!cardOf(stale.id).querySelector('.video-panel').hidden);
  click($('#c-preview'));
  ok('and it can be given back',!w.Store.channels().find(c=>c.id===dials.id).hidePreview);
  click($('#sheet-ch [data-close]'));

  /* the box's own hide button — the same channel switch, reached from the card */
  click($('#btn-card'));
  choose('previewMode','always');
  ok('the box carries a hide button of its own',
    !cardOf(dials.id).querySelector('.video-hide').hidden);
  click(cardOf(dials.id).querySelector('.video-hide'));
  ok('clicking it takes the box off that one card',
    w.Store.channels().find(c=>c.id===dials.id).hidePreview &&
    cardOf(dials.id).querySelector('.video-panel').hidden);
  ok('and only that one',!cardOf(stale.id).querySelector('.video-panel').hidden);
  w.Store.togglePreview(dials.id);
  click($('#card-body [data-k="previewHideButton"]'));
  ok('the button itself is a setting',
    cardOf(dials.id).querySelector('.video-hide').hidden);
  click($('#card-body [data-k="previewHideButton"]'));
  choose('previewAnimation','slide');
  ok('and the box knows how it is meant to appear',
    cardOf(dials.id).dataset.previewAnimation==='slide');

  click($('#card-body [data-k="previewLabel"]'));
  ok('the latest-video label can be removed',
    cardOf(dials.id).querySelector('.video-toggle').classList.contains('label-hidden'));
  ok('a new upload gives the card its own cue',cardOf(dials.id).classList.contains('has-preview-cue'));
  cardOf(dials.id).dispatchEvent(new w.Event('pointerenter'));
  ok('hovering settles the cue into its small indicator',
    cardOf(dials.id).classList.contains('preview-cue-seen') && !!cardOf(dials.id).querySelector('.video-indicator'));
  choose('previewDismissAnimation','none');
  click(cardOf(dials.id).querySelector('.video-title'));
  ok('clicking the preview dismisses that upload',
    cardOf(dials.id).querySelector('.video-panel').hidden &&
    w.Store.channels().find(c=>c.id===dials.id).previewDismissed.includes('dialsVideo'));
  const cardCss=fs.readFileSync(path.join(APP,'css','hub.css'),'utf8');
  ok('dismissal lets the card and grid resize smoothly',
    cardCss.includes('min-height calc(var(--resize-cycle,.28s) * var(--mo))') && cardCss.includes('.grid>.card{align-self:start'));
  w.Store.enrich(dials.id,{latest:{videoId:'dialsVideo2',at:Date.now(),title:'A later upload'}});
  set($('#q'),'');
  ok('a later upload is not hidden by the earlier dismissal',!cardOf(dials.id).querySelector('.video-panel').hidden);

  click($('#card-body [data-k="slot-posted"] .part-sw'));
  ok('posted time is an independently placed element',
    cardOf(dials.id).querySelector('.b-posted').dataset.part==='posted' &&
    cardOf(dials.id).querySelector('.b-seen').dataset.part==='seen');

  w.Store.updateCat(cat.id,{icon:'book'});set($('#q'),'');
  click($('#card-body [data-k="slot-catIcon"] .part-sw'));
  ok('a category icon is a card element of its own',!!cardOf(dials.id).querySelector('.card-cat-icon .ico'));

  click($('[data-preview="manual"]'));
  const manual=$('#card-prev .card');
  ok('manual mode shows every movable element',
    manual.dataset.manual==='true' && manual.querySelectorAll('[data-part]').length===w.HubModel.PART_KEYS.length);
  click($('#preview-hidden'));
  ok('the preview can hide disabled elements',manual.querySelectorAll('[data-part]').length<w.HubModel.PART_KEYS.length);
  click($('#preview-hidden'));
  ok('and reveal them again',manual.querySelectorAll('[data-part]').length===w.HubModel.PART_KEYS.length);
  const transfer={value:'',setData(_type,value){this.value=value},getData(){return this.value}};
  const dragEvent=(type,target,clientX=0,clientY=0)=>{
    const event=new w.MouseEvent(type,{bubbles:true,cancelable:true,clientX,clientY});
    Object.defineProperty(event,'dataTransfer',{value:transfer});target.dispatchEvent(event);
  };
  dragEvent('dragstart',manual.querySelector('[data-part="desc"]'));
  dragEvent('drop',manual.querySelector('.zone[data-z="br"]'));
  ok('dragging moves an element to a responsive grid cell',
    w.Store.ui().slots.desc==='br' && manual.querySelector('[data-part="desc"]').closest('.zone').dataset.z==='br');
  dragEvent('dragstart',manual.querySelector('[data-part="name"]'));
  const description=manual.querySelector('[data-part="desc"]');
  dragEvent('dragover',description,-1);
  dragEvent('drop',description,-1);
  ok('elements in a grid cell can be reordered',
    w.Store.ui().orders.br.indexOf('name')<w.Store.ui().orders.br.indexOf('desc'));
  click($('#manual-fullscreen'));
  ok('manual mode has a fullscreen editing view',
    $('.card-stage').classList.contains('manual-fullscreen') && $('#manual-fullscreen').getAttribute('aria-pressed')==='true');
  click($('#manual-fullscreen'));

  /* the rest of the background */
  choose('washEffect','kenburns');
  choose('washMask','vignette');
  choose('washFit','width');
  choose('washBlend','difference');
  choose('washOverlay','mesh');
  choose('washOverlayBlend','screen');
  set($('#s-washBrightness'),140);
  set($('#s-washHue'),90);
  set($('#s-washAnimationSpeed'),9);
  set($('#s-washFade'),60);
  set($('#s-washOverlayAngle'),40);
  const deep=cardOf(dials.id);
  ok('the newest background answers are attributes on the card',
    deep.dataset.washEffect==='kenburns' && deep.dataset.washMask==='vignette' &&
    deep.dataset.washFit==='width' && deep.dataset.washBlend==='difference' &&
    deep.dataset.washOverlay==='mesh' && deep.dataset.washOverlayBlend==='screen');
  ok('and brightness, hue, speed, reach and angle are numbers on it',
    deep.style.getPropertyValue('--wash-bright')==='1.4' &&
    deep.style.getPropertyValue('--wash-hue')==='90deg' &&
    deep.style.getPropertyValue('--wash-cycle')==='9s' &&
    deep.style.getPropertyValue('--wash-fade')==='0.6' &&
    deep.style.getPropertyValue('--overlay-angle')==='40deg');

  /* texture and shadow, which are backgrounds that are not pictures */
  choose('cardTexture','crosshatch');
  choose('cardShadow','deep');
  set($('#s-cardTextureOpacity'),24);
  set($('#s-cardTextureScale'),14);
  ok('a texture is a layer of its own on every card',
    !!cardOf(dials.id).querySelector('.texture'));
  ok('and it knows its pattern, its strength and its size',
    cardOf(dials.id).dataset.texture==='crosshatch' &&
    cardOf(dials.id).dataset.cardShadow==='deep' &&
    cardOf(dials.id).style.getPropertyValue('--texture-opacity')==='0.240' &&
    cardOf(dials.id).style.getPropertyValue('--texture-size')==='14px');
  choose('cardTexture','none');
  ok('and none really is off, not merely faint',
    cardOf(dials.id).style.getPropertyValue('--texture-opacity')==='0');

  /* where a wave starts, and how many times it runs */
  choose('freshAnimation','wave');
  set($('#s-animationStagger'),200);
  choose('staggerOrder','reverse');
  const cards=$$('#grid .card');
  ok('reversing the order counts the last card as first',
    cards[cards.length-1].style.getPropertyValue('--i')==='0' &&
    cards[0].style.getPropertyValue('--i')===String(cards.length-1));
  choose('staggerOrder','index');
  ok('and putting it back counts from the front again',
    cards[0].style.getPropertyValue('--i')==='0');
  set($('#s-freshLoops'),3);
  ok('a lit card can be told to settle down',
    cardOf(dials.id).style.getPropertyValue('--fresh-loops')==='3');
  set($('#s-freshLoops'),0);
  ok('and 0 is still forever',
    cardOf(dials.id).style.getPropertyValue('--fresh-loops')==='infinite');
  click($('#sheet-card [data-close]'));

  click($('#btn-resize'));
  set($('[data-resize="cardWidth"]'),316);
  set($('[data-resize="cardHeight"]'),176);
  set($('[data-resize="cardRadius"]'),18);
  set($('[data-resize="washScale"]'),135);
  ok('the home resize menu writes all four card dimensions',
    w.Store.ui().size==='custom' && w.Store.ui().cardWidth===316 && w.Store.ui().cardHeight===176 &&
    w.Store.ui().cardRadius===18 && w.Store.ui().washScale===135);
  ok('home resizing updates the board without rebuilding its cards',
    $('#grid').style.getPropertyValue('--card-width')==='316px' &&
    $('#grid').style.getPropertyValue('--card-height')==='176px');
  click($('#btn-card'));
  ok('the editor preview uses the dimensions from resizing mode',
    $('#card-prev').style.getPropertyValue('--card-width')==='316px' &&
    $('#card-prev').style.getPropertyValue('--card-height')==='176px');
  choose('headFont','syne');choose('bodyFont','manrope');choose('metaFont','spacemono');
  ok('heading, body and metadata fonts can be chosen separately',
    d.documentElement.style.getPropertyValue('--head').includes('Syne') &&
    d.documentElement.style.getPropertyValue('--body').includes('Manrope') &&
    d.documentElement.style.getPropertyValue('--mono').includes('Space Mono'));
  click($('#sheet-card [data-close]'));
  click($('#resize-done'));

  /* the page's own background */
  click($('#btn-set'));
  click($('#set-body [data-k="pageBg"] [data-v="aurora"]'));
  set($('#s-pageBgStrength'),70);
  set($('#s-pageBgScale'),40);
  set($('#s-pageBgAngle'),200);
  const html=w.document.documentElement;
  ok('the page carries its background as one attribute',html.dataset.pageBg==='aurora');
  ok('with its strength, its size and its angle beside it',
    html.style.getPropertyValue('--page-bg-a')==='0.7' &&
    html.style.getPropertyValue('--page-bg-size')==='40px' &&
    html.style.getPropertyValue('--page-bg-angle')==='200deg');
  ok('and it follows the accent until it is given a colour of its own',
    html.style.getPropertyValue('--page-bg-c')===w.Store.ui().accent);
  click($('#sheet-set [data-close]'));click($('#btn-card'));
  click($('#card-body [data-k="pageBgAnimate"]'));
  ok('moving is a switch of its own',html.classList.contains('page-bg-animate'));
  click($('#card-body [data-k="pageBgAnimate"]'));
  click($('#sheet-card [data-close]'));click($('#btn-set'));
  click($('#set-body [data-k="pageBg"] [data-v="plain"]'));
  ok('and plain leaves the ground exactly as it was',
    html.dataset.pageBg==='plain' && !html.classList.contains('page-bg-animate'));
  click($('#sheet-set [data-close]'));

  const clean=w.eval('HubModel.fillUi({washMask:"junk",washSaturate:900,washRotate:-900,cardEnter:"nope",animationStagger:"bad",previewThumbSize:"xl",washOverlayCustom:"red",washHue:900,staggerOrder:"sideways",cardTexture:"velvet",pageBg:"lava",freshLoops:99,pageBgColor:"blue",enterEasing:"whoosh"})');
  ok('the new dials fall back and clamp like the old ones',
    clean.washMask==='diagonal' && clean.washSaturate===200 && clean.washRotate===-45 &&
    clean.cardEnter==='rise' && clean.animationStagger===0 && clean.previewThumbSize==='m' && clean.washOverlayCustom==='');
  ok('and so does every one added with them',
    clean.washHue===180 && clean.staggerOrder==='index' && clean.cardTexture==='none' &&
    clean.pageBg==='plain' && clean.freshLoops===10 && clean.pageBgColor==='' &&
    clean.enterEasing==='out');
  w.Store.removeChannel(dials.id);w.Store.removeChannel(stale.id);
}

console.log('\ntwo boards');
{
  w.Store.setUi({ ...w.HubModel.DEFAULT_UI, savedLooks:[], categoryLooks:{}, pinnedLook:'' });
  const $tab = key => $('#tabs .tab[data-tab="' + key + '"]');
  /* A card that has left the board is faded out and then removed, and the
     removal is a promise. So every check that a card is *gone* has to let that
     promise run first, and while one is still fading the newest node with a
     given id is the live one. */
  const settle = () => new Promise(r => setTimeout(r, 0));
  const nodesFor = id => $$('#grid .card[data-id="' + id + '"]');
  const cardOf = id => nodesFor(id)[nodesFor(id).length - 1] || null;
  const shows = id => nodesFor(id).length > 0;
  set($('#q'), '');

  ok('the strip offers both boards', !!$tab('youtube') && !!$tab('instagram'));
  ok('and youtube is the one showing',
     $tab('youtube').classList.contains('on') && $tab('youtube').getAttribute('aria-selected') === 'true');

  const tube = w.Store.addChannel({ url:'https://www.youtube.com/@tubefixture', name:'Tube fixture' });
  const gram = w.Store.addChannel({ url:'https://www.instagram.com/gramfixture/', name:'Gram fixture' });
  set($('#q'), '');
  await settle();

  ok('a url decides which board a record is on',
     tube.platform === 'youtube' && gram.platform === 'instagram');
  ok('the youtube board shows the channel', shows(tube.id));
  ok('and does not show the account',       !shows(gram.id));

  click($tab('instagram'));
  await settle();
  ok('switching boards is remembered', w.Store.ui().tab === 'instagram');
  ok('the instagram board shows the account', shows(gram.id));
  ok('and does not show the channel',         !shows(tube.id));
  ok('the strip moves with it',
     $tab('instagram').classList.contains('on') && !$tab('youtube').classList.contains('on'));

  ok('the controls change language',
     $('#q').placeholder === 'search accounts' && $('#btn-add').textContent === '+ account' &&
     $('#sort-posted').textContent === 'newest post');
  ok('and so does the count line', $('#meta').textContent.includes('account'));

  /* categories belong to a board */
  const igCats = w.Store.cats();
  ok('the second board seeded its own categories',
     igCats.length === 5 && igCats.every(c => c.platform === 'instagram'));
  ok('and they are not the first board\u2019s',
     igCats.some(c => c.name === 'friends') && !igCats.some(c => c.name === 'learning'));
  const made = w.Store.addCat('makers', '#A78BFA', '');
  ok('a category made here belongs here', made.platform === 'instagram');
  click($tab('youtube'));
  await settle();
  ok('and is not on the other board', !w.Store.cats().some(c => c.id === made.id));
  ok('which still has its own five', w.Store.cats().every(c => c.platform === 'youtube'));
  ok('while a lookup by id still finds either', !!w.Store.cat(made.id));

  /* the chips are this board's */
  set($('#q'), '');
  const chipNames = () => $$('#chips .chip .t').map(el => el.textContent);
  ok('the youtube chips are youtube\u2019s', chipNames().includes('learning'));
  click($tab('instagram'));
  await settle();
  ok('and the instagram chips are instagram\u2019s',
     chipNames().includes('friends') && !chipNames().includes('learning'));

  /* a url that belongs on the other board says so and goes there */
  click($('#btn-add'));
  set($('#c-url'), 'https://www.youtube.com/@elsewhere');
  set($('#c-name'), 'Elsewhere');
  $('#f-ch').dispatchEvent(new w.Event('submit', { bubbles:true, cancelable:true }));
  ok('a youtube url added from the instagram tab is filed as a channel',
     w.Store.channels().find(c => c.name === 'Elsewhere').platform === 'youtube');
  ok('and the board follows it rather than swallowing it', w.Store.ui().tab === 'youtube');

  /* counts, heat and the new dot are all per board */
  click($tab('youtube'));
  await settle();
  const ytMax = w.Store.maxClicks();
  click($tab('instagram'));
  await settle();
  ok('a board with nothing opened on it has no heat yet', w.Store.maxClicks() === 0);
  w.Store.touch(gram.id); w.Store.touch(gram.id); w.Store.touch(gram.id);
  ok('the heat scale is this board\u2019s', w.Store.maxClicks() === 3);
  click($tab('youtube'));
  await settle();
  ok('and the other board is untouched by it', w.Store.maxClicks() === ytMax);

  /* An account nobody has opened, with something posted since: the one shape
     that reads as new. `gram` has been opened three times just above, so its
     newest post is older than the last look at it and is deliberately not. */
  w.Store.enrich(gram.id, { latest:{ videoId:'AAA111', at:Date.now() - 1000, title:'a post' } });
  const unseen = w.Store.addChannel({ url:'https://www.instagram.com/unseenfixture/', name:'Unseen fixture' });
  w.Store.enrich(unseen.id, { latest:{ videoId:'BBB222', at:Date.now() - 1000, title:'a newer post' } });
  set($('#q'), '');
  await settle();
  ok('a board you are not looking at can still say it has something new',
     !!$tab('instagram').querySelector('.tab-new'));
  ok('and an account opened since it posted is not new',
     !w.Store.isNew(w.Store.channels().find(c => c.id === gram.id)));
  ok('the count on the bar is the board in front of you',
     w.Store.countNew() === w.Store.countNewOn('youtube') && w.Store.countNewOn('instagram') >= 1);

  /* the latest-post box points at instagram, not at youtube */
  click($tab('instagram'));
  set($('#q'), '');
  await settle();
  const open = cardOf(gram.id).querySelector('.video-open');
  ok('the newest post opens on instagram',
     open.getAttribute('href') === 'https://www.instagram.com/p/AAA111/');

  /* an export carries both boards, and an old one is topped up */
  const dump = JSON.parse(w.Store.exportJSON());
  ok('an export carries both boards',
     dump.channels.some(c => c.platform === 'instagram') &&
     dump.cats.some(c => c.platform === 'instagram') && dump.ui.tab === 'instagram');

  const legacy = JSON.stringify({ kind:'hub.export', version:2, at:new Date().toISOString(),
    channels:[{ url:'https://www.youtube.com/@legacy', name:'Legacy', added:Date.now() }],
    cats:[{ id:'c1', name:'old', color:'#A78BFA', order:0 }], ui:{}, queue:[] });
  w.Store.importJSON(legacy);
  ok('a board written before there were two is a youtube board',
     w.Store.channels()[0].platform === 'youtube' && w.Store.allCats()[0].platform === 'youtube');
  ok('and the empty board is topped up rather than left bare',
     w.Store.allCats().filter(c => c.platform === 'instagram').length === 5);
}

console.log('\nlooking an instagram account up');
{
  /* Instagram has no feed, so a check is a page opened in a background tab and
     read by the content script. Here the tab is the stub: what is being tested
     is the half that decides *what to open and what the answer means* — which
     shortcode counts as new, when the second load is worth making, and what
     happens when it fails. */
  const pages = new Map();
  const calls = [];
  w.chrome = { runtime: { id:'test', sendMessage(msg, cb){
    calls.push(msg.url);
    cb(msg.type === 'igProbe' ? (pages.get(msg.url) || null) : null);
  } } };

  const profile = (handle, posts, avatar) => pages.set('https://www.instagram.com/' + handle + '/',
    { kind:'profile', profile:{ handle, name:'@' + handle, avatar:avatar || 'https://cdn/' + handle + '.jpg', posts } });
  const post = (code, at, title) => pages.set('https://www.instagram.com/p/' + code + '/',
    { kind:'post', post:{ shortcode:code, at, title, thumb:'https://cdn/' + code + '.jpg' } });

  w.Store.setUi({ ...w.HubModel.DEFAULT_UI, savedLooks:[], categoryLooks:{}, pinnedLook:'', tab:'instagram' });
  const acct = w.Store.addChannel({ url:'https://www.instagram.com/probefixture/', name:'Probe fixture' });
  const rec = () => w.Store.channels().find(c => c.id === acct.id);
  const runIG = () => w.eval("HubEnrich.pass({force:true,platform:'instagram',ui:{igLanes:1}})");

  /* First look: nothing is known, so the newest post is read to give the card
     something to show. */
  const posted = Date.now() - 3600e3;
  profile('probefixture', ['AAA111', 'BBB222', 'CCC333']);
  post('AAA111', posted, 'the newest one');
  calls.length = 0;
  let out = await runIG();

  ok('one account is one job', out.done === 1 && out.failed === 0);
  ok('the profile and then one post, and nothing else', calls.length === 2 &&
     calls[0] === 'https://www.instagram.com/probefixture/' &&
     calls[1] === 'https://www.instagram.com/p/AAA111/', calls.join(' '));
  ok('the picture comes off the profile', rec().avatar === 'https://cdn/probefixture.jpg');
  ok('and the top of the grid is remembered',
     JSON.stringify(rec().igPosts) === JSON.stringify(['AAA111','BBB222','CCC333']));
  ok('the newest post is stored the way youtube stores one',
     rec().latest.videoId === 'AAA111' && rec().latest.at === posted &&
     rec().latest.title === 'the newest one');
  ok('which is what makes it fresh on this board too', w.Store.isFresh(rec()));

  /* Nothing has changed, so the second load is not worth making. */
  calls.length = 0;
  await runIG();
  ok('a grid that has not moved costs one load, not two', calls.length === 1);
  ok('and the newest post is left alone', rec().latest.videoId === 'AAA111');

  /* A pinned post sits at the front forever. The one that is actually new is
     behind it, and it is the one that has to be picked up. */
  profile('probefixture', ['AAA111', 'DDD444', 'BBB222']);
  const later = Date.now() - 60e3;
  post('DDD444', later, 'posted since');
  calls.length = 0;
  await runIG();
  ok('a new post behind a pinned one is still found',
     calls[1] === 'https://www.instagram.com/p/DDD444/' && rec().latest.videoId === 'DDD444');
  ok('and it carries its own real time', rec().latest.at === later);
  ok('an account nobody has opened since then reads as new', w.Store.isNew(rec()));

  /* The grid was read and the post was not. Recording the codes anyway would
     make that post permanently un-new, so nothing is recorded. */
  const before = JSON.stringify(rec().igPosts);
  profile('probefixture', ['EEE555', 'AAA111', 'DDD444']);
  calls.length = 0;
  out = await runIG();
  ok('a post that will not open is a failure', out.failed === 1);
  ok('and the grid is not recorded, so the post is still new next time',
     JSON.stringify(rec().igPosts) === before);
  ok('while what was already known survives it', rec().latest.videoId === 'DDD444');

  /* A login wall is not an empty account. */
  pages.set('https://www.instagram.com/probefixture/', { kind:'wall' });
  const known = JSON.stringify(rec().latest);
  out = await runIG();
  ok('a login wall is a failure, not an empty account', out.failed === 1);
  ok('and it never empties the board', JSON.stringify(rec().latest) === known);

  /* The other board is not touched by any of this. */
  const tube = w.Store.addChannel({ url:'https://www.youtube.com/@notprobed', name:'Not probed' });
  calls.length = 0;
  await runIG();
  ok('a youtube channel is not opened in a tab',
     !calls.some(u => u && u.includes('youtube.com')));
  ok('and is left exactly as it was', !w.Store.channels().find(c => c.id === tube.id).igPosts.length);

  w.Store.removeChannel(acct.id); w.Store.removeChannel(tube.id);
  delete w.chrome;
}

console.log('\nsummary');
ok('no system dialog was reached at any point', systemDialogs === 0, systemDialogs + ' calls');
ok('no errors on the console', errors.length === 0, errors.join(' | '));

w.close();
console.log('\n' + pass + ' passed, ' + fails.length + ' failed');
if (fails.length){ fails.forEach(f => console.log('  - ' + f)); process.exit(1) }
