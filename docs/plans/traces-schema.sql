-- TRACES reference schema (PostgreSQL 16+). Normalized to 3NF.
-- The Drizzle schema in server/src/db/schema.ts MUST produce this. Views go in a hand-written migration.

-- ───────────── Enums ─────────────
CREATE TYPE user_role      AS ENUM ('supply_admin', 'superadmin');
CREATE TYPE doc_type       AS ENUM ('ICS', 'PAR');
CREATE TYPE item_category  AS ENUM ('semi', 'ppe');
CREATE TYPE movement_type  AS ENUM ('RECEIPT', 'ISSUE', 'RETURN', 'REISSUE', 'DISPOSE');
CREATE TYPE item_condition AS ENUM ('serviceable', 'unserviceable');
CREATE TYPE count_status   AS ENUM ('open', 'closed');
CREATE TYPE card_row_mode  AS ENUM ('merged', 'split');
CREATE TYPE signatory_role AS ENUM ('committee', 'head_of_agency', 'coa_representative');

-- ───────────── Accounts ─────────────
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL,
  display_name  text NOT NULL,
  password_hash text NOT NULL,
  role          user_role NOT NULL,
  active        boolean NOT NULL DEFAULT true,
  must_change_password boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_lower_uq ON users (lower(email));

-- Session store (shape required by connect-pg-simple)
CREATE TABLE session (
  sid    varchar NOT NULL PRIMARY KEY,
  sess   json NOT NULL,
  expire timestamp(6) NOT NULL
);
CREATE INDEX session_expire_idx ON session (expire);

-- ───────────── Settings (single row) ─────────────
CREATE TABLE settings (
  id                      smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  entity_name             text NOT NULL,
  default_fund_cluster    text NOT NULL,
  ppe_threshold_centavos  bigint NOT NULL CHECK (ppe_threshold_centavos > 0),
  card_row_mode           card_row_mode NOT NULL DEFAULT 'merged',
  public_base_url         text NOT NULL,
  ppe_registry_title      text NOT NULL DEFAULT 'REGISTRY OF PROPERTY, PLANT AND EQUIPMENT ISSUED',
  ics_form_code           text NOT NULL DEFAULT 'FM-FAS-SUPPLY-07-10',   -- printed in the ICS/PAR export corner
  ics_form_revision       text NOT NULL DEFAULT 'Rev. 1/07-25-22',
  par_form_code           text NOT NULL DEFAULT 'FM-FAS-SUPPLY-07-09',
  par_form_revision       text NOT NULL DEFAULT 'Rev. 1/07-25-22',
  updated_at              timestamptz NOT NULL DEFAULT now(),
  updated_by              uuid REFERENCES users(id)
);

-- ───────────── People ─────────────
CREATE TABLE officers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name   text NOT NULL,
  short_name  text NOT NULL,
  position    text NOT NULL,
  office      text NOT NULL DEFAULT '',
  active      boolean NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX officers_short_name_uq ON officers (lower(short_name));

-- ───────────── ICS / PAR ─────────────
CREATE TABLE documents (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type                    doc_type NOT NULL,
  doc_no                  text NOT NULL,
  fund_cluster            text NOT NULL,
  issued_date             date NOT NULL,
  issued_by_officer_id    uuid NOT NULL REFERENCES officers(id),
  issued_by_position      text NOT NULL,   -- position AS PRINTED on the form (historical fact)
  received_by_officer_id  uuid NOT NULL REFERENCES officers(id),
  received_by_position    text NOT NULL,   -- position AS PRINTED on the form (historical fact)
  purpose                 text,
  pdf_stored_name         text,
  pdf_original_name       text,
  pdf_size_bytes          integer CHECK (pdf_size_bytes > 0),
  pdf_page_count          smallint CHECK (pdf_page_count > 0),
  created_by              uuid NOT NULL REFERENCES users(id),
  created_at              timestamptz NOT NULL DEFAULT now(),
  deleted_at              timestamptz,
  CONSTRAINT documents_type_doc_no_uq UNIQUE (type, doc_no),
  CONSTRAINT documents_pdf_all_or_none CHECK (
    (pdf_stored_name IS NULL) = (pdf_original_name IS NULL) AND
    (pdf_stored_name IS NULL) = (pdf_size_bytes IS NULL) AND
    (pdf_stored_name IS NULL) = (pdf_page_count IS NULL))
);
CREATE INDEX documents_issued_date_idx ON documents (issued_date DESC);
CREATE INDEX documents_received_by_idx ON documents (received_by_officer_id);

CREATE TABLE lines (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id           uuid NOT NULL REFERENCES documents(id),
  line_no               integer NOT NULL CHECK (line_no > 0),
  qty                   integer NOT NULL CHECK (qty > 0),
  unit                  text NOT NULL,
  unit_cost_centavos    bigint NOT NULL CHECK (unit_cost_centavos >= 0),
  article               text NOT NULL,
  description           text NOT NULL,
  est_useful_life_years smallint CHECK (est_useful_life_years > 0),
  date_acquired         date,
  iar_no                text,
  iar_date              date,
  category              item_category NOT NULL,  -- frozen at create (BR-01)
  deleted_at            timestamptz,
  CONSTRAINT lines_document_line_no_uq UNIQUE (document_id, line_no)
);
CREATE INDEX lines_category_idx ON lines (category) WHERE deleted_at IS NULL;

CREATE TABLE line_pdf_regions (
  line_id  uuid PRIMARY KEY REFERENCES lines(id) ON DELETE CASCADE,
  page     smallint NOT NULL CHECK (page > 0),
  x        numeric(6,5) NOT NULL CHECK (x >= 0 AND x <= 1),
  y        numeric(6,5) NOT NULL CHECK (y >= 0 AND y <= 1),
  w        numeric(6,5) NOT NULL CHECK (w > 0 AND x + w <= 1.00001),
  h        numeric(6,5) NOT NULL CHECK (h > 0 AND y + h <= 1.00001)
);

CREATE TABLE properties (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_no      text NOT NULL CHECK (property_no ~ '^[A-Za-z0-9-]+$'),
  line_id          uuid NOT NULL REFERENCES lines(id),
  serial_no        text,
  old_property_no  text,            -- legacy number from earlier inventories ("Old P#"), printed in RPC remarks
  component_label  text,
  condition        item_condition NOT NULL DEFAULT 'serviceable',
  voided_at        timestamptz
);
CREATE UNIQUE INDEX properties_property_no_uq ON properties (upper(property_no));
CREATE INDEX properties_line_idx ON properties (line_id);

CREATE TABLE qr_tokens (
  token        char(10) PRIMARY KEY CHECK (token ~ '^[0-9A-Za-z]{10}$'),
  property_id  uuid NOT NULL REFERENCES properties(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  revoked_at   timestamptz
);
-- at most one active token per property
CREATE UNIQUE INDEX qr_tokens_one_active_uq ON qr_tokens (property_id) WHERE revoked_at IS NULL;

-- ───────────── Ledger ─────────────
CREATE TABLE movements (
  id                     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  property_id            uuid NOT NULL REFERENCES properties(id),
  type                   movement_type NOT NULL,
  qty                    integer NOT NULL DEFAULT 1 CHECK (qty > 0),
  date                   date NOT NULL,
  officer_id             uuid REFERENCES officers(id),
  reference_document_id  uuid REFERENCES documents(id),
  reference_text         text,
  remarks                text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT movements_custody_needs_officer CHECK (
    type NOT IN ('ISSUE', 'REISSUE', 'RETURN') OR officer_id IS NOT NULL)
);
CREATE INDEX movements_property_date_idx ON movements (property_id, date, id);
CREATE INDEX movements_officer_idx ON movements (officer_id, type);

-- ───────────── Physical count (RPCSP / RPCPPE) ─────────────
CREATE TABLE physical_counts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category         item_category NOT NULL,
  type_label       text NOT NULL,
  as_at            date NOT NULL,
  fund_cluster     text NOT NULL,
  officer_id       uuid NOT NULL REFERENCES officers(id),
  officer_position text NOT NULL,   -- as printed on the report
  assumption_date  date,
  status           count_status NOT NULL DEFAULT 'open',
  created_by       uuid NOT NULL REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  closed_at        timestamptz,
  CONSTRAINT physical_counts_unique_session UNIQUE (category, officer_id, as_at)
);

CREATE TABLE count_signatories (
  count_id   uuid NOT NULL REFERENCES physical_counts(id) ON DELETE CASCADE,
  role       signatory_role NOT NULL,
  sort_order smallint NOT NULL DEFAULT 1,
  name       text NOT NULL,
  position   text,
  PRIMARY KEY (count_id, role, sort_order)
);

CREATE TABLE count_items (
  count_id     uuid NOT NULL REFERENCES physical_counts(id) ON DELETE CASCADE,
  property_id  uuid NOT NULL REFERENCES properties(id),
  qty_on_hand  integer CHECK (qty_on_hand >= 0),   -- NULL until counted
  remarks      text,
  PRIMARY KEY (count_id, property_id)
);
CREATE INDEX count_items_property_idx ON count_items (property_id);

-- ───────────── Audit ─────────────
CREATE TABLE audit_logs (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id   uuid REFERENCES users(id),
  action     text NOT NULL,          -- 'line.create', 'qr.rotate', 'user.deactivate'
  entity     text NOT NULL,
  entity_id  text NOT NULL,
  before     jsonb,
  after      jsonb,
  ip         inet,
  at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_entity_idx ON audit_logs (entity, entity_id);
CREATE INDEX audit_logs_at_idx ON audit_logs (at DESC);

-- ═════════════ Views (the Card / Registry / RPC "sheets") ═════════════

-- Active (not deleted / voided) properties with their line + document
CREATE VIEW v_active_properties AS
SELECT p.id AS property_id, p.property_no, p.serial_no, p.component_label, p.condition,
       l.id AS line_id, l.category, l.unit, l.unit_cost_centavos, l.article, l.description,
       d.id AS document_id, d.type AS doc_type, d.doc_no, d.fund_cluster, d.issued_date
FROM properties p
JOIN lines l     ON l.id = p.line_id AND l.deleted_at IS NULL
JOIN documents d ON d.id = l.document_id AND d.deleted_at IS NULL
WHERE p.voided_at IS NULL;

-- Card rows (one per movement) with running balance  [BR-08]
CREATE VIEW v_card_movements AS
SELECT m.id AS movement_id, m.property_id, m.type, m.qty, m.date,
       m.officer_id, o.full_name AS officer_name, o.short_name AS officer_short,
       m.reference_document_id, rd.type AS reference_doc_type, rd.doc_no AS reference_doc_no,
       m.reference_text, m.remarks,
       ap.unit_cost_centavos, ap.property_no, ap.category,
       SUM(CASE m.type WHEN 'RECEIPT' THEN m.qty WHEN 'DISPOSE' THEN -m.qty ELSE 0 END)
         OVER (PARTITION BY m.property_id ORDER BY m.date, m.id) AS balance_qty
FROM movements m
JOIN v_active_properties ap ON ap.property_id = m.property_id
LEFT JOIN officers o   ON o.id = m.officer_id
LEFT JOIN documents rd ON rd.id = m.reference_document_id;

-- Who holds each property now (latest custody movement)
CREATE VIEW v_custody AS
SELECT DISTINCT ON (m.property_id)
       m.property_id,
       CASE WHEN m.type = 'RETURN' THEN NULL ELSE m.officer_id END AS holder_officer_id,
       m.date AS since
FROM movements m
WHERE m.type IN ('ISSUE', 'REISSUE', 'RETURN')
ORDER BY m.property_id, m.date DESC, m.id DESC;

-- Current holdings: active property, held by an officer, card balance > 0  (feeds BR-10)
CREATE VIEW v_holdings AS
SELECT ap.*, c.holder_officer_id, c.since
FROM v_active_properties ap
JOIN v_custody c ON c.property_id = ap.property_id AND c.holder_officer_id IS NOT NULL
WHERE (SELECT COALESCE(SUM(CASE m.type WHEN 'RECEIPT' THEN m.qty WHEN 'DISPOSE' THEN -m.qty ELSE 0 END), 0)
       FROM movements m WHERE m.property_id = ap.property_id) > 0;

-- Registry rows (RegSPI / Reg-PPE): one per line  [BR-09]
CREATE VIEW v_registry AS
SELECT l.id AS line_id, l.category, d.issued_date AS date, d.type AS doc_type, d.doc_no,
       pn.property_nos,
       l.article, l.description, l.est_useful_life_years,
       rcv.short_name AS issued_to,
       mv.issued_qty, mv.returned_qty, mv.reissued_qty, mv.disposed_qty,
       mv.issued_qty + mv.reissued_qty - mv.returned_qty - mv.disposed_qty AS balance_qty,
       l.qty * l.unit_cost_centavos AS amount_centavos,
       d.purpose AS remarks,
       d.fund_cluster
FROM lines l
JOIN documents d  ON d.id = l.document_id AND d.deleted_at IS NULL
JOIN officers rcv ON rcv.id = d.received_by_officer_id
CROSS JOIN LATERAL (
  SELECT string_agg(p.property_no, E'\n' ORDER BY p.property_no) AS property_nos
  FROM properties p WHERE p.line_id = l.id AND p.voided_at IS NULL) pn
CROSS JOIN LATERAL (
  SELECT COUNT(*) FILTER (WHERE m.type = 'ISSUE')   AS issued_qty,
         COUNT(*) FILTER (WHERE m.type = 'RETURN')  AS returned_qty,
         COUNT(*) FILTER (WHERE m.type = 'REISSUE') AS reissued_qty,
         COUNT(*) FILTER (WHERE m.type = 'DISPOSE') AS disposed_qty
  FROM movements m
  JOIN properties p ON p.id = m.property_id AND p.voided_at IS NULL
                   AND p.component_label IS NULL          -- components of a set don't add to qty
  WHERE p.line_id = l.id) mv
WHERE l.deleted_at IS NULL;

-- RPC rows (RPCSP / RPCPPE)  [BR-10]
CREATE VIEW v_count_rows AS
SELECT ci.count_id, ci.property_id, ap.article, ap.description, ap.property_no, ap.unit,
       ap.unit_cost_centavos AS unit_value_centavos,
       bal.balance_per_card,
       ci.qty_on_hand,
       ci.qty_on_hand - bal.balance_per_card                          AS shortage_overage_qty,
       (ci.qty_on_hand - bal.balance_per_card) * ap.unit_cost_centavos AS shortage_overage_value_centavos,
       ci.remarks
FROM count_items ci
JOIN physical_counts pc     ON pc.id = ci.count_id
JOIN v_active_properties ap ON ap.property_id = ci.property_id
CROSS JOIN LATERAL (
  SELECT COALESCE(SUM(CASE m.type WHEN 'RECEIPT' THEN m.qty WHEN 'DISPOSE' THEN -m.qty ELSE 0 END), 0)::int
           AS balance_per_card
  FROM movements m
  WHERE m.property_id = ci.property_id AND m.date <= pc.as_at) bal;
