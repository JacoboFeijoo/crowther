import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Script } from "node:vm";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = process.argv[2] ? resolve(process.argv[2]) : projectRoot;
const read = (relativePath) => readFile(join(root, relativePath), "utf8");
const exists = async (relativePath) => {
  try {
    await readFile(join(root, relativePath));
    return true;
  } catch {
    return false;
  }
};

const manifest = JSON.parse(await read("manifest.webmanifest"));
const html = await read("index.html");
const app = await read("js/app.js");
const pwaModule = await read("js/pwa.js");
const worker = await read("service-worker.js");
new Script(worker, { filename: "service-worker.js" });

assert.equal(manifest.name, "Crowther — Librojuego digital");
assert.equal(manifest.short_name, "Crowther");
assert.equal(manifest.display, "standalone");
assert.equal(manifest.start_url, "./");
assert.match(html, /rel="manifest"\s+href="manifest\.webmanifest"/);
assert.match(html, /name="theme-color"/);
assert.match(app, /registerCrowtherServiceWorker\(\)/);
assert.match(pwaModule, /serviceWorker\.register/);
assert.match(pwaModule, /https:/);
assert.doesNotMatch(html, /analytics\.js|contador-visitas/i, "la release de Crowther permanece independiente del contador externo");
assert.equal(await exists("contador-visitas.php"), false, "el endpoint anterior no debe incluirse en la release");
assert.equal(await exists("js/analytics.js"), false, "el cargador anterior no debe incluirse en la release");
assert.match(worker, /addEventListener\("install"/);
assert.match(worker, /addEventListener\("activate"/);
assert.match(worker, /addEventListener\("fetch"/);
assert.match(worker, /ignoreSearch:\s*true/);
assert.doesNotMatch(worker, /skipWaiting\s*\(/);
assert.doesNotMatch(worker, /indexedDB|localStorage|assets\/(images|audio)/i);

const shellFilesMatch = worker.match(/const SHELL_FILES = (\[[\s\S]*?\]);/);
assert.ok(shellFilesMatch, "La lista de recursos cacheados debe ser declarativa.");
const shellFiles = JSON.parse(shellFilesMatch[1]);
for (const legalFile of ["./LICENSE", "./COPYRIGHT-ATTRIBUTION.txt", "./RUNTIME-LICENSE-EXCEPTION.txt", "./vendor/quill/LICENSE"]) {
  assert.ok(shellFiles.includes(legalFile), `Los avisos legales deben estar disponibles offline: ${legalFile}`);
}
for (const relativePath of shellFiles) {
  const normalized = relativePath.replace(/^\.\//, "");
  if (normalized) assert.equal(await exists(normalized), true, `Falta recurso de app shell: ${relativePath}`);
}

for (const icon of manifest.icons) {
  assert.match(icon.purpose, /maskable/);
  assert.equal(await exists(icon.src.replace(/^\.\//, "")), true, `Falta icono PWA: ${icon.src}`);
  const png = await readFile(join(root, icon.src.replace(/^\.\//, "")));
  assert.equal(png.toString("hex", 0, 8), "89504e470d0a1a0a", `${icon.src} no es PNG válido`);
  const expectedSize = Number(icon.sizes.split("x")[0]);
  assert.equal(png.readUInt32BE(16), expectedSize, `${icon.src} tiene ancho inesperado`);
  assert.equal(png.readUInt32BE(20), expectedSize, `${icon.src} tiene alto inesperado`);
}

console.log(`PWA: PASS (${shellFiles.length} recursos offline, ${manifest.icons.length} iconos instalables).`);
