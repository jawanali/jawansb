/* The behind-the-scenes part of jawansb.com. Every page and file is served straight from public/ as before;
   only addresses starting with /api/ come here. This is the one place the Resend key (the RESEND_API_KEY secret
   in Cloudflare) is used, so it never reaches anyone's browser.

   /api/subscribe   someone typed their email on /newsletter: send them a "click to confirm" email
   /api/confirm     they clicked it: add them to the newsletter list in Resend
   /api/test        (you only) send this issue to your own inbox
   /api/schedule    (you only) hand this issue to Resend to send to everyone at the chosen time
   /api/unschedule  (you only) cancel a scheduled issue
   /api/health      says whether the key is set up (never shows the key) */

const OWNER = 'jawanali@gmail.com';
const FROM_ADDR = 'newsletter@jawansb.com';
const LIST = 'Newsletter';   // the name of the subscriber list (a "segment") in Resend; made automatically if missing
const SB_URL = 'https://kbrizeqpoiqgimewxixw.supabase.co', SB_KEY = 'sb_publishable_sGD5U1QpwoL4Aa4zO28c4w_0IjhUAJm';
const CONFIRM_DAYS = 7;   // how long a confirm link keeps working

// your design (saved at /newsletter/design) lives in the public Settings record: the sender name and the confirm email come from it
async function design() {
  const r = await fetch(SB_URL + '/rest/v1/items?id=eq.settings&select=data', {headers: {apikey: SB_KEY}}).catch(() => null);
  const l = r && r.ok ? await r.json().catch(() => []) : [];
  return (l[0] && l[0].data) || {};
}
const fromOf = st => { const n = String((st.nlDesign || {}).fromName || '').replace(/["<>\r\n\\]/g, '').trim().slice(0, 60) || 'Jawan'; return `"${n}" <${FROM_ADDR}>`; };
const json = (o, status = 200) => new Response(JSON.stringify(o), {status, headers: {'content-type': 'application/json'}});
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const okEmail = e => typeof e === 'string' && e.length <= 254 && /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(e);

// talk to Resend. FAKE_SEND=1 (only in the local test copy) logs instead of sending anything
async function resend(env, method, path, body) {
  if (env.FAKE_SEND === '1') { console.log('[fake resend]', method, path, JSON.stringify(body || {}).slice(0, 300)); return {id: 'fake-' + Date.now(), data: [{id: 'fake-list', name: LIST}]}; }
  if (!env.RESEND_API_KEY) throw new Error('The RESEND_API_KEY secret is not set in Cloudflare.');
  const r = await fetch('https://api.resend.com' + path, {method, headers: {authorization: 'Bearer ' + env.RESEND_API_KEY, 'content-type': 'application/json'}, body: body ? JSON.stringify(body) : undefined});
  const o = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(o.message || 'Resend said ' + r.status); e.status = r.status; throw e; }
  return o;
}
// the subscriber list's id: the segment called "Newsletter", made the first time it's needed
let listId = null;
async function list(env) {
  if (listId) return listId;
  const l = (await resend(env, 'GET', '/segments')).data || [];
  const hit = l.find(s => s.name === LIST);
  listId = hit ? hit.id : (await resend(env, 'POST', '/segments', {name: LIST})).id;
  return listId;
}

// a confirm link carries a signature, so nobody can add an address without getting the email first
async function sign(env, text) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode('confirm:' + (env.RESEND_API_KEY || 'dev')), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  const s = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(text));
  return [...new Uint8Array(s)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// you only: the request must carry your Supabase login, and it must be your account
async function isOwner(req) {
  const auth = req.headers.get('authorization') || '';
  if (!auth.startsWith('Bearer ')) return false;
  const r = await fetch(SB_URL + '/auth/v1/user', {headers: {apikey: SB_KEY, authorization: auth}});
  if (!r.ok) return false;
  const u = await r.json();
  return (u.email || '').toLowerCase() === OWNER;
}

const page = (title, msg) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<body style="margin:0;background:#313E50;color:#cae2ff;font:17px/1.6 Georgia,serif;padding:60px 20px;text-align:center"><h1 style="font-weight:400">${esc(title)}</h1><p>${msg}</p><p><a style="color:#cae2ff" href="/exp">Go to jawansb.com →</a></p></body>`;

// the original confirm email, used until you save a design
const confirmEmail = link => `<div style="background:#313E50;padding:40px 16px;font-family:Georgia,'Times New Roman',serif;color:#cae2ff">
<div style="max-width:520px;margin:0 auto;background:#3a435e;padding:28px 28px 22px;border:1px solid #4a5573">
<h1 style="margin:0 0 14px;font-weight:400;font-size:24px">Your Weekly Dose of Jawan</h1>
<p style="margin:0 0 18px;line-height:1.6">Someone (hopefully you) asked to get my newsletter at this address. Click below to confirm, and the next issue will land in your inbox on Monday.</p>
<p style="margin:0 0 20px"><a href="${esc(link)}" style="display:inline-block;background:#cae2ff;color:#313E50;text-decoration:none;padding:10px 20px;font-family:Arial,sans-serif;font-size:14px;letter-spacing:1px">CONFIRM</a></p>
<p style="margin:0;font-size:13px;color:#8d9aab">Didn't ask for this? Ignore this email and you won't hear from me.</p>
</div></div>`;

async function api(req, env, u) {
  const p = u.pathname.slice(5), body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};

  if (p === 'health') return json({ok: true, key: !!env.RESEND_API_KEY, fake: env.FAKE_SEND === '1'});

  if (p === 'subscribe' && req.method === 'POST') {
    const email = String(body.email || '').trim().toLowerCase();
    if (body.website) return json({ok: true});   // the hidden box only robots fill in
    if (!okEmail(email)) return json({error: 'That doesn’t look like an email address.'}, 400);
    const exp = Date.now() + CONFIRM_DAYS * 864e5;
    const link = `${u.origin}/api/confirm?e=${encodeURIComponent(email)}&x=${exp}&s=${await sign(env, email + '|' + exp)}`;
    const st = await design(), c = st.nlConfirm || {}, fill = t => String(t).replaceAll('{{LINK}}', link);
    await resend(env, 'POST', '/emails', {from: fromOf(st), to: [email], reply_to: OWNER, subject: c.subject || 'Confirm: Your Weekly Dose of Jawan',
      html: c.html ? String(c.html).replaceAll('{{LINK}}', esc(link)) : confirmEmail(link),
      text: c.text ? fill(c.text) : `Someone (hopefully you) asked to get my newsletter at this address. Confirm here: ${link}\n\nDidn't ask for this? Ignore this email.`});
    return json({ok: true});
  }

  if (p === 'confirm') {
    const email = (u.searchParams.get('e') || '').toLowerCase(), exp = +u.searchParams.get('x') || 0, s = u.searchParams.get('s') || '';
    const html = (t, m, st = 200) => new Response(page(t, m), {status: st, headers: {'content-type': 'text/html; charset=utf-8'}});
    if (!okEmail(email) || s !== await sign(env, email + '|' + exp)) return html('That link didn’t work', 'Try signing up again at <a style="color:#cae2ff" href="/newsletter">jawansb.com/newsletter</a>.', 400);
    if (Date.now() > exp) return html('That link expired', 'Sign up again at <a style="color:#cae2ff" href="/newsletter">jawansb.com/newsletter</a> and you’ll get a fresh one.', 400);
    const seg = await list(env);
    try { await resend(env, 'POST', '/contacts', {email, unsubscribed: false, segments: [{id: seg}]}); }
    catch (e) {   // already a contact (e.g. they unsubscribed once and came back): switch them back on and put them on the list
      if (!e.status || e.status >= 500) throw e;
      await resend(env, 'PATCH', '/contacts/' + encodeURIComponent(email), {unsubscribed: false});
      const c = await resend(env, 'GET', '/contacts/' + encodeURIComponent(email));
      await resend(env, 'POST', `/contacts/${c.id}/segments/${seg}`).catch(() => {});   // already on it: fine
    }
    return Response.redirect(u.origin + '/newsletter?joined=1', 303);
  }

  // everything below is for you only
  if (!['test', 'schedule', 'unschedule'].includes(p) || req.method !== 'POST') return json({error: 'Not found'}, 404);
  if (!await isOwner(req)) return json({error: 'Log in first.'}, 401);
  const {subject, html} = body;
  if (p !== 'unschedule' && (!subject || !html)) return json({error: 'Nothing to send.'}, 400);

  if (p === 'test') {
    await resend(env, 'POST', '/emails', {from: fromOf(await design()), to: [OWNER], subject: '[Test] ' + subject, html: html.replaceAll('{{{RESEND_UNSUBSCRIBE_URL}}}', '#')});
    return json({ok: true});
  }
  if (p === 'unschedule' || body.replace) {   // cancel the old scheduled copy (rescheduling with changes = cancel, then schedule again)
    const id = p === 'unschedule' ? body.id : body.replace;
    if (id) await resend(env, 'DELETE', '/broadcasts/' + encodeURIComponent(id)).catch(e => { if (p === 'unschedule' && e.status !== 404) throw e; });
    if (p === 'unschedule') return json({ok: true});
  }
  const at = new Date(body.at);
  if (isNaN(at) || at < Date.now() + 60e3) return json({error: 'Pick a send time in the future.'}, 400);
  const b = await resend(env, 'POST', '/broadcasts', {segment_id: await list(env), from: fromOf(await design()), reply_to: OWNER, subject, html, name: subject, send: true, scheduled_at: at.toISOString()});
  return json({ok: true, id: b.id});
}

export default {
  async fetch(req, env) {
    const u = new URL(req.url);
    if (!u.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
    try { return await api(req, env, u); }
    catch (e) { console.log('api error', e.message); return json({error: e.message}, 500); }
  }
};
