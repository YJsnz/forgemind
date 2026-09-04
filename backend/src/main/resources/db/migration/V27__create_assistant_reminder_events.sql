-- Cross-session reminder dedupe state. This is notification metadata only;
-- it never becomes a source for factory metrics or equipment state.
CREATE TABLE assistant_reminder_event (
  owner_user_id CHAR(36) NOT NULL,
  dedupe_key VARCHAR(180) NOT NULL,
  severity VARCHAR(16) NOT NULL,
  last_emitted_at DATETIME(6) NOT NULL,
  resolved_at DATETIME(6) NULL,
  last_message VARCHAR(1000) NOT NULL,
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (owner_user_id, dedupe_key),
  KEY idx_assistant_event_owner_updated(owner_user_id, updated_at),
  CONSTRAINT fk_assistant_event_owner FOREIGN KEY (owner_user_id) REFERENCES app_user(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
