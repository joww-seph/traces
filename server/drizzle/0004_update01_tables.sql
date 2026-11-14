-- Update 01: items (one card per model), property types, officer designations, report signatories.
-- Mirrors docs/plans/traces-update-01.sql sections 0-5.

-- views depend on columns that change; they are recreated in 0005_update01_views.sql
DROP VIEW IF EXISTS "v_count_rows";--> statement-breakpoint
DROP VIEW IF EXISTS "v_registry";--> statement-breakpoint
DROP VIEW IF EXISTS "v_holdings";--> statement-breakpoint
DROP VIEW IF EXISTS "v_card_movements";--> statement-breakpoint
DROP VIEW IF EXISTS "v_active_properties";--> statement-breakpoint

-- physical count sessions are gone: the report is computed (fn_officer_report)
DROP TABLE "count_items" CASCADE;--> statement-breakpoint
DROP TABLE "count_signatories" CASCADE;--> statement-breakpoint
DROP TABLE "physical_counts" CASCADE;--> statement-breakpoint
DROP TYPE "public"."count_status";--> statement-breakpoint

CREATE TABLE "property_types" (
	"id" smallint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "property_types_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 32767 START WITH 1 CACHE 1),
	"code" text NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "property_types_code_check" CHECK ("property_types"."code" ~ '^[A-Z]{2,8}$')
);--> statement-breakpoint
CREATE UNIQUE INDEX "property_types_code_uq" ON "property_types" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "property_types_name_uq" ON "property_types" USING btree (lower("name"));--> statement-breakpoint
-- codes for Furniture and Fixtures / Office Equipment are still to be confirmed with the stakeholder (editable on /property-types)
INSERT INTO "property_types" ("code", "name") VALUES
	('ICT', 'Information and Communications Technology Equipment'),
	('FF', 'Furniture and Fixtures'),
	('OE', 'Office Equipment');--> statement-breakpoint

CREATE TABLE "items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_type_id" smallint NOT NULL,
	"category" "item_category" NOT NULL,
	"article" text NOT NULL,
	"description" text NOT NULL,
	"unit" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "items_id_category_uq" UNIQUE("id","category")
);--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_property_type_id_property_types_id_fk" FOREIGN KEY ("property_type_id") REFERENCES "public"."property_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "items_identity_uq" ON "items" USING btree ("category","property_type_id",lower("article"),lower("description"));--> statement-breakpoint
CREATE INDEX "items_type_idx" ON "items" USING btree ("property_type_id","category") WHERE active;--> statement-breakpoint

-- lines point to an item; article and unit move to the item (3NF)
ALTER TABLE "lines" ADD COLUMN "item_id" uuid;--> statement-breakpoint
-- backfill (dev/test data): one item per existing line, typed ICT
INSERT INTO "items" ("id", "property_type_id", "category", "article", "description", "unit")
SELECT gen_random_uuid(), (SELECT "id" FROM "property_types" WHERE "code" = 'ICT'), l."category", l."article",
       l."article" || ' (migrated ' || left(l."id"::text, 8) || ')', l."unit"
FROM "lines" l;--> statement-breakpoint
UPDATE "lines" l SET "item_id" = i."id" FROM "items" i
WHERE i."description" = l."article" || ' (migrated ' || left(l."id"::text, 8) || ')';--> statement-breakpoint
ALTER TABLE "lines" ALTER COLUMN "item_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "lines" ADD CONSTRAINT "lines_item_category_fk" FOREIGN KEY ("item_id","category") REFERENCES "public"."items"("id","category") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lines_item_idx" ON "lines" USING btree ("item_id");--> statement-breakpoint
ALTER TABLE "lines" DROP COLUMN "article";--> statement-breakpoint
ALTER TABLE "lines" DROP COLUMN "unit";--> statement-breakpoint

ALTER TABLE "officers" ADD COLUMN "can_receive" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE TABLE "officer_designations" (
	"officer_id" uuid NOT NULL,
	"sort_order" smallint NOT NULL,
	"designation" text NOT NULL,
	CONSTRAINT "officer_designations_officer_id_sort_order_pk" PRIMARY KEY("officer_id","sort_order")
);--> statement-breakpoint
ALTER TABLE "officer_designations" ADD CONSTRAINT "officer_designations_officer_id_officers_id_fk" FOREIGN KEY ("officer_id") REFERENCES "public"."officers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

CREATE TABLE "report_signatories" (
	"role" "signatory_role" NOT NULL,
	"sort_order" smallint DEFAULT 1 NOT NULL,
	"name" text NOT NULL,
	"position" text,
	CONSTRAINT "report_signatories_role_sort_order_pk" PRIMARY KEY("role","sort_order")
);
