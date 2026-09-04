package com.forgemind.service;

import com.forgemind.model.User;
import com.forgemind.repository.DbSessionRepository;
import com.forgemind.repository.DbUserRepository;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;

@Service
public class AuthService {
    private final DbUserRepository users;
    private final DbSessionRepository sessions;
    private final CloudProjectionService cloud;
    private final BCryptPasswordEncoder encoder = new BCryptPasswordEncoder();

    public AuthService(DbUserRepository users, DbSessionRepository sessions, CloudProjectionService cloud) {
        this.users = users;
        this.sessions = sessions;
        this.cloud = cloud;
    }

    public AuthResult register(String rawUsername, String password) {
        String username = normalizeUsername(rawUsername);
        validate(username, password);
        if (users.findByUsername(username).isPresent()) throw new IllegalArgumentException("用户名已存在");

        User user = new User(UUID.randomUUID().toString(), username, encoder.encode(password), Instant.now().toString());
        try {
            users.insert(user);
        } catch (DuplicateKeyException e) {
            throw new IllegalArgumentException("用户名已存在", e);
        }
        cloud.ensureWorkspace(user.id());
        return new AuthResult(issue(user), user.username());
    }

    public AuthResult login(String rawUsername, String password) {
        String username = normalizeUsername(rawUsername);
        User user = users.findByUsername(username)
                .orElseThrow(() -> new IllegalArgumentException("用户名或密码错误"));
        if (user.passwordHash() == null || !encoder.matches(password == null ? "" : password, user.passwordHash())) {
            throw new IllegalArgumentException("用户名或密码错误");
        }
        return new AuthResult(issue(user), user.username());
    }

    public AuthResult loginWithVerifiedIdentity(User user) {
        return new AuthResult(issue(user), user.username());
    }

    public User createPhoneUser() {
        return createExternalUser("phone");
    }

    public User createEmailUser() {
        return createExternalUser("email");
    }

    public User createExternalUser(String provider) {
        String prefix = provider == null ? "external" : provider.trim().toLowerCase().replaceAll("[^a-z0-9]", "");
        if (prefix.isBlank()) prefix = "external";
        User user = new User(UUID.randomUUID().toString(), prefix + "_" + UUID.randomUUID().toString().replace("-", ""), encoder.encode(UUID.randomUUID().toString()), Instant.now().toString());
        users.insert(user);
        cloud.ensureWorkspace(user.id());
        return user;
    }

    public User currentUser(String authorization) {
        if (authorization == null || !authorization.startsWith("Bearer ")) {
            throw new IllegalArgumentException("未登录");
        }
        String token = authorization.substring(7).trim();
        if (token.isEmpty()) throw new IllegalArgumentException("未登录");
        String userId = sessions.findUserId(token)
                .orElseThrow(() -> new IllegalArgumentException("登录已失效"));
        return users.findById(userId)
                .orElseThrow(() -> new IllegalArgumentException("用户不存在"));
    }

    public void logout(String authorization) {
        if (authorization != null && authorization.startsWith("Bearer ")) {
            String token = authorization.substring(7).trim();
            if (!token.isEmpty()) sessions.delete(token);
        }
    }

    private String issue(User user) {
        String token = UUID.randomUUID().toString();
        sessions.save(token, user.id(), Instant.now().plus(30, ChronoUnit.DAYS));
        return token;
    }

    private String normalizeUsername(String rawUsername) {
        return rawUsername == null ? "" : rawUsername.trim();
    }

    private void validate(String username, String password) {
        if (username.length() < 2) throw new IllegalArgumentException("用户名至少 2 个字符");
        if (username.length() > 64) throw new IllegalArgumentException("用户名最多 64 个字符");
        if (password == null || password.length() < 6) throw new IllegalArgumentException("密码至少 6 位");
    }

    public record AuthResult(String token, String username) {}
}
