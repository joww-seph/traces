# TRACES — Design Specification

**T**agged **R**ecords of **AC**countable **E**quipment and **S**upplies
Client: Supply Unit, DOST Region 1 · Stack: **PERN** (PostgreSQL, Express, React, Node) · Dev start: 2026-11-13 (Day 1 of 3)

> **For Claude Code (Superpowers):** This is the approved design. Skip brainstorming. Use it as the source of truth for `writing-plans` / `executing-plans`. Companion files:
> - `docs/plans/2026-11-13-traces-implementation.md`: the task plan
> - `docs/plans/traces-schema.sql`: the **reference DDL and views**. It has been tested against PostgreSQL 16 with sample ICS data. The Drizzle schema and migrations must produce exactly this.
>
> Where this doc says **[PENDING]**, implement the stated default and keep it configurable.

---

## 1. Problem and core idea

The normal paper flow at the Supply Unit is:

```
Stock/Property Card → Registry (RegSPI) → RPCSP/RPCPPE → ICS/PAR → Sticker
```

TRACES **reverses** it. The admin enters each **ICS/PAR line once** and uploads the signed ICS/PAR PDF. The Card, Registry and physical count report then come out of that entry automatically, and every property number gets a **QR sticker**. Scanning the QR opens a public page with four tabs: the ICS/PAR PDF with the item's row highlighted, plus the Report, Registry and Card, each with the item's row highlighted.

**Single source of truth:** ICS/PAR line → properties → `movements` ledger. Card, Registry and Report are **SQL views** over that data. They are never typed in separately.

---

## 2. Users and roles

| Role | Who | Can do |
|---|---|---|
| `superadmin` | IT | Everything below, plus manage user accounts, settings and the audit log |
| `supply_admin` | Supply Unit staff | Officers, ICS/PAR documents and lines, properties, stickers, physical counts, exports |
| Public | Anyone holding a sticker | View the one property behind a scanned QR token. No listing, no search. |

---

## 3. Scope

**In scope**
- ICS/PAR entry form plus PDF upload
- Semi-expendable and PPE categories, set automatically by a ₱50,000 threshold
- Card (SPC for semi, PC for PPE), Registry (RegSPI, plus a Registry of PPE Issued using the same layout), RPCSP/RPCPPE
- Spreadsheet-style grid views with the target row highlighted
- QR tokens, a public view, 1x1 and passport-size sticker sheets
- Physical count sessions with "on hand per count" entry
- `.xlsx` export using the official form layouts
- Two account roles plus an audit log

**Out of scope (but the schema already allows them)**
- Transfers (PTR/ITR), returns (RRSP), re-issue and disposal UI. The movement types exist; no screens or routes.
- Importing the old Excel data. Data is entered fresh through the form.
- Consumables / Stock Card (for supplies, not equipment).
- Multi-entity support.
- Self-service password reset. The superadmin resets passwords.

---

## 4. Forms glossary (Philippine government property forms)

| Code | Name | What it is | TRACES role |
|---|---|---|---|
| **ICS** | Inventory Custodian Slip (Appendix 59) | Issuance slip for semi-expendable items | **Input** document + PDF |
| **PAR** | Property Acknowledgment Receipt (Appendix 71) | Issuance slip for PPE | **Input** document + PDF |
| **SPC** | Semi-Expendable Property Card | Per-property ledger card for semi items | View `v_card_movements` |
| **PC** | Property Card (Appendix 69) | Per-property ledger card for PPE | View `v_card_movements` |
| **RegSPI** | Registry of Semi-Expendable Property Issued (Annex A.4) | Issuance log, one row per ICS line | View `v_registry` |
| **Reg-PPE** | "Registry of PPE Issued" (not an official COA form) | RegSPI layout reused for PPE, at the stakeholder's request | View `v_registry` |
| **RPCSP** | Report on the Physical Count of Semi-Expendable Property | Count per accountable officer | View `v_count_rows` |
| **RPCPPE** | Report on the Physical Count of PPE (Appendix 73) | Same, for PPE | View `v_count_rows` |

### Column maps (these must match exactly in grids and exports)

**ICS line:** Quantity · Unit · Unit Cost · Total Cost · Description · Inventory Item No. · Estimated Useful Life
**PAR line:** Quantity · Unit · Description · Property Number · Date Acquired · Amount
**SPC:** Date · Reference · Receipt (Qty, Unit Cost, Total Cost) · Issue/Transfer/Disposal (Item No., Qty, Office/Officer) · Balance Qty · Amount · Remarks
**PC:** Date · Reference/PAR No. · Receipt Qty · Issue/Transfer/Disposal (Qty, Office/Officer) · Balance Qty · Amount · Remarks
**RegSPI / Reg-PPE:** Date · Reference (ICS/RRSP No.) · Property No. · Item Description · Estimated Useful Life · Issued (Qty, Office/Officer) · Returned (Qty, Office/Officer) · Re-issued (Qty, Office/Officer) · Disposed Qty · Balance Qty · Amount · Remarks
**RPCSP / RPCPPE:** Article · Description · Property No. · Unit of Measure · Unit Value · Balance per Card (Qty) · On Hand per Count (Qty) · Shortage/Overage (Qty, Value) · Remarks
**RPC header:** Type of property · As at · Fund Cluster · Accountable Officer · Official Designation · Entity Name · Date of Assumption · Signatories (Inventory Committee, Head of Agency, COA Representative)

---

## 5. PERN stack primer (read this once)

PERN = **P**ostgreSQL + **E**xpress + **R**eact + **N**ode.js. Each part has one job in TRACES:

```
 Phone / Browser                     Your server (one Node process)            Database
┌──────────────────┐  HTTPS + cookie ┌──────────────────────────────┐   SQL   ┌──────────────────┐
│ React (Vite)     │ ──────────────► │ Express on Node.js           │ ──────► │ PostgreSQL       │
│ - pages, grids   │                 │ - session login (cookie)     │         │ - tables (3NF)   │
│ - forms          │ ◄────────────── │ - business rules             │ ◄────── │ - constraints    │
│                  │      JSON       │ - Drizzle ORM → SQL          │         │ - views = sheets │
└──────────────────┘                 │ - PDFs on disk               │         │ - sessions table │
                                     └──────────────────────────────┘         └──────────────────┘
```

### P — PostgreSQL
A relational database: data lives in **tables** with **rows** and **columns**, and every column has a type. What TRACES relies on:
- **Constraints** are rules the database itself enforces, so bad data never gets in, even when the code has a bug:
  - `PRIMARY KEY`: every row has a unique ID.
  - `FOREIGN KEY` (`REFERENCES`): a line must point to a document that exists.
  - `UNIQUE`: no two properties can share a property number. TRACES uses a unique index on `upper(property_no)`, so `0199A` and `0199a` count as the same number.
  - **Partial unique index**: "only one *active* QR token per property" is enforced with `UNIQUE (property_id) WHERE revoked_at IS NULL`.
  - `CHECK`: e.g. `qty > 0`, and "an ISSUE movement must name an officer".
- **Transactions** (`BEGIN … COMMIT`): saving a line writes about 10 rows, and either all of them land or none do.
- **Views**: saved `SELECT` queries that you query like tables. **The Card, Registry and RPC "sheets" are views.** That is how the data stays normalized while the screens still look like the Excel forms.
- **Window functions**: `SUM(...) OVER (PARTITION BY property_id ORDER BY date)` computes the card's running balance inside the database.
- **Enums**: `CREATE TYPE doc_type AS ENUM ('ICS','PAR')` limits a column to known values.

### Normalization (what "3NF" means here)
- **1NF:** one value per cell. Property numbers live in their own table, not as a newline-separated list inside one cell like the Excel registry does. Count signatories get their own table instead of an array.
- **2NF:** every column depends on the *whole* key. For example, the unit cost belongs to the line, not to each property.
- **3NF:** nothing depends on another non-key column. Total cost (`qty × unit_cost`), amount, balance and shortage are **calculated in the views**, never stored.
- **Deliberate, explained exceptions:**
  - `lines.category` is fixed at entry. If the threshold changes later, old items keep their category.
  - `documents.*_position` stores the officer's position **as printed** on that form. Someone's position can change later, but the old ICS must still show the old position. That makes it a historical fact, not a duplicate.

### N — Node.js
Node runs JavaScript/TypeScript on the server. TRACES uses **TypeScript** everywhere. `npm workspaces` keeps `client/`, `server/` and `shared/` in one repo, so the server and the browser share the same validation schemas.

### E — Express
A small web framework. Each request runs through a chain of **middleware** functions `(req, res, next)` until a route handler sends the response:
```ts
app.use(helmet());                         // security headers
app.use(session({ store: pgStore, … }));   // loads req.session from the cookie
app.get('/api/officers', requireRole('supply_admin','superadmin'), async (req, res) => {
  res.json(await officersService.list());
});
```
On Express 5, an `async` handler that throws goes straight to the error middleware.

### Drizzle ORM (how Node talks to Postgres)
Drizzle lets you write SQL-shaped queries in TypeScript, with full types:
```ts
const rows = await db.select().from(officers).where(eq(officers.active, true));
await db.transaction(async (tx) => { await tx.insert(lines).values(…); … });
```
- `drizzle-kit generate` reads `schema.ts` and writes a SQL migration file. `drizzle-kit migrate` applies it.
- Views and anything Drizzle can't express go into **hand-written SQL migrations** (`drizzle-kit generate --custom`).
- `drizzle-kit studio` opens a browser UI for looking at tables while you develop.

### Login with sessions (no Firebase)
1. `POST /api/auth/login` checks the email and password against the `argon2` hash in `users`.
2. Express stores `{ userId, role }` in the **`session` table** (connect-pg-simple) and sends a cookie, `traces.sid`, which is `httpOnly` (JavaScript can't read it) and `SameSite=Lax`.
3. The browser sends the cookie automatically on every request. `requireAuth` loads the session; `requireRole` checks the role.
4. Logout deletes the session row. Deactivating a user deletes all of their session rows, so they're kicked out immediately.

### R — React
React builds the UI from **components** (functions that return markup). Supporting libraries:
- **React Router:** URLs → pages.
- **TanStack Query:** fetches and caches API data, and refetches after saves.
- **react-hook-form + zod:** forms, validated with the same schema the server uses.
- **AG Grid:** the spreadsheet-style views.
- **react-pdf:** shows the ICS/PAR PDF and draws the highlight box.

### How one request flows (example: saving an ICS line)
1. The React form is validated by `shared/schemas/line.ts`.
2. `POST /api/documents/:id/lines` is sent; the cookie goes along automatically.
3. Express: session → `requireRole` → zod validation of the body.
4. `linesService.create()` runs `db.transaction`: insert the line, the PDF region, the properties, the QR tokens and 2 movements per property, plus an audit row.
5. If a property number already exists, Postgres raises error **`23505` (unique_violation)**. The service turns that into **409** with the duplicate number, and the transaction rolls back, so nothing is saved.
6. `201` → TanStack Query refreshes the document page.

---

## 6. Architecture

- **Monorepo** with npm workspaces: `client/`, `server/`, `shared/`.
- **One Node process in production:** Express serves `/api/*` and the built React app (`client/dist`), with a fallback to `index.html` for client routes. Because it's the same origin, the cookie just works and there's no CORS.
- **PostgreSQL:** version 16 or newer.
  - **Development:** Docker Compose (`postgres:17`) or a native install. Databases: `traces_dev` and `traces_test`.
  - **Production:** the same server or a managed Postgres.
- **PDF storage:** the server's disk at `STORAGE_DIR/pdfs/<uuid>.pdf`, outside any static folder, streamed through routes that check access.
- **Development ports:** Express on 3000 (`0.0.0.0`), Vite on 5173 (`--host`) with `/api` proxied to 3000. Postgres stays on `localhost` only; it's never exposed to the LAN.

---

## 7. Data model

**The authoritative DDL is `docs/plans/traces-schema.sql`.** This is a summary:

```
users ─┐                      officers ◄──────────────┬───────────────┐
       │ created_by                ▲ issued_by/received_by          │ officer_id
       ▼                           │                                │
   documents (type, doc_no UNIQUE) ─┘                       physical_counts ─┬─ count_signatories
       │ 1                                                        │ 1        │
       ▼ n                                                        ▼ n        │
     lines ── 0..1 ── line_pdf_regions                        count_items ───┘
       │ 1                                                        │ n
       ▼ n                                                        │
   properties (property_no UNIQUE, ci) ◄──────────────────────────┘
       │ 1                       │ 1
       ▼ n                       ▼ n
   qr_tokens                 movements (RECEIPT|ISSUE|RETURN|REISSUE|DISPOSE)  ← THE LEDGER
   (≤1 active)

settings (single row) · session (connect-pg-simple) · audit_logs
```

| Table | Key columns / constraints |
|---|---|
| `users` | uuid PK · `lower(email)` UNIQUE · `password_hash` (argon2id) · `role` enum · `active` · `must_change_password` |
| `session` | connect-pg-simple's shape (`sid`, `sess` json, `expire`) |
| `settings` | single row (`CHECK id = 1`) · `entity_name`, `default_fund_cluster`, `ppe_threshold_centavos` (5000000), `card_row_mode`, `public_base_url`, `ppe_registry_title` |
| `officers` | `full_name`, `short_name` (UNIQUE, case-insensitive), `position`, `office`, `active` |
| `documents` | `(type, doc_no)` UNIQUE · issued/received officer FKs **+ positions as printed** · `purpose` · PDF columns (all set or all null, enforced by CHECK) · `deleted_at` |
| `lines` | FK document · `(document_id, line_no)` UNIQUE · `qty > 0` · `unit_cost_centavos ≥ 0` · `article`, `description` · `est_useful_life_years` (ICS) / `date_acquired` (PAR) · `iar_no`, `iar_date` · `category` (frozen) · `deleted_at` |
| `line_pdf_regions` | PK = `line_id` · `page`, and `x, y, w, h` as fractions 0–1 of the page (CHECKed to stay inside the page) |
| `properties` | `upper(property_no)` UNIQUE · CHECK `^[A-Za-z0-9-]+$` · FK line · `serial_no` · `old_property_no` (legacy "Old P#", optional) · `component_label` (NULL = the main unit) · `condition` · `voided_at` |
| `qr_tokens` | PK `token char(10)` base62 · FK property · `revoked_at` · **partial UNIQUE: one active token per property** |
| `movements` | identity PK · FK property · `type` · `qty > 0` · `date` · `officer_id` (CHECK: required for ISSUE/REISSUE/RETURN) · `reference_document_id` / `reference_text` · `remarks` |
| `physical_counts` | `category`, `type_label`, `as_at`, `fund_cluster`, officer FK + `officer_position` (as printed), `assumption_date`, `status` · UNIQUE `(category, officer_id, as_at)` |
| `count_signatories` | PK `(count_id, role, sort_order)` · `name`, `position` |
| `count_items` | PK `(count_id, property_id)` · `qty_on_hand` (NULL = not counted yet) · `remarks` |
| `audit_logs` | `actor_id`, `action`, `entity`, `entity_id`, `before`/`after` jsonb, `ip` inet, `at` |

**Types:**
- **Money:** `bigint` centavos (₱96,450.00 is `9645000`). In Drizzle use `bigint({ mode: 'number' })`, which is safe up to about ₱90 trillion.
- **Dates:** Postgres `date`. In Drizzle use `date({ mode: 'string' })`, so values come back as `"YYYY-MM-DD"` with no timezone shift.
- **Timestamps:** `timestamptz`.

### Views (the "sheets")

| View | One row per | What it gives you |
|---|---|---|
| `v_active_properties` | non-voided property with a live line and document | property + line + document fields joined |
| `v_card_movements` | movement | officer, reference doc no., **running `balance_qty`** (window function) and unit cost; amount = balance × unit cost |
| `v_custody` | property | latest holder (`ISSUE`/`REISSUE` → officer, `RETURN` → nobody) |
| `v_holdings` | property currently held by an officer with balance > 0 | feeds the physical-count auto-fill |
| `v_registry` | line | property numbers (sorted, joined with line breaks), issued/returned/reissued/disposed quantities **counting main units only**, balance, amount, remarks = purpose |
| `v_count_rows` | count item | balance per card **as of the count's `as_at` date**, on hand, shortage/overage qty and value (NULL until counted) |

These were checked against the SARAi sample (a laptop set: `2026-09ICT-0199` + `0199a` mouse + `0199b` headset, ₱96,450):
- Registry: issued 1, amount ₱96,450, property numbers on three lines.
- Card for 0199b: RECEIPT and ISSUE give balance 1; a later DISPOSE gives 0.
- Count: on hand 0 against card balance 1 gives −1 / −₱96,450.
- Every constraint rejected bad rows: a duplicate property number regardless of letter case, a second active token, an ISSUE without an officer, partial PDF columns, and a property number with invalid characters.

---

## 8. Business rules

- **BR-01 Category.** `unit_cost_centavos >= settings.ppe_threshold_centavos ? 'ppe' : 'semi'`. It's calculated when the line is created and then never changes. The form shows a badge before saving. If the category doesn't match the document type (an ICS line costing ₱50k or more, or a PAR line below it), show a **warning, not a block**.
- **BR-02 Properties.** A line has 1 or more properties. Each property is one physical unit with qty 1.
  - **Main unit vs component:** a property with `component_label = NULL` is a main unit. Labeled ones (mouse, headset) are parts of a set. Only main units count toward registry quantities.
  - **Default:** the first property is the main unit; "Add component" asks for a label. A line with `qty = N` and no components should have N main units; the form warns when the count doesn't match.
  - **Uniqueness:** property numbers are unique regardless of letter case (DB index). On a collision the API returns **409** naming the duplicate.
- **BR-03 Document number** is unique per type (ICS and PAR may reuse the same number).
- **BR-04 Saving a line is atomic.** One transaction inserts:
  - the line, its PDF region and all its properties
  - one active QR token per property
  - per property, a `RECEIPT` movement: date = `iar_date ?? date_acquired ?? issued_date`, reference = `iar_no` as text, or the document
  - per property, an `ISSUE` movement: date = `issued_date`, officer = `received_by_officer_id`, reference = the document
  - one audit row
- **BR-05 Editing a line.**
  - Text, cost and PDF-box changes are allowed.
  - Adding a property creates its token and both movements.
  - Removing a property sets `voided_at` and revokes its token. Nothing is hard-deleted.
  - `category` never changes; a cost edit that crosses the threshold returns a `warning`.
  - `line_no` re-ordering is allowed inside a transaction.
- **BR-06 Soft delete.** Deleting sets `deleted_at` / `voided_at`. The views already ignore those rows, and their QR codes return 410.
- **BR-07 Card display.** `card_row_mode = 'merged'` (default): a RECEIPT and an ISSUE for the same property on the same date show as one card row. `'split'`: one row per movement. Done in TypeScript on top of `v_card_movements`.
- **BR-08 Card balance** = Σ RECEIPT − Σ DISPOSE, running total by `(date, id)`. ISSUE, RETURN and REISSUE change who holds the item, not the balance. Amount = balance × unit cost.
- **BR-09 Registry.** One row per line (`v_registry`), filtered by category. Balance = issued + reissued − returned − disposed, counting main units only.
- **BR-10 Physical count.**
  - Creating a count inserts the session plus one `count_items` row per row in `v_holdings` where `holder_officer_id` = the officer and `category` = the count's category.
  - `POST /counts/:id/refresh` inserts any new holdings with `ON CONFLICT DO NOTHING`.
  - Balance per card is as of `as_at`.
  - A closed count can't be edited.
  - Only one count per `(category, officer, as_at)`.
- **BR-11 QR tokens** are 10 characters from [0-9A-Za-z] using `crypto.randomInt`. If a token collides (PK conflict), retry up to 3 times. Rotating sets `revoked_at` on the old token and inserts a new one in the same transaction; the partial unique index guarantees only one stays active.
- **BR-12 What the public view shows:** the fields printed on the forms (article, description, property no., serial no., unit, cost, dates, officer full name and position as printed, doc no.). It never shows UUIDs, user info or the audit log. **[PENDING]** If the stakeholder wants fields hidden, add `settings.public_hide_fields text[]`.
- **BR-13 Audit.** Every write appends an `audit_logs` row inside the same transaction, including actor, action, before/after and IP.

---

## 9. The four tabs and their highlight target

`GET /api/public/q/:token` and `GET /api/properties/:no/view` return the same shape:

```ts
type PropertyView = {
  property: { propertyNo; serialNo; componentLabel; condition; category };
  line: { article; description; qty; unit; unitCostCentavos; totalCostCentavos; estUsefulLifeYears; dateAcquired };
  document: { type; docNo; fundCluster; issuedDate;
              issuedBy: { name; position }; receivedBy: { name; position };
              pdfUrl: string; pdfRegion: { page; x; y; w; h } | null };
  tabs: {
    icsPar:   { rows: IcsParRow[];  highlightRowId: string };
    report:   { header: RpcHeader; rows: RpcRow[]; highlightRowId: string } | { empty: 'NOT_COUNTED' };
    registry: { header: RegistryHeader; rows: RegistryRow[]; highlightRowId: string };
    card:     { header: CardHeader; rows: CardRow[]; highlightRowId: string };
  };
};
```
- **ICS/PAR tab:** the PDF via react-pdf at `pdfRegion.page`, with a translucent yellow box over the region. Below it, a grid of that document's lines with the current line highlighted.
- **Report tab:** the most recent count containing this property (`count_items` ⋈ `physical_counts`, newest `as_at` first).
- **Registry tab:** public sees only the same document's rows; the admin page shows the full registry, scrolled to the row.
- **Card tab:** this property's card, with the row of its most recent movement highlighted.
- **Row IDs:** card = movement ID (merged rows use the ISSUE movement's ID), registry = line ID, report = property number. In public responses these are opaque short IDs; UUIDs are never exposed.

---

## 10. API specification (Express, prefix `/api`)

Conventions:
- JSON bodies, validated with zod from `shared/`.
- Errors look like `{ error: { code, message, details? } }`.
- Status codes: `400` validation, `401` no session, `403` wrong role, `404`, `409` duplicate/conflict, `410` revoked/removed, `413` file too big, `429` rate limit.
- Postgres error mapping: `23505` → 409, `23503` → 400 (referenced row doesn't exist), `23514` → 400 (CHECK failed).

**CSRF protection:** the cookie is `SameSite=Lax`, and every non-GET request must carry `Content-Type: application/json` or `multipart/form-data` plus a matching `Origin` header (checked against `APP_ORIGIN`).

### Auth
| Method | Path | Notes |
|---|---|---|
| POST | `/api/auth/login` | `{ email, password }` → sets the cookie, returns `{ user }`. Rate limit: 10/15 min per IP + email |
| POST | `/api/auth/logout` | destroys the session |
| GET | `/api/me` | `{ id, email, displayName, role, mustChangePassword }` or 401 |
| POST | `/api/me/password` | `{ currentPassword, newPassword }` (min 10 chars) |

### Public (no auth, 60 req/min/IP, `X-Robots-Tag: noindex`)
| Method | Path | Returns |
|---|---|---|
| GET | `/api/public/q/:token` | `PropertyView` (public field set) |
| GET | `/api/public/q/:token/pdf` | `application/pdf` stream |
| GET | `/api/health` | `{ ok: true, db: true }` |

### Supply admin (`requireRole('supply_admin','superadmin')`)
| Method | Path | Notes |
|---|---|---|
| GET | `/api/settings` | read-only settings for the forms |
| GET/POST | `/api/officers` | list (`?active=`) / create |
| PATCH/DELETE | `/api/officers/:id` | delete = `active=false` |
| GET | `/api/documents` | `?type=&from=&to=&officerId=&q=&page=` |
| POST | `/api/documents` | multipart: `pdf` (≤20 MB, starts with `%PDF-`) + `meta` (JSON) → 201 |
| GET | `/api/documents/:id` | document + lines + regions + properties |
| PATCH | `/api/documents/:id` | header fields; optional `pdf` replacement |
| DELETE | `/api/documents/:id` | soft |
| GET | `/api/documents/:id/pdf` | stream |
| POST | `/api/documents/:id/lines` | `{ line, region?, properties[] }` → BR-04 → 201 `{ lineId, category, warning? }` |
| PATCH/DELETE | `/api/lines/:id` | BR-05 / BR-06 |
| GET | `/api/properties/:no` | property + active token |
| GET | `/api/properties/:no/view` | `PropertyView` (admin) |
| PATCH | `/api/properties/:no` | `serialNo, componentLabel, condition` |
| POST | `/api/properties/:no/qr/rotate` | BR-11 → `{ token }` |
| GET | `/api/views/registry` | `?category=semi\|ppe&from=&to=` |
| GET | `/api/views/card/:no` | card rows (BR-07 applied) |
| GET/POST | `/api/counts` | list / create (auto-fill, BR-10) |
| GET/PATCH | `/api/counts/:id` | header, signatories, `status` |
| POST | `/api/counts/:id/refresh` | add new holdings |
| PATCH | `/api/counts/:id/items/:no` | `{ qtyOnHand, remarks }` |
| GET | `/api/stickers` | `?documentId=` or `?nos=` → `[{ propertyNo, url }]` |
| GET | `/api/exports/:form` | `ics,par,spc,pc,regspi,regppe,rpcsp,rpcppe` + params → `.xlsx` |

### Superadmin (`requireRole('superadmin')`)
| Method | Path | Notes |
|---|---|---|
| GET/POST | `/api/admin/users` | create with a temporary password (`must_change_password = true`) |
| PATCH | `/api/admin/users/:id` | `role`, `active` (false → delete their sessions), `resetPassword` |
| GET | `/api/admin/audit-logs` | `?entity=&actorId=&from=&to=&before=<id>` (keyset pagination) |
| GET/PATCH | `/api/admin/settings` | the settings row |

---

## 11. Frontend pages (React Router)

| Path | Access | Purpose |
|---|---|---|
| `/q/:token` | Public | Four-tab property view; works on mobile, read-only |
| `/login` | Public | Email/password; sends you to change your password first if `mustChangePassword` |
| `/` | Admin | Dashboard: counts by category, recent documents, "New ICS/PAR" |
| `/documents`, `/documents/new`, `/documents/:id` | Admin | List / header + PDF upload / PDF beside the lines grid, with "Add line" and "Print stickers" |
| `/documents/:id/lines/new`, `/lines/:lineId/edit` | Admin | Line form + **draw-box on the PDF** + property/component editor |
| `/properties/:no` | Admin | Four tabs + edit + rotate QR |
| `/registry`, `/cards/:no` | Admin | Full grids + export |
| `/counts`, `/counts/:id` | Admin | Count list; count grid with editable "On hand per count" |
| `/officers`, `/stickers` | Admin | Officer list; print sheet (`?documentId=` or `?nos=`) |
| `/account/password` | Admin | Change password |
| `/admin/users`, `/admin/settings`, `/admin/audit` | Superadmin | Management pages |

**`<FormGrid>`** (AG Grid Community wrapper):
- Column groups follow §4 exactly; the header stays fixed while scrolling
- Sort and filter on every column
- `highlightRowId` → `ensureNodeVisible` and a yellow row class
- Money cells are right-aligned and formatted

**PDF box drawing:**
- The admin drags a rectangle on the react-pdf page.
- It's saved as fractions of the page, so it lands in the same place at any zoom.
- It's drawn back as an absolutely positioned overlay on the page.

---

## 12. QR and sticker

- **QR content:** `${settings.public_base_url}/q/${token}`. The image is generated **in the browser at print time** with the `qrcode` package, error-correction level `M`, margin 2. The database never stores a QR image or a domain on the token.
- **1x1 sticker (default):** 25.4 × 25.4 mm cell. QR about 19 mm, with the property no. underneath in 6–7 pt bold monospace.
- **Passport sticker:** 35 × 45 mm cell, QR 28 mm, property no. 8 pt.
- **Inventory tag (selectable layout):** modelled on the COA inventory tag the office uses today (red border, "COA CIRCULAR NO. 80-124, JAN 18, 1980", "Republic of the Philippines / GOVERNMENT PROPERTY", Office/Location `DOST REGION 1`, Article, Property No., Serial No., Serviceable/Unserviceable, Unit/Quantity, Acquisition Cost, Date Acquired, Date Counted, COA Representative and Property Custodian names, "TAMPERING THIS STICKER IS PUNISHABLE BY LAW") with the QR code printed on it. The sheet offers 1x1 · passport · inventory tag.
- **Sheet:** A4 with `@page { size: A4; margin: 10mm }`. 1x1 layout is 6 × 9 (54 per sheet) with 3 mm gaps; passport is 4 × 5. Add a "Print at 100% scale" hint.
- **LAN warning:** when `public_base_url` is a private IP or `localhost`, the sticker page shows a banner: "Test stickers only — QR codes will break after deployment."

---

## 13. Security

- **Passwords:** argon2id via `@node-rs/argon2` (no native build step). Minimum 10 characters. Temporary passwords force a change on first login.
- **Sessions:**
  - `express-session` + `connect-pg-simple`
  - cookie `traces.sid`: `httpOnly`, `SameSite=Lax`, `secure` in production, 8-hour rolling expiry
  - call `regenerate()` on login (prevents session fixation)
  - set `app.set('trust proxy', 1)` behind nginx
- **CSRF:** the Origin check plus required content types (§10).
- **Login rate limit;** generic message on failure ("Invalid email or password").
- **Deactivating a user** deletes their sessions:
  ```sql
  DELETE FROM session WHERE sess->>'userId' = $1
  ```
- **SQL injection:** only Drizzle or parameterized queries. No string-built SQL.
- **Uploads:** multer to disk with a random file name. Check size ≤ 20 MB, the content type, and that the first bytes are `%PDF-`. The original file name is kept only as metadata.
- **PDFs** are never served as static files; the stream routes check the session or the token.
- **Public routes:** rate limit, `noindex`, field whitelist. Tokens can't be guessed (62¹⁰ ≈ 8×10¹⁷ possibilities).
- `helmet()` everywhere.
- **Database role:** the app uses a role with DML rights on the `traces` schema only (no superuser). Migrations run as the owner role.
- First superadmin: `npm run seed:superadmin -- --email x --password y`.

---

## 14. Non-functional requirements

- **Performance:** a QR view on mobile data loads in under 2 s (one API call; the PDF loads separately). Grids handle 5,000 rows smoothly.
- **Mobile:** works from a 360 px width. Tabs scroll sideways; the PDF fits the screen width with pinch-zoom.
- **Backups:** `npm run backup` runs `pg_dump -Fc` and zips `STORAGE_DIR` into `backups/<timestamp>/`.
- **Locale:** `en-PH`, ₱, dates written like `May 12, 2026` in the views and in the form's format in exports.

---

## 15. Environment and configuration

### Prerequisites
- Node 22+ (24 LTS recommended), npm 10+
- Docker (for Postgres), or PostgreSQL 16+ installed natively
- git

### `docker-compose.yml`
```yaml
services:
  db:
    image: postgres:17
    environment:
      POSTGRES_USER: traces
      POSTGRES_PASSWORD: traces
      POSTGRES_DB: traces_dev
    ports: ["127.0.0.1:5432:5432"]
    volumes: ["pgdata:/var/lib/postgresql/data", "./docker/init:/docker-entrypoint-initdb.d"]
volumes: { pgdata: {} }
```
`docker/init/01-test-db.sql`: `CREATE DATABASE traces_test OWNER traces;`

### `server/.env`
```
PORT=3000
NODE_ENV=development
DATABASE_URL=postgres://traces:traces@127.0.0.1:5432/traces_dev
TEST_DATABASE_URL=postgres://traces:traces@127.0.0.1:5432/traces_test
SESSION_SECRET=change-me-to-64-random-chars
APP_ORIGIN=http://localhost:5173        # comma-separated allowed origins; add http://<LAN-IP>:5173
STORAGE_DIR=./storage
PUBLIC_RATE_LIMIT_PER_MIN=60
```
The client needs no `.env`; it calls `/api` on the same origin, through the Vite proxy in development.

---

## 16. Repository structure

```
traces/
├─ CLAUDE.md · package.json (workspaces) · docker-compose.yml · docker/init/
├─ docs/plans/                  # spec, plan, traces-schema.sql
├─ shared/src/
│  ├─ schemas/                  # zod: auth, officer, document, line, property, count, settings, user
│  ├─ types/                    # PropertyView, grid row types
│  └─ utils/                    # money.ts, dates.ts, category.ts, propertyNo.ts
├─ server/
│  ├─ drizzle.config.ts
│  ├─ drizzle/                  # generated + custom SQL migrations (views live here)
│  └─ src/
│     ├─ index.ts · app.ts      # app factory (testable) + listen
│     ├─ db/                    # client.ts (pg Pool + drizzle), schema.ts, views.ts (typed view defs)
│     ├─ middleware/            # session.ts, auth.ts, role.ts, origin.ts, validate.ts, error.ts, rateLimit.ts, upload.ts
│     ├─ routes/                # auth, public, officers, documents, lines, properties, views, counts, stickers, exports, admin/*
│     ├─ services/              # business logic + queries
│     ├─ projections/           # card merge (BR-07), propertyView assembly — pure functions
│     ├─ exports/               # templates/*.xlsx + fill.ts + map.ts
│     ├─ scripts/               # seed-superadmin.ts, seed-dev.ts, backup.ts
│     └─ test/                  # vitest + supertest against traces_test
└─ client/src/
   ├─ main.tsx · router.tsx · api.ts
   ├─ auth/                     # AuthProvider (GET /api/me), RequireRole
   ├─ components/               # FormGrid, PdfViewer, PdfRegionPicker, PropertyTabs, Money, Sticker
   └─ pages/
```

**Root scripts:**
- `dev`: `docker compose up -d db` + server (`tsx watch`) + client (`vite --host`) via `concurrently`
- `db:generate`, `db:migrate`, `db:studio`: drizzle-kit
- `test`: migrate `traces_test`, then `vitest run`
- `build`, `start`
- `seed:superadmin`, `seed:dev`, `backup`

---

## 17. Open questions (defaults implemented now)

| # | Question | Default in code |
|---|---|---|
| Q1 | Card shows one row (Option A) or two rows (Option B) per issuance? | `card_row_mode = 'merged'` |
| Q2 | Physical count frequency (yearly / semester)? | Admin types `as_at` per count |
| Q3 | Hide any fields on the public view? | Show all form fields (BR-12) |
| Q4 | Title for the PPE registry | `ppe_registry_title` setting |
| Q5 | Production domain and host | `public_base_url` setting; one Node process + Postgres |

---

## 18. Acceptance criteria (definition of done)

1. A superadmin creates a supply_admin with a temporary password. That user must change it on first login. Each role sees only its own pages and API. A deactivated user is logged out immediately.
2. The admin uploads an ICS PDF, enters header details and adds a line with 1 main unit + 2 components and a drawn box. The save writes 1 line, 1 region, 3 properties, 3 tokens, 6 movements and 1 audit row. A duplicate property number (any letter case) returns 409 and writes nothing.
3. A ₱96,450 line is categorized `ppe` with a warning on an ICS. A ₱48,700 line is `semi`.
4. The registry shows the set as **issued 1**, amount ₱96,450, three property numbers, remarks = purpose.
5. Each card follows `card_row_mode` and has the right running balance and amount.
6. Creating a count for an officer auto-fills that officer's holdings. Entering on-hand quantities calculates shortage/overage. A closed count can't be edited.
7. Scanning a printed 1x1 sticker on a phone over the LAN opens `/q/:token` with four tabs, each highlighting the right row, and the PDF box over the right ICS row.
8. Rotating a QR makes the old sticker show "replaced". A deleted line's QR returns 410.
9. Each grid exports to `.xlsx` in the official layout.
10. Every server test passes against `traces_test`. A schema smoke test confirms that the migrations create every table, view, enum and named constraint/index in `traces-schema.sql`.

---

## 19. Reference findings (docs/references, studied 2026-11-13)

Sources: photos of a signed ICS (Appendix 59) and PAR (Appendix 71), a filled RPCPPE, the blank RPCSP and SPC forms, the COA inventory tag, the Stock Card, `2026 ICT.xlsx` (RegSPI + ICS + PTR sheets) and the official `.xls` templates for PC (69), PAR (71) and RPCPPE (73). Logos are in `docs/assets/`.

**Confirmed as specified:** column maps in §4 match the official forms. The RegSPI sheet lists issued-to by officer short name (e.g. `DPLibunao`) and uses the purpose as remarks, as `v_registry` does.

**Changes made from the references**
- **Old property number:** `properties.old_property_no` (nullable). The filled RPCPPE carries legacy numbers in Remarks (`Old P#: 10605140-00-7`); exports print it there automatically.
- **Multi-line descriptions:** ICS descriptions hold spec lists (`Laptop Unit / Specification: / - Processors: 8 Cores …`). The line form uses a textarea and the grids keep line breaks.
- **Signature labels per form:** ICS = *Received from* (supply unit, left) / *Received by* (end user, right). PAR = *Received by* (end user, left) / *Issued by* (supply and/or property custodian, right). The UI labels the issuing officer accordingly.
- **Form codes** printed on exports: ICS `FM-FAS-SUPPLY-07-10 Rev. 1/07-25-22`, PAR `FM-FAS-SUPPLY-07-09 Rev. 1/07-25-22`.
- **Sticker:** inventory-tag layout added (§12).
- **Branding:** TRACES logo (frame `#004AAD`, letters `#4C70FC`) as primary colour, favicon and header; DOST logo on the login page.
- **Export templates** are saved in `server/src/exports/templates/` (`ics`, `regspi`, `par`, `pc`, `rpcppe` as `.xlsx`, converted from the official files). SPC and RPCSP are still built from the form images in Task 20.

**Decided to keep as specified**
- **Category rule (BR-01) stays threshold-based.** Known difference: the office's own RegSPI lists the SARAi laptops (₱96,450) and LCD TV (₱98,200) issued on ICS 2026-03SARAi-005. Under BR-01 TRACES categorises them as PPE (PC card, Reg-PPE, RPCPPE) and shows the ICS mismatch warning.
- **RPCPPE columns follow the official Appendix 73** (no "Total Value" column, which appears only on the office's locally modified sheet).
- **Stock Card (consumables)** stays out of scope.

**Real-world samples useful for testing:** property numbers like `1998-05-140-TSE000-RSTL15`, `2026-03ICT-0193c`; separate ICS lines with letter suffixes (`0193`, `0193a`…) that are *not* components; PAR items acquired decades before the PAR date (Date Acquired drives the RECEIPT movement).

