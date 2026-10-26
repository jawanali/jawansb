/* THE NEWSLETTER: "Your Weekly Dose of Jawan".
   /newsletter        the signup page (anyone). The email goes to Resend via /api/subscribe; they get a "click to confirm" email.
   /newsletter/write  the composer (you only): intro blurb, a featured EXP / blog post, then every new public EXP and blog post
                      since the last issue, drawn as preview cards. "Schedule" hands the finished email to Resend, which sends it.
   Each issue is saved in Supabase as a private item (kind "issue"): its number, intro, feature, send time, and whether it's scheduled.
   This file loads before app.js and only defines things; app.js calls renderNews() and drawNlBar() from render(). */

const NL_SITE = 'https://jawansb.com', OWNER_EMAIL = 'jawanali@gmail.com';   // tests go to OWNER_EMAIL
const NL_C = {bg: '#313E50', card: '#3a435e', ink: '#cae2ff', mute: '#8d9aab', line: '#4a5573', star: '#2DD881', off: '#5f6b85'};   // the EXP page's colors, spelled out for email
const NL_SERIF = "Georgia,'Times New Roman',serif", NL_SANS = 'Arial,Helvetica,sans-serif';
const NL_FONTS = {serif: NL_SERIF, typewriter: "'Special Elite','Courier New',monospace", display: "'Playfair Display',Georgia,serif", mono: 'Menlo,Consolas,monospace'};
const NL_SIZES = {small: '13px', large: '20px', huge: '28px'};
const NL_SEND_HOUR = 9;   // issues go out Monday at 9:00 in the morning (your time) unless you pick another time
const NL_BLOG_PARTS = [['title', 'Title'], ['time', 'Date'], ['desc', 'Body'], ['photos', 'Photos']];

const issues = () => all.filter(x => x.kind === 'issue').sort((a, b) => a.num - b.num);
const isSent = i => i.status === 'scheduled' && new Date(i.sendAt) <= Date.now();
const curIssue = () => issues().find(i => !isSent(i)) || null;   // the one you're working on (a draft, or scheduled and not out yet)
const loggedAt = x => x.kind === 'post' ? x.created : (x.logged || x.start);   // when it went up (older EXPs: when it happened)
const itemUrl = x => NL_SITE + (x.kind === 'post' ? '/blog/' : '/exp/') + x.num;
function nextMonday() {
  const d = new Date(), days = (8 - d.getDay()) % 7;
  d.setDate(d.getDate() + (days === 0 && d.getHours() >= NL_SEND_HOUR ? 7 : days)); d.setHours(NL_SEND_HOUR, 0, 0, 0);
  return d;
}
// what an issue covers: from the previous issue (or a week back, for the first one) until it was scheduled (or now, while you're writing)
function nlWindow(iss) {
  const prev = issues().filter(i => i.num < iss.num).pop();
  const from = prev ? new Date(prev.until || prev.sendAt) : new Date(Date.now() - 7 * 864e5);
  const until = iss.status === 'scheduled' && iss.until ? new Date(iss.until) : new Date();
  const fresh = l => l.filter(x => x.is_public && x.num && new Date(loggedAt(x)) >= from && new Date(loggedAt(x)) < until).sort((a, b) => loggedAt(a).localeCompare(loggedAt(b)));
  return {from, until, exps: fresh(ents()), blogs: fresh(posts())};
}

/* --- THE EMAIL. Email programs ignore most modern page styling, so everything is written out by hand on each tag
       (inline styles), cards are simple boxes, and videos become a thumbnail linking to YouTube. --- */
const nlShort = t => { t = (t || '').replace(/\s+/g, ' ').trim(); return t.length > 220 ? t.slice(0, 220).replace(/\s+\S*$/, '') + '…' : t; };
const nlPlain = h => { const d = document.createElement('div'); d.innerHTML = DOMPurify.sanitize(h || ''); return d.textContent; };
function nlRich(h, x, fg) {   // formatted text from the editor, made email-safe
  if (!h || !window.DOMPurify) return '';
  const f = DOMPurify.sanitize(h, {ADD_TAGS: ['iframe'], RETURN_DOM_FRAGMENT: true}), pics = x ? picsOf(x) : [];
  f.querySelectorAll('iframe').forEach(n => {
    const id = ((n.getAttribute('src') || '').match(/embed\/([\w-]{11})/) || [])[1], w = document.createElement('div');
    if (id) w.innerHTML = `<a href="https://www.youtube.com/watch?v=${id}"><img src="https://i.ytimg.com/vi/${id}/hqdefault.jpg" alt="Watch on YouTube" width="100%" style="display:block;width:100%;height:auto;border:0;margin:8px 0"></a>`;
    n.replaceWith(...w.childNodes);
  });
  f.querySelectorAll('img.pic').forEach(n => { const p = pics.find(q => q.key === n.dataset.key); if (!p) { n.remove(); return; } n.src = p.src; n.removeAttribute('class'); n.setAttribute('width', '100%'); n.style.cssText = 'display:block;width:100%;height:auto;margin:8px 0'; });
  // Quill writes bullet lists as <ol data-list="bullet">: turn those into real bullet lists
  f.querySelectorAll('ol').forEach(o => { if (o.querySelector('li[data-list="bullet"]')) { const u = document.createElement('ul'); u.append(...o.childNodes); o.replaceWith(u); } });
  f.querySelectorAll('*').forEach(n => {
    const s = n.style, cls = n.getAttribute('class') || '';
    (cls.match(/ql-font-(\w+)/) || [])[1] && (s.fontFamily = NL_FONTS[cls.match(/ql-font-(\w+)/)[1]] || '');
    (cls.match(/ql-size-(\w+)/) || [])[1] && (s.fontSize = NL_SIZES[cls.match(/ql-size-(\w+)/)[1]] || '');
    n.removeAttribute('class');
    if (n.tagName === 'P') s.margin = '0';
    if (n.tagName === 'A') { s.color = fg; s.textDecoration = 'underline'; }
    if (n.tagName === 'BLOCKQUOTE') s.cssText += `;margin:6px 0;padding-left:12px;border-left:3px solid ${fg}`;
    if (n.tagName === 'UL' || n.tagName === 'OL') s.cssText += ';margin:6px 0;padding-left:22px';
  });
  const d = document.createElement('div'); d.appendChild(f); return d.innerHTML;
}
const nlChip = (k, n) => { const b = tcol(k, n); return `<span style="display:inline-block;background:${b};color:${ink(b)};font:12px/1.4 ${NL_SANS};padding:2px 7px;margin:0 4px 4px 0">${esc(n)}</span>`; };
const nlStars = (r, mute) => `<span style="color:${NL_C.star};letter-spacing:2px">${'★'.repeat(Math.floor(r))}${r % 1 ? '½' : ''}</span><span style="color:${mute};letter-spacing:2px">${'★'.repeat(5 - Math.ceil(r))}</span>`;
/* one card. show = which parts, order = their order (both from the card's own preview settings unless the feature sets them),
   full = the whole description with its formatting (the feature can have that); otherwise a short plain-text taste of it */
function nlCard(x, o = {}) {
  const ent = !x.kind, tbg = ent ? tintBg(x) : null, bg = tbg || NL_C.card, fg = tbg ? ink(tbg) : NL_C.ink, mute = tbg ? blend(bg, fg, .72) : NL_C.mute, url = itemUrl(x);
  const show = o.show || x.pvShow || PV_DEFAULT, order = o.order || x.pvOrder || orderOf(x), full = !!o.full;
  const small = `font:13px/1.5 ${NL_SANS};color:${mute};margin:0 0 6px`;
  const pic = (() => { const l = picsOf(x), p = l.find(q => q.key === (o.img || x.pvImg)) || l[0]; return p ? `<img src="${esc(p.src)}" alt="" width="100%" style="display:block;width:100%;height:auto;border:0;margin:6px 0">` : ''; })();
  const tags = (k, w) => tagsOf(x, k).length ? `<span style="color:${mute}">${w}</span> ${tagsOf(x, k).map(n => esc(canon(k, n))).join(', ')} ` : '';
  const s = new Date(ent ? x.start : x.created);
  const parts = {
    title: `<div style="font:20px/1.25 ${NL_SERIF};margin:0 0 6px">${full ? `<a href="${url}" style="color:${fg};text-decoration:none">${esc(x.title)}</a>` : esc(x.title)}</div>`,
    time: `<div style="${small}">${s.toLocaleDateString('en-US', {weekday: 'short', month: 'short', day: 'numeric'})}${ent ? ` · ${dur(x.minutes)} · +${x.minutes} EXP` : ''}</div>`,
    type: ent && tagsOf(x, 'types').length ? `<div style="margin:0 0 4px">${tagsOf(x, 'types').map(n => nlChip('types', canon('types', n))).join('')}</div>` : '',
    tags: ent && (tags('people', 'with') + tags('places', 'at')) ? `<div style="font:13px/1.5 ${NL_SANS};margin:0 0 6px">${tags('people', 'with')}${tags('places', 'at')}</div>` : '',
    rating: ent ? `<div style="font-size:17px;margin:0 0 6px">${nlStars(x.rating, mute)}</div>` : '',
    desc: full ? (() => { const r = nlRich(x.html, x, fg) || esc(x.desc || x.body || ''); return r ? `<div style="font:16px/1.55 ${NL_SERIF};margin:0 0 8px">${r}</div>` : ''; })()
      : (() => { const t = nlShort(x.desc || x.body || nlPlain(x.html)); return t ? `<div style="font:15px/1.5 ${NL_SERIF};margin:0 0 6px">${esc(t)}</div>` : ''; })(),
    photos: pic
  };
  const inner = order.filter(k => show.includes(k) && parts[k]).map(k => parts[k]).join('');
  const box = `background:${bg};color:${fg};border:1px solid ${NL_C.line};padding:14px 16px`;
  // a preview card is one big link to the post; the full feature has its own links inside, so it gets a "read it" link instead
  return full ? `<div style="${box}">${inner}<div style="font:13px ${NL_SANS};margin-top:8px"><a href="${url}" style="color:${fg}">Read it on jawansb.com →</a></div></div>`
    : `<a href="${url}" style="display:block;text-decoration:none;color:${fg};${box}">${inner}</a>`;
}
// preview cards two to a row (one to a row on phones), like a small version of the board
const nlGrid = l => `<div style="font-size:0;line-height:0">${l.map((x, i) => `<div class="nlcol" style="display:inline-block;vertical-align:top;width:100%;max-width:280px;margin:0 ${i % 2 ? 0 : 8}px 10px 0;font-size:16px;line-height:1.45;text-align:left">${nlCard(x)}</div>`).join('')}</div>`;
const nlH = (t, sub) => `<div style="margin:30px 0 12px;border-top:1px solid ${NL_C.line};padding-top:18px"><div style="font:24px/1.25 ${NL_SERIF}">${t}</div>${sub ? `<div style="font:13px ${NL_SANS};color:${NL_C.mute};margin-top:4px">${sub}</div>` : ''}</div>`;
const nlSubject = iss => `Your Weekly Dose of Jawan - Issue ${iss.num}`;
function buildEmail(iss) {
  const w = nlWindow(iss), feat = iss.feat && all.find(x => x.id === iss.feat.id), n = w.exps.length, sum = sumMin(w.exps);
  const exps = w.exps.filter(x => !feat || x.id !== feat.id), blogs = w.blogs.filter(x => !feat || x.id !== feat.id);
  const when = new Date(iss.sendAt).toLocaleDateString('en-US', {weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'});
  const intro = nlRich(iss.intro, null, NL_C.ink);
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>${esc(nlSubject(iss))}</title>
<style>@media (max-width:620px){.nlcol{max-width:100%!important;margin-right:0!important}}</style></head>
<body style="margin:0;padding:0;background:${NL_C.bg}">
<div style="display:none;max-height:0;overflow:hidden">${esc(nlShort(nlPlain(iss.intro)) || `Jawan experienced ${n} thing${n === 1 ? '' : 's'} this week.`)}</div>
<div style="background:${NL_C.bg};padding:28px 0 36px"><div style="max-width:568px;margin:0 auto;padding:0 16px;color:${NL_C.ink};font:16px/1.55 ${NL_SERIF}">
<div style="font:12px ${NL_SANS};letter-spacing:2px;color:${NL_C.mute};text-transform:uppercase">Issue ${iss.num} · ${esc(when)}</div>
<div style="font:32px/1.15 ${NL_SERIF};margin:6px 0 18px"><a href="${NL_SITE}/exp" style="color:${NL_C.ink};text-decoration:none">Your Weekly Dose of Jawan</a></div>
${intro ? `<div style="margin:0 0 8px">${intro}</div>` : ''}
${feat ? `<div style="font:12px ${NL_SANS};letter-spacing:2px;color:${NL_C.mute};text-transform:uppercase;margin:26px 0 8px">Featured</div>${nlCard(feat, iss.feat)}` : ''}
${nlH(`Jawan Experienced ${n} Thing${n === 1 ? '' : 's'} This Week`, n ? `+${sum.toLocaleString()} EXP · ${dur(sum)} · Quality of Life ${qolOf(w.exps)}` : '')}
${exps.length ? nlGrid(exps) : n ? '' : `<p style="margin:0;color:${NL_C.mute}">A quiet week.</p>`}
${blogs.length ? nlH('On the Blog') + nlGrid(blogs) : ''}
<div style="margin-top:34px;border-top:1px solid ${NL_C.line};padding-top:14px;font:12px/1.6 ${NL_SANS};color:${NL_C.mute}">
You're getting this because you signed up at <a href="${NL_SITE}/newsletter" style="color:${NL_C.mute}">jawansb.com/newsletter</a>. Reply to this email to write back to me.<br>
<a href="{{{RESEND_UNSUBSCRIBE_URL}}}" style="color:${NL_C.mute}">Unsubscribe</a></div>
</div></div></body></html>`;
  return {subject: nlSubject(iss), html};
}

/* --- THE PAGES --- */
let nlView = null, nl = null, nlQ = null, nlPvT = null;   // which page/issue is drawn, the issue being written, its intro editor
function renderNews() {
  const p = $('pgNews');
  if (page === 'news') {
    if (nlView === 'news' + owner) return; nlView = 'news' + owner;
    const joined = /joined=1/.test(location.search);
    p.innerHTML = `<div class="nlsign"><h2 class="fh">Your Weekly Dose of Jawan</h2>
      <p>Every Monday: a note from me, every experience I logged that week, and whatever I wrote on the blog.</p>
      ${joined ? '<p class="nlok">You’re in! The next issue lands in your inbox on Monday.</p>' : `<form id="nlForm" class="nlform"><input type="email" id="nlEmail" placeholder="you@example.com" autocomplete="email" required>
      <input id="nlHp" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true"><button class="go" id="nlGo">SUBSCRIBE</button></form><p id="nlMsg" class="mute"></p>`}
      <p class="mute nlfine">You’ll get one email to confirm. Every issue has an unsubscribe link. Your address is kept by Resend (the service that sends the emails) and used for nothing else.</p>
      ${owner ? '<p><a class="link" href="/newsletter/write" data-act="go" data-v="newsletter/write">Write this week’s issue →</a></p>' : ''}</div>`;
    return;
  }
  if (!loaded || !owner) { nlView = null; p.innerHTML = `<p class="mute">${loaded ? 'Log in to write the newsletter.' : 'Loading…'}</p>`; return; }
  const iss = curIssue(), id = iss ? iss.id : 'issue-' + (Math.max(0, ...issues().map(i => i.num)) + 1);
  if (nlView === id) { nlStatus(); nlPreview(); return; }   // already open: keep what you're typing
  nlView = id; buildWrite(iss, id);
}
function buildWrite(iss, id) {
  nl = iss ? JSON.parse(JSON.stringify(iss)) : {id, kind: 'issue', num: +id.split('-')[1], intro: '', feat: null, sendAt: nextMonday().toISOString(), status: 'draft'};
  const pick = l => l.filter(x => x.is_public && x.num).sort((a, b) => (loggedAt(b) || '').localeCompare(loggedAt(a) || ''))
    .map(x => `<option value="${x.id}"${nl.feat && nl.feat.id === x.id ? ' selected' : ''}>${x.kind === 'post' ? 'Blog' : 'EXP'} ${x.num} · ${esc(x.title)}</option>`).join('');
  $('pgNews').innerHTML = `<button class="link" data-act="go" data-v="newsletter">← Signup page</button>
    <h2>Issue ${nl.num}</h2><p class="mute" id="nlState"></p>
    <label>Subject</label><p class="nlsubj">${esc(nlSubject(nl))}</p>
    <label>Send time</label><input type="datetime-local" id="nlAt" value="${loc(new Date(nl.sendAt))}">
    <label>Intro blurb</label><div id="nlEd"></div>
    <label>Feature</label><select id="nlFeat"><option value="">No feature</option><optgroup label="EXP">${pick(ents())}</optgroup><optgroup label="Blog">${pick(posts())}</optgroup><optgroup label="Strictly Business"><option disabled>No projects yet</option></optgroup></select>
    <div id="nlFeatOpts"></div>
    <p class="mute" id="nlAuto"></p>
    <div class="btns nlbtns"><button class="go2" data-act="nlsave">SAVE DRAFT</button><button class="go2" data-act="nltest">SEND ME A TEST</button><button class="go" id="nlSched" data-act="nlsched">SCHEDULE</button></div>
    <button class="link" id="nlUn" data-act="nlunsched" hidden>Cancel the scheduled send</button>
    <label>Preview</label><iframe id="nlPv" class="nlpv" sandbox="allow-same-origin allow-popups" title="Email preview"></iframe>`;
  nlQ = window.Quill ? new Quill('#nlEd', {theme: 'snow', placeholder: 'This week…', modules: {toolbar: [
    [{font: [false, 'serif', 'typewriter', 'display', 'mono']}, {size: ['small', false, 'large', 'huge']}],
    ['bold', 'italic', 'underline', 'strike'], [{list: 'ordered'}, {list: 'bullet'}], ['blockquote', 'link'], ['clean']]}}) : null;
  if (nlQ) { if (nl.intro) nlQ.clipboard.dangerouslyPasteHTML(nl.intro); nlQ.history.clear(); nlQ.on('text-change', () => { nl.intro = nlQ.getLength() > 1 ? nlQ.root.innerHTML : ''; nlPreview(); }); }
  $('nlPv').addEventListener('load', () => { const d = $('nlPv').contentDocument; if (d) $('nlPv').style.height = d.documentElement.scrollHeight + 'px'; });
  nlFeatOpts(); nlStatus(); nlPreview();
}
// how the feature is shown: which parts, in what order, which photo, short or full description
function nlFeatOpts() {
  const x = nl.feat && all.find(y => y.id === nl.feat.id), box = $('nlFeatOpts');
  if (!x) { box.innerHTML = ''; return; }
  const f = nl.feat, names = Object.fromEntries(x.kind === 'post' ? NL_BLOG_PARTS : PV_PARTS);
  const order = f.order.filter(k => names[k]).concat(Object.keys(names).filter(k => !f.order.includes(k)));
  box.innerHTML = `<p class="mute">Tick what the feature shows, and use ↑ ↓ to put the parts in order.</p><div class="nlparts">${order.map((k, i) =>
    `<div class="nlpart"><label class="chk"><input type="checkbox" data-nlpart="${k}"${f.show.includes(k) ? ' checked' : ''}> ${names[k]}</label>
     <button class="ib" data-act="nlmove" data-v="${k}" data-k="-1" title="Move up"${i ? '' : ' disabled'}>↑</button><button class="ib" data-act="nlmove" data-v="${k}" data-k="1" title="Move down"${i < order.length - 1 ? '' : ' disabled'}>↓</button></div>`).join('')}</div>
    <label class="chk"><input type="checkbox" id="nlFull"${f.full ? ' checked' : ''}> Whole description, with its formatting (otherwise a short taste)</label>
    ${picsOf(x).length > 1 ? `<div class="nlpics"><span class="mute">Photo:</span>${picsOf(x).map(p => `<button class="nlpic${(f.img || x.pvImg || picsOf(x)[0].key) === p.key ? ' on' : ''}" data-act="nlimg" data-v="${esc(p.key)}"><img src="${esc(p.src)}" alt=""></button>`).join('')}</div>` : ''}`;
  f.order = order;
}
function nlStatus() {
  if (!$('nlState')) return;
  const w = nlWindow(nl), sch = nl.status === 'scheduled', d = t => new Date(t).toLocaleString([], {weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'});
  $('nlState').textContent = sch ? `Scheduled: goes out ${d(nl.sendAt)}. Change anything, then press Reschedule.` : `Draft. Covers what you’ve posted since ${d(w.from)}.`;
  $('nlAuto').textContent = `Added automatically: ${w.exps.length} new public EXP${w.exps.length === 1 ? '' : 's'}` + (w.blogs.length ? ` and ${w.blogs.length} blog post${w.blogs.length === 1 ? '' : 's'}` : '') + ', as preview cards.';
  $('nlSched').textContent = sch ? 'RESCHEDULE WITH CHANGES' : 'SCHEDULE'; $('nlUn').hidden = !sch;
}
const nlPreview = () => { clearTimeout(nlPvT); nlPvT = setTimeout(() => { if ($('nlPv') && nl) $('nlPv').srcdoc = buildEmail(nl).html; }, 250); };
// the parts of the issue that get saved (nothing else ends up in Supabase)
const nlRecord = () => ({id: nl.id, kind: 'issue', is_public: false, num: nl.num, intro: nl.intro, feat: nl.feat, sendAt: nl.sendAt, status: nl.status, until: nl.until, bid: nl.bid, saved: new Date().toISOString()});
async function nlApi(path, body) {
  const s = (await sb.auth.getSession()).data.session;
  const r = await fetch('/api/' + path, {method: 'POST', headers: {'content-type': 'application/json', authorization: 'Bearer ' + (s ? s.access_token : '')}, body: JSON.stringify(body)});
  const o = await r.json().catch(() => ({error: 'No answer from the server (' + r.status + ')'}));
  if (!r.ok) throw new Error(o.error || 'Error ' + r.status);
  return o;
}
async function nlBusy(btn, label, job) {
  const was = btn.textContent; btn.disabled = true; btn.textContent = label;
  try { await job(); } catch (e) { flash('Didn’t work: ' + e.message); }
  btn.disabled = false; if (btn.textContent === label) btn.textContent = was;
  nlStatus();
}

/* --- THE FRIDAY ALERT: Friday to Sunday, while you're logged in and next Monday's issue isn't scheduled yet --- */
function drawNlBar() {
  const c = curIssue(), day = new Date().getDay(), on = owner && loaded && [5, 6, 0].includes(day) && !(c && c.status === 'scheduled') && page !== 'write';
  $('nlbar').hidden = !on;
  if (on) $('nlbar').innerHTML = `<b>It’s Newsletter time!</b> Issue ${c ? c.num : Math.max(0, ...issues().map(i => i.num)) + 1} goes out Monday. <a class="link" href="/newsletter/write" data-act="go" data-v="newsletter/write">Write it →</a>`;
}

/* --- CLICKS AND TYPING on the newsletter pages --- */
document.addEventListener('click', ev => {
  const b = ev.target.closest('[data-act^="nl"]'); if (!b || !nl) return;
  const a = b.dataset.act, v = b.dataset.v;
  if (a === 'nlmove') { const o = nl.feat.order, i = o.indexOf(v), j = i + +b.dataset.k; [o[i], o[j]] = [o[j], o[i]]; nlFeatOpts(); nlPreview(); }
  else if (a === 'nlimg') { nl.feat.img = v; nlFeatOpts(); nlPreview(); }
  else if (a === 'nlsave') nlBusy(b, 'Saving…', async () => { if (await put(nlRecord())) flash('Issue ' + nl.num + ' saved'); });
  else if (a === 'nltest') nlBusy(b, 'Sending…', async () => { await nlApi('test', buildEmail(nl)); flash('Test sent to ' + OWNER_EMAIL + '. Check your inbox.'); });
  else if (a === 'nlsched') {
    const when = new Date(nl.sendAt);
    if (!(when > Date.now() + 60e3)) { flash('Pick a send time in the future.'); return; }
    if (!confirm(`Send Issue ${nl.num} to everyone on the list ${when.toLocaleString([], {weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'})}?`)) return;
    nlBusy(b, 'Scheduling…', async () => {
      const keep = {status: nl.status, until: nl.until};
      nl.status = 'scheduled'; nl.until = new Date().toISOString();   // the issue is frozen as of now; anything posted later goes in the next one
      try { const r = await nlApi('schedule', {...buildEmail(nl), at: nl.sendAt, replace: nl.bid}); nl.bid = r.id; }
      catch (e) { Object.assign(nl, keep); throw e; }
      if (await put(nlRecord())) flash('Issue ' + nl.num + ' is scheduled. Resend will send it.');
    });
  }
  else if (a === 'nlunsched') nlBusy(b, 'Cancelling…', async () => {
    await nlApi('unschedule', {id: nl.bid}); nl.status = 'draft'; delete nl.until; delete nl.bid;
    if (await put(nlRecord())) flash('Cancelled. Issue ' + nl.num + ' is a draft again.');
  });
});
document.addEventListener('change', ev => {
  const t = ev.target; if (!nl || !t.closest('#pgNews')) return;
  if (t.id === 'nlFeat') { const x = all.find(y => y.id === t.value); nl.feat = x ? {id: x.id, show: [...new Set(['title', ...(x.pvShow || PV_DEFAULT)])], order: [...(x.pvOrder || orderOf(x))], full: false} : null; nlFeatOpts(); nlStatus(); }
  else if (t.dataset.nlpart) { const s = new Set(nl.feat.show); t.checked ? s.add(t.dataset.nlpart) : s.delete(t.dataset.nlpart); nl.feat.show = [...s]; }
  else if (t.id === 'nlFull') nl.feat.full = t.checked;
  else if (t.id === 'nlAt') { const d = new Date(t.value); if (!isNaN(d)) nl.sendAt = d.toISOString(); }
  else return;
  nlPreview();
});
document.addEventListener('submit', async ev => {   // the signup form
  if (ev.target.id !== 'nlForm') return;
  ev.preventDefault();
  const btn = $('nlGo'), msg = $('nlMsg'); btn.disabled = true; btn.textContent = 'Sending…'; msg.textContent = '';
  try {
    const r = await fetch('/api/subscribe', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({email: $('nlEmail').value, website: $('nlHp').value})});
    const o = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(o.error || 'Something went wrong. Try again in a bit.');
    ev.target.hidden = true; msg.className = 'nlok'; msg.textContent = 'Almost there: check your inbox for a confirm link.';
  } catch (e) { msg.textContent = e.message; btn.disabled = false; btn.textContent = 'SUBSCRIBE'; }
});
