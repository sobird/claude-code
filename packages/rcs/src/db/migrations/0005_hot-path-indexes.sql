CREATE INDEX "api_keys_user_id_idx" ON "api_keys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_environment_id_idx" ON "sessions" USING btree ("environment_id");