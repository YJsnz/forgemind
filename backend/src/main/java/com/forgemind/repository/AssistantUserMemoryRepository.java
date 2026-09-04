package com.forgemind.repository;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.util.regex.Pattern;

@Repository
public class AssistantUserMemoryRepository {
    private static final Pattern LIVE_FACT = Pattern.compile("(?i)(库存|产量|产出|坐标|位置|仿真|在途|吞吐|利用率|inventory|output|coordinate|simulation|throughput)");
    private final JdbcTemplate jdbc;
    private final ObjectMapper json;

    public AssistantUserMemoryRepository(JdbcTemplate jdbc, ObjectMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    public ObjectNode read(String owner) {
        ObjectNode out = json.createObjectNode().put("persisted", true);
        ObjectNode memory = out.putObject("memory");
        jdbc.query("SELECT memory_key,memory_value FROM assistant_user_memory WHERE owner_user_id=? ORDER BY updated_at DESC", (RowCallbackHandler) rs -> memory.put(rs.getString("memory_key"), rs.getString("memory_value")), owner);
        return out;
    }

    @Transactional
    public ObjectNode write(String owner, JsonNode input) {
        String key = text(input, "key");
        String value = text(input, "value");
        validate(key, value);
        jdbc.update("INSERT INTO assistant_user_memory(owner_user_id,memory_key,memory_value) VALUES(?,?,?) ON DUPLICATE KEY UPDATE memory_value=VALUES(memory_value),updated_at=CURRENT_TIMESTAMP(6)", owner, key, value);
        return read(owner);
    }

    @Transactional
    public ObjectNode delete(String owner, JsonNode input) {
        String key = text(input, "key");
        if (key.length() > 80) throw new IllegalArgumentException("记忆键不超过 80 个字符");
        jdbc.update("DELETE FROM assistant_user_memory WHERE owner_user_id=? AND memory_key=?", owner, key);
        return read(owner);
    }

    private void validate(String key, String value) {
        if (key.isBlank() || key.length() > 80) throw new IllegalArgumentException("记忆键不能为空且不超过 80 个字符");
        if (value.isBlank() || value.length() > 400) throw new IllegalArgumentException("记忆内容不能为空且不超过 400 个字符");
        if (LIVE_FACT.matcher(key).find() || LIVE_FACT.matcher(value).find()) throw new IllegalArgumentException("实时库存、产量、坐标和仿真事实不能写入长期记忆");
    }

    private String text(JsonNode input, String field) {
        if (input == null || !input.isObject()) throw new IllegalArgumentException("记忆请求必须是 JSON 对象");
        return input.path(field).asText("").trim();
    }
}
