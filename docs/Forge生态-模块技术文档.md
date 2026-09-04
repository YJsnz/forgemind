# Forge 生态模块技术文档

> 版本：2026-09-04 · 当前实现补充

本文档补充 ForgeMind 综合技术文档，集中说明 ForgeMind、ForgePass、ForgeCloud、ForgeHub、ForgeLab 和 ForgeMove 的边界、调用关系和当前实现状态。未落地部分明确标记为预留或路线图，不作为已实现能力。

## 1. 模块矩阵

| 模块 | 当前入口 | 技术职责 | 当前状态 |
| --- | --- | --- | --- |
| ForgeMind | React/Vite `/`、工作台 | 三维编辑、资料、确定性仿真、诊断和存档 | 已落地 |
| ForgePass | `ForgePassPage.tsx` | 密码/邮箱验证码/GitHub OAuth 登录、注册、会话续登和统一身份入口 | 已落地；邮箱 SMTP 与 GitHub OAuth 需服务端配置，手机号通道保留但默认隐藏 |
| ForgeCloud | React `/forgecloud` | 工作空间、版本、资源、发布、协作、云端事实摘要 | 已落地；工业生产接入仍受边界约束 |
| ForgeHub | React `/forgehub` | 3D 资产构建和复用入口 | 接口预留 |
| ForgeLab | React `/forgelab`、Spring Boot `/api/forgelab/*` | 帖子、附件、回复、点赞和通知 | 已落地 |
| ForgeMove | 原生微信小程序 `ForgeMove/` | 移动摘要、任务、库存、监控和社区入口 | 已落地；离线和真机网络需部署配置 |

## 2. 身份流

```text
ForgeMind / ForgeCloud / ForgeHub / ForgeLab
       → ForgePassPage
       → POST /api/auth/login、/register、/email/login 或 GitHub OAuth
       → Bearer token
       → GET /api/auth/me
       → 产品自身入口和服务端权限检查
```

ForgePass 不拥有独立用户表；Spring Boot 的 `app_user` 是身份事实源。密码由服务端使用 BCrypt 处理，会话数据库只保存 token 摘要。V33 的 `auth_identity` 保存邮箱和 GitHub 身份绑定，`auth_email_otp` 保存邮箱验证码挑战，均不保存验证码明文；GitHub 回调使用服务端 session 状态和一次性兑换码，不保存 GitHub 访问令牌。手机号绑定表和腾讯云短信实现仍保留，但因当前无合规短信资质默认不展示/不启用。退出时前端清除会话并回到认证入口，产品 API 不应继续复用旧 token。

## 3. ForgeMind 技术边界

ForgeMind 的 `src/game/simulation.ts` 是固定步长离散生产仿真的唯一真相源；`src/scene/` 只负责呈现对象、物料和车辆。`src/game/grid.ts` 负责边界、足迹、端口、碰撞和吸附规则；`src/game/save.ts` 负责本地存档 v6 的解析和校验。

Agent、自动巡检和生成式工厂运行在 Worker/确定性规则边界内。AI 不决定布局坐标、碰撞、物料数量、寻路或仿真指标。

## 4. ForgeCloud 技术边界

ForgeCloud 前端通过 `src/api/forgeCloud.ts` 访问 `/api/v1`，服务端按 workspace、项目角色和资源归属执行校验。核心对象包括：

- workspace/member：工作空间和角色；
- project/version：项目工作副本和不可变版本；
- asset/version/blob：资源、manifest、许可证、依赖、哈希和文件本体；
- publication/task/approval：发布、任务和人工决策；
- device/twin/data：设备摘要、孪生绑定和遥测事件；
- activity/outbox：审计事实、幂等投影和失败重试。

版本写入使用乐观并发和客户端幂等键；资源版本使用不可变创建和当前指针切换。当前工业连接为只读/软件回放边界，设备命令默认进入审计队列，不由云端直接执行。

## 5. ForgeLab 技术边界

Flyway V10–V12 建立帖子、附件、回复、帖子点赞、回复点赞和通知表。`ForgeLabController` 所有接口都通过 `AuthService.currentUser` 获取当前账号：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/forgelab/posts` | 帖子流和当前用户点赞状态 |
| GET | `/api/forgelab/posts/{id}` | 正文、附件和回复 |
| POST | `/api/forgelab/posts` | multipart 发帖 |
| POST | `/api/forgelab/posts/{id}/like` | 切换帖子点赞 |
| POST | `/api/forgelab/posts/{id}/replies` | 发布回复 |
| POST | `/api/forgelab/replies/{id}/like` | 切换回复点赞 |
| GET | `/api/forgelab/notifications` | 当前账号通知 |
| POST | `/api/forgelab/notifications/{id}/read` | 标记已读 |
| GET | `/api/forgelab/attachments/{id}/download` | 鉴权下载 |

附件保存元数据和可选 LONGBLOB，文件名会去除路径部分并受 Spring Boot 80 MB 单文件限制。社区不保存逐 tick 仿真状态，工厂存档作为附件交给 ForgeMind 重新验证。

## 6. ForgeMove 技术边界

ForgeMove 使用原生 WXML/WXSS/JavaScript，不直连 MySQL。在线接口包括：

- `/api/auth/*`：会话和当前用户；
- `/api/factories`：用户可访问的工厂项目；
- `/api/v1/mobile/summary`：移动摘要；
- `/api/v1/tasks`：任务和受权限保护的动作；
- `/api/forgelab/*`：社区读取、发布和通知。

网络失败时使用明确标记的离线演示数据或待同步状态。移动端不执行 Agent Patch，不改三维坐标，不将摘要指标伪装为三维逐帧事实。

## 7. ForgeHub 技术边界

当前 `/forgehub` 通过 ForgePass 后进入产品预览页，保留 `forgehub-logo.png` 和接口预留状态；尚未建立正式的资产上传、版本、Fork、依赖治理或发布 API。ForgeMind 的 JSON/GLB 资源导入仍是当前可用资产进入工厂的事实入口。

## 8. 跨模块黄金路径

```text
ForgeMind 建立工厂
  → 提交 ForgeCloud 项目版本
  → ForgeCloud 记录资源 manifest / 发布 / 审批
  → ForgeMove 查看移动摘要和现场任务
  → ForgeLab 分享存档、模型和复现说明
  → ForgeMind 下载/导入后重新校验、仿真和诊断
```

每个环节都必须保留来源、版本、许可证和权限边界。ForgeLab 的公共帖子、ForgeMove 的离线摘要和 ForgeCloud 的软件事件不能直接成为 ForgeMind 仿真真相。

## 9. 验证入口

```powershell
npm.cmd run build
npm.cmd run forgecloud:regression
npm.cmd run forgeweixin:validate
git diff --check
```

ForgeLab 后端变更还需要执行 Maven 测试/打包和真实临时账号回归；ForgeHub 当前只能验证入口、身份保护和预览页，不得宣称资产工作区已完成。
