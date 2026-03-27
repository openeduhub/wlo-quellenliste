# -----------------------------------------------------------
# build-wc.ps1
# Baut die Angular-Webkomponente und kopiert die Bundles
# in das Backend-Verzeichnis (backend/public/wc/).
# -----------------------------------------------------------
$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not $RootDir) { $RootDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path) }
$WcDir   = Join-Path $RootDir "webcomponent"
$DestDir = Join-Path $RootDir "backend" "public" "wc"

Write-Host "=== WLO Webkomponente: Build ===" -ForegroundColor Cyan

# 1. Abhängigkeiten installieren (falls nötig)
if (-not (Test-Path (Join-Path $WcDir "node_modules"))) {
    Write-Host "-> npm ci ..."
    Push-Location $WcDir
    npm ci
    Pop-Location
}

# 2. Produktions-Build (IIFE via Angular browser-Builder)
Write-Host "-> ng build --configuration=production ..."
Push-Location $WcDir
npx ng build --configuration=production
Pop-Location

$DistDir = Join-Path $WcDir "dist" "wlosources-ng"

# 3. Prüfen ob Build erfolgreich war
if (-not (Test-Path (Join-Path $DistDir "main.js"))) {
    Write-Error "FEHLER: Build-Ausgabe nicht gefunden in $DistDir"
    exit 1
}

# 4. In Backend kopieren
Write-Host "-> Kopiere Bundles nach $DestDir ..."
New-Item -ItemType Directory -Force -Path $DestDir | Out-Null
Copy-Item (Join-Path $DistDir "main.js")     (Join-Path $DestDir "main.js")     -Force
Copy-Item (Join-Path $DistDir "polyfills.js") (Join-Path $DestDir "polyfills.js") -Force
Copy-Item (Join-Path $DistDir "runtime.js")   (Join-Path $DestDir "runtime.js")   -Force
Copy-Item (Join-Path $DistDir "styles.css")   (Join-Path $DestDir "styles.css")   -Force

Write-Host "=== Fertig! ===" -ForegroundColor Green
Get-ChildItem $DestDir | Format-Table Name, Length -AutoSize
