ALTER TABLE "personal_access_token" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "personal_access_token" ADD COLUMN "upstream_ids" uuid[];