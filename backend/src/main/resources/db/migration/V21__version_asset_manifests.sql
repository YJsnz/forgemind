-- Asset Cloud manifest v1 is stored as an immutable version fact.
ALTER TABLE cloud_asset_version
    ADD COLUMN manifest_version INT NOT NULL DEFAULT 1;
