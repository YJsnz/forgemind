-- ForgeCloud V19: reliable projection of low-frequency business events.
-- Outbox remains the delivery source of truth; activity rows are idempotent
-- read-side facts and never contain per-tick simulation or raw high-frequency telemetry.

ALTER TABLE cloud_outbox_event
    ADD COLUMN last_error VARCHAR(2000) NULL;

CREATE TABLE cloud_activity_event (
    id BIGINT NOT NULL AUTO_INCREMENT,
    outbox_event_id CHAR(36) NOT NULL,
    workspace_id CHAR(36) NULL,
    event_type VARCHAR(96) NOT NULL,
    aggregate_type VARCHAR(48) NULL,
    aggregate_id VARCHAR(96) NULL,
    actor_user_id CHAR(36) NULL,
    source VARCHAR(32) NULL,
    action VARCHAR(64) NULL,
    result VARCHAR(24) NULL,
    payload_json JSON NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY uq_cloud_activity_outbox (outbox_event_id),
    KEY idx_cloud_activity_workspace_time (workspace_id, id),
    KEY idx_cloud_activity_workspace_type (workspace_id, event_type, id),
    CONSTRAINT fk_cloud_activity_outbox FOREIGN KEY (outbox_event_id) REFERENCES cloud_outbox_event (id) ON DELETE CASCADE,
    CONSTRAINT fk_cloud_activity_workspace FOREIGN KEY (workspace_id) REFERENCES cloud_workspace (id) ON DELETE SET NULL,
    CONSTRAINT fk_cloud_activity_actor FOREIGN KEY (actor_user_id) REFERENCES app_user (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Preserve the historical audit trail in the new activity stream without
-- rewriting existing audit facts or making the read side the source of truth.
INSERT INTO cloud_outbox_event
    (id, workspace_id, event_type, aggregate_type, aggregate_id, payload_json)
SELECT UUID(), w.id, 'audit.recorded', a.object_type, a.object_id,
       JSON_OBJECT(
           'auditId', a.id,
           'actorUserId', a.actor_user_id,
           'source', a.source,
           'action', a.action,
           'objectType', a.object_type,
           'objectId', a.object_id,
           'result', a.result,
           'detail', COALESCE(a.detail_json, JSON_OBJECT())
       )
FROM cloud_audit_log a
LEFT JOIN cloud_workspace w ON w.id = a.workspace_id;
