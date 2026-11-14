-- Update 02: a document can have a TRACES-generated PDF and/or an uploaded one (docs/plans/traces-update-02.sql).
CREATE TYPE "public"."pdf_kind" AS ENUM('generated', 'uploaded');--> statement-breakpoint
CREATE TABLE "document_files" (
	"document_id" uuid NOT NULL,
	"kind" "pdf_kind" NOT NULL,
	"stored_name" text NOT NULL,
	"original_name" text,
	"size_bytes" integer NOT NULL,
	"page_count" smallint NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_files_document_id_kind_pk" PRIMARY KEY("document_id","kind"),
	CONSTRAINT "document_files_size_positive" CHECK ("document_files"."size_bytes" > 0),
	CONSTRAINT "document_files_pages_positive" CHECK ("document_files"."page_count" > 0),
	CONSTRAINT "document_files_name_rule" CHECK (("document_files"."kind" = 'generated') = ("document_files"."original_name" IS NULL))
);--> statement-breakpoint
ALTER TABLE "document_files" ADD CONSTRAINT "document_files_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_files" ADD CONSTRAINT "document_files_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- the single PDF of v1 becomes the 'uploaded' file; move it before the columns are dropped
INSERT INTO "document_files" ("document_id", "kind", "stored_name", "original_name", "size_bytes", "page_count", "created_by", "created_at")
SELECT "id", 'uploaded', "pdf_stored_name", "pdf_original_name", "pdf_size_bytes", "pdf_page_count", "created_by", "created_at"
FROM "documents" WHERE "pdf_stored_name" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT "documents_pdf_size_positive";--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT "documents_pdf_pages_positive";--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT "documents_pdf_all_or_none";--> statement-breakpoint
ALTER TABLE "documents" DROP COLUMN "pdf_stored_name";--> statement-breakpoint
ALTER TABLE "documents" DROP COLUMN "pdf_original_name";--> statement-breakpoint
ALTER TABLE "documents" DROP COLUMN "pdf_size_bytes";--> statement-breakpoint
ALTER TABLE "documents" DROP COLUMN "pdf_page_count";--> statement-breakpoint

-- highlight regions per kind of PDF; the existing boxes were drawn on the uploaded scan
ALTER TABLE "line_pdf_regions" ADD COLUMN "kind" "pdf_kind" DEFAULT 'uploaded' NOT NULL;--> statement-breakpoint
ALTER TABLE "line_pdf_regions" ALTER COLUMN "kind" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "line_pdf_regions" DROP CONSTRAINT "line_pdf_regions_pkey";--> statement-breakpoint
ALTER TABLE "line_pdf_regions" ADD CONSTRAINT "line_pdf_regions_line_id_kind_pk" PRIMARY KEY("line_id","kind");--> statement-breakpoint

ALTER TABLE "settings" ADD COLUMN "default_issued_by_officer_id" uuid;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_default_issued_by_officer_id_officers_id_fk" FOREIGN KEY ("default_issued_by_officer_id") REFERENCES "public"."officers"("id") ON DELETE no action ON UPDATE no action;
