-- ForgeCloud Industrial Intelligence Cloud foundation:
-- Device Cloud, Twin Cloud, Data Cloud and AI Cloud runtime records.

CREATE TABLE cloud_device (
    id CHAR(36) NOT NULL,
    workspace_id CHAR(36) NOT NULL,
    device_key VARCHAR(120) NOT NULL,
    name VARCHAR(160) NOT NULL,
    device_type VARCHAR(48) NOT NULL DEFAULT 'generic',
    endpoint VARCHAR(500) NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'registered',
    last_seen_at DATETIME(6) NULL,
    metadata_json JSON NOT NULL,
    created_by CHAR(36) NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY uq_cloud_device_workspace_key (workspace_id, device_key),
    KEY idx_cloud_device_workspace_status (workspace_id, status, updated_at),
    CONSTRAINT fk_cloud_device_workspace FOREIGN KEY (workspace_id) REFERENCES cloud_workspace (id) ON DELETE CASCADE,
    CONSTRAINT fk_cloud_device_creator FOREIGN KEY (created_by) REFERENCES app_user (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE cloud_device_command (
    id CHAR(36) NOT NULL,
    workspace_id CHAR(36) NOT NULL,
    device_id CHAR(36) NOT NULL,
    command_type VARCHAR(64) NOT NULL,
    command_json JSON NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'pending',
    result_json JSON NULL,
    error_text VARCHAR(1000) NULL,
    requested_by CHAR(36) NOT NULL,
    requested_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    completed_at DATETIME(6) NULL,
    PRIMARY KEY (id),
    KEY idx_cloud_device_command_device (device_id, requested_at),
    KEY idx_cloud_device_command_workspace (workspace_id, status, requested_at),
    CONSTRAINT fk_cloud_device_command_workspace FOREIGN KEY (workspace_id) REFERENCES cloud_workspace (id) ON DELETE CASCADE,
    CONSTRAINT fk_cloud_device_command_device FOREIGN KEY (device_id) REFERENCES cloud_device (id) ON DELETE CASCADE,
    CONSTRAINT fk_cloud_device_command_requester FOREIGN KEY (requested_by) REFERENCES app_user (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE cloud_twin (
    id CHAR(36) NOT NULL,
    workspace_id CHAR(36) NOT NULL,
    twin_key VARCHAR(120) NOT NULL,
    name VARCHAR(160) NOT NULL,
    twin_type VARCHAR(48) NOT NULL DEFAULT 'device',
    source_device_id CHAR(36) NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'active',
    state_json JSON NOT NULL,
    quality VARCHAR(24) NOT NULL DEFAULT 'unknown',
    last_state_at DATETIME(6) NULL,
    created_by CHAR(36) NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY uq_cloud_twin_workspace_key (workspace_id, twin_key),
    KEY idx_cloud_twin_workspace_status (workspace_id, status, updated_at),
    CONSTRAINT fk_cloud_twin_workspace FOREIGN KEY (workspace_id) REFERENCES cloud_workspace (id) ON DELETE CASCADE,
    CONSTRAINT fk_cloud_twin_device FOREIGN KEY (source_device_id) REFERENCES cloud_device (id) ON DELETE SET NULL,
    CONSTRAINT fk_cloud_twin_creator FOREIGN KEY (created_by) REFERENCES app_user (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE cloud_data_point (
    id CHAR(36) NOT NULL,
    workspace_id CHAR(36) NOT NULL,
    device_id CHAR(36) NULL,
    twin_id CHAR(36) NULL,
    point_key VARCHAR(160) NOT NULL,
    label VARCHAR(160) NOT NULL,
    data_type VARCHAR(32) NOT NULL DEFAULT 'number',
    unit VARCHAR(32) NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'active',
    created_by CHAR(36) NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY uq_cloud_data_point_scope_key (workspace_id, point_key),
    KEY idx_cloud_data_point_device (device_id, status),
    KEY idx_cloud_data_point_twin (twin_id, status),
    CONSTRAINT fk_cloud_data_point_workspace FOREIGN KEY (workspace_id) REFERENCES cloud_workspace (id) ON DELETE CASCADE,
    CONSTRAINT fk_cloud_data_point_device FOREIGN KEY (device_id) REFERENCES cloud_device (id) ON DELETE SET NULL,
    CONSTRAINT fk_cloud_data_point_twin FOREIGN KEY (twin_id) REFERENCES cloud_twin (id) ON DELETE SET NULL,
    CONSTRAINT fk_cloud_data_point_creator FOREIGN KEY (created_by) REFERENCES app_user (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE cloud_data_event (
    id BIGINT NOT NULL AUTO_INCREMENT,
    workspace_id CHAR(36) NOT NULL,
    device_id CHAR(36) NULL,
    twin_id CHAR(36) NULL,
    point_id CHAR(36) NULL,
    event_type VARCHAR(48) NOT NULL DEFAULT 'telemetry',
    quality VARCHAR(24) NOT NULL DEFAULT 'unknown',
    value_json JSON NOT NULL,
    occurred_at DATETIME(6) NOT NULL,
    received_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    KEY idx_cloud_data_event_workspace_time (workspace_id, occurred_at),
    KEY idx_cloud_data_event_point_time (point_id, occurred_at),
    CONSTRAINT fk_cloud_data_event_workspace FOREIGN KEY (workspace_id) REFERENCES cloud_workspace (id) ON DELETE CASCADE,
    CONSTRAINT fk_cloud_data_event_device FOREIGN KEY (device_id) REFERENCES cloud_device (id) ON DELETE SET NULL,
    CONSTRAINT fk_cloud_data_event_twin FOREIGN KEY (twin_id) REFERENCES cloud_twin (id) ON DELETE SET NULL,
    CONSTRAINT fk_cloud_data_event_point FOREIGN KEY (point_id) REFERENCES cloud_data_point (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE cloud_ai_model (
    id CHAR(36) NOT NULL,
    workspace_id CHAR(36) NULL,
    name VARCHAR(160) NOT NULL,
    provider VARCHAR(48) NOT NULL,
    model_key VARCHAR(160) NOT NULL,
    model_type VARCHAR(32) NOT NULL DEFAULT 'agent',
    status VARCHAR(24) NOT NULL DEFAULT 'active',
    config_json JSON NOT NULL,
    created_by CHAR(36) NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY uq_cloud_ai_model_scope_key (workspace_id, model_key),
    KEY idx_cloud_ai_model_workspace_status (workspace_id, status),
    CONSTRAINT fk_cloud_ai_model_workspace FOREIGN KEY (workspace_id) REFERENCES cloud_workspace (id) ON DELETE CASCADE,
    CONSTRAINT fk_cloud_ai_model_creator FOREIGN KEY (created_by) REFERENCES app_user (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO cloud_ai_model (id, workspace_id, name, provider, model_key, model_type, status, config_json)
VALUES ('00000000-0000-0000-0000-000000000001', NULL, '确定性规则引擎', 'rule', 'rule', 'agent', 'active', JSON_OBJECT('localModelRequired', FALSE, 'safeByDefault', TRUE))
ON DUPLICATE KEY UPDATE name = VALUES(name), status = VALUES(status);

CREATE TABLE cloud_ai_task (
    id CHAR(36) NOT NULL,
    workspace_id CHAR(36) NOT NULL,
    project_id CHAR(36) NULL,
    model_id CHAR(36) NULL,
    task_type VARCHAR(64) NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'queued',
    input_json JSON NOT NULL,
    output_json JSON NULL,
    error_text VARCHAR(2000) NULL,
    requested_by CHAR(36) NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    started_at DATETIME(6) NULL,
    completed_at DATETIME(6) NULL,
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    KEY idx_cloud_ai_task_workspace (workspace_id, status, updated_at),
    KEY idx_cloud_ai_task_project (project_id, created_at),
    CONSTRAINT fk_cloud_ai_task_workspace FOREIGN KEY (workspace_id) REFERENCES cloud_workspace (id) ON DELETE CASCADE,
    CONSTRAINT fk_cloud_ai_task_project FOREIGN KEY (project_id) REFERENCES cloud_project (id) ON DELETE SET NULL,
    CONSTRAINT fk_cloud_ai_task_model FOREIGN KEY (model_id) REFERENCES cloud_ai_model (id) ON DELETE SET NULL,
    CONSTRAINT fk_cloud_ai_task_requester FOREIGN KEY (requested_by) REFERENCES app_user (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
