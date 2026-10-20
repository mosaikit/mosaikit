#!/usr/bin/env bash
# Builda il plugin per wasm32 e impacchetta dist/<id>.mskp (con ui.js se il manifest dichiara "ui")
set -euo pipefail
cd "$(dirname "$0")"
rustup target add wasm32-unknown-unknown
cargo build --release --target wasm32-unknown-unknown
mkdir -p dist
python3 - <<'PY'
import json, struct
manifest = open("plugin.json", encoding="utf-8").read()
json.loads(manifest)
wasm = open("target/wasm32-unknown-unknown/release/mosaikit_plugin_maps.wasm", "rb").read()
ui = open("ui/maps.js", encoding="utf-8").read().encode("utf-8") if json.loads(manifest).get("ui") else b""
out = "dist/com.mosaikit.maps.mskp"
with open(out, "wb") as f:
    f.write(b"MSKP")
    f.write(struct.pack("<I", len(manifest.encode())))
    f.write(manifest.encode())
    if ui:
        f.write(struct.pack("<I", len(wasm)))
        f.write(wasm)
        f.write(ui)
    else:
        f.write(wasm)
print(f"{out}: {len(wasm)} byte wasm, {len(ui)} byte ui")
PY
