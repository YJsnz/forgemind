-- ForgePass email OTP and federated identity bindings.
-- Email addresses are stored only as normalized identity attributes; OTP values are never stored.
CREATE TABLE auth_identity (
    id CHAR(36) NOT NULL,
    user_id CHAR(36) NOT NULL,
    provider VARCHAR(32) NOT NULL,
    provider_subject VARCHAR(320) NOT NULL,
    provider_email VARCHAR(320) NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY uq_auth_identity_provider_subject (provider, provider_subject),
    KEY idx_auth_identity_user (user_id),
    KEY idx_auth_identity_email (provider, provider_email),
    CONSTRAINT fk_auth_identity_user FOREIGN KEY (user_id) REFERENCES app_user(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE auth_email_otp (
    id CHAR(36) NOT NULL,
    email_hash CHAR(64) NOT NULL,
    purpose VARCHAR(24) NOT NULL,
    code_hash CHAR(64) NOT NULL,
    expires_at DATETIME(6) NOT NULL,
    attempts INT NOT NULL DEFAULT 0,
    consumed_at DATETIME(6) NULL,
    request_ip_hash CHAR(64) NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    KEY idx_email_otp_email_created (email_hash, purpose, created_at),
    KEY idx_email_otp_ip_created (request_ip_hash, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE auth_oauth_exchange (
    code_hash CHAR(64) NOT NULL,
    user_id CHAR(36) NOT NULL,
    expires_at DATETIME(6) NOT NULL,
    consumed_at DATETIME(6) NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (code_hash),
    KEY idx_oauth_exchange_expiry (expires_at),
    CONSTRAINT fk_oauth_exchange_user FOREIGN KEY (user_id) REFERENCES app_user(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
