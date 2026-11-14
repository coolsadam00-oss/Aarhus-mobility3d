#!/usr/bin/env bash
# Runs NetAScore for Aarhus in Docker and copies the result into the app's data folder.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$here/work/data" && cd "$here/work"
base="https://raw.githubusercontent.com/plus-mobilitylab/netascore/main/examples"
curl -fsSL "$base/docker-compose.yml" -o docker-compose.yml
curl -fsSL "$base/profile_bike.yml" -o data/profile_bike.yml
curl -fsSL "$base/profile_walk.yml" -o data/profile_walk.yml
cp "$here/settings_aarhus.yml" data/settings_aarhus.yml
if [ ! -f data/aarhus_dhm_10m.tif ]; then
  echo "WARN: no DEM at netascore/work/data/aarhus_dhm_10m.tif - dropping dem block (no gradient indicator)"
  sed -i.bak -E '/^\s*(dem:|filename: aarhus_dhm|srid: 25832)/d' data/settings_aarhus.yml
fi
docker compose run --rm netascore data/settings_aarhus.yml
cp data/netascore_aarhus.gpkg "$here/../data/aarhus_netascore.gpkg"
echo "Done -> data/aarhus_netascore.gpkg"
