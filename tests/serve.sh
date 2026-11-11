#!/usr/bin/env bash
# Serves the game at http://127.0.0.1:8773/index.html (the tests' default IR_URL). No build step.
cd "$(dirname "$0")/.." && exec python3 -m http.server "${PORT:-8773}"
