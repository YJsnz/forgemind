package com.forgemind.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Server-side safety gate for Agent changes. The browser may propose a patch,
 * but it cannot decide whether that patch is valid or safe to persist.
 */
@Component
public class AgentPatchValidator {
    private static final int MAX_VERSION = 6;
    private static final int BUILD_BOUND = 24;
    private static final int MAX_OPERATIONS = 64;
    private static final Set<String> TYPES = Set.of(
            "source", "inboundWarehouse", "outboundWarehouse", "conveyor", "inclineUp", "inclineDown",
            "machine", "oreMiner", "smelter", "press", "assembler", "inspection", "washing", "agv",
            "drone", "storage", "splitter", "merger", "imported");
    private static final Set<String> UPDATE_PATHS = Set.of(
            "recipeId", "itemId", "agvProgram", "stationProgram", "storageConfig", "rotation",
            "portConfig", "displayName");

    public List<String> validate(JsonNode save, JsonNode operations) {
        List<String> errors = new ArrayList<>();
        if (save == null || !save.isObject()) return List.of("存档不能为空");
        if (!save.path("objects").isArray() || !save.path("items").isArray() || !save.path("recipes").isArray()) {
            return List.of("存档缺少 objects/items/recipes 数组");
        }
        if (operations == null || !operations.isArray() || operations.isEmpty() || operations.size() > MAX_OPERATIONS) {
            errors.add("Patch 操作数量必须为 1–64");
            return errors;
        }
        ObjectNode working = (ObjectNode) save.deepCopy();
        ArrayNode objects = (ArrayNode) working.path("objects");
        Set<String> itemIds = ids(working.path("items"));
        Set<String> recipeIds = ids(working.path("recipes"));
        Set<String> operationIds = new HashSet<>();

        for (JsonNode operation : operations) {
            if (!operation.isObject()) {
                errors.add("Patch 操作必须是对象");
                continue;
            }
            String operationId = text(operation, "op_id");
            if (!operationId.isBlank() && !operationIds.add(operationId)) errors.add("Patch 操作 id 重复：" + operationId);
            String kind = text(operation, "kind");
            ObjectNode params = operation.path("params").isObject() ? (ObjectNode) operation.path("params") : null;
            String objectId = text(operation, "object_id");
            switch (kind) {
                case "update_config" -> update(working, objects, objectId, params, itemIds, recipeIds, errors);
                case "move_object" -> move(working, objects, objectId, params, errors);
                case "add_object" -> add(working, objects, params, itemIds, recipeIds, errors);
                case "remove_object" -> remove(objects, objectId, errors);
                case "adjust_inventory" -> inventory(objects, objectId, params, itemIds, errors);
                default -> errors.add("Patch 操作类型不允许：" + kind);
            }
            validateObjects(working, objects, itemIds, recipeIds, errors);
        }
        return dedupe(errors);
    }

    private void update(ObjectNode save, ArrayNode objects, String objectId, ObjectNode params,
                        Set<String> itemIds, Set<String> recipeIds, List<String> errors) {
        JsonNode object = find(objects, objectId);
        if (object == null) {
            errors.add("目标对象不存在：" + objectId);
            return;
        }
        if (params == null) {
            errors.add("update_config 缺少 params：" + objectId);
            return;
        }
        String path = text(params, "path");
        if (!UPDATE_PATHS.contains(path)) {
            errors.add("不允许修改对象字段：" + path);
            return;
        }
        JsonNode value = params.get("value");
        if ("recipeId".equals(path) && value != null && !value.isNull() && (!value.isTextual() || !recipeIds.contains(value.asText()))) errors.add("目标配方不可用：" + value);
        if ("itemId".equals(path) && value != null && !value.isNull() && (!value.isTextual() || !itemIds.contains(value.asText()))) errors.add("目标物品不可用：" + value);
        if ("rotation".equals(path) && (!isInteger(value) || !Set.of(0, 90, 180, 270).contains(value.asInt()))) errors.add("对象旋转非法：" + objectId);
        if ("displayName".equals(path) && value != null && !value.isNull() && (!value.isTextual() || value.asText().length() > 40)) errors.add("对象名称非法：" + objectId);
        if ("agvProgram".equals(path)) validateAgv(value, objects, itemIds, errors, objectId);
        if ("stationProgram".equals(path)) validateStation(value, itemIds, errors, objectId);
        if ("storageConfig".equals(path)) validateStorage(value, itemIds, errors, objectId);
        if ("portConfig".equals(path) && value != null && !value.isNull() && (!value.isObject() || !isPositiveInteger(value.get("inputCount")) || !isPositiveInteger(value.get("outputCount")))) errors.add("端口配置非法：" + objectId);
        if ("rotation".equals(path) && (value == null || !isInteger(value) || !Set.of(0, 90, 180, 270).contains(value.asInt()))) return;
        ObjectNode target = (ObjectNode) object;
        if (value == null || value.isNull()) target.remove(path);
        else target.set(path, value.deepCopy());
    }

    private void move(ObjectNode save, ArrayNode objects, String objectId, ObjectNode params, List<String> errors) {
        JsonNode object = find(objects, objectId);
        if (object == null) {
            errors.add("目标对象不存在：" + objectId);
            return;
        }
        if (params == null || !isGridNumber(params.get("x")) || !isGridNumber(params.get("z"))) {
            errors.add("移动坐标非法：" + objectId);
            return;
        }
        ObjectNode target = (ObjectNode) object;
        ObjectNode pos = target.with("pos");
        pos.put("x", params.path("x").asInt());
        pos.put("z", params.path("z").asInt());
        if (params.has("floor_id")) {
            if (!isPositiveInteger(params.get("floor_id")) || params.path("floor_id").asInt() > save.path("floorCount").asInt(1)) errors.add("移动楼层非法：" + objectId);
            else target.put("floorId", params.path("floor_id").asInt());
        }
    }

    private void add(ObjectNode save, ArrayNode objects, ObjectNode params, Set<String> itemIds, Set<String> recipeIds, List<String> errors) {
        JsonNode value = params == null ? null : params.path("object").isObject() ? params.path("object") : params;
        if (value == null || !value.isObject()) {
            errors.add("新增对象缺少 object");
            return;
        }
        String id = text(value, "id");
        if (find(objects, id) != null) errors.add("新增对象 id 重复：" + id);
        objects.add(value.deepCopy());
        validateObject(save, value, itemIds, recipeIds, errors);
    }

    private void remove(ArrayNode objects, String objectId, List<String> errors) {
        JsonNode object = find(objects, objectId);
        if (object == null) {
            errors.add("待删除对象不存在：" + objectId);
            return;
        }
        for (JsonNode candidate : objects) {
            if (!candidate.isObject() || candidate.path("id").asText().equals(objectId)) continue;
            JsonNode program = candidate.path("agvProgram");
            if (objectId.equals(program.path("sourceObjectId").asText()) || objectId.equals(program.path("destinationObjectId").asText())) errors.add("对象仍被运输任务引用，不能删除：" + objectId);
        }
        for (int index = objects.size() - 1; index >= 0; index--) if (objectId.equals(objects.get(index).path("id").asText())) objects.remove(index);
    }

    private void inventory(ArrayNode objects, String objectId, ObjectNode params, Set<String> itemIds, List<String> errors) {
        JsonNode object = find(objects, objectId);
        if (object == null) errors.add("目标对象不存在：" + objectId);
        if (params == null || !itemIds.contains(text(params, "item_id")) || !isFinite(params.get("quantity"))) errors.add("库存调整参数非法：" + objectId);
        else if (object == null || !Set.of("oreMiner", "storage").contains(object.path("type").asText())) errors.add("该对象不支持库存调整：" + objectId);
    }

    private void validateObjects(ObjectNode save, ArrayNode objects, Set<String> itemIds, Set<String> recipeIds, List<String> errors) {
        Set<String> cells = new HashSet<>();
        Set<String> ids = new HashSet<>();
        for (JsonNode object : objects) {
            validateObject(save, object, itemIds, recipeIds, errors);
            String id = text(object, "id");
            if (!ids.add(id)) errors.add("对象 id 重复：" + id);
            int floor = object.path("floorId").asInt(1);
            int[] footprint = footprint(save, object);
            int rotation = object.path("rotation").asInt();
            if (rotation == 90 || rotation == 270) { int swap = footprint[0]; footprint[0] = footprint[1]; footprint[1] = swap; }
            int x = object.path("pos").path("x").asInt(Integer.MIN_VALUE), z = object.path("pos").path("z").asInt(Integer.MIN_VALUE);
            for (int dx = 0; dx < footprint[0]; dx++) for (int dz = 0; dz < footprint[1]; dz++) {
                int cellX = x + dx, cellZ = z + dz;
                if (cellX < -BUILD_BOUND || cellZ < -BUILD_BOUND || cellX > BUILD_BOUND || cellZ > BUILD_BOUND) errors.add("对象越出建造边界：" + text(object, "id"));
                String key = floor + ":" + cellX + ":" + cellZ;
                if (!cells.add(key)) errors.add("对象发生占地碰撞：" + text(object, "id"));
            }
        }
    }

    private void validateObject(ObjectNode save, JsonNode object, Set<String> itemIds, Set<String> recipeIds, List<String> errors) {
        if (!object.isObject()) { errors.add("对象数据非法"); return; }
        String id = text(object, "id"), type = text(object, "type");
        if (id.isBlank()) errors.add("对象 id 不能为空");
        if (!TYPES.contains(type)) errors.add("对象类型非法：" + type);
        JsonNode pos = object.path("pos");
        if (!isGridNumber(pos.path("x")) || !isGridNumber(pos.path("z"))) errors.add("对象位置非法：" + id);
        if (!Set.of(0, 90, 180, 270).contains(object.path("rotation").asInt(Integer.MIN_VALUE))) errors.add("对象旋转非法：" + id);
        int floor = object.path("floorId").asInt(1);
        if (floor < 1 || floor > save.path("floorCount").asInt(1)) errors.add("对象楼层非法：" + id);
        if (object.has("itemId") && !object.path("itemId").isNull() && !itemIds.contains(object.path("itemId").asText())) errors.add("对象引用了不存在的物品：" + id);
        if (object.has("recipeId") && !object.path("recipeId").isNull() && !recipeIds.contains(object.path("recipeId").asText())) errors.add("对象引用了不存在的配方：" + id);
        if ("imported".equals(type) && text(object, "resourceId").isBlank()) errors.add("导入对象缺少资源 ID：" + id);
        if ("machine".equals(type) && !text(object, "resourceId").isBlank() && find(save.path("machineDefinitions"), text(object, "resourceId")) == null) errors.add("机器引用了不存在的机器定义：" + id);
        if (object.path("agvProgram").isObject()) validateAgv(object.path("agvProgram"), save.path("objects"), itemIds, errors, id);
    }

    private void validateAgv(JsonNode value, JsonNode objects, Set<String> itemIds, List<String> errors, String owner) {
        if (value == null || value.isNull()) return;
        boolean enabled = value.path("enabled").asBoolean(false);
        if (!value.isObject() || (enabled && (!itemIds.contains(text(value, "itemId")) || !isPositiveNumber(value.get("loadQuantity"))))) errors.add("AGV 程序非法：" + owner);
        for (String field : List.of("sourceObjectId", "destinationObjectId")) if (!value.path(field).isNull() && !value.path(field).asText().isBlank() && find(objects, value.path(field).asText()) == null) errors.add("运输任务引用不存在对象：" + owner);
    }

    private void validateStation(JsonNode value, Set<String> itemIds, List<String> errors, String owner) {
        if (value == null || value.isNull()) return;
        if (!value.isObject() || !Set.of("pickup", "store").contains(text(value, "mode")) || !isPositiveNumber(value.get("transferIntervalSec"))) errors.add("存取站程序非法：" + owner);
        if (value.path("rackAssignments").isObject()) value.path("rackAssignments").fields().forEachRemaining(entry -> { if (!itemIds.contains(entry.getKey()) || !Set.of("back", "left", "right").contains(entry.getValue().asText())) errors.add("存取站货架绑定非法：" + owner); });
    }

    private void validateStorage(JsonNode value, Set<String> itemIds, List<String> errors, String owner) {
        if (value == null || value.isNull()) return;
        if (!value.isObject() || !isPositiveInteger(value.get("capacity")) || !value.path("initialInventory").isObject()) errors.add("仓储配置非法：" + owner);
        if (value.path("initialInventory").isObject()) value.path("initialInventory").fields().forEachRemaining(entry -> { if (!itemIds.contains(entry.getKey()) || !isFinite(entry.getValue()) || entry.getValue().asDouble() < 0) errors.add("仓储库存非法：" + owner); });
    }

    private int[] footprint(ObjectNode save, JsonNode object) {
        String type = text(object, "type");
        if ("machine".equals(type) && object.has("resourceId")) for (JsonNode definition : save.path("machineDefinitions")) if (object.path("resourceId").asText().equals(definition.path("id").asText()) && definition.path("footprint").isObject()) return new int[]{Math.max(1, definition.path("footprint").path("w").asInt(1)), Math.max(1, definition.path("footprint").path("d").asInt(1))};
        Map<String, int[]> sizes = new HashMap<>();
        sizes.put("inboundWarehouse", new int[]{3, 3}); sizes.put("outboundWarehouse", new int[]{3, 3}); sizes.put("smelter", new int[]{3, 2}); sizes.put("press", new int[]{2, 2}); sizes.put("assembler", new int[]{3, 3}); sizes.put("inspection", new int[]{2, 2}); sizes.put("washing", new int[]{2, 2}); sizes.put("oreMiner", new int[]{2, 2}); sizes.put("storage", new int[]{2, 2}); sizes.put("agv", new int[]{2, 2}); sizes.put("drone", new int[]{3, 3}); sizes.put("inclineUp", new int[]{8, 1}); sizes.put("inclineDown", new int[]{8, 1});
        return sizes.getOrDefault(type, new int[]{1, 1});
    }

    private Set<String> ids(JsonNode array) { Set<String> ids = new HashSet<>(); if (array.isArray()) for (JsonNode entry : array) if (!text(entry, "id").isBlank()) ids.add(text(entry, "id")); return ids; }
    private JsonNode find(JsonNode array, String id) { if (array != null && array.isArray()) for (JsonNode entry : array) if (id.equals(text(entry, "id"))) return entry; return null; }
    private String text(JsonNode node, String field) { return node == null ? "" : node.path(field).asText("").trim(); }
    private boolean isInteger(JsonNode n) { return n != null && n.isNumber() && n.asDouble() == Math.rint(n.asDouble()); }
    private boolean isGridNumber(JsonNode n) { return isInteger(n) && n.asInt() >= -100000 && n.asInt() <= 100000; }
    private boolean isPositiveInteger(JsonNode n) { return isInteger(n) && n.asInt() > 0; }
    private boolean isPositiveNumber(JsonNode n) { return isFinite(n) && n.asDouble() > 0; }
    private boolean isFinite(JsonNode n) { return n != null && n.isNumber() && Double.isFinite(n.asDouble()); }
    private List<String> dedupe(List<String> errors) { return new ArrayList<>(new LinkedHashSet<>(errors)); }
}
