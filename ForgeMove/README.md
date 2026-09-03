# ForgeMove

ForgeMind 的微信小程序配套生态：面向现场工程师、产线负责人和工厂设计者的移动控制台。

## 能力

- 登录 / 演示模式 / 会话恢复
- 工厂总览、Factory Pulse、产线监控和工厂档案
- 现场任务、异常确认、维护提醒和离线待办
- 物料库存、低库存预警、在途数量和仓储来源
- ForgeLab 移动社区：动态、求助、经验分享、点赞和离线草稿
- 个人设置、同步状态、帮助与开源许可

## 运行

1. 用微信开发者工具导入 `ForgeMove/`。
2. 在 `config/env.js` 中设置 Spring Boot 地址。开发阶段可以使用 `http://127.0.0.1:8080` 并关闭合法域名校验，真机必须使用 HTTPS 合法域名。
3. 直接点击“进入演示模式”即可离线查看完整交互；登录后会优先读取 `/api/auth/*`、`/api/factories`、`/api/v1/mobile/summary`、`/api/v1/tasks` 和 `/api/forgelab/*`。
4. 如果安装了 npm 依赖，在开发者工具中执行“构建 npm”；默认界面不依赖 `miniprogram_npm`，没有依赖产物也可以启动。

## 产品边界

ForgeMove 不直连 MySQL，不执行 Agent Patch，不修改三维坐标，不替代确定性仿真。移动端的“运行中 / 离线演示”会明确标记数据来源；需要布局、碰撞、寻路、仿真和审批时，返回 ForgeMind Web 工作台。

## 来源与许可

Gitter 的移动端项目档案、分段信息流和刷新反馈是本项目的交互参考，未直接复制其 Taro/Taro UI 运行时代码。第三方组件和动效来源见 [`OPEN_SOURCE_NOTICES.md`](OPEN_SOURCE_NOTICES.md)。
