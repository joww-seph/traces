# TRACES: deployment and operations

One Node process serves the API and the built React app from the same address, in front of PostgreSQL 16+.
Development uses Docker for PostgreSQL; production can use the same server or a managed PostgreSQL.

## 1. Development on a laptop, reachable from phones

```bash
docker compose up -d db
npm install
npm run db:migrate
npm run seed:superadmin -- --email you@example.gov.ph --password '<10+ characters>'
npm run seed:dev -- --reset          # optional sample officers, ICS and PAR (made-up names)
npm run lan                          # detect this laptop's address; sets public_base_url and APP_ORIGIN
npm run dev                          # API :3000 + client :5173 (both listen on all interfaces)
```

Open `http://<laptop-address>:5173` on a phone on the same Wi-Fi. If the laptop gets a new address
(different network, router restart) run `npm run lan` again and restart `npm run dev`.

- **Windows Firewall:** the Wi-Fi profile may be Public. An inbound allow rule for `node.exe` must exist
  (Windows offers one the first time Node listens: choose Allow). Phones cannot connect without it.
- **Ports:** the client uses `strictPort`. If 5173 is taken the client stops instead of moving to another port
  that `APP_ORIGIN` does not list. Stop the old process (`npm run dev` stops both servers on Ctrl+C).
- QR codes printed against a LAN address stop working when the address changes or after deployment. The sticker
  page warns about this; print real stickers only after `public_base_url` is the production address.

## 2. Tests

```bash
npm test          # shared + server unit and API tests (traces_test database)
npm run test:e2e  # browser tests: real API on :3100 + client on :5273 + traces_test; includes accessibility (axe) and 360 px checks
```

The browser tests use the installed Google Chrome and never touch `traces_dev`.

## 3. Production

### Database roles
Create two roles: an **owner** that runs migrations, and an **app** role with data rights only (no superuser):

```sql
CREATE ROLE traces_owner LOGIN PASSWORD '...';
CREATE DATABASE traces OWNER traces_owner;
CREATE ROLE traces_app LOGIN PASSWORD '...';
\c traces
GRANT USAGE ON SCHEMA public TO traces_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO traces_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO traces_app;
ALTER DEFAULT PRIVILEGES FOR ROLE traces_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO traces_app;
ALTER DEFAULT PRIVILEGES FOR ROLE traces_owner IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO traces_app;
```

Run `DATABASE_URL=<owner url> npm run db:migrate`, then run the API with the **app** role in `DATABASE_URL`.

### Build and run
```bash
npm ci
npm run build                 # type-checks, builds client/dist, bundles server/dist/index.js (shared inlined)
NODE_ENV=production npm start # one process on PORT; serves /api/* and the React app
```
Run it under pm2 or systemd, behind nginx with HTTPS. The API sets `trust proxy` to 1 in production.
Required environment (see `server/.env.example`): `DATABASE_URL`, `SESSION_SECRET` (64+ random characters,
different from development), `APP_ORIGIN` (the public https address, exactly as typed in the browser),
`STORAGE_DIR` (outside the repository and any web root).

- **HTTPS is required.** The session cookie is `Secure` in production. `COOKIE_SECURE=false` exists only for a LAN demo of a production build.
- **One API process.** The login rate limit is kept in memory; two processes would each count separately.
- Set `public_base_url` (Settings page, or `npm run lan` in development) to the real address **before** printing stickers.
- Create the first superadmin with `npm run seed:superadmin`; recover a lost password with `npm run reset:password -- --email <email> --generate`.

### Signed PDFs hold signatures and names
- They live in `STORAGE_DIR/pdfs` and are never served as static files; only the API streams them (staff by session,
  the public by QR token). Anyone with a QR token can open that document's PDF by design.
- Files are created owner-only (`0600`). Run the API as its own user and give nobody else access to `STORAGE_DIR`.
- A PDF replaced in the app is moved to `STORAGE_DIR/pdfs/replaced/`, not deleted. Keep that folder in backups.
- Backups contain personal data (Data Privacy Act): encrypt them and restrict who can read them.

### Backups
`npm run backup` (pg_dump + a zip of `STORAGE_DIR`, including `replaced/`) into `backups/<timestamp>/`.
Schedule it nightly with cron and copy the result off the server.

## 4. Public repository checklist
The GitHub repository is public. Never commit: `.env*`, `docs/ACCOUNTS.md`, `docs/references/` (photos with signatures),
`storage*`, `backups/`, or any real PDF. `.gitignore` covers these; `git status` before every push.
