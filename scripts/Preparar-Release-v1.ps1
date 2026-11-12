[CmdletBinding()]
param([switch]$Actualizar)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$releasePath = Join-Path $projectRoot "001. Release v.1"
$rootFull = [IO.Path]::GetFullPath($projectRoot).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
$releaseFull = [IO.Path]::GetFullPath($releasePath)

if (-not $releaseFull.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase)) {
  throw "La carpeta de salida no está dentro del proyecto: $releaseFull"
}

if (-not (Test-Path -LiteralPath $releaseFull)) {
  New-Item -ItemType Directory -Path $releaseFull | Out-Null
}

$existingFiles = @(Get-ChildItem -LiteralPath $releaseFull -Force)
if ($existingFiles.Count -gt 0 -and -not $Actualizar) {
  throw "La carpeta de release ya tiene contenido. Revísala y usa -Actualizar solo si quieres sobrescribir los archivos de Crowther incluidos en el paquete. No se borrará ningún archivo adicional."
}

$filesToCopy = @(
  "index.html",
  "LICENSE",
  "COPYRIGHT-ATTRIBUTION.txt",
  "RUNTIME-LICENSE-EXCEPTION.txt",
  "manifest.webmanifest",
  "service-worker.js",
  "styles.css",
  "playable.css",
  "Abrir Crowther.cmd",
  "Abrir Crowther Linux.sh",
  "Abrir Crowther Mac.command",
  "Logo/Logo.svg",
  "assets/pwa-icon-180.png",
  "assets/pwa-icon-192.png",
  "assets/pwa-icon-512.png",
  "vendor/cytoscape.min.js",
  "vendor/quill/quill.min.js",
  "vendor/quill/quill.snow.css",
  "vendor/quill/LICENSE",
  "js/app.js",
  "js/character-state.js",
  "js/editor.js",
  "js/inventory.js",
  "js/model.js",
  "js/playable-main.js",
  "js/playable-runtime.js",
  "js/player.js",
  "js/pwa.js",
  "js/rich-text.js",
  "js/storage.js",
  "js/workspace-state.js",
  "scripts/abrir-crowther-unix.sh"
)

# Retira el contador que se incluia en versiones anteriores de la release.
foreach ($obsoleteCounterPath in @("contador-visitas.php", "js/analytics.js")) {
  $obsoleteCounterFile = Join-Path $releaseFull $obsoleteCounterPath
  if (Test-Path -LiteralPath $obsoleteCounterFile -PathType Leaf) {
    Remove-Item -LiteralPath $obsoleteCounterFile -Force
  }
}

foreach ($relativePath in $filesToCopy) {
  $sourcePath = Join-Path $projectRoot $relativePath
  if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
    throw "Falta un archivo necesario para el release: $relativePath"
  }
  $destinationPath = Join-Path $releaseFull $relativePath
  $destinationDirectory = Split-Path -Parent $destinationPath
  New-Item -ItemType Directory -Force -Path $destinationDirectory | Out-Null
  Copy-Item -LiteralPath $sourcePath -Destination $destinationPath -Force
}

$readme = @'
CROWTHER — RELEASE V.1
=====================

Este paquete contiene el IDE Crowther y sus dependencias locales. No incluye
copias de seguridad, scripts de pruebas, imagenes de prueba ni proyectos del
usuario.

Windows
-------
Haz doble clic en "Abrir Crowther.cmd". El lanzador inicia un servidor local
y abre Crowther en el navegador. Necesita Python 3 instalado.

macOS o Linux
-------------
En Linux, da permiso de ejecucion una vez y abre el lanzador:

  chmod +x "Abrir Crowther Linux.sh" scripts/abrir-crowther-unix.sh
  ./"Abrir Crowther Linux.sh"

En macOS, da permiso una vez; despues puedes abrir el archivo .command desde
Finder o ejecutarlo en Terminal:

  chmod +x "Abrir Crowther Mac.command" scripts/abrir-crowther-unix.sh
  ./"Abrir Crowther Mac.command"

Ambos necesitan Python 3. Inician el servidor en 127.0.0.1:41731 y abren el
navegador predeterminado. Si ya hay un Crowther activo, reutilizan ese servidor;
si el puerto esta ocupado por otra aplicacion, muestran un aviso.

No abras index.html directamente con file://: el IDE usa modulos JavaScript y
necesita servirse desde HTTP/HTTPS.

Los proyectos y sus recursos se guardan en IndexedDB del navegador y del
dispositivo actual. Exporta copias desde Crowther con "Exportar proyecto"; no
se incluyen automaticamente.

El paquete incluye manifest.webmanifest y service-worker.js. Para instalarlo
online, publica toda esta carpeta bajo HTTPS y abre Crowther en un navegador
compatible; usa su opcion "Instalar aplicacion". Tambien funciona desde el
servidor local de localhost/127.0.0.1.

La primera apertura requiere conexion y guarda la carcasa del IDE para abrirla
despues sin conexion. La caché no guarda proyectos ni recursos del usuario:
siguen en IndexedDB del navegador y dispositivo actuales. Exporta copias del
proyecto con regularidad.

PUBLICACION EN WEB
------------------
Para publicar en el hosting, conserva la estructura y sube los archivos de
aplicacion. No necesitas subir los lanzadores "Abrir*.cmd", "Abrir*.sh",
"Abrir*.command" ni scripts/abrir-crowther-unix.sh. El service-worker.js
enumera los recursos que necesita la aplicacion para funcionar sin conexion.

LICENCIA Y ATRIBUCION
---------------------
El IDE Crowther se distribuye bajo GNU GPLv3 y exige conservar la atribución
© Jacobo Feijóo en About (o en avisos legales equivalentes). Consulta LICENSE
y COPYRIGHT-ATTRIBUTION.txt. Los juegos creados con Crowther pueden elegir su
propia licencia gracias a la excepción del runtime en
RUNTIME-LICENSE-EXCEPTION.txt; conserva el aviso de Crowther en los créditos
o en el paquete. Los proyectos y contenidos creados por usuarios siguen
perteneciendo a sus autores. Los componentes de terceros mantienen sus propias
licencias; consulta sus avisos en vendor/.

'@
$readmePath = Join-Path $releaseFull "LEEME.txt"
[IO.File]::WriteAllText($readmePath, $readme, [Text.UTF8Encoding]::new($false))

$manifestLines = @(
  "Crowther IDE - Release v.1",
  "Archivos seleccionados para ejecucion y exportacion web:",
  ""
) + $filesToCopy + @("LEEME.txt", "")
$manifestPath = Join-Path $releaseFull "MANIFIESTO.txt"
[IO.File]::WriteAllLines($manifestPath, $manifestLines, [Text.UTF8Encoding]::new($false))

$releaseFiles = @(Get-ChildItem -LiteralPath $releaseFull -File -Recurse)
Write-Output "Release preparado: $releaseFull"
Write-Output "Archivos: $($releaseFiles.Count) - Tamano: $([Math]::Round(($releaseFiles | Measure-Object Length -Sum).Sum / 1MB, 2)) MB"
Write-Output "Contenido:"
$releaseFiles | Sort-Object FullName | ForEach-Object {
  $relativePath = $_.FullName.Substring($releaseFull.Length).TrimStart([IO.Path]::DirectorySeparatorChar)
  Write-Output (" - " + $relativePath)
}
