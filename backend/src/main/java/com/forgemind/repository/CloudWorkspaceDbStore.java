package com.forgemind.repository;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.forgemind.service.CloudProjectionService;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.io.IOException;
import java.math.BigDecimal;
import java.time.Instant;
import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.dao.DuplicateKeyException;

@Repository
public class CloudWorkspaceDbStore {
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;
    private final CloudProjectionService projection;

    public CloudWorkspaceDbStore(JdbcTemplate jdbc, ObjectMapper mapper, CloudProjectionService projection) {
        this.jdbc = jdbc;
        this.mapper = mapper;
        this.projection = projection;
    }

    public List<Map<String, Object>> listWorkspaces(String userId) {
        return jdbc.query("""
                SELECT w.id, w.name, w.slug, w.workspace_type, w.status, w.created_at, w.updated_at,
                       wm.role, (SELECT COUNT(*) FROM cloud_project p WHERE p.workspace_id = w.id) AS project_count,
                       (SELECT COUNT(*) FROM cloud_workspace_member m2 WHERE m2.workspace_id = w.id AND m2.status = 'active') AS member_count
                FROM cloud_workspace w JOIN cloud_workspace_member wm ON wm.workspace_id = w.id
                WHERE wm.user_id = ? AND wm.status = 'active'
                ORDER BY w.created_at
                """, (rs, rowNum) -> {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("id", rs.getString("id")); item.put("name", rs.getString("name")); item.put("slug", rs.getString("slug"));
            item.put("type", rs.getString("workspace_type")); item.put("status", rs.getString("status")); item.put("role", rs.getString("role"));
            item.put("projectCount", rs.getInt("project_count")); item.put("memberCount", rs.getInt("member_count"));
            item.put("createdAt", instant(rs.getTimestamp("created_at"))); item.put("updatedAt", instant(rs.getTimestamp("updated_at")));
            return item;
        }, userId);
    }

    @Transactional
    public Map<String, Object> createWorkspace(String userId, String name) {
        String normalized = normalizeName(name);
        String id = UUID.randomUUID().toString();
        String slug = "ws-" + id;
        jdbc.update("INSERT INTO cloud_workspace (id, owner_user_id, name, slug, workspace_type, status) VALUES (?, ?, ?, ?, 'team', 'active')", id, userId, normalized, slug);
        jdbc.update("INSERT INTO cloud_workspace_member (workspace_id, user_id, role, status) VALUES (?, ?, 'owner', 'active')", id, userId);
        audit(id, userId, "cloud", "workspace.created", "workspace", id, "success", Map.of("name", normalized));
        return listWorkspaces(userId).stream().filter(item -> id.equals(item.get("id"))).findFirst().orElseThrow();
    }

    public String defaultWorkspaceId(String userId) {
        String id = jdbc.query("SELECT w.id FROM cloud_workspace w JOIN cloud_workspace_member m ON m.workspace_id = w.id WHERE m.user_id = ? AND m.status = 'active' ORDER BY w.owner_user_id = ? DESC, w.created_at LIMIT 1", (rs, rowNum) -> rs.getString(1), userId, userId).stream().findFirst().orElse(null);
        return id == null ? projection.ensureWorkspace(userId) : id;
    }

    public List<Map<String, Object>> listProjects(String userId, String workspaceId) {
        String workspace = resolveWorkspace(userId, workspaceId);
        projection.syncAllForUser(userId);
        return jdbc.query("""
                SELECT p.id, p.name, p.project_type, p.visibility, p.status, p.current_version_id,
                       COALESCE(pm.role, CASE WHEN m.role IN ('owner', 'admin') THEN 'manager' ELSE NULL END) AS project_role,
                       p.created_at, p.updated_at, v.version_no, v.branch_name, v.schema_version, v.content_hash,
                       v.created_at AS version_created_at
                FROM cloud_project p
                JOIN cloud_workspace_member m ON m.workspace_id = p.workspace_id AND m.user_id = ? AND m.status = 'active'
                LEFT JOIN cloud_project_member pm ON pm.project_id = p.id AND pm.user_id = ? AND pm.status = 'active'
                LEFT JOIN cloud_project_version v ON v.id = p.current_version_id
                WHERE p.workspace_id = ? AND (m.role IN ('owner', 'admin') OR pm.user_id IS NOT NULL)
                ORDER BY p.updated_at DESC
                """, (rs, rowNum) -> {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("id", rs.getString("id")); item.put("name", rs.getString("name")); item.put("type", rs.getString("project_type"));
            item.put("visibility", rs.getString("visibility")); item.put("status", rs.getString("status"));
            item.put("accessRole", rs.getString("project_role"));
            item.put("currentVersionId", rs.getString("current_version_id")); item.put("version", rs.getInt("version_no"));
            item.put("branch", rs.getString("branch_name")); item.put("schemaVersion", rs.getInt("schema_version"));
            item.put("contentHash", rs.getString("content_hash")); item.put("createdAt", instant(rs.getTimestamp("created_at")));
            item.put("updatedAt", instant(rs.getTimestamp("updated_at"))); item.put("versionCreatedAt", instant(rs.getTimestamp("version_created_at")));
            return item;
        }, userId, userId, workspace);
    }

    @Transactional
    public Map<String, Object> createProject(String userId, String workspaceId, String name, JsonNode save) {
        String workspace = resolveWorkspace(userId, workspaceId);
        validateSave(save);
        String projectId = UUID.randomUUID().toString();
        String versionId = UUID.randomUUID().toString();
        String normalizedName = normalizeName(name == null || name.isBlank() ? save.path("name").asText("未命名工厂") : name);
        String saveJson = toJson(save);
        int schemaVersion = save.path("version").asInt(1);
        String hash = projection.contentHash(saveJson);
        jdbc.update("INSERT INTO factory (id, owner_user_id, name, schema_version, width, depth, save_json) VALUES (?, ?, ?, ?, ?, ?, ?)", projectId, userId, normalizedName, schemaVersion, 48, 48, saveJson);
        jdbc.update("INSERT INTO factory_member (factory_id, user_id, role) VALUES (?, ?, 'owner')", projectId, userId);
        jdbc.update("INSERT INTO cloud_project (id, workspace_id, owner_user_id, name, project_type, visibility, status) VALUES (?, ?, ?, ?, 'factory', 'private', 'active')", projectId, workspace, userId, normalizedName);
        jdbc.update("INSERT INTO cloud_project_member (project_id, user_id, role, status) VALUES (?, ?, 'manager', 'active')", projectId, userId);
        jdbc.update("INSERT INTO cloud_project_version (id, project_id, version_no, branch_name, schema_version, content_hash, save_json, note, created_by) VALUES (?, ?, 1, 'main', ?, ?, ?, 'Created in ForgeCloud', ?)", versionId, projectId, schemaVersion, hash, saveJson, userId);
        jdbc.update("UPDATE cloud_project SET current_version_id = ? WHERE id = ?", versionId, projectId);
        audit(workspace, userId, "cloud", "project.created", "project", projectId, "success", Map.of("name", normalizedName, "versionId", versionId));
        return listProjects(userId, workspace).stream().filter(item -> projectId.equals(item.get("id"))).findFirst().orElseThrow();
    }

    public List<Map<String, Object>> listProjectVersions(String userId, String projectId) {
        assertProjectAccess(userId, projectId);
        return jdbc.query("""
                SELECT id, parent_version_id, version_no, branch_name, schema_version, content_hash, note, created_by, client_mutation_id, created_at
                FROM cloud_project_version WHERE project_id = ? ORDER BY version_no DESC, created_at DESC
                """, (rs, rowNum) -> {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("id", rs.getString("id")); item.put("parentVersionId", rs.getString("parent_version_id")); item.put("version", rs.getInt("version_no"));
            item.put("branch", rs.getString("branch_name")); item.put("schemaVersion", rs.getInt("schema_version")); item.put("contentHash", rs.getString("content_hash"));
            item.put("note", rs.getString("note")); item.put("createdBy", rs.getString("created_by")); item.put("clientMutationId", rs.getString("client_mutation_id")); item.put("createdAt", instant(rs.getTimestamp("created_at")));
            return item;
        }, projectId);
    }

    public List<Map<String, Object>> listProjectMembers(String userId, String projectId) {
        assertProjectAccess(userId, projectId);
        return jdbc.query("""
                SELECT pm.user_id, u.username, pm.role, pm.status, pm.joined_at
                FROM cloud_project_member pm JOIN app_user u ON u.id = pm.user_id
                WHERE pm.project_id = ? ORDER BY FIELD(pm.role, 'manager', 'editor', 'viewer'), pm.joined_at
                """, (rs, rowNum) -> {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("userId", rs.getString("user_id")); item.put("username", rs.getString("username"));
            item.put("role", rs.getString("role")); item.put("status", rs.getString("status"));
            item.put("joinedAt", instant(rs.getTimestamp("joined_at"))); return item;
        }, projectId);
    }

    @Transactional
    public Map<String, Object> addProjectMember(String userId, String projectId, String targetUserId, String role) {
        assertProjectAdmin(userId, projectId);
        String workspace = projectWorkspace(projectId);
        Integer active = jdbc.queryForObject("SELECT COUNT(*) FROM cloud_workspace_member WHERE workspace_id = ? AND user_id = ? AND status = 'active'", Integer.class, workspace, targetUserId);
        if (active == null || active == 0) throw new IllegalArgumentException("目标用户不是当前工作空间成员");
        String normalized = normalizeProjectRole(role);
        jdbc.update("INSERT INTO cloud_project_member (project_id, user_id, role, status) VALUES (?, ?, ?, 'active') ON DUPLICATE KEY UPDATE role = VALUES(role), status = 'active'", projectId, targetUserId, normalized);
        audit(workspace, userId, "cloud", "project.member_added", "project", projectId, "success", Map.of("userId", targetUserId, "role", normalized));
        notifyUser(workspace, targetUserId, "project_access", "项目访问权限已更新", "你已获得项目的 " + normalized + " 权限", "project", projectId);
        return listProjectMembers(userId, projectId).stream().filter(item -> targetUserId.equals(item.get("userId"))).findFirst().orElseThrow();
    }

    @Transactional
    public Map<String, Object> updateProjectMember(String userId, String projectId, String targetUserId, String role) {
        assertProjectAdmin(userId, projectId);
        String owner = jdbc.queryForObject("SELECT owner_user_id FROM cloud_project WHERE id = ?", String.class, projectId);
        if (targetUserId.equals(owner)) throw new IllegalArgumentException("项目所有者角色不可修改");
        String normalized = normalizeProjectRole(role);
        int changed = jdbc.update("UPDATE cloud_project_member SET role = ? WHERE project_id = ? AND user_id = ? AND status = 'active'", normalized, projectId, targetUserId);
        if (changed == 0) throw new IllegalArgumentException("项目成员不存在或已离开项目");
        String workspace = projectWorkspace(projectId);
        audit(workspace, userId, "cloud", "project.member_role_updated", "project", projectId, "success", Map.of("userId", targetUserId, "role", normalized));
        return listProjectMembers(userId, projectId).stream().filter(item -> targetUserId.equals(item.get("userId"))).findFirst().orElseThrow();
    }

    @Transactional
    public void removeProjectMember(String userId, String projectId, String targetUserId) {
        assertProjectAdmin(userId, projectId);
        String owner = jdbc.queryForObject("SELECT owner_user_id FROM cloud_project WHERE id = ?", String.class, projectId);
        if (targetUserId.equals(owner)) throw new IllegalArgumentException("项目所有者不可移除");
        int changed = jdbc.update("UPDATE cloud_project_member SET status = 'removed' WHERE project_id = ? AND user_id = ? AND status = 'active'", projectId, targetUserId);
        if (changed == 0) throw new IllegalArgumentException("项目成员不存在或已离开项目");
        String workspace = projectWorkspace(projectId);
        audit(workspace, userId, "cloud", "project.member_removed", "project", projectId, "success", Map.of("userId", targetUserId));
    }

    @Transactional
    public Map<String, Object> createProjectVersion(String userId, String projectId, String baseVersionId, String branchName, String note, JsonNode save, String clientMutationId) {
        assertProjectRole(userId, projectId, "editor");
        String mutationId = mutationId(clientMutationId);
        if (mutationId != null) {
            String existingId = jdbc.query("SELECT id FROM cloud_project_version WHERE project_id = ? AND created_by = ? AND client_mutation_id = ?", (rs, rowNum) -> rs.getString(1), projectId, userId, mutationId).stream().findFirst().orElse(null);
            if (existingId != null) return listProjectVersions(userId, projectId).stream().filter(item -> existingId.equals(item.get("id"))).findFirst().orElseThrow();
        }
        String branch = normalizeToken(branchName, "main", 96);
        if (!"main".equals(branch)) throw new IllegalArgumentException("当前版本提交基线仅支持 main 分支");
        String currentVersionId = jdbc.query("SELECT COALESCE(current_version_id, '') FROM cloud_project WHERE id = ?", (rs, rowNum) -> rs.getString(1), projectId)
                .stream().findFirst().map(value -> value.isBlank() ? null : value).orElse(null);
        if (baseVersionId == null || !baseVersionId.equals(currentVersionId)) throw new VersionConflictException(projectId, currentVersionId, baseVersionId);
        validateSave(save);
        Integer nextVersion = jdbc.queryForObject("SELECT COALESCE(MAX(version_no), 0) + 1 FROM cloud_project_version WHERE project_id = ? AND branch_name = ?", Integer.class, projectId, branch);
        String versionId = UUID.randomUUID().toString();
        String saveJson = toJson(save);
        String hash = projection.contentHash(saveJson);
        int schemaVersion = save.path("version").asInt(1);
        try {
            jdbc.update("INSERT INTO cloud_project_version (id, project_id, parent_version_id, version_no, branch_name, schema_version, content_hash, save_json, note, created_by, client_mutation_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", versionId, projectId, currentVersionId, nextVersion == null ? 1 : nextVersion, branch, schemaVersion, hash, saveJson, note, userId, mutationId);
        } catch (DuplicateKeyException duplicate) {
            if (mutationId != null) return listProjectVersions(userId, projectId).stream().filter(item -> mutationId.equals(item.get("clientMutationId"))).findFirst().orElseThrow(() -> duplicate);
            throw duplicate;
        }
        String projectName = normalizeName(save.path("name").asText("未命名工厂"));
        jdbc.update("UPDATE cloud_project SET current_version_id = ?, name = ?, updated_at = CURRENT_TIMESTAMP(6) WHERE id = ? AND current_version_id = ?", versionId, projectName, projectId, currentVersionId);
        int factoryChanged = jdbc.update("UPDATE factory SET name = ?, schema_version = ?, save_json = ?, updated_at = CURRENT_TIMESTAMP(6) WHERE id = ?", projectName, schemaVersion, saveJson, projectId);
        if (factoryChanged == 0) throw new IllegalArgumentException("兼容工厂项目不存在");
        String workspace = jdbc.queryForObject("SELECT workspace_id FROM cloud_project WHERE id = ?", String.class, projectId);
        audit(workspace, userId, "cloud", "project.version_created", "project_version", versionId, "success", Map.of("projectId", projectId, "baseVersionId", currentVersionId, "branch", branch));
        return listProjectVersions(userId, projectId).stream().filter(item -> versionId.equals(item.get("id"))).findFirst().orElseThrow();
    }

    public List<Map<String, Object>> listAssets(String userId, String workspaceId) {
        String workspace = resolveWorkspace(userId, workspaceId);
        projection.syncAssetsForUser(userId);
        return jdbc.query("""
                SELECT a.id, a.external_id, a.kind, a.name, a.visibility, a.status, a.current_version_id,
                       a.created_at, a.updated_at, v.version_no, v.content_hash, v.manifest_version, v.manifest_json,
                       (SELECT COUNT(*) FROM cloud_asset_blob b WHERE b.asset_version_id = v.id AND b.status = 'available') AS file_count
                FROM cloud_asset a
                JOIN cloud_workspace_member m ON m.workspace_id = a.workspace_id AND m.user_id = ? AND m.status = 'active'
                LEFT JOIN cloud_asset_version v ON v.id = a.current_version_id
                WHERE a.workspace_id = ? ORDER BY a.updated_at DESC
                """, (rs, rowNum) -> {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("id", rs.getString("id")); item.put("externalId", rs.getString("external_id")); item.put("kind", rs.getString("kind"));
            item.put("name", rs.getString("name")); item.put("visibility", rs.getString("visibility")); item.put("status", rs.getString("status"));
            item.put("currentVersionId", rs.getString("current_version_id")); item.put("version", rs.getInt("version_no")); item.put("fileCount", rs.getInt("file_count"));
            item.put("contentHash", rs.getString("content_hash")); item.put("manifestVersion", rs.getInt("manifest_version")); item.put("manifest", json(rs.getString("manifest_json"))); item.put("createdAt", instant(rs.getTimestamp("created_at"))); item.put("updatedAt", instant(rs.getTimestamp("updated_at")));
            return item;
        }, userId, workspace);
    }

    public List<Map<String, Object>> listAssetVersions(String userId, String assetId) {
        String workspace = assertAssetReader(userId, assetId);
        return jdbc.query("""
                SELECT v.id, v.asset_id, v.version_no, v.manifest_version, v.manifest_json, v.content_hash,
                       v.note, v.created_by, v.client_mutation_id, u.username AS creator, v.created_at,
                       CASE WHEN a.current_version_id = v.id THEN 1 ELSE 0 END AS is_current,
                       (SELECT COUNT(*) FROM cloud_asset_blob b WHERE b.asset_version_id = v.id AND b.status = 'available') AS file_count
                FROM cloud_asset_version v
                JOIN cloud_asset a ON a.id = v.asset_id
                LEFT JOIN app_user u ON u.id = v.created_by
                WHERE v.asset_id = ? AND a.workspace_id = ?
                ORDER BY v.version_no DESC, v.created_at DESC
                """, (rs, rowNum) -> {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("id", rs.getString("id")); item.put("assetId", rs.getString("asset_id")); item.put("version", rs.getInt("version_no"));
            item.put("manifestVersion", rs.getInt("manifest_version")); item.put("manifest", json(rs.getString("manifest_json")));
            item.put("contentHash", rs.getString("content_hash")); item.put("note", rs.getString("note"));
            item.put("createdBy", rs.getString("created_by")); item.put("creator", rs.getString("creator")); item.put("clientMutationId", rs.getString("client_mutation_id"));
            item.put("createdAt", instant(rs.getTimestamp("created_at"))); item.put("current", rs.getInt("is_current") == 1); item.put("fileCount", rs.getInt("file_count"));
            return item;
        }, assetId, workspace);
    }

    @Transactional
    public Map<String, Object> createAsset(String userId, String workspaceId, String externalId, String kind, String name, String visibility, JsonNode manifest) {
        String workspace = resolveWorkspace(userId, workspaceId);
        String normalizedExternalId = normalizeToken(externalId, "asset-" + UUID.randomUUID(), 96);
        String normalizedKind = normalizeToken(kind, "model3d", 32);
        String normalizedVisibility = List.of("private", "workspace", "public").contains(normalizeToken(visibility, "private", 24)) ? normalizeToken(visibility, "private", 24) : "private";
        String normalizedName = normalizeName(name == null || name.isBlank() ? normalizedExternalId : name);
        JsonNode normalizedManifest = normalizeAssetManifest(manifest, normalizedVisibility);
        String manifestJson = toJson(normalizedManifest);
        String assetId = UUID.randomUUID().toString();
        String versionId = UUID.randomUUID().toString();
        jdbc.update("INSERT INTO cloud_asset (id, workspace_id, owner_user_id, external_id, kind, name, visibility, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'draft')", assetId, workspace, userId, normalizedExternalId, normalizedKind, normalizedName, normalizedVisibility);
        jdbc.update("INSERT INTO cloud_asset_version (id, asset_id, version_no, manifest_version, manifest_json, content_hash, created_by) VALUES (?, ?, 1, 1, ?, ?, ?)", versionId, assetId, manifestJson, projection.contentHash(manifestJson), userId);
        jdbc.update("UPDATE cloud_asset SET current_version_id = ? WHERE id = ?", versionId, assetId);
        audit(workspace, userId, "cloud", "asset.created", "asset", assetId, "success", Map.of("externalId", normalizedExternalId, "kind", normalizedKind, "versionId", versionId));
        return listAssets(userId, workspace).stream().filter(item -> assetId.equals(item.get("id"))).findFirst().orElseThrow();
    }

    @Transactional
    public Map<String, Object> createAssetVersion(String userId, String assetId, JsonNode manifest, String note, String clientMutationId) {
        String workspace = assertAssetWriter(userId, assetId);
        Map<String, Object> asset = jdbc.query("SELECT visibility, current_version_id FROM cloud_asset WHERE id = ? AND workspace_id = ?", (rs, rowNum) -> {
            Map<String, Object> row = new LinkedHashMap<>(); row.put("visibility", rs.getString("visibility")); row.put("currentVersionId", rs.getString("current_version_id")); return row;
        }, assetId, workspace).stream().findFirst().orElseThrow(() -> new IllegalArgumentException("资源不存在或无权写入"));
        String mutationId = mutationId(clientMutationId);
        if (mutationId != null) {
            String existingId = jdbc.query("SELECT id FROM cloud_asset_version WHERE asset_id = ? AND created_by = ? AND client_mutation_id = ?", (rs, rowNum) -> rs.getString(1), assetId, userId, mutationId).stream().findFirst().orElse(null);
            if (existingId != null) return listAssetVersions(userId, assetId).stream().filter(item -> existingId.equals(item.get("id"))).findFirst().orElseThrow();
        }
        JsonNode normalizedManifest = normalizeAssetManifest(manifest, String.valueOf(asset.get("visibility")));
        String manifestJson = toJson(normalizedManifest);
        Integer nextVersion = jdbc.queryForObject("SELECT COALESCE(MAX(version_no), 0) + 1 FROM cloud_asset_version WHERE asset_id = ?", Integer.class, assetId);
        String versionId = UUID.randomUUID().toString();
        try {
            jdbc.update("INSERT INTO cloud_asset_version (id, asset_id, version_no, manifest_version, manifest_json, content_hash, note, created_by, client_mutation_id) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)", versionId, assetId, nextVersion == null ? 1 : nextVersion, manifestJson, projection.contentHash(manifestJson), truncate(note, 500), userId, mutationId);
        } catch (DuplicateKeyException duplicate) {
            if (mutationId != null) return listAssetVersions(userId, assetId).stream().filter(item -> mutationId.equals(item.get("clientMutationId"))).findFirst().orElseThrow(() -> duplicate);
            throw duplicate;
        }
        jdbc.update("UPDATE cloud_asset SET current_version_id = ?, updated_at = CURRENT_TIMESTAMP(6) WHERE id = ? AND workspace_id = ?", versionId, assetId, workspace);
        Map<String, Object> details = new LinkedHashMap<>(); details.put("assetId", assetId); details.put("versionId", versionId); details.put("version", nextVersion == null ? 1 : nextVersion); details.put("baseVersionId", asset.get("currentVersionId"));
        audit(workspace, userId, "asset-cloud", "asset.version_created", "asset_version", versionId, "success", details);
        return listAssetVersions(userId, assetId).stream().filter(item -> versionId.equals(item.get("id"))).findFirst().orElseThrow();
    }

    public List<Map<String, Object>> listPublications(String userId, String workspaceId) {
        String workspace = resolveWorkspace(userId, workspaceId);
        return jdbc.query("SELECT l.id, l.source_type, l.source_id, l.source_version_id, l.forge_lab_post_id, p.title AS post_title, r.release_name, a.name AS asset_name, l.license_snapshot_json, l.status, l.created_by, l.created_at FROM cloud_forge_lab_publication l LEFT JOIN forgelab_post p ON p.id = l.forge_lab_post_id LEFT JOIN cloud_project_release r ON l.source_type = 'project_release' AND r.id = l.source_id LEFT JOIN cloud_asset a ON l.source_type = 'asset' AND a.id = l.source_id WHERE l.workspace_id = ? ORDER BY l.created_at DESC", (rs, rowNum) -> {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("id", rs.getString("id")); item.put("sourceType", rs.getString("source_type")); item.put("sourceId", rs.getString("source_id")); item.put("sourceVersionId", rs.getString("source_version_id"));
            item.put("forgeLabPostId", rs.getString("forge_lab_post_id")); item.put("postTitle", rs.getString("post_title")); item.put("releaseName", rs.getString("release_name")); item.put("assetName", rs.getString("asset_name"));
            item.put("licenseSnapshot", json(rs.getString("license_snapshot_json"))); item.put("status", rs.getString("status")); item.put("createdBy", rs.getString("created_by")); item.put("createdAt", instant(rs.getTimestamp("created_at"))); return item;
        }, workspace);
    }

    @Transactional
    public Map<String, Object> createPublication(String userId, String workspaceId, String sourceType, String sourceId, String forgeLabPostId, JsonNode licenseSnapshot) {
        String workspace = resolveWorkspace(userId, workspaceId);
        String normalizedSource = normalizeToken(sourceType, "project_release", 32);
        String normalizedSourceId = normalizeIdentifier(sourceId);
        String postId = normalizeIdentifier(forgeLabPostId);
        Integer postCount = jdbc.queryForObject("SELECT COUNT(*) FROM forgelab_post WHERE id = ? AND status = 'published'", Integer.class, postId);
        if (postCount == null || postCount == 0) throw new IllegalArgumentException("ForgeLab 帖子不存在或尚未发布");
        String versionId;
        if ("project_release".equals(normalizedSource)) {
            Map<String, Object> release = jdbc.query("SELECT r.project_id, r.version_id FROM cloud_project_release r JOIN cloud_project p ON p.id = r.project_id WHERE r.id = ? AND p.workspace_id = ?", (rs, rowNum) -> { Map<String, Object> row = new LinkedHashMap<>(); row.put("projectId", rs.getString(1)); row.put("versionId", rs.getString(2)); return row; }, normalizedSourceId, workspace).stream().findFirst().orElseThrow(() -> new IllegalArgumentException("项目发布不存在或不属于当前工作空间"));
            assertProjectRole(userId, String.valueOf(release.get("projectId")), "manager");
            versionId = String.valueOf(release.get("versionId"));
        } else if ("asset".equals(normalizedSource)) {
            assertAssetReader(userId, normalizedSourceId);
            assertWorkspaceAdmin(userId, workspace);
            versionId = jdbc.query("SELECT current_version_id FROM cloud_asset WHERE id = ? AND workspace_id = ?", (rs, rowNum) -> rs.getString(1), normalizedSourceId, workspace).stream().findFirst().orElseThrow(() -> new IllegalArgumentException("资源不存在或不属于当前工作空间"));
        } else throw new IllegalArgumentException("不支持的 ForgeLab 发布来源");
        JsonNode snapshot = licenseSnapshot == null || !licenseSnapshot.isObject() ? mapper.createObjectNode() : licenseSnapshot;
        String id = UUID.randomUUID().toString();
        try {
            jdbc.update("INSERT INTO cloud_forge_lab_publication (id, workspace_id, source_type, source_id, source_version_id, forge_lab_post_id, license_snapshot_json, status, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)", id, workspace, normalizedSource, normalizedSourceId, versionId, postId, toJson(snapshot), userId);
        } catch (org.springframework.dao.DuplicateKeyException duplicate) {
            return listPublications(userId, workspace).stream().filter(item -> normalizedSource.equals(item.get("sourceType")) && normalizedSourceId.equals(item.get("sourceId")) && postId.equals(item.get("forgeLabPostId"))).findFirst().orElseThrow(() -> new IllegalArgumentException("该发布关系已存在"));
        }
        jdbc.update("INSERT INTO cloud_outbox_event (id, workspace_id, event_type, aggregate_type, aggregate_id, payload_json) VALUES (?, ?, 'forgelab.publication.created', 'publication', ?, ?)", UUID.randomUUID().toString(), workspace, id, toJson(Map.of("sourceType", normalizedSource, "sourceId", normalizedSourceId, "forgeLabPostId", postId)));
        audit(workspace, userId, "cloud", "forgelab.publication_created", "publication", id, "success", Map.of("sourceType", normalizedSource, "sourceId", normalizedSourceId, "forgeLabPostId", postId));
        return listPublications(userId, workspace).stream().filter(item -> id.equals(item.get("id"))).findFirst().orElseThrow();
    }

    public List<Map<String, Object>> listAssetBlobs(String userId, String assetId) {
        String workspace = assertAssetReader(userId, assetId);
        return jdbc.query("SELECT b.id, b.asset_id, b.asset_version_id, b.object_key, b.file_name, b.media_type, b.size_bytes, b.content_hash, b.storage_provider, b.status, b.created_by, b.created_at, v.version_no FROM cloud_asset_blob b JOIN cloud_asset a ON a.id = b.asset_id JOIN cloud_asset_version v ON v.id = b.asset_version_id WHERE b.asset_id = ? AND a.workspace_id = ? ORDER BY b.created_at DESC", (rs, rowNum) -> {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("id", rs.getString("id")); item.put("assetId", rs.getString("asset_id")); item.put("assetVersionId", rs.getString("asset_version_id"));
            item.put("objectKey", rs.getString("object_key")); item.put("fileName", rs.getString("file_name")); item.put("mediaType", rs.getString("media_type"));
            item.put("sizeBytes", rs.getLong("size_bytes")); item.put("contentHash", rs.getString("content_hash")); item.put("storageProvider", rs.getString("storage_provider"));
            item.put("status", rs.getString("status")); item.put("createdBy", rs.getString("created_by")); item.put("createdAt", instant(rs.getTimestamp("created_at"))); item.put("version", rs.getInt("version_no"));
            return item;
        }, assetId, workspace);
    }

    @Transactional
    public Map<String, Object> registerAssetBlob(String userId, String assetId, String objectKey, String fileName, String mediaType, long sizeBytes, String contentHash, String storageProvider) {
        String workspace = assertAssetReader(userId, assetId);
        if (sizeBytes <= 0 || sizeBytes > 90L * 1024 * 1024) throw new IllegalArgumentException("资源文件大小不在允许范围内");
        Map<String, Object> current = jdbc.query("SELECT current_version_id FROM cloud_asset WHERE id = ? AND workspace_id = ?", (rs, rowNum) -> { Map<String, Object> row = new LinkedHashMap<>(); row.put("versionId", rs.getString(1)); return row; }, assetId, workspace).stream().findFirst().orElseThrow(() -> new IllegalArgumentException("资源不存在或无权访问"));
        String id = UUID.randomUUID().toString();
        try {
            jdbc.update("INSERT INTO cloud_asset_blob (id, asset_id, asset_version_id, object_key, file_name, media_type, size_bytes, content_hash, storage_provider, status, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'available', ?)", id, assetId, current.get("versionId"), objectKey, fileName, mediaType == null || mediaType.isBlank() ? "application/octet-stream" : mediaType, sizeBytes, contentHash, storageProvider == null || storageProvider.isBlank() ? "local" : storageProvider, userId);
        } catch (org.springframework.dao.DuplicateKeyException duplicate) {
            return listAssetBlobs(userId, assetId).stream().filter(item -> contentHash.equals(item.get("contentHash"))).findFirst().orElseThrow(() -> new IllegalArgumentException("相同资源文件已存在"));
        }
        audit(workspace, userId, "asset-cloud", "asset.blob_uploaded", "asset_blob", id, "success", Map.of("assetId", assetId, "sizeBytes", sizeBytes, "contentHash", contentHash));
        return listAssetBlobs(userId, assetId).stream().filter(item -> id.equals(item.get("id"))).findFirst().orElseThrow();
    }

    public boolean hasAssetBlob(String userId, String assetId, String contentHash) {
        String workspace = assertAssetReader(userId, assetId);
        Integer count = jdbc.queryForObject("SELECT COUNT(*) FROM cloud_asset_blob b JOIN cloud_asset a ON a.id = b.asset_id WHERE b.asset_id = ? AND b.content_hash = ? AND a.workspace_id = ?", Integer.class, assetId, contentHash, workspace);
        return count != null && count > 0;
    }

    public Map<String, Object> getAssetBlob(String userId, String blobId) {
        Map<String, Object> item = jdbc.query("SELECT b.id, b.asset_id, b.object_key, b.file_name, b.media_type, b.size_bytes, b.content_hash, b.storage_provider, b.status FROM cloud_asset_blob b WHERE b.id = ?", (rs, rowNum) -> {
            Map<String, Object> row = new LinkedHashMap<>(); row.put("id", rs.getString("id")); row.put("assetId", rs.getString("asset_id")); row.put("objectKey", rs.getString("object_key")); row.put("fileName", rs.getString("file_name")); row.put("mediaType", rs.getString("media_type")); row.put("sizeBytes", rs.getLong("size_bytes")); row.put("contentHash", rs.getString("content_hash")); row.put("storageProvider", rs.getString("storage_provider")); row.put("status", rs.getString("status")); return row;
        }, blobId).stream().findFirst().orElseThrow(() -> new IllegalArgumentException("资源文件不存在"));
        assertAssetReader(userId, String.valueOf(item.get("assetId")));
        if (!"available".equals(item.get("status"))) throw new IllegalArgumentException("资源文件当前不可下载");
        return item;
    }

    public void recordAssetBlobDownload(String userId, Map<String, Object> blob) {
        String workspace = assertAssetReader(userId, String.valueOf(blob.get("assetId")));
        audit(workspace, userId, "asset-cloud", "asset.blob_downloaded", "asset_blob", String.valueOf(blob.get("id")), "success", Map.of("assetId", blob.get("assetId"), "contentHash", blob.get("contentHash")));
    }

    @Transactional
    public void deleteAssetBlob(String userId, String blobId) {
        Map<String, Object> blob = jdbc.query("SELECT id, asset_id, object_key, content_hash, status FROM cloud_asset_blob WHERE id = ?", (rs, rowNum) -> { Map<String, Object> row = new LinkedHashMap<>(); row.put("id", rs.getString("id")); row.put("assetId", rs.getString("asset_id")); row.put("objectKey", rs.getString("object_key")); row.put("contentHash", rs.getString("content_hash")); row.put("status", rs.getString("status")); return row; }, blobId).stream().findFirst().orElseThrow(() -> new IllegalArgumentException("资源文件不存在"));
        String workspace = assertAssetReader(userId, String.valueOf(blob.get("assetId")));
        if ("deleted".equals(blob.get("status"))) return;
        jdbc.update("UPDATE cloud_asset_blob SET status = 'deleted' WHERE id = ? AND status = 'available'", blobId);
        audit(workspace, userId, "asset-cloud", "asset.blob_deleted", "asset_blob", blobId, "success", Map.of("assetId", blob.get("assetId"), "contentHash", blob.get("contentHash")));
    }

    public String assertAssetReader(String userId, String assetId) {
        String workspace = jdbc.query("SELECT workspace_id FROM cloud_asset WHERE id = ?", (rs, rowNum) -> rs.getString(1), assetId).stream().findFirst().orElseThrow(() -> new IllegalArgumentException("资源不存在或无权访问"));
        return resolveWorkspace(userId, workspace);
    }

    private String assertAssetWriter(String userId, String assetId) {
        String workspace = jdbc.query("SELECT workspace_id FROM cloud_asset WHERE id = ?", (rs, rowNum) -> rs.getString(1), assetId).stream().findFirst().orElseThrow(() -> new IllegalArgumentException("资源不存在或无权写入"));
        resolveWorkspace(userId, workspace);
        Integer owner = jdbc.queryForObject("SELECT COUNT(*) FROM cloud_asset WHERE id = ? AND owner_user_id = ?", Integer.class, assetId, userId);
        if (owner != null && owner > 0) return workspace;
        assertWorkspaceAdmin(userId, workspace);
        return workspace;
    }

    public List<Map<String, Object>> listNotifications(String userId) {
        return jdbc.query("""
                SELECT id, workspace_id, type, title, body, object_type, object_id, read_at, created_at
                FROM cloud_notification WHERE recipient_user_id = ? ORDER BY created_at DESC LIMIT 50
                """, (rs, rowNum) -> {
            Map<String, Object> item = new LinkedHashMap<>(); item.put("id", rs.getString("id")); item.put("workspaceId", rs.getString("workspace_id"));
            item.put("type", rs.getString("type")); item.put("title", rs.getString("title")); item.put("body", rs.getString("body"));
            item.put("objectType", rs.getString("object_type")); item.put("objectId", rs.getString("object_id")); item.put("readAt", rs.getTimestamp("read_at") == null ? null : instant(rs.getTimestamp("read_at")));
            item.put("createdAt", instant(rs.getTimestamp("created_at"))); return item;
        }, userId);
    }

    @Transactional
    public int markAllNotificationsRead(String userId) {
        return jdbc.update("UPDATE cloud_notification SET read_at = CURRENT_TIMESTAMP(6) WHERE recipient_user_id = ? AND read_at IS NULL", userId);
    }

    public List<Map<String, Object>> listAudit(String userId, String workspaceId) {
        String workspace = resolveWorkspace(userId, workspaceId);
        return jdbc.query("""
                SELECT a.id, a.actor_user_id, u.username AS actor, a.source, a.action, a.object_type, a.object_id, a.result, a.detail_json, a.request_id, a.created_at
                FROM cloud_audit_log a LEFT JOIN app_user u ON u.id = a.actor_user_id
                JOIN cloud_workspace_member m ON m.workspace_id = a.workspace_id AND m.user_id = ? AND m.status = 'active'
                WHERE a.workspace_id = ? ORDER BY a.created_at DESC LIMIT 100
                """, (rs, rowNum) -> {
            Map<String, Object> item = new LinkedHashMap<>(); item.put("id", rs.getLong("id")); item.put("actorUserId", rs.getString("actor_user_id"));
            item.put("actor", rs.getString("actor")); item.put("source", rs.getString("source")); item.put("action", rs.getString("action"));
            item.put("objectType", rs.getString("object_type")); item.put("objectId", rs.getString("object_id")); item.put("result", rs.getString("result"));
            item.put("requestId", rs.getString("request_id")); item.put("detail", json(rs.getString("detail_json"))); item.put("createdAt", instant(rs.getTimestamp("created_at"))); return item;
        }, userId, workspace);
    }

    public List<Map<String, Object>> listActivity(String userId, String workspaceId, String eventType, Long beforeId, int requestedLimit) {
        String workspace = resolveWorkspace(userId, workspaceId);
        String normalizedType = eventType == null || eventType.isBlank() ? null : truncate(eventType.trim().toLowerCase(), 96);
        int limit = Math.max(1, Math.min(requestedLimit, 100));
        long cursor = beforeId == null ? 0 : Math.max(0, beforeId);
        return jdbc.query("""
                SELECT a.id, a.outbox_event_id, a.workspace_id, a.event_type,
                       a.aggregate_type, a.aggregate_id, a.actor_user_id,
                       u.username AS actor, a.source, a.action, a.result,
                       a.payload_json, a.created_at
                FROM cloud_activity_event a
                LEFT JOIN app_user u ON u.id = a.actor_user_id
                JOIN cloud_workspace_member m ON m.workspace_id = a.workspace_id
                    AND m.user_id = ? AND m.status = 'active'
                WHERE a.workspace_id = ?
                  AND (? IS NULL OR a.event_type = ?)
                  AND (? = 0 OR a.id < ?)
                ORDER BY a.id DESC
                LIMIT ?
                """, (rs, rowNum) -> {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("id", rs.getLong("id"));
            item.put("outboxEventId", rs.getString("outbox_event_id"));
            item.put("workspaceId", rs.getString("workspace_id"));
            item.put("eventType", rs.getString("event_type"));
            item.put("aggregateType", rs.getString("aggregate_type"));
            item.put("aggregateId", rs.getString("aggregate_id"));
            item.put("actorUserId", rs.getString("actor_user_id"));
            item.put("actor", rs.getString("actor"));
            item.put("source", rs.getString("source"));
            item.put("action", rs.getString("action"));
            item.put("result", rs.getString("result"));
            item.put("payload", json(rs.getString("payload_json")));
            item.put("createdAt", instant(rs.getTimestamp("created_at")));
            return item;
        }, userId, workspace, normalizedType, normalizedType, cursor, cursor, limit);
    }

    public Map<String, Object> overview(String userId, String workspaceId) {
        String workspace = resolveWorkspace(userId, workspaceId);
        projection.syncAllForUser(userId);
        List<Map<String, Object>> workspaces = listWorkspaces(userId);
        Map<String, Object> selected = workspaces.stream().filter(item -> workspace.equals(item.get("id"))).findFirst().orElseThrow();
        Map<String, Object> result = new LinkedHashMap<>(); result.put("workspace", selected);
        result.put("projects", count("SELECT COUNT(*) FROM cloud_project WHERE workspace_id = ?", workspace));
        result.put("assets", count("SELECT COUNT(*) FROM cloud_asset WHERE workspace_id = ?", workspace));
        result.put("members", count("SELECT COUNT(*) FROM cloud_workspace_member WHERE workspace_id = ? AND status = 'active'", workspace));
        result.put("pendingNotifications", count("SELECT COUNT(*) FROM cloud_notification WHERE workspace_id = ? AND read_at IS NULL", workspace));
        result.put("events", listAudit(userId, workspace).stream().limit(6).toList());
        List<Map<String, Object>> connectors = listConnectors(userId, workspace);
        long onlineConnectors = connectors.stream().filter(row -> "online".equals(row.get("status"))).count();
        long errorConnectors = connectors.stream().filter(row -> "error".equals(row.get("status"))).count();
        Map<String, Object> connectorHealth = new LinkedHashMap<>();
        connectorHealth.put("id", "connectors"); connectorHealth.put("label", "工业连接器");
        connectorHealth.put("state", connectors.isEmpty() ? "未配置" : errorConnectors > 0 ? "部分异常" : onlineConnectors == connectors.size() ? "正常" : "待心跳");
        connectorHealth.put("tone", connectors.isEmpty() ? "muted" : errorConnectors > 0 ? "red" : onlineConnectors == connectors.size() ? "green" : "amber");
        connectorHealth.put("detail", connectors.isEmpty() ? "工作空间没有已登记连接器" : onlineConnectors + "/" + connectors.size() + " 个连接器在线 · 运行事件服务端状态");
        result.put("health", List.of(
                Map.of("id", "api", "label", "ForgeCloud API", "state", "正常", "tone", "green", "detail", "GET /api/v1 · 当前请求已响应"),
                Map.of("id", "mysql", "label", "MySQL 结构化数据", "state", "正常", "tone", "green", "detail", "存档、版本和审计 · 当前请求已响应"),
                Map.of("id", "object-store", "label", "对象存储", "state", "兼容模式", "tone", "amber", "detail", "当前仍使用数据库兼容存储，未接入对象存储"),
                connectorHealth
        ));
        result.put("layers", List.of(
                Map.of("id", "project", "label", "Project Cloud", "state", "已接入", "tone", "green", "detail", result.get("projects") + " 个云端工厂项目"),
                Map.of("id", "device", "label", "Device Cloud", "state", "基础就绪", "tone", "cyan", "detail", count("SELECT COUNT(*) FROM cloud_device WHERE workspace_id = ?", workspace) + " 台已注册设备"),
                Map.of("id", "twin", "label", "Twin Cloud", "state", "基础就绪", "tone", "cyan", "detail", count("SELECT COUNT(*) FROM cloud_twin WHERE workspace_id = ?", workspace) + " 个数字孪生"),
                Map.of("id", "asset", "label", "Asset Cloud", "state", "已接入", "tone", "green", "detail", result.get("assets") + " 个云端资源"),
                Map.of("id", "data", "label", "Data Cloud", "state", "基础就绪", "tone", "cyan", "detail", count("SELECT COUNT(*) FROM cloud_data_event WHERE workspace_id = ?", workspace) + " 条运行数据"),
                Map.of("id", "ai", "label", "AI Cloud", "state", "规则可用", "tone", "purple", "detail", count("SELECT COUNT(*) FROM cloud_ai_task WHERE workspace_id = ?", workspace) + " 个推理任务")
        ));
        latestArchiveSummary(workspace).ifPresent(archive -> result.put("archive", archive));
        return result;
    }

    public Map<String, Object> databaseStatus(String userId, String workspaceId) {
        String workspace = resolveWorkspace(userId, workspaceId);
        long startedAt = System.nanoTime();
        Map<String, Object> server = jdbc.queryForMap("SELECT VERSION() AS server_version, DATABASE() AS schema_name");
        List<String> warnings = new ArrayList<>();
        Map<String, Object> storage = Map.of("table_count", 0, "cloud_table_count", 0, "size_mib", 0);
        Map<String, Object> migration = Map.of("version", "unknown", "description", "迁移记录不可读");
        int activeConnections = 0;
        int maxConnections = 0;
        try {
            storage = jdbc.queryForMap("""
                    SELECT COUNT(*) AS table_count,
                           SUM(CASE WHEN table_name LIKE 'cloud\\_%' THEN 1 ELSE 0 END) AS cloud_table_count,
                           COALESCE(ROUND(SUM(data_length + index_length) / 1024 / 1024, 2), 0) AS size_mib
                    FROM information_schema.tables WHERE table_schema = DATABASE()
                    """);
        } catch (RuntimeException error) {
            warnings.add("数据库容量与表统计不可读");
        }
        try {
            migration = jdbc.query("""
                    SELECT version, description, installed_on
                    FROM flyway_schema_history WHERE success = 1
                    ORDER BY installed_rank DESC LIMIT 1
                    """, (rs, rowNum) -> {
                Map<String, Object> row = new LinkedHashMap<>();
                row.put("version", rs.getString("version"));
                row.put("description", rs.getString("description"));
                row.put("installedAt", instant(rs.getTimestamp("installed_on")));
                return row;
            }).stream().findFirst().orElse(Map.of("version", "0", "description", "未迁移"));
        } catch (RuntimeException error) {
            warnings.add("Flyway 迁移记录不可读");
        }
        try {
            activeConnections = jdbc.query("SHOW STATUS LIKE 'Threads_connected'", (rs, rowNum) -> Integer.parseInt(rs.getString("Value"))).stream().findFirst().orElse(0);
            Integer configuredMax = jdbc.queryForObject("SELECT @@GLOBAL.max_connections", Integer.class);
            maxConnections = configuredMax == null ? 0 : configuredMax;
        } catch (RuntimeException error) {
            warnings.add("数据库连接池指标不可读");
        }
        Map<String, Object> eventQueue = Map.of("pending", 0, "processing", 0, "failed", 0, "processed", 0, "activity", 0);
        try {
            eventQueue = jdbc.queryForMap("""
                    SELECT
                      COALESCE(SUM(status = 'pending'), 0) AS pending,
                      COALESCE(SUM(status = 'processing'), 0) AS processing,
                      COALESCE(SUM(status = 'failed'), 0) AS failed,
                      COALESCE(SUM(status = 'processed'), 0) AS processed,
                      (SELECT COUNT(*) FROM cloud_activity_event WHERE workspace_id = ?) AS activity
                    FROM cloud_outbox_event WHERE workspace_id = ?
                    """, workspace, workspace);
        } catch (RuntimeException error) {
            warnings.add("事件队列状态不可读");
        }
        List<Map<String, Object>> tables = List.of();
        try {
            tables = jdbc.query("""
                    SELECT t.table_name,
                           t.table_type,
                           COALESCE(t.engine, 'VIEW') AS engine,
                           COALESCE(t.table_rows, 0) AS table_rows,
                           COALESCE(ROUND(t.data_length / 1024 / 1024, 2), 0) AS data_mib,
                           COALESCE(ROUND(t.index_length / 1024 / 1024, 2), 0) AS index_mib,
                           COALESCE(ROUND((t.data_length + t.index_length) / 1024 / 1024, 2), 0) AS size_mib,
                           (SELECT COUNT(*) FROM information_schema.columns c
                            WHERE c.table_schema = t.table_schema AND c.table_name = t.table_name) AS column_count,
                           t.table_collation,
                           t.update_time AS updated_at
                    FROM information_schema.tables t
                    WHERE t.table_schema = DATABASE()
                    ORDER BY t.table_name
                    """, (rs, rowNum) -> {
                Map<String, Object> row = new LinkedHashMap<>();
                row.put("name", rs.getString("table_name"));
                row.put("type", rs.getString("table_type"));
                row.put("engine", rs.getString("engine"));
                row.put("columns", rs.getInt("column_count"));
                row.put("rows", rs.getLong("table_rows"));
                row.put("dataMiB", rs.getDouble("data_mib"));
                row.put("indexMiB", rs.getDouble("index_mib"));
                row.put("sizeMiB", rs.getDouble("size_mib"));
                row.put("collation", rs.getString("table_collation"));
                row.put("updatedAt", rs.getTimestamp("updated_at") == null ? null : instant(rs.getTimestamp("updated_at")));
                return row;
            });
        } catch (RuntimeException error) {
            warnings.add("数据库表目录不可读");
        }
        long latencyMs = Math.max(1, (System.nanoTime() - startedAt) / 1_000_000);

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("status", warnings.isEmpty() ? "online" : "degraded");
        result.put("engine", "MySQL");
        result.put("serverVersion", server.get("server_version"));
        result.put("schema", server.get("schema_name"));
        result.put("migration", migration);
        result.put("tableCount", number(storage.get("table_count")).intValue());
        result.put("cloudTableCount", number(storage.get("cloud_table_count")).intValue());
        result.put("sizeMiB", number(storage.get("size_mib")).doubleValue());
        result.put("activeConnections", activeConnections);
        result.put("maxConnections", maxConnections);
        result.put("latencyMs", latencyMs);
        result.put("workspaceId", workspace);
        result.put("checkedAt", Instant.now().toString());
        result.put("eventQueue", eventQueue);
        result.put("tables", tables);
        result.put("warnings", warnings);
        return result;
    }

    private java.util.Optional<Map<String, Object>> latestArchiveSummary(String workspaceId) {
        List<Map<String, Object>> rows = jdbc.query("""
                SELECT p.id, p.name, p.updated_at, v.version_no, v.schema_version, v.branch_name, v.save_json
                FROM cloud_project p
                LEFT JOIN cloud_project_version v ON v.id = p.current_version_id
                WHERE p.workspace_id = ? AND p.project_type = 'factory'
                ORDER BY p.updated_at DESC LIMIT 1
                """, (rs, rowNum) -> {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("id", rs.getString("id"));
            row.put("name", rs.getString("name"));
            row.put("updatedAt", instant(rs.getTimestamp("updated_at")));
            row.put("version", rs.getInt("version_no"));
            row.put("schemaVersion", rs.getInt("schema_version"));
            row.put("branch", rs.getString("branch_name"));
            row.put("saveJson", rs.getString("save_json"));
            return row;
        }, workspaceId);
        if (rows.isEmpty()) return java.util.Optional.empty();

        Map<String, Object> row = rows.get(0);
        JsonNode save = json((String) row.get("saveJson"));
        JsonNode objects = save.path("objects");
        JsonNode items = save.path("items");
        JsonNode recipes = save.path("recipes");
        Map<String, String> itemNames = new HashMap<>();
        if (items.isArray()) for (JsonNode item : items) itemNames.put(item.path("id").asText(), item.path("name").asText(item.path("id").asText("未命名物品")));

        int machines = 0;
        int conveyors = 0;
        int vehicles = 0;
        if (objects.isArray()) for (JsonNode object : objects) {
            String type = object.path("type").asText("").toLowerCase();
            if (Set.of("machine", "smelter", "washing", "press", "assembler", "inspection", "packaging").contains(type) || object.hasNonNull("recipeId")) machines++;
            if (type.contains("conveyor")) conveyors++;
            if (Set.of("agv", "drone").contains(type)) vehicles++;
        }

        Map<String, Integer> outputQuantities = new LinkedHashMap<>();
        Map<String, Integer> outputRecipes = new HashMap<>();
        if (recipes.isArray()) for (JsonNode recipe : recipes) {
            if (recipe.path("enabled").asBoolean(true) == false) continue;
            Set<String> countedInRecipe = new HashSet<>();
            JsonNode outputs = recipe.path("outputs");
            if (!outputs.isArray()) continue;
            for (JsonNode output : outputs) {
                String itemId = output.path("itemId").asText("");
                if (itemId.isBlank()) continue;
                outputQuantities.merge(itemId, output.path("qty").asInt(0), Integer::sum);
                if (countedInRecipe.add(itemId)) outputRecipes.merge(itemId, 1, Integer::sum);
            }
        }
        List<Map<String, Object>> outputRows = new ArrayList<>();
        outputQuantities.forEach((itemId, quantity) -> {
            Map<String, Object> output = new LinkedHashMap<>();
            output.put("itemId", itemId);
            output.put("name", itemNames.getOrDefault(itemId, itemId));
            output.put("quantity", quantity);
            output.put("recipeCount", outputRecipes.getOrDefault(itemId, 0));
            outputRows.add(output);
        });

        List<String> floorNames = new ArrayList<>();
        JsonNode floorNameNode = save.path("floorNames");
        if (floorNameNode.isArray()) floorNameNode.forEach(node -> floorNames.add(node.asText()));
        int floorCount = save.path("floorCount").asInt(floorNames.isEmpty() ? 1 : floorNames.size());
        while (floorNames.size() < floorCount) floorNames.add((floorNames.size() + 1) + "F 生产层");

        Map<String, Object> archive = new LinkedHashMap<>();
        archive.put("projectId", row.get("id"));
        archive.put("projectName", row.get("name"));
        archive.put("version", row.get("version"));
        archive.put("schemaVersion", row.get("schemaVersion"));
        archive.put("branch", row.get("branch"));
        archive.put("objects", objects.isArray() ? objects.size() : 0);
        archive.put("machines", machines);
        archive.put("conveyors", conveyors);
        archive.put("vehicles", vehicles);
        archive.put("items", items.isArray() ? items.size() : 0);
        archive.put("recipes", recipes.isArray() ? recipes.size() : 0);
        archive.put("floors", floorCount);
        archive.put("floorNames", floorNames.subList(0, Math.min(floorNames.size(), floorCount)));
        archive.put("outputs", outputRows);
        archive.put("updatedAt", row.get("updatedAt"));
        return java.util.Optional.of(archive);
    }

    public List<Map<String, Object>> listMembers(String userId, String workspaceId) {
        String workspace = resolveWorkspace(userId, workspaceId);
        return jdbc.query("""
                SELECT m.user_id, u.username, m.role, m.status, m.joined_at,
                       (SELECT COUNT(*) FROM cloud_project_member pm WHERE pm.user_id = m.user_id AND pm.status = 'active') AS project_count
                FROM cloud_workspace_member m JOIN app_user u ON u.id = m.user_id
                WHERE m.workspace_id = ? ORDER BY FIELD(m.role, 'owner', 'admin', 'member', 'guest'), m.joined_at
                """, (rs, rowNum) -> {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("userId", rs.getString("user_id")); item.put("username", rs.getString("username"));
            item.put("role", rs.getString("role")); item.put("status", rs.getString("status"));
            item.put("projectCount", rs.getInt("project_count")); item.put("joinedAt", instant(rs.getTimestamp("joined_at")));
            return item;
        }, workspace);
    }

    @Transactional
    public Map<String, Object> addMember(String userId, String workspaceId, String username, String role) {
        String workspace = resolveWorkspace(userId, workspaceId);
        assertWorkspaceAdmin(userId, workspace);
        String normalizedRole = normalizeRole(role);
        String targetId = jdbc.query("SELECT id FROM app_user WHERE username = ?", (rs, rowNum) -> rs.getString(1), username == null ? "" : username.trim())
                .stream().findFirst().orElseThrow(() -> new IllegalArgumentException("成员账号不存在"));
        jdbc.update("INSERT INTO cloud_workspace_member (workspace_id, user_id, role, status) VALUES (?, ?, ?, 'active') ON DUPLICATE KEY UPDATE role = VALUES(role), status = 'active'", workspace, targetId, normalizedRole);
        audit(workspace, userId, "cloud", "workspace.member_added", "user", targetId, "success", Map.of("role", normalizedRole));
        return listMembers(userId, workspace).stream().filter(item -> targetId.equals(item.get("userId"))).findFirst().orElseThrow();
    }

    @Transactional
    public Map<String, Object> updateMemberRole(String userId, String workspaceId, String targetUserId, String role) {
        String workspace = resolveWorkspace(userId, workspaceId);
        assertWorkspaceAdmin(userId, workspace);
        Integer owner = jdbc.queryForObject("SELECT COUNT(*) FROM cloud_workspace WHERE id = ? AND owner_user_id = ?", Integer.class, workspace, targetUserId);
        if (owner != null && owner > 0) throw new IllegalArgumentException("不能修改工作空间所有者角色");
        String normalizedRole = normalizeRole(role);
        int changed = jdbc.update("UPDATE cloud_workspace_member SET role = ? WHERE workspace_id = ? AND user_id = ? AND status = 'active'", normalizedRole, workspace, targetUserId);
        if (changed == 0) throw new IllegalArgumentException("成员不存在或已离开工作空间");
        audit(workspace, userId, "cloud", "workspace.member_role_updated", "user", targetUserId, "success", Map.of("role", normalizedRole));
        return listMembers(userId, workspace).stream().filter(item -> targetUserId.equals(item.get("userId"))).findFirst().orElseThrow();
    }

    public List<Map<String, Object>> listReleases(String userId, String workspaceId) {
        String workspace = resolveWorkspace(userId, workspaceId);
        return jdbc.query("""
                SELECT r.id, r.project_id, p.name AS project_name, r.version_id, v.version_no, v.branch_name,
                       r.release_name, r.notes, r.status, r.created_by, u.username AS creator, r.created_at
                FROM cloud_project_release r
                JOIN cloud_project p ON p.id = r.project_id
                JOIN cloud_project_version v ON v.id = r.version_id
                LEFT JOIN app_user u ON u.id = r.created_by
                WHERE p.workspace_id = ? ORDER BY r.created_at DESC
                """, (rs, rowNum) -> {
            Map<String, Object> item = new LinkedHashMap<>(); item.put("id", rs.getString("id")); item.put("projectId", rs.getString("project_id"));
            item.put("projectName", rs.getString("project_name")); item.put("versionId", rs.getString("version_id")); item.put("version", rs.getInt("version_no"));
            item.put("branch", rs.getString("branch_name")); item.put("name", rs.getString("release_name")); item.put("notes", rs.getString("notes"));
            item.put("status", rs.getString("status")); item.put("createdBy", rs.getString("created_by")); item.put("creator", rs.getString("creator")); item.put("createdAt", instant(rs.getTimestamp("created_at"))); return item;
        }, workspace);
    }

    @Transactional
    public Map<String, Object> createRelease(String userId, String projectId, String versionId, String releaseName, String notes) {
        assertProjectRole(userId, projectId, "manager");
        Integer versionMatches = jdbc.queryForObject("SELECT COUNT(*) FROM cloud_project_version WHERE id = ? AND project_id = ?", Integer.class, versionId, projectId);
        if (versionMatches == null || versionMatches == 0) throw new IllegalArgumentException("项目版本不存在或不属于该项目");
        String workspace = jdbc.queryForObject("SELECT workspace_id FROM cloud_project WHERE id = ?", String.class, projectId);
        String id = UUID.randomUUID().toString();
        String normalized = normalizeName(releaseName);
        jdbc.update("INSERT INTO cloud_project_release (id, project_id, version_id, release_name, notes, status, created_by) VALUES (?, ?, ?, ?, ?, 'published', ?)", id, projectId, versionId, normalized, notes, userId);
        audit(workspace, userId, "cloud", "project.released", "release", id, "success", Map.of("projectId", projectId, "versionId", versionId));
        return listReleases(userId, workspace).stream().filter(item -> id.equals(item.get("id"))).findFirst().orElseThrow();
    }

    public List<Map<String, Object>> listTasks(String userId, String workspaceId) {
        String workspace = resolveWorkspace(userId, workspaceId);
        return jdbc.query("""
                SELECT t.id, t.project_id, p.name AS project_name, t.task_type, t.title, t.detail, t.status, t.priority,
                       t.assignee_user_id, au.username AS assignee, t.source, t.created_by, cu.username AS creator, t.client_mutation_id, t.created_at, t.updated_at
                FROM cloud_task t LEFT JOIN cloud_project p ON p.id = t.project_id
                LEFT JOIN app_user au ON au.id = t.assignee_user_id LEFT JOIN app_user cu ON cu.id = t.created_by
                WHERE t.workspace_id = ? ORDER BY FIELD(t.status, 'open', 'in_progress', 'blocked', 'done'), t.updated_at DESC
                """, (rs, rowNum) -> {
            Map<String, Object> item = new LinkedHashMap<>(); item.put("id", rs.getString("id")); item.put("projectId", rs.getString("project_id")); item.put("projectName", rs.getString("project_name"));
            item.put("type", rs.getString("task_type")); item.put("title", rs.getString("title")); item.put("detail", rs.getString("detail")); item.put("status", rs.getString("status")); item.put("priority", rs.getString("priority"));
            item.put("assigneeUserId", rs.getString("assignee_user_id")); item.put("assignee", rs.getString("assignee")); item.put("source", rs.getString("source")); item.put("createdBy", rs.getString("created_by")); item.put("creator", rs.getString("creator")); item.put("clientMutationId", rs.getString("client_mutation_id"));
            item.put("createdAt", instant(rs.getTimestamp("created_at"))); item.put("updatedAt", instant(rs.getTimestamp("updated_at"))); return item;
        }, workspace);
    }

    @Transactional
    public Map<String, Object> createTask(String userId, String workspaceId, String projectId, String type, String title, String detail, String priority, String assigneeUserId, String clientMutationId) {
        String workspace = resolveWorkspace(userId, workspaceId);
        if (projectId != null && !projectId.isBlank()) assertProjectRole(userId, projectId, "editor");
        String mutationId = mutationId(clientMutationId);
        if (mutationId != null) {
            String existingId = jdbc.query("SELECT id FROM cloud_task WHERE workspace_id = ? AND created_by = ? AND client_mutation_id = ?", (rs, rowNum) -> rs.getString(1), workspace, userId, mutationId).stream().findFirst().orElse(null);
            if (existingId != null) return listTasks(userId, workspace).stream().filter(item -> existingId.equals(item.get("id"))).findFirst().orElseThrow();
        }
        String id = UUID.randomUUID().toString();
        try {
            jdbc.update("INSERT INTO cloud_task (id, workspace_id, project_id, task_type, title, detail, status, priority, assignee_user_id, source, created_by, client_mutation_id) VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, 'cloud', ?, ?)", id, workspace, blankToNull(projectId), normalizeToken(type, "general", 48), normalizeTitle(title), detail, normalizeToken(priority, "normal", 16), blankToNull(assigneeUserId), userId, mutationId);
        } catch (DuplicateKeyException duplicate) {
            if (mutationId != null) return listTasks(userId, workspace).stream().filter(item -> mutationId.equals(item.get("clientMutationId"))).findFirst().orElseThrow(() -> duplicate);
            throw duplicate;
        }
        audit(workspace, userId, "cloud", "task.created", "task", id, "success", Map.of("type", normalizeToken(type, "general", 48)));
        return listTasks(userId, workspace).stream().filter(item -> id.equals(item.get("id"))).findFirst().orElseThrow();
    }

    @Transactional
    public Map<String, Object> updateTaskStatus(String userId, String taskId, String status) {
        String workspace = jdbc.query("SELECT workspace_id FROM cloud_task WHERE id = ?", (rs, rowNum) -> rs.getString(1), taskId).stream().findFirst().orElseThrow(() -> new IllegalArgumentException("任务不存在"));
        resolveWorkspace(userId, workspace);
        String normalized = normalizeToken(status, "open", 24);
        int changed = jdbc.update("UPDATE cloud_task SET status = ?, updated_at = CURRENT_TIMESTAMP(6) WHERE id = ?", normalized, taskId);
        if (changed == 0) throw new IllegalArgumentException("任务不存在");
        audit(workspace, userId, "cloud", "task.status_updated", "task", taskId, "success", Map.of("status", normalized));
        return listTasks(userId, workspace).stream().filter(item -> taskId.equals(item.get("id"))).findFirst().orElseThrow();
    }

    public List<Map<String, Object>> listConnectors(String userId, String workspaceId) {
        String workspace = resolveWorkspace(userId, workspaceId);
        return jdbc.query("""
                SELECT c.id, c.name, c.connector_type, c.endpoint, c.status, c.read_only, c.last_heartbeat_at, c.created_by, u.username AS creator, c.created_at, c.updated_at,
                       (SELECT COUNT(*) FROM cloud_runtime_event e WHERE e.connector_id = c.id) AS event_count
                FROM cloud_connector c LEFT JOIN app_user u ON u.id = c.created_by WHERE c.workspace_id = ? ORDER BY c.updated_at DESC
                """, (rs, rowNum) -> {
            Map<String, Object> item = new LinkedHashMap<>(); item.put("id", rs.getString("id")); item.put("name", rs.getString("name")); item.put("type", rs.getString("connector_type")); item.put("endpoint", rs.getString("endpoint"));
            item.put("status", rs.getString("status")); item.put("readOnly", rs.getBoolean("read_only")); item.put("lastHeartbeatAt", rs.getTimestamp("last_heartbeat_at") == null ? null : instant(rs.getTimestamp("last_heartbeat_at")));
            item.put("createdBy", rs.getString("created_by")); item.put("creator", rs.getString("creator")); item.put("eventCount", rs.getInt("event_count")); item.put("createdAt", instant(rs.getTimestamp("created_at"))); item.put("updatedAt", instant(rs.getTimestamp("updated_at"))); return item;
        }, workspace);
    }

    @Transactional
    public Map<String, Object> createConnector(String userId, String workspaceId, String name, String type, String endpoint) {
        String workspace = resolveWorkspace(userId, workspaceId); assertWorkspaceAdmin(userId, workspace);
        String id = UUID.randomUUID().toString();
        jdbc.update("INSERT INTO cloud_connector (id, workspace_id, name, connector_type, endpoint, status, read_only, created_by) VALUES (?, ?, ?, ?, ?, 'configured', TRUE, ?)", id, workspace, normalizeName(name), normalizeToken(type, "csv", 32), blankToNull(endpoint), userId);
        audit(workspace, userId, "cloud", "connector.created", "connector", id, "success", Map.of("readOnly", true));
        return listConnectors(userId, workspace).stream().filter(item -> id.equals(item.get("id"))).findFirst().orElseThrow();
    }

    public List<Map<String, Object>> listRuntimeEvents(String userId, String workspaceId, String connectorId) {
        String workspace = resolveWorkspace(userId, workspaceId);
        return jdbc.query("""
                SELECT e.id, e.connector_id, c.name AS connector_name, e.event_type, e.quality, e.payload_json, e.occurred_at, e.created_at,
                       e.source_system, e.external_event_id, e.device_id, e.twin_id, e.point_id, e.unit, e.isolation_status, e.isolation_reason, e.received_at
                FROM cloud_runtime_event e LEFT JOIN cloud_connector c ON c.id = e.connector_id
                WHERE e.workspace_id = ? AND (? IS NULL OR e.connector_id = ?) ORDER BY e.occurred_at DESC LIMIT 200
                """, (rs, rowNum) -> {
            Map<String, Object> item = new LinkedHashMap<>(); item.put("id", rs.getLong("id")); item.put("connectorId", rs.getString("connector_id")); item.put("connector", rs.getString("connector_name")); item.put("type", rs.getString("event_type")); item.put("quality", rs.getString("quality")); item.put("payload", json(rs.getString("payload_json"))); item.put("occurredAt", instant(rs.getTimestamp("occurred_at"))); item.put("createdAt", instant(rs.getTimestamp("created_at"))); item.put("source", rs.getString("source_system")); item.put("externalEventId", rs.getString("external_event_id")); item.put("deviceId", rs.getString("device_id")); item.put("twinId", rs.getString("twin_id")); item.put("pointId", rs.getString("point_id")); item.put("unit", rs.getString("unit")); item.put("isolationStatus", rs.getString("isolation_status")); item.put("isolationReason", rs.getString("isolation_reason")); item.put("receivedAt", instant(rs.getTimestamp("received_at"))); return item;
        }, workspace, blankToNull(connectorId), blankToNull(connectorId));
    }

    @Transactional
    public Map<String, Object> appendRuntimeEvent(String userId, String connectorId, String eventType, String quality, JsonNode payload, String occurredAt) {
        return appendRuntimeEvent(userId, connectorId, eventType, quality, payload, occurredAt, null, null, null, null, null, null);
    }

    @Transactional
    public Map<String, Object> appendRuntimeEvent(String userId, String connectorId, String eventType, String quality, JsonNode payload, String occurredAt, String source, String externalEventId, String deviceId, String twinId, String pointId, String unit) {
        String workspace = jdbc.query("SELECT workspace_id FROM cloud_connector WHERE id = ?", (rs, rowNum) -> rs.getString(1), connectorId).stream().findFirst().orElseThrow(() -> new IllegalArgumentException("连接器不存在"));
        resolveWorkspace(userId, workspace);
        Instant occurred = occurredAt == null || occurredAt.isBlank() ? Instant.now() : Instant.parse(occurredAt);
        String body = toJson(payload == null ? mapper.createObjectNode() : payload);
        String normalizedSource = normalizeToken(source, "connector", 48);
        String normalizedExternalId = truncate(externalEventId, 160);
        String dedupeKey = normalizedExternalId == null ? null : normalizedSource + ":" + normalizedExternalId;
        String normalizedDevice = validateRuntimeTarget(workspace, deviceId, "cloud_device", "设备");
        String normalizedTwin = validateRuntimeTarget(workspace, twinId, "cloud_twin", "孪生");
        String normalizedPoint = validateRuntimeTarget(workspace, pointId, "cloud_data_point", "数据点");
        String normalizedUnit = blankToNull(unit);
        String isolationStatus = "accepted";
        String isolationReason = null;
        if (normalizedPoint != null && normalizedUnit != null) {
            String pointUnit = jdbc.query("SELECT unit FROM cloud_data_point WHERE id = ?", (rs, rowNum) -> rs.getString(1), normalizedPoint).stream().findFirst().orElse(null);
            if (pointUnit != null && !pointUnit.equals(normalizedUnit)) { isolationStatus = "quarantined"; isolationReason = "单位与数据点定义不一致"; }
        }
        if (occurred.isBefore(Instant.now().minusSeconds(366L * 24 * 3600)) || occurred.isAfter(Instant.now().plusSeconds(24 * 3600))) { isolationStatus = "quarantined"; isolationReason = "事件时间超出允许漂移范围"; }
        if (dedupeKey != null) {
            String existingId = jdbc.query("SELECT id FROM cloud_runtime_event WHERE workspace_id = ? AND dedupe_key = ?", (rs, rowNum) -> String.valueOf(rs.getLong(1)), workspace, dedupeKey).stream().findFirst().orElse(null);
            if (existingId != null) return listRuntimeEvents(userId, workspace, connectorId).stream().filter(item -> existingId.equals(String.valueOf(item.get("id")))).findFirst().orElseThrow();
        }
        try {
            jdbc.update("INSERT INTO cloud_runtime_event (workspace_id, connector_id, source_system, external_event_id, dedupe_key, device_id, twin_id, point_id, unit, isolation_status, isolation_reason, event_type, quality, payload_json, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", workspace, connectorId, normalizedSource, normalizedExternalId, dedupeKey, normalizedDevice, normalizedTwin, normalizedPoint, normalizedUnit, isolationStatus, isolationReason, normalizeToken(eventType, "heartbeat", 48), normalizeQuality(quality), body, Timestamp.from(occurred));
        } catch (DuplicateKeyException duplicate) {
            if (dedupeKey != null) return listRuntimeEvents(userId, workspace, connectorId).stream().filter(item -> dedupeKey.equals(String.valueOf(item.get("source")) + ":" + String.valueOf(item.get("externalEventId")))).findFirst().orElseThrow(() -> duplicate);
            throw duplicate;
        }
        jdbc.update("UPDATE cloud_connector SET status = 'online', last_heartbeat_at = ?, updated_at = CURRENT_TIMESTAMP(6) WHERE id = ?", Timestamp.from(occurred), connectorId);
        return listRuntimeEvents(userId, workspace, connectorId).stream().findFirst().orElseThrow();
    }

    public List<Map<String, Object>> listTelemetryWindows(String userId, String workspaceId, String dataPointId, String twinId) {
        String workspace = resolveWorkspace(userId, workspaceId);
        String point = blankToNull(dataPointId), twin = blankToNull(twinId);
        StringBuilder sql = new StringBuilder("SELECT w.id, w.twin_id, t.name AS twin, w.data_point_id, p.point_key, p.label, w.metric, w.window_start, w.window_end, w.unit, w.min_value, w.max_value, w.avg_value, w.sample_count, w.valid_count, w.invalid_count, w.aggregation_version, w.source_system, w.created_at, w.updated_at FROM cloud_telemetry_window w LEFT JOIN cloud_twin t ON t.id = w.twin_id LEFT JOIN cloud_data_point p ON p.id = w.data_point_id WHERE w.workspace_id = ?");
        List<Object> args = new ArrayList<>(); args.add(workspace);
        if (point != null) { sql.append(" AND w.data_point_id = ?"); args.add(point); }
        if (twin != null) { sql.append(" AND w.twin_id = ?"); args.add(twin); }
        sql.append(" ORDER BY w.window_end DESC LIMIT 200");
        return jdbc.query(sql.toString(), (rs, rowNum) -> {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("id", rs.getString("id")); row.put("twinId", rs.getString("twin_id")); row.put("twin", rs.getString("twin")); row.put("dataPointId", rs.getString("data_point_id")); row.put("pointKey", rs.getString("point_key")); row.put("pointLabel", rs.getString("label")); row.put("metric", rs.getString("metric")); row.put("windowStart", instant(rs.getTimestamp("window_start"))); row.put("windowEnd", instant(rs.getTimestamp("window_end"))); row.put("unit", rs.getString("unit")); row.put("min", rs.getBigDecimal("min_value")); row.put("max", rs.getBigDecimal("max_value")); row.put("avg", rs.getBigDecimal("avg_value")); row.put("sampleCount", rs.getInt("sample_count")); row.put("validCount", rs.getInt("valid_count")); row.put("invalidCount", rs.getInt("invalid_count")); row.put("aggregationVersion", rs.getInt("aggregation_version")); row.put("source", rs.getString("source_system")); row.put("createdAt", instant(rs.getTimestamp("created_at"))); row.put("updatedAt", instant(rs.getTimestamp("updated_at"))); return row;
        }, args.toArray());
    }

    @Transactional
    public Map<String, Object> aggregateTelemetryWindow(String userId, String workspaceId, String dataPointId, String twinId, String metric, String windowStart, String windowEnd) {
        String workspace = resolveWorkspace(userId, workspaceId);
        String point = validateRuntimeTarget(workspace, dataPointId, "cloud_data_point", "数据点");
        String twin = validateRuntimeTarget(workspace, twinId, "cloud_twin", "孪生");
        if (point == null && twin == null) throw new IllegalArgumentException("遥测窗口至少需要一个数据点或孪生目标");
        Instant start = parseInstant(windowStart, "窗口起点"), end = parseInstant(windowEnd, "窗口终点");
        if (!end.isAfter(start)) throw new IllegalArgumentException("窗口终点必须晚于窗口起点");
        String metricName = blankToNull(metric);
        if (metricName == null && point != null) metricName = jdbc.query("SELECT point_key FROM cloud_data_point WHERE id = ?", (rs, rowNum) -> rs.getString(1), point).stream().findFirst().orElse(null);
        metricName = requiredValue(metricName, "指标名称", 96);
        String unit = point == null ? null : jdbc.query("SELECT unit FROM cloud_data_point WHERE id = ?", (rs, rowNum) -> rs.getString(1), point).stream().findFirst().orElse(null);
        StringBuilder sampleSql = new StringBuilder("SELECT value_json, quality FROM cloud_data_event WHERE workspace_id = ? AND occurred_at >= ? AND occurred_at < ?");
        List<Object> sampleArgs = new ArrayList<>(); sampleArgs.add(workspace); sampleArgs.add(Timestamp.from(start)); sampleArgs.add(Timestamp.from(end));
        if (point != null) { sampleSql.append(" AND point_id = ?"); sampleArgs.add(point); }
        if (twin != null) { sampleSql.append(" AND twin_id = ?"); sampleArgs.add(twin); }
        sampleSql.append(" ORDER BY occurred_at ASC LIMIT 10000");
        List<Map<String, Object>> samples = jdbc.query(sampleSql.toString(), (rs, rowNum) -> { Map<String, Object> row = new LinkedHashMap<>(); row.put("value", rs.getString("value_json")); row.put("quality", rs.getString("quality")); return row; }, sampleArgs.toArray());
        int sampleCount = samples.size(), validCount = 0, invalidCount = 0; BigDecimal min = null, max = null, sum = BigDecimal.ZERO;
        for (Map<String, Object> sample : samples) {
            JsonNode value = json((String) sample.get("value")); String quality = normalizeQuality((String) sample.get("quality")); BigDecimal number = decimalValue(value);
            if (number == null || "bad".equals(quality) || "uncertain".equals(quality)) { invalidCount++; continue; }
            validCount++; sum = sum.add(number); min = min == null || number.compareTo(min) < 0 ? number : min; max = max == null || number.compareTo(max) > 0 ? number : max;
        }
        BigDecimal average = validCount == 0 ? null : sum.divide(BigDecimal.valueOf(validCount), 8, java.math.RoundingMode.HALF_UP);
        StringBuilder existingSql = new StringBuilder("SELECT id FROM cloud_telemetry_window WHERE workspace_id = ? AND metric = ? AND window_start = ? AND window_end = ?");
        List<Object> existingArgs = new ArrayList<>(); existingArgs.add(workspace); existingArgs.add(metricName); existingArgs.add(Timestamp.from(start)); existingArgs.add(Timestamp.from(end));
        if (point == null) existingSql.append(" AND data_point_id IS NULL"); else { existingSql.append(" AND data_point_id = ?"); existingArgs.add(point); }
        if (twin == null) existingSql.append(" AND twin_id IS NULL"); else { existingSql.append(" AND twin_id = ?"); existingArgs.add(twin); }
        String windowId = jdbc.query(existingSql.toString(), (rs, rowNum) -> rs.getString(1), existingArgs.toArray()).stream().findFirst().orElse(null);
        if (windowId == null) {
            windowId = UUID.randomUUID().toString();
            jdbc.update("INSERT INTO cloud_telemetry_window (id, workspace_id, twin_id, data_point_id, metric, window_start, window_end, unit, min_value, max_value, avg_value, sample_count, valid_count, invalid_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", windowId, workspace, twin, point, metricName, Timestamp.from(start), Timestamp.from(end), unit, min, max, average, sampleCount, validCount, invalidCount);
        } else {
            jdbc.update("UPDATE cloud_telemetry_window SET unit = ?, min_value = ?, max_value = ?, avg_value = ?, sample_count = ?, valid_count = ?, invalid_count = ?, updated_at = CURRENT_TIMESTAMP(6) WHERE id = ?", unit, min, max, average, sampleCount, validCount, invalidCount, windowId);
        }
        audit(workspace, userId, "data-cloud", "telemetry_window.aggregated", "telemetry_window", windowId, "success", Map.of("sampleCount", sampleCount, "validCount", validCount, "invalidCount", invalidCount));
        final String resultWindowId = windowId;
        return listTelemetryWindows(userId, workspace, point, twin).stream().filter(row -> resultWindowId.equals(row.get("id"))).findFirst().orElseThrow();
    }

    public List<Map<String, Object>> listWorkOrders(String userId, String workspaceId) {
        String workspace = resolveWorkspace(userId, workspaceId);
        return jdbc.query("SELECT o.id, o.project_id, p.name AS project, o.twin_id, t.name AS twin, o.external_id, o.order_type, o.title, o.detail, o.status, o.priority, o.client_mutation_id, o.planned_at, o.due_at, o.actual_at, o.source_system, o.assigned_to, a.username AS assignee, o.created_by, u.username AS creator, o.created_at, o.updated_at FROM cloud_work_order o LEFT JOIN cloud_project p ON p.id = o.project_id LEFT JOIN cloud_twin t ON t.id = o.twin_id LEFT JOIN app_user a ON a.id = o.assigned_to JOIN app_user u ON u.id = o.created_by WHERE o.workspace_id = ? ORDER BY CASE o.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END, o.updated_at DESC LIMIT 200", (rs, rowNum) -> {
            Map<String, Object> row = new LinkedHashMap<>(); row.put("id", rs.getString("id")); row.put("projectId", rs.getString("project_id")); row.put("project", rs.getString("project")); row.put("twinId", rs.getString("twin_id")); row.put("twin", rs.getString("twin")); row.put("externalId", rs.getString("external_id")); row.put("type", rs.getString("order_type")); row.put("title", rs.getString("title")); row.put("detail", rs.getString("detail")); row.put("status", rs.getString("status")); row.put("priority", rs.getString("priority")); row.put("clientMutationId", rs.getString("client_mutation_id")); row.put("plannedAt", optionalInstant(rs.getTimestamp("planned_at"))); row.put("dueAt", optionalInstant(rs.getTimestamp("due_at"))); row.put("actualAt", optionalInstant(rs.getTimestamp("actual_at"))); row.put("source", rs.getString("source_system")); row.put("assignedTo", rs.getString("assigned_to")); row.put("assignee", rs.getString("assignee")); row.put("createdBy", rs.getString("created_by")); row.put("creator", rs.getString("creator")); row.put("createdAt", instant(rs.getTimestamp("created_at"))); row.put("updatedAt", instant(rs.getTimestamp("updated_at"))); return row;
        }, workspace);
    }

    @Transactional
    public Map<String, Object> createWorkOrder(String userId, String workspaceId, String projectId, String twinId, String externalId, String type, String title, String detail, String status, String priority, String plannedAt, String dueAt, String assignedTo, String clientMutationId) {
        String workspace = resolveWorkspace(userId, workspaceId); validateProjectTarget(workspace, projectId);
        String twin = validateRuntimeTarget(workspace, twinId, "cloud_twin", "孪生"); String assignee = validateWorkspaceUser(workspace, assignedTo); String mutation = truncate(clientMutationId, 120);
        if (mutation != null) { String existing = jdbc.query("SELECT id FROM cloud_work_order WHERE workspace_id = ? AND created_by = ? AND client_mutation_id = ?", (rs, rowNum) -> rs.getString(1), workspace, userId, mutation).stream().findFirst().orElse(null); if (existing != null) return listWorkOrders(userId, workspace).stream().filter(row -> existing.equals(row.get("id"))).findFirst().orElseThrow(); }
        String external = truncate(externalId, 160); String id = UUID.randomUUID().toString(); Timestamp planned = optionalTimestamp(plannedAt, "计划时间"), due = optionalTimestamp(dueAt, "截止时间"); String normalizedStatus = normalizeWorkOrderStatus(status), normalizedPriority = normalizePriority(priority);
        try { jdbc.update("INSERT INTO cloud_work_order (id, workspace_id, project_id, twin_id, external_id, order_type, title, detail, status, priority, client_mutation_id, planned_at, due_at, assigned_to, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", id, workspace, blankToNull(projectId), twin, external, normalizeToken(type, "maintenance", 48), normalizeTitle(title), truncate(detail, 2000), normalizedStatus, normalizedPriority, mutation, planned, due, assignee, userId); }
        catch (DuplicateKeyException duplicate) { if (external != null) return listWorkOrders(userId, workspace).stream().filter(row -> external.equals(row.get("externalId"))).findFirst().orElseThrow(() -> duplicate); throw duplicate; }
        audit(workspace, userId, "operate", "work_order.created", "work_order", id, "success", Map.of("status", normalizedStatus));
        return listWorkOrders(userId, workspace).stream().filter(row -> id.equals(row.get("id"))).findFirst().orElseThrow();
    }

    @Transactional
    public Map<String, Object> updateWorkOrderStatus(String userId, String workOrderId, String status) {
        String workspace = jdbc.query("SELECT workspace_id FROM cloud_work_order WHERE id = ?", (rs, rowNum) -> rs.getString(1), workOrderId).stream().findFirst().orElseThrow(() -> new IllegalArgumentException("工单不存在"));
        resolveWorkspace(userId, workspace); String normalized = normalizeWorkOrderStatus(status);
        jdbc.update("UPDATE cloud_work_order SET status = ?, actual_at = CASE WHEN ? IN ('done', 'cancelled') THEN CURRENT_TIMESTAMP(6) ELSE actual_at END, updated_at = CURRENT_TIMESTAMP(6) WHERE id = ?", normalized, normalized, workOrderId);
        audit(workspace, userId, "operate", "work_order.status_changed", "work_order", workOrderId, "success", Map.of("status", normalized));
        return listWorkOrders(userId, workspace).stream().filter(row -> workOrderId.equals(row.get("id"))).findFirst().orElseThrow();
    }

    public List<Map<String, Object>> listQualityResults(String userId, String workspaceId) {
        String workspace = resolveWorkspace(userId, workspaceId);
        return jdbc.query("SELECT q.id, q.project_id, p.name AS project, q.twin_id, t.name AS twin, q.work_order_id, o.title AS work_order, q.lot_id, q.inspection_type, q.result, q.score, q.evidence_ref, q.detail, q.occurred_at, q.client_mutation_id, q.created_by, u.username AS creator, q.created_at FROM cloud_quality_result q LEFT JOIN cloud_project p ON p.id = q.project_id LEFT JOIN cloud_twin t ON t.id = q.twin_id LEFT JOIN cloud_work_order o ON o.id = q.work_order_id JOIN app_user u ON u.id = q.created_by WHERE q.workspace_id = ? ORDER BY q.occurred_at DESC LIMIT 200", (rs, rowNum) -> {
            Map<String, Object> row = new LinkedHashMap<>(); row.put("id", rs.getString("id")); row.put("projectId", rs.getString("project_id")); row.put("project", rs.getString("project")); row.put("twinId", rs.getString("twin_id")); row.put("twin", rs.getString("twin")); row.put("workOrderId", rs.getString("work_order_id")); row.put("workOrder", rs.getString("work_order")); row.put("lotId", rs.getString("lot_id")); row.put("inspectionType", rs.getString("inspection_type")); row.put("result", rs.getString("result")); row.put("score", rs.getBigDecimal("score")); row.put("evidenceRef", rs.getString("evidence_ref")); row.put("detail", rs.getString("detail")); row.put("occurredAt", instant(rs.getTimestamp("occurred_at"))); row.put("clientMutationId", rs.getString("client_mutation_id")); row.put("createdBy", rs.getString("created_by")); row.put("creator", rs.getString("creator")); row.put("createdAt", instant(rs.getTimestamp("created_at"))); return row;
        }, workspace);
    }

    @Transactional
    public Map<String, Object> createQualityResult(String userId, String workspaceId, String projectId, String twinId, String workOrderId, String lotId, String inspectionType, String result, BigDecimal score, String evidenceRef, String detail, String occurredAt, String clientMutationId) {
        String workspace = resolveWorkspace(userId, workspaceId); validateProjectTarget(workspace, projectId);
        String twin = validateRuntimeTarget(workspace, twinId, "cloud_twin", "孪生"); String order = validateRuntimeTarget(workspace, workOrderId, "cloud_work_order", "工单"); String mutation = truncate(clientMutationId, 120);
        if (mutation != null) { String existing = jdbc.query("SELECT id FROM cloud_quality_result WHERE workspace_id = ? AND created_by = ? AND client_mutation_id = ?", (rs, rowNum) -> rs.getString(1), workspace, userId, mutation).stream().findFirst().orElse(null); if (existing != null) return listQualityResults(userId, workspace).stream().filter(row -> existing.equals(row.get("id"))).findFirst().orElseThrow(); }
        BigDecimal normalizedScore = score == null ? null : score.max(BigDecimal.ZERO).min(BigDecimal.valueOf(100)); String id = UUID.randomUUID().toString();
        jdbc.update("INSERT INTO cloud_quality_result (id, workspace_id, project_id, twin_id, work_order_id, lot_id, inspection_type, result, score, evidence_ref, detail, occurred_at, client_mutation_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", id, workspace, blankToNull(projectId), twin, order, truncate(lotId, 160), normalizeToken(inspectionType, "manual", 64), normalizeQualityResult(result), normalizedScore, truncate(evidenceRef, 500), truncate(detail, 2000), parseTimestamp(occurredAt, "发生时间"), mutation, userId);
        audit(workspace, userId, "quality", "quality_result.created", "quality_result", id, "success", Map.of("result", normalizeQualityResult(result)));
        return listQualityResults(userId, workspace).stream().filter(row -> id.equals(row.get("id"))).findFirst().orElseThrow();
    }

    public List<Map<String, Object>> listMaintenanceRecords(String userId, String workspaceId) {
        String workspace = resolveWorkspace(userId, workspaceId);
        return jdbc.query("SELECT m.id, m.project_id, p.name AS project, m.twin_id, t.name AS twin, m.work_order_id, o.title AS work_order, m.fault_code, m.action, m.result, m.started_at, m.completed_at, m.downtime_seconds, m.detail, m.client_mutation_id, m.created_by, u.username AS creator, m.created_at, m.updated_at FROM cloud_maintenance_record m LEFT JOIN cloud_project p ON p.id = m.project_id LEFT JOIN cloud_twin t ON t.id = m.twin_id LEFT JOIN cloud_work_order o ON o.id = m.work_order_id JOIN app_user u ON u.id = m.created_by WHERE m.workspace_id = ? ORDER BY m.created_at DESC LIMIT 200", (rs, rowNum) -> {
            Map<String, Object> row = new LinkedHashMap<>(); row.put("id", rs.getString("id")); row.put("projectId", rs.getString("project_id")); row.put("project", rs.getString("project")); row.put("twinId", rs.getString("twin_id")); row.put("twin", rs.getString("twin")); row.put("workOrderId", rs.getString("work_order_id")); row.put("workOrder", rs.getString("work_order")); row.put("faultCode", rs.getString("fault_code")); row.put("action", rs.getString("action")); row.put("result", rs.getString("result")); row.put("startedAt", optionalInstant(rs.getTimestamp("started_at"))); row.put("completedAt", optionalInstant(rs.getTimestamp("completed_at"))); row.put("downtimeSeconds", rs.getObject("downtime_seconds")); row.put("detail", rs.getString("detail")); row.put("clientMutationId", rs.getString("client_mutation_id")); row.put("createdBy", rs.getString("created_by")); row.put("creator", rs.getString("creator")); row.put("createdAt", instant(rs.getTimestamp("created_at"))); row.put("updatedAt", instant(rs.getTimestamp("updated_at"))); return row;
        }, workspace);
    }

    @Transactional
    public Map<String, Object> createMaintenanceRecord(String userId, String workspaceId, String projectId, String twinId, String workOrderId, String faultCode, String action, String result, String startedAt, String completedAt, Long downtimeSeconds, String detail, String clientMutationId) {
        String workspace = resolveWorkspace(userId, workspaceId); validateProjectTarget(workspace, projectId);
        String twin = validateRuntimeTarget(workspace, twinId, "cloud_twin", "孪生"); String order = validateRuntimeTarget(workspace, workOrderId, "cloud_work_order", "工单"); String mutation = truncate(clientMutationId, 120);
        if (mutation != null) { String existing = jdbc.query("SELECT id FROM cloud_maintenance_record WHERE workspace_id = ? AND created_by = ? AND client_mutation_id = ?", (rs, rowNum) -> rs.getString(1), workspace, userId, mutation).stream().findFirst().orElse(null); if (existing != null) return listMaintenanceRecords(userId, workspace).stream().filter(row -> existing.equals(row.get("id"))).findFirst().orElseThrow(); }
        Long downtime = downtimeSeconds == null ? null : Math.max(0, downtimeSeconds); String id = UUID.randomUUID().toString();
        jdbc.update("INSERT INTO cloud_maintenance_record (id, workspace_id, project_id, twin_id, work_order_id, fault_code, action, result, started_at, completed_at, downtime_seconds, detail, client_mutation_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", id, workspace, blankToNull(projectId), twin, order, truncate(faultCode, 96), requiredValue(action, "维护动作", 500), normalizeMaintenanceResult(result), optionalTimestamp(startedAt, "开始时间"), optionalTimestamp(completedAt, "完成时间"), downtime, truncate(detail, 2000), mutation, userId);
        audit(workspace, userId, "maintenance", "maintenance_record.created", "maintenance_record", id, "success", Map.of("result", normalizeMaintenanceResult(result)));
        return listMaintenanceRecords(userId, workspace).stream().filter(row -> id.equals(row.get("id"))).findFirst().orElseThrow();
    }

    public List<Map<String, Object>> listTagMappings(String userId, String workspaceId) {
        String workspace = resolveWorkspace(userId, workspaceId);
        return jdbc.query("""
                SELECT m.id, m.connector_id, c.name AS connector, m.data_point_id, p.point_key, p.label,
                       m.twin_id, t.name AS twin, m.source_tag, m.semantic_key, m.unit, m.transform_json,
                       m.status, m.created_by, m.created_at, m.updated_at
                FROM cloud_tag_mapping m
                JOIN cloud_connector c ON c.id = m.connector_id
                LEFT JOIN cloud_data_point p ON p.id = m.data_point_id
                LEFT JOIN cloud_twin t ON t.id = m.twin_id
                WHERE m.workspace_id = ? ORDER BY m.updated_at DESC
                """, (rs, rowNum) -> {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("id", rs.getString("id")); row.put("connectorId", rs.getString("connector_id")); row.put("connector", rs.getString("connector"));
            row.put("dataPointId", rs.getString("data_point_id")); row.put("pointKey", rs.getString("point_key")); row.put("pointLabel", rs.getString("label"));
            row.put("twinId", rs.getString("twin_id")); row.put("twin", rs.getString("twin")); row.put("sourceTag", rs.getString("source_tag"));
            row.put("semanticKey", rs.getString("semantic_key")); row.put("unit", rs.getString("unit")); row.put("transform", json(rs.getString("transform_json")));
            row.put("status", rs.getString("status")); row.put("createdBy", rs.getString("created_by")); row.put("createdAt", instant(rs.getTimestamp("created_at"))); row.put("updatedAt", instant(rs.getTimestamp("updated_at")));
            return row;
        }, workspace);
    }

    @Transactional
    public Map<String, Object> createTagMapping(String userId, String workspaceId, String connectorId, String dataPointId, String twinId, String sourceTag, String semanticKey, String unit, JsonNode transform) {
        String workspace = connectorWorkspace(userId, connectorId);
        if (!workspace.equals(resolveWorkspace(userId, workspaceId))) throw new IllegalArgumentException("连接器不属于当前工作空间");
        assertWorkspaceAdmin(userId, workspace);
        String point = blankToNull(dataPointId); String twin = blankToNull(twinId);
        validateMappingTargets(workspace, point, twin);
        String source = requiredValue(sourceTag, "源标签", 240); String semantic = requiredValue(semanticKey, "语义键", 160);
        String id = UUID.randomUUID().toString();
        try {
            jdbc.update("INSERT INTO cloud_tag_mapping (id, workspace_id, connector_id, data_point_id, twin_id, source_tag, semantic_key, unit, transform_json, status, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)", id, workspace, connectorId, point, twin, source, semantic, blankToNull(unit), toJson(normalizeTransform(transform)), userId);
        } catch (DuplicateKeyException duplicate) { throw new IllegalArgumentException("该连接器的源标签已经存在映射"); }
        audit(workspace, userId, "data-cloud", "tag_mapping.created", "tag_mapping", id, "success", Map.of("connectorId", connectorId, "sourceTag", source));
        return listTagMappings(userId, workspace).stream().filter(row -> id.equals(row.get("id"))).findFirst().orElseThrow();
    }

    @Transactional
    public Map<String, Object> updateTagMapping(String userId, String mappingId, String dataPointId, String twinId, String sourceTag, String semanticKey, String unit, JsonNode transform, String status) {
        Map<String, Object> current = jdbc.query("SELECT workspace_id, connector_id, data_point_id, twin_id, source_tag, semantic_key, unit, transform_json FROM cloud_tag_mapping WHERE id = ?", (rs, rowNum) -> {
            Map<String, Object> row = new LinkedHashMap<>(); row.put("workspaceId", rs.getString("workspace_id")); row.put("connectorId", rs.getString("connector_id")); row.put("dataPointId", rs.getString("data_point_id")); row.put("twinId", rs.getString("twin_id")); row.put("sourceTag", rs.getString("source_tag")); row.put("semanticKey", rs.getString("semantic_key")); row.put("unit", rs.getString("unit")); row.put("transform", rs.getString("transform_json")); return row;
        }, mappingId).stream().findFirst().orElseThrow(() -> new IllegalArgumentException("数据映射不存在"));
        String workspace = resolveWorkspace(userId, String.valueOf(current.get("workspaceId"))); assertWorkspaceAdmin(userId, workspace);
        String point = dataPointId == null ? (String) current.get("dataPointId") : blankToNull(dataPointId);
        String targetTwinId = twinId == null ? (String) current.get("twinId") : blankToNull(twinId);
        validateMappingTargets(workspace, point, targetTwinId);
        String source = sourceTag == null ? String.valueOf(current.get("sourceTag")) : requiredValue(sourceTag, "源标签", 240);
        String semantic = semanticKey == null ? String.valueOf(current.get("semanticKey")) : requiredValue(semanticKey, "语义键", 160);
        JsonNode normalizedTransform = transform == null ? json(String.valueOf(current.get("transform"))) : normalizeTransform(transform);
        String normalizedStatus = List.of("active", "disabled").contains(normalizeToken(status, "active", 24)) ? normalizeToken(status, "active", 24) : "active";
        try { jdbc.update("UPDATE cloud_tag_mapping SET data_point_id = ?, twin_id = ?, source_tag = ?, semantic_key = ?, unit = ?, transform_json = ?, status = ?, updated_at = CURRENT_TIMESTAMP(6) WHERE id = ?", point, targetTwinId, source, semantic, unit == null ? current.get("unit") : blankToNull(unit), toJson(normalizedTransform), normalizedStatus, mappingId); }
        catch (DuplicateKeyException duplicate) { throw new IllegalArgumentException("该连接器的源标签已经存在映射"); }
        audit(workspace, userId, "data-cloud", "tag_mapping.updated", "tag_mapping", mappingId, "success", Map.of("status", normalizedStatus));
        return listTagMappings(userId, workspace).stream().filter(row -> mappingId.equals(row.get("id"))).findFirst().orElseThrow();
    }

    public List<Map<String, Object>> listAssetTwins(String userId, String workspaceId) {
        String workspace = resolveWorkspace(userId, workspaceId);
        return jdbc.query("SELECT a.id, a.project_id, p.name AS project, a.twin_id, t.name AS twin, a.factory_object_id, a.external_asset_id, a.status, a.note, a.created_by, a.created_at, a.updated_at FROM cloud_asset_twin a JOIN cloud_twin t ON t.id = a.twin_id LEFT JOIN cloud_project p ON p.id = a.project_id WHERE a.workspace_id = ? ORDER BY a.updated_at DESC", (rs, rowNum) -> {
            Map<String, Object> row = new LinkedHashMap<>(); row.put("id", rs.getString("id")); row.put("projectId", rs.getString("project_id")); row.put("project", rs.getString("project")); row.put("twinId", rs.getString("twin_id")); row.put("twin", rs.getString("twin")); row.put("factoryObjectId", rs.getString("factory_object_id")); row.put("externalAssetId", rs.getString("external_asset_id")); row.put("status", rs.getString("status")); row.put("note", rs.getString("note")); row.put("createdBy", rs.getString("created_by")); row.put("createdAt", instant(rs.getTimestamp("created_at"))); row.put("updatedAt", instant(rs.getTimestamp("updated_at"))); return row;
        }, workspace);
    }

    @Transactional
    public Map<String, Object> createAssetTwin(String userId, String workspaceId, String projectId, String twinId, String factoryObjectId, String externalAssetId, String note) {
        String workspace = resolveWorkspace(userId, workspaceId); assertWorkspaceAdmin(userId, workspace);
        String normalizedTwin = requiredValue(twinId, "孪生", 36);
        String twinWorkspace = jdbc.query("SELECT workspace_id FROM cloud_twin WHERE id = ?", (rs, rowNum) -> rs.getString(1), normalizedTwin).stream().findFirst().orElseThrow(() -> new IllegalArgumentException("孪生不存在"));
        if (!workspace.equals(twinWorkspace)) throw new IllegalArgumentException("孪生不属于当前工作空间");
        String project = blankToNull(projectId); if (project != null && !workspace.equals(projectWorkspace(project))) throw new IllegalArgumentException("项目不属于当前工作空间");
        String object = blankToNull(factoryObjectId); String asset = blankToNull(externalAssetId); if (object == null && asset == null) throw new IllegalArgumentException("至少提供 ForgeMind 对象 ID 或外部资源 ID");
        String id = UUID.randomUUID().toString();
        try { jdbc.update("INSERT INTO cloud_asset_twin (id, workspace_id, project_id, twin_id, factory_object_id, external_asset_id, status, note, created_by) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)", id, workspace, project, normalizedTwin, object, asset, truncate(note, 500), userId); }
        catch (DuplicateKeyException duplicate) { throw new IllegalArgumentException("该孪生目标已经存在映射"); }
        audit(workspace, userId, "twin-cloud", "asset_twin.created", "asset_twin", id, "success", Map.of("twinId", normalizedTwin));
        return listAssetTwins(userId, workspace).stream().filter(row -> id.equals(row.get("id"))).findFirst().orElseThrow();
    }

    public List<Map<String, Object>> listConnectorSyncRuns(String userId, String workspaceId, String connectorId) {
        String workspace = resolveWorkspace(userId, workspaceId);
        return jdbc.query("SELECT r.id, r.connector_id, c.name AS connector, r.mode, r.status, r.cursor_before, r.cursor_after, r.events_read, r.values_written, r.skipped_values, r.error_text, r.client_mutation_id, r.requested_by, r.requested_at, r.started_at, r.completed_at FROM cloud_connector_sync_run r JOIN cloud_connector c ON c.id = r.connector_id WHERE r.workspace_id = ? AND (? IS NULL OR r.connector_id = ?) ORDER BY r.requested_at DESC LIMIT 100", (rs, rowNum) -> {
            Map<String, Object> row = new LinkedHashMap<>(); row.put("id", rs.getString("id")); row.put("connectorId", rs.getString("connector_id")); row.put("connector", rs.getString("connector")); row.put("mode", rs.getString("mode")); row.put("status", rs.getString("status")); row.put("cursorBefore", rs.getLong("cursor_before")); row.put("cursorAfter", rs.getLong("cursor_after")); row.put("eventsRead", rs.getInt("events_read")); row.put("valuesWritten", rs.getInt("values_written")); row.put("skippedValues", rs.getInt("skipped_values")); row.put("error", rs.getString("error_text")); row.put("clientMutationId", rs.getString("client_mutation_id")); row.put("requestedBy", rs.getString("requested_by")); row.put("requestedAt", instant(rs.getTimestamp("requested_at"))); row.put("startedAt", instant(rs.getTimestamp("started_at"))); row.put("completedAt", instant(rs.getTimestamp("completed_at"))); return row;
        }, workspace, blankToNull(connectorId), blankToNull(connectorId));
    }

    @Transactional
    public Map<String, Object> runConnectorSync(String userId, String connectorId, String mode, Long sinceEventId, String clientMutationId) {
        String workspace = connectorWorkspace(userId, connectorId); assertWorkspaceAdmin(userId, workspace);
        String normalizedMode = normalizeToken(mode, "replay", 24); if (!"replay".equals(normalizedMode)) throw new IllegalArgumentException("当前仅支持已入库运行事件回放");
        String mutation = blankToNull(clientMutationId);
        if (mutation != null) {
            String existingId = jdbc.query("SELECT id FROM cloud_connector_sync_run WHERE connector_id = ? AND requested_by = ? AND client_mutation_id = ?", (rs, rowNum) -> rs.getString(1), connectorId, userId, mutation).stream().findFirst().orElse(null);
            if (existingId != null) return listConnectorSyncRuns(userId, workspace, connectorId).stream().filter(row -> existingId.equals(row.get("id"))).findFirst().orElseThrow();
        }
        long cursorBefore = sinceEventId == null ? jdbc.query("SELECT COALESCE(MAX(cursor_after), 0) FROM cloud_connector_sync_run WHERE connector_id = ? AND status = 'completed'", (rs, rowNum) -> rs.getLong(1), connectorId).stream().findFirst().orElse(0L) : Math.max(0, sinceEventId);
        String runId = UUID.randomUUID().toString();
        try { jdbc.update("INSERT INTO cloud_connector_sync_run (id, workspace_id, connector_id, mode, status, cursor_before, client_mutation_id, requested_by) VALUES (?, ?, ?, ?, 'queued', ?, ?, ?)", runId, workspace, connectorId, normalizedMode, cursorBefore, mutation, userId); }
        catch (DuplicateKeyException duplicate) { if (mutation != null) return listConnectorSyncRuns(userId, workspace, connectorId).stream().filter(row -> mutation.equals(row.get("clientMutationId"))).findFirst().orElseThrow(() -> duplicate); throw duplicate; }
        jdbc.update("UPDATE cloud_connector_sync_run SET status = 'running', started_at = CURRENT_TIMESTAMP(6) WHERE id = ?", runId);
        int read = 0, written = 0, skipped = 0; long cursorAfter = cursorBefore;
        try {
            List<Map<String, Object>> mappings = activeMappingRows(connectorId, workspace);
            List<Map<String, Object>> events = jdbc.query("SELECT id, quality, payload_json, occurred_at FROM cloud_runtime_event WHERE connector_id = ? AND id > ? ORDER BY id ASC LIMIT 500", (rs, rowNum) -> { Map<String, Object> row = new LinkedHashMap<>(); row.put("id", rs.getLong("id")); row.put("quality", rs.getString("quality")); row.put("payload", json(rs.getString("payload_json"))); row.put("occurredAt", rs.getTimestamp("occurred_at")); return row; }, connectorId, cursorBefore);
            for (Map<String, Object> event : events) {
                read++; cursorAfter = ((Number) event.get("id")).longValue(); JsonNode payload = (JsonNode) event.get("payload");
                for (Map<String, Object> mapping : mappings) {
                    JsonNode value = sourceValue(payload, String.valueOf(mapping.get("sourceTag")));
                    if (value == null || value.isMissingNode() || value.isNull()) { skipped++; continue; }
                    JsonNode transformed = applyTransform(value, (JsonNode) mapping.get("transform")); String pointId = (String) mapping.get("dataPointId"); String mappingTwinId = (String) mapping.get("twinId");
                    if (pointId != null) jdbc.update("INSERT INTO cloud_data_event (workspace_id, device_id, twin_id, point_id, event_type, quality, value_json, occurred_at) VALUES (?, NULL, ?, ?, 'mapped_telemetry', ?, ?, ?)", workspace, mappingTwinId, pointId, event.get("quality"), toJson(transformed), event.get("occurredAt"));
                    if (mappingTwinId != null) updateTwinFromMapping(mappingTwinId, String.valueOf(mapping.get("semanticKey")), transformed, String.valueOf(event.get("quality")), (Timestamp) event.get("occurredAt"));
                    written++;
                }
            }
            jdbc.update("UPDATE cloud_connector_sync_run SET status = 'completed', cursor_after = ?, events_read = ?, values_written = ?, skipped_values = ?, completed_at = CURRENT_TIMESTAMP(6) WHERE id = ?", cursorAfter, read, written, skipped, runId);
            audit(workspace, userId, "data-cloud", "connector.sync_completed", "connector_sync_run", runId, "success", Map.of("eventsRead", read, "valuesWritten", written));
        } catch (RuntimeException error) {
            String message = error.getMessage() == null ? "同步回放失败" : error.getMessage();
            jdbc.update("UPDATE cloud_connector_sync_run SET status = 'failed', cursor_after = ?, events_read = ?, values_written = ?, skipped_values = ?, error_text = ?, completed_at = CURRENT_TIMESTAMP(6) WHERE id = ?", cursorAfter, read, written, skipped, message.substring(0, Math.min(2000, message.length())), runId);
            audit(workspace, userId, "data-cloud", "connector.sync_failed", "connector_sync_run", runId, "failed", Map.of("error", message));
        }
        return listConnectorSyncRuns(userId, workspace, connectorId).stream().filter(row -> runId.equals(row.get("id"))).findFirst().orElseThrow();
    }

    private List<Map<String, Object>> activeMappingRows(String connectorId, String workspace) {
        return jdbc.query("SELECT id, data_point_id, twin_id, source_tag, semantic_key, transform_json FROM cloud_tag_mapping WHERE connector_id = ? AND workspace_id = ? AND status = 'active'", (rs, rowNum) -> { Map<String, Object> row = new LinkedHashMap<>(); row.put("id", rs.getString("id")); row.put("dataPointId", rs.getString("data_point_id")); row.put("twinId", rs.getString("twin_id")); row.put("sourceTag", rs.getString("source_tag")); row.put("semanticKey", rs.getString("semantic_key")); row.put("transform", json(rs.getString("transform_json"))); return row; }, connectorId, workspace);
    }

    private void updateTwinFromMapping(String twinId, String semanticKey, JsonNode value, String quality, Timestamp occurredAt) {
        String current = jdbc.query("SELECT state_json FROM cloud_twin WHERE id = ?", (rs, rowNum) -> rs.getString(1), twinId).stream().findFirst().orElse("{}");
        JsonNode parsed = json(current); ObjectNode state = parsed.isObject() ? (ObjectNode) parsed.deepCopy() : mapper.createObjectNode(); state.set(semanticKey, value);
        jdbc.update("UPDATE cloud_twin SET state_json = ?, quality = ?, last_state_at = ?, updated_at = CURRENT_TIMESTAMP(6) WHERE id = ?", toJson(state), normalizeToken(quality, "unknown", 24), occurredAt, twinId);
    }

    private JsonNode sourceValue(JsonNode payload, String sourceTag) {
        if (payload == null || !payload.isObject()) return null;
        if (payload.has(sourceTag)) return payload.get(sourceTag);
        JsonNode current = payload;
        for (String part : sourceTag.split("\\.")) { if (!current.isObject() || !current.has(part)) return null; current = current.get(part); }
        return current;
    }

    private JsonNode applyTransform(JsonNode value, JsonNode transform) {
        if (transform == null || !transform.isObject() || !value.isNumber()) return value;
        double output = value.asDouble(); if (transform.has("scale")) output *= transform.path("scale").asDouble(1); if (transform.has("offset")) output += transform.path("offset").asDouble(0);
        if (transform.has("round")) { int digits = Math.max(0, Math.min(8, transform.path("round").asInt(0))); double factor = Math.pow(10, digits); output = Math.round(output * factor) / factor; }
        return mapper.getNodeFactory().numberNode(output);
    }

    private JsonNode normalizeTransform(JsonNode transform) {
        ObjectNode normalized = transform != null && transform.isObject() ? (ObjectNode) transform.deepCopy() : mapper.createObjectNode();
        for (String field : List.of("scale", "offset")) if (normalized.has(field) && !normalized.path(field).isNumber()) throw new IllegalArgumentException("变换规则的 " + field + " 必须是数字");
        if (normalized.has("round") && (!normalized.path("round").isIntegralNumber() || normalized.path("round").asInt() < 0 || normalized.path("round").asInt() > 8)) throw new IllegalArgumentException("变换规则 round 必须是 0–8 的整数");
        if (toJson(normalized).length() > 2000) throw new IllegalArgumentException("变换规则不能超过 2 KB");
        return normalized;
    }

    private void validateMappingTargets(String workspace, String pointId, String twinId) {
        if (pointId == null && twinId == null) throw new IllegalArgumentException("映射至少需要一个数据点或孪生目标");
        if (pointId != null && (jdbc.queryForObject("SELECT COUNT(*) FROM cloud_data_point WHERE id = ? AND workspace_id = ?", Integer.class, pointId, workspace) == null || jdbc.queryForObject("SELECT COUNT(*) FROM cloud_data_point WHERE id = ? AND workspace_id = ?", Integer.class, pointId, workspace) == 0)) throw new IllegalArgumentException("目标数据点不存在或不属于当前工作空间");
        if (twinId != null && (jdbc.queryForObject("SELECT COUNT(*) FROM cloud_twin WHERE id = ? AND workspace_id = ?", Integer.class, twinId, workspace) == null || jdbc.queryForObject("SELECT COUNT(*) FROM cloud_twin WHERE id = ? AND workspace_id = ?", Integer.class, twinId, workspace) == 0)) throw new IllegalArgumentException("目标孪生不存在或不属于当前工作空间");
    }

    private String connectorWorkspace(String userId, String connectorId) {
        String workspace = jdbc.query("SELECT workspace_id FROM cloud_connector WHERE id = ?", (rs, rowNum) -> rs.getString(1), connectorId).stream().findFirst().orElseThrow(() -> new IllegalArgumentException("连接器不存在或无权访问"));
        return resolveWorkspace(userId, workspace);
    }

    private String validateRuntimeTarget(String workspace, String id, String table, String label) {
        String target = blankToNull(id); if (target == null) return null;
        Integer count = jdbc.queryForObject("SELECT COUNT(*) FROM " + table + " WHERE id = ? AND workspace_id = ?", Integer.class, target, workspace);
        if (count == null || count == 0) throw new IllegalArgumentException(label + "不存在或不属于当前工作空间");
        return target;
    }

    private String validateProjectTarget(String workspace, String projectId) {
        String project = blankToNull(projectId); if (project == null) return null;
        Integer count = jdbc.queryForObject("SELECT COUNT(*) FROM cloud_project WHERE id = ? AND workspace_id = ?", Integer.class, project, workspace);
        if (count == null || count == 0) throw new IllegalArgumentException("项目不存在或不属于当前工作空间");
        return project;
    }

    private String validateWorkspaceUser(String workspace, String userId) {
        String target = blankToNull(userId); if (target == null) return null;
        Integer count = jdbc.queryForObject("SELECT COUNT(*) FROM cloud_workspace_member WHERE workspace_id = ? AND user_id = ? AND status = 'active'", Integer.class, workspace, target);
        if (count == null || count == 0) throw new IllegalArgumentException("负责人不是当前工作空间成员");
        return target;
    }

    private Timestamp parseTimestamp(String value, String label) {
        try { return Timestamp.from(value == null || value.isBlank() ? Instant.now() : Instant.parse(value)); }
        catch (RuntimeException error) { throw new IllegalArgumentException(label + "必须是 ISO-8601 时间"); }
    }
    private Instant parseInstant(String value, String label) { return parseTimestamp(value, label).toInstant(); }

    private Timestamp optionalTimestamp(String value, String label) { return value == null || value.isBlank() ? null : parseTimestamp(value, label); }
    private String optionalInstant(Timestamp value) { return value == null ? null : value.toInstant().toString(); }
    private BigDecimal decimalValue(JsonNode value) {
        if (value == null || value.isNull() || value.isObject() || value.isArray() || value.isBoolean()) return null;
        try { return value.isNumber() ? value.decimalValue() : new BigDecimal(value.asText().trim()); }
        catch (RuntimeException error) { return null; }
    }
    private String normalizeQuality(String quality) { String normalized = normalizeToken(quality, "unknown", 24); return List.of("good", "bad", "uncertain", "unknown").contains(normalized) ? normalized : "unknown"; }
    private String normalizeWorkOrderStatus(String status) { String normalized = normalizeToken(status, "open", 24); return List.of("open", "in_progress", "done", "cancelled").contains(normalized) ? normalized : "open"; }
    private String normalizePriority(String priority) { String normalized = normalizeToken(priority, "normal", 16); return List.of("low", "normal", "high", "urgent").contains(normalized) ? normalized : "normal"; }
    private String normalizeQualityResult(String result) { String normalized = normalizeToken(result, "unknown", 24); return List.of("pass", "quarantine", "rework", "scrap", "unknown").contains(normalized) ? normalized : "unknown"; }
    private String normalizeMaintenanceResult(String result) { String normalized = normalizeToken(result, "reported", 24); return List.of("reported", "in_progress", "completed", "failed", "deferred").contains(normalized) ? normalized : "reported"; }

    private String requiredValue(String value, String label, int max) {
        String normalized = blankToNull(value); if (normalized == null) throw new IllegalArgumentException(label + "不能为空"); return normalized.substring(0, Math.min(max, normalized.length()));
    }

    public Map<String, Object> mobileSummary(String userId, String workspaceId) {
        String workspace = resolveWorkspace(userId, workspaceId);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("workspace", listWorkspaces(userId).stream().filter(item -> workspace.equals(item.get("id"))).findFirst().orElseThrow());
        result.put("overview", overview(userId, workspace)); result.put("projects", listProjects(userId, workspace)); result.put("tasks", listTasks(userId, workspace).stream().limit(20).toList()); result.put("approvals", listApprovals(userId, workspace).stream().limit(20).toList());
        result.put("notifications", listNotifications(userId).stream().limit(20).toList()); result.put("connectors", listConnectors(userId, workspace));
        result.put("activity", listActivity(userId, workspace, null, null, 20));
        return result;
    }

    public List<Map<String, Object>> listComments(String userId, String workspaceId, String objectType, String objectId) {
        String workspace = resolveWorkspace(userId, workspaceId);
        if ("project".equals(normalizeToken(objectType, "project", 48))) assertProjectAccess(userId, objectId);
        return jdbc.query("""
                SELECT c.id, c.object_type, c.object_id, c.body, c.author_user_id, u.username AS author, c.created_at, c.updated_at
                FROM cloud_comment c JOIN app_user u ON u.id = c.author_user_id
                WHERE c.workspace_id = ? AND c.object_type = ? AND c.object_id = ? ORDER BY c.created_at ASC
                """, (rs, rowNum) -> {
            Map<String, Object> item = new LinkedHashMap<>(); item.put("id", rs.getString("id")); item.put("objectType", rs.getString("object_type")); item.put("objectId", rs.getString("object_id")); item.put("body", rs.getString("body")); item.put("authorUserId", rs.getString("author_user_id")); item.put("author", rs.getString("author")); item.put("createdAt", instant(rs.getTimestamp("created_at"))); item.put("updatedAt", instant(rs.getTimestamp("updated_at"))); return item;
        }, workspace, normalizeToken(objectType, "project", 48), objectId);
    }

    @Transactional
    public Map<String, Object> createComment(String userId, String workspaceId, String objectType, String objectId, String body) {
        String workspace = resolveWorkspace(userId, workspaceId);
        if (objectId == null || objectId.isBlank()) throw new IllegalArgumentException("评论对象不能为空");
        String normalizedBody = body == null ? "" : body.trim();
        if (normalizedBody.isBlank()) throw new IllegalArgumentException("评论内容不能为空");
        normalizedBody = normalizedBody.substring(0, Math.min(2000, normalizedBody.length()));
        String normalizedType = normalizeToken(objectType, "project", 48);
        if ("project".equals(normalizedType)) assertProjectAccess(userId, objectId);
        String id = UUID.randomUUID().toString();
        jdbc.update("INSERT INTO cloud_comment (id, workspace_id, author_user_id, object_type, object_id, body) VALUES (?, ?, ?, ?, ?, ?)", id, workspace, userId, normalizedType, objectId, normalizedBody);
        audit(workspace, userId, "cloud", "comment.created", normalizedType, objectId, "success", Map.of("commentId", id));
        return listComments(userId, workspace, normalizedType, objectId).stream().filter(item -> id.equals(item.get("id"))).findFirst().orElseThrow();
    }

    public List<Map<String, Object>> listApprovals(String userId, String workspaceId) {
        String workspace = resolveWorkspace(userId, workspaceId);
        String workspaceRole = workspaceRole(userId, workspace);
        return jdbc.query("""
                SELECT a.id, a.workspace_id, a.project_id, p.name AS project_name, a.approval_type, a.object_type, a.object_id,
                       a.title, a.detail, a.evidence_json, a.rollback_available, a.status, a.requested_by, ru.username AS requester,
                       a.decided_by, du.username AS decider, a.decision_note, a.client_mutation_id, a.created_at, a.updated_at, a.decided_at
                FROM cloud_approval_request a
                LEFT JOIN cloud_project p ON p.id = a.project_id
                LEFT JOIN app_user ru ON ru.id = a.requested_by
                LEFT JOIN app_user du ON du.id = a.decided_by
                WHERE a.workspace_id = ?
                  AND (a.project_id IS NULL OR ? IN ('owner', 'admin') OR EXISTS (SELECT 1 FROM cloud_project_member pm WHERE pm.project_id = a.project_id AND pm.user_id = ? AND pm.status = 'active'))
                ORDER BY FIELD(a.status, 'pending', 'replan', 'approved', 'rejected'), a.updated_at DESC
                """, (rs, rowNum) -> approvalRow(rs), workspace, workspaceRole, userId);
    }

    @Transactional
    public Map<String, Object> createApproval(String userId, String workspaceId, String projectId, String approvalType, String objectType, String objectId, String title, String detail, JsonNode evidence, boolean rollbackAvailable, String clientMutationId) {
        String workspace = resolveWorkspace(userId, workspaceId);
        if (projectId != null && !projectId.isBlank()) {
            assertProjectRole(userId, projectId, "editor");
            String projectWorkspace = projectWorkspace(projectId);
            if (!workspace.equals(projectWorkspace)) throw new IllegalArgumentException("项目不属于当前工作空间");
        }
        String mutationId = mutationId(clientMutationId);
        if (mutationId != null) {
            String existingId = jdbc.query("SELECT id FROM cloud_approval_request WHERE workspace_id = ? AND requested_by = ? AND client_mutation_id = ?", (rs, rowNum) -> rs.getString(1), workspace, userId, mutationId).stream().findFirst().orElse(null);
            if (existingId != null) return listApprovals(userId, workspace).stream().filter(item -> existingId.equals(item.get("id"))).findFirst().orElseThrow();
        }
        String id = UUID.randomUUID().toString();
        String normalizedType = normalizeToken(approvalType, "general", 48);
        String normalizedObjectType = normalizeToken(objectType, "project", 48);
        String normalizedTitle = normalizeTitle(title);
        try {
            jdbc.update("INSERT INTO cloud_approval_request (id, workspace_id, project_id, approval_type, object_type, object_id, title, detail, evidence_json, rollback_available, status, requested_by, client_mutation_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)", id, workspace, blankToNull(projectId), normalizedType, normalizedObjectType, normalizeIdentifier(objectId), normalizedTitle, truncate(detail, 2000), toJson(evidence == null ? mapper.createObjectNode() : evidence), rollbackAvailable, userId, mutationId);
        } catch (DuplicateKeyException duplicate) {
            if (mutationId != null) return listApprovals(userId, workspace).stream().filter(item -> mutationId.equals(item.get("clientMutationId"))).findFirst().orElseThrow(() -> duplicate);
            throw duplicate;
        }
        jdbc.update("INSERT INTO cloud_approval_action (approval_id, action, actor_user_id, note, metadata_json) VALUES (?, 'requested', ?, ?, ?)", id, userId, truncate(detail, 2000), "{}");
        audit(workspace, userId, "cloud", "approval.requested", normalizedObjectType, normalizeIdentifier(objectId), "success", Map.of("approvalId", id, "type", normalizedType));
        notifyWorkspaceMembers(workspace, userId, "approval_requested", "新的审批请求", normalizedTitle, normalizedObjectType, normalizeIdentifier(objectId));
        return listApprovals(userId, workspace).stream().filter(item -> id.equals(item.get("id"))).findFirst().orElseThrow();
    }

    @Transactional
    public Map<String, Object> decideApproval(String userId, String approvalId, String status, String note) {
        Map<String, Object> request = jdbc.query("SELECT workspace_id, project_id, status, object_type, object_id FROM cloud_approval_request WHERE id = ?", (rs, rowNum) -> {
            Map<String, Object> row = new LinkedHashMap<>(); row.put("workspaceId", rs.getString("workspace_id")); row.put("projectId", rs.getString("project_id")); row.put("status", rs.getString("status")); row.put("objectType", rs.getString("object_type")); row.put("objectId", rs.getString("object_id")); return row;
        }, approvalId).stream().findFirst().orElseThrow(() -> new IllegalArgumentException("审批请求不存在"));
        String workspace = (String) request.get("workspaceId");
        resolveWorkspace(userId, workspace);
        String projectId = (String) request.get("projectId");
        if (projectId == null) assertWorkspaceAdmin(userId, workspace); else assertProjectRole(userId, projectId, "manager");
        String normalized = normalizeApprovalStatus(status);
        if (!"pending".equals(request.get("status")) && !"replan".equals(request.get("status"))) throw new IllegalArgumentException("当前审批状态不允许再次决策");
        String decision = truncate(note, 2000);
        jdbc.update("UPDATE cloud_approval_request SET status = ?, decided_by = ?, decision_note = ?, decided_at = CURRENT_TIMESTAMP(6), updated_at = CURRENT_TIMESTAMP(6) WHERE id = ? AND status IN ('pending', 'replan')", normalized, userId, decision, approvalId);
        jdbc.update("INSERT INTO cloud_approval_action (approval_id, action, actor_user_id, note, metadata_json) VALUES (?, ?, ?, ?, ?)", approvalId, normalized, userId, decision, "{}");
        audit(workspace, userId, "cloud", "approval." + normalized, (String) request.get("objectType"), (String) request.get("objectId"), "success", Map.of("approvalId", approvalId, "note", decision == null ? "" : decision));
        String requester = jdbc.queryForObject("SELECT requested_by FROM cloud_approval_request WHERE id = ?", String.class, approvalId);
        notifyUser(workspace, requester, "approval_decided", "审批请求已处理", "审批结果：" + normalized + (decision == null ? "" : " · " + decision), (String) request.get("objectType"), (String) request.get("objectId"));
        return listApprovals(userId, workspace).stream().filter(item -> approvalId.equals(item.get("id"))).findFirst().orElseThrow();
    }

    private Map<String, Object> approvalRow(java.sql.ResultSet rs) throws java.sql.SQLException {
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("id", rs.getString("id")); item.put("workspaceId", rs.getString("workspace_id")); item.put("projectId", rs.getString("project_id")); item.put("projectName", rs.getString("project_name"));
        item.put("type", rs.getString("approval_type")); item.put("objectType", rs.getString("object_type")); item.put("objectId", rs.getString("object_id")); item.put("title", rs.getString("title")); item.put("detail", rs.getString("detail"));
        item.put("evidence", json(rs.getString("evidence_json"))); item.put("rollbackAvailable", rs.getBoolean("rollback_available")); item.put("status", rs.getString("status")); item.put("requestedBy", rs.getString("requested_by")); item.put("requester", rs.getString("requester"));
        item.put("decidedBy", rs.getString("decided_by")); item.put("decider", rs.getString("decider")); item.put("decisionNote", rs.getString("decision_note")); item.put("clientMutationId", rs.getString("client_mutation_id")); item.put("createdAt", instant(rs.getTimestamp("created_at"))); item.put("updatedAt", instant(rs.getTimestamp("updated_at"))); item.put("decidedAt", rs.getTimestamp("decided_at") == null ? null : instant(rs.getTimestamp("decided_at")));
        return item;
    }

    private void notifyWorkspaceMembers(String workspaceId, String excludedUserId, String type, String title, String body, String objectType, String objectId) {
        List<String> recipients = jdbc.query("SELECT user_id FROM cloud_workspace_member WHERE workspace_id = ? AND status = 'active' AND user_id <> ?", (rs, rowNum) -> rs.getString(1), workspaceId, excludedUserId);
        for (String recipient : recipients) notifyUser(workspaceId, recipient, type, title, body, objectType, objectId);
    }

    private void notifyUser(String workspaceId, String recipientUserId, String type, String title, String body, String objectType, String objectId) {
        if (recipientUserId == null || recipientUserId.isBlank()) return;
        String notificationId = UUID.randomUUID().toString();
        jdbc.update("INSERT INTO cloud_notification (id, workspace_id, recipient_user_id, type, title, body, object_type, object_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", notificationId, workspaceId, recipientUserId, normalizeToken(type, "cloud", 48), truncate(title, 180), truncate(body, 1000), objectType, objectId);
        jdbc.update("INSERT INTO cloud_outbox_event (id, workspace_id, event_type, aggregate_type, aggregate_id, payload_json) VALUES (?, ?, ?, ?, ?, ?)", UUID.randomUUID().toString(), workspaceId, "notification.created", objectType, objectId, toJson(Map.of("notificationId", notificationId, "recipientUserId", recipientUserId, "type", type)));
    }

    @Transactional
    public void audit(String workspaceId, String actorUserId, String source, String action, String objectType, String objectId, String result, Map<String, Object> detail) {
        String json = toJson(detail == null ? Map.of() : detail);
        jdbc.update("INSERT INTO cloud_audit_log (workspace_id, actor_user_id, source, action, object_type, object_id, result, detail_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", workspaceId, actorUserId, source, action, objectType, objectId, result, json);
        Long auditIdValue = jdbc.queryForObject("SELECT LAST_INSERT_ID()", Long.class);
        long auditId = auditIdValue == null ? 0 : auditIdValue;
        Map<String, Object> event = new LinkedHashMap<>();
        event.put("auditId", auditId);
        event.put("actorUserId", actorUserId);
        event.put("source", source);
        event.put("action", action);
        event.put("objectType", objectType);
        event.put("objectId", objectId);
        event.put("result", result);
        event.put("detail", detail == null ? Map.of() : detail);
        jdbc.update("INSERT INTO cloud_outbox_event (id, workspace_id, event_type, aggregate_type, aggregate_id, payload_json) VALUES (?, ?, 'audit.recorded', ?, ?, ?)", UUID.randomUUID().toString(), workspaceId, objectType, objectId, toJson(event));
    }

    private void assertProjectAccess(String userId, String projectId) {
        projectRole(userId, projectId);
    }

    public void assertProjectReader(String userId, String projectId) {
        assertProjectAccess(userId, projectId);
    }

    private void assertProjectRole(String userId, String projectId, String minimumRole) {
        String role = projectRole(userId, projectId);
        List<String> levels = List.of("viewer", "editor", "manager");
        if (levels.indexOf(role) < levels.indexOf(minimumRole)) throw new IllegalArgumentException("当前账号没有该项目的 " + minimumRole + " 权限");
    }

    private String projectRole(String userId, String projectId) {
        List<String> roles = jdbc.query("""
                SELECT COALESCE(pm.role, CASE WHEN wm.role IN ('owner', 'admin') THEN 'manager' ELSE NULL END)
                FROM cloud_project p
                JOIN cloud_workspace_member wm ON wm.workspace_id = p.workspace_id AND wm.user_id = ? AND wm.status = 'active'
                LEFT JOIN cloud_project_member pm ON pm.project_id = p.id AND pm.user_id = ? AND pm.status = 'active'
                WHERE p.id = ? AND (wm.role IN ('owner', 'admin') OR pm.user_id IS NOT NULL)
                """, (rs, rowNum) -> rs.getString(1), userId, userId, projectId);
        return roles.stream().findFirst().orElseThrow(() -> new IllegalArgumentException("项目不存在或无权访问"));
    }

    private void assertProjectAdmin(String userId, String projectId) {
        String workspace = projectWorkspace(projectId);
        Integer workspaceAdmin = jdbc.queryForObject("SELECT COUNT(*) FROM cloud_workspace_member WHERE workspace_id = ? AND user_id = ? AND status = 'active' AND role IN ('owner', 'admin')", Integer.class, workspace, userId);
        if (workspaceAdmin != null && workspaceAdmin > 0) return;
        assertProjectRole(userId, projectId, "manager");
    }

    private String projectWorkspace(String projectId) {
        return jdbc.query("SELECT workspace_id FROM cloud_project WHERE id = ?", (rs, rowNum) -> rs.getString(1), projectId).stream().findFirst().orElseThrow(() -> new IllegalArgumentException("项目不存在"));
    }

    private String workspaceRole(String userId, String workspaceId) {
        return jdbc.query("SELECT role FROM cloud_workspace_member WHERE workspace_id = ? AND user_id = ? AND status = 'active'", (rs, rowNum) -> rs.getString(1), workspaceId, userId).stream().findFirst().orElse("guest");
    }

    private void validateSave(JsonNode save) {
        if (save == null || !save.isObject()) throw new IllegalArgumentException("版本存档不能为空");
        int version = save.path("version").asInt(-1);
        if (version < 1 || version > 6) throw new IllegalArgumentException("不支持的存档版本");
        for (String field : List.of("objects", "items", "recipes")) if (!save.path(field).isArray()) throw new IllegalArgumentException(field + " 不是数组");
        if (version >= 5 && (!save.path("floorNames").isArray() || !save.path("machineDefinitions").isArray())) throw new IllegalArgumentException("版本存档缺少楼层或机器定义");
    }

    private void assertWorkspaceAdmin(String userId, String workspaceId) {
        Integer count = jdbc.queryForObject("SELECT COUNT(*) FROM cloud_workspace_member WHERE workspace_id = ? AND user_id = ? AND status = 'active' AND role IN ('owner', 'admin')", Integer.class, workspaceId, userId);
        if (count == null || count == 0) throw new IllegalArgumentException("没有工作空间管理权限");
    }

    private String resolveWorkspace(String userId, String workspaceId) {
        String resolved = workspaceId == null || workspaceId.isBlank() ? defaultWorkspaceId(userId) : workspaceId;
        Integer count = jdbc.queryForObject("SELECT COUNT(*) FROM cloud_workspace_member WHERE workspace_id = ? AND user_id = ? AND status = 'active'", Integer.class, resolved, userId);
        if (count == null || count == 0) throw new IllegalArgumentException("工作空间不存在或无权访问");
        return resolved;
    }

    private int count(String sql, String value) { Integer count = jdbc.queryForObject(sql, Integer.class, value); return count == null ? 0 : count; }
    private Number number(Object value) { return value instanceof Number number ? number : 0; }
    private String normalizeName(String name) { String value = name == null || name.isBlank() ? "未命名工作空间" : name.trim(); return value.substring(0, Math.min(120, value.length())); }
    private String normalizeTitle(String title) { String value = title == null || title.isBlank() ? "未命名任务" : title.trim(); return value.substring(0, Math.min(180, value.length())); }
    private String normalizeRole(String role) { String value = normalizeToken(role, "member", 32); return List.of("admin", "member", "guest").contains(value) ? value : "member"; }
    private String normalizeProjectRole(String role) { String value = normalizeToken(role, "viewer", 32); return List.of("manager", "editor", "viewer").contains(value) ? value : "viewer"; }
    private String normalizeApprovalStatus(String status) { String value = normalizeToken(status, "rejected", 24); return List.of("approved", "rejected", "replan").contains(value) ? value : "rejected"; }
    private String normalizeIdentifier(String value) { String normalized = value == null || value.isBlank() ? "unknown" : value.trim(); return normalized.substring(0, Math.min(96, normalized.length())); }
    private JsonNode normalizeAssetManifest(JsonNode manifest, String visibility) {
        ObjectNode normalized = manifest != null && manifest.isObject() ? (ObjectNode) manifest.deepCopy() : mapper.createObjectNode();
        int manifestVersion = normalized.path("manifestVersion").asInt(1);
        if (manifestVersion != 1) throw new IllegalArgumentException("资源 manifest 仅支持 v1");
        normalized.put("manifestVersion", 1);
        JsonNode license = normalized.get("license");
        if (license == null || license.isNull()) license = normalized.putObject("license");
        if (!license.isObject()) throw new IllegalArgumentException("资源许可证必须是结构化对象");
        boolean hasLicense = hasText(license, "spdx") || hasText(license, "expression") || hasText(license, "declaration");
        if ("public".equals(visibility) && !hasLicense) throw new IllegalArgumentException("公开资源必须填写 SPDX、表达式或许可证声明");
        JsonNode dependencies = normalized.get("dependencies");
        if (dependencies == null || dependencies.isNull()) dependencies = normalized.putArray("dependencies");
        if (!dependencies.isArray()) throw new IllegalArgumentException("资源依赖必须是数组");
        if (dependencies.size() > 100) throw new IllegalArgumentException("资源依赖不能超过 100 项");
        for (JsonNode dependency : dependencies) {
            if (!dependency.isObject() || !hasText(dependency, "id")) throw new IllegalArgumentException("每个资源依赖必须包含 id");
        }
        if (toJson(normalized).length() > 20_000) throw new IllegalArgumentException("资源 manifest 不能超过 20 KB");
        return normalized;
    }
    private boolean hasText(JsonNode node, String field) { return node.has(field) && !node.path(field).asText("").trim().isBlank(); }
    private String mutationId(String value) { return truncate(value, 120); }
    private String truncate(String value, int max) { if (value == null || value.isBlank()) return null; String normalized = value.trim(); return normalized.substring(0, Math.min(max, normalized.length())); }
    private String normalizeToken(String value, String fallback, int max) { String normalized = value == null || value.isBlank() ? fallback : value.trim().toLowerCase(); return normalized.substring(0, Math.min(max, normalized.length())); }
    private String blankToNull(String value) { return value == null || value.isBlank() ? null : value; }
    private String instant(java.sql.Timestamp value) { return value == null ? Instant.now().toString() : value.toInstant().toString(); }
    private JsonNode json(String value) { try { return value == null ? mapper.createObjectNode() : mapper.readTree(value); } catch (IOException e) { return mapper.createObjectNode(); } }
    private String toJson(Object value) { try { return mapper.writeValueAsString(value); } catch (IOException e) { throw new IllegalArgumentException("审计详情无法序列化", e); } }

    public static final class VersionConflictException extends RuntimeException {
        private final String projectId;
        private final String currentVersionId;
        private final String baseVersionId;

        public VersionConflictException(String projectId, String currentVersionId, String baseVersionId) {
            super("项目版本基线已变化，请重新加载后合并"); this.projectId = projectId; this.currentVersionId = currentVersionId; this.baseVersionId = baseVersionId;
        }

        public String projectId() { return projectId; }
        public String currentVersionId() { return currentVersionId; }
        public String baseVersionId() { return baseVersionId; }
    }
}
