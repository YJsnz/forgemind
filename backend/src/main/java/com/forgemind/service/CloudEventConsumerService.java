package com.forgemind.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;

/**
 * Projects low-frequency cloud business events from the transactional outbox
 * into the read-side activity stream. It deliberately does not consume
 * simulation ticks or raw high-frequency telemetry.
 */
@Service
public class CloudEventConsumerService {
    private static final Logger log = LoggerFactory.getLogger(CloudEventConsumerService.class);
    private static final int DEFAULT_BATCH_SIZE = 40;
    private static final long PROCESSING_LEASE_SECONDS = 300;
    private static final long MAX_RETRY_DELAY_SECONDS = 300;

    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;

    public CloudEventConsumerService(JdbcTemplate jdbc, ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.mapper = mapper;
    }

    @Scheduled(
            fixedDelayString = "${forgemind.cloud.events.fixed-delay-ms:5000}",
            initialDelayString = "${forgemind.cloud.events.initial-delay-ms:3000}"
    )
    @Transactional
    public void scheduledConsume() {
        try {
            consumeAvailable(DEFAULT_BATCH_SIZE);
        } catch (RuntimeException error) {
            // Event delivery must not take down the web/API process. Individual
            // events are marked failed by consumeAvailable when possible.
            log.warn("ForgeCloud event consumer cycle failed: {}", error.getMessage());
        }
    }

    @Transactional
    public int consumeAvailable(int batchSize) {
        int limit = Math.max(1, Math.min(batchSize, 100));
        List<OutboxRow> rows = jdbc.query("""
                SELECT id, workspace_id, event_type, aggregate_type, aggregate_id,
                       payload_json, attempts
                FROM cloud_outbox_event
                WHERE (status IN ('pending', 'failed') AND available_at <= CURRENT_TIMESTAMP(6))
                   OR (status = 'processing' AND available_at <= CURRENT_TIMESTAMP(6))
                ORDER BY created_at, id
                LIMIT ?
                FOR UPDATE SKIP LOCKED
                """, (rs, rowNum) -> new OutboxRow(
                rs.getString("id"),
                rs.getString("workspace_id"),
                rs.getString("event_type"),
                rs.getString("aggregate_type"),
                rs.getString("aggregate_id"),
                rs.getString("payload_json"),
                rs.getInt("attempts")
        ), limit);

        int processed = 0;
        for (OutboxRow row : rows) {
            if (!claim(row.id())) continue;
            try {
                projectActivity(row);
                markProcessed(row.id());
                processed++;
            } catch (RuntimeException error) {
                markFailed(row, error);
                log.warn("ForgeCloud event {} failed on attempt {}: {}", row.id(), row.attempts() + 1, error.getMessage());
            }
        }
        return processed;
    }

    private boolean claim(String id) {
        return jdbc.update("""
                UPDATE cloud_outbox_event
                SET status = 'processing', attempts = attempts + 1,
                    available_at = DATE_ADD(CURRENT_TIMESTAMP(6), INTERVAL ? SECOND),
                    last_error = NULL
                WHERE id = ? AND status IN ('pending', 'failed', 'processing')
                """, PROCESSING_LEASE_SECONDS, id) == 1;
    }

    private void projectActivity(OutboxRow row) {
        JsonNode payload = parse(row.payloadJson());
        String workspaceId = row.workspaceId();
        if (workspaceId != null && !workspaceExists(workspaceId)) workspaceId = null;
        String actorUserId = text(payload, "actorUserId");
        if (actorUserId != null && !userExists(actorUserId)) actorUserId = null;
        String source = text(payload, "source");
        String action = text(payload, "action");
        String result = text(payload, "result");
        jdbc.update("""
                INSERT INTO cloud_activity_event
                    (outbox_event_id, workspace_id, event_type, aggregate_type,
                     aggregate_id, actor_user_id, source, action, result, payload_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE outbox_event_id = VALUES(outbox_event_id)
                """, row.id(), workspaceId, row.eventType(), row.aggregateType(),
                row.aggregateId(), actorUserId, source, action, result, row.payloadJson());
    }

    private boolean workspaceExists(String workspaceId) {
        Integer count = jdbc.queryForObject("SELECT COUNT(*) FROM cloud_workspace WHERE id = ?", Integer.class, workspaceId);
        return count != null && count > 0;
    }

    private boolean userExists(String userId) {
        Integer count = jdbc.queryForObject("SELECT COUNT(*) FROM app_user WHERE id = ?", Integer.class, userId);
        return count != null && count > 0;
    }

    private void markProcessed(String id) {
        jdbc.update("""
                UPDATE cloud_outbox_event
                SET status = 'processed', processed_at = CURRENT_TIMESTAMP(6), last_error = NULL
                WHERE id = ?
                """, id);
    }

    private void markFailed(OutboxRow row, RuntimeException error) {
        long delay = Math.min(MAX_RETRY_DELAY_SECONDS, 5L * (1L << Math.min(row.attempts(), 6)));
        String message = error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage();
        jdbc.update("""
                UPDATE cloud_outbox_event
                SET status = 'failed', last_error = ?,
                    available_at = ?
                WHERE id = ?
                """, truncate(message, 2000), Timestamp.from(Instant.now().plusSeconds(delay)), row.id());
    }

    private JsonNode parse(String raw) {
        try {
            return raw == null ? mapper.createObjectNode() : mapper.readTree(raw);
        } catch (Exception ignored) {
            return mapper.createObjectNode();
        }
    }

    private String text(JsonNode node, String field) {
        JsonNode value = node.path(field);
        return value.isMissingNode() || value.isNull() || value.asText().isBlank() ? null : value.asText();
    }

    private String truncate(String value, int max) {
        return value.substring(0, Math.min(max, value.length()));
    }

    private record OutboxRow(
            String id,
            String workspaceId,
            String eventType,
            String aggregateType,
            String aggregateId,
            String payloadJson,
            int attempts
    ) {}
}
