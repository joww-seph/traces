#!/usr/bin/env sh
# Puts the demo database (traces_manual, made-up data only) back to its starting state before a new capture.
# Run from the repository root while the demo API is stopped or running (it only truncates and re-seeds).
set -e
cd server
export DATABASE_URL=postgres://traces:traces@127.0.0.1:5432/traces_manual STORAGE_DIR=./storage-manual NODE_ENV=development
npx tsx src/scripts/seed-dev.ts --reset
npx tsx src/scripts/seed-dev.ts --more
docker compose -f ../docker-compose.yml exec -T db psql -U traces -d traces_manual -q \
  -c "DELETE FROM session; DELETE FROM users WHERE email NOT IN ('it.admin@dost1.example','supply.officer@dost1.example'); DELETE FROM report_signatories;"
