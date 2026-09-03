package com.forgemind.web;

import com.fasterxml.jackson.databind.JsonNode;
import com.forgemind.model.User;
import com.forgemind.repository.CloudWorkspaceDbStore;
import com.forgemind.repository.CloudIntelligenceDbStore;
import com.forgemind.service.AuthService;
import com.forgemind.service.CloudObjectStorageService;
import com.forgemind.service.CloudEventConsumerService;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;
import java.util.Map;
import java.math.BigDecimal;

/** First ForgeCloud API surface. All responses are tenant-filtered server-side. */
@RestController
@RequestMapping("/api/v1")
@CrossOrigin(origins = "*")
public class CloudPlatformController {
    private final CloudWorkspaceDbStore store;
    private final CloudIntelligenceDbStore intelligence;
    private final AuthService auth;
    private final CloudObjectStorageService objects;
    private final CloudEventConsumerService events;

    public CloudPlatformController(CloudWorkspaceDbStore store, CloudIntelligenceDbStore intelligence, AuthService auth, CloudObjectStorageService objects, CloudEventConsumerService events) {
        this.store = store;
        this.intelligence = intelligence;
        this.auth = auth;
        this.objects = objects;
        this.events = events;
    }

    public record CreateWorkspaceRequest(String name) {}
    public record CreateProjectRequest(String workspaceId, String name, JsonNode save) {}
    public record CreateAssetRequest(String workspaceId, String externalId, String kind, String name, String visibility, JsonNode manifest) {}
    public record CreateAssetVersionRequest(JsonNode manifest, String note, String clientMutationId) {}
    public record CreatePublicationRequest(String workspaceId, String sourceType, String sourceId, String forgeLabPostId, JsonNode licenseSnapshot) {}
    public record AddMemberRequest(String username, String role) {}
    public record UpdateMemberRequest(String role) {}
    public record CreateReleaseRequest(String versionId, String name, String notes) {}
    public record CreateProjectVersionRequest(String baseVersionId, String branchName, String note, JsonNode save, String clientMutationId) {}
    public record ProjectMemberRequest(String userId, String role) {}
    public record CreateApprovalRequest(String workspaceId, String projectId, String approvalType, String objectType, String objectId, String title, String detail, JsonNode evidence, boolean rollbackAvailable, String clientMutationId) {}
    public record DecideApprovalRequest(String status, String note) {}
    public record CreateTaskRequest(String workspaceId, String projectId, String type, String title, String detail, String priority, String assigneeUserId, String clientMutationId) {}
    public record UpdateTaskRequest(String status) {}
    public record CreateConnectorRequest(String workspaceId, String name, String type, String endpoint) {}
    public record CreateTagMappingRequest(String workspaceId, String connectorId, String dataPointId, String twinId, String sourceTag, String semanticKey, String unit, JsonNode transform) {}
    public record UpdateTagMappingRequest(String dataPointId, String twinId, String sourceTag, String semanticKey, String unit, JsonNode transform, String status) {}
    public record CreateAssetTwinRequest(String workspaceId, String projectId, String twinId, String factoryObjectId, String externalAssetId, String note) {}
    public record CreateConnectorSyncRequest(String mode, Long sinceEventId, String clientMutationId) {}
    public record RuntimeEventRequest(String eventType, String quality, JsonNode payload, String occurredAt, String source, String externalEventId, String deviceId, String twinId, String pointId, String unit) {}
    public record TelemetryWindowRequest(String workspaceId, String dataPointId, String twinId, String metric, String windowStart, String windowEnd) {}
    public record CreateWorkOrderRequest(String workspaceId, String projectId, String twinId, String externalId, String type, String title, String detail, String status, String priority, String plannedAt, String dueAt, String assignedTo, String clientMutationId) {}
    public record WorkOrderStatusRequest(String status) {}
    public record CreateQualityResultRequest(String workspaceId, String projectId, String twinId, String workOrderId, String lotId, String inspectionType, String result, BigDecimal score, String evidenceRef, String detail, String occurredAt, String clientMutationId) {}
    public record CreateMaintenanceRecordRequest(String workspaceId, String projectId, String twinId, String workOrderId, String faultCode, String action, String result, String startedAt, String completedAt, Long downtimeSeconds, String detail, String clientMutationId) {}
    public record CreateCommentRequest(String workspaceId, String objectType, String objectId, String body) {}
    public record RegisterDeviceRequest(String workspaceId, String deviceKey, String name, String type, String endpoint, JsonNode metadata) {}
    public record DeviceHeartbeatRequest(String status, JsonNode metadata) {}
    public record DeviceCommandRequest(String type, JsonNode command) {}
    public record CreateTwinRequest(String workspaceId, String twinKey, String name, String type, String sourceDeviceId, JsonNode state) {}
    public record TwinStateRequest(String quality, JsonNode state) {}
    public record CreateDataPointRequest(String workspaceId, String pointKey, String label, String dataType, String unit, String deviceId, String twinId) {}
    public record DataEventRequest(String workspaceId, String eventType, String quality, JsonNode value, String occurredAt, String deviceId, String twinId, String pointId) {}
    public record CreateAiTaskRequest(String workspaceId, String projectId, String modelId, String type, JsonNode input) {}

    @GetMapping("/workspaces")
    public List<Map<String, Object>> workspaces(@RequestHeader(value = "Authorization", defaultValue = "") String authorization) {
        return store.listWorkspaces(auth.currentUser(authorization).id());
    }

    @PostMapping("/workspaces")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> createWorkspace(@RequestHeader(value = "Authorization", defaultValue = "") String authorization, @RequestBody CreateWorkspaceRequest request) {
        User user = auth.currentUser(authorization);
        if (request == null) throw new IllegalArgumentException("工作空间请求不能为空");
        return store.createWorkspace(user.id(), request.name());
    }

    @GetMapping("/workspaces/{workspaceId}/overview")
    public Map<String, Object> overview(@RequestHeader(value = "Authorization", defaultValue = "") String authorization, @PathVariable String workspaceId) {
        return store.overview(auth.currentUser(authorization).id(), workspaceId);
    }

    @GetMapping("/workspaces/{workspaceId}/database-status")
    public Map<String, Object> databaseStatus(@RequestHeader(value = "Authorization", defaultValue = "") String authorization, @PathVariable String workspaceId) {
        return store.databaseStatus(auth.currentUser(authorization).id(), workspaceId);
    }

    @GetMapping("/projects")
    public List<Map<String, Object>> projects(@RequestHeader(value = "Authorization", defaultValue = "") String authorization, @RequestParam(value = "workspace_id", required = false) String workspaceId) {
        return store.listProjects(auth.currentUser(authorization).id(), workspaceId);
    }

    @PostMapping("/projects")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> createProject(@RequestHeader(value = "Authorization", defaultValue = "") String authorization, @RequestBody CreateProjectRequest request) {
        User user = auth.currentUser(authorization);
        if (request == null) throw new IllegalArgumentException("项目请求不能为空");
        return store.createProject(user.id(), request.workspaceId(), request.name(), request.save());
    }

    @GetMapping("/projects/{projectId}/versions")
    public List<Map<String, Object>> projectVersions(@RequestHeader(value = "Authorization", defaultValue = "") String authorization, @PathVariable String projectId) {
        return store.listProjectVersions(auth.currentUser(authorization).id(), projectId);
    }

    @PostMapping("/projects/{projectId}/versions")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> createProjectVersion(@RequestHeader(value = "Authorization", defaultValue = "") String authorization, @PathVariable String projectId, @RequestBody CreateProjectVersionRequest request) {
        User user = auth.currentUser(authorization);
        if (request == null) throw new IllegalArgumentException("版本请求不能为空");
        return store.createProjectVersion(user.id(), projectId, request.baseVersionId(), request.branchName(), request.note(), request.save(), request.clientMutationId());
    }

    @GetMapping("/projects/{projectId}/members")
    public List<Map<String, Object>> projectMembers(@RequestHeader(value = "Authorization", defaultValue = "") String authorization, @PathVariable String projectId) {
        return store.listProjectMembers(auth.currentUser(authorization).id(), projectId);
    }

    @PostMapping("/projects/{projectId}/members")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> addProjectMember(@RequestHeader(value = "Authorization", defaultValue = "") String authorization, @PathVariable String projectId, @RequestBody ProjectMemberRequest request) {
        User user = auth.currentUser(authorization);
        if (request == null || request.userId() == null || request.userId().isBlank()) throw new IllegalArgumentException("项目成员请求不能为空");
        return store.addProjectMember(user.id(), projectId, request.userId(), request.role());
    }

    @PatchMapping("/projects/{projectId}/members/{targetUserId}")
    public Map<String, Object> updateProjectMember(@RequestHeader(value = "Authorization", defaultValue = "") String authorization, @PathVariable String projectId, @PathVariable String targetUserId, @RequestBody ProjectMemberRequest request) {
        User user = auth.currentUser(authorization);
        if (request == null) throw new IllegalArgumentException("项目成员请求不能为空");
        return store.updateProjectMember(user.id(), projectId, targetUserId, request.role());
    }

    @DeleteMapping("/projects/{projectId}/members/{targetUserId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void removeProjectMember(@RequestHeader(value = "Authorization", defaultValue = "") String authorization, @PathVariable String projectId, @PathVariable String targetUserId) {
        store.removeProjectMember(auth.currentUser(authorization).id(), projectId, targetUserId);
    }

    @GetMapping("/assets")
    public List<Map<String, Object>> assets(@RequestHeader(value = "Authorization", defaultValue = "") String authorization, @RequestParam(value = "workspace_id", required = false) String workspaceId) {
        return store.listAssets(auth.currentUser(authorization).id(), workspaceId);
    }

    @PostMapping("/assets")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> createAsset(@RequestHeader(value = "Authorization", defaultValue = "") String authorization, @RequestBody CreateAssetRequest request) {
        User user = auth.currentUser(authorization);
        if (request == null) throw new IllegalArgumentException("资源请求不能为空");
        return store.createAsset(user.id(), request.workspaceId(), request.externalId(), request.kind(), request.name(), request.visibility(), request.manifest());
    }

    @GetMapping("/assets/{assetId}/versions")
    public List<Map<String, Object>> assetVersions(@RequestHeader(value = "Authorization", defaultValue = "") String authorization, @PathVariable String assetId) {
        return store.listAssetVersions(auth.currentUser(authorization).id(), assetId);
    }

    @PostMapping("/assets/{assetId}/versions")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> createAssetVersion(@RequestHeader(value = "Authorization", defaultValue = "") String authorization, @PathVariable String assetId, @RequestBody CreateAssetVersionRequest request) {
        User user = auth.currentUser(authorization);
        if (request == null) throw new IllegalArgumentException("资源版本请求不能为空");
        return store.createAssetVersion(user.id(), assetId, request.manifest(), request.note(), request.clientMutationId());
    }

    @GetMapping("/publications")
    public List<Map<String, Object>> publications(@RequestHeader(value = "Authorization", defaultValue = "") String authorization, @RequestParam(value = "workspace_id", required = false) String workspaceId) {
        return store.listPublications(auth.currentUser(authorization).id(), workspaceId);
    }

    @PostMapping("/publications")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> createPublication(@RequestHeader(value = "Authorization", defaultValue = "") String authorization, @RequestBody CreatePublicationRequest request) {
        User user = auth.currentUser(authorization);
        if (request == null) throw new IllegalArgumentException("发布关联请求不能为空");
        return store.createPublication(user.id(), request.workspaceId(), request.sourceType(), request.sourceId(), request.forgeLabPostId(), request.licenseSnapshot());
    }

    @GetMapping("/assets/{assetId}/blobs")
    public List<Map<String, Object>> assetBlobs(@RequestHeader(value = "Authorization", defaultValue = "") String authorization, @PathVariable String assetId) {
        return store.listAssetBlobs(auth.currentUser(authorization).id(), assetId);
    }

    @PostMapping(value = "/assets/{assetId}/blobs", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> uploadAssetBlob(@RequestHeader(value = "Authorization", defaultValue = "") String authorization, @PathVariable String assetId, @RequestPart("file") MultipartFile file) {
        return objects.upload(auth.currentUser(authorization).id(), assetId, file);
    }

    @GetMapping("/assets/blobs/{blobId}/download")
    public ResponseEntity<Resource> downloadAssetBlob(@RequestHeader(value = "Authorization", defaultValue = "") String authorization, @PathVariable String blobId) {
        User user = auth.currentUser(authorization);
        Resource resource = objects.download(user.id(), blobId);
        String mediaType = objects.contentType(user.id(), blobId);
        MediaType parsedType;
        try { parsedType = MediaType.parseMediaType(mediaType); } catch (IllegalArgumentException ignored) { parsedType = MediaType.APPLICATION_OCTET_STREAM; }
        String fileName = objects.fileName(user.id(), blobId).replace("\"", "").replace("\r", "").replace("\n", "");
        return ResponseEntity.ok().contentType(parsedType).header("Content-Disposition", "attachment; filename=\"" + fileName + "\"").body(resource);
    }

    @DeleteMapping("/assets/blobs/{blobId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteAssetBlob(@RequestHeader(value = "Authorization", defaultValue = "") String authorization, @PathVariable String blobId) {
        objects.delete(auth.currentUser(authorization).id(), blobId);
    }

    @GetMapping("/notifications")
    public List<Map<String, Object>> notifications(@RequestHeader(value = "Authorization", defaultValue = "") String authorization) {
        return store.listNotifications(auth.currentUser(authorization).id());
    }

    @PostMapping("/notifications/read-all")
    public Map<String, Object> markNotificationsRead(@RequestHeader(value = "Authorization", defaultValue = "") String authorization) {
        int count = store.markAllNotificationsRead(auth.currentUser(authorization).id());
        return Map.of("marked", count);
    }

    @GetMapping("/audit")
    public List<Map<String, Object>> audit(@RequestHeader(value = "Authorization", defaultValue = "") String authorization, @RequestParam(value = "workspace_id", required = false) String workspaceId) {
        return store.listAudit(auth.currentUser(authorization).id(), workspaceId);
    }

    @GetMapping("/activity")
    public List<Map<String, Object>> activity(@RequestHeader(value = "Authorization", defaultValue = "") String authorization, @RequestParam(value = "workspace_id", required = false) String workspaceId, @RequestParam(value = "event_type", required = false) String eventType, @RequestParam(value = "before_id", required = false) Long beforeId, @RequestParam(value = "limit", defaultValue = "50") int limit) {
        return store.listActivity(auth.currentUser(authorization).id(), workspaceId, eventType, beforeId, limit);
    }

    @GetMapping("/workspaces/{workspaceId}/members")
    public List<Map<String, Object>> members(@RequestHeader(value = "Authorization", defaultValue = "") String authorization, @PathVariable String workspaceId) {
        return store.listMembers(auth.currentUser(authorization).id(), workspaceId);
    }

    @PostMapping("/workspaces/{workspaceId}/members")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> addMember(@RequestHeader(value = "Authorization", defaultValue = "") String authorization, @PathVariable String workspaceId, @RequestBody AddMemberRequest request) {
        User user = auth.currentUser(authorization);
        if (request == null) throw new IllegalArgumentException("成员请求不能为空");
        return store.addMember(user.id(), workspaceId, request.username(), request.role());
    }

    @PatchMapping("/workspaces/{workspaceId}/members/{targetUserId}")
    public Map<String, Object> updateMember(@RequestHeader(value = "Authorization", defaultValue = "") String authorization, @PathVariable String workspaceId, @PathVariable String targetUserId, @RequestBody UpdateMemberRequest request) {
        User user = auth.currentUser(authorization);
        if (request == null) throw new IllegalArgumentException("成员请求不能为空");
        return store.updateMemberRole(user.id(), workspaceId, targetUserId, request.role());
    }

    @GetMapping("/releases")
    public List<Map<String, Object>> releases(@RequestHeader(value = "Authorization", defaultValue = "") String authorization, @RequestParam(value = "workspace_id", required = false) String workspaceId) {
        return store.listReleases(auth.currentUser(authorization).id(), workspaceId);
    }

    @PostMapping("/projects/{projectId}/releases")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> createRelease(@RequestHeader(value = "Authorization", defaultValue = "") String authorization, @PathVariable String projectId, @RequestBody CreateReleaseRequest request) {
        User user = auth.currentUser(authorization);
        if (request == null) throw new IllegalArgumentException("发布请求不能为空");
        return store.createRelease(user.id(), projectId, request.versionId(), request.name(), request.notes());
    }

    @GetMapping("/tasks")
    public List<Map<String, Object>> tasks(@RequestHeader(value = "Authorization", defaultValue = "") String authorization, @RequestParam(value = "workspace_id", required = false) String workspaceId) {
        return store.listTasks(auth.currentUser(authorization).id(), workspaceId);
    }

    @PostMapping("/tasks")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> createTask(@RequestHeader(value = "Authorization", defaultValue = "") String authorization, @RequestBody CreateTaskRequest request) {
        User user = auth.currentUser(authorization);
        if (request == null) throw new IllegalArgumentException("任务请求不能为空");
        return store.createTask(user.id(), request.workspaceId(), request.projectId(), request.type(), request.title(), request.detail(), request.priority(), request.assigneeUserId(), request.clientMutationId());
    }

    @PatchMapping("/tasks/{taskId}")
    public Map<String, Object> updateTask(@RequestHeader(value = "Authorization", defaultValue = "") String authorization, @PathVariable String taskId, @RequestBody UpdateTaskRequest request) {
        User user = auth.currentUser(authorization);
        if (request == null) throw new IllegalArgumentException("任务请求不能为空");
        return store.updateTaskStatus(user.id(), taskId, request.status());
    }

    @GetMapping("/approvals")
    public List<Map<String, Object>> approvals(@RequestHeader(value = "Authorization", defaultValue = "") String authorization, @RequestParam(value = "workspace_id", required = false) String workspaceId) {
        return store.listApprovals(auth.currentUser(authorization).id(), workspaceId);
    }

    @PostMapping("/approvals")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> createApproval(@RequestHeader(value = "Authorization", defaultValue = "") String authorization, @RequestBody CreateApprovalRequest request) {
        User user = auth.currentUser(authorization);
        if (request == null) throw new IllegalArgumentException("审批请求不能为空");
        return store.createApproval(user.id(), request.workspaceId(), request.projectId(), request.approvalType(), request.objectType(), request.objectId(), request.title(), request.detail(), request.evidence(), request.rollbackAvailable(), request.clientMutationId());
    }

    @PostMapping("/approvals/{approvalId}/decision")
    public Map<String, Object> decideApproval(@RequestHeader(value = "Authorization", defaultValue = "") String authorization, @PathVariable String approvalId, @RequestBody DecideApprovalRequest request) {
        User user = auth.currentUser(authorization);
        if (request == null) throw new IllegalArgumentException("审批决策不能为空");
        return store.decideApproval(user.id(), approvalId, request.status(), request.note());
    }

    @GetMapping("/connectors")
    public List<Map<String, Object>> connectors(@RequestHeader(value = "Authorization", defaultValue = "") String authorization, @RequestParam(value = "workspace_id", required = false) String workspaceId) {
        return store.listConnectors(auth.currentUser(authorization).id(), workspaceId);
    }

    @PostMapping("/connectors")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> createConnector(@RequestHeader(value = "Authorization", defaultValue = "") String authorization, @RequestBody CreateConnectorRequest request) {
        User user = auth.currentUser(authorization);
        if (request == null) throw new IllegalArgumentException("连接器请求不能为空");
        return store.createConnector(user.id(), request.workspaceId(), request.name(), request.type(), request.endpoint());
    }

    @GetMapping("/connectors/{connectorId}/events")
    public List<Map<String, Object>> runtimeEvents(@RequestHeader(value = "Authorization", defaultValue = "") String authorization, @PathVariable String connectorId, @RequestParam(value = "workspace_id", required = false) String workspaceId) {
        return store.listRuntimeEvents(auth.currentUser(authorization).id(), workspaceId, connectorId);
    }

    @PostMapping("/connectors/{connectorId}/events")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> appendRuntimeEvent(@RequestHeader(value = "Authorization", defaultValue = "") String authorization, @PathVariable String connectorId, @RequestBody RuntimeEventRequest request) {
        User user = auth.currentUser(authorization);
        if (request == null) throw new IllegalArgumentException("运行事件不能为空");
        return store.appendRuntimeEvent(user.id(), connectorId, request.eventType(), request.quality(), request.payload(), request.occurredAt(), request.source(), request.externalEventId(), request.deviceId(), request.twinId(), request.pointId(), request.unit());
    }

    @GetMapping("/runtime/events")
    public List<Map<String, Object>> workspaceRuntimeEvents(@RequestHeader(value = "Authorization", defaultValue = "") String authorization, @RequestParam(value = "workspace_id", required = false) String workspaceId) {
        return store.listRuntimeEvents(auth.currentUser(authorization).id(), workspaceId, null);
    }

    @GetMapping("/connectors/{connectorId}/sync-runs")
    public List<Map<String, Object>> connectorSyncRuns(@RequestHeader(value = "Authorization", defaultValue = "") String authorization, @PathVariable String connectorId, @RequestParam(value = "workspace_id", required = false) String workspaceId) {
        return store.listConnectorSyncRuns(auth.currentUser(authorization).id(), workspaceId, connectorId);
    }

    @PostMapping("/connectors/{connectorId}/sync-runs")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> runConnectorSync(@RequestHeader(value = "Authorization", defaultValue = "") String authorization, @PathVariable String connectorId, @RequestBody CreateConnectorSyncRequest request) {
        User user = auth.currentUser(authorization);
        if (request == null) throw new IllegalArgumentException("同步任务请求不能为空");
        return store.runConnectorSync(user.id(), connectorId, request.mode(), request.sinceEventId(), request.clientMutationId());
    }

    @GetMapping("/data/mappings")
    public List<Map<String, Object>> tagMappings(@RequestHeader(value = "Authorization", defaultValue = "") String authorization, @RequestParam(value = "workspace_id", required = false) String workspaceId) {
        return store.listTagMappings(auth.currentUser(authorization).id(), workspaceId);
    }

    @PostMapping("/data/mappings")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> createTagMapping(@RequestHeader(value = "Authorization", defaultValue = "") String authorization, @RequestBody CreateTagMappingRequest request) {
        User user = auth.currentUser(authorization);
        if (request == null) throw new IllegalArgumentException("数据映射请求不能为空");
        return store.createTagMapping(user.id(), request.workspaceId(), request.connectorId(), request.dataPointId(), request.twinId(), request.sourceTag(), request.semanticKey(), request.unit(), request.transform());
    }

    @PatchMapping("/data/mappings/{mappingId}")
    public Map<String, Object> updateTagMapping(@RequestHeader(value = "Authorization", defaultValue = "") String authorization, @PathVariable String mappingId, @RequestBody UpdateTagMappingRequest request) {
        User user = auth.currentUser(authorization);
        if (request == null) throw new IllegalArgumentException("数据映射请求不能为空");
        return store.updateTagMapping(user.id(), mappingId, request.dataPointId(), request.twinId(), request.sourceTag(), request.semanticKey(), request.unit(), request.transform(), request.status());
    }

    @GetMapping("/twins/mappings")
    public List<Map<String, Object>> assetTwins(@RequestHeader(value = "Authorization", defaultValue = "") String authorization, @RequestParam(value = "workspace_id", required = false) String workspaceId) {
        return store.listAssetTwins(auth.currentUser(authorization).id(), workspaceId);
    }

    @PostMapping("/twins/mappings")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> createAssetTwin(@RequestHeader(value = "Authorization", defaultValue = "") String authorization, @RequestBody CreateAssetTwinRequest request) {
        User user = auth.currentUser(authorization);
        if (request == null) throw new IllegalArgumentException("孪生映射请求不能为空");
        return store.createAssetTwin(user.id(), request.workspaceId(), request.projectId(), request.twinId(), request.factoryObjectId(), request.externalAssetId(), request.note());
    }

    @GetMapping("/devices")
    public List<Map<String, Object>> devices(@RequestHeader(value = "Authorization", defaultValue = "") String authorization, @RequestParam(value = "workspace_id", required = false) String workspaceId) {
        return intelligence.listDevices(auth.currentUser(authorization).id(), workspaceId);
    }

    @PostMapping("/devices")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> registerDevice(@RequestHeader(value = "Authorization", defaultValue = "") String authorization, @RequestBody RegisterDeviceRequest request) {
        User user = auth.currentUser(authorization); if (request == null) throw new IllegalArgumentException("设备请求不能为空");
        return intelligence.registerDevice(user.id(), request.workspaceId(), request.deviceKey(), request.name(), request.type(), request.endpoint(), request.metadata());
    }

    @PostMapping("/devices/{deviceId}/heartbeat")
    public Map<String, Object> heartbeat(@RequestHeader(value = "Authorization", defaultValue = "") String authorization, @PathVariable String deviceId, @RequestBody(required = false) DeviceHeartbeatRequest request) {
        DeviceHeartbeatRequest body = request == null ? new DeviceHeartbeatRequest("online", null) : request;
        return intelligence.heartbeat(auth.currentUser(authorization).id(), deviceId, body.status(), body.metadata());
    }

    @GetMapping("/devices/{deviceId}/commands")
    public List<Map<String, Object>> deviceCommands(@RequestHeader(value = "Authorization", defaultValue = "") String authorization, @PathVariable String deviceId, @RequestParam(value = "workspace_id", required = false) String workspaceId) {
        return intelligence.listCommands(auth.currentUser(authorization).id(), workspaceId, deviceId);
    }

    @PostMapping("/devices/{deviceId}/commands")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> queueDeviceCommand(@RequestHeader(value = "Authorization", defaultValue = "") String authorization, @PathVariable String deviceId, @RequestBody DeviceCommandRequest request) {
        User user = auth.currentUser(authorization); if (request == null) throw new IllegalArgumentException("设备命令不能为空");
        return intelligence.queueCommand(user.id(), deviceId, request.type(), request.command());
    }

    @GetMapping("/twins")
    public List<Map<String, Object>> twins(@RequestHeader(value = "Authorization", defaultValue = "") String authorization, @RequestParam(value = "workspace_id", required = false) String workspaceId) {
        return intelligence.listTwins(auth.currentUser(authorization).id(), workspaceId);
    }

    @PostMapping("/twins")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> createTwin(@RequestHeader(value = "Authorization", defaultValue = "") String authorization, @RequestBody CreateTwinRequest request) {
        User user = auth.currentUser(authorization); if (request == null) throw new IllegalArgumentException("数字孪生请求不能为空");
        return intelligence.createTwin(user.id(), request.workspaceId(), request.twinKey(), request.name(), request.type(), request.sourceDeviceId(), request.state());
    }

    @PostMapping("/twins/{twinId}/state")
    public Map<String, Object> twinState(@RequestHeader(value = "Authorization", defaultValue = "") String authorization, @PathVariable String twinId, @RequestBody TwinStateRequest request) {
        User user = auth.currentUser(authorization); if (request == null) throw new IllegalArgumentException("孪生状态不能为空");
        return intelligence.updateTwinState(user.id(), twinId, request.quality(), request.state());
    }

    @GetMapping("/data/points")
    public List<Map<String, Object>> dataPoints(@RequestHeader(value = "Authorization", defaultValue = "") String authorization, @RequestParam(value = "workspace_id", required = false) String workspaceId) {
        return intelligence.listDataPoints(auth.currentUser(authorization).id(), workspaceId);
    }

    @PostMapping("/data/points")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> createDataPoint(@RequestHeader(value = "Authorization", defaultValue = "") String authorization, @RequestBody CreateDataPointRequest request) {
        User user = auth.currentUser(authorization); if (request == null) throw new IllegalArgumentException("数据点请求不能为空");
        return intelligence.createDataPoint(user.id(), request.workspaceId(), request.pointKey(), request.label(), request.dataType(), request.unit(), request.deviceId(), request.twinId());
    }

    @GetMapping("/data/events")
    public List<Map<String, Object>> dataEvents(@RequestHeader(value = "Authorization", defaultValue = "") String authorization, @RequestParam(value = "workspace_id", required = false) String workspaceId, @RequestParam(value = "point_id", required = false) String pointId) {
        return intelligence.listDataEvents(auth.currentUser(authorization).id(), workspaceId, pointId);
    }

    @PostMapping("/data/events")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> ingestDataEvent(@RequestHeader(value = "Authorization", defaultValue = "") String authorization, @RequestBody DataEventRequest request) {
        User user = auth.currentUser(authorization); if (request == null) throw new IllegalArgumentException("数据事件不能为空");
        return intelligence.ingestDataEvent(user.id(), request.workspaceId(), request.eventType(), request.quality(), request.value(), request.occurredAt(), request.deviceId(), request.twinId(), request.pointId());
    }

    @GetMapping("/data/windows")
    public List<Map<String, Object>> telemetryWindows(@RequestHeader(value = "Authorization", defaultValue = "") String authorization, @RequestParam(value = "workspace_id", required = false) String workspaceId, @RequestParam(value = "point_id", required = false) String dataPointId, @RequestParam(value = "twin_id", required = false) String twinId) {
        return store.listTelemetryWindows(auth.currentUser(authorization).id(), workspaceId, dataPointId, twinId);
    }

    @PostMapping("/data/windows/aggregate")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> aggregateTelemetryWindow(@RequestHeader(value = "Authorization", defaultValue = "") String authorization, @RequestBody TelemetryWindowRequest request) {
        User user = auth.currentUser(authorization); if (request == null) throw new IllegalArgumentException("遥测窗口请求不能为空");
        return store.aggregateTelemetryWindow(user.id(), request.workspaceId(), request.dataPointId(), request.twinId(), request.metric(), request.windowStart(), request.windowEnd());
    }

    @GetMapping("/work-orders")
    public List<Map<String, Object>> workOrders(@RequestHeader(value = "Authorization", defaultValue = "") String authorization, @RequestParam(value = "workspace_id", required = false) String workspaceId) {
        return store.listWorkOrders(auth.currentUser(authorization).id(), workspaceId);
    }

    @PostMapping("/work-orders")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> createWorkOrder(@RequestHeader(value = "Authorization", defaultValue = "") String authorization, @RequestBody CreateWorkOrderRequest request) {
        User user = auth.currentUser(authorization); if (request == null) throw new IllegalArgumentException("工单请求不能为空");
        return store.createWorkOrder(user.id(), request.workspaceId(), request.projectId(), request.twinId(), request.externalId(), request.type(), request.title(), request.detail(), request.status(), request.priority(), request.plannedAt(), request.dueAt(), request.assignedTo(), request.clientMutationId());
    }

    @PatchMapping("/work-orders/{workOrderId}")
    public Map<String, Object> updateWorkOrder(@RequestHeader(value = "Authorization", defaultValue = "") String authorization, @PathVariable String workOrderId, @RequestBody WorkOrderStatusRequest request) {
        if (request == null) throw new IllegalArgumentException("工单状态不能为空");
        return store.updateWorkOrderStatus(auth.currentUser(authorization).id(), workOrderId, request.status());
    }

    @GetMapping("/quality/results")
    public List<Map<String, Object>> qualityResults(@RequestHeader(value = "Authorization", defaultValue = "") String authorization, @RequestParam(value = "workspace_id", required = false) String workspaceId) {
        return store.listQualityResults(auth.currentUser(authorization).id(), workspaceId);
    }

    @PostMapping("/quality/results")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> createQualityResult(@RequestHeader(value = "Authorization", defaultValue = "") String authorization, @RequestBody CreateQualityResultRequest request) {
        User user = auth.currentUser(authorization); if (request == null) throw new IllegalArgumentException("质量结果请求不能为空");
        return store.createQualityResult(user.id(), request.workspaceId(), request.projectId(), request.twinId(), request.workOrderId(), request.lotId(), request.inspectionType(), request.result(), request.score(), request.evidenceRef(), request.detail(), request.occurredAt(), request.clientMutationId());
    }

    @GetMapping("/maintenance/records")
    public List<Map<String, Object>> maintenanceRecords(@RequestHeader(value = "Authorization", defaultValue = "") String authorization, @RequestParam(value = "workspace_id", required = false) String workspaceId) {
        return store.listMaintenanceRecords(auth.currentUser(authorization).id(), workspaceId);
    }

    @PostMapping("/maintenance/records")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> createMaintenanceRecord(@RequestHeader(value = "Authorization", defaultValue = "") String authorization, @RequestBody CreateMaintenanceRecordRequest request) {
        User user = auth.currentUser(authorization); if (request == null) throw new IllegalArgumentException("维护记录请求不能为空");
        return store.createMaintenanceRecord(user.id(), request.workspaceId(), request.projectId(), request.twinId(), request.workOrderId(), request.faultCode(), request.action(), request.result(), request.startedAt(), request.completedAt(), request.downtimeSeconds(), request.detail(), request.clientMutationId());
    }

    @GetMapping("/ai/models")
    public List<Map<String, Object>> aiModels(@RequestHeader(value = "Authorization", defaultValue = "") String authorization, @RequestParam(value = "workspace_id", required = false) String workspaceId) {
        return intelligence.listAiModels(auth.currentUser(authorization).id(), workspaceId);
    }

    @GetMapping("/ai/tasks")
    public List<Map<String, Object>> aiTasks(@RequestHeader(value = "Authorization", defaultValue = "") String authorization, @RequestParam(value = "workspace_id", required = false) String workspaceId) {
        return intelligence.listAiTasks(auth.currentUser(authorization).id(), workspaceId);
    }

    @PostMapping("/ai/tasks")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> queueAiTask(@RequestHeader(value = "Authorization", defaultValue = "") String authorization, @RequestBody CreateAiTaskRequest request) {
        User user = auth.currentUser(authorization); if (request == null) throw new IllegalArgumentException("AI 任务不能为空");
        return intelligence.queueAiTask(user.id(), request.workspaceId(), request.projectId(), request.modelId(), request.type(), request.input());
    }

    @PostMapping("/ai/tasks/{taskId}/run")
    public Map<String, Object> runAiTask(@RequestHeader(value = "Authorization", defaultValue = "") String authorization, @PathVariable String taskId) {
        return intelligence.runAiTask(auth.currentUser(authorization).id(), taskId);
    }

    @GetMapping("/mobile/summary")
    public Map<String, Object> mobileSummary(@RequestHeader(value = "Authorization", defaultValue = "") String authorization, @RequestParam(value = "workspace_id", required = false) String workspaceId) {
        return store.mobileSummary(auth.currentUser(authorization).id(), workspaceId);
    }

    @GetMapping("/comments")
    public List<Map<String, Object>> comments(@RequestHeader(value = "Authorization", defaultValue = "") String authorization, @RequestParam(value = "workspace_id", required = false) String workspaceId, @RequestParam String objectType, @RequestParam String objectId) {
        return store.listComments(auth.currentUser(authorization).id(), workspaceId, objectType, objectId);
    }

    @PostMapping("/comments")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> createComment(@RequestHeader(value = "Authorization", defaultValue = "") String authorization, @RequestBody CreateCommentRequest request) {
        User user = auth.currentUser(authorization);
        if (request == null) throw new IllegalArgumentException("评论请求不能为空");
        return store.createComment(user.id(), request.workspaceId(), request.objectType(), request.objectId(), request.body());
    }

    @ExceptionHandler(IllegalArgumentException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public Map<String, String> onBadRequest(IllegalArgumentException e) {
        return Map.of("error", e.getMessage() == null ? "请求非法" : e.getMessage());
    }

    @ExceptionHandler(CloudWorkspaceDbStore.VersionConflictException.class)
    @ResponseStatus(HttpStatus.CONFLICT)
    public Map<String, Object> onVersionConflict(CloudWorkspaceDbStore.VersionConflictException e) {
        return Map.of("code", "VERSION_CONFLICT", "error", e.getMessage(), "projectId", e.projectId(), "currentVersionId", e.currentVersionId() == null ? "" : e.currentVersionId(), "baseVersionId", e.baseVersionId() == null ? "" : e.baseVersionId());
    }
}
