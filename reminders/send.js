/* Client reminders: run every ~10 minutes by .github/workflows/reminders.yml.
   For each client with reminders.on === true and at least one device token, it can send four nudges:
     - foodMid  (optional, e.g. 12:30): nothing in the food log yet today
     - food     (default 20:00):        still nothing in the food log today
     - trainAM  (optional, e.g. 07:30): on reminders.trainDays, a heads-up that a session is planned (skipped if already logged)
     - train    (default 18:00):        on reminders.trainDays, no session logged today
   Times are in the client's own time zone (saved by their phone). Each nudge goes out at most once a day,
   only within 3 hours after its time, and never on holiday dates.
   The repo is public, so this script never prints client names, links or tokens: counts only. */
'use strict';

const BASE_URL = 'https://howewu18.github.io/hw_coaching_clients/';
const COLLECTION = 'clients_v2';
const DEFAULT_TZ = 'Australia/Brisbane';
const WINDOW_MIN = 180;
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
function inWindow(nowMin, t) { return t != null && nowMin >= t && nowMin < t + WINDOW_MIN; }
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
  const noSession = !(doc.sessions || []).some(x => x && x.date === L.date);
  const trainDay = Array.isArray(r.trainDays) && r.trainDays.indexOf(L.dow) >= 0;
  /* [kind, time setting, default time (null = off unless set), condition] */
  [['foodMid', r.foodMid, null, noFood],
   ['food', r.food, '20:00', noFood],
   ['trainAM', r.trainAM, null, trainDay && noSession],
   ['train', r.train, '18:00', trainDay && noSession]].forEach(([kind, val, dflt, cond]) => {
    if (val === false || !cond || sent[kind] === L.date) return;
    if (inWindow(L.minutes, toMin(val, dflt))) due.push(kind);
  });
  return { date: L.date, due };
}

const DEAD = ['messaging/registration-token-not-registered', 'messaging/invalid-registration-token', 'messaging/invalid-argument'];

async function main() {
  const mode = (process.env.MODE || 'normal').trim();
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) throw new Error('FIREBASE_SERVICE_ACCOUNT secret is missing');
  const admin = require('firebase-admin');
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
  const db = admin.firestore(), FieldValue = admin.firestore.FieldValue;
  const now = new Date();
  const snap = await db.collection(COLLECTION).where('reminders.on', '==', true).get();
  const tally = { clients: snap.size, withDevices: 0, due: 0, sent: 0, failed: 0, removedTokens: 0 };

  for (const d of snap.docs) {
    const doc = d.data(), tokens = ((doc.push && doc.push.tokens) || []).filter(t => typeof t === 'string' && t);
    if (!tokens.length) continue;
    tally.withDevices++;
    const kinds = mode === 'test' ? ['test'] : dueReminders(doc, now).due;
    const date = localParts(now, (doc.push && doc.push.tz) || DEFAULT_TZ).date;
    for (const kind of kinds) {
      tally.due++;
      if (mode === 'dry') continue;
      const res = await admin.messaging().sendEachForMulticast({
        tokens,
        notification: MSG[kind],
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
      if (kind !== 'test' && (res.successCount > 0 || dead.length === tokens.length)) u['push.sent.' + kind] = date;
      if (Object.keys(u).length) await d.ref.update(u);
    }
  }
  console.log('mode=' + mode, JSON.stringify(tally));
}

module.exports = { localParts, dueReminders, toMin };
if (require.main === module) main().catch(err => { console.error('reminders failed:', err.code || err.message); process.exit(1); });
