-- Reconnects used to stack pending work_items per session. Keep the newest in-flight row
-- (its secret is freshest) and retire the rest so the unique index can be built in place.
UPDATE "work_items" SET state = 'completed', updated_at = now()
WHERE "id" IN (
  SELECT a."id" FROM "work_items" a
  JOIN "work_items" b
    ON a."session_id" = b."session_id"
   AND a."state" IN ('pending', 'dispatched')
   AND b."state" IN ('pending', 'dispatched')
   AND (b."updated_at" > a."updated_at" OR (b."updated_at" = a."updated_at" AND b."id" > a."id"))
);--> statement-breakpoint
CREATE UNIQUE INDEX "work_items_session_inflight_idx" ON "work_items" USING btree ("session_id") WHERE state IN ('pending', 'dispatched');