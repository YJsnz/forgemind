-- ForgeCloud software reliability: client retries must not duplicate facts.
-- NULL keeps legacy writes compatible; a non-null key is unique per actor.
ALTER TABLE cloud_project_version
    ADD COLUMN client_mutation_id VARCHAR(120) NULL,
    ADD UNIQUE KEY uq_cloud_project_version_mutation (created_by, client_mutation_id);

ALTER TABLE cloud_task
    ADD COLUMN client_mutation_id VARCHAR(120) NULL,
    ADD UNIQUE KEY uq_cloud_task_mutation (created_by, client_mutation_id);

ALTER TABLE cloud_approval_request
    ADD COLUMN client_mutation_id VARCHAR(120) NULL,
    ADD UNIQUE KEY uq_cloud_approval_mutation (requested_by, client_mutation_id);
