# Runs NetAScore for Aarhus in Docker and copies the result into the app's data folder.
# Requirements: Docker Desktop running, internet connection.
# Usage (PowerShell, from the project root):  .\netascore\run_netascore.ps1
$ErrorActionPreference = "Stop"
$work = Join-Path $PSScriptRoot "work"
New-Item -ItemType Directory -Force -Path (Join-Path $work "data") | Out-Null
Set-Location $work

$base = "https://raw.githubusercontent.com/plus-mobilitylab/netascore/main/examples"
Invoke-WebRequest "$base/docker-compose.yml" -OutFile "docker-compose.yml"
Invoke-WebRequest "$base/profile_bike.yml"   -OutFile "data/profile_bike.yml"
Invoke-WebRequest "$base/profile_walk.yml"   -OutFile "data/profile_walk.yml"
Copy-Item (Join-Path $PSScriptRoot "settings_aarhus.yml") "data/settings_aarhus.yml" -Force

if (-not (Test-Path "data/aarhus_dhm_10m.tif")) {
  Write-Warning "No DEM found at netascore/work/data/aarhus_dhm_10m.tif - removing the dem block (gradient indicator will be empty)."
  (Get-Content "data/settings_aarhus.yml") -notmatch "^\s*(dem:|filename: aarhus_dhm|srid: 25832)" | Set-Content "data/settings_aarhus.yml"
}

docker compose run --rm netascore data/settings_aarhus.yml

$out = "data/netascore_aarhus.gpkg"
if (-not (Test-Path $out)) { throw "NetAScore did not produce $out" }
Copy-Item $out (Join-Path $PSScriptRoot "..\data\aarhus_netascore.gpkg") -Force
Write-Host "Done -> data/aarhus_netascore.gpkg (bundled on next 'npm run dist')" -ForegroundColor Green
