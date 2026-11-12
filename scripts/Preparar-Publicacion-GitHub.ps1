[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Destino
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd([System.IO.Path]::DirectorySeparatorChar)
$projectPrefix = $projectRoot + [System.IO.Path]::DirectorySeparatorChar
$stageRoot = [System.IO.Path]::GetFullPath($Destino).TrimEnd([System.IO.Path]::DirectorySeparatorChar)

if ($stageRoot.StartsWith($projectPrefix, [System.StringComparison]::OrdinalIgnoreCase) -or
    $projectRoot.StartsWith($stageRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "El staging debe estar fuera del proyecto y no puede contenerlo: $stageRoot"
}
if (Test-Path -LiteralPath $stageRoot) {
    throw "El destino ya existe; no se sobrescribió ningún archivo: $stageRoot"
}

$excludedDirectories = @(
    '.codebase-memory',
    '.git',
    'backups',
    '001. Release v.1',
    '001. Release v.1 - backup',
    '001. Release v.1 - copia',
    'Imagenes prueba'
)
$excludedFiles = @(
    'Abrir Escena Viva.cmd',
    'Crowther.mp4',
    'protocol_context v.2.json',
    'Logo/Logo.cdr',
    'contador-wordpress/crowther-visit-counter.zip'
)
$excludedExtensions = @('.log', '.tmp')
$maxFileBytes = 25MB
$copiedFiles = [System.Collections.Generic.List[object]]::new()

New-Item -ItemType Directory -Path $stageRoot | Out-Null
$pendingDirectories = [System.Collections.Generic.Stack[string]]::new()
$pendingDirectories.Push($projectRoot)

while ($pendingDirectories.Count -gt 0) {
    $currentDirectory = $pendingDirectories.Pop()
    foreach ($item in Get-ChildItem -LiteralPath $currentDirectory -Force) {
        $relativePath = [System.IO.Path]::GetRelativePath($projectRoot, $item.FullName).Replace('\', '/')
        if ($item.PSIsContainer) {
            if ($excludedDirectories -contains $item.Name) { continue }
            $pendingDirectories.Push($item.FullName)
            continue
        }

        if ($excludedFiles -contains $relativePath) { continue }
        if ($excludedExtensions -contains $item.Extension.ToLowerInvariant()) { continue }
        if ($item.Length -gt $maxFileBytes) {
            throw "Archivo supera el límite prudente de 25 MiB: $relativePath ($($item.Length) bytes)"
        }

        $destinationFile = Join-Path $stageRoot ($relativePath.Replace('/', [System.IO.Path]::DirectorySeparatorChar))
        $destinationDirectory = Split-Path -Parent $destinationFile
        New-Item -ItemType Directory -Path $destinationDirectory -Force | Out-Null
        Copy-Item -LiteralPath $item.FullName -Destination $destinationFile
        $copiedFiles.Add([pscustomobject]@{ path = $relativePath; bytes = $item.Length })
    }
}

$oversized = @($copiedFiles | Where-Object { $_.bytes -gt $maxFileBytes })
if ($oversized.Count -gt 0) {
    throw 'Hay archivos que superan el límite prudente; staging no validado.'
}

[pscustomobject]@{
    status = 'PASS'
    staging = $stageRoot
    files = $copiedFiles.Count
    bytes = ($copiedFiles | Measure-Object -Property bytes -Sum).Sum
    excluded = @('backups', 'releases duplicadas', 'material de prueba', 'vídeo de 1 GB', 'archivo de contexto local')
} | ConvertTo-Json -Compress
