/* Test stand-in for Firebase Messaging. Set window.__MSG_FAIL = 'some/code' to make getToken fail. */
const M = (window.__MSG = window.__MSG || { tokens: 0, deleted: 0 });
export async function isSupported() { return true; }
export function getMessaging(app) { if (!app) throw new Error('no app'); return { app }; }
export async function getToken(m, o) {
  if (!o || !o.serviceWorkerRegistration) throw new Error('no sw reg');
  if (window.__MSG_FAIL) { const e = new Error('boom'); e.code = window.__MSG_FAIL; throw e; }
  M.tokens++; return 'tok-device-1';
}
export async function deleteToken() { M.deleted++; return true; }
export function onMessage() { return () => {}; }
