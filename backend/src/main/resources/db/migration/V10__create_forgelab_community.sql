-- ForgeLab open factory community.  Content is account-aware, while the
-- author snapshot keeps historical posts readable if an account is removed.
CREATE TABLE forgelab_post (
    id VARCHAR(64) NOT NULL,
    author_user_id CHAR(36) NULL,
    author_name VARCHAR(64) NOT NULL,
    author_role VARCHAR(64) NOT NULL,
    section VARCHAR(24) NOT NULL,
    tag VARCHAR(64) NOT NULL,
    title VARCHAR(240) NOT NULL,
    summary TEXT NOT NULL,
    content LONGTEXT NULL,
    icon_key VARCHAR(48) NOT NULL DEFAULT 'archive',
    status VARCHAR(24) NOT NULL DEFAULT 'published',
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    KEY idx_forgelab_post_feed (status, section, created_at),
    KEY idx_forgelab_post_author (author_user_id, created_at),
    CONSTRAINT fk_forgelab_post_author FOREIGN KEY (author_user_id) REFERENCES app_user(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE forgelab_attachment (
    id VARCHAR(64) NOT NULL,
    post_id VARCHAR(64) NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    kind VARCHAR(16) NOT NULL,
    content_type VARCHAR(160) NOT NULL DEFAULT 'application/octet-stream',
    size_bytes BIGINT NOT NULL,
    external_url VARCHAR(500) NULL,
    file_blob LONGBLOB NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    KEY idx_forgelab_attachment_post (post_id, created_at),
    CONSTRAINT fk_forgelab_attachment_post FOREIGN KEY (post_id) REFERENCES forgelab_post(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE forgelab_reply (
    id VARCHAR(64) NOT NULL,
    post_id VARCHAR(64) NOT NULL,
    author_user_id CHAR(36) NULL,
    author_name VARCHAR(64) NOT NULL,
    author_role VARCHAR(64) NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    KEY idx_forgelab_reply_post (post_id, created_at),
    CONSTRAINT fk_forgelab_reply_post FOREIGN KEY (post_id) REFERENCES forgelab_post(id) ON DELETE CASCADE,
    CONSTRAINT fk_forgelab_reply_author FOREIGN KEY (author_user_id) REFERENCES app_user(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE forgelab_post_like (
    post_id VARCHAR(64) NOT NULL,
    user_id CHAR(36) NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (post_id, user_id),
    CONSTRAINT fk_forgelab_post_like_post FOREIGN KEY (post_id) REFERENCES forgelab_post(id) ON DELETE CASCADE,
    CONSTRAINT fk_forgelab_post_like_user FOREIGN KEY (user_id) REFERENCES app_user(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE forgelab_reply_like (
    reply_id VARCHAR(64) NOT NULL,
    user_id CHAR(36) NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (reply_id, user_id),
    CONSTRAINT fk_forgelab_reply_like_reply FOREIGN KEY (reply_id) REFERENCES forgelab_reply(id) ON DELETE CASCADE,
    CONSTRAINT fk_forgelab_reply_like_user FOREIGN KEY (user_id) REFERENCES app_user(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE forgelab_notification (
    id VARCHAR(64) NOT NULL,
    recipient_user_id CHAR(36) NOT NULL,
    actor_user_id CHAR(36) NULL,
    kind VARCHAR(16) NOT NULL,
    title VARCHAR(160) NOT NULL,
    body VARCHAR(500) NOT NULL,
    post_id VARCHAR(64) NULL,
    reply_id VARCHAR(64) NULL,
    read_at DATETIME(6) NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    KEY idx_forgelab_notification_inbox (recipient_user_id, read_at, created_at),
    CONSTRAINT fk_forgelab_notification_recipient FOREIGN KEY (recipient_user_id) REFERENCES app_user(id) ON DELETE CASCADE,
    CONSTRAINT fk_forgelab_notification_actor FOREIGN KEY (actor_user_id) REFERENCES app_user(id) ON DELETE SET NULL,
    CONSTRAINT fk_forgelab_notification_post FOREIGN KEY (post_id) REFERENCES forgelab_post(id) ON DELETE SET NULL,
    CONSTRAINT fk_forgelab_notification_reply FOREIGN KEY (reply_id) REFERENCES forgelab_reply(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
