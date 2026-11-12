import { DecisionPanel, DialogueBlock, ImageLayer, RichTextBlock } from "./model.js?v=2026-11-12-03";
import { InventoryState } from "./inventory.js?v=2026-11-12-01";
import { PlayerCharacterState } from "./character-state.js?v=2026-11-12-01";

function mapCellKey(cell) {
  return `${Number(cell?.row) || 0}:${Number(cell?.column) || 0}`;
}
function normalizeQuizAnswer(value) {
return String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}
function normalizeCombatAttribute(value) {
return String(value || "").trim().normalize("NFKC").toLocaleLowerCase();
}
function readCombatPlayerProfile(project, fallbackHealth = 10, character = null) {
const sheet = project?.characterSheet || project?.playerCharacterSheet || project?.playerCharacter || {};
const source = sheet.attributes || sheet.stats || sheet.characteristics || {};
const attributes = new Map();
const byId = new Map();
if (Array.isArray(source)) source.forEach((item) => {
const value = character?.value?.(item?.id) ?? item?.initialValue ?? item?.value;
attributes.set(normalizeCombatAttribute(item?.name), Number(value) || 0);
byId.set(String(item?.id || ""), Number(value) || 0);
});
else if (source && typeof source === "object") Object.entries(source).forEach(([name, value]) => attributes.set(normalizeCombatAttribute(name), Number(value?.value ?? value) || 0));
const healthEntry = Array.isArray(source) ? source.find((item) => normalizeCombatAttribute(item?.name) === "vida") : null;
const currentHealth = healthEntry ? character?.value?.(healthEntry.id) : null;
const maxHealth = Number(sheet.maxHealth ?? sheet.healthMax ?? sheet.vidaMaxima ?? healthEntry?.initialValue);
return {
 name: String(character?.name || sheet.name || sheet.characterName || "Jugador"),
attributes,
maxHealth: Number.isFinite(currentHealth) && currentHealth >= 0 ? currentHealth : Number.isFinite(maxHealth) && maxHealth > 0 ? maxHealth : Math.max(1, Number(fallbackHealth) || 10),
};
}
function readCombatItemDamage(project, assetId) {
const asset = project?.getAsset?.(String(assetId || ""));
const values = [asset?.weaponDamage, asset?.damage, asset?.combatValues?.damage, asset?.values?.damage];
const value = values.map(Number).find(Number.isFinite);
return value ?? 0;
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

/**
 * Reproduce una escena desde datos inmutables del modelo. Los timers pertenecen
 * al reproductor, nunca al JSON, y se invalidan al detener o cambiar de escena.
 */
export class ScenePlayer {
constructor(project, { onRender = () => {}, onStatus = () => {}, onBeforeSceneStart = () => {}, onSceneStart = () => {}, random = Math.random } = {}) {
    this.project = project;
    this.onRender = onRender;
    this.onStatus = onStatus;
    this.onBeforeSceneStart = onBeforeSceneStart;
    this.onSceneStart = onSceneStart;
this.random = typeof random === "function" ? random : Math.random;
    this.timers = [];
    this.audioElements = [];
    this.generation = 0;
    this.scene = null;
    this.state = null;
    this.inventory = new InventoryState();
    this.character = new PlayerCharacterState(project?.characterSheet || {});
    this.completedCombatIds = new Set();
    this.unlockedMapCells = new Set((project.adventureMap?.cells || [])
      .filter((cell) => cell.initiallyUnlocked)
      .map(mapCellKey));
    this.mapCellImages = new Map();
    this.mapCellNotes = new Map();
this.completedQuizIds = new Set();
this.quizFailureCounts = new Map();
this.unlockedQuizSceneIds = new Set();
this.unlockedQuizVideoIds = new Set();
    this.isPlaying = false;
  }

  start(sceneId) {
    const scene = this.project.getScene(sceneId);
    if (!scene) {
      this.onStatus("No existe la escena solicitada.");
      return;
    }

    const previousScene = this.scene;
    if (previousScene && previousScene.id !== scene.id) this.onBeforeSceneStart(scene, previousScene);
    if (previousScene && previousScene.id !== scene.id) this.character.award(this.project.characterSheet, "module-completed", previousScene.id);
    this.dispose();
    this.isPlaying = true;
    this.scene = scene;
    const dialogues = scene.dialogues.map((dialogue) => new DialogueBlock(dialogue.toJSON()));
    this.state = {
      sceneId: scene.id,
      layers: scene.stage.layers.map((layer) => new ImageLayer(layer.toJSON())),
      dialogues,
      dialogue: dialogues[0],
      decisions: new DecisionPanel(scene.decisions.toJSON()),
quizChallenges: Array.isArray(scene.quizChallenges) ? scene.quizChallenges : [],
quizFeedback: null,
      combatChallenges: Array.isArray(scene.combatChallenges) ? scene.combatChallenges : [],
      combatStates: Object.fromEntries((scene.combatChallenges || []).map((challenge) => {
        const profile = readCombatPlayerProfile(this.project, challenge.enemyMaxHealth, this.character);
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
    const token = this.generation;

    this.onRender(this.state);
    this.onSceneStart(scene);

    (scene.soundCues || []).filter((cue) => !cue.imageLayerId).forEach((cue) => this.playSoundCue(cue.id));

    [...scene.timedCues]
      .sort((first, second) => first.atMs - second.atMs)
      .forEach((cue) => {
        const timeout = window.setTimeout(() => {
          if (!this.isPlaying || token !== this.generation) return;
          this.applyCue(cue);
        }, cue.atMs);
        this.timers.push(timeout);
      });
  }

  resetInventory() {
    this.inventory.clear();
  }

  resetCharacter() {
    this.character = new PlayerCharacterState(this.project?.characterSheet || {});
    this.completedCombatIds.clear();
    return this.character;
  }

  configureCharacter(options) {
    this.character.configure(options);
    return this.character;
  }

  resetMapDiscovery() {
    this.unlockedMapCells = new Set((this.project.adventureMap?.cells || [])
      .filter((cell) => cell.initiallyUnlocked)
      .map(mapCellKey));
    this.mapCellImages.clear();
    this.mapCellNotes.clear();
  }

  setMapCellNote(cellKey, text) {
    const key = String(cellKey || "");
    if (!/^\d+:\d+$/.test(key)) return false;
    const note = String(text ?? "");
    if (!note.trim()) return this.removeMapCellNote(key);
    this.mapCellNotes.set(key, note);
    return true;
  }

  removeMapCellNote(cellKey) {
    const key = String(cellKey || "");
    if (!/^\d+:\d+$/.test(key)) return false;
    return this.mapCellNotes.delete(key);
  }

  activateMapForCurrentScene(imageAssetId = null, assignedCellKey = null) {
    const moduleNumber = Number(this.scene?.moduleNumber);
    if (!this.isPlaying || !Number.isSafeInteger(moduleNumber) || moduleNumber < 1) {
      return { ok: false, moduleNumber: null, message: "No hay una escena activa para desbloquear en el mapa." };
    }
    const cell = (this.project.adventureMap?.cells || [])
      .find((candidate) => mapCellKey(candidate) === String(assignedCellKey || ""));
    if (!cell) return { ok: false, moduleNumber, message: "Esta imagen no tiene una casilla del mapa asignada." };
    cell.moduleNumber = moduleNumber;
    const key = mapCellKey(cell);
    const wasUnlocked = this.unlockedMapCells.has(key);
    this.unlockedMapCells.add(key);
    const asset = imageAssetId ? this.project.getAsset(imageAssetId) : null;
    if (asset) this.mapCellImages.set(key, asset.id);
    const coordinates = `${cell.row}, ${cell.column}`;
    return {
      ok: true,
      moduleNumber,
      row: cell.row,
      column: cell.column,
      imageAssetId: asset?.id || null,
      message: wasUnlocked
        ? `La ilustración se ha colocado en la casilla ${coordinates}.`
        : `Ilustración colocada en la casilla ${coordinates}; ya puedes viajar a la escena ${moduleNumber}.`,
    };
  }

  playSoundCue(cueId) {
    const cue = this.scene?.soundCues?.find((candidate) => candidate.id === cueId);
    const sound = cue && this.project.getSoundAsset(cue.soundId);
    if (!cue || !sound?.dataUrl || typeof Audio !== "function") return false;
    const audio = new Audio(sound.dataUrl);
    const volume = Number(cue.volumePercent);
    audio.volume = (Number.isFinite(volume) ? Math.max(0, Math.min(100, volume)) : sound.volumePercent) / 100;
    this.audioElements.push(audio);
    audio.play()?.catch(() => {});
    const duration = Number(cue.durationSeconds);
    if (Number.isFinite(duration) && duration > 0) {
      const timeout = window.setTimeout(() => {
        audio.pause();
        audio.currentTime = 0;
      }, duration * 1000);
      this.timers.push(timeout);
    }
    return true;
  }

  applyCue(cue) {
    if (!this.state) return;

    if (cue.assetId) {
      const layer = this.state.layers.find((candidate) => candidate.id === cue.targetLayerId) || this.state.layers.at(-1);
      if (layer) this.startLayerTransition(cue, layer);
    }

    const dialogue = this.state.dialogues?.[0] || this.state.dialogue;
    if (cue.text && dialogue) {
      dialogue.text = new RichTextBlock(cue.text.toJSON());
    }

    if (cue.speaker && dialogue) {
      dialogue.speaker = cue.speaker;
    }

    if (typeof cue.revealChoices === "boolean") {
      this.state.decisions.visible = cue.revealChoices;
    }

    this.onRender(this.state);
    this.onStatus(`Cambio aplicado a los ${(cue.atMs / 1000).toLocaleString("es-ES")} segundos.`);
  }

  startLayerTransition(cue, layer) {
    const allowedTypes = new Set(["fade-black", "crossfade", "fade-white", "slide"]);
    const type = allowedTypes.has(cue.transitionType) ? cue.transitionType : "cut";
    const durationMs = Math.min(120000, Math.max(0, Number(cue.transitionDurationMs) || 0));
    if (type === "cut" || durationMs === 0 || !this.project.getAsset(cue.assetId)) {
      layer.assetId = cue.assetId;
      return;
    }

    this.state.transitions = this.state.transitions || [];
    this.state.transitions
      .filter((transition) => transition.layerId === layer.id)
      .forEach((transition) => { layer.assetId = transition.toAssetId; });
    this.state.transitions = this.state.transitions.filter((transition) => transition.layerId !== layer.id);
    const transition = {
      id: cue.id,
      type,
      layerId: layer.id,
      toAssetId: cue.assetId,
      startedAt: performance.now(),
      durationMs,
      swapped: false,
    };
    this.state.transitions.push(transition);
    const generation = this.generation;
    const isActive = () => this.isPlaying
      && generation === this.generation
      && this.state?.transitions?.some((candidate) => candidate.id === transition.id);

    if (type === "fade-black" || type === "fade-white") {
      const midpoint = window.setTimeout(() => {
        if (!isActive()) return;
        layer.assetId = transition.toAssetId;
        transition.swapped = true;
        this.onRender(this.state);
      }, durationMs / 2);
      this.timers.push(midpoint);
    }

    const finish = window.setTimeout(() => {
      if (!isActive()) return;
      layer.assetId = transition.toAssetId;
      this.state.transitions = this.state.transitions.filter((candidate) => candidate.id !== transition.id);
      this.onRender(this.state);
    }, durationMs);
    this.timers.push(finish);
  }

  choose(choiceId) {
    if (!this.state) return;
    const choice = this.state.decisions.choices.find((candidate) => candidate.id === choiceId);
    if (!choice) return;

    if (choice.targetSceneId && this.project.getScene(choice.targetSceneId)) {
      this.start(choice.targetSceneId);
      return;
    }

    this.onStatus(`Elección registrada: ${choice.label}. Añade un destino cuando haya otra escena.`);
  }

playCombatRound(combatId, inventoryAssetId = "") {
if (!this.isPlaying || !this.state || !this.scene) return { ok: false };
const challenge = this.scene.combatChallenges?.find((item) => item.id === String(combatId || ""));
const fight = this.state.combatStates?.[challenge?.id];
if (!challenge || !fight || fight.finished) return { ok: false };
fight.selectedItemId = String(inventoryAssetId || "");
const diceCount = Math.max(1, Math.min(20, Math.round(Number(challenge.diceCount) || 1)));
const diceSides = Math.max(2, Math.min(1000, Math.round(Number(challenge.diceSides) || 2)));
const roll = () => Array.from({ length: diceCount }, () => 1 + Math.floor(this.random() * diceSides));
const playerRolls = roll();
const enemyRolls = roll();
const diceTotal = (values) => values.reduce((sum, value) => sum + value, 0);
const playerProfile = readCombatPlayerProfile(this.project, challenge.enemyMaxHealth, this.character);
const enemyAttributes = new Map((challenge.attributes || []).map((attribute) => [normalizeCombatAttribute(attribute.name), Number(attribute.enemyValue) || 0]));
const condition = challenge.victoryCondition || {
playerTerms: [
{ source: "playerAttribute", attribute: challenge.comparisonAttribute, operator: "+" },
{ source: "number", value: challenge.playerBonus, operator: "+" },
],
comparator: challenge.comparisonOperator || ">",
enemyTerms: [{ source: "enemyAttribute", attribute: challenge.comparisonAttribute, operator: "+" }],
};
const weaponDamage = readCombatItemDamage(this.project, inventoryAssetId);
const playerScore = evaluateCombatTerms(condition.playerTerms, { playerAttributes: playerProfile.attributes, enemyAttributes, weaponDamage }) + diceTotal(playerRolls);
const enemyScore = evaluateCombatTerms(condition.enemyTerms, { playerAttributes: playerProfile.attributes, enemyAttributes, weaponDamage }) + diceTotal(enemyRolls);
const comparator = condition.comparator || challenge.comparisonOperator || ">";
const wonRound = compareCombatScores(playerScore, comparator, enemyScore);
fight.rounds += 1;
fight.lastRolls = { player: playerRolls, enemy: enemyRolls, playerScore, enemyScore, wonRound };
const damage = Math.max(1, Math.round(Number(challenge.damagePerWin) || 1));
if (wonRound) fight.enemyHealth = Math.max(0, fight.enemyHealth - damage);
else {
fight.playerHealth = Math.max(0, fight.playerHealth - damage);
const healthAttribute = this.project.characterSheet?.attributes?.find((attribute) => normalizeCombatAttribute(attribute.name) === "vida");
if (healthAttribute) this.character.change(healthAttribute.id, -damage);
}
(challenge.roundAttributeEffects || []).forEach((effect) => {
this.character.change(effect.attributeId, wonRound ? effect.onWin : effect.onLoss);
});
const currentHealthAttribute = this.project.characterSheet?.attributes?.find((attribute) => normalizeCombatAttribute(attribute.name) === "vida");
if (currentHealthAttribute) {
  const currentHealth = this.character.value(currentHealthAttribute.id);
  fight.playerHealth = Math.max(0, currentHealth);
  if (currentHealth < 0) this.character.change(currentHealthAttribute.id, -currentHealth);
}

let roundMessage = wonRound
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
if (fight.finished && fight.result === "victory" && !this.completedCombatIds.has(challenge.id)) {
  this.completedCombatIds.add(challenge.id);
  this.character.award(this.project.characterSheet, "combat-won", challenge.id);
  const reward = challenge.victoryReward || {};
  if (reward.type === "object" && reward.assetId) this.inventory.addAttributeBonus(reward.assetId, reward.attributeId, reward.amount);
  else this.character.change(reward.attributeId, reward.amount);
}
this.onRender(this.state);
return { ok: true, wonRound, finished: fight.finished, result: fight.result, playerScore, enemyScore };
}

answerQuiz(quizId, { text = "", assetId = "" } = {}) {
if (!this.isPlaying || !this.state || !this.scene) return { ok: false };
const challenge = (this.scene.quizChallenges || []).find((item) => item.id === quizId);
if (!challenge || this.completedQuizIds.has(challenge.id)) return { ok: false };
let correct = false;
if (challenge.answerType === "inventory") {
  const selectedId = String(assetId || "");
  const selectedItem = this.inventory.items.find((item) => item.assetId === selectedId);
  if (!selectedItem) return { ok: false };
  correct = Boolean(challenge.expectedAssetId && selectedId === challenge.expectedAssetId);
} else {
  const expected = normalizeQuizAnswer(challenge.expectedText);
  if (!expected) return { ok: false };
  correct = normalizeQuizAnswer(text) === expected;
}
if (!correct) {
  const maxRetries = Math.min(10, Math.max(0, Math.round(Number(challenge.maxRetries) || 0)));
  const failedAttempts = (this.quizFailureCounts.get(challenge.id) || 0) + 1;
  this.quizFailureCounts.set(challenge.id, failedAttempts);
  const canRetry = failedAttempts <= maxRetries;
  if (!canRetry) this.completedQuizIds.add(challenge.id);
  const outcome = challenge.incorrectOutcome || {};
  if (outcome.type === "scene" && outcome.sceneId) this.unlockedQuizSceneIds.add(outcome.sceneId);
  if (outcome.type === "video" && outcome.videoId) this.unlockedQuizVideoIds.add(outcome.videoId);
  this.state.quizFeedback = {
    quizId: challenge.id,
    result: "incorrect",
    canRetry,
    failedAttempts,
    maxRetries,
    retriesRemaining: Math.max(0, maxRetries - failedAttempts + 1),
  };
  this.onRender(this.state);
  return { ok: false };
}
if (challenge.answerType === "inventory" && challenge.consumeItem && !this.inventory.consume(challenge.expectedAssetId)) {
  return { ok: false };
}
this.character.award(this.project.characterSheet, "quiz-solved", challenge.id);
this.completedQuizIds.add(challenge.id);
if (challenge.outcome.type === "scene" && challenge.outcome.sceneId) this.unlockedQuizSceneIds.add(challenge.outcome.sceneId);
if (challenge.outcome.type === "video" && challenge.outcome.videoId) this.unlockedQuizVideoIds.add(challenge.outcome.videoId);
this.state.quizFeedback = { quizId: challenge.id, result: "correct" };
this.onRender(this.state);
return { ok: true };
}

continueQuiz() {
if (!this.state?.quizFeedback) return false;
this.state.quizFeedback = null;
this.onRender(this.state);
return true;
}

isQuizCompleted(quizId) {
return this.completedQuizIds.has(String(quizId || ""));
}

resetQuizProgress() {
this.completedQuizIds.clear();
this.quizFailureCounts.clear();
this.unlockedQuizSceneIds.clear();
this.unlockedQuizVideoIds.clear();
if (this.state) this.state.quizFeedback = null;
}

  dispose() {
    this.generation += 1;
    this.timers.forEach((timer) => window.clearTimeout(timer));
    this.timers = [];
    this.audioElements.forEach((audio) => {
      audio.pause();
      audio.currentTime = 0;
    });
    this.audioElements = [];
    this.isPlaying = false;
  }
}
