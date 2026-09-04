-- Workspace-scoped human-authored RAG entries. Runtime factory facts stay out of this table.
CREATE TABLE assistant_knowledge_document (
  id CHAR(36) NOT NULL,
  workspace_id CHAR(36) NOT NULL,
  created_by CHAR(36) NOT NULL,
  title VARCHAR(180) NOT NULL,
  category VARCHAR(32) NOT NULL DEFAULT 'custom',
  source VARCHAR(180) NULL,
  content TEXT NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY idx_assistant_knowledge_workspace_status (workspace_id, status, updated_at),
  CONSTRAINT fk_assistant_knowledge_workspace FOREIGN KEY (workspace_id) REFERENCES cloud_workspace(id) ON DELETE CASCADE,
  CONSTRAINT fk_assistant_knowledge_creator FOREIGN KEY (created_by) REFERENCES app_user(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
