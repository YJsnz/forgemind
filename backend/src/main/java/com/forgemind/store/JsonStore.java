package com.forgemind.store;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.forgemind.model.FactorySave;
import org.springframework.stereotype.Component;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.List;

/**
 * JSON 文件存储（补充设计 §4.4：7 天冲刺不接数据库，静态结构用 JSON 持久化）。
 * 单文件 data/factory.json，读时缺失则返回空存档。
 */
@Component
public class JsonStore {

    private static final Path DATA_PATH = Paths.get("data", "factory.json");

    private final ObjectMapper mapper = new ObjectMapper();

    public FactorySave load() {
        try {
            if (!Files.exists(DATA_PATH)) {
                return new FactorySave(1, null, List.of(), List.of(), List.of());
            }
            return mapper.readValue(DATA_PATH.toFile(), FactorySave.class);
        } catch (Exception e) {
            throw new RuntimeException("读取存档失败: " + e.getMessage(), e);
        }
    }

    public void save(FactorySave save) {
        try {
            Files.createDirectories(DATA_PATH.getParent());
            mapper.writerWithDefaultPrettyPrinter().writeValue(DATA_PATH.toFile(), save);
        } catch (Exception e) {
            throw new RuntimeException("写入存档失败: " + e.getMessage(), e);
        }
    }
}
