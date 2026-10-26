/* THE NEWSLETTER: "Your Weekly Dose of Jawan".
   /newsletter        the signup page (anyone). The email goes to Resend via /api/subscribe; they get a "click to confirm" email.
   /newsletter/write  the composer (you only): intro blurb, then the EXPs / blog posts you pick, in your order, each drawn as an
                      email card with its own look. "Schedule" hands the finished email to Resend, which sends it.
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
  tint: true, summary: true, rules: true, caps: true,
  subject: 'Your Weekly Dose of Jawan - Issue {n}',
  preheader: '{intro}',
  kicker: 'Issue {n} · {date}',
  title: 'Your Weekly Dose of Jawan',
  expHeading: 'Jawan Experienced {count} {Things} This Week',
  expSummary: '+{exp} EXP · {time} · Quality of Life {qol}',
  quiet: 'A quiet week.',
  readMore: 'Read it on jawansb.com →',   // under a card that shows its whole description
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
/* EMAIL CARDS are their own thing, separate from the website's preview cards: each item in an issue keeps its own email look
   {id, show, order, img, imgH, c, h, full}: which parts show and in what order, which photo and how tall, how wide (c = columns
   out of 6), how tall the card is (h, or automatic), and whether the description is shown whole with its formatting.
   A new item starts from its website preview card's settings, then the two go their own ways. */
const NL_W = 568, NL_GAP = 8, NL_COLS = 6;   // the email's width, the space between cards, and how many columns it's split into
const nlSpanW = c => Math.round(c * (NL_W - (NL_COLS - 1) * NL_GAP) / NL_COLS + (c - 1) * NL_GAP);   // a card's width in pixels
const NL_WIDTHS = {2: 'One-third', 3: 'Half', 4: 'Two-thirds', 5: 'Five-sixths', 6: 'Full'};
const nlNewItem = x => ({id: x.id, show: [...new Set(['title', ...(x.pvShow || PV_DEFAULT)])], order: [...(x.pvOrder || orderOf(x))], img: x.pvImg || null, imgH: null, c: 3, h: null, full: false});
// edit = drawn in the email-look editor: ⠿ handles on the parts, a corner to size the card and one to size the photo
function nlCard(x, o, d, edit) {
  const ent = !x.kind, tbg = ent && d.tint ? tintBg(x) : null, bg = tbg || d.card, fg = tbg ? ink(tbg) : d.cardInk, mute = blend(bg, fg, .65), url = itemUrl(x);
  const S = nlFont(d.smallFont), B = nlFont(d.bodyFont), ss = d.smallSize;
  const show = o.show || PV_DEFAULT, order = o.order || orderOf(x), full = !!o.full;
  const small = `font:${ss}px/1.5 ${S};color:${mute};margin:0 0 6px`;
  const pic = (() => {
    const l = picsOf(x), p = l.find(q => q.key === o.img) || l[0]; if (!p) return '';
    const img = o.imgH ? `<img src="${esc(p.src)}" alt="" height="${o.imgH}" style="display:block;height:${o.imgH}px;width:auto;max-width:100%;border:0;margin:6px 0">`
      : `<img src="${esc(p.src)}" alt="" width="100%" style="display:block;width:100%;height:auto;border:0;margin:6px 0">`;
    return edit ? `<span class="nlrz">${img}<i class="nlrzh" title="Drag to size the photo"></i></span>` : img;
  })();
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
  const inner = order.filter(k => show.includes(k) && parts[k]).map(k => edit ? `<div class="pp" data-k="${k}"><span class="ppg" title="Drag to move">⠿</span>${parts[k]}</div>` : parts[k]).join('');
  const more = full && d.readMore ? `<div style="font:${ss}px ${S};margin-top:8px"><a href="${url}" style="color:${fg}">${esc(d.readMore)}</a></div>` : '';
  // h = the card's whole height; email boxes measure height inside the padding (14px top and bottom) and border, so take those off
  const box = `background:${bg};color:${fg};border:1px solid ${d.cardLine};padding:14px 16px${o.h ? `;height:${o.h - 30}px;overflow:hidden` : ''}`;
  if (edit) return `<div class="nlecard" style="${box};width:${nlSpanW(o.c || 3) - 34}px">${inner}${more}<i class="nlcz" title="Drag to size the card"></i></div>`;
  // a short card is one big link to the post; a card with the whole description has links inside it, so it gets a "read it" link instead
  return full ? `<div class="nlbox" style="${box}">${inner}${more}</div>` : `<a class="nlbox" href="${url}" style="display:block;text-decoration:none;color:${fg};${box}">${inner}</a>`;
}
// the cards side by side, each at its own width, wrapping to a new row when the next one doesn't fit (one per row on phones)
function nlGrid(list, d) {
  const cs = list.map(({o}) => Math.min(NL_COLS, Math.max(2, o.c || 3)));
  let used = 0;
  return `<div style="font-size:0;line-height:0">${list.map(({x, o}, i) => {
    if (used + cs[i] > NL_COLS) used = 0;
    used += cs[i];
    const end = i === list.length - 1 || used + cs[i + 1] > NL_COLS;   // last one in its row: no space after it
    return `<div class="nlcol" style="display:inline-block;vertical-align:top;width:${nlSpanW(cs[i])}px;max-width:100%;margin:0 ${end ? 0 : NL_GAP}px 10px 0;font-size:16px;line-height:1.45;text-align:left">${nlCard(x, o, d)}</div>`;
  }).join('')}</div>`;
}
// an issue's items, in order (issues saved before this had a single "feat" instead), skipping anything since deleted or made private
const nlItemsOf = iss => iss.items || (iss.feat ? [{...iss.feat, img: iss.feat.img || null, c: 6, h: null}] : []);
const nlShown = iss => nlItemsOf(iss).map(o => ({o, x: all.find(y => y.id === o.id)})).filter(({x}) => x && x.is_public && x.num);
const nlH = (t, sub, d) => `<div style="margin:30px 0 12px;${d.rules ? `border-top:1px solid ${d.line};padding-top:18px` : ''}">${t ? `<div style="font:${d.headSize}px/1.25 ${nlFont(d.headFont)}">${esc(t)}</div>` : ''}${sub ? `<div style="font:${d.smallSize}px ${nlFont(d.smallFont)};color:${d.mute};margin-top:4px">${esc(sub)}</div>` : ''}</div>`;
const nlLabel = (t, d, m) => t ? `<div style="font:${d.smallSize - 1}px ${nlFont(d.smallFont)};letter-spacing:2px;color:${d.mute};${d.caps ? 'text-transform:uppercase;' : ''}margin:${m}">${esc(t)}</div>` : '';
function buildEmail(iss, d = nlD()) {
  const w = nlWindow(iss), list = nlShown(iss), n = w.exps.length, sum = sumMin(w.exps);   // the heading counts every new public EXP, even ones left out
  const v = {n: iss.num, count: n, things: n === 1 ? 'thing' : 'things', Things: n === 1 ? 'Thing' : 'Things', exp: sum.toLocaleString(), time: dur(sum), qol: qolOf(w.exps),
    date: new Date(iss.sendAt).toLocaleDateString('en-US', {weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'}), intro: nlShort(nlPlain(iss.intro))};
  const F = t => nlFill(t, v).trim(), subject = F(d.subject), intro = nlRich(iss.intro, null, d.link);
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>${esc(subject)}</title>${nlFontLink(d)}
<style>@media (max-width:620px){.nlcol{width:100%!important;margin-right:0!important}.nlbox{height:auto!important}}</style></head>
<body style="margin:0;padding:0;background:${d.bg}">
<div style="display:none;max-height:0;overflow:hidden">${esc(F(d.preheader) || F(d.expHeading) || subject)}</div>
<div style="background:${d.bg};padding:28px 0 36px"><div style="max-width:568px;margin:0 auto;padding:0 16px;color:${d.ink};font:${d.bodySize}px/1.55 ${nlFont(d.bodyFont)}">
${nlLabel(F(d.kicker), d, '0')}
${F(d.title) ? `<div style="font:${d.titleSize}px/1.15 ${nlFont(d.titleFont)};margin:6px 0 18px"><a href="${NL_SITE}/exp" style="color:${d.ink};text-decoration:none">${esc(F(d.title))}</a></div>` : '<div style="height:12px"></div>'}
${intro ? `<div style="margin:0 0 8px">${intro}</div>` : ''}
${nlH(F(d.expHeading), n && d.summary ? F(d.expSummary) : '', d)}
${list.length ? nlGrid(list, d) : n || !F(d.quiet) ? '' : `<p style="margin:0;color:${d.mute}">${esc(F(d.quiet))}</p>`}
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
  nl = iss ? JSON.parse(JSON.stringify(iss)) : {id, kind: 'issue', num: +id.split('-')[1], intro: '', sendAt: nextMonday().toISOString(), status: 'draft'};
  nl.items = nlItemsOf(nl); delete nl.feat; nlOpen = null;
  $('pgNews').innerHTML = `<button class="link" data-act="go" data-v="newsletter">← Signup page</button> <button class="link" data-act="go" data-v="newsletter/design">Change the design →</button>
    <h2>Issue ${nl.num}</h2><p class="mute" id="nlState"></p>
    <label>Subject</label><p class="nlsubj" id="nlSubj"></p>
    <label>Send time</label><input type="datetime-local" id="nlAt" value="${loc(new Date(nl.sendAt))}">
    <label>Intro blurb</label><div id="nlEd"></div>
    <label>In this email</label><p class="mute nlhint">Drag ⠿ to put them in any order. “Email look” changes how a card looks in the email only; the website keeps its own preview cards.</p>
    <div id="nlItems"></div>
    <label>Add to the email</label><div id="nlAdd"></div>
    <p class="mute" id="nlAuto"></p>
    <div class="btns nlbtns"><button class="go2" data-act="nlsave">SAVE DRAFT</button><button class="go2" data-act="nltest">SEND ME A TEST</button><button class="go" id="nlSched" data-act="nlsched">SCHEDULE</button></div>
    <button class="link" id="nlUn" data-act="nlunsched" hidden>Cancel the scheduled send</button>
    <label>Preview</label><iframe id="nlPv" class="nlpv" sandbox="allow-same-origin allow-popups" title="Email preview"></iframe>`;
  nlQ = window.Quill ? new Quill('#nlEd', {theme: 'snow', modules: {toolbar: [
    [{font: [false, 'serif', 'typewriter', 'display', 'mono']}, {size: ['small', false, 'large', 'huge']}],
    ['bold', 'italic', 'underline', 'strike'], [{list: 'ordered'}, {list: 'bullet'}], ['blockquote', 'link'], ['clean']]}}) : null;
  if (nlQ) { if (nl.intro) nlQ.clipboard.dangerouslyPasteHTML(nl.intro); nlQ.history.clear(); nlQ.on('text-change', () => { nl.intro = nlQ.getLength() > 1 ? nlQ.root.innerHTML : ''; nlPreview(); }); }
  $('nlPv').addEventListener('load', () => { const d = $('nlPv').contentDocument; if (d) $('nlPv').style.height = d.documentElement.scrollHeight + 'px'; });
  nlDrawItems(); nlStatus(); nlPreview();
}
/* --- WHAT'S IN THE EMAIL: one list of EXPs, blog posts (and, once there are some, Strictly Business projects), in your order.
       Nothing goes in unless you add it. New things since the last issue are offered first. --- */
let nlOpen = null;   // the item whose email look is open for editing
const nlKind = x => x.kind === 'post' ? 'Blog' : x.kind === 'project' ? 'Project' : 'EXP';
const nlNewest = (a, b) => (loggedAt(b) || '').localeCompare(loggedAt(a) || '');
const nlItem = id => nl.items.find(o => o.id === id);
function nlDrawItems() {
  const list = nlShown(nl), inIds = new Set(nl.items.map(o => o.id)), w = nlWindow(nl), fresh = [...w.exps, ...w.blogs].sort(nlNewest);
  const day = x => new Date(loggedAt(x)).toLocaleDateString([], {month: 'short', day: 'numeric'});
  $('nlItems').innerHTML = list.length ? list.map(({x}) => `<div class="nlitw" data-id="${x.id}"><div class="nlit${nlOpen === x.id ? ' on' : ''}"><span class="nlgrip" title="Drag to move">⠿</span><span class="nlkind">${nlKind(x)}</span><span class="nlt">${esc(x.title)}</span>
      <button class="link" data-act="nllook" data-v="${x.id}">${nlOpen === x.id ? 'Done' : 'Email look'}</button><button class="ib" data-act="nlrm" data-v="${x.id}" title="Take it out of the email" aria-label="Take it out">✕</button></div>
      ${nlOpen === x.id ? '<div class="nllook" id="nlLook"></div>' : ''}</div>`).join('')
    : '<p class="mute nlnone">Nothing in this email yet. Add things below.</p>';
  if (nlOpen) nlDrawLook();
  const left = fresh.filter(x => !inIds.has(x.id));
  const older = l => l.filter(x => x.is_public && x.num && !inIds.has(x.id) && !fresh.includes(x)).sort(nlNewest).map(x => `<option value="${x.id}">${nlKind(x)} ${x.num} · ${esc(x.title)}</option>`).join('');
  $('nlAdd').innerHTML = `<p class="mute nlsub">New since the last issue</p>` + (left.length ? left.map(x => `<div class="nladd"><span class="nlkind">${nlKind(x)}</span><span class="nlt">${esc(x.title)}</span><span class="mute">${day(x)}</span><button class="link" data-act="nladd" data-v="${x.id}">+ Add</button></div>`).join('')
      + (left.length > 1 ? `<button class="link nladdall" data-act="nladdall">+ Add all ${left.length}</button>` : '') : `<p class="mute">${fresh.length ? 'All added.' : 'Nothing new yet.'}</p>`)
    + `<select id="nlOlder"><option value="">Add something older…</option><optgroup label="EXP">${older(ents())}</optgroup><optgroup label="Blog">${older(posts())}</optgroup><optgroup label="Strictly Business"><option disabled>No projects yet</option></optgroup></select>`;
}
// THE EMAIL-LOOK EDITOR: works like "Edit preview card" on the site, but only for this email
function nlDrawLook() {
  const o = nlItem(nlOpen), x = all.find(y => y.id === nlOpen), box = $('nlLook'); if (!o || !x || !box) return;
  const d = nlD(), pics = picsOf(x), cur = (pics.find(p => p.key === o.img) || pics[0] || {}).key;
  box.innerHTML = `<p class="mute">Tick what the card shows and drag ⠿ on the card to put things in order. Drag the card’s bottom-right corner to size the card, and the photo’s corner to size the photo.</p>
    <div class="pvparts">${(x.kind === 'post' ? NL_BLOG_PARTS : PV_PARTS).map(([k, l]) => `<label class="chk"><input type="checkbox" data-nlpart="${k}"${o.show.includes(k) ? ' checked' : ''}> ${l}</label>`).join('')}</div>
    <label class="chk"><input type="checkbox" data-nlfull${o.full ? ' checked' : ''}> Whole description, with its formatting (otherwise a short taste)</label>
    ${pics.length > 1 ? `<div class="nlpics"><span class="mute">Photo:</span>${pics.map(p => `<button class="nlpic${cur === p.key ? ' on' : ''}" data-act="nlimg" data-v="${esc(p.key)}"><img src="${esc(p.src)}" alt=""></button>`).join('')}</div>` : ''}
    <div class="nlstage" style="background:${d.bg}"><div class="nlrow" style="width:${NL_W}px">${nlCard(x, o, d, true)}</div></div>
    <div class="pvfoot"><span class="mute" id="nlSize"></span><button class="link" data-act="nlauto">Automatic size</button></div>`;
  nlSizeText(o);
}
const nlSizeText = o => { $('nlSize').textContent = `${NL_WIDTHS[o.c || 3]} width · ${o.h ? o.h + 'px tall' : 'automatic height'} · ${o.imgH ? 'photo ' + o.imgH + 'px tall' : 'photo fills the width'}`; };
function nlStatus() {
  if (!$('nlState')) return;
  const w = nlWindow(nl), sch = nl.status === 'scheduled', d = t => new Date(t).toLocaleString([], {weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'});
  $('nlState').textContent = sch ? `Scheduled: goes out ${d(nl.sendAt)}. Change anything, then press Reschedule.` : `Draft. “New” means posted since ${d(w.from)}.`;
  $('nlAuto').textContent = `${nlShown(nl).length} in the email. The heading counts all ${w.exps.length} new public EXP${w.exps.length === 1 ? '' : 's'}, including any you leave out.`;
  $('nlSubj').textContent = buildEmail(nl).subject;
  $('nlSched').textContent = sch ? 'RESCHEDULE WITH CHANGES' : 'SCHEDULE'; $('nlUn').hidden = !sch;
}
const nlPreview = () => { clearTimeout(nlPvT); nlPvT = setTimeout(() => { if ($('nlPv') && nl) $('nlPv').srcdoc = buildEmail(nl).html; }, 250); };
const nlChanged = () => { nlStatus(); nlPreview(); };
// the parts of the issue that get saved (nothing else ends up in Supabase)
const nlRecord = () => ({id: nl.id, kind: 'issue', is_public: false, num: nl.num, intro: nl.intro, items: nl.items, sendAt: nl.sendAt, status: nl.status, until: nl.until, bid: nl.bid, saved: new Date().toISOString()});
/* --- DRAGGING in the composer: ⠿ on a list row moves it; on the email-look card, ⠿ moves a part, the card's corner sizes the card,
       the photo's corner sizes the photo. Things move on screen while you drag and are saved into the issue when you let go. --- */
let nlDrag = null;
document.addEventListener('pointerdown', ev => {
  const t = ev.target; if (!nl || !t.closest || !t.closest('#pgNews') || page !== 'write') return;
  const card = t.closest('.nlecard');
  if (t.closest('.nlgrip')) nlDrag = {k: 'item', el: t.closest('.nlitw')};
  else if (t.closest('.ppg') && card) nlDrag = {k: 'part', el: t.closest('.pp'), card};
  else if (t.classList.contains('nlcz')) nlDrag = {k: 'card', card, x0: ev.clientX, y0: ev.clientY, w0: card.offsetWidth, h0: card.offsetHeight};
  else if (t.classList.contains('nlrzh')) { const img = t.previousElementSibling; nlDrag = {k: 'pic', img, y0: ev.clientY, h0: img.offsetHeight}; }
  else return;
  ev.preventDefault(); $('pgNews').setPointerCapture(ev.pointerId);
  if (nlDrag.el) nlDrag.el.classList.add('dragging');
});
document.addEventListener('pointermove', ev => {
  const g = nlDrag; if (!g) return;
  if (g.k === 'item' || g.k === 'part') {   // the first one whose middle is below the pointer: the dragged one goes just before it
    const box = g.k === 'item' ? $('nlItems') : g.card, sibs = [...box.querySelectorAll(g.k === 'item' ? ':scope > .nlitw' : ':scope > .pp')];
    const next = sibs.find(x => x !== g.el && ev.clientY < x.getBoundingClientRect().top + x.offsetHeight / 2);
    if (next) { if (g.el.nextElementSibling !== next) box.insertBefore(g.el, next); } else if (sibs.at(-1) !== g.el) sibs.at(-1).after(g.el);
  } else if (g.k === 'card') {   // snap the width to the email's columns, the height to 10px steps
    const want = g.w0 + ev.clientX - g.x0;
    g.c = [2, 3, 4, 5, 6].reduce((a, c) => Math.abs(nlSpanW(c) - want) < Math.abs(nlSpanW(a) - want) ? c : a, 3);
    g.h = Math.max(60, Math.round((g.h0 + ev.clientY - g.y0) / 10) * 10);
    g.card.style.width = (nlSpanW(g.c) - 34) + 'px'; g.card.style.height = (g.h - 30) + 'px'; g.card.style.overflow = 'hidden';
    $('nlSize').textContent = `${NL_WIDTHS[g.c]} width · ${g.h}px tall`;
  } else if (g.k === 'pic') {
    g.h = Math.max(40, Math.min(600, Math.round(g.h0 + ev.clientY - g.y0)));
    g.img.style.height = g.h + 'px'; g.img.style.width = 'auto';
  }
});
const nlDragEnd = () => {
  const g = nlDrag; if (!g) return; nlDrag = null;
  if (g.el) g.el.classList.remove('dragging');
  if (g.k === 'item') { const ids = [...$('nlItems').querySelectorAll(':scope > .nlitw')].map(x => x.dataset.id); nl.items.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id)); }
  else {
    const o = nlItem(nlOpen); if (!o) return;
    if (g.k === 'part') { const ks = [...g.card.querySelectorAll(':scope > .pp')].map(x => x.dataset.k); o.order = [...ks, ...o.order.filter(k => !ks.includes(k))]; }
    else if (g.k === 'card' && g.c) { o.c = g.c; o.h = g.h; }
    else if (g.k === 'pic' && g.h) o.imgH = g.h;
    nlDrawLook();
  }
  nlChanged();
};
document.addEventListener('pointerup', nlDragEnd); document.addEventListener('pointercancel', nlDragEnd);
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
  const add = x => { if (x && !nlItem(x.id)) nl.items.push(nlNewItem(x)); };
  if (a === 'nladd') { add(all.find(x => x.id === v)); nlDrawItems(); nlChanged(); }
  else if (a === 'nladdall') { const w = nlWindow(nl); [...w.exps, ...w.blogs].sort(nlNewest).forEach(add); nlDrawItems(); nlChanged(); }
  else if (a === 'nlrm') { nl.items = nl.items.filter(o => o.id !== v); if (nlOpen === v) nlOpen = null; nlDrawItems(); nlChanged(); }
  else if (a === 'nllook') { nlOpen = nlOpen === v ? null : v; nlDrawItems(); }
  else if (a === 'nlimg') { nlItem(nlOpen).img = v; nlDrawLook(); nlPreview(); }
  else if (a === 'nlauto') { const o = nlItem(nlOpen); o.c = 3; o.h = null; nlDrawLook(); nlPreview(); }
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
document.addEventListener('click', ev => { if (ev.target.closest && ev.target.closest('.nlstage') && ev.target.closest('a')) ev.preventDefault(); }, true);
document.addEventListener('change', ev => {
  const t = ev.target; if (!nl || !t.closest('#pgNews')) return;
  if (t.id === 'nlOlder') { const x = all.find(y => y.id === t.value); if (x && !nlItem(x.id)) nl.items.push(nlNewItem(x)); nlDrawItems(); nlStatus(); }
  else if (t.dataset.nlpart) { const o = nlItem(nlOpen), k = t.dataset.nlpart; o.show = t.checked ? [...new Set([...o.show, k])] : o.show.filter(y => y !== k); if (!o.order.includes(k)) o.order.push(k); nlDrawLook(); }
  else if ('nlfull' in t.dataset) { nlItem(nlOpen).full = t.checked; nlDrawLook(); }
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
  ['Layout', [['tint', 'Tint EXP cards with their Type tag color', 'b'], ['summary', 'Show the EXP / QoL line under the heading', 'b'],
    ['rules', 'Lines between sections', 'b'], ['caps', 'Small labels in CAPITALS', 'b']]],
  ['Weekly email words', [['subject', 'Subject line'], ['preheader', 'Preview line (the gray text inboxes show after the subject)'], ['kicker', 'Small line above the title'], ['title', 'Big title'],
    ['expHeading', 'Heading above the cards'], ['expSummary', 'Summary line under it'], ['quiet', 'When there are no new EXPs'],
    ['readMore', 'Link under a card showing its whole description'], ['footer', 'Footer', 't'], ['unsub', 'Unsubscribe link']]],
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
  const base = {...(c || {num, status: 'draft', sendAt: nextMonday().toISOString()})}; base.items = nlItemsOf(base);
  if (!nlShown(base).length) base.items = ents().filter(e => e.is_public && e.num).sort((a, b) => b.start.localeCompare(a.start)).slice(0, 5).map((x, i) => ({...nlNewItem(x), c: i ? 3 : 6, full: !i}));
  base.intro = base.intro || '<p>Your intro blurb for the week goes here. (Stand-in text, just for this preview.)</p>';
  return base;
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
  nld[k] = t.type === 'checkbox' ? t.checked : t.type === 'number' ? Math.max(8, Math.min(72, +t.value || NL_DEFAULT[k])) : t.value;
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
