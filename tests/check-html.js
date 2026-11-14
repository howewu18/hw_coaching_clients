/* Catches typos before they reach clients: every inline <script> in the app pages must be valid JavaScript,
   and the notification worker must not load anything from another website. Run: node tests/check-html.js */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..'); let bad = 0, n = 0;
for (const page of ['index.html', 'marximus.html']) {
  const html = fs.readFileSync(path.join(ROOT, page), 'utf8'), re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi; let m;
  while ((m = re.exec(html))) {
    if (/\bsrc=/.test(m[1]) || /type=["'](application\/(ld\+)?json|text\/template)/.test(m[1]) || !m[2].trim()) continue;
    const f = path.join(os.tmpdir(), 'hwcheck-' + process.pid + '-' + (n++) + (/type=["']module/.test(m[1]) ? '.mjs' : '.js'));
    fs.writeFileSync(f, m[2]);
    try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); console.log('PASS ' + page + ' script ' + n + ' (' + m[2].length + ' chars)'); }
    catch (e) { bad++; console.log('FAIL ' + page + ' script ' + n + '\n' + String(e.stderr).split('\n').slice(0, 6).join('\n')); }
    fs.unlinkSync(f);
  }
}
const sw = fs.readFileSync(path.join(ROOT, 'firebase-messaging-sw.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
if (/importScripts|https?:\/\//.test(sw)) { bad++; console.log('FAIL the notification worker loads something from another website'); } else console.log('PASS the notification worker is self-contained');
/* Each client adds their OWN link to the Home Screen. A start_url would send every client's icon to the same page. */
const man = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8'));
if ('start_url' in man) { bad++; console.log('FAIL manifest must not set start_url (it would break every client\'s Home Screen icon)'); } else console.log('PASS manifest keeps each client\'s own link');
console.log(bad ? 'FAILS: ' + bad : 'ALL PASS'); process.exit(bad ? 1 : 0);
