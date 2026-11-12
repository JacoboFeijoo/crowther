import assert from "node:assert/strict";
import { CombatChallenge, ImageAsset, ImageLayer, Project, SceneModule } from "../js/model.js";
import { PlayerCharacterState } from "../js/character-state.js";
import { ScenePlayer } from "../js/player.js";

globalThis.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 };
globalThis.DOMParser = class {
  parseFromString() { return { body: { childNodes: [] } }; }
};
globalThis.document = {
  createElement() { return { innerHTML: "", append() {} }; },
  createTextNode(textContent) { return { nodeType: Node.TEXT_NODE, textContent }; },
};

const emptyScene = new SceneModule({ id: "character-scene", stage: { layers: [] } });
const project = new Project({ scenes: [emptyScene], assets: [new ImageAsset({ id: "guard", name: "Guardia.png" })] });
assert.deepEqual(project.characterSheet.attributes.map(({ name, initialValue }) => ({ name, initialValue })), [
  { name: "Vida", initialValue: 10 },
  { name: "Experiencia", initialValue: 0 },
], "la ficha nueva incluye Vida y Experiencia por defecto");

const strength = project.addCharacterAttribute("Fuerza", 3);
project.characterSheet.distributablePoints = 3;
project.characterSheet.progressionRules = [
  { id: "module-rule", event: "module-completed", pointsPerUnit: 1 },
  { id: "combat-rule", event: "combat-won", pointsPerUnit: 2 },
  { id: "quiz-rule", event: "quiz-solved", pointsPerUnit: 1 },
];
const profile = project.addPlayerCharacter("Guardia");
profile.attributes.find((attribute) => attribute.attributeId === strength.id).value = 8;
emptyScene.stage.layers.push(new ImageLayer({ id: "guard-layer", assetId: "guard", characterEnabled: true, characterId: profile.id }));
const restored = Project.fromJSON(project.toJSON());
assert.equal(restored.characterSheet.distributablePoints, 3, "los puntos distribuibles se conservan al guardar");
assert.deepEqual(restored.characterSheet.progressionRules.map((rule) => rule.pointsPerUnit), [1, 2, 1], "las reglas de progreso se guardan");
assert.equal(restored.playerCharacters[0].name, "Guardia", "se conserva el personaje del diseñador");
assert.equal(restored.playerCharacters[0].attributes.find((attribute) => attribute.attributeId === strength.id).value, 8, "se conservan sus valores editados");
assert.equal(restored.getScene("character-scene").stage.layers[0].characterId, profile.id, "la ilustración sigue vinculada a su personaje");

const state = new PlayerCharacterState(restored.characterSheet);
state.configure({ name: "Aventurera" });
assert.equal(state.name, "Aventurera");
assert.equal(state.distribute(strength.id, 2), true, "se pueden distribuir puntos sobre un atributo");
assert.equal(state.value(strength.id), 5);
assert.equal(state.distributablePoints, 1);
assert.equal(state.distribute(strength.id, 2), false, "no se pueden gastar más puntos de los asignados");
assert.equal(state.distribute(strength.id, -1), true, "se puede retirar un punto y recuperar el cupo");
assert.equal(state.value(strength.id), 4);
assert.equal(state.distributablePoints, 2);
assert.equal(state.award(restored.characterSheet, "module-completed", "module-1"), 1);
assert.equal(state.award(restored.characterSheet, "module-completed", "module-1"), 0, "una unidad de progreso no se premia dos veces");
assert.equal(state.award(restored.characterSheet, "combat-won", "combat-1"), 2);
assert.equal(state.award(restored.characterSheet, "quiz-solved", "quiz-1"), 1);
assert.equal(state.progress, 4, "el progreso suma módulos, combates y quiz");

const noAttributes = new Project({ characterSheet: { attributes: [], progressionRules: [], distributablePoints: 0 }, scenes: [new SceneModule({ id: "empty-sheet" })] });
assert.deepEqual(noAttributes.characterSheet.attributes, [], "el diseñador puede eliminar todos los atributos de la ficha");
assert.deepEqual(Project.fromJSON(noAttributes.toJSON()).characterSheet.attributes, [], "una ficha vacía no recrea los valores predeterminados al recargar");

const combatScene = new SceneModule({
  id: "character-combat",
  combatChallenges: [new CombatChallenge({
    id: "reward-fight",
    attributes: [{ name: "Fuerza", enemyValue: 0 }],
    diceCount: 1,
    diceSides: 2,
    enemyMaxHealth: 1,
    victoryCondition: {
      playerTerms: [{ source: "playerAttribute", attribute: "Fuerza", operator: "+" }],
      comparator: ">",
      enemyTerms: [{ source: "enemyAttribute", attribute: "Fuerza", operator: "+" }],
    },
    roundAttributeEffects: [
      { attributeId: "vida", onWin: -1, onLoss: 0 },
      { attributeId: "magia", onWin: -2, onLoss: 0 },
    ],
    victoryReward: { type: "character", attributeId: "experiencia", amount: 2 },
  })],
});
const combatProject = new Project({
  scenes: [combatScene],
  characterSheet: {
    attributes: [
      { id: "vida", name: "Vida", initialValue: 10 },
      { id: "experiencia", name: "Experiencia", initialValue: 0 },
      { id: "fuerza", name: "Fuerza", initialValue: 2 },
      { id: "magia", name: "Magia", initialValue: 5 },
    ],
    progressionRules: [{ id: "combat-progress", event: "combat-won", pointsPerUnit: 2 }],
  },
});
const combatPlayer = new ScenePlayer(combatProject, { random: () => 0 });
combatPlayer.start(combatScene.id);
const combatResult = combatPlayer.playCombatRound("reward-fight");
assert.equal(combatResult.result, "victory", "una victoria completa activa las recompensas del combate");
assert.equal(combatPlayer.character.value("vida"), 9, "el efecto de ronda modifica Vida al ganar");
assert.equal(combatPlayer.character.value("magia"), 3, "el efecto de ronda modifica Magia al ganar");
assert.equal(combatPlayer.character.value("experiencia"), 2, "la recompensa aumenta el atributo seleccionado");
assert.equal(combatPlayer.character.progress, 2, "la victoria también suma el progreso configurado");

const objectRewardChallenge = new CombatChallenge({
  id: "object-reward-fight",
  attributes: [{ name: "Fuerza", enemyValue: 0 }],
  diceCount: 1,
  diceSides: 2,
  enemyMaxHealth: 1,
  victoryCondition: {
    playerTerms: [{ source: "playerAttribute", attribute: "Fuerza", operator: "+" }],
    comparator: ">",
    enemyTerms: [{ source: "enemyAttribute", attribute: "Fuerza", operator: "+" }],
  },
  victoryReward: { type: "object", assetId: "knife", attributeId: "poison", amount: 5 },
});
const objectRewardProject = new Project({
  scenes: [new SceneModule({ id: "object-reward-scene", combatChallenges: [objectRewardChallenge] })],
  assets: [new ImageAsset({ id: "knife", name: "Cuchillo" })],
  objectAttributeDefinitions: [{ id: "poison", name: "Veneno" }],
  characterSheet: { attributes: [{ id: "fuerza", name: "Fuerza", initialValue: 2 }] },
});
const objectRewardPlayer = new ScenePlayer(objectRewardProject, { random: () => 0 });
objectRewardPlayer.start("object-reward-scene");
objectRewardPlayer.playCombatRound(objectRewardChallenge.id);
assert.equal(objectRewardPlayer.inventory.attributeBonuses.get("knife")?.get("poison"), 5, "la victoria puede sumar un atributo al objeto elegido");

console.log("Personajes: ficha, perfiles, distribución, progreso, efectos de ronda y recompensas comprobados.");
