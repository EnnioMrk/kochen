// App shell only. No recipe data is cached: offline is out of scope.
const SHELL = "rezeptor-shell-v1";
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll(["/", "/manifest.webmanifest", "/icon.svg", "/icon-192.png", "/badge-96.png"])));
  self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("kochen-")).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).pathname.startsWith("/api/")) return;
  event.respondWith(
    fetch(request).catch(() => caches.match(request).then((hit) => hit || caches.match("/"))),
  );
});
self.addEventListener("push", (event) => {
  let data = { title: "Rezeptor", body: "Neues Ereignis", url: "/" };
  try { data = { ...data, ...event.data.json() }; } catch {}
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icon-192.png",
      badge: "/badge-96.png",
      data: { url: data.url },
      tag: data.tag || undefined,
    }),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const hit = list.find((client) => new URL(client.url).pathname === new URL(url, self.location.origin).pathname);
      if (hit) return hit.focus();
      return clients.openWindow(url);
    }),
  );
});
