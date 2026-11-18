/* EXPRO (/expro): your private planner for serious life stuff. Only you can see it (every row it saves is private).
   This file loads before app.js and only defines things; app.js calls renderExpro() from render().

   HOW IT FITS TOGETHER
   - YOUR TASKS (the grid on top) are permanent: each one is a kind of task (title, domain, time, effort) that stays there
     forever. Newest go top-left; drag them to rearrange, or into the CHEST to shelve them (click the chest to see what's in it).
     Dragging one onto the calendar puts a copy of it there. Double-clicking an empty spot on the calendar makes a task right
     there; typing a title you've used before fills in the rest, and a brand-new title also becomes a new block in the grid.
   - The calendar (Days: any number of days in a row, starting on any day; Month) shows 24-hour days. Up and down is time; how
     far a block sticks out toward you (the Z axis) is effort. Pinch or ctrl+scroll (or + and -) zooms the hours, from the whole
     day down to 10-minute lines; swiping sideways (or the arrow keys) moves a day at a time. Drag a block to move it, its edges
     to change its time and days, its corner number for effort.
   - BUSY blocks are time that isn't a task (sleep, work, class); they can repeat.
   - ENERGY = effort x hours (2 hours at effort 3 = 6). There's no budget to set: EXPRO counts what you've spent so far and what
     you've planned for a day, against the most a person can keep up in a day (XP_MAX_DAY below). After XP_LEARN_DAYS days of
     finished things it also knows your own average day and shows it.
   - EXP is the same as on the EXP page: 1 per minute. Finished tasks count toward TOTAL EXP. Domains and EXP Types are one
     list; EXP entries show on the calendar; "Share to EXP" turns a task into an EXP entry (then it's counted once).
   - Unfinished tasks from past days move to the "No time yet" row. The same task on the same weekday at about the same time
     3 times: EXPRO offers to repeat it every week.

   SAVED AS (in the same Supabase "items" table as everything else, all private):
     tasktype   one block in the grid: {title, domain (the first one; its color), domains (all of them, when more than one), est, effort, notes, subs:[{id, text, done}], order, archived}
     task       one on the calendar: {title, domain, domains, est, effort, notes, subs, day, start, span (days in a row), tpl, done:{min, effort, sat (satisfaction 1-5; older ones have went and enjoy), day, at}, missed:[days], rep}
     day        id "day-YYYY-MM-DD": {date, busy:[{id, label, start, len, effort}], skip:[busy rule ids]}
     exprocfg   id "exprocfg": {domains, depth, busyRules, repeats, noRepeat, last*, tplDone, avgTold}
   Times are minutes after midnight; a block can run past midnight. EXP entries can carry "effort" and, when shared from a task, "task". */

const XP_DOMAINS = ['Work', 'Money', 'Health', 'Home', 'Admin', 'People', 'Family', 'Creative'];
const XP_SNAP = 15;
const XP_DOWS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const XP_REPEATS = [['once', 'This day only'], ['daily', 'Every day'], ['weekdays', 'Weekdays'], ['weekends', 'Weekends'], ['dow', 'Every ']];
/* The most energy a person can keep up in a day: about 16 waking hours at an average effort of 3 = 48, so 50; you can do that
   now and then, not daily. Everything is counted per day. */
const XP_MAX_DAY = 50, XP_LEARN_DAYS = 14;
/* SLEEP: anything called sleep (a busy block, a task, an EXP entry or its type). It costs no energy and isn't "booked" time.
   A day's night is from 3pm the day before to 3pm that day. The goal is XP_SLEEP (7h 30m); less than that lowers the day's
   max energy in step (6h = 80%), more lowers it half as fast (9h = 90%). Real sleep (EXP entries, finished tasks) counts over
   planned sleep. On the calendar, hours everyone in view is asleep (and nothing else is on) fold down to a thin band. */
const XP_SLEEP = 450, XP_FOLD = 26;
const XP_PX = .8, XP_PX_MAX = 12;   // calendar pixels per minute: the starting zoom, and the closest (12 = 120px per 10 minutes)
let xpPx = null, xpN = null, xpStart = null, xpUnfold = false;
let xpSelIdx = null, xpScopeAll = false;   // a task running several days: which day you picked, and whether changes go to every day   // zoom, how many days you see, the first one
let xpView = 'days', xpDate = null, xpSel = null, xpDoneForm = null, xpNotForm = null, xpRange = 'week', xpDrag = null, xpDepthLive = null;
let xpNewTimely = false, xpNewDom = false, xpChest = false, xpMini = null, xpRolled = '', xpMigrated = false;
const xpRepMade = new Set();
const xpScroll = {key: null, top: 0};   // where the calendar is scrolled to, kept across redraws
document.addEventListener('scroll', ev => { if (ev.target.id === 'xpCal') xpScroll.top = ev.target.scrollTop; }, true);

/* --- small helpers --- */
const xpKey = d => { const z = new Date(d); z.setMinutes(z.getMinutes() - z.getTimezoneOffset()); return z.toISOString().slice(0, 10); };   // YYYY-MM-DD, your time zone
const xpToday = () => xpKey(new Date());
const xpShift = (k, n) => { const d = new Date(k + 'T12:00'); d.setDate(d.getDate() + n); return xpKey(d); };
const xpDow = k => new Date(k + 'T12:00').getDay();
const xpMonth = k => { const l = [], p = k.slice(0, 7); for (let d = p + '-01'; d.startsWith(p); d = xpShift(d, 1)) l.push(d); return l; };
const xpRangeDays = () => xpView === 'month' ? xpMonth(xpDate) : Array.from({length: xpN || 7}, (_, i) => xpShift(xpStart || xpToday(), i));
const xpTimed = () => xpView === 'days';   // the view with hours down the side
const xpId = p => p + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const xpTasks = () => all.filter(x => x.kind === 'task');
const xpTpls = (arch = false) => all.filter(x => x.kind === 'tasktype' && !!x.archived === arch).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
// TIMELY blocks: {from, to, n}. They show only between those dates, and only until they've gone on the calendar n times
// (a task marked not done gives its occurrence back)
const xpUsed = p => xpTasks().filter(t => t.tpl === p.id && !t.skipped).length;
const xpLeft = p => p.timely ? Math.max(0, (p.timely.n || 1) - xpUsed(p)) : Infinity;
const xpNow = p => !p.timely || (xpLeft(p) > 0 && (!p.timely.from || p.timely.from <= xpToday()) && (!p.timely.to || xpToday() <= p.timely.to));
const xpMD = k => new Date(k + 'T12:00').toLocaleDateString(undefined, {month: 'short', day: 'numeric'});
const xpNotNow = p => xpLeft(p) <= 0 ? 'USED UP' : p.timely.from && p.timely.from > xpToday() ? 'FROM ' + xpMD(p.timely.from).toUpperCase() : 'ENDED';
const xpSec = (sec, arch) => arch ? [...xpTpls(true), ...xpTpls().filter(p => !xpNow(p))] : xpTpls().filter(p => !!p.timely === (sec === 't') && xpNow(p));
const xpTplByTitle = t => all.find(x => x.kind === 'tasktype' && key(x.title) === key(t));
const xpCfg = () => all.find(x => x.id === 'exprocfg') || {id: 'exprocfg', kind: 'exprocfg'};
const xpDomains = () => uniq('types', [...(xpCfg().domains || XP_DOMAINS), ...ents().flatMap(e => tagsOf(e, 'types'))]);   // your domains + every EXP Type
const xpCol = d => d ? tcol('types', d) : '#4b5568';
const xpDepth = () => xpDepthLive ?? xpCfg().depth ?? 9;
const hm = s => { const [h, m] = String(s).split(':').map(Number); return h * 60 + (m || 0); };
const hmStr = m => { m = ((Math.round(m) % 1440) + 1440) % 1440; return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
const clock = m => { m = ((Math.round(m) % 1440) + 1440) % 1440; const h = Math.floor(m / 60), mm = m % 60; return (h % 12 || 12) + (mm ? ':' + String(mm).padStart(2, '0') : '') + (h < 12 ? 'am' : 'pm'); };
const sdur = m => (m < 0 ? '-' : '') + dur(Math.abs(Math.round(m)));
const num1 = n => String(Math.round(n * 10) / 10);
const xpCost = (min, eff) => min / 60 * eff;
const xpStep = () => (xpPx || XP_PX) >= 4 ? 1 : xpPx >= 2 ? 5 : xpPx >= 1.2 ? 10 : XP_SNAP;   // the closer you zoom, the finer blocks snap (down to 1 minute)
const xpSnap = m => Math.round(m / xpStep()) * xpStep();
function xpParse(s) {   // "45", "45m", "1h", "1.5h", "1h30", "1h 30m", "1:30" -> minutes
  s = String(s).trim().toLowerCase(); let m;
  if ((m = s.match(/^(\d+):(\d{1,2})$/))) return +m[1] * 60 + +m[2];
  if ((m = s.match(/^(\d+(?:\.\d+)?)\s*h[a-z]*\s*(?:(\d+)\s*m?[a-z]*)?$/))) return Math.round(+m[1] * 60 + (+m[2] || 0));
  if ((m = s.match(/^(\d+)\s*m?[a-z]*$/))) return +m[1];
  return null;
}
const xpShared = t => ents().find(e => e.task === t.id);
const xpExp1 = t => t.done && !xpShared(t) ? Math.round(t.done.min) : 0;   // shared tasks count once, as their EXP entry
const exproExp = () => xpTasks().reduce((a, t) => a + xpExp1(t), 0);   // app.js adds this to TOTAL EXP
const xpSpan = t => t.span || 1;   // how many days in a row a task runs (same time each day)
const xpLast = t => xpShift(t.day, xpSpan(t) - 1);
const xpGap = (a, b) => Math.round((new Date(b + 'T12:00') - new Date(a + 'T12:00')) / 864e5);   // days from a to b
const xpEstT = t => t.est * xpSpan(t);   // the whole plan, all its days together
const xpLen = t => t.done ? t.done.min / xpSpan(t) : t.est;   // one day's length
const xpEff = t => t.done ? t.done.effort : t.effort;
// a copy of a grid block's description and subtasks for a new task on the calendar (subtasks start unticked)
// a task or block can have several domains: the first one gives it its color
const xpDoms = o => o ? [...new Set((o.domains && o.domains.length ? o.domains : [o.domain]).filter(Boolean))] : [];
const xpDomPatch = l => ({domain: l[0], domains: l.length > 1 ? l : undefined});
const xpDomTxt = o => xpDoms(o).join(' + ');
const xpFromTpl = p => p ? {domains: p.domains && p.domains.length > 1 ? p.domains : undefined, notes: p.notes || undefined, subs: (p.subs || []).map(x => ({id: xpId('s'), text: x.text, done: false}))} : {};
// planned things you didn't do, still waiting to be made up (a make-up only counts while it isn't itself not done)
const xpOwed = p => xpTasks().filter(t => t.skipped && !t.skipped.forgiven && (t.tpl === p.id || key(t.title) === key(p.title)) && !xpTasks().some(x => x.makeup === t.id && !x.skipped))
  .sort((a, b) => a.skipped.day.localeCompare(b.skipped.day) || (a.skipped.start ?? 0) - (b.skipped.start ?? 0));
// what your "How draining was it really?" answers say a task's effort is: its last 5 times, the newest counting most
function xpLearn(p) {
  const l = xpTasks().filter(t => t.done && t.done.effort && ((p.id && t.tpl === p.id) || key(t.title) === key(p.title)))
    .sort((a, b) => (a.done.day || '').localeCompare(b.done.day || '') || (a.done.at || '').localeCompare(b.done.at || '')).slice(-5);
  if (!l.length) return null;
  const w = l.reduce((a, t, i) => a + i + 1, 0), eff = Math.max(1, Math.min(5, Math.round(l.reduce((a, t, i) => a + (i + 1) * t.done.effort, 0) / w)));
  return {eff, n: l.length, sat: l.reduce((a, t) => a + xpSat(t.done), 0) / l.length};
}
const xpSuggest = (p, cur) => { const g = xpLearn(p); return g && g.eff !== cur ? g : null; };
const xpSugLine = (g, act) => g ? `<p class="xpsugp">The last ${g.n > 1 ? g.n + ' times it' : 'time it'} felt like effort ${g.eff}${g.sat ? `, satisfaction ${num1(g.sat)}` : ''}. <button class="link" data-act="${act}" data-v="${g.eff}">Make it ${g.eff}</button></p>` : '';
const xpWhen = s => new Date(s.day + 'T12:00').toLocaleDateString(undefined, {weekday: 'short', month: 'short', day: 'numeric'}) + (s.start != null ? ' ' + clock(s.start) : '');
function xpInTheWay(t) {   // what else was on the calendar while this task was planned
  if (t.start == null || !t.day) return [];
  const found = new Map(), len = xpLen(t);
  for (let d = t.day; d <= xpShift(xpLast(t), 1); d = xpShift(d, 1)) {
    const off = xpGap(t.day, d) * 1440, ivs = Array.from({length: xpSpan(t)}, (_, g) => [g * 1440 + t.start - off, g * 1440 + t.start + len - off]);
    xpItemsFor(d).filter(x => x.id !== t.id && !x.ghost && x.id !== '__mini' && !x.lifted && ivs.some(([a, b]) => x.start < b && x.start + x.len > a))
      .forEach(x => { if (!found.has(x.title)) found.set(x.title, xpReal(x) ? 0 : 1); });
  }
  const l = [...found].sort((a, b) => a[1] - b[1]);
  return (l.some(x => !x[1]) ? l.filter(x => !x[1]) : l).map(x => x[0]);   // things that really happened first
}
const xpSat = d => d.sat ?? ((d.went || 0) + (d.enjoy || 0)) / ((d.went ? 1 : 0) + (d.enjoy ? 1 : 0) || 1);   // one satisfaction score; older ones average their two
// time you enter: hours and minutes, two fields
const xpHM = (min, attrs) => `<span class="xphm"><label><input type="number" min="0" max="99" ${attrs} data-u="h" value="${Math.floor((min || 0) / 60)}"> hours</label><label><input type="number" min="0" max="59" ${attrs} data-u="m" value="${Math.round((min || 0) % 60)}"> minutes</label></span>`;
const xpReadHM = el => { const b = el && el.closest('.xphm'); if (!b) return 0; return Math.max(0, Math.round((+b.querySelector('[data-u="h"]').value || 0) * 60 + (+b.querySelector('[data-u="m"]').value || 0))); };
const xpSetHM = (el, min) => { const b = el && el.closest('.xphm'); if (!b) return; b.querySelector('[data-u="h"]').value = Math.floor(min / 60); b.querySelector('[data-u="m"]').value = Math.round(min % 60); };
const xpLastMin = () => xpCfg().lastMin || xpParse(xpCfg().lastTime || '') || 30;
const xpSubCount = o => (o.subs || []).length ? `${o.subs.filter(x => x.done).length}/${o.subs.length}` : '';
// the description box and subtask checklist, shown for calendar tasks and grid blocks alike
const xpNotesHtml = o => `<label>Description</label><textarea data-xnote="1" rows="3" placeholder="Notes">${esc(o.notes || '')}</textarea>
  <label>Subtasks ${xpSubCount(o)}</label><div class="xpsubs">${(o.subs || []).map(x => `<div class="xpsub${x.done ? ' dn' : ''}"><input type="checkbox" data-xsub="${x.id}"${x.done ? ' checked' : ''}><input data-xsubt="${x.id}" value="${esc(x.text)}" maxlength="120"><button class="link" data-act="xpsubdel" data-v="${x.id}">remove</button></div>`).join('')}
  <div class="xpsub"><input id="xpSubN" placeholder="Add a subtask" maxlength="120" autocomplete="off"><button class="go2" data-act="xpsubadd">ADD</button></div></div>`;

/* --- days and busy blocks --- */
const xpDay = k => all.find(x => x.id === 'day-' + k) || {id: 'day-' + k, kind: 'day', date: k, busy: []};
const xpBusyOn = k => { const d = xpDay(k); return [...(d.busy || []), ...(xpCfg().busyRules || []).filter(r => (r.dows || []).includes(xpDow(k)) && !(d.skip || []).includes(r.id)).map(r => ({...r, rule: true}))]; };
function xpBusyFind(id) {
  const r = (xpCfg().busyRules || []).find(x => x.id === id); if (r) return {b: r, rule: true};
  for (const d of all.filter(x => x.kind === 'day')) { const b = (d.busy || []).find(x => x.id === id); if (b) return {b, day: d.date}; }
  return null;
}
const xpDowsOf = (rep, k) => rep === 'daily' ? [0, 1, 2, 3, 4, 5, 6] : rep === 'weekdays' ? [1, 2, 3, 4, 5] : rep === 'weekends' ? [0, 6] : rep === 'dow' ? [xpDow(k)] : null;
const xpRepOf = r => { const d = (r.dows || []).join(); return d === '0,1,2,3,4,5,6' ? 'Every day' : d === '1,2,3,4,5' ? 'Weekdays' : d === '0,6' ? 'Weekends' : (r.dows || []).length === 1 ? 'Every ' + XP_DOWS[r.dows[0]] : 'Repeats'; };

/* --- saving: show the change at once, then store it (on failure, reload what's really saved) --- */
let xpQ = Promise.resolve();
async function xpSave(l, msg) {
  l = [].concat(l);
  l.forEach(o => { const i = all.findIndex(x => x.id === o.id); if (i < 0) all.push(o); else all[i] = o; });
  render();
  const go = xpQ.then(() => sb.from('items').upsert(l.map(row))); xpQ = go.catch(() => {});   // one save at a time, in order
  const {error} = await go;
  if (error) { flash('Save failed: ' + error.message); load(); return false; }
  if (msg) flash(msg);
  else { const n = [...new Set(l.filter(o => o.title).map(o => `"${o.title}"`))]; if (n.length) actQuiet('Saved ' + n.slice(0, 3).join(', ') + (n.length > 3 ? ` and ${n.length - 3} more` : '')); }   // quiet: written in the activity log only
  return true;
}
async function xpDelete(ids) {
  ids = [].concat(ids);
  const c = xpCfg(), skips = {};
  ids.forEach(id => { const t = all.find(x => x.id === id); if (t && t.rep) (skips[t.rep] = skips[t.rep] || []).push(t.day); });   // a repeating task's copy: don't remake it that day
  if (Object.keys(skips).length) await xpSave({...c, repeats: (c.repeats || []).map(r => skips[r.id] ? {...r, skip: [...(r.skip || []), ...skips[r.id]]} : r)});
  all = all.filter(x => !ids.includes(x.id)); if (ids.includes(xpSel)) xpSel = null;
  render();
  const {error} = await sb.from('items').delete().in('id', ids);
  if (error) { flash('Delete failed: ' + error.message); load(); }
  else actQuiet(`Deleted ${ids.length > 1 ? ids.length + ' items' : 'an item'}`);
}
const xpSaveDay = (patch, k = xpDate) => xpSave({...xpDay(k), ...patch});
const xpSaveCfg = (patch, msg) => xpSave({...xpCfg(), ...patch}, msg);
// one day of a task that runs several days in a row becomes its own task; the days before and after stay joined
const xpOneDay = t => t && !t.done && xpSpan(t) > 1 && xpSelIdx != null && !xpScopeAll;
function xpSplitNow(t, idx) {
  const n = xpSpan(t), day = xpShift(t.day, idx), now = new Date().toISOString(), parts = [];
  const copy = o => ({...o, id: xpId('t'), rep: undefined, created: now, subs: o.subs ? o.subs.map(x => ({...x})) : undefined});
  if (idx > 0) parts.push({...t, span: idx > 1 ? idx : undefined});
  const one = idx > 0 ? {...copy(t), day, span: undefined} : {...t, span: undefined};
  parts.push(one);
  if (idx < n - 1) parts.push({...copy(t), day: xpShift(day, 1), span: n - idx - 1 > 1 ? n - idx - 1 : undefined});
  xpSel = one.id; xpSelIdx = null; xpScopeAll = false;
  xpSave(parts);
  return one;
}
const xpPick = t => xpOneDay(t) ? xpSplitNow(t, xpSelIdx) : t;
const xpSaveTask = (id, patch, msg) => { const t = all.find(x => x.id === id); return t && xpSave({...t, ...patch}, msg); };
function xpSaveBusy(id, patch) {
  const f = xpBusyFind(id); if (!f) return;
  if (f.rule) xpSaveCfg({busyRules: xpCfg().busyRules.map(r => r.id === id ? {...r, ...patch} : r)});
  else xpSaveDay({busy: xpDay(f.day).busy.map(b => b.id === id ? {...b, ...patch} : b)}, f.day);
}
const xpAddDomain = n => { n = (n || '').trim(); return n && !xpDomains().some(x => key(x) === key(n)) ? {domains: [...(xpCfg().domains || XP_DOMAINS), n]} : {}; };
// a new block for the grid, top-left
const xpNewTpl = o => ({id: xpId('p'), kind: 'tasktype', is_public: false, title: o.title, domain: o.domain, domains: o.domains, est: o.est, effort: o.effort, order: Math.min(0, ...all.filter(x => x.kind === 'tasktype').map(x => x.order ?? 0)) - 1});

/* --- chores when the page opens --- */
function xpChores() {
  const today = xpToday(), c = xpCfg();
  // once: the old tray tasks become permanent blocks in the grid (one per title)
  if (!c.tplDone && !xpMigrated) {
    xpMigrated = true;
    const seen = new Map();
    [...xpTasks()].sort((a, b) => (b.created || '').localeCompare(a.created || '')).forEach(t => { if (!seen.has(key(t.title))) seen.set(key(t.title), t); });
    const tpls = [...seen.values()].map((t, i) => ({id: xpId('p') + i, kind: 'tasktype', is_public: false, title: t.title, domain: t.domain, domains: t.domains, est: t.est, effort: t.effort, order: i}));
    const loose = xpTasks().filter(t => !t.done && t.start == null && !t.day && !(t.missed || []).length).map(t => t.id);
    xpSave([...tpls, {...c, tplDone: true}]).then(ok => ok && loose.length && xpDelete(loose));
    return;
  }
  if (xpRolled !== today) {   // a task with no time (the old "No time yet" row): off the calendar, its block stays in the grid
    xpRolled = today;
    const loose = xpTasks().filter(t => !t.done && !t.skipped && t.start == null);
    if (loose.length) xpOffCal(loose);
  }
  const avg = xpAverage();   // the first time EXPRO knows your average day, say so
  if (avg.day && !c.avgTold) xpSaveCfg({avgTold: true}, `Two weeks in: your average day uses ${num1(avg.day)} energy (${Math.round(avg.day / XP_MAX_DAY * 100)}% of the most a person can keep up)`);
  if (xpView === 'month') return;
  const make = [];
  xpRangeDays().filter(k => k >= today).forEach(k => (c.repeats || []).forEach(r => {
    if (r.dow !== xpDow(k) || (r.skip || []).includes(k) || xpRepMade.has(r.id + k) || xpTasks().some(t => t.rep === r.id && (t.day === k || (t.done && t.done.day === k) || (t.skipped && t.skipped.day === k)))) return;
    xpRepMade.add(r.id + k);
    make.push({...xpFromTpl(xpTplByTitle(r.title)), id: xpId('t'), kind: 'task', is_public: false, title: r.title, domain: r.domain, ...(r.domains ? {domains: r.domains} : {}), est: r.est, effort: r.effort, day: k, start: r.start, rep: r.id, created: new Date().toISOString()});
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

/* --- what's on day k: busy blocks, tasks and EXP entries, cut at midnight, plus whatever is being dragged or made --- */
function xpRaw(k) {
  const g = xpDrag && xpDrag.moved && xpDrag.item ? xpDrag : null;
  let l = [
    ...xpBusyOn(k).map(b => ({id: b.id, kind: 'busy', b, title: b.label || 'Busy', start: b.start, len: b.len, effort: b.effort ?? 2})),
    ...xpTasks().filter(t => t.start != null && t.day && t.day <= k && xpLast(t) >= k).map(t => ({id: t.id, kind: 'task', t, title: t.title, domain: t.domain, doms: xpDoms(t), start: t.start, len: xpLen(t), effort: xpEff(t), done: !!t.done, idx: xpGap(t.day, k), span: xpSpan(t)}))
  ];
  if (g && g.item.kind === 'busy') l = l.map(x => x.id === g.id ? {...x, start: g.cur.start, len: g.cur.len, effort: g.cur.effort} : x);   // a repeating block changes on every day at once
  else if (g) {
    l = l.filter(x => !(x.id === g.id && (g.one == null || x.idx === g.one)));
    const n = g.cur.day ? xpGap(g.cur.day, k) : -1, span = g.cur.span || 1;
    if ((!['tray', 'tpl'].includes(g.mode) || g.over) && n >= 0 && n < span && g.cur.start != null) l.push({...g.item, ...g.cur, idx: n, span, ghost: ['tray', 'tpl'].includes(g.mode), lifted: g.toTray});
  }
  if (xpMini && xpMini.day === k) l.push({id: '__mini', kind: 'task', title: xpMini.title || 'New task', domain: xpMini.domain, start: xpMini.start, len: xpMini.est || 30, effort: xpMini.effort || 3, ghost: true});
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
const xpIsSleep = x => /sleep/i.test(x.title || '') || (x.doms || [x.domain]).some(d => /sleep/i.test(d || ''));
const xpCostOf = x => xpIsSleep(x) ? 0 : xpCost(x.len, x.effort);
function xpNight(k) {   // the night before day k (3pm the day before to 3pm that day): {min, real} or null
  const iv = [];
  const take = (d, off) => xpItemsFor(d).filter(x => xpIsSleep(x) && !x.ghost && !x.lifted && x.id !== '__mini').forEach(x => {
    const a = Math.max(x.start + off, -540), b = Math.min(x.start + x.len + off, 900);
    if (b > a) iv.push([a, b, x.kind === 'exp' || (x.kind === 'task' && x.done)]);
  });
  take(xpShift(k, -1), -1440); take(k, 0);
  if (!iv.length) return null;
  const real = iv.some(x => x[2]), l = iv.filter(x => x[2] === real).sort((a, b) => a[0] - b[0]);
  let min = 0, end = -Infinity;
  l.forEach(([a, b]) => { if (b > end) { min += b - Math.max(a, end); end = b; } });
  return {min, real};
}
function xpMaxOn(k) {   // the most energy for day k, after the night's sleep
  const n = xpNight(k); if (!n) return {max: XP_MAX_DAY, n};
  const f = n.min < XP_SLEEP ? Math.max(.3, n.min / XP_SLEEP) : Math.max(.6, 1 - (n.min - XP_SLEEP) / XP_SLEEP * .5);
  return {max: Math.round(XP_MAX_DAY * f), n};
}
const xpSleepTxt = n => !n ? 'no sleep on the calendar' : `${sdur(n.min)} ${n.real ? 'slept' : 'planned'}, ${Math.abs(n.min - XP_SLEEP) < 10 ? 'on goal' : n.min < XP_SLEEP ? sdur(XP_SLEEP - n.min) + ' short' : sdur(n.min - XP_SLEEP) + ' over'}`;
// energy that has really been spent: busy time and EXP entries that have happened, finished tasks (only the part before now)
const xpReal = x => x.kind === 'busy' || x.kind === 'exp' || (x.kind === 'task' && x.done);
function xpTotals(days) {
  const s = {free: 0, busyMin: 0, used: 0, sleep: 0, planE: 0, spentE: 0}, now = new Date(), today = xpToday(), nowMin = now.getHours() * 60 + now.getMinutes();
  days.forEach(k => {
    xpItemsFor(k).filter(x => !x.lifted && x.id !== '__mini').forEach(x => {
      if (xpIsSleep(x)) { s.sleep += x.len; return; }   // sleep: not booked, no energy
      if (x.kind === 'busy') s.busyMin += x.len; else s.used += x.len;
      s.planE += xpCost(x.len, x.effort);
      if (xpReal(x) && k <= today) { const end = k < today ? x.start + x.len : Math.min(x.start + x.len, nowMin); if (end > x.start) s.spentE += xpCost(end - x.start, x.effort); }
    });
    s.free += 1440;
  });
  s.sleep = Math.min(s.sleep, s.free); s.free -= s.busyMin + s.sleep;   // free = awake and not booked (before tasks)
  return s;
}
function xpExpOn(days) {   // EXP earned on these days: finished tasks + EXP entries
  const set = new Set(days);
  return xpTasks().filter(t => t.done && set.has(t.done.day)).reduce((a, t) => a + xpExp1(t), 0) + ents().filter(e => e.start && set.has(xpKey(e.start))).reduce((a, e) => a + (e.minutes || 0), 0);
}
let xpAvgCache = {};
function xpAverage() {   // your average day, once there are XP_LEARN_DAYS days with finished things in the last 60 (worked out once per change)
  const today = xpToday(), ck = today + '|' + all.length + '|' + xpTasks().filter(t => t.done).length;
  if (xpAvgCache.k === ck) return xpAvgCache.v;
  const l = [];
  for (let i = 1; i <= 60; i++) {
    const k = xpShift(today, -i), items = xpItemsFor(k);
    if (items.some(x => x.kind !== 'busy' && xpReal(x))) l.push(items.filter(xpReal).reduce((a, x) => a + xpCostOf(x), 0));
  }
  const v = l.length >= XP_LEARN_DAYS ? {day: l.reduce((a, b) => a + b, 0) / l.length, n: l.length} : {n: l.length, day: null};
  xpAvgCache = {k: ck, v}; return v;
}

/* --- drawing --- */
function renderExpro() {
  const el = $('pgExpro'); if (!el || page !== 'expro') return;
  if (!owner) { el.innerHTML = `<p class="mute">${loaded ? 'This page is private.' : 'Loading...'}</p>`; return; }
  if (!loaded) { el.innerHTML = '<p class="mute">Loading...</p>'; return; }
  xpDate = xpDate || xpToday(); xpStart = xpStart || xpDate;
  if (xpPx == null) xpPx = xpCfg().calPx || XP_PX;
  if (xpN == null) xpN = xpCfg().calDays || 7;
  const sy = scrollY;   // redrawing briefly shortens the page, which made the browser jump to the top; put the scroll back after
  xpChores();
  const today = xpToday(), rd = xpRangeDays(), fmt = (k, o) => new Date(k + 'T12:00').toLocaleDateString(undefined, o), md = {weekday: 'short', month: 'short', day: 'numeric'};
  const lbl = xpView === 'month' ? fmt(xpDate, {month: 'long', year: 'numeric'}) : rd.length === 1 ? fmt(rd[0], {weekday: 'long', month: 'short', day: 'numeric'}) : `${fmt(rd[0], md)} - ${fmt(rd[rd.length - 1], md)}`;
  const tab = (v, l) => `<button class="tag ${xpView === v ? 'on' : ''}" data-act="xpview" data-v="${v}">${l}</button>`, cal = xpView !== 'domains';
  el.innerHTML = `<div class="xpro">
    <div class="xphead">
      <div class="xpdate"><button class="ib" data-act="xpday" data-v="-1" aria-label="Back">&larr;</button><b>${esc(lbl)}</b><button class="ib" data-act="xpday" data-v="1" aria-label="Forward">&rarr;</button>${xpRangeDays().includes(today) ? '' : '<button class="link" data-act="xpday" data-v="0">Today</button>'}</div>
      <div class="xptabs">${tab('days', 'Days')}${tab('month', 'Month')}${tab('domains', 'Domains')}</div>
      ${xpTimed() ? `<label class="xpdepth">3D <input type="range" id="xpDepth" min="0" max="16" value="${xpDepth()}"></label>` : ''}
    </div>
    ${cal ? `<div class="xptop"><div class="xpmeters" id="xpMeters"></div><div class="xptray" id="xpTray"></div></div>
      <div class="xpbody"><div class="xpcalw"><div class="xpcal${xpView === 'month' ? ' month' : ''}" id="xpCal"></div>
        ${xpTimed() ? `<div class="xpzbar"><label>WIDTH<input type="range" id="xpZW" min="1" max="14" step="1" value="${15 - xpN}" aria-label="Zoom the width (fewer days)"><b id="xpZWv">${xpN} day${xpN > 1 ? 's' : ''}</b></label>
          <label>HEIGHT<input type="range" id="xpZH" min="0" max="1000" step="1" value="${xpZHval()}" aria-label="Zoom the height (the hours)"></label>
          <span><button class="link" data-act="xpzoom" data-v="fit">Whole day</button><button class="link" data-act="xpunfold">${xpUnfold ? 'Fold sleep' : 'Show sleep'}</button></span></div>` : ''}</div><aside class="xpside" id="xpSide"></aside></div>`
      : `<div id="xpStats"></div>`}
  </div>`;
  if (cal) { xpDrawMeters(); xpDrawTray(); xpDrawCal(); xpDrawSide(); }
  else xpDrawStats();
  xpDrawMini();
  if (scrollY !== sy) scrollTo(0, sy);
}

function xpDrawMeters() {
  const m = $('xpMeters'); if (!m) return;
  // everything here is one day: the one you picked (click a day's name on the calendar)
  const s = xpTotals([xpDate]), mo = xpMaxOn(xpDate), max = mo.max, avg = xpAverage(), awake = 1440 - s.sleep, booked = s.busyMin + s.used, tLeft = awake - booked, today = xpToday();
  const pct = v => Math.min(100, v / max * 100), over = s.planE > max, avgR = avg.day, n = mo.n, off = n && Math.abs(n.min - XP_SLEEP) >= 10;
  const dn = xpDate === today ? 'TODAY' : new Date(xpDate + 'T12:00').toLocaleDateString(undefined, {weekday: 'short', month: 'short', day: 'numeric'}).toUpperCase();
  m.innerHTML = `<div class="xpm"><span>SLEEP, NIGHT BEFORE</span><div class="xpbar s${off ? ' over' : ''}"><i style="width:${n ? Math.min(100, n.min / 600 * 100) : 0}%"></i><u style="left:${XP_SLEEP / 600 * 100}%"></u></div>
      <div>${n ? `<b>${sdur(n.min)}</b> ${n.real ? 'slept' : 'planned'}, <b class="${off ? 'neg' : ''}">${!off ? 'on goal' : n.min < XP_SLEEP ? sdur(XP_SLEEP - n.min) + ' short' : sdur(n.min - XP_SLEEP) + ' over'}</b>` : 'Nothing called sleep yet'}, goal ${sdur(XP_SLEEP)}</div></div>
    <div class="xpm"><span>TIME, ${dn}</span><div class="xpbar${tLeft < 0 ? ' over' : ''}"><i style="width:${awake > 0 ? Math.min(100, booked / awake * 100) : 100}%"></i></div>
      <div><b>${sdur(booked)}</b> booked, <b class="${tLeft < 0 ? 'neg' : ''}">${tLeft < 0 ? sdur(-tLeft) + ' double-booked' : sdur(tLeft) + ' free'}</b> of ${sdur(awake)} awake</div></div>
    <div class="xpm"><span>ENERGY, ${dn}</span><div class="xpbar e${over ? ' over' : ''}"><i class="pl" style="width:${pct(s.planE)}%"></i><i class="sp" style="width:${pct(s.spentE)}%"></i>${avgR ? `<u style="left:${pct(avgR)}%"></u>` : ''}</div>
      <div><b>${num1(s.spentE)}</b> spent so far, <b class="${over ? 'neg' : ''}">${num1(s.planE)}</b> planned, max ${max}${max < XP_MAX_DAY ? ` <span class="neg">(${XP_MAX_DAY - max} lost to ${n.min < XP_SLEEP ? 'too little' : 'too much'} sleep)</span>` : ''}</div>
      <div class="mute">${avg.day ? `Your average: ${num1(avg.day)} a day (${Math.round(avg.day / XP_MAX_DAY * 100)}% of max)` : `Learning your average: ${avg.n} of ${XP_LEARN_DAYS} days`}</div></div>
    <div class="xpm"><span>EXP</span><div>${xpDate === today ? '' : `${new Date(xpDate + 'T12:00').toLocaleDateString(undefined, {weekday: 'short', month: 'short', day: 'numeric'})} <b>${xpExpOn([xpDate]).toLocaleString()}</b>, `}Today <b>${xpExpOn([today]).toLocaleString()}</b>, this month <b>${xpExpOn(xpMonth(today)).toLocaleString()}</b></div></div>`;
}

// a block's three visible faces: the front (raised by its effort), its left side and its bottom
function xpFaces(col, kind) {
  const base = kind === 'busy' ? '#4b5568' : col;
  return {top: blend('#3a435e', base, kind === 'busy' ? .6 : .62), left: blend('#161c27', base, .38), bot: blend('#0e131b', base, .3)};
}
const xpDomEdit = (o, attr) => { const l = xpDoms(o);   // the domains as chips (x removes one) and a list to add another
  return `<label>Domains</label><div class="xpdchips">${l.map(d => `<span class="chip" style="background:${xpCol(d)};color:${ink(xpCol(d))}">${esc(d)}${l.length > 1 ? `<button class="xpdx" data-act="xpdomrm" data-v="${esc(d)}" aria-label="Remove ${esc(d)}" style="color:inherit">x</button>` : ''}</span>`).join('')}
    <select ${attr}="domainAdd"><option value="">Add a domain</option>${xpDomains().filter(d => !l.some(x => key(x) === key(d))).map(d => `<option>${esc(d)}</option>`).join('')}<option value="__new">New domain...</option></select></div>`; };
const xpDomSelect = (cur, attrs) => `<select ${attrs}>${xpDomains().concat(cur && !xpDomains().some(x => key(x) === key(cur)) ? [cur] : []).map(v => `<option${key(v) === key(cur || '') ? ' selected' : ''}>${esc(v)}</option>`).join('')}<option value="__new">New domain...</option></select>`;
const xpBlock3d = (o, cls, attrs, extra = '') => {
  // the same block as on the calendar: its left side and bottom show below-left of the front, as deep as its effort
  const f = xpFaces(xpCol(o.domain)), e = Math.min(16, o.effort * xpDepth() * .6 * Math.SQRT1_2);
  return `<div class="${cls}${xpSel === o.id ? ' sel' : ''}" data-xid="${o.id}" ${attrs} style="background:${f.top};color:${ink(f.top)};--e:${e.toFixed(1)}px;--l:${f.left};--b:${f.bot}">
    <b>${esc(o.title)}</b><span>${esc(xpDomTxt(o))}, ${sdur(o.est)}, effort ${o.effort}${(o.subs || []).length ? ', ' + xpSubCount(o) : ''}</span>${(g => g ? `<u class="xpsug" title="Felt like effort ${g.eff} the last ${g.n > 1 ? g.n + ' times' : 'time'}">REALLY ${g.eff}</u>` : '')(o.kind === 'tasktype' && xpSuggest(o, o.effort))}${extra}</div>`;
};
function xpDrawTray() {
  const el = $('xpTray'); if (!el) return;
  const g = xpDrag && xpDrag.mode === 'tpl' && xpDrag.gridAt != null ? xpDrag : null;
  const c = xpCfg(), eff = [1, 2, 3, 4, 5].map(n => `<option value="${n}"${n === (c.lastEffort || 3) ? ' selected' : ''}>effort ${n}</option>`).join('');
  const blocks = sec => {
    let tp = xpSec(sec, xpChest);
    if (g && !xpChest && g.sec === sec) { const it = tp.find(x => x.id === g.id); tp = tp.filter(x => x !== it); tp.splice(g.gridAt, 0, it); }   // live preview of the new order
    return tp.map(t => {
      const ow = xpOwed(t), left = xpLeft(t), stk = t.timely && xpNow(t) ? Math.min(3, left) - 1 : 0, gone = t.timely && !xpNow(t);
      const tip = [ow.length ? 'Not done: ' + ow.map(x => xpWhen(x.skipped) + (x.skipped.why ? ' (' + x.skipped.why + ')' : '')).join('; ') : '', t.timely ? `${t.timely.from ? xpMD(t.timely.from) : ''} - ${t.timely.to ? xpMD(t.timely.to) : ''}, ${left} of ${t.timely.n || 1} left` : ''].filter(Boolean).join('. ');
      const f = xpFaces(xpCol(t.domain)), stack = stk > 0 ? ` style-stk="${[...Array(stk)].map((_, i) => `${(i + 1) * 5}px ${-(i + 1) * 5}px 0 -1px ${f.left}`).join(',')}"` : '';
      return xpBlock3d(t, 'xpt' + (g && g.id === t.id ? ' lifted' : '') + (ow.length ? ' owe' : '') + (stk > 0 ? ' stk' : ''), `data-xg="tpl"${tip ? ` title="${esc(tip)}"` : ''}${stack}`,
        (ow.length ? `<u class="xpowe">MAKE UP${ow.length > 1 ? ' ' + ow.length : ''}</u>` : '') + (gone ? `<u class="xpocc">${xpNotNow(t)}</u>` : t.timely ? `<u class="xpocc">${left} LEFT</u>` : ''));
    }).join('');
  };
  const nArch = xpSec('', true).length, per = xpChest ? blocks('') : blocks('p'), tim = xpChest ? '' : blocks('t');
  const nt = c => c ? '' : ' xpempty';
  el.innerHTML = `<div class="xpgw"><div class="xpsecs">
      ${xpChest ? `<div class="xpgrid" id="xpGrid">${per || '<span class="mute">The chest is empty.</span>'}</div>`
        : `<div class="xpsec"><h4>PERPETUAL</h4><div class="xpgrid${nt(per)}" id="xpGrid">${per || '<span class="mute">Nothing yet.</span>'}</div></div>
           <div class="xpsec"><h4>TIMELY</h4><div class="xpgrid${nt(tim)}" id="xpGridT">${tim || '<span class="mute">Nothing right now.</span>'}</div></div>`}</div>
      <button class="xpchest${xpChest ? ' open' : ''}${xpDrag && xpDrag.overChest ? ' drop' : ''}" id="xpChest" data-act="xpchest">${xpChest ? 'BACK TO<br>TASKS' : `CHEST<br><small>${nArch}</small>`}</button></div>
    ${xpChest ? '' : `<div class="xpnew"><select id="xpNK"><option value="p">Perpetual</option><option value="t"${xpNewTimely ? ' selected' : ''}>Timely</option></select><input id="xpNT" placeholder="New task" maxlength="80" autocomplete="off">
      ${xpNewDom ? '<input id="xpNDn" class="xpnd" placeholder="New domain" maxlength="30" autocomplete="off">' : xpDomSelect(c.lastDomain || xpDomains()[0], 'id="xpND"')}
      ${xpHM(xpLastMin(), 'data-hm="new"')}
      <select id="xpNF">${eff}</select>
      ${xpNewTimely ? `<span class="xpnt"><label>From<input id="xpNA" type="date" value="${xpToday()}"></label><label>To<input id="xpNB" type="date" value="${xpShift(xpToday(), 6)}"></label><label>Times<input id="xpNN" type="number" min="1" max="99" value="1"></label></span>` : ''}
      <button class="go2" data-act="xpadd">ADD</button></div>`}`;
  el.querySelectorAll('[style-stk]').forEach(b => { b.style.setProperty('--stk', b.getAttribute('style-stk')); b.removeAttribute('style-stk'); });
  el.classList.toggle('drop', !!(xpDrag && xpDrag.toTray));
}

function xpDrawCal() {
  const el = $('xpCal'); if (!el) return;
  if (xpView === 'month') return xpDrawMonth(el);
  const days = xpRangeDays(), k = xpDepth() * .6 * Math.SQRT1_2, PX = xpPx = Math.max(xpPxMin(), Math.min(XP_PX_MAX, xpPx || XP_PX)), pad = Math.round(5 * k) + 8, gut = 50, head = 34;
  const W = el.clientWidth || 700, colW = (W - gut - 4) / days.length, folds = xpFolds(days), map = xpMap(folds, PX), y = t => head + pad + map.Y(t), today = xpToday();
  const keyNow = 'cal', old = xpScroll.key === keyNow ? xpScroll.top : null;
  let h = `<div class="xpwh" style="height:${head}px;padding-left:${gut}px">${days.map(d => `<button class="${d === xpDate ? 'on' : ''}${d === today ? ' today' : ''}" data-act="xpsetday" data-v="${d}" style="width:${colW}px" title="${xpDayTip(d)}">${new Date(d + 'T12:00').toLocaleDateString(undefined, {weekday: colW < 60 ? 'narrow' : 'short', day: 'numeric'})}${xpDayBar(d)}</button>`).join('')}</div>`;
  // hour lines: as you zoom in they go to every 30, 15, then 10 minutes (labels need about 36px between them)
  const step = [10, 15, 30, 60, 120, 180, 240].find(v => v * PX >= 36) || 240, minor = step >= 20 && step / 2 * PX >= 14 ? step / 2 : 0;
  for (let m = 0; m <= 1440; m += minor || step) if (!folds.some(([a, b]) => m > a && m < b)) h += `<div class="xph${m % step ? ' half' : ''}" style="top:${y(m)}px">${m % step || m === 1440 || folds.some(([a, b]) => m === a || m === b) ? '' : `<span>${clock(m)}</span>`}</div>`;
  folds.forEach(([a, b]) => { h += `<div class="xpfoldb" style="top:${y(a)}px;height:${y(b) - y(a)}px;left:${gut}px" title="Asleep ${clock(a)}-${clock(b)}, folded"><span>${clock(a)}-${clock(b)}</span></div>`; });
  days.forEach((d, i) => { h += `<div class="xpcol${d === xpDate ? ' on' : ''}" style="left:${gut + i * colW}px;width:${colW}px;top:${head}px"></div>`; });
  const ti = days.indexOf(today);
  if (ti >= 0) { const n = new Date(); h += `<div class="xpnow" style="top:${y(n.getHours() * 60 + n.getMinutes())}px;left:${gut + ti * colW}px;width:${colW}px"></div>`; }
  let z = 2;
  days.forEach((d, i) => xpLanes(xpItemsFor(d)).sort((a, b) => a.start - b.start || b.lane - a.lane).forEach(x => {
    // a task running several days: its pieces reach the column edges so they read as one block
    const lw = colW / x.lanes, e = x.effort * k, ls = gut + i * colW + x.lane * lw, cl = x.span > 1 && x.idx > 0, cr = x.span > 1 && x.idx < x.span - 1;
    const fl = ls + (cl ? 0 : 2 + e), fr = ls + lw - (cr ? 0 : 2), w = Math.max(20, fr - fl), bx = fl - e, by = y(x.start), bh = Math.max(6, y(x.start + x.len) - by - 2);
    const first = !x.span || x.idx === 0, last = !x.span || x.idx === x.span - 1;
    const f = xpFaces(xpCol(x.domain), x.kind), small = bh < 30, still = x.cut || x.kind === 'exp' || x.id === '__mini';
    const plan = x.kind === 'task' && x.done && !x.cut && x.t ? `<div class="xpplan" style="height:${y(x.start + x.t.est) - by - 2}px;transform:translate(${e}px,${-e}px)"></div>` : '';
    const info = [x.kind === 'busy' ? '' : esc(x.doms ? x.doms.join(' + ') : x.domain || ''), `${clock(x.start)}-${clock(x.start + x.len)}`, `effort ${x.effort}`, x.span > 1 ? `day ${x.idx + 1} of ${x.span}` : '', x.t ? xpSubCount(x.t) : '', x.t && x.t.makeup ? 'make up' : ''].filter(Boolean).join(', ');
    h += `<div class="xpb ${x.kind}${cl ? ' cl' : ''}${cr ? ' cr' : ''}${x.done ? ' done' : ''}${x.ghost ? ' ghost' : ''}${x.lifted ? ' lifted' : ''}${xpSel === x.id && (xpSelIdx == null || xpScopeAll || x.idx === xpSelIdx) ? ' sel' : ''}" data-xid="${x.id}" data-day="${d}" style="left:${bx}px;top:${by}px;width:${w}px;height:${bh}px;z-index:${z++}">
      <svg class="xps" width="1" height="1">${cl ? '' : `<polygon fill="${f.left}" points="0,0 ${e},${-e} ${e},${bh - e} 0,${bh}"/>`}<polygon fill="${f.bot}" points="0,${bh} ${w},${bh} ${w + e},${bh - e} ${e},${bh - e}"/></svg>
      ${plan}<div class="xpf${small ? ' small' : ''}" data-xg="${still ? 'none' : 'move'}" style="transform:translate(${e}px,${-e}px);background:${f.top};color:${ink(f.top)}">
        <b>${x.done && x.kind === 'task' ? 'Done: ' : ''}${esc(x.title)}</b>${small ? '' : `<span>${info}</span>`}
        ${still || x.done ? '' : `${x.cut ? '' : '<i class="xpgt" data-xg="top"></i>'}${x.cutEnd ? '' : '<i class="xpgl" data-xg="len"></i>'}${x.kind === 'task' && first ? '<i class="xpgL" data-xg="left"></i>' : ''}${x.kind === 'task' && last ? '<i class="xpgR" data-xg="right"></i>' : ''}${last ? `<i class="xpgz" data-xg="z">${x.effort}</i>` : ''}`}</div></div>`;
  }));
  el.innerHTML = `<div class="xpplane" id="xpPlane" style="height:${head + pad + map.H + 16}px">${h}</div>`;
  el._geo = {pad, gut, colW, PX, days, head, map};
  const zh = $('xpZH'); if (zh && document.activeElement !== zh) zh.value = xpZHval();   // pinching moves the slider too
  xpScroll.key = keyNow;
  if (old != null) el.scrollTop = old;   // keep your place when redrawing; the first time, start near now (or the first task, or 7am)
  else {
    const firsts = days.flatMap(d => xpItemsFor(d).filter(x => x.kind !== 'busy').map(x => x.start)), n = new Date();
    el.scrollTop = Math.max(0, y(ti >= 0 ? n.getHours() * 60 + n.getMinutes() - 90 : firsts.length ? Math.min(...firsts) - 30 : 7 * 60) - head);
  }
  xpScroll.top = el.scrollTop;
}
function xpFolds(days) {   // stretches of the day (an hour or more) when every day in view is asleep and nothing else is on
  if (xpUnfold) return [];
  const sl = new Array(288).fill(true), skip = x => x.ghost || x.lifted || x.id === '__mini' || (xpDrag && x.id === xpDrag.id);
  days.forEach(d => {
    const on = new Array(288).fill(false), other = new Array(288).fill(false);
    xpItemsFor(d).filter(x => !skip(x)).forEach(x => { for (let i = Math.floor(x.start / 5); i < Math.ceil((x.start + x.len) / 5); i++) (xpIsSleep(x) ? on : other)[i] = true; });
    for (let i = 0; i < 288; i++) sl[i] = sl[i] && on[i] && !other[i];
  });
  const f = [];
  for (let i = 0; i < 288;) { if (!sl[i]) { i++; continue; } let j = i; while (j < 288 && sl[j]) j++; if (j - i >= 12) f.push([i * 5, j * 5]); i = j; }
  return f;
}
function xpMap(folds, PX) {   // minutes <-> pixels down the calendar, with folded stretches squeezed to XP_FOLD pixels
  const seg = []; let m = 0;
  folds.forEach(([a, b]) => { if (a > m) seg.push([m, a, PX]); seg.push([a, b, XP_FOLD / (b - a)]); m = b; });
  if (m < 1440) seg.push([m, 1440, PX]);
  let acc = 0; seg.forEach(s => { s[3] = acc; acc += (s[1] - s[0]) * s[2]; });
  const Y = t => { const s = seg.find(s => t <= s[1]) || seg[seg.length - 1]; return t < 0 ? t * PX : s[3] + (t - s[0]) * s[2]; };
  const M = py => { const s = seg.find(s => py <= s[3] + (s[1] - s[0]) * s[2]) || seg[seg.length - 1]; return py < 0 ? py / PX : s[0] + (py - s[3]) / s[2]; };
  return {Y, M, H: acc};
}
const xpPxMin = () => { const c = $('xpCal'); return Math.max(.2, ((c && c.clientHeight) || 600) - 34 - 40) / 1440; };   // the whole day fits
function xpDayBar(d) {   // under each day's name: that day's planned energy against the daily max
  const s = xpTotals([d]), mx = xpMaxOn(d).max; return s.planE ? `<i class="${s.planE > mx ? 'over' : ''}" style="width:${Math.min(100, s.planE / mx * 100)}%"></i>` : '';
}
function xpDayTip(d) { const s = xpTotals([d]), mo = xpMaxOn(d), b = s.busyMin + s.used, f = 1440 - s.sleep - b; return `Sleep: ${xpSleepTxt(mo.n)}. ${sdur(b)} booked, ${f < 0 ? sdur(-f) + ' double-booked' : sdur(f) + ' free'}. Energy ${num1(s.planE)} of ${mo.max}`; }
/* --- zoom and moving through days --- */
// the HEIGHT slider runs from the whole day (left) to the closest zoom (right), evenly by ratio
const xpZHval = () => { const lo = xpPxMin(), px = Math.max(lo, Math.min(XP_PX_MAX, xpPx || XP_PX)); return Math.round(Math.log(px / lo) / Math.log(XP_PX_MAX / lo) * 1000); };
const xpZHpx = v => { const lo = xpPxMin(); return lo * Math.pow(XP_PX_MAX / lo, v / 1000); };
let xpZoomF = 1, xpZoomY = null, xpZoomRaf = 0, xpSwipe = 0, xpSwipeT = 0, xpViewT = 0;
function xpZoom(f, cy) {   // zoom the hours, keeping the time under the pointer (or the middle) where it is
  xpZoomF *= f; xpZoomY = cy;
  if (xpZoomRaf) return;
  xpZoomRaf = requestAnimationFrame(() => {
    xpZoomRaf = 0;
    const cal = $('xpCal'), g = cal && cal._geo; if (!g) return;
    const box = cal.getBoundingClientRect(), off = (xpZoomY == null ? box.top + cal.clientHeight / 2 : xpZoomY) - box.top;
    const m = g.map.M(cal.scrollTop + off - g.head - g.pad);
    xpPx = Math.max(xpPxMin(), Math.min(XP_PX_MAX, g.PX * xpZoomF)); xpZoomF = 1;
    xpDrawCal();
    cal.scrollTop = cal._geo.map.Y(m) + g.head + g.pad - off; xpScroll.top = cal.scrollTop;
    xpSaveView();
  });
}
function xpShiftDays(n) {   // move the days you see; the picked day stays among them
  const l = xpRangeDays(); xpStart = xpShift(l[0], n);
  const last = xpShift(xpStart, xpN - 1);
  if (xpDate < xpStart) xpDate = xpStart; else if (xpDate > last) xpDate = last;
  xpMini = null; renderExpro();
}
function xpSetN(n) {
  xpN = Math.max(1, Math.min(14, n));
  const last = xpShift(xpStart, xpN - 1); if (xpDate > last) xpDate = last;
  xpMini = null; renderExpro(); xpSaveView();
}
function xpSaveView() {   // remember your zoom and number of days (quietly, a moment after you stop)
  clearTimeout(xpViewT);
  xpViewT = setTimeout(() => {
    const c = {...xpCfg(), calPx: Math.round(xpPx * 1000) / 1000, calDays: xpN}, i = all.findIndex(x => x.id === 'exprocfg');
    if (i < 0) all.push(c); else all[i] = c;
    sb.from('items').upsert([row(c)]);
  }, 1000);
}
document.addEventListener('wheel', ev => {
  if (page !== 'expro' || !xpTimed() || !ev.target.closest || !ev.target.closest('#xpCal')) return;
  if (ev.ctrlKey || ev.metaKey) { ev.preventDefault(); xpZoom(Math.exp(-Math.max(-60, Math.min(60, ev.deltaY)) * .01), ev.clientY); return; }   // pinch, or ctrl+scroll
  if (ev.altKey) { ev.preventDefault(); if (Math.abs(ev.deltaY) > 4) xpSetN(xpN + Math.sign(ev.deltaY)); return; }   // option+scroll: more or fewer days
  if (Math.abs(ev.deltaX) > Math.abs(ev.deltaY)) {   // swipe sideways: a day at a time
    ev.preventDefault();
    const now = Date.now(); if (now - xpSwipeT > 400) xpSwipe = 0; xpSwipeT = now;
    xpSwipe += ev.deltaX;
    if (Math.abs(xpSwipe) > 90) { xpShiftDays(Math.sign(xpSwipe)); xpSwipe = 0; }
  }
}, {passive: false});
function xpDrawMonth(el) {
  const days = xpMonth(xpDate), first = xpShift(days[0], -xpDow(days[0])), today = xpToday(), cells = [];
  for (let d = first; d <= days[days.length - 1] || cells.length % 7; d = xpShift(d, 1)) cells.push(d);
  const g = xpDrag && xpDrag.overDay;
  el.innerHTML = `<div class="xpmh">${XP_DOWS.map(x => `<span>${x.slice(0, 3)}</span>`).join('')}</div><div class="xpmg">${cells.map(d => {
    const s = xpTotals([d]), items = xpItemsFor(d).filter(x => x.kind !== 'busy' && !x.cut), un = xpTasks().filter(t => !t.done && t.day === d && t.start == null), ex = xpExpOn([d]);
    const list = [...items.map(x => ({title: x.title, domain: x.domain, done: x.done})), ...un.map(t => ({title: t.title, domain: t.domain, open: true}))];
    return `<div class="xpmc${d.slice(0, 7) !== xpDate.slice(0, 7) ? ' out' : ''}${d === today ? ' today' : ''}${d === xpDate ? ' on' : ''}${g === d ? ' drop' : ''}" data-mday="${d}" data-act="xpgoday" data-v="${d}">
      <b>${+d.slice(8)}</b>${s.used ? `<span class="xpmm">${sdur(s.used)}, ${num1(s.planE)} energy${ex ? `, ${ex} EXP` : ''}</span>` : ''}
      ${list.slice(0, 4).map(x => `<i style="border-color:${xpCol(x.domain)}" class="${x.done ? 'dn' : ''}${x.open ? ' op' : ''}">${esc(x.title)}</i>`).join('')}${list.length > 4 ? `<em>${list.length - 4} more</em>` : ''}</div>`;
  }).join('')}</div>`;
}

/* --- the little form that opens where you double-click the calendar --- */
function xpDrawMini() {
  let el = $('xpMini');
  if (!xpMini || page !== 'expro') { if (el) el.remove(); return; }
  if (el) return;   // already open: keep what you're typing
  const m = xpMini, titles = [...new Set([...all.filter(x => x.kind === 'tasktype'), ...xpTasks()].map(x => x.title))];
  el = document.createElement('div'); el.id = 'xpMini'; el.className = 'xpmini';
  el.style.left = Math.max(8, Math.min(m.x + 12, innerWidth - 330)) + 'px'; el.style.top = Math.max(8, Math.min(m.y - 20, innerHeight - 250)) + 'px';
  el.innerHTML = `<div class="mute">${new Date(m.day + 'T12:00').toLocaleDateString(undefined, {weekday: 'short', month: 'short', day: 'numeric'})}, ${clock(m.start)}</div>
    <input id="xmT" placeholder="Task" list="xmTitles" maxlength="80" autocomplete="off"><datalist id="xmTitles">${titles.map(t => `<option value="${esc(t)}">`).join('')}</datalist>
    <div class="xmrow">${xpHM(m.est, 'data-hm="mini"')}</div>
    <div class="xmrow">${xpDomSelect(m.domain, 'id="xmD"')}<select id="xmF">${[1, 2, 3, 4, 5].map(n => `<option value="${n}"${n === m.effort ? ' selected' : ''}>effort ${n}</option>`).join('')}</select></div>
    <div class="xmrow"><button class="go2" data-act="xpminiadd">ADD</button><button class="link" data-act="xpminiclose">Cancel</button></div>`;
  document.body.appendChild(el);
  $('xmT').focus();
}
function xpMiniFill() {   // a title you've used before: fill in its domain, time and effort
  const v = $('xmT').value, src = xpTplByTitle(v) || [...xpTasks()].reverse().find(t => key(t.title) === key(v));
  xpMini.title = v;
  if (src && $('xmD')) { xpMini.domain = src.domain; xpMini.est = src.est; xpMini.effort = src.effort; $('xmD').outerHTML = xpDomSelect(src.domain, 'id="xmD"'); xpSetHM(document.querySelector('[data-hm="mini"]'), src.est); $('xmF').value = src.effort; }
  xpDrawCal();
}
function xpMiniAdd() {
  const title = $('xmT').value.trim(); if (!title) { $('xmT').focus(); return; }
  const est = xpReadHM(document.querySelector('[data-hm="mini"]')); if (!est) { flash('Enter the hours and minutes'); document.querySelector('[data-hm="mini"]').focus(); return; }
  const dn = $('xmDn'), domain = dn ? dn.value.trim() : $('xmD').value; if (!domain) { dn.focus(); return; }
  const effort = +$('xmF').value, m = xpMini, tpl = xpTplByTitle(title), id = xpId('t');
  const saves = [{...xpFromTpl(tpl), ...(tpl && key(tpl.domain) === key(domain) ? {} : {domains: undefined}), id, kind: 'task', is_public: false, title, domain, est, effort, day: m.day, start: m.start, tpl: tpl ? tpl.id : undefined, makeup: tpl ? xpOwed(tpl)[0]?.id : undefined, created: new Date().toISOString()}];
  if (!tpl) { const n = xpNewTpl({title, domain, est, effort}); saves[0].tpl = n.id; saves.push(n); }   // brand new: it joins the grid, top-left
  const dom = xpAddDomain(domain); if (dom.domains) saves.push({...xpCfg(), ...dom});
  xpMini = null; xpSel = id; xpDrawMini(); xpSave(saves);
}
document.addEventListener('dblclick', ev => {
  if (page !== 'expro' || !xpTimed()) return;
  const plane = ev.target.closest('#xpPlane'); if (!plane || ev.target.closest('.xpb,.xpwh')) return;
  const geo = $('xpCal')._geo, r = plane.getBoundingClientRect();
  const day = geo.days[Math.max(0, Math.min(geo.days.length - 1, Math.floor((ev.clientX - r.left - geo.gut) / geo.colW)))], st = Math.max(5, xpStep());
  const start = Math.max(0, Math.min(1440 - st, Math.floor(geo.map.M(ev.clientY - r.top - geo.head - geo.pad) / st) * st));
  const c = xpCfg();
  xpMini = {day, start, x: ev.clientX, y: ev.clientY, domain: c.lastDomain || xpDomains()[0], est: xpLastMin(), effort: c.lastEffort || 3};
  xpSel = null; xpDrawMini(); xpDrawCal(); xpDrawSide();
});

const xpRate = (key, cur, lo = 1) => `<div class="xpr">${[0, 1, 2, 3, 4, 5].filter(n => n >= lo).map(n => `<button class="${n === cur ? 'on' : ''}" data-act="xprate" data-k="${key}" data-v="${n}">${n}</button>`).join('')}</div>`;
const xpPct = (a, b) => { const p = Math.round((a / b - 1) * 100); return Math.abs(p) < 5 ? 'on target' : p > 0 ? `${p}% longer` : `${-p}% shorter`; };
function xpDrawSide() {
  const el = $('xpSide'); if (!el) return;
  const c = xpCfg(), t = xpTasks().find(x => x.id === xpSel), p = !t && all.find(x => x.id === xpSel && x.kind === 'tasktype');
  const bf = !t && !p && xpBusyFind(xpSel), e = !t && !p && !bf && ents().find(x => x.id === xpSel);
  let h = '';
  if (xpDoneForm && t) {
    const f = xpDoneForm;
    h = `<h3>DONE: ${esc(t.title).toUpperCase()}</h3>
      <label>How long did it really take?</label><div class="xpmin">${xpHM(f.min, 'data-hm="done"')}</div>
      <p class="mute">Planned ${sdur(xpEstT(t))}</p>
      <label>How draining was it really?</label>${xpRate('effort', f.effort)}<p class="mute">Planned effort ${t.effort}</p>
      <label>How satisfied are you?</label>${xpRate('sat', f.sat)}
      <button class="go" data-act="xpdone" ${f.sat ? '' : 'disabled'}>SAVE, +${Math.round(f.min)} EXP</button>
      <button class="link" data-act="xpcancel" style="display:block;margin:10px auto 0">Cancel</button>`;
  }
  else if (t && xpNotForm && xpNotForm.id === t.id) {
    const f = xpNotForm;
    h = `<h3>NOT DONE: ${esc(t.title).toUpperCase()}</h3>
      <p class="mute">${xpWhen(t)}${t.start != null ? '-' + clock(t.start + xpLen(t)) : ''}</p>
      <label>What got in the way?</label><input id="xpWhy" value="${esc(f.why)}" maxlength="80" autocomplete="off">
      <button class="go" data-act="xpnot">BACK TO TASKS</button>
      <button class="link" data-act="xpcancel" style="display:block;margin:10px auto 0">Cancel</button>`;
  }
  else if (t) {
    const sh = xpShared(t), r = t.rep && (c.repeats || []).find(x => x.id === t.rep), multi = !t.done && xpSpan(t) > 1 && xpSelIdx != null, one = xpOneDay(t), oneDay = multi ? xpShift(t.day, xpSelIdx) : null;
    h = `<h3>TASK${multi ? `, DAY ${xpSelIdx + 1} OF ${xpSpan(t)}` : ''}</h3>
      ${multi ? `<div class="xpscope"><button class="tag${one ? ' on' : ''}" data-act="xpscope" data-v="day">${esc(new Date(oneDay + 'T12:00').toLocaleDateString(undefined, {weekday: 'short', month: 'short', day: 'numeric'}))} only</button><button class="tag${one ? '' : ' on'}" data-act="xpscope" data-v="all">All ${xpSpan(t)} days</button></div>` : ''}
      <input data-xf="title" value="${esc(t.title)}" maxlength="80">
      ${xpDomEdit(t, 'data-xf')}<label>Time</label>${xpHM(t.est, 'data-xf="est"')}
      <label>Effort</label>${xpRate('teffort', t.effort)}${t.done ? '' : xpSugLine(xpSuggest({id: t.tpl, title: t.title}, t.effort), 'xpsugt')}
      <div class="two"><div><label>Day</label><input data-xf="day" type="date" value="${one ? oneDay : t.day || ''}"></div>
        <div><label>Starts</label><input data-xf="start" type="time" value="${t.start != null ? hmStr(t.start) : ''}"></div></div>
      ${one ? '' : `<label>Days in a row</label><input data-xf="span" type="number" min="1" max="31" value="${xpSpan(t)}">`}
      ${xpNotesHtml(t)}
      <p class="mute">Costs ${num1(xpCost(t.est, t.effort))} energy${(t.missed || []).length ? `. Pushed back ${t.missed.length}x (${t.missed.map(x => x.slice(5)).join(', ')})` : ''}</p>
      ${t.done ? `<div class="xpvs"><b>Done, +${t.done.min} EXP</b>
          <div>Time: planned ${sdur(xpEstT(t))}, took ${sdur(t.done.min)} <em>${xpPct(t.done.min, xpEstT(t))}</em></div>
          <div>Effort: planned ${t.effort}, really ${t.done.effort}</div><div>Satisfaction ${num1(xpSat(t.done))} of 5</div></div>
          <button class="link" data-act="xpundo">Undo done</button>`
        : `<div class="xpdn"><button class="go" data-act="xpdoneopen">DONE</button>${t.day ? '<button class="go2" data-act="xpnotopen">NOT DONE</button>' : ''}</div>`}
      <div class="xplinks">${sh ? `<a class="link" href="/exp/${sh.num || ''}" data-act="go" data-v="exp/${sh.num || ''}">On EXP</a>` : '<button class="link" data-act="xpshare">Share to EXP</button>'}
        ${t.start != null && !t.done ? '<button class="link" data-act="xpunsched">Take off the calendar</button>' : ''}
        ${r ? '<button class="link" data-act="xpstoprep">Stop repeating</button>' : ''}
        <button class="link" data-act="xpdel" data-v="${t.id}">Delete</button><button class="link" data-act="xpdesel">Close</button></div>`;
  }
  else if (p) {
    h = `<h3>${p.archived ? 'IN THE CHEST' : 'TASK BLOCK'}</h3><input data-xp="title" value="${esc(p.title)}" maxlength="80">
      ${xpDomEdit(p, 'data-xp')}<label>Time</label>${xpHM(p.est, 'data-xp="est"')}
      <label>Effort</label>${xpRate('peffort', p.effort)}${xpSugLine(xpSuggest(p, p.effort), 'xpsugp')}
      ${p.timely ? `<div class="two"><div><label>From</label><input data-xp="from" type="date" value="${p.timely.from || ''}"></div><div><label>To</label><input data-xp="to" type="date" value="${p.timely.to || ''}"></div></div>
        <label>Times</label><input data-xp="n" type="number" min="1" max="99" value="${p.timely.n || 1}">
        <p class="mute">On the calendar ${xpUsed(p)} of ${p.timely.n || 1}${xpNow(p) ? '' : '. ' + xpNotNow(p).toLowerCase().replace(/^./, m => m.toUpperCase())}</p>` : ''}
      ${xpNotesHtml(p)}
      <p class="mute">Done ${xpTasks().filter(x => x.done && (x.tpl === p.id || key(x.title) === key(p.title))).length} times</p>
      ${xpOwed(p).length ? `<h3>TO MAKE UP</h3>${xpOwed(p).map(x => `<div class="xpowed"><span>${xpWhen(x.skipped)}${x.skipped.why ? ', ' + esc(x.skipped.why) : ''}</span>
        <button class="link" data-act="xpback" data-v="${x.id}">Put back</button><button class="link" data-act="xpforgive" data-v="${x.id}">Forget it</button></div>`).join('')}` : ''}
      <div class="xplinks"><button class="link" data-act="xptimely">${p.timely ? 'Make it perpetual' : 'Make it timely'}</button><button class="link" data-act="xparch">${p.archived ? 'Take out of the chest' : 'Put in the chest'}</button>
        <button class="link" data-act="xpdel" data-v="${p.id}">Delete</button><button class="link" data-act="xpdesel">Close</button></div>`;
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
    const s = xpTotals([xpDate]), busy = xpBusyOn(xpDate).sort((a, b) => a.start - b.start), ideas = xpRepeatIdeas();
    const offCal = xpTasks().filter(x => x.done && x.done.day === xpDate && x.start == null);
    h = `<h3>${esc(new Date(xpDate + 'T12:00').toLocaleDateString(undefined, {weekday: 'long', month: 'short', day: 'numeric'})).toUpperCase()}</h3>
      <div class="xpdaysum"><div>Sleep: ${xpSleepTxt(xpNight(xpDate))}</div><div><b>${sdur(s.busyMin + s.used)}</b> booked, <b>${s.free - s.used < 0 ? sdur(s.used - s.free) + '</b> double-booked' : sdur(s.free - s.used) + '</b> free'}</div><div><b>${num1(s.spentE)}</b> energy spent, ${num1(s.planE)} planned, max ${xpMaxOn(xpDate).max}</div><div><b>${xpExpOn([xpDate])}</b> EXP</div></div>
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
  const E = ents().filter(e => !e.task && e.start && xpKey(e.start) >= since);
  const total = done.reduce((a, t) => a + t.done.min, 0) + E.reduce((a, e) => a + (e.minutes || 0), 0);
  const avg = l => l.length ? l.reduce((a, v) => a + v, 0) / l.length : null;
  const of = (e, dm) => tagsOf(e, 'types').some(x => key(x) === key(dm));
  const rows = xpDomains().map(dm => {
    const inD = t => xpDoms(t).some(x => key(x) === key(dm)), l = done.filter(inD), le = E.filter(e => of(e, dm)), est = l.reduce((a, t) => a + xpEstT(t), 0);
    const tmin = l.reduce((a, t) => a + t.done.min, 0), min = tmin + le.reduce((a, e) => a + (e.minutes || 0), 0);
    const missed = T.filter(inD).reduce((a, t) => a + [...(t.missed || []), ...(t.skipped ? [t.skipped.day] : [])].filter(x => x >= since).length, 0);
    return {dm, n: l.length + le.length, min, share: total ? min / total : 0, sat: avg([...l.map(t => xpSat(t.done)), ...le.filter(e => e.rating).map(e => e.rating)]),
      effD: avg(l.map(t => t.done.effort - t.effort)), pct: est ? (tmin / est - 1) * 100 : null, missed, tasks: l.length};
  }).filter(r => r.n || r.missed).sort((a, b) => b.min - a.min);
  const f2 = v => v == null ? '-' : v.toFixed(1), pctTxt = p => { p = Math.round(p); return Math.abs(p) < 5 ? 'on target' : p > 0 ? `${p}% longer` : `${-p}% shorter`; };
  const chip = dm => `<span class="chip" style="background:${xpCol(dm)};color:${ink(xpCol(dm))}">${esc(dm)}</span>`;
  const ok = rows.filter(r => r.n >= 2), lo = (k, word) => { const r = ok.filter(x => x[k] != null).sort((a, b) => a[k] - b[k])[0]; return r && r[k] < 3.5 ? `<li>${chip(r.dm)} ${word} (${r[k].toFixed(1)} of 5).</li>` : ''; };
  const under = ok.filter(r => r.pct != null && r.tasks >= 2).sort((a, b) => b.pct - a.pct)[0], pushed = [...rows].sort((a, b) => b.missed - a.missed)[0], big = rows[0];
  const notes = [big && big.n ? `<li>${chip(big.dm)} takes the most of your time: ${Math.round(big.share * 100)}% (${sdur(big.min)}).</li>` : '',
    lo('sat', 'satisfies you least'),
    under && under.pct > 10 ? `<li>${chip(under.dm)} tasks take ${Math.round(under.pct)}% longer than you plan.</li>` : '',
    pushed && pushed.missed ? `<li>${chip(pushed.dm)} gets pushed back the most (${pushed.missed}x).</li>` : ''].join('');
  const rb = (v, l) => `<button class="tag ${xpRange === v ? 'on' : ''}" data-act="xprange" data-v="${v}">${l}</button>`;
  const recent = [...done].sort((a, b) => (b.done.at || '').localeCompare(a.done.at || '')).slice(0, 20);
  const exTypes = new Set(ents().flatMap(e => tagsOf(e, 'types')).map(key));
  el.innerHTML = `<div class="tl srt">${rb('week', 'Last 7 days')}${rb('month', 'Last 30 days')}${rb('all', 'All time')}</div>
    ${notes ? `<h3>WHAT STANDS OUT</h3><ul class="xpnotes">${notes}</ul>` : ''}
    <h3>BY DOMAIN</h3>
    ${rows.length ? table(['Domain', 'Done', 'Time', 'Share', 'Satisfaction', 'Time vs plan', 'Effort vs plan', 'Pushed back'],
      rows.map(r => [chip(r.dm), r.n, sdur(r.min), `<span class="xpshare"><i style="width:${Math.round(r.share * 100)}%"></i></span>${Math.round(r.share * 100)}%`,
        f2(r.sat), r.pct == null ? '-' : pctTxt(r.pct), r.effD == null ? '-' : (r.effD > 0 ? '+' : '') + num1(r.effD), r.missed || '-']), 'xptable')
      : '<p class="mute">Nothing finished in this stretch yet.</p>'}
    ${recent.length ? `<h3>ESTIMATES VS REALITY</h3>${table(['Task', 'Domain', 'Day', 'Time: plan, real', 'Effort: plan, real', 'Satisfaction'],
      recent.map(t => [esc(t.title), xpDoms(t).map(chip).join(' '), t.done.day.slice(5), `${sdur(xpEstT(t))}, ${sdur(t.done.min)} <span class="mute">${xpPct(t.done.min, xpEstT(t))}</span>`, `${t.effort}, ${t.done.effort}`, num1(xpSat(t.done))]), 'xptable')}` : ''}
    <h3>DOMAINS</h3><div class="xpdoms">${xpDomains().map(dm => `<span class="xpdom"><input type="color" data-xcol="${esc(dm)}" value="${xpCol(dm)}">${esc(dm)}${exTypes.has(key(dm)) ? '' : `<button class="link" data-act="xpdomdel" data-v="${esc(dm)}">remove</button>`}</span>`).join('')}</div>
    <div class="xpnew"><input id="xpNewDom" placeholder="New domain" maxlength="30"><button class="go2" data-act="xpdomadd">ADD</button></div>`;
}

/* --- Share to EXP: open the EXP log form filled in from the task; saving it links the two --- */
function xpShare(t) {
  const len = xpLen(t), base = t.day ? new Date(t.day + 'T00:00') : null;
  const s = base && t.start != null ? new Date(+base + t.start * 6e4) : new Date(Date.now() - len * 6e4), e = new Date(+s + len * 6e4);
  openModal('e');
  $('t').value = t.title; $('s').value = loc(s); $('e').value = loc(e);
  draft.types = xpDoms(t); draft.rating = t.done ? Math.round(xpSat(t.done)) : 0; draft.fromTask = t.id; draft.effort = xpEff(t);
  drawDraft(); drawStars(); updExp();
}

/* --- clicks --- */
document.addEventListener('click', ev => {
  if (page !== 'expro') return;
  const b = ev.target.closest('[data-act^="xp"]'); if (!b) return;
  const a = b.dataset.act, v = b.dataset.v, d = xpDay(xpDate), c = xpCfg(), p = all.find(x => x.id === xpSel && x.kind === 'tasktype');
  let t = xpTasks().find(x => x.id === xpSel);
  if (['xpsubadd', 'xpsubdel', 'xpdoneopen', 'xpnotopen', 'xpunsched', 'xpshare', 'xpdel', 'xpdomrm', 'xpsugt'].includes(a) || (a === 'xprate' && b.dataset.k === 'teffort')) t = xpPick(t);
  if (a === 'xpsugt' && t) { xpSaveTask(t.id, {effort: +v}); return; }
  if (a === 'xptimely' && p) { xpSave({...p, timely: p.timely ? undefined : {from: xpToday(), to: xpShift(xpToday(), 6), n: 1}}); return; }
  if (a === 'xpsugp' && p) { xpSave({...p, effort: +v}); return; }
  if (a === 'xpscope') { xpScopeAll = v === 'all'; xpDrawSide(); xpDrawCal(); return; }
  if (a === 'xpday') {
    if (v === '0') { xpDate = xpStart = xpToday(); }
    else if (xpView === 'month') { const z = new Date(xpDate.slice(0, 7) + '-15T12:00'); z.setMonth(z.getMonth() + +v); xpDate = xpKey(z).slice(0, 8) + '01'; }
    else return xpShiftDays(+v);
    xpSel = xpDoneForm = xpMini = null; renderExpro();
  }
  else if (a === 'xpn') xpSetN(xpN + +v);
  else if (a === 'xpdomrm' && (t || p)) { const o = t || p; xpSave({...o, ...xpDomPatch(xpDoms(o).filter(x => x !== v))}); }
  else if (a === 'xpunfold') { xpUnfold = !xpUnfold; renderExpro(); }
  else if (a === 'xpzoom') {
    if (v === 'fit') { xpPx = xpPxMin(); xpDrawCal(); $('xpCal').scrollTop = 0; xpSaveView(); }
    else xpZoom(v === 'in' ? 1.6 : 1 / 1.6);
  }
  else if (a === 'xpview') { xpView = v; xpMini = null; renderExpro(); }
  else if (a === 'xpsetday') { xpDate = v; xpSel = xpDoneForm = null; xpDrawCal(); xpDrawSide(); xpDrawMeters(); }
  else if (a === 'xpgoday') { xpDate = v; if (!xpRangeDays().includes(v) || xpView !== 'days') { xpView = 'days'; if (!xpRangeDays().includes(v)) xpStart = v; } xpSel = xpDoneForm = null; renderExpro(); }
  else if (a === 'xprange') { xpRange = v; xpDrawStats(); }
  else if (a === 'xpadd') xpAdd();
  else if (a === 'xpchest') { xpChest = !xpChest; xpDrawTray(); }
  else if (a === 'xpminiadd') xpMiniAdd();
  else if (a === 'xpminiclose') { xpMini = null; xpDrawMini(); xpDrawCal(); }
  else if (a === 'xpsel') { xpSel = v; xpSelIdx = null; xpDoneForm = xpNotForm = null; xpDrawSide(); xpDrawCal(); }
  else if (a === 'xpdesel') { xpSel = xpDoneForm = null; renderExpro(); }
  else if (a === 'xprate') {
    const n = +v, k = b.dataset.k, e = ents().find(x => x.id === xpSel);
    if (k === 'teffort' && t) xpSaveTask(t.id, {effort: n});
    else if (k === 'peffort' && p) xpSave({...p, effort: n});
    else if (k === 'beffort') xpSaveBusy(xpSel, {effort: n});
    else if (k === 'eeffort' && e) put({...e, effort: n});
    else if (xpDoneForm) { xpDoneForm[k] = n; xpDrawSide(); }
  }
  else if (a === 'xparch' && p) xpSave({...p, archived: !p.archived, order: p.archived ? xpNewTpl(p).order : p.order}, p.archived ? 'Back in your tasks' : 'In the chest');
  else if ((a === 'xpsubadd' || a === 'xpsubdel') && (t || p)) xpSubEdit(t || p, a === 'xpsubdel' ? v : null);
  else if (a === 'xpdoneopen' && t) { xpDoneForm = {min: xpEstT(t), effort: t.effort, sat: null}; xpDrawSide(); }
  else if (a === 'xpmin' && xpDoneForm) { xpDoneForm.min = Math.max(5, xpDoneForm.min + +v); xpDrawSide(); }
  else if (a === 'xpcancel') { xpDoneForm = xpNotForm = null; xpDrawSide(); }
  else if (a === 'xpnotopen' && t) { xpDoneForm = null; xpNotForm = {id: t.id, why: xpInTheWay(t).join(', ')}; xpDrawSide(); setTimeout(() => $('xpWhy') && $('xpWhy').focus({preventScroll: true})); }
  else if (a === 'xpnot' && t) xpNotDone(t, $('xpWhy').value.trim());
  else if (a === 'xpback' || a === 'xpforgive') {
    const s = xpTasks().find(x => x.id === v); if (!s) return;
    xpSave(a === 'xpback' ? {...s, day: s.skipped.day, start: s.skipped.start, skipped: null} : {...s, skipped: {...s.skipped, forgiven: true}}, a === 'xpback' ? 'Back on the calendar' : 'Forgotten');
  }
  else if (a === 'xpdone' && t && xpDoneForm) {
    const f = xpDoneForm; xpDoneForm = null;
    xpSaveTask(t.id, {done: {...f, day: t.day || xpDate, at: new Date().toISOString()}, day: t.day || xpDate}, `+${Math.round(f.min)} EXP, ${t.title} done`);
  }
  else if (a === 'xpundo' && t) xpSaveTask(t.id, {done: null});
  else if (a === 'xpunsched' && t) xpOffCal([t], false, `"${t.title}" is off the calendar`);
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
    else xpSaveCfg({repeats: [...(c.repeats || []), {id: xpId('r'), key: v, title: idea.t.title, domain: idea.t.domain, domains: idea.t.domains, est: idea.t.est, effort: idea.t.effort, dow: idea.dow, start: idea.t.start}]},
      `"${idea.t.title}" will show up every ${XP_DOWS[idea.dow]}`);
  }
  else if (a === 'xpdomadd') { const q = xpAddDomain($('xpNewDom').value); if (q.domains) xpSaveCfg(q); }
  else if (a === 'xpdomdel') {
    if (b.dataset.arm) xpSaveCfg({domains: (c.domains || XP_DOMAINS).filter(x => x !== v)});
    else { b.dataset.arm = 1; b.textContent = 'remove?'; setTimeout(() => { delete b.dataset.arm; b.textContent = 'remove'; }, 3000); }
  }
});
function xpNotDone(t, why) {   // off the calendar, back to its block in the grid, marked to make up
  xpNotForm = null;
  const saves = [{...t, skipped: {day: t.day, start: t.start, why, at: new Date().toISOString()}, day: null, start: null}];
  let tp = all.find(x => x.id === t.tpl && x.kind === 'tasktype') || xpTplByTitle(t.title);
  if (!tp) { tp = {...xpNewTpl(t), ...xpFromTpl(t)}; saves.push(tp); }
  else if (tp.archived) saves.push({...tp, archived: false, order: xpNewTpl(tp).order});
  saves[0].tpl = tp.id; xpSel = tp.id; xpChest = false;
  xpSave(saves, `"${t.title}" is back in your tasks to make up`);
}
function xpSubEdit(o, delId) {   // add the typed subtask, or remove one
  if (delId) return xpSave({...o, subs: (o.subs || []).filter(x => x.id !== delId)});
  const text = ($('xpSubN').value || '').trim(); if (!text) return;
  xpSave({...o, subs: [...(o.subs || []), {id: xpId('s'), text, done: false}]}).then(() => $('xpSubN') && $('xpSubN').focus({preventScroll: true}));
}
function xpAdd() {   // the form under the grid: a new permanent task block, top-left
  const title = $('xpNT').value.trim(); if (!title) { $('xpNT').focus(); return; }
  if (xpTplByTitle(title)) { flash(`"${title}" is already one of your tasks`); return; }
  const hmEl = document.querySelector('[data-hm="new"]'), est = xpReadHM(hmEl); if (!est) { flash('Enter the hours and minutes'); hmEl.focus(); return; }
  const domain = xpNewDom ? $('xpNDn').value.trim() : $('xpND').value; if (!domain) { $('xpNDn').focus(); return; }
  const effort = +$('xpNF').value, n = xpNewTpl({title, domain, est, effort});
  if (xpNewTimely) {
    const from = $('xpNA').value, to = $('xpNB').value, k = Math.round(+$('xpNN').value);
    if (!from || !to || to < from) { flash('Pick a date range'); $('xpNB').focus(); return; }
    if (!(k >= 1)) { flash('How many times?'); $('xpNN').focus(); return; }
    n.timely = {from, to, n: Math.min(99, k)};
  }
  xpNewDom = false;
  xpSave([n, {...xpCfg(), ...xpAddDomain(domain), lastDomain: domain, lastMin: est, lastEffort: effort}], n.timely && !xpNow(n) ? `"${title}" shows up on ${xpMD(n.timely.from)}` : undefined);
  setTimeout(() => $('xpNT') && $('xpNT').focus({preventScroll: true}));
}
/* --- typing --- */
document.addEventListener('keydown', ev => {
  if (page !== 'expro') return;
  if (ev.key === 'Enter' && (['xpNT', 'xpNDn', 'xpNN'].includes(ev.target.id) || ev.target.dataset.hm === 'new')) { ev.preventDefault(); xpAdd(); }
  if (ev.key === 'Enter' && ev.target.closest('#xpMini')) { ev.preventDefault(); xpMiniAdd(); }
  if (ev.key === 'Enter' && ev.target.id === 'xpSubN') { ev.preventDefault(); document.querySelector('[data-act="xpsubadd"]').click(); }
  if (ev.key === 'Enter' && ev.target.dataset.xsubt) { ev.preventDefault(); ev.target.blur(); }
  if (ev.key === 'Enter' && ev.target.id === 'xpNewDom') { ev.preventDefault(); document.querySelector('[data-act="xpdomadd"]').click(); }
  if (ev.key === 'Escape' && xpMini) { xpMini = null; xpDrawMini(); xpDrawCal(); return; }
  if (ev.key === 'Escape' && (xpSel || xpDoneForm) && !ev.target.closest('input,select')) { xpSel = xpDoneForm = null; renderExpro(); }
  if (xpTimed() && !xpMini && !ev.target.closest('input,select,textarea') && !ev.metaKey && !ev.ctrlKey) {
    if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') { ev.preventDefault(); xpShiftDays(ev.key === 'ArrowLeft' ? -1 : 1); }
    else if (ev.key === '+' || ev.key === '=') xpZoom(1.6);
    else if (ev.key === '-' || ev.key === '_') xpZoom(1 / 1.6);
  }
});
document.addEventListener('input', ev => {
  if (page !== 'expro') return;
  if (ev.target.id === 'xpZH') { const cal = $('xpCal'), g = cal && cal._geo; if (g) xpZoom(xpZHpx(+ev.target.value) / g.PX / xpZoomF); }
  if (ev.target.id === 'xpZW') { xpN = 15 - +ev.target.value; $('xpZWv').textContent = xpN + ' day' + (xpN > 1 ? 's' : ''); xpDrawCal(); }
  if (ev.target.id === 'xpDepth') { xpDepthLive = +ev.target.value; xpDrawCal(); xpDrawTray(); }
  if (ev.target.id === 'xmT') xpMiniFill();
  if (ev.target.dataset.hm === 'done' && xpDoneForm) { xpDoneForm.min = xpReadHM(ev.target); const b = document.querySelector('[data-act="xpdone"]'); if (b) b.textContent = `SAVE, +${xpDoneForm.min} EXP`; }
  if (ev.target.dataset.hm === 'mini' && xpMini) { const m = xpReadHM(ev.target); if (m) { xpMini.est = m; xpDrawCal(); } }
});
document.addEventListener('change', ev => {
  if (page !== 'expro') return;
  const e = ev.target, v = e.value, p = all.find(x => x.id === xpSel && x.kind === 'tasktype');
  let t = xpTasks().find(x => x.id === xpSel);
  if (t && (e.dataset.xf || e.dataset.xnote || e.dataset.xsub || e.dataset.xsubt)) t = xpPick(t);   // one day of several: it becomes its own task first
  if (e.id === 'xpZW') return xpSetN(15 - +v);
  if (e.id === 'xpDepth') { xpDepthLive = null; xpSaveCfg({depth: +v}); }
  else if (e.id === 'xpNK') { const keep = $('xpNT').value, tm = xpReadHM(document.querySelector('[data-hm="new"]')); xpNewTimely = v === 't'; xpDrawTray(); $('xpNT').value = keep; xpSetHM(document.querySelector('[data-hm="new"]'), tm); (keep ? $('xpNA') || $('xpNT') : $('xpNT')).focus(); }
  else if (e.id === 'xpND' && v === '__new') { const keep = $('xpNT').value, tm = xpReadHM(document.querySelector('[data-hm="new"]')); xpNewDom = true; xpDrawTray(); $('xpNT').value = keep; xpSetHM(document.querySelector('[data-hm="new"]'), tm); $('xpNDn').focus(); }
  else if (e.id === 'xmD' && v === '__new') { e.outerHTML = '<input id="xmDn" placeholder="New domain" maxlength="30">'; $('xmDn').focus(); }
  else if (e.id === 'xmD' && xpMini) { xpMini.domain = v; xpDrawCal(); }
  else if (e.id === 'xmF' && xpMini) { xpMini.effort = +v; xpDrawCal(); }
  else if (e.dataset.hm === 'done' && xpDoneForm) { xpDoneForm.min = xpReadHM(e); }
  else if ((e.dataset.xnote || e.dataset.xsub || e.dataset.xsubt) && (t || p)) {   // description and subtasks
    const o = t || p;
    if (e.dataset.xnote) xpSave({...o, notes: v.trim() || undefined});
    else if (e.dataset.xsub) xpSave({...o, subs: (o.subs || []).map(x => x.id === e.dataset.xsub ? {...x, done: e.checked} : x)});
    else if (v.trim()) xpSave({...o, subs: (o.subs || []).map(x => x.id === e.dataset.xsubt ? {...x, text: v.trim()} : x)});
  }
  else if ((e.dataset.xf && t) || (e.dataset.xp && p)) {   // editing a task on the calendar, or a block in the grid
    const k = e.dataset.xf || e.dataset.xp, o = t || p, put1 = patch => xpSave({...o, ...patch});
    if (k === 'title' && v.trim()) put1({title: v.trim()});
    else if (k === 'domainAdd' && v === '__new') { e.outerHTML = `<input ${t ? 'data-xf' : 'data-xp'}="domainNew" placeholder="New domain" maxlength="30">`; document.querySelector('[data-xf="domainNew"],[data-xp="domainNew"]').focus(); }
    else if (k === 'domainAdd' && v) put1(xpDomPatch([...xpDoms(o), v]));
    else if (k === 'domainNew' && v.trim()) xpSave([{...o, ...xpDomPatch([...xpDoms(o), v.trim()])}, {...xpCfg(), ...xpAddDomain(v)}]);
    else if (k === 'est') { const m = xpReadHM(e); if (m) put1({est: m}); else flash('Enter the hours and minutes'); }
    else if (['from', 'to'].includes(k) && p && p.timely && v) put1({timely: {...p.timely, [k]: v}});
    else if (k === 'n' && p && p.timely && +v >= 1) put1({timely: {...p.timely, n: Math.min(99, Math.round(+v))}});
    else if (k === 'span' && +v >= 1) put1({span: Math.min(31, Math.round(+v))});
    else if (k === 'day') v ? put1({day: v}) : xpOffCal([t], false, `"${t.title}" is off the calendar`);
    else if (k === 'start') v ? put1({start: hm(v), day: t.day || xpDate}) : xpOffCal([t], false, `"${t.title}" is off the calendar`);
  }
  else if (e.dataset.xb) {
    const k = e.dataset.xb, f = xpBusyFind(xpSel); if (!f) return;
    if (k === 'label') xpSaveBusy(xpSel, {label: v.trim()});
    else if (v) { const m = hm(v); xpSaveBusy(xpSel, k === 'start' ? {start: m} : {len: m > f.b.start ? m - f.b.start : m + 1440 - f.b.start}); }
  }
  else if (e.dataset.xcol) setColor('types', e.dataset.xcol, v);
});

/* --- dragging: grid blocks (to the calendar, to a new spot in the grid, into the chest), "No time yet" tasks,
       moving calendar blocks, stretching time (bottom edge) and effort (corner number) --- */
const xpUnder = ev => document.elementFromPoint(ev.clientX, ev.clientY);
document.addEventListener('pointerdown', ev => {
  if (page !== 'expro') return;
  if (xpMini && !ev.target.closest('#xpMini')) { xpMini = null; xpDrawMini(); xpDrawCal(); }   // clicking elsewhere closes the little form
  if (ev.button) return;
  const g = ev.target.closest('[data-xg]'); if (!g) return;
  const blk = g.closest('[data-xid]'), id = blk.dataset.xid, day = blk.dataset.day, mode = g.dataset.xg;
  let item = null;
  if (mode === 'tray' || mode === 'tpl') { const t = all.find(x => x.id === id); item = {id, kind: 'task', t, title: t.title, domain: t.domain, doms: xpDoms(t), len: t.est, effort: t.effort}; }
  else if (mode !== 'none') item = xpRaw(day).find(x => x.id === id);
  const t0 = item && item.t && item.kind === 'task' && mode !== 'tray' && mode !== 'tpl' ? item.t : null;   // a calendar task: its first day and how many days it runs
  xpDrag = {mode, id, day0: day, x0: ev.clientX, y0: ev.clientY, moved: false, item, cur: item ? {day: t0 ? t0.day : day, span: t0 ? xpSpan(t0) : 1, start: item.start, len: item.len, effort: item.effort} : {}};
  if (t0 && !t0.done && xpSpan(t0) > 1 && ['move', 'len', 'top', 'z'].includes(mode)) {   // a task running several days: grab one day of it
    xpDrag.one = xpGap(t0.day, day); xpDrag.item = {...item, span: 1, idx: 0}; xpDrag.cur.day = day; xpDrag.cur.span = 1;
  }
  ev.preventDefault();
});
document.addEventListener('pointermove', ev => {
  const g = xpDrag; if (!g || g.mode === 'none') return;
  const dx = ev.clientX - g.x0, dy = ev.clientY - g.y0;
  if (!g.moved && Math.hypot(dx, dy) < 4) return;
  g.moved = true;
  const cal = $('xpCal'), under = xpUnder(ev);
  if (g.mode === 'tpl') {   // over the grid: make room at that spot; over the chest: it lights up
    g.overChest = !!(under && under.closest('#xpChest'));
    const sec = xpChest ? '' : all.find(x => x.id === g.id)?.timely ? 't' : 'p'; g.sec = sec;
    const grid = $(sec === 't' ? 'xpGridT' : 'xpGrid'), gr = grid.getBoundingClientRect(), inGrid = !xpChest && ev.clientX > gr.left && ev.clientX < gr.right && ev.clientY > gr.top && ev.clientY < gr.bottom;
    const prev = g.gridAt;
    if (inGrid) { const kids = [...grid.children].filter(k => k.dataset.xid); g.gridAt = kids.findIndex(k => { const r = k.getBoundingClientRect(); return ev.clientY < r.top || (ev.clientY < r.bottom && ev.clientX < r.left + r.width / 2); }); if (g.gridAt < 0) g.gridAt = kids.length - 1; }
    else g.gridAt = null;
    if (prev !== g.gridAt || g.overChest !== g.wasChest) { g.wasChest = g.overChest; xpDrawTray(); }
    if (inGrid || g.overChest) { g.over = false; xpGhost(ev, g, true); return; }
  }
  if (g.mode === 'tray') {   // a "No time yet" task over the grid or the chest: it goes back there
    const was = g.overChest; g.overChest = !!(under && under.closest('#xpChest'));
    g.overGrid = !xpChest && ['xpGrid', 'xpGridT'].some(i => { const gr = $(i).getBoundingClientRect(); return ev.clientX > gr.left && ev.clientX < gr.right && ev.clientY > gr.top && ev.clientY < gr.bottom; });
    if (was !== g.overChest) xpDrawTray();
    if (g.overGrid || g.overChest) { g.over = false; xpGhost(ev, g, false); xpDrawCal(); return; }
  }
  if (xpView === 'month') {
    if (!['tray', 'tpl'].includes(g.mode)) return;
    const cell = under && under.closest('[data-mday]'); g.overDay = cell ? cell.dataset.mday : null;
    xpGhost(ev, g, false); xpDrawMonth(cal); return;
  }
  const geo = cal._geo, box = cal.getBoundingClientRect(), r = $('xpPlane').getBoundingClientRect();
  const colAt = () => geo.days[Math.max(0, Math.min(geo.days.length - 1, Math.floor((ev.clientX - r.left - geo.gut) / geo.colW)))];
  if (['tray', 'tpl'].includes(g.mode)) {
    g.over = ev.clientX > box.left && ev.clientX < box.right && ev.clientY > box.top + geo.head && ev.clientY < box.bottom;
    g.cur = {day: colAt(), start: Math.max(0, Math.min(1440 - xpStep(), xpSnap(geo.map.M(ev.clientY - r.top - geo.head - geo.pad) - 10))), len: g.item.len, effort: g.item.effort};
    xpGhost(ev, g, g.over);
  }
  else if (g.mode === 'move') {
    g.toTray = g.item.kind === 'task' && !g.item.done && !!(under && under.closest('#xpTray'));
    g.cur.start = Math.max(0, Math.min(1440 - xpStep(), xpSnap(geo.map.M(geo.map.Y(g.item.start) + dy))));
    if (g.item.kind === 'task') g.cur.day = g.one != null ? colAt() : xpShift(g.item.t.day, xpGap(g.day0, colAt()));
    $('xpTray').classList.toggle('drop', g.toTray);
  }
  else if (g.mode === 'top') {   // top edge: the start moves, the end stays put
    const end = g.item.start + g.item.len, s = Math.max(0, Math.min(end - xpStep(), xpSnap(geo.map.M(geo.map.Y(g.item.start) + dy))));
    g.cur.start = s; g.cur.len = end - s;
  }
  else if (g.mode === 'left') { const lastD = xpLast(g.item.t), d = colAt() > lastD ? lastD : colAt(); g.cur.day = d; g.cur.span = xpGap(d, lastD) + 1; }
  else if (g.mode === 'right') { const d = colAt() < g.item.t.day ? g.item.t.day : colAt(); g.cur.span = xpGap(g.item.t.day, d) + 1; }
  else if (g.mode === 'len') g.cur.len = Math.max(xpStep(), Math.min(1440, xpSnap(geo.map.M(geo.map.Y(g.item.start + g.item.len) + dy) - g.item.start)));
  else if (g.mode === 'z') g.cur.effort = Math.max(g.item.kind === 'busy' ? 0 : 1, Math.min(5, Math.round(g.item.effort + (dx - dy) / Math.SQRT2 / Math.max(3, xpDepth() * .6))));
  if (!['tray', 'tpl'].includes(g.mode) || g.over) { if (ev.clientY < box.top + geo.head + 30) cal.scrollTop -= 14; else if (ev.clientY > box.bottom - 30) cal.scrollTop += 14; }   // near the edge: scroll
  xpDrawCal(); xpDrawMeters();
});
function xpOffCal(l, chest, msg) {   // tasks off the calendar for now; each keeps (or gets) its block in the grid (or the chest)
  l = l.filter(t => t && !t.done); if (!l.length) return renderExpro();
  const blks = new Map();
  l.forEach(t => {
    const tp = all.find(x => x.id === t.tpl && x.kind === 'tasktype') || xpTplByTitle(t.title) || [...blks.values()].find(x => key(x.title) === key(t.title));
    if (!tp) { const n = {...xpNewTpl(t), ...xpFromTpl(t), archived: !!chest}; n.order -= blks.size; blks.set(n.id, n); }
    else if (chest && !tp.archived) blks.set(tp.id, {...tp, archived: true});
  });
  if (l.some(t => t.id === xpSel)) xpSel = null;
  const del = () => xpDelete(l.map(t => t.id)).then(() => msg && flash(msg));
  if (!blks.size) return del();
  xpSave([...blks.values()]).then(ok => ok && del());
}
function xpGhost(ev, g, hide) {
  let gh = $('xpGhost');
  if (!gh) { gh = document.createElement('div'); gh.id = 'xpGhost'; gh.className = 'xpghost'; gh.textContent = g.item.title; document.body.appendChild(gh); }
  gh.hidden = hide; gh.style.left = ev.clientX + 8 + 'px'; gh.style.top = ev.clientY + 8 + 'px';
}
document.addEventListener('pointerup', () => {
  const g = xpDrag; if (!g) return;
  xpDrag = null;
  const gh = $('xpGhost'); if (gh) gh.remove();
  if (!g.moved) { xpSel = xpSel === g.id && ['tpl', 'tray'].includes(g.mode) ? null : g.id; xpSelIdx = g.one ?? null; xpScopeAll = false; xpDoneForm = xpNotForm = null; xpDrawSide(); xpDrawCal(); xpDrawTray(); return; }
  if (g.mode === 'tpl') {
    const p = all.find(x => x.id === g.id);
    if (g.overChest) return xpSave(xpChest ? {...p, archived: false, order: xpNewTpl(p).order} : {...p, archived: true}, xpChest ? `"${p.title}" is back in your tasks` : `"${p.title}" is in the chest`);
    if (g.gridAt != null) {   // a new order for the whole grid
      const l = xpSec(g.sec).filter(x => x.id !== g.id); l.splice(g.gridAt, 0, p);
      return xpSave(l.map((x, i) => ({...x, order: i})));
    }
    const lastAt = [...xpTasks()].reverse().find(x => key(x.title) === key(p.title) && x.start != null);   // on the month: at the time you last did it (or 9am)
    const at = xpView === 'month' ? (g.overDay ? {day: g.overDay, start: lastAt ? lastAt.start : 540} : null) : g.over ? {day: g.cur.day, start: g.cur.start} : null;
    if (!at) return renderExpro();
    if (xpLeft(p) <= 0) { flash(`"${p.title}" has no times left`); return renderExpro(); }
    const id = xpId('t'); xpSel = id;
    return xpSave({...xpFromTpl(p), id, kind: 'task', is_public: false, title: p.title, domain: p.domain, est: p.est, effort: p.effort, tpl: p.id, makeup: xpOwed(p)[0]?.id, ...at, created: new Date().toISOString()});
  }
  if (g.mode === 'tray') {
    if (g.overChest || g.overGrid) return xpOffCal([all.find(x => x.id === g.id)], g.overChest);
    if (xpView === 'month' && g.overDay) xpSaveTask(g.id, {day: g.overDay, start: null});
    else if (xpView !== 'month' && g.over) { xpSel = g.id; xpSaveTask(g.id, {day: g.cur.day, start: g.cur.start}); }
    else renderExpro();
    return;
  }
  if (g.one != null) { const t = all.find(x => x.id === g.id); if (t) g.id = xpSplitNow(t, g.one).id; g.item = {...g.item, t: all.find(x => x.id === g.id)}; }   // one day of several: it becomes its own task
  if (g.item.kind === 'busy') xpSaveBusy(g.id, {start: g.cur.start, len: g.cur.len, effort: g.cur.effort});
  else if (g.mode === 'move' && g.toTray) xpOffCal([g.item.t], false, `"${g.item.title}" is off the calendar`);
  else if (g.mode === 'move') xpSaveTask(g.id, {day: g.cur.day, start: g.cur.start});
  else if (g.mode === 'len') xpSaveTask(g.id, {est: g.cur.len});
  else if (g.mode === 'top') xpSaveTask(g.id, {start: g.cur.start, est: g.cur.len});
  else if (g.mode === 'left' || g.mode === 'right') xpSaveTask(g.id, {day: g.cur.day, span: g.cur.span});
  else if (g.mode === 'z') xpSaveTask(g.id, {effort: g.cur.effort});
});
window.addEventListener('resize', () => { if (page === 'expro' && xpTimed()) xpDrawCal(); });
setInterval(() => { if (page === 'expro' && !xpDrag && !xpMini && xpTimed() && xpRangeDays().includes(xpToday())) { xpDrawCal(); xpDrawMeters(); } }, 60e3);   // keep "now" moving
