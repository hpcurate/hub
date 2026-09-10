/* ── Background ───────────────────────────────────────────────────────────────
   The service worker owns two things and nothing else:

     settings  chrome.storage.local    — the toggle and the pause, kept forever
     grants    chrome.storage.session  — which channel each tab is allowed on,
                                         gone when the browser closes

   Grants are per tab on purpose. "Whenever I open YouTube" means a fresh tab,
   and a grant that lived globally would mean picking a channel once unlocked
   every YouTube tab afterwards, which is the opposite of the point.

   MV3 kills this worker whenever it feels like it, so nothing is held in a
   variable that matters. storage.session survives the restart; the in-memory
   map is only a write queue.
*/
importScripts('scope.js', 'model.js', 'yt.js', 'ig.js');

const SETTINGS = { enabled:true, snoozeUntil:0 };

const getSettings = async () => ({ ...SETTINGS, ...(await chrome.storage.local.get(SETTINGS)) });
const setSettings = patch => chrome.storage.local.set(patch);

/* Read-modify-write on one shared object needs a queue, or two messages
   arriving together lose one of the writes. */
let chain = Promise.resolve();
const serial = fn => (chain = chain.then(fn, fn));

const readGrants  = async () => (await chrome.storage.session.get({ grants:{} })).grants;
const writeGrants = grants => chrome.storage.session.set({ grants });

const editGrant = (tabId, fn) => serial(async () => {
  const grants = await readGrants();
  const next = fn(grants[String(tabId)] || null);
  if (next) grants[String(tabId)] = next; else delete grants[String(tabId)];
  await writeGrants(grants);
  return next;
});

const grantFor = async tabId => (await readGrants())[String(tabId)] || null;

/* ── Dismissals ──────────────────────────────────────────────────────────────
   "Go back anyway" on the board, and the triple-escape. Per tab and timed, so
   a dismissal is a decision about now rather than a switch left flipped. */
const BYPASS_MIN = 20;
const readBypass  = async () => (await chrome.storage.session.get({ bypass:{} })).bypass;
const setBypass = (tabId, until) => serial(async () => {
  const bag = await readBypass();
  if (until) bag[String(tabId)] = until; else delete bag[String(tabId)];
  await chrome.storage.session.set({ bypass:bag });
});
async function bypassed(tabId){
  if (tabId == null) return false;
  const until = (await readBypass())[String(tabId)] || 0;
  return Date.now() < until;
}

/* Add mode is a board setting, not a second copy of one. It lives in the same
   hub.ui.v1 the board writes, so the popup, the board and the guard cannot
   disagree about whether it is on. */
async function uiSettings(){
  const bag = await chrome.storage.local.get([HubModel.KEYS.UI]);
  const raw = bag[HubModel.KEYS.UI];
  try { return { ...HubModel.DEFAULT_UI, ...(typeof raw === 'string' ? JSON.parse(raw) : raw || {}) } }
  catch { return { ...HubModel.DEFAULT_UI } }
}
/* The two halves of every list this worker writes. Channels and the queue live
   as JSON strings in chrome.storage.local, the same shape the board reads. */
async function readList(key){
  const bag = await chrome.storage.local.get([key]);
  const raw = bag[key];
  let list;
  try { list = JSON.parse(typeof raw === 'string' ? raw : '[]') } catch { list = [] }
  return Array.isArray(list) ? list : [];
}
const writeList = (key, list) => chrome.storage.local.set({ [key]: JSON.stringify(list) });

async function patchUi(patch){
  const next = { ...(await uiSettings()), ...patch };
  await chrome.storage.local.set({ [HubModel.KEYS.UI]: JSON.stringify(next) });
  return next;
}

/* Is the guard actually on for this tab right now? One answer, computed once,
   so the popup, the board and the content script can never disagree about it.
   Five different things turn it off and every one of them is a way out. */
async function statusFor(tabId){
  const s = await getSettings();
  const u = await uiSettings();
  const paused = Date.now() < (s.snoozeUntil || 0);
  const dismissed = await bypassed(tabId);
  return {
    enabled: s.enabled,
    snoozeUntil: s.snoozeUntil || 0,
    addMode: !!u.addMode,
    queueButton: u.queueButton !== false,
    bypassed: dismissed,
    guarding: s.enabled && !paused && !u.addMode && !dismissed,
    grant: tabId == null ? null : await grantFor(tabId),
  };
}

/* ── Messages ────────────────────────────────────────────────────────────────
   Every reply is a status object, so a caller never has to ask twice to find
   out what the world looks like after its own change. */
/* ── Probing Instagram ───────────────────────────────────────────────────────
   YouTube hands out a per-channel feed on a plain url with no key, so the board
   can simply ask it a question. Instagram hands out nothing: there is no feed,
   and a logged-out fetch of a profile is answered with a login wall. The only
   way left is the one a person would use — open the page, in the session that
   is already signed in, and look at it.

   So: a background tab, the content script's report, and the tab closed again.
   It is slower than a fetch and it is meant to be. One page load per account,
   in two lanes rather than five, is the shape of somebody browsing; a burst of
   forty parallel requests is the shape of something Instagram soft-blocks.

   The board asks for these — the worker owns them because only the worker can
   open a tab and still be listening when the content script in it reports. */
const probes = new Map();          /* tabId -> resolve */

async function probeInstagram(url, ms){
  if (!HubIG.isInstagram(url)) return null;

  let tab = null;
  try {
    /* active:false, so the tab that is doing the looking never takes the
       window away from whatever you were doing in it. */
    tab = await chrome.tabs.create({ url, active:false });
  } catch { return null }
  if (!tab || tab.id == null) return null;

  const facts = await new Promise(resolve => {
    const timer = setTimeout(() => { probes.delete(tab.id); resolve(null) }, Math.max(4000, ms || 20000));
    probes.set(tab.id, out => { clearTimeout(timer); probes.delete(tab.id); resolve(out) });
  });

  /* The tab goes whatever happened. A probe that leaves tabs behind on failure
     would fill the window on the one day Instagram is slow. */
  try { await chrome.tabs.remove(tab.id) } catch {}
  return facts;
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  const tabId = sender.tab ? sender.tab.id : null;

  (async () => {
    switch (msg && msg.type){

      case 'status':
        return reply(await statusFor(msg.tabId != null ? msg.tabId : tabId));

      /* Picked a channel from the board inside the overlay: this tab is now
         that channel's, and the caller navigates itself. */
      case 'unlock': {
        const scope = msg.scope;
        if (!scope || tabId == null) return reply(await statusFor(tabId));
        await editGrant(tabId, () => HubScope.withAlias(HubScope.emptyGrant(), scope));
        return reply(await statusFor(tabId));
      }

      /* Picked a channel from the board in its own tab: the new tab is granted
         before it exists, so its content script never sees an ungranted load. */
      case 'openInTab': {
        const scope = msg.scope;
        if (!scope) return reply(await statusFor(tabId));
        const tab = await chrome.tabs.create({ url: msg.url || HubScope.channelUrl(scope) });
        await editGrant(tab.id, () => HubScope.withAlias(HubScope.emptyGrant(), scope));
        return reply(await statusFor(tabId));
      }

      /* The page told us another name for the channel we are already on, or
         cleared a video as belonging to it. Both only ever widen a grant that
         already exists — neither can create one. */
      case 'alias':
        if (tabId != null && msg.scope)
          await editGrant(tabId, g => g ? HubScope.withAlias(g, msg.scope) : null);
        return reply(await statusFor(tabId));

      case 'cleared':
        if (tabId != null && msg.videoId)
          await editGrant(tabId, g => g ? HubScope.withVideo(g, msg.videoId) : null);
        return reply(await statusFor(tabId));

      case 'release':
        if (tabId != null) await editGrant(tabId, () => null);
        return reply(await statusFor(tabId));

      /* Dismissed for this tab. Sent by the board's "go back anyway" and by the
         triple-escape, and it has to outlive the navigation that follows it —
         which is why it is here and not a variable in the content script. */
      case 'bypass':
        if (tabId != null) await setBypass(tabId, Date.now() + BYPASS_MIN * 60e3);
        return reply(await statusFor(tabId));

      case 'setAddMode':
        await patchUi({ addMode: !!msg.on });
        return reply(await statusFor(msg.tabId != null ? msg.tabId : tabId));

      /* Filed from the "+ queue" button on a video page. The queue is HUB's
         answer to Watch Later, which lives behind the feed the guard removes. */
      case 'enqueue': {
        if (!msg.videoId) return reply({ ...(await statusFor(tabId)), added:false });
        const out = await serial(async () => {
          const list = await readList(HubModel.KEYS.Q);
          if (list.some(q => q.videoId === msg.videoId)) return { already:true };
          list.unshift(HubModel.makeQueued(msg));
          await writeList(HubModel.KEYS.Q, list);
          return { already:false };
        });
        return reply({ ...(await statusFor(tabId)), added:!out.already, already:out.already });
      }

      /* Every channel on the subscriptions page at once. Seeding the board one
         channel at a time was the tedious part, and this is the page that
         already knows the whole list. */
      case 'addMany': {
        const items = Array.isArray(msg.items) ? msg.items : [];
        const out = await serial(async () => {
          const list = await readList(HubModel.KEYS.CH);
          const has = url => {
            const s2 = HubScope.parse(url);
            return !s2 || list.some(c => {
              const s3 = HubScope.parse(c.url);
              return s3 && s3.kind === s2.kind && s3.key === s2.key;
            });
          };
          let added = 0;
          for (const it of items){
            const url = HubModel.normUrl(it && it.url);
            if (!url || has(url)) continue;
            list.push(HubModel.makeChannel({ url, name:it.name, desc:'', cat:'' }));
            added++;
          }
          if (added) await writeList(HubModel.KEYS.CH, list);
          return { added, seen:items.length };
        });
        return reply({ ...(await statusFor(tabId)), ...out });
      }

      /* Filed from the "+ add" button on a channel page. The board's list lives
         in chrome.storage.local, which a content script on youtube.com cannot
         touch and this worker can — so the write happens here, in the one record
         shape both ends share. */
      case 'addChannel': {
        const url = HubModel.normUrl(msg.url);
        /* Which board this belongs on, and therefore which rule book says what
           counts as the same account twice. Read off the url rather than taken
           from the caller: a content script is not the authority on what site
           it is running on. */
        const platform = HubModel.platformOf(url);
        const rules = platform === 'instagram' ? HubIG : HubScope;
        const scope = rules.parse(url);
        if (!scope) return reply({ ...(await statusFor(tabId)), added:false });

        const out = await serial(async () => {
          const list = await readList(HubModel.KEYS.CH);
          /* Same account, whichever way its url is spelled — which on YouTube
             is four ways and on Instagram is one. */
          const already = list.some(c => {
            if (HubModel.platformOf(c.url) !== platform) return false;
            const s2 = rules.parse(c.url);
            return s2 && s2.kind === scope.kind && s2.key === scope.key;
          });
          if (already) return { already:true };

          list.push(HubModel.makeChannel({ url, name:msg.name, desc:'', cat:'', platform }));
          await writeList(HubModel.KEYS.CH, list);
          return { already:false };
        });

        return reply({ ...(await statusFor(tabId)), added:!out.already, already:out.already });
      }

      /* Opening something out of the queue. The tab is granted that one video
         rather than its whole channel: a queued video is a thing you chose,
         not a door into everything its channel has ever posted. */
      case 'openVideo': {
        if (!msg.url) return reply(await statusFor(tabId));
        const tab = await chrome.tabs.create({ url: msg.url });
        if (msg.videoId)
          await editGrant(tab.id, () => HubScope.withVideo(HubScope.emptyGrant(), msg.videoId));
        return reply(await statusFor(tabId));
      }

      /* A tab, and nothing else done to it. There is no guard on instagram.com,
         so there is no grant to write and nothing to unlock — which is what
         makes this a different case from `openInTab` rather than a flag on it. */
      case 'openPlain': {
        const url = HubModel.normUrl(msg.url);
        if (!url) return reply(null);
        await chrome.tabs.create({ url });
        return reply({ opened:true });
      }

      /* The board asking for one account to be looked at. */
      case 'igProbe':
        return reply(await probeInstagram(HubModel.normUrl(msg.url), msg.timeout));

      /* The content script on an instagram page, saying what it can see. Kept
         when it answers a probe this worker is waiting on, dropped otherwise —
         which is what lets the content script report unconditionally and stay
         free of any idea about who is watching. */
      case 'igReport': {
        const done = tabId != null && probes.get(tabId);
        if (done) done(msg);
        return reply({ ok:!!done });
      }

      case 'setEnabled':
        await setSettings({ enabled: !!msg.on });
        return reply(await statusFor(msg.tabId != null ? msg.tabId : tabId));

      case 'snooze':
        await setSettings({ snoozeUntil: Date.now() + Math.max(0, +msg.minutes || 0) * 60e3 });
        return reply(await statusFor(msg.tabId != null ? msg.tabId : tabId));

      default:
        return reply(await statusFor(tabId));
    }
  })().catch(err => {
    /* Fail open, loudly. A background that cannot answer must not be the reason
       a page stays blurred — the content script treats a bad reply as "no
       guard" for exactly this case. */
    console.error('[HUB]', err);
    try { reply({ error:String(err), enabled:false, guarding:false, grant:null }) } catch {}
  });

  return true;                       /* the reply is async */
});

chrome.tabs.onRemoved.addListener(tabId => {
  editGrant(tabId, () => null);
  setBypass(tabId, 0);
  /* Closing a probe tab by hand is a perfectly reasonable thing to do to a tab
     that appeared on its own. It answers the probe with nothing rather than
     leaving the board waiting out the whole timeout. */
  const done = probes.get(tabId);
  if (done) done(null);
});

/* ── One thing deliberately not done ─────────────────────────────────────────
   A tab that wanders off YouTube and comes back still holds its old grant, so
   that one channel is reachable again in that tab without picking it. Clearing
   it would mean watching every tab's URL — the "tabs" permission, which is
   read-access to the address of every page in the browser, for a case that only
   ever re-opens a channel the board already holds. The home feed, search and
   every other channel stay blocked either way, which is the thing that was
   asked for. Not worth the permission. */
