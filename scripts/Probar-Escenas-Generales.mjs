import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ImageAsset, Project, SceneModule } from "../js/model.js";

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

const assets = [
  new ImageAsset({ id: "global-background", name: "Fondo global" }),
  new ImageAsset({ id: "local-background", name: "Fondo local" }),
];
const inheritedScene = new SceneModule({ id: "inherits-general" });
const exceptionalScene = new SceneModule({
  id: "scene-exception",
  canvasStyle: {
    backgroundImageAssetId: "local-background",
    exceptGlobalBackground: true,
    transitionAnimation: "fade-white",
    exceptGlobalTransition: true,
  },
});
const project = new Project({
  scenes: [inheritedScene, exceptionalScene],
  assets,
  canvasBackgroundAllModules: true,
  canvasBackgroundImageAssetId: "global-background",
  sceneTransitionAnimation: "fade-black",
});

assert.equal(project.scenes[0].canvasStyle.backgroundImageAssetId, null,
  "la escena general hereda el fondo desde el proyecto y no duplica su referencia local");
assert.equal(project.scenes[0].canvasStyle.exceptGlobalBackground, false);
assert.equal(project.scenes[1].canvasStyle.backgroundImageAssetId, "local-background",
  "una excepción conserva su fondo específico");
assert.equal(project.scenes[1].canvasStyle.transitionAnimation, "fade-white");
assert.equal(project.sceneTransitionAnimation, "fade-black");
const crossfadeProject = Project.fromJSON(new Project({ sceneTransitionAnimation: "crossfade" }).toJSON());
assert.equal(crossfadeProject.sceneTransitionAnimation, "crossfade",
  "el proyecto conserva el fundido cruzado general");
const slideScene = new SceneModule({ canvasStyle: { transitionAnimation: "slide-right", exceptGlobalTransition: true } });
assert.equal(slideScene.canvasStyle.transitionAnimation, "slide-right",
  "la escena conserva el desplazamiento desde la derecha");

const newScene = project.addScene(new SceneModule({ id: "new-scene" }));
assert.equal(newScene.canvasStyle.backgroundImageAssetId, null,
  "una escena nueva hereda el fondo global sin copiarlo a su configuración local");
assert.equal(newScene.canvasStyle.exceptGlobalBackground, false);

const restored = Project.fromJSON(project.toJSON());
assert.equal(restored.canvasBackgroundImageAssetId, "global-background");
assert.equal(restored.sceneTransitionAnimation, "fade-black");
assert.equal(restored.getScene("scene-exception").canvasStyle.exceptGlobalBackground, true);
assert.equal(restored.getScene("scene-exception").canvasStyle.transitionAnimation, "fade-white");

const oldLocalProject = Project.fromJSON({
  version: 32,
  scenes: [{ id: "legacy-local", canvasStyle: { backgroundImageAssetId: "local-background" } }],
  assets: assets.map((asset) => asset.toJSON()),
});
assert.equal(oldLocalProject.getScene("legacy-local").canvasStyle.exceptGlobalBackground, true,
  "los fondos locales de proyectos anteriores se conservan como excepciones");
const oldGlobalProject = Project.fromJSON({
  version: 32,
  canvasBackgroundAllModules: true,
  canvasBackgroundImageAssetId: "global-background",
  scenes: [{ id: "legacy-global", canvasStyle: { backgroundImageAssetId: "local-background" } }],
  assets: assets.map((asset) => asset.toJSON()),
});
assert.equal(oldGlobalProject.getScene("legacy-global").canvasStyle.backgroundImageAssetId, "global-background",
  "los fondos generales de proyectos anteriores se migran sin perderse");

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const editor = await readFile(new URL("../js/editor.js", import.meta.url), "utf8");
const runtime = await readFile(new URL("../js/playable-runtime.js", import.meta.url), "utf8");
const playableCss = await readFile(new URL("../playable.css", import.meta.url), "utf8");
assert.match(html, /id="scenes-general-heading">Escenas/);
assert.doesNotMatch(html, /<h3 class="scenes-general-subheading">Lienzo<\/h3>/,
  "el apartado general de escenas ya no muestra el subtítulo Lienzo");
assert.match(html, /id="project-background-image"/);
assert.match(html, /Aplicar a todas las escenas/);
assert.match(html, /Exceptuar fondo general/);
assert.match(html, /id="scene-transition-exception"/);
assert.match(html, /value="crossfade">Fundido cruzado \(superposición\)<\/option>/);
assert.match(html, /value="slide-right">Desplazamiento desde la derecha<\/option>/);
assert.match(editor, /label\.append\(text, checkbox\)/,
  "el tic de borde queda visualmente detrás de su literal");
assert.match(editor, /expandedIds\.add\(`\$\{combatId\}:combat`\)/,
  "al seleccionar una caja de combate se abre su apartado Combate");
assert.match(editor, /setSidebarSectionCollapsed\("tool-combats", false, false\)/,
  "el clic desde el lienzo también despliega la sección principal Combates");
assert.match(editor, /captureSceneTransitionSnapshot\(scene, previousScene\)/);
assert.match(editor, /translateX\(-100%\)/,
  "el editor anima el desplazamiento de la escena anterior para revelar la nueva desde la derecha");
assert.match(runtime, /canvasStyle\.exceptGlobalBackground[\s\S]*project\.canvasBackgroundAllModules/);
assert.match(runtime, /style\.exceptGlobalTransition[\s\S]*project\.sceneTransitionAnimation/);
assert.match(runtime, /captureSceneTransitionSnapshot\(\)/);
assert.match(runtime, /value="crossfade"|crossfade/);
assert.match(playableCss, /\.scene-entry-transition-cover/,
  "las transiciones tienen estilo también en el paquete web exportado");
assert.match(playableCss, /\.scene-transition-snapshot/);

console.log(JSON.stringify({ status: "PASS", checks: 29 }));
