/* ── Popup ────────────────────────────────────────────────────────────────────
   The toggle the request asked for, plus the pause and a way to the board. It
   holds no state of its own — every button sends a message and redraws from
   whatever comes back, so it cannot disagree with the guard. */
(() => {

const $ = s => document.querySelector(s);

const ask = msg => new Promise(resolve => {
  try { chrome.runtime.sendMessage(msg, res => { void chrome.runtime.lastError; resolve(res || null) }) }
  catch { resolve(null) }
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
  draw(current = await ask({ type:'snooze', minutes:15 }));
});

$('#addmode').addEventListener('click', async () => {
  if (!current) return refresh();
  draw(current = await ask({ type:'setAddMode', on:!current.addMode }));
});

$('#board').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('index.html') });
  window.close();
});

refresh();
setInterval(refresh, 5000);            /* the pause counts itself down */

})();
