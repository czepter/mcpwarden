ALTER TABLE "upstream_secret" DROP CONSTRAINT "upstream_secret_upstream_id_upstream_id_fk";
--> statement-breakpoint
ALTER TABLE "upstream_tool" DROP CONSTRAINT "upstream_tool_upstream_id_upstream_id_fk";
--> statement-breakpoint
ALTER TABLE "upstream_secret" ADD CONSTRAINT "upstream_secret_user_upstream_fk" FOREIGN KEY ("user_id","upstream_id") REFERENCES "public"."upstream"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upstream_tool" ADD CONSTRAINT "upstream_tool_user_upstream_fk" FOREIGN KEY ("user_id","upstream_id") REFERENCES "public"."upstream"("user_id","id") ON DELETE cascade ON UPDATE no action;