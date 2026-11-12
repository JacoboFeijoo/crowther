import assert from "node:assert/strict";
import {
  CombatChallenge,
  ImageAsset,
  ImageLayer,
  Project,
  SceneModule,
  SceneSoundCue,
  SceneVideoCue,
  SoundAsset,
  TimedCue,
  VideoAsset,
  combatAttributesFromImage,
} from "../js/model.js";
import { ScenePlayer } from "../js/player.js";

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

const scene = new SceneModule({
  id: "arena",
  name: "La arena",
  combatChallenges: [new CombatChallenge({
    id: "fight",
    name: "duro",
    enemyName: "Guardia",
    enemyAssetId: "portrait-guard",
    attributes: [
      { name: "Fuerza", enemyValue: 4 },
      { name: "Sigilo", enemyValue: 8 },
    ],
    comparisonAttribute: "Fuerza",
    diceCount: 1,
    diceSides: 6,
    maxRounds: 2,
    enemyMaxHealth: 1,
    damagePerWin: 1,
    victoryAnimation: "flash",
    defeatAnimation: "shake",
  })],
});
const source = new Project({ version: 27, startSceneId: scene.id, scenes: [scene] });
const restored = Project.fromJSON(source.toJSON());
const restoredCombat = restored.getScene(scene.id).combatChallenges[0];
assert.equal(restoredCombat.enemyName, "Guardia", "el nombre enemigo se conserva al exportar/importar el proyecto");
assert.equal(restoredCombat.enemyAssetId, "portrait-guard", "la ilustración que originó los atributos se conserva");
assert.equal(restoredCombat.name, "duro", "el nombre personalizado del combate y su pareja de condiciones se conserva");
assert.deepEqual(restoredCombat.attributes, [
  { name: "Fuerza", enemyValue: 4 },
  { name: "Sigilo", enemyValue: 8 },
], "los atributos y sus valores se serializan");
assert.equal(restoredCombat.placement.widthPct, 90, "la posición y el tamaño de la caja se serializan");
assert.deepEqual(restoredCombat.victoryCondition.playerTerms, [
  { source: "playerAttribute", attribute: "Fuerza", value: 0, operator: "+" },
], "un proyecto anterior obtiene una condición de victoria equivalente al comparar una característica");

const portrait = new ImageAsset({
  id: "portrait-guard",
  name: "Guardia.png",
  attributes: [{ attributeId: "strength", value: 7 }, { attributeId: "stealth", value: 2 }],
});
const attributeProject = new Project({
  assets: [portrait],
  objectAttributeDefinitions: [{ id: "strength", name: "Fuerza" }, { id: "stealth", name: "Sigilo" }],
  resourceSectionNames: { sound: "Banda sonora" },
});
assert.deepEqual(combatAttributesFromImage(attributeProject, portrait), [
  { name: "Fuerza", enemyValue: 7 },
  { name: "Sigilo", enemyValue: 2 },
], "la ilustración convierte los atributos del objeto en valores copiables al combate");
assert.equal(Project.fromJSON(attributeProject.toJSON()).resourceSectionNames.sound, "Banda sonora", "el nombre personalizado de los bloques de recursos se conserva");
assert.equal(attributeProject.resourceSectionNames.transitions, "Tiempos y transiciones", "los proyectos anteriores reciben el nombre estándar de transiciones");

const characterPortrait = new ImageAsset({ id: "portrait-character", name: "Guardia.png", attributes: [] });
const characterImageProject = new Project({
  scenes: [new SceneModule({
    id: "character-image-scene",
    stage: { layers: [new ImageLayer({ id: "character-layer", assetId: characterPortrait.id, characterEnabled: true, characterId: "guard-profile" })] },
  })],
  assets: [characterPortrait],
  characterSheet: { attributes: [{ id: "health", name: "Vida", initialValue: 12 }, { id: "strength", name: "Fuerza", initialValue: 1 }] },
  playerCharacters: [{ id: "guard-profile", name: "Guardia", attributes: [{ attributeId: "health", value: 9 }, { attributeId: "strength", value: 7 }] }],
});
assert.deepEqual(combatAttributesFromImage(characterImageProject, characterPortrait), [
  { name: "Vida", enemyValue: 9 },
  { name: "Fuerza", enemyValue: 7 },
], "la imagen vinculada a un personaje aporta atributos de la ficha al combate");

const namedResources = Project.fromJSON(new Project({
  scenes: [new SceneModule({
    id: "named-resources",
    soundCues: [new SceneSoundCue({ id: "sound-cue", name: "Campanas lejanas", soundId: "bell" })],
    videoCues: [new SceneVideoCue({ id: "video-cue", name: "El ascensor", videoId: "lift" })],
    timedCues: [new TimedCue({ id: "timed-cue", name: "La puerta se abre", atMs: 1200 })],
  })],
  soundAssets: [new SoundAsset({ id: "bell", name: "campanas.mp3" })],
  videoAssets: [new VideoAsset({ id: "lift", name: "ascensor.mp4" })],
}).toJSON());
const restoredResources = namedResources.getScene("named-resources");
assert.equal(restoredResources.soundCues[0]?.name, "Campanas lejanas", "el nombre personalizado del sonido se conserva");
assert.equal(restoredResources.videoCues[0]?.name, "El ascensor", "el nombre personalizado del vídeo se conserva");
assert.equal(restoredResources.timedCues[0]?.name, "La puerta se abre", "el nombre personalizado de la transición se conserva");

restored.characterSheet.attributes.push({ id: "strength", name: "Fuerza", initialValue: 8 });
restored.characterSheet.attributes.find((attribute) => attribute.name === "Vida").initialValue = 12;
const rolls = [0.99, 0];
const player = new ScenePlayer(restored, { random: () => rolls.shift() ?? 0 });
player.configureCharacter({ name: "Aventurera" });
player.start(scene.id);
const result = player.playCombatRound("fight", "sword-asset");
assert.equal(result.ok, true, "se puede jugar una ronda activa");
assert.equal(result.playerScore, 14, "el jugador suma atributo y dado");
assert.equal(result.enemyScore, 5, "el enemigo suma atributo y dado");
assert.equal(result.result, "victory", "el enemigo queda derrotado al agotar su vida");
assert.equal(player.state.combatStates.fight.selectedItemId, "sword-asset", "la selección del objeto queda guardada en el combate");
assert.equal(player.state.combatStates.fight.lastRolls.player[0], 6, "se guarda la tirada de dados del jugador");

const fallbackProject = Project.fromJSON(source.toJSON());
fallbackProject.characterSheet.attributes.find((attribute) => attribute.name === "Vida").initialValue = 1;
fallbackProject.characterSheet.attributes.push({ id: "strength", name: "Fuerza", initialValue: 0 });
const fallbackPlayer = new ScenePlayer(fallbackProject, { random: () => 0 });
fallbackPlayer.start(scene.id);
assert.equal(fallbackPlayer.state.combatStates.fight.playerHealth, 1, "la vida del jugador parte del valor definido en la ficha");
fallbackPlayer.playCombatRound("fight");
assert.equal(fallbackPlayer.state.combatStates.fight.result, "defeat", "el resultado de la ronda y la derrota se calculan");

const compositeScene = new SceneModule({
  id: "composite-arena",
  combatChallenges: [new CombatChallenge({
    id: "composite-fight",
    attributes: [{ name: "Fuerza", enemyValue: 4 }, { name: "Resistencia", enemyValue: 3 }],
    diceCount: 1,
    diceSides: 6,
    enemyMaxHealth: 5,
    victoryCondition: {
      playerTerms: [
        { source: "playerAttribute", attribute: "Fuerza", operator: "+" },
        { source: "playerAttribute", attribute: "Resistencia", operator: "+" },
      ],
      comparator: ">",
      enemyTerms: [
        { source: "enemyAttribute", attribute: "Fuerza", operator: "+" },
        { source: "enemyAttribute", attribute: "Resistencia", operator: "+" },
        { source: "weaponDamage", operator: "=" },
      ],
    },
  })],
});
const compositeProject = Project.fromJSON(new Project({ scenes: [compositeScene] }).toJSON());
compositeProject.assets.push({ id: "sword", damage: 2 });
compositeProject.characterSheet.attributes.push(
  { id: "strength", name: "Fuerza", initialValue: 8 },
  { id: "resistance", name: "Resistencia", initialValue: 2 },
);
const compositePlayer = new ScenePlayer(compositeProject, { random: () => 0 });
compositePlayer.start(compositeScene.id);
const compositeResult = compositePlayer.playCombatRound("composite-fight", "sword");
assert.equal(compositeResult.playerScore, 11, "la condición suma varios atributos del jugador y su dado");
assert.equal(compositeResult.enemyScore, 10, "la condición suma varios atributos enemigos, daño del arma y su dado");
assert.equal(compositeResult.wonRound, true, "la comparación compuesta decide correctamente la ronda");
assert.equal(compositeProject.getScene(compositeScene.id).combatChallenges[0].victoryCondition.enemyTerms[2].source, "weaponDamage",
  "la condición compuesta y su modificador de arma se conservan al exportar e importar");
assert.equal(compositeProject.getScene(compositeScene.id).combatChallenges[0].victoryCondition.enemyTerms[2].operator, "=",
  "el operador igual se conserva en los términos de la condición de victoria");

console.log("Combates: persistencia, tiradas, fórmulas compuestas, modificador de arma, vida y resultados comprobados.");
