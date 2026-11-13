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
--> statement-breakpoint

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
--> statement-breakpoint

-- Who holds each property now (latest custody movement)
CREATE VIEW v_custody AS
SELECT DISTINCT ON (m.property_id)
       m.property_id,
       CASE WHEN m.type = 'RETURN' THEN NULL ELSE m.officer_id END AS holder_officer_id,
       m.date AS since
FROM movements m
WHERE m.type IN ('ISSUE', 'REISSUE', 'RETURN')
ORDER BY m.property_id, m.date DESC, m.id DESC;
--> statement-breakpoint

-- Current holdings: active property, held by an officer, card balance > 0  (feeds BR-10)
CREATE VIEW v_holdings AS
SELECT ap.*, c.holder_officer_id, c.since
FROM v_active_properties ap
JOIN v_custody c ON c.property_id = ap.property_id AND c.holder_officer_id IS NOT NULL
WHERE (SELECT COALESCE(SUM(CASE m.type WHEN 'RECEIPT' THEN m.qty WHEN 'DISPOSE' THEN -m.qty ELSE 0 END), 0)
       FROM movements m WHERE m.property_id = ap.property_id) > 0;
--> statement-breakpoint

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
--> statement-breakpoint

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
--> statement-breakpoint
