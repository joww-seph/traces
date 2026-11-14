-- TRACES Update 01 — reference migration (PostgreSQL 16+)
-- Applies on top of docs/plans/traces-schema.sql (v1). Tested against v1 + sample ICS data.
-- Claude Code: the live Drizzle schema may differ slightly from v1 (e.g. old_property_no).
-- Port these changes into schema.ts + migrations; keep any extra columns the live schema has.
-- U-refs point to docs/plans/update-01/2026-11-14-update-01-design.md.

BEGIN;

-- ── 0. Views depend on columns we change; drop them first, recreate at the end ──
DROP VIEW IF EXISTS v_count_rows;
DROP VIEW IF EXISTS v_registry;
DROP VIEW IF EXISTS v_holdings;
DROP VIEW IF EXISTS v_card_movements;
DROP VIEW IF EXISTS v_active_properties;

-- ── 1. Property types (U-03) ──
CREATE TABLE property_types (
  id     smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code   text NOT NULL CHECK (code ~ '^[A-Z]{2,8}$'),   -- used inside property numbers, e.g. ICT
  name   text NOT NULL,
  active boolean NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX property_types_code_uq ON property_types (code);
CREATE UNIQUE INDEX property_types_name_uq ON property_types (lower(name));
INSERT INTO property_types (code, name) VALUES
  ('ICT', 'Information and Communications Technology Equipment'),
  ('FF',  'Furniture and Fixtures'),      -- [PENDING] code: confirm from his COA category list
  ('OE',  'Office Equipment');            -- [PENDING] code: confirm from his COA category list

-- ── 2. Items = one card per model (U-01) ──
CREATE TABLE items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_type_id  smallint NOT NULL REFERENCES property_types(id),
  category          item_category NOT NULL,          -- semi → SPC, ppe → PC
  article           text NOT NULL,                   -- general term: "Laptop"
  description       text NOT NULL,                   -- the model: "Lenovo ThinkPad E14 Gen 5"
  unit              text NOT NULL,                   -- "unit", "set"
  active            boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT items_id_category_uq UNIQUE (id, category)   -- target of the composite FK below
);
CREATE UNIQUE INDEX items_identity_uq
  ON items (category, property_type_id, lower(article), lower(description));
CREATE INDEX items_type_idx ON items (property_type_id, category) WHERE active;

-- ── 3. Lines point to an item; article/unit move to the item (3NF) ──
ALTER TABLE lines ADD COLUMN item_id uuid;

-- Backfill (dev/test data only): one item per existing line, typed ICT.
INSERT INTO items (id, property_type_id, category, article, description, unit)
SELECT gen_random_uuid(), (SELECT id FROM property_types WHERE code = 'ICT'), l.category,
       l.article, l.article || ' (migrated ' || left(l.id::text, 8) || ')', l.unit
FROM lines l;
UPDATE lines l SET item_id = i.id
FROM items i
WHERE i.description = l.article || ' (migrated ' || left(l.id::text, 8) || ')';

ALTER TABLE lines ALTER COLUMN item_id SET NOT NULL;
-- composite FK: a line's frozen category must equal its item's category (BR-01 stays enforceable)
ALTER TABLE lines ADD CONSTRAINT lines_item_category_fk
  FOREIGN KEY (item_id, category) REFERENCES items (id, category);
CREATE INDEX lines_item_idx ON lines (item_id);
ALTER TABLE lines DROP COLUMN article;
ALTER TABLE lines DROP COLUMN unit;
-- lines.description stays: it is the text AS PRINTED on the ICS/PAR row (specs, serials).

-- ── 4. Officers: who may receive + designations from his list (U-06) ──
ALTER TABLE officers ADD COLUMN can_receive boolean NOT NULL DEFAULT false;
CREATE TABLE officer_designations (
  officer_id  uuid NOT NULL REFERENCES officers(id) ON DELETE CASCADE,
  sort_order  smallint NOT NULL,
  designation text NOT NULL,                       -- "SARAi CENTRO, Focal Person"
  PRIMARY KEY (officer_id, sort_order)
);

-- ── 5. Physical count sessions removed (U-04): report becomes a view ──
DROP TABLE IF EXISTS count_items;
DROP TABLE IF EXISTS count_signatories;
DROP TABLE IF EXISTS physical_counts;
DROP TYPE IF EXISTS count_status;

-- default signatories printed on RPCSP/RPCPPE footers (editable before printing)
CREATE TABLE report_signatories (
  role        signatory_role NOT NULL,
  sort_order  smallint NOT NULL DEFAULT 1,
  name        text NOT NULL,
  position    text,
  PRIMARY KEY (role, sort_order)
);

-- ── 6. Recreate views ──

CREATE VIEW v_active_properties AS
SELECT p.id AS property_id, p.property_no, p.serial_no, p.component_label, p.condition,
       l.id AS line_id, l.category, l.unit_cost_centavos, l.description AS line_description,
       i.id AS item_id, i.article, i.description AS item_description, i.unit,
       pt.id AS property_type_id, pt.code AS property_type_code, pt.name AS property_type_name,
       d.id AS document_id, d.type AS doc_type, d.doc_no, d.fund_cluster, d.issued_date
FROM properties p
JOIN lines l           ON l.id = p.line_id AND l.deleted_at IS NULL
JOIN items i           ON i.id = l.item_id
JOIN property_types pt ON pt.id = i.property_type_id
JOIN documents d       ON d.id = l.document_id AND d.deleted_at IS NULL
WHERE p.voided_at IS NULL;

-- Card (SPC / PC): ONE CARD PER ITEM (model). One row per event per line (a set = one row). [U-01, U-02]
-- Balance = stock held by the Supply Unit: + RECEIPT + RETURN − ISSUE − REISSUE − DISPOSE.
CREATE VIEW v_item_card AS
WITH ev AS (
  SELECT l.item_id, l.id AS line_id, m.type, m.date, m.officer_id,
         m.reference_document_id, m.reference_text, m.remarks,
         l.unit_cost_centavos,
         COUNT(*) FILTER (WHERE p.component_label IS NULL)::int AS qty,     -- main units only
         string_agg(p.property_no, E'\n' ORDER BY p.property_no) AS item_nos, -- incl. components
         MIN(m.id) AS first_movement_id
  FROM movements m
  JOIN properties p ON p.id = m.property_id AND p.voided_at IS NULL
  JOIN lines l      ON l.id = p.line_id AND l.deleted_at IS NULL
  JOIN documents d  ON d.id = l.document_id AND d.deleted_at IS NULL
  GROUP BY l.item_id, l.id, m.type, m.date, m.officer_id, m.reference_document_id,
           m.reference_text, m.remarks, l.unit_cost_centavos
)
SELECT ev.*,
       o.full_name AS officer_name, o.short_name AS officer_short,
       rd.type AS reference_doc_type, rd.doc_no AS reference_doc_no,
       SUM(CASE WHEN ev.type IN ('RECEIPT','RETURN') THEN ev.qty ELSE -ev.qty END)
         OVER w AS balance_qty,
       SUM(CASE WHEN ev.type IN ('RECEIPT','RETURN') THEN ev.qty ELSE -ev.qty END * ev.unit_cost_centavos)
         OVER w AS balance_amount_centavos
FROM ev
LEFT JOIN officers o   ON o.id = ev.officer_id
LEFT JOIN documents rd ON rd.id = ev.reference_document_id
WINDOW w AS (PARTITION BY ev.item_id ORDER BY ev.date, ev.first_movement_id);

-- Who holds each property now (unchanged logic)
-- (v_custody from v1 is kept; it does not depend on changed columns)

-- Registry (RegSPI / Reg-PPE): one row per line, filterable by category AND property type [U-03]
CREATE VIEW v_registry AS
SELECT l.id AS line_id, l.category, i.property_type_id, pt.code AS property_type_code,
       i.id AS item_id, d.issued_date AS date, d.type AS doc_type, d.doc_no,
       pn.property_nos, i.article, l.description, l.est_useful_life_years,
       rcv.short_name AS issued_to,
       mv.issued_qty, mv.returned_qty, mv.reissued_qty, mv.disposed_qty,
       mv.issued_qty + mv.reissued_qty - mv.returned_qty - mv.disposed_qty AS balance_qty,
       l.qty * l.unit_cost_centavos AS amount_centavos,
       d.purpose AS remarks, d.fund_cluster
FROM lines l
JOIN items i           ON i.id = l.item_id
JOIN property_types pt ON pt.id = i.property_type_id
JOIN documents d       ON d.id = l.document_id AND d.deleted_at IS NULL
JOIN officers rcv      ON rcv.id = d.received_by_officer_id
CROSS JOIN LATERAL (
  SELECT string_agg(p.property_no, E'\n' ORDER BY p.property_no) AS property_nos
  FROM properties p WHERE p.line_id = l.id AND p.voided_at IS NULL) pn
CROSS JOIN LATERAL (
  SELECT COUNT(*) FILTER (WHERE m.type = 'ISSUE')   AS issued_qty,
         COUNT(*) FILTER (WHERE m.type = 'RETURN')  AS returned_qty,
         COUNT(*) FILTER (WHERE m.type = 'REISSUE') AS reissued_qty,
         COUNT(*) FILTER (WHERE m.type = 'DISPOSE') AS disposed_qty
  FROM movements m
  JOIN properties p ON p.id = m.property_id AND p.voided_at IS NULL AND p.component_label IS NULL
  WHERE p.line_id = l.id) mv
WHERE l.deleted_at IS NULL;

-- RPCSP / RPCPPE rows as at a date: one row per (accountable officer, line) [U-04]
-- "Balance per Card" = main units of that line held by the officer on p_as_at.
-- On Hand per Count / Shortage / Overage are NOT stored: printed blank, filled by hand.
CREATE FUNCTION fn_officer_report(p_as_at date)
RETURNS TABLE (
  officer_id uuid, line_id uuid, item_id uuid, category item_category,
  property_type_id smallint, article text, description text, property_nos text,
  unit text, unit_value_centavos bigint, balance_per_card int,
  doc_type doc_type, doc_no text, issued_date date
) LANGUAGE sql STABLE AS $$
  WITH custody AS (
    SELECT DISTINCT ON (m.property_id) m.property_id,
           CASE WHEN m.type = 'RETURN' THEN NULL ELSE m.officer_id END AS holder
    FROM movements m
    WHERE m.type IN ('ISSUE','REISSUE','RETURN') AND m.date <= p_as_at
    ORDER BY m.property_id, m.date DESC, m.id DESC
  ), disposed AS (
    SELECT DISTINCT property_id FROM movements WHERE type = 'DISPOSE' AND date <= p_as_at
  )
  SELECT c.holder, ap.line_id, ap.item_id, ap.category, ap.property_type_id, ap.article,
         ap.line_description,
         string_agg(ap.property_no, E'\n' ORDER BY ap.property_no),
         ap.unit, ap.unit_cost_centavos,
         (COUNT(*) FILTER (WHERE ap.component_label IS NULL))::int,
         ap.doc_type, ap.doc_no, ap.issued_date
  FROM v_active_properties ap
  JOIN custody c ON c.property_id = ap.property_id AND c.holder IS NOT NULL
  WHERE ap.property_id NOT IN (SELECT property_id FROM disposed)
  GROUP BY c.holder, ap.line_id, ap.item_id, ap.category, ap.property_type_id, ap.article,
           ap.line_description, ap.unit, ap.unit_cost_centavos, ap.doc_type, ap.doc_no, ap.issued_date
$$;

COMMIT;
