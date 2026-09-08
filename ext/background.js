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
importScripts('scope.js');

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

/* Is the guard actually on right now? One answer, so the popup, the overlay and
   the content script can never disagree about it. */
async function guarding(){
  const s = await getSettings();
  return s.enabled && Date.now() >= (s.snoozeUntil || 0);
}

async function statusFor(tabId){
  const s = await getSettings();
  return {
    enabled: s.enabled,
    snoozeUntil: s.snoozeUntil || 0,
    guarding: await guarding(),
    grant: tabId == null ? null : await grantFor(tabId),
  };
}

/* ── Messages ────────────────────────────────────────────────────────────────
   Every reply is a status object, so a caller never has to ask twice to find
   out what the world looks like after its own change. */
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

chrome.tabs.onRemoved.addListener(tabId => { editGrant(tabId, () => null) });

/* ── One thing deliberately not done ─────────────────────────────────────────
   A tab that wanders off YouTube and comes back still holds its old grant, so
   that one channel is reachable again in that tab without picking it. Clearing
   it would mean watching every tab's URL — the "tabs" permission, which is
   read-access to the address of every page in the browser, for a case that only
   ever re-opens a channel the board already holds. The home feed, search and
   every other channel stay blocked either way, which is the thing that was
   asked for. Not worth the permission. */
