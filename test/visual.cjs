// Real Chromium layout and motion checks. Run with an Electron executable.
const {app, BrowserWindow} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const artifacts = path.join(__dirname, 'artifacts');
fs.mkdirSync(artifacts, {recursive:true});
app.setPath('userData', path.join(artifacts, 'browser-profile'));
app.commandLine.appendSwitch('disable-gpu');
app.whenReady().then(async () => {
  const win = new BrowserWindow({show:false,width:1280,height:1000,webPreferences:{sandbox:true,contextIsolation:true,backgroundThrottling:false,offscreen:true}});
  const run = async s => {
    try { return await win.webContents.executeJavaScript(s) }
    catch (error) { throw new Error(error.message + '\nWhile evaluating: ' + s) }
  };
  const shot = async name => {
    await run('document.fonts.ready');
    // An offscreen window only advances its timeline when a frame is asked for,
    // so ask for one first: a transition that is already over can otherwise sit
    // with its finished promise unresolved, and the wait below never returns.
    await run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    await run(`Promise.race([
      Promise.all(document.getAnimations().filter(a=>a.effect.getComputedTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{}))),
      new Promise(r=>setTimeout(r,2000)),
    ])`);
    await run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    fs.writeFileSync(path.join(artifacts, name + '.png'), (await win.webContents.capturePage()).toPNG());
  };
  try {
    // Block external requests: the fixture uses local icons and makes no live requests.
    win.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({cancel:/^https?:/.test(details.url)}));
    await win.loadFile(path.join(root,'index.html'));
    await run('localStorage.clear()');
    await win.loadFile(path.join(root,'index.html'));
    await run(`(async () => {
      await Store.ready;
      const cats = Store.cats();
      ['Veritasium','Studio notes','The creative process','Sound library','Engineering explained','Field recordings'].forEach((name,i) => {
        const ch = Store.addChannel({name,url:'https://www.youtube.com/@example'+i,desc:'Ideas, experiments and stories worth coming back to.',cat:cats[i % cats.length].id});
        Store.enrich(ch.id,{avatar:new URL('icons/512.png',location.href).href,latest:{title:'A new perspective',at:Date.now()-(i%2?72:2)*3600000}});
      });
      Store.setUi({avatarWash:24,washEffect:'drift',freshBadge:true,freshColorSource:'category'});
    })()`);
    await win.reload();
    await new Promise(resolve => win.webContents.once('did-finish-load',resolve));
    await run('Store.ready');
    await run(`new Promise(r=>setTimeout(r,450))`);
    await shot('board-effects');
    assert.equal(await run(`document.querySelectorAll('#grid .is-fresh').length`),3);
    await run(`document.querySelector('#btn-card').click()`);
    await run(`new Promise(r=>setTimeout(r,350))`);
    const select = (k,v) => run(`document.querySelector('#card-body [data-k="${k}"] [data-v="${v}"]').click()`);
    const css = (selector,property) => run(`getComputedStyle(document.querySelector('${selector}')).getPropertyValue('${property}')`);
    for (const [effect,animation] of [['sheen','spine-run'],['breathe','fresh-breathe'],['ripple','fresh-ripple']]) {
      await select('freshAnimation',effect);
      const value = effect === 'sheen' ? await run(`getComputedStyle(document.querySelector('#card-prev .card'),'::before').animationName`) : await css('#card-prev .fresh-fx','animation-name');
      assert.equal(value,animation);
    }
    await select('freshStyle','tint');
    assert.notEqual(await css('#card-prev .card','background-color'),'rgb(22, 22, 22)');
    for (const effect of ['soft','mono','vivid','duotone','drift','zoom']) {
      await select('washEffect',effect);
      assert.notEqual(await css('#card-prev .wash','background-image'),'none');
    }
    await select('washEffect','drift');
    assert.equal(await css('#card-prev .wash','animation-name'),'logo-drift');
    for (const effect of ['sepia','glass','pan','rotate']) {
      await select('washEffect',effect);
      assert.notEqual(await css('#card-prev .wash','background-image'),'none');
    }
    await select('washEffect','pan');
    assert.equal(await css('#card-prev .wash','animation-name'),'logo-pan');
    await select('washEffect','rotate');
    assert.equal(await css('#card-prev .wash','animation-name'),'logo-spin');
    await select('washEffect','soft');
    await select('washFit','tile');
    assert.equal(await css('#card-prev .wash','background-repeat'),'repeat');
    await select('washFit','cover');
    await select('washMask','radial');
    assert.match(await css('#card-prev .wash','mask-image'),/radial-gradient/);
    await select('washMask','none');
    assert.equal(await css('#card-prev .wash','mask-image'),'none');
    await select('washMask','diagonal');
    await select('washBlend','screen');
    assert.equal(await css('#card-prev .wash','mix-blend-mode'),'screen');
    await select('washBlend','normal');
    await select('washOverlay','scanlines');
    assert.match(await css('#card-prev .logo-overlay','background-image'),/repeating-linear-gradient/);
    await select('washOverlay','none');
    await select('cardTint','category');
    assert.notEqual(await css('#card-prev .ground','background-color'),'rgba(0, 0, 0, 0)');
    await select('cardGradient','radial');
    assert.match(await css('#card-prev .ground','background-image'),/radial-gradient/);
    await select('cardGradient','none');
    await select('cardTint','none');
    for (const [effect,animation] of [['pulse','fresh-pulse'],['shimmer','fresh-shimmer'],['scan','fresh-scan'],
                                      ['orbit','fresh-orbit'],['flicker','fresh-flicker'],['bounce','fresh-bounce']]) {
      await select('freshAnimation',effect);
      const on = ['pulse','bounce'].includes(effect) ? '#card-prev .card' : '#card-prev .fresh-fx';
      assert.equal(await css(on,'animation-name'),animation);
    }
    await select('freshAnimation','breathe');
    await select('freshEasing','spring');
    assert.match(await css('#card-prev .fresh-fx','animation-timing-function'),/cubic-bezier/);
    await select('freshDirection','alternate');
    assert.equal(await css('#card-prev .fresh-fx','animation-direction'),'alternate');
    await select('freshEasing','ease');
    await select('freshDirection','normal');
    await select('freshAnimation','sheen');
    await select('washEffect','drift');
    await run(`document.querySelectorAll('#card-body details').forEach(el=>el.open=true)`);
    await run(`(()=>{for(const [key,value] of [['cardWidth',316],['cardHeight',176]]){const input=document.querySelector('#s-'+key);input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}))}})()`);
    await run(`document.querySelector('#card-body [data-k="slot-name"] [data-z="mc"]').click()`);
    await run(`document.querySelector('[data-preview="manual"]').click()`);
    await run(`new Promise(resolve=>setTimeout(resolve,400))`);
    assert.equal(await css('#card-prev','width'),'316px');
    assert.equal(await css('#card-prev .card','min-height'),'176px');
    assert.equal(await run(`document.querySelector('#card-prev .card-name').closest('.zone').dataset.z`),'mc');
    assert.equal(await css('#card-prev .zone[data-z="mc"]','justify-content'),'center');
    await run(`document.querySelector('#manual-fullscreen').click()`);
    assert.equal(await css('#sheet-card','width'),'1280px');
    assert(await run(`+getComputedStyle(document.querySelector('#card-prev')).zoom>1`),'fullscreen enlarges the current card');
    await shot('manual-grid-fullscreen');
    await run(`document.querySelector('#manual-fullscreen').click()`);
    win.webContents.sendInputEvent({type:'mouseMove',x:1279,y:999});
    await run(`new Promise(resolve=>setTimeout(resolve,50))`);
    await select('animationSchedule','hover');
    assert.equal(await run(`document.querySelector('#card-prev .card').dataset.schedule`),'hover');
    await select('animationSchedule','continuous');
    await select('washEffect','parallax');
    await run(`(()=>{const c=document.querySelector('#grid .card');c.dispatchEvent(new PointerEvent('pointermove',{clientX:c.getBoundingClientRect().right-10,clientY:c.getBoundingClientRect().bottom-10}))})()`);
    assert.notEqual(await run(`document.querySelector('#grid .card').style.getPropertyValue('--parallax-x')`),'');
    await select('washEffect','spotlight');
    assert.equal(await run(`document.querySelector('#card-prev .card').dataset.washEffect`),'spotlight');
    assert.match(await css('#card-prev .wash','mask-image'),/radial-gradient/);
    await select('washEffect','drift');
    await run(`document.querySelectorAll('#card-body details').forEach(el=>el.open=el.dataset.section==='posted today');document.querySelector('#sheet-card').scrollTop=0`);
    await shot('card-editor');
    await run(`document.querySelector('[data-preview="refresh"]').click()`);
    assert.equal(await css('#card-prev .refresh-fx','animation-name'),'refresh-sweep');
    await select('refreshEffect','pulse');
    assert.equal(await css('#card-prev .refresh-fx','animation-name'),'refresh-pulse');
    await select('refreshEffect','bar');
    assert.equal(await css('#card-prev .refresh-fx','animation-name'),'refresh-bar');
    await select('refreshEffect','blink');
    assert.equal(await css('#card-prev .card','animation-name'),'refresh-blink');
    await select('refreshEffect','dim');
    assert.equal(await css('#card-prev .card','opacity'),'0.55');
    await select('refreshEffect','sweep');
    await run(`document.documentElement.classList.add('motion-off')`);
    assert.equal(await css('#card-prev .refresh-fx','animation-name'),'none');
    assert.equal(await css('#card-prev .wash','animation-name'),'none');
    await run(`document.documentElement.classList.remove('motion-off');document.querySelector('[data-preview="fresh"]').click()`);
    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    await run(`new Promise(r=>setTimeout(r,80))`);
    assert.equal(await css('#card-prev .fresh-fx','animation-name'),'none');
    assert.equal(await css('#card-prev .wash','animation-name'),'none');
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[]});
    win.setContentSize(390,900);
    await run(`document.querySelectorAll('#card-body details').forEach(el=>el.open=true)`);
    await run(`document.querySelector('[data-k="freshStyle"]').scrollIntoView({block:'center'})`);
    const overflow = await run(`Array.from(document.querySelectorAll('#card-body .set-r')).filter(el=>el.scrollWidth>el.clientWidth+2).map(el=>el.dataset.k)`);
    assert.deepEqual(overflow,[]);
    await shot('mobile-fresh-controls');
    await run(`document.querySelector('#card-body [data-k="slot-name"]').scrollIntoView({block:'center'})`);
    await shot('mobile-manual-placement');
    await win.loadFile(path.join(root,'ext/popup.html'));
    await run(`window.chrome={runtime:{sendMessage:(m,cb)=>cb({enabled:true,guarding:true,addMode:false}),getURL:p=>p},tabs:{create:async()=>({id:1})}};document.querySelector('#toggle').click()`);
    win.setContentSize(390,700);
    await shot('popup-fresh-uploads');
    assert.equal(await run(`document.querySelectorAll('.popup-upload').length`),3);
    assert(await run(`document.documentElement.scrollWidth<=innerWidth`),'popup fits its viewport');
    console.log('Chromium layout, every effect and background dial, refresh animation, reduced motion and mobile overflow checks passed.');
    fs.writeFileSync(path.join(artifacts,'result.json'),JSON.stringify({passed:true}));
    app.exit(0);
  } catch(e) { fs.writeFileSync(path.join(artifacts,'result.json'),JSON.stringify({passed:false,error:e.stack}));console.error(e); app.exit(1) }
});
