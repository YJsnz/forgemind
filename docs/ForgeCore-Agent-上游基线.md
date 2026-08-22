# ForgeCore Agent 上游基线

- 上游仓库：`https://github.com/SifenXingfeng/ForgeCore`
- 迁移提交：`82aad3165620861cd8125da031c5e065fa839974`
- 提交说明：`feat: integrate black-white UI and persistent agent workflow`
- 迁移日期：2026-08-21

本次接入先使用 `GIT_LFS_SKIP_SMUDGE=1 git clone --depth 1` 获取干净源码，再以原实现和测试为契约进行适配，不以截图或重新设计的同名页面替代。

| 上游源码 | ForgeMind 适配位置 |
| --- | --- |
| `src/pages/AgentPage.tsx` | `src/components/FactoryAgentWorkspace.tsx`、`src/forgecore-agent.css` |
| `src/repository/agentRepository.ts` | `src/api/agent.ts` |
| `src/repository/realtimeRepository.ts` | `src/api/agent.ts` 的认证 SSE 客户端 |
| `src/domain/simulationBranch.ts` | `src/game/factoryAgent.ts`、`src/game/agentBranch.ts` |
| `src/workers/simulationBranchWorker.ts` | `src/workers/factoryAgentBranchWorker.ts` |
| `backend/app/models/agent.py` | Flyway V9 的 run/step/tool/event/patch/approval 表 |
| `backend/app/api/agent.py`、`api/realtime.py` | `backend/.../web/AgentController.java` |
| `backend/app/services/agent_run_service.py`、`factory_patch_service.py` | `AgentRuntimeService.java`、`AgentRuntimeRepository.java` |

技术栈适配只替换承载方式：PostgreSQL/FastAPI/Redis 改为项目现有 MySQL/Spring Boot/进程内 SSE Hub；API 生命周期、人工审批、版本冲突、应用与回滚语义保持一致。默认确定性运行不依赖大语言模型。
