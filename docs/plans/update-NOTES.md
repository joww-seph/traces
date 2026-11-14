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
