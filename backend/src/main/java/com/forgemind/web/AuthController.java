package com.forgemind.web;

import com.forgemind.model.User;
import com.forgemind.service.AuthService;
import com.forgemind.service.AuthRateLimitException;
import com.forgemind.service.AuthExchangeService;
import com.forgemind.service.EmailAuthService;
import com.forgemind.service.GithubOAuthService;
import com.forgemind.service.PhoneAuthService;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

import java.io.IOException;
import java.security.MessageDigest;
import java.util.Map;

/**
 * 认证 REST 接口：注册 / 登录 / 当前用户 / 登出。
 * 会话 token 的 SHA-256 摘要持久化在 MySQL，原始 token 只返回给客户端。
 */
@RestController
@RequestMapping("/api/auth")
@CrossOrigin(origins = "*")
public class AuthController {

    private final AuthService auth;
    private final PhoneAuthService phoneAuth;
    private final EmailAuthService emailAuth;
    private final GithubOAuthService github;
    private final AuthExchangeService exchanges;

    public AuthController(AuthService auth, PhoneAuthService phoneAuth, EmailAuthService emailAuth,
                          GithubOAuthService github, AuthExchangeService exchanges) {
        this.auth = auth;
        this.phoneAuth = phoneAuth;
        this.emailAuth = emailAuth;
        this.github = github;
        this.exchanges = exchanges;
    }

    public record AuthRequest(String username, String password) {}
    public record AuthResponse(String token, String username) {}
    public record MeResponse(String id, String username) {}
    public record PhoneCodeRequest(String phone, String purpose) {}
    public record PhoneCodeResponse(String status, int cooldownSeconds) {}
    public record PhoneLoginRequest(String phone, String code) {}
    public record EmailCodeResponse(String status, int cooldownSeconds) {}
    public record EmailLoginRequest(String email, String code) {}
    public record OAuthExchangeRequest(String code) {}

    @PostMapping("/register")
    public AuthResponse register(@RequestBody AuthRequest req) {
        if (req == null) throw new IllegalArgumentException("请求体不能为空");
        AuthService.AuthResult result = auth.register(req.username(), req.password());
        return new AuthResponse(result.token(), result.username());
    }

    @PostMapping("/login")
    public AuthResponse login(@RequestBody AuthRequest req) {
        if (req == null) throw new IllegalArgumentException("请求体不能为空");
        AuthService.AuthResult result = auth.login(req.username(), req.password());
        return new AuthResponse(result.token(), result.username());
    }

    @PostMapping("/phone/send-code")
    public PhoneCodeResponse sendPhoneCode(@RequestHeader(value = "Authorization", defaultValue = "") String authorization,
                                           @RequestBody PhoneCodeRequest req, HttpServletRequest request) {
        if (req == null) throw new IllegalArgumentException("请求体不能为空");
        if ("bind".equalsIgnoreCase(req.purpose())) auth.currentUser(authorization);
        PhoneAuthService.SendCodeResult result = phoneAuth.sendCode(req.phone(), req.purpose(), request.getRemoteAddr());
        return new PhoneCodeResponse(result.status(), result.cooldownSeconds());
    }

    @PostMapping("/phone/login")
    public AuthResponse phoneLogin(@RequestBody PhoneLoginRequest req) {
        if (req == null) throw new IllegalArgumentException("请求体不能为空");
        AuthService.AuthResult result = phoneAuth.login(req.phone(), req.code());
        return new AuthResponse(result.token(), result.username());
    }

    @PostMapping("/email/send-code")
    public EmailCodeResponse sendEmailCode(@RequestBody EmailLoginRequest req, HttpServletRequest request) {
        if (req == null) throw new IllegalArgumentException("请求体不能为空");
        EmailAuthService.SendCodeResult result = emailAuth.sendCode(req.email(), request.getRemoteAddr());
        return new EmailCodeResponse(result.status(), result.cooldownSeconds());
    }

    @PostMapping("/email/login")
    public AuthResponse emailLogin(@RequestBody EmailLoginRequest req) {
        if (req == null) throw new IllegalArgumentException("请求体不能为空");
        AuthService.AuthResult result = emailAuth.login(req.email(), req.code());
        return new AuthResponse(result.token(), result.username());
    }

    @GetMapping("/github/start")
    public void githubStart(HttpServletRequest request, HttpServletResponse response) throws IOException {
        String state = github.newState();
        request.getSession(true).setAttribute("forgemind.github.oauth.state", state);
        response.sendRedirect(github.authorizationUrl(state));
    }

    @GetMapping("/github/callback")
    public void githubCallback(@RequestParam(required = false) String code,
                               @RequestParam(required = false) String state,
                               HttpServletRequest request, HttpServletResponse response) throws IOException {
        HttpSession session = request.getSession(false);
        Object expectedState = session == null ? null : session.getAttribute("forgemind.github.oauth.state");
        if (session != null) session.removeAttribute("forgemind.github.oauth.state");
        if (!(expectedState instanceof String expected) || state == null
                || !MessageDigest.isEqual(expected.getBytes(java.nio.charset.StandardCharsets.UTF_8), state.getBytes(java.nio.charset.StandardCharsets.UTF_8))) {
            throw new IllegalArgumentException("GitHub 登录状态无效，请重新尝试");
        }
        User user = github.login(code);
        String exchangeCode = github.createExchange(user);
        response.sendRedirect(github.callbackUrl(exchangeCode));
    }

    @PostMapping("/github/exchange")
    public AuthResponse githubExchange(@RequestBody OAuthExchangeRequest req) {
        if (req == null) throw new IllegalArgumentException("请求体不能为空");
        User user = exchanges.consume(req.code());
        AuthService.AuthResult result = auth.loginWithVerifiedIdentity(user);
        return new AuthResponse(result.token(), result.username());
    }

    @PostMapping("/phone/bind")
    public Map<String, String> bindPhone(@RequestHeader(value = "Authorization", defaultValue = "") String authorization,
                                         @RequestBody PhoneLoginRequest req) {
        if (req == null) throw new IllegalArgumentException("请求体不能为空");
        phoneAuth.bind(req.phone(), req.code(), auth.currentUser(authorization));
        return Map.of("status", "ok");
    }

    @GetMapping("/me")
    public MeResponse me(@RequestHeader(value = "Authorization", defaultValue = "") String auth) {
        User user = this.auth.currentUser(auth);
        return new MeResponse(user.id(), user.username());
    }

    @PostMapping("/logout")
    public Map<String, String> logout(@RequestHeader(value = "Authorization", defaultValue = "") String auth) {
        this.auth.logout(auth);
        return Map.of("status", "ok");
    }

    @ExceptionHandler(IllegalArgumentException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public Map<String, String> onBadRequest(IllegalArgumentException e) {
        return Map.of("error", e.getMessage());
    }

    @ExceptionHandler(AuthRateLimitException.class)
    @ResponseStatus(HttpStatus.TOO_MANY_REQUESTS)
    public Map<String, String> onRateLimit(AuthRateLimitException e) {
        return Map.of("error", e.getMessage());
    }

    @ExceptionHandler(IllegalStateException.class)
    @ResponseStatus(HttpStatus.SERVICE_UNAVAILABLE)
    public Map<String, String> onServiceUnavailable(IllegalStateException e) {
        return Map.of("error", e.getMessage() == null ? "认证服务暂时不可用" : e.getMessage());
    }

}
