CREATE TABLE "oauth_connection_device" (
	"user_id" text NOT NULL,
	"client_id" text NOT NULL,
	"device_name" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_connection_device_user_id_client_id_pk" PRIMARY KEY("user_id","client_id")
);
--> statement-breakpoint
CREATE TABLE "upstream_rest_tool" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"upstream_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"method" text DEFAULT 'GET' NOT NULL,
	"url_template" text NOT NULL,
	"input_schema" jsonb DEFAULT '{"type":"object","properties":{}}'::jsonb NOT NULL,
	"headers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"body_template" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "upstream_rest_tool_uq" UNIQUE("upstream_id","name"),
	CONSTRAINT "upstream_rest_tool_method_ck" CHECK ("upstream_rest_tool"."method" in ('GET','POST','PUT','PATCH','DELETE')),
	CONSTRAINT "upstream_rest_tool_name_ck" CHECK ("upstream_rest_tool"."name" ~ '^[a-zA-Z0-9_-]{1,64}$')
);
--> statement-breakpoint
ALTER TABLE "upstream" DROP CONSTRAINT "upstream_type_ck";--> statement-breakpoint
ALTER TABLE "personal_access_token" ADD COLUMN "device_name" text;--> statement-breakpoint
ALTER TABLE "upstream" ADD COLUMN "tags" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "user_preference" ADD COLUMN "notify_new_client" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "user_preference" ADD COLUMN "notify_weekly" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user_preference" ADD COLUMN "tool_mode" text DEFAULT 'direct' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_preference" ADD COLUMN "theme" text DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "oauth_connection_device" ADD CONSTRAINT "oauth_connection_device_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_connection_device" ADD CONSTRAINT "oauth_connection_device_client_id_oauth_client_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_client"("client_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upstream_rest_tool" ADD CONSTRAINT "upstream_rest_tool_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upstream_rest_tool" ADD CONSTRAINT "upstream_rest_tool_user_upstream_fk" FOREIGN KEY ("user_id","upstream_id") REFERENCES "public"."upstream"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upstream" ADD CONSTRAINT "upstream_type_ck" CHECK ("upstream"."type" in ('http','stdio','rest'));--> statement-breakpoint
ALTER TABLE "user_preference" ADD CONSTRAINT "user_preference_tool_mode_ck" CHECK ("user_preference"."tool_mode" in ('direct','meta'));--> statement-breakpoint
ALTER TABLE "user_preference" ADD CONSTRAINT "user_preference_theme_ck" CHECK ("user_preference"."theme" in ('system','light','dark'));