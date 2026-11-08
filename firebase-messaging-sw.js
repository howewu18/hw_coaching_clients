/* Background worker for client reminders. Lives next to index.html in the repo.
   It only shows the notifications sent by the reminders job. It loads nothing from other websites
   (the earlier version pulled the Firebase SDK in from another website, which browsers refused to load here),
   it does not cache anything and does not change the app. */
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });

self.addEventListener('push', function (event) {
  var p = {};
  try { p = event.data ? event.data.json() : {}; } catch (err) { try { p = { notification: { body: event.data.text() } }; } catch (e2) { p = {}; } }
  var n = p.notification || {}, d = p.data || {};
  var link = (p.fcmOptions && p.fcmOptions.link) || (n.click_action) || d.link || self.registration.scope;
  var opts = { body: n.body || d.body || '', data: { link: link } };
  var icon = n.icon || d.icon; if (icon) opts.icon = icon;
  if (n.tag || d.tag) opts.tag = n.tag || d.tag;
  event.waitUntil(self.registration.showNotification(n.title || d.title || 'Health & Wealth', opts));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var link = (event.notification.data && event.notification.data.link) || self.registration.scope;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) { if (list[i].url === link && 'focus' in list[i]) return list[i].focus(); }
    return self.clients.openWindow(link);
  }));
});
