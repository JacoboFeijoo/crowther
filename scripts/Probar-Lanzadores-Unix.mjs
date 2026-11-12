import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = process.argv[2]
  ? resolve(process.argv[2])
  : resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFile(join(root, path), "utf8");

const linuxLauncher = await read("Abrir Crowther Linux.sh");
const macLauncher = await read("Abrir Crowther Mac.command");
const commonLauncher = await read("scripts/abrir-crowther-unix.sh");

assert.match(linuxLauncher, /^#!\/usr\/bin\/env bash/);
assert.match(linuxLauncher, /abrir-crowther-unix\.sh" linux/);
assert.match(macLauncher, /^#!\/bin\/bash/);
assert.match(macLauncher, /abrir-crowther-unix\.sh" mac/);
assert.match(commonLauncher, /python3 -m http\.server/);
assert.match(commonLauncher, /--bind "\$HOST"/);
assert.match(commonLauncher, /41731/);
assert.match(commonLauncher, /xdg-open/);
assert.match(commonLauncher, /gio open/);
assert.match(commonLauncher, /open "\$APP_URL"/);
assert.match(commonLauncher, /server_is_crowther/);
assert.match(commonLauncher, /port_is_open/);

console.log("Lanzadores Linux/macOS: PASS (servidor local, detección de Crowther y apertura del navegador).");
