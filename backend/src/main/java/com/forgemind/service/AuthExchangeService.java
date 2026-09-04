package com.forgemind.service;

import com.forgemind.model.User;
import com.forgemind.repository.DbUserRepository;
import com.forgemind.repository.EmailAuthRepository;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.HexFormat;
import java.util.UUID;

@Service
public class AuthExchangeService {
    private static final Duration CODE_TTL = Duration.ofMinutes(2);
    private static final SecureRandom RANDOM = new SecureRandom();

    private final EmailAuthRepository identities;
    private final DbUserRepository users;
    private final String pepper;

    public AuthExchangeService(EmailAuthRepository identities, DbUserRepository users,
                               @Value("${forgemind.auth.otp-pepper:change-me-in-production}") String pepper) {
        this.identities = identities;
        this.users = users;
        this.pepper = pepper == null ? "" : pepper;
    }

    public String create(User user) {
        if (pepper.isBlank() || "change-me-in-production".equals(pepper)) {
            throw new IllegalStateException("请先设置随机的 FORGEMIND_AUTH_OTP_PEPPER");
        }
        String code = UUID.randomUUID() + "-" + UUID.randomUUID() + "-" + RANDOM.nextInt(1_000_000);
        identities.saveExchange(digest(code), user.id(), Instant.now().plus(CODE_TTL));
        return code;
    }

    public User consume(String rawCode) {
        String code = rawCode == null ? "" : rawCode.trim();
        if (code.length() < 32 || code.length() > 128) throw new IllegalArgumentException("登录兑换码无效");
        String userId = identities.consumeExchange(digest(code), Instant.now())
                .orElseThrow(() -> new IllegalArgumentException("登录兑换码无效或已过期"));
        return users.findById(userId).orElseThrow(() -> new IllegalArgumentException("用户不存在"));
    }

    private String digest(String value) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(pepper.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            return HexFormat.of().formatHex(mac.doFinal(value.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            throw new IllegalStateException("认证兑换码摘要不可用", e);
        }
    }
}
