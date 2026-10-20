#!/usr/bin/env bash
# Mosaikit — release completa in un colpo solo:
#   1. build dei 5 plugin WASM -> dist/*.mskp
#   2. build di produzione del frontend React -> mosaikit-ui/dist
#   3. build release del server (UI embedded via rust-embed)
#   4. assemblaggio della cartella release/ (exe + plugin + istruzioni)
#
# Uso (Git Bash / Linux/macOS):
#   bash release.sh
# Requisiti: rustup + target wasm32, Node.js + npm, Git Bash su Windows.
set -euo pipefail
cd "$(dirname "$0")"

echo "== 1/4 Plugin WASM (.mskp) =="
for p in plugin-notes plugin-tasks plugin-contacts plugin-maps plugin-static-site plugin-files; do
  echo "--- $p"
  (cd "$p" && bash build.sh)
done

echo "== 2/4 Frontend React (npm run build) =="
(cd mosaikit-ui && npm install && npm run build)

echo "== 3/4 Server (cargo build --release) =="
(cd mosaikit-server && cargo build --release)

echo "== 4/4 Assemblaggio cartella release/ =="
rm -rf release
mkdir -p release/plugins
EXE="mosaikit-server/target/release/mosaikit-server.exe"
[ -f "$EXE" ] || EXE="mosaikit-server/target/release/mosaikit-server"
cp "$EXE" release/
cp plugin-*/dist/*.mskp release/plugins/
cat > release/AVVIO.txt <<'EOF'
Mosaikit — release
==================
1. Avvia:      mosaikit-server.exe          (http://127.0.0.1:8080)
   Porta custom:  PORT=8081 mosaikit-server.exe        (Git Bash)
                  $env:PORT="8081"; .\mosaikit-server.exe   (PowerShell)
2. Login:      admin / mosaikit2026!   (gestione plugin)
               user  / demo1234        (CRUD + attiva/disattiva)
3. I plugin sono in plugins/ (*.mskp): installali dalla UI
   (icona a puzzle -> scegli file -> Installa pacchetto -> Attiva).
4. I dati (plugin installati + CRUD) vengono salvati in ../mosaikit-data/
   (root del progetto) rispetto alla directory da cui avvii l'eseguibile.

Credenziali e architettura: vedi README.md nella root dei sorgenti.
EOF

echo
echo "Release pronta in ./release/"
ls -la release release/plugins 2>/dev/null || ls release release/plugins
