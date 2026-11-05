CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" text,
	"actor" text NOT NULL,
	"client_id" text,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text,
	"target_label" text,
	"scope" text NOT NULL,
	"category" text NOT NULL,
	"result" text DEFAULT 'success' NOT NULL,
	"meta" jsonb,
	CONSTRAINT "audit_scope_ck" CHECK ("audit_log"."scope" in ('user','instance')),
	CONSTRAINT "audit_category_ck" CHECK ("audit_log"."category" in ('management','auth','status','denied')),
	CONSTRAINT "audit_result_ck" CHECK ("audit_log"."result" in ('success','denied','pending','status_change'))
);
--> statement-breakpoint
CREATE TABLE "call_stat" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" text NOT NULL,
	"client_id" text,
	"token_id" text,
	"upstream_id" uuid,
	"upstream_slug" text NOT NULL,
	"tool" text,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"total_ms" integer NOT NULL,
	"upstream_ms" integer,
	"overhead_ms" integer,
	"retries" smallint DEFAULT 0 NOT NULL,
	"req_bytes" integer DEFAULT 0 NOT NULL,
	"res_bytes" integer DEFAULT 0 NOT NULL,
	"cache_hit" boolean DEFAULT false NOT NULL,
	CONSTRAINT "call_stat_kind_ck" CHECK ("call_stat"."kind" in ('list','call'))
);
--> statement-breakpoint
CREATE TABLE "upstream" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"type" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"url" text,
	"transport" text DEFAULT 'auto' NOT NULL,
	"auth_type" text DEFAULT 'none' NOT NULL,
	"auth_header_name" text,
	"command" text,
	"args" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"env" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cwd" text,
	"rate_per_min" integer DEFAULT 60 NOT NULL,
	"max_concurrent" integer DEFAULT 5 NOT NULL,
	"timeouts" jsonb,
	"status" text DEFAULT 'unknown' NOT NULL,
	"status_reason" text,
	"status_changed_at" timestamp with time zone,
	"last_error" text,
	"last_ok_at" timestamp with time zone,
	"setup" text DEFAULT 'ready' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "upstream_user_slug_uq" UNIQUE("user_id","slug"),
	CONSTRAINT "upstream_type_ck" CHECK ("upstream"."type" in ('http','stdio')),
	CONSTRAINT "upstream_transport_ck" CHECK ("upstream"."transport" in ('auto','streamable','sse')),
	CONSTRAINT "upstream_auth_type_ck" CHECK ("upstream"."auth_type" in ('none','bearer','header','env')),
	CONSTRAINT "upstream_status_ck" CHECK ("upstream"."status" in ('unknown','healthy','degraded','open','auth_expired','disabled')),
	CONSTRAINT "upstream_setup_ck" CHECK ("upstream"."setup" in ('ready','awaiting_auth','awaiting_approval')),
	CONSTRAINT "upstream_slug_ck" CHECK ("upstream"."slug" ~ '^[a-z0-9][a-z0-9-]{0,31}$'),
	CONSTRAINT "upstream_http_url_ck" CHECK ("upstream"."type" <> 'http' or "upstream"."url" is not null),
	CONSTRAINT "upstream_stdio_cmd_ck" CHECK ("upstream"."type" <> 'stdio' or "upstream"."command" is not null)
);
--> statement-breakpoint
CREATE TABLE "upstream_secret" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"upstream_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"ciphertext" text NOT NULL,
	"key_version" smallint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "upstream_secret_uq" UNIQUE("upstream_id","kind","name"),
	CONSTRAINT "upstream_secret_kind_ck" CHECK ("upstream_secret"."kind" in ('bearer','header','env'))
);
--> statement-breakpoint
CREATE TABLE "upstream_tool" (
	"upstream_id" uuid NOT NULL,
	"name" text NOT NULL,
	"user_id" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"gone" boolean DEFAULT false NOT NULL,
	CONSTRAINT "upstream_tool_upstream_id_name_pk" PRIMARY KEY("upstream_id","name")
);
--> statement-breakpoint
CREATE TABLE "user_gateway_limits" (
	"user_id" text PRIMARY KEY NOT NULL,
	"max_upstreams" integer DEFAULT 50 NOT NULL,
	"calls_per_min" integer DEFAULT 120 NOT NULL,
	"max_connections" integer DEFAULT 20 NOT NULL,
	"stdio_allowed" boolean DEFAULT false NOT NULL,
	"stdio_max_procs" integer DEFAULT 5 NOT NULL,
	"stdio_idle_min" integer DEFAULT 10 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_invite" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"email" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"used_by" text,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "user_invite_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "call_stat" ADD CONSTRAINT "call_stat_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_stat" ADD CONSTRAINT "call_stat_upstream_id_upstream_id_fk" FOREIGN KEY ("upstream_id") REFERENCES "public"."upstream"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upstream" ADD CONSTRAINT "upstream_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upstream_secret" ADD CONSTRAINT "upstream_secret_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upstream_secret" ADD CONSTRAINT "upstream_secret_upstream_id_upstream_id_fk" FOREIGN KEY ("upstream_id") REFERENCES "public"."upstream"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upstream_tool" ADD CONSTRAINT "upstream_tool_upstream_id_upstream_id_fk" FOREIGN KEY ("upstream_id") REFERENCES "public"."upstream"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upstream_tool" ADD CONSTRAINT "upstream_tool_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_gateway_limits" ADD CONSTRAINT "user_gateway_limits_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_invite" ADD CONSTRAINT "user_invite_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_invite" ADD CONSTRAINT "user_invite_used_by_user_id_fk" FOREIGN KEY ("used_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_user_idx" ON "audit_log" USING btree ("user_id","id");--> statement-breakpoint
CREATE INDEX "audit_log_scope_idx" ON "audit_log" USING btree ("scope","id");--> statement-breakpoint
CREATE INDEX "call_stat_user_upstream_ts_idx" ON "call_stat" USING btree ("user_id","upstream_id","ts");--> statement-breakpoint
CREATE INDEX "call_stat_ts_idx" ON "call_stat" USING btree ("ts");