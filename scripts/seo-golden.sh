#!/usr/bin/env bash
# scripts/seo-golden.sh — build, serve locally, snapshot/verify SEO, clean up.
# Usage: ./scripts/seo-golden.sh [--write]
set -euo pipefail
cd "$(dirname "$0")/.."

PORT=4321
echo "[seo-golden] building…"
npm run build >/tmp/seo-golden-build.log 2>&1 || { echo "BUILD FAILED"; tail -20 /tmp/seo-golden-build.log; exit 1; }

echo "[seo-golden] starting local server on :$PORT…"
PORT=$PORT npm start >/tmp/seo-golden-serve.log 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null || true' EXIT

for i in $(seq 1 30); do
  if curl -sf -o /dev/null "http://localhost:$PORT/"; then break; fi
  sleep 1
done

npx tsx scripts/seo-golden.ts "$@"
