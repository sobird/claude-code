CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"token_prefix" text NOT NULL,
	"token_hash" text NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_keys_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "environments" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_user_id" uuid,
	"machine_name" text,
	"directory" text,
	"branch" text,
	"git_repo_url" text,
	"max_sessions" integer DEFAULT 1 NOT NULL,
	"worker_type" text DEFAULT 'claude_code' NOT NULL,
	"bridge_id" text,
	"capabilities" jsonb,
	"status" text DEFAULT 'active' NOT NULL,
	"last_poll_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"session_id" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"direction" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_workers" (
	"session_id" text PRIMARY KEY NOT NULL,
	"worker_status" text,
	"external_metadata" jsonb,
	"requires_action_details" jsonb,
	"last_heartbeat_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"environment_id" text,
	"owner_user_id" uuid,
	"title" text,
	"status" text DEFAULT 'idle' NOT NULL,
	"source" text DEFAULT 'remote-control' NOT NULL,
	"permission_mode" text,
	"worker_epoch" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"display_name" text,
	"password_hash" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "work_items" (
	"id" text PRIMARY KEY NOT NULL,
	"environment_id" text NOT NULL,
	"session_id" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"secret" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environments" ADD CONSTRAINT "environments_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_events" ADD CONSTRAINT "session_events_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_workers" ADD CONSTRAINT "session_workers_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "environments_status_owner_idx" ON "environments" USING btree ("status","owner_user_id");--> statement-breakpoint
CREATE INDEX "session_events_session_id_idx" ON "session_events" USING btree ("session_id","id");--> statement-breakpoint
CREATE INDEX "sessions_owner_status_idx" ON "sessions" USING btree ("owner_user_id","status");--> statement-breakpoint
CREATE INDEX "work_items_environment_state_idx" ON "work_items" USING btree ("environment_id","state");