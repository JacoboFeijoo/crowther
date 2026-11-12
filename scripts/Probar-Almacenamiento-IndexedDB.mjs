import assert from "node:assert/strict";
import { ProjectRepository } from "../js/storage.js";
import { createStarterProject, SceneModule, SoundAsset } from "../js/model.js";

globalThis.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 };
globalThis.DOMParser = class {
  parseFromString() { return { body: { childNodes: [] } }; }
};
globalThis.document = {
  createElement() { return { innerHTML: "", append() {} }; },
  createTextNode(textContent) { return { nodeType: Node.TEXT_NODE, textContent }; },
};

class MemoryTransaction {
  constructor(database, storeNames, mode) {
    this.database = database;
    this.storeNames = new Set(storeNames);
    this.mode = mode;
    this.pending = 0;
    this.done = false;
    this.aborted = false;
  }

  objectStore(name) {
    if (!this.storeNames.has(name)) throw new Error(`Object store not in transaction: ${name}`);
    return new MemoryObjectStore(this, this.database.stores.get(name));
  }

  request(operation) {
    const request = { result: undefined, error: null, onsuccess: null, onerror: null };
    this.pending += 1;
    setTimeout(() => {
      if (this.aborted) return;
      try {
        request.result = operation();
        request.onsuccess?.({ target: request });
      } catch (error) {
        request.error = error;
        request.onerror?.({ target: request });
        this.abort(error);
      }
      this.pending -= 1;
      this.completeWhenIdle();
    }, 0);
    return request;
  }

  completeWhenIdle() {
    if (this.done || this.aborted || this.pending !== 0) return;
    setTimeout(() => {
      if (this.done || this.aborted || this.pending !== 0) return;
      this.done = true;
      this.oncomplete?.();
    }, 0);
  }

  abort(error = new Error("Transaction aborted")) {
    if (this.done || this.aborted) return;
    this.aborted = true;
    this.error = error;
    this.onabort?.();
  }
}

class MemoryObjectStore {
  constructor(transaction, records) {
    this.transaction = transaction;
    this.records = records;
  }

  assertWritable() {
    if (this.transaction.mode !== "readwrite") throw new Error("Read-only transaction");
  }

  get(key) {
    return this.transaction.request(() => this.records.get(key) || null);
  }

  getAll() {
    return this.transaction.request(() => [...this.records.values()]);
  }

  getAllKeys() {
    return this.transaction.request(() => [...this.records.keys()]);
  }

  put(value) {
    this.assertWritable();
    return this.transaction.request(() => {
      const key = value?.id;
      if (key == null) throw new Error("Missing keyPath id");
      this.records.set(key, value);
      return key;
    });
  }

  delete(key) {
    this.assertWritable();
    return this.transaction.request(() => this.records.delete(key));
  }
}

class MemoryDatabase {
  constructor() {
    this.stores = new Map();
    this.objectStoreNames = { contains: (name) => this.stores.has(name) };
  }

  createObjectStore(name) {
    this.stores.set(name, new Map());
  }

  transaction(storeNames, mode) {
    return new MemoryTransaction(this, storeNames, mode);
  }
}

const databases = new Map();
globalThis.indexedDB = {
  open(name) {
    const request = { result: null, onupgradeneeded: null, onsuccess: null, onerror: null };
    setTimeout(() => {
      let database = databases.get(name);
      if (!database) {
        database = new MemoryDatabase();
        databases.set(name, database);
        request.result = database;
        request.onupgradeneeded?.();
      } else {
        request.result = database;
      }
      request.onsuccess?.();
    }, 0);
    return request;
  },
};

const localValues = new Map();
globalThis.localStorage = {
  getItem(key) { return localValues.get(key) ?? null; },
  setItem(key, value) { localValues.set(key, String(value)); },
  removeItem(key) { localValues.delete(key); },
};

const legacyProject = createStarterProject();
legacyProject.addScene(new SceneModule({ id: "workspace-scene-2", name: "Módulo 2" }));
legacyProject.addScene(new SceneModule({ id: "workspace-scene-3", name: "Módulo 3" }));
const originalImageUrl = legacyProject.assets[0].dataUrl;
legacyProject.addSoundAsset(new SoundAsset({
  id: "sound-storage-test",
  name: "prueba.mp3",
  dataUrl: `data:audio/mpeg;base64,${Buffer.from("mp3-test").toString("base64")}`,
}), legacyProject.scenes[0].id);
localStorage.setItem("escena-viva-project-v1", JSON.stringify(legacyProject.toJSON()));

const migrated = await ProjectRepository.load();
assert.equal(migrated.id, legacyProject.id, "la primera apertura migra el proyecto antiguo");
assert.equal(localStorage.getItem("escena-viva-project-v1"), null, "la copia antigua solo se retira tras completar la migración");
const workspaceSnapshot = {
  openSceneIds: [legacyProject.scenes[0].id, "workspace-scene-3", "workspace-scene-2"],
  activeSceneId: "workspace-scene-3",
};
assert.equal(await ProjectRepository.saveWorkspace(migrated.id, workspaceSnapshot), true, "las pestañas se guardan junto al registro de IndexedDB");

const database = [...databases.values()][0];
const savedRecord = database.stores.get("projects").get("active-project");
assert.deepEqual(savedRecord.workspace, workspaceSnapshot, "el estado de pestañas queda separado de los datos exportables del juego");
assert.equal(savedRecord.project.assets[0].dataUrl, "", "los metadatos persistidos no incrustan la imagen");
assert.equal(savedRecord.project.assets[0].mediaStored, true, "el proyecto señala dónde se conserva el binario");
const assetRecords = database.stores.get("media-assets");
const storedImage = assetRecords.get(legacyProject.assets[0].id);
const storedSound = assetRecords.get("sound-storage-test");
assert.ok(storedImage.blob instanceof Blob, "la imagen se guarda como Blob en IndexedDB");
assert.ok(storedSound.blob instanceof Blob, "el sonido se guarda como Blob en IndexedDB");
assert.match(await storedSound.blob.text(), /mp3-test/, "el contenido del sonido se conserva");

const reloaded = await ProjectRepository.load();
assert.deepEqual(reloaded.editorWorkspace, workspaceSnapshot, "la recarga restaura todas las pestañas abiertas y su orden");
assert.equal(Object.hasOwn(reloaded.toJSON(), "editorWorkspace"), false, "el estado del editor no se añade al JSON del juego");
assert.match(reloaded.assets[0].dataUrl, /^blob:/, "al cargar, la interfaz recibe una URL temporal para la imagen");
assert.match(reloaded.soundAssets[0].dataUrl, /^blob:/, "al cargar, el sonido recibe una URL temporal");
const portable = await ProjectRepository.toPortableProjectData(reloaded);
assert.match(portable.assets[0].dataUrl, /^data:image\/svg\+xml/, "el JSON transportable vuelve a incluir la imagen");
assert.match(portable.soundAssets[0].dataUrl, /^data:audio\/mpeg;base64,/, "el JSON transportable vuelve a incluir el sonido");

reloaded.assets.splice(0, 1);
await ProjectRepository.save(reloaded);
assert.equal(assetRecords.has(legacyProject.assets[0].id), false, "los recursos retirados se limpian del almacén local");

console.log("PASS: migración localStorage → IndexedDB, medios binarios, recarga, JSON portable y limpieza de recursos.");
