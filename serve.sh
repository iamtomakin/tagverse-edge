#!/usr/bin/env bash
# Serve the static site. Default port 8765; pass another if "Address already in use".
# Usage: ./serve.sh
#        ./serve.sh 8080
set -e
cd "$(dirname "$0")"
PORT="${1:-8765}"
echo "Serving http://localhost:${PORT}/  (Ctrl+C to stop)"
echo "If you see 'Address already in use', run: ./serve.sh 8080"
exec python3 -m http.server "$PORT"
