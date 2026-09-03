package com.forgemind.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertTrue;

class AgentPatchValidatorTest {
    private final ObjectMapper json = new ObjectMapper();
    private final AgentPatchValidator validator = new AgentPatchValidator();

    @Test
    void acceptsSafeMoveAndRejectsCollisionAndUnknownFields() throws Exception {
        var save = json.readTree("""
                {"version":6,"floorCount":1,"objects":[
                  {"id":"machine-1","type":"machine","pos":{"x":0,"z":0},"rotation":0,"floorId":1},
                  {"id":"rack-1","type":"storage","pos":{"x":5,"z":0},"rotation":0,"floorId":1}],
                  "items":[{"id":"steel","name":"钢坯"}],"recipes":[],"floorNames":["1F"],"machineDefinitions":[]}
                """);
        var valid = json.readTree("[{" +
                "\"op_id\":\"move-1\",\"kind\":\"move_object\",\"object_id\":\"machine-1\",\"params\":{\"x\":1,\"z\":1}}]");
        assertTrue(validator.validate(save, valid).isEmpty());

        var collision = json.readTree("[{" +
                "\"op_id\":\"move-1\",\"kind\":\"move_object\",\"object_id\":\"machine-1\",\"params\":{\"x\":5,\"z\":0}}]");
        List<String> collisionErrors = validator.validate(save, collision);
        assertTrue(collisionErrors.stream().anyMatch(error -> error.contains("碰撞")));

        var arbitrary = json.readTree("[{" +
                "\"op_id\":\"hack\",\"kind\":\"update_config\",\"object_id\":\"machine-1\",\"params\":{\"path\":\"ownerId\",\"value\":\"other-user\"}}]");
        assertTrue(validator.validate(save, arbitrary).stream().anyMatch(error -> error.contains("不允许修改")));
    }

    @Test
    void rejectsInvalidReferencesAndUnsafeInventory() throws Exception {
        var save = json.readTree("""
                {"version":6,"floorCount":1,"objects":[
                  {"id":"rack-1","type":"storage","pos":{"x":0,"z":0},"rotation":0,"floorId":1}],
                  "items":[{"id":"steel","name":"钢坯"}],"recipes":[],"floorNames":["1F"],"machineDefinitions":[]}
                """);
        var invalid = json.readTree("[{" +
                "\"op_id\":\"inventory-1\",\"kind\":\"adjust_inventory\",\"object_id\":\"rack-1\",\"params\":{\"item_id\":\"missing\",\"quantity\":-1}}]");
        assertTrue(validator.validate(save, invalid).stream().anyMatch(error -> error.contains("库存调整参数非法")));
    }

    @Test
    void rejectsInvalidMoveFloorInsteadOfSilentlyAcceptingIt() throws Exception {
        var save = json.readTree("""
                {"version":6,"floorCount":1,"objects":[
                  {"id":"machine-1","type":"machine","pos":{"x":0,"z":0},"rotation":0,"floorId":1}],
                  "items":[],"recipes":[],"floorNames":["1F"],"machineDefinitions":[]}
                """);
        var invalid = json.readTree("[{" +
                "\"op_id\":\"move-floor\",\"kind\":\"move_object\",\"object_id\":\"machine-1\",\"params\":{\"x\":1,\"z\":1,\"floor_id\":2}}]");
        assertTrue(validator.validate(save, invalid).stream().anyMatch(error -> error.contains("移动楼层非法")));
    }
}
