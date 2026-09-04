package com.forgemind.repository;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.Optional;

@Repository
public class PhoneAuthRepository {
    private final JdbcTemplate jdbc;

    public PhoneAuthRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Optional<String> findUserIdByPhone(String phone) {
        return jdbc.query(
                "SELECT user_id FROM user_phone WHERE phone_e164 = ?",
                (rs, rowNum) -> rs.getString("user_id"), phone
        ).stream().findFirst();
    }

    public void bindPhone(String userId, String phone) {
        jdbc.update("INSERT INTO user_phone (user_id, phone_e164) VALUES (?, ?)", userId, phone);
    }

    public int countPhoneRequests(String phoneHash, String purpose, Instant since) {
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM auth_phone_otp WHERE phone_hash = ? AND purpose = ? AND created_at >= ?",
                Integer.class, phoneHash, purpose, Timestamp.from(since)
        );
        return count == null ? 0 : count;
    }

    public int countIpRequests(String ipHash, Instant since) {
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM auth_phone_otp WHERE request_ip_hash = ? AND created_at >= ?",
                Integer.class, ipHash, Timestamp.from(since)
        );
        return count == null ? 0 : count;
    }

    public void saveChallenge(String id, String phoneHash, String purpose, String codeHash,
                              Instant expiresAt, String requestIpHash) {
        jdbc.update(
                "INSERT INTO auth_phone_otp (id, phone_hash, purpose, code_hash, expires_at, request_ip_hash) VALUES (?, ?, ?, ?, ?, ?)",
                id, phoneHash, purpose, codeHash, Timestamp.from(expiresAt), requestIpHash
        );
    }

    public Optional<Challenge> findLatestActive(String phoneHash, String purpose, Instant now) {
        return jdbc.query(
                "SELECT id, code_hash, expires_at, attempts FROM auth_phone_otp " +
                        "WHERE phone_hash = ? AND purpose = ? AND consumed_at IS NULL AND expires_at > ? " +
                        "ORDER BY created_at DESC LIMIT 1",
                (rs, rowNum) -> new Challenge(
                        rs.getString("id"), rs.getString("code_hash"),
                        rs.getTimestamp("expires_at").toInstant(), rs.getInt("attempts")
                ), phoneHash, purpose, Timestamp.from(now)
        ).stream().findFirst();
    }

    public void incrementAttempts(String id) {
        jdbc.update("UPDATE auth_phone_otp SET attempts = attempts + 1 WHERE id = ? AND consumed_at IS NULL", id);
    }

    public void consume(String id) {
        jdbc.update("UPDATE auth_phone_otp SET consumed_at = CURRENT_TIMESTAMP(6) WHERE id = ? AND consumed_at IS NULL", id);
    }

    public record Challenge(String id, String codeHash, Instant expiresAt, int attempts) {}
}
