package com.forgemind.service;

import com.forgemind.model.User;
import com.forgemind.repository.DbUserRepository;
import com.forgemind.repository.EmailAuthRepository;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.HexFormat;
import java.util.UUID;

@Service
public class EmailAuthService {
    private static final String LOGIN_PURPOSE = "login";
    private static final Duration CODE_TTL = Duration.ofMinutes(5);
    private static final SecureRandom RANDOM = new SecureRandom();

    private final EmailAuthRepository emails;
    private final DbUserRepository users;
    private final AuthService auth;
    private final EmailDeliveryService delivery;
    private final String pepper;

    public EmailAuthService(EmailAuthRepository emails, DbUserRepository users, AuthService auth,
                            EmailDeliveryService delivery,
                            @Value("${forgemind.auth.otp-pepper:change-me-in-production}") String pepper) {
        this.emails = emails;
        this.users = users;
        this.auth = auth;
        this.delivery = delivery;
        this.pepper = pepper == null ? "" : pepper;
    }

    public SendCodeResult sendCode(String rawEmail, String requestIp) {
        String email = normalizeEmail(rawEmail);
        if (!delivery.isConfigured()) {
            throw new IllegalStateException("邮箱验证码尚未配置，请设置 SMTP 开关、服务器、账号、授权码和发件地址");
        }
        if (pepper.isBlank() || "change-me-in-production".equals(pepper)) {
            throw new IllegalStateException("请先设置随机的 FORGEMIND_AUTH_OTP_PEPPER");
        }
        String emailHash = digest("email:" + email);
        String ipHash = digest("ip:" + (requestIp == null ? "unknown" : requestIp));
        Instant now = Instant.now();
        if (emails.countEmailRequests(emailHash, LOGIN_PURPOSE, now.minusSeconds(60)) > 0) {
            throw new AuthRateLimitException("验证码发送过于频繁，请 60 秒后再试");
        }
        if (emails.countIpRequests(ipHash, now.minus(Duration.ofMinutes(10))) >= 20) {
            throw new AuthRateLimitException("当前请求过于频繁，请稍后再试");
        }
        String code = String.format("%06d", RANDOM.nextInt(1_000_000));
        String challengeId = UUID.randomUUID().toString();
        emails.saveChallenge(challengeId, emailHash, LOGIN_PURPOSE, digest("code:" + code), now.plus(CODE_TTL), ipHash);
        try {
            delivery.sendVerificationCode(email, code);
        } catch (RuntimeException e) {
            emails.consume(challengeId);
            throw e;
        }
        return new SendCodeResult("sent", 60);
    }

    public AuthService.AuthResult login(String rawEmail, String rawCode) {
        String email = normalizeEmail(rawEmail);
        verifyCode(email, rawCode);
        User user = emails.findUserIdByIdentity("email", email)
                .flatMap(users::findById)
                .orElseGet(() -> createEmailUser(email));
        return auth.loginWithVerifiedIdentity(user);
    }

    public User linkEmailIdentity(User user, String email) {
        try {
            emails.saveIdentity(UUID.randomUUID().toString(), user.id(), "email", email, email);
            return user;
        } catch (DuplicateKeyException e) {
            return emails.findUserIdByIdentity("email", email).flatMap(users::findById)
                    .orElseThrow(() -> new IllegalArgumentException("该邮箱已绑定其他 ForgePass 账户", e));
        }
    }

    public static String normalizeEmail(String rawEmail) {
        String email = rawEmail == null ? "" : rawEmail.trim().toLowerCase();
        if (email.length() > 320 || !email.matches("^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$")) {
            throw new IllegalArgumentException("请输入有效的邮箱地址");
        }
        return email;
    }

    private User createEmailUser(String email) {
        User user = auth.createEmailUser();
        try {
            emails.saveIdentity(UUID.randomUUID().toString(), user.id(), "email", email, email);
            return user;
        } catch (DuplicateKeyException e) {
            return emails.findUserIdByIdentity("email", email).flatMap(users::findById)
                    .orElseThrow(() -> new IllegalStateException("邮箱账户创建失败", e));
        }
    }

    private void verifyCode(String email, String rawCode) {
        String code = rawCode == null ? "" : rawCode.trim();
        if (!code.matches("\\d{6}")) throw new IllegalArgumentException("验证码必须是 6 位数字");
        EmailAuthRepository.Challenge challenge = emails.findLatestActive(digest("email:" + email), LOGIN_PURPOSE, Instant.now())
                .orElseThrow(() -> new IllegalArgumentException("验证码不存在或已过期"));
        if (challenge.attempts() >= 5) throw new IllegalArgumentException("验证码错误次数过多，请重新获取");
        if (!MessageDigest.isEqual(challenge.codeHash().getBytes(StandardCharsets.US_ASCII), digest("code:" + code).getBytes(StandardCharsets.US_ASCII))) {
            emails.incrementAttempts(challenge.id());
            throw new IllegalArgumentException("验证码错误");
        }
        emails.consume(challenge.id());
    }

    private String digest(String value) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(pepper.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            return HexFormat.of().formatHex(mac.doFinal(value.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            throw new IllegalStateException("验证码摘要不可用", e);
        }
    }

    public record SendCodeResult(String status, int cooldownSeconds) {}
}
