CREATE TABLE "count_scans" (
	"count_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"scanned_by" uuid,
	"scanned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "count_scans_count_id_property_id_pk" PRIMARY KEY("count_id","property_id")
);
--> statement-breakpoint
CREATE TABLE "physical_counts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"officer_id" uuid NOT NULL,
	"category" "item_category" NOT NULL,
	"as_at" date NOT NULL,
	"closed_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "count_scans" ADD CONSTRAINT "count_scans_count_id_physical_counts_id_fk" FOREIGN KEY ("count_id") REFERENCES "public"."physical_counts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "count_scans" ADD CONSTRAINT "count_scans_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "count_scans" ADD CONSTRAINT "count_scans_scanned_by_users_id_fk" FOREIGN KEY ("scanned_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "physical_counts" ADD CONSTRAINT "physical_counts_officer_id_officers_id_fk" FOREIGN KEY ("officer_id") REFERENCES "public"."officers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "physical_counts" ADD CONSTRAINT "physical_counts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "physical_counts_officer_category_as_at_uq" ON "physical_counts" USING btree ("officer_id","category","as_at");
--> statement-breakpoint
-- The officer report now also carries the condition (the RPC lists serviceable rows, the IIRUP/IIRUSP the unserviceable ones)
-- and, when a count is given, how many main units of the row a scan has found. NULL = no count: printed blank for hand count.
DROP FUNCTION IF EXISTS fn_officer_report(date);--> statement-breakpoint
CREATE FUNCTION fn_officer_report(p_as_at date, p_count uuid DEFAULT NULL)
RETURNS TABLE (
  officer_id uuid, line_id uuid, document_id uuid, category item_category,
  property_type_id smallint, article text, description text, property_nos text, serial_nos text,
  unit text, unit_value_centavos bigint, balance_per_card int,
  doc_type doc_type, doc_no text, issued_date date, condition item_condition, counted_units int
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
         ap.doc_type, ap.doc_no, ap.issued_date, ap.condition,
         CASE WHEN p_count IS NULL THEN NULL
              ELSE (COUNT(*) FILTER (WHERE ap.component_label IS NULL AND EXISTS (
                SELECT 1 FROM count_scans cs WHERE cs.count_id = p_count AND cs.property_id = ap.property_id)))::int END
  FROM v_active_properties ap
  JOIN custody c ON c.property_id = ap.property_id AND c.holder IS NOT NULL
  WHERE ap.property_id NOT IN (SELECT property_id FROM disposed)
  GROUP BY c.holder, ap.line_id, ap.document_id, ap.category, ap.property_type_id, ap.article,
           ap.line_description, ap.unit, ap.unit_cost_centavos, ap.doc_type, ap.doc_no, ap.issued_date, ap.condition
$$;
