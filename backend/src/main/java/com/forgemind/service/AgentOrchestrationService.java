package com.forgemind.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

/** Durable server-side fallback for read-only runs when the browser worker is unavailable. */
@Service
public class AgentOrchestrationService {
    private final AgentRuntimeService runtime;
    private final AgentEventHub events;
    private final ObjectMapper json;

    public AgentOrchestrationService(AgentRuntimeService runtime, AgentEventHub events, ObjectMapper json) {
        this.runtime = runtime;
        this.events = events;
        this.json = json;
    }

    @Async("agentOrchestrator")
    public void executeReadOnly(String owner, String runId) {
        try {
            ObjectNode result = runtime.analyze(owner, runId, null, null);
            events.publish(runId, "orchestration_completed", result);
        } catch (Exception error) {
            runtime.failOrchestration(owner, runId, error.getMessage());
            events.publish(runId, "orchestration_failed", result(error.getMessage()));
        }
    }

    private ObjectNode result(String message) {
        return json.createObjectNode().put("error", message == null ? "服务端 Agent 编排失败" : message);
    }
}
