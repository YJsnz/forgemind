import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const text = async (path) => readFile(new URL(path, import.meta.url), "utf8");

test("V10 exposes one Free Modeling entry instead of competing concept/pro CAD routes", async () => {
  const page = await text("../app/page.tsx");
  const route = await text("../app/cad/CadRoute.tsx");
  assert.match(page, />自由建模</);
  assert.doesNotMatch(page, />概念建模</);
  assert.match(page, /openResourceInWorkbench = \(resourceId: string\) => openResourceInProfessionalCad\(resourceId\)/);
  assert.match(page, /openResourcePackInFreeModeling/);
  assert.match(page, /buildCadDocumentFromResourceTemplates/);
  assert.match(page, /旧手绘\/融合工作台仅用于历史项目兼容/);
  assert.match(route, /FORGEMIND \/ FREE MODELING/);
  assert.match(route, /SKETCH → FEATURE → B-REP \/ ONE WORKFLOW/);
});

test("V10 unified Sketch Editor edits real Sketch data and excludes legacy freehand spline", async () => {
  const source = await text("../app/cad/UnifiedSketchEditor.tsx");
  assert.match(source, /Tool = "select" \| "line" \| "rectangle" \| "circle" \| "arc" \| "point"/);
  assert.doesNotMatch(source, /\| "spline"/);
  assert.match(source, /solveSketch\(draft\)/);
  assert.match(source, /Coincident|coincident/);
  assert.match(source, /horizontal/);
  assert.match(source, /vertical/);
  assert.match(source, /driving:true/);
  assert.match(source, /完成草图/);
});

test("V10 Part Studio commits sketch edits transactionally and rebuilds downstream B-Rep", async () => {
  const source = await text("../app/kernel-debug/OcctKernelDebug.tsx");
  assert.match(source, /UnifiedSketchEditor/);
  assert.match(source, /commitIntegratedSketch/);
  assert.match(source, /commitCadHistoryEdit/);
  assert.match(source, /最后成功模型/);
  assert.match(source, /createUnifiedSketch/);
  assert.match(source, /编辑完整草图/);
  assert.match(source, /XY 草图/);
  assert.match(source, /面上草图/);
  assert.match(source, /extrudeSelectedSketch/);
});

test("V10 keeps legacy parametric hybrid sketch modes as compatibility data, not primary navigation", async () => {
  const source = await text("../app/page.tsx");
  assert.match(source, /LEGACY \/ 兼容操作/);
  assert.match(source, /旧参数部件/);
  assert.match(source, /旧融合精修/);
  assert.match(source, /旧手绘草图/);
  assert.doesNotMatch(source, /<button className=\{screen === "workbench"[^>]*>概念建模<\/button>/);
});
