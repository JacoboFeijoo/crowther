import assert from "node:assert/strict";
import { Decision, DecisionPanel, ImageAsset, ImageLayer, MAP_GRID_MAX_SIZE, MAP_GRID_PRESETS, Project, QuizChallenge, SceneModule, SoundAsset, VideoAsset, TimedCue, createStarterProject } from "../js/model.js";
import { ScenePlayer } from "../js/player.js";
import { CombinationRules, InventoryState } from "../js/inventory.js";
import { readProjectWorkspace, writeProjectWorkspace } from "../js/workspace-state.js";
import { InteractiveFictionEditor } from "../js/editor.js";

globalThis.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 };
globalThis.DOMParser = class {
  parseFromString() {
    return { body: { childNodes: [] } };
  }
};
globalThis.document = {
  createElement() {
    return { innerHTML: "", append() {} };
  },
  createTextNode(textContent) {
    return { nodeType: Node.TEXT_NODE, textContent };
  },
};

function makeProject() {
  const scenes = [1, 2, 3, 4].map((number) => new SceneModule({ id: `scene-${number}`, name: `Módulo ${number}` }));
  return new Project({
    version: 3,
    startSceneId: "scene-1",
    scenes,
    assets: [new ImageAsset({ id: "shared-image", name: "Compartida" })],
    main: {
      id: "main",
      type: "main",
      name: "main",
      children: scenes.map((scene, index) => ({ id: `ref-${index + 1}`, type: "scene", sceneId: scene.id })),
    },
  });
}

const uniqueLayer = new ImageLayer({ id: "unique-coin", assetId: "coin-asset", unique: true });
assert.equal(new ImageLayer(uniqueLayer.toJSON()).unique, true, "la marca Único se serializa y se recupera");
const mappedLayer = new ImageLayer({ id: "map-icon-layer", assetId: "map-art", mapEnabled: true });
assert.equal(new ImageLayer(mappedLayer.toJSON()).mapEnabled, true, "el icono de mapa de una imagen se conserva en la capa");

const gameInventory = new InventoryState();
assert.equal(gameInventory.add("coin-asset", { capacity: 2 }).reason, "added", "el inventario añade la primera unidad en una casilla libre");
assert.equal(gameInventory.add("coin-asset", { capacity: 2 }).item.quantity, 2, "las copias de la misma imagen se apilan");
assert.equal(gameInventory.add("key-asset", { unique: true, capacity: 2 }).reason, "added", "un objeto único puede ocupar una casilla");
assert.equal(gameInventory.add("key-asset", { unique: true, capacity: 2 }).reason, "unique", "un objeto único no se duplica");
assert.equal(gameInventory.add("potion-asset", { capacity: 2 }).reason, "full", "el inventario avisa cuando todas las casillas están ocupadas");
assert.equal(gameInventory.remove("coin-asset").quantity, 2, "retirar un objeto libera su casilla y quita su pila completa");
assert.equal(gameInventory.add("potion-asset", { capacity: 2 }).reason, "added", "una casilla liberada vuelve a estar disponible");
assert.equal(gameInventory.addClue("clue-1", "No beber esta pócima", { capacity: 2 }).reason, "added", "el inventario recoge una pista en un espacio libre");
assert.equal(gameInventory.addClue("clue-1", "No beber esta pócima", { capacity: 2 }).reason, "duplicate", "la misma pista no se duplica al pulsar de nuevo su icono");
assert.equal(gameInventory.addClue("clue-2", "La llave está oxidada", { capacity: 2 }).reason, "added", "el inventario admite pistas distintas");
assert.equal(gameInventory.addClue("clue-3", "El tercer indicio", { capacity: 2 }).reason, "full", "el inventario informa cuando se llenan los espacios de pistas");
gameInventory.setNotes("<p>Revisar el cajón</p>");
assert.equal(gameInventory.notesHtml, "<p>Revisar el cajón</p>", "las notas libres permanecen en el estado actual de la partida");
gameInventory.clear();
assert.deepEqual(gameInventory.clues, [], "reiniciar la partida también vacía las pistas recogidas");
assert.equal(gameInventory.notesHtml, "", "reiniciar la partida también vacía las notas del jugador");

const project = makeProject();
const starterProject = createStarterProject();
assert.deepEqual(starterProject.getAssetsForScene(starterProject.startSceneId).map((asset) => asset.id), ["asset_harbour"]);
const module2 = project.getModuleReferenceForScene("scene-2");
const module3 = project.getModuleReferenceForScene("scene-3");
const module4 = project.getModuleReferenceForScene("scene-4");
assert.equal(project.moveModule(module3.id, module2.id), true, "a module can be nested under another module");
assert.equal(project.findTreeNode(module3.id).parent.id, module2.id, "the nested parent is retained in the tree");
assert.equal(project.findTreeNode(module4.id).parent.id, "main", "a sibling can remain under main");
assert.equal(project.moveModule(module2.id, module3.id), false, "a module cannot be moved into its own descendant");

const roundTrip = Project.fromJSON(project.toJSON());
assert.equal(roundTrip.getModuleReferenceForScene("scene-3").children.length, 0);
assert.equal(roundTrip.findTreeNode(roundTrip.getModuleReferenceForScene("scene-3").id).parent.id,
  roundTrip.getModuleReferenceForScene("scene-2").id, "nested module ownership survives serialization");
assert.equal(roundTrip.version, 33, "el formato del proyecto conserva ficha, perfiles y fondos por caja");
const perBoxBackgroundProject = new Project({
  scenes: [new SceneModule({
    id: "per-box-background",
    dialogues: [
      { id: "transparent-dialogue", backgroundColor: "transparent" },
      { id: "opaque-dialogue" },
    ],
    decisions: { choices: [
      { id: "transparent-choice", backgroundColor: "transparent" },
      { id: "opaque-choice" },
    ] },
  })],
});
const perBoxBackgroundRoundTrip = Project.fromJSON(perBoxBackgroundProject.toJSON());
const perBoxScene = perBoxBackgroundRoundTrip.getScene("per-box-background");
assert.equal(perBoxScene.dialogues[0].backgroundColor, "transparent", "la transparencia queda limitada al diálogo elegido");
assert.equal(perBoxScene.dialogues[1].backgroundColor, null, "los demás diálogos heredan el fondo normal");
assert.equal(perBoxScene.decisions.choices[0].backgroundColor, "transparent", "las decisiones conservan transparencia individual");
assert.equal(perBoxScene.decisions.choices[1].backgroundColor, null, "las demás decisiones mantienen el fondo normal");
const legacyTransparentScene = new SceneModule({
  dialogueStyle: { backgroundColor: "transparent" },
  dialogues: [{ id: "legacy-first" }, { id: "legacy-second" }],
});
assert.equal(legacyTransparentScene.dialogueStyle.backgroundColor, "", "la antigua transparencia global se elimina al migrar");
assert.equal(legacyTransparentScene.dialogues[0].backgroundColor, "transparent", "la migración conserva transparencia en el diálogo inicial seleccionado");
assert.equal(legacyTransparentScene.dialogues[1].backgroundColor, null, "la migración no vuelve transparentes todas las cajas");
const objectAttributeProject = new Project({
  scenes: [new SceneModule({ id: "object-attribute-scene" })],
  assets: [new ImageAsset({
    id: "object-attribute-sword",
    name: "Espada",
    attributes: [{ attributeId: "defense", value: 5 }],
  })],
  objectAttributeDefinitions: [
    { id: "defense", name: "Defensa" },
    { id: "damage", name: "Daño" },
  ],
});
assert.deepEqual(objectAttributeProject.getAsset("object-attribute-sword").attributes, [{ attributeId: "defense", value: 5 }], "los valores numéricos se asocian al recurso de imagen");
assert.equal(objectAttributeProject.addObjectAttribute("defensa").id, "defense", "las definiciones evitan duplicados ignorando mayúsculas y acentos Unicode");
const poisonAttribute = objectAttributeProject.addObjectAttribute("Veneno");
assert.ok(poisonAttribute?.id, "el diseñador puede añadir atributos globales con identidad estable");
objectAttributeProject.getAsset("object-attribute-sword").attributes.push({ attributeId: poisonAttribute.id, value: 10 });
assert.equal(objectAttributeProject.renameObjectAttribute("damage", "Daño físico"), true, "una definición se puede renombrar sin perder sus valores");
const objectAttributeRoundTrip = Project.fromJSON(objectAttributeProject.toJSON());
assert.equal(objectAttributeRoundTrip.getAsset("object-attribute-sword").attributes.find((attribute) => attribute.attributeId === poisonAttribute.id).value, 10, "atributos y valores sobreviven al guardar/exportar/importar");
assert.equal(objectAttributeRoundTrip.objectAttributeDefinitions.find((attribute) => attribute.id === "damage").name, "Daño físico", "las definiciones globales se conservan al recargar");
assert.equal(objectAttributeRoundTrip.removeObjectAttribute(poisonAttribute.id).name, "Veneno", "el diseñador puede retirar una definición global");
assert.equal(objectAttributeRoundTrip.getAsset("object-attribute-sword").attributes.some((attribute) => attribute.attributeId === poisonAttribute.id), false, "al borrar una definición también se limpia el valor que usaba esa imagen");
assert.deepEqual(MAP_GRID_PRESETS, [2, 3, 4, 5, 6, 7, 8, 9, 10], "el mapa ofrece tamaños de cuadrícula cuadrados");
assert.equal(MAP_GRID_MAX_SIZE, 10, "la cuadrícula normalizada conserva un tamaño máximo común");
const adventureMapProject = new Project({
  scenes: [
new SceneModule({ id: "map-start", name: "Mapa inicial", moduleNumber: 100, assetIds: ["map-art"], stage: { layers: [new ImageLayer({ id: "map-image-layer", assetId: "map-art", mapEnabled: true, mapCellKey: "2:2" })] } }),
    new SceneModule({ id: "map-destination", name: "Destino", moduleNumber: 45 }),
  ],
  assets: [new ImageAsset({ id: "map-art", name: "Mapa gráfico" })],
  adventureMap: {
    size: 2,
    imageAssetId: "map-art",
    cells: [
      { row: 1, column: 1, moduleNumber: 45, initiallyUnlocked: true },
      { row: 1, column: 2, moduleNumber: 45 },
      { row: 2, column: 1, moduleNumber: 100 },
      { row: 2, column: 2, moduleNumber: 100 },
    ],
  },
});
assert.equal(adventureMapProject.adventureMap.size, 2, "el tamaño cuadrado elegido se guarda en el proyecto");
assert.equal(adventureMapProject.adventureMap.cells.length, MAP_GRID_MAX_SIZE ** 2, "todas las coordenadas posibles tienen una entrada estable");
assert.deepEqual(adventureMapProject.adventureMap.cells[0], { row: 1, column: 1, moduleNumber: 45, initiallyUnlocked: true });
assert.deepEqual(adventureMapProject.adventureMap.cells[1], { row: 1, column: 2, moduleNumber: 45, initiallyUnlocked: false });
const mapRoundTrip = Project.fromJSON(adventureMapProject.toJSON());
assert.equal(mapRoundTrip.adventureMap.imageAssetId, "map-art", "la ilustración general del mapa se conserva al exportar e importar");
assert.equal(mapRoundTrip.adventureMap.cells.find((cell) => cell.row === 2 && cell.column === 1).moduleNumber, 100, "las asignaciones por coordenadas sobreviven a la serialización");
assert.equal(mapRoundTrip.getScene("map-start").stage.layers[0].mapCellKey, "2:2", "la casilla elegida por cada imagen sobrevive a la serialización");
assert.equal(mapRoundTrip.getSceneByModuleNumber(45)?.id, "map-destination", "un módulo asignado puede resolverse por su número estable");
assert.equal(mapRoundTrip.getSceneByModuleNumber(100)?.id, "map-start", "el módulo que activa un icono puede localizar su casilla de mapa");
assert.equal(mapRoundTrip.toJSON().version, 33, "el formato actual conserva mapas, personajes y fondos por caja");

const quizProject = new Project({
  scenes: [
    new SceneModule({
      id: "quiz-start",
      quizChallenges: [
        new QuizChallenge({
          id: "password-quiz",
          name: "Contraseña del puente",
          question: { html: "<p>Dime la contraseña</p>" },
          expectedText: "Amanecer",
          maxRetries: 1,
          outcome: { type: "dialogue", text: { html: "<p>La puerta se abre.</p>" } },
          incorrectOutcome: { type: "animation", animationType: "shake", animationDurationMs: 650 },
        }),
        new QuizChallenge({
          id: "scene-quiz",
          question: { html: "<p>Di la palabra de paso</p>" },
          expectedText: "luz",
          outcome: { type: "scene", sceneId: "quiz-destination" },
        }),
        new QuizChallenge({
          id: "key-quiz",
          question: { html: "<p>Entrégame la llave</p>" },
          answerType: "inventory",
          expectedAssetId: "quiz-key",
          consumeItem: true,
          outcome: { type: "video", videoId: "quiz-video" },
        }),
        new QuizChallenge({
          id: "animation-quiz",
          question: { html: "<p>¿Todo listo?</p>" },
          expectedText: "sí",
          outcome: { type: "animation", animationType: "flash", animationDurationMs: 1200 },
        }),
      ],
      stage: { layers: [new ImageLayer({ id: "quiz-key-layer", assetId: "quiz-key", inventoryEnabled: true })] },
    }),
    new SceneModule({ id: "quiz-destination", name: "Sala secreta" }),
  ],
  assets: [new ImageAsset({ id: "quiz-key", name: "Llave" })],
  videoAssets: [new VideoAsset({ id: "quiz-video", name: "Vídeo desbloqueado" })],
});
const quizRoundTrip = Project.fromJSON(quizProject.toJSON());
assert.deepEqual(quizRoundTrip.scenes[0].quizChallenges.map((challenge) => challenge.id), ["password-quiz", "scene-quiz", "key-quiz", "animation-quiz"], "los retos se guardan en el módulo y conservan su orden");
assert.equal(quizRoundTrip.scenes[0].quizChallenges[0].name, "Contraseña del puente", "el nombre personalizado de un reto sobrevive exportar e importar");
assert.equal(quizRoundTrip.scenes[0].quizChallenges[0].question.dir, "auto", "la configuración lingüística de la pregunta sobrevive exportar e importar");
assert.deepEqual(quizRoundTrip.scenes[0].quizChallenges[0].questionPlacement.toJSON(), { xPct: 50, yPct: 28, widthPct: 76, heightPct: 20 }, "la posición y tamaño de la caja de pregunta se guardan");
assert.deepEqual(quizRoundTrip.scenes[0].quizChallenges[0].answerPlacement.toJSON(), { xPct: 50, yPct: 70, widthPct: 76, heightPct: 28 }, "la posición y tamaño de la caja de respuesta se guardan");
assert.equal(quizRoundTrip.scenes[0].quizChallenges[2].expectedAssetId, "quiz-key", "la respuesta de inventario queda vinculada al objeto correcto");
assert.equal(quizRoundTrip.scenes[0].quizChallenges[0].outcome.type, "dialogue", "un diálogo enriquecido es una consecuencia válida");
assert.equal(quizRoundTrip.scenes[0].quizChallenges[0].incorrectOutcome.animationType, "shake", "la consecuencia de error también se exporta");
assert.equal(quizRoundTrip.scenes[0].quizChallenges[0].maxRetries, 1, "el número de reintentos permitidos se guarda y recupera");
assert.equal(quizRoundTrip.scenes[0].quizChallenges[1].outcome.type, "scene", "se puede configurar el desbloqueo de un módulo");
assert.equal(quizRoundTrip.scenes[0].quizChallenges[3].outcome.animationType, "flash", "el tipo y duración de la animación se serializan");
const unmarkedQuizImage = new ImageAsset({ id: "quiz-new-image", name: "Imagen recién añadida" });
const quizObjectChoices = InteractiveFictionEditor.prototype.getQuizInventoryAssets.call({
  project: {
    assets: [...quizRoundTrip.assets, unmarkedQuizImage],
    scenes: [{ id: "quiz-start", name: "Módulo de prueba", moduleNumber: 1, stage: { layers: [new ImageLayer({ assetId: unmarkedQuizImage.id })] } }],
  },
});
assert.equal(quizObjectChoices.some((candidate) => candidate.asset.id === unmarkedQuizImage.id && !candidate.collectible), true, "Quiz lista también las imágenes nuevas sin marca de Inventario");
const quizPlayer = new ScenePlayer(quizRoundTrip);
quizPlayer.start("quiz-start");
assert.equal(quizPlayer.answerQuiz("password-quiz", { text: "incorrecta" }).ok, false, "una respuesta textual incorrecta no completa el reto");
assert.deepEqual(quizPlayer.state.quizFeedback, { quizId: "password-quiz", result: "incorrect", canRetry: true, failedAttempts: 1, maxRetries: 1, retriesRemaining: 1 }, "al fallar se muestra la consecuencia y el reintento restante");
assert.equal(quizPlayer.isQuizCompleted("password-quiz"), false, "la consecuencia incorrecta permite reintentar");
quizPlayer.continueQuiz();
assert.equal(quizPlayer.answerQuiz("password-quiz", { text: "amanecer" }).ok, true, "la contraseña se valida sin distinguir mayúsculas");
assert.deepEqual(quizPlayer.state.quizFeedback, { quizId: "password-quiz", result: "correct" }, "al acertar se muestra el resultado del reto actual");
assert.equal(quizPlayer.state.quizChallenges[0].outcome.type, "dialogue", "el resultado de diálogo llega al jugador");
quizPlayer.continueQuiz();
assert.equal(quizPlayer.answerQuiz("scene-quiz", { text: "LUZ" }).ok, true, "el segundo reto puede desbloquear otro módulo");
assert.equal(quizPlayer.unlockedQuizSceneIds.has("quiz-destination"), true, "la consecuencia de desbloqueo se registra en la partida");
quizPlayer.continueQuiz();
quizPlayer.inventory.add("quiz-key", { capacity: 2 });
assert.equal(quizPlayer.answerQuiz("key-quiz", { assetId: "quiz-key" }).ok, true, "la respuesta de objeto valida la selección del inventario");
assert.equal(quizPlayer.inventory.items.some((item) => item.assetId === "quiz-key"), false, "la casilla Retirar objeto consume el objeto solo al acertar");
assert.equal(quizPlayer.unlockedQuizVideoIds.has("quiz-video"), true, "el vídeo configurado queda desbloqueado tras resolver la pregunta");
quizPlayer.continueQuiz();
assert.equal(quizPlayer.answerQuiz("animation-quiz", { text: "sí" }).ok, true, "una respuesta también puede desencadenar una animación");
assert.equal(quizPlayer.isQuizCompleted("animation-quiz"), true, "el reto animado queda resuelto al acertar");
quizPlayer.dispose();
const zeroRetryChallenge = new QuizChallenge({ id: "zero-retry", expectedText: "clave", maxRetries: 0 });
assert.equal(new QuizChallenge().maxRetries, 10, "los retos previos conservan una cantidad amplia de reintentos por defecto");
assert.equal(new QuizChallenge({ maxRetries: -4 }).maxRetries, 0, "el número de reintentos no puede ser negativo");
assert.equal(new QuizChallenge({ maxRetries: 99 }).maxRetries, 10, "el número de reintentos queda limitado a diez");
const zeroRetryPlayer = new ScenePlayer(new Project({
  scenes: [new SceneModule({ id: "zero-retry-scene", quizChallenges: [zeroRetryChallenge] })],
}));
zeroRetryPlayer.start("zero-retry-scene");
assert.equal(zeroRetryPlayer.answerQuiz("zero-retry", { text: "incorrecta" }).ok, false, "un reto admite cero reintentos adicionales");
assert.equal(zeroRetryPlayer.isQuizCompleted("zero-retry"), true, "un primer fallo cierra el reto cuando el límite es cero");
assert.equal(zeroRetryPlayer.answerQuiz("zero-retry", { text: "clave" }).ok, false, "un reto cerrado no permite responder de nuevo");
zeroRetryPlayer.dispose();
const mapDiscoveryPlayer = new ScenePlayer(mapRoundTrip);
assert.deepEqual([...mapDiscoveryPlayer.unlockedMapCells], ["1:1"], "la disponibilidad inicial se guarda por coordenada, no se replica a otras casillas del mismo módulo");
mapDiscoveryPlayer.scene = mapRoundTrip.getScene("map-start");
mapDiscoveryPlayer.isPlaying = true;
const discoveredCell = mapDiscoveryPlayer.activateMapForCurrentScene("map-art", "2:2");
assert.deepEqual([discoveredCell.row, discoveredCell.column], [2, 2], "el icono desbloquea exactamente la casilla elegida por el diseñador");
assert.deepEqual([...mapDiscoveryPlayer.unlockedMapCells].sort(), ["1:1", "2:2"], "las otras casillas del mismo módulo no se activan");
assert.equal(mapDiscoveryPlayer.mapCellImages.get("2:2"), "map-art", "la ilustración queda colocada como miniatura en su casilla asignada");
assert.equal(mapDiscoveryPlayer.mapCellImages.has("2:1"), false, "la miniatura no ocupa otra casilla que llame al mismo módulo");
assert.equal(mapDiscoveryPlayer.setMapCellNote("2:2", "No volver a esta parte del mapa"), true, "el jugador puede anotar una casilla descubierta");
assert.equal(mapDiscoveryPlayer.mapCellNotes.get("2:2"), "No volver a esta parte del mapa", "la nota se guarda por coordenada de casilla");
assert.equal(mapDiscoveryPlayer.setMapCellNote("2:2", "Volver solo con la llave"), true, "una nota de casilla se puede editar");
assert.equal(mapDiscoveryPlayer.mapCellNotes.get("2:2"), "Volver solo con la llave", "la edición reemplaza el texto anterior");
assert.equal(mapDiscoveryPlayer.removeMapCellNote("2:2"), true, "el jugador puede borrar la nota de una casilla");
assert.equal(mapDiscoveryPlayer.mapCellNotes.has("2:2"), false, "borrar una nota no altera la ilustración de su casilla");
assert.equal(mapDiscoveryPlayer.setMapCellNote("invalid", "Nota"), false, "las notas requieren una coordenada de mapa válida");
mapDiscoveryPlayer.setMapCellNote("2:2", "Nota temporal de partida");
mapDiscoveryPlayer.resetMapDiscovery();
assert.deepEqual([...mapDiscoveryPlayer.unlockedMapCells], ["1:1"], "reiniciar la partida restablece solo las casillas iniciales");
assert.equal(mapDiscoveryPlayer.mapCellImages.size, 0, "reiniciar la partida retira las miniaturas descubiertas");
assert.equal(mapDiscoveryPlayer.mapCellNotes.size, 0, "reiniciar la partida también borra las notas de casilla");
const videoScene = new SceneModule({ id: "video-scene", stage: { layers: [{ id: "video-layer", assetId: "poster" }] } });
const videoProject = new Project({ scenes: [videoScene], assets: [new ImageAsset({ id: "poster" })] });
videoProject.addVideoAsset(new VideoAsset({ id: "video-1", name: "intro.mp4", mimeType: "video/mp4", dataUrl: "data:video/mp4;base64,AA==" }), videoScene.id);
Object.assign(videoScene.videoCues[0], { imageLayerId: "video-layer", durationSeconds: 5, volumePercent: 35, playOnStart: true });
const videoRoundTrip = Project.fromJSON(videoProject.toJSON());
assert.equal(videoRoundTrip.getVideoAsset("video-1").name, "intro.mp4", "el recurso de vídeo se conserva en el proyecto");
assert.deepEqual(videoRoundTrip.getScene("video-scene").videoCues[0].toJSON(), {
  id: videoScene.videoCues[0].id,
  name: "",
  videoId: "video-1",
  durationSeconds: 5,
  volumePercent: 35,
  imageLayerId: "video-layer",
  playOnStart: true,
}, "asociación, duración, volumen e inicio automático de vídeo sobreviven a la serialización");
assert.deepEqual(roundTrip.inventoryGrid, { columns: 5, rows: 3 }, "the default inventory shape survives project serialization");
assert.equal(roundTrip.inventoryHintCapacity, 10, "the default clue capacity survives project serialization");
const clueLayer = new ImageLayer({ id: "clue-layer", assetId: "clue-image", clueEnabled: true, clues: [{ id: "warning", text: "No beber esta pócima" }] });
const clueProject = Project.fromJSON(new Project({
  scenes: [new SceneModule({ id: "clue-module", stage: { layers: [clueLayer] } })],
  assets: [new ImageAsset({ id: "clue-image" })],
  inventoryHintCapacity: 15,
}).toJSON());
assert.deepEqual(clueProject.getScene("clue-module").stage.layers[0].clues, [{ id: "warning", text: "No beber esta pócima" }], "pista, texto e imagen se conservan al serializar el proyecto");
assert.equal(clueProject.getScene("clue-module").stage.layers[0].clueEnabled, true, "la marca de pista se conserva en la capa de imagen");
assert.equal(clueProject.inventoryHintCapacity, 15, "la capacidad de pistas elegida sobrevive exportar e importar el proyecto");
assert.equal(new Project({ inventoryHintCapacity: 99 }).inventoryHintCapacity, 10, "una capacidad de pistas desconocida vuelve al valor seguro");
const customInventory = Project.fromJSON(new Project({
  scenes: [new SceneModule({ id: "inventory-grid-scene" })],
  inventoryGrid: { columns: 8, rows: 4 },
}).toJSON());
assert.deepEqual(customInventory.inventoryGrid, { columns: 8, rows: 4 }, "a selected inventory shape survives project export and import");
assert.deepEqual(new Project({ inventoryGrid: { columns: 9, rows: 9 } }).inventoryGrid,
  { columns: 5, rows: 3 }, "unsupported inventory dimensions fall back to the safe default");
assert.deepEqual(roundTrip.scenes[0].canvasStyle, {
  backgroundColor: "#17131b",
  backgroundImageAssetId: null,
  exceptGlobalBackground: false,
  transitionAnimation: "none",
  exceptGlobalTransition: false,
  columns: 1,
  gapPx: 24,
  columnBorders: [false, false, false, false],
}, "scenes without canvas settings receive safe layout defaults");
const styledCanvasScene = new SceneModule({
  id: "canvas-style-scene",
  canvasStyle: { backgroundColor: "#204060", backgroundImageAssetId: "bg-image", columns: 3, gapPx: 48, columnBorders: [true, false, true] },
});
const styledCanvasRoundTrip = Project.fromJSON(new Project({ scenes: [styledCanvasScene] }).toJSON()).scenes[0];
assert.deepEqual(styledCanvasRoundTrip.canvasStyle, {
  backgroundColor: "#204060",
  backgroundImageAssetId: "bg-image",
  exceptGlobalBackground: true,
  transitionAnimation: "none",
  exceptGlobalTransition: false,
  columns: 3,
  gapPx: 48,
  columnBorders: [true, false, true, false],
}, "background, column spacing and independent borders survive project export and import");
assert.deepEqual(new SceneModule({ canvasStyle: { columns: 8, gapPx: 999, backgroundColor: "url(test)" } }).canvasStyle,
  { backgroundColor: "#17131b", backgroundImageAssetId: null, exceptGlobalBackground: false, transitionAnimation: "none", exceptGlobalTransition: false, columns: 4, gapPx: 300, columnBorders: [false, false, false, false] },
  "canvas settings are constrained to supported values");
const backgroundAssetProject = new Project({
  scenes: [new SceneModule({ id: "background-owner", assetIds: ["bg-image"], canvasStyle: { backgroundImageAssetId: "bg-image" } })],
  assets: [new ImageAsset({ id: "bg-image", name: "Fondo" })],
});
assert.equal(backgroundAssetProject.removeAssetFromScene("bg-image", "background-owner"), true, "removing an image from a module does not delete it while it is its canvas background");
assert.ok(backgroundAssetProject.getAsset("bg-image"), "a selected canvas background keeps its resource data");
backgroundAssetProject.removeAsset("bg-image");
assert.equal(backgroundAssetProject.scenes[0].canvasStyle.backgroundImageAssetId, null, "deleting an image clears canvas background references");
const sharedCanvasBackground = Project.fromJSON(new Project({
  canvasBackgroundAllModules: true,
  canvasBackgroundImageAssetId: "shared-bg",
  scenes: [new SceneModule({ id: "shared-scene-1" }), new SceneModule({ id: "shared-scene-2", canvasStyle: { backgroundImageAssetId: "other-bg" } })],
  assets: [new ImageAsset({ id: "shared-bg", name: "Fondo compartido" })],
}).toJSON());
assert.equal(sharedCanvasBackground.scenes[0].canvasStyle.backgroundImageAssetId, null,
  "el fondo compartido se hereda desde el proyecto sin duplicarse en una escena moderna");
assert.equal(sharedCanvasBackground.scenes[0].canvasStyle.exceptGlobalBackground, false,
  "las escenas que heredan el fondo general no se marcan como excepción");
assert.equal(sharedCanvasBackground.scenes[1].canvasStyle.backgroundImageAssetId, "other-bg",
  "la excepción local se conserva al volver a importar el proyecto");
assert.equal(sharedCanvasBackground.scenes[1].canvasStyle.exceptGlobalBackground, true,
  "el proyecto conserva la marca de excepción local");
const futureModule = sharedCanvasBackground.addScene(new SceneModule({ id: "shared-scene-future", dialogues: [] }));
assert.equal(futureModule.dialogues.length, 0, "un módulo nuevo puede crearse sin una caja de diálogo inicial");
assert.equal(futureModule.canvasStyle.backgroundImageAssetId, null, "un módulo nuevo hereda el fondo general sin duplicarlo en su configuración local");
assert.equal(sharedCanvasBackground.canvasBackgroundAllModules, true, "la opción de fondo compartido se conserva en el proyecto");
const mapArtworkProject = new Project({
  scenes: [new SceneModule({ id: "map-art-owner", assetIds: ["map-artwork"] })],
  assets: [new ImageAsset({ id: "map-artwork", name: "Mapa" })],
  adventureMap: { imageAssetId: "map-artwork" },
});
assert.equal(mapArtworkProject.removeAssetFromScene("map-artwork", "map-art-owner"), true, "el mapa puede dejar de estar incrustado en una escena");
assert.ok(mapArtworkProject.getAsset("map-artwork"), "la ilustración general no se borra mientras siga asignada al mapa");
assert.equal(mapArtworkProject.adventureMap.imageAssetId, "map-artwork", "la ilustración del mapa permanece vinculada al proyecto");
mapArtworkProject.removeAsset("map-artwork");
assert.equal(mapArtworkProject.adventureMap.imageAssetId, null, "al borrar explícitamente la ilustración se limpia la referencia del mapa");
assert.equal(roundTrip.notes.html, "", "a project without notes migrates to an empty rich-text block");
assert.equal(roundTrip.scenes[0].notes.html, "", "a scene without notes migrates to an empty rich-text block");
const notesScene = new SceneModule({ id: "notes-scene", notes: { html: "", lang: "es", dir: "ltr" } });
const notedProject = new Project({ notes: { html: "", lang: "ca", dir: "auto" }, scenes: [notesScene] });
const notedRoundTrip = Project.fromJSON(notedProject.toJSON());
assert.equal(notedRoundTrip.notes.lang, "ca", "project note metadata survives export and import");
assert.equal(notedRoundTrip.scenes[0].notes.lang, "es", "scene note metadata survives export and import");
assert.equal(notedRoundTrip.toJSON().scenes[0].notes.dir, "ltr", "scene notes are included in project JSON");
const finalScene = new SceneModule({
  id: "final-scene",
  isFinal: true,
  finalType: "Óptimo",
  dialogueStyle: {
    backgroundColor: "#112233",
    fontFamily: "'Trebuchet MS', Helvetica, sans-serif",
    fontSizePx: 23,
    customCss: ".dialogue-box { border-radius: 1rem; }",
  },
});
assert.equal(finalScene.isFinal, true, "a scene can be marked as final");
assert.equal(finalScene.finalType, "Óptimo", "a final scene retains its selected metric rating");
assert.equal(finalScene.dialogueStyle.backgroundColor, "#112233", "dialogue style can be configured per scene");
assert.equal(finalScene.dialogueStyle.fontFamily, "'Trebuchet MS', Helvetica, sans-serif", "dialogue web font stacks are stored safely");
assert.equal(finalScene.dialogueStyle.fontSizePx, 23, "dialogue font size is stored per scene");
assert.equal(new SceneModule(finalScene.toJSON()).isFinal, true, "final-scene state survives scene serialization");
assert.equal(new SceneModule(finalScene.toJSON()).finalType, "Óptimo", "the final-scene rating survives scene serialization");
assert.equal(Project.fromJSON(new Project({ scenes: [finalScene] }).toJSON()).scenes[0].dialogueStyle.customCss,
  ".dialogue-box { border-radius: 1rem; }", "dialogue CSS survives project export and import");
assert.equal(Project.fromJSON(new Project({ scenes: [finalScene] }).toJSON()).scenes[0].dialogueStyle.fontFamily,
  "'Trebuchet MS', Helvetica, sans-serif", "dialogue typography survives project export and import");
assert.equal(Project.fromJSON(new Project({ scenes: [finalScene] }).toJSON()).scenes[0].finalType, "Óptimo",
  "final-scene state survives project export and import");
assert.equal(new SceneModule({ id: "legacy-final-scene" }).isFinal, false, "older scenes default to not final");
assert.equal(new SceneModule({ id: "legacy-final-scene", finalType: "Imposible" }).finalType, "", "unknown final ratings are ignored");
const notesLegacyProject = Project.fromJSON({ version: 6, scenes: [{ id: "legacy-scene" }] });
assert.equal(notesLegacyProject.notes.html, "", "legacy projects load with empty project notes");
assert.equal(notesLegacyProject.scenes[0].notes.html, "", "legacy scenes load with empty scene notes");
assert.equal(new SceneModule({ name: "Vacío" }).dialogue.speaker, "", "new modules start with an empty speaker");
assert.equal(new SceneModule({ name: "Vacío" }).dialogue.zIndex, 1, "a single dialogue uses the only valid position in an empty stack");
const decisionScene = new SceneModule({
  id: "decision-layout",
  decisions: new DecisionPanel({
    prompt: "¿Qué decides?",
    promptFontSize: 28,
    promptColor: "#cc4455",
    promptPlacement: { xPct: 42, yPct: 58, widthPct: 70 },
    choices: [{ id: "placed-choice", name: "Cruce importante", label: "Cruzar el puente", targetSceneId: "scene-2", placement: { xPct: 35, yPct: 72, widthPct: 45, heightPct: 14 } }],
    style: {
      backgroundColor: "#112233",
      textColor: "#eeeeee",
      accentColor: "#ffcc00",
      borderColor: "#ffffff",
      fontFamily: "Georgia, serif",
      fontSizePx: 19,
      customCss: ".choice-button { letter-spacing: .04em; }",
    },
  }),
});
const decisionProject = new Project({ scenes: [decisionScene] });
const restoredDecision = Project.fromJSON(decisionProject.toJSON()).scenes[0].decisions;
assert.equal(restoredDecision.promptFontSize, 28, "decision prompt font size survives project serialization");
assert.equal(restoredDecision.promptColor, "#cc4455", "decision prompt color survives project serialization");
assert.deepEqual(restoredDecision.promptPlacement.toJSON(), { xPct: 42, yPct: 58, widthPct: 70, heightPct: null },
  "the movable decision prompt position survives project serialization");
assert.deepEqual(restoredDecision.choices[0].placement.toJSON(), { xPct: 35, yPct: 72, widthPct: 45, heightPct: 14 },
  "movable and resizable decision geometry survives project serialization");
assert.equal(restoredDecision.choices[0].targetSceneId, "scene-2", "decision navigation target survives project serialization");
assert.equal(restoredDecision.choices[0].name, "Cruce importante", "the custom decision section title survives project serialization");
assert.equal(restoredDecision.choices[0].label, "Cruzar el puente", "plain decision text remains available to graphs and status messages");
assert.deepEqual(restoredDecision.choices[0].labelText.toJSON(), { html: "", lang: "und", dir: "auto" },
  "legacy decisions acquire a default rich-text block");
assert.equal(restoredDecision.style.customCss, ".choice-button { letter-spacing: .04em; }", "decision CSS survives project serialization");
assert.equal(restoredDecision.style.fontFamily, "Georgia, serif", "decision web font stacks survive project serialization");
assert.equal(restoredDecision.style.fontSizePx, 19, "decision font size survives project serialization");
assert.equal(new SceneModule({ dialogueStyle: { fontFamily: "Arial; color: red" } }).dialogueStyle.fontFamily, "",
  "invalid CSS in a custom font family is rejected");
assert.equal(new SceneModule({ dialogueStyle: { fontSizePx: 120 } }).dialogueStyle.fontSizePx, 96,
  "font sizes are bounded to the supported range");
assert.equal(new SceneModule({ decisions: { choices: [{ id: "named-choice", name: "Entrada secreta" }] } }).decisions.choices[0].name, "Entrada secreta",
  "the custom decision heading is retained in the scene model");
const legacyDecisionPanel = new DecisionPanel({ choices: [{ id: "legacy-a" }, { id: "legacy-b" }] });
assert.notEqual(legacyDecisionPanel.choices[0].placement.yPct, legacyDecisionPanel.choices[1].placement.yPct,
  "older choices receive separate default positions when loaded");
const addedDecision = legacyDecisionPanel.addChoice({ id: "legacy-c" });
assert.equal(legacyDecisionPanel.removeChoice(addedDecision.id), true, "decision panels can add and remove a structured choice");
const noDialogueScene = new SceneModule({ id: "no-dialogue", name: "Escena sin diálogo", dialogues: [] });
assert.equal(noDialogueScene.dialogue, undefined, "an explicit empty dialogue list stays empty");
assert.deepEqual(new SceneModule(noDialogueScene.toJSON()).dialogues, [], "empty dialogue lists survive scene serialization");
assert.equal(noDialogueScene.toJSON().dialogue, null, "the legacy single-dialogue alias is null when there are no dialogue boxes");
const noDialogueProject = Project.fromJSON(new Project({ scenes: [noDialogueScene] }).toJSON());
assert.deepEqual(noDialogueProject.scenes[0].dialogues, [], "empty dialogue scenes survive project import");
const noDialoguePlayer = new ScenePlayer(noDialogueProject);
noDialoguePlayer.start("no-dialogue");
assert.deepEqual(noDialoguePlayer.state.dialogues, [], "preview playback preserves scenes without dialogue");
noDialoguePlayer.dispose();
const legacyStack = new SceneModule({
  stage: { layers: [{ id: "legacy-image-1", zIndex: 1 }, { id: "legacy-image-2", zIndex: 2 }] },
  dialogue: {},
});
assert.deepEqual(legacyStack.stage.layers.map((layer) => layer.zIndex).concat(legacyStack.dialogue.zIndex), [1, 2, 3], "legacy dialogue stays above existing images with contiguous positions");
const markedObjectLayer = new ImageLayer({ id: "marked-object", assetId: "shared-image", inventoryEnabled: true, combinableEnabled: true });
assert.equal(new ImageLayer({ id: "legacy-object" }).inventoryEnabled, false, "legacy image layers default to no inventory action");
const restoredObjectLayer = new ImageLayer(markedObjectLayer.toJSON());
assert.equal(restoredObjectLayer.inventoryEnabled, true, "the inventory mark survives image-layer serialization");
assert.equal(restoredObjectLayer.combinableEnabled, true, "the combinable mark survives image-layer serialization");
assert.deepEqual(restoredObjectLayer.combinableWithLayerIds, [], "object compatibility defaults to an empty list");
const objectSceneRoundTrip = Project.fromJSON(new Project({
  scenes: [new SceneModule({ id: "objects-scene", stage: { layers: [markedObjectLayer.toJSON()] } })],
}).toJSON()).getScene("objects-scene");
assert.deepEqual(
  [objectSceneRoundTrip.stage.layers[0].inventoryEnabled, objectSceneRoundTrip.stage.layers[0].combinableEnabled],
  [true, true],
  "object action marks survive full project export and import",
);
const compatibilityProject = Project.fromJSON(new Project({
  version: 15,
  scenes: [
    new SceneModule({ id: "module-4", name: "Módulo 4", assetIds: ["pistol-resource"], stage: { layers: [new ImageLayer({
      id: "pistol",
      assetId: "pistol-resource",
      combinableEnabled: true,
      combinableWithLayerIds: ["bullets", "holster", "bullets", "pistol", "missing-layer"],
    })] } }),
    new SceneModule({ id: "module-9", name: "Módulo 9", assetIds: ["bullets-resource"], stage: { layers: [new ImageLayer({ id: "bullets", assetId: "bullets-resource" })] } }),
    new SceneModule({ id: "module-6", name: "Módulo 6", assetIds: ["holster-resource"], stage: { layers: [new ImageLayer({ id: "holster", assetId: "holster-resource" })] } }),
    new SceneModule({ id: "module-15", name: "Módulo 15", assetIds: ["backpack-resource"], stage: { layers: [new ImageLayer({ id: "backpack", assetId: "backpack-resource" })] } }),
  ],
  assets: [
    new ImageAsset({ id: "pistol-resource" }),
    new ImageAsset({ id: "bullets-resource" }),
    new ImageAsset({ id: "holster-resource" }),
    new ImageAsset({ id: "backpack-resource" }),
  ],
}).toJSON());
assert.deepEqual(compatibilityProject.getScene("module-4").stage.layers[0].combinableWithLayerIds, ["bullets", "holster"],
  "a combinable object can target image layers in other modules, without self, missing, or duplicate references");
assert.deepEqual(compatibilityProject.getScene("module-4").stage.layers[0].combinableWithResourceIds, ["bullets-resource", "holster-resource"],
  "legacy layer-based recipes migrate to portable resource IDs");
assert.deepEqual(Project.fromJSON(compatibilityProject.toJSON()).getScene("module-4").stage.layers[0].combinableWithLayerIds,
  ["bullets", "holster"], "cross-module compatibility survives project export and import");
assert.equal(compatibilityProject.removeScene("module-9"), true, "a target module can be removed");
assert.deepEqual(compatibilityProject.getScene("module-4").stage.layers[0].combinableWithLayerIds, ["holster"],
  "removing a target module clears compatibility references to its image layers");
assert.deepEqual(compatibilityProject.getScene("module-4").stage.layers[0].combinableWithResourceIds, ["holster-resource"],
  "removing an unused target resource clears its recipe references");

const combinationScene = new SceneModule({
  id: "combination-scene",
  assetIds: ["handle", "blade", "sword", "mixer", "sound-result"],
  soundIds: ["metal-sound", "success-sound"],
  stage: { layers: [
    new ImageLayer({
      id: "handle-layer",
      assetId: "handle",
      combinableEnabled: true,
      combinableWithResourceIds: ["blade"],
      combinationResultAssetId: "sword",
    }),
    new ImageLayer({
      id: "mixer-layer",
      assetId: "mixer",
      combinableEnabled: true,
      combinableWithResourceIds: ["metal-sound"],
      combinationResultAssetId: "success-sound",
    }),
  ] },
});
const combinationProject = Project.fromJSON(new Project({
  scenes: [combinationScene],
  assets: [
    new ImageAsset({ id: "handle", name: "Mango" }),
    new ImageAsset({ id: "blade", name: "Hoja" }),
    new ImageAsset({ id: "sword", name: "Espada" }),
    new ImageAsset({ id: "mixer", name: "Objeto de prueba" }),
  ],
  soundAssets: [
    new SoundAsset({ id: "metal-sound", name: "Golpe metálico" }),
    new SoundAsset({ id: "success-sound", name: "Sonido final" }),
  ],
}).toJSON());
assert.equal(CombinationRules.resolve(combinationProject, "handle", "blade").resultAssetId, "sword",
  "two compatible image resources resolve to their configured image result");
assert.equal(CombinationRules.resolve(combinationProject, "mixer", "metal-sound").resultAssetId, "success-sound",
  "an image can combine with a sound resource and produce a sound result");
assert.equal(CombinationRules.canStart(combinationProject, "metal-sound"), true,
  "a sound ingredient can start a reverse combination when present in inventory");
assert.deepEqual(combinationProject.getScene("combination-scene").stage.layers[0].combinableWithResourceIds, ["blade"],
  "resource compatibility and the combination result survive project import");

const combinationInventory = new InventoryState();
combinationInventory.add("handle", { capacity: 3 });
combinationInventory.add("blade", { capacity: 3 });
const combinedInventory = combinationInventory.combine("handle", "blade", "sword", { capacity: 3 });
assert.equal(combinedInventory.ok, true, "two inventory resources combine successfully");
assert.deepEqual(combinationInventory.items.map((item) => item.assetId), ["sword"],
  "combining inventory items consumes both ingredients and places the result in the first slot");
const failedUniqueCombination = combinationInventory.combine("sword", "sword", "sword", { capacity: 3, unique: true });
assert.equal(failedUniqueCombination.ok, false, "one copy cannot be consumed twice for a recipe");
assert.deepEqual(combinationInventory.items.map((item) => [item.assetId, item.quantity]), [["sword", 1]],
  "a failed inventory combination leaves its items untouched");
const multiDialogueScene = new SceneModule({
  id: "multi-dialogue",
  dialogues: [
    { id: "dialogue-back", speaker: "Fondo", zIndex: 1, text: { html: "Primera caja" } },
    { id: "dialogue-front", speaker: "Voz", zIndex: 3, text: { html: "Segunda caja" } },
  ],
});
const restoredDialogues = new SceneModule(multiDialogueScene.toJSON()).dialogues;
assert.deepEqual(restoredDialogues.map((dialogue) => [dialogue.id, dialogue.zIndex]), [
  ["dialogue-back", 1],
  ["dialogue-front", 2],
], "dialogue IDs and relative shared-layer order survive module serialization");
assert.equal(multiDialogueScene.toJSON().dialogue.id, "dialogue-back", "the legacy dialogue property points to the first dialogue");
project.addCharacter("Mara");
project.addCharacter("MARA");
assert.deepEqual(project.characters, ["Mara"], "speaker literals are retained without case-insensitive duplicates");
assert.deepEqual(Project.fromJSON(project.toJSON()).characters, ["Mara"], "speaker literals survive project serialization");

const scene1 = project.getScene("scene-1");
const scene2 = project.getScene("scene-2");
scene1.addAsset("shared-image");
scene2.addAsset("shared-image");
scene1.stage.layers.push(new ImageLayer({ id: "shared-layer", assetId: "shared-image" }));
scene1.timedCues.push(new TimedCue({
  id: "shared-cue",
  assetId: "shared-image",
  targetLayerId: "shared-layer",
  transitionType: "fade-black",
  transitionDurationMs: 2200,
}));
const serializedTransitionCue = Project.fromJSON(project.toJSON()).getScene("scene-1").timedCues[0];
assert.equal(serializedTransitionCue.transitionType, "fade-black", "timed transition style survives project export and import");
assert.equal(serializedTransitionCue.transitionDurationMs, 2200, "timed transition duration survives project export and import");
assert.equal(new TimedCue({ transitionType: "unknown" }).transitionType, "cut", "unsupported transition styles fall back safely to a cut");
assert.deepEqual(project.getAssetsForScene("scene-1").map((asset) => asset.id), ["shared-image"]);
assert.deepEqual(project.getAssetsForScene("scene-3"), [], "assets are isolated to their assigned module");
assert.equal(project.removeAssetFromScene("shared-image", "scene-1"), true);
assert.equal(scene1.stage.layers.length, 0, "removing a module resource clears its local layer");
assert.equal(scene1.timedCues[0].assetId, null, "removing a module resource clears local cue references");
assert.ok(project.getAsset("shared-image"), "another module keeps its shared resource");
assert.equal(project.removeAssetFromScene("shared-image", "scene-2"), true);
assert.equal(project.getAsset("shared-image"), null, "unreferenced resources are cleaned up");

project.addAsset(new ImageAsset({ id: "scene-4-only" }), "scene-4");
assert.deepEqual(project.getAssetsForScene("scene-4").map((asset) => asset.id), ["scene-4-only"]);
assert.deepEqual(project.getAssetsForScene("scene-1"), []);

const moveSource = new SceneModule({
  id: "move-source",
  assetIds: ["move-image"],
  soundIds: ["move-sound"],
  stage: { layers: [{ id: "kept-layer", assetId: "move-image" }] },
  timedCues: [{ id: "kept-cue", assetId: "move-image", targetLayerId: "kept-layer" }],
});
const moveTarget = new SceneModule({ id: "move-target" });
const moveProject = new Project({
  scenes: [moveSource, moveTarget],
  assets: [new ImageAsset({ id: "move-image" })],
  soundAssets: [new SoundAsset({ id: "move-sound" })],
});
assert.equal(moveProject.moveAssetToScene("move-image", "move-source", "move-target"), true,
  "an image resource can move between modules");
assert.deepEqual(moveProject.getAssetsForScene("move-source"), [], "the moved image is removed from its previous resource tab");
assert.deepEqual(moveProject.getAssetsForScene("move-target").map((asset) => asset.id), ["move-image"],
  "the moved image appears in the destination resource tab");
assert.equal(moveSource.stage.layers.length, 0, "moving a resource removes its placed image from the source scene");
assert.equal(moveSource.timedCues[0].assetId, null, "moving a resource clears its source-scene cue reference");
assert.equal(moveSource.timedCues[0].targetLayerId, null, "moving a resource clears cue references to removed source layers");
assert.equal(moveProject.moveSoundAssetToScene("move-sound", "move-source", "move-target"), true,
  "an MP3 resource can move between modules");
assert.deepEqual(moveProject.getSoundAssetsForScene("move-target").map((asset) => asset.id), ["move-sound"],
  "the moved MP3 appears in the destination resource tab");
assert.equal(moveProject.moveAssetToScene("move-image", "move-target", "move-target"), false,
  "moving a resource to its current module is a no-op");

const copySource = new SceneModule({
  id: "copy-source",
  assetIds: ["copy-image"],
  stage: { layers: [{ id: "copy-source-layer", assetId: "copy-image" }] },
});
const copyTarget = new SceneModule({ id: "copy-target" });
const copyProject = new Project({
  scenes: [copySource, copyTarget],
  assets: [new ImageAsset({ id: "copy-image" })],
});
assert.equal(copyProject.copyAssetToScene("copy-image", "copy-source", "copy-target"), true,
  "an image resource can be copied to another module");
assert.deepEqual(copyProject.getAssetsForScene("copy-source").map((asset) => asset.id), ["copy-image"],
  "copying preserves the original resource assignment");
assert.deepEqual(copyProject.getAssetsForScene("copy-target").map((asset) => asset.id), ["copy-image"],
  "the copied resource appears in the destination resource tab");
assert.equal(copySource.stage.layers[0].id, "copy-source-layer", "copying preserves the original canvas layer");
assert.equal(copyProject.copyAssetToScene("copy-image", "copy-source", "copy-target"), false,
  "copying an already assigned resource does not create duplicate assignments");

const soundProject = new Project({
  scenes: [new SceneModule({ id: "sound-scene", soundIds: ["sound-one"] })],
  soundAssets: [new SoundAsset({
    id: "sound-one",
    name: "ambiente.mp3",
    dataUrl: "data:audio/mpeg;base64,AA==",
    durationSeconds: 3,
    volumePercent: 30,
  })],
});
assert.equal(soundProject.getSoundAssetsForScene("sound-scene")[0].durationSeconds, 3,
  "a module sound retains its playback duration");
assert.equal(soundProject.getSoundAssetsForScene("sound-scene")[0].volumePercent, 30,
  "a module sound retains its volume percentage");
assert.equal(soundProject.getScene("sound-scene").soundCues[0].durationSeconds, 3,
  "legacy sound duration is migrated into the module sound cue");
assert.equal(soundProject.getScene("sound-scene").soundCues[0].volumePercent, 30,
  "legacy sound volume is migrated into the module sound cue");
const restoredSoundProject = Project.fromJSON(soundProject.toJSON());
assert.equal(restoredSoundProject.getSoundAssetsForScene("sound-scene")[0].name, "ambiente.mp3",
  "sound resources survive project export and import");
assert.deepEqual(restoredSoundProject.getScene("sound-scene").soundCues.map((cue) => cue.toJSON()),
  soundProject.getScene("sound-scene").soundCues.map((cue) => cue.toJSON()),
  "sound selection, duration and volume survive project export and import");
assert.equal(restoredSoundProject.getSoundAsset("sound-one").durationSeconds, 3,
  "sound duration survives project export and import");
assert.equal(restoredSoundProject.getSoundAsset("sound-one").volumePercent, 30,
  "sound volume survives project export and import");
assert.equal(restoredSoundProject.removeSoundAssetFromScene("sound-one", "sound-scene"), true,
  "a module sound can be removed from its module");
assert.equal(restoredSoundProject.getSoundAsset("sound-one"), null,
  "unassigned sound assets are cleaned up");
assert.equal(new SoundAsset({ volumePercent: 140 }).volumePercent, 100,
  "sound volume is limited to 100 percent");

const removalProject = new Project({
  version: 4,
  startSceneId: "remove-target",
  scenes: [
    new SceneModule({
      id: "keep-root",
      assetIds: ["shared-asset"],
      decisions: { choices: [new Decision({ id: "to-removed", targetSceneId: "remove-target" })] },
    }),
    new SceneModule({ id: "remove-target", assetIds: ["removed-only"] }),
    new SceneModule({ id: "promoted-child", assetIds: ["shared-asset"] }),
  ],
  assets: [new ImageAsset({ id: "shared-asset" }), new ImageAsset({ id: "removed-only" })],
  main: {
    id: "main",
    type: "main",
    children: [
      { id: "ref-keep-root", type: "scene", sceneId: "keep-root" },
      {
        id: "ref-remove-target",
        type: "scene",
        sceneId: "remove-target",
        children: [{ id: "ref-promoted-child", type: "scene", sceneId: "promoted-child" }],
      },
    ],
  },
});
assert.equal(removalProject.removeScene("remove-target"), true, "a module can be removed when another module remains");
assert.equal(removalProject.findTreeNode("ref-promoted-child").parent.id, "main", "children of a deleted module are promoted to its parent");
assert.equal(removalProject.startSceneId, "keep-root", "deleting the start module selects a remaining module");
assert.equal(removalProject.getScene("keep-root").decisions.choices[0].targetSceneId, null, "decisions to a deleted module lose their destination");
assert.equal(removalProject.getAsset("removed-only"), null, "unshared assets of a deleted module are removed");
assert.ok(removalProject.getAsset("shared-asset"), "assets still used by other modules are kept");
assert.equal(new Project({ scenes: [new SceneModule({ id: "only-module" })] }).removeScene("only-module"), false,
  "the last module cannot be removed");

const legacyProject = Project.fromJSON({
  version: 2,
  startSceneId: "legacy-1",
  scenes: [
    { id: "legacy-1", name: "Inicio", dialogue: { speaker: "Nora" }, stage: { layers: [{ id: "legacy-layer", assetId: "used-image" }] }, disabledAssetIds: ["previously-disabled"] },
    { id: "legacy-2", name: "Otra escena", timedCues: [{ id: "legacy-cue", speaker: "Guardia" }] },
  ],
  assets: [
    new ImageAsset({ id: "used-image" }).toJSON(),
    new ImageAsset({ id: "orphan-image" }).toJSON(),
    new ImageAsset({ id: "previously-disabled" }).toJSON(),
  ],
  main: {
    id: "main",
    type: "main",
    children: [
      { id: "legacy-ref-1", type: "scene", sceneId: "legacy-1" },
      { id: "legacy-ref-2", type: "scene", sceneId: "legacy-2" },
    ],
  },
});
assert.deepEqual(legacyProject.getAssetsForScene("legacy-1").map((asset) => asset.id), ["used-image", "orphan-image", "previously-disabled"]);
assert.deepEqual(legacyProject.getAssetsForScene("legacy-2"), []);
assert.deepEqual(legacyProject.characters, ["Nora", "Guardia"], "older projects recover names from dialogue and timed cues");
assert.equal(legacyProject.toJSON().version, 33, "legacy projects migrate to the current format");

const workspaceStorage = new Map();
const fakeWorkspaceStorage = {
  getItem: (key) => workspaceStorage.get(key) ?? null,
  setItem: (key, value) => workspaceStorage.set(key, value),
};
const workspaceProject = makeProject();
assert.equal(writeProjectWorkspace(workspaceProject, ["scene-1", "scene-3", "scene-2"], "scene-3", fakeWorkspaceStorage), true, "la disposición de pestañas se guarda fuera del proyecto");
assert.deepEqual(readProjectWorkspace(workspaceProject, "scene-1", fakeWorkspaceStorage), {
  openSceneIds: ["scene-1", "scene-3", "scene-2"],
  activeSceneId: "scene-3",
}, "al recargar se recuperan el orden y el módulo activo");
assert.deepEqual(readProjectWorkspace({ ...workspaceProject, scenes: workspaceProject.scenes.filter((scene) => scene.id !== "scene-2") }, "scene-1", fakeWorkspaceStorage), {
  openSceneIds: ["scene-1", "scene-3"],
  activeSceneId: "scene-3",
}, "las pestañas de módulos eliminados se descartan al restaurar");
assert.deepEqual(legacyProject.scenes[0].quizChallenges, [], "los proyectos anteriores se abren con el Quiz vacío");
assert.deepEqual(legacyProject.inventoryGrid, { columns: 5, rows: 3 }, "legacy projects receive the default inventory grid");
assert.equal(legacyProject.inventoryHintCapacity, 10, "legacy projects receive the default number of clue spaces");
assert.deepEqual(legacyProject.scenes[0].soundIds, [], "legacy modules migrate with no attached sounds");

const playerProject = new Project({
  scenes: [new SceneModule({ id: "audio-preview", soundIds: ["audio-preview-sound"] })],
  soundAssets: [new SoundAsset({
    id: "audio-preview-sound",
    dataUrl: "data:audio/mpeg;base64,AA==",
    durationSeconds: 3,
    volumePercent: 30,
  })],
});
const previousAudio = globalThis.Audio;
const previousWindow = globalThis.window;
const createdAudios = [];
const scheduledAudioTimers = [];
globalThis.Audio = class {
  constructor(source) {
    this.source = source;
    this.volume = 1;
    this.currentTime = 0;
    this.pauseCount = 0;
    createdAudios.push(this);
  }
  play() { return Promise.resolve(); }
  pause() { this.pauseCount += 1; }
};
globalThis.window = {
  setTimeout(callback, delay) {
    scheduledAudioTimers.push({ callback, delay });
    return scheduledAudioTimers.length;
  },
  clearTimeout() {},
};
const audioPlayer = new ScenePlayer(playerProject);
audioPlayer.start("audio-preview");
assert.equal(createdAudios[0].volume, 0.3, "scene playback applies the configured volume");
assert.equal(scheduledAudioTimers[0].delay, 3000, "scene playback stops at the configured duration");
audioPlayer.dispose();
assert.equal(createdAudios[0].pauseCount, 1, "stopping playback also stops its sounds");
scheduledAudioTimers.length = 0;
const transitionProject = new Project({
  scenes: [new SceneModule({
    id: "transition-preview",
    stage: { layers: [new ImageLayer({ id: "transition-layer", assetId: "before-image" })] },
    timedCues: [new TimedCue({
      id: "blackout-transition",
      atMs: 10000,
      targetLayerId: "transition-layer",
      assetId: "after-image",
      transitionType: "fade-black",
      transitionDurationMs: 2000,
    })],
  })],
  assets: [new ImageAsset({ id: "before-image" }), new ImageAsset({ id: "after-image" })],
});
const transitionPlayer = new ScenePlayer(transitionProject);
transitionPlayer.start("transition-preview");
const scheduledCue = scheduledAudioTimers.find((timer) => timer.delay === 10000);
assert.ok(scheduledCue, "scene playback schedules the image change at its configured start time");
scheduledCue.callback();
assert.equal(transitionPlayer.state.transitions[0].durationMs, 2000, "playback retains the transition duration");
assert.equal(transitionPlayer.state.layers[0].assetId, "before-image", "a blackout keeps the outgoing image until the transition midpoint");
scheduledAudioTimers.find((timer) => timer.delay === 1000)?.callback();
assert.equal(transitionPlayer.state.layers[0].assetId, "after-image", "a blackout swaps to the new image while the stage is covered");
scheduledAudioTimers.find((timer) => timer.delay === 2000)?.callback();
assert.deepEqual(transitionPlayer.state.transitions, [], "playback clears a completed transition");
transitionPlayer.dispose();
if (previousAudio === undefined) delete globalThis.Audio;
else globalThis.Audio = previousAudio;
if (previousWindow === undefined) delete globalThis.window;
else globalThis.window = previousWindow;

process.stdout.write("Modelo: PASS (sonido, vídeo y mapa, recetas, inventario, pistas, notas, recursos, escenas, decisiones y migraciones).\n");
