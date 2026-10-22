/* ===== BRAINS (JavaScript) =====
   "all" holds everything you have saved: experiences, blog posts, and one "settings" item (tag colors).
   Experiences have no "kind"; blog posts have kind "post". render() redraws the screen whenever something changes. */
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// Copied links start with your site's address, e.g. https://jawansb.com
const BASE = location.origin;
// The three tag categories, in the order they appear everywhere: [storage name, label, placeholder]
const KINDS = [['types', 'Type', 'Add type'], ['people', 'People', 'Add person'], ['places', 'Location', 'Add place']];
const sel = {types: new Set(), people: new Set(), places: new Set()};
let all = [], loaded = false, assets = true, page = 'exp', focus = null, sortBy = 'date', sortDir = 'desc', draft = null;
const ents = () => all.filter(x => !x.kind), posts = () => all.filter(x => x.kind === 'post');
const colors = () => (all.find(x => x.id === 'settings') || {}).colors || {};
const tagsOf = (e, k) => k === 'types' ? (e.types || (e.type ? [e.type] : [])) : (e[k] || []);

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
const tcol = (k, n) => colors()[k + ':' + n] || auto(k + n);
const ts = (k, n) => { const b = tcol(k, n); return `background:${b};color:${ink(b)}`; };
const chip = (k, n) => `<span class="chip" style="${ts(k, n)}">${esc(n)}</span>`;

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
  all = data.map(toDoc); loaded = true; render();
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
const imgSrc = s => s.startsWith('data:') || s.startsWith('http') || !sb ? s : sb.storage.from('photos').getPublicUrl(s).data.publicUrl;
const cmp = (a, b) => {
  const k = {date: e => e.start, exp: e => e.minutes, rating: e => e.rating}[sortBy], x = k(a), y = k(b);
  const c = typeof x === 'string' ? x.localeCompare(y) : x - y;
  return (sortDir === 'asc' ? c : -c) || b.start.localeCompare(a.start);
};
const dirBtn = () => {
  const d = sortDir === 'desc', ar = d ? '<path d="M3 16l3 3 3-3"/>' : '<path d="M3 8l3-3 3 3"/>', bars = d ? 'M12 6h9M12 12h6M12 18h3' : 'M12 6h3M12 12h6M12 18h9';
  return `<button class="tag ico" data-act="sortDir" aria-label="${d ? 'Descending' : 'Ascending'}, tap to reverse" title="${d ? 'Descending' : 'Ascending'}: tap to reverse"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 5v14"/>${ar}<path d="${bars}"/></svg></button>`;
};

/* --- DRAWING THE SCREEN --- */
const gal = e => (e.images || []).length ? `<div class="gal">${e.images.map(i => `<img class="th" data-act="zoom" loading="lazy" alt="" src="${esc(imgSrc(i))}">`).join('')}</div>` : '';
const acts = (p, x) => (owner ? `<button class="link" data-act="edit" data-v="${x.id}" style="margin-right:12px">Edit</button><button class="link" data-act="del" data-v="${x.id}" style="margin-right:12px">Delete</button>` : '') + (owner && !x.is_public ? '<span class="pill" style="margin-right:12px">Private</span>' : '') + `<button class="link" data-act="link" data-v="/${p}${x.num ? '/' + x.num : ''}">Copy link</button>`;
const card = e => {
  const s = new Date(e.start), en = new Date(e.end), tm = x => x.toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'});
  return `<div class="card entry" id="e-${e.id}"><div class="top"><span>${s.toLocaleDateString([], {weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'})} · ${tm(s)}–${tm(en)}</span><span>${dur(e.minutes)} · +${e.minutes} EXP</span></div>
  <h4>${esc(e.title)}</h4>${stars(e.rating)}${e.desc ? `<p>${esc(e.desc)}</p>` : ''}${gal(e)}
  <div style="margin-top:6px">${KINDS.map(([k]) => tagsOf(e, k).map(n => chip(k, n)).join('')).join('')}</div>${acts('exp', e)}</div>`;
};
const bcard = p => `<div class="card entry" id="b-${p.id}"><div class="top"><span>${new Date(p.created).toLocaleString([], {dateStyle: 'medium', timeStyle: 'short'})}</span></div>
  <h4>${esc(p.title)}</h4>${p.body ? `<p>${esc(p.body)}</p>` : ''}${gal(p)}${acts('blog', p)}</div>`;

function render() {
  const E = ents(), filtered = KINDS.some(([k]) => sel[k].size);
  const f = E.filter(e => KINDS.every(([k]) => !sel[k].size || tagsOf(e, k).some(t => sel[k].has(t)))).sort(cmp), sh = agg(f);
  // page switching + theme
  document.documentElement.dataset.page = page === 'blog' ? 'blog' : 'exp';
  $('pgExp').hidden = page !== 'exp'; $('pgBlog').hidden = page !== 'blog'; $('pgSet').hidden = page !== 'set';
  $('fab').hidden = page === 'set' || !owner; $('gear').hidden = !owner; $('status').hidden = !owner; $('status').textContent = 'Owner mode'; $('lock').textContent = owner ? 'Log out' : 'Owner login'; $('fab').textContent = page === 'blog' ? '+ Blog' : '+ Log';
  $('nvE').classList.toggle('cur', page !== 'blog'); $('nvB').classList.toggle('cur', page === 'blog');
  // top cards show the filtered numbers while a filter is on
  $('totExp').textContent = sh.exp.toLocaleString(); $('totQ').textContent = sh.n ? sh.qol.toFixed(2) : '—'; $('totN').textContent = sh.n;
  $('lblExp').textContent = filtered ? 'FILTERED EXP' : 'TOTAL EXP'; $('lblQ').textContent = filtered ? 'FILTERED QoL' : 'QUALITY OF LIFE'; $('lblN').textContent = filtered ? 'MATCHING' : 'EXPERIENCES';
  $('statsBox').classList.toggle('hot', filtered);
  $('fcount').textContent = filtered ? ' · ' + KINDS.reduce((n, [k]) => n + sel[k].size, 0) + ' active' : '';
  $('fsum').innerHTML = filtered ? `Viewing ${KINDS.flatMap(([k]) => [...sel[k]]).map(esc).join(' + ')} · ${f.length} of ${E.length} experiences <button class="link" data-act="clear">Clear filters</button>` : '';
  // filter buttons, colored like their tags, with each tag's own EXP and QoL
  const rows = ([k, l]) => {
    const m = {}; E.forEach(e => tagsOf(e, k).forEach(n => (m[n] = m[n] || []).push(e)));
    const r = Object.entries(m).map(([n, v]) => [n, agg(v)]).sort((a, b) => b[1].exp - a[1].exp)
      .map(([n, a]) => `<button class="tag ${sel[k].has(n) ? 'on' : ''}" style="${ts(k, n)};border-color:transparent" data-act="flt" data-k="${k}" data-v="${esc(n)}"><b>${esc(n)}</b><span>${a.exp} EXP · ${a.qol.toFixed(2)} QoL</span></button>`).join('');
    return `<h3>${l.toUpperCase()} FILTER</h3><div class="tl">${r || '<span class="mute">Nothing yet.</span>'}</div>`;
  };
  const opt = (v, l) => `<button class="tag ${sortBy === v ? 'on' : ''}" data-act="sortBy" data-v="${v}">${l}</button>`;
  $('tags').innerHTML = KINDS.map(rows).join('') + `<h3>SORT BY</h3><div class="tl">${opt('date', 'Date')}${opt('exp', 'EXP')}${opt('rating', 'Rating')}<span style="width:14px"></span>${dirBtn()}</div>`;
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
  $('journal').innerHTML = (page === 'exp' ? back('experience') : '') + (one('exp', f).map(card).join('') || none('experience', `<p class="mute">Nothing here yet.${owner ? ' Tap “+ Log” to record an experience.' : ''}</p>`));
  const P = posts().sort((a, b) => b.created.localeCompare(a.created));
  $('blog').innerHTML = (page === 'blog' ? back('post') : '') + (one('blog', P).map(bcard).join('') || none('post', `<p class="mute">No posts yet.${owner ? ' Tap “+ Blog” to write one.' : ''}</p>`));
  if (page === 'set') renderSet();
}
function renderSet() {
  const E = ents();
  $('pgSet').innerHTML = `<button class="link" data-act="go" data-v="exp">← Back</button><h2>Edit tags</h2><p class="mute">Pick a color for each tag. The text color is chosen automatically so it stays readable.</p>` +
    KINDS.map(([k, l]) => { const names = [...new Set(E.flatMap(e => tagsOf(e, k)))].sort();
      return `<h3>${l.toUpperCase()}</h3>` + (names.map(n => `<div class="srow"><span class="chip" style="${ts(k, n)}">${esc(n)}</span><input type="color" value="${tcol(k, n)}" data-k="${k}" data-v="${esc(n)}"><button class="link" data-act="resetc" data-k="${k}" data-v="${esc(n)}">Reset</button></div>`).join('') || '<p class="mute">No tags yet.</p>'); }).join('');
}
async function setColor(k, n, v) { const c = {...colors()}; if (v) c[k + ':' + n] = v; else delete c[k + ':' + n]; await put({id: 'settings', kind: 'settings', colors: c}); }

/* --- THE LOG / BLOG FORM (one form, two modes: "e" = experience, "b" = blog post) --- */
const loc = d => new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 16);
const goLabel = () => draft.editId ? 'SAVE CHANGES' : draft.kind === 'b' ? 'POST' : 'LOG';
// Type gets its own line; People and Location share one line. Press Enter after typing a tag.
const tfBlock = ([k, l, ph]) => `<div><label>${l}</label><div id="c-${k}"></div><input id="i-${k}" data-k="${k}" list="l-${k}" placeholder="${ph} ⏎"><datalist id="l-${k}"></datalist></div>`;
$('tf').innerHTML = tfBlock(KINDS[0]) + `<div class="two">${tfBlock(KINDS[1])}${tfBlock(KINDS[2])}</div>`;
function drawDraft() {
  KINDS.forEach(([k]) => $('c-' + k).innerHTML = draft[k].map(n => `<span class="chip" style="${ts(k, n)}">${esc(n)}<button class="x" data-act="rmTag" data-k="${k}" data-v="${esc(n)}">✕</button></span>`).join(''));
  $('pick').innerHTML = stars(draft.rating); $('rv').textContent = draft.rating ? draft.rating + ' / 5' : '';
  $('ph').innerHTML = draft.imgs.map((im, i) => `<span class="pv"><img class="th" src="${im.url}" alt=""><button data-act="rmI" data-v="${i}">✕</button></span>`).join('');
}
function updExp() { const m = Math.round((new Date($('e').value) - new Date($('s').value)) / 6e4); $('exp').textContent = m > 0 ? '+' + m + ' EXP' : ''; }
function addTag(k) {
  const el = $('i-' + k), v = el.value.trim().replace(/,$/, '').trim(); el.value = '';
  if (!v) return;
  const known = [...new Set(ents().flatMap(e => tagsOf(e, k)))], c = known.find(x => x.toLowerCase() === v.toLowerCase()) || v;
  if (!draft[k].includes(c)) draft[k].push(c);
  drawDraft();
}
function openModal(kind, old) {
  draft = {kind, rating: 0, types: [], people: [], places: [], imgs: []};
  if (old) draft = {...draft, rating: old.rating || 0, imgs: (old.images || []).map(r => ({ref: r, url: imgSrc(r)})), editId: old.id, old, ...Object.fromEntries(KINDS.map(([k]) => [k, [...tagsOf(old, k)]]))};
  const now = new Date();
  $('s').value = loc(old && old.start ? new Date(old.start) : new Date(now - 36e5)); $('e').value = loc(old && old.end ? new Date(old.end) : now);
  $('t').value = old ? old.title : ''; $('d').value = old ? (old.desc || old.body || '') : ''; $('fi').value = '';
  document.querySelectorAll('.xe').forEach(x => x.hidden = kind === 'b');
  $('mh').textContent = (old ? 'Edit ' : 'New ') + (kind === 'b' ? 'post' : 'experience');
  $('dl').textContent = kind === 'b' ? 'Body' : 'Description';
  KINDS.forEach(([k]) => $('l-' + k).innerHTML = [...new Set(ents().flatMap(e => tagsOf(e, k)))].map(n => `<option value="${esc(n)}">`).join(''));
  $('pub').checked = old ? !!old.is_public : false;
  $('go').disabled = false; $('go').textContent = goLabel(); $('err').textContent = '';
  drawDraft(); updExp(); $('modal').hidden = false; $('s').focus();
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
$('fi').addEventListener('change', async ev => {
  const files = [...ev.target.files];
  for (const f of files) {
    if (draft.imgs.length >= 6) { $('err').textContent = 'Up to 6 photos each.'; break; }
    try { const b = await shrink(f); draft.imgs.push({blob: b, url: URL.createObjectURL(b)}); }
    catch (x) { $('err').textContent = 'Could not read “' + f.name + '”.'; }
  }
  ev.target.value = ''; drawDraft();
});
async function save() {
  KINDS.forEach(([k]) => addTag(k));
  const b = draft.kind === 'b', t = $('t').value.trim(), s = new Date($('s').value), e = new Date($('e').value), m = Math.round((e - s) / 6e4);
  const err = !t ? 'Give it a title.' : !b && !(m > 0) ? 'End time must be after the start time.' : !b && !draft.rating ? 'Pick a star rating.' : '';
  if (err) { $('err').textContent = err; return; }
  $('go').disabled = true; $('go').textContent = 'Saving…';
  const fail = msg => { $('err').textContent = msg; $('go').disabled = false; $('go').textContent = goLabel(); };
  const images = [];
  try { for (const im of draft.imgs) images.push(im.ref || await upImg(im.blob)); }
  catch (x) { return fail('Photo upload failed: ' + x.message); }
  const id = draft.editId || Date.now().toString(36) + Math.random().toString(36).slice(2, 6), d = $('d').value.trim(), is_public = $('pub').checked;
  const num = (draft.old && draft.old.num) || nextNum(b ? posts() : ents());
  const ok = await put(b ? {kind: 'post', id, num, is_public, title: t, body: d, images, created: draft.old ? draft.old.created : new Date().toISOString()}
    : {id, num, is_public, title: t, desc: d, start: s.toISOString(), end: e.toISOString(), minutes: m, rating: draft.rating, types: draft.types, people: draft.people, places: draft.places, images});
  if (!ok) return fail('Could not save. Are you still logged in?');
  const gone = draft.old ? (draft.old.images || []).filter(i => !images.includes(i)) : [];
  if (gone.length) await sb.storage.from('photos').remove(gone);
  $('modal').hidden = true;
}

/* --- ADDRESSES: /exp and /blog are the two pages, /exp/3 or /blog/3 opens item number 3, /settings is tag colors.
       Old links like /#e-ID or /#b-ID still work. route() reads the address bar; nav() changes it without reloading. --- */
function route() {
  const [p, n] = location.pathname.split('/').filter(Boolean), h = location.hash.slice(1);
  page = p === 'blog' ? 'blog' : p === 'settings' ? 'set' : 'exp'; focus = n || null;
  if (/^[eb]-/.test(h)) { page = h[0] === 'b' ? 'blog' : 'exp'; focus = h.slice(2); }
  else if (!p) history.replaceState(null, '', '/exp');
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
  const pk = ev.target.closest('.pk .st');
  if (pk) { const r = pk.getBoundingClientRect(); draft.rating = +pk.dataset.i - 1 + (ev.clientX - r.left < r.width / 2 ? 0.5 : 1); drawDraft(); return; }
  const b = ev.target.closest('[data-act]'); if (!b) return;
  const a = b.dataset.act, v = b.dataset.v, k = b.dataset.k, tog = (set) => set.has(v) ? set.delete(v) : set.add(v);
  if (a === 'go') { if (ev.metaKey || ev.ctrlKey) return; ev.preventDefault(); nav('/' + v); }   // Cmd/Ctrl-click still opens a new tab
  else if (a === 'settings') nav('/settings');
  else if (a === 'open') openModal(page === 'blog' ? 'b' : 'e');
  else if (a === 'close') $('modal').hidden = true;
  else if (a === 'save') save();
  else if (a === 'flt') { tog(sel[k]); render(); }
  else if (a === 'clear') { KINDS.forEach(([x]) => sel[x].clear()); render(); }
  else if (a === 'rmTag') { draft[k] = draft[k].filter(n => n !== v); drawDraft(); }
  else if (a === 'rmI') { draft.imgs.splice(+v, 1); drawDraft(); }
  else if (a === 'zoom') { $('lb').querySelector('img').src = b.src; $('lb').hidden = false; }
  else if (a === 'unzoom') $('lb').hidden = true;
  else if (a === 'sortBy') { sortBy = v; render(); }
  else if (a === 'sortDir') { sortDir = sortDir === 'desc' ? 'asc' : 'desc'; render(); }
  else if (a === 'edit') { const x = all.find(y => y.id === v); if (x) openModal(x.kind === 'post' ? 'b' : 'e', x); }
  else if (a === 'link') copyLink(v);
  else if (a === 'unfocus') nav('/' + page);
  else if (a === 'lock') { if (owner) { sb.auth.signOut(); nav('/exp'); } else { $('login').hidden = false; $('lemail').focus(); } }
  else if (a === 'dologin') doLogin();
  else if (a === 'closelogin') $('login').hidden = true;
  else if (a === 'resetc') setColor(k, v, null);
  else if (a === 'del') {
    if (b.dataset.arm) del(v);
    else { b.dataset.arm = 1; b.textContent = 'Tap again to confirm'; setTimeout(() => { delete b.dataset.arm; b.textContent = 'Delete'; }, 3000); }
  }
});
$('tf').addEventListener('keydown', ev => { if (ev.target.dataset.k && (ev.key === 'Enter' || ev.key === ',')) { ev.preventDefault(); addTag(ev.target.dataset.k); } });
$('s').addEventListener('input', updExp); $('e').addEventListener('input', updExp);
// color pickers in Settings: preview live while dragging, save when the picker closes
$('pgSet').addEventListener('input', ev => { if (ev.target.type === 'color') { const c = ev.target.previousElementSibling; c.style.background = ev.target.value; c.style.color = ink(ev.target.value); } });
$('pgSet').addEventListener('change', ev => { if (ev.target.type === 'color') setColor(ev.target.dataset.k, ev.target.dataset.v, ev.target.value); });
window.addEventListener('popstate', route);     // browser Back/Forward buttons
window.addEventListener('hashchange', route);
$('lpass').addEventListener('keydown', ev => { if (ev.key === 'Enter') doLogin(); });
route(); init();
