package com.forgemind.repository;

import com.forgemind.model.User;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.Optional;

@Repository
public class EmailAuthRepository {
    private final JdbcTemplate jdbc;

    public EmailAuthRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Optional<String> findUserIdByIdentity(String provider, String subject) {
        return jdbc.query(
                "SELECT user_id FROM auth_identity WHERE provider = ? AND provider_subject = ?",
                (rs, rowNum) -> rs.getString("user_id"), provider, subject
        ).stream().findFirst();
    }

    public Optional<String> findUserIdByProviderEmail(String provider, String email) {
        return jdbc.query(
                "SELECT user_id FROM auth_identity WHERE provider = ? AND provider_email = ?",
                (rs, rowNum) -> rs.getString("user_id"), provider, email
        ).stream().findFirst();
    }

    public void saveIdentity(String id, String userId, String provider, String subject, String email) {
        jdbc.update(
                "INSERT INTO auth_identity (id, user_id, provider, provider_subject, provider_email) VALUES (?, ?, ?, ?, ?)",
                id, userId, provider, subject, email
        );
    }

    public int countEmailRequests(String emailHash, String purpose, Instant since) {
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM auth_email_otp WHERE email_hash = ? AND purpose = ? AND created_at >= ?",
                Integer.class, emailHash, purpose, Timestamp.from(since)
        );
        return count == null ? 0 : count;
    }

    public int countIpRequests(String ipHash, Instant since) {
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM auth_email_otp WHERE request_ip_hash = ? AND created_at >= ?",
                Integer.class, ipHash, Timestamp.from(since)
        );
        return count == null ? 0 : count;
    }

    public void saveChallenge(String id, String emailHash, String purpose, String codeHash,
                              Instant expiresAt, String requestIpHash) {
        jdbc.update(
                "INSERT INTO auth_email_otp (id, email_hash, purpose, code_hash, expires_at, request_ip_hash) VALUES (?, ?, ?, ?, ?, ?)",
                id, emailHash, purpose, codeHash, Timestamp.from(expiresAt), requestIpHash
        );
    }

    public Optional<Challenge> findLatestActive(String emailHash, String purpose, Instant now) {
        return jdbc.query(
                "SELECT id, code_hash, expires_at, attempts FROM auth_email_otp " +
                        "WHERE email_hash = ? AND purpose = ? AND consumed_at IS NULL AND expires_at > ? " +
                        "ORDER BY created_at DESC LIMIT 1",
                (rs, rowNum) -> new Challenge(
                        rs.getString("id"), rs.getString("code_hash"),
                        rs.getTimestamp("expires_at").toInstant(), rs.getInt("attempts")
                ), emailHash, purpose, Timestamp.from(now)
        ).stream().findFirst();
    }

    public void incrementAttempts(String id) {
        jdbc.update("UPDATE auth_email_otp SET attempts = attempts + 1 WHERE id = ? AND consumed_at IS NULL", id);
    }

    public void consume(String id) {
        jdbc.update("UPDATE auth_email_otp SET consumed_at = CURRENT_TIMESTAMP(6) WHERE id = ? AND consumed_at IS NULL", id);
    }

    public void saveExchange(String codeHash, String userId, Instant expiresAt) {
        jdbc.update(
                "INSERT INTO auth_oauth_exchange (code_hash, user_id, expires_at) VALUES (?, ?, ?)",
                codeHash, userId, Timestamp.from(expiresAt)
        );
    }

    public Optional<String> consumeExchange(String codeHash, Instant now) {
        int updated = jdbc.update(
                "UPDATE auth_oauth_exchange SET consumed_at = CURRENT_TIMESTAMP(6) " +
                        "WHERE code_hash = ? AND consumed_at IS NULL AND expires_at > ?",
                codeHash, Timestamp.from(now)
        );
        if (updated == 0) return Optional.empty();
        return jdbc.query(
                "SELECT user_id FROM auth_oauth_exchange WHERE code_hash = ?",
                (rs, rowNum) -> rs.getString("user_id"), codeHash
        ).stream().findFirst();
    }

    public record Challenge(String id, String codeHash, Instant expiresAt, int attempts) {}
}
