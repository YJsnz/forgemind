# ForgeMind Desktop Host

这是 Windows 混合客户端的最小宿主：WebView2 加载 `web/dist`，Unity Player 作为子窗口覆盖 Web 三维视口；宿主启动时自动拉起同目录 `backend/forgemind-backend-0.1.0.jar`，关闭时回收自己启动的后端进程。业务页面、权限、后端 API、仿真和 Agent 仍是 Web 代码；宿主负责窗口生命周期、后端进程、`window.chrome.webview` 消息与 Unity 命名管道之间的转发。

构建依赖 Microsoft WebView2 SDK、Visual Studio C++ x64 工具链和 WebView2 Runtime。默认 SDK 路径为 `D:/deps/Microsoft.Web.WebView2`，也可通过 `FORGEMIND_WEBVIEW2_SDK` 覆盖。后端默认使用本机 MySQL `127.0.0.1:3306/forgemind`，数据库需要先运行；开发启动可传入 `-forgemindBackend` 和 `-forgemindJava` 覆盖路径。
