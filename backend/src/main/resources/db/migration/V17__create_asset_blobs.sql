-- ForgeCloud Asset Cloud: binary metadata stays in MySQL; file bytes live in
-- the configured object-storage adapter (local development directory by default).
CREATE TABLE cloud_asset_blob (
    id CHAR(36) NOT NULL,
    asset_id CHAR(36) NOT NULL,
    asset_version_id CHAR(36) NOT NULL,
    object_key VARCHAR(220) NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    media_type VARCHAR(160) NOT NULL DEFAULT 'application/octet-stream',
    size_bytes BIGINT NOT NULL,
    content_hash CHAR(64) NOT NULL,
    storage_provider VARCHAR(24) NOT NULL DEFAULT 'local',
    status VARCHAR(24) NOT NULL DEFAULT 'available',
    created_by CHAR(36) NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY uq_cloud_asset_blob_hash (asset_version_id, content_hash),
    UNIQUE KEY uq_cloud_asset_blob_key (object_key),
    KEY idx_cloud_asset_blob_asset (asset_id, created_at),
    CONSTRAINT fk_cloud_asset_blob_asset FOREIGN KEY (asset_id) REFERENCES cloud_asset (id) ON DELETE CASCADE,
    CONSTRAINT fk_cloud_asset_blob_version FOREIGN KEY (asset_version_id) REFERENCES cloud_asset_version (id) ON DELETE CASCADE,
    CONSTRAINT fk_cloud_asset_blob_creator FOREIGN KEY (created_by) REFERENCES app_user (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
