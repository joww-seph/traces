CREATE TYPE "public"."card_row_mode" AS ENUM('merged', 'split');--> statement-breakpoint
CREATE TYPE "public"."count_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TYPE "public"."doc_type" AS ENUM('ICS', 'PAR');--> statement-breakpoint
CREATE TYPE "public"."item_category" AS ENUM('semi', 'ppe');--> statement-breakpoint
CREATE TYPE "public"."item_condition" AS ENUM('serviceable', 'unserviceable');--> statement-breakpoint
CREATE TYPE "public"."movement_type" AS ENUM('RECEIPT', 'ISSUE', 'RETURN', 'REISSUE', 'DISPOSE');--> statement-breakpoint
CREATE TYPE "public"."signatory_role" AS ENUM('committee', 'head_of_agency', 'coa_representative');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('supply_admin', 'superadmin');--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"actor_id" uuid,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"ip" "inet",
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "count_items" (
	"count_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"qty_on_hand" integer,
	"remarks" text,
	CONSTRAINT "count_items_count_id_property_id_pk" PRIMARY KEY("count_id","property_id"),
	CONSTRAINT "count_items_qty_nonneg" CHECK ("count_items"."qty_on_hand" >= 0)
);
--> statement-breakpoint
CREATE TABLE "count_signatories" (
	"count_id" uuid NOT NULL,
	"role" "signatory_role" NOT NULL,
	"sort_order" smallint DEFAULT 1 NOT NULL,
	"name" text NOT NULL,
	"position" text,
	CONSTRAINT "count_signatories_count_id_role_sort_order_pk" PRIMARY KEY("count_id","role","sort_order")
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "doc_type" NOT NULL,
	"doc_no" text NOT NULL,
	"fund_cluster" text NOT NULL,
	"issued_date" date NOT NULL,
	"issued_by_officer_id" uuid NOT NULL,
	"issued_by_position" text NOT NULL,
	"received_by_officer_id" uuid NOT NULL,
	"received_by_position" text NOT NULL,
	"purpose" text,
	"pdf_stored_name" text,
	"pdf_original_name" text,
	"pdf_size_bytes" integer,
	"pdf_page_count" smallint,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "documents_type_doc_no_uq" UNIQUE("type","doc_no"),
	CONSTRAINT "documents_pdf_size_positive" CHECK ("documents"."pdf_size_bytes" > 0),
	CONSTRAINT "documents_pdf_pages_positive" CHECK ("documents"."pdf_page_count" > 0),
	CONSTRAINT "documents_pdf_all_or_none" CHECK (
    ("documents"."pdf_stored_name" IS NULL) = ("documents"."pdf_original_name" IS NULL) AND
    ("documents"."pdf_stored_name" IS NULL) = ("documents"."pdf_size_bytes" IS NULL) AND
    ("documents"."pdf_stored_name" IS NULL) = ("documents"."pdf_page_count" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "line_pdf_regions" (
	"line_id" uuid PRIMARY KEY NOT NULL,
	"page" smallint NOT NULL,
	"x" numeric(6, 5) NOT NULL,
	"y" numeric(6, 5) NOT NULL,
	"w" numeric(6, 5) NOT NULL,
	"h" numeric(6, 5) NOT NULL,
	CONSTRAINT "line_pdf_regions_page_positive" CHECK ("line_pdf_regions"."page" > 0),
	CONSTRAINT "line_pdf_regions_x" CHECK ("line_pdf_regions"."x" >= 0 AND "line_pdf_regions"."x" <= 1),
	CONSTRAINT "line_pdf_regions_y" CHECK ("line_pdf_regions"."y" >= 0 AND "line_pdf_regions"."y" <= 1),
	CONSTRAINT "line_pdf_regions_w" CHECK ("line_pdf_regions"."w" > 0 AND "line_pdf_regions"."x" + "line_pdf_regions"."w" <= 1.00001),
	CONSTRAINT "line_pdf_regions_h" CHECK ("line_pdf_regions"."h" > 0 AND "line_pdf_regions"."y" + "line_pdf_regions"."h" <= 1.00001)
);
--> statement-breakpoint
CREATE TABLE "lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"qty" integer NOT NULL,
	"unit" text NOT NULL,
	"unit_cost_centavos" bigint NOT NULL,
	"article" text NOT NULL,
	"description" text NOT NULL,
	"est_useful_life_years" smallint,
	"date_acquired" date,
	"iar_no" text,
	"iar_date" date,
	"category" "item_category" NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "lines_document_line_no_uq" UNIQUE("document_id","line_no"),
	CONSTRAINT "lines_line_no_positive" CHECK ("lines"."line_no" > 0),
	CONSTRAINT "lines_qty_positive" CHECK ("lines"."qty" > 0),
	CONSTRAINT "lines_unit_cost_nonneg" CHECK ("lines"."unit_cost_centavos" >= 0),
	CONSTRAINT "lines_useful_life_positive" CHECK ("lines"."est_useful_life_years" > 0)
);
--> statement-breakpoint
CREATE TABLE "movements" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "movements_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"property_id" uuid NOT NULL,
	"type" "movement_type" NOT NULL,
	"qty" integer DEFAULT 1 NOT NULL,
	"date" date NOT NULL,
	"officer_id" uuid,
	"reference_document_id" uuid,
	"reference_text" text,
	"remarks" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "movements_qty_positive" CHECK ("movements"."qty" > 0),
	CONSTRAINT "movements_custody_needs_officer" CHECK ("movements"."type" NOT IN ('ISSUE', 'REISSUE', 'RETURN') OR "movements"."officer_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "officers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" text NOT NULL,
	"short_name" text NOT NULL,
	"position" text NOT NULL,
	"office" text DEFAULT '' NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "physical_counts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category" "item_category" NOT NULL,
	"type_label" text NOT NULL,
	"as_at" date NOT NULL,
	"fund_cluster" text NOT NULL,
	"officer_id" uuid NOT NULL,
	"officer_position" text NOT NULL,
	"assumption_date" date,
	"status" "count_status" DEFAULT 'open' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "physical_counts_unique_session" UNIQUE("category","officer_id","as_at")
);
--> statement-breakpoint
CREATE TABLE "properties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_no" text NOT NULL,
	"line_id" uuid NOT NULL,
	"serial_no" text,
	"component_label" text,
	"condition" "item_condition" DEFAULT 'serviceable' NOT NULL,
	"voided_at" timestamp with time zone,
	CONSTRAINT "properties_property_no_format" CHECK ("properties"."property_no" ~ '^[A-Za-z0-9-]+$')
);
--> statement-breakpoint
CREATE TABLE "qr_tokens" (
	"token" char(10) PRIMARY KEY NOT NULL,
	"property_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "qr_tokens_token_format" CHECK ("qr_tokens"."token" ~ '^[0-9A-Za-z]{10}$')
);
--> statement-breakpoint
CREATE TABLE "session" (
	"sid" varchar PRIMARY KEY NOT NULL,
	"sess" json NOT NULL,
	"expire" timestamp (6) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"entity_name" text NOT NULL,
	"default_fund_cluster" text NOT NULL,
	"ppe_threshold_centavos" bigint NOT NULL,
	"card_row_mode" "card_row_mode" DEFAULT 'merged' NOT NULL,
	"public_base_url" text NOT NULL,
	"ppe_registry_title" text DEFAULT 'REGISTRY OF PPE ISSUED' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "settings_single_row" CHECK ("settings"."id" = 1),
	CONSTRAINT "settings_threshold_positive" CHECK ("settings"."ppe_threshold_centavos" > 0)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "user_role" NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"must_change_password" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "count_items" ADD CONSTRAINT "count_items_count_id_physical_counts_id_fk" FOREIGN KEY ("count_id") REFERENCES "public"."physical_counts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "count_items" ADD CONSTRAINT "count_items_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "count_signatories" ADD CONSTRAINT "count_signatories_count_id_physical_counts_id_fk" FOREIGN KEY ("count_id") REFERENCES "public"."physical_counts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_issued_by_officer_id_officers_id_fk" FOREIGN KEY ("issued_by_officer_id") REFERENCES "public"."officers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_received_by_officer_id_officers_id_fk" FOREIGN KEY ("received_by_officer_id") REFERENCES "public"."officers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "line_pdf_regions" ADD CONSTRAINT "line_pdf_regions_line_id_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lines" ADD CONSTRAINT "lines_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movements" ADD CONSTRAINT "movements_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movements" ADD CONSTRAINT "movements_officer_id_officers_id_fk" FOREIGN KEY ("officer_id") REFERENCES "public"."officers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movements" ADD CONSTRAINT "movements_reference_document_id_documents_id_fk" FOREIGN KEY ("reference_document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "physical_counts" ADD CONSTRAINT "physical_counts_officer_id_officers_id_fk" FOREIGN KEY ("officer_id") REFERENCES "public"."officers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "physical_counts" ADD CONSTRAINT "physical_counts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_line_id_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qr_tokens" ADD CONSTRAINT "qr_tokens_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX "audit_logs_at_idx" ON "audit_logs" USING btree ("at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "count_items_property_idx" ON "count_items" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "documents_issued_date_idx" ON "documents" USING btree ("issued_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "documents_received_by_idx" ON "documents" USING btree ("received_by_officer_id");--> statement-breakpoint
CREATE INDEX "lines_category_idx" ON "lines" USING btree ("category") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "movements_property_date_idx" ON "movements" USING btree ("property_id","date","id");--> statement-breakpoint
CREATE INDEX "movements_officer_idx" ON "movements" USING btree ("officer_id","type");--> statement-breakpoint
CREATE UNIQUE INDEX "officers_short_name_uq" ON "officers" USING btree (lower("short_name"));--> statement-breakpoint
CREATE UNIQUE INDEX "properties_property_no_uq" ON "properties" USING btree (upper("property_no"));--> statement-breakpoint
CREATE INDEX "properties_line_idx" ON "properties" USING btree ("line_id");--> statement-breakpoint
CREATE UNIQUE INDEX "qr_tokens_one_active_uq" ON "qr_tokens" USING btree ("property_id") WHERE revoked_at IS NULL;--> statement-breakpoint
CREATE INDEX "session_expire_idx" ON "session" USING btree ("expire");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_uq" ON "users" USING btree (lower("email"));