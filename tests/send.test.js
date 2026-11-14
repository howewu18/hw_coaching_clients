/* Checks the reminder sender (reminders/send.js) without Firebase or the network. Run: node tests/send.test.js */
'use strict';
const S = require('../reminders/send.js');
const fails = []; const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? 'PASS ' : 'FAIL ') + m); };
/* Brisbane is UTC+10 all year, so local HH:MM on a date is easy to build. 2026-11-09 is a Monday. */
const at = (date, hhmm) => new Date(date + 'T' + hhmm + ':00+10:00');
const REM = { on: true, foodMid: '12:30', food: '20:00', trainAM: '07:30', train: '20:30', trainDays: ['Mon', 'Wed', 'Fri'] };
const base = (over) => Object.assign({ reminders: REM, push: { tokens: ['t1'], tz: 'Australia/Brisbane' }, food: [], sessions: [], liftLog: [], photos: [], holidays: [] }, over || {});
const due = (doc, d, t) => S.dueReminders(doc, at(d, t)).due.join(',');
const MON = '2026-11-09', TUE = '2026-11-10';

(async () => {
  // --- which nudges are due, and when ---
  ok(due(base(), MON, '07:29') === '', 'nothing before the first time');
  ok(due(base(), MON, '07:30') === 'trainAM', 'morning training heads-up at its time');
  ok(due(base(), MON, '12:29') === 'trainAM', 'still valid late morning (the timer is unreliable)');
  ok(due(base(), MON, '13:31') === 'foodMid,trainAM', 'a 1:31pm run catches both the midday food and morning training nudges');
  ok(due(base(), MON, '19:59') === 'foodMid,trainAM', 'morning/midday nudges stay valid until their evening partner');
  ok(due(base(), MON, '20:00') === 'food,trainAM', 'at 8pm the evening food nudge takes over from the midday one');
  ok(due(base(), MON, '20:30') === 'food,train', 'at 8:30pm the evening training nudge takes over');
  ok(due(base(), MON, '22:29') === 'food,train', 'evening nudges valid until 10:30pm');
  ok(due(base(), MON, '22:30') === '' && due(base(), MON, '23:55') === '', 'nothing is sent from 10:30pm');
  ok(due(base(), TUE, '13:00') === 'foodMid', 'non-training day: food only');
  ok(due(base({ push: { tokens: ['t1'], tz: 'Australia/Brisbane', sent: { foodMid: MON, trainAM: MON } } }), MON, '13:31') === '', 'each nudge at most once a day');
  ok(due(base({ push: { tokens: ['t1'], tz: 'Australia/Brisbane', sent: { foodMid: MON } } }), MON, '20:05') === 'food,trainAM', 'evening food nudge still goes after the midday one was sent');
  // --- conditions ---
  ok(due(base({ food: [{ date: MON, name: 'x', kcal: 1 }] }), MON, '13:31') === 'trainAM', 'food logged today: no food nudge');
  ok(due(base({ photos: [{ id: 'p1', date: MON, kind: 'food' }] }), MON, '13:31') === 'trainAM', 'a food photo sent today counts as logged');
  ok(due(base({ photos: [{ id: 'p1', date: MON, kind: 'food' }, { id: 'p1', status: 'removed' }] }), MON, '13:31') === 'foodMid,trainAM', 'a removed photo does not count');
  ok(due(base({ sessions: [{ date: MON, day: 'a' }] }), MON, '20:45') === 'food', 'session logged today: no training nudge');
  ok(due(base({ liftLog: [{ date: MON, lift: 'bench', weight: 60, reps: 8 }] }), MON, '20:45') === 'food', 'a set logged today counts as trained even without the session button');
  ok(due(base({ holidays: [{ from: '2026-11-08', to: '2026-11-10' }] }), MON, '13:31') === '', 'nothing on holiday dates');
  ok(due(base({ reminders: Object.assign({}, REM, { on: false }) }), MON, '13:31') === '', 'reminders off: nothing');
  ok(due(base({ push: { tokens: [] } }), MON, '13:31') === '', 'no device registered: nothing');
  ok(due(base({ reminders: { on: true, food: '20:00', foodMid: false, train: false, trainAM: false, trainDays: ['Mon'] } }), MON, '20:10') === 'food', 'false switches a nudge off');
  ok(due(base({ reminders: { on: true, trainDays: ['Mon'] } }), MON, '18:05') === 'train' && due(base({ reminders: { on: true } }), MON, '20:05') === 'food', 'defaults: food 8pm, training 6pm, no midday/morning');
  ok(due(base({ reminders: { on: true, foodMid: '12:30', food: false } }), MON, '17:29') === 'foodMid' && due(base({ reminders: { on: true, foodMid: '12:30', food: false } }), MON, '17:30') === '', 'midday nudge with no evening partner lasts 5 hours');
  ok(due(base({ reminders: { on: true, food: '23:00' } }), MON, '23:30') === 'food' && due(base({ reminders: { on: true, food: '23:00' } }), TUE, '00:05') === '', 'a time set after 10:30pm still gets one hour');
  // --- time zone: a Sydney client (UTC+11 in November) ---
  const syd = base({ push: { tokens: ['t1'], tz: 'Australia/Sydney' } });
  ok(S.dueReminders(syd, at(MON, '11:25')).due.join(',') === 'trainAM' && S.dueReminders(syd, at(MON, '11:30')).due.join(',') === 'foodMid,trainAM', 'times follow the client’s own time zone (Sydney is an hour ahead)');
  ok(S.localParts(at(MON, '23:30'), 'Australia/Sydney').date === TUE && S.localParts(at(MON, '23:30'), 'Not/AZone').date === MON, 'local date per zone; unknown zone falls back to Brisbane');
  // --- one combined notification ---
  ok(S.messageFor(['food']).body === 'Nothing logged yet today.' && /food log.*no session/i.test(S.messageFor(['food', 'train']).body) && S.messageFor(['foodMid', 'trainAM']).title === 'Today', 'several due nudges become one message');

  // --- the full run, with a pretend Firebase ---
  function fakeAdmin(docs, failCodes) {
    const sends = [], updates = [];
    return { sends, updates,
      initializeApp() {}, credential: { cert: x => x },
      firestore: Object.assign(() => ({ collection: () => ({ where: () => ({ get: async () => ({ size: docs.length, docs: docs.map(d => ({ id: d.id, data: () => d.data, ref: { update: async u => updates.push([d.id, u]) } })) }) }) }) }),
        { FieldValue: { arrayRemove: (...a) => ({ remove: a }) } }),
      messaging: () => ({ sendEachForMulticast: async m => { sends.push(m); const rs = m.tokens.map(t => failCodes && failCodes[t] ? { success: false, error: { code: failCodes[t] } } : { success: true }); return { responses: rs, successCount: rs.filter(r => r.success).length, failureCount: rs.filter(r => !r.success).length }; } }) };
  }
  const logs = []; const origLog = console.log; const run = async (mode, admin, t) => { process.env.MODE = mode; process.env.FIREBASE_SERVICE_ACCOUNT = '{}'; console.log = (...a) => logs.push(a.join(' ')); try { await S.main(admin, t); } finally { console.log = origLog; } return logs[logs.length - 1]; };
  const docs = () => [{ id: 'aa-111111', data: base() }, { id: 'bb-222222', data: base({ push: { tokens: [] } }) }, { id: 'cc-333333', data: base({ food: [{ date: MON }], sessions: [{ date: MON }] }) }];
  let A = fakeAdmin(docs()); let line = await run('dry', A, at(MON, '13:31'));
  ok(A.sends.length === 0 && A.updates.length === 0 && /"clients":3,"withDevices":2,"due":2,"sent":0/.test(line), 'dry mode counts but sends and writes nothing: ' + line);
  A = fakeAdmin(docs()); line = await run('normal', A, at(MON, '13:31'));
  ok(A.sends.length === 1 && A.sends[0].notification.title === 'Today' && A.sends[0].webpush.fcmOptions.link.endsWith('?c=aa-111111'), 'normal mode: ONE combined notification to the one client who is due, linking to their dashboard');
  ok(A.updates.length === 1 && A.updates[0][1]['push.sent.foodMid'] === MON && A.updates[0][1]['push.sent.trainAM'] === MON, 'both nudges marked sent for today');
  ok(!/aa-111111|t1/.test(logs.join('\n')), 'the log never prints client ids or tokens (public repo)');
  A = fakeAdmin(docs()); line = await run('test', A, at(MON, '03:00'));
  ok(A.sends.length === 2 && A.sends.every(m => /Test/.test(m.notification.body)) && A.updates.length === 0, 'test mode sends a test to every client with a device, marks nothing');
  A = fakeAdmin([{ id: 'aa-111111', data: base({ push: { tokens: ['dead', 'live'], tz: 'Australia/Brisbane' } }) }], { dead: 'messaging/registration-token-not-registered' }); line = await run('normal', A, at(MON, '20:45'));
  ok(JSON.stringify(A.updates[0][1]['push.tokens']) === '{"remove":["dead"]}' && A.updates[0][1]['push.sent.food'] === MON && /"removedTokens":1/.test(line), 'dead device addresses are removed; nudge still marked sent');
  A = fakeAdmin([{ id: 'aa-111111', data: base() }], { t1: 'messaging/internal-error' }); await run('normal', A, at(MON, '20:45'));
  ok(A.updates.length === 0, 'a temporary send failure is not marked sent, so the next run retries');
  delete process.env.FIREBASE_SERVICE_ACCOUNT; let threw = false; try { await S.main(fakeAdmin([]), at(MON, '10:00')); } catch (e) { threw = /secret is missing/.test(e.message); } ok(threw, 'a missing secret fails loudly');

  console.log(fails.length ? 'FAILS: ' + fails.join(' | ') : 'ALL PASS'); process.exit(fails.length ? 1 : 0);
})();
