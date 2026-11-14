# Rebuilding the user manual

`docs/TRACES-User-Manual.pptx` is made from real screenshots of a demo copy of TRACES that holds **made-up data only**
(the repository is public: never capture the real database).

1. Once: create the demo database and its two accounts.
   ```bash
   docker compose exec -T db psql -U traces -d postgres -c "CREATE DATABASE traces_manual"
   cd server
   export DATABASE_URL=postgres://traces:traces@127.0.0.1:5432/traces_manual STORAGE_DIR=./storage-manual NODE_ENV=development
   npx drizzle-kit migrate
   npx tsx src/scripts/seed-superadmin.ts --email it@region1.dost.gov.ph --password Manual-Admin-2026 --name "IT Administrator" --base-url http://localhost:5373
   npx tsx src/scripts/seed-superadmin.ts --email jdelacruz@region1.dost.gov.ph --password Manual-Supply-2026 --name "Juan Dela Cruz" --role supply_admin
   ```
2. Start the demo servers (two terminals, from the repository root):
   ```bash
   cd server && DATABASE_URL=postgres://traces:traces@127.0.0.1:5432/traces_manual STORAGE_DIR=./storage-manual PORT=3200 APP_ORIGIN=http://localhost:5373 SESSION_SECRET=manual-secret-manual-secret-manual-0000 npx tsx src/index.ts
   cd client && CLIENT_PORT=5373 API_TARGET=http://localhost:3200 npx vite
   ```
3. Reset the demo data, capture, build:
   ```bash
   sh scripts/manual/reset-demo.sh
   node scripts/manual/capture.mjs       # docs/manual/shots/*.png and steps.json; lists any errors seen while crawling
   node scripts/manual/build-deck.cjs    # docs/TRACES-User-Manual.pptx
   ```
The steps text lives in `capture.mjs` next to the click that each screenshot shows.
