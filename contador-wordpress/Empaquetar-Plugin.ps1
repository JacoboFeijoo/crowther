[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$packageRoot = [System.IO.Path]::GetFullPath($PSScriptRoot)
$pluginRoot = [System.IO.Path]::GetFullPath((Join-Path $packageRoot 'crowther-visit-counter'))
$archivePath = [System.IO.Path]::GetFullPath((Join-Path $packageRoot 'crowther-visit-counter.zip'))

if (-not $pluginRoot.StartsWith($packageRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "La carpeta del plugin debe estar dentro del paquete: $pluginRoot"
}
if (-not (Test-Path -LiteralPath (Join-Path $pluginRoot 'crowther-visit-counter.php') -PathType Leaf)) {
    throw 'No se encuentra el archivo principal del plugin.'
}

Compress-Archive -LiteralPath $pluginRoot -DestinationPath $archivePath -Force

Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($archivePath)
try {
    $entries = @($zip.Entries | ForEach-Object FullName)
    if (-not ($entries | Where-Object { $_ -like 'crowther-visit-counter/crowther-visit-counter.php' })) {
        throw 'El ZIP no contiene la estructura de plugin que espera WordPress.'
    }
    if (-not ($entries | Where-Object { $_ -like 'crowther-visit-counter/crowther-counter.js' })) {
        throw 'El ZIP no contiene la integración JavaScript independiente.'
    }
} finally {
    $zip.Dispose()
}

[pscustomobject]@{
    status = 'PASS'
    archive = $archivePath
    entries = $entries.Count
} | ConvertTo-Json -Compress
