// DELIOS pop-up notifications: what the app pushes is shown even when no DELIOS
// page is open, and clicking it opens the page it is about.
self.addEventListener("push", (event) => {
  let data = { title: "DELIOS", body: "", link: "/", tag: undefined };
  try {
    data = { ...data, ...event.data.json() };
  } catch {
    if (event.data) data.body = event.data.text();
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      tag: data.tag,
      data: { link: data.link },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = new URL(event.notification.data?.link || "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const open = windows.find((one) => one.url.startsWith(self.location.origin));
      if (open) return open.navigate(link).then((page) => (page ?? open).focus());
      return self.clients.openWindow(link);
    }),
  );
});
