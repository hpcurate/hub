/* ── The Instagram content script ─────────────────────────────────────────────
   Read-only, and that is the whole design.

   The YouTube half of HUB has a guard: a content script whose job is to take a
   page away from you until you have picked a channel. This is not that. It
   blocks nothing, hides nothing and redirects nothing — instagram.com browses
   exactly as it did before HUB was installed. It does two things:

     reports   what is on a profile page, when the board asks for it — because
               Instagram has no feed to poll, so the only way to know whether an
               account has posted is to open the page and look

     adds      a "+ add to hub" button on a profile, in add mode, so an account
               you have just found goes onto the board without typing its url

   The report is sent on every profile load, not only for the board's own
   probes. The worker keeps the ones it asked for and drops the rest, which
   costs nothing and means the code has no idea whether it is being watched —
   there is no hidden mode here, and nothing behaves differently when you are
   the one browsing.
*/
(() => {
  'use strict';

  /* Instagram is a single-page app: at document_idle the shell is up but the
     grid usually is not, and on a slow connection it can be several seconds
     behind. So the page is read on a poll rather than once, and the poll stops
     the moment there is something worth sending. */
  const SETTLE_MS = 12000;
  const STEP_MS = 400;

  const send = msg => { try { chrome.runtime.sendMessage(msg, () => void chrome.runtime.lastError) } catch {} };

  /* A profile that came back as a login wall has no handle and no grid. It is
     reported as a failure rather than as an empty account, because "nobody is
     signed in" and "this account has posted nothing" are very different
     answers and only one of them should stop HUB asking again. */
  const wall = () => !!document.querySelector('input[name="password"], form[id*="login" i]');

  async function readWhenReady(){
    const info = HubIG.classify(location.href);
    if (info.type !== 'profile' && info.type !== 'post') return null;

    const deadline = Date.now() + SETTLE_MS;
    for (;;){
      if (wall()) return { kind:'wall', url:location.href };

      if (info.type === 'post'){
        const post = HubIG.readPost(document);
        if (post && post.at) return { kind:'post', url:location.href, post };
      } else {
        const profile = HubIG.readProfile(document);
        /* A profile with a handle but an empty grid is a real answer — a new
           account, or one that has archived everything — so it is only waited
           on until the deadline, never past it. */
        if (profile && profile.posts.length) return { kind:'profile', url:location.href, profile };
        if (profile && Date.now() > deadline - STEP_MS)
          return { kind:'profile', url:location.href, profile };
      }

      if (Date.now() > deadline) return { kind:'timeout', url:location.href };
      await new Promise(r => setTimeout(r, STEP_MS));
    }
  }

  /* ── The add button ────────────────────────────────────────────────────────
     The same idea as the one the guard puts beside Subscribe: a control on the
     page you are already on, so filing an account is not a trip to the board
     and back with a url in the clipboard. Only in add mode, only on a profile,
     and only once. */
  function addButton(handle){
    if (document.getElementById('hub-ig-add')) return;

    const b = document.createElement('button');
    b.id = 'hub-ig-add';
    b.type = 'button';
    b.className = 'hub-ig-add';
    b.textContent = '+ add to hub';
    b.addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation();
      b.disabled = true;
      b.textContent = 'adding…';
      chrome.runtime.sendMessage(
        { type:'addChannel', url:HubIG.profileUrl(handle), name:'@' + handle, platform:'instagram' },
        res => {
          void chrome.runtime.lastError;
          b.textContent = res && res.already ? 'already on hub'
                        : res && res.added   ? 'added to hub' : 'could not add';
          setTimeout(() => { b.disabled = false; b.textContent = '+ add to hub' }, 2400);
        });
    });

    /* Hung off the header when there is one, and off the corner of the window
       when Instagram has renamed everything again. Either way it is the only
       thing HUB draws on this site. */
    const header = document.querySelector('header section') || document.querySelector('header');
    if (header){ b.classList.add('inline'); header.appendChild(b) }
    else document.body.appendChild(b);
  }

  async function run(){
    const facts = await readWhenReady();
    if (!facts) return;

    send({ type:'igReport', ...facts });

    if (facts.kind === 'profile' && facts.profile){
      chrome.runtime.sendMessage({ type:'status' }, res => {
        void chrome.runtime.lastError;
        if (res && res.addMode) addButton(facts.profile.handle);
      });
    }
  }

  /* An in-app navigation does not reload the page, so the script would read one
     profile and never see the next. Watching the url is the cheapest honest
     answer; there is no history hook a content script can rely on here. */
  let at = location.href;
  setInterval(() => {
    if (location.href === at) return;
    at = location.href;
    const stale = document.getElementById('hub-ig-add');
    if (stale) stale.remove();
    run();
  }, 900);

  run();
})();
