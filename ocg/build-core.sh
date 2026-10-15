#!/bin/bash
set -e
WRAPPER_COMMIT=2f79a462f3f2cba6a0ec0092ad024446490ded45
CORE_COMMIT=93eff32a9bfc65cc3a748c7cf8a8774c10260b7f
LUA_COMMIT=75ea9ccbea7c4886f30da147fb67b693b2624c26
OCG="$(cd "$(dirname "$0")" && pwd)"
WORK="${OCG_CORE_BUILD_DIR:-/tmp/ocgcore-build}"
rm -rf "$WORK" && mkdir -p "$WORK" && cd "$WORK"
git clone -q https://github.com/n1xx1/ocgcore-wasm.git wrapper
cd wrapper
git checkout -q $WRAPPER_COMMIT
git apply "$OCG"/core-patches/*.patch
git clone -q https://github.com/edo9300/ygopro-core.git cpp/ygo
git -C cpp/ygo checkout -q $CORE_COMMIT
git clone -q https://github.com/lua/lua.git cpp/lua
git -C cpp/lua checkout -q $LUA_COMMIT
LUA=$(sed -n 's/^FILES_LUA="\(.*\)"/\1/p' scripts/build.sh)
mkdir -p lib
em++ -O2 -g0 -sASSERTIONS=0 -std=c++17 \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sALLOW_MEMORY_GROWTH=1 -sMALLOC=emmalloc \
  -fwasm-exceptions -sSUPPORT_LONGJMP=wasm -fno-rtti -sNO_EXIT_RUNTIME=1 -sENVIRONMENT=web \
  -sEXPORTED_FUNCTIONS=['_malloc','_free'] \
  -sEXPORTED_RUNTIME_METHODS=['stackSave','stackRestore','stackAlloc','getValue','stringToUTF8','lengthBytesUTF8','HEAP8','HEAPU8'] \
  -I./cpp/lua $LUA ./cpp/ygo/*.cpp ./cpp/wasm.cpp -o lib/ocgcore.sync.mjs
cp lib/ocgcore.sync.mjs lib/ocgcore.jspi.mjs
cp lib/ocgcore.sync.wasm lib/ocgcore.jspi.wasm
mkdir -p "$WORK/tools" && (cd "$WORK/tools" && npm init -y >/dev/null && npm i esbuild@0.25.12 >/dev/null)
ln -sfn "$WORK/tools/node_modules" node_modules
node scripts/build-lib.js >/dev/null
rm -rf "$OCG/core" && mkdir -p "$OCG/core"
cp dist/index.js dist/chunk-*.js dist/ocgcore.sync-*.js "$OCG/core/"
cat > "$OCG/core/build.json" <<JSON
{
  "name": "ocgcore-wasm",
  "version": "$(node -p "require('./package.json').version")",
  "url": "https://github.com/n1xx1/ocgcore-wasm",
  "commit": "$WRAPPER_COMMIT",
  "core": "https://github.com/edo9300/ygopro-core",
  "coreCommit": "$CORE_COMMIT",
  "lua": "https://github.com/lua/lua",
  "luaCommit": "$LUA_COMMIT",
  "emscripten": "$(em++ --version | head -1 | sed 's/.* \([0-9][0-9.]*\).*/\1/')",
  "script": "ocg/build-core.sh"
}
JSON
sed -i "s/^export const OCG_CORE_ID = .*/export const OCG_CORE_ID = '${CORE_COMMIT:0:8}'/" "$OCG/../app/simulator/ocg/license.js"
echo "[ocg-core] $OCG/core"
