package com.forgemind.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.forgemind.model.User;
import com.forgemind.repository.DbUserRepository;
import com.forgemind.repository.EmailAuthRepository;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;

@Service
public class GithubOAuthService {
    private static final String PROVIDER = "github";
    private final ObjectMapper json;
    private final HttpClient http;
    private final EmailAuthRepository identities;
    private final DbUserRepository users;
    private final AuthService auth;
    private final AuthExchangeService exchanges;
    private final boolean enabled;
    private final String clientId;
    private final String clientSecret;
    private final String redirectUri;
    private final String frontendUrl;

    public GithubOAuthService(
            ObjectMapper json,
            EmailAuthRepository identities,
            DbUserRepository users,
            AuthService auth,
            AuthExchangeService exchanges,
            @Value("${forgemind.oauth.github.enabled:false}") boolean enabled,
            @Value("${forgemind.oauth.github.client-id:}") String clientId,
            @Value("${forgemind.oauth.github.client-secret:}") String clientSecret,
            @Value("${forgemind.oauth.github.redirect-uri:http://localhost:8080/api/auth/github/callback}") String redirectUri,
            @Value("${forgemind.oauth.github.frontend-url:http://localhost:5173/forgecloud}") String frontendUrl
    ) {
        this.json = json;
        this.http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
        this.identities = identities;
        this.users = users;
        this.auth = auth;
        this.exchanges = exchanges;
        this.enabled = enabled;
        this.clientId = trim(clientId);
        this.clientSecret = trim(clientSecret);
        this.redirectUri = trim(redirectUri);
        this.frontendUrl = trim(frontendUrl);
    }

    public boolean isConfigured() {
        return enabled && !clientId.isBlank() && !clientSecret.isBlank() && !redirectUri.isBlank() && !frontendUrl.isBlank();
    }

    public String newState() {
        if (!isConfigured()) throw new IllegalStateException("GitHub 登录尚未配置，请设置 OAuth 开关、Client ID 和 Client Secret");
        return UUID.randomUUID().toString() + UUID.randomUUID();
    }

    public String authorizationUrl(String state) {
        return "https://github.com/login/oauth/authorize?client_id=" + encode(clientId)
                + "&redirect_uri=" + encode(redirectUri)
                + "&scope=" + encode("read:user user:email")
                + "&state=" + encode(state);
    }

    public User login(String code) {
        if (!isConfigured()) throw new IllegalStateException("GitHub 登录尚未配置");
        String accessToken = exchangeCode(code);
        JsonNode profile = getJson("https://api.github.com/user", accessToken);
        String subject = profile.path("id").asText("").trim();
        String email = findVerifiedEmail(profile, accessToken);
        if (subject.isBlank()) throw new IllegalStateException("GitHub 未返回有效用户身份");
        if (email.isBlank()) throw new IllegalArgumentException("GitHub 账号没有已验证邮箱，无法用于 ForgePass 登录");

        User user = identities.findUserIdByIdentity(PROVIDER, subject)
                .flatMap(users::findById)
                .orElseGet(() -> linkOrCreate(subject, email, profile.path("login").asText("github")));
        return user;
    }

    public String callbackUrl(String exchangeCode) {
        String separator = frontendUrl.contains("?") ? "&" : "?";
        return frontendUrl + separator + "forgepass_oauth=" + encode(exchangeCode);
    }

    public String createExchange(User user) {
        return exchanges.create(user);
    }

    private User linkOrCreate(String subject, String email, String login) {
        Optional<User> existingEmailUser = identities.findUserIdByIdentity("email", email).flatMap(users::findById);
        User user = existingEmailUser.orElseGet(() -> auth.createExternalUser("github_" + login));
        try {
            identities.saveIdentity(UUID.randomUUID().toString(), user.id(), PROVIDER, subject, email);
            if (existingEmailUser.isEmpty()) {
                try {
                    identities.saveIdentity(UUID.randomUUID().toString(), user.id(), "email", email, email);
                } catch (DuplicateKeyException ignored) {
                    // A concurrent email login may have claimed the same identity; the GitHub binding is still valid.
                }
            }
            return user;
        } catch (DuplicateKeyException e) {
            return identities.findUserIdByIdentity(PROVIDER, subject).flatMap(users::findById)
                    .orElseThrow(() -> new IllegalStateException("GitHub 账号绑定失败", e));
        }
    }

    private String exchangeCode(String code) {
        if (code == null || code.isBlank()) throw new IllegalArgumentException("GitHub 授权码为空");
        String body = "client_id=" + encode(clientId) + "&client_secret=" + encode(clientSecret)
                + "&code=" + encode(code) + "&redirect_uri=" + encode(redirectUri);
        HttpRequest request = HttpRequest.newBuilder(URI.create("https://github.com/login/oauth/access_token"))
                .timeout(Duration.ofSeconds(8))
                .header("Accept", "application/json")
                .header("Content-Type", "application/x-www-form-urlencoded")
                .POST(HttpRequest.BodyPublishers.ofString(body))
                .build();
        JsonNode response = sendJson(request);
        String token = response.path("access_token").asText("").trim();
        if (token.isBlank()) throw new IllegalStateException("GitHub 授权失败：" + response.path("error_description").asText("未返回访问令牌"));
        return token;
    }

    private JsonNode getJson(String url, String accessToken) {
        HttpRequest request = HttpRequest.newBuilder(URI.create(url))
                .timeout(Duration.ofSeconds(8))
                .header("Accept", "application/vnd.github+json")
                .header("X-GitHub-Api-Version", "2022-11-28")
                .header("User-Agent", "ForgeMind-ForgePass")
                .header("Authorization", "Bearer " + accessToken)
                .GET().build();
        return sendJson(request);
    }

    private String findVerifiedEmail(JsonNode profile, String accessToken) {
        JsonNode emails = getJson("https://api.github.com/user/emails", accessToken);
        for (JsonNode item : emails) {
            if (item.path("verified").asBoolean(false) && item.path("primary").asBoolean(false)) {
                return normalizeGithubEmail(item.path("email").asText(""));
            }
        }
        for (JsonNode item : emails) {
            if (item.path("verified").asBoolean(false)) {
                return normalizeGithubEmail(item.path("email").asText(""));
            }
        }
        return "";
    }

    private String normalizeGithubEmail(String rawEmail) {
        String email = rawEmail == null ? "" : rawEmail.trim().toLowerCase(Locale.ROOT);
        return email.isBlank() ? "" : EmailAuthService.normalizeEmail(email);
    }

    private JsonNode sendJson(HttpRequest request) {
        try {
            HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                throw new IllegalStateException("GitHub 请求失败（HTTP " + response.statusCode() + "）");
            }
            return json.readTree(response.body());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("GitHub 请求被中断", e);
        } catch (IOException e) {
            throw new IllegalStateException("GitHub 服务暂时不可用", e);
        }
    }

    private static String trim(String value) { return value == null ? "" : value.trim(); }
    private static String encode(String value) { return URLEncoder.encode(value, StandardCharsets.UTF_8); }
}
