# ForgeMind 当前实现总览

> 更新时间：2026-09-07
> 本文是当前代码的事实索引。产品方案、演示脚本和研究性文档中的“目标架构”不应覆盖本文对已落地行为的描述。
> 2026-09-02 审计修复：Agent 服务端已区分机器定义与用户导入资源的归属校验；项目存档 API 执行嵌套结构校验；机器开放输出端保持产物并形成背压；登出清除用户私有机器定义；矩形机器端口按占地深度迁移。

## 1. 项目边界

ForgeMind 是一个 React + Three.js 的数字工厂编辑、生产路线和仿真前端，配套两个可选服务：

| 层 | 代码位置 | 当前职责 |
| --- | --- | --- |
| 前端应用 | `src/` | 页面、工厂状态、编辑器、三维场景、生产路线和浏览器内确定性仿真 |
| Spring Boot | `backend/` | 登录会话、用户工厂存档、物品/配方/设备布局和用户导入资源的 MySQL 持久化 |
| AI 服务 | `ai-service/` | 离线 LLM 编排、工具协议、ASR、TTS 和视觉检测辅助；不进入仿真 tick 链路 |
| 自研渲染层 | `src/engine/daiyu/` | 静态模型批处理、传送带批处理、Panda/嵌入模型和运行时渲染预算 |
| ForgeHub Web CAD | `forgemind-resource-hub/` | 本地资源库、参数化 CAD、OCCT B-Rep、STEP/资源包、装配和工程检查 |

当前仿真逻辑仍由 `src/game/simulation.ts` 驱动。Spring Boot 保存的是可恢复的工厂结构，不是每一帧的 `ItemLot`、AGV 或无人机坐标。

### 官方文档与模块文档（2026-09-02）

官网 `/docs` 官方文档页现在提供两份核心文档、六份 Forge 模块用户文档和一份生态模块技术文档的在线阅读，并提供统一的 `public/docs/ForgeMind-官方文档.pdf` 汇总下载。模块文档分别覆盖 ForgeMind 工作台、ForgePass 统一身份、ForgeCloud 云端控制台、ForgeHub 工业资源/CAD 工作台、ForgeLab 开源社区和 ForgeMove 微信小程序；`docs/Forge生态-模块技术文档.md` 汇总身份流、接口、权限和跨模块验证。ForgeHub 本地资源与 CAD 能力已经落地，但 ForgeCloud 直接发布、公共市场、Fork/依赖治理和多人 PDM 尚未完成；ForgeCloud 的真实工业协议/设备执行器等能力仍有限制，ForgeMove 不替代 Web 三维工作台，ForgePass 只负责统一身份。

### ForgeHub 工业资源与 Web CAD（2026-09-07）

同仓新增 `forgemind-resource-hub/` 独立 Vinext 应用，包含工业资源库、参数化草图/实体/曲面建模、OCCT/WASM B-Rep 重建、STEP 与 CAD/资源包交换、持久拓扑、特征历史、装配配合、工程检查、本地建模 Agent 和浏览器项目恢复。根门户 `/forgehub` 继续承担统一入口：每次点击先显示 ForgePass，登录成功后才通过 URL fragment 交接会话；ForgeHub 立即清除 fragment 并调用 Spring Boot `/api/auth/me` 复核，根布局保护所有 ForgeHub 路由。ForgeHub 首页顶栏右侧提供“返回 ForgeMind”按钮，按当前主机名回到 5173 端口的门户首页。子项目内置 13 个 GLB 并全部列入“外观参考模型”选择器，构建产物保留对应文件；这些 GLB 是 ForgeHub 自己的只读显示资产，不复制进 ForgeMind 主站模型目录，也不替代 OCCT B-Rep。根完整启动器默认在 `127.0.0.1:3000` 启动 ForgeHub 并纳入健康门禁。当前跨产品数据链路仍是显式文件交换，未直接接入 ForgeCloud 资源发布 API；工业模型许可延续“本地开发/教学/演示、公开与商业再分发前逐文件复核”的边界。

本轮同步 `codex/forgehub-precision-cache-upload`：八类内置资源现在由 `core/resource/HighDetailResourceCad.ts` 维护精度 CAD 文档，采用 `cad-resource-<resourceId>-precision-v2` 稳定 ID；路由按需生成并将序列化设计数据写入 session/local storage，内存原型深拷贝后再交给工作区，避免重复重建与编辑串改。`CadRoute` 对普通 `/cad` 显示空白自由建模项目，项目列表在下拉框聚焦/点击时懒加载，并在恢复/列举时清理旧版 `B-Rep`、资源组合别名而不触碰用户自建项目；资源项目可切换可编辑 B-Rep 与高精细参考显示。新增/更新的高精度资源、存储清理和 OCCT 合法性回归均纳入 ForgeHub `npm.cmd test`。

wzh 账号现有一份可直接加载的 `WZH 三层轻量完整产线` 正式存档（项目 ID `4565d66f-7144-4c23-9b75-94a521456082`）：共 39 个对象，三层各一条短工艺线，包含 2 台 AGV、2 架跨层无人机、真实有限货架、存取站和入/出货边界。固定种子 600 秒仿真实际消耗 196 件钢制毛坯并交付 58 件已检成品，Agent 审计为 0 个阻塞性问题。该存档是账号数据，不作为新建空白工厂的默认注入模板。

### ForgeLab 开源社区（2026-08-31）

新增 `/forgelab` 门户子站，导航位于 ForgeHub 右侧，使用 `Orbit` 表达社区连接。ForgeHub、ForgeCloud 与 ForgeLab 统一进入 ForgePass 身份入口，复用现有工作台登录接口、会话令牌和后端 `me` 校验；一个 ForgePass 账户认证后可访问三个产品，旧 `/forgelab/login` 仅兼容映射到 ForgeLab 入口，不再使用独立 ForgeLab 登录页。页面包含工厂存档开源、模型资源开源、布局经验分享、设计经验分享和设计者公告五个板块，提供搜索、板块筛选、示例帖子流和许可/复现原则提示。社区页已移除独立顶部横栏，直接进入内容区；首屏桌面端将 ForgeLab Logo、标语简介与“发布帖子”入口横向排布，移动端自动改为纵向阅读顺序；主视觉的“发布帖子”按钮打开 `fl-composer` 弹窗，支持板块、标题、摘要、正文、AI 润色提示词、图片及工厂存档/资源包附件；发布成功时由后端保存帖子和附件，后端不可用时才回退到当前会话缓存并明确提示，原侧栏/原则卡发布按钮已删除。六条初始帖子和回复已通过 Flyway `V11` 写入 MySQL，初始点赞数通过 `V12` 作为可追溯种子计数保存；帖子与附件可通过 `/forgelab/post/:id` 进入独立文章页，文章页展示完整正文、作者、统计、相关帖子和附件下载按钮。`V10` 建立 `forgelab_post`、`forgelab_attachment`、`forgelab_reply`、`forgelab_post_like`、`forgelab_reply_like`、`forgelab_notification` 六张表；`ForgeLabController` 提供帖子列表/详情、multipart 发帖、附件下载、帖子/回复点赞、回复发布和通知已读接口，所有写操作复用 `app_user` 账号边界。页面通过 `ForgeLabIcon` 统一使用 Morphicons，左下角挂载 `EmotionBallHero`；右侧 ForgeLab 工厂助手优先调用现有 `requestAssistant` 本地规则/可选 AI 链路，网络或服务不可用时回退到社区问题的确定性回答。主门户同时在 `ForgeMindIntro` 中提供 16 模块产品能力地图、在线文档阅读器和 `/docs/ForgeMind-官方文档.pdf` 汇总下载入口，页脚提供产品、文档、ForgeHub、ForgeLab、GitHub 与联系合作入口。

### ForgeMove 微信小程序（2026-09-01）

`ForgeMove/` 是新建的原生微信小程序配套入口，当前包含登录/演示模式、工厂总览、生产线监控、移动任务、物料库存、ForgeLab 移动社区、工厂档案详情和个人设置 8 个页面。它复用 `/api/auth/*`、`/api/factories`、`/api/v1/mobile/summary`、`/api/v1/tasks` 和 `/api/forgelab/*` 的 Bearer 会话边界；在线时读取统一云端移动摘要并创建/更新现场任务，在线接口不可用时回退到明确标记的离线演示数据。小程序不直连 MySQL，不执行 Agent Patch，不将移动端摘要冒充三维或逐 tick 运行事实。

视觉实现借鉴 Gitter 的项目卡片、分段信息流和档案详情交互，但未直接复制其 Taro/Taro UI 运行时；ForgeMove 采用原生 WXML/WXSS/JavaScript，主题使用 ForgeMind 的深色设备面、琥珀警示和青绿运行信号。动效以 CSS 入场/状态脉冲为默认，第三方 TDesign MiniProgram、WeUI WXSS 和 lottie-miniprogram 的来源、版本和接入边界见 `ForgeMove/OPEN_SOURCE_NOTICES.md`。

### ForgeCloud 统一云平台控制台（2026-09-02）

ForgePass 统一身份入口已接入 ForgeHub、ForgeCloud 和 ForgeLab：三个产品共用 `src/components/ui/auth-fuse.tsx` 提供的密码登录/注册、邮箱验证码登录和 GitHub OAuth 登录界面，并由 `src/components/ForgePassPage.tsx` 适配 `/api/auth/login`、`/api/auth/register`、`/api/auth/email/send-code`、`/api/auth/email/login`、`/api/auth/github/*`、`/api/auth/me` 会话。一个 ForgePass 账户认证后按原入口进入对应产品；首次邮箱验证码或 GitHub 登录会创建账户，已存在的身份则回到原 `user_id`。V33 保存身份绑定、邮箱挑战和一次性 OAuth 兑换码，SMTP/GitHub 未配置时接口明确返回不可用。手机号腾讯云短信通道仍保留在后端，但当前前端默认隐藏。旧 `/forgelab/login` 仅映射到 ForgeLab 入口，不再渲染独立 ForgeLab 登录页。未登录时不请求 ForgeCloud workspace 快照或数据库状态。

> V19 状态：在项目/资源/协作/审批/设备/数据/AI 基础和 V17/V18 交付之外，ForgeCloud 已将审计事实通过 Outbox 幂等消费到统一活动流，记录失败重试与错误摘要，按 workspace 成员过滤查询，并在数据库状态板显示事件队列；生产级工业接入和公共资源治理仍未完成。

> V20 状态：项目版本、工作任务和审批请求已支持客户端幂等键；服务端数据库唯一约束和重复提交回读均已通过真实 Docker/MySQL 回归，移动端任务请求也会携带幂等键。

> V21 状态：资源当前版本已保存 `manifestVersion=1` 和结构化许可证/依赖信息；公开资源没有 SPDX、表达式或明确声明时由服务端拒绝，ForgeCloud 资源表显示许可证摘要。

> V22 状态：资源版本支持历史列表和不可变版本创建；服务端只新增 `cloud_asset_version`、原子切换当前版本，返回 manifest、哈希、创建人、说明和文件数量，并通过 `clientMutationId` 防止重复创建。资源所有者或工作空间管理员才可创建版本。

> V24–V25 状态：运行事件补齐来源、外部事件 ID、Twin/Data Point 上下文、单位、质量和隔离字段；新增确定性遥测窗口聚合、运行工单、质量结果和维护记录 API/控制台工作区，并以 V25 唯一约束保证同一 workspace 的外部事件去重。当前仍不接入真实 OPC UA/MQTT、专业时序引擎或设备执行器。

本轮追加的可操作闭环：项目页按当前 workspace 创建空白项目，资源页登记元数据与 v1 manifest，发布页发布当前版本，任务/连接/设备/孪生/数据点/AI 页调用真实创建或状态接口，通知按钮读取并清理真实未读通知。

本轮继续追加：项目行可提交当前存档为新版本并查看/发布评论，设备页可写入真实心跳，数据点页可写入明确标注的手动遥测事件，审计页可导出当前 workspace 的真实 CSV；项目版本仍由服务端基线冲突门禁保护。

本轮 V24–V25 追加：新增“运行与质量”页面，读取运行事件、遥测窗口、工单、质量结果和维护记录；支持窗口聚合、工单状态推进及质量/维护登记，所有写入绑定 workspace 并保留操作审计与幂等边界。

本轮 F3 追加：V16 启用项目级角色授权（manager/editor/viewer），项目列表、版本提交、发布、评论和项目任务均由服务端校验；新增统一审批请求/行动记录，任务与审批页提供真实的发起、批准、拒绝和要求重新规划动作。

本轮 F5 追加：ForgeMove 任务页从移动摘要 API 同步审批记录并调用受服务端权限保护的批准接口；Data Cloud 数据点列表读取最近真实遥测事件的值、质量码和发生时间，不再只显示静态数据点定义。

本轮 AI Cloud 追加：`rule` 模型任务支持由服务端显式执行，状态经过 `queued → running → completed/failed`，结果、失败原因和审计事件写回数据库；该执行器只读取已授权工作空间/项目的事实摘要，不替代 ForgeMind 的确定性仿真、碰撞、库存和 Patch 审批。

本轮 ForgeCloud AI 控制面追加：AI 页面新增“上下文开关”区域，可分别控制对话上下文、当前项目记忆、用户偏好和 RAG 检索；开关写入浏览器本机策略并实际影响助手请求，实时工厂事实仍不可关闭。页面同时读取 AI 服务只读控制面，展示 `ollama / qwen2.5:7b` provider/model、模型与语音就绪状态、30 个工具、30 日服务质量指标、product/process/runtime/user_memory 四类 RAG 来源、检索方法/向量维度和确定性事实边界。控制面只返回元数据和来源目录，不返回文档正文、用户问题、业务行或密钥；RAG 关闭时网关不返回文档证据。

本轮 RAG 知识库追加：AI 页面新增可读知识库，系统内置的产品/方案文档通过 AI 服务白名单接口按文档读取正文；当前工作空间可新增标题、分类、来源和正文，支持搜索、分类筛选、阅读和归档。知识条目落库于 V31 的 `assistant_knowledge_document`，按 workspace 成员隔离并写入 AI Cloud 审计；助手请求会同步当前账号可访问的工作空间知识并纳入 RAG，动态库存、坐标、产量和仿真数字仍禁止写入。

本轮 Asset Cloud 追加：资源创建可选上传文件本体；服务端使用默认本地对象存储适配层计算 SHA-256、按资源版本保存 Blob 元数据并提供鉴权下载，重复哈希不会重复登记；MinIO/S3 仍是部署适配项。

本轮 V22 追加：资源页可读取当前资源版本并创建新版本；版本表单默认带出当前 manifest，服务端执行 manifest/许可证治理、历史版本保留、当前指针切换和写入幂等。旧版本不会因资源升级而被覆盖，文件本体继续绑定创建版本后的当前版本。

新增 `/forgecloud` 控制台，入口位于 ForgeMind 官网导航与页脚。产品目标定位为 **ForgeCloud — Industrial Intelligence Cloud**，由 Project Cloud、Device Cloud、Twin Cloud、Asset Cloud、Data Cloud、AI Cloud 六层能力构成；当前代码已落地 Project/Asset Cloud 兼容投影、协作/发布/任务/审计、资源 Blob 本体上传/鉴权下载、只读连接基础，以及 Device Cloud 设备注册/心跳/命令队列、Twin Cloud 孪生状态、Data Cloud 数据点/遥测事件和 AI Cloud 规则模型/任务队列与服务端确定性执行基础。完整生产能力仍在路线图中。界面按“工业控制平面 × 版本账本”方向实现工作空间选择器、云端内部导航、项目与版本、资源注册表、发布中心、工业连接、任务与审批、设备、孪生、数据、AI、成员权限、活动审计和平台健康；已在 ForgeCloud 控制台外层复用官网级生态导航，ForgeCloud 当前项高亮，“进入工作台”可返回统一工作台入口；其下不重复放置产品启动器，内部品牌栏使用同一透明 Logo 资源裁出的图案与原始下方字标横向组合，不再显示带底色或边框的图片盒子；首页改为当前工厂/云端资源状态主板、按配方定义的产物账本、Cloud API 健康、独立数据库运行状态板、其下可按关键词和表类型筛选的数据库表元数据目录、六层云能力矩阵和工作空间资源索引。控制台使用 `src/components/ForgeCloudConsole.tsx` 与 `src/forgecloud.css`；挂载 `src/api/forgeCloud.ts` 后优先请求真实 `/api/v1` 工作空间、项目版本、资源、通知、成员、发布、任务、连接器、设备、孪生、数据和 AI 数据，并调用 `/api/v1/workspaces/{id}/database-status` 展示 MySQL 引擎/版本、schema、Flyway、表数、容量、连接使用量、探针延迟和安全的表元数据，不返回数据库密钥或业务行内容；工作空间选择器支持真实列表、切换、创建，成员页支持管理员邀请已注册账号和调整非所有者角色，项目页支持按当前 workspace 创建空白项目，资源页支持可选文件上传，发布页支持将当前版本写入不可变发布记录，任务/连接/设备/孪生/数据点/AI 页支持真实创建或状态回写，成功后刷新快照。后端不可用时回退到明确标记的 `DEMO DATA / LOCAL SHELL`。后端 V13–V17 已建立 ForgeCloud 工作空间、成员、项目版本、资产版本、Asset Blob、发布、任务、评论、只读连接器、运行事件、设备、孪生、数据事件、AI 任务、通知、审计、Outbox 和统一审批基础表；已支持项目版本提交、`409 VERSION_CONFLICT` 乐观并发保护、移动摘要、项目级角色与跨工作空间服务端隔离。设备命令默认只进入 `pending` 审计队列，AI 默认使用确定性规则模型，不直接控制设备或替代 ForgeMind 验证。当前仍未完成 MinIO/S3 部署适配、公共资源市场、依赖/许可证/Fork manifest、真实 OPC UA/MQTT 客户端、时序数据引擎、设备控制执行器、远程模型供应商路由和生产级移动离线队列，不得宣称全量商业云平台已完成。四个产品 Logo 已分别接入 `public/brand/forgecloud-logo.png`、`ForgeMove/assets/brand/forgemove-logo.png`、`public/brand/forgelab-logo.png` 和 `public/brand/forgehub-logo.png`。

当前 ForgeCloud 右上角账户菜单提供成员与权限入口和“退出登录”操作，退出会清除 ForgePass 会话并回到认证入口。

ForgeCloud 设备、孪生和数据页现在会读取当前项目存档详情并建立轻量投影：设备页展示存档中的生产设备、仓储设备和 AGV/无人机对象；孪生页展示整厂孪生和按楼层拆分的产线孪生；数据页展示对象数、生产设备数、物流段数、车辆数、楼层数和配方数等结构数据点。若工作空间已有云端设备、孪生或数据点登记，则优先展示云端记录；只有没有登记记录时才展示 `archiveSource` 存档投影，并明确标记为确定性快照/仿真结构数据，不写入云端设备账本、不伪造现场心跳或实时遥测。

ForgePass 登录页现使用 `public/brand/forgepass-logo.png` 作为统一品牌标志，放在认证表单上方且不占用右侧插画区域，桌面端不裁切，移动端按表单列宽度缩放；左上角保留“返回 ForgeMind”按钮。

官网主页已移除独立的“Forge Ecosystem / One Loop”产品串联区，保留顶部生态导航与 Footer 的直接产品入口。

官网主页 Footer 品牌块仅保留 ForgeMind 标识与必要导航，不再展示宣传标语、运行状态标记或社交图标。

官网主页 Footer 左侧品牌列现以 ForgeMind 为首，纵向展示 ForgeCloud、ForgeHub、ForgeLab、ForgeMove 四个生态品牌；各行使用图案、产品名和英文副标的统一锁定结构。

Footer 品牌图案按素材底色分别处理：ForgeMind 的透明底深色图案在深色背景上使用高对比单色显示，其他黑底白图案以无边框混合方式显示；品牌列与右侧导航列独立顶对齐，避免品牌列高度影响其他列。

Footer 主体已使用显式品牌、产品、文档、社区、合作五区域网格，并在响应式断点中保留品牌区域，避免品牌列被折叠为空白或被导航列占用。

Footer 的产品、文档、社区、合作区域均为独立纵向列，栏目标题和各入口按层级逐项排列，不再横向挤成一行。

### 渲染目标帧率

顶部设置提供 `60 FPS` 和 `120 FPS` 两档本机渲染目标。60 FPS 档保留更多阴影和像素预算；120 FPS 档针对大场景更积极地调节 DPR、动态阴影和运行时更新，同时保持当前可见设施的原始模型细节，不改变仿真逻辑。选项保存在浏览器本机，不写入工厂存档；120 FPS 仍是目标档位，不对所有视角、分辨率和硬件状态作稳定承诺。

### 交互图标动效（2026-08-31）

状态切换图标接入 `morphicons` React 绑定，并与 `lucide` `1.31.0` 图标数据保持同版本：Agent 的分析/完成/失败/待审批、顶部帮助/设置开关、工作区导航和仿真启动/暂停/重置，以及官网门户的顶部导航、主 CTA、产品能力卡、文档/ForgeHub 入口和页脚入口，均通过 `MorphingIcon` 使用可中断的 SVG 形变与弹簧动效。主门户额外通过 `PortalMorphIcon` 为可交互入口提供悬停/触控形变，并在 Hero 下增加 `SPACE → FLOW → SIGNAL` 信号链；静态品牌、设备模型和数据图表不强行动画。组件默认遵循系统减少动效偏好，不改变业务状态、仿真时钟或 WebGL 渲染路径。

### 按需渲染与阴影缓存（2026-08-24）

画布在「仿真运行、建造放置、登录推镜或视图切换相机转场」之外一律切换为 `frameloop="demand"`：暂停且镜头静止时不再每帧重绘同一画面，由失效器桥接工厂状态变化与指针/滚轮交互出帧（含约 320ms 阻尼收尾宽限）。阴影贴图关闭 `autoUpdate`，仅在场景内容 revision 变化（数量/楼层/阴影开关/DPR）或仿真运行时重绘——相机移动不触发，因为阴影在光源空间。两项优化在稳态下像素级一致，不改变任何模型精度、材质或光照效果。
大场景仿真进一步使用 demand loop，由 `RunningFrameScheduler` 跟随 60/120 FPS 目标档驱动呈现；仿真逻辑仍按真实时间独立推进，车辆通过渲染插值保持连续移动。超过 120 个对象时快照提交降为 5Hz，降低 React/store 重渲染压力；小场景仍按原连续帧和 20Hz 快照运行。选中态脉冲只为实际选中对象挂载帧回调，不再让全部场景对象每帧检查选中状态。

高密度运行态的物料平滑移动、端口呼吸灯和设备状态灯采用共享帧调度器：`ItemLotMotionTicker`、`PortMarkerPulseTicker`、`RuntimeDetailSignalTicker` 分别集中更新仍在屏幕中的对象引用，保留原有动画频率、模型、材质和尺寸，减少 500+ 物料/端口/状态灯各自注册 `useFrame` 带来的回调分发与 GC 压力。

### 启动资产与硬件加速边界（2026-08-26）

启动链路已移除工业 GLB 的模块级全量 `useGLTF.preload`：`DaiyuStaticModelBatch`、传送带批处理、设备模型、正式传送带和导入工厂模型均改为实际挂载时加载；空对象时不挂载对应批处理组件，避免空白电梯页解析、上传和编译无用模型。登录电梯页只有在内存中确有工厂对象时才允许后台预热，空白启动不主动唤醒 Panda。

浏览器端三维画布固定由 Three.js/React Three Fiber 的 WebGL 路径负责；普通 Web 构建不探测 Unity 桥接，即使浏览器环境存在同名对象也不会切换渲染器。Windows 微端使用 `build:desktop` 构建标记，只有桌面 WebView2 构建才协商 Unity 原生桥接；Unity 未返回 `bridge.ready` 时保留 WebGL，ready 后才由 Unity 独占三维表面。CUDA/cuDNN 不会直接加速浏览器 Draw Call、GLB 解析或 Three.js 光栅化，只适用于显式配置 GPU 后端的 Python/YOLO 等推理服务，且不应成为前端启动门禁。Unity 与 WebGL 共用 v6 存档、模型资源、楼层/坐标/端口语义，Unity 还需完成真实存档的全对象视觉核验后，才能声明三维内容等价。

当前首帧预算对中等规模场景仍保留原有 DPR 与阴影；只有 `PerformanceMonitor` 观测到帧时间超预算时才动态调节像素预算或阴影，近景和选中对象不因静态对象数阈值被降质。超过 120 个对象的大场景继续采用更保守的初始 DPR。该策略只改变表现层采样和阴影，不改变模型文件、仿真数据、寻路或物料结论。

### 500+ 对象精细模型预算（2026-08-26）

500+ 压测不再使用会改变工业外观的彩色方块代理。当前可见对象继续走原始精细模型与既有静态/传送带批处理；静态设备和传送带批次按 18m 空间单元拆分，每个单元仍使用原始几何、材质和纹理，使屏幕外单元可以独立进行视锥裁剪。大场景主要通过高性能 GPU 上下文、按需呈现、阴影缓存和可见性裁剪控制负载。开发环境可用 `?daiyuStress=500&daiyuPerf=1` 生成 500 个不写入存档的压力对象，并显示 GPU Renderer、FPS、p95 帧时间、draw calls、三角形、纹理和运行预算。该压力入口用于暴露真实高模负载，不以降低模型细节换取虚假的 120 FPS；实际结果仍需在目标电脑和浏览器中记录。

### 大场景楼层与车辆运行优化（2026-08-24）

`src/game/simulation.ts` 的 AGV 地面寻路按车辆所在楼层过滤设施与动态车辆，避免三层对象在二维 A* 中互相封路；严格安全包络找不到路线时，在同层、保留真实设施占用和动态车辆避让的前提下使用零额外网格缓冲兜底。WZH 当前 581 对象存档实测 6 台 AGV 均能生成路径并移动。`src/scene/FactoryCanvas.tsx` 的只读上下文楼层改用轻量轮廓模型且停止上下文动画，当前编辑层仍使用原始高精度模型、交互和运动；这只影响上下文表现层，不改变存档、仿真或当前层模型。

### 客户端路线（2026-08-31）

浏览器 Web 端继续保留完整工作台，并固定使用 WebGL 三维画布。Windows 客户端采用带 `FORGEMIND_DESKTOP=1` 标记的 WebView2 构建加载同一套 React 页面和业务代码，官网、认证、项目、工厂编辑、生产资料、物流、仿真、Agent、自动巡检、生成式工厂、Patch、视觉检测和 AI/语音不再复制到另一套原生 UI；仅桌面客户端在 Unity `bridge.ready` 后将中心三维渲染表面切换为 Unity，WebGL 作为握手期间/原生失败时的桌面降级。Web 仍是业务状态和权限事实源，Unity 只接收场景/快照投影并回传选择、镜头和渲染状态。

Unity 当前已创建 `unity-client/` 工程，并已完成 Tuanjie 项目导入、Runtime/Editor 脚本编译、glTFast `6.16.1` GLB 导入验证、工业 GLB/ForgeCore 物品模型同步、静态存档对象投影、楼层显隐、动态物料/载具快照投影、对象选择命中代理、镜头同步、Windows Player 构建和桌面宿主启动。`desktop-host/` 使用标准 WebView2 Controller 加载同一套 Web dist；由于窗口式 WebView2 的内部合成层会覆盖跨进程子窗口，Unity 改为归属于 ForgeMind 主窗的原生覆盖窗口。Web 通过独立的连续矩形渲染槽发送 `viewport.rect`：标题和楼层留在左侧信息带，导航与状态留在底带；侧面板出现时槽位自动从对应方向收缩，全屏业务工作区或对话框出现时 Unity 隐藏，不再通过 `SetWindowRgn` 挖出多个白色孔洞。桥接使用独立的“Web→Unity 命令管道”和“Unity→Web 事件管道”转发场景、快照、楼层、选择和镜头消息，避免大场景 JSON 阻塞宿主或 Unity 读写互相等待。桥接字符串 JSON 已改为正确转义；Unity 早于工厂页面启动时，后续 `bridge.start` 会通过 `bridge.ping` 强制重报 `bridge.ready`，避免页面错过首次事件后继续显示 WebGL。Web 识别 ready 后实际卸载 WebGL Canvas；场景全量消息只在结构存档变化时发送，不再随视口/仿真刷新反复销毁 581 个对象。Unity 空工厂基底已按 Web `GridFloor` 重建 `50×34m` 高对比程序化纹理地面、双面 1m/5m 网格、黄色边界、8 个功能分区及 AGV 通道；镜头同步直接按 Web 世界坐标定位并朝向目标，运行时会自愈缺失的相机控制器和目标节点。宿主同时自动启动/复用本地 Spring Boot 8080，失败时恢复 WebGL。2026-08-31 真实桌面运行日志已确认 D3D12/RTX 4060、581 个对象接收并完成 581 个对象投影；空场景稳定约 120 FPS（120 FPS 设置档位），GPU 帧时间通常低于 1ms。当前仍需完成真实登录存档的全对象视觉核验、源站/质检组合模型、端口/标签的完整交互回传和 S-03 性能门禁，不能把当前包写成三维全量等价或 500+/120 FPS 正式验收通过。当前实施计划见 [`ForgeMind-Unity客户端-重建计划.md`](ForgeMind-Unity客户端-重建计划.md)，架构与验收要求见 [`ForgeMind-Unity原生客户端规划与要求.md`](ForgeMind-Unity原生客户端规划与要求.md)，桥接字段见 [`ForgeMind-Unity-WebView2-Unity桥接协议.md`](ForgeMind-Unity-WebView2-Unity桥接协议.md)。

### Agent 可信边界与指标口径（2026-08-29）

- `FactoryAgentWorkspace` 的诊断、方案、应用后复核和分支比较均不在浏览器主线程执行；从既有诊断生成方案时复用已完成的分析结果，不重复计算完整诊断。诊断结果先行展示，服务端同步审计作为后台非阻塞任务执行，单独显示进度/成功/失败，不覆盖“分析完成”、不禁用后续操作；审计失败时保留本地确定性诊断。Worker 可取消，方案阶段 20 秒、通用分析阶段 120 秒超时；Worker 不可用时才退回异步确定性执行。
- Agent 后端创建运行时重新读取用户当前项目并校验浏览器上下文版本；结构工具从服务端存档取数。历史存档若含当前客户端加载时会淘汰的旧字段，首次审计收到上下文不一致后会把当前 v6 规范化工作区快照同步到同一正式项目并自动重试，避免刷新后仍反复出现无效警告；真实同步失败仍单独显示。浏览器提交的 Finding/指标只作为确定性仿真证据展示和审计输入，Patch 在生成与应用两阶段都由 `AgentPatchValidator` 深层校验。
- Patch 应用/回滚使用项目行锁、版本指纹和资源归属检查；允许的改变仅包括注册过的配置更新、对象移动/新增/删除和有限货架库存调整，真实设备控制不在 Web Agent 权限内。
- 指标口径：`wip` 是在途批次数，`inventoryTotal` 是仓储库存件数，`averageTransportSec` 是已完成车辆趟次的平均运输秒数；没有现场接入时统一标注为确定性仿真证据。
- 运行指标当前仍由前端确定性仿真产生，服务端不会伪造“已重跑仿真”的结论；若运行证据不足，Finding 必须降低置信度或标记为需更多样本。
- Agent API 请求有 20 秒超时并保留本地结果；SSE 断线自动退避重连，同时由 2 秒状态轮询兜底。

## 2. 已落地功能矩阵

| 能力 | 主要入口 | 状态 | 说明 |
| --- | --- | --- | --- |
| 登录与用户隔离 | `src/store/auth.ts`、`src/api/auth.ts` | 已落地 | 用户登录后才读写云端工厂和资源 |
| 官网门户 | `src/components/ForgeMindIntro.tsx`、`src/components/EmotionBallHero.tsx`、`src/forgemind-intro.css`、`public/emotion-ball/` | 已落地 | 展馆式 Hero、原 Emotion Ball SVG 运行时（32 状态、视线跟随、点击自旋、表情巡演与彩带/庆祝特效）、A-01 工厂预览角标、产品介绍面板、用户/技术文档入口和 ForgeHub 预留接口；已移除原表情陈列墙内容 |
| 网格建造 | `src/components/BuildMenu.tsx`、`src/scene/BuildPlacer.tsx`、`src/scene/GhostPreview.tsx`、`src/scene/FactoryObjectMesh.tsx` | 已落地 | 分类、旋转、占地、碰撞；建造 ghost 复用真实建筑/滚筒模型，并显示接口方向标记和无接口建筑前向箭头 |
| 生产资料工作区 | `src/components/FactoryCatalogWorkspace.tsx`、`src/App.tsx` | 已落地 | 底部“生产资料”入口统一承载机械制造、物品详情和货物仓储；页面顶部提供三项子导航，生产路线保持独立入口 |
| 生产控制台 | `src/components/ProductionWorkspace.tsx`、`src/production.css`、`scripts/production-map-stability-regression.mjs` | 已落地 | 地图全览、设备详情、物流流向和产出统计统一采用生产路线工作区的浅灰绿纸张式视觉；保留地图拖拽、筛选、节点选择、设备操作、仿真控制和实时统计逻辑。整图入场动画与实时物料更新已分离，仿真中物料批次数量变化不再重启全部节点/路线透明度动画；物料点使用独立、可按减少动态效果关闭的 CSS 脉冲 |
| 物品与配方 | `src/components/ItemPanel.tsx`、`RecipePanel.tsx` | 已落地 | 物品、配方、输入输出端口和生产路线关联 |
| 多楼层 | `src/scene/FactoryFloorSystem.tsx`、`src/components/FloorSwitcher.tsx`、`src/scene/FactoryCanvas.tsx` | 已落地 | L1/L2/L3 楼层切换、楼层高度和独立布局；只读上下文楼层增加无网格半透明承托平台，避免建筑在当前层上方悬浮 |
| L2/L3 工业体系 | `src/game/baseA01.ts` | 已落地 | L2 加工/冲压/绕线/配套，L3 装配/质检/包装/成品缓冲 |
| 传送带与物料流 | `src/game/simulation.ts`、`src/scene/ItemLotMesh.tsx` | 已落地 | 固定步长、离散槽位、背压、物料在途呈现 |
| AGV 导航 | `src/game/agvNavigation.ts`、`src/game/simulation.ts`、`src/components/AgvNavigationControl.tsx` | 已落地 | 按楼层隔离障碍的八方向网格寻路、站点、任务、避让、重规划和仓储控制入口；严格安全包络失败时同层贴边兜底 |
| 无人机跨层运输 | `src/game/droneNavigation.ts`、`DroneNavigationControl.tsx` | 已落地 | L1 停靠，升降到 L2/L3，再走高位环线和输入支线；仿真启动后运行 |
| 仓储控制 | `src/components/WarehouseWorkspace.tsx` | 已落地 | 库位、运输层、物料台账、AGV 和无人机导航控制 |
| 诊断 / ForgeCore Agent | `src/components/FactoryAgentWorkspace.tsx`、`src/api/agent.ts`、`src/game/agentWorker.ts`、`src/workers/factoryAgentWorker.ts`、`src/game/factoryAgent.ts`、`src/game/agentBranch.ts`、`src/workers/factoryAgentBranchWorker.ts`、`src/forgecore-agent.css`、`backend/.../Agent*`、`backend/src/test/.../AgentPatchValidatorTest.java`、Flyway V9 | 已完整接入（可信边界已补齐） | 点击诊断呈现 ForgeCore `82aad31` AgentPage 控制室；真实 MySQL 持久化 run/step/12 tool/event/patch/approval，认证 SSE 加轮询回退、审批/拒绝/replan、版本冲突、应用/回滚、六指标 Worker 分支、对象定位和历史查询均接通当前项目存档；主诊断/方案/应用后复核由 Worker 执行并可取消。服务端以当前项目存档为事实源，独立记录结构工具，深层校验对象引用、配置、端口、路线、边界、碰撞、库存、资源归属和操作上限，应用/回滚持有项目行锁；浏览器 Finding 明确标记为确定性仿真证据，不冒充服务端重跑指标。指标区分在途 WIP、仓储库存、车辆平均运输时长、消耗/产出；目标支持吞吐、时间窗、楼层、变更数、功率和保留资产约束；受控库存调整必须经分支仿真和人工审批。布局目标会生成无碰撞设备移动、真实入货仓库、避障传送带、开放端方向/旧站重叠修复和等待载具批量调整；车辆供料以 `vehicle_transport` 图边参与拓扑，正常阈值待命不再误报故障 |
| 自动巡检 / 时序预警 | `src/game/metricsHistory.ts`、`src/game/factoryAutopilot.ts`、`src/game/autopilotWorker.ts`、`src/workers/factoryAutopilotWorker.ts`、`src/game/bottleneckAnalysis.ts`、`src/game/patrolNarrative.ts`、`src/game/patrolVoice.ts`、`src/game/energyAnalysis.ts`、`src/game/inventoryForecast.ts`、`FactoryAgentWorkspace.tsx` 巡检按钮、`scripts/autopilot-units.ts` | 已落地（引擎层+入口） | 每轮固定种子运行 60 秒只读证据副本，吞吐/利用率/阻塞/在途进入 36 容量环形时序；纯函数最小二乘输出 rising/stable/declining/critical 四态与归零 ETA；结构版本变化仍与上一基线比较（回答“改动是否伤产能”）并标记基线重置；吞吐降幅 ≥25% 或阻塞增量 ≥1 或交付停滞判为劣化：注入标准 `autopilot_*` Finding、headline 加前缀并预填修复目标，Patch 仍走既有生成→校验→人工审批链路。证据副本、瓶颈和能耗归因放入 Web Worker（`energyAnalysis` 按设备额定功率解析「运行满功率 / 待机 15%」口径做归因提示），点击定时巡检不会阻塞页面，关闭开关/切换项目/离开诊断会取消未完成任务。瓶颈归因层每 5 秒采样一次机器状态，按「忙碌×0.7 +（1-相对完成率）×0.3」排序给出「供料者[ID] → 约束设备[ID]」因果链 Finding。「定时巡检」开关每 60 秒自动执行一轮（切换项目或关闭诊断页即停止），每轮产出中文报告：确定性模板始终可用，可选 AI 服务只做润色、失败或未启用时原样回退模板；`patrolVoice` 把报告压缩成一句可朗读警报，优先可选 AI TTS、失败回退浏览器 speechSynthesis、再失败静默跳过。巡检不写存档；AI 不可用时全部功能不降级消失 |
| Generative Factory | `src/game/generativeFactory.ts`、`src/game/generativePlanner.ts`、`src/workers/generativeFactoryWorker.ts`、`src/components/GenerativeFactoryWorkspace.tsx`、`src/App.tsx` | 已落地 | 诊断页可切换进入生成式工厂模式；黛玉确定性链路负责需求解析、候选布局、校验、副本仿真和方案对比，重计算由 Web Worker 承担并支持取消/失败状态，What-if 试算同样不阻塞页面；交互默认 1 轮、每组候选 420 秒仿真，校验通过后可应用到当前存档。A-02 齿轮箱生成回归 3/3 通过；Top 3 强制保留节能、平衡、高吞吐三类基准，分别形成 1/1、2/2、3/3 的 CNC/AGV 资源梯度，并以设备—物流结构多样性回归防止迭代候选挤占同类方案；A-01 调整器按目标工艺锚点最多的楼层选择同层路线，楼层占用/连接校验隔离，稳定返回现状基线、最小重布线、完整重构 3 个候选，其中 2 个可应用，基线用于诊断对照。 |
| 资源包导入 | `src/game/resourcePack.ts`、`ResourceImportDialog.tsx` | 已落地 | JSON/GLB 拖放或选择、字段校验、模型预览和封面生成 |
| 导入资源用户持久化 | `src/api/resources.ts`、`ImportedResourceController.java` | 已落地 | 资源与用户绑定；同一用户再次登录可恢复，其他用户不可见 |
| 模型预览 | `src/components/Model3DViewer.tsx`、`src/scene/ImportedFactoryModel.tsx`、`src/components/MachineManufacturingWorkspace.tsx` | 已落地 | GLB 归一化、缩放后刷新世界包络并将底面归零、预览和设备卡片封面；机械制造内置模型库可选择原料药罐、视觉检测 CAD 单元和工业工作站并将真实路径写入机器定义；现有双臂视觉质检设备模型保持不变 |
| 视觉检测 | `src/demos/InspectionDemo.tsx`、`src/demos/inspection-demo.css`、`src/scene/inspectionDetect.ts`、`ai-service/main.py`、`ai-service/yolo_runtime.py`、`ai-service/export_yolo_accel.py`、`ai-service/benchmark_yolo.py`、`ai-service/models/pcb_defect_yolov8s.pt`、`public/videos/inspection-pcb-demo.mp4` | 已落地（GPU 后端可选） | 独立工作台、左侧 Demo 入口、PCB 制成品测试视频、AI 服务逐帧推理、Canvas 实时检测框/类别/置信度/耗时、模型离线状态、相机演示、检测结果和隔离路由；运行时支持 `.pt` PyTorch 回退，并在准备 ONNX/TensorRT 专用产物且 Provider 可用时选择 CUDA/TensorRT。D 盘 `ai-service/.venv` 已实测 CUDA 12/cuDNN 9/ONNX Runtime CUDA 与 TensorRT 10.7：RTX 4060 Laptop GPU 上 ONNX CUDA 热态约 14.83 ms/帧（P95 16.47 ms），TensorRT FP16 热态约 7.61 ms/帧（P95 8.15 ms）；健康状态返回真实 Provider，GPU 仍不作为前端或核心服务启动门禁。来源和 GPL-3.0 边界见资产审计 |
| AI 管家与语音 | `src/game/assistantProtocol.ts`、`src/game/assistantRuntime.ts`、`src/game/assistantPanels.ts`、`src/game/assistantTasks.ts`、`src/game/assistantTaskPlan.ts`、`src/game/assistantProactiveEvents.ts`、`src/game/assistantStorage.ts`、`src/game/assistantProjectMemory.ts`、`src/game/assistantMemory.ts`、`src/game/assistantReminderPolicy.ts`、`src/components/AssistantRuntime.tsx`、`src/components/AssistantVoiceButton.tsx`、`src/components/AssistantOrb.tsx`、`src/components/AssistantPanelComparison.tsx`、`src/components/FactoryAgentWorkspace.tsx`、`backend/src/main/resources/db/migration/V26__create_assistant_reminder_policies.sql`、`backend/src/main/resources/db/migration/V27__create_assistant_reminder_events.sql`、`backend/src/main/resources/db/migration/V28__create_assistant_user_memory.sql`、`backend/src/main/resources/db/migration/V29__aggregate_assistant_reminder_sources.sql`、`backend/src/main/resources/db/migration/V30__create_assistant_model_metrics.sql`、`backend/src/main/java/com/forgemind/web/AssistantModelMetricController.java`、`voice-chat/voice_chat.py`、`ai-service/`、`ai-service/rag.py` | 已落地（本地 Qwen 需显式启用） | 固定 BT 唤醒词、30 个工具白名单（含面板并排比较、Agent 任务查看、生态产品深链接、视觉结果读取、主动提醒查询/依据解释/同类关闭）、服务端/前端二次校验、面板/楼层/对象调度、Factory Agent 诊断/方案/巡检任务调度、任务状态上下文、前端任务步骤进度与结果摘要回传、服务端 Agent 步骤进度 API/SSE 事件、页面刷新后可显式恢复未结束 run、按用户隔离的任务历史本地持久化与当前项目服务端 Agent run 摘要注入、当前项目最近 Agent Finding/方案摘要的本地记忆、诊断类复杂目标按领域拆成最多 4 个只读子任务并合并 Finding/证据、任务取消/失败重试、主动提醒策略查询/确认修改并作用于巡检通知、用户级 MySQL 提醒策略持久化与离线本地缓存、跨会话主动提醒 claim 去重与严重度升级、云端提醒查询与确认后的同类关闭、本地多来源主动事件聚合与恢复状态、当前页面上下文、会话上下文、按用户隔离的可确认用户偏好记忆并同步至 V28 MySQL、文档轻量 RAG、回答来源片段回传与 BT 来源提示、Ollama `qwen2.5:7b` 可选编排、助手质量指标日聚合、自动巡检劣化主动通知及会话级去重/严重度升级、浏览器/独立语音入口共用 BT 约定、ASR/TTS；服务不可用时前端不阻塞 |
| 对话上下文压缩 | `src/game/assistantConversation.ts`、`src/game/assistantRuntime.ts`、`ai-service/main.py`、`scripts/assistant-context-regression.ts` | 已落地 | 对话达到 8 轮后保留早期目标/安全约束并压缩为最多 1600 字符摘要注入 Qwen；动态工厂数值、库存、坐标、路线和仿真指标必须通过工具重新读取；10 轮上下文回归通过 |
| 主动提醒语音播报 | `src/game/assistantRuntime.ts`、`src/components/AssistantRuntime.tsx`、`src/components/AssistantVoiceButton.tsx`、`src/components/FactoryAgentWorkspace.tsx`、`ai-service/main.py`、`voice-chat/voice_chat.py`、`public/audio/bt-self-intro.wav` | 已落地 | warning/critical 主动事件以及 Agent/巡检/应用后复核完成消息在策略允许时进入 BT TTS 队列并打开关联面板；网页与独立 voice-chat 均保持 BT-7274 专属音色，启动时预热 BT 服务，流式文本约每 8 字按自然边界送入并行合成。屏幕保留完整中英文原文，网页、网关和独立语音在合成前统一从朗读副本移除英文单词、缩写和英文对象 ID，纯英文片段静默跳过。主动播报与普通回答共享串行播放锁；网页 TTS 请求为 45 秒有限超时，避免 BT 首次推理被短超时取消；音频能量可视化上下文失败时回退到普通 HTML 音频播放。内置“BT，介绍一下你自己”固定回答，使用预先合成且只播报“智能管家”的静态 WAV，命中后跳过模型/TTS/工具链直接播放；浏览器语音轮次默认在约 480ms 无声后提交，静默等待上限为 6 秒。成功、失败或超时后恢复空闲；语音失败仍保留文字结果，不阻塞助手 |
| 连续语音会话与多模态联动 | `src/game/assistantVoice.ts`、`src/game/assistantVoiceSession.ts`、`src/components/AssistantVoiceButton.tsx`、`voice-chat/voice_chat.py`、`src/game/assistantVision.ts`、`src/components/AssistantRuntime.tsx`、`src/components/InspectionPanel.tsx`、`src/demos/InspectionDemo.tsx`、`scripts/assistant-voice-session-regression.ts` | 已落地（本地 Qwen 需显式启用） | 浏览器与独立 voice-chat 均支持等待语音、静音自动分轮和硬上限；BT 首轮后进入 30 秒免重复唤醒会话，可手动结束，确认型动作期间暂停收音。YOLO 缺陷结果按节流策略桥接小尺寸同源帧预览，助手运行时监听同页事件与跨页 localStorage，检测缺陷可主动打开面板并播报，检测面板显示最近同步帧；Qwen 仍只读取结构化检测事实，不把图片预览当作模型视觉结论 |
| Agent 可靠执行 | `src/components/FactoryAgentWorkspace.tsx` | 已落地 | 本地 Agent 工具执行遇到一次可恢复错误会自动重试；停止/语音取消在服务端 run 尚未返回时保留取消意图并在 run 创建后补发取消，失败/取消状态继续回写服务端步骤记录 |
| Agent 服务端自动续跑与结果回传 | `backend/src/main/java/com/forgemind/service/AgentRuntimeService.java`、`backend/src/main/java/com/forgemind/repository/AgentRuntimeRepository.java`、`src/components/FactoryAgentWorkspace.tsx` | 已落地（只读） | 服务端每 60 秒扫描超过 120 秒未更新的 `read_only` run，重新校验当前项目版本后自动完成确定性结构审计；前端本地确定性结果同步到服务端时允许一次瞬态失败重试；`plan_design` 不自动生成或应用 Patch，仍需前端显式恢复 |
| 服务端只读编排与统一报告 | `backend/src/main/java/com/forgemind/service/AgentOrchestrationService.java`、`backend/src/main/java/com/forgemind/service/AgentRuntimeService.java`、`backend/src/main/java/com/forgemind/web/AgentController.java`、`src/api/agent.ts`、`src/components/FactoryAgentWorkspace.tsx`、`scripts/agent-server-orchestration-regression.mjs` | 已落地（只读） | 只读 Agent 可进入服务端异步 planning→确定性结构分析→completed/failed，失败写入 run/step/event；`/report` 统一返回步骤、证据来源、结果、Patch 和下一步动作；页面支持将未完成只读 run 交给服务端续跑；方案设计不通过该入口生成或应用 Patch |
| 方案应用后自动复核 | `src/components/FactoryAgentWorkspace.tsx`、`src/api/agent.ts`、`backend/src/main/java/com/forgemind/web/AgentController.java`、`docs/ForgeMind-智能助手2.0优化方案.md` | 已落地（确定性） | Patch 批准应用后自动对当前新存档重新执行只读 Agent 分析，展示吞吐、利用率、在制品、阻塞、成品、运输和库存的应用前/后差异；复核摘要带来源标识并以 `post_apply_review` 事件写入原 Agent run，失败不伪造“已完成” |
| 方案设计阶段链 | `src/game/assistantTaskPlan.ts`、`src/game/assistantTasks.ts`、`src/components/FactoryAgentWorkspace.tsx` | 已落地（Patch 待审批） | 方案设计按读取现状基线、整理目标约束、评估候选方向、生成受控 Patch 草案四阶段执行；前 3 阶段不生成 Patch，最后阶段只产生待人工审批草案，阶段状态写入页面任务上下文 |
| 云端主动事件聚合 | `backend/src/main/resources/db/migration/V29__aggregate_assistant_reminder_sources.sql`、`backend/src/main/java/com/forgemind/repository/AssistantReminderEventRepository.java`、`backend/src/main/java/com/forgemind/web/AssistantReminderEventController.java`、`src/game/assistantProactiveEvents.ts`、`scripts/assistant-proactive-cloud-regression.mjs` | 已落地（按用户隔离） | 主动提醒 claim 按事件指纹持久化来源集合、累计出现次数、首次观察时间、最高严重度和 resolved/open 状态；登录后助手通过 GET 查询开放事件并回灌本地上下文，支持解释来源/时间/次数，确认后关闭同类事件；冷却内信号也会合并计数，恢复后可重新打开，未把事件聚合混入工厂事实 |
| 助手质量指标 | `backend/src/main/resources/db/migration/V30__create_assistant_model_metrics.sql`、`backend/src/main/java/com/forgemind/repository/AssistantModelMetricRepository.java`、`backend/src/main/java/com/forgemind/web/AssistantModelMetricController.java`、`src/api/assistantMetrics.ts`、`scripts/assistant-metrics-regression.mjs` | 已落地（服务元数据） | 按用户/日期/provider 聚合首 token 延迟、完整响应延迟、工具提议/成功和规则降级；不写入问题文本、对象事实或工厂存档，真实 MySQL 隔离与聚合回归通过 |
| RAG 可读写知识库 | `backend/src/main/resources/db/migration/V31__create_assistant_knowledge_documents.sql`、`backend/src/main/java/com/forgemind/repository/AssistantKnowledgeRepository.java`、`backend/src/main/java/com/forgemind/web/AssistantKnowledgeController.java`、`ai-service/rag.py`、`ai-service/main.py`、`ai-service/README.md`、`scripts/assistant-rag-regression.py`、`scripts/assistant-rag-eval.py`、`scripts/assistant-rag-embedding-regression.py`、`src/api/forgeCloud.ts`、`src/game/assistantKnowledge.ts`、`src/components/ForgeCloudConsole.tsx` | 已落地（成熟化第二阶段，工作空间/项目版本隔离） | 内置产品/方案文档通过白名单接口按需阅读；当前工作空间知识支持新增、搜索、分类筛选和归档；检索器已按问题类型路由，使用查询同义扩展、父子片段、BM25+零依赖哈希词元向量混合召回、可选 Ollama 语义 embedding、来源/问题类型/项目版本权重、MMR 去重、证据置信度和版本冲突标记；workspaceId 不匹配或 archived 条目不进入检索；纯实时事实问题直接 tool-first，不返回历史 RAG 片段；新增条目写入 V31、记录 AI Cloud 审计并在下一次助手请求进入 RAG；动态库存、产量、坐标和仿真数字拒绝写入。离线质量评测纳入 Recall@4、MRR、nDCG@4、embedding 归一化/缓存/离线回退和 tool-first 门禁；语义服务不可用时自动回退到默认检索 |
| 面板比较与任务查看 | `contracts/forgemind-assistant-tools.json`、`src/game/assistantProtocol.ts`、`src/game/assistantExecutor.ts`、`src/game/assistantPanels.ts`、`src/components/AssistantPanelComparison.tsx`、`src/App.tsx`、`scripts/assistant-protocol-check.ts`、`scripts/assistant-qwen-eval.mjs` | 已落地 | `compare_panels` 打开两个已注册面板的并排比较浮层，`show_task` 只允许查看当前上下文中的任务 ID 并进入 Agent 任务诊断；服务端/前端均拒绝未知面板、同面板比较和不属于当前用户的任务；真实 Qwen 12/12 评测通过 |
| 生态产品深链接 | `contracts/forgemind-assistant-tools.json`、`src/game/assistantProtocol.ts`、`src/game/assistantExecutor.ts`、`src/game/assistantPanels.ts`、`src/App.tsx`、`scripts/assistant-protocol-check.ts`、`scripts/assistant-qwen-eval.mjs` | 已落地 | `open_product` 仅允许跳转 ForgeMind、ForgeHub、ForgeLab、ForgeCloud 白名单入口；ForgeCloud 仍经过登录态检查，其他入口按现有 ForgePass 页面处理，不绕过认证、不修改工厂事实 |
| 视觉结果与助手联动 | `src/game/assistantVision.ts`、`src/demos/InspectionDemo.tsx`、`src/components/AssistantRuntime.tsx`、`src/game/assistantProtocol.ts`、`src/game/assistantExecutor.ts`、`ai-service/main.py`、`contracts/forgemind-assistant-tools.json`、`scripts/assistant-qwen-eval.mjs` | 已落地（结构化结果） | 检测页通过本地同源桥保存最近一帧 YOLO 结果，助手只读取缺陷类别、置信度、框坐标、判定和时间；主工作台跨页面接收缺陷签名并按策略主动提醒；`inspect_vision_result` 无有效结果时拒绝执行，模型不生成新的视觉事实；真实 Qwen 12/12 评测通过 |
| 助手工具协议当前计数 | `contracts/forgemind-assistant-tools.json`、`src/game/assistantProtocol.ts`、`ai-service/main.py` | 已落地 | 当前版本为 30 个工具；此前总览中的 27 个工具描述由本行和目标方案最新状态覆盖，新增主动提醒查询/依据解释/同类关闭，并由 IntentRouter 对明确提醒、产品入口、面板比较和偏好请求提供低风险修复 |
| 项目版本记忆 | `src/game/assistantProjectMemory.ts`、`src/App.tsx`、`ai-service/main.py` | 已落地（本地） | 按用户隔离记录当前项目最近 12 个版本摘要并注入 Qwen 上下文，用于“上一版/当前版”解释；不替代实时工厂事实，也不保存完整存档 |
| 真机硬件套件（DM4310 机械臂） | `hardware/dm4310-arm/`（README.md、firmware/dm4310_protocol.h、dm4310_twai.h、dm4310_motor.h、dm4310_arm_sketch/、test/protocol_test.cpp） | 已落地（未真机验收） | 达妙 DM4310 六轴桌面臂完整套件：MIT 协议层平台无关并经 g++ 主机回归 ALL PASS，ESP32 TWAI 总线层与串口命令台（使能/置零/点动/增益/demo，故障自动全臂失能），BOM/接线/装配/烧录/调试文档齐备；关节命名对应场景 `panda_joint1..6`。固件未经 ESP32 编译烧录与真机验收，量程常量需按批次用达妙上位机核对 |

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
| POST | `/api/auth/email/send-code` | 发送邮箱验证码并按邮箱/IP 限流 |
| POST | `/api/auth/email/login` | 校验邮箱验证码并登录或首次创建账户 |
| GET | `/api/auth/github/start` | 开始 GitHub OAuth 登录 |
| GET | `/api/auth/github/callback` | 接收 GitHub OAuth 回调 |
| POST | `/api/auth/github/exchange` | 消费一次性 OAuth 兑换码 |
| POST | `/api/auth/phone/send-code` | 发送腾讯云短信验证码并按手机号/IP 限流 |
| POST | `/api/auth/phone/login` | 校验验证码并登录或首次创建手机号账户 |
| POST | `/api/auth/phone/bind` | 为当前账户绑定已验证手机号 |
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

### ForgeCloud `/api/v1`

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET/POST | `/api/v1/workspaces` | 工作空间查询与创建 |
| GET/POST | `/api/v1/projects` | 云端项目查询与创建 |
| GET/POST | `/api/v1/assets` | 资源注册与查询 |
| GET/POST | `/api/v1/devices` | 设备注册与查询 |
| POST | `/api/v1/devices/{id}/heartbeat` | 设备心跳 |
| GET/POST | `/api/v1/devices/{id}/commands` | 设备命令查询与安全入队，当前保持 pending |
| GET/POST | `/api/v1/twins` | 数字孪生查询与创建 |
| POST | `/api/v1/twins/{id}/state` | 孪生状态快照更新 |
| GET/POST | `/api/v1/data/points` | 数据点注册与查询 |
| GET/POST | `/api/v1/data/events` | 遥测/事件写入与查询 |
| GET | `/api/v1/ai/models` | 规则模型与工作空间模型目录 |
| GET/POST | `/api/v1/ai/tasks` | AI 任务查询与入队 |

ForgeCloud 的 V13–V16 接口均按 bearer 会话、工作空间成员和项目角色做服务端隔离；数据库状态探针和 F1 控制面首个交付切片已完成真实 Docker/MySQL 联调。统一审批申请、决策和行动记录 API 已可运行；Device/Twin/Data/AI 的基础 API 已可运行，但真实协议连接、命令执行器、时序数据引擎和远程模型路由仍未接入。

所有需要用户数据的接口使用 `Authorization: Bearer <token>`。资源列表、模型下载和工厂存档均在服务端按用户过滤。

## 5. 数据库迁移

> 2026-09-03 状态修订：全局数据库已升级至 V30。V17 提供 Asset Blob 本体上传/鉴权下载/软删除，V18 提供已发布 ForgeLab 帖子与不可变项目发布/资源版本关联、许可证快照、Outbox 与审计，V19–V22 补齐统一活动流、可靠幂等写入、manifest 治理和资源版本生命周期，V23 补齐连接器映射、AssetTwin 绑定和已入库运行事件回放，V24–V25 补齐运行事实、遥测窗口、工单/质量/维护台账和外部事件唯一去重，V26–V27 增加 AI 助手提醒策略持久化与跨会话主动提醒 claim 去重，V28 增加用户批准的助手长期记忆，V29 增加主动事件多来源聚合持久化，V30 增加助手质量指标日聚合；真实工业协议、专业时序引擎、设备控制执行器、MinIO/S3、公共资源治理和远程模型路由仍未完成。

Flyway 迁移位于 `backend/src/main/resources/db/migration/`：

| 迁移 | 内容 |
| --- | --- |
| V1 | 用户、会话、工厂、楼层、物品、配方、端口、设备、连接和仿真快照基础表 |
| V2 | 放宽当前 MVP 的楼层外键约束 |
| V3 | 放宽当前 MVP 的配方/物品绑定外键约束 |
| V4 | 放宽配方端口的物品外键约束 |
| V5 | `imported_resource` 用户资源表，保存资源定义和 GLB 二进制 |
| V6 | `factory_object.resource_id` 资源引用和索引 |
| V7–V9 | Agent 运行时、工具调用、Patch、审批、回滚和 SSE 持久化 |
| V10–V12 | ForgeLab 帖子、附件、回复、点赞、通知及种子数据 |
| V13 | ForgeCloud 工作空间、项目/资产版本、成员、通知、审计和 Outbox |
| V14 | ForgeCloud 发布、评论、任务、只读连接器、运行事件和移动摘要 |
| V15 | Device/Twin/Data/AI Cloud 基础表、设备心跳、孪生状态、遥测事件、pending 命令和规则 AI 任务 |
| V16 | 项目角色授权、项目成员 API、统一审批请求/行动记录、审批决策 API 与控制台审批入口 |
| V17 | Asset Blob 元数据、SHA-256 去重、默认本地对象存储上传、鉴权下载和软删除 |
| V18 | 已发布 ForgeLab 帖子与不可变项目发布/资源版本关联、许可证快照、Outbox 与审计 |
| V19 | Outbox → Activity 统一活动流、幂等消费、失败重试和队列指标 |
| V20 | 项目版本、任务和审批请求的客户端幂等键与重复重试回读 |
| V21 | 资源 manifest v1、许可证声明、依赖数组与公开资源许可证门禁 |
| V22 | 资源版本历史、不可变新版本、当前版本原子切换和版本创建幂等 |
| V23 | 连接器映射、AssetTwin 绑定、确定性本地回放同步和同步运行账本 |
| V24 | 运行事件事实字段、遥测窗口聚合、工单、质量结果和维护记录 |
| V25 | 运行事件外部标识的工作空间级唯一去重约束 |

运行态的 `ItemLot`、机器进度、传送带槽位、AGV/无人机当前位置仍在前端仿真运行时，不直接逐 tick 写数据库。

## 6. 运行与验证

```powershell
npm.cmd install
npm.cmd run dev
npm.cmd run build
npm.cmd run sim:smoke
npm.cmd run sim:regression
npm.cmd run sim:units
npm.cmd run autopilot:units
npm.cmd run sim:backpressure
npm.cmd run generative:regression
npm.cmd run assistant:protocol
npm.cmd run save:regression
npm.cmd run models:validate

cd backend
mvn test
```

Windows 一键入口 `启动ForgeMind.cmd` 和 `start-forgemind.bat` 现在都只保留一个可见终端：大进度条按 MySQL、Spring Boot、AI 网关、ASR/TTS、独立语音监听和前端阶段推进，后台服务隐藏运行并把输出写入 `.forgemind/logs/`；只有实际健康检查、语音进程存活检查和 ASR/TTS 预热全部完成才显示 `100% / SYSTEM READY`。两个一键入口默认启动前端、Spring Boot、MySQL、AI 和语音能力，但不启动或探测 Ollama/本地大语言模型，AI 默认使用 `rule`；直接调用不带服务开关的 PowerShell 脚本才是轻量入口，`-IncludeAI` 和 `-IncludeVoiceChat` 可显式增加能力，后者自动启用 AI 网关；追加 `-UseLocalQwen` 才会选择本机 Ollama `qwen2.5:7b` 并校验 provider，已有规则网关占用 8000 时会明确要求先停止旧实例。若数据库或后端未启动，前端仍可使用本地工厂、资源导入预览和本地仿真；资源不会在未登录或后端不可用时伪装成已持久化。

## 7. 仍然属于边界而非承诺

- 当前 Spring Boot 负责结构化存档和资源存储，不是实时仿真服务器。
- 当前 AI 服务通过 HTTP 被前端调用；Redis Stream/Kafka 仍是未来异步部署方案，不是已启用依赖。
- 资源包导入已实现“当前用户私有资源”路径，但还没有公共资源市场、跨用户分享和大文件对象存储。
- 资源封面是浏览器预览视角截图，不是服务端离线渲染农场。
- 高频三维对象可见性、标签遮挡和性能预算仍由自研渲染层与场景组件共同负责，不能把所有渲染状态当作数据库事实。货架库存标签通过 `FactoryCanvas.showRackLabels` 由工作台状态直接控制；生产路线、物品详情、机械制造、仓储、诊断、建造、设备详情、多选或项目弹窗打开时停止渲染，避免 HTML 标签穿透前景面板。存档导入同时规范化物品/配方名称与说明，连续问号优先回退内置目录名称，否则回退业务 ID。
- `sim:regression`（8/8）、`sim:smoke`、`sim:backpressure`、`sim:units`（18/0）、`autopilot:units`（15/0）、`assistant:protocol`、`save:regression`、`generative:regression` 和 `models:validate` 当前通过；完整生产构建 `npm.cmd run build`（tsc -b + vite build）通过。`generative:regression` 当前验证 A-02 Top 3 包含节能/平衡/高吞吐三类且有 3 种设备—物流结构，另验证 3 个 A-01 调整候选，其中 2 个可应用；基线候选明确作为现状诊断对照，不把历史布局强行宣称为新布局校验通过。
- `hardware/dm4310-arm/` 属于硬件交付边界：协议数学经主机端单元测试，ESP32 固件未在本机编译、未做真机验收；电机 P_MAX/V_MAX/T_MAX 因固件批次而异，必须用达妙上位机核对后再运行。
- 自动巡检的预测是固定窗口线性外推，不是机器学习模型：趋势判定至少需要 3 轮样本，证据副本每次都从初始状态重放，因此纯运行性损耗（如货架库存随真实时间耗尽）不会体现在逐轮副本差异中；该场景由实时快照诊断与阻塞 Finding 兜底。瓶颈归因为 5 秒粒度采样统计，主约束需同时满足「≥2 台设备且最高忙碌率 ≥85%」，单机厂与低负载产线不出约束链。
- 巡检报告的 LLM 润色只允许改写已确定 Finding 的表述，不得新增事实；`narratePatrolReport` 通过注入式 narrator 调用 AI 服务，超时、失败、未启用或空回复一律回退确定性模板，模板文本本身可逐字节复现并有回归钉住。

## 8. 智能化演进规划（非当前实现）

代码审计后的路线以根目录 [ForgeMind 项目方案](../ForgeMind%20项目方案.md) 第 11 节为准。核心方向是把当前“设计模型 + 确定性仿真 + 规则 Agent”逐步扩展为“运行孪生 + 生产事件 + 真实数据适配 + 可验证 Agent 闭环”。交互式生成默认采用 1 轮搜索、每组候选 420 秒仿真，深度回归可显式增加仿真时间和搜索轮次；进度会停留在副本仿真阶段，直到 Worker 返回真实候选：

1. 先收紧后端 Patch 的深层校验、版本指纹、权限、幂等和回滚边界。
2. 增加 AssetTwin、RuntimeEvent、Lot/Batch、WorkOrder、QualityResult、MaintenanceRecord，但不把每帧状态写入数据库。
3. 以仿真和历史回放作为第一种数据源，再增加只读 MQTT/OPC UA 适配层。
4. 在真实事件上建立 OEE、节拍、阻塞、库存、质量、能耗和故障趋势，先可解释再机器学习。
5. 让 Agent 基于实时事实提出方案，由确定性仿真验证，经审批后执行并回收效果。

90 天建议只做一条 5–10 台设备的小型示范产线，验证供料不足、设备降速、下游堵塞/质量异常三个场景。当前系统仍保持离线可运行、规则模式默认可用、远程 AI 可选的边界。
