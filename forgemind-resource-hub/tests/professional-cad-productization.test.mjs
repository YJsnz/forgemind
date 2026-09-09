import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = async (path) => readFile(new URL(path, import.meta.url), "utf8");
const text = async (path) => {
  const primary = await read(path);
  if (path !== "../app/kernel-debug/OcctKernelDebug.tsx") return primary;
  const modules = await Promise.all([
    "../app/kernel-debug/workbenchTypes.ts",
    "../app/kernel-debug/featurePresentation.ts",
    "../app/kernel-debug/FeatureHistoryEditors.tsx",
    "../app/kernel-debug/FeatureHistoryTree.tsx",
    "../app/kernel-debug/ImportedFeatureRecoveryPanel.tsx",
    "../app/kernel-debug/EngineeringPropertiesPanel.tsx",
    "../app/kernel-debug/CadWorkbenchToolbar.tsx",
    "../app/kernel-debug/CadCommandPalette.tsx",
    "../app/kernel-debug/CadAgentDrawer.tsx",
    "../app/kernel-debug/CadReadinessDrawer.tsx",
    "../app/kernel-debug/workbenchIdentity.ts",
    "../app/kernel-debug/CadViewportMath.ts",
    "../app/kernel-debug/CadViewportInspection.ts",
    "../app/kernel-debug/CadViewportSelection.ts",
    "../app/kernel-debug/CadViewportRenderLoop.ts",
    "../app/kernel-debug/ReferenceModelCache.ts",
  ].map(read));
  return [primary, ...modules].join("\n");
};

test("today-mainline Resource Hub persists a B-Rep CadDocument and launches the Part Studio route", async () => {
  const page = await text("../app/page.tsx");
  const route = await text("../app/cad/CadRoute.tsx");
  assert.match(page, /buildCadDocumentFromResourceTemplate/);
  assert.match(page, /saveCadDocumentHandoff/);
  assert.match(page, /openResourceInProfessionalCad/);
  assert.match(page, />自由建模</);
  assert.match(page, /\/cad\?mode=part&resourceId=/);
  assert.match(route, /loadCadDocumentHandoff/);
  assert.match(route, /<OcctKernelDebug embedded initialDocument=\{document\}/);
});

test("plain free-modeling entry opens a blank document without restoring or scanning heavy projects", async () => {
  const page = await text("../app/page.tsx");
  const route = await text("../app/cad/CadRoute.tsx");
  assert.match(page, /openProfessionalCad = \(\) => \{ void createNewProfessionalCad\(\); \}/);
  assert.match(route, /const hasExplicitProject = Boolean\(resourceId \|\| documentId\)/);
  assert.doesNotMatch(route, /latest: !resourceId && !documentId/);
  assert.match(route, /createUnifiedCadDocument\("未命名自由建模项目"\)/);
  assert.match(route, /onFocus=\{loadAvailableProjects\}/);
});

test("large editable models use responsive viewport tessellation while the presentation demo keeps full quality", async () => {
  const source = await text("../app/kernel-debug/OcctKernelDebug.tsx");
  const rebuild = await text("../core/rebuild/RebuildEngine.ts");
  assert.match(source, /preserveDemoQuality = document\.id === "forgemind-smart-precision-cell-demo"/);
  assert.match(source, /visibleBodyCount > 60/);
  assert.match(source, /renderedBodyCount % 6 === 0/);
  assert.match(source, /deferEdgePolylines/);
  assert.match(source, /deferredEdgeBodies/);
  assert.match(source, /window\.requestAnimationFrame/);
  assert.match(rebuild, /processedFeatureCount % 4 === 0/);
  assert.match(rebuild, /yieldToBrowser/);
});

test("today-mainline professional workspace exposes an Onshape-style Feature List and parameter inspector", async () => {
  const source = await text("../app/kernel-debug/OcctKernelDebug.tsx");
  assert.match(source, /FEATURE LIST/);
  assert.match(source, /PROPERTIES/);
  assert.match(source, /editableParameters/);
  assert.match(source, /commitFeatureParameter/);
  assert.match(source, /toggleFeatureSuppression/);
});

test("today-mainline feature history supports readable dependency-safe management", async () => {
  const source = await text("../app/kernel-debug/OcctKernelDebug.tsx");
  for (const operation of ["renameHistoryFeature", "moveHistoryFeature", "setHistoryFeatureSuppressed", "rollbackHistoryToFeature", "deleteHistoryFeatureCascade", "featureHistoryRelations"]) {
    assert.match(source, new RegExp(operation));
  }
  for (const label of ["特征历史", "搜索历史特征", "清除历史搜索和筛选", "直接输入", "直接下游", "上游", "重命名", "恢复所需特征", "回退至此"]) {
    assert.match(source, new RegExp(label));
  }
  assert.match(source, /commitCadHistoryEdit/);
  assert.match(source, /特征历史修改未通过重建，已保留原模型/);
  assert.match(source, /将删除所选特征及其下游/);
});

test("today-mainline professional viewport supports orbit, fit, standard views, section and exact B-Rep measurement", async () => {
  const source = await text("../app/kernel-debug/OcctKernelDebug.tsx");
  assert.match(source, /new OrbitControls\(/);
  assert.match(source, /setView\?: \(view: StandardCadView\)/);
  assert.match(source, /setSection\?: \(enabled: boolean, offsetMm: number\)/);
  assert.match(source, /getShapeProperties/);
  assert.match(source, /getFaceInfo/);
  assert.match(source, /getEdgeInfo/);
});

test("today-mainline toolbar keeps unstable variable fillet visibly unavailable", async () => {
  const source = await text("../app/kernel-debug/CadWorkbenchToolbar.tsx");
  assert.match(source, /variableFilletAvailable/);
  assert.match(source, /可变圆角\{variableFilletAvailable \? "" : "（暂不可用）"\}/);
});

test("today-mainline multi-body viewport maps triangles and edge polylines back to runtime topology", async () => {
  const source = await text("../app/kernel-debug/OcctKernelDebug.tsx");
  assert.match(source, /faceSelectionFromTriangle/);
  assert.match(source, /edgeSelectionFromPolyline/);
  assert.match(source, /selectedTopologyRef\.current = selected\.topology/);
  assert.match(source, /currentFeatureIdRef\.current = sourceFeatureId/);
});


test("today-mainline professional workspace creates real constrained Sketch + Feature design intent", async () => {
  const source = await text("../app/kernel-debug/OcctKernelDebug.tsx");
  assert.match(source, /appendQuickPrimitive/);
  assert.match(source, /appendNewPrimitive/);
  assert.match(source, /快速方块/);
  assert.match(source, /快速圆柱/);
  assert.match(source, /commitSketchDimension/);
  assert.match(source, /solveSketch/);
  assert.match(source, /拉伸 · 新实体/);
  assert.match(source, /拉伸 · 添加/);
  assert.match(source, /拉伸 · 移除/);
  assert.match(source, /UnifiedSketchEditor/);
  for (const solidTool of ["旋转实体", "扫掠实体", "放样实体", "revolveSelectedSketch", "createSolidFromSketchSet"]) assert.match(source, new RegExp(solidTool));
  for (const sectionTool of ["commitSketchPlaneOffset", "duplicateSketchAsSection", "基准面位置", "复制为截面"]) assert.match(source, new RegExp(sectionTool));
});

test("today-mainline Part Studio exposes transactional precision refinement tools", async () => {
  const source = await text("../app/kernel-debug/OcctKernelDebug.tsx");
  for (const handler of ["applyPrecisionBodyTransform", "applyPrecisionBodyBoolean", "applyPrecisionDraft", "applyPrecisionRib"]) {
    assert.match(source, new RegExp(handler));
  }
  for (const label of ["精确变换", "多实体布尔", "拔模 · 所选实体面", "加强筋 · 开放直线草图"]) {
    assert.match(source, new RegExp(label));
  }
  assert.match(source, /commitCandidateDocument\(current, candidate/);
  assert.match(source, /type: "bodyTransform"/);
  assert.match(source, /type: "bodyBoolean"/);
  assert.match(source, /type: "draft"/);
  assert.match(source, /type: "rib"/);
});

test("today-mainline Part Studio exposes a local demand-driven B-Rep modeling Agent", async () => {
  const source = await text("../app/kernel-debug/OcctKernelDebug.tsx");
  assert.match(source, /✦ 建模 Agent/);
  assert.match(source, /createLocalCadAgentPlan/);
  assert.match(source, /applyLocalCadAgentPlan/);
  assert.match(source, /分析需求并生成方案/);
  assert.match(source, /确认并建立模型/);
  assert.match(source, /commitCandidateDocument\(current, candidate/);
});

test("today-mainline Part Studio keeps every tool visible and presents engineering data in plain Chinese", async () => {
  const source = await text("../app/kernel-debug/OcctKernelDebug.tsx");
  const styles = await text("../app/globals.css");
  assert.doesNotMatch(source, /CadExperienceMode|使用基础模式开始|进入完整工作台/);
  assert.doesNotMatch(styles, /is-guided|cad-command-group-advanced|cad-advanced-panel/);
  for (const label of ["模型类型", "材料", "密度", "模型公差", "建议工艺"]) {
    assert.match(source, new RegExp(label));
  }
  assert.match(styles, /\.cad-readable-data/);
});

test("today-mainline Part Studio makes common commands discoverable by search and keyboard", async () => {
  const source = await text("../app/kernel-debug/OcctKernelDebug.tsx");
  assert.match(source, /event\.key\.toLowerCase\(\) === "k"/);
  assert.match(source, /Ctrl \/ Cmd \+ K/);
  assert.match(source, /搜索命令，例如：草图、选择面、适合窗口/);
  for (const command of ["需求建模 Agent", "新建 XY 草图", "选择实体", "选择面", "选择边", "ISO 斜上方视图", "导出 CAD 项目"]) {
    assert.match(source, new RegExp(command));
  }
});

test("today-mainline feature history is fully linked to desktop keyboard workflows", async () => {
  const source = await text("../app/kernel-debug/OcctKernelDebug.tsx");
  assert.match(source, /featureHistoryShortcutRef/);
  assert.match(source, /historySearchInputRef/);
  for (const key of ["F2", "ArrowUp", "ArrowDown", "Home", "End", "Space", "Shift+R", "Delete", "Ctrl/Cmd+Shift+F"]) {
    assert.ok(source.includes(key));
  }
  for (const command of ["搜索特征历史", "重命名所选特征", "抑制或恢复所选特征", "回退至所选特征", "删除所选特征及下游"]) {
    assert.match(source, new RegExp(command));
  }
});

test("today-mainline Part Studio reports engineering readiness without overstating validation", async () => {
  const source = await text("../app/kernel-debug/OcctKernelDebug.tsx");
  const readiness = await text("../core/engineering/CadEngineeringReadiness.ts");
  for (const check of ["B-Rep 几何", "可编辑历史", "材料、公差与工艺", "本地保存", "交付准备"]) {
    assert.match(readiness, new RegExp(check));
  }
  assert.match(source, /不替代正式工程图、强度分析、装配干涉和制造工艺验证/);
  assert.match(source, /readinessScore/);
  assert.match(source, /analyzeCadEngineeringReadiness/);
});

test("today-mainline unified sketch editor exposes exact cleanup, replication and full common constraints", async () => {
  const source = await text("../app/cad/UnifiedSketchEditor.tsx");
  for (const operation of ["trimSketchEntity", "extendLineToEntity", "offsetSketchEntity", "offsetLineChain", "mirrorSelection", "patternSelection", "projectSelectedEdge"]) assert.match(source, new RegExp(operation));
  for (const label of ["修剪", "延伸", "偏移", "关于 X 镜像", "线性阵列", "投影模型边", "平行", "垂直相交", "相切", "同心", "相等", "中点"]) assert.match(source, new RegExp(label));
  assert.match(source, /按住 Shift 可多选/);
});

test("today-mainline product workbench exposes STEP interchange and readable editable engineering totals", async () => {
  const source = await text("../app/kernel-debug/OcctKernelDebug.tsx");
  for (const label of ["导入 STEP", "导出 STEP", "项目工程汇总", "估算总质量", "总表面积", "保存工程数据"]) assert.match(source, new RegExp(label));
  assert.match(source, /volume \* density \/ 1_000_000_000/);
  assert.match(source, /projectSelectedEdgeIntoSketch/);
  assert.match(source, /applySelectedBodyEngineering/);
});
