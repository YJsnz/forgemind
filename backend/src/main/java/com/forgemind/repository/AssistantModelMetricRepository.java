package com.forgemind.repository;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Date;
import java.time.LocalDate;
import java.util.List;

@Repository
public class AssistantModelMetricRepository {
    private static final List<String> PROVIDERS = List.of("rule", "llm", "ollama", "deepseek", "fallback", "stub");
    private final JdbcTemplate jdbc;
    private final ObjectMapper json;

    public AssistantModelMetricRepository(JdbcTemplate jdbc, ObjectMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    @Transactional
    public ObjectNode record(String owner, JsonNode input) {
        if (input == null || !input.isObject()) throw new IllegalArgumentException("助手指标必须是 JSON 对象");
        String provider = input.path("provider").asText("").trim().toLowerCase();
        if (!PROVIDERS.contains(provider)) throw new IllegalArgumentException("助手指标 provider 非法");
        long firstTokenMs = boundedLong(input, "firstTokenMs", 0, 300_000);
        long completeMs = boundedLong(input, "completeMs", 0, 300_000);
        boolean toolCall = input.path("toolCall").asBoolean(false);
        boolean toolSuccess = input.path("toolSuccess").asBoolean(false);
        boolean fallback = input.path("fallback").asBoolean(false);
        jdbc.update("INSERT INTO assistant_model_metric(owner_user_id,observed_day,provider,sample_count,first_token_ms_sum,complete_ms_sum,tool_call_count,tool_success_count,fallback_count) VALUES(?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE sample_count=sample_count+1,first_token_ms_sum=first_token_ms_sum+VALUES(first_token_ms_sum),complete_ms_sum=complete_ms_sum+VALUES(complete_ms_sum),tool_call_count=tool_call_count+VALUES(tool_call_count),tool_success_count=tool_success_count+VALUES(tool_success_count),fallback_count=fallback_count+VALUES(fallback_count),updated_at=CURRENT_TIMESTAMP(6)", owner, Date.valueOf(LocalDate.now()), provider, 1, firstTokenMs, completeMs, toolCall ? 1 : 0, toolSuccess ? 1 : 0, fallback ? 1 : 0);
        return read(owner);
    }

    public ObjectNode read(String owner) {
        ArrayNode rows = json.createArrayNode();
        jdbc.query("SELECT observed_day,provider,sample_count,first_token_ms_sum,complete_ms_sum,tool_call_count,tool_success_count,fallback_count,updated_at FROM assistant_model_metric WHERE owner_user_id=? AND observed_day>=DATE_SUB(CURRENT_DATE, INTERVAL 30 DAY) ORDER BY observed_day DESC,provider", rs -> {
            ObjectNode row = json.createObjectNode();
            row.put("day", rs.getDate("observed_day").toLocalDate().toString());
            row.put("provider", rs.getString("provider"));
            row.put("sampleCount", rs.getInt("sample_count"));
            row.put("firstTokenMs", average(rs.getLong("first_token_ms_sum"), rs.getInt("sample_count")));
            row.put("completeMs", average(rs.getLong("complete_ms_sum"), rs.getInt("sample_count")));
            row.put("toolCalls", rs.getInt("tool_call_count"));
            row.put("toolSuccesses", rs.getInt("tool_success_count"));
            row.put("fallbacks", rs.getInt("fallback_count"));
            row.put("updatedAt", rs.getTimestamp("updated_at").toInstant().toString());
            rows.add(row);
        }, owner);
        ObjectNode response = json.createObjectNode().put("persisted", true);
        response.set("metrics", rows);
        return response;
    }

    private long boundedLong(JsonNode input, String field, long minimum, long maximum) {
        long value = input.path(field).asLong(0);
        if (value < minimum || value > maximum) throw new IllegalArgumentException(field + " 必须在 " + minimum + " 到 " + maximum + " 之间");
        return value;
    }

    private long average(long sum, int count) { return count <= 0 ? 0 : Math.round((double) sum / count); }
}
