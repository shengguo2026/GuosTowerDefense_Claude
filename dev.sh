#!/usr/bin/env sh
# Guo's Tower Defense: developer mode with hot reload (macOS / Linux).
cd "$(dirname "$0")" || exit 1
[ -d node_modules ] || npm install
exec node tools/dev.mjs
