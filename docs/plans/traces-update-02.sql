-- TRACES Update 02 — reference migration (PostgreSQL 16+)
-- Applies on top of v1 (traces-schema.sql) + update-01 (traces-update-01.sql). Tested on that stack.
-- Purpose: a document can have a TRACES-generated PDF and/or an uploaded PDF (signed scan or an
-- existing file), each with its own highlight regions. See 2026-11-14-update-02-design.md (V-xx).

BEGIN;

CREATE TYPE pdf_kind AS ENUM ('generated', 'uploaded');

-- ── 1. Files of a document (V-03) ──
CREATE TABLE document_files (
  document_id    uuid NOT NULL REFERENCES documents(id),
  kind           pdf_kind NOT NULL,
  stored_name    text NOT NULL,
  original_name  text,                                   -- NULL for generated files
  size_bytes     integer NOT NULL CHECK (size_bytes > 0),
  page_count     smallint NOT NULL CHECK (page_count > 0),
  created_by     uuid NOT NULL REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (document_id, kind),
  CONSTRAINT document_files_name_rule CHECK ((kind = 'generated') = (original_name IS NULL))
);

-- move v1/update-01 single-PDF columns into document_files as 'uploaded'
INSERT INTO document_files (document_id, kind, stored_name, original_name, size_bytes, page_count, created_by, created_at)
SELECT id, 'uploaded', pdf_stored_name, pdf_original_name, pdf_size_bytes, pdf_page_count, created_by, created_at
FROM documents WHERE pdf_stored_name IS NOT NULL;

ALTER TABLE documents DROP CONSTRAINT documents_pdf_all_or_none;
ALTER TABLE documents DROP COLUMN pdf_stored_name;
ALTER TABLE documents DROP COLUMN pdf_original_name;
ALTER TABLE documents DROP COLUMN pdf_size_bytes;
ALTER TABLE documents DROP COLUMN pdf_page_count;

-- ── 2. Highlight regions per file kind (V-04) ──
ALTER TABLE line_pdf_regions ADD COLUMN kind pdf_kind NOT NULL DEFAULT 'uploaded';
ALTER TABLE line_pdf_regions DROP CONSTRAINT line_pdf_regions_pkey;
ALTER TABLE line_pdf_regions ADD PRIMARY KEY (line_id, kind);
ALTER TABLE line_pdf_regions ALTER COLUMN kind DROP DEFAULT;

-- ── 3. Default "Received from / Issued by" for generated forms (V-02) ──
ALTER TABLE settings ADD COLUMN default_issued_by_officer_id uuid REFERENCES officers(id);
ALTER TABLE settings ADD COLUMN ics_form_code text NOT NULL DEFAULT 'FM-FAS-SUPPLY-07-10  Rev. 1/07-25-22';  -- from his ICS
ALTER TABLE settings ADD COLUMN par_form_code text NOT NULL DEFAULT 'FM-FAS-SUPPLY-07-09  Rev. 1/07-25-22';  -- from his PAR

COMMIT;
