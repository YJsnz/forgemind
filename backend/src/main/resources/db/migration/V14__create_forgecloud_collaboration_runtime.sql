-- ForgeCloud F3/F4 foundation: project access, releases, collaboration,
-- mobile tasks and read-only industrial runtime summaries.

CREATE TABLE cloud_project_member (
    project_id CHAR(36) NOT NULL,
    user_id CHAR(36) NOT NULL,
    role VARCHAR(32) NOT NULL DEFAULT 'viewer',
    status VARCHAR(24) NOT NULL DEFAULT 'active',
    joined_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (project_id, user_id),
    KEY idx_cloud_project_member_user (user_id, status),
    CONSTRAINT fk_cloud_project_member_project FOREIGN KEY (project_id) REFERENCES cloud_project (id) ON DELETE CASCADE,
    CONSTRAINT fk_cloud_project_member_user FOREIGN KEY (user_id) REFERENCES app_user (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO cloud_project_member (project_id, user_id, role, status)
SELECT p.id, p.owner_user_id, 'manager', 'active'
FROM cloud_project p
ON DUPLICATE KEY UPDATE role = VALUES(role), status = VALUES(status);

CREATE TABLE cloud_project_release (
    id CHAR(36) NOT NULL,
    project_id CHAR(36) NOT NULL,
    version_id CHAR(36) NOT NULL,
    release_name VARCHAR(160) NOT NULL,
    notes VARCHAR(1000) NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'published',
    created_by CHAR(36) NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY uq_cloud_project_release_version (version_id),
    KEY idx_cloud_project_release_project (project_id, created_at),
    CONSTRAINT fk_cloud_project_release_project FOREIGN KEY (project_id) REFERENCES cloud_project (id) ON DELETE CASCADE,
    CONSTRAINT fk_cloud_project_release_version FOREIGN KEY (version_id) REFERENCES cloud_project_version (id) ON DELETE RESTRICT,
    CONSTRAINT fk_cloud_project_release_creator FOREIGN KEY (created_by) REFERENCES app_user (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE cloud_comment (
    id CHAR(36) NOT NULL,
    workspace_id CHAR(36) NOT NULL,
    author_user_id CHAR(36) NOT NULL,
    object_type VARCHAR(48) NOT NULL,
    object_id VARCHAR(96) NOT NULL,
    body VARCHAR(2000) NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    KEY idx_cloud_comment_object (workspace_id, object_type, object_id, created_at),
    CONSTRAINT fk_cloud_comment_workspace FOREIGN KEY (workspace_id) REFERENCES cloud_workspace (id) ON DELETE CASCADE,
    CONSTRAINT fk_cloud_comment_author FOREIGN KEY (author_user_id) REFERENCES app_user (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE cloud_task (
    id CHAR(36) NOT NULL,
    workspace_id CHAR(36) NOT NULL,
    project_id CHAR(36) NULL,
    task_type VARCHAR(48) NOT NULL,
    title VARCHAR(180) NOT NULL,
    detail VARCHAR(2000) NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'open',
    priority VARCHAR(16) NOT NULL DEFAULT 'normal',
    assignee_user_id CHAR(36) NULL,
    source VARCHAR(32) NOT NULL DEFAULT 'cloud',
    created_by CHAR(36) NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    KEY idx_cloud_task_workspace (workspace_id, status, updated_at),
    KEY idx_cloud_task_assignee (assignee_user_id, status),
    CONSTRAINT fk_cloud_task_workspace FOREIGN KEY (workspace_id) REFERENCES cloud_workspace (id) ON DELETE CASCADE,
    CONSTRAINT fk_cloud_task_project FOREIGN KEY (project_id) REFERENCES cloud_project (id) ON DELETE SET NULL,
    CONSTRAINT fk_cloud_task_assignee FOREIGN KEY (assignee_user_id) REFERENCES app_user (id) ON DELETE SET NULL,
    CONSTRAINT fk_cloud_task_creator FOREIGN KEY (created_by) REFERENCES app_user (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE cloud_connector (
    id CHAR(36) NOT NULL,
    workspace_id CHAR(36) NOT NULL,
    name VARCHAR(120) NOT NULL,
    connector_type VARCHAR(32) NOT NULL,
    endpoint VARCHAR(500) NULL,
    credential_ref VARCHAR(180) NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'configured',
    read_only BOOLEAN NOT NULL DEFAULT TRUE,
    last_heartbeat_at DATETIME(6) NULL,
    created_by CHAR(36) NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    KEY idx_cloud_connector_workspace (workspace_id, status),
    CONSTRAINT fk_cloud_connector_workspace FOREIGN KEY (workspace_id) REFERENCES cloud_workspace (id) ON DELETE CASCADE,
    CONSTRAINT fk_cloud_connector_creator FOREIGN KEY (created_by) REFERENCES app_user (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE cloud_runtime_event (
    id BIGINT NOT NULL AUTO_INCREMENT,
    workspace_id CHAR(36) NOT NULL,
    connector_id CHAR(36) NULL,
    event_type VARCHAR(48) NOT NULL,
    quality VARCHAR(24) NOT NULL DEFAULT 'unknown',
    payload_json JSON NOT NULL,
    occurred_at DATETIME(6) NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    KEY idx_cloud_runtime_event_workspace (workspace_id, occurred_at),
    KEY idx_cloud_runtime_event_connector (connector_id, occurred_at),
    CONSTRAINT fk_cloud_runtime_event_workspace FOREIGN KEY (workspace_id) REFERENCES cloud_workspace (id) ON DELETE CASCADE,
    CONSTRAINT fk_cloud_runtime_event_connector FOREIGN KEY (connector_id) REFERENCES cloud_connector (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
