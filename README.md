# HUB

Two boards of links: your YouTube channels and your Instagram accounts. Open
`index.html` — that is the whole install. It is also a Chromium extension, and,
served over https, an installable web app.

Built in ROOT's design language: the same VOID palette, the same shape and
motion tokens, Grotesk for titles and JetBrains Mono for everything else.

## What it does

- **Two boards** — a tab strip above the filter chips switches between
  **youtube** and **instagram**. Each board has its own accounts and its own
  categories; the card design, the settings, the queue and the export are
  shared. It is a tab, not a filter: the search, the sort and the chips are all
  about the board in front of you, and switching clears the ones that only meant
  something on the other. Each tab carries the count of what is on it and a dot
  when *that* board has something new, which is the point of the strip — a board
  you are not looking at cannot otherwise tell you anything. The url decides
  which board a record goes on, so a YouTube link pasted on the Instagram tab is
  filed as a channel and the board follows it there.
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
  most clicked, and **newest upload**, which is the one a board of channels is
  really asked for: what is new.
- **Pins** — a channel pinned in its edit pane sits at the front of the board
  whatever the sort is. A pin is an exception to an order, not an order.
- **Click heat** — a rule under each card, coloured by where that channel sits
  between the least and the most opened on the board. The two ends of the
  gradient are yours to pick in settings, and so is **how many steps** there are
  between them — ten by default, because a continuous ramp across forty cards is
  forty colours nobody can tell apart. Whether the line and the click counts show
  at all is a switch too.
- **Filter** — any number of category chips at once, plus a live search over
  names, descriptions and category names. The **new** chip is not a category but
  a question asked across all of them: only the channels that have posted since
  you last looked. It is only there when the answer is yes, and the count is in
  the tab's own title too, so a pinned tab answers it without being opened.
- **Time since last viewed** — clicking a card opens the channel and stamps the
  time. The card then says how long ago that was, and it is a sort order.
- **Size** — S / M / L moves the grid's minimum column width. **Resize** opens
  width, height, card-corner and background-scale sliders directly on the home
  page. The columns
  themselves always divide the window, so the board fills whatever it is opened
  in — up to the **content width** set in settings, which is what keeps it from
  running the full span of an ultrawide.
- **Export / import** — one JSON file with every channel, category and setting.
  Import replaces the board.

- **Card facts** — the small facts are independent elements with their own
  switches and positions: last
  viewed, click count, when the channel last posted, when you added it, its rank
  on the board by clicks, how many of its videos you have queued, its handle,
  the category tag, and a dot when there is something new.
- **The avatar** — six dials of its own, because a picture is what the eye lands
  on first: size, shape (circle, rounded, squircle, square, hexagon), edge
  (hairline, none, accent, ring), whether the picture is cropped or fitted, its
  colour (full, grey, grey-until-hovered, or tinted the category's colour), and
  **what stands in when there is no picture** — the channel's initial, its
  category's icon, or a silhouette. That last one is not a nicety: off disk
  there are never any avatars, because a `file://` page cannot fetch
  youtube.com, so without it half of HUB has an empty slot on every card. There
  is also a wash — the same picture again, huge and faint, as the card's own
  ground.
- **The card editor** — **card** on the bar opens it. **Manual mode** lets you
  drag every element between nine responsive grid cells and reorder elements
  within a cell. A fullscreen button enlarges the current card without changing
  its proportions, and a preview toggle hides or reveals disabled elements while
  arranging it. The four presets (classic, compact, list, poster) live
  here, and the dials underneath them are the card's:
  shape, avatar size and edge, name lines, description lines, the dot, and the
  fresh-upload look.
- **Settings for the rest** — every text size on the board, accent, corner
  radius, motion, content width, the heat and its steps, every badge, and — in
  the extension — how often a feed is checked, how long an avatar is trusted, and
  how many channels are asked about at once.
- **Text size and spacing** — two dials over the *whole* app, not just the
  cards. The board always answered the window; until 0.18 the header, the control
  bar, the chips and the sheets around it answered nothing, and every size in
  them was a pixel that looked right on one machine. **Text size** multiplies
  every type size and control height in the app — the card's own four dials are
  expressed through it, so one number moves all of them and each stays its own
  dial afterwards. **Spacing** is the air around them and never touches a font
  size, because "bigger text" and "more room" are different complaints and
  setting one to fix the other is how a layout ends up wrong in both directions.
  Both sit at 100% by default, which computes to exactly the board as it was.

Keys: `/` search · `Enter` opens the first result · `n` new channel ·
`r` opens one at random from whatever is on screen · `Esc` close.

## Card effects and refresh

Open **card** on the toolbar. **Posted today** customizes the last-24-hour look:
glow, edge, tint or minimal; custom, accent or category colour; intensity,
name tint and an optional badge. The window can be changed from 1 to 72
hours. Clearing a new-video dot does not clear this time-based highlight; it
expires automatically.

**Eighteen animations** for a lit card — none, sheen, glint, breathe, float,
wave, ripple, halo, pulse, shimmer, scan, corners, orbit, rays, flicker, neon,
bounce and aurora — said at eighteen different volumes: glint passes once and
then waits, wave and float move the card itself, corners draws a viewfinder
round it, neon strikes like a tube, and aurora is a slow band of colour behind
everything. Five dials apply to whichever one is on: the **curve** it runs on
(ease, linear, steady, spring, bounce, snap, elastic), the **direction**, a
**stagger** of up to a second and a half between one card and the next, **where
that wave starts** — the first card, the last, the middle, both edges at once,
or nowhere in particular — and **how many times** it runs before it settles
down, which is a number now rather than always forever. **Play decorative
effects** is still continuous, on hover, once per upload — or **new**, which
runs them only while the card still carries an unread dot.

All motion controls now live in one **Animations** section. Card arrival, exit,
filtering, reordering, hover, fresh highlights, image motion, avatar hover, new
dot, refresh, preview reveal, preview dismissal, preview cue, settings panels
and the page background each have their own speed. The section also adds glide
and tumble arrivals, drop/implode/spin exits, extra hover, avatar and dot effects,
new refresh effects, and more preview and cue transitions.

**Background image** is the channel's own picture behind the card. Five starting
presets make the controls easier to approach: soft, full image, mono, cinematic
and pattern. Fit, image size, left/right and up/down placement, rotation and fade
come first; colour, brightness, contrast, blur, blend and overlays follow. It has
four additional moving effects: float, orbit, pulse and diagonal. Opacity runs
to 100%. Thirteen **overlays** — gradient, vignette, top,
bottom, scanlines, grid, dots, noise, diagonal, mesh, frame, corners — at an
angle and a blend mode of their own, in the category colour, the accent, the
page ground or one of your own.

**The card ground** is under all of that: a wash of the category colour, the
accent or a custom one at whatever strength, stronger under the pointer if you
want it, plus a gradient across the card — top, bottom, diagonal, radial, conic,
corner, sweep or along the spine — at a strength of its own. Under *that* is a
**texture** — noise, grain, grid, dots, lines or crosshatch, at its own opacity
and size — which is the one background that is neither a picture nor a colour,
and a **shadow** (soft, deep, glow, inner), because a card on a background
sometimes needs one to stay a card.

Use the preview buttons to compare normal, fresh and refreshing states, or open
manual mode to arrange every element on the grid. The preview uses the current
card dimensions, including changes made with the toolbar resize controls.

In the extension, **refresh** on the toolbar shows progress and animates each
active card with sweep, pulse, bar, blink, dim or no effect. Completed checks
and failures are reported below the filters. All preferences are saved and
included in exports. Settings → motion → none and the system's reduced-motion
setting stop animations.

## The latest video box

Each card can carry its channel's newest upload: a thumbnail at one of three
sizes, the title, how long ago it was posted, and **open** and **+ queue**
buttons — every one of them its own switch. It is revealed on hover, always
open, or only from its own button. It can be kept to **cards with a fresh
upload** so the board is quiet apart from what is actually new.

It is revealed with a fade, slide, expand or zoom. Clicking its thumbnail,
title, or age dismisses that upload with a selectable fade, shrink, slide,
blur, fold or fly animation. The card then smoothly closes to its normal
height and the grid reflows. The next upload appears normally.

The “latest video” label can be hidden. A separate card-wide cue can pulse,
glow, sweep or ring while a new upload waits; hovering settles it and leaves a
small indicator after the pointer moves away.

And one channel can refuse it, from either end. **latest video: on / off** sits
in that channel's edit pane, beside the pin; the box itself carries a **hide**
button, which writes the same switch from where you are actually standing when
you decide you never want that channel's uploads announced. That button is a
setting of its own, so a board that never wants it never sees it. The board
decides whether cards carry the box at all; this is the exception to it, and it
travels with the channel in an export.

## The page behind the board

The largest background on the board is the one behind it, and it used to be one
flat colour with no dial at all. Settings → *the page behind the board*:
**plain, gradient, glow, grid, dots, noise, vignette, aurora** or **rays**, in
the accent or a colour of its own, at a strength, a pattern size and an angle
you pick, with **let it move** off by default — a background that never
stops is the one thing a board you leave open all day cannot have.

Every answer draws *over* the ground rather than replacing it, so `plain` is
exactly the board as it always was, and none of the rest can leave the cards
floating.

## The Instagram board

Everything the YouTube board does — categories, colours, sort, search, filter
chips, last-viewed stamps, click heat, pins, the whole card design — with one
difference that is not a choice: **Instagram is not guarded.** instagram.com
browses exactly as it did before HUB was installed. Nothing is blocked, blurred
or redirected. The Instagram tab is a board of accounts.

There *is* a content script on instagram.com, and it is read-only — it contains
no blocking code. It reports what is on a profile page, and in add mode it puts
a **+ add to hub** button on a profile.

### What's new, without a feed

YouTube gives HUB a per-channel feed on a plain url with no key. Instagram gives
nothing: no feed, and a logged-out fetch of a profile is answered with a login
wall. So an account is checked the way a person would check it — **the page is
opened in a background tab**, in the session already signed in, and read there.
Two loads at most, the second only when it has earned it:

1. **the profile**, for the picture and the shortcodes across the top of the grid
2. **one post**, only when a shortcode has turned up that this account has never
   shown before, for its real `<time datetime>`

The grid carries no dates and does not need to: a shortcode is a stable id, so
"something new" is a code that was not there last time. Pinned posts fall out of
that for free — one never leaves the top, so its code is always already known
and it never reads as new twice.

The second load is what makes everything else work unchanged. With a real
posted-at time, the lit fresh card, the 24-hour window, the **new** chip,
newest-first sort and the latest-post box all work on this board without knowing
which site they are looking at.

Nothing is allowed to empty the board. A login wall, a timeout, a tab closed by
hand or a post that will not open is a failure: the account keeps what it had
and is asked again. When the grid is read but the post is not, the shortcodes
are deliberately not recorded, so that post is still new next time.

### Rate

**Refresh checks the board in front of you**, not the other one, and runs on the
button and on the `checkEvery` clock. Instagram gets **two lanes by default, not
five**, on a dial of its own: a YouTube lane is a few kilobytes of XML, an
Instagram lane is a whole page rendering in a real tab. Two at a time is the
shape of somebody browsing. This is still automated access under Instagram's
terms — keeping it slow is what keeps it unremarkable.

## As a web app

Served over https — GitHub Pages, or anything else — HUB installs. Its own
window, its own icon, and it opens with **no network at all**: a service worker
holds the whole board, which is a dozen small files, plus the two fonts.

**Install** is in settings, under *this app*, when the browser offers it;
Safari and Firefox install from their own menus instead and the row says so.

It is the same board and the same storage as everywhere else — nothing about the
app is a different app. The worker is **network first**, so an update is live the
next time it is opened rather than a week later; only when the browser says
there is no network at all does the cache answer first, which is what makes a
cold offline start instant rather than a wait for a dozen connections to fail.

None of it runs anywhere it does not belong: off disk (`file://` has no origin
to scope a worker to) and inside the extension (which has a service worker of
its own — the guard's) `js/webapp.js` registers nothing, and the board is
exactly what it always was.

## The extension

The repo is also a Chromium (Vivaldi, Chrome) extension. Same folder, same
board — `manifest.json` sits next to `index.html`, so loading the folder gives
you the board as an extension page *and* a guard on YouTube.

**Install:** Vivaldi → `vivaldi://extensions` → Developer mode on → *Load
unpacked* → pick this folder.

It asks for `storage`, YouTube, and — since v0.13.0 — instagram.com, where it
runs a read-only script and no guard.

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

Five files, run in order:

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

For real layout and motion checks, run `electron test/visual.cjs` with an
Electron executable. It runs a hidden Chromium window using local fixtures,
checks mobile overflow and reduced motion, and saves screenshots and a result
in `test/artifacts/`.
