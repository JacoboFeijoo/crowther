const WORKSPACE_STATE_PREFIX = "crowther:workspace:v1:";

function availableStorage(storage) {
  if (storage) return storage;
  try {
    return globalThis.localStorage || globalThis.window?.localStorage || null;
  } catch {
    return null;
  }
}

function projectSceneIds(project) {
  return new Set((project?.scenes || []).map((scene) => String(scene.id)));
}

/** Devuelve la disposición de pestañas guardada, descartando escenas que ya no existen. */
export function readProjectWorkspace(project, fallbackSceneId, storage) {
  const validIds = projectSceneIds(project);
  const fallback = validIds.has(String(fallbackSceneId || ""))
    ? String(fallbackSceneId)
    : String(project?.scenes?.[0]?.id || "");
  // IndexedDB mantiene la copia principal; localStorage queda como respaldo
  // inmediato para una recarga que llegue antes de terminar una escritura.
  let saved = project?.editorWorkspace || null;
  try {
    const source = availableStorage(storage)?.getItem(`${WORKSPACE_STATE_PREFIX}${project?.id || ""}`);
    if (source) saved = JSON.parse(source);
  } catch {
    saved = null;
  }

  const openSceneIds = [...new Set((Array.isArray(saved?.openSceneIds) ? saved.openSceneIds : [])
    .map((sceneId) => String(sceneId))
    .filter((sceneId) => validIds.has(sceneId)))];
  let activeSceneId = validIds.has(String(saved?.activeSceneId || ""))
    ? String(saved.activeSceneId)
    : fallback;
  if (!openSceneIds.includes(activeSceneId)) openSceneIds.push(activeSceneId);
  if (!openSceneIds.length && fallback) openSceneIds.push(fallback);
  if (!activeSceneId) activeSceneId = openSceneIds[0] || null;
  return { openSceneIds, activeSceneId };
}

/** Guarda solo estado de interfaz pequeño, separado del proyecto y sus recursos. */
export function writeProjectWorkspace(project, openSceneIds, activeSceneId, storage) {
  if (!project?.id) return false;
  const validIds = projectSceneIds(project);
  const open = [...new Set((Array.isArray(openSceneIds) ? openSceneIds : [])
    .map((sceneId) => String(sceneId))
    .filter((sceneId) => validIds.has(sceneId)))];
  const active = validIds.has(String(activeSceneId || "")) ? String(activeSceneId) : open[0] || "";
  if (active && !open.includes(active)) open.push(active);
  project.editorWorkspace = { openSceneIds: open, activeSceneId: active };
  try {
    const target = availableStorage(storage);
    if (!target) return false;
    target.setItem(`${WORKSPACE_STATE_PREFIX}${project.id}`, JSON.stringify({ openSceneIds: open, activeSceneId: active }));
    return true;
  } catch {
    return false;
  }
}
