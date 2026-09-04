# ForgeMind 智能管家工具协议

**协议版本：** 1.0.0  
**机器可读目录：** `contracts/forgemind-assistant-tools.json`

本文档描述本地千问智能管家与 ForgeMind 之间的安全边界。当前协议包含 30 个工具。语音和文字入口共用该协议；LLM 只提出动作，ForgeMind 执行层拥有最终决定权。

## 1. 调用信封

```json
{
  "protocolVersion": "1.0.0",
  "name": "set_simulation_speed",
  "arguments": { "speed": 2 }
}
```

执行层依次校验协议版本、工具白名单、精确参数字段、参数类型与范围、对象存在性、对象角色以及配方/物品引用。未知字段同样会被拒绝，防止模型把解释文本或未支持参数混入执行请求。

## 2. 当前工具

| 工具 | 能力 | 风险 | 二次确认 |
| --- | --- | --- | --- |
| `query_factory_status` | 查询整厂仿真状态 | 只读 | 否 |
| `inspect_object` | 查询指定对象 | 只读 | 否 |
| `select_object` | 在 UI 中定位对象 | 可逆 | 否 |
| `set_simulation_running` | 启动或暂停全局仿真 | 可逆 | 否 |
| `set_simulation_speed` | 设置 0.1～4 倍全局倍率 | 可逆 | 否 |
| `reset_simulation` | 清空运行进度并重建仿真 | 运行态破坏 | 是 |
| `change_machine_recipe` | 修改机器绑定配方 | 配置变更 | 是 |
| `bind_source_item` | 修改来料站绑定物品 | 配置变更 | 是 |
| `open_panel` / `close_panel` / `focus_panel` | 调度已注册业务面板 | 只读 UI | 否 |
| `select_floor` / `locate_object` | 切换楼层、定位对象 | 只读 UI | 否 |
| `compare_panels` / `show_task` | 并排比较面板、查看 Agent 任务 | 只读 UI | 否 |
| `inspect_vision_result` | 解释最近一帧结构化视觉结果 | 只读 | 否 |
| `open_product` | 打开 Forge 生态产品白名单入口 | 只读 UI | 否 |
| `start_agent_task` / `run_autopilot` | 启动受控诊断、方案或巡检任务 | 可逆任务 | 否 |
| `retry_agent_task` / `cancel_agent_task` / `list_agent_task_history` | 重试、取消或查询 Agent 任务 | 任务控制 | 否 |
| `list_active_reminders` / `explain_reminder` | 查询开放提醒及其来源证据 | 只读 | 否 |
| `dismiss_reminder_group` | 关闭指定提醒的同类事件 | 可逆 | 是 |
| `list_user_memory` / `get_reminder_policy` | 查询用户偏好与提醒策略 | 只读 | 否 |
| `set_reminder_policy` / `remember_user_preference` / `forget_user_preference` | 修改提醒策略或用户偏好 | 可逆 | 是 |

单机暂停和单条输送带调速尚未进入协议，因为当前仿真内核没有对应的持久运行状态。新增这类动作时，应先扩展仿真数据模型和回归测试，再发布新的协议版本。

## 3. 确认门控

`requiresConfirmation` 来自机器可读目录，由 ForgeMind 决定，不能由 LLM 覆盖。第一次执行高风险动作只会返回 `awaiting_confirmation`；用户明确确认后，调用方携带同一份已经校验的调用再次执行。

确认期间如果工厂结构发生变化，应重新生成上下文并再次校验，不能使用过期对象引用。

## 4. 上下文

`createFactoryAssistantContext()` 从 Zustand 和仿真快照生成适合 LLM 使用的只读上下文，包含：

- 当前仿真启停、倍率、逻辑时间、在途物料及产出/消耗；
- 对象 ID、类型、中文名称、角色、位置、旋转、绑定和运行态；
- 可用物品与配方的真实 ID 和名称。
- 当前用户开放的主动提醒事件（指纹、来源、严重度、消息、次数和观测时间）；动态工厂事实仍必须通过实时工具读取。

模型必须使用上下文中的字符串 ID，不能把“3号线”等自然语言编号直接当成真实 ID。名称解析应由编排层先产生候选；有歧义时向用户追问。

## 5. 代码入口

- `src/game/assistantProtocol.ts`：上下文、调用类型、白名单和纯校验。
- `src/game/assistantExecutor.ts`：确认门控与 Zustand 受控执行。
- `ai-service/main.py`：公开 `GET /api/ai/tools`，并在助手响应中使用同一调用信封。
- `scripts/assistant-protocol-check.ts`：契约、拒绝路径和真实 store 执行检查。

运行验证：

```powershell
npm.cmd run assistant:protocol
```
