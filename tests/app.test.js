/* End-to-end checks of the app (index.html) in a real browser with a pretend Firebase. Nothing touches live client data.
   Needs Playwright (already installed in Claude's cloud sessions). Run: node tests/app.test.js */
'use strict';
const fs = require('fs'), http = require('http'), path = require('path');
let chromium; try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/npm-tools/node_modules/playwright')); }
const ROOT = path.join(__dirname, '..');
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const srv = http.createServer((q, s) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(ROOT, p), (e, b) => { if (e) { s.writeHead(404); s.end(); return; } s.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' }); s.end(b); }); }).listen(0);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAFElEQVR4nGP8z8Dwn4EIwDiqEAwAJBgCAfVXWiUAAAAASUVORK5CYII=', 'base64');
const PERM = `(() => { let p='default'; window.Notification={get permission(){return p;},requestPermission(){p='granted';return Promise.resolve(p);}}; window.PushManager=window.PushManager||function(){}; const reg={scope:'./'}; Object.defineProperty(navigator,'serviceWorker',{value:{register(){return Promise.resolve(reg);},ready:Promise.resolve(reg)}}); })();`;
const fails = []; const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? 'PASS ' : 'FAIL ') + m); };
const ymd = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

(async () => {
  const BASE = 'http://127.0.0.1:' + srv.address().port + '/', KEY = 'clients_v2/jordan-t3st99', TODAY = ymd(new Date());
  const b = await chromium.launch();
  async function mk(init) {
    const ctx = await b.newContext({ viewport: { width: 393, height: 852 } });
    await ctx.route(/fonts\.(googleapis|gstatic)/, r => r.abort());
    for (const n of ['app', 'firestore', 'messaging']) await ctx.route(new RegExp('gstatic\\.com/firebasejs/.*firebase-' + n + '\\.js'), r => r.fulfill({ status: 200, contentType: 'application/javascript', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(path.join(__dirname, 'fakes', 'firebase-' + n + '.js'), 'utf8') }));
    if (init) await ctx.addInitScript(init);
    const p = await ctx.newPage(); p.errs = []; p.on('pageerror', e => p.errs.push(e.message)); return { ctx, p };
  }
  const doc = p => p.evaluate(k => window.__FS.docs[k], KEY);
  const docs = p => p.evaluate(() => window.__FS.docs);
  async function create(p) { await p.goto(BASE + '?c=jordan-t3st99#coach'); await p.waitForSelector('#cp-create-in'); await p.fill('#cp-create-in', fs.readFileSync(path.join(__dirname, 'fixtures-client.json'), 'utf8')); await p.click('#cp-create'); await p.waitForTimeout(500); }
  async function update(p, o) { await p.fill('#cp-update-in', JSON.stringify(o)); await p.click('#cp-preview'); await p.waitForTimeout(150); const can = !(await p.$eval('#cp-apply', e => e.disabled)); if (can) { await p.click('#cp-apply'); await p.waitForTimeout(300); } return can; }

  // ---- 1. sales demos render ----
  let { ctx, p } = await mk();
  for (const kind of ['loss', 'gain']) { await p.goto(BASE + '?demo=' + kind); await p.waitForTimeout(500); ok(!!(await p.$('.client-name')) && (await p.$$eval('svg', e => e.length)) > 3, 'demo "' + kind + '" renders with charts'); }
  ok(p.errs.length === 0, 'demos: no JavaScript errors ' + p.errs.join(' | '));
  await ctx.close();

  // ---- 2. create a client, log food ----
  ({ ctx, p } = await mk()); await create(p);
  let d = await doc(p);
  ok(d && d.schema === 2 && d.profile.name === 'Jordan T.' && (await p.textContent('.client-name')).includes('Jordan'), 'coach panel creates the client record and the dashboard shows it');
  await p.fill('#fd-n', 'Chicken rice'); await p.fill('#fd-k', '650'); await p.fill('#fd-p', '45'); await p.press('#fd-p', 'Enter'); await p.waitForTimeout(300);
  d = await doc(p); ok(d.food.length === 1 && d.food[0].kcal === 650 && d.food[0].date === TODAY && !!d.food[0].id, 'client logs a meal');

  // ---- 3. logging a set marks the session ----
  await p.click('[data-t="training"]'); await p.waitForTimeout(250);
  ok(!!(await p.$('[data-act="logday"]')) && (d.sessions || []).length === 0, 'no session marked yet');
  await p.click('.pos-row .pos-name'); await p.waitForTimeout(250);
  await p.fill('#lw', '72.5'); await p.fill('#lr', '8'); await p.press('#lr', 'Enter'); await p.waitForTimeout(350);
  d = await doc(p);
  ok(d.liftLog.length === 1 && d.liftLog[0].lift === 'bench' && d.liftLog[0].weight === 72.5, 'top set logged (bench 72.5 × 8)');
  ok(d.sessions.length === 1 && d.sessions[0].date === TODAY && d.sessions[0].day === 'a' && d.sessions[0].auto === true, 'first set of the day marks that day’s session automatically');
  ok(!!(await p.$('[data-act="unlogday"]')), 'the session button now shows "logged today"');
  await p.fill('#lr', '7'); await p.press('#lr', 'Enter'); await p.waitForTimeout(350);
  d = await doc(p); ok(d.liftLog.length === 2 && d.sessions.length === 1, 'a second set does not add a second session');
  await p.click('[data-act="unlogday"]'); await p.waitForTimeout(300);
  d = await doc(p); ok(d.sessions.length === 0 && d.liftLog.length === 2, 'the client can still undo the session; sets stay');
  await p.click('[data-act="logday"]'); await p.waitForTimeout(300);
  d = await doc(p); ok(d.sessions.length === 1 && !d.sessions[0].auto, 'the manual session button still works');
  ok(p.errs.length === 0, 'client flow: no JavaScript errors ' + p.errs.join(' | '));
  await ctx.close();

  // ---- 4. weekly update: Preview blocks mistakes, Apply merges ----
  ({ ctx, p } = await mk()); await create(p);
  ok(!(await update(p, { add: { sessions: [{ date: TODAY, day: 'zzz' }] } })), 'weekly update: an unknown program day is blocked in Preview');
  ok(await update(p, { set: { targets: { kcal: 2000, protein: 165 } }, add: { bodyweight: [{ date: TODAY, kg: 87.9 }] } }), 'weekly update: a valid update can be applied');
  d = await doc(p); ok(d.targets.kcal === 2000 && d.bodyweight.length === 2 && d.bodyweight[1].src === 'coach', 'targets replaced, weigh-in added, existing data kept');

  // ---- 5. food photos: send, Claude drafts, Approve all ----
  await p.click('[data-t="consistency"]').catch(() => {}); await p.waitForTimeout(200);
  for (let i = 0; i < 2; i++) { await p.setInputFiles('input[data-photo="food"]', { name: 'm.png', mimeType: 'image/png', buffer: PNG }); await p.waitForSelector('#ph-note'); await p.fill('#ph-note', 'meal ' + (i + 1)); await p.click('[data-act="photosend"]'); await p.waitForTimeout(450); }
  let all = await docs(p); const pids = Object.keys(all).filter(k => k.startsWith('photos_v2/')).map(k => k.split('/')[1]);
  ok(pids.length === 2 && pids.every(id => /^jordan-t3st99_[a-z0-9]{12}$/.test(id)) && all['photos_v2/' + pids[0]].status === 'pending', 'two food photos stored as their own documents, pending');
  await p.evaluate(ids => ids.forEach((id, i) => window.__FS.remote('photos_v2/' + id, { status: 'drafted', draft: { name: 'Meal ' + (i + 1), kcal: 500 + i * 100, protein: 30, conf: 'medium', why: 'x' } })), pids);
  await p.click('[data-cpa="refresh"]'); await p.waitForTimeout(400);
  ok(/Approve all \(2\)/.test(await p.textContent('#cp-photos')), 'coach queue offers "Approve all (2)" once Claude has drafted them');
  await p.click('[data-cpa="approveall"]'); await p.waitForTimeout(500);
  d = await doc(p); all = await docs(p);
  ok(d.food.filter(f => f.src === 'photo').length === 2 && pids.every(id => all['photos_v2/' + id].status === 'approved'), 'Approve all logs both meals and marks both photos approved');
  ok(p.errs.length === 0, 'coach flow: no JavaScript errors ' + p.errs.join(' | '));
  await ctx.close();

  // ---- 6. reminders: switch on, register a device, show a real error ----
  ({ ctx, p } = await mk(PERM)); await create(p);
  ok(!(await update(p, { set: { reminders: { on: true, food: '8pm' } } })), 'reminders: a bad time ("8pm") is blocked');
  ok(await update(p, { set: { reminders: { on: true, foodMid: '12:30', food: '20:00', trainAM: '07:30', train: '20:30', trainDays: ['Mon', 'Wed', 'Fri'] } } }), 'reminders: valid settings apply');
  ok(!!(await p.$('.rem-card')), 'the client sees the Reminders card');
  await p.click('[data-act="pushon"]'); await p.waitForTimeout(700);
  d = await doc(p); ok(d.push && d.push.tokens.length === 1 && !!d.push.tz && !(await p.$('.rem-card')), 'Turn on reminders saves the device and time zone; the card goes away');
  await ctx.close();
  ({ ctx, p } = await mk(PERM + 'window.__MSG_FAIL="messaging/token-subscribe-failed";')); await create(p);
  await update(p, { set: { reminders: { on: true, food: '20:00' } } });
  await p.click('[data-act="pushon"]'); await p.waitForTimeout(700);
  d = await doc(p); ok(/Error: .*token-subscribe-failed/.test(await p.textContent('.rem-card')) && /token-subscribe-failed/.test((d.push || {}).lastError || '') && !((d.push || {}).tokens || []).length, 'a failure shows the real error on the card and saves it for remote diagnosis');
  await ctx.close();

  await b.close(); srv.close();
  console.log(fails.length ? 'FAILS: ' + fails.join(' | ') : 'ALL PASS'); process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
