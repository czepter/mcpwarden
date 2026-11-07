CREATE TABLE "upstream_oauth" (
	"upstream_id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"data" text,
	"state_hash" text,
	"state_expires_at" timestamp with time zone,
	"connected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "upstream" DROP CONSTRAINT "upstream_auth_type_ck";--> statement-breakpoint
ALTER TABLE "upstream_oauth" ADD CONSTRAINT "upstream_oauth_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upstream_oauth" ADD CONSTRAINT "upstream_oauth_user_upstream_fk" FOREIGN KEY ("user_id","upstream_id") REFERENCES "public"."upstream"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "upstream_oauth_state_uq" ON "upstream_oauth" USING btree ("state_hash");--> statement-breakpoint
ALTER TABLE "upstream" ADD CONSTRAINT "upstream_auth_type_ck" CHECK ("upstream"."auth_type" in ('none','bearer','header','env','oauth'));