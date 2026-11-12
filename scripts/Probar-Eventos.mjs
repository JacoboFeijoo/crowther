import assert from "node:assert/strict";
import { EventChallenge, ImageAsset, Project, SceneModule } from "../js/model.js";

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

const trap = new ImageAsset({ id: "trap-art", name: "Trampa.png" });
const event = new EventChallenge({
  id: "poison-trap",
  name: "Trampa venenosa",
  description: "Pisar la trampa libera veneno.",
  assetId: trap.id,
  attributeValues: { poison: 8 },
  conditions: [{
    id: "armor-check",
    playerAttributeId: "armor",
    comparator: ">=",
    eventAttributeId: "poison",
    modifier: 0,
  }],
});
const scene = new SceneModule({ id: "forest", name: "Bosque", eventChallenges: [event] });
const project = new Project({
  scenes: [scene],
  assets: [trap],
  objectAttributeDefinitions: [{ id: "poison", name: "Veneno" }],
  characterSheet: { attributes: [{ id: "armor", name: "Armadura", initialValue: 10 }] },
});
const restored = Project.fromJSON(project.toJSON());
const restoredEvent = restored.getScene("forest").eventChallenges[0];

assert.equal(restoredEvent.name, "Trampa venenosa", "el nombre del evento se conserva al exportar/importar");
assert.equal(restoredEvent.assetId, "trap-art", "el recurso asociado al evento se conserva");
assert.equal(restoredEvent.attributeValues.poison, 8, "los valores propios del evento se conservan");
assert.deepEqual(restoredEvent.conditions, [{
  id: "armor-check",
  playerAttributeId: "armor",
  comparator: ">=",
  eventAttributeId: "poison",
  modifier: 0,
}], "la condición compara atributos del jugador y del evento");
assert.equal(new SceneModule({ id: "legacy" }).eventChallenges.length, 0, "las escenas antiguas reciben una lista de eventos vacía");
assert.equal(new EventChallenge({ attributeValues: { poison: 100001 } }).attributeValues.poison, 100000, "los valores se limitan a un rango seguro");

console.log("Eventos: modelo y serialización correctos.");
