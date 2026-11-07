CREATE TABLE "call_stat_hourly" (
	"hour" timestamp with time zone NOT NULL,
	"user_id" text NOT NULL,
	"upstream_slug" text NOT NULL,
	"tool" text DEFAULT '' NOT NULL,
	"status" text NOT NULL,
	"calls" integer NOT NULL,
	"total_ms_sum" bigint NOT NULL,
	"max_ms" integer NOT NULL,
	"overhead_ms_sum" bigint DEFAULT 0 NOT NULL,
	"overhead_calls" integer DEFAULT 0 NOT NULL,
	"hist" jsonb NOT NULL,
	CONSTRAINT "call_stat_hourly_hour_user_id_upstream_slug_tool_status_pk" PRIMARY KEY("hour","user_id","upstream_slug","tool","status")
);
--> statement-breakpoint
ALTER TABLE "call_stat_hourly" ADD CONSTRAINT "call_stat_hourly_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "call_stat_hourly_hour_idx" ON "call_stat_hourly" USING btree ("hour");