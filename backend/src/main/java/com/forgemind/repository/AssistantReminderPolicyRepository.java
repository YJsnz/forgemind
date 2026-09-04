package com.forgemind.repository;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;

@Repository
public class AssistantReminderPolicyRepository {
    private final JdbcTemplate jdbc;
    private final ObjectMapper json;

    public AssistantReminderPolicyRepository(JdbcTemplate jdbc, ObjectMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    public ObjectNode read(String owner) {
        List<ObjectNode> rows = jdbc.query("SELECT * FROM assistant_reminder_policy WHERE owner_user_id = ?", (rs, rowNum) -> row(rs), owner);
        if (rows.isEmpty()) return defaults();
        rows.get(0).put("persisted", true);
        return rows.get(0);
    }

    public ObjectNode write(String owner, JsonNode input) {
        if (input == null || !input.isObject()) throw new IllegalArgumentException("提醒策略必须是 JSON 对象");
        boolean enabled = input.path("enabled").asBoolean(false);
        String severity = input.path("minSeverity").asText("").trim();
        int cooldown = input.path("cooldownMinutes").asInt(-1);
        String quietStart = nullableClock(input.get("quietStart"));
        String quietEnd = nullableClock(input.get("quietEnd"));
        if (!List.of("info", "warning", "critical").contains(severity)) throw new IllegalArgumentException("提醒最低严重度非法");
        if (cooldown < 1 || cooldown > 1440 || !validClock(quietStart) || !validClock(quietEnd)) throw new IllegalArgumentException("提醒冷却时间或免打扰时段非法");
        jdbc.update("INSERT INTO assistant_reminder_policy(owner_user_id,enabled,min_severity,cooldown_minutes,quiet_start,quiet_end) VALUES(?,?,?,?,?,?) ON DUPLICATE KEY UPDATE enabled=VALUES(enabled),min_severity=VALUES(min_severity),cooldown_minutes=VALUES(cooldown_minutes),quiet_start=VALUES(quiet_start),quiet_end=VALUES(quiet_end)", owner, enabled, severity, cooldown, quietStart, quietEnd);
        return read(owner);
    }

    private ObjectNode defaults() {
        return json.createObjectNode().put("enabled", true).put("minSeverity", "warning").put("cooldownMinutes", 10).putNull("quietStart").putNull("quietEnd").put("persisted", false);
    }

    private ObjectNode row(ResultSet rs) throws SQLException {
        ObjectNode out = defaults();
        out.put("enabled", rs.getBoolean("enabled"));
        out.put("minSeverity", rs.getString("min_severity"));
        out.put("cooldownMinutes", rs.getInt("cooldown_minutes"));
        if (rs.getString("quiet_start") == null) out.putNull("quietStart"); else out.put("quietStart", rs.getString("quiet_start"));
        if (rs.getString("quiet_end") == null) out.putNull("quietEnd"); else out.put("quietEnd", rs.getString("quiet_end"));
        return out;
    }

    private String nullableClock(JsonNode value) {
        if (value == null || value.isNull()) return null;
        return value.isTextual() ? value.asText().trim() : "invalid";
    }

    private boolean validClock(String value) {
        return value == null || value.matches("^(?:[01]\\d|2[0-3]):[0-5]\\d$");
    }
}
