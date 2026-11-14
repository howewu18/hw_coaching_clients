/* Client reminders: run by .github/workflows/reminders.yml. GitHub's free timer is asked for every 10 minutes but in
   practice fires only a few times a day at unpredictable times, so each nudge stays valid for a long stretch (below)
   and goes out on the first run that lands inside it.
   For each client with reminders.on === true and at least one device token, it can send four nudges:
     - foodMid  (optional, e.g. 12:30): nothing in the food log yet today
     - food     (default 20:00):        still nothing in the food log today
     - trainAM  (optional, e.g. 07:30): on reminders.trainDays, a heads-up that a session is planned (skipped if already logged)
     - train    (default 18:00):        on reminders.trainDays, no session logged today
   Times are in the client's own time zone (saved by their phone). Each nudge goes out at most once a day and never on
   holiday dates. A morning or midday nudge stays valid until its evening partner's time; an evening nudge stays valid
   for 5 hours; nothing is sent after 10:30pm. Logging a set counts as training even if the session button wasn't tapped.
   When several nudges are due in the same run they go out as ONE notification.
   The repo is public, so this script never prints client names, links or tokens: counts only. */
'use strict';

const BASE_URL = 'https://howewu18.github.io/hw_coaching_clients/';
const COLLECTION = 'clients_v2';
const DEFAULT_TZ = 'Australia/Brisbane';
const LATE_MAX = 300;            /* minutes a nudge stays valid when it has no later partner */
const QUIET_FROM = 22 * 60 + 30; /* nothing is sent from 10:30pm local time */
const MSG = {
  foodMid: { title: 'Food log',     body: 'Log what you’ve eaten so far today.' },
  food:    { title: 'Food log',     body: 'Nothing logged yet today.' },
  trainAM: { title: 'Training day', body: 'Session planned today.' },
  train:   { title: 'Training day', body: 'No session logged yet today.' },
  test:  { title: 'Reminders',    body: 'Test: reminders are working on this device.' }
};

function localParts(now, tz) {
  let f;
  try { f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' }); }
  catch (e) { f = new Intl.DateTimeFormat('en-GB', { timeZone: DEFAULT_TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' }); }
  const p = {}; f.formatToParts(now).forEach(x => { p[x.type] = x.value; });
  return { date: p.year + '-' + p.month + '-' + p.day, minutes: (+p.hour % 24) * 60 + (+p.minute), dow: p.weekday.slice(0, 3) };
}
function toMin(s, dflt) { const m = /^(\d{2}):(\d{2})$/.exec(s || dflt || ''); return m ? (+m[1]) * 60 + (+m[2]) : null; }
/* Last minute (exclusive) a nudge set for minute t may still be sent. partner = the later nudge of the same kind, if any. */
function validUntil(t, partner) {
  if (t >= QUIET_FROM) return Math.min(t + 60, 24 * 60);   /* a time deliberately set late still gets an hour */
  return Math.min(partner != null && partner > t ? partner : t + LATE_MAX, QUIET_FROM);
}
function inWindow(nowMin, t, partner) { return t != null && nowMin >= t && nowMin < validUntil(t, partner); }
function onHoliday(doc, date) { return (doc.holidays || []).some(h => h && h.from && h.to && date >= h.from && date <= h.to); }

/* Pure: which nudges are due for this client right now. */
function dueReminders(doc, now) {
  const r = doc.reminders || {}, push = doc.push || {}, sent = push.sent || {};
  if (r.on !== true || !(push.tokens || []).length) return { date: null, due: [] };
  const L = localParts(now, push.tz || DEFAULT_TZ), due = [];
  if (onHoliday(doc, L.date)) return { date: L.date, due };
  /* a food photo sent today counts as logged, even before the coach approves it */
  const gone = new Set((doc.photos || []).filter(x => x && x.status === 'removed').map(x => x.id));
  const photoToday = (doc.photos || []).some(x => x && !x.status && x.kind === 'food' && x.date === L.date && !gone.has(x.id));
  const noFood = !photoToday && !(doc.food || []).some(x => x && x.date === L.date);
  const noSession = !(doc.sessions || []).some(x => x && x.date === L.date) && !(doc.liftLog || []).some(x => x && x.date === L.date);
  const trainDay = Array.isArray(r.trainDays) && r.trainDays.indexOf(L.dow) >= 0;
  const foodAt = r.food === false ? null : toMin(r.food, '20:00'), trainAt = r.train === false ? null : toMin(r.train, '18:00');
  /* [kind, time setting, default time (null = off unless set), condition, later partner's time] */
  [['foodMid', r.foodMid, null, noFood, foodAt],
   ['food', r.food, '20:00', noFood, null],
   ['trainAM', r.trainAM, null, trainDay && noSession, trainAt],
   ['train', r.train, '18:00', trainDay && noSession, null]].forEach(([kind, val, dflt, cond, partner]) => {
    if (val === false || !cond || sent[kind] === L.date) return;
    if (inWindow(L.minutes, toMin(val, dflt), partner)) due.push(kind);
  });
  return { date: L.date, due };
}

const DEAD = ['messaging/registration-token-not-registered', 'messaging/invalid-registration-token', 'messaging/invalid-argument'];

/* One notification for everything due in this run. */
function messageFor(kinds) {
  if (kinds.length === 1) return MSG[kinds[0]];
  const food = kinds.some(k => k === 'food' || k === 'foodMid'), train = kinds.some(k => k === 'train' || k === 'trainAM');
  if (food && train) return { title: 'Today', body: 'Nothing in your food log yet, and no session logged.' };
  return MSG[kinds[kinds.length - 1]];
}

async function main(admin, now) {
  const mode = (process.env.MODE || 'normal').trim();
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) throw new Error('FIREBASE_SERVICE_ACCOUNT secret is missing');
  admin = admin || require('firebase-admin');
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
  const db = admin.firestore(), FieldValue = admin.firestore.FieldValue;
  now = now || new Date();
  const snap = await db.collection(COLLECTION).where('reminders.on', '==', true).get();
  const tally = { clients: snap.size, withDevices: 0, due: 0, sent: 0, failed: 0, removedTokens: 0 };

  for (const d of snap.docs) {
    const doc = d.data(), tokens = ((doc.push && doc.push.tokens) || []).filter(t => typeof t === 'string' && t);
    if (!tokens.length) continue;
    tally.withDevices++;
    const kinds = mode === 'test' ? ['test'] : dueReminders(doc, now).due;
    if (!kinds.length) continue;
    tally.due += kinds.length;
    if (mode === 'dry') continue;
    const date = localParts(now, (doc.push && doc.push.tz) || DEFAULT_TZ).date;
    const res = await admin.messaging().sendEachForMulticast({
      tokens,
      notification: messageFor(kinds),
      webpush: { notification: { icon: BASE_URL + 'icon-192.png' }, fcmOptions: { link: BASE_URL + '?c=' + encodeURIComponent(d.id) } }
    });
    const dead = [];
    res.responses.forEach((x, i) => {
      if (x.success) return;
      const code = x.error && x.error.code; console.log('send error:', code);
      if (DEAD.indexOf(code) >= 0) dead.push(tokens[i]);
    });
    tally.sent += res.successCount; tally.failed += res.failureCount;
    const u = {};
    if (dead.length) { u['push.tokens'] = FieldValue.arrayRemove(...dead); tally.removedTokens += dead.length; }
    /* mark as sent if it reached a device, or if every token was dead (nothing left to retry) */
    if (mode !== 'test' && (res.successCount > 0 || dead.length === tokens.length)) kinds.forEach(k => { u['push.sent.' + k] = date; });
    if (Object.keys(u).length) await d.ref.update(u);
  }
  console.log('mode=' + mode, JSON.stringify(tally));
}

module.exports = { localParts, dueReminders, toMin, validUntil, messageFor, main };
if (require.main === module) main().catch(err => { console.error('reminders failed:', err.code || err.message); process.exit(1); });
