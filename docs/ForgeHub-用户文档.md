# ForgeHub 用户文档

> 版本：2026-09-07 · 当前状态：本地工业资源库与 Web CAD 已接入

## 1. 模块定位

ForgeHub 是 Forge 生态中的工业资源与模型构建入口。它把设备、零件、材料、工程属性、建模历史和装配关系组织为可保存、可恢复、可继续编辑的资源，并通过受版本约束的项目包和资源包交给 ForgeMind 使用。

## 2. 进入 ForgeHub

1. 使用根目录 `启动ForgeMind.cmd` 或 `start-forgemind.bat` 启动完整环境；启动器会同时检查 ForgeMind、ForgePass 后端和 ForgeHub。
2. 从 ForgeMind 官网顶部导航、页脚或 `/forgehub` 进入；点击 ForgeHub 后固定先显示 ForgePass 身份页，不直接跳过产品入口。
3. 完成 ForgePass 登录后，门户才把会话通过 URL 片段交给 ForgeHub；ForgeHub 随即移除片段并调用 `/api/auth/me` 复核身份。
4. 本地 ForgeHub 默认地址为 `http://127.0.0.1:3000/`。直接访问且没有有效 ForgePass 会话时，只显示返回登录入口，不加载 CAD 工作区。
5. 进入 ForgeHub 后可随时点击顶栏右侧“返回 ForgeMind”，回到当前主机 5173 端口的 ForgeMind 门户首页。

## 3. 当前可用能力

- **内置参考模型**：ForgeHub 自带 13 个 GLB，位于子项目自己的 `public/models/`，全部可从工作台“外观参考模型”列表选择；生产构建会把它们复制到 ForgeHub 的 `dist/client/models/`。这些模型是只读外观参考，不等于可编辑 B-Rep。
- **高精度资源模型**：CNC、机器人、冲压机、输送设备、机加工壳体、伺服电机、托盘缓存架和对向输送接口盒统一使用 `cad-resource-<resourceId>-precision-v2` 精度文档。首次从资源卡进入时才生成并写入浏览器会话/本地存储；内存缓存只保存不可变原型，每次打开都会深拷贝，编辑一个项目不会污染另一个项目。
- **项目恢复与清理**：普通 `/cad` 进入空白自由建模项目，不会静默恢复上一次的大模型；工作项目下拉框在用户聚焦或点击时才读取。旧版 `B-Rep`/组合资源文档会在读取列表和恢复会话时清理，用户自建项目不会被删除。资源模型还可以在“可编辑模型”和“高精细展示”之间切换。

- 资源库：浏览设备、材料和产品，搜索、筛选并组织建模清单。
- 自由建模：草图、拉伸、旋转、扫掠、放样、孔、圆角、倒角、抽壳、阵列、直接编辑和多实体操作。
- 曲线与曲面：B-Spline/NURBS、控制网、曲面片、裁剪、缝合、偏移、加厚、连续性和曲率检查。
- 精确内核：OCCT/WASM 根据设计历史重建 B-Rep；Three.js 负责显示、选择与视口交互。
- 数据交换：STEP 导入/导出、ForgeMind CAD 项目包和 `forgemind-resource-pack` v1 资源包导入/导出。
- 特征历史：重建、依赖追踪、抑制/恢复、排序、回退、删除及撤销/重做。
- 装配：组件实例、固定、重合、距离、同心、角度、转动/滑动配合、自由度求解和 BOM。
- 工程检查：材料、密度、公差、工艺、质量估算及机械细节风险提示。
- 本地建模 Agent：把自然语言用途和尺寸整理为可编辑的确定性建模程序；Agent 与手工工作台共用同一数据结构和重建器。
- 本地项目：浏览器内自动保存、项目切换、跨会话恢复和文件导入/导出。

完整演示顺序见 `forgemind-resource-hub/ForgeMind_完整功能演示操作流程.txt`，实现逻辑和数学边界见 `forgemind-resource-hub/ForgeMind_项目功能与技术逻辑说明.txt`。

## 4. 与 ForgeMind、ForgeCloud 的交换

ForgeHub 当前通过文件契约接入 ForgeMind：资源包必须通过格式、版本、资源编号、尺寸、端口和建模字段校验；ForgeMind 导入后仍要执行自己的用户归属、模型包围盒、端口、碰撞和仿真门禁。ForgeCloud 已有资源 manifest、许可证、依赖、Blob 和不可变版本能力，但 ForgeHub 尚未直接调用这些发布 API，因此“本地导出完成”不等于“云端资源已经发布”。

## 5. 当前边界

- ForgeHub 不执行 ForgeMind 的工厂仿真、寻路、物料守恒或布局验证。
- ForgeHub 不直接修改 ForgeMind 工厂存档；交换通过显式导入/导出完成。
- ForgeHub 不提供现场设备控制。
- 项目主要保存在当前浏览器，本地工作区不等于多人云协同或 PDM。
- 公共资产市场、ForgeCloud 直接发布、Fork、依赖治理和审批流仍未完成。
- 内置工业 GLB 仅按当前来源审计边界用于本地开发、教学和演示；公开或商业再分发前必须逐文件确认授权。

## 6. 独立开发与验证

```powershell
cd forgemind-resource-hub
npm.cmd ci
npm.cmd run build
npm.cmd test
```

独立启动可运行 `forgemind-resource-hub/START_FORGEMIND.bat`，但没有运行 ForgePass 后端时无法进入受保护工作区。
