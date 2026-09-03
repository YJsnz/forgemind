package com.forgemind.repository;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.stereotype.Repository;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Repository
public class ForgeLabDbStore {
    private static final long MAX_ATTACHMENT_BYTES = 80L * 1024L * 1024L;
    private static final int MAX_TITLE = 240;
    private static final int MAX_SECTION = 24;
    private static final List<String> SECTIONS = List.of("archive", "models", "layout", "design", "notice");

    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;

    public ForgeLabDbStore(JdbcTemplate jdbc, ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.mapper = mapper;
    }

    public List<Map<String, Object>> listPosts(String userId) {
        List<Map<String, Object>> posts = jdbc.query("""
                SELECT p.*,
                    (SELECT COUNT(*) FROM forgelab_reply r WHERE r.post_id = p.id) AS reply_count,
                    p.imported_likes + (SELECT COUNT(*) FROM forgelab_post_like l WHERE l.post_id = p.id) AS like_count,
                    EXISTS(SELECT 1 FROM forgelab_post_like me WHERE me.post_id = p.id AND me.user_id = ?) AS liked
                FROM forgelab_post p
                WHERE p.status = 'published'
                ORDER BY p.created_at DESC, p.id
                """, (rs, rowNum) -> postRow(rs, userId, false), userId);
        posts.forEach(post -> post.put("attachments", attachments((String) post.get("id"))));
        return posts;
    }

    public Map<String, Object> getPost(String userId, String postId) {
        Map<String, Object> post;
        try {
            post = jdbc.queryForObject("""
                    SELECT p.*,
                        (SELECT COUNT(*) FROM forgelab_reply r WHERE r.post_id = p.id) AS reply_count,
                        p.imported_likes + (SELECT COUNT(*) FROM forgelab_post_like l WHERE l.post_id = p.id) AS like_count,
                        EXISTS(SELECT 1 FROM forgelab_post_like me WHERE me.post_id = p.id AND me.user_id = ?) AS liked
                    FROM forgelab_post p
                    WHERE p.id = ? AND p.status = 'published'
                    """, (rs, rowNum) -> postRow(rs, userId, true), userId, postId);
        } catch (EmptyResultDataAccessException e) {
            throw new IllegalArgumentException("帖子不存在");
        }
        post.put("attachments", attachments(postId));
        post.put("repliesList", replies(postId, userId));
        return post;
    }

    public Map<String, Object> createPost(String userId, String metadataJson, MultipartFile image, MultipartFile archive) {
        JsonNode metadata = parseMetadata(metadataJson);
        String title = required(metadata, "title", MAX_TITLE);
        String summary = required(metadata, "summary", 2000);
        String section = required(metadata, "section", MAX_SECTION);
        if (!SECTIONS.contains(section)) throw new IllegalArgumentException("ForgeLab 板块不合法");
        String content = text(metadata, "content", 100_000);
        String id = "post-" + UUID.randomUUID();
        String tag = text(metadata, "tag", 64);
        if (tag.isBlank()) tag = section.toUpperCase();

        Map<String, Object> author = jdbc.queryForMap("SELECT username FROM app_user WHERE id = ?", userId);
        String username = String.valueOf(author.get("username"));
        jdbc.update("""
                INSERT INTO forgelab_post
                    (id, author_user_id, author_name, author_role, section, tag, title, summary, content, icon_key)
                VALUES (?, ?, ?, 'COMMUNITY MAKER', ?, ?, ?, ?, ?, ?)
                """, id, userId, username, section, tag, title, summary, content, iconFor(section));
        saveAttachment(id, image, "image");
        saveAttachment(id, archive, "archive");
        return getPost(userId, id);
    }

    public Map<String, Object> togglePostLike(String userId, String postId) {
        assertPost(postId);
        Integer count = jdbc.queryForObject("SELECT COUNT(*) FROM forgelab_post_like WHERE post_id = ? AND user_id = ?", Integer.class, postId, userId);
        boolean liked = count != null && count > 0;
        if (liked) {
            jdbc.update("DELETE FROM forgelab_post_like WHERE post_id = ? AND user_id = ?", postId, userId);
        } else {
            jdbc.update("INSERT INTO forgelab_post_like (post_id, user_id) VALUES (?, ?)", postId, userId);
            notifyPostAuthor(userId, postId, "like", "帖子收到新的喜欢", "有人喜欢了你的 ForgeLab 分享。");
        }
        return Map.of("liked", !liked, "likes", likeCount("forgelab_post_like", "post_id", postId));
    }

    public Map<String, Object> createReply(String userId, String postId, String content) {
        assertPost(postId);
        String value = content == null ? "" : content.trim();
        if (value.isBlank() || value.length() > 10_000) throw new IllegalArgumentException("回复内容不能为空且不超过 10000 字");
        Map<String, Object> author = jdbc.queryForMap("SELECT username FROM app_user WHERE id = ?", userId);
        String id = "reply-" + UUID.randomUUID();
        jdbc.update("""
                INSERT INTO forgelab_reply (id, post_id, author_user_id, author_name, author_role, content)
                VALUES (?, ?, ?, ?, 'COMMUNITY MAKER', ?)
                """, id, postId, userId, author.get("username"), value);
        notifyPostAuthor(userId, postId, "reply", "帖子有新的回复", "有人回复了你的 ForgeLab 分享。");
        return replyById(id, userId);
    }

    public Map<String, Object> toggleReplyLike(String userId, String replyId) {
        try {
            jdbc.queryForObject("SELECT id FROM forgelab_reply WHERE id = ?", String.class, replyId);
        } catch (EmptyResultDataAccessException e) {
            throw new IllegalArgumentException("回复不存在");
        }
        Integer count = jdbc.queryForObject("SELECT COUNT(*) FROM forgelab_reply_like WHERE reply_id = ? AND user_id = ?", Integer.class, replyId, userId);
        boolean liked = count != null && count > 0;
        if (liked) jdbc.update("DELETE FROM forgelab_reply_like WHERE reply_id = ? AND user_id = ?", replyId, userId);
        else {
            jdbc.update("INSERT INTO forgelab_reply_like (reply_id, user_id) VALUES (?, ?)", replyId, userId);
            notifyReplyAuthor(userId, replyId);
        }
        return Map.of("liked", !liked, "likes", likeCount("forgelab_reply_like", "reply_id", replyId));
    }

    public List<Map<String, Object>> notifications(String userId) {
        ensureWelcomeNotifications(userId);
        return jdbc.query("""
                SELECT id, kind, title, body, read_at, created_at
                FROM forgelab_notification
                WHERE recipient_user_id = ?
                ORDER BY created_at DESC, id DESC
                LIMIT 100
                """, (rs, rowNum) -> {
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("id", rs.getString("id"));
            result.put("kind", rs.getString("kind"));
            result.put("title", rs.getString("title"));
            result.put("body", rs.getString("body"));
            result.put("meta", relativeTime(rs.getTimestamp("created_at")));
            result.put("read", rs.getTimestamp("read_at") != null);
            return result;
        }, userId);
    }

    public void markNotificationRead(String userId, String notificationId) {
        jdbc.update("UPDATE forgelab_notification SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP(6)) WHERE id = ? AND recipient_user_id = ?", notificationId, userId);
    }

    public void markAllNotificationsRead(String userId) {
        jdbc.update("UPDATE forgelab_notification SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP(6)) WHERE recipient_user_id = ?", userId);
    }

    public AttachmentPayload attachment(String userId, String attachmentId) {
        try {
            return jdbc.queryForObject("""
                    SELECT a.file_name, a.content_type, a.file_blob, a.external_url
                    FROM forgelab_attachment a
                    JOIN forgelab_post p ON p.id = a.post_id
                    WHERE a.id = ? AND p.status = 'published'
                    """, (rs, rowNum) -> new AttachmentPayload(rs.getString("file_name"), rs.getString("content_type"), rs.getBytes("file_blob"), rs.getString("external_url")), attachmentId);
        } catch (EmptyResultDataAccessException e) {
            throw new IllegalArgumentException("附件不存在");
        }
    }

    private Map<String, Object> postRow(ResultSet rs, String userId, boolean detail) throws SQLException {
        Map<String, Object> post = new LinkedHashMap<>();
        post.put("id", rs.getString("id"));
        post.put("section", rs.getString("section"));
        post.put("title", rs.getString("title"));
        post.put("summary", rs.getString("summary"));
        post.put("content", rs.getString("content"));
        post.put("author", rs.getString("author_name"));
        post.put("role", rs.getString("author_role"));
        post.put("meta", rs.getString("tag") + " · " + relativeTime(rs.getTimestamp("created_at")));
        post.put("replies", rs.getInt("reply_count"));
        post.put("likes", rs.getInt("like_count"));
        post.put("liked", rs.getBoolean("liked"));
        post.put("tag", rs.getString("tag"));
        post.put("iconKey", rs.getString("icon_key"));
        return post;
    }

    private List<Map<String, Object>> replies(String postId, String userId) {
        return jdbc.query("""
                SELECT r.id, r.author_name, r.author_role, r.content, r.created_at,
                    r.imported_likes + (SELECT COUNT(*) FROM forgelab_reply_like l WHERE l.reply_id = r.id) AS like_count,
                    EXISTS(SELECT 1 FROM forgelab_reply_like me WHERE me.reply_id = r.id AND me.user_id = ?) AS liked
                FROM forgelab_reply r WHERE r.post_id = ? ORDER BY r.created_at, r.id
                """, (rs, rowNum) -> replyRow(rs), userId, postId);
    }

    private Map<String, Object> replyById(String replyId, String userId) {
        return jdbc.queryForObject("""
                SELECT r.id, r.author_name, r.author_role, r.content, r.created_at,
                    r.imported_likes + (SELECT COUNT(*) FROM forgelab_reply_like l WHERE l.reply_id = r.id) AS like_count,
                    EXISTS(SELECT 1 FROM forgelab_reply_like me WHERE me.reply_id = r.id AND me.user_id = ?) AS liked
                FROM forgelab_reply r WHERE r.id = ?
                """, (rs, rowNum) -> replyRow(rs), userId, replyId);
    }

    private Map<String, Object> replyRow(ResultSet rs) throws SQLException {
        Map<String, Object> reply = new LinkedHashMap<>();
        reply.put("id", rs.getString("id"));
        reply.put("author", rs.getString("author_name"));
        reply.put("role", rs.getString("author_role"));
        reply.put("content", rs.getString("content"));
        reply.put("meta", relativeTime(rs.getTimestamp("created_at")));
        reply.put("likes", rs.getInt("like_count"));
        reply.put("liked", rs.getBoolean("liked"));
        return reply;
    }

    private List<Map<String, Object>> attachments(String postId) {
        return jdbc.query("SELECT id, file_name, kind, size_bytes, external_url FROM forgelab_attachment WHERE post_id = ? ORDER BY created_at, id", (rs, rowNum) -> {
            Map<String, Object> attachment = new LinkedHashMap<>();
            attachment.put("id", rs.getString("id"));
            attachment.put("name", rs.getString("file_name"));
            attachment.put("kind", rs.getString("kind"));
            attachment.put("sizeBytes", rs.getLong("size_bytes"));
            attachment.put("downloadUrl", rs.getString("external_url") == null ? "/api/forgelab/attachments/" + rs.getString("id") + "/download" : rs.getString("external_url"));
            return attachment;
        }, postId);
    }

    private void saveAttachment(String postId, MultipartFile file, String kind) {
        if (file == null || file.isEmpty()) return;
        if (file.getSize() > MAX_ATTACHMENT_BYTES) throw new IllegalArgumentException("附件超过 80 MB");
        String name = safeFileName(file.getOriginalFilename(), kind + "-attachment");
        try {
            jdbc.update("""
                    INSERT INTO forgelab_attachment (id, post_id, file_name, kind, content_type, size_bytes, file_blob)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """, "attachment-" + UUID.randomUUID(), postId, name, kind,
                    file.getContentType() == null ? "application/octet-stream" : file.getContentType(), file.getSize(), file.getBytes());
        } catch (IOException e) {
            throw new IllegalArgumentException("附件读取失败", e);
        }
    }

    private void ensureWelcomeNotifications(String userId) {
        Integer count = jdbc.queryForObject("SELECT COUNT(*) FROM forgelab_notification WHERE recipient_user_id = ? AND kind = 'notice'", Integer.class, userId);
        if (count != null && count > 0) return;
        jdbc.update("INSERT INTO forgelab_notification (id, recipient_user_id, kind, title, body) VALUES (?, ?, 'notice', ?, ?)", "notice-" + UUID.randomUUID(), userId, "欢迎来到 ForgeLab", "先阅读约束、来源和验证结果，再下载资源或参与讨论。");
        jdbc.update("INSERT INTO forgelab_notification (id, recipient_user_id, kind, title, body) VALUES (?, ?, 'notice', ?, ?)", "notice-" + UUID.randomUUID(), userId, "资源许可规范已更新", "模型、公模和私有资产请分别注明来源、许可和修改声明。");
    }

    private void notifyPostAuthor(String actorId, String postId, String kind, String title, String body) {
        jdbc.query("SELECT author_user_id FROM forgelab_post WHERE id = ? AND author_user_id IS NOT NULL AND author_user_id <> ?", (RowCallbackHandler) rs -> {
            jdbc.update("INSERT INTO forgelab_notification (id, recipient_user_id, actor_user_id, kind, title, body, post_id) VALUES (?, ?, ?, ?, ?, ?, ?)", "notice-" + UUID.randomUUID(), rs.getString(1), actorId, kind, title, body, postId);
        }, postId, actorId);
    }

    private void notifyReplyAuthor(String actorId, String replyId) {
        jdbc.query("""
                SELECT r.author_user_id, r.post_id FROM forgelab_reply r
                WHERE r.id = ? AND r.author_user_id IS NOT NULL AND r.author_user_id <> ?
                """, (RowCallbackHandler) rs -> jdbc.update("INSERT INTO forgelab_notification (id, recipient_user_id, actor_user_id, kind, title, body, post_id, reply_id) VALUES (?, ?, ?, 'like', ?, ?, ?, ?)", "notice-" + UUID.randomUUID(), rs.getString("author_user_id"), actorId, "回复收到新的喜欢", "有人喜欢了你的回复。", rs.getString("post_id"), replyId), replyId, actorId);
    }

    private void assertPost(String postId) {
        Integer count = jdbc.queryForObject("SELECT COUNT(*) FROM forgelab_post WHERE id = ? AND status = 'published'", Integer.class, postId);
        if (count == null || count == 0) throw new IllegalArgumentException("帖子不存在");
    }

    private int likeCount(String table, String field, String id) {
        String baseTable = table.equals("forgelab_post_like") ? "forgelab_post" : "forgelab_reply";
        String baseField = table.equals("forgelab_post_like") ? "id" : "id";
        Integer count = jdbc.queryForObject("SELECT COALESCE((SELECT imported_likes FROM " + baseTable + " WHERE " + baseField + " = ?), 0) + (SELECT COUNT(*) FROM " + table + " WHERE " + field + " = ?)", Integer.class, id, id);
        return count == null ? 0 : count;
    }

    private JsonNode parseMetadata(String value) {
        try {
            JsonNode node = mapper.readTree(value == null ? "" : value);
            if (node == null || !node.isObject()) throw new IllegalArgumentException("帖子元数据格式非法");
            return node;
        } catch (IOException e) {
            throw new IllegalArgumentException("帖子元数据不是有效 JSON", e);
        }
    }

    private String required(JsonNode node, String field, int max) {
        String value = text(node, field, max);
        if (value.isBlank()) throw new IllegalArgumentException(field + "不能为空");
        return value;
    }

    private String text(JsonNode node, String field, int max) {
        String value = node.path(field).asText("").trim();
        if (value.length() > max) throw new IllegalArgumentException(field + "过长");
        return value;
    }

    private String safeFileName(String value, String fallback) {
        if (value == null || value.isBlank()) return fallback;
        String normalized = value.replace('\\', '/');
        String name = normalized.substring(normalized.lastIndexOf('/') + 1).trim();
        return name.isBlank() ? fallback : name.substring(0, Math.min(255, name.length()));
    }

    private String iconFor(String section) {
        return switch (section) {
            case "models" -> "box";
            case "layout" -> "layout";
            case "design" -> "compass";
            case "notice" -> "megaphone";
            default -> "archive";
        };
    }

    private String relativeTime(Timestamp timestamp) {
        if (timestamp == null) return "刚刚";
        long minutes = Math.max(0, (Instant.now().toEpochMilli() - timestamp.getTime()) / 60_000);
        if (minutes < 1) return "刚刚";
        if (minutes < 60) return minutes + " 分钟前";
        long hours = minutes / 60;
        if (hours < 24) return hours + " 小时前";
        long days = hours / 24;
        return days < 30 ? days + " 天前" : timestamp.toLocalDateTime().toLocalDate().toString();
    }

    public record AttachmentPayload(String fileName, String contentType, byte[] bytes, String externalUrl) {}
}
