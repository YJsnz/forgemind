package com.forgemind.store;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.forgemind.model.User;
import org.springframework.stereotype.Component;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * 用户 JSON 文件存储，写法对齐 JsonStore。
 * 单文件 data/users.json，读时缺失返回空列表。
 */
@Component
public class UserStore {

    private static final Path DATA_PATH = Paths.get("data", "users.json");

    private final ObjectMapper mapper = new ObjectMapper();

    public synchronized List<User> loadAll() {
        try {
            if (!Files.exists(DATA_PATH)) {
                return new ArrayList<>();
            }
            return new ArrayList<>(mapper.readValue(
                    DATA_PATH.toFile(),
                    mapper.getTypeFactory().constructCollectionType(List.class, User.class)));
        } catch (Exception e) {
            throw new RuntimeException("读取用户数据失败: " + e.getMessage(), e);
        }
    }

    public synchronized Optional<User> findByUsername(String username) {
        return loadAll().stream().filter(u -> u.username().equals(username)).findFirst();
    }

    public synchronized void saveAll(List<User> users) {
        try {
            Files.createDirectories(DATA_PATH.getParent());
            mapper.writerWithDefaultPrettyPrinter().writeValue(DATA_PATH.toFile(), users);
        } catch (Exception e) {
            throw new RuntimeException("写入用户数据失败: " + e.getMessage(), e);
        }
    }
}
