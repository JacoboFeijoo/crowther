/*
 * Integración opcional de Crowther con el plugin WordPress.
 * No se incluye en la release: el administrador la conecta en su hosting.
 */
(() => {
  if (!/^https?:$/.test(window.location.protocol)) return;

  const now = new Date();
  const day = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join("-");
  const sessionKey = `crowther-visit-counted-${day}`;
  let canCount = true;

  try {
    if (window.sessionStorage.getItem(sessionKey)) return;
    window.sessionStorage.setItem(sessionKey, "pending");
  } catch {
    // Si el navegador bloquea sessionStorage, contamos esta carga sin guardar identificadores.
    canCount = false;
  }

  const endpointUrl = document.currentScript?.dataset.endpoint
    || new URL("/wp-json/crowther-visit-counter/v1/hit", window.location.origin).href;
  const endpoint = new URL(endpointUrl, window.location.href);
  fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Crowther-Visit": "1",
    },
    body: "{}",
    credentials: "omit",
    cache: "no-store",
    keepalive: true,
    referrerPolicy: "no-referrer",
  }).then((response) => {
    if (!response.ok && canCount) window.sessionStorage.removeItem(sessionKey);
  }).catch(() => {
    if (canCount) {
      try { window.sessionStorage.removeItem(sessionKey); } catch { /* No bloquear Crowther. */ }
    }
  });
})();
