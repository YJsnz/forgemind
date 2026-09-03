# ForgeMind Windows 混合宿主

这是最终客户端的宿主层，不是第二套业务 UI：

- WebView2 通过虚拟 HTTPS 主机加载 `web/dist/` 中由当前 Web 工程构建的原页面，保留原页面的 `/models` 等根路径资源；
- Unity Player 加载 `unity/ForgeMind-U1.exe`，只负责三维渲染；
- WebView2 ↔ 宿主 ↔ Unity 使用 `forgemind.unity.bridge.v1` 和本机命名管道通信；
- Web 仍负责所有按钮、面板、权限、API/SSE、仿真、Agent、Patch、AI/语音和业务状态；
- Unity 启动失败时，Web 侧恢复 WebGL 画布。

## 构建前提

需要 Microsoft WebView2 SDK（仅构建时）和 Visual C++（推荐使用官方 Win32 工具链）。SDK 不直接提交到仓库，构建脚本应从 NuGet 还原 `Microsoft.Web.WebView2`，并把对应 `WebView2Loader.dll` 放进安装包。运行机器需要 WebView2 Runtime；安装器必须先检查运行时，缺失时引导官方 Evergreen Runtime 安装。当前宿主已在本机完成 x64 编译。运行时宿主使用 WebView2 CompositionController + DirectComposition，并在窗口消息层转发鼠标、滚轮、拖动和首次激活事件；编译使用 `/utf-8` 保证中文窗口标题按 UTF-8 源码解释。

```powershell
$env:FORGEMIND_DESKTOP = '1'
npm.cmd run build
cmake -S desktop-host -B desktop-host/build -DWEBVIEW2_SDK='D:/deps/Microsoft.Web.WebView2'
cmake --build desktop-host/build --config Release
```

当前宿主源码已经具备 WebView2 CompositionController、透明 DirectComposition 视觉树、虚拟 HTTPS 资源映射、Unity Player、视口消息、命名管道和鼠标输入转发；Unity 启动后先隐藏，收到 WebView2 的 `.fm-viewport` 矩形后才作为子窗口显示，避免覆盖浏览器工作台。最终 SFX 安装包已生成并通过自解压、WebView2 登录页和 Unity 隐藏启动检查。Web 全功能回归、目标电脑 500+ 精细模型 120 FPS 和正式发布门禁仍未完成。
