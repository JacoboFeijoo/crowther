import {
  DialogueBlock,
  ImageAsset,
  ImageLayer,
  INVENTORY_GRID_PRESETS,
  INVENTORY_HINT_SPACE_PRESETS,
MAP_GRID_MAX_SIZE,
MAP_GRID_PRESETS,
  Project,
  CombatChallenge,
  EventChallenge,
  QuizChallenge,
  RichTextBlock,
  SceneModule,
SoundAsset,
  TimedCue,
  clamp,
  createId,
  normalizeInventoryGrid,
  normalizeInventoryHintCapacity,
normalizeAdventureMap,
combatAttributesFromImage,
  normalizeFontFamily,
  createBlankProject,
  VideoAsset,
  projectHasAuthoredContent,
  sanitizeRichHtml,
} from "./model.js?v=2026-11-12-05";
import { ScenePlayer } from "./player.js?v=2026-11-12-03";
import { appendInventoryAttributeInfo, CombinationRules } from "./inventory.js?v=2026-11-12-01";
import { ProjectRepository, ProjectTemplateRepository } from "./storage.js?v=2026-11-12-14";
import { QuillRichTextEditor } from "./rich-text.js?v=2026-11-12-11";
import { readProjectWorkspace, writeProjectWorkspace } from "./workspace-state.js?v=2026-11-10-10";
import { fitMapCellImageFrame } from "./playable-runtime.js?v=2026-11-12-04";

class EditorStore {
  constructor(project) {
    this.project = project;
    this.listeners = new Set();
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify() {
    this.listeners.forEach((listener) => listener(this.project));
  }

  replace(project) {
    this.project = project;
    this.notify();
  }
}

const THEME_BINDINGS = {
  dialogueBg: { css: "--dialogue-bg" },
  dialogueColor: { css: "--dialogue-color" },
  accentColor: { css: "--accent-color" },
  borderColor: { css: "--border-color" },
};

const LAYER_POSITION_MIN = -1000;
const LAYER_POSITION_MAX = 1100;
const LAYER_WIDTH_MIN = 0.5;
const LAYER_WIDTH_MAX = 10000;
const WELCOME_DISMISSED_KEY = "crowther-welcome-dismissed-v1";
const RESIZE_CORNERS = {
  nw: { x: -1, y: -1, label: "Redimensionar desde la esquina superior izquierda" },
  ne: { x: 1, y: -1, label: "Redimensionar desde la esquina superior derecha" },
  sw: { x: -1, y: 1, label: "Redimensionar desde la esquina inferior izquierda" },
  se: { x: 1, y: 1, label: "Redimensionar desde la esquina inferior derecha" },
};
const COMBAT_ATTRIBUTE_SUGGESTIONS = ["Inteligencia", "Reflejos", "Fuerza", "Magia", "Resistencia", "Destreza", "Robo", "Sigilo"];

function normalizedCombatAttribute(value) {
  return String(value || "").trim().normalize("NFKC").toLocaleLowerCase();
}

function isCanvasDeleteKey(event) {
  return ["Delete", "Del", "Supr", "Backspace"].includes(event?.key)
    || ["Delete", "Del", "Backspace"].includes(event?.code)
    || [46, 127].includes(event?.keyCode);
}

function readPlayerCombatProfile(project, fallbackHealth = 10, character = null) {
  const sheet = project?.characterSheet || project?.playerCharacterSheet || project?.playerCharacter || {};
  const rawStats = sheet.attributes || sheet.stats || sheet.characteristics || {};
  const attributes = new Map();
  if (Array.isArray(rawStats)) {
    rawStats.forEach((entry) => attributes.set(normalizedCombatAttribute(entry?.name), (character?.value?.(entry?.id) ?? Number(entry?.initialValue ?? entry?.value)) || 0));
  } else if (rawStats && typeof rawStats === "object") {
    Object.entries(rawStats).forEach(([name, value]) => attributes.set(normalizedCombatAttribute(name), Number(value?.value ?? value) || 0));
  }
  const health = Array.isArray(rawStats) ? rawStats.find((entry) => normalizedCombatAttribute(entry?.name) === "vida") : null;
  const currentHealth = health ? character?.value?.(health.id) : null;
  const maxHealth = Number(sheet.maxHealth ?? sheet.healthMax ?? sheet.vidaMaxima ?? health?.initialValue);
  return {
    name: String(character?.name || sheet.name || sheet.characterName || "Jugador"),
    attributes,
    maxHealth: Number.isFinite(currentHealth) && currentHealth >= 0 ? currentHealth : Number.isFinite(maxHealth) && maxHealth > 0 ? maxHealth : Math.max(1, Number(fallbackHealth) || 10),
  };
}

function combatInputField(label, name, value, { type = "number", min, max, step = "1", placeholder = "" } = {}) {
  const field = document.createElement("label");
  field.className = "quiz-field";
  const heading = document.createElement("span");
  heading.textContent = label;
  const input = document.createElement("input");
  input.type = type;
  input.dataset.combatField = name;
  if (min != null) input.min = String(min);
  if (max != null) input.max = String(max);
  if (step != null) input.step = String(step);
  if (placeholder) input.placeholder = placeholder;
  input.value = String(value ?? "");
  field.append(heading, input);
  return field;
}

function combatSelectField(label, name, options, selectedValue = "") {
  const field = document.createElement("label");
  field.className = "quiz-field";
  const heading = document.createElement("span");
  heading.textContent = label;
  const select = document.createElement("select");
  select.className = "quiz-select";
  select.dataset.combatField = name;
  options.forEach(({ value, label: optionLabel }) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = optionLabel;
    select.append(option);
  });
  select.value = String(selectedValue ?? "");
  field.append(heading, select);
  return field;
}

function scopedCss(css = "") {
  const root = "#game-preview";
  return css
    .replace(/&/g, root)
    .replace(/(^|})\s*([^@}{][^{]*)\{/g, (match, boundary, selectors) => {
      const scopedSelectors = selectors
        .split(",")
        .map((selector) => selector.trim())
        .filter(Boolean)
        .map((selector) => (selector.startsWith(root) ? selector : `${root} ${selector}`))
        .join(", ");
      return `${boundary}\n${scopedSelectors} {`;
    });
}

function slugify(value) {
  return String(value || "escena-viva")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || "escena-viva";
}

function escapeMarkup(value = "") {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function setNativeInputValue(input, value) {
  input.value = value ?? "";
}

function createQuizRichTextField(label, name) {
  const field = document.createElement("div");
  field.className = "quiz-rich-field";
  const heading = document.createElement("span");
  heading.textContent = label;
  const toolbar = document.createElement("div");
  toolbar.className = "rich-toolbar quiz-rich-toolbar ql-toolbar ql-snow";
  toolbar.setAttribute("aria-label", `Formato de ${label.toLocaleLowerCase("es")}`);
  toolbar.innerHTML = '<span class="ql-formats"><button class="ql-bold" type="button" aria-label="Negrita"></button><button class="ql-italic" type="button" aria-label="Cursiva"></button><button class="ql-underline" type="button" aria-label="Subrayado"></button><button class="ql-background" type="button" value="#f7d471" aria-label="Resaltar"></button></span><span class="ql-formats"><button class="ql-list" type="button" value="bullet" aria-label="Lista con viñetas"></button><button class="ql-list" type="button" value="ordered" aria-label="Lista numerada"></button><button class="ql-link" type="button" aria-label="Enlace"></button><button class="ql-clean" type="button" aria-label="Quitar formato"></button></span>';
  const editor = document.createElement("div");
  editor.className = "rich-editor quiz-rich-editor";
  editor.dataset.quizEditor = name;
  editor.setAttribute("aria-label", label);
  field.append(heading, toolbar, editor);
  return { field, toolbar, editor };
}

function createQuizSelectField(label, name, options, selectedValue = "") {
  const field = document.createElement("label");
  field.className = "quiz-field full-field";
  const heading = document.createElement("span");
  heading.textContent = label;
  const select = document.createElement("select");
  select.className = "quiz-select";
  select.dataset.quizField = name;
  options.forEach(({ value, label: optionLabel }) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = optionLabel;
    select.append(option);
  });
  select.value = selectedValue || "";
  field.append(heading, select);
  return field;
}

/** Controlador de editor: mantiene el modelo fuera del DOM y actualiza la vista. */
export class InteractiveFictionEditor {
  constructor(project) {
    this.store = new EditorStore(project);
    const workspace = readProjectWorkspace(project, project.startSceneId || project.scenes[0]?.id || null);
    this.activeSceneId = workspace.activeSceneId;
    this.selectedLayerId = this.scene?.stage.layers[0]?.id ?? null;
    this.selectedDialogueId = this.scene?.dialogues[0]?.id ?? null;
    this.dialogueEditorExpanded = true;
    this.openSceneIds = workspace.openSceneIds;
    this.selectedLayerBySceneId = new Map(this.activeSceneId ? [[this.activeSceneId, this.selectedLayerId]] : []);
    this.selectedDialogueBySceneId = new Map(this.activeSceneId ? [[this.activeSceneId, this.selectedDialogueId]] : []);
    this.selectedTreeNodeId = project.getModuleReferenceForScene(this.activeSceneId)?.id ?? "main";
    this.expandedFolderIds = new Set(["main"]);
    this.expandedDecisionIdsBySceneId = new Map();
    this.expandedQuizIdsBySceneId = new Map();
    this.expandedCombatIdsBySceneId = new Map();
    this.expandedEventIdsBySceneId = new Map();
    this.expandedCharacterIds = new Set();
    this.collapsedResourceCueIds = new Set();
    this.hintOverlayReturnFocus = null;
    this.isPreviewing = false;
    this.drag = null;
    this.draggedModuleTabId = null;
    this.draggedToolTabId = null;
    this.draggedResource = null;
    this.pendingResourceTransfer = null;
    this.pendingCombination = null;
this.selectedMapCellIndex = 0;
    this.mapCellArtResizeObserver = null;
    this.dialogueDrag = null;
    this.selectedChoiceId = null;
    this.toolContextAttentionTimer = null;
    this.pendingSceneTransitionSnapshot = null;
    this.selectedQuizBox = null;
    this.quizDrag = null;
    this.selectedCombatBoxId = null;
    this.combatDrag = null;
    this.quizRichTextEditors = new Map();
    this.pendingQuizAnswerId = null;
    this.choiceDrag = null;
    this.choiceRichTextEditors = new Map();
    this.moduleGraph = null;
    this.moduleGraphView = null;
    this.expandedGraphNodeIds = new Set();
    this.graphNodeControlLayer = null;
    this.graphNodeControls = new Map();
    this.assetPageSize = 4;
    this.assetPage = 0;
this.selectedSoundIdsBySceneId = new Map();
    this.selectedVideoIdsBySceneId = new Map();
    this.videoPlaybackTimeout = null;
    this.dialogueAlignmentRestore = new Map();
    this.workspacePanelState = { explorer: false, authoring: false };
    this.autoSaveTimer = null;
    this.dom = {};
    this.player = this.createPlayer();
  }

  get project() {
    return this.store.project;
  }

  get scene() {
    return this.project.getScene(this.activeSceneId) || this.project.scenes[0] || null;
  }

  get activeDialogue() {
    return this.scene?.getDialogue(this.selectedDialogueId) || this.scene?.dialogue || null;
  }

  getDialogueElement(dialogueId = this.selectedDialogueId) {
    return [...(this.dom.dialogueLayer?.children || [])].find((element) => element.dataset.dialogueId === dialogueId) || null;
  }

  createPlayer() {
    return new ScenePlayer(this.project, {
      onRender: (state) => this.renderPreview(state),
      onStatus: (message) => this.setPlaybackStatus(message),
      onBeforeSceneStart: (scene, previousScene) => {
        this.pendingSceneTransitionSnapshot = this.captureSceneTransitionSnapshot(scene, previousScene);
      },
      onSceneStart: (scene) => {
        this.playSceneEntryTransition(scene);
        this.playSceneVideos(scene);
        this.renderMapPanel();
      },
    });
  }

  playSceneEntryTransition(scene) {
    const style = scene?.canvasStyle || {};
    const type = style.exceptGlobalTransition
      ? style.transitionAnimation
      : this.project?.sceneTransitionAnimation;
    if (!this.isPreviewing || !this.dom.stage) return;
    this.dom.stage.querySelectorAll(".scene-entry-transition-cover").forEach((cover) => cover.remove());
    this.dom.gamePreview?.querySelectorAll(":scope > .scene-transition-snapshot").forEach((snapshot) => snapshot.remove());
    const snapshot = this.pendingSceneTransitionSnapshot;
    this.pendingSceneTransitionSnapshot = null;
    if (["crossfade", "slide-right"].includes(type)) {
      if (!snapshot) return;
      this.dom.gamePreview.append(snapshot);
      this.animateSceneTransitionSnapshot(snapshot, type);
      return;
    }
    if (!["fade-black", "fade-white"].includes(type)) return;
    const cover = document.createElement("div");
    cover.className = `scene-entry-transition-cover ${type === "fade-white" ? "is-white" : "is-black"}`;
    this.dom.stage.append(cover);
    if (typeof cover.animate === "function") {
      const animation = cover.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 800, easing: "ease-out", fill: "forwards" });
      animation.onfinish = () => cover.remove();
      return;
    }
    cover.style.transition = "opacity 800ms ease-out";
    window.requestAnimationFrame(() => { cover.style.opacity = "0"; });
    window.setTimeout(() => cover.remove(), 850);
  }

  captureSceneTransitionSnapshot(scene, previousScene) {
    const style = scene?.canvasStyle || {};
    const type = style.exceptGlobalTransition ? style.transitionAnimation : this.project?.sceneTransitionAnimation;
    if (!this.isPreviewing || !previousScene || previousScene.id === scene?.id || !["crossfade", "slide-right"].includes(type)) return null;

    const snapshot = document.createElement("div");
    snapshot.className = `${this.dom.gamePreview?.className || "game-preview is-playing"} scene-transition-snapshot`;
    snapshot.setAttribute("aria-hidden", "true");
    snapshot.inert = true;
    snapshot.style.position = "absolute";
    snapshot.style.inset = "0";
    snapshot.style.zIndex = "100000";
    snapshot.style.overflow = "hidden";
    snapshot.style.pointerEvents = "none";
    [this.dom.stage, this.dom.choicePreview].filter(Boolean).forEach((source) => {
      const clone = source.cloneNode(true);
      clone.removeAttribute("id");
      clone.querySelectorAll("[id]").forEach((element) => element.removeAttribute("id"));
      clone.querySelectorAll("button, input, select, textarea, [tabindex]").forEach((element) => { element.tabIndex = -1; });
      snapshot.append(clone);
    });
    return snapshot;
  }

  animateSceneTransitionSnapshot(snapshot, type) {
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
  }

  init() {
    this.cacheDom();
    this.setupRichTextEditors();
    this.bindEvents();
    if (typeof ResizeObserver === "function") {
      this.canvasResizeObserver = new ResizeObserver(() => {
        this.fitCanvasToViewport();
        if (!this.isPreviewing) this.renderPreview();
      });
      this.canvasResizeObserver.observe(this.dom.canvasColumn);
    }
    this.fitCanvasToViewport();
    this.store.subscribe(() => {
      if (!this.isPreviewing) this.renderPreview();
      this.applyTheme();
      this.renderStatistics();
    });
    this.hydrateEditors();
    this.renderAll();
    void this.renderTemplates();
    this.restoreSidebarSections();
    this.restoreWorkspacePanels();
    window.requestAnimationFrame(() => this.updateToolTabsPagination());
    this.showWelcomeIfNeeded();
  }

  cacheDom() {
    const byId = (id) => document.getElementById(id);
    this.dom = {
      workspace: byId("workspace"),
      canvasColumn: document.querySelector(".canvas-column"),
      canvasHeading: document.querySelector(".canvas-heading"),
      moduleTabsStrip: document.querySelector(".module-tabs-strip"),
      canvasFooter: document.querySelector(".canvas-footer"),
      sceneNotesToolbar: byId("scene-notes-toolbar"),
      sceneNotesEditor: byId("scene-notes-editor"),
      projectNotesToolbar: byId("project-notes-toolbar"),
      projectNotesEditor: byId("project-notes-editor"),
      gamePreview: byId("game-preview"),
      workspacePanelToggles: Array.from(document.querySelectorAll("[data-workspace-panel-toggle]")),
      saveStatus: byId("save-status"),
      newProjectButton: byId("new-project-button"),
      newProjectDialog: byId("new-project-dialog"),
      previewButton: byId("preview-button"),
      exportButton: byId("export-button"),
      exportWebButton: byId("export-web-button"),
      templateName: byId("template-name"),
      templateSave: byId("template-save"),
      templateSelect: byId("template-select"),
      templateLoad: byId("template-load"),
      templateDownload: byId("template-download"),
      templateDelete: byId("template-delete"),
      templateStatus: byId("template-status"),
      webExportDialog: byId("web-export-dialog"),
      resourceTransferDialog: byId("resource-transfer-dialog"),
      resourceTransferMessage: byId("resource-transfer-message"),
      importInput: byId("import-input"),
      moduleTree: byId("module-tree"),
      moduleTabs: byId("module-tabs"),
      moduleTabsPrev: byId("module-tabs-prev"),
      moduleTabsNext: byId("module-tabs-next"),
      toolTabs: byId("tool-tabs"),
      toolTabsPrev: byId("tool-tabs-prev"),
      toolTabsNext: byId("tool-tabs-next"),
      newFolder: byId("new-folder"),
      moduleGraph: byId("module-graph"),
      graphSectionContent: byId("graph-section-content"),
      resourcesSectionContent: byId("resources-section-content"),
      graphZoomOut: byId("graph-zoom-out"),
      graphZoomIn: byId("graph-zoom-in"),
      graphFit: byId("graph-fit"),
      graphPrint: byId("graph-print"),
      graphExpand: byId("graph-expand"),
      graphExportSvg: byId("graph-export-svg"),
      statisticsSelect: byId("statistics-select"),
      statisticsChart: byId("statistics-chart"),
      statisticsSummary: byId("statistics-summary"),
      aboutButton: byId("about-button"),
      aboutDialog: byId("about-dialog"),
      welcomeDialog: byId("welcome-dialog"),
      welcomeDoNotShow: byId("welcome-do-not-show"),
      welcomeCloseButton: byId("welcome-close-button"),
      characterAttributeName: byId("character-attribute-name"),
      characterAttributeInitial: byId("character-attribute-initial"),
      addCharacterAttribute: byId("add-character-attribute"),
      characterAttributeList: byId("character-attribute-list"),
      characterDistributablePoints: byId("character-distributable-points"),
      addCharacterProgression: byId("add-character-progression"),
      characterProgressionList: byId("character-progression-list"),
      characterList: byId("character-list"),
      addPlayerCharacter: byId("character-add-button"),
      characterSetupDialog: byId("character-setup-dialog"),
      characterSetupForm: byId("character-setup-form"),
      playerCharacterName: byId("player-character-name"),
      characterSetupPoints: byId("character-setup-points"),
      characterSetupAttributes: byId("character-setup-attributes"),
      assetInput: byId("asset-input"),
      assetDropZone: byId("asset-drop-zone"),
      soundCueList: byId("sound-cue-list"),
      addSoundCue: byId("add-sound-cue"),
      videoCueList: byId("video-cue-list"),
      addVideoCue: byId("add-video-cue"),
      objectLayerSelect: byId("object-layer-select"),
      objectAttributeSelect: byId("object-attribute-select"),
      objectAttributeValue: byId("object-attribute-value"),
      addObjectAttributeValue: byId("add-object-attribute-value"),
      objectAttributeList: byId("object-attribute-list"),
      objectInventoryEnabled: byId("object-inventory-enabled"),
      objectCombinableEnabled: byId("object-combinable-enabled"),
      objectUniqueEnabled: byId("object-unique-enabled"),
      objectCharacterEnabled: byId("object-character-enabled"),
      objectCharacterLinkField: byId("object-character-link-field"),
      objectCharacterLink: byId("object-character-link"),
      objectCompatibility: byId("object-compatibility"),
      objectCompatibilityList: byId("object-compatibility-list"),
      objectCombinationResult: byId("object-combination-result"),
      objectAttributeName: byId("object-attribute-name"),
      addObjectAttribute: byId("add-object-attribute"),
      objectAttributeDefinitionList: byId("object-attribute-definition-list"),
      hintLayerSelect: byId("hint-layer-select"),
      hintEnabled: byId("hint-enabled"),
      hintTextList: byId("hint-text-list"),
      addHintText: byId("add-hint-text"),
mapLayerSelect: byId("map-layer-select"),
mapLayerEnabled: byId("map-layer-enabled"),
mapLayerCellSelect: byId("map-layer-cell"),
      inventoryToggle: byId("inventory-toggle"),
      characterToggle: byId("character-toggle"),
      characterPanel: byId("character-panel"),
      characterPanelHeading: byId("character-panel-heading"),
      characterPanelContent: byId("character-panel-content"),
      characterPanelClose: byId("character-panel-close"),
      inventoryPanel: byId("inventory-panel"),
      inventoryPanelClose: byId("inventory-panel-close"),
      inventoryItems: byId("inventory-items"),
      inventoryPanelSummary: byId("inventory-panel-summary"),
      inventoryMessage: byId("inventory-message"),
      pencilToggle: byId("pencil-toggle"),
      pencilPanel: byId("pencil-panel"),
      pencilPanelClose: byId("pencil-panel-close"),
      pencilMessage: byId("pencil-message"),
      mapToggle: byId("map-toggle"),
      mapPanel: byId("map-panel"),
mapPanelClose: byId("map-panel-close"),
mapPanelArtwork: byId("map-panel-artwork"),
mapPanelImage: byId("map-panel-image"),
mapPanelGrid: byId("map-panel-grid"),
mapPanelMessage: byId("map-panel-message"),
      videoPlaybackPanel: byId("video-playback-panel"),
      videoPlaybackTitle: byId("video-playback-title"),
      videoPlaybackElement: byId("video-playback-element"),
      videoPlaybackClose: byId("video-playback-close"),
inventoryGridSelect: byId("inventory-grid-select"),
inventoryGridSummary: byId("inventory-grid-summary"),
inventoryGridBoard: byId("inventory-grid-board"),
mapGridSize: byId("map-grid-size"),
mapGridSummary: byId("map-grid-summary"),
mapGridBoard: byId("map-grid-board"),
mapCellCoordinate: byId("map-cell-coordinate"),
mapCellModuleNumber: byId("map-cell-module-number"),
mapCellTargetStatus: byId("map-cell-target-status"),
mapCellInitiallyUnlocked: byId("map-cell-initially-unlocked"),
mapImageSelect: byId("map-image-select"),
      inventoryHintCapacity: byId("inventory-hint-capacity"),
      inventoryHintSummary: byId("inventory-hint-summary"),
      inventoryHintsBoard: byId("inventory-hints-board"),
      pencilPanelHints: byId("pencil-panel-hints"),
      hintOverlay: byId("hint-overlay"),
      hintOverlayHeading: byId("hint-overlay-heading"),
      hintOverlayContent: byId("hint-overlay-content"),
      hintOverlayClose: byId("hint-overlay-close"),
      inventoryNotesToolbar: byId("inventory-notes-toolbar"),
      inventoryNotesEditor: byId("inventory-notes-editor"),
      pencilPanelNotesToolbar: byId("pencil-panel-notes-toolbar"),
      pencilPanelNotesEditor: byId("pencil-panel-notes-editor"),
      assetList: byId("asset-list"),
      assetModuleTabs: byId("asset-module-tabs"),
      assetCount: byId("asset-count"),
      assetPageSize: byId("asset-page-size"),
      assetPagePrev: byId("asset-page-prev"),
      assetPageNext: byId("asset-page-next"),
      assetPageStatus: byId("asset-page-status"),
      selectedLayerName: byId("selected-layer-name"),
      layerX: byId("layer-x"),
      layerY: byId("layer-y"),
      layerWidth: byId("layer-width"),
      layerAlt: byId("layer-alt"),
      layerNaturalSize: byId("layer-natural-size"),
      layerFitStage: byId("layer-fit-stage"),
      gamePreview: byId("game-preview"),
      stage: byId("stage-editor"),
      stageBackground: byId("stage-background"),
      stageLayers: byId("stage-layers"),
      stageColumns: byId("stage-columns"),
      canvasBackgroundColor: byId("canvas-background-color"),
      canvasBackgroundImage: byId("canvas-background-image"),
      projectBackgroundImage: byId("project-background-image"),
      canvasBackgroundAllModules: byId("canvas-background-all-modules"),
      canvasBackgroundException: byId("canvas-background-exception"),
      projectSceneTransition: byId("project-scene-transition"),
      sceneTransitionAnimation: byId("scene-transition-animation"),
      sceneTransitionException: byId("scene-transition-exception"),
      canvasColumnCount: byId("canvas-column-count"),
      canvasColumnGap: byId("canvas-column-gap"),
      canvasColumnBorders: byId("canvas-column-borders"),
      dialogueLayer: byId("dialogue-layer"),
      alignmentGuides: byId("alignment-guides"),
      choicePreview: byId("choice-preview"),
      speakerInput: byId("speaker-input"),
      speakerControl: byId("speaker-control"),
      speakerDropdownButton: byId("speaker-dropdown-button"),
      speakerOptions: byId("speaker-options"),
      languageInput: byId("language-input"),
      languageCustomField: byId("language-custom-field"),
      languageCustomInput: byId("language-custom-input"),
      dialogueCenterHorizontal: byId("dialogue-center-horizontal"),
      dialogueCenterVertical: byId("dialogue-center-vertical"),
      dialogueToolbar: byId("dialogue-toolbar"),
      dialogueEditor: byId("dialogue-editor"),
      dialogueAuthoringFields: byId("dialogue-authoring-fields"),
      dialogueEmptyState: byId("dialogue-empty-state"),
      dialogueCardList: byId("dialogue-card-list"),
      dialogueZIndex: byId("dialogue-z-index"),
      addDialogue: byId("add-dialogue"),
      decisionPrompt: byId("decision-prompt"),
      decisionPromptSize: byId("decision-prompt-size"),
      decisionPromptColor: byId("decision-prompt-color"),
      decisionStyleBg: byId("decision-style-bg"),
      decisionStyleBgMode: byId("decision-style-bg-mode"),
      decisionStyleText: byId("decision-style-text"),
      decisionStyleAccent: byId("decision-style-accent"),
      decisionStyleBorder: byId("decision-style-border"),
      decisionCustomCss: byId("decision-custom-css"),
      decisionFontFamily: byId("decision-font-family"),
      decisionFontFamilyCustomField: byId("decision-font-family-custom-field"),
      decisionFontFamilyCustom: byId("decision-font-family-custom"),
      decisionFontSize: byId("decision-font-size"),
      sceneFinalCheckbox: byId("scene-final-checkbox"),
      sceneFinalType: byId("scene-final-type"),
      dialogueStyleBg: byId("dialogue-style-bg"),
      dialogueStyleBgMode: byId("dialogue-style-bg-mode"),
      dialogueStyleText: byId("dialogue-style-text"),
      dialogueStyleAccent: byId("dialogue-style-accent"),
      dialogueStyleBorder: byId("dialogue-style-border"),
      dialogueCustomCss: byId("dialogue-custom-css"),
      dialogueFontFamily: byId("dialogue-font-family"),
      dialogueFontFamilyCustomField: byId("dialogue-font-family-custom-field"),
      dialogueFontFamilyCustom: byId("dialogue-font-family-custom"),
      dialogueFontSize: byId("dialogue-font-size"),
      choiceList: byId("choice-list"),
      addChoice: byId("add-choice"),
      quizList: byId("quiz-list"),
      addQuiz: byId("quiz-add-button"),
      combatList: byId("combat-list"),
      addCombat: byId("combat-add-button"),
      eventList: byId("event-list"),
      addEvent: byId("event-add-button"),
      cueList: byId("cue-list"),
      addCue: byId("add-cue"),
      customCssPreview: byId("custom-css-preview"),
      accessibilityStatus: byId("accessibility-status"),
      tabs: Array.from(document.querySelectorAll("[data-tab]")),
      tabPanels: Array.from(document.querySelectorAll("[data-panel]")),
      sidebarToggles: Array.from(document.querySelectorAll("[data-sidebar-toggle]")),
    };
  }

  setupRichTextEditors() {
    this.dialogueRichText = new QuillRichTextEditor(this.dom.dialogueEditor, this.dom.dialogueToolbar, {
      placeholder: "Escribe el diálogo de esta caja…",
      ariaLabel: "Texto del diálogo",
    });
    this.sceneNotesRichText = new QuillRichTextEditor(this.dom.sceneNotesEditor, this.dom.sceneNotesToolbar, {
      placeholder: "Notas privadas para esta escena…",
      ariaLabel: "Notas de esta escena",
    });
    this.projectNotesRichText = new QuillRichTextEditor(this.dom.projectNotesEditor, this.dom.projectNotesToolbar, {
      placeholder: "Notas generales del proyecto…",
      ariaLabel: "Notas del proyecto",
    });
    this.inventoryNotesRichText = new QuillRichTextEditor(this.dom.inventoryNotesEditor, this.dom.inventoryNotesToolbar, {
      placeholder: "Escribe notas durante la partida…",
      ariaLabel: "Notas libres del jugador",
    });
    this.pencilPanelNotesRichText = new QuillRichTextEditor(this.dom.pencilPanelNotesEditor, this.dom.pencilPanelNotesToolbar, {
      placeholder: "Escribe notas durante la partida…",
      ariaLabel: "Notas libres del jugador",
    });
    this.setInventoryNotesEnabled(this.isPreviewing);

    this.dialogueRichText.onChange((html) => {
      if (!this.activeDialogue) return;
      this.activeDialogue.text.html = html;
      this.markDirty();
    });
    this.sceneNotesRichText.onChange((html) => {
      if (!this.scene) return;
      this.scene.notes.html = html;
      this.markDirty();
    });
    this.projectNotesRichText.onChange((html) => {
      this.project.notes.html = html;
      this.markDirty();
    });
    this.inventoryNotesRichText.onChange((html) => this.syncInventoryPlayerNotes(this.inventoryNotesRichText, html));
    this.pencilPanelNotesRichText.onChange((html) => this.syncInventoryPlayerNotes(this.pencilPanelNotesRichText, html));
  }

  syncInventoryPlayerNotes(source, html = "") {
    if (!this.isPreviewing) return;
    this.player.inventory.setNotes(html);
    const other = source === this.inventoryNotesRichText
      ? this.pencilPanelNotesRichText
      : this.inventoryNotesRichText;
    if (other.getHtml() !== html) other.setHtml(html);
  }

  setInventoryNotesEnabled(enabled, html = "") {
    [this.inventoryNotesRichText, this.pencilPanelNotesRichText].forEach((editor) => {
      if (!editor) return;
      editor.setHtml(html);
      editor.setEnabled(enabled);
    });
  }

  bindEvents() {
    document.getElementById("panel-tool-resources")?.addEventListener("dblclick", (event) => {
      const heading = event.target.closest("[data-rename-resource-section]");
      if (!heading || this.isPreviewing) return;
      this.beginResourceSectionRename(heading, heading.dataset.renameResourceSection);
    });
    this.dom.speakerInput.addEventListener("input", () => {
      if (!this.activeDialogue) return;
      this.activeDialogue.speaker = this.dom.speakerInput.value;
      this.renderSpeakerOptions();
      this.markDirty();
    });
    this.dom.speakerInput.addEventListener("change", () => this.commitSpeakerInput());
    this.dom.speakerInput.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        this.setSpeakerOptionsOpen(true);
        this.dom.speakerOptions.querySelector("[data-speaker-option]")?.focus();
      } else if (event.key === "Escape") {
        this.setSpeakerOptionsOpen(false);
      } else if (event.key === "Enter") {
        event.preventDefault();
        this.commitSpeakerInput();
        this.setSpeakerOptionsOpen(false);
      }
    });
    this.dom.speakerDropdownButton.addEventListener("click", () => {
      const shouldOpen = this.dom.speakerOptions.hidden;
      if (shouldOpen) this.renderSpeakerOptions();
      this.setSpeakerOptionsOpen(shouldOpen);
    });
    this.dom.speakerOptions.addEventListener("pointerdown", (event) => event.preventDefault());
    this.dom.speakerOptions.addEventListener("click", (event) => {
      const removeButton = event.target.closest("[data-remove-speaker]");
      if (removeButton) {
        event.stopPropagation();
        this.removeSpeakerFromList(removeButton.dataset.removeSpeaker);
        return;
      }
      const option = event.target.closest("[data-speaker-option]");
      if (!option || !this.activeDialogue) return;
      this.dom.speakerInput.value = option.dataset.speakerOption;
      this.activeDialogue.speaker = option.dataset.speakerOption;
      this.project.addCharacter(option.dataset.speakerOption);
      this.renderSpeakerOptions();
      this.setSpeakerOptionsOpen(false);
      this.markDirty();
    });
    this.dom.speakerOptions.addEventListener("keydown", (event) => {
      const options = [...this.dom.speakerOptions.querySelectorAll("[data-speaker-option]")];
      const currentIndex = options.indexOf(document.activeElement);
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        const nextIndex = Math.min(options.length - 1, Math.max(0, currentIndex + step));
        options[nextIndex]?.focus();
      } else if (event.key === "Escape") {
        event.preventDefault();
        this.setSpeakerOptionsOpen(false);
        this.dom.speakerInput.focus();
      } else if (event.key === "Enter" && currentIndex >= 0) {
        event.preventDefault();
        options[currentIndex].click();
        this.dom.speakerInput.focus();
      }
    });
    document.addEventListener("click", (event) => {
      if (!event.target.closest("#speaker-control")) this.setSpeakerOptionsOpen(false);
    });

    document.addEventListener("click", (event) => {
      if (event.target.closest(".combat-character-control")) return;
      this.dom.combatList?.querySelectorAll(".combat-character-control").forEach((control) => this.setCombatCharacterOptionsOpen(control, false));
    });

    this.dom.languageInput.addEventListener("change", () => this.updateDialogueLanguage());
    this.dom.languageCustomInput.addEventListener("input", () => {
      if (this.dom.languageInput.value === "custom") this.updateDialogueLanguage();
    });

    this.dom.canvasBackgroundColor.addEventListener("input", () => {
      if (!this.scene) return;
      this.scene.canvasStyle.backgroundColor = this.dom.canvasBackgroundColor.value;
      this.renderCanvasStyle();
      this.markDirty();
    });
    this.dom.projectBackgroundImage?.addEventListener("change", () => {
      if (!this.project) return;
      this.project.canvasBackgroundImageAssetId = this.dom.projectBackgroundImage.value || null;
      this.renderCanvasStyle();
      this.renderCanvasBackgroundOptions();
      this.markDirty("Imagen de fondo general actualizada.");
    });
    this.dom.canvasBackgroundImage?.addEventListener("change", () => {
      if (!this.scene) return;
      this.scene.canvasStyle.backgroundImageAssetId = this.dom.canvasBackgroundImage.value || null;
      this.renderCanvasStyle();
      this.renderCanvasBackgroundOptions();
      this.markDirty("Fondo específico de la escena actualizado.");
    });
    this.dom.canvasBackgroundAllModules?.addEventListener("change", () => {
      if (!this.project) return;
      this.project.canvasBackgroundAllModules = this.dom.canvasBackgroundAllModules.checked;
      this.renderCanvasStyle();
      this.renderCanvasBackgroundOptions();
      this.markDirty(this.project.canvasBackgroundAllModules
        ? "Fondo general aplicado a todas las escenas."
        : "Fondo general desactivado.");
    });
    this.dom.canvasBackgroundException?.addEventListener("change", () => {
      if (!this.scene) return;
      this.scene.canvasStyle.exceptGlobalBackground = this.dom.canvasBackgroundException.checked;
      if (this.scene.canvasStyle.exceptGlobalBackground && !this.scene.canvasStyle.backgroundImageAssetId) {
        this.scene.canvasStyle.backgroundImageAssetId = this.project.canvasBackgroundImageAssetId || null;
      }
      this.renderCanvasStyle();
      this.renderCanvasBackgroundOptions();
      this.markDirty(this.scene.canvasStyle.exceptGlobalBackground
        ? "Excepción de fondo activada para esta escena."
        : "Esta escena vuelve a usar el fondo general.");
    });
    this.dom.projectSceneTransition?.addEventListener("change", () => {
      if (!this.project) return;
      this.project.sceneTransitionAnimation = this.dom.projectSceneTransition.value;
      this.renderCanvasStyle();
      this.markDirty("Animación general de entrada actualizada.");
    });
    this.dom.sceneTransitionException?.addEventListener("change", () => {
      if (!this.scene) return;
      this.scene.canvasStyle.exceptGlobalTransition = this.dom.sceneTransitionException.checked;
      if (this.scene.canvasStyle.exceptGlobalTransition && this.scene.canvasStyle.transitionAnimation === "none") {
        this.scene.canvasStyle.transitionAnimation = this.project.sceneTransitionAnimation || "none";
      }
      this.renderCanvasStyle();
      this.markDirty(this.scene.canvasStyle.exceptGlobalTransition
        ? "Excepción de animación activada para esta escena."
        : "Esta escena vuelve a usar la animación general.");
    });
    this.dom.sceneTransitionAnimation?.addEventListener("change", () => {
      if (!this.scene) return;
      this.scene.canvasStyle.transitionAnimation = this.dom.sceneTransitionAnimation.value;
      this.markDirty("Animación de entrada de la escena actualizada.");
    });
    this.dom.canvasColumnCount.addEventListener("change", () => {
      if (!this.scene) return;
      this.scene.canvasStyle.columns = Number(this.dom.canvasColumnCount.value) || 1;
      this.renderCanvasColumnBorders();
      this.renderCanvasStyle();
      this.markDirty();
    });
    this.dom.canvasColumnGap.addEventListener("input", () => {
      if (!this.scene) return;
      const gap = Number(this.dom.canvasColumnGap.value);
      this.scene.canvasStyle.gapPx = Number.isFinite(gap) ? Math.min(300, Math.max(0, Math.round(gap))) : 0;
      this.dom.canvasColumnGap.value = String(this.scene.canvasStyle.gapPx);
      this.renderCanvasStyle();
      this.markDirty();
    });
    this.dom.canvasColumnBorders.addEventListener("change", (event) => {
      const checkbox = event.target.closest("[data-canvas-column-border]");
      if (!checkbox || !this.scene) return;
      const index = Number(checkbox.dataset.canvasColumnBorder);
      if (!Number.isInteger(index) || index < 0 || index > 3) return;
      this.scene.canvasStyle.columnBorders[index] = checkbox.checked;
      this.renderCanvasStyle();
      this.markDirty();
    });

    this.dom.decisionPrompt.addEventListener("input", () => {
      this.scene.decisions.prompt = this.dom.decisionPrompt.value;
      this.markDirty();
    });
    [
      this.dom.decisionPromptSize,
      this.dom.decisionPromptColor,
      this.dom.decisionStyleBg,
      this.dom.decisionStyleBgMode,
      this.dom.decisionStyleText,
      this.dom.decisionStyleAccent,
      this.dom.decisionStyleBorder,
      this.dom.decisionCustomCss,
    ].forEach((input) => {
      input.addEventListener(input === this.dom.decisionCustomCss ? "input" : "change", () => this.updateDecisionStyle(input));
    });
    [this.dom.decisionFontFamily, this.dom.decisionFontFamilyCustom, this.dom.decisionFontSize].forEach((input) => {
      input.addEventListener(input === this.dom.decisionFontFamily || input === this.dom.decisionFontSize ? "change" : "input", () => this.updateTypography("decision", input));
    });
    [
      this.dom.dialogueStyleBg,
      this.dom.dialogueStyleText,
      this.dom.dialogueStyleAccent,
      this.dom.dialogueStyleBorder,
      this.dom.dialogueCustomCss,
    ].forEach((input) => {
      input.addEventListener(input === this.dom.dialogueCustomCss ? "input" : "change", () => this.updateDialogueStyle(input));
    });
    this.dom.dialogueStyleBgMode?.addEventListener("change", () => this.updateDialogueStyle(this.dom.dialogueStyleBgMode));
    [this.dom.dialogueFontFamily, this.dom.dialogueFontFamilyCustom, this.dom.dialogueFontSize].forEach((input) => {
      input.addEventListener(input === this.dom.dialogueFontFamily || input === this.dom.dialogueFontSize ? "change" : "input", () => this.updateTypography("dialogue", input));
    });

    this.dom.sceneFinalCheckbox.addEventListener("change", () => {
      if (!this.scene) return;
      this.scene.isFinal = this.dom.sceneFinalCheckbox.checked;
      this.dom.sceneFinalType.disabled = !this.scene.isFinal;
      this.renderModuleGraph();
this.renderStatistics();
      this.markDirty(this.scene.isFinal ? "Escena marcada como final." : "Escena final desactivada.");
    });
    this.dom.sceneFinalType.addEventListener("change", () => {
      if (!this.scene?.isFinal) return;
      this.scene.finalType = this.dom.sceneFinalType.value;
this.renderStatistics();
      this.markDirty();
    });

    this.dom.addChoice.addEventListener("click", () => {
      const choice = this.scene.decisions.addChoice({ label: "Nueva decisión" });
      this.selectedChoiceId = choice.id;
      this.expandedDecisionIdsBySceneId.set(this.scene.id, new Set([choice.id]));
      this.renderChoiceList();
      this.renderPreview();
      this.markDirty("Decisión añadida.");
    });

    this.dom.addQuiz?.addEventListener("click", () => {
      if (!this.scene) return;
      const challenge = new QuizChallenge();
      this.scene.quizChallenges.push(challenge);
      this.expandedQuizIdsBySceneId.set(this.scene.id, new Set([challenge.id]));
      this.renderQuizEditor();
      this.renderPreview();
      this.markDirty("Reto de Quiz añadido.");
    });
    this.dom.addCombat?.addEventListener("click", () => {
      if (!this.scene) return;
      const challenge = new CombatChallenge();
      this.scene.combatChallenges.push(challenge);
      this.placeNewCombat(challenge);
      this.expandedCombatIdsBySceneId.set(this.scene.id, new Set([`${challenge.id}:combat`, `${challenge.id}:conditions`]));
      this.renderCombatEditor();
      this.renderPreview();
      this.markDirty("Combate añadido.");
    });
    this.dom.combatList?.addEventListener("input", (event) => this.updateCombatControl(event, false));
    this.dom.combatList?.addEventListener("change", (event) => this.updateCombatControl(event, true));
    this.dom.combatList?.addEventListener("pointerdown", (event) => {
      if (event.target.closest(".combat-character-control .speaker-options")) event.preventDefault();
    });
    this.dom.combatList?.addEventListener("keydown", (event) => {
      const input = event.target.closest('[data-combat-field="enemyName"]');
      if (input) {
        const control = input.closest(".combat-character-control");
        const options = control?.querySelector(".speaker-options");
        if (event.key === "ArrowDown") {
          event.preventDefault();
          this.renderCombatCharacterOptions(options, input.value);
          this.setCombatCharacterOptionsOpen(control, true);
          options?.querySelector("[data-combat-character-option]")?.focus();
        } else if (event.key === "Escape") {
          this.setCombatCharacterOptionsOpen(control, false);
        } else if (event.key === "Enter") {
          event.preventDefault();
          const card = input.closest("[data-combat-id]");
          const challenge = this.scene?.combatChallenges.find((item) => item.id === card?.dataset.combatId);
          if (challenge) {
            challenge.enemyName = input.value.trim() || "Enemigo";
            this.project.addCharacter(challenge.enemyName);
            this.renderCombatCharacterOptions(options, challenge.enemyName);
            this.setCombatCharacterOptionsOpen(control, false);
            this.renderPreview();
            this.markDirty();
          }
        }
        return;
      }
      const optionsContainer = event.target.closest(".combat-character-control .speaker-options");
      if (!optionsContainer) return;
      const options = [...optionsContainer.querySelectorAll("[data-combat-character-option]")];
      const currentIndex = options.indexOf(document.activeElement);
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        options[Math.min(options.length - 1, Math.max(0, currentIndex + step))]?.focus();
      } else if (event.key === "Escape") {
        event.preventDefault();
        const control = optionsContainer.closest(".combat-character-control");
        this.setCombatCharacterOptionsOpen(control, false);
        control?.querySelector('[data-combat-field="enemyName"]')?.focus();
      } else if (event.key === "Enter" && currentIndex >= 0) {
        event.preventDefault();
        options[currentIndex].click();
      }
    });
    this.dom.combatList?.addEventListener("dblclick", (event) => {
      const title = event.target.closest("[data-rename-combat-title]");
      if (!title || !this.scene) return;
      const card = title.closest("[data-combat-id]");
      const index = this.scene.combatChallenges.findIndex((item) => item.id === card?.dataset.combatId);
      if (index >= 0) this.beginChallengeTitleRename(title, "combat", this.scene.combatChallenges[index], index);
    });
    this.dom.combatList?.addEventListener("click", (event) => {
      const characterToggle = event.target.closest("[data-combat-character-toggle]");
      if (characterToggle) {
        const control = characterToggle.closest(".combat-character-control");
        const options = control?.querySelector(".speaker-options");
        const shouldOpen = Boolean(options?.hidden);
        if (shouldOpen) {
          const input = control.querySelector('[data-combat-field="enemyName"]');
          this.renderCombatCharacterOptions(options, input?.value || "");
        }
        this.setCombatCharacterOptionsOpen(control, shouldOpen);
        return;
      }
      const characterOption = event.target.closest("[data-combat-character-option]");
      if (characterOption && this.scene) {
        const card = characterOption.closest("[data-combat-id]");
        const challenge = this.scene.combatChallenges.find((item) => item.id === card?.dataset.combatId);
        if (!challenge) return;
        challenge.enemyName = characterOption.dataset.combatCharacterOption;
        this.project.addCharacter(challenge.enemyName);
        this.renderCombatEditor();
        this.renderPreview();
        this.markDirty();
        return;
      }
      const removeCharacter = event.target.closest("[data-remove-combat-character]");
      if (removeCharacter) {
        const name = removeCharacter.dataset.removeCombatCharacter;
        const normalized = String(name || "").toLocaleLowerCase();
        this.project.characters = this.project.characters.filter((character) => character.toLocaleLowerCase() !== normalized);
        this.renderSpeakerOptions();
        this.renderCombatEditor();
        this.markDirty(`«${name}» se quitó de la lista de personajes.`);
        return;
      }
      const toggle = event.target.closest("[data-toggle-combat]");
      const card = event.target.closest("[data-combat-id]");
      if (toggle && card && this.scene) {
        const combatId = card.dataset.combatId;
        const expandedIds = this.expandedCombatIdsBySceneId.get(this.scene.id) || new Set();
        const sectionKey = `${combatId}:${card.dataset.combatSection || "combat"}`;
        if (expandedIds.has(sectionKey)) expandedIds.delete(sectionKey);
        else expandedIds.add(sectionKey);
        this.expandedCombatIdsBySceneId.set(this.scene.id, expandedIds);
        const expanded = expandedIds.has(sectionKey);
        const content = card.querySelector(".combat-card-content");
        card.classList.toggle("is-collapsed", !expanded);
        if (content) content.hidden = !expanded;
        toggle.textContent = expanded ? "▾" : "▸";
        toggle.setAttribute("aria-expanded", String(expanded));
        toggle.setAttribute("aria-label", `${expanded ? "Plegar" : "Desplegar"} combate`);
        return;
      }
      const addAttribute = event.target.closest("[data-add-combat-attribute]");
      if (addAttribute && card && this.scene) {
        const challenge = this.scene.combatChallenges.find((item) => item.id === card.dataset.combatId);
        if (!challenge) return;
        challenge.attributes.push({ name: "Nuevo atributo", enemyValue: 0 });
        this.renderCombatEditor();
        this.renderPreview();
        this.markDirty("Atributo añadido al combate.");
        return;
      }
      const addRoundEffect = event.target.closest("[data-add-combat-round-effect]");
      if (addRoundEffect && card && this.scene) {
        const challenge = this.scene.combatChallenges.find((item) => item.id === card.dataset.combatId);
        const firstAttribute = this.project.characterSheet.attributes[0];
        if (!challenge || !firstAttribute) return;
        challenge.roundAttributeEffects.push({ attributeId: firstAttribute.id, onWin: 0, onLoss: 0 });
        this.renderCombatEditor();
        this.markDirty("Cambio de atributo por ronda añadido.");
        return;
      }
      const removeRoundEffect = event.target.closest("[data-remove-combat-round-effect]");
      if (removeRoundEffect && card && this.scene) {
        const challenge = this.scene.combatChallenges.find((item) => item.id === card.dataset.combatId);
        const index = Number(removeRoundEffect.dataset.removeCombatRoundEffect);
        if (!challenge || !Number.isInteger(index)) return;
        challenge.roundAttributeEffects.splice(index, 1);
        this.renderCombatEditor();
        this.markDirty("Cambio de atributo por ronda eliminado.");
        return;
      }
      const removeAttribute = event.target.closest("[data-remove-combat-attribute]");
      if (removeAttribute && card && this.scene) {
        const challenge = this.scene.combatChallenges.find((item) => item.id === card.dataset.combatId);
        const index = Number(removeAttribute.dataset.removeCombatAttribute);
        if (!challenge || !Number.isInteger(index) || challenge.attributes.length <= 1) return;
        const [removed] = challenge.attributes.splice(index, 1);
        if (challenge.comparisonAttribute === removed.name) challenge.comparisonAttribute = challenge.attributes[0]?.name || "Fuerza";
        [challenge.victoryCondition.playerTerms, challenge.victoryCondition.enemyTerms].forEach((terms) => terms.forEach((term) => {
          if (term.attribute === removed.name) term.attribute = challenge.attributes[0]?.name || "Fuerza";
        }));
        this.renderCombatEditor();
        this.renderPreview();
        this.markDirty("Atributo eliminado del combate.");
        return;
      }
      const addTerm = event.target.closest("[data-add-condition-term]");
      if (addTerm && card && this.scene) {
        const challenge = this.scene.combatChallenges.find((item) => item.id === card.dataset.combatId);
        if (!challenge) return;
        const side = addTerm.dataset.addConditionTerm === "playerTerms" ? "playerTerms" : "enemyTerms";
        const defaultSource = side === "playerTerms" ? "playerAttribute" : "enemyAttribute";
        challenge.victoryCondition[side].push({ source: defaultSource, attribute: challenge.attributes[0]?.name || "Fuerza", value: 0, operator: "+" });
        this.renderCombatEditor();
        this.markDirty("Término de condición añadido.");
        return;
      }
      const removeTerm = event.target.closest("[data-remove-condition-term]");
      if (removeTerm && card && this.scene) {
        const challenge = this.scene.combatChallenges.find((item) => item.id === card.dataset.combatId);
        const side = removeTerm.dataset.conditionSide === "playerTerms" ? "playerTerms" : "enemyTerms";
        const index = Number(removeTerm.dataset.removeConditionTerm);
        if (!challenge || challenge.victoryCondition[side].length <= 1 || !Number.isInteger(index)) return;
        challenge.victoryCondition[side].splice(index, 1);
        this.renderCombatEditor();
        this.renderPreview();
        this.markDirty("Término de condición eliminado.");
        return;
      }
      const remove = event.target.closest("[data-remove-combat]");
      if (!remove || !card || !this.scene) return;
      const challengeId = card.dataset.combatId;
      const index = this.scene.combatChallenges.findIndex((item) => item.id === challengeId);
      if (index < 0) return;
      this.scene.combatChallenges.splice(index, 1);
      this.expandedCombatIdsBySceneId.get(this.scene.id)?.delete(`${challengeId}:combat`);
      this.expandedCombatIdsBySceneId.get(this.scene.id)?.delete(`${challengeId}:conditions`);
      if (this.selectedCombatBoxId === challengeId) this.clearSelectedCombatBox();
      this.renderCombatEditor();
      this.renderPreview();
      this.markDirty("Combate eliminado.");
    });
    this.dom.addEvent?.addEventListener("click", () => {
      if (!this.scene) return;
      const playerAttribute = this.project.characterSheet.attributes[0];
      const eventAttribute = this.project.objectAttributeDefinitions[0];
      const challenge = new EventChallenge({
        conditions: playerAttribute && eventAttribute
          ? [{ playerAttributeId: playerAttribute.id, eventAttributeId: eventAttribute.id, comparator: ">=", modifier: 0 }]
          : [],
      });
      this.scene.eventChallenges.push(challenge);
      this.expandedEventIdsBySceneId.set(this.scene.id, new Set([`${challenge.id}:event`, `${challenge.id}:conditions`]));
      this.renderEventEditor();
      this.markDirty("Evento añadido.");
    });
    this.dom.eventList?.addEventListener("input", (event) => this.updateEventControl(event, false));
    this.dom.eventList?.addEventListener("change", (event) => this.updateEventControl(event, true));
    this.dom.eventList?.addEventListener("dblclick", (event) => {
      const title = event.target.closest("[data-rename-event-title]");
      if (!title || !this.scene) return;
      const card = title.closest("[data-event-id]");
      const index = this.scene.eventChallenges.findIndex((item) => item.id === card?.dataset.eventId);
      if (index >= 0) this.beginChallengeTitleRename(title, "event", this.scene.eventChallenges[index], index);
    });
    this.dom.eventList?.addEventListener("click", (event) => {
      const card = event.target.closest("[data-event-id]");
      if (event.target.closest("[data-toggle-event]") && card && this.scene) {
        const challenge = this.scene.eventChallenges.find((item) => item.id === card.dataset.eventId);
        if (!challenge) return;
        const expandedIds = this.expandedEventIdsBySceneId.get(this.scene.id) || new Set();
        const sectionKey = `${challenge.id}:${card.dataset.eventSection || "event"}`;
        if (expandedIds.has(sectionKey)) expandedIds.delete(sectionKey);
        else expandedIds.add(sectionKey);
        this.expandedEventIdsBySceneId.set(this.scene.id, expandedIds);
        const expanded = expandedIds.has(sectionKey);
        card.classList.toggle("is-collapsed", !expanded);
        const content = card.querySelector(".event-card-content");
        if (content) content.hidden = !expanded;
        const toggle = card.querySelector("[data-toggle-event]");
        toggle.textContent = expanded ? "▾" : "▸";
        toggle.setAttribute("aria-expanded", String(expanded));
        return;
      }
      const addCondition = event.target.closest("[data-add-event-condition]");
      if (addCondition && card && this.scene) {
        const challenge = this.scene.eventChallenges.find((item) => item.id === card.dataset.eventId);
        const playerAttribute = this.project.characterSheet.attributes[0];
        const eventAttribute = this.project.objectAttributeDefinitions[0];
        if (!challenge || !playerAttribute || !eventAttribute) return;
        challenge.conditions.push({
          id: createId("event-condition"),
          playerAttributeId: playerAttribute.id,
          comparator: ">=",
          eventAttributeId: eventAttribute.id,
          modifier: 0,
        });
        this.renderEventEditor();
        this.markDirty("Condición del evento añadida.");
        return;
      }
      const removeCondition = event.target.closest("[data-remove-event-condition]");
      if (removeCondition && card && this.scene) {
        const challenge = this.scene.eventChallenges.find((item) => item.id === card.dataset.eventId);
        const conditionIndex = Number(removeCondition.dataset.removeEventCondition);
        if (!challenge || !Number.isInteger(conditionIndex)) return;
        challenge.conditions.splice(conditionIndex, 1);
        this.renderEventEditor();
        this.markDirty("Condición del evento eliminada.");
        return;
      }
      const remove = event.target.closest("[data-remove-event]");
      if (!remove || !card || !this.scene) return;
      const eventId = card.dataset.eventId;
      const index = this.scene.eventChallenges.findIndex((item) => item.id === eventId);
      if (index < 0) return;
      this.scene.eventChallenges.splice(index, 1);
      this.expandedEventIdsBySceneId.get(this.scene.id)?.delete(`${eventId}:event`);
      this.expandedEventIdsBySceneId.get(this.scene.id)?.delete(`${eventId}:conditions`);
      this.renderEventEditor();
      this.markDirty("Evento eliminado.");
    });
    this.dom.quizList?.addEventListener("input", (event) => this.updateQuizControl(event, false));
    this.dom.quizList?.addEventListener("change", (event) => this.updateQuizControl(event, true));
    this.dom.quizList?.addEventListener("dblclick", (event) => {
      const title = event.target.closest("[data-rename-quiz-title]");
      if (!title || !this.scene) return;
      const card = title.closest("[data-quiz-id]");
      const index = this.scene.quizChallenges.findIndex((item) => item.id === card?.dataset.quizId);
      if (index >= 0) this.beginChallengeTitleRename(title, "quiz", this.scene.quizChallenges[index], index);
    });
    this.dom.quizList?.addEventListener("click", (event) => {
      const toggleButton = event.target.closest("[data-toggle-quiz]");
      if (toggleButton && this.scene) {
        const card = toggleButton.closest("[data-quiz-id]");
        const quizId = card?.dataset.quizId;
        if (!quizId) return;
        const expandedIds = this.expandedQuizIdsBySceneId.get(this.scene.id) || new Set();
        if (expandedIds.has(quizId)) expandedIds.delete(quizId);
        else expandedIds.add(quizId);
        this.expandedQuizIdsBySceneId.set(this.scene.id, expandedIds);
        const expanded = expandedIds.has(quizId);
        const index = this.scene.quizChallenges.findIndex((challenge) => challenge.id === quizId);
        const label = `reto ${index + 1}`;
        const content = card.querySelector(".quiz-card-content");
        card.classList.toggle("is-collapsed", !expanded);
        if (content) content.hidden = !expanded;
        toggleButton.textContent = expanded ? "▾" : "▸";
        toggleButton.setAttribute("aria-expanded", String(expanded));
        toggleButton.setAttribute("aria-label", `${expanded ? "Plegar" : "Desplegar"} ${label}`);
        toggleButton.title = `${expanded ? "Plegar" : "Desplegar"} ${label}`;
        return;
      }

      const removeButton = event.target.closest("[data-remove-quiz]");
      if (!removeButton || !this.scene) return;
      const card = removeButton.closest("[data-quiz-id]");
      const index = this.scene.quizChallenges.findIndex((challenge) => challenge.id === card?.dataset.quizId);
      if (index < 0) return;
      this.scene.quizChallenges.splice(index, 1);
      const expandedIds = this.expandedQuizIdsBySceneId.get(this.scene.id) || new Set();
      expandedIds.delete(card.dataset.quizId);
      if (!expandedIds.size && this.scene.quizChallenges[0]) expandedIds.add(this.scene.quizChallenges[0].id);
      this.expandedQuizIdsBySceneId.set(this.scene.id, expandedIds);
      if (this.selectedQuizBox?.quizId === card.dataset.quizId) this.clearSelectedQuizBox();
      this.quizRichTextEditors.delete(`${card.dataset.quizId}:question`);
      this.quizRichTextEditors.delete(`${card.dataset.quizId}:outcome`);
      this.quizRichTextEditors.delete(`${card.dataset.quizId}:incorrectOutcome`);
      this.renderQuizEditor();
      this.renderPreview();
      this.markDirty("Reto de Quiz eliminado.");
    });

    this.dom.choiceList.addEventListener("change", (event) => this.updateChoice(event));
    this.dom.choiceList.addEventListener("dblclick", (event) => {
      const title = event.target.closest("[data-rename-choice-title]");
      if (!title || !this.scene) return;
      const card = title.closest("[data-choice-id]");
      const index = this.scene.decisions.choices.findIndex((item) => item.id === card?.dataset.choiceId);
      if (index >= 0) this.beginChallengeTitleRename(title, "decision", this.scene.decisions.choices[index], index);
    });
    this.dom.choiceList.addEventListener("click", (event) => {
      const toggle = event.target.closest("[data-toggle-choice]");
      if (toggle) {
        this.toggleDecisionSection(toggle);
        return;
      }
      this.removeChoice(event);
    });

    this.dom.addDialogue.addEventListener("click", () => this.addDialogue());
    this.dom.dialogueCardList.addEventListener("click", (event) => {
      const removeButton = event.target.closest("[data-remove-dialogue]");
      if (removeButton && !this.isPreviewing) {
        this.selectedDialogueId = removeButton.dataset.dialogueId;
        this.selectedDialogueBySceneId.set(this.activeSceneId, this.selectedDialogueId);
        this.removeDialogue();
        return;
      }
      const toggle = event.target.closest("[data-toggle-dialogue]");
      if (!toggle || this.isPreviewing) return;
      const dialogueId = toggle.dataset.dialogueId;
      if (dialogueId === this.selectedDialogueId) {
        this.dialogueEditorExpanded = !this.dialogueEditorExpanded;
        this.renderDialogueCards();
        return;
      }
      this.selectedDialogueId = dialogueId;
      this.selectedDialogueBySceneId.set(this.activeSceneId, dialogueId);
      this.selectedLayerId = null;
      this.selectedLayerBySceneId.set(this.activeSceneId, null);
      this.dialogueEditorExpanded = true;
      this.hydrateDialogueEditors();
      this.renderInspector();
      this.renderPreview();
    });
    this.dom.dialogueCardList.addEventListener("dblclick", (event) => {
      const title = event.target.closest("[data-rename-dialogue-title]");
      if (!title || !this.scene || this.isPreviewing) return;
      const card = title.closest("[data-dialogue-id]");
      const index = this.scene.dialogues.findIndex((item) => item.id === card?.dataset.dialogueId);
      if (index >= 0) this.beginChallengeTitleRename(title, "dialogue", this.scene.dialogues[index], index);
    });

    this.dom.addCue.addEventListener("click", () => {
      const firstLayerId = this.scene.stage.layers[0]?.id ?? null;
      const dialogue = this.activeDialogue;
      this.scene.timedCues.push(
        new TimedCue({
          atMs: 3000,
          targetLayerId: this.selectedLayerId || firstLayerId,
          transitionType: "fade-black",
          transitionDurationMs: 1200,
          speaker: dialogue?.speaker || "",
          text: new RichTextBlock({ html: "Escribe el texto que aparecerá después…", lang: dialogue?.text.lang || "und" }),
        }),
      );
      this.renderCueList();
      this.markDirty("Cambio temporizado añadido.");
    });

    this.dom.cueList.addEventListener("input", (event) => this.updateCue(event));
    this.dom.cueList.addEventListener("change", (event) => this.changeCue(event));
    this.dom.cueList.addEventListener("click", (event) => this.removeCue(event));
    this.dom.cueList.addEventListener("dblclick", (event) => this.renameResourceCueFromEvent(event, "timed"));

    this.dom.previewButton.addEventListener("click", () => this.togglePreview());
    this.dom.inventoryToggle?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const open = Boolean(this.dom.inventoryPanel?.hidden);
      if (open) this.renderInventoryGrid();
      if (this.dom.inventoryPanel) {
        this.dom.inventoryPanel.hidden = !open;
        this.dom.inventoryPanel.setAttribute("aria-hidden", String(!open));
      }
      this.dom.inventoryToggle.setAttribute("aria-expanded", String(open));
      this.dom.inventoryToggle.setAttribute("aria-label", open ? "Cerrar inventario" : "Abrir inventario");
      this.dom.inventoryToggle.title = open ? "Cerrar inventario" : "Abrir inventario";
      const detail = { projectId: this.project.id, sceneId: this.activeSceneId, open };
      this.dom.inventoryToggle.dispatchEvent(new CustomEvent("escena-viva:inventory-toggle", { bubbles: true, detail }));
      this.dom.inventoryToggle.dispatchEvent(new CustomEvent(open ? "escena-viva:inventory-open" : "escena-viva:inventory-close", { bubbles: true, detail }));
      this.setPlaybackStatus(open ? "Inventario abierto." : "Inventario cerrado.");
    });
    this.dom.inventoryPanelClose?.addEventListener("click", () => this.dom.inventoryToggle?.click());
    this.dom.characterToggle?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.toggleCharacterPanel();
    });
    this.dom.characterPanelClose?.addEventListener("click", () => this.toggleCharacterPanel(false));
    this.dom.hintOverlayClose?.addEventListener("click", () => this.closeHintOverlay());
    this.dom.hintOverlay?.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      this.closeHintOverlay();
    });
    this.dom.pencilToggle?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const open = Boolean(this.dom.pencilPanel?.hidden);
      if (open) this.renderInventoryHints();
      if (this.dom.pencilPanel) {
        this.dom.pencilPanel.hidden = !open;
        this.dom.pencilPanel.setAttribute("aria-hidden", String(!open));
      }
      this.dom.pencilToggle.setAttribute("aria-expanded", String(open));
      this.dom.pencilToggle.setAttribute("aria-label", open ? "Cerrar pistas y notas" : "Abrir pistas y notas");
      this.dom.pencilToggle.title = open ? "Cerrar pistas y notas" : "Abrir pistas y notas";
      const detail = { projectId: this.project.id, sceneId: this.activeSceneId, open };
      this.dom.pencilToggle.dispatchEvent(new CustomEvent("escena-viva:pencil-toggle", { bubbles: true, detail }));
      this.setPlaybackStatus(open ? "Pistas y notas abiertas." : "Pistas y notas cerradas.");
    });
    this.dom.pencilPanelClose?.addEventListener("click", () => this.dom.pencilToggle?.click());
    this.dom.mapToggle?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const open = Boolean(this.dom.mapPanel?.hidden);
        if (open) this.renderMapPanel();
      if (this.dom.mapPanel) {
        this.dom.mapPanel.hidden = !open;
        this.dom.mapPanel.setAttribute("aria-hidden", String(!open));
      }
      this.dom.mapToggle.setAttribute("aria-expanded", String(open));
      this.dom.mapToggle.setAttribute("aria-label", open ? "Cerrar mapa" : "Abrir mapa");
      this.dom.mapToggle.title = open ? "Cerrar mapa" : "Abrir mapa";
      this.closeVideoPlayback();
      const detail = { projectId: this.project.id, sceneId: this.activeSceneId, open };
      this.dom.mapToggle.dispatchEvent(new CustomEvent("escena-viva:map-toggle", { bubbles: true, detail }));
    });
      this.ensureMapCellNoteEditor();
      this.dom.mapPanelClose?.addEventListener("click", () => this.dom.mapToggle?.click());
      this.dom.mapPanelGrid?.addEventListener("click", (event) => {
        if (this.handleMapCellNoteAction(event)) return;
        const destination = event.target.closest("[data-map-target-scene]");
        if (!destination || destination.disabled || !this.isPreviewing) return;
        event.preventDefault();
        this.player.start(destination.dataset.mapTargetScene);
      });
      this.dom.mapGridSize?.addEventListener("change", () => this.updateAdventureMapSize());
      this.dom.mapGridBoard?.addEventListener("click", (event) => {
        const cell = event.target.closest("[data-map-cell-index]");
        if (!cell || this.isPreviewing) return;
        this.selectedMapCellIndex = Number(cell.dataset.mapCellIndex) || 0;
        this.renderAdventureMapEditor();
      });
      this.dom.mapCellModuleNumber?.addEventListener("change", () => this.updateAdventureMapCell());
      this.dom.mapCellInitiallyUnlocked?.addEventListener("change", () => this.updateAdventureMapCell());
      this.dom.mapImageSelect?.addEventListener("change", () => this.updateAdventureMapImage());
      this.dom.mapLayerSelect?.addEventListener("change", () => this.selectMapLayer());
      this.dom.mapLayerEnabled?.addEventListener("change", () => this.updateSelectedMapEnabled());
      this.dom.mapLayerCellSelect?.addEventListener("change", () => this.assignSelectedMapCell());
    this.dom.inventoryItems?.addEventListener("click", (event) => this.handleInventoryGridClick(event));
    this.dom.exportButton.addEventListener("click", () => this.exportProject());
    this.dom.newProjectButton?.addEventListener("click", () => this.requestNewProject());
    this.dom.newProjectDialog?.addEventListener("click", (event) => {
      const action = event.target.closest("[data-new-project-action]")?.dataset.newProjectAction;
      if (!action) return;
      this.dom.newProjectDialog.close();
      if (action === "cancel") return;
      void this.createNewProject(action === "save");
    });
    this.dom.exportWebButton?.addEventListener("click", () => this.openWebExportOptions());
    this.dom.webExportDialog?.addEventListener("click", (event) => this.handleWebExportChoice(event));
    this.dom.resourceTransferDialog?.addEventListener("click", (event) => this.handleResourceTransferAction(event));
    this.dom.resourceTransferDialog?.addEventListener("cancel", () => { this.pendingResourceTransfer = null; });
    this.dom.resourceTransferDialog?.addEventListener("close", () => { this.pendingResourceTransfer = null; });
    this.dom.importInput.addEventListener("change", (event) => this.importProject(event));
    this.dom.templateSave?.addEventListener("click", () => this.saveTemplate());
    this.dom.templateSelect?.addEventListener("change", () => this.updateTemplateActions());
    this.dom.templateLoad?.addEventListener("click", () => this.loadTemplate());
    this.dom.templateDownload?.addEventListener("click", () => this.downloadTemplatePackage());
    this.dom.templateDelete?.addEventListener("click", () => this.deleteTemplate());

    this.dom.newFolder?.addEventListener("click", () => this.createFolder());
    this.dom.moduleTree?.addEventListener("click", (event) => this.handleModuleTreeClick(event));
    this.dom.moduleTree?.addEventListener("dragstart", (event) => this.beginModuleDrag(event));
    this.dom.moduleTree?.addEventListener("dragover", (event) => this.allowModuleDrop(event));
    this.dom.moduleTree?.addEventListener("dragleave", (event) => this.clearModuleDropTarget(event));
    this.dom.moduleTree?.addEventListener("drop", (event) => this.dropModule(event));
    this.dom.moduleTree?.addEventListener("dragend", () => this.clearModuleDragState());
    const stopGraphControlStart = (event) => {
      if (!event.target.closest(".graph-node-toggle, .graph-node-label")) return;
      event.stopPropagation();
      event.stopImmediatePropagation();
    };
    ["pointerdown", "mousedown", "touchstart"].forEach((type) => {
      this.dom.moduleGraph?.addEventListener(type, stopGraphControlStart, true);
    });
    this.dom.moduleTree?.addEventListener("dblclick", (event) => {
      const moduleButton = event.target.closest("[data-open-scene]");
      if (!moduleButton || event.target.closest(".module-rename-input")) return;
      event.preventDefault();
      event.stopPropagation();
      this.beginRenameModule(moduleButton.dataset.openScene, moduleButton);
    });
    this.dom.moduleTabs?.addEventListener("click", (event) => this.handleModuleTabClick(event));
    this.dom.moduleTabs?.addEventListener("dragstart", (event) => this.beginModuleTabDrag(event));
    this.dom.moduleTabs?.addEventListener("dragover", (event) => this.allowModuleTabDrop(event));
    this.dom.moduleTabs?.addEventListener("drop", (event) => this.dropModuleTab(event));
    this.dom.moduleTabs?.addEventListener("dragend", () => this.clearModuleTabDragState());
    this.dom.moduleTabs?.addEventListener("scroll", () => this.updateModuleTabsPagination(), { passive: true });
    this.dom.moduleTabsPrev?.addEventListener("click", () => this.paginateModuleTabs(-1));
    this.dom.moduleTabsNext?.addEventListener("click", () => this.paginateModuleTabs(1));
    this.dom.toolTabs?.addEventListener("scroll", () => this.updateToolTabsPagination(), { passive: true });
    this.dom.toolTabs?.addEventListener("dragstart", (event) => this.beginToolTabDrag(event));
    this.dom.toolTabs?.addEventListener("dragover", (event) => this.allowToolTabDrop(event));
    this.dom.toolTabs?.addEventListener("drop", (event) => this.dropToolTab(event));
    this.dom.toolTabs?.addEventListener("dragend", () => this.clearToolTabDragState());
    this.dom.toolTabsPrev?.addEventListener("click", () => this.paginateToolTabs(-1));
    this.dom.toolTabsNext?.addEventListener("click", () => this.paginateToolTabs(1));
    window.addEventListener("resize", () => {
      this.updateModuleTabsPagination();
      this.updateToolTabsPagination();
    });
    this.dom.assetModuleTabs?.addEventListener("click", (event) => {
      const tab = event.target.closest("[data-resource-scene]");
      if (tab) this.openScene(tab.dataset.resourceScene);
    });
    this.dom.assetModuleTabs?.addEventListener("dragover", (event) => this.allowResourceDrop(event));
    this.dom.assetModuleTabs?.addEventListener("dragleave", (event) => this.clearResourceDropTarget(event));
    this.dom.assetModuleTabs?.addEventListener("drop", (event) => this.dropResourceOnModule(event));
    this.dom.sidebarToggles.forEach((button) => button.addEventListener("click", () => this.toggleSidebarSection(button.dataset.sidebarToggle)));
    this.dom.statisticsSelect?.addEventListener("change", () => this.renderStatistics());
    this.dom.workspacePanelToggles.forEach((button) => button.addEventListener("click", () => this.toggleWorkspacePanel(button.dataset.workspacePanelToggle)));
    this.dom.graphZoomOut?.addEventListener("click", () => this.zoomGraph(1 / 1.25));
    this.dom.graphZoomIn?.addEventListener("click", () => this.zoomGraph(1.25));
    this.dom.graphFit?.addEventListener("click", () => this.fitGraph());
    this.dom.graphPrint?.addEventListener("click", () => this.printGraph());
    this.dom.graphExpand?.addEventListener("click", () => {
      const section = this.dom.graphExpand.closest(".graph-section");
      if (!section) return;
      const expanded = section.classList.toggle("is-expanded-overlay");
      this.dom.graphExpand.textContent = expanded ? "×" : "⛶";
      this.dom.graphExpand.setAttribute("aria-expanded", String(expanded));
      this.dom.graphExpand.setAttribute("aria-label", expanded ? "Cerrar árbol de decisiones ampliado" : "Ampliar árbol de decisiones");
      this.dom.graphExpand.title = this.dom.graphExpand.getAttribute("aria-label");
      if (expanded) {
        this.dom.moduleTree?.classList.remove("is-expanded-overlay");
        const mainExpand = this.dom.moduleTree?.querySelector("[data-expand-main]");
        if (mainExpand) {
          mainExpand.textContent = "⛶";
          mainExpand.setAttribute("aria-expanded", "false");
          mainExpand.setAttribute("aria-label", "Ampliar árbol de escenas");
          mainExpand.title = mainExpand.getAttribute("aria-label");
        }
      }
    });
    this.dom.graphExportSvg?.addEventListener("click", () => this.exportGraphSvg());
    this.dom.aboutButton?.addEventListener("click", () => this.openAbout());
    this.dom.welcomeCloseButton?.addEventListener("click", () => {
      const dialog = this.dom.welcomeDialog;
      if (!dialog) return;
      if (typeof dialog.close === "function" && dialog.open) dialog.close();
      else {
        dialog.removeAttribute("open");
        this.persistWelcomePreference();
      }
    });
    this.dom.welcomeDialog?.addEventListener("close", () => this.persistWelcomePreference());
    this.dom.characterSetupForm?.addEventListener("submit", (event) => {
      event.preventDefault();
      this.finishCharacterSetup();
    });
    this.dom.characterSetupAttributes?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-character-setup-step]");
      if (!button) return;
      const attributeId = button.dataset.characterSetupStep;
      const delta = button.dataset.delta === "-1" ? -1 : 1;
      if (this.player.character.distribute(attributeId, delta)) this.renderCharacterSetup();
    });
    this.dom.addCharacterAttribute?.addEventListener("click", () => this.addCharacterSheetAttribute());
    this.dom.characterAttributeName?.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      this.addCharacterSheetAttribute();
    });
    this.dom.characterAttributeList?.addEventListener("change", (event) => this.updateCharacterSheetAttribute(event));
    this.dom.characterAttributeList?.addEventListener("click", (event) => {
      const remove = event.target.closest("[data-remove-character-attribute]");
      if (remove) this.removeCharacterSheetAttribute(remove.dataset.removeCharacterAttribute);
    });
    this.dom.characterDistributablePoints?.addEventListener("change", () => {
      this.project.characterSheet.distributablePoints = Math.max(0, Math.min(100000, Math.floor(Number(this.dom.characterDistributablePoints.value) || 0)));
      this.dom.characterDistributablePoints.value = String(this.project.characterSheet.distributablePoints);
      this.markDirty();
    });
    this.dom.addCharacterProgression?.addEventListener("click", () => {
      this.project.characterSheet.progressionRules.push({ id: createId("progression-rule"), event: "module-completed", pointsPerUnit: 1 });
      this.renderCharacterSheet();
      this.markDirty("Regla de progreso añadida.");
    });
    this.dom.characterProgressionList?.addEventListener("change", (event) => this.updateCharacterProgression(event));
    this.dom.characterProgressionList?.addEventListener("click", (event) => {
      const remove = event.target.closest("[data-remove-character-progression]");
      if (!remove) return;
      this.project.characterSheet.progressionRules = this.project.characterSheet.progressionRules.filter((rule) => rule.id !== remove.dataset.removeCharacterProgression);
      this.renderCharacterSheet();
      this.markDirty("Regla de progreso eliminada.");
    });
    this.dom.addPlayerCharacter?.addEventListener("click", () => {
      const character = this.project.addPlayerCharacter();
      this.expandedCharacterIds.add(character.id);
      this.renderCharacterEditor();
      this.renderObjectControls();
      this.markDirty("Personaje añadido.");
    });
    this.dom.characterList?.addEventListener("input", (event) => this.updateCharacterProfile(event));
    this.dom.characterList?.addEventListener("change", (event) => this.updateCharacterProfile(event));
    this.dom.characterList?.addEventListener("click", (event) => this.handleCharacterListClick(event));
    this.dom.objectCharacterEnabled?.addEventListener("change", () => this.updateSelectedObjectFlags());
    this.dom.objectCharacterLink?.addEventListener("change", () => this.updateSelectedObjectCharacterLink());

this.dom.assetInput.addEventListener("change", (event) => this.addResourceFiles(event.target.files, true));
this.dom.addSoundCue?.addEventListener("click", () => this.addSoundCue());
this.dom.addVideoCue?.addEventListener("click", () => this.addVideoCue());
this.dom.soundCueList?.addEventListener("change", (event) => this.handleSoundCueChange(event));
this.dom.soundCueList?.addEventListener("input", (event) => this.handleSoundCueInput(event));
this.dom.soundCueList?.addEventListener("dblclick", (event) => this.renameResourceCueFromEvent(event, "sound"));
this.dom.soundCueList?.addEventListener("click", (event) => {
if (this.toggleResourceCueFromEvent(event, "sound")) return;
const button = event.target.closest("[data-remove-sound-cue]");
if (button) this.removeSoundCue(button.dataset.removeSoundCue);
});
this.dom.soundCueList?.addEventListener("timeupdate", (event) => {
const audio = event.target.closest("audio[data-sound-cue-preview]");
const cue = this.scene?.soundCues.find((candidate) => candidate.id === audio?.dataset.soundCuePreview);
if (cue?.durationSeconds && audio.currentTime >= cue.durationSeconds) {
audio.pause();
audio.currentTime = 0;
}
}, true);
this.dom.videoCueList?.addEventListener("change", (event) => this.handleVideoCueChange(event));
this.dom.videoCueList?.addEventListener("input", (event) => this.handleVideoCueInput(event));
this.dom.videoCueList?.addEventListener("dblclick", (event) => this.renameResourceCueFromEvent(event, "video"));
this.dom.videoCueList?.addEventListener("click", (event) => {
if (this.toggleResourceCueFromEvent(event, "video")) return;
const button = event.target.closest("[data-remove-video-cue]");
if (button) this.removeVideoCue(button.dataset.removeVideoCue);
});
this.dom.videoCueList?.addEventListener("timeupdate", (event) => {
const video = event.target.closest("video[data-video-cue-preview]");
const cue = this.scene?.videoCues.find((candidate) => candidate.id === video?.dataset.videoCuePreview);
if (cue?.durationSeconds && video.currentTime >= cue.durationSeconds) {
video.pause();
video.currentTime = 0;
}
}, true);
this.dom.videoPlaybackClose?.addEventListener("click", () => this.closeVideoPlayback());
this.dom.objectLayerSelect?.addEventListener("change", () => this.selectObjectLayer());
this.dom.objectAttributeSelect?.addEventListener("change", () => this.renderObjectAttributeControls(this.scene?.getLayer(this.selectedLayerId)));
this.dom.addObjectAttributeValue?.addEventListener("click", () => this.addSelectedObjectAttribute());
this.dom.objectAttributeList?.addEventListener("change", (event) => {
const input = event.target.closest("[data-object-attribute-value]");
if (input) this.updateObjectAttributeValue(input.dataset.objectAttributeValue, input.value);
});
this.dom.objectAttributeList?.addEventListener("click", (event) => {
const remove = event.target.closest("[data-remove-object-attribute-value]");
if (remove) this.removeSelectedObjectAttribute(remove.dataset.removeObjectAttributeValue);
});
this.dom.addObjectAttribute?.addEventListener("click", () => this.addObjectAttributeDefinition());
this.dom.objectAttributeName?.addEventListener("keydown", (event) => {
if (event.key !== "Enter") return;
event.preventDefault();
this.addObjectAttributeDefinition();
});
this.dom.objectAttributeDefinitionList?.addEventListener("change", (event) => {
const input = event.target.closest("[data-object-attribute-name]");
if (input) this.renameObjectAttributeDefinition(input.dataset.objectAttributeName, input.value);
});
this.dom.objectAttributeDefinitionList?.addEventListener("click", (event) => {
const remove = event.target.closest("[data-remove-object-attribute]");
if (remove) this.removeObjectAttributeDefinition(remove.dataset.removeObjectAttribute);
});
this.dom.objectInventoryEnabled?.addEventListener("change", () => this.updateSelectedObjectFlags());
this.dom.objectCombinableEnabled?.addEventListener("change", () => this.updateSelectedObjectFlags());
this.dom.objectUniqueEnabled?.addEventListener("change", () => this.updateSelectedObjectFlags());
this.dom.objectCompatibilityList?.addEventListener("change", (event) => {
      const input = event.target.closest("[data-compatible-resource-id]");
      if (input) this.updateSelectedObjectCompatibility(input.dataset.compatibleResourceId, input.checked);
});
    this.dom.objectCombinationResult?.addEventListener("change", () => this.updateSelectedCombinationResult());
    this.dom.hintLayerSelect?.addEventListener("change", () => this.selectHintLayer());
    this.dom.hintEnabled?.addEventListener("change", () => this.updateSelectedHintEnabled());
    this.dom.addHintText?.addEventListener("click", () => this.addHintText());
    this.dom.hintTextList?.addEventListener("input", (event) => {
      const textarea = event.target.closest("[data-hint-text-id]");
      if (textarea) this.updateHintText(textarea.dataset.hintTextId, textarea.value);
    });
    this.dom.hintTextList?.addEventListener("focusin", (event) => {
      const textarea = event.target.closest("[data-hint-new]");
      if (textarea) this.materializeNewHintText(textarea);
    });
    this.dom.hintTextList?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-remove-hint-text]");
      if (button) this.removeHintText(button.dataset.removeHintText);
    });
    this.dom.assetList.addEventListener("click", (event) => this.handleAssetListClick(event));
    this.dom.assetList.addEventListener("dragstart", (event) => this.beginResourceDrag(event));
    this.dom.assetList.addEventListener("dragend", () => this.clearResourceDragState());
    this.dom.assetList.addEventListener("change", (event) => {
      const input = event.target.closest("[data-stack-position]");
      if (!input || input.disabled) return;
      this.setStackPosition("image", input.dataset.stackPosition, input.value);
    });
    this.dom.assetPageSize.addEventListener("change", () => {
      this.assetPageSize = Number(this.dom.assetPageSize.value) || 4;
      this.assetPage = 0;
      this.renderAssets();
    });
    this.dom.assetPagePrev.addEventListener("click", () => {
      this.assetPage = Math.max(0, this.assetPage - 1);
      this.renderAssets();
    });
    this.dom.assetPageNext.addEventListener("click", () => {
      this.assetPage += 1;
      this.renderAssets();
    });
    this.dom.inventoryGridSelect?.addEventListener("change", () => this.updateInventoryGrid());
    this.dom.inventoryHintCapacity?.addEventListener("change", () => this.updateInventoryHintCapacity());
this.bindDropZone(this.dom.assetDropZone, true, true);
this.bindDropZone(this.dom.stage, true, false, true);

    this.dom.dialogueCenterHorizontal.addEventListener("change", () => this.centerDialogueAxis("xPct", this.dom.dialogueCenterHorizontal.checked));
    this.dom.dialogueCenterVertical.addEventListener("change", () => this.centerDialogueAxis("yPct", this.dom.dialogueCenterVertical.checked));

    [this.dom.layerX, this.dom.layerY, this.dom.layerWidth, this.dom.layerAlt].forEach((input) => {
      input.addEventListener("input", () => this.updateLayerInspector());
    });
    this.dom.dialogueZIndex.addEventListener("change", () => {
      if (this.selectedDialogueId) this.setStackPosition("dialogue", this.selectedDialogueId, this.dom.dialogueZIndex.value);
    });
    this.dom.layerNaturalSize.addEventListener("click", () => this.setSelectedLayerSize("natural"));
    this.dom.layerFitStage.addEventListener("click", () => this.setSelectedLayerSize("fit"));

    this.dom.gamePreview.addEventListener("pointerdown", (event) => {
      this.focusToolEditorForCanvasTarget(event.target);
  if (this.isPreviewing || event.target.closest(".choice-button[data-choice-id], .quiz-box[data-quiz-box-role], .combat-box[data-combat-box]")) return;
      this.clearSelectedChoice();
  this.clearSelectedQuizBox();
  this.clearSelectedCombatBox();
    }, true);
    this.dom.stage.addEventListener("pointerdown", (event) => this.beginLayerDrag(event));
    this.dom.stage.addEventListener("pointermove", (event) => this.moveLayerDrag(event));
    this.dom.stage.addEventListener("pointerup", (event) => this.endLayerDrag(event));
    this.dom.stage.addEventListener("pointercancel", (event) => this.endLayerDrag(event));
    this.dom.stage.addEventListener("lostpointercapture", (event) => this.endLayerDrag(event));
    this.dom.stage.addEventListener("keydown", (event) => this.nudgeSelectedLayer(event));
    this.dom.stage.addEventListener("click", (event) => this.handleCombinationStageClick(event));
    window.addEventListener("keydown", (event) => this.handleSelectedLayerDelete(event), true);

    this.dom.dialogueLayer.addEventListener("pointerdown", (event) => this.beginDialogueDrag(event));
    this.dom.dialogueLayer.addEventListener("pointermove", (event) => this.moveDialogueDrag(event));
    this.dom.dialogueLayer.addEventListener("pointerup", (event) => this.endDialogueDrag(event));
    this.dom.dialogueLayer.addEventListener("pointercancel", (event) => this.endDialogueDrag(event));
    this.dom.dialogueLayer.addEventListener("lostpointercapture", (event) => this.endDialogueDrag(event));
    this.dom.dialogueLayer.addEventListener("keydown", (event) => this.nudgeDialogue(event));

    this.dom.choicePreview.addEventListener("pointerdown", (event) => this.beginChoiceDrag(event));
    this.dom.choicePreview.addEventListener("pointermove", (event) => this.moveChoiceDrag(event));
    this.dom.choicePreview.addEventListener("pointerup", (event) => this.endChoiceDrag(event));
    this.dom.choicePreview.addEventListener("pointercancel", (event) => this.endChoiceDrag(event));
    this.dom.choicePreview.addEventListener("lostpointercapture", (event) => this.endChoiceDrag(event));
    this.dom.choicePreview.addEventListener("keydown", (event) => this.nudgeChoice(event));
  this.dom.choicePreview.addEventListener("pointermove", (event) => this.moveQuizDrag(event));
  this.dom.choicePreview.addEventListener("pointerup", (event) => this.endQuizDrag(event));
  this.dom.choicePreview.addEventListener("pointercancel", (event) => this.endQuizDrag(event));
  this.dom.choicePreview.addEventListener("lostpointercapture", (event) => this.endQuizDrag(event));
  this.dom.choicePreview.addEventListener("keydown", (event) => this.nudgeQuizBox(event));
  this.dom.choicePreview.addEventListener("pointermove", (event) => this.moveCombatDrag(event));
  this.dom.choicePreview.addEventListener("pointerup", (event) => this.endCombatDrag(event));
  this.dom.choicePreview.addEventListener("pointercancel", (event) => this.endCombatDrag(event));
  this.dom.choicePreview.addEventListener("lostpointercapture", (event) => this.endCombatDrag(event));
  this.dom.choicePreview.addEventListener("keydown", (event) => this.nudgeCombatBox(event));

    this.dom.choicePreview.addEventListener("click", (event) => {
      const combatPlay = event.target.closest("[data-combat-play]");
      if (combatPlay) {
        if (!this.isPreviewing) {
          this.setPlaybackStatus("Pulsa «Probar» para iniciar el combate.");
          return;
        }
        const box = combatPlay.closest("[data-combat-box]");
        const itemId = box?.querySelector("[data-combat-inventory-item]")?.value || "";
        this.player.playCombatRound(combatPlay.dataset.combatPlay, itemId);
        return;
      }
      const quizAction = event.target.closest("[data-quiz-action]");
      if (quizAction) {
        this.handleQuizPreviewAction(quizAction);
        return;
      }
      const choiceButton = event.target.closest("[data-choice-id]");
      if (!choiceButton) return;
      if (this.isPreviewing) this.player.choose(choiceButton.dataset.choiceId);
      else this.setPlaybackStatus("Pulsa «Probar» para jugar la escena.");
    });
    this.dom.choicePreview.addEventListener("submit", (event) => {
      const answerForm = event.target.closest("[data-quiz-answer-form]");
      if (!answerForm) return;
      event.preventDefault();
      this.submitQuizTextAnswer(answerForm);
    });

    this.dom.tabs.forEach((tab) => tab.addEventListener("click", () => this.showTab(tab.dataset.tab)));

    window.addEventListener("pagehide", () => {
      if (this.autoSaveTimer) window.clearTimeout(this.autoSaveTimer);
      this.autoSaveTimer = null;
      this.saveProject();
    });
    window.addEventListener("resize", () => {
      this.fitCanvasToViewport();
      if (!this.moduleGraph) return;
      this.moduleGraph.resize();
      this.positionGraphNodeControls();
    });
  }

  fitCanvasToViewport() {
    const column = this.dom.canvasColumn;
    const preview = this.dom.gamePreview;
    if (!column || !preview) return;

    const fixedSections = [this.dom.canvasHeading, this.dom.moduleTabsStrip, this.dom.canvasFooter];
    const fixedHeight = fixedSections.reduce((total, element) => {
      if (!element) return total;
      const style = window.getComputedStyle(element);
      return total + element.getBoundingClientRect().height
        + (Number.parseFloat(style.marginTop) || 0)
        + (Number.parseFloat(style.marginBottom) || 0);
    }, 0);
    const columnStyle = window.getComputedStyle(column);
    const rowGap = Number.parseFloat(columnStyle.rowGap) || 0;
    const availableHeight = Math.max(0, column.clientHeight - fixedHeight - rowGap * 4);
    const availableWidth = Math.max(0, column.clientWidth);
    const width = Math.min(availableWidth, availableHeight * (16 / 9));
    preview.style.width = `${width}px`;
    preview.style.height = `${width * (9 / 16)}px`;
  }

  restoreSidebarSections() {
    this.dom.sidebarToggles.forEach((button) => {
      const sectionName = button.dataset.sidebarToggle;
      let isCollapsed = false;
      try {
        isCollapsed = localStorage.getItem(`escena-viva-sidebar-${sectionName}-collapsed`) === "true";
      } catch {
        // El plegado sigue funcionando aunque el navegador limite el almacenamiento local.
      }
      this.setSidebarSectionCollapsed(sectionName, isCollapsed, false);
    });
  }

  restoreWorkspacePanels() {
    for (const panelName of ["explorer", "authoring"]) {
      let isCollapsed = false;
      try {
        isCollapsed = localStorage.getItem(`escena-viva-panel-${panelName}-collapsed`) === "true";
      } catch {
        // El plegado sigue disponible aunque el navegador limite el almacenamiento local.
      }
      this.setWorkspacePanelCollapsed(panelName, isCollapsed, false);
    }
  }

  toggleWorkspacePanel(panelName) {
    if (!(panelName in this.workspacePanelState)) return;
    this.setWorkspacePanelCollapsed(panelName, !this.workspacePanelState[panelName]);
  }

  setWorkspacePanelCollapsed(panelName, isCollapsed, persist = true) {
    const button = this.dom.workspacePanelToggles.find((toggle) => toggle.dataset.workspacePanelToggle === panelName);
    if (!this.dom.workspace || !button) return;
    const isExplorer = panelName === "explorer";
    const panelLabel = isExplorer ? "explorador" : "panel de edición";
    this.workspacePanelState[panelName] = isCollapsed;
    this.dom.workspace.classList.toggle(`is-${panelName}-collapsed`, isCollapsed);
    button.setAttribute("aria-expanded", String(!isCollapsed));
    button.setAttribute("aria-label", `${isCollapsed ? "Mostrar" : "Ocultar"} ${panelLabel}`);
    button.title = button.getAttribute("aria-label");
    const icon = button.querySelector(".workspace-panel-toggle-icon");
    if (icon) icon.textContent = isExplorer ? (isCollapsed ? "▸" : "◂") : (isCollapsed ? "◂" : "▸");
    if (persist) {
      try {
        localStorage.setItem(`escena-viva-panel-${panelName}-collapsed`, String(isCollapsed));
      } catch {
        // La preferencia visual no depende del almacenamiento local.
      }
    }
    window.requestAnimationFrame(() => {
      this.fitCanvasToViewport();
      this.moduleGraph?.resize();
      this.positionGraphNodeControls();
      this.updateToolTabsPagination();
    });
  }

  toggleSidebarSection(sectionName) {
    const button = this.dom.sidebarToggles.find((toggle) => toggle.dataset.sidebarToggle === sectionName);
    const content = button ? document.getElementById(button.getAttribute("aria-controls")) : null;
    if (!content) return;
    this.setSidebarSectionCollapsed(sectionName, !content.hidden);
  }

  setSidebarSectionCollapsed(sectionName, isCollapsed, persist = true) {
    const button = this.dom.sidebarToggles.find((toggle) => toggle.dataset.sidebarToggle === sectionName);
    const content = button ? document.getElementById(button.getAttribute("aria-controls")) : null;
    if (!content || !button) return;
    content.hidden = isCollapsed;
    button.setAttribute("aria-expanded", String(!isCollapsed));
    const sectionLabel = {
      explorer: "Explorador",
      graph: "árbol de decisiones",
      "scenes-general": "escenas",
      resources: "recursos",
      "project-notes": "notas del proyecto",
      statistics: "estadísticas",
sound: "sonido",
      video: "vídeo",
      transitions: "tiempos y transiciones",
      objects: "objetos",
      hints: "pistas",
      "map-resource": "mapa de recursos",
      "tool-dialogue": "diálogo",
"tool-dialogue-typography": "tipografía del diálogo",
"tool-dialogue-style": "estilo de los diálogos",
      "tool-decisions": "decisiones",
"tool-decision-typography": "tipografía de las decisiones",
"tool-decision-style": "estilo de las decisiones",
      "tool-canvas": "lienzo",
      "tool-scene": "escena",
      "tool-combats": "combates",
      "tool-events": "eventos",
      "tool-characters": "personajes",
      "tool-quiz": "Quiz",
      "character-sheet": "ficha de personaje",
      inventory: "inventario",
      plugins: "plugins",
    }[sectionName] || sectionName;
    button.setAttribute("aria-label", `${isCollapsed ? "Desplegar" : "Plegar"} ${sectionLabel}`);
    button.title = button.getAttribute("aria-label");
    button.textContent = isCollapsed ? "▸" : "▾";
    if (persist) {
      try {
        localStorage.setItem(`escena-viva-sidebar-${sectionName}-collapsed`, String(isCollapsed));
      } catch {
        // El plegado es visual y no debe fallar si el navegador no permite persistir preferencias.
      }
    }
    if (sectionName === "graph" && !isCollapsed) {
      window.requestAnimationFrame(() => {
        this.moduleGraph?.resize();
        this.fitGraph();
      });
    }
  }

bindDropZone(element, addToStage, includeSounds = false, acceptInternalImage = false) {
    ["dragenter", "dragover"].forEach((type) => {
      element.addEventListener(type, (event) => {
        event.preventDefault();
        if (!this.isPreviewing) element.classList.add("is-dragging");
        if (acceptInternalImage && [...(event.dataTransfer?.types || [])].includes("application/x-crowther-resource")) {
          event.dataTransfer.dropEffect = "copy";
          element.classList.add("is-resource-drop-target");
        }
      });
    });
    ["dragleave", "drop"].forEach((type) => {
      element.addEventListener(type, (event) => {
        event.preventDefault();
        element.classList.remove("is-dragging");
        if (type === "drop" || !element.contains(event.relatedTarget)) element.classList.remove("is-resource-drop-target");
      });
    });
    element.addEventListener("drop", (event) => {
      if (this.isPreviewing) return;
      if (acceptInternalImage && this.handleStageResourceDrop(event)) return;
      if (!event.dataTransfer?.files?.length) return;
 if (includeSounds) this.addResourceFiles(event.dataTransfer?.files, addToStage);
 else this.addImageFiles(event.dataTransfer?.files, addToStage);
    });
  }

  handleStageResourceDrop(event) {
    const transfer = event.dataTransfer;
    const hasResourcePayload = [...(transfer?.types || [])].includes("application/x-crowther-resource");
    const draggedResource = this.draggedResource;
    if (!hasResourcePayload && !draggedResource) return false;
    event.preventDefault();
    event.stopPropagation();
    let resource = draggedResource;
    if (hasResourcePayload) {
      try {
        resource = JSON.parse(transfer.getData("application/x-crowther-resource")) || draggedResource;
      } catch {
        if (!resource) {
          this.announce("No se pudo leer el recurso arrastrado.");
          return true;
        }
      }
    }
    if (resource?.type !== "image" || !this.scene?.assetIds.includes(resource.id)) {
      this.announce("Arrastra al lienzo una imagen disponible en esta escena.");
      return true;
    }
    const bounds = this.dom.stage?.getBoundingClientRect();
    const position = bounds?.width && bounds?.height
      ? {
        xPct: ((event.clientX - bounds.left) / bounds.width) * 100,
        yPct: ((event.clientY - bounds.top) / bounds.height) * 100,
      }
      : null;
    this.placeResourceImageOnStage(resource.id, { position, animate: true });
    return true;
  }

  hydrateEditors() {
    if (!this.scene) return;
    this.hydrateDialogueEditors();
    this.hydrateNotesEditors();
    this.hydrateCanvasStyleControls();
    setNativeInputValue(this.dom.decisionPrompt, this.scene.decisions.prompt);
    setNativeInputValue(this.dom.decisionPromptSize, this.scene.decisions.promptFontSize);
    setNativeInputValue(this.dom.decisionPromptColor, this.scene.decisions.promptColor);
    const decisionStyle = this.scene.decisions.style;
    setNativeInputValue(this.dom.decisionStyleBg, decisionStyle.backgroundColor);
    setNativeInputValue(this.dom.decisionStyleText, decisionStyle.textColor);
    setNativeInputValue(this.dom.decisionStyleAccent, decisionStyle.accentColor);
    setNativeInputValue(this.dom.decisionStyleBorder, decisionStyle.borderColor);
    setNativeInputValue(this.dom.decisionCustomCss, decisionStyle.customCss);
    this.hydrateTypographyControls("decision", decisionStyle);
    this.hydrateDecisionBackgroundControls();
    this.hydrateDialogueStyleControls();
    this.dom.sceneFinalCheckbox.checked = Boolean(this.scene.isFinal);
    this.dom.sceneFinalType.value = this.scene.finalType || "";
    this.dom.sceneFinalType.disabled = !this.scene.isFinal;
    this.dom.sceneFinalType.disabled = !this.scene.isFinal;
  }

  hydrateCanvasStyleControls() {
    const style = this.scene?.canvasStyle;
    if (!style) return;
    setNativeInputValue(this.dom.canvasBackgroundColor, style.backgroundColor);
    this.renderCanvasBackgroundOptions();
    setNativeInputValue(this.dom.canvasColumnCount, style.columns);
    setNativeInputValue(this.dom.canvasColumnGap, style.gapPx);
    this.renderCanvasColumnBorders();
    this.renderCanvasStyle();
  }

  renderCanvasColumnBorders() {
    const container = this.dom.canvasColumnBorders;
    if (!container || !this.scene) return;
    const count = Math.min(4, Math.max(1, Number(this.scene.canvasStyle.columns) || 1));
    const fragment = document.createDocumentFragment();
    for (let index = 0; index < count; index += 1) {
      const label = document.createElement("label");
      label.className = "checkbox-option canvas-column-border-option";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.dataset.canvasColumnBorder = String(index);
      checkbox.checked = Boolean(this.scene.canvasStyle.columnBorders[index]);
      const text = document.createElement("span");
      text.textContent = `Borde de la columna ${index + 1}`;
      label.append(text, checkbox);
      fragment.append(label);
    }
    container.replaceChildren(fragment);
  }

  renderCanvasStyle() {
    if (!this.scene || !this.dom.stage || !this.dom.stageColumns) return;
    const style = this.scene.canvasStyle;
    const columnCount = Math.min(4, Math.max(1, Number(style.columns) || 1));
    this.dom.stage.style.backgroundColor = style.backgroundColor || "#17131b";
    const effectiveBackgroundId = style.exceptGlobalBackground
      ? style.backgroundImageAssetId
      : (this.project.canvasBackgroundAllModules ? this.project.canvasBackgroundImageAssetId : null);
    const backgroundAsset = effectiveBackgroundId ? this.project.getAsset(effectiveBackgroundId) : null;
    if (this.dom.stageBackground) {
      const source = backgroundAsset?.dataUrl || "";
      if (source && this.dom.stageBackground.getAttribute("src") !== source) this.dom.stageBackground.src = source;
      if (!source) this.dom.stageBackground.removeAttribute("src");
      this.dom.stageBackground.hidden = !source;
    }
    this.dom.stageColumns.style.gridTemplateColumns = `repeat(${columnCount}, minmax(0, 1fr))`;
    const stageWidth = Number(this.scene.stage.width) || 1600;
    this.dom.stageColumns.style.columnGap = `${(Math.max(0, Number(style.gapPx) || 0) / stageWidth) * 100}%`;
    const fragment = document.createDocumentFragment();
    for (let index = 0; index < columnCount; index += 1) {
      const column = document.createElement("div");
      column.className = "stage-column-guide";
      column.classList.toggle("has-border", Boolean(style.columnBorders[index]));
      fragment.append(column);
    }
    this.dom.stageColumns.replaceChildren(fragment);
    if (this.dom.canvasBackgroundException) {
      this.dom.canvasBackgroundException.checked = Boolean(style.exceptGlobalBackground);
      this.dom.canvasBackgroundException.disabled = this.isPreviewing;
    }
    if (this.dom.canvasBackgroundImage) {
      this.dom.canvasBackgroundImage.value = style.backgroundImageAssetId || "";
      this.dom.canvasBackgroundImage.disabled = this.isPreviewing || !style.exceptGlobalBackground;
    }
    if (this.dom.canvasBackgroundAllModules) {
      this.dom.canvasBackgroundAllModules.checked = Boolean(this.project?.canvasBackgroundAllModules);
      this.dom.canvasBackgroundAllModules.disabled = this.isPreviewing;
    }
    if (this.dom.projectBackgroundImage) {
      this.dom.projectBackgroundImage.value = this.project?.canvasBackgroundImageAssetId || "";
      this.dom.projectBackgroundImage.disabled = this.isPreviewing;
    }
    if (this.dom.projectSceneTransition) {
      this.dom.projectSceneTransition.value = this.project?.sceneTransitionAnimation || "none";
      this.dom.projectSceneTransition.disabled = this.isPreviewing;
    }
    if (this.dom.sceneTransitionException) {
      this.dom.sceneTransitionException.checked = Boolean(style.exceptGlobalTransition);
      this.dom.sceneTransitionException.disabled = this.isPreviewing;
    }
    if (this.dom.sceneTransitionAnimation) {
      this.dom.sceneTransitionAnimation.value = style.transitionAnimation || "none";
      this.dom.sceneTransitionAnimation.disabled = this.isPreviewing || !style.exceptGlobalTransition;
    }
  }

  renderCanvasBackgroundOptions() {
    const selects = [this.dom.canvasBackgroundImage, this.dom.projectBackgroundImage].filter(Boolean);
    if (!selects.length) return;
    const assets = this.project?.assets || [];
    const signature = assets.map((asset) => `${asset.id}:${asset.name || ""}:${this.getResourceModuleNames(asset.id, "image").join(",")}`).join("|");
    selects.forEach((select) => {
      if (select.dataset.resourceSignature === signature) return;
      const fragment = document.createDocumentFragment();
      const none = document.createElement("option");
      none.value = "";
      none.textContent = "Ninguna";
      fragment.append(none);
      if (assets.length) {
        const group = document.createElement("optgroup");
        group.label = "Imágenes";
        assets.forEach((asset) => {
          const option = document.createElement("option");
          option.value = asset.id;
          const moduleNames = this.getResourceModuleNames(asset.id, "image");
          option.textContent = `${asset.name || "Imagen sin nombre"} · ${moduleNames.length ? moduleNames.join(", ") : "sin escena"}`;
          group.append(option);
        });
        fragment.append(group);
      }
      select.replaceChildren(fragment);
      select.dataset.resourceSignature = signature;
    });
    const localSelectedId = this.scene?.canvasStyle.backgroundImageAssetId || "";
    const globalSelectedId = this.project?.canvasBackgroundImageAssetId || "";
    if (this.dom.canvasBackgroundImage) {
      this.dom.canvasBackgroundImage.value = assets.some((asset) => asset.id === localSelectedId) ? localSelectedId : "";
      this.dom.canvasBackgroundImage.disabled = this.isPreviewing || !this.scene?.canvasStyle.exceptGlobalBackground;
    }
    if (this.dom.projectBackgroundImage) {
      this.dom.projectBackgroundImage.value = assets.some((asset) => asset.id === globalSelectedId) ? globalSelectedId : "";
      this.dom.projectBackgroundImage.disabled = this.isPreviewing;
    }
    if (this.dom.canvasBackgroundAllModules) {
      this.dom.canvasBackgroundAllModules.checked = Boolean(this.project?.canvasBackgroundAllModules);
      this.dom.canvasBackgroundAllModules.disabled = this.isPreviewing;
    }
    if (this.dom.canvasBackgroundException) {
      this.dom.canvasBackgroundException.checked = Boolean(this.scene?.canvasStyle.exceptGlobalBackground);
      this.dom.canvasBackgroundException.disabled = this.isPreviewing || !this.scene;
    }
    if (this.dom.projectSceneTransition) {
      this.dom.projectSceneTransition.value = this.project?.sceneTransitionAnimation || "none";
      this.dom.projectSceneTransition.disabled = this.isPreviewing;
    }
    if (this.dom.sceneTransitionException) {
      this.dom.sceneTransitionException.checked = Boolean(this.scene?.canvasStyle.exceptGlobalTransition);
      this.dom.sceneTransitionException.disabled = this.isPreviewing || !this.scene;
    }
    if (this.dom.sceneTransitionAnimation) {
      this.dom.sceneTransitionAnimation.value = this.scene?.canvasStyle.transitionAnimation || "none";
      this.dom.sceneTransitionAnimation.disabled = this.isPreviewing || !this.scene?.canvasStyle.exceptGlobalTransition;
    }
  }

  hydrateDialogueStyleControls() {
    const dialogueStyle = this.scene?.dialogueStyle || {};
    const theme = this.project.theme.variables;
    const dialogue = this.activeDialogue;
    const background = dialogue?.backgroundColor ?? (dialogueStyle.backgroundColor || theme.dialogueBg);
    const transparent = String(background).trim().toLocaleLowerCase() === "transparent";
    if (this.dom.dialogueStyleBgMode) this.dom.dialogueStyleBgMode.value = transparent ? "transparent" : "color";
    if (this.dom.dialogueStyleBgMode) this.dom.dialogueStyleBgMode.disabled = !dialogue || this.isPreviewing;
    if (this.dom.dialogueStyleBg) this.dom.dialogueStyleBg.disabled = transparent || !dialogue || this.isPreviewing;
    setNativeInputValue(this.dom.dialogueStyleBg, transparent ? theme.dialogueBg : background);
    setNativeInputValue(this.dom.dialogueStyleText, dialogueStyle.textColor || theme.dialogueColor);
    setNativeInputValue(this.dom.dialogueStyleAccent, dialogueStyle.accentColor || theme.accentColor);
    setNativeInputValue(this.dom.dialogueStyleBorder, dialogueStyle.borderColor || theme.borderColor.slice(0, 7));
    setNativeInputValue(this.dom.dialogueCustomCss, dialogueStyle.customCss);
    this.hydrateTypographyControls("dialogue", dialogueStyle);
  }

  hydrateDecisionBackgroundControls() {
    const decisions = this.scene?.decisions;
    const choice = decisions?.choices?.find((item) => item.id === this.selectedChoiceId);
    const background = choice?.backgroundColor ?? decisions?.style?.backgroundColor ?? "#15131c";
    const transparent = String(background).trim().toLowerCase() === "transparent";
    if (this.dom.decisionStyleBgMode) {
      this.dom.decisionStyleBgMode.value = transparent ? "transparent" : "color";
      this.dom.decisionStyleBgMode.disabled = !choice || this.isPreviewing;
    }
    if (this.dom.decisionStyleBg) {
      this.dom.decisionStyleBg.disabled = transparent || !choice || this.isPreviewing;
      setNativeInputValue(this.dom.decisionStyleBg, transparent ? "#15131c" : background);
    }
  }

  hydrateTypographyControls(kind, style) {
    const prefix = kind === "dialogue" ? "dialogue" : "decision";
    const familySelect = this.dom[`${prefix}FontFamily`];
    const customField = this.dom[`${prefix}FontFamilyCustomField`];
    const customInput = this.dom[`${prefix}FontFamilyCustom`];
    const family = normalizeFontFamily(style.fontFamily);
    const isPreset = [...familySelect.options].some((option) => option.value === family && option.value !== "custom");
    familySelect.value = family && isPreset ? family : (family ? "custom" : "");
    customField.hidden = familySelect.value !== "custom";
    setNativeInputValue(customInput, familySelect.value === "custom" ? family : "");
    setNativeInputValue(this.dom[`${prefix}FontSize`], style.fontSizePx ?? "");
  }

  updateTypography(kind, input) {
    if (!this.scene) return;
    const prefix = kind === "dialogue" ? "dialogue" : "decision";
    const style = kind === "dialogue" ? this.scene.dialogueStyle : this.scene.decisions.style;
    const familySelect = this.dom[`${prefix}FontFamily`];
    const customField = this.dom[`${prefix}FontFamilyCustomField`];
    const customInput = this.dom[`${prefix}FontFamilyCustom`];
    const sizeInput = this.dom[`${prefix}FontSize`];
    if (input === familySelect) {
      const isCustom = familySelect.value === "custom";
      customField.hidden = !isCustom;
      style.fontFamily = normalizeFontFamily(isCustom ? customInput.value : familySelect.value);
    } else if (input === customInput) {
      style.fontFamily = normalizeFontFamily(customInput.value);
    } else if (input === sizeInput) {
      const value = sizeInput.value.trim();
      style.fontSizePx = value ? clamp(Math.round(Number(value) || 8), 8, 96) : null;
      if (value) sizeInput.value = String(style.fontSizePx);
    }
    this.applyTheme();
    this.markDirty();
  }

  hydrateDialogueEditors() {
    const dialogue = this.activeDialogue;
    const hasDialogue = Boolean(dialogue);
    this.dom.dialogueAuthoringFields.hidden = !hasDialogue;
    this.dom.dialogueEmptyState.hidden = hasDialogue;
    this.dom.addDialogue.disabled = this.isPreviewing;
    this.renderDialogueCards();
    if (!dialogue) {
      this.selectedDialogueId = null;
      this.selectedDialogueBySceneId.set(this.activeSceneId, null);
      this.dom.speakerInput.value = "";
      this.dialogueRichText.setHtml("");
      this.dialogueRichText.setLanguage("und", "auto");
      this.dom.dialogueCenterHorizontal.checked = false;
      this.dom.dialogueCenterVertical.checked = false;
      this.dom.dialogueZIndex.value = "";
      this.dom.dialogueZIndex.disabled = true;
      this.setSpeakerOptionsOpen(false);
      if (this.store) this.hydrateDialogueStyleControls();
      return;
    }
    setNativeInputValue(this.dom.speakerInput, dialogue.speaker);
    this.renderSpeakerOptions();
    this.setDialogueLanguageControl(dialogue.text.lang);
    this.dialogueRichText.setHtml(dialogue.text.html);
    this.dialogueRichText.setLanguage(dialogue.text.lang, dialogue.text.dir);
    this.dom.dialogueZIndex.max = String(Math.max(1, this.getStackItems().length));
    this.dom.dialogueZIndex.value = String(dialogue.zIndex);
    this.dom.dialogueZIndex.disabled = this.isPreviewing || !this.selectedDialogueId;
    if (this.store) this.hydrateDialogueStyleControls();
  }

  renderDialogueCards() {
    const list = this.dom.dialogueCardList;
    if (!list) return;
    const dialogues = this.scene?.dialogues || [];
    const activeId = this.activeDialogue?.id || null;
    const fragment = document.createDocumentFragment();

    dialogues.forEach((dialogue, index) => {
      const isActive = dialogue.id === activeId;
      const isExpanded = isActive && this.dialogueEditorExpanded;
      const card = document.createElement("article");
      card.className = `quiz-card dialogue-event-card${isActive ? " is-active" : ""}${isExpanded ? "" : " is-collapsed"}`;
      card.dataset.dialogueId = dialogue.id;

      const heading = document.createElement("div");
      heading.className = "quiz-card-heading";
      const titleGroup = document.createElement("div");
      titleGroup.className = "quiz-card-title-group";
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "sidebar-collapse-toggle quiz-card-toggle";
      toggle.dataset.toggleDialogue = "";
      toggle.dataset.dialogueId = dialogue.id;
      toggle.disabled = this.isPreviewing;
      toggle.textContent = isExpanded ? "▾" : "▸";
      toggle.setAttribute("aria-expanded", String(isExpanded));
      toggle.setAttribute("aria-label", `${isExpanded ? "Plegar" : "Desplegar"} diálogo ${index + 1}`);
      const title = document.createElement("h3");
      title.dataset.renameDialogueTitle = "";
      title.title = "Doble clic para cambiar el nombre";
      title.textContent = dialogue.name || `Diálogo ${index + 1}`;
      titleGroup.append(toggle, title);

      const actions = document.createElement("div");
      actions.className = "tool-section-actions";
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "icon-button quiz-remove-button";
      remove.dataset.removeDialogue = "";
      remove.dataset.dialogueId = dialogue.id;
      remove.disabled = this.isPreviewing;
      remove.textContent = "×";
      remove.setAttribute("aria-label", `Eliminar diálogo ${index + 1}`);
      remove.title = "Eliminar caja de diálogo";
      actions.append(remove);
      heading.append(titleGroup, actions);

      const content = document.createElement("div");
      content.className = "quiz-card-content dialogue-event-content";
      content.hidden = !isExpanded;
      if (isExpanded) content.append(this.dom.dialogueAuthoringFields);
      card.append(heading, content);
      fragment.append(card);
    });

    list.replaceChildren(fragment);
    if (!dialogues.length && this.dom.dialogueAuthoringFields.parentElement !== list.parentElement) {
      list.after(this.dom.dialogueAuthoringFields);
    }
    this.dom.addDialogue.disabled = this.isPreviewing;
  }

  hydrateNotesEditors() {
    const sceneNotes = this.scene?.notes;
    this.sceneNotesRichText.setHtml(sceneNotes?.html || "");
    this.sceneNotesRichText.setLanguage(sceneNotes?.lang || "und", sceneNotes?.dir || "auto");
    this.projectNotesRichText.setHtml(this.project.notes?.html || "");
    this.projectNotesRichText.setLanguage(this.project.notes?.lang || "und", this.project.notes?.dir || "auto");
  }

  renderSpeakerOptions() {
    if (!this.dom.speakerOptions) return;
    const speakers = [...this.project.characters].sort((left, right) => left.localeCompare(right));
    if (!speakers.length) {
      const emptyState = document.createElement("p");
      emptyState.className = "speaker-empty";
      emptyState.textContent = "Aún no has guardado ningún personaje.";
      this.dom.speakerOptions.replaceChildren(emptyState);
      return;
    }
    this.dom.speakerOptions.replaceChildren(...speakers.map((speaker) => {
      const row = document.createElement("div");
      row.className = "speaker-option-row";
      row.setAttribute("role", "group");
      row.setAttribute("aria-label", speaker);
      const option = document.createElement("button");
      option.type = "button";
      option.className = "speaker-option";
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", String(speaker === this.activeDialogue?.speaker));
      option.dataset.speakerOption = speaker;
      option.textContent = speaker;
      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "speaker-delete-button";
      removeButton.dataset.removeSpeaker = speaker;
      removeButton.setAttribute("aria-label", `Eliminar ${speaker} de la lista de personajes`);
      removeButton.title = `Eliminar ${speaker} de la lista`;
      removeButton.textContent = "×";
      row.append(option, removeButton);
      return row;
    }));
  }

  removeSpeakerFromList(speaker) {
    const normalizedSpeaker = String(speaker || "").trim().toLocaleLowerCase();
    if (!normalizedSpeaker) return;
    const characters = this.project.characters;
    const remainingCharacters = characters.filter((character) => character.toLocaleLowerCase() !== normalizedSpeaker);
    if (remainingCharacters.length === characters.length) return;
    this.project.characters = remainingCharacters;
    this.renderSpeakerOptions();
    this.markDirty(`«${speaker}» se quitó de la lista de personajes.`);
    this.setSpeakerOptionsOpen(true);
    this.dom.speakerInput.focus();
  }

  setSpeakerOptionsOpen(isOpen) {
    const open = Boolean(isOpen);
    this.dom.speakerOptions.hidden = !open;
    this.dom.speakerInput.setAttribute("aria-expanded", String(open));
    this.dom.speakerDropdownButton.setAttribute("aria-expanded", String(open));
  }

  renderCombatCharacterOptions(options, currentValue = "", filterValue = "") {
    if (!options) return;
    const characters = [...new Set((this.project.characters || []).map((name) => String(name || "").trim()).filter(Boolean))]
      .sort((left, right) => left.localeCompare(right));
    const query = String(filterValue || "").trim().toLocaleLowerCase();
    const matches = query ? characters.filter((name) => name.toLocaleLowerCase().includes(query)) : characters;
    if (!matches.length) {
      const empty = document.createElement("p");
      empty.className = "speaker-empty";
      empty.textContent = characters.length ? "No hay personajes coincidentes." : "Aún no has guardado ningún personaje.";
      options.replaceChildren(empty);
      return;
    }
    options.replaceChildren(...matches.map((name) => {
      const row = document.createElement("div");
      row.className = "speaker-option-row";
      const option = document.createElement("button");
      option.type = "button";
      option.className = "speaker-option";
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", String(name === currentValue));
      option.dataset.combatCharacterOption = name;
      option.textContent = name;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "speaker-delete-button";
      remove.dataset.removeCombatCharacter = name;
      remove.setAttribute("aria-label", `Eliminar ${name} de la lista de personajes`);
      remove.title = `Eliminar ${name} de la lista`;
      remove.textContent = "×";
      row.append(option, remove);
      return row;
    }));
  }

  combatAttributesFromAsset(asset) {
    return combatAttributesFromImage(this.project, asset);
  }

  setCombatCharacterOptionsOpen(control, isOpen) {
    if (!control) return;
    const open = Boolean(isOpen);
    const input = control.querySelector('[data-combat-field="enemyName"]');
    const button = control.querySelector("[data-combat-character-toggle]");
    const options = control.querySelector(".speaker-options");
    if (!input || !button || !options) return;
    options.hidden = !open;
    input.setAttribute("aria-expanded", String(open));
    button.setAttribute("aria-expanded", String(open));
  }

  createResourceCueCard(cue, kind, index, removeDataset, removeLabel) {
    const labels = { sound: "Sonido", video: "Vídeo", timed: "Cambio" };
    const label = labels[kind] || "Recurso";
    const key = `${kind}:${cue.id}`;
    const collapsed = this.collapsedResourceCueIds.has(key);
    const card = document.createElement("article");
    card.className = `quiz-card resource-cue-card ${kind}-cue-card${collapsed ? " is-collapsed" : ""}`;
    card.dataset.resourceCueKind = kind;
    card.dataset.resourceCueId = cue.id;
    if (kind === "sound") card.dataset.soundCueId = cue.id;
    if (kind === "video") card.dataset.videoCueId = cue.id;
    if (kind === "timed") card.dataset.cueId = cue.id;

    const heading = document.createElement("div");
    heading.className = "quiz-card-heading resource-cue-heading";
    const group = document.createElement("div");
    group.className = "quiz-card-title-group";
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "sidebar-collapse-toggle quiz-card-toggle";
    toggle.dataset.resourceCueToggle = "";
    toggle.setAttribute("aria-expanded", String(!collapsed));
    toggle.setAttribute("aria-label", `${collapsed ? "Desplegar" : "Plegar"} ${cue.name || `${label} ${index + 1}`}`);
    toggle.textContent = collapsed ? "▸" : "▾";
    const title = document.createElement("h3");
    title.dataset.resourceCueTitle = kind;
    title.title = "Doble clic para cambiar el nombre";
    title.textContent = cue.name || `${label} ${index + 1}`;
    group.append(toggle, title);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "icon-button quiz-remove-button hint-text-remove";
    remove.dataset[removeDataset] = cue.id;
    remove.setAttribute("aria-label", removeLabel);
    remove.title = removeLabel;
    remove.textContent = "×";
    remove.disabled = this.isPreviewing;
    heading.append(group, remove);

    const content = document.createElement("div");
    content.className = "quiz-card-content resource-cue-content";
    content.hidden = collapsed;
    card.append(heading, content);
    return { card, content };
  }

  resourceCueCollection(kind) {
    if (!this.scene) return [];
    if (kind === "sound") return this.scene.soundCues;
    if (kind === "video") return this.scene.videoCues;
    return this.scene.timedCues;
  }

  toggleResourceCueFromEvent(event, expectedKind) {
    const toggle = event.target.closest("[data-resource-cue-toggle]");
    const card = toggle?.closest("[data-resource-cue-kind][data-resource-cue-id]");
    if (!toggle || !card || card.dataset.resourceCueKind !== expectedKind) return false;
    const key = `${card.dataset.resourceCueKind}:${card.dataset.resourceCueId}`;
    const collapsed = !this.collapsedResourceCueIds.has(key);
    if (collapsed) this.collapsedResourceCueIds.add(key);
    else this.collapsedResourceCueIds.delete(key);
    card.classList.toggle("is-collapsed", collapsed);
    const content = card.querySelector(".resource-cue-content");
    if (content) content.hidden = collapsed;
    toggle.textContent = collapsed ? "▸" : "▾";
    toggle.setAttribute("aria-expanded", String(!collapsed));
    toggle.setAttribute("aria-label", `${collapsed ? "Desplegar" : "Plegar"} ${card.querySelector("[data-resource-cue-title]")?.textContent || "recurso"}`);
    return true;
  }

  renameResourceCueFromEvent(event, expectedKind) {
    if (this.isPreviewing || !this.scene) return;
    const title = event.target.closest(`[data-resource-cue-title="${expectedKind}"]`);
    const card = title?.closest("[data-resource-cue-kind][data-resource-cue-id]");
    if (!title || !card || card.dataset.resourceCueKind !== expectedKind) return;
    const collection = this.resourceCueCollection(expectedKind);
    const index = collection.findIndex((cue) => cue.id === card.dataset.resourceCueId);
    if (index >= 0) this.beginResourceCueTitleRename(title, expectedKind, collection[index], index);
  }

  beginResourceCueTitleRename(heading, kind, cue, index) {
    const labels = { sound: "Sonido", video: "Vídeo", timed: "Cambio" };
    const fallback = `${labels[kind] || "Recurso"} ${index + 1}`;
    const input = document.createElement("input");
    input.type = "text";
    input.className = "challenge-title-rename";
    input.maxLength = 80;
    input.setAttribute("aria-label", `Nombre de ${String(labels[kind] || "recurso").toLocaleLowerCase()}`);
    input.value = cue.name || fallback;
    let finished = false;
    const finish = (commit) => {
      if (finished) return;
      finished = true;
      if (commit) {
        const value = input.value.trim().slice(0, 80);
        cue.name = value === fallback ? "" : value;
      }
      if (kind === "sound") this.renderSoundResources();
      else if (kind === "video") this.renderVideoResources();
      else this.renderCueList();
      if (commit) this.markDirty();
    };
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        input.blur();
      } else if (event.key === "Escape") {
        event.preventDefault();
        input.dataset.cancelRename = "true";
        input.blur();
      }
    });
    input.addEventListener("blur", () => finish(input.dataset.cancelRename !== "true"));
    heading.replaceWith(input);
    input.focus();
    input.select();
  }

  beginResourceSectionRename(heading, key) {
    const fallback = { sound: "Sonido", video: "Vídeo", transitions: "Tiempos y transiciones" }[key];
    if (!fallback || !this.project.resourceSectionNames) return;
    const previous = this.project.resourceSectionNames[key] || fallback;
    const input = document.createElement("input");
    input.type = "text";
    input.className = "challenge-title-rename resource-section-rename";
    input.maxLength = 80;
    input.setAttribute("aria-label", `Renombrar sección ${previous}`);
    input.value = previous;
    let finished = false;
    const finish = (commit) => {
      if (finished) return;
      finished = true;
      if (commit) {
        const value = input.value.trim().slice(0, 80);
        this.project.resourceSectionNames[key] = value || fallback;
      }
      const restored = document.createElement("p");
      restored.className = heading.className;
      restored.id = heading.id;
      restored.dataset.renameResourceSection = key;
      restored.textContent = this.project.resourceSectionNames[key] || fallback;
      input.replaceWith(restored);
      if (commit) this.markDirty();
    };
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        input.blur();
      } else if (event.key === "Escape") {
        event.preventDefault();
        input.dataset.cancelRename = "true";
        input.blur();
      }
    });
    input.addEventListener("blur", () => finish(input.dataset.cancelRename !== "true"));
    heading.replaceWith(input);
    input.focus();
    input.select();
  }

  beginChallengeTitleRename(heading, kind, challenge, index) {
    const labels = { combat: "Combate", event: "Evento", quiz: "Reto", decision: "Decisión", dialogue: "Diálogo" };
    const baseLabel = labels[kind] || "Elemento";
    const defaultTitle = `${baseLabel} ${index + 1}`;
    const input = document.createElement("input");
    input.type = "text";
    input.className = "challenge-title-rename";
    input.maxLength = 80;
    input.setAttribute("aria-label", `Nombre de ${baseLabel.toLocaleLowerCase()}`);
    input.value = ["combat", "event"].includes(kind)
      ? (challenge.name ? `${baseLabel} ${challenge.name}` : defaultTitle)
      : (challenge.name || defaultTitle);
    let finished = false;
    const finish = (commit) => {
      if (finished) return;
      finished = true;
      if (commit) {
        const value = input.value.trim().slice(0, 80);
        if (["combat", "event"].includes(kind)) {
          const prefix = kind === "combat" ? /^combate(?:\s+|$)/i : /^evento(?:\s+|$)/i;
          const suffix = value.replace(prefix, "").trim();
          challenge.name = !value || value === defaultTitle ? "" : suffix;
        } else {
          challenge.name = !value || value === defaultTitle ? "" : value;
        }
      }
      if (kind === "combat") this.renderCombatEditor();
      else if (kind === "event") this.renderEventEditor();
      else if (kind === "quiz") this.renderQuizEditor();
      else if (kind === "dialogue") this.renderDialogueCards();
      else this.renderChoiceList();
      if (commit) this.markDirty();
    };
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        input.blur();
      } else if (event.key === "Escape") {
        event.preventDefault();
        input.dataset.cancelRename = "true";
        input.blur();
      }
    });
    input.addEventListener("blur", () => finish(input.dataset.cancelRename !== "true"));
    heading.replaceWith(input);
    input.focus();
    input.select();
  }

  commitSpeakerInput() {
    if (!this.scene || !this.activeDialogue) return;
    this.activeDialogue.speaker = this.dom.speakerInput.value;
    this.project.addCharacter(this.dom.speakerInput.value);
    this.renderSpeakerOptions();
    this.markDirty();
  }

  setDialogueLanguageControl(language = "und") {
    const normalized = String(language || "und").trim() || "und";
    const isListed = [...this.dom.languageInput.options].some((option) => option.value === normalized);
    this.dom.languageInput.value = isListed ? normalized : "custom";
    this.dom.languageCustomField.hidden = isListed;
    setNativeInputValue(this.dom.languageCustomInput, isListed ? "" : normalized);
    this.dialogueRichText.setLanguage(normalized, this.activeDialogue?.text?.dir || "auto");
  }

  renderResourceSectionHeadings() {
    const labels = { sound: "Sonido", video: "Vídeo", transitions: "Tiempos y transiciones" };
    document.querySelectorAll("[data-rename-resource-section]").forEach((heading) => {
      const key = heading.dataset.renameResourceSection;
      heading.textContent = this.project.resourceSectionNames?.[key] || labels[key] || heading.textContent;
      heading.title = "Doble clic para cambiar el nombre";
    });
  }

  updateDialogueLanguage() {
    if (!this.activeDialogue) return;
    const usesCustomCode = this.dom.languageInput.value === "custom";
    this.dom.languageCustomField.hidden = !usesCustomCode;
    const language = usesCustomCode
      ? (this.dom.languageCustomInput.value.trim() || "und")
      : (this.dom.languageInput.value || "und");
    this.activeDialogue.text.lang = language;
    this.dialogueRichText.setLanguage(language, this.activeDialogue.text.dir);
    this.markDirty();
  }

  renderAll({ renderTree = true } = {}) {
    this.renderResourceSectionHeadings();
    this.renderModuleTabs();
    if (renderTree) this.renderModuleTree();
    else this.updateModuleTreeSelection();
    this.renderAssets();
    this.renderInventoryGrid();
    this.renderAdventureMapEditor();
this.renderSoundResources();
    this.renderVideoResources();
    this.renderMapResourceControls();
    this.renderMapPanel();
    this.renderObjectAttributeDefinitions();
    this.renderCharacterSheet();
    this.renderCharacterEditor();
    this.renderChoiceList();
    this.renderQuizEditor();
this.renderCombatEditor();
    this.renderEventEditor();
    this.dom.sceneFinalCheckbox.checked = Boolean(this.scene?.isFinal);
    this.dom.sceneFinalType.value = this.scene?.finalType || "";
    this.dom.sceneFinalType.disabled = !this.scene?.isFinal;
    this.renderCueList();
    this.renderInspector();
    this.applyTheme();
    this.renderPreview();
    this.renderModuleGraph();
    this.renderStatistics();
  }

  renderInventoryGrid() {
    const { inventoryGridSelect: select, inventoryGridSummary: summary, inventoryGridBoard: board } = this.dom;
    if (!select || !summary || !board || !this.project) return;

    if (!select.options.length) {
      const options = document.createDocumentFragment();
      INVENTORY_GRID_PRESETS.forEach(({ columns, rows }) => {
        const option = document.createElement("option");
        option.value = `${columns}x${rows}`;
        option.textContent = `${columns} × ${rows} · ${columns * rows} espacios`;
        options.append(option);
      });
      select.replaceChildren(options);
    }

    const grid = normalizeInventoryGrid(this.project.inventoryGrid);
    this.project.inventoryGrid = grid;
    const total = grid.columns * grid.rows;
    select.value = `${grid.columns}x${grid.rows}`;
    select.disabled = this.isPreviewing;
    const summaryText = `${total} espacios · ${grid.columns} × ${grid.rows}`;
    summary.textContent = summaryText;
    if (this.dom.inventoryPanelSummary) this.dom.inventoryPanelSummary.textContent = summaryText;

    const hintCapacitySelect = this.dom.inventoryHintCapacity;
    if (hintCapacitySelect) {
      if (!hintCapacitySelect.options.length) {
        const options = document.createDocumentFragment();
        INVENTORY_HINT_SPACE_PRESETS.forEach((capacity) => {
          const option = document.createElement("option");
          option.value = String(capacity);
          option.textContent = `${capacity} espacios`;
          options.append(option);
        });
        hintCapacitySelect.replaceChildren(options);
      }
      this.project.inventoryHintCapacity = normalizeInventoryHintCapacity(this.project.inventoryHintCapacity);
      hintCapacitySelect.value = String(this.project.inventoryHintCapacity);
      hintCapacitySelect.disabled = this.isPreviewing;
    }

    const renderBoard = (gridBoard, items = []) => {
      const isLiveInventory = gridBoard === this.dom.inventoryItems;
      gridBoard.style.setProperty("--inventory-columns", String(grid.columns));
      gridBoard.setAttribute("aria-label", `Cuadrícula del inventario: ${grid.columns} columnas por ${grid.rows} filas, ${total} espacios`);

      const slots = document.createDocumentFragment();
      for (let index = 1; index <= total; index += 1) {
        const slot = document.createElement("div");
        slot.className = "inventory-grid-slot";
        const item = items[index - 1];
        const asset = item ? CombinationRules.resource(this.project, item.assetId) : null;
        const assetType = item ? CombinationRules.resourceType(this.project, item.assetId) : null;
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
      if (isLiveInventory && assetType === "image") appendInventoryAttributeInfo(slot, asset, this.project, this.player.inventory.attributeBonuses.get(item.assetId));
          if (isLiveInventory && this.pendingCombination) {
            slot.classList.add("is-combination-target");
          }
          if (isLiveInventory && this.pendingQuizAnswerId) slot.classList.add("is-quiz-target");

          const remove = document.createElement("button");
          remove.type = "button";
          remove.className = "inventory-item-remove";
          remove.textContent = "×";
          remove.setAttribute("aria-label", `Retirar ${asset?.name || "objeto"} del inventario`);
          remove.title = "Retirar del inventario";
          remove.disabled = !this.isPreviewing;
          remove.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.player.inventory.remove(item.assetId);
            if (this.pendingCombination?.kind === "inventory" && this.pendingCombination.sourceAssetId === item.assetId) {
              this.cancelPendingCombination();
            }
            this.setInventoryMessage(`${asset?.name || "Objeto"} retirado del inventario.`, false);
            this.renderInventoryGrid();
          });
          slot.append(remove);

          const controls = document.createElement("div");
          controls.className = "inventory-item-controls";
          const quantity = document.createElement("span");
          quantity.className = "inventory-item-quantity";
          quantity.textContent = String(item.quantity);
          quantity.setAttribute("aria-label", `Cantidad: ${item.quantity}`);
          controls.append(quantity);
          if (isLiveInventory && this.isPreviewing && CombinationRules.canStart(this.project, item.assetId)) {
            const combine = document.createElement("button");
            combine.type = "button";
            combine.className = "inventory-item-add";
            combine.textContent = "+";
            combine.setAttribute("aria-label", `Combinar ${asset?.name || "objeto"} con otro recurso`);
            combine.title = "Combinar con otro objeto";
            combine.addEventListener("click", (event) => {
              event.preventDefault();
              event.stopPropagation();
              this.beginInventoryCombination(item.assetId);
            });
            controls.append(combine);
          }
          slot.append(controls);
        }
        slots.append(slot);
      }
      gridBoard.replaceChildren(slots);
    };

    renderBoard(board);
    if (this.dom.inventoryItems) {
      renderBoard(this.dom.inventoryItems, this.isPreviewing ? this.player.inventory.items : []);
    }
    this.renderInventoryHints();
  }

  renderInventoryHints() {
    const capacity = normalizeInventoryHintCapacity(this.project?.inventoryHintCapacity);
    const clues = this.isPreviewing ? this.player.inventory.clues : [];
    if (this.dom.inventoryHintSummary) this.dom.inventoryHintSummary.textContent = `${capacity} espacios de pistas`;
    if (this.dom.inventoryHintsBoard) {
      const fragment = document.createDocumentFragment();
      for (let index = 0; index < capacity; index += 1) {
        const textarea = document.createElement("textarea");
        textarea.className = "inventory-clue-slot";
        textarea.rows = 2;
        textarea.readOnly = true;
        textarea.value = "";
        textarea.placeholder = "Espacio vacío";
        textarea.setAttribute("aria-label", `Espacio de pista ${index + 1}`);
        fragment.append(textarea);
      }
      this.dom.inventoryHintsBoard.replaceChildren(fragment);
    }
    const board = this.dom.pencilPanelHints;
    if (board) {
      const fragment = document.createDocumentFragment();
      clues.filter((clue) => String(clue?.text || "").trim()).forEach((clue, index) => {
        const textarea = document.createElement("textarea");
        textarea.className = "inventory-clue-slot has-clue";
        textarea.rows = 2;
        textarea.readOnly = true;
        textarea.value = clue.text;
        textarea.setAttribute("aria-label", `Pista descubierta ${index + 1}: ${clue.text}`);
        textarea.dataset.clueId = clue.id;
        fragment.append(textarea);
      });
      board.replaceChildren(fragment);
    }
  }

  inventoryCapacity() {
    const grid = normalizeInventoryGrid(this.project?.inventoryGrid);
    return grid.columns * grid.rows;
  }

  openHintOverlay(clues, trigger = null, title = "Pista") {
    const overlay = this.dom.hintOverlay;
    const content = this.dom.hintOverlayContent;
    if (!overlay || !content) return;
    if (this.dom.hintOverlayHeading) this.dom.hintOverlayHeading.textContent = title;
    const paragraphs = (clues || []).map((clue) => String(clue?.text || "").trim()).filter(Boolean);
    content.replaceChildren(...paragraphs.map((text) => {
      const paragraph = document.createElement("p");
      paragraph.textContent = text;
      return paragraph;
    }));
    this.hintOverlayReturnFocus = trigger || document.activeElement;
    overlay.hidden = false;
    overlay.setAttribute("aria-hidden", "false");
    this.dom.hintOverlayClose?.focus();
  }

  closeHintOverlay() {
    const overlay = this.dom.hintOverlay;
    if (!overlay || overlay.hidden) return;
    overlay.hidden = true;
    overlay.setAttribute("aria-hidden", "true");
    const returnFocus = this.hintOverlayReturnFocus;
    this.hintOverlayReturnFocus = null;
    if (returnFocus?.isConnected) returnFocus.focus();
  }

  collectLayerClues(detail, trigger = null) {
    const clues = (detail.clues || []).filter((clue) => String(clue.text || "").trim());
    if (!clues.length) {
      const message = "Esta imagen todavía no tiene textos de pista.";
      this.setPencilMessage(message, true);
      this.setPlaybackStatus(message);
      return;
    }
    let added = 0;
    let alreadyFound = 0;
    let full = false;
    clues.forEach((clue) => {
      const result = this.player.inventory.addClue(`${detail.sceneId}:${detail.layerId}:${clue.id}`, clue.text, {
        capacity: normalizeInventoryHintCapacity(this.project.inventoryHintCapacity),
      });
      if (result.ok) added += 1;
      else if (result.reason === "duplicate") alreadyFound += 1;
      else if (result.reason === "full") full = true;
    });
    const message = full
      ? `${added ? `Se han añadido ${added} pistas. ` : ""}No quedan espacios de pistas libres.`
      : added
      ? `${added} ${added === 1 ? "pista añadida" : "pistas añadidas"} a Pistas${alreadyFound ? `; ${alreadyFound} ya estaban anotadas` : ""}.`
        : "Estas pistas ya estaban anotadas en el inventario.";
    this.renderInventoryGrid();
    this.openHintOverlay(clues, trigger);
    if (full && added === 0) this.setPencilMessage(message, true);
  }

  inventoryResultMessage(result, name) {
    if (result.ok && result.reason === "stacked") return `Otra copia de «${name}» añadida al inventario (${result.item.quantity}).`;
    if (result.ok) return `«${name}» añadido al inventario.`;
    if (result.reason === "full") return "No queda sitio en el inventario. Libera espacio retirando un objeto.";
    if (result.reason === "unique") return "Este objeto es único y ya está en el inventario.";
    return "No se pudo añadir el objeto al inventario.";
  }

  setInventoryMessage(message, isError = false) {
    const output = this.dom.inventoryMessage;
    if (!output) return;
    output.textContent = message || "";
    output.hidden = !message;
    output.dataset.error = String(Boolean(isError));
  }

  setPencilMessage(message, isError = false) {
    const output = this.dom.pencilMessage;
    if (!output) return;
    output.textContent = message || "";
    output.hidden = !message;
    output.dataset.error = String(Boolean(isError));
  }

  handleInventoryGridClick(event) {
    if (!this.isPreviewing || event.target.closest(".inventory-item-add, .inventory-item-remove, .inventory-item-attribute-info")) return;
    const slot = event.target.closest("[data-inventory-asset-id]");
    if (!slot) return;
    const targetAssetId = slot.dataset.inventoryAssetId;
    if (this.pendingQuizAnswerId) {
      const result = this.player.answerQuiz(this.pendingQuizAnswerId, { assetId: targetAssetId });
      if (!result.ok) {
        if (this.player.state?.quizFeedback?.result === "incorrect") {
          this.pendingQuizAnswerId = null;
          this.renderInventoryGrid();
          if (this.dom.inventoryPanel && !this.dom.inventoryPanel.hidden) this.dom.inventoryToggle?.click();
          return;
        }
        return;
      }
      this.pendingQuizAnswerId = null;
      if (this.dom.inventoryPanel && !this.dom.inventoryPanel.hidden) this.dom.inventoryToggle?.click();
      return;
    }
    if (this.pendingCombination?.kind === "inventory") {
      this.completeInventoryCombination(this.pendingCombination.sourceAssetId, targetAssetId);
      return;
    }
    if (this.pendingCombination?.kind === "stage") {
      this.completeStageCombinationWithInventory(targetAssetId);
      return;
    }
    if (CombinationRules.resourceType(this.project, targetAssetId) === "sound") this.playInventorySound(targetAssetId);
  }

  beginInventoryCombination(sourceAssetId) {
    const item = this.player.inventory.items.find((candidate) => candidate.assetId === sourceAssetId);
    if (!item || !CombinationRules.canStart(this.project, sourceAssetId)) {
      this.setInventoryMessage("No hay una combinación configurada para este objeto.", true);
      return;
    }
    if (this.pendingCombination?.kind === "inventory" && this.pendingCombination.sourceAssetId === sourceAssetId) {
      this.cancelPendingCombination();
      this.setInventoryMessage("Combinación cancelada.");
      this.renderInventoryGrid();
      return;
    }
    this.pendingCombination = { kind: "inventory", sourceAssetId };
    const source = CombinationRules.resource(this.project, sourceAssetId);
    this.setInventoryMessage(`Selecciona en el inventario el segundo recurso para combinar con «${source?.name || "objeto"}».`);
    this.setPlaybackStatus(`Elige un segundo recurso del inventario para «${source?.name || "objeto"}».`);
    this.renderCombinationSoundChoices();
    this.renderInventoryGrid();
  }

  beginStageCombination(sourceLayerId, sceneId) {
    const stateLayer = this.player.state?.layers.find((layer) => layer.id === sourceLayerId);
    if (!stateLayer) return;
    if (this.pendingCombination?.kind === "stage" && this.pendingCombination.sourceLayerId === sourceLayerId) {
      this.cancelPendingCombination();
      this.setInventoryMessage("Combinación cancelada.");
      this.setPlaybackStatus("Combinación cancelada.");
      this.renderInventoryGrid();
      return;
    }
    this.pendingCombination = {
      kind: "stage",
      sourceAssetId: stateLayer.assetId,
      sourceLayerId,
      sceneId,
    };
    const source = CombinationRules.resource(this.project, stateLayer.assetId);
    const prompt = `«${source?.name || "Objeto"}» seleccionado. Haz clic en otro objeto compatible del escenario o elige uno del inventario.`;
    this.setInventoryMessage(prompt);
    this.setPlaybackStatus(prompt);
    this.renderCombinationSoundChoices();
    this.renderInventoryGrid();
    if (this.dom.inventoryPanel?.hidden) this.dom.inventoryToggle?.click();
    this.setPlaybackStatus(prompt);
  }

  renderCombinationSoundChoices() {
    const panel = this.dom.inventoryPanel;
    if (!panel || !this.pendingCombination) return;
    let container = panel.querySelector("#inventory-combination-options");
    if (!container) {
      container = document.createElement("div");
      container.id = "inventory-combination-options";
      container.className = "inventory-combination-options";
      container.setAttribute("aria-label", "Sonidos compatibles de la escena");
      panel.append(container);
    }
    const sceneId = this.pendingCombination.sceneId || this.player.state?.sceneId || this.activeSceneId;
    const sourceLayer = this.pendingCombination.sourceLayerId
      ? this.project.getScene(sceneId)?.getLayer(this.pendingCombination.sourceLayerId)
      : null;
    const sourceAssetId = this.pendingCombination.sourceAssetId;
    const scene = this.project.getScene(sceneId);
    const sounds = (scene?.soundIds || [])
      .map((soundId) => this.project.getSoundAsset(soundId))
      .filter((sound) => sound
        && CombinationRules.resolve(this.project, sourceAssetId, sound.id, sourceLayer?.id));
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
        if (this.pendingCombination?.kind === "stage") this.completeStageCombinationWithSound(sound.id);
        else this.completeInventoryCombinationWithSound(sound.id);
      });
      container.append(button);
    });
    container.hidden = false;
  }

  handleCombinationStageClick(event) {
    if (!this.isPreviewing || this.pendingCombination?.kind !== "stage") return;
    const layerElement = event.target.closest(".scene-layer[data-layer-id]");
    const targetLayerId = layerElement?.dataset.layerId;
    if (!targetLayerId || targetLayerId === this.pendingCombination.sourceLayerId) return;
    this.completeStageCombinationWithLayer(targetLayerId);
  }

  completeInventoryCombination(firstAssetId, secondAssetId) {
    const rule = CombinationRules.resolve(this.project, firstAssetId, secondAssetId);
    if (!rule) {
      this.setInventoryMessage("Esos dos recursos no tienen una combinación configurada. Elige otra imagen.", true);
      return;
    }
    const first = CombinationRules.resource(this.project, firstAssetId);
    const second = CombinationRules.resource(this.project, secondAssetId);
    const resultAsset = CombinationRules.resource(this.project, rule.resultAssetId);
    const result = this.player.inventory.combine(firstAssetId, secondAssetId, rule.resultAssetId, {
      capacity: this.inventoryCapacity(),
      unique: CombinationRules.isUnique(this.project, rule.resultAssetId),
    });
    if (!result.ok) {
      const message = result.reason === "full"
        ? "No queda sitio para el resultado. Libera espacio en el inventario."
        : result.reason === "unique"
          ? "El resultado es único y ya está en el inventario."
          : result.reason === "insufficient"
            ? "No hay suficientes unidades para hacer esa combinación."
            : "No se pudo completar la combinación.";
      this.setInventoryMessage(message, true);
      return;
    }
    this.cancelPendingCombination();
    const message = `Combinación realizada: «${first?.name || "Objeto"}» + «${second?.name || "Objeto"}» → «${resultAsset?.name || "Resultado"}».`;
    this.setInventoryMessage(message);
    this.setPlaybackStatus(message);
    this.renderInventoryGrid();
  }

  completeStageCombinationWithLayer(targetLayerId) {
    const pending = this.pendingCombination;
    const layers = this.player.state?.layers || [];
    const sourceLayer = layers.find((layer) => layer.id === pending?.sourceLayerId);
    const targetLayer = layers.find((layer) => layer.id === targetLayerId);
    if (!pending || !sourceLayer || !targetLayer) return;
    const rule = CombinationRules.resolve(this.project, sourceLayer.assetId, targetLayer.assetId, sourceLayer.id);
    if (!rule) {
      this.setInventoryMessage("Esos dos objetos no se pueden combinar.", true);
      this.setPlaybackStatus("Esos dos objetos no se pueden combinar.");
      return;
    }
    if (CombinationRules.resourceType(this.project, rule.resultAssetId) === "sound") {
      const result = this.player.inventory.add(rule.resultAssetId, { capacity: this.inventoryCapacity() });
      if (!result.ok) {
        this.setInventoryMessage("No queda sitio en el inventario para el sonido resultante.", true);
        this.setPlaybackStatus("Libera espacio antes de completar la combinación.");
        return;
      }
      this.player.state.layers = layers.filter((layer) => layer.id !== sourceLayer.id && layer.id !== targetLayer.id);
    } else {
      sourceLayer.assetId = rule.resultAssetId;
      this.player.state.layers = layers.filter((layer) => layer.id !== targetLayer.id);
    }
    const resultAsset = CombinationRules.resource(this.project, rule.resultAssetId);
    this.cancelPendingCombination();
    this.renderPreview(this.player.state);
    this.renderInventoryGrid();
    const message = `Combinación realizada: «${resultAsset?.name || "Resultado"}».`;
    this.setInventoryMessage(message);
    this.setPlaybackStatus(message);
  }

  completeStageCombinationWithInventory(targetAssetId) {
    const pending = this.pendingCombination;
    const sourceLayer = this.player.state?.layers.find((layer) => layer.id === pending?.sourceLayerId);
    if (!pending || !sourceLayer) return;
    const rule = CombinationRules.resolve(this.project, sourceLayer.assetId, targetAssetId, sourceLayer.id);
    if (!rule) {
      this.setInventoryMessage("Ese objeto del inventario no es compatible. Elige otro.", true);
      return;
    }
    let result;
    if (CombinationRules.resourceType(this.project, rule.resultAssetId) === "sound") {
      result = this.player.inventory.replace(targetAssetId, rule.resultAssetId, { capacity: this.inventoryCapacity() });
      if (result.ok) this.player.state.layers = this.player.state.layers.filter((layer) => layer.id !== sourceLayer.id);
    } else if (this.player.inventory.consume(targetAssetId)) {
      sourceLayer.assetId = rule.resultAssetId;
      result = { ok: true };
    } else {
      result = { ok: false, reason: "missing" };
    }
    if (!result.ok) {
      this.setInventoryMessage(result.reason === "full"
        ? "No queda sitio para el sonido resultante. Libera espacio en el inventario."
        : "No se pudo completar la combinación.", true);
      return;
    }
    const resultAsset = CombinationRules.resource(this.project, rule.resultAssetId);
    this.cancelPendingCombination();
    this.renderPreview(this.player.state);
    this.renderInventoryGrid();
    const message = `Combinación realizada: «${resultAsset?.name || "Resultado"}».`;
    this.setInventoryMessage(message);
    this.setPlaybackStatus(message);
  }

  completeStageCombinationWithSound(soundAssetId) {
    const pending = this.pendingCombination;
    const sourceLayer = this.player.state?.layers.find((layer) => layer.id === pending?.sourceLayerId);
    if (!pending || !sourceLayer) return;
    const rule = CombinationRules.resolve(this.project, sourceLayer.assetId, soundAssetId, sourceLayer.id);
    if (!rule) {
      this.setInventoryMessage("Ese sonido no es compatible con el objeto seleccionado.", true);
      return;
    }
    if (CombinationRules.resourceType(this.project, rule.resultAssetId) === "sound") {
      const result = this.player.inventory.add(rule.resultAssetId, { capacity: this.inventoryCapacity() });
      if (!result.ok) {
        this.setInventoryMessage("No queda sitio para el sonido resultante. Libera espacio en el inventario.", true);
        return;
      }
      this.player.state.layers = this.player.state.layers.filter((layer) => layer.id !== sourceLayer.id);
    } else {
      sourceLayer.assetId = rule.resultAssetId;
    }
    const resultAsset = CombinationRules.resource(this.project, rule.resultAssetId);
    this.cancelPendingCombination();
    this.renderPreview(this.player.state);
    this.renderInventoryGrid();
    const message = `Combinación realizada: «${resultAsset?.name || "Resultado"}».`;
    this.setInventoryMessage(message);
    this.setPlaybackStatus(message);
  }

  completeInventoryCombinationWithSound(soundAssetId) {
    const pending = this.pendingCombination;
    if (pending?.kind !== "inventory") return;
    const rule = CombinationRules.resolve(this.project, pending.sourceAssetId, soundAssetId);
    if (!rule) {
      this.setInventoryMessage("Ese sonido no es compatible con el objeto seleccionado.", true);
      return;
    }
    const result = this.player.inventory.replace(pending.sourceAssetId, rule.resultAssetId, {
      capacity: this.inventoryCapacity(),
      unique: CombinationRules.isUnique(this.project, rule.resultAssetId),
    });
    if (!result.ok) {
      this.setInventoryMessage(result.reason === "full"
        ? "No queda sitio para el resultado. Libera espacio en el inventario."
        : result.reason === "unique"
          ? "El resultado es único y ya está en el inventario."
          : "No se pudo completar la combinación.", true);
      return;
    }
    const sound = this.project.getSoundAsset(soundAssetId);
    const resultAsset = CombinationRules.resource(this.project, rule.resultAssetId);
    this.cancelPendingCombination();
    this.renderInventoryGrid();
    const message = `Combinación realizada con «${sound?.name || "sonido"}»: «${resultAsset?.name || "Resultado"}».`;
    this.setInventoryMessage(message);
    this.setPlaybackStatus(message);
  }

  cancelPendingCombination() {
    this.pendingCombination = null;
    this.dom.inventoryPanel?.querySelector("#inventory-combination-options")?.remove();
  }

  playInventorySound(assetId) {
    const sound = this.project.getSoundAsset(assetId);
    if (!sound?.dataUrl || typeof Audio !== "function") return;
    const audio = new Audio(sound.dataUrl);
    audio.volume = sound.volumePercent / 100;
    this.player.audioElements.push(audio);
    audio.play()?.catch(() => {});
    this.setPlaybackStatus(`Reproduciendo «${sound.name || "sonido"}».`);
  }

  updateInventoryGrid() {
    if (!this.project || !this.dom.inventoryGridSelect) return;
    const [columns, rows] = this.dom.inventoryGridSelect.value.split("x").map(Number);
    this.project.inventoryGrid = normalizeInventoryGrid({ columns, rows });
    this.renderInventoryGrid();
    this.markDirty("Capacidad del inventario actualizada.");
  }

  renderAdventureMapEditor() {
    const { mapGridSize: sizeSelect, mapGridSummary: summary, mapGridBoard: board } = this.dom;
    if (!this.project || !sizeSelect || !summary || !board) return;
    const map = this.project.adventureMap = normalizeAdventureMap(this.project.adventureMap);
    if (!sizeSelect.options.length) {
      sizeSelect.replaceChildren(...MAP_GRID_PRESETS.map((size) => {
        const option = document.createElement("option");
        option.value = String(size);
        option.textContent = `${size} × ${size} · ${size * size} casillas`;
        return option;
      }));
    }
    sizeSelect.value = String(map.size);
    sizeSelect.disabled = this.isPreviewing;
    summary.textContent = `${map.size} × ${map.size} · ${map.size * map.size} casillas`;
    board.style.setProperty("--map-grid-size", String(map.size));
    board.setAttribute("aria-label", `Mapa de ${map.size} por ${map.size} casillas`);
    const maxVisibleIndex = (map.size - 1) * MAP_GRID_MAX_SIZE + map.size - 1;
    if (this.selectedMapCellIndex > maxVisibleIndex
      || (Math.floor(this.selectedMapCellIndex / MAP_GRID_MAX_SIZE) >= map.size)
      || (this.selectedMapCellIndex % MAP_GRID_MAX_SIZE >= map.size)) {
      this.selectedMapCellIndex = 0;
    }
    const cells = document.createDocumentFragment();
    for (let row = 1; row <= map.size; row += 1) {
      for (let column = 1; column <= map.size; column += 1) {
        const index = (row - 1) * MAP_GRID_MAX_SIZE + column - 1;
        const cell = map.cells[index];
        const button = document.createElement("button");
        button.type = "button";
        button.className = `map-editor-cell${index === this.selectedMapCellIndex ? " is-selected" : ""}${cell.initiallyUnlocked ? " is-initially-unlocked" : ""}`;
        button.dataset.mapCellIndex = String(index);
        button.setAttribute("role", "gridcell");
        button.setAttribute("aria-pressed", String(index === this.selectedMapCellIndex));
        button.setAttribute("aria-label", `Casilla ${row}, ${column}${cell.moduleNumber ? `, escena ${cell.moduleNumber}` : ", sin escena asignada"}${cell.initiallyUnlocked ? ", disponible desde el inicio" : ""}`);
        const coordinate = document.createElement("span");
        coordinate.className = "map-editor-cell-coordinate";
        coordinate.textContent = `${row},${column}`;
        const moduleNumber = document.createElement("strong");
        moduleNumber.className = "map-editor-cell-module";
        moduleNumber.textContent = cell.moduleNumber ? String(cell.moduleNumber) : "—";
        button.append(coordinate, moduleNumber);
const linkedLayer = this.project.scenes
  .flatMap((scene) => scene.stage.layers.map((layer) => ({ scene, layer })))
  .find(({ layer }) => layer.mapCellKey === `${row}:${column}`);
if (linkedLayer) {
const asset = this.project.getAsset(linkedLayer.layer.assetId);
const linkedAsset = document.createElement("span");
linkedAsset.className = "map-editor-cell-asset";
linkedAsset.textContent = asset?.name || "Imagen vinculada";
linkedAsset.title = `${asset?.name || "Imagen"} · ${linkedLayer.scene.name}`;
button.append(linkedAsset);
}
        cells.append(button);
      }
    }
    board.replaceChildren(cells);

    const selectedRow = Math.floor(this.selectedMapCellIndex / MAP_GRID_MAX_SIZE) + 1;
    const selectedColumn = (this.selectedMapCellIndex % MAP_GRID_MAX_SIZE) + 1;
    const selectedCell = map.cells[this.selectedMapCellIndex];
    if (this.dom.mapCellCoordinate) this.dom.mapCellCoordinate.textContent = `Casilla ${selectedRow}, ${selectedColumn}`;
    setNativeInputValue(this.dom.mapCellModuleNumber, selectedCell?.moduleNumber || "");
    if (this.dom.mapCellModuleNumber) this.dom.mapCellModuleNumber.disabled = this.isPreviewing;
    if (this.dom.mapCellInitiallyUnlocked) {
      this.dom.mapCellInitiallyUnlocked.checked = Boolean(selectedCell?.initiallyUnlocked);
      this.dom.mapCellInitiallyUnlocked.disabled = this.isPreviewing;
    }
    const targetScene = selectedCell?.moduleNumber && this.project.getSceneByModuleNumber(selectedCell.moduleNumber);
    if (this.dom.mapCellTargetStatus) {
      this.dom.mapCellTargetStatus.textContent = !selectedCell?.moduleNumber
        ? "Sin escena asignada."
        : targetScene
          ? `Escena ${targetScene.moduleNumber}: ${targetScene.name}`
          : `La escena ${selectedCell.moduleNumber} aún no existe en el proyecto.`;
    }

    const imageSelect = this.dom.mapImageSelect;
    if (imageSelect) {
      const signature = this.project.assets.map((asset) => `${asset.id}:${asset.name}`).join("|");
      if (imageSelect.dataset.mapAssetSignature !== signature) {
        const options = document.createDocumentFragment();
        const placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = this.project.assets.length ? "Selecciona la imagen del mapa" : "No hay imágenes en los recursos";
        options.append(placeholder);
        this.project.assets.forEach((asset) => {
          const option = document.createElement("option");
          option.value = asset.id;
          option.textContent = asset.name || "Imagen";
          options.append(option);
        });
        imageSelect.replaceChildren(options);
        imageSelect.dataset.mapAssetSignature = signature;
      }
      imageSelect.value = this.project.getAsset(map.imageAssetId) ? map.imageAssetId : "";
      imageSelect.disabled = this.isPreviewing || imageSelect.options.length <= 1;
    }
  }

  updateAdventureMapSize() {
    if (!this.project || !this.dom.mapGridSize) return;
    this.project.adventureMap = normalizeAdventureMap({ ...this.project.adventureMap, size: this.dom.mapGridSize.value });
    this.renderAdventureMapEditor();
    this.renderMapPanel();
    this.markDirty("Tamaño de la cuadrícula del mapa actualizado.");
  }

  updateAdventureMapCell() {
    if (!this.project) return;
    const map = this.project.adventureMap = normalizeAdventureMap(this.project.adventureMap);
    const cell = map.cells[this.selectedMapCellIndex];
    if (!cell) return;
    const rawNumber = String(this.dom.mapCellModuleNumber?.value || "").trim();
    const number = Number(rawNumber);
    cell.moduleNumber = rawNumber && Number.isSafeInteger(number) && number > 0 && number <= 9999 ? number : null;
    cell.initiallyUnlocked = Boolean(this.dom.mapCellInitiallyUnlocked?.checked);
    this.renderAdventureMapEditor();
    this.renderMapPanel();
    this.markDirty("Destino de la casilla del mapa actualizado.");
  }

  updateAdventureMapImage() {
    if (!this.project || !this.dom.mapImageSelect) return;
    this.project.adventureMap.imageAssetId = this.dom.mapImageSelect.value || null;
    this.renderMapPanel();
    this.markDirty("Imagen del mapa actualizada.");
  }

  renderMapPanel() {
    const { mapPanelArtwork: artwork, mapPanelImage: image, mapPanelGrid: board, mapPanelMessage: message } = this.dom;
    if (!this.project || !artwork || !image || !board || !message) return;
    const map = this.project.adventureMap = normalizeAdventureMap(this.project.adventureMap);
    const mapAsset = this.project.getAsset(map.imageAssetId);
    const discoveredImages = this.player?.mapCellImages || new Map();
    const hasDiscoveredImages = [...discoveredImages.values()].some((assetId) => this.project.getAsset(assetId)?.dataUrl);
    // Si la imagen elegida como fondo también se descubre como ficha, debe ocupar solo esa casilla.
    const hasMapArtwork = Boolean(mapAsset?.dataUrl && ![...discoveredImages.values()].includes(mapAsset.id));
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
      message.textContent = this.project.assets.length
        ? "Selecciona una imagen gráfica del mapa o descubre una casilla con el icono Mapa."
        : "Añade una imagen gráfica o descubre una casilla con el icono Mapa.";
    }
    board.style.setProperty("--map-grid-size", String(map.size));
    let availableCount = 0;
    const cells = document.createDocumentFragment();
    for (let row = 1; row <= map.size; row += 1) {
      for (let column = 1; column <= map.size; column += 1) {
        const cell = map.cells[(row - 1) * MAP_GRID_MAX_SIZE + column - 1];
        const scene = cell.moduleNumber ? this.project.getSceneByModuleNumber(cell.moduleNumber) : null;
        const key = `${row}:${column}`;
        const unlocked = Boolean(cell.initiallyUnlocked || this.player?.unlockedMapCells?.has(key));
        const cellElement = document.createElement("div");
        cellElement.className = "map-panel-cell";
        cellElement.dataset.mapCellKey = key;
        const button = document.createElement("button");
        button.type = "button";
        button.className = "map-panel-cell-destination";
        button.disabled = !this.isPreviewing || !unlocked || !scene;
        button.setAttribute("aria-label", scene
          ? `Fila ${row}, columna ${column}: ${scene.name}, escena ${scene.moduleNumber}${unlocked ? ", disponible" : ", sin descubrir"}`
          : `Fila ${row}, columna ${column}: destino no asignado`);
        if (scene) button.title = `${scene.name} · escena ${scene.moduleNumber}`;
        const cellImageAsset = this.project.getAsset(discoveredImages.get(key));
        let artFrame = null;
        if (cellImageAsset?.dataUrl) {
          artFrame = document.createElement("div");
          artFrame.className = "map-panel-cell-art";
          const thumbnail = document.createElement("img");
          thumbnail.className = "map-panel-cell-image";
          thumbnail.addEventListener("load", () => fitMapCellImageFrame(artFrame, thumbnail), { once: true });
          thumbnail.src = cellImageAsset.dataUrl;
          thumbnail.alt = cellImageAsset.alt || cellImageAsset.name || `Imagen de la casilla ${row}, ${column}`;
          thumbnail.draggable = false;
          artFrame.append(thumbnail);
        }
        cellElement.append(button);
        if (this.isPreviewing && cellImageAsset?.dataUrl && artFrame) {
          const noteActions = document.createElement("div");
          noteActions.className = "map-panel-note-actions";
          noteActions.setAttribute("aria-label", `Notas de la casilla ${row}, ${column}`);
          noteActions.append(this.createMapCellNoteActionButton("add", row, column, "+", "Añadir nota"));
          if (this.player?.mapCellNotes?.has(key)) {
            noteActions.append(
              this.createMapCellNoteActionButton("edit", row, column, "✎", "Editar nota"),
              this.createMapCellNoteActionButton("delete", row, column, "×", "Eliminar nota"),
            );
          }
          artFrame.append(noteActions);
        }
        if (artFrame) cellElement.append(artFrame);
        if (scene && unlocked) {
          button.dataset.mapTargetScene = scene.id;
          availableCount += 1;
        }
        cells.append(cellElement);
      }
    }
    board.replaceChildren(cells);
    board.querySelectorAll(".map-panel-cell-art").forEach((frame) => {
      const thumbnail = frame.querySelector(".map-panel-cell-image");
      const asset = this.project.getAsset(discoveredImages.get(frame.closest(".map-panel-cell")?.dataset.mapCellKey));
      fitMapCellImageFrame(frame, thumbnail, asset?.naturalWidth, asset?.naturalHeight);
    });
    if (typeof ResizeObserver === "function") {
      this.mapCellArtResizeObserver ||= new ResizeObserver((entries) => {
        entries.forEach(({ target }) => {
          const frame = target.querySelector(".map-panel-cell-art");
          const thumbnail = frame?.querySelector(".map-panel-cell-image");
          if (frame && thumbnail) fitMapCellImageFrame(frame, thumbnail);
        });
      });
      this.mapCellArtResizeObserver.disconnect();
      board.querySelectorAll(".map-panel-cell").forEach((cell) => {
        if (cell.querySelector(".map-panel-cell-art")) this.mapCellArtResizeObserver.observe(cell);
      });
    }
    if (!availableCount && hasMapContent) {
      message.hidden = false;
      message.textContent = "Aún no hay destinos disponibles. Descubre un mapa en una escena o marca casillas iniciales.";
    }
  }

  ensureMapCellNoteEditor() {
    const panel = this.dom.mapPanel;
    if (!panel) return;
    let overlay = panel.querySelector("#map-note-overlay");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "map-note-overlay";
      overlay.className = "map-note-overlay";
      overlay.hidden = true;
      overlay.setAttribute("aria-hidden", "true");
      const dialog = document.createElement("section");
      dialog.className = "map-note-dialog";
      dialog.setAttribute("role", "dialog");
      dialog.setAttribute("aria-modal", "true");
      dialog.setAttribute("aria-labelledby", "map-note-heading");
      const heading = document.createElement("h3");
      heading.id = "map-note-heading";
      heading.textContent = "Nota de la casilla";
      const coordinate = document.createElement("p");
      coordinate.id = "map-note-coordinate";
      coordinate.className = "map-note-coordinate";
      const textarea = document.createElement("textarea");
      textarea.id = "map-note-text";
      textarea.className = "map-note-text";
      textarea.setAttribute("aria-label", "Nota de esta casilla del mapa");
      textarea.placeholder = "Escribe una nota para esta casilla del mapa…";
      textarea.spellcheck = true;
      const actions = document.createElement("div");
      actions.className = "map-note-editor-actions";
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "map-note-cancel";
      cancel.dataset.mapNoteEditorAction = "cancel";
      cancel.textContent = "Cancelar";
      const save = document.createElement("button");
      save.type = "button";
      save.className = "map-note-save";
      save.dataset.mapNoteEditorAction = "save";
      save.textContent = "Guardar";
      actions.append(cancel, save);
      dialog.append(heading, coordinate, textarea, actions);
      overlay.append(dialog);
      panel.append(overlay);
    }
    this.dom.mapNoteOverlay = overlay;
    this.dom.mapNoteHeading = overlay.querySelector("#map-note-heading");
    this.dom.mapNoteCoordinate = overlay.querySelector("#map-note-coordinate");
    this.dom.mapNoteText = overlay.querySelector("#map-note-text");
    if (overlay.dataset.bound === "true") return;
    overlay.dataset.bound = "true";
    overlay.addEventListener("click", (event) => {
      const action = event.target.closest("[data-map-note-editor-action]")?.dataset.mapNoteEditorAction;
      if (!action) return;
      event.preventDefault();
      if (action === "save") this.saveMapCellNote();
      else this.closeMapCellNoteEditor();
    });
    overlay.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        this.closeMapCellNoteEditor();
      } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        this.saveMapCellNote();
      }
    });
  }

  openMapCellNoteEditor(key, row, column) {
    if (!this.isPreviewing || !this.player || !this.dom.mapNoteOverlay) return;
    this.activeMapCellNoteKey = key;
    this.dom.mapNoteHeading.textContent = `Nota de la casilla ${row}, ${column}`;
    this.dom.mapNoteCoordinate.textContent = `Casilla ${row}, columna ${column}`;
    this.dom.mapNoteText.value = this.player.mapCellNotes.get(key) || "";
    this.dom.mapNoteOverlay.hidden = false;
    this.dom.mapNoteOverlay.setAttribute("aria-hidden", "false");
    this.dom.mapNoteText.focus();
  }

  closeMapCellNoteEditor() {
    if (!this.dom.mapNoteOverlay) return;
    this.dom.mapNoteOverlay.hidden = true;
    this.dom.mapNoteOverlay.setAttribute("aria-hidden", "true");
    this.activeMapCellNoteKey = null;
  }

  saveMapCellNote() {
    const key = this.activeMapCellNoteKey;
    if (!key || !this.player) return;
    const [row, column] = key.split(":").map(Number);
    const hasNote = Boolean(this.dom.mapNoteText.value.trim());
    this.player.setMapCellNote(key, this.dom.mapNoteText.value);
    this.closeMapCellNoteEditor();
    this.renderMapPanel();
    this.setPlaybackStatus(hasNote
      ? `Nota guardada en la casilla ${row}, ${column}.`
      : `Nota eliminada de la casilla ${row}, ${column}.`);
  }

  handleMapCellNoteAction(event) {
    const button = event.target.closest("[data-map-note-action]");
    if (!button) return false;
    event.preventDefault();
    event.stopPropagation();
    const key = button.closest("[data-map-cell-key]")?.dataset.mapCellKey;
    const [row, column] = String(key || "").split(":").map(Number);
    if (!key || !this.isPreviewing || !this.player) return true;
    if (button.dataset.mapNoteAction === "delete") {
      this.player.removeMapCellNote(key);
      this.renderMapPanel();
      this.setPlaybackStatus(`Nota eliminada de la casilla ${row}, ${column}.`);
      return true;
    }
    this.openMapCellNoteEditor(key, row, column);
    return true;
  }

  createMapCellNoteActionButton(action, row, column, icon, label) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `map-cell-note-action is-${action}`;
    button.dataset.mapNoteAction = action;
    button.setAttribute("aria-label", `${label} en la casilla ${row}, ${column}`);
    button.title = `${label} · ${row}, ${column}`;
    button.textContent = icon;
    return button;
  }

  updateInventoryHintCapacity() {
    if (!this.project || !this.dom.inventoryHintCapacity) return;
    this.project.inventoryHintCapacity = normalizeInventoryHintCapacity(this.dom.inventoryHintCapacity.value);
    this.renderInventoryHints();
    this.markDirty("Espacios de pistas actualizados.");
  }

  renderStatistics() {
    const { statisticsSelect: select, statisticsChart: container, statisticsSummary: summary } = this.dom;
    if (!select || !container || !summary || !this.project) return;

    const finalTypes = ["Óptimo", "Bueno", "Regular", "Malo", "Pésimo"];
    let title;
    let data;
    if (select.value === "module-count") {
      title = "Escenas totales del juego";
      const moduleCount = this.project.scenes.length;
      data = [{ label: "Escenas", value: moduleCount }];
      summary.textContent = `${moduleCount} escena${moduleCount === 1 ? "" : "s"} jugable${moduleCount === 1 ? "" : "s"}.`;
    } else {
      title = "Tipos de finales";
      const finalScenes = this.project.scenes.filter((scene) => scene.isFinal);
      const counts = new Map(finalTypes.map((type) => [type, 0]));
      let unclassified = 0;
      finalScenes.forEach((scene) => {
        if (counts.has(scene.finalType)) counts.set(scene.finalType, counts.get(scene.finalType) + 1);
        else unclassified += 1;
      });
      data = [...counts].map(([label, value]) => ({ label, value }));
      if (unclassified > 0) data.push({ label: "Sin tipo", value: unclassified });
      summary.textContent = finalScenes.length
        ? `${finalScenes.length} escena${finalScenes.length === 1 ? "" : "s"} final${finalScenes.length === 1 ? "" : "es"}; ${unclassified} sin tipo.`
        : "Todavía no hay escenas marcadas como finales.";
    }

    const svgNamespace = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNamespace, "svg");
    svg.classList.add("statistics-svg");
    svg.setAttribute("viewBox", "0 0 340 190");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", `${title}: ${data.map(({ label, value }) => `${label}, ${value}`).join("; ")}`);

    const makeSvgElement = (tag, attributes, text = "") => {
      const element = document.createElementNS(svgNamespace, tag);
      Object.entries(attributes).forEach(([name, value]) => element.setAttribute(name, String(value)));
      if (text) element.textContent = text;
      return element;
    };

    const plot = { left: 34, right: 332, top: 14, bottom: 142 };
    const plotWidth = plot.right - plot.left;
    const plotHeight = plot.bottom - plot.top;
    const maxValue = Math.max(1, ...data.map(({ value }) => value));
    const ticks = [...new Set([0, Math.ceil(maxValue / 2), maxValue])];

    ticks.forEach((tick) => {
      const y = plot.bottom - (tick / maxValue) * plotHeight;
      svg.append(makeSvgElement("line", { x1: plot.left, x2: plot.right, y1: y, y2: y, class: "statistics-gridline" }));
      svg.append(makeSvgElement("text", { x: plot.left - 6, y: y + 3, "text-anchor": "end", class: "statistics-axis-label" }, String(tick)));
    });
    svg.append(makeSvgElement("line", { x1: plot.left, x2: plot.right, y1: plot.bottom, y2: plot.bottom, class: "statistics-axis" }));

    const slotWidth = plotWidth / Math.max(1, data.length);
    data.forEach(({ label, value }, index) => {
      const barWidth = Math.min(34, slotWidth * 0.58);
      const barHeight = (value / maxValue) * plotHeight;
      const x = plot.left + slotWidth * index + (slotWidth - barWidth) / 2;
      const y = plot.bottom - barHeight;
      const bar = makeSvgElement("rect", {
        x, y, width: barWidth, height: barHeight, rx: 3,
        class: "statistics-bar",
      });
      bar.append(makeSvgElement("title", {}, `${label}: ${value}`));
      svg.append(bar);
      svg.append(makeSvgElement("text", {
        x: x + barWidth / 2,
        y: Math.max(plot.top + 10, y - 5),
        "text-anchor": "middle",
        class: "statistics-value",
      }, String(value)));
      svg.append(makeSvgElement("text", {
        x: plot.left + slotWidth * index + slotWidth / 2,
        y: 164,
        "text-anchor": "middle",
        class: "statistics-category",
      }, label));
    });

    container.replaceChildren(svg);
  }

  updateModuleTreeSelection() {
    this.dom.moduleTree?.querySelectorAll("[data-tree-node-id], [data-toggle-folder]").forEach((button) => {
      const nodeId = button.dataset.treeNodeId || button.dataset.toggleFolder;
      const isActiveScene = button.dataset.openScene === this.activeSceneId;
      button.classList.toggle("is-selected", nodeId === this.selectedTreeNodeId || isActiveScene);
    });
  }

  renderModuleTabs() {
    if (!this.dom.moduleTabs) return;
    this.openSceneIds = this.openSceneIds.filter((sceneId) => this.project.getScene(sceneId));
    if (this.activeSceneId && !this.openSceneIds.includes(this.activeSceneId)) this.openSceneIds.push(this.activeSceneId);
    if (!this.openSceneIds.length && this.project.scenes[0]) {
      this.activeSceneId = this.project.scenes[0].id;
      this.openSceneIds = [this.activeSceneId];
    }
    const workspace = { openSceneIds: [...this.openSceneIds], activeSceneId: this.activeSceneId };
    const previousWorkspace = this.project.editorWorkspace;
    const workspaceChanged = previousWorkspace?.activeSceneId !== workspace.activeSceneId
      || !Array.isArray(previousWorkspace?.openSceneIds)
      || previousWorkspace.openSceneIds.length !== workspace.openSceneIds.length
      || previousWorkspace.openSceneIds.some((sceneId, index) => sceneId !== workspace.openSceneIds[index]);
    writeProjectWorkspace(this.project, this.openSceneIds, this.activeSceneId);
    if (workspaceChanged) {
      ProjectRepository.saveWorkspace(this.project.id, workspace).catch((error) => {
        this.setSaveStatus(`No se pudieron guardar las pestañas abiertas: ${error.message}`, true);
      });
    }
    const previousScrollLeft = this.dom.moduleTabs.scrollLeft;
    const fragment = document.createDocumentFragment();

    this.openSceneIds.forEach((sceneId) => {
      const scene = this.project.getScene(sceneId);
      if (!scene) return;
      const tab = document.createElement("div");
      tab.className = "module-tab";
      if (sceneId === this.activeSceneId) tab.classList.add("is-active");

      const activate = document.createElement("button");
      activate.type = "button";
      activate.className = "module-tab-title";
      activate.dataset.openScene = sceneId;
      activate.dataset.dragScene = sceneId;
      activate.draggable = true;
      activate.title = "Arrastra para reordenar esta pestaña";
      activate.setAttribute("role", "tab");
      activate.setAttribute("aria-selected", String(sceneId === this.activeSceneId));
      activate.textContent = scene.name || "Escena sin título";

      const close = document.createElement("button");
      close.type = "button";
      close.className = "module-tab-close";
      close.dataset.closeScene = sceneId;
      close.setAttribute("aria-label", `Cerrar ${scene.name || "escena"}`);
      close.textContent = "×";

      tab.append(activate, close);
      fragment.append(tab);
    });

    this.dom.moduleTabs.replaceChildren(fragment);
    this.dom.moduleTabs.scrollLeft = previousScrollLeft;
    window.requestAnimationFrame(() => {
      this.ensureModuleTabVisible(this.activeSceneId);
      this.updateModuleTabsPagination();
    });
  }

  ensureModuleTabVisible(sceneId) {
    const container = this.dom.moduleTabs;
    if (!container || !sceneId) return;
    const title = [...container.querySelectorAll("[data-open-scene]")]
      .find((button) => button.dataset.openScene === sceneId);
    const tab = title?.closest(".module-tab");
    if (!tab) return;

    const containerRect = container.getBoundingClientRect();
    const tabRect = tab.getBoundingClientRect();
    const tabLeft = container.scrollLeft + tabRect.left - containerRect.left;
    const tabRight = tabLeft + tabRect.width;
    if (tabLeft < container.scrollLeft) container.scrollLeft = tabLeft;
    else if (tabRight > container.scrollLeft + container.clientWidth) {
      container.scrollLeft = tabRight - container.clientWidth;
    }
  }

  updateModuleTabsPagination() {
    const container = this.dom.moduleTabs;
    const previous = this.dom.moduleTabsPrev;
    const next = this.dom.moduleTabsNext;
    if (!container || !previous || !next) return;

    const hasOverflow = container.scrollWidth > container.clientWidth + 1;
    previous.hidden = !hasOverflow;
    next.hidden = !hasOverflow;
    previous.disabled = !hasOverflow || container.scrollLeft <= 1;
    next.disabled = !hasOverflow || container.scrollLeft + container.clientWidth >= container.scrollWidth - 1;
  }

  paginateModuleTabs(direction) {
    const container = this.dom.moduleTabs;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();
    const tabs = [...container.querySelectorAll(".module-tab")].map((tab) => {
      const rect = tab.getBoundingClientRect();
      const left = container.scrollLeft + rect.left - containerRect.left;
      return { left, right: left + rect.width };
    });
    if (!tabs.length) return;

    const current = container.scrollLeft;
    const maxScroll = Math.max(0, container.scrollWidth - container.clientWidth);
    let target = current;
    if (direction > 0) {
      const boundary = current + container.clientWidth;
      const nextTab = tabs.find((tab) => tab.left >= boundary - 1)
        || tabs.find((tab) => tab.left > current + 1 && tab.right > boundary);
      target = nextTab?.left ?? maxScroll;
    } else {
      const firstVisibleIndex = tabs.findIndex((tab) => tab.right > current + 1);
      target = tabs[Math.max(0, firstVisibleIndex - 1)].left;
    }

    container.scrollTo({ left: Math.max(0, Math.min(target, maxScroll)), behavior: "smooth" });
  }

  ensureToolTabVisible(name) {
    const container = this.dom.toolTabs;
    const tab = [...(container?.querySelectorAll("[data-tab]") || [])]
      .find((candidate) => candidate.dataset.tab === name);
    if (!container || !tab) return;
    const containerRect = container.getBoundingClientRect();
    const tabRect = tab.getBoundingClientRect();
    const tabLeft = container.scrollLeft + tabRect.left - containerRect.left;
    const tabRight = tabLeft + tabRect.width;
    let targetLeft = container.scrollLeft;
    if (tabLeft < container.scrollLeft) targetLeft = tabLeft;
    else if (tabRight > container.scrollLeft + container.clientWidth) {
      targetLeft = tabRight - container.clientWidth;
    }
    if (targetLeft !== container.scrollLeft) container.scrollTo({ left: targetLeft, behavior: "smooth" });
  }

  focusToolEditorForCanvasTarget(target) {
    if (this.isPreviewing || !target?.closest) return;

    if (target.closest(".combat-box[data-combat-box]")) {
      const combatId = target.closest(".combat-box[data-combat-box]").dataset.combatBox;
      this.setSidebarSectionCollapsed("tool-combats", false, false);
      if (this.scene && combatId) {
        const expandedIds = this.expandedCombatIdsBySceneId.get(this.scene.id) || new Set();
        expandedIds.add(`${combatId}:combat`);
        this.expandedCombatIdsBySceneId.set(this.scene.id, expandedIds);
        this.renderCombatEditor();
      }
      this.focusToolEditor("combats");
      if (combatId) {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => {
            const card = [...(this.dom.combatList?.querySelectorAll("[data-combat-id][data-combat-section='combat']") || [])]
              .find((candidate) => candidate.dataset.combatId === combatId);
            if (!card) return;
            card.scrollIntoView({ block: "nearest", behavior: "smooth" });
            const scroller = document.querySelector(".authoring-scroll");
            if (!scroller) return;
            const scrollerRect = scroller.getBoundingClientRect();
            const cardRect = card.getBoundingClientRect();
            if (cardRect.top < scrollerRect.top || cardRect.bottom > scrollerRect.bottom) {
              scroller.scrollTo({ top: scroller.scrollTop + cardRect.top - scrollerRect.top - 8, behavior: "smooth" });
            }
          });
        });
      }
      return;
    }

    if (target.closest(".dialogue-box")) {
      this.focusToolEditor("dialogue");
      return;
    }
    if (target.closest(".quiz-box[data-quiz-box-role]")) {
      this.focusToolEditor("quiz");
      return;
    }
    if (target.closest(".choice-button[data-choice-id], .choice-prompt")) {
      this.focusToolEditor("decisions");
      return;
    }

    const action = target.closest(".object-action-icon[data-object-action]")?.dataset.objectAction;
    const layerElement = target.closest(".scene-layer[data-layer-id]");
    const layer = this.scene?.getLayer(layerElement?.dataset.layerId);
    if (action || layerElement) {
      const sectionByAction = {
        inventory: "objects",
        combine: "objects",
        clue: "hints",
        map: "map-resource",
        sound: "sound",
        video: "video",
      };
      const scene = this.project.getScene(layerElement?.dataset.sceneId || this.activeSceneId);
      const linkedSound = scene?.soundCues?.some((cue) => cue.imageLayerId === layer?.id);
      const linkedVideo = scene?.videoCues?.some((cue) => cue.imageLayerId === layer?.id);
      const resourceSection = sectionByAction[action]
        || (layer?.mapEnabled ? "map-resource"
          : layer?.clueEnabled ? "hints"
            : linkedVideo ? "video"
              : linkedSound ? "sound" : "objects");
      this.focusToolEditor("tool-resources", resourceSection);
      return;
    }

    if (target.closest(".map-toggle")) {
      this.focusToolEditor("tool-resources", "map-resource");
    }
  }

  focusToolEditor(tabName, resourceSection = null) {
    if (this.workspacePanelState.authoring) this.setWorkspacePanelCollapsed("authoring", false, false);
    this.showTab(tabName);
    this.dom.toolTabs?.querySelectorAll(".is-context-focus").forEach((tab) => tab.classList.remove("is-context-focus"));
    this.dom.tabPanels?.forEach((panel) => panel.classList.remove("is-context-focus"));
    if (this.toolContextAttentionTimer) window.clearTimeout(this.toolContextAttentionTimer);

    const tab = [...(this.dom.toolTabs?.querySelectorAll("[data-tab]") || [])]
      .find((candidate) => candidate.dataset.tab === tabName);
    const panel = this.dom.tabPanels.find((candidate) => candidate.dataset.panel === tabName);
    tab?.classList.add("is-context-focus");
    panel?.classList.add("is-context-focus");
    if (resourceSection) this.revealToolResourceSection(resourceSection);

    this.toolContextAttentionTimer = window.setTimeout(() => {
      tab?.classList.remove("is-context-focus");
      panel?.classList.remove("is-context-focus");
      this.toolContextAttentionTimer = null;
    }, 850);
  }

  revealToolResourceSection(sectionName) {
    const button = this.dom.sidebarToggles.find((toggle) => toggle.dataset.sidebarToggle === sectionName);
    const section = button?.closest(".sidebar-section");
    const content = button ? document.getElementById(button.getAttribute("aria-controls")) : null;
    if (!button || !content) return;
    if (content.hidden) this.setSidebarSectionCollapsed(sectionName, false, false);

    window.requestAnimationFrame(() => {
      const scroller = document.querySelector(".authoring-scroll");
      if (!scroller || !section) return;
      const scrollerRect = scroller.getBoundingClientRect();
      const sectionRect = section.getBoundingClientRect();
      if (sectionRect.top < scrollerRect.top || sectionRect.bottom > scrollerRect.bottom) {
        scroller.scrollTo({
          top: scroller.scrollTop + sectionRect.top - scrollerRect.top - 8,
          behavior: "smooth",
        });
      }
    });
  }

  updateToolTabsPagination() {
    const container = this.dom.toolTabs;
    const previous = this.dom.toolTabsPrev;
    const next = this.dom.toolTabsNext;
    if (!container || !previous || !next) return;
    const hasOverflow = container.scrollWidth > container.clientWidth + 1;
    previous.hidden = !hasOverflow;
    next.hidden = !hasOverflow;
    previous.disabled = !hasOverflow || container.scrollLeft <= 1;
    next.disabled = !hasOverflow || container.scrollLeft + container.clientWidth >= container.scrollWidth - 1;
  }

  paginateToolTabs(direction) {
    const container = this.dom.toolTabs;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();
    const tabs = [...container.querySelectorAll("[data-tab]")].map((tab) => {
      const rect = tab.getBoundingClientRect();
      const left = container.scrollLeft + rect.left - containerRect.left;
      return { left, right: left + rect.width };
    });
    if (!tabs.length) return;
    const current = container.scrollLeft;
    const maxScroll = Math.max(0, container.scrollWidth - container.clientWidth);
    let target = current;
    if (direction > 0) {
      const boundary = current + container.clientWidth;
      const nextTab = tabs.find((tab) => tab.left >= boundary - 1)
        || tabs.find((tab) => tab.left > current + 1 && tab.right > boundary);
      target = nextTab?.left ?? maxScroll;
    } else {
      const firstVisibleIndex = tabs.findIndex((tab) => tab.right > current + 1);
      target = tabs[Math.max(0, firstVisibleIndex - 1)].left;
    }
    container.scrollTo({ left: Math.max(0, Math.min(target, maxScroll)), behavior: "smooth" });
  }

  beginModuleTabDrag(event) {
    const handle = event.target.closest("[data-drag-scene]");
    if (!handle || !this.dom.moduleTabs?.contains(handle)) return;
    this.draggedModuleTabId = handle.dataset.dragScene;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", this.draggedModuleTabId);
    }
    handle.closest(".module-tab")?.classList.add("is-dragging");
  }

  allowModuleTabDrop(event) {
    if (!this.draggedModuleTabId) return;
    const target = event.target.closest(".module-tab");
    if (!target || !this.dom.moduleTabs?.contains(target)) return;
    event.preventDefault();
    this.dom.moduleTabs.querySelectorAll(".drop-before, .drop-after").forEach((tab) => {
      tab.classList.remove("drop-before", "drop-after");
    });
    const after = event.clientX > target.getBoundingClientRect().left + target.getBoundingClientRect().width / 2;
    target.classList.add(after ? "drop-after" : "drop-before");
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  }

  dropModuleTab(event) {
    if (!this.draggedModuleTabId) return;
    const target = event.target.closest(".module-tab");
    if (!target || !this.dom.moduleTabs?.contains(target)) return;
    event.preventDefault();
    const targetId = target.querySelector("[data-open-scene]")?.dataset.openScene;
    if (!targetId) return;
    const after = event.clientX > target.getBoundingClientRect().left + target.getBoundingClientRect().width / 2;
    this.reorderOpenSceneTab(this.draggedModuleTabId, targetId, after);
    this.clearModuleTabDragState();
  }

  reorderOpenSceneTab(sourceId, targetId, insertAfter) {
    if (sourceId === targetId) return;
    const sourceIndex = this.openSceneIds.indexOf(sourceId);
    if (sourceIndex < 0 || !this.openSceneIds.includes(targetId)) return;
    const [sceneId] = this.openSceneIds.splice(sourceIndex, 1);
    const targetIndex = this.openSceneIds.indexOf(targetId);
    this.openSceneIds.splice(targetIndex + (insertAfter ? 1 : 0), 0, sceneId);
    this.renderModuleTabs();
  }

  clearModuleTabDragState() {
    this.draggedModuleTabId = null;
    this.dom.moduleTabs?.querySelectorAll(".is-dragging, .drop-before, .drop-after").forEach((tab) => {
      tab.classList.remove("is-dragging", "drop-before", "drop-after");
    });
  }

  beginToolTabDrag(event) {
    const tab = event.target.closest("[data-tab]");
    if (!tab || !this.dom.toolTabs?.contains(tab)) return;
    this.draggedToolTabId = tab.dataset.tab;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", this.draggedToolTabId);
    }
    tab.classList.add("is-dragging");
  }

  allowToolTabDrop(event) {
    if (!this.draggedToolTabId) return;
    const target = event.target.closest("[data-tab]");
    if (!target || !this.dom.toolTabs?.contains(target)) return;
    event.preventDefault();
    this.dom.toolTabs.querySelectorAll(".drop-before, .drop-after").forEach((tab) => {
      tab.classList.remove("drop-before", "drop-after");
    });
    const rect = target.getBoundingClientRect();
    target.classList.add(event.clientX > rect.left + rect.width / 2 ? "drop-after" : "drop-before");
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  }

  dropToolTab(event) {
    if (!this.draggedToolTabId) return;
    const target = event.target.closest("[data-tab]");
    if (!target || !this.dom.toolTabs?.contains(target)) return;
    event.preventDefault();
    const source = [...this.dom.toolTabs.querySelectorAll("[data-tab]")]
      .find((tab) => tab.dataset.tab === this.draggedToolTabId);
    if (!source || source === target) {
      this.clearToolTabDragState();
      return;
    }
    const rect = target.getBoundingClientRect();
    if (event.clientX > rect.left + rect.width / 2) target.after(source);
    else target.before(source);
    this.clearToolTabDragState();
    this.updateToolTabsPagination();
  }

  clearToolTabDragState() {
    this.draggedToolTabId = null;
    this.dom.toolTabs?.querySelectorAll(".is-dragging, .drop-before, .drop-after").forEach((tab) => {
      tab.classList.remove("is-dragging", "drop-before", "drop-after");
    });
  }

  renderModuleTree() {
    if (!this.dom.moduleTree) return;
    const fragment = document.createDocumentFragment();

    const drawNode = (node, level = 1) => {
      const branch = document.createElement("div");
      const isModule = node.type === "scene";
      const isRoot = node.id === "main";
      const scene = isModule ? this.project.getScene(node.sceneId) : null;
      if (isModule && !scene) return null;
      const isExpanded = isRoot || this.expandedFolderIds.has(node.id);
      branch.className = isModule ? "module-tree-module-branch" : "module-tree-folder";
      const row = document.createElement("div");

      if (isModule) {
        row.className = "module-tree-entry";
        row.dataset.dropContainerId = node.id;
        row.style.paddingInlineStart = `${Math.max(0, level - 1) * 0.35}rem`;

        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "module-tree-toggle";
        toggle.dataset.toggleModule = node.id;
        toggle.setAttribute("aria-expanded", String(isExpanded));
        toggle.setAttribute("aria-label", `${isExpanded ? "Plegar" : "Desplegar"} ${scene.name || "escena"} y sus escenas hijas`);
        toggle.textContent = isExpanded ? "▾" : "▸";

        const moduleButton = document.createElement("button");
        moduleButton.type = "button";
        moduleButton.className = "module-tree-row module-tree-module-row";
        if (this.selectedTreeNodeId === node.id || scene.id === this.activeSceneId) moduleButton.classList.add("is-selected");
        moduleButton.dataset.openScene = scene.id;
        moduleButton.dataset.treeNodeId = node.id;
        moduleButton.draggable = true;
        moduleButton.setAttribute("role", "treeitem");
        moduleButton.setAttribute("aria-level", String(level));
        moduleButton.textContent = `◻ ${scene.name || "Escena sin título"}`;

        const startButton = document.createElement("button");
        startButton.type = "button";
        startButton.className = "module-tree-start";
        startButton.dataset.setStartScene = scene.id;
        startButton.setAttribute("aria-label", `Establecer ${scene.name || "escena"} como escena inicial`);
        startButton.title = startButton.getAttribute("aria-label");
        startButton.textContent = scene.id === this.project.startSceneId ? "▶" : "☆";
        startButton.setAttribute("aria-pressed", String(scene.id === this.project.startSceneId));
        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.className = "module-tree-delete";
        deleteButton.dataset.deleteScene = scene.id;
        deleteButton.setAttribute("aria-label", `Eliminar escena ${scene.name || "sin título"}`);
        deleteButton.title = deleteButton.getAttribute("aria-label");
        deleteButton.textContent = "×";
        row.append(toggle, moduleButton, startButton, deleteButton);
      } else {
        row.className = `module-tree-folder-header${isRoot ? " is-root" : ""}`;
        const folderButton = document.createElement("button");
        folderButton.type = "button";
        folderButton.className = "module-tree-row module-tree-folder-row";
        if (this.selectedTreeNodeId === node.id) folderButton.classList.add("is-selected");
        folderButton.dataset.toggleFolder = node.id;
        folderButton.dataset.dropContainerId = node.id;
        folderButton.setAttribute("aria-expanded", String(isExpanded));
        folderButton.setAttribute("aria-level", String(level));
        folderButton.textContent = `${isExpanded ? "▾" : "▸"}  ${isRoot ? "◆" : "▰"} ${node.name}`;
        row.append(folderButton);

        if (isRoot) {
          const addButton = document.createElement("button");
          addButton.type = "button";
          addButton.className = "module-tree-add-module";
          addButton.dataset.addModule = "";
          addButton.title = "Añadir nueva escena bajo main";
          addButton.setAttribute("aria-label", "Añadir nueva escena bajo main");
          addButton.innerHTML = '<span aria-hidden="true">＋</span> Añadir nueva escena';
          const expandButton = document.createElement("button");
          expandButton.type = "button";
          expandButton.className = "module-tree-expand icon-button overlay-expand-control";
          expandButton.dataset.expandMain = "";
          const mainExpanded = this.dom.moduleTree.classList.contains("is-expanded-overlay");
          expandButton.textContent = mainExpanded ? "×" : "⛶";
          expandButton.setAttribute("aria-expanded", String(mainExpanded));
          expandButton.setAttribute("aria-label", mainExpanded ? "Cerrar árbol de escenas ampliado" : "Ampliar árbol de escenas");
          expandButton.title = expandButton.getAttribute("aria-label");
          row.append(addButton, expandButton);
        }
      }
      branch.append(row);

      const children = document.createElement("div");
      children.className = "module-tree-children";
      children.hidden = !isExpanded;
      (node.children || []).forEach((child) => {
        const childBranch = drawNode(child, level + 1);
        if (childBranch) children.append(childBranch);
      });
      branch.append(children);
      return branch;
    };

    const root = drawNode(this.project.main);
    if (root) fragment.append(root);
    this.dom.moduleTree.replaceChildren(fragment);
  }

  getSelectedFolderId() {
    const selected = this.project.findTreeNode(this.selectedTreeNodeId);
    if (selected?.node?.type === "main" || selected?.node?.type === "folder") return selected.node.id;
    return selected?.parent?.id || "main";
  }

  handleModuleTreeClick(event) {
    if (event.target.closest(".module-rename-input")) return;
    const expandMainButton = event.target.closest("[data-expand-main]");
    if (expandMainButton) {
      const expanded = this.dom.moduleTree.classList.toggle("is-expanded-overlay");
      expandMainButton.textContent = expanded ? "×" : "⛶";
      expandMainButton.setAttribute("aria-expanded", String(expanded));
      expandMainButton.setAttribute("aria-label", expanded ? "Cerrar árbol de escenas ampliado" : "Ampliar árbol de escenas");
      expandMainButton.title = expandMainButton.getAttribute("aria-label");
      if (expanded) {
        const graphExpand = this.dom.graphExpand;
        graphExpand?.closest(".graph-section")?.classList.remove("is-expanded-overlay");
        if (graphExpand) {
          graphExpand.textContent = "⛶";
          graphExpand.setAttribute("aria-expanded", "false");
          graphExpand.setAttribute("aria-label", "Ampliar árbol de decisiones");
          graphExpand.title = graphExpand.getAttribute("aria-label");
        }
      }
      return;
    }
    const addModuleButton = event.target.closest("[data-add-module]");
    if (addModuleButton) {
      this.createModule("main");
      return;
    }

    const deleteButton = event.target.closest("[data-delete-scene]");
    if (deleteButton) {
      this.deleteModule(deleteButton.dataset.deleteScene);
      return;
    }

    const startButton = event.target.closest("[data-set-start-scene]");
    if (startButton) {
      this.project.setStartScene(startButton.dataset.setStartScene);
      this.renderModuleTree();
      this.renderModuleGraph();
      this.markDirty("Escena inicial actualizada.");
      return;
    }

    const folderButton = event.target.closest("[data-toggle-folder]");
    if (folderButton) {
      const folderId = folderButton.dataset.toggleFolder;
      this.selectedTreeNodeId = folderId;
      if (folderId !== "main") {
        if (this.expandedFolderIds.has(folderId)) this.expandedFolderIds.delete(folderId);
        else this.expandedFolderIds.add(folderId);
      }
      this.renderModuleTree();
      return;
    }

    const moduleToggle = event.target.closest("[data-toggle-module]");
    if (moduleToggle) {
      const nodeId = moduleToggle.dataset.toggleModule;
      this.selectedTreeNodeId = nodeId;
      if (this.expandedFolderIds.has(nodeId)) this.expandedFolderIds.delete(nodeId);
      else this.expandedFolderIds.add(nodeId);
      this.renderModuleTree();
      return;
    }

    const moduleButton = event.target.closest("[data-open-scene]");
    if (!moduleButton) return;
    this.selectedTreeNodeId = moduleButton.dataset.treeNodeId || this.selectedTreeNodeId;
    this.openScene(moduleButton.dataset.openScene);
  }

  beginModuleDrag(event) {
    const moduleButton = event.target.closest("[data-tree-node-id]");
    if (!moduleButton || !event.dataTransfer) return;
    this.draggedModuleNodeId = moduleButton.dataset.treeNodeId;
    event.dataTransfer.setData("text/plain", this.draggedModuleNodeId);
    event.dataTransfer.effectAllowed = "move";
    moduleButton.classList.add("is-dragging");
  }

  allowModuleDrop(event) {
    const target = event.target.closest("[data-drop-container-id]");
    if (!target || !this.draggedModuleNodeId) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    this.dom.moduleTree.querySelectorAll(".is-drop-target").forEach((element) => element.classList.remove("is-drop-target"));
    target.classList.add("is-drop-target");
  }

  clearModuleDropTarget(event) {
    event.target.closest("[data-drop-container-id]")?.classList.remove("is-drop-target");
  }

  dropModule(event) {
    const target = event.target.closest("[data-drop-container-id]");
    const targetId = target?.dataset.dropContainerId;
    const sourceId = this.draggedModuleNodeId || event.dataTransfer?.getData("text/plain");
    if (!sourceId || !targetId) return;
    event.preventDefault();
    if (this.project.moveModule(sourceId, targetId)) {
      this.expandedFolderIds.add(targetId);
      this.selectedTreeNodeId = sourceId;
      this.renderModuleTree();
      this.renderModuleGraph();
      this.markDirty("Dependencia de escena actualizada.");
      this.announce("Escena anidada en el nuevo destino.");
    }
    this.clearModuleDragState();
  }

  clearModuleDragState() {
    this.draggedModuleNodeId = null;
    this.dom.moduleTree?.querySelectorAll(".is-dragging, .is-drop-target").forEach((element) => {
      element.classList.remove("is-dragging", "is-drop-target");
    });
  }

  beginRenameModule(sceneId, moduleButton) {
    const scene = this.project.getScene(sceneId);
    const moduleRow = moduleButton?.parentElement;
    if (!scene || !moduleRow) return;

    const input = document.createElement("input");
    input.type = "text";
    input.className = "module-rename-input";
    input.value = scene.name || "Escena sin título";
    input.setAttribute("aria-label", `Nuevo nombre para ${scene.name || "la escena"}`);
    input.addEventListener("click", (event) => event.stopPropagation());
    input.addEventListener("dblclick", (event) => event.stopPropagation());
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        input.blur();
      } else if (event.key === "Escape") {
        event.preventDefault();
        input.dataset.cancelRename = "true";
        input.blur();
      }
    });
    input.addEventListener("blur", () => {
      const nextName = input.dataset.cancelRename ? scene.name : input.value.trim();
      if (!nextName) {
        this.renderModuleTree();
        return;
      }
      if (nextName === scene.name) {
        this.renderModuleTree();
        return;
      }
      scene.name = nextName;
      this.renderModuleTree();
      this.renderModuleTabs();
      this.renderAssets();
      this.renderModuleGraph();
      this.renderChoiceList();
      this.markDirty("Escena renombrada.");
    }, { once: true });

    moduleRow.replaceChild(input, moduleButton);
    input.focus();
    input.select();
  }

  handleModuleTabClick(event) {
    const closeButton = event.target.closest("[data-close-scene]");
    if (closeButton) {
      this.closeScene(closeButton.dataset.closeScene);
      return;
    }
    const tabButton = event.target.closest("[data-open-scene]");
    if (tabButton) this.openScene(tabButton.dataset.openScene);
  }

  openScene(sceneId) {
    const scene = this.project.getScene(sceneId);
    if (!scene) return;
    if (this.isPreviewing) this.stopPreview();
    if (this.activeSceneId) this.selectedLayerBySceneId.set(this.activeSceneId, this.selectedLayerId);
    if (this.activeSceneId) this.selectedDialogueBySceneId.set(this.activeSceneId, this.selectedDialogueId);
    if (!this.openSceneIds.includes(scene.id)) this.openSceneIds.push(scene.id);
    this.activeSceneId = scene.id;
    this.selectedChoiceId = null;
    this.selectedQuizBox = null;
    this.selectedLayerId = this.selectedLayerBySceneId.get(scene.id) ?? scene.stage.layers[0]?.id ?? null;
    this.selectedDialogueId = scene.getDialogue(this.selectedDialogueBySceneId.get(scene.id))?.id ?? scene.dialogues[0]?.id ?? null;
    this.dialogueEditorExpanded = true;
    this.selectedTreeNodeId = this.project.getModuleReferenceForScene(scene.id)?.id ?? "main";
    this.hydrateEditors();
    this.renderAll({ renderTree: false });
  }

  closeScene(sceneId) {
    if (this.openSceneIds.length <= 1) {
      this.setSaveStatus("Debe permanecer abierta al menos una escena.");
      return;
    }
    const index = this.openSceneIds.indexOf(sceneId);
    if (index < 0) return;
    this.openSceneIds.splice(index, 1);
    this.selectedLayerBySceneId.delete(sceneId);
    this.selectedDialogueBySceneId.delete(sceneId);
    if (sceneId !== this.activeSceneId) {
      this.renderModuleTabs();
      return;
    }
    this.openScene(this.openSceneIds[Math.max(0, index - 1)]);
  }

  createModule(parentId = "main") {
    const module = this.project.addScene(new SceneModule({
      name: `Escena ${this.project.scenes.length + 1}`,
      dialogues: [],
    }), parentId);
    this.expandedFolderIds.add(parentId);
    this.selectedTreeNodeId = this.project.getModuleReferenceForScene(module.id)?.id ?? "main";
    this.renderModuleTree();
    this.openScene(module.id);
    this.markDirty("Escena creada.");
    this.announce(`Escena ${module.name} creada.`);
  }

  deleteModule(sceneId) {
    const scene = this.project.getScene(sceneId);
    if (!scene) return;
    if (this.project.scenes.length <= 1) {
      this.announce("El proyecto debe conservar al menos una escena.");
      return;
    }
    const reference = this.project.getModuleReferenceForScene(sceneId);
    const parentId = (reference && this.project.findTreeNode(reference.id)?.parent?.id) || "main";
    const confirmed = window.confirm(
      `¿Eliminar la escena «${scene.name || "sin título"}»? Sus escenas hijas subirán un nivel, las decisiones que apuntaban aquí quedarán sin destino y se retirarán los recursos que no use ninguna otra escena.`,
    );
    if (!confirmed || !this.project.removeScene(sceneId)) return;

    const wasActive = this.activeSceneId === sceneId;
    this.openSceneIds = this.openSceneIds.filter((openSceneId) => openSceneId !== sceneId);
    this.selectedLayerBySceneId.delete(sceneId);
    if (reference) this.expandedFolderIds.delete(reference.id);
    if (this.selectedTreeNodeId === reference?.id || this.selectedTreeNodeId === sceneId) {
      this.selectedTreeNodeId = parentId;
    }

    if (wasActive) {
      const nextSceneId = this.openSceneIds[0] || this.project.startSceneId || this.project.scenes[0].id;
      if (!this.openSceneIds.includes(nextSceneId)) this.openSceneIds.push(nextSceneId);
      this.activeSceneId = null;
      this.selectedLayerId = null;
      this.openScene(nextSceneId);
    } else {
      this.renderAll();
    }
    this.renderModuleTree();
    this.markDirty("Escena eliminada.");
    this.announce(`Escena ${scene.name} eliminada.`);
  }

  createFolder() {
    const name = window.prompt("Nombre de la carpeta", "Nueva carpeta");
    if (name === null) return;
    const trimmedName = name.trim();
    if (!trimmedName) return;
    const parentId = this.getSelectedFolderId();
    const folder = this.project.addFolder(trimmedName, parentId);
    this.expandedFolderIds.add(parentId);
    this.selectedTreeNodeId = folder.id;
    this.renderModuleTree();
    this.markDirty("Carpeta creada.");
    this.announce(`Carpeta ${folder.name} creada.`);
  }

  destroyModuleGraph() {
    if (this.moduleGraph) {
      this.moduleGraphView = {
        zoom: this.moduleGraph.zoom(),
        pan: { ...this.moduleGraph.pan() },
      };
      this.moduleGraph.destroy();
    }
    this.moduleGraph = null;
    this.graphNodeControlLayer?.remove();
    this.graphNodeControlLayer = null;
    this.graphNodeControls.clear();
  }

  renderModuleGraph() {
    const container = this.dom.moduleGraph;
    if (!container) return;
    this.destroyModuleGraph();
    if (!window.cytoscape) {
      container.textContent = "El mapa de nodos no se ha podido cargar.";
      return;
    }

    const elements = [{ data: { id: "main", label: "main", graphLabel: "", kind: "main" } }];
    this.project.scenes.forEach((scene) => {
      elements.push({
        data: {
          id: scene.id,
          label: scene.name || "Escena sin título",
          graphLabel: "",
          kind: scene.isFinal ? "final" : scene.id === this.project.startSceneId ? "start" : "scene",
        },
      });
      elements.push({
        data: {
          id: `owner_${scene.id}`,
          source: "main",
          target: scene.id,
          kind: scene.id === this.project.startSceneId ? "start" : "owner",
        },
      });
      scene.decisions.choices.forEach((choice) => {
        if (!choice.targetSceneId || !this.project.getScene(choice.targetSceneId)) return;
        elements.push({
          data: {
            id: `decision_${scene.id}_${choice.id}`,
            source: scene.id,
            target: choice.targetSceneId,
            label: choice.label || "Decisión",
            kind: "decision",
          },
        });
      });
    });

    container.replaceChildren();
    this.moduleGraph = window.cytoscape({
      container,
      elements,
      style: [
        {
          selector: "node",
          style: {
            "background-color": "#4b5267",
            "border-width": 1,
            "border-color": "#8e96ad",
            color: "#f8f1df",
          label: "data(graphLabel)",
          shape: "ellipse",
            width: 48,
            height: 48,
          },
        },
        { selector: 'node[kind = "main"]', style: { "background-color": "#e7ae54", color: "#1b1620", width: 40, height: 40, "font-weight": "bold" } },
        { selector: 'node[kind = "start"]', style: { "background-color": "#8d6ad8", "border-color": "#e3d5ff", "border-width": 3 } },
        { selector: 'node[kind = "final"]', style: { "background-color": "#b83f45", "border-color": "#f0a0a2", "border-width": 3 } },
        { selector: "edge", style: { width: 1.5, "line-color": "#75809a", "target-arrow-color": "#75809a", "target-arrow-shape": "triangle", "curve-style": "bezier" } },
        { selector: 'edge[kind = "owner"]', style: { width: 1, "line-style": "dotted", "line-color": "#4a5061", "target-arrow-shape": "none" } },
        { selector: 'edge[kind = "start"]', style: { width: 2.5, "line-color": "#e7ae54", "target-arrow-color": "#e7ae54" } },
        { selector: 'edge[kind = "decision"]', style: { width: 2, "line-color": "#77b7ca", "target-arrow-color": "#77b7ca" } },
      ],
      layout: { name: "breadthfirst", directed: true, padding: 18, spacingFactor: 1.2, animate: false },
      minZoom: 0.35,
      maxZoom: 2.5,
    });
    if (this.moduleGraphView) this.moduleGraph.viewport(this.moduleGraphView);
    this.renderGraphNodeControls();
    this.moduleGraph.on("pan zoom resize", () => this.positionGraphNodeControls());
    this.moduleGraph.on("position", "node", () => this.positionGraphNodeControls());
    this.moduleGraph.on("layoutstop", () => this.positionGraphNodeControls());
    this.moduleGraph.on("tap", "node", (event) => {
      const sceneId = event.target.id();
      if (sceneId !== "main") this.openScene(sceneId);
    });
  }

  renderGraphNodeControls() {
    if (!this.moduleGraph || !this.dom.moduleGraph) return;
    const layer = document.createElement("div");
    layer.className = "graph-node-control-layer";
    layer.setAttribute("aria-label", "Etiquetas desplegables de los nodos");
    this.graphNodeControlLayer = layer;
    this.graphNodeControls = new Map();

    this.moduleGraph.nodes().forEach((node) => {
      const nodeId = node.id();
      const labelText = String(node.data("label") || "");
      const isExpanded = this.expandedGraphNodeIds.has(nodeId);
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "graph-node-toggle";
      toggle.dataset.graphNodeToggle = nodeId;
      toggle.setAttribute("aria-expanded", String(isExpanded));
      toggle.setAttribute("aria-label", `${isExpanded ? "Ocultar" : "Mostrar"} literal del nodo ${labelText}`);
      toggle.textContent = isExpanded ? "▾" : "▸";

      const label = document.createElement("div");
      label.className = "graph-node-label";
      label.setAttribute("role", "note");
      label.textContent = labelText;
      label.hidden = !isExpanded;

      toggle.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.toggleGraphNodeLabel(nodeId);
      });
      ["mousedown", "mouseup", "touchstart", "touchend"].forEach((type) => {
        toggle.addEventListener(type, (event) => event.stopPropagation());
      });
      label.addEventListener("click", (event) => event.stopPropagation());
      this.graphNodeControls.set(nodeId, { node, toggle, label, labelText });
      layer.append(toggle, label);
    });

    this.dom.moduleGraph.append(layer);
    this.positionGraphNodeControls();
  }

  positionGraphNodeControls() {
    if (!this.moduleGraph || !this.graphNodeControlLayer) return;
    const width = this.dom.moduleGraph.clientWidth;
    const height = this.dom.moduleGraph.clientHeight;
    this.graphNodeControls.forEach(({ node, toggle, label }) => {
      const position = node.renderedPosition();
      const radius = Math.max(node.renderedWidth(), node.renderedHeight()) / 2;
      toggle.style.left = `${position.x}px`;
      toggle.style.top = `${position.y}px`;
      if (label.hidden) return;

      const labelWidth = label.offsetWidth;
      const labelHeight = label.offsetHeight;
      let left = position.x + radius + 8;
      if (left + labelWidth > width - 4) left = position.x - radius - labelWidth - 8;
      left = Math.max(4, Math.min(width - labelWidth - 4, left));
      const top = Math.max(4, Math.min(height - labelHeight - 4, position.y - labelHeight / 2));
      label.style.left = `${left}px`;
      label.style.top = `${top}px`;
    });
  }

  toggleGraphNodeLabel(nodeId) {
    const control = this.graphNodeControls.get(nodeId);
    if (!control) return;
    if (this.expandedGraphNodeIds.has(nodeId)) this.expandedGraphNodeIds.delete(nodeId);
    else this.expandedGraphNodeIds.add(nodeId);
    const isExpanded = this.expandedGraphNodeIds.has(nodeId);
    control.toggle.textContent = isExpanded ? "▾" : "▸";
    control.toggle.setAttribute("aria-expanded", String(isExpanded));
    control.toggle.setAttribute("aria-label", `${isExpanded ? "Ocultar" : "Mostrar"} literal del nodo ${control.labelText}`);
    control.label.hidden = !isExpanded;
    this.positionGraphNodeControls();
  }

  zoomGraph(factor) {
    if (!this.moduleGraph) return;
    this.moduleGraph.zoom({
      level: this.moduleGraph.zoom() * factor,
      renderedPosition: {
        x: this.dom.moduleGraph.clientWidth / 2,
        y: this.dom.moduleGraph.clientHeight / 2,
      },
    });
    this.moduleGraphView = { zoom: this.moduleGraph.zoom(), pan: { ...this.moduleGraph.pan() } };
  }

  fitGraph() {
    if (!this.moduleGraph) return;
    this.moduleGraph.fit(undefined, 18);
    this.moduleGraph.center();
    this.moduleGraphView = { zoom: this.moduleGraph.zoom(), pan: { ...this.moduleGraph.pan() } };
  }

  buildGraphSvg({ light = false } = {}) {
    if (!this.moduleGraph) return null;
    const graphNodes = this.moduleGraph.nodes().map((node) => {
      const label = String(node.data("label") || "");
      const lines = [];
      let line = "";
      label.split(/\s+/).forEach((word) => {
        const nextLine = line ? `${line} ${word}` : word;
        if (nextLine.length > 18 && line) {
          lines.push(line);
          line = word;
        } else line = nextLine;
      });
      if (line) lines.push(line);
      const width = Math.max(node.width(), ...lines.map((value) => value.length * 7 + 22));
      const height = Math.max(node.height(), lines.length * 16 + 14);
      const position = node.position();
      return { id: node.id(), kind: node.data("kind"), label, lines, x: position.x, y: position.y, width, height };
    });
    if (!graphNodes.length) return null;
    const byId = new Map(graphNodes.map((node) => [node.id, node]));
    const bounds = graphNodes.reduce((result, node) => ({
      minX: Math.min(result.minX, node.x - node.width / 2),
      minY: Math.min(result.minY, node.y - node.height / 2),
      maxX: Math.max(result.maxX, node.x + node.width / 2),
      maxY: Math.max(result.maxY, node.y + node.height / 2),
    }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
    const padding = 42;
    const width = Math.max(1, bounds.maxX - bounds.minX + padding * 2);
    const height = Math.max(1, bounds.maxY - bounds.minY + padding * 2);
    const offsetX = padding - bounds.minX;
    const offsetY = padding - bounds.minY;

    const edges = this.moduleGraph.edges().map((edge) => {
      const source = byId.get(edge.data("source"));
      const target = byId.get(edge.data("target"));
      if (!source || !target) return "";
      const kind = edge.data("kind");
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const distance = Math.hypot(dx, dy) || 1;
      const unitX = dx / distance;
      const unitY = dy / distance;
      const sameNode = source.id === target.id;
      const insetFor = (node) => Math.min(
        Math.abs(unitX) > 0 ? node.width / 2 / Math.abs(unitX) : Infinity,
        Math.abs(unitY) > 0 ? node.height / 2 / Math.abs(unitY) : Infinity,
      );
      const sourceInset = sameNode ? 0 : insetFor(source);
      const targetInset = sameNode ? 0 : insetFor(target);
      const x1 = source.x + (sameNode ? 0 : unitX * sourceInset) + offsetX;
      const y1 = source.y + (sameNode ? -source.height / 2 : unitY * sourceInset) + offsetY;
      const x2 = target.x + (sameNode ? 0 : -unitX * targetInset) + offsetX;
      const y2 = target.y + (sameNode ? target.height / 2 : -unitY * targetInset) + offsetY;
      const stroke = kind === "start"
        ? (light ? "#a56a00" : "#e7ae54")
        : kind === "decision"
          ? (light ? "#16819a" : "#77b7ca")
          : (light ? "#858b98" : "#596174");
      const dash = kind === "owner" ? ' stroke-dasharray="4 5"' : "";
      const marker = kind === "owner" ? "" : ` marker-end="url(#${kind === "start" ? "arrow-gold" : "arrow-blue"})"`;
      const pathData = sameNode
        ? `M ${x1} ${y1} C ${x1 + 42} ${y1 - 14}, ${x2 + 42} ${y2 + 14}, ${x2} ${y2}`
        : `M ${x1} ${y1} L ${x2} ${y2}`;
      const path = `<path d="${pathData}" fill="none" stroke="${stroke}" stroke-width="${kind === "start" ? 3 : 2}"${dash}${marker}/>`;
      const label = String(edge.data("label") || "");
      const edgeLabel = label
        ? `<text x="${sameNode ? x1 + 42 : (x1 + x2) / 2}" y="${sameNode ? y1 - 14 : (y1 + y2) / 2 - 6}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="11" fill="${light ? "#343946" : "#d8e4e7"}">${escapeMarkup(label)}</text>`
        : "";
      return path + edgeLabel;
    }).join("");
    const nodes = graphNodes.map((node) => {
      const x = node.x + offsetX;
      const y = node.y + offsetY;
      const color = node.kind === "main"
        ? (light ? "#f6c96e" : "#e7ae54")
        : node.kind === "final"
          ? (light ? "#f2aaaa" : "#b83f45")
          : node.kind === "start"
          ? (light ? "#e8ddff" : "#8d6ad8")
          : (light ? "#f1f3f7" : "#4b5267");
      const border = node.kind === "final"
        ? (light ? "#ad343a" : "#f0a0a2")
        : node.kind === "start" ? (light ? "#7452b8" : "#e3d5ff") : (light ? "#596174" : "#8e96ad");
      const text = node.kind === "main" || light ? "#202433" : "#f8f1df";
      const startY = y - ((node.lines.length - 1) * 16) / 2 + 4;
      const lines = node.lines.map((value, index) => `<tspan x="${x}" dy="${index ? 16 : 0}">${escapeMarkup(value)}</tspan>`).join("");
      const borderWidth = node.kind === "start" || node.kind === "final" ? 3 : 1.5;
      return `<g><rect x="${x - node.width / 2}" y="${y - node.height / 2}" width="${node.width}" height="${node.height}" rx="12" fill="${color}" stroke="${border}" stroke-width="${borderWidth}"/><text x="${x}" y="${startY}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="12" font-weight="600" fill="${text}">${lines}</text></g>`;
    }).join("");

    const blueArrow = light ? "#16819a" : "#77b7ca";
    const goldArrow = light ? "#a56a00" : "#e7ae54";
    const background = light ? "#ffffff" : "#11141c";
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="graph-title graph-description"><title id="graph-title">Flujo de ${escapeMarkup(this.project.title || "la aventura")}</title><desc id="graph-description">Escenas y decisiones de la aventura interactiva</desc><defs><marker id="arrow-blue" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="${blueArrow}"/></marker><marker id="arrow-gold" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="${goldArrow}"/></marker></defs><rect width="100%" height="100%" fill="${background}"/>${edges}${nodes}</svg>`;
  }

  exportGraphSvg() {
    const svg = this.buildGraphSvg({ light: true });
    if (!svg) {
      this.setSaveStatus("No hay un flujo que exportar.", true);
      return;
    }
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `flujo-${slugify(this.project.title || "aventura")}.svg`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    this.setSaveStatus("Flujo vectorial SVG descargado.");
  }

  printGraph() {
    const svg = this.buildGraphSvg({ light: true });
    if (!svg) {
      this.setSaveStatus("No hay un flujo que imprimir.", true);
      return;
    }
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      this.setSaveStatus("El navegador bloqueó la ventana de impresión.", true);
      return;
    }
    const title = `Flujo de ${this.project.title || "la aventura"}`;
    printWindow.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${escapeMarkup(title)}</title><style>@page{size:A4 landscape;margin:12mm}*{box-sizing:border-box}html,body{width:100%;height:100%;margin:0}body{display:grid;grid-template-rows:auto 1fr;gap:1rem;padding:1rem;font-family:system-ui,sans-serif;color:#171923}h1{margin:0;font-size:18pt}svg{width:100%;height:100%;max-height:calc(100vh - 4rem)}@media print{body{padding:0}svg{max-height:none}}</style></head><body><h1>${escapeMarkup(title)}</h1>${svg}<script>window.addEventListener('load',()=>setTimeout(()=>{window.focus();window.print()},150));window.addEventListener('afterprint',()=>window.close());</script></body></html>`);
    printWindow.document.close();
    this.setSaveStatus("Vista de impresión abierta; desde el diálogo puedes imprimir o guardar como PDF.");
  }

  openAbout() {
    const dialog = this.dom.aboutDialog;
    if (!dialog) return;
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  }

  showWelcomeIfNeeded() {
    const dialog = this.dom.welcomeDialog;
    if (!dialog) return;
    try {
      if (window.localStorage.getItem(WELCOME_DISMISSED_KEY) === "true") return;
    } catch {
      // Si el navegador bloquea el almacenamiento, la bienvenida sigue disponible en esta sesión.
    }
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  }

  persistWelcomePreference() {
    if (!this.dom.welcomeDoNotShow?.checked) return;
    try {
      window.localStorage.setItem(WELCOME_DISMISSED_KEY, "true");
    } catch {
      // No impedimos cerrar la ventana si el almacenamiento local no está disponible.
    }
  }

  renderPreview(state = null) {
    if (!this.scene) return;
    if (this.pendingCombination && state?.sceneId && this.pendingCombination.sceneId !== state.sceneId) {
      this.cancelPendingCombination();
    }
    this.renderCanvasStyle();
    const view = state || {
      layers: this.scene.stage.layers,
      dialogue: this.scene.dialogue,
      dialogues: this.scene.dialogues,
      decisions: this.scene.decisions,
      quizChallenges: this.scene.quizChallenges,
      combatChallenges: this.scene.combatChallenges,
    };
    const decisions = view.decisions || this.scene.decisions;
    this.applyDecisionStyle(decisions);

    const layersFragment = document.createDocumentFragment();
    view.layers.forEach((layer) => {
      const asset = this.project.getAsset(layer.assetId);
      if (!asset) return;
      const layerElement = document.createElement("div");
      layerElement.className = "scene-layer";
      if (!this.isPreviewing && layer.id === this.selectedLayerId) layerElement.classList.add("is-selected");
      layerElement.dataset.layerId = layer.id;
      layerElement.style.left = `${layer.xPct}%`;
      layerElement.style.top = `${layer.yPct}%`;
      layerElement.style.width = `${layer.widthPct}%`;
      layerElement.style.zIndex = String(layer.zIndex);
      layerElement.style.opacity = String(layer.opacity);

      const image = new Image();
      image.alt = asset.alt;
      image.draggable = false;
      image.addEventListener("load", () => this.captureAssetDimensions(asset, image), { once: true });
      image.src = asset.dataUrl;
      layerElement.append(image);
      if (!this.isPreviewing && layer.id === this.selectedLayerId) {
        Object.entries(RESIZE_CORNERS).forEach(([corner, { label }]) => {
          const handle = document.createElement("button");
          handle.type = "button";
          handle.className = "resize-handle";
          handle.dataset.resizeHandle = corner;
          handle.setAttribute("aria-label", label);
          handle.tabIndex = -1;
          layerElement.append(handle);
        });
      }
      this.appendObjectActionIcons(layerElement, layer, asset, state?.sceneId || this.activeSceneId);
      layersFragment.append(layerElement);
    });
    (view.transitions || []).forEach((transition) => {
      if (!this.isPreviewing || !transition) return;
      const durationMs = Math.max(1, Number(transition.durationMs) || 1);
      const elapsedMs = Math.max(0, performance.now() - (Number(transition.startedAt) || 0));
      if (transition.type === "fade-black" || transition.type === "fade-white") {
        const cover = document.createElement("div");
        cover.className = `scene-transition-cover ${transition.type === "fade-white" ? "is-white" : "is-black"}`;
        cover.style.animationDuration = `${durationMs}ms`;
        cover.style.animationDelay = `-${elapsedMs}ms`;
        layersFragment.append(cover);
        return;
      }
      const layer = view.layers.find((candidate) => candidate.id === transition.layerId);
      const asset = this.project.getAsset(transition.toAssetId);
      if (!layer || !asset) return;
      const incoming = document.createElement("div");
      incoming.className = `scene-transition-image ${transition.type === "slide" ? "is-slide" : "is-crossfade"}`;
      incoming.style.left = `${layer.xPct}%`;
      incoming.style.top = `${layer.yPct}%`;
      incoming.style.width = `${layer.widthPct}%`;
      incoming.style.zIndex = String(layer.zIndex);
      incoming.style.opacity = String(layer.opacity);
      const image = new Image();
      image.src = asset.dataUrl;
      image.alt = asset.alt || asset.name || "Imagen entrante";
      image.draggable = false;
      image.style.animationDuration = `${durationMs}ms`;
      image.style.animationDelay = `-${elapsedMs}ms`;
      incoming.append(image);
      layersFragment.append(incoming);
    });
    this.dom.stageLayers.replaceChildren(layersFragment);
    const dialogues = Array.isArray(view.dialogues)
      ? view.dialogues
      : [view.dialogue || this.scene.dialogue].filter(Boolean);
    const dialogueFragment = document.createDocumentFragment();
    dialogues.forEach((dialogue) => {
      const dialogueElement = document.createElement("section");
      dialogueElement.className = "dialogue-box";
      dialogueElement.dataset.dialogueId = dialogue.id;
      dialogueElement.tabIndex = 0;
      dialogueElement.addEventListener("keydown", (event) => this.handleCanvasObjectDelete(event, "dialogue", dialogue.id));
      dialogueElement.setAttribute("aria-describedby", "keyboard-movement-hint");
      dialogueElement.setAttribute("aria-label", "Caja de diálogo. Arrástrala o usa las flechas para moverla.");
      dialogueElement.hidden = dialogue.visible === false;
      dialogueElement.style.zIndex = String(dialogue.zIndex ?? 2);
      const placement = dialogue.placement || {};
      dialogueElement.style.left = `${placement.xPct ?? 50}%`;
      dialogueElement.style.top = `${placement.yPct ?? 69}%`;
      dialogueElement.style.width = `${placement.widthPct ?? 88}%`;
      dialogueElement.style.height = placement.heightPct == null ? "" : `${placement.heightPct}%`;
      dialogueElement.style.backgroundColor = dialogue.backgroundColor || "";
      dialogueElement.classList.toggle("has-custom-size", placement.heightPct != null);
      if (!this.isPreviewing && dialogue.id === this.selectedDialogueId) dialogueElement.classList.add("is-selected");

      const speakerElement = document.createElement("p");
      speakerElement.className = "speaker-name";
      speakerElement.textContent = dialogue.speaker || "";
      const textElement = document.createElement("div");
      textElement.className = "dialogue-text";
      textElement.lang = dialogue.text?.lang || "und";
      textElement.dir = dialogue.text?.dir || "auto";
      textElement.innerHTML = dialogue.text?.html || "…";
      dialogueElement.append(speakerElement, textElement);

      if (!this.isPreviewing && dialogue.id === this.selectedDialogueId) {
        Object.entries(RESIZE_CORNERS).forEach(([corner, { label }]) => {
          const handle = document.createElement("button");
          handle.type = "button";
          handle.className = "resize-handle dialogue-resize-handle";
          handle.dataset.dialogueResizeHandle = corner;
          handle.setAttribute("aria-label", label.replace("imagen", "diálogo"));
          handle.tabIndex = -1;
          dialogueElement.append(handle);
        });
      }
      dialogueFragment.append(dialogueElement);
    });
    this.dom.dialogueLayer.replaceChildren(dialogueFragment);
    const selectedDialogue = dialogues.find((dialogue) => dialogue.id === this.selectedDialogueId) || dialogues[0];
    const placement = selectedDialogue?.placement || {};
    this.dom.dialogueCenterHorizontal.checked = Boolean(selectedDialogue)
      && this.isDialogueAtHorizontalCenter(placement.xPct ?? 50, this.getDialogueElement(selectedDialogue.id));
    this.dom.dialogueCenterVertical.checked = Boolean(selectedDialogue) && Math.abs((placement.yPct ?? 69) - 50) < 0.05;
    this.dom.dialogueZIndex.max = String(Math.max(1, this.getStackItems().length));
    this.dom.dialogueZIndex.value = String(selectedDialogue?.zIndex ?? 1);
    this.dom.dialogueZIndex.disabled = this.isPreviewing || !this.selectedDialogueId;
    if (this.isPreviewing) this.hideAlignmentGuides();

    const choicesFragment = document.createDocumentFragment();
    if (decisions.visible && decisions.choices.length > 0) {
      const prompt = document.createElement("p");
      prompt.className = "choice-prompt";
      prompt.tabIndex = 0;
      prompt.setAttribute("aria-describedby", "keyboard-movement-hint");
      prompt.setAttribute("aria-label", "Texto ¿Qué decides? Arrástralo o usa las flechas para moverlo.");
      prompt.textContent = decisions.prompt;
      prompt.style.fontSize = `${decisions.promptFontSize ?? 18}px`;
      prompt.style.color = decisions.promptColor || "#f9f4e7";
      const promptPlacement = decisions.promptPlacement || {};
      prompt.style.left = `${promptPlacement.xPct ?? 50}%`;
      prompt.style.top = `${promptPlacement.yPct ?? 62}%`;
      prompt.style.width = `${promptPlacement.widthPct ?? 88}%`;
      choicesFragment.append(prompt);
      decisions.choices.forEach((choice) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "choice-button";
        button.dataset.choiceId = choice.id;
        button.tabIndex = 0;
        button.addEventListener("keydown", (event) => this.handleCanvasObjectDelete(event, "decision", choice.id));
        if (choice.labelText?.html) button.innerHTML = choice.labelText.html;
        else button.textContent = choice.label || "Decisión sin texto";
        button.setAttribute("aria-label", choice.label || "Decisión sin texto");
        const placement = choice.placement || {};
        button.style.left = `${placement.xPct ?? 50}%`;
        button.style.top = `${placement.yPct ?? Math.min(94, 74 + decisions.choices.indexOf(choice) * 8)}%`;
        button.style.width = `${placement.widthPct ?? 78}%`;
        button.style.height = `${placement.heightPct ?? 10}%`;
        button.style.backgroundColor = choice.backgroundColor || "";
        if (!this.isPreviewing && choice.id === this.selectedChoiceId) {
          button.classList.add("is-selected");
          Object.entries(RESIZE_CORNERS).forEach(([corner, { label }]) => {
            const handle = document.createElement("span");
            handle.className = "resize-handle decision-resize-handle";
            handle.dataset.decisionResizeHandle = corner;
            handle.setAttribute("aria-label", label.replace("imagen", "decisión"));
            handle.setAttribute("role", "presentation");
            button.append(handle);
          });
        }
        choicesFragment.append(button);
      });
    }
    this.appendQuizPreview(choicesFragment, view);
    this.appendCombatPreview(choicesFragment, view);
    this.dom.choicePreview.replaceChildren(choicesFragment);
    this.dom.gamePreview.classList.toggle("is-playing", this.isPreviewing);
    this.dom.gamePreview.classList.toggle("is-editing", !this.isPreviewing);
    if (this.dom.characterPanel && !this.dom.characterPanel.hidden) this.renderPlayerCharacterPanel();
    if (!this.isPreviewing && this.clampSceneElementsToLayoutBoundary()) this.scheduleAutoSave();
  }

  appendCombatPreview(fragment, view) {
    const combats = Array.isArray(view.combatChallenges) ? view.combatChallenges : (this.scene?.combatChallenges || []);
    const states = view.combatStates || {};
    combats.forEach((challenge) => {
      const profile = readPlayerCombatProfile(this.project, challenge.enemyMaxHealth, this.player?.character);
      const box = document.createElement("section");
      box.className = "combat-box";
      box.dataset.combatBox = challenge.id;
      box.tabIndex = this.isPreviewing ? -1 : 0;
      box.addEventListener("keydown", (event) => this.handleCanvasObjectDelete(event, "combat", challenge.id));
      box.setAttribute("aria-label", `Combate contra ${challenge.enemyName || "enemigo"}`);
      const placement = challenge.placement || {};
      box.style.left = `${placement.xPct ?? 50}%`;
      box.style.top = `${placement.yPct ?? 48}%`;
      box.style.width = `${placement.widthPct ?? 90}%`;
      box.style.height = `${placement.heightPct ?? 70}%`;
      box.style.zIndex = "5";
      if (placement.heightPct != null) box.classList.add("has-custom-size");
      const fight = states[challenge.id] || {};
      const isSelected = !this.isPreviewing && this.selectedCombatBoxId === challenge.id;
      if (isSelected) {
        box.classList.add("is-selected");
        Object.entries(RESIZE_CORNERS).forEach(([corner, { label }]) => {
          const handle = document.createElement("button");
          handle.type = "button";
          handle.className = "resize-handle combat-resize-handle";
          handle.dataset.combatResizeHandle = corner;
          handle.setAttribute("aria-label", label.replace("imagen", "caja de combate"));
          handle.tabIndex = -1;
          box.append(handle);
        });
      }
      if (fight.finished && ["victory", "defeat"].includes(fight.result)) {
        const animation = fight.result === "victory" ? challenge.victoryAnimation : challenge.defeatAnimation;
        box.classList.add(`has-quiz-animation-${animation || "pulse"}`);
        box.style.setProperty("--quiz-animation-duration", `${Number(challenge.animationDurationMs) || 900}ms`);
      }

      const heading = document.createElement("header");
      heading.className = "combat-heading";
      const roundLabel = document.createElement("span");
      roundLabel.className = "combat-round-label";
      roundLabel.textContent = `Ronda ${Number(fight.rounds) || 0}/${challenge.maxRounds}`;
      heading.append(roundLabel);

      const sides = document.createElement("div");
      sides.className = "combat-sides";
      const createSide = (health, maxHealth, isPlayer) => {
        const side = document.createElement("section");
        side.className = `combat-side${isPlayer ? " is-player" : " is-enemy"}`;
        const name = document.createElement("h4");
        name.textContent = isPlayer ? profile.name : challenge.enemyName || "Enemigo";
        const hp = document.createElement("p");
        hp.className = "combat-health";
        hp.textContent = `Vida: ${Math.max(0, Number(health) || 0)} / ${Math.max(1, Number(maxHealth) || 1)}`;
        side.append(name, hp);
        (challenge.attributes || []).forEach((attribute) => {
          const row = document.createElement("p");
          row.className = "combat-stat";
          const label = document.createElement("span");
          label.textContent = attribute.name || "Atributo";
          const value = document.createElement("strong");
          const statValue = isPlayer
            ? (profile.attributes.get(normalizedCombatAttribute(attribute.name)) || 0)
            : (Number(attribute.enemyValue) || 0);
          value.textContent = String(statValue);
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
        const roll = fight.lastRolls?.[isPlayer ? "player" : "enemy"];
        if (Array.isArray(roll)) {
          const result = document.createElement("small");
          result.className = "combat-roll-result";
          result.textContent = `Tirada: ${roll.join(" + ")} = ${roll.reduce((sum, value) => sum + value, 0)}`;
          dice.append(result);
        }
        side.append(dice);
        return side;
      };
      const playerMaxHealth = Number(fight.playerMaxHealth) || profile.maxHealth || challenge.enemyMaxHealth;
      sides.append(
        createSide(fight.enemyHealth ?? challenge.enemyMaxHealth, challenge.enemyMaxHealth, false),
        createSide(fight.playerHealth ?? playerMaxHealth, playerMaxHealth, true),
      );

      const footer = document.createElement("footer");
      footer.className = "combat-footer";
      if (this.isPreviewing) {
        const inventoryLabel = document.createElement("label");
        inventoryLabel.className = "combat-item-field";
        const label = document.createElement("span");
        label.textContent = "Objeto del inventario";
        const select = document.createElement("select");
        select.className = "quiz-select";
        select.dataset.combatInventoryItem = "";
        const empty = document.createElement("option");
        empty.value = "";
        empty.textContent = "Sin objeto";
        select.append(empty);
        (this.player?.inventory?.items || []).forEach((item) => {
          const asset = this.project.getAsset(item.assetId);
          if (!asset) return;
          const option = document.createElement("option");
          option.value = asset.id;
          option.textContent = `${asset.name || "Objeto"}${Number(item.quantity) > 1 ? ` ×${item.quantity}` : ""}`;
          option.selected = asset.id === fight.selectedItemId;
          select.append(option);
        });
        inventoryLabel.append(label, select);
        footer.append(inventoryLabel);
      }
      const message = document.createElement("p");
      message.className = `combat-result${fight.result === "victory" ? " is-victory" : fight.result === "defeat" ? " is-defeat" : ""}`;
      message.setAttribute("aria-live", "polite");
      message.textContent = fight.message || (this.isPreviewing ? "" : "Vista previa · usa Probar para jugar una ronda.");
      footer.append(message);
      const play = document.createElement("button");
      play.type = "button";
      play.className = "quiz-action-button combat-play-button";
      play.dataset.combatPlay = challenge.id;
      play.textContent = "Jugar Ronda";
      play.disabled = Boolean(fight.finished);
      footer.append(play);
      box.append(heading, sides, footer);
      fragment.append(box);
    });
  }

  appendQuizPreview(fragment, view) {
    const quizzes = Array.isArray(view.quizChallenges) ? view.quizChallenges : (this.scene?.quizChallenges || []);
    const feedback = view.quizFeedback || null;
    if (!this.isPreviewing && !feedback && quizzes.length > 1) {
      this.prepareQuizEditorLayout(quizzes);
      quizzes.forEach((challenge) => this.appendQuizChallengePreview(fragment, challenge, null, quizzes));
      return;
    }
    const challenge = feedback
      ? quizzes.find((item) => item.id === feedback.quizId)
      : quizzes.find((item) => !this.player?.isQuizCompleted(item.id));
    if (!challenge) return;

    this.appendQuizChallengePreview(fragment, challenge, feedback, quizzes);
  }

  prepareQuizEditorLayout(quizzes) {
    const defaults = {
      questionPlacement: { xPct: 50, yPct: 28, widthPct: 76, heightPct: 20 },
      answerPlacement: { xPct: 50, yPct: 70, widthPct: 76, heightPct: 28 },
    };
    const isDefaultPlacement = (placement, expected) => placement
      && Object.entries(expected).every(([key, value]) => Math.abs(Number(placement[key]) - value) < 0.001);
    const columns = Math.min(2, quizzes.length);
    const rows = Math.ceil(quizzes.length / columns);
    const columnWidth = 100 / columns - 4;
    let changed = false;

    quizzes.forEach((challenge, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const rowHeight = 100 / rows;
      const centerX = (column + 0.5) * (100 / columns);
      const rowLayout = rows > 1 ? {
        question: { yPct: row * rowHeight + rowHeight * 0.22, heightPct: rowHeight * 0.36 },
        answer: { yPct: row * rowHeight + rowHeight * 0.68, heightPct: rowHeight * 0.48 },
      } : null;

      ["questionPlacement", "answerPlacement"].forEach((key) => {
        const placement = challenge[key];
        if (!isDefaultPlacement(placement, defaults[key])) return;
        placement.xPct = centerX;
        placement.widthPct = columnWidth;
        if (rowLayout) {
          const role = key === "questionPlacement" ? "question" : "answer";
          placement.yPct = rowLayout[role].yPct;
          placement.heightPct = rowLayout[role].heightPct;
        }
        changed = true;
      });
    });

    if (changed) this.scheduleAutoSave();
  }

  appendQuizChallengePreview(fragment, challenge, feedback, quizzes) {

    const createBox = (role, placement, label) => {
      const box = document.createElement("section");
      box.className = `quiz-box quiz-${role}-box`;
      box.dataset.quizId = challenge.id;
      box.dataset.quizBoxRole = role;
      box.addEventListener("keydown", (event) => this.handleCanvasObjectDelete(event, "quiz", challenge.id));
      box.setAttribute("aria-label", label);
      box.tabIndex = this.isPreviewing ? -1 : 0;
      box.style.left = `${placement?.xPct ?? 50}%`;
      box.style.top = `${placement?.yPct ?? (role === "question" ? 28 : 70)}%`;
      box.style.width = `${placement?.widthPct ?? 76}%`;
      box.style.height = `${placement?.heightPct ?? (role === "question" ? 20 : 28)}%`;
      box.style.zIndex = "4";
      const selected = !this.isPreviewing
        && this.selectedQuizBox?.quizId === challenge.id
        && this.selectedQuizBox?.role === role;
      if (selected) {
        box.classList.add("is-selected");
        Object.entries(RESIZE_CORNERS).forEach(([corner, { label: handleLabel }]) => {
          const handle = document.createElement("button");
          handle.type = "button";
          handle.className = "resize-handle quiz-resize-handle";
          handle.dataset.quizResizeHandle = corner;
          handle.setAttribute("aria-label", handleLabel.replace("imagen", "caja de Quiz"));
          handle.tabIndex = -1;
          box.append(handle);
        });
      }
      return box;
    };

    const questionBox = createBox("question", challenge.questionPlacement, "Pregunta interactiva");
    const question = document.createElement("div");
    question.className = "quiz-question-text";
    question.dir = challenge.question?.dir || "auto";
    question.lang = challenge.question?.lang || "und";
    question.innerHTML = challenge.question?.html || "<p>Pregunta sin redactar.</p>";
    questionBox.append(question);
    const answerBox = createBox("answer", challenge.answerPlacement, "Respuesta y consecuencia del Quiz");

    if (feedback?.quizId === challenge.id) {
      const isCorrect = feedback.result !== "incorrect";
      answerBox.classList.add(isCorrect ? "is-correct" : "is-incorrect");
      const outcome = (isCorrect ? challenge.outcome : challenge.incorrectOutcome) || {};
      if (outcome.type === "dialogue" && outcome.text?.html) {
        const response = document.createElement("div");
        response.className = "quiz-response-dialogue";
        response.innerHTML = outcome.text.html;
        response.dir = outcome.text.dir || "auto";
        response.lang = outcome.text.lang || "und";
        answerBox.append(response);
      } else if (outcome.type === "animation") {
        answerBox.classList.add(`has-quiz-animation-${outcome.animationType || "pulse"}`);
        answerBox.style.setProperty("--quiz-animation-duration", `${Number(outcome.animationDurationMs) || 900}ms`);
      }

      if (outcome.type === "scene" && outcome.sceneId) {
        const target = this.project.getScene(outcome.sceneId);
        if (target) {
          const action = document.createElement("button");
          action.type = "button";
          action.className = "quiz-action-button";
          action.dataset.quizAction = "scene";
          action.dataset.quizTarget = target.id;
          action.textContent = `Ir a ${target.name || `Escena ${target.moduleNumber || "destino"}`}`;
          answerBox.append(action);
        }
      } else if (outcome.type === "video" && outcome.videoId) {
        const target = this.project.getVideoAsset(outcome.videoId);
        if (target) {
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
      const hasNextQuiz = quizzes.some((item) => !this.player?.isQuizCompleted(item.id) && item.id !== challenge.id);
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
      addButton.disabled = !this.isPreviewing;
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
      input.disabled = !this.isPreviewing;
      const submit = document.createElement("button");
      submit.type = "submit";
      submit.className = "quiz-action-button";
      submit.textContent = "Responder";
      submit.disabled = !this.isPreviewing;
      form.append(input, submit);
      answerBox.append(form);
    }
    if (!this.isPreviewing) {
      const hint = document.createElement("p");
      hint.className = "quiz-preview-hint";
      hint.textContent = "Vista previa. Pulsa «Probar» para jugar este reto.";
      answerBox.append(hint);
    }
    fragment.append(questionBox, answerBox);
  }

  getCanvasLayoutBoundaryPx(bounds = this.dom.stage?.getBoundingClientRect()) {
    const iconRect = this.dom.inventoryToggle?.getBoundingClientRect();
    if (!bounds?.width || !iconRect?.width) return 0;
    const gapValue = getComputedStyle(this.dom.gamePreview).getPropertyValue("--canvas-ui-layout-gap").trim();
    const gapSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const gapPx = Number.parseFloat(gapValue) * (gapValue.endsWith("rem") ? gapSize : 1);
    return Math.max(0, iconRect.right - bounds.left + (Number.isFinite(gapPx) ? gapPx : 10));
  }

  getCanvasMinimumCenterXPct(element, bounds = this.dom.stage?.getBoundingClientRect(), widthPx = null) {
    const boundaryPx = this.getCanvasLayoutBoundaryPx(bounds);
    if (!boundaryPx || !bounds?.width) return LAYER_POSITION_MIN;
    let elementWidth = Number.isFinite(widthPx)
      ? widthPx
      : Number(element?.getBoundingClientRect?.().width) || 0;
    if (!Number.isFinite(widthPx) && element?.classList?.contains("choice-prompt") && typeof document.createRange === "function") {
      const range = document.createRange();
      range.selectNodeContents(element);
      const textWidths = [...range.getClientRects()].map((rect) => rect.width).filter((width) => width > 0);
      if (textWidths.length) elementWidth = Math.max(...textWidths);
      else if (!element.textContent?.trim()) elementWidth = 0;
      range.detach?.();
    }
    return clamp(((boundaryPx + elementWidth / 2) / bounds.width) * 100, LAYER_POSITION_MIN, LAYER_POSITION_MAX);
  }

  clearSelectedChoice() {
    this.selectedChoiceId = null;
    this.dom.choicePreview?.querySelectorAll(".choice-button.is-selected").forEach((button) => {
      button.classList.remove("is-selected", "is-dragging");
      button.querySelectorAll(".decision-resize-handle").forEach((handle) => handle.remove());
    });
    if (this.store) this.hydrateDecisionBackgroundControls();
  }

  clampSceneElementsToLayoutBoundary() {
    const bounds = this.dom.stage?.getBoundingClientRect();
    if (!bounds?.width || !this.getCanvasLayoutBoundaryPx(bounds)) return false;
    let changed = false;
    const clampPlacement = (placement, element, elementBounds = bounds) => {
      if (!placement || !element || element.hidden) return;
      const previousX = Number(placement.xPct ?? 50);
      const nextX = clamp(previousX, this.getCanvasMinimumCenterXPct(element, elementBounds), LAYER_POSITION_MAX);
      if (Math.abs(nextX - previousX) < 0.001) return;
      placement.xPct = nextX;
      element.style.left = `${nextX}%`;
      changed = true;
    };

    this.scene.stage.layers.forEach((layer) => {
      const element = [...this.dom.stageLayers.children].find((candidate) => candidate.dataset.layerId === layer.id);
      clampPlacement(layer, element);
    });
    const dialogues = this.scene.dialogues?.length ? this.scene.dialogues : [this.scene.dialogue].filter(Boolean);
    dialogues.forEach((dialogue) => clampPlacement(dialogue.placement, this.getDialogueElement(dialogue.id)));

    const choiceBounds = this.dom.choicePreview.getBoundingClientRect();
    const prompt = this.dom.choicePreview.querySelector(".choice-prompt");
    if (prompt) clampPlacement(this.scene.decisions.promptPlacement, prompt, choiceBounds);
    this.scene.decisions.choices.forEach((choice) => {
      const element = [...this.dom.choicePreview.querySelectorAll(".choice-button")]
        .find((candidate) => candidate.dataset.choiceId === choice.id);
      clampPlacement(choice.placement, element, choiceBounds);
    });
    this.scene.quizChallenges.forEach((challenge) => {
      ["question", "answer"].forEach((role) => {
        const placement = role === "question" ? challenge.questionPlacement : challenge.answerPlacement;
        const element = [...this.dom.choicePreview.querySelectorAll(".quiz-box[data-quiz-box-role]")]
          .find((candidate) => candidate.dataset.quizId === challenge.id && candidate.dataset.quizBoxRole === role);
        clampPlacement(placement, element, choiceBounds);
      });
    });
    this.scene.combatChallenges.forEach((challenge) => {
      const element = [...this.dom.choicePreview.querySelectorAll(".combat-box[data-combat-box]")]
        .find((candidate) => candidate.dataset.combatBox === challenge.id);
      clampPlacement(challenge.placement, element, choiceBounds);
    });

    if (changed) {
      const selectedLayer = this.scene.getLayer(this.selectedLayerId);
      if (selectedLayer) setNativeInputValue(this.dom.layerX, selectedLayer.xPct);
    }
    const selectedDialogue = this.scene.getDialogue(this.selectedDialogueId);
    if (selectedDialogue?.placement) {
      this.dom.dialogueCenterHorizontal.checked = this.isDialogueAtHorizontalCenter(
        selectedDialogue.placement.xPct,
        this.getDialogueElement(selectedDialogue.id),
      );
    }
    return changed;
  }

  isDialogueAtHorizontalCenter(xPct, element) {
    const bounds = this.dom.stage?.getBoundingClientRect();
    return Math.abs(xPct - Math.max(50, this.getCanvasMinimumCenterXPct(element, bounds))) < 0.05;
  }

  captureAssetDimensions(asset, image) {
    if (!asset || (asset.naturalWidth > 0 && asset.naturalHeight > 0)) return;
    if (image?.naturalWidth > 0 && image.naturalHeight > 0) {
      asset.naturalWidth = image.naturalWidth;
      asset.naturalHeight = image.naturalHeight;
    }
  }

  centerDialogueAxis(axis, shouldCenter) {
    const placement = this.activeDialogue?.placement;
    if (!placement) return;
    const currentPosition = placement[axis] ?? (axis === "xPct" ? 50 : 69);
    const restoreKey = `${this.scene.id}:${axis}`;
    if (shouldCenter) {
      if (Math.abs(currentPosition - 50) >= 0.05) this.dialogueAlignmentRestore.set(restoreKey, currentPosition);
      placement[axis] = axis === "xPct"
        ? Math.max(50, this.getCanvasMinimumCenterXPct(this.getDialogueElement(this.activeDialogue.id), this.dom.stage.getBoundingClientRect()))
        : 50;
    } else if (Math.abs(currentPosition - 50) < 0.05) {
      placement[axis] = this.dialogueAlignmentRestore.get(restoreKey) ?? (axis === "xPct" ? 35 : 69);
    }
    this.renderPreview();
    this.markDirty(shouldCenter ? "Posición del diálogo centrada." : "Alineación centrada desactivada.");
  }

  getAssetNaturalSize(asset, layerId = this.selectedLayerId) {
    if (!asset) return null;
    if (asset.naturalWidth > 0 && asset.naturalHeight > 0) {
      return { width: asset.naturalWidth, height: asset.naturalHeight };
    }

    const layerElement = [...this.dom.stageLayers.children].find((element) => element.dataset.layerId === layerId);
    const image = layerElement?.querySelector("img");
    this.captureAssetDimensions(asset, image);
    return asset.naturalWidth > 0 && asset.naturalHeight > 0
      ? { width: asset.naturalWidth, height: asset.naturalHeight }
      : null;
  }

  getNaturalWidthPct(asset, fallbackWidthPct = 55) {
    const size = this.getAssetNaturalSize(asset, null);
    if (!size || !this.scene?.stage.width) return fallbackWidthPct;
    return clamp((size.width / this.scene.stage.width) * 100, LAYER_WIDTH_MIN, LAYER_WIDTH_MAX);
  }

  setSelectedLayerSize(mode) {
    const layer = this.scene?.getLayer(this.selectedLayerId);
    const asset = layer ? this.project.getAsset(layer.assetId) : null;
    const size = this.getAssetNaturalSize(asset, layer?.id);
    if (!layer || !size) {
      this.setSaveStatus("La imagen todavía no ha indicado su tamaño original.", true);
      return;
    }

    const stage = this.scene.stage;
    const scale = mode === "fit"
      ? Math.min(stage.width / size.width, stage.height / size.height)
      : 1;
    layer.widthPct = clamp((size.width * scale / stage.width) * 100, LAYER_WIDTH_MIN, LAYER_WIDTH_MAX);
    this.renderInspector();
    this.markDirty(mode === "fit" ? "Imagen ajustada al lienzo sin deformarla." : "Imagen restaurada a su tamaño real.");
  }

  renderAssets() {
    const sceneAssets = this.project.getAssetsForScene(this.activeSceneId);
    const sceneSounds = this.project.getSoundAssetsForScene(this.activeSceneId);
    const sceneVideos = this.project.getVideoAssetsForScene(this.activeSceneId);
    this.renderCanvasBackgroundOptions();
    const resources = [
      ...sceneAssets.map((asset) => ({ type: "image", asset })),
      ...sceneSounds.map((asset) => ({ type: "sound", asset })),
      ...sceneVideos.map((asset) => ({ type: "video", asset })),
    ];
    this.dom.assetCount.textContent = String(resources.length);
    this.dom.assetCount.title = `${sceneAssets.length} imágenes, ${sceneSounds.length} sonidos MP3 y ${sceneVideos.length} vídeos en esta escena`;
    this.renderAssetModuleTabs();
    const pageSize = [2, 4, 10].includes(this.assetPageSize) ? this.assetPageSize : 4;
    this.assetPageSize = pageSize;
    const pageCount = Math.ceil(resources.length / pageSize);
    this.assetPage = Math.min(this.assetPage, Math.max(0, pageCount - 1));
    const pageStart = this.assetPage * pageSize;
    this.dom.assetPageSize.value = String(pageSize);
    this.dom.assetPageStatus.textContent = pageCount ? `${this.assetPage + 1} / ${pageCount}` : "0 / 0";
    this.dom.assetPagePrev.disabled = this.assetPage <= 0;
    this.dom.assetPageNext.disabled = this.assetPage >= pageCount - 1;
    this.dom.assetList.dataset.pageSize = String(pageSize);
    const fragment = document.createDocumentFragment();
    resources.slice(pageStart, pageStart + pageSize).forEach(({ type, asset }) => {
      const card = document.createElement("article");
      card.className = "asset-card";
card.draggable = !this.isPreviewing;
card.title = type === "image"
  ? "Arrastra la imagen al lienzo para añadirla o a otra pestaña para transferirla."
  : "Arrastra este recurso a la pestaña de otra escena para moverlo.";
      card.dataset[type === "sound" ? "soundId" : type === "video" ? "videoId" : "assetId"] = asset.id;

      if (type === "video") {
        const selectButton = document.createElement("button");
        selectButton.type = "button";
        selectButton.className = "asset-add-button video-asset-select-button";
        selectButton.dataset.selectVideo = asset.id;
        selectButton.disabled = this.isPreviewing;
        selectButton.setAttribute("aria-label", `Configurar vídeo «${asset.name}»`);
        selectButton.title = `Configurar vídeo «${asset.name}»`;
        const visual = document.createElement("span");
        visual.className = "video-asset-visual";
        visual.setAttribute("aria-hidden", "true");
        visual.innerHTML = "<span>▶</span><small>VÍDEO</small>";
        const name = document.createElement("span");
        name.className = "asset-name";
        name.textContent = asset.name;
        selectButton.append(visual, name);

        const controls = document.createElement("div");
        controls.className = "asset-card-controls";
        const positionLabel = document.createElement("label");
        positionLabel.className = "asset-stack-position";
        positionLabel.textContent = "Posición:";
        const positionInput = document.createElement("input");
        positionInput.type = "number";
        positionInput.disabled = true;
        positionInput.title = "Los vídeos no ocupan una capa visual del escenario.";
        positionInput.setAttribute("aria-label", `Posición bloqueada de ${asset.name}`);
        positionLabel.append(positionInput);
        const removeButton = document.createElement("button");
        removeButton.type = "button";
        removeButton.className = "asset-remove-button";
        removeButton.dataset.removeVideo = asset.id;
        removeButton.disabled = this.isPreviewing;
        removeButton.setAttribute("aria-label", `Quitar «${asset.name}» de la escena ${this.scene?.name || "actual"}`);
        removeButton.title = "Quitar vídeo de esta escena";
        removeButton.textContent = "×";
        controls.append(positionLabel, removeButton);
        card.append(selectButton, controls);
        fragment.append(card);
        return;
      }

      if (type === "sound") {
        const selectButton = document.createElement("button");
        selectButton.type = "button";
        selectButton.className = "asset-add-button sound-asset-select-button";
        selectButton.dataset.selectSound = asset.id;
        selectButton.disabled = this.isPreviewing;
        selectButton.setAttribute("aria-label", `Configurar sonido «${asset.name}»`);
        selectButton.title = `Configurar sonido «${asset.name}»`;
        const visual = document.createElement("span");
        visual.className = "sound-asset-visual";
        visual.setAttribute("aria-hidden", "true");
        visual.innerHTML = "<span>♫</span><small>MP3</small>";
        const name = document.createElement("span");
        name.className = "asset-name";
        name.textContent = asset.name;
        selectButton.append(visual, name);

        const controls = document.createElement("div");
        controls.className = "asset-card-controls";
        const positionLabel = document.createElement("label");
        positionLabel.className = "asset-stack-position";
        positionLabel.textContent = "Posición:";
        const positionInput = document.createElement("input");
        positionInput.type = "number";
        positionInput.disabled = true;
        positionInput.title = "Los sonidos no ocupan una capa visual del escenario.";
        positionInput.setAttribute("aria-label", `Posición bloqueada de ${asset.name}`);
        positionLabel.append(positionInput);

        const removeButton = document.createElement("button");
        removeButton.type = "button";
        removeButton.className = "asset-remove-button";
        removeButton.dataset.removeSound = asset.id;
        removeButton.disabled = this.isPreviewing;
        removeButton.setAttribute("aria-label", `Quitar «${asset.name}» de la escena ${this.scene?.name || "actual"}`);
        removeButton.title = "Quitar sonido de esta escena";
        removeButton.textContent = "×";
        controls.append(positionLabel, removeButton);
        card.append(selectButton, controls);
        fragment.append(card);
        return;
      }

      card.dataset.assetId = asset.id;

      const addButton = document.createElement("button");
      addButton.type = "button";
      addButton.className = "asset-add-button";
      addButton.dataset.assetAdd = "";
      addButton.dataset.assetId = asset.id;
      addButton.disabled = this.isPreviewing;
      const existingLayers = this.scene.stage.layers.filter((layer) => layer.assetId === asset.id);
      addButton.title = existingLayers.length
        ? `Seleccionar una capa de «${asset.name}»; pulsa + para añadir otra copia`
        : `Añadir «${asset.name}» al escenario`;
      addButton.setAttribute("aria-label", addButton.title);
      const image = new Image();
      image.src = asset.dataUrl;
      image.alt = asset.alt;
      const name = document.createElement("span");
      name.className = "asset-name";
      name.textContent = asset.name;
      addButton.append(image, name);

      const controls = document.createElement("div");
      controls.className = "asset-card-controls";
      const addLayerButton = document.createElement("button");
      addLayerButton.type = "button";
      addLayerButton.className = "asset-instance-add-button";
      addLayerButton.dataset.addLayer = asset.id;
      addLayerButton.disabled = this.isPreviewing;
      addLayerButton.setAttribute("aria-label", `Añadir otra copia de «${asset.name}» al escenario`);
      addLayerButton.title = `Añadir otra copia de «${asset.name}» al escenario`;
      addLayerButton.textContent = "+";
      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "asset-remove-button";
      removeButton.dataset.removeAsset = asset.id;
      removeButton.disabled = this.isPreviewing;
      removeButton.setAttribute("aria-label", `Quitar «${asset.name}» de la escena ${this.scene?.name || "actual"}`);
      removeButton.title = "Quitar recurso de esta escena";
      removeButton.textContent = "×";
      const assetLayers = this.scene.stage.layers
        .filter((layer) => layer.assetId === asset.id)
        .sort((left, right) => left.zIndex - right.zIndex);
      if (assetLayers.length) {
        assetLayers.forEach((layer, index) => {
          const positionLabel = document.createElement("label");
          positionLabel.className = "asset-stack-position";
          positionLabel.textContent = assetLayers.length > 1 ? `Capa ${index + 1}:` : "Posición:";
          const positionInput = document.createElement("input");
          positionInput.type = "number";
          positionInput.min = "1";
          positionInput.max = String(this.getStackItems().length);
          positionInput.step = "1";
          positionInput.value = String(layer.zIndex);
          positionInput.disabled = this.isPreviewing;
          positionInput.dataset.stackPosition = layer.id;
          positionInput.setAttribute("aria-label", `Posición de capa ${asset.name}`);
          positionLabel.append(positionInput);
          controls.append(positionLabel);
        });
      } else {
        const positionLabel = document.createElement("label");
        positionLabel.className = "asset-stack-position";
        positionLabel.textContent = "Posición:";
        const positionInput = document.createElement("input");
        positionInput.type = "number";
        positionInput.min = "1";
        positionInput.step = "1";
        positionInput.disabled = true;
        positionInput.title = "Añade la imagen al escenario para asignarle una posición.";
        positionInput.setAttribute("aria-label", `Posición de capa ${asset.name}`);
        positionLabel.append(positionInput);
        controls.append(positionLabel);
      }
      controls.append(addLayerButton, removeButton);
      card.append(addButton, controls);
      fragment.append(card);
    });
    this.dom.assetList.replaceChildren(fragment);
  }

  renderAssetModuleTabs() {
    if (!this.dom.assetModuleTabs) return;
    const fragment = document.createDocumentFragment();
    this.project.scenes.forEach((scene) => {
      const tab = document.createElement("button");
      tab.type = "button";
      tab.className = "asset-module-tab";
      tab.dataset.resourceScene = scene.id;
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", String(scene.id === this.activeSceneId));
      tab.setAttribute("aria-label", `Ver recursos de ${scene.name || "escena sin título"}; suelta aquí un recurso para moverlo y una imagen para copiarla`);
      tab.title = `Ver recursos de ${scene.name || "escena sin título"} · Suelta aquí recursos para moverlos o imágenes para copiarlas`;
      tab.textContent = scene.name || "Escena sin título";
      if (scene.id === this.activeSceneId) tab.classList.add("is-active");
      fragment.append(tab);
    });
    this.dom.assetModuleTabs.replaceChildren(fragment);
  }

beginResourceDrag(event) {
  const card = event.target.closest(".asset-card");
  if (!card || !this.dom.assetList?.contains(card) || !event.dataTransfer || this.isPreviewing) return;
  if (event.target.closest("input, select, textarea, .asset-instance-add-button, .asset-remove-button")) {
    event.preventDefault();
    return;
  }

  const soundId = card.dataset.soundId;
  const videoId = card.dataset.videoId;
  const assetId = card.dataset.assetId;
  const resource = soundId
    ? { type: "sound", id: soundId, sourceSceneId: this.activeSceneId }
    : videoId
      ? { type: "video", id: videoId, sourceSceneId: this.activeSceneId }
      : { type: "image", id: assetId, sourceSceneId: this.activeSceneId };
  if (!resource.id) return;

  this.draggedResource = resource;
  event.dataTransfer.effectAllowed = resource.type === "image" ? "copyMove" : "move";
  event.dataTransfer.setData("application/x-crowther-resource", JSON.stringify(resource));
  event.dataTransfer.setData("text/plain", resource.id);
  if (resource.type === "image" && typeof event.dataTransfer.setDragImage === "function") {
    const image = card.querySelector(".asset-add-button img");
    const bounds = image?.getBoundingClientRect();
    if (image && bounds?.width && bounds?.height) event.dataTransfer.setDragImage(image, bounds.width / 2, bounds.height / 2);
  }
  card.classList.add("is-resource-dragging");
}

allowResourceDrop(event) {
  const target = event.target.closest("[data-resource-scene]");
  if (!target || !this.draggedResource || target.dataset.resourceScene === this.draggedResource.sourceSceneId) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  this.dom.assetModuleTabs.querySelectorAll(".is-resource-drop-target").forEach((tab) => {
    tab.classList.remove("is-resource-drop-target");
  });
  target.classList.add("is-resource-drop-target");
}

clearResourceDropTarget(event) {
  const target = event.target.closest("[data-resource-scene]");
  if (!target || target.contains(event.relatedTarget)) return;
  target.classList.remove("is-resource-drop-target");
}

dropResourceOnModule(event) {
  const target = event.target.closest("[data-resource-scene]");
  const resource = this.draggedResource;
  if (!target || !resource || !this.dom.assetModuleTabs?.contains(target)) return;
  event.preventDefault();
  const targetSceneId = target.dataset.resourceScene;
  if (targetSceneId === resource.sourceSceneId) return;
  if (resource.type === "sound") {
    const moved = this.project.moveSoundAssetToScene(resource.id, resource.sourceSceneId, targetSceneId);
    this.clearResourceDragState();
    if (!moved) return;
    this.selectedSoundIdsBySceneId.set(targetSceneId, resource.id);
    this.openScene(targetSceneId);
    this.markDirty("Sonido movido a otra escena.");
    this.announce("Sonido movido a la escena seleccionada.");
    return;
  }
  if (resource.type === "video") {
    const moved = this.project.moveVideoAssetToScene(resource.id, resource.sourceSceneId, targetSceneId);
    this.clearResourceDragState();
    if (!moved) return;
    this.selectedVideoIdsBySceneId.set(targetSceneId, resource.id);
    this.openScene(targetSceneId);
    this.markDirty("Vídeo movido a otra escena.");
    this.announce("Vídeo movido a la escena seleccionada.");
    return;
  }
  const transfer = { resource: { ...resource }, targetSceneId };
  this.clearResourceDragState();
  this.openResourceTransferDialog(transfer);
}

openResourceTransferDialog(transfer) {
  const dialog = this.dom.resourceTransferDialog;
  const resource = transfer?.resource;
  const source = this.project.getScene(resource?.sourceSceneId);
  const target = this.project.getScene(transfer?.targetSceneId);
  if (!dialog || !resource || !source || !target) return;

  const item = this.project.getAsset(resource.id);
  this.pendingResourceTransfer = transfer;
  if (this.dom.resourceTransferMessage) {
    const name = item?.name || "recurso";
    this.dom.resourceTransferMessage.textContent = `¿Quieres mover o copiar «${name}» de «${source.name}» a «${target.name}»?`;
  }
  if (typeof dialog.showModal === "function" && !dialog.open) dialog.showModal();
  else dialog.setAttribute("open", "");
}

handleResourceTransferAction(event) {
  const dialog = this.dom.resourceTransferDialog;
  const button = event.target.closest("[data-resource-transfer-action]");
  if (!button || !dialog?.contains(button)) {
    if (event.target === dialog) this.closeResourceTransferDialog();
    return;
  }
  event.preventDefault();
  this.completeResourceTransfer(button.dataset.resourceTransferAction);
}

closeResourceTransferDialog() {
  const dialog = this.dom.resourceTransferDialog;
  if (dialog?.open && typeof dialog.close === "function") dialog.close();
  else dialog?.removeAttribute("open");
  this.pendingResourceTransfer = null;
}

completeResourceTransfer(action) {
  const pending = this.pendingResourceTransfer;
  if (!pending || !["move", "copy"].includes(action)) return false;

  const { resource, targetSceneId } = pending;
  const target = this.project.getScene(targetSceneId);
  if (!target) {
    this.closeResourceTransferDialog();
    this.announce("No se encontró la escena de destino.");
    return false;
  }

  const transferMethod = action === "move" ? "moveAssetToScene" : "copyAssetToScene";
  const transferred = this.project[transferMethod](resource.id, resource.sourceSceneId, targetSceneId);
  const targetHasResource = target.assetIds.includes(resource.id);
  this.closeResourceTransferDialog();

  if (!transferred && !targetHasResource) {
    this.announce("No se pudo transferir el recurso a la escena seleccionada.");
    return false;
  }

  const source = this.project.getScene(resource.sourceSceneId);
  const rememberedLayerId = this.selectedLayerBySceneId.get(resource.sourceSceneId);
  if (source && !source.getLayer(rememberedLayerId)) {
    const nextLayerId = source.stage.layers[0]?.id ?? null;
    this.selectedLayerBySceneId.set(resource.sourceSceneId, nextLayerId);
    if (this.activeSceneId === resource.sourceSceneId) this.selectedLayerId = nextLayerId;
  }
  this.openScene(targetSceneId);

  let addedImageLayer = false;
  const existingLayer = this.scene.stage.layers.find((layer) => layer.assetId === resource.id);
  if (existingLayer) {
    this.selectedLayerId = existingLayer.id;
    this.selectedDialogueId = null;
    this.selectedLayerBySceneId.set(targetSceneId, existingLayer.id);
    this.selectedDialogueBySceneId.set(targetSceneId, null);
  } else {
    this.addLayerForAsset(resource.id);
    addedImageLayer = true;
  }
  this.renderAll({ renderTree: false });

  const changed = transferred || addedImageLayer;
  if (changed) {
    const verb = action === "move" ? "movido" : "copiado";
    this.markDirty(`Recurso ${verb} a la escena ${target.name}.`);
  }
  const verb = action === "move" ? "movida" : "copiada";
  this.announce(transferred
    ? `Imagen ${verb} a la escena «${target.name}».`
    : `El recurso ya estaba en «${target.name}»; se ha abierto su lienzo.`);
  return true;
}

clearResourceDragState() {
  this.draggedResource = null;
  this.dom.assetList?.querySelectorAll(".is-resource-dragging").forEach((card) => {
    card.classList.remove("is-resource-dragging");
  });
  this.dom.assetModuleTabs?.querySelectorAll(".is-resource-drop-target").forEach((tab) => {
    tab.classList.remove("is-resource-drop-target");
  });
}

  getQuizInventoryAssets() {
    const candidates = new Map();
    this.project.assets.forEach((asset) => {
      const owners = this.project.scenes.flatMap((scene) => scene.stage.layers
        .filter((layer) => layer.assetId === asset.id)
        .map((layer) => ({ scene, collectible: layer.inventoryEnabled })));
      const owner = owners.find((candidate) => candidate.collectible) || owners[0] || null;
      candidates.set(asset.id, { asset, scene: owner?.scene || null, collectible: Boolean(owner?.collectible) });
    });
    return [...candidates.values()];
  }

  renderQuizEditor() {
    const list = this.dom.quizList;
    if (!list) return;
    const fragment = document.createDocumentFragment();
    const pendingEditors = [];
    const scene = this.scene;
    const inventoryAssets = this.getQuizInventoryAssets();
    let expandedIds = scene ? this.expandedQuizIdsBySceneId.get(scene.id) : null;
    if (scene && !expandedIds) {
      expandedIds = new Set(scene.quizChallenges.slice(0, 1).map((challenge) => challenge.id));
      this.expandedQuizIdsBySceneId.set(scene.id, expandedIds);
    }
    if (scene && expandedIds) {
      const validQuizIds = new Set(scene.quizChallenges.map((challenge) => challenge.id));
      for (const quizId of expandedIds) if (!validQuizIds.has(quizId)) expandedIds.delete(quizId);
      if (!expandedIds.size && scene.quizChallenges[0]) expandedIds.add(scene.quizChallenges[0].id);
    }

    if (!scene?.quizChallenges.length) {
      const empty = document.createElement("p");
      empty.className = "helper-text quiz-empty-state";
      empty.textContent = "Esta escena todavía no tiene retos. Usa + para crear la primera pregunta.";
      fragment.append(empty);
    }

    (scene?.quizChallenges || []).forEach((challenge, index) => {
      const card = document.createElement("article");
      card.className = "quiz-card";
      card.dataset.quizId = challenge.id;
      const isExpanded = expandedIds?.has(challenge.id) ?? false;
      card.classList.toggle("is-collapsed", !isExpanded);
      const heading = document.createElement("div");
      heading.className = "quiz-card-heading";
      const titleGroup = document.createElement("div");
      titleGroup.className = "quiz-card-title-group";
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "sidebar-collapse-toggle quiz-card-toggle";
      toggle.dataset.toggleQuiz = "";
      toggle.setAttribute("aria-expanded", String(isExpanded));
      toggle.setAttribute("aria-label", `${isExpanded ? "Plegar" : "Desplegar"} reto ${index + 1}`);
      toggle.title = `${isExpanded ? "Plegar" : "Desplegar"} reto ${index + 1}`;
      toggle.textContent = isExpanded ? "▾" : "▸";
      const title = document.createElement("h3");
      title.textContent = challenge.name || `Reto ${index + 1}`;
      title.dataset.renameQuizTitle = "";
      title.title = "Doble clic para cambiar el nombre";
      titleGroup.append(toggle, title);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "icon-button quiz-remove-button";
      remove.dataset.removeQuiz = "";
      remove.setAttribute("aria-label", `Eliminar reto ${index + 1}`);
      remove.title = "Eliminar reto";
      remove.textContent = "×";
      const actions = document.createElement("div");
      actions.className = "tool-section-actions";
      actions.append(remove);
      heading.append(titleGroup, actions);
      const content = document.createElement("div");
      content.className = "quiz-card-content";
      content.id = `quiz-card-content-${index + 1}`;
      content.hidden = !isExpanded;
      toggle.setAttribute("aria-controls", content.id);
      card.append(heading, content);

      const question = createQuizRichTextField("Pregunta", "question");
      content.append(question.field);
      pendingEditors.push({ challenge, key: "question", richText: challenge.question, ...question });

      content.append(createQuizSelectField("Tipo de respuesta", "answerType", [
        { value: "text", label: "Respuesta de texto" },
        { value: "inventory", label: "Objeto del inventario" },
      ], challenge.answerType));

      const textAnswer = document.createElement("label");
      textAnswer.className = "quiz-field full-field";
      textAnswer.dataset.quizAnswerType = "text";
      textAnswer.hidden = challenge.answerType !== "text";
      const textLabel = document.createElement("span");
      textLabel.textContent = "Respuesta esperada";
      const textInput = document.createElement("input");
      textInput.type = "text";
      textInput.dataset.quizField = "expectedText";
      textInput.autocomplete = "off";
      textInput.placeholder = "Escribe la contraseña o respuesta…";
      textInput.value = challenge.expectedText;
      textAnswer.append(textLabel, textInput);
      content.append(textAnswer);

      const inventoryAnswer = document.createElement("div");
      inventoryAnswer.className = "quiz-answer-inventory";
      inventoryAnswer.dataset.quizAnswerType = "inventory";
      inventoryAnswer.hidden = challenge.answerType !== "inventory";
      const inventoryOptions = [{ value: "", label: inventoryAssets.length ? "Selecciona el objeto correcto" : "No hay imágenes en el proyecto" }];
      inventoryAssets.forEach(({ asset, scene: owner, collectible }) => {
        inventoryOptions.push({
          value: asset.id,
          label: `${asset.name || "Objeto"} · ${owner?.name || `Escena ${owner?.moduleNumber || "sin asignar"}`}${collectible ? "" : " · requiere activar Inventario"}`,
        });
      });
      inventoryAnswer.append(createQuizSelectField("Objeto correcto", "expectedAssetId", inventoryOptions, challenge.expectedAssetId));
      const consumeLabel = document.createElement("label");
      consumeLabel.className = "quiz-checkbox-field";
      const consume = document.createElement("input");
      consume.type = "checkbox";
      consume.dataset.quizField = "consumeItem";
      consume.checked = Boolean(challenge.consumeItem);
      const consumeText = document.createElement("span");
      consumeText.textContent = "Retirar el objeto del inventario al acertar";
      consumeLabel.append(consume, consumeText);
      inventoryAnswer.append(consumeLabel);
      content.append(inventoryAnswer);

      content.append(this.createQuizOutcomeEditor(challenge, "outcome", "Consecuencia al acertar", pendingEditors));
      content.append(this.createQuizOutcomeEditor(challenge, "incorrectOutcome", "Consecuencia al fallar", pendingEditors));
      content.append(createQuizSelectField("Reintentos tras fallar", "maxRetries", Array.from({ length: 11 }, (_, retries) => ({
        value: String(retries),
        label: retries === 0 ? "0 · Sin reintentos" : `${retries} ${retries === 1 ? "reintento" : "reintentos"}`,
      })), String(challenge.maxRetries)));
      const retryHelp = document.createElement("p");
      retryHelp.className = "helper-text quiz-retry-help";
      retryHelp.textContent = "Intentos adicionales tras la primera respuesta incorrecta.";
      content.append(retryHelp);

      fragment.append(card);
    });

    list.replaceChildren(fragment);
    this.quizRichTextEditors.clear();
    pendingEditors.forEach(({ challenge, key, richText, toolbar, editor: container }) => {
      const editor = new QuillRichTextEditor(container, toolbar, {
        placeholder: key === "question" ? "Formula la pregunta para el jugador…" : `Escribe el diálogo que aparecerá ${key === "incorrectOutcome" ? "al fallar" : "al acertar"}…`,
        ariaLabel: key === "question" ? "Pregunta del reto" : `Diálogo de respuesta ${key === "incorrectOutcome" ? "incorrecta" : "correcta"}`,
      });
      editor.setHtml(richText?.html || "");
      editor.setLanguage(richText?.lang || "und", richText?.dir || "auto");
      editor.onChange((html) => {
        const nextText = new RichTextBlock({ html, lang: richText?.lang || "und", dir: richText?.dir || "auto" });
        if (key === "question") challenge.question = nextText;
        else challenge[key].text = nextText;
        this.markDirty();
        this.renderPreview();
      });
      this.quizRichTextEditors.set(`${challenge.id}:${key}`, editor);
    });
  }

  placeNewCombat(challenge) {
    const combats = this.scene?.combatChallenges || [];
    if (combats.length <= 1) return;
    const defaultPlacement = { xPct: 50, yPct: 48, widthPct: 90, heightPct: 70 };
    const isUntouched = (placement) => Object.entries(defaultPlacement)
      .every(([key, value]) => Math.abs(Number(placement?.[key]) - value) < 0.001);
    const rows = Math.ceil(combats.length / 2);
    const widthPct = 46;
    const heightPct = combats.length === 2 ? 78 : Math.max(28, Math.min(44, 90 / rows));
    const isAutomaticallyPlaced = (item, index) => {
      if (isUntouched(item.placement)) return true;
      for (let previousCount = 2; previousCount < combats.length; previousCount += 1) {
        if (index >= previousCount) continue;
        const previousRows = Math.ceil(previousCount / 2);
        const previousHeight = previousCount === 2 ? 78 : Math.max(28, Math.min(44, 90 / previousRows));
        const previousY = previousRows === 1 ? 49 : (Math.floor(index / 2) + 0.5) / previousRows * 96 + 2;
        if (Math.abs(item.placement.xPct - (index % 2 ? 74 : 26)) < 0.001
          && Math.abs(item.placement.yPct - previousY) < 0.001
          && Math.abs(item.placement.widthPct - 46) < 0.001
          && Math.abs(item.placement.heightPct - previousHeight) < 0.001) return true;
      }
      return false;
    };
    combats.forEach((item, index) => {
      if (item !== challenge && !isAutomaticallyPlaced(item, index)) return;
      const row = Math.floor(index / 2);
      item.placement.xPct = index % 2 ? 74 : 26;
      item.placement.yPct = rows === 1 ? 49 : ((row + 0.5) / rows) * 96 + 2;
      item.placement.widthPct = widthPct;
      item.placement.heightPct = heightPct;
    });
  }

  renderCombatEditor() {
    const list = this.dom.combatList;
    if (!list) return;
    const fragment = document.createDocumentFragment();
    const scene = this.scene;
    let expandedIds = scene ? this.expandedCombatIdsBySceneId.get(scene.id) : null;
    if (scene && !expandedIds) {
      expandedIds = new Set(scene.combatChallenges.slice(0, 1).flatMap((challenge) => [`${challenge.id}:combat`, `${challenge.id}:conditions`]));
      this.expandedCombatIdsBySceneId.set(scene.id, expandedIds);
    }
    if (scene && expandedIds) {
      const validIds = new Set(scene.combatChallenges.flatMap((challenge) => [`${challenge.id}:combat`, `${challenge.id}:conditions`]));
      for (const id of expandedIds) if (!validIds.has(id)) expandedIds.delete(id);
    }
    if (!scene?.combatChallenges.length) {
      const empty = document.createElement("p");
      empty.className = "helper-text quiz-empty-state";
      empty.textContent = "Esta escena todavía no tiene combates. Usa + para crear uno.";
      fragment.append(empty);
    }

    const attributeNames = [...new Set([
      ...COMBAT_ATTRIBUTE_SUGGESTIONS,
      ...(this.project.scenes || []).flatMap((module) => module.combatChallenges.flatMap((combat) => combat.attributes.map((attribute) => attribute.name))),
    ].map((name) => String(name || "").trim()).filter(Boolean))];

    (scene?.combatChallenges || []).forEach((challenge, index) => {
      const pair = document.createElement("div");
      pair.className = "combat-pair";
      const playerProfile = readPlayerCombatProfile(this.project, challenge.enemyMaxHealth, this.player?.character);
      const sections = [
        { key: "combat", title: challenge.name ? `Combate ${challenge.name}` : `Combate ${index + 1}` },
        { key: "conditions", title: `Condiciones de ${challenge.name || index + 1}` },
      ];
      const makeCard = ({ key, title }) => {
        const card = document.createElement("article");
        card.className = "quiz-card combat-card";
        card.dataset.combatId = challenge.id;
        card.dataset.combatSection = key;
        const sectionKey = `${challenge.id}:${key}`;
        const isExpanded = Boolean(expandedIds?.has(sectionKey));
        card.classList.toggle("is-collapsed", !isExpanded);
        const heading = document.createElement("div");
        heading.className = "quiz-card-heading";
        const titleGroup = document.createElement("div");
        titleGroup.className = "quiz-card-title-group";
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "sidebar-collapse-toggle quiz-card-toggle";
        toggle.dataset.toggleCombat = "";
        toggle.setAttribute("aria-expanded", String(isExpanded));
        toggle.setAttribute("aria-label", `${isExpanded ? "Plegar" : "Desplegar"} ${title}`);
        toggle.textContent = isExpanded ? "▾" : "▸";
        const headingTitle = document.createElement("h3");
        headingTitle.textContent = title;
        if (key === "combat") {
          headingTitle.dataset.renameCombatTitle = "";
          headingTitle.title = "Doble clic para cambiar el nombre";
        }
        titleGroup.append(toggle, headingTitle);
        const actions = document.createElement("div");
        actions.className = "tool-section-actions";
        if (key === "combat") {
          const remove = document.createElement("button");
          remove.type = "button";
          remove.className = "icon-button quiz-remove-button";
          remove.dataset.removeCombat = "";
          remove.setAttribute("aria-label", `Eliminar combate ${index + 1}`);
          remove.title = "Eliminar combate y sus condiciones";
          remove.textContent = "×";
          actions.append(remove);
        }
        heading.append(titleGroup, actions);
        const content = document.createElement("div");
        content.className = "quiz-card-content combat-card-content";
        content.hidden = !isExpanded;
        content.id = `combat-${key}-${challenge.id}`;
        toggle.setAttribute("aria-controls", content.id);
        card.append(heading, content);
        return { card, content };
      };

      const combatSection = makeCard(sections[0]);
      const conditionsSection = makeCard(sections[1]);
      const enemyField = document.createElement("label");
      enemyField.className = "quiz-field full-field";
      const enemyLabel = document.createElement("span");
      enemyLabel.textContent = "Personaje enemigo";
      const enemyControl = document.createElement("div");
      enemyControl.className = "speaker-control combat-character-control";
      const enemyInput = document.createElement("input");
      enemyInput.type = "text";
      enemyInput.dataset.combatField = "enemyName";
      enemyInput.autocomplete = "off";
      enemyInput.setAttribute("role", "combobox");
      enemyInput.setAttribute("aria-autocomplete", "list");
      enemyInput.setAttribute("aria-haspopup", "listbox");
      enemyInput.setAttribute("aria-expanded", "false");
      enemyInput.setAttribute("aria-controls", `combat-character-options-${challenge.id}`);
      enemyInput.value = challenge.enemyName;
      const enemyDropdown = document.createElement("button");
      enemyDropdown.type = "button";
      enemyDropdown.className = "speaker-dropdown-button";
      enemyDropdown.dataset.combatCharacterToggle = "";
      enemyDropdown.setAttribute("aria-label", "Mostrar personajes guardados");
      enemyDropdown.setAttribute("aria-haspopup", "listbox");
      enemyDropdown.setAttribute("aria-expanded", "false");
      enemyDropdown.setAttribute("aria-controls", `combat-character-options-${challenge.id}`);
      enemyDropdown.innerHTML = '<span aria-hidden="true">▾</span>';
      const characterOptions = document.createElement("div");
      characterOptions.id = `combat-character-options-${challenge.id}`;
      characterOptions.className = "speaker-options";
      characterOptions.setAttribute("role", "listbox");
      characterOptions.setAttribute("aria-label", "Personajes introducidos anteriormente");
      characterOptions.hidden = true;
      this.renderCombatCharacterOptions(characterOptions, challenge.enemyName);
      enemyControl.append(enemyInput, enemyDropdown, characterOptions);
      enemyField.append(enemyLabel, enemyControl);
      const enemyAssetField = document.createElement("label");
      enemyAssetField.className = "quiz-field full-field final-type-field";
      const enemyAssetLabel = document.createElement("span");
      enemyAssetLabel.textContent = "Ilustración con atributos";
      const enemyAssetSelect = document.createElement("select");
      enemyAssetSelect.className = "quiz-select";
      enemyAssetSelect.dataset.combatField = "enemyAssetId";
      enemyAssetSelect.setAttribute("aria-label", "Ilustración de enemigo para copiar atributos");
      const noEnemyAsset = document.createElement("option");
      noEnemyAsset.value = "";
      noEnemyAsset.textContent = "Sin plantilla · atributos manuales";
      enemyAssetSelect.append(noEnemyAsset);
      this.project.assets
        .filter((asset) => this.combatAttributesFromAsset(asset).length)
        .forEach((asset) => {
          const option = document.createElement("option");
          option.value = asset.id;
          const moduleNames = this.project.scenes
            .filter((module) => module.stage.layers.some((layer) => layer.assetId === asset.id))
            .map((module) => module.name || `Escena ${module.moduleNumber}`);
          option.textContent = `${asset.name || "Ilustración"}${moduleNames.length ? ` · ${moduleNames.join(", ")}` : " · recursos"}`;
          enemyAssetSelect.append(option);
        });
      enemyAssetSelect.value = challenge.enemyAssetId || "";
      enemyAssetSelect.disabled = this.isPreviewing;
      enemyAssetField.append(enemyAssetLabel, enemyAssetSelect);
      combatSection.content.append(enemyField, enemyAssetField);

      const attributesBlock = document.createElement("section");
      attributesBlock.className = "combat-attributes-editor";
      const attributesTitle = document.createElement("h4");
      attributesTitle.textContent = "Atributos";
      attributesBlock.append(attributesTitle);
      const columns = document.createElement("div");
      columns.className = "combat-attribute-headings";
      ["Atributo", "Enemigo", "Jugador"].forEach((label) => {
        const cell = document.createElement("span");
        cell.textContent = label;
        columns.append(cell);
      });
      attributesBlock.append(columns);
      challenge.attributes.forEach((attribute, attributeIndex) => {
        const row = document.createElement("div");
        row.className = "combat-attribute-row";
        row.dataset.combatAttributeIndex = String(attributeIndex);
        const name = document.createElement("input");
        name.type = "text";
        name.dataset.combatAttributeName = "";
        name.setAttribute("list", `combat-attribute-list-${challenge.id}`);
        name.setAttribute("aria-label", `Nombre de atributo ${attributeIndex + 1}`);
        name.value = attribute.name;
        const enemyValue = document.createElement("input");
        enemyValue.type = "number";
        enemyValue.step = "1";
        enemyValue.dataset.combatEnemyValue = "";
        enemyValue.setAttribute("aria-label", `Valor enemigo de ${attribute.name}`);
        enemyValue.value = String(attribute.enemyValue);
        const playerValue = document.createElement("output");
        playerValue.className = "combat-player-value";
        playerValue.textContent = String(playerProfile.attributes.get(normalizedCombatAttribute(attribute.name)) || 0);
        const removeAttribute = document.createElement("button");
        removeAttribute.type = "button";
        removeAttribute.className = "icon-button combat-attribute-remove";
        removeAttribute.dataset.removeCombatAttribute = String(attributeIndex);
        removeAttribute.textContent = "×";
        removeAttribute.title = "Eliminar atributo";
        removeAttribute.setAttribute("aria-label", `Eliminar atributo ${attribute.name}`);
        row.append(name, enemyValue, playerValue, removeAttribute);
        attributesBlock.append(row);
      });
      const attributeList = document.createElement("datalist");
      attributeList.id = `combat-attribute-list-${challenge.id}`;
      attributeNames.forEach((name) => {
        const option = document.createElement("option");
        option.value = name;
        attributeList.append(option);
      });
      attributesBlock.append(attributeList);
      const addAttribute = document.createElement("button");
      addAttribute.type = "button";
      addAttribute.className = "icon-button combat-add-attribute";
      addAttribute.dataset.addCombatAttribute = "";
      addAttribute.textContent = "+";
      addAttribute.title = "Añadir atributo";
      addAttribute.setAttribute("aria-label", "Añadir atributo");
      attributesBlock.append(addAttribute);
      combatSection.content.append(
        attributesBlock,
        combatInputField("Vida máxima del enemigo", "enemyMaxHealth", challenge.enemyMaxHealth, { min: 1, max: 100000 }),
      );
      const profileNote = document.createElement("p");
      profileNote.className = "helper-text combat-profile-note";
      profileNote.textContent = "Los valores del jugador se leerán de su ficha; los atributos ausentes valen 0. Mientras no exista esa ficha, su vida máxima iguala la del enemigo.";
      combatSection.content.append(profileNote);

      const conditionGrid = document.createElement("div");
      conditionGrid.className = "combat-condition-grid";
      const conditionAttributes = [...new Set([
        ...challenge.attributes.map((attribute) => attribute.name),
        ...this.project.characterSheet.attributes.map((attribute) => attribute.name),
      ])];
      conditionGrid.append(
        this.createCombatExpressionEditor(challenge, "playerTerms", conditionAttributes),
        combatSelectField("Comparación", "conditionComparator", [
          { value: "=", label: "igual a" }, { value: "!=", label: "distinto de" },
          { value: ">", label: "mayor que" }, { value: ">=", label: "mayor o igual que" },
          { value: "<", label: "menor que" }, { value: "<=", label: "menor o igual que" },
        ], challenge.victoryCondition.comparator),
        this.createCombatExpressionEditor(challenge, "enemyTerms", conditionAttributes),
      );
      conditionsSection.content.append(conditionGrid);
      const config = document.createElement("div");
      config.className = "combat-config-grid";
      config.append(
        combatInputField("Número de dados", "diceCount", challenge.diceCount, { min: 1, max: 20 }),
        combatInputField("Caras por dado", "diceSides", challenge.diceSides, { min: 2, max: 1000 }),
        combatInputField("Máximo de rondas", "maxRounds", challenge.maxRounds, { min: 1, max: 100 }),
        combatInputField("Daño al ganar una ronda", "damagePerWin", challenge.damagePerWin, { min: 1, max: 100000 }),
        combatSelectField("Animación de victoria", "victoryAnimation", [
          { value: "pulse", label: "Destello suave" }, { value: "shake", label: "Sacudida" }, { value: "flash", label: "Flash de luz" },
        ], challenge.victoryAnimation),
        combatSelectField("Animación de derrota", "defeatAnimation", [
          { value: "pulse", label: "Destello suave" }, { value: "shake", label: "Sacudida" }, { value: "flash", label: "Flash de luz" },
        ], challenge.defeatAnimation),
        combatInputField("Duración de animación · ms", "animationDurationMs", challenge.animationDurationMs, { min: 150, max: 10000, step: 50 }),
      );
      conditionsSection.content.append(config);
      conditionsSection.content.append(this.createCombatRoundEffectsEditor(challenge));
      conditionsSection.content.append(this.createCombatVictoryRewardEditor(challenge));
      const rule = document.createElement("p");
      rule.className = "helper-text combat-rule-note";
      rule.textContent = "Condición de victoria por ronda: si se cumple, el jugador daña al enemigo; si no, recibe daño. Los cambios de atributos se aplican en cada ronda y la recompensa se concede al ganar el combate.";
      conditionsSection.content.append(rule);
      pair.append(combatSection.card, conditionsSection.card);
      fragment.append(pair);
    });
    list.replaceChildren(fragment);
  }

  renderEventEditor() {
    const list = this.dom.eventList;
    if (!list) return;
    const scene = this.scene;
    const events = scene?.eventChallenges || [];
    const fragment = document.createDocumentFragment();
    let expandedIds = scene ? this.expandedEventIdsBySceneId.get(scene.id) : null;
    if (scene && !expandedIds) {
      expandedIds = new Set(events.slice(0, 1).flatMap((item) => [`${item.id}:event`, `${item.id}:conditions`]));
      this.expandedEventIdsBySceneId.set(scene.id, expandedIds);
    }
    if (scene && expandedIds) {
      const validIds = new Set(events.flatMap((item) => [`${item.id}:event`, `${item.id}:conditions`]));
      for (const id of expandedIds) if (!validIds.has(id)) expandedIds.delete(id);
    }
    if (!events.length) {
      const empty = document.createElement("p");
      empty.className = "helper-text quiz-empty-state";
      empty.textContent = "Esta escena todavía no tiene eventos. Usa + para crear uno.";
      fragment.append(empty);
    }

    const objectAttributes = this.project.objectAttributeDefinitions || [];
    const playerAttributes = this.project.characterSheet.attributes || [];
    events.forEach((challenge, index) => {
      const pair = document.createElement("div");
      pair.className = "event-pair";
      const title = challenge.name ? `Evento ${challenge.name}` : `Evento ${index + 1}`;
      const makeCard = (key, headingText) => {
        const card = document.createElement("article");
        card.className = "quiz-card event-card";
        card.dataset.eventId = challenge.id;
        card.dataset.eventSection = key;
        const sectionKey = `${challenge.id}:${key}`;
        const isExpanded = Boolean(expandedIds?.has(sectionKey));
        card.classList.toggle("is-collapsed", !isExpanded);
        const heading = document.createElement("div");
        heading.className = "quiz-card-heading";
        const titleGroup = document.createElement("div");
        titleGroup.className = "quiz-card-title-group";
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "sidebar-collapse-toggle quiz-card-toggle";
        toggle.dataset.toggleEvent = "";
        toggle.setAttribute("aria-expanded", String(isExpanded));
        toggle.setAttribute("aria-label", `${isExpanded ? "Plegar" : "Desplegar"} ${headingText}`);
        toggle.textContent = isExpanded ? "▾" : "▸";
        const headingTitle = document.createElement("h3");
        headingTitle.textContent = headingText;
        if (key === "event") {
          headingTitle.dataset.renameEventTitle = "";
          headingTitle.title = "Doble clic para cambiar el nombre";
        }
        titleGroup.append(toggle, headingTitle);
        const actions = document.createElement("div");
        actions.className = "tool-section-actions";
        if (key === "event") {
          const remove = document.createElement("button");
          remove.type = "button";
          remove.className = "icon-button quiz-remove-button";
          remove.dataset.removeEvent = "";
          remove.setAttribute("aria-label", `Eliminar ${title.toLocaleLowerCase()} y sus condiciones`);
          remove.title = "Eliminar evento y sus condiciones";
          remove.textContent = "×";
          actions.append(remove);
        }
        heading.append(titleGroup, actions);
        const content = document.createElement("div");
        content.className = "quiz-card-content event-card-content combat-card-content";
        content.hidden = !isExpanded;
        content.id = `event-${key}-${challenge.id}`;
        toggle.setAttribute("aria-controls", content.id);
        card.append(heading, content);
        return { card, content };
      };

      const eventSection = makeCard("event", title);
      const conditionsSection = makeCard("conditions", `Condiciones de ${challenge.name || index + 1}`);

      const description = document.createElement("label");
      description.className = "quiz-field full-field";
      const descriptionLabel = document.createElement("span");
      descriptionLabel.textContent = "Descripción del evento";
      const descriptionInput = document.createElement("textarea");
      descriptionInput.rows = 2;
      descriptionInput.dataset.eventField = "description";
      descriptionInput.value = challenge.description || "";
      descriptionInput.placeholder = "Por ejemplo: Pisas una trampa con veneno";
      descriptionInput.disabled = this.isPreviewing;
      description.append(descriptionLabel, descriptionInput);
      eventSection.content.append(description);

      const assetField = document.createElement("label");
      assetField.className = "quiz-field full-field";
      const assetLabel = document.createElement("span");
      assetLabel.textContent = "Ilustración u objeto asociado";
      const assetSelect = document.createElement("select");
      assetSelect.className = "quiz-select";
      assetSelect.dataset.eventField = "assetId";
      const noAsset = document.createElement("option");
      noAsset.value = "";
      noAsset.textContent = "Sin recurso asociado";
      assetSelect.append(noAsset);
      this.project.assets.forEach((asset) => {
        const option = document.createElement("option");
        option.value = asset.id;
        const sceneNames = this.project.scenes
          .filter((module) => module.stage.layers.some((layer) => layer.assetId === asset.id))
          .map((module) => module.name || `Escena ${module.moduleNumber}`);
        option.textContent = `${asset.name || "Imagen"}${sceneNames.length ? ` · ${sceneNames.join(", ")}` : " · recursos"}`;
        assetSelect.append(option);
      });
      assetSelect.value = challenge.assetId || "";
      assetSelect.disabled = this.isPreviewing;
      assetField.append(assetLabel, assetSelect);
      eventSection.content.append(assetField);

      const attributesBlock = document.createElement("section");
      attributesBlock.className = "event-attributes-editor";
      const attributesHeading = document.createElement("h4");
      attributesHeading.textContent = "Atributos del evento";
      attributesBlock.append(attributesHeading);
      if (objectAttributes.length) {
        objectAttributes.forEach((definition) => {
          if (!Object.hasOwn(challenge.attributeValues, definition.id)) {
            const sourceValue = this.project.getAsset(challenge.assetId)?.attributes
              ?.find((attribute) => attribute.attributeId === definition.id)?.value;
            challenge.attributeValues[definition.id] = Number(sourceValue) || 0;
          }
          const row = document.createElement("label");
          row.className = "event-attribute-row";
          const name = document.createElement("span");
          name.textContent = definition.name;
          const value = document.createElement("input");
          value.type = "number";
          value.step = "any";
          value.dataset.eventAttributeValue = definition.id;
          value.value = String(challenge.attributeValues[definition.id]);
          value.setAttribute("aria-label", `Valor de ${definition.name} en el evento`);
          value.disabled = this.isPreviewing;
          row.append(name, value);
          attributesBlock.append(row);
        });
      } else {
        const help = document.createElement("p");
        help.className = "helper-text";
        help.textContent = "Define primero los atributos desde Explorador → Objetos.";
        attributesBlock.append(help);
      }
      eventSection.content.append(attributesBlock);

      const explanation = document.createElement("p");
      explanation.className = "helper-text event-condition-note";
      explanation.textContent = "Si se cumplen todas las comparaciones, el jugador supera el evento; por ejemplo, Armadura ≥ Veneno.";
      conditionsSection.content.append(explanation);
      if (challenge.conditions.length) {
        challenge.conditions.forEach((condition, conditionIndex) => {
          const row = document.createElement("div");
          row.className = "event-condition-row";
          row.dataset.eventConditionIndex = String(conditionIndex);
          const playerSelect = document.createElement("select");
          playerSelect.className = "quiz-select";
          playerSelect.dataset.eventConditionField = "playerAttributeId";
          playerSelect.setAttribute("aria-label", "Atributo del jugador");
          const playerPlaceholder = document.createElement("option");
          playerPlaceholder.value = "";
          playerPlaceholder.textContent = playerAttributes.length ? "Atributo del jugador" : "Define atributos de personaje";
          playerSelect.append(playerPlaceholder);
          playerAttributes.forEach((attribute) => {
            const option = document.createElement("option");
            option.value = attribute.id;
            option.textContent = attribute.name;
            playerSelect.append(option);
          });
          playerSelect.value = condition.playerAttributeId || "";
          playerSelect.disabled = this.isPreviewing || !playerAttributes.length;

          const comparator = document.createElement("select");
          comparator.className = "quiz-select";
          comparator.dataset.eventConditionField = "comparator";
          comparator.setAttribute("aria-label", "Comparación");
          [[">=", "≥"], [">", ">"], ["=", "="], ["!=", "≠"], ["<", "<"], ["<=", "≤"]].forEach(([value, label]) => {
            const option = document.createElement("option");
            option.value = value;
            option.textContent = label;
            comparator.append(option);
          });
          comparator.value = condition.comparator || ">=";
          comparator.disabled = this.isPreviewing;

          const eventSelect = document.createElement("select");
          eventSelect.className = "quiz-select";
          eventSelect.dataset.eventConditionField = "eventAttributeId";
          eventSelect.setAttribute("aria-label", "Atributo del evento");
          const eventPlaceholder = document.createElement("option");
          eventPlaceholder.value = "";
          eventPlaceholder.textContent = objectAttributes.length ? "Atributo del evento" : "Define atributos de objeto";
          eventSelect.append(eventPlaceholder);
          objectAttributes.forEach((attribute) => {
            const option = document.createElement("option");
            option.value = attribute.id;
            option.textContent = attribute.name;
            eventSelect.append(option);
          });
          eventSelect.value = condition.eventAttributeId || "";
          eventSelect.disabled = this.isPreviewing || !objectAttributes.length;

          const modifier = document.createElement("input");
          modifier.type = "number";
          modifier.step = "any";
          modifier.dataset.eventConditionField = "modifier";
          modifier.value = String(condition.modifier || 0);
          modifier.setAttribute("aria-label", "Modificador del atributo del evento");
          modifier.title = "Modificador que se suma al atributo del evento";
          modifier.disabled = this.isPreviewing;

          const remove = document.createElement("button");
          remove.type = "button";
          remove.className = "icon-button quiz-remove-button";
          remove.dataset.removeEventCondition = String(conditionIndex);
          remove.textContent = "×";
          remove.title = "Eliminar condición";
          remove.setAttribute("aria-label", "Eliminar condición del evento");
          remove.disabled = this.isPreviewing;
          row.append(playerSelect, comparator, eventSelect, modifier, remove);
          conditionsSection.content.append(row);
        });
      } else {
        const emptyConditions = document.createElement("p");
        emptyConditions.className = "helper-text";
        emptyConditions.textContent = "Añade una comparación entre un atributo del jugador y otro del evento.";
        conditionsSection.content.append(emptyConditions);
      }
      const addCondition = document.createElement("button");
      addCondition.type = "button";
      addCondition.className = "icon-button combat-add-attribute";
      addCondition.dataset.addEventCondition = "";
      addCondition.textContent = "+";
      addCondition.title = "Añadir condición";
      addCondition.setAttribute("aria-label", "Añadir condición al evento");
      addCondition.disabled = this.isPreviewing || !playerAttributes.length || !objectAttributes.length;
      conditionsSection.content.append(addCondition);

      pair.append(eventSection.card, conditionsSection.card);
      fragment.append(pair);
    });
    list.replaceChildren(fragment);
  }

  updateEventControl(event, rerenderConditional) {
    const control = event.target.closest("[data-event-field], [data-event-attribute-value], [data-event-condition-field]");
    const card = control?.closest("[data-event-id]");
    const challenge = this.scene?.eventChallenges.find((item) => item.id === card?.dataset.eventId);
    if (!control || !challenge) return;
    if (control.hasAttribute("data-event-attribute-value")) {
      const attributeId = control.dataset.eventAttributeValue;
      if (!this.project.objectAttributeDefinitions.some((attribute) => attribute.id === attributeId)) return;
      challenge.attributeValues[attributeId] = Math.max(-100000, Math.min(100000, Number(control.value) || 0));
      control.value = String(challenge.attributeValues[attributeId]);
    } else if (control.hasAttribute("data-event-condition-field")) {
      const condition = challenge.conditions[Number(control.closest("[data-event-condition-index]")?.dataset.eventConditionIndex)];
      if (!condition) return;
      const field = control.dataset.eventConditionField;
      if (field === "playerAttributeId") {
        condition.playerAttributeId = this.project.characterSheet.attributes.some((attribute) => attribute.id === control.value) ? control.value : "";
      } else if (field === "eventAttributeId") {
        condition.eventAttributeId = this.project.objectAttributeDefinitions.some((attribute) => attribute.id === control.value) ? control.value : "";
      } else if (field === "comparator") {
        condition.comparator = ["=", "!=", ">", ">=", "<", "<="].includes(control.value) ? control.value : ">=";
      } else if (field === "modifier") {
        condition.modifier = Math.max(-100000, Math.min(100000, Number(control.value) || 0));
      }
    } else if (control.dataset.eventField === "assetId") {
      challenge.assetId = control.value || null;
      const asset = this.project.getAsset(challenge.assetId);
      challenge.attributeValues = Object.fromEntries(this.project.objectAttributeDefinitions.map((definition) => {
        const value = asset?.attributes?.find((attribute) => attribute.attributeId === definition.id)?.value;
        return [definition.id, Math.max(-100000, Math.min(100000, Number(value) || 0))];
      }));
      if (rerenderConditional) this.renderEventEditor();
    } else if (control.dataset.eventField === "description") {
      challenge.description = control.value.slice(0, 1000);
    } else {
      return;
    }
    this.markDirty();
  }

  createCombatRoundEffectsEditor(challenge) {
    const section = document.createElement("section");
    section.className = "combat-round-effects";
    const heading = document.createElement("h4");
    heading.textContent = "Cambios de atributos por ronda";
    section.append(heading);
    const definitions = this.project.characterSheet.attributes;
    (challenge.roundAttributeEffects || []).forEach((effect, index) => {
      const row = document.createElement("div");
      row.className = "combat-round-effect-row";
      row.dataset.roundEffectIndex = String(index);
      const attribute = document.createElement("select");
      attribute.className = "quiz-select";
      attribute.dataset.combatEffectField = "attributeId";
      attribute.setAttribute("aria-label", "Atributo afectado");
      definitions.forEach((definition) => {
        const option = document.createElement("option");
        option.value = definition.id;
        option.textContent = definition.name;
        attribute.append(option);
      });
      attribute.value = effect.attributeId;
      attribute.disabled = this.isPreviewing || definitions.length === 0;
      const onWin = combatInputField("Cambio si ganas", "", effect.onWin, { step: "any", min: -100000, max: 100000 });
      const winInput = onWin.querySelector("input");
      winInput.removeAttribute("data-combat-field");
      winInput.dataset.combatEffectField = "onWin";
      winInput.disabled = this.isPreviewing;
      const onLoss = combatInputField("Cambio si pierdes", "", effect.onLoss, { step: "any", min: -100000, max: 100000 });
      const lossInput = onLoss.querySelector("input");
      lossInput.removeAttribute("data-combat-field");
      lossInput.dataset.combatEffectField = "onLoss";
      lossInput.disabled = this.isPreviewing;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "icon-button combat-attribute-remove";
      remove.textContent = "×";
      remove.dataset.removeCombatRoundEffect = String(index);
      remove.disabled = this.isPreviewing;
      remove.setAttribute("aria-label", "Eliminar cambio de atributo");
      row.append(attribute, onWin, onLoss, remove);
      section.append(row);
    });
    const add = document.createElement("button");
    add.type = "button";
    add.className = "icon-button combat-add-attribute";
    add.textContent = "+";
    add.dataset.addCombatRoundEffect = "";
    add.disabled = this.isPreviewing || definitions.length === 0;
    add.setAttribute("aria-label", "Añadir cambio de atributo por ronda");
    add.title = "Añadir atributo afectado por ronda";
    section.append(add);
    const help = document.createElement("p");
    help.className = "helper-text";
    help.textContent = "Usa valores negativos para restar; por ejemplo, −1 en Vida y −2 en Magia al ganar la ronda.";
    section.append(help);
    return section;
  }

  createCombatVictoryRewardEditor(challenge) {
    const section = document.createElement("section");
    section.className = "combat-victory-reward";
    const heading = document.createElement("h4");
    heading.textContent = "Recompensa por ganar";
    section.append(heading);
    const reward = challenge.victoryReward || { type: "character", attributeId: "", assetId: null, amount: 0 };
    const type = document.createElement("select");
    type.className = "quiz-select";
    type.dataset.combatRewardField = "type";
    type.setAttribute("aria-label", "Tipo de recompensa");
    [["character", "Personaje"], ["object", "Objeto"]].forEach(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      type.append(option);
    });
    type.value = reward.type === "object" ? "object" : "character";
    type.disabled = this.isPreviewing;
    section.append(type);

    if (reward.type === "object") {
      const asset = document.createElement("select");
      asset.className = "quiz-select";
      asset.dataset.combatRewardField = "assetId";
      asset.setAttribute("aria-label", "Objeto que recibe la recompensa");
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "Selecciona un objeto";
      asset.append(placeholder);
      this.project.assets.forEach((item) => {
        const option = document.createElement("option");
        option.value = item.id;
        option.textContent = item.name || "Objeto";
        asset.append(option);
      });
      asset.value = reward.assetId || "";
      asset.disabled = this.isPreviewing;
      section.append(asset);
    }

    const attribute = document.createElement("select");
    attribute.className = "quiz-select";
    attribute.dataset.combatRewardField = "attributeId";
    attribute.setAttribute("aria-label", reward.type === "object" ? "Atributo del objeto como recompensa" : "Atributo del personaje como recompensa");
    const definitions = reward.type === "object" ? this.project.objectAttributeDefinitions : this.project.characterSheet.attributes;
    const attributePlaceholder = document.createElement("option");
    attributePlaceholder.value = "";
    attributePlaceholder.textContent = definitions.length ? "Selecciona un atributo" : "No hay atributos definidos";
    attribute.append(attributePlaceholder);
    definitions.forEach((definition) => {
      const option = document.createElement("option");
      option.value = definition.id;
      option.textContent = definition.name;
      attribute.append(option);
    });
    attribute.value = reward.attributeId || "";
    attribute.disabled = this.isPreviewing || definitions.length === 0;
    section.append(attribute);
    const amount = combatInputField("Cantidad que se suma", "", reward.amount, { step: "any", min: -100000, max: 100000 });
    const amountInput = amount.querySelector("input");
    amountInput.removeAttribute("data-combat-field");
    amountInput.dataset.combatRewardField = "amount";
    amountInput.disabled = this.isPreviewing;
    section.append(amount);
    return section;
  }

  createCombatExpressionEditor(challenge, side, attributeNames) {
    const terms = challenge.victoryCondition[side];
    const section = document.createElement("section");
    section.className = "combat-expression-side";
    const heading = document.createElement("h4");
    heading.textContent = side === "playerTerms" ? "Jugador" : "Enemigo";
    section.append(heading);
    terms.forEach((term, index) => {
      const row = document.createElement("div");
      row.className = "combat-expression-term";
      row.dataset.conditionIndex = String(index);
      row.dataset.conditionSide = side;
      if (index > 0) {
        const operator = document.createElement("select");
        operator.className = "quiz-select combat-expression-operator";
        operator.dataset.combatConditionField = "operator";
        operator.setAttribute("aria-label", "Operación con el término anterior");
        [["+", "+"], ["-", "−"], ["*", "×"], ["/", "÷"], ["=", "="]].forEach(([value, label]) => {
          const option = document.createElement("option");
          option.value = value;
          option.textContent = label;
          operator.append(option);
        });
        operator.value = term.operator || "+";
        row.append(operator);
      }
      const source = document.createElement("select");
      source.className = "quiz-select combat-expression-source";
      source.dataset.combatConditionField = "source";
      source.setAttribute("aria-label", "Origen del valor");
      const attributeSources = ["playerAttribute", "enemyAttribute"];
      const defaultAttributeSource = side === "playerTerms" ? "playerAttribute" : "enemyAttribute";
      const selectedAttributeSource = attributeSources.includes(term.source) ? term.source : defaultAttributeSource;
      [
        [selectedAttributeSource, "Atributo"],
        ["number", "Dados"],
        ["weaponDamage", "Arma"],
      ].forEach(([value, label]) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        source.append(option);
      });
      source.value = attributeSources.includes(term.source) ? selectedAttributeSource : term.source;
      row.append(source);
      if (attributeSources.includes(source.value)) {
        const attribute = document.createElement("select");
        attribute.className = "quiz-select combat-expression-attribute";
        attribute.dataset.combatConditionField = "attribute";
        attribute.setAttribute("aria-label", "Atributo que se compara");
        const names = [...new Set([...attributeNames, term.attribute].filter(Boolean))];
        names.forEach((name) => {
          const option = document.createElement("option");
          option.value = name;
          option.textContent = name;
          attribute.append(option);
        });
        attribute.value = term.attribute;
        row.append(attribute);
      } else if (term.source === "number") {
        const value = document.createElement("input");
        value.className = "combat-expression-number";
        value.type = "number";
        value.step = "any";
        value.dataset.combatConditionField = "value";
        value.setAttribute("aria-label", "Valor numérico");
        value.value = String(term.value);
        row.append(value);
      }
      if (terms.length > 1) {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "icon-button combat-expression-remove";
        remove.dataset.removeConditionTerm = String(index);
        remove.dataset.conditionSide = side;
        remove.textContent = "×";
        remove.title = "Quitar término";
        remove.setAttribute("aria-label", "Quitar término de condición");
        row.append(remove);
      }
      section.append(row);
    });
    const add = document.createElement("button");
    add.type = "button";
    add.className = "icon-button combat-expression-add";
    add.dataset.addConditionTerm = side;
    add.textContent = "+";
    add.title = "Añadir término";
    add.setAttribute("aria-label", "Añadir término a la expresión");
    section.append(add);
    return section;
  }

  updateCombatControl(event, rerenderConditional) {
    const control = event.target.closest("[data-combat-field], [data-combat-attribute-name], [data-combat-enemy-value], [data-combat-condition-field], [data-combat-effect-field], [data-combat-reward-field]");
    const card = control?.closest("[data-combat-id]");
    const challenge = this.scene?.combatChallenges.find((item) => item.id === card?.dataset.combatId);
    if (!control || !challenge) return;
    const field = control.dataset.combatField;
    if (control.hasAttribute("data-combat-effect-field")) {
      const effect = challenge.roundAttributeEffects[Number(control.closest("[data-round-effect-index]")?.dataset.roundEffectIndex)];
      if (!effect) return;
      const property = control.dataset.combatEffectField;
      if (property === "attributeId") effect.attributeId = this.project.characterSheet.attributes.some((attribute) => attribute.id === control.value) ? control.value : (this.project.characterSheet.attributes[0]?.id || "");
      else if (["onWin", "onLoss"].includes(property)) effect[property] = Math.max(-100000, Math.min(100000, Number(control.value) || 0));
    } else if (control.hasAttribute("data-combat-reward-field")) {
      const property = control.dataset.combatRewardField;
      const reward = challenge.victoryReward;
      if (property === "type") {
        reward.type = control.value === "object" ? "object" : "character";
        reward.assetId = null;
        const definitions = reward.type === "object" ? this.project.objectAttributeDefinitions : this.project.characterSheet.attributes;
        reward.attributeId = definitions[0]?.id || "";
        if (rerenderConditional) this.renderCombatEditor();
      } else if (property === "assetId") reward.assetId = control.value || null;
      else if (property === "attributeId") {
        const definitions = reward.type === "object" ? this.project.objectAttributeDefinitions : this.project.characterSheet.attributes;
        reward.attributeId = definitions.some((attribute) => attribute.id === control.value) ? control.value : "";
      } else if (property === "amount") reward.amount = Math.max(-100000, Math.min(100000, Number(control.value) || 0));
    } else if (control.hasAttribute("data-combat-condition-field")) {
      const row = control.closest("[data-condition-index]");
      const side = row?.dataset.conditionSide === "playerTerms" ? "playerTerms" : "enemyTerms";
      const term = challenge.victoryCondition[side][Number(row?.dataset.conditionIndex)];
      if (!term) return;
      const property = control.dataset.combatConditionField;
      if (property === "source") {
        term.source = control.value;
        if (["playerAttribute", "enemyAttribute"].includes(term.source)) {
          term.attribute = challenge.attributes.some((attribute) => attribute.name === term.attribute)
            ? term.attribute
            : (challenge.attributes[0]?.name || "Fuerza");
        }
        if (rerenderConditional) this.renderCombatEditor();
      } else if (property === "attribute") term.attribute = control.value;
      else if (property === "operator") term.operator = ["+", "-", "*", "/", "="].includes(control.value) ? control.value : "+";
      else if (property === "value") term.value = Math.max(-100000, Math.min(100000, Number(control.value) || 0));
    } else if (control.hasAttribute("data-combat-attribute-name") || control.hasAttribute("data-combat-enemy-value")) {
      const index = Number(control.closest("[data-combat-attribute-index]")?.dataset.combatAttributeIndex);
      const attribute = challenge.attributes[index];
      if (!attribute) return;
      if (control.hasAttribute("data-combat-attribute-name")) {
        const oldName = attribute.name;
        attribute.name = control.value.trim() || "Atributo";
        if (challenge.comparisonAttribute === oldName) challenge.comparisonAttribute = attribute.name;
        [challenge.victoryCondition.playerTerms, challenge.victoryCondition.enemyTerms].forEach((terms) => terms.forEach((term) => {
          if (["playerAttribute", "enemyAttribute"].includes(term.source) && term.attribute === oldName) term.attribute = attribute.name;
        }));
        if (rerenderConditional) this.renderCombatEditor();
      } else {
        attribute.enemyValue = Math.max(-100000, Math.min(100000, Number(control.value) || 0));
      }
    } else if (field === "enemyAssetId") {
      challenge.enemyAssetId = control.value || null;
      const copiedAttributes = this.combatAttributesFromAsset(this.project.getAsset(challenge.enemyAssetId));
      if (copiedAttributes.length) {
        challenge.attributes = copiedAttributes;
        const availableNames = new Set(copiedAttributes.map((attribute) => normalizedCombatAttribute(attribute.name)));
        if (!availableNames.has(normalizedCombatAttribute(challenge.comparisonAttribute))) {
          challenge.comparisonAttribute = copiedAttributes[0].name;
        }
        [challenge.victoryCondition.playerTerms, challenge.victoryCondition.enemyTerms].forEach((terms) => terms.forEach((term) => {
          if (["playerAttribute", "enemyAttribute"].includes(term.source)
            && !availableNames.has(normalizedCombatAttribute(term.attribute))) {
            term.attribute = copiedAttributes[0].name;
          }
        }));
      }
      if (rerenderConditional) this.renderCombatEditor();
    } else if (field === "enemyName") {
      challenge.enemyName = control.value.trim() || "Enemigo";
      if (rerenderConditional) {
        this.project.addCharacter(challenge.enemyName);
        const controlContainer = control.closest(".combat-character-control");
        this.renderCombatCharacterOptions(controlContainer?.querySelector(".speaker-options"), challenge.enemyName);
      } else {
        const controlContainer = control.closest(".combat-character-control");
        const options = controlContainer?.querySelector(".speaker-options");
        const wasOpen = Boolean(options && !options.hidden);
        this.renderCombatCharacterOptions(options, challenge.enemyName, control.value);
        this.setCombatCharacterOptionsOpen(controlContainer, wasOpen);
      }
    } else if (field === "conditionComparator") {
      challenge.victoryCondition.comparator = ["=", "!=", ">", ">=", "<", "<="].includes(control.value) ? control.value : ">";
    } else if (field === "comparisonAttribute") challenge.comparisonAttribute = control.value;
    else if (field === "comparisonOperator") challenge.comparisonOperator = control.value === ">=" ? ">=" : ">";
    else if (field === "victoryAnimation") challenge.victoryAnimation = ["pulse", "shake", "flash"].includes(control.value) ? control.value : "pulse";
    else if (field === "defeatAnimation") challenge.defeatAnimation = ["pulse", "shake", "flash"].includes(control.value) ? control.value : "shake";
    else {
      const limits = {
        playerBonus: [-10000, 10000, 0], diceCount: [1, 20, 1], diceSides: [2, 1000, 2],
        maxRounds: [1, 100, 1], enemyMaxHealth: [1, 100000, 1], damagePerWin: [1, 100000, 1],
        animationDurationMs: [150, 10000, 900],
      }[field];
      if (!limits) return;
      const [min, max, fallback] = limits;
      const parsed = Number(control.value);
      const nextValue = Math.min(max, Math.max(min, Number.isFinite(parsed) ? Math.round(parsed) : fallback));
      challenge[field] = nextValue;
      control.value = String(nextValue);
    }
    this.renderPreview();
    this.markDirty();
  }

  createQuizOutcomeEditor(challenge, outcomeKey, title, pendingEditors) {
    const outcome = challenge[outcomeKey];
    const section = document.createElement("section");
    section.className = "quiz-outcome-editor";
    section.dataset.quizOutcomeEditor = outcomeKey;
    const heading = document.createElement("h4");
    heading.textContent = title;
    section.append(heading);
    section.append(createQuizSelectField("Tipo de consecuencia", "outcomeType", [
      { value: "dialogue", label: "Mostrar un diálogo" },
      { value: "animation", label: "Reproducir una animación" },
      { value: "scene", label: "Desbloquear una escena" },
      { value: "video", label: "Desbloquear un vídeo" },
    ], outcome.type));

    const dialoguePanel = document.createElement("div");
    dialoguePanel.className = "quiz-outcome-panel";
    dialoguePanel.dataset.quizOutcomeType = "dialogue";
    dialoguePanel.hidden = outcome.type !== "dialogue";
    const dialogueText = createQuizRichTextField("Diálogo de respuesta", outcomeKey);
    dialoguePanel.append(dialogueText.field);
    pendingEditors.push({ challenge, key: outcomeKey, richText: outcome.text, ...dialogueText });
    section.append(dialoguePanel);

    const animationPanel = document.createElement("div");
    animationPanel.className = "quiz-outcome-panel quiz-animation-fields";
    animationPanel.dataset.quizOutcomeType = "animation";
    animationPanel.hidden = outcome.type !== "animation";
    animationPanel.append(createQuizSelectField("Animación", "animationType", [
      { value: "pulse", label: "Destello suave" },
      { value: "shake", label: "Sacudida" },
      { value: "flash", label: "Flash de luz" },
    ], outcome.animationType));
    const durationLabel = document.createElement("label");
    durationLabel.className = "quiz-field full-field";
    const durationHeading = document.createElement("span");
    durationHeading.textContent = "Duración (milisegundos)";
    const durationInput = document.createElement("input");
    durationInput.type = "number";
    durationInput.min = "150";
    durationInput.max = "10000";
    durationInput.step = "50";
    durationInput.dataset.quizField = "animationDurationMs";
    durationInput.value = String(outcome.animationDurationMs);
    durationLabel.append(durationHeading, durationInput);
    animationPanel.append(durationLabel);
    section.append(animationPanel);

    const scenePanel = document.createElement("div");
    scenePanel.className = "quiz-outcome-panel";
    scenePanel.dataset.quizOutcomeType = "scene";
    scenePanel.hidden = outcome.type !== "scene";
    const sceneOptions = [{ value: "", label: "Selecciona la escena que se desbloqueará" }];
    this.project.scenes.forEach((targetScene) => sceneOptions.push({
      value: targetScene.id,
      label: `${targetScene.name || "Escena sin título"} · Escena ${targetScene.moduleNumber || "—"}`,
    }));
    scenePanel.append(createQuizSelectField("Escena que se desbloquea", "sceneId", sceneOptions, outcome.sceneId));
    section.append(scenePanel);

    const videoPanel = document.createElement("div");
    videoPanel.className = "quiz-outcome-panel";
    videoPanel.dataset.quizOutcomeType = "video";
    videoPanel.hidden = outcome.type !== "video";
    const videoOptions = [{ value: "", label: "Selecciona el vídeo que se desbloqueará" }];
    this.project.videoAssets.forEach((asset) => videoOptions.push({ value: asset.id, label: asset.name || "Vídeo" }));
    videoPanel.append(createQuizSelectField("Vídeo que se desbloquea", "videoId", videoOptions, outcome.videoId));
    section.append(videoPanel);
    return section;
  }

  updateQuizControl(event, rerenderConditional) {
    const control = event.target.closest("[data-quiz-field]");
    const challenge = this.scene?.quizChallenges.find((item) => item.id === control?.closest("[data-quiz-id]")?.dataset.quizId);
    if (!control || !challenge) return;
    const field = control.dataset.quizField;
    if (field === "answerType") challenge.answerType = control.value === "inventory" ? "inventory" : "text";
    else if (field === "expectedText") challenge.expectedText = control.value;
    else if (field === "expectedAssetId") challenge.expectedAssetId = control.value || null;
    else if (field === "consumeItem") challenge.consumeItem = control.checked;
    else if (field === "maxRetries") challenge.maxRetries = Math.min(10, Math.max(0, Math.round(Number(control.value) || 0)));
    else if (["outcomeType", "animationType", "animationDurationMs", "sceneId", "videoId"].includes(field)) {
      const outcome = challenge[control.closest("[data-quiz-outcome-editor]")?.dataset.quizOutcomeEditor || "outcome"];
      if (field === "outcomeType") outcome.type = ["dialogue", "animation", "scene", "video"].includes(control.value) ? control.value : "dialogue";
      else if (field === "animationType") outcome.animationType = ["pulse", "shake", "flash"].includes(control.value) ? control.value : "pulse";
      else if (field === "animationDurationMs") outcome.animationDurationMs = Math.min(10000, Math.max(150, Math.round(Number(control.value) || 900)));
      else if (field === "sceneId") outcome.sceneId = control.value || null;
      else if (field === "videoId") outcome.videoId = control.value || null;
    }
    else return;
    if (rerenderConditional && ["answerType", "outcomeType"].includes(field)) this.renderQuizEditor();
    if (field === "animationDurationMs") {
      const outcome = challenge[control.closest("[data-quiz-outcome-editor]")?.dataset.quizOutcomeEditor || "outcome"];
      control.value = String(outcome.animationDurationMs);
    }
    this.renderPreview();
    this.markDirty();
  }

  handleQuizPreviewAction(button) {
    const action = button.dataset.quizAction;
    if (!this.isPreviewing) {
      this.setPlaybackStatus("Pulsa «Probar» para responder al reto.");
      return;
    }
    if (action === "inventory") {
      this.pendingQuizAnswerId = button.dataset.quizId;
      this.renderInventoryGrid();
      if (this.dom.inventoryPanel?.hidden) this.dom.inventoryToggle?.click();
      this.setInventoryMessage("Selecciona en el inventario el objeto que responde a la pregunta.");
      return;
    }
    if (action === "continue") {
      this.player.continueQuiz();
      return;
    }
    if (action === "scene") {
      this.player.start(button.dataset.quizTarget);
      return;
    }
    if (action === "video") this.playVideoAsset(button.dataset.quizTarget);
  }

  submitQuizTextAnswer(form) {
    if (!this.isPreviewing) {
      this.setPlaybackStatus("Pulsa «Probar» para responder al reto.");
      return;
    }
    const quizId = form.dataset.quizId;
    const answer = form.querySelector("[data-quiz-answer-input]")?.value || "";
    this.player.answerQuiz(quizId, { text: answer });
  }

  renderChoiceList() {
    const fragment = document.createDocumentFragment();
    const pendingEditors = [];
    const scene = this.scene;
    let expandedIds = scene ? this.expandedDecisionIdsBySceneId.get(scene.id) : null;
    if (scene && !expandedIds) {
      expandedIds = new Set(scene.decisions.choices.slice(0, 1).map((choice) => choice.id));
      this.expandedDecisionIdsBySceneId.set(scene.id, expandedIds);
    }
    if (scene && expandedIds) {
      const validIds = new Set(scene.decisions.choices.map((choice) => choice.id));
      for (const id of expandedIds) if (!validIds.has(id)) expandedIds.delete(id);
      if (!expandedIds.size && scene.decisions.choices[0]) expandedIds.add(scene.decisions.choices[0].id);
    }
    scene?.decisions.choices.forEach((choice, index) => {
      const card = document.createElement("article");
      card.className = "quiz-card decision-card";
      card.dataset.choiceId = choice.id;
      const isExpanded = expandedIds?.has(choice.id) ?? false;
      card.innerHTML = `
        <div class="quiz-card-heading">
          <div class="quiz-card-title-group"><h3 data-rename-choice-title></h3></div>
          <div class="tool-section-actions">
            <button class="sidebar-collapse-toggle quiz-card-toggle" type="button" data-toggle-choice aria-expanded="${isExpanded}" aria-label="${isExpanded ? "Plegar" : "Desplegar"} decisión ${index + 1}">${isExpanded ? "▾" : "▸"}</button>
            <button class="icon-button quiz-remove-button" type="button" data-remove-choice aria-label="Eliminar decisión ${index + 1}" title="Eliminar decisión">×</button>
          </div>
        </div>
        <div class="quiz-card-content decision-card-content" ${isExpanded ? "" : "hidden"}>
        <label class="full-field decision-choice-label"><span>Texto de la decisión</span></label>
        <div class="rich-text-field decision-rich-text-field">
          <div class="rich-toolbar decision-rich-toolbar" aria-label="Formato del texto de la decisión">
            <span class="ql-formats">
              <select class="ql-header" aria-label="Estilo de párrafo">
                <option selected></option><option value="1">Título</option><option value="2">Subtítulo</option>
              </select>
            </span>
            <span class="ql-formats">
              <button class="ql-bold" type="button" aria-label="Negrita"></button>
              <button class="ql-italic" type="button" aria-label="Cursiva"></button>
              <button class="ql-underline" type="button" aria-label="Subrayado"></button>
              <button class="ql-background" type="button" value="#f7d471" aria-label="Resaltar"></button>
            </span>
            <span class="ql-formats">
              <button class="ql-list" type="button" value="bullet" aria-label="Lista con viñetas"></button>
              <button class="ql-list" type="button" value="ordered" aria-label="Lista numerada"></button>
              <button class="ql-blockquote" type="button" aria-label="Cita"></button>
              <button class="ql-link" type="button" aria-label="Enlace"></button>
              <button class="ql-clean" type="button" aria-label="Quitar formato"></button>
            </span>
          </div>
          <div class="rich-editor decision-rich-editor" data-editor-label="Texto de la decisión" lang="und" dir="auto"></div>
        </div>
        <label class="full-field decision-target-field"><span>Escena destino <em>(opcional)</em></span><select data-choice-field="targetSceneId"></select></label>
        </div>`;
      card.classList.toggle("is-collapsed", !isExpanded);
      const title = card.querySelector("[data-rename-choice-title]");
      card.querySelector(".quiz-card-title-group")?.prepend(card.querySelector("[data-toggle-choice]"));
      title.textContent = choice.name || `Decisión ${index + 1}`;
      title.title = "Doble clic para cambiar el nombre";
      const content = card.querySelector(".decision-card-content");
      content.id = `decision-choice-content-${choice.id}`;
      const toggle = card.querySelector("[data-toggle-choice]");
      toggle.setAttribute("aria-controls", content.id);
      const target = card.querySelector('[data-choice-field="targetSceneId"]');
      const noTarget = document.createElement("option");
      noTarget.value = "";
      noTarget.textContent = "Sin destino todavía";
      target.append(noTarget);
      this.project.scenes.forEach((scene) => {
        const option = document.createElement("option");
        option.value = scene.id;
        option.textContent = scene.name || "Escena sin título";
        target.append(option);
      });
      target.value = choice.targetSceneId || "";
      pendingEditors.push({
        choice,
        container: card.querySelector(".decision-rich-editor"),
        toolbar: card.querySelector(".decision-rich-toolbar"),
      });
      fragment.append(card);
    });

    if (!scene?.decisions.choices.length) {
      const empty = document.createElement("p");
      empty.className = "helper-text";
      empty.textContent = "Aún no hay decisiones en esta escena.";
      fragment.append(empty);
    }
    this.dom.choiceList.replaceChildren(fragment);
    this.choiceRichTextEditors.clear();
    pendingEditors.forEach(({ choice, container, toolbar }) => {
      const editor = new QuillRichTextEditor(container, toolbar, {
        placeholder: "Escribe el texto de esta decisión…",
        ariaLabel: "Texto de la decisión",
      });
      const richText = choice.labelText || new RichTextBlock();
      const legacyHtml = choice.label ? `<p>${escapeMarkup(choice.label)}</p>` : "";
      editor.setHtml(richText.html || legacyHtml);
      editor.setLanguage(richText.lang || "und", richText.dir || "auto");
      editor.onChange((html) => {
        choice.labelText = new RichTextBlock({ html, lang: richText.lang, dir: richText.dir });
        choice.label = editor.getText().replace(/\s*\n+\s*/g, " ").trim();
        this.markDirty();
        this.renderPreview();
        this.renderModuleGraph();
      });
      this.choiceRichTextEditors.set(choice.id, editor);
    });
  }

  renderCueList() {
    const fragment = document.createDocumentFragment();
    this.scene.timedCues.forEach((cue, index) => {
      const { card, content } = this.createResourceCueCard(
        cue,
        "timed",
        index,
        "removeCue",
        `Quitar cambio temporizado ${index + 1}`,
      );
      card.classList.add("cue-card");
      content.innerHTML = `
        <div class="form-grid">
          <label><span>Después de · segundos</span><input type="number" min="0" step="0.1" data-cue-field="seconds" /></label>
          <label><span>Capa que cambia</span><select data-cue-field="targetLayerId"></select></label>
          <label class="full-field final-type-field"><span>Transición de imagen</span><select data-cue-field="transitionType">
            <option value="cut">Sin transición</option>
            <option value="fade-black">Fundido a negro</option>
            <option value="crossfade">Superposición / fundido cruzado</option>
            <option value="fade-white">Fundido a blanco</option>
            <option value="slide">Desplazamiento desde la derecha</option>
          </select></label>
          <label><span>Duración · segundos</span><input type="number" min="0" max="120" step="0.1" data-cue-field="transitionDurationSeconds" /></label>
          <label><span>Quien habla</span><input type="text" data-cue-field="speaker" /></label>
          <label><span>Nueva imagen <em>(opcional)</em></span><input type="file" accept="image/*" data-cue-image /></label>
        </div>
        <p class="cue-transition-help">La nueva imagen queda completamente visible al terminar este tiempo.</p>
        <p class="cue-image-status"></p>
        <label class="full-field"><span>Nuevo diálogo</span><div class="cue-text" contenteditable="true" role="textbox" aria-multiline="true" data-cue-text></div></label>`;

      card.querySelector('[data-cue-field="seconds"]').value = String(cue.atMs / 1000);
      card.querySelector('[data-cue-field="transitionType"]').value = cue.transitionType || "cut";
      const transitionDuration = card.querySelector('[data-cue-field="transitionDurationSeconds"]');
      transitionDuration.value = String((cue.transitionDurationMs ?? 1000) / 1000);
      transitionDuration.disabled = (cue.transitionType || "cut") === "cut";
      card.querySelector('[data-cue-field="speaker"]').value = cue.speaker;
      const layerSelect = card.querySelector('[data-cue-field="targetLayerId"]');
      const automaticOption = document.createElement("option");
      automaticOption.value = "";
      automaticOption.textContent = "Última capa disponible";
      layerSelect.append(automaticOption);
      this.scene.stage.layers.forEach((layer) => {
        const asset = this.project.getAsset(layer.assetId);
        const option = document.createElement("option");
        option.value = layer.id;
        option.textContent = asset ? asset.name : "Capa sin imagen";
        layerSelect.append(option);
      });
      layerSelect.value = cue.targetLayerId || "";
      const imageStatus = card.querySelector(".cue-image-status");
      imageStatus.textContent = cue.assetId
        ? `Reemplazará por: ${this.project.getAsset(cue.assetId)?.name || "imagen guardada"}`
        : "Añade una imagen para aplicar la transición visual; los cambios de diálogo sí se aplicarán.";
      const cueText = card.querySelector("[data-cue-text]");
      cueText.innerHTML = cue.text?.html || "";
      cueText.lang = cue.text?.lang || this.activeDialogue?.text.lang || "und";
      fragment.append(card);
    });

    if (!this.scene.timedCues.length) {
      const empty = document.createElement("p");
      empty.className = "helper-text";
      empty.textContent = "Sin cambios programados. Añade uno para que la escena evolucione sola.";
      fragment.append(empty);
    }
    this.dom.cueList.replaceChildren(fragment);
  }

  renderInspector() {
    const layer = this.scene?.getLayer(this.selectedLayerId);
    const asset = layer ? this.project.getAsset(layer.assetId) : null;
    this.renderObjectControls();
    this.renderHintControls();
    const enabled = Boolean(layer);
    [this.dom.layerX, this.dom.layerY, this.dom.layerWidth, this.dom.layerAlt, this.dom.layerNaturalSize, this.dom.layerFitStage].forEach((input) => {
      input.disabled = !enabled;
    });
    this.dom.selectedLayerName.textContent = asset?.name || "Ninguna";
    if (!layer) {
      [this.dom.layerX, this.dom.layerY, this.dom.layerWidth, this.dom.layerAlt].forEach((input) => setNativeInputValue(input, ""));
      return;
    }
    setNativeInputValue(this.dom.layerX, layer.xPct);
    setNativeInputValue(this.dom.layerY, layer.yPct);
    setNativeInputValue(this.dom.layerWidth, layer.widthPct);
    setNativeInputValue(this.dom.layerAlt, asset?.alt || "");
  }

  renderCharacterSheet() {
    const sheet = this.project?.characterSheet;
    const list = this.dom.characterAttributeList;
    const progression = this.dom.characterProgressionList;
    if (!sheet || !list || !progression) return;
    if (this.dom.characterDistributablePoints) {
      this.dom.characterDistributablePoints.value = String(sheet.distributablePoints);
      this.dom.characterDistributablePoints.disabled = this.isPreviewing;
    }
    this.dom.characterAttributeName.disabled = this.isPreviewing;
    this.dom.characterAttributeInitial.disabled = this.isPreviewing;
    this.dom.addCharacterAttribute.disabled = this.isPreviewing;
    const attributes = document.createDocumentFragment();
    sheet.attributes.forEach((attribute) => {
      const row = document.createElement("div");
      row.className = "object-attribute-definition-row character-attribute-row";
      const name = document.createElement("input");
      name.type = "text";
      name.maxLength = 60;
      name.value = attribute.name;
      name.disabled = this.isPreviewing;
      name.dataset.characterAttributeName = attribute.id;
      name.setAttribute("aria-label", `Nombre del atributo ${attribute.name}`);
      const value = document.createElement("input");
      value.type = "number";
      value.step = "any";
      value.value = String(attribute.initialValue);
      value.disabled = this.isPreviewing;
      value.dataset.characterAttributeInitial = attribute.id;
      value.setAttribute("aria-label", `Valor inicial de ${attribute.name}`);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "icon-button object-attribute-definition-remove";
      remove.textContent = "×";
      remove.dataset.removeCharacterAttribute = attribute.id;
      remove.disabled = this.isPreviewing;
      remove.setAttribute("aria-label", `Eliminar atributo ${attribute.name}`);
      row.append(name, value, remove);
      attributes.append(row);
    });
    list.replaceChildren(attributes);

    const combatTotal = this.project.scenes.reduce((total, scene) => total + scene.combatChallenges.length, 0);
    const quizTotal = this.project.scenes.reduce((total, scene) => total + scene.quizChallenges.length, 0);
    const eventOptions = [
      ["module-completed", `Escena superada · ${this.project.scenes.length} escenas`],
      ["combat-won", `Combate ganado · ${combatTotal} combates`],
      ["quiz-solved", `Quiz resuelto · ${quizTotal} retos`],
    ];
    const rules = document.createDocumentFragment();
    sheet.progressionRules.forEach((rule) => {
      const row = document.createElement("div");
      row.className = "character-progression-row";
      const amount = document.createElement("input");
      amount.type = "number";
      amount.step = "any";
      amount.value = String(rule.pointsPerUnit);
      amount.disabled = this.isPreviewing;
      amount.dataset.characterProgression = rule.id;
      amount.dataset.characterProgressionField = "pointsPerUnit";
      amount.setAttribute("aria-label", "Puntos de progreso por unidad");
      const select = document.createElement("select");
      select.className = "styled-select";
      select.dataset.characterProgression = rule.id;
      select.dataset.characterProgressionField = "event";
      select.disabled = this.isPreviewing;
      eventOptions.forEach(([value, label]) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        select.append(option);
      });
      select.value = rule.event;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "icon-button object-attribute-definition-remove";
      remove.textContent = "×";
      remove.dataset.removeCharacterProgression = rule.id;
      remove.disabled = this.isPreviewing;
      remove.setAttribute("aria-label", "Eliminar regla de progreso");
      row.append(amount, select, remove);
      rules.append(row);
    });
    progression.replaceChildren(rules);
    this.dom.addCharacterProgression.disabled = this.isPreviewing;
  }

  addCharacterSheetAttribute() {
    if (this.isPreviewing || !this.project) return;
    const name = this.dom.characterAttributeName?.value || "";
    const attribute = this.project.addCharacterAttribute(name, this.dom.characterAttributeInitial?.value);
    if (!attribute) return;
    this.dom.characterAttributeName.value = "";
    this.dom.characterAttributeInitial.value = "0";
    this.renderCharacterSheet();
    this.renderCharacterEditor();
    this.renderCombatEditor();
    this.renderEventEditor();
    this.renderObjectControls();
    this.markDirty("Atributo de personaje añadido.");
  }

  updateCharacterSheetAttribute(event) {
    if (this.isPreviewing) return;
    const control = event.target.closest("[data-character-attribute-name], [data-character-attribute-initial]");
    if (!control) return;
    const id = control.dataset.characterAttributeName || control.dataset.characterAttributeInitial;
    const attribute = this.project.characterSheet.attributes.find((item) => item.id === id);
    if (!attribute) return;
    if (control.hasAttribute("data-character-attribute-name")) {
      if (!this.project.renameCharacterAttribute(id, control.value)) control.value = attribute.name;
      this.renderCharacterEditor();
      this.renderCombatEditor();
      this.renderEventEditor();
    } else {
      attribute.initialValue = Math.max(-100000, Math.min(100000, Number(control.value) || 0));
      this.project.playerCharacters.forEach((character) => {
        const value = character.attributes.find((entry) => entry.attributeId === id);
        if (value) value.value = attribute.initialValue;
      });
      control.value = String(attribute.initialValue);
      this.renderCharacterEditor();
    }
    this.markDirty();
  }

  removeCharacterSheetAttribute(attributeId) {
    if (this.isPreviewing || !this.project.removeCharacterAttribute(attributeId)) return;
    this.renderCharacterSheet();
    this.renderCharacterEditor();
    this.renderCombatEditor();
    this.renderEventEditor();
    this.renderObjectControls();
    this.markDirty("Atributo de personaje eliminado.");
  }

  updateCharacterProgression(event) {
    if (this.isPreviewing) return;
    const control = event.target.closest("[data-character-progression-field]");
    const rule = this.project.characterSheet.progressionRules.find((item) => item.id === control?.dataset.characterProgression);
    if (!rule) return;
    if (control.dataset.characterProgressionField === "event") rule.event = ["module-completed", "combat-won", "quiz-solved"].includes(control.value) ? control.value : "module-completed";
    else rule.pointsPerUnit = Math.max(-100000, Math.min(100000, Number(control.value) || 0));
    if (control.dataset.characterProgressionField === "event") this.renderCharacterSheet();
    this.markDirty("Progreso actualizado.");
  }

  renderCharacterEditor() {
    const list = this.dom.characterList;
    if (!list || !this.project) return;
    const fragment = document.createDocumentFragment();
    if (!this.project.playerCharacters.length) {
      const empty = document.createElement("p");
      empty.className = "helper-text quiz-empty-state";
      empty.textContent = "Aún no hay personajes. Pulsa + para crear uno.";
      fragment.append(empty);
    }
    this.project.playerCharacters.forEach((character, index) => {
      const card = document.createElement("article");
      card.className = `quiz-card character-card${this.expandedCharacterIds.has(character.id) ? "" : " is-collapsed"}`;
      card.dataset.playerCharacterId = character.id;
      const heading = document.createElement("div");
      heading.className = "quiz-card-heading character-card-heading";
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "sidebar-collapse-toggle quiz-card-toggle";
      toggle.dataset.togglePlayerCharacter = character.id;
      toggle.setAttribute("aria-expanded", String(this.expandedCharacterIds.has(character.id)));
      toggle.textContent = this.expandedCharacterIds.has(character.id) ? "▾" : "▸";
      toggle.setAttribute("aria-label", `${this.expandedCharacterIds.has(character.id) ? "Plegar" : "Desplegar"} ${character.name}`);
      const name = document.createElement("input");
      name.type = "text";
      name.maxLength = 100;
      name.value = character.name;
      name.disabled = this.isPreviewing;
      name.dataset.playerCharacterName = character.id;
      name.setAttribute("aria-label", `Nombre del personaje ${index + 1}`);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "icon-button object-attribute-definition-remove";
      remove.textContent = "×";
      remove.dataset.removePlayerCharacter = character.id;
      remove.disabled = this.isPreviewing;
      remove.setAttribute("aria-label", `Eliminar ${character.name}`);
      const actions = document.createElement("div");
      actions.className = "tool-section-actions";
      actions.append(remove);
      heading.append(toggle, name, actions);
      const content = document.createElement("div");
      content.className = "quiz-card-content character-card-content";
      content.hidden = !this.expandedCharacterIds.has(character.id);
      const values = new Map(character.attributes.map((entry) => [entry.attributeId, entry.value]));
      this.project.characterSheet.attributes.forEach((definition) => {
        const label = document.createElement("label");
        label.className = "full-field character-profile-attribute";
        const caption = document.createElement("span");
        caption.textContent = definition.name;
        const input = document.createElement("input");
        input.type = "number";
        input.step = "any";
        input.value = String(values.get(definition.id) ?? definition.initialValue);
        input.disabled = this.isPreviewing;
        input.dataset.playerCharacterAttribute = definition.id;
        input.setAttribute("aria-label", `${definition.name} de ${character.name}`);
        label.append(caption, input);
        content.append(label);
      });
      card.append(heading, content);
      fragment.append(card);
    });
    list.replaceChildren(fragment);
  }

  updateCharacterProfile(event) {
    if (this.isPreviewing) return;
    const control = event.target.closest("[data-player-character-name], [data-player-character-attribute]");
    const card = control?.closest("[data-player-character-id]");
    const character = this.project.playerCharacters.find((item) => item.id === card?.dataset.playerCharacterId);
    if (!control || !character) return;
    if (control.hasAttribute("data-player-character-name")) {
      character.name = control.value.trim().slice(0, 100) || "Nuevo personaje";
    } else {
      const id = control.dataset.playerCharacterAttribute;
      const entry = character.attributes.find((item) => item.attributeId === id);
      if (!entry) return;
      entry.value = Math.max(-100000, Math.min(100000, Number(control.value) || 0));
      control.value = String(entry.value);
    }
    this.markDirty();
  }

  handleCharacterListClick(event) {
    const toggle = event.target.closest("[data-toggle-player-character]");
    if (toggle) {
      const id = toggle.dataset.togglePlayerCharacter;
      if (this.expandedCharacterIds.has(id)) this.expandedCharacterIds.delete(id);
      else this.expandedCharacterIds.add(id);
      this.renderCharacterEditor();
      return;
    }
    const remove = event.target.closest("[data-remove-player-character]");
    if (!remove || this.isPreviewing) return;
    this.project.removePlayerCharacter(remove.dataset.removePlayerCharacter);
    this.expandedCharacterIds.delete(remove.dataset.removePlayerCharacter);
    this.renderCharacterEditor();
    this.renderObjectControls();
    this.renderPreview();
    this.markDirty("Personaje eliminado.");
  }

  renderCharacterSetup() {
    const state = this.player.character;
    if (!state || !this.dom.characterSetupAttributes) return;
    const remaining = state.distributablePoints;
    this.dom.characterSetupPoints.textContent = remaining
      ? `Puntos distribuibles disponibles: ${remaining}`
      : "No quedan puntos distribuibles.";
    const fragment = document.createDocumentFragment();
    this.project.characterSheet.attributes.forEach((attribute) => {
      const row = document.createElement("div");
      row.className = "character-setup-attribute";
      const label = document.createElement("span");
      label.textContent = attribute.name;
      const value = document.createElement("output");
      value.textContent = String(state.value(attribute.id));
      const lower = document.createElement("button");
      lower.type = "button";
      lower.className = "icon-button";
      lower.textContent = "−";
      lower.dataset.characterSetupStep = attribute.id;
      lower.dataset.delta = "-1";
      lower.disabled = state.value(attribute.id) <= attribute.initialValue;
      lower.setAttribute("aria-label", `Quitar un punto de ${attribute.name}`);
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
    this.dom.characterSetupAttributes.replaceChildren(fragment);
  }

  finishCharacterSetup() {
    if (!this.isPreviewing || !this.scene) return;
    const state = this.player.character;
    state.configure({
      name: this.dom.playerCharacterName?.value || "Jugador",
      values: Object.fromEntries(state.attributes),
      distributablePoints: state.distributablePoints,
    });
    const dialog = this.dom.characterSetupDialog;
    if (dialog?.open && typeof dialog.close === "function") dialog.close();
    else dialog?.removeAttribute("open");
    this.player.start(this.scene.id);
    this.setInventoryNotesEnabled(true, this.player.inventory.notesHtml);
    this.renderInventoryGrid();
    this.renderInspector();
  }

  toggleCharacterPanel(forceOpen = null) {
    const panel = this.dom.characterPanel;
    const button = this.dom.characterToggle;
    if (!panel || !button) return;
    const open = forceOpen == null ? panel.hidden : Boolean(forceOpen);
    if (open) {
      [this.dom.inventoryPanel, this.dom.pencilPanel, this.dom.mapPanel, this.dom.videoPlaybackPanel].forEach((other) => {
        if (other) { other.hidden = true; other.setAttribute("aria-hidden", "true"); }
      });
      [this.dom.inventoryToggle, this.dom.pencilToggle, this.dom.mapToggle].forEach((other) => other?.setAttribute("aria-expanded", "false"));
      this.renderPlayerCharacterPanel();
    }
    panel.hidden = !open;
    panel.setAttribute("aria-hidden", String(!open));
    button.setAttribute("aria-expanded", String(open));
    button.setAttribute("aria-label", open ? "Cerrar personaje" : "Ver personaje");
    button.title = open ? "Cerrar personaje" : "Ver personaje";
  }

  renderPlayerCharacterPanel() {
    const content = this.dom.characterPanelContent;
    if (!content) return;
    const state = this.player.character;
    const fragment = document.createDocumentFragment();
    const name = document.createElement("h3");
    name.className = "character-panel-name";
    name.textContent = state?.name || "Jugador";
    fragment.append(name);
    this.project.characterSheet.attributes.forEach((attribute) => {
      const row = document.createElement("p");
      row.className = "character-panel-stat";
      const label = document.createElement("strong");
      label.textContent = `${attribute.name}: `;
      const value = document.createElement("span");
      value.textContent = String(state?.value(attribute.id) ?? attribute.initialValue);
      row.append(label, value);
      fragment.append(row);
    });
    const progress = document.createElement("p");
    progress.className = "character-panel-progress";
    const combatTotal = this.project.scenes.reduce((total, scene) => total + scene.combatChallenges.length, 0);
    const quizTotal = this.project.scenes.reduce((total, scene) => total + scene.quizChallenges.length, 0);
    progress.textContent = `Progreso: ${Number(state?.progress) || 0} puntos · Escenas ${state?.completedModules.size || 0}/${this.project.scenes.length} · Combates ${state?.rewardedCombats.size || 0}/${combatTotal} · Quiz ${state?.rewardedQuizzes.size || 0}/${quizTotal}`;
    fragment.append(progress);
    content.replaceChildren(fragment);
    if (this.dom.characterPanelHeading) this.dom.characterPanelHeading.textContent = state?.name || "Personaje";
  }

  openCharacterInfo(character, trigger = null) {
    if (!character) return;
    const values = new Map((character.attributes || []).map((entry) => [entry.attributeId, entry.value]));
    const details = this.project.characterSheet.attributes.map((attribute) => ({
      text: `${attribute.name}: ${values.get(attribute.id) ?? attribute.initialValue}`,
    }));
    this.openHintOverlay(details, trigger, character.name || "Personaje");
  }

  renderObjectControls() {
    const select = this.dom.objectLayerSelect;
    if (!select) return;
    const layers = this.scene?.stage.layers || [];
    const signature = `${this.scene?.id || ""}|${layers.map((layer) => {
      const asset = this.project.getAsset(layer.assetId);
      return `${layer.id}:${layer.assetId}:${asset?.name || ""}`;
    }).join("|")}`;
    // La lista cambia al cambiar de escena o de capas, no durante cada gesto de arrastre.
    if (select.dataset.objectSignature !== signature) {
      const options = document.createDocumentFragment();
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = layers.length ? "Selecciona un objeto" : "No hay imágenes en esta escena";
      options.append(placeholder);

      layers.forEach((layer, index) => {
        const asset = this.project.getAsset(layer.assetId);
        if (!asset) return;
        const option = document.createElement("option");
        option.value = layer.id;
        option.textContent = `${asset.name || `Objeto ${index + 1}`} · capa ${index + 1}`;
        options.append(option);
      });

      select.replaceChildren(options);
      select.dataset.objectSignature = signature;
    }
    const selectedLayer = layers.find((candidate) => candidate.id === this.selectedLayerId);
    select.value = selectedLayer ? selectedLayer.id : "";
    select.disabled = this.isPreviewing || select.options.length <= 1;
    const canEdit = Boolean(selectedLayer) && !this.isPreviewing;
this.renderObjectAttributeControls(selectedLayer);
    this.dom.objectInventoryEnabled.checked = Boolean(selectedLayer?.inventoryEnabled);
    this.dom.objectInventoryEnabled.disabled = !canEdit;
    this.dom.objectCombinableEnabled.checked = Boolean(selectedLayer?.combinableEnabled);
    this.dom.objectCombinableEnabled.disabled = !canEdit;
    this.dom.objectUniqueEnabled.checked = Boolean(selectedLayer?.unique);
    this.dom.objectUniqueEnabled.disabled = !canEdit;
    this.dom.objectCharacterEnabled.checked = Boolean(selectedLayer?.characterEnabled);
    this.dom.objectCharacterEnabled.disabled = !canEdit || this.project.playerCharacters.length === 0;
    const characterSelect = this.dom.objectCharacterLink;
    if (characterSelect) {
      const selectedCharacterId = selectedLayer?.characterId || "";
      const options = document.createDocumentFragment();
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = this.project.playerCharacters.length ? "Selecciona un personaje" : "Crea un personaje primero";
      options.append(placeholder);
      this.project.playerCharacters.forEach((character) => {
        const option = document.createElement("option");
        option.value = character.id;
        option.textContent = character.name;
        options.append(option);
      });
      characterSelect.replaceChildren(options);
      characterSelect.value = selectedCharacterId;
      characterSelect.disabled = !canEdit || !selectedLayer?.characterEnabled || this.project.playerCharacters.length === 0;
      this.dom.objectCharacterLinkField.hidden = !selectedLayer?.characterEnabled;
    }
    this.renderObjectCompatibilityList(selectedLayer);
    this.renderObjectCombinationResult(selectedLayer);
  }

  renderObjectAttributeDefinitions() {
    const list = this.dom.objectAttributeDefinitionList;
    if (!list || !this.project) return;
    if (this.dom.objectAttributeName) this.dom.objectAttributeName.disabled = this.isPreviewing;
    if (this.dom.addObjectAttribute) this.dom.addObjectAttribute.disabled = this.isPreviewing;
    const fragment = document.createDocumentFragment();
    this.project.objectAttributeDefinitions.forEach((attribute) => {
      const row = document.createElement("div");
      row.className = "object-attribute-definition-row";
      const input = document.createElement("input");
      input.type = "text";
      input.maxLength = 60;
      input.value = attribute.name;
      input.disabled = this.isPreviewing;
      input.dataset.objectAttributeName = attribute.id;
      input.setAttribute("aria-label", `Nombre del atributo ${attribute.name}`);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "icon-button object-attribute-definition-remove";
      remove.textContent = "×";
      remove.dataset.removeObjectAttribute = attribute.id;
      remove.disabled = this.isPreviewing;
      remove.setAttribute("aria-label", `Eliminar atributo ${attribute.name}`);
      remove.title = "Eliminar atributo";
      row.append(input, remove);
      fragment.append(row);
    });
    if (!this.project.objectAttributeDefinitions.length) {
      const empty = document.createElement("p");
      empty.className = "helper-text object-attribute-empty";
      empty.textContent = "Todavía no hay atributos definidos.";
      fragment.append(empty);
    }
    list.replaceChildren(fragment);
  }
  renderObjectAttributeControls(layer = this.scene?.getLayer(this.selectedLayerId)) {
    const select = this.dom.objectAttributeSelect;
    const valueInput = this.dom.objectAttributeValue;
    const addButton = this.dom.addObjectAttributeValue;
    const list = this.dom.objectAttributeList;
    if (!select || !valueInput || !addButton || !list || !this.project) return;
    const definitions = this.project.objectAttributeDefinitions;
    const signature = definitions.map(({ id, name }) => `${id}:${name}`).join("|");
    const previousValue = select.value;
    if (select.dataset.attributeSignature !== signature) {
      const options = document.createDocumentFragment();
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = definitions.length ? "Selecciona un atributo" : "Define atributos en Explorador · Objetos";
      options.append(placeholder);
      definitions.forEach((attribute) => {
        const option = document.createElement("option");
        option.value = attribute.id;
        option.textContent = attribute.name;
        options.append(option);
      });
      select.replaceChildren(options);
      select.dataset.attributeSignature = signature;
    }
    const asset = layer ? this.project.getAsset(layer.assetId) : null;
    const canEdit = Boolean(asset) && !this.isPreviewing;
    const assignedIds = new Set((asset?.attributes || []).map((attribute) => attribute.attributeId));
    const selectedId = definitions.some((attribute) => attribute.id === previousValue && !assignedIds.has(attribute.id))
      ? previousValue
      : definitions.find((attribute) => !assignedIds.has(attribute.id))?.id || "";
    select.value = selectedId;
    select.disabled = !canEdit || definitions.length === 0;
    const selectedAttribute = definitions.find((attribute) => attribute.id === selectedId);
    valueInput.disabled = !canEdit || !selectedAttribute;
    addButton.disabled = !canEdit || !selectedAttribute;

    const fragment = document.createDocumentFragment();
    (asset?.attributes || []).forEach((value) => {
      const definition = definitions.find((attribute) => attribute.id === value.attributeId);
      if (!definition) return;
      const row = document.createElement("div");
      row.className = "object-attribute-value-item";
      const name = document.createElement("span");
      name.className = "object-attribute-value-name";
      name.textContent = definition.name;
      const input = document.createElement("input");
      input.type = "number";
      input.step = "any";
      input.value = String(value.value);
      input.disabled = !canEdit;
      input.dataset.objectAttributeValue = definition.id;
      input.setAttribute("aria-label", `Valor de ${definition.name}`);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "icon-button object-attribute-value-remove";
      remove.textContent = "×";
      remove.dataset.removeObjectAttributeValue = definition.id;
      remove.disabled = !canEdit;
      remove.setAttribute("aria-label", `Quitar ${definition.name} del objeto`);
      remove.title = "Quitar del objeto";
      row.append(name, input, remove);
      fragment.append(row);
    });
    if (!asset?.attributes?.length) {
      const empty = document.createElement("p");
      empty.className = "helper-text object-attribute-empty";
      empty.textContent = asset ? "Este objeto todavía no tiene atributos." : "Selecciona una imagen de la escena.";
      fragment.append(empty);
    }
    list.replaceChildren(fragment);
  }
  addObjectAttributeDefinition() {
    if (this.isPreviewing || !this.project) return;
    const attribute = this.project.addObjectAttribute(this.dom.objectAttributeName?.value);
    if (!attribute) return;
    if (this.dom.objectAttributeName) this.dom.objectAttributeName.value = "";
    this.renderObjectAttributeDefinitions();
    this.renderEventEditor();
    this.renderObjectControls();
    this.markDirty("Atributo de objeto añadido.");
  }
  renameObjectAttributeDefinition(attributeId, value) {
    if (this.isPreviewing || !this.project) return;
    if (!this.project.renameObjectAttribute(attributeId, value)) {
      this.renderObjectAttributeDefinitions();
      return;
    }
    this.renderObjectAttributeDefinitions();
    this.renderEventEditor();
    this.renderObjectControls();
    this.renderInventoryGrid();
    this.markDirty("Nombre del atributo actualizado.");
  }
  removeObjectAttributeDefinition(attributeId) {
    if (this.isPreviewing || !this.project?.removeObjectAttribute(attributeId)) return;
    this.renderObjectAttributeDefinitions();
    this.renderEventEditor();
    this.renderObjectControls();
    this.renderInventoryGrid();
    this.markDirty("Atributo de objeto eliminado.");
  }
  addSelectedObjectAttribute() {
    if (this.isPreviewing) return;
    const layer = this.scene?.getLayer(this.selectedLayerId);
    const asset = layer ? this.project.getAsset(layer.assetId) : null;
    const attributeId = this.dom.objectAttributeSelect?.value;
    const value = Number(this.dom.objectAttributeValue?.value);
    if (!asset || !attributeId || asset.attributes.some((attribute) => attribute.attributeId === attributeId)) return;
    asset.attributes.push({ attributeId, value: Number.isFinite(value) ? value : 0 });
    this.renderObjectControls();
    this.renderInventoryGrid();
    this.markDirty("Atributo asignado al objeto.");
  }
  updateObjectAttributeValue(attributeId, rawValue) {
    if (this.isPreviewing) return;
    const layer = this.scene?.getLayer(this.selectedLayerId);
    const asset = layer ? this.project.getAsset(layer.assetId) : null;
    const attribute = asset?.attributes.find((entry) => entry.attributeId === String(attributeId || ""));
    if (!attribute) return;
    const value = Number(rawValue);
    attribute.value = Number.isFinite(value) ? value : 0;
    this.renderInventoryGrid();
    this.markDirty("Valor del atributo actualizado.");
  }
  removeSelectedObjectAttribute(attributeId) {
    if (this.isPreviewing) return;
    const layer = this.scene?.getLayer(this.selectedLayerId);
    const asset = layer ? this.project.getAsset(layer.assetId) : null;
    if (!asset) return;
    asset.attributes = asset.attributes.filter((attribute) => attribute.attributeId !== String(attributeId || ""));
    this.renderObjectControls();
    this.renderInventoryGrid();
    this.markDirty("Atributo retirado del objeto.");
  }
  renderHintControls() {
    const select = this.dom.hintLayerSelect;
    if (!select) return;
    const layers = this.scene?.stage.layers || [];
    const signature = `${this.scene?.id || ""}|${layers.map((layer) => {
      const asset = this.project.getAsset(layer.assetId);
      return `${layer.id}:${layer.assetId}:${asset?.name || ""}`;
    }).join("|")}`;
    if (select.dataset.hintSignature !== signature) {
      const options = document.createDocumentFragment();
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = layers.length ? "Selecciona una imagen" : "No hay imágenes en esta escena";
      options.append(placeholder);
      layers.forEach((layer, index) => {
        const asset = this.project.getAsset(layer.assetId);
        if (!asset) return;
        const option = document.createElement("option");
        option.value = layer.id;
        option.textContent = `${asset.name || `Imagen ${index + 1}`} · capa ${index + 1}`;
        options.append(option);
      });
      select.replaceChildren(options);
      select.dataset.hintSignature = signature;
    }
    const selectedLayer = layers.find((candidate) => candidate.id === this.selectedLayerId);
    select.value = selectedLayer ? selectedLayer.id : "";
    select.disabled = this.isPreviewing || select.options.length <= 1;
    const canEdit = Boolean(selectedLayer) && !this.isPreviewing;
    this.dom.hintEnabled.checked = Boolean(selectedLayer?.clueEnabled);
    this.dom.hintEnabled.disabled = !canEdit;
    this.dom.addHintText.disabled = !canEdit;
    this.renderHintTextList(selectedLayer);
  }

  renderHintTextList(selectedLayer) {
    const list = this.dom.hintTextList;
    if (!list) return;
    const clues = Array.isArray(selectedLayer?.clues) ? selectedLayer.clues : [];
    const rows = clues.length ? clues : (selectedLayer ? [{ id: "", text: "", placeholder: true }] : []);
    const fragment = document.createDocumentFragment();
    if (!rows.length) {
      const empty = document.createElement("p");
      empty.className = "hint-text-empty";
      empty.textContent = "Selecciona una imagen de la escena para escribir sus pistas.";
      fragment.append(empty);
    }
    rows.forEach((clue) => {
      const row = document.createElement("div");
      row.className = "hint-text-row";
      const textarea = document.createElement("textarea");
      textarea.className = "hint-text-input";
      textarea.placeholder = "Pon texto";
      textarea.rows = 2;
      textarea.value = clue.text || "";
      textarea.disabled = this.isPreviewing || !selectedLayer;
      textarea.setAttribute("aria-label", "Texto de pista");
      if (clue.id) textarea.dataset.hintTextId = clue.id;
      else textarea.dataset.hintNew = "true";
      row.append(textarea);
      if (clue.id) {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "icon-button hint-text-remove";
        remove.textContent = "×";
        remove.dataset.removeHintText = clue.id;
        remove.disabled = this.isPreviewing;
        remove.setAttribute("aria-label", "Eliminar texto de pista");
        row.append(remove);
      }
      fragment.append(row);
    });
    list.replaceChildren(fragment);
  }

  selectHintLayer() {
    if (this.isPreviewing) return;
    const layer = this.scene?.getLayer(this.dom.hintLayerSelect.value);
    if (!layer) return;
    this.selectedLayerId = layer.id;
    this.selectedLayerBySceneId.set(this.activeSceneId, layer.id);
    this.selectedDialogueId = null;
    this.selectedDialogueBySceneId.set(this.activeSceneId, null);
    this.renderMapResourceControls();
    this.renderInspector();
    this.renderPreview();
  }

  updateSelectedHintEnabled() {
    if (this.isPreviewing) return;
    const layer = this.scene?.getLayer(this.selectedLayerId);
    if (!layer) return;
    layer.clueEnabled = this.dom.hintEnabled.checked;
    if (layer.clueEnabled && !layer.clues.length) layer.clues.push({ id: createId("clue"), text: "" });
    this.renderHintControls();
    this.renderPreview();
    this.markDirty("Pista de la imagen actualizada.");
  }

  renderMapResourceControls() {
    if (!this.dom) return;
    const select = this.dom.mapLayerSelect;
    const cellSelect = this.dom.mapLayerCellSelect;
    if (!select || !cellSelect || !this.project) return;
    const layers = this.scene?.stage.layers || [];
    const options = document.createDocumentFragment();
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = layers.length ? "Selecciona una imagen" : "No hay imágenes en esta escena";
    options.append(placeholder);
    layers.forEach((layer, index) => {
      const asset = this.project.getAsset(layer.assetId);
      if (!asset) return;
      const option = document.createElement("option");
      option.value = layer.id;
      option.textContent = `${asset.name || `Imagen ${index + 1}`} · capa ${index + 1}`;
      options.append(option);
    });
    select.replaceChildren(options);
    const selectedLayer = layers.find((candidate) => candidate.id === this.selectedLayerId);
    select.value = selectedLayer ? selectedLayer.id : "";
    select.disabled = this.isPreviewing || select.options.length <= 1;
    this.dom.mapLayerEnabled.checked = Boolean(selectedLayer?.mapEnabled);
    this.dom.mapLayerEnabled.disabled = this.isPreviewing || !selectedLayer;

    const map = this.project.adventureMap = normalizeAdventureMap(this.project.adventureMap);
    const allLayers = this.project.scenes.flatMap((scene) => scene.stage.layers);
    const cellOptions = document.createDocumentFragment();
    const cellPlaceholder = document.createElement("option");
    cellPlaceholder.value = "";
    cellPlaceholder.textContent = selectedLayer?.mapCellKey
      ? "Sin casilla asignada"
      : selectedLayer
        ? "Selecciona una casilla libre"
        : layers.length
          ? "Selecciona una imagen primero"
          : "No hay imágenes en esta escena";
    cellOptions.append(cellPlaceholder);
    let selectableCellCount = 0;
    const currentKey = selectedLayer?.mapCellKey || null;
    const cellsInGrid = map.cells.filter((cell) => Number(cell.row) <= map.size && Number(cell.column) <= map.size);
    const currentCellInGrid = cellsInGrid.some((cell) => `${cell.row}:${cell.column}` === currentKey);
    if (currentKey && !currentCellInGrid) {
      const outsideCell = map.cells.find((cell) => `${cell.row}:${cell.column}` === currentKey);
      if (outsideCell) {
        const option = document.createElement("option");
        option.value = currentKey;
        option.textContent = `Casilla ${outsideCell.row}, ${outsideCell.column} · fuera de la cuadrícula actual`;
        cellOptions.append(option);
        selectableCellCount += 1;
      }
    }
    cellsInGrid.forEach((cell) => {
      const key = `${cell.row}:${cell.column}`;
      const owner = allLayers.find((layer) => layer.id !== selectedLayer?.id && layer.mapCellKey === key);
      if (owner) return;
      const option = document.createElement("option");
      option.value = key;
      const target = cell.moduleNumber ? ` · Escena ${cell.moduleNumber}` : "";
      option.textContent = `Casilla ${cell.row}, ${cell.column}${target}${key === currentKey ? " · asignada a esta imagen" : " · libre"}`;
      cellOptions.append(option);
      selectableCellCount += 1;
    });
    if (!selectableCellCount && selectedLayer && !currentKey) cellPlaceholder.textContent = "No quedan casillas libres";
    cellSelect.replaceChildren(cellOptions);
    cellSelect.value = currentKey || "";
    cellSelect.disabled = this.isPreviewing || !selectedLayer?.mapEnabled || cellSelect.options.length <= 1;
  }

  selectMapLayer() {
    if (this.isPreviewing) return;
    const layer = this.scene?.getLayer(this.dom.mapLayerSelect?.value);
    if (!layer) return;
    this.selectedLayerId = layer.id;
    this.selectedLayerBySceneId.set(this.activeSceneId, layer.id);
    this.selectedDialogueId = null;
    this.selectedDialogueBySceneId.set(this.activeSceneId, null);
    this.renderMapResourceControls();
    this.renderInspector();
    this.renderPreview();
  }

  updateSelectedMapEnabled() {
    if (this.isPreviewing) return;
    const layer = this.scene?.getLayer(this.dom.mapLayerSelect?.value);
    if (!layer) return;
    layer.mapEnabled = Boolean(this.dom.mapLayerEnabled.checked);
    if (!layer.mapEnabled) this.clearMapCellAssignment(layer);
    this.renderMapResourceControls();
    this.renderAdventureMapEditor();
    this.renderMapPanel();
    this.renderPreview();
    this.markDirty("Icono de mapa de la imagen actualizado.");
  }

  clearMapCellAssignment(layer) {
    if (!layer?.mapCellKey) return;
    const oldKey = layer.mapCellKey;
    const cell = this.project.adventureMap.cells.find((candidate) => `${candidate.row}:${candidate.column}` === oldKey);
    const stillAssigned = this.project.scenes.some((scene) => scene.stage.layers.some((candidate) => (
      candidate.id !== layer.id && candidate.mapCellKey === oldKey
    )));
    if (!stillAssigned && cell && Number(cell.moduleNumber) === Number(this.scene?.moduleNumber)) cell.moduleNumber = null;
    layer.mapCellKey = null;
  }

  assignSelectedMapCell() {
    if (this.isPreviewing) return;
    const layer = this.scene?.getLayer(this.dom.mapLayerSelect?.value);
    if (!layer?.mapEnabled) return;
    const nextKey = this.dom.mapLayerCellSelect?.value || null;
    const nextCell = nextKey
      ? this.project.adventureMap.cells.find((cell) => `${cell.row}:${cell.column}` === nextKey)
      : null;
    const owner = nextKey && this.project.scenes.some((scene) => scene.stage.layers.some((candidate) => (
      candidate.id !== layer.id && candidate.mapCellKey === nextKey
    )));
    if (nextKey && (!nextCell || owner)) {
      this.renderMapResourceControls();
      return;
    }
    if (layer.mapCellKey === nextKey) return;
    this.clearMapCellAssignment(layer);
    layer.mapCellKey = nextKey;
    if (nextCell) nextCell.moduleNumber = Number(this.scene?.moduleNumber) || null;
    this.renderMapResourceControls();
    this.renderAdventureMapEditor();
    this.renderMapPanel();
    this.renderPreview();
    this.markDirty(nextCell
      ? `Imagen vinculada a la casilla ${nextCell.row}, ${nextCell.column}.`
      : "Vínculo de la imagen con el mapa eliminado.");
  }

  addHintText() {
    if (this.isPreviewing) return;
    const layer = this.scene?.getLayer(this.dom.hintLayerSelect.value);
    if (!layer) return;
    layer.clues.push({ id: createId("clue"), text: "" });
    this.renderHintControls();
    const inputs = this.dom.hintTextList.querySelectorAll("[data-hint-text-id]");
    inputs[inputs.length - 1]?.focus();
    this.markDirty("Texto de pista añadido.");
  }

  updateHintText(clueId, text) {
    if (this.isPreviewing) return;
    const layer = this.scene?.getLayer(this.dom.hintLayerSelect.value);
    const clue = layer?.clues.find((candidate) => candidate.id === clueId);
    if (!clue) return;
    clue.text = String(text || "");
    this.markDirty("Texto de pista actualizado.");
  }

  materializeNewHintText(textarea) {
    if (this.isPreviewing || !textarea?.dataset.hintNew) return;
    const layer = this.scene?.getLayer(this.dom.hintLayerSelect.value);
    if (!layer) return;
    const clue = { id: createId("clue"), text: textarea.value || "" };
    layer.clues.push(clue);
    delete textarea.dataset.hintNew;
    textarea.dataset.hintTextId = clue.id;
    this.markDirty("Texto de pista añadido.");
  }

  removeHintText(clueId) {
    if (this.isPreviewing) return;
    const layer = this.scene?.getLayer(this.dom.hintLayerSelect.value);
    if (!layer) return;
    layer.clues = layer.clues.filter((clue) => clue.id !== clueId);
    this.renderHintControls();
    this.markDirty("Texto de pista eliminado.");
  }

  getResourceModuleNames(resourceId, type = CombinationRules.resourceType(this.project, resourceId)) {
    return this.project.scenes
      .filter((scene) => type === "sound"
        ? scene.soundIds.includes(resourceId)
        : scene.assetIds.includes(resourceId)
          || scene.stage.layers.some((layer) => layer.assetId === resourceId)
          || scene.canvasStyle.backgroundImageAssetId === resourceId)
      .map((scene) => scene.name || "Escena sin nombre");
  }

  renderObjectCompatibilityList(selectedLayer = this.scene?.getLayer(this.selectedLayerId)) {
    const section = this.dom.objectCompatibility;
    const list = this.dom.objectCompatibilityList;
    if (!section || !list) return;
    const canEdit = Boolean(selectedLayer?.combinableEnabled) && !this.isPreviewing;
    section.hidden = !canEdit;
    if (!canEdit) return;

    const options = CombinationRules.resources(this.project)
      .filter((resource) => resource.id !== selectedLayer.assetId)
      .map((resource) => {
        const type = CombinationRules.resourceType(this.project, resource.id);
        const sceneNames = this.getResourceModuleNames(resource.id, type);
        return { resource, type, sceneNames };
      });
    const signature = `${selectedLayer.id}|${options.map(({ resource, type, sceneNames }) => (
      `${resource.id}:${type}:${resource.name || ""}:${sceneNames.join(",")}`
    )).join("|")}`;
    if (list.dataset.compatibilitySignature !== signature) {
      const fragment = document.createDocumentFragment();
      if (!options.length) {
        const empty = document.createElement("p");
        empty.className = "object-compatibility-empty";
        empty.textContent = "No hay otros recursos en el proyecto.";
        fragment.append(empty);
      } else {
        options.forEach(({ resource, type, sceneNames }) => {
          const label = document.createElement("label");
          label.className = "object-compatibility-option";
          const checkbox = document.createElement("input");
          checkbox.type = "checkbox";
          checkbox.dataset.compatibleResourceId = resource.id;
          checkbox.setAttribute("aria-label", `Combinar con ${resource.name || (type === "sound" ? "sonido" : "imagen")}`);
          const copy = document.createElement("span");
          copy.className = "object-compatibility-copy";
          const name = document.createElement("span");
          name.className = "object-compatibility-name";
          name.textContent = resource.name || (type === "sound" ? "Sonido sin nombre" : "Imagen sin nombre");
          const module = document.createElement("small");
          module.className = "object-compatibility-module";
          const resourceLabel = type === "sound" ? "Sonido MP3" : "Imagen";
          module.textContent = `${resourceLabel} · ${sceneNames.length ? sceneNames.join(", ") : "sin escena"}`;
          copy.append(name, module);
          label.append(checkbox, copy);
          fragment.append(label);
        });
      }
      list.replaceChildren(fragment);
      list.dataset.compatibilitySignature = signature;
    }

    const compatibleResourceIds = new Set(selectedLayer.combinableWithResourceIds || []);
    list.querySelectorAll("[data-compatible-resource-id]").forEach((input) => {
      input.checked = compatibleResourceIds.has(input.dataset.compatibleResourceId);
      input.disabled = this.isPreviewing;
    });
  }

  renderObjectCombinationResult(selectedLayer = this.scene?.getLayer(this.selectedLayerId)) {
    const select = this.dom.objectCombinationResult;
    if (!select) return;
    const resources = CombinationRules.resources(this.project);
    const signature = resources.map((resource) => {
      const type = CombinationRules.resourceType(this.project, resource.id);
      return `${resource.id}:${resource.name || ""}:${type}:${this.getResourceModuleNames(resource.id, type).join(",")}`;
    }).join("|");
    if (select.dataset.resourceSignature !== signature) {
      const fragment = document.createDocumentFragment();
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = resources.length ? "Selecciona el resultado" : "No hay recursos";
      fragment.append(placeholder);
      ["image", "sound"].forEach((type) => {
        const groupedResources = resources.filter((resource) => CombinationRules.resourceType(this.project, resource.id) === type);
        if (!groupedResources.length) return;
        const group = document.createElement("optgroup");
        group.label = type === "sound" ? "Sonidos" : "Imágenes";
        groupedResources.forEach((resource) => {
          const option = document.createElement("option");
          option.value = resource.id;
          const moduleNames = this.getResourceModuleNames(resource.id, type);
          const resourceName = resource.name || (type === "sound" ? "Sonido sin nombre" : "Imagen sin nombre");
          option.textContent = `${resourceName} · ${moduleNames.length ? moduleNames.join(", ") : "sin escena"}`;
          group.append(option);
        });
        fragment.append(group);
      });
      select.replaceChildren(fragment);
      select.dataset.resourceSignature = signature;
    }
    select.value = selectedLayer?.combinationResultAssetId || "";
    select.disabled = !selectedLayer?.combinableEnabled || this.isPreviewing || resources.length === 0;
  }

  selectObjectLayer() {
    if (this.isPreviewing) return;
    const layer = this.scene?.getLayer(this.dom.objectLayerSelect.value);
    if (!layer) return;
    this.selectedLayerId = layer.id;
    this.selectedLayerBySceneId.set(this.activeSceneId, layer.id);
    this.selectedDialogueId = null;
    this.selectedDialogueBySceneId.set(this.activeSceneId, null);
    this.renderInspector();
    this.renderPreview();
  }

  updateSelectedObjectFlags() {
    if (this.isPreviewing) return;
    const layer = this.scene?.getLayer(this.selectedLayerId);
    if (!layer) return;
    layer.inventoryEnabled = this.dom.objectInventoryEnabled.checked;
    layer.combinableEnabled = this.dom.objectCombinableEnabled.checked;
    layer.unique = this.dom.objectUniqueEnabled.checked;
    layer.characterEnabled = Boolean(this.dom.objectCharacterEnabled.checked && this.project.playerCharacters.length);
    if (!layer.characterEnabled) layer.characterId = null;
    else if (!this.project.playerCharacters.some((character) => character.id === layer.characterId)) layer.characterId = this.project.playerCharacters[0]?.id || null;
    this.renderObjectCompatibilityList(layer);
    this.renderObjectCombinationResult(layer);
    this.renderObjectControls();
    this.renderPreview();
    this.markDirty("Marcas del objeto actualizadas.");
  }

  updateSelectedObjectCharacterLink() {
    if (this.isPreviewing) return;
    const layer = this.scene?.getLayer(this.selectedLayerId);
    const characterId = this.dom.objectCharacterLink?.value || "";
    if (!layer?.characterEnabled || !this.project.playerCharacters.some((character) => character.id === characterId)) return;
    layer.characterId = characterId;
    this.renderPreview();
    this.markDirty("Personaje vinculado a la ilustración.");
  }

  updateSelectedObjectCompatibility(targetResourceId, compatible) {
    if (this.isPreviewing) return;
    const layer = this.scene?.getLayer(this.selectedLayerId);
    if (!layer?.combinableEnabled || !targetResourceId || targetResourceId === layer.assetId) return;
    if (!CombinationRules.resource(this.project, targetResourceId)) return;
    const compatibleResourceIds = new Set(layer.combinableWithResourceIds || []);
    if (compatible) compatibleResourceIds.add(targetResourceId);
    else compatibleResourceIds.delete(targetResourceId);
    layer.combinableWithResourceIds = [...compatibleResourceIds];
    this.renderObjectCompatibilityList(layer);
    this.markDirty("Recursos compatibles actualizados.");
  }

  updateSelectedCombinationResult() {
    if (this.isPreviewing) return;
    const layer = this.scene?.getLayer(this.selectedLayerId);
    if (!layer?.combinableEnabled) return;
    const resultId = this.dom.objectCombinationResult?.value || null;
    if (resultId && !CombinationRules.resource(this.project, resultId)) return;
    layer.combinationResultAssetId = resultId;
    this.markDirty("Resultado de la combinación actualizado.");
  }

  appendObjectActionIcons(layerElement, layer, asset, sceneId) {
    const scene = this.project.getScene(sceneId);
    const soundActions = (scene?.soundCues || [])
      .filter((cue) => cue.imageLayerId === layer.id && this.project.getSoundAsset(cue.soundId))
      .map((cue) => ({
        key: "sound",
        cueId: cue.id,
        soundId: cue.soundId,
        enabled: true,
        label: `Reproducir sonido asociado a ${asset.name || "imagen"}`,
        icon: '<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="14"/><path d="M7.5 13h4l5-4v14l-5-4h-4z"/><path d="M20 12a6 6 0 0 1 0 8M22.5 9.5a9.5 9.5 0 0 1 0 13"/></svg>',
      }));
const videoActions = (scene?.videoCues || [])
.filter((cue) => cue.imageLayerId === layer.id && this.project.getVideoAsset(cue.videoId))
.map((cue) => ({
key: "video",
cueId: cue.id,
videoId: cue.videoId,
enabled: true,
label: `Reproducir vídeo asociado a ${asset.name || "imagen"}`,
icon: '<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="14"/><rect x="7.5" y="10" width="17" height="12" rx="1.5"/><path d="m14 13 5 3-5 3z"/></svg>',
}));
    const actions = [
      {
        key: "inventory",
        enabled: layer.inventoryEnabled,
        label: `Añadir ${asset.name || "objeto"} al inventario`,
        icon: '<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="14"/><rect x="9.5" y="7.5" width="13" height="17" rx="1.5"/><path d="M12.5 12h7M12.5 16h7M12.5 20h4"/></svg>',
      },
      {
        key: "character",
        enabled: layer.characterEnabled && this.project.playerCharacters.some((character) => character.id === layer.characterId),
        label: `Consultar personaje de ${asset.name || "imagen"}`,
        icon: '<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="14"/><path d="M12.4 12a3.8 3.8 0 1 1 6.6 2.6c-1.6 1.5-3 2.1-3 4.4M16 23.1v.1"/></svg>',
      },
      {
        key: "combine",
        enabled: CombinationRules.canStart(this.project, layer.assetId, layer.id),
        label: `Combinar ${asset.name || "objeto"}`,
        icon: '<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="14"/><path d="M8 10.5h5a2.5 2.5 0 1 1 5 0h5v5a2.5 2.5 0 1 0 0 5v1H18a2.5 2.5 0 1 1-5 0h-5z"/><path d="M18 10.5h5v4"/></svg>',
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
      ...soundActions,
      ...videoActions,
    ].filter((action) => action.enabled && (!this.isPreviewing || action.key !== "combine"));
    if (!actions.length) return;

    const container = document.createElement("div");
    container.className = `object-action-icons${this.isPreviewing ? " is-interactive" : ""}`;
    container.setAttribute("aria-label", "Acciones del objeto");
    actions.forEach((action) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "object-action-icon";
      button.dataset.objectAction = action.key;
      button.setAttribute("aria-label", action.label);
      button.title = action.label;
      button.tabIndex = this.isPreviewing ? 0 : -1;
      button.innerHTML = action.icon;
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!this.isPreviewing) return;
        if (action.key === "sound") {
          const detail = { sceneId, layerId: layer.id, soundId: action.soundId, soundCueId: action.cueId };
          button.dispatchEvent(new CustomEvent("escena-viva:sound-action", { bubbles: true, detail }));
          this.player.playSoundCue(action.cueId);
          this.setPlaybackStatus(`Reproduciendo ${this.project.getSoundAsset(action.soundId)?.name || "sonido"}.`);
          return;
        }
        if (action.key === "video") {
          const detail = { sceneId, layerId: layer.id, videoId: action.videoId, videoCueId: action.cueId };
          button.dispatchEvent(new CustomEvent("escena-viva:video-action", { bubbles: true, detail }));
          this.playVideoCue(action.cueId);
          return;
        }
        const detail = {
          action: action.key,
          sceneId,
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
        if (action.key === "character") {
          const character = this.project.playerCharacters.find((candidate) => candidate.id === layer.characterId);
          this.openCharacterInfo(character, button);
          return;
        }
        // El mismo evento DOM se usa en «Probar» y en el reproductor exportado.
        button.dispatchEvent(new CustomEvent("escena-viva:object-action", { bubbles: true, detail }));
        if (action.key === "map") {
          const result = this.player.activateMapForCurrentScene(detail.assetId, detail.mapCellKey);
          button.dispatchEvent(new CustomEvent("escena-viva:map-action", {
            bubbles: true,
            detail: { ...detail, moduleNumber: this.player.scene?.moduleNumber || null, ok: result.ok },
          }));
          this.renderMapPanel();
          this.setPlaybackStatus(result.message);
        } else if (action.key === "inventory") {
          const result = this.player.inventory.add(detail.assetId, {
            unique: detail.unique,
            capacity: this.inventoryCapacity(),
          });
          const message = this.inventoryResultMessage(result, detail.assetName);
          this.setInventoryMessage(message, !result.ok);
          this.renderInventoryGrid();
          this.setPlaybackStatus(message);
        } else if (action.key === "combine") {
          this.beginStageCombination(layer.id, sceneId);
        } else {
          this.collectLayerClues(detail, button);
        }
      });
      container.append(button);
    });
    layerElement.append(container);
  }

  playSceneVideos(scene) {
    this.closeVideoPlayback();
    const cue = (scene?.videoCues || []).find((candidate) => candidate.playOnStart);
    if (cue) this.playVideoCue(cue.id);
  }

  playVideoAsset(videoId) {
    const asset = this.project.getVideoAsset(videoId);
    const panel = this.dom.videoPlaybackPanel;
    const video = this.dom.videoPlaybackElement;
    if (!asset?.dataUrl || !panel || !video || !this.isPreviewing) return false;
    this.closeVideoPlayback();
    if (this.dom.videoPlaybackTitle) this.dom.videoPlaybackTitle.textContent = asset.name || "Vídeo";
    video.src = asset.dataUrl;
    video.volume = 1;
    try { video.currentTime = 0; } catch {}
    panel.hidden = false;
    panel.setAttribute("aria-hidden", "false");
    video.play()?.catch(() => this.setPlaybackStatus("Pulsa reproducir en el vídeo para iniciar la reproducción."));
    this.setPlaybackStatus(`Reproduciendo ${asset.name || "vídeo"}.`);
    return true;
  }

  playVideoCue(cueId) {
    const cue = this.scene?.videoCues.find((candidate) => candidate.id === cueId);
    const asset = cue && this.project.getVideoAsset(cue.videoId);
    const panel = this.dom.videoPlaybackPanel;
    const video = this.dom.videoPlaybackElement;
    if (!cue || !asset?.dataUrl || !panel || !video || !this.isPreviewing) return false;
    this.closeVideoPlayback();
    if (this.dom.videoPlaybackTitle) this.dom.videoPlaybackTitle.textContent = asset.name || "Vídeo";
    video.src = asset.dataUrl;
    video.volume = cue.volumePercent / 100;
    try { video.currentTime = 0; } catch {}
    panel.hidden = false;
    panel.setAttribute("aria-hidden", "false");
    this.activeVideoCueId = cue.id;
    video.play()?.catch(() => this.setPlaybackStatus("Pulsa reproducir en el vídeo para iniciar la reproducción."));
    const duration = Number(cue.durationSeconds);
    if (Number.isFinite(duration) && duration > 0) {
      this.videoPlaybackTimeout = window.setTimeout(() => {
        video.pause();
        this.videoPlaybackTimeout = null;
      }, duration * 1000);
    }
    this.setPlaybackStatus(`Reproduciendo ${asset.name || "vídeo"}.`);
    return true;
  }

  closeVideoPlayback() {
    if (this.videoPlaybackTimeout) window.clearTimeout(this.videoPlaybackTimeout);
    this.videoPlaybackTimeout = null;
    this.activeVideoCueId = null;
    const video = this.dom?.videoPlaybackElement;
    if (video) {
      video.pause();
      try { video.currentTime = 0; } catch {}
    }
    const panel = this.dom?.videoPlaybackPanel;
    if (panel) {
      panel.hidden = true;
      panel.setAttribute("aria-hidden", "true");
    }
  }

  getStackItems(scene = this.scene) {
    if (!scene) return [];
    return [
      ...scene.stage.layers.map((item) => ({ kind: "image", item })),
      ...scene.dialogues.map((item) => ({ kind: "dialogue", item })),
    ].sort((left, right) => (left.item.zIndex || 1) - (right.item.zIndex || 1));
  }

  setStackPosition(kind, itemId, rawPosition) {
    const stack = this.getStackItems();
    const index = stack.findIndex((entry) => entry.kind === kind && entry.item.id === itemId);
    if (index < 0) return;
    const requested = Number(rawPosition);
    if (!Number.isFinite(requested)) {
      this.renderAssets();
      this.renderPreview();
      return;
    }
    const [entry] = stack.splice(index, 1);
    stack.splice(clamp(Math.round(requested) - 1, 0, stack.length), 0, entry);
    stack.forEach((item, itemIndex) => { item.item.zIndex = itemIndex + 1; });
    this.renderAssets();
    this.markDirty("Orden de capas actualizado.");
  }

  addDialogue() {
    if (!this.scene || this.isPreviewing) return;
    const previous = this.activeDialogue;
    const stack = this.getStackItems();
    const baseX = previous?.placement.xPct ?? 50;
    const baseY = previous?.placement.yPct ?? 69;
    const dialogue = new DialogueBlock({
      text: { html: "", lang: previous?.text.lang || "und", dir: previous?.text.dir || "auto" },
      placement: {
        xPct: previous ? clamp(baseX + 4, 0, 100) : baseX,
        yPct: previous ? clamp(baseY + 4, 0, 100) : baseY,
        widthPct: previous?.placement.widthPct ?? 88,
      },
      zIndex: stack.length + 1,
    });
    this.scene.dialogues.push(dialogue);
    this.scene.normalizeStackPositions();
    this.selectedDialogueId = dialogue.id;
    this.selectedDialogueBySceneId.set(this.activeSceneId, dialogue.id);
    this.dialogueEditorExpanded = true;
    this.selectedLayerId = null;
    this.selectedLayerBySceneId.set(this.activeSceneId, null);
    this.hydrateDialogueEditors();
    this.renderAll();
    this.markDirty("Caja de diálogo añadida.");
    this.dialogueRichText.focus();
  }

  removeDialogue() {
    if (!this.scene || !this.selectedDialogueId || !this.scene.getDialogue(this.selectedDialogueId) || this.isPreviewing) return;
    this.scene.dialogues = this.scene.dialogues.filter((dialogue) => dialogue.id !== this.selectedDialogueId);
    this.scene.normalizeStackPositions();
    this.selectedDialogueId = this.scene.dialogues[0]?.id ?? null;
    this.selectedDialogueBySceneId.set(this.activeSceneId, this.selectedDialogueId);
    this.dialogueEditorExpanded = true;
    this.hydrateDialogueEditors();
    this.renderAll();
    this.markDirty("Caja de diálogo eliminada.");
  }

  applyTheme() {
    Object.entries(THEME_BINDINGS).forEach(([key, { css }]) => {
      this.dom.gamePreview.style.setProperty(css, this.project.theme.variables[key]);
    });
    const dialogueStyle = this.scene?.dialogueStyle || {};
    const dialogueVariables = {
      "--dialogue-bg": dialogueStyle.backgroundColor,
      "--dialogue-color": dialogueStyle.textColor,
      "--accent-color": dialogueStyle.accentColor,
      "--border-color": dialogueStyle.borderColor,
      "--dialogue-font-family": dialogueStyle.fontFamily || "Georgia, 'Times New Roman', serif",
      "--dialogue-font-size": dialogueStyle.fontSizePx ? `${dialogueStyle.fontSizePx}px` : "clamp(0.82rem, 1.55vw, 1.15rem)",
    };
    Object.entries(dialogueVariables).forEach(([name, value]) => {
      if (value) this.dom.gamePreview.style.setProperty(name, value);
    });
    this.applyDecisionStyle(this.scene?.decisions);
    this.dom.customCssPreview.textContent = scopedCss([
      this.project.theme.customCss,
      dialogueStyle.customCss,
      this.scene?.decisions?.style?.customCss,
    ].filter(Boolean).join("\n"));
  }

  applyDecisionStyle(decisions) {
    const style = decisions?.style || {};
    const variables = {
      "--choice-bg": style.backgroundColor || "#15131c",
      "--choice-color": style.textColor || "#f9f4e7",
      "--choice-accent": style.accentColor || "#e7ae54",
      "--choice-border": style.borderColor || "#f2d07c",
      "--choice-prompt-color": decisions?.promptColor || "#f9f4e7",
      "--choice-prompt-size": `${decisions?.promptFontSize ?? 18}px`,
      "--choice-font-family": style.fontFamily || "inherit",
      "--choice-font-size": style.fontSizePx ? `${style.fontSizePx}px` : "clamp(0.64rem, 1.1vw, 0.88rem)",
    };
    Object.entries(variables).forEach(([name, value]) => this.dom.gamePreview.style.setProperty(name, value));
  }

  showTab(name) {
    this.dom.tabs.forEach((tab) => {
      const active = tab.dataset.tab === name;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
    });
    this.dom.tabPanels.forEach((panel) => {
      const active = panel.dataset.panel === name;
      panel.classList.toggle("is-active", active);
      panel.hidden = !active;
    });
    window.requestAnimationFrame(() => {
      this.ensureToolTabVisible(name);
      this.updateToolTabsPagination();
    });
  }

  async addImageFiles(fileList, addToStage) {
    const imageExtension = /\.(avif|bmp|gif|heic|heif|jpe?g|png|svg|tiff?|webp)$/i;
    const files = [...(fileList || [])].filter(
      (file) => file.type.startsWith("image/") || imageExtension.test(file.name),
    );
    if (!files.length) {
      this.setSaveStatus("Elige un archivo de imagen válido.", true);
      return;
    }

    try {
      for (const file of files) {
        const asset = await ImageAsset.fromFile(file);
        this.project.addAsset(asset, this.activeSceneId);
        if (addToStage) this.addLayerForAsset(asset.id);
      }
      this.dom.assetInput.value = "";
      this.renderAssets();
this.renderQuizEditor();
      this.renderInspector();
      this.markDirty(`${files.length} imagen${files.length === 1 ? " añadida" : "es añadidas"}.`);
    } catch (error) {
      this.setSaveStatus(`No se pudo leer la imagen: ${error.message}`, true);
    }
  }

  addAssetToStage(event) {
    const addButton = event.target.closest("[data-asset-add]");
    if (!addButton || addButton.disabled || this.isPreviewing) return;
    this.placeResourceImageOnStage(addButton.dataset.assetId);
  }

  placeResourceImageOnStage(assetId, { position = null, animate = false } = {}) {
    if (this.isPreviewing || !this.scene?.assetIds.includes(assetId)) return;

    const existingLayer = this.scene.stage.layers
      .filter((layer) => layer.assetId === assetId)
      .sort((left, right) => left.zIndex - right.zIndex)
      .find((layer) => layer.id === this.selectedLayerId)
      || this.scene.stage.layers
        .filter((layer) => layer.assetId === assetId)
        .sort((left, right) => left.zIndex - right.zIndex)[0];
    if (existingLayer) {
      this.selectedLayerId = existingLayer.id;
      this.selectedLayerBySceneId.set(this.activeSceneId, existingLayer.id);
      this.selectedDialogueId = null;
      this.selectedDialogueBySceneId.set(this.activeSceneId, null);
      this.hydrateDialogueEditors();
      this.renderInspector();
      this.renderPreview();
      this.renderAssets();
      this.announce(`Capa «${this.project.getAsset(assetId)?.name || "imagen"}» seleccionada. Pulsa + para añadir otra copia.`);
      return existingLayer;
    }

    const layer = this.addLayerForAsset(assetId, position);
    if (typeof this.project.getSoundAssetsForScene === "function") this.renderSoundResources();
    if (typeof this.project.getVideoAssetsForScene === "function") this.renderVideoResources();
    this.renderAssets();
this.renderQuizEditor();
    this.renderInspector();
    this.markDirty("Imagen añadida al escenario.");
    const layerElement = [...(this.dom?.stageLayers?.children || [])]
      .find((element) => element.dataset.layerId === layer?.id);
    if (layerElement && position) {
      const bounds = this.dom?.stage?.getBoundingClientRect();
      const minimumX = this.getCanvasMinimumCenterXPct(layerElement, bounds);
      const previousX = layer.xPct;
      layer.xPct = clamp(layer.xPct, minimumX, LAYER_POSITION_MAX);
      layerElement.style.left = `${layer.xPct}%`;
      if (this.dom?.layerX) setNativeInputValue(this.dom.layerX, layer.xPct);
      if (layer.xPct !== previousX) this.scheduleAutoSave();
    }
    if (layerElement && animate) {
      layerElement.classList.add("is-drop-entering");
      layerElement.addEventListener("animationend", () => layerElement.classList.remove("is-drop-entering"), { once: true });
    }
    return layer;
  }

  handleAssetListClick(event) {
    const removeSoundButton = event.target.closest("[data-remove-sound]");
    if (removeSoundButton) {
      this.selectedSoundIdsBySceneId.set(this.activeSceneId, removeSoundButton.dataset.removeSound);
      this.removeSelectedSound();
      return;
    }
    const selectSoundButton = event.target.closest("[data-select-sound]");
    if (selectSoundButton) {
      const soundId = selectSoundButton.dataset.selectSound;
      this.selectedSoundIdsBySceneId.set(this.activeSceneId, soundId);
      if (!this.scene?.soundCues.some((cue) => cue.soundId === soundId)) this.scene?.addSoundCue({ soundId });
      this.renderSoundResources();
      this.showTab("tool-resources");
      return;
    }
    const removeVideoButton = event.target.closest("[data-remove-video]");
    if (removeVideoButton) {
      this.removeVideoFromModule(removeVideoButton.dataset.removeVideo);
      return;
    }
    const selectVideoButton = event.target.closest("[data-select-video]");
    if (selectVideoButton) {
      const videoId = selectVideoButton.dataset.selectVideo;
      this.selectedVideoIdsBySceneId.set(this.activeSceneId, videoId);
      if (!this.scene?.videoCues.some((cue) => cue.videoId === videoId)) this.scene?.addVideoCue({ videoId });
      this.renderVideoResources();
      this.showTab("tool-resources");
  this.markDirty("Vídeo seleccionado para esta escena.");
      return;
    }
    const removeButton = event.target.closest("[data-remove-asset]");
    if (removeButton) {
      this.removeAssetFromModule(removeButton.dataset.removeAsset);
      return;
    }
    const addLayerButton = event.target.closest("[data-add-layer]");
    if (addLayerButton) {
      if (addLayerButton.disabled || this.isPreviewing) return;
      this.addAnotherAssetLayer(addLayerButton.dataset.addLayer);
      return;
    }
    this.addAssetToStage(event);
  }

  removeVideoFromModule(videoId) {
    if (!this.scene || this.isPreviewing) return;
    const video = this.project.getVideoAsset(videoId);
    if (!video) return;
    const usedElsewhere = this.project.scenes.some((scene) => (
      scene.id !== this.activeSceneId && scene.videoIds.includes(videoId)
    ));
    const retained = usedElsewhere ? " El recurso seguirá disponible en las demás escenas." : "";
    if (!window.confirm(`¿Quitar «${video.name}» de la escena «${this.scene.name}»?${retained}`)) return;
    this.project.removeVideoAssetFromScene(videoId, this.activeSceneId);
    this.selectedVideoIdsBySceneId.delete(this.activeSceneId);
    this.renderAll();
    this.markDirty("Vídeo quitado de la escena.");
  }

  addAnotherAssetLayer(assetId) {
    if (this.isPreviewing || !this.scene?.assetIds.includes(assetId)) return;
    this.addLayerForAsset(assetId);
if (typeof this.project.getSoundAssetsForScene === "function") this.renderSoundResources();
if (typeof this.project.getVideoAssetsForScene === "function") this.renderVideoResources();
    this.renderAssets();
    this.renderInspector();
    this.markDirty("Otra copia de la imagen añadida al escenario.");
  }

  removeAssetFromModule(assetId) {
    if (this.isPreviewing) return;
    const asset = this.project.getAsset(assetId);
    if (!asset || !this.scene) return;
    const removedLayers = this.scene.stage.layers.filter((layer) => layer.assetId === assetId);
    const removedLayerIds = new Set(removedLayers.map((layer) => layer.id));
    const linkedCueCount = this.scene.timedCues.filter((cue) => (
      cue.assetId === assetId || removedLayerIds.has(cue.targetLayerId)
    )).length;
    const existsElsewhere = this.project.scenes.some((scene) => (
      scene.id !== this.activeSceneId && (
        scene.assetIds.includes(assetId)
        || scene.stage.layers.some((layer) => layer.assetId === assetId)
        || scene.timedCues.some((cue) => cue.assetId === assetId)
      )
    ));
    const detail = removedLayers.length || linkedCueCount
      ? `\n\nSe quitarán ${removedLayers.length} capa(s) y se actualizarán ${linkedCueCount} cambio(s) temporizado(s) en esta escena.`
      : "";
    const retained = existsElsewhere ? " El recurso seguirá disponible en las demás escenas." : "";
    if (!window.confirm(`¿Quitar «${asset.name}» de la escena «${this.scene.name}»?${detail}${retained}`)) return;
    if (!this.project.removeAssetFromScene(assetId, this.activeSceneId)) return;

    this.scene.normalizeStackPositions();

    if (removedLayerIds.has(this.selectedLayerId)) this.selectedLayerId = this.scene.stage.layers[0]?.id ?? null;
    this.selectedLayerBySceneId.set(this.activeSceneId, this.selectedLayerId);
    if (this.selectedLayerId && !this.scene.getLayer(this.selectedLayerId)) {
      this.selectedLayerId = this.scene.stage.layers[0]?.id ?? null;
    }
    this.selectedLayerBySceneId.set(this.activeSceneId, this.selectedLayerId);
    this.renderAll();
    this.markDirty();
  }

  addLayerForAsset(assetId, position = null) {
    const firstLayer = this.scene.stage.layers.length === 0;
    const asset = this.project.getAsset(assetId);
    const stack = this.getStackItems();
    const dialogueIndex = stack.findIndex((entry) => entry.kind === "dialogue");
    const insertionIndex = dialogueIndex < 0 ? stack.length : dialogueIndex;
    const xPct = Number(position?.xPct);
    const yPct = Number(position?.yPct);
    const layer = new ImageLayer({
      assetId,
      xPct: Number.isFinite(xPct) ? clamp(xPct, LAYER_POSITION_MIN, LAYER_POSITION_MAX) : 50,
      yPct: Number.isFinite(yPct) ? clamp(yPct, LAYER_POSITION_MIN, LAYER_POSITION_MAX) : 50,
      widthPct: this.getNaturalWidthPct(asset, firstLayer ? 100 : 55),
      zIndex: insertionIndex + 1,
    });
    this.scene.stage.layers.push(layer);
    stack.splice(insertionIndex, 0, { kind: "image", item: layer });
    this.scene.normalizeStackPositions();
    this.selectedLayerId = layer.id;
    this.selectedDialogueId = null;
    this.selectedLayerBySceneId.set(this.activeSceneId, layer.id);
    this.selectedDialogueBySceneId.set(this.activeSceneId, null);
    this.hydrateDialogueEditors();
    this.renderMapResourceControls();
    return layer;
  }

  updateChoice(event) {
    const field = event.target.dataset.choiceField;
    if (field !== "targetSceneId") return;
    const card = event.target.closest("[data-choice-id]");
    const choice = this.scene.decisions.choices.find((candidate) => candidate.id === card?.dataset.choiceId);
    if (!choice) return;
    choice[field] = event.target.value || null;
    this.markDirty();
    if (field === "targetSceneId") this.renderModuleGraph();
  }

  toggleDecisionSection(toggle) {
    if (!this.scene) return;
    const card = toggle.closest("[data-choice-id]");
    const choiceId = card?.dataset.choiceId;
    const index = this.scene.decisions.choices.findIndex((choice) => choice.id === choiceId);
    if (!choiceId || index < 0) return;
    const expandedIds = this.expandedDecisionIdsBySceneId.get(this.scene.id) || new Set();
    if (expandedIds.has(choiceId)) expandedIds.delete(choiceId);
    else expandedIds.add(choiceId);
    this.expandedDecisionIdsBySceneId.set(this.scene.id, expandedIds);
    const expanded = expandedIds.has(choiceId);
    card.classList.toggle("is-collapsed", !expanded);
    const content = card.querySelector(".quiz-card-content");
    if (content) content.hidden = !expanded;
    toggle.textContent = expanded ? "▾" : "▸";
    toggle.setAttribute("aria-expanded", String(expanded));
    toggle.setAttribute("aria-label", `${expanded ? "Plegar" : "Desplegar"} decisión ${index + 1}`);
    toggle.title = `${expanded ? "Plegar" : "Desplegar"} decisión ${index + 1}`;
  }

  removeChoice(event) {
    if (!event.target.closest("[data-remove-choice]")) return;
    const card = event.target.closest("[data-choice-id]");
    const choiceId = card?.dataset.choiceId;
    this.scene.decisions.removeChoice(choiceId);
    const expandedIds = this.expandedDecisionIdsBySceneId.get(this.scene.id) || new Set();
    expandedIds.delete(choiceId);
    if (!expandedIds.size && this.scene.decisions.choices[0]) expandedIds.add(this.scene.decisions.choices[0].id);
    this.expandedDecisionIdsBySceneId.set(this.scene.id, expandedIds);
    if (this.selectedChoiceId === choiceId) this.selectedChoiceId = null;
    this.renderChoiceList();
    this.renderPreview();
    this.renderModuleGraph();
    this.markDirty("Decisión eliminada.");
  }

  updateDecisionStyle(input) {
    if (!this.scene) return;
    const decisions = this.scene.decisions;
    if (input === this.dom.decisionPromptSize) decisions.promptFontSize = Math.min(72, Math.max(8, Number(input.value) || 18));
    else if (input === this.dom.decisionPromptColor) decisions.promptColor = input.value;
    else if (input === this.dom.decisionStyleBgMode || input === this.dom.decisionStyleBg) {
      const choice = decisions.choices.find((item) => item.id === this.selectedChoiceId);
      if (!choice) return;
      choice.backgroundColor = input === this.dom.decisionStyleBgMode
        ? (input.value === "transparent" ? "transparent" : (this.dom.decisionStyleBg?.value || decisions.style.backgroundColor || "#15131c"))
        : input.value;
      this.renderPreview();
      this.hydrateDecisionBackgroundControls();
      this.markDirty();
      return;
    }
    else if (input === this.dom.decisionStyleText) decisions.style.textColor = input.value;
    else if (input === this.dom.decisionStyleAccent) decisions.style.accentColor = input.value;
    else if (input === this.dom.decisionStyleBorder) decisions.style.borderColor = input.value;
    else if (input === this.dom.decisionCustomCss) decisions.style.customCss = input.value;
    this.applyTheme();
    const prompt = this.dom.choicePreview.querySelector(".choice-prompt");
    if (prompt) {
      prompt.style.fontSize = `${decisions.promptFontSize}px`;
      prompt.style.color = decisions.promptColor;
    }
    this.markDirty();
  }

  updateDialogueStyle(input) {
    if (!this.scene) return;
    const style = this.scene.dialogueStyle;
    if (input === this.dom.dialogueStyleBgMode || input === this.dom.dialogueStyleBg) {
      const dialogue = this.activeDialogue;
      if (!dialogue) return;
      dialogue.backgroundColor = input === this.dom.dialogueStyleBgMode
        ? (input.value === "transparent" ? "transparent" : (this.dom.dialogueStyleBg?.value || style.backgroundColor || this.project.theme.variables.dialogueBg))
        : input.value;
      this.renderPreview();
      this.hydrateDialogueStyleControls();
      this.markDirty();
      return;
    }
    if (input === this.dom.dialogueStyleText) style.textColor = input.value;
    else if (input === this.dom.dialogueStyleAccent) style.accentColor = input.value;
    else if (input === this.dom.dialogueStyleBorder) style.borderColor = input.value;
    else if (input === this.dom.dialogueCustomCss) style.customCss = input.value;
    this.applyTheme();
    this.markDirty();
  }

  updateCue(event) {
    const card = event.target.closest("[data-cue-id]");
    const cue = this.scene.timedCues.find((candidate) => candidate.id === card?.dataset.cueId);
    if (!cue) return;
    if (event.target.matches("[data-cue-text]")) {
      cue.text = new RichTextBlock({
        html: sanitizeRichHtml(event.target.innerHTML),
        lang: this.activeDialogue?.text.lang || "und",
      });
      this.markDirty();
      return;
    }
    const field = event.target.dataset.cueField;
    if (!field) return;
    if (field === "seconds") cue.atMs = Math.max(0, Number(event.target.value) || 0) * 1000;
    if (field === "transitionDurationSeconds") cue.transitionDurationMs = Math.min(120, Math.max(0, Number(event.target.value) || 0)) * 1000;
    if (field === "transitionType") {
      cue.transitionType = event.target.value;
      const durationInput = card.querySelector('[data-cue-field="transitionDurationSeconds"]');
      if (durationInput) durationInput.disabled = cue.transitionType === "cut";
    }
    if (field === "speaker") {
      cue.speaker = event.target.value;
      this.renderSpeakerOptions();
    }
    this.markDirty();
  }

  async changeCue(event) {
    const card = event.target.closest("[data-cue-id]");
    const cue = this.scene.timedCues.find((candidate) => candidate.id === card?.dataset.cueId);
    if (!cue) return;

    if (event.target.matches('[data-cue-field="targetLayerId"]')) {
      cue.targetLayerId = event.target.value || null;
      this.markDirty();
      return;
    }

    if (event.target.matches('[data-cue-field="transitionType"]')) {
      cue.transitionType = event.target.value;
      const durationInput = card.querySelector('[data-cue-field="transitionDurationSeconds"]');
      if (durationInput) durationInput.disabled = cue.transitionType === "cut";
      this.markDirty();
      return;
    }

    if (event.target.matches("[data-cue-image]")) {
      const [file] = event.target.files || [];
      if (!file) return;
      try {
        const asset = await ImageAsset.fromFile(file);
        this.project.addAsset(asset, this.activeSceneId);
        cue.assetId = asset.id;
        this.renderAssets();
        this.renderQuizEditor();
        this.renderCueList();
        this.markDirty("Imagen del cambio guardada.");
      } catch (error) {
        this.setSaveStatus(`No se pudo leer la imagen: ${error.message}`, true);
      }
    }
  }

  removeCue(event) {
    if (this.toggleResourceCueFromEvent(event, "timed")) return;
    const remove = event.target.closest("[data-remove-cue]");
    if (!remove) return;
    const card = remove.closest("[data-cue-id]");
    this.collapsedResourceCueIds.delete(`timed:${card?.dataset.cueId}`);
    this.scene.timedCues = this.scene.timedCues.filter((cue) => cue.id !== card?.dataset.cueId);
    this.renderCueList();
    this.markDirty("Cambio temporizado eliminado.");
  }

  updateLayerInspector() {
    const layer = this.scene?.getLayer(this.selectedLayerId);
    if (!layer) return;
    const readNumber = (input) => {
      const raw = String(input.value ?? "").trim();
      if (!raw) return null;
      const value = Number(raw);
      return Number.isFinite(value) ? value : null;
    };
    const xPct = readNumber(this.dom.layerX);
    const yPct = readNumber(this.dom.layerY);
    const widthPct = readNumber(this.dom.layerWidth);
    if (yPct !== null) layer.yPct = clamp(yPct, LAYER_POSITION_MIN, LAYER_POSITION_MAX);
    if (widthPct !== null) layer.widthPct = clamp(widthPct, LAYER_WIDTH_MIN, LAYER_WIDTH_MAX);
    const asset = this.project.getAsset(layer.assetId);
    if (asset) asset.alt = this.dom.layerAlt.value;

    // No reconstruir el escenario en cada tecla: al haber varias capas esto
    // reemplazaba todas las imágenes mientras se editaba una sola.
    const element = [...(this.dom.stageLayers?.children || [])].find((candidate) => candidate.dataset.layerId === layer.id);
    if (element) {
      element.style.width = `${layer.widthPct}%`;
      const bounds = this.dom.stage.getBoundingClientRect();
      layer.xPct = clamp(xPct ?? layer.xPct, this.getCanvasMinimumCenterXPct(element, bounds), LAYER_POSITION_MAX);
      element.style.left = `${layer.xPct}%`;
      element.style.top = `${layer.yPct}%`;
      setNativeInputValue(this.dom.layerX, layer.xPct);
    } else if (xPct !== null) {
      layer.xPct = clamp(xPct, LAYER_POSITION_MIN, LAYER_POSITION_MAX);
    }
    this.scheduleAutoSave();
  }

  beginDialogueDrag(event) {
    const element = event.target.closest(".dialogue-box");
    const dialogue = this.scene?.getDialogue(element?.dataset.dialogueId);
    if (!element || !dialogue || this.isPreviewing || event.button !== 0 || dialogue.visible === false) return;
    this.clearSelectedChoice();
    event.preventDefault();
    event.stopPropagation();
    this.selectedDialogueId = dialogue.id;
    this.selectedDialogueBySceneId.set(this.activeSceneId, dialogue.id);
    this.dialogueEditorExpanded = true;
    this.selectedLayerId = null;
    this.selectedLayerBySceneId.set(this.activeSceneId, null);
    this.renderInspector();
    this.dom.stage.querySelectorAll(".scene-layer.is-selected").forEach((layer) => layer.classList.remove("is-selected"));
    this.dom.dialogueLayer.querySelectorAll(".dialogue-box").forEach((box) => {
      const isSelected = box === element;
      box.classList.toggle("is-selected", isSelected);
      if (!isSelected) box.querySelectorAll(".dialogue-resize-handle").forEach((handle) => handle.remove());
    });
    Object.entries(RESIZE_CORNERS).forEach(([corner, { label }]) => {
      if (element.querySelector(`[data-dialogue-resize-handle="${corner}"]`)) return;
      const handle = document.createElement("button");
      handle.type = "button";
      handle.className = "resize-handle dialogue-resize-handle";
      handle.dataset.dialogueResizeHandle = corner;
      handle.setAttribute("aria-label", label.replace("imagen", "diálogo"));
      handle.tabIndex = -1;
      element.append(handle);
    });
    this.hydrateDialogueEditors();
    this.dom.dialogueZIndex.disabled = false;
    element.focus({ preventScroll: true });
    const bounds = this.dom.stage.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const placement = dialogue.placement;
    const resizeHandle = event.target.closest("[data-dialogue-resize-handle]");
    const cornerInfo = RESIZE_CORNERS[resizeHandle?.dataset.dialogueResizeHandle];
    if (cornerInfo) {
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      this.dialogueDrag = {
        kind: "resize",
        pointerId: event.pointerId,
        dialogueId: dialogue.id,
        element,
        direction: cornerInfo,
        anchorX: cornerInfo.x > 0 ? rect.left : rect.right,
        anchorY: cornerInfo.y > 0 ? rect.top : rect.bottom,
      };
    } else {
      this.dialogueDrag = {
        kind: "move",
        pointerId: event.pointerId,
        dialogueId: dialogue.id,
        element,
        startPointerXPct: ((event.clientX - bounds.left) / bounds.width) * 100,
        startPointerYPct: ((event.clientY - bounds.top) / bounds.height) * 100,
        startXPct: placement.xPct,
        startYPct: placement.yPct,
      };
    }
    element.classList.add("is-dragging");
    element.setPointerCapture(event.pointerId);
  }

  moveDialogueDrag(event) {
    if (!this.dialogueDrag || event.pointerId !== this.dialogueDrag.pointerId) return;
    if (this.dialogueDrag.kind === "resize") {
      this.resizeDialogueFromCorner(event);
      return;
    }
    const bounds = this.dom.stage.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const pointerXPct = ((event.clientX - bounds.left) / bounds.width) * 100;
    const pointerYPct = ((event.clientY - bounds.top) / bounds.height) * 100;
    const dialogue = this.scene?.getDialogue(this.dialogueDrag.dialogueId);
    const placement = dialogue?.placement;
    if (!placement) return;
    placement.xPct = clamp(
      this.dialogueDrag.startXPct + pointerXPct - this.dialogueDrag.startPointerXPct,
      this.getCanvasMinimumCenterXPct(this.dialogueDrag.element, bounds),
      LAYER_POSITION_MAX,
    );
    placement.yPct = clamp(
      this.dialogueDrag.startYPct + pointerYPct - this.dialogueDrag.startPointerYPct,
      LAYER_POSITION_MIN,
      LAYER_POSITION_MAX,
    );
    const element = this.dialogueDrag.element;
    element.style.left = `${placement.xPct}%`;
    element.style.top = `${placement.yPct}%`;
    this.updateAlignmentGuides(element);
  }

  resizeDialogueFromCorner(event) {
    const bounds = this.dom.stage.getBoundingClientRect();
    const { anchorX, anchorY, direction, dialogueId, element } = this.dialogueDrag;
    if (!bounds.width || !bounds.height) return;

    const minWidthPx = Math.min(24, bounds.width);
    const minHeightPx = Math.min(18, bounds.height);
    let widthPx = clamp(Math.abs(event.clientX - anchorX), minWidthPx, bounds.width);
    const boundaryPx = this.getCanvasLayoutBoundaryPx(bounds);
    if (direction.x < 0 && boundaryPx) widthPx = Math.min(widthPx, Math.max(minWidthPx, anchorX - bounds.left - boundaryPx));
    const heightPx = clamp(Math.abs(event.clientY - anchorY), minHeightPx, bounds.height);
    const left = direction.x > 0 ? anchorX : anchorX - widthPx;
    const top = direction.y > 0 ? anchorY : anchorY - heightPx;
    const placement = this.scene?.getDialogue(dialogueId)?.placement;
    if (!placement) return;

    placement.widthPct = (widthPx / bounds.width) * 100;
    placement.heightPct = (heightPx / bounds.height) * 100;
    placement.xPct = clamp(((left - bounds.left + widthPx / 2) / bounds.width) * 100, this.getCanvasMinimumCenterXPct(element, bounds, widthPx), LAYER_POSITION_MAX);
    placement.yPct = clamp(((top - bounds.top + heightPx / 2) / bounds.height) * 100, LAYER_POSITION_MIN, LAYER_POSITION_MAX);
    element.style.left = `${placement.xPct}%`;
    element.style.top = `${placement.yPct}%`;
    element.style.width = `${placement.widthPct}%`;
    element.style.height = `${placement.heightPct}%`;
    element.classList.add("has-custom-size");
    this.updateAlignmentGuides(element);
  }

  endDialogueDrag(event) {
    if (!this.dialogueDrag || event.pointerId !== this.dialogueDrag.pointerId) return;
    const { dialogueId, element } = this.dialogueDrag;
    this.dialogueDrag = null;
    element.classList.remove("is-dragging");
    if (element.hasPointerCapture?.(event.pointerId)) {
      element.releasePointerCapture(event.pointerId);
    }
    this.hideAlignmentGuides();
    const placement = this.scene?.getDialogue(dialogueId)?.placement;
    if (placement) {
      this.dom.dialogueCenterHorizontal.checked = Math.abs(placement.xPct - 50) < 0.05;
      this.dom.dialogueCenterVertical.checked = Math.abs(placement.yPct - 50) < 0.05;
    }
    this.markDirty();
  }

  clearSelectedQuizBox() {
    this.selectedQuizBox = null;
    this.dom.choicePreview?.querySelectorAll(".quiz-box.is-selected").forEach((box) => {
      box.classList.remove("is-selected", "is-dragging");
      box.querySelectorAll(".quiz-resize-handle").forEach((handle) => handle.remove());
    });
  }

clearSelectedCombatBox() {
this.selectedCombatBoxId = null;
this.dom.choicePreview?.querySelectorAll(".combat-box.is-selected").forEach((box) => {
box.classList.remove("is-selected", "is-dragging");
box.querySelectorAll(".combat-resize-handle").forEach((handle) => handle.remove());
});
}
beginCombatDrag(event) {
const element = event.target.closest(".combat-box[data-combat-box]");
const challenge = this.scene?.combatChallenges?.find((item) => item.id === element?.dataset.combatBox);
if (!element || !challenge || this.isPreviewing || event.button !== 0) return false;
if (event.target.closest("button:not(.combat-resize-handle), input, select, textarea, a")) return false;
event.preventDefault();
event.stopPropagation();
this.clearSelectedChoice();
this.clearSelectedQuizBox();
this.clearSelectedCombatBox();
this.selectedCombatBoxId = challenge.id;
element.classList.add("is-selected");
Object.entries(RESIZE_CORNERS).forEach(([corner, { label }]) => {
if (element.querySelector(`[data-combat-resize-handle="${corner}"]`)) return;
const handle = document.createElement("button");
handle.type = "button";
handle.className = "resize-handle combat-resize-handle";
handle.dataset.combatResizeHandle = corner;
handle.setAttribute("aria-label", label.replace("imagen", "caja de combate"));
handle.tabIndex = -1;
element.append(handle);
});
element.focus({ preventScroll: true });
const bounds = this.dom.choicePreview.getBoundingClientRect();
if (!bounds.width || !bounds.height) return true;
const cornerInfo = RESIZE_CORNERS[event.target.closest("[data-combat-resize-handle]")?.dataset.combatResizeHandle];
if (cornerInfo) {
const rect = element.getBoundingClientRect();
if (!rect.width || !rect.height) return true;
this.combatDrag = { kind: "resize", pointerId: event.pointerId, combatId: challenge.id, element, direction: cornerInfo, anchorX: cornerInfo.x > 0 ? rect.left : rect.right, anchorY: cornerInfo.y > 0 ? rect.top : rect.bottom };
} else {
this.combatDrag = { kind: "move", pointerId: event.pointerId, combatId: challenge.id, element, startPointerXPct: ((event.clientX - bounds.left) / bounds.width) * 100, startPointerYPct: ((event.clientY - bounds.top) / bounds.height) * 100, startXPct: challenge.placement.xPct, startYPct: challenge.placement.yPct };
}
element.classList.add("is-dragging");
element.setPointerCapture(event.pointerId);
return true;
}
moveCombatDrag(event) {
if (!this.combatDrag || event.pointerId !== this.combatDrag.pointerId) return;
const bounds = this.dom.choicePreview.getBoundingClientRect();
if (!bounds.width || !bounds.height) return;
const challenge = this.scene?.combatChallenges?.find((item) => item.id === this.combatDrag.combatId);
if (!challenge) return;
const placement = challenge.placement;
if (this.combatDrag.kind === "resize") {
const { anchorX, anchorY, direction, element } = this.combatDrag;
const minWidthPx = Math.min(120, bounds.width);
const minHeightPx = Math.min(80, bounds.height);
let widthPx = clamp(Math.abs(event.clientX - anchorX), minWidthPx, bounds.width);
const boundaryPx = this.getCanvasLayoutBoundaryPx(bounds);
if (direction.x < 0 && boundaryPx) widthPx = Math.min(widthPx, Math.max(minWidthPx, anchorX - bounds.left - boundaryPx));
const heightPx = clamp(Math.abs(event.clientY - anchorY), minHeightPx, bounds.height);
const left = direction.x > 0 ? anchorX : anchorX - widthPx;
const top = direction.y > 0 ? anchorY : anchorY - heightPx;
placement.widthPct = (widthPx / bounds.width) * 100;
placement.heightPct = (heightPx / bounds.height) * 100;
placement.xPct = clamp(((left - bounds.left + widthPx / 2) / bounds.width) * 100, this.getCanvasMinimumCenterXPct(element, bounds, widthPx), LAYER_POSITION_MAX);
placement.yPct = clamp(((top - bounds.top + heightPx / 2) / bounds.height) * 100, LAYER_POSITION_MIN, LAYER_POSITION_MAX);
element.style.width = `${placement.widthPct}%`;
element.style.height = `${placement.heightPct}%`;
element.classList.add("has-custom-size");
} else {
const pointerXPct = ((event.clientX - bounds.left) / bounds.width) * 100;
const pointerYPct = ((event.clientY - bounds.top) / bounds.height) * 100;
placement.xPct = clamp(this.combatDrag.startXPct + pointerXPct - this.combatDrag.startPointerXPct, this.getCanvasMinimumCenterXPct(this.combatDrag.element, bounds), LAYER_POSITION_MAX);
placement.yPct = clamp(this.combatDrag.startYPct + pointerYPct - this.combatDrag.startPointerYPct, LAYER_POSITION_MIN, LAYER_POSITION_MAX);
}
this.combatDrag.element.style.left = `${placement.xPct}%`;
this.combatDrag.element.style.top = `${placement.yPct}%`;
this.updateAlignmentGuides(this.combatDrag.element);
}
endCombatDrag(event) {
if (!this.combatDrag || event.pointerId !== this.combatDrag.pointerId) return;
const { element } = this.combatDrag;
this.combatDrag = null;
element.classList.remove("is-dragging");
if (element.hasPointerCapture?.(event.pointerId)) element.releasePointerCapture(event.pointerId);
this.hideAlignmentGuides();
this.markDirty();
}
nudgeCombatBox(event) {
if (this.isPreviewing) return;
const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
const vector = directions[event.key];
if (!vector) return;
const element = event.target?.closest?.(".combat-box[data-combat-box]");
const combatId = element?.dataset.combatBox || this.selectedCombatBoxId;
const challenge = this.scene?.combatChallenges?.find((item) => item.id === combatId);
if (!challenge) return;
event.preventDefault();
const target = element || [...this.dom.choicePreview.querySelectorAll(".combat-box[data-combat-box]")].find((candidate) => candidate.dataset.combatBox === combatId);
const step = event.shiftKey ? 2 : 0.35;
const bounds = this.dom.choicePreview.getBoundingClientRect();
challenge.placement.xPct = clamp(challenge.placement.xPct + vector[0] * step, this.getCanvasMinimumCenterXPct(target, bounds), LAYER_POSITION_MAX);
challenge.placement.yPct = clamp(challenge.placement.yPct + vector[1] * step, LAYER_POSITION_MIN, LAYER_POSITION_MAX);
if (target) {
target.style.left = `${challenge.placement.xPct}%`;
target.style.top = `${challenge.placement.yPct}%`;
target.focus({ preventScroll: true });
}
this.markDirty();
}
beginQuizDrag(event) {
    const element = event.target.closest(".quiz-box[data-quiz-box-role]");
    const challenge = this.scene?.quizChallenges?.find((item) => item.id === element?.dataset.quizId);
    if (!element || !challenge || this.isPreviewing || event.button !== 0) return false;
    const role = element.dataset.quizBoxRole;
    const placementKey = role === "question" ? "questionPlacement" : "answerPlacement";
    const placement = challenge[placementKey];
    if (!placement) return false;

    event.preventDefault();
    event.stopPropagation();
    this.clearSelectedChoice();
this.clearSelectedCombatBox();
    this.dom.choicePreview.querySelectorAll(".quiz-box").forEach((box) => {
      const isSelected = box === element;
      box.classList.toggle("is-selected", isSelected);
      if (!isSelected) box.querySelectorAll(".quiz-resize-handle").forEach((handle) => handle.remove());
    });
    this.selectedQuizBox = { quizId: challenge.id, role };
    Object.entries(RESIZE_CORNERS).forEach(([corner, { label }]) => {
      if (element.querySelector(`[data-quiz-resize-handle="${corner}"]`)) return;
      const handle = document.createElement("button");
      handle.type = "button";
      handle.className = "resize-handle quiz-resize-handle";
      handle.dataset.quizResizeHandle = corner;
      handle.setAttribute("aria-label", label.replace("imagen", "caja de Quiz"));
      handle.tabIndex = -1;
      element.append(handle);
    });
    element.focus({ preventScroll: true });
    const bounds = this.dom.choicePreview.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return true;
    const resizeHandle = event.target.closest("[data-quiz-resize-handle]");
    const cornerInfo = RESIZE_CORNERS[resizeHandle?.dataset.quizResizeHandle];
    if (cornerInfo) {
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height) return true;
      this.quizDrag = {
        kind: "resize",
        pointerId: event.pointerId,
        quizId: challenge.id,
        placementKey,
        element,
        direction: cornerInfo,
        anchorX: cornerInfo.x > 0 ? rect.left : rect.right,
        anchorY: cornerInfo.y > 0 ? rect.top : rect.bottom,
      };
    } else {
      this.quizDrag = {
        kind: "move",
        pointerId: event.pointerId,
        quizId: challenge.id,
        placementKey,
        element,
        startPointerXPct: ((event.clientX - bounds.left) / bounds.width) * 100,
        startPointerYPct: ((event.clientY - bounds.top) / bounds.height) * 100,
        startXPct: placement.xPct,
        startYPct: placement.yPct,
      };
    }
    element.classList.add("is-dragging");
    element.setPointerCapture(event.pointerId);
    return true;
  }

  moveQuizDrag(event) {
    if (!this.quizDrag || event.pointerId !== this.quizDrag.pointerId) return;
    if (this.quizDrag.kind === "resize") {
      this.resizeQuizBoxFromCorner(event);
      return;
    }
    const bounds = this.dom.choicePreview.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const pointerXPct = ((event.clientX - bounds.left) / bounds.width) * 100;
    const pointerYPct = ((event.clientY - bounds.top) / bounds.height) * 100;
    const placement = this.scene?.quizChallenges?.find((item) => item.id === this.quizDrag.quizId)?.[this.quizDrag.placementKey];
    if (!placement) return;
    placement.xPct = clamp(
      this.quizDrag.startXPct + pointerXPct - this.quizDrag.startPointerXPct,
      this.getCanvasMinimumCenterXPct(this.quizDrag.element, bounds),
      LAYER_POSITION_MAX,
    );
    placement.yPct = clamp(this.quizDrag.startYPct + pointerYPct - this.quizDrag.startPointerYPct, LAYER_POSITION_MIN, LAYER_POSITION_MAX);
    this.quizDrag.element.style.left = `${placement.xPct}%`;
    this.quizDrag.element.style.top = `${placement.yPct}%`;
    this.updateAlignmentGuides(this.quizDrag.element);
  }

  resizeQuizBoxFromCorner(event) {
    const bounds = this.dom.choicePreview.getBoundingClientRect();
    const { anchorX, anchorY, direction, quizId, placementKey, element } = this.quizDrag;
    if (!bounds.width || !bounds.height) return;
    const minWidthPx = Math.min(24, bounds.width);
    const minHeightPx = Math.min(18, bounds.height);
    let widthPx = clamp(Math.abs(event.clientX - anchorX), minWidthPx, bounds.width);
    const boundaryPx = this.getCanvasLayoutBoundaryPx(bounds);
    if (direction.x < 0 && boundaryPx) widthPx = Math.min(widthPx, Math.max(minWidthPx, anchorX - bounds.left - boundaryPx));
    const heightPx = clamp(Math.abs(event.clientY - anchorY), minHeightPx, bounds.height);
    const left = direction.x > 0 ? anchorX : anchorX - widthPx;
    const top = direction.y > 0 ? anchorY : anchorY - heightPx;
    const placement = this.scene?.quizChallenges?.find((item) => item.id === quizId)?.[placementKey];
    if (!placement) return;
    placement.widthPct = (widthPx / bounds.width) * 100;
    placement.heightPct = (heightPx / bounds.height) * 100;
    placement.xPct = clamp(((left - bounds.left + widthPx / 2) / bounds.width) * 100, this.getCanvasMinimumCenterXPct(element, bounds, widthPx), LAYER_POSITION_MAX);
    placement.yPct = clamp(((top - bounds.top + heightPx / 2) / bounds.height) * 100, LAYER_POSITION_MIN, LAYER_POSITION_MAX);
    element.style.left = `${placement.xPct}%`;
    element.style.top = `${placement.yPct}%`;
    element.style.width = `${placement.widthPct}%`;
    element.style.height = `${placement.heightPct}%`;
    element.classList.add("has-custom-size");
    this.updateAlignmentGuides(element);
  }

  endQuizDrag(event) {
    if (!this.quizDrag || event.pointerId !== this.quizDrag.pointerId) return;
    const { element } = this.quizDrag;
    this.quizDrag = null;
    element.classList.remove("is-dragging");
    if (element.hasPointerCapture?.(event.pointerId)) element.releasePointerCapture(event.pointerId);
    this.hideAlignmentGuides();
    this.markDirty();
  }

  nudgeQuizBox(event) {
    if (this.isPreviewing) return;
    const directions = {
      ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
    };
    const vector = directions[event.key];
    if (!vector) return;
    const element = event.target?.closest?.(".quiz-box[data-quiz-box-role]");
    const selected = element
      ? { quizId: element.dataset.quizId, role: element.dataset.quizBoxRole }
      : this.selectedQuizBox;
    const challenge = this.scene?.quizChallenges?.find((item) => item.id === selected?.quizId);
    const placement = challenge?.[selected?.role === "question" ? "questionPlacement" : "answerPlacement"];
    if (!placement) return;
    event.preventDefault();
    const target = element || [...this.dom.choicePreview.querySelectorAll(".quiz-box[data-quiz-box-role]")]
      .find((candidate) => candidate.dataset.quizId === selected.quizId && candidate.dataset.quizBoxRole === selected.role);
    const step = event.shiftKey ? 2 : 0.35;
    const bounds = this.dom.choicePreview.getBoundingClientRect();
    placement.xPct = clamp(placement.xPct + vector[0] * step, this.getCanvasMinimumCenterXPct(target, bounds), LAYER_POSITION_MAX);
    placement.yPct = clamp(placement.yPct + vector[1] * step, LAYER_POSITION_MIN, LAYER_POSITION_MAX);
    if (target) {
      target.style.left = `${placement.xPct}%`;
      target.style.top = `${placement.yPct}%`;
      target.focus({ preventScroll: true });
    }
    this.markDirty();
  }

beginChoiceDrag(event) {
if (this.beginCombatDrag(event)) return;
    if (this.beginQuizDrag(event)) return;
this.clearSelectedQuizBox();
this.clearSelectedCombatBox();
    const promptElement = event.target.closest(".choice-prompt");
    if (promptElement && this.scene && !this.isPreviewing && event.button === 0) {
      const bounds = this.dom.choicePreview.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      event.preventDefault();
      event.stopPropagation();
      promptElement.focus({ preventScroll: true });
      this.choiceDrag = {
        kind: "prompt",
        pointerId: event.pointerId,
        element: promptElement,
        startPointerXPct: ((event.clientX - bounds.left) / bounds.width) * 100,
        startPointerYPct: ((event.clientY - bounds.top) / bounds.height) * 100,
        startXPct: this.scene.decisions.promptPlacement.xPct,
        startYPct: this.scene.decisions.promptPlacement.yPct,
      };
      promptElement.classList.add("is-dragging");
      promptElement.setPointerCapture(event.pointerId);
      return;
    }
    const element = event.target.closest(".choice-button[data-choice-id]");
    const choice = this.scene?.decisions.choices.find((candidate) => candidate.id === element?.dataset.choiceId);
    if (!element || !choice || this.isPreviewing || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    this.selectedChoiceId = choice.id;
    if (this.store) this.hydrateDecisionBackgroundControls();
    this.dom.choicePreview.querySelectorAll(".choice-button").forEach((button) => {
      const isSelected = button === element;
      button.classList.toggle("is-selected", isSelected);
      if (!isSelected) button.querySelectorAll(".decision-resize-handle").forEach((handle) => handle.remove());
    });
    Object.entries(RESIZE_CORNERS).forEach(([corner, { label }]) => {
      if (element.querySelector(`[data-decision-resize-handle="${corner}"]`)) return;
      const handle = document.createElement("span");
      handle.className = "resize-handle decision-resize-handle";
      handle.dataset.decisionResizeHandle = corner;
      handle.title = label.replace("imagen", "decisión");
      handle.setAttribute("aria-hidden", "true");
      element.append(handle);
    });
    element.focus({ preventScroll: true });
    const bounds = this.dom.choicePreview.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const placement = choice.placement;
    const resizeHandle = event.target.closest("[data-decision-resize-handle]");
    const cornerInfo = RESIZE_CORNERS[resizeHandle?.dataset.decisionResizeHandle];
    if (cornerInfo) {
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      this.choiceDrag = {
        kind: "resize",
        pointerId: event.pointerId,
        choiceId: choice.id,
        element,
        direction: cornerInfo,
        anchorX: cornerInfo.x > 0 ? rect.left : rect.right,
        anchorY: cornerInfo.y > 0 ? rect.top : rect.bottom,
      };
    } else {
      this.choiceDrag = {
        kind: "move",
        pointerId: event.pointerId,
        choiceId: choice.id,
        element,
        startPointerXPct: ((event.clientX - bounds.left) / bounds.width) * 100,
        startPointerYPct: ((event.clientY - bounds.top) / bounds.height) * 100,
        startXPct: placement.xPct,
        startYPct: placement.yPct,
      };
    }
    element.classList.add("is-dragging");
    element.setPointerCapture(event.pointerId);
  }

  moveChoiceDrag(event) {
    if (!this.choiceDrag || event.pointerId !== this.choiceDrag.pointerId) return;
    if (this.choiceDrag.kind === "resize") {
      this.resizeChoiceFromCorner(event);
      return;
    }
    const bounds = this.dom.choicePreview.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const pointerXPct = ((event.clientX - bounds.left) / bounds.width) * 100;
    const pointerYPct = ((event.clientY - bounds.top) / bounds.height) * 100;
    const placement = this.choiceDrag.kind === "prompt"
      ? this.scene?.decisions.promptPlacement
      : this.scene?.decisions.choices.find((choice) => choice.id === this.choiceDrag.choiceId)?.placement;
    if (!placement) return;
    placement.xPct = clamp(
      this.choiceDrag.startXPct + pointerXPct - this.choiceDrag.startPointerXPct,
      this.getCanvasMinimumCenterXPct(this.choiceDrag.element, bounds),
      LAYER_POSITION_MAX,
    );
    placement.yPct = clamp(
      this.choiceDrag.startYPct + pointerYPct - this.choiceDrag.startPointerYPct,
      LAYER_POSITION_MIN,
      LAYER_POSITION_MAX,
    );
    const { element } = this.choiceDrag;
    element.style.left = `${placement.xPct}%`;
    element.style.top = `${placement.yPct}%`;
    this.updateAlignmentGuides(element);
  }

  resizeChoiceFromCorner(event) {
    const bounds = this.dom.choicePreview.getBoundingClientRect();
    const { anchorX, anchorY, direction, choiceId, element } = this.choiceDrag;
    if (!bounds.width || !bounds.height) return;
    const minWidthPx = Math.min(24, bounds.width);
    const minHeightPx = Math.min(18, bounds.height);
    let widthPx = clamp(Math.abs(event.clientX - anchorX), minWidthPx, bounds.width);
    const boundaryPx = this.getCanvasLayoutBoundaryPx(bounds);
    if (direction.x < 0 && boundaryPx) widthPx = Math.min(widthPx, Math.max(minWidthPx, anchorX - bounds.left - boundaryPx));
    const heightPx = clamp(Math.abs(event.clientY - anchorY), minHeightPx, bounds.height);
    const left = direction.x > 0 ? anchorX : anchorX - widthPx;
    const top = direction.y > 0 ? anchorY : anchorY - heightPx;
    const placement = this.scene?.decisions.choices.find((choice) => choice.id === choiceId)?.placement;
    if (!placement) return;
    placement.widthPct = (widthPx / bounds.width) * 100;
    placement.heightPct = (heightPx / bounds.height) * 100;
    placement.xPct = clamp(((left - bounds.left + widthPx / 2) / bounds.width) * 100, this.getCanvasMinimumCenterXPct(element, bounds, widthPx), LAYER_POSITION_MAX);
    placement.yPct = clamp(((top - bounds.top + heightPx / 2) / bounds.height) * 100, LAYER_POSITION_MIN, LAYER_POSITION_MAX);
    element.style.left = `${placement.xPct}%`;
    element.style.top = `${placement.yPct}%`;
    element.style.width = `${placement.widthPct}%`;
    element.style.height = `${placement.heightPct}%`;
    this.updateAlignmentGuides(element);
  }

  endChoiceDrag(event) {
    if (!this.choiceDrag || event.pointerId !== this.choiceDrag.pointerId) return;
    const { element } = this.choiceDrag;
    this.choiceDrag = null;
    element.classList.remove("is-dragging");
    if (element.hasPointerCapture?.(event.pointerId)) element.releasePointerCapture(event.pointerId);
    this.hideAlignmentGuides();
    this.markDirty();
  }

  nudgeChoice(event) {
    const focusedPrompt = event.target?.closest?.(".choice-prompt");
    if (focusedPrompt && !this.isPreviewing) {
      const directions = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      };
      const vector = directions[event.key];
      if (!vector || !this.scene) return;
      event.preventDefault();
      const placement = this.scene.decisions.promptPlacement;
      const step = event.shiftKey ? 2 : 0.35;
      placement.xPct = clamp(placement.xPct + vector[0] * step, this.getCanvasMinimumCenterXPct(focusedPrompt, this.dom.choicePreview.getBoundingClientRect()), LAYER_POSITION_MAX);
      placement.yPct = clamp(placement.yPct + vector[1] * step, LAYER_POSITION_MIN, LAYER_POSITION_MAX);
      focusedPrompt.style.left = `${placement.xPct}%`;
      focusedPrompt.style.top = `${placement.yPct}%`;
      focusedPrompt.focus({ preventScroll: true });
      this.markDirty();
      return;
    }
    const focusedChoiceId = event.target?.closest?.(".choice-button")?.dataset.choiceId;
    const choice = this.scene?.decisions.choices.find((candidate) => candidate.id === (focusedChoiceId || this.selectedChoiceId));
    if (this.isPreviewing || !choice) return;
    const directions = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const vector = directions[event.key];
    if (!vector) return;
    event.preventDefault();
    this.selectedChoiceId = choice.id;
    const placement = choice.placement;
    const step = event.shiftKey ? 2 : 0.35;
    const element = [...this.dom.choicePreview.querySelectorAll(".choice-button")]
      .find((candidate) => candidate.dataset.choiceId === choice.id);
    placement.xPct = clamp(placement.xPct + vector[0] * step, this.getCanvasMinimumCenterXPct(element, this.dom.choicePreview.getBoundingClientRect()), LAYER_POSITION_MAX);
    placement.yPct = clamp(placement.yPct + vector[1] * step, LAYER_POSITION_MIN, LAYER_POSITION_MAX);
    if (element) {
      element.style.left = `${placement.xPct}%`;
      element.style.top = `${placement.yPct}%`;
      element.focus({ preventScroll: true });
    }
    this.markDirty();
    [...this.dom.choicePreview.querySelectorAll(".choice-button")]
      .find((candidate) => candidate.dataset.choiceId === choice.id)?.focus({ preventScroll: true });
  }

  updateAlignmentGuides(movingElement) {
    const stageRect = this.dom.stage.getBoundingClientRect();
    const movingRect = movingElement?.getBoundingClientRect();
    if (!stageRect.width || !stageRect.height || !movingRect) return;
    const others = [
      ...this.dom.stageLayers.querySelectorAll(".scene-layer"),
      ...this.dom.dialogueLayer.querySelectorAll(".dialogue-box"),
      ...(this.dom.choicePreview?.querySelectorAll(".choice-prompt") || []),
      ...(this.dom.choicePreview?.querySelectorAll(".choice-button") || []),
      ...(this.dom.choicePreview?.querySelectorAll(".quiz-box") || []),
      ...(this.dom.choicePreview?.querySelectorAll(".combat-box") || []),
    ].filter((element) => element !== movingElement && !element.hidden);
    const horizontal = new Set();
    const vertical = new Set();
    const tolerance = 5;
    const movingY = [movingRect.top, movingRect.bottom];
    const movingX = [movingRect.left, movingRect.right];
    others.forEach((other) => {
      const rect = other.getBoundingClientRect();
      [rect.top, rect.bottom].forEach((candidate) => {
        movingY.forEach((edge) => {
          if (Math.abs(edge - candidate) <= tolerance) horizontal.add(Math.round(candidate - stageRect.top));
        });
      });
      [rect.left, rect.right].forEach((candidate) => {
        movingX.forEach((edge) => {
          if (Math.abs(edge - candidate) <= tolerance) vertical.add(Math.round(candidate - stageRect.left));
        });
      });
    });
    const fragment = document.createDocumentFragment();
    horizontal.forEach((top) => {
      const line = document.createElement("span");
      line.className = "alignment-guide alignment-guide-horizontal";
      line.style.top = `${top}px`;
      fragment.append(line);
    });
    vertical.forEach((left) => {
      const line = document.createElement("span");
      line.className = "alignment-guide alignment-guide-vertical";
      line.style.left = `${left}px`;
      fragment.append(line);
    });
    this.dom.alignmentGuides.replaceChildren(fragment);
  }

  hideAlignmentGuides() {
    this.dom.alignmentGuides?.replaceChildren();
  }

  beginLayerDrag(event) {
    if (this.isPreviewing) return;
    this.clearSelectedChoice();
    if (event.target.closest(".inventory-toggle, .inventory-panel, .pencil-toggle, .pencil-panel, .map-toggle, .map-panel")) return;
    const resizeHandle = event.target.closest("[data-resize-handle]");
    const element = event.target.closest(".scene-layer");
    if (!element) {
      this.drag = null;
      this.selectedLayerId = null;
      this.selectedDialogueId = null;
      this.selectedDialogueBySceneId.set(this.activeSceneId, null);
      this.hideAlignmentGuides();
      this.hydrateDialogueEditors();
      this.renderInspector();
      this.renderPreview();
      return;
    }
    event.preventDefault();
    this.selectedLayerId = element.dataset.layerId;
    this.selectedLayerBySceneId.set(this.activeSceneId, this.selectedLayerId);
    this.selectedDialogueId = null;
    this.selectedDialogueBySceneId.set(this.activeSceneId, null);
    this.dom.dialogueLayer.querySelectorAll(".dialogue-box").forEach((box) => {
      box.classList.remove("is-selected");
      box.querySelectorAll(".dialogue-resize-handle").forEach((handle) => handle.remove());
    });
    this.dom.dialogueZIndex.disabled = true;
    this.hydrateDialogueEditors();
    this.dom.stage.querySelectorAll(".scene-layer").forEach((layerElement) => {
      layerElement.classList.toggle("is-selected", layerElement.dataset.layerId === this.selectedLayerId);
      if (layerElement.dataset.layerId !== this.selectedLayerId) {
        layerElement.querySelectorAll(".resize-handle").forEach((handle) => handle.remove());
      }
    });
    this.dom.stage.focus({ preventScroll: true });
    if (event.target.closest(".object-action-icon")) {
      this.renderInspector();
      return;
    }
    const corner = resizeHandle?.dataset.resizeHandle;
    const cornerInfo = RESIZE_CORNERS[corner];
    if (cornerInfo) {
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const cornerX = cornerInfo.x > 0 ? rect.right : rect.left;
      const cornerY = cornerInfo.y > 0 ? rect.bottom : rect.top;
      this.drag = {
        kind: "resize",
        pointerId: event.pointerId,
        layerId: this.selectedLayerId,
        direction: cornerInfo,
        anchorX: cornerInfo.x > 0 ? rect.left : rect.right,
        anchorY: cornerInfo.y > 0 ? rect.top : rect.bottom,
        aspectRatio: rect.width / rect.height,
        pointerOffsetX: event.clientX - cornerX,
        pointerOffsetY: event.clientY - cornerY,
      };
    } else {
      this.drag = { kind: "move", pointerId: event.pointerId, layerId: this.selectedLayerId };
    }
    this.dom.stage.setPointerCapture(event.pointerId);
    this.renderInspector();
  }

  moveLayerDrag(event) {
    if (!this.drag || event.pointerId !== this.drag.pointerId) return;
    const layer = this.scene.getLayer(this.drag.layerId);
    if (!layer) return;
    if (this.drag.kind === "resize") {
      this.resizeLayerFromCorner(event, layer);
      return;
    }
    const bounds = this.dom.stage.getBoundingClientRect();
    const element = this.dom.stageLayers.querySelector(`[data-layer-id="${layer.id}"]`);
    layer.xPct = clamp(((event.clientX - bounds.left) / bounds.width) * 100, this.getCanvasMinimumCenterXPct(element, bounds), LAYER_POSITION_MAX);
    layer.yPct = clamp(((event.clientY - bounds.top) / bounds.height) * 100, LAYER_POSITION_MIN, LAYER_POSITION_MAX);
    if (element) {
      element.style.left = `${layer.xPct}%`;
      element.style.top = `${layer.yPct}%`;
      this.updateAlignmentGuides(element);
    }
  }

  resizeLayerFromCorner(event, layer) {
    const bounds = this.dom.stage.getBoundingClientRect();
    const { anchorX, anchorY, aspectRatio, direction, pointerOffsetX, pointerOffsetY } = this.drag;
    if (!bounds.width || !bounds.height || !aspectRatio) return;

    // Compensa el punto exacto donde se pulsó dentro del tirador para evitar
    // que el primer movimiento desplace la esquina y parezca un salto.
    const movingCornerX = event.clientX - pointerOffsetX;
    const movingCornerY = event.clientY - pointerOffsetY;
    const horizontalWidth = (movingCornerX - anchorX) * direction.x;
    const verticalWidth = (movingCornerY - anchorY) * direction.y * aspectRatio;
    let widthPx = Math.max(24, horizontalWidth, verticalWidth);
    const boundaryPx = this.getCanvasLayoutBoundaryPx(bounds);
    if (direction.x < 0 && boundaryPx) widthPx = Math.min(widthPx, Math.max(24, anchorX - bounds.left - boundaryPx));
    const heightPx = widthPx / aspectRatio;
    const left = direction.x > 0 ? anchorX : anchorX - widthPx;
    const top = direction.y > 0 ? anchorY : anchorY - heightPx;

    layer.widthPct = clamp((widthPx / bounds.width) * 100, LAYER_WIDTH_MIN, LAYER_WIDTH_MAX);
    const element = [...(this.dom.stageLayers?.children || [])].find((candidate) => candidate.dataset.layerId === layer.id);
    layer.xPct = clamp(((left - bounds.left + widthPx / 2) / bounds.width) * 100, this.getCanvasMinimumCenterXPct(element, bounds, widthPx), LAYER_POSITION_MAX);
    layer.yPct = clamp(((top - bounds.top + heightPx / 2) / bounds.height) * 100, LAYER_POSITION_MIN, LAYER_POSITION_MAX);

    if (element) {
      element.style.left = `${layer.xPct}%`;
      element.style.top = `${layer.yPct}%`;
      element.style.width = `${layer.widthPct}%`;
      this.updateAlignmentGuides(element);
    }
  }

  endLayerDrag(event) {
    if (!this.drag || event.pointerId !== this.drag.pointerId) return;
    const dragKind = this.drag.kind;
    this.drag = null;
    if (this.dom.stage.hasPointerCapture?.(event.pointerId)) this.dom.stage.releasePointerCapture(event.pointerId);
    this.hideAlignmentGuides();
    this.renderInspector();
    this.markDirty(dragKind === "resize" ? "Tamaño de imagen actualizado." : "Posición de imagen actualizada.");
  }

  nudgeSelectedLayer(event) {
    if (this.isPreviewing || !this.selectedLayerId) return;
    if (event.target?.closest?.(".inventory-toggle, .inventory-panel, .pencil-toggle, .pencil-panel, .map-toggle, .map-panel")) return;
    if (isCanvasDeleteKey(event)) {
      event.preventDefault();
      this.removeSelectedLayer();
      return;
    }
    const directions = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const vector = directions[event.key];
    if (!vector) return;
    event.preventDefault();
    const layer = this.scene.getLayer(this.selectedLayerId);
    if (!layer) return;
    const step = event.shiftKey ? 2 : 0.35;
    const element = [...(this.dom.stageLayers?.children || [])].find((candidate) => candidate.dataset.layerId === layer.id);
    layer.xPct = clamp(layer.xPct + vector[0] * step, this.getCanvasMinimumCenterXPct(element, this.dom.stage.getBoundingClientRect()), LAYER_POSITION_MAX);
    layer.yPct = clamp(layer.yPct + vector[1] * step, LAYER_POSITION_MIN, LAYER_POSITION_MAX);
    this.renderInspector();
    this.markDirty();
  }

  handleSelectedLayerDelete(event) {
    if (!isCanvasDeleteKey(event) || this.isPreviewing || !this.scene) return;

    const target = event.target;
    if (target?.closest?.(".inventory-toggle, .inventory-panel, .pencil-toggle, .pencil-panel, .map-toggle, .map-panel")) return;
    const objectTarget = target?.closest?.(".dialogue-box[data-dialogue-id], .choice-button[data-choice-id], .quiz-box[data-quiz-id], .combat-box[data-combat-box], .scene-layer[data-layer-id]");
    const isTextEditor = target?.closest?.("input, textarea, select, [contenteditable]:not([contenteditable='false'])");
    if (isTextEditor && !objectTarget) return;
    const isCanvasTarget = [this.dom.gamePreview, this.dom.stage, this.dom.dialogueLayer, this.dom.choicePreview, this.dom.assetList]
      .some((container) => container?.contains?.(target))
      || target === document.body
      || target === document.documentElement;
    if (!isCanvasTarget && !objectTarget) return;

    // renderPreview recreates selected elements; the browser may then leave focus on body.
    const selectionTarget = this.dom.gamePreview?.contains(target)
      || target === document.body
      || target === document.documentElement;
    const dialogueId = target?.closest?.(".dialogue-box[data-dialogue-id]")?.dataset.dialogueId
|| (selectionTarget ? this.selectedDialogueId : null);
    const choiceId = target?.closest?.(".choice-button[data-choice-id]")?.dataset.choiceId
|| (selectionTarget ? this.selectedChoiceId : null);
    const quizId = target?.closest?.(".quiz-box[data-quiz-id]")?.dataset.quizId
|| (selectionTarget ? this.selectedQuizBox?.quizId : null);
    const combatId = target?.closest?.(".combat-box[data-combat-box]")?.dataset.combatBox
|| (selectionTarget ? this.selectedCombatBoxId : null);
    const layerId = target?.closest?.(".scene-layer[data-layer-id]")?.dataset.layerId || this.selectedLayerId;
    if (dialogueId && this.scene.getDialogue(dialogueId)) {
      this.selectedDialogueId = dialogueId;
      this.removeDialogue();
    } else if (choiceId && this.scene.decisions.choices.some((choice) => choice.id === choiceId)) {
      const card = [...this.dom.choiceList.querySelectorAll("[data-choice-id]")]
        .find((element) => element.dataset.choiceId === choiceId);
      card?.querySelector("[data-remove-choice]")?.click();
    } else if (quizId && this.scene.quizChallenges.some((quiz) => quiz.id === quizId)) {
      const card = [...this.dom.quizList.querySelectorAll("[data-quiz-id]")]
        .find((element) => element.dataset.quizId === quizId);
      card?.querySelector("[data-remove-quiz]")?.click();
    } else if (combatId && this.scene.combatChallenges.some((combat) => combat.id === combatId)) {
      const card = [...this.dom.combatList.querySelectorAll("[data-combat-id]")]
        .find((element) => element.dataset.combatId === combatId && element.dataset.combatSection === "combat");
      card?.querySelector("[data-remove-combat]")?.click();
    } else if (layerId && this.scene.stage.layers.some((layer) => layer.id === layerId)) {
      this.selectedLayerId = layerId;
      this.removeSelectedLayer();
    } else {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
  }

  handleCanvasObjectDelete(event, kind, id) {
    if (!isCanvasDeleteKey(event) || this.isPreviewing || !this.scene || !id) return;
    let removed = false;
    if (kind === "dialogue" && this.scene.getDialogue(id)) {
      this.selectedDialogueId = id;
      this.selectedDialogueBySceneId?.set(this.activeSceneId, id);
      this.removeDialogue();
      removed = true;
    } else {
      const config = {
        decision: { items: this.dom.choiceList, selector: "[data-choice-id]", key: "choiceId", remove: "[data-remove-choice]" },
        quiz: { items: this.dom.quizList, selector: "[data-quiz-id]", key: "quizId", remove: "[data-remove-quiz]" },
        combat: { items: this.dom.combatList, selector: '[data-combat-id][data-combat-section="combat"]', key: "combatId", remove: "[data-remove-combat]" },
      }[kind];
      const collection = kind === "decision"
        ? this.scene.decisions.choices
        : kind === "quiz" ? this.scene.quizChallenges : this.scene.combatChallenges;
      if (config && collection?.some((item) => item.id === id)) {
        const card = [...(config.items?.querySelectorAll?.(config.selector) || [])]
          .find((item) => item.dataset[config.key] === id);
        const remove = card?.querySelector?.(config.remove);
        if (remove) {
          remove.click();
          removed = true;
        }
      }
    }
    if (!removed) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
  }

  removeSelectedLayer() {
    if (this.isPreviewing || !this.selectedLayerId || !this.scene) return;
    const layers = this.scene.stage.layers;
    const removedIndex = layers.findIndex((layer) => layer.id === this.selectedLayerId);
    if (removedIndex < 0) return;

    const [removedLayer] = layers.splice(removedIndex, 1);
    this.project.removeObjectCompatibilityTargets([removedLayer.id]);
    this.scene.removeSoundLayerAssociations?.([removedLayer.id]);
    this.scene.removeVideoLayerAssociations?.([removedLayer.id]);
    this.scene.timedCues.forEach((cue) => {
      if (cue.targetLayerId === removedLayer.id) cue.targetLayerId = null;
    });
    this.scene.normalizeStackPositions();
    this.selectedLayerId = layers[Math.min(removedIndex, layers.length - 1)]?.id ?? null;
    this.selectedLayerBySceneId.set(this.activeSceneId, this.selectedLayerId);
    this.drag = null;
    this.hideAlignmentGuides();
    this.renderAssets();
    if (typeof this.project.getSoundAssetsForScene === "function") this.renderSoundResources();
    if (typeof this.project.getVideoAssetsForScene === "function") this.renderVideoResources();
    this.renderInspector();
    this.markDirty("Imagen eliminada del escenario.");
    this.announce("Imagen eliminada del escenario. El recurso se conserva en el proyecto.");
  }

  nudgeDialogue(event) {
    const focusedDialogueId = event.target?.closest?.(".dialogue-box")?.dataset.dialogueId;
    const dialogue = this.scene?.getDialogue(focusedDialogueId || this.selectedDialogueId);
    if (this.isPreviewing || !dialogue || !dialogue.visible) return;
    const directions = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const vector = directions[event.key];
    if (!vector) return;
    event.preventDefault();
    const placement = dialogue.placement;
    const step = event.shiftKey ? 2 : 0.35;
    const element = this.getDialogueElement(dialogue.id);
    placement.xPct = clamp(placement.xPct + vector[0] * step, this.getCanvasMinimumCenterXPct(element, this.dom.stage.getBoundingClientRect()), LAYER_POSITION_MAX);
    placement.yPct = clamp(placement.yPct + vector[1] * step, LAYER_POSITION_MIN, LAYER_POSITION_MAX);
    if (element) {
      element.style.left = `${placement.xPct}%`;
      element.style.top = `${placement.yPct}%`;
    }
    this.dom.dialogueCenterHorizontal.checked = this.isDialogueAtHorizontalCenter(placement.xPct, element);
    this.dom.dialogueCenterVertical.checked = Math.abs(placement.yPct - 50) < 0.05;
    this.markDirty();
    this.getDialogueElement(dialogue.id)?.focus({ preventScroll: true });
  }

  togglePreview() {
    if (this.isPreviewing) {
      this.stopPreview();
      return;
    }
    this.player.resetInventory();
    this.player.resetMapDiscovery();
    this.player.resetQuizProgress();
    this.player.resetCharacter();
    this.pendingQuizAnswerId = null;
    this.cancelPendingCombination();
    this.setInventoryMessage("");
    this.isPreviewing = true;
    if (this.dom.playerCharacterName) this.dom.playerCharacterName.value = this.player.character.name || "Jugador";
    this.dom.previewButton.innerHTML = '<span aria-hidden="true">■</span> Detener vista previa';
    this.renderCharacterSetup();
    const setup = this.dom.characterSetupDialog;
    if (setup?.showModal) setup.showModal();
    else setup?.setAttribute("open", "");
    this.renderPreview();
    this.renderInventoryGrid();
    this.renderInspector();
  }

  stopPreview() {
    if (this.dom.characterSetupDialog?.open && this.dom.characterSetupDialog.close) this.dom.characterSetupDialog.close();
    this.toggleCharacterPanel(false);
    this.closeVideoPlayback();
    this.player.dispose();
    this.player.resetInventory();
    this.player.resetCharacter();
    this.player.resetQuizProgress();
    this.pendingQuizAnswerId = null;
    this.cancelPendingCombination();
    this.isPreviewing = false;
    this.setInventoryNotesEnabled(false);
    this.dom.previewButton.innerHTML = '<span aria-hidden="true">▷</span> Probar';
    this.setPlaybackStatus("");
    this.setInventoryMessage("");
    this.renderPreview();
    this.renderInspector();
    this.renderInventoryGrid();
  }

  async saveProject() {
    if (this.autoSaveTimer) window.clearTimeout(this.autoSaveTimer);
    this.autoSaveTimer = null;
    try {
      await ProjectRepository.save(this.project);
      this.setSaveStatus("Guardado automáticamente en este navegador.");
      return true;
    } catch (error) {
      const quotaExceeded = error?.name === "QuotaExceededError" || /quota|espacio/i.test(error?.message || "");
      const message = quotaExceeded
        ? "Se agotó la cuota de almacenamiento del navegador; exporta una copia y libera espacio."
        : `No se pudo guardar automáticamente: ${error?.message || "error de almacenamiento"}`;
      this.setSaveStatus(message, true);
      this.announce("No se pudo guardar automáticamente.");
      return false;
    }
  }

  async requestNewProject() {
    if (!projectHasAuthoredContent(this.project)) {
      await this.createNewProject(false);
      return;
    }
    const dialog = this.dom.newProjectDialog;
    if (typeof dialog?.showModal === "function") {
      dialog.showModal();
      return;
    }
    const save = window.confirm("El proyecto actual contiene trabajo. ¿Quieres guardarlo y descargar una copia editable antes de empezar uno nuevo? Pulsa Cancelar para no continuar.");
    if (save) await this.createNewProject(true);
    else if (window.confirm("¿Descartar el proyecto actual y abrir uno nuevo en blanco?")) await this.createNewProject(false);
  }

  async createNewProject(saveCurrent) {
    let backupFilename = "";
    if (saveCurrent) {
      if (!await this.saveProject()) return;
      backupFilename = `${slugify(this.project.title || "crowther")}.antes-de-nuevo.crowther.json`;
      try {
        await ProjectRepository.download(this.project, backupFilename);
      } catch (error) {
        this.setSaveStatus(`El proyecto sigue guardado, pero no se pudo descargar la copia; no se inició otro: ${error.message}`, true);
        this.announce("No se pudo descargar la copia de seguridad; se mantiene el proyecto abierto.");
        return;
      }
    }

    await this.replaceProject(createBlankProject());
    if (saveCurrent) {
      this.setSaveStatus(`Nuevo proyecto listo. Copia editable descargada: ${backupFilename}`);
      this.announce("Proyecto guardado y nuevo proyecto en blanco creado.");
    } else {
      this.setSaveStatus("Nuevo proyecto en blanco listo; el proyecto anterior se descartó.");
      this.announce("Nuevo proyecto en blanco creado.");
    }
  }

  async exportProject() {
    const filename = `${slugify(this.project.title || this.scene.name)}.escena-viva.json`;
    try {
      await ProjectRepository.download(this.project, filename);
      this.setSaveStatus("Proyecto descargado con todos sus recursos.");
      this.announce("Proyecto exportado como JSON.");
    } catch (error) {
      this.setSaveStatus(`No se pudo exportar el proyecto: ${error.message}`, true);
      this.announce("La exportación del proyecto ha fallado.");
    }
  }

  openWebExportOptions() {
    const dialog = this.dom.webExportDialog;
    if (!dialog) {
      this.exportPlayableProject("single");
      return;
    }
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  }

  handleWebExportChoice(event) {
    const choice = event.target.closest("[data-web-export-mode]");
    if (!choice) return;
    const mode = choice.dataset.webExportMode === "hosting" ? "hosting" : "single";
    const dialog = this.dom.webExportDialog;
    if (dialog?.open && typeof dialog.close === "function") dialog.close();
    else dialog?.removeAttribute("open");
    this.exportPlayableProject(mode);
  }

  async exportPlayableProject(mode = "single") {
    const baseName = slugify(this.project.title || this.scene?.name);
    const isHostingPackage = mode === "hosting";
    const filename = `${baseName}.${isHostingPackage ? "zip" : "html"}`;
    if (this.dom.exportWebButton) this.dom.exportWebButton.disabled = true;
    this.setSaveStatus("Preparando exportación web…");
    try {
      if (isHostingPackage) await ProjectRepository.downloadPlayablePackage(this.project, filename);
      else await ProjectRepository.downloadPlayableWeb(this.project, filename);
      const message = isHostingPackage ? "Paquete para hosting descargado (ZIP)." : "Juego web descargado como HTML único.";
      this.setSaveStatus(message);
      this.announce(message);
    } catch (error) {
      const message = `No se pudo exportar la web: ${error.message}`;
      this.setSaveStatus(message, true);
      this.announce(message);
    } finally {
      if (this.dom.exportWebButton) this.dom.exportWebButton.disabled = false;
    }
  }

  async renderTemplates(selectedId = this.dom.templateSelect?.value || "") {
    const select = this.dom.templateSelect;
    if (!select) return;
    try {
      const templates = await ProjectTemplateRepository.list();
      const selectedTemplateId = templates.some((template) => template.id === selectedId) ? selectedId : "";
      select.replaceChildren();
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = templates.length ? "Selecciona una plantilla" : "No hay plantillas guardadas";
      select.append(placeholder);
      templates.forEach((template) => {
        const option = document.createElement("option");
        option.value = template.id;
        const savedDate = new Date(template.savedAt);
        const dateLabel = Number.isNaN(savedDate.getTime())
          ? ""
          : ` · ${new Intl.DateTimeFormat("es-ES", { dateStyle: "short", timeStyle: "short" }).format(savedDate)}`;
        option.textContent = `${template.name}${dateLabel}`;
        select.append(option);
      });
      select.value = selectedTemplateId;
      this.updateTemplateActions();
      if (this.dom.templateStatus && !templates.length) {
        this.dom.templateStatus.textContent = "Aún no hay plantillas. Guarda el juego actual para poder cargarlo desde aquí.";
      }
    } catch (error) {
      select.replaceChildren();
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "Biblioteca no disponible";
      select.append(option);
      this.updateTemplateActions();
      if (this.dom.templateStatus) this.dom.templateStatus.textContent = `No se pudo abrir la biblioteca: ${error.message}`;
    }
  }

  updateTemplateActions() {
    const hasSelection = Boolean(this.dom.templateSelect?.value);
    [this.dom.templateLoad, this.dom.templateDownload, this.dom.templateDelete].forEach((button) => {
      if (button) button.disabled = !hasSelection;
    });
  }

  async saveTemplate() {
    const name = this.dom.templateName?.value.trim() || "";
    if (!name) {
      if (this.dom.templateStatus) this.dom.templateStatus.textContent = "Escribe un nombre para guardar la plantilla.";
      this.dom.templateName?.focus();
      return;
    }
    try {
      const existingTemplates = await ProjectTemplateRepository.list();
      const matchingTemplate = existingTemplates.find((template) => template.name.localeCompare(name, "es", { sensitivity: "base" }) === 0);
      let templateId = null;
      if (matchingTemplate) {
        const replace = window.confirm(`Ya existe «${matchingTemplate.name}». ¿Quieres actualizar esa plantilla con el juego actual?`);
        if (!replace) return;
        templateId = matchingTemplate.id;
      }
      const template = await ProjectTemplateRepository.save(this.project, name, templateId);
      await this.renderTemplates(template.id);
      if (this.dom.templateStatus) this.dom.templateStatus.textContent = `Plantilla «${template.name}» guardada con el juego completo.`;
      this.announce(`Plantilla ${template.name} guardada.`);
    } catch (error) {
      if (this.dom.templateStatus) this.dom.templateStatus.textContent = `No se pudo guardar la plantilla: ${error.message}`;
    }
  }

  async loadTemplate() {
    const templateId = this.dom.templateSelect?.value;
    if (!templateId) return;
    try {
      const template = await ProjectTemplateRepository.load(templateId);
      if (!template?.project) throw new Error("La plantilla seleccionada ya no existe.");
      if (!window.confirm(`Cargar «${template.name}» reemplazará el proyecto que tienes abierto. ¿Continuar?`)) return;
      const project = Project.fromJSON(template.project);
      this.dom.templateName.value = template.name;
      await this.replaceProject(project);
      await this.renderTemplates(template.id);
      if (this.dom.templateStatus) this.dom.templateStatus.textContent = `Plantilla «${template.name}» cargada.`;
      this.announce(`Plantilla ${template.name} cargada.`);
    } catch (error) {
      if (this.dom.templateStatus) this.dom.templateStatus.textContent = `No se pudo cargar la plantilla: ${error.message}`;
    }
  }

  async deleteTemplate() {
    const templateId = this.dom.templateSelect?.value;
    if (!templateId) return;
    const option = this.dom.templateSelect.selectedOptions[0];
    const templateName = option?.textContent.split(" · ")[0] || "esta plantilla";
    if (!window.confirm(`¿Eliminar «${templateName}» de este navegador?`)) return;
    try {
      await ProjectTemplateRepository.delete(templateId);
      await this.renderTemplates();
      if (this.dom.templateStatus) this.dom.templateStatus.textContent = `Plantilla «${templateName}» eliminada.`;
    } catch (error) {
      if (this.dom.templateStatus) this.dom.templateStatus.textContent = `No se pudo eliminar la plantilla: ${error.message}`;
    }
  }

  async downloadTemplatePackage() {
    const templateId = this.dom.templateSelect?.value;
    if (!templateId) return;
    try {
      const template = await ProjectTemplateRepository.load(templateId);
      if (!template?.project) throw new Error("La plantilla seleccionada ya no existe.");
      const project = Project.fromJSON(template.project);
      const filename = `${slugify(template.name)}-web.zip`;
      await ProjectRepository.downloadPlayablePackage(project, filename);
      if (this.dom.templateStatus) this.dom.templateStatus.textContent = `Paquete web de «${template.name}» descargado con HTML, CSS, JavaScript y recursos.`;
    } catch (error) {
      if (this.dom.templateStatus) this.dom.templateStatus.textContent = `No se pudo generar el paquete web: ${error.message}`;
    }
  }

  async replaceProject(project) {
    this.stopPreview();
    this.store.replace(project);
    this.player = this.createPlayer();
    this.destroyModuleGraph();
    this.expandedQuizIdsBySceneId.clear();
    const workspace = readProjectWorkspace(project, project.startSceneId || project.scenes[0]?.id || null);
    this.activeSceneId = workspace.activeSceneId;
    this.selectedLayerId = this.scene?.stage.layers[0]?.id ?? null;
    this.selectedDialogueId = this.scene?.dialogues[0]?.id ?? null;
    this.openSceneIds = workspace.openSceneIds;
    this.selectedQuizBox = null;
    this.quizDrag = null;
    this.selectedLayerBySceneId = new Map(this.activeSceneId ? [[this.activeSceneId, this.selectedLayerId]] : []);
    this.selectedDialogueBySceneId = new Map(this.activeSceneId ? [[this.activeSceneId, this.selectedDialogueId]] : []);
    this.selectedTreeNodeId = project.getModuleReferenceForScene(this.activeSceneId)?.id ?? "main";
    this.expandedFolderIds = new Set(["main"]);
    this.hydrateEditors();
    this.renderAll();
    await this.saveProject();
  }

  async importProject(event) {
    const [file] = event.target.files || [];
    if (!file) return;
    try {
      const project = await ProjectRepository.importFile(file);
      await this.replaceProject(project);
      this.announce("Proyecto importado correctamente.");
    } catch (error) {
      this.setSaveStatus(`No se pudo importar: ${error.message}`, true);
      this.announce("La importación ha fallado.");
    } finally {
      event.target.value = "";
    }
  }

  markDirty() {
    this.store.notify();
    this.scheduleAutoSave();
  }

  scheduleAutoSave() {
    this.setSaveStatus("Guardando automáticamente…");
    if (this.autoSaveTimer) window.clearTimeout(this.autoSaveTimer);
    this.autoSaveTimer = window.setTimeout(() => this.saveProject(), 500);
  }

  setSaveStatus(message, isError = false) {
    this.dom.saveStatus.textContent = message;
    this.dom.saveStatus.style.color = isError ? "#f18080" : "";
  }

  setPlaybackStatus(message) {
    // Los cambios del escenario se muestran visualmente; no se repiten como avisos textuales.
  }

  announce(message) {
    this.dom.accessibilityStatus.textContent = message;
  }
async addResourceFiles(fileList, addToStage) {
  const files = [...(fileList || [])];
  const imageExtension = /\.(avif|bmp|gif|heic|heif|jpe?g|png|svg|tiff?|webp)$/i;
  const videoExtension = /\.(mp4|m4v|webm|ogv|mov)$/i;
  const images = files.filter((file) => file.type.startsWith("image/") || imageExtension.test(file.name));
  const sounds = files.filter((file) => file.type === "audio/mpeg" || file.type === "audio/mp3" || /\.mp3$/i.test(file.name));
  const videos = files.filter((file) => file.type.startsWith("video/") || videoExtension.test(file.name));
  const acceptedFiles = new Set([...images, ...sounds, ...videos]);
  const ignoredCount = files.filter((file) => !acceptedFiles.has(file)).length;
  if (!acceptedFiles.size) {
    this.setSaveStatus("Elige una imagen, un sonido MP3 o un vídeo compatible.", true);
    return;
  }
  try {
    for (const file of images) {
      const asset = await ImageAsset.fromFile(file);
      this.project.addAsset(asset, this.activeSceneId);
      if (addToStage) this.addLayerForAsset(asset.id);
    }
    for (const file of sounds) {
      const sound = await SoundAsset.fromFile(file);
      this.project.addSoundAsset(sound, this.activeSceneId);
      this.selectedSoundIdsBySceneId.set(this.activeSceneId, sound.id);
    }
    for (const file of videos) {
      const video = await VideoAsset.fromFile(file);
      this.project.addVideoAsset(video, this.activeSceneId);
      this.selectedVideoIdsBySceneId.set(this.activeSceneId, video.id);
    }
    this.dom.assetInput.value = "";
    this.renderAssets();
this.renderQuizEditor();
    this.renderSoundResources();
    this.renderVideoResources();
    this.renderInspector();
    const parts = [];
    if (images.length) parts.push(`${images.length} imagen${images.length === 1 ? " añadida" : "es añadidas"}`);
    if (sounds.length) parts.push(`${sounds.length} sonido${sounds.length === 1 ? " añadido" : "s añadidos"}`);
    if (videos.length) parts.push(`${videos.length} vídeo${videos.length === 1 ? " añadido" : "s añadidos"}`);
    const ignoredMessage = ignoredCount ? ` Se ignoraron ${ignoredCount} archivo${ignoredCount === 1 ? " no compatible" : "s no compatibles"}.` : "";
    this.markDirty(`${parts.join(", ")}.${ignoredMessage}`);
  } catch (error) {
    this.setSaveStatus(`No se pudo leer el recurso: ${error.message}`, true);
  }
}
getSelectedSound() {
const selectedId = this.selectedSoundIdsBySceneId.get(this.activeSceneId)
|| this.scene?.soundCues.find((cue) => cue.soundId)?.soundId
|| this.project.getSoundAssetsForScene(this.activeSceneId)[0]?.id;
return this.project.getSoundAsset(selectedId) || null;
}
renderSoundResources() {
const sounds = this.project.getSoundAssetsForScene(this.activeSceneId);
const list = this.dom.soundCueList;
if (!list) return;
const cues = this.scene?.soundCues || [];
this.dom.addSoundCue.disabled = this.isPreviewing;
const fragment = document.createDocumentFragment();
if (!cues.length) {
const empty = document.createElement("p");
empty.className = "helper-text sound-cue-empty";
empty.textContent = sounds.length
? "Aún no hay sonidos configurados. Pulsa ＋ para añadir una elección."
: "No hay sonidos asignados a esta escena. Pulsa ＋ después de cargar un MP3 en Recursos del explorador.";
fragment.append(empty);
}
cues.forEach((cue, index) => {
const sound = this.project.getSoundAsset(cue.soundId);
const { card, content } = this.createResourceCueCard(
  cue,
  "sound",
  index,
  "removeSoundCue",
  `Quitar sonido ${index + 1} de esta escena`,
);

const soundLabel = document.createElement("label");
soundLabel.className = "sound-resource-field final-type-field";
const soundName = document.createElement("span");
soundName.textContent = "Sonido seleccionado";
const soundSelect = document.createElement("select");
soundSelect.className = "sound-cue-select";
soundSelect.dataset.soundCueField = "soundId";
soundSelect.setAttribute("aria-label", "Sonido seleccionado");
const soundPlaceholder = document.createElement("option");
soundPlaceholder.value = "";
soundPlaceholder.textContent = sounds.length ? "Selecciona un sonido…" : "No hay sonidos en esta escena";
soundSelect.append(soundPlaceholder);
sounds.forEach((item) => {
const option = document.createElement("option");
option.value = item.id;
option.textContent = item.name || "Sonido MP3";
soundSelect.append(option);
});
soundSelect.value = cue.soundId || "";
soundSelect.disabled = this.isPreviewing || !sounds.length;
soundLabel.append(soundName, soundSelect);
content.append(soundLabel);

const imageLabel = document.createElement("label");
imageLabel.className = "sound-resource-field final-type-field";
const imageName = document.createElement("span");
imageName.textContent = "Sonido asociado a imagen";
const imageSelect = document.createElement("select");
imageSelect.className = "sound-cue-select";
imageSelect.dataset.soundCueField = "imageLayerId";
imageSelect.setAttribute("aria-label", "Imagen asociada al sonido");
const noImage = document.createElement("option");
noImage.value = "";
noImage.textContent = "Ninguna · reproducir al entrar";
imageSelect.append(noImage);
(this.scene?.stage.layers || []).forEach((layer) => {
const asset = this.project.getAsset(layer.assetId);
if (!asset) return;
const option = document.createElement("option");
option.value = layer.id;
option.textContent = asset.name || "Imagen";
imageSelect.append(option);
});
imageSelect.value = cue.imageLayerId || "";
imageSelect.disabled = this.isPreviewing || !sound || !this.scene?.stage.layers.length;
imageLabel.append(imageName, imageSelect);
content.append(imageLabel);

const audio = document.createElement("audio");
audio.className = "sound-resource-preview";
audio.controls = true;
audio.preload = "metadata";
audio.hidden = !sound;
audio.dataset.soundCuePreview = cue.id;
audio.setAttribute("aria-label", `Vista previa de ${sound?.name || "sonido"}`);
if (sound) audio.src = sound.dataUrl;
content.append(audio);

const durationLabel = document.createElement("label");
durationLabel.className = "sound-resource-field";
const durationName = document.createElement("span");
durationName.textContent = "Duración de reproducción (segundos)";
const durationInput = document.createElement("input");
durationInput.type = "number";
durationInput.min = "0.1";
durationInput.step = "0.1";
durationInput.inputMode = "decimal";
durationInput.placeholder = "Archivo completo";
durationInput.value = cue.durationSeconds ?? "";
durationInput.dataset.soundCueField = "durationSeconds";
durationInput.disabled = this.isPreviewing || !sound;
durationLabel.append(durationName, durationInput);
content.append(durationLabel);

const volumeLabel = document.createElement("label");
volumeLabel.className = "sound-resource-field";
const volumeName = document.createElement("span");
volumeName.append(document.createTextNode("Nivel de sonido "));
const volumeOutput = document.createElement("output");
volumeOutput.value = `${cue.volumePercent}%`;
volumeName.append(volumeOutput);
const volumeInput = document.createElement("input");
volumeInput.type = "range";
volumeInput.min = "0";
volumeInput.max = "100";
volumeInput.step = "1";
volumeInput.value = String(cue.volumePercent);
volumeInput.dataset.soundCueField = "volumePercent";
volumeInput.disabled = this.isPreviewing || !sound;
volumeInput.addEventListener("input", () => { volumeOutput.value = `${volumeInput.value}%`; });
volumeLabel.append(volumeName, volumeInput);
content.append(volumeLabel);
fragment.append(card);
});
list.replaceChildren(fragment);
}
renderVideoResources() {
  const videos = this.project.getVideoAssetsForScene(this.activeSceneId);
  const list = this.dom.videoCueList;
  if (!list) return;
  const cues = this.scene?.videoCues || [];
  if (this.dom.addVideoCue) this.dom.addVideoCue.disabled = this.isPreviewing;
  const fragment = document.createDocumentFragment();
  if (!cues.length) {
    const empty = document.createElement("p");
    empty.className = "helper-text sound-cue-empty";
    empty.textContent = videos.length
      ? "Aún no hay vídeos configurados. Pulsa ＋ para añadir una elección."
      : "No hay vídeos asignados a esta escena. Carga un vídeo en Recursos del explorador.";
    fragment.append(empty);
  }
  cues.forEach((cue, index) => {
    const video = this.project.getVideoAsset(cue.videoId);
    const { card, content } = this.createResourceCueCard(
      cue,
      "video",
      index,
      "removeVideoCue",
      `Quitar vídeo ${index + 1} de esta escena`,
    );

    const videoLabel = document.createElement("label");
    videoLabel.className = "sound-resource-field final-type-field";
    const videoName = document.createElement("span");
    videoName.textContent = "Vídeo seleccionado";
    const videoSelect = document.createElement("select");
    videoSelect.className = "sound-cue-select";
    videoSelect.dataset.videoCueField = "videoId";
    videoSelect.setAttribute("aria-label", "Vídeo seleccionado");
    const videoPlaceholder = document.createElement("option");
    videoPlaceholder.value = "";
    videoPlaceholder.textContent = videos.length ? "Selecciona un vídeo…" : "No hay vídeos en esta escena";
    videoSelect.append(videoPlaceholder);
    videos.forEach((item) => {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = item.name || "Vídeo";
      videoSelect.append(option);
    });
    videoSelect.value = cue.videoId || "";
    videoSelect.disabled = this.isPreviewing || !videos.length;
    videoLabel.append(videoName, videoSelect);
    content.append(videoLabel);

    const imageLabel = document.createElement("label");
    imageLabel.className = "sound-resource-field final-type-field";
    const imageName = document.createElement("span");
    imageName.textContent = "Vídeo asociado a imagen";
    const imageSelect = document.createElement("select");
    imageSelect.className = "sound-cue-select";
    imageSelect.dataset.videoCueField = "imageLayerId";
    imageSelect.setAttribute("aria-label", "Imagen asociada al vídeo");
    const noImage = document.createElement("option");
    noImage.value = "";
noImage.textContent = "Ninguna · sin icono en imagen";
    imageSelect.append(noImage);
    (this.scene?.stage.layers || []).forEach((layer) => {
      const asset = this.project.getAsset(layer.assetId);
      if (!asset) return;
      const option = document.createElement("option");
      option.value = layer.id;
      option.textContent = asset.name || "Imagen";
      imageSelect.append(option);
    });
    imageSelect.value = cue.imageLayerId || "";
    imageSelect.disabled = this.isPreviewing || !video || !this.scene?.stage.layers.length;
    imageLabel.append(imageName, imageSelect);
    content.append(imageLabel);

    const preview = document.createElement("video");
    preview.className = "sound-resource-preview video-resource-preview";
    preview.controls = true;
    preview.preload = "metadata";
    preview.hidden = !video;
    preview.dataset.videoCuePreview = cue.id;
    preview.setAttribute("aria-label", `Vista previa de ${video?.name || "vídeo"}`);
    if (video) preview.src = video.dataUrl;
    preview.volume = cue.volumePercent / 100;
    content.append(preview);

    const durationLabel = document.createElement("label");
    durationLabel.className = "sound-resource-field";
    const durationName = document.createElement("span");
    durationName.textContent = "Duración de reproducción (segundos)";
    const durationInput = document.createElement("input");
    durationInput.type = "number";
    durationInput.min = "0.1";
    durationInput.step = "0.1";
    durationInput.inputMode = "decimal";
    durationInput.placeholder = "Vídeo completo";
    durationInput.value = cue.durationSeconds ?? "";
    durationInput.dataset.videoCueField = "durationSeconds";
    durationInput.disabled = this.isPreviewing || !video;
    durationLabel.append(durationName, durationInput);
    content.append(durationLabel);

    const volumeLabel = document.createElement("label");
    volumeLabel.className = "sound-resource-field";
    const volumeName = document.createElement("span");
    volumeName.append(document.createTextNode("Nivel de sonido "));
    const volumeOutput = document.createElement("output");
    volumeOutput.value = `${cue.volumePercent}%`;
    volumeName.append(volumeOutput);
    const volumeInput = document.createElement("input");
    volumeInput.type = "range";
    volumeInput.min = "0";
    volumeInput.max = "100";
    volumeInput.step = "1";
    volumeInput.value = String(cue.volumePercent);
    volumeInput.dataset.videoCueField = "volumePercent";
    volumeInput.disabled = this.isPreviewing || !video;
    volumeInput.addEventListener("input", () => { volumeOutput.value = `${volumeInput.value}%`; });
    volumeLabel.append(volumeName, volumeInput);
    content.append(volumeLabel);

    const startLabel = document.createElement("label");
    startLabel.className = "video-autoplay-option";
    const startInput = document.createElement("input");
    startInput.type = "checkbox";
    startInput.checked = Boolean(cue.playOnStart);
    startInput.dataset.videoCueField = "playOnStart";
    startInput.disabled = this.isPreviewing || !video;
    const startText = document.createElement("span");
    startText.textContent = "Ejecutar al iniciar la escena";
    startLabel.append(startInput, startText);
    content.append(startLabel);

    fragment.append(card);
  });
  list.replaceChildren(fragment);
}
addVideoCue() {
  if (!this.scene || this.isPreviewing) return;
  const firstVideoId = this.project.getVideoAssetsForScene(this.activeSceneId)[0]?.id || "";
  this.scene.addVideoCue({ videoId: firstVideoId });
  this.renderVideoResources();
  this.markDirty("Elección de vídeo añadida a la escena.");
}
handleVideoCueChange(event) {
  const control = event.target.closest("[data-video-cue-field]");
  const card = control?.closest("[data-video-cue-id]");
  const cue = this.scene?.videoCues.find((candidate) => candidate.id === card?.dataset.videoCueId);
  if (!cue || this.isPreviewing) return;
  const field = control.dataset.videoCueField;
  if (field === "videoId") {
    const previousVideoId = cue.videoId;
    cue.videoId = control.value || "";
    if (cue.videoId && !this.scene.videoIds.includes(cue.videoId)) this.scene.videoIds.push(cue.videoId);
    if (previousVideoId && previousVideoId !== cue.videoId
      && !this.scene.videoCues.some((candidate) => candidate.videoId === previousVideoId)) {
      this.project.removeVideoAssetFromScene(previousVideoId, this.activeSceneId);
    }
    this.selectedVideoIdsBySceneId.set(this.activeSceneId, cue.videoId || null);
    this.renderVideoResources();
    this.renderAssets();
  } else if (field === "imageLayerId") {
    cue.imageLayerId = control.value || null;
    this.renderPreview();
  } else if (field === "playOnStart") {
    cue.playOnStart = control.checked;
    if (cue.playOnStart) this.scene.videoCues.forEach((other) => {
      if (other.id !== cue.id) other.playOnStart = false;
    });
    this.renderVideoResources();
  }
  this.markDirty("Vídeo de la escena actualizado.");
}
handleVideoCueInput(event) {
  const control = event.target.closest("[data-video-cue-field]");
  const card = control?.closest("[data-video-cue-id]");
  const cue = this.scene?.videoCues.find((candidate) => candidate.id === card?.dataset.videoCueId);
  if (!cue || this.isPreviewing) return;
  if (control.dataset.videoCueField === "durationSeconds") {
    const value = Number(control.value);
    cue.durationSeconds = control.value.trim() && Number.isFinite(value) && value > 0 ? value : null;
  } else if (control.dataset.videoCueField === "volumePercent") {
    cue.volumePercent = Number(control.value);
    const output = control.parentElement.querySelector("output");
    if (output) output.value = `${cue.volumePercent}%`;
    const preview = card.querySelector("video[data-video-cue-preview]");
    if (preview) preview.volume = cue.volumePercent / 100;
  } else return;
  this.markDirty();
}
removeVideoCue(cueId) {
  if (!this.scene || this.isPreviewing) return;
  const cue = this.scene.videoCues.find((candidate) => candidate.id === cueId);
  const videoId = cue?.videoId || "";
  if (!this.scene.removeVideoCue(cueId)) return;
  if (videoId && !this.scene.videoCues.some((candidate) => candidate.videoId === videoId)) {
    this.project.removeVideoAssetFromScene(videoId, this.activeSceneId);
  }
  this.renderAll();
  this.markDirty("Vídeo quitado de la escena.");
}
addSoundCue() {
if (!this.scene || this.isPreviewing) return;
this.scene.addSoundCue();
this.renderSoundResources();
this.markDirty("Elección de sonido añadida a la escena.");
}
handleSoundCueChange(event) {
const control = event.target.closest("[data-sound-cue-field]");
const card = control?.closest("[data-sound-cue-id]");
const cue = this.scene?.soundCues.find((candidate) => candidate.id === card?.dataset.soundCueId);
if (!cue || this.isPreviewing) return;
const field = control.dataset.soundCueField;
if (field === "soundId") {
const previousSoundId = cue.soundId;
cue.soundId = control.value || "";
if (cue.soundId && !this.scene.soundIds.includes(cue.soundId)) this.scene.soundIds.push(cue.soundId);
if (previousSoundId && previousSoundId !== cue.soundId
  && !this.scene.soundCues.some((candidate) => candidate.soundId === previousSoundId)) {
this.project.removeSoundAssetFromScene(previousSoundId, this.activeSceneId);
}
this.selectedSoundIdsBySceneId.set(this.activeSceneId, cue.soundId || null);
this.renderSoundResources();
this.renderAssets();
} else if (field === "imageLayerId") {
cue.imageLayerId = control.value || null;
this.renderPreview();
}
this.markDirty("Sonido de la escena actualizado.");
}
handleSoundCueInput(event) {
const control = event.target.closest("[data-sound-cue-field]");
const card = control?.closest("[data-sound-cue-id]");
const cue = this.scene?.soundCues.find((candidate) => candidate.id === card?.dataset.soundCueId);
if (!cue || this.isPreviewing) return;
if (control.dataset.soundCueField === "durationSeconds") {
const value = Number(control.value);
cue.durationSeconds = control.value.trim() && Number.isFinite(value) && value > 0 ? value : null;
} else if (control.dataset.soundCueField === "volumePercent") {
cue.volumePercent = Number(control.value);
const output = control.parentElement.querySelector("output");
if (output) output.value = `${cue.volumePercent}%`;
const audio = card.querySelector("audio");
if (audio) audio.volume = cue.volumePercent / 100;
} else return;
this.markDirty();
}
removeSoundCue(cueId) {
if (!this.scene || this.isPreviewing) return;
const cue = this.scene.soundCues.find((candidate) => candidate.id === cueId);
const soundId = cue?.soundId || "";
if (!this.scene.removeSoundCue(cueId)) return;
if (soundId && !this.scene.soundCues.some((candidate) => candidate.soundId === soundId)) {
this.project.removeSoundAssetFromScene(soundId, this.activeSceneId);
}
this.renderAll();
this.markDirty("Sonido quitado de la escena.");
}
removeSelectedSound() {
const sound = this.project.getSoundAsset(this.selectedSoundIdsBySceneId.get(this.activeSceneId));
if (!sound || this.isPreviewing) return;
const usedElsewhere = this.project.scenes.some((scene) => (
scene.id !== this.activeSceneId && scene.soundIds.includes(sound.id)
));
const retained = usedElsewhere ? " El recurso seguirá disponible en las demás escenas." : "";
if (!window.confirm(`¿Quitar «${sound.name}» de la escena «${this.scene?.name || "actual"}»?${retained}`)) return;
this.project.removeSoundAssetFromScene(sound.id, this.activeSceneId);
this.selectedSoundIdsBySceneId.delete(this.activeSceneId);
this.renderAssets();
this.renderSoundResources();
this.markDirty(`Sonido «${sound.name}» quitado de la escena.`);
}
}
