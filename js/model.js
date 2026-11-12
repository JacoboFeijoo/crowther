/**
 * Modelos serializables del proyecto. No conocen el DOM: así se pueden guardar
 * como JSON y, más adelante, consumir desde otro reproductor (Ren'Py, web o EPUB).
 */

let idCounter = 0;

export function createId(prefix = "item") {
  if (globalThis.crypto?.randomUUID) {
    return `${prefix}_${globalThis.crypto.randomUUID()}`;
  }

  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter}`;
}

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export const INVENTORY_GRID_PRESETS = Object.freeze([
  { columns: 3, rows: 2 },
  { columns: 4, rows: 2 },
  { columns: 5, rows: 2 },
  { columns: 5, rows: 3 },
  { columns: 6, rows: 3 },
  { columns: 7, rows: 3 },
  { columns: 8, rows: 3 },
  { columns: 8, rows: 4 },
  { columns: 10, rows: 4 },
].map((preset) => Object.freeze(preset)));

export const INVENTORY_HINT_SPACE_PRESETS = Object.freeze([5, 10, 15, 20, 30]);

export const MAP_GRID_MAX_SIZE = 10;
export const MAP_GRID_PRESETS = Object.freeze([2, 3, 4, 5, 6, 7, 8, 9, 10]);

export function normalizeAdventureMap(value = {}) {
  const requestedSize = Number(value?.size);
  const size = MAP_GRID_PRESETS.includes(requestedSize) ? requestedSize : 5;
  const sourceCells = Array.isArray(value?.cells) ? value.cells : [];
  const cellsByPosition = new Map(sourceCells.map((cell, index) => {
    const row = Number(cell?.row) || Math.floor(index / MAP_GRID_MAX_SIZE) + 1;
    const column = Number(cell?.column) || (index % MAP_GRID_MAX_SIZE) + 1;
    return [`${row}:${column}`, cell || {}];
  }));
  const cells = Array.from({ length: MAP_GRID_MAX_SIZE * MAP_GRID_MAX_SIZE }, (_, index) => {
    const row = Math.floor(index / MAP_GRID_MAX_SIZE) + 1;
    const column = (index % MAP_GRID_MAX_SIZE) + 1;
    const source = cellsByPosition.get(`${row}:${column}`) || {};
    const moduleNumber = Number(source.moduleNumber);
    return {
      row,
      column,
      moduleNumber: Number.isSafeInteger(moduleNumber) && moduleNumber > 0 ? moduleNumber : null,
      initiallyUnlocked: Boolean(source.initiallyUnlocked),
    };
  });
  const imageAssetId = String(value?.imageAssetId || "").trim();
  return { size, imageAssetId: imageAssetId || null, cells };
}

export function normalizeInventoryHintCapacity(value) {
  const capacity = Number(value);
  return INVENTORY_HINT_SPACE_PRESETS.includes(capacity) ? capacity : 10;
}

export function normalizeInventoryGrid(value = {}) {
  const columns = Number(value?.columns);
  const rows = Number(value?.rows);
  const preset = INVENTORY_GRID_PRESETS.find((item) => item.columns === columns && item.rows === rows);
  return preset ? { columns: preset.columns, rows: preset.rows } : { columns: 5, rows: 3 };
}

export function normalizeFontFamily(value = "") {
  const family = String(value || "").trim().slice(0, 200);
  return /^[\p{L}\p{N}\s,'"_-]+$/u.test(family) ? family : "";
}

export function normalizeFontSize(value) {
  if (value == null || String(value).trim() === "") return null;
  const size = Number(value);
  return Number.isFinite(size) ? clamp(Math.round(size), 8, 96) : null;
}

function normalizeBoxBackgroundColor(value) {
  const color = String(value || "").trim();
  if (!color) return null;
  return /^(transparent|#[\da-f]{3,8}|(?:rgb|rgba|hsl|hsla)\([\d.%+/ ,\-]+\)|[a-z]{3,24})$/i.test(color)
    ? color
    : null;
}

export function sanitizeRichHtml(html = "") {
  const allowedTags = new Set([
    "A", "B", "BLOCKQUOTE", "BR", "CODE", "DEL", "EM", "H1", "H2", "H3",
    "I", "LI", "MARK", "OL", "P", "PRE", "S", "SPAN", "STRONG", "SUB",
    "SUP", "U", "UL",
  ]);
  const source = new DOMParser().parseFromString(String(html), "text/html");
  const output = document.createElement("div");

  const safeColor = (value) => {
    const color = String(value || "").trim();
    if (!color || /[;{}]|url|var|calc|expression/i.test(color)) return "";
    return /^(#[\da-f]{3,8}|(?:rgb|rgba|hsl|hsla)\([\d.%+/,\s-]+\)|[a-z]{3,24})$/i.test(color)
      ? color
      : "";
  };

  const isSafeLink = (value) => {
    const href = String(value || "").trim();
    if (!href || /[\u0000-\u0020\u007f]/.test(href)) return false;
    if (/^(https?:|mailto:|tel:)/i.test(href)) return true;
    if (href.startsWith("#") || href.startsWith("./") || href.startsWith("../")) return true;
    return href.startsWith("/") && !href.startsWith("//");
  };

  const copyNodes = (from, to) => {
    for (const child of from.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        to.append(document.createTextNode(child.textContent ?? ""));
        continue;
      }

      if (child.nodeType !== Node.ELEMENT_NODE) {
        continue;
      }

      const tagName = child.tagName.toUpperCase();
      if (!allowedTags.has(tagName)) {
        copyNodes(child, to);
        continue;
      }

      const listItems = tagName === "OL" ? [...(child.children || [])].filter((item) => item.tagName?.toUpperCase() === "LI") : [];
      const isBulletList = listItems.length > 0 && listItems.every((item) => item.getAttribute("data-list") === "bullet");
      const cleanTag = isBulletList ? "ul" : tagName.toLowerCase();
      const cleanElement = document.createElement(cleanTag);
      if (tagName === "A") {
        const href = child.getAttribute("href");
        if (isSafeLink(href)) cleanElement.setAttribute("href", href.trim());
      }
      if (tagName === "SPAN") {
        const color = safeColor(child.style?.color);
        const backgroundColor = safeColor(child.style?.backgroundColor);
        if (color) cleanElement.style.color = color;
        if (backgroundColor) cleanElement.style.backgroundColor = backgroundColor;
      }
      copyNodes(child, cleanElement);
      to.append(cleanElement);
    }
  };

  copyNodes(source.body, output);
  return output.innerHTML;
}

export function svgDataUri(svg) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export class RichTextBlock {
  constructor({ html = "", lang = "und", dir = "auto" } = {}) {
    this.html = sanitizeRichHtml(html);
    this.lang = lang || "und";
    this.dir = dir || "auto";
  }

  toJSON() {
    return { html: this.html, lang: this.lang, dir: this.dir };
  }
}

function richTextBlock(value) {
  if (value instanceof RichTextBlock) return value;
  if (typeof value === "string") return new RichTextBlock({ html: value });
  return new RichTextBlock(value || {});
}

export class ImageAsset {
  constructor({ id = createId("asset"), name = "imagen", mimeType = "image/*", dataUrl = "", alt = "", naturalWidth = 0, naturalHeight = 0, attributes = [] } = {}) {
    this.id = id;
    this.name = name;
    this.mimeType = mimeType;
    this.dataUrl = dataUrl;
    this.alt = alt || name;
    this.naturalWidth = Math.max(0, Number(naturalWidth) || 0);
    this.naturalHeight = Math.max(0, Number(naturalHeight) || 0);
    this.attributes = (Array.isArray(attributes) ? attributes : []).map((attribute) => ({
      attributeId: String(attribute?.attributeId || attribute?.id || ""),
      value: Number.isFinite(Number(attribute?.value)) ? Number(attribute.value) : 0,
    })).filter((attribute) => attribute.attributeId);
  }

  static fromFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener("load", () => {
        const asset = new ImageAsset({
          name: file.name,
          mimeType: file.type || "image/*",
          dataUrl: String(reader.result),
          alt: file.name.replace(/\.[^/.]+$/, ""),
        });
        const preview = new Image();
        preview.addEventListener("load", () => {
          asset.naturalWidth = preview.naturalWidth;
          asset.naturalHeight = preview.naturalHeight;
          resolve(asset);
        }, { once: true });
        preview.addEventListener(
          "error",
          () => reject(new Error("El navegador no puede mostrar este formato de imagen. Prueba PNG, JPG, WebP, GIF o SVG.")),
          { once: true },
        );
        preview.src = asset.dataUrl;
      });
      reader.addEventListener("error", () => reject(reader.error));
      reader.readAsDataURL(file);
    });
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      mimeType: this.mimeType,
      dataUrl: this.dataUrl,
      alt: this.alt,
      naturalWidth: this.naturalWidth,
      naturalHeight: this.naturalHeight,
attributes: this.attributes.map((attribute) => ({ ...attribute })),
    };
  }
}

function normalizeObjectAttributeDefinitions(definitions) {
  const ids = new Set();
  const names = new Set();
  return (Array.isArray(definitions) ? definitions : []).reduce((normalized, definition) => {
    const name = String(typeof definition === "string" ? definition : definition?.name || "").trim();
    const nameKey = name.normalize("NFKC").toLocaleLowerCase();
    if (!name || names.has(nameKey)) return normalized;
    let id = String(definition?.id || "").trim();
    if (!id || ids.has(id)) id = createId("object-attribute");
    ids.add(id);
    names.add(nameKey);
    normalized.push({ id, name });
    return normalized;
  }, []);
}

function normalizeCharacterSheet(sheet = {}) {
  const defaults = Array.isArray(sheet?.attributes) ? sheet.attributes : [
    { name: "Vida", initialValue: 10 },
    { name: "Experiencia", initialValue: 0 },
  ];
  const ids = new Set();
  const names = new Set();
  const attributes = defaults.reduce((result, entry) => {
    const name = String(entry?.name || "").trim();
    const normalized = name.normalize("NFKC").toLocaleLowerCase();
    if (!name || names.has(normalized)) return result;
    let id = String(entry?.id || "").trim();
    if (!id || ids.has(id)) id = createId("character-attribute");
    ids.add(id);
    names.add(normalized);
    result.push({
      id,
      name: name.slice(0, 60),
      initialValue: clamp(Number(entry?.initialValue ?? entry?.value) || 0, -100000, 100000),
    });
    return result;
  }, []);
  const allowedEvents = new Set(["module-completed", "combat-won", "quiz-solved"]);
  const progressionRules = (Array.isArray(sheet?.progressionRules) ? sheet.progressionRules : [])
    .filter((rule) => allowedEvents.has(rule?.event))
    .map((rule) => ({
      id: String(rule?.id || createId("progression-rule")),
      event: rule.event,
      pointsPerUnit: clamp(Number(rule?.pointsPerUnit) || 0, -100000, 100000),
    }));
  return {
    attributes,
    distributablePoints: clamp(Math.round(Number(sheet?.distributablePoints) || 0), 0, 100000),
    progressionRules,
  };
}

/** Ficha con atributos editables para un personaje no jugador. */
export class CharacterProfile {
  constructor({ id = createId("character"), name = "Nuevo personaje", attributes = [] } = {}, sheet = {}) {
    this.id = String(id || createId("character"));
    this.name = String(name || "Nuevo personaje").trim().slice(0, 100) || "Nuevo personaje";
    const definitions = normalizeCharacterSheet(sheet).attributes;
    const supplied = new Map((Array.isArray(attributes) ? attributes : []).map((entry) => [String(entry?.attributeId || ""), Number(entry?.value) || 0]));
    this.attributes = definitions.map((definition) => ({
      attributeId: definition.id,
      value: clamp(supplied.has(definition.id) ? supplied.get(definition.id) : definition.initialValue, -100000, 100000),
    }));
  }

  toJSON() {
    return { id: this.id, name: this.name, attributes: this.attributes.map((entry) => ({ ...entry })) };
  }
}

/** Returns an editable combat snapshot derived from an image's object attributes. */
export function combatAttributesFromImage(project, asset) {
if (!asset) return [];
  const definitions = new Map((project?.objectAttributeDefinitions || []).map((entry) => [entry.id, entry.name]));
const byName = new Map();
(Array.isArray(asset.attributes) ? asset.attributes : []).forEach((entry) => {
  const name = String(definitions.get(entry.attributeId) || entry.name || entry.attributeId || "").trim();
  if (!name) return;
  byName.set(name.normalize("NFKC").toLocaleLowerCase(), {
    name,
    enemyValue: clamp(Number(entry.value ?? entry.enemyValue) || 0, -100000, 100000),
  });
});
const linkedLayer = (project?.scenes || []).flatMap((scene) => scene.stage?.layers || [])
  .find((layer) => layer.assetId === asset.id && layer.characterEnabled && layer.characterId);
const profile = (project?.playerCharacters || []).find((character) => character.id === linkedLayer?.characterId);
const characterDefinitions = new Map((project?.characterSheet?.attributes || []).map((attribute) => [attribute.id, attribute.name]));
(profile?.attributes || []).forEach((entry) => {
  const name = String(characterDefinitions.get(entry.attributeId) || "").trim();
  if (!name) return;
  byName.set(name.normalize("NFKC").toLocaleLowerCase(), {
    name,
    enemyValue: clamp(Number(entry.value) || 0, -100000, 100000),
  });
});
return [...byName.values()];
}

const DEFAULT_RESOURCE_SECTION_NAMES = Object.freeze({
  sound: "Sonido",
  video: "Vídeo",
  transitions: "Tiempos y transiciones",
});

function normalizeResourceSectionNames(names = {}) {
  return Object.fromEntries(Object.entries(DEFAULT_RESOURCE_SECTION_NAMES).map(([key, fallback]) => {
    const value = String(names?.[key] || "").trim().slice(0, 80);
    return [key, value || fallback];
  }));
}

export class SoundAsset {
  constructor({ id = createId("sound"), name = "sonido.mp3", mimeType = "audio/mpeg", dataUrl = "", durationSeconds = null, volumePercent = 100 } = {}) {
    this.id = id;
    this.name = name;
    this.mimeType = mimeType || "audio/mpeg";
    this.dataUrl = dataUrl;
    const duration = Number(durationSeconds);
    this.durationSeconds = Number.isFinite(duration) && duration > 0 ? duration : null;
    this.volumePercent = clamp(Number(volumePercent) || 0, 0, 100);
  }

  static fromFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener("load", () => resolve(new SoundAsset({
        name: file.name,
        mimeType: file.type || "audio/mpeg",
        dataUrl: String(reader.result),
      })), { once: true });
      reader.addEventListener("error", () => reject(reader.error || new Error("No se pudo leer el archivo de sonido.")), { once: true });
      reader.readAsDataURL(file);
    });
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      mimeType: this.mimeType,
      dataUrl: this.dataUrl,
      durationSeconds: this.durationSeconds,
      volumePercent: this.volumePercent,
    };
  }
}

export class VideoAsset {
  constructor({ id = createId("video"), name = "video.mp4", mimeType = "video/mp4", dataUrl = "" } = {}) {
    this.id = id;
    this.name = name;
    this.mimeType = mimeType || "video/mp4";
    this.dataUrl = dataUrl;
  }

  static fromFile(file) {
    return new Promise((resolve, reject) => {
      const extension = String(file.name || "").split(".").pop().toLowerCase();
      const mimeByExtension = { mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm", ogv: "video/ogg", mov: "video/quicktime" };
      const reader = new FileReader();
      reader.addEventListener("load", () => resolve(new VideoAsset({
        name: file.name,
        mimeType: file.type || mimeByExtension[extension] || "video/mp4",
        dataUrl: String(reader.result),
      })), { once: true });
      reader.addEventListener("error", () => reject(reader.error || new Error("No se pudo leer el archivo de vídeo.")), { once: true });
      reader.readAsDataURL(file);
    });
  }

  toJSON() {
    return { id: this.id, name: this.name, mimeType: this.mimeType, dataUrl: this.dataUrl };
  }
}

export class SceneSoundCue {
  constructor({ id = createId("sound-cue"), name = "", soundId = "", durationSeconds = null, volumePercent = 100, imageLayerId = null } = {}) {
    this.id = id;
    this.name = String(name || "").trim();
    this.soundId = String(soundId || "");
    const duration = Number(durationSeconds);
    this.durationSeconds = Number.isFinite(duration) && duration > 0 ? duration : null;
    const volume = Number(volumePercent);
    this.volumePercent = Number.isFinite(volume) ? clamp(volume, 0, 100) : 100;
    this.imageLayerId = typeof imageLayerId === "string" && imageLayerId ? imageLayerId : null;
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      soundId: this.soundId,
      durationSeconds: this.durationSeconds,
      volumePercent: this.volumePercent,
      imageLayerId: this.imageLayerId,
    };
  }
}

export class SceneVideoCue {
  constructor({ id = createId("video-cue"), name = "", videoId = "", durationSeconds = null, volumePercent = 100, imageLayerId = null, playOnStart = false } = {}) {
    this.id = id;
    this.name = String(name || "").trim();
    this.videoId = String(videoId || "");
    const duration = Number(durationSeconds);
    this.durationSeconds = Number.isFinite(duration) && duration > 0 ? duration : null;
    const volume = Number(volumePercent);
    this.volumePercent = Number.isFinite(volume) ? clamp(volume, 0, 100) : 100;
    this.imageLayerId = typeof imageLayerId === "string" && imageLayerId ? imageLayerId : null;
    this.playOnStart = Boolean(playOnStart);
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      videoId: this.videoId,
      durationSeconds: this.durationSeconds,
      volumePercent: this.volumePercent,
      imageLayerId: this.imageLayerId,
      playOnStart: this.playOnStart,
    };
  }
}

export class ImageLayer {
constructor({ id = createId("layer"), assetId = "", xPct = 50, yPct = 50, widthPct = 100, zIndex = 1, opacity = 1, inventoryEnabled = false, combinableEnabled = false, unique = false, characterEnabled = false, characterId = null, combinableWithLayerIds = [], combinableWithResourceIds = [], combinationResultAssetId = null, clueEnabled = false, clues = [], mapEnabled = false, mapCellKey = null } = {}) {
    this.id = id;
    this.assetId = assetId;
    const numericOr = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
    this.xPct = clamp(numericOr(xPct, 50), -1000, 1100);
    this.yPct = clamp(numericOr(yPct, 50), -1000, 1100);
    // El alto se deriva de la proporción nativa del recurso, nunca se estira.
    this.widthPct = clamp(numericOr(widthPct, 100), 0.5, 10000);
    this.zIndex = Math.max(1, Math.round(numericOr(zIndex, 1)));
    this.opacity = clamp(numericOr(opacity, 1), 0, 1);
    // Estas marcas pertenecen a la capa colocada, no al recurso compartido.
    this.inventoryEnabled = Boolean(inventoryEnabled);
    this.combinableEnabled = Boolean(combinableEnabled);
    this.unique = Boolean(unique);
    this.characterEnabled = Boolean(characterEnabled);
    this.characterId = String(characterId || "") || null;
    this.combinableWithLayerIds = [...new Set(
      (Array.isArray(combinableWithLayerIds) ? combinableWithLayerIds : [])
        .map(String)
        .filter((layerId) => layerId && layerId !== this.id),
    )];
    this.combinableWithResourceIds = [...new Set(
      (Array.isArray(combinableWithResourceIds) ? combinableWithResourceIds : [])
        .map(String)
        .filter((resourceId) => resourceId && resourceId !== this.assetId),
    )];
    this.combinationResultAssetId = String(combinationResultAssetId || "") || null;
this.clueEnabled = Boolean(clueEnabled);
this.clues = (Array.isArray(clues) ? clues : []).map((clue) => ({
id: String(clue?.id || createId("clue")),
text: String(clue?.text || ""),
}));
this.mapEnabled = Boolean(mapEnabled);
this.mapCellKey = /^\d+:\d+$/.test(String(mapCellKey || "")) ? String(mapCellKey) : null;
  }

  toJSON() {
    return {
      id: this.id,
      assetId: this.assetId,
      xPct: this.xPct,
      yPct: this.yPct,
      widthPct: this.widthPct,
      zIndex: this.zIndex,
      opacity: this.opacity,
      inventoryEnabled: this.inventoryEnabled,
      combinableEnabled: this.combinableEnabled,
      unique: this.unique,
      characterEnabled: this.characterEnabled,
      characterId: this.characterId,
      combinableWithLayerIds: [...this.combinableWithLayerIds],
      combinableWithResourceIds: [...this.combinableWithResourceIds],
      combinationResultAssetId: this.combinationResultAssetId,
clueEnabled: this.clueEnabled,
clues: this.clues.map((clue) => ({ ...clue })),
mapEnabled: this.mapEnabled,
mapCellKey: this.mapCellKey,
    };
  }
}

/** Posición y tamaño persistentes de un cuadro de diálogo dentro de su escena. */
export class DialoguePlacement {
  constructor({ xPct = 50, yPct = 69, widthPct = 88, heightPct = null } = {}) {
    const numericOr = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
    this.xPct = clamp(numericOr(xPct, 50), -1000, 1100);
    this.yPct = clamp(numericOr(yPct, 69), -1000, 1100);
    this.widthPct = clamp(numericOr(widthPct, 88), 1, 100);
    this.heightPct = heightPct == null || !Number.isFinite(Number(heightPct))
      ? null
      : clamp(Number(heightPct), 0.1, 100);
  }

  toJSON() {
    return { xPct: this.xPct, yPct: this.yPct, widthPct: this.widthPct, heightPct: this.heightPct };
  }
}

export class DialogueBlock {
  constructor({ id = createId("dialogue"), name = "", speaker = "", text = {}, visible = true, placement = {}, zIndex = 1, backgroundColor = null } = {}) {
    this.id = id;
    this.name = String(name || "").trim().slice(0, 80);
    this.speaker = speaker;
    this.text = text instanceof RichTextBlock ? text : new RichTextBlock(text);
    this.visible = Boolean(visible);
    this.placement = placement instanceof DialoguePlacement ? placement : new DialoguePlacement(placement);
    this.zIndex = Math.max(1, Math.round(Number.isFinite(Number(zIndex)) ? Number(zIndex) : 2));
    this.backgroundColor = normalizeBoxBackgroundColor(backgroundColor);
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      speaker: this.speaker,
      text: this.text.toJSON(),
      visible: this.visible,
      placement: this.placement.toJSON(),
      zIndex: this.zIndex,
      backgroundColor: this.backgroundColor,
    };
  }
}

function defaultChoicePlacement(index = 0) {
  return new DialoguePlacement({
    xPct: 50,
    yPct: Math.min(94, 74 + index * 8),
    widthPct: 78,
    heightPct: 10,
  });
}

export class Decision {
  constructor({ id = createId("choice"), name = "", label = "Nueva elección", labelText = {}, targetSceneId = null, effects = [], condition = null, placement = null, backgroundColor = null } = {}) {
    this.id = id;
    this.name = String(name || "").trim();
    this.label = label;
    this.labelText = richTextBlock(labelText);
    this.targetSceneId = targetSceneId || null;
    this.effects = effects;
    this.condition = condition;
    this.placement = placement == null
      ? null
      : (placement instanceof DialoguePlacement ? placement : new DialoguePlacement(placement));
    this.backgroundColor = normalizeBoxBackgroundColor(backgroundColor);
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      label: this.label,
      labelText: this.labelText.toJSON(),
      targetSceneId: this.targetSceneId,
      effects: this.effects,
      condition: this.condition,
      placement: this.placement?.toJSON() ?? null,
      backgroundColor: this.backgroundColor,
    };
  }
}

export class DecisionPanel {
  constructor({
    prompt = "¿Qué decides?",
    promptFontSize = 18,
    promptColor = "#f9f4e7",
    promptPlacement = {},
    choices = [],
    visible = true,
    style = {},
  } = {}) {
    this.prompt = prompt;
    this.promptFontSize = clamp(Number(promptFontSize) || 18, 8, 72);
    this.promptColor = String(promptColor || "#f9f4e7");
    this.promptPlacement = promptPlacement instanceof DialoguePlacement
      ? promptPlacement
      : new DialoguePlacement({ xPct: 50, yPct: 62, widthPct: 88, ...promptPlacement });
    this.choices = choices.map((choice, index) => {
      if (choice instanceof Decision) {
        if (!choice.placement) choice.placement = defaultChoicePlacement(index);
        return choice;
      }
      return new Decision({
        ...choice,
        placement: choice?.placement || defaultChoicePlacement(index),
      });
    });
    this.visible = Boolean(visible);
    this.style = {
      backgroundColor: "#15131c",
      textColor: "#f9f4e7",
      accentColor: "#e7ae54",
      borderColor: "#f2d07c",
      customCss: "",
      ...style,
      fontFamily: normalizeFontFamily(style.fontFamily),
      fontSizePx: normalizeFontSize(style.fontSizePx),
    };
  }

  addChoice(choice = {}) {
    const index = this.choices.length;
    const decision = choice instanceof Decision
      ? choice
      : new Decision({
        ...choice,
        placement: choice.placement || defaultChoicePlacement(index),
      });
    if (!decision.placement) decision.placement = defaultChoicePlacement(index);
    this.choices.push(decision);
    return decision;
  }

  removeChoice(choiceId) {
    const index = this.choices.findIndex((choice) => choice.id === choiceId);
    if (index < 0) return false;
    this.choices.splice(index, 1);
    return true;
  }

  toJSON() {
    return {
      prompt: this.prompt,
      promptFontSize: this.promptFontSize,
      promptColor: this.promptColor,
      promptPlacement: this.promptPlacement.toJSON(),
      choices: this.choices.map((choice) => choice.toJSON()),
      visible: this.visible,
      style: { ...this.style },
    };
  }
}

export class QuizChallenge {
  constructor({
    id = createId("quiz"),
    name = "",
    question = {},
    questionPlacement = null,
    answerPlacement = null,
    answerType = "text",
    expectedText = "",
    expectedAssetId = null,
    consumeItem = false,
    outcome = {},
    incorrectOutcome = {},
    maxRetries = 10,
  } = {}) {
    this.id = String(id || createId("quiz"));
    this.name = String(name || "").trim();
    this.question = richTextBlock(question);
    this.questionPlacement = questionPlacement instanceof DialoguePlacement
      ? questionPlacement
      : new DialoguePlacement(questionPlacement || { xPct: 50, yPct: 28, widthPct: 76, heightPct: 20 });
    this.answerPlacement = answerPlacement instanceof DialoguePlacement
      ? answerPlacement
      : new DialoguePlacement(answerPlacement || { xPct: 50, yPct: 70, widthPct: 76, heightPct: 28 });
    this.answerType = ["text", "inventory"].includes(answerType) ? answerType : "text";
    this.expectedText = String(expectedText || "");
    this.expectedAssetId = expectedAssetId ? String(expectedAssetId) : null;
    this.consumeItem = Boolean(consumeItem);
    this.outcome = normalizeQuizOutcome(outcome);
    this.incorrectOutcome = normalizeQuizOutcome(incorrectOutcome);
    this.maxRetries = Math.min(10, Math.max(0, Math.round(Number(maxRetries) || 0)));
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      question: this.question.toJSON(),
      questionPlacement: this.questionPlacement.toJSON(),
      answerPlacement: this.answerPlacement.toJSON(),
      answerType: this.answerType,
      expectedText: this.expectedText,
      expectedAssetId: this.expectedAssetId,
      consumeItem: this.consumeItem,
      outcome: serializeQuizOutcome(this.outcome),
      incorrectOutcome: serializeQuizOutcome(this.incorrectOutcome),
      maxRetries: this.maxRetries,
    };
  }
}

/** Configuración serializable de un combate asociado a una escena. */
export class CombatChallenge {
  constructor({
    id = createId("combat"), name = "", enemyName = "Enemigo", enemyAssetId = null,
    attributes = [{ name: "Fuerza", enemyValue: 0 }],
    comparisonAttribute = "Fuerza", playerBonus = 0, comparisonOperator = ">",
    diceCount = 2, diceSides = 10, maxRounds = 5, enemyMaxHealth = 10,
    damagePerWin = 1, roundAttributeEffects = [], victoryReward = null,
    placement = null, victoryAnimation = "pulse",
    defeatAnimation = "shake", animationDurationMs = 900, victoryCondition = null,
  } = {}) {
    this.id = String(id || createId("combat"));
    this.name = String(name || "").trim();
    this.enemyName = String(enemyName || "Enemigo");
    this.enemyAssetId = String(enemyAssetId || "") || null;
    this.attributes = (Array.isArray(attributes) ? attributes : []).map((attribute) => ({
      name: String(attribute?.name || "Atributo").trim() || "Atributo",
      enemyValue: clamp(Number(attribute?.enemyValue) || 0, -100000, 100000),
    }));
    if (!this.attributes.length) this.attributes.push({ name: "Fuerza", enemyValue: 0 });
    this.comparisonAttribute = String(comparisonAttribute || this.attributes[0].name);
    this.playerBonus = clamp(Number(playerBonus) || 0, -100000, 100000);
    this.comparisonOperator = comparisonOperator === ">=" ? ">=" : ">";
    const fallbackPlayerTerms = [{ source: "playerAttribute", attribute: this.comparisonAttribute, operator: "+" }];
    if (this.playerBonus) fallbackPlayerTerms.push({ source: "number", value: this.playerBonus, operator: "+" });
    const normalizeTerms = (terms, fallback, defaultSource, defaultAttribute) => {
      const acceptedSources = new Set(["playerAttribute", "enemyAttribute", "weaponDamage", "number"]);
      const acceptedOperators = new Set(["+", "-", "*", "/", "="]);
      const values = Array.isArray(terms) ? terms : fallback;
      const normalized = values.map((term, index) => {
        const source = acceptedSources.has(term?.source) ? term.source : defaultSource;
        return {
          source,
          attribute: String(term?.attribute || defaultAttribute || this.comparisonAttribute).trim() || this.comparisonAttribute,
          value: clamp(Number(term?.value) || 0, -100000, 100000),
          operator: index === 0 ? "+" : (acceptedOperators.has(term?.operator) ? term.operator : "+"),
        };
      });
      return normalized.length ? normalized : fallback;
    };
    const rawCondition = victoryCondition && typeof victoryCondition === "object" ? victoryCondition : {};
    this.victoryCondition = {
      playerTerms: normalizeTerms(rawCondition.playerTerms, fallbackPlayerTerms, "playerAttribute", this.comparisonAttribute),
      comparator: ["=", "!=", ">", ">=", "<", "<="].includes(rawCondition.comparator) ? rawCondition.comparator : this.comparisonOperator,
      enemyTerms: normalizeTerms(rawCondition.enemyTerms, [{ source: "enemyAttribute", attribute: this.comparisonAttribute, operator: "+" }], "enemyAttribute", this.comparisonAttribute),
    };
    this.diceCount = clamp(Math.round(Number(diceCount) || 1), 1, 20);
    this.diceSides = clamp(Math.round(Number(diceSides) || 2), 2, 1000);
    this.maxRounds = clamp(Math.round(Number(maxRounds) || 1), 1, 100);
    this.enemyMaxHealth = clamp(Math.round(Number(enemyMaxHealth) || 1), 1, 100000);
    this.damagePerWin = clamp(Math.round(Number(damagePerWin) || 1), 1, 100000);
    this.roundAttributeEffects = (Array.isArray(roundAttributeEffects) ? roundAttributeEffects : []).map((effect) => ({
      attributeId: String(effect?.attributeId || ""),
      onWin: clamp(Number(effect?.onWin) || 0, -100000, 100000),
      onLoss: clamp(Number(effect?.onLoss) || 0, -100000, 100000),
    })).filter((effect) => effect.attributeId);
    const reward = victoryReward && typeof victoryReward === "object" ? victoryReward : {};
    this.victoryReward = {
      type: reward.type === "object" ? "object" : "character",
      attributeId: String(reward.attributeId || ""),
      assetId: String(reward.assetId || "") || null,
      amount: clamp(Number(reward.amount) || 0, -100000, 100000),
    };
    this.placement = placement instanceof DialoguePlacement
      ? placement
      : new DialoguePlacement(placement || { xPct: 50, yPct: 48, widthPct: 90, heightPct: 70 });
    this.victoryAnimation = ["pulse", "shake", "flash"].includes(victoryAnimation) ? victoryAnimation : "pulse";
    this.defeatAnimation = ["pulse", "shake", "flash"].includes(defeatAnimation) ? defeatAnimation : "shake";
    this.animationDurationMs = clamp(Math.round(Number(animationDurationMs) || 900), 150, 10000);
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      enemyName: this.enemyName,
      enemyAssetId: this.enemyAssetId,
      attributes: this.attributes.map((attribute) => ({ ...attribute })),
      comparisonAttribute: this.comparisonAttribute,
      playerBonus: this.playerBonus,
      comparisonOperator: this.comparisonOperator,
      victoryCondition: {
        playerTerms: this.victoryCondition.playerTerms.map((term) => ({ ...term })),
        comparator: this.victoryCondition.comparator,
        enemyTerms: this.victoryCondition.enemyTerms.map((term) => ({ ...term })),
      },
      diceCount: this.diceCount,
      diceSides: this.diceSides,
      maxRounds: this.maxRounds,
      enemyMaxHealth: this.enemyMaxHealth,
      damagePerWin: this.damagePerWin,
      roundAttributeEffects: this.roundAttributeEffects.map((effect) => ({ ...effect })),
      victoryReward: { ...this.victoryReward },
      placement: this.placement.toJSON(),
      victoryAnimation: this.victoryAnimation,
      defeatAnimation: this.defeatAnimation,
      animationDurationMs: this.animationDurationMs,
    };
  }
}

/** Evento de escena con atributos propios y condiciones comparadas con el jugador. */
export class EventChallenge {
  constructor({ id = createId("event"), name = "", description = "", assetId = null, attributeValues = {}, conditions = [] } = {}) {
    this.id = String(id || createId("event"));
    this.name = String(name || "").trim().slice(0, 80);
    this.description = String(description || "").slice(0, 1000);
    this.assetId = String(assetId || "") || null;
    this.attributeValues = Object.fromEntries(Object.entries(attributeValues && typeof attributeValues === "object" ? attributeValues : {})
      .filter(([attributeId]) => String(attributeId || "").trim())
      .map(([attributeId, value]) => [String(attributeId), clamp(Number(value) || 0, -100000, 100000)]));
    this.conditions = (Array.isArray(conditions) ? conditions : []).map((condition) => ({
      id: String(condition?.id || createId("event-condition")),
      playerAttributeId: String(condition?.playerAttributeId || ""),
      comparator: ["=", "!=", ">", ">=", "<", "<="].includes(condition?.comparator) ? condition.comparator : ">=",
      eventAttributeId: String(condition?.eventAttributeId || ""),
      modifier: clamp(Number(condition?.modifier) || 0, -100000, 100000),
    }));
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      assetId: this.assetId,
      attributeValues: { ...this.attributeValues },
      conditions: this.conditions.map((condition) => ({ ...condition })),
    };
  }
}

function normalizeQuizOutcome(outcome = {}) {
  return {
    type: ["dialogue", "animation", "scene", "video"].includes(outcome.type) ? outcome.type : "dialogue",
    text: richTextBlock(outcome.text),
    animationType: ["pulse", "shake", "flash"].includes(outcome.animationType) ? outcome.animationType : "pulse",
    animationDurationMs: clamp(Math.round(Number(outcome.animationDurationMs) || 900), 150, 10000),
    sceneId: outcome.sceneId ? String(outcome.sceneId) : null,
    videoId: outcome.videoId ? String(outcome.videoId) : null,
  };
}

function serializeQuizOutcome(outcome) {
  return {
    type: outcome.type,
    text: outcome.text.toJSON(),
    animationType: outcome.animationType,
    animationDurationMs: outcome.animationDurationMs,
    sceneId: outcome.sceneId,
    videoId: outcome.videoId,
  };
}

export class TimedCue {
  constructor({ id = createId("cue"), name = "", atMs = 3000, targetLayerId = null, assetId = null, speaker = "", text = null, revealChoices = null, transitionType = "cut", transitionDurationMs = 1000 } = {}) {
    this.id = id;
    this.name = String(name || "").trim();
    this.atMs = Math.max(0, Number(atMs) || 0);
    this.targetLayerId = targetLayerId || null;
    this.assetId = assetId || null;
    this.speaker = speaker;
    this.text = text ? (text instanceof RichTextBlock ? text : new RichTextBlock(text)) : null;
    this.revealChoices = typeof revealChoices === "boolean" ? revealChoices : null;
    this.transitionType = ["cut", "fade-black", "crossfade", "fade-white", "slide"].includes(transitionType)
      ? transitionType
      : "cut";
    this.transitionDurationMs = Math.min(120000, Math.max(0, Number(transitionDurationMs) || 0));
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      atMs: this.atMs,
      targetLayerId: this.targetLayerId,
      assetId: this.assetId,
      speaker: this.speaker,
      text: this.text?.toJSON() ?? null,
      revealChoices: this.revealChoices,
      transitionType: this.transitionType,
      transitionDurationMs: this.transitionDurationMs,
    };
  }
}

export class Theme {
  constructor({ variables = {}, customCss = "" } = {}) {
    this.variables = {
      dialogueBg: "#15131c",
      dialogueColor: "#f9f4e7",
      accentColor: "#e7ae54",
      borderColor: "#f2d07c80",
      ...variables,
    };
    this.customCss = customCss;
  }

  toJSON() {
    return { variables: { ...this.variables }, customCss: this.customCss };
  }
}

export class SceneModule {
constructor({ id = createId("scene"), name = "Nueva escena", moduleNumber = null, stage = {}, dialogue = {}, dialogues = null, decisions = {}, quizChallenges = [], combatChallenges = [], eventChallenges = [], timedCues = [], assetIds = [], soundIds = [], soundCues = null, videoIds = [], videoCues = null, notes = {}, isFinal = false, finalType = "", dialogueStyle = {}, canvasStyle = {} } = {}) {
    this.id = id;
    // Los proyectos anteriores llamaban "Módulo N" a las escenas automáticas.
    // Migra únicamente ese literal legado; los nombres personalizados se conservan.
    this.name = String(name ?? "Nueva escena").replace(/^Módulo (\d+)$/i, "Escena $1");
    const parsedModuleNumber = Number(moduleNumber);
    this.moduleNumber = Number.isSafeInteger(parsedModuleNumber) && parsedModuleNumber > 0 ? parsedModuleNumber : null;
    this.isFinal = Boolean(isFinal);
    this.finalType = ["Óptimo", "Bueno", "Regular", "Malo", "Pésimo"].includes(finalType) ? finalType : "";
    const legacySceneTransparentDialogue = String(dialogueStyle.backgroundColor || "").trim().toLowerCase() === "transparent";
    this.dialogueStyle = {
      backgroundColor: "",
      textColor: "",
      accentColor: "",
      borderColor: "",
      customCss: "",
      ...dialogueStyle,
      fontFamily: normalizeFontFamily(dialogueStyle.fontFamily),
      fontSizePx: normalizeFontSize(dialogueStyle.fontSizePx),
    };
    if (legacySceneTransparentDialogue) this.dialogueStyle.backgroundColor = "";
    const backgroundColor = String(canvasStyle.backgroundColor || "#17131b");
    const requestedGapPx = Number(canvasStyle.gapPx);
    this.canvasStyle = {
      backgroundColor: /^#[\da-f]{6}$/i.test(backgroundColor) ? backgroundColor : "#17131b",
      backgroundImageAssetId: typeof canvasStyle.backgroundImageAssetId === "string" && canvasStyle.backgroundImageAssetId.trim()
        ? canvasStyle.backgroundImageAssetId.trim()
        : null,
      exceptGlobalBackground: canvasStyle.exceptGlobalBackground == null
        ? Boolean(canvasStyle.backgroundImageAssetId)
        : Boolean(canvasStyle.exceptGlobalBackground),
      transitionAnimation: ["none", "fade-black", "fade-white", "crossfade", "slide-right"].includes(canvasStyle.transitionAnimation)
        ? canvasStyle.transitionAnimation
        : "none",
      exceptGlobalTransition: canvasStyle.exceptGlobalTransition == null
        ? Boolean(canvasStyle.transitionAnimation && canvasStyle.transitionAnimation !== "none")
        : Boolean(canvasStyle.exceptGlobalTransition),
      columns: clamp(Math.round(Number(canvasStyle.columns) || 1), 1, 4),
      gapPx: clamp(Number.isFinite(requestedGapPx) ? Math.round(requestedGapPx) : 24, 0, 300),
      columnBorders: Array.from({ length: 4 }, (_, index) => Boolean(canvasStyle.columnBorders?.[index])),
    };
    this.notes = richTextBlock(notes);
    this.assetIds = [...new Set((Array.isArray(assetIds) ? assetIds : []).filter(Boolean).map(String))];
    this.soundIds = [...new Set((Array.isArray(soundIds) ? soundIds : []).filter(Boolean).map(String))];
    this._hasExplicitSoundCues = Array.isArray(soundCues);
    this.soundCues = Array.isArray(soundCues)
      ? soundCues.map((cue) => (cue instanceof SceneSoundCue ? cue : new SceneSoundCue(cue)))
      : this.soundIds.map((soundId) => new SceneSoundCue({ soundId }));
    this.videoIds = [...new Set((Array.isArray(videoIds) ? videoIds : []).filter(Boolean).map(String))];
    this._hasExplicitVideoCues = Array.isArray(videoCues);
    this.videoCues = Array.isArray(videoCues)
      ? videoCues.map((cue) => (cue instanceof SceneVideoCue ? cue : new SceneVideoCue(cue)))
      : this.videoIds.map((videoId) => new SceneVideoCue({ videoId }));
    this.stage = {
      width: Number(stage.width) || 1600,
      height: Number(stage.height) || 900,
      layers: (stage.layers || []).map((layer) => (layer instanceof ImageLayer ? layer : new ImageLayer(layer))),
    };
    const sourceDialogues = Array.isArray(dialogues) ? dialogues : [dialogue];
    const highestImagePosition = this.stage.layers.reduce((highest, layer) => Math.max(highest, layer.zIndex || 1), 0);
    this.dialogues = sourceDialogues.map((block, index) => {
      if (block instanceof DialogueBlock) return block;
      const zIndex = block?.zIndex ?? highestImagePosition + index + 1;
      return new DialogueBlock({ ...block, zIndex });
    });
    // Projects created before per-box backgrounds applied transparency scene-wide.
    // Preserve it on the default selected dialogue only during migration.
    if (legacySceneTransparentDialogue && this.dialogues[0] && !this.dialogues[0].backgroundColor) {
      this.dialogues[0].backgroundColor = "transparent";
    }
    this.decisions = decisions instanceof DecisionPanel ? decisions : new DecisionPanel(decisions);
    this.quizChallenges = (Array.isArray(quizChallenges) ? quizChallenges : [])
      .map((challenge) => (challenge instanceof QuizChallenge ? challenge : new QuizChallenge(challenge)));
    this.combatChallenges = (Array.isArray(combatChallenges) ? combatChallenges : [])
      .map((challenge) => (challenge instanceof CombatChallenge ? challenge : new CombatChallenge(challenge)));
    this.eventChallenges = (Array.isArray(eventChallenges) ? eventChallenges : [])
      .map((event) => (event instanceof EventChallenge ? event : new EventChallenge(event)));
    this.timedCues = timedCues.map((cue) => (cue instanceof TimedCue ? cue : new TimedCue(cue)));
    this.normalizeStackPositions();
  }

  addAsset(assetId) {
    const id = String(assetId || "");
    if (id && !this.assetIds.includes(id)) this.assetIds.push(id);
  }

  removeAsset(assetId) {
    const id = String(assetId || "");
    const wasAssigned = this.assetIds.includes(id);
    this.assetIds = this.assetIds.filter((assignedId) => assignedId !== id);
    return wasAssigned;
  }

  addSound(soundId) {
    const id = String(soundId || "");
    if (!id) return;
    if (!this.soundIds.includes(id)) this.soundIds.push(id);
    if (!this.soundCues.some((cue) => cue.soundId === id)) this.addSoundCue({ soundId: id });
  }

  removeSound(soundId) {
    const id = String(soundId || "");
    const wasAssigned = this.soundIds.includes(id);
    this.soundIds = this.soundIds.filter((assignedId) => assignedId !== id);
    this.soundCues = this.soundCues.filter((cue) => cue.soundId !== id);
    return wasAssigned;
  }

  addSoundCue(cue = {}) {
    const soundCue = cue instanceof SceneSoundCue ? cue : new SceneSoundCue(cue);
    this.soundCues.push(soundCue);
    if (soundCue.soundId && !this.soundIds.includes(soundCue.soundId)) this.soundIds.push(soundCue.soundId);
    return soundCue;
  }

  removeSoundCue(cueId) {
    const index = this.soundCues.findIndex((cue) => cue.id === String(cueId || ""));
    if (index < 0) return null;
    const [removed] = this.soundCues.splice(index, 1);
    if (removed.soundId && !this.soundCues.some((cue) => cue.soundId === removed.soundId)) {
      this.soundIds = this.soundIds.filter((soundId) => soundId !== removed.soundId);
    }
    return removed;
  }

  removeSoundLayerAssociations(layerIds) {
    const removedIds = new Set(Array.from(layerIds || [], (layerId) => String(layerId || "")).filter(Boolean));
    this.soundCues.forEach((cue) => {
      if (removedIds.has(cue.imageLayerId)) cue.imageLayerId = null;
    });
  }

  addVideo(videoId) {
    const id = String(videoId || "");
    if (!id) return;
    if (!this.videoIds.includes(id)) this.videoIds.push(id);
    if (!this.videoCues.some((cue) => cue.videoId === id)) this.addVideoCue({ videoId: id });
  }

  removeVideo(videoId) {
    const id = String(videoId || "");
    const wasAssigned = this.videoIds.includes(id);
    this.videoIds = this.videoIds.filter((assignedId) => assignedId !== id);
    this.videoCues = this.videoCues.filter((cue) => cue.videoId !== id);
    return wasAssigned;
  }

  addVideoCue(cue = {}) {
    const videoCue = cue instanceof SceneVideoCue ? cue : new SceneVideoCue(cue);
    this.videoCues.push(videoCue);
    if (videoCue.videoId && !this.videoIds.includes(videoCue.videoId)) this.videoIds.push(videoCue.videoId);
    return videoCue;
  }

  removeVideoCue(cueId) {
    const index = this.videoCues.findIndex((cue) => cue.id === String(cueId || ""));
    if (index < 0) return null;
    const [removed] = this.videoCues.splice(index, 1);
    if (removed.videoId && !this.videoCues.some((cue) => cue.videoId === removed.videoId)) {
      this.videoIds = this.videoIds.filter((videoId) => videoId !== removed.videoId);
    }
    return removed;
  }

  removeVideoLayerAssociations(layerIds) {
    const removedIds = new Set(Array.from(layerIds || [], (layerId) => String(layerId || "")).filter(Boolean));
    this.videoCues.forEach((cue) => {
      if (removedIds.has(cue.imageLayerId)) cue.imageLayerId = null;
    });
  }

  getLayer(id) {
    return this.stage.layers.find((layer) => layer.id === id) || null;
  }

  get dialogue() {
    return this.dialogues[0];
  }

  set dialogue(value) {
    const block = value instanceof DialogueBlock ? value : new DialogueBlock(value);
    if (this.dialogues?.length) this.dialogues[0] = block;
    else this.dialogues = [block];
  }

  getDialogue(id) {
    return this.dialogues.find((block) => block.id === id) || null;
  }

  normalizeStackPositions() {
    const stack = [
      ...this.stage.layers,
      ...this.dialogues,
    ].sort((first, second) => (first.zIndex || 1) - (second.zIndex || 1));
    stack.forEach((item, index) => { item.zIndex = index + 1; });
    return stack;
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      moduleNumber: this.moduleNumber,
      isFinal: this.isFinal,
      finalType: this.finalType,
      dialogueStyle: { ...this.dialogueStyle },
      canvasStyle: { ...this.canvasStyle, columnBorders: [...this.canvasStyle.columnBorders] },
      stage: { width: this.stage.width, height: this.stage.height, layers: this.stage.layers.map((layer) => layer.toJSON()) },
      dialogue: this.dialogue?.toJSON() ?? null,
      dialogues: this.dialogues.map((block) => block.toJSON()),
      decisions: this.decisions.toJSON(),
      quizChallenges: this.quizChallenges.map((challenge) => challenge.toJSON()),
      combatChallenges: this.combatChallenges.map((challenge) => challenge.toJSON()),
      eventChallenges: this.eventChallenges.map((event) => event.toJSON()),
      timedCues: this.timedCues.map((cue) => cue.toJSON()),
      assetIds: [...this.assetIds],
      soundIds: [...this.soundIds],
      soundCues: this.soundCues.map((cue) => cue.toJSON()),
      videoIds: [...this.videoIds],
      videoCues: this.videoCues.map((cue) => cue.toJSON()),
      notes: this.notes.toJSON(),
    };
  }
}

/** Carpeta lógica del explorador. No representa una carpeta del disco. */
export class ModuleFolder {
  constructor({ id = createId("folder"), type = "folder", name = "Nueva carpeta", children = [], startSceneId = null } = {}) {
    this.id = id || createId("folder");
    this.type = type === "main" ? "main" : "folder";
    this.name = String(name || (this.type === "main" ? "main" : "Nueva carpeta"));
    if (this.type === "main") this.startSceneId = startSceneId || null;
    this.children = Array.isArray(children)
      ? children.map((child) => moduleTreeNodeFromJSON(child)).filter(Boolean)
      : [];
  }

  toJSON() {
    const json = {
      id: this.id,
      type: this.type,
      name: this.name,
      children: this.children.map((child) => child.toJSON()),
    };
    if (this.type === "main") json.startSceneId = this.startSceneId || null;
    return json;
  }
}

/** Referencia del árbol a una escena: la escena solo se almacena una vez en `scenes`. */
export class ModuleReference {
  constructor({ id = createId("module"), type = "scene", sceneId = "", children = [] } = {}) {
    this.id = id || createId("module");
    this.type = "scene";
    this.sceneId = sceneId || "";
    this.children = Array.isArray(children)
      ? children.map((child) => moduleTreeNodeFromJSON(child)).filter(Boolean)
      : [];
  }

  toJSON() {
    return { id: this.id, type: this.type, sceneId: this.sceneId, children: this.children.map((child) => child.toJSON()) };
  }
}

function moduleTreeNodeFromJSON(raw) {
  if (!raw) return null;
  if (raw instanceof ModuleFolder || raw instanceof ModuleReference) return raw;
  return raw.type === "scene" ? new ModuleReference(raw) : new ModuleFolder(raw);
}

export class Project {
constructor({ version = 1, id = createId("project"), title = "Mi ficción interactiva", startSceneId = null, scenes = [], assets = [], soundAssets = [], videoAssets = [], characters = [], playerCharacters = [], characterSheet = null, playerCharacterSheet = null, theme = {}, main = null, moduleTree = null, notes = {}, inventoryGrid = null, inventoryHintCapacity = 10, adventureMap = null, canvasBackgroundAllModules = false, canvasBackgroundImageAssetId = null, sceneTransitionAnimation = "none", objectAttributeDefinitions = [], resourceSectionNames = {} } = {}) {
    const sourceVersion = Number(version) || 1;
    const sourceScenes = Array.isArray(scenes) ? scenes : [];
    this.version = 33;
    this.id = id;
    this.title = title;
    this.notes = richTextBlock(notes);
this.inventoryGrid = normalizeInventoryGrid(inventoryGrid);
this.inventoryHintCapacity = normalizeInventoryHintCapacity(inventoryHintCapacity);
    this.scenes = sourceScenes.map((scene) => (scene instanceof SceneModule ? scene : new SceneModule(scene)));
    this.ensureModuleNumbers();
this.characters = [];
[...(Array.isArray(characters) ? characters : []), ...this.scenes.flatMap((scene) => [...scene.dialogues.map((dialogue) => dialogue.speaker), ...scene.timedCues.map((cue) => cue.speaker)])]
.forEach((speaker) => this.addCharacter(speaker));
    this.characterSheet = normalizeCharacterSheet(characterSheet || playerCharacterSheet || {});
    this.playerCharacters = (Array.isArray(playerCharacters) ? playerCharacters : [])
      .map((character) => new CharacterProfile(character, this.characterSheet));
    this.startSceneId = startSceneId || main?.startSceneId || moduleTree?.startSceneId || this.scenes[0]?.id || null;
this.objectAttributeDefinitions = normalizeObjectAttributeDefinitions(objectAttributeDefinitions);
this.resourceSectionNames = normalizeResourceSectionNames(resourceSectionNames);
this.assets = assets.map((asset) => (asset instanceof ImageAsset ? asset : new ImageAsset(asset)));
this.ensureObjectAttributeIntegrity();
this.canvasBackgroundAllModules = Boolean(canvasBackgroundAllModules);
this.canvasBackgroundImageAssetId = typeof canvasBackgroundImageAssetId === "string" && canvasBackgroundImageAssetId.trim()
  ? canvasBackgroundImageAssetId.trim()
  : null;
if (!this.assets.some((asset) => asset.id === this.canvasBackgroundImageAssetId)) this.canvasBackgroundImageAssetId = null;
this.sceneTransitionAnimation = ["none", "fade-black", "fade-white", "crossfade", "slide-right"].includes(sceneTransitionAnimation)
  ? sceneTransitionAnimation
  : "none";
this.scenes.forEach((scene, index) => {
  const rawStyle = sourceScenes[index]?.canvasStyle || {};
  const hasExplicitBackgroundException = Object.prototype.hasOwnProperty.call(rawStyle, "exceptGlobalBackground");
  if (hasExplicitBackgroundException) return;
  if (this.canvasBackgroundAllModules) {
    // Conserva el comportamiento de proyectos anteriores, que copiaban el fondo general a cada escena.
    scene.canvasStyle.backgroundImageAssetId = this.canvasBackgroundImageAssetId;
    scene.canvasStyle.exceptGlobalBackground = false;
  } else if (scene.canvasStyle.backgroundImageAssetId) {
    // Los fondos locales anteriores a la excepción explícita se mantienen como excepciones.
    scene.canvasStyle.exceptGlobalBackground = true;
  }
});
    this.soundAssets = soundAssets.map((asset) => (asset instanceof SoundAsset ? asset : new SoundAsset(asset)));
    this.videoAssets = videoAssets.map((asset) => (asset instanceof VideoAsset ? asset : new VideoAsset(asset)));
    this.adventureMap = normalizeAdventureMap(adventureMap);
    if (!this.assets.some((asset) => asset.id === this.adventureMap.imageAssetId)) this.adventureMap.imageAssetId = null;
    this.theme = theme instanceof Theme ? theme : new Theme(theme);
    this.ensureSceneAssetIntegrity(sourceVersion, sourceScenes);
    this.ensureSceneSoundIntegrity(sourceScenes);
    this.ensureSceneVideoIntegrity();
    this.ensureQuizIntegrity();
    this.main = main instanceof ModuleFolder
      ? main
      : new ModuleFolder(main || moduleTree || { id: "main", type: "main", name: "main" });
    this.main.id = "main";
    this.main.type = "main";
    this.main.name = "main";
    this.ensureModuleTreeIntegrity();
    this.ensureObjectCompatibilityIntegrity();
    this.ensureCharacterIntegrity();
  }

  getScene(id) {
    return this.scenes.find((scene) => scene.id === id) || null;
  }

  getSceneByModuleNumber(moduleNumber) {
    const number = Number(moduleNumber);
    return Number.isSafeInteger(number) && number > 0
      ? this.scenes.find((scene) => scene.moduleNumber === number) || null
      : null;
  }

  ensureModuleNumbers() {
    const reserved = new Set(this.scenes
      .map((scene) => Number(scene.moduleNumber))
      .filter((number) => Number.isSafeInteger(number) && number > 0));
    const assigned = new Set();
    let nextNumber = 1;
    this.scenes.forEach((scene) => {
      const number = Number(scene.moduleNumber);
      if (Number.isSafeInteger(number) && number > 0 && !assigned.has(number)) {
        assigned.add(number);
        return;
      }
      while (reserved.has(nextNumber) || assigned.has(nextNumber)) nextNumber += 1;
      scene.moduleNumber = nextNumber;
      reserved.add(nextNumber);
      assigned.add(nextNumber);
      nextNumber += 1;
    });
  }

  getAsset(id) {
    return this.assets.find((asset) => asset.id === id) || null;
  }

  getSoundAsset(id) {
    return this.soundAssets.find((asset) => asset.id === id) || null;
  }

  getVideoAsset(id) {
    return this.videoAssets.find((asset) => asset.id === id) || null;
  }
addCharacter(value) {
const speaker = String(value ?? "").trim();
if (!speaker) return null;
const existing = this.characters.find((character) => character.toLocaleLowerCase() === speaker.toLocaleLowerCase());
if (existing) return existing;
this.characters.push(speaker);
return speaker;
}
addObjectAttribute(value) {
const name = String(value || "").trim();
if (!name) return null;
const normalizedName = name.normalize("NFKC").toLocaleLowerCase();
const existing = this.objectAttributeDefinitions.find((attribute) => attribute.name.normalize("NFKC").toLocaleLowerCase() === normalizedName);
if (existing) return existing;
const attribute = { id: createId("object-attribute"), name };
this.objectAttributeDefinitions.push(attribute);
return attribute;
}

addCharacterAttribute(value, initialValue = 0) {
  const name = String(value || "").trim();
  if (!name) return null;
  const normalizedName = name.normalize("NFKC").toLocaleLowerCase();
  const existing = this.characterSheet.attributes.find((attribute) => attribute.name.normalize("NFKC").toLocaleLowerCase() === normalizedName);
  if (existing) return existing;
  const attribute = { id: createId("character-attribute"), name: name.slice(0, 60), initialValue: clamp(Number(initialValue) || 0, -100000, 100000) };
  this.characterSheet.attributes.push(attribute);
  this.playerCharacters.forEach((character) => character.attributes.push({ attributeId: attribute.id, value: attribute.initialValue }));
  return attribute;
}

renameCharacterAttribute(attributeId, value) {
  const attribute = this.characterSheet.attributes.find((candidate) => candidate.id === String(attributeId || ""));
  const name = String(value || "").trim();
  if (!attribute || !name) return false;
  const normalizedName = name.normalize("NFKC").toLocaleLowerCase();
  if (this.characterSheet.attributes.some((candidate) => candidate.id !== attribute.id
    && candidate.name.normalize("NFKC").toLocaleLowerCase() === normalizedName)) return false;
  attribute.name = name.slice(0, 60);
  return true;
}

removeCharacterAttribute(attributeId) {
  const id = String(attributeId || "");
  const index = this.characterSheet.attributes.findIndex((attribute) => attribute.id === id);
  if (index < 0) return null;
  const [removed] = this.characterSheet.attributes.splice(index, 1);
  this.playerCharacters.forEach((character) => {
    character.attributes = character.attributes.filter((entry) => entry.attributeId !== id);
  });
  this.scenes.forEach((scene) => scene.combatChallenges.forEach((challenge) => {
    challenge.roundAttributeEffects = challenge.roundAttributeEffects.filter((effect) => effect.attributeId !== id);
    if (challenge.victoryReward.type === "character" && challenge.victoryReward.attributeId === id) challenge.victoryReward.attributeId = "";
  }));
  return removed;
}

addPlayerCharacter(name = "Nuevo personaje") {
  const profile = new CharacterProfile({ name }, this.characterSheet);
  this.playerCharacters.push(profile);
  return profile;
}

removePlayerCharacter(characterId) {
  const id = String(characterId || "");
  const index = this.playerCharacters.findIndex((character) => character.id === id);
  if (index < 0) return null;
  const [removed] = this.playerCharacters.splice(index, 1);
  this.scenes.forEach((scene) => scene.stage.layers.forEach((layer) => {
    if (layer.characterId === id) {
      layer.characterId = null;
      layer.characterEnabled = false;
    }
  }));
  return removed;
}

ensureCharacterIntegrity() {
  this.characterSheet = normalizeCharacterSheet(this.characterSheet);
  this.playerCharacters = (Array.isArray(this.playerCharacters) ? this.playerCharacters : [])
    .map((character) => new CharacterProfile(character, this.characterSheet));
  const validIds = new Set(this.playerCharacters.map((character) => character.id));
  this.scenes.forEach((scene) => scene.stage.layers.forEach((layer) => {
    if (!layer.characterEnabled || !validIds.has(layer.characterId)) {
      layer.characterEnabled = false;
      layer.characterId = null;
    }
  }));
}
renameObjectAttribute(attributeId, value) {
const attribute = this.objectAttributeDefinitions.find((candidate) => candidate.id === String(attributeId || ""));
const name = String(value || "").trim();
if (!attribute || !name) return false;
const normalizedName = name.normalize("NFKC").toLocaleLowerCase();
if (this.objectAttributeDefinitions.some((candidate) => candidate.id !== attribute.id
&& candidate.name.normalize("NFKC").toLocaleLowerCase() === normalizedName)) return false;
attribute.name = name;
return true;
}
removeObjectAttribute(attributeId) {
const id = String(attributeId || "");
const index = this.objectAttributeDefinitions.findIndex((attribute) => attribute.id === id);
if (index < 0) return null;
const [removed] = this.objectAttributeDefinitions.splice(index, 1);
this.assets.forEach((asset) => {
asset.attributes = asset.attributes.filter((attribute) => attribute.attributeId !== id);
});
return removed;
}

  addAsset(asset, sceneId = null) {
    const image = asset instanceof ImageAsset ? asset : new ImageAsset(asset);
    this.assets.push(image);
    this.getScene(sceneId)?.addAsset(image.id);
    return image;
  }

  getAssetsForScene(sceneId) {
    const scene = this.getScene(sceneId);
    if (!scene) return [];
    const assignedIds = new Set(scene.assetIds);
    return this.assets.filter((asset) => assignedIds.has(asset.id));
  }

  addSoundAsset(asset, sceneId = null) {
    const sound = asset instanceof SoundAsset ? asset : new SoundAsset(asset);
    this.soundAssets.push(sound);
    const scene = this.getScene(sceneId);
    scene?.addSound(sound.id);
    const cue = scene?.soundCues.find((candidate) => candidate.soundId === sound.id);
    if (cue) {
      cue.durationSeconds = sound.durationSeconds;
      cue.volumePercent = sound.volumePercent;
    }
    return sound;
  }

  addVideoAsset(asset, sceneId = null) {
    const video = asset instanceof VideoAsset ? asset : new VideoAsset(asset);
    this.videoAssets.push(video);
    this.getScene(sceneId)?.addVideo(video.id);
    return video;
  }

  moveAssetToScene(assetId, sourceSceneId, targetSceneId) {
    const id = String(assetId || "");
    const source = this.getScene(sourceSceneId);
    const target = this.getScene(targetSceneId);
    if (!id || !this.getAsset(id) || !source || !target || source === target) return false;
    if (!source.removeAsset(id)) return false;

    const removedLayerIds = new Set(source.stage.layers.filter((layer) => layer.assetId === id).map((layer) => layer.id));
    source.stage.layers = source.stage.layers.filter((layer) => layer.assetId !== id);
    source.removeSoundLayerAssociations(removedLayerIds);
    source.removeVideoLayerAssociations(removedLayerIds);
    this.removeObjectCompatibilityTargets(removedLayerIds);
    source.timedCues.forEach((cue) => {
      if (cue.assetId === id) cue.assetId = null;
      if (removedLayerIds.has(cue.targetLayerId)) cue.targetLayerId = null;
    });
    source.normalizeStackPositions();
    target.addAsset(id);
    return true;
  }

  copyAssetToScene(assetId, sourceSceneId, targetSceneId) {
    const id = String(assetId || "");
    const source = this.getScene(sourceSceneId);
    const target = this.getScene(targetSceneId);
    if (!id || !this.getAsset(id) || !source || !target || source === target || !source.assetIds.includes(id) || target.assetIds.includes(id)) return false;
    target.addAsset(id);
    return true;
  }

  moveSoundAssetToScene(soundId, sourceSceneId, targetSceneId) {
    const id = String(soundId || "");
    const source = this.getScene(sourceSceneId);
    const target = this.getScene(targetSceneId);
    if (!id || !this.getSoundAsset(id) || !source || !target || source === target) return false;
    if (!source.removeSound(id)) return false;
    target.addSound(id);
    return true;
  }

  moveVideoAssetToScene(videoId, sourceSceneId, targetSceneId) {
    const id = String(videoId || "");
    const source = this.getScene(sourceSceneId);
    const target = this.getScene(targetSceneId);
    if (!id || !this.getVideoAsset(id) || !source || !target || source === target) return false;
    if (!source.removeVideo(id)) return false;
    target.addVideo(id);
    return true;
  }

  getSoundAssetsForScene(sceneId) {
    const scene = this.getScene(sceneId);
    if (!scene) return [];
    const assignedIds = new Set(scene.soundIds);
    return this.soundAssets.filter((asset) => assignedIds.has(asset.id));
  }

  getVideoAssetsForScene(sceneId) {
    const scene = this.getScene(sceneId);
    if (!scene) return [];
    const assignedIds = new Set(scene.videoIds);
    return this.videoAssets.filter((asset) => assignedIds.has(asset.id));
  }

  removeSoundAssetFromScene(soundId, sceneId) {
    const id = String(soundId || "");
    const scene = this.getScene(sceneId);
    if (!id || !scene || !scene.removeSound(id)) return false;
    const usedElsewhere = this.scenes.some((otherScene) => otherScene.soundIds.includes(id));
    if (!usedElsewhere) this.removeSoundAsset(id);
    return true;
  }

  removeVideoAssetFromScene(videoId, sceneId) {
    const id = String(videoId || "");
    const scene = this.getScene(sceneId);
    if (!id || !scene || !scene.removeVideo(id)) return false;
    const usedElsewhere = this.scenes.some((otherScene) => otherScene.videoIds.includes(id));
    if (!usedElsewhere) this.removeVideoAsset(id);
    return true;
  }

  removeSoundAsset(id) {
    const assetIndex = this.soundAssets.findIndex((asset) => asset.id === id);
    if (assetIndex < 0) return false;
    this.soundAssets.splice(assetIndex, 1);
    this.scenes.forEach((scene) => scene.removeSound(id));
    this.removeObjectResourceReferences(id);
    return true;
  }

  removeVideoAsset(id) {
    const assetIndex = this.videoAssets.findIndex((asset) => asset.id === id);
    if (assetIndex < 0) return false;
    this.videoAssets.splice(assetIndex, 1);
    this.scenes.forEach((scene) => scene.removeVideo(id));
    return true;
  }

  removeAssetFromScene(assetId, sceneId) {
    const id = String(assetId || "");
    const scene = this.getScene(sceneId);
    if (!id || !scene || !scene.removeAsset(id)) return false;

    const removedLayerIds = new Set(scene.stage.layers.filter((layer) => layer.assetId === id).map((layer) => layer.id));
    scene.stage.layers = scene.stage.layers.filter((layer) => layer.assetId !== id);
    scene.removeSoundLayerAssociations(removedLayerIds);
    scene.removeVideoLayerAssociations(removedLayerIds);
    this.removeObjectCompatibilityTargets(removedLayerIds);
    scene.timedCues.forEach((cue) => {
      if (cue.assetId === id) cue.assetId = null;
      if (removedLayerIds.has(cue.targetLayerId)) cue.targetLayerId = null;
    });

    const usedElsewhere = this.scenes.some((otherScene) => (
      otherScene.assetIds.includes(id)
      || otherScene.stage.layers.some((layer) => layer.assetId === id)
      || otherScene.timedCues.some((cue) => cue.assetId === id)
      || otherScene.canvasStyle.backgroundImageAssetId === id
    )) || this.adventureMap.imageAssetId === id;
    if (!usedElsewhere) this.removeAsset(id);
    return true;
  }

  removeAsset(id) {
    const assetIndex = this.assets.findIndex((asset) => asset.id === id);
    if (assetIndex < 0) return false;
    this.assets.splice(assetIndex, 1);
    if (this.canvasBackgroundImageAssetId === id) {
      this.canvasBackgroundImageAssetId = null;
      this.canvasBackgroundAllModules = false;
    }
    if (this.adventureMap.imageAssetId === id) this.adventureMap.imageAssetId = null;
    this.removeObjectResourceReferences(id);

    const removedLayerIds = new Set();
    this.scenes.forEach((scene) => {
      if (scene.canvasStyle.backgroundImageAssetId === id) scene.canvasStyle.backgroundImageAssetId = null;
      const sceneLayerIds = new Set(scene.stage.layers.filter((layer) => layer.assetId === id).map((layer) => layer.id));
      sceneLayerIds.forEach((layerId) => removedLayerIds.add(layerId));
      scene.stage.layers = scene.stage.layers.filter((layer) => layer.assetId !== id);
      scene.removeSoundLayerAssociations(sceneLayerIds);
      scene.removeVideoLayerAssociations(sceneLayerIds);
      scene.removeAsset(id);
      scene.timedCues.forEach((cue) => {
        if (cue.assetId === id) cue.assetId = null;
        if (sceneLayerIds.has(cue.targetLayerId)) cue.targetLayerId = null;
      });
    });
    this.removeObjectCompatibilityTargets(removedLayerIds);
    return true;
  }

  removeObjectCompatibilityTargets(layerIds) {
    const removedIds = new Set(Array.from(layerIds || [], (layerId) => String(layerId || "")).filter(Boolean));
    if (!removedIds.size) return false;
    let changed = false;
    this.scenes.forEach((scene) => scene.stage.layers.forEach((layer) => {
      const current = Array.isArray(layer.combinableWithLayerIds) ? layer.combinableWithLayerIds : [];
      const next = current.filter((layerId) => !removedIds.has(String(layerId)));
      if (next.length !== current.length) {
        layer.combinableWithLayerIds = next;
        changed = true;
      }
    }));
    return changed;
  }

  ensureObjectCompatibilityIntegrity() {
    const validLayerIds = new Set(this.scenes.flatMap((scene) => scene.stage.layers.map((layer) => layer.id)));
    const layerById = new Map(this.scenes.flatMap((scene) => scene.stage.layers.map((layer) => [layer.id, layer])));
    const validResourceIds = new Set([
      ...this.assets.map((asset) => asset.id),
      ...this.soundAssets.map((asset) => asset.id),
    ]);
    this.scenes.forEach((scene) => scene.stage.layers.forEach((layer) => {
      const current = Array.isArray(layer.combinableWithLayerIds) ? layer.combinableWithLayerIds : [];
      layer.combinableWithLayerIds = [...new Set(current.map(String).filter((layerId) => (
        layerId && layerId !== layer.id && validLayerIds.has(layerId)
      )))];
      const legacyResourceIds = layer.combinableWithLayerIds
        .map((layerId) => layerById.get(layerId)?.assetId)
        .filter(Boolean);
      const configuredResourceIds = Array.isArray(layer.combinableWithResourceIds)
        ? layer.combinableWithResourceIds
        : [];
      layer.combinableWithResourceIds = [...new Set([...configuredResourceIds, ...legacyResourceIds]
        .map(String)
        .filter((resourceId) => resourceId && resourceId !== layer.assetId && validResourceIds.has(resourceId)))];
      if (!validResourceIds.has(layer.combinationResultAssetId)) layer.combinationResultAssetId = null;
    }));
  }
ensureObjectAttributeIntegrity() {
this.objectAttributeDefinitions = normalizeObjectAttributeDefinitions(this.objectAttributeDefinitions);
const validAttributeIds = new Set(this.objectAttributeDefinitions.map((attribute) => attribute.id));
this.assets.forEach((asset) => {
const seen = new Set();
asset.attributes = (Array.isArray(asset.attributes) ? asset.attributes : []).filter((attribute) => {
const id = String(attribute?.attributeId || "");
if (!id || !validAttributeIds.has(id) || seen.has(id)) return false;
seen.add(id);
attribute.attributeId = id;
attribute.value = Number.isFinite(Number(attribute.value)) ? Number(attribute.value) : 0;
return true;
});
});
}

  removeObjectResourceReferences(resourceId) {
    const id = String(resourceId || "");
    if (!id) return false;
    let changed = false;
    this.scenes.forEach((scene) => scene.stage.layers.forEach((layer) => {
      const current = Array.isArray(layer.combinableWithResourceIds) ? layer.combinableWithResourceIds : [];
      const next = current.filter((candidate) => String(candidate) !== id);
      if (next.length !== current.length) {
        layer.combinableWithResourceIds = next;
        changed = true;
      }
      if (layer.combinationResultAssetId === id) {
        layer.combinationResultAssetId = null;
        changed = true;
      }
    }));
    return changed;
  }

  get moduleTree() {
    return this.main;
  }

  findTreeNode(nodeId, current = this.main, parent = null) {
    if (!current) return null;
    if (current.id === nodeId) return { node: current, parent, index: -1 };
    if (!(current instanceof ModuleFolder || current instanceof ModuleReference)) return null;
    for (let index = 0; index < current.children.length; index += 1) {
      const child = current.children[index];
      if (child.id === nodeId) return { node: child, parent: current, index };
      if (Array.isArray(child.children)) {
        const match = this.findTreeNode(nodeId, child, current);
        if (match) return match;
      }
    }
    return null;
  }

  getTreeContainer(nodeId = "main") {
    const match = this.findTreeNode(nodeId);
    return match?.node instanceof ModuleFolder || match?.node instanceof ModuleReference ? match.node : this.main;
  }

  getModuleReferenceForScene(sceneId, current = this.main) {
    if (!(current instanceof ModuleFolder || current instanceof ModuleReference)) return null;
    for (const child of current.children) {
      if (child instanceof ModuleReference && child.sceneId === sceneId) return child;
      if (child instanceof ModuleFolder || child instanceof ModuleReference) {
        const match = this.getModuleReferenceForScene(sceneId, child);
        if (match) return match;
      }
    }
    return null;
  }

  addScene(scene, parentId = "main") {
    const module = scene instanceof SceneModule ? scene : new SceneModule(scene);
    const existingMax = Math.max(0, ...this.scenes.map((candidate) => Number(candidate.moduleNumber) || 0));
    if (!module.moduleNumber || this.getSceneByModuleNumber(module.moduleNumber)) module.moduleNumber = existingMax + 1;
    this.scenes.push(module);
    this.ensureModuleNumbers();
    this.getTreeContainer(parentId).children.push(new ModuleReference({ sceneId: module.id }));
    if (!this.startSceneId) this.setStartScene(module.id);
    return module;
  }
removeScene(sceneId) {
if (this.scenes.length <= 1) return false;
const sceneIndex = this.scenes.findIndex((scene) => scene.id === sceneId);
const reference = this.getModuleReferenceForScene(sceneId);
const location = reference ? this.findTreeNode(reference.id) : null;
if (sceneIndex < 0 || !(location?.parent instanceof ModuleFolder || location?.parent instanceof ModuleReference)) return false;

const removedScene = this.scenes[sceneIndex];
const removedLayerIds = new Set(removedScene.stage.layers.map((layer) => layer.id));
const removedAssetIds = new Set([
...removedScene.assetIds,
...removedScene.stage.layers.map((layer) => layer.assetId),
...removedScene.timedCues.map((cue) => cue.assetId),
removedScene.canvasStyle.backgroundImageAssetId,
].filter(Boolean));
const removedSoundIds = new Set(removedScene.soundIds);
    const removedVideoIds = new Set(removedScene.videoIds);
location.parent.children.splice(location.index, 1, ...reference.children);
this.scenes.splice(sceneIndex, 1);
this.removeObjectCompatibilityTargets(removedLayerIds);
this.scenes.forEach((scene) => scene.decisions.choices.forEach((choice) => {
if (choice.targetSceneId === sceneId) choice.targetSceneId = null;
}));
if (this.startSceneId === sceneId) this.setStartScene(this.scenes[0].id);

removedAssetIds.forEach((assetId) => {
const stillUsed = this.scenes.some((scene) => (
scene.assetIds.includes(assetId)
|| scene.stage.layers.some((layer) => layer.assetId === assetId)
|| scene.timedCues.some((cue) => cue.assetId === assetId)
|| scene.canvasStyle.backgroundImageAssetId === assetId
));
if (!stillUsed) this.removeAsset(assetId);
});
removedSoundIds.forEach((soundId) => {
const stillUsed = this.scenes.some((scene) => scene.soundIds.includes(soundId));
if (!stillUsed) this.removeSoundAsset(soundId);
});
    removedVideoIds.forEach((videoId) => {
      const stillUsed = this.scenes.some((scene) => scene.videoIds.includes(videoId));
      if (!stillUsed) this.removeVideoAsset(videoId);
    });
return true;
}

  addFolder(name = "Nueva carpeta", parentId = "main") {
    const folder = new ModuleFolder({ name });
    this.getTreeContainer(parentId).children.push(folder);
    return folder;
  }

  moveModule(moduleNodeId, parentNodeId) {
    const source = this.findTreeNode(moduleNodeId);
    const destination = this.findTreeNode(parentNodeId);
    if (!(source?.node instanceof ModuleReference)) return false;
    if (!(destination?.node instanceof ModuleFolder || destination?.node instanceof ModuleReference)) return false;

    let ancestor = destination.node;
    while (ancestor) {
      if (ancestor.id === source.node.id) return false;
      const parentId = this.findTreeNode(ancestor.id)?.parent?.id;
      ancestor = parentId ? this.findTreeNode(parentId)?.node : null;
    }

    if (source.parent?.id === destination.node.id) return false;
    source.parent.children.splice(source.index, 1);
    destination.node.children.push(source.node);
    return true;
  }

  setStartScene(sceneId) {
    if (this.getScene(sceneId)) {
      this.startSceneId = sceneId;
      this.main.startSceneId = sceneId;
    }
  }

  ensureModuleTreeIntegrity() {
    const validSceneIds = new Set(this.scenes.map((scene) => scene.id));
    const seenSceneIds = new Set();
    const cleanContainer = (container) => {
      container.children = container.children
        .map((child) => moduleTreeNodeFromJSON(child))
        .filter(Boolean)
        .filter((child) => {
          if (child instanceof ModuleReference) {
            if (!validSceneIds.has(child.sceneId) || seenSceneIds.has(child.sceneId)) return false;
            seenSceneIds.add(child.sceneId);
            cleanContainer(child);
            return true;
          }
          cleanContainer(child);
          return true;
        });
    };

    cleanContainer(this.main);
    this.scenes.forEach((scene) => {
      if (!seenSceneIds.has(scene.id)) this.main.children.push(new ModuleReference({ sceneId: scene.id }));
    });
    if (!validSceneIds.has(this.startSceneId)) this.startSceneId = this.scenes[0]?.id || null;
    this.main.startSceneId = this.startSceneId;
  }

  ensureSceneAssetIntegrity(sourceVersion, sourceScenes) {
    const validAssetIds = new Set(this.assets.map((asset) => asset.id));
    this.scenes.forEach((scene, index) => {
      const rawScene = sourceScenes[index] || {};
      if (sourceVersion < 3 || !Array.isArray(rawScene.assetIds)) {
        const inferredIds = new Set([
          ...scene.stage.layers.map((layer) => layer.assetId),
          ...scene.timedCues.map((cue) => cue.assetId),
          ...(Array.isArray(rawScene.disabledAssetIds) ? rawScene.disabledAssetIds : []),
        ].filter(Boolean).map(String));
        scene.assetIds = [...inferredIds];
      }
      scene.assetIds = [...new Set(scene.assetIds.filter((assetId) => validAssetIds.has(String(assetId))).map(String))];
    });

    if (sourceVersion < 3 && this.scenes.length) {
      const assigned = new Set(this.scenes.flatMap((scene) => scene.assetIds));
      const unassigned = this.assets.filter((asset) => !assigned.has(asset.id));
      const fallbackScene = this.getScene(this.startSceneId) || this.scenes[0];
      unassigned.forEach((asset) => fallbackScene.addAsset(asset.id));
    }
  }

  ensureSceneSoundIntegrity(sourceScenes = []) {
    const validSoundIds = new Set(this.soundAssets.map((asset) => asset.id));
    this.scenes.forEach((scene, index) => {
      scene.soundIds = [...new Set(scene.soundIds.filter((soundId) => validSoundIds.has(String(soundId))).map(String))];
      scene.soundCues = scene.soundCues.filter((cue) => !cue.soundId || validSoundIds.has(String(cue.soundId)));
      const validLayerIds = new Set(scene.stage.layers.map((layer) => layer.id));
      scene.removeSoundLayerAssociations([...scene.soundCues
        .filter((cue) => cue.imageLayerId && !validLayerIds.has(cue.imageLayerId))
        .map((cue) => cue.imageLayerId)]);
      scene.soundIds.forEach((soundId) => {
        if (!scene.soundCues.some((cue) => cue.soundId === soundId)) scene.addSoundCue({ soundId });
      });

      const sourceScene = sourceScenes[index];
      const hasExplicitSoundCues = sourceScene?._hasExplicitSoundCues ?? Array.isArray(sourceScene?.soundCues);
      if (!hasExplicitSoundCues) {
        scene.soundCues.forEach((cue) => {
          const sound = this.getSoundAsset(cue.soundId);
          if (!sound) return;
          cue.durationSeconds = sound.durationSeconds;
          cue.volumePercent = sound.volumePercent;
        });
      }
    });
  }

  ensureSceneVideoIntegrity() {
    const validVideoIds = new Set(this.videoAssets.map((asset) => asset.id));
    this.scenes.forEach((scene) => {
      scene.videoIds = [...new Set(scene.videoIds.filter((videoId) => validVideoIds.has(String(videoId))).map(String))];
      scene.videoCues = scene.videoCues.filter((cue) => !cue.videoId || validVideoIds.has(String(cue.videoId)));
      const validLayerIds = new Set(scene.stage.layers.map((layer) => layer.id));
      scene.videoCues.forEach((cue) => {
        if (cue.imageLayerId && !validLayerIds.has(cue.imageLayerId)) cue.imageLayerId = null;
        if (cue.videoId && validVideoIds.has(cue.videoId) && !scene.videoIds.includes(cue.videoId)) scene.videoIds.push(cue.videoId);
      });
      scene.videoIds.forEach((videoId) => {
        if (!scene.videoCues.some((cue) => cue.videoId === videoId)) scene.addVideoCue({ videoId });
      });
    });
  }

  ensureQuizIntegrity() {
    const validSceneIds = new Set(this.scenes.map((scene) => scene.id));
    const validAssetIds = new Set(this.assets.map((asset) => asset.id));
    const validVideoIds = new Set(this.videoAssets.map((asset) => asset.id));
    this.scenes.forEach((scene) => scene.quizChallenges.forEach((challenge) => {
      if (!validAssetIds.has(challenge.expectedAssetId)) challenge.expectedAssetId = null;
      if (!validSceneIds.has(challenge.outcome.sceneId)) challenge.outcome.sceneId = null;
      if (!validVideoIds.has(challenge.outcome.videoId)) challenge.outcome.videoId = null;
      if (!validSceneIds.has(challenge.incorrectOutcome.sceneId)) challenge.incorrectOutcome.sceneId = null;
      if (!validVideoIds.has(challenge.incorrectOutcome.videoId)) challenge.incorrectOutcome.videoId = null;
    }));
  }

  toJSON() {
    return {
      format: "escena-viva-project",
  version: 33,
      id: this.id,
      title: this.title,
      notes: this.notes.toJSON(),
      inventoryGrid: { ...this.inventoryGrid },
      inventoryHintCapacity: this.inventoryHintCapacity,
canvasBackgroundAllModules: this.canvasBackgroundAllModules,
canvasBackgroundImageAssetId: this.canvasBackgroundImageAssetId,
sceneTransitionAnimation: this.sceneTransitionAnimation,
      adventureMap: {
        ...this.adventureMap,
        cells: this.adventureMap.cells.map((cell) => ({ ...cell })),
      },
      startSceneId: this.startSceneId,
      main: this.main.toJSON(),
      scenes: this.scenes.map((scene) => scene.toJSON()),
      assets: this.assets.map((asset) => asset.toJSON()),
      objectAttributeDefinitions: this.objectAttributeDefinitions.map((attribute) => ({ ...attribute })),
      characterSheet: {
        attributes: this.characterSheet.attributes.map((attribute) => ({ ...attribute })),
        distributablePoints: this.characterSheet.distributablePoints,
        progressionRules: this.characterSheet.progressionRules.map((rule) => ({ ...rule })),
      },
      playerCharacters: this.playerCharacters.map((character) => character.toJSON()),
      resourceSectionNames: { ...this.resourceSectionNames },
      soundAssets: this.soundAssets.map((asset) => asset.toJSON()),
      videoAssets: this.videoAssets.map((asset) => asset.toJSON()),
characters: [...this.characters],
      theme: this.theme.toJSON(),
    };
  }

  static fromJSON(raw) {
    if (!raw || !Array.isArray(raw.scenes)) {
      throw new Error("El archivo no contiene un proyecto de Escena Viva válido.");
    }
    return new Project(raw);
  }
}

export function createBlankProject() {
  const scene = new SceneModule({
    name: "Escena 1",
    dialogues: [],
    decisions: { prompt: "", choices: [] },
  });
  scene.decisions.prompt = "";
  return new Project({ title: "Nueva aventura", scenes: [scene] });
}

function hasRichTextContent(value) {
  const html = typeof value === "string" ? value : value?.html;
  return String(html || "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .trim().length > 0;
}

export function projectHasAuthoredContent(project) {
  if (!project) return false;
  if (project.title && !["Mi ficción interactiva", "Nueva aventura"].includes(project.title.trim())) return true;
  if (project.assets?.length || project.soundAssets?.length || project.videoAssets?.length || project.characters?.length) return true;
  if (hasRichTextContent(project.notes)) return true;
  if (project.scenes?.length > 1) return true;
  const blankDefaults = createBlankProject();
  const defaultScene = blankDefaults.scenes[0];
  if (JSON.stringify(project.inventoryGrid) !== JSON.stringify(blankDefaults.inventoryGrid)) return true;
  if (JSON.stringify(project.theme) !== JSON.stringify(blankDefaults.theme)) return true;
  const hasFolder = (node) => node?.type === "folder" || (node?.children || []).some(hasFolder);
  if (hasFolder(project.main)) return true;

  return (project.scenes || []).some((scene) => {
    if (!scene) return false;
    if (scene.name && !["Escena 1", "Nueva escena"].includes(scene.name.trim())) return true;
    if (scene.isFinal || scene.finalType || scene.stage?.layers?.length || scene.assetIds?.length || scene.soundIds?.length || scene.videoIds?.length || scene.timedCues?.length) return true;
    if (scene.dialogues?.length) return true;
    if (JSON.stringify(scene.dialogueStyle) !== JSON.stringify(defaultScene.dialogueStyle)) return true;
    if (JSON.stringify(scene.decisions) !== JSON.stringify(defaultScene.decisions)) return true;
    if (hasRichTextContent(scene.notes)) return true;
    if (JSON.stringify(scene.canvasStyle) !== JSON.stringify(defaultScene.canvasStyle)) return true;
    return false;
  });
}

export function createStarterProject() {
  const harbourAsset = new ImageAsset({
    id: "asset_harbour",
    name: "Muelle de muestra",
    alt: "Muelle nocturno con agua y una luna creciente",
    mimeType: "image/svg+xml",
  naturalWidth: 1600,
  naturalHeight: 900,
    dataUrl: svgDataUri(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900">
        <defs>
          <linearGradient id="sky" x1="0" x2="0" y1="0" y2="1"><stop stop-color="#273254"/><stop offset="0.55" stop-color="#866176"/><stop offset="1" stop-color="#e29b69"/></linearGradient>
          <linearGradient id="sea" x1="0" x2="0" y1="0" y2="1"><stop stop-color="#2d5064"/><stop offset="1" stop-color="#102637"/></linearGradient>
          <filter id="glow"><feGaussianBlur stdDeviation="13"/></filter>
        </defs>
        <rect width="1600" height="900" fill="url(#sky)"/>
        <circle cx="1190" cy="196" r="86" fill="#ffe9ae" opacity=".93"/><circle cx="1190" cy="196" r="118" fill="#ffe9ae" opacity=".22" filter="url(#glow)"/>
        <path d="M0 460 C260 405 430 490 665 437 S1180 430 1600 390 V900 H0Z" fill="url(#sea)"/>
        <path d="M0 610 C250 564 520 654 790 610 S1280 610 1600 564" fill="none" stroke="#d5b886" stroke-opacity=".35" stroke-width="5"/>
        <path d="M0 694 C310 627 520 739 801 687 S1240 695 1600 638" fill="none" stroke="#ffd998" stroke-opacity=".18" stroke-width="5"/>
        <path d="M0 900 V703 L415 603 L1020 668 L1600 595 V900Z" fill="#172127"/>
        <path d="M190 793 L890 680 L1265 745 L649 900 H0Z" fill="#352a2c"/>
        <path d="M488 710 L722 668 L1225 735" fill="none" stroke="#9e714e" stroke-width="17" stroke-linecap="round"/>
        <g fill="#211a22"><rect x="211" y="344" width="21" height="310"/><rect x="249" y="378" width="13" height="279"/><path d="M224 350 L479 465 L225 479Z"/></g>
        <g fill="#f9d987"><circle cx="439" cy="475" r="10"/><circle cx="551" cy="498" r="7"/><circle cx="689" cy="521" r="8"/></g>
        <text x="78" y="125" fill="#fff2d4" font-family="Georgia, serif" font-size="34" opacity=".73">Escena de muestra</text>
      </svg>
    `),
  });

  const scene = new SceneModule({
    id: "scene_arrival",
    name: "Llegada al muelle",
    stage: {
      layers: [new ImageLayer({ id: "layer_harbour", assetId: harbourAsset.id, xPct: 50, yPct: 50, widthPct: 100 })],
    },
    dialogue: new DialogueBlock({
      speaker: "NARRADORA",
      text: new RichTextBlock({ html: "El mar trae una voz lejana. <strong>La carta</strong> pesa en tu bolsillo como una promesa.", lang: "es" }),
    }),
    decisions: new DecisionPanel({
      prompt: "¿Qué haces?",
      choices: [
        new Decision({ id: "choice_letter", label: "Leer la carta" }),
        new Decision({ id: "choice_lighthouse", label: "Seguir la luz del faro" }),
      ],
    }),
    timedCues: [
      new TimedCue({
        id: "cue_breeze",
        atMs: 3500,
        speaker: "NARRADORA",
        text: new RichTextBlock({ html: "Una ráfaga levanta el borde de la carta. Alguien ha dejado una señal para ti.", lang: "es" }),
      }),
    ],
  });

  return new Project({ title: "Ficción de muestra", scenes: [scene], assets: [harbourAsset], theme: new Theme() });
}
