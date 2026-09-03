package com.forgemind.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.List;
import java.util.UUID;

/**
 * Compatibility projection from the existing ForgeMind factory/resource tables
 * into the first ForgeCloud versioned data model. The old tables remain the
 * source of truth until the full project migration is complete.
 */
@Service
public class CloudProjectionService {
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;

    public CloudProjectionService(JdbcTemplate jdbc, ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.mapper = mapper;
    }

    @Transactional
    public void syncFactoryProject(String userId, String projectId) {
        ensureWorkspace(userId);
        List<FactoryRow> rows = jdbc.query("""
                SELECT f.id, f.name, f.schema_version, f.save_json, w.id AS workspace_id
                FROM factory f
                JOIN cloud_workspace w ON w.id = (
                    SELECT w2.id FROM cloud_workspace w2
                    WHERE w2.owner_user_id = f.owner_user_id
                    ORDER BY CASE WHEN w2.workspace_type = 'personal' THEN 0 ELSE 1 END, w2.created_at
                    LIMIT 1
                )
                WHERE f.id = ? AND f.owner_user_id = ?
                """, (rs, rowNum) -> new FactoryRow(
                rs.getString("id"), rs.getString("name"), rs.getInt("schema_version"),
                rs.getString("save_json"), rs.getString("workspace_id")
        ), projectId, userId);
        if (rows.isEmpty()) return;
        FactoryRow row = rows.get(0);
        String saveJson = row.saveJson() == null ? "{}" : row.saveJson();
        String hash = sha256(saveJson);
        jdbc.update("""
                INSERT INTO cloud_project (id, workspace_id, owner_user_id, name, project_type, visibility, status)
                VALUES (?, ?, ?, ?, 'factory', 'private', 'active')
                ON DUPLICATE KEY UPDATE name = VALUES(name), updated_at = CURRENT_TIMESTAMP(6)
                """, row.id(), row.workspaceId(), userId, row.name());

        String currentHash = jdbc.query("SELECT content_hash FROM cloud_project_version WHERE id = (SELECT current_version_id FROM cloud_project WHERE id = ?)",
                (rs, rowNum) -> rs.getString(1), row.id()).stream().findFirst().orElse(null);
        if (hash.equals(currentHash)) return;
        String parentId = jdbc.query("SELECT COALESCE(current_version_id, '') FROM cloud_project WHERE id = ?", (rs, rowNum) -> rs.getString(1), row.id())
                .stream().findFirst().map(value -> value.isBlank() ? null : value).orElse(null);
        Integer nextVersion = jdbc.queryForObject("SELECT COALESCE(MAX(version_no), 0) + 1 FROM cloud_project_version WHERE project_id = ? AND branch_name = 'main'", Integer.class, row.id());
        String versionId = UUID.randomUUID().toString();
        jdbc.update("""
                INSERT INTO cloud_project_version (id, project_id, parent_version_id, version_no, branch_name, schema_version, content_hash, save_json, note, created_by)
                VALUES (?, ?, ?, ?, 'main', ?, ?, ?, 'Synchronized from ForgeMind save', ?)
                """, versionId, row.id(), parentId, nextVersion == null ? 1 : nextVersion, row.schemaVersion(), hash, saveJson, userId);
        jdbc.update("UPDATE cloud_project SET current_version_id = ?, updated_at = CURRENT_TIMESTAMP(6) WHERE id = ?", versionId, row.id());
    }

    @Transactional
    public void syncAllForUser(String userId) {
        ensureWorkspace(userId);
        List<String> ids = jdbc.query("SELECT id FROM factory WHERE owner_user_id = ? ORDER BY updated_at DESC", (rs, rowNum) -> rs.getString(1), userId);
        ids.forEach(id -> syncFactoryProject(userId, id));
        syncAssetsForUser(userId);
    }

    @Transactional
    public void syncAssetsForUser(String userId) {
        ensureWorkspace(userId);
        List<ImportedRow> rows = jdbc.query("""
                SELECT r.resource_id, r.metadata_json, r.owner_user_id, w.id AS workspace_id
                FROM imported_resource r
                JOIN cloud_workspace w ON w.id = (
                    SELECT w2.id FROM cloud_workspace w2
                    WHERE w2.owner_user_id = r.owner_user_id
                    ORDER BY CASE WHEN w2.workspace_type = 'personal' THEN 0 ELSE 1 END, w2.created_at
                    LIMIT 1
                )
                WHERE r.owner_user_id = ?
                """, (rs, rowNum) -> new ImportedRow(
                rs.getString("resource_id"), rs.getString("metadata_json"), rs.getString("owner_user_id"), rs.getString("workspace_id")
        ), userId);
        for (ImportedRow row : rows) {
            String name = assetName(row.metadataJson(), row.externalId());
            String assetId = jdbc.query("SELECT id FROM cloud_asset WHERE workspace_id = ? AND external_id = ?", (rs, rowNum) -> rs.getString(1), row.workspaceId(), row.externalId()).stream().findFirst().orElse(null);
            if (assetId == null) {
                assetId = UUID.randomUUID().toString();
                jdbc.update("INSERT INTO cloud_asset (id, workspace_id, owner_user_id, external_id, kind, name, visibility, status) VALUES (?, ?, ?, ?, 'model3d', ?, 'private', 'published')", assetId, row.workspaceId(), userId, row.externalId(), name);
            } else {
                jdbc.update("UPDATE cloud_asset SET name = ?, updated_at = CURRENT_TIMESTAMP(6) WHERE id = ?", name, assetId);
            }
            String hash = sha256(row.metadataJson());
            String currentHash = jdbc.query("SELECT content_hash FROM cloud_asset_version WHERE id = (SELECT current_version_id FROM cloud_asset WHERE id = ?)", (rs, rowNum) -> rs.getString(1), assetId).stream().findFirst().orElse(null);
            if (hash.equals(currentHash)) continue;
            Integer nextVersion = jdbc.queryForObject("SELECT COALESCE(MAX(version_no), 0) + 1 FROM cloud_asset_version WHERE asset_id = ?", Integer.class, assetId);
            String versionId = UUID.randomUUID().toString();
            jdbc.update("INSERT INTO cloud_asset_version (id, asset_id, version_no, manifest_version, manifest_json, content_hash, created_by) VALUES (?, ?, ?, 1, ?, ?, ?)", versionId, assetId, nextVersion == null ? 1 : nextVersion, row.metadataJson(), hash, userId);
            jdbc.update("UPDATE cloud_asset SET current_version_id = ?, updated_at = CURRENT_TIMESTAMP(6) WHERE id = ?", versionId, assetId);
        }
    }

    public String ensureWorkspace(String userId) {
        String existing = jdbc.query("SELECT id FROM cloud_workspace WHERE owner_user_id = ? ORDER BY created_at LIMIT 1", (rs, rowNum) -> rs.getString(1), userId).stream().findFirst().orElse(null);
        if (existing != null) return existing;
        String workspaceId = UUID.randomUUID().toString();
        String slug = "user-" + userId;
        jdbc.update("INSERT INTO cloud_workspace (id, owner_user_id, name, slug, workspace_type, status) VALUES (?, ?, ?, ?, 'personal', 'active')", workspaceId, userId, "个人工作空间", slug);
        jdbc.update("INSERT INTO cloud_workspace_member (workspace_id, user_id, role, status) VALUES (?, ?, 'owner', 'active')", workspaceId, userId);
        return workspaceId;
    }

    public String contentHash(String value) {
        return sha256(value == null ? "" : value);
    }

    private String sha256(String value) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder out = new StringBuilder(64);
            for (byte part : digest) out.append(String.format("%02x", part));
            return out.toString();
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 不可用", e);
        }
    }

    private String assetName(String metadataJson, String fallback) {
        try {
            String name = mapper.readTree(metadataJson).path("name").asText("").trim();
            return name.isEmpty() ? fallback : name.substring(0, Math.min(120, name.length()));
        } catch (Exception e) {
            return fallback;
        }
    }

    private record FactoryRow(String id, String name, int schemaVersion, String saveJson, String workspaceId) {}
    private record ImportedRow(String externalId, String metadataJson, String ownerUserId, String workspaceId) {}
}
