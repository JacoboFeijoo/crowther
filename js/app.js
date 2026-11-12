import { InteractiveFictionEditor } from "./editor.js?v=2026-11-12-12";
import { createStarterProject } from "./model.js?v=2026-11-12-05";
import { ProjectRepository } from "./storage.js?v=2026-11-12-14";
import { registerCrowtherServiceWorker } from "./pwa.js?v=2026-11-12-01";

async function startCrowther() {
  registerCrowtherServiceWorker();
  let project = null;
  let storageWarning = "";
  try {
    project = await ProjectRepository.load();
  } catch (error) {
    storageWarning = error.message || "No se pudo abrir el almacenamiento local.";
    try {
      project = ProjectRepository.loadLegacyProject();
    } catch (legacyError) {
      storageWarning = `${storageWarning} La copia anterior tampoco se pudo leer: ${legacyError.message}`;
    }
  }

  const editor = new InteractiveFictionEditor(project || createStarterProject());
  editor.init();
  if (storageWarning) editor.setSaveStatus(`Aviso de almacenamiento: ${storageWarning}`, true);

  function syncViewportHeight() {
    const viewportHeight = window.visualViewport?.height || window.innerHeight;
    document.documentElement.style.setProperty("--app-height", `${Math.round(viewportHeight)}px`);
  }

  syncViewportHeight();
  window.addEventListener("resize", syncViewportHeight, { passive: true });
  window.visualViewport?.addEventListener("resize", syncViewportHeight, { passive: true });

  // Útil para inspección manual desde las herramientas de desarrollo, sin mezclar
  // el modelo de juego con el DOM.
  window.escenaViva = editor;
}

startCrowther().catch((error) => {
  console.error("No se pudo iniciar Crowther", error);
  document.body.textContent = `No se pudo iniciar Crowther: ${error.message}`;
});
