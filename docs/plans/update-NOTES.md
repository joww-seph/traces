# Update 01 / 02 notes (live code vs plan)

Order of precedence: **Update 02 > Update 01 > v1**.

## Live schema vs `traces-schema.sql` (checked 2026-11-14)
No differences in tables or constraints, apart from:
- `properties.old_property_no` (migration 0002), kept.
- `settings.ppe_registry_title` default, kept (already in v1 DDL).
- `settings.ics_form_code`, `ics_form_revision`, `par_form_code`, `par_form_revision` already exist (migration 0003, also in v1 DDL).

## Differences from the update plans
- Plan files sit flat in `docs/plans/` (no `update-01/` or `update-02/` subfolders).
- `traces-update-02.sql` adds `settings.ics_form_code` / `par_form_code`. They already exist, so only `default_issued_by_officer_id` is added. The revision text stays in its own column.
- Update 02 W1 (document files) is done right before U8, so U8 writes straight to `document_files` and no PDF is stored twice.

## What differs from the plans (rulings made while building)
- `GET /api/documents` filters by `?status=none|generated|signed|unsigned` instead of `?hasPdf=false`; the list has a PDF column.
- No `/api/documents/:id/entry` or `/documents/new` pages: both redirect to `/issue`. `/issue?documentId=` adds rows to an unsigned form.
- After a save, `/issue` shows the saved forms with Print / Open / Stickers buttons instead of jumping to the PDF (a mixed save makes two forms).
- Paste-from-Excel on the entry rows is not built (v1 has no BR-14 in the repo). Rows are typed, or copied with Ctrl+D / "Make copies".
- A row taller than a page is split over pages in the generated form; its box is the first piece.
- PAR signature order follows the reference prototype (Issued by left, Received by right).
- The public Report tab shows only rows of the scanned document (same rule as the registry), and the public card shows only the scanned line's rows and number range.
- Editing a signed form's header (`PATCH /api/documents/:id`) is locked too, like its lines. Serial numbers and condition (properties) stay editable.
- `traces-update-02.sql` adds `ics_form_code` / `par_form_code`; they already existed, so only `default_issued_by_officer_id` was added.
- `RECEIPT` date is the line's date acquired (the IAR date is no longer used for it).
