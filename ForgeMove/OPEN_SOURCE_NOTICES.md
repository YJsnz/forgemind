# ForgeMove 开源来源与许可说明

ForgeMove 使用“参考交互 + 原生实现”的方式吸收开源项目经验，第三方代码不与 ForgeMind 的业务代码混淆。

| 项目 | 用途 | 版本/状态 | 许可与来源 |
| --- | --- | --- | --- |
| Gitter | GitHub 小程序的项目卡片、分段信息流、详情档案和刷新反馈交互参考 | `nslogx/Gitter` | Apache-2.0 · https://github.com/nslogx/Gitter |
| TDesign MiniProgram | 可选的按钮、输入、标签、空状态和反馈组件层；当前默认主题保留 ForgeMind 品牌变量 | `@tdesign/miniprogram` `^1.15.0` | MIT · https://github.com/Tencent/tdesign-miniprogram |
| WeUI WXSS | 微信平台基础视觉和可访问性兼容参考 | `weui-wxss` `2.6.x` | MIT · https://github.com/Tencent/weui-wxss |
| Lottie / lottie-miniprogram | 可选的加载、成功、异常与设备状态动画容器；默认用 CSS 降级避免阻塞启动 | `lottie-web` / `lottie-miniprogram` | MIT · https://github.com/airbnb/lottie-web |

本目录当前默认不内嵌第三方大体积运行时代码，以便微信开发者工具直接导入。接入 TDesign 或 Lottie 时应通过 npm 构建，保留上游 LICENSE，并为所有动画提供静态首帧与减少动效降级。

ForgeMind 自有业务代码、文案、主题变量和演示数据不声明为上述项目的原创内容；模型、字体和其他资产继续以根项目的资产审计为准。

