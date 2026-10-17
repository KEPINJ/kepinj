#!/usr/bin/env bash
# Membuat bku-bkad-cpanel.zip: paket siap unggah ke hosting cPanel ("Setup Node.js App").
# Prasyarat: dependensi web sudah terpasang (cd web && npm ci).
set -euo pipefail
cd "$(dirname "$0")/.."

(cd web && npm run build)

OUT=dist-cpanel
rm -rf "$OUT" bku-bkad-cpanel.zip
mkdir -p "$OUT/bku/web"
tar -cf - --exclude=node_modules --exclude=test --exclude='*.log' --exclude=tmp --exclude='passenger.*' server shared samples | tar -xf - -C "$OUT/bku"
cp -r web/dist "$OUT/bku/web/dist"
rm -rf "$OUT/bku/web/dist/demo"  # snapshot mode demo (bila ada) tidak dipakai di server
cp docs/HOSTING-CPANEL.md "$OUT/bku/PANDUAN-HOSTING.md"
(cd "$OUT" && zip -qr ../bku-bkad-cpanel.zip bku)
rm -rf "$OUT"
echo "Paket dibuat: bku-bkad-cpanel.zip ($(du -h bku-bkad-cpanel.zip | cut -f1))"
