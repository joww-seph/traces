# TRACES — Claude Code project guide

**TRACES** stands for **T**agged **R**ecords of **AC**countable **E**quipment and **S**upplies. It is the inventory and QR-sticker system for the Supply Unit of DOST Region 1, built on the **PERN** stack (PostgreSQL, Express, React, Node), in TypeScript.

## Source of truth
- Spec: `docs/plans/2026-11-13-traces-design.md` (BR-xx = business rules)
- Reference DDL and views: `docs/plans/traces-schema.sql` (tested; don't redesign it)
- Plan: `docs/plans/2026-11-13-traces-implementation.md` (execute with `superpowers:executing-plans`)
- If the code and the spec disagree, the spec wins. Raise the conflict instead of guessing.

## Commands
- `docker compose up -d db`: Postgres 17 (`traces_dev`, `traces_test`) on 127.0.0.1:5432
- `npm run dev`: db + API (:3000) + client (:5173), reachable over the LAN
- `npm run db:generate` / `db:migrate` / `db:studio`: drizzle-kit
- `npm test`: server tests against `traces_test`
- `npm run seed:superadmin -- --email … --password …` · `npm run seed:dev` · `npm run backup`
- `npm run build && npm start`: production (one Node process)

## Hard rules
- The database enforces integrity (FK, UNIQUE, CHECK, partial unique index). Never weaken a constraint to make a test pass.
- **Normalized (3NF).** Card, Registry and RPC are **SQL views** (`v_card_movements`, `v_registry`, `v_count_rows`). Never store their rows or any calculated column (totals, amounts, balances, shortages).
- Money is `bigint` centavos (`mode:'number'`). Date-only values are `date` (`mode:'string'`, "YYYY-MM-DD"). Never floats, never JS `Date` for these.
- Multi-row writes go in **one `db.transaction`**, and every write adds an `audit_logs` row inside it.
- Map Postgres errors centrally: `23505` → 409, `23503`/`23514` → 400.
- No string-built SQL. Use Drizzle or `sql\`` parameters only.
- Validate every request body with the zod schemas in `shared/`.
- Auth = server sessions (`connect-pg-simple`), argon2id passwords, and an Origin check on mutating requests. Read the role from the database on each request.
- Public routes return the public field set only (BR-12): no UUIDs, no user data.
- Tests use `TEST_DATABASE_URL` only. Use TDD for services and projections; commit after each task.

## Domain words
ICS (semi issuance slip) · PAR (PPE issuance receipt) · SPC/PC (property cards) · RegSPI (registry) · RPCSP/RPCPPE (physical count reports) · property no. (one physical unit; `component_label` set = part of a set, doesn't count toward quantities) · accountable officer (custodian of the issued item).
