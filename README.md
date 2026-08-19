# ForgeMind · 智能工厂数字孪生

AI 驱动的智能工厂数字孪生设计、生产路线与仿真平台。项目早期以 1 人 × 7 天为冲刺约束；当前代码已经扩展到多楼层、仓储物流、无人机跨层运输、诊断和用户私有设备资源导入。

## 技术栈

- **前端**：React 18 + TypeScript + Vite + Three.js（React Three Fiber）+ Zustand
- **样式**：TailwindCSS + 自定义设计 token（《明日方舟：终末地》工业机能风）
- **仿真内核**：纯 TS（`src/game/simulation.ts`），与 React/Three 解耦，是唯一真相源
- **后端双栈**：
  - **Spring Boot 3 + MySQL 8.4**（Java 17，`backend/`）—— 用户、工厂结构、物品、配方和用户私有导入资源持久化
  - **FastAPI**（Python 3.10，`ai-service/`）—— DeepSeek / 本地 Ollama AI 编排、工具协议、ASR/TTS 网关

## 快速开始

Windows 推荐直接双击项目根目录的 `start-forgemind.bat`。脚本会先启动并等待 Docker MySQL 健康，再检测并复用 Ollama、BT TTS、AI 服务、Spring Boot 和前端，只为缺失的服务打开终端窗口；启动完成后自动打开 `http://127.0.0.1:5173`。

```powershell
.\start-forgemind.bat                 # 前端 + Ollama + BT TTS + AI 服务
.\start-forgemind.bat -NoBrowser       # 启动但不自动打开浏览器
.\start-forgemind.bat -SkipSpring     # 跳过 Spring Boot 8080（也不要求 MySQL）
.\start-forgemind.bat -SkipMySql      # 跳过 Docker MySQL，适合已有外部数据库
.\start-forgemind.bat -IncludeVoiceChat # 额外启动独立终端语音助手
.\stop-forgemind.bat                  # 停止 ForgeMind 服务，默认保留 MySQL 和 Ollama
.\stop-forgemind.bat -StopMySql       # 停止 MySQL 容器，但保留数据卷
```

如果 BT TTS 不在默认目录 `D:\local\bt7274-space`，可先设置：

```powershell
$env:FORGEMIND_BT_TTS_ROOT = 'D:\local\bt7274-space'
$env:FORGEMIND_OLLAMA_EXE = "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe" # 可选
```

```bash
npm install
npm run dev      # 前端开发服务器 http://localhost:5173
npm run build    # 前端生产构建
```

### 启动后端（可选）

```bash
# MySQL 8.4（Docker）
docker compose up -d mysql

# Spring Boot（端口 8080）
cd backend && mvn package && java -jar target/forgemind-backend-0.1.0.jar

# FastAPI AI 服务（端口 8000，需 Python 3.10）
cd ai-service && py -3.10 -m venv .venv && .venv/Scripts/pip install -r requirements.txt
.venv/Scripts/python -m uvicorn main:app --port 8000
```

前端左侧「⬆ 推后端 / ⬇ 拉后端」按钮可把存档同步到 Spring Boot（后端离线时回退本地 JSON）。

视觉检测工作台是独立页面：开发环境访问 `http://127.0.0.1:5173/inspection.html`，生产构建会输出 `dist/inspection.html`。主界面的“**双臂视觉质检单元**”设备详情已提供检测入口，会在新标签页打开该工作台。它包含虚拟相机取景、OpenCV 检测结果、语音播报状态和合格/异常隔离路由。

数据库表由 Spring Boot 启动时的 Flyway 迁移自动创建，详细表职责见 [后端数据库设计](docs/ForgeMind-后端数据库设计.md)。

## 设计文档

- [当前实现总览（事实索引）](docs/ForgeMind-当前实现总览.md)
- [后端服务说明](backend/README.md)

- [原方案（67 节）](docs/AI%20驱动的智能工厂数字孪生设计与仿真平台项目方案(1).md)
- [补充设计（权威，9 节）](docs/ForgeMind-补充设计.md)
- [A-02 与 Generative Factory 设计文档](docs/ForgeMind-A02与Generative-Factory设计文档.md)
- [功能模块技术文档（当前实现）](docs/ForgeMind-功能模块技术文档.md)
- [宝钗渲染引擎技术文档](docs/daiyu-render-engine.md)
- [黛玉智能工厂思考引擎技术文档](docs/daiyu-intelligence-engine.md)

## 双引擎架构

- **宝钗（Baochai）渲染引擎**：负责高精度模型、材质、动画、批处理、预热、运行时性能预算和三维场景呈现。
- **黛玉（Daiyu）智能工厂思考引擎**：负责从生产需求和当前工厂状态中生成 Recipe Graph、设备配置、可接通布局、物流路线、仿真评估、诊断建议、What-if 和 ROI 方案。

两套能力保持现有代码结构，通过工厂对象、布局和仿真快照协作。`src/engine/daiyu/` 等历史路径暂不改名，仅作为兼容标识；产品正式命名以本文档为准。

## 早期七天里程碑（历史记录）

> 下表保留用于说明项目演进，不代表当前功能边界。当前状态以[当前实现总览](docs/ForgeMind-当前实现总览.md)为准。

| 天 | 能力 |
|---|---|
| Day 1 | Vite + React + TS + Three.js 骨架，网格地面 + 相机 + 终末地 token |
| Day 2 | 网格建造：放置 / 90° 旋转 / 碰撞 / ghost 合法非法高亮 |
| Day 3 | Item / Recipe 定义 + JSON 保存加载（含运行时校验） |
| Day 4 | 仿真内核：固定步长 + 逻辑时钟 + 种子化 PRNG + 机器状态机 |
| Day 5 | 传送带分段模型 + ItemLot 在途运输 + 头堵背压 + Source 产出 |
| Day 6 | 利用率 / 在途 / 产出统计 + 终末地视觉打磨 |
| Day 7 | 演示闭环 + 集成测试 + 修复 |

## 当前增量状态（2026-08-19）

- 新增主界面「生产控制台」（`flow` 视图）：提供工厂俯视地图、设备登记、四段物流流向、产出/消耗统计，以及仿真启动、暂停、倍率和重置操作。
- 网页端语音入口已接入：浏览器麦克风 → 本地 Paraformer ASR → Ollama 智能管家 → BT TTS（Sherpa VITS 备用）；支持手动录音和 `BT` 关键字唤醒。
- 智能管家已接入 `1.0.0` 工具协议。查询、定位和仿真控制可直接执行；重置仿真、修改配方和绑定来料需要用户确认，服务端与前端各做一次动作校验。
- 设备详情面板完成信息分组和机器人工作区交互优化；页面切换、生产地图节点和语音状态加入 Anime.js 动效，并遵守 `prefers-reduced-motion`。
- 新增 A-02 独立工厂场地与「AI 工厂诊断 / Generative Factory」闭环：自然语言需求 → Recipe Graph → 设备估算 → 端口路由 → 碰撞校验 → 副本仿真 → Top 3 方案；已有 A-01 会优先进入 Adjustment Engine，返回当前基线、最小重布线和完整重构三类候选，审核后再应用。
- 生成器已支持产品 Profile：电机与齿轮箱使用不同物品、配方、终端成品和诊断目标；调整候选会显示改造差异、改造成本和 Pareto 等级。
- Generative Factory 已升级为可迭代的生成调整引擎：自动估算并行设备、基于 Beam Search 迭代候选、What-if 对照 CNC / 装配 / AGV 变更，并在候选卡片显示 CAPEX、月度收益、回本期和 12 个月 ROI。
- 生成器默认使用规则解析 + 本地仿真；AI 约束提取可通过 `FORGEMIND_LLM_PROVIDER=deepseek` 切换到 DeepSeek，未配置服务时自动降级，不把 API Key 暴露到浏览器。
- 新增 L1/L2/L3 多楼层工厂：L2 提供加工、冲压、绕线和物料缓冲，L3 提供多输入装配、视觉质检、包装和成品缓冲；楼层高度、切换和独立产线由 `FactoryFloorSystem`、`FloorSwitcher` 与 `baseA01.ts` 协同维护。
- 仓储控制页已纳入 AGV 导航和无人机导航。无人机固定停靠 L1，通过升降井上升到 L2/L3，再沿高位环线和输入支线执行跨层补给；仿真启动后才推进运输任务。
- 建造页支持导入资源包：可拖入或选择项目 JSON 与 GLB，自动校验字段、归一化模型并生成设备封面；资源会写入 `imported_resource`，按用户隔离恢复，其他用户不能列出、下载或引用。
- 工厂存档的设备对象记录 `resourceId`，后端保存时验证资源归属；本地 JSON 存档仍用于离线演示，云端存档负责跨会话恢复。

生产控制台中的「生产效率」当前仍是演示读数；设备利用率、在途物料、产出和消耗以仿真快照为准。

## 模型（内置、公模与用户导入）

- **机械臂**：`public/models/robot_arm_6dof_white.glb`，来自 [cobot-atlas](https://huggingface.co/datasets/torusprime/cobot-atlas)（MIT，2023+ 工业机器人 GLB），1 个 mesh、约 2843 三角形。
- 加载时按补充设计 §2.3 规范化：包围盒居中 → 缩放到 1×1 网格足迹 → 底面落 y=0。
- 传送带 / source 用程序化几何（简单几何体，无需公模）。物品实体仍用 InstancedMesh 前的单盒占位。
- 用户导入 GLB 不直接打包进前端：浏览器端用于预览和当前会话，登录后由 Spring Boot 保存到用户自己的资源记录；再次登录时按需下载并生成 Blob URL。

## 演示脚本（§7.1）

```
1. 「物品」tab 建原料（如「铁板」）和成品（如「齿轮」）
2. 「配方」tab 建配方：铁板×1 → 齿轮×1，时长 1s
3. 「建造」tab 依次放置：
   - 原料源（Source），选中后绑定「铁板」
   - 传送带若干（注意 rotation 方向指向下游；拖拽中右键可锁定转弯并继续追加线路）
   - 通用机器，选中后绑定「铁板→齿轮」配方
4. 右键面板点「启动」，看铁板沿带流动、机器加工、齿轮产出
```

连接语义：每个对象的 `rotation` 即「输出方向」，物品沿它流向 `pos + dir` 那一格的下游对象。Source/机器 → 传送带 → 机器 → 传送带 → 空格（出口）。

## 目录结构

```
src/
├─ game/           # 纯逻辑：类型、网格、仿真引擎、PRNG、方向、存档
│  ├─ simulation.ts    # 仿真引擎（唯一真相源）
│  ├─ SimulationRunner.tsx  # 引擎驱动器（rAF + 低频快照写 store）
│  ├─ grid.ts / dir.ts / rng.ts / item.ts / save.ts / types.ts
├─ store/          # Zustand（低频 UI + 编辑 + 仿真快照）
├─ scene/          # Three.js 场景：画布、网格地面、对象、ItemLot、ghost、交互
├─ components/     # UI 面板：建造/物品/配方/信息/生产控制台/语音入口
└─ utils/          # UI 动效和无障碍降级工具
```

## 集成测试

```bash
npm run sim:regression            # 完整回归：闭环 / 转弯 / 分流 / 汇流 / 头堵
npm run generative:regression     # 生成布局 / 端口连接 / 副本仿真回归
```

也可以单独运行快速检查：

```bash
npm run sim:smoke                   # 闭环验证（Source→带→机→带→出口）
npm run sim:backpressure            # 背压验证（头堵停住不穿透）
```

`sim:regression`、`assistant:protocol`、`save:regression` 和 `models:validate` 是当前稳定回归项。`generative:regression` 的候选生成部分已通过，但 A-01 调整分支仍有“未返回 3 个全部可验证方案”的已知失败，发布前需单独修复生成器调整逻辑。

## 关键设计原则（防翻车）

- **当前运行时真相源在 `src/game/simulation.ts`**，前端内存仿真负责确定性推进；Spring Boot 保存可恢复的静态工厂结构，不逐 tick 接管仿真
- **React 管 UI，Three.js 管渲染**，只在低频层交集；高频仿真实体位置不进响应式 store
- **种子化随机数**，优化结论可复现
- 传送带**离散模型**（槽位 + 头堵背压），不是恒速路径插值
