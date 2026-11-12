import { Project } from "./model.js?v=2026-11-12-03";
import { InventoryState, CombinationRules, appendInventoryAttributeInfo } from "./inventory.js?v=2026-11-12-01";
import { fitMapCellImageFrame, runStandaloneGame } from "./playable-runtime.js?v=2026-11-12-04";
import { PlayerCharacterState } from "./character-state.js?v=2026-11-12-01";

const LEGACY_PROJECT_STORAGE_KEY = "escena-viva-project-v1";
const PROJECT_DATABASE_NAME = "crowther-project-storage-v1";
const PROJECT_STORE_NAME = "projects";
const PROJECT_ASSET_STORE_NAME = "media-assets";
const PROJECT_RECORD_ID = "active-project";
const TEMPLATE_DATABASE_NAME = "escena-viva-template-library-v1";
const TEMPLATE_STORE_NAME = "templates";
const TEMPLATE_METADATA_STORE_NAME = "template-metadata";

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function serializeForInlineJson(value) {
  // Evita que contenido del diálogo, como </script>, cierre el bloque JSON del
  // juego generado. El navegador recupera los mismos caracteres al hacer
  // JSON.parse dentro del HTML autónomo.
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function readExporterSource(relativePath, description) {
  const response = await fetch(new URL(relativePath, import.meta.url));
  if (!response.ok) throw new Error(`No se pudo leer ${description} (${response.status}).`);
  return response.text();
}

function getProjectData(project) {
  const data = typeof project?.toJSON === "function" ? project.toJSON() : project;
  if (!data || !Array.isArray(data.scenes)) throw new Error("No hay un proyecto válido para exportar.");
  return data;
}

function getMediaSources(project, data = getProjectData(project)) {
  const runtimeImages = new Map((project?.assets || []).map((asset) => [asset.id, asset.dataUrl]));
  const runtimeSounds = new Map((project?.soundAssets || []).map((asset) => [asset.id, asset.dataUrl]));
  const runtimeVideos = new Map((project?.videoAssets || []).map((asset) => [asset.id, asset.dataUrl]));
  return [
    ...(data.assets || []).map((asset) => ({
      ...asset,
      kind: "image",
      source: runtimeImages.get(asset.id) || asset.dataUrl || "",
    })),
    ...(data.soundAssets || []).map((asset) => ({
      ...asset,
      kind: "audio",
      source: runtimeSounds.get(asset.id) || asset.dataUrl || "",
    })),
    ...(data.videoAssets || []).map((asset) => ({
      ...asset,
      kind: "video",
      source: runtimeVideos.get(asset.id) || asset.dataUrl || "",
    })),
  ];
}

async function blobFromAssetSource(source, assetName) {
  if (!source) return null;
  if (!/^(data:|blob:)/i.test(String(source))) {
    throw new Error(`El recurso «${assetName || "multimedia"}» no está disponible localmente para guardarlo.`);
  }
  const response = await fetch(source);
  if (!response.ok) throw new Error(`No se pudo leer el recurso «${assetName || "multimedia"}".`);
  return response.blob();
}

function blobToDataUrl(blob, assetName) {
  if (typeof FileReader !== "function") {
    return blob.arrayBuffer().then((buffer) => {
      const bytes = new Uint8Array(buffer);
      let binary = "";
      const chunkSize = 0x8000;
      for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
      }
      const mimeType = blob.type || "application/octet-stream";
      return `data:${mimeType};base64,${btoa(binary)}`;
    }).catch((error) => {
      throw new Error(`No se pudo preparar «${assetName || "multimedia"}» para exportarlo: ${error.message}`);
    });
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result || "")), { once: true });
    reader.addEventListener("error", () => reject(reader.error || new Error(`No se pudo preparar «${assetName || "multimedia"}» para exportarlo.`)), { once: true });
    reader.readAsDataURL(blob);
  });
}

async function makePortableProjectData(project) {
  const data = getProjectData(project);
  const portable = {
    ...data,
    assets: (data.assets || []).map((asset) => ({ ...asset })),
    soundAssets: (data.soundAssets || []).map((asset) => ({ ...asset })),
    videoAssets: (data.videoAssets || []).map((asset) => ({ ...asset })),
  };
  const runtimeSources = new Map(getMediaSources(project, data).map((asset) => [asset.id, asset.source]));
  for (const asset of [...portable.assets, ...portable.soundAssets, ...portable.videoAssets]) {
    const source = runtimeSources.get(asset.id) || asset.dataUrl || "";
    if (!source || source.startsWith("data:")) {
      asset.dataUrl = source;
      continue;
    }
    const blob = await blobFromAssetSource(source, asset.name);
    asset.dataUrl = await blobToDataUrl(blob, asset.name);
  }
  return portable;
}

function extensionForAsset(asset) {
  const dataMime = String(asset.dataUrl || "").match(/^data:([^;,]+)/i)?.[1];
  const mime = String(dataMime || asset.mimeType || "").toLowerCase();
const extensions = {
"audio/mpeg": "mp3",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/ogg": "ogv",
    "video/quicktime": "mov",
    "image/avif": "avif",
    "image/bmp": "bmp",
    "image/gif": "gif",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/svg+xml": "svg",
    "image/webp": "webp",
    "image/x-icon": "ico",
  };
  if (extensions[mime]) return extensions[mime];
  const original = String(asset.name || "").match(/\.([a-z0-9]{1,8})$/i)?.[1]?.toLowerCase();
return ["avif", "bmp", "gif", "ico", "jpg", "jpeg", "mp3", "mp4", "m4v", "mov", "ogv", "png", "svg", "webm", "webp"].includes(original) ? original : "img";
}

function assetArchivePath(asset, index, mediaDirectory) {
  const baseName = String(asset.name || "imagen")
    .replace(/\.[^.]+$/, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 48) || "imagen";
  return `assets/${mediaDirectory}/${String(index + 1).padStart(3, "0")}-${baseName}.${extensionForAsset(asset)}`;
}

async function dataUrlToBytes(source, assetName) {
  if (!/^(data:|blob:)/i.test(String(source || ""))) {
    throw new Error(`El recurso «${assetName || "multimedia"}» no contiene datos disponibles para exportar.`);
  }
  const response = await fetch(source);
  if (!response.ok) throw new Error(`No se pudo preparar el recurso «${assetName || "multimedia"}».`);
  return new Uint8Array(await response.arrayBuffer());
}

const ZIP_CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let value = 0; value < table.length; value += 1) {
    let crc = value;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    table[value] = crc >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    crc = ZIP_CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipTimestamp(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

function makeZipBlob(entries) {
  if (entries.length > 0xffff) throw new Error("El paquete tiene demasiados archivos para el formato ZIP.");
  const encoder = new TextEncoder();
  const localParts = [];
  const directoryParts = [];
  const stamp = zipTimestamp();
  let localOffset = 0;
  let directorySize = 0;

  entries.forEach(({ name, data }) => {
    const nameBytes = encoder.encode(name);
    const bytes = typeof data === "string" ? encoder.encode(data) : data;
    if (bytes.length > 0xffffffff || localOffset > 0xffffffff) throw new Error("El paquete supera el límite de tamaño ZIP compatible.");
    const checksum = crc32(bytes);
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(localHeader.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, stamp.time, true);
    localView.setUint16(12, stamp.date, true);
    localView.setUint32(14, checksum, true);
    localView.setUint32(18, bytes.length, true);
    localView.setUint32(22, bytes.length, true);
    localView.setUint16(26, nameBytes.length, true);
    localView.setUint16(28, 0, true);
    localHeader.set(nameBytes, 30);
    localParts.push(localHeader, bytes);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(centralHeader.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, stamp.time, true);
    centralView.setUint16(14, stamp.date, true);
    centralView.setUint32(16, checksum, true);
    centralView.setUint32(20, bytes.length, true);
    centralView.setUint32(24, bytes.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint16(30, 0, true);
    centralView.setUint16(32, 0, true);
    centralView.setUint16(34, 0, true);
    centralView.setUint16(36, 0, true);
    centralView.setUint32(38, 0, true);
    centralView.setUint32(42, localOffset, true);
    centralHeader.set(nameBytes, 46);
    directoryParts.push(centralHeader);
    localOffset += localHeader.length + bytes.length;
    directorySize += centralHeader.length;
  });

  if (localOffset > 0xffffffff || directorySize > 0xffffffff) throw new Error("El paquete supera el límite de tamaño ZIP compatible.");
  const endRecord = new Uint8Array(22);
  const endView = new DataView(endRecord.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, directorySize, true);
  endView.setUint32(16, localOffset, true);
  endView.setUint16(20, 0, true);
  return new Blob([...localParts, ...directoryParts, endRecord], { type: "application/zip" });
}

// Function#toString no conserva imports ni cierres léxicos: se insertan todas
// las dependencias del reproductor antes de ejecutar la función en el HTML.
const STANDALONE_RUNTIME = [
  InventoryState.toString(),
  CombinationRules.toString(),
  appendInventoryAttributeInfo.toString(),
  PlayerCharacterState.toString(),
  fitMapCellImageFrame.toString(),
  `(${runStandaloneGame.toString()})();`,
].join("\n");

/** Genera un juego publicable sin imports, servidor ni recursos externos. */
export class PlayableHtmlExporter {
  static async build(project) {
    const data = await makePortableProjectData(project);
    const [playableCss, quillCss, quillSource, quillLicense, licenseText, attributionTerms, runtimeException] = await Promise.all([
 readExporterSource("../playable.css?v=2026-11-12-03", "la hoja CSS del juego"),
      readExporterSource("../vendor/quill/quill.snow.css", "el tema Quill"),
      readExporterSource("../vendor/quill/quill.min.js", "el editor Quill"),
      readExporterSource("../vendor/quill/LICENSE", "la licencia de Quill"),
      readExporterSource("../LICENSE", "la licencia GPLv3 de Crowther"),
      readExporterSource("../COPYRIGHT-ATTRIBUTION.txt", "la condición de atribución de Crowther"),
      readExporterSource("../RUNTIME-LICENSE-EXCEPTION.txt", "la excepción de licencia del runtime"),
    ]);
    const cssText = `${playableCss}\n${quillCss}`;
    const safeQuillSource = quillSource.replace(/<\/script/gi, "<\\/script");

    const title = escapeHtml(data.title || "Ficción interactiva");
    const serializedProject = serializeForInlineJson(data);
    const legalNotice = `<details class="engine-attribution"><summary>Motor Crowther · © Jacobo Feijóo · Avisos de licencia</summary><p>El contenido de esta aventura pertenece a su creador. La aventura puede distribuirse bajo la licencia que este elija; el runtime de Crowther conserva su crédito y la excepción de licencia correspondiente.</p><h3>GNU GPLv3</h3><pre>${escapeHtml(licenseText)}</pre><h3>Condición de atribución</h3><pre>${escapeHtml(attributionTerms)}</pre><h3>Excepción del runtime para aventuras</h3><pre>${escapeHtml(runtimeException)}</pre><h3>Licencia de Quill</h3><pre>${escapeHtml(quillLicense)}</pre></details>`;
    return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content="Ficción interactiva creada con Escena Viva." />
    <title>${title}</title>
    <style>
      ${cssText}
    </style>
    <style id="project-style"></style>
  </head>
  <body>
    <main class="game-shell">
      <div id="game" aria-live="polite">
<div id="stage" aria-label="Escena del juego"><div id="layers"></div><div id="canvas-columns" class="canvas-columns" aria-hidden="true"></div><button id="inventory-toggle" class="inventory-toggle" type="button" aria-label="Abrir inventario" title="Abrir inventario" aria-controls="inventory-panel" aria-expanded="false"><svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="14"/><rect x="9.5" y="7.5" width="13" height="17" rx="1.5"/><path d="M12.5 12h7M12.5 16h7M12.5 20h4"/></svg></button><button id="character-toggle" class="character-toggle" type="button" aria-label="Ver personaje" title="Ver personaje" aria-controls="character-panel" aria-expanded="false"><svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="14"/><circle cx="16" cy="9.5" r="3.2"/><path d="M10.5 24v-5.2a5.5 5.5 0 0 1 11 0V24M8.5 24h15"/></svg></button><section id="inventory-panel" class="inventory-panel" aria-label="Inventario" aria-hidden="true" hidden><header class="inventory-panel-header has-close"><h2>Inventario</h2><button id="inventory-panel-close" class="icon-button hint-text-remove panel-close-button" type="button" aria-label="Cerrar inventario" title="Cerrar inventario">×</button></header><div id="inventory-items" class="inventory-items" aria-live="polite"><p class="inventory-empty">Aún no hay objetos en el inventario.</p></div></section><section id="character-panel" class="map-panel character-panel" aria-label="Personaje" aria-hidden="true" hidden><header class="inventory-panel-header"><h2 id="character-panel-heading">Personaje</h2><button id="character-panel-close" class="icon-button hint-text-remove" type="button" aria-label="Cerrar personaje">×</button></header><div id="character-panel-content" class="character-panel-content"></div></section></div>
        <div id="dialogues" class="dialogue-layer" aria-label="Diálogos"></div>
        <section id="choices" class="choice-preview" aria-label="Decisiones"></section>
      </div>
      <p id="status" class="game-status" aria-live="polite"></p>
      ${legalNotice}
    </main>
    <dialog id="player-welcome-dialog" class="about-dialog welcome-dialog"><div class="about-dialog-content welcome-dialog-content"><div class="about-dialog-heading"><div><p class="eyebrow">LIBROJUEGO DIGITAL</p><h2>Crowther</h2></div></div><div class="welcome-copy"><p>Bienvenido a Crowther. Configura tu personaje antes de empezar la aventura.</p></div><div class="welcome-actions"><label class="welcome-no-show"><input id="player-welcome-do-not-show" type="checkbox" /><span>No volver a mostrar</span></label><button id="player-welcome-start" class="button button-primary" type="button">Empezar</button></div></div></dialog>
    <dialog id="character-setup-dialog" class="about-dialog character-setup-dialog" aria-labelledby="character-setup-heading"><form id="character-setup-form" class="about-dialog-content character-setup-content"><div class="about-dialog-heading"><div><p class="eyebrow">PREPARA TU AVENTURA</p><h2 id="character-setup-heading">Configura tu personaje</h2></div></div><label class="full-field" for="player-character-name"><span>Nombre</span><input id="player-character-name" type="text" maxlength="80" autocomplete="nickname" value="Jugador" /></label><p id="character-setup-points" class="character-setup-points" aria-live="polite"></p><div id="character-setup-attributes" class="character-setup-attributes"></div><div class="welcome-actions"><button id="character-setup-start" class="button button-primary" type="submit">Comenzar aventura</button></div></form></dialog>
    <script id="escena-viva-project" type="application/json">${serializedProject}</script>
<script>${safeQuillSource}</script>
<script>${STANDALONE_RUNTIME}</script>
  </body>
</html>`;
  }

  static async buildHostingPackage(project) {
    const data = getProjectData(project);
    const [cssText, quillCss, quillSource, runtimeSource, mainSource, inventorySource, characterSource, quillLicense, licenseText, attributionTerms, runtimeException] = await Promise.all([
  readExporterSource("../playable.css?v=2026-11-12-03", "la hoja CSS del juego"),
      readExporterSource("../vendor/quill/quill.snow.css", "el tema Quill"),
      readExporterSource("../vendor/quill/quill.min.js", "el editor Quill"),
      readExporterSource("./playable-runtime.js?v=2026-11-12-04", "el reproductor JavaScript"),
      readExporterSource("./playable-main.js", "el punto de entrada JavaScript"),
      readExporterSource("./inventory.js?v=2026-11-12-01", "la gestión del inventario"),
      readExporterSource("./character-state.js?v=2026-11-12-01", "el estado del personaje"),
      readExporterSource("../vendor/quill/LICENSE", "la licencia de Quill"),
      readExporterSource("../LICENSE", "la licencia GPLv3 de Crowther"),
      readExporterSource("../COPYRIGHT-ATTRIBUTION.txt", "la condición de atribución de Crowther"),
      readExporterSource("../RUNTIME-LICENSE-EXCEPTION.txt", "la excepción de licencia del runtime"),
    ]);

    const assetPaths = new Map();
    const assetEntries = [];
    const runtimeAssets = new Map(getMediaSources(project, data).map((asset) => [asset.id, asset]));
    for (const [mediaDirectory, assets] of [["images", data.assets || []], ["audio", data.soundAssets || []], ["videos", data.videoAssets || []]]) {
      for (const [index, asset] of assets.entries()) {
        const source = runtimeAssets.get(asset.id)?.source || asset.dataUrl || "";
        if (!source) continue;
        const assetForPath = { ...asset, dataUrl: source };
        const path = assetArchivePath(assetForPath, index, mediaDirectory);
        assetPaths.set(asset.id, `./${path}`);
        assetEntries.push({ name: path, data: await dataUrlToBytes(source, asset.name) });
      }
    }

    const packageData = {
      ...data,
      assets: (data.assets || []).map((asset) => ({ ...asset, dataUrl: assetPaths.get(asset.id) || asset.dataUrl })),
soundAssets: (data.soundAssets || []).map((asset) => ({ ...asset, dataUrl: assetPaths.get(asset.id) || asset.dataUrl })),
      videoAssets: (data.videoAssets || []).map((asset) => ({ ...asset, dataUrl: assetPaths.get(asset.id) || asset.dataUrl })),
    };
    const title = escapeHtml(data.title || "Ficción interactiva");
    const legalNotice = `<details class="engine-attribution"><summary>Motor Crowther · © Jacobo Feijóo · Avisos de licencia</summary><p>El contenido de esta aventura pertenece a su creador. La aventura puede distribuirse bajo la licencia que este elija; el runtime de Crowther conserva su crédito y la excepción de licencia correspondiente.</p><p><a href="./LICENSE">Licencia GNU GPLv3</a> · <a href="./COPYRIGHT-ATTRIBUTION.txt">Condición de atribución</a> · <a href="./RUNTIME-LICENSE-EXCEPTION.txt">Excepción para aventuras</a> · <a href="./vendor/quill/LICENSE">Licencia de Quill</a></p></details>`;
    const html = `<!doctype html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content="Ficción interactiva creada con Escena Viva." />
    <title>${title}</title>
<link rel="stylesheet" href="./vendor/quill/quill.snow.css" />
    <link rel="stylesheet" href="./playable.css" />
    <style id="project-style"></style>
  </head>
  <body>
    <main class="game-shell">
      <div id="game" aria-live="polite">
<div id="stage" aria-label="Escena del juego"><div id="layers"></div><div id="canvas-columns" class="canvas-columns" aria-hidden="true"></div><button id="inventory-toggle" class="inventory-toggle" type="button" aria-label="Abrir inventario" title="Abrir inventario" aria-controls="inventory-panel" aria-expanded="false"><svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="14"/><rect x="9.5" y="7.5" width="13" height="17" rx="1.5"/><path d="M12.5 12h7M12.5 16h7M12.5 20h4"/></svg></button><button id="character-toggle" class="character-toggle" type="button" aria-label="Ver personaje" title="Ver personaje" aria-controls="character-panel" aria-expanded="false"><svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="14"/><circle cx="16" cy="9.5" r="3.2"/><path d="M10.5 24v-5.2a5.5 5.5 0 0 1 11 0V24M8.5 24h15"/></svg></button><section id="inventory-panel" class="inventory-panel" aria-label="Inventario" aria-hidden="true" hidden><header class="inventory-panel-header has-close"><h2>Inventario</h2><button id="inventory-panel-close" class="icon-button hint-text-remove panel-close-button" type="button" aria-label="Cerrar inventario" title="Cerrar inventario">×</button></header><div id="inventory-items" class="inventory-items" aria-live="polite"><p class="inventory-empty">Aún no hay objetos en el inventario.</p></div></section><section id="character-panel" class="map-panel character-panel" aria-label="Personaje" aria-hidden="true" hidden><header class="inventory-panel-header"><h2 id="character-panel-heading">Personaje</h2><button id="character-panel-close" class="icon-button hint-text-remove" type="button" aria-label="Cerrar personaje">×</button></header><div id="character-panel-content" class="character-panel-content"></div></section></div>
        <div id="dialogues" class="dialogue-layer" aria-label="Diálogos"></div>
        <section id="choices" class="choice-preview" aria-label="Decisiones"></section>
      </div>
      <p id="status" class="game-status" aria-live="polite"></p>
      ${legalNotice}
    </main>
    <dialog id="player-welcome-dialog" class="about-dialog welcome-dialog"><div class="about-dialog-content welcome-dialog-content"><div class="about-dialog-heading"><div><p class="eyebrow">LIBROJUEGO DIGITAL</p><h2>Crowther</h2></div></div><div class="welcome-copy"><p>Bienvenido a Crowther. Configura tu personaje antes de empezar la aventura.</p></div><div class="welcome-actions"><label class="welcome-no-show"><input id="player-welcome-do-not-show" type="checkbox" /><span>No volver a mostrar</span></label><button id="player-welcome-start" class="button button-primary" type="button">Empezar</button></div></div></dialog>
    <dialog id="character-setup-dialog" class="about-dialog character-setup-dialog" aria-labelledby="character-setup-heading"><form id="character-setup-form" class="about-dialog-content character-setup-content"><div class="about-dialog-heading"><div><p class="eyebrow">PREPARA TU AVENTURA</p><h2 id="character-setup-heading">Configura tu personaje</h2></div></div><label class="full-field" for="player-character-name"><span>Nombre</span><input id="player-character-name" type="text" maxlength="80" autocomplete="nickname" value="Jugador" /></label><p id="character-setup-points" class="character-setup-points" aria-live="polite"></p><div id="character-setup-attributes" class="character-setup-attributes"></div><div class="welcome-actions"><button id="character-setup-start" class="button button-primary" type="submit">Comenzar aventura</button></div></form></dialog>
    <script src="./vendor/quill/quill.min.js"></script>
    <script type="module" src="./js/playable-main.js"></script>
  </body>
</html>`;
    const readme = [
      "Paquete web de Escena Viva",
      "",
      "Sube todos los archivos y carpetas del ZIP al mismo directorio de tu hosting estático.",
"Abre index.html desde una dirección HTTP/HTTPS. El paquete carga el proyecto y los recursos multimedia desde rutas relativas; no debe abrirse con file://.",
      "Mantén juntas las carpetas js, data, assets/images, assets/audio, assets/videos y vendor/quill, y los archivos playable.css e index.html.",
      "Conserva LICENSE, COPYRIGHT-ATTRIBUTION.txt y RUNTIME-LICENSE-EXCEPTION.txt; el runtime de Crowther conserva la atribución, pero puedes elegir la licencia del contenido de tu aventura.",
      "",
    ].join("\n");
    const entries = [
      { name: "index.html", data: html },
      { name: "playable.css", data: cssText },
      { name: "vendor/quill/quill.snow.css", data: quillCss },
      { name: "vendor/quill/quill.min.js", data: quillSource },
      { name: "vendor/quill/LICENSE", data: quillLicense },
      { name: "LICENSE", data: licenseText },
      { name: "COPYRIGHT-ATTRIBUTION.txt", data: attributionTerms },
      { name: "RUNTIME-LICENSE-EXCEPTION.txt", data: runtimeException },
      { name: "js/playable-main.js", data: mainSource },
      { name: "js/playable-runtime.js", data: runtimeSource },
      { name: "js/inventory.js", data: inventorySource },
      { name: "js/character-state.js", data: characterSource },
      { name: "data/project.json", data: JSON.stringify(packageData, null, 2) },
      ...assetEntries,
      { name: "LEEME.txt", data: readme },
    ];
    return makeZipBlob(entries);
  }

  static async download(project, filename = "escena-viva-juego.html") {
    const html = await PlayableHtmlExporter.build(project);
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const safeFilename = filename.endsWith(".html") ? filename : `${filename}.html`;
    downloadBlob(blob, safeFilename);
    return { filename: safeFilename, bytes: blob.size };
  }

  static async downloadHostingPackage(project, filename = "escena-viva-hosting.zip") {
    const blob = await PlayableHtmlExporter.buildHostingPackage(project);
    const safeFilename = filename.endsWith(".zip") ? filename : `${filename}.zip`;
    downloadBlob(blob, safeFilename);
    return { filename: safeFilename, bytes: blob.size };
  }
}

export class ProjectRepository {
  static databasePromise = null;
  static saveQueue = Promise.resolve();
  static assetSources = new Map();
  static assetBlobs = new Map();

  static openDatabase() {
    if (!globalThis.indexedDB) return Promise.reject(new Error("Este navegador no permite el almacenamiento local de recursos."));
    if (!this.databasePromise) {
      this.databasePromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(PROJECT_DATABASE_NAME, 1);
        request.onupgradeneeded = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains(PROJECT_STORE_NAME)) {
            database.createObjectStore(PROJECT_STORE_NAME, { keyPath: "id" });
          }
          if (!database.objectStoreNames.contains(PROJECT_ASSET_STORE_NAME)) {
            database.createObjectStore(PROJECT_ASSET_STORE_NAME, { keyPath: "id" });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("No se pudo abrir el almacenamiento del proyecto."));
        request.onblocked = () => reject(new Error("Cierra otras pestañas de Crowther para actualizar el almacenamiento local."));
      }).catch((error) => {
        this.databasePromise = null;
        throw error;
      });
    }
    return this.databasePromise;
  }

  static async load() {
    this.assetSources.clear();
    this.assetBlobs.clear();
    const database = await this.openDatabase();
    const transaction = database.transaction([PROJECT_STORE_NAME, PROJECT_ASSET_STORE_NAME], "readonly");
    const projectRequest = transaction.objectStore(PROJECT_STORE_NAME).get(PROJECT_RECORD_ID);
    const assetsRequest = transaction.objectStore(PROJECT_ASSET_STORE_NAME).getAll();
    const [savedRecord, assetRecords] = await Promise.all([
      new Promise((resolve, reject) => {
        projectRequest.onsuccess = () => resolve(projectRequest.result || null);
        projectRequest.onerror = () => reject(projectRequest.error || new Error("No se pudo leer el proyecto guardado."));
      }),
      new Promise((resolve, reject) => {
        assetsRequest.onsuccess = () => resolve(assetsRequest.result || []);
        assetsRequest.onerror = () => reject(assetsRequest.error || new Error("No se pudieron leer los recursos guardados."));
      }),
    ]);

    if (savedRecord?.project) {
      const recordsById = new Map(assetRecords.map((record) => [record.id, record]));
      const metadata = savedRecord.project;
      const requiredMedia = [...(metadata.assets || []), ...(metadata.soundAssets || []), ...(metadata.videoAssets || [])]
        .filter((asset) => asset.mediaStored && !recordsById.has(asset.id));
      if (requiredMedia.length) {
        throw new Error("Faltan archivos multimedia del proyecto guardado. Importa una copia de seguridad para recuperarlos.");
      }

      const project = Project.fromJSON(metadata);
      // Las pestañas abiertas son estado del editor, no parte del juego exportado.
      project.editorWorkspace = savedRecord.workspace || null;
      for (const asset of [...project.assets, ...project.soundAssets, ...project.videoAssets]) {
        const record = recordsById.get(asset.id);
        if (!record?.blob) continue;
        asset.dataUrl = URL.createObjectURL(record.blob);
        this.assetSources.set(asset.id, asset.dataUrl);
        this.assetBlobs.set(asset.id, record.blob);
      }
      return project;
    }

    let legacySave = "";
    try {
      legacySave = globalThis.localStorage?.getItem(LEGACY_PROJECT_STORAGE_KEY) || "";
    } catch (error) {
      throw new Error(`No se pudo acceder a la copia anterior del proyecto: ${error.message}`);
    }
    if (!legacySave) return null;

    const legacyProject = Project.fromJSON(JSON.parse(legacySave));
    await this.save(legacyProject);
    return legacyProject;
  }

  static loadLegacyProject() {
    const legacySave = globalThis.localStorage?.getItem(LEGACY_PROJECT_STORAGE_KEY);
    return legacySave ? Project.fromJSON(JSON.parse(legacySave)) : null;
  }

  static saveWorkspace(projectId, workspace) {
    if (!projectId || !workspace) return Promise.resolve(false);
    const snapshot = {
      openSceneIds: [...new Set((Array.isArray(workspace.openSceneIds) ? workspace.openSceneIds : []).map(String))],
      activeSceneId: String(workspace.activeSceneId || ""),
    };
    const operation = this.saveQueue.catch(() => {}).then(async () => {
      const database = await this.openDatabase();
      return new Promise((resolve, reject) => {
        const transaction = database.transaction([PROJECT_STORE_NAME], "readwrite");
        const projectStore = transaction.objectStore(PROJECT_STORE_NAME);
        let didSave = false;
        const request = projectStore.get(PROJECT_RECORD_ID);
        request.onsuccess = () => {
          const record = request.result;
          if (!record?.project || String(record.project.id) !== String(projectId)) return;
          projectStore.put({ ...record, workspace: snapshot });
          didSave = true;
        };
        request.onerror = () => transaction.abort();
        transaction.oncomplete = () => resolve(didSave);
        transaction.onerror = () => reject(transaction.error || new Error("No se pudo guardar el espacio de trabajo."));
        transaction.onabort = () => reject(transaction.error || new Error("No se pudo guardar el espacio de trabajo."));
      });
    });
    this.saveQueue = operation;
    return operation;
  }

  static async save(project) {
    if (!project || typeof project.toJSON !== "function") throw new Error("No se ha recibido un proyecto válido para guardar.");
    const projectData = project.toJSON();
    const media = getMediaSources(project, projectData).filter((asset) => asset.source);
    const requiredIds = new Set(media.map((asset) => asset.id));
    const changedBlobs = new Map();

    for (const asset of media) {
      if (this.assetSources.get(asset.id) === asset.source && this.assetBlobs.has(asset.id)) continue;
      const blob = await blobFromAssetSource(asset.source, asset.name);
      if (blob) changedBlobs.set(asset.id, blob);
    }

    for (const asset of [...(projectData.assets || []), ...(projectData.soundAssets || []), ...(projectData.videoAssets || [])]) {
      asset.mediaStored = requiredIds.has(asset.id);
      asset.dataUrl = "";
    }

    const operation = this.saveQueue.catch(() => {}).then(async () => {
      const database = await this.openDatabase();
      await new Promise((resolve, reject) => {
        const transaction = database.transaction([PROJECT_STORE_NAME, PROJECT_ASSET_STORE_NAME], "readwrite");
        const projectStore = transaction.objectStore(PROJECT_STORE_NAME);
        const assetStore = transaction.objectStore(PROJECT_ASSET_STORE_NAME);
      projectStore.put({
        id: PROJECT_RECORD_ID,
        project: projectData,
        workspace: project.editorWorkspace || null,
        savedAt: new Date().toISOString(),
      });

        const existingRequest = assetStore.getAllKeys();
        existingRequest.onsuccess = () => {
          const existingIds = new Set(existingRequest.result.map(String));
          for (const existingId of existingIds) {
            if (!requiredIds.has(existingId)) assetStore.delete(existingId);
          }
          for (const asset of media) {
            const blob = changedBlobs.get(asset.id) || this.assetBlobs.get(asset.id);
            if (!blob) continue;
            if (changedBlobs.has(asset.id) || !existingIds.has(asset.id)) {
              assetStore.put({
                id: asset.id,
                kind: asset.kind,
                name: asset.name,
                mimeType: asset.mimeType,
                blob,
              });
            }
          }
        };
        existingRequest.onerror = () => transaction.abort();
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error || new Error("No se pudo completar el autoguardado."));
        transaction.onabort = () => reject(transaction.error || new Error("No se pudo completar el autoguardado."));
      });

      for (const asset of media) {
        this.assetSources.set(asset.id, asset.source);
        const blob = changedBlobs.get(asset.id);
        if (blob) this.assetBlobs.set(asset.id, blob);
      }
      for (const assetId of [...this.assetSources.keys()]) {
        if (!requiredIds.has(assetId)) {
          this.assetSources.delete(assetId);
          this.assetBlobs.delete(assetId);
        }
      }
      try {
        globalThis.localStorage?.removeItem(LEGACY_PROJECT_STORAGE_KEY);
      } catch {
        // El proyecto ya está seguro en IndexedDB; una copia antigua opcional no bloquea el guardado.
      }
    });
    this.saveQueue = operation;
    return operation;
  }

  static async toPortableProjectData(project) {
    return makePortableProjectData(project);
  }

  static async download(project, filename = "crowther-project.json") {
    const data = await makePortableProjectData(project);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" });
    downloadBlob(blob, filename);
    return { filename, bytes: blob.size };
  }

  /** Descarga un único HTML jugable, preparado para publicarse en hosting estático. */
  static downloadPlayableWeb(project, filename = "escena-viva-juego.html") {
    return PlayableHtmlExporter.download(project, filename);
  }

  /** Descarga un ZIP con fuentes, CSS, datos e imágenes para hosting estático. */
  static downloadPlayablePackage(project, filename = "escena-viva-hosting.zip") {
    return PlayableHtmlExporter.downloadHostingPackage(project, filename);
  }

  // Alias semántico para integraciones que hablen explícitamente de HTML.
  static downloadPlayableHtml(project, filename = "escena-viva-juego.html") {
    return ProjectRepository.downloadPlayableWeb(project, filename);
  }

  static async importFile(file) {
    const contents = await file.text();
    return Project.fromJSON(JSON.parse(contents));
  }
}

/** Almacén local de plantillas completas, separado del guardado automático del editor. */
export class ProjectTemplateRepository {
  static databasePromise = null;

  static openDatabase() {
    if (!globalThis.indexedDB) return Promise.reject(new Error("Este navegador no permite almacenar plantillas locales."));
    if (!this.databasePromise) {
      this.databasePromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(TEMPLATE_DATABASE_NAME, 1);
        request.onupgradeneeded = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains(TEMPLATE_STORE_NAME)) {
            database.createObjectStore(TEMPLATE_STORE_NAME, { keyPath: "id" });
          }
          if (!database.objectStoreNames.contains(TEMPLATE_METADATA_STORE_NAME)) {
            database.createObjectStore(TEMPLATE_METADATA_STORE_NAME, { keyPath: "id" });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("No se pudo abrir la biblioteca de plantillas."));
        request.onblocked = () => reject(new Error("Cierra otras pestañas de Escena Viva para actualizar la biblioteca de plantillas."));
      }).catch((error) => {
        this.databasePromise = null;
        throw error;
      });
    }
    return this.databasePromise;
  }

  static async transact(mode, operation) {
    const database = await this.openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction([TEMPLATE_STORE_NAME, TEMPLATE_METADATA_STORE_NAME], mode);
      let result;
      let hasResult = false;
      const setResult = (value) => {
        result = value;
        hasResult = true;
      };
      transaction.oncomplete = () => resolve(hasResult ? result : undefined);
      transaction.onerror = () => reject(transaction.error || new Error("No se pudo completar la operación con plantillas."));
      transaction.onabort = () => reject(transaction.error || new Error("Se canceló la operación con plantillas."));
      try {
        operation(
          transaction.objectStore(TEMPLATE_STORE_NAME),
          transaction.objectStore(TEMPLATE_METADATA_STORE_NAME),
          setResult,
        );
      } catch (error) {
        transaction.abort();
        reject(error);
      }
    });
  }

  static async list() {
    return this.transact("readonly", (_templates, metadata, setResult) => {
      const request = metadata.getAll();
      request.onsuccess = () => {
        const entries = request.result || [];
        entries.sort((left, right) => left.name.localeCompare(right.name, "es", { sensitivity: "base" })
          || right.savedAt.localeCompare(left.savedAt));
        setResult(entries);
      };
    });
  }

  static async save(project, name, id = null) {
    const normalizedName = String(name || "").trim();
    if (!normalizedName) throw new Error("Escribe un nombre para la plantilla.");
    if (!project || typeof project.toJSON !== "function") throw new Error("No se ha recibido un proyecto válido para guardar.");
    const templateId = id || (globalThis.crypto?.randomUUID?.() ?? `plantilla-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`);
    const savedAt = new Date().toISOString();
    const snapshot = {
      id: templateId,
      name: normalizedName,
      savedAt,
      project: await ProjectRepository.toPortableProjectData(project),
    };
    const metadata = { id: templateId, name: normalizedName, savedAt };
    await this.transact("readwrite", (templates, metadataStore) => {
      templates.put(snapshot);
      metadataStore.put(metadata);
    });
    return metadata;
  }

  static async load(id) {
    if (!id) return null;
    return this.transact("readonly", (templates, _metadata, setResult) => {
      const request = templates.get(id);
      request.onsuccess = () => setResult(request.result || null);
    });
  }

  static async delete(id) {
    if (!id) return;
    return this.transact("readwrite", (templates, metadata) => {
      templates.delete(id);
      metadata.delete(id);
    });
  }
}
