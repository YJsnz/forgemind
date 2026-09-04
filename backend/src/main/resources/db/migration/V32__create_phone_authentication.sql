-- ForgePass phone OTP authentication. Raw phone numbers and OTP values are never stored.
ALTER TABLE app_user MODIFY password_hash VARCHAR(100) NULL;

CREATE TABLE user_phone (
    user_id CHAR(36) NOT NULL,
    phone_e164 VARCHAR(20) NOT NULL,
    verified_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (user_id),
    UNIQUE KEY uq_user_phone_number (phone_e164),
    CONSTRAINT fk_user_phone_user FOREIGN KEY (user_id) REFERENCES app_user(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE auth_phone_otp (
    id CHAR(36) NOT NULL,
    phone_hash CHAR(64) NOT NULL,
    purpose VARCHAR(24) NOT NULL,
    code_hash CHAR(64) NOT NULL,
    expires_at DATETIME(6) NOT NULL,
    attempts INT NOT NULL DEFAULT 0,
    consumed_at DATETIME(6) NULL,
    request_ip_hash CHAR(64) NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    KEY idx_phone_otp_phone_created (phone_hash, purpose, created_at),
    KEY idx_phone_otp_ip_created (request_ip_hash, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
