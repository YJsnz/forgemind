package com.forgemind.repository;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Repository
public class AgentRuntimeRepository {
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;

    public AgentRuntimeRepository(JdbcTemplate jdbc, ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.mapper = mapper;
    }

    @Transactional
    public String createRun(String owner, String factory, String objective, String mode, String baseVersion,
                            JsonNode context, JsonNode goal, String provider, boolean llmConfigured) {
        String runId = id("run");
        jdbc.update("""
            INSERT INTO agent_run(id,owner_user_id,factory_id,objective,mode,status,provider,llm_configured,
              base_version,context_json,compiled_goal,result_json,summary)
            VALUES(?,?,?,?,?,'created',?,?,?,?,?,NULL,'')
            """, runId, owner, factory, objective, mode, provider, llmConfigured, baseVersion, raw(context), raw(goal));
        String[][] steps = {{"compile_goal","编译目标约束"},{"load_context","读取工厂上下文"},
                {"execute_tools","执行只读工具"},{"synthesize","汇总证据与结论"},{"validate_patch","校验变更方案"}};
        int count = "plan_design".equals(mode) ? 5 : 4;
        for (int i=0;i<count;i++) jdbc.update("INSERT INTO agent_step(id,run_id,position,step_key,title,status,detail_text) VALUES(?,?,?,?,?,'pending','')",
                id("step"),runId,i+1,steps[i][0],steps[i][1]);
        event(runId,"run_created",mapper.createObjectNode().put("status","created"));
        return runId;
    }

    public ObjectNode run(String owner, String runId) {
        List<ObjectNode> rows=jdbc.query("SELECT * FROM agent_run WHERE id=? AND owner_user_id=?",(rs,n)->runRow(rs),runId,owner);
        if(rows.isEmpty())throw new IllegalArgumentException("Agent 运行不存在或不属于当前用户");
        ObjectNode out=rows.get(0);
        out.set("steps",array("SELECT * FROM agent_step WHERE run_id=? ORDER BY position",runId,this::stepRow));
        out.set("tool_calls",array("SELECT * FROM agent_tool_call WHERE run_id=? ORDER BY created_at",runId,this::toolRow));
        out.set("events",array("SELECT * FROM agent_run_event WHERE run_id=? ORDER BY sequence_no",runId,this::eventRow));
        out.set("patches",patches(owner,runId));
        return out;
    }

    public ArrayNode runs(String owner,String factory){ArrayNode out=mapper.createArrayNode();jdbc.query("SELECT id FROM agent_run WHERE owner_user_id=? AND factory_id=? ORDER BY created_at DESC LIMIT 50",(RowCallbackHandler)rs->out.add(run(owner,rs.getString(1))),owner,factory);return out;}

    public List<StaleRun> staleReadOnlyRuns(Instant cutoff) {
        return jdbc.query("SELECT id,owner_user_id FROM agent_run WHERE mode='read_only' AND status IN('created','planning','contextualizing','executing_tools','synthesizing') AND updated_at < ? ORDER BY updated_at LIMIT 8", (rs, rowNum) -> new StaleRun(rs.getString("id"), rs.getString("owner_user_id")), Timestamp.from(cutoff));
    }

    @Transactional
    public void queueOrchestration(String owner, String runId) {
        ObjectNode run = run(owner, runId);
        String status = run.path("status").asText();
        if (List.of("completed", "cancelled", "rejected", "failed").contains(status)) return;
        jdbc.update("UPDATE agent_run SET status='planning', error_text=NULL WHERE id=? AND owner_user_id=?", runId, owner);
        event(runId, "orchestration_queued", mapper.createObjectNode().put("mode", "server_read_only").put("status", "planning"));
    }

    @Transactional
    public void fail(String owner, String runId, String message) {
        run(owner, runId);
        String safe = message == null || message.isBlank() ? "服务端 Agent 编排失败" : message.substring(0, Math.min(2000, message.length()));
        jdbc.update("UPDATE agent_run SET status='failed', error_text=?, completed_at=CURRENT_TIMESTAMP(6) WHERE id=? AND owner_user_id=?", safe, runId, owner);
        jdbc.update("UPDATE agent_step SET status='failed', detail_text=?, completed_at=CURRENT_TIMESTAMP(6) WHERE run_id=? AND status IN('pending','running')", safe, runId);
        event(runId, "orchestration_failed", mapper.createObjectNode().put("error", safe));
    }

    @Transactional
    public void begin(String owner,String runId){run(owner,runId);jdbc.update("UPDATE agent_run SET status='executing_tools',error_text=NULL WHERE id=?",runId);jdbc.update("UPDATE agent_step SET status='running',started_at=CURRENT_TIMESTAMP(6) WHERE run_id=? AND status='pending'",runId);event(runId,"agent_progress",mapper.createObjectNode().put("status","executing_tools"));}

    @Transactional
    public void progress(String owner,String runId,String stepKey,String status,String detail){
        run(owner,runId);
        if(!List.of("pending","running","completed","failed","cancelled").contains(status))throw new IllegalArgumentException("Agent 步骤状态非法");
        Integer count=jdbc.queryForObject("SELECT COUNT(*) FROM agent_step WHERE run_id=? AND step_key=?",Integer.class,runId,stepKey);
        if(count==null||count==0)throw new IllegalArgumentException("Agent 步骤不存在："+stepKey);
        String safeDetail=detail==null?"":detail.length()>1000?detail.substring(0,1000):detail;
        if("running".equals(status))jdbc.update("UPDATE agent_step SET status=?,detail_text=?,started_at=COALESCE(started_at,CURRENT_TIMESTAMP(6)),completed_at=NULL WHERE run_id=? AND step_key=?",status,safeDetail,runId,stepKey);
        else if(List.of("completed","failed","cancelled").contains(status))jdbc.update("UPDATE agent_step SET status=?,detail_text=?,completed_at=CURRENT_TIMESTAMP(6) WHERE run_id=? AND step_key=?",status,safeDetail,runId,stepKey);
        else jdbc.update("UPDATE agent_step SET status=?,detail_text=? WHERE run_id=? AND step_key=?",status,safeDetail,runId,stepKey);
        String runStatus="failed".equals(status)?"failed":"cancelled".equals(status)?"cancelled":switch(stepKey){case "compile_goal"->"planning";case "load_context"->"contextualizing";case "execute_tools"->"executing_tools";case "synthesize"->"synthesizing";case "validate_patch"->"awaiting_approval";default->"executing_tools";};
        jdbc.update("UPDATE agent_run SET status=?,error_text=? WHERE id=?",runStatus,"failed".equals(status)?safeDetail:null,runId);
        event(runId,"agent_progress",mapper.createObjectNode().put("step_key",stepKey).put("status",status).put("detail",safeDetail));
    }

    @Transactional
    public void tool(String runId,String name,JsonNode output,int duration){String step=jdbc.queryForObject("SELECT id FROM agent_step WHERE run_id=? AND step_key='execute_tools'",String.class,runId);jdbc.update("INSERT INTO agent_tool_call(id,run_id,step_id,tool_name,status,attempt,input_json,output_json,duration_ms,completed_at) VALUES(?,?,?,?,'completed',1,'{}',?,?,CURRENT_TIMESTAMP(6))",id("tool"),runId,step,name,raw(output),duration);jdbc.update("UPDATE agent_run SET tool_calls_used=tool_calls_used+1 WHERE id=?",runId);event(runId,"tool_completed",mapper.createObjectNode().put("tool_name",name).put("duration_ms",duration));}

    @Transactional
    public void complete(String owner,String runId,JsonNode result,String summary,String status){run(owner,runId);jdbc.update("UPDATE agent_run SET status=?,result_json=?,summary=?,completed_at=CURRENT_TIMESTAMP(6) WHERE id=?",status,raw(result),summary,runId);jdbc.update("UPDATE agent_step SET status='completed',completed_at=CURRENT_TIMESTAMP(6) WHERE run_id=?",runId);event(runId,"analysis_completed",mapper.createObjectNode().put("status",status));}

    @Transactional
    public void cancel(String owner,String runId){run(owner,runId);jdbc.update("UPDATE agent_run SET status='cancelled',completed_at=CURRENT_TIMESTAMP(6) WHERE id=?",runId);jdbc.update("UPDATE agent_step SET status='cancelled',completed_at=CURRENT_TIMESTAMP(6) WHERE run_id=? AND status IN('pending','running')",runId);event(runId,"run_cancelled",mapper.createObjectNode());}

    @Transactional
    public String createPatch(String owner,String runId,String factory,String base,JsonNode operations,JsonNode inverse,JsonNode validation,JsonNode diff,String risk){String patch=id("patch");jdbc.update("INSERT INTO agent_patch(id,run_id,factory_id,owner_user_id,base_version,status,risk_level,idempotency_key,operations_json,inverse_operations_json,preconditions_json,impact_json,validation_json,diff_summary_json) VALUES(?,?,?,?,?,'awaiting_approval',?,? ,?,?,'[]','{}',?,?)",patch,runId,factory,owner,base,risk,"agent:"+runId,raw(operations),raw(inverse),raw(validation),raw(diff));jdbc.update("INSERT INTO agent_approval(id,patch_id,run_id,owner_user_id,status,summary,risk_level) VALUES(?,?,?,?,'pending','Agent 方案等待人工批准',?)",id("approval"),patch,runId,owner,risk);jdbc.update("UPDATE agent_run SET status='awaiting_approval' WHERE id=?",runId);event(runId,"patch_proposed",mapper.createObjectNode().put("patch_id",patch));return patch;}

    public ArrayNode patches(String owner,String runId){assertRun(owner,runId);return array("SELECT * FROM agent_patch WHERE run_id=? ORDER BY created_at",runId,this::patchRow);}
    public ObjectNode patch(String owner,String patchId){List<ObjectNode> rows=jdbc.query("SELECT * FROM agent_patch WHERE id=? AND owner_user_id=?",(rs,n)->patchRow(rs),patchId,owner);if(rows.isEmpty())throw new IllegalArgumentException("Agent Patch 不存在或不属于当前用户");return rows.get(0);}

    @Transactional
    public void decide(String owner,String patchId,String status,String note){ObjectNode p=patch(owner,patchId);String current=p.path("status").asText();if(current.equals(status))return;if(!"awaiting_approval".equals(current))throw new IllegalArgumentException("当前 Patch 状态不允许审批");jdbc.update("UPDATE agent_patch SET status=?,decided_at=CURRENT_TIMESTAMP(6) WHERE id=?",status,patchId);jdbc.update("UPDATE agent_approval SET status=?,decision_note=?,decided_at=CURRENT_TIMESTAMP(6) WHERE patch_id=? AND status='pending'",status,note,patchId);jdbc.update("UPDATE agent_run SET status=? WHERE id=?","rejected".equals(status)?"rejected":"awaiting_approval",p.path("run_id").asText());event(p.path("run_id").asText(),"patch_"+status,mapper.createObjectNode().put("patch_id",patchId));}

    @Transactional
    public void applied(String owner,String patchId,JsonNode before,JsonNode after){ObjectNode p=patch(owner,patchId);jdbc.update("UPDATE agent_patch SET status='applied',backup_save_json=?,applied_save_json=?,applied_at=CURRENT_TIMESTAMP(6) WHERE id=?",raw(before),raw(after),patchId);jdbc.update("UPDATE agent_run SET status='completed',completed_at=CURRENT_TIMESTAMP(6) WHERE id=?",p.path("run_id").asText());event(p.path("run_id").asText(),"patch_applied",mapper.createObjectNode().put("patch_id",patchId));}
    @Transactional
    public void rolledBack(String owner,String patchId){ObjectNode p=patch(owner,patchId);jdbc.update("UPDATE agent_patch SET status='rolled_back' WHERE id=?",patchId);event(p.path("run_id").asText(),"patch_rolled_back",mapper.createObjectNode().put("patch_id",patchId));}

    public ObjectNode event(String runId,String name,JsonNode data){Integer seq=jdbc.queryForObject("SELECT COALESCE(MAX(sequence_no),0)+1 FROM agent_run_event WHERE run_id=?",Integer.class,runId);ObjectNode out=mapper.createObjectNode().put("id",id("event")).put("sequence",seq==null?1:seq).put("event_name",name);out.set("data",data);jdbc.update("INSERT INTO agent_run_event(id,run_id,sequence_no,event_name,data_json) VALUES(?,?,?,?,?)",out.path("id").asText(),runId,out.path("sequence").asInt(),name,raw(data));return out;}

    private ObjectNode runRow(ResultSet r)throws SQLException{ObjectNode n=mapper.createObjectNode();n.put("id",r.getString("id"));n.put("owner_id",r.getString("owner_user_id"));n.put("factory_id",r.getString("factory_id"));n.put("objective",r.getString("objective"));n.put("mode",r.getString("mode"));n.put("status",r.getString("status"));n.put("provider",r.getString("provider"));n.put("llm_configured",r.getBoolean("llm_configured"));n.put("base_factory_updated_at",r.getString("base_version"));n.set("compiled_goal",parse(r.getString("compiled_goal")));n.set("context_snapshot",parse(r.getString("context_json")));n.put("tool_call_budget",r.getInt("tool_call_budget"));n.put("tool_timeout_ms",r.getInt("tool_timeout_ms"));n.put("tool_retry_limit",r.getInt("tool_retry_limit"));n.put("tool_calls_used",r.getInt("tool_calls_used"));n.put("summary",r.getString("summary"));n.set("result",parse(r.getString("result_json")));nullable(n,"error",r.getString("error_text"));n.put("created_at",time(r.getTimestamp("created_at")));n.put("updated_at",time(r.getTimestamp("updated_at")));nullable(n,"completed_at",timeOrNull(r.getTimestamp("completed_at")));return n;}
    private ObjectNode stepRow(ResultSet r)throws SQLException{ObjectNode n=mapper.createObjectNode();n.put("id",r.getString("id"));n.put("position",r.getInt("position"));n.put("key",r.getString("step_key"));n.put("title",r.getString("title"));n.put("status",r.getString("status"));n.put("detail",r.getString("detail_text"));nullable(n,"started_at",timeOrNull(r.getTimestamp("started_at")));nullable(n,"completed_at",timeOrNull(r.getTimestamp("completed_at")));return n;}
    private ObjectNode toolRow(ResultSet r)throws SQLException{ObjectNode n=mapper.createObjectNode();n.put("id",r.getString("id"));nullable(n,"step_id",r.getString("step_id"));n.put("tool_name",r.getString("tool_name"));n.put("status",r.getString("status"));n.put("attempt",r.getInt("attempt"));n.set("input_data",parse(r.getString("input_json")));n.set("output_data",parse(r.getString("output_json")));nullable(n,"error",r.getString("error_text"));if(r.getObject("duration_ms")==null)n.putNull("duration_ms");else n.put("duration_ms",r.getInt("duration_ms"));n.put("created_at",time(r.getTimestamp("created_at")));nullable(n,"completed_at",timeOrNull(r.getTimestamp("completed_at")));return n;}
    private ObjectNode eventRow(ResultSet r)throws SQLException{ObjectNode n=mapper.createObjectNode();n.put("id",r.getString("id"));n.put("sequence",r.getInt("sequence_no"));n.put("event_name",r.getString("event_name"));n.set("data",parse(r.getString("data_json")));n.put("created_at",time(r.getTimestamp("created_at")));return n;}
    private ObjectNode patchRow(ResultSet r)throws SQLException{ObjectNode n=mapper.createObjectNode();n.put("id",r.getString("id"));n.put("run_id",r.getString("run_id"));n.put("factory_id",r.getString("factory_id"));n.put("owner_id",r.getString("owner_user_id"));n.put("base_version",r.getString("base_version"));n.put("status",r.getString("status"));n.put("risk_level",r.getString("risk_level"));n.put("idempotency_key",r.getString("idempotency_key"));for(String[] f:new String[][]{{"operations","operations_json"},{"inverse_operations","inverse_operations_json"},{"preconditions","preconditions_json"},{"impact","impact_json"},{"validation","validation_json"},{"diff_summary","diff_summary_json"},{"backup_save","backup_save_json"},{"applied_save","applied_save_json"}})n.set(f[0],parse(r.getString(f[1])));nullable(n,"error",r.getString("error_text"));n.put("created_at",time(r.getTimestamp("created_at")));n.put("updated_at",time(r.getTimestamp("updated_at")));nullable(n,"decided_at",timeOrNull(r.getTimestamp("decided_at")));nullable(n,"applied_at",timeOrNull(r.getTimestamp("applied_at")));nullable(n,"applied_factory_updated_at",timeOrNull(r.getTimestamp("applied_at")));n.set("approvals",array("SELECT * FROM agent_approval WHERE patch_id=? ORDER BY created_at",r.getString("id"),this::approvalRow));return n;}
    private ObjectNode approvalRow(ResultSet r)throws SQLException{ObjectNode n=mapper.createObjectNode();n.put("id",r.getString("id"));n.put("patch_id",r.getString("patch_id"));n.put("run_id",r.getString("run_id"));n.put("owner_id",r.getString("owner_user_id"));n.put("status",r.getString("status"));n.put("summary",r.getString("summary"));n.put("risk_level",r.getString("risk_level"));nullable(n,"decision_note",r.getString("decision_note"));nullable(n,"decided_at",timeOrNull(r.getTimestamp("decided_at")));n.put("created_at",time(r.getTimestamp("created_at")));return n;}
    private interface Row {ObjectNode map(ResultSet r)throws SQLException;}
    private ArrayNode array(String sql,Object arg,Row row){ArrayNode a=mapper.createArrayNode();jdbc.query(sql,(RowCallbackHandler)r->a.add(row.map(r)),arg);return a;}
    private void assertRun(String owner,String run){Integer c=jdbc.queryForObject("SELECT COUNT(*) FROM agent_run WHERE id=? AND owner_user_id=?",Integer.class,run,owner);if(c==null||c==0)throw new IllegalArgumentException("Agent 运行不存在或不属于当前用户");}
    private String raw(JsonNode n){try{return mapper.writeValueAsString(n);}catch(JsonProcessingException e){throw new IllegalArgumentException("Agent JSON 无法序列化",e);}}
    private JsonNode parse(String s){if(s==null)return mapper.nullNode();try{return mapper.readTree(s);}catch(JsonProcessingException e){throw new IllegalStateException("Agent JSON 已损坏",e);}}
    private String id(String p){return p+"-"+UUID.randomUUID();} private String time(Timestamp t){return t==null?Instant.now().toString():t.toInstant().toString();} private String timeOrNull(Timestamp t){return t==null?null:t.toInstant().toString();}
    private void nullable(ObjectNode n,String key,String value){if(value==null)n.putNull(key);else n.put(key,value);}
    public record StaleRun(String id, String owner) {}
}
