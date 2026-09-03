ALTER TABLE cloud_asset_version
    ADD COLUMN note VARCHAR(500) NULL,
    ADD COLUMN client_mutation_id VARCHAR(120) NULL,
    ADD UNIQUE KEY uq_cloud_asset_version_mutation (created_by, client_mutation_id);
