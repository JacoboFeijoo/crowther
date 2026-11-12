[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$backupRoot = [System.IO.Path]::GetFullPath((Join-Path $projectRoot 'backups'))
$timestamp = Get-Date -Format 'yyyy-MM-dd_HHmmss'
$backupPath = [System.IO.Path]::GetFullPath((Join-Path $backupRoot "backup-fix-$timestamp"))

if (-not $backupPath.StartsWith($backupRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Backup path escapes the project backup directory: $backupPath"
}
if (Test-Path -LiteralPath $backupPath) {
    throw "Backup already exists; no files were overwritten: $backupPath"
}

New-Item -ItemType Directory -Path $backupPath -Force | Out-Null
Get-ChildItem -LiteralPath $projectRoot -Force |
    Where-Object { $_.Name -ne 'backups' } |
    ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination $backupPath -Recurse -Force
    }

$backupFiles = @(Get-ChildItem -LiteralPath $backupPath -File -Recurse -Force)
if ($backupFiles.Count -eq 0) {
    throw "Backup completed without files; inspect the destination: $backupPath"
}

[pscustomobject]@{
    status = 'PASS'
    path = $backupPath
    files = $backupFiles.Count
    bytes = ($backupFiles | Measure-Object -Property Length -Sum).Sum
} | ConvertTo-Json -Compress
