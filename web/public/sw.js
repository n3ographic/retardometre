// Service worker du Retardomètre : affiche les notifications de suivi de train (fonction notify) et ouvre la fiche au clic.
self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = { body: event.data && event.data.text() }; }
  event.waitUntil(self.registration.showNotification(d.title || 'Retardomètre', {
    body: d.body || '', tag: d.tag, renotify: Boolean(d.tag), icon: '/icon/192', badge: '/icon/192', data: { url: d.url || '/' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  // Même origine seulement : la notification n'ouvre jamais un autre site.
  const target = new URL(event.notification.data?.url || '/', self.location.origin);
  const url = target.origin === self.location.origin ? target.href : self.location.origin + '/';
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const open = list.find((c) => c.url === url);
    return open ? open.focus() : self.clients.openWindow(url);
  }));
});
