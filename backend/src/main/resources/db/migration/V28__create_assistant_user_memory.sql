-- User-approved long-term BT memory. It stores preferences only;
-- live factory facts remain in their authoritative project/runtime stores.
CREATE TABLE assistant_user_memory (
  owner_user_id CHAR(36) NOT NULL,
  memory_key VARCHAR(80) NOT NULL,
  memory_value VARCHAR(400) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (owner_user_id, memory_key),
  KEY idx_assistant_memory_owner_updated(owner_user_id, updated_at),
  CONSTRAINT fk_assistant_memory_owner FOREIGN KEY (owner_user_id) REFERENCES app_user(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
