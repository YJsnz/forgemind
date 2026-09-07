# CAD 工作台模块边界

- `OcctKernelDebug.tsx`：工作台编排、OCCT 生命周期、视口与建模事务。
- `workbenchTypes.ts`：工作台共享类型，不包含界面或运行时逻辑。
- `featurePresentation.ts`：特征中文名称、摘要和可编辑参数映射。
- `FeatureHistoryTree.tsx`：左侧特征历史搜索、筛选和依赖状态展示。
- `FeatureHistoryEditors.tsx`：需要专用表单的曲面历史编辑器。
- `ImportedFeatureRecoveryPanel.tsx`：STEP/B-Rep 特征分析、恢复队列和恢复会话界面。
- `EngineeringPropertiesPanel.tsx`：材料、公差、工艺、体积和质量属性界面。
- `ProfessionalSketcher.tsx`：专业草图验证入口。
- `CadViewportRenderLoop.ts`：按需合并视口重绘，并维持旋转阻尼帧。
- `CadViewportInspection.ts`：斑马纹、曲率热图与曲率梳状线。
- `CadViewportSelection.ts`：实体、面及持久拓扑高亮。
- `CadViewportControlNet.ts`：视口内的曲面位置、切向、曲率和形状控制点；只提交毫米制设计参数。
- `ReferenceModelCache.ts`：精细展示模型的只读几何缓存与实例材质隔离。

几何计算、特征求值和持久拓扑继续位于 `core/`。界面模块只提交设计数据，不直接保存 Three.js 网格或 OCCT 运行时句柄。
