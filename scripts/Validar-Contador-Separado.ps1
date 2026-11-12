[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$releaseRoot = [System.IO.Path]::GetFullPath((Join-Path $projectRoot '001. Release v.1'))
$pluginRoot = [System.IO.Path]::GetFullPath((Join-Path $projectRoot 'contador-wordpress\crowther-visit-counter'))
$issues = [System.Collections.Generic.List[string]]::new()

foreach ($obsolete in @('contador-visitas.php', 'js\analytics.js')) {
    if (Test-Path -LiteralPath (Join-Path $releaseRoot $obsolete)) {
        $issues.Add("Archivo antiguo todavía incluido: $obsolete")
    }
}

$releaseTextFiles = @(
    (Join-Path $releaseRoot 'index.html'),
    (Join-Path $releaseRoot 'service-worker.js'),
    (Join-Path $releaseRoot 'LEEME.txt'),
    (Join-Path $releaseRoot 'MANIFIESTO.txt')
)
foreach ($file in $releaseTextFiles) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
        $issues.Add("Falta archivo de release: $file")
        continue
    }
    if (Select-String -LiteralPath $file -Pattern 'contador-visitas|analytics\.js|crowther_visit_counter' -Quiet) {
        $issues.Add("La release todavía referencia el contador: $file")
    }
}

foreach ($required in @('crowther-visit-counter.php', 'crowther-counter.js')) {
    if (-not (Test-Path -LiteralPath (Join-Path $pluginRoot $required) -PathType Leaf)) {
        $issues.Add("Falta archivo del plugin: $required")
    }
}

if ($issues.Count -gt 0) {
    $issues | ForEach-Object { Write-Error $_ }
    exit 1
}

[pscustomobject]@{
    status = 'PASS'
    release = $releaseRoot
    counterPackage = $pluginRoot
    releaseCounterReferences = 0
} | ConvertTo-Json -Compress
