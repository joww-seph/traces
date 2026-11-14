ALTER TABLE "settings" ALTER COLUMN "ppe_registry_title" SET DEFAULT 'REGISTRY OF PROPERTY, PLANT AND EQUIPMENT ISSUED';--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "ics_form_code" text DEFAULT 'FM-FAS-SUPPLY-07-10' NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "ics_form_revision" text DEFAULT 'Rev. 1/07-25-22' NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "par_form_code" text DEFAULT 'FM-FAS-SUPPLY-07-09' NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "par_form_revision" text DEFAULT 'Rev. 1/07-25-22' NOT NULL;
--> statement-breakpoint
-- an existing row still holding the old default title takes the new one; a title someone customised is left alone
UPDATE "settings" SET "ppe_registry_title" = 'REGISTRY OF PROPERTY, PLANT AND EQUIPMENT ISSUED' WHERE "ppe_registry_title" = 'REGISTRY OF PPE ISSUED';
