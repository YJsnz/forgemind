# ForgePass 用户文档

> 版本：2026-09-04 · 统一身份入口

## 1. 模块定位

ForgePass 是 ForgeMind、ForgeCloud、ForgeHub 和 ForgeLab 共用的身份入口。一个账户可以按权限进入不同 Forge 产品，认证过程仍由 ForgeMind Spring Boot 后端完成。

## 2. 注册

1. 在 ForgeMind、ForgeCloud、ForgeHub 或 ForgeLab 点击进入产品。
2. 在 ForgePass 页面选择注册/首次登记。
3. 输入账户标识，至少 2 个字符；密码至少 6 位。
4. 提交成功后会进入请求产品；需要进入 ForgeMind 工作台时，按提示选择项目。

账户标识不强制要求是邮箱。ForgePass 页面会关闭浏览器的 email-only 校验，但服务端仍会校验账户长度、密码和唯一性。

## 3. 登录和退出

登录时可以输入已有账户和密码，也可以选择邮箱验证码登录或 GitHub 登录。邮箱登录需要先获取邮箱验证码；首次验证成功会自动创建 ForgePass 账户，之后通过同一邮箱进入原账户。GitHub 登录只使用 GitHub 返回的用户 ID 和已验证邮箱，首次授权会创建 ForgePass 账户。成功后页面会保存会话令牌并调用当前用户校验；ForgeCloud 右上角账户菜单提供“退出登录”，退出会清除当前 ForgePass 会话并返回认证入口。

手机号快捷登录代码仍保留在后端，但由于当前没有可用的合规短信签名，前端暂不展示该入口。

退出后不要继续使用旧页面中的云端操作。重新登录后，系统会根据当前账户重新加载项目、资源、成员和社区权限。

## 4. 安全提示

- 密码不会以明文保存在数据库中。
- 邮箱地址作为标准化身份绑定保存；邮箱验证码只保存摘要，5 分钟有效且成功后立即失效。
- 邮箱认证依赖服务端 SMTP 配置；未配置时不会伪造“发送成功”。
- GitHub OAuth 状态使用服务端 session 校验，回调后的兑换码 2 分钟有效且只能消费一次；GitHub 访问令牌不落库。
- 不要把密码、令牌或 API 地址发布到 ForgeLab 帖子和附件。
- ForgePass 只负责身份，不代表用户拥有所有工作空间和项目权限。
- ForgeCloud、ForgeLab 和 ForgeMove 的数据权限仍由服务端按账户、工作空间和项目校验。

## 5. 登录失败排查

| 提示/现象 | 处理 |
| --- | --- |
| 账户标识至少需要 2 个字符 | 增加账户标识长度 |
| 密码至少需要 6 位 | 使用符合长度要求的密码 |
| 身份验证失败 | 检查账户、密码和后端 8080 |
| 邮箱验证码尚未配置 | 检查后端的 `FORGEMIND_EMAIL_ENABLED`、`FORGEMIND_EMAIL_HOST`、`FORGEMIND_EMAIL_PORT`、`FORGEMIND_EMAIL_USERNAME`、`FORGEMIND_EMAIL_PASSWORD` 和 `FORGEMIND_EMAIL_FROM` |
| GitHub 登录尚未配置 | 检查后端的 `FORGEMIND_GITHUB_ENABLED`、`GITHUB_CLIENT_ID`、`GITHUB_CLIENT_SECRET` 和 OAuth 回调地址 |
| 腾讯云短信尚未配置 | 手机号入口当前默认隐藏；如具备合规短信资质，再检查 `FORGEMIND_SMS_ENABLED`、`TENCENTCLOUD_SECRET_ID`、`TENCENTCLOUD_SECRET_KEY`、`TENCENTCLOUD_SMS_SDK_APP_ID`、`TENCENTCLOUD_SMS_SIGN_NAME` 和 `TENCENTCLOUD_SMS_TEMPLATE_ID` |
| 验证码发送过于频繁 | 等待倒计时结束；系统按手机号和 IP 限制发送频率 |
| 验证码不存在或已过期 | 重新获取验证码；每个验证码只能成功使用一次 |
| 进入产品后没有数据 | 检查当前工作空间、项目角色和接口状态 |
| 退出后仍显示旧内容 | 刷新页面或重新打开产品入口 |
