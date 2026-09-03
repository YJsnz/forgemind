-- ForgeCloud F1 foundation: workspaces, versioned project/resource projections,
-- notifications, audit records and transactional outbox. Existing ForgeMind
-- tables remain authoritative during the compatibility migration.

CREATE TABLE cloud_workspace (
    id CHAR(36) NOT NULL,
    owner_user_id CHAR(36) NOT NULL,
    name VARCHAR(120) NOT NULL,
    slug VARCHAR(96) NOT NULL,
    workspace_type VARCHAR(24) NOT NULL DEFAULT 'personal',
    status VARCHAR(24) NOT NULL DEFAULT 'active',
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY uq_cloud_workspace_slug (slug),
    KEY idx_cloud_workspace_owner (owner_user_id),
    CONSTRAINT fk_cloud_workspace_owner FOREIGN KEY (owner_user_id) REFERENCES app_user (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE cloud_workspace_member (
    workspace_id CHAR(36) NOT NULL,
    user_id CHAR(36) NOT NULL,
    role VARCHAR(32) NOT NULL DEFAULT 'member',
    status VARCHAR(24) NOT NULL DEFAULT 'active',
    joined_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (workspace_id, user_id),
    KEY idx_cloud_workspace_member_user (user_id, status),
    CONSTRAINT fk_cloud_workspace_member_workspace FOREIGN KEY (workspace_id) REFERENCES cloud_workspace (id) ON DELETE CASCADE,
    CONSTRAINT fk_cloud_workspace_member_user FOREIGN KEY (user_id) REFERENCES app_user (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE cloud_project (
    id CHAR(36) NOT NULL,
    workspace_id CHAR(36) NOT NULL,
    owner_user_id CHAR(36) NOT NULL,
    name VARCHAR(120) NOT NULL,
    project_type VARCHAR(32) NOT NULL DEFAULT 'factory',
    visibility VARCHAR(24) NOT NULL DEFAULT 'private',
    status VARCHAR(24) NOT NULL DEFAULT 'active',
    current_version_id CHAR(36) NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    KEY idx_cloud_project_workspace (workspace_id, updated_at),
    KEY idx_cloud_project_owner (owner_user_id),
    CONSTRAINT fk_cloud_project_workspace FOREIGN KEY (workspace_id) REFERENCES cloud_workspace (id) ON DELETE CASCADE,
    CONSTRAINT fk_cloud_project_owner FOREIGN KEY (owner_user_id) REFERENCES app_user (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE cloud_project_version (
    id CHAR(36) NOT NULL,
    project_id CHAR(36) NOT NULL,
    parent_version_id CHAR(36) NULL,
    version_no INT NOT NULL,
    branch_name VARCHAR(96) NOT NULL DEFAULT 'main',
    schema_version INT NOT NULL,
    content_hash CHAR(64) NOT NULL,
    save_json JSON NOT NULL,
    note VARCHAR(500) NULL,
    created_by CHAR(36) NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY uq_cloud_project_version_number (project_id, branch_name, version_no),
    KEY idx_cloud_project_version_project (project_id, created_at),
    CONSTRAINT fk_cloud_project_version_project FOREIGN KEY (project_id) REFERENCES cloud_project (id) ON DELETE CASCADE,
    CONSTRAINT fk_cloud_project_version_parent FOREIGN KEY (parent_version_id) REFERENCES cloud_project_version (id) ON DELETE SET NULL,
    CONSTRAINT fk_cloud_project_version_creator FOREIGN KEY (created_by) REFERENCES app_user (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

ALTER TABLE cloud_project
    ADD CONSTRAINT fk_cloud_project_current_version FOREIGN KEY (current_version_id) REFERENCES cloud_project_version (id) ON DELETE SET NULL;

CREATE TABLE cloud_asset (
    id CHAR(36) NOT NULL,
    workspace_id CHAR(36) NOT NULL,
    owner_user_id CHAR(36) NOT NULL,
    external_id VARCHAR(96) NOT NULL,
    kind VARCHAR(32) NOT NULL DEFAULT 'model3d',
    name VARCHAR(120) NOT NULL,
    visibility VARCHAR(24) NOT NULL DEFAULT 'private',
    status VARCHAR(24) NOT NULL DEFAULT 'draft',
    current_version_id CHAR(36) NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY uq_cloud_asset_external (workspace_id, external_id),
    KEY idx_cloud_asset_workspace (workspace_id, updated_at),
    CONSTRAINT fk_cloud_asset_workspace FOREIGN KEY (workspace_id) REFERENCES cloud_workspace (id) ON DELETE CASCADE,
    CONSTRAINT fk_cloud_asset_owner FOREIGN KEY (owner_user_id) REFERENCES app_user (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE cloud_asset_version (
    id CHAR(36) NOT NULL,
    asset_id CHAR(36) NOT NULL,
    version_no INT NOT NULL,
    manifest_json JSON NOT NULL,
    content_hash CHAR(64) NOT NULL,
    created_by CHAR(36) NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY uq_cloud_asset_version_number (asset_id, version_no),
    KEY idx_cloud_asset_version_asset (asset_id, created_at),
    CONSTRAINT fk_cloud_asset_version_asset FOREIGN KEY (asset_id) REFERENCES cloud_asset (id) ON DELETE CASCADE,
    CONSTRAINT fk_cloud_asset_version_creator FOREIGN KEY (created_by) REFERENCES app_user (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

ALTER TABLE cloud_asset
    ADD CONSTRAINT fk_cloud_asset_current_version FOREIGN KEY (current_version_id) REFERENCES cloud_asset_version (id) ON DELETE SET NULL;

CREATE TABLE cloud_notification (
    id CHAR(36) NOT NULL,
    workspace_id CHAR(36) NOT NULL,
    recipient_user_id CHAR(36) NOT NULL,
    type VARCHAR(48) NOT NULL,
    title VARCHAR(180) NOT NULL,
    body VARCHAR(1000) NOT NULL,
    object_type VARCHAR(48) NULL,
    object_id VARCHAR(96) NULL,
    read_at DATETIME(6) NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    KEY idx_cloud_notification_recipient (recipient_user_id, read_at, created_at),
    CONSTRAINT fk_cloud_notification_workspace FOREIGN KEY (workspace_id) REFERENCES cloud_workspace (id) ON DELETE CASCADE,
    CONSTRAINT fk_cloud_notification_recipient FOREIGN KEY (recipient_user_id) REFERENCES app_user (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE cloud_audit_log (
    id BIGINT NOT NULL AUTO_INCREMENT,
    workspace_id CHAR(36) NULL,
    actor_user_id CHAR(36) NULL,
    source VARCHAR(32) NOT NULL,
    action VARCHAR(64) NOT NULL,
    object_type VARCHAR(48) NULL,
    object_id VARCHAR(96) NULL,
    result VARCHAR(24) NOT NULL,
    detail_json JSON NULL,
    request_id VARCHAR(96) NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    KEY idx_cloud_audit_workspace_time (workspace_id, created_at),
    KEY idx_cloud_audit_actor_time (actor_user_id, created_at),
    CONSTRAINT fk_cloud_audit_workspace FOREIGN KEY (workspace_id) REFERENCES cloud_workspace (id) ON DELETE SET NULL,
    CONSTRAINT fk_cloud_audit_actor FOREIGN KEY (actor_user_id) REFERENCES app_user (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE cloud_outbox_event (
    id CHAR(36) NOT NULL,
    workspace_id CHAR(36) NULL,
    event_type VARCHAR(96) NOT NULL,
    aggregate_type VARCHAR(48) NULL,
    aggregate_id VARCHAR(96) NULL,
    payload_json JSON NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'pending',
    attempts INT NOT NULL DEFAULT 0,
    available_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    processed_at DATETIME(6) NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    KEY idx_cloud_outbox_status (status, available_at),
    CONSTRAINT fk_cloud_outbox_workspace FOREIGN KEY (workspace_id) REFERENCES cloud_workspace (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Backfill one personal workspace per existing account.
INSERT INTO cloud_workspace (id, owner_user_id, name, slug, workspace_type, status)
SELECT UUID(), u.id, CONCAT(u.username, ' 的工作空间'), CONCAT('user-', u.id), 'personal', 'active'
FROM app_user u;

INSERT INTO cloud_workspace_member (workspace_id, user_id, role, status)
SELECT w.id, w.owner_user_id, 'owner', 'active'
FROM cloud_workspace w;

-- Project projections reuse existing factory IDs, so old ForgeMind URLs and
-- Agent references remain valid while Cloud gains version metadata.
INSERT INTO cloud_project (id, workspace_id, owner_user_id, name, project_type, visibility, status)
SELECT f.id, w.id, f.owner_user_id, f.name, 'factory', 'private', 'active'
FROM factory f
JOIN cloud_workspace w ON w.owner_user_id = f.owner_user_id;

INSERT INTO cloud_project_version (id, project_id, version_no, branch_name, schema_version, content_hash, save_json, note, created_by)
SELECT UUID(), f.id, 1, 'main', f.schema_version,
       SHA2(CAST(COALESCE(f.save_json, JSON_OBJECT()) AS CHAR), 256),
       COALESCE(f.save_json, JSON_OBJECT()), 'V13 compatibility projection', f.owner_user_id
FROM factory f;

UPDATE cloud_project p
JOIN cloud_project_version v ON v.project_id = p.id AND v.version_no = 1 AND v.branch_name = 'main'
SET p.current_version_id = v.id;

INSERT INTO cloud_asset (id, workspace_id, owner_user_id, external_id, kind, name, visibility, status)
SELECT UUID(), w.id, r.owner_user_id, r.resource_id, 'model3d',
       COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(r.metadata_json, '$.name')), ''), r.resource_id),
       'private', 'published'
FROM imported_resource r
JOIN cloud_workspace w ON w.owner_user_id = r.owner_user_id;

INSERT INTO cloud_asset_version (id, asset_id, version_no, manifest_json, content_hash, created_by)
SELECT UUID(), a.id, 1, r.metadata_json,
       SHA2(CAST(r.metadata_json AS CHAR), 256), r.owner_user_id
FROM imported_resource r
JOIN cloud_asset a ON a.external_id = r.resource_id
JOIN cloud_workspace w ON w.id = a.workspace_id AND w.owner_user_id = r.owner_user_id;

UPDATE cloud_asset a
JOIN cloud_asset_version v ON v.asset_id = a.id AND v.version_no = 1
SET a.current_version_id = v.id;
