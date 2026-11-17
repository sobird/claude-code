-- The read-then-insert dedupe left duplicate inbound rows behind. Collapse each
-- (session_id, message_uuid) group to its newest row so the unique index can be built
-- on an existing database.
DELETE FROM "session_events" a
USING "session_events" b
WHERE a.direction = 'inbound' AND b.direction = 'inbound'
  AND a.message_uuid IS NOT NULL AND a.message_uuid = b.message_uuid
  AND a.session_id = b.session_id AND a.id > b.id;--> statement-breakpoint
DROP INDEX "session_events_session_message_uuid_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "session_events_session_message_uuid_idx" ON "session_events" USING btree ("session_id","message_uuid") WHERE direction = 'inbound' AND message_uuid IS NOT NULL;
