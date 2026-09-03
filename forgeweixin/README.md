# ForgeWeixin

ForgeMind 的微信小程序移动端首版，定位为运行查看、项目浏览和移动协作入口。

## 当前范围

- 复用 ForgeMind 现有账号密码登录和 Bearer 会话。
- 通过 Spring Boot API 读取当前用户有权访问的工厂项目和完整存档。
- 提供工厂数量、楼层、设备、物品、配方和对象摘要。
- 不承载三维建造、长时间仿真、资源上传或 Agent Patch 直接执行。
- 使用项目内 `assets/brand/forgemind-primary-lockup.png` 品牌主 Logo 和 `assets/fonts/` 字体文件。微信不允许 WXSS 直接加载打包字体，因此默认使用项目字体名和系统回退；部署字体到 HTTPS 静态目录后，将该目录填入 `config/env.js` 的 `FONT_BASE_URL`，小程序会通过 `wx.loadFontFace` 运行时加载，不产生本地路径报错。

## 打开方式

1. 使用微信开发者工具导入本目录 `forgeweixin/`。
2. 开发阶段确认 `config/env.js` 的 `API_BASE_URL` 指向本机 Spring Boot，例如 `http://127.0.0.1:8080`。
3. 本地开发可在微信开发者工具中关闭“校验合法域名、web-view 业务域名、TLS 版本以及 HTTPS 证书”；真机和生产环境必须使用可访问的 HTTPS 合法业务域名。
4. 使用测试账号登录。账号仍由 `backend/` 的 `/api/auth/login` 校验，MySQL 凭据不会进入小程序。

## 数据流

```text
微信小程序 → HTTPS /api/auth、/api/factories → Spring Boot → MySQL
```

小程序不直接连接 MySQL。所有项目归属、会话有效期和存档读取权限由后端校验。

## 校验

在项目根目录执行：

```powershell
npm.cmd run forgeweixin:validate
```

生产接入前还需要补充微信 `wx.login` 身份绑定、订阅消息、移动端聚合指标接口和真机网络验收。
