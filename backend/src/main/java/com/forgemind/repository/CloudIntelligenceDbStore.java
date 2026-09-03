package com.forgemind.repository;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.io.IOException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** Device, twin, data and AI Cloud records. Commands are queued only; no field device is controlled here. */
@Repository
public class CloudIntelligenceDbStore {
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;
    private final CloudWorkspaceDbStore cloud;

    public CloudIntelligenceDbStore(JdbcTemplate jdbc, ObjectMapper mapper, CloudWorkspaceDbStore cloud) {
        this.jdbc = jdbc;
        this.mapper = mapper;
        this.cloud = cloud;
    }

    public List<Map<String, Object>> listDevices(String userId, String workspaceId) {
        String workspace = workspace(userId, workspaceId);
        return jdbc.query("SELECT id, device_key, name, device_type, endpoint, status, last_seen_at, metadata_json, created_by, created_at, updated_at FROM cloud_device WHERE workspace_id = ? ORDER BY updated_at DESC", (rs, rowNum) -> {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("id", rs.getString("id")); row.put("deviceKey", rs.getString("device_key")); row.put("name", rs.getString("name"));
            row.put("type", rs.getString("device_type")); row.put("endpoint", rs.getString("endpoint")); row.put("status", rs.getString("status"));
            row.put("lastSeenAt", instant(rs.getTimestamp("last_seen_at"))); row.put("metadata", json(rs.getString("metadata_json")));
            row.put("createdBy", rs.getString("created_by")); row.put("createdAt", instant(rs.getTimestamp("created_at"))); row.put("updatedAt", instant(rs.getTimestamp("updated_at")));
            return row;
        }, workspace);
    }

    @Transactional
    public Map<String, Object> registerDevice(String userId, String workspaceId, String deviceKey, String name, String type, String endpoint, JsonNode metadata) {
        String workspace = workspace(userId, workspaceId);
        String key = token(deviceKey, "device-" + UUID.randomUUID(), 120);
        String existing = jdbc.query("SELECT id FROM cloud_device WHERE workspace_id = ? AND device_key = ?", (rs, rowNum) -> rs.getString(1), workspace, key).stream().findFirst().orElse(null);
        String id = existing == null ? UUID.randomUUID().toString() : existing;
        String body = toJson(metadata == null ? mapper.createObjectNode() : metadata);
        if (existing == null) jdbc.update("INSERT INTO cloud_device (id, workspace_id, device_key, name, device_type, endpoint, status, metadata_json, created_by) VALUES (?, ?, ?, ?, ?, ?, 'registered', ?, ?)", id, workspace, key, name(name, "未命名设备"), token(type, "generic", 48), blank(endpoint), body, userId);
        else jdbc.update("UPDATE cloud_device SET name = ?, device_type = ?, endpoint = ?, metadata_json = ?, updated_at = CURRENT_TIMESTAMP(6) WHERE id = ? AND workspace_id = ?", name(name, "未命名设备"), token(type, "generic", 48), blank(endpoint), body, id, workspace);
        cloud.audit(workspace, userId, "device-cloud", existing == null ? "device.registered" : "device.updated", "device", id, "success", Map.of("deviceKey", key));
        return listDevices(userId, workspace).stream().filter(row -> id.equals(row.get("id"))).findFirst().orElseThrow();
    }

    @Transactional
    public Map<String, Object> heartbeat(String userId, String deviceId, String status, JsonNode metadata) {
        String workspace = deviceWorkspace(userId, deviceId);
        String body = metadata == null ? null : toJson(metadata);
        if (body == null) jdbc.update("UPDATE cloud_device SET status = ?, last_seen_at = CURRENT_TIMESTAMP(6), updated_at = CURRENT_TIMESTAMP(6) WHERE id = ?", token(status, "online", 24), deviceId);
        else jdbc.update("UPDATE cloud_device SET status = ?, last_seen_at = CURRENT_TIMESTAMP(6), metadata_json = ?, updated_at = CURRENT_TIMESTAMP(6) WHERE id = ?", token(status, "online", 24), body, deviceId);
        return listDevices(userId, workspace).stream().filter(row -> deviceId.equals(row.get("id"))).findFirst().orElseThrow();
    }

    public List<Map<String, Object>> listCommands(String userId, String workspaceId, String deviceId) {
        String workspace = workspace(userId, workspaceId);
        if (deviceId != null && !deviceId.isBlank()) deviceWorkspace(userId, deviceId);
        return jdbc.query("SELECT id, device_id, command_type, command_json, status, result_json, error_text, requested_by, requested_at, completed_at FROM cloud_device_command WHERE workspace_id = ? AND (? IS NULL OR device_id = ?) ORDER BY requested_at DESC LIMIT 100", (rs, rowNum) -> {
            Map<String, Object> row = new LinkedHashMap<>(); row.put("id", rs.getString("id")); row.put("deviceId", rs.getString("device_id")); row.put("type", rs.getString("command_type"));
            row.put("command", json(rs.getString("command_json"))); row.put("status", rs.getString("status")); row.put("result", jsonNullable(rs.getString("result_json"))); row.put("error", rs.getString("error_text"));
            row.put("requestedBy", rs.getString("requested_by")); row.put("requestedAt", instant(rs.getTimestamp("requested_at"))); row.put("completedAt", instantNullable(rs.getTimestamp("completed_at"))); return row;
        }, workspace, blank(deviceId), blank(deviceId));
    }

    @Transactional
    public Map<String, Object> queueCommand(String userId, String deviceId, String type, JsonNode command) {
        String workspace = deviceWorkspace(userId, deviceId);
        assertAdmin(userId, workspace);
        String id = UUID.randomUUID().toString();
        jdbc.update("INSERT INTO cloud_device_command (id, workspace_id, device_id, command_type, command_json, status, requested_by) VALUES (?, ?, ?, ?, ?, 'pending', ?)", id, workspace, deviceId, token(type, "inspect", 64), toJson(command == null ? mapper.createObjectNode() : command), userId);
        cloud.audit(workspace, userId, "device-cloud", "device.command_queued", "device_command", id, "success", Map.of("deviceId", deviceId, "execution", "pending_only"));
        return listCommands(userId, workspace, deviceId).stream().filter(row -> id.equals(row.get("id"))).findFirst().orElseThrow();
    }

    public List<Map<String, Object>> listTwins(String userId, String workspaceId) {
        String workspace = workspace(userId, workspaceId);
        return jdbc.query("SELECT t.id, t.twin_key, t.name, t.twin_type, t.source_device_id, d.name AS source_device, t.status, t.state_json, t.quality, t.last_state_at, t.created_by, t.created_at, t.updated_at FROM cloud_twin t LEFT JOIN cloud_device d ON d.id = t.source_device_id WHERE t.workspace_id = ? ORDER BY t.updated_at DESC", (rs, rowNum) -> {
            Map<String, Object> row = new LinkedHashMap<>(); row.put("id", rs.getString("id")); row.put("twinKey", rs.getString("twin_key")); row.put("name", rs.getString("name")); row.put("type", rs.getString("twin_type"));
            row.put("sourceDeviceId", rs.getString("source_device_id")); row.put("sourceDevice", rs.getString("source_device")); row.put("status", rs.getString("status")); row.put("state", json(rs.getString("state_json"))); row.put("quality", rs.getString("quality"));
            row.put("lastStateAt", instant(rs.getTimestamp("last_state_at"))); row.put("createdBy", rs.getString("created_by")); row.put("createdAt", instant(rs.getTimestamp("created_at"))); row.put("updatedAt", instant(rs.getTimestamp("updated_at"))); return row;
        }, workspace);
    }

    @Transactional
    public Map<String, Object> createTwin(String userId, String workspaceId, String twinKey, String name, String type, String sourceDeviceId, JsonNode state) {
        String workspace = workspace(userId, workspaceId);
        if (sourceDeviceId != null && !sourceDeviceId.isBlank() && !workspace.equals(deviceWorkspace(userId, sourceDeviceId))) throw new IllegalArgumentException("数字孪生来源设备不属于当前工作空间");
        String key = token(twinKey, "twin-" + UUID.randomUUID(), 120);
        String id = jdbc.query("SELECT id FROM cloud_twin WHERE workspace_id = ? AND twin_key = ?", (rs, rowNum) -> rs.getString(1), workspace, key).stream().findFirst().orElse(null);
        if (id == null) { id = UUID.randomUUID().toString(); jdbc.update("INSERT INTO cloud_twin (id, workspace_id, twin_key, name, twin_type, source_device_id, state_json, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", id, workspace, key, name(name, "未命名孪生"), token(type, "device", 48), blank(sourceDeviceId), toJson(state == null ? mapper.createObjectNode() : state), userId); }
        else jdbc.update("UPDATE cloud_twin SET name = ?, twin_type = ?, source_device_id = ?, state_json = ?, updated_at = CURRENT_TIMESTAMP(6) WHERE id = ?", name(name, "未命名孪生"), token(type, "device", 48), blank(sourceDeviceId), toJson(state == null ? mapper.createObjectNode() : state), id);
        String twinId = id;
        return listTwins(userId, workspace).stream().filter(row -> twinId.equals(row.get("id"))).findFirst().orElseThrow();
    }

    @Transactional
    public Map<String, Object> updateTwinState(String userId, String twinId, String quality, JsonNode state) {
        String workspace = twinWorkspace(userId, twinId);
        jdbc.update("UPDATE cloud_twin SET state_json = ?, quality = ?, last_state_at = CURRENT_TIMESTAMP(6), updated_at = CURRENT_TIMESTAMP(6) WHERE id = ?", toJson(state == null ? mapper.createObjectNode() : state), token(quality, "unknown", 24), twinId);
        return listTwins(userId, workspace).stream().filter(row -> twinId.equals(row.get("id"))).findFirst().orElseThrow();
    }

    public List<Map<String, Object>> listDataPoints(String userId, String workspaceId) {
        String workspace = workspace(userId, workspaceId);
        return jdbc.query("SELECT p.id, p.point_key, p.label, p.data_type, p.unit, p.status, p.device_id, d.name AS device, p.twin_id, t.name AS twin, p.created_by, p.created_at, (SELECT e.value_json FROM cloud_data_event e WHERE e.point_id = p.id ORDER BY e.occurred_at DESC, e.id DESC LIMIT 1) AS last_value_json, (SELECT e.quality FROM cloud_data_event e WHERE e.point_id = p.id ORDER BY e.occurred_at DESC, e.id DESC LIMIT 1) AS last_quality, (SELECT e.occurred_at FROM cloud_data_event e WHERE e.point_id = p.id ORDER BY e.occurred_at DESC, e.id DESC LIMIT 1) AS last_occurred_at FROM cloud_data_point p LEFT JOIN cloud_device d ON d.id = p.device_id LEFT JOIN cloud_twin t ON t.id = p.twin_id WHERE p.workspace_id = ? ORDER BY p.created_at DESC", (rs, rowNum) -> {
            Map<String, Object> row = new LinkedHashMap<>(); row.put("id", rs.getString("id")); row.put("pointKey", rs.getString("point_key")); row.put("label", rs.getString("label")); row.put("dataType", rs.getString("data_type")); row.put("unit", rs.getString("unit")); row.put("status", rs.getString("status")); row.put("deviceId", rs.getString("device_id")); row.put("device", rs.getString("device")); row.put("twinId", rs.getString("twin_id")); row.put("twin", rs.getString("twin")); row.put("lastValue", jsonNullable(rs.getString("last_value_json"))); row.put("lastQuality", rs.getString("last_quality")); row.put("lastOccurredAt", instantNullable(rs.getTimestamp("last_occurred_at"))); row.put("createdBy", rs.getString("created_by")); row.put("createdAt", instant(rs.getTimestamp("created_at"))); return row;
        }, workspace);
    }

    @Transactional
    public Map<String, Object> createDataPoint(String userId, String workspaceId, String pointKey, String label, String dataType, String unit, String deviceId, String twinId) {
        String workspace = workspace(userId, workspaceId);
        if (deviceId != null && !deviceId.isBlank() && !workspace.equals(deviceWorkspace(userId, deviceId))) throw new IllegalArgumentException("数据点设备不属于当前工作空间");
        if (twinId != null && !twinId.isBlank() && !workspace.equals(twinWorkspace(userId, twinId))) throw new IllegalArgumentException("数据点孪生不属于当前工作空间");
        String id = UUID.randomUUID().toString();
        jdbc.update("INSERT INTO cloud_data_point (id, workspace_id, device_id, twin_id, point_key, label, data_type, unit, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", id, workspace, blank(deviceId), blank(twinId), token(pointKey, "point-" + id.substring(0, 8), 160), name(label, "未命名数据点"), token(dataType, "number", 32), blank(unit), userId);
        return listDataPoints(userId, workspace).stream().filter(row -> id.equals(row.get("id"))).findFirst().orElseThrow();
    }

    public List<Map<String, Object>> listDataEvents(String userId, String workspaceId, String pointId) {
        String workspace = workspace(userId, workspaceId);
        return jdbc.query("SELECT e.id, e.device_id, d.name AS device, e.twin_id, t.name AS twin, e.point_id, p.point_key, e.event_type, e.quality, e.value_json, e.occurred_at, e.received_at FROM cloud_data_event e LEFT JOIN cloud_device d ON d.id = e.device_id LEFT JOIN cloud_twin t ON t.id = e.twin_id LEFT JOIN cloud_data_point p ON p.id = e.point_id WHERE e.workspace_id = ? AND (? IS NULL OR e.point_id = ?) ORDER BY e.occurred_at DESC LIMIT 200", (rs, rowNum) -> {
            Map<String, Object> row = new LinkedHashMap<>(); row.put("id", rs.getLong("id")); row.put("deviceId", rs.getString("device_id")); row.put("device", rs.getString("device")); row.put("twinId", rs.getString("twin_id")); row.put("twin", rs.getString("twin")); row.put("pointId", rs.getString("point_id")); row.put("pointKey", rs.getString("point_key")); row.put("type", rs.getString("event_type")); row.put("quality", rs.getString("quality")); row.put("value", json(rs.getString("value_json"))); row.put("occurredAt", instant(rs.getTimestamp("occurred_at"))); row.put("receivedAt", instant(rs.getTimestamp("received_at"))); return row;
        }, workspace, blank(pointId), blank(pointId));
    }

    @Transactional
    public Map<String, Object> ingestDataEvent(String userId, String workspaceId, String eventType, String quality, JsonNode value, String occurredAt, String deviceId, String twinId, String pointId) {
        String workspace = workspace(userId, workspaceId);
        if (deviceId != null && !deviceId.isBlank() && !workspace.equals(deviceWorkspace(userId, deviceId))) throw new IllegalArgumentException("数据事件设备不属于当前工作空间");
        if (twinId != null && !twinId.isBlank() && !workspace.equals(twinWorkspace(userId, twinId))) throw new IllegalArgumentException("数据事件孪生不属于当前工作空间");
        if (pointId != null && !pointId.isBlank()) { Integer count = jdbc.queryForObject("SELECT COUNT(*) FROM cloud_data_point WHERE id = ? AND workspace_id = ?", Integer.class, pointId, workspace); if (count == null || count == 0) throw new IllegalArgumentException("数据点不存在或不属于当前工作空间"); }
        Instant occurred = occurredAt == null || occurredAt.isBlank() ? Instant.now() : Instant.parse(occurredAt);
        jdbc.update("INSERT INTO cloud_data_event (workspace_id, device_id, twin_id, point_id, event_type, quality, value_json, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", workspace, blank(deviceId), blank(twinId), blank(pointId), token(eventType, "telemetry", 48), token(quality, "unknown", 24), toJson(value == null ? mapper.createObjectNode() : value), Timestamp.from(occurred));
        return listDataEvents(userId, workspace, pointId).stream().findFirst().orElseThrow();
    }

    public List<Map<String, Object>> listAiModels(String userId, String workspaceId) {
        String workspace = workspace(userId, workspaceId);
        return jdbc.query("SELECT id, workspace_id, name, provider, model_key, model_type, status, config_json, created_by, created_at, updated_at FROM cloud_ai_model WHERE workspace_id IS NULL OR workspace_id = ? ORDER BY workspace_id IS NOT NULL, created_at", (rs, rowNum) -> {
            Map<String, Object> row = new LinkedHashMap<>(); row.put("id", rs.getString("id")); row.put("workspaceId", rs.getString("workspace_id")); row.put("name", rs.getString("name")); row.put("provider", rs.getString("provider")); row.put("modelKey", rs.getString("model_key")); row.put("type", rs.getString("model_type")); row.put("status", rs.getString("status")); row.put("config", json(rs.getString("config_json"))); row.put("createdBy", rs.getString("created_by")); row.put("createdAt", instant(rs.getTimestamp("created_at"))); row.put("updatedAt", instant(rs.getTimestamp("updated_at"))); return row;
        }, workspace);
    }

    public List<Map<String, Object>> listAiTasks(String userId, String workspaceId) {
        String workspace = workspace(userId, workspaceId);
        return jdbc.query("SELECT a.id, a.project_id, p.name AS project, a.model_id, m.name AS model, m.provider, a.task_type, a.status, a.input_json, a.output_json, a.error_text, a.requested_by, a.created_at, a.started_at, a.completed_at, a.updated_at FROM cloud_ai_task a LEFT JOIN cloud_project p ON p.id = a.project_id LEFT JOIN cloud_ai_model m ON m.id = a.model_id JOIN cloud_workspace_member wm ON wm.workspace_id = a.workspace_id AND wm.user_id = ? AND wm.status = 'active' WHERE a.workspace_id = ? AND (a.project_id IS NULL OR wm.role IN ('owner', 'admin') OR EXISTS (SELECT 1 FROM cloud_project_member pm WHERE pm.project_id = a.project_id AND pm.user_id = ? AND pm.status = 'active')) ORDER BY a.updated_at DESC LIMIT 100", (rs, rowNum) -> {
            Map<String, Object> row = new LinkedHashMap<>(); row.put("id", rs.getString("id")); row.put("projectId", rs.getString("project_id")); row.put("project", rs.getString("project")); row.put("modelId", rs.getString("model_id")); row.put("model", rs.getString("model")); row.put("provider", rs.getString("provider")); row.put("type", rs.getString("task_type")); row.put("status", rs.getString("status")); row.put("input", json(rs.getString("input_json"))); row.put("output", jsonNullable(rs.getString("output_json"))); row.put("error", rs.getString("error_text")); row.put("requestedBy", rs.getString("requested_by")); row.put("createdAt", instant(rs.getTimestamp("created_at"))); row.put("startedAt", instantNullable(rs.getTimestamp("started_at"))); row.put("completedAt", instantNullable(rs.getTimestamp("completed_at"))); row.put("updatedAt", instant(rs.getTimestamp("updated_at"))); return row;
        }, userId, workspace, userId);
    }

    @Transactional
    public Map<String, Object> queueAiTask(String userId, String workspaceId, String projectId, String modelId, String type, JsonNode input) {
        String workspace = workspace(userId, workspaceId);
        if (projectId != null && !projectId.isBlank()) { Integer count = jdbc.queryForObject("SELECT COUNT(*) FROM cloud_project p WHERE p.id = ? AND p.workspace_id = ?", Integer.class, projectId, workspace); if (count == null || count == 0) throw new IllegalArgumentException("AI 任务项目不存在或不属于当前工作空间"); cloud.assertProjectReader(userId, projectId); }
        String model = modelId == null || modelId.isBlank() ? "00000000-0000-0000-0000-000000000001" : modelId;
        Integer modelCount = jdbc.queryForObject("SELECT COUNT(*) FROM cloud_ai_model WHERE id = ? AND (workspace_id IS NULL OR workspace_id = ?)", Integer.class, model, workspace); if (modelCount == null || modelCount == 0) throw new IllegalArgumentException("AI 模型不存在或未授权");
        String id = UUID.randomUUID().toString();
        jdbc.update("INSERT INTO cloud_ai_task (id, workspace_id, project_id, model_id, task_type, status, input_json, requested_by) VALUES (?, ?, ?, ?, ?, 'queued', ?, ?)", id, workspace, blank(projectId), model, token(type, "agent", 64), toJson(input == null ? mapper.createObjectNode() : input), userId);
        cloud.audit(workspace, userId, "ai-cloud", "ai.task_queued", "ai_task", id, "success", Map.of("modelId", model));
        return listAiTasks(userId, workspace).stream().filter(row -> id.equals(row.get("id"))).findFirst().orElseThrow();
    }

    @Transactional
    public Map<String, Object> runAiTask(String userId, String taskId) {
        Map<String, Object> task = jdbc.query("SELECT id, workspace_id, project_id, model_id, task_type, input_json, status FROM cloud_ai_task WHERE id = ?", (rs, rowNum) -> {
            Map<String, Object> row = new LinkedHashMap<>(); row.put("id", rs.getString("id")); row.put("workspaceId", rs.getString("workspace_id")); row.put("projectId", rs.getString("project_id")); row.put("modelId", rs.getString("model_id")); row.put("type", rs.getString("task_type")); row.put("input", json(rs.getString("input_json"))); row.put("status", rs.getString("status")); return row;
        }, taskId).stream().findFirst().orElseThrow(() -> new IllegalArgumentException("AI 任务不存在"));
        String workspace = workspace(userId, (String) task.get("workspaceId"));
        String currentStatus = (String) task.get("status");
        if (!"queued".equals(currentStatus) && !"failed".equals(currentStatus)) throw new IllegalArgumentException("当前 AI 任务状态不允许执行");
        String modelProvider = jdbc.query("SELECT provider FROM cloud_ai_model WHERE id = ? AND (workspace_id IS NULL OR workspace_id = ?)", (rs, rowNum) -> rs.getString(1), task.get("modelId"), workspace).stream().findFirst().orElseThrow(() -> new IllegalArgumentException("AI 模型不存在或未授权"));
        jdbc.update("UPDATE cloud_ai_task SET status = 'running', error_text = NULL, started_at = CURRENT_TIMESTAMP(6), updated_at = CURRENT_TIMESTAMP(6) WHERE id = ?", taskId);
        try {
            if (!"rule".equals(modelProvider)) throw new IllegalArgumentException("当前模型供应商未配置安全执行器");
            ObjectNode output = mapper.createObjectNode(); output.put("provider", "rule"); output.put("deterministic", true); output.put("taskType", String.valueOf(task.get("type"))); output.put("source", "ForgeCloud server-side facts");
        String project = (String) task.get("projectId");
            if (project != null && !project.isBlank()) cloud.assertProjectReader(userId, project);
            if (project == null || project.isBlank()) {
                output.put("scope", "workspace"); output.put("summary", "规则模型已完成工作空间级事实检查");
                output.put("devices", jdbc.queryForObject("SELECT COUNT(*) FROM cloud_device WHERE workspace_id = ?", Integer.class, workspace)); output.put("dataEvents", jdbc.queryForObject("SELECT COUNT(*) FROM cloud_data_event WHERE workspace_id = ?", Integer.class, workspace));
            } else {
                Map<String, Object> projectRow = jdbc.query("SELECT p.name, v.save_json FROM cloud_project p LEFT JOIN cloud_project_version v ON v.id = p.current_version_id WHERE p.id = ? AND p.workspace_id = ?", (rs, rowNum) -> Map.of("name", rs.getString("name"), "save", json(rs.getString("save_json"))), project, workspace).stream().findFirst().orElseThrow(() -> new IllegalArgumentException("AI 任务项目不存在或不属于当前工作空间"));
                JsonNode save = (JsonNode) projectRow.get("save");
                output.put("scope", "project"); output.put("projectId", project); output.put("projectName", String.valueOf(projectRow.get("name"))); output.put("summary", "规则模型已完成当前项目存档事实摘要");
                output.put("objects", save.path("objects").isArray() ? save.path("objects").size() : 0); output.put("items", save.path("items").isArray() ? save.path("items").size() : 0); output.put("recipes", save.path("recipes").isArray() ? save.path("recipes").size() : 0); output.put("floors", save.path("floorCount").asInt(1));
            }
            String result = toJson(output);
            jdbc.update("UPDATE cloud_ai_task SET status = 'completed', output_json = ?, completed_at = CURRENT_TIMESTAMP(6), updated_at = CURRENT_TIMESTAMP(6) WHERE id = ?", result, taskId);
            cloud.audit(workspace, userId, "ai-cloud", "ai.task_completed", "ai_task", taskId, "success", Map.of("provider", "rule", "deterministic", true));
        } catch (RuntimeException error) {
            String message = error.getMessage() == null ? "规则任务执行失败" : error.getMessage();
            jdbc.update("UPDATE cloud_ai_task SET status = 'failed', error_text = ?, completed_at = CURRENT_TIMESTAMP(6), updated_at = CURRENT_TIMESTAMP(6) WHERE id = ?", message.substring(0, Math.min(2000, message.length())), taskId);
            cloud.audit(workspace, userId, "ai-cloud", "ai.task_failed", "ai_task", taskId, "failed", Map.of("error", message));
        }
        return listAiTasks(userId, workspace).stream().filter(row -> taskId.equals(row.get("id"))).findFirst().orElseThrow();
    }

    private String workspace(String userId, String requested) {
        String resolved = requested;
        if (resolved == null || resolved.isBlank()) resolved = jdbc.query("SELECT workspace_id FROM cloud_workspace_member WHERE user_id = ? AND status = 'active' ORDER BY joined_at LIMIT 1", (rs, rowNum) -> rs.getString(1), userId).stream().findFirst().orElseThrow(() -> new IllegalArgumentException("没有可访问的工作空间"));
        Integer count = jdbc.queryForObject("SELECT COUNT(*) FROM cloud_workspace_member WHERE workspace_id = ? AND user_id = ? AND status = 'active'", Integer.class, resolved, userId);
        if (count == null || count == 0) throw new IllegalArgumentException("工作空间不存在或无权访问");
        return resolved;
    }

    private String deviceWorkspace(String userId, String deviceId) { return ownedResource(userId, "SELECT workspace_id FROM cloud_device WHERE id = ?", deviceId, "设备不存在或无权访问"); }
    private String twinWorkspace(String userId, String twinId) { return ownedResource(userId, "SELECT workspace_id FROM cloud_twin WHERE id = ?", twinId, "数字孪生不存在或无权访问"); }
    private String ownedResource(String userId, String sql, String id, String message) { String workspace = jdbc.query(sql, (rs, rowNum) -> rs.getString(1), id).stream().findFirst().orElseThrow(() -> new IllegalArgumentException(message)); return workspace(userId, workspace); }
    private void assertAdmin(String userId, String workspace) { Integer count = jdbc.queryForObject("SELECT COUNT(*) FROM cloud_workspace_member WHERE workspace_id = ? AND user_id = ? AND status = 'active' AND role IN ('owner', 'admin')", Integer.class, workspace, userId); if (count == null || count == 0) throw new IllegalArgumentException("没有工作空间设备控制权限"); }
    private String token(String value, String fallback, int max) { String normalized = value == null || value.isBlank() ? fallback : value.trim().toLowerCase(); return normalized.substring(0, Math.min(max, normalized.length())); }
    private String name(String value, String fallback) { String normalized = value == null || value.isBlank() ? fallback : value.trim(); return normalized.substring(0, Math.min(160, normalized.length())); }
    private String blank(String value) { return value == null || value.isBlank() ? null : value.trim(); }
    private String instant(Timestamp value) { return value == null ? null : value.toInstant().toString(); }
    private String instantNullable(Timestamp value) { return value == null ? null : value.toInstant().toString(); }
    private JsonNode json(String value) { try { return value == null ? mapper.createObjectNode() : mapper.readTree(value); } catch (IOException e) { return mapper.createObjectNode(); } }
    private JsonNode jsonNullable(String value) { return value == null ? null : json(value); }
    private String toJson(Object value) { try { return mapper.writeValueAsString(value); } catch (IOException e) { throw new IllegalArgumentException("云端 JSON 无法序列化", e); } }
}
