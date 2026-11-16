CREATE TABLE "units" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "units_code_check" CHECK ("units"."code" ~ '^[A-Za-z0-9]{1,12}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "units_code_lower_uq" ON "units" USING btree (lower("code"));