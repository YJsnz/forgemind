"use client";

import { useEffect, useRef, useState } from "react";

import { createCadDocument } from "../../core/cad/CadDocument";
import { DEFAULT_CAD_TOLERANCE } from "../../core/cad/Tolerance";
import { createCadRuntimeState, disposeCadRuntimeState, getRuntimeFeatureShape } from "../../core/evaluation/CadRuntimeState";
import type { Feature } from "../../core/features/Feature";
import { OcctKernel } from "../../core/kernel/OcctKernel";
import type { KernelEdgePolyline, KernelShapeRef, KernelTessellation } from "../../core/kernel/KernelTypes";
import { rebuildDocument } from "../../core/rebuild/RebuildEngine";
import { createRebuildRuntimeState } from "../../core/rebuild/RebuildTypes";
import type { Sketch } from "../../core/sketch/Sketch";
import type { SketchConstraint, SketchConstraintType } from "../../core/sketch/SketchConstraint";
import type { SketchDimension } from "../../core/sketch/SketchDimension";
import type { SketchEntity } from "../../core/sketch/SketchEntity";
import { buildSketchProfiles } from "../../core/sketch/SketchProfile";
import { solveSketch } from "../../core/sketch/solver/SketchSolver";
import type { SketchSolveResult } from "../../core/sketch/solver/SolverTypes";
import { createWorkbenchId } from "./workbenchIdentity";

type RenderBrep = (shape: KernelShapeRef, tessellation: KernelTessellation, edges: KernelEdgePolyline[]) => void;
type Selection = { kind: "entity" | "endpoint" | "center" | "dimension" | "constraint"; id: string; role?: "start" | "end" | "center" | "position" };
const ID = "ProfessionalSketch01";
const FEATURE = "ProfessionalExtrude01";

const freshSketch = (): Sketch => ({
  id: ID, name: "Professional Rectangle 100 × 60", plane: { type: "XY", offset: 0 },
  entities: {
    a: { id: "a", type: "line", start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, construction: false },
    b: { id: "b", type: "line", start: { x: 100, y: 0 }, end: { x: 100, y: 60 }, construction: false },
    c: { id: "c", type: "line", start: { x: 100, y: 60 }, end: { x: 0, y: 60 }, construction: false },
    d: { id: "d", type: "line", start: { x: 0, y: 60 }, end: { x: 0, y: 0 }, construction: false },
  }, entityOrder: ["a", "b", "c", "d"], constraints: {}, dimensions: {},
});

const fullyConstrainedRectangle = (): Sketch => ({ ...freshSketch(), constraints: {
  c1: { id: "c1", type: "coincident", entityIds: ["a", "b"], pointRefs: [{ entityId: "a", role: "end" }, { entityId: "b", role: "start" }], enabled: true },
  c2: { id: "c2", type: "coincident", entityIds: ["b", "c"], pointRefs: [{ entityId: "b", role: "end" }, { entityId: "c", role: "start" }], enabled: true },
  c3: { id: "c3", type: "coincident", entityIds: ["c", "d"], pointRefs: [{ entityId: "c", role: "end" }, { entityId: "d", role: "start" }], enabled: true },
  c4: { id: "c4", type: "coincident", entityIds: ["d", "a"], pointRefs: [{ entityId: "d", role: "end" }, { entityId: "a", role: "start" }], enabled: true },
  h1: { id: "h1", type: "horizontal", entityIds: ["a"], enabled: true }, h2: { id: "h2", type: "horizontal", entityIds: ["c"], enabled: true },
  v1: { id: "v1", type: "vertical", entityIds: ["b"], enabled: true }, v2: { id: "v2", type: "vertical", entityIds: ["d"], enabled: true },
  anchor: { id: "anchor", type: "fixed", entityIds: ["a"], pointRefs: [{ entityId: "a", role: "start" }], enabled: true },
}, dimensions: {
  width: { id: "width", name: "Width", type: "horizontalDistance", entityIds: ["a"], pointRefs: [{ entityId: "a", role: "start" }, { entityId: "a", role: "end" }], value: 100, driving: true },
  height: { id: "height", name: "Height", type: "verticalDistance", entityIds: ["a", "b"], pointRefs: [{ entityId: "a", role: "end" }, { entityId: "b", role: "end" }], value: 60, driving: true },
} });

const freshCircle = (): Sketch => ({ id: ID, name: "Professional Circle R10", plane: { type: "XY", offset: 0 }, entities: { circle: { id: "circle", type: "circle", center: { x: 20, y: 30 }, radius: 10, construction: false } }, entityOrder: ["circle"], constraints: {}, dimensions: {} });
const fullyConstrainedCircle = (): Sketch => ({ ...freshCircle(), constraints: { center: { id: "center", type: "fixed", entityIds: ["circle"], pointRefs: [{ entityId: "circle", role: "center" }], enabled: true } }, dimensions: { radius: { id: "radius", name: "Radius", type: "radius", entityIds: ["circle"], value: 10, driving: true } } });

const createDocument = () => createCadDocument<Sketch, Feature>({ id: "professional-sketch-document", name: "Professional Sketcher Runtime", sketches: { [ID]: fullyConstrainedRectangle() }, features: { [FEATURE]: { id: FEATURE, name: "Professional Sketch Extrude", type: "extrude", sketchId: ID, distance: 20, direction: "positive", operation: "new", enabled: true, state: "clean", dependencies: [] } }, featureOrder: [FEATURE] });
const label: Record<SketchConstraintType, string> = { horizontal: "H", vertical: "V", coincident: "•", parallel: "∥", perpendicular: "⊥", tangent: "T", concentric: "◎", equal: "=", midpoint: "M", fixed: "▣", symmetric: "S" };
const isLine = (entity: SketchEntity | undefined) => entity?.type === "line";
const isCurve = (entity: SketchEntity | undefined) => entity?.type === "circle" || entity?.type === "arc";

export function ProfessionalSketcher({ onRender }: { onRender: RenderBrep }) {
  // Design truth stays in the document ref; React state below contains only a render revision, diagnostics and UI selection.
  const documentRef = useRef(createDocument());
  const kernelRef = useRef<OcctKernel>();
  const runtimeRef = useRef<ReturnType<typeof createCadRuntimeState>>();
  const rebuildRef = useRef(createRebuildRuntimeState());
  const [, setRevision] = useState(0);
  const [selection, setSelection] = useState<Selection[]>([]);
  const [result, setResult] = useState<SketchSolveResult>(() => solveSketch(documentRef.current.sketches[ID]));
  const [status, setStatus] = useState("已创建 100 × 60 mm 参数化矩形；可选择几何、添加约束或直接编辑驱动尺寸。");
  const [busy, setBusy] = useState(false);
  const sketch = documentRef.current.sketches[ID];

  useEffect(() => () => { const runtime = runtimeRef.current; const kernel = kernelRef.current; if (runtime && kernel) void disposeCadRuntimeState(runtime, kernel); if (kernel) void kernel.dispose(); }, []);
  const refresh = (next: SketchSolveResult, message: string) => { setResult(next); setStatus(message); setRevision((value) => value + 1); };
  const toggleEntity = (id: string) => setSelection((current) => current.some((entry) => entry.kind === "entity" && entry.id === id) ? current.filter((entry) => !(entry.kind === "entity" && entry.id === id)) : [...current.filter((entry) => entry.kind !== "entity"), { kind: "entity", id }]);
  const togglePoint = (id: string, role: "start" | "end" | "center" | "position") => setSelection((current) => current.some((entry) => entry.kind === "endpoint" && entry.id === id && entry.role === role) ? current.filter((entry) => !(entry.kind === "endpoint" && entry.id === id && entry.role === role)) : [...current, { kind: "endpoint", id, role }]);
  const selectedEntities = selection.filter((entry) => entry.kind === "entity").map((entry) => entry.id);
  const selectedPoints = selection.filter((entry) => entry.kind === "endpoint");
  const canAdd = (type: SketchConstraintType) => {
    const first = sketch.entities[selectedEntities[0]], second = sketch.entities[selectedEntities[1]];
    if (["horizontal", "vertical", "fixed"].includes(type)) return selectedEntities.length === 1 && (type === "fixed" || isLine(first));
    if (["parallel", "perpendicular"].includes(type)) return selectedEntities.length === 2 && isLine(first) && isLine(second);
    if (type === "equal") return selectedEntities.length === 2 && ((isLine(first) && isLine(second)) || (isCurve(first) && isCurve(second)));
    if (type === "concentric") return selectedEntities.length === 2 && isCurve(first) && isCurve(second);
    if (type === "tangent") return selectedEntities.length === 2 && ((isLine(first) && isCurve(second)) || (isLine(second) && isCurve(first)));
    if (type === "coincident") return selectedPoints.length === 2;
    if (type === "midpoint") return selectedPoints.length === 1 && sketch.entities[selectedPoints[0].id]?.type === "point" && selectedEntities.length === 1 && isLine(first);
    return false;
  };
  const solveAndRebuild = async (message: string) => {
    const activeSketch = documentRef.current.sketches[ID];
    const solve = solveSketch(activeSketch); if (solve.status === "conflicting" || solve.status === "failed") { refresh(solve, `未提交：${solve.diagnostics.at(-1)?.message ?? "草图约束冲突"}`); return; }
    documentRef.current.sketches[ID] = { ...activeSketch, entities: solve.entities };
    setBusy(true);
    try {
      let kernel = kernelRef.current; let runtime = runtimeRef.current;
      if (!kernel || !runtime) { kernel = new OcctKernel(); await kernel.init(); runtime = createCadRuntimeState(); kernelRef.current = kernel; runtimeRef.current = runtime; }
      const rebuilt = await rebuildDocument({ document: documentRef.current, kernel, runtime, rebuildRuntime: rebuildRef.current, tolerance: DEFAULT_CAD_TOLERANCE, buildProfiles: buildSketchProfiles }, { changedSketchIds: [ID] });
      if (!rebuilt.success) throw new Error(rebuilt.errors.map((entry) => entry.message).join("; "));
      const shape = getRuntimeFeatureShape(runtime, FEATURE); if (!shape) throw new Error("Extrude B-Rep is unavailable after rebuild.");
      const [tessellation, edges, properties] = await Promise.all([kernel.tessellate(shape, { linearDeflectionMm: 1, angularDeflectionDeg: 10 }), kernel.getEdgePolylines(shape), kernel.getShapeProperties(shape)]);
      onRender(shape, tessellation, edges); refresh(solve, `${message}；真实 OCCT B-Rep 已自动重建，体积 ${properties.volumeMm3?.toFixed(0)} mm³。`);
    } catch (error) { refresh(solve, `草图已求解，但 B-Rep 重建失败：${error instanceof Error ? error.message : String(error)}`); } finally { setBusy(false); }
  };
  const addConstraint = (type: SketchConstraintType) => {
    if (!canAdd(type)) return;
    const id = createWorkbenchId(`ui-${type}`); const entityIds = type === "coincident" ? selectedPoints.map((entry) => entry.id) : [...selectedEntities];
    const entry: SketchConstraint = { id, type, entityIds, pointRefs: type === "coincident" || type === "midpoint" ? selectedPoints.map((entry) => ({ entityId: entry.id, role: entry.role! })) : undefined, enabled: true };
    documentRef.current.sketches[ID] = { ...sketch, constraints: { ...sketch.constraints, [id]: entry } };
    void solveAndRebuild(`${label[type]} 约束已添加`);
  };
  const updateDimension = (id: string, value: number) => { if (!Number.isFinite(value) || value <= 0) return; const dimension = sketch.dimensions[id]; if (!dimension) return; documentRef.current.sketches[ID] = { ...sketch, dimensions: { ...sketch.dimensions, [id]: { ...dimension, value } } }; void solveAndRebuild(`${dimension.name ?? id} 已更新为 ${value} mm`); };
  const removeConstraint = (id: string) => { const constraints = { ...sketch.constraints }; delete constraints[id]; documentRef.current.sketches[ID] = { ...sketch, constraints }; setSelection([]); void solveAndRebuild("约束已移除"); };
  const addDrivingDimension = () => {
    const first = sketch.entities[selectedEntities[0]], second = sketch.entities[selectedEntities[1]]; let dimension: SketchDimension | undefined;
    if (selectedEntities.length === 1 && first?.type === "circle") dimension = { id: createWorkbenchId("radius"), name: "Radius", type: "radius", entityIds: [first.id], value: first.radius, driving: true };
    else if (selectedEntities.length === 1 && first?.type === "line") dimension = { id: createWorkbenchId("length"), name: "Length", type: "distance", entityIds: [first.id], pointRefs: [{ entityId: first.id, role: "start" }, { entityId: first.id, role: "end" }], value: Math.hypot(first.end.x - first.start.x, first.end.y - first.start.y), driving: true };
    else if (selectedEntities.length === 2 && isLine(first) && isLine(second)) dimension = { id: createWorkbenchId("angle"), name: "Angle", type: "angle", entityIds: [first.id, second.id], value: Math.atan2((first.end.x - first.start.x) * (second.end.y - second.start.y) - (first.end.y - first.start.y) * (second.end.x - second.start.x), (first.end.x - first.start.x) * (second.end.x - second.start.x) + (first.end.y - first.start.y) * (second.end.y - second.start.y)) * 180 / Math.PI, driving: true };
    if (!dimension) return; documentRef.current.sketches[ID] = { ...sketch, dimensions: { ...sketch.dimensions, [dimension.id]: dimension } }; void solveAndRebuild(`${dimension.name} 驱动尺寸已添加`);
  };
  const addReferenceGeometry = (kind: "line" | "circle" | "point") => { const id = `reference-${kind}`; if (sketch.entities[id]) return; const entity: SketchEntity = kind === "line" ? { id, type: "line", start: { x: 0, y: 10 }, end: { x: 60, y: 10 }, construction: true } : kind === "circle" ? { id, type: "circle", center: { x: 20, y: 30 }, radius: 6, construction: true } : { id, type: "point", position: { x: 50, y: 0 }, construction: true }; documentRef.current.sketches[ID] = { ...sketch, entities: { ...sketch.entities, [id]: entity }, entityOrder: [...sketch.entityOrder, id] }; refresh(solveSketch(documentRef.current.sketches[ID]), `已添加构造 ${kind}；它不会成为 B-Rep 轮廓。`); };
  const reset = (nextSketch: Sketch, message: string, rebuild = false) => { documentRef.current.sketches[ID] = nextSketch; setSelection([]); const next = solveSketch(nextSketch); refresh(next, message); if (rebuild) void solveAndRebuild(`${nextSketch.name} 已求解`); };
  const geometry = Object.values(sketch.entities);
  return <section style={{ marginTop: 28, border: "1px solid #2563eb", borderRadius: 10, padding: 18, background: "#101b32" }} aria-label="Professional Sketcher">
    <p style={{ color: "#71c6ff", letterSpacing: .8, margin: 0 }}>P2-M1B · PROFESSIONAL SKETCHER</p><h2 style={{ margin: "5px 0 10px" }}>真实参数化草图 → 自动 B-Rep 重建</h2>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}><button type="button" onClick={() => reset(freshSketch(), "已新建未约束矩形；选择实体后可添加上下文允许的约束。")} disabled={busy}>新建矩形</button><button type="button" onClick={() => reset(fullyConstrainedRectangle(), "已建立带完整约束与驱动尺寸的 100 × 60 mm 矩形。", true)} disabled={busy}>创建 100 × 60 受约束矩形</button><button type="button" onClick={() => reset(freshCircle(), "已新建 Circle R10；可选择圆并添加固定、同心、相等或切线约束。")} disabled={busy}>新建圆 R10</button><button type="button" onClick={() => reset(fullyConstrainedCircle(), "已建立固定圆心与 R10 驱动尺寸。", true)} disabled={busy}>创建固定圆 R10</button><button type="button" onClick={() => void solveAndRebuild("手动求解完成")} disabled={busy}>Solve + Rebuild</button></div>
    <div style={{ display: "grid", gridTemplateColumns: "minmax(300px, 1fr) minmax(280px, 1fr)", gap: 18, marginTop: 16 }}>
      <div><svg viewBox="-20 -85 160 110" role="img" aria-label="参数化草图视图" style={{ width: "100%", minHeight: 260, background: "#07101f", borderRadius: 6 }}>
        <path d="M-20 0H140 M0 -85V25" stroke="#334155" strokeWidth=".5" />
        {geometry.map((entity) => entity.type === "line" ? <g key={entity.id}><line x1={entity.start.x} y1={-entity.start.y} x2={entity.end.x} y2={-entity.end.y} stroke={selectedEntities.includes(entity.id) ? "#facc15" : "#67e8f9"} strokeWidth="1.6" onClick={() => toggleEntity(entity.id)} style={{ cursor: "pointer" }} /><text x={(entity.start.x + entity.end.x) / 2} y={-(entity.start.y + entity.end.y) / 2 - 4} fill="#cbd5e1" fontSize="5">{entity.id.toUpperCase()}</text></g> : entity.type === "circle" ? <circle key={entity.id} cx={entity.center.x} cy={-entity.center.y} r={entity.radius} fill="none" stroke={selectedEntities.includes(entity.id) ? "#facc15" : "#67e8f9"} strokeWidth="1.6" onClick={() => toggleEntity(entity.id)} style={{ cursor: "pointer" }} /> : null)}
        {Object.values(sketch.constraints).map((constraint, index) => <text key={constraint.id} x={6 + index * 9} y={-72} fill="#f8fafc" fontSize="7" onClick={() => removeConstraint(constraint.id)} style={{ cursor: "pointer" }}>{label[constraint.type]}</text>)}
        {Object.values(sketch.dimensions).map((dimension, index) => <text key={dimension.id} x={4 + index * 48} y={16} fill="#facc15" fontSize="6">{dimension.name ?? dimension.id}: {dimension.value} {dimension.type === "angle" ? "°" : "mm"}</text>)}
      </svg><small>点击线段进行几何选择；约束符号和驱动尺寸显示于视图中。</small></div>
      <div><b>选择 / {selectedEntities.length ? selectedEntities.join(", ") : "未选择"}</b><div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "8px 0" }}>{geometry.map((entity) => <span key={entity.id}><button type="button" onClick={() => toggleEntity(entity.id)} style={{ background: selectedEntities.includes(entity.id) ? "#1d4ed8" : undefined }}>{entity.type} {entity.id}</button>{entity.type === "line" && <><button type="button" onClick={() => togglePoint(entity.id, "start")}>start</button><button type="button" onClick={() => togglePoint(entity.id, "end")}>end</button></>}{(entity.type === "circle" || entity.type === "arc") && <button type="button" onClick={() => togglePoint(entity.id, "center")}>center</button>}{entity.type === "point" && <button type="button" onClick={() => togglePoint(entity.id, "position")}>point</button>}</span>)}</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "8px 0" }}><button type="button" onClick={() => addReferenceGeometry("line")}>+ 构造线</button><button type="button" onClick={() => addReferenceGeometry("circle")}>+ 构造圆</button><button type="button" onClick={() => addReferenceGeometry("point")}>+ 构造点</button></div><b>添加约束</b><div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "8px 0" }}>{(["horizontal", "vertical", "coincident", "parallel", "perpendicular", "tangent", "concentric", "equal", "midpoint", "fixed"] as SketchConstraintType[]).map((type) => <button type="button" key={type} disabled={!canAdd(type) || busy} onClick={() => addConstraint(type)}>{label[type]} {type}</button>)}</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "8px 0" }}>{Object.values(sketch.constraints).map((constraint) => <button type="button" key={`remove-${constraint.id}`} onClick={() => removeConstraint(constraint.id)} disabled={busy}>× {label[constraint.type]} {constraint.type}</button>)}</div><button type="button" onClick={addDrivingDimension} disabled={busy || !(selectedEntities.length === 1 && (isLine(sketch.entities[selectedEntities[0]]) || sketch.entities[selectedEntities[0]]?.type === "circle") || selectedEntities.length === 2 && isLine(sketch.entities[selectedEntities[0]]) && isLine(sketch.entities[selectedEntities[1]]))}>＋ 添加驱动尺寸</button>
        <b>驱动尺寸</b>{Object.values(sketch.dimensions).map((dimension: SketchDimension) => <label key={dimension.id} style={{ display: "block", marginTop: 8 }}>{dimension.name ?? dimension.id} ({dimension.type === "angle" ? "°" : "mm"})<input aria-label={`${dimension.name ?? dimension.id} value`} type="number" min="0.001" step="0.1" value={dimension.value} disabled={busy} onChange={(event) => updateDimension(dimension.id, Number(event.target.value))} style={{ marginLeft: 8, width: 90 }} /></label>)}
        <p data-testid="professional-sketch-status" aria-live="polite" style={{ color: result.status === "fully-constrained" ? "#86efac" : result.status === "conflicting" || result.status === "failed" ? "#fca5a5" : "#fcd34d" }}>状态：{result.status} · DOF {result.degreesOfFreedom} · {status}</p>
      </div>
    </div>
  </section>;
}
