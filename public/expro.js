/* EXPRO (/expro): your private planner for serious life stuff. Only you can see it (every row it saves is private).
   This file loads before app.js and only defines things; app.js calls renderExpro() from render().

   HOW IT FITS TOGETHER
   - YOUR TASKS (the grid on top) are permanent: each one is a kind of task (title, domain, time, effort) that stays there
     forever. Newest go top-left; drag them to rearrange, or into the CHEST to shelve them (click the chest to see what's in it).
     Dragging one onto the calendar puts a copy of it there. Double-clicking an empty spot on the calendar makes a task right
     there; typing a title you've used before fills in the rest, and a brand-new title also becomes a new block in the grid.
   - The calendar (Week: Sunday to Saturday; Month) shows 24-hour days. Up and down is time; how far a block sticks out toward
     you (the Z axis) is effort. Drag a block to move it, its bottom edge to change its time, its corner number for effort.
   - BUSY blocks are time that isn't a task (sleep, work, class); they can repeat.
   - ENERGY = effort x hours (2 hours at effort 3 = 6). There's no budget to set: EXPRO counts what you've spent so far and what
     you've planned, against the most a person can keep up (XP_MAX_DAY, XP_MAX_WEEK below). After XP_LEARN_DAYS days of
     finished things it also knows your own average day and shows it.
   - EXP is the same as on the EXP page: 1 per minute. Finished tasks count toward TOTAL EXP. Domains and EXP Types are one
     list; EXP entries show on the calendar; "Share to EXP" turns a task into an EXP entry (then it's counted once).
   - Unfinished tasks from past days move to the "No time yet" row. The same task on the same weekday at about the same time
     3 times: EXPRO offers to repeat it every week.

   SAVED AS (in the same Supabase "items" table as everything else, all private):
     tasktype   one block in the grid: {title, domain, est, effort, notes, subs:[{id, text, done}], order, archived}
     task       one on the calendar: {title, domain, est, effort, notes, subs, day, start, span (days in a row), tpl, done:{min, effort, went, enjoy, day, at}, missed:[days], rep}
     day        id "day-YYYY-MM-DD": {date, busy:[{id, label, start, len, effort}], skip:[busy rule ids]}
     exprocfg   id "exprocfg": {domains, depth, busyRules, repeats, noRepeat, last*, tplDone, avgTold}
   Times are minutes after midnight; a block can run past midnight. EXP entries can carry "effort" and, when shared from a task, "task". */

const XP_DOMAINS = ['Work', 'Money', 'Health', 'Home', 'Admin', 'People', 'Family', 'Creative'];
const XP_SNAP = 15;
const XP_DOWS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const XP_REPEATS = [['once', 'This day only'], ['daily', 'Every day'], ['weekdays', 'Weekdays'], ['weekends', 'Weekends'], ['dow', 'Every ']];
/* The most energy a person can keep up. A day: about 16 waking hours at an average effort of 3 = 48, so 50; you can do that
   now and then, not daily. A week: six of those days and one to recover = 300. A month: the week's rate over its days. */
const XP_MAX_DAY = 50, XP_MAX_WEEK = 300, XP_LEARN_DAYS = 14;
const XP_PX = .8;   // calendar pixels per minute
let xpView = 'week', xpDate = null, xpSel = null, xpDoneForm = null, xpNotForm = null, xpRange = 'week', xpDrag = null, xpDepthLive = null;
let xpNewDom = false, xpChest = false, xpMini = null, xpRolled = '', xpMigrated = false;
const xpRepMade = new Set();
const xpScroll = {key: null, top: 0};   // where the calendar is scrolled to, kept across redraws
document.addEventListener('scroll', ev => { if (ev.target.id === 'xpCal') xpScroll.top = ev.target.scrollTop; }, true);

/* --- small helpers --- */
const xpKey = d => { const z = new Date(d); z.setMinutes(z.getMinutes() - z.getTimezoneOffset()); return z.toISOString().slice(0, 10); };   // YYYY-MM-DD, your time zone
const xpToday = () => xpKey(new Date());
const xpShift = (k, n) => { const d = new Date(k + 'T12:00'); d.setDate(d.getDate() + n); return xpKey(d); };
const xpDow = k => new Date(k + 'T12:00').getDay();
const xpWeek = k => { const s = xpShift(k, -xpDow(k)); return [0, 1, 2, 3, 4, 5, 6].map(i => xpShift(s, i)); };   // Sunday to Saturday
const xpMonth = k => { const l = [], p = k.slice(0, 7); for (let d = p + '-01'; d.startsWith(p); d = xpShift(d, 1)) l.push(d); return l; };
const xpRangeDays = () => xpView === 'month' ? xpMonth(xpDate) : xpView === 'day' ? [xpDate] : xpWeek(xpDate);
const xpTimed = () => xpView === 'week' || xpView === 'day';   // the views with hours down the side
const xpId = p => p + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const xpTasks = () => all.filter(x => x.kind === 'task');
const xpTpls = (arch = false) => all.filter(x => x.kind === 'tasktype' && !!x.archived === arch).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
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
const xpSnap = m => Math.round(m / XP_SNAP) * XP_SNAP;
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
const xpFromTpl = p => p ? {notes: p.notes || undefined, subs: (p.subs || []).map(x => ({id: xpId('s'), text: x.text, done: false}))} : {};
// planned things you didn't do, still waiting to be made up (a make-up only counts while it isn't itself not done)
const xpOwed = p => xpTasks().filter(t => t.skipped && !t.skipped.forgiven && (t.tpl === p.id || key(t.title) === key(p.title)) && !xpTasks().some(x => x.makeup === t.id && !x.skipped))
  .sort((a, b) => a.skipped.day.localeCompare(b.skipped.day) || (a.skipped.start ?? 0) - (b.skipped.start ?? 0));
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
const xpSubCount = o => (o.subs || []).length ? `${o.subs.filter(x => x.done).length}/${o.subs.length}` : '';
// the description box and subtask checklist, shown for calendar tasks and grid blocks alike
const xpNotesHtml = o => `<label>Description</label><textarea data-xnote="1" rows="3" placeholder="Notes">${esc(o.notes || '')}</textarea>
  <label>Subtasks ${xpSubCount(o)}</label><div class="xpsubs">${(o.subs || []).map(x => `<div class="xpsub${x.done ? ' dn' : ''}"><input type="checkbox" data-xsub="${x.id}"${x.done ? ' checked' : ''}><input data-xsubt="${x.id}" value="${esc(x.text)}" maxlength="120"><button class="link" data-act="xpsubdel" data-v="${x.id}">remove</button></div>`).join('')}
  <div class="xpsub"><input id="xpSubN" placeholder="Add a subtask" maxlength="120" autocomplete="off"><button class="go2" data-act="xpsubadd">ADD</button></div></div>`;
const xpMax = days => days.length === 1 ? XP_MAX_DAY : Math.round(XP_MAX_WEEK / 7 * days.length);

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
async function xpSave(l, msg) {
  l = [].concat(l);
  l.forEach(o => { const i = all.findIndex(x => x.id === o.id); if (i < 0) all.push(o); else all[i] = o; });
  render();
  const {error} = await sb.from('items').upsert(l.map(row));
  if (error) { flash('Save failed: ' + error.message); load(); return false; }
  if (msg) flash(msg);
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
}
const xpSaveDay = (patch, k = xpDate) => xpSave({...xpDay(k), ...patch});
const xpSaveCfg = (patch, msg) => xpSave({...xpCfg(), ...patch}, msg);
const xpSaveTask = (id, patch, msg) => { const t = all.find(x => x.id === id); return t && xpSave({...t, ...patch}, msg); };
function xpSaveBusy(id, patch) {
  const f = xpBusyFind(id); if (!f) return;
  if (f.rule) xpSaveCfg({busyRules: xpCfg().busyRules.map(r => r.id === id ? {...r, ...patch} : r)});
  else xpSaveDay({busy: xpDay(f.day).busy.map(b => b.id === id ? {...b, ...patch} : b)}, f.day);
}
const xpAddDomain = n => { n = (n || '').trim(); return n && !xpDomains().some(x => key(x) === key(n)) ? {domains: [...(xpCfg().domains || XP_DOMAINS), n]} : {}; };
// a new block for the grid, top-left
const xpNewTpl = o => ({id: xpId('p'), kind: 'tasktype', is_public: false, title: o.title, domain: o.domain, est: o.est, effort: o.effort, order: Math.min(0, ...all.filter(x => x.kind === 'tasktype').map(x => x.order ?? 0)) - 1});

/* --- chores when the page opens --- */
function xpChores() {
  const today = xpToday(), c = xpCfg();
  // once: the old tray tasks become permanent blocks in the grid (one per title)
  if (!c.tplDone && !xpMigrated) {
    xpMigrated = true;
    const seen = new Map();
    [...xpTasks()].sort((a, b) => (b.created || '').localeCompare(a.created || '')).forEach(t => { if (!seen.has(key(t.title))) seen.set(key(t.title), t); });
    const tpls = [...seen.values()].map((t, i) => ({id: xpId('p') + i, kind: 'tasktype', is_public: false, title: t.title, domain: t.domain, est: t.est, effort: t.effort, order: i}));
    const loose = xpTasks().filter(t => !t.done && t.start == null && !t.day && !(t.missed || []).length).map(t => t.id);
    xpSave([...tpls, {...c, tplDone: true}]).then(ok => ok && loose.length && xpDelete(loose));
    return;
  }
  if (xpRolled !== today) {   // unfinished tasks from past days: to "No time yet"
    xpRolled = today;
    const late = xpTasks().filter(t => !t.done && t.day && xpLast(t) < today);
    if (late.length) xpSave(late.map(t => ({...t, missed: [...(t.missed || []), t.day], day: null, start: null})),
      `${late.length} unfinished task${late.length > 1 ? 's' : ''} moved to No time yet`);
  }
  const avg = xpAverage();   // the first time EXPRO knows your average day, say so
  if (avg.day && !c.avgTold) xpSaveCfg({avgTold: true}, `Two weeks in: your average day uses ${num1(avg.day)} energy (${Math.round(avg.day / XP_MAX_DAY * 100)}% of the most a person can keep up)`);
  if (xpView === 'month') return;
  const make = [];
  xpRangeDays().filter(k => k >= today).forEach(k => (c.repeats || []).forEach(r => {
    if (r.dow !== xpDow(k) || (r.skip || []).includes(k) || xpRepMade.has(r.id + k) || xpTasks().some(t => t.rep === r.id && (t.day === k || (t.done && t.done.day === k) || (t.skipped && t.skipped.day === k)))) return;
    xpRepMade.add(r.id + k);
    make.push({...xpFromTpl(xpTplByTitle(r.title)), id: xpId('t'), kind: 'task', is_public: false, title: r.title, domain: r.domain, est: r.est, effort: r.effort, day: k, start: r.start, rep: r.id, created: new Date().toISOString()});
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
    ...xpTasks().filter(t => t.start != null && t.day && t.day <= k && xpLast(t) >= k).map(t => ({id: t.id, kind: 'task', t, title: t.title, domain: t.domain, start: t.start, len: xpLen(t), effort: xpEff(t), done: !!t.done, idx: xpGap(t.day, k), span: xpSpan(t)}))
  ];
  if (g && g.item.kind === 'busy') l = l.map(x => x.id === g.id ? {...x, start: g.cur.start, len: g.cur.len, effort: g.cur.effort} : x);   // a repeating block changes on every day at once
  else if (g) {
    l = l.filter(x => x.id !== g.id);
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
// energy that has really been spent: busy time and EXP entries that have happened, finished tasks (only the part before now)
const xpReal = x => x.kind === 'busy' || x.kind === 'exp' || (x.kind === 'task' && x.done);
function xpTotals(days) {
  const s = {free: 0, busyMin: 0, used: 0, planE: 0, spentE: 0}, now = new Date(), today = xpToday(), nowMin = now.getHours() * 60 + now.getMinutes();
  days.forEach(k => {
    xpItemsFor(k).filter(x => !x.lifted && x.id !== '__mini').forEach(x => {
      const c = xpCost(x.len, x.effort);
      if (x.kind === 'busy') s.busyMin += x.len; else s.used += x.len;
      s.planE += c;
      if (xpReal(x) && k <= today) { const end = k < today ? x.start + x.len : Math.min(x.start + x.len, nowMin); if (end > x.start) s.spentE += xpCost(end - x.start, x.effort); }
    });
    s.free += 1440;
  });
  s.free -= s.busyMin;
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
    if (items.some(x => x.kind !== 'busy' && xpReal(x))) l.push(items.filter(xpReal).reduce((a, x) => a + xpCost(x.len, x.effort), 0));
  }
  const v = l.length >= XP_LEARN_DAYS ? {day: l.reduce((a, b) => a + b, 0) / l.length, n: l.length} : {n: l.length, day: null};
  xpAvgCache = {k: ck, v}; return v;
}

/* --- drawing --- */
function renderExpro() {
  const el = $('pgExpro'); if (!el || page !== 'expro') return;
  if (!owner) { el.innerHTML = `<p class="mute">${loaded ? 'This page is private.' : 'Loading...'}</p>`; return; }
  if (!loaded) { el.innerHTML = '<p class="mute">Loading...</p>'; return; }
  xpDate = xpDate || xpToday();
  const sy = scrollY;   // redrawing briefly shortens the page, which made the browser jump to the top; put the scroll back after
  xpChores();
  const today = xpToday(), wk = xpWeek(xpDate), fmt = (k, o) => new Date(k + 'T12:00').toLocaleDateString(undefined, o);
  const lbl = xpView === 'month' ? fmt(xpDate, {month: 'long', year: 'numeric'}) : xpView === 'day' ? fmt(xpDate, {weekday: 'long', month: 'short', day: 'numeric'}) : `${fmt(wk[0], {month: 'short', day: 'numeric'})} - ${fmt(wk[6], {month: 'short', day: 'numeric'})}`;
  const tab = (v, l) => `<button class="tag ${xpView === v ? 'on' : ''}" data-act="xpview" data-v="${v}">${l}</button>`, cal = xpView !== 'domains';
  el.innerHTML = `<div class="xpro">
    <div class="xphead">
      <div class="xpdate"><button class="ib" data-act="xpday" data-v="-1" aria-label="Back">&larr;</button><b>${esc(lbl)}</b><button class="ib" data-act="xpday" data-v="1" aria-label="Forward">&rarr;</button>${xpRangeDays().includes(today) ? '' : '<button class="link" data-act="xpday" data-v="0">Today</button>'}</div>
      <div class="xptabs">${tab('day', 'Day')}${tab('week', 'Week')}${tab('month', 'Month')}${tab('domains', 'Domains')}</div>
      ${xpTimed() ? `<label class="xpdepth">3D <input type="range" id="xpDepth" min="0" max="16" value="${xpDepth()}"></label>` : ''}
    </div>
    ${cal ? `<div class="xptop"><div class="xpmeters" id="xpMeters"></div><div class="xptray" id="xpTray"></div></div>
      <div class="xpbody"><div class="xpcal${xpView === 'month' ? ' month' : ''}" id="xpCal"></div><aside class="xpside" id="xpSide"></aside></div>`
      : `<div id="xpStats"></div>`}
  </div>`;
  if (cal) { xpDrawMeters(); xpDrawTray(); xpDrawCal(); xpDrawSide(); }
  else xpDrawStats();
  xpDrawMini();
  if (scrollY !== sy) scrollTo(0, sy);
}

function xpDrawMeters() {
  const m = $('xpMeters'); if (!m) return;
  const days = xpRangeDays(), s = xpTotals(days), max = xpMax(days), avg = xpAverage(), tLeft = s.free - s.used, today = xpToday();
  const pct = v => Math.min(100, v / max * 100), over = s.planE > max, avgR = avg.day && avg.day * days.length;
  m.innerHTML = `<div class="xpm"><span>TIME</span><div class="xpbar${tLeft < 0 ? ' over' : ''}"><i style="width:${s.free > 0 ? Math.min(100, s.used / s.free * 100) : 100}%"></i></div>
      <div><b>${sdur(s.used)}</b> of ${sdur(s.free)} free, <b class="${tLeft < 0 ? 'neg' : ''}">${tLeft < 0 ? sdur(-tLeft) + ' over' : sdur(tLeft) + ' left'}</b></div></div>
    <div class="xpm"><span>ENERGY</span><div class="xpbar e${over ? ' over' : ''}"><i class="pl" style="width:${pct(s.planE)}%"></i><i class="sp" style="width:${pct(s.spentE)}%"></i>${avgR ? `<u style="left:${pct(avgR)}%"></u>` : ''}</div>
      <div><b>${num1(s.spentE)}</b> spent so far, <b class="${over ? 'neg' : ''}">${num1(s.planE)}</b> planned, max ${max}</div>
      <div class="mute">${avg.day ? `Your average: ${num1(avg.day)} a day (${Math.round(avg.day / XP_MAX_DAY * 100)}% of max)` : `Learning your average: ${avg.n} of ${XP_LEARN_DAYS} days`}</div></div>
    <div class="xpm"><span>EXP</span><div>Today <b>${xpExpOn([today]).toLocaleString()}</b>, this week <b>${xpExpOn(xpWeek(today)).toLocaleString()}</b>, this month <b>${xpExpOn(xpMonth(today)).toLocaleString()}</b></div></div>`;
}

// a block's three visible faces: the front (raised by its effort), its left side and its bottom
function xpFaces(col, kind) {
  const base = kind === 'busy' ? '#4b5568' : col;
  return {top: blend('#3a435e', base, kind === 'busy' ? .6 : .62), left: blend('#161c27', base, .38), bot: blend('#0e131b', base, .3)};
}
const xpDomSelect = (cur, attrs) => `<select ${attrs}>${xpDomains().concat(cur && !xpDomains().some(x => key(x) === key(cur)) ? [cur] : []).map(v => `<option${key(v) === key(cur || '') ? ' selected' : ''}>${esc(v)}</option>`).join('')}<option value="__new">New domain...</option></select>`;
const xpBlock3d = (o, cls, attrs, extra = '') => {
  // the same block as on the calendar: its left side and bottom show below-left of the front, as deep as its effort
  const f = xpFaces(xpCol(o.domain)), e = Math.min(16, o.effort * xpDepth() * .6 * Math.SQRT1_2);
  return `<div class="${cls}${xpSel === o.id ? ' sel' : ''}" data-xid="${o.id}" ${attrs} style="background:${f.top};color:${ink(f.top)};--e:${e.toFixed(1)}px;--l:${f.left};--b:${f.bot}">
    <b>${esc(o.title)}</b><span>${esc(o.domain)}, ${sdur(o.est)}, effort ${o.effort}${(o.subs || []).length ? ', ' + xpSubCount(o) : ''}</span>${extra}</div>`;
};
function xpDrawTray() {
  const el = $('xpTray'); if (!el) return;
  const days = new Set(xpRangeDays()), loose = xpTasks().filter(t => !t.done && !t.skipped && t.start == null && (!t.day || days.has(t.day)));
  const g = xpDrag && xpDrag.mode === 'tpl' && xpDrag.gridAt != null ? xpDrag : null;
  let tp = xpTpls(xpChest);
  if (g && !xpChest) { const it = tp.find(x => x.id === g.id); tp = tp.filter(x => x !== it); tp.splice(g.gridAt, 0, it); }   // live preview of the new order
  const c = xpCfg(), eff = [1, 2, 3, 4, 5].map(n => `<option value="${n}"${n === (c.lastEffort || 3) ? ' selected' : ''}>effort ${n}</option>`).join('');
  const nArch = xpTpls(true).length;
  el.innerHTML = `${loose.length ? `<div class="xploose"><span>NO TIME YET</span>${loose.map(t => xpBlock3d(t, 'xpt sm', 'data-xg="tray"',
      `${t.day ? `<em>${new Date(t.day + 'T12:00').toLocaleDateString(undefined, {weekday: 'short', day: 'numeric'})}</em>` : ''}${(t.missed || []).length ? `<em>pushed back ${t.missed.length}x</em>` : ''}`)).join('')}</div>` : ''}
    <div class="xpgw"><div class="xpgrid" id="xpGrid">${tp.map(t => { const ow = xpOwed(t); return xpBlock3d(t, 'xpt' + (g && g.id === t.id ? ' lifted' : '') + (ow.length ? ' owe' : ''), `data-xg="tpl"${ow.length ? ` title="Not done: ${esc(ow.map(x => xpWhen(x.skipped) + (x.skipped.why ? ' (' + x.skipped.why + ')' : '')).join('; '))}"` : ''}`, ow.length ? `<u class="xpowe">MAKE UP${ow.length > 1 ? ' ' + ow.length : ''}</u>` : ''); }).join('') || `<span class="mute">${xpChest ? 'The chest is empty.' : 'No tasks yet.'}</span>`}</div>
      <button class="xpchest${xpChest ? ' open' : ''}${xpDrag && xpDrag.overChest ? ' drop' : ''}" id="xpChest" data-act="xpchest">${xpChest ? 'BACK TO<br>TASKS' : `CHEST<br><small>${nArch}</small>`}</button></div>
    ${xpChest ? '' : `<div class="xpnew"><input id="xpNT" placeholder="New task" maxlength="80" autocomplete="off">
      ${xpNewDom ? '<input id="xpNDn" class="xpnd" placeholder="New domain" maxlength="30" autocomplete="off">' : xpDomSelect(c.lastDomain || xpDomains()[0], 'id="xpND"')}
      <input id="xpNE" class="xpne" value="${esc(c.lastTime || '30m')}" autocomplete="off">
      <select id="xpNF">${eff}</select><button class="go2" data-act="xpadd">ADD</button></div>`}`;
  el.classList.toggle('drop', !!(xpDrag && xpDrag.toTray));
}

function xpDrawCal() {
  const el = $('xpCal'); if (!el) return;
  if (xpView === 'month') return xpDrawMonth(el);
  const days = xpRangeDays(), k = xpDepth() * .6 * Math.SQRT1_2, PX = XP_PX, pad = Math.round(5 * k) + 8, gut = 50, head = 34;
  const W = el.clientWidth || 700, colW = (W - gut - 4) / days.length, y = t => head + pad + t * PX, today = xpToday();
  const keyNow = days[0], old = xpScroll.key === keyNow ? xpScroll.top : null;
  let h = `<div class="xpwh" style="height:${head}px;padding-left:${gut}px">${days.map(d => `<button class="${d === xpDate ? 'on' : ''}${d === today ? ' today' : ''}" data-act="xpsetday" data-v="${d}" style="width:${colW}px">${new Date(d + 'T12:00').toLocaleDateString(undefined, {weekday: 'short', day: 'numeric'})}</button>`).join('')}</div>`;
  for (let m = 0; m <= 1440; m += 30) h += `<div class="xph${m % 60 ? ' half' : ''}" style="top:${y(m)}px">${m % 60 || m === 1440 ? '' : `<span>${clock(m)}</span>`}</div>`;
  days.forEach((d, i) => { h += `<div class="xpcol${d === xpDate ? ' on' : ''}" style="left:${gut + i * colW}px;width:${colW}px;top:${head}px"></div>`; });
  const ti = days.indexOf(today);
  if (ti >= 0) { const n = new Date(); h += `<div class="xpnow" style="top:${y(n.getHours() * 60 + n.getMinutes())}px;left:${gut + ti * colW}px;width:${colW}px"></div>`; }
  let z = 2;
  days.forEach((d, i) => xpLanes(xpItemsFor(d)).sort((a, b) => a.start - b.start || b.lane - a.lane).forEach(x => {
    // a task running several days: its pieces reach the column edges so they read as one block
    const lw = colW / x.lanes, e = x.effort * k, ls = gut + i * colW + x.lane * lw, cl = x.span > 1 && x.idx > 0, cr = x.span > 1 && x.idx < x.span - 1;
    const fl = ls + (cl ? 0 : 2 + e), fr = ls + lw - (cr ? 0 : 2), w = Math.max(20, fr - fl), bx = fl - e, by = y(x.start), bh = Math.max(12, x.len * PX - 2);
    const first = !x.span || x.idx === 0, last = !x.span || x.idx === x.span - 1;
    const f = xpFaces(xpCol(x.domain), x.kind), small = bh < 30, still = x.cut || x.kind === 'exp' || x.id === '__mini';
    const plan = x.kind === 'task' && x.done && !x.cut && x.t ? `<div class="xpplan" style="height:${x.t.est * PX - 2}px;transform:translate(${e}px,${-e}px)"></div>` : '';
    const info = [x.kind === 'busy' ? '' : esc(x.domain || ''), `${clock(x.start)}-${clock(x.start + x.len)}`, `effort ${x.effort}`, x.span > 1 ? `day ${x.idx + 1} of ${x.span}` : '', x.t ? xpSubCount(x.t) : '', x.t && x.t.makeup ? 'make up' : ''].filter(Boolean).join(', ');
    h += `<div class="xpb ${x.kind}${cl ? ' cl' : ''}${cr ? ' cr' : ''}${x.done ? ' done' : ''}${x.ghost ? ' ghost' : ''}${x.lifted ? ' lifted' : ''}${xpSel === x.id ? ' sel' : ''}" data-xid="${x.id}" data-day="${d}" style="left:${bx}px;top:${by}px;width:${w}px;height:${bh}px;z-index:${z++}">
      <svg class="xps" width="1" height="1">${cl ? '' : `<polygon fill="${f.left}" points="0,0 ${e},${-e} ${e},${bh - e} 0,${bh}"/>`}<polygon fill="${f.bot}" points="0,${bh} ${w},${bh} ${w + e},${bh - e} ${e},${bh - e}"/></svg>
      ${plan}<div class="xpf${small ? ' small' : ''}" data-xg="${still ? 'none' : 'move'}" style="transform:translate(${e}px,${-e}px);background:${f.top};color:${ink(f.top)}">
        <b>${x.done && x.kind === 'task' ? 'Done: ' : ''}${esc(x.title)}</b>${small ? '' : `<span>${info}</span>`}
        ${still || x.done ? '' : `${x.cut ? '' : '<i class="xpgt" data-xg="top"></i>'}${x.cutEnd ? '' : '<i class="xpgl" data-xg="len"></i>'}${x.kind === 'task' && first ? '<i class="xpgL" data-xg="left"></i>' : ''}${x.kind === 'task' && last ? '<i class="xpgR" data-xg="right"></i>' : ''}${last ? `<i class="xpgz" data-xg="z">${x.effort}</i>` : ''}`}</div></div>`;
  }));
  el.innerHTML = `<div class="xpplane" id="xpPlane" style="height:${head + pad + 1440 * PX + 16}px">${h}</div>`;
  el._geo = {pad, gut, colW, PX, days, head};
  xpScroll.key = keyNow;
  if (old != null) el.scrollTop = old;   // keep your place when redrawing; a new week starts near now (or its first task, or 7am)
  else {
    const firsts = days.flatMap(d => xpItemsFor(d).filter(x => x.kind !== 'busy').map(x => x.start)), n = new Date();
    el.scrollTop = Math.max(0, y(ti >= 0 ? n.getHours() * 60 + n.getMinutes() - 90 : firsts.length ? Math.min(...firsts) - 30 : 7 * 60) - head);
  }
  xpScroll.top = el.scrollTop;
}
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
    <div class="xmrow">${xpDomSelect(m.domain, 'id="xmD"')}<input id="xmE" value="${sdur(m.est)}" autocomplete="off"><select id="xmF">${[1, 2, 3, 4, 5].map(n => `<option value="${n}"${n === m.effort ? ' selected' : ''}>effort ${n}</option>`).join('')}</select></div>
    <div class="xmrow"><button class="go2" data-act="xpminiadd">ADD</button><button class="link" data-act="xpminiclose">Cancel</button></div>`;
  document.body.appendChild(el);
  $('xmT').focus();
}
function xpMiniFill() {   // a title you've used before: fill in its domain, time and effort
  const v = $('xmT').value, src = xpTplByTitle(v) || [...xpTasks()].reverse().find(t => key(t.title) === key(v));
  xpMini.title = v;
  if (src && $('xmD')) { xpMini.domain = src.domain; xpMini.est = src.est; xpMini.effort = src.effort; $('xmD').outerHTML = xpDomSelect(src.domain, 'id="xmD"'); $('xmE').value = sdur(src.est); $('xmF').value = src.effort; }
  xpDrawCal();
}
function xpMiniAdd() {
  const title = $('xmT').value.trim(); if (!title) { $('xmT').focus(); return; }
  const est = xpParse($('xmE').value); if (!est) { flash('Time: try 45m, 1h30, 1:30 or 2h'); $('xmE').focus(); return; }
  const dn = $('xmDn'), domain = dn ? dn.value.trim() : $('xmD').value; if (!domain) { dn.focus(); return; }
  const effort = +$('xmF').value, m = xpMini, tpl = xpTplByTitle(title), id = xpId('t');
  const saves = [{...xpFromTpl(tpl), id, kind: 'task', is_public: false, title, domain, est, effort, day: m.day, start: m.start, tpl: tpl ? tpl.id : undefined, makeup: tpl ? xpOwed(tpl)[0]?.id : undefined, created: new Date().toISOString()}];
  if (!tpl) { const n = xpNewTpl({title, domain, est, effort}); saves[0].tpl = n.id; saves.push(n); }   // brand new: it joins the grid, top-left
  const dom = xpAddDomain(domain); if (dom.domains) saves.push({...xpCfg(), ...dom});
  xpMini = null; xpSel = id; xpDrawMini(); xpSave(saves);
}
document.addEventListener('dblclick', ev => {
  if (page !== 'expro' || !xpTimed()) return;
  const plane = ev.target.closest('#xpPlane'); if (!plane || ev.target.closest('.xpb,.xpwh')) return;
  const geo = $('xpCal')._geo, r = plane.getBoundingClientRect();
  const day = geo.days[Math.max(0, Math.min(6, Math.floor((ev.clientX - r.left - geo.gut) / geo.colW)))];
  const start = Math.max(0, Math.min(1440 - XP_SNAP, Math.floor((ev.clientY - r.top - geo.head - geo.pad) / geo.PX / XP_SNAP) * XP_SNAP));
  const c = xpCfg();
  xpMini = {day, start, x: ev.clientX, y: ev.clientY, domain: c.lastDomain || xpDomains()[0], est: xpParse(c.lastTime || '') || 30, effort: c.lastEffort || 3};
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
      <label>How long did it really take?</label><div class="xpmin"><button class="tag" data-act="xpmin" data-v="-15">-15</button><input id="xpDM" value="${sdur(f.min)}" autocomplete="off"><button class="tag" data-act="xpmin" data-v="15">+15</button></div>
      <p class="mute">Planned ${sdur(xpEstT(t))}</p>
      <label>How draining was it really?</label>${xpRate('effort', f.effort)}<p class="mute">Planned effort ${t.effort}</p>
      <label>How did it go?</label>${xpRate('went', f.went)}
      <label>Did you enjoy it?</label>${xpRate('enjoy', f.enjoy)}
      <button class="go" data-act="xpdone" ${f.went && f.enjoy ? '' : 'disabled'}>SAVE, +${Math.round(f.min)} EXP</button>
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
    const sh = xpShared(t), r = t.rep && (c.repeats || []).find(x => x.id === t.rep);
    h = `<h3>TASK</h3><input data-xf="title" value="${esc(t.title)}" maxlength="80">
      <div class="two"><div><label>Domain</label>${xpDomSelect(t.domain, 'data-xf="domain"')}</div>
        <div><label>Time</label><input data-xf="est" value="${sdur(t.est)}" autocomplete="off"></div></div>
      <label>Effort</label>${xpRate('teffort', t.effort)}
      <div class="two"><div><label>Day</label><input data-xf="day" type="date" value="${t.day || ''}"></div>
        <div><label>Starts</label><input data-xf="start" type="time" value="${t.start != null ? hmStr(t.start) : ''}"></div></div>
      <label>Days in a row</label><input data-xf="span" type="number" min="1" max="31" value="${xpSpan(t)}">
      ${xpNotesHtml(t)}
      <p class="mute">Costs ${num1(xpCost(t.est, t.effort))} energy${(t.missed || []).length ? `. Pushed back ${t.missed.length}x (${t.missed.map(x => x.slice(5)).join(', ')})` : ''}</p>
      ${t.done ? `<div class="xpvs"><b>Done, +${t.done.min} EXP</b>
          <div>Time: planned ${sdur(xpEstT(t))}, took ${sdur(t.done.min)} <em>${xpPct(t.done.min, xpEstT(t))}</em></div>
          <div>Effort: planned ${t.effort}, really ${t.done.effort}</div><div>Went ${t.done.went} of 5, enjoyed ${t.done.enjoy} of 5</div></div>
          <button class="link" data-act="xpundo">Undo done</button>`
        : `<div class="xpdn"><button class="go" data-act="xpdoneopen">DONE</button>${t.day ? '<button class="go2" data-act="xpnotopen">NOT DONE</button>' : ''}</div>`}
      <div class="xplinks">${sh ? `<a class="link" href="/exp/${sh.num || ''}" data-act="go" data-v="exp/${sh.num || ''}">On EXP</a>` : '<button class="link" data-act="xpshare">Share to EXP</button>'}
        ${t.start != null && !t.done ? '<button class="link" data-act="xpunsched">Take off the calendar</button>' : ''}
        ${r ? '<button class="link" data-act="xpstoprep">Stop repeating</button>' : ''}
        <button class="link" data-act="xpdel" data-v="${t.id}">Delete</button><button class="link" data-act="xpdesel">Close</button></div>`;
  }
  else if (p) {
    h = `<h3>${p.archived ? 'IN THE CHEST' : 'TASK BLOCK'}</h3><input data-xp="title" value="${esc(p.title)}" maxlength="80">
      <div class="two"><div><label>Domain</label>${xpDomSelect(p.domain, 'data-xp="domain"')}</div>
        <div><label>Time</label><input data-xp="est" value="${sdur(p.est)}" autocomplete="off"></div></div>
      <label>Effort</label>${xpRate('peffort', p.effort)}
      ${xpNotesHtml(p)}
      <p class="mute">Done ${xpTasks().filter(x => x.done && (x.tpl === p.id || key(x.title) === key(p.title))).length} times</p>
      ${xpOwed(p).length ? `<h3>TO MAKE UP</h3>${xpOwed(p).map(x => `<div class="xpowed"><span>${xpWhen(x.skipped)}${x.skipped.why ? ', ' + esc(x.skipped.why) : ''}</span>
        <button class="link" data-act="xpback" data-v="${x.id}">Put back</button><button class="link" data-act="xpforgive" data-v="${x.id}">Forget it</button></div>`).join('')}` : ''}
      <div class="xplinks"><button class="link" data-act="xparch">${p.archived ? 'Take out of the chest' : 'Put in the chest'}</button>
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
      <div class="xpdaysum"><div><b>${sdur(s.used)}</b> planned of ${sdur(s.free)} free</div><div><b>${num1(s.spentE)}</b> energy spent, ${num1(s.planE)} planned, max ${XP_MAX_DAY}</div><div><b>${xpExpOn([xpDate])}</b> EXP</div></div>
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
    const l = done.filter(t => key(t.domain) === key(dm)), le = E.filter(e => of(e, dm)), est = l.reduce((a, t) => a + xpEstT(t), 0);
    const tmin = l.reduce((a, t) => a + t.done.min, 0), min = tmin + le.reduce((a, e) => a + (e.minutes || 0), 0);
    const missed = T.filter(t => key(t.domain) === key(dm)).reduce((a, t) => a + [...(t.missed || []), ...(t.skipped ? [t.skipped.day] : [])].filter(x => x >= since).length, 0);
    return {dm, n: l.length + le.length, min, share: total ? min / total : 0, went: avg(l.map(t => t.done.went)), enjoy: avg([...l.map(t => t.done.enjoy), ...le.filter(e => e.rating).map(e => e.rating)]),
      effD: avg(l.map(t => t.done.effort - t.effort)), pct: est ? (tmin / est - 1) * 100 : null, missed, tasks: l.length};
  }).filter(r => r.n || r.missed).sort((a, b) => b.min - a.min);
  const f2 = v => v == null ? '-' : v.toFixed(1), pctTxt = p => { p = Math.round(p); return Math.abs(p) < 5 ? 'on target' : p > 0 ? `${p}% longer` : `${-p}% shorter`; };
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
        f2(r.went), f2(r.enjoy), r.pct == null ? '-' : pctTxt(r.pct), r.effD == null ? '-' : (r.effD > 0 ? '+' : '') + num1(r.effD), r.missed || '-']), 'xptable')
      : '<p class="mute">Nothing finished in this stretch yet.</p>'}
    ${recent.length ? `<h3>ESTIMATES VS REALITY</h3>${table(['Task', 'Domain', 'Day', 'Time: plan, real', 'Effort: plan, real', 'Went', 'Enjoyed'],
      recent.map(t => [esc(t.title), chip(t.domain), t.done.day.slice(5), `${sdur(xpEstT(t))}, ${sdur(t.done.min)} <span class="mute">${xpPct(t.done.min, xpEstT(t))}</span>`, `${t.effort}, ${t.done.effort}`, t.done.went, t.done.enjoy]), 'xptable')}` : ''}
    <h3>DOMAINS</h3><div class="xpdoms">${xpDomains().map(dm => `<span class="xpdom"><input type="color" data-xcol="${esc(dm)}" value="${xpCol(dm)}">${esc(dm)}${exTypes.has(key(dm)) ? '' : `<button class="link" data-act="xpdomdel" data-v="${esc(dm)}">remove</button>`}</span>`).join('')}</div>
    <div class="xpnew"><input id="xpNewDom" placeholder="New domain" maxlength="30"><button class="go2" data-act="xpdomadd">ADD</button></div>`;
}

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
  const a = b.dataset.act, v = b.dataset.v, d = xpDay(xpDate), c = xpCfg(), t = xpTasks().find(x => x.id === xpSel), p = all.find(x => x.id === xpSel && x.kind === 'tasktype');
  if (a === 'xpday') {
    if (v === '0') xpDate = xpToday();
    else if (xpView === 'month') { const z = new Date(xpDate.slice(0, 7) + '-15T12:00'); z.setMonth(z.getMonth() + +v); xpDate = xpKey(z).slice(0, 8) + '01'; }
    else xpDate = xpShift(xpDate, (xpView === 'day' ? 1 : 7) * v);
    xpSel = xpDoneForm = xpMini = null; renderExpro();
  }
  else if (a === 'xpview') { xpView = v; xpMini = null; renderExpro(); }
  else if (a === 'xpsetday') { xpDate = v; xpSel = xpDoneForm = null; xpDrawCal(); xpDrawSide(); }
  else if (a === 'xpgoday') { xpDate = v; xpView = 'week'; xpSel = xpDoneForm = null; renderExpro(); }
  else if (a === 'xprange') { xpRange = v; xpDrawStats(); }
  else if (a === 'xpadd') xpAdd();
  else if (a === 'xpchest') { xpChest = !xpChest; xpDrawTray(); }
  else if (a === 'xpminiadd') xpMiniAdd();
  else if (a === 'xpminiclose') { xpMini = null; xpDrawMini(); xpDrawCal(); }
  else if (a === 'xpsel') { xpSel = v; xpDoneForm = xpNotForm = null; xpDrawSide(); xpDrawCal(); }
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
  else if (a === 'xpdoneopen' && t) { xpDoneForm = {min: xpEstT(t), effort: t.effort, went: null, enjoy: null}; xpDrawSide(); }
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
  else if (a === 'xpunsched' && t) xpSaveTask(t.id, {start: null});
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
  const est = xpParse($('xpNE').value); if (!est) { flash('Time: try 45m, 1h30, 1:30 or 2h'); $('xpNE').focus(); return; }
  const domain = xpNewDom ? $('xpNDn').value.trim() : $('xpND').value; if (!domain) { $('xpNDn').focus(); return; }
  const effort = +$('xpNF').value;
  xpNewDom = false;
  xpSave([xpNewTpl({title, domain, est, effort}), {...xpCfg(), ...xpAddDomain(domain), lastDomain: domain, lastTime: sdur(est), lastEffort: effort}]);
  setTimeout(() => $('xpNT') && $('xpNT').focus({preventScroll: true}));
}
/* --- typing --- */
document.addEventListener('keydown', ev => {
  if (page !== 'expro') return;
  if (ev.key === 'Enter' && ['xpNT', 'xpNE', 'xpNDn'].includes(ev.target.id)) { ev.preventDefault(); xpAdd(); }
  if (ev.key === 'Enter' && ev.target.closest('#xpMini')) { ev.preventDefault(); xpMiniAdd(); }
  if (ev.key === 'Enter' && ev.target.id === 'xpSubN') { ev.preventDefault(); document.querySelector('[data-act="xpsubadd"]').click(); }
  if (ev.key === 'Enter' && ev.target.dataset.xsubt) { ev.preventDefault(); ev.target.blur(); }
  if (ev.key === 'Enter' && ev.target.id === 'xpNewDom') { ev.preventDefault(); document.querySelector('[data-act="xpdomadd"]').click(); }
  if (ev.key === 'Escape' && xpMini) { xpMini = null; xpDrawMini(); xpDrawCal(); return; }
  if (ev.key === 'Escape' && (xpSel || xpDoneForm) && !ev.target.closest('input,select')) { xpSel = xpDoneForm = null; renderExpro(); }
});
document.addEventListener('input', ev => {
  if (page !== 'expro') return;
  if (ev.target.id === 'xpDepth') { xpDepthLive = +ev.target.value; xpDrawCal(); xpDrawTray(); }
  if (ev.target.id === 'xmT') xpMiniFill();
  if (ev.target.id === 'xmE' && xpMini) { const m = xpParse(ev.target.value); if (m) { xpMini.est = m; xpDrawCal(); } }
});
document.addEventListener('change', ev => {
  if (page !== 'expro') return;
  const e = ev.target, v = e.value, t = xpTasks().find(x => x.id === xpSel), p = all.find(x => x.id === xpSel && x.kind === 'tasktype');
  if (e.id === 'xpDepth') { xpDepthLive = null; xpSaveCfg({depth: +v}); }
  else if (e.id === 'xpND' && v === '__new') { const keep = $('xpNT').value, tm = $('xpNE').value; xpNewDom = true; xpDrawTray(); $('xpNT').value = keep; $('xpNE').value = tm; $('xpNDn').focus(); }
  else if (e.id === 'xmD' && v === '__new') { e.outerHTML = '<input id="xmDn" placeholder="New domain" maxlength="30">'; $('xmDn').focus(); }
  else if (e.id === 'xmD' && xpMini) { xpMini.domain = v; xpDrawCal(); }
  else if (e.id === 'xmF' && xpMini) { xpMini.effort = +v; xpDrawCal(); }
  else if (e.id === 'xpDM' && xpDoneForm) { const m = xpParse(v); if (m) xpDoneForm.min = m; xpDrawSide(); }
  else if ((e.dataset.xnote || e.dataset.xsub || e.dataset.xsubt) && (t || p)) {   // description and subtasks
    const o = t || p;
    if (e.dataset.xnote) xpSave({...o, notes: v.trim() || undefined});
    else if (e.dataset.xsub) xpSave({...o, subs: (o.subs || []).map(x => x.id === e.dataset.xsub ? {...x, done: e.checked} : x)});
    else if (v.trim()) xpSave({...o, subs: (o.subs || []).map(x => x.id === e.dataset.xsubt ? {...x, text: v.trim()} : x)});
  }
  else if ((e.dataset.xf && t) || (e.dataset.xp && p)) {   // editing a task on the calendar, or a block in the grid
    const k = e.dataset.xf || e.dataset.xp, o = t || p, put1 = patch => xpSave({...o, ...patch});
    if (k === 'title' && v.trim()) put1({title: v.trim()});
    else if (k === 'domain' && v === '__new') { e.outerHTML = `<input ${t ? 'data-xf' : 'data-xp'}="domainNew" placeholder="New domain" maxlength="30">`; document.querySelector('[data-xf="domainNew"],[data-xp="domainNew"]').focus(); }
    else if (k === 'domain') put1({domain: v});
    else if (k === 'domainNew' && v.trim()) xpSave([{...o, domain: v.trim()}, {...xpCfg(), ...xpAddDomain(v)}]);
    else if (k === 'est') { const m = xpParse(v); if (m) put1({est: m}); else flash('Time: try 45m, 1h30, 1:30 or 2h'); }
    else if (k === 'span' && +v >= 1) put1({span: Math.min(31, Math.round(+v))});
    else if (k === 'day') put1(v ? {day: v} : {day: null, start: null});
    else if (k === 'start') put1(v ? {start: hm(v), day: t.day || xpDate} : {start: null});
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
  if (mode === 'tray' || mode === 'tpl') { const t = all.find(x => x.id === id); item = {id, kind: 'task', t, title: t.title, domain: t.domain, len: t.est, effort: t.effort}; }
  else if (mode !== 'none') item = xpRaw(day).find(x => x.id === id);
  const t0 = item && item.t && item.kind === 'task' && mode !== 'tray' && mode !== 'tpl' ? item.t : null;   // a calendar task: its first day and how many days it runs
  xpDrag = {mode, id, day0: day, x0: ev.clientX, y0: ev.clientY, moved: false, item, cur: item ? {day: t0 ? t0.day : day, span: t0 ? xpSpan(t0) : 1, start: item.start, len: item.len, effort: item.effort} : {}};
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
    const grid = $('xpGrid'), gr = grid.getBoundingClientRect(), inGrid = !xpChest && ev.clientX > gr.left && ev.clientX < gr.right && ev.clientY > gr.top && ev.clientY < gr.bottom;
    const prev = g.gridAt;
    if (inGrid) { const kids = [...grid.children]; g.gridAt = kids.findIndex(k => { const r = k.getBoundingClientRect(); return ev.clientY < r.top || (ev.clientY < r.bottom && ev.clientX < r.left + r.width / 2); }); if (g.gridAt < 0) g.gridAt = kids.length - 1; }
    else g.gridAt = null;
    if (prev !== g.gridAt || g.overChest !== g.wasChest) { g.wasChest = g.overChest; xpDrawTray(); }
    if (inGrid || g.overChest) { g.over = false; xpGhost(ev, g, true); return; }
  }
  if (g.mode === 'tray') {   // a "No time yet" task over the grid or the chest: it goes back there
    const was = g.overChest; g.overChest = !!(under && under.closest('#xpChest'));
    const gr = $('xpGrid').getBoundingClientRect(); g.overGrid = !xpChest && ev.clientX > gr.left && ev.clientX < gr.right && ev.clientY > gr.top && ev.clientY < gr.bottom;
    if (was !== g.overChest) xpDrawTray();
    if (g.overGrid || g.overChest) { g.over = false; xpGhost(ev, g, false); xpDrawCal(); return; }
  }
  if (xpView === 'month') {
    if (!['tray', 'tpl'].includes(g.mode)) return;
    const cell = under && under.closest('[data-mday]'); g.overDay = cell ? cell.dataset.mday : null;
    xpGhost(ev, g, false); xpDrawMonth(cal); return;
  }
  const geo = cal._geo, box = cal.getBoundingClientRect(), r = $('xpPlane').getBoundingClientRect();
  const colAt = () => geo.days[Math.max(0, Math.min(6, Math.floor((ev.clientX - r.left - geo.gut) / geo.colW)))];
  if (['tray', 'tpl'].includes(g.mode)) {
    g.over = ev.clientX > box.left && ev.clientX < box.right && ev.clientY > box.top + geo.head && ev.clientY < box.bottom;
    g.cur = {day: colAt(), start: Math.max(0, Math.min(1440 - XP_SNAP, xpSnap((ev.clientY - r.top - geo.head - geo.pad) / geo.PX - 10))), len: g.item.len, effort: g.item.effort};
    xpGhost(ev, g, g.over);
  }
  else if (g.mode === 'move') {
    g.toTray = g.item.kind === 'task' && !!(under && under.closest('#xpTray'));
    g.cur.start = Math.max(0, Math.min(1440 - XP_SNAP, xpSnap(g.item.start + dy / geo.PX)));
    if (g.item.kind === 'task') g.cur.day = xpShift(g.item.t.day, xpGap(g.day0, colAt()));
    $('xpTray').classList.toggle('drop', g.toTray);
  }
  else if (g.mode === 'top') {   // top edge: the start moves, the end stays put
    const end = g.item.start + g.item.len, s = Math.max(0, Math.min(end - XP_SNAP, xpSnap(g.item.start + dy / geo.PX)));
    g.cur.start = s; g.cur.len = end - s;
  }
  else if (g.mode === 'left') { const lastD = xpLast(g.item.t), d = colAt() > lastD ? lastD : colAt(); g.cur.day = d; g.cur.span = xpGap(d, lastD) + 1; }
  else if (g.mode === 'right') { const d = colAt() < g.item.t.day ? g.item.t.day : colAt(); g.cur.span = xpGap(g.item.t.day, d) + 1; }
  else if (g.mode === 'len') g.cur.len = Math.max(XP_SNAP, Math.min(1440, xpSnap(g.item.len + dy / geo.PX)));
  else if (g.mode === 'z') g.cur.effort = Math.max(g.item.kind === 'busy' ? 0 : 1, Math.min(5, Math.round(g.item.effort + (dx - dy) / Math.SQRT2 / Math.max(3, xpDepth() * .6))));
  if (!['tray', 'tpl'].includes(g.mode) || g.over) { if (ev.clientY < box.top + geo.head + 30) cal.scrollTop -= 14; else if (ev.clientY > box.bottom - 30) cal.scrollTop += 14; }   // near the edge: scroll
  xpDrawCal(); xpDrawMeters();
});
function xpLooseBack(t, chest) {   // off the "No time yet" row; its block stays (or is made) in the grid or the chest
  if (!t) return renderExpro();
  const tp = all.find(x => x.id === t.tpl && x.kind === 'tasktype') || xpTplByTitle(t.title);
  if (xpSel === t.id) xpSel = null;
  const done = () => xpDelete(t.id);
  if (tp && !!tp.archived === chest) return done().then(() => flash(chest ? `"${t.title}" is in the chest` : `"${t.title}" is back in your tasks`));
  const blk = tp ? {...tp, archived: chest, order: chest ? tp.order : xpNewTpl(tp).order} : {...xpNewTpl(t), ...xpFromTpl(t), archived: chest};
  xpSave(blk, chest ? `"${t.title}" is in the chest` : `"${t.title}" is back in your tasks`).then(ok => ok && done());
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
  if (!g.moved) { xpSel = xpSel === g.id && ['tpl', 'tray'].includes(g.mode) ? null : g.id; xpDoneForm = xpNotForm = null; xpDrawSide(); xpDrawCal(); xpDrawTray(); return; }
  if (g.mode === 'tpl') {
    const p = all.find(x => x.id === g.id);
    if (g.overChest) return xpSave(xpChest ? {...p, archived: false, order: xpNewTpl(p).order} : {...p, archived: true}, xpChest ? `"${p.title}" is back in your tasks` : `"${p.title}" is in the chest`);
    if (g.gridAt != null) {   // a new order for the whole grid
      const l = xpTpls().filter(x => x.id !== g.id); l.splice(g.gridAt, 0, p);
      return xpSave(l.map((x, i) => ({...x, order: i})));
    }
    const at = xpView === 'month' ? (g.overDay ? {day: g.overDay, start: null} : null) : g.over ? {day: g.cur.day, start: g.cur.start} : null;
    if (!at) return renderExpro();
    const id = xpId('t'); xpSel = id;
    return xpSave({...xpFromTpl(p), id, kind: 'task', is_public: false, title: p.title, domain: p.domain, est: p.est, effort: p.effort, tpl: p.id, makeup: xpOwed(p)[0]?.id, ...at, created: new Date().toISOString()});
  }
  if (g.mode === 'tray') {
    if (g.overChest || g.overGrid) return xpLooseBack(all.find(x => x.id === g.id), g.overChest);
    if (xpView === 'month' && g.overDay) xpSaveTask(g.id, {day: g.overDay, start: null});
    else if (xpView !== 'month' && g.over) { xpSel = g.id; xpSaveTask(g.id, {day: g.cur.day, start: g.cur.start}); }
    else renderExpro();
    return;
  }
  if (g.item.kind === 'busy') xpSaveBusy(g.id, {start: g.cur.start, len: g.cur.len, effort: g.cur.effort});
  else if (g.mode === 'move') xpSaveTask(g.id, g.toTray ? {start: null} : {day: g.cur.day, start: g.cur.start});
  else if (g.mode === 'len') xpSaveTask(g.id, {est: g.cur.len});
  else if (g.mode === 'top') xpSaveTask(g.id, {start: g.cur.start, est: g.cur.len});
  else if (g.mode === 'left' || g.mode === 'right') xpSaveTask(g.id, {day: g.cur.day, span: g.cur.span});
  else if (g.mode === 'z') xpSaveTask(g.id, {effort: g.cur.effort});
});
window.addEventListener('resize', () => { if (page === 'expro' && xpTimed()) xpDrawCal(); });
setInterval(() => { if (page === 'expro' && !xpDrag && !xpMini && xpTimed() && xpRangeDays().includes(xpToday())) { xpDrawCal(); xpDrawMeters(); } }, 60e3);   // keep "now" moving
