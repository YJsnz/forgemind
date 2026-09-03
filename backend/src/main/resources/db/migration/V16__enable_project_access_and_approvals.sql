-- ForgeCloud F3: enforce project-level access and persist unified approvals.

INSERT INTO cloud_project_member (project_id, user_id, role, status)
SELECT p.id, wm.user_id,
       CASE WHEN wm.role IN ('owner', 'admin') THEN 'manager' ELSE 'viewer' END,
       'active'
FROM cloud_project p
JOIN cloud_workspace_member wm ON wm.workspace_id = p.workspace_id AND wm.status = 'active'
ON DUPLICATE KEY UPDATE status = VALUES(status);

CREATE TABLE cloud_approval_request (
    id CHAR(36) NOT NULL,
    workspace_id CHAR(36) NOT NULL,
    project_id CHAR(36) NULL,
    approval_type VARCHAR(48) NOT NULL,
    object_type VARCHAR(48) NOT NULL,
    object_id VARCHAR(96) NOT NULL,
    title VARCHAR(180) NOT NULL,
    detail VARCHAR(2000) NULL,
    evidence_json JSON NOT NULL,
    rollback_available BOOLEAN NOT NULL DEFAULT FALSE,
    status VARCHAR(24) NOT NULL DEFAULT 'pending',
    requested_by CHAR(36) NOT NULL,
    decided_by CHAR(36) NULL,
    decision_note VARCHAR(2000) NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    decided_at DATETIME(6) NULL,
    PRIMARY KEY (id),
    KEY idx_cloud_approval_workspace (workspace_id, status, updated_at),
    KEY idx_cloud_approval_project (project_id, status, updated_at),
    KEY idx_cloud_approval_object (object_type, object_id),
    CONSTRAINT fk_cloud_approval_workspace FOREIGN KEY (workspace_id) REFERENCES cloud_workspace (id) ON DELETE CASCADE,
    CONSTRAINT fk_cloud_approval_project FOREIGN KEY (project_id) REFERENCES cloud_project (id) ON DELETE SET NULL,
    CONSTRAINT fk_cloud_approval_requester FOREIGN KEY (requested_by) REFERENCES app_user (id) ON DELETE RESTRICT,
    CONSTRAINT fk_cloud_approval_decider FOREIGN KEY (decided_by) REFERENCES app_user (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE cloud_approval_action (
    id BIGINT NOT NULL AUTO_INCREMENT,
    approval_id CHAR(36) NOT NULL,
    action VARCHAR(24) NOT NULL,
    actor_user_id CHAR(36) NOT NULL,
    note VARCHAR(2000) NULL,
    metadata_json JSON NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    KEY idx_cloud_approval_action_request (approval_id, created_at),
    CONSTRAINT fk_cloud_approval_action_request FOREIGN KEY (approval_id) REFERENCES cloud_approval_request (id) ON DELETE CASCADE,
    CONSTRAINT fk_cloud_approval_action_actor FOREIGN KEY (actor_user_id) REFERENCES app_user (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
