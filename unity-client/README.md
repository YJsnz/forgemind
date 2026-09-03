# ForgeMind Unity Native Client

这是 ForgeMind Windows 混合客户端的 Unity/Tuanjie 三维渲染工程。最终产品由 WebView2 承载现有 React Web 工作台，Unity 只替换中心 WebGL 三维渲染表面；当前已完成 U0/U1 基础链路、模型投影、三维资产导入、WebView2↔Unity v1 桥接、原生宿主和单文件安装包构建。混合启动时 Unity 的原生调试壳与性能叠加层会自动关闭，浏览器页面保持原样。

## 打开方式

1. 安装项目锁定的 Tuanjie `2022.3.62t13`（1.10 系列）或经 U0 基准锁定的兼容补丁版本。
2. 用 Unity Hub 添加本目录 `D:/Code/factory/unity-client`。
3. 首次打开后等待 Package Manager 完成 URP/Input System 包解析。
4. 首次打开后执行菜单 `ForgeMind/Create U1 Benchmark Scene`，生成 `Assets/ForgeMind/Scenes/FactoryBenchmark.unity`，再进入高模基准。

如果立项时采用其他 Unity/Tuanjie LTS，必须同步修改 `ProjectSettings/ProjectVersion.txt`、Packages 版本、本文档和专题规划，并重新跑 U1 基准；不能只改版本号后直接宣称性能可比。

## 当前边界

- Unity 不直接访问 MySQL，只通过 ForgeMind 后端 API。
- 最终业务 UI、权限、API/SSE、编辑、生产资料、仿真、Agent、Patch 和 AI/语音均由 WebView2 中的现有 Web 代码提供；Unity 不复制这些功能。
- 当前 Unity 先支持存档/快照只读验证和本机命名管道桥接；C# 仿真不作为正式事实源。
- 工业模型同步由 `tools/sync-unity-assets.ps1` 执行，源文件仍以 `public/models/` 和资产审计为准。
- `Library/`、构建包和 Unity 生成的工程文件不进入仓库。

## 当前构建状态

- 已锁定本机 Tuanjie `2022.3.62t13`（产品标识为 Tuanjie 1.10 系列）作为 U0/U1 基线。
- 已创建运行时/编辑器程序集、后端 API 占位边界、FactorySave/SimulationSnapshot DTO、只读运行时、全 Web 功能覆盖目录、性能采集器和 U1 基准场景生成器。
- 已激活 Tuanjie Personal，有效完成脚本编译、Package Manager 解析、场景生成、GLB 导入和 Windows Player 构建。
- glTFast `6.16.1` 已锁入 `Packages/manifest.json`；当前 U1 场景包含 8 个原始 GLB 模型实例，Windows Player 默认图形 API 为 D3D12，D3D11 回退。
- 原生调试壳仅供独立 Player 调试，混合启动参数 `-forgemindPipe` 下不显示；最终业务 UI 由 WebView2 中的现有 Web 代码提供。`ForgeMindNativeBridge` 使用 `forgemind.unity.bridge.v1` 接收 Web 场景、快照、楼层和选择消息。
- 当前阶段暂不把 C# 仿真写入正式存档，所有业务事实继续来自 ForgeMind 后端和确定性仿真协议。

## 构建 U1 Player

```powershell
& 'D:\Unity\2022.3.62t13\Editor\Tuanjie.exe' -batchmode -nographics -quit -projectPath 'D:\Code\factory\unity-client' -executeMethod 'ForgeMind.Client.Editor.ForgeMindProjectBootstrap.BuildU1WindowsPlayer'
```

产物位于 `Builds/ForgeMind-U1/ForgeMind-U1.exe`。`-nographics` 只适合构建/启动链路检查；帧率和画质必须在真实 D3D12/D3D11 GPU 下测量。

## 构建 Windows 安装包

在 Windows 上运行：

```powershell
& 'D:\Code\factory\scripts\build-unity-installer.ps1'
```

安装包位于 `Builds/ForgeMind-Setup.exe`。当前安装包已通过自解压、WebView2 登录页启动、Unity 隐藏和 D3D12 Player 启动检查；在完整 Web 功能矩阵和 S-03 性能门禁通过前，不将其标记为正式发布版。

完整范围、性能门禁和迁移顺序见 [`../docs/ForgeMind-Unity原生客户端规划与要求.md`](../docs/ForgeMind-Unity原生客户端规划与要求.md)。
