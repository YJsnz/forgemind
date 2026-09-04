package com.forgemind.repository;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Pattern;

@Repository
public class AssistantKnowledgeRepository {
    private static final Pattern LIVE_FACT_CLAIM = Pattern.compile("(?i)(当前|目前|实时|现有)\\s*(库存|产量|产出|坐标|仿真指标|吞吐|利用率)\\s*(为|是|达到|约为)?\\s*[0-9一二三四五六七八九十]+");
    private static final List<String> CATEGORIES = List.of("custom", "product", "process", "operations", "safety");

    private final JdbcTemplate jdbc;
    private final CloudWorkspaceDbStore cloud;

    public AssistantKnowledgeRepository(JdbcTemplate jdbc, CloudWorkspaceDbStore cloud) {
        this.jdbc = jdbc;
        this.cloud = cloud;
    }

    public List<Map<String, Object>> list(String userId, String workspaceId) {
        String workspace = resolveWorkspace(userId, workspaceId);
        return listResolved(userId, workspace);
    }

    /** Used by the assistant request path when the active ForgeCloud workspace is not mounted. */
    public List<Map<String, Object>> listAll(String userId) {
        return jdbc.query("""
                SELECT d.id, d.workspace_id, d.title, d.category, d.source, d.content, d.status,
                       d.created_by, u.username AS creator, d.created_at, d.updated_at
                FROM assistant_knowledge_document d
                JOIN cloud_workspace_member m ON m.workspace_id = d.workspace_id AND m.user_id = ? AND m.status = 'active'
                LEFT JOIN app_user u ON u.id = d.created_by
                WHERE d.status = 'active'
                ORDER BY d.updated_at DESC
                LIMIT 120
                """, (rs, rowNum) -> row(rs), userId);
    }

    @Transactional
    public Map<String, Object> create(String userId, String workspaceId, String title, String category, String source, String content) {
        String workspace = resolveWorkspace(userId, workspaceId);
        assertCanWrite(userId, workspace);
        String normalizedTitle = normalize(title, "知识条目", 180);
        String normalizedCategory = normalizeCategory(category);
        String normalizedSource = blankToNull(source, 180);
        String normalizedContent = normalizeContent(content);
        String id = UUID.randomUUID().toString();
        jdbc.update("INSERT INTO assistant_knowledge_document (id, workspace_id, created_by, title, category, source, content) VALUES (?, ?, ?, ?, ?, ?, ?)", id, workspace, userId, normalizedTitle, normalizedCategory, normalizedSource, normalizedContent);
        cloud.audit(workspace, userId, "ai-cloud", "assistant.knowledge_created", "assistant_knowledge", id, "success", Map.of("title", normalizedTitle, "category", normalizedCategory));
        return listResolved(userId, workspace).stream().filter(item -> id.equals(item.get("id"))).findFirst().orElseThrow();
    }

    @Transactional
    public void delete(String userId, String workspaceId, String id) {
        String workspace = resolveWorkspace(userId, workspaceId);
        assertCanWrite(userId, workspace);
        int changed = jdbc.update("UPDATE assistant_knowledge_document SET status = 'archived' WHERE id = ? AND workspace_id = ? AND status = 'active'", id, workspace);
        if (changed == 0) throw new IllegalArgumentException("知识条目不存在或已归档");
        cloud.audit(workspace, userId, "ai-cloud", "assistant.knowledge_archived", "assistant_knowledge", id, "success", Map.of());
    }

    private List<Map<String, Object>> listResolved(String userId, String workspace) {
        return jdbc.query("""
                SELECT d.id, d.workspace_id, d.title, d.category, d.source, d.content, d.status,
                       d.created_by, u.username AS creator, d.created_at, d.updated_at
                FROM assistant_knowledge_document d
                LEFT JOIN app_user u ON u.id = d.created_by
                WHERE d.workspace_id = ? AND d.status = 'active'
                ORDER BY d.updated_at DESC
                """, (rs, rowNum) -> row(rs), workspace);
    }

    private Map<String, Object> row(java.sql.ResultSet rs) throws java.sql.SQLException {
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("id", rs.getString("id"));
        item.put("workspaceId", rs.getString("workspace_id"));
        item.put("title", rs.getString("title"));
        item.put("category", rs.getString("category"));
        item.put("source", rs.getString("source"));
        item.put("content", rs.getString("content"));
        item.put("status", rs.getString("status"));
        item.put("createdBy", rs.getString("created_by"));
        item.put("creator", rs.getString("creator"));
        item.put("createdAt", instant(rs.getTimestamp("created_at")));
        item.put("updatedAt", instant(rs.getTimestamp("updated_at")));
        return item;
    }

    private String resolveWorkspace(String userId, String workspaceId) {
        String resolved = workspaceId == null || workspaceId.isBlank() ? cloud.defaultWorkspaceId(userId) : workspaceId;
        Integer count = jdbc.queryForObject("SELECT COUNT(*) FROM cloud_workspace_member WHERE workspace_id = ? AND user_id = ? AND status = 'active'", Integer.class, resolved, userId);
        if (count == null || count == 0) throw new IllegalArgumentException("工作空间不存在或无权访问");
        return resolved;
    }

    private void assertCanWrite(String userId, String workspaceId) {
        Integer count = jdbc.queryForObject("SELECT COUNT(*) FROM cloud_workspace_member WHERE workspace_id = ? AND user_id = ? AND status = 'active' AND role IN ('owner', 'admin', 'member')", Integer.class, workspaceId, userId);
        if (count == null || count == 0) throw new IllegalArgumentException("当前账号没有知识库写入权限");
    }

    private String normalizeCategory(String category) {
        String value = category == null ? "custom" : category.trim().toLowerCase();
        return CATEGORIES.contains(value) ? value : "custom";
    }

    private String normalizeContent(String content) {
        String value = content == null ? "" : content.trim();
        if (value.isBlank()) throw new IllegalArgumentException("知识内容不能为空");
        if (value.length() > 16000) throw new IllegalArgumentException("知识内容不能超过 16000 个字符");
        if (LIVE_FACT_CLAIM.matcher(value).find()) throw new IllegalArgumentException("动态库存、产量、坐标和仿真数字必须通过实时工具读取，不能写入 RAG");
        return value;
    }

    private String normalize(String value, String fallback, int max) {
        String normalized = value == null || value.isBlank() ? fallback : value.trim();
        return normalized.substring(0, Math.min(max, normalized.length()));
    }

    private String blankToNull(String value, int max) {
        if (value == null || value.isBlank()) return null;
        String normalized = value.trim();
        return normalized.substring(0, Math.min(max, normalized.length()));
    }

    private String instant(Timestamp value) {
        return value == null ? Instant.now().toString() : value.toInstant().toString();
    }
}
