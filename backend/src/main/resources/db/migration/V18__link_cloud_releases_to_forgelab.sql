-- Cross-product publication links keep ForgeLab posts attached to immutable
-- ForgeCloud project releases or asset versions.
CREATE TABLE cloud_forge_lab_publication (
    id CHAR(36) NOT NULL,
    workspace_id CHAR(36) NOT NULL,
    source_type VARCHAR(32) NOT NULL,
    source_id CHAR(36) NOT NULL,
    source_version_id CHAR(36) NULL,
    forge_lab_post_id VARCHAR(64) NOT NULL,
    license_snapshot_json JSON NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'active',
    created_by CHAR(36) NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY uq_cloud_forge_lab_publication (source_type, source_id, forge_lab_post_id),
    KEY idx_cloud_forge_lab_publication_workspace (workspace_id, created_at),
    CONSTRAINT fk_cloud_forge_lab_publication_workspace FOREIGN KEY (workspace_id) REFERENCES cloud_workspace (id) ON DELETE CASCADE,
    CONSTRAINT fk_cloud_forge_lab_publication_creator FOREIGN KEY (created_by) REFERENCES app_user (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
