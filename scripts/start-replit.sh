#!/usr/bin/env bash
set -euo pipefail
if [[ -z "${DATABASE_URL:-}" ]]; then
 echo 'Set DATABASE_URL in Replit Secrets using the Supabase Session Pooler URL.'
 exit 1
fi
npm install --prefix api --no-audit --no-fund
npm install --prefix web --no-audit --no-fund
export API_INTERNAL_URL=http://127.0.0.1:4000
export PORT=4000
(npm run dev --prefix api) &
API_PID=$!
trap 'kill "$API_PID" 2>/dev/null || true' EXIT
export PORT=3000
npm run dev --prefix web
