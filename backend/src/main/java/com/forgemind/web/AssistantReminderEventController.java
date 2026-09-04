package com.forgemind.web;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.forgemind.model.User;
import com.forgemind.repository.AssistantReminderEventRepository;
import com.forgemind.service.AuthService;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

@RestController
@CrossOrigin(origins = "*")
@RequestMapping("/api/assistant/reminders")
public class AssistantReminderEventController {
    private final AssistantReminderEventRepository events;
    private final AuthService auth;

    public AssistantReminderEventController(AssistantReminderEventRepository events, AuthService auth) {
        this.events = events;
        this.auth = auth;
    }

    @PostMapping("/claim")
    public ObjectNode claim(@RequestHeader(value = "Authorization", defaultValue = "") String authorization, @RequestBody JsonNode body) {
        User user = auth.currentUser(authorization);
        return events.claim(user.id(), body);
    }

    @PostMapping("/resolve")
    public ObjectNode resolve(@RequestHeader(value = "Authorization", defaultValue = "") String authorization, @RequestBody JsonNode body) {
        User user = auth.currentUser(authorization);
        return events.resolve(user.id(), body);
    }

    @GetMapping
    public ObjectNode list(@RequestHeader(value = "Authorization", defaultValue = "") String authorization,
                           @RequestParam(defaultValue = "open") String status,
                           @RequestParam(defaultValue = "12") int limit) {
        User user = auth.currentUser(authorization);
        return events.list(user.id(), status, limit);
    }

    @ExceptionHandler(IllegalArgumentException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public ObjectNode bad(IllegalArgumentException error) {
        return new com.fasterxml.jackson.databind.ObjectMapper().createObjectNode().put("error", error.getMessage() == null ? "请求非法" : error.getMessage());
    }
}
