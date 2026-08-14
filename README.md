# ForgeMind · 智能工厂数字孪生

AI 驱动的智能工厂数字孪生设计与仿真平台。学习答辩项目，1 人 × 7 天，vibecoding 风格。

## 技术栈

- **前端**：React 18 + TypeScript + Vite + Three.js（React Three Fiber）+ Zustand
- **样式**：TailwindCSS + 自定义设计 token（《明日方舟：终末地》工业机能风）
- **仿真内核**：纯 TS（`src/game/simulation.ts`），与 React/Three 解耦，是唯一真相源
- **后端双栈**（可选演进，已建骨架）：
  - **Spring Boot 3**（Java 17，`backend/`）—— 工厂结构/配方 CRUD，JSON 文件存储
  - **FastAPI**（Python 3.10，`ai-service/`）—— 离线 AI / LLM 编排占位

## 快速开始

```bash
npm install
npm run dev      # 前端开发服务器 http://localhost:5173
npm run build    # 前端生产构建
```

### 启动后端（可选）

```bash
# Spring Boot（端口 8080）
cd backend && mvn package && java -jar target/forgemind-backend-0.1.0.jar

# FastAPI AI 服务（端口 8000，需 Python 3.10）
cd ai-service && py -3.10 -m venv .venv && .venv/Scripts/pip install -r requirements.txt
.venv/Scripts/python -m uvicorn main:app --port 8000
```

前端左侧「⬆ 推后端 / ⬇ 拉后端」按钮可把存档同步到 Spring Boot（后端离线时回退本地 JSON）。

## 设计文档

- [原方案（67 节）](docs/AI%20驱动的智能工厂数字孪生设计与仿真平台项目方案(1).md)
- [补充设计（权威，9 节）](docs/ForgeMind-补充设计.md)

## 已实现功能（7 天）

| 天 | 能力 |
|---|---|
| Day 1 | Vite + React + TS + Three.js 骨架，网格地面 + 相机 + 终末地 token |
| Day 2 | 网格建造：放置 / 90° 旋转 / 碰撞 / ghost 合法非法高亮 |
| Day 3 | Item / Recipe 定义 + JSON 保存加载（含运行时校验） |
| Day 4 | 仿真内核：固定步长 + 逻辑时钟 + 种子化 PRNG + 机器状态机 |
| Day 5 | 传送带分段模型 + ItemLot 在途运输 + 头堵背压 + Source 产出 |
| Day 6 | 利用率 / 在途 / 产出统计 + 终末地视觉打磨 |
| Day 7 | 演示闭环 + 集成测试 + 修复 |

## 模型（高精度公模）

- **机械臂**：`public/models/robot_arm_6dof_white.glb`，来自 [cobot-atlas](https://huggingface.co/datasets/torusprime/cobot-atlas)（MIT，2023+ 工业机器人 GLB），1 个 mesh、约 2843 三角形。
- 加载时按补充设计 §2.3 规范化：包围盒居中 → 缩放到 1×1 网格足迹 → 底面落 y=0。
- 传送带 / source 用程序化几何（简单几何体，无需公模）。物品实体仍用 InstancedMesh 前的单盒占位。

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
└─ components/     # UI 面板：建造/物品/配方/信息/仿真控制
```

## 集成测试

```bash
npm run sim:regression            # 完整回归：闭环 / 转弯 / 分流 / 汇流 / 头堵
```

也可以单独运行快速检查：

```bash
npm run sim:smoke                   # 闭环验证（Source→带→机→带→出口）
npm run sim:backpressure            # 背压验证（头堵停住不穿透）
```

## 关键设计原则（防翻车）

- **真相源在后端（引擎）**，前端只做确定性插值渲染，不自己推进仿真
- **React 管 UI，Three.js 管渲染**，只在低频层交集；高频仿真实体位置不进响应式 store
- **种子化随机数**，优化结论可复现
- 传送带**离散模型**（槽位 + 头堵背压），不是恒速路径插值
