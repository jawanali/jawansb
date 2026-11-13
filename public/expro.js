/* EXPRO (/expro): your private planner for serious life stuff. Only you can see it (every row it saves is private).
   This file loads before app.js and only defines things; app.js calls renderExpro() from render().

   HOW IT FITS TOGETHER
   - A TASK has a title, a domain (Work, Money…), a time estimate in minutes and an effort from 1 to 5.
     Tasks wait in the TRAY (the top row) until you drag them onto a day's CALENDAR.
   - On the calendar, up and down is time, and the Z axis (how far a block sticks out toward you) is effort.
     Drag a block to move it, drag its bottom edge to change its time, drag its corner handle to change its effort.
   - ENERGY works like time: a finite amount per day. A block costs effort × hours (an hour at effort 3 = 3 ⚡).
     Your budget comes from the morning check-in ("how full is the tank?", 1–5 → 8 ⚡ per level). It can go below zero; the meter turns red.
   - DONE asks how long it really took, how draining it really was, how it went and whether you enjoyed it.
     That's what the Domains tab adds up, so you can see where your estimates are off and what's bothering you.
   - EXP for a finished task = minutes it took × an effort bonus (effort 1 = ×1, up to effort 5 = ×2). It's added to your TOTAL EXP.
   - Unfinished tasks from past days go back to the tray by themselves. If you put the same task on the same weekday
     at about the same time 3 times, EXPRO offers to repeat it every week.

   SAVED AS (in the same Supabase "items" table as everything else, all private):
     task       {title, domain, est, effort, day, start, done:{min, effort, went, enjoy, day, at}, missed:[days], rep, created}
     day        id "day-YYYY-MM-DD": {date, wake, sleep, tank, budget, busy:[{id, label, start, len, effort}]}   (times are minutes after midnight)
     exprocfg   id "exprocfg": {domains, colors, depth, repeats:[…], noRepeat:[…]} */

const XP_DOMAINS = ['Work', 'Money', 'Health', 'Home', 'Admin', 'People', 'Family', 'Creative'];
const XP_PX = 1;            // calendar pixels per minute
const XP_SNAP = 15;         // blocks snap to quarter hours
const XP_TANK = 8;          // energy per tank level at check-in
const XP_LENS = [15, 30, 45, 60, 90, 120, 180, 240];
const XP_DOWS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
let xpDate = null, xpTab = 'day', xpSel = null, xpDoneForm = null, xpRange = 'week', xpDrag = null, xpDepthLive = null;
let xpRolled = '';
const xpRepMade = new Set();

/* --- small helpers --- */
const xpKey = d => { const z = new Date(d); z.setMinutes(z.getMinutes() - z.getTimezoneOffset()); return z.toISOString().slice(0, 10); };   // a date as YYYY-MM-DD, your time zone
const xpToday = () => xpKey(new Date());
const xpShift = (k, n) => { const d = new Date(k + 'T12:00'); d.setDate(d.getDate() + n); return xpKey(d); };
const xpDow = k => new Date(k + 'T12:00').getDay();
const xpId = p => p + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const xpTasks = () => all.filter(x => x.kind === 'task');
const xpCfg = () => all.find(x => x.id === 'exprocfg') || {id: 'exprocfg', kind: 'exprocfg'};
const xpDomains = () => xpCfg().domains || XP_DOMAINS;
const xpCol = d => (xpCfg().colors || {})[d] || auto('domain' + d);
const xpDepth = () => xpDepthLive ?? xpCfg().depth ?? 9;   // pixels the calendar's Z axis sticks out per effort level
const hm = s => { const [h, m] = String(s).split(':').map(Number); return h * 60 + (m || 0); };
const hmStr = m => { m = ((Math.round(m) % 1440) + 1440) % 1440; return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
const clock = m => { m = ((Math.round(m) % 1440) + 1440) % 1440; const h = Math.floor(m / 60), mm = m % 60; return (h % 12 || 12) + (mm ? ':' + String(mm).padStart(2, '0') : '') + (h < 12 ? 'am' : 'pm'); };
const sdur = m => (m < 0 ? '−' : '') + dur(Math.abs(Math.round(m)));
const num1 = n => (Math.round(n * 10) / 10).toString().replace('-', '−');
const xpCost = (min, eff) => min / 60 * eff;
const dots = e => '●'.repeat(e) + '○'.repeat(Math.max(0, 5 - e));
const xpSnap = m => Math.round(m / XP_SNAP) * XP_SNAP;
const xpExp1 = t => t.done ? Math.round(t.done.min * (1 + (t.done.effort - 1) / 4)) : 0;
const exproExp = () => xpTasks().reduce((a, t) => a + xpExp1(t), 0);   // app.js adds this to TOTAL EXP
// a task's size as it should be drawn: what really happened once it's done, the plan before that
const xpLen = t => t.done ? t.done.min : t.est;
const xpEff = t => t.done ? t.done.effort : t.effort;

/* --- a day's setup. A day you haven't touched borrows the waking hours of the latest day you did set up. --- */
function xpDay(k) {
  const d = all.find(x => x.id === 'day-' + k);
  if (d) return d;
  const prev = all.filter(x => x.kind === 'day' && x.date < k).sort((a, b) => b.date.localeCompare(a.date))[0];
  return {id: 'day-' + k, kind: 'day', date: k, wake: prev ? prev.wake : 7 * 60, sleep: prev ? prev.sleep : 23 * 60 + 30, tank: null, budget: null, busy: [], fresh: true};
}
const xpBudget = d => d.budget ?? (d.tank ?? 3) * XP_TANK;

/* --- saving: show the change at once, then store it (on failure, reload what's really saved) --- */
async function xpSave(l, msg) {
  l = [].concat(l).map(o => { const c = {...o}; delete c.fresh; return c; });
  l.forEach(o => { const i = all.findIndex(x => x.id === o.id); if (i < 0) all.push(o); else all[i] = o; });
  renderExpro();
  const {error} = await sb.from('items').upsert(l.map(row));
  if (error) { flash('Save failed: ' + error.message); load(); return false; }
  if (msg) flash(msg);
  return true;
}
async function xpDelete(id) {
  const t = all.find(x => x.id === id);
  all = all.filter(x => x.id !== id); if (xpSel === id) xpSel = null;
  if (t && t.rep) {   // deleting one copy of a repeating task: don't make it again for that day
    const c = xpCfg(), r = (c.repeats || []).find(x => x.id === t.rep);
    if (r) await xpSave({...c, repeats: c.repeats.map(x => x === r ? {...r, skip: [...(r.skip || []), t.day]} : x)});
  }
  renderExpro();
  const {error} = await sb.from('items').delete().eq('id', id);
  if (error) { flash('Delete failed: ' + error.message); load(); }
}
const xpSaveDay = patch => xpSave({...xpDay(xpDate), ...patch});
const xpSaveTask = (id, patch, msg) => { const t = all.find(x => x.id === id); return t && xpSave({...t, ...patch}, msg); };

/* --- chores that run when the page opens: roll unfinished tasks forward, make today's repeating tasks --- */
function xpChores() {
  const today = xpToday();
  if (xpRolled !== today) {
    xpRolled = today;
    const late = xpTasks().filter(t => !t.done && t.day && t.day < today);
    if (late.length) xpSave(late.map(t => ({...t, missed: [...(t.missed || []), t.day], day: null, start: null})),
      `Moved ${late.length} unfinished task${late.length > 1 ? 's' : ''} back to the tray`);
  }
  if (xpDate < today) return;   // only make repeats for today and later
  const make = (xpCfg().repeats || []).filter(r => r.dow === xpDow(xpDate) && !(r.skip || []).includes(xpDate) && !xpRepMade.has(r.id + xpDate)
    && !xpTasks().some(t => t.rep === r.id && (t.day === xpDate || (t.done && t.done.day === xpDate))));
  make.forEach(r => xpRepMade.add(r.id + xpDate));
  if (make.length) xpSave(make.map(r => ({id: xpId('t'), kind: 'task', is_public: false, title: r.title, domain: r.domain, est: r.est, effort: r.effort, day: xpDate, start: r.start, rep: r.id, created: new Date().toISOString()})));
}
// the same task on the same weekday at about the same time, 3 different weeks or more → offer to repeat it
function xpRepeatIdeas() {
  const c = xpCfg(), no = new Set(c.noRepeat || []), have = new Set((c.repeats || []).map(r => r.key)), m = {};
  xpTasks().filter(t => t.day && t.start != null && !t.rep).forEach(t => {
    const dow = xpDow(t.day), slot = Math.round(t.start / 30) * 30, k = t.title.trim().toLowerCase() + '|' + dow + '|' + slot;
    (m[k] = m[k] || {key: k, t, dow, slot, days: new Set()}).days.add(t.day);
  });
  return Object.values(m).filter(x => x.days.size >= 3 && !no.has(x.key) && !have.has(x.key));
}

/* --- the blocks on the viewed day's calendar: busy blocks + scheduled tasks, with whatever is being dragged right now --- */
function xpItems() {
  const d = xpDay(xpDate);
  let l = [
    ...(d.busy || []).map(b => ({id: b.id, busy: true, title: b.label || 'Busy', start: b.start, len: b.len, effort: b.effort ?? 2})),
    ...xpTasks().filter(t => t.day === xpDate && t.start != null).map(t => ({id: t.id, t, title: t.title, domain: t.domain, start: t.start, len: xpLen(t), effort: xpEff(t), done: t.done}))
  ];
  const g = xpDrag;
  if (g && g.moved) {
    if (g.mode === 'tray') { if (g.over) { const t = all.find(x => x.id === g.id); l.push({id: t.id, t, title: t.title, domain: t.domain, start: g.start, len: t.est, effort: t.effort, ghost: true}); } }
    else l = l.map(x => x.id === g.id ? {...x, ...g.cur, lifted: g.toTray} : x);
  }
  return l;
}
// side-by-side lanes for blocks that overlap in time
function xpLanes(l) {
  l = [...l].sort((a, b) => a.start - b.start || b.len - a.len);
  let group = [], end = -1;
  const close = () => { const n = Math.max(...group.map(x => x.lane)) + 1; group.forEach(x => x.lanes = n); group = []; };
  l.forEach(x => {
    if (group.length && x.start >= end) close();
    const used = new Set(group.filter(y => y.start + y.len > x.start).map(y => y.lane));
    x.lane = 0; while (used.has(x.lane)) x.lane++;
    group.push(x); end = Math.max(end, x.start + x.len);
  });
  if (group.length) close();
  return l;
}
// the day's running totals: free time and energy, and how much of each the blocks use
function xpTotals() {
  const d = xpDay(xpDate), items = xpItems().filter(x => !x.lifted), busy = items.filter(x => x.busy), tasks = items.filter(x => !x.busy);
  const awake = d.sleep - d.wake, busyMin = busy.reduce((a, x) => a + x.len, 0), taskMin = tasks.reduce((a, x) => a + x.len, 0);
  const budget = xpBudget(d), busyE = busy.reduce((a, x) => a + xpCost(x.len, x.effort), 0), taskE = tasks.reduce((a, x) => a + xpCost(x.len, x.effort), 0);
  const doneToday = xpTasks().filter(t => t.done && t.done.day === xpDate);
  return {d, free: awake - busyMin, busyMin, taskMin, budget, busyE, taskE, energyFree: budget - busyE,
    exp: doneToday.reduce((a, t) => a + xpExp1(t), 0), nDone: doneToday.length};
}

/* --- drawing --- */
function renderExpro() {
  const el = $('pgExpro'); if (!el || page !== 'expro') return;
  if (!owner) { el.innerHTML = `<p class="mute">${loaded ? 'This page is private.' : 'Loading…'}</p>`; return; }
  if (!loaded) { el.innerHTML = '<p class="mute">Loading…</p>'; return; }
  xpDate = xpDate || xpToday();
  xpChores();
  const today = xpToday(), lbl = new Date(xpDate + 'T12:00').toLocaleDateString(undefined, {weekday: 'long', month: 'short', day: 'numeric'});
  const tab = (v, l) => `<button class="tag ${xpTab === v ? 'on' : ''}" data-act="xptab" data-v="${v}">${l}</button>`;
  el.innerHTML = `<div class="xpro">
    <div class="xphead">
      <div class="xpdate"><button class="ib" data-act="xpday" data-v="-1" aria-label="Previous day">←</button><b>${esc(lbl)}</b>${xpDate === today ? '<span class="pill">Today</span>' : `<button class="link" data-act="xpday" data-v="0">Back to today</button>`}<button class="ib" data-act="xpday" data-v="1" aria-label="Next day">→</button></div>
      <div class="xptabs">${tab('day', 'Day')}${tab('domains', 'Domains')}</div>
      <div class="xpexp"><b>${exproExp().toLocaleString()}</b> EXPRO EXP</div>
    </div>
    ${xpTab === 'day' ? `<div class="xptop"><div class="xpmeters" id="xpMeters"></div><div class="xptray" id="xpTray"></div></div>
      <div class="xpbody"><div><div class="xpcalbar"><span class="mute">Up/down = time · sticking out = effort</span><label class="xpdepth">3D <input type="range" id="xpDepth" min="0" max="16" value="${xpDepth()}"></label></div><div class="xpcal" id="xpCal"></div></div><aside class="xpside" id="xpSide"></aside></div>`
      : `<div id="xpStats"></div>`}
  </div>`;
  if (xpTab === 'day') { xpDrawMeters(); xpDrawTray(); xpDrawCal(); xpDrawSide(); }
  else xpDrawStats();
}

function xpDrawMeters() {
  const m = $('xpMeters'); if (!m) return;
  const s = xpTotals(), tLeft = s.free - s.taskMin, eLeft = s.energyFree - s.taskE;
  const bar = (used, of, over) => `<div class="xpbar${over ? ' over' : ''}"><i style="width:${of > 0 ? Math.min(100, used / of * 100) : 100}%"></i></div>`;
  m.innerHTML = `<div class="xpm"><span>TIME</span>${bar(s.taskMin, s.free, tLeft < 0)}
      <div><b>${sdur(s.taskMin)}</b> of ${sdur(s.free)} free · <b class="${tLeft < 0 ? 'neg' : ''}">${tLeft < 0 ? sdur(-tLeft) + ' over' : sdur(tLeft) + ' left'}</b></div>
      ${s.busyMin ? `<div class="mute">after ${sdur(s.busyMin)} busy</div>` : ''}</div>
    <div class="xpm"><span>ENERGY</span>${bar(s.taskE, s.energyFree, eLeft < 0)}
      <div><b>${num1(s.taskE)}</b> of ${num1(s.energyFree)} ⚡ · <b class="${eLeft < 0 ? 'neg' : ''}">${eLeft < 0 ? num1(-eLeft) + ' ⚡ in the red' : num1(eLeft) + ' ⚡ left'}</b></div>
      <div class="mute">${s.d.tank == null ? 'No check-in yet' : 'Tank ' + s.d.tank + '/5'}${s.busyE ? ' · busy uses ' + num1(s.busyE) : ''}</div></div>
    <div class="xpm"><span>DONE</span><div><b>${s.nDone}</b> task${s.nDone === 1 ? '' : 's'} · <b>+${s.exp}</b> EXP</div></div>`;
}

// a block's three visible faces: the front (raised by its effort), plus its left side and bottom
function xpFaces(col, busy) {
  const base = busy ? '#4b5568' : col;
  return {top: blend('#3a435e', base, busy ? .6 : .62), left: blend('#161c27', base, .38), bot: blend('#0e131b', base, .3)};
}
const xpTrayBlock = t => {
  const f = xpFaces(xpCol(t.domain)), sh = Array.from({length: t.effort * 3}, (_, i) => `${i + 1}px ${-(i + 1)}px 0 ${i % 3 === 2 ? f.bot : f.left}`).join(',');
  return `<div class="xpt${xpSel === t.id ? ' sel' : ''}" data-xid="${t.id}" data-xg="tray" style="background:${f.top};color:${ink(f.top)};width:${Math.max(140, Math.min(260, t.est * 1.3))}px;box-shadow:${sh}" title="Drag onto the calendar">
    <b>${esc(t.title)}</b><span>${esc(t.domain)} · ${sdur(t.est)} · ${dots(t.effort)}</span>${(t.missed || []).length ? `<em>pushed back ${t.missed.length}×</em>` : ''}</div>`;
};
function xpDrawTray() {
  const el = $('xpTray'); if (!el) return;
  const l = xpTasks().filter(t => !t.done && t.start == null && (!t.day || t.day === xpDate));
  const opts = (vals, cur, lab = v => v) => vals.map(v => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(lab(v))}</option>`).join('');
  el.innerHTML = `<div class="xptl">${l.map(xpTrayBlock).join('') || '<span class="mute">No tasks waiting. Add one →</span>'}</div>
    <div class="xpnew"><input id="xpNT" placeholder="New task…" maxlength="80" autocomplete="off">
      <select id="xpND" title="Domain">${opts(xpDomains(), xpCfg().lastDomain || xpDomains()[0])}</select>
      <select id="xpNE" title="How long">${opts(XP_LENS.map(String), '30', v => sdur(+v))}</select>
      <select id="xpNF" title="Effort (1 easy – 5 draining)">${opts(['1', '2', '3', '4', '5'], '3', v => 'effort ' + v)}</select>
      <button class="go2" data-act="xpadd">+ ADD</button></div>`;
  el.classList.toggle('drop', !!(xpDrag && xpDrag.toTray));
}

function xpDrawCal() {
  const el = $('xpCal'); if (!el) return;
  const d = xpDay(xpDate), D = xpDepth(), k = D * Math.SQRT1_2, pad = Math.round(5 * k) + 10, gut = 54;
  const W = el.clientWidth || 600, colW = Math.max(120, W - gut - pad - 6), H = (d.sleep - d.wake) * XP_PX;
  const y = t => pad + (t - d.wake) * XP_PX;
  let h = '';
  for (let m = Math.ceil(d.wake / 60) * 60; m <= d.sleep; m += 30) h += `<div class="xph${m % 60 ? ' half' : ''}" style="top:${y(m)}px">${m % 60 ? '' : `<span>${clock(m)}</span>`}</div>`;
  if (xpDate === xpToday()) { const n = new Date(), nm = n.getHours() * 60 + n.getMinutes() + (n.getHours() * 60 + n.getMinutes() < d.wake ? 1440 : 0); if (nm >= d.wake && nm <= d.sleep) h += `<div class="xpnow" style="top:${y(nm)}px"></div>`; }
  // draw back to front: earlier blocks first (later ones sit in front of them), right lanes before left ones
  const l = xpLanes(xpItems()).sort((a, b) => a.start - b.start || b.lane - a.lane);
  l.forEach((x, i) => {
    const lw = Math.min(380, colW / x.lanes), w = lw - 6, bx = gut + x.lane * lw, by = y(x.start), bh = Math.max(14, x.len * XP_PX - 2), e = x.effort * k;
    const f = xpFaces(x.busy ? null : xpCol(x.domain), x.busy), small = bh < 34;
    const plan = x.done && x.t ? `<div class="xpplan" style="height:${x.t.est * XP_PX - 2}px;transform:translate(${e}px,${-e}px)" title="Planned: ${sdur(x.t.est)}"></div>` : '';
    h += `<div class="xpb${x.busy ? ' busy' : ''}${x.done ? ' done' : ''}${x.ghost ? ' ghost' : ''}${x.lifted ? ' lifted' : ''}${xpSel === x.id ? ' sel' : ''}" data-xid="${x.id}" style="left:${bx}px;top:${by}px;width:${w}px;height:${bh}px;z-index:${i + 2}">
      <svg class="xps" width="1" height="1"><polygon fill="${f.left}" points="0,0 ${e},${-e} ${e},${bh - e} 0,${bh}"/><polygon fill="${f.bot}" points="0,${bh} ${w},${bh} ${w + e},${bh - e} ${e},${bh - e}"/></svg>
      ${plan}<div class="xpf${small ? ' small' : ''}" data-xg="move" style="transform:translate(${e}px,${-e}px);background:${f.top};color:${ink(f.top)}">
        <b>${x.done ? '✓ ' : ''}${esc(x.title)}</b>${small ? '' : `<span>${x.busy ? '' : esc(x.domain) + ' · '}${clock(x.start)}–${clock(x.start + x.len)} · ${dots(x.effort)}</span>`}
        ${x.done ? '' : `<i class="xpgl" data-xg="len" title="Drag to change the time"></i><i class="xpgz" data-xg="z" title="Drag up-right for more effort, down-left for less">${x.effort}</i>`}</div></div>`;
  });
  el.innerHTML = `<div class="xpplane" id="xpPlane" style="height:${H + pad + 24}px">${h}</div>`;
  el._geo = {pad, wake: d.wake, sleep: d.sleep, k};
}

const xpRate = (key, cur, lo = 1) => `<div class="xpr">${[0, 1, 2, 3, 4, 5].filter(n => n >= lo).map(n => `<button class="${n === cur ? 'on' : ''}" data-act="xprate" data-k="${key}" data-v="${n}">${n}</button>`).join('')}</div>`;
function xpDrawSide() {
  const el = $('xpSide'); if (!el) return;
  const d = xpDay(xpDate), today = xpToday();
  const t = xpTasks().find(x => x.id === xpSel), b = (d.busy || []).find(x => x.id === xpSel);
  let h = '';
  if (xpDoneForm && t) {
    const f = xpDoneForm, gain = Math.round(f.min * (1 + (f.effort - 1) / 4));
    h = `<h3>DONE: ${esc(t.title).toUpperCase()}</h3>
      <label>How long did it really take?</label><div class="xpmin"><button class="tag" data-act="xpmin" data-v="-15">−15</button><input id="xpDM" type="number" min="1" step="5" value="${f.min}"><span>min</span><button class="tag" data-act="xpmin" data-v="15">+15</button></div>
      <p class="mute">You planned ${sdur(t.est)}.</p>
      <label>How draining was it really?</label>${xpRate('effort', f.effort)}<p class="mute">You planned effort ${t.effort}.</p>
      <label>How did it go?</label>${xpRate('went', f.went)}<p class="mute">1 = badly · 5 = great</p>
      <label>Did you enjoy it?</label>${xpRate('enjoy', f.enjoy)}<p class="mute">1 = hated it · 5 = loved it</p>
      <button class="go" data-act="xpdone" ${f.went && f.enjoy ? '' : 'disabled'}>SAVE · +${gain} EXP</button>
      <button class="link" data-act="xpcancel" style="display:block;margin:10px auto 0">Cancel</button>`;
  }
  else if (t) {
    const len = xpLen(t), eff = xpEff(t), r = t.rep && (xpCfg().repeats || []).find(x => x.id === t.rep);
    h = `<h3>TASK</h3><input data-xf="title" value="${esc(t.title)}" maxlength="80">
      <div class="two"><div><label>Domain</label><select data-xf="domain">${xpDomains().concat(xpDomains().includes(t.domain) ? [] : [t.domain]).map(v => `<option${v === t.domain ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select></div>
        <div><label>Time (min)</label><input data-xf="est" type="number" min="5" step="5" value="${t.est}"></div></div>
      <label>Effort</label>${xpRate('teffort', t.effort)}
      ${t.start != null ? `<label>Starts</label><input data-xf="start" type="time" value="${hmStr(t.start)}">` : ''}
      <p class="mute">Costs ${num1(xpCost(t.est, t.effort))} ⚡ (effort ${t.effort} × ${sdur(t.est)})${(t.missed || []).length ? ` · pushed back ${t.missed.length}× (${t.missed.map(x => x.slice(5)).join(', ')})` : ''}</p>
      ${t.done ? `<div class="xpvs"><b>✓ Done · +${xpExp1(t)} EXP</b>
          <div>Time: planned ${sdur(t.est)} → took ${sdur(len)} <em>${xpPct(len, t.est)}</em></div>
          <div>Effort: planned ${t.effort} → really ${eff}</div><div>Went ${t.done.went}/5 · enjoyed ${t.done.enjoy}/5</div></div>
          <button class="link" data-act="xpundo">Undo “done”</button>`
        : `<button class="go" data-act="xpdoneopen">DONE ✓</button>`}
      <div class="xplinks">${t.start != null && !t.done ? '<button class="link" data-act="xpunsched">Back to the tray</button>' : ''}
        ${r ? '<button class="link" data-act="xpstoprep">Stop repeating</button>' : ''}
        <button class="link" data-act="xpdel" data-v="${t.id}">Delete</button><button class="link" data-act="xpdesel">Close</button></div>`;
  }
  else if (b) {
    h = `<h3>BUSY BLOCK</h3><input data-xb="label" value="${esc(b.label || '')}" placeholder="What is it? (work, class…)" maxlength="60">
      <div class="two"><div><label>From</label><input data-xb="start" type="time" value="${hmStr(b.start)}"></div><div><label>To</label><input data-xb="end" type="time" value="${hmStr(b.start + b.len)}"></div></div>
      <label>How draining (0 = not at all)</label>${xpRate('beffort', b.effort ?? 2, 0)}
      <p class="mute">Uses ${sdur(b.len)} and ${num1(xpCost(b.len, b.effort ?? 2))} ⚡ before any tasks.</p>
      <div class="xplinks"><button class="link" data-act="xpbdel">Delete</button><button class="link" data-act="xpdesel">Close</button></div>`;
  }
  else {
    const prev = all.filter(x => x.kind === 'day' && x.date < xpDate && xpDow(x.date) === xpDow(xpDate) && (x.busy || []).length).sort((a, c) => c.date.localeCompare(a.date))[0];
    const ideas = xpRepeatIdeas(), offCal = xpTasks().filter(x => x.done && x.done.day === xpDate && x.start == null);
    h = `${d.tank == null && xpDate >= today ? `<div class="xpcheck"><h3>CHECK-IN</h3><p>How full is the tank today?</p>${xpRate('tank', null)}<p class="mute">1 = running on fumes · 5 = full. Sets today's energy budget (${XP_TANK} ⚡ per level).</p></div>` : ''}
      <h3>THE DAY</h3>
      <div class="two"><div><label>Awake from</label><input data-xday="wake" type="time" value="${hmStr(d.wake)}"></div><div><label>Until</label><input data-xday="sleep" type="time" value="${hmStr(d.sleep)}"></div></div>
      ${d.tank != null ? `<label>Tank</label>${xpRate('tank', d.tank)}` : ''}
      <label>Energy budget ⚡</label><input data-xday="budget" type="number" min="0" step="1" value="${d.budget ?? ''}" placeholder="${xpBudget(d)} (from the tank)">
      <h3>BUSY</h3><p class="mute">Things that take time but aren't tasks: work, class, the commute.</p>
      ${(d.busy || []).map(x => `<button class="tag xpbusyrow" data-act="xpsel" data-v="${x.id}">${esc(x.label || 'Busy')} <span>${clock(x.start)}–${clock(x.start + x.len)}</span></button>`).join('')}
      <button class="link" data-act="xpbadd">+ Add a busy block</button>
      ${prev && !(d.busy || []).length ? `<button class="link" data-act="xpbcopy" data-v="${prev.id}">Copy busy blocks from last ${XP_DOWS[xpDow(xpDate)]}</button>` : ''}
      ${ideas.map(x => `<div class="xpidea"><p>You've put “${esc(x.t.title)}” on ${XP_DOWS[x.dow]}s around ${clock(x.slot)} ${x.days.size} times. Repeat it every ${XP_DOWS[x.dow]}?</p>
        <button class="tag" data-act="xprep" data-v="${esc(x.key)}">Yes, repeat it</button> <button class="link" data-act="xpnorep" data-v="${esc(x.key)}">No thanks</button></div>`).join('')}
      ${offCal.length ? `<h3>DONE OFF THE CALENDAR</h3>${offCal.map(x => `<button class="tag xpbusyrow" data-act="xpsel" data-v="${x.id}">✓ ${esc(x.title)} <span>+${xpExp1(x)} EXP</span></button>`).join('')}` : ''}
      <p class="mute xphint">Click a block to edit it or mark it done. Drag tray tasks onto the calendar; drag a block's bottom edge for time and its corner number for effort. Drag a block up onto the tray to unschedule it.</p>`;
  }
  el.innerHTML = h;
}
const xpPct = (a, b) => { const p = Math.round((a / b - 1) * 100); return Math.abs(p) < 5 ? 'on target' : p > 0 ? `${p}% longer` : `${-p}% shorter`; };

/* --- DOMAINS tab: what your finished tasks add up to, per domain --- */
function xpDrawStats() {
  const el = $('xpStats'); if (!el) return;
  const since = xpRange === 'all' ? '' : xpShift(xpToday(), xpRange === 'week' ? -6 : -29);
  const T = xpTasks(), done = T.filter(t => t.done && (t.done.day || '') >= since), total = done.reduce((a, t) => a + t.done.min, 0);
  const avg = (l, f) => l.length ? l.reduce((a, t) => a + f(t), 0) / l.length : null;
  const doms = [...new Set([...xpDomains(), ...T.map(t => t.domain)])];
  const rows = doms.map(dm => {
    const l = done.filter(t => t.domain === dm), min = l.reduce((a, t) => a + t.done.min, 0), est = l.reduce((a, t) => a + t.est, 0);
    const missed = T.filter(t => t.domain === dm).reduce((a, t) => a + (t.missed || []).filter(x => x >= since).length, 0);
    return {dm, n: l.length, min, est, share: total ? min / total : 0, went: avg(l, t => t.done.went), enjoy: avg(l, t => t.done.enjoy),
      effD: avg(l, t => t.done.effort - t.effort), pct: est ? (min / est - 1) * 100 : null, missed, exp: l.reduce((a, t) => a + xpExp1(t), 0)};
  }).filter(r => r.n || r.missed).sort((a, b) => b.min - a.min);
  const f2 = v => v == null ? '—' : v.toFixed(1);
  const chip = dm => `<span class="chip" style="background:${xpCol(dm)};color:${ink(xpCol(dm))}">${esc(dm)}</span>`;
  // the things that stand out (domains with at least 2 finished tasks)
  const ok = rows.filter(r => r.n >= 2), lo = (k, word) => { const r = [...ok].sort((a, b) => a[k] - b[k])[0]; return r && r[k] < 3.5 ? `<li>${chip(r.dm)} ${word} (${r[k].toFixed(1)}/5).</li>` : ''; };
  const under = [...ok].sort((a, b) => b.pct - a.pct)[0], pushed = [...rows].sort((a, b) => b.missed - a.missed)[0], big = rows[0];
  const notes = [big && big.n ? `<li>${chip(big.dm)} takes the most of your time: ${Math.round(big.share * 100)}% (${sdur(big.min)}).</li>` : '',
    lo('enjoy', 'is what you enjoy least'), lo('went', 'goes worst'),
    under && under.pct > 10 ? `<li>${chip(under.dm)} tasks take ${Math.round(under.pct)}% longer than you plan.</li>` : '',
    pushed && pushed.missed ? `<li>${chip(pushed.dm)} gets pushed back the most (${pushed.missed}×).</li>` : ''].join('');
  const rb = (v, l) => `<button class="tag ${xpRange === v ? 'on' : ''}" data-act="xprange" data-v="${v}">${l}</button>`;
  const recent = [...done].sort((a, b) => (b.done.at || '').localeCompare(a.done.at || '')).slice(0, 20);
  el.innerHTML = `<div class="tl srt">${rb('week', 'Last 7 days')}${rb('month', 'Last 30 days')}${rb('all', 'All time')}</div>
    ${notes ? `<h3>WHAT STANDS OUT</h3><ul class="xpnotes">${notes}</ul>` : ''}
    <h3>BY DOMAIN</h3>
    ${rows.length ? table(['Domain', 'Done', 'Time', 'Share', 'Went', 'Enjoyed', 'Time vs plan', 'Effort vs plan', 'Pushed back', 'EXP'],
      rows.map(r => [chip(r.dm), r.n, sdur(r.min), `<span class="xpshare"><i style="width:${Math.round(r.share * 100)}%"></i></span>${Math.round(r.share * 100)}%`,
        f2(r.went), f2(r.enjoy), r.pct == null ? '—' : xpPct(r.min, r.est), r.effD == null ? '—' : (r.effD > 0 ? '+' : '') + num1(r.effD), r.missed || '—', r.exp]), 'xptable')
      : '<p class="mute">Nothing finished in this stretch yet. Mark tasks done on the Day tab and they add up here.</p>'}
    ${recent.length ? `<h3>ESTIMATES VS REALITY</h3>${table(['Task', 'Domain', 'Day', 'Time: plan → real', 'Effort: plan → real', 'Went', 'Enjoyed'],
      recent.map(t => [esc(t.title), chip(t.domain), t.done.day.slice(5), `${sdur(t.est)} → ${sdur(t.done.min)} <span class="mute">${xpPct(t.done.min, t.est)}</span>`, `${t.effort} → ${t.done.effort}`, t.done.went, t.done.enjoy]), 'xptable')}` : ''}
    <h3>DOMAINS</h3><div class="xpdoms">${xpDomains().map(dm => `<span class="xpdom"><input type="color" data-xcol="${esc(dm)}" value="${xpCol(dm)}" title="Color">${esc(dm)}<button class="link" data-act="xpdomdel" data-v="${esc(dm)}" title="Remove from the list (its tasks keep it)">✕</button></span>`).join('')}</div>
    <div class="xpnew"><input id="xpNewDom" placeholder="Add a domain…" maxlength="30"><button class="go2" data-act="xpdomadd">+ ADD</button></div>`;
}

/* --- clicks --- */
document.addEventListener('click', ev => {
  if (page !== 'expro') return;
  const b = ev.target.closest('[data-act^="xp"]'); if (!b) return;
  const a = b.dataset.act, v = b.dataset.v, d = xpDay(xpDate), cfg = xpCfg(), t = xpTasks().find(x => x.id === xpSel);
  if (a === 'xpday') { xpDate = v === '0' ? xpToday() : xpShift(xpDate, +v); xpSel = xpDoneForm = null; renderExpro(); }
  else if (a === 'xptab') { xpTab = v; renderExpro(); }
  else if (a === 'xprange') { xpRange = v; xpDrawStats(); }
  else if (a === 'xpadd') xpAdd();
  else if (a === 'xpsel') { xpSel = v; xpDoneForm = null; renderExpro(); }
  else if (a === 'xpdesel') { xpSel = xpDoneForm = null; renderExpro(); }
  else if (a === 'xprate') {
    const n = +v, k = b.dataset.k;
    if (k === 'tank') xpSaveDay({tank: n});
    else if (k === 'teffort' && t) xpSaveTask(t.id, {effort: n});
    else if (k === 'beffort') xpSaveDay({busy: d.busy.map(x => x.id === xpSel ? {...x, effort: n} : x)});
    else if (xpDoneForm) { xpDoneForm[k] = n; xpDrawSide(); }
  }
  else if (a === 'xpdoneopen' && t) { xpDoneForm = {min: t.est, effort: t.effort, went: null, enjoy: null}; xpDrawSide(); }
  else if (a === 'xpmin' && xpDoneForm) { xpDoneForm.min = Math.max(5, xpDoneForm.min + +v); xpDrawSide(); }
  else if (a === 'xpcancel') { xpDoneForm = null; xpDrawSide(); }
  else if (a === 'xpdone' && t && xpDoneForm) {
    const f = xpDoneForm, gain = Math.round(f.min * (1 + (f.effort - 1) / 4));
    xpDoneForm = null;
    xpSaveTask(t.id, {done: {...f, day: t.day || xpDate, at: new Date().toISOString()}, day: t.day || xpDate}, `+${gain} EXP · ${t.title} done`);
  }
  else if (a === 'xpundo' && t) xpSaveTask(t.id, {done: null});
  else if (a === 'xpunsched' && t) { xpSaveTask(t.id, {day: null, start: null}); }
  else if (a === 'xpstoprep' && t) xpSave({...cfg, repeats: (cfg.repeats || []).filter(r => r.id !== t.rep)}, 'It won’t repeat any more');
  else if (a === 'xpdel') {
    if (b.dataset.arm) xpDelete(v);
    else { b.dataset.arm = 1; b.textContent = 'Click again to delete'; setTimeout(() => { delete b.dataset.arm; b.textContent = 'Delete'; }, 3000); }
  }
  else if (a === 'xpbadd') {
    const items = xpItems(), end = items.length ? Math.max(...items.map(x => x.start + x.len)) : d.wake + 120;
    const id = xpId('b'); xpSel = id;
    xpSaveDay({busy: [...(d.busy || []), {id, label: '', start: Math.min(xpSnap(end), d.sleep - 60), len: 60, effort: 2}]});
  }
  else if (a === 'xpbdel') { xpSaveDay({busy: d.busy.filter(x => x.id !== xpSel)}); xpSel = null; }
  else if (a === 'xpbcopy') { const p = all.find(x => x.id === v); if (p) xpSaveDay({busy: p.busy.map(x => ({...x, id: xpId('b')}))}); }
  else if (a === 'xprep' || a === 'xpnorep') {
    const idea = xpRepeatIdeas().find(x => x.key === v); if (!idea) return;
    if (a === 'xpnorep') xpSave({...cfg, noRepeat: [...(cfg.noRepeat || []), v]});
    else xpSave({...cfg, repeats: [...(cfg.repeats || []), {id: xpId('r'), key: v, title: idea.t.title, domain: idea.t.domain, est: idea.t.est, effort: idea.t.effort, dow: idea.dow, start: idea.t.start}]},
      `“${idea.t.title}” will show up every ${XP_DOWS[idea.dow]}`);
  }
  else if (a === 'xpdomadd') { const n = $('xpNewDom').value.trim(); if (n && !xpDomains().some(x => key(x) === key(n))) xpSave({...cfg, domains: [...xpDomains(), n]}); }
  else if (a === 'xpdomdel') {
    if (b.dataset.arm) xpSave({...cfg, domains: xpDomains().filter(x => x !== v)});
    else { b.dataset.arm = 1; b.textContent = 'remove?'; setTimeout(() => { delete b.dataset.arm; b.textContent = '✕'; }, 3000); }
  }
});
function xpAdd() {
  const title = $('xpNT').value.trim(); if (!title) { $('xpNT').focus(); return; }
  const domain = $('xpND').value, cfg = xpCfg();
  const task = {id: xpId('t'), kind: 'task', is_public: false, title, domain, est: +$('xpNE').value, effort: +$('xpNF').value, day: null, start: null, created: new Date().toISOString()};
  const saves = [task]; if (cfg.lastDomain !== domain) saves.push({...cfg, lastDomain: domain});
  xpSave(saves).then(() => $('xpNT') && $('xpNT').focus());
  setTimeout(() => $('xpNT') && $('xpNT').focus());
}
/* --- typing into the side panel and the forms --- */
document.addEventListener('keydown', ev => {
  if (page !== 'expro') return;
  if (ev.key === 'Enter' && ev.target.id === 'xpNT') { ev.preventDefault(); xpAdd(); }
  if (ev.key === 'Enter' && ev.target.id === 'xpNewDom') { ev.preventDefault(); document.querySelector('[data-act="xpdomadd"]').click(); }
  if (ev.key === 'Escape' && (xpSel || xpDoneForm) && !ev.target.closest('input,select')) { xpSel = xpDoneForm = null; renderExpro(); }
});
document.addEventListener('input', ev => {
  if (page !== 'expro') return;
  if (ev.target.id === 'xpDM' && xpDoneForm) { xpDoneForm.min = Math.max(1, +ev.target.value || 0); const g = document.querySelector('[data-act="xpdone"]'); if (g) g.textContent = `SAVE · +${Math.round(xpDoneForm.min * (1 + (xpDoneForm.effort - 1) / 4))} EXP`; }
  if (ev.target.id === 'xpDepth') { xpDepthLive = +ev.target.value; xpDrawCal(); }
});
document.addEventListener('change', ev => {
  if (page !== 'expro') return;
  const e = ev.target, v = e.value, d = xpDay(xpDate), t = xpTasks().find(x => x.id === xpSel);
  if (e.id === 'xpDepth') { xpDepthLive = null; xpSave({...xpCfg(), depth: +v}); }
  else if (e.dataset.xf && t) {
    const k = e.dataset.xf;
    if (k === 'title' && v.trim()) xpSaveTask(t.id, {title: v.trim()});
    else if (k === 'domain') xpSaveTask(t.id, {domain: v});
    else if (k === 'est' && +v > 0) xpSaveTask(t.id, {est: Math.round(+v)});
    else if (k === 'start' && v) { let m = hm(v); if (m < d.wake) m += 1440; xpSaveTask(t.id, {start: m}); }
  }
  else if (e.dataset.xb) {
    const k = e.dataset.xb;
    xpSaveDay({busy: d.busy.map(b => {
      if (b.id !== xpSel) return b;
      if (k === 'label') return {...b, label: v.trim()};
      let m = hm(v); if (m < d.wake) m += 1440;
      return k === 'start' ? {...b, start: m} : {...b, len: Math.max(15, m - b.start)};
    })});
  }
  else if (e.dataset.xday) {
    const k = e.dataset.xday;
    if (k === 'budget') xpSaveDay({budget: v === '' ? null : Math.max(0, +v)});
    else if (v) {   // bedtime earlier than waking up means after midnight
      const m = hm(v), s = k === 'wake' ? d.sleep % 1440 : m, w = k === 'wake' ? m : d.wake;
      xpSaveDay({wake: w, sleep: s <= w ? s + 1440 : s});
    }
  }
  else if (e.dataset.xcol) { const c = xpCfg(); xpSave({...c, colors: {...(c.colors || {}), [e.dataset.xcol]: v}}); }
});

/* --- dragging: tray → calendar, moving blocks, stretching time (bottom edge) and effort (corner number) --- */
document.addEventListener('pointerdown', ev => {
  if (page !== 'expro' || ev.button) return;
  const g = ev.target.closest('[data-xg]'); if (!g) return;
  const id = g.closest('[data-xid]').dataset.xid, it = xpItems().find(x => x.id === id);
  xpDrag = {mode: g.dataset.xg, id, x0: ev.clientX, y0: ev.clientY, moved: false, it0: it, cur: it ? {start: it.start, len: it.len, effort: it.effort} : {}};
  ev.preventDefault();
});
document.addEventListener('pointermove', ev => {
  const g = xpDrag; if (!g) return;
  const dx = ev.clientX - g.x0, dy = ev.clientY - g.y0;
  if (!g.moved && Math.hypot(dx, dy) < 4) return;
  g.moved = true;
  const cal = $('xpPlane'), geo = $('xpCal')._geo, r = cal.getBoundingClientRect(), d = xpDay(xpDate);
  if (g.mode === 'tray') {
    const t = all.find(x => x.id === g.id);
    g.over = ev.clientX > r.left && ev.clientX < r.right && ev.clientY > r.top && ev.clientY < r.bottom;
    g.start = Math.min(d.sleep - t.est, Math.max(d.wake, xpSnap(d.wake + (ev.clientY - r.top - geo.pad - 8) / XP_PX)));
    let gh = $('xpGhost');
    if (!gh) { gh = document.createElement('div'); gh.id = 'xpGhost'; gh.className = 'xpghost'; gh.textContent = t.title; document.body.appendChild(gh); }
    gh.hidden = g.over; gh.style.left = ev.clientX + 8 + 'px'; gh.style.top = ev.clientY + 8 + 'px';
  }
  else if (g.mode === 'move') {
    g.toTray = !g.it0.busy && ev.clientY < r.top - 10 && $('xpTray').getBoundingClientRect().bottom > ev.clientY;
    g.cur.start = Math.min(d.sleep - g.it0.len, Math.max(d.wake, xpSnap(g.it0.start + dy / XP_PX)));
    $('xpTray').classList.toggle('drop', g.toTray);
  }
  else if (g.mode === 'len') g.cur.len = Math.max(XP_SNAP, Math.min(d.sleep - g.it0.start, xpSnap(g.it0.len + dy / XP_PX)));
  else if (g.mode === 'z') g.cur.effort = Math.max(g.it0.busy ? 0 : 1, Math.min(5, Math.round(g.it0.effort + (dx - dy) / Math.SQRT2 / Math.max(4, xpDepth()))));
  xpDrawCal(); xpDrawMeters();
});
document.addEventListener('pointerup', () => {
  const g = xpDrag; if (!g) return;
  xpDrag = null;
  const gh = $('xpGhost'); if (gh) gh.remove();
  if (!g.moved) { if (xpSel !== g.id) { xpSel = g.id; xpDoneForm = null; } renderExpro(); return; }
  const d = xpDay(xpDate), t = xpTasks().find(x => x.id === g.id);
  if (g.mode === 'tray') { if (g.over) { xpSel = g.id; xpSaveTask(g.id, {day: xpDate, start: g.start}); } else renderExpro(); return; }
  if (g.it0.busy) { xpSaveDay({busy: d.busy.map(b => b.id === g.id ? {...b, start: g.cur.start, len: g.cur.len, effort: g.cur.effort} : b)}); return; }
  if (g.mode === 'move') xpSaveTask(g.id, g.toTray ? {day: null, start: null} : {start: g.cur.start});
  else if (g.mode === 'len') xpSaveTask(g.id, {est: g.cur.len});
  else if (g.mode === 'z') xpSaveTask(g.id, {effort: g.cur.effort});
  else if (t) renderExpro();
});
window.addEventListener('resize', () => { if (page === 'expro' && xpTab === 'day') xpDrawCal(); });
// keep the "now" line moving
setInterval(() => { if (page === 'expro' && xpTab === 'day' && !xpDrag && xpDate === xpToday()) xpDrawCal(); }, 60e3);
