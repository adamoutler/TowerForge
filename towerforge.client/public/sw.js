// ============================================================
//  TowerForge — service worker: lab reminders only
//  Registered only when a player turns on "Remind me"
//  (src/components/common/labReminders.ts). It shows the notification
//  TowerForge's server pushes when a lab finishes, and opens the site
//  when it's tapped. It caches nothing and handles no page loads (no
//  fetch handler), so a deploy always shows at once.
// ============================================================

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('push', event => {
    let data = {};
    try {
        data = event.data ? event.data.json() : {};
    } catch {
        data = { body: event.data ? event.data.text() : '' };
    }
    event.waitUntil(self.registration.showNotification(data.title || 'TowerForge', {
        body: data.body || '',
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        tag: data.tag,
        data: { url: typeof data.url === 'string' && data.url.startsWith('/') ? data.url : '/' },
    }));
});

// Tapped: back to an open TowerForge tab on that page, or a new one.
self.addEventListener('notificationclick', event => {
    event.notification.close();
    const url = new URL(event.notification.data?.url || '/', self.location.origin).href;
    event.waitUntil((async () => {
        const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const tab of tabs) {
            if (new URL(tab.url).origin === self.location.origin) {
                if ('navigate' in tab) await tab.navigate(url).catch(() => {});
                return tab.focus();
            }
        }
        return self.clients.openWindow(url);
    })());
});
