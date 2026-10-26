/* THE NEWSLETTER: "Your Weekly Dose of Jawan".
   /newsletter        the signup page (anyone). The email goes to Resend via /api/subscribe; they get a "click to confirm" email.
   /newsletter/write  the composer (you only): intro blurb, a featured EXP / blog post, then every new public EXP and blog post
                      since the last issue, drawn as preview cards. "Schedule" hands the finished email to Resend, which sends it.
   Each issue is saved in Supabase as a private item (kind "issue"): its number, intro, feature, send time, and whether it's scheduled.
   This file loads before app.js and only defines things; app.js calls renderNews() and drawNlBar() from render(). */

const NL_SITE = 'https://jawansb.com', OWNER_EMAIL = 'jawanali@gmail.com';   // tests go to OWNER_EMAIL
const NL_FONTS = {serif: "Georgia,'Times New Roman',serif", typewriter: "'Special Elite','Courier New',monospace", display: "'Playfair Display',Georgia,serif", mono: 'Menlo,Consolas,monospace'};
const NL_SIZES = {small: '13px', large: '20px', huge: '28px'};
const NL_SEND_HOUR = 9;   // issues go out Monday at 9:00 in the morning (your time) unless you pick another time
/* --- THE DESIGN: every color, font, size and word in the emails (and on the signup page) is a setting.
       NL_DEFAULT is the original design. What you change at /newsletter/design is saved in Settings as "nlDesign"
       (only the things that differ from the original), so "back to the original" is always one click away. --- */
const NL_FONT_LIST = [
  ['georgia', 'Georgia', "Georgia,'Times New Roman',serif"],
  ['times', 'Times New Roman', "'Times New Roman',Times,serif"],
  ['palatino', 'Palatino', "'Palatino Linotype',Palatino,'Book Antiqua',serif"],
  ['playfair', 'Playfair Display', "'Playfair Display',Georgia,serif"],
  ['typewriter', 'Special Elite (typewriter)', "'Special Elite','Courier New',monospace"],
  ['courier', 'Courier', "'Courier New',Courier,monospace"],
  ['arial', 'Arial', 'Arial,Helvetica,sans-serif'],
  ['verdana', 'Verdana', 'Verdana,Geneva,sans-serif'],
  ['trebuchet', 'Trebuchet', "'Trebuchet MS',Helvetica,sans-serif"],
  ['system', 'System (like the site)', "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif"]
];
const nlFont = k => (NL_FONT_LIST.find(f => f[0] === k) || NL_FONT_LIST[0])[2];
// Playfair and Special Elite aren't on most computers: the email asks Google Fonts for them (Apple Mail shows them; Gmail falls back)
const nlFontLink = d => ['titleFont', 'headFont', 'bodyFont', 'smallFont'].some(k => ['playfair', 'typewriter'].includes(d[k]))
  ? '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;1,400&family=Special+Elite&display=swap">' : '';
const NL_DEFAULT = {
  fromName: 'Jawan',
  bg: '#313E50', ink: '#cae2ff', mute: '#8d9aab', line: '#4a5573', link: '#cae2ff',
  card: '#3a435e', cardInk: '#cae2ff', cardLine: '#4a5573', star: '#2DD881', off: '#5f6b85', btn: '#cae2ff', btnInk: '#313E50',
  titleFont: 'georgia', headFont: 'georgia', bodyFont: 'georgia', smallFont: 'arial',
  titleSize: 32, headSize: 24, bodySize: 16, smallSize: 13,
  cols: 2, tint: true, summary: true, rules: true, caps: true,
  subject: 'Your Weekly Dose of Jawan - Issue {n}',
  preheader: '{intro}',
  kicker: 'Issue {n} · {date}',
  title: 'Your Weekly Dose of Jawan',
  featured: 'Featured',
  expHeading: 'Jawan Experienced {count} {Things} This Week',
  expSummary: '+{exp} EXP · {time} · Quality of Life {qol}',
  quiet: 'A quiet week.',
  blogHeading: 'On the Blog',
  readMore: 'Read it on jawansb.com →',
  footer: 'You’re getting this because you signed up at jawansb.com/newsletter. Reply to this email to write back to me.',
  unsub: 'Unsubscribe',
  confirmSubject: 'Confirm: Your Weekly Dose of Jawan',
  confirmTitle: 'Your Weekly Dose of Jawan',
  confirmBody: 'Someone (hopefully you) asked to get my newsletter at this address. Click below to confirm, and the next issue will land in your inbox on Monday.',
  confirmButton: 'CONFIRM',
  confirmFine: 'Didn’t ask for this? Ignore this email and you won’t hear from me.',
  signupTitle: 'Your Weekly Dose of Jawan',
  signupBlurb: 'Every Monday: a note from me, every experience I logged that week, and whatever I wrote on the blog.',
  signupPlaceholder: 'you@example.com',
  signupButton: 'SUBSCRIBE',
  signupCheck: 'Almost there: check your inbox for a confirm link.',
  signupDone: 'You’re in! The next issue lands in your inbox on Monday.',
  signupFine: 'You’ll get one email to confirm. Every issue has an unsubscribe link. Your address is kept by Resend (the service that sends the emails) and used for nothing else.'
};
const NL_NEEDED = ['fromName', 'subject', 'unsub', 'confirmSubject', 'confirmButton', 'signupButton'];   // these can't be left blank: blank = the original
const nlD = (saved = settings().nlDesign) => { const d = {...NL_DEFAULT, ...(saved || {})}; NL_NEEDED.forEach(k => { if (!String(d[k]).trim()) d[k] = NL_DEFAULT[k]; }); return d; };
// {n}, {count}… in your words get filled in for each issue
const nlFill = (t, v) => String(t || '').replace(/\{(\w+)\}/g, (m, k) => k in v ? v[k] : m);
// plain words -> email-safe text: web links, email addresses and jawansb.com/… become links; line breaks stay
const nlWords = (t, color) => esc(t || '').replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)])|([\w.+-]+@[\w-]+(?:\.[\w-]+)+)|(\bjawansb\.com(?:\/[\w\/-]*[\w\/])?)/g,
  (m, u, e, j) => `<a href="${u || (e ? 'mailto:' + e : 'https://' + j)}" style="color:${color}">${m}</a>`).replace(/\n/g, '<br>');
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
const nlChip = (k, n, d) => { const b = tcol(k, n); return `<span style="display:inline-block;background:${b};color:${ink(b)};font:12px/1.4 ${nlFont(d.smallFont)};padding:2px 7px;margin:0 4px 4px 0">${esc(n)}</span>`; };
const nlStars = (r, on, off) => `<span style="color:${on};letter-spacing:2px">${'★'.repeat(Math.floor(r))}${r % 1 ? '½' : ''}</span><span style="color:${off};letter-spacing:2px">${'★'.repeat(5 - Math.ceil(r))}</span>`;
/* one card. show = which parts, order = their order (both from the card's own preview settings unless the feature sets them),
   full = the whole description with its formatting (the feature can have that); otherwise a short plain-text taste of it */
function nlCard(x, o, d) {
  const ent = !x.kind, tbg = ent && d.tint ? tintBg(x) : null, bg = tbg || d.card, fg = tbg ? ink(tbg) : d.cardInk, mute = blend(bg, fg, .65), url = itemUrl(x);
  const S = nlFont(d.smallFont), B = nlFont(d.bodyFont), ss = d.smallSize;
  const show = o.show || x.pvShow || PV_DEFAULT, order = o.order || x.pvOrder || orderOf(x), full = !!o.full;
  const small = `font:${ss}px/1.5 ${S};color:${mute};margin:0 0 6px`;
  const pic = (() => { const l = picsOf(x), p = l.find(q => q.key === (o.img || x.pvImg)) || l[0]; return p ? `<img src="${esc(p.src)}" alt="" width="100%" style="display:block;width:100%;height:auto;border:0;margin:6px 0">` : ''; })();
  const tags = (k, w) => tagsOf(x, k).length ? `<span style="color:${mute}">${w}</span> ${tagsOf(x, k).map(n => esc(canon(k, n))).join(', ')} ` : '';
  const s = new Date(ent ? x.start : x.created);
  const parts = {
    title: `<div style="font:${Math.round(d.headSize * .83)}px/1.25 ${nlFont(d.headFont)};margin:0 0 6px">${full ? `<a href="${url}" style="color:${fg};text-decoration:none">${esc(x.title)}</a>` : esc(x.title)}</div>`,
    time: `<div style="${small}">${s.toLocaleDateString('en-US', {weekday: 'short', month: 'short', day: 'numeric'})}${ent ? ` · ${dur(x.minutes)} · +${x.minutes} EXP` : ''}</div>`,
    type: ent && tagsOf(x, 'types').length ? `<div style="margin:0 0 4px">${tagsOf(x, 'types').map(n => nlChip('types', canon('types', n), d)).join('')}</div>` : '',
    tags: ent && (tags('people', 'with') + tags('places', 'at')) ? `<div style="font:${ss}px/1.5 ${S};margin:0 0 6px">${tags('people', 'with')}${tags('places', 'at')}</div>` : '',
    rating: ent ? `<div style="font-size:17px;margin:0 0 6px">${nlStars(x.rating, d.star, tbg ? mute : d.off)}</div>` : '',
    desc: full ? (() => { const r = nlRich(x.html, x, fg) || esc(x.desc || x.body || ''); return r ? `<div style="font:${d.bodySize}px/1.55 ${B};margin:0 0 8px">${r}</div>` : ''; })()
      : (() => { const t = nlShort(x.desc || x.body || nlPlain(x.html)); return t ? `<div style="font:${d.bodySize - 1}px/1.5 ${B};margin:0 0 6px">${esc(t)}</div>` : ''; })(),
    photos: pic
  };
  const inner = order.filter(k => show.includes(k) && parts[k]).map(k => parts[k]).join('');
  const box = `background:${bg};color:${fg};border:1px solid ${d.cardLine};padding:14px 16px`;
  // a preview card is one big link to the post; the full feature has its own links inside, so it gets a "read it" link instead
  return full ? `<div style="${box}">${inner}${d.readMore ? `<div style="font:${ss}px ${S};margin-top:8px"><a href="${url}" style="color:${fg}">${esc(d.readMore)}</a></div>` : ''}</div>`
    : `<a href="${url}" style="display:block;text-decoration:none;color:${fg};${box}">${inner}</a>`;
}
// preview cards two to a row (one to a row on phones), like a small version of the board; or one to a row everywhere
const nlGrid = (l, d) => d.cols === 1 ? l.map(x => `<div style="margin:0 0 10px">${nlCard(x, {}, d)}</div>`).join('')
  : `<div style="font-size:0;line-height:0">${l.map((x, i) => `<div class="nlcol" style="display:inline-block;vertical-align:top;width:100%;max-width:280px;margin:0 ${i % 2 ? 0 : 8}px 10px 0;font-size:16px;line-height:1.45;text-align:left">${nlCard(x, {}, d)}</div>`).join('')}</div>`;
const nlH = (t, sub, d) => `<div style="margin:30px 0 12px;${d.rules ? `border-top:1px solid ${d.line};padding-top:18px` : ''}">${t ? `<div style="font:${d.headSize}px/1.25 ${nlFont(d.headFont)}">${esc(t)}</div>` : ''}${sub ? `<div style="font:${d.smallSize}px ${nlFont(d.smallFont)};color:${d.mute};margin-top:4px">${esc(sub)}</div>` : ''}</div>`;
const nlLabel = (t, d, m) => t ? `<div style="font:${d.smallSize - 1}px ${nlFont(d.smallFont)};letter-spacing:2px;color:${d.mute};${d.caps ? 'text-transform:uppercase;' : ''}margin:${m}">${esc(t)}</div>` : '';
function buildEmail(iss, d = nlD()) {
  const w = nlWindow(iss), feat = iss.feat && all.find(x => x.id === iss.feat.id), n = w.exps.length, sum = sumMin(w.exps);
  const exps = w.exps.filter(x => !feat || x.id !== feat.id), blogs = w.blogs.filter(x => !feat || x.id !== feat.id);
  const v = {n: iss.num, count: n, things: n === 1 ? 'thing' : 'things', Things: n === 1 ? 'Thing' : 'Things', exp: sum.toLocaleString(), time: dur(sum), qol: qolOf(w.exps),
    date: new Date(iss.sendAt).toLocaleDateString('en-US', {weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'}), intro: nlShort(nlPlain(iss.intro))};
  const F = t => nlFill(t, v).trim(), subject = F(d.subject), intro = nlRich(iss.intro, null, d.link);
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>${esc(subject)}</title>${nlFontLink(d)}
<style>@media (max-width:620px){.nlcol{max-width:100%!important;margin-right:0!important}}</style></head>
<body style="margin:0;padding:0;background:${d.bg}">
<div style="display:none;max-height:0;overflow:hidden">${esc(F(d.preheader) || F(d.expHeading) || subject)}</div>
<div style="background:${d.bg};padding:28px 0 36px"><div style="max-width:568px;margin:0 auto;padding:0 16px;color:${d.ink};font:${d.bodySize}px/1.55 ${nlFont(d.bodyFont)}">
${nlLabel(F(d.kicker), d, '0')}
${F(d.title) ? `<div style="font:${d.titleSize}px/1.15 ${nlFont(d.titleFont)};margin:6px 0 18px"><a href="${NL_SITE}/exp" style="color:${d.ink};text-decoration:none">${esc(F(d.title))}</a></div>` : '<div style="height:12px"></div>'}
${intro ? `<div style="margin:0 0 8px">${intro}</div>` : ''}
${feat ? nlLabel(F(d.featured), d, '26px 0 8px') + (F(d.featured) ? '' : '<div style="height:20px"></div>') + nlCard(feat, iss.feat, d) : ''}
${nlH(F(d.expHeading), n && d.summary ? F(d.expSummary) : '', d)}
${exps.length ? nlGrid(exps, d) : n || !F(d.quiet) ? '' : `<p style="margin:0;color:${d.mute}">${esc(F(d.quiet))}</p>`}
${blogs.length ? nlH(F(d.blogHeading), '', d) + nlGrid(blogs, d) : ''}
<div style="margin-top:34px;${d.rules ? `border-top:1px solid ${d.line};padding-top:14px;` : ''}font:${d.smallSize - 1}px/1.6 ${nlFont(d.smallFont)};color:${d.mute}">
${F(d.footer) ? nlWords(F(d.footer), d.mute) + '<br>' : ''}<a href="{{{RESEND_UNSUBSCRIBE_URL}}}" style="color:${d.mute}">${esc(d.unsub)}</a></div>
</div></div></body></html>`;
  return {subject, html};
}
// the "click to confirm" email. Saved with the design; the server fills in each person's own link where {{LINK}} is
function nlConfirm(d) {
  const S = nlFont(d.smallFont), fine = blend(d.card, d.cardInk, .65);
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${nlFontLink(d)}</head><body style="margin:0;padding:0;background:${d.bg}">
<div style="background:${d.bg};padding:40px 16px;font:${d.bodySize}px/1.6 ${nlFont(d.bodyFont)};color:${d.cardInk}">
<div style="max-width:520px;margin:0 auto;background:${d.card};padding:28px 28px 22px;border:1px solid ${d.cardLine}">
${d.confirmTitle ? `<div style="font:${Math.round(d.titleSize * .75)}px/1.2 ${nlFont(d.titleFont)};margin:0 0 14px">${esc(d.confirmTitle)}</div>` : ''}
${d.confirmBody ? `<div style="margin:0 0 18px">${nlWords(d.confirmBody, d.link)}</div>` : ''}
<div style="margin:0 0 20px"><a href="{{LINK}}" style="display:inline-block;background:${d.btn};color:${d.btnInk};text-decoration:none;padding:10px 20px;font:14px ${S};letter-spacing:1px">${esc(d.confirmButton)}</a></div>
${d.confirmFine ? `<div style="font:${d.smallSize}px/1.5 ${S};color:${fine}">${nlWords(d.confirmFine, fine)}</div>` : ''}
</div></div></body></html>`;
  return {subject: d.confirmSubject, html, text: `${d.confirmBody}\n\nConfirm here: {{LINK}}\n\n${d.confirmFine}`.trim()};
}

/* --- THE PAGES --- */
let nlView = null, nl = null, nlQ = null, nlPvT = null;   // which page/issue is drawn, the issue being written, its intro editor
function renderNews() {
  const p = $('pgNews');
  p.classList.toggle('wide', page === 'design');
  if (page === 'news') {
    if (nlView === 'news' + owner) return; nlView = 'news' + owner;
    p.innerHTML = nlSignup(nlD(), /joined=1/.test(location.search) ? 'done' : '') + (owner ? `<p class="nlsign"><a class="link" href="/newsletter/write" data-act="go" data-v="newsletter/write">Write this week’s issue →</a>
      <a class="link" href="/newsletter/design" data-act="go" data-v="newsletter/design">Design →</a></p>` : '');
    return;
  }
  if (!loaded || !owner) { nlView = null; p.innerHTML = `<p class="mute">${loaded ? 'Log in to write the newsletter.' : 'Loading…'}</p>`; return; }
  if (page === 'design') { if (nlView !== 'design') { nlView = 'design'; buildDesign(); } else nldStatus(); return; }
  const iss = curIssue(), id = iss ? iss.id : 'issue-' + (Math.max(0, ...issues().map(i => i.num)) + 1);
  if (nlView === id) { nlStatus(); nlPreview(); return; }   // already open: keep what you're typing
  nlView = id; buildWrite(iss, id);
}
function buildWrite(iss, id) {
  nl = iss ? JSON.parse(JSON.stringify(iss)) : {id, kind: 'issue', num: +id.split('-')[1], intro: '', feat: null, sendAt: nextMonday().toISOString(), status: 'draft'};
  const pick = l => l.filter(x => x.is_public && x.num).sort((a, b) => (loggedAt(b) || '').localeCompare(loggedAt(a) || ''))
    .map(x => `<option value="${x.id}"${nl.feat && nl.feat.id === x.id ? ' selected' : ''}>${x.kind === 'post' ? 'Blog' : 'EXP'} ${x.num} · ${esc(x.title)}</option>`).join('');
  $('pgNews').innerHTML = `<button class="link" data-act="go" data-v="newsletter">← Signup page</button> <button class="link" data-act="go" data-v="newsletter/design">Change the design →</button>
    <h2>Issue ${nl.num}</h2><p class="mute" id="nlState"></p>
    <label>Subject</label><p class="nlsubj" id="nlSubj"></p>
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
  $('nlSubj').textContent = buildEmail(nl).subject;
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
    ev.target.hidden = true; msg.className = 'nlok'; msg.textContent = nlD().signupCheck;
  } catch (e) { msg.textContent = e.message; btn.disabled = false; btn.textContent = 'SUBSCRIBE'; }
});

/* --- THE SIGNUP PAGE, drawn from the design's words (preview = the look-only copy on the design page) --- */
const nlSignup = (d, state, preview) => `<div class="nlsign"><h2 class="fh">${esc(d.signupTitle)}</h2>
  ${d.signupBlurb ? `<p>${nlWords(d.signupBlurb, 'inherit')}</p>` : ''}
  ${state === 'done' ? `<p class="nlok">${esc(d.signupDone)}</p>` : state === 'check' ? `<p class="nlok">${esc(d.signupCheck)}</p>`
    : `<form${preview ? '' : ' id="nlForm"'} class="nlform"><input type="email"${preview ? '' : ' id="nlEmail" required'} placeholder="${esc(d.signupPlaceholder)}" autocomplete="email">
    ${preview ? '' : '<input id="nlHp" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">'}<button class="go"${preview ? ' type="button"' : ' id="nlGo"'}>${esc(d.signupButton)}</button></form>${preview ? '' : '<p id="nlMsg" class="mute"></p>'}`}
  ${d.signupFine ? `<p class="mute nlfine">${nlWords(d.signupFine, 'inherit')}</p>` : ''}</div>`;

/* --- THE DESIGN PAGE (/newsletter/design, you only): every setting on the left, a live preview on the right.
       Nothing changes for readers until you press Save. --- */
const NL_FORM = [
  ['Sender', [['fromName', 'Sender name (who the email says it’s from)']]],
  ['Colors', [['bg', 'Page background', 'c'], ['ink', 'Text', 'c'], ['mute', 'Small text', 'c'], ['link', 'Links', 'c'], ['line', 'Dividing lines', 'c'],
    ['card', 'Card background', 'c'], ['cardInk', 'Card text', 'c'], ['cardLine', 'Card border', 'c'], ['star', 'Stars', 'c'], ['off', 'Empty stars', 'c'], ['btn', 'Confirm button', 'c'], ['btnInk', 'Confirm button text', 'c']]],
  ['Fonts & sizes', [['titleFont', 'Big title', 'f'], ['titleSize', 'Big title size', 'n'], ['headFont', 'Headings & card titles', 'f'], ['headSize', 'Heading size', 'n'],
    ['bodyFont', 'Body text', 'f'], ['bodySize', 'Body size', 'n'], ['smallFont', 'Small text & labels', 'f'], ['smallSize', 'Small text size', 'n']]],
  ['Layout', [['cols', 'Cards per row', 'cols'], ['tint', 'Tint EXP cards with their Type tag color', 'b'], ['summary', 'Show the EXP / QoL line under the heading', 'b'],
    ['rules', 'Lines between sections', 'b'], ['caps', 'Small labels in CAPITALS', 'b']]],
  ['Weekly email words', [['subject', 'Subject line'], ['preheader', 'Preview line (the gray text inboxes show after the subject)'], ['kicker', 'Small line above the title'], ['title', 'Big title'],
    ['featured', 'Label above the feature'], ['expHeading', 'EXP heading'], ['expSummary', 'EXP summary line'], ['quiet', 'When there are no new EXPs'], ['blogHeading', 'Blog heading'],
    ['readMore', 'Link under the feature'], ['footer', 'Footer', 't'], ['unsub', 'Unsubscribe link']]],
  ['Confirmation email', [['confirmSubject', 'Subject line'], ['confirmTitle', 'Title'], ['confirmBody', 'Message', 't'], ['confirmButton', 'Button'], ['confirmFine', 'Small print', 't']]],
  ['Signup page', [['signupTitle', 'Title'], ['signupBlurb', 'Blurb', 't'], ['signupPlaceholder', 'Hint inside the email box'], ['signupButton', 'Button'],
    ['signupCheck', 'After someone signs up'], ['signupDone', 'After they confirm'], ['signupFine', 'Small print', 't']]]
];
const NL_HELP = {'Weekly email words': 'Fill-ins: {n} issue number · {date} send date · {count} new EXPs · {things} / {Things} “thing” or “things” · {exp} total EXP · {time} total time · {qol} Quality of Life · {intro} the start of your intro. Leave a box empty to leave that part out.'};
let nld = null, nldTab = 'issue', nldT = null;   // the design being edited, which preview is showing
const nldSame = k => String(nld[k]) === String(NL_DEFAULT[k]);
function nldField([k, label, t]) {
  const v = nld[k], dv = esc(String(NL_DEFAULT[k])), reset = `<button class="nldr" data-act="nldreset" data-v="${k}" title="Back to the original" aria-label="Back to the original"${nldSame(k) ? ' hidden' : ''}>↺</button>`;
  if (t === 'b') return `<div class="nldrow"><label class="chk"><input type="checkbox" data-nld="${k}"${v ? ' checked' : ''}> ${label}</label>${reset}</div>`;
  const input = t === 'c' ? `<input type="color" data-nld="${k}" value="${esc(v)}">`
    : t === 'n' ? `<input type="number" min="8" max="72" data-nld="${k}" value="${v}">`
    : t === 'f' ? `<select data-nld="${k}">${NL_FONT_LIST.map(([f, n]) => `<option value="${f}"${v === f ? ' selected' : ''}>${n}</option>`).join('')}</select>`
    : t === 'cols' ? `<select data-nld="${k}"><option value="2"${v === 2 ? ' selected' : ''}>Two (one on phones)</option><option value="1"${v === 1 ? ' selected' : ''}>One</option></select>`
    : t === 't' ? `<textarea rows="3" data-nld="${k}" placeholder="${dv}">${esc(v)}</textarea>` : `<input data-nld="${k}" value="${esc(v)}" placeholder="${dv}">`;
  return `<div class="nldrow nld-${t || 's'}"><label>${label}</label>${input}${reset}</div>`;
}
function buildDesign(d = nlD()) {
  nld = d;
  $('pgNews').innerHTML = `<div class="nld"><div class="nldform">
    <button class="link" data-act="go" data-v="newsletter/write">← Back to the issue</button>
    <h2>Newsletter design</h2><p class="mute">Change anything and the preview follows. Readers see nothing new until you press Save. ↺ puts one thing back the way it was.</p>
    <div class="nldbar"><button class="go" data-act="nldsave">SAVE DESIGN</button><span id="nldState" class="mute"></span></div>
    ${NL_FORM.map(([g, fields], i) => `<details class="nldg"${i < 2 ? ' open' : ''}><summary>${g}</summary>${NL_HELP[g] ? `<p class="mute nldhelp">${NL_HELP[g]}</p>` : ''}${fields.map(nldField).join('')}</details>`).join('')}
    <button class="link nldall" data-act="nldall">Put everything back to the original design</button>
  </div><div class="nldpv">
    <div class="nldtabs">${[['issue', 'Weekly email'], ['confirm', 'Confirmation email'], ['signup', 'Signup page']].map(([v, l]) => `<button class="tag${nldTab === v ? ' on' : ''}" data-act="nldtab" data-v="${v}">${l}</button>`).join('')}</div>
    <iframe id="nldPv" class="nlpv" sandbox="allow-same-origin allow-popups" title="Preview"></iframe><div id="nldSign" class="nldsign" hidden></div>
  </div></div>`;
  $('nldPv').addEventListener('load', () => { const d = $('nldPv').contentDocument; if (d) $('nldPv').style.height = d.documentElement.scrollHeight + 'px'; });
  nldStatus(); nldPreview(true);
}
// the issue shown in the preview: the one you're writing, with stand-in text where it's still empty
function nldSample() {
  const c = curIssue(), num = c ? c.num : Math.max(0, ...issues().map(i => i.num)) + 1;
  const feat = (c && c.feat) || (() => { const x = ents().filter(e => e.is_public && e.num).sort((a, b) => b.start.localeCompare(a.start))[0]; return x ? {id: x.id, show: ['title', ...(x.pvShow || PV_DEFAULT)], order: x.pvOrder || orderOf(x)} : null; })();
  return {...(c || {num, status: 'draft', sendAt: nextMonday().toISOString()}), feat, intro: (c && c.intro) || '<p>Your intro blurb for the week goes here. (Stand-in text, just for this preview.)</p>'};
}
function nldPreview(now) {
  clearTimeout(nldT);
  nldT = setTimeout(() => {
    if (!$('nldPv')) return;
    $('nldPv').hidden = nldTab === 'signup'; $('nldSign').hidden = nldTab !== 'signup';
    if (nldTab === 'signup') $('nldSign').innerHTML = nlSignup(nld, '', true) + `<p class="mute nldnote">After signing up: “${esc(nld.signupCheck)}” · After confirming: “${esc(nld.signupDone)}”</p>`;
    else $('nldPv').srcdoc = nldTab === 'confirm' ? nlConfirm(nld).html.replace('{{LINK}}', '#') : buildEmail(nldSample(), nld).html;
  }, now ? 0 : 200);
}
// only what differs from the original gets saved
const nldDiff = () => Object.fromEntries(Object.keys(NL_DEFAULT).filter(k => !nldSame(k)).map(k => [k, nld[k]]));
function nldStatus() {
  if (!$('nldState')) return;
  const changed = JSON.stringify(nldDiff()) !== JSON.stringify(Object.fromEntries(Object.entries(settings().nlDesign || {}).filter(([k]) => k in NL_DEFAULT)));
  $('nldState').textContent = changed ? 'Unsaved changes' : 'Saved';
}
document.addEventListener('input', ev => {
  const t = ev.target, k = t.dataset && t.dataset.nld; if (!k || !nld) return;
  nld[k] = t.type === 'checkbox' ? t.checked : t.type === 'number' ? Math.max(8, Math.min(72, +t.value || NL_DEFAULT[k])) : k === 'cols' ? +t.value : t.value;
  t.closest('.nldrow').querySelector('.nldr').hidden = nldSame(k);
  nldStatus(); nldPreview();
});
document.addEventListener('click', ev => {
  const b = ev.target.closest('[data-act^="nld"]'); if (!b || !nld) return;
  const a = b.dataset.act, v = b.dataset.v;
  if (a === 'nldtab') { nldTab = v; document.querySelectorAll('.nldtabs .tag').forEach(x => x.classList.toggle('on', x.dataset.v === v)); nldPreview(true); }
  else if (a === 'nldreset') { nld[v] = NL_DEFAULT[v]; const row = b.closest('.nldrow'), f = NL_FORM.flatMap(g => g[1]).find(x => x[0] === v); row.outerHTML = nldField(f); nldStatus(); nldPreview(); }
  else if (a === 'nldall') { if (!confirm('Put every color, font and word back to the original design? (Nothing is saved until you press Save.)')) return; const open = [...document.querySelectorAll('.nldg')].map(x => x.open); buildDesign({...NL_DEFAULT}); document.querySelectorAll('.nldg').forEach((x, i) => x.open = open[i]); }
  else if (a === 'nldsave') nlBusy(b, 'Saving…', async () => {
    const d = nlD(nldDiff());   // also fills any must-have word you left blank with the original
    if (await saveSettings({nlDesign: nldDiff(), nlConfirm: nlConfirm(d)})) { nlView = 'design'; flash('Design saved. The next emails will use it.'); }
  });
});
