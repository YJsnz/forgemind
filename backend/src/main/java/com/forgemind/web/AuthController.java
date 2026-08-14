package com.forgemind.web;

import com.forgemind.model.User;
import com.forgemind.store.UserStore;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 认证 REST 接口（极薄）：注册 / 登录 / 当前用户 / 登出。
 * token 为内存 UUID 会话，重启即失效 —— 学习答辩用足够。
 */
@RestController
@RequestMapping("/api/auth")
@CrossOrigin(origins = "*")
public class AuthController {

    private final UserStore userStore;
    private final BCryptPasswordEncoder encoder = new BCryptPasswordEncoder();

    /** token -> userId；内存态，重启即失效（答辩够用） */
    private final Map<String, String> tokens = new ConcurrentHashMap<>();

    public AuthController(UserStore userStore) {
        this.userStore = userStore;
    }

    public record AuthRequest(String username, String password) {}
    public record AuthResponse(String token, String username) {}
    public record MeResponse(String id, String username) {}

    @PostMapping("/register")
    public AuthResponse register(@RequestBody AuthRequest req) {
        String username = req.username() == null ? "" : req.username().trim();
        String password = req.password() == null ? "" : req.password();
        if (username.length() < 2) throw new IllegalArgumentException("用户名至少 2 个字符");
        if (password.length() < 6) throw new IllegalArgumentException("密码至少 6 位");
        if (userStore.findByUsername(username).isPresent()) throw new IllegalArgumentException("用户名已存在");

        User user = new User(UUID.randomUUID().toString(), username, encoder.encode(password), Instant.now().toString());
        List<User> users = userStore.loadAll();
        users.add(user);
        userStore.saveAll(users);

        return new AuthResponse(issue(user), username);
    }

    @PostMapping("/login")
    public AuthResponse login(@RequestBody AuthRequest req) {
        String username = req.username() == null ? "" : req.username().trim();
        String password = req.password() == null ? "" : req.password();
        User user = userStore.findByUsername(username)
                .orElseThrow(() -> new IllegalArgumentException("用户名或密码错误"));
        if (!encoder.matches(password, user.passwordHash())) {
            throw new IllegalArgumentException("用户名或密码错误");
        }
        return new AuthResponse(issue(user), user.username());
    }

    @GetMapping("/me")
    public MeResponse me(@RequestHeader(value = "Authorization", defaultValue = "") String auth) {
        return new MeResponse(currentUser(auth).id(), currentUser(auth).username());
    }

    @PostMapping("/logout")
    public Map<String, String> logout(@RequestHeader(value = "Authorization", defaultValue = "") String auth) {
        if (auth != null && auth.startsWith("Bearer ")) {
            tokens.remove(auth.substring(7));
        }
        return Map.of("status", "ok");
    }

    @ExceptionHandler(IllegalArgumentException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public Map<String, String> onBadRequest(IllegalArgumentException e) {
        return Map.of("error", e.getMessage());
    }

    private String issue(User user) {
        String token = UUID.randomUUID().toString();
        tokens.put(token, user.id());
        return token;
    }

    private User currentUser(String auth) {
        if (auth == null || !auth.startsWith("Bearer ")) {
            throw new IllegalArgumentException("未登录");
        }
        String userId = tokens.get(auth.substring(7));
        if (userId == null) throw new IllegalArgumentException("登录已失效");
        return userStore.loadAll().stream().filter(u -> u.id().equals(userId)).findFirst()
                .orElseThrow(() -> new IllegalArgumentException("用户不存在"));
    }
}
