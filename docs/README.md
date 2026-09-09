# ForgeMind 文档索引

> 更新时间：2026-09-08。本索引用于区分当前事实、权威方案、专题设计、宣传材料和历史归档。

## 首要入口

1. [`../ForgeMind 项目方案.md`](<../ForgeMind 项目方案.md>)：融合版唯一权威方案。
2. [`ForgeMind-用户使用手册.md`](ForgeMind-用户使用手册.md)：面向操作者的完整使用手册（启动、建造、生产配置、物流、仿真、AI 诊断、存档与排障）。
3. [`ForgeMind-当前实现总览.md`](ForgeMind-当前实现总览.md)：当前代码事实和已知边界。
4. [`ForgeMind-功能模块技术文档.md`](ForgeMind-功能模块技术文档.md)：当前模块和代码入口（含自动巡检、硬件套件与 PCB YOLO 实时质检补充）。
5. [`资产与许可审计.md`](资产与许可审计.md)：当前模型资产、来源、许可和验证。
6. [`ForgeCore-融合迁移审计.md`](ForgeCore-融合迁移审计.md)：ForgeCore 能力在融合版中的继承、替代和缺口。

## Forge 模块用户文档

官网“官方文档”页已为以下模块提供独立在线阅读入口，内容只描述当前可用路径，并对预留能力和部署前提单独标注：

| 文档 | 模块 | 定位 | 当前状态 |
| --- | --- | --- | --- |
| `ForgeMind-模块用户文档.md` | ForgeMind | 工作台、建造、生产、仓储、仿真和诊断 | 当前用户指南 |
| `ForgePass-用户文档.md` | ForgePass | 注册、登录、续登、退出和身份边界 | 当前用户指南 |
| `ForgeCloud-用户文档.md` | ForgeCloud | 工作空间、版本、资源、发布、协作和云端事实 | 当前用户指南；工业接入有边界 |
| `ForgeHub-用户文档.md` | ForgeHub | 工业资源、Web CAD、STEP/资源包、装配和当前云端边界 | 本地工作台已接入；云端发布待完成 |
| `ForgeLab-用户文档.md` | ForgeLab | 社区浏览、发帖、附件、互动和通知 | 当前用户指南 |
| `ForgeMove-用户文档.md` | ForgeMove | 微信小程序的移动摘要、任务、库存和监控 | 当前用户指南；需小程序部署配置 |

## 生态技术说明

- [`Forge生态-模块技术文档.md`](Forge生态-模块技术文档.md)：六个 Forge 模块的身份流、职责边界、接口、数据流、权限和验证入口；与两份核心技术/用户文档互相补充，不替代专题实施文档。

## 当前专题文档

| 文档 | 定位 | 维护状态 |
| --- | --- | --- |
| `ForgeMind-后续实施计划.md` | 从当前实现走向工业试点的完整执行计划，包含优先级、阶段任务、依赖、数据/API 演进、验收指标、风险与交付清单 | 当前执行基线；规划项不等同于已实现能力 |
| `ForgeMind-后端数据库设计.md` | Spring Boot/MySQL 数据边界和迁移 | 当前专题 |
| `ForgeMind-旧版PPT与当前实现差异审计.docx` | 对比 2026-08-22 旧版答辩 PPT 与 2026-09-03 当前实现，提供差异矩阵和可直接粘贴的 PPT 文案 | 当前交付文档 |
| `ForgeCloud-统一云平台实施文档.md` | ForgeMind、ForgeHub3D、ForgeLab、ForgeMove 共享云底座的职责、架构、数据模型、权限、API、迁移、分期实施与验收 | 实施基线；V13/V14 已落地，后续对象存储、生产连接器与商业治理仍在实施 |
| `ForgeMind-智能管家工具协议.md` | 助手动作契约与确认门控 | 当前专题 |
| `ForgeMind-智能助手2.0优化方案.md` | 面板调度、多轮任务、主动巡检、记忆和智能助手演进 | 产品与技术规划，尚未代表全部实现 |
| `ForgeMind-视觉检测工作台-设计文档.md` | 独立检测页、状态机和接口 | 当前专题，AI/语音部署以权威方案为准 |
| `ForgeMind-A02与Generative-Factory设计文档.md` | A-02、诊断和候选生成 | 当前专题；候选搜索、副本仿真和 What-if 通过 Web Worker 执行，模型策略以权威方案为准 |
| `daiyu-render-engine.md` | 宝钗渲染层 | 当前专题 |
| `daiyu-intelligence-engine.md` | 黛玉确定性规划与诊断 | 当前专题；确定性内核与 Worker 调度分层 |
| `ForgeMind-Unity原生客户端规划与要求.md` | WebView2 承载原 Web 工作台、Unity 只替换 3D 渲染表面、功能保真矩阵、性能门禁、接口和阶段交付 | U0/U1 工程骨架、模型导入、桥接骨架和基准 Player 已完成；WebView2 宿主、视口合成和性能门禁待完成 |
| `ForgeMind-Unity-WebView2-Unity桥接协议.md` | WebView2 ↔ Unity v1 消息、生命周期、降级和安全边界 | 草案；Web 侧适配器与 Unity 命名管道接收骨架已实现 |
| `ForgeCore-Agent-上游基线.md` | ForgeCore Agent 固定提交、原文件与当前适配位置映射 | 当前专题 |
| `模型与工艺来源.md` | 工艺路线与模型映射 | 当前专题，许可结论以资产审计为准 |
| `high-precision-models.md` | 高精度模型导入记录 | 当前专题，部分许可仍待复核 |
| `../ForgeMove/README.md` | ForgeMind 微信小程序配套生态、运行方式与移动端事实边界 | 当前实现入口；第三方来源见 `../ForgeMove/OPEN_SOURCE_NOTICES.md` |

## Archify 可交互架构图集

- [`diagrams/README.md`](diagrams/README.md)：7 张当前架构、生态边界、运行时数据流、可信 Agent、认证交接、生命周期和启动就绪 HTML 图集；每张图同时保留 JSON 源文件与验证侧车。

## 保留但非权威的资料

- `AI 驱动的智能工厂数字孪生设计与仿真平台项目方案(1).md`：组员版本的原始大方案，保留完整设想，不代表全部落地。
- `ForgeMind-补充设计.md`：早期冲刺与视觉/架构补充，作为设计来源保留；不再单独作为权威方案。
- `ForgeMind-语音控制模块-接入文档.md`：包含曾经的 Ollama 本地链路，作为历史接入记录保留；当前默认部署不使用本地大模型。
- `ForgeMind-宣传片剧本*.md` 与 `video/`：宣传和内容制作素材，不作为产品事实来源。

## ForgeCore 历史基线

`archive/forgecore/` 保存迁移时的逐字节副本：

- `ForgeCore 项目方案（历史基线）.md`
- `ASSET_AUDIT（历史基线）.md`
- `UI美术风格参考与执行规范（历史基线）.md`
- `AGENTS与协作审计（历史基线）.md`
- `assets/ui-style-reference/` 中的 10 张 UI 参考图

这些文件用于追溯旧设计、制作方法和验证记录。后续修改应进入当前 ForgeMind 文档，不直接改写历史基线。

`archive/forgemind-lfs-pointers/` 保存组员融合包中 6 个非运行时 Git LFS 指针的原文；对应完整模型仍由现行物品目录维护。

## 维护规则

- 新功能先更新根方案，再更新事实总览和对应专题。
- 当前代码与文档冲突时，先以代码复现结果为准，再修正文档。
- 资产来源、许可证、文件替换或生成器变化必须进入资产审计。
- 历史文档中的路径、端口和模型策略可能已经失效，引用时必须注明“历史”。
