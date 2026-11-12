import { appendInventoryAttributeInfo, InventoryState, CombinationRules } from "./inventory.js?v=2026-11-12-01";
import { PlayerCharacterState } from "./character-state.js?v=2026-11-12-01";

// Reglas compartidas para que el editor y el reproductor encajen igual el arte del mapa.
export function fitMapCellImageFrame(frame, image, naturalWidth = image?.naturalWidth, naturalHeight = image?.naturalHeight) {
  const cell = frame?.closest(".map-panel-cell");
  const bounds = cell?.getBoundingClientRect();
  const width = Number(naturalWidth);
  const height = Number(naturalHeight);
  if (!frame || !bounds?.width || !bounds?.height || !width || !height) {
    if (frame) {
      frame.style.width = "100%";
      frame.style.height = "100%";
    }
    return;
  }
  const imageRatio = width / height;
  const cellRatio = bounds.width / bounds.height;
  if (imageRatio >= cellRatio) {
    frame.style.width = "100%";
    frame.style.height = `${(cellRatio / imageRatio) * 100}%`;
  } else {
    frame.style.width = `${(imageRatio / cellRatio) * 100}%`;
    frame.style.height = "100%";
  }
}

/** Reproductor independiente usado por las dos modalidades de exportación. */
export async function runStandaloneGame() {
  const projectNode = document.getElementById("escena-viva-project");
  const game = document.getElementById("game");
  const stage = document.getElementById("stage");
  let stageBackgroundImage = document.getElementById("stage-background");
  const inventoryToggle = document.getElementById("inventory-toggle");
  const inventoryPanel = document.getElementById("inventory-panel");
  const characterToggle = document.getElementById("character-toggle");
  let characterPanel = document.getElementById("character-panel");
  let characterPanelHeading = document.getElementById("character-panel-heading");
  let characterPanelContent = document.getElementById("character-panel-content");
  let characterPanelClose = document.getElementById("character-panel-close");
  const playerWelcome = document.getElementById("player-welcome-dialog");
  const playerWelcomeStart = document.getElementById("player-welcome-start");
  const playerWelcomeDoNotShow = document.getElementById("player-welcome-do-not-show");
  const characterSetupDialog = document.getElementById("character-setup-dialog");
  const characterSetupForm = document.getElementById("character-setup-form");
  const playerCharacterName = document.getElementById("player-character-name");
  const characterSetupPoints = document.getElementById("character-setup-points");
  const characterSetupAttributes = document.getElementById("character-setup-attributes");
  const hintOverlay = document.getElementById("hint-overlay");
  const hintOverlayContent = document.getElementById("hint-overlay-content");
  const hintOverlayClose = document.getElementById("hint-overlay-close");
  let pencilToggle = document.getElementById("pencil-toggle");
  let pencilPanel = document.getElementById("pencil-panel");
  let mapToggle = document.getElementById("map-toggle");
  let mapPanel = document.getElementById("map-panel");
let mapNoteOverlay = null;
let mapNoteHeading = null;
let mapNoteCoordinate = null;
let mapNoteText = null;
let activeMapCellNoteKey = null;
let hintOverlayReturnFocus = null;
  const hintOverlayHeading = document.getElementById("hint-overlay-heading");
  let mapCellArtResizeObserver = null;
  let videoPlaybackPanel = document.getElementById("video-playback-panel");
  let videoPlaybackElement = document.getElementById("video-playback-element");
  let videoPlaybackTitle = document.getElementById("video-playback-title");
  let videoPlaybackClose = document.getElementById("video-playback-close");
  let pencilMessage = document.getElementById("pencil-message");
  let inventoryItems = document.getElementById("inventory-items");
  let pencilClues = document.getElementById("pencil-panel-hints");
  let pencilNotesToolbar = document.getElementById("pencil-panel-notes-toolbar");
  let pencilNotesEditor = document.getElementById("pencil-panel-notes-editor");
  let inventoryPanelSummary = document.getElementById("inventory-panel-summary");
  let inventoryMessage = document.getElementById("inventory-message");
  const canvasColumnsElement = document.getElementById("canvas-columns");
  const layersElement = document.getElementById("layers");
  const dialoguesElement = document.getElementById("dialogues");
  const choicesElement = document.getElementById("choices");
  const statusElement = document.getElementById("status");
  const customStyle = document.getElementById("project-style");

  if (!game || !stage || !layersElement || !dialoguesElement || !choicesElement || !statusElement || !customStyle) {
    return;
  }
  if (!stageBackgroundImage) {
    stageBackgroundImage = document.createElement("img");
    stageBackgroundImage.id = "stage-background";
    stageBackgroundImage.className = "stage-background";
    stageBackgroundImage.alt = "";
    stageBackgroundImage.setAttribute("aria-hidden", "true");
    stageBackgroundImage.hidden = true;
    stage.prepend(stageBackgroundImage);
  }

  let project;
  try {
    if (projectNode) {
      project = JSON.parse(projectNode.textContent || "{}");
    } else {
      const response = await fetch(new URL("./data/project.json", document.baseURI));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      project = await response.json();
    }
  } catch (error) {
    statusElement.textContent = projectNode
      ? "El juego exportado contiene datos inválidos."
      : "No se pudieron cargar los datos del juego. Comprueba que el paquete esté completo y publicado junto.";
    statusElement.dataset.error = "true";
    return;
  }

  const scenes = Array.isArray(project.scenes) ? project.scenes : [];
  const sceneById = new Map(scenes.map((scene) => [scene.id, scene]));
  const sceneByModuleNumber = new Map(scenes
    .filter((scene) => Number.isSafeInteger(Number(scene.moduleNumber)) && Number(scene.moduleNumber) > 0)
    .map((scene) => [Number(scene.moduleNumber), scene]));
  const assets = Array.isArray(project.assets) ? project.assets : [];
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
const soundAssets = Array.isArray(project.soundAssets) ? project.soundAssets : [];
const soundAssetById = new Map(soundAssets.map((asset) => [asset.id, asset]));
const videoAssets = Array.isArray(project.videoAssets) ? project.videoAssets : [];
const videoAssetById = new Map(videoAssets.map((asset) => [asset.id, asset]));
  function mapCellKey(cell) {
    return `${Number(cell?.row) || 0}:${Number(cell?.column) || 0}`;
  }
const runtime = {
  timers: [],
  audioElements: [],
  generation: 0,
  sceneId: null,
  state: null,
  inventory: new InventoryState(),
  character: new PlayerCharacterState({}),
  completedCombatIds: new Set(),
  pendingCombination: null,
  pendingQuizId: null,
  completedQuizIds: new Set(),
  quizFailureCounts: new Map(),
  unlockedQuizSceneIds: new Set(),
  unlockedQuizVideoIds: new Set(),
  videoPlaybackTimeout: null,
    unlockedMapCells: new Set((project.adventureMap?.cells || [])
      .filter((cell) => cell.initiallyUnlocked)
      .map(mapCellKey)),
    mapCellImages: new Map(),
mapCellNotes: new Map(),
};
let pencilNotesQuill = null;
runtime.character = new PlayerCharacterState(project.characterSheet || {});

  if (!inventoryMessage && inventoryPanel) {
    inventoryMessage = document.createElement("p");
    inventoryMessage.id = "inventory-message";
    inventoryMessage.className = "inventory-message";
    inventoryMessage.setAttribute("role", "status");
    inventoryMessage.setAttribute("aria-live", "polite");
    inventoryPanel.insertBefore(inventoryMessage, inventoryItems);
  }
  ensurePencilPanelSections();
  ensureMapPanel();
ensureMapCellNoteEditor();
  ensureVideoPanel();
  inventoryItems = document.getElementById("inventory-items");
  pencilToggle = document.getElementById("pencil-toggle");
  pencilPanel = document.getElementById("pencil-panel");
  mapToggle = document.getElementById("map-toggle");
  mapPanel = document.getElementById("map-panel");
mapNoteOverlay = mapPanel?.querySelector("#map-note-overlay") || null;
mapNoteHeading = mapNoteOverlay?.querySelector("#map-note-heading") || null;
mapNoteCoordinate = mapNoteOverlay?.querySelector("#map-note-coordinate") || null;
mapNoteText = mapNoteOverlay?.querySelector("#map-note-text") || null;
  videoPlaybackPanel = document.getElementById("video-playback-panel");
  videoPlaybackElement = document.getElementById("video-playback-element");
  videoPlaybackTitle = document.getElementById("video-playback-title");
  videoPlaybackClose = document.getElementById("video-playback-close");
  pencilMessage = document.getElementById("pencil-message");
  pencilClues = document.getElementById("pencil-panel-hints");
  pencilNotesToolbar = document.getElementById("pencil-panel-notes-toolbar");
  pencilNotesEditor = document.getElementById("pencil-panel-notes-editor");
  initializePencilNotesEditor();

  inventoryPanel?.querySelector("#inventory-panel-close")?.addEventListener("click", () => inventoryToggle?.click());
  pencilPanel?.querySelector("#pencil-panel-close")?.addEventListener("click", () => pencilToggle?.click());

  hintOverlayClose?.addEventListener("click", () => {
    closeHintOverlay();
  });
  hintOverlay?.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    closeHintOverlay();
  });

  inventoryToggle?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
const open = Boolean(inventoryPanel?.hidden);
if (open) renderInventoryGrid();
    if (inventoryPanel) {
      inventoryPanel.hidden = !open;
      inventoryPanel.setAttribute("aria-hidden", String(!open));
    }
    inventoryToggle.setAttribute("aria-expanded", String(open));
    inventoryToggle.setAttribute("aria-label", open ? "Cerrar inventario" : "Abrir inventario");
    inventoryToggle.title = open ? "Cerrar inventario" : "Abrir inventario";
    const detail = { projectId: project.id || null, sceneId: runtime.sceneId, open };
    inventoryToggle.dispatchEvent(new CustomEvent("escena-viva:inventory-toggle", { bubbles: true, detail }));
    inventoryToggle.dispatchEvent(new CustomEvent(open ? "escena-viva:inventory-open" : "escena-viva:inventory-close", { bubbles: true, detail }));
    setStatus(open ? "Inventario abierto." : "Inventario cerrado.");
  });
  characterToggle?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const open = Boolean(characterPanel?.hidden);
    if (open) {
      [inventoryPanel, pencilPanel, mapPanel].forEach((panel) => {
        if (panel) { panel.hidden = true; panel.setAttribute("aria-hidden", "true"); }
      });
      [inventoryToggle, pencilToggle, mapToggle].forEach((button) => button?.setAttribute("aria-expanded", "false"));
      renderPlayerCharacterPanel();
    }
    if (characterPanel) {
      characterPanel.hidden = !open;
      characterPanel.setAttribute("aria-hidden", String(!open));
    }
    characterToggle.setAttribute("aria-expanded", String(open));
    characterToggle.setAttribute("aria-label", open ? "Cerrar personaje" : "Ver personaje");
    characterToggle.title = open ? "Cerrar personaje" : "Ver personaje";
  });
  characterPanelClose?.addEventListener("click", () => characterToggle?.click());
  pencilToggle?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const open = Boolean(pencilPanel?.hidden);
    if (open) renderPencilClues();
    if (pencilPanel) {
      pencilPanel.hidden = !open;
      pencilPanel.setAttribute("aria-hidden", String(!open));
    }
    pencilToggle.setAttribute("aria-expanded", String(open));
    pencilToggle.setAttribute("aria-label", open ? "Cerrar pistas y notas" : "Abrir pistas y notas");
    pencilToggle.title = open ? "Cerrar pistas y notas" : "Abrir pistas y notas";
    const detail = { projectId: project.id || null, sceneId: runtime.sceneId, open };
    pencilToggle.dispatchEvent(new CustomEvent("escena-viva:pencil-toggle", { bubbles: true, detail }));
    setStatus(open ? "Pistas y notas abiertas." : "Pistas y notas cerradas.");
  });
  mapToggle?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const open = Boolean(mapPanel?.hidden);
    if (open) renderAdventureMap();
    if (mapPanel) {
      mapPanel.hidden = !open;
      mapPanel.setAttribute("aria-hidden", String(!open));
    }
    mapToggle.setAttribute("aria-expanded", String(open));
    mapToggle.setAttribute("aria-label", open ? "Cerrar mapa" : "Abrir mapa");
    mapToggle.title = open ? "Cerrar mapa" : "Abrir mapa";
    closeVideoPlayback();
    const detail = { projectId: project.id || null, sceneId: runtime.sceneId, open };
    mapToggle.dispatchEvent(new CustomEvent("escena-viva:map-toggle", { bubbles: true, detail }));
  });
  mapPanel?.querySelector("#map-panel-close")?.addEventListener("click", () => mapToggle?.click());
  mapPanel?.querySelector("#map-panel-grid")?.addEventListener("click", (event) => {
const noteAction = event.target.closest("[data-map-note-action]");
if (noteAction) {
event.preventDefault();
event.stopPropagation();
const key = noteAction.closest("[data-map-cell-key]")?.dataset.mapCellKey;
if (!key) return;
if (noteAction.dataset.mapNoteAction === "delete") {
runtime.mapCellNotes.delete(key);
renderAdventureMap();
setStatus(`Nota eliminada de la casilla ${key.replace(":", ", ")}.`);
} else {
openMapCellNoteEditor(key);
}
return;
}
    const destination = event.target.closest("[data-map-target-scene]");
    if (!destination || destination.disabled) return;
    event.preventDefault();
    startScene(destination.dataset.mapTargetScene);
  });
mapNoteOverlay?.addEventListener("click", (event) => {
const action = event.target.closest("[data-map-note-editor-action]")?.dataset.mapNoteEditorAction;
if (!action) return;
event.preventDefault();
if (action === "save") saveMapCellNote();
else closeMapCellNoteEditor();
});
mapNoteOverlay?.addEventListener("keydown", (event) => {
if (event.key === "Escape") {
event.preventDefault();
closeMapCellNoteEditor();
} else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
event.preventDefault();
saveMapCellNote();
}
});
  videoPlaybackClose?.addEventListener("click", closeVideoPlayback);

  function setStatus(message, isError = false) {
    statusElement.textContent = message || "";
    statusElement.dataset.error = String(Boolean(isError));
  }

function renderInventoryGrid() {
  if (!inventoryItems) return;
  const presets = new Set(["3x2", "4x2", "5x2", "5x3", "6x3", "7x3", "8x3", "8x4", "10x4"]);
  const stored = project.inventoryGrid || {};
  const candidate = `${Number(stored.columns)}x${Number(stored.rows)}`;
  const [columns, rows] = (presets.has(candidate) ? candidate : "5x3").split("x").map(Number);
  const total = columns * rows;
  inventoryItems.setAttribute("role", "grid");
  inventoryItems.style.setProperty("--inventory-columns", String(columns));
  inventoryItems.setAttribute("aria-label", `Cuadrícula del inventario: ${columns} columnas por ${rows} filas, ${total} espacios`);
  if (!inventoryPanelSummary && inventoryPanel) {
    inventoryPanelSummary = document.createElement("p");
    inventoryPanelSummary.id = "inventory-panel-summary";
    inventoryPanelSummary.className = "inventory-panel-summary";
    inventoryPanel.querySelector(".inventory-panel-header")?.append(inventoryPanelSummary);
  }
  if (inventoryPanelSummary) inventoryPanelSummary.textContent = `${total} espacios · ${columns} × ${rows}`;

  const slots = document.createDocumentFragment();
  for (let index = 1; index <= total; index += 1) {
    const slot = document.createElement("div");
    slot.className = "inventory-grid-slot";
    const item = runtime.inventory.items[index - 1];
    const asset = item ? CombinationRules.resource(project, item.assetId) : null;
    const assetType = item ? CombinationRules.resourceType(project, item.assetId) : null;
    slot.setAttribute("role", "gridcell");
    slot.setAttribute("aria-label", item
      ? `Espacio ${index} de ${total}: ${asset?.name || "Objeto"}, cantidad ${item.quantity}`
      : `Espacio ${index} de ${total}, vacío`);
    if (item) {
      slot.classList.add("has-item");
      slot.dataset.inventoryAssetId = item.assetId;
      if (assetType === "sound") {
        const soundIcon = document.createElement("div");
        soundIcon.className = "inventory-item-sound";
        soundIcon.setAttribute("aria-label", `Sonido MP3: ${asset?.name || "sin nombre"}`);
        const note = document.createElement("span");
        note.textContent = "♫";
        const type = document.createElement("small");
        type.textContent = "MP3";
        soundIcon.append(note, type);
        slot.append(soundIcon);
      } else {
        const image = document.createElement("img");
        image.className = "inventory-item-image";
        image.src = asset?.dataUrl || "";
        image.alt = asset?.alt || asset?.name || "Objeto del inventario";
        slot.append(image);
      }
      if (runtime.pendingCombination) slot.classList.add("is-combination-target");
      if (runtime.pendingQuizId) slot.classList.add("is-quiz-target");

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "inventory-item-remove";
      remove.textContent = "×";
      remove.setAttribute("aria-label", `Retirar ${asset?.name || "objeto"} del inventario`);
      remove.title = "Retirar del inventario";
      remove.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        runtime.inventory.remove(item.assetId);
        if (runtime.pendingCombination?.kind === "inventory" && runtime.pendingCombination.sourceAssetId === item.assetId) {
          cancelPendingCombination();
        }
        showInventoryMessage(`${asset?.name || "Objeto"} retirado del inventario.`, false);
        renderInventoryGrid();
      });
      slot.append(remove);
      if (assetType === "image") appendInventoryAttributeInfo(slot, asset, project, runtime.inventory.attributeBonuses.get(item.assetId));

      const controls = document.createElement("div");
      controls.className = "inventory-item-controls";
      const quantity = document.createElement("span");
      quantity.className = "inventory-item-quantity";
      quantity.textContent = String(item.quantity);
      quantity.setAttribute("aria-label", `Cantidad: ${item.quantity}`);
      controls.append(quantity);
      if (CombinationRules.canStart(project, item.assetId)) {
        const combine = document.createElement("button");
        combine.type = "button";
        combine.className = "inventory-item-add";
        combine.textContent = "+";
        combine.setAttribute("aria-label", `Combinar ${asset?.name || "objeto"} con otro recurso`);
        combine.title = "Combinar con otro objeto";
        combine.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          beginInventoryCombination(item.assetId);
        });
        controls.append(combine);
      }
      slot.append(controls);
    }
    slots.append(slot);
  }
  inventoryItems.replaceChildren(slots);
  renderPencilClues();
}

function ensurePencilPanelSections() {
  if (!stage) return;
  if (!pencilToggle) {
    pencilToggle = document.createElement("button");
    pencilToggle.id = "pencil-toggle";
    pencilToggle.className = "pencil-toggle";
    pencilToggle.type = "button";
    pencilToggle.setAttribute("aria-label", "Abrir pistas y notas");
    pencilToggle.title = "Abrir pistas y notas";
    pencilToggle.setAttribute("aria-controls", "pencil-panel");
    pencilToggle.setAttribute("aria-expanded", "false");
    pencilToggle.innerHTML = '<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="14"/><path d="m10 21 1.2-4.2L20.8 7.2a2 2 0 0 1 2.8 2.8l-9.6 9.6L10 21Z"/><path d="m18.8 9.2 4 4M10 21l4.2-1.2"/></svg>';
    stage.append(pencilToggle);
  }
  if (!pencilPanel) {
    pencilPanel = document.createElement("section");
    pencilPanel.id = "pencil-panel";
    pencilPanel.className = "pencil-panel";
    pencilPanel.setAttribute("aria-label", "Pistas y notas");
    pencilPanel.setAttribute("aria-hidden", "true");
    pencilPanel.hidden = true;
    stage.append(pencilPanel);
  }
  if (!pencilPanel.querySelector(".inventory-panel-header")) {
    const header = document.createElement("header");
    header.className = "inventory-panel-header";
    const title = document.createElement("h2");
    title.textContent = "Pistas y notas";
    pencilMessage = document.createElement("p");
    pencilMessage.id = "pencil-message";
    pencilMessage.className = "inventory-message";
    pencilMessage.setAttribute("role", "status");
    pencilMessage.setAttribute("aria-live", "polite");
    pencilMessage.hidden = true;
    header.append(title, pencilMessage);
    pencilPanel.append(header);
  } else {
    pencilMessage = document.getElementById("pencil-message");
  }
  const pencilHeader = pencilPanel.querySelector(".inventory-panel-header");
  pencilHeader?.classList.add("has-close");
  if (pencilHeader && !pencilHeader.querySelector("#pencil-panel-close")) {
    const close = document.createElement("button");
    close.id = "pencil-panel-close";
    close.className = "icon-button hint-text-remove panel-close-button";
    close.type = "button";
    close.textContent = "×";
    close.setAttribute("aria-label", "Cerrar pistas y notas");
    close.title = "Cerrar pistas y notas";
    pencilHeader.append(close);
  }
  if (!document.getElementById("pencil-panel-hints")) {
    const section = document.createElement("section");
    section.className = "inventory-panel-section";
    section.setAttribute("aria-labelledby", "pencil-panel-clues-heading");
    const heading = document.createElement("h3");
    heading.id = "pencil-panel-clues-heading";
    heading.textContent = "Pistas";
    const board = document.createElement("div");
    board.id = "pencil-panel-hints";
    board.className = "inventory-hints-board";
    board.setAttribute("aria-label", "Pistas encontradas");
    section.append(heading, board);
    pencilPanel.append(section);
  }
  if (!document.getElementById("pencil-panel-notes-editor")) {
    const section = document.createElement("section");
    section.className = "inventory-panel-section inventory-panel-notes";
    section.setAttribute("aria-labelledby", "pencil-panel-notes-heading");
    const heading = document.createElement("h3");
    heading.id = "pencil-panel-notes-heading";
    heading.textContent = "Notas";
    const field = document.createElement("div");
    field.className = "rich-text-field inventory-notes-field";
    const toolbar = document.createElement("div");
    toolbar.id = "pencil-panel-notes-toolbar";
    toolbar.className = "rich-toolbar ql-toolbar ql-snow";
    toolbar.setAttribute("aria-label", "Formato de las notas del jugador");
    const formats = document.createElement("span");
    formats.className = "ql-formats";
    [["ql-bold", "", "Negrita"], ["ql-italic", "", "Cursiva"], ["ql-list", "bullet", "Lista con viñetas"], ["ql-link", "", "Enlace"]].forEach(([className, value, label]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = className;
      if (value) button.value = value;
      button.setAttribute("aria-label", label);
      formats.append(button);
    });
    toolbar.append(formats);
    const editor = document.createElement("div");
    editor.id = "pencil-panel-notes-editor";
    editor.className = "inventory-notes-editor";
    editor.setAttribute("aria-label", "Notas libres del jugador");
    field.append(toolbar, editor);
    section.append(heading, field);
    pencilPanel.append(section);
  }
}

function ensureMapPanel() {
  if (!stage) return;
  if (!mapToggle) {
    mapToggle = document.createElement("button");
    mapToggle.id = "map-toggle";
    mapToggle.className = "map-toggle";
    mapToggle.type = "button";
    mapToggle.setAttribute("aria-label", "Abrir mapa");
    mapToggle.title = "Abrir mapa";
    mapToggle.setAttribute("aria-controls", "map-panel");
    mapToggle.setAttribute("aria-expanded", "false");
    mapToggle.innerHTML = '<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="14"/><ellipse cx="16" cy="16" rx="6.3" ry="14"/><path d="M2.5 12h27M2.5 20h27"/></svg>';
    stage.append(mapToggle);
  }
  if (!mapPanel) {
    mapPanel = document.createElement("section");
    mapPanel.id = "map-panel";
    mapPanel.className = "map-panel";
    mapPanel.setAttribute("aria-label", "Mapa");
    mapPanel.setAttribute("aria-hidden", "true");
    mapPanel.hidden = true;
    mapPanel.innerHTML = '<header class="inventory-panel-header map-panel-header"><h2>Mapa</h2><button id="map-panel-close" class="icon-button hint-text-remove" type="button" aria-label="Cerrar mapa" title="Cerrar mapa">×</button></header><div id="map-panel-artwork" class="map-panel-artwork" hidden><img id="map-panel-image" class="map-panel-image" alt="Mapa de la aventura"><div id="map-panel-grid" class="map-panel-grid" aria-label="Destinos disponibles en el mapa"></div></div><p id="map-panel-message" class="map-panel-placeholder" role="status" aria-live="polite">El diseñador aún no ha asignado una imagen al mapa.</p>';
    stage.append(mapPanel);
  }
}

function ensureMapCellNoteEditor() {
  if (!mapPanel) return;
  let overlay = mapPanel.querySelector("#map-note-overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "map-note-overlay";
    overlay.className = "map-note-overlay";
    overlay.hidden = true;
    overlay.setAttribute("aria-hidden", "true");
    overlay.innerHTML = '<section class="map-note-dialog" role="dialog" aria-modal="true" aria-labelledby="map-note-heading"><h3 id="map-note-heading">Nota de la casilla</h3><p id="map-note-coordinate" class="map-note-coordinate"></p><textarea id="map-note-text" class="map-note-text" aria-label="Nota de esta casilla del mapa" placeholder="Escribe una nota para esta casilla del mapa…"></textarea><div class="map-note-editor-actions"><button class="map-note-cancel" type="button" data-map-note-editor-action="cancel">Cancelar</button><button class="map-note-save" type="button" data-map-note-editor-action="save">Guardar</button></div></section>';
    mapPanel.append(overlay);
  }
  mapNoteOverlay = overlay;
  mapNoteHeading = overlay.querySelector("#map-note-heading");
  mapNoteCoordinate = overlay.querySelector("#map-note-coordinate");
  mapNoteText = overlay.querySelector("#map-note-text");
}

function openMapCellNoteEditor(key) {
  if (!mapNoteOverlay || !mapNoteText) return;
  const [row, column] = key.split(":").map(Number);
  activeMapCellNoteKey = key;
  mapNoteHeading.textContent = `Nota de la casilla ${row}, ${column}`;
  mapNoteCoordinate.textContent = `Casilla ${row}, columna ${column}`;
  mapNoteText.value = runtime.mapCellNotes.get(key) || "";
  mapNoteOverlay.hidden = false;
  mapNoteOverlay.setAttribute("aria-hidden", "false");
  mapNoteText.focus();
}

function closeMapCellNoteEditor() {
  if (!mapNoteOverlay) return;
  mapNoteOverlay.hidden = true;
  mapNoteOverlay.setAttribute("aria-hidden", "true");
  activeMapCellNoteKey = null;
}

function saveMapCellNote() {
  const key = activeMapCellNoteKey;
  if (!key || !mapNoteText) return;
  const [row, column] = key.split(":").map(Number);
  const note = mapNoteText.value;
  if (note.trim()) runtime.mapCellNotes.set(key, note);
  else runtime.mapCellNotes.delete(key);
  closeMapCellNoteEditor();
  renderAdventureMap();
  setStatus(note.trim()
    ? `Nota guardada en la casilla ${row}, ${column}.`
    : `Nota eliminada de la casilla ${row}, ${column}.`);
}

function createMapCellNoteActionButton(action, row, column, icon, label) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `map-cell-note-action is-${action}`;
  button.dataset.mapNoteAction = action;
  button.setAttribute("aria-label", `${label} en la casilla ${row}, ${column}`);
  button.title = `${label} · ${row}, ${column}`;
  button.textContent = icon;
  return button;
}

function renderAdventureMap() {
  const artwork = mapPanel?.querySelector("#map-panel-artwork");
  const image = mapPanel?.querySelector("#map-panel-image");
  const board = mapPanel?.querySelector("#map-panel-grid");
  const message = mapPanel?.querySelector("#map-panel-message");
  if (!artwork || !image || !board || !message) return;
  const map = project.adventureMap || {};
  const mapAsset = assetById.get(map.imageAssetId);
  const hasDiscoveredImages = [...runtime.mapCellImages.values()].some((assetId) => assetById.get(assetId)?.dataUrl);
  // No estirar por todo el panel una imagen que ya se está mostrando como ficha de una casilla.
  const hasMapArtwork = Boolean(mapAsset?.dataUrl && ![...runtime.mapCellImages.values()].includes(mapAsset.id));
  if (hasMapArtwork) {
    if (image.getAttribute("src") !== mapAsset.dataUrl) image.src = mapAsset.dataUrl;
    image.alt = mapAsset.alt || mapAsset.name || "Mapa de la aventura";
    const naturalWidth = Number(mapAsset.naturalWidth) || image.naturalWidth;
    const naturalHeight = Number(mapAsset.naturalHeight) || image.naturalHeight;
    if (naturalWidth > 0 && naturalHeight > 0) artwork.style.aspectRatio = `${naturalWidth} / ${naturalHeight}`;
    image.hidden = false;
  } else {
    image.removeAttribute("src");
    image.alt = "";
    image.hidden = true;
    artwork.style.aspectRatio = "1 / 1";
  }
  const hasMapContent = hasMapArtwork || hasDiscoveredImages;
  artwork.hidden = !hasMapContent;
  message.hidden = hasMapContent;
  if (!hasMapContent) {
    message.textContent = assets.length
      ? "El diseñador aún no ha asignado una imagen al mapa ni se ha descubierto una casilla."
      : "El mapa todavía no tiene una imagen gráfica ni casillas descubiertas.";
  }
  const size = Math.min(10, Math.max(2, Number(map.size) || 5));
  const maxSize = 10;
  board.style.setProperty("--map-grid-size", String(size));
  let availableCount = 0;
  const buttons = document.createDocumentFragment();
  for (let row = 1; row <= size; row += 1) {
    for (let column = 1; column <= size; column += 1) {
      const cell = (map.cells || []).find((candidate) => Number(candidate.row) === row && Number(candidate.column) === column)
        || map.cells?.[(row - 1) * maxSize + column - 1]
        || {};
      const moduleNumber = Number(cell.moduleNumber);
      const destinationScene = Number.isSafeInteger(moduleNumber) ? sceneByModuleNumber.get(moduleNumber) : null;
      const key = mapCellKey(cell);
      const unlocked = Boolean(cell.initiallyUnlocked || runtime.unlockedMapCells.has(key));
const cellElement = document.createElement("div");
cellElement.className = "map-panel-cell";
cellElement.dataset.mapCellKey = key;
const button = document.createElement("button");
button.type = "button";
button.className = "map-panel-cell-destination";
button.disabled = !unlocked || !destinationScene;
button.setAttribute("aria-label", destinationScene
        ? `Fila ${row}, columna ${column}: ${destinationScene.name}, escena ${moduleNumber}${unlocked ? ", disponible" : ", sin descubrir"}`
        : `Fila ${row}, columna ${column}: destino no asignado`);
      if (destinationScene) button.title = `${destinationScene.name} · escena ${moduleNumber}`;
      const cellImage = assetById.get(runtime.mapCellImages.get(key));
      let artFrame = null;
      if (cellImage?.dataUrl) {
        artFrame = document.createElement("div");
        artFrame.className = "map-panel-cell-art";
        const thumbnail = document.createElement("img");
        thumbnail.className = "map-panel-cell-image";
        thumbnail.addEventListener("load", () => fitMapCellImageFrame(artFrame, thumbnail), { once: true });
        thumbnail.src = cellImage.dataUrl;
        thumbnail.alt = cellImage.alt || cellImage.name || `Imagen de la casilla ${row}, ${column}`;
        thumbnail.draggable = false;
        artFrame.append(thumbnail);
      }
cellElement.append(button);
if (cellImage?.dataUrl && artFrame) {
const noteActions = document.createElement("div");
noteActions.className = "map-panel-note-actions";
noteActions.setAttribute("aria-label", `Notas de la casilla ${row}, ${column}`);
noteActions.append(createMapCellNoteActionButton("add", row, column, "+", "Añadir nota"));
if (runtime.mapCellNotes.has(key)) {
noteActions.append(
createMapCellNoteActionButton("edit", row, column, "✎", "Editar nota"),
createMapCellNoteActionButton("delete", row, column, "×", "Eliminar nota"),
);
}
artFrame.append(noteActions);
}
if (artFrame) cellElement.append(artFrame);
      if (destinationScene && unlocked) {
        button.dataset.mapTargetScene = destinationScene.id;
        availableCount += 1;
      }
buttons.append(cellElement);
    }
  }
  board.replaceChildren(buttons);
  board.querySelectorAll(".map-panel-cell-art").forEach((frame) => {
    const thumbnail = frame.querySelector(".map-panel-cell-image");
    const key = frame.closest(".map-panel-cell")?.dataset.mapCellKey;
    const asset = assetById.get(runtime.mapCellImages.get(key));
    fitMapCellImageFrame(frame, thumbnail, asset?.naturalWidth, asset?.naturalHeight);
  });
  if (typeof ResizeObserver === "function") {
    mapCellArtResizeObserver ||= new ResizeObserver((entries) => {
      entries.forEach(({ target }) => {
        const frame = target.querySelector(".map-panel-cell-art");
        const thumbnail = frame?.querySelector(".map-panel-cell-image");
        if (frame && thumbnail) fitMapCellImageFrame(frame, thumbnail);
      });
    });
    mapCellArtResizeObserver.disconnect();
    board.querySelectorAll(".map-panel-cell").forEach((cell) => {
      if (cell.querySelector(".map-panel-cell-art")) mapCellArtResizeObserver.observe(cell);
    });
  }
  if (!availableCount && hasMapContent) {
    message.hidden = false;
    message.textContent = "Aún no hay destinos disponibles. Descubre una casilla o marca destinos iniciales en el editor.";
  }
}

function ensureVideoPanel() {
  if (!stage) return;
  if (!videoPlaybackPanel) {
    videoPlaybackPanel = document.createElement("section");
    videoPlaybackPanel.id = "video-playback-panel";
    videoPlaybackPanel.className = "map-panel video-playback-panel";
    videoPlaybackPanel.setAttribute("aria-label", "Reproductor de vídeo");
    videoPlaybackPanel.setAttribute("aria-hidden", "true");
    videoPlaybackPanel.hidden = true;
    const header = document.createElement("header");
    header.className = "inventory-panel-header video-playback-header";
    videoPlaybackTitle = document.createElement("h2");
    videoPlaybackTitle.id = "video-playback-title";
    videoPlaybackTitle.textContent = "Vídeo";
    videoPlaybackClose = document.createElement("button");
    videoPlaybackClose.id = "video-playback-close";
    videoPlaybackClose.className = "icon-button hint-text-remove video-playback-close";
    videoPlaybackClose.type = "button";
    videoPlaybackClose.setAttribute("aria-label", "Cerrar vídeo");
    videoPlaybackClose.title = "Cerrar vídeo";
    videoPlaybackClose.textContent = "×";
    header.append(videoPlaybackTitle, videoPlaybackClose);
    videoPlaybackElement = document.createElement("video");
    videoPlaybackElement.id = "video-playback-element";
    videoPlaybackElement.className = "video-playback-element";
    videoPlaybackElement.controls = true;
    videoPlaybackElement.playsInline = true;
    videoPlaybackElement.preload = "metadata";
    videoPlaybackPanel.append(header, videoPlaybackElement);
    stage.append(videoPlaybackPanel);
  }
}

function initializePencilNotesEditor() {
  if (pencilNotesQuill || typeof globalThis.Quill !== "function" || !pencilNotesEditor || !pencilNotesToolbar) return;
  pencilNotesQuill = new globalThis.Quill(pencilNotesEditor, {
    theme: "snow",
    placeholder: "Escribe notas durante la partida…",
    formats: ["background", "bold", "blockquote", "code-block", "header", "italic", "link", "list", "strike", "underline"],
    modules: { toolbar: pencilNotesToolbar },
  });
  pencilNotesQuill.root.setAttribute("role", "textbox");
  pencilNotesQuill.root.setAttribute("aria-multiline", "true");
  pencilNotesQuill.root.setAttribute("aria-label", "Notas libres del jugador");
  pencilNotesQuill.root.dir = "auto";
  pencilNotesQuill.on("text-change", (_delta, _oldDelta, source) => {
    if (source === "user") runtime.inventory.setNotes(sanitizeRichHtml(pencilNotesQuill.getSemanticHTML()));
  });
}
function renderPencilClues() {
  if (!pencilClues) return;
  const fragment = document.createDocumentFragment();
  runtime.inventory.clues
    .filter((clue) => String(clue?.text || "").trim())
    .forEach((clue, index) => {
      const textarea = document.createElement("textarea");
      textarea.className = "inventory-clue-slot has-clue";
      textarea.rows = 2;
      textarea.readOnly = true;
      textarea.value = clue.text;
      textarea.setAttribute("aria-label", `Pista descubierta ${index + 1}: ${clue.text}`);
      textarea.dataset.clueId = clue.id;
      fragment.append(textarea);
    });
  pencilClues.replaceChildren(fragment);
}

function showHintOverlay(clues, trigger = null, title = "Pista") {
  if (!hintOverlay || !hintOverlayContent) return;
  if (hintOverlayHeading) hintOverlayHeading.textContent = title;
  const paragraphs = (clues || []).map((clue) => String(clue?.text || "").trim()).filter(Boolean);
  hintOverlayContent.replaceChildren(...paragraphs.map((text) => {
    const paragraph = document.createElement("p");
    paragraph.textContent = text;
    return paragraph;
  }));
  hintOverlayReturnFocus = trigger || document.activeElement;
  hintOverlay.hidden = false;
  hintOverlay.setAttribute("aria-hidden", "false");
  hintOverlayClose?.focus();
}

function renderPlayerCharacterPanel() {
  if (!characterPanelContent) return;
  const fragment = document.createDocumentFragment();
  const heading = document.createElement("h3");
  heading.className = "character-panel-name";
  heading.textContent = runtime.character.name || "Jugador";
  fragment.append(heading);
  (project.characterSheet?.attributes || []).forEach((attribute) => {
    const row = document.createElement("p");
    row.className = "character-panel-stat";
    const label = document.createElement("strong");
    label.textContent = `${attribute.name}: `;
    const value = document.createElement("span");
    value.textContent = String(runtime.character.value(attribute.id) ?? attribute.initialValue ?? 0);
    row.append(label, value);
    fragment.append(row);
  });
  const progress = document.createElement("p");
  progress.className = "character-panel-progress";
  const combatTotal = scenes.reduce((total, scene) => total + (scene.combatChallenges || []).length, 0);
  const quizTotal = scenes.reduce((total, scene) => total + (scene.quizChallenges || []).length, 0);
  progress.textContent = `Progreso: ${Number(runtime.character.progress) || 0} puntos · Escenas ${runtime.character.completedModules.size}/${scenes.length} · Combates ${runtime.character.rewardedCombats.size}/${combatTotal} · Quiz ${runtime.character.rewardedQuizzes.size}/${quizTotal}`;
  fragment.append(progress);
  characterPanelContent.replaceChildren(fragment);
  if (characterPanelHeading) characterPanelHeading.textContent = runtime.character.name || "Personaje";
}

function showCharacterProfileInfo(characterId, trigger = null) {
  const character = (project.playerCharacters || []).find((item) => item.id === String(characterId || ""));
  if (!character) return;
  const values = new Map((character.attributes || []).map((entry) => [entry.attributeId, entry.value]));
  const details = (project.characterSheet?.attributes || []).map((attribute) => ({
    text: `${attribute.name}: ${values.get(attribute.id) ?? attribute.initialValue ?? 0}`,
  }));
  showHintOverlay(details, trigger, character.name || "Personaje");
}

function renderCharacterSetup() {
  if (!characterSetupAttributes) return;
  const remaining = runtime.character.distributablePoints;
  if (characterSetupPoints) characterSetupPoints.textContent = remaining
    ? `Puntos distribuibles disponibles: ${remaining}`
    : "No quedan puntos distribuibles.";
  const fragment = document.createDocumentFragment();
  (project.characterSheet?.attributes || []).forEach((attribute) => {
    const row = document.createElement("div");
    row.className = "character-setup-attribute";
    const label = document.createElement("span");
    label.textContent = attribute.name;
    const lower = document.createElement("button");
    lower.type = "button";
    lower.className = "icon-button";
    lower.textContent = "−";
    lower.dataset.characterSetupStep = attribute.id;
    lower.dataset.delta = "-1";
    lower.disabled = runtime.character.value(attribute.id) <= Number(attribute.initialValue || 0);
    lower.setAttribute("aria-label", `Quitar un punto de ${attribute.name}`);
    const value = document.createElement("output");
    value.textContent = String(runtime.character.value(attribute.id));
    const raise = document.createElement("button");
    raise.type = "button";
    raise.className = "icon-button";
    raise.textContent = "+";
    raise.dataset.characterSetupStep = attribute.id;
    raise.dataset.delta = "1";
    raise.disabled = remaining <= 0;
    raise.setAttribute("aria-label", `Añadir un punto a ${attribute.name}`);
    row.append(label, lower, value, raise);
    fragment.append(row);
  });
  characterSetupAttributes.replaceChildren(fragment);
}

function openCharacterSetup() {
  if (!characterSetupDialog || !characterSetupForm) {
    startScene(project.startSceneId || project.main?.startSceneId || scenes[0]?.id);
    return;
  }
  if (playerCharacterName) playerCharacterName.value = runtime.character.name || "Jugador";
  renderCharacterSetup();
  if (!characterSetupAttributes.dataset.bound) {
    characterSetupAttributes.dataset.bound = "true";
    characterSetupAttributes.addEventListener("click", (event) => {
      const button = event.target.closest("[data-character-setup-step]");
      if (!button) return;
      const delta = button.dataset.delta === "-1" ? -1 : 1;
      if (runtime.character.distribute(button.dataset.characterSetupStep, delta)) renderCharacterSetup();
    });
    characterSetupForm.addEventListener("submit", (event) => {
      event.preventDefault();
      runtime.character.configure({
        name: playerCharacterName?.value || "Jugador",
        values: Object.fromEntries(runtime.character.attributes),
        distributablePoints: runtime.character.distributablePoints,
      });
      if (characterSetupDialog.open && typeof characterSetupDialog.close === "function") characterSetupDialog.close();
      else characterSetupDialog.removeAttribute("open");
      startScene(project.startSceneId || project.main?.startSceneId || scenes[0]?.id);
    });
  }
  if (characterSetupDialog.showModal) characterSetupDialog.showModal();
  else characterSetupDialog.setAttribute("open", "");
}

function launchPlayerOnboarding() {
  const key = `crowther-player-welcome-dismissed:${project.id || "game"}`;
  let dismissed = false;
  try { dismissed = window.localStorage.getItem(key) === "true"; } catch { /* El juego no depende del almacenamiento. */ }
  if (!playerWelcome || !playerWelcomeStart || dismissed) {
    openCharacterSetup();
    return;
  }
  playerWelcomeStart.addEventListener("click", () => {
    if (playerWelcomeDoNotShow?.checked) {
      try { window.localStorage.setItem(key, "true"); } catch { /* La bienvenida solo se omitirá en esta carga. */ }
    }
    if (playerWelcome.open && typeof playerWelcome.close === "function") playerWelcome.close();
    else playerWelcome.removeAttribute("open");
    openCharacterSetup();
  }, { once: true });
  if (playerWelcome.showModal) playerWelcome.showModal();
  else playerWelcome.setAttribute("open", "");
}

function closeHintOverlay() {
  if (!hintOverlay || hintOverlay.hidden) return;
  hintOverlay.hidden = true;
  hintOverlay.setAttribute("aria-hidden", "true");
  const returnFocus = hintOverlayReturnFocus;
  hintOverlayReturnFocus = null;
  if (returnFocus?.isConnected) returnFocus.focus();
}

function handleInventoryGridClick(event) {
  if (event.target.closest(".inventory-item-add, .inventory-item-remove, .inventory-item-attribute-info")) return;
  const slot = event.target.closest("[data-inventory-asset-id]");
  if (!slot) return;
  const targetAssetId = slot.dataset.inventoryAssetId;
  if (runtime.pendingQuizId) {
    const result = answerQuiz(runtime.pendingQuizId, { assetId: targetAssetId });
    if (!result.ok) {
      if (runtime.state?.quizFeedback?.result === "incorrect") {
        runtime.pendingQuizId = null;
        renderInventoryGrid();
        if (inventoryPanel && !inventoryPanel.hidden) inventoryToggle?.click();
        return;
      }
      return;
    }
    runtime.pendingQuizId = null;
    renderInventoryGrid();
    if (inventoryPanel && !inventoryPanel.hidden) inventoryToggle?.click();
    return;
  }
  if (runtime.pendingCombination?.kind === "inventory") {
    completeInventoryCombination(runtime.pendingCombination.sourceAssetId, targetAssetId);
    return;
  }
  if (runtime.pendingCombination?.kind === "stage") {
    completeStageCombinationWithInventory(targetAssetId);
    return;
  }
  if (CombinationRules.resourceType(project, targetAssetId) === "sound") playInventorySound(targetAssetId);
}

function beginInventoryCombination(sourceAssetId) {
  const item = runtime.inventory.items.find((candidate) => candidate.assetId === sourceAssetId);
  if (!item || !CombinationRules.canStart(project, sourceAssetId)) {
    showInventoryMessage("No hay una combinación configurada para este objeto.", true);
    return;
  }
  if (runtime.pendingCombination?.kind === "inventory" && runtime.pendingCombination.sourceAssetId === sourceAssetId) {
    cancelPendingCombination();
    showInventoryMessage("Combinación cancelada.");
    renderInventoryGrid();
    return;
  }
  runtime.pendingCombination = { kind: "inventory", sourceAssetId };
  const source = CombinationRules.resource(project, sourceAssetId);
  showInventoryMessage(`Selecciona en el inventario el segundo recurso para combinar con «${source?.name || "objeto"}».`);
  setStatus(`Elige un segundo recurso del inventario para «${source?.name || "objeto"}».`);
  renderCombinationSoundChoices();
  renderInventoryGrid();
}

function beginStageCombination(sourceLayerId) {
  const sourceLayer = runtime.state?.layers.find((layer) => layer.id === sourceLayerId);
  if (!sourceLayer) return;
  if (runtime.pendingCombination?.kind === "stage" && runtime.pendingCombination.sourceLayerId === sourceLayerId) {
    cancelPendingCombination();
    showInventoryMessage("Combinación cancelada.");
    setStatus("Combinación cancelada.");
    renderInventoryGrid();
    return;
  }
  runtime.pendingCombination = { kind: "stage", sourceAssetId: sourceLayer.assetId, sourceLayerId, sceneId: runtime.sceneId };
  const source = CombinationRules.resource(project, sourceLayer.assetId);
  const prompt = `«${source?.name || "Objeto"}» seleccionado. Haz clic en otro objeto compatible del escenario o elige uno del inventario.`;
  showInventoryMessage(prompt);
  setStatus(prompt);
  renderCombinationSoundChoices();
  renderInventoryGrid();
  if (inventoryPanel?.hidden) inventoryToggle?.click();
  setStatus(prompt);
}

function renderCombinationSoundChoices() {
  if (!inventoryPanel || !runtime.pendingCombination) return;
  let container = inventoryPanel.querySelector("#inventory-combination-options");
  if (!container) {
    container = document.createElement("div");
    container.id = "inventory-combination-options";
    container.className = "inventory-combination-options";
    container.setAttribute("aria-label", "Sonidos compatibles de la escena");
    inventoryPanel.append(container);
  }
  const pending = runtime.pendingCombination;
  const sceneId = pending.sceneId || runtime.sceneId;
  const sourceLayer = pending.sourceLayerId
    ? sceneById.get(sceneId)?.stage?.layers?.find((layer) => layer.id === pending.sourceLayerId)
    : null;
  const scene = sceneById.get(sceneId);
  const sounds = (scene?.soundIds || [])
    .map((soundId) => soundAssetById.get(soundId))
    .filter((sound) => sound
      && CombinationRules.resolve(project, pending.sourceAssetId, sound.id, sourceLayer?.id));
  container.replaceChildren();
  if (!sounds.length) {
    container.hidden = true;
    return;
  }
  const heading = document.createElement("p");
  heading.className = "inventory-combination-heading";
  heading.textContent = "Sonidos compatibles de esta escena";
  container.append(heading);
  sounds.forEach((sound) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "inventory-combination-choice";
    button.textContent = `♫ ${sound.name || "Sonido MP3"}`;
    button.addEventListener("click", () => {
      if (runtime.pendingCombination?.kind === "stage") completeStageCombinationWithSound(sound.id);
      else completeInventoryCombinationWithSound(sound.id);
    });
    container.append(button);
  });
  container.hidden = false;
}

function handleStageCombinationClick(event) {
  if (runtime.pendingCombination?.kind !== "stage") return;
  const layerElement = event.target.closest(".scene-layer[data-layer-id]");
  const targetLayerId = layerElement?.dataset.layerId;
  if (!targetLayerId || targetLayerId === runtime.pendingCombination.sourceLayerId) return;
  completeStageCombinationWithLayer(targetLayerId);
}

function completeInventoryCombination(firstAssetId, secondAssetId) {
  const rule = CombinationRules.resolve(project, firstAssetId, secondAssetId);
  if (!rule) {
    showInventoryMessage("Esos dos recursos no tienen una combinación configurada. Elige otra imagen.", true);
    return;
  }
  const first = CombinationRules.resource(project, firstAssetId);
  const second = CombinationRules.resource(project, secondAssetId);
  const resultAsset = CombinationRules.resource(project, rule.resultAssetId);
  const result = runtime.inventory.combine(firstAssetId, secondAssetId, rule.resultAssetId, {
    capacity: getInventoryCapacity(),
    unique: CombinationRules.isUnique(project, rule.resultAssetId),
  });
  if (!result.ok) {
    const message = result.reason === "full"
      ? "No queda sitio para el resultado. Libera espacio en el inventario."
      : result.reason === "unique"
        ? "El resultado es único y ya está en el inventario."
        : result.reason === "insufficient"
          ? "No hay suficientes unidades para hacer esa combinación."
          : "No se pudo completar la combinación.";
    showInventoryMessage(message, true);
    return;
  }
  cancelPendingCombination();
  const message = `Combinación realizada: «${first?.name || "Objeto"}» + «${second?.name || "Objeto"}» → «${resultAsset?.name || "Resultado"}».`;
  showInventoryMessage(message);
  setStatus(message);
  renderInventoryGrid();
}

function completeStageCombinationWithLayer(targetLayerId) {
  const pending = runtime.pendingCombination;
  const layers = runtime.state?.layers || [];
  const sourceLayer = layers.find((layer) => layer.id === pending?.sourceLayerId);
  const targetLayer = layers.find((layer) => layer.id === targetLayerId);
  if (!pending || !sourceLayer || !targetLayer) return;
  const rule = CombinationRules.resolve(project, sourceLayer.assetId, targetLayer.assetId, sourceLayer.id);
  if (!rule) {
    showInventoryMessage("Esos dos objetos no se pueden combinar.", true);
    setStatus("Esos dos objetos no se pueden combinar.", true);
    return;
  }
  if (CombinationRules.resourceType(project, rule.resultAssetId) === "sound") {
    const result = runtime.inventory.add(rule.resultAssetId, { capacity: getInventoryCapacity() });
    if (!result.ok) {
      showInventoryMessage("No queda sitio en el inventario para el sonido resultante.", true);
      setStatus("Libera espacio antes de completar la combinación.", true);
      return;
    }
    runtime.state.layers = layers.filter((layer) => layer.id !== sourceLayer.id && layer.id !== targetLayer.id);
  } else {
    sourceLayer.assetId = rule.resultAssetId;
    runtime.state.layers = layers.filter((layer) => layer.id !== targetLayer.id);
  }
  const resultAsset = CombinationRules.resource(project, rule.resultAssetId);
  cancelPendingCombination();
  render(runtime.state, sceneById.get(runtime.sceneId));
  renderInventoryGrid();
  const message = `Combinación realizada: «${resultAsset?.name || "Resultado"}».`;
  showInventoryMessage(message);
  setStatus(message);
}

function completeStageCombinationWithInventory(targetAssetId) {
  const pending = runtime.pendingCombination;
  const sourceLayer = runtime.state?.layers.find((layer) => layer.id === pending?.sourceLayerId);
  if (!pending || !sourceLayer) return;
  const rule = CombinationRules.resolve(project, sourceLayer.assetId, targetAssetId, sourceLayer.id);
  if (!rule) {
    showInventoryMessage("Ese objeto del inventario no es compatible. Elige otro.", true);
    return;
  }
  let result;
  if (CombinationRules.resourceType(project, rule.resultAssetId) === "sound") {
    result = runtime.inventory.replace(targetAssetId, rule.resultAssetId, { capacity: getInventoryCapacity() });
    if (result.ok) runtime.state.layers = runtime.state.layers.filter((layer) => layer.id !== sourceLayer.id);
  } else if (runtime.inventory.consume(targetAssetId)) {
    sourceLayer.assetId = rule.resultAssetId;
    result = { ok: true };
  } else {
    result = { ok: false, reason: "missing" };
  }
  if (!result.ok) {
    showInventoryMessage(result.reason === "full"
      ? "No queda sitio para el sonido resultante. Libera espacio en el inventario."
      : "No se pudo completar la combinación.", true);
    return;
  }
  const resultAsset = CombinationRules.resource(project, rule.resultAssetId);
  cancelPendingCombination();
  render(runtime.state, sceneById.get(runtime.sceneId));
  renderInventoryGrid();
  const message = `Combinación realizada: «${resultAsset?.name || "Resultado"}».`;
  showInventoryMessage(message);
  setStatus(message);
}

function completeStageCombinationWithSound(soundAssetId) {
  const pending = runtime.pendingCombination;
  const sourceLayer = runtime.state?.layers.find((layer) => layer.id === pending?.sourceLayerId);
  if (!pending || !sourceLayer) return;
  const rule = CombinationRules.resolve(project, sourceLayer.assetId, soundAssetId, sourceLayer.id);
  if (!rule) {
    showInventoryMessage("Ese sonido no es compatible con el objeto seleccionado.", true);
    return;
  }
  if (CombinationRules.resourceType(project, rule.resultAssetId) === "sound") {
    const result = runtime.inventory.add(rule.resultAssetId, { capacity: getInventoryCapacity() });
    if (!result.ok) {
      showInventoryMessage("No queda sitio para el sonido resultante. Libera espacio en el inventario.", true);
      return;
    }
    runtime.state.layers = runtime.state.layers.filter((layer) => layer.id !== sourceLayer.id);
  } else {
    sourceLayer.assetId = rule.resultAssetId;
  }
  const resultAsset = CombinationRules.resource(project, rule.resultAssetId);
  cancelPendingCombination();
  render(runtime.state, sceneById.get(runtime.sceneId));
  renderInventoryGrid();
  const message = `Combinación realizada: «${resultAsset?.name || "Resultado"}».`;
  showInventoryMessage(message);
  setStatus(message);
}

function completeInventoryCombinationWithSound(soundAssetId) {
  const pending = runtime.pendingCombination;
  if (pending?.kind !== "inventory") return;
  const rule = CombinationRules.resolve(project, pending.sourceAssetId, soundAssetId);
  if (!rule) {
    showInventoryMessage("Ese sonido no es compatible con el objeto seleccionado.", true);
    return;
  }
  const result = runtime.inventory.replace(pending.sourceAssetId, rule.resultAssetId, {
    capacity: getInventoryCapacity(),
    unique: CombinationRules.isUnique(project, rule.resultAssetId),
  });
  if (!result.ok) {
    showInventoryMessage(result.reason === "full"
      ? "No queda sitio para el resultado. Libera espacio en el inventario."
      : result.reason === "unique"
        ? "El resultado es único y ya está en el inventario."
        : "No se pudo completar la combinación.", true);
    return;
  }
  const sound = soundAssetById.get(soundAssetId);
  const resultAsset = CombinationRules.resource(project, rule.resultAssetId);
  cancelPendingCombination();
  renderInventoryGrid();
  const message = `Combinación realizada con «${sound?.name || "sonido"}»: «${resultAsset?.name || "Resultado"}».`;
  showInventoryMessage(message);
  setStatus(message);
}

function cancelPendingCombination() {
  runtime.pendingCombination = null;
  inventoryPanel?.querySelector("#inventory-combination-options")?.remove();
}

function playInventorySound(assetId) {
  const sound = soundAssetById.get(assetId);
  if (!sound?.dataUrl || typeof Audio !== "function") return;
  const audio = new Audio(sound.dataUrl);
  audio.volume = (Number(sound.volumePercent) || 0) / 100;
  runtime.audioElements.push(audio);
  audio.play()?.catch(() => {});
  setStatus(`Reproduciendo «${sound.name || "sonido"}».`);
}

inventoryItems?.addEventListener("click", handleInventoryGridClick);
layersElement.addEventListener("click", handleStageCombinationClick);
choicesElement.addEventListener("click", (event) => {
  const combatButton = event.target.closest("[data-combat-play]");
  if (combatButton) {
    const itemId = combatButton.closest("[data-combat-box]")?.querySelector("[data-combat-inventory-item]")?.value || "";
    playCombatRound(combatButton.dataset.combatPlay, itemId);
    return;
  }
  const button = event.target.closest("[data-quiz-action]");
  if (!button) return;
  const action = button.dataset.quizAction;
  if (action === "inventory") {
    runtime.pendingQuizId = button.dataset.quizId || null;
    cancelPendingCombination();
    renderInventoryGrid();
    if (inventoryPanel?.hidden) inventoryToggle?.click();
    showInventoryMessage("Selecciona en el inventario el objeto que responde a la pregunta.");
    setStatus("Elige el objeto correcto del inventario.");
  } else if (action === "continue") {
    if (runtime.state) runtime.state.quizFeedback = null;
    const scene = sceneById.get(runtime.sceneId);
    if (scene && runtime.state) render(runtime.state, scene);
  } else if (action === "scene") {
    const targetSceneId = button.dataset.quizTarget;
    if (runtime.unlockedQuizSceneIds.has(targetSceneId)) startScene(targetSceneId);
  } else if (action === "video") {
    const videoId = button.dataset.quizTarget;
    if (runtime.unlockedQuizVideoIds.has(videoId)) playVideoAsset(videoId);
  }
});
choicesElement.addEventListener("submit", (event) => {
  const form = event.target.closest("form[data-quiz-answer-form]");
  if (!form) return;
  event.preventDefault();
  const answer = form.querySelector("[data-quiz-answer-input]")?.value || "";
  answerQuiz(form.dataset.quizId, { text: answer });
});

function showInventoryMessage(message, isError = false) {
  if (inventoryMessage) {
    inventoryMessage.textContent = message || "";
    inventoryMessage.hidden = !message;
    inventoryMessage.dataset.error = String(Boolean(isError));
  }
}

function showPencilMessage(message, isError = false) {
  if (!pencilMessage) return;
  pencilMessage.textContent = message || "";
  pencilMessage.hidden = !message;
  pencilMessage.dataset.error = String(Boolean(isError));
}

function getInventoryCapacity() {
  const presets = new Set(["3x2", "4x2", "5x2", "5x3", "6x3", "7x3", "8x3", "8x4", "10x4"]);
  const stored = project.inventoryGrid || {};
  const candidate = `${Number(stored.columns)}x${Number(stored.rows)}`;
  const [columns, rows] = (presets.has(candidate) ? candidate : "5x3").split("x").map(Number);
  return columns * rows;
}

function inventoryResultMessage(result, name) {
  if (result.ok && result.reason === "stacked") return `Otra copia de «${name}» añadida al inventario (${result.item.quantity}).`;
  if (result.ok) return `«${name}» añadido al inventario.`;
  if (result.reason === "full") return "No queda sitio en el inventario. Libera espacio retirando un objeto.";
  if (result.reason === "unique") return "Este objeto es único y ya está en el inventario.";
  return "No se pudo añadir el objeto al inventario.";
}

function collectLayerClues(layer, scene, trigger = null) {
  const clues = (layer.clues || []).filter((clue) => String(clue.text || "").trim());
  if (!clues.length) {
    const message = "Esta imagen todavía no tiene textos de pista.";
    showPencilMessage(message, true);
    setStatus(message, true);
    return;
  }
  const rawCapacity = Number(project.inventoryHintCapacity);
  const capacity = new Set([5, 10, 15, 20, 30]).has(rawCapacity) ? rawCapacity : 10;
  let added = 0;
  let alreadyFound = 0;
  let full = false;
  clues.forEach((clue) => {
    const result = runtime.inventory.addClue(`${scene.id}:${layer.id}:${clue.id}`, clue.text, { capacity });
    if (result.ok) added += 1;
    else if (result.reason === "duplicate") alreadyFound += 1;
    else if (result.reason === "full") full = true;
  });
  const message = full
    ? `${added ? `Se han añadido ${added} pistas. ` : ""}No quedan espacios de pistas libres.`
    : added
      ? `${added} ${added === 1 ? "pista añadida" : "pistas añadidas"} a Pistas${alreadyFound ? `; ${alreadyFound} ya estaban anotadas` : ""}.`
      : "Estas pistas ya estaban anotadas en el inventario.";
  renderInventoryGrid();
  showHintOverlay(clues, trigger);
  showPencilMessage(message, full);
  setStatus(message, full);
}

function cloneText(text) {
    return { ...(text || {}) };
  }

  function normalizeCombatAttribute(value) {
    return String(value || "").trim().normalize("NFKC").toLocaleLowerCase();
  }

  function readCombatPlayerProfile(fallbackHealth = 10) {
    const sheet = project.characterSheet || project.playerCharacterSheet || project.playerCharacter || {};
    const source = sheet.attributes || sheet.stats || sheet.characteristics || {};
    const attributes = new Map();
    if (Array.isArray(source)) source.forEach((item) => attributes.set(normalizeCombatAttribute(item?.name), (runtime.character?.value?.(item?.id) ?? Number(item?.initialValue ?? item?.value)) || 0));
    else if (source && typeof source === "object") Object.entries(source).forEach(([name, value]) => attributes.set(normalizeCombatAttribute(name), Number(value?.value ?? value) || 0));
    const health = Array.isArray(source) ? source.find((item) => normalizeCombatAttribute(item?.name) === "vida") : null;
    const currentHealth = health ? runtime.character?.value?.(health.id) : null;
    const maxHealth = Number(sheet.maxHealth ?? sheet.healthMax ?? sheet.vidaMaxima ?? health?.initialValue);
    return {
      name: String(runtime.character?.name || sheet.name || sheet.characterName || "Jugador"),
      attributes,
      maxHealth: Number.isFinite(currentHealth) && currentHealth >= 0 ? currentHealth : Number.isFinite(maxHealth) && maxHealth > 0 ? maxHealth : Math.max(1, Number(fallbackHealth) || 10),
    };
  }

  function readCombatItemDamage(assetId) {
    const asset = assetById.get(String(assetId || ""));
    const values = [asset?.weaponDamage, asset?.damage, asset?.combatValues?.damage, asset?.values?.damage];
    return values.map(Number).find(Number.isFinite) ?? 0;
  }

  function evaluateCombatTerms(terms, { playerAttributes, enemyAttributes, weaponDamage }) {
    const values = (Array.isArray(terms) ? terms : []).map((term) => {
      if (term?.source === "playerAttribute") return playerAttributes.get(normalizeCombatAttribute(term.attribute)) || 0;
      if (term?.source === "enemyAttribute") return enemyAttributes.get(normalizeCombatAttribute(term.attribute)) || 0;
      if (term?.source === "weaponDamage") return weaponDamage;
      return Number(term?.value) || 0;
    });
    if (!values.length) return 0;
    let sum = 0;
    let current = values[0];
    for (let index = 1; index < values.length; index += 1) {
      const operator = terms[index]?.operator || "+";
      const value = values[index];
      if (operator === "*") current *= value;
      else if (operator === "/") current = value === 0 ? 0 : current / value;
      else {
        sum += current;
        current = operator === "-" ? -value : value;
      }
    }
    return sum + current;
  }

  function compareCombatScores(left, operator, right) {
    switch (operator) {
      case "=": return left === right;
      case "!=": return left !== right;
      case ">=": return left >= right;
      case "<": return left < right;
      case "<=": return left <= right;
      default: return left > right;
    }
  }

  // El jugador modifica este estado; mantenerlo separado evita mutar datos del proyecto.
  function cloneState(scene) {
    const dialogues = Array.isArray(scene.dialogues)
      ? scene.dialogues
      : [scene.dialogue || {}];
    const clonedDialogues = dialogues.map((dialogue) => ({
      ...dialogue,
      text: cloneText(dialogue.text),
    }));
    return {
      layers: (scene.stage?.layers || []).map((layer) => ({ ...layer })),
      dialogues: clonedDialogues,
      dialogue: clonedDialogues[0],
      decisions: {
        ...(scene.decisions || {}),
        choices: (scene.decisions?.choices || []).map((choice) => ({ ...choice })),
      },
      quizChallenges: (Array.isArray(scene.quizChallenges) ? scene.quizChallenges : []).map((challenge) => ({
        ...challenge,
        question: { ...(challenge.question || {}) },
        questionPlacement: { ...(challenge.questionPlacement || {}) },
        answerPlacement: { ...(challenge.answerPlacement || {}) },
        outcome: {
          ...(challenge.outcome || {}),
          text: { ...(challenge.outcome?.text || {}) },
        },
        incorrectOutcome: {
          ...(challenge.incorrectOutcome || {}),
          text: { ...(challenge.incorrectOutcome?.text || {}) },
        },
      })),
      quizFeedback: null,
      combatChallenges: (Array.isArray(scene.combatChallenges) ? scene.combatChallenges : []).map((challenge) => ({
        ...challenge,
        attributes: (challenge.attributes || []).map((attribute) => ({ ...attribute })),
        placement: { ...(challenge.placement || {}) },
      })),
      combatStates: Object.fromEntries((scene.combatChallenges || []).map((challenge) => {
        const profile = readCombatPlayerProfile(challenge.enemyMaxHealth);
        return [challenge.id, {
          rounds: 0,
          enemyHealth: challenge.enemyMaxHealth,
          playerHealth: profile.maxHealth,
          playerMaxHealth: profile.maxHealth,
          selectedItemId: "",
          lastRolls: null,
          message: "",
          result: null,
          finished: false,
        }];
      })),
      transitions: [],
    };
  }

  function normalizeQuizAnswer(value) {
    return String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
  }

  function answerQuiz(quizId, { text = "", assetId = "" } = {}) {
    if (!runtime.state || !runtime.sceneId) return { ok: false };
    const challenge = runtime.state.quizChallenges.find((item) => item.id === quizId);
    if (!challenge || runtime.completedQuizIds.has(challenge.id)) {
      return { ok: false };
    }

    let correct = false;
    if (challenge.answerType === "inventory") {
      const selectedId = String(assetId || "");
      const selectedItem = runtime.inventory.items.find((item) => item.assetId === selectedId);
      if (!selectedItem) return { ok: false };
      correct = Boolean(challenge.expectedAssetId && selectedId === challenge.expectedAssetId);
    } else {
      const expected = normalizeQuizAnswer(challenge.expectedText);
      if (!expected) return { ok: false };
      correct = normalizeQuizAnswer(text) === expected;
    }

    if (!correct) {
      const maxRetries = Math.min(10, Math.max(0, Math.round(Number(challenge.maxRetries) || 0)));
      const failedAttempts = (runtime.quizFailureCounts.get(challenge.id) || 0) + 1;
      runtime.quizFailureCounts.set(challenge.id, failedAttempts);
      const canRetry = failedAttempts <= maxRetries;
      if (!canRetry) runtime.completedQuizIds.add(challenge.id);
      const outcome = challenge.incorrectOutcome || {};
      if (outcome.type === "scene" && outcome.sceneId) runtime.unlockedQuizSceneIds.add(outcome.sceneId);
      if (outcome.type === "video" && outcome.videoId) runtime.unlockedQuizVideoIds.add(outcome.videoId);
      runtime.state.quizFeedback = {
        quizId: challenge.id,
        result: "incorrect",
        canRetry,
        failedAttempts,
        maxRetries,
        retriesRemaining: Math.max(0, maxRetries - failedAttempts + 1),
      };
      render(runtime.state, sceneById.get(runtime.sceneId));
      return { ok: false };
    }
    if (challenge.answerType === "inventory" && challenge.consumeItem
      && !runtime.inventory.consume(challenge.expectedAssetId)) {
      return { ok: false };
    }

    runtime.completedQuizIds.add(challenge.id);
    runtime.character.award(project.characterSheet, "quiz-solved", challenge.id);
    if (challenge.outcome?.type === "scene" && challenge.outcome.sceneId) {
      runtime.unlockedQuizSceneIds.add(challenge.outcome.sceneId);
    }
    if (challenge.outcome?.type === "video" && challenge.outcome.videoId) {
      runtime.unlockedQuizVideoIds.add(challenge.outcome.videoId);
    }
    runtime.state.quizFeedback = { quizId: challenge.id, result: "correct" };
    render(runtime.state, sceneById.get(runtime.sceneId));
    return { ok: true };
  }

  function playCombatRound(combatId, inventoryAssetId = "") {
    const challenge = runtime.state?.combatChallenges?.find((item) => item.id === String(combatId || ""));
    const fight = runtime.state?.combatStates?.[challenge?.id];
    if (!challenge || !fight || fight.finished) return;
    fight.selectedItemId = String(inventoryAssetId || "");
    const diceCount = Math.max(1, Math.min(20, Math.round(Number(challenge.diceCount) || 1)));
    const diceSides = Math.max(2, Math.min(1000, Math.round(Number(challenge.diceSides) || 2)));
    const roll = () => Array.from({ length: diceCount }, () => 1 + Math.floor(Math.random() * diceSides));
    const playerRolls = roll();
    const enemyRolls = roll();
    const total = (values) => values.reduce((sum, value) => sum + value, 0);
    const profile = readCombatPlayerProfile(challenge.enemyMaxHealth);
    const enemyAttributes = new Map((challenge.attributes || []).map((attribute) => [normalizeCombatAttribute(attribute.name), Number(attribute.enemyValue) || 0]));
    const condition = challenge.victoryCondition || {
      playerTerms: [
        { source: "playerAttribute", attribute: challenge.comparisonAttribute, operator: "+" },
        { source: "number", value: challenge.playerBonus, operator: "+" },
      ],
      comparator: challenge.comparisonOperator || ">",
      enemyTerms: [{ source: "enemyAttribute", attribute: challenge.comparisonAttribute, operator: "+" }],
    };
    const weaponDamage = readCombatItemDamage(inventoryAssetId);
    const playerScore = evaluateCombatTerms(condition.playerTerms, { playerAttributes: profile.attributes, enemyAttributes, weaponDamage }) + total(playerRolls);
    const enemyScore = evaluateCombatTerms(condition.enemyTerms, { playerAttributes: profile.attributes, enemyAttributes, weaponDamage }) + total(enemyRolls);
    const comparator = condition.comparator || challenge.comparisonOperator || ">";
    const wonRound = compareCombatScores(playerScore, comparator, enemyScore);
    fight.rounds += 1;
    fight.lastRolls = { player: playerRolls, enemy: enemyRolls, playerScore, enemyScore, wonRound };
    const damage = Math.max(1, Math.round(Number(challenge.damagePerWin) || 1));
    if (wonRound) fight.enemyHealth = Math.max(0, fight.enemyHealth - damage);
    else {
      fight.playerHealth = Math.max(0, fight.playerHealth - damage);
      const healthAttribute = project.characterSheet?.attributes?.find((attribute) => normalizeCombatAttribute(attribute.name) === "vida");
      if (healthAttribute) runtime.character.change(healthAttribute.id, -damage);
    }
    (challenge.roundAttributeEffects || []).forEach((effect) => {
      runtime.character.change(effect.attributeId, wonRound ? effect.onWin : effect.onLoss);
    });
    const currentHealthAttribute = project.characterSheet?.attributes?.find((attribute) => normalizeCombatAttribute(attribute.name) === "vida");
    if (currentHealthAttribute) {
      const currentHealth = runtime.character.value(currentHealthAttribute.id);
      fight.playerHealth = Math.max(0, currentHealth);
      if (currentHealth < 0) runtime.character.change(currentHealthAttribute.id, -currentHealth);
    }
    const roundMessage = wonRound
      ? `Ganas la ronda ${fight.rounds}: ${playerScore} ${comparator} ${enemyScore}.`
      : `Pierdes la ronda ${fight.rounds}: ${playerScore} no cumple ${comparator} ${enemyScore}.`;
    if (fight.enemyHealth <= 0) {
      fight.finished = true;
      fight.result = "victory";
      fight.message = `${roundMessage} ${challenge.enemyName || "El enemigo"} ha caído.`;
    } else if (fight.playerHealth <= 0) {
      fight.finished = true;
      fight.result = "defeat";
      fight.message = `${roundMessage} Te has quedado sin vida.`;
    } else if (fight.rounds >= Math.max(1, Number(challenge.maxRounds) || 1)) {
      fight.finished = true;
      fight.result = fight.playerHealth === fight.enemyHealth ? "draw" : fight.playerHealth > fight.enemyHealth ? "victory" : "defeat";
      fight.message = fight.result === "draw"
        ? `${roundMessage} El combate termina en empate.`
        : `${roundMessage} Se alcanzó el máximo de rondas: ${fight.result === "victory" ? "victoria" : "derrota"}.`;
    } else {
      fight.message = `${roundMessage} Vida: ${fight.playerHealth} · ${fight.enemyHealth}.`;
    }
    if (fight.finished && fight.result === "victory" && !runtime.completedCombatIds.has(challenge.id)) {
      runtime.completedCombatIds.add(challenge.id);
      runtime.character.award(project.characterSheet, "combat-won", challenge.id);
      const reward = challenge.victoryReward || {};
      if (reward.type === "object" && reward.assetId) runtime.inventory.addAttributeBonus(reward.assetId, reward.attributeId, reward.amount);
      else runtime.character.change(reward.attributeId, reward.amount);
    }
    render(runtime.state, sceneById.get(runtime.sceneId));
  }

  function appendCombatPreview(fragment, state) {
    (Array.isArray(state.combatChallenges) ? state.combatChallenges : []).forEach((challenge) => {
      const profile = readCombatPlayerProfile(challenge.enemyMaxHealth);
      const fight = state.combatStates?.[challenge.id] || {};
      const box = document.createElement("section");
      box.className = "combat-box";
      box.dataset.combatBox = challenge.id;
      box.setAttribute("aria-label", `Combate contra ${challenge.enemyName || "enemigo"}`);
      const placement = challenge.placement || {};
      box.style.left = `${Number.isFinite(Number(placement.xPct)) ? placement.xPct : 50}%`;
      box.style.top = `${Number.isFinite(Number(placement.yPct)) ? placement.yPct : 48}%`;
      box.style.width = `${Number.isFinite(Number(placement.widthPct)) ? placement.widthPct : 90}%`;
      box.style.height = `${Number.isFinite(Number(placement.heightPct)) ? placement.heightPct : 70}%`;
      box.style.zIndex = "5";
      if (fight.finished && ["victory", "defeat"].includes(fight.result)) {
        const animation = fight.result === "victory" ? challenge.victoryAnimation : challenge.defeatAnimation;
        box.classList.add(`has-quiz-animation-${["pulse", "shake", "flash"].includes(animation) ? animation : "pulse"}`);
        box.style.setProperty("--quiz-animation-duration", `${Math.min(10000, Math.max(150, Number(challenge.animationDurationMs) || 900))}ms`);
      }
      const heading = document.createElement("header");
      heading.className = "combat-heading";
      const round = document.createElement("span");
      round.className = "combat-round-label";
      round.textContent = `Ronda ${Number(fight.rounds) || 0}/${challenge.maxRounds}`;
      heading.append(round);
      const sides = document.createElement("div");
      sides.className = "combat-sides";
      const addSide = (name, isPlayer) => {
        const side = document.createElement("section");
        side.className = `combat-side${isPlayer ? " is-player" : " is-enemy"}`;
        const title = document.createElement("h4");
        title.textContent = isPlayer ? profile.name : challenge.enemyName || "Enemigo";
        const healthMax = isPlayer ? Number(fight.playerMaxHealth) || profile.maxHealth : Number(challenge.enemyMaxHealth) || 1;
        const health = document.createElement("p");
        health.className = "combat-health";
        health.textContent = `Vida: ${Math.max(0, Number(isPlayer ? fight.playerHealth : fight.enemyHealth) || 0)} / ${healthMax}`;
        side.append(title, health);
        (challenge.attributes || []).forEach((attribute) => {
          const row = document.createElement("p");
          row.className = "combat-stat";
          const label = document.createElement("span");
          label.textContent = attribute.name || "Característica";
          const value = document.createElement("strong");
          value.textContent = String(isPlayer
            ? (profile.attributes.get(normalizeCombatAttribute(attribute.name)) || 0)
            : (Number(attribute.enemyValue) || 0));
          row.append(label, value);
          side.append(row);
        });
        const dice = document.createElement("div");
        dice.className = "combat-dice";
        dice.setAttribute("aria-label", `${challenge.diceCount} dados de ${challenge.diceSides} caras`);
        for (let index = 0; index < Math.max(1, Number(challenge.diceCount) || 1); index += 1) {
          const icon = document.createElement("span");
          icon.setAttribute("aria-hidden", "true");
          icon.textContent = "⚄";
          dice.append(icon);
        }
        const values = fight.lastRolls?.[isPlayer ? "player" : "enemy"];
        if (Array.isArray(values)) {
          const result = document.createElement("small");
          result.className = "combat-roll-result";
          result.textContent = `Tirada: ${values.join(" + ")} = ${values.reduce((sum, value) => sum + value, 0)}`;
          dice.append(result);
        }
        side.append(dice);
        sides.append(side);
      };
      addSide(challenge.enemyName, false);
      addSide(profile.name, true);
      const footer = document.createElement("footer");
      footer.className = "combat-footer";
      const itemLabel = document.createElement("label");
      itemLabel.className = "combat-item-field";
      const itemHeading = document.createElement("span");
      itemHeading.textContent = "Objeto del inventario";
      const itemSelect = document.createElement("select");
      itemSelect.className = "quiz-select";
      itemSelect.dataset.combatInventoryItem = "";
      const emptyItem = document.createElement("option");
      emptyItem.value = "";
      emptyItem.textContent = "Sin objeto";
      itemSelect.append(emptyItem);
      (runtime.inventory.items || []).forEach((item) => {
        const asset = assetById.get(item.assetId);
        if (!asset) return;
        const option = document.createElement("option");
        option.value = item.assetId;
        option.textContent = `${asset.name || "Objeto"}${Number(item.quantity) > 1 ? ` ×${item.quantity}` : ""}`;
        option.selected = item.assetId === fight.selectedItemId;
        itemSelect.append(option);
      });
      itemLabel.append(itemHeading, itemSelect);
      const message = document.createElement("p");
      message.className = `combat-result${fight.result === "victory" ? " is-victory" : fight.result === "defeat" ? " is-defeat" : ""}`;
      message.setAttribute("aria-live", "polite");
      message.textContent = fight.message || "";
      const play = document.createElement("button");
      play.type = "button";
      play.className = "quiz-action-button combat-play-button";
      play.dataset.combatPlay = challenge.id;
      play.textContent = "Jugar Ronda";
      play.disabled = Boolean(fight.finished);
      footer.append(itemLabel, message, play);
      box.append(heading, sides, footer);
      fragment.append(box);
    });
  }

  function appendQuizPreview(fragment, state) {
    const quizzes = Array.isArray(state.quizChallenges) ? state.quizChallenges : [];
    const feedback = state.quizFeedback || null;
    const challenge = feedback
      ? quizzes.find((item) => item.id === feedback.quizId)
      : quizzes.find((item) => !runtime.completedQuizIds.has(item.id));
    if (!challenge) return;

    const createBox = (role, placement, label) => {
      const box = document.createElement("section");
      const placementNumber = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
      box.className = `quiz-box quiz-${role}-box`;
      box.dataset.quizId = challenge.id;
      box.dataset.quizBoxRole = role;
      box.setAttribute("aria-label", label);
      box.style.left = `${placementNumber(placement?.xPct, 50)}%`;
      box.style.top = `${placementNumber(placement?.yPct, role === "question" ? 28 : 70)}%`;
      box.style.width = `${placementNumber(placement?.widthPct, 76)}%`;
      box.style.height = `${placementNumber(placement?.heightPct, role === "question" ? 20 : 28)}%`;
      box.style.zIndex = "4";
      return box;
    };

    const questionBox = createBox("question", challenge.questionPlacement, "Pregunta interactiva");
    const question = document.createElement("div");
    question.className = "quiz-question-text";
    question.dir = challenge.question?.dir || "auto";
    question.lang = challenge.question?.lang || "und";
    question.innerHTML = sanitizeRichHtml(challenge.question?.html || "<p>Pregunta sin redactar.</p>");
    questionBox.append(question);
    const answerBox = createBox("answer", challenge.answerPlacement, "Respuesta y consecuencia del Quiz");

    if (feedback?.quizId === challenge.id) {
      const isCorrect = feedback.result !== "incorrect";
      answerBox.classList.add(isCorrect ? "is-correct" : "is-incorrect");
      const outcome = (isCorrect ? challenge.outcome : challenge.incorrectOutcome) || {};
      if (outcome.type === "dialogue" && outcome.text?.html) {
        const response = document.createElement("div");
        response.className = "quiz-response-dialogue";
        response.innerHTML = sanitizeRichHtml(outcome.text.html);
        response.dir = outcome.text.dir || "auto";
        response.lang = outcome.text.lang || "und";
        answerBox.append(response);
      } else if (outcome.type === "animation") {
        const animationType = ["pulse", "shake", "flash"].includes(outcome.animationType) ? outcome.animationType : "pulse";
        answerBox.classList.add(`has-quiz-animation-${animationType}`);
        answerBox.style.setProperty("--quiz-animation-duration", `${Math.min(10000, Math.max(150, Number(outcome.animationDurationMs) || 900))}ms`);
      } else if (outcome.type === "scene" && outcome.sceneId) {
        const target = sceneById.get(outcome.sceneId);
        if (target && runtime.unlockedQuizSceneIds.has(target.id)) {
          const action = document.createElement("button");
          action.type = "button";
          action.className = "quiz-action-button";
          action.dataset.quizAction = "scene";
          action.dataset.quizTarget = target.id;
          action.textContent = `Ir a ${target.name || `Escena ${target.moduleNumber || "destino"}`}`;
          answerBox.append(action);
        }
      } else if (outcome.type === "video" && outcome.videoId) {
        const target = videoAssetById.get(outcome.videoId);
        if (target && runtime.unlockedQuizVideoIds.has(target.id)) {
          const action = document.createElement("button");
          action.type = "button";
          action.className = "quiz-action-button";
          action.dataset.quizAction = "video";
          action.dataset.quizTarget = target.id;
          action.textContent = `Reproducir ${target.name || "vídeo"}`;
          answerBox.append(action);
        }
      }

      const continueButton = document.createElement("button");
      continueButton.type = "button";
      continueButton.className = "quiz-action-button is-secondary";
      continueButton.dataset.quizAction = "continue";
      const hasNextQuiz = quizzes.some((item) => !runtime.completedQuizIds.has(item.id) && item.id !== challenge.id);
      continueButton.textContent = !isCorrect && feedback.canRetry
        ? "Reintentar"
        : hasNextQuiz
          ? "Siguiente pregunta"
          : "Continuar";
      answerBox.append(continueButton);
      fragment.append(questionBox, answerBox);
      return;
    }

    if (challenge.answerType === "inventory") {
      const instruction = document.createElement("p");
      instruction.className = "quiz-answer-instruction";
      instruction.textContent = "Elige el objeto correcto de tu inventario.";
      const addButton = document.createElement("button");
      addButton.type = "button";
      addButton.className = "icon-button quiz-inventory-add";
      addButton.dataset.quizAction = "inventory";
      addButton.dataset.quizId = challenge.id;
      addButton.textContent = "+";
      addButton.setAttribute("aria-label", "Elegir objeto del inventario");
      addButton.title = "Elegir del inventario";
      answerBox.append(instruction, addButton);
    } else {
      const form = document.createElement("form");
      form.className = "quiz-answer-form";
      form.dataset.quizAnswerForm = "";
      form.dataset.quizId = challenge.id;
      const input = document.createElement("input");
      input.type = "text";
      input.autocomplete = "off";
      input.placeholder = "Escribe tu respuesta…";
      input.setAttribute("aria-label", "Respuesta a la pregunta");
      input.dataset.quizAnswerInput = "";
      const submit = document.createElement("button");
      submit.type = "submit";
      submit.className = "quiz-action-button";
      submit.textContent = "Responder";
      form.append(input, submit);
      answerBox.append(form);
    }
    fragment.append(questionBox, answerBox);
  }

  function sanitizeRichHtml(html) {
    const template = document.createElement("template");
    template.innerHTML = String(html || "");
    const allowedTags = new Set([
      "A", "B", "BLOCKQUOTE", "BR", "CODE", "DEL", "DIV", "EM", "H1", "H2", "H3",
      "I", "LI", "MARK", "OL", "P", "PRE", "S", "SPAN", "STRONG", "SUB", "SUP", "U", "UL",
    ]);
    const removableTags = new Set(["EMBED", "IFRAME", "OBJECT", "SCRIPT", "STYLE"]);
    const allowedStyleProperties = new Set(["background-color", "color", "font-style", "font-weight", "text-decoration"]);

    function isSafeLink(value) {
      const href = String(value || "").trim();
      if (!href || /[\u0000-\u0020\u007f]/.test(href)) return false;
      if (/^(https?:|mailto:|tel:)/i.test(href)) return true;
      if (href.startsWith("#") || href.startsWith("./") || href.startsWith("../")) return true;
      return href.startsWith("/") && !href.startsWith("//");
    }

    function clean(parent) {
      [...parent.children].forEach((element) => {
        clean(element);
        if (removableTags.has(element.tagName)) {
          element.remove();
          return;
        }
        if (!allowedTags.has(element.tagName)) {
          element.replaceWith(...element.childNodes);
          return;
        }

        [...element.attributes].forEach((attribute) => {
          const name = attribute.name.toLowerCase();
          if (element.tagName === "SPAN" && name === "style") return;
          if (element.tagName === "A" && name === "href" && isSafeLink(attribute.value)) return;
          element.removeAttribute(attribute.name);
        });

        if (element.hasAttribute("style")) {
          Array.from(element.style).forEach((property) => {
            if (!allowedStyleProperties.has(property)) element.style.removeProperty(property);
          });
          if (!element.getAttribute("style")) element.removeAttribute("style");
        }
      });
    }

    clean(template.content);
    return template.innerHTML;
  }

  function disposeTimers() {
    runtime.generation += 1;
    runtime.timers.forEach((timer) => window.clearTimeout(timer));
    runtime.timers = [];
    closeVideoPlayback();
    runtime.audioElements.forEach((audio) => {
      audio.pause();
      audio.currentTime = 0;
    });
    runtime.audioElements = [];
  }

  function playSoundCue(scene, cueId) {
    const cue = (scene?.soundCues || []).find((candidate) => candidate.id === cueId);
    const sound = cue && soundAssetById.get(cue.soundId);
    if (!cue || !sound?.dataUrl || typeof Audio !== "function") return false;
    const audio = new Audio(sound.dataUrl);
    const volume = Number(cue.volumePercent);
    audio.volume = (Number.isFinite(volume) ? Math.max(0, Math.min(100, volume)) : Number(sound.volumePercent) || 100) / 100;
    runtime.audioElements.push(audio);
    audio.play()?.catch(() => {});
    const duration = Number(cue.durationSeconds);
    if (Number.isFinite(duration) && duration > 0) {
      const timer = window.setTimeout(() => {
        audio.pause();
        audio.currentTime = 0;
      }, duration * 1000);
      runtime.timers.push(timer);
    }
    return true;
  }

  function playSceneSounds(scene) {
    (scene.soundCues || [])
      .filter((cue) => !cue.imageLayerId)
      .forEach((cue) => playSoundCue(scene, cue.id));
  }

  function closeVideoPlayback() {
    if (runtime.videoPlaybackTimeout) window.clearTimeout(runtime.videoPlaybackTimeout);
    runtime.videoPlaybackTimeout = null;
    if (videoPlaybackElement) {
      videoPlaybackElement.pause();
      try { videoPlaybackElement.currentTime = 0; } catch {}
    }
    if (videoPlaybackPanel) {
      videoPlaybackPanel.hidden = true;
      videoPlaybackPanel.setAttribute("aria-hidden", "true");
    }
  }

  function playVideoAsset(videoId, { volumePercent = null, durationSeconds = null } = {}) {
    const video = videoAssetById.get(videoId);
    if (!video?.dataUrl || !videoPlaybackPanel || !videoPlaybackElement) return false;
    closeVideoPlayback();
    if (videoPlaybackTitle) videoPlaybackTitle.textContent = video.name || "Vídeo";
    videoPlaybackElement.src = video.dataUrl;
    const requestedVolume = Number(volumePercent);
    const defaultVolume = Number(video.volumePercent);
    const volume = Number.isFinite(requestedVolume)
      ? requestedVolume
      : Number.isFinite(defaultVolume) ? defaultVolume : 100;
    videoPlaybackElement.volume = Math.max(0, Math.min(100, volume)) / 100;
    try { videoPlaybackElement.currentTime = 0; } catch {}
    videoPlaybackPanel.hidden = false;
    videoPlaybackPanel.setAttribute("aria-hidden", "false");
    videoPlaybackElement.play()?.catch(() => setStatus("Pulsa reproducir en el vídeo para iniciar la reproducción."));
    const duration = Number(durationSeconds);
    if (Number.isFinite(duration) && duration > 0) {
      runtime.videoPlaybackTimeout = window.setTimeout(() => {
        videoPlaybackElement.pause();
        runtime.videoPlaybackTimeout = null;
      }, duration * 1000);
    }
    setStatus(`Reproduciendo ${video.name || "vídeo"}.`);
    return true;
  }

  function playVideoCue(scene, cueId) {
    const cue = (scene?.videoCues || []).find((candidate) => candidate.id === cueId);
    if (!cue) return false;
    return playVideoAsset(cue.videoId, {
      volumePercent: cue.volumePercent,
      durationSeconds: cue.durationSeconds,
    });
  }

  function playSceneVideos(scene) {
    const cue = (scene?.videoCues || []).find((candidate) => candidate.playOnStart);
    if (cue) playVideoCue(scene, cue.id);
  }

  function applyTheme(decisions = {}, dialogueStyle = {}) {
    const variables = project.theme?.variables || {};
    const decisionStyle = decisions.style || {};
    const defaults = {
      dialogueBg: "#15131ce8",
      dialogueColor: "#f9f4e7",
      accentColor: "#e7ae54",
      borderColor: "#f2d07c80",
    };
    const cssVariables = {
      dialogueBg: "--dialogue-bg",
      dialogueColor: "--dialogue-color",
      accentColor: "--accent-color",
      borderColor: "--border-color",
    };

    Object.entries(cssVariables).forEach(([key, cssVariable]) => {
      const sceneOverrides = {
        dialogueBg: dialogueStyle.backgroundColor,
        dialogueColor: dialogueStyle.textColor,
        accentColor: dialogueStyle.accentColor,
        borderColor: dialogueStyle.borderColor,
      };
      game.style.setProperty(cssVariable, sceneOverrides[key] || variables[key] || defaults[key]);
    });
    game.style.setProperty("--dialogue-font-family", dialogueStyle.fontFamily || 'Georgia, "Times New Roman", serif');
    game.style.setProperty("--dialogue-font-size", dialogueStyle.fontSizePx ? `${dialogueStyle.fontSizePx}px` : "clamp(0.84rem, 1.6vw, 1.18rem)");
    game.style.setProperty("--choice-bg", decisionStyle.backgroundColor || "#15131c");
    game.style.setProperty("--choice-color", decisionStyle.textColor || "#f9f4e7");
    game.style.setProperty("--choice-accent", decisionStyle.accentColor || "#e7ae54");
    game.style.setProperty("--choice-border", decisionStyle.borderColor || "#f2d07c");
    game.style.setProperty("--choice-font-family", decisionStyle.fontFamily || "inherit");
    game.style.setProperty("--choice-font-size", decisionStyle.fontSizePx ? `${decisionStyle.fontSizePx}px` : "clamp(0.64rem, 1.1vw, 0.88rem)");
    game.style.setProperty("--choice-prompt-color", decisions.promptColor || "#f9f4e7");
    game.style.setProperty("--choice-prompt-size", `${Number(decisions.promptFontSize) || 18}px`);
    customStyle.textContent = [project.theme?.customCss, dialogueStyle.customCss, decisionStyle.customCss].filter(Boolean).join("\n");
  }

  function applyDialogueLayout(dialogueBox, dialogue) {
    const layout = dialogue?.placement || dialogue?.layout || {};
    const x = Number(layout.xPct);
    const y = Number(layout.yPct);
    const width = Number(layout.widthPct);
    const height = Number(layout.heightPct);
    const hasCustomHeight = Number.isFinite(height) && height > 0;
    const hasPosition = Number.isFinite(x) && Number.isFinite(y);
    dialogueBox.style.height = hasCustomHeight ? `${height}%` : "";
    dialogueBox.style.overflow = hasCustomHeight ? "auto" : "";

    if (!hasPosition) {
      dialogueBox.style.left = "6%";
      dialogueBox.style.right = "6%";
      dialogueBox.style.top = "";
      dialogueBox.style.bottom = "17%";
      dialogueBox.style.width = "auto";
      dialogueBox.style.transform = "none";
      return;
    }

    dialogueBox.style.left = `${x}%`;
    dialogueBox.style.top = `${y}%`;
    dialogueBox.style.right = "auto";
    dialogueBox.style.bottom = "auto";
    dialogueBox.style.width = `${Number.isFinite(width) ? width : 88}%`;
    dialogueBox.style.transform = layout.anchor === "top-left" ? "none" : "translate(-50%, -50%)";
  }

  function render(state, scene) {
    const stageWidth = Number(scene.stage?.width) || 1600;
    const stageHeight = Number(scene.stage?.height) || 900;
    const canvasStyle = scene.canvasStyle || {};
    game.style.aspectRatio = `${stageWidth} / ${stageHeight}`;
    stage.style.backgroundColor = canvasStyle.backgroundColor || "#17131b";
  const effectiveBackgroundId = canvasStyle.exceptGlobalBackground
    ? canvasStyle.backgroundImageAssetId
    : (project.canvasBackgroundAllModules ? project.canvasBackgroundImageAssetId : null);
  const backgroundAsset = assetById.get(effectiveBackgroundId);
  if (backgroundAsset?.dataUrl) {
    if (stageBackgroundImage.getAttribute("src") !== backgroundAsset.dataUrl) stageBackgroundImage.src = backgroundAsset.dataUrl;
    stageBackgroundImage.hidden = false;
  } else {
    stageBackgroundImage.removeAttribute("src");
    stageBackgroundImage.hidden = true;
  }
    if (canvasColumnsElement) {
      const columnCount = Math.min(4, Math.max(1, Number(canvasStyle.columns) || 1));
      canvasColumnsElement.style.gridTemplateColumns = `repeat(${columnCount}, minmax(0, 1fr))`;
      const gapPx = Math.min(300, Math.max(0, Number(canvasStyle.gapPx) || 0));
      canvasColumnsElement.style.columnGap = `${(gapPx / stageWidth) * 100}%`;
      const columns = Array.from({ length: columnCount }, (_, index) => {
        const column = document.createElement("div");
        column.className = "canvas-column-guide";
        if (canvasStyle.columnBorders?.[index]) column.classList.add("has-border");
        return column;
      });
      canvasColumnsElement.replaceChildren(...columns);
    }
    applyTheme(state.decisions, scene.dialogueStyle || {});

    const layers = [...state.layers].sort((first, second) => (Number(first.zIndex) || 0) - (Number(second.zIndex) || 0));
    const fragment = document.createDocumentFragment();
    layers.forEach((layer) => {
      if (layer.visible === false) return;
      const asset = assetById.get(layer.assetId);
      if (!asset?.dataUrl) return;
      const element = document.createElement("div");
      element.className = "scene-layer";
      element.style.left = `${Number(layer.xPct) || 0}%`;
      element.style.top = `${Number(layer.yPct) || 0}%`;
      element.style.width = `${Number(layer.widthPct) || 0}%`;
      element.style.zIndex = String(Number(layer.zIndex) || 0);
      element.style.opacity = String(layer.opacity ?? 1);

      const image = new Image();
      image.src = asset.dataUrl;
      image.alt = asset.alt || asset.name || "Imagen de la escena";
      image.draggable = false;
      element.append(image);
      // Esta función se incrusta aislada en el HTML exportado; los iconos deben seguir siendo autocontenidos.
      const objectActions = [
        {
          key: "inventory",
          enabled: layer.inventoryEnabled,
          label: `Añadir ${asset.name || "objeto"} al inventario`,
          icon: '<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="14"/><rect x="9.5" y="7.5" width="13" height="17" rx="1.5"/><path d="M12.5 12h7M12.5 16h7M12.5 20h4"/></svg>',
        },
        {
          key: "character",
          enabled: layer.characterEnabled && (project.playerCharacters || []).some((character) => character.id === layer.characterId),
          label: `Consultar personaje de ${asset.name || "imagen"}`,
          icon: '<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="14"/><path d="M12.4 12a3.8 3.8 0 1 1 6.6 2.6c-1.6 1.5-3 2.1-3 4.4M16 23.1v.1"/></svg>',
        },
        {
          key: "clue",
          enabled: layer.clueEnabled,
          label: `Recoger pista de ${asset.name || "imagen"}`,
          icon: '<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="14"/><circle cx="13.5" cy="13.5" r="5.5"/><path d="m17.5 17.5 6 6"/></svg>',
        },
        {
          key: "map",
          enabled: layer.mapEnabled && Boolean(layer.mapCellKey),
          label: `Descubrir la casilla ${String(layer.mapCellKey || "").replace(":", ", ")}`,
          icon: '<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="14"/><ellipse cx="16" cy="16" rx="6.3" ry="14"/><path d="M2.5 12h27M2.5 20h27"/></svg>',
        },
        ...(scene.soundCues || [])
          .filter((cue) => cue.imageLayerId === layer.id && soundAssetById.has(cue.soundId))
          .map((cue) => ({
            key: "sound",
            cueId: cue.id,
            soundId: cue.soundId,
            enabled: true,
            label: `Reproducir sonido asociado a ${asset.name || "imagen"}`,
            icon: '<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="14"/><path d="M7.5 13h4l5-4v14l-5-4h-4z"/><path d="M20 12a6 6 0 0 1 0 8M22.5 9.5a9.5 9.5 0 0 1 0 13"/></svg>',
          })),
        ...(scene.videoCues || [])
          .filter((cue) => cue.imageLayerId === layer.id && videoAssetById.has(cue.videoId))
          .map((cue) => ({
            key: "video",
            cueId: cue.id,
            videoId: cue.videoId,
            enabled: true,
            label: `Reproducir vídeo asociado a ${asset.name || "imagen"}`,
            icon: '<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="14"/><rect x="7.5" y="10" width="17" height="12" rx="1.5"/><path d="m14 13 5 3-5 3z"/></svg>',
          })),
      ].filter((action) => action.enabled);
      if (objectActions.length) {
        const actionsElement = document.createElement("div");
        actionsElement.className = "object-action-icons is-interactive";
        actionsElement.setAttribute("aria-label", "Acciones del objeto");
        objectActions.forEach((action) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "object-action-icon";
          button.dataset.objectAction = action.key;
          button.setAttribute("aria-label", action.label);
          button.title = action.label;
          button.innerHTML = action.icon;
          button.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            const detail = {
              action: action.key,
              sceneId: scene.id,
              layerId: layer.id,
              assetId: layer.assetId,
              assetName: asset.name || "Objeto",
              unique: Boolean(layer.unique),
              combinableWithLayerIds: [...(layer.combinableWithLayerIds || [])],
              combinableWithResourceIds: [...(layer.combinableWithResourceIds || [])],
              combinationResultAssetId: layer.combinationResultAssetId || null,
              clues: (layer.clues || []).map((clue) => ({ ...clue })),
              mapCellKey: layer.mapCellKey || null,
              characterId: layer.characterId || null,
            };
            if (action.key === "sound") {
              const soundDetail = { ...detail, soundCueId: action.cueId, soundId: action.soundId };
              button.dispatchEvent(new CustomEvent("escena-viva:sound-action", { bubbles: true, detail: soundDetail }));
              playSoundCue(scene, action.cueId);
              setStatus(`Reproduciendo ${soundAssetById.get(action.soundId)?.name || "sonido"}.`);
              return;
            }
            if (action.key === "video") {
              const videoDetail = { ...detail, videoCueId: action.cueId, videoId: action.videoId };
              button.dispatchEvent(new CustomEvent("escena-viva:video-action", { bubbles: true, detail: videoDetail }));
              playVideoCue(scene, action.cueId);
              return;
            }
            if (action.key === "character") {
              showCharacterProfileInfo(layer.characterId, button);
              return;
            }
            button.dispatchEvent(new CustomEvent("escena-viva:object-action", { bubbles: true, detail }));
            if (action.key === "map") {
              const moduleNumber = Number(scene.moduleNumber);
        const targetCell = (project.adventureMap?.cells || [])
          .find((cell) => mapCellKey(cell) === String(layer.mapCellKey || ""));
        if (targetCell && Number.isSafeInteger(moduleNumber) && moduleNumber > 0) targetCell.moduleNumber = moduleNumber;
        const key = targetCell ? mapCellKey(targetCell) : null;
        const wasUnlocked = key ? runtime.unlockedMapCells.has(key) : false;
        if (targetCell) {
          runtime.unlockedMapCells.add(key);
          runtime.mapCellImages.set(key, layer.assetId);
        }
        const coordinates = targetCell ? `${targetCell.row}, ${targetCell.column}` : "";
        const message = !targetCell
                ? "Esta imagen no tiene una casilla del mapa asignada."
          : wasUnlocked
            ? `La ilustración se ha colocado en la casilla ${coordinates}.`
            : `Ilustración colocada en la casilla ${coordinates}; ya puedes viajar a la escena ${moduleNumber}.`;
              button.dispatchEvent(new CustomEvent("escena-viva:map-action", {
                bubbles: true,
          detail: {
            ...detail,
            moduleNumber: moduleNumber || null,
            row: targetCell?.row || null,
            column: targetCell?.column || null,
            coordinates,
            ok: Boolean(targetCell),
          },
              }));
              if (mapPanel && !mapPanel.hidden) renderAdventureMap();
        setStatus(message, !targetCell);
            } else if (action.key === "inventory") {
              const result = runtime.inventory.add(detail.assetId, {
                unique: detail.unique,
                capacity: getInventoryCapacity(),
              });
              const message = inventoryResultMessage(result, detail.assetName);
              showInventoryMessage(message, !result.ok);
              renderInventoryGrid();
              setStatus(message, !result.ok);
            } else if (action.key === "combine") {
              beginStageCombination(layer.id);
            } else {
              collectLayerClues(layer, scene, button);
            }
          });
          actionsElement.append(button);
        });
        element.append(actionsElement);
      }
      fragment.append(element);
    });
    (state.transitions || []).forEach((transition) => {
      const durationMs = Math.max(1, Number(transition.durationMs) || 1);
      const elapsedMs = Math.max(0, performance.now() - (Number(transition.startedAt) || 0));
      if (transition.type === "fade-black" || transition.type === "fade-white") {
        const cover = document.createElement("div");
        cover.className = `scene-transition-cover ${transition.type === "fade-white" ? "is-white" : "is-black"}`;
        cover.style.animationDuration = `${durationMs}ms`;
        cover.style.animationDelay = `-${elapsedMs}ms`;
        fragment.append(cover);
        return;
      }
      const layer = state.layers.find((candidate) => candidate.id === transition.layerId);
      const asset = assetById.get(transition.toAssetId);
      if (!layer || !asset?.dataUrl) return;
      const incoming = document.createElement("div");
      incoming.className = `scene-transition-image ${transition.type === "slide" ? "is-slide" : "is-crossfade"}`;
      incoming.style.left = `${Number(layer.xPct) || 0}%`;
      incoming.style.top = `${Number(layer.yPct) || 0}%`;
      incoming.style.width = `${Number(layer.widthPct) || 0}%`;
      incoming.style.zIndex = String(Number(layer.zIndex) || 0);
      incoming.style.opacity = String(layer.opacity ?? 1);
      const image = new Image();
      image.src = asset.dataUrl;
      image.alt = asset.alt || asset.name || "Imagen entrante";
      image.draggable = false;
      image.style.animationDuration = `${durationMs}ms`;
      image.style.animationDelay = `-${elapsedMs}ms`;
      incoming.append(image);
      fragment.append(incoming);
    });
    layersElement.replaceChildren(fragment);

    const dialogue = state.dialogue || {};
    const dialogueFragment = document.createDocumentFragment();
    (state.dialogues || [state.dialogue || {}]).forEach((dialogue, index) => {
      const dialogueBox = document.createElement("section");
      dialogueBox.className = "dialogue-box";
      dialogueBox.setAttribute("aria-label", `Diálogo ${index + 1}`);
      dialogueBox.hidden = dialogue.visible === false;
      dialogueBox.style.zIndex = String(Number(dialogue.zIndex) || 2);
      dialogueBox.style.backgroundColor = dialogue.backgroundColor || "";
      applyDialogueLayout(dialogueBox, dialogue);

      const speakerElement = document.createElement("p");
      speakerElement.className = "speaker-name";
      speakerElement.textContent = dialogue.speaker || "";
      const textElement = document.createElement("div");
      textElement.className = "dialogue-text";
      textElement.lang = dialogue.text?.lang || "und";
      textElement.dir = dialogue.text?.dir || "auto";
      textElement.innerHTML = sanitizeRichHtml(dialogue.text?.html || "…");
      dialogueBox.append(speakerElement, textElement);
      dialogueFragment.append(dialogueBox);
    });
    dialoguesElement.replaceChildren(dialogueFragment);

    const decisions = state.decisions || {};
    const choicesFragment = document.createDocumentFragment();
    const choices = Array.isArray(decisions.choices) ? decisions.choices : [];
    if (decisions.visible !== false && choices.length > 0) {
      const prompt = document.createElement("p");
      prompt.className = "choice-prompt";
      prompt.textContent = decisions.prompt || "¿Qué decides?";
      prompt.style.fontSize = `${Number(decisions.promptFontSize) || 18}px`;
      prompt.style.color = decisions.promptColor || "#f9f4e7";
      const promptPlacement = decisions.promptPlacement || {};
      prompt.style.left = `${promptPlacement.xPct ?? 50}%`;
      prompt.style.top = `${promptPlacement.yPct ?? 62}%`;
      prompt.style.width = `${promptPlacement.widthPct ?? 88}%`;
      choicesFragment.append(prompt);
      choices.forEach((choice, index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "choice-button";
        const labelHtml = sanitizeRichHtml(choice.labelText?.html || "");
        if (labelHtml) button.innerHTML = labelHtml;
        else button.textContent = choice.label || "Decisión sin texto";
        const placement = choice.placement || {
          xPct: 50,
          yPct: Math.min(94, 74 + index * 8),
          widthPct: 78,
          heightPct: 10,
        };
        button.style.left = `${placement.xPct ?? 50}%`;
        button.style.top = `${placement.yPct ?? 86}%`;
        button.style.width = `${placement.widthPct ?? 78}%`;
        button.style.height = `${placement.heightPct ?? 10}%`;
        button.style.backgroundColor = choice.backgroundColor || "";
        button.addEventListener("click", () => choose(choice));
        choicesFragment.append(button);
      });
    }
    appendQuizPreview(choicesFragment, state);
    appendCombatPreview(choicesFragment, state);
    choicesElement.replaceChildren(choicesFragment);
    choicesElement.hidden = choicesElement.childElementCount === 0;
    if (characterPanel && !characterPanel.hidden) renderPlayerCharacterPanel();
  }

  function applyCue(cue) {
    if (!runtime.state || !runtime.sceneId) return;
    const targetLayer = runtime.state.layers.find((layer) => layer.id === cue.targetLayerId) || runtime.state.layers.at(-1);
    if (cue.assetId && targetLayer && assetById.has(cue.assetId)) startLayerTransition(cue, targetLayer);
    const dialogue = runtime.state.dialogues?.[0] || runtime.state.dialogue;
    if (cue.text && dialogue) dialogue.text = cloneText(cue.text);
    if (cue.speaker && dialogue) dialogue.speaker = cue.speaker;
    if (typeof cue.revealChoices === "boolean") runtime.state.decisions.visible = cue.revealChoices;
    render(runtime.state, sceneById.get(runtime.sceneId));
  }

  function startLayerTransition(cue, layer) {
    const allowedTypes = new Set(["fade-black", "crossfade", "fade-white", "slide"]);
    const type = allowedTypes.has(cue.transitionType) ? cue.transitionType : "cut";
    const durationMs = Math.min(120000, Math.max(0, Number(cue.transitionDurationMs) || 0));
    if (type === "cut" || durationMs === 0 || !assetById.has(cue.assetId)) {
      layer.assetId = cue.assetId;
      return;
    }

    runtime.state.transitions = runtime.state.transitions || [];
    runtime.state.transitions
      .filter((transition) => transition.layerId === layer.id)
      .forEach((transition) => { layer.assetId = transition.toAssetId; });
    runtime.state.transitions = runtime.state.transitions.filter((transition) => transition.layerId !== layer.id);
    const transition = {
      id: cue.id,
      type,
      layerId: layer.id,
      toAssetId: cue.assetId,
      startedAt: performance.now(),
      durationMs,
      swapped: false,
    };
    runtime.state.transitions.push(transition);
    const generation = runtime.generation;
    const isActive = () => generation === runtime.generation
      && runtime.state?.transitions?.some((candidate) => candidate.id === transition.id);

    if (type === "fade-black" || type === "fade-white") {
      const midpoint = window.setTimeout(() => {
        if (!isActive()) return;
        layer.assetId = transition.toAssetId;
        transition.swapped = true;
        render(runtime.state, sceneById.get(runtime.sceneId));
      }, durationMs / 2);
      runtime.timers.push(midpoint);
    }

    const finish = window.setTimeout(() => {
      if (!isActive()) return;
      layer.assetId = transition.toAssetId;
      runtime.state.transitions = runtime.state.transitions.filter((candidate) => candidate.id !== transition.id);
      render(runtime.state, sceneById.get(runtime.sceneId));
    }, durationMs);
    runtime.timers.push(finish);
  }

  function sceneEntryTransitionType(scene) {
    const style = scene?.canvasStyle || {};
    return style.exceptGlobalTransition
      ? style.transitionAnimation
      : project.sceneTransitionAnimation;
  }

  function captureSceneTransitionSnapshot() {
    const snapshot = document.createElement("div");
    snapshot.className = "scene-transition-snapshot";
    snapshot.setAttribute("aria-hidden", "true");
    snapshot.inert = true;
    const stageClone = stage.cloneNode(true);
    stageClone.removeAttribute("id");
    stageClone.classList.add("scene-transition-stage");
    const layersClone = stageClone.querySelector("[id='layers']");
    if (layersClone) layersClone.classList.add("scene-transition-layers");
    [stageClone, dialoguesElement.cloneNode(true), choicesElement.cloneNode(true)].forEach((clone) => {
      clone.removeAttribute("id");
      clone.querySelectorAll("[id]").forEach((element) => element.removeAttribute("id"));
      clone.querySelectorAll("button, input, select, textarea, [tabindex]").forEach((element) => { element.tabIndex = -1; });
      snapshot.append(clone);
    });
    return snapshot;
  }

  function playSceneEntryTransition(scene, snapshot = null) {
    const type = sceneEntryTransitionType(scene);
    stage.querySelectorAll(".scene-entry-transition-cover").forEach((cover) => cover.remove());
    game.querySelectorAll(":scope > .scene-transition-snapshot").forEach((current) => current.remove());
    if (["crossfade", "slide-right"].includes(type)) {
      if (!snapshot) return;
      game.append(snapshot);
      const frames = type === "crossfade"
        ? [{ opacity: 1 }, { opacity: 0 }]
        : [{ transform: "translateX(0)" }, { transform: "translateX(-100%)" }];
      if (typeof snapshot.animate === "function") {
        const animation = snapshot.animate(frames, { duration: 800, easing: "ease-in-out", fill: "forwards" });
        animation.onfinish = () => snapshot.remove();
        return;
      }
      snapshot.style.transition = type === "crossfade" ? "opacity 800ms ease-in-out" : "transform 800ms ease-in-out";
      window.requestAnimationFrame(() => {
        if (type === "crossfade") snapshot.style.opacity = "0";
        else snapshot.style.transform = "translateX(-100%)";
      });
      window.setTimeout(() => snapshot.remove(), 850);
      return;
    }
    if (!["fade-black", "fade-white"].includes(type)) return;
    const cover = document.createElement("div");
    cover.className = `scene-entry-transition-cover ${type === "fade-white" ? "is-white" : "is-black"}`;
    stage.append(cover);
    if (typeof cover.animate === "function") {
      const animation = cover.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 800, easing: "ease-out", fill: "forwards" });
      animation.onfinish = () => cover.remove();
      return;
    }
    cover.style.transition = "opacity 800ms ease-out";
    window.requestAnimationFrame(() => { cover.style.opacity = "0"; });
    window.setTimeout(() => cover.remove(), 850);
  }

  function startScene(sceneId) {
    const scene = sceneById.get(sceneId);
    if (!scene) {
      setStatus("No existe la escena solicitada.", true);
      return;
    }

    const previousScene = runtime.sceneId ? sceneById.get(runtime.sceneId) : null;
    const transitionType = sceneEntryTransitionType(scene);
    const transitionSnapshot = previousScene && previousScene.id !== scene.id
      && ["crossfade", "slide-right"].includes(transitionType)
      ? captureSceneTransitionSnapshot()
      : null;
    if (runtime.sceneId && runtime.sceneId !== scene.id) runtime.character.award(project.characterSheet, "module-completed", runtime.sceneId);
    cancelPendingCombination();
    runtime.pendingQuizId = null;
    disposeTimers();
    runtime.sceneId = scene.id;
    runtime.state = cloneState(scene);
    const generation = runtime.generation;
    render(runtime.state, scene);
    playSceneEntryTransition(scene, transitionSnapshot);
    setStatus(scene.name || "Escena iniciada.");
    playSceneSounds(scene);
    playSceneVideos(scene);

    [...(scene.timedCues || [])]
      .sort((first, second) => (Number(first.atMs) || 0) - (Number(second.atMs) || 0))
      .forEach((cue) => {
        const timer = window.setTimeout(() => {
          if (generation !== runtime.generation) return;
          applyCue(cue);
        }, Math.max(0, Number(cue.atMs) || 0));
        runtime.timers.push(timer);
      });
  }

  function choose(choice) {
    if (choice.targetSceneId && sceneById.has(choice.targetSceneId)) {
      startScene(choice.targetSceneId);
      return;
    }
    setStatus(choice.label ? `Elección registrada: ${choice.label}.` : "Elección registrada.");
  }

  if (!scenes.length) {
    setStatus("Este proyecto no contiene escenas jugables.", true);
    return;
  }

  launchPlayerOnboarding();
}
