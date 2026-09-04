package com.forgemind.service;

import com.forgemind.model.User;
import com.forgemind.repository.DbUserRepository;
import com.forgemind.repository.PhoneAuthRepository;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.HexFormat;
import java.util.Optional;
import java.util.UUID;

@Service
public class PhoneAuthService {
    private static final String LOGIN_PURPOSE = "login";
    private static final String BIND_PURPOSE = "bind";
    private static final Duration CODE_TTL = Duration.ofMinutes(5);
    private static final SecureRandom RANDOM = new SecureRandom();

    private final PhoneAuthRepository phones;
    private final DbUserRepository users;
    private final AuthService auth;
    private final TencentCloudSmsService sms;
    private final String pepper;

    public PhoneAuthService(PhoneAuthRepository phones, DbUserRepository users, AuthService auth,
                            TencentCloudSmsService sms,
                            @Value("${forgemind.auth.otp-pepper:change-me-in-production}") String pepper) {
        this.phones = phones;
        this.users = users;
        this.auth = auth;
        this.sms = sms;
        this.pepper = pepper == null ? "" : pepper;
    }

    public SendCodeResult sendCode(String rawPhone, String purpose, String requestIp) {
        String phone = normalizePhone(rawPhone);
        String safePurpose = normalizePurpose(purpose);
        if (!sms.isConfigured()) {
            throw new IllegalStateException("腾讯云短信尚未配置，请设置短信开关、密钥、SDK AppID、签名和模板 ID");
        }
        if (pepper.isBlank() || "change-me-in-production".equals(pepper)) {
            throw new IllegalStateException("请先设置随机的 FORGEMIND_AUTH_OTP_PEPPER");
        }
        String phoneHash = digest("phone:" + phone);
        String ipHash = digest("ip:" + (requestIp == null ? "unknown" : requestIp));
        Instant now = Instant.now();
        if (phones.countPhoneRequests(phoneHash, safePurpose, now.minusSeconds(60)) > 0) {
            throw new AuthRateLimitException("验证码发送过于频繁，请 60 秒后再试");
        }
        if (phones.countIpRequests(ipHash, now.minus(Duration.ofMinutes(10))) >= 20) {
            throw new AuthRateLimitException("当前请求过于频繁，请稍后再试");
        }
        String code = String.format("%06d", RANDOM.nextInt(1_000_000));
        String challengeId = UUID.randomUUID().toString();
        phones.saveChallenge(challengeId, phoneHash, safePurpose, digest("code:" + code), now.plus(CODE_TTL), ipHash);
        try {
            sms.sendVerificationCode(phone, code);
        } catch (RuntimeException e) {
            // Do not leave a valid challenge behind when the provider rejected the request.
            phones.consume(challengeId);
            throw e;
        }
        return new SendCodeResult("sent", 60);
    }

    public AuthService.AuthResult login(String rawPhone, String code) {
        String phone = normalizePhone(rawPhone);
        verifyCode(phone, LOGIN_PURPOSE, code);
        User user = phones.findUserIdByPhone(phone)
                .flatMap(users::findById)
                .orElseGet(() -> createPhoneUser(phone));
        return auth.loginWithVerifiedIdentity(user);
    }

    public void bind(String rawPhone, String code, User currentUser) {
        String phone = normalizePhone(rawPhone);
        verifyCode(phone, BIND_PURPOSE, code);
        Optional<String> owner = phones.findUserIdByPhone(phone);
        if (owner.isPresent() && !owner.get().equals(currentUser.id())) {
            throw new IllegalArgumentException("该手机号已绑定其他 ForgePass 账户");
        }
        if (owner.isEmpty()) {
            try {
                phones.bindPhone(currentUser.id(), phone);
            } catch (DuplicateKeyException e) {
                throw new IllegalArgumentException("该手机号已绑定其他 ForgePass 账户", e);
            }
        }
    }

    private User createPhoneUser(String phone) {
        User user = auth.createPhoneUser();
        try {
            phones.bindPhone(user.id(), phone);
            return user;
        } catch (DuplicateKeyException e) {
            return phones.findUserIdByPhone(phone).flatMap(users::findById)
                    .orElseThrow(() -> new IllegalStateException("手机号账户创建失败", e));
        }
    }

    private void verifyCode(String phone, String purpose, String rawCode) {
        String code = rawCode == null ? "" : rawCode.trim();
        if (!code.matches("\\d{6}")) throw new IllegalArgumentException("验证码必须是 6 位数字");
        PhoneAuthRepository.Challenge challenge = phones.findLatestActive(digest("phone:" + phone), purpose, Instant.now())
                .orElseThrow(() -> new IllegalArgumentException("验证码不存在或已过期"));
        if (challenge.attempts() >= 5) throw new IllegalArgumentException("验证码错误次数过多，请重新获取");
        if (!constantTimeEquals(challenge.codeHash(), digest("code:" + code))) {
            phones.incrementAttempts(challenge.id());
            throw new IllegalArgumentException("验证码错误");
        }
        phones.consume(challenge.id());
    }

    private String normalizePurpose(String rawPurpose) {
        String purpose = rawPurpose == null || rawPurpose.isBlank() ? LOGIN_PURPOSE : rawPurpose.trim().toLowerCase();
        if (!LOGIN_PURPOSE.equals(purpose) && !BIND_PURPOSE.equals(purpose)) {
            throw new IllegalArgumentException("不支持的验证码用途");
        }
        return purpose;
    }

    public static String normalizePhone(String rawPhone) {
        String phone = rawPhone == null ? "" : rawPhone.replaceAll("[\\s-]", "");
        if (phone.matches("1[3-9]\\d{9}")) phone = "+86" + phone;
        if (!phone.matches("\\+861[3-9]\\d{9}")) throw new IllegalArgumentException("请输入有效的中国大陆手机号");
        return phone;
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

    private boolean constantTimeEquals(String left, String right) {
        return java.security.MessageDigest.isEqual(left.getBytes(StandardCharsets.US_ASCII), right.getBytes(StandardCharsets.US_ASCII));
    }

    public record SendCodeResult(String status, int cooldownSeconds) {}
}
