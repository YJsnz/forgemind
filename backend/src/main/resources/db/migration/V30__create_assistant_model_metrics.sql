-- Aggregate assistant service-quality metrics; no factory facts are stored here.
CREATE TABLE assistant_model_metric (
  owner_user_id CHAR(36) NOT NULL,
  observed_day DATE NOT NULL,
  provider VARCHAR(24) NOT NULL,
  sample_count INT NOT NULL DEFAULT 0,
  first_token_ms_sum BIGINT NOT NULL DEFAULT 0,
  complete_ms_sum BIGINT NOT NULL DEFAULT 0,
  tool_call_count INT NOT NULL DEFAULT 0,
  tool_success_count INT NOT NULL DEFAULT 0,
  fallback_count INT NOT NULL DEFAULT 0,
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (owner_user_id, observed_day, provider),
  KEY idx_assistant_metric_owner_day(owner_user_id, observed_day),
  CONSTRAINT fk_assistant_metric_owner FOREIGN KEY (owner_user_id) REFERENCES app_user(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
