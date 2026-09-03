# ForgeMind Unity 客户端重建计划

> 状态：2026-08-31；这是当前 Unity 客户端的执行入口。旧的“Unity 自己承载业务 UI”方案不再作为实现目标。

## 目标

Windows 客户端继续使用当前 React/Web 工作台、后端、权限、存档、仿真、Agent、Patch、AI 与语音。只有工厂中心三维表面在桌面环境由 Unity/Tuanjie 原生渲染替换，浏览器端仍固定使用 WebGL。

## 当前架构

```text
WebView2 / React（业务事实源、全部 UI）
        │  window.chrome.webview.postMessage
Windows desktop-host（窗口合成、输入转发、生命周期）
        │  forgemind.unity.bridge.v1 / named pipe
Unity Player（GLB、高精度模型、相机、选择、表现层快照）
```

Unity 不读取数据库、不持有 bearer token、不写正式存档、不计算碰撞/寻路/物料守恒。Web 发送 `FactorySave`、楼层、选择、相机和 `SimulationSnapshot` 投影；Unity 只回传选择、相机变化、渲染统计和错误。Unity 不可用时 WebGL 必须继续可用。

## 分阶段交付

1. **R0 桥接恢复**：恢复 `desktop-host/`，标准 WebView2 Controller 与裁剪定位的 Unity 子窗口可启动、定位、关闭，桥接握手可验证。
2. **R1 三维等价**：接入现有 Unity 模型注册表、楼层/坐标/朝向、物料/车辆快照、选择和镜头预设；真实存档逐对象核对。
3. **R2 交互闭环**：Unity 只处理三维视口的命中选择和镜头手势，建造、编辑、仿真控制和业务确认仍由 Web 控件处理。
4. **R3 性能门禁**：在真实 GPU 上比较 WebGL/Unity 的首帧、CPU/GPU P95/P99、Draw Call、三角形、显存、镜头移动稳定性和 500+ 精细模型画质。

## 不提前承诺

当前工程已具备 Unity 投影和协议骨架，但在 R0/R1/R3 验证完成前，不宣称 Web/Unity 三维全量等价，也不宣称 120 FPS。Unity 构建产物、日志和性能报告不作为源码资产提交。
