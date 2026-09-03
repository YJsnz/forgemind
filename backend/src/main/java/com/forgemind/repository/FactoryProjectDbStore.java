package com.forgemind.repository;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.forgemind.model.FactoryProject;
import com.forgemind.model.FactoryProjectSummary;
import com.forgemind.model.FactorySave;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;
import com.forgemind.service.CloudProjectionService;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

@Repository
public class FactoryProjectDbStore {
    public static final String AUTOSAVE_PROJECT_ID = "autosave";
    private static final int MAX_SAVE_VERSION = 6;
    private static final int MAX_FACTORY_FLOORS = 12;
    private static final Set<String> OBJECT_TYPES = Set.of(
            "source", "inboundWarehouse", "outboundWarehouse", "conveyor", "inclineUp", "inclineDown",
            "machine", "oreMiner", "smelter", "press", "assembler", "inspection", "washing", "agv",
            "drone", "storage", "splitter", "merger", "imported");
    private static final Set<String> ITEM_CATEGORIES = Set.of("raw", "intermediate", "product");
    private static final Set<String> MACHINE_MODEL_TYPES = Set.of(
            "machine", "smelter", "press", "washing", "apiTank", "visionInspection", "workstation", "imported");
    private final JdbcTemplate jdbc;
    private final ObjectMapper objectMapper;
    private final FactoryDbStore legacyStore;
    private final CloudProjectionService cloudProjection;

    public FactoryProjectDbStore(JdbcTemplate jdbc, ObjectMapper objectMapper, FactoryDbStore legacyStore, CloudProjectionService cloudProjection) {
        this.jdbc = jdbc;
        this.objectMapper = objectMapper;
        this.legacyStore = legacyStore;
        this.cloudProjection = cloudProjection;
    }

    public List<FactoryProjectSummary> listForUser(String userId) {
        List<FactoryProjectSummary> projects = new ArrayList<>();
        projects.addAll(jdbc.query("""
                SELECT name, schema_version, created_at, updated_at, save_json
                FROM factory_autosave
                WHERE owner_user_id = ?
                """, (rs, rowNum) -> autosaveSummaryFromRow(rs), userId));
        projects.addAll(jdbc.query("""
                SELECT f.id, f.name, f.schema_version, f.created_at, f.updated_at, f.save_json,
                       (SELECT COUNT(*) FROM factory_object o WHERE o.factory_id = f.id) AS legacy_object_count,
                       (SELECT COUNT(*) FROM item i WHERE i.factory_id = f.id) AS legacy_item_count,
                       (SELECT COUNT(*) FROM recipe r WHERE r.factory_id = f.id) AS legacy_recipe_count,
                       (SELECT COUNT(*) FROM floor fl WHERE fl.factory_id = f.id) AS legacy_floor_count
                FROM factory f
                WHERE f.owner_user_id = ?
                ORDER BY f.updated_at DESC, f.created_at DESC
                """, (rs, rowNum) -> summaryFromRow(rs), userId));
        return projects;
    }

    public FactoryProject loadForUser(String userId, String projectId) {
        if (AUTOSAVE_PROJECT_ID.equals(projectId)) return loadAutosaveForUser(userId);
        List<FactoryProject> matches = jdbc.query("""
                SELECT f.id, f.name, f.schema_version, f.created_at, f.updated_at, f.save_json,
                       (SELECT COUNT(*) FROM factory_object o WHERE o.factory_id = f.id) AS legacy_object_count,
                       (SELECT COUNT(*) FROM item i WHERE i.factory_id = f.id) AS legacy_item_count,
                       (SELECT COUNT(*) FROM recipe r WHERE r.factory_id = f.id) AS legacy_recipe_count,
                       (SELECT COUNT(*) FROM floor fl WHERE fl.factory_id = f.id) AS legacy_floor_count
                FROM factory f
                WHERE f.id = ? AND f.owner_user_id = ?
                """, (rs, rowNum) -> {
            FactoryProjectSummary summary = summaryFromRow(rs);
            String rawSave = rs.getString("save_json");
            JsonNode save = rawSave == null
                    ? legacySave(projectId, summary.name())
                    : parseJson(rawSave);
            return new FactoryProject(summary, save);
        }, projectId, userId);
        if (matches.isEmpty()) throw new IllegalArgumentException("工厂存档不存在或不属于当前用户");
        return matches.get(0);
    }

    /** Load a formal project while holding its row lock for an Agent apply transaction. */
    @Transactional
    public FactoryProject loadForUserForUpdate(String userId, String projectId) {
        if (AUTOSAVE_PROJECT_ID.equals(projectId)) return loadAutosaveForUserForUpdate(userId);
        List<FactoryProject> matches = jdbc.query("""
                SELECT f.id, f.name, f.schema_version, f.created_at, f.updated_at, f.save_json,
                       (SELECT COUNT(*) FROM factory_object o WHERE o.factory_id = f.id) AS legacy_object_count,
                       (SELECT COUNT(*) FROM item i WHERE i.factory_id = f.id) AS legacy_item_count,
                       (SELECT COUNT(*) FROM recipe r WHERE r.factory_id = f.id) AS legacy_recipe_count,
                       (SELECT COUNT(*) FROM floor fl WHERE fl.factory_id = f.id) AS legacy_floor_count
                FROM factory f
                WHERE f.id = ? AND f.owner_user_id = ?
                FOR UPDATE
                """, (rs, rowNum) -> {
            FactoryProjectSummary summary = summaryFromRow(rs);
            String rawSave = rs.getString("save_json");
            JsonNode save = rawSave == null ? legacySave(projectId, summary.name()) : parseJson(rawSave);
            return new FactoryProject(summary, save);
        }, projectId, userId);
        if (matches.isEmpty()) throw new IllegalArgumentException("工厂存档不存在或不属于当前用户");
        return matches.get(0);
    }

    @Transactional
    public FactoryProject createForUser(String userId, String name, JsonNode save) {
        JsonNode validated = validateSave(userId, save);
        String normalizedName = normalizeName(name, validated.path("name").asText("未命名工厂"));
        String projectId = UUID.randomUUID().toString();
        jdbc.update("INSERT INTO factory (id, owner_user_id, name, schema_version, width, depth, save_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
                projectId, userId, normalizedName, validated.path("version").asInt(), 48, 48, toJson(validated));
        jdbc.update("INSERT INTO factory_member (factory_id, user_id, role) VALUES (?, ?, 'owner')", projectId, userId);
        cloudProjection.syncFactoryProject(userId, projectId);
        return loadForUser(userId, projectId);
    }

    @Transactional
    public FactoryProject updateForUser(String userId, String projectId, String name, JsonNode save) {
        if (AUTOSAVE_PROJECT_ID.equals(projectId)) return updateAutosaveForUser(userId, name, save);
        JsonNode validated = validateSave(userId, save);
        String normalizedName = normalizeName(name, validated.path("name").asText("未命名工厂"));
        int changed = jdbc.update("""
                UPDATE factory
                SET name = ?, schema_version = ?, save_json = ?, updated_at = CURRENT_TIMESTAMP(6)
                WHERE id = ? AND owner_user_id = ?
                """, normalizedName, validated.path("version").asInt(), toJson(validated), projectId, userId);
        if (changed == 0) throw new IllegalArgumentException("工厂存档不存在或不属于当前用户");
        cloudProjection.syncFactoryProject(userId, projectId);
        return loadForUser(userId, projectId);
    }

    @Transactional
    public FactoryProject updateAutosaveForUser(String userId, String name, JsonNode save) {
        JsonNode validated = validateSave(userId, save);
        String normalizedName = normalizeName(name, validated.path("name").asText("未命名工厂"));
        jdbc.update("""
                INSERT INTO factory_autosave (owner_user_id, name, schema_version, save_json)
                VALUES (?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                    name = VALUES(name),
                    schema_version = VALUES(schema_version),
                    save_json = VALUES(save_json),
                    updated_at = CURRENT_TIMESTAMP(6)
                """, userId, normalizedName, validated.path("version").asInt(), toJson(validated));
        return loadAutosaveForUser(userId);
    }

    @Transactional
    public void deleteForUser(String userId, String projectId) {
        int changed = AUTOSAVE_PROJECT_ID.equals(projectId)
                ? jdbc.update("DELETE FROM factory_autosave WHERE owner_user_id = ?", userId)
                : jdbc.update("DELETE FROM factory WHERE id = ? AND owner_user_id = ?", projectId, userId);
        if (changed == 0) throw new IllegalArgumentException("工厂存档不存在或不属于当前用户");
    }

    private FactoryProject loadAutosaveForUser(String userId) {
        List<FactoryProject> matches = jdbc.query("""
                SELECT name, schema_version, created_at, updated_at, save_json
                FROM factory_autosave
                WHERE owner_user_id = ?
                """, (rs, rowNum) -> new FactoryProject(autosaveSummaryFromRow(rs), parseJson(rs.getString("save_json"))), userId);
        if (matches.isEmpty()) throw new IllegalArgumentException("自动恢复存档不存在");
        return matches.get(0);
    }

    private FactoryProject loadAutosaveForUserForUpdate(String userId) {
        List<FactoryProject> matches = jdbc.query("""
                SELECT name, schema_version, created_at, updated_at, save_json
                FROM factory_autosave
                WHERE owner_user_id = ?
                FOR UPDATE
                """, (rs, rowNum) -> new FactoryProject(autosaveSummaryFromRow(rs), parseJson(rs.getString("save_json"))), userId);
        if (matches.isEmpty()) throw new IllegalArgumentException("自动恢复存档不存在");
        return matches.get(0);
    }

    private FactoryProjectSummary summaryFromRow(ResultSet rs) throws SQLException {
        String rawSave = rs.getString("save_json");
        JsonNode save = rawSave == null ? null : parseJson(rawSave);
        int version = save == null ? rs.getInt("schema_version") : save.path("version").asInt(rs.getInt("schema_version"));
        int floorCount = save == null ? rs.getInt("legacy_floor_count") : save.path("floorCount").asInt(1);
        int objectCount = save == null ? rs.getInt("legacy_object_count") : arraySize(save, "objects");
        int itemCount = save == null ? rs.getInt("legacy_item_count") : arraySize(save, "items");
        int recipeCount = save == null ? rs.getInt("legacy_recipe_count") : arraySize(save, "recipes");
        return new FactoryProjectSummary(
                rs.getString("id"),
                rs.getString("name"),
                instant(rs.getTimestamp("created_at")),
                instant(rs.getTimestamp("updated_at")),
                version,
                Math.max(1, floorCount),
                objectCount,
                itemCount,
                recipeCount,
                false
        );
    }

    private FactoryProjectSummary autosaveSummaryFromRow(ResultSet rs) throws SQLException {
        JsonNode save = parseJson(rs.getString("save_json"));
        return new FactoryProjectSummary(
                AUTOSAVE_PROJECT_ID,
                rs.getString("name"),
                instant(rs.getTimestamp("created_at")),
                instant(rs.getTimestamp("updated_at")),
                save.path("version").asInt(rs.getInt("schema_version")),
                Math.max(1, save.path("floorCount").asInt(1)),
                arraySize(save, "objects"),
                arraySize(save, "items"),
                arraySize(save, "recipes"),
                true
        );
    }

    private JsonNode legacySave(String projectId, String projectName) {
        FactorySave legacy = legacyStore.loadByFactoryId(projectId);
        JsonNode node = objectMapper.valueToTree(legacy);
        if (node.isObject()) ((com.fasterxml.jackson.databind.node.ObjectNode) node).put("name", projectName);
        return node;
    }

    private JsonNode validateSave(String userId, JsonNode save) {
        if (save == null || !save.isObject()) throw new IllegalArgumentException("存档不能为空");
        int version = save.path("version").asInt(-1);
        if (version < 1 || version > MAX_SAVE_VERSION) throw new IllegalArgumentException("不支持的存档版本");
        requireArray(save, "objects");
        requireArray(save, "items");
        requireArray(save, "recipes");
        int floorCount = save.has("floorCount") ? integerBetween(save.path("floorCount"), 1, MAX_FACTORY_FLOORS, "楼层数量") : version <= 3 ? 3 : 1;
        if (version >= 5) {
            requireArray(save, "floorNames");
            requireArray(save, "machineDefinitions");
        }

        Set<String> itemIds = new HashSet<>();
        for (JsonNode item : save.path("items")) {
            requireObject(item, "物品");
            String id = requiredText(item, "id", "物品");
            if (!itemIds.add(id)) throw new IllegalArgumentException("物品 id 重复：" + id);
            requiredText(item, "name", "物品");
            if (!ITEM_CATEGORIES.contains(requiredText(item, "category", "物品"))) throw new IllegalArgumentException("物品类别非法");
            if (item.has("size") && (!isFiniteNumber(item.get("size")) || item.get("size").asDouble() <= 0)) throw new IllegalArgumentException("物品尺寸非法");
        }

        Set<String> recipeIds = new HashSet<>();
        for (JsonNode recipe : save.path("recipes")) {
            requireObject(recipe, "配方");
            String id = requiredText(recipe, "id", "配方");
            if (!recipeIds.add(id)) throw new IllegalArgumentException("配方 id 重复：" + id);
            requiredText(recipe, "name", "配方");
            if (recipe.has("durationSec") && (!isFiniteNumber(recipe.get("durationSec")) || recipe.get("durationSec").asDouble() <= 0)) throw new IllegalArgumentException("配方时长非法");
            validatePorts(recipe.get("inputs"), itemIds, "配方输入");
            validatePorts(recipe.get("outputs"), itemIds, "配方输出");
        }

        Set<String> machineDefinitionIds = new HashSet<>();
        if (save.path("machineDefinitions").isArray()) for (JsonNode definition : save.path("machineDefinitions")) {
            requireObject(definition, "机器定义");
            String id = requiredText(definition, "id", "机器定义");
            if (!machineDefinitionIds.add(id)) throw new IllegalArgumentException("机器 id 重复：" + id);
            requiredText(definition, "name", "机器定义");
            String modelType = requiredText(definition, "modelType", "机器定义");
            if (!MACHINE_MODEL_TYPES.contains(modelType)) throw new IllegalArgumentException("机器模型来源非法");
            JsonNode footprint = definition.path("footprint");
            requireObject(footprint, "机器占地");
            int depth = integerBetween(footprint.path("d"), 1, 12, "机器占地深度");
            integerBetween(footprint.path("w"), 1, 12, "机器占地宽度");
            int inputs = integerBetween(definition.path("inputPortCount"), 1, depth, "机器输入端数量");
            integerBetween(definition.path("outputPortCount"), 1, depth, "机器输出端数量");
            if (inputs <= 0) throw new IllegalArgumentException("机器输入端数量非法");
            JsonNode definitionRecipes = definition.path("recipeIds");
            if (!definitionRecipes.isArray()) throw new IllegalArgumentException("机器工艺列表不是数组");
            for (JsonNode recipeId : definitionRecipes) if (!recipeId.isTextual() || !recipeIds.contains(recipeId.asText())) throw new IllegalArgumentException("机器引用了不存在的配方");
            if ("imported".equals(modelType)) {
                String importedResourceId = requiredText(definition, "importedResourceId", "机器导入资源");
                if (!resourceBelongsToUser(userId, importedResourceId)) throw new IllegalArgumentException("机器导入资源不存在或不属于当前用户");
            }
        }

        Set<String> objectIds = new HashSet<>();
        for (JsonNode object : save.path("objects")) {
            requireObject(object, "对象");
            String id = requiredText(object, "id", "对象");
            if (!objectIds.add(id)) throw new IllegalArgumentException("对象 id 重复：" + id);
            if (!OBJECT_TYPES.contains(requiredText(object, "type", "对象"))) throw new IllegalArgumentException("对象类型非法：" + id);
            String type = object.path("type").asText();
            JsonNode pos = object.path("pos");
            requireObject(pos, "对象位置");
            if (!isFiniteNumber(pos.get("x")) || !isFiniteNumber(pos.get("z"))) throw new IllegalArgumentException("对象位置非法：" + id);
            int rotation = integerBetween(object.path("rotation"), 0, 270, "对象旋转");
            if (!Set.of(0, 90, 180, 270).contains(rotation)) throw new IllegalArgumentException("对象旋转非法：" + id);
            if (object.has("floorId")) integerBetween(object.path("floorId"), 1, floorCount, "对象楼层");
            if (object.has("recipeId") && !object.path("recipeId").isNull() && (!object.path("recipeId").isTextual() || !recipeIds.contains(object.path("recipeId").asText()))) throw new IllegalArgumentException("对象引用了不存在的配方：" + id);
            if (object.has("itemId") && !object.path("itemId").isNull() && (!object.path("itemId").isTextual() || !itemIds.contains(object.path("itemId").asText()))) throw new IllegalArgumentException("对象引用了不存在的物品：" + id);
            String resourceId = object.path("resourceId").asText("").trim();
            if ("imported".equals(type)) {
                if (resourceId.isBlank() || !resourceBelongsToUser(userId, resourceId)) throw new IllegalArgumentException("导入设备资源不存在或不属于当前用户");
            } else if ("machine".equals(type) && !resourceId.isBlank() && !machineDefinitionIds.contains(resourceId)) {
                throw new IllegalArgumentException("机器实例引用了不存在的机器定义：" + id);
            }
        }
        return save.deepCopy();
    }

    private void requireArray(JsonNode save, String field) {
        if (!save.path(field).isArray()) throw new IllegalArgumentException(field + " 不是数组");
    }

    private void requireObject(JsonNode value, String label) {
        if (value == null || !value.isObject()) throw new IllegalArgumentException(label + "数据非法");
    }

    private String requiredText(JsonNode value, String field, String label) {
        String text = value.path(field).asText("").trim();
        if (text.isBlank()) throw new IllegalArgumentException(label + "缺少 " + field);
        return text;
    }

    private int integerBetween(JsonNode value, int min, int max, String label) {
        if (value == null || !value.isIntegralNumber() || value.asInt() < min || value.asInt() > max) throw new IllegalArgumentException(label + "非法");
        return value.asInt();
    }

    private boolean isFiniteNumber(JsonNode value) {
        return value != null && value.isNumber() && Double.isFinite(value.asDouble());
    }

    private void validatePorts(JsonNode ports, Set<String> itemIds, String label) {
        if (ports == null || !ports.isArray()) throw new IllegalArgumentException(label + "不是数组");
        for (JsonNode port : ports) {
            requireObject(port, label);
            if (!itemIds.contains(requiredText(port, "itemId", label)) || !isFiniteNumber(port.get("qty")) || port.get("qty").asDouble() <= 0) throw new IllegalArgumentException(label + "参数非法");
        }
    }

    private boolean resourceBelongsToUser(String userId, String resourceId) {
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM imported_resource WHERE owner_user_id = ? AND resource_id = ?",
                Integer.class, userId, resourceId);
        return count != null && count > 0;
    }

    private int arraySize(JsonNode save, String field) {
        JsonNode node = save.path(field);
        return node.isArray() ? node.size() : 0;
    }

    private String normalizeName(String name, String fallback) {
        String value = name == null || name.isBlank() ? fallback : name;
        value = value == null ? "未命名工厂" : value.trim();
        if (value.isBlank()) value = "未命名工厂";
        return value.substring(0, Math.min(120, value.length()));
    }

    private JsonNode parseJson(String raw) {
        try {
            return objectMapper.readTree(raw);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("数据库中的工厂存档 JSON 已损坏", e);
        }
    }

    private String toJson(JsonNode save) {
        try {
            return objectMapper.writeValueAsString(save);
        } catch (JsonProcessingException e) {
            throw new IllegalArgumentException("存档无法序列化", e);
        }
    }

    private String instant(Timestamp timestamp) {
        return timestamp == null ? Instant.now().toString() : timestamp.toInstant().toString();
    }
}
