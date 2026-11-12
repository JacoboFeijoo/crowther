/** Registra la caché de la aplicación solo en contextos seguros compatibles. */
export function registerCrowtherServiceWorker() {
  if (!("serviceWorker" in navigator)) return;

  const isSecureOrigin = location.protocol === "https:"
    || ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
  if (!isSecureOrigin) return;

  const workerUrl = new URL("../service-worker.js", import.meta.url);
  const scopeUrl = new URL("../", import.meta.url);
  navigator.serviceWorker.register(workerUrl, { scope: scopeUrl.pathname })
    .catch((error) => console.warn("No se pudo activar el modo sin conexión de Crowther.", error));
}
