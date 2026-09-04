-- User-scoped BT reminder policy. It stores notification preferences only;
-- factory facts and runtime metrics remain in their authoritative stores.
CREATE TABLE assistant_reminder_policy (
  owner_user_id CHAR(36) PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  min_severity VARCHAR(16) NOT NULL DEFAULT 'warning',
  cooldown_minutes INT NOT NULL DEFAULT 10,
  quiet_start VARCHAR(5) NULL,
  quiet_end VARCHAR(5) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_assistant_policy_owner FOREIGN KEY (owner_user_id) REFERENCES app_user(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
