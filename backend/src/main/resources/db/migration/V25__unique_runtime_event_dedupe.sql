-- Runtime event external identifiers are idempotency keys within a workspace.
-- NULL remains allowed for events that have no upstream identifier.
ALTER TABLE cloud_runtime_event
    DROP KEY idx_cloud_runtime_event_dedupe,
    ADD UNIQUE KEY uq_cloud_runtime_event_dedupe (workspace_id, dedupe_key);
