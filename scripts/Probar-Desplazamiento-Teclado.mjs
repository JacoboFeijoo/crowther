import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { InteractiveFictionEditor } from "../js/editor.js";
import { ImageAsset, Project, SceneModule } from "../js/model.js";

const editorStyles = await readFile(new URL("../styles.css", import.meta.url), "utf8");

globalThis.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 };
globalThis.DOMParser = class {
  parseFromString() {
    return { body: { childNodes: [] } };
  }
};
globalThis.document = {
  body: {},
  documentElement: {},
  createElement() {
    return {
      innerHTML: "",
      dataset: {},
      children: [],
      classList: { add() {}, remove() {}, toggle() {} },
      setAttribute() {},
      append(...items) { this.children.push(...items); },
    };
  },
  createTextNode(textContent) {
    return { nodeType: Node.TEXT_NODE, textContent };
  },
};

const editor = Object.create(InteractiveFictionEditor.prototype);
const layer = { id: "layer-1", xPct: 20, yPct: 70 };
const dialogue = { id: "dialogue-1", visible: true, zIndex: 2, placement: { xPct: 50, yPct: 69 } };
const focusedElements = [];
const scene = {
  dialogue,
  dialogues: [dialogue],
  getDialogue: (dialogueId) => dialogueId === dialogue.id ? dialogue : null,
  getLayer: (layerId) => layerId === layer.id ? layer : null,
};
Object.defineProperty(editor, "scene", { value: scene });
editor.isPreviewing = false;
editor.selectedLayerId = layer.id;
editor.selectedDialogueId = dialogue.id;
editor.activeSceneId = "scene-1";
editor.selectedDialogueBySceneId = new Map();
editor.selectedLayerBySceneId = new Map();
editor.hydrateDialogueEditors = () => {};
editor.updateAlignmentGuides = () => {};
editor.hideAlignmentGuides = () => {};
const dialogueElement = {
  dataset: { dialogueId: dialogue.id },
  style: {},
  classList: { add() {}, remove() {}, toggle() {} },
  querySelector: () => ({}),
  querySelectorAll: () => [],
  closest: (selector) => selector === ".dialogue-box" ? dialogueElement : null,
  focus: () => focusedElements.push("dialogue"),
  setPointerCapture() {},
  getBoundingClientRect: () => ({ left: 300, top: 300, right: 700, bottom: 420, width: 400, height: 120 }),
};
editor.dom = {
  stage: {
    focus: () => focusedElements.push("stage"),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 600 }),
    querySelectorAll: () => [],
    setPointerCapture() {},
  },
  dialogueLayer: {
    children: [dialogueElement],
    querySelectorAll: () => [dialogueElement],
  },
  dialogueZIndex: { disabled: false },
  removeDialogue: { disabled: false },
  dialogueCenterHorizontal: { checked: false },
  dialogueCenterVertical: { checked: false },
};
let dirtyCount = 0;
editor.renderInspector = () => {};
editor.markDirty = () => { dirtyCount += 1; };

function keyEvent(key, shiftKey = false) {
  return {
    key,
    shiftKey,
    prevented: false,
    preventDefault() { this.prevented = true; },
  };
}

const selectedLayerElement = { dataset: { layerId: layer.id } };
editor.beginLayerDrag({
  button: 0,
  pointerId: 1,
  target: { closest: (selector) => selector === ".scene-layer" ? selectedLayerElement : null },
  preventDefault() {},
});
assert.equal(focusedElements.at(-1), "stage", "selecting an image gives the keyboard controls focus");

const imageNudge = keyEvent("ArrowRight");
editor.nudgeSelectedLayer(imageNudge);
assert.equal(layer.xPct, 20.35, "an arrow nudges the selected image by the fine step");
assert.equal(layer.yPct, 70);
assert.equal(imageNudge.prevented, true, "the browser does not scroll while an image is nudged");

editor.nudgeSelectedLayer(keyEvent("ArrowUp", true));
assert.equal(layer.yPct, 68, "Shift accelerates image movement");

editor.beginDialogueDrag({
  button: 0,
  pointerId: 2,
  clientX: 500,
  clientY: 300,
  target: { closest: (selector) => selector === ".dialogue-box" ? dialogueElement : null },
  preventDefault() {},
  stopPropagation() {},
});
assert.equal(focusedElements.at(-1), "dialogue", "selecting the dialogue gives it keyboard focus");

const dialogueNudge = keyEvent("ArrowDown");
editor.nudgeDialogue(dialogueNudge);
assert.equal(dialogue.placement.yPct, 69.35, "an arrow nudges the dialogue by the fine step");
assert.equal(dialogueNudge.prevented, true, "the browser does not scroll while the dialogue is nudged");
assert.equal(dialogueElement.style.top, "69.35%");

editor.nudgeDialogue(keyEvent("ArrowLeft", true));
assert.equal(dialogue.placement.xPct, 48, "Shift accelerates dialogue movement");
assert.equal(dialogueElement.style.left, "48%");
assert.equal(dirtyCount, 4, "each keyboard movement is marked for automatic saving");

const upperLayer = { id: "layer-2", assetId: "asset-2", zIndex: 3 };
layer.zIndex = 1;
scene.stage = { layers: [layer, upperLayer] };
editor.renderAssets = () => {};
editor.setStackPosition("dialogue", dialogue.id, 1);
assert.deepEqual([dialogue.zIndex, layer.zIndex, upperLayer.zIndex], [1, 2, 3], "dialogue and image layers share the same editable stack");

globalThis.window = {
  getComputedStyle: () => ({ marginTop: "0px", marginBottom: "0px", rowGap: "0px" }),
};
const sizedPreview = { style: {} };
editor.dom = {
  canvasColumn: { clientHeight: 400, clientWidth: 2000 },
  canvasHeading: { getBoundingClientRect: () => ({ height: 40 }) },
  moduleTabsStrip: { getBoundingClientRect: () => ({ height: 32 }) },
  canvasFooter: { getBoundingClientRect: () => ({ height: 24 }) },
  gamePreview: sizedPreview,
};
editor.fitCanvasToViewport();
assert.equal(sizedPreview.style.height, "304px", "the stage fits inside the available monitor height");
assert.equal(sizedPreview.style.width, "540.4444444444445px", "the fitted stage retains a 16:9 ratio");

globalThis.document = {
  createDocumentFragment() {
    return { children: [], append(child) { this.children.push(child); } };
  },
  createElement() { return { style: {}, className: "", dataset: {}, setAttribute() {} }; },
};
const movingRect = { top: 240, bottom: 340, left: 160, right: 260 };
const otherRect = { top: 240, bottom: 400, left: 260, right: 600 };
const movingLayer = { getBoundingClientRect: () => movingRect };
const guideLines = [];
delete editor.updateAlignmentGuides;
editor.dom = {
  stage: { getBoundingClientRect: () => ({ left: 100, top: 200, width: 800, height: 450 }) },
  stageLayers: { querySelectorAll: () => [movingLayer] },
  dialogueLayer: { querySelectorAll: () => [{ getBoundingClientRect: () => otherRect, hidden: false }] },
  alignmentGuides: { replaceChildren(fragment) { guideLines.splice(0, guideLines.length, ...fragment.children); } },
};
editor.updateAlignmentGuides(movingLayer);
assert.deepEqual(guideLines.map((line) => line.className).sort(), [
  "alignment-guide alignment-guide-horizontal",
  "alignment-guide alignment-guide-vertical",
], "matching top and side edges show temporary alignment guides");
assert.equal(guideLines.find((line) => line.className.includes("horizontal")).style.top, "40px");
assert.equal(guideLines.find((line) => line.className.includes("vertical")).style.left, "160px");

console.log("Keyboard movement, alignment guides and viewport-fit tests passed.");

const selectedImage = { id: "selected-image", assetId: "asset-selected", xPct: 20, yPct: 25, widthPct: 20, zIndex: 1 };
const otherImage = { id: "other-image", assetId: "asset-other", xPct: 70, yPct: 60, widthPct: 30, zIndex: 2 };
const selectedAsset = { id: selectedImage.assetId, alt: "" };
const resizeCue = { targetLayerId: selectedImage.id };
const multiImageScene = {
  id: "multi-image-scene",
  stage: { layers: [selectedImage, otherImage] },
  timedCues: [resizeCue],
  normalizeStackPositions() {
    this.stage.layers.forEach((item, index) => { item.zIndex = index + 1; });
  },
  getLayer(id) { return this.stage.layers.find((item) => item.id === id) || null; },
};
const selectedStageImageElement = {
  dataset: { layerId: selectedImage.id },
  style: {},
  classList: { toggle() {} },
  querySelectorAll: () => [],
  getBoundingClientRect: () => ({ left: 100, top: 100, right: 300, bottom: 200, width: 200, height: 100 }),
};
const otherStageImageElement = {
  dataset: { layerId: otherImage.id },
  style: {},
  classList: { toggle() {} },
  querySelectorAll: () => [],
};
const multiImageEditor = Object.create(InteractiveFictionEditor.prototype);
Object.defineProperty(multiImageEditor, "scene", { value: multiImageScene });
const prunedMultiImageCompatibilityTargets = [];
multiImageEditor.store = { project: {
  getAsset(id) { return id === selectedAsset.id ? selectedAsset : null; },
  removeObjectCompatibilityTargets(layerIds) { prunedMultiImageCompatibilityTargets.push(...layerIds); },
} };
multiImageEditor.activeSceneId = multiImageScene.id;
multiImageEditor.selectedLayerId = selectedImage.id;
multiImageEditor.selectedDialogueId = null;
multiImageEditor.selectedLayerBySceneId = new Map();
multiImageEditor.selectedDialogueBySceneId = new Map();
multiImageEditor.isPreviewing = false;
multiImageEditor.renderInspector = () => {};
multiImageEditor.renderAssets = () => {};
multiImageEditor.hideAlignmentGuides = () => {};
multiImageEditor.updateAlignmentGuides = () => {};
multiImageEditor.hydrateDialogueEditors = () => {};
multiImageEditor.announce = () => {};
let scheduledLayerSaves = 0;
let multiImageDirtyCount = 0;
multiImageEditor.scheduleAutoSave = () => { scheduledLayerSaves += 1; };
multiImageEditor.markDirty = () => { multiImageDirtyCount += 1; };
const resizeStage = {
  focus() {},
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 600 }),
  querySelectorAll: () => [selectedStageImageElement, otherStageImageElement],
  setPointerCapture() {},
  hasPointerCapture: () => false,
};
multiImageEditor.dom = {
  stage: resizeStage,
  stageLayers: {
    children: [selectedStageImageElement, otherStageImageElement],
    querySelector: () => null,
  },
  dialogueLayer: { querySelectorAll: () => [] },
  dialogueZIndex: { disabled: false },
  removeDialogue: { disabled: false },
  layerX: { value: "20" },
  layerY: { value: "25" },
  layerWidth: { value: "20" },
  layerAlt: { value: "Imagen seleccionada" },
};
const resizeHandle = { dataset: { resizeHandle: "se" } };
multiImageEditor.beginLayerDrag({
  button: 0,
  pointerId: 10,
  clientX: 304,
  clientY: 204,
  target: { closest(selector) { return selector === "[data-resize-handle]" ? resizeHandle : selector === ".scene-layer" ? selectedStageImageElement : null; } },
  preventDefault() {},
});
multiImageEditor.moveLayerDrag({ pointerId: 10, clientX: 304, clientY: 204 });
assert.equal(selectedImage.widthPct, 20, "clicking inside a resize handle does not cause an initial size jump");
assert.equal(selectedImage.xPct, 20, "the opposite image corner remains anchored at the beginning of resizing");
multiImageEditor.moveLayerDrag({ pointerId: 10, clientX: 344, clientY: 204 });
assert.equal(selectedImage.widthPct, 24, "resizing updates only the selected image layer");
assert.equal(selectedImage.xPct, 22, "proportional resizing keeps the anchor and aspect ratio");
assert.deepEqual([otherImage.xPct, otherImage.yPct, otherImage.widthPct], [70, 60, 30], "another image remains unchanged during resizing");
assert.equal(multiImageScene.stage.layers.length, 2, "resizing does not duplicate any scene image");

multiImageEditor.dom.layerX.value = "22";
multiImageEditor.dom.layerY.value = "26.67";
multiImageEditor.dom.layerWidth.value = "37.5";
multiImageEditor.updateLayerInspector();
assert.equal(selectedImage.widthPct, 37.5, "manual width entry updates the selected layer");
assert.equal(selectedStageImageElement.style.width, "37.5%", "manual width updates the existing stage element in place");
assert.equal(otherStageImageElement.style.width, undefined, "manual width does not recreate or resize the other image");
assert.equal(multiImageScene.stage.layers.length, 2, "manual width entry preserves the number of image layers");
assert.equal(scheduledLayerSaves, 1, "manual layer edits still schedule automatic saving without a full render");

const deleteEvent = keyEvent("Delete");
multiImageEditor.nudgeSelectedLayer(deleteEvent);
assert.equal(deleteEvent.prevented, true, "Delete is handled by the editor instead of the browser");
assert.deepEqual(prunedMultiImageCompatibilityTargets, [selectedImage.id], "deleting a stage image clears compatibility references to it");
assert.deepEqual(multiImageScene.stage.layers.map((item) => item.id), [otherImage.id], "Delete removes only the selected image from the scene");
assert.equal(multiImageScene.timedCues[0].targetLayerId, null, "timed cues no longer target a deleted scene layer");
assert.equal(multiImageEditor.project.getAsset(selectedAsset.id), selectedAsset, "deleting a stage image preserves its project resource");
assert.equal(multiImageDirtyCount, 1, "deleting an image marks the project for automatic saving");

console.log("Multi-image resizing, in-place inspector updates and Delete removal tests passed.");

const reusedAsset = { id: "asset-reused", name: "Negrata.png", alt: "Pirata" };
const draggedAsset = { id: "asset-dragged", name: "Barco.png", alt: "Barco" };
const existingInstance = { id: "instance-1", assetId: reusedAsset.id, xPct: 45, yPct: 50, widthPct: 30, zIndex: 1 };
const reusableScene = {
  id: "reusable-scene",
  assetIds: [reusedAsset.id],
  stage: { layers: [existingInstance] },
  dialogues: [],
  timedCues: [],
  normalizeStackPositions() {
    this.stage.layers.forEach((item, index) => { item.zIndex = index + 1; });
  },
  getLayer(id) { return this.stage.layers.find((item) => item.id === id) || null; },
};
const reusableEditor = Object.create(InteractiveFictionEditor.prototype);
Object.defineProperty(reusableEditor, "scene", { value: reusableScene });
const prunedCompatibilityTargets = [];
reusableEditor.store = { project: {
  getAsset(id) { return id === reusedAsset.id ? reusedAsset : id === draggedAsset.id ? draggedAsset : null; },
  removeObjectCompatibilityTargets(layerIds) { prunedCompatibilityTargets.push(...layerIds); },
} };
reusableEditor.activeSceneId = reusableScene.id;
reusableEditor.selectedLayerId = null;
reusableEditor.selectedDialogueId = null;
reusableEditor.selectedLayerBySceneId = new Map();
reusableEditor.selectedDialogueBySceneId = new Map();
reusableEditor.isPreviewing = false;
let refreshedResourceCards = 0;
reusableEditor.hydrateDialogueEditors = () => {};
reusableEditor.renderInspector = () => {};
reusableEditor.renderPreview = () => {};
reusableEditor.renderAssets = () => { refreshedResourceCards += 1; };
reusableEditor.announce = () => {};
reusableEditor.markDirty = () => {};
reusableEditor.getNaturalWidthPct = () => 30;
const assetButton = { disabled: false, dataset: { assetId: reusedAsset.id } };
reusableEditor.addAssetToStage({ target: { closest: (selector) => selector === "[data-asset-add]" ? assetButton : null } });
assert.equal(reusableScene.stage.layers.length, 1, "clicking an existing resource selects it instead of silently making a duplicate");
assert.equal(reusableEditor.selectedLayerId, existingInstance.id, "the existing image becomes the selected stage layer");
assert.equal(refreshedResourceCards, 1, "resource positions refresh when selecting a stage image");

reusableEditor.addAnotherAssetLayer(reusedAsset.id);
assert.equal(reusableScene.stage.layers.length, 2, "the dedicated plus action still allows intentional image copies");
assert.notEqual(reusableEditor.selectedLayerId, existingInstance.id, "an intentional new copy becomes selected");
assert.equal(refreshedResourceCards, 2, "resource positions refresh after adding a deliberate copy");

const selectedCopyId = reusableEditor.selectedLayerId;
const stageTarget = { closest: () => null };
reusableEditor.dom = {
  stage: { contains: (target) => target === stageTarget },
  assetList: { contains: () => false },
};
const globalDeleteEvent = {
  key: "Unidentified",
  code: "NumpadDecimal",
  keyCode: 46,
  target: stageTarget,
  prevented: false,
  stopped: false,
  preventDefault() { this.prevented = true; },
  stopPropagation() { this.stopped = true; },
};
assert.equal(typeof reusableEditor.project.removeObjectCompatibilityTargets, "function", "the project can clean deleted image links");
reusableEditor.handleSelectedLayerDelete(globalDeleteEvent);
assert.equal(globalDeleteEvent.prevented, true, "Supr from the stage is handled globally");
assert.deepEqual(prunedCompatibilityTargets, [selectedCopyId], "deleting an image also clears compatibility references to that layer");
assert.equal(reusableScene.stage.layers.length, 1, "Supr removes only the currently selected image instance");
assert.equal(reusableScene.stage.layers[0].id, existingInstance.id, "the other image instance is preserved");
assert.notEqual(reusableEditor.selectedLayerId, selectedCopyId, "the remaining instance becomes selected after deletion");

const deletableScene = new SceneModule({
  id: "delete-entities-scene",
  decisions: { choices: [{ id: "choice-to-delete", label: "Bajar la escalera" }] },
  quizChallenges: [{ id: "quiz-to-delete" }],
  combatChallenges: [{ id: "combat-to-delete" }],
});
const deletableEditor = Object.create(InteractiveFictionEditor.prototype);
Object.defineProperty(deletableEditor, "scene", { value: deletableScene });
deletableEditor.isPreviewing = false;
deletableEditor.selectedDialogueId = deletableScene.dialogues[0]?.id;
deletableEditor.selectedChoiceId = null;
deletableEditor.selectedQuizBox = null;
deletableEditor.selectedCombatBoxId = null;
deletableEditor.selectedLayerId = null;
deletableEditor.dom = {
  gamePreview: { contains: () => true },
  stage: { contains: () => false },
  assetList: { contains: () => false },
  choiceList: { querySelectorAll: () => deletableScene.decisions.choices.map((choice) => ({
    dataset: { choiceId: choice.id }, querySelector: () => ({ click: () => deletableScene.decisions.removeChoice(choice.id) }),
  })) },
  quizList: { querySelectorAll: () => deletableScene.quizChallenges.map((quiz) => ({
    dataset: { quizId: quiz.id }, querySelector: () => ({ click: () => { deletableScene.quizChallenges = deletableScene.quizChallenges.filter((item) => item.id !== quiz.id); } }),
  })) },
  combatList: { querySelectorAll: () => deletableScene.combatChallenges.map((combat) => ({
    dataset: { combatId: combat.id, combatSection: "combat" }, querySelector: () => ({ click: () => { deletableScene.combatChallenges = deletableScene.combatChallenges.filter((item) => item.id !== combat.id); } }),
  })) },
};
deletableEditor.removeDialogue = () => { deletableScene.dialogues = []; };
const deleteEntity = (kind, id) => {
  const selector = {
    dialogue: ".dialogue-box[data-dialogue-id]",
    choice: ".choice-button[data-choice-id]",
    quiz: ".quiz-box[data-quiz-id]",
    combat: ".combat-box[data-combat-box]",
  }[kind];
  const datasetKey = { dialogue: "dialogueId", choice: "choiceId", quiz: "quizId", combat: "combatBox" }[kind];
  const target = { closest: (query) => query === selector ? { dataset: { [datasetKey]: id } } : null };
  const event = {
    key: "Unidentified", code: "NumpadDecimal", keyCode: 46, target, prevented: false,
    preventDefault() { this.prevented = true; }, stopPropagation() {}, stopImmediatePropagation() {},
  };
  deletableEditor.handleSelectedLayerDelete(event);
  assert.equal(event.prevented, true, `Supr deletes a focused ${kind}`);
};
deleteEntity("dialogue", deletableScene.dialogues[0].id);
assert.equal(deletableScene.dialogues.length, 0, "Supr removes the focused dialogue box");
deletableScene.dialogues.push({ id: "dialogue-rich-text-to-delete" });
deletableEditor.selectedDialogueId = "dialogue-rich-text-to-delete";
const editableDialogueTarget = {
  closest(selector) {
    if (selector.includes(".dialogue-box[data-dialogue-id]")) return { dataset: { dialogueId: "dialogue-rich-text-to-delete" } };
    if (selector.includes("[contenteditable]")) return this;
    return null;
  },
};
const editableDialogueDelete = {
  key: "Delete", code: "Delete", target: editableDialogueTarget, prevented: false,
  preventDefault() { this.prevented = true; }, stopPropagation() {}, stopImmediatePropagation() {},
};
deletableEditor.handleSelectedLayerDelete(editableDialogueDelete);
assert.equal(editableDialogueDelete.prevented, true, "Supr can remove a selected scene box even when its rich-text area has focus");
assert.equal(deletableScene.dialogues.length, 0, "the selected dialogue with rich text focus is removed as a scene object");
deleteEntity("choice", "choice-to-delete");
assert.equal(deletableScene.decisions.choices.length, 0, "Supr removes the focused decision");
deleteEntity("quiz", "quiz-to-delete");
assert.equal(deletableScene.quizChallenges.length, 0, "Supr removes the focused quiz challenge");
deleteEntity("combat", "combat-to-delete");
assert.equal(deletableScene.combatChallenges.length, 0, "Supr removes the focused combat challenge");

deletableEditor.dom.gamePreview = { contains: (target) => target !== document.body && target !== document.documentElement };
const deleteAfterCanvasRender = (kind, id) => {
  const event = {
    key: "Delete", code: "Delete", target: document.body, prevented: false,
    preventDefault() { this.prevented = true; }, stopPropagation() {}, stopImmediatePropagation() {},
  };
  if (kind === "dialogue") {
    deletableScene.dialogues.push({ id });
    deletableEditor.selectedDialogueId = id;
  } else if (kind === "choice") {
    deletableScene.decisions.choices.push({ id });
    deletableEditor.selectedChoiceId = id;
  } else if (kind === "quiz") {
    deletableScene.quizChallenges.push({ id });
    deletableEditor.selectedQuizBox = { quizId: id, role: "question" };
  } else if (kind === "combat") {
    deletableScene.combatChallenges.push({ id });
    deletableEditor.selectedCombatBoxId = id;
  }
  deletableEditor.handleSelectedLayerDelete(event);
  assert.equal(event.prevented, true, `Supr still works for selected ${kind} after canvas rerender drops focus to body`);
  const remaining = kind === "dialogue" ? deletableScene.dialogues
    : kind === "choice" ? deletableScene.decisions.choices
      : kind === "quiz" ? deletableScene.quizChallenges : deletableScene.combatChallenges;
  assert.equal(remaining.some((item) => item.id === id), false, `the selected ${kind} is removed using persisted selection after focus loss`);
};
deleteAfterCanvasRender("dialogue", "dialogue-after-rerender");
deleteAfterCanvasRender("choice", "choice-after-rerender");
deleteAfterCanvasRender("quiz", "quiz-after-rerender");
deleteAfterCanvasRender("combat", "combat-after-rerender");

reusableScene.assetIds.push(draggedAsset.id);
reusableEditor.dom.stage = {
  contains: (target) => target === stageTarget,
  getBoundingClientRect: () => ({ left: 100, top: 50, width: 400, height: 200 }),
};
reusableEditor.dom.stageLayers = { children: [] };
reusableEditor.draggedResource = { type: "image", id: draggedAsset.id, sourceSceneId: reusableScene.id };
let droppedDefaultPrevented = false;
let droppedPropagationStopped = false;
const resourceDropEvent = {
  dataTransfer: {
    types: ["application/x-crowther-resource", "text/plain"],
    getData: (type) => type === "application/x-crowther-resource"
      ? JSON.stringify(reusableEditor.draggedResource)
      : draggedAsset.id,
  },
  clientX: 200,
  clientY: 110,
  preventDefault() { droppedDefaultPrevented = true; },
  stopPropagation() { droppedPropagationStopped = true; },
};
assert.equal(reusableEditor.handleStageResourceDrop(resourceDropEvent), true, "dropping an image from Recursos is handled as an internal asset, not plain text");
assert.equal(droppedDefaultPrevented, true, "the browser cannot insert the resource UUID onto the canvas");
assert.equal(droppedPropagationStopped, true, "the handled image drop does not bubble into text insertion handlers");
assert.equal(reusableScene.stage.layers.length, 2, "dragging a new resource to the canvas adds one image layer");
assert.equal(reusableScene.stage.layers.at(-1).assetId, draggedAsset.id, "the dropped layer uses the resource image rather than its identifier");
assert.deepEqual([reusableScene.stage.layers.at(-1).xPct, reusableScene.stage.layers.at(-1).yPct], [25, 30], "a dropped image is placed at the pointer position on the canvas");
let dragPreview = null;
let dragPreviewHotspot = null;
const dragImageElement = { getBoundingClientRect: () => ({ width: 80, height: 100 }) };
const dragCard = {
  dataset: { assetId: draggedAsset.id },
  classList: { add() {} },
  querySelector: () => dragImageElement,
};
reusableEditor.dom.assetList.contains = (card) => card === dragCard;
reusableEditor.beginResourceDrag({
  target: { closest: (selector) => selector === ".asset-card" ? dragCard : null },
  dataTransfer: {
    setData() {},
    setDragImage(image, x, y) { dragPreview = image; dragPreviewHotspot = [x, y]; },
  },
});
assert.equal(dragPreview, dragImageElement, "the drag ghost follows the image artwork instead of showing an opaque asset card");
assert.deepEqual(dragPreviewHotspot, [40, 50], "the drag ghost stays centered beneath the pointer");
assert.match(editorStyles, /\.scene-layer\.is-drop-entering\s*\{\s*animation:/, "the image lands on the canvas with a short easing animation");

console.log("Resource selection, explicit copies, smooth stage drop, stack refresh and focused Supr tests passed.");

const choice = { id: "choice-move", placement: { xPct: 50, yPct: 80, widthPct: 50, heightPct: 10 } };
const decisionScene = { decisions: { choices: [choice], promptPlacement: { xPct: 50, yPct: 62, widthPct: 88, heightPct: null } } };
const choiceElement = {
  dataset: { choiceId: choice.id },
  style: {},
  children: [],
  classList: { add() {}, remove() {}, toggle() {} },
  querySelector(selector) {
    const id = selector.match(/="([^"]+)"/)?.[1];
    return this.children.find((child) => child.dataset?.decisionResizeHandle === id) || null;
  },
  querySelectorAll(selector) {
    return selector === ".decision-resize-handle"
      ? this.children.filter((child) => child.className === "resize-handle decision-resize-handle")
      : [];
  },
  append(child) { this.children.push(child); },
  closest(selector) { return selector === ".choice-button[data-choice-id]" ? this : null; },
  focus() {},
  setPointerCapture() {},
  hasPointerCapture() { return false; },
  releasePointerCapture() {},
  getBoundingClientRect() { return { left: 300, top: 480, right: 800, bottom: 540, width: 500, height: 60 }; },
};
const choiceEditor = Object.create(InteractiveFictionEditor.prototype);
Object.defineProperty(choiceEditor, "scene", { value: decisionScene });
choiceEditor.isPreviewing = false;
choiceEditor.selectedChoiceId = null;
choiceEditor.updateAlignmentGuides = () => {};
choiceEditor.hideAlignmentGuides = () => {};
let choiceDirtyCount = 0;
choiceEditor.markDirty = () => { choiceDirtyCount += 1; };
choiceEditor.dom = {
  gamePreview: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 600 }) },
  choicePreview: {
    querySelectorAll: () => [choiceElement],
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 600 }),
  },
};
function choicePointerEvent(pointerId, clientX, clientY, resizeHandle = null) {
  return {
    button: 0,
    pointerId,
    clientX,
    clientY,
    target: {
      closest(selector) {
        if (selector === ".choice-button[data-choice-id]") return choiceElement;
        if (selector === "[data-decision-resize-handle]") return resizeHandle;
        return null;
      },
    },
    preventDefault() {},
    stopPropagation() {},
  };
}
choiceEditor.beginChoiceDrag(choicePointerEvent(22, 500, 480));
choiceEditor.moveChoiceDrag({ pointerId: 22, clientX: 550, clientY: 510 });
choiceEditor.endChoiceDrag({ pointerId: 22 });
assert.deepEqual([choice.placement.xPct, choice.placement.yPct], [55, 85], "dragging a decision box updates its saved position");
const southeastHandle = choiceElement.children.find((child) => child.dataset.decisionResizeHandle === "se");
choiceEditor.beginChoiceDrag(choicePointerEvent(23, 800, 540, southeastHandle));
choiceEditor.moveChoiceDrag({ pointerId: 23, clientX: 700, clientY: 520 });
choiceEditor.endChoiceDrag({ pointerId: 23 });
assert.equal(choice.placement.widthPct, 40, "the decision resize handle updates box width");
assert.equal(choice.placement.heightPct, 40 / 6, "the decision resize handle updates box height independently");
const decisionNudge = keyEvent("ArrowRight");
decisionNudge.target = { closest: (selector) => selector === ".choice-button" ? choiceElement : null };
choiceEditor.nudgeChoice(decisionNudge);
assert.ok(Math.abs(choice.placement.xPct - 50.35) < 0.0001, "focused decisions support fine keyboard movement");
assert.equal(choiceDirtyCount, 3, "decision moves and resizing are marked for automatic saving");

console.log("Decision move, independent resize and keyboard movement tests passed.");

const quizChallenge = {
  id: "quiz-drag",
  questionPlacement: { xPct: 50, yPct: 40, widthPct: 40, heightPct: 20 },
  answerPlacement: { xPct: 50, yPct: 70, widthPct: 50, heightPct: 20 },
};
const quizScene = { quizChallenges: [quizChallenge] };
const quizBoxElement = {
  dataset: { quizId: quizChallenge.id, quizBoxRole: "question" },
  style: {},
  children: [],
  classList: { add() {}, remove() {}, toggle() {} },
  querySelector(selector) {
    const id = selector.match(/="([^"]+)"/)?.[1];
    return this.children.find((child) => child.dataset?.quizResizeHandle === id) || null;
  },
  querySelectorAll(selector) {
    return selector === ".quiz-resize-handle"
      ? this.children.filter((child) => child.className === "resize-handle quiz-resize-handle")
      : [];
  },
  append(child) { this.children.push(child); },
  closest(selector) { return selector === ".quiz-box[data-quiz-box-role]" ? this : null; },
  focus() {},
  setPointerCapture() {},
  hasPointerCapture() { return false; },
  releasePointerCapture() {},
  getBoundingClientRect() { return { left: 300, top: 240, right: 700, bottom: 360, width: 400, height: 120 }; },
};
const quizEditor = Object.create(InteractiveFictionEditor.prototype);
Object.defineProperty(quizEditor, "scene", { value: quizScene });
quizEditor.isPreviewing = false;
quizEditor.selectedQuizBox = null;
quizEditor.selectedChoiceId = null;
quizEditor.clearSelectedChoice = () => {};
quizEditor.getCanvasMinimumCenterXPct = () => 0;
quizEditor.getCanvasLayoutBoundaryPx = () => 0;
quizEditor.updateAlignmentGuides = () => {};
quizEditor.hideAlignmentGuides = () => {};
let quizDirtyCount = 0;
quizEditor.markDirty = () => { quizDirtyCount += 1; };
quizEditor.dom = {
  stage: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 600 }) },
  choicePreview: {
    querySelectorAll: () => [quizBoxElement],
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 600 }),
  },
};
function quizPointerEvent(pointerId, clientX, clientY, resizeHandle = null) {
  return {
    button: 0,
    pointerId,
    clientX,
    clientY,
    target: {
      closest(selector) {
        if (selector === ".quiz-box[data-quiz-box-role]") return quizBoxElement;
        if (selector === "[data-quiz-resize-handle]") return resizeHandle;
        return null;
      },
    },
    preventDefault() {},
    stopPropagation() {},
  };
}
quizEditor.beginChoiceDrag(quizPointerEvent(31, 500, 300));
quizEditor.moveQuizDrag({ pointerId: 31, clientX: 540, clientY: 330 });
quizEditor.endQuizDrag({ pointerId: 31 });
assert.deepEqual([quizChallenge.questionPlacement.xPct, quizChallenge.questionPlacement.yPct], [54, 45], "Quiz question boxes can be moved by dragging");
const quizSoutheastHandle = quizBoxElement.children.find((child) => child.dataset.quizResizeHandle === "se");
quizEditor.beginChoiceDrag(quizPointerEvent(32, 700, 360, quizSoutheastHandle));
quizEditor.moveQuizDrag({ pointerId: 32, clientX: 800, clientY: 420 });
quizEditor.endQuizDrag({ pointerId: 32 });
assert.deepEqual([quizChallenge.questionPlacement.widthPct, quizChallenge.questionPlacement.heightPct], [50, 30], "Quiz box corners resize width and height independently");
const quizNudge = keyEvent("ArrowLeft");
quizNudge.target = { closest: (selector) => selector === ".quiz-box[data-quiz-box-role]" ? quizBoxElement : null };
quizEditor.nudgeQuizBox(quizNudge);
assert.ok(Math.abs(quizChallenge.questionPlacement.xPct - 54.65) < 0.0001, "Quiz boxes also move with the keyboard by the fine step");
assert.equal(quizNudge.prevented, true, "arrow movement on a Quiz box does not scroll the page");
assert.equal(quizDirtyCount, 3, "Quiz box movement, resizing and keyboard nudging are marked for autosave");

console.log("Quiz boxes support drag movement and independent corner resizing.");

const promptElement = {
  style: {},
  classList: { add() {}, remove() {} },
  closest(selector) { return selector === ".choice-prompt" ? promptElement : null; },
  focus() {},
  setPointerCapture() {},
  hasPointerCapture() { return false; },
};
choiceEditor.dom.choicePreview.querySelectorAll = () => [choiceElement];
function promptPointerEvent(pointerId, clientX, clientY) {
  return {
    button: 0,
    pointerId,
    clientX,
    clientY,
    target: {
      closest(selector) {
        return selector === ".choice-prompt" ? promptElement : null;
      },
    },
    preventDefault() {},
    stopPropagation() {},
  };
}
choiceEditor.beginChoiceDrag(promptPointerEvent(24, 500, 372));
choiceEditor.moveChoiceDrag({ pointerId: 24, clientX: 550, clientY: 402 });
choiceEditor.endChoiceDrag({ pointerId: 24 });
assert.deepEqual(
  [decisionScene.decisions.promptPlacement.xPct, decisionScene.decisions.promptPlacement.yPct],
  [55, 67],
  "the ¿Qué decides? prompt can be dragged to a saved position",
);
const promptNudge = keyEvent("ArrowUp", true);
promptNudge.target = { closest: (selector) => selector === ".choice-prompt" ? promptElement : null };
choiceEditor.nudgeChoice(promptNudge);
assert.equal(decisionScene.decisions.promptPlacement.yPct, 65, "the movable prompt supports accelerated keyboard movement");
assert.equal(choiceDirtyCount, 5, "prompt movement and nudging are marked for automatic saving");

console.log("Decision prompt drag and keyboard movement tests passed.");

function makeTransferEditor(project, sourceSceneId) {
  const transferEditor = Object.create(InteractiveFictionEditor.prototype);
  transferEditor.store = { project };
  transferEditor.activeSceneId = sourceSceneId;
  transferEditor.openSceneIds = [sourceSceneId];
  transferEditor.selectedLayerId = project.getScene(sourceSceneId).stage.layers[0]?.id ?? null;
  transferEditor.selectedDialogueId = null;
  transferEditor.selectedLayerBySceneId = new Map([[sourceSceneId, transferEditor.selectedLayerId]]);
  transferEditor.selectedDialogueBySceneId = new Map([[sourceSceneId, null]]);
  transferEditor.selectedSoundIdsBySceneId = new Map();
  transferEditor.pendingResourceTransfer = null;
  transferEditor.dom = {
    resourceTransferDialog: {
      open: false,
      showModal() { this.open = true; },
      close() { this.open = false; },
      removeAttribute() { this.open = false; },
      contains() { return true; },
    },
    resourceTransferMessage: { textContent: "" },
    assetModuleTabs: { contains: () => true, querySelectorAll: () => [] },
    assetList: { querySelectorAll: () => [] },
  };
  transferEditor.getNaturalWidthPct = () => 30;
  transferEditor.hydrateDialogueEditors = () => {};
  transferEditor.renderAll = () => {};
  transferEditor.markDirty = () => {};
  transferEditor.announce = () => {};
  transferEditor.openScene = function openScene(sceneId) {
    this.activeSceneId = sceneId;
    this.selectedLayerId = this.selectedLayerBySceneId.get(sceneId) ?? this.scene.stage.layers[0]?.id ?? null;
    this.selectedDialogueId = null;
  };
  return transferEditor;
}

function dropImageOnModule(transferEditor, imageId, sourceSceneId, sourceName, targetSceneId, targetName, action) {
  const tab = { dataset: { resourceScene: targetSceneId } };
  transferEditor.draggedResource = { type: "image", id: imageId, sourceSceneId };
  let dropPrevented = false;
  transferEditor.dropResourceOnModule({
    target: { closest: (selector) => selector === "[data-resource-scene]" ? tab : null },
    preventDefault() { dropPrevented = true; },
  });
  assert.equal(dropPrevented, true, "dropping a resource on another module is handled by the editor");
  assert.equal(transferEditor.dom.resourceTransferDialog.open, true, "dropping opens the move/copy prompt");
  assert.match(transferEditor.dom.resourceTransferMessage.textContent, /FF\.png/);
  assert.match(transferEditor.dom.resourceTransferMessage.textContent, new RegExp(sourceName));
  assert.match(transferEditor.dom.resourceTransferMessage.textContent, new RegExp(targetName));
  const button = { dataset: { resourceTransferAction: action } };
  transferEditor.handleResourceTransferAction({
    target: { closest: (selector) => selector === "[data-resource-transfer-action]" ? button : null },
    preventDefault() {},
  });
}

const moveScene = new SceneModule({
  id: "drag-source",
  name: "Escena 2",
  assetIds: ["drag-image"],
  stage: { layers: [{ id: "drag-layer", assetId: "drag-image" }] },
});
const moveDestination = new SceneModule({ id: "drag-destination", name: "Llegada al muelle" });
const dragProject = new Project({
  scenes: [moveScene, moveDestination],
  assets: [new ImageAsset({ id: "drag-image", name: "FF.png" })],
});
const transferEditor = makeTransferEditor(dragProject, moveScene.id);
dropImageOnModule(transferEditor, "drag-image", moveScene.id, moveScene.name, moveDestination.id, moveDestination.name, "move");
assert.deepEqual(moveScene.assetIds, [], "moving the resource removes it from its original module");
assert.deepEqual(moveScene.stage.layers, [], "moving the resource removes its old canvas instance");
assert.deepEqual(moveDestination.assetIds, ["drag-image"], "moving assigns the resource to the destination module");
assert.equal(moveDestination.stage.layers[0].assetId, "drag-image", "moving creates a visible image layer on the destination canvas");
assert.equal(transferEditor.activeSceneId, moveDestination.id, "the editor opens the destination module after transfer");

const copyScene = new SceneModule({
  id: "copy-drag-source",
  name: "Escena original",
  assetIds: ["copy-drag-image"],
  stage: { layers: [{ id: "copy-drag-layer", assetId: "copy-drag-image" }] },
});
const copyDestination = new SceneModule({ id: "copy-drag-destination", name: "Escena copiada" });
const copyDragProject = new Project({
  scenes: [copyScene, copyDestination],
  assets: [new ImageAsset({ id: "copy-drag-image", name: "FF.png" })],
});
const copyTransferEditor = makeTransferEditor(copyDragProject, copyScene.id);
dropImageOnModule(copyTransferEditor, "copy-drag-image", copyScene.id, copyScene.name, copyDestination.id, copyDestination.name, "copy");
assert.deepEqual(copyScene.assetIds, ["copy-drag-image"], "copying leaves the original resource assigned");
assert.equal(copyScene.stage.layers[0].id, "copy-drag-layer", "copying leaves the original canvas instance intact");
assert.deepEqual(copyDestination.assetIds, ["copy-drag-image"], "copying also assigns the resource to the destination module");
assert.equal(copyDestination.stage.layers[0].assetId, "copy-drag-image", "copying creates a visible image layer on the destination canvas");

console.log("Resource drag move/copy and destination-canvas tests passed.");

const inventoryEditor = Object.create(InteractiveFictionEditor.prototype);
const inventoryProject = new Project({
  scenes: [new SceneModule({ id: "inventory-grid-scene" })],
  inventoryGrid: { columns: 3, rows: 2 },
});
inventoryEditor.store = { project: inventoryProject };
function fakeGridBoard() {
  return {
    children: [],
    attributes: {},
    style: { setProperty(name, value) { this[name] = value; } },
    setAttribute(name, value) { this.attributes[name] = value; },
    replaceChildren(fragment) { this.children = [...fragment.children]; },
  };
}
const explorerGrid = fakeGridBoard();
const canvasInventoryGrid = fakeGridBoard();
const inventorySummary = { textContent: "" };
const canvasInventorySummary = { textContent: "" };
const inventorySelect = {
  options: [],
  value: "",
  replaceChildren(fragment) { this.options = [...fragment.children]; },
};
const previousDocument = globalThis.document;
globalThis.document = {
  createDocumentFragment() {
    return { children: [], append(child) { this.children.push(child); } };
  },
  createElement() {
    return { attributes: {}, setAttribute(name, value) { this.attributes[name] = value; } };
  },
};
inventoryEditor.dom = {
  inventoryGridSelect: inventorySelect,
  inventoryGridSummary: inventorySummary,
  inventoryGridBoard: explorerGrid,
  inventoryItems: canvasInventoryGrid,
  inventoryPanelSummary: canvasInventorySummary,
};
inventoryEditor.renderInventoryGrid();
assert.equal(explorerGrid.children.length, 6, "the Explorer displays the configured two-by-three inventory grid");
assert.equal(canvasInventoryGrid.children.length, 6, "the canvas inventory displays the same number of slots");
assert.equal(canvasInventoryGrid.style["--inventory-columns"], "3", "the canvas inventory preserves the configured column count");
assert.equal(canvasInventorySummary.textContent, inventorySummary.textContent, "Explorer and canvas inventory summaries stay synchronized");
inventoryProject.inventoryGrid = { columns: 4, rows: 2 };
inventoryEditor.renderInventoryGrid();
assert.equal(explorerGrid.children.length, 8, "changing the grid updates the Explorer preview");
assert.equal(canvasInventoryGrid.children.length, 8, "changing the grid updates the canvas inventory at the same time");
assert.equal(canvasInventoryGrid.style["--inventory-columns"], "4", "the updated canvas grid keeps its four-column shape");
globalThis.document = previousDocument;
console.log("Explorer and canvas inventory grid synchronization tests passed.");
