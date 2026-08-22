package com.forgemind.web;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.forgemind.model.User;
import com.forgemind.service.AgentEventHub;
import com.forgemind.service.AgentRuntimeService;
import com.forgemind.service.AuthService;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.util.Map;

@RestController
@CrossOrigin(origins="*")
public class AgentController {
    private final AgentRuntimeService runtime; private final AuthService auth; private final AgentEventHub events; private final ObjectMapper json;
    public AgentController(AgentRuntimeService runtime,AuthService auth,AgentEventHub events,ObjectMapper json){this.runtime=runtime;this.auth=auth;this.events=events;this.json=json;}

    @GetMapping("/api/agent/tools") public ArrayNode tools(){ArrayNode out=json.createArrayNode();for(String name:AgentRuntimeService.TOOLS)out.addObject().put("name",name).put("read_only",true).put("timeout_ms",5000).put("retry_limit",1);return out;}

    @PostMapping("/api/agent/sessions") @ResponseStatus(HttpStatus.CREATED)
    public ObjectNode createSession(@RequestHeader(value="Authorization",defaultValue="")String authorization,@RequestBody JsonNode body){User u=auth.currentUser(authorization);return session(runtime.create(u.id(),required(body,"factory_id"),required(body,"objective"),"read_only",body.path("context_snapshot")));}
    @GetMapping("/api/agent/sessions/{sessionId}") public ObjectNode getSession(@RequestHeader(value="Authorization",defaultValue="")String authorization,@PathVariable String sessionId){return session(runtime.get(auth.currentUser(authorization).id(),sessionId));}
    @DeleteMapping("/api/agent/sessions/{sessionId}") @ResponseStatus(HttpStatus.NO_CONTENT) public void cancelSession(@RequestHeader(value="Authorization",defaultValue="")String authorization,@PathVariable String sessionId){runtime.cancel(auth.currentUser(authorization).id(),sessionId);}
    @GetMapping("/api/agent/sessions/{sessionId}/events") public JsonNode sessionEvents(@RequestHeader(value="Authorization",defaultValue="")String authorization,@PathVariable String sessionId){return runtime.get(auth.currentUser(authorization).id(),sessionId).path("events");}
    @PostMapping("/api/agent/sessions/{sessionId}/events") @ResponseStatus(HttpStatus.CREATED) public ObjectNode createSessionEvent(@RequestHeader(value="Authorization",defaultValue="")String authorization,@PathVariable String sessionId,@RequestBody JsonNode body){return runtime.appendEvent(auth.currentUser(authorization).id(),sessionId,required(body,"event"),body.path("data"));}

    @PostMapping("/api/agent/runs") @ResponseStatus(HttpStatus.CREATED)
    public ObjectNode create(@RequestHeader(value="Authorization",defaultValue="")String authorization,@RequestBody JsonNode body){User u=auth.currentUser(authorization);return runtime.create(u.id(),required(body,"factory_id"),required(body,"objective"),body.path("mode").asText("read_only"),body.path("context_snapshot"));}
    @GetMapping("/api/agent/runs") public ArrayNode list(@RequestHeader(value="Authorization",defaultValue="")String authorization,@RequestParam("factory_id")String factory){return runtime.list(auth.currentUser(authorization).id(),factory);}
    @GetMapping("/api/agent/runs/{runId}") public ObjectNode get(@RequestHeader(value="Authorization",defaultValue="")String authorization,@PathVariable String runId){return runtime.get(auth.currentUser(authorization).id(),runId);}
    @PostMapping("/api/agent/runs/{runId}/analyze") public ObjectNode analyze(@RequestHeader(value="Authorization",defaultValue="")String authorization,@PathVariable String runId,@RequestBody(required=false)JsonNode body){User u=auth.currentUser(authorization);ObjectNode out=runtime.analyze(u.id(),runId,body==null?null:body.path("result"),body==null?null:body.path("patch"));events.publish(runId,"analysis_completed",out);return out;}
    @PostMapping("/api/agent/runs/{runId}/cancel") public ObjectNode cancel(@RequestHeader(value="Authorization",defaultValue="")String authorization,@PathVariable String runId){ObjectNode out=runtime.cancel(auth.currentUser(authorization).id(),runId);events.publish(runId,"run_cancelled",out);return out;}
    @GetMapping("/api/agent/runs/{runId}/patches") public ArrayNode patches(@RequestHeader(value="Authorization",defaultValue="")String authorization,@PathVariable String runId){return runtime.patches(auth.currentUser(authorization).id(),runId);}
    @GetMapping("/api/agent/patches/{patchId}") public ObjectNode patch(@RequestHeader(value="Authorization",defaultValue="")String authorization,@PathVariable String patchId){return runtime.patch(auth.currentUser(authorization).id(),patchId);}
    @PostMapping("/api/agent/patches/{patchId}/approve") public ObjectNode approve(@RequestHeader(value="Authorization",defaultValue="")String authorization,@PathVariable String patchId,@RequestBody(required=false)JsonNode body){return runtime.approve(auth.currentUser(authorization).id(),patchId,note(body));}
    @PostMapping("/api/agent/patches/{patchId}/reject") public ObjectNode reject(@RequestHeader(value="Authorization",defaultValue="")String authorization,@PathVariable String patchId,@RequestBody(required=false)JsonNode body){return runtime.reject(auth.currentUser(authorization).id(),patchId,note(body));}
    @PostMapping("/api/agent/patches/{patchId}/replan") public ObjectNode replan(@RequestHeader(value="Authorization",defaultValue="")String authorization,@PathVariable String patchId,@RequestBody JsonNode body){return runtime.replan(auth.currentUser(authorization).id(),patchId,required(body,"rejection_reason"));}
    @PostMapping("/api/agent/patches/{patchId}/apply") public ObjectNode apply(@RequestHeader(value="Authorization",defaultValue="")String authorization,@PathVariable String patchId){return runtime.apply(auth.currentUser(authorization).id(),patchId);}
    @PostMapping("/api/agent/patches/{patchId}/rollback") public ObjectNode rollback(@RequestHeader(value="Authorization",defaultValue="")String authorization,@PathVariable String patchId){return runtime.rollback(auth.currentUser(authorization).id(),patchId);}

    @GetMapping(value="/api/realtime/agent/{runId}/stream",produces=MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter stream(@RequestHeader(value="Authorization",defaultValue="")String authorization,@PathVariable String runId){User u=auth.currentUser(authorization);runtime.get(u.id(),runId);return events.open(runId);}

    @ExceptionHandler(IllegalArgumentException.class) @ResponseStatus(HttpStatus.BAD_REQUEST)
    public Map<String,String> bad(IllegalArgumentException e){return Map.of("error",e.getMessage()==null?"请求非法":e.getMessage());}
    private String required(JsonNode n,String key){String v=n==null?"":n.path(key).asText("").trim();if(v.isEmpty())throw new IllegalArgumentException(key+" 不能为空");return v;}
    private String note(JsonNode n){return n==null||n.path("note").isNull()?null:n.path("note").asText();}
    private ObjectNode session(ObjectNode run){ObjectNode out=json.createObjectNode();out.put("id",run.path("id").asText());out.put("owner_id",run.path("owner_id").asText());out.put("factory_id",run.path("factory_id").asText());out.put("objective",run.path("objective").asText());String status=run.path("status").asText();out.put("status",switch(status){case "created"->"ready";case "planning","contextualizing","executing_tools"->"analyzing";case "awaiting_approval"->"awaiting_simulation";default->status;});out.put("llm_configured",run.path("llm_configured").asBoolean());out.put("created_at",run.path("created_at").asText());out.put("updated_at",run.path("updated_at").asText());return out;}
}
