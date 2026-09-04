package com.forgemind.web;

import com.forgemind.repository.AssistantKnowledgeRepository;
import com.forgemind.service.AuthService;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@CrossOrigin(origins = "*")
@RequestMapping("/api/v1/ai/knowledge")
public class AssistantKnowledgeController {
    private final AssistantKnowledgeRepository knowledge;
    private final AuthService auth;

    public AssistantKnowledgeController(AssistantKnowledgeRepository knowledge, AuthService auth) {
        this.knowledge = knowledge;
        this.auth = auth;
    }

    public record CreateKnowledgeRequest(String title, String category, String source, String content) {}

    @GetMapping
    public List<Map<String, Object>> list(@RequestHeader(value = "Authorization", defaultValue = "") String authorization, @RequestParam(value = "workspace_id", required = false) String workspaceId) {
        return knowledge.list(auth.currentUser(authorization).id(), workspaceId);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> create(@RequestHeader(value = "Authorization", defaultValue = "") String authorization, @RequestParam(value = "workspace_id", required = false) String workspaceId, @RequestBody CreateKnowledgeRequest request) {
        if (request == null) throw new IllegalArgumentException("知识条目请求不能为空");
        return knowledge.create(auth.currentUser(authorization).id(), workspaceId, request.title(), request.category(), request.source(), request.content());
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void archive(@RequestHeader(value = "Authorization", defaultValue = "") String authorization, @RequestParam(value = "workspace_id", required = false) String workspaceId, @PathVariable String id) {
        knowledge.delete(auth.currentUser(authorization).id(), workspaceId, id);
    }

    @ExceptionHandler(IllegalArgumentException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public Map<String, String> bad(IllegalArgumentException error) {
        return Map.of("error", error.getMessage() == null ? "请求非法" : error.getMessage());
    }
}
