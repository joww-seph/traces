# TRACES Implementation Plan (PERN)

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to carry out this plan task by task. Use `superpowers:test-driven-development` for every task marked **[TDD]**. Read `docs/plans/2026-11-13-traces-design.md` first. `docs/plans/traces-schema.sql` is the reference DDL; it has been tested and must not be redesigned. Section references (§, BR-xx) point to the design doc.

**Goal:** Ship TRACES, a QR-tagged ICS/PAR inventory system for the DOST Region 1 Supply Unit, in 3 days.

**Architecture:** npm-workspaces monorepo. The React (Vite) client calls an Express 5 API using session cookies. Express talks to PostgreSQL through Drizzle ORM. Card, Registry and RPC are **SQL views** over a `movements` ledger; TypeScript only merges card rows and assembles the four-tab view. PDFs are kept on disk.

**Tech stack:**
- **Language:** TypeScript everywhere
- **Server:** Node 22+/24, Express 5, PostgreSQL 16+ (Docker `postgres:17` in dev), `pg` + Drizzle ORM + drizzle-kit, express-session + connect-pg-simple, @node-rs/argon2, zod, multer, helmet, express-rate-limit, ExcelJS, pdf-lib
- **Client:** React 19, Vite, Tailwind CSS v4, React Router, TanStack Query, react-hook-form, AG Grid Community, react-pdf, qrcode
- **Testing:** Vitest + supertest against the `traces_test` database

**Ground rules**
- Commit after every task with a conventional commit message.
- Tests use only `TEST_DATABASE_URL`. A global setup runs the migrations once; `beforeEach` truncates the tables (`TRUNCATE … RESTART IDENTITY CASCADE`) and re-seeds the `settings` row.
- Install the latest stable versions; don't pin versions you haven't checked.
- Money is `bigint` centavos (`mode: 'number'`) and dates are `date` (`mode: 'string'`). No floats, no JS `Date` for date-only values.
- Never build SQL by joining strings. Use Drizzle or `sql\`` template parameters.
- If a task is blocked by a **[PENDING]** item, implement the spec default.

---

## DAY 1 — Foundation, database, auth, documents, line entry (today, 2026-11-13)

Day 1 exit criteria: log in as superadmin → create an officer → upload an ICS PDF → add a line (1 main unit + 2 components) with a drawn box → `SELECT * FROM v_registry` shows issued 1.

### Task 1: Prerequisites and database container
**Files:** create `docker-compose.yml`, `docker/init/01-test-db.sql` (spec §15)
**Steps**
1. Check `node -v` (≥22), `docker --version` and `git --version`.
2. Run `docker compose up -d db`.
3. Run `docker compose exec db psql -U traces -d traces_dev -c 'select version()'`.

**Verify:** both `traces_dev` and `traces_test` exist (`\l`).
**Commit:** `chore: postgres dev container`

### Task 2: Monorepo scaffold
**Files**
- Create `package.json` (root, `"workspaces": ["shared","server","client"]`), `tsconfig.base.json`
- Create `.gitignore` (node_modules, dist, storage, backups, .env*)
- Create `shared/package.json`, `shared/tsconfig.json`, `shared/src/index.ts`
- Create `server/package.json`, `server/tsconfig.json`, `server/.env.example`
- Create the client with `npm create vite@latest client -- --template react-ts`

**Steps**
1. `git init`.
2. Add the root scripts from spec §16. Install `concurrently` at the root.
3. Server dependencies: `express pg drizzle-orm express-session connect-pg-simple @node-rs/argon2 zod multer helmet express-rate-limit exceljs pdf-lib dotenv`. Server dev dependencies: `typescript tsx vitest supertest drizzle-kit @types/express @types/pg @types/express-session @types/connect-pg-simple @types/multer @types/supertest`.
4. Client dependencies: `react-router @tanstack/react-query react-hook-form @hookform/resolvers zod ag-grid-community ag-grid-react react-pdf qrcode`. Add Tailwind v4 through `@tailwindcss/vite`.
5. Workspace dependency `"@traces/shared": "*"` in both server and client.

**Verify:** `npm install` succeeds and `npm -w client run dev` serves the Vite page.
**Commit:** `chore: scaffold traces monorepo`

### Task 3: Drizzle schema, migrations, views [TDD]
**Files**
- Create `server/drizzle.config.ts` (dialect `postgresql`, schema `./src/db/schema.ts`, out `./drizzle`)
- Create `server/src/db/schema.ts`: every enum and table in `traces-schema.sql`, with the same names, constraints and indexes. Use:
  - `pgEnum`
  - `uuid().defaultRandom()`
  - `bigint({mode:'number'})`
  - `date({mode:'string'})`
  - `integer().generatedAlwaysAsIdentity()`
  - expression indexes via `uniqueIndex('properties_property_no_uq').on(sql\`upper(${t.propertyNo})\`)`
  - partial index `.where(sql\`revoked_at IS NULL\`)`
  - `check()` constraints
- Run `npx drizzle-kit generate --name init`
- Create a custom migration (`npx drizzle-kit generate --custom --name views`) and paste every `CREATE VIEW` from `traces-schema.sql` into it, unchanged
- Create `server/src/db/client.ts`: `pg.Pool` from `DATABASE_URL` → `drizzle(pool, { schema })`; export `db`, `pool`
- Create `server/src/db/views.ts`: typed read-only view definitions with `pgView('v_registry', {...}).existing()` for each view
- Create the test setup: `server/vitest.config.ts`, `server/src/test/globalSetup.ts` (migrate the test database), `server/src/test/db.ts` (`resetDb()`, `seedSettings()`)
- Test: `server/src/test/schema.test.ts`

**Steps**
1. Write the failing schema test. It queries `information_schema.tables` and `pg_views` for every table and view name, and `pg_indexes` for `properties_property_no_uq` and `qr_tokens_one_active_uq`.
2. Add the constraint tests, ported from the verified SQL. Each expects a Postgres error code:
   - inserting `2026-09ict-0199` after `2026-09ICT-0199` → `23505`
   - a second active token for a property → `23505`
   - an ISSUE without an officer → `23514`
   - partial PDF columns → `23514`
   - property no. `bad no/1` → `23514`
3. Implement the schema and migrations until the tests pass. Run `npm run db:migrate` on `traces_dev` as well.

**Verify:** `npm run db:studio` shows every table.
**Commit:** `feat(db): normalized schema, constraints, sheet views`

### Task 4: Shared schemas and utilities [TDD]
**Files**
- Create `shared/src/utils/money.ts`: `pesoToCentavos(string|number)`, `formatPeso(centavos)`
- Create `shared/src/utils/dates.ts`: `isIsoDate`, `formatLongDate('2026-05-12') → 'May 12, 2026'`
- Create `shared/src/utils/category.ts`: `categorize(unitCostCentavos, thresholdCentavos)`
- Create `shared/src/utils/propertyNo.ts`: `normalizePropertyNo` (trim, validate `^[A-Za-z0-9-]+$`), `nextInSequence('2026-09ICT-0199') → '2026-09ICT-0200'` (keeps zero padding)
- Create `shared/src/schemas/*.ts`: zod for login, officer, documentMeta, lineInput (line + region + properties[]), propertyPatch, count, countItemPatch, settings, userCreate/patch
- Test: `shared/src/__tests__/utils.test.ts`

**Tests**
- `pesoToCentavos('96,450.00') === 9645000`
- `pesoToCentavos('0.1') === 10`
- `categorize(4999999, 5000000) === 'semi'` and `categorize(5000000, 5000000) === 'ppe'`
- `nextInSequence('2026-09ICT-0099') === '2026-09ICT-0100'`
- `lineInput` rejects `qty: 0`, rejects zero properties, and rejects repeated property numbers within the request (case-insensitive)

**Commit:** `feat(shared): schemas, money/date/category/property utils`

### Task 5: Express app skeleton
**Files**
- Create `server/src/app.ts`: `createApp()` with helmet, `express.json({limit:'1mb'})`, `/api/health` (runs `select 1`), and the error middleware last
- Create `server/src/index.ts`: listens on `0.0.0.0:PORT`
- Create `server/src/middleware/error.ts`. Mapping:
  - `ZodError` → 400
  - `AppError` → its status
  - pg `23505` → 409 (pull the key from `err.detail`)
  - pg `23503`/`23514` → 400
  - anything else → 500, logged, with a generic message
- Create `server/src/middleware/validate.ts`
- Test: `server/src/test/health.test.ts`

**Commit:** `feat(server): app factory, error + validation middleware`

### Task 6: Sessions, login, roles [TDD]
**Files**
- Create `server/src/middleware/session.ts`: `express-session` with `connect-pg-simple` (`pool`, `tableName:'session'`, `createTableIfMissing:false`). Name `traces.sid`, `httpOnly`, `sameSite:'lax'`, `secure` in production, `rolling:true`, `maxAge` 8 hours, `saveUninitialized:false`.
- Create `server/src/middleware/origin.ts`: for non-GET/HEAD requests, require that `Origin` is in `APP_ORIGIN`, otherwise 403
- Create `server/src/middleware/auth.ts`: `requireAuth` loads `req.session.userId` → reads the user → 401 if missing or inactive → sets `req.user`. Also `requireRole(...roles)` → 403.
- Create `server/src/routes/auth.ts`:
  - `POST /api/auth/login`: argon2 `verify`, then `req.session.regenerate`, then set `userId` and `role`. Rate limit 10 per 15 min, keyed by IP + email.
  - `POST /api/auth/logout`
  - `GET /api/me`
  - `POST /api/me/password`
- Create `server/src/services/users.ts`: `hashPassword`, `verifyPassword`, `createUser`, `deactivateUser`, which runs `DELETE FROM session WHERE sess->>'userId' = $1`
- Create `server/src/scripts/seed-superadmin.ts`: creates the superadmin (`must_change_password=false`) and inserts the settings row if it's missing (entity "DEPARTMENT OF SCIENCE AND TECHNOLOGY - REGION 1", fund cluster "RAF", threshold 5000000, `public_base_url` from argv or `http://localhost:5173`)
- Create `server/src/test/helpers.ts`: `loginAs(role)` returns a `supertest.agent` that keeps the cookie and sends the `Origin` header
- Test: `server/src/test/auth.test.ts`

**Tests**
- Wrong password → 401 with a generic message
- Correct password → 200, cookie set, `/api/me` returns the role
- Logout → `/api/me` returns 401
- A POST without `Origin` → 403
- A supply_admin calling a superadmin route → 403
- `deactivateUser` → that user's next request returns 401
- The 11th login attempt → 429

**Commit:** `feat(server): session auth, roles, origin check, superadmin seed`

### Task 7: Settings and officers
**Files**
- Create `server/src/services/settings.ts`: `getSettings()` with a 30 s cache, cleared on update
- Create `server/src/routes/settings.ts` (`GET /api/settings`) and `server/src/routes/admin/settings.ts`
- Create `server/src/services/officers.ts` and `server/src/routes/officers.ts`
- Test: `server/src/test/officers.test.ts`

**Tests**
- Create, list, patch and deactivate an officer
- A duplicate `short_name` with different letter case → 409
- A supply_admin calling `PATCH /api/admin/settings` → 403

**Commit:** `feat: settings + officers`

### Task 8: Document upload [TDD]
**Files**
- Create `server/src/middleware/upload.ts`: multer disk storage to `STORAGE_DIR/pdfs` with a UUID file name and a 20 MB limit, then a check that the file starts with `%PDF-`. On failure, delete the file and return 400.
- Create `server/src/services/documents.ts`:
  - **create:** reads the page count with pdf-lib, snapshots both officers' current `position` into `*_position` (the form may override), then inserts. On `23505`, delete the file and return 409.
  - also `list` (filters + pagination), `get` (with lines, regions and properties), `patch` (replacing the PDF deletes the old file only *after* commit), `softDelete`
- Create `server/src/routes/documents.ts`, including `GET /:id/pdf` via `res.sendFile` with the correct headers
- Test: `server/src/test/documents.test.ts`, with fixtures `sample.pdf` (a minimal valid PDF) and `fake.pdf`

**Tests**
- Upload → 201, with positions copied from the officers
- Duplicate ICS number → 409 and the file is gone from disk
- A fake PDF → 400
- An ICS and a PAR with the same number → both 201
- A soft-deleted document doesn't appear in the list

**Commit:** `feat: ICS/PAR document upload and storage`

### Task 9: The line save transaction (core) [TDD]
**Files**
- Create `server/src/services/qr.ts`: `newToken()` makes 10 base62 characters with `crypto.randomInt`
- Create `server/src/services/lines.ts`: `createLine`, `updateLine`, `deleteLine`
- Create `server/src/routes/lines.ts`
- Test: `server/src/test/lines.test.ts`

**The transaction (BR-04):**
```ts
return db.transaction(async (tx) => {
  const doc = await tx.query.documents.findFirst({ where: and(eq(documents.id, docId), isNull(documents.deletedAt)) });
  if (!doc) throw new AppError('DOCUMENT_NOT_FOUND', 404);
  const s = await getSettings(tx);
  const category = categorize(input.line.unitCostCentavos, s.ppeThresholdCentavos);
  const [line] = await tx.insert(lines).values({ ...input.line, documentId: docId, category }).returning();
  if (input.region) await tx.insert(linePdfRegions).values({ lineId: line.id, ...input.region });
  const props = await tx.insert(properties).values(input.properties.map(p => ({ ...p, lineId: line.id }))).returning();
  await tx.insert(qrTokens).values(props.map(p => ({ token: newToken(), propertyId: p.id })));
  const receiptDate = input.line.iarDate ?? input.line.dateAcquired ?? doc.issuedDate;
  await tx.insert(movements).values(props.flatMap(p => [
    { propertyId: p.id, type: 'RECEIPT', date: receiptDate,
      referenceDocumentId: input.line.iarNo ? null : doc.id, referenceText: input.line.iarNo ?? null },
    { propertyId: p.id, type: 'ISSUE', date: doc.issuedDate,
      officerId: doc.receivedByOfficerId, referenceDocumentId: doc.id },
  ]));
  await audit(tx, ctx, 'line.create', 'lines', line.id, null, input);
  return { lineId: line.id, category, warning: mismatchWarning(doc.type, category) };
});
```
- `line_no` defaults to `max(line_no)+1` for the document (read inside the transaction with `FOR UPDATE` on the document row).
- **Duplicate property number:** the `23505` on `properties_property_no_uq` becomes 409 `{ code:'DUPLICATE_PROPERTY_NO', details:{ propertyNo } }`, with the number parsed from `err.detail`.
- **Token collision:** a `23505` on `qr_tokens_pkey` retries the whole transaction (max 3 tries).

**Tests**
1. 1 main + 2 components → exactly 1 line, 1 region, 3 properties, 3 tokens, 6 movements and 1 audit row. Then `v_registry` shows `issued_qty = 1` and three property numbers.
2. ₱96,450 → `ppe`, with a `warning` on an ICS. ₱48,700 → `semi` with no warning.
3. A duplicate property number in a different letter case → 409 naming it, and the **row counts don't change** (rollback proven).
4. An unknown document → 404. A soft-deleted document → 404.
5. PATCH adds a property → +1 property, +1 token, +2 movements. PATCH removes a property → `voided_at` set and token revoked; the registry no longer lists it.
6. A cost PATCH across the threshold → category unchanged, with a `warning`.

**Commit:** `feat: atomic ICS/PAR line save`

### Task 10: Client foundation and login
**Files**
- Create `client/src/api.ts`: a `fetch` wrapper (`credentials:'same-origin'`, JSON headers, error-shape parsing → `ApiError`). A 401 on any admin call redirects to `/login`.
- Create `client/src/auth/AuthProvider.tsx`: `useQuery(['me'])` → `{user, role, loading}`. It also handles logout.
- Create `client/src/auth/RequireRole.tsx`, which also forces `/account/password` when `mustChangePassword`
- Create `client/src/router.tsx` (all routes from spec §11; pages can be placeholders), `pages/Login.tsx`, `pages/account/Password.tsx`, `layouts/AdminLayout.tsx`
- Modify `client/vite.config.ts`: Tailwind, `server.host: true`, `proxy: { '/api': { target: 'http://localhost:3000', changeOrigin: false } }`

The browser's `Origin` header must be listed in `APP_ORIGIN`. Add both `http://localhost:5173` and `http://<LAN-IP>:5173`.

**Verify**
- Run `npm run seed:superadmin -- --email it@traces.local --password 'ChangeMe!12345'`.
- Log in → dashboard. Refreshing the page keeps you logged in. Logging out works.

**Commit:** `feat(client): session auth, routing, api client, admin layout`

### Task 11: Officers and documents pages
**Files**
- Create `client/src/components/FormGrid.tsx`: AG Grid wrapper (column groups, `highlightRowId`, money formatter)
- Create `client/src/components/PdfViewer.tsx`: react-pdf; configure the pdf.js worker the Vite way, as react-pdf's README describes
- Create `client/src/pages/officers/*` and `client/src/pages/documents/{List,New,Detail}.tsx`. The New page pre-fills each officer's position, and the admin can edit it as printed.

**Verify:** create two officers → upload the sample ICS → the detail page shows the PDF and an empty lines grid.
**Commit:** `feat(client): officers + documents pages, FormGrid, PdfViewer`

### Task 12: Line entry with PDF box drawing
**Files**
- Create `client/src/components/PdfRegionPicker.tsx`: a pointer-event overlay. Dragging draws a rectangle; on release it emits `{page, x, y, w, h}` as fractions of the page. It shows the saved region, a Clear button and page navigation.
- Create `client/src/pages/lines/LineForm.tsx`:
  - Fields: qty, unit, ₱ unit cost, article, description, either estimated useful life (ICS) or date acquired (PAR), optional IAR no./date
  - A live category badge computed from `GET /api/settings`
  - A property editor: the main-unit row(s) plus "Add component" (requires a label). "Add N units" fills numbers in sequence with `nextInSequence`. Warns when the number of main units ≠ qty.
  - The PDF picker sits beside the form (stacked on mobile)
- Server 409 → highlight the duplicate property field

**Verify (Day 1 exit):** add the SARAi laptop set (`2026-09ICT-0199` + `0199a` mouse + `0199b` headset, ₱96,450) with a box over row 1. In Drizzle Studio, `v_registry` shows issued 1. Re-entering `2026-09ict-0199` shows the 409 on the field.
**Commit:** `feat(client): line entry form with PDF region picker`

---

## DAY 2 — Views, QR, stickers

Day 2 exit criteria: print a 1x1 sticker, scan it with a phone over the LAN, and see four tabs with the right rows highlighted.

### Task 13: View queries and card merge [TDD]
**Files**
- Create `server/src/services/views.ts`:
  - `registry(category, from?, to?)` reads `v_registry`
  - `card(propertyNo)` reads `v_card_movements` ordered by `date, movement_id`, then runs `mergeCardRows`
  - `countRows(countId)` reads `v_count_rows`
- Create `server/src/projections/card.ts`: `mergeCardRows(rows, mode)` (BR-07; pure)
- Tests:
  - `server/src/projections/__tests__/card.test.ts` (pure unit tests)
  - `server/src/test/views.test.ts` (seed through the Task 9 service)

**Tests**
- Merged: RECEIPT and ISSUE on the same day → 1 row with receipt qty 1, issue qty 1, the officer, balance 1, amount = unit cost.
- Split → 2 rows.
- A DISPOSE inserted directly in the test → balance 0, amount 0.
- Registry: a qty-3 line with 3 main units → issued 3, amount 3 × unit cost; returned/disposed show as 0.
- Count rows: `qty_on_hand` NULL → shortage NULL; on hand 0 against balance 1 → −1 and −unit value.

**Commit:** `feat: registry, card and count view services`

### Task 14: PropertyView assembly and admin endpoints
**Files**
- Create `server/src/projections/propertyView.ts`: `buildPropertyView(data, audience)`. For the public audience it limits the registry to the same document, removes UUIDs and maps row IDs to short opaque IDs.
- Create `server/src/services/propertyView.ts`: gathers the data in about 5 queries (property + line + document + officers; the document's lines; the card; the registry rows; the latest count rows)
- Create `server/src/routes/properties.ts` (`GET /:no`, `GET /:no/view`, `PATCH /:no`) and `server/src/routes/views.ts`
- Test: `server/src/test/propertyView.test.ts`. Every tab's `highlightRowId` must exist in that tab's rows. Without a count, the report tab is `{empty:'NOT_COUNTED'}`.

**Commit:** `feat: property view + registry/card endpoints`

### Task 15: Public QR endpoints [TDD]
**Files**
- Create `server/src/middleware/rateLimit.ts`
- Create `server/src/routes/public.ts`:
  - The token format is checked first (`^[0-9A-Za-z]{10}$`); a bad format → 404 without touching the database
  - Revoked token → 410 `QR_REPLACED`; voided property or deleted line/document → 410 `ITEM_REMOVED`
  - `X-Robots-Tag: noindex`
  - `GET /q/:token/pdf` streams the PDF

**Tests**
- Valid → 200, and walking the JSON finds no UUID-shaped strings, no `createdBy` and no `email`
- Bad format → 404
- Rotated → 410 `QR_REPLACED`
- Over the limit → 429 (lower the limit through env in the test)

**Commit:** `feat: public QR resolve + PDF stream`

### Task 16: PropertyTabs and public page
**Files**
- Create `client/src/components/PropertyTabs.tsx`:
  - Tabs **ICS/PAR · Report · Registry · Card**, with the active tab kept in the URL hash
  - ICS/PAR tab: the PDF at `pdfRegion.page` with a yellow overlay scrolled into view, plus a lines grid with the line highlighted
  - Every other tab: a paper-form header block plus a `FormGrid` with `highlightRowId`
- Create `client/src/pages/public/QrView.tsx`: no login; friendly pages for 404/410/429; built mobile-first
- Create `client/src/pages/properties/Detail.tsx`: the same tabs with admin data, an edit panel and "Rotate QR"

**Verify:** on a phone at `http://<LAN-IP>:5173/q/<token>` all four tabs load and the highlights are correct.
**Commit:** `feat(client): four-tab property view`

### Task 17: Registry and card pages
**Files:** create `client/src/pages/registry/Registry.tsx` (semi/ppe toggle, date filter, row click → property page; the PPE title comes from settings) and `client/src/pages/cards/Card.tsx` (SPC or PC columns depending on category)
**Verify:** column groups match spec §4 exactly.
**Commit:** `feat(client): registry and card grids`

### Task 18: QR rotation and stickers
**Files**
- Modify `server/src/routes/properties.ts`: `POST /:no/qr/rotate` (one transaction: revoke, insert a new token, write audit)
- Create `server/src/routes/stickers.ts`: `GET /api/stickers?documentId=|nos=` → `[{propertyNo, url}]`
- Create `client/src/pages/stickers/StickerSheet.tsx`:
  - 1x1 / passport toggle
  - `QRCode.toDataURL(url, { errorCorrectionLevel:'M', margin:2, width:300 })`
  - Print CSS from spec §12
  - The LAN warning banner
- Add "Print stickers" buttons on the document detail page and the property page

**Verify**
- Print at 100% and measure a cell (25.4 mm).
- A phone scans the 1x1 code from about 15 cm.
- After rotating, the old printout shows "replaced".

**Commit:** `feat: QR rotation and printable sticker sheets`

---

## DAY 3 — Counts, exports, superadmin, hardening

Day 3 exit criteria: every acceptance criterion in spec §18 passes.

### Task 19: Physical counts [TDD]
**Files**
- Create `server/src/services/counts.ts`:
  - **create:** in one transaction, insert the count, its signatories and `INSERT INTO count_items (count_id, property_id) SELECT $1, property_id FROM v_holdings WHERE holder_officer_id=$2 AND category=$3`
  - **refresh:** the same insert with `ON CONFLICT DO NOTHING`
  - **patchItem:** returns 409 if the count is closed
  - **close**
- Create `server/src/routes/counts.ts`
- Create `client/src/pages/counts/{List,Detail}.tsx`: header form + signatories; the grid has an editable "On hand per count" column (saves on cell blur); a "Close count" button
- Test: `server/src/test/counts.test.ts`

**Tests**
- A count for DPLibunao/ppe includes only DPLibunao's PPE holdings.
- `refresh` picks up a line saved later.
- A second count with the same `(category, officer, as_at)` → 409.
- `patchItem` on a closed count → 409.

**Commit:** `feat: physical count sessions (RPCSP/RPCPPE)`

### Task 20: Excel exports
**Steps**
1. Convert the provided `.xls` templates with `soffice --headless --convert-to xlsx` (Appendix 69 PC, 71 PAR, 73 RPCPPE). Copy the ICS and RegSPI sheets from `2026 ICT.xlsx`. Build SPC and RPCSP from the form screenshots. Save them all in `server/src/exports/templates/`.
2. `fill.ts` loads a template with ExcelJS, writes header cells using a per-form map (`map.ts`), and inserts data rows from the first data row, copying that row's style.
3. `GET /api/exports/:form` → `Content-Disposition: attachment; filename="RPCPPE_DPLibunao_2026-12-31.xlsx"`.
4. Add an Export button on every grid page.

**Verify:** open each file in Excel or LibreOffice. Headers are filled, columns line up, and borders are kept.
**Commit:** `feat: official-layout xlsx exports`
**If time is short:** do registry, card and RPC only.

### Task 21: Superadmin
**Files**
- Create `server/src/routes/admin/users.ts`:
  - **create:** temporary password, `must_change_password=true`
  - **patch role / active:** deactivating deletes the user's sessions
  - **resetPassword:** generates a temporary password, sets `must_change_password=true` and deletes the user's sessions
- Create `server/src/routes/admin/audit.ts`: keyset pagination with `WHERE id < $before ORDER BY id DESC LIMIT 50`
- Create `client/src/pages/admin/{Users,Settings,Audit}.tsx`
- Test: `server/src/test/admin.test.ts`

**Tests**
- A deactivated user is logged out immediately.
- A supply_admin gets 403 on every `/api/admin/*` route.
- A role change takes effect on that user's next request (the role is read from the database in `requireAuth`, not trusted from the session).

**Commit:** `feat: superadmin users, settings, audit log`

### Task 22: Hardening, seed and backup
**Checklist**
- [ ] Every write service calls `audit()` inside its transaction (grep for it)
- [ ] `npm test` is green and `npm run build` has no type errors
- [ ] Phone test over the LAN: scan, all four tabs, PDF pinch-zoom, 360 px layout
- [ ] Error pages: 404 / 410 replaced / 410 removed / 429 / session expired
- [ ] `seed-dev.ts`: officers MJRamos and DPLibunao, the sample ICS 2026-03SARAi-005 (laptop set + LCD TV `2026-09ICT-202`) and PAR 2025-RO-68 (fume hood)
- [ ] `backup.ts`: `pg_dump -Fc` (run through `docker compose exec` in development) and zip `STORAGE_DIR` into `backups/<ts>/`

**Commit:** `chore: hardening, dev seed, backup`

### Task 23: Production build and deploy guide
**Files**
- Modify `server/src/app.ts`: in production, add `app.set('trust proxy', 1)`, serve `client/dist` statically, and fall back to `index.html` for any route not under `/api`
- Create `docs/DEPLOY.md`, covering:
  - Postgres setup: an owner role for migrations and an app role with DML rights only
  - `npm run db:migrate`
  - `npm run build && npm start` under pm2 or systemd, behind nginx with HTTPS
  - Setting `public_base_url` to the real domain **before** printing real stickers
  - A nightly backup cron job

**Verify:** `NODE_ENV=production npm start` serves the app and the API on one port.
**Commit:** `chore: production build + deploy guide`

---

## Cut list (in order) if behind schedule
1. ICS/PAR exports (Task 20, partial)
2. Audit log viewer page (keep writing the logs)
3. Passport sticker size
4. Count `refresh` (recreate the count instead)
