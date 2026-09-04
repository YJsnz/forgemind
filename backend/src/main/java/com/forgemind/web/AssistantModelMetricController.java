package com.forgemind.web;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.forgemind.model.User;
import com.forgemind.repository.AssistantModelMetricRepository;
import com.forgemind.service.AuthService;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

@RestController
@CrossOrigin(origins = "*")
@RequestMapping("/api/assistant/metrics")
public class AssistantModelMetricController {
    private final AssistantModelMetricRepository metrics;
    private final AuthService auth;

    public AssistantModelMetricController(AssistantModelMetricRepository metrics, AuthService auth) {
        this.metrics = metrics;
        this.auth = auth;
    }

    @GetMapping
    public ObjectNode get(@RequestHeader(value = "Authorization", defaultValue = "") String authorization) {
        User user = auth.currentUser(authorization);
        return metrics.read(user.id());
    }

    @PostMapping
    public ObjectNode post(@RequestHeader(value = "Authorization", defaultValue = "") String authorization, @RequestBody JsonNode body) {
        User user = auth.currentUser(authorization);
        return metrics.record(user.id(), body);
    }

    @ExceptionHandler(IllegalArgumentException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public ObjectNode bad(IllegalArgumentException error) {
        return new com.fasterxml.jackson.databind.ObjectMapper().createObjectNode().put("error", error.getMessage() == null ? "请求非法" : error.getMessage());
    }
}
