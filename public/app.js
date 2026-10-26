/* ===== BRAINS (JavaScript) =====
   "all" holds everything you have saved: experiences, blog posts, and one "settings" item (tag colors).
   Experiences have no "kind"; blog posts have kind "post". render() redraws the screen whenever something changes. */
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// Copied links start with your site's address, e.g. https://jawansb.com
const BASE = location.origin;
// The three tag categories, in the order they appear everywhere: [storage name, label, placeholder]
const KINDS = [['types', 'Type'], ['people', 'People'], ['places', 'Location']];
/* --- MOVIE / MUSIC METADATA: extra details kept on an experience whose Type is a movie or music, for your libraries and stats.
       Saved as data.movie = {year, director, genre, country, poster} and data.music = {year, artist, genre, country, cover}.
       Every field is a list (add as many as you like); poster / cover are uploaded images. None of it is shown on the site. --- */
const META = {
  movie: {label: 'Movie Metadata', match: /^(movies?|films?)$/i, fields: [['year', 'Year'], ['director', 'Director'], ['genre', 'Genre'], ['country', 'Country']], art: ['poster', 'Poster']},
  music: {label: 'Music Metadata', match: /^(music|songs?|albums?)$/i, fields: [['year', 'Year'], ['artist', 'Artist'], ['genre', 'Genre'], ['country', 'Country']], art: ['cover', 'Cover Art']}
};
const META_KEYS = Object.entries(META).flatMap(([g, m]) => m.fields.map(([f]) => g + '.' + f));   // tag keys like "movie.director"
const TAG_KEYS = [...KINDS.map(([k]) => k), ...META_KEYS];   // every kind of tag box in the form
const sel = {types: new Set(), people: new Set(), places: new Set()};
let all = [], loaded = false, assets = true, page = 'exp', focus = null, sortBy = 'date', sortDir = 'desc', draft = null;
// Drafts are saved like normal items but marked draft: true, so they stay out of the journal, blog, stats and numbering
const ents = () => all.filter(x => !x.kind && !x.draft), posts = () => all.filter(x => x.kind === 'post' && !x.draft), drafts = () => all.filter(x => x.draft);
// the one "settings" item: tag colors and the intro (title + text). saveSettings changes some of it and keeps the rest.
const settings = () => all.find(x => x.id === 'settings') || {id: 'settings', kind: 'settings'};
const saveSettings = patch => put({...settings(), ...patch});
const colors = () => settings().colors || {};
const tagsOf = (e, k) => k === 'types' ? (e.types || (e.type ? [e.type] : [])) : k.includes('.') ? ((e[k.split('.')[0]] || {})[k.split('.')[1]] || []) : (e[k] || []);

/* --- TAG COLORS. Every tag gets an automatic color (from its name) unless you pick one in Settings.
       ink() then chooses the text color: it tries a very dark and a very light shade of the SAME hue as the tag,
       keeps whichever has better contrast, and falls back to pure black/white if neither reaches the readable standard (4.5:1). --- */
const h2r = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const hsl = (h, s, l) => { s /= 100; l /= 100; const a = s * Math.min(l, 1 - l), f = n => { const k = (n + h / 30) % 12; return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); }; return '#' + [f(0), f(8), f(4)].map(x => x.toString(16).padStart(2, '0')).join(''); };
const lum = c => { const f = v => (v /= 255) <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; return .2126 * f(c[0]) + .7152 * f(c[1]) + .0722 * f(c[2]); };
const ratio = (a, b) => { const x = lum(h2r(a)), y = lum(h2r(b)); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
const hueOf = hex => { const [r, g, b] = h2r(hex).map(v => v / 255), mx = Math.max(r, g, b), d = mx - Math.min(r, g, b); if (!d) return 0; const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return (h * 60 + 360) % 360; };
function ink(bg) {
  const h = hueOf(bg), dk = hsl(h, 45, 9), lt = hsl(h, 70, 97), a = ratio(bg, dk), b = ratio(bg, lt);
  const best = a >= b ? [dk, a, '#000'] : [lt, b, '#fff'];
  return best[1] >= 4.5 ? best[0] : best[2];
}
const auto = n => { let x = 0; for (const c of n) x = (x * 31 + c.charCodeAt(0)) >>> 0; return hsl(x % 360, 62, 52); };
/* --- TAG NAMES IGNORE CAPITALS: "Food" and "food" are the same tag. Each tag is shown and colored using the first
       spelling found on the site (CANON, rebuilt on every load), so existing tags keep their colors. --- */
const key = n => n.toLowerCase();
let CANON = {};
const canon = (k, n) => CANON[k + ':' + key(n)] || n;
const uniq = (k, names) => [...new Map(names.map(n => [key(n), canon(k, n)])).values()];   // one per tag, ignoring capitals
const tcol = (k, n) => { const c = colors(), hit = Object.keys(c).find(x => key(x) === key(k + ':' + n)); return hit ? c[hit] : auto(k + canon(k, n)); };
const ts = (k, n) => { const b = tcol(k, n); return `background:${b};color:${ink(b)}`; };
const chip = (k, n) => `<span class="chip" style="${ts(k, n)}" data-act="tagflt" data-k="${k}" data-v="${esc(n)}" title="Show only “${esc(n)}”">${esc(n)}</span>`;

/* --- SUPABASE: your online database + login. The URL and publishable key are safe to be public;
       the rules you created in Supabase are what keep private items private. --- */
const SB_URL = 'https://kbrizeqpoiqgimewxixw.supabase.co', SB_KEY = 'sb_publishable_sGD5U1QpwoL4Aa4zO28c4w_0IjhUAJm';
const sb = window.supabase ? supabase.createClient(SB_URL, SB_KEY) : null;
let owner = false;   // true only while you are logged in
const flash = t => { $('toast').textContent = t; $('toast').hidden = false; setTimeout(() => $('toast').hidden = true, 5000); };
const toDoc = r => ({...r.data, id: r.id, is_public: r.is_public, kind: r.kind === 'entry' ? undefined : r.kind});
async function load() {
  if (!sb) { $('status').textContent = 'Could not load Supabase'; return; }
  const {data, error} = await sb.from('items').select('*');   // visitors only receive public rows; you receive everything
  if (error) { flash('Could not load: ' + error.message); return; }
  all = data.map(toDoc); loaded = true;
  CANON = {}; ents().forEach(e => TAG_KEYS.forEach(k => tagsOf(e, k).forEach(n => CANON[k + ':' + key(n)] ??= n)));
  render(); if (!$('modal').hidden) drawDrafts();
  if (owner) backfill();
}
async function init() {
  if (sb) {
    const {data} = await sb.auth.getSession(); owner = !!data.session;
    sb.auth.onAuthStateChange((_ev, sess) => { const was = owner; owner = !!sess; if (was !== owner) load(); });
  }
  await load();
}
// row() turns an item back into the shape Supabase stores: id, kind and is_public get their own columns, everything else goes in "data"
const row = ({id, kind, is_public, ...rest}) => ({id, kind: kind || 'entry', is_public: kind === 'settings' ? true : !!is_public, data: rest});
async function put(o) {
  const {error} = await sb.from('items').upsert(row(o));
  if (error) { flash('Save failed: ' + error.message); return false; }
  await load(); return true;
}
/* --- NUMBERS: every experience and every post gets a permanent number used in its link (/exp/1, /blog/1).
       New items get the next number. Items saved before numbers existed get numbered once, oldest first,
       the first time you're logged in. Numbers never change, so links you share keep working. --- */
const nextNum = l => Math.max(0, ...l.map(x => x.num || 0)) + 1;
let numbering = false;
async function backfill() {
  if (numbering) return;
  const todo = [];
  for (const [l, when] of [[ents(), e => e.start], [posts(), p => p.created]]) {
    let n = nextNum(l);
    l.filter(x => !x.num).sort((a, b) => when(a).localeCompare(when(b))).forEach(x => todo.push({...x, num: n++}));
  }
  if (!todo.length) return;
  numbering = true;
  const {error} = await sb.from('items').upsert(todo.map(row));
  numbering = false;
  if (error) { flash('Numbering failed: ' + error.message); return; }
  flash('Gave ' + todo.length + ' items their link numbers'); await load();
}
async function del(id) {
  const old = all.find(x => x.id === id);
  const {error} = await sb.from('items').delete().eq('id', id);
  if (error) { flash('Delete failed: ' + error.message); return; }
  if (old && (old.images || []).length) await sb.storage.from('photos').remove(old.images);
  await load();
}
async function upImg(blob) {
  const path = Date.now().toString(36) + Math.random().toString(36).slice(2, 8) + '.jpg';
  const {error} = await sb.storage.from('photos').upload(path, blob, {contentType: 'image/jpeg'});
  if (error) throw error;
  return path;
}
async function doLogin() {
  const {error} = await sb.auth.signInWithPassword({email: $('lemail').value.trim(), password: $('lpass').value});
  if (error) { $('lerr').textContent = error.message; return; }
  $('login').hidden = true; $('lpass').value = ''; $('lerr').textContent = '';
}

/* --- MATH: EXP = minutes. QoL = star average weighted by minutes. --- */
const agg = l => { const exp = l.reduce((a, e) => a + e.minutes, 0); return {exp, n: l.length, qol: exp ? l.reduce((a, e) => a + e.rating * e.minutes, 0) / exp : 0}; };
const stars = r => `<span>${[1, 2, 3, 4, 5].map(i => `<span class="st" data-i="${i}"><i style="width:${Math.max(0, Math.min(1, r - i + 1)) * 100}%">★</i>★</span>`).join('')}</span>`;
const dur = m => (m >= 60 ? Math.floor(m / 60) + 'h ' : '') + (m % 60 ? m % 60 + 'm' : (m >= 60 ? '' : '0m'));
const imgSrc = s => /^(data:|blob:|http)/.test(s) || !sb ? s : sb.storage.from('photos').getPublicUrl(s).data.publicUrl;
const cmp = (a, b) => {
  const k = {date: e => e.start, exp: e => e.minutes, rating: e => e.rating}[sortBy], x = k(a), y = k(b);
  const c = typeof x === 'string' ? x.localeCompare(y) : x - y;
  return (sortDir === 'asc' ? c : -c) || b.start.localeCompare(a.start);
};
const dirBtn = () => {
  const d = sortDir === 'desc', ar = d ? '<path d="M3 16l3 3 3-3"/>' : '<path d="M3 8l3-3 3 3"/>', bars = d ? 'M12 6h9M12 12h6M12 18h3' : 'M12 6h3M12 12h6M12 18h9';
  return `<button class="tag ico" data-act="sortDir" aria-label="${d ? 'Descending' : 'Ascending'}, tap to reverse" title="${d ? 'Descending' : 'Ascending'}: tap to reverse"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 5v14"/>${ar}<path d="${bars}"/></svg></button>`;
};

/* --- DRAWING THE SCREEN --- */
// A photo with a resize handle on its bottom-right corner. h = the height saved for it (none = the default size).
const rz = (src, h, attrs = '', inner = '') => `<span class="rz"${attrs}><img class="th" loading="lazy" decoding="async" alt="" src="${esc(src)}"${h ? ` style="height:${h}px"` : ''}><i class="rzh" title="Drag to resize"></i>${inner}</span>`;
/* --- PHOTOS: each photo is its own item: a key (its stored file name; brand-new ones have a temporary key until saved),
       where to load it from, and its size. A photo either sits in the Photos block (the gallery) or inside the description
       (an <img class="pic" data-key="..."> there); never both. --- */
const picsOf = e => e.pics || (e.images || []).map((k, i) => ({key: k, src: imgSrc(k), h: (e.imgH || [])[i]}));
const inText = e => new Set([...(e.html || '').matchAll(/data-key="([^"]+)"/g)].map(m => m[1]));   // photos placed in the description
const gal = e => { const t = inText(e), l = picsOf(e).filter(p => !t.has(p.key)); return l.length ? `<div class="gal">${l.map(p => rz(p.src, p.h)).join('')}</div>` : ''; };
// on a preview card: one photo — the one you picked (pvImg), otherwise the first — at the card's own photo size (pvImgH)
const pvPic = e => { const l = picsOf(e), p = l.find(q => q.key === e.pvImg) || l[0]; return p ? `<div class="gal pvp">${rz(p.src, e.pvImgH || 120)}</div>` : ''; };
// Edit / Delete / Copy link: small icons in the bottom-right corner of each card (hover for the name)
const ICONS = {
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  del: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>'
};
const ib = (act, v, label) => `<button class="ib" data-act="${act}" data-v="${v}" title="${label}" aria-label="${label}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[act]}</svg></button>`;
const acts = (p, x) => `<div class="acts">${owner && !x.is_public ? '<span class="pill">Private</span>' : ''}${owner ? ib('edit', x.id, 'Edit') + ib('del', x.id, 'Delete') : ''}${ib('link', `/${p}${x.num ? '/' + x.num : ''}`, 'Copy link')}</div>`;
// Clicking a title opens that item on its own page (/exp/3)
const ttl = (p, x) => `<h4>${x.num ? `<a href="/${p}/${x.num}" data-act="go" data-v="${p}/${x.num}">${esc(x.title)}</a>` : esc(x.title)}</h4>`;
/* --- POST LAYOUT: each post is built from blocks, shown in the order saved on it ("order").
       Posts without one use the default below. (Older posts may have "imgAt" = which block their photos sat under.) --- */
// "type" = Type tags; "tags" = People & Location tags
const ORDER = ['title', 'time', 'type', 'tags', 'rating', 'desc', 'photos'];
const orderOf = x => {
  let o = x.order;
  if (!o) { o = ORDER.filter(k => k !== 'photos'); o.splice(o.indexOf(x.imgAt || 'desc') + 1, 0, 'photos'); }
  // posts saved back when Type and People/Location were one block: Type goes right before People/Location
  else if (!o.includes('type')) { o = [...o]; o.splice(o.indexOf('tags'), 0, 'type'); }
  return [...o, ...ORDER.filter(k => !o.includes(k))];   // any block added in the future still shows up
};
/* --- TYPE-TAG TINT: an experience's box gets a soft wash of its Type tag's color (several Types: the average of their colors),
       blended into the normal slate box. Text and icons switch to a shade that stays readable on it (ink(), the same rule tag chips use).
       Posts with no Type keep the normal box color: --card in style.css (#3a435eca on EXP, a slightly see-through slate).
       TINT_STRENGTH = how much tag color goes in (0 = none, 1 = the full tag color; it was 1 for a day and felt too loud).
       Don't like it at all? Set TINT_CARDS to false and every box goes back to that normal color. --- */
const TINT_CARDS = true, TINT_STRENGTH = 0.3, TINT_BASE = '#3a435e';   // TINT_BASE = the normal box color, without its see-through part
const mixHex = l => '#' + [0, 1, 2].map(i => Math.round(l.reduce((a, c) => a + h2r(c)[i], 0) / l.length).toString(16).padStart(2, '0')).join('');
const blend = (a, b, t) => '#' + [0, 1, 2].map(i => Math.round(h2r(a)[i] * (1 - t) + h2r(b)[i] * t).toString(16).padStart(2, '0')).join('');
const tint = e => {
  const t = tagsOf(e, 'types'); if (!TINT_CARDS || !t.length) return '';
  const bg = blend(TINT_BASE, mixHex(t.map(n => tcol('types', n))), TINT_STRENGTH), fg = ink(bg), mix = p => `color-mix(in srgb, ${fg} ${p}%, ${bg})`;
  return `background:${bg};--ink:${fg};--mute:${mix(82)};--line:${mix(22)};--star-off:${mix(32)}`;
};
/* --- FORMATTED TEXT on posts: descriptions saved from the editor ("html") are cleaned by DOMPurify first,
       so only normal formatting and YouTube players can appear, never hidden scripts. Older posts just have plain text. --- */
const YT_EMBED = /^https:\/\/www\.youtube(-nocookie)?\.com\/embed\/[\w-]{11}/;
const rich = (h, e) => {   // e = the post, so photos placed in the text can be found
  if (!h || !window.DOMPurify) return '';   // no cleaner loaded: fall back to the plain-text copy
  const f = DOMPurify.sanitize(h, {ADD_TAGS: ['iframe'], ADD_ATTR: ['allowfullscreen', 'frameborder', 'allow'], RETURN_DOM_FRAGMENT: true});
  f.querySelectorAll('iframe').forEach(x => {
    const src = x.getAttribute('src') || '', id = (src.match(/embed\/([\w-]{11})/) || [])[1];
    if (!YT_EMBED.test(src) || !id) { x.remove(); return; }
    // LITE YOUTUBE: show the video's thumbnail with a play button; the real (heavy) YouTube player only loads when it's clicked.
    // This keeps page switching fast, and visitors don't touch YouTube at all unless they press play.
    const b = document.createElement('button'); b.className = 'yt'; b.dataset.act = 'ytplay'; b.dataset.v = src; b.setAttribute('aria-label', 'Play video');
    b.innerHTML = `<img src="https://i.ytimg.com/vi/${id}/hqdefault.jpg" alt="" loading="lazy" decoding="async"><span class="ytp"></span>`;
    x.replaceWith(b);
  });
  f.querySelectorAll('a[href]').forEach(a => { a.target = '_blank'; a.rel = 'noopener'; });   // links open in a new tab
  const pics = e ? picsOf(e) : [];
  f.querySelectorAll('img.pic').forEach(x => {   // a photo placed in the text: show it like any post photo, at its saved size
    const p = pics.find(q => q.key === x.dataset.key), w = document.createElement('div');
    if (!p) { x.remove(); return; }
    w.className = 'gal inl'; w.innerHTML = rz(p.src, p.h); x.replaceWith(w);
  });
  const d = document.createElement('div'); d.className = 'rich'; d.appendChild(f); return d.outerHTML;
};
// put a card's parts together in its order: on a preview card only the parts in pv; in "Edit preview card" (movable) each part gets a ⠿ handle
const assemble = (e, parts, pv, movable) => orderOf(e).filter(k => (!pv || pv.includes(k)) && parts[k])
  .map(k => movable ? `<div class="pp" data-k="${k}"><span class="ppg" title="Drag to move">⠿</span>${parts[k]}</div>` : parts[k]).join('');
// pv = drawing it as a small preview card on the board: only the parts listed in pv, and no Edit/Delete/Link buttons
// movable = in "Edit preview card": each part is wrapped with a ⠿ handle so you can drag it up or down on the card
const card = (e, pv, movable) => {
  const s = new Date(e.start), en = new Date(e.end), tm = x => x.toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'});
  const grp = (k, w) => tagsOf(e, k).length ? `<span class="grp"><em>${w}</em>${tagsOf(e, k).map(n => chip(k, n)).join('')}</span>` : '';
  const types = tagsOf(e, 'types').length ? `<div class="types">${tagsOf(e, 'types').map(n => chip('types', n)).join('')}</div>` : '';
  const ptags = grp('people', 'with') + grp('places', 'at');
  const parts = {
    title: ttl('exp', e),
    time: `<div class="top"><span>${s.toLocaleDateString([], {weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'})} · ${tm(s)}–${tm(en)}</span><span>${dur(e.minutes)} · +${e.minutes} EXP</span></div>`,
    type: types,
    tags: ptags ? `<div class="ptags">${ptags}</div>` : '',
    rating: `<div class="rt">${stars(e.rating)}</div>`,
    desc: rich(e.html, e) || (e.desc ? `<p>${esc(e.desc)}</p>` : ''),
    photos: pv ? pvPic(e) : gal(e)
  };
  const tn = tint(e);
  return `<div class="card entry${tn ? ' tinted' : ''}" id="e-${e.id}"${tn ? ` style="${tn}"` : ''}>${assemble(e, parts, pv, movable)}${pv ? '' : acts('exp', e)}</div>`;
};
/* --- THE BOARD (EXP page): the newest post shown in full on top, every other one as a preview card packed below like a bulletin board.
       The board is a grid of narrow columns and 10px rows. Each card spans some columns (pvC, default 2) and as many rows as it is tall
       (pvR if you've sized it in "Edit preview card", otherwise its natural height, up to 300px). "dense" packing lets small cards fill gaps left by big ones.
       ↗ on a card expands it to a full post right where it is; the grid repacks around it. ↙ shrinks it back. --- */
const PV_PARTS = [['title', 'Title'], ['time', 'Date & EXP'], ['type', 'Type'], ['tags', 'People & location'], ['rating', 'Rating'], ['desc', 'Description'], ['photos', 'Photos']];
const PV_DEFAULT = ['title', 'time', 'type', 'rating', 'desc', 'photos'];   // what a card shows until you choose
const ROW = 10, GAP = 10, FULL_COLS = 6;   // grid row height, space between cards, columns an expanded card spans
const opened = new Set();   // ids of the cards you've expanded
const ARROW = {open: '<path d="M14 10l7-7M21 9V3h-6M10 14l-7 7M3 15v6h6"/>', shut: '<path d="M4 14h6v6M20 10h-6V4M14 10l7-7M10 14l-7 7"/>'};
const boardCard = e => {
  const open = opened.has(e.id), show = e.pvShow || PV_DEFAULT;
  const cf = cardFor(e), html = open ? cf(e) : cf({...e, order: e.pvOrder || orderOf(e)}, show);   // pvOrder = the card's own order of parts, if you've set one
  return `<div class="bi${open ? ' open' : ''}" data-id="${e.id}" data-c="${open ? FULL_COLS : e.pvC || 2}"${!open && e.pvR ? ` data-r="${e.pvR}"` : ''} style="--pvh:${e.pvImgH || 120}px">${html}` +   // --pvh: the card's photo height
    (open ? '' : `<button class="bix" data-act="expand" data-v="${e.id}" tabindex="-1" aria-hidden="true"></button>`) +   // clicking anywhere on a card opens it (even on a video)
    `<button class="xp" data-act="expand" data-v="${e.id}" title="${open ? 'Shrink back to a card' : 'Open the full post here'}" aria-label="${open ? 'Shrink' : 'Expand'}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${open ? ARROW.shut : ARROW.open}</svg></button>` +
    '</div>';
};
const boardCols = () => getComputedStyle($('board')).gridTemplateColumns.split(' ').length;
// fit one card into the grid: how many columns it spans, and how many 10px rows its height needs
function layoutItem(bi, cols = boardCols()) {
  const c = bi.querySelector('.card');
  bi.style.gridColumn = `span ${Math.min(+bi.dataset.c || 2, cols)}`;
  if (bi.dataset.r) c.style.height = (bi.dataset.r * ROW - GAP) + 'px'; else c.style.height = '';
  bi.style.gridRow = `span ${bi.dataset.r || Math.ceil((c.offsetHeight + GAP) / ROW)}`;
  c.classList.toggle('clip', !bi.classList.contains('open') && c.scrollHeight > c.clientHeight + 2);   // fade out text that doesn't fit
}
function layoutBoard() { const b = $('board'); if (!b) return; const cols = boardCols(); b.querySelectorAll('.bi').forEach(bi => layoutItem(bi, cols)); }
// photos finishing loading or the window changing size: refit the cards
const boardRO = new ResizeObserver(es => { if (!$('board')) return; if (es.some(x => x.target === $('board'))) layoutBoard(); else es.forEach(x => { const bi = x.target.closest('.bi'); if (bi) layoutItem(bi); }); });
/* --- THE INTRO (far-left column). ✕ folds it away and turns into ⌄ to bring it back. Nothing is saved: it's open again on every visit.
       (The site keeps nothing in visitors' browsers: no cookies, no stored data. Only your own login is kept, by Supabase.) --- */
const ICON_X = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const ICON_DOWN = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';
let introHidden = false;
// the intro until you write your own in Settings
const INTRO_TITLE = 'what is going on.';
const INTRO_TEXT = "hello. I am Jawan. I am an insane man. This is my personal Blog website. I'm currently attempting to kick myself off of all mainstream social media sites and isolate myself in my own corner of the net. I know nothing of computers, and instead I relied exclusively upon Claude to hack this together. So there are probably extensive vulnerabilities all over this thing, all of which you can probably use to dox me and infiltrate my family. I kindly ask that you do not, and that if you have any burning questions, or any desire to hurt my feelings, that you forward them to my email: jawanali@gmail.com";
// plain text -> paragraphs (a blank line starts a new one), with email addresses and web links made clickable
const linkify = t => esc(t)
  .replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)]/g, u => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`)
  .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, m => `<a href="mailto:${m}">${m}</a>`);
const introHtml = t => t.split(/\n\s*\n/).map(p => `<p>${linkify(p.trim()).replace(/\n/g, '<br>')}</p>`).join('');
function drawIntro() {
  const st = settings();
  $('pgTitle').textContent = st.introTitle || INTRO_TITLE;
  $('intro').innerHTML = loaded ? introHtml(st.intro || INTRO_TEXT) : '';   // wait for your saved text, so the default doesn't flash first
  $('intro').hidden = introHidden; $('introx').innerHTML = introHidden ? ICON_DOWN : ICON_X;
  $('introx').title = introHidden ? 'Show the intro' : 'Hide'; $('introx').setAttribute('aria-label', introHidden ? 'Show the intro' : 'Hide the intro');
}
function drawBoard(list) {
  boardRO.disconnect(); $('journal').style.paddingBottom = '';
  const [first, ...rest] = list;
  $('feat').innerHTML = `<div class="feat">${cardFor(first)(first)}</div>`;
  $('journal').innerHTML = rest.length ? `<div class="board" id="board">${rest.map(boardCard).join('')}</div>` : '';
  if (!rest.length) return;
  layoutBoard(); boardRO.observe($('board')); $('board').querySelectorAll('.bi > .card').forEach(c => boardRO.observe(c));
}
/* --- EXPAND / SHRINK one card. Only that card is redrawn (so nothing else reloads), and the page is steadied so the card
       starts from exactly where it was on your screen. Every card then glides from its old spot to its new one (the "FLIP"
       animation trick), while the page gently scrolls the card into a good reading spot:
       expanding puts its top near the top of the screen; shrinking keeps it in view (centered if it would be off-screen). --- */
const FOCUS_TOP = 70;   // how far below the top of the screen an expanded post settles
// near the bottom of the board there may not be enough page left to scroll a post up to its reading spot: add empty space below.
// It only ever grows while you're reading (shrinking it would make the page jump) and is reset when the board is redrawn.
function roomBelow(target) {
  const j = $('journal'), cur = parseInt(j.style.paddingBottom) || 0, need = target + innerHeight - (document.documentElement.scrollHeight - cur);
  if (need > cur) j.style.paddingBottom = need + 'px';
}
function toggleCard(id) {
  const old = document.querySelector(`#board .bi[data-id="${id}"]`), e = all.find(x => x.id === id); if (!old || !e) return;
  const was = new Map([...document.querySelectorAll('#board .bi')].map(x => [x.dataset.id, x.getBoundingClientRect()])), a = was.get(id);
  opened.has(id) ? opened.delete(id) : opened.add(id);
  const t = document.createElement('div'); t.innerHTML = boardCard(e); const bi = t.firstElementChild;
  old.replaceWith(bi); boardRO.observe(bi.querySelector('.card')); layoutBoard();
  // steady the page: scroll by however far the card moved, so on screen it hasn't moved at all
  window.scrollTo({top: scrollY + bi.getBoundingClientRect().top - a.top, behavior: 'auto'});
  document.querySelectorAll('#board .bi').forEach(x => {
    const p = was.get(x.dataset.id); if (!p) return;
    const q = x.getBoundingClientRect(), dx = p.left - q.left, dy = p.top - q.top;
    const from = `translate(${dx}px, ${dy}px)` + (x === bi ? ` scale(${p.width / q.width}, ${p.height / q.height})` : '');
    if (dx || dy || x === bi) x.animate([{transform: from, transformOrigin: 'top left'}, {transform: 'none', transformOrigin: 'top left'}], {duration: 380, easing: 'cubic-bezier(.2,.7,.2,1)'});
  });
  // then glide to a comfortable reading spot
  const r = bi.getBoundingClientRect(), top = r.top + scrollY;
  if (opened.has(id)) { roomBelow(top - FOCUS_TOP); window.scrollTo({top: Math.max(0, top - FOCUS_TOP), behavior: 'smooth'}); }
  else if (r.top < FOCUS_TOP || r.bottom > innerHeight - 20) window.scrollTo({top: Math.max(0, top - Math.max(FOCUS_TOP, (innerHeight - r.height) / 2)), behavior: 'smooth'});
}
// a blog post: title, date, body, photos. pv / movable work the same as for experiences
const bcard = (p, pv, movable) => {
  const parts = {title: ttl('blog', p), time: `<div class="top"><span>${new Date(p.created).toLocaleString([], {dateStyle: 'medium', timeStyle: 'short'})}</span></div>`,
    desc: rich(p.html, p) || (p.body ? `<p>${esc(p.body)}</p>` : ''), photos: pv ? pvPic(p) : gal(p)};
  return `<div class="card entry" id="b-${p.id}">${assemble(p, parts, pv, movable)}${pv ? '' : acts('blog', p)}</div>`;
};
const cardFor = x => x.kind === 'post' ? bcard : card;   // the right card drawing for an experience or a blog post

function render() {
  const E = ents(), filtered = KINDS.some(([k]) => sel[k].size);
  const f = E.filter(e => KINDS.every(([k]) => !sel[k].size || tagsOf(e, k).some(t => sel[k].has(key(t))))).sort(cmp), sh = agg(f);
  // page switching + theme
  document.documentElement.dataset.page = page === 'blog' ? 'blog' : page === 'port' ? 'port' : 'exp';   // each page's colors
  const list = page === 'exp' || page === 'blog';   // the two pages with a board
  $('pgList').hidden = !list; $('pgSet').hidden = page !== 'set'; $('pgPort').hidden = page !== 'port';
  drawIntro();
  $('fab').hidden = !list || !owner; $('gear').hidden = !owner; $('status').hidden = !owner; $('status').textContent = 'Owner mode'; $('lock').textContent = owner ? 'Log out' : 'Owner login'; $('fab').textContent = page === 'blog' ? '+ Blog' : '+ Log';
  $('nvP').classList.toggle('cur', page === 'port'); $('nvE').classList.toggle('cur', page === 'exp' || page === 'set'); $('nvB').classList.toggle('cur', page === 'blog');
  // top cards show the filtered numbers while a filter is on
  $('totExp').textContent = sh.exp.toLocaleString(); $('totQ').textContent = sh.n ? sh.qol.toFixed(2) : '—'; $('totN').textContent = sh.n;
  $('lblExp').textContent = filtered ? 'FILTERED EXP' : 'TOTAL EXP'; $('lblQ').textContent = filtered ? 'FILTERED QoL' : 'QUALITY OF LIFE'; $('lblN').textContent = filtered ? 'MATCHING' : 'EXPERIENCES';
  $('side').hidden = page !== 'exp';   // stats and filters only on the EXP page
  $('statsBox').classList.toggle('hot', filtered);
  $('fcount').textContent = filtered ? ' · ' + KINDS.reduce((n, [k]) => n + sel[k].size, 0) + ' active' : '';
  // filter buttons, colored like their tags, with each tag's own EXP and QoL
  const rows = ([k, l]) => {
    const m = {}; E.forEach(e => tagsOf(e, k).forEach(n => { n = canon(k, n); (m[n] = m[n] || []).push(e); }));
    const r = Object.entries(m).map(([n, v]) => [n, agg(v)]).sort((a, b) => b[1].exp - a[1].exp)
      .map(([n, a]) => `<button class="tag ftag ${sel[k].has(key(n)) ? 'on' : ''}" style="${ts(k, n)};border-color:transparent" data-act="flt" data-k="${k}" data-v="${esc(n)}" title="${a.exp} EXP · ${a.qol.toFixed(2)} QoL"><b>${esc(n)}</b><span>${a.exp} · ${a.qol.toFixed(2)}</span></button>`).join('');
    return `<h3>${l.toUpperCase()}</h3><div class="tl ftl">${r || '<span class="mute">Nothing yet.</span>'}</div>`;
  };
  const opt = (v, l) => `<button class="tag ${sortBy === v ? 'on' : ''}" data-act="sortBy" data-v="${v}">${l}</button>`;
  $('tags').innerHTML = KINDS.map(rows).join('') + `<h3>SORT BY</h3><div class="tl srt">${opt('date', 'Date')}${opt('exp', 'EXP')}${opt('rating', 'Rating')}${dirBtn()}</div>`;
  tagSearch();
  // journal + blog ("focus" is set when someone opened one item by its link: its number, or its id from an old #e-/#b- link)
  const one = (p, list) => {
    if (!focus || page !== p) return list;
    const hit = list.filter(x => String(x.num) === focus || x.id === focus);
    // an old-style link found its item: swap the address bar to the new /exp/3 style
    if (hit[0] && hit[0].num && focus !== String(hit[0].num)) { focus = String(hit[0].num); history.replaceState(null, '', `/${p}/${focus}`); }
    return hit;
  };
  const back = w => focus ? `<p class="mute">Viewing one ${w} · <button class="link" data-act="unfocus">Show all</button></p>` : '';
  const none = (w, empty) => !focus ? empty : loaded ? `<p class="mute">Couldn't find that ${w}. It may be private or deleted.</p>` : '<p class="mute">Loading…</p>';
  // the Blog page: newest first (or oldest, with its Sort control), no filters
  const P = posts().sort((a, b) => (sortDir === 'asc' ? 1 : -1) * a.created.localeCompare(b.created));
  $('bside').hidden = page !== 'blog';
  $('bside').innerHTML = `<h3>SORT BY</h3><div class="tl srt"><button class="tag on">Date</button>${dirBtn()}</div>`;
  if (list) {
    const blog = page === 'blog', shown = blog ? one('blog', P) : one('exp', f), w = blog ? 'post' : 'experience';
    if (shown.length && !focus) drawBoard(shown);
    else {
      boardRO.disconnect(); $('journal').innerHTML = '';
      $('feat').innerHTML = back(w) + (shown.length ? `<div class="feat">${cardFor(shown[0])(shown[0])}</div>`
        : none(w, `<p class="mute">${blog ? 'No posts yet.' : 'Nothing here yet.'}${owner ? (blog ? ' Tap “+ Blog” to write one.' : ' Tap “+ Log” to record an experience.') : ''}</p>`));
    }
  }
  if (page === 'set') renderSet();
}
/* --- FILTER MENU: slides open and shut instead of snapping. The search box hides tags that don't match what you type. --- */
function fsOpen(want) {
  const d = $('fs'), body = d.querySelector('.fsb');
  if (d.open === want || d.dataset.busy) return;
  d.dataset.busy = 1; if (want) d.open = true;
  const h = body.scrollHeight + 'px';
  body.style.overflow = 'hidden';
  const an = body.animate({height: want ? ['0px', h] : [h, '0px'], opacity: want ? [0, 1] : [1, 0]}, {duration: 260, easing: 'ease', fill: 'forwards'});
  // finish on a timer rather than waiting for the animation, so the menu can never get stuck half-open
  setTimeout(() => { if (!want) d.open = false; an.cancel(); body.style.overflow = ''; delete d.dataset.busy; }, 270);
}
$('fs').querySelector('summary').addEventListener('click', ev => { ev.preventDefault(); fsOpen(!$('fs').open); });
function tagSearch() {
  const q = $('tq').value.trim().toLowerCase();
  document.querySelectorAll('#tags [data-act="flt"]').forEach(b => b.hidden = !!q && !b.dataset.v.toLowerCase().includes(q));
}
$('tq').addEventListener('input', tagSearch);
function renderSet() {
  const E = ents();
  const st = settings();
  $('pgSet').innerHTML = `<button class="link" data-act="go" data-v="exp">← Back</button>
    <h2>Intro</h2><p class="mute">The text in the far-left column (it shows when the window is wide). A blank line starts a new paragraph; email addresses and links become clickable.</p>
    <label>Title</label><input id="sIntroT" value="${esc(st.introTitle || INTRO_TITLE)}">
    <label>Text</label><textarea id="sIntro" rows="9">${esc(st.intro || INTRO_TEXT)}</textarea>
    <div class="srow"><button class="go2" data-act="saveintro">SAVE INTRO</button><button class="link" data-act="resetintro">Back to the original text</button></div>
    <h2>Edit tags</h2><p class="mute">Pick a color for each tag. The text color is chosen automatically so it stays readable.</p>` +
    KINDS.map(([k, l]) => { const names = uniq(k, E.flatMap(e => tagsOf(e, k))).sort((a, b) => key(a).localeCompare(key(b)));
      return `<h3>${l.toUpperCase()}</h3>` + (names.map(n => `<div class="srow"><span class="chip" style="${ts(k, n)}">${esc(n)}</span><input type="color" value="${tcol(k, n)}" data-k="${k}" data-v="${esc(n)}"><button class="link" data-act="resetc" data-k="${k}" data-v="${esc(n)}">Reset</button></div>`).join('') || '<p class="mute">No tags yet.</p>'); }).join('');
}
async function setColor(k, n, v) { const c = {...colors()}; if (v) c[k + ':' + n] = v; else delete c[k + ':' + n]; await saveSettings({colors: c}); }

/* --- THE LOG / BLOG FORM (one form, two modes: "e" = experience, "b" = blog post) --- */
const loc = d => new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 16);
const wasDraft = () => !!(draft.old && draft.old.draft);
const goLabel = () => draft.editId && !wasDraft() ? 'SAVE CHANGES' : draft.kind === 'b' ? 'POST' : 'LOG';
const btnReset = () => { $('go').disabled = $('sd').disabled = false; $('go').textContent = goLabel(); $('sd').textContent = 'SAVE DRAFT'; };
// Type is its own block; People and Location share one. Press Enter after typing a tag.
// While you type, tags you've used before that match show up underneath (#s-types etc.).
const tfBlock = ([k, l]) => `<div class="tin"><label>${l}</label><div id="c-${k}"></div><input id="i-${k}" data-k="${k}" autocomplete="off"><div class="sug" id="s-${k}" hidden></div></div>`;
$('tfType').innerHTML = tfBlock(KINDS[0]); $('tf').innerHTML = `<div class="two">${tfBlock(KINDS[1])}${tfBlock(KINDS[2])}</div>`;
// the Movie / Music Metadata sections (under Type). They're built once and only shown when a Type tag matches.
$('tfMeta').innerHTML = Object.entries(META).map(([g, m]) => `<div class="meta" id="meta-${g}" hidden><h4 class="mtitle">${m.label}</h4>
  <div class="two">${m.fields.slice(0, 2).map(([f, l]) => tfBlock([g + '.' + f, l])).join('')}</div>
  <div class="two">${m.fields.slice(2).map(([f, l]) => tfBlock([g + '.' + f, l])).join('')}</div>
  <div><label>${m.art[1]}</label><div class="arts" id="art-${g}"></div><input type="file" accept="image/*" multiple data-art="${g}"></div></div>`).join('');
function drawMeta() {
  for (const [g, m] of Object.entries(META)) {
    $('meta-' + g).hidden = !draft.types.some(t => m.match.test(t.trim()));
    $('art-' + g).innerHTML = draft.art[g].map((im, i) => `<span class="pv"><img class="th" src="${esc(im.url)}" alt=""><button class="x1" data-act="rmArt" data-k="${g}" data-v="${i}" title="Remove">✕</button></span>`).join('');
  }
}
// poster / cover art: shrunk in your browser like photos, uploaded when you save
$('tfMeta').addEventListener('change', async ev => {
  const g = ev.target.dataset.art; if (!g) return;
  for (const f of [...ev.target.files]) {
    try { const b = await shrink(f); draft.art[g].push({blob: b, url: URL.createObjectURL(b)}); }
    catch (x) { $('err').textContent = 'Could not read “' + f.name + '”.'; }
  }
  ev.target.value = ''; drawMeta();
});
function drawDraft() {
  TAG_KEYS.forEach(k => $('c-' + k).innerHTML = draft[k].map(n => `<span class="chip" style="${ts(k, n)}">${esc(n)}<button class="x" data-act="rmTag" data-k="${k}" data-v="${esc(n)}">✕</button></span>`).join(''));
  drawMeta();
  drawStars();
  $('ph').innerHTML = draft.imgs.map((im, i) => rz(im.url, im.h, ` data-i="${i}"`, `<button class="x1" data-act="rmI" data-v="${i}" title="Remove this photo">✕</button><button class="pin" data-act="pin" data-v="${i}"></button>`).replace('class="rz"', 'class="rz pv"')).join('');
  drawPins();
}
/* --- PHOTOS IN THE TEXT: each photo in the Photos block has a button to put it into the description (where your cursor last was)
       or take it back out. Drag a photo in the Photos block to reorder; drag its corner to size it (everywhere it appears). --- */
const picsInEditor = () => new Set(Q ? [...Q.root.querySelectorAll('img.pic')].map(x => x.dataset.key) : []);
function drawPins() {   // update each photo's button: "Put in text" or "In text ✕"
  const t = picsInEditor();
  $('ph').querySelectorAll('.pv').forEach(x => { const im = draft.imgs[+x.dataset.i]; if (!im) return; const on = t.has(im.key); x.classList.toggle('intext', on); x.querySelector('.pin').textContent = on ? 'In text ✕' : 'Put in text'; });
}
function removePic(key) {   // take a photo out of the text
  if (!Q) return;
  [...Q.root.querySelectorAll('img.pic')].filter(x => x.dataset.key === key).reverse().forEach(n => { const b = Quill.find(n); if (b) Q.deleteText(Q.getIndex(b), 1, 'user'); });
}
function pinToggle(i) {
  const im = draft.imgs[i]; if (!Q) return;
  if (picsInEditor().has(im.key)) removePic(im.key);
  else {
    const r = Q.selection.lastRange; let at = r ? r.index : Q.getLength() - 1;   // where your cursor last was, or the end
    const [line, off] = Q.getLine(at); if (line && off > 0) at = Q.getIndex(line) + line.length();   // mid-line: after that line
    Q.insertEmbed(at, 'pic', {key: im.key}, 'user'); Q.setSelection(at + 1, 0, 'silent');
  }
  drawPins();
}
// drag a photo (the picture itself) left/right/up/down in the Photos block to change the order
let phDrag = null;
$('ph').addEventListener('pointerdown', ev => { const img = ev.target.closest('.pv img'); if (!img) return; ev.preventDefault(); phDrag = img.closest('.pv'); phDrag.classList.add('dragging'); $('ph').setPointerCapture(ev.pointerId); });
$('ph').addEventListener('pointermove', ev => {
  if (!phDrag) return;
  const next = [...$('ph').children].find(x => { const r = x.getBoundingClientRect(); return x !== phDrag && (ev.clientY < r.top || (ev.clientY < r.bottom && ev.clientX < r.left + r.width / 2)); }) || null;
  if (phDrag.nextElementSibling !== next) $('ph').insertBefore(phDrag, next);
});
const phEnd = () => { if (!phDrag) return; phDrag = null; draft.imgs = [...$('ph').children].map(x => draft.imgs[+x.dataset.i]); drawDraft(); };
$('ph').addEventListener('pointerup', phEnd); $('ph').addEventListener('pointercancel', phEnd);
function drawStars() { $('pick').innerHTML = stars(draft.rating); $('rv').textContent = draft.rating ? draft.rating + ' / 5' : ''; }
/* --- STAR RATING: press and slide across the stars (or just click). It snaps to half stars. --- */
let rating = false;
const rateAt = ev => { const r = $('pick').firstElementChild.getBoundingClientRect(); draft.rating = Math.min(5, Math.max(0.5, Math.ceil((ev.clientX - r.left) / r.width * 10) / 2)); drawStars(); };
$('pick').addEventListener('pointerdown', ev => { if (!ev.target.closest('.st')) return; ev.preventDefault(); rating = true; rateAt(ev); $('pick').setPointerCapture(ev.pointerId); });
$('pick').addEventListener('pointermove', ev => { if (rating) rateAt(ev); });
$('pick').addEventListener('pointerup', () => rating = false); $('pick').addEventListener('pointercancel', () => rating = false);
/* --- PHOTO RESIZING: drag a photo's bottom-right corner. In the form this sets the photo's size on the post;
       on a post it just zooms that photo for whoever is looking (not saved). The post box grows or shrinks with it. --- */
let rzDrag = null;
document.addEventListener('pointerdown', ev => {
  const hdl = ev.target.closest('.rzh'); if (!hdl) return;
  ev.preventDefault();
  const img = hdl.parentElement.querySelector('img'), r = img.getBoundingClientRect();
  rzDrag = {img, x: ev.clientX, y: ev.clientY, w: r.width, h: r.height, maxW: hdl.closest('.gal, #ph').clientWidth};   // can't grow wider than its row
  hdl.setPointerCapture(ev.pointerId);
});
document.addEventListener('pointermove', ev => {
  if (!rzDrag) return;
  const {img, x, y, w, h, maxW} = rzDrag;
  const s = 1 + ((ev.clientX - x) * w + (ev.clientY - y) * h) / (w * w + h * h);   // how far you've dragged along the corner's diagonal
  img.style.height = Math.round(Math.max(60, Math.min(h * s, h * maxW / w, 1200))) + 'px';
});
// Double-click a photo on a post: grow it to the full width of the post. Double-click again to put it back.
document.addEventListener('dblclick', ev => {
  const img = ev.target.closest('.gal .th'); if (!img) return;
  if ('h0' in img.dataset) { img.style.height = img.dataset.h0; delete img.dataset.h0; return; }
  img.dataset.h0 = img.style.height;
  img.style.height = Math.round(img.closest('.gal').clientWidth * img.naturalHeight / img.naturalWidth) + 'px';
});
const rzEnd = () => {
  if (!rzDrag) return;
  const pv = rzDrag.img.closest('.pv'), h = parseInt(rzDrag.img.style.height);
  if (pv) { const im = draft.imgs[+pv.dataset.i]; im.h = h; if (Q) Q.root.querySelectorAll('img.pic').forEach(x => { if (x.dataset.key === im.key) x.style.height = h + 'px'; }); }   // in the form: remember it
  if (rzDrag.img.closest('#pvCard')) { draft.pv.imgH = h; sizePvCard(); }   // the photo on the preview card
  rzDrag = null;
};
document.addEventListener('pointerup', rzEnd); document.addEventListener('pointercancel', rzEnd);
/* --- DRAFTS: unfinished posts, saved privately. They're listed at the top of the form; click one to keep writing it. --- */
function drawDrafts() {
  if (!draft) return;
  const l = drafts().filter(x => (x.kind === 'post') === (draft.kind === 'b')).sort((a, b) => (b.saved || '').localeCompare(a.saved || ''));
  $('drf').hidden = !l.length || (draft.old && !wasDraft());   // not shown while editing an already-published post
  $('drfN').textContent = l.length ? `(${l.length})` : '';
  $('drafts').innerHTML = l.map(x => `<div class="drow${x.id === draft.editId ? ' on' : ''}"><button class="link" data-act="loaddraft" data-v="${x.id}">${esc(x.title || 'Untitled')}</button><span class="mute">${x.saved ? new Date(x.saved).toLocaleString([], {dateStyle: 'medium', timeStyle: 'short'}) : ''}</span>${ib('del', x.id, 'Delete draft')}</div>`).join('');
}
function suggest(k) {
  const q = $('i-' + k).value.trim().toLowerCase(), box = $('s-' + k);
  const known = uniq(k, ents().flatMap(e => tagsOf(e, k))).filter(n => !draft[k].some(x => key(x) === key(n)));
  const starts = n => n.toLowerCase().startsWith(q);
  const hits = q ? known.filter(n => n.toLowerCase().includes(q)).sort((a, b) => starts(b) - starts(a)).slice(0, 6) : [];
  box.innerHTML = hits.map(n => `<button type="button" class="sg" data-act="pick" data-k="${k}" data-v="${esc(n)}">${esc(n)}</button>`).join('');
  box.hidden = !hits.length;
}
/* --- MOVABLE FORM: drag a block by its ⠿ handle; the others make room as you go.
       When you save, the blocks' order becomes the post's "order". --- */
let dragSec = null;
$('secs').addEventListener('pointerdown', ev => {
  if (!ev.target.closest('.grip')) return;
  ev.preventDefault(); dragSec = ev.target.closest('.sec'); dragSec.classList.add('dragging'); $('secs').setPointerCapture(ev.pointerId);
});
$('secs').addEventListener('pointermove', ev => {
  if (!dragSec) return;
  // the first block whose middle is below the pointer: the dragged block goes just before it (or last, if none)
  const next = [...$('secs').children].find(x => x !== dragSec && !x.hidden && ev.clientY < x.getBoundingClientRect().top + x.offsetHeight / 2) || null;
  if (dragSec.nextElementSibling !== next) $('secs').insertBefore(dragSec, next);
  // near the top or bottom of the screen: scroll the form so you can drag past what's visible
  if (ev.clientY < 60) $('modal').scrollBy(0, -12); else if (ev.clientY > innerHeight - 60) $('modal').scrollBy(0, 12);
});
const endSec = () => { if (dragSec) dragSec.classList.remove('dragging'); dragSec = null; };
$('secs').addEventListener('pointerup', endSec); $('secs').addEventListener('pointercancel', endSec);
function updExp() { const m = Math.round((new Date($('e').value) - new Date($('s').value)) / 6e4); $('exp').textContent = m > 0 ? '+' + m + ' EXP' : ''; }
function addTag(k) {
  const el = $('i-' + k), v = el.value.trim().replace(/,$/, '').trim(); el.value = '';
  if (!v) return;
  const c = canon(k, v);   // typed "FOOD" but "Food" already exists: use "Food"
  if (!draft[k].some(x => key(x) === key(c))) draft[k].push(c);
  drawDraft();
}
function openModal(kind, old) {
  draft = {kind, rating: 0, imgs: [], ...Object.fromEntries(TAG_KEYS.map(k => [k, []])),
    art: Object.fromEntries(Object.keys(META).map(g => [g, ((old && old[g] && old[g][META[g].art[0]]) || []).map(r => ({ref: r, url: imgSrc(r)}))]))};
  TAG_KEYS.forEach(k => { $('i-' + k).value = ''; $('s-' + k).hidden = true; });   // start with empty tag boxes (nothing left over from the last form)
  orderOf(old || {}).map(k => $('secs').querySelector(`[data-sec="${k}"]`)).filter(Boolean).forEach(x => $('secs').appendChild(x));   // lay the blocks out in this post's order
  if (old) draft = {...draft, rating: old.rating || 0, imgs: (old.images || []).map((r, i) => ({key: r, ref: r, url: imgSrc(r), h: (old.imgH || [])[i] || null})), editId: old.id, old, ...Object.fromEntries(TAG_KEYS.map(k => [k, [...tagsOf(old, k)]]))};
  const now = new Date();
  $('s').value = loc(old && old.start ? new Date(old.start) : new Date(now - 36e5)); $('e').value = loc(old && old.end ? new Date(old.end) : now);
  $('t').value = old ? old.title : ''; edSet(old); $('fi').value = '';
  document.querySelectorAll('.xe').forEach(x => x.hidden = kind === 'b');
  $('mh').textContent = (old && !wasDraft() ? 'Edit ' : 'New ') + (kind === 'b' ? 'post' : 'experience') + (wasDraft() ? ' · draft' : '');
  $('dl').textContent = kind === 'b' ? 'Body' : 'Description';
  $('pub').checked = old ? !!(old.draft ? old.wantPublic : old.is_public) : false;
  // the preview card's settings, edited in the "Edit preview card" panel (blog posts aren't on the board, so they don't get one)
  draft.pv = {c: old && old.pvC, r: old && old.pvR, show: (old && old.pvShow) || PV_DEFAULT, order: (old && old.pvOrder) || null, img: old && old.pvImg, imgH: old && old.pvImgH};
  pvMode(false);
  $('sd').hidden = !!old && !wasDraft();   // no "Save draft" when editing a post that's already published
  btnReset(); $('err').textContent = '';
  drawDraft(); drawDrafts(); updExp(); $('modal').hidden = false; $('t').focus();
}
// Photos are shrunk in your browser before saving, so uploads stay small and fast.
const asData = b => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = no; r.readAsDataURL(b); });
async function shrink(file) {
  const max = assets ? 1600 : 800, bmp = await createImageBitmap(file), k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  const b = await new Promise(ok => c.toBlob(ok, 'image/jpeg', assets ? 0.82 : 0.6));
  if (!b) throw new Error('encode');
  return b;
}
/* --- THE DESCRIPTION EDITOR (Quill): fonts, sizes, bold/italic/underline, lists, quotes, links, videos.
       Pasting a YouTube link turns it into an embedded player. If Quill fails to load, the plain text box (#d) is used instead. --- */
const Q = window.Quill ? (() => {
  const Font = Quill.import('formats/font'); Font.whitelist = ['serif', 'typewriter', 'display', 'mono']; Quill.register(Font, true);
  // a photo placed in the text: on its own line, remembered by its key (the picture itself comes from the Photos block)
  class Pic extends Quill.import('blots/block/embed') {
    static create(v) {
      const n = super.create(), p = draft && draft.imgs.find(i => i.key === v.key);
      n.dataset.key = v.key; n.alt = ''; n.src = p ? p.url : imgSrc(v.key); if (p && p.h) n.style.height = p.h + 'px';
      return n;
    }
    static value(n) { return {key: n.dataset.key}; }
  }
  Pic.blotName = 'pic'; Pic.tagName = 'IMG'; Pic.className = 'pic'; Quill.register(Pic);
  $('d').remove();
  return new Quill('#ed', {theme: 'snow', modules: {toolbar: [
    [{font: [false, 'serif', 'typewriter', 'display', 'mono']}, {size: ['small', false, 'large', 'huge']}],
    ['bold', 'italic', 'underline', 'strike'], [{list: 'ordered'}, {list: 'bullet'}], ['blockquote', 'link', 'video'], ['clean']
  ]}});
})() : ($('ed').remove(), $('d').hidden = false, null);
// Any YouTube address (youtube.com/watch, youtu.be, /shorts/, /live/, with or without a ?t= start time) -> its embed address
function ytEmbed(s) {
  let u; try { u = new URL(s.trim()); } catch (x) { return null; }
  const host = u.hostname.replace(/^(www|m|music)\./, ''); let id = null;
  if (host === 'youtu.be') id = u.pathname.slice(1);
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') id = u.searchParams.get('v') || (u.pathname.match(/^\/(shorts|embed|live)\/([\w-]+)/) || [])[2];
  if (!/^[\w-]{11}$/.test(id || '')) return null;
  const t = u.searchParams.get('t') || u.searchParams.get('start') || '';
  const sec = (t.match(/\d+[hms]?/g) || []).reduce((a, p) => a + parseInt(p) * ({h: 3600, m: 60}[p.slice(-1)] || 1), 0);   // "90", "90s", "1m30s"
  return `https://www.youtube-nocookie.com/embed/${id}${sec ? '?start=' + sec : ''}`;
}
if (Q) Q.on('text-change', () => { if (draft) drawPins(); });   // e.g. you deleted a photo from the text with Backspace: update the photo buttons
if (Q) Q.root.addEventListener('paste', ev => {
  const url = ytEmbed(ev.clipboardData.getData('text/plain')); if (!url) return;   // not a YouTube link: paste normally
  ev.preventDefault(); ev.stopImmediatePropagation();
  let at = (Q.getSelection(true) || {index: Q.getLength() - 1}).index;
  const [line, off] = Q.getLine(at); if (line && off > 0) at = Q.getIndex(line) + line.length();   // mid-line: put the video after this line instead of splitting it
  Q.insertEmbed(at, 'video', url, 'user'); Q.setSelection(at + 1, 0, 'user');
}, true);
// put a post's text into the editor / read it back out (html = formatted version, text = plain copy kept alongside it)
function edSet(x) {
  const t = x ? (x.desc || x.body || '') : '';
  if (!Q) { $('d').value = t; return; }
  if (x && x.html) Q.clipboard.dangerouslyPasteHTML(x.html); else Q.setText(t);
  Q.history.clear();
}
// html = the editor's own HTML (Quill's getSemanticHTML() export turns spaces into &nbsp; and videos into plain links)
const edGet = () => Q ? {text: Q.getText().trim(), html: Q.getLength() > 1 ? Q.root.innerHTML : ''} : {text: $('d').value.trim(), html: ''};
/* --- EDIT PREVIEW CARD: a panel in the New/Edit window for how this experience looks as a card on the board.
       Tick parts and drag ⠿ to order them (saved as pvShow / pvOrder); drag the card's corner to size it (pvC columns × pvR rows).
       The card is drawn from what's in the form right now, at roughly the size it has on a computer screen. --- */
const PV_COL = 116, PV_MAXC = 5;   // a board column's width on a computer, and the widest card that fits in this window
const PV_LABEL = Object.fromEntries(PV_PARTS);
const formOrder = () => [...$('secs').children].map(x => x.dataset.sec);
function draftItem() {   // the post as currently typed into the form
  const ok = d => isNaN(d) ? new Date() : d, s = ok(new Date($('s').value)), e = ok(new Date($('e').value)), {text, html} = edGet();
  const pics = draft.imgs.map(im => ({key: im.key, src: im.url, h: im.h}));
  if (draft.kind === 'b') return {id: 'pv', kind: 'post', title: $('t').value.trim() || 'Untitled', created: (draft.old && draft.old.created) || new Date().toISOString(), body: text, html, pics, pvImg: draft.pv.img, pvImgH: draft.pv.imgH};
  return {id: 'pv', title: $('t').value.trim() || 'Untitled', start: s.toISOString(), end: e.toISOString(), minutes: Math.max(0, Math.round((e - s) / 6e4)),
    rating: draft.rating, types: draft.types, people: draft.people, places: draft.places, desc: text, html, pics: draft.imgs.map(im => ({key: im.key, src: im.url, h: im.h})), pvImg: draft.pv.img, pvImgH: draft.pv.imgH};
}
function pvMode(on) {
  $('secs').hidden = on; $('pvbtn').hidden = on; $('pvEd').hidden = !on;
  if (on) { drawPv(); $('modal').scrollTop = 0; }
}
function drawPv() {   // show/hide checkboxes, then the card
  const show = draft.pv.show;
  const list = draft.kind === 'b' ? [['title', 'Title'], ['time', 'Date'], ['desc', 'Body'], ['photos', 'Photos']] : PV_PARTS;   // blog posts have fewer parts
  $('pvParts').innerHTML = list.map(([k, l]) => `<label class="chk"><input type="checkbox" value="${k}"${show.includes(k) ? ' checked' : ''}> ${l}</label>`).join('');
  const pick = (draft.imgs.find(im => im.key === draft.pv.img) || draft.imgs[0] || {}).key;   // the card's photo: your pick, or the first
  $('pvPics').innerHTML = draft.imgs.length ? '<span class="mute">Photo on the card:</span>' + draft.imgs.map(im => `<img src="${esc(im.url)}" alt="" data-k="${esc(im.key)}" class="${im.key === pick ? 'on' : ''}" title="Show this photo on the card">`).join('') : '';
  drawPvCard();
}
function drawPvCard() {
  const it = draftItem();
  $('pvCard').innerHTML = cardFor(it)({...it, order: draft.pv.order || formOrder()}, draft.pv.show, true) + '<i class="pvh" title="Drag to resize"></i>';
  sizePvCard();
}
function sizePvCard() {   // set the card's width/height from pvC/pvR (or automatic) without redrawing what's inside it
  const {c = 2, r} = draft.pv, b = $('pvCard'), cd = b.querySelector('.card');
  b.style.setProperty('--pvh', (draft.pv.imgH || 120) + 'px');   // photos in the text match the card's photo size
  b.style.width = (c * PV_COL + (c - 1) * GAP) + 'px'; if (r) b.dataset.r = r; else delete b.dataset.r;   // data-r: same rule as the board (no 300px cap)
  cd.style.height = r ? (r * ROW - GAP) + 'px' : '';
  cd.classList.toggle('clip', cd.scrollHeight > cd.clientHeight + 2);
  $('pvSize').textContent = `${c} column${c > 1 ? 's' : ''} wide · ${r ? (r * ROW - GAP) + 'px tall' : 'automatic height'}`;
}
$('pvPics').addEventListener('click', ev => { const i = ev.target.closest('img'); if (!i) return; draft.pv.img = i.dataset.k; drawPv(); });
$('pvParts').addEventListener('change', () => { draft.pv.show = [...$('pvParts').querySelectorAll('input:checked')].map(x => x.value); drawPvCard(); });
// drag a part's ⠿ (on the card itself) up or down to move it. This only changes the card's order (pvOrder), never the full post's.
let pvPart = null;
$('pvCard').addEventListener('pointerdown', ev => {
  if (!ev.target.closest('.ppg')) return;
  ev.preventDefault(); pvPart = ev.target.closest('.pp'); pvPart.classList.add('dragging'); $('pvCard').setPointerCapture(ev.pointerId);
});
$('pvCard').addEventListener('pointermove', ev => {
  if (!pvPart) return;
  const box = pvPart.parentElement, next = [...box.querySelectorAll(':scope > .pp')].find(x => x !== pvPart && ev.clientY < x.getBoundingClientRect().top + x.offsetHeight / 2) || null;
  if (pvPart.nextElementSibling !== next) box.insertBefore(pvPart, next);
});
const pvPartEnd = () => {
  if (!pvPart) return;
  pvPart.classList.remove('dragging'); pvPart = null;
  // the parts you can see are in their new order; hidden ones keep their places in between
  const seen = [...$('pvCard').querySelectorAll('.pp')].map(x => x.dataset.k), full = draft.pv.order || formOrder();
  let i = 0; draft.pv.order = full.map(k => seen.includes(k) ? seen[i++] : k);
  drawPvCard();
};
$('pvCard').addEventListener('pointerup', pvPartEnd); $('pvCard').addEventListener('pointercancel', pvPartEnd);
// drag the card's bottom-right corner to size it: snaps to whole columns and 10px steps
let pvSz = null;
$('pvCard').addEventListener('pointerdown', ev => {
  if (!ev.target.closest('.pvh')) return;
  ev.preventDefault(); pvSz = {x: ev.clientX, y: ev.clientY, w: $('pvCard').offsetWidth, h: $('pvCard').querySelector('.card').offsetHeight};
  $('pvCard').classList.add('sizing'); $('pvCard').setPointerCapture(ev.pointerId);
});
$('pvCard').addEventListener('pointermove', ev => {
  if (!pvSz) return;
  draft.pv.c = Math.max(1, Math.min(PV_MAXC, Math.round((pvSz.w + ev.clientX - pvSz.x + GAP) / (PV_COL + GAP))));
  draft.pv.r = Math.max(5, Math.min(90, Math.round((pvSz.h + ev.clientY - pvSz.y + GAP) / ROW)));
  sizePvCard();
});
const pvSzEnd = () => { if (pvSz) $('pvCard').classList.remove('sizing'); pvSz = null; };
$('pvCard').addEventListener('pointerup', pvSzEnd); $('pvCard').addEventListener('pointercancel', pvSzEnd);
$('fi').addEventListener('change', async ev => {
  const files = [...ev.target.files];
  for (const f of files) {
    if (draft.imgs.length >= 6) { $('err').textContent = 'Up to 6 photos each.'; break; }
    try { const b = await shrink(f); draft.imgs.push({key: 'new-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), blob: b, url: URL.createObjectURL(b)}); }
    catch (x) { $('err').textContent = 'Could not read “' + f.name + '”.'; }
  }
  ev.target.value = ''; drawDraft();
});
async function save(asDraft) {
  TAG_KEYS.forEach(k => addTag(k));   // anything typed but not yet added becomes a tag
  const b = draft.kind === 'b', t = $('t').value.trim(), s = new Date($('s').value), e = new Date($('e').value), m = Math.round((e - s) / 6e4);
  const err = asDraft ? '' : !t ? 'Give it a title.' : !b && !(m > 0) ? 'End time must be after the start time.' : !b && !draft.rating ? 'Pick a star rating.' : '';
  if (err) { $('err').textContent = err; return; }
  $('go').disabled = $('sd').disabled = true; (asDraft ? $('sd') : $('go')).textContent = 'Saving…'; $('err').textContent = '';
  const fail = msg => { $('err').textContent = msg; btnReset(); };
  const images = [];
  const renamed = {};   // brand-new photos: temporary key -> real file name once uploaded
  try { for (const im of draft.imgs) { im.ref = im.ref || await upImg(im.blob); if (im.key !== im.ref) { renamed[im.key] = im.ref; im.key = im.ref; } images.push(im.ref); } }   // remember uploads, so saving again doesn't re-upload
  catch (x) { return fail('Photo upload failed: ' + x.message); }
  const art = {};   // poster / cover art file names
  try { for (const g in META) { art[g] = []; for (const im of draft.art[g]) { im.ref = im.ref || await upImg(im.blob); art[g].push(im.ref); } } }
  catch (x) { return fail('Image upload failed: ' + x.message); }
  // one experience's movie or music details, e.g. {year: ['1989'], director: ['Herbert Ross'], genre: [...], country: [...], poster: [file]}
  const metaOf = g => { const o = Object.fromEntries(META[g].fields.map(([f]) => [f, draft[g + '.' + f]])); o[META[g].art[0]] = art[g]; return Object.values(o).some(v => v.length) ? o : undefined; };
  if (Q) Q.root.querySelectorAll('img.pic').forEach(x => { if (renamed[x.dataset.key]) x.dataset.key = renamed[x.dataset.key]; });
  if (renamed[draft.pv.img]) draft.pv.img = renamed[draft.pv.img];
  const id = draft.editId || Date.now().toString(36) + Math.random().toString(36).slice(2, 6), {text: d} = edGet(), pub = $('pub').checked;
  // photos in the text are saved as just their key: the picture and its size come from the photo list when the post is shown
  const tidy = document.createElement('div'); tidy.innerHTML = edGet().html;
  tidy.querySelectorAll('img.pic').forEach(x => { x.removeAttribute('src'); x.removeAttribute('style'); });
  const html = tidy.innerHTML;
  const iso = x => isNaN(x) ? null : x.toISOString(), order = [...$('secs').children].map(x => x.dataset.sec), imgH = draft.imgs.map(im => im.h || null);
  // a draft is always private (it remembers your Public choice for later) and has no number; publishing gives it the next number
  const extra = asDraft ? {draft: true, is_public: false, wantPublic: pub, saved: new Date().toISOString()}
    : {is_public: pub, num: (draft.old && draft.old.num) || nextNum(b ? posts() : ents())};
  const o = b ? {kind: 'post', id, ...extra, title: t, body: d, html, images, imgH, order, created: draft.old && !wasDraft() ? draft.old.created : new Date().toISOString(),
      pvShow: draft.pv.show, pvOrder: draft.pv.order || undefined, pvC: draft.pv.c, pvR: draft.pv.r, pvImg: draft.pv.img, pvImgH: draft.pv.imgH}
    : {id, ...extra, title: t, desc: d, html, start: iso(s), end: iso(e), minutes: m || 0, rating: draft.rating, types: draft.types, people: draft.people, places: draft.places, images, imgH, order, movie: metaOf('movie'), music: metaOf('music'),
      pvShow: draft.pv.show, pvOrder: draft.pv.order || undefined, pvC: draft.pv.c, pvR: draft.pv.r, pvImg: draft.pv.img, pvImgH: draft.pv.imgH};   // the preview card's settings
  const ok = await put(o);
  if (!ok) return fail('Could not save. Are you still logged in?');
  const artOf = x => Object.keys(META).flatMap(g => (x && x[g] && x[g][META[g].art[0]]) || []), kept = [...images, ...artOf(o)];
  const gone = draft.old ? [...(draft.old.images || []), ...artOf(draft.old)].filter(i => !kept.includes(i)) : [];   // files you removed: delete them
  if (gone.length) await sb.storage.from('photos').remove(gone);
  if (asDraft) { draft.editId = id; draft.old = o; $('mh').textContent = 'New ' + (b ? 'post' : 'experience') + ' · draft'; btnReset(); drawDrafts(); flash('Draft saved'); return; }   // keep writing
  $('modal').hidden = true;
}

/* --- ADDRESSES: /strictlybusiness (the home page), /exp and /blog are the pages, /exp/3 or /blog/3 opens item number 3,
       /settings is tag colors and the intro. The bare address and the old /portfolio go to /strictlybusiness.
       Old links like /#e-ID or /#b-ID still work. route() reads the address bar; nav() changes it without reloading. --- */
function route() {
  const [p, n] = location.pathname.split('/').filter(Boolean), h = location.hash.slice(1);
  page = p === 'blog' ? 'blog' : p === 'exp' ? 'exp' : p === 'settings' ? 'set' : 'port'; focus = n || null;   // anything else: Strictly Business
  if (/^[eb]-/.test(h)) { page = h[0] === 'b' ? 'blog' : 'exp'; focus = h.slice(2); }
  else if (p !== 'strictlybusiness' && page === 'port') history.replaceState(null, '', '/strictlybusiness');
  render();
}
const nav = path => { history.pushState(null, '', path); route(); scrollTo(0, 0); };
async function copyLink(v) {
  const u = BASE + v;
  try { await navigator.clipboard.writeText(u); $('toast').textContent = 'Link copied: ' + u; } catch (e) { $('toast').textContent = u; }
  $('toast').hidden = false; setTimeout(() => $('toast').hidden = true, 6000);
}

/* --- CLICKS: one listener handles every button, based on its data-act label --- */
document.addEventListener('click', ev => {
  if (ev.target.closest('#pvCard')) return;   // the card in "Edit preview card" is look-only
  const b = ev.target.closest('[data-act]'); if (!b) return;
  const a = b.dataset.act, v = b.dataset.v, k = b.dataset.k, tog = set => set.has(key(v)) ? set.delete(key(v)) : set.add(key(v));   // filters store tag names in lowercase
  if (a === 'go') { if (ev.metaKey || ev.ctrlKey) return; ev.preventDefault(); nav('/' + v); }   // Cmd/Ctrl-click still opens a new tab
  else if (a === 'settings') nav('/settings');
  else if (a === 'open') openModal(page === 'blog' ? 'b' : 'e');
  else if (a === 'close') $('modal').hidden = true;
  else if (a === 'save') save();
  else if (a === 'expand') toggleCard(v);
  else if (a === 'ytplay') {   // swap the video's thumbnail for the real YouTube player, already playing
    const f = document.createElement('iframe');
    f.src = v + (v.includes('?') ? '&' : '?') + 'autoplay=1'; f.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen'; f.allowFullScreen = true;
    b.replaceWith(f);
  }
  else if (a === 'pvedit') pvMode(true);
  else if (a === 'pvback') pvMode(false);
  else if (a === 'pvauto') { draft.pv.c = draft.pv.r = undefined; sizePvCard(); }
  else if (a === 'savedraft') save(true);
  else if (a === 'loaddraft') { const x = all.find(y => y.id === v); if (x) openModal(x.kind === 'post' ? 'b' : 'e', x); $('drf').open = true; }
  else if (a === 'flt') { tog(sel[k]); render(); }
  else if (a === 'tagflt') {   // tag on an entry: filter by it, or clear that filter if it's already on
    tog(sel[k]); const on = sel[k].has(key(v)); if (on) fsOpen(true);
    if (focus) nav('/exp'); else { render(); if (on) scrollTo(0, 0); }
  }
  else if (a === 'pick') { $('i-' + k).value = v; addTag(k); suggest(k); }   // clicked a tag suggestion
  else if (a === 'rmArt') { draft.art[k].splice(+v, 1); drawMeta(); }
  else if (a === 'rmTag') { draft[k] = draft[k].filter(n => n !== v); drawDraft(); }
  else if (a === 'rmI') { removePic(draft.imgs[+v].key); draft.imgs.splice(+v, 1); drawDraft(); }   // also takes it out of the text
  else if (a === 'pin') pinToggle(+v);
  else if (a === 'sortBy') { sortBy = v; render(); }
  else if (a === 'saveintro') saveSettings({introTitle: $('sIntroT').value.trim() || undefined, intro: $('sIntro').value.trim() || undefined}).then(ok => ok && flash('Intro saved'));
  else if (a === 'resetintro') saveSettings({introTitle: undefined, intro: undefined}).then(ok => ok && flash('Intro reset to the original'));
  else if (a === 'intro') { introHidden = !introHidden; drawIntro(); }
  else if (a === 'sortDir') { sortDir = sortDir === 'desc' ? 'asc' : 'desc'; render(); }
  else if (a === 'edit') { const x = all.find(y => y.id === v); if (x) openModal(x.kind === 'post' ? 'b' : 'e', x); }
  else if (a === 'link') copyLink(v);
  else if (a === 'unfocus') nav('/' + page);
  else if (a === 'lock') { if (owner) { sb.auth.signOut(); nav('/exp'); } else { $('login').hidden = false; $('lemail').focus(); } }
  else if (a === 'dologin') doLogin();
  else if (a === 'closelogin') $('login').hidden = true;
  else if (a === 'resetc') setColor(k, v, null);
  else if (a === 'del') {
    if (b.dataset.arm) del(v).then(() => { if (draft && draft.editId === v && !$('modal').hidden) openModal(draft.kind); });   // deleted the draft that's open: start fresh
    else { b.dataset.arm = 1; b.classList.add('arm'); b.title = 'Tap again to delete'; flash('Tap the trash icon again to delete');
      setTimeout(() => { delete b.dataset.arm; b.classList.remove('arm'); b.title = 'Delete'; }, 3000); }
  }
});
// tag boxes: Enter (or a comma) adds what you typed; ↑/↓ pick a suggestion first; Esc hides suggestions
$('secs').addEventListener('keydown', ev => {
  const k = ev.target.dataset.k; if (!k) return;
  const box = $('s-' + k), opts = box.hidden ? [] : [...box.querySelectorAll('.sg')], i = opts.findIndex(o => o.classList.contains('hi'));
  if ((ev.key === 'ArrowDown' || ev.key === 'ArrowUp') && opts.length) {
    ev.preventDefault(); opts.forEach(o => o.classList.remove('hi'));
    opts[(i + (ev.key === 'ArrowDown' ? 1 : opts.length - 1 + (i < 0 ? 1 : 0))) % opts.length].classList.add('hi');
  }
  else if (ev.key === 'Enter' || ev.key === ',') { ev.preventDefault(); if (i >= 0) ev.target.value = opts[i].dataset.v; addTag(k); suggest(k); }
  else if (ev.key === 'Escape') box.hidden = true;
});
$('secs').addEventListener('input', ev => { if (ev.target.dataset.k) suggest(ev.target.dataset.k); });
$('secs').addEventListener('mousedown', ev => { if (ev.target.closest('.sug')) ev.preventDefault(); });   // clicking a suggestion keeps you typing in the box
$('secs').addEventListener('focusout', ev => { if (ev.target.dataset.k) $('s-' + ev.target.dataset.k).hidden = true; });
$('s').addEventListener('input', updExp); $('e').addEventListener('input', updExp);
// color pickers in Settings: preview live while dragging, save when the picker closes
$('pgSet').addEventListener('input', ev => { if (ev.target.type === 'color') { const c = ev.target.previousElementSibling; c.style.background = ev.target.value; c.style.color = ink(ev.target.value); } });
$('pgSet').addEventListener('change', ev => { if (ev.target.type === 'color') setColor(ev.target.dataset.k, ev.target.dataset.v, ev.target.value); });
window.addEventListener('popstate', route);     // browser Back/Forward buttons
window.addEventListener('hashchange', route);
$('lpass').addEventListener('keydown', ev => { if (ev.key === 'Enter') doLogin(); });
route(); init();
