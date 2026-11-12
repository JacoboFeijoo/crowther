import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PlayableHtmlExporter } from "../js/storage.js";

const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = input instanceof URL ? input : new URL(typeof input === "string" ? input : input.url);
  if (url.protocol === "file:") {
    const contents = await readFile(fileURLToPath(url));
    return new Response(contents, { status: 200 });
  }
  return nativeFetch(input, init);
};

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function readStoredZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let endOffset = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 0xffff - 22); offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      endOffset = offset;
      break;
    }
  }
  assert.notEqual(endOffset, -1, "el ZIP debe tener un registro de cierre");
  const count = view.getUint16(endOffset + 10, true);
  const directoryOffset = view.getUint32(endOffset + 16, true);
  let offset = directoryOffset;
  const files = new Map();
  const decoder = new TextDecoder();

  for (let index = 0; index < count; index += 1) {
    assert.equal(view.getUint32(offset, true), 0x02014b50, "entrada ZIP central válida");
    const method = view.getUint16(offset + 10, true);
    const expectedCrc = view.getUint32(offset + 16, true);
    const size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.slice(offset + 46, offset + 46 + nameLength));
    assert.equal(method, 0, "las entradas usan ZIP sin compresión");

    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const contentOffset = localOffset + 30 + localNameLength + localExtraLength;
    const content = bytes.slice(contentOffset, contentOffset + size);
    assert.equal(crc32(content), expectedCrc, `CRC válido para ${name}`);
    files.set(name, content);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

try {
  const imageContents = '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="#123456"/></svg>';
  const imageBytes = Buffer.from(imageContents, "utf8");
  const project = {
    title: "Prueba de exportación",
    inventoryHintCapacity: 15,
    adventureMap: {
      size: 2,
      imageAssetId: "asset-1",
      cells: [
        { row: 1, column: 1, moduleNumber: 45, initiallyUnlocked: true },
        { row: 2, column: 1, moduleNumber: 100, initiallyUnlocked: false },
      ],
    },
    notes: { html: "<p>Nota del proyecto</p>", lang: "es", dir: "auto" },
    startSceneId: "scene-1",
    main: { startSceneId: "scene-1" },
    scenes: [{
      id: "scene-1",
      name: "Inicio",
      moduleNumber: 100,
      canvasStyle: { backgroundColor: "#203040", backgroundImageAssetId: "asset-1", columns: 3, gapPx: 36, columnBorders: [true, false, true] },
      dialogueStyle: { textColor: "#ffeecc", fontFamily: "Georgia, serif", fontSizePx: 24 },
      notes: { html: "<p>Nota de escena</p>", lang: "es", dir: "auto" },
      stage: { width: 1600, height: 900, layers: [
        { id: "layer-1", assetId: "asset-1", xPct: 50, yPct: 50, widthPct: 50, zIndex: 1, inventoryEnabled: true, combinableEnabled: true, unique: true, mapEnabled: true, mapCellKey: "2:1", combinableWithLayerIds: ["layer-2"], combinableWithResourceIds: ["sound-1"], combinationResultAssetId: "sound-1", clueEnabled: true, clues: [{ id: "clue-1", text: "No beber esta pócima" }] },
        { id: "layer-2", assetId: "asset-1", xPct: 25, yPct: 50, widthPct: 20, zIndex: 2 },
      ] },
      dialogue: { speaker: "Narradora", text: { html: "Hola", lang: "es", dir: "auto" }, placement: {} },
      dialogues: [
        { id: "dialogue-1", zIndex: 2, speaker: "Narradora", text: { html: "Hola", lang: "es", dir: "auto" }, placement: {} },
        { id: "dialogue-2", zIndex: 3, speaker: "Viajera", text: { html: "¿Quién anda ahí?", lang: "es", dir: "auto" }, placement: { xPct: 50, yPct: 40, widthPct: 55 } },
      ],
      decisions: {
        prompt: "¿Continuar?",
        visible: true,
        style: { textColor: "#ffffff", fontFamily: "Arial, sans-serif", fontSizePx: 18 },
        choices: [{
          id: "choice-1",
          label: "Abrir la puerta",
          labelText: { html: "<p><strong>Abrir la puerta</strong></p>", lang: "es", dir: "auto" },
          targetSceneId: null,
          placement: { xPct: 50, yPct: 82, widthPct: 78, heightPct: 10 },
        }],
      },
      quizChallenges: [{
        id: "fixture-password-quiz",
        question: { html: "<p>Dime la contraseña</p>", lang: "es", dir: "auto" },
        questionPlacement: { xPct: 50, yPct: 24, widthPct: 66, heightPct: 18 },
        answerPlacement: { xPct: 50, yPct: 72, widthPct: 70, heightPct: 26 },
        answerType: "text",
        expectedText: "luna",
        maxRetries: 2,
        outcome: { type: "dialogue", text: { html: "<p>La puerta se abre.</p>", lang: "es", dir: "auto" } },
        incorrectOutcome: { type: "animation", animationType: "shake", animationDurationMs: 600 },
      }],
      combatChallenges: [{
        id: "fixture-combat",
        enemyName: "Guardia",
        attributes: [{ name: "Fuerza", enemyValue: 5 }],
        comparisonAttribute: "Fuerza",
        playerBonus: 15,
        comparisonOperator: ">",
        victoryCondition: {
          playerTerms: [
            { source: "playerAttribute", attribute: "Fuerza", value: 0, operator: "+" },
            { source: "number", value: 15, operator: "+" },
          ],
          comparator: ">",
          enemyTerms: [{ source: "enemyAttribute", attribute: "Fuerza", value: 0, operator: "+" }],
        },
        diceCount: 2,
        diceSides: 10,
        maxRounds: 4,
        enemyMaxHealth: 12,
        damagePerWin: 2,
        placement: { xPct: 50, yPct: 48, widthPct: 90, heightPct: 70 },
        victoryAnimation: "flash",
        defeatAnimation: "shake",
        animationDurationMs: 700,
      }],
      timedCues: [{
        id: "transition-1",
        atMs: 10000,
        targetLayerId: "layer-1",
        assetId: "asset-1",
        transitionType: "fade-black",
        transitionDurationMs: 2000,
      }],
      soundIds: ["sound-1"],
      soundCues: [{
        id: "sound-cue-1",
        soundId: "sound-1",
        durationSeconds: 3,
        volumePercent: 30,
        imageLayerId: "layer-1",
      }],
      videoIds: ["video-1"],
      videoCues: [{
        id: "video-cue-1",
        videoId: "video-1",
        durationSeconds: 5,
        volumePercent: 45,
        imageLayerId: "layer-1",
        playOnStart: false,
      }],
    }],
    soundAssets: [{
      id: "sound-1",
      name: "oleaje.mp3",
      mimeType: "audio/mpeg",
      dataUrl: `data:audio/mpeg;base64,${Buffer.from("mp3-audio-data").toString("base64")}`,
      durationSeconds: 3,
      volumePercent: 30,
    }],
    videoAssets: [{
      id: "video-1",
      name: "intro.mp4",
      mimeType: "video/mp4",
      dataUrl: `data:video/mp4;base64,${Buffer.from("mp4-video-data").toString("base64")}`,
    }],
    assets: [{
      id: "asset-1",
      name: "Fondo ñ.svg",
      mimeType: "image/svg+xml",
      dataUrl: `data:image/svg+xml;base64,${imageBytes.toString("base64")}`,
      alt: "Fondo",
      naturalWidth: 2,
      naturalHeight: 2,
    }],
    theme: { variables: {}, customCss: "" },
  };

  const standalone = await PlayableHtmlExporter.build(project);
  const editorHtml = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const editorCss = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const editorSource = await readFile(new URL("../js/editor.js", import.meta.url), "utf8");
  const playableRuntimeSource = await readFile(new URL("../js/playable-runtime.js", import.meta.url), "utf8");
  const playableCss = await readFile(new URL("../playable.css", import.meta.url), "utf8");
  const launcher = await readFile(new URL("../Abrir Crowther.cmd", import.meta.url), "utf8");
  assert.match(editorHtml, /<title>Crowther — editor de ficción interactiva<\/title>/, "la pestaña del editor usa la marca Crowther");
  assert.match(editorHtml, /<h1>Crowther<\/h1>/, "la cabecera principal usa la marca Crowther");
  assert.match(editorHtml, /<h2 id="about-heading">Crowther<\/h2>/, "About usa la marca Crowther");
  assert.equal([...editorHtml.matchAll(/class="eyebrow">Librojuego digital<\/p>/g)].length, 2, "la pantalla principal y About usan el literal Librojuego digital");
  assert.equal([...editorHtml.matchAll(/src="Logo\/Logo\.svg"/g)].length, 3, "la cabecera, bienvenida y About usan el logo SVG del proyecto");
  assert.doesNotMatch(editorHtml, /class="brand-mark"[^>]*>✦/, "se elimina la estrella como marca visual");
  assert.match(editorHtml, /id="welcome-dialog"[^>]*aria-labelledby="welcome-heading"/, "existe la ventana modal de bienvenida");
  assert.match(editorHtml, /Bienvenido a Crowther, un IDE de diseño narrativo hecho por Jacobo Feijóo/, "la bienvenida presenta Crowther y su autor");
  assert.match(editorHtml, /<em>online<\/em> para construir aventuras/, "la bienvenida conserva online en cursiva");
  assert.match(editorHtml, /id="welcome-do-not-show" type="checkbox"/, "la bienvenida ofrece guardar la preferencia de no volver a mostrar");
  assert.match(editorSource, /crowther-welcome-dismissed-v1/);
  assert.match(editorSource, /showWelcomeIfNeeded\(\)/, "el editor muestra la bienvenida al arrancar");
  assert.match(editorSource, /persistWelcomePreference\(\)/, "la opción de no volver a mostrar se guarda localmente");
  assert.match(launcher, /match 'Crowther'/, "el lanzador reconoce la nueva marca al comprobar el servidor local");
  assert.match(editorHtml, /id="inventory-toggle"[^>]*aria-controls="inventory-panel"/, "el editor mantiene el icono fijo vinculado al panel");
  assert.match(editorHtml, /id="character-sheet-heading">Ficha de personaje/, "el Explorador ofrece la ficha común del personaje");
  assert.match(editorHtml, /id="tab-characters"[^>]*>Personajes<\/button>/, "el menú de herramientas incluye Personajes");
  assert.match(editorHtml, /id="object-character-enabled"[^>]*type="checkbox"/, "un objeto puede representar un personaje");
  assert.match(editorHtml, /id="character-setup-dialog"/, "el editor incluye la configuración inicial del personaje jugador");
  assert.match(editorHtml, /id="character-toggle"[^>]*aria-controls="character-panel"/, "el lienzo incluye el acceso a los valores del personaje");
  assert.match(editorHtml, /id="inventory-panel"[^>]*aria-hidden="true" hidden/, "el panel del inventario empieza colapsado en el editor");
assert.match(editorHtml, /id="inventory-panel-close"[^>]*>×<\/button>/, "el panel del inventario incluye una X para cerrar");
assert.match(editorHtml, /id="pencil-toggle"[^>]*aria-controls="pencil-panel"/, "el icono de lápiz abre su panel independiente");
assert.match(editorHtml, /id="pencil-panel"[^>]*aria-hidden="true" hidden/, "el panel de pistas y notas empieza colapsado");
assert.match(editorHtml, /id="pencil-panel-close"[^>]*>×<\/button>/, "el panel de pistas y notas incluye una X para cerrar");
assert.match(editorSource, /inventoryPanelClose\?\.addEventListener\("click", \(\) => this\.dom\.inventoryToggle\?\.click\(\)\)/, "la X del inventario reutiliza su control de cierre");
assert.match(editorSource, /pencilPanelClose\?\.addEventListener\("click", \(\) => this\.dom\.pencilToggle\?\.click\(\)\)/, "la X de pistas y notas reutiliza su control de cierre");
assert.match(playableRuntimeSource, /inventoryPanel\?\.querySelector\("#inventory-panel-close"\)\?\.addEventListener\("click", \(\) => inventoryToggle\?\.click\(\)\)/, "la exportación conecta la X del inventario al control del jugador");
assert.match(playableRuntimeSource, /pencilPanel\?\.querySelector\("#pencil-panel-close"\)\?\.addEventListener\("click", \(\) => pencilToggle\?\.click\(\)\)/, "la exportación conecta la X de pistas al control del jugador");
assert.match(playableRuntimeSource, /pencilHeader\?\.classList\.add\("has-close"\)/, "el reproductor aplica el estilo del cierre también al panel generado");
assert.match(editorHtml, /id="map-toggle"[^>]*aria-controls="map-panel"/, "el icono del mundo abre el panel de mapas");
assert.match(editorHtml, /id="map-panel"[^>]*aria-hidden="true" hidden/, "el panel de mapas empieza plegado");
assert.match(editorHtml, /<ellipse cx="16" cy="16" rx="6\.3" ry="14"/, "el icono del mapa usa un globo simplificado");
assert.match(editorHtml, /id="pencil-panel-hints"/, "el panel del lápiz contiene las pistas encontradas");
assert.match(editorHtml, /id="pencil-panel-notes-editor"/, "el panel del lápiz contiene las notas del jugador");
  const canvasInventoryPanelHtml = editorHtml.match(/<section id="inventory-panel"[\s\S]*?<\/section>/)?.[0] || "";
  assert.doesNotMatch(canvasInventoryPanelHtml, /pencil-panel-hints|pistas leídas|id="[^"]*hint/i, "el panel de inventario no muestra pistas");
  assert.doesNotMatch(editorHtml.match(/<section id="inventory-panel"[\s\S]*?<\/section>/)?.[0] || "", /pencil-panel|notas/i, "las notas siguen separadas del inventario");
  assert.match(editorHtml, /id="hint-overlay"[^>]*role="dialog"/, "las pistas usan una capa de diálogo superpuesta al lienzo");
  assert.match(editorHtml, /id="hint-overlay-close"[^>]*>×<\/button>/, "la capa de pista ofrece un botón X de cierre");
  assert.match(editorHtml, /id="dialogue-style-bg-mode"[\s\S]*?value="transparent"/, "el estilo del diálogo ofrece fondo transparente");
  assert.match(editorHtml, /id="decision-style-bg-mode"[\s\S]*?value="transparent"/, "las decisiones ofrecen transparencia por caja");
  assert.match(editorSource, /dialogue\.backgroundColor = input === this\.dom\.dialogueStyleBgMode/, "el fondo del diálogo seleccionado se guarda por caja");
  assert.match(editorSource, /choice\.backgroundColor = input === this\.dom\.decisionStyleBgMode/, "el fondo de la decisión seleccionada se guarda por caja");
  assert.match(playableRuntimeSource, /dialogueBox\.style\.backgroundColor = dialogue\.backgroundColor/, "el reproductor aplica el fondo propio de cada diálogo");
  assert.match(playableRuntimeSource, /button\.style\.backgroundColor = choice\.backgroundColor/, "el reproductor aplica el fondo propio de cada decisión");
  assert.match(editorHtml, /data-rename-resource-section="sound"[\s\S]*?data-rename-resource-section="video"[\s\S]*?data-rename-resource-section="transitions"/, "los bloques generales de recursos se pueden identificar y renombrar");
  assert.match(editorSource, /combatAttributesFromImage\(this\.project, asset\)/, "el selector de ilustración obtiene una copia de los atributos del recurso");
  assert.match(editorSource, /enemyAssetSelect\.dataset\.combatField = "enemyAssetId"/, "la ilustración de enemigo actualiza el combate activo");
  assert.match(editorSource, /createResourceCueCard\(cue, kind, index, removeDataset, removeLabel\)/, "las tarjetas de recursos comparten el comportamiento plegable y renombrable");
  assert.match(editorSource, /this\.openHintOverlay\(clues, trigger\)/, "el editor muestra la pista en una capa propia");
  assert.match(playableRuntimeSource, /showHintOverlay\(clues, trigger\)/, "el reproductor exportado también muestra las pistas en pantalla");
  assert.doesNotMatch(playableRuntimeSource, /inventoryPanelHints|inventory-panel-hints/, "el juego exportado no añade pistas al panel del inventario");
  const renderPencilClues = playableRuntimeSource.match(/function renderPencilClues\(\) \{([\s\S]*?)\n\}/)?.[1] || "";
  assert.match(renderPencilClues, /runtime\.inventory\.clues[\s\S]*?pencilClues\.replaceChildren/, "solo las pistas descubiertas se presentan en el panel de pistas");
  assert.doesNotMatch(renderPencilClues, /inventoryHintCapacity|Espacio vacío/, "el panel del lápiz no muestra capacidad ni huecos sin descubrir");
  assert.match(playableCss, /\.hint-overlay\s*\{/, "el paquete del juego incluye el estilo de la capa de pista");
  assert.match(editorHtml, /id="inventory-items"[^>]*class="inventory-items inventory-grid-board"[^>]*role="grid"/, "el panel del inventario tiene una cuadrícula de casillas");
  assert.match(editorHtml, /id="inventory-hint-capacity"/, "el explorador configura la capacidad de pistas");
  assert.match(editorHtml, /id="inventory-hints-board"/, "el explorador muestra los espacios de pistas");
  assert.match(editorHtml, /id="adventure-map-heading">Mapa/, "el explorador tiene una sección propia de mapa");
  assert.ok(editorHtml.indexOf('id="inventory-heading"') < editorHtml.indexOf('id="adventure-map-heading"')
    && editorHtml.indexOf('id="adventure-map-heading"') < editorHtml.indexOf('id="plugins-heading"'),
  "Mapa queda después de Inventario y antes de Plugins");
  assert.match(editorHtml, /id="map-grid-size"/, "el diseñador elige el tamaño cuadrado del mapa");
  assert.match(editorHtml, /id="map-cell-module-number"[^>]*type="number"/, "cada casilla permite asignar un módulo por número");
  assert.match(editorHtml, /id="map-cell-initially-unlocked" type="checkbox"/, "se pueden marcar destinos visibles desde el inicio");
  assert.match(editorHtml, /id="map-image-select"/, "el diseñador selecciona la ilustración gráfica del mapa");
  assert.match(editorHtml, /id="map-layer-enabled" type="checkbox"/, "el diseñador puede añadir el icono Mapa a una imagen del módulo");
  assert.match(editorHtml, /id="map-layer-cell"/, "el diseñador elige una casilla libre para cada imagen del mapa");
  assert.ok(editorHtml.indexOf('id="hint-resource-heading"') < editorHtml.indexOf('id="map-resource-heading"'),
    "la sección Mapa de Recursos queda después de Pistas");
  assert.match(editorHtml, /id="inventory-notes-editor"/, "el explorador contiene el editor Quill para notas de partida");
  assert.match(editorHtml, /id="hint-resource-heading">Pistas/, "el menú Recursos contiene la sección de pistas");
  assert.match(editorHtml, /id="hint-enabled" type="checkbox"/, "se puede marcar una imagen como pista");
  assert.match(editorHtml, /id="add-hint-text"/, "se pueden añadir varios textos de pista");
  assert.match(editorHtml, /id="add-sound-cue"/, "la sección Sonido permite añadir elecciones de sonido");
  assert.match(editorHtml, /id="sound-cue-list"/, "la sección Sonido aloja las elecciones por módulo");
  assert.match(editorHtml, /id="add-video-cue"/, "la sección Vídeo permite añadir vídeos por módulo");
  assert.match(editorHtml, /id="video-playback-panel"/, "el editor dispone del panel superpuesto de vídeo");
  assert.match(editorHtml, /data-panel="combats"/, "Combates tiene una pestaña vacía propia");
  assert.match(editorHtml, /data-panel="quiz"/, "Quiz mantiene su pestaña del menú de herramientas");
  assert.match(editorHtml, /id="quiz-add-button"/, "Quiz permite añadir preguntas");
  assert.match(editorHtml, /id="quiz-list"/, "Quiz muestra los retos editables del módulo");
  assert.match(editorHtml, /id="canvas-background-image"[\s\S]*?<option value="">Ninguna<\/option>/, "el lienzo ofrece un selector de fondo con la opción Ninguna");
  assert.match(editorHtml, /id="stage-background" class="stage-background"[^>]*hidden/, "el editor incluye una imagen de fondo fija fuera de las capas editables");
  assert.doesNotMatch(editorHtml, /id="sound-remove"|Quitar sonido del módulo/, "se elimina el botón redundante de quitar sonido");
  assert.match(editorSource, /remove\.className = "icon-button hint-text-remove"/, "la x de los textos de pista comparte la estética del botón más");
  assert.match(editorCss, /\.hint-list-heading\s*\{[^}]*margin-top:\s*1\.75rem[^}]*padding-top:\s*0\.75rem[^}]*border-top:\s*1px solid var\(--line\)/, "separa visualmente el checkbox Pista del encabezado de textos");
  assert.match(editorCss, /\.brand-logo\s*\{[^}]*object-fit:\s*contain/, "el logo SVG conserva su proporción dentro de la marca");
  assert.match(editorCss, /\.sidebar-section\s*\{\s*padding:\s*1rem;\s*border-bottom:\s*1px solid var\(--line\);\s*\}/, "las secciones de recursos comparten un separador lineal");
  assert.doesNotMatch(editorCss, /\.sound-resource-section\s*\{[^}]*\b(?:border|border-radius):/, "Sonido no añade un borde rectangular a la línea común");
  assert.doesNotMatch(editorCss, /\.timed-resource-section\s*\{[^}]*\b(?:border|border-radius):/, "Tiempos y transiciones no añade un borde rectangular a la línea común");
  assert.match(editorCss, /\.stage-background\s*\{[^}]*object-fit:\s*cover[^}]*pointer-events:\s*none/, "la imagen de fondo se adapta al lienzo y no recibe interacciones");
  assert.match(editorSource, /backgroundImageAssetId/, "el fondo de lienzo se guarda por escena");
  assert.match(editorSource, /renderCanvasBackgroundOptions/, "el selector lista los recursos de imagen del proyecto");
  assert.match(editorCss, /\.inventory-toggle\s*\{[^}]*width:\s*clamp\(2\.475rem,\s*4\.8vw,\s*3\.3rem\)/, "el icono del inventario se reduce un 25 por ciento");
assert.match(editorCss, /\.pencil-toggle\s*\{[^}]*width:\s*clamp\(2\.475rem,\s*4\.8vw,\s*3\.3rem\)/, "el icono de lápiz mantiene el mismo tamaño que el inventario");
assert.match(editorCss, /\.map-toggle\s*\{[^}]*width:\s*clamp\(2\.475rem,\s*4\.8vw,\s*3\.3rem\)/, "el icono del mapa mantiene el mismo tamaño que los otros");
assert.match(editorCss, /\.map-panel\s*\{[^}]*inset:\s*8% 8%/, "el panel del mapa aparece sobre el lienzo");
assert.match(editorSource, /ensureMapCellNoteEditor[\s\S]*handleMapCellNoteAction/, "el editor de prueba permite crear, editar y borrar notas de casilla");
assert.match(editorSource, /data-map-note-action/, "las notas se vinculan a controles de cada ilustración del mapa");
assert.match(editorCss, /\.map-note-overlay\s*\{[^}]*position:\s*absolute[^}]*z-index:\s*4/, "el editor de notas se superpone al mapa");
assert.match(editorSource, /artFrame\.append\(noteActions\)[\s\S]*cellElement\.append\(artFrame\)/, "los controles de nota se anclan al marco exacto de la ilustración");
assert.match(editorCss, /\.map-panel-cell-art\s*\{[^}]*top:\s*50%[^}]*left:\s*50%[^}]*transform:\s*translate\(-50%,\s*-50%\)/, "el marco de la ilustración queda centrado dentro de la casilla");
assert.match(editorCss, /\.map-panel-note-actions\s*\{[^}]*position:\s*absolute[^}]*top:\s*0\.2rem[^}]*right:\s*0\.2rem/, "los controles de nota quedan dentro de la esquina superior derecha de la ilustración");
assert.match(editorCss, /--canvas-ui-layout-gap:\s*0\.65rem/, "el lienzo reserva un pequeño margen después de los iconos");
assert.match(editorSource, /getCanvasLayoutBoundaryPx[\s\S]*getCanvasMinimumCenterXPct[\s\S]*clampSceneElementsToLayoutBoundary/, "el editor limita la colocación al margen reservado de los iconos");
assert.match(editorSource, /getCanvasMinimumCenterXPct\(element, bounds, widthPx\)/, "el redimensionado también respeta el margen reservado");
assert.match(editorCss, /\.pencil-panel\s*\{[^}]*inset:\s*0 0 0 auto[^}]*overflow-y:\s*auto/, "el panel del lápiz ocupa el lado opuesto y puede desplazarse");
  const inventoryClearanceRule = /\.inventory-panel\s*\{[^}]*--inventory-button-clearance:[^;]+;[^}]*width:\s*min\(100%,\s*calc\(50% \+ var\(--inventory-button-clearance\) - var\(--inventory-panel-padding\)\)\)[^}]*overflow-y:\s*auto[^}]*padding-left:\s*max\(var\(--inventory-panel-padding\),\s*var\(--inventory-button-clearance\)\)/;
  assert.match(editorCss, inventoryClearanceRule, "el panel deja espacio para el botón y puede superar la mitad del lienzo");
  assert.match(editorCss, /\.object-compatibility-list\s*\{[^}]*overflow-y:\s*scroll/, "Combinable con mantiene una barra vertical visible");
  assert.match(standalone, /<style>\s*:root/);
  assert.match(standalone, inventoryClearanceRule, "el juego exportado conserva la separación del inventario");
  assert.match(standalone, /id="escena-viva-project"/);
  assert.match(standalone, /id="dialogues" class="dialogue-layer"/);
  assert.match(standalone, /id="canvas-columns" class="canvas-columns"/);
  assert.match(standalone, /canvas-column-guide/);
  assert.match(standalone, /--dialogue-font-family/);
  assert.match(standalone, /--choice-font-family/);
  assert.ok(standalone.includes('"backgroundColor":"#203040"'), "el HTML autónomo conserva el estilo del lienzo");
  assert.ok(standalone.includes('"backgroundImageAssetId":"asset-1"'), "el HTML autónomo conserva la imagen de fondo seleccionada");
  assert.match(standalone, /stageBackgroundImage\.src = backgroundAsset\.dataUrl/, "el juego autónomo representa la imagen seleccionada detrás de la escena");
  assert.match(standalone, /state\.dialogues/);
  assert.match(standalone, /choice\.labelText\?\.html/, "el HTML autónomo representa decisiones enriquecidas");
  assert.match(standalone, /<script>class InventoryState[\s\S]*class CombinationRules[\s\S]*\(async function runStandaloneGame/);
  assert.match(standalone, /function fitMapCellImageFrame/, "el HTML autónomo incluye la función que ajusta el arte del mapa");
  assert.match(standalone, /runtime\.mapCellNotes = new Map\(\)|mapCellNotes:\s*new Map\(\)/, "el juego autónomo mantiene notas de mapa durante la partida");
  assert.match(standalone, /function saveMapCellNote[\s\S]*runtime\.mapCellNotes\.set/, "el jugador puede guardar y editar una nota de casilla");
  assert.match(standalone, /data-map-note-action/, "el HTML autónomo incluye los controles de nota del mapa");
  assert.match(standalone, /<script>[\s\S]*Quill[\s\S]*<\/script>/, "el HTML único integra Quill sin CDN");
  assert.match(standalone, /data:image\/svg\+xml;base64,/);
  assert.ok(standalone.includes("Nota del proyecto"), "el HTML autónomo incorpora las notas del proyecto");
  assert.ok(standalone.includes("Nota de escena"), "el HTML autónomo incorpora las notas de cada escena");
  assert.ok(standalone.includes("data:audio/mpeg;base64,"), "el HTML autónomo incorpora el MP3");
  assert.match(standalone, /playSceneSounds/);
  assert.match(standalone, /function playVideoCue/, "el HTML único reproduce vídeos del proyecto");
  assert.match(standalone, /function answerQuiz/, "el HTML único valida respuestas de Quiz");
  assert.match(standalone, /function appendQuizPreview/, "el HTML único presenta preguntas y resultados de Quiz");
  assert.match(standalone, /function playCombatRound/, "el HTML único ejecuta rondas de combate");
  assert.match(standalone, /function appendCombatPreview/, "el HTML único muestra el combate en dos columnas");
  assert.match(standalone, /fixture-combat/, "el HTML único conserva la configuración del combate");
  assert.match(standalone, /\.combat-box/, "la exportación integra el estilo de la caja de combate");
  assert.match(standalone, /pendingQuizId/, "el HTML único permite seleccionar respuestas desde el inventario");
  assert.match(standalone, /function playVideoAsset/, "el HTML único reproduce vídeos desbloqueados por Quiz");
  assert.match(standalone, /fixture-password-quiz/, "el HTML autónomo conserva los retos del proyecto");
  assert.match(standalone, /\.quiz-box/, "la exportación incorpora el estilo de las cajas posicionables de Quiz");
  assert.match(standalone, /incorrectOutcome/, "la exportación conserva consecuencias para respuestas incorrectas");
  assert.match(standalone, /quizFailureCounts/, "el juego exportado cuenta los fallos de cada reto");
  assert.match(standalone, /feedback\.canRetry/, "el juego exportado conserva el control de reintentos");
  assert.match(standalone, /\.quiz-answer-box\.has-quiz-animation-shake/, "el juego exportado conserva el efecto visual de animación de Quiz");
  assert.match(standalone, /@keyframes quiz-shake/, "el juego exportado incluye la animación de sacudida");
  assert.doesNotMatch(standalone, /Respuesta correcta\.|La respuesta no es correcta\. Inténtalo de nuevo\.|Respuesta incorrecta\./, "el juego no muestra mensajes literales genéricos de acierto o error");
  assert.match(standalone, /video-playback-panel/, "el HTML único contiene el panel de reproducción de vídeo");
  assert.doesNotMatch(standalone, /key: "combine",\s*enabled:[\s\S]{0,160}?label: `Combinar/, "el HTML único no pinta el icono de combinar en las imágenes");
  assert.doesNotMatch(standalone, /Mapa abierto\./, "el juego no anuncia un estado innecesario del mapa");
  assert.match(standalone, /function startLayerTransition/);
  assert.match(standalone, /object-action-icons/, "the standalone game renders enabled object actions on images");
  assert.match(standalone, /object-action-icon/, "the standalone HTML includes styling for object action icons");
assert.match(standalone, /ensurePencilPanelSections/, "el reproductor autónomo crea el panel separado de pistas y notas");
assert.match(standalone, /ensureMapPanel/, "el reproductor autónomo prepara el panel para mapas");
  assert.match(standalone, /collectLayerClues/, "el reproductor autónomo recoge pistas al pulsar la lupa");
assert.match(standalone, /initializePencilNotesEditor/, "el reproductor autónomo monta Quill en el panel del lápiz");
assert.match(standalone, /id\s*=\s*"pencil-toggle"/, "el reproductor autónomo crea el icono de lápiz si falta en el HTML");
assert.match(standalone, /id\s*=\s*"map-toggle"/, "el reproductor autónomo crea el icono de mapa si falta en el HTML");
assert.match(standalone, /escena-viva:map-toggle/, "el reproductor autónomo emite el evento del mapa");
  assert.match(standalone, /id="inventory-toggle"[^>]*aria-controls="inventory-panel"/, "el HTML autónomo mantiene el icono vinculado al panel");
  assert.match(standalone, /id="inventory-panel"[^>]*aria-hidden="true" hidden/, "el panel autónomo empieza colapsado");
  assert.match(standalone, /\.inventory-toggle\s*\{[^}]*width:\s*clamp\(2\.475rem,\s*4\.8vw,\s*3\.3rem\)/, "el HTML autónomo incluye el icono reducido");
  assert.match(standalone, inventoryClearanceRule, "el panel autónomo reserva espacio para el botón y admite desplazamiento");
  assert.match(standalone, /inventoryPanel\.hidden = !open/, "el icono alterna el panel del inventario");
assert.match(standalone, /function renderInventoryGrid/, "el HTML autónomo construye las casillas configuradas para el inventario");
assert.match(standalone, /inventory-grid-slot/, "el HTML autónomo representa las casillas del inventario");
  assert.match(standalone, /class InventoryState/, "el HTML autónomo incluye la gestión del inventario");
  assert.match(standalone, /class PlayerCharacterState/, "el HTML autónomo incorpora el estado de personaje");
  assert.match(standalone, /id="character-setup-dialog"/, "el HTML autónomo incorpora el formulario de alta de personaje");
  assert.match(standalone, /function renderCharacterSetup/, "el juego exportado permite distribuir los puntos iniciales");
  assert.match(standalone, /function renderPlayerCharacterPanel/, "el juego exportado incluye la ficha visible del jugador");
  assert.match(standalone, /roundAttributeEffects/, "el juego exportado aplica cambios de atributos durante las rondas");
  assert.match(standalone, /victoryReward/, "el juego exportado aplica recompensas por victoria");
  assert.match(standalone, /No queda sitio en el inventario\. Libera espacio retirando un objeto\./, "el juego autónomo avisa al llenar el inventario");
  assert.match(standalone, /inventory-item-remove/, "el juego autónomo permite liberar una casilla");
  assert.match(standalone, /inventory-item-add/, "el inventario ofrece el botón para iniciar una combinación");
  assert.match(standalone, /completeInventoryCombination/, "el juego autónomo procesa combinaciones de inventario");
  assert.match(standalone, /inventory-item-sound/, "el inventario muestra los resultados de tipo sonido");
  assert.match(standalone, /class CombinationRules/, "el HTML autónomo incluye el motor de recetas");
  assert.ok(standalone.includes('"unique":true'), "el HTML autónomo conserva la marca Único");
  assert.match(standalone, /escena-viva:inventory-toggle/, "el HTML autónomo emite el evento de alternancia del inventario");
assert.match(standalone, /escena-viva:pencil-toggle/, "el HTML autónomo emite el evento separado de pistas y notas");
  assert.match(standalone, /escena-viva:inventory-open/, "el juego autónomo emite el evento para activar el inventario");
  assert.match(standalone, /escena-viva:inventory-close/, "el juego autónomo emite el evento al cerrar el inventario");
  assert.match(standalone, /escena-viva:object-action/, "the standalone game emits object-action events");
  assert.match(standalone, /combinableWithLayerIds/, "the standalone game exposes object compatibility in action events");
  assert.match(standalone, /combinableWithResourceIds/, "the standalone game exposes compatible image and sound resources");
  assert.ok(standalone.includes('"inventoryEnabled":true'), "the standalone game preserves the inventory mark");
  assert.ok(standalone.includes('"combinableEnabled":true'), "the standalone game preserves the combinable mark");
  assert.ok(standalone.includes('"combinableWithLayerIds":["layer-2"]'), "the standalone game preserves compatible image IDs");
  assert.ok(standalone.includes('"combinableWithResourceIds":["sound-1"]'), "the standalone game preserves compatible resource IDs");
  assert.ok(standalone.includes('"combinationResultAssetId":"sound-1"'), "the standalone game preserves the recipe result");
  assert.ok(standalone.includes('"clueEnabled":true'), "the standalone game preserves the image clue mark");
  assert.ok(standalone.includes('"inventoryHintCapacity":15'), "the standalone game preserves the clue space count");
  assert.ok(standalone.includes("No beber esta pócima"), "the standalone game preserves authored clue text");
  assert.match(standalone, /scene-fade-through/, "el HTML autónomo incluye animaciones para las transiciones");
  assert.ok(standalone.includes('"transitionType":"fade-black"'), "el HTML autónomo conserva la transición temporizada");
  assert.doesNotMatch(standalone, /<link rel="stylesheet"/);
  assert.ok(standalone.includes('class="engine-attribution"'), "el HTML único mantiene accesibles los avisos de Crowther");
  assert.ok(standalone.includes("GNU GENERAL PUBLIC LICENSE") && standalone.includes("Version 3, 29 June 2007"),
    "el HTML único incluye el texto completo de GPLv3");
  assert.ok(standalone.includes("EXCEPCIÓN DE LICENCIA DEL RUNTIME DE CROWTHER PARA AVENTURAS"),
    "el HTML único permite identificar la excepción del runtime");

  const packageBlob = await PlayableHtmlExporter.buildHostingPackage(project);
  const files = readStoredZip(new Uint8Array(await packageBlob.arrayBuffer()));
  const expectedAssetPath = "assets/images/001-fondo-n.svg";
  const expectedSoundPath = "assets/audio/001-oleaje.mp3";
  const expectedVideoPath = "assets/videos/001-intro.mp4";
    ["index.html", "playable.css", "vendor/quill/quill.snow.css", "vendor/quill/quill.min.js", "vendor/quill/LICENSE", "LICENSE", "COPYRIGHT-ATTRIBUTION.txt", "RUNTIME-LICENSE-EXCEPTION.txt", "js/playable-main.js", "js/playable-runtime.js", "js/inventory.js", "js/character-state.js", "data/project.json", expectedAssetPath, expectedSoundPath, expectedVideoPath, "LEEME.txt"]
    .forEach((name) => assert.ok(files.has(name), `el ZIP contiene ${name}`));
  assert.equal(new TextDecoder().decode(files.get(expectedAssetPath)), imageContents);
  assert.equal(new TextDecoder().decode(files.get(expectedSoundPath)), "mp3-audio-data");
  assert.equal(new TextDecoder().decode(files.get(expectedVideoPath)), "mp4-video-data");

  const packageHtml = new TextDecoder().decode(files.get("index.html"));
  assert.match(packageHtml, /href="\.\/playable\.css"/);
  assert.match(packageHtml, /href="\.\/vendor\/quill\/quill\.snow\.css"/);
  assert.match(packageHtml, /src="\.\/vendor\/quill\/quill\.min\.js"/);
  assert.match(packageHtml, /src="\.\/js\/playable-main\.js"/);
  assert.match(packageHtml, /href="\.\/LICENSE"/);
  assert.match(packageHtml, /href="\.\/COPYRIGHT-ATTRIBUTION\.txt"/);
  assert.match(packageHtml, /href="\.\/RUNTIME-LICENSE-EXCEPTION\.txt"/);
  const exportedLicense = new TextDecoder().decode(files.get("LICENSE"));
  const exportedAttribution = new TextDecoder().decode(files.get("COPYRIGHT-ATTRIBUTION.txt"));
  const exportedRuntimeException = new TextDecoder().decode(files.get("RUNTIME-LICENSE-EXCEPTION.txt"));
  assert.ok(exportedLicense.startsWith("GNU GENERAL PUBLIC LICENSE\nVersion 3"), "el ZIP incorpora GPLv3 completa");
  assert.ok(exportedAttribution.includes("© Jacobo Feijóo") && exportedAttribution.includes("sección 7(b)"),
    "el ZIP incorpora la condición de atribución");
  assert.ok(exportedRuntimeException.includes("licencia") && exportedRuntimeException.includes("creador"),
    "el ZIP incorpora la excepción para licenciar cada aventura");
  assert.match(packageHtml, /id="dialogues" class="dialogue-layer"/);
  assert.match(packageHtml, /id="canvas-columns" class="canvas-columns"/);
  assert.match(packageHtml, /id="inventory-toggle"[^>]*aria-controls="inventory-panel"/, "el paquete de hosting mantiene el icono vinculado al panel");
  assert.match(packageHtml, /id="inventory-panel"[^>]*aria-hidden="true" hidden/, "el panel del paquete empieza colapsado");
  assert.doesNotMatch(packageHtml, /id="escena-viva-project"/);
  const packageData = JSON.parse(new TextDecoder().decode(files.get("data/project.json")));
  const packageCss = new TextDecoder().decode(files.get("playable.css"));
  const packageQuillCss = new TextDecoder().decode(files.get("vendor/quill/quill.snow.css"));
  const packageRuntime = new TextDecoder().decode(files.get("js/playable-runtime.js"));
  const packageInventory = new TextDecoder().decode(files.get("js/inventory.js"));
  assert.equal(packageData.scenes[0].combatChallenges[0].id, "fixture-combat", "el paquete de hosting conserva la definición de combate");
  assert.match(packageData.scenes[0].combatChallenges[0].attributes[0].name, /Fuerza/);
  assert.equal(packageData.scenes[0].combatChallenges[0].victoryCondition.playerTerms[1].value, 15,
    "el paquete conserva la condición de victoria compuesta a partir de datos de un proyecto anterior");
  assert.match(packageRuntime, /function playVideoCue/, "el reproductor exportado puede reproducir vídeos asociados");
  assert.match(packageRuntime, /function playCombatRound/, "el reproductor exportado calcula las rondas de combate");
  assert.match(packageRuntime, /function evaluateCombatTerms/, "el reproductor exportado interpreta condiciones de combate con varios términos");
  assert.match(packageRuntime, /function appendCombatPreview/, "el reproductor exportado representa ambos combatientes");
  assert.match(packageRuntime, /function renderAdventureMap/, "el paquete web renderiza la imagen de mapa y sus destinos");
  assert.match(packageRuntime, /sceneByModuleNumber/, "el juego exportado resuelve los destinos de mapa por módulo");
  assert.match(packageRuntime, /action\.key === "map"/, "el icono Mapa desbloquea los destinos del módulo actual");
  assert.match(packageRuntime, /runtime\.mapCellImages\.set\(key, layer\.assetId\)/, "el icono añade su ilustración a una casilla concreta");
  assert.match(packageRuntime, /mapCellKey\(cell\) === String\(layer\.mapCellKey \|\| ""\)/, "la versión exportada usa la casilla seleccionada y no deduce la primera del módulo");
  assert.match(packageRuntime, /runtime\.unlockedMapCells\.has\(key\)/, "el paquete controla la disponibilidad por coordenada");
  assert.match(packageRuntime, /mapCellNotes:\s*new Map\(\)/, "el paquete conserva las notas por casilla mientras dura la partida");
  assert.match(packageRuntime, /function saveMapCellNote[\s\S]*runtime\.mapCellNotes\.set/, "el paquete permite guardar y editar las notas del mapa");
  assert.match(packageRuntime, /data-map-note-action/, "el paquete dibuja los controles de notas en las ilustraciones");
  assert.match(packageRuntime, /artFrame\.append\(noteActions\)[\s\S]*cellElement\.append\(artFrame\)/, "el juego exportado ancla los controles a la ilustración visible");
  assert.match(packageRuntime, /mapAsset\?\.dataUrl && !\[\.\.\.runtime\.mapCellImages\.values\(\)\]\.includes\(mapAsset\.id\)/,
    "una ilustración descubierta no se escala también como fondo de todo el mapa");
  assert.doesNotMatch(packageRuntime, /key: "combine",\s*enabled:[\s\S]{0,160}?label: `Combinar/, "el juego exportado no pinta el icono de combinar en las imágenes");
  assert.doesNotMatch(packageRuntime, /Mapa abierto\./, "el juego publicado no anuncia un estado innecesario del mapa");
  assert.match(packageCss, /scene-fade-through/, "el paquete web incluye los estilos de transición");
  assert.match(packageCss, /\.stage-background\s*\{[^}]*object-fit:\s*cover[^}]*pointer-events:\s*none/, "el paquete web incluye el fondo fijo adaptable al lienzo");
  assert.match(packageCss, /\.inventory-toggle\s*\{[^}]*width:\s*clamp\(2\.475rem,\s*4\.8vw,\s*3\.3rem\)/, "el paquete web incluye el icono reducido");
assert.match(packageCss, /\.pencil-toggle\s*\{[^}]*width:\s*clamp\(2\.475rem,\s*4\.8vw,\s*3\.3rem\)/, "el paquete web añade el icono de lápiz del mismo tamaño");
assert.match(packageCss, /\.map-toggle\s*\{[^}]*width:\s*clamp\(2\.475rem,\s*4\.8vw,\s*3\.3rem\)/, "el paquete web añade el icono del mapa del mismo tamaño");
assert.match(packageCss, /\.map-panel\s*\{[^}]*inset:\s*8% 8%/, "el paquete web incluye el panel del mapa");
assert.match(packageCss, /\.map-panel-cell-image\s*\{[^}]*object-fit:\s*contain/, "el paquete web limita cada ilustración descubierta a su casilla");
assert.match(packageCss, /\.map-panel-cell-art\s*\{[^}]*top:\s*50%[^}]*left:\s*50%[^}]*transform:\s*translate\(-50%,\s*-50%\)/, "el paquete web centra el marco de la ilustración dentro de su casilla");
assert.match(packageCss, /\.map-note-overlay\s*\{[^}]*position:\s*absolute[^}]*z-index:\s*4/, "el paquete exportado muestra el editor sobre el mapa");
assert.match(packageCss, /\.combat-box\s*\{/, "el paquete de hosting incluye el estilo de combate");
assert.match(packageCss, /\.map-cell-note-action\.is-delete/, "el paquete exportado da estilo al control para borrar notas");
assert.match(packageCss, /\.pencil-panel\s*\{[^}]*inset:\s*0 0 0 auto[^}]*overflow-y:\s*auto/, "el panel de notas exportado ocupa el lado opuesto");
  assert.match(packageCss, inventoryClearanceRule, "el CSS del paquete conserva la separación del inventario");
  assert.match(packageCss, /object-action-icon/, "el paquete web incluye estilos para los iconos de objetos");
  assert.match(packageCss, /\.inventory-clue-slot/, "el paquete web incluye estilos para copiar pistas");
  assert.match(packageQuillCss, /\.ql-toolbar/, "el paquete web incluye el tema Snow local de Quill");
  assert.match(packageRuntime, /function startLayerTransition/, "el paquete web incluye el reproductor de transiciones");
assert.match(packageRuntime, /function renderInventoryGrid/, "el reproductor del paquete crea la cuadrícula configurada del inventario");
assert.match(packageRuntime, /inventory-grid-slot/, "el reproductor del paquete representa las casillas del inventario");
  assert.match(packageRuntime, /object-action-icons/, "el reproductor del paquete pinta los iconos del objeto");
assert.match(packageRuntime, /ensurePencilPanelSections/, "el paquete crea el panel separado de pistas y notas");
assert.match(packageRuntime, /ensureMapPanel/, "el paquete crea el panel para mapas");
assert.match(packageRuntime, /ensureVideoPanel/, "el paquete crea el panel superpuesto de vídeo");
assert.match(packageRuntime, /playSceneVideos/, "el reproductor exportado admite inicio automático del vídeo");
  assert.match(packageRuntime, /collectLayerClues/, "el paquete recoge pistas desde los iconos del escenario");
  assert.match(packageRuntime, /completeInventoryCombination/, "el reproductor del paquete procesa las recetas");
  assert.match(packageRuntime, /CombinationRules\.resolve/, "el reproductor del paquete resuelve la combinación");
  assert.match(packageRuntime, /escena-viva:inventory-open/, "el reproductor del paquete emite el evento para activar el inventario");
  assert.match(packageRuntime, /escena-viva:inventory-toggle/, "el reproductor del paquete emite el evento de alternancia del inventario");
assert.match(packageRuntime, /escena-viva:pencil-toggle/, "el reproductor del paquete emite el evento separado del lápiz");
assert.match(packageRuntime, /escena-viva:map-toggle/, "el reproductor del paquete emite el evento de alternancia del mapa");
  assert.match(packageRuntime, /escena-viva:inventory-close/, "el reproductor del paquete emite el evento al cerrar el inventario");
  assert.match(packageRuntime, /escena-viva:object-action/, "el reproductor del paquete emite los eventos de objeto");
  assert.match(packageRuntime, /escena-viva:sound-action/, "el reproductor del paquete emite el evento al pulsar el icono de sonido");
  assert.match(packageRuntime, /function playSoundCue/, "el reproductor del paquete reproduce sonidos asociados a imágenes");
  assert.match(packageRuntime, /new InventoryState\(\)/, "el reproductor del paquete crea el inventario de partida");
  assert.match(packageInventory, /class InventoryState/, "el paquete incluye el modelo de inventario");
  assert.equal(packageData.notes.html, "<p>Nota del proyecto</p>", "el ZIP conserva las notas del proyecto");
  assert.equal(packageData.adventureMap.size, 2, "el ZIP conserva el tamaño cuadrado del mapa");
  assert.equal(packageData.adventureMap.imageAssetId, "asset-1", "el ZIP conserva la asociación con la ilustración del mapa");
  assert.deepEqual(packageData.adventureMap.cells[0], { row: 1, column: 1, moduleNumber: 45, initiallyUnlocked: true },
    "el ZIP conserva las coordenadas, el módulo y disponibilidad inicial de una casilla");
  assert.equal(packageData.scenes[0].moduleNumber, 100, "el ZIP conserva el número estable de módulo");
  assert.equal(packageData.scenes[0].stage.layers[0].mapEnabled, true, "el ZIP conserva el icono de mapa de una imagen");
  assert.equal(packageData.scenes[0].notes.html, "<p>Nota de escena</p>", "el ZIP conserva las notas de la escena");
  assert.equal(packageData.assets[0].dataUrl, `./${expectedAssetPath}`);
  assert.equal(packageData.soundAssets[0].dataUrl, `./${expectedSoundPath}`);
  assert.match(new TextDecoder().decode(files.get("LEEME.txt")), /assets\/images, assets\/audio, assets\/videos y vendor\/quill/,
    "el LEEME explica la estructura multimedia exportada");
  assert.equal(packageData.soundAssets[0].durationSeconds, 3);
  assert.equal(packageData.soundAssets[0].volumePercent, 30);
  assert.equal(packageData.videoAssets[0].dataUrl, `./${expectedVideoPath}`);
  assert.deepEqual(packageData.scenes[0].videoCues, [{
    id: "video-cue-1",
    videoId: "video-1",
    durationSeconds: 5,
    volumePercent: 45,
    imageLayerId: "layer-1",
    playOnStart: false,
  }], "el ZIP conserva ajustes de reproducción y asociación del vídeo");
  assert.deepEqual(packageData.scenes[0].soundCues, [{
    id: "sound-cue-1",
    soundId: "sound-1",
    durationSeconds: 3,
    volumePercent: 30,
    imageLayerId: "layer-1",
  }], "el ZIP conserva los ajustes de sonido y su asociación a una imagen");
  assert.equal(packageData.scenes[0].name, "Inicio");
  assert.deepEqual(packageData.scenes[0].quizChallenges[0].questionPlacement, { xPct: 50, yPct: 24, widthPct: 66, heightPct: 18 }, "el paquete para hosting conserva la colocación de la pregunta de Quiz");
  assert.deepEqual(packageData.scenes[0].quizChallenges[0].answerPlacement, { xPct: 50, yPct: 72, widthPct: 70, heightPct: 26 }, "el paquete para hosting conserva la colocación de la respuesta de Quiz");
  assert.equal(packageData.scenes[0].quizChallenges[0].incorrectOutcome.animationType, "shake", "el paquete conserva la consecuencia de respuesta incorrecta");
  assert.equal(packageData.scenes[0].quizChallenges[0].maxRetries, 2, "el paquete conserva el límite de reintentos configurado");
  assert.deepEqual(
    [packageData.scenes[0].stage.layers[0].inventoryEnabled, packageData.scenes[0].stage.layers[0].combinableEnabled, packageData.scenes[0].stage.layers[0].unique],
    [true, true, true],
    "the hosting package preserves object action marks",
  );
  assert.deepEqual(packageData.scenes[0].stage.layers[0].combinableWithLayerIds, ["layer-2"],
    "the hosting package preserves legacy object compatibility references");
  assert.deepEqual(packageData.scenes[0].stage.layers[0].combinableWithResourceIds, ["sound-1"],
    "the hosting package preserves compatible resource IDs");
  assert.equal(packageData.scenes[0].stage.layers[0].combinationResultAssetId, "sound-1",
    "the hosting package preserves the configured combination result");
  assert.equal(packageData.scenes[0].timedCues[0].transitionDurationMs, 2000, "el paquete web conserva la duración de transición");
  assert.equal(packageData.scenes[0].timedCues[0].transitionType, "fade-black", "el paquete web conserva el tipo de transición");

  const imageBlobUrl = URL.createObjectURL(new Blob([imageBytes], { type: "image/svg+xml" }));
  const soundBlobUrl = URL.createObjectURL(new Blob(["mp3-audio-data"], { type: "audio/mpeg" }));
  try {
    const blobUrlProject = {
      ...project,
      assets: project.assets.map((asset) => ({ ...asset, dataUrl: imageBlobUrl })),
      soundAssets: project.soundAssets.map((asset) => ({ ...asset, dataUrl: soundBlobUrl })),
    };
    const blobStandalone = await PlayableHtmlExporter.build(blobUrlProject);
    assert.match(blobStandalone, /data:image\/svg\+xml;base64,/, "el HTML único convierte URLs temporales en recursos autónomos");
    const blobPackage = readStoredZip(new Uint8Array(await (await PlayableHtmlExporter.buildHostingPackage(blobUrlProject)).arrayBuffer()));
    assert.equal(new TextDecoder().decode(blobPackage.get(expectedAssetPath)), imageContents,
      "el ZIP lee imágenes guardadas como blobs y las coloca en assets/images");
    assert.equal(new TextDecoder().decode(blobPackage.get(expectedSoundPath)), "mp3-audio-data",
      "el ZIP lee sonidos guardados como blobs y los coloca en assets/audio");
  } finally {
    URL.revokeObjectURL(imageBlobUrl);
    URL.revokeObjectURL(soundBlobUrl);
  }
  assert.deepEqual(packageData.scenes[0].dialogueStyle,
    { textColor: "#ffeecc", fontFamily: "Georgia, serif", fontSizePx: 24 },
    "el paquete conserva la tipografía del diálogo");
  assert.deepEqual(packageData.scenes[0].decisions.style,
    { textColor: "#ffffff", fontFamily: "Arial, sans-serif", fontSizePx: 18 },
    "el paquete conserva la tipografía de las decisiones");
  assert.deepEqual(packageData.scenes[0].canvasStyle,
    { backgroundColor: "#203040", backgroundImageAssetId: "asset-1", columns: 3, gapPx: 36, columnBorders: [true, false, true] },
    "el paquete de hosting conserva la maquetación visual por escena");
  assert.equal(packageData.scenes[0].dialogues.length, 2, "all dialogue boxes remain in the hosting package");
  assert.equal(packageData.scenes[0].decisions.choices[0].labelText.html, "<p><strong>Abrir la puerta</strong></p>",
    "el paquete de hosting conserva el formato enriquecido de las decisiones");

  console.log("PASS: HTML único autocontenido y ZIP de hosting con código, datos y recurso verificados.");
} finally {
  globalThis.fetch = nativeFetch;
}
