-- Officers who already received an ICS or PAR before can_receive existed (update 01 added it, default false)
-- stay usable as receivers and in the officer report.
UPDATE "officers" SET "can_receive" = true WHERE "id" IN (SELECT "received_by_officer_id" FROM "documents");
