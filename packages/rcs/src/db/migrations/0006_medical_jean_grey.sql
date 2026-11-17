CREATE TABLE "attachments" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"media_type" text NOT NULL,
	"sha256" text NOT NULL,
	"byte_length" integer NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attachments_owner_sha256_idx" ON "attachments" USING btree ("owner_user_id","sha256");