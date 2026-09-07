"use client";

import { useMemo, useState } from "react";
import type { Vec3 } from "../../core/cad/CadTypes";
import type { BSplineSurfaceBoundaryMatch } from "../../core/features/BSplineSurfaceFeature";
import type { RationalBSplineSectionDefinition } from "../../core/surface/RationalBSplineSections";
import { changeRationalBSplineSectionDirection, createDefaultRationalBSplineSections, createUnitWeightGrid, reconcileRationalBSplineSections } from "../../core/surface/RationalBSplineSections";
import type { NurbsAxisDefinition, TensorProductNurbsDefinition } from "../../core/surface/TensorProductNurbs";
import { createDefaultTensorProductNurbs, insertTensorProductNurbsKnot, reconcileTensorProductNurbs, validateTensorProductNurbs, widestTensorNurbsSpanMidpoint } from "../../core/surface/TensorProductNurbs";
import {
  bsplineBoundaryRequiredDepth,
  bsplineControlNetFairness,
  extendBSplineControlNet,
  moveBSplineControlPointSoft,
  reduceBSplineControlNet,
  refineBSplineControlNet,
  solveBSplineSurfaceNetwork,
  smoothBSplineControlNet,
  translateBSplineIsoLine,
  type BSplineEdge,
  type BSplineMatchContinuity,
} from "../../core/surface/BSplineControlNet";

const makePreset = (kind: "flat" | "dome" | "saddle"): Vec3[][] => Array.from({ length: 4 }, (_, row) => Array.from({ length: 4 }, (_, col) => {
  const x = (col - 1.5) * 30;
  const y = (row - 1.5) * 30;
  const nx = (col - 1.5) / 1.5, ny = (row - 1.5) / 1.5;
  const z = kind === "flat" ? 0 : kind === "dome" ? Math.max(0, 24 * (1 - .45 * (nx * nx + ny * ny))) : 18 * nx * ny;
  return { x, y, z };
}));

// Design contract retained for project compatibility: 控制点为 Part-local mm; commit boundary was onCreate(controlNet).

export interface BSplineSurfaceMatchSource { id: string; name: string; controlNet: Vec3[][]; }
export interface BSplineSurfaceCommitOptions { boundaryMatch?: BSplineSurfaceBoundaryMatch; boundaryMatches?: BSplineSurfaceBoundaryMatch[]; rationalSections?: RationalBSplineSectionDefinition; tensorNurbs?: TensorProductNurbsDefinition; }
interface BSplineSurfaceEditorProps {
  busy: boolean;
  onCreate: (controlNet: Vec3[][], options?: BSplineSurfaceCommitOptions) => void | Promise<void>;
  initialControlNet?: Vec3[][];
  actionLabel?: string;
  matchingSurfaces?: BSplineSurfaceMatchSource[];
  initialBoundaryMatch?: BSplineSurfaceBoundaryMatch;
  initialBoundaryMatches?: BSplineSurfaceBoundaryMatch[];
  initialRationalSections?: RationalBSplineSectionDefinition;
  initialTensorNurbs?: TensorProductNurbsDefinition;
}
interface BSplineEditorSnapshot { controlNet: Vec3[][]; boundaryMatches: BSplineSurfaceBoundaryMatch[]; rationalSections?: RationalBSplineSectionDefinition; tensorNurbs?: TensorProductNurbsDefinition; }

const edgeOptions: Array<{ value: BSplineEdge; label: string }> = [
  { value: "uMin", label: "U 起边" }, { value: "uMax", label: "U 末边" },
  { value: "vMin", label: "V 起边" }, { value: "vMax", label: "V 末边" },
];
const edgeRank: Record<BSplineEdge, number> = { uMin: 0, uMax: 1, vMin: 2, vMax: 3 };
const edgeLabel = (edge: BSplineEdge): string => edgeOptions.find((option) => option.value === edge)?.label ?? edge;

const boundaryControlsPole = (match: BSplineSurfaceBoundaryMatch, row: number, col: number, rows: number, cols: number): boolean => {
  const depth = bsplineBoundaryRequiredDepth(match.continuity);
  if (match.targetEdge === "uMin") return col < depth;
  if (match.targetEdge === "uMax") return col >= cols - depth;
  if (match.targetEdge === "vMin") return row < depth;
  return row >= rows - depth;
};

export default function BSplineSurfaceEditor({ busy, onCreate, initialControlNet, actionLabel = "✓ 创建 B-Spline Surface", matchingSurfaces = [], initialBoundaryMatch, initialBoundaryMatches, initialRationalSections, initialTensorNurbs }: BSplineSurfaceEditorProps) {
  const seed = useMemo(() => initialControlNet ? structuredClone(initialControlNet) : makePreset("dome"), [initialControlNet]);
  const initialMatches = useMemo(() => initialBoundaryMatches?.length ? structuredClone(initialBoundaryMatches) : initialBoundaryMatch ? [structuredClone(initialBoundaryMatch)] : [], [initialBoundaryMatch, initialBoundaryMatches]);
  const [controlNet, setControlNet] = useState<Vec3[][]>(() => structuredClone(seed));
  const [smoothStrength, setSmoothStrength] = useState(.35);
  const [smoothIterations, setSmoothIterations] = useState(2);
  const [preserveBoundary, setPreserveBoundary] = useState(true);
  const [matchSourceId, setMatchSourceId] = useState(initialMatches[0]?.sourceFeatureId ?? matchingSurfaces[0]?.id ?? "");
  const [sourceEdge, setSourceEdge] = useState<BSplineEdge>(initialMatches[0]?.sourceEdge ?? "uMax");
  const [targetEdge, setTargetEdge] = useState<BSplineEdge>(initialMatches[0]?.targetEdge ?? "uMin");
  const [continuity, setContinuity] = useState<BSplineMatchContinuity>(initialMatches[0]?.continuity ?? "G1");
  const [reverseBoundary, setReverseBoundary] = useState(initialMatches[0]?.reverse ?? false);
  const [tangentScale, setTangentScale] = useState(initialMatches[0]?.tangentScale ?? 1);
  const [adaptBoundaryCount, setAdaptBoundaryCount] = useState(initialMatches[0]?.adaptTargetBoundaryCount ?? true);
  const [boundaryMatches, setBoundaryMatches] = useState<BSplineSurfaceBoundaryMatch[]>(() => structuredClone(initialMatches));
  const [rationalSections, setRationalSections] = useState<RationalBSplineSectionDefinition | undefined>(initialRationalSections ? structuredClone(initialRationalSections) : undefined);
  const [tensorNurbs, setTensorNurbs] = useState<TensorProductNurbsDefinition | undefined>(initialTensorNurbs ? structuredClone(initialTensorNurbs) : undefined);
  const [uKnotsText, setUKnotsText] = useState(() => (initialTensorNurbs?.u.knots ?? []).join(", "));
  const [uMultiplicitiesText, setUMultiplicitiesText] = useState(() => (initialTensorNurbs?.u.multiplicities ?? []).join(", "));
  const [vKnotsText, setVKnotsText] = useState(() => (initialTensorNurbs?.v.knots ?? []).join(", "));
  const [vMultiplicitiesText, setVMultiplicitiesText] = useState(() => (initialTensorNurbs?.v.multiplicities ?? []).join(", "));
  const [uInsertKnot, setUInsertKnot] = useState(.5);
  const [vInsertKnot, setVInsertKnot] = useState(.5);
  const [localEdit, setLocalEdit] = useState({ direction: "u" as "u" | "v", index: 1, row: 1, col: 1, radius: 2, x: 0, y: 0, z: 5, edge: "uMax" as BSplineEdge, extension: 1 });
  const [undoStack, setUndoStack] = useState<BSplineEditorSnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<BSplineEditorSnapshot[]>([]);
  const [localNotice, setLocalNotice] = useState("");
  const rows = controlNet.length, cols = controlNet[0]?.length ?? 0;
  const fairness = useMemo(() => bsplineControlNetFairness(controlNet), [controlNet]);
  const snapshot = (): BSplineEditorSnapshot => ({ controlNet: structuredClone(controlNet), boundaryMatches: structuredClone(boundaryMatches), rationalSections: rationalSections ? structuredClone(rationalSections) : undefined, tensorNurbs: tensorNurbs ? structuredClone(tensorNurbs) : undefined });
  const syncAxisText = (definition: TensorProductNurbsDefinition | undefined) => {
    setUKnotsText(definition?.u.knots.join(", ") ?? ""); setUMultiplicitiesText(definition?.u.multiplicities.join(", ") ?? "");
    setVKnotsText(definition?.v.knots.join(", ") ?? ""); setVMultiplicitiesText(definition?.v.multiplicities.join(", ") ?? "");
  };
  const replaceControlNet = (transform: (current: Vec3[][]) => Vec3[][], notice: string, retainBoundaryMatches = false) => {
    try {
      const next = transform(controlNet);
      const resized = next.length !== rows || (next[0]?.length ?? 0) !== cols;
      const nextRational = rationalSections && resized ? reconcileRationalBSplineSections(next, rationalSections) : rationalSections;
      const nextTensor = tensorNurbs && resized ? reconcileTensorProductNurbs(next, tensorNurbs) : tensorNurbs;
      setUndoStack((stack) => [...stack, snapshot()].slice(-30)); setRedoStack([]); setControlNet(next);
      setRationalSections(nextRational); setTensorNurbs(nextTensor); syncAxisText(nextTensor);
      if (!retainBoundaryMatches) setBoundaryMatches([]);
      setLocalNotice(`${notice}${!retainBoundaryMatches && boundaryMatches.length ? ` 已解除 ${boundaryMatches.length} 条受影响的边界关联。` : ""}${resized && (tensorNurbs || rationalSections) ? " 控制线数量已改变，节点和权重会重新分配；此操作会改变曲面形状。" : ""}`);
      return true;
    } catch (error) {
      setLocalNotice(error instanceof Error ? error.message : String(error));
      return false;
    }
  };
  const replaceRationalSections = (next: RationalBSplineSectionDefinition | undefined, notice: string) => {
    setUndoStack((stack) => [...stack, snapshot()].slice(-30));
    setRedoStack([]); setRationalSections(next); setBoundaryMatches([]); setLocalNotice(boundaryMatches.length ? `${notice} 原边界关联已解除，请按新的有理参数重新匹配。` : notice);
  };
  const replaceTensorNurbs = (next: TensorProductNurbsDefinition | undefined, notice: string, retainBoundaryMatches = false) => {
    setUndoStack((stack) => [...stack, snapshot()].slice(-30)); setRedoStack([]); setTensorNurbs(next); syncAxisText(next);
    if (!retainBoundaryMatches) setBoundaryMatches([]);
    setLocalNotice(!retainBoundaryMatches && boundaryMatches.length ? `${notice} 原边界关联已解除，请按新的 NURBS 参数重新匹配。` : notice);
  };
  const update = (row: number, col: number, axis: keyof Vec3, value: number) => {
    if (!Number.isFinite(value)) return;
    const retained = boundaryMatches.filter((match) => !boundaryControlsPole(match, row, col, rows, cols));
    const removed = boundaryMatches.length - retained.length;
    replaceControlNet((current) => current.map((items, r) => items.map((point, c) => r === row && c === col ? { ...point, [axis]: value } : point)), removed ? `控制点已修改，并解除 ${removed} 条受影响的边界关联。` : "控制点已修改，现有边界关联保持不变。", true);
    setBoundaryMatches(retained);
  };
  const range = useMemo(() => ({ x: [Math.min(...controlNet.flat().map((p) => p.x)), Math.max(...controlNet.flat().map((p) => p.x))], y: [Math.min(...controlNet.flat().map((p) => p.y)), Math.max(...controlNet.flat().map((p) => p.y))], z: [Math.min(...controlNet.flat().map((p) => p.z)), Math.max(...controlNet.flat().map((p) => p.z))] }), [controlNet]);
  const inputStyle = { width: 58, background: "#08111d", color: "#e5eef7", border: "1px solid #3a6670", borderRadius: 3, padding: "3px 4px", fontSize: 10 } as const;
  const selectStyle = { minWidth: 0, padding: "5px 4px", fontSize: 10 } as const;

  const insertExactKnot = (direction: "u" | "v", knot: number, automatic = false) => {
    if (!tensorNurbs) return;
    try {
      const inserted = insertTensorProductNurbsKnot(controlNet, tensorNurbs, direction, knot);
      const retained = boundaryMatches.filter((match) => match.continuity === "G0" && (direction === "u" ? match.targetEdge.startsWith("u") : match.targetEdge.startsWith("v")));
      setUndoStack((stack) => [...stack, snapshot()].slice(-30)); setRedoStack([]); setControlNet(inserted.controlNet); setTensorNurbs(inserted.definition); syncAxisText(inserted.definition); setBoundaryMatches(retained);
      setLocalNotice(`${direction.toUpperCase()} 向已在 ${knot.toFixed(4)} 插入节点并增加一条控制线；曲面形状保持不变${automatic ? "，位置取自最宽参数区间" : ""}${retained.length < boundaryMatches.length ? `，并解除 ${boundaryMatches.length - retained.length} 条点数不再兼容的边界关联` : ""}。`);
    } catch (error) { setLocalNotice(error instanceof Error ? error.message : String(error)); }
  };
  const refine = (direction: "u" | "v") => {
    if ((direction === "u" ? cols : rows) >= 13) { setLocalNotice("单方向最多保留 13 个控制点，避免编辑区过载。"); return; }
    if (tensorNurbs) { insertExactKnot(direction, widestTensorNurbsSpanMidpoint(tensorNurbs[direction]), true); return; }
    replaceControlNet((current) => refineBSplineControlNet(current, direction), `${direction.toUpperCase()} 向已插入控制线；这是形状编辑，应用后会重建曲面。`);
  };
  const smooth = () => {
    const retained = preserveBoundary ? boundaryMatches.filter((match) => match.continuity === "G0") : [];
    replaceControlNet((current) => smoothBSplineControlNet(current, { strength: smoothStrength, iterations: smoothIterations, preserveBoundary }), retained.length === boundaryMatches.length ? "已光顺内部控制点，边界关联保持不变。" : `已完成光顺，并解除 ${boundaryMatches.length - retained.length} 条涉及切向或曲率控制带的关联。`, true);
    setBoundaryMatches(retained);
  };
  const applyBoundaryMatch = () => {
    const resolvedSourceId = matchingSurfaces.some((entry) => entry.id === matchSourceId) ? matchSourceId : matchingSurfaces[0]?.id;
    const source = matchingSurfaces.find((entry) => entry.id === resolvedSourceId);
    if (!source) { setLocalNotice("请选择一张作为基准的 B-Spline 曲面。"); return; }
    try {
      const relation: BSplineSurfaceBoundaryMatch = { sourceFeatureId: source.id, sourceEdge, targetEdge, continuity, reverse: reverseBoundary, tangentScale, adaptTargetBoundaryCount: adaptBoundaryCount };
      const nextRelations = [...boundaryMatches.filter((match) => match.targetEdge !== targetEdge), relation].sort((left, right) => edgeRank[left.targetEdge] - edgeRank[right.targetEdge]);
      const inputs = nextRelations.map((match) => { const matchSource = matchingSurfaces.find((entry) => entry.id === match.sourceFeatureId); if (!matchSource) throw new Error(`基准曲面 ${match.sourceFeatureId} 已不可用。`); return { sourceControlNet: matchSource.controlNet, options: match }; });
      if (replaceControlNet((current) => solveBSplineSurfaceNetwork(current, inputs, { fairnessStrength: smoothStrength, iterations: Math.max(3, smoothIterations) }), `${continuity} 控制带已求解，当前共有 ${nextRelations.length} 条边界关联；应用时检查实际曲面连续性。`, true)) setBoundaryMatches(nextRelations);
    } catch (error) { setLocalNotice(error instanceof Error ? error.message : String(error)); }
  };
  const solveBoundaryNetwork = () => {
    if (!boundaryMatches.length) { setLocalNotice("请先加入至少一条相邻曲面边界。"); return; }
    try {
      const inputs = boundaryMatches.map((match) => { const source = matchingSurfaces.find((entry) => entry.id === match.sourceFeatureId); if (!source) throw new Error(`基准曲面 ${match.sourceFeatureId} 已不可用。`); return { sourceControlNet: source.controlNet, options: match }; });
      replaceControlNet((current) => solveBSplineSurfaceNetwork(current, inputs, { fairnessStrength: smoothStrength, iterations: Math.max(3, smoothIterations) }), `已重新求解 ${boundaryMatches.length} 条 G0/G1/G2 边界并光顺内部控制网。`, true);
    } catch (error) { setLocalNotice(error instanceof Error ? error.message : String(error)); }
  };
  const localDelta = (): Vec3 => ({ x: localEdit.x, y: localEdit.y, z: localEdit.z });
  const applySoftSelection = () => replaceControlNet((current) => moveBSplineControlPointSoft(current, localEdit.row, localEdit.col, localDelta(), localEdit.radius), "已平滑移动局部控制点。");
  const applyIsoLine = () => replaceControlNet((current) => translateBSplineIsoLine(current, localEdit.direction, localEdit.index, localDelta()), `已移动 ${localEdit.direction.toUpperCase()} 等参控制线。`);
  const extendNaturalBoundary = () => replaceControlNet((current) => extendBSplineControlNet(current, localEdit.edge, localEdit.extension), `${edgeLabel(localEdit.edge)} 已按原切向自然延伸一条控制线。`);
  const reduceLocalLine = () => replaceControlNet((current) => reduceBSplineControlNet(current, localEdit.direction, localEdit.index), `已移除一条 ${localEdit.direction.toUpperCase()} 内部控制线并重建参数。`);
  const undoLocal = () => {
    const previous = undoStack.at(-1); if (!previous) return;
    setUndoStack((stack) => stack.slice(0, -1)); setRedoStack((stack) => [snapshot(), ...stack].slice(0, 30));
    setControlNet(structuredClone(previous.controlNet)); setBoundaryMatches(structuredClone(previous.boundaryMatches)); setRationalSections(previous.rationalSections ? structuredClone(previous.rationalSections) : undefined); setTensorNurbs(previous.tensorNurbs ? structuredClone(previous.tensorNurbs) : undefined); syncAxisText(previous.tensorNurbs); setLocalNotice("已撤销上一步控制网编辑。");
  };
  const redoLocal = () => {
    const next = redoStack[0]; if (!next) return;
    setRedoStack((stack) => stack.slice(1)); setUndoStack((stack) => [...stack, snapshot()].slice(-30));
    setControlNet(structuredClone(next.controlNet)); setBoundaryMatches(structuredClone(next.boundaryMatches)); setRationalSections(next.rationalSections ? structuredClone(next.rationalSections) : undefined); setTensorNurbs(next.tensorNurbs ? structuredClone(next.tensorNurbs) : undefined); syncAxisText(next.tensorNurbs); setLocalNotice("已重做控制网编辑。");
  };
  const updateTensorDegree = (direction: "u" | "v", degree: number) => {
    if (!tensorNurbs || !Number.isInteger(degree)) return;
    const generated = createDefaultTensorProductNurbs(controlNet, degree);
    const next = structuredClone(tensorNurbs);
    next[direction] = generated[direction];
    replaceTensorNurbs(next, `${direction.toUpperCase()} 向次数与开放均匀节点已更新。`);
  };
  const parseNumberList = (value: string): number[] => value.split(/[，,\s]+/).filter(Boolean).map(Number);
  const applyTensorAxis = (direction: "u" | "v") => {
    if (!tensorNurbs) return;
    const knots = parseNumberList(direction === "u" ? uKnotsText : vKnotsText);
    const multiplicities = parseNumberList(direction === "u" ? uMultiplicitiesText : vMultiplicitiesText);
    const next = structuredClone(tensorNurbs); const axis: NurbsAxisDefinition = { ...next[direction], knots, multiplicities }; next[direction] = axis;
    const validation = validateTensorProductNurbs(controlNet, next);
    if (!validation.valid) { setLocalNotice(validation.issues.join(" ")); return; }
    replaceTensorNurbs(next, `${direction.toUpperCase()} 向节点与重数已应用。`);
  };
  const updateTensorWeight = (row: number, col: number, value: number) => {
    if (!tensorNurbs || !Number.isFinite(value) || value <= 0) return;
    const retained = boundaryMatches.filter((match) => !boundaryControlsPole(match, row, col, rows, cols));
    const removed = boundaryMatches.length - retained.length;
    const next = structuredClone(tensorNurbs); next.weights[row][col] = value; replaceTensorNurbs(next, removed ? `R${row + 1}C${col + 1} 权重已更新，并解除 ${removed} 条受影响的边界关联。` : `R${row + 1}C${col + 1} 权重已更新。`, true); setBoundaryMatches(retained);
  };
  const commit = async () => {
    try { await onCreate(controlNet, boundaryMatches.length || rationalSections || tensorNurbs ? { boundaryMatches: boundaryMatches.length ? boundaryMatches : undefined, rationalSections: tensorNurbs ? undefined : rationalSections, tensorNurbs } : undefined); }
    catch (error) { setLocalNotice(`保存失败：${error instanceof Error ? error.message : String(error)}`); }
  };

  return <div className="b-spline-surface-editor" style={{ border: "1px solid #315b68", background: "#0a1720", borderRadius: 5, padding: 8, marginTop: 8 }}>
    <b style={{ color: "#78dbea", fontSize: 12 }}>B-Spline 控制网 · {rows}×{cols}</b>
    <div style={{ display: "flex", gap: 5, flexWrap: "wrap", margin: "6px 0" }}>
      {(["flat","dome","saddle"] as const).map((kind) => <button key={kind} type="button" disabled={busy} onClick={() => replaceControlNet(() => makePreset(kind), "已载入预设控制网；原匹配关系已取消。")}>{kind === "flat" ? "平面" : kind === "dome" ? "拱面" : "鞍面"}</button>)}
      <button type="button" disabled={busy || cols >= 13} onClick={() => refine("u")}>U 向加密</button>
      <button type="button" disabled={busy || rows >= 13} onClick={() => refine("v")}>V 向加密</button>
      <button type="button" aria-label="撤销控制网编辑" disabled={busy || !undoStack.length} onClick={undoLocal}>撤销</button>
      <button type="button" aria-label="重做控制网编辑" disabled={busy || !redoStack.length} onClick={redoLocal}>重做</button>
      <button type="button" disabled={busy} onClick={() => { setControlNet(structuredClone(seed)); setUndoStack([]); setRedoStack([]); setBoundaryMatches(structuredClone(initialMatches)); setRationalSections(initialRationalSections ? structuredClone(initialRationalSections) : undefined); const restored = initialTensorNurbs ? structuredClone(initialTensorNurbs) : undefined; setTensorNurbs(restored); syncAxisText(restored); setLocalNotice("已恢复本次编辑前的控制网。"); }}>重置</button>
    </div>
    <details style={{ border: "1px solid #284754", borderRadius: 4, padding: 6, marginBottom: 6 }}>
      <summary style={{ cursor: "pointer", fontSize: 11, fontWeight: 700 }}>控制网光顺</summary>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5, marginTop: 6 }}>
        <label style={{ fontSize: 10 }}>强度<input aria-label="控制网光顺强度" type="number" min="0.05" max="1" step="0.05" value={smoothStrength} onChange={(event) => setSmoothStrength(Number(event.target.value))} disabled={busy} style={{ ...inputStyle, width: "100%" }} /></label>
        <label style={{ fontSize: 10 }}>次数<input aria-label="控制网光顺次数" type="number" min="1" max="20" step="1" value={smoothIterations} onChange={(event) => setSmoothIterations(Number(event.target.value))} disabled={busy} style={{ ...inputStyle, width: "100%" }} /></label>
      </div>
      <label style={{ display: "flex", gap: 5, alignItems: "center", fontSize: 10, margin: "6px 0" }}><input type="checkbox" checked={preserveBoundary} onChange={(event) => setPreserveBoundary(event.target.checked)} disabled={busy} />锁定四周边界</label>
      <button type="button" disabled={busy} onClick={smooth}>光顺控制网</button>
    </details>
    <details style={{ border: "1px solid #284754", borderRadius: 4, padding: 6, marginBottom: 6 }}>
      <summary style={{ cursor: "pointer", fontSize: 11, fontWeight: 700 }}>局部形状编辑</summary>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 5, marginTop: 6 }}>
        {(["x","y","z"] as const).map((axis) => <label key={axis} style={{ fontSize: 10 }}>{axis.toUpperCase()} 位移<input type="number" step="1" value={localEdit[axis]} onChange={(event) => setLocalEdit((value) => ({ ...value, [axis]: Number(event.target.value) }))} disabled={busy} style={{ ...inputStyle, width: "100%" }} /></label>)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 5, marginTop: 6 }}>
        <label style={{ fontSize: 10 }}>控制点行<input type="number" min="0" max={Math.max(0, rows - 1)} step="1" value={localEdit.row} onChange={(event) => setLocalEdit((value) => ({ ...value, row: Number(event.target.value) }))} disabled={busy} style={{ ...inputStyle, width: "100%" }} /></label>
        <label style={{ fontSize: 10 }}>控制点列<input type="number" min="0" max={Math.max(0, cols - 1)} step="1" value={localEdit.col} onChange={(event) => setLocalEdit((value) => ({ ...value, col: Number(event.target.value) }))} disabled={busy} style={{ ...inputStyle, width: "100%" }} /></label>
        <label style={{ fontSize: 10 }}>影响半径<input type="number" min="0" max="12" step="1" value={localEdit.radius} onChange={(event) => setLocalEdit((value) => ({ ...value, radius: Number(event.target.value) }))} disabled={busy} style={{ ...inputStyle, width: "100%" }} /></label>
      </div>
      <button type="button" disabled={busy} onClick={applySoftSelection} style={{ marginTop: 5 }}>软选择移动</button>
      <div style={{ display: "grid", gridTemplateColumns: "70px 1fr", gap: 5, marginTop: 7 }}><select value={localEdit.direction} onChange={(event) => setLocalEdit((value) => ({ ...value, direction: event.target.value as "u" | "v" }))} disabled={busy}><option value="u">U 控制线</option><option value="v">V 控制线</option></select><input aria-label="等参控制线索引" type="number" min="0" max={Math.max(0, (localEdit.direction === "u" ? cols : rows) - 1)} step="1" value={localEdit.index} onChange={(event) => setLocalEdit((value) => ({ ...value, index: Number(event.target.value) }))} disabled={busy} /></div>
      <div style={{ display: "flex", gap: 5, marginTop: 5 }}><button type="button" disabled={busy} onClick={applyIsoLine}>移动整条控制线</button><button type="button" disabled={busy || (localEdit.direction === "u" ? cols : rows) <= 4 || localEdit.index <= 0 || localEdit.index >= (localEdit.direction === "u" ? cols : rows) - 1} onClick={reduceLocalLine}>局部简化</button></div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 72px auto", gap: 5, marginTop: 7 }}><select value={localEdit.edge} onChange={(event) => setLocalEdit((value) => ({ ...value, edge: event.target.value as BSplineEdge }))} disabled={busy}>{edgeOptions.map((edge) => <option key={edge.value} value={edge.value}>{edge.label}</option>)}</select><input aria-label="自然延伸比例" type="number" min="0.1" max="10" step="0.25" value={localEdit.extension} onChange={(event) => setLocalEdit((value) => ({ ...value, extension: Number(event.target.value) }))} disabled={busy}/><button type="button" disabled={busy} onClick={extendNaturalBoundary}>自然延伸</button></div>
    </details>
    <details open={!!tensorNurbs} style={{ border: "1px solid #284754", borderRadius: 4, padding: 6, marginBottom: 6 }}>
      <summary style={{ cursor: "pointer", fontSize: 11, fontWeight: 700 }}>完整 U/V NURBS</summary>
      <label style={{ display: "flex", gap: 5, alignItems: "center", fontSize: 10, marginTop: 6 }}><input type="checkbox" checked={!!tensorNurbs} onChange={(event) => { if (event.target.checked) { const next = createDefaultTensorProductNurbs(controlNet); setRationalSections(undefined); replaceTensorNurbs(next, "已启用完整双向 NURBS；U/V 参数与每个控制点权重独立参与几何构造。"); } else replaceTensorNurbs(undefined, "已切回普通控制网曲面。"); }} disabled={busy} />启用双向次数、节点和逐点权重</label>
      {tensorNurbs ? <>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 6 }}>
          {(["u", "v"] as const).map((direction) => <div key={direction} style={{ border: "1px solid #223b4a", borderRadius: 3, padding: 5 }}>
            <label style={{ fontSize: 10 }}>{direction.toUpperCase()} 向次数<input aria-label={`${direction.toUpperCase()}向次数`} type="number" min="1" max={(direction === "u" ? cols : rows) - 1} step="1" value={tensorNurbs[direction].degree} onChange={(event) => updateTensorDegree(direction, Number(event.target.value))} disabled={busy} style={{ ...inputStyle, width: "100%" }} /></label>
            <label style={{ display: "grid", gap: 2, fontSize: 10, marginTop: 5 }}>节点（逗号分隔）<input aria-label={`${direction.toUpperCase()}向节点`} value={direction === "u" ? uKnotsText : vKnotsText} onChange={(event) => direction === "u" ? setUKnotsText(event.target.value) : setVKnotsText(event.target.value)} disabled={busy} style={{ ...inputStyle, width: "100%" }} /></label>
            <label style={{ display: "grid", gap: 2, fontSize: 10, marginTop: 5 }}>重数（逗号分隔）<input aria-label={`${direction.toUpperCase()}向重数`} value={direction === "u" ? uMultiplicitiesText : vMultiplicitiesText} onChange={(event) => direction === "u" ? setUMultiplicitiesText(event.target.value) : setVMultiplicitiesText(event.target.value)} disabled={busy} style={{ ...inputStyle, width: "100%" }} /></label>
            <button type="button" disabled={busy} onClick={() => applyTensorAxis(direction)} style={{ marginTop: 5, width: "100%" }}>应用 {direction.toUpperCase()} 向参数</button>
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 4, marginTop: 5 }}><input aria-label={`${direction.toUpperCase()}向插入节点位置`} title="0 与 1 之间的参数位置" type="number" min="0.0001" max="0.9999" step="0.05" value={direction === "u" ? uInsertKnot : vInsertKnot} onChange={(event) => direction === "u" ? setUInsertKnot(Number(event.target.value)) : setVInsertKnot(Number(event.target.value))} disabled={busy} style={{ ...inputStyle, width: "100%" }} /><button type="button" disabled={busy || (direction === "u" ? cols : rows) >= 13} onClick={() => insertExactKnot(direction, direction === "u" ? uInsertKnot : vInsertKnot)}>保持形状插入</button></div>
          </div>)}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 6, alignItems: "center", marginTop: 6 }}><small style={{ color: "#85aeb6" }}>W 会改变对应控制点对曲面的吸引强度</small><button type="button" disabled={busy} onClick={() => replaceTensorNurbs({ ...tensorNurbs, weights: createUnitWeightGrid(rows, cols) }, "全部逐点权重已恢复为 1。")}>权重归一</button></div>
      </> : null}
    </details>
    <details style={{ border: "1px solid #284754", borderRadius: 4, padding: 6, marginBottom: 6 }}>
      <summary style={{ cursor: "pointer", fontSize: 11, fontWeight: 700 }}>兼容有理截面曲面</summary>
      <label style={{ display: "flex", gap: 5, alignItems: "center", fontSize: 10, marginTop: 6 }}><input type="checkbox" checked={!!rationalSections} onChange={(event) => { if (event.target.checked) { setTensorNurbs(undefined); syncAxisText(undefined); replaceRationalSections(createDefaultRationalBSplineSections(controlNet), "已启用兼容有理截面。新曲面建议使用上方完整 U/V NURBS。"); } else replaceRationalSections(undefined, "已切回普通控制网曲面。"); }} disabled={busy} />启用单向截面参数</label>
      {rationalSections ? <>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5, marginTop: 6 }}>
          <label style={{ fontSize: 10 }}>截面方向<select value={rationalSections.direction} onChange={(event) => { const direction = event.target.value as "u" | "v"; replaceRationalSections(changeRationalBSplineSectionDirection(controlNet, rationalSections, direction), `已改为 ${direction.toUpperCase()} 向有理截面；不同方向对应不同控制点，权重已归一。`); }} disabled={busy} style={{ ...selectStyle, width: "100%" }}><option value="u">U 向</option><option value="v">V 向</option></select></label>
          <label style={{ fontSize: 10 }}>次数<input aria-label="有理截面次数" type="number" min="1" max={(rationalSections.direction === "u" ? cols : rows) - 1} step="1" value={rationalSections.degree} onChange={(event) => { const generated = createDefaultRationalBSplineSections(controlNet, rationalSections.direction, Number(event.target.value)); generated.weights = structuredClone(rationalSections.weights); replaceRationalSections(generated, "次数与开放均匀节点已更新。"); }} disabled={busy} style={{ ...inputStyle, width: "100%" }} /></label>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 6, alignItems: "center", marginTop: 6 }}><small style={{ color: "#85aeb6" }}>节点 {rationalSections.knots.map((value) => Number(value.toFixed(3))).join(" · ")} · 重数 {rationalSections.multiplicities.join(" · ")}</small><button type="button" disabled={busy} onClick={() => replaceRationalSections({ ...rationalSections, weights: createUnitWeightGrid(rows, cols) }, "全部权重已恢复为 1。")}>权重归一</button></div>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 6 }}>{Array.from({ length: rationalSections.direction === "u" ? cols : rows }, (_, index) => <label key={index} style={{ fontSize: 10 }}>W{index + 1}<input aria-label={`截面权重${index + 1}`} title="截面控制点权重" type="number" min="0.01" step="0.1" value={rationalSections.direction === "u" ? rationalSections.weights[0]?.[index] ?? 1 : rationalSections.weights[index]?.[0] ?? 1} onChange={(event) => { const value = Number(event.target.value); if (!Number.isFinite(value) || value <= 0) return; const next = structuredClone(rationalSections); if (next.direction === "u") next.weights = next.weights.map((row) => row.map((weight, col) => col === index ? value : weight)); else next.weights = next.weights.map((row, rowIndex) => row.map((weight) => rowIndex === index ? value : weight)); replaceRationalSections(next, `W${index + 1} 权重已更新。`); }} disabled={busy} style={{ ...inputStyle, display: "block", borderColor: "#6a7650" }} /></label>)}</div>
      </> : null}
    </details>
    {matchingSurfaces.length ? <details style={{ border: "1px solid #284754", borderRadius: 4, padding: 6, marginBottom: 6 }}>
      <summary style={{ cursor: "pointer", fontSize: 11, fontWeight: 700 }}>与相邻曲面匹配</summary>
      <label style={{ display: "grid", gap: 3, fontSize: 10, marginTop: 6 }}>基准曲面<select value={matchSourceId || matchingSurfaces[0]?.id} onChange={(event) => setMatchSourceId(event.target.value)} disabled={busy} style={selectStyle}>{matchingSurfaces.map((surface) => <option key={surface.id} value={surface.id}>{surface.name}</option>)}</select></label>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5, marginTop: 5 }}>
        <label style={{ fontSize: 10 }}>基准边<select value={sourceEdge} onChange={(event) => setSourceEdge(event.target.value as BSplineEdge)} disabled={busy} style={{ ...selectStyle, width: "100%" }}>{edgeOptions.map((edge) => <option key={edge.value} value={edge.value}>{edge.label}</option>)}</select></label>
        <label style={{ fontSize: 10 }}>当前边<select value={targetEdge} onChange={(event) => setTargetEdge(event.target.value as BSplineEdge)} disabled={busy} style={{ ...selectStyle, width: "100%" }}>{edgeOptions.map((edge) => <option key={edge.value} value={edge.value}>{edge.label}</option>)}</select></label>
        <label style={{ fontSize: 10 }}>连续性<select value={continuity} onChange={(event) => setContinuity(event.target.value as BSplineMatchContinuity)} disabled={busy} style={{ ...selectStyle, width: "100%" }}><option>G0</option><option>G1</option><option>G2</option></select></label>
        <label style={{ fontSize: 10 }}>切向比例<input aria-label="曲面匹配切向比例" type="number" min="0.1" max="10" step="0.1" value={tangentScale} onChange={(event) => setTangentScale(Number(event.target.value))} disabled={busy} style={{ ...inputStyle, width: "100%" }} /></label>
      </div>
      <label style={{ display: "flex", gap: 5, alignItems: "center", fontSize: 10, margin: "6px 0" }}><input type="checkbox" checked={reverseBoundary} onChange={(event) => setReverseBoundary(event.target.checked)} disabled={busy} />反转边界方向</label>
      <label style={{ display: "flex", gap: 5, alignItems: "center", fontSize: 10, margin: "6px 0" }}><input type="checkbox" checked={adaptBoundaryCount} onChange={(event) => setAdaptBoundaryCount(event.target.checked)} disabled={busy} />自动对齐边界控制点数量</label>
      <div style={{ display: "flex", gap: 5 }}><button type="button" disabled={busy} onClick={applyBoundaryMatch}>加入并主动求解</button><button type="button" disabled={busy || !boundaryMatches.length} onClick={solveBoundaryNetwork}>重算曲面网络</button></div>
      {boundaryMatches.map((match) => <div key={match.targetEdge} style={{ display: "flex", justifyContent: "space-between", gap: 6, alignItems: "center", marginTop: 6 }}><small style={{ color: "#85aeb6" }}>{edgeLabel(match.targetEdge)} · {match.continuity} · {matchingSurfaces.find((surface) => surface.id === match.sourceFeatureId)?.name ?? match.sourceFeatureId}</small><button type="button" disabled={busy} onClick={() => { setUndoStack((stack) => [...stack, snapshot()].slice(-30)); setRedoStack([]); setBoundaryMatches((current) => current.filter((entry) => entry.targetEdge !== match.targetEdge)); setLocalNotice(`已解除 ${edgeLabel(match.targetEdge)} 的边界关联，当前形状保持不变。`); }}>取消跟随</button></div>)}
    </details> : null}
    {localNotice ? <small role="status" style={{ color: "#85aeb6", display: "block", marginBottom: 6 }}>{localNotice}</small> : null}
    <div style={{ maxHeight: 210, overflow: "auto", display: "grid", gap: 4 }}>
      {controlNet.map((row, r) => <div key={r} style={{ display: "flex", gap: 4, alignItems: "center", minWidth: Math.max(650, cols * (tensorNurbs ? 265 : 205)) }}><span style={{ width: 26, color: "#6e879b", fontSize: 10 }}>R{r+1}</span>{row.map((point, c) => <div key={c} style={{ display: "flex", gap: 2, padding: 3, border: "1px solid #223b4a", borderRadius: 3 }}><small style={{ color: "#6f879d", alignSelf: "center" }}>P{c+1}</small>{(["x","y","z"] as const).map((axis) => <input key={axis} aria-label={`R${r+1}C${c+1}${axis}`} type="number" step="1" value={point[axis]} onChange={(event) => update(r,c,axis,Number(event.target.value))} disabled={busy} style={inputStyle} />)}{tensorNurbs ? <input aria-label={`R${r+1}C${c+1}W`} title="该控制点权重" type="number" min="0.01" step="0.1" value={tensorNurbs.weights[r]?.[c] ?? 1} onChange={(event) => updateTensorWeight(r, c, Number(event.target.value))} disabled={busy} style={{ ...inputStyle, borderColor: "#6a7650" }} /> : null}</div>)}</div>)}
    </div>
    <small style={{ color: "#648093", display: "block", marginTop: 6 }}>范围 X {range.x[0].toFixed(1)}…{range.x[1].toFixed(1)} · Y {range.y[0].toFixed(1)}…{range.y[1].toFixed(1)} · Z {range.z[0].toFixed(1)}…{range.z[1].toFixed(1)} mm · 平顺度 {fairness.toFixed(3)}</small>
    <button type="button" disabled={busy} onClick={() => void commit()} style={{ borderColor: "#408d78", width: "100%", marginTop: 7 }}>{actionLabel}</button>
  </div>;
}
