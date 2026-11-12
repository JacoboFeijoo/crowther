@echo off
setlocal
set "APP_DIR=%~dp0"
set "PORT=41731"
set "APP_URL=http://127.0.0.1:%PORT%/"

:: Reutiliza solo un servidor que devuelva esta aplicación, no cualquier HTTP 200.
powershell -NoProfile -Command "$url = '%APP_URL%'; try { $response = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 1; if ($response.Content -match 'Crowther') { Start-Process $url; exit 0 } } catch {}; $python = Get-Command python -ErrorAction SilentlyContinue; if ($null -eq $python) { Write-Host 'No se ha encontrado Python. Instala Python 3 para abrir el editor local.'; pause; exit 1 }; Start-Process -FilePath $python.Source -ArgumentList @('-m','http.server','%PORT%','--bind','127.0.0.1') -WorkingDirectory '%APP_DIR%' -WindowStyle Hidden; Start-Sleep -Milliseconds 800; try { $response = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 3; if ($response.Content -notmatch 'Crowther') { throw 'El servidor no ha iniciado el editor esperado.' }; Start-Process $url } catch { Write-Host 'No se pudo iniciar Crowther:' $_.Exception.Message; pause }"
