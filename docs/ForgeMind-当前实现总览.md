# ForgeMind 当前实现总览

> 更新时间：2026-08-21
> 本文是当前代码的事实索引。产品方案、演示脚本和研究性文档中的“目标架构”不应覆盖本文对已落地行为的描述。

## 1. 项目边界

ForgeMind 是一个 React + Three.js 的数字工厂编辑、生产路线和仿真前端，配套两个可选服务：

| 层 | 代码位置 | 当前职责 |
| --- | --- | --- |
| 前端应用 | `src/` | 页面、工厂状态、编辑器、三维场景、生产路线和浏览器内确定性仿真 |
| Spring Boot | `backend/` | 登录会话、用户工厂存档、物品/配方/设备布局和用户导入资源的 MySQL 持久化 |
| AI 服务 | `ai-service/` | 离线 LLM 编排、工具协议、ASR、TTS 和视觉检测辅助；不进入仿真 tick 链路 |
| 自研渲染层 | `src/engine/daiyu/` | 静态模型批处理、传送带批处理、Panda/嵌入模型和运行时渲染预算 |

当前仿真逻辑仍由 `src/game/simulation.ts` 驱动。Spring Boot 保存的是可恢复的工厂结构，不是每一帧的 `ItemLot`、AGV 或无人机坐标。

### 渲染目标帧率

顶部设置提供 `60 FPS` 和 `120 FPS` 两档本机渲染目标。60 FPS 档保留更多阴影和像素预算；120 FPS 档针对大场景更积极地调节 DPR、动态阴影和运行时更新，但不替换、减面或降低原始设施模型几何精度，也不改变仿真逻辑。选项保存在浏览器本机，不写入工厂存档；120 FPS 仍是目标档位，不对所有视角、分辨率和硬件状态作稳定承诺。

## 2. 已落地功能矩阵

| 能力 | 主要入口 | 状态 | 说明 |
| --- | --- | --- | --- |
| 登录与用户隔离 | `src/store/auth.ts`、`src/api/auth.ts` | 已落地 | 用户登录后才读写云端工厂和资源 |
| 网格建造 | `src/components/BuildMenu.tsx`、`src/scene/BuildPlacer.tsx` | 已落地 | 分类、旋转、占地、碰撞、ghost 预览 |
| 物品与配方 | `src/components/ItemPanel.tsx`、`RecipePanel.tsx` | 已落地 | 物品、配方、输入输出端口和生产路线关联 |
| 多楼层 | `src/scene/FactoryFloorSystem.tsx`、`src/components/FloorSwitcher.tsx` | 已落地 | L1/L2/L3 楼层切换、楼层高度和独立布局 |
| L2/L3 工业体系 | `src/game/baseA01.ts` | 已落地 | L2 加工/冲压/绕线/配套，L3 装配/质检/包装/成品缓冲 |
| 传送带与物料流 | `src/game/simulation.ts`、`src/scene/ItemLotMesh.tsx` | 已落地 | 固定步长、离散槽位、背压、物料在途呈现 |
| AGV 导航 | `src/game/agvNavigation.ts`、`src/components/AgvNavigationControl.tsx` | 已落地 | 网格寻路、站点、任务、避让、重规划和仓储控制入口 |
| 无人机跨层运输 | `src/game/droneNavigation.ts`、`DroneNavigationControl.tsx` | 已落地 | L1 停靠，升降到 L2/L3，再走高位环线和输入支线；仿真启动后运行 |
| 仓储控制 | `src/components/WarehouseWorkspace.tsx` | 已落地 | 库位、运输层、物料台账、AGV 和无人机导航控制 |
| 诊断 | `src/game/factoryDiagnostics.ts`、`InspectionPanel.tsx` | 已落地 | 按楼层筛选诊断，展示阻塞、路线、设备和物流问题；页面可滚动 |
| Generative Factory | `src/game/generativeFactory.ts`、`GenerativeFactoryWorkspace.tsx` | 已落地 | 需求解析、候选布局、校验、副本仿真和方案对比 |
| 资源包导入 | `src/game/resourcePack.ts`、`ResourceImportDialog.tsx` | 已落地 | JSON/GLB 拖放或选择、字段校验、模型预览和封面生成 |
| 导入资源用户持久化 | `src/api/resources.ts`、`ImportedResourceController.java` | 已落地 | 资源与用户绑定；同一用户再次登录可恢复，其他用户不可见 |
| 模型预览 | `src/components/Model3DViewer.tsx`、`src/scene/ImportedFactoryModel.tsx` | 已落地 | GLB 归一化、底面归零、预览和设备卡片封面 |
| 视觉检测 | `src/demos/InspectionDemo.tsx`、`src/scene/inspectionDetect.ts` | 已落地 | 独立工作台、相机演示、检测结果和隔离路由 |
| AI 管家与语音 | `src/game/assistantProtocol.ts`、`ai-service/` | 已落地/可选 | 工具白名单、二次校验、ASR/TTS；服务不可用时前端不阻塞 |

## 3. 用户导入资源的真实数据流

```text
建造页面
  → ResourceImportDialog 选择/拖入 project.json + GLB
  → resourcePack.ts 校验并生成 previewDataUrl
  → Zustand 注册资源，立即出现在建造目录
  → 登录态下 POST /api/resources
  → imported_resource(owner_user_id, metadata, project_json, model_blob)
  → 下次同一用户登录 GET /api/resources 并按需 GET /model
```

导入设备放入工厂时，`factory_object.resource_id` 会记录资源 ID。Spring Boot 保存工厂前会检查该资源是否属于当前用户，避免用户通过修改存档引用其他用户的 GLB。

### 支持的导入材料

- 资源定义：`.forgemind-project.json` 或兼容 JSON；字段可覆盖设备名称、编码、类别、占地、尺寸、端口、吞吐量、功率、描述和模型引用。
- 三维模型：`.glb`；前端以浏览器内存 Blob URL 使用，后端以 `LONGBLOB` 保存。
- 封面：由模型预览视角生成 PNG data URL，写入前端资源状态；模型缺失或无法预览时使用设备类型占位图。

## 4. 后端 API 事实表

### 认证

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/auth/register` | 注册用户 |
| POST | `/api/auth/login` | 登录并返回 bearer token |
| GET | `/api/auth/me` | 查询当前用户 |
| POST | `/api/auth/logout` | 注销当前会话 |

### 工厂与资源

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/factory` | 读取当前用户工厂 |
| PUT | `/api/factory` | 校验并保存当前用户工厂结构 |
| GET | `/api/factory/health` | 后端健康检查 |
| GET | `/api/resources` | 当前用户自己的导入资源列表 |
| POST | `/api/resources` | multipart 保存 JSON 元数据、项目 JSON 和 GLB |
| GET | `/api/resources/{resourceId}/model` | 当前用户下载自己的 GLB |

所有需要用户数据的接口使用 `Authorization: Bearer <token>`。资源列表、模型下载和工厂存档均在服务端按用户过滤。

## 5. 数据库迁移

Flyway 迁移位于 `backend/src/main/resources/db/migration/`：

| 迁移 | 内容 |
| --- | --- |
| V1 | 用户、会话、工厂、楼层、物品、配方、端口、设备、连接和仿真快照基础表 |
| V2 | 放宽当前 MVP 的楼层外键约束 |
| V3 | 放宽当前 MVP 的配方/物品绑定外键约束 |
| V4 | 放宽配方端口的物品外键约束 |
| V5 | `imported_resource` 用户资源表，保存资源定义和 GLB 二进制 |
| V6 | `factory_object.resource_id` 资源引用和索引 |

运行态的 `ItemLot`、机器进度、传送带槽位、AGV/无人机当前位置仍在前端仿真运行时，不直接逐 tick 写数据库。

## 6. 运行与验证

```powershell
npm.cmd install
npm.cmd run dev
npm.cmd run build
npm.cmd run sim:smoke
npm.cmd run sim:regression
npm.cmd run generative:regression
npm.cmd run assistant:protocol
npm.cmd run save:regression
npm.cmd run models:validate

cd backend
mvn test
```

完整联调需要 MySQL 8.4、Spring Boot 8080，以及可选的 AI 服务 8000。若数据库或后端未启动，前端仍可使用本地工厂、资源导入预览和本地仿真；资源不会在未登录或后端不可用时伪装成已持久化。

## 7. 仍然属于边界而非承诺

- 当前 Spring Boot 负责结构化存档和资源存储，不是实时仿真服务器。
- 当前 AI 服务通过 HTTP 被前端调用；Redis Stream/Kafka 仍是未来异步部署方案，不是已启用依赖。
- 资源包导入已实现“当前用户私有资源”路径，但还没有公共资源市场、跨用户分享和大文件对象存储。
- 资源封面是浏览器预览视角截图，不是服务端离线渲染农场。
- 高频三维对象可见性、标签遮挡和性能预算仍由自研渲染层与场景组件共同负责，不能把所有渲染状态当作数据库事实。
- `sim:regression`、`assistant:protocol`、`save:regression` 和 `models:validate` 当前通过；`generative:regression` 的候选生成阶段通过，但现有 A-01 调整回归仍可能因没有返回 3 个全部可验证的调整候选而失败，这属于生成器代码边界，不应在发布说明中写成全量通过。
