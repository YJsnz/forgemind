package com.forgemind.repository;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

@Repository
public class AssistantReminderEventRepository {
    private final JdbcTemplate jdbc;
    private final ObjectMapper json;
    private static final List<String> SEVERITIES = List.of("info", "warning", "critical");

    public AssistantReminderEventRepository(JdbcTemplate jdbc, ObjectMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    @Transactional
    public ObjectNode claim(String owner, JsonNode input) {
        if (input == null || !input.isObject()) throw new IllegalArgumentException("提醒事件必须是 JSON 对象");
        String key = input.path("dedupeKey").asText("").trim();
        String severity = input.path("severity").asText("").trim();
        String message = input.path("message").asText("").trim();
        String source = input.path("source").asText("assistant").trim();
        long cooldownMs = input.path("cooldownMs").asLong(-1);
        if (key.isBlank() || key.length() > 180) throw new IllegalArgumentException("提醒事件去重键不能为空且不超过 180 个字符");
        if (!SEVERITIES.contains(severity)) throw new IllegalArgumentException("提醒事件严重度非法");
        if (message.isBlank() || message.length() > 1000) throw new IllegalArgumentException("提醒事件消息不能为空且不超过 1000 个字符");
        if (source.isBlank() || source.length() > 80) throw new IllegalArgumentException("提醒事件来源不能为空且不超过 80 个字符");
        if (cooldownMs < 1000 || cooldownMs > 86_400_000L) throw new IllegalArgumentException("提醒事件冷却时间必须在 1 秒到 24 小时之间");

        List<ExistingEvent> rows = jdbc.query("SELECT severity,last_emitted_at,resolved_at,source_summary,occurrence_count,first_observed_at FROM assistant_reminder_event WHERE owner_user_id=? AND dedupe_key=? FOR UPDATE", (rs, rowNum) -> new ExistingEvent(rs.getString("severity"), rs.getTimestamp("last_emitted_at"), rs.getTimestamp("resolved_at"), rs.getString("source_summary"), rs.getInt("occurrence_count"), rs.getTimestamp("first_observed_at")), owner, key);
        Instant now = Instant.now();
        boolean escalated = !rows.isEmpty() && rank(severity) > rank(rows.get(0).severity());
        boolean emit = rows.isEmpty() || rows.get(0).resolvedAt() != null || escalated || now.toEpochMilli() - rows.get(0).lastEmittedAt().getTime() >= cooldownMs;
        if (rows.isEmpty()) {
            jdbc.update("INSERT INTO assistant_reminder_event(owner_user_id,dedupe_key,severity,last_emitted_at,last_message,source_summary,occurrence_count,first_observed_at) VALUES(?,?,?,?,?,?,?,?)", owner, key, severity, Timestamp.from(now), message, sourcesJson(List.of(source)), 1, Timestamp.from(now));
        } else {
            ExistingEvent previous = rows.get(0);
            Set<String> sources = new LinkedHashSet<>(readSources(previous.sourceSummary()));
            sources.add(source);
            String nextSeverity = rank(severity) >= rank(previous.severity()) ? severity : previous.severity();
            jdbc.update("UPDATE assistant_reminder_event SET severity=?,last_emitted_at=?,resolved_at=?,last_message=?,source_summary=?,occurrence_count=? WHERE owner_user_id=? AND dedupe_key=?", nextSeverity, emit ? Timestamp.from(now) : previous.lastEmittedAt(), emit ? null : previous.resolvedAt(), message, sourcesJson(new ArrayList<>(sources)), previous.occurrenceCount() + 1, owner, key);
        }
        ExistingEvent current = rows.isEmpty() ? new ExistingEvent(severity, Timestamp.from(now), null, sourcesJson(List.of(source)), 1, Timestamp.from(now)) : new ExistingEvent(rank(severity) >= rank(rows.get(0).severity()) ? severity : rows.get(0).severity(), emit ? Timestamp.from(now) : rows.get(0).lastEmittedAt(), emit ? null : rows.get(0).resolvedAt(), sourcesJson(mergeSources(rows.get(0).sourceSummary(), source)), rows.get(0).occurrenceCount() + 1, rows.get(0).firstObservedAt());
        ObjectNode response = json.createObjectNode().put("emit", emit).put("escalated", escalated).put("dedupeKey", key).put("count", current.occurrenceCount()).put("status", current.resolvedAt() == null ? "open" : "resolved");
        response.set("sources", json.valueToTree(readSources(current.sourceSummary())));
        return response;
    }

    @Transactional
    public ObjectNode resolve(String owner, JsonNode input) {
        if (input == null || !input.isObject()) throw new IllegalArgumentException("恢复提醒事件必须是 JSON 对象");
        String key = input.path("dedupeKey").asText("").trim();
        if (key.isBlank() || key.length() > 180) throw new IllegalArgumentException("提醒事件去重键不能为空且不超过 180 个字符");
        int updated = jdbc.update("UPDATE assistant_reminder_event SET resolved_at=COALESCE(resolved_at,CURRENT_TIMESTAMP(6)) WHERE owner_user_id=? AND dedupe_key=?", owner, key);
        return json.createObjectNode().put("resolved", updated > 0).put("dedupeKey", key);
    }

    @Transactional(readOnly = true)
    public ObjectNode list(String owner, String requestedStatus, int requestedLimit) {
        String status = requestedStatus == null || requestedStatus.isBlank() ? "open" : requestedStatus.trim();
        if (!List.of("open", "resolved", "all").contains(status)) throw new IllegalArgumentException("提醒状态必须是 open、resolved 或 all");
        int limit = Math.max(1, Math.min(48, requestedLimit <= 0 ? 12 : requestedLimit));
        String predicate = switch (status) {
            case "resolved" -> " AND resolved_at IS NOT NULL";
            case "all" -> "";
            default -> " AND resolved_at IS NULL";
        };
        ArrayNode events = json.createArrayNode();
        jdbc.query("SELECT dedupe_key,severity,last_message,source_summary,occurrence_count,first_observed_at,last_emitted_at,resolved_at FROM assistant_reminder_event WHERE owner_user_id=?" + predicate + " ORDER BY last_emitted_at DESC LIMIT ?", (rs, rowNum) -> {
            ObjectNode event = json.createObjectNode();
            event.put("dedupe_key", rs.getString("dedupe_key"));
            event.put("severity", rs.getString("severity"));
            event.put("last_message", rs.getString("last_message"));
            event.set("source_summary", parseSources(rs.getString("source_summary")));
            event.put("occurrence_count", rs.getInt("occurrence_count"));
            event.put("first_observed_at", rs.getTimestamp("first_observed_at").toInstant().toString());
            event.put("last_emitted_at", rs.getTimestamp("last_emitted_at").toInstant().toString());
            Timestamp resolvedAt = rs.getTimestamp("resolved_at");
            if (resolvedAt == null) event.putNull("resolved_at"); else event.put("resolved_at", resolvedAt.toInstant().toString());
            events.add(event);
            return null;
        }, owner, limit);
        return json.createObjectNode().put("status", status).set("events", events);
    }

    private int rank(String value) { return SEVERITIES.indexOf(value); }
    private String sourcesJson(List<String> sources) { try { return json.writeValueAsString(sources); } catch (Exception error) { throw new IllegalStateException("提醒来源序列化失败", error); } }
    private List<String> mergeSources(String raw, String source) { Set<String> merged = new LinkedHashSet<>(readSources(raw)); merged.add(source); return new ArrayList<>(merged); }
    private List<String> readSources(String raw) { try { JsonNode node = json.readTree(raw == null || raw.isBlank() ? "[]" : raw); List<String> result = new ArrayList<>(); if (node != null && node.isArray()) for (JsonNode item : node) if (item.isTextual() && !item.asText().isBlank()) result.add(item.asText()); return result; } catch (Exception error) { return new ArrayList<>(); } }
    private JsonNode parseSources(String raw) { return json.valueToTree(readSources(raw)); }
    private record ExistingEvent(String severity, Timestamp lastEmittedAt, Timestamp resolvedAt, String sourceSummary, int occurrenceCount, Timestamp firstObservedAt) {}
}
