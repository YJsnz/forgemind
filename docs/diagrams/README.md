# ForgeMind Archify 架构图集

这是一套基于当前 ForgeMind 代码事实生成的可交互 HTML 图集。每张图的 JSON 是可维护源文件，HTML 是可直接打开、切换主题、查看引导视图和导出的交付物；`visual-check` 生成的 PNG/JSON/HTML 仅用于验证证据。

## 阅读顺序

| 顺序 | 视角 | HTML | JSON |
| --- | --- | --- | --- |
| 01 | 平台架构、服务边界、桌面/CAD 接入 | [打开 HTML](forgemind-atlas-01-platform-architecture.html) | [源 JSON](forgemind-atlas-01-platform-architecture.json) |
| 02 | ForgePass、ForgeMind、ForgeCloud、ForgeLab、ForgeMove、ForgeHub 生态协作 | [打开 HTML](forgemind-atlas-02-ecosystem-boundaries.html) | [源 JSON](forgemind-atlas-02-ecosystem-boundaries.json) |
| 03 | 项目/资源 → 校验 → 仿真/寻路 → 指标/诊断 → 工作台/Agent/云端 | [打开 HTML](forgemind-atlas-03-factory-runtime-dataflow.html) | [源 JSON](forgemind-atlas-03-factory-runtime-dataflow.json) |
| 04 | 可信 Agent：确定性事实、Patch、人工批准、应用后复核 | [打开 HTML](forgemind-atlas-04-trusted-agent.html) | [源 JSON](forgemind-atlas-04-trusted-agent.workflow.json) |
| 05 | 登录、Email OTP/GitHub OAuth、ForgeMind/ForgeHub 会话交接 | [打开 HTML](forgemind-atlas-05-auth-product-handoff.html) | [源 JSON](forgemind-atlas-05-auth-product-handoff.sequence.json) |
| 06 | Agent Run：排队、规划、执行、等待、复核、完成与恢复 | [打开 HTML](forgemind-atlas-06-agent-run-lifecycle.html) | [源 JSON](forgemind-atlas-06-agent-run-lifecycle.lifecycle.json) |
| 07 | MySQL、Spring Boot、AI Gateway、前端入口的启动就绪与降级 | [打开 HTML](forgemind-atlas-07-startup-readiness.html) | [源 JSON](forgemind-atlas-07-startup-readiness.workflow.json) |

## 证据边界

平台架构图的代码引用固定在仓库 `https://github.com/YJsnz/forgemind.git` 的提交 `46e2761cc45ed1be85826f60196225b0e6bef3a6`，并由 Archify 使用 `--repo-root D:/Code/factory` 做路径存在性验证。当前工作区中尚未进入该提交的 GPU/TensorRT 等增量能力不伪装为该固定提交的源代码事实；相关当前状态仍以根方案和实现总览为准。

图集明确保留三条边界：

- 确定性仿真、寻路、碰撞、物料守恒和指标不由大语言模型决定。
- AI Gateway、语音、视觉和 GPU 加速是可选能力，默认规则模式不能被它们阻断。
- ForgeHub、ForgeLab、ForgeMove 是生态产品表面；真实工业 OPC UA/MQTT、时序引擎、设备控制和生产级遥测仍按项目方案标记为后续能力。

## 验证

所有 7 张图均使用 `quality_profile: showcase`，完成结构检查、布局/关系检查和 Chrome 多视口 `visual-check`；关键 1440×900 浅色截图已进行实际目检。
