/* Runs every check. `node tests/run.js` = quick checks only; `node tests/run.js all` also drives the app in a browser. */
'use strict';
const { spawnSync } = require('child_process'), path = require('path');
const list = ['check-html.js', 'send.test.js', 'sw.test.js'].concat(process.argv[2] === 'all' ? ['app.test.js'] : []);
let bad = 0;
for (const f of list) { const r = spawnSync(process.execPath, [path.join(__dirname, f)], { encoding: 'utf8' }); const out = (r.stdout || '') + (r.stderr || '');
  const pass = (out.match(/^PASS /gm) || []).length, fail = (out.match(/^FAIL /gm) || []).length;
  console.log((r.status === 0 ? 'ok   ' : 'FAIL ') + f + ': ' + pass + ' passed, ' + fail + ' failed'); if (r.status !== 0) { bad++; console.log(out.split('\n').filter(l => !/^PASS /.test(l)).join('\n')); } }
process.exit(bad ? 1 : 0);
