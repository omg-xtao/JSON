export function registerServiceWorker() {
  if (process.env.NODE_ENV !== "production") return;
  if (!("serviceWorker" in navigator)) return;

  const onLoad = () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // ignore registration errors
    });
  };

  window.addEventListener("load", onLoad);
  return () => window.removeEventListener("load", onLoad);
}
