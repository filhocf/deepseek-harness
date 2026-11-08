#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
WORK=${DSH_SHARP_ELECTRON_WORK:-"$ROOT/.desktop-build/sharp-electron-source"}
OUTPUT=${DSH_SHARP_ELECTRON_PACKAGE:-"$ROOT/.desktop-build/sharp-electron-package"}
REPO=${DSH_SHARP_ELECTRON_REPO:-https://github.com/janhapke/sharp-electron.git}
# Immutable upstream snapshot: this fork currently has no v0.35.5 tag/ref.
# Override only with an explicitly reviewed commit when updating the builder.
REF=${DSH_SHARP_ELECTRON_REF:-f7afa507bfc6975bad73ed9c6a8ee5c3be88b848}
EXPECTED=${SHARP_VERSION:-0.35.5}
CONTAINER_ENGINE=${CONTAINER_ENGINE:-docker}
if ! command -v "$CONTAINER_ENGINE" >/dev/null 2>&1; then
  echo "sharp-electron: container engine not found: $CONTAINER_ENGINE" >&2
  exit 1
fi
export EXPECTED CONTAINER_ENGINE
ELECTRON_CACHE_ZIP=${ELECTRON_CACHE_ZIP:-"$HOME/.cache/electron/4b092cc678b6ff8448c5ab35fabca1710dccc91cfbff065280601a184126b0fe/electron-v33.4.11-linux-x64.zip"}
export ELECTRON_CACHE_ZIP
if [ "$CONTAINER_ENGINE" = podman ]; then
  export CONTAINERS_REGISTRIES_CONF="$ROOT/.desktop-build/registries.conf"
  mkdir -p "$(dirname "$CONTAINERS_REGISTRIES_CONF")"
  printf 'unqualified-search-registries = ["docker.io"]\n' > "$CONTAINERS_REGISTRIES_CONF"
fi

rm -rf "$WORK" "$OUTPUT"
git clone --recurse-submodules --depth 1 "$REPO" "$WORK"
(cd "$WORK" && git checkout --detach "$REF" && git submodule update --init --recursive)
node -e "const fs=require('fs'); const p='$WORK/package.json'; const m=JSON.parse(fs.readFileSync(p)); m.devDependencies={...m.devDependencies, sharp: process.env.EXPECTED}; fs.writeFileSync(p, JSON.stringify(m,null,2)+'\\n')"
(cd "$WORK" && npm install --package-lock-only --ignore-scripts)
(cd "$WORK" && npm install --ignore-scripts)
# Electron's package install is intentionally script-free above so native sharp
# can be rebuilt deterministically; run only Electron's postinstall afterward.
# A warm local cache is reused verbatim; on a clean CI runner the official
# installer fetches the same payload instead of failing on a missing zip.
if [ -n "${ELECTRON_CACHE_ZIP:-}" ] && [ -f "$ELECTRON_CACHE_ZIP" ]; then
  (cd "$WORK" && node -e "const fs=require('fs'); const p='node_modules/electron'; const d=p+'/dist'; fs.rmSync(d,{recursive:true,force:true}); fs.mkdirSync(d,{recursive:true}); const cp=process.env.ELECTRON_CACHE_ZIP; require('child_process').execFileSync('unzip',['-q',cp,'-d',d]); fs.chmodSync(d+'/electron',0o755); fs.writeFileSync(p+'/path.txt','electron')")
else
  (cd "$WORK" && node node_modules/electron/install.js)
fi
actual=$(node -p "require('$WORK/node_modules/sharp/package.json').version")
if [ "$actual" != "$EXPECTED" ]; then
  echo "sharp-electron: installed sharp $actual does not match required $EXPECTED" >&2
  exit 1
fi
# The pinned Sharp submodule contains the complete source and scripts/build.mjs,
# but its package metadata is still 0.35.4. Copy only the exact root Sharp
# 0.35.5 package metadata over it; retain the submodule source (including the
# pinned build script) and apply the fork's patches to that source. This avoids
# deleting the build script and keeps every source/ref immutable.
ROOT_SHARP=$(ls -d "$ROOT"/node_modules/.pnpm/sharp@"${EXPECTED}"_*/node_modules/sharp 2>/dev/null | head -n 1)
if [ ! -f "$ROOT_SHARP/package.json" ] || [ ! -f "$ROOT_SHARP/dist/index.cjs" ] || [ ! -f "$WORK/vendor/sharp/scripts/build.mjs" ]; then
  echo "sharp-electron: complete root Sharp $EXPECTED metadata or vendored scripts/build.mjs missing" >&2
  exit 1
fi
cp "$ROOT_SHARP/package.json" "$WORK/vendor/sharp/package.json"
actual=$(node -p "require('$WORK/vendor/sharp/package.json').version")
if [ "$actual" != "$EXPECTED" ]; then
  echo "sharp-electron: Sharp metadata $actual does not match required $EXPECTED" >&2
  exit 1
fi
(cd "$WORK" && find scripts vendor/sharp-libvips -type f -name "*.sh" -print0 | xargs -0 sed -i "s/\\<docker\\>/$CONTAINER_ENGINE/g" && npm run build:libvips && npm run build:sharp)
actual=$(node -p "require('$WORK/node_modules/sharp/package.json').version")
if [ "$actual" != "$EXPECTED" ]; then
  echo "sharp-electron: build did not use sharp $EXPECTED" >&2
  exit 1
fi
if [ ! -f "$WORK/node_modules/sharp/dist/index.cjs" ]; then
  echo "sharp-electron: built package has no dist/index.cjs" >&2
  exit 1
fi
# Keep only the runtime binding. Native build intermediates and optional @img
# payloads are not part of the exported Electron package and otherwise make
# duplicate-count validation fail.
# Container builds run as root in GitHub's docker, so the artefacts belong to
# root and a plain rm fails for the runner user; fall back to passwordless sudo
# only when the direct removal is denied.
delete_matching() {
  local description="$1" pattern="$2" name="$3" file
  while IFS= read -r -d '' file; do
    rm -f "$file" 2>/dev/null || sudo -n rm -f "$file" || {
      echo "sharp-electron: cannot delete $description $file" >&2
      exit 1
    }
  done < <(find "$WORK" -type f -path "$pattern" -name "$name" -print0)
}
delete_matching 'build intermediate' '*/obj.target/*' 'sharp-*.node'
delete_matching 'optional payload' '*/node_modules/@img/sharp-*/lib/sharp-*.node' 'sharp-*.node'
binding_count=$(find "$WORK" -type f -name "sharp-*.node" | wc -l)
if [ "$binding_count" -ne 1 ]; then
  echo "sharp-electron: expected exactly one native binding, found $binding_count" >&2
  find "$WORK" -type f -name "sharp-*.node" -print >&2
  exit 1
fi
binding=$(find "$WORK" -type f -name "sharp-*.node" -print -quit)
case "$(basename "$binding")" in
  "sharp-linux-x64-$EXPECTED.node") ;;
  *) echo "sharp-electron: unexpected binding $(basename "$binding")" >&2; exit 1 ;;
esac
if find "$WORK" -type f -name '*0.35.4.node' -print -quit | grep -q .; then
  echo "sharp-electron: stale 0.35.4 native binding present" >&2
  find "$WORK" -type f -name '*0.35.4.node' -print >&2
  exit 1
fi
# Export the matching libvips runtime beside the platform payload. Keep one
# canonical copy so the Electron smoke test and packaged app resolve the same
# library without relying on the host's system libvips.
LIBVIPS_SOURCE="$WORK/dist/linux-x64/lib"
LIBVIPS_FILE=$(find "$LIBVIPS_SOURCE" -maxdepth 1 -type f -name 'libvips-cpp.so.*' -print -quit)
if [ -z "$LIBVIPS_FILE" ]; then
  echo "sharp-electron: built libvips-cpp runtime not found in $LIBVIPS_SOURCE" >&2
  exit 1
fi
rm -rf "$OUTPUT"
mkdir -p "$(dirname "$OUTPUT")"
# Keep this artifact outside the desktop runtime build root: prepare-dsh resets
# that root before prepareSharpElectron consumes the externally-built package.
cp -a "$WORK/node_modules/sharp" "$OUTPUT"
mkdir -p "$OUTPUT/lib"
cp -a "$LIBVIPS_FILE" "$OUTPUT/lib/"
node -e "const p=require('$OUTPUT/package.json'); if(p.version !== process.env.EXPECTED) throw new Error('built sharp version '+p.version+' != '+process.env.EXPECTED)"
mkdir -p "$OUTPUT/src/build/Release"
cp -a "$binding" "$OUTPUT/src/build/Release/"
for required in dist src; do
  test -e "$OUTPUT/$required" || { echo "sharp-electron: missing $required" >&2; exit 1; }
done
if find "$OUTPUT" -type f -name '*0.35.4.node' -print -quit | grep -q .; then
  echo "sharp-electron: exported package contains stale 0.35.4 binding" >&2
  exit 1
fi
printf '%s\\n' "sharp-electron: exported Sharp $EXPECTED with binding $(basename "$binding")"