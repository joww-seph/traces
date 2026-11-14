-- Update 01 views (docs/plans/traces-update-01.sql section 6). v_custody is unchanged; v_holdings and v_count_rows are gone.

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
--> statement-breakpoint

-- Card (SPC / PC): ONE CARD PER ITEM (model). One row per event per line; a set is one row.
-- Balance = stock held by the Supply Unit: + RECEIPT + RETURN - ISSUE - REISSUE - DISPOSE.
CREATE VIEW v_item_card AS
WITH ev AS (
  SELECT l.item_id, l.id AS line_id, m.type, m.date, m.officer_id,
         m.reference_document_id, m.reference_text, m.remarks,
         l.unit_cost_centavos,
         COUNT(*) FILTER (WHERE p.component_label IS NULL)::int AS qty,
         string_agg(p.property_no, E'\n' ORDER BY p.property_no) AS item_nos,
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
--> statement-breakpoint

-- Registry (RegSPI / Reg-PPE): one row per line, filterable by category and property type
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
--> statement-breakpoint

-- RPCSP / RPCPPE rows as at a date: one row per (accountable officer, line).
-- "Balance per Card" = main units of that line held by the officer on p_as_at.
-- On Hand per Count / Shortage / Overage are NOT stored: printed blank, filled in by hand.
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
