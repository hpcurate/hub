import {JSDOM,ResourceLoader,VirtualConsole} from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
class Loader extends ResourceLoader{
  fetch(url){const u=new URL(url);return Promise.resolve(u.pathname.endsWith('.js')?fs.readFileSync(path.join(root,u.pathname.replace(/^\/hub\//,''))):Buffer.from(''))}
}
const now=Date.now();
const channels=[1,2,3,40,-1].map((hours,i)=>({id:'c'+i,name:'Channel '+i,url:'https://www.youtube.com/@channel'+i,cat:'cat',clicks:0,added:now,seen:0,
  latest:{videoId:'video'+i,title:'Upload <'+i+'>',at:now-hours*3600000}}));
const bag={'hub.channels.v1':JSON.stringify(channels),'hub.cats.v1':JSON.stringify([{id:'cat',name:'Watch',color:'#aabbcc'}]),'hub.ui.v1':JSON.stringify({popupLimit:2})};
const messages=[],tabs=[],errors=[];let changed,closeWindow;let state={enabled:true,guarding:true,addMode:false,snoozeUntil:0};
const vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
const dom=new JSDOM(fs.readFileSync(path.join(root,'ext/popup.html'),'utf8'),{
  url:'http://localhost/hub/ext/popup.html',runScripts:'dangerously',resources:new Loader(),pretendToBeVisual:true,virtualConsole:vc,
  beforeParse(w){closeWindow=w.close.bind(w);w.close=()=>{};w.chrome={
    runtime:{id:'hub',getURL:p=>'chrome-extension://hub/'+p,sendMessage:(msg,reply)=>{
      messages.push(msg);
      if(msg.type==='snooze')state={...state,snoozeUntil:now+msg.minutes*60000,guarding:!msg.minutes};
      if(msg.type==='setEnabled')state={...state,enabled:msg.on,guarding:msg.on};
      if(msg.type==='setAddMode')state={...state,addMode:msg.on,guarding:!msg.on};
      reply(state);
    }},tabs:{create:async options=>{tabs.push(options);return {id:1}}},
    storage:{local:{get:async()=>({...bag}),set:async patch=>Object.assign(bag,patch)},onChanged:{addListener:fn=>changed=fn}}
  }}
});
const w=dom.window,d=w.document,$=s=>d.querySelector(s),click=s=>$(s).click();
await new Promise(r=>w.addEventListener('load',r));await w.eval('Store.ready');
const tick=()=>new Promise(r=>setTimeout(r,0));await tick();
let checks=0;const check=(name,fn)=>{fn();checks++;console.log('ok '+name)};
check('fresh previews honor the limit and exclude old or future uploads',()=>{
  assert.equal(d.querySelectorAll('.popup-upload').length,2);assert.match($('#fresh-heading').textContent,/3 · last 24h/);
});
check('titles remain text',()=>assert.equal($('.popup-upload-text span').textContent,'Upload <0>'));
click('.popup-upload-actions button:nth-child(2)');await tick();
check('queue action saves the video and disables duplicates',()=>{
  assert.equal(w.eval('Store.queue()')[0].videoId,'video0');assert.equal($('.popup-upload-actions button:nth-child(2)').disabled,true);
});
click('.popup-upload-actions button');await tick();
check('opening a preview grants only its video',()=>assert.equal(messages.at(-1).type,'openVideo'));
for(const [id,query] of [['settings','?panel=settings'],['design','?panel=card'],['queue','?panel=queue'],['today','?view=today'],['refresh-info','?refresh=1']]){
  click('#'+id);await tick();check(id+' opens the matching board destination',()=>assert.equal(tabs.at(-1).url,'chrome-extension://hub/index.html'+query));
}
click('#random');await tick();check('random uses a channel grant',()=>assert.equal(messages.at(-1).type,'openInTab'));
click('#snooze');await tick();check('pause changes to resume',()=>assert.equal($('#snooze').textContent,'resume guarding'));
click('#snooze');await tick();check('resume cancels the pause',()=>assert.equal(messages.at(-1).minutes,0));
click('#clear-dots');await tick();check('dots can be cleared from the popup',()=>assert.equal(w.eval('Store.countNew()'),0));
bag['hub.ui.v1']=JSON.stringify({popupFresh:false,popupQueue:false,popupGuard:false,popupQuickActions:false});
changed({'hub.ui.v1':{newValue:bag['hub.ui.v1']}},'local');await tick();
check('popup settings apply from extension storage',()=>{
  for(const id of ['popup-fresh','queue','guard-controls','popup-actions'])assert.equal($('#'+id).hidden,true);
  assert.equal($('#settings').hidden,false);
});
check('popup has no runtime errors',()=>assert.deepEqual(errors,[]));
closeWindow();
console.log(checks+' popup checks passed');
