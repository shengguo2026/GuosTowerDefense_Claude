#!/usr/bin/env sh
# Guo's Tower Defense: start the game (macOS / Linux).
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is needed for this development build. Install the LTS version from https://nodejs.org and start again."
  exit 1
fi
exec node tools/start.mjs
