[CmdletBinding()]
param(
    [switch]$Json
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$requiredFiles = @(
    'index.html',
    'LICENSE',
    'COPYRIGHT-ATTRIBUTION.txt',
    'RUNTIME-LICENSE-EXCEPTION.txt',
    'Abrir Crowther.cmd',
    'Abrir Crowther Linux.sh',
    'Abrir Crowther Mac.command',
    'scripts/abrir-crowther-unix.sh',
    'manifest.webmanifest',
    'service-worker.js',
    'assets/pwa-icon-180.png',
    'assets/pwa-icon-192.png',
    'assets/pwa-icon-512.png',
    'styles.css',
    'playable.css',
    'js/app.js',
    'js/pwa.js',
    'js/editor.js',
    'js/model.js',
    'js/player.js',
'js/character-state.js',
'js/workspace-state.js',
'js/inventory.js',
    'js/rich-text.js',
    'js/storage.js',
    'js/playable-main.js',
    'js/playable-runtime.js',
    'vendor/quill/quill.min.js',
    'vendor/quill/quill.snow.css',
    'vendor/quill/LICENSE'
)
$missingFiles = New-Object 'System.Collections.Generic.List[string]'
$failures = New-Object 'System.Collections.Generic.List[string]'
$warnings = New-Object 'System.Collections.Generic.List[string]'
$presentFiles = 0
$checkedJavaScript = 0
$totalJavaScript = 0
$modelWorkflowTestsPassed = $false
$newProjectWorkflowTestsPassed = $false
$webExportTestsPassed = $false
$storageWorkflowTestsPassed = $false
$keyboardControlsTestPassed = $false
$combatTestsPassed = $false
$eventTestsPassed = $false
$characterTestsPassed = $false
$pwaTestsPassed = $false
$unixLauncherTestsPassed = $false
$complete = $true

foreach ($relativePath in $requiredFiles) {
    $fullPath = Join-Path $projectRoot $relativePath
    if (Test-Path -LiteralPath $fullPath -PathType Leaf) {
        $presentFiles++
    }
    else {
        $missingFiles.Add("Missing required file: $relativePath")
    }
}

foreach ($message in $missingFiles) {
    $failures.Add($message)
}

$javascriptDirectory = Join-Path $projectRoot 'js'
if (Test-Path -LiteralPath $javascriptDirectory -PathType Container) {
    $javascriptFiles = @(Get-ChildItem -LiteralPath $javascriptDirectory -Filter '*.js' -File | Sort-Object Name)
    $totalJavaScript = $javascriptFiles.Count
    if ($totalJavaScript -eq 0) {
        $failures.Add('No JavaScript files found in js/.')
    }
    else {
        $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
        if ($null -eq $nodeCommand) {
            $complete = $false
            $warnings.Add('Node.js is unavailable; JavaScript syntax was not checked.')
        }
        else {
            foreach ($javascriptFile in $javascriptFiles) {
                $nodeOutput = @(& $nodeCommand.Source --check $javascriptFile.FullName 2>&1)
                $nodeExitCode = $LASTEXITCODE
                if ($nodeExitCode -eq 0) {
                    $checkedJavaScript++
                }
                else {
                    $detail = (($nodeOutput | Select-Object -First 2) -join ' ').Trim()
                    if ($detail.Length -gt 220) {
                        $detail = $detail.Substring(0, 220)
                    }
                    $failures.Add("JavaScript syntax error in $($javascriptFile.Name): $detail")
                }
            }
        }
    }
}
else {
    $failures.Add('Required directory js/ is missing.')
}

$modelTestPath = Join-Path $PSScriptRoot 'Probar-Modelo-ModulosRecursos.mjs'
if (-not (Test-Path -LiteralPath $modelTestPath -PathType Leaf)) {
    $failures.Add('Required model workflow test is missing: Probar-Modelo-ModulosRecursos.mjs')
}
else {
    $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
    if ($null -eq $nodeCommand) {
        $complete = $false
        $warnings.Add('Node.js is unavailable; model workflow tests were not run.')
    }
    else {
        $testOutput = @(& $nodeCommand.Source $modelTestPath 2>&1)
        $testExitCode = $LASTEXITCODE
        if ($testExitCode -eq 0) {
            $modelWorkflowTestsPassed = $true
        }
        else {
            $detail = (($testOutput | Select-Object -First 3) -join ' ').Trim()
            if ($detail.Length -gt 300) {
                $detail = $detail.Substring(0, 300)
            }
            $failures.Add("Model workflow test failed: $detail")
        }
    }
}

$newProjectTestPath = Join-Path $PSScriptRoot 'Probar-NuevoProyecto.mjs'
if (-not (Test-Path -LiteralPath $newProjectTestPath -PathType Leaf)) {
    $failures.Add('Required new project workflow test is missing: Probar-NuevoProyecto.mjs')
}
else {
    $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
    if ($null -eq $nodeCommand) {
        $complete = $false
        $warnings.Add('Node.js is unavailable; new project workflow tests were not run.')
    }
    else {
        $testOutput = @(& $nodeCommand.Source $newProjectTestPath 2>&1)
        $testExitCode = $LASTEXITCODE
        if ($testExitCode -eq 0) {
            $newProjectWorkflowTestsPassed = $true
        }
        else {
            $detail = (($testOutput | Select-Object -First 3) -join ' ').Trim()
            if ($detail.Length -gt 300) {
                $detail = $detail.Substring(0, 300)
            }
            $failures.Add("New project workflow test failed: $detail")
        }
    }
}

$webExportTestPath = Join-Path $PSScriptRoot 'Probar-Exportacion-Web.mjs'
if (-not (Test-Path -LiteralPath $webExportTestPath -PathType Leaf)) {
    $failures.Add('Required web export test is missing: Probar-Exportacion-Web.mjs')
}
else {
    $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
    if ($null -eq $nodeCommand) {
        $complete = $false
        $warnings.Add('Node.js is unavailable; web export tests were not run.')
    }
    else {
        $testOutput = @(& $nodeCommand.Source $webExportTestPath 2>&1)
        $testExitCode = $LASTEXITCODE
        if ($testExitCode -eq 0) {
            $webExportTestsPassed = $true
        }
        else {
            $detail = (($testOutput | Select-Object -First 3) -join ' ').Trim()
            if ($detail.Length -gt 300) {
                $detail = $detail.Substring(0, 300)
            }
            $failures.Add("Web export tests failed: $detail")
        }
    }
}

$storageTestPath = Join-Path $PSScriptRoot 'Probar-Almacenamiento-IndexedDB.mjs'
if (-not (Test-Path -LiteralPath $storageTestPath -PathType Leaf)) {
    $failures.Add('Required storage workflow test is missing: Probar-Almacenamiento-IndexedDB.mjs')
}
else {
    $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
    if ($null -eq $nodeCommand) {
        $complete = $false
        $warnings.Add('Node.js is unavailable; storage workflow tests were not run.')
    }
    else {
        $testOutput = @(& $nodeCommand.Source $storageTestPath 2>&1)
        $testExitCode = $LASTEXITCODE
        if ($testExitCode -eq 0) {
            $storageWorkflowTestsPassed = $true
        }
        else {
            $detail = (($testOutput | Select-Object -First 3) -join ' ').Trim()
            if ($detail.Length -gt 300) {
                $detail = $detail.Substring(0, 300)
            }
            $failures.Add("Storage workflow test failed: $detail")
        }
    }
}

$keyboardControlsTestPath = Join-Path $PSScriptRoot 'Probar-Desplazamiento-Teclado.mjs'
if (-not (Test-Path -LiteralPath $keyboardControlsTestPath -PathType Leaf)) {
    $failures.Add('Required keyboard controls test is missing: Probar-Desplazamiento-Teclado.mjs')
}

else {
    $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
    if ($null -eq $nodeCommand) {
        $complete = $false
        $warnings.Add('Node.js is unavailable; keyboard controls tests were not run.')
    }
    else {
        $testOutput = @(& $nodeCommand.Source $keyboardControlsTestPath 2>&1)
        $testExitCode = $LASTEXITCODE
        if ($testExitCode -eq 0) {
            $keyboardControlsTestPassed = $true
        }
        else {
            $detail = (($testOutput | Select-Object -First 3) -join ' ').Trim()
            if ($detail.Length -gt 300) {
                $detail = $detail.Substring(0, 300)
            }
            $failures.Add("Keyboard controls test failed: $detail")
        }
    }
}

$combatTestPath = Join-Path $PSScriptRoot 'Probar-Combates.mjs'
if (-not (Test-Path -LiteralPath $combatTestPath -PathType Leaf)) {
    $failures.Add('Required combat workflow test is missing: Probar-Combates.mjs')
}
else {
    $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
    if ($null -eq $nodeCommand) {
        $complete = $false
        $warnings.Add('Node.js is unavailable; combat workflow tests were not run.')
    }
    else {
        $testOutput = @(& $nodeCommand.Source $combatTestPath 2>&1)
        $testExitCode = $LASTEXITCODE
        if ($testExitCode -eq 0) {
            $combatTestsPassed = $true
        }
        else {
            $detail = (($testOutput | Select-Object -First 3) -join ' ').Trim()
            if ($detail.Length -gt 300) {
                $detail = $detail.Substring(0, 300)
            }
            $failures.Add("Combat workflow test failed: $detail")
        }
    }
}

$eventTestPath = Join-Path $PSScriptRoot 'Probar-Eventos.mjs'
if (-not (Test-Path -LiteralPath $eventTestPath -PathType Leaf)) {
    $failures.Add('Required event workflow test is missing: Probar-Eventos.mjs')
}
else {
    $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
    if ($null -eq $nodeCommand) {
        $complete = $false
        $warnings.Add('Node.js is unavailable; event workflow tests were not run.')
    }
    else {
        $testOutput = @(& $nodeCommand.Source $eventTestPath 2>&1)
        $testExitCode = $LASTEXITCODE
        if ($testExitCode -eq 0) {
            $eventTestsPassed = $true
        }
        else {
            $detail = (($testOutput | Select-Object -First 3) -join ' ').Trim()
            if ($detail.Length -gt 300) {
                $detail = $detail.Substring(0, 300)
            }
            $failures.Add("Event workflow test failed: $detail")
        }
    }
}

$characterTestPath = Join-Path $PSScriptRoot 'Probar-Personajes.mjs'
if (-not (Test-Path -LiteralPath $characterTestPath -PathType Leaf)) {
    $failures.Add('Required character workflow test is missing: Probar-Personajes.mjs')
}
else {
    $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
    if ($null -eq $nodeCommand) {
        $complete = $false
        $warnings.Add('Node.js is unavailable; character workflow tests were not run.')
    }
    else {
        $testOutput = @(& $nodeCommand.Source $characterTestPath 2>&1)
        $testExitCode = $LASTEXITCODE
        if ($testExitCode -eq 0) {
            $characterTestsPassed = $true
        }
        else {
            $detail = (($testOutput | Select-Object -First 3) -join ' ').Trim()
            if ($detail.Length -gt 300) {
                $detail = $detail.Substring(0, 300)
            }
            $failures.Add("Character workflow test failed: $detail")
        }
    }
}

$pwaTestPath = Join-Path $PSScriptRoot 'Probar-PWA.mjs'
if (-not (Test-Path -LiteralPath $pwaTestPath -PathType Leaf)) {
    $failures.Add('Required PWA test is missing: Probar-PWA.mjs')
}
else {
    $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
    if ($null -eq $nodeCommand) {
        $complete = $false
        $warnings.Add('Node.js is unavailable; PWA checks were not run.')
    }
    else {
        $testOutput = @(& $nodeCommand.Source $pwaTestPath 2>&1)
        $testExitCode = $LASTEXITCODE
        if ($testExitCode -eq 0) {
            $pwaTestsPassed = $true
        }
        else {
            $detail = (($testOutput | Select-Object -First 3) -join ' ').Trim()
            if ($detail.Length -gt 300) {
                $detail = $detail.Substring(0, 300)
            }
            $failures.Add("PWA checks failed: $detail")
        }
    }
}

$unixLauncherTestPath = Join-Path $PSScriptRoot 'Probar-Lanzadores-Unix.mjs'
if (-not (Test-Path -LiteralPath $unixLauncherTestPath -PathType Leaf)) {
    $failures.Add('Required Linux/macOS launcher test is missing: Probar-Lanzadores-Unix.mjs')
}
else {
    $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
    if ($null -eq $nodeCommand) {
        $complete = $false
        $warnings.Add('Node.js is unavailable; Linux/macOS launcher checks were not run.')
    }
    else {
        $testOutput = @(& $nodeCommand.Source $unixLauncherTestPath 2>&1)
        $testExitCode = $LASTEXITCODE
        if ($testExitCode -eq 0) {
            $unixLauncherTestsPassed = $true
        }
        else {
            $detail = (($testOutput | Select-Object -First 3) -join ' ').Trim()
            if ($detail.Length -gt 300) {
                $detail = $detail.Substring(0, 300)
            }
            $failures.Add("Linux/macOS launcher checks failed: $detail")
        }
    }
}

$success = ($failures.Count -eq 0) -and $complete
$status = if ($success) { 'PASS' } elseif ($failures.Count -gt 0) { 'FAIL' } else { 'INCOMPLETE' }

if ($Json) {
    [pscustomobject]@{
        status = $status
        success = $success
        base_files_present = $presentFiles
        base_files_required = $requiredFiles.Count
        javascript_files_checked = $checkedJavaScript
        javascript_files_found = $totalJavaScript
        model_workflow_tests_passed = $modelWorkflowTestsPassed
        new_project_workflow_tests_passed = $newProjectWorkflowTestsPassed
        web_export_tests_passed = $webExportTestsPassed
        storage_workflow_tests_passed = $storageWorkflowTestsPassed
        keyboard_controls_test_passed = $keyboardControlsTestPassed
        combat_workflow_tests_passed = $combatTestsPassed
        event_workflow_tests_passed = $eventTestsPassed
        character_workflow_tests_passed = $characterTestsPassed
        pwa_checks_passed = $pwaTestsPassed
        unix_launcher_checks_passed = $unixLauncherTestsPassed
        failures = @($failures.ToArray())
        warnings = @($warnings.ToArray())
    } | ConvertTo-Json -Depth 4 -Compress
}
else {
    Write-Output "Escena Viva validation: $status"
    Write-Output "Base files: $presentFiles/$($requiredFiles.Count) | JavaScript syntax: $checkedJavaScript/$totalJavaScript | Model workflow: $modelWorkflowTestsPassed | New project workflow: $newProjectWorkflowTestsPassed | Web export: $webExportTestsPassed | Storage workflow: $storageWorkflowTestsPassed | Keyboard controls: $keyboardControlsTestPassed | Combat workflow: $combatTestsPassed | Event workflow: $eventTestsPassed | Character workflow: $characterTestsPassed | PWA: $pwaTestsPassed | Linux/macOS launchers: $unixLauncherTestsPassed"
    foreach ($failure in $failures) {
        Write-Output "ERROR: $failure"
    }
    foreach ($warning in $warnings) {
        Write-Output "WARNING: $warning"
    }
}

if (-not $success) {
    exit 1
}
