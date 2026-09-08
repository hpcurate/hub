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

## Where it keeps things

`localStorage`, in three keys: `hub.channels.v1`, `hub.cats.v1`, `hub.ui.v1`.
Per browser, per machine — there is no account and no server.

## Tests

```
cd test && npm install && node harness.mjs
```

A jsdom harness that boots the real `index.html` and drives it through DOM
events — the same approach as `root/test`. It checks behaviour, not looks:
jsdom does not lay out or paint, so the grid, the animations and the type are
not covered by it.
