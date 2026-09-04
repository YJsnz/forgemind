package com.forgemind.web;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.forgemind.model.User;
import com.forgemind.repository.AssistantUserMemoryRepository;
import com.forgemind.service.AuthService;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

@RestController
@CrossOrigin(origins = "*")
@RequestMapping("/api/assistant/memory")
public class AssistantUserMemoryController {
    private final AssistantUserMemoryRepository memory;
    private final AuthService auth;

    public AssistantUserMemoryController(AssistantUserMemoryRepository memory, AuthService auth) {
        this.memory = memory;
        this.auth = auth;
    }

    @GetMapping
    public ObjectNode get(@RequestHeader(value = "Authorization", defaultValue = "") String authorization) {
        User user = auth.currentUser(authorization);
        return memory.read(user.id());
    }

    @PutMapping
    public ObjectNode put(@RequestHeader(value = "Authorization", defaultValue = "") String authorization, @RequestBody JsonNode body) {
        User user = auth.currentUser(authorization);
        return memory.write(user.id(), body);
    }

    @DeleteMapping
    public ObjectNode delete(@RequestHeader(value = "Authorization", defaultValue = "") String authorization, @RequestBody JsonNode body) {
        User user = auth.currentUser(authorization);
        return memory.delete(user.id(), body);
    }

    @ExceptionHandler(IllegalArgumentException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public ObjectNode bad(IllegalArgumentException error) {
        return new com.fasterxml.jackson.databind.ObjectMapper().createObjectNode().put("error", error.getMessage() == null ? "请求非法" : error.getMessage());
    }
}
