# TRACES — Claude Code project guide

**TRACES** stands for **T**agged **R**ecords of **AC**countable **E**quipment and **S**upplies. It is the inventory and QR-sticker system for the Supply Unit of DOST Region 1, built on the **PERN** stack (PostgreSQL, Express, React, Node), in TypeScript.

## Source of truth
- Spec: `docs/plans/2026-11-13-traces-design.md` (BR-xx = business rules)
- Reference DDL and views: `docs/plans/traces-schema.sql` (tested; don't redesign it)
- Plan: `docs/plans/2026-11-13-traces-implementation.md` (execute with `superpowers:executing-plans`)
- Updates: `docs/plans/2026-11-14-update-01-*.md` and `...-update-02-*.md` (+ `traces-update-01.sql`, `traces-update-02.sql`, `update-NOTES.md`). **Update 02 > Update 01 > v1**; an update wins on conflict.
- If the code and the spec disagree, the spec wins. Raise the conflict instead of guessing.

## Commands
- `docker compose up -d db`: Postgres 17 (`traces_dev`, `traces_test`) on 127.0.0.1:5432
- `npm run dev`: db + API (:3000) + client (:5173), reachable over the LAN
- `npm run db:generate` / `db:migrate` / `db:studio`: drizzle-kit
- `npm test`: shared + server tests against `traces_test` · `npm run test:e2e`: browser tests (Chrome, :3100/:5273, axe accessibility)
- `npm run lan`: set the LAN address (public_base_url + APP_ORIGIN) so phones can open the dev app · `npm run reset:password -- --email … --generate`
- `npm run seed:superadmin -- --email … --password …` · `npm run seed:dev -- --reset` (`--more` for a larger set) · `npm run seed:officers -- <csv>` · `npm run backup`
- `npm run build && npm start`: production (one Node process)

## Hard rules
- The database enforces integrity (FK, UNIQUE, CHECK, partial unique index). Never weaken a constraint to make a test pass.
- **Normalized (3NF).** Card = `v_item_card` (one card per **item/model**), Registry = `v_registry` (per category + property type), RPCSP/RPCPPE = `fn_officer_report(as_at)`. Never store their rows or any calculated column (totals, amounts, balances, shortages). There are no count tables; count columns are printed blank.
- A **line** belongs to one **item** (card) and takes its category from that card (not stored on the line). Quantities count **main units only**; components (`component_label` set) share their line's row everywhere but get their own QR.
- Property numbers are **suggested** (`YYYY-MM{TYPE}-NNNN`, counter per year + type), never forced; the unique index is the guard.
- A document has up to two PDFs (`document_files`: `generated` by TRACES, `uploaded` signed copy). An uploaded copy locks the entries (409 `DOCUMENT_SIGNED`).
- Money is `bigint` centavos (`mode:'number'`). Date-only values are `date` (`mode:'string'`, "YYYY-MM-DD"). Never floats, never JS `Date` for these.
- Multi-row writes go in **one `db.transaction`**, and every write adds an `audit_logs` row inside it.
- Map Postgres errors centrally: `23505` → 409, `23503`/`23514` → 400.
- No string-built SQL. Use Drizzle or `sql\`` parameters only.
- Validate every request body with the zod schemas in `shared/`.
- Auth = server sessions (`connect-pg-simple`), argon2id passwords, and an Origin check on mutating requests. Read the role from the database on each request.
- Public routes return the public field set only (BR-12): no UUIDs, no user data.
- Tests use `TEST_DATABASE_URL` only. Use TDD for services and projections; commit after each task.

## Public repository
The GitHub repo is **public**. Never commit secrets, real PDFs, signatures or personal data; `docs/ACCOUNTS.md`, `docs/references/`, `.env*`, `storage*` stay ignored. Use made-up names in code, tests and samples. See `docs/DEPLOY.md`.

## Domain words
ICS (semi issuance slip) · PAR (PPE issuance receipt) · SPC/PC (property cards, one per model) · RegSPI (registry) · RPCSP/RPCPPE (physical count reports, printed blank for hand count) · property no. (one physical unit; `component_label` set = part of a set, doesn't count toward quantities) · accountable officer (custodian of the issued item).
