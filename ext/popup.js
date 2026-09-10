/* ── Popup ────────────────────────────────────────────────────────────────────
   The toggle the request asked for, plus the pause and a way to the board. It
   holds no state of its own — every button sends a message and redraws from
   whatever comes back, so it cannot disagree with the guard. */
(() => {

const $ = s => document.querySelector(s);

const ask = msg => new Promise(resolve => {
  const timeout=setTimeout(()=>resolve(null),3000);
  try { chrome.runtime.sendMessage(msg, res => { clearTimeout(timeout);void chrome.runtime.lastError; resolve(res || null) }) }
  catch { clearTimeout(timeout);resolve(null) }
});

function draw(s){
  const state = $('#state'), t = $('#state-t'), toggle = $('#toggle');

  if (!s){
    state.className = 'state';
    t.textContent = 'not answering';
    toggle.textContent = 'retry';
    return;
  }

  const paused = s.enabled && !s.addMode && Date.now() < (s.snoozeUntil || 0);

  state.className = 'state' + (s.guarding ? ' on' : s.addMode ? ' adding' : paused ? ' paused' : '');

  if (s.guarding)      t.textContent = 'guarding youtube';
  else if (s.addMode)  t.textContent = 'add mode — not guarding';
  else if (paused){
    const left = Math.max(0, Math.ceil((s.snoozeUntil - Date.now()) / 60000));
    t.textContent = 'paused, ' + left + ' min left';
  }
  else t.textContent = 'off';

  toggle.textContent = s.enabled ? 'turn off' : 'turn on';
  toggle.classList.toggle('y', !s.enabled);
  $('#snooze').hidden = !s.enabled || s.addMode;
  $('#snooze').textContent = paused ? 'resume guarding' : 'pause 15 min';
  $('#addmode').hidden = !s.enabled;
  $('#addmode-k').textContent = s.addMode ? 'on' : 'off';
  $('#addmode').classList.toggle('y', s.addMode);
}

let current = null;
const refresh = async () => draw(current = await ask({ type:'status' }));

$('#toggle').addEventListener('click', async () => {
  /* When it is not answering there is nothing to toggle — ask again instead. */
  if (!current) return refresh();
  draw(current = await ask({ type:'setEnabled', on:!current.enabled }));
});

$('#snooze').addEventListener('click', async () => {
  const paused=current && Date.now() < (current.snoozeUntil || 0);
  draw(current = await ask({ type:'snooze', minutes:paused ? 0 : 15 }));
});

$('#addmode').addEventListener('click', async () => {
  if (!current) return refresh();
  draw(current = await ask({ type:'setAddMode', on:!current.addMode }));
});

const notice = text => {$('#popup-notice').textContent=text};
async function openBoard(query=''){
  try {await chrome.tabs.create({url:chrome.runtime.getURL('index.html')+query});window.close()}
  catch {notice('Could not open HUB. Try again.')}
}
$('#board').addEventListener('click',()=>openBoard());
$('#today').addEventListener('click',()=>openBoard('?view=today'));
$('#settings').addEventListener('click',()=>openBoard('?panel=settings'));
$('#design').addEventListener('click',()=>openBoard('?panel=card'));
$('#queue').addEventListener('click',()=>openBoard('?panel=queue'));
$('#refresh-info').addEventListener('click',()=>openBoard('?refresh=1'));
$('#clear-dots').addEventListener('click',()=>{
  const n=Store.clearNew();drawBoard();notice('Cleared '+n+' new-video dots.');
});
/* Opening one record, on whichever site it belongs to. YouTube needs a grant
   before the tab loads or the guard sends it straight back to the board;
   Instagram has no guard, so it is a plain tab and nothing else. Both are the
   same question to the caller, which is the point of having this here. */
const openRecord=(ch,ui)=>{
  if(ch.platform==='instagram')
    return ask({type:'openPlain',url:HubIG.onTab(ch.url,ui.igTab)});
  const scope=HubScope.parse(ch.url);
  if(!scope) return Promise.resolve(null);
  return ask({type:'openInTab',scope,url:HubScope.onTab(ch.url,ui.openTab)});
};
const itemUrl=ch=>ch.platform==='instagram'
  ? HubIG.postUrl(ch.latest.videoId)
  : 'https://www.youtube.com/watch?v='+encodeURIComponent(ch.latest.videoId);

$('#random').addEventListener('click',async()=>{
  /* Whatever is on the board that can actually be opened — both boards, since
     a popup is not standing on either of them. */
  const channels=Store.channels().filter(c=>c.platform==='instagram'?HubIG.parse(c.url):HubScope.parse(c.url));
  if(!channels.length){notice('Add a channel or an account to the board first.');return}
  const ch=channels[Math.floor(Math.random()*channels.length)];
  const result=await openRecord(ch,Store.ui());
  if(result){Store.touch(ch.id);window.close()}else notice('The extension did not answer. Try again.');
});

function drawBoard(){
  const ui=Store.ui();
  document.documentElement.style.setProperty('--y',ui.accent);
  $('#guard-controls').hidden=!ui.popupGuard;
  $('#popup-actions').hidden=!ui.popupQuickActions;
  $('#queue').hidden=!ui.popupQueue;
  $('#queue-count').textContent=String(Store.queue().length);
  $('#clear-dots').disabled=Store.countNew()===0;
  $('#popup-fresh').hidden=!ui.popupFresh;
  const fresh=Store.channels().filter(c=>{
    const age=HubModel.uploadAge(c);return age>=0 && age<ui.freshHours*3600000;
  }).sort((a,b)=>b.latest.at-a.latest.at);
  /* Both boards, because the popup is the one place that is not standing on
     either of them — "what is new" there means everywhere. */
  $('#fresh-heading').textContent='fresh posts · '+fresh.length+' · last '+ui.freshHours+'h';
  const list=$('#fresh-list');list.textContent='';
  if(!fresh.length){
    const p=document.createElement('p');p.className='foot';p.textContent='Nothing posted recently. Refresh the board to check again.';list.appendChild(p);
  }
  fresh.slice(0,Math.round(ui.popupLimit)).forEach(ch=>{
    const item=document.createElement('article');item.className='popup-upload';
    if(ui.popupThumbnails && ch.latest.videoId){
      const image=document.createElement('img');image.alt='';image.loading='lazy';
      image.src='https://i.ytimg.com/vi/'+encodeURIComponent(ch.latest.videoId)+'/mqdefault.jpg';
      image.onerror=()=>image.remove();item.appendChild(image);
    }
    const text=document.createElement('div');text.className='popup-upload-text';
    const name=document.createElement('strong');name.textContent=ch.name;
    const title=document.createElement('span');title.textContent=ch.latest.title || 'Latest upload';
    const age=document.createElement('small');const minutes=Math.floor(HubModel.uploadAge(ch)/60000);age.textContent=minutes<60?minutes+'m ago':Math.floor(minutes/60)+'h ago';
    text.append(name,title,age);item.appendChild(text);
    const acts=document.createElement('div');acts.className='popup-upload-actions';
    const open=document.createElement('button');open.textContent='open';open.setAttribute('aria-label','Open '+(ch.latest.title || ch.name));
    open.addEventListener('click',async()=>{
      open.disabled=true;
      const result=await (ch.latest.videoId
        ? (ch.platform==='instagram'
            ? ask({type:'openPlain',url:itemUrl(ch)})
            : ask({type:'openVideo',videoId:ch.latest.videoId,url:itemUrl(ch)}))
        : openRecord(ch,ui));
      if(result){Store.touch(ch.id);window.close()}else {open.disabled=false;notice('Could not open the upload. Try again.')}
    });
    acts.appendChild(open);
    if(ui.popupQueue && ch.latest.videoId){
      const queue=document.createElement('button');const queued=Store.queue().some(q=>q.videoId===ch.latest.videoId);
      queue.textContent=queued?'queued':'+ queue';queue.disabled=queued;
      queue.setAttribute('aria-label','Queue '+(ch.latest.title || ch.name));
      queue.addEventListener('click',()=>{
        Store.enqueue({videoId:ch.latest.videoId,url:itemUrl(ch),title:ch.latest.title,channel:ch.name,channelUrl:ch.url});
        drawBoard();notice('Added to queue.');
      });acts.appendChild(queue);
    }
    item.appendChild(acts);list.appendChild(item);
  });
  if(fresh.length>ui.popupLimit){const more=document.createElement('button');more.textContent='see all on the board';more.addEventListener('click',()=>openBoard('?view=week'));list.appendChild(more)}
}
Store.ready.then(drawBoard);
Store.onChange(drawBoard);

refresh();
setInterval(refresh, 5000);            /* the pause counts itself down */

})();
