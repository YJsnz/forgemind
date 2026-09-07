import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("build script is portable and the finished ForgeMind UI is rendered", async () => {
  const [packageJson, page, layout] = await Promise.all([
    readFile(new URL("package.json", root), "utf8"),
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/layout.tsx", root), "utf8"),
  ]);

  assert.match(packageJson, /"build": "vinext build"/);
  assert.doesNotMatch(packageJson, /WRANGLER_LOG_PATH/);
  assert.match(page, /ForgeMind Resource Hub/);
  assert.match(page, /设备设计工作台/);
  assert.doesNotMatch(page, /workbench-shell/);
  assert.match(layout, /title: "ForgeMind Resource Hub"/);
});

test("resource export carries a versioned schema and validation gate", async () => {
  const [page, schema] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("public/schemas/forgemind-resource-pack-v1.schema.json", root), "utf8"),
  ]);

  assert.match(page, /validateResourcePack/);
  assert.match(page, /schemaVersion: "1\.0\.0"/);
  assert.match(page, /modelReference/);
  assert.match(page, /资源包未导出/);
  assert.match(page, /GLTFExporter/);
  assert.match(page, /exportGlb/);
  assert.match(page, /model\/gltf-binary/);
  assert.match(schema, /"forgemind-resource-pack"/);
  assert.match(schema, /"minimumImporterVersion"|"schemaVersion"/);
});

test("workbench keeps sketch and parametric editing in incremental layers", async () => {
  const viewer = await readFile(new URL("app/ThreeWorkbench.tsx", root), "utf8");

  assert.match(viewer, /const parametricLayer = new THREE\.Group\(\)/);
  assert.match(viewer, /refreshParametricParts/);
  assert.match(viewer, /refreshSketchSolids/);
  assert.match(viewer, /onPartContextSelect/);
});

test("workbench cleanup is idempotent across mode switches", async () => {
  const viewer = await readFile(new URL("app/ThreeWorkbench.tsx", root), "utf8");

  assert.match(viewer, /let disposed = false/);
  assert.match(viewer, /if \(disposed\) return/);
  assert.match(viewer, /transformControls\.getHelper\(\)/);
  assert.match(viewer, /transformControls\.detach\(\)/);
  assert.match(viewer, /transformControls\.disconnect\(\)/);
  assert.match(viewer, /canvas\?\.removeEventListener\?\./);
  assert.match(viewer, /if \(canvas\?\.parentElement === element\)/);
});

test("CAD domain is isolated from the legacy Three.js implementation", async () => {
  const [types, document, adapter, units, tolerance] = await Promise.all([
    readFile(new URL("core/cad/CadTypes.ts", root), "utf8"),
    readFile(new URL("core/cad/CadDocument.ts", root), "utf8"),
    readFile(new URL("core/cad/LegacyCadAdapter.ts", root), "utf8"),
    readFile(new URL("core/cad/Units.ts", root), "utf8"),
    readFile(new URL("core/cad/Tolerance.ts", root), "utf8"),
  ]);

  assert.match(types, /GeometryBackend = "legacy-mesh" \| "brep"/);
  assert.match(types, /runtimeShapeId\?: string/);
  assert.match(document, /createCadDocument/);
  assert.match(document, /toSerializableCadDocument/);
  assert.doesNotMatch(document, /THREE\.|OCCT|OpenCascade/);
  assert.match(adapter, /part\.backend \?\? "legacy-mesh"/);
  assert.match(units, /CAD_INTERNAL_LENGTH_UNIT: LengthUnit = "mm"/);
  assert.match(tolerance, /DEFAULT_CAD_TOLERANCE/);
});

test("project operations and engineering review tools are included", async () => {
  const page = await readFile(new URL("app/page.tsx", root), "utf8");

  assert.match(page, /forgemind-active-project/);
  assert.match(page, /undoProject/);
  assert.match(page, /importProject/);
  assert.match(page, /manufacturingIssues/);
  assert.match(page, /transformSnap/);
  assert.match(page, /modelLoadStatus/);
  assert.match(page, /应用后复核/);
});

test("CAD workbench returns to the actual resource library route", async () => {
  const route = await readFile(new URL("app/cad/CadRoute.tsx", root), "utf8");
  assert.match(route, /window\.location\.href = "\/\?screen=library"/);
});

test("workbench offers safe project creation and direct selected-part removal", async () => {
  const page = await readFile(new URL("app/page.tsx", root), "utf8");

  assert.match(page, /const createNewProject/);
  assert.match(page, /＋ 新建/);
  assert.match(page, /const removeActivePart/);
  assert.match(page, /删除选中/);
  assert.match(page, /移除选中部件/);
});

test("project snapshots keep engineering metadata and migrate legacy files", async () => {
  const page = await readFile(new URL("app/page.tsx", root), "utf8");

  assert.match(page, /version: 2/);
  assert.match(page, /partEngineering/);
  assert.match(page, /normalizePartEngineering/);
  assert.match(page, /\[1, 2\]\.includes\(snapshot\.version\)/);
  assert.match(page, /已迁移工程属性/);
});

test("multi-plane sketching and assembly-to-sketch selection are available", async () => {
  const [page, viewer] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/ThreeWorkbench.tsx", root), "utf8"),
  ]);

  assert.match(page, /sketchViewportDock/);
  assert.match(page, /selectPartAndSyncSketch\(part\)/);
  assert.match(page, /directEditOutline/);
  assert.match(page, /DIRECT SOLID EDIT/);
  assert.match(page, /const displayedAssetPath = modelView === "reference" \? assetPath : "procedural"/);
  assert.match(page, /plane: sketchPlane/);
  assert.match(viewer, /export type SketchPlane/);
  assert.match(viewer, /cameraView/);
  assert.match(viewer, /plane === "right"/);
  assert.doesNotMatch(viewer, /proxyOnly/);
});

test("reference appearance and editable structure have separate, persistent states", async () => {
  const page = await readFile(new URL("app/page.tsx", root), "utf8");

  assert.match(page, /type ModelView = "editable" \| "reference"/);
  assert.match(page, /模型显示来源/);
  assert.match(page, /只读 GLB，不与参数部件叠加/);
  assert.match(page, /modelView, parts, strokes/);
  assert.match(page, /modelView === "reference" && \(uploadedModel \|\| assetPath !== "procedural"\)/);
});

test("primitive dimensions and exported geometry use the same semantics", async () => {
  const [page, viewer, geometry] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/ThreeWorkbench.tsx", root), "utf8"),
    readFile(new URL("app/cadGeometry.ts", root), "utf8"),
  ]);

  assert.match(viewer, /createParametricPartGeometry\(part\)/);
  assert.match(page, /createParametricPartGeometry\(part\)/);
  assert.match(geometry, /RoundedBoxGeometry/);
  assert.match(geometry, /geometry\.scale\(width, 1, depth\)/);
  assert.doesNotMatch(page, /new THREE\.BoxGeometry\(width, height, depth\)/);
  assert.match(page, /setDirectEditOutline\(outlineFromPart\(updatedPart, plane\)\)/);
});

test("imported GLB files keep their authored scale and fit through the camera", async () => {
  const viewer = await readFile(new URL("app/ThreeWorkbench.tsx", root), "utf8");

  assert.match(viewer, /const fitCameraToObject/);
  assert.match(viewer, /fitCameraToObject\(imported\)/);
  assert.doesNotMatch(viewer, /3\.5 \/ Math\.max\(size\.x, size\.y, size\.z/);
  assert.doesNotMatch(viewer, /imported\.scale\.setScalar/);
});

test("orthographic sketch views use an orthographic camera while retaining the unified orbit controls", async () => {
  const viewer = await readFile(new URL("app/ThreeWorkbench.tsx", root), "utf8");

  assert.match(viewer, /new THREE\.OrthographicCamera/);
  assert.match(viewer, /cameraView === "iso"/);
  assert.match(viewer, /controls\.enableRotate = true/);
  assert.match(viewer, /controls\.mouseButtons\.LEFT = THREE\.MOUSE\.ROTATE/);
  assert.match(viewer, /camera instanceof THREE\.OrthographicCamera/);
});

test("parametric parts can be selected and transformed directly in the viewport", async () => {
  const [page, viewer] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/ThreeWorkbench.tsx", root), "utf8"),
  ]);

  assert.match(viewer, /TransformControls/);
  assert.match(viewer, /onPartSelect/);
  assert.match(viewer, /onPartTransform/);
  assert.match(viewer, /transformControls\.attach\(selectedMesh\)/);
  assert.match(page, /commitViewportTransform/);
  assert.match(page, /视口操纵器/);
  assert.match(page, /左键拖拽旋转 · 单击选择/);
});

test("sketch entities distinguish closed solid profiles from reference geometry", async () => {
  const [page, viewer] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/ThreeWorkbench.tsx", root), "utf8"),
  ]);

  assert.match(viewer, /SketchEntityKind/);
  assert.match(viewer, /construction\?: boolean/);
  assert.match(page, /构造线/);
  assert.match(page, /pointsForSketchTool/);
  assert.match(page, /\["line", "circle", "arc", "spline", "rectangle", "construction", "point"\]/);
  assert.match(viewer, /!\["rectangle", "circle", "spline"\]\.includes\(kind\)/);
});

test("selected sketch entities expose millimetre dimensions that rebuild geometry", async () => {
  const page = await readFile(new URL("app/page.tsx", root), "utf8");

  assert.match(page, /activeSketchId/);
  assert.match(page, /sketchDimensionMm/);
  assert.match(page, /updateSketchDimension/);
  assert.match(page, /草图实体与尺寸/);
  assert.match(page, /直径 \(mm\)/);
  assert.match(page, /半径 \(mm\)/);
});

test("sketch profiles expose signed centre coordinates for precise feature placement", async () => {
  const page = await readFile(new URL("app/page.tsx", root), "utf8");

  assert.match(page, /定位尺寸 \/ POSITION/);
  assert.match(page, /中心 X \(mm\)/);
  assert.match(page, /中心 Y \(mm\)/);
  assert.match(page, /dimension === "centerX"/);
  assert.match(page, /dimension === "centerY"/);
  assert.match(page, /修改孔位或轮廓位置后/);
});

test("basic sketch constraints persist and solve horizontal, vertical, and fixed entities", async () => {
  const [page, viewer] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/ThreeWorkbench.tsx", root), "utf8"),
  ]);

  assert.match(viewer, /SketchConstraintKind/);
  assert.match(viewer, /constraints\?: SketchConstraintKind\[\]/);
  assert.match(page, /solveSketchConstraints/);
  assert.match(page, /toggleSketchConstraint/);
  assert.match(page, /points\[1\]\.y = points\[0\]\.y/);
  assert.match(page, /points\[1\]\.x = points\[0\]\.x/);
  assert.match(page, /该草图实体已固定/);
});

test("closed sketches own rebuildable extrude features in the feature history", async () => {
  const [page, viewer] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/ThreeWorkbench.tsx", root), "utf8"),
  ]);

  assert.match(viewer, /SketchExtrudeFeature/);
  assert.match(viewer, /feature\?\.enabled === false/);
  assert.match(page, /updateSketchFeature/);
  assert.match(page, /FEATURE HISTORY \/ 特征树/);
  assert.match(page, /featureName\(stroke\)/);
  assert.match(page, /featureDependencyText\(stroke\)/);
  assert.match(page, /featureDepth = stroke\.feature\?\.depth/);
});

test("viewport visibility supports hide, isolate, restore, and export filtering", async () => {
  const [page, viewer] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/ThreeWorkbench.tsx", root), "utf8"),
  ]);

  assert.match(viewer, /hidden\?: boolean/);
  assert.match(viewer, /mesh\.visible = !part\.hidden/);
  assert.match(page, /togglePartVisibility/);
  assert.match(page, /isolateActivePart/);
  assert.match(page, /showAllParts/);
  assert.match(page, /if \(part\.hidden\) return/);
  assert.match(page, /隔离选中部件/);
});

test("sketch profiles support through-all pocket features in viewport and GLB export", async () => {
  const [page, viewer] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/ThreeWorkbench.tsx", root), "utf8"),
  ]);

  assert.match(viewer, /operation: "extrude" \| "pocket"/);
  assert.match(viewer, /shape\.holes\.push\(hole\)/);
  assert.match(page, /贯穿切除/);
  assert.match(page, /targetId/);
  assert.match(page, /closedSketchProfiles/);
  assert.match(page, /pocket\.feature\.targetId === stroke\.id/);
  assert.match(page, /贯穿 \$\{featureName\(target\)\}/);
});

test("an extrusion can start a linked end-face pocket sketch", async () => {
  const page = await readFile(new URL("app/page.tsx", root), "utf8");

  assert.match(page, /nextPocketTargetId/);
  assert.match(page, /startPocketSketch/);
  assert.match(page, /顶面切除草图/);
  assert.match(page, /operation: "pocket"/);
  assert.match(page, /targetId: pocketTarget\.id/);
});

test("front and right closed profiles support rebuildable revolved solids", async () => {
  const [page, viewer] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/ThreeWorkbench.tsx", root), "utf8"),
  ]);

  assert.match(viewer, /operation: "extrude" \| "pocket" \| "revolve"/);
  assert.match(viewer, /new THREE\.LatheGeometry/);
  assert.match(page, /旋转角度 \(°\)/);
  assert.match(page, /operation: "revolve"/);
  assert.match(page, /绕 Y 轴/);
  assert.match(page, /activeSketch\.plane === "top"/);
});

test("pocket features can build and export circular hole patterns", async () => {
  const [page, viewer] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/ThreeWorkbench.tsx", root), "utf8"),
  ]);

  assert.match(viewer, /patternCount/);
  assert.match(viewer, /rotateAround\(new THREE\.Vector2\(\), step \* instance\)/);
  assert.match(page, /圆周数量/);
  assert.match(page, /覆盖角度/);
  assert.match(page, /"线性" : "圆周"/);
  assert.match(page, /pocket\.feature\?\.patternCount/);
});

test("pocket patterns support a linear mode with persisted spacing", async () => {
  const [page, viewer] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/ThreeWorkbench.tsx", root), "utf8"),
  ]);

  assert.match(viewer, /patternMode\?: "circular" \| "linear"/);
  assert.match(viewer, /patternMode === "linear"/);
  assert.match(page, /线性/);
  assert.match(page, /间距 \(m\)/);
  assert.match(page, /patternSpacing/);
});

test("three industrial presets use the original factory-detail model assets", async () => {
  const page = await readFile(new URL("app/page.tsx", root), "utf8");

  assert.match(page, /cnc_machining_center\.glb/);
  assert.match(page, /robot_cell\.glb/);
  assert.match(page, /roller_conveyor\.glb/);
  assert.doesNotMatch(page, /conveyor:[\s\S]{0,260}pallet_buffer_detail\.glb/);
});

test("the opposed conveyor interface is scaled to the factory conveyor segment", async () => {
  const page = await readFile(new URL("app/page.tsx", root), "utf8");

  assert.match(page, /1\.050 × 0\.398 × 0\.298 m/);
  assert.match(page, /0\.78 \/ 2\.58/);
  assert.match(page, /size: "0\.78 × 0\.46 × 0\.46 m"/);
  assert.match(page, /sizeM: "0\.35 × 0\.12"/);
});

test("modeling tools are consolidated into one inspector instead of floating palettes", async () => {
  const [page, styles] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
  ]);

  assert.match(page, /designer-mode designer-mode-three/);
  assert.match(page, /\{hybridTools\}[\s\S]*\{sketchViewportDock\}[\s\S]*\{precisionPanel\}/);
  assert.match(page, /<details className="inspector-details manufacturing-review">/);
  assert.doesNotMatch(page, /const modeDock/);
  assert.doesNotMatch(page, /const assistantLauncher/);
  assert.match(styles, /Consolidated CAD layout/);
  assert.match(styles, /\.designer-inspector \.precision-panel\{display:block;padding:0;background:transparent\}/);
});
