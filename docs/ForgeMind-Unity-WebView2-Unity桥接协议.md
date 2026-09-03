# ForgeMind WebView2 ↔ Unity 三维渲染桥接协议

> 状态：v1 草案，随混合客户端实现同步更新  
> 目标：Web 页面和业务逻辑保持不变；Windows 微端由 Unity 独占三维渲染表面，WebGL 仅作为浏览器/原生失败时的回退路径

## 1. 边界

Windows 客户端由 WebView2 承载当前 ForgeMind React 应用。登录、项目权限、存档、编辑校验、仿真、Agent、自动巡检、生成式方案、Patch 审批、资源导入、视觉检测和 AI/语音全部继续走现有 Web 代码与后端接口。

Unity 不读取 MySQL，不持有用户令牌，不决定坐标/碰撞/物料/寻路/产能，也不保存业务存档。Unity 只接收三维呈现所需的结构投影和低频运行态，负责高模加载、相机、选择命中、动画呈现和原生 GPU 渲染。

## 2. 传输层

- Web → 宿主：WebView2 `window.chrome.webview.postMessage`。
- 宿主 → Web：WebView2 `CoreWebView2.PostWebMessageAsJson`，注入为 `message` 事件。
- 宿主 ↔ Unity：本机命名管道，默认管道名由宿主生成并通过 Unity 启动参数 `-forgemindPipe <name>` 传入；消息以 UTF-8 JSON 单行分隔。
- 只有宿主可以同时连接 WebView2 和 Unity。网页不能直接连接命名管道，Unity 不能直接调用网页 API。
- 所有消息必须带 `protocol: "forgemind.unity.bridge.v1"`、`type` 和 `requestId`（事件消息可使用空字符串）。未知协议版本必须拒绝并回报 `bridge.error`。

## 3. Web → Unity 消息

### 3.1 场景投影

```json
{
  "protocol": "forgemind.unity.bridge.v1",
  "type": "scene.replace",
  "requestId": "scene-42",
  "payload": {
    "projectId": "...",
    "projectVersion": "...",
    "activeFloor": 1,
    "visibleFloors": [1, 2],
    "save": { "version": 6, "name": "...", "floorCount": 2, "floorNames": [], "objects": [], "items": [], "recipes": [], "machineDefinitions": [] }
  }
}
```

`save` 使用当前 Web `FactorySave` 结构。Unity 可以忽略不影响渲染的字段，但不能修改或回写它们。完整替换用于低频结构变化；仿真运行时不销毁并重建整棵场景树。

### 3.2 运行态快照

```json
{
  "protocol": "forgemind.unity.bridge.v1",
  "type": "simulation.snapshot",
  "requestId": "snapshot-91",
  "payload": { "projectId": "...", "projectVersion": "...", "simSnapshot": {} }
}
```

`simSnapshot` 使用当前 Web `SimulationSnapshot` 结构。Unity 只更新物料、设备状态灯、AGV、无人机和其他表现层，不产生业务指标。

### 3.3 视图和交互

- `viewport.rect`：网页三维视口在 WebView2 客户区内的 CSS 像素矩形、设备像素比和可见状态，供宿主布局 Unity 渲染表面。
- `view.floor`：当前楼层、可见楼层集合和楼层高度上下文。
- `selection.set`：Web 已确定的选择集合，Unity 同步高亮。
- `camera.set`：Web 视图切换或相机预设发生变化时同步目标相机。
- `bridge.shutdown`：网页退出、项目切换或窗口关闭时停止渲染并释放资源。

Unity 产生的选择必须回传 Web，由 Web store 执行真正的选择、详情和编辑行为；Unity 不直接打开业务面板。

## 4. Unity → Web 消息

- `bridge.ready`：协议版本、Unity 客户端版本、渲染后端、设备信息和能力开关。
- `scene.ack`：场景投影已接收，包含对象数、缺失模型 ID 和错误列表。
- `object.selected`：用户在 Unity 中命中的对象 ID；空 ID 表示取消选择。
- `camera.changed`：相机拖动完成或节流后的位置、目标和缩放，仅作为 Web 状态同步，不写业务存档。
- `render.stats`：FPS、CPU/GPU frame time、Draw Call、三角形、显存和资源加载状态，仅用于 Web 性能浮层和日志。
- `bridge.error`：协议、模型、渲染设备或窗口合成错误，必须带可读错误码和 requestId。

## 5. 生命周期和降级

1. 宿主创建 WebView2，加载与浏览器相同的 Web dist，并注入客户端标识。
2. Unity Player 以命名管道参数启动，发送 `bridge.ready`。
3. Web 发送当前场景、快照和视口矩形；宿主将 Unity 渲染表面放到对应视口。
4. Web 页面继续处理全部业务输入。Unity 只接管 3D 区域的鼠标命中和相机手势，并将结果回传。
5. Unity 启动失败、管道断开、模型缺失或合成失败时，Web 必须恢复原 WebGL Canvas，并显示“原生 3D 不可用，已切换 WebGL”状态；不能隐藏业务入口。
6. 业务保存、Patch 应用、回滚和权限失败不通过 Unity 绕过；Web 仍是唯一提交方。

## 6. 性能与安全门禁

- 场景结构变更才发送 `scene.replace`；运行态按 Web 已有低频快照节奏发送，不能每帧跨进程传输整个存档。
- 高速 AGV/无人机位置优先由 Unity 使用快照插值表现，业务位置和库存仍以 Web 仿真结果为准。
- 不在桥接消息中传递 bearer token、AI 密钥、数据库凭据或用户私有模型内容之外的敏感信息。
- 所有跨进程字符串设置最大长度和队列上限；宿主关闭时必须断开管道并回收 Unity Player。
- S-03 基准必须同时记录 WebGL 回退和 Unity 渲染路径的画质截图、可见三角形、CPU/GPU P95/P99、显存、视口合成开销和首帧时间。
