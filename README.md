# HUB

A board of YouTube channels. Open `index.html` — that is the whole install.

Built in ROOT's design language: the same VOID palette, the same shape and
motion tokens, Grotesk for titles and JetBrains Mono for everything else.

## What it does

- **Channels** — a name, a YouTube URL, a description, a category. Leave the
  name blank and it is taken from the URL.
- **Categories** — five to start with, all renamable, reorderable, deletable,
  and any colour you like, not just the ten presets. Deleting one never deletes
  its channels; they fall back to uncategorised. Empty ones can be kept out of
  the filter bar.
- **Colour coding** — a category's colour is its spine down the left of every
  card, its dot on the filter chip, and a faint wash across the tile.
- **Sort** — last viewed, longest unwatched, recently added, name, category,
  most clicked.
- **Click heat** — a rule under each card, coloured by where that channel sits
  between the least and the most opened on the board. The two ends of the
  gradient are yours to pick in settings, along with whether the line and the
  click counts show at all.
- **Filter** — any number of category chips at once, plus a live search over
  names, descriptions and category names.
- **Time since last viewed** — clicking a card opens the channel and stamps the
  time. The card then says how long ago that was, and it is a sort order.
- **Size** — S / M / L moves the grid's minimum column width. The columns
  themselves always divide the window, so the board fills whatever it is opened
  in.

Keys: `/` search · `n` new channel · `Esc` close.

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
button on every channel page, so a channel you have just found goes onto the
board without typing its URL.

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

**Permissions:** `storage`, and YouTube. Nothing else — no `tabs`, so it cannot
see the address of any other page you have open. Settings live in
`chrome.storage.local`; which channel a tab is on lives in
`chrome.storage.session` and is gone when the browser closes.

### One thing to know about storage

The board off disk (`file://`) and the board inside the extension are different
origins, so they keep different channel lists. Once the extension is installed,
its board is the one to use. To carry existing channels across, open the old
page, run this in its console, then run the printed line in the extension's
board:

```js
copy('localStorage.setItem("hub.cats.v1",' + JSON.stringify(localStorage.getItem('hub.cats.v1'))
  + ');localStorage.setItem("hub.channels.v1",' + JSON.stringify(localStorage.getItem('hub.channels.v1')) + ');location.reload()')
```

## Where it keeps things

Three keys — `hub.channels.v1`, `hub.cats.v1`, `hub.ui.v1` — in `localStorage`
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
| `bridge.mjs` | the board off disk, as the extension's page, and as a tab the guard sent to it |

Same approach as `root/test`. They check behaviour, not looks: jsdom does not
lay out or paint, so the grid, the animations and the type are not covered, and
neither is anything that only a real browser has — the actual blur, the iframe
loading, YouTube's own markup.
