# HUB

A board of YouTube channels. Open `index.html` — that is the whole install.

Built in ROOT's design language: the same VOID palette, the same shape and
motion tokens, Grotesk for titles and JetBrains Mono for everything else.

## What it does

- **Channels** — a name, a YouTube URL, a description, a category. Leave the
  name blank and it is taken from the URL. Clicking one opens its **videos
  tab**, not its home page, which is a trailer and three shelves; that is a
  setting, and `home` is still one of the answers.
- **Categories** — five to start with, all renamable, reorderable, deletable,
  and any colour you like, not just the ten presets. Each can carry one of
  twenty icons, or none, which then shows on every card and filter chip.
  Deleting one never deletes its channels; they fall back to uncategorised.
  Empty ones can be kept out of the filter bar. **Star one** and it goes to the
  front of every list you pick a category from — the chips, the quick menu, the
  filing bar — while the order in the manager, which is yours to set, stays put.
- **Quick categorise** — click the category tag on any card and pick from a
  menu. Or hit **categorise**, choose one category, and click through the cards;
  the board stops being a set of links until you leave the mode.
- **Avatars and what is new** — in the extension, the board reads each channel's
  own page for its picture and its feed for its newest upload, and marks a card
  when that channel has posted since you last opened it. A channel that posted in
  the **last 24 hours** gets more than a mark: a lit edge, a glow and a slow
  sheen down its colour spine, so what is worth opening now reads from the other
  side of the board. Both the window and the whole effect are settings.
- **Clearing the dots** — a board seeded in one pass arrives with a dot on every
  card, which is forty marks saying the same nothing. **clear dots** on the bar
  answers all of them at once, and clicking a single dot answers that one. It
  stamps an acknowledgement, not a view: the cards still say never opened,
  because they have not been.
- **A queue** — Watch Later lives behind the feed, which the guard removes. The
  **+ queue** button on any video page puts one aside here instead. Opening it
  unlocks that video, not its whole channel.
- **Colour coding** — a category's colour is its spine down the left of every
  card, its dot on the filter chip, and a faint wash across the tile.
- **Sort** — last viewed, longest unwatched, recently added, name, category,
  most clicked.
- **Click heat** — a rule under each card, coloured by where that channel sits
  between the least and the most opened on the board. The two ends of the
  gradient are yours to pick in settings, and so is **how many steps** there are
  between them — ten by default, because a continuous ramp across forty cards is
  forty colours nobody can tell apart. Whether the line and the click counts show
  at all is a switch too.
- **Filter** — any number of category chips at once, plus a live search over
  names, descriptions and category names.
- **Time since last viewed** — clicking a card opens the channel and stamps the
  time. The card then says how long ago that was, and it is a sort order.
- **Size** — S / M / L moves the grid's minimum column width. The columns
  themselves always divide the window, so the board fills whatever it is opened
  in — up to the **content width** set in settings, which is what keeps it from
  running the full span of an ultrawide.
- **Export / import** — one JSON file with every channel, category and setting.
  Import replaces the board.

- **Badges** — nine small facts a card can carry, each its own switch: last
  viewed, click count, when the channel last posted, when you added it, its rank
  on the board by clicks, how many of its videos you have queued, its handle,
  the category tag, and a dot when there is something new.
- **The card editor** — **card** on the bar opens it. A card is **six zones**,
  two to a row, and every part of one — avatar, name, description, category tag,
  badges, the count, the new dot, the edit button — names the zone it sits in.
  Move any of them anywhere; switch any of them off. Each zone has its own
  direction, so the same six slots give you the avatar beside the name or above
  it. At the top of the pane is a real card, built and painted by the board's own
  renderer from the settings as they stand, so nothing there is an approximation.
  The four presets (classic, compact, list, poster) live here now and write slots
  and zones like everything else, and the dials underneath them are the card's:
  shape, avatar size and edge, name lines, description lines, the dot, and the
  fresh-upload look.
- **Settings for the rest** — every text size on the board, accent, corner
  radius, motion, content width, the heat and its steps, every badge, and — in
  the extension — how often a feed is checked, how long an avatar is trusted, and
  how many channels are asked about at once.

Keys: `/` search · `Enter` opens the first result · `n` new channel · `Esc` close.

## The extension

The repo is also a Chromium (Vivaldi, Chrome) extension. Same folder, same
board — `manifest.json` sits next to `index.html`, so loading the folder gives
you the board as an extension page *and* a guard on YouTube.

**Install:** Vivaldi → `vivaldi://extensions` → Developer mode on → *Load
unpacked* → pick this folder.

**What it does:** open YouTube in a tab that did not come from the board, and
**the tab goes to the board**. Not covered by it — the address changes, and the
YouTube page is gone. Pick a channel and that same tab goes in. From then on it
is that channel's tab: its pages and its videos open normally, and the home
feed, search and every other channel send it back to the board. A tab is granted
its channel on its own, so opening YouTube in a new tab always starts here.

**Add mode** (settings, or the popup) stands the guard down and puts a **+ add**
button in every channel page's own action row, beside Subscribe — so a channel
you have just found goes onto the board without typing its URL. On your
subscriptions page the button adds **every channel listed, in one pass**, which
is how to seed a board without visiting forty pages.

**Getting out**, four ways, all always available:

| | |
| --- | --- |
| `go back anyway` | on the board you landed on — goes where you were headed, and stops the guard for that tab |
| `pause 15 min` | on the board and in the popup |
| `turn guard off` | on the board and in the popup |
| `esc` `esc` `esc` | inside two seconds, for a page that is somehow still covered |

**It fails open.** Every path that could hang — the background not answering, a
video whose owner cannot be read, the extension being reloaded under a live page
— ends by uncovering the page, never by sending it away. Being stuck somewhere
you cannot leave is a worse failure than a video that slipped through, so every
uncertainty resolves the same way.

**Refreshing:** the board asks YouTube two questions and they are not the same
question. A channel's **feed** is a few kilobytes and holds the only thing worth
polling, so it is checked every few hours; a channel's **page** is a megabyte and
holds one thing that changes about never — the avatar — so it is read only when
it is missing or a fortnight old. Both go out over a small pool of parallel
requests rather than one at a time with a pause in between. All three are dials
in settings.

**Permissions:** `storage`, and YouTube — the latter now as a host permission
too, so the board can read a channel's own page for its avatar and its feed
(`/feeds/videos.xml`, public, no key) for its newest upload. Nothing else — no
`tabs`, so it cannot see the address of any other page you have open. Settings live in
`chrome.storage.local`; which channel a tab is on lives in
`chrome.storage.session` and is gone when the browser closes.

### Keeping your data

Updating the extension does not clear it: `chrome.storage.local` survives a
reload of the unpacked folder, and v0.3.0's move out of `localStorage` is
carried over automatically the first time a board with the new code opens an
empty store.

That leaves one real gap, which is the board off disk (`file://`): it is a
different origin from the extension and always has been, so the two keep
different lists. **Export** from one and **import** into the other, in settings.
That file is also the backup — a copy you hold is the only one nothing can take.

## Where it keeps things

Four keys — `hub.channels.v1`, `hub.cats.v1`, `hub.ui.v1`, `hub.queue.v1` — in `localStorage`
off disk, and in `chrome.storage.local` inside the extension. The extension has
to use the second: the **+ add** button writes from a YouTube page through the
service worker, which has no `localStorage` at all. Either way it is per
browser, per machine — there is no account and no server.

## Tests

```
cd test && npm install && npm test
```

Four files, run in order:

| | |
| --- | --- |
| `harness.mjs` | the board — boots the real `index.html` and drives it through DOM events |
| `scope.mjs` | the rules for what counts as "inside the channel I picked", on their own |
| `guard.mjs` | the content script in a fake YouTube page: what is blocked, and every way out |
| `yt.mjs` | the parsers for YouTube's own markup — the channel page and the feed |
| `bridge.mjs` | the board off disk, as the extension's page, and as a tab the guard sent to it |

Same approach as `root/test`. They check behaviour, not looks: jsdom does not
lay out or paint, so the grid, the animations and the type are not covered, and
neither is anything that only a real browser has — the actual blur, the iframe
loading, YouTube's own markup.
