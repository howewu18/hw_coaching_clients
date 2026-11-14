/* Test stand-in for Firestore. Documents live in window.__FS.docs and in localStorage ('__fsdocs') so they survive a reload.
   window.__FS.remote(path, fields) simulates a write from somewhere else (another phone, the scheduled Claude check). */
const FS = (window.__FS = window.__FS || { docs: {}, subs: {}, writes: 0 });
try { FS.docs = JSON.parse(localStorage.getItem('__fsdocs') || '{}'); } catch (e) { FS.docs = {}; }
const save = () => { try { localStorage.setItem('__fsdocs', JSON.stringify(FS.docs)); } catch (e) {} };
const clone = x => JSON.parse(JSON.stringify(x));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const snap = path => { const d = FS.docs[path]; return { exists: () => d !== undefined, data: () => clone(d), metadata: { fromCache: false, hasPendingWrites: false } }; };
const fire = path => (FS.subs[path] || []).forEach(cb => setTimeout(() => cb(snap(path)), 0));
function apply(path, u) {
  const d = FS.docs[path]; if (d === undefined) { const e = new Error('No document to update: ' + path); e.code = 'not-found'; throw e; }
  Object.keys(u).forEach(k => {
    const parts = k.split('.'); let o = d;
    for (let i = 0; i < parts.length - 1; i++) { if (typeof o[parts[i]] !== 'object' || o[parts[i]] === null) o[parts[i]] = {}; o = o[parts[i]]; }
    const key = parts[parts.length - 1], v = u[k];
    if (v && v.__op === 'union') { const cur = Array.isArray(o[key]) ? o[key] : []; v.items.forEach(it => { if (!cur.some(c => same(c, it))) cur.push(clone(it)); }); o[key] = cur; }
    else if (v && v.__op === 'remove') { o[key] = (Array.isArray(o[key]) ? o[key] : []).filter(c => !v.items.some(it => same(c, it))); }
    else o[key] = clone(v);
  });
}
FS.remote = (path, fields) => { FS.docs[path] = Object.assign(FS.docs[path] || {}, clone(fields)); save(); fire(path); };
export function getFirestore(app) { return { app }; }
export function initializeFirestore(app) { return { app }; }
export function persistentLocalCache(o) { return o || {}; }
export function persistentMultipleTabManager() { return {}; }
export function doc(db, col, id) { return { path: col + '/' + id }; }
export function arrayUnion(...items) { return { __op: 'union', items }; }
export function arrayRemove(...items) { return { __op: 'remove', items }; }
export async function getDoc(ref) { return snap(ref.path); }
export async function setDoc(ref, data) { FS.writes++; FS.docs[ref.path] = clone(data); save(); fire(ref.path); }
export async function updateDoc(ref, u) { FS.writes++; apply(ref.path, u); save(); fire(ref.path); }
export function onSnapshot(ref, a, b, c) {
  const cb = typeof a === 'function' ? a : b; (FS.subs[ref.path] = FS.subs[ref.path] || []).push(cb);
  setTimeout(() => cb(snap(ref.path)), 0);
  return () => { FS.subs[ref.path] = (FS.subs[ref.path] || []).filter(x => x !== cb); };
}
