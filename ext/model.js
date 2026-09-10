/* ── Model ────────────────────────────────────────────────────────────────────
   What a channel is, what a category is, and what the keys are called.

   Pure, like ext/scope.js, and for the same reason: since v0.3.0 the board is
   not the only thing that writes channels. The "+ add" button on a YouTube
   channel page files one from a content script, through the service worker,
   which has no localStorage and never loads the app. Both ends have to agree on
   the record shape, so the shape lives in one file that both read.
*/
const HubModel = (() => {

  const KEYS = { CH:'hub.channels.v1', CAT:'hub.cats.v1', UI:'hub.ui.v1', Q:'hub.queue.v1' };

  /* Ten hues at roughly one lightness, so no category shouts louder than
     another on a dark ground. Since v0.3.0 they are a starting point rather
     than the whole choice — a category can hold any colour. */
  const PALETTE = ['#A78BFA','#7DD3FC','#5CDB7D','#E0A060','#E06060',
                   '#F0A5D0','#8FE3D0','#9AA8FF','#D6E060','#C4B5A0'];

  /* ── Platforms ─────────────────────────────────────────────────────────────
     HUB is two boards in one page. A channel and an account are the same record
     with the same fields; what differs is the site it points at, the word for
     it, and how much that site is willing to tell us.

     Everything platform-shaped lives in this one table so that adding a third
     never means hunting through the app for `youtube.com`. `feed` is the honest
     divider: YouTube hands out a keyless per-channel feed, Instagram hands out
     nothing at all, so one half of HUB is read by asking and the other by
     opening the page in a tab and looking. */
  const PLATFORMS = {
    youtube: {
      id:'youtube', label:'youtube',
      noun:'channel', nouns:'channels', item:'video', items:'videos',
      host:'youtube.com', home:'https://www.youtube.com/',
      feed:true,                 /* a per-channel feed exists and needs no key */
      tabs:['videos','home','streams','shorts','playlists','community'],
    },
    instagram: {
      id:'instagram', label:'instagram',
      noun:'account', nouns:'accounts', item:'post', items:'posts',
      host:'instagram.com', home:'https://www.instagram.com/',
      feed:false,                /* nothing to poll; the page has to be opened */
      tabs:['posts','reels','tagged'],
    },
  };
  const PLATFORM_KEYS = Object.keys(PLATFORMS);
  const isPlatform = p => PLATFORM_KEYS.includes(p);

  /* Which board a url belongs on. The url is the honest source: a record filed
     before platforms existed is a YouTube one because its url says youtube.com,
     not because of when it was written. */
  function platformOf(url){
    let host;
    try { host = new URL(normUrl(url)).hostname.toLowerCase() } catch { return '' }
    if (/(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/.test(host)) return 'youtube';
    if (/(^|\.)(instagram\.com|instagr\.am)$/.test(host)) return 'instagram';
    return '';
  }

  const DEFAULT_CATS = [
    { name:'learning', color:'#A78BFA' },
    { name:'making',   color:'#E0A060' },
    { name:'tech',     color:'#7DD3FC' },
    { name:'music',    color:'#F0A5D0' },
    { name:'watch',    color:'#5CDB7D' },
  ];

  /* Instagram's own five. A board of accounts is not a board of channels with
     different links on it — nobody files an Instagram account under "learning"
     — so the second tab starts with words that fit what is actually on it. */
  const DEFAULT_IG_CATS = [
    { name:'friends',  color:'#F0A5D0' },
    { name:'art',      color:'#A78BFA' },
    { name:'places',   color:'#7DD3FC' },
    { name:'food',     color:'#E0A060' },
    { name:'follow',   color:'#5CDB7D' },
  ];
  const catSeed = platform => platform === 'instagram' ? DEFAULT_IG_CATS : DEFAULT_CATS;

  /* ── The card's zones ──────────────────────────────────────────────────────
     Nine of them, three to a row. Every part of a card names the one it sits in,
     and that is the whole of the card editor's model: a part is somewhere, and
     somewhere is one of these.

     A zone is a flex box, so what is in it sits side by side; `dir` turns one
     into a stack, and `top` is the same row with everything hung from the top
     rather than centred on it. */
  const ZONES = ['tl', 'tc', 'tr', 'ml', 'mc', 'mr', 'bl', 'bc', 'br'];
  const ZONE_NAMES = { tl:'top left', tc:'top center', tr:'top right', ml:'center left',
    mc:'center', mr:'center right', bl:'bottom left', bc:'bottom center', br:'bottom right' };

  /* The parts that can be moved. `fixed` ones are drawn against the card rather
     than inside a zone — the heat line is an edge, not an item — so they are
     not in here at all. Order is the order they sit in inside a zone, so two
     parts sharing one never argue about which comes first. */
  const PARTS = [
    { k:'avatar', label:'avatar',        show:'showAvatars' },
    { k:'dot',    label:'the new dot',   show:'showNew' },
    { k:'name',   label:'channel name' },
    { k:'desc',   label:'description',   show:'showDesc' },
    { k:'tag',    label:'category tag',  show:'showTag' },
    { k:'catIcon',label:'category icon', show:'showCategoryIcon' },
    { k:'seen',   label:'time last viewed', show:'showSeen' },
    { k:'opens',  label:'opens badge', show:'showCounts' },
    { k:'posted', label:'time last posted', show:'showPosted' },
    { k:'added',  label:'time added', show:'showAdded' },
    { k:'rank',   label:'click rank', show:'showRank' },
    { k:'queued', label:'queued count', show:'showQueued' },
    { k:'handle', label:'channel handle', show:'showHandle' },
    { k:'pin',    label:'pinned mark', show:'showPin' },
    { k:'freshBadge', label:'fresh upload badge', show:'freshBadge' },
    { k:'count',  label:'opens, as a number' },
    { k:'edit',   label:'the edit button' },
  ];
  const PART_KEYS = PARTS.map(p => p.k);

  const DEFAULT_SLOTS = { avatar:'tl', dot:'tr', name:'tl', desc:'ml', tag:'bl', catIcon:'bl',
    seen:'br', opens:'br', posted:'br', added:'br', rank:'br', queued:'br', handle:'br',
    pin:'br', freshBadge:'br', count:'br', edit:'tr' };
  const makeOrders = (slots, source = {}) => {
    const orders = Object.fromEntries(ZONES.map(z => [z, []]));
    const used = new Set();
    ZONES.forEach(z => {
      const list = Array.isArray(source[z]) ? source[z] : [];
      list.forEach(k => {
        if (PART_KEYS.includes(k) && slots[k] === z && !used.has(k)){
          orders[z].push(k); used.add(k);
        }
      });
    });
    PART_KEYS.forEach(k => {
      const z = slots[k];
      if (!used.has(k) && ZONES.includes(z)){ orders[z].push(k); used.add(k) }
    });
    return orders;
  };
  const DEFAULT_ORDERS = makeOrders(DEFAULT_SLOTS);
  const ANCHOR_POINTS = {
    tl:[0,0], tc:[50,0], tr:[100,0],
    ml:[0,50], mc:[50,50], mr:[100,50],
    bl:[0,100], bc:[50,100], br:[100,100],
  };
  const anchorFromPoint = (x, y) => Object.entries(ANCHOR_POINTS).reduce((best, [key, point]) => {
    const distance = Math.hypot(x - point[0], y - point[1]);
    return distance < best.distance ? { key, distance } : best;
  }, { key:'mc', distance:Infinity }).key;
  const DEFAULT_POSITIONS = {
    avatar:{x:7,y:14,anchor:'tl'}, dot:{x:94,y:10,anchor:'tr'},
    name:{x:22,y:14,anchor:'tl'}, desc:{x:7,y:46,anchor:'ml'},
    tag:{x:7,y:88,anchor:'bl'}, catIcon:{x:42,y:88,anchor:'bc'},
    seen:{x:94,y:88,anchor:'br'}, opens:{x:94,y:72,anchor:'br'},
    posted:{x:94,y:58,anchor:'mr'}, added:{x:94,y:44,anchor:'mr'},
    rank:{x:94,y:30,anchor:'tr'}, queued:{x:72,y:88,anchor:'br'},
    handle:{x:50,y:88,anchor:'bc'}, pin:{x:72,y:10,anchor:'tr'},
    freshBadge:{x:50,y:10,anchor:'tc'}, count:{x:94,y:72,anchor:'br'},
    edit:{x:94,y:26,anchor:'tr'},
  };
  Object.values(DEFAULT_POSITIONS).forEach(p=>{
    const base=ANCHOR_POINTS[p.anchor];
    p.dx=Math.round((p.x-base[0])*2.38);
    p.dy=Math.round((p.y-base[1])*1.06);
  });
  const DEFAULT_FLOWS = {...Object.fromEntries(PART_KEYS.map(k =>
    [k, DEFAULT_POSITIONS[k].anchor.endsWith('r') ? 'left' :
      DEFAULT_POSITIONS[k].anchor.endsWith('l') ? 'right' :
      DEFAULT_POSITIONS[k].anchor.startsWith('b') ? 'up' : 'down'])),desc:'down'};
  /* The middle row is the tall one — it takes whatever height the card has
     spare — so its zones hang from the top by default; everywhere else things
     sit on a common centre line. */
  const DEFAULT_ZONES = { tl:'row', tc:'row', tr:'row', ml:'top', mc:'row', mr:'top', bl:'row', bc:'row', br:'row' };

  /* Everything on the board that is a preference rather than data. The two
     heat colours are the gradient the request asked to be able to choose. */
  const DEFAULT_UI = {
    /* Which of the two boards is showing. A tab, not a filter: each platform
       has its own accounts and its own categories, and the sort, the search and
       the chips all mean "on this tab". */
    tab:'youtube',
    sort:'seen', size:'m',
    heatFrom:'#3a3a3a', heatTo:'#A78BFA',
    /* How many colours the heat gradient is allowed to be. A continuous ramp
       across forty cards is forty colours nobody can tell apart; ten is a scale
       you can actually read one card against another with. */
    heatSteps:10,
    showHeat:true, showCounts:false, hideEmpty:false,
    addMode:false,

    /* Look. Each of these is a token the whole sheet already draws with, so a
       dial here moves the system rather than one rule. */
    accent:'#A78BFA', radius:4, cardRadius:4, motion:1,

    /* ── Scale ───────────────────────────────────────────────────────────────
       The card was always dialable and the interface around it never was: the
       board answered the window and the chrome answered whatever px looked
       right on one machine. These two are the missing half.

       `uiScale` multiplies every type size and control height in the app —
       chrome and card alike, so one dial moves the board rather than six.
       `uiDensity` is the air around them, kept separate because "bigger text"
       and "more room" are two different complaints and setting one to fix the
       other is how a layout ends up wrong in both directions. */
    uiScale:1, uiDensity:1,

    /* Layout. `layout` is the shape of a card; `slots` and `zones` are where
       everything inside it sits, and both are the card editor's to write.
       Presets set several of these at once; every one of them is still a dial
       on its own afterwards. */
    layout:'card',            /* card | compact | list */
    cardWidth:268, cardHeight:132,
    slots: { ...DEFAULT_SLOTS },
    orders: Object.fromEntries(ZONES.map(z => [z, DEFAULT_ORDERS[z].slice()])),
    zones: { ...DEFAULT_ZONES },
    /* Kept to import looks saved by the short-lived free-placement editor. */
    positions: Object.fromEntries(PART_KEYS.map(k => [k,{...DEFAULT_POSITIONS[k]}])),
    flows: { ...DEFAULT_FLOWS },
    avatarSize:30,
    nameLines:2,
    gap:12,
    border:'hairline',        /* hairline | none | accent */
    surface:'raised',         /* raised | flat */

    /* Type sizes. Every one of these is a real px value the sheet reads, so
       the board can be set to whatever is comfortable rather than to whatever
       looked right on the machine it was written on. */
    nameSize:17, descSize:12.5, badgeSize:10, titleSize:54,
    headFont:'space', bodyFont:'jetbrains', metaFont:'jetbrains',

    /* What a card shows. Off is a real answer for every one of them. */
    showAvatars:true, showDesc:true, descLines:4,
    showTag:true, showCategoryIcon:false, showSeen:true, showNew:true, showPin:true,

    /* ── The avatar ──────────────────────────────────────────────────────────
       Six dials, because a picture is the thing the eye lands on first and
       there is no one right way to show forty of them at once.

       `fallback` is the one that earns its place hardest: off disk a board has
       no avatars at all — a file:// page cannot fetch youtube.com and never
       will — so without it that half of HUB has an empty slot on every card.
       An initial in the category's colour is a picture of a sort. */
    avatarShape:'circle',     /* circle | rounded | squircle | square | hex */
    avatarBorder:'hairline',  /* none | hairline | accent | ring */
    avatarFit:'cover',        /* cover | contain */
    avatarTone:'full',        /* full | mono | hover | tint */
    avatarFallback:'initial', /* initial | icon | ghost | none */
    /* The picture again, huge and faint, behind the whole card. 0 is off. */
    avatarWash:0,
    washEffect:'soft',        /* soft | mono | vivid | duotone | drift | zoom
                                 | pan | rotate | glass | sepia | parallax | spotlight */
    washPosition:'center', washBlur:1,
    /* The rest of the background, one dial each: how the picture is cut out of
       the card, how it mixes with the ground under it, and what it is fitted
       to. A background is the largest thing on a card, so it is the one that
       most wants to be settable rather than decided once here. */
    washMask:'diagonal',      /* diagonal | bottom | top | radial | left | none */
    washBlend:'normal',       /* normal | multiply | screen | overlay | soft-light | luminosity */
    washFit:'cover',          /* cover | contain | tile */
    washSaturate:100, washContrast:100, washRotate:0, washHoverBoost:135,
    /* The rest of the picture's own colour, and the speed of the effects that
       move on their own. `washFade` is how far the mask lets the picture reach
       before it is gone: the same mask, pulled in or let out. */
    washBrightness:100, washHue:0, washSpeed:100, washFade:100,
    /* The overlay laid over the picture, and what colour it is drawn in. */
    washOverlayColor:'category', /* category | accent | ground | custom */
    washOverlayCustom:'',
    /* How the overlay sits on the picture, and which way the ones with a
       direction actually run. */
    washOverlayBlend:'normal', /* normal | multiply | screen | overlay | soft-light | color-dodge */
    washOverlayAngle:125,
    /* The card's own ground, which is a background too and has never had a
       dial of its own: a wash of a colour under everything, and a gradient. */
    cardTint:'none',          /* none | category | accent | custom */
    cardTintStrength:10, cardTintColor:'',
    cardTintHover:false,      /* the same wash again, stronger, under the pointer */
    cardGradient:'none',      /* none | top | bottom | diagonal | radial | edge
                                 | conic | corner | sweep */
    cardGradientStrength:100,
    /* A texture over the ground: the one background that is neither a picture
       nor a colour. Faint by default, because a texture you notice is a
       pattern, and a pattern is a different card. */
    cardTexture:'none',       /* none | noise | grain | grid | dots | lines | crosshatch */
    cardTextureOpacity:12, cardTextureScale:8,
    cardShadow:'none',        /* none | soft | deep | glow | inner */

    hoverEffect:'lift',       /* none | lift | zoom | glow | tilt | sink | pop | border | bright */
    hoverStrength:100,        /* how far a hover effect moves, as a percentage */
    hoverSpeed:22,            /* and how long it takes to get there, in hundredths of a second */
    avatarHover:'none',       /* none | zoom | spin | tilt | bounce */

    /* Kept for older saved looks; grid placement supersedes avatar pinning. */
    dotOnAvatar:false,
    newDotSize:7,
    newDotColor:'',
    dotAnimation:'none',      /* none | pulse | blink | ping | bounce */

    /* Something posted in the last `freshHours` gets a card of its own — a lit
       edge and a glow, so "there is something to watch right now" is a thing
       you see across the board rather than a dot you go looking for. */
    showFresh:true, freshHours:24,
    freshStyle:'glow',        /* glow | edge | tint | minimal */
    freshAnimation:'sheen',   /* none | sheen | breathe | ripple | pulse
                                 | shimmer | scan | orbit | flicker | bounce */
    /* How the fresh animation runs, rather than which one it is: its curve, its
       direction, and how far apart two cards start from each other. */
    freshEasing:'ease',       /* ease | linear | steady | spring | bounce */
    freshDirection:'normal',  /* normal | reverse | alternate */
    animationStagger:0,       /* ms between one card starting and the next */
    /* Which card counts as first for that stagger. A wave has to start
       somewhere, and the top left is only one of the answers. */
    staggerOrder:'index',     /* index | reverse | random | center | edges */
    /* How many times a looping effect runs before it stops. 0 is forever,
       which is what every one of them did before this was a dial. */
    freshLoops:0,
    freshColor:'', freshColorSource:'accent',
    freshIntensity:60, freshSpeed:3.4, freshName:true, freshBadge:false,
    refreshEffect:'sweep',    /* sweep | pulse | bar | blink | dim | none */
    freshAging:false,
    animationSchedule:'continuous', pauseOffscreen:true,
    /* How a card arrives on the board. The stagger is per card, so a board of
       forty is a wave rather than forty things happening at once. */
    cardEnter:'rise',         /* none | fade | rise | drop | scale | slide | flip | blur
                                 | pop | swing | unfold | zoomout | wipe | spin */
    enterStagger:22, enterSpeed:.34,
    enterEasing:'out',        /* out | ease | linear | steady | spring | bounce | snap | elastic */
    cardExit:'shrink', exitSpeed:.18,
    reorderSpeed:.34, reorderEasing:'ease', filterAnimation:'entry', filterSpeed:.34,
    sheetAnimation:'scale', sheetSpeed:.26,
    avatarSpeed:.8, dotSpeed:2, refreshSpeed:1.4,
    previewSpeed:.24, previewDismissSpeed:.22, previewCueSpeed:2,
    washAnimationSpeed:12, pageBgSpeed:46, interfaceSpeed:.2, resizeSpeed:.28,
    washScale:100, washX:50, washY:50, washOverlay:'none', washOverlayOpacity:20,
    latestPreview:true, previewMode:'hover', previewThumbnail:true, previewActions:true,
    previewTitle:true, previewAge:true, previewThumbSize:'m', previewOnlyFresh:false,
    previewLabel:true, previewCue:true, previewCueAnimation:'pulse',
    /* The box's own hide button. It writes the channel's `hidePreview`, the
       same switch the edit pane carries — this is the one that is on the card,
       which is where you are standing when you decide you never want it. */
    previewHideButton:true,
    previewAnimation:'fade',  /* none | fade | slide | expand | zoom */
    previewDismissAnimation:'shrink',
    uploadView:'all', groupUploads:false,
    savedLooks:[], categoryLooks:{}, pinnedLook:'',
    stickyPreview:true, popupFresh:true, popupLimit:5, popupThumbnails:true,
    popupQueue:true, popupQuickActions:true, popupGuard:true,

    /* Opens as a badge among the others, or as a plain number in the corner at
       the name's own size. */
    countStyle:'badge',       /* badge | number */

    /* Optional card facts. */
    showPosted:false, showAdded:false, showRank:false,
    showQueued:false, showHandle:false,

    /* Board behaviour. `openTab` is which of a channel's own tabs a card lands
       on: its home page is a trailer and three shelves, its videos tab is the
       thing you clicked for. */
    enterOpens:true, newTab:true, openTab:'videos',
    /* The same choice on the other board. Instagram's profile *is* the grid, so
       unlike YouTube there is nothing to skip past and `posts` is the url
       unchanged — but reels and tagged are real pages worth landing on. */
    igTab:'posts',              /* posts | reels | tagged */
    /* Pinned channels ahead of every sort, and the number of channels with
       something new in the tab's own title — which is what makes HUB worth
       leaving open in a pinned tab, or installed. */
    pinFirst:true, titleCount:true,

    /* The extension. checkEvery is in hours; a feed that is polled harder than
       this tells you nothing more, because uploads are not that frequent. */
    queueButton:true, checkNew:true, checkEvery:6,
    /* How many channels are asked about at once, and how many days an avatar is
       trusted for. The first is the whole of "make the refresh faster"; the
       second is why a refresh no longer re-reads forty channel pages to learn
       nothing. */
    lanes:5, pageDays:14,
    /* Instagram's own, and much smaller. A YouTube lane is a few kilobytes of
       XML; an Instagram lane is a whole page rendering in a real tab. Two at a
       time is the shape of somebody browsing, which is the only shape that does
       not eventually get soft-blocked. */
    igLanes:2,
    /* Favourite categories first in every list you pick one from. */
    favFirst:true,
    /* 0 is "as wide as the window". Anything else is a pixel measure, which is
       what an ultrawide needs: the board reflows to any width, but a board four
       thousand pixels across is a wall, not a page. */
    maxWidth:1560,

    /* The page's own background. The largest background on the board is the
       one behind it, and until now it was a flat colour with no dial at all.
       Every answer here draws *over* --bg rather than replacing it, so `plain`
       is exactly what it always was and none of the rest can take the ground
       out from under the cards. */
    pageBg:'plain',           /* plain | gradient | glow | grid | dots | noise
                                 | vignette | aurora | rays */
    pageBgColor:'',           /* empty is the accent */
    pageBgStrength:40, pageBgScale:28, pageBgAngle:160, pageBgAnimate:false,
  };

  const EFFECT_KEYS = ['avatarWash','washEffect','washPosition','washBlur','washScale','washX','washY',
    'washOverlay','washOverlayOpacity','washMask','washBlend','washFit','washSaturate','washContrast',
    'washRotate','washHoverBoost','washOverlayColor','washOverlayCustom',
    'washBrightness','washHue','washSpeed','washFade','washOverlayBlend','washOverlayAngle',
    'cardTint','cardTintStrength','cardTintColor','cardTintHover','cardGradient','cardGradientStrength',
    'cardTexture','cardTextureOpacity','cardTextureScale','cardShadow',
    'hoverEffect','hoverStrength','hoverSpeed','avatarHover','dotAnimation','freshStyle','freshAnimation',
    'freshColor','freshColorSource','freshIntensity','freshSpeed','freshName','freshBadge','freshAging',
    'freshEasing','freshDirection','animationStagger','staggerOrder','freshLoops'];
  const LOOK_KEYS = [...EFFECT_KEYS, 'layout','slots','zones','positions','flows','avatarSize','nameLines','gap','border',
    'surface','cardWidth','cardHeight','cardRadius','orders','nameSize','descSize','badgeSize','headFont','bodyFont','metaFont','showAvatars','showDesc','descLines','showTag','showCategoryIcon',
    'showSeen','showNew','showPin','avatarShape','avatarBorder','avatarFit','avatarTone','avatarFallback',
    'dotOnAvatar','newDotSize','newDotColor','showFresh','freshHours','countStyle','showCounts','showHeat',
    'heatFrom','heatTo','heatSteps','showPosted','showAdded','showRank','showQueued','showHandle',
    'refreshEffect','animationSchedule','pauseOffscreen','latestPreview','previewMode','previewThumbnail','previewActions',
    'previewTitle','previewAge','previewThumbSize','previewOnlyFresh','previewHideButton','previewAnimation',
    'previewLabel','previewCue','previewCueAnimation','previewDismissAnimation',
    'cardEnter','enterStagger','enterSpeed','enterEasing','cardExit','exitSpeed','reorderSpeed','reorderEasing','filterAnimation','filterSpeed','sheetAnimation','sheetSpeed',
    'avatarSpeed','dotSpeed','refreshSpeed','previewSpeed','previewDismissSpeed','previewCueSpeed','washAnimationSpeed','pageBgSpeed','interfaceSpeed','resizeSpeed',
    'pageBg','pageBgColor','pageBgStrength','pageBgScale','pageBgAngle','pageBgAnimate'];
  const pickLook = ui => Object.fromEntries(LOOK_KEYS.map(k => [k, ui[k]]));
  const BUILTIN_LOOKS = [
    {id:'quiet',name:'Quiet',look:{freshStyle:'edge',freshAnimation:'none',freshIntensity:35,avatarWash:10,washEffect:'mono',hoverEffect:'none',animationSchedule:'hover'}},
    {id:'neon',name:'Neon',look:{freshStyle:'glow',freshAnimation:'breathe',freshIntensity:90,freshColorSource:'category',avatarWash:22,washEffect:'duotone',hoverEffect:'glow',freshBadge:true}},
    {id:'cinematic',name:'Cinematic',look:{freshStyle:'tint',freshAnimation:'sheen',avatarWash:28,washEffect:'drift',washOverlay:'gradient',washOverlayOpacity:30,avatarSize:48,nameSize:19,hoverEffect:'zoom',freshAging:true}},
  ];
  const looks = ui => [...BUILTIN_LOOKS.map(p => ({...p,look:pickLook({...DEFAULT_UI,...p.look})})), ...ui.savedLooks];
  const effectiveLook = (ui, ch) => {
    const id = (ch.pin && ui.pinnedLook) || ui.categoryLooks[ch.cat];
    const preset = looks(ui).find(p => p.id === id);
    return preset ? {...ui,...Object.fromEntries(EFFECT_KEYS.map(k=>[k,preset.look[k]]))} : ui;
  };
  const uploadAge = (ch, now = Date.now()) => ch.latest && Number.isFinite(+ch.latest.at) && +ch.latest.at > 0 ? now - ch.latest.at : Infinity;
  const uploadGroup = (ch, now) => {
    const age = uploadAge(ch, now);
    return age < 0 || age === Infinity ? 'unknown' : age < 864e5 ? 'today' : age < 7 * 864e5 ? 'week' : 'older';
  };

  /* ── Category icons ────────────────────────────────────────────────────────
     Twenty, plus none. Inner SVG markup rather than a font or a sprite, so
     there is nothing to load and they inherit currentColor — which is the
     category's own colour wherever they are drawn. Stroke-only and on the same
     24-unit grid, so they sit at any size without going soft.

     They are drawn with innerHTML, which is safe because this object is the
     only source: an icon is a key, and a key that is not in here draws nothing. */
  const ICONS = {
    play:   '<path d="M9 6l10 6-10 6z"/>',
    music:  '<circle cx="7" cy="18" r="2.5"/><circle cx="18" cy="16" r="2.5"/><path d="M9.5 18V6l11-2v12"/>',
    code:   '<path d="M9 7l-5 5 5 5M15 7l5 5-5 5"/>',
    book:   '<path d="M4 5a2 2 0 0 1 2-2h12v16H6a2 2 0 0 0-2 2z"/><path d="M18 17H6"/>',
    tool:   '<path d="M17 3a5 5 0 0 0-4.6 7L4 18.4 5.6 20l8.4-8.4A5 5 0 0 0 21 7l-3 3-2-2z"/>',
    camera: '<path d="M3 8h4l1.5-2h7L17 8h4v11H3z"/><circle cx="12" cy="13" r="3.5"/>',
    game:   '<rect x="3" y="8" width="18" height="10" rx="4"/><path d="M8 11v4M6 13h4M16 12h.01M18 15h.01"/>',
    chip:   '<rect x="7" y="7" width="10" height="10" rx="1"/><path d="M10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4"/>',
    flask:  '<path d="M10 3v6L4 19a2 2 0 0 0 2 3h12a2 2 0 0 0 2-3l-6-10V3"/><path d="M9 3h6"/>',
    art:    '<path d="M12 3a9 9 0 1 0 0 18 2 2 0 0 0 1.6-3.2 2 2 0 0 1 1.6-3.2H18a3 3 0 0 0 3-3A9 9 0 0 0 12 3z"/><circle cx="8" cy="10" r="1"/><circle cx="12" cy="7.5" r="1"/><circle cx="16" cy="10" r="1"/>',
    lift:   '<path d="M3 9v6M6 7v10M18 7v10M21 9v6M6 12h12"/>',
    plane:  '<path d="M21 15l-9-4V5a1.5 1.5 0 0 0-3 0v6l-9 4v2l9-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L12 19v-4.5L21 17z"/>',
    food:   '<path d="M6 3v8a2 2 0 0 0 4 0V3M8 11v10"/><path d="M17 3c-1.5 2-2 4-2 6s.7 3 2 3v9"/>',
    car:    '<path d="M3 17v-4l2-5h14l2 5v4z"/><path d="M5 17v2h3v-2M16 17v2h3v-2"/><circle cx="8" cy="14" r="1"/><circle cx="16" cy="14" r="1"/>',
    leaf:   '<path d="M4 20c0-9 6-14 16-14 0 10-5 15-13 15-1 0-3-.5-3-1z"/><path d="M9 15c2-3 5-5 8-6"/>',
    home:   '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>',
    star:   '<path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2-5.5-2.9L6.5 20l1-6.2L3 9.6l6.2-.9z"/>',
    heart:  '<path d="M12 20S3 14.5 3 8.8A4.8 4.8 0 0 1 12 6a4.8 4.8 0 0 1 9 2.8C21 14.5 12 20 12 20z"/>',
    globe:  '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 3 2.5 15 0 18-2.5-3-2.5-15 0-18z"/>',
    bolt:   '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  };
  const ICON_KEYS = Object.keys(ICONS);

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  function normUrl(raw){
    const s = String(raw || '').trim();
    if (!s) return '';
    return /^https?:\/\//i.test(s) ? s : 'https://' + s.replace(/^\/+/, '');
  }

  /* A pasted URL is the one field that is always there, so the name comes off
     it when the name box is blank. The handle is the only spelling that reads
     like a name; for a /channel/ id there is nothing better without a network
     call, and the "+ add" button passes the page's title instead. */
  function nameFromUrl(raw){
    const s = normUrl(raw);
    if (!s) return '';
    let path;
    try { path = new URL(s).pathname } catch { return '' }
    const seg = path.split('/').filter(Boolean);
    if (!seg.length) return '';
    /* Instagram spells an account one way and one way only, and the handle is
       the name — there is no second spelling to fall back from. It is written
       with the @ that YouTube handles carry, because that is how it is read
       aloud and how it sorts alongside them. */
    if (platformOf(s) === 'instagram'){
      const user = decodeURIComponent(seg[0]);
      return /^[\w.]{1,30}$/.test(user) ? '@' + user.toLowerCase() : '';
    }
    if (seg[0].startsWith('@')) return seg[0];
    if (['c','user','channel'].includes(seg[0]) && seg[1]) return decodeURIComponent(seg[1]);
    return decodeURIComponent(seg[0]);
  }

  function makeChannel({ url, name, desc, cat, platform }){
    const u = normUrl(url);
    return {
      id: uid(),
      url: u,
      /* Told, or read off the url, and youtube if it is neither — a record with
         no board to sit on would be invisible on both. */
      platform: isPlatform(platform) ? platform : (platformOf(u) || 'youtube'),
      name: String(name || '').trim() || nameFromUrl(u) || 'untitled',
      desc: String(desc || '').trim(),
      cat: cat || '',
      pin: false,
      hidePreview: false,
      previewDismissed: '',
      /* Empty until the account has been looked at, and an array from the start
         so nothing has to guard against it being missing on a record that was
         made in this session rather than read back from storage. */
      igPosts: [],
      added: Date.now(),
      seen: null,         /* null is "never viewed", not "viewed at 0" */
      clicks: 0,
    };
  }

  /* Records written before v0.3.0 have no click count and no category order.
     Filling them in on read rather than migrating on write means an old board
     opened in a new build is simply correct, with nothing to run first. */
  const fillChannel = c => withPlatform({
    clicks:0, seen:null, desc:'', cat:'', pin:false,
    /* One card saying "hide the latest video here". The box is a board-wide
       setting, and this is the exception to it: a channel whose newest upload
       you do not want announced on the board. */
    hidePreview:false, previewDismissed:'',
    /* Filled in later by the extension, from the channel's own page and feed.
       Empty is not an error, it is "not looked up yet". */
    ytId:'', avatar:'', latest:null, checkedAt:0, pageAt:0,
    /* The shortcodes across the top of an Instagram grid, as of the last look.
       This is Instagram's answer to a feed: there are no timestamps on a grid,
       but the codes are stable ids, so "something new" is a code that was not
       here last time. It also disposes of pinned posts for nothing — a pinned
       post never leaves the top and so is never new twice. */
    igPosts:[],
    /* When the new-video dot was last cleared. Separate from `seen` because
       clearing a dot is not the same as saying you watched the channel — a
       board seeded with forty channels wants all forty dots gone without every
       one of them claiming to have been opened just now. */
    dotAt:0,
    ...c,
  });
  /* Every board written before there were two of them is a YouTube board, and
     its urls say so. Reading the platform off the url rather than defaulting it
     means an old export is simply correct on import, with nothing to migrate. */
  const withPlatform = c => {
    c.platform = isPlatform(c.platform) ? c.platform : (platformOf(c.url) || 'youtube');
    return c;
  };
  /* A category belongs to one board too. An old one has no platform and every
     channel it holds is a YouTube channel, so youtube is the only answer that
     does not silently empty somebody's board. */
  const fillCat = (c, i) => ({ order:i, icon:'', fav:false, platform:'youtube', ...c,
    platform: isPlatform(c && c.platform) ? c.platform : 'youtube' });

  /* The stored ui, filled out. A plain spread would be enough if every setting
     were flat, but `slots` and `zones` are objects: a board stored before a part
     existed has a slots object without it, and a shallow merge would hand back
     that object with the new part missing rather than defaulted. */
  const fillUi = raw => {
    const u = { ...DEFAULT_UI, ...(raw && typeof raw === 'object' ? raw : {}) };
    const storedSlots = u.slots && typeof u.slots === 'object' ? u.slots : {};
    u.slots = { ...DEFAULT_SLOTS, ...storedSlots };
    const legacyBadgeSlot = ZONES.includes(storedSlots.badges) ? storedSlots.badges : null;
    if (legacyBadgeSlot) ['seen','opens','posted','added','rank','queued','handle','pin','freshBadge']
      .forEach(k => { if (!Object.hasOwn(storedSlots,k)) u.slots[k] = legacyBadgeSlot });
    const storedOrders = raw && raw.orders && typeof raw.orders === 'object' ? raw.orders : {};
    u.orders = makeOrders(u.slots, storedOrders);
    u.zones = { ...DEFAULT_ZONES, ...(u.zones && typeof u.zones === 'object' ? u.zones : {}) };
    /* Anything that is not a zone is a part with nowhere to be, which draws
       nothing at all. A stored name of a slot that no longer exists goes back
       to where it started rather than off the card. */
    PART_KEYS.forEach(k => { if (!ZONES.includes(u.slots[k])) u.slots[k] = DEFAULT_SLOTS[k] });
    ZONES.forEach(z => { if (!['row','top','column'].includes(u.zones[z])) u.zones[z] = 'row' });
    const storedPositions = raw && raw.positions && typeof raw.positions === 'object' ? raw.positions : {};
    u.positions = Object.fromEntries(PART_KEYS.map(k => {
      const p = storedPositions[k];
      if (p && Number.isFinite(+p.x) && Number.isFinite(+p.y)){
        const x = Math.min(100, Math.max(0, +p.x));
        const y = Math.min(100, Math.max(0, +p.y));
        const anchor=anchorFromPoint(x,y);
        const base=ANCHOR_POINTS[anchor];
        const width=Math.max(1,(+u.cardWidth||268)-30);
        const height=Math.max(1,(+u.cardHeight||132)-26);
        const dx=Number.isFinite(+p.dx) ? +p.dx : (x-base[0])*width/100;
        const dy=Number.isFinite(+p.dy) ? +p.dy : (y-base[1])*height/100;
        return [k,{x,y,anchor,dx,dy}];
      }
      if (raw && raw.slots && raw.slots[k] && raw.slots[k] !== DEFAULT_SLOTS[k]){
        const point = ANCHOR_POINTS[u.slots[k]] || ANCHOR_POINTS.mc;
        return [k,{x:point[0],y:point[1],anchor:u.slots[k],dx:0,dy:0}];
      }
      return [k,{...DEFAULT_POSITIONS[k]}];
    }));
    const storedFlows = u.flows && typeof u.flows === 'object' ? u.flows : {};
    u.flows = Object.fromEntries(PART_KEYS.map(k =>
      [k,['up','down','left','right'].includes(storedFlows[k]) ? storedFlows[k] : DEFAULT_FLOWS[k]]));
    const choices = {
      washEffect:['soft','mono','vivid','duotone','drift','zoom','parallax','spotlight',
                  'pan','rotate','glass','sepia','invert','bloom','breathe','sway',
                  'kenburns','tilt','float','orbit','pulse','diagonal'],
      washPosition:['left','center','right'],
      washMask:['diagonal','bottom','top','radial','left','right','vignette',
                'corner','edges','none'],
      washBlend:['normal','multiply','screen','overlay','soft-light','luminosity',
                 'hard-light','color-dodge','color-burn','difference','exclusion',
                 'lighten','darken','hue','saturation','color'],
      washFit:['cover','contain','tile','width','height','stretch'],
      washOverlayColor:['category','accent','ground','custom'],
      washOverlayBlend:['normal','multiply','screen','overlay','soft-light','color-dodge'],
      cardTint:['none','category','accent','custom'],
      cardGradient:['none','top','bottom','diagonal','radial','edge','conic','corner','sweep'],
      cardTexture:['none','noise','grain','grid','dots','lines','crosshatch'],
      cardShadow:['none','soft','deep','glow','inner'],
      hoverEffect:['none','lift','zoom','glow','tilt','sink','pop','border','bright',
                   'shake','swing','flip','outline','saturate','rotate','skew','wobble'],
      avatarHover:['none','zoom','spin','tilt','bounce','flip','pop','shake','swing','glow','breathe','wobble'],
      dotAnimation:['none','pulse','blink','ping','bounce','wobble','breathe','flash','spin','orbit','shake'],
      freshStyle:['glow','edge','tint','minimal'],
      freshAnimation:['none','sheen','breathe','ripple','pulse','shimmer','scan','orbit',
                      'flicker','bounce','glint','wave','halo','corners','rays','neon',
                      'float','aurora'],
      freshEasing:['ease','linear','steady','spring','bounce','snap','elastic'],
      freshDirection:['normal','reverse','alternate','alternate-reverse'],
      staggerOrder:['index','reverse','random','center','edges'],
      freshColorSource:['accent','category','custom'],
      refreshEffect:['sweep','pulse','bar','blink','dim','glow','stripe','spin','ripple','shimmer','none'],
      washOverlay:['none','gradient','vignette','top','bottom','scanlines','grid',
                   'dots','noise','diagonal','mesh','frame','corners'],
      pageBg:['plain','gradient','glow','grid','dots','noise','vignette','aurora','rays'],
      animationSchedule:['continuous','hover','once','new'],
      cardEnter:['none','fade','rise','drop','scale','slide','flip','blur',
                 'pop','swing','unfold','zoomout','wipe','spin','glide','tumble'],
      enterEasing:['out','ease','linear','steady','spring','bounce','snap','elastic'],
      cardExit:['none','fade','shrink','slide','blur','fold','fly','drop','implode','spin'],
      reorderEasing:['ease','linear','steady','spring','snap'],
      filterAnimation:['none','entry','fade','slide','scale','blur'],
      sheetAnimation:['none','scale','slide','fade','blur','drop'],
      headFont:['space','archivo','dmsans','inter','manrope','outfit','syne','system'],
      bodyFont:['jetbrains','archivo','dmsans','inter','manrope','outfit','space','system'],
      metaFont:['jetbrains','spacemono','inter','dmsans','archivo','system'],
      tab:PLATFORM_KEYS,
      size:['s','m','l','custom'],
      igTab:['posts','reels','tagged'],
      previewMode:['hover','always','click'], previewThumbSize:['s','m','l'],
      previewAnimation:['none','fade','slide','expand','zoom','blur','flip','wipe'],
      previewCueAnimation:['none','pulse','glow','sweep','ring','bounce','border','blink'],
      previewDismissAnimation:['none','fade','shrink','slide','blur','fold','fly','drop','implode','spin'],
      uploadView:['all','today','week'],
    };
    Object.entries(choices).forEach(([k, values]) => {
      if (!values.includes(u[k])) u[k] = DEFAULT_UI[k];
    });
    Object.entries({ freshHours:[1,72], freshIntensity:[0,100], freshSpeed:[1,10],
      avatarWash:[0,100], washBlur:[0,12], motion:[0,2], washScale:[50,200],washX:[0,100],washY:[0,100],
      washOverlayOpacity:[0,80],popupLimit:[1,12],
      washSaturate:[0,200], washContrast:[50,200], washRotate:[-45,45], washHoverBoost:[100,200],
      washBrightness:[50,200], washHue:[-180,180], washSpeed:[25,400], washFade:[20,200],
      washOverlayAngle:[0,360],
      cardTintStrength:[0,40], hoverStrength:[25,200], hoverSpeed:[0,80],
      cardGradientStrength:[0,200], cardTextureOpacity:[0,40], cardTextureScale:[2,40],
      freshLoops:[0,10],
      pageBgStrength:[0,100], pageBgScale:[8,80], pageBgAngle:[0,360],
      igLanes:[1,4],
      animationStagger:[0,1500], enterStagger:[0,300], enterSpeed:[0,4], exitSpeed:[0,4],
      reorderSpeed:[0,4], filterSpeed:[0,4], sheetSpeed:[0,4], avatarSpeed:[.1,10], dotSpeed:[.1,10],
      refreshSpeed:[.1,10], previewSpeed:[0,4], previewDismissSpeed:[0,4], previewCueSpeed:[.1,10],
      washAnimationSpeed:[.1,120], pageBgSpeed:[1,300], interfaceSpeed:[0,4], resizeSpeed:[0,4],
      cardWidth:[180,520], cardHeight:[88,360], cardRadius:[0,40],
      uiScale:[0.8,1.5], uiDensity:[0.8,1.4] }).forEach(([k, [min,max]]) => {
      u[k] = Number.isFinite(+u[k]) ? Math.min(max, Math.max(min, +u[k])) : DEFAULT_UI[k];
    });
    for (const k of ['freshColor','washOverlayCustom','cardTintColor','pageBgColor'])
      if (!/^#[0-9a-f]{6}$/i.test(u[k])) u[k] = '';
    const rawLooks = Array.isArray(u.savedLooks) ? u.savedLooks : [];
    const ids = new Set(BUILTIN_LOOKS.map(p=>p.id));
    u.savedLooks = rawLooks.slice(0,40).filter(p=>{
      if (!p || typeof p.id !== 'string' || !/^[\w-]{1,80}$/.test(p.id) || ids.has(p.id) || !p.look || typeof p.look !== 'object') return false;
      ids.add(p.id); return true;
    }).map(p=>({id:p.id,name:String(p.name || 'Untitled look').slice(0,60),
      look:pickLook(fillUi({...p.look,savedLooks:[],categoryLooks:{},pinnedLook:''}))}));
    u.categoryLooks = Object.fromEntries(Object.entries(u.categoryLooks && typeof u.categoryLooks === 'object' ? u.categoryLooks : {})
      .filter(([cat,id])=>cat !== '__proto__' && ids.has(id)));
    if (!ids.has(u.pinnedLook)) u.pinnedLook = '';
    return u;
  };

  const seedCats = (platform = 'youtube') =>
    catSeed(platform).map((c, i) => ({ id:uid(), order:i, platform, ...c }));
  /* Both boards' starting categories, which is what a first run writes: an
     empty Instagram tab with no chips on it looks broken rather than new. */
  const seedAllCats = () => PLATFORM_KEYS.flatMap(p => seedCats(p));

  /* ── Export ────────────────────────────────────────────────────────────────
     One file, all three keys, stamped. `kind` is what an import checks before
     it replaces anything — a JSON file that happens to have the right-looking
     fields is not the same as a file this wrote. */
  const EXPORT_KIND = 'hub.export';

  const buildExport = (channels, cats, ui, queue) => ({
    kind: EXPORT_KIND, version: 2, at: new Date().toISOString(),
    channels, cats, ui, queue: queue || [],
  });

  /* A queued video. It carries its own title and channel, because the queue has
     to be readable without going back to YouTube to ask what any of it was. */
  const makeQueued = ({ videoId, url, title, channel, channelUrl }) => ({
    id: uid(),
    videoId: String(videoId || ''),
    url: normUrl(url) || ('https://www.youtube.com/watch?v=' + videoId),
    title: String(title || '').trim() || 'untitled',
    channel: String(channel || '').trim(),
    channelUrl: normUrl(channelUrl),
    added: Date.now(),
  });

  /* Returns { channels, cats, ui } or null. Deliberately forgiving about what
     is inside — an old export missing a field is still worth restoring — and
     unforgiving about what the file is. */
  function readExport(text){
    let d;
    try { d = JSON.parse(text) } catch { return null }
    if (!d || d.kind !== EXPORT_KIND) return null;
    if (!Array.isArray(d.channels) || !Array.isArray(d.cats)) return null;
    return {
      channels: d.channels.map(fillChannel),
      cats: d.cats.map(fillCat).sort((a, b) => a.order - b.order),
      ui: fillUi(d.ui),
      queue: Array.isArray(d.queue) ? d.queue : [],
    };
  }

  return { KEYS, PALETTE, DEFAULT_CATS, DEFAULT_IG_CATS, DEFAULT_UI, ICONS, ICON_KEYS, uid,
           PLATFORMS, PLATFORM_KEYS, isPlatform, platformOf, seedAllCats,
           LOOK_KEYS, EFFECT_KEYS, pickLook, looks, effectiveLook, uploadAge, uploadGroup,
           ZONES, ZONE_NAMES, PARTS, PART_KEYS, DEFAULT_SLOTS, DEFAULT_ORDERS, DEFAULT_ZONES,
           DEFAULT_POSITIONS, DEFAULT_FLOWS, ANCHOR_POINTS, anchorFromPoint,
           normUrl, nameFromUrl, makeChannel, makeQueued, fillChannel, fillCat, fillUi, seedCats,
           EXPORT_KIND, buildExport, readExport };
})();

if (typeof globalThis !== 'undefined') globalThis.HubModel = HubModel;
if (typeof module !== 'undefined' && module.exports) module.exports = HubModel;
