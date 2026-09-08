# HUB

A board of YouTube channels. Open `index.html` — that is the whole install.

Built in ROOT's design language: the same VOID palette, the same shape and
motion tokens, Grotesk for titles and JetBrains Mono for everything else.

## What it does

- **Channels** — a name, a YouTube URL, a description, a category. Leave the
  name blank and it is taken from the URL.
- **Categories** — five to start with, all renamable, recolourable and
  deletable. Deleting one never deletes its channels; they fall back to
  uncategorised.
- **Colour coding** — a category's colour is its spine down the left of every
  card, its dot on the filter chip, and a faint wash across the tile.
- **Sort** — last viewed, longest unwatched, recently added, name, category.
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
the page blurs and the board comes up over it. Pick a channel and the tab goes
there, unblurred. From then on that tab is that channel's: its pages and its
videos open normally, and the home feed, search and every other channel put the
board back. A tab is granted its channel on its own — opening YouTube in a new
tab always starts with the board.

**Getting out**, three ways, all always available:

| | |
| --- | --- |
| `dismiss this tab` | on the overlay — stops the guard for this tab until it reloads |
| `pause 15 min` | on the overlay and in the popup |
| `turn guard off` | on the overlay and in the popup |
| `esc` `esc` `esc` | inside two seconds, if the overlay itself never came up |

**It fails open.** Every path that could hang — the background not answering,
a video whose owner cannot be read, the board's iframe not loading, the
extension being reloaded under a live page — ends by taking the blur off. Being
stuck on a page you cannot leave is a worse failure than a video that slipped
through, so every uncertainty resolves the same way.

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

`localStorage`, in three keys: `hub.channels.v1`, `hub.cats.v1`, `hub.ui.v1`.
Per browser, per machine — there is no account and no server.

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
| `picker.mjs` | the board off disk, as the extension's page, and as the picker |

Same approach as `root/test`. They check behaviour, not looks: jsdom does not
lay out or paint, so the grid, the animations and the type are not covered, and
neither is anything that only a real browser has — the actual blur, the iframe
loading, YouTube's own markup.
