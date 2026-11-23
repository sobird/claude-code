CREATE TABLE "session_read_state" (
	"user_id" uuid NOT NULL,
	"session_id" text NOT NULL,
	"last_read_seq" bigint DEFAULT 0 NOT NULL,
	"manual_unread" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_read_state_user_id_session_id_pk" PRIMARY KEY("user_id","session_id")
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "last_result_seq" bigint;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "last_result_failed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "session_read_state" ADD CONSTRAINT "session_read_state_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_read_state" ADD CONSTRAINT "session_read_state_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;