/* EXPRO (/expro): your private planner for serious life stuff. Only you can see it (every row it saves is private).
   This file loads before app.js and only defines things; app.js calls renderExpro() from render().

   HOW IT FITS TOGETHER
   - A TASK has a title, a domain, a time estimate in minutes and an effort from 1 to 5. Tasks wait in the TRAY (top row)
     until you drag them onto the calendar (Day and Week views: onto a time; Month view: onto a day).
   - Days are 24 hours. Up and down is time; how far a block sticks out toward you (the Z axis) is effort.
     Drag a block to move it, its bottom edge to change its time, its corner number to change its effort.
   - BUSY blocks are time that isn't a task (sleep, work, class). They can repeat every day, on weekdays, or on one weekday.
   - ENERGY is a daily budget like time. Anything on the calendar costs effort x hours (2 hours at effort 3 = 6).
     The budget comes from the morning check-in ("how full is the tank?", 1-5) times your "energy per tank level" setting,
     or you type the day's budget yourself. It can go below zero.
   - EXP is the same thing as on the EXP page: 1 EXP per minute. Finished tasks count toward TOTAL EXP.
     Domains and EXP Types are one list. Your EXP entries show up on the calendar. "Share to EXP" turns a task into
     an EXP entry (then it's counted once, as the entry).
   - Unfinished tasks from past days go back to the tray by themselves. The same task on the same weekday at about the
     same time 3 times: EXPRO offers to repeat it every week.

   SAVED AS (in the same Supabase "items" table as everything else, all private):
     task       {title, domain, est, effort, day, start, done:{min, effort, went, enjoy, day, at}, missed:[days], rep, created}
     day        id "day-YYYY-MM-DD": {date, tank, budget, busy:[{id, label, start, len, effort}], skip:[busy rule ids]}
     exprocfg   id "exprocfg": {domains, depth, tankSize, busyRules:[{id, label, start, len, effort, dows}], repeats, noRepeat, lastDomain}
   Times are minutes after midnight; a block can run past midnight into the next day. An EXP entry can carry "effort" and,
   when it was shared from a task, "task" (that task's id). */

const XP_DOMAINS = ['Work', 'Money', 'Health', 'Home', 'Admin', 'People', 'Family', 'Creative'];
const XP_SNAP = 15;         // blocks snap to quarter hours
const XP_DOWS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const XP_REPEATS = [['once', 'This day only'], ['daily', 'Every day'], ['weekdays', 'Weekdays'], ['weekends', 'Weekends'], ['dow', 'Every ']];
let xpView = 'day', xpDate = null, xpSel = null, xpDoneForm = null, xpRange = 'week', xpDrag = null, xpDepthLive = null, xpNewDom = false;
let xpRolled = '';
const xpScroll = {key: null, top: 0};   // where the calendar is scrolled to, kept across redraws
document.addEventListener('scroll', ev => { if (ev.target.id === 'xpCal') xpScroll.top = ev.target.scrollTop; }, true);
const xpRepMade = new Set();

/* --- small helpers --- */
const xpKey = d => { const z = new Date(d); z.setMinutes(z.getMinutes() - z.getTimezoneOffset()); return z.toISOString().slice(0, 10); };   // YYYY-MM-DD, your time zone
const xpToday = () => xpKey(new Date());
const xpShift = (k, n) => { const d = new Date(k + 'T12:00'); d.setDate(d.getDate() + n); return xpKey(d); };
const xpDow = k => new Date(k + 'T12:00').getDay();
const xpWeek = k => { const m = xpShift(k, -((xpDow(k) + 6) % 7)); return [0, 1, 2, 3, 4, 5, 6].map(i => xpShift(m, i)); };   // Monday to Sunday
const xpMonth = k => { const l = [], p = k.slice(0, 7); for (let d = p + '-01'; d.startsWith(p); d = xpShift(d, 1)) l.push(d); return l; };
const xpRangeDays = () => xpView === 'week' ? xpWeek(xpDate) : xpView === 'month' ? xpMonth(xpDate) : [xpDate];
const xpId = p => p + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const xpTasks = () => all.filter(x => x.kind === 'task');
const xpCfg = () => all.find(x => x.id === 'exprocfg') || {id: 'exprocfg', kind: 'exprocfg'};
// one list of domains: yours plus every EXP Type
const xpDomains = () => uniq('types', [...(xpCfg().domains || XP_DOMAINS), ...ents().flatMap(e => tagsOf(e, 'types'))]);
const xpCol = d => d ? tcol('types', d) : '#4b5568';
const xpDepth = () => xpDepthLive ?? xpCfg().depth ?? 9;   // pixels the Z axis sticks out per effort level
const xpTank = () => xpCfg().tankSize ?? 8;
const hm = s => { const [h, m] = String(s).split(':').map(Number); return h * 60 + (m || 0); };
const hmStr = m => { m = ((Math.round(m) % 1440) + 1440) % 1440; return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
const clock = m => { m = ((Math.round(m) % 1440) + 1440) % 1440; const h = Math.floor(m / 60), mm = m % 60; return (h % 12 || 12) + (mm ? ':' + String(mm).padStart(2, '0') : '') + (h < 12 ? 'am' : 'pm'); };
const sdur = m => (m < 0 ? '-' : '') + dur(Math.abs(Math.round(m)));
const num1 = n => String(Math.round(n * 10) / 10);
const xpCost = (min, eff) => min / 60 * eff;
const xpSnap = m => Math.round(m / XP_SNAP) * XP_SNAP;
// "45", "45m", "1h", "1.5h", "1h30", "1h 30m", "1:30" -> minutes
function xpParse(s) {
  s = String(s).trim().toLowerCase(); let m;
  if ((m = s.match(/^(\d+):(\d{1,2})$/))) return +m[1] * 60 + +m[2];
  if ((m = s.match(/^(\d+(?:\.\d+)?)\s*h[a-z]*\s*(?:(\d+)\s*m?[a-z]*)?$/))) return Math.round(+m[1] * 60 + (+m[2] || 0));
  if ((m = s.match(/^(\d+)\s*m?[a-z]*$/))) return +m[1];
  return null;
}
const xpShared = t => ents().find(e => e.task === t.id);   // the EXP entry made from this task, if any
const xpExp1 = t => t.done && !xpShared(t) ? Math.round(t.done.min) : 0;   // shared tasks count once, as their EXP entry
const exproExp = () => xpTasks().reduce((a, t) => a + xpExp1(t), 0);   // app.js adds this to TOTAL EXP
const xpLen = t => t.done ? t.done.min : t.est;      // drawn at what really happened once done, the plan before that
const xpEff = t => t.done ? t.done.effort : t.effort;

/* --- days and busy blocks --- */
const xpDay = k => all.find(x => x.id === 'day-' + k) || {id: 'day-' + k, kind: 'day', date: k, tank: null, budget: null, busy: []};
const xpBudget = d => d.budget ?? (d.tank ?? 3) * xpTank();
const xpRuleOn = (r, k) => (r.dows || []).includes(xpDow(k));
const xpBusyOn = k => { const d = xpDay(k); return [...(d.busy || []), ...(xpCfg().busyRules || []).filter(r => xpRuleOn(r, k) && !(d.skip || []).includes(r.id)).map(r => ({...r, rule: true}))]; };
function xpBusyFind(id) {
  const r = (xpCfg().busyRules || []).find(x => x.id === id); if (r) return {b: r, rule: true};
  for (const d of all.filter(x => x.kind === 'day')) { const b = (d.busy || []).find(x => x.id === id); if (b) return {b, day: d.date}; }
  return null;
}
const xpDowsOf = (rep, k) => rep === 'daily' ? [0, 1, 2, 3, 4, 5, 6] : rep === 'weekdays' ? [1, 2, 3, 4, 5] : rep === 'weekends' ? [0, 6] : rep === 'dow' ? [xpDow(k)] : null;
const xpRepOf = r => { const d = (r.dows || []).join(); return d === '0,1,2,3,4,5,6' ? 'Every day' : d === '1,2,3,4,5' ? 'Weekdays' : d === '0,6' ? 'Weekends' : (r.dows || []).length === 1 ? 'Every ' + XP_DOWS[r.dows[0]] : 'Repeats'; };

/* --- saving: show the change at once, then store it (on failure, reload what's really saved) --- */
async function xpSave(l, msg) {
  l = [].concat(l);
  l.forEach(o => { const i = all.findIndex(x => x.id === o.id); if (i < 0) all.push(o); else all[i] = o; });
  render();
  const {error} = await sb.from('items').upsert(l.map(row));
  if (error) { flash('Save failed: ' + error.message); load(); return false; }
  if (msg) flash(msg);
  return true;
}
async function xpDelete(id) {
  const t = all.find(x => x.id === id), c = xpCfg(), r = t && t.rep && (c.repeats || []).find(x => x.id === t.rep);
  if (r) await xpSave({...c, repeats: c.repeats.map(x => x === r ? {...r, skip: [...(r.skip || []), t.day]} : x)});   // one copy of a repeating task: don't remake it that day
  all = all.filter(x => x.id !== id); if (xpSel === id) xpSel = null;
  render();
  const {error} = await sb.from('items').delete().eq('id', id);
  if (error) { flash('Delete failed: ' + error.message); load(); }
}
const xpSaveDay = (patch, k = xpDate) => xpSave({...xpDay(k), ...patch});
const xpSaveCfg = (patch, msg) => xpSave({...xpCfg(), ...patch}, msg);
const xpSaveTask = (id, patch, msg) => { const t = all.find(x => x.id === id); return t && xpSave({...t, ...patch}, msg); };
function xpSaveBusy(id, patch) {
  const f = xpBusyFind(id); if (!f) return;
  if (f.rule) xpSaveCfg({busyRules: xpCfg().busyRules.map(r => r.id === id ? {...r, ...patch} : r)});
  else xpSaveDay({busy: xpDay(f.day).busy.map(b => b.id === id ? {...b, ...patch} : b)}, f.day);
}
const xpAddDomain = n => { n = n.trim(); if (n && !xpDomains().some(x => key(x) === key(n))) return {domains: [...(xpCfg().domains || XP_DOMAINS), n]}; return {}; };

/* --- chores when the page opens: roll unfinished tasks forward, make repeating tasks for the days on screen --- */
function xpChores() {
  const today = xpToday();
  if (xpRolled !== today) {
    xpRolled = today;
    const late = xpTasks().filter(t => !t.done && t.day && t.day < today);
    if (late.length) xpSave(late.map(t => ({...t, missed: [...(t.missed || []), t.day], day: null, start: null})),
      `Moved ${late.length} unfinished task${late.length > 1 ? 's' : ''} back to the tray`);
  }
  if (xpView === 'month') return;
  const make = [];
  xpRangeDays().filter(k => k >= today).forEach(k => (xpCfg().repeats || []).forEach(r => {
    if (r.dow !== xpDow(k) || (r.skip || []).includes(k) || xpRepMade.has(r.id + k) || xpTasks().some(t => t.rep === r.id && (t.day === k || (t.done && t.done.day === k)))) return;
    xpRepMade.add(r.id + k);
    make.push({id: xpId('t'), kind: 'task', is_public: false, title: r.title, domain: r.domain, est: r.est, effort: r.effort, day: k, start: r.start, rep: r.id, created: new Date().toISOString()});
  }));
  if (make.length) xpSave(make);
}
function xpRepeatIdeas() {
  const c = xpCfg(), no = new Set(c.noRepeat || []), have = new Set((c.repeats || []).map(r => r.key)), m = {};
  xpTasks().filter(t => t.day && t.start != null && !t.rep).forEach(t => {
    const dow = xpDow(t.day), slot = Math.round(t.start / 30) * 30, k = t.title.trim().toLowerCase() + '|' + dow + '|' + slot;
    (m[k] = m[k] || {key: k, t, dow, slot, days: new Set()}).days.add(t.day);
  });
  return Object.values(m).filter(x => x.days.size >= 3 && !no.has(x.key) && !have.has(x.key));
}

/* --- what's on day k: busy blocks, scheduled tasks and EXP entries, cut at midnight, plus whatever is being dragged --- */
function xpRaw(k) {   // things that start on day k (minutes after k's midnight)
  const g = xpDrag && xpDrag.moved && xpDrag.item ? xpDrag : null;
  let l = [
    ...xpBusyOn(k).map(b => ({id: b.id, kind: 'busy', b, title: b.label || 'Busy', start: b.start, len: b.len, effort: b.effort ?? 2})),
    ...xpTasks().filter(t => t.day === k && t.start != null).map(t => ({id: t.id, kind: 'task', t, title: t.title, domain: t.domain, start: t.start, len: xpLen(t), effort: xpEff(t), done: !!t.done}))
  ];
  if (g && g.item.kind === 'busy') l = l.map(x => x.id === g.id ? {...x, start: g.cur.start, len: g.cur.len, effort: g.cur.effort} : x);   // a repeating block changes on every day at once
  else if (g) {
    l = l.filter(x => x.id !== g.id);
    if ((g.mode !== 'tray' || g.over) && g.cur.day === k && g.cur.start != null) l.push({...g.item, ...g.cur, ghost: g.mode === 'tray', lifted: g.toTray});
  }
  return l;
}
function xpItemsFor(k) {
  const z = new Date(k + 'T00:00').getTime(), l = [...xpRaw(k), ...xpRaw(xpShift(k, -1)).map(x => ({...x, start: x.start - 1440}))];
  ents().filter(e => !e.task && e.start && e.end).forEach(e => {
    const s = (new Date(e.start) - z) / 6e4, en = (new Date(e.end) - z) / 6e4;
    if (en > 0 && s < 1440) l.push({id: e.id, kind: 'exp', e, title: e.title, domain: tagsOf(e, 'types')[0] || 'EXP', start: s, len: en - s, effort: e.effort ?? 0, done: true});
  });
  return l.filter(x => x.start + x.len > 0 && x.start < 1440).map(x => {
    const s = Math.max(0, x.start), en = Math.min(1440, x.start + x.len);
    return {...x, cut: x.start < 0, cutEnd: x.start + x.len > 1440, start: s, len: en - s};
  });
}
function xpLanes(l) {   // overlapping blocks sit side by side
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
function xpTotals(days) {   // time and energy for a set of days
  const s = {free: 0, busyMin: 0, used: 0, budget: 0, busyE: 0, usedE: 0, exp: 0, nDone: 0, checked: 0};
  days.forEach(k => {
    const d = xpDay(k), items = xpItemsFor(k).filter(x => !x.lifted && !(x.ghost && xpView === 'month'));
    items.forEach(x => { const c = xpCost(x.len, x.effort); if (x.kind === 'busy') { s.busyMin += x.len; s.busyE += c; } else { s.used += x.len; s.usedE += c; } });
    s.free += 1440; s.budget += xpBudget(d); if (d.tank != null || d.budget != null) s.checked++;
    const done = xpTasks().filter(t => t.done && t.done.day === k);
    s.exp += done.reduce((a, t) => a + xpExp1(t), 0) + ents().filter(e => e.start && xpKey(e.start) === k).reduce((a, e) => a + (e.minutes || 0), 0);
    s.nDone += done.length;
  });
  s.free -= s.busyMin; s.energyFree = s.budget - s.busyE;
  return s;
}

/* --- drawing --- */
function renderExpro() {
  const el = $('pgExpro'); if (!el || page !== 'expro') return;
  if (!owner) { el.innerHTML = `<p class="mute">${loaded ? 'This page is private.' : 'Loading...'}</p>`; return; }
  if (!loaded) { el.innerHTML = '<p class="mute">Loading...</p>'; return; }
  xpDate = xpDate || xpToday();
  xpChores();
  const today = xpToday(), D = new Date(xpDate + 'T12:00'), wk = xpWeek(xpDate), fmt = (k, o) => new Date(k + 'T12:00').toLocaleDateString(undefined, o);
  const lbl = xpView === 'week' ? `${fmt(wk[0], {month: 'short', day: 'numeric'})} - ${fmt(wk[6], {month: 'short', day: 'numeric'})}`
    : xpView === 'month' ? D.toLocaleDateString(undefined, {month: 'long', year: 'numeric'}) : D.toLocaleDateString(undefined, {weekday: 'long', month: 'short', day: 'numeric'});
  const isNow = xpRangeDays().includes(today);
  const tab = (v, l) => `<button class="tag ${xpView === v ? 'on' : ''}" data-act="xpview" data-v="${v}">${l}</button>`;
  const cal = xpView !== 'domains';
  el.innerHTML = `<div class="xpro">
    <div class="xphead">
      <div class="xpdate"><button class="ib" data-act="xpday" data-v="-1" aria-label="Back">&larr;</button><b>${esc(lbl)}</b><button class="ib" data-act="xpday" data-v="1" aria-label="Forward">&rarr;</button>${isNow ? '' : '<button class="link" data-act="xpday" data-v="0">Today</button>'}</div>
      <div class="xptabs">${tab('day', 'Day')}${tab('week', 'Week')}${tab('month', 'Month')}${tab('domains', 'Domains')}</div>
      ${cal && xpView !== 'month' ? `<label class="xpdepth">3D <input type="range" id="xpDepth" min="0" max="16" value="${xpDepth()}"></label>` : ''}
    </div>
    ${cal ? `<div class="xptop"><div class="xpmeters" id="xpMeters"></div><div class="xptray" id="xpTray"></div></div>
      <div class="xpbody v-${xpView}"><div class="xpcal${xpView === 'month' ? ' month' : ''}" id="xpCal"></div><aside class="xpside" id="xpSide"></aside></div>`
      : `<div id="xpStats"></div>`}
  </div>`;
  if (cal) { xpDrawMeters(); xpDrawTray(); xpDrawCal(); xpDrawSide(); }
  else xpDrawStats();
}

function xpDrawMeters() {
  const m = $('xpMeters'); if (!m) return;
  const days = xpRangeDays(), s = xpTotals(days), tLeft = s.free - s.used, eLeft = s.energyFree - s.usedE;
  const bar = (used, of, over) => `<div class="xpbar${over ? ' over' : ''}"><i style="width:${of > 0 ? Math.min(100, used / of * 100) : 100}%"></i></div>`;
  const one = days.length === 1, d = xpDay(days[0]);
  m.innerHTML = `<div class="xpm"><span>TIME</span>${bar(s.used, s.free, tLeft < 0)}
      <div><b>${sdur(s.used)}</b> of ${sdur(s.free)} free, <b class="${tLeft < 0 ? 'neg' : ''}">${tLeft < 0 ? sdur(-tLeft) + ' over' : sdur(tLeft) + ' left'}</b></div>
      ${s.busyMin ? `<div class="mute">${sdur(s.busyMin)} busy</div>` : ''}</div>
    <div class="xpm"><span>ENERGY</span>${bar(s.usedE, s.energyFree, eLeft < 0)}
      <div><b>${num1(s.usedE)}</b> of ${num1(s.energyFree)}, <b class="${eLeft < 0 ? 'neg' : ''}">${eLeft < 0 ? num1(-eLeft) + ' in the red' : num1(eLeft) + ' left'}</b></div>
      <div class="mute">${one ? (d.budget != null ? 'Budget set by hand' : d.tank == null ? 'No check-in yet' : 'Tank ' + d.tank + ' of 5') : s.checked + ' of ' + days.length + ' days checked in'}${s.busyE ? ', busy uses ' + num1(s.busyE) : ''}</div></div>
    <div class="xpm"><span>EXP</span><div><b>${s.exp.toLocaleString()}</b> EXP, ${s.nDone} task${s.nDone === 1 ? '' : 's'} done</div></div>`;
}

// a block's three visible faces: the front (raised by its effort), its left side and its bottom
function xpFaces(col, kind) {
  const base = kind === 'busy' ? '#4b5568' : col;
  return {top: blend('#3a435e', base, kind === 'busy' ? .6 : .62), left: blend('#161c27', base, .38), bot: blend('#0e131b', base, .3)};
}
const xpDomSelect = (cur, attrs) => `<select ${attrs}>${xpDomains().concat(cur && !xpDomains().some(x => key(x) === key(cur)) ? [cur] : []).map(v => `<option${key(v) === key(cur || '') ? ' selected' : ''}>${esc(v)}</option>`).join('')}<option value="__new">New domain...</option></select>`;
const xpTrayBlock = t => {
  const f = xpFaces(xpCol(t.domain)), sh = Array.from({length: t.effort * 3}, (_, i) => `${i + 1}px ${-(i + 1)}px 0 ${i % 3 === 2 ? f.bot : f.left}`).join(',');
  const when = t.day ? new Date(t.day + 'T12:00').toLocaleDateString(undefined, {weekday: 'short', month: 'short', day: 'numeric'}) + ', ' : '';
  return `<div class="xpt${xpSel === t.id ? ' sel' : ''}" data-xid="${t.id}" data-xg="tray" style="background:${f.top};color:${ink(f.top)};width:${Math.max(150, Math.min(260, t.est * 1.3))}px;box-shadow:${sh}">
    <b>${esc(t.title)}</b><span>${esc(when)}${esc(t.domain)}, ${sdur(t.est)}, effort ${t.effort}</span>${(t.missed || []).length ? `<em>pushed back ${t.missed.length}x</em>` : ''}</div>`;
};
function xpDrawTray() {
  const el = $('xpTray'); if (!el) return;
  const days = new Set(xpRangeDays()), l = xpTasks().filter(t => !t.done && t.start == null && (!t.day || days.has(t.day)));
  const c = xpCfg(), eff = [1, 2, 3, 4, 5].map(n => `<option value="${n}"${n === (c.lastEffort || 3) ? ' selected' : ''}>effort ${n}</option>`).join('');
  el.innerHTML = `<div class="xptl">${l.map(xpTrayBlock).join('') || '<span class="mute">No tasks waiting.</span>'}</div>
    <div class="xpnew"><input id="xpNT" placeholder="New task" maxlength="80" autocomplete="off">
      ${xpNewDom ? '<input id="xpNDn" class="xpnd" placeholder="New domain" maxlength="30" autocomplete="off">' : xpDomSelect(c.lastDomain || xpDomains()[0], 'id="xpND" title="Domain"')}
      <input id="xpNE" class="xpne" value="${esc(c.lastTime || '30m')}" title="Time: 45m, 1h30, 1:30, 2h..." autocomplete="off">
      <select id="xpNF" title="Effort">${eff}</select>
      <button class="go2" data-act="xpadd">ADD</button></div>`;
}

function xpDrawCal() {
  const el = $('xpCal'); if (!el) return;
  if (xpView === 'month') return xpDrawMonth(el);
  const days = xpRangeDays(), wk = days.length > 1, D = xpDepth() * (wk ? .6 : 1), k = D * Math.SQRT1_2;
  const PX = wk ? .8 : 1, pad = Math.round(5 * k) + 8, gut = 50, head = wk ? 34 : 0;
  const W = el.clientWidth || 400, colW = (W - gut - 4) / days.length, y = t => head + pad + t * PX, today = xpToday();
  const keyNow = xpView + days[0], old = xpScroll.key === keyNow ? xpScroll.top : null;
  let h = '';
  if (wk) h += `<div class="xpwh" style="height:${head}px;padding-left:${gut}px">${days.map(d => `<button class="${d === xpDate ? 'on' : ''}${d === today ? ' today' : ''}" data-act="xpsetday" data-v="${d}" style="width:${colW}px">${new Date(d + 'T12:00').toLocaleDateString(undefined, {weekday: 'short', day: 'numeric'})}</button>`).join('')}</div>`;
  for (let m = 0; m <= 1440; m += 30) h += `<div class="xph${m % 60 ? ' half' : ''}" style="top:${y(m)}px">${m % 60 || m === 1440 ? '' : `<span>${clock(m)}</span>`}</div>`;
  days.forEach((d, i) => { if (wk) h += `<div class="xpcol${d === xpDate ? ' on' : ''}" style="left:${gut + i * colW}px;width:${colW}px;top:${head}px"></div>`; });
  const ti = days.indexOf(today);
  if (ti >= 0) { const n = new Date(), nm = n.getHours() * 60 + n.getMinutes(); h += `<div class="xpnow" style="top:${y(nm)}px;left:${gut + ti * colW}px;width:${colW}px"></div>`; }
  let z = 2;
  days.forEach((d, i) => xpLanes(xpItemsFor(d)).sort((a, b) => a.start - b.start || b.lane - a.lane).forEach(x => {
    const lw = colW / x.lanes, e = x.effort * k, bx = gut + i * colW + x.lane * lw + 2, by = y(x.start), bh = Math.max(12, x.len * PX - 2), w = Math.max(20, lw - 4 - e);
    const f = xpFaces(xpCol(x.domain), x.kind), small = bh < 30, still = x.cut || x.kind === 'exp';
    const plan = x.kind === 'task' && x.done && !x.cut ? `<div class="xpplan" style="height:${x.t.est * PX - 2}px;transform:translate(${e}px,${-e}px)"></div>` : '';
    const info = [x.kind === 'busy' ? '' : esc(x.domain), `${clock(x.start)}-${clock(x.start + x.len)}`, `effort ${x.effort}`].filter(Boolean).join(', ');
    h += `<div class="xpb ${x.kind}${x.done ? ' done' : ''}${x.ghost ? ' ghost' : ''}${x.lifted ? ' lifted' : ''}${xpSel === x.id ? ' sel' : ''}" data-xid="${x.id}" data-day="${d}" style="left:${bx}px;top:${by}px;width:${w}px;height:${bh}px;z-index:${z++}">
      <svg class="xps" width="1" height="1"><polygon fill="${f.left}" points="0,0 ${e},${-e} ${e},${bh - e} 0,${bh}"/><polygon fill="${f.bot}" points="0,${bh} ${w},${bh} ${w + e},${bh - e} ${e},${bh - e}"/></svg>
      ${plan}<div class="xpf${small ? ' small' : ''}" data-xg="${still ? 'none' : 'move'}" style="transform:translate(${e}px,${-e}px);background:${f.top};color:${ink(f.top)}">
        <b>${x.done && x.kind === 'task' ? 'Done: ' : ''}${esc(x.title)}</b>${small ? '' : `<span>${info}</span>`}
        ${still || x.done ? '' : `${x.cutEnd ? '' : '<i class="xpgl" data-xg="len"></i>'}<i class="xpgz" data-xg="z">${x.effort}</i>`}</div></div>`;
  }));
  el.innerHTML = `<div class="xpplane" id="xpPlane" style="height:${head + pad + 1440 * PX + 16}px">${h}</div>`;
  el._geo = {key: keyNow, pad, gut, colW, PX, days, head};
  xpScroll.key = keyNow;
  // keep your place when redrawing; on a new day/week, start near now (or the first thing on it, or 7am)
  if (old != null) el.scrollTop = old;
  else {
    const firsts = days.flatMap(d => xpItemsFor(d).filter(x => x.kind !== 'busy').map(x => x.start)), n = new Date();
    const at = ti >= 0 ? n.getHours() * 60 + n.getMinutes() - 90 : firsts.length ? Math.min(...firsts) - 30 : 7 * 60;
    el.scrollTop = Math.max(0, y(at) - head);
  }
  xpScroll.top = el.scrollTop;
}
function xpDrawMonth(el) {
  const days = xpMonth(xpDate), first = xpShift(days[0], -((xpDow(days[0]) + 6) % 7)), today = xpToday(), cells = [];
  for (let d = first; cells.length < 42 && (d <= days[days.length - 1] || cells.length % 7); d = xpShift(d, 1)) cells.push(d);
  const g = xpDrag && xpDrag.mode === 'tray' && xpDrag.overDay;
  el.innerHTML = `<div class="xpmh">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(x => `<span>${x}</span>`).join('')}</div><div class="xpmg">${cells.map(d => {
    const s = xpTotals([d]), items = xpItemsFor(d).filter(x => x.kind !== 'busy' && !x.cut), un = xpTasks().filter(t => !t.done && t.day === d && t.start == null);
    const list = [...items.map(x => ({title: x.title, domain: x.domain, done: x.done})), ...un.map(t => ({title: t.title, domain: t.domain, open: true}))];
    return `<div class="xpmc${d.slice(0, 7) !== xpDate.slice(0, 7) ? ' out' : ''}${d === today ? ' today' : ''}${d === xpDate ? ' on' : ''}${g === d ? ' drop' : ''}" data-mday="${d}" data-act="xpgoday" data-v="${d}">
      <b>${+d.slice(8)}</b>${s.used ? `<span class="xpmm">${sdur(s.used)}, ${num1(s.usedE)} energy</span>` : ''}
      ${list.slice(0, 4).map(x => `<i style="border-color:${xpCol(x.domain)}" class="${x.done ? 'dn' : ''}${x.open ? ' op' : ''}">${esc(x.title)}</i>`).join('')}${list.length > 4 ? `<em>${list.length - 4} more</em>` : ''}</div>`;
  }).join('')}</div>`;
}

const xpRate = (key, cur, lo = 1) => `<div class="xpr">${[0, 1, 2, 3, 4, 5].filter(n => n >= lo).map(n => `<button class="${n === cur ? 'on' : ''}" data-act="xprate" data-k="${key}" data-v="${n}">${n}</button>`).join('')}</div>`;
const xpPct = (a, b) => { const p = Math.round((a / b - 1) * 100); return Math.abs(p) < 5 ? 'on target' : p > 0 ? `${p}% longer` : `${-p}% shorter`; };
function xpDrawSide() {
  const el = $('xpSide'); if (!el) return;
  const d = xpDay(xpDate), today = xpToday(), c = xpCfg();
  const t = xpTasks().find(x => x.id === xpSel), bf = !t && xpBusyFind(xpSel), e = !t && !bf && ents().find(x => x.id === xpSel);
  let h = '';
  if (xpDoneForm && t) {
    const f = xpDoneForm;
    h = `<h3>DONE: ${esc(t.title).toUpperCase()}</h3>
      <label>How long did it really take?</label><div class="xpmin"><button class="tag" data-act="xpmin" data-v="-15">-15</button><input id="xpDM" value="${sdur(f.min)}" autocomplete="off"><button class="tag" data-act="xpmin" data-v="15">+15</button></div>
      <p class="mute">Planned ${sdur(t.est)}</p>
      <label>How draining was it really?</label>${xpRate('effort', f.effort)}<p class="mute">Planned effort ${t.effort}</p>
      <label>How did it go?</label>${xpRate('went', f.went)}
      <label>Did you enjoy it?</label>${xpRate('enjoy', f.enjoy)}
      <button class="go" data-act="xpdone" ${f.went && f.enjoy ? '' : 'disabled'}>SAVE, +${Math.round(f.min)} EXP</button>
      <button class="link" data-act="xpcancel" style="display:block;margin:10px auto 0">Cancel</button>`;
  }
  else if (t) {
    const sh = xpShared(t), r = t.rep && (c.repeats || []).find(x => x.id === t.rep);
    h = `<h3>TASK</h3><input data-xf="title" value="${esc(t.title)}" maxlength="80">
      <div class="two"><div><label>Domain</label>${xpDomSelect(t.domain, 'data-xf="domain"')}</div>
        <div><label>Time</label><input data-xf="est" value="${sdur(t.est)}" autocomplete="off"></div></div>
      <label>Effort</label>${xpRate('teffort', t.effort)}
      <div class="two"><div><label>Day</label><input data-xf="day" type="date" value="${t.day || ''}"></div>
        <div><label>Starts</label><input data-xf="start" type="time" value="${t.start != null ? hmStr(t.start) : ''}"></div></div>
      <p class="mute">Costs ${num1(xpCost(t.est, t.effort))} energy${(t.missed || []).length ? `. Pushed back ${t.missed.length}x (${t.missed.map(x => x.slice(5)).join(', ')})` : ''}</p>
      ${t.done ? `<div class="xpvs"><b>Done, +${t.done.min} EXP</b>
          <div>Time: planned ${sdur(t.est)}, took ${sdur(t.done.min)} <em>${xpPct(t.done.min, t.est)}</em></div>
          <div>Effort: planned ${t.effort}, really ${t.done.effort}</div><div>Went ${t.done.went} of 5, enjoyed ${t.done.enjoy} of 5</div></div>
          <button class="link" data-act="xpundo">Undo done</button>`
        : `<button class="go" data-act="xpdoneopen">DONE</button>`}
      <div class="xplinks">${sh ? `<a class="link" href="/exp/${sh.num || ''}" data-act="go" data-v="exp/${sh.num || ''}">On EXP</a>` : '<button class="link" data-act="xpshare">Share to EXP</button>'}
        ${t.start != null && !t.done ? '<button class="link" data-act="xpunsched">Back to the tray</button>' : ''}
        ${r ? '<button class="link" data-act="xpstoprep">Stop repeating</button>' : ''}
        <button class="link" data-act="xpdel" data-v="${t.id}">Delete</button><button class="link" data-act="xpdesel">Close</button></div>`;
  }
  else if (bf) {
    const b = bf.b;
    h = `<h3>BUSY</h3><input data-xb="label" value="${esc(b.label || '')}" placeholder="Sleep, work, class..." maxlength="60">
      <div class="two"><div><label>From</label><input data-xb="start" type="time" value="${hmStr(b.start)}"></div><div><label>To</label><input data-xb="end" type="time" value="${hmStr(b.start + b.len)}"></div></div>
      <label>Effort</label>${xpRate('beffort', b.effort ?? 2, 0)}
      <p class="mute">${sdur(b.len)}, ${num1(xpCost(b.len, b.effort ?? 2))} energy. ${bf.rule ? xpRepOf(b) + '.' : 'This day only.'}</p>
      <div class="xplinks">${bf.rule ? '<button class="link" data-act="xpbskip">Remove from this day</button><button class="link" data-act="xpbdel">Delete every day</button>' : '<button class="link" data-act="xpbdel">Delete</button>'}<button class="link" data-act="xpdesel">Close</button></div>`;
  }
  else if (e) {
    h = `<h3>EXP</h3><p class="xpet">${esc(e.title)}</p>
      <p class="mute">${esc(tagsOf(e, 'types').join(', '))}${e.start ? `, ${new Date(e.start).toLocaleDateString(undefined, {month: 'short', day: 'numeric'})} ${clock(new Date(e.start).getHours() * 60 + new Date(e.start).getMinutes())}, ${sdur(e.minutes || 0)}` : ''}, rated ${e.rating || '-'} of 5</p>
      <label>Effort</label>${xpRate('eeffort', e.effort ?? 0, 0)}
      <div class="xplinks"><button class="link" data-act="xpeopen">Edit in EXP</button>${e.num ? `<a class="link" href="/exp/${e.num}" data-act="go" data-v="exp/${e.num}">View</a>` : ''}<button class="link" data-act="xpdesel">Close</button></div>`;
  }
  else {
    const past = [];   // energy actually used on recent days, to judge the budget by
    for (let i = 1; i <= 14; i++) { const k = xpShift(today, -i), l = xpItemsFor(k).filter(x => x.kind !== 'busy' ? x.done : true); if (l.some(x => x.kind !== 'busy')) past.push(l.reduce((a, x) => a + xpCost(x.len, x.effort), 0)); }
    const busy = xpBusyOn(xpDate).sort((a, b) => a.start - b.start), dl = new Date(xpDate + 'T12:00').toLocaleDateString(undefined, {weekday: 'long', month: 'short', day: 'numeric'});
    const offCal = xpTasks().filter(x => x.done && x.done.day === xpDate && x.start == null), ideas = xpRepeatIdeas();
    h = `<h3>${esc(dl).toUpperCase()}</h3>
      ${d.tank == null && d.budget == null && xpDate >= today ? `<div class="xpcheck"><p>How full is the tank?</p>${xpRate('tank', null)}</div>` : `<label>Tank</label>${xpRate('tank', d.tank)}`}
      <div class="two"><div><label>Energy budget</label><input data-xday="budget" type="number" min="0" step="1" value="${d.budget ?? ''}" placeholder="${num1(xpBudget(d))}"></div>
        <div><label>Energy per tank level</label><input data-xcfg="tankSize" type="number" min="1" step="1" value="${xpTank()}"></div></div>
      ${past.length >= 3 ? `<p class="mute">Used about ${num1(past.reduce((a, b) => a + b, 0) / past.length)} a day over your last ${past.length} logged days.</p>` : ''}
      <h3>BUSY</h3>
      ${busy.map(x => `<button class="tag xprow" data-act="xpsel" data-v="${x.id}">${esc(x.label || 'Busy')} <span>${clock(x.start)}-${clock(x.start + x.len)}${x.rule ? ', ' + xpRepOf(x).toLowerCase() : ''}</span></button>`).join('')}
      <div class="xpbadd"><input id="xpBL" placeholder="Sleep, work..." maxlength="60"><input id="xpBF" type="time" value="23:00"><input id="xpBT" type="time" value="07:00">
        <select id="xpBR">${XP_REPEATS.map(([v, l]) => `<option value="${v}"${v === 'daily' ? ' selected' : ''}>${l}${v === 'dow' ? XP_DOWS[xpDow(xpDate)] : ''}</option>`).join('')}</select><button class="go2" data-act="xpbadd">ADD</button></div>
      ${ideas.map(x => `<div class="xpidea"><p>"${esc(x.t.title)}" on ${XP_DOWS[x.dow]}s around ${clock(x.slot)}, ${x.days.size} times. Repeat it every ${XP_DOWS[x.dow]}?</p>
        <button class="tag" data-act="xprep" data-v="${esc(x.key)}">Repeat it</button> <button class="link" data-act="xpnorep" data-v="${esc(x.key)}">No</button></div>`).join('')}
      ${offCal.length ? `<h3>DONE OFF THE CALENDAR</h3>${offCal.map(x => `<button class="tag xprow" data-act="xpsel" data-v="${x.id}">${esc(x.title)} <span>+${xpExp1(x)} EXP</span></button>`).join('')}` : ''}`;
  }
  el.innerHTML = h;
}

/* --- DOMAINS tab: what your finished tasks and EXP entries add up to, per domain --- */
function xpDrawStats() {
  const el = $('xpStats'); if (!el) return;
  const since = xpRange === 'all' ? '' : xpShift(xpToday(), xpRange === 'week' ? -6 : -29);
  const T = xpTasks(), done = T.filter(t => t.done && (t.done.day || '') >= since);
  const E = ents().filter(e => !e.task && e.start && xpKey(e.start) >= since);   // EXP entries count too (shared ones already count as their task)
  const total = done.reduce((a, t) => a + t.done.min, 0) + E.reduce((a, e) => a + (e.minutes || 0), 0);
  const avg = l => l.length ? l.reduce((a, v) => a + v, 0) / l.length : null;
  const of = (e, dm) => tagsOf(e, 'types').some(x => key(x) === key(dm));
  const rows = xpDomains().map(dm => {
    const l = done.filter(t => key(t.domain) === key(dm)), le = E.filter(e => of(e, dm)), est = l.reduce((a, t) => a + t.est, 0);
    const min = l.reduce((a, t) => a + t.done.min, 0) + le.reduce((a, e) => a + (e.minutes || 0), 0), tmin = l.reduce((a, t) => a + t.done.min, 0);
    const missed = T.filter(t => key(t.domain) === key(dm)).reduce((a, t) => a + (t.missed || []).filter(x => x >= since).length, 0);
    return {dm, n: l.length + le.length, min, share: total ? min / total : 0, went: avg(l.map(t => t.done.went)), enjoy: avg([...l.map(t => t.done.enjoy), ...le.filter(e => e.rating).map(e => e.rating)]),
      effD: avg(l.map(t => t.done.effort - t.effort)), pct: est ? (tmin / est - 1) * 100 : null, missed, tasks: l.length};
  }).filter(r => r.n || r.missed).sort((a, b) => b.min - a.min);
  const f2 = v => v == null ? '-' : v.toFixed(1);
  const chip = dm => `<span class="chip" style="background:${xpCol(dm)};color:${ink(xpCol(dm))}">${esc(dm)}</span>`;
  const ok = rows.filter(r => r.n >= 2), lo = (k, word) => { const r = ok.filter(x => x[k] != null).sort((a, b) => a[k] - b[k])[0]; return r && r[k] < 3.5 ? `<li>${chip(r.dm)} ${word} (${r[k].toFixed(1)} of 5).</li>` : ''; };
  const under = ok.filter(r => r.pct != null && r.tasks >= 2).sort((a, b) => b.pct - a.pct)[0], pushed = [...rows].sort((a, b) => b.missed - a.missed)[0], big = rows[0];
  const notes = [big && big.n ? `<li>${chip(big.dm)} takes the most of your time: ${Math.round(big.share * 100)}% (${sdur(big.min)}).</li>` : '',
    lo('enjoy', 'is what you enjoy least'), lo('went', 'goes worst'),
    under && under.pct > 10 ? `<li>${chip(under.dm)} tasks take ${Math.round(under.pct)}% longer than you plan.</li>` : '',
    pushed && pushed.missed ? `<li>${chip(pushed.dm)} gets pushed back the most (${pushed.missed}x).</li>` : ''].join('');
  const rb = (v, l) => `<button class="tag ${xpRange === v ? 'on' : ''}" data-act="xprange" data-v="${v}">${l}</button>`;
  const recent = [...done].sort((a, b) => (b.done.at || '').localeCompare(a.done.at || '')).slice(0, 20);
  const exTypes = new Set(ents().flatMap(e => tagsOf(e, 'types')).map(key));
  el.innerHTML = `<div class="tl srt">${rb('week', 'Last 7 days')}${rb('month', 'Last 30 days')}${rb('all', 'All time')}</div>
    ${notes ? `<h3>WHAT STANDS OUT</h3><ul class="xpnotes">${notes}</ul>` : ''}
    <h3>BY DOMAIN</h3>
    ${rows.length ? table(['Domain', 'Done', 'Time', 'Share', 'Went', 'Enjoyed', 'Time vs plan', 'Effort vs plan', 'Pushed back'],
      rows.map(r => [chip(r.dm), r.n, sdur(r.min), `<span class="xpshare"><i style="width:${Math.round(r.share * 100)}%"></i></span>${Math.round(r.share * 100)}%`,
        f2(r.went), f2(r.enjoy), r.pct == null ? '-' : xpPctRow(r), r.effD == null ? '-' : (r.effD > 0 ? '+' : '') + num1(r.effD), r.missed || '-']), 'xptable')
      : '<p class="mute">Nothing finished in this stretch yet.</p>'}
    ${recent.length ? `<h3>ESTIMATES VS REALITY</h3>${table(['Task', 'Domain', 'Day', 'Time: plan, real', 'Effort: plan, real', 'Went', 'Enjoyed'],
      recent.map(t => [esc(t.title), chip(t.domain), t.done.day.slice(5), `${sdur(t.est)}, ${sdur(t.done.min)} <span class="mute">${xpPct(t.done.min, t.est)}</span>`, `${t.effort}, ${t.done.effort}`, t.done.went, t.done.enjoy]), 'xptable')}` : ''}
    <h3>DOMAINS</h3><div class="xpdoms">${xpDomains().map(dm => `<span class="xpdom"><input type="color" data-xcol="${esc(dm)}" value="${xpCol(dm)}">${esc(dm)}${exTypes.has(key(dm)) ? '' : `<button class="link" data-act="xpdomdel" data-v="${esc(dm)}">remove</button>`}</span>`).join('')}</div>
    <div class="xpnew"><input id="xpNewDom" placeholder="New domain" maxlength="30"><button class="go2" data-act="xpdomadd">ADD</button></div>`;
}
const xpPctRow = r => { const p = Math.round(r.pct); return Math.abs(p) < 5 ? 'on target' : p > 0 ? `${p}% longer` : `${-p}% shorter`; };

/* --- Share to EXP: open the EXP log form filled in from the task; saving it links the two --- */
function xpShare(t) {
  const len = xpLen(t), base = t.day ? new Date(t.day + 'T00:00') : null;
  const s = base && t.start != null ? new Date(+base + t.start * 6e4) : new Date(Date.now() - len * 6e4), e = new Date(+s + len * 6e4);
  openModal('e');
  $('t').value = t.title; $('s').value = loc(s); $('e').value = loc(e);
  draft.types = [t.domain]; draft.rating = t.done ? t.done.enjoy : 0; draft.fromTask = t.id; draft.effort = xpEff(t);
  drawDraft(); drawStars(); updExp();
}

/* --- clicks --- */
document.addEventListener('click', ev => {
  if (page !== 'expro') return;
  const b = ev.target.closest('[data-act^="xp"]'); if (!b) return;
  const a = b.dataset.act, v = b.dataset.v, d = xpDay(xpDate), c = xpCfg(), t = xpTasks().find(x => x.id === xpSel);
  if (a === 'xpday') { xpDate = v === '0' ? xpToday() : xpView === 'month' ? (() => { const z = new Date(xpDate.slice(0, 7) + '-15T12:00'); z.setMonth(z.getMonth() + +v); return xpKey(z).slice(0, 8) + '01'; })() : xpShift(xpDate, +v * (xpView === 'week' ? 7 : 1)); xpSel = xpDoneForm = null; renderExpro(); }
  else if (a === 'xpview') { xpView = v; renderExpro(); }
  else if (a === 'xpsetday') { xpDate = v; xpSel = xpDoneForm = null; xpDrawCal(); xpDrawSide(); }
  else if (a === 'xpgoday') { if (xpDrag) return; xpDate = v; xpView = 'day'; xpSel = xpDoneForm = null; renderExpro(); }
  else if (a === 'xprange') { xpRange = v; xpDrawStats(); }
  else if (a === 'xpadd') xpAdd();
  else if (a === 'xpsel') { xpSel = v; xpDoneForm = null; xpDrawSide(); xpDrawCal(); }
  else if (a === 'xpdesel') { xpSel = xpDoneForm = null; renderExpro(); }
  else if (a === 'xprate') {
    const n = +v, k = b.dataset.k, e = ents().find(x => x.id === xpSel);
    if (k === 'tank') xpSaveDay({tank: n});
    else if (k === 'teffort' && t) xpSaveTask(t.id, {effort: n});
    else if (k === 'beffort') xpSaveBusy(xpSel, {effort: n});
    else if (k === 'eeffort' && e) put({...e, effort: n});
    else if (xpDoneForm) { xpDoneForm[k] = n; xpDrawSide(); }
  }
  else if (a === 'xpdoneopen' && t) { xpDoneForm = {min: t.est, effort: t.effort, went: null, enjoy: null}; xpDrawSide(); }
  else if (a === 'xpmin' && xpDoneForm) { xpDoneForm.min = Math.max(5, xpDoneForm.min + +v); xpDrawSide(); }
  else if (a === 'xpcancel') { xpDoneForm = null; xpDrawSide(); }
  else if (a === 'xpdone' && t && xpDoneForm) {
    const f = xpDoneForm; xpDoneForm = null;
    xpSaveTask(t.id, {done: {...f, day: t.day || xpDate, at: new Date().toISOString()}, day: t.day || xpDate}, `+${Math.round(f.min)} EXP, ${t.title} done`);
  }
  else if (a === 'xpundo' && t) xpSaveTask(t.id, {done: null});
  else if (a === 'xpunsched' && t) xpSaveTask(t.id, {day: null, start: null});
  else if (a === 'xpshare' && t) xpShare(t);
  else if (a === 'xpeopen') { const e = ents().find(x => x.id === xpSel); if (e) openModal('e', e); }
  else if (a === 'xpstoprep' && t) xpSaveCfg({repeats: (c.repeats || []).filter(r => r.id !== t.rep)}, 'It won\'t repeat any more');
  else if (a === 'xpdel') {
    if (b.dataset.arm) xpDelete(v);
    else { b.dataset.arm = 1; b.textContent = 'Click again to delete'; setTimeout(() => { delete b.dataset.arm; b.textContent = 'Delete'; }, 3000); }
  }
  else if (a === 'xpbadd') {
    const f = hm($('xpBF').value || '00:00'), to = hm($('xpBT').value || '00:00'), len = to > f ? to - f : to + 1440 - f, rep = $('xpBR').value;
    const blk = {id: xpId('b'), label: $('xpBL').value.trim(), start: f, len, effort: 2};
    if (rep === 'once') xpSaveDay({busy: [...(d.busy || []), blk]});
    else xpSaveCfg({busyRules: [...(c.busyRules || []), {...blk, dows: xpDowsOf(rep, xpDate)}]});
  }
  else if (a === 'xpbskip') { xpSaveDay({skip: [...(d.skip || []), xpSel]}); xpSel = null; }
  else if (a === 'xpbdel') {
    const f = xpBusyFind(xpSel); xpSel = null; if (!f) return;
    if (f.rule) xpSaveCfg({busyRules: c.busyRules.filter(r => r.id !== f.b.id)});
    else xpSaveDay({busy: xpDay(f.day).busy.filter(x => x.id !== f.b.id)}, f.day);
  }
  else if (a === 'xprep' || a === 'xpnorep') {
    const idea = xpRepeatIdeas().find(x => x.key === v); if (!idea) return;
    if (a === 'xpnorep') xpSaveCfg({noRepeat: [...(c.noRepeat || []), v]});
    else xpSaveCfg({repeats: [...(c.repeats || []), {id: xpId('r'), key: v, title: idea.t.title, domain: idea.t.domain, est: idea.t.est, effort: idea.t.effort, dow: idea.dow, start: idea.t.start}]},
      `"${idea.t.title}" will show up every ${XP_DOWS[idea.dow]}`);
  }
  else if (a === 'xpdomadd') { const p = xpAddDomain($('xpNewDom').value); if (p.domains) xpSaveCfg(p); }
  else if (a === 'xpdomdel') {
    if (b.dataset.arm) xpSaveCfg({domains: (c.domains || XP_DOMAINS).filter(x => x !== v)});
    else { b.dataset.arm = 1; b.textContent = 'remove?'; setTimeout(() => { delete b.dataset.arm; b.textContent = 'remove'; }, 3000); }
  }
});
function xpAdd() {
  const title = $('xpNT').value.trim(); if (!title) { $('xpNT').focus(); return; }
  const est = xpParse($('xpNE').value);
  if (!est) { flash('Time: try 45m, 1h30, 1:30 or 2h'); $('xpNE').focus(); return; }
  const domain = xpNewDom ? $('xpNDn').value.trim() : $('xpND').value;
  if (!domain) { $('xpNDn').focus(); return; }
  const effort = +$('xpNF').value;
  xpNewDom = false;
  xpSave([{id: xpId('t'), kind: 'task', is_public: false, title, domain, est, effort, day: null, start: null, created: new Date().toISOString()},
    {...xpCfg(), ...xpAddDomain(domain), lastDomain: domain, lastTime: sdur(est), lastEffort: effort}]);
  setTimeout(() => $('xpNT') && $('xpNT').focus());
}
/* --- typing --- */
document.addEventListener('keydown', ev => {
  if (page !== 'expro') return;
  if (ev.key === 'Enter' && ['xpNT', 'xpNE', 'xpNDn'].includes(ev.target.id)) { ev.preventDefault(); xpAdd(); }
  if (ev.key === 'Enter' && ev.target.id === 'xpNewDom') { ev.preventDefault(); document.querySelector('[data-act="xpdomadd"]').click(); }
  if (ev.key === 'Escape' && (xpSel || xpDoneForm) && !ev.target.closest('input,select')) { xpSel = xpDoneForm = null; renderExpro(); }
});
document.addEventListener('input', ev => {
  if (page !== 'expro') return;
  if (ev.target.id === 'xpDepth') { xpDepthLive = +ev.target.value; xpDrawCal(); }
});
document.addEventListener('change', ev => {
  if (page !== 'expro') return;
  const e = ev.target, v = e.value, d = xpDay(xpDate), t = xpTasks().find(x => x.id === xpSel);
  if (e.id === 'xpDepth') { xpDepthLive = null; xpSaveCfg({depth: +v}); }
  else if (e.id === 'xpND' && v === '__new') { const keep = $('xpNT').value, tm = $('xpNE').value; xpNewDom = true; xpDrawTray(); $('xpNT').value = keep; $('xpNE').value = tm; $('xpNDn').focus(); }
  else if (e.id === 'xpDM' && xpDoneForm) { const m = xpParse(v); if (m) xpDoneForm.min = m; xpDrawSide(); }
  else if (e.dataset.xf && t) {
    const k = e.dataset.xf;
    if (k === 'title' && v.trim()) xpSaveTask(t.id, {title: v.trim()});
    else if (k === 'domain' && v === '__new') e.outerHTML = '<input data-xf="domainNew" placeholder="New domain" maxlength="30">', document.querySelector('[data-xf="domainNew"]').focus();
    else if (k === 'domain') xpSaveTask(t.id, {domain: v});
    else if (k === 'domainNew' && v.trim()) { xpSaveCfg(xpAddDomain(v)); xpSaveTask(t.id, {domain: v.trim()}); }
    else if (k === 'est') { const m = xpParse(v); if (m) xpSaveTask(t.id, {est: m}); else flash('Time: try 45m, 1h30, 1:30 or 2h'); }
    else if (k === 'day') xpSaveTask(t.id, v ? {day: v} : {day: null, start: null});
    else if (k === 'start') xpSaveTask(t.id, v ? {start: hm(v), day: t.day || xpDate} : {start: null});
  }
  else if (e.dataset.xb) {
    const k = e.dataset.xb, f = xpBusyFind(xpSel); if (!f) return;
    if (k === 'label') xpSaveBusy(xpSel, {label: v.trim()});
    else if (v) { const m = hm(v); xpSaveBusy(xpSel, k === 'start' ? {start: m} : {len: m > f.b.start ? m - f.b.start : m + 1440 - f.b.start}); }
  }
  else if (e.dataset.xday === 'budget') xpSaveDay({budget: v === '' ? null : Math.max(0, +v)});
  else if (e.dataset.xcfg === 'tankSize' && +v > 0) xpSaveCfg({tankSize: +v});
  else if (e.dataset.xcol) setColor('types', e.dataset.xcol, v);
});

/* --- dragging: tray to calendar, moving blocks, stretching time (bottom edge) and effort (corner number) --- */
const xpOverTray = ev => { const el = document.elementFromPoint(ev.clientX, ev.clientY); return !!(el && el.closest('#xpTray')); };
document.addEventListener('pointerdown', ev => {
  if (page !== 'expro' || ev.button) return;
  const g = ev.target.closest('[data-xg]'); if (!g) return;
  const blk = g.closest('[data-xid]'), id = blk.dataset.xid, day = blk.dataset.day, mode = g.dataset.xg;
  let item = null;
  if (mode === 'tray') { const t = xpTasks().find(x => x.id === id); item = {id, kind: 'task', t, title: t.title, domain: t.domain, len: t.est, effort: t.effort}; }
  else if (mode !== 'none') item = xpRaw(day).find(x => x.id === id);
  xpDrag = {mode, id, day0: day, x0: ev.clientX, y0: ev.clientY, moved: false, item, cur: item ? {day, start: item.start, len: item.len, effort: item.effort} : {}};
  ev.preventDefault();
});
document.addEventListener('pointermove', ev => {
  const g = xpDrag; if (!g || g.mode === 'none') return;
  const dx = ev.clientX - g.x0, dy = ev.clientY - g.y0;
  if (!g.moved && Math.hypot(dx, dy) < 4) return;
  g.moved = true;
  const cal = $('xpCal'), geo = cal._geo, box = cal.getBoundingClientRect();
  if (xpView === 'month') {   // only tray tasks drop onto a month: onto a day
    if (g.mode !== 'tray') return;
    const el = document.elementFromPoint(ev.clientX, ev.clientY), cell = el && el.closest('[data-mday]');
    g.overDay = cell ? cell.dataset.mday : null;
    xpGhost(ev, g, false); xpDrawMonth(cal); return;
  }
  const r = $('xpPlane').getBoundingClientRect(), colAt = () => geo.days[Math.max(0, Math.min(geo.days.length - 1, Math.floor((ev.clientX - r.left - geo.gut) / geo.colW)))];
  const timeAt = off => Math.max(0, Math.min(1440 - XP_SNAP, xpSnap((ev.clientY - r.top - geo.head - geo.pad) / geo.PX - off)));
  if (g.mode === 'tray') {
    g.over = ev.clientX > box.left && ev.clientX < box.right && ev.clientY > box.top && ev.clientY < box.bottom;
    g.cur = {day: colAt(), start: timeAt(10), len: g.item.len, effort: g.item.effort};
    xpGhost(ev, g, g.over);
  }
  else if (g.mode === 'move') {
    g.toTray = g.item.kind === 'task' && xpOverTray(ev);
    g.cur.start = Math.max(0, Math.min(1440 - XP_SNAP, xpSnap(g.item.start + dy / geo.PX)));
    if (g.item.kind === 'task') g.cur.day = colAt();
    $('xpTray').classList.toggle('drop', g.toTray);
  }
  else if (g.mode === 'len') g.cur.len = Math.max(XP_SNAP, Math.min(1440, xpSnap(g.item.len + dy / geo.PX)));
  else if (g.mode === 'z') g.cur.effort = Math.max(g.item.kind === 'busy' ? 0 : 1, Math.min(5, Math.round(g.item.effort + (dx - dy) / Math.SQRT2 / Math.max(4, xpDepth() * (geo.days.length > 1 ? .6 : 1)))));
  if (ev.clientY < box.top + 30) cal.scrollTop -= 14; else if (ev.clientY > box.bottom - 30) cal.scrollTop += 14;   // drag near the edge: scroll
  xpDrawCal(); xpDrawMeters();
});
function xpGhost(ev, g, hide) {
  let gh = $('xpGhost');
  if (!gh) { gh = document.createElement('div'); gh.id = 'xpGhost'; gh.className = 'xpghost'; gh.textContent = g.item.title; document.body.appendChild(gh); }
  gh.hidden = hide; gh.style.left = ev.clientX + 8 + 'px'; gh.style.top = ev.clientY + 8 + 'px';
}
document.addEventListener('pointerup', () => {
  const g = xpDrag; if (!g) return;
  xpDrag = null;
  const gh = $('xpGhost'); if (gh) gh.remove();
  if (!g.moved) { if (xpSel !== g.id) { xpSel = g.id; xpDoneForm = null; } xpDrawSide(); xpDrawCal(); xpDrawTray(); return; }
  if (g.mode === 'tray') {
    if (xpView === 'month' && g.overDay) xpSaveTask(g.id, {day: g.overDay, start: null});
    else if (xpView !== 'month' && g.over) { xpSel = g.id; xpSaveTask(g.id, {day: g.cur.day, start: g.cur.start}); }
    else renderExpro();
    return;
  }
  if (g.item.kind === 'busy') xpSaveBusy(g.id, {start: g.cur.start, len: g.cur.len, effort: g.cur.effort});
  else if (g.mode === 'move') xpSaveTask(g.id, g.toTray ? {day: null, start: null} : {day: g.cur.day, start: g.cur.start});
  else if (g.mode === 'len') xpSaveTask(g.id, {est: g.cur.len});
  else if (g.mode === 'z') xpSaveTask(g.id, {effort: g.cur.effort});
});
window.addEventListener('resize', () => { if (page === 'expro' && !['domains', 'month'].includes(xpView)) xpDrawCal(); });
setInterval(() => { if (page === 'expro' && !xpDrag && ['day', 'week'].includes(xpView) && xpRangeDays().includes(xpToday())) xpDrawCal(); }, 60e3);   // keep the "now" line moving
