/*
 * Service worker de PFlow Bots : notifications push des alertes (aucune mise en cache des pages).
 * - push : affiche TOUJOURS une notification (Safari retire l'autorisation si un push n'en affiche pas) ;
 * - toucher la notification : ouvre la conversation (/inbox?contact=…) dans l'app déjà ouverte, sinon dans une
 *   nouvelle fenêtre.
 */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = typeof data.title === "string" && data.title ? data.title : "🔔 PFlow Bots";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof data.body === "string" ? data.body : "Un client attend une réponse.",
      tag: typeof data.tag === "string" ? data.tag : undefined,
      renotify: Boolean(data.tag),
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: typeof data.url === "string" ? data.url : "/inbox" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || "/inbox", self.location.origin);
  // Jamais vers un autre site.
  const url = target.origin === self.location.origin ? target.href : new URL("/inbox", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (open) {
        await open.focus();
        // La page ouverte change de conversation (src/components/pwa.tsx) ; navigate en secours.
        open.postMessage({ type: "pflow-ouvrir", url });
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
