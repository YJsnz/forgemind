-- ForgeCore Agent durable runtime adapted to ForgeMind MySQL projects.
CREATE TABLE agent_run (
  id VARCHAR(64) PRIMARY KEY,
  owner_user_id CHAR(36) NOT NULL,
  factory_id VARCHAR(64) NOT NULL,
  objective TEXT NOT NULL,
  mode VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'created',
  provider VARCHAR(64) NOT NULL DEFAULT 'deterministic',
  llm_configured BOOLEAN NOT NULL DEFAULT FALSE,
  base_version VARCHAR(64) NOT NULL,
  context_json JSON NOT NULL,
  compiled_goal JSON NULL,
  result_json JSON NULL,
  summary TEXT NOT NULL,
  error_text TEXT NULL,
  tool_call_budget INT NOT NULL DEFAULT 24,
  tool_timeout_ms INT NOT NULL DEFAULT 5000,
  tool_retry_limit INT NOT NULL DEFAULT 1,
  tool_calls_used INT NOT NULL DEFAULT 0,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  completed_at DATETIME(6) NULL,
  KEY idx_agent_run_owner_factory(owner_user_id,factory_id,created_at),
  CONSTRAINT fk_agent_run_owner FOREIGN KEY(owner_user_id) REFERENCES app_user(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE agent_step (
  id VARCHAR(64) PRIMARY KEY, run_id VARCHAR(64) NOT NULL, position INT NOT NULL,
  step_key VARCHAR(64) NOT NULL, title VARCHAR(128) NOT NULL, status VARCHAR(24) NOT NULL,
  detail_text TEXT NOT NULL, started_at DATETIME(6) NULL, completed_at DATETIME(6) NULL,
  UNIQUE KEY uq_agent_step_position(run_id,position),
  CONSTRAINT fk_agent_step_run FOREIGN KEY(run_id) REFERENCES agent_run(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE agent_tool_call (
  id VARCHAR(64) PRIMARY KEY, run_id VARCHAR(64) NOT NULL, step_id VARCHAR(64) NULL,
  tool_name VARCHAR(96) NOT NULL, status VARCHAR(24) NOT NULL, attempt INT NOT NULL DEFAULT 1,
  input_json JSON NOT NULL, output_json JSON NOT NULL, error_text TEXT NULL, duration_ms INT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), completed_at DATETIME(6) NULL,
  KEY idx_agent_tool_run(run_id,created_at),
  CONSTRAINT fk_agent_tool_run FOREIGN KEY(run_id) REFERENCES agent_run(id) ON DELETE CASCADE,
  CONSTRAINT fk_agent_tool_step FOREIGN KEY(step_id) REFERENCES agent_step(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE agent_run_event (
  id VARCHAR(64) PRIMARY KEY, run_id VARCHAR(64) NOT NULL, sequence_no INT NOT NULL,
  event_name VARCHAR(64) NOT NULL, data_json JSON NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_agent_event_sequence(run_id,sequence_no),
  CONSTRAINT fk_agent_event_run FOREIGN KEY(run_id) REFERENCES agent_run(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE agent_patch (
  id VARCHAR(64) PRIMARY KEY, run_id VARCHAR(64) NOT NULL, factory_id VARCHAR(64) NOT NULL,
  owner_user_id CHAR(36) NOT NULL, base_version VARCHAR(64) NOT NULL, status VARCHAR(32) NOT NULL,
  risk_level VARCHAR(16) NOT NULL, idempotency_key VARCHAR(128) NOT NULL,
  operations_json JSON NOT NULL, inverse_operations_json JSON NOT NULL, preconditions_json JSON NOT NULL,
  impact_json JSON NOT NULL, validation_json JSON NOT NULL, diff_summary_json JSON NOT NULL,
  backup_save_json JSON NULL, applied_save_json JSON NULL, error_text TEXT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  decided_at DATETIME(6) NULL, applied_at DATETIME(6) NULL,
  UNIQUE KEY uq_agent_patch_idempotency(idempotency_key), KEY idx_agent_patch_run(run_id,created_at),
  CONSTRAINT fk_agent_patch_run FOREIGN KEY(run_id) REFERENCES agent_run(id) ON DELETE CASCADE,
  CONSTRAINT fk_agent_patch_owner FOREIGN KEY(owner_user_id) REFERENCES app_user(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE agent_approval (
  id VARCHAR(64) PRIMARY KEY, patch_id VARCHAR(64) NOT NULL, run_id VARCHAR(64) NOT NULL,
  owner_user_id CHAR(36) NOT NULL, status VARCHAR(24) NOT NULL, summary TEXT NOT NULL,
  risk_level VARCHAR(16) NOT NULL, decision_note TEXT NULL, decided_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_agent_approval_patch FOREIGN KEY(patch_id) REFERENCES agent_patch(id) ON DELETE CASCADE,
  CONSTRAINT fk_agent_approval_run FOREIGN KEY(run_id) REFERENCES agent_run(id) ON DELETE CASCADE,
  CONSTRAINT fk_agent_approval_owner FOREIGN KEY(owner_user_id) REFERENCES app_user(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
