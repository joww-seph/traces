-- Decision 2026-11-18: one card per property, one description per line.
-- The item details (type, category, article, unit) move onto the line; the items table (one card per model) goes.
-- The card is a view of one main property: its movements, with its components listed beside it.

DROP FUNCTION IF EXISTS fn_officer_report(date);--> statement-breakpoint
DROP VIEW IF EXISTS v_registry;--> statement-breakpoint
DROP VIEW IF EXISTS v_item_card;--> statement-breakpoint
DROP VIEW IF EXISTS v_active_properties;--> statement-breakpoint

ALTER TABLE "lines" ADD COLUMN "property_type_id" smallint;--> statement-breakpoint
ALTER TABLE "lines" ADD COLUMN "category" "item_category";--> statement-breakpoint
ALTER TABLE "lines" ADD COLUMN "article" text;--> statement-breakpoint
ALTER TABLE "lines" ADD COLUMN "unit" text;--> statement-breakpoint
UPDATE "lines" l SET property_type_id = i.property_type_id, category = i.category, article = i.article, unit = i.unit
FROM "items" i WHERE i.id = l.item_id;--> statement-breakpoint
ALTER TABLE "lines" ALTER COLUMN "property_type_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "lines" ALTER COLUMN "category" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "lines" ALTER COLUMN "article" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "lines" ALTER COLUMN "unit" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "lines" ADD CONSTRAINT "lines_property_type_id_property_types_id_fk" FOREIGN KEY ("property_type_id") REFERENCES "public"."property_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lines" ADD CONSTRAINT "lines_article_not_blank" CHECK (btrim(article) <> '');--> statement-breakpoint
ALTER TABLE "lines" ADD CONSTRAINT "lines_unit_not_blank" CHECK (btrim(unit) <> '');--> statement-breakpoint
DROP INDEX IF EXISTS "lines_item_idx";--> statement-breakpoint
ALTER TABLE "lines" DROP COLUMN "item_id";--> statement-breakpoint
CREATE INDEX "lines_type_category_idx" ON "lines" USING btree ("category","property_type_id") WHERE deleted_at IS NULL;--> statement-breakpoint
DROP TABLE "items";--> statement-breakpoint

CREATE VIEW v_active_properties AS
SELECT p.id AS property_id, p.property_no, p.serial_no, p.component_label, p.condition,
       l.id AS line_id, l.category, l.unit_cost_centavos, l.description AS line_description,
       l.article, l.unit,
       pt.id AS property_type_id, pt.code AS property_type_code, pt.name AS property_type_name,
       d.id AS document_id, d.type AS doc_type, d.doc_no, d.fund_cluster, d.issued_date
FROM properties p
JOIN lines l           ON l.id = p.line_id AND l.deleted_at IS NULL
JOIN property_types pt ON pt.id = l.property_type_id
JOIN documents d       ON d.id = l.document_id AND d.deleted_at IS NULL
WHERE p.voided_at IS NULL;
--> statement-breakpoint

-- One card per main property. Its components (on a one-unit line) are listed with it and have no card of their own.
-- balance = what the Supply Unit holds of this property after each event (1 after a receipt, 0 once issued).
CREATE VIEW v_property_card AS
WITH ev AS (
  SELECT p.id AS property_id, l.id AS line_id, m.type, m.date, m.officer_id,
         m.reference_document_id, m.reference_text, m.remarks, l.unit_cost_centavos,
         1 AS qty,
         concat_ws(E'\n', p.property_no, comp.nos) AS item_nos,
         m.id AS first_movement_id
  FROM movements m
  JOIN properties p ON p.id = m.property_id AND p.voided_at IS NULL AND p.component_label IS NULL
  JOIN lines l      ON l.id = p.line_id AND l.deleted_at IS NULL
  JOIN documents d  ON d.id = l.document_id AND d.deleted_at IS NULL
  CROSS JOIN LATERAL (
    SELECT string_agg(c.property_no, E'\n' ORDER BY c.property_no) AS nos
    FROM properties c WHERE c.line_id = l.id AND c.component_label IS NOT NULL AND c.voided_at IS NULL) comp
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
WINDOW w AS (PARTITION BY ev.property_id ORDER BY ev.date, ev.first_movement_id);
--> statement-breakpoint

-- Registry: one row per line. row_no numbers the rows of one register (category + property type) in issue order,
-- so a row on screen can be found on the printed sheet; filters never renumber it.
CREATE VIEW v_registry AS
SELECT l.id AS line_id, l.category, l.property_type_id, pt.code AS property_type_code,
       d.id AS document_id, d.issued_date AS date, d.type AS doc_type, d.doc_no,
       pn.property_nos, pn.serial_nos, l.article, l.description, l.est_useful_life_years,
       rcv.full_name AS issued_to,
       mv.issued_qty, mv.returned_qty, mv.reissued_qty, mv.disposed_qty,
       mv.issued_qty + mv.reissued_qty - mv.returned_qty - mv.disposed_qty AS balance_qty,
       l.qty * l.unit_cost_centavos AS amount_centavos,
       d.purpose AS remarks, d.fund_cluster, l.line_no,
       row_number() OVER (PARTITION BY l.category, l.property_type_id ORDER BY d.issued_date, d.doc_no, l.line_no) AS row_no
FROM lines l
JOIN property_types pt ON pt.id = l.property_type_id
JOIN documents d       ON d.id = l.document_id AND d.deleted_at IS NULL
JOIN officers rcv      ON rcv.id = d.received_by_officer_id
CROSS JOIN LATERAL (
  SELECT string_agg(p.property_no, E'\n' ORDER BY (p.component_label IS NOT NULL), p.property_no) AS property_nos,
         string_agg(coalesce(p.serial_no, ''), E'\n' ORDER BY (p.component_label IS NOT NULL), p.property_no) AS serial_nos
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
--> statement-breakpoint

CREATE FUNCTION fn_officer_report(p_as_at date)
RETURNS TABLE (
  officer_id uuid, line_id uuid, document_id uuid, category item_category,
  property_type_id smallint, article text, description text, property_nos text, serial_nos text,
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
  SELECT c.holder, ap.line_id, ap.document_id, ap.category, ap.property_type_id, ap.article,
         ap.line_description,
         string_agg(ap.property_no, E'\n' ORDER BY (ap.component_label IS NOT NULL), ap.property_no),
         string_agg(coalesce(ap.serial_no, ''), E'\n' ORDER BY (ap.component_label IS NOT NULL), ap.property_no),
         ap.unit, ap.unit_cost_centavos,
         (COUNT(*) FILTER (WHERE ap.component_label IS NULL))::int,
         ap.doc_type, ap.doc_no, ap.issued_date
  FROM v_active_properties ap
  JOIN custody c ON c.property_id = ap.property_id AND c.holder IS NOT NULL
  WHERE ap.property_id NOT IN (SELECT property_id FROM disposed)
  GROUP BY c.holder, ap.line_id, ap.document_id, ap.category, ap.property_type_id, ap.article,
           ap.line_description, ap.unit, ap.unit_cost_centavos, ap.doc_type, ap.doc_no, ap.issued_date
$$;
