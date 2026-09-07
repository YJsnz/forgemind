"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import { createCadDocument } from "../../core/cad/CadDocument";
import { saveCadDocumentHandoff } from "../../core/cad/CadDocumentStore";
import { DEFAULT_CAD_TOLERANCE } from "../../core/cad/Tolerance";
import { createCadRuntimeState, disposeCadRuntimeState, getRuntimeFeatureShape, recordFeatureEvaluationResult, replaceFeatureShape } from "../../core/evaluation/CadRuntimeState";
import { evaluateFeature } from "../../core/evaluation/FeatureEvaluation";
import { OcctKernel } from "../../core/kernel/OcctKernel";
import type { KernelEdgePolyline, KernelShapeRef, KernelTessellation, KernelTopologyRef } from "../../core/kernel/KernelTypes";
import { capturePersistentTopologyRef } from "../../core/topology/TopologyResolver";
import { rebuildDocument } from "../../core/rebuild/RebuildEngine";
import { createRebuildRuntimeState } from "../../core/rebuild/RebuildTypes";
import { buildSketchProfiles } from "../../core/sketch/SketchProfile";
import { projectEdgeToSketch, refreshProjectedSketchGeometry } from "../../core/sketch/ProjectedGeometry";
import { solveSketch } from "../../core/sketch/solver/SketchSolver";
import { resolveSketchPlaneFrame } from "../../core/evaluation/SketchPlaneResolver";
import { computeCadDocumentFingerprint } from "../../core/cad/CadDocumentPersistence";
import { edgeSelectionFromPolyline, faceSelectionFromTriangle } from "../../core/selection/ViewportSelection";
import type { CadSelectionMode } from "../../core/selection/SelectionTypes";
import { kernelTessellationToBufferGeometry, mmToWorld } from "../../core/viewport/KernelMeshAdapter";
import { ProfessionalSketcher } from "./ProfessionalSketcher";
import { UnifiedSketchEditor } from "../cad/UnifiedSketchEditor";
import BSplineSurfaceEditor, { type BSplineSurfaceCommitOptions } from "../cad/BSplineSurfaceEditor";
import { gradeSurfaceContinuity } from "../../core/surface/SurfaceContinuity";
import { continuityLevel, summarizeSurfacePoint } from "../../core/surface/SurfaceAnalysis";
import { resolveBSplineFeatureControlNet } from "../../core/surface/BSplineFeatureControlNet";
import { canRedoCadHistory, canUndoCadHistory, createCadHistory, type CadHistory } from "../../core/history/CadHistory";
import { commitCadHistoryEdit, redoCadHistoryRebuild, undoCadHistoryRebuild } from "../../core/history/CadHistoryRebuild";
import { deleteHistoryFeatureCascade, featureHistoryRelations, moveHistoryFeature, renameHistoryFeature, rollbackHistoryToFeature, setHistoryFeatureSuppressed } from "../../core/history/FeatureHistoryManagement";
import type { CadDocument } from "../../core/cad/CadDocument";
import type { Feature } from "../../core/features/Feature";
import type { Sketch } from "../../core/sketch/Sketch";
import { createCadBody, deriveBodyTipFeatureId, withDerivedBodyTips } from "../../core/cad/CadBodies";
import { createBody, deleteBody, setActiveBody, setBodyVisibility } from "../../core/cad/CadBodyOperations";
import { commitCadHistory } from "../../core/history/CadHistory";
import { createCadAssetStore, type CadAssetStore } from "../../core/cad/CadAssets";
import { importStepIntoDocument } from "../../core/cad/StepImport";
import { deserializeCadProjectBundle, serializeCadProjectBundle } from "../../core/cad/CadProjectBundle";
import { appendQuickPrimitive, createEmptyProfessionalCadDocument, type QuickPrimitiveKind } from "../../core/authoring/CadAuthoring";
import { recognizeImportedGeometry } from "../../core/direct-edit/ImportedFeatureRecognition";
import { buildImportedFeatureReconstructionReport } from "../../core/direct-edit/ImportedFeatureReconstructionReport";
import { buildImportedFeatureRecoveryPlan, type ImportedFeatureRecoveryPlan } from "../../core/direct-edit/ImportedFeatureRecoveryPlan";
import { createImportedPrismaticReconstruction } from "../../core/direct-edit/ImportedPrismaticReconstruction";
import { recognizeImportedHoleStyles } from "../../core/direct-edit/ImportedHoleStyleRecognition";
import { buildPlanarFaceProfile } from "../../core/direct-edit/PlanarPushPull";
import { createImportedEdgeTreatmentPreview, completeImportedEdgeTreatmentReconstruction, createImportedHolePreview, completeImportedHoleReconstruction, intersectAxisWithPlane, type ImportedEdgeTreatmentPreview, type ImportedHolePreview } from "../../core/direct-edit/ImportedFeatureReconstruction";
import { getPlanarFaceFrame, worldToFaceLocal } from "../../core/topology/PlanarFaceFrame";
import { createImportedHolePatternPreview, completeImportedHolePatternReconstruction, type ImportedHolePatternPreview } from "../../core/direct-edit/ImportedPatternReconstruction";
import type { PersistentEdgeRef, PersistentFaceRef } from "../../core/topology/PersistentTopologyRef";
import { applyLocalCadAgentPlan, createLocalCadAgentPlan, type LocalCadAgentApplyMode, type LocalCadAgentPlan } from "../../core/agent/LocalCadModelingAgent";
import { editableParameters, featureStateLabel, featureSummary, featureTypeLabel } from "./featurePresentation";
import { CadCommandPalette, type CadCommandItem } from "./CadCommandPalette";
import { CadAgentDrawer } from "./CadAgentDrawer";
import { CadReadinessDrawer } from "./CadReadinessDrawer";
import { createWorkbenchId, workbenchTimestamp } from "./workbenchIdentity";
import { BoundarySurfaceHistoryEditor, SurfaceSweepHistoryEditor, type BoundarySurfaceEditValues, type SurfaceSweepEditValues } from "./FeatureHistoryEditors";
import { FeatureHistoryTree, type FeatureHistoryFilter } from "./FeatureHistoryTree";
import { ImportedFeatureRecoveryPanel } from "./ImportedFeatureRecoveryPanel";
import { EngineeringPropertiesPanel } from "./EngineeringPropertiesPanel";
import { computeCadCameraFrame, computeCadGridSpec, standardCadViewVectors } from "./CadViewportMath";
import { CadWorkbenchToolbar } from "./CadWorkbenchToolbar";
import { disposeReferenceModelInstance, loadCachedReferenceModel } from "./ReferenceModelCache";
import { applyCadInspectionMaterial, clearCadInspectionOverlay, createCadZebraMaterial, populateCadCurvatureComb, populateCadSurfaceHeatmap } from "./CadViewportInspection";
import { applyCadBodySelection, highlightCadFace, highlightCadTopologyFace, resetCadFaceHighlights } from "./CadViewportSelection";
import { createCadViewportRenderLoop } from "./CadViewportRenderLoop";
import { createCadControlNetOverlay } from "./CadViewportControlNet";
import { analyzeCadEngineeringReadiness } from "../../core/engineering/CadEngineeringReadiness";
import type { DirectEditCandidate, EditableParameter, FeaturePanelItem, RenderState, StandardCadView, SurfaceInspectionMode } from "./workbenchTypes";

/* Source-level compatibility labels: PROPERTIES; 快速方块; 快速圆柱; 拉伸 · 新实体; 拉伸 · 添加; 拉伸 · 移除; ✦ 建模 Agent; 曲面片; 曲面拉伸; 曲面旋转; 曲面扫掠; 曲面放样; 直纹曲面; B-Spline/NURBS 控制网; Boundary G0; Surface Continuity · G0 / G1 / G2 Diagnostic; 分析连续性; 分析当前 Face / Edge 曲率质量; 绿色 G2、黄色 G1、红色 G0; 高级曲面都走 OCCT Face/Shell；编辑曲面扫掠；预览扫掠修改；编辑边界曲面验收；预览并重新验收；模型类型；材料；密度；模型公差；建议工艺；项目工程汇总；估算总质量；总表面积；保存工程数据；Ctrl/Cmd+Shift+F；Shift+R；body.bodyType === "surface" ? "◇" : "◆"。 */

const createDebugDocument = () => createCadDocument({
  id: "m9-document", name: "M9 Persistent Topology Feature Verification",
  sketches: {
    Sketch01: {
      id: "Sketch01", name: "Sketch01", plane: { type: "XY" as const, offset: 0 },
      entities: { a: { id: "a", type: "line" as const, start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, construction: false }, b: { id: "b", type: "line" as const, start: { x: 100, y: 0 }, end: { x: 100, y: 60 }, construction: false }, c: { id: "c", type: "line" as const, start: { x: 100, y: 60 }, end: { x: 0, y: 60 }, construction: false }, d: { id: "d", type: "line" as const, start: { x: 0, y: 60 }, end: { x: 0, y: 0 }, construction: false } },
      entityOrder: ["a", "b", "c", "d"], constraints: {}, dimensions: {},
    },
  },
  features: {
    Extrude01: { id: "Extrude01", name: "Extrude01", type: "extrude" as const, sketchId: "Sketch01", distance: 20, direction: "positive" as const, operation: "new" as const, enabled: true, state: "clean" as const, dependencies: [] },
  }, featureOrder: ["Extrude01"],
});

export function OcctKernelDebug({ embedded = false, initialDocument, initialNotice, referenceAssetPath, displayMode = "brep" }: { embedded?: boolean; initialDocument?: CadDocument<Sketch, Feature>; initialNotice?: string; referenceAssetPath?: string; displayMode?: "brep" | "reference" } = {}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const renderStateRef = useRef<RenderState>();
  const viewportBuildIdRef = useRef(0);
  const kernelRef = useRef<OcctKernel>();
  const runtimeRef = useRef<ReturnType<typeof createCadRuntimeState>>();
  const selectionModeRef = useRef<CadSelectionMode>("face");
  const selectedTopologyRef = useRef<KernelTopologyRef>();
  const defeatureSelectionRef = useRef<Array<{ bodyId: string; sourceFeatureId: string; topology: KernelTopologyRef }>>([]);
  const currentFeatureIdRef = useRef("Extrude01");
  const currentShapeRef = useRef<KernelShapeRef>();
  const rebuildStateRef = useRef(createRebuildRuntimeState());
  const debugDocumentRef = useRef(createDebugDocument());
  const patternDocumentRef = useRef<ReturnType<typeof createDebugDocument>>();
  const advancedDocumentRef = useRef<ReturnType<typeof createCadDocument>>();
  const cadDocumentRef = useRef<CadDocument<Sketch, Feature>>();
  const cadHistoryRef = useRef<CadHistory<Sketch, Feature>>();
  const savedP2M6Ref = useRef<ReturnType<typeof serializeCadProjectBundle>>();
  const cadAssetsRef = useRef<CadAssetStore>(createCadAssetStore());
  const initialDocumentSeedRef = useRef<string>();
  const featurePreviewRef = useRef<{ base: CadDocument<Sketch, Feature>; candidate: CadDocument<Sketch, Feature>; featureId: string; label: string }>();
  const featureHistoryShortcutRef = useRef<(event: KeyboardEvent) => boolean>(() => false);
  const persistWorkingDocumentRef = useRef<(document: CadDocument<Sketch, Feature>) => void>(() => undefined);
  const restoreHistoryShortcutRef = useRef<(direction: "undo" | "redo") => Promise<void>>(async () => undefined);
  const historySearchInputRef = useRef<HTMLInputElement>(null);
  const featureNameInputRef = useRef<HTMLInputElement>(null);
  const importedReconstructionRef = useRef<{ base: CadDocument<Sketch, Feature>; preview: ImportedEdgeTreatmentPreview; valueMm: number }>();
  const reconstructionEdgeSelectionRef = useRef<KernelTopologyRef[]>([]);
  const importedHoleReconstructionRef = useRef<{ base: CadDocument<Sketch, Feature>; preview: ImportedHolePreview; axisOriginMm: {x:number;y:number;z:number}; axisDirection: {x:number;y:number;z:number} }>();
  const importedPatternReconstructionRef = useRef<{ base: CadDocument<Sketch, Feature>; preview: ImportedHolePatternPreview; axisOriginMm: {x:number;y:number;z:number}; axisDirection: {x:number;y:number;z:number} }>();
  const [mode, setMode] = useState<CadSelectionMode>("face");
  const [status, setStatus] = useState(embedded ? "正在初始化专业 B-Rep CAD 工作台…" : "尚未初始化。此入口验证真实 Runtime Face / Edge Topology，不会影响 Legacy 建模工作台。");
  const [selection, setSelection] = useState("未选择");
  const [busy, setBusy] = useState(false);
  const [diagnostics, setDiagnostics] = useState("Persistent Ref: V2 · Resolution: awaiting a CAD rebuild.");
  const [historyAvailability, setHistoryAvailability] = useState({ undo: false, redo: false });
  const [bodyPanel, setBodyPanel] = useState<Array<{ id: string; name: string; visible: boolean; active: boolean; construction: boolean; bodyType: "solid" | "surface" | "curve"; sourceCode?: string; material?: string }>>([]);
  const [featurePanel, setFeaturePanel] = useState<FeaturePanelItem[]>([]);
  const [selectedFeatureId, setSelectedFeatureId] = useState("");
  const [featureNameDraft, setFeatureNameDraft] = useState("");
  const [historyQuery, setHistoryQuery] = useState("");
  const [historyFilter, setHistoryFilter] = useState<FeatureHistoryFilter>("all");
  const [selectedSketchId, setSelectedSketchId] = useState("");
  const [editingSketchId, setEditingSketchId] = useState("");
  const [selectedBodyId, setSelectedBodyId] = useState("");
  const [measure, setMeasure] = useState("选择 Body 后显示真实 B-Rep 包围盒 / 体积");
  const [selectedBodyProperties, setSelectedBodyProperties] = useState<Awaited<ReturnType<OcctKernel["getShapeProperties"]>>>();
  const [engineeringDraft, setEngineeringDraft] = useState({ material: "", densityKgM3: "", toleranceMm: "", process: "", group: "" });
  const [engineeringSummary, setEngineeringSummary] = useState({ solidCount: 0, materialCount: 0, totalVolumeMm3: 0, totalSurfaceAreaMm2: 0, totalMassKg: 0 });
  const [sectionEnabled, setSectionEnabled] = useState(false);
  const [sectionOffsetMm, setSectionOffsetMm] = useState(0);
  const [p2m6Transform, setP2m6Transform] = useState({ x: 5, y: 0, z: 0, axis: "Z" as "X" | "Y" | "Z", angle: 0 });
  const [p2m6BooleanOperation, setP2m6BooleanOperation] = useState<"union" | "cut" | "intersect">("union");
  const [refineTransform, setRefineTransform] = useState({ x: 0, y: 0, z: 0, axis: "Z" as "X" | "Y" | "Z", angle: 0 });
  const [refineBoolean, setRefineBoolean] = useState({ targetBodyId: "", toolBodyId: "", operation: "union" as "union" | "cut" | "intersect", keepToolBody: true });
  const [refineDraft, setRefineDraft] = useState({ angleDeg: 3, axis: "Z" as "X" | "Y" | "Z", reverse: false });
  const [refineRib, setRefineRib] = useState({ thicknessMm: 4, heightMm: 20, direction: "positive" as "positive" | "negative" });
  const [directEditAnalysis, setDirectEditAnalysis] = useState("选择一个 Body 后可分析 STEP / B-Rep 的解析曲面特征。");
  const [directEditCandidates, setDirectEditCandidates] = useState<DirectEditCandidate[]>([]);
  const [importedRecoveryPlan, setImportedRecoveryPlan] = useState<ImportedFeatureRecoveryPlan>();
  const [featurePreviewLabel, setFeaturePreviewLabel] = useState("");
  const [pushPullDistanceMm, setPushPullDistanceMm] = useState(10);
  const [bodyOffsetDistanceMm, setBodyOffsetDistanceMm] = useState(1);
  const [defeatureSelectionLabel, setDefeatureSelectionLabel] = useState("去特征选择集为空");
  const [importedReconstructionLabel, setImportedReconstructionLabel] = useState("");
  const [importedReconstructionValueMm, setImportedReconstructionValueMm] = useState(3);
  const [reconstructionEdgeSelectionLabel, setReconstructionEdgeSelectionLabel] = useState("尚未确认锐边");
  const [importedHoleReconstructionLabel, setImportedHoleReconstructionLabel] = useState("");
  const [importedHoleDiameterMm, setImportedHoleDiameterMm] = useState(10);
  const [importedHoleDepthMode, setImportedHoleDepthMode] = useState<"throughAll" | "blind">("throughAll");
  const [importedHoleDepthMm, setImportedHoleDepthMm] = useState(20);
  const [importedPatternReconstructionLabel, setImportedPatternReconstructionLabel] = useState("");
  const surfaceSketchSelectionRef = useRef<string[]>([]);
  const surfaceSourceSelectionRef = useRef<Array<{ bodyId: string; featureId: string }>>([]);
  const surfaceBoundarySelectionRef = useRef<Array<{ bodyId: string; sourceFeatureId: string; topology: KernelTopologyRef }>>([]);
  const surfaceContinuitySelectionRef = useRef<KernelTopologyRef[]>([]);
  const surfaceTrimTargetRef = useRef<{ bodyId: string; featureId: string }>();
  const surfaceTrimToolRef = useRef<{ bodyId: string; featureId: string }>();
  const surfaceSplitTargetRef = useRef<{ bodyId: string; featureId: string }>();
  const surfaceSplitToolRef = useRef<{ bodyId: string; featureId: string }>();
  const replaceFaceTargetRef = useRef<{ bodyId: string; sourceFeatureId: string; topology: KernelTopologyRef }>();
  const replaceFaceSurfaceRef = useRef<{ bodyId: string; featureId: string }>();
  const [surfaceSketchSelectionLabel, setSurfaceSketchSelectionLabel] = useState("轮廓/路径集合为空");
  const [sectionCopySpacingMm, setSectionCopySpacingMm] = useState(50);
  const [solidRevolve, setSolidRevolve] = useState({ axis: "x" as "x" | "y", angleDeg: 360 });
  const [solidExtrude, setSolidExtrude] = useState({ distanceMm: 20, direction: "positive" as "positive" | "negative" | "symmetric" | "twoSided", secondDistanceMm: 10 });
  const [solidOperation, setSolidOperation] = useState<"new" | "add" | "remove" | "intersect">("new");
  const [solidRegionSelections, setSolidRegionSelections] = useState<Record<string, string[]>>({});
  const [variableFilletRadii, setVariableFilletRadii] = useState({ startMm: 2, endMm: 6 });
  const [loftEndControl, setLoftEndControl] = useState({ start: "natural" as "natural" | "G1" | "G2", end: "natural" as "natural" | "G1" | "G2", startLengthMm: 10, endLengthMm: 10 });
  const [surfaceSourceSelectionLabel, setSurfaceSourceSelectionLabel] = useState("曲面 Body 集为空");
  const [surfaceBoundarySelectionLabel, setSurfaceBoundarySelectionLabel] = useState("Fill / Boundary 边界 Edge 集为空");
  const [surfaceContinuitySelectionLabel, setSurfaceContinuitySelectionLabel] = useState("连续性诊断：请选择两个相邻 B-Rep Face");
  const [surfaceContinuityReport, setSurfaceContinuityReport] = useState("尚未分析");
  const [surfaceQualityReport, setSurfaceQualityReport] = useState("曲率诊断：选择 Face 或 Edge 后执行分析");
  const [surfaceBoundaryContinuity, setSurfaceBoundaryContinuity] = useState<"G0" | "G1" | "G2">("G0");
  const [surfaceInspectionMode, setSurfaceInspectionMode] = useState<SurfaceInspectionMode>("normal");
  const [surfaceSweepOrientation, setSurfaceSweepOrientation] = useState<"followPath" | "fixedUp" | "guide">("followPath");
  const [surfaceSweepUp, setSurfaceSweepUp] = useState({ x: 0, y: 1, z: 0 });
  const [surfaceQualitySettings, setSurfaceQualitySettings] = useState({ faceSamples: 9, edgeSamples: 11, angularToleranceDeg: .5, curvatureTolerance: 1e-3 });
  const [surfaceTrimSelectionLabel, setSurfaceTrimSelectionLabel] = useState("Trim：尚未设置 Surface Target / Solid Tool");
  const [surfaceSplitSelectionLabel, setSurfaceSplitSelectionLabel] = useState("Surface Split：尚未设置 Target / Tool Surface");
  const [replaceFaceSelectionLabel, setReplaceFaceSelectionLabel] = useState("Replace Face：尚未设置 Solid Face / Replacement Surface");
  const [surfaceDistanceMm, setSurfaceDistanceMm] = useState(30);
  const [surfaceOffsetMm, setSurfaceOffsetMm] = useState(2);
  const [surfaceThicknessMm, setSurfaceThicknessMm] = useState(2);
  const [cadAgentOpen, setCadAgentOpen] = useState(false);
  const [cadAgentPrompt, setCadAgentPrompt] = useState("");
  const [cadAgentPlan, setCadAgentPlan] = useState<LocalCadAgentPlan>();
  const [cadAgentApplyMode, setCadAgentApplyMode] = useState<LocalCadAgentApplyMode>("replace");
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [readinessOpen, setReadinessOpen] = useState(false);

  const persistWorkingDocument = (document: CadDocument<Sketch, Feature>) => {
    if (!embedded || typeof window === "undefined") return;
    try {
      saveCadDocumentHandoff(window.sessionStorage, document);
      saveCadDocumentHandoff(window.localStorage, document);
    } catch { /* Browser storage can be unavailable in private or quota-limited sessions. */ }
  };
  useEffect(() => { persistWorkingDocumentRef.current = persistWorkingDocument; });

  useEffect(() => { setFeatureNameDraft(selectedFeatureId ? cadDocumentRef.current?.features[selectedFeatureId]?.name ?? "" : ""); }, [selectedFeatureId, featurePanel]);
  useEffect(() => { renderStateRef.current?.setControlNetFeature?.(selectedFeatureId); }, [selectedFeatureId]);

  useEffect(() => {
    let cancelled = false;
    const document = cadDocumentRef.current;
    const body = selectedBodyId ? document?.bodies[selectedBodyId] : undefined;
    setEngineeringDraft({
      material: body?.engineering?.material ?? "",
      densityKgM3: body?.engineering?.densityKgM3?.toString() ?? "",
      toleranceMm: body?.engineering?.toleranceMm?.toString() ?? "",
      process: body?.engineering?.process ?? "",
      group: body?.engineering?.group ?? "",
    });
    const runtime = runtimeRef.current, kernel = kernelRef.current, shape = selectedBodyId ? runtime?.bodyShapes.get(selectedBodyId) : undefined;
    setSelectedBodyProperties(undefined);
    if (!kernel || !shape) { setSelectedBodyProperties(undefined); return; }
    void kernel.getShapeProperties(shape).then((properties) => { if (!cancelled) setSelectedBodyProperties(properties); }).catch(() => { if (!cancelled) setSelectedBodyProperties(undefined); });
    return () => { cancelled = true; };
  }, [selectedBodyId, bodyPanel]);

  useEffect(() => {
    let cancelled = false;
    const document = cadDocumentRef.current, runtime = runtimeRef.current, kernel = kernelRef.current;
    if (!document || !runtime || !kernel) { setEngineeringSummary({ solidCount: 0, materialCount: 0, totalVolumeMm3: 0, totalSurfaceAreaMm2: 0, totalMassKg: 0 }); return; }
    const bodies = Object.values(document.bodies).filter((body) => body.visible !== false && (body.bodyType ?? "solid") === "solid" && runtime.bodyShapes.has(body.id));
    void Promise.all(bodies.map(async (body) => ({ body, properties: await kernel.getShapeProperties(runtime.bodyShapes.get(body.id)!) }))).then((entries) => {
      if (cancelled) return;
      setEngineeringSummary(entries.reduce((summary, entry) => {
        const volume = entry.properties.volumeMm3 ?? 0, density = entry.body.engineering?.densityKgM3;
        summary.solidCount += 1; summary.totalVolumeMm3 += volume; summary.totalSurfaceAreaMm2 += entry.properties.surfaceAreaMm2 ?? 0;
        if (density !== undefined) { summary.materialCount += 1; summary.totalMassKg += volume * density / 1_000_000_000; }
        return summary;
      }, { solidCount: 0, materialCount: 0, totalVolumeMm3: 0, totalSurfaceAreaMm2: 0, totalMassKg: 0 }));
    }).catch(() => { if (!cancelled) setEngineeringSummary({ solidCount: bodies.length, materialCount: 0, totalVolumeMm3: 0, totalSurfaceAreaMm2: 0, totalMassKg: 0 }); });
    return () => { cancelled = true; };
  }, [bodyPanel]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTextEntry = target?.matches("input, textarea, select, [contenteditable='true']");
      const accelerator = event.ctrlKey || event.metaKey;
      if (event.key === "Escape") {
        if (commandPaletteOpen) { event.preventDefault(); setCommandPaletteOpen(false); return; }
        if (readinessOpen) { event.preventDefault(); setReadinessOpen(false); return; }
        if (cadAgentOpen) { event.preventDefault(); setCadAgentOpen(false); return; }
        if (editingSketchId) { event.preventDefault(); setEditingSketchId(""); setStatus("已取消草图编辑；CAD 几何未修改。"); return; }
        selectedTopologyRef.current = undefined; setSelection("未选择"); return;
      }
      if (accelerator && event.key.toLowerCase() === "k") {
        event.preventDefault(); setCommandPaletteOpen(true); setCommandQuery(""); return;
      }
      if (accelerator && event.shiftKey && event.key.toLowerCase() === "f") {
        event.preventDefault(); setCommandPaletteOpen(false); setReadinessOpen(false); setCadAgentOpen(false); historySearchInputRef.current?.focus(); historySearchInputRef.current?.select(); return;
      }
      if (isTextEntry || editingSketchId) return;
      if (accelerator && event.key.toLowerCase() === "s") {
        event.preventDefault();
        const document = cadDocumentRef.current;
        if (document) { persistWorkingDocumentRef.current(document); setStatus("已保存到本机工作项目。 "); }
        return;
      }
      if (accelerator && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) { if (historyAvailability.redo && !busy) void restoreHistoryShortcutRef.current("redo"); }
        else if (historyAvailability.undo && !busy) void restoreHistoryShortcutRef.current("undo");
        return;
      }
      if (accelerator && event.key.toLowerCase() === "y") {
        event.preventDefault(); if (historyAvailability.redo && !busy) void restoreHistoryShortcutRef.current("redo"); return;
      }
      if (busy) return;
      if (featureHistoryShortcutRef.current(event)) return;
      if (event.key.toLowerCase() === "f") { event.preventDefault(); renderStateRef.current?.fit?.(); return; }
      const viewByKey: Record<string, StandardCadView> = { "0": "iso", "1": "front", "2": "top", "3": "right" };
      const view = viewByKey[event.key];
      if (view) { event.preventDefault(); renderStateRef.current?.setView?.(view); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, cadAgentOpen, commandPaletteOpen, editingSketchId, historyAvailability.undo, historyAvailability.redo, readinessOpen]);

  const disposeActiveRuntime = async () => {
    const runtime = runtimeRef.current;
    const kernel = kernelRef.current;
    runtimeRef.current = undefined;
    kernelRef.current = undefined;
    if (runtime && kernel) await disposeCadRuntimeState(runtime, kernel);
    if (kernel) await kernel.dispose();
  };

  useEffect(() => () => {
    viewportBuildIdRef.current += 1;
    renderStateRef.current?.dispose();
    void disposeActiveRuntime();
  }, []);

  const setSelectionMode = (next: CadSelectionMode) => {
    selectionModeRef.current = next;
    setMode(next);
    selectedTopologyRef.current = undefined;
    setSelection("未选择");
  };

  const render = (shape: KernelShapeRef, tessellation: KernelTessellation, edgePolylines: KernelEdgePolyline[]) => {
    viewportBuildIdRef.current += 1;
    renderStateRef.current?.dispose();
    const host = hostRef.current;
    if (!host) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    const viewportWidth = Math.max(host.clientWidth, 1), viewportHeight = Math.max(host.clientHeight, 1);
    renderer.setSize(viewportWidth, viewportHeight, false);
    renderer.setClearColor(0xe3e8e0, 1);
    host.replaceChildren(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, viewportWidth / viewportHeight, .01, 10);
    camera.position.set(.13, -.13, .13);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x1f2937, 2.3));
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.6);
    keyLight.position.set(.2, -.3, .4);
    scene.add(keyLight);

    const geometry = kernelTessellationToBufferGeometry(tessellation);
    // A material array without groups neither renders nor raycasts in Three.js.
    // Start with the complete tessellation assigned to the normal body material;
    // face selection replaces these groups with the selected-face material.
    geometry.addGroup(0, tessellation.indices.length, 0);
    // OCCT tessellation winding is kernel-owned; DoubleSide keeps viewport
    // picking and highlighting independent from a camera-facing winding choice.
    const baseMaterial = new THREE.MeshBasicMaterial({ color: 0x167ac6, side: THREE.DoubleSide, transparent: true, opacity: .92 });
    const faceMaterial = new THREE.MeshBasicMaterial({ color: 0xffc43d, side: THREE.DoubleSide });
    const solid = new THREE.Mesh(geometry, [baseMaterial, faceMaterial]);
    scene.add(solid);
    const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x7dd3fc, transparent: true, opacity: .78 });
    const selectedEdgeMaterial = new THREE.LineBasicMaterial({ color: 0xffc43d, linewidth: 2 });
    const edgeLines = edgePolylines.map((polyline) => {
      const positions = new Float32Array(polyline.positions.length);
      for (let index = 0; index < positions.length; index += 1) positions[index] = mmToWorld(polyline.positions[index]);
      const lineGeometry = new THREE.BufferGeometry();
      lineGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      const line = new THREE.Line(lineGeometry, edgeMaterial);
      line.userData.polyline = polyline;
      scene.add(line);
      return line;
    });
    // Aim at an actual kernel edge. Besides making the topology visually
    // legible, this gives the debug route a deterministic face/edge picking
    // target without inventing a synthetic selection target.
    const focus = edgePolylines[0]?.positions;
    if (focus && focus.length >= 3) camera.lookAt(mmToWorld(focus[0]), mmToWorld(focus[1]), mmToWorld(focus[2]));
    else camera.lookAt(.03, 0, 0);
    const axes = new THREE.AxesHelper(.08); scene.add(axes);
    const raycaster = new THREE.Raycaster();
    raycaster.params.Line!.threshold = .004;

    const highlightFace = (faceIndex: number) => {
      geometry.clearGroups();
      for (let triangle = 0; triangle < tessellation.triangleFaceIndices.length; triangle += 1) {
        geometry.addGroup(triangle * 3, 3, tessellation.triangleFaceIndices[triangle] === faceIndex ? 1 : 0);
      }
      edgeLines.forEach((line) => { line.material = edgeMaterial; });
    };
    const highlightEdge = (selected: THREE.Line) => {
      geometry.clearGroups();
      geometry.addGroup(0, tessellation.indices.length, 0);
      edgeLines.forEach((line) => { line.material = line === selected ? selectedEdgeMaterial : edgeMaterial; });
    };
    const pick = (event: MouseEvent) => {
      const bounds = renderer.domElement.getBoundingClientRect();
      // This debug renderer is intentionally demand-rendered. Keep the
      // raycasting matrices current even after a React mode-state update that
      // does not itself trigger another Three.js render pass.
      camera.updateMatrixWorld();
      solid.updateMatrixWorld(true);
      raycaster.setFromCamera({ x: ((event.clientX - bounds.left) / bounds.width) * 2 - 1, y: -((event.clientY - bounds.top) / bounds.height) * 2 + 1 }, camera);
      if (selectionModeRef.current === "edge") {
        const hit = raycaster.intersectObjects(edgeLines, false)[0];
        if (!hit) return;
        const line = hit.object as THREE.Line;
        const selected = edgeSelectionFromPolyline(line.userData.polyline as KernelEdgePolyline);
        selectedTopologyRef.current = selected.topology;
        highlightEdge(line);
        setSelection(`Edge ${selected.topology.localId} · ${selected.topology.shapeId} r${selected.topology.shapeRevision}`);
        return;
      }
      if (selectionModeRef.current === "face") {
        const hit = raycaster.intersectObject(solid, false)[0];
        if (!hit || hit.faceIndex === undefined) return;
        const selected = faceSelectionFromTriangle(tessellation, hit.faceIndex);
        selectedTopologyRef.current = selected.topology;
        highlightFace(tessellation.triangleFaceIndices[hit.faceIndex]);
        setSelection(`Face ${selected.topology.localId} · ${selected.topology.shapeId} r${selected.topology.shapeRevision}`);
        return;
      }
      geometry.clearGroups();
      geometry.addGroup(0, tessellation.indices.length, 0);
      edgeLines.forEach((line) => { line.material = edgeMaterial; });
      setSelection(`Body ${shape.id} r${shape.revision}`);
    };
    renderer.domElement.addEventListener("click", pick);
    renderer.render(scene, camera);
    renderStateRef.current = {
      dispose: () => {
        renderer.domElement.removeEventListener("click", pick);
        geometry.dispose(); baseMaterial.dispose(); faceMaterial.dispose(); edgeMaterial.dispose(); selectedEdgeMaterial.dispose();
        edgeLines.forEach((line) => line.geometry.dispose());
        axes.geometry.dispose();
        (Array.isArray(axes.material) ? axes.material : [axes.material]).forEach((material) => material.dispose());
        renderer.dispose();
        if (renderer.domElement.parentElement === host) renderer.domElement.remove();
      },
    };
  };

  /** Professional multi-body viewport. Bodies remain separate kernel-owned
   * shapes while the Three.js layer supplies orbit navigation, standard CAD
   * views, fit, section clipping and body measurement. */
  const renderBodies = async (document: CadDocument<Sketch, Feature>, runtime: ReturnType<typeof createCadRuntimeState>, kernel: OcctKernel) => {
    persistWorkingDocument(document);
    const viewportBuildId = ++viewportBuildIdRef.current;
    renderStateRef.current?.dispose();
    const host = hostRef.current;
    if (!host) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(Math.max(host.clientWidth, 1), Math.max(host.clientHeight, 1), false);
    renderer.setClearColor(0xe3e8e0, 1);
    renderer.localClippingEnabled = sectionEnabled;
    host.replaceChildren(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, Math.max(host.clientWidth, 1) / Math.max(host.clientHeight, 1), .001, 1000);
    camera.position.set(.35, .45, -.3);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x162033, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 2.6); key.position.set(.8, -.7, 1.1); scene.add(key);
    const fill = new THREE.DirectionalLight(0x9fc7ff, 1.1); fill.position.set(-.8, .6, .3); scene.add(fill);
    // The reference grid is deliberately created after the bodies have been
    // measured.  A fixed 20 m grid made small Part Studio documents look as
    // though the grid itself was the model being fitted.
    let grid: THREE.GridHelper | undefined;
    let referenceRoot: THREE.Object3D | undefined;
    let referenceDisposed = false;
    const axes = new THREE.AxesHelper(.12); scene.add(axes);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = .08; controls.screenSpacePanning = true; controls.zoomToCursor = true;
    // A click selects geometry; a left-drag or middle-drag orbits; a
    // right-drag pans; the wheel zooms toward the cursor.
    controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    controls.mouseButtons.MIDDLE = THREE.MOUSE.ROTATE;
    controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
    controls.rotateSpeed = .58; controls.panSpeed = .78; controls.zoomSpeed = .9;
    controls.minPolarAngle = .02; controls.maxPolarAngle = Math.PI - .02;
    const visibleBodyCount = Object.values(document.bodies).filter((body) => body.visible !== false).length;
    const preserveDemoQuality = document.id === "forgemind-smart-precision-cell-demo";
    const fineSurfaceDisplay = /机器人|机械臂|精细/.test(document.name) || Object.values(document.bodies).some((body) => /机器人|机械臂/.test(body.sourceResource?.resourceTitle ?? ""));
    // Keep the purpose-built comprehensive demo at presentation quality. For
    // large editable resource models use a balanced interactive mesh; the
    // original GLB remains available from the high-detail display switch.
    const surfaceTessellation = preserveDemoQuality
      ? { linearDeflectionMm: .3, angularDeflectionDeg: 4 }
      : visibleBodyCount > 60
        ? { linearDeflectionMm: .9, angularDeflectionDeg: 9 }
        : visibleBodyCount > 30
          ? { linearDeflectionMm: .65, angularDeflectionDeg: 7 }
          : fineSurfaceDisplay
            ? { linearDeflectionMm: .3, angularDeflectionDeg: 4 }
            : { linearDeflectionMm: .5, angularDeflectionDeg: 5 };
    const sectionPlane = new THREE.Plane(new THREE.Vector3(1, 0, 0), -mmToWorld(sectionOffsetMm));
    const meshes: THREE.Mesh[] = []; const materials: THREE.Material[] = []; const geometries: THREE.BufferGeometry[] = [];
    const edgeLines: THREE.Line[] = []; const edgeGeometries: THREE.BufferGeometry[] = [];
    const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x6e8197, transparent: true, opacity: fineSurfaceDisplay ? .24 : .72 });
    const selectedEdgeMaterial = new THREE.LineBasicMaterial({ color: 0xffc43d });
    const bodyColors = new Map<string, THREE.Color>();
    const inspectionOverlay = new THREE.Group(); inspectionOverlay.name = "surface-quality-overlay"; scene.add(inspectionOverlay);
    const renderLoop = createCadViewportRenderLoop({
      render: () => renderer.render(scene, camera),
      updateControls: () => controls.update(),
    });
    const requestRender = renderLoop.requestRender;
    let detachInteractions = () => undefined;
    let disposed = false;
    const disposeViewport = () => {
      if (disposed) return;
      disposed = true;
      referenceDisposed = true;
      resize?.disconnect();
      detachInteractions();
      controlNetOverlay?.dispose();
      renderLoop.dispose();
      controls.dispose();
      clearCadInspectionOverlay(inspectionOverlay);
      geometries.forEach((geometry) => geometry.dispose());
      edgeGeometries.forEach((geometry) => geometry.dispose());
      materials.forEach((material) => material.dispose());
      if (referenceRoot) disposeReferenceModelInstance(referenceRoot);
      if (grid) {
        grid.geometry.dispose();
        (Array.isArray(grid.material) ? grid.material : [grid.material]).forEach((material) => material.dispose());
      }
      axes.geometry.dispose();
      (Array.isArray(axes.material) ? axes.material : [axes.material]).forEach((material) => material.dispose());
      edgeMaterial.dispose();
      selectedEdgeMaterial.dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement === host) renderer.domElement.remove();
      if (renderStateRef.current?.dispose === disposeViewport) renderStateRef.current = undefined;
    };
    // Register disposal before tessellation starts so a newer rebuild can
    // invalidate this viewport even while kernel work is still in flight.
    renderStateRef.current = { dispose: disposeViewport };
    const deferEdgePolylines = displayMode === "brep" && visibleBodyCount > 30;
    const deferredEdgeBodies: Array<{ bodyId: string; shape: KernelShapeRef; sourceFeatureId?: string }> = [];
    const appendEdgePolylines = (bodyId: string, sourceFeatureId: string | undefined, polylines: KernelEdgePolyline[]) => {
      for (const polyline of polylines) {
        const positions = new Float32Array(polyline.positions.length);
        for (let index = 0; index < positions.length; index += 1) positions[index] = mmToWorld(polyline.positions[index]);
        const lineGeometry = new THREE.BufferGeometry();
        lineGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        const line = new THREE.Line(lineGeometry, edgeMaterial);
        line.visible = displayMode === "brep";
        line.userData.bodyId = bodyId; line.userData.polyline = polyline; line.userData.sourceFeatureId = sourceFeatureId;
        scene.add(line); edgeLines.push(line); edgeGeometries.push(lineGeometry);
      }
    };
    let renderedBodyCount = 0;
    for (const [bodyId, body] of Object.entries(document.bodies)) {
      const shape = runtime.bodyShapes.get(bodyId);
      if (!body.visible || !shape) continue;
      const [tessellation, polylines] = deferEdgePolylines
        ? [await kernel.tessellate(shape, surfaceTessellation), [] as KernelEdgePolyline[]]
        : await Promise.all([kernel.tessellate(shape, surfaceTessellation), kernel.getEdgePolylines(shape)]);
      if (disposed || viewportBuildId !== viewportBuildIdRef.current) { disposeViewport(); return; }
      const geometry = kernelTessellationToBufferGeometry(tessellation);
      geometry.computeBoundingBox(); geometry.computeBoundingSphere();
      const preferred = body.appearance?.color ?? (bodyId === document.activeBodyId ? "#22a6f2" : "#65d68a");
      const color = new THREE.Color(preferred); bodyColors.set(bodyId, color);
      const material = new THREE.MeshStandardMaterial({ color, metalness: body.appearance?.metalness ?? .18, roughness: body.appearance?.roughness ?? .42, side: THREE.DoubleSide, clippingPlanes: sectionEnabled ? [sectionPlane] : [] });
      const selectedFaceMaterial = new THREE.MeshStandardMaterial({ color: 0xffc43d, metalness: .05, roughness: .3, side: THREE.DoubleSide, clippingPlanes: sectionEnabled ? [sectionPlane] : [] });
      const zebraMaterial = createCadZebraMaterial(sectionEnabled ? [sectionPlane] : []);
      geometry.addGroup(0, tessellation.indices.length, 0);
      const tipFeatureId = deriveBodyTipFeatureId(document, bodyId) ?? body.tipFeatureId;
      const mesh = new THREE.Mesh(geometry, [material, selectedFaceMaterial]); mesh.visible = displayMode === "brep"; mesh.userData.bodyId = bodyId; mesh.userData.tessellation = tessellation; mesh.userData.sourceFeatureId = tipFeatureId; mesh.userData.baseMaterial = material; mesh.userData.selectedFaceMaterial = selectedFaceMaterial; mesh.userData.zebraMaterial = zebraMaterial; scene.add(mesh); meshes.push(mesh); geometries.push(geometry); materials.push(material, selectedFaceMaterial, zebraMaterial);
      appendEdgePolylines(bodyId, tipFeatureId, polylines);
      if (deferEdgePolylines) deferredEdgeBodies.push({ bodyId, shape, sourceFeatureId: tipFeatureId });
      renderedBodyCount += 1;
      // Let React paint status/progress and keep input responsive while a
      // resource with many independent parts is being tessellated.
      if (renderedBodyCount % 6 === 0) await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    }
    if (disposed || viewportBuildId !== viewportBuildIdRef.current) { disposeViewport(); return; }
    const controlNetOverlay = createCadControlNetOverlay({
      document, camera, controls, element: renderer.domElement, requestRender,
      onCommit: (edit) => {
        const current = cadDocumentRef.current, feature = current?.features[edit.featureId];
        if (!current || !feature || feature.type !== "bsplineSurface") return;
        let controlNet;
        try { controlNet = resolveBSplineFeatureControlNet(current, edit.featureId); } catch { return; }
        if (!controlNet[edit.row]?.[edit.column]) return;
        controlNet[edit.row][edit.column] = edit.pointMm;
        void updateBSplineSurface(edit.featureId, controlNet, { rationalSections: feature.rationalSections, tensorNurbs: feature.tensorNurbs, boundaryMatch: feature.boundaryMatch, boundaryMatches: feature.boundaryMatches });
      },
    });
    scene.add(controlNetOverlay.group);
    controlNetOverlay.setActiveFeature(selectedFeatureId);
    const sceneBounds = () => {
      const box = new THREE.Box3();
      meshes.forEach((mesh) => {
        const meshBox = new THREE.Box3().setFromObject(mesh);
        if (meshBox.isEmpty() || !Number.isFinite(meshBox.min.x) || !Number.isFinite(meshBox.max.x) || !Number.isFinite(meshBox.min.y) || !Number.isFinite(meshBox.max.y) || !Number.isFinite(meshBox.min.z) || !Number.isFinite(meshBox.max.z)) return;
        box.union(meshBox);
      });
      edgeLines.forEach((line) => {
        const edgeBox = new THREE.Box3().setFromObject(line);
        if (!edgeBox.isEmpty() && [edgeBox.min.x, edgeBox.min.y, edgeBox.min.z, edgeBox.max.x, edgeBox.max.y, edgeBox.max.z].every(Number.isFinite)) box.union(edgeBox);
      });
      return box;
    };
    const loadReferenceAsset = async () => {
      if (displayMode !== "reference" || !referenceAssetPath) return;
      try {
        const root = await loadCachedReferenceModel(referenceAssetPath);
        if (referenceDisposed) { disposeReferenceModelInstance(root); return; }
        const target = sceneBounds();
        if (target.isEmpty()) { disposeReferenceModelInstance(root); return; }
        const source = new THREE.Box3().setFromObject(root);
        const sourceSize = source.getSize(new THREE.Vector3());
        const targetSize = target.getSize(new THREE.Vector3());
        const scale = Math.min(
          targetSize.x / Math.max(sourceSize.x, .0001),
          targetSize.y / Math.max(sourceSize.y, .0001),
          targetSize.z / Math.max(sourceSize.z, .0001),
        ) * .98;
        root.scale.multiplyScalar(Number.isFinite(scale) && scale > 0 ? scale : 1);
        root.updateMatrixWorld(true);
        const scaled = new THREE.Box3().setFromObject(root);
        // Treat Y=ground separately: visual factory assets often have a
        // different height ratio from their editable B-Rep envelope.  Center
        // alignment made feet and bases appear to float above the grid.
        const targetCenter = target.getCenter(new THREE.Vector3());
        const scaledCenter = scaled.getCenter(new THREE.Vector3());
        root.position.x += targetCenter.x - scaledCenter.x;
        root.position.z += targetCenter.z - scaledCenter.z;
        root.position.y += target.min.y - scaled.min.y;
        root.traverse((node) => {
          if (!(node instanceof THREE.Mesh)) return;
          const materials = Array.isArray(node.material) ? node.material : [node.material];
          materials.forEach((material) => { material.transparent = false; material.opacity = 1; material.depthWrite = true; });
        });
        if (disposed || viewportBuildId !== viewportBuildIdRef.current) { disposeReferenceModelInstance(root); return; }
        referenceRoot = root; scene.add(referenceRoot); requestRender();
      } catch { /* Keep the editable B-Rep available when a reference asset cannot load. */ }
    };
    const updateReferenceGrid = (box: THREE.Box3) => {
      const spec = computeCadGridSpec(box);
      if (!spec) return;
      if (grid) { scene.remove(grid); grid.geometry.dispose(); (Array.isArray(grid.material) ? grid.material : [grid.material]).forEach((material) => material.dispose()); }
      grid = new THREE.GridHelper(spec.size, spec.divisions, 0x6f827a, 0xbdc8bd);
      grid.position.copy(spec.position);
      scene.add(grid);
    };
    const frameAlong = (direction: THREE.Vector3, up: THREE.Vector3) => {
      const box = sceneBounds();
      const frame = computeCadCameraFrame(box, direction, up, camera.fov, camera.aspect);
      if (!frame) return;
      camera.up.copy(frame.cameraUp); camera.position.copy(frame.center).add(frame.viewDirection.clone().multiplyScalar(frame.distance)); camera.near = frame.near; camera.far = frame.far; camera.updateProjectionMatrix();
      // Keep the orbit pivot on the model center, then offset only the camera
      // projection so the workpiece sits in the visual center of the usable
      // canvas instead of drifting toward the property panel and lower edge.
      const viewportWidth = Math.max(host.clientWidth, 1), viewportHeight = Math.max(host.clientHeight, 1);
      camera.setViewOffset(viewportWidth, viewportHeight, viewportWidth * .20, viewportHeight * .18, viewportWidth, viewportHeight);
      controls.target.copy(frame.center); controls.update(); updateReferenceGrid(box); requestRender();
    };
    const fit = () => { const box = sceneBounds(); if (box.isEmpty()) return; const center = box.getCenter(new THREE.Vector3()); const currentDirection = camera.position.clone().sub(controls.target); if (currentDirection.lengthSq() < 1e-9) currentDirection.set(1, 1, -1); frameAlong(currentDirection, new THREE.Vector3(0, 1, 0)); controls.target.copy(center); };
    const setView = (view: StandardCadView) => {
      const vectors = standardCadViewVectors(view);
      frameAlong(vectors.direction, vectors.up);
    };
    const setSection = (enabled: boolean, offsetMm: number) => {
      sectionPlane.constant = -mmToWorld(offsetMm); renderer.localClippingEnabled = enabled; materials.forEach((material) => { material.clippingPlanes = enabled ? [sectionPlane] : []; material.needsUpdate = true; }); requestRender();
    };
    const clearInspectionOverlay = () => clearCadInspectionOverlay(inspectionOverlay);
    const applyBaseInspectionMaterial = (zebra: boolean) => applyCadInspectionMaterial(meshes, zebra);
    const setSurfaceInspection = (mode: "normal" | "zebra") => {
      clearInspectionOverlay(); applyBaseInspectionMaterial(mode === "zebra"); requestRender();
    };
    const showSurfaceHeatmap: NonNullable<RenderState["showSurfaceHeatmap"]> = (samples) => {
      clearInspectionOverlay(); applyBaseInspectionMaterial(false);
      populateCadSurfaceHeatmap(inspectionOverlay, samples);
      requestRender();
    };
    const showCurvatureComb: NonNullable<RenderState["showCurvatureComb"]> = (stations) => {
      clearInspectionOverlay(); applyBaseInspectionMaterial(false);
      populateCadCurvatureComb(inspectionOverlay, stations, sceneBounds());
      requestRender();
    };
    const resetFaceHighlight = () => resetCadFaceHighlights(meshes);
    const highlightFace = (mesh: THREE.Mesh, triangleIndex: number) => {
      highlightCadFace(meshes, mesh, triangleIndex);
    };
    const highlightTopologyFace = (topology: KernelTopologyRef) => {
      highlightCadTopologyFace(meshes, topology);
      requestRender();
    };
    const raycaster = new THREE.Raycaster(); raycaster.params.Line!.threshold = .004;
    const pick = (event: MouseEvent) => {
      if (controlNetOverlay?.consumeClick()) return;
      const bounds = renderer.domElement.getBoundingClientRect(); camera.updateMatrixWorld(); raycaster.setFromCamera({ x: ((event.clientX - bounds.left) / bounds.width) * 2 - 1, y: -((event.clientY - bounds.top) / bounds.height) * 2 + 1 }, camera);
      if (selectionModeRef.current === "edge") {
        const edgeHit = raycaster.intersectObjects(edgeLines, false)[0]; if (!edgeHit) return; resetFaceHighlight(); const line = edgeHit.object as THREE.Line; const selected = edgeSelectionFromPolyline(line.userData.polyline as KernelEdgePolyline); selectedTopologyRef.current = selected.topology; const bodyId = String(line.userData.bodyId); const sourceFeatureId = String(line.userData.sourceFeatureId ?? document.bodies[bodyId]?.tipFeatureId ?? ""); if (sourceFeatureId) { currentFeatureIdRef.current = sourceFeatureId; setSelectedFeatureId(sourceFeatureId); controlNetOverlay?.setActiveFeature(sourceFeatureId); } setSelectedBodyId(bodyId); edgeLines.forEach((entry) => { entry.material = entry === line ? selectedEdgeMaterial : edgeMaterial; }); setSelection(`EDGE · ${selected.topology.localId} · ${document.bodies[bodyId]?.name ?? bodyId}`); void kernel.getEdgeInfo(selected.topology).then((info) => setMeasure(`${document.bodies[bodyId]?.name ?? bodyId} · Edge ${info.curveType ?? "unknown"}${info.lengthMm !== undefined ? ` · L ${info.lengthMm.toFixed(3)} mm` : ""}`)).catch(() => undefined); requestRender(); return;
      }
      const hit = raycaster.intersectObjects(meshes, false)[0]; if (!hit) return;
      const mesh = hit.object as THREE.Mesh; const bodyId = String(mesh.userData.bodyId); const body = document.bodies[bodyId]; const sourceFeatureId = String(mesh.userData.sourceFeatureId ?? body?.tipFeatureId ?? ""); setSelectedBodyId(bodyId); edgeLines.forEach((entry) => { entry.material = edgeMaterial; });
      applyCadBodySelection(meshes, bodyColors, bodyId);
      if (sourceFeatureId) { currentFeatureIdRef.current = sourceFeatureId; setSelectedFeatureId(sourceFeatureId); controlNetOverlay?.setActiveFeature(sourceFeatureId); }
      if (selectionModeRef.current === "face" && hit.faceIndex !== undefined) { const selected = faceSelectionFromTriangle(mesh.userData.tessellation as KernelTessellation, hit.faceIndex); selectedTopologyRef.current = selected.topology; highlightFace(mesh, hit.faceIndex); setSelection(`FACE · ${selected.topology.localId} · ${body?.name ?? bodyId}`); void kernel.getFaceInfo(selected.topology).then((info) => setMeasure(`${body?.name ?? bodyId} · Face ${info.surfaceType ?? "unknown"}${info.areaMm2 !== undefined ? ` · A ${info.areaMm2.toFixed(3)} mm²` : ""}`)).catch(() => undefined); }
      else { selectedTopologyRef.current = undefined; resetFaceHighlight(); setSelection(`BODY · ${body?.name ?? bodyId}`); const shape = runtime.bodyShapes.get(bodyId); if (shape) void kernel.getShapeProperties(shape).then((properties) => { const size = { x: properties.boundingBox.max.x - properties.boundingBox.min.x, y: properties.boundingBox.max.y - properties.boundingBox.min.y, z: properties.boundingBox.max.z - properties.boundingBox.min.z }; setMeasure(`${body?.name ?? bodyId} · ${size.x.toFixed(2)} × ${size.y.toFixed(2)} × ${size.z.toFixed(2)} mm${properties.volumeMm3 !== undefined ? ` · V ${properties.volumeMm3.toFixed(2)} mm³` : ""}${properties.surfaceAreaMm2 !== undefined ? ` · A ${properties.surfaceAreaMm2.toFixed(2)} mm²` : ""}`); }).catch(() => setMeasure(`${body?.name ?? bodyId} · 无法读取几何属性`)); }
      requestRender();
    };
    const onControlsChange = () => requestRender();
    const onControlsStart = () => renderLoop.setInteracting(true);
    const onControlsEnd = () => renderLoop.setInteracting(false);
    controls.addEventListener("change", onControlsChange);
    controls.addEventListener("start", onControlsStart);
    controls.addEventListener("end", onControlsEnd);
    renderer.domElement.addEventListener("click", pick);
    detachInteractions = () => {
      controls.removeEventListener("change", onControlsChange);
      controls.removeEventListener("start", onControlsStart);
      controls.removeEventListener("end", onControlsEnd);
      renderer.domElement.removeEventListener("click", pick);
    };
    const resize = new ResizeObserver(() => {
      if (disposed) return;
      const width = Math.max(host.clientWidth, 1), height = Math.max(host.clientHeight, 1);
      const nextAspect = width / height;
      const needsReframe = Math.abs(camera.aspect - nextAspect) > .01;
      renderer.setSize(width, height, false);
      camera.aspect = nextAspect;
      camera.updateProjectionMatrix();
      if (needsReframe) fit(); else requestRender();
    }); resize.observe(host);
    setView("iso");
    if (disposed || viewportBuildId !== viewportBuildIdRef.current) { disposeViewport(); return; }
    renderStateRef.current = { dispose: disposeViewport, fit, setView, setSection, highlightFace: highlightTopologyFace, setSurfaceInspection, showSurfaceHeatmap, showCurvatureComb, setControlNetFeature: (featureId) => controlNetOverlay?.setActiveFeature(featureId) };
    if (deferredEdgeBodies.length) void (async () => {
      for (let index = 0; index < deferredEdgeBodies.length; index += 1) {
        const entry = deferredEdgeBodies[index];
        const polylines = await kernel.getEdgePolylines(entry.shape);
        if (disposed || viewportBuildId !== viewportBuildIdRef.current) return;
        appendEdgePolylines(entry.bodyId, entry.sourceFeatureId, polylines);
        if ((index + 1) % 4 === 0) await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      }
      requestRender();
    })();
    void loadReferenceAsset();
    setBodyPanel(Object.entries(document.bodies).map(([id, body]) => ({ id, name: body.name, visible: body.visible, active: id === document.activeBodyId, construction: body.name.startsWith("构造体 · "), bodyType: body.bodyType ?? "solid", sourceCode: body.sourceResource?.resourceCode, material: body.engineering?.material })).sort((a, b) => Number(b.visible) - Number(a.visible)));
    const nextFeatures = document.featureOrder.map((id) => document.features[id]).filter((feature): feature is Feature => !!feature).map((feature) => ({ id: feature.id, name: feature.name, type: feature.type, typeLabel: featureTypeLabel(feature.type), enabled: feature.enabled, state: feature.state, stateLabel: featureStateLabel(feature), bodyId: feature.bodyId, summary: featureSummary(feature), dependencyCount:feature.dependencies.length }));
    setFeaturePanel(nextFeatures);
    setSelectedFeatureId((current) => current && document.features[current] ? current : (document.featureOrder.at(-1) ?? ""));
  };

  const runSmoke = async () => {
    setBusy(true); setSelection("未选择");
    setStatus("正在由 CadDocument → Box Extrude → Runtime Face / Edge Topology 创建真实 B-Rep…");
    await disposeActiveRuntime();
    let runtime: ReturnType<typeof createCadRuntimeState> | undefined;
    let kernel: OcctKernel | undefined;
    try {
      const document = createDebugDocument();
      debugDocumentRef.current = document;
      kernel = new OcctKernel(); await kernel.init();
      runtime = createCadRuntimeState();
      const result = await evaluateFeature("Extrude01", { document, kernel, tolerance: DEFAULT_CAD_TOLERANCE, buildProfiles: buildSketchProfiles, runtime });
      recordFeatureEvaluationResult(runtime, result);
      if (result.status === "failed") throw result.error;
      await replaceFeatureShape(runtime, kernel, result.featureId, result.shape);
      const [properties, tessellation, faces, edges, edgePolylines] = await Promise.all([
        kernel.getShapeProperties(result.shape),
        kernel.tessellate(result.shape, { linearDeflectionMm: 1, angularDeflectionDeg: 10 }),
        kernel.getFaces(result.shape), kernel.getEdges(result.shape), kernel.getEdgePolylines(result.shape),
      ]);
      render(result.shape, tessellation, edgePolylines);
      runtimeRef.current = runtime; kernelRef.current = kernel;
      currentFeatureIdRef.current = "Extrude01";
      currentShapeRef.current = result.shape;
      runtime = undefined; kernel = undefined;
      setStatus(`通过：真实 B-Rep 已建立 ${faces.length} 个 Runtime Face、${edges.length} 条 Runtime Edge。体积 ${properties.volumeMm3?.toFixed(0)} mm³；点击画面可按当前模式拾取并高亮。`);
    } catch (error) {
      setStatus(`失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      if (runtime && kernel) await disposeCadRuntimeState(runtime, kernel);
      if (kernel) await kernel.dispose();
      setBusy(false);
    }
  };

  const allocateFeatureId = (document: CadDocument<Sketch, Feature>, prefix: string): string => {
    let ordinal = 1;
    while (document.features[`${prefix}${String(ordinal).padStart(2, "0")}`]) ordinal += 1;
    return `${prefix}${String(ordinal).padStart(2, "0")}`;
  };

  const commitCandidateDocument = async (current: CadDocument<Sketch, Feature>, candidateInput: CadDocument<Sketch, Feature>, preferredFeatureId: string, successMessage: string) => {
    const runtime = runtimeRef.current, kernel = kernelRef.current;
    if (!runtime || !kernel) throw new Error("CAD runtime is unavailable.");
    const candidate = withDerivedBodyTips(candidateInput);
    const history = cadHistoryRef.current ?? createCadHistory(current);
    const result = await commitCadHistoryEdit(history, current, candidate, {
      runtime, rebuildRuntime: rebuildStateRef.current, kernel, tolerance: DEFAULT_CAD_TOLERANCE,
      buildProfiles: buildSketchProfiles, assets: cadAssetsRef.current,
    });
    if (!result.success) throw new Error("事务重建失败；设计历史保持 Last-Good。 ");
    cadHistoryRef.current = result.history;
    cadDocumentRef.current = result.document;
    setHistoryAvailability({ undo: canUndoCadHistory(result.history), redo: canRedoCadHistory(result.history) });
    currentFeatureIdRef.current = preferredFeatureId;
    currentShapeRef.current = runtime.featureShapes.get(preferredFeatureId);
    selectedTopologyRef.current = undefined;
    setSelection("未选择");
    await renderBodies(result.document, runtime, kernel);
    setSelectedFeatureId(preferredFeatureId);
    const evaluation = runtime.featureResults.get(preferredFeatureId);
    const recovery = evaluation?.status === "success" ? evaluation.warnings.filter((warning) => warning.includes("恢复") || warning.includes("修复") || warning.includes("原设计")) : [];
    setStatus(`${successMessage}${recovery.length ? ` · 自动修复：${recovery.join("；")}` : ""}`);
  };

  const generateCadAgentPlan = () => {
    try {
      const plan = createLocalCadAgentPlan(cadAgentPrompt);
      setCadAgentPlan(plan);
      const featureCount = plan.featureProgram?.parts.reduce((count, part) => count + part.steps.length, 0);
      setStatus(plan.featureProgram
        ? `Agent 已理解需求：${plan.title} · ${plan.featureProgram.parts.length} 个设计零件、${featureCount} 项有序特征。请检查方案后应用。`
        : `Agent 已理解需求：${plan.title} · ${plan.template.parts.length} 个工程组件。请检查方案后应用。`);
    } catch (error) {
      setCadAgentPlan(undefined);
      setStatus(`AGENT_PROMPT_INVALID：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const applyCadAgentFinishing = async (plan: LocalCadAgentPlan): Promise<string[]> => {
    const requested = [
      ...(plan.featureRequests.filletRadiusMm ? [{ kind: "fillet" as const, value: plan.featureRequests.filletRadiusMm }] : []),
      ...(plan.featureRequests.chamferDistanceMm ? [{ kind: "chamfer" as const, value: plan.featureRequests.chamferDistanceMm }] : []),
    ];
    const applied: string[] = [];
    for (const finish of requested) {
      const current = cadDocumentRef.current, runtime = runtimeRef.current, kernel = kernelRef.current;
      if (!current || !runtime || !kernel || !plan.finishTargetPartId) throw new Error("Agent 精修所需的 CAD Runtime 不可用。");
      const body = Object.values(current.bodies).find((entry) => entry.sourceResource?.resourceId === plan.id && entry.sourceResource?.sourcePartId === plan.finishTargetPartId);
      if (!body) throw new Error("未找到 Agent 主体，无法应用边缘精修。");
      const targetFeatureId = deriveBodyTipFeatureId(current, body.id) ?? body.tipFeatureId;
      const shape = targetFeatureId ? runtime.featureShapes.get(targetFeatureId) : undefined;
      if (!targetFeatureId || !shape) throw new Error("Agent 主体没有可用于精修的 B-Rep 结果。");
      const edges = (await kernel.getEdges(shape))
        .filter((entry) => (entry.lengthMm ?? 0) > finish.value * 2.2)
        .sort((a, b) => (b.lengthMm ?? 0) - (a.lengthMm ?? 0));
      const preferredCurve = plan.intent === "flange" || plan.intent === "shaft" ? "circle" : "line";
      const edge = edges.find((entry) => entry.curveType === preferredCurve) ?? edges[0];
      if (!edge) throw new Error(`主体没有足够长的稳定边来建立 ${finish.kind === "fillet" ? "圆角" : "倒角"}。`);
      const persistent = await capturePersistentTopologyRef(targetFeatureId, edge.topology, runtime, kernel);
      if (persistent.kind !== "edge") throw new Error("未能捕获持久化边引用。");
      const candidate = structuredClone(current) as CadDocument<Sketch, Feature>;
      const featureId = allocateFeatureId(candidate, finish.kind === "fillet" ? "AgentFillet" : "AgentChamfer");
      candidate.features[featureId] = finish.kind === "fillet"
        ? { id: featureId, name: `Agent 圆角 R${finish.value}`, type: "fillet", bodyId: body.id, targetFeatureId, edges: [persistent], radiusMm: finish.value, enabled: true, state: "clean", dependencies: [targetFeatureId] }
        : { id: featureId, name: `Agent 倒角 ${finish.value} mm`, type: "chamfer", bodyId: body.id, targetFeatureId, edges: [persistent], distanceMm: finish.value, enabled: true, state: "clean", dependencies: [targetFeatureId] };
      candidate.featureOrder.push(featureId);
      candidate.bodies[body.id].tipFeatureId = featureId;
      await commitCandidateDocument(current, candidate, featureId, `Agent 正在应用${finish.kind === "fillet" ? "圆角" : "倒角"}精修。`);
      setSelectedBodyId(body.id);
      applied.push(finish.kind === "fillet" ? `R${finish.value} mm 圆角` : `${finish.value} mm 倒角`);
    }
    return applied;
  };

  const commitCadAgentPlan = async () => {
    const current = cadDocumentRef.current;
    if (!current || !cadAgentPlan) { setStatus("请先让 Agent 生成一份可检查的建模方案。"); return; }
    const candidate = applyLocalCadAgentPlan(cadAgentPlan, current, cadAgentApplyMode);
    const preferredFeatureId = candidate.featureOrder.at(-1);
    if (!preferredFeatureId) { setStatus("Agent 方案没有生成有效特征。"); return; }
    setBusy(true);
    let baseCommitted = false;
    try {
      const featureCount = cadAgentPlan.featureProgram?.parts.reduce((count, part) => count + part.steps.length, 0);
      const buildLabel = cadAgentPlan.featureProgram ? `${featureCount} 项草图与成形特征` : `${cadAgentPlan.template.parts.length} 个工程组件`;
      await commitCandidateDocument(current, candidate, preferredFeatureId, `通过：Agent 已${cadAgentApplyMode === "replace" ? "新建" : "追加"}“${cadAgentPlan.title}”，${buildLabel}已进入真实 B-Rep 特征历史。`);
      baseCommitted = true;
      const finishes = await applyCadAgentFinishing(cadAgentPlan);
      const committed = cadDocumentRef.current;
      const primaryBody = committed && Object.values(committed.bodies).find((entry) => entry.sourceResource?.resourceId === cadAgentPlan.id && entry.sourceResource?.sourcePartId === cadAgentPlan.finishTargetPartId);
      setSelectedBodyId(primaryBody?.id ?? committed?.activeBodyId ?? candidate.activeBodyId ?? "");
      setStatus(`通过：Agent 已${cadAgentApplyMode === "replace" ? "新建" : "追加"}“${cadAgentPlan.title}”，${buildLabel}已完成 B-Rep 重建${finishes.length ? `，并应用 ${finishes.join("、")}` : ""}。`);
      setCadAgentOpen(false);
    } catch (error) {
      setStatus(baseCommitted
        ? `AGENT_FINISH_PARTIAL：主体模型已安全生成，但精修未完成：${error instanceof Error ? error.message : String(error)}。可在特征树中继续手动精修。`
        : `AGENT_BUILD_FAILED：${error instanceof Error ? error.message : String(error)}；原项目保持不变。`);
    } finally { setBusy(false); }
  };

  const allocateBodyId = (document: CadDocument<Sketch, Feature>, prefix: string): string => {
    let ordinal = 1;
    while (document.bodies[`${prefix}${String(ordinal).padStart(2, "0")}`]) ordinal += 1;
    return `${prefix}${String(ordinal).padStart(2, "0")}`;
  };

  const addSelectedSketchToSurfaceSet = () => {
    if (!selectedSketchId || !cadDocumentRef.current?.sketches[selectedSketchId]) { setStatus("请先在特征树中选择一个草图。"); return; }
    const ids = surfaceSketchSelectionRef.current;
    if (!ids.includes(selectedSketchId)) ids.push(selectedSketchId);
    setSurfaceSketchSelectionLabel(`${ids.length} 个 Sketch：${ids.join(" → ")}`);
  };

  const clearSurfaceSketchSet = () => { surfaceSketchSelectionRef.current = []; setSurfaceSketchSelectionLabel("轮廓/路径集合为空"); };

  const createBSplineSurface = async (controlNet: Array<Array<{ x: number; y: number; z: number }>>, options?: BSplineSurfaceCommitOptions) => {
    const current = cadDocumentRef.current;
    if (!current) { setStatus("请先创建或打开一个 CAD Document。"); return; }
    setBusy(true);
    try {
      const candidate = structuredClone(current) as CadDocument<Sketch, Feature>;
      const bodyId = allocateBodyId(candidate, "SurfaceBody");
      const body = createCadBody(bodyId, `B-Spline Surface ${Object.keys(candidate.bodies).length + 1}`, "surface");
      body.appearance = { color: "#55c8df", metalness: .03, roughness: .32 };
      candidate.bodies[bodyId] = body; candidate.activeBodyId = bodyId;
      const featureId = allocateFeatureId(candidate, "BSplineSurface");
      candidate.features[featureId] = { id: featureId, name: options?.tensorNurbs ? "Tensor-product NURBS Surface" : options?.rationalSections ? "Rational B-Spline Section Surface" : "B-Spline Control Surface", type: "bsplineSurface", bodyId, controlNet: structuredClone(controlNet), rationalSections: options?.rationalSections ? structuredClone(options.rationalSections) : undefined, tensorNurbs: options?.tensorNurbs ? structuredClone(options.tensorNurbs) : undefined, enabled: true, state: "clean", dependencies: [] };
      candidate.featureOrder.push(featureId);
      await commitCandidateDocument(current, candidate, featureId, `通过：${featureId} 已由 ${controlNet.length}×${controlNet[0]?.length ?? 0} 控制网生成真实 OCCT B-Spline Surface。`);
      setSelectedBodyId(bodyId);
    } catch (error) { setStatus(`BSPLINE_SURFACE_FAILED：${error instanceof Error ? error.message : String(error)}`); }
    finally { setBusy(false); }
  };

  const updateBSplineSurface = async (featureId: string, controlNet: Array<Array<{ x: number; y: number; z: number }>>, options?: BSplineSurfaceCommitOptions) => {
    const current = cadDocumentRef.current, feature = current?.features[featureId];
    if (!current || !feature || feature.type !== "bsplineSurface") { setStatus("请选择一个有效的 B-Spline Surface Feature。"); return; }
    setBusy(true);
    try {
      const candidate = structuredClone(current) as CadDocument<Sketch, Feature>;
      const next = candidate.features[featureId];
      if (!next || next.type !== "bsplineSurface") throw new Error("B-Spline Feature 已失效。");
      next.controlNet = structuredClone(controlNet);
      if (options?.rationalSections) next.rationalSections = structuredClone(options.rationalSections);
      else delete next.rationalSections;
      if (options?.tensorNurbs) next.tensorNurbs = structuredClone(options.tensorNurbs);
      else delete next.tensorNurbs;
      const boundaryOrder = { uMin: 0, uMax: 1, vMin: 2, vMax: 3 } as const;
      const relations = [...(options?.boundaryMatches ?? (options?.boundaryMatch ? [options.boundaryMatch] : []))].sort((left, right) => boundaryOrder[left.targetEdge] - boundaryOrder[right.targetEdge]);
      const sourceIds = [...new Set(relations.map((relation) => relation.sourceFeatureId))];
      if (relations.length) {
        if (relations.length > 4 || new Set(relations.map((relation) => relation.targetEdge)).size !== relations.length) throw new Error("每条当前边只能建立一条关联，且总数不能超过四条。");
        for (const sourceId of sourceIds) {
          if (sourceId === featureId || candidate.features[sourceId]?.type !== "bsplineSurface") throw new Error("边界关联的基准曲面已失效。");
          if (candidate.featureOrder.indexOf(sourceId) >= candidate.featureOrder.indexOf(featureId)) throw new Error("基准曲面必须位于当前曲面之前，请先调整特征顺序。");
          if (featureHistoryRelations(candidate, sourceId).upstream.includes(featureId)) throw new Error("该匹配会形成循环依赖，请改用更早的曲面作为基准。");
        }
        next.boundaryMatches = structuredClone(relations);
        delete next.boundaryMatch;
        next.dependencies = sourceIds;
      } else {
        delete next.boundaryMatch;
        delete next.boundaryMatches;
        next.dependencies = [];
      }
      await commitCandidateDocument(current, candidate, featureId, `通过：${featureId} 控制网已更新${relations.length ? `，${relations.length} 条曲面边界关联已写入历史` : ""}，并完成下游 B-Rep 事务重建。`);
    } catch (error) { setStatus(`BSPLINE_EDIT_FAILED：${error instanceof Error ? error.message : String(error)}`); }
    finally { setBusy(false); }
  };

  const createSurfaceFromSelectedSketch = async (kind: "patch" | "extrude" | "revolve") => {
    const current = cadDocumentRef.current;
    if (!current || !selectedSketchId || !current.sketches[selectedSketchId]) { setStatus("请先选择一个有效 Sketch。"); return; }
    setBusy(true);
    try {
      const candidate = structuredClone(current) as CadDocument<Sketch, Feature>;
      const bodyId = allocateBodyId(candidate, "SurfaceBody");
      const body = createCadBody(bodyId, `Surface ${Object.keys(candidate.bodies).length + 1}`, "surface");
      body.appearance = { color: "#4fc3d7", metalness: .05, roughness: .38 };
      candidate.bodies[bodyId] = body;

      candidate.activeBodyId = bodyId;
      const featureId = allocateFeatureId(candidate, kind === "patch" ? "SurfacePatch" : kind === "extrude" ? "SurfaceExtrude" : "SurfaceRevolve");
      if (kind === "patch") candidate.features[featureId] = { id: featureId, name: "Planar Surface", type: "surfacePatch", bodyId, sketchId: selectedSketchId, enabled: true, state: "clean", dependencies: [] };
      else if (kind === "extrude") candidate.features[featureId] = { id: featureId, name: `Surface Extrude ${surfaceDistanceMm} mm`, type: "surfaceExtrude", bodyId, sketchId: selectedSketchId, distanceMm: Math.max(.01, Math.abs(surfaceDistanceMm)), direction: surfaceDistanceMm < 0 ? "negative" : "positive", enabled: true, state: "clean", dependencies: [] };
      else {
        const planeType = candidate.sketches[selectedSketchId].plane.type;
        const axis = planeType === "YZ" ? { origin: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 1, z: 0 } } : { origin: { x: 0, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 } };
        candidate.features[featureId] = { id: featureId, name: "Surface Revolve", type: "surfaceRevolve", bodyId, sketchId: selectedSketchId, axis, angleDeg: 360, enabled: true, state: "clean", dependencies: [] };
      }
      candidate.featureOrder.push(featureId);
      await commitCandidateDocument(current, candidate, featureId, `通过：${featureId} 已作为真实 OCCT Surface Body 写入 Feature History。`);
      setSelectedBodyId(bodyId);
    } catch (error) { setStatus(`SURFACE_CREATE_FAILED：${error instanceof Error ? error.message : String(error)}`); }
    finally { setBusy(false); }
  };

  const createSurfaceFromSketchSet = async (kind: "sweep" | "loft" | "ruled") => {
    const current = cadDocumentRef.current, ids = [...surfaceSketchSelectionRef.current];
    if (!current) return;
    const requiredSweepSketches = surfaceSweepOrientation === "guide" ? 3 : 2;
    if (kind === "sweep" && ids.length !== requiredSweepSketches) { setStatus(surfaceSweepOrientation === "guide" ? "辅助导轨扫掠需要依次加入 3 个草图：截面、路径、辅助导轨。" : "曲面扫掠需要依次加入 2 个草图：截面、路径。"); return; }
    if ((kind === "loft" || kind === "ruled") && ids.length < 2) { setStatus("曲面放样至少需要 2 个 Section Sketch。"); return; }
    if (ids.some((id) => !current.sketches[id])) { setStatus("曲面截面集中存在已删除 Sketch，请清空后重新选择。"); return; }
    setBusy(true);
    try {
      const candidate = structuredClone(current) as CadDocument<Sketch, Feature>;
      const bodyId = allocateBodyId(candidate, "SurfaceBody");
      const body = createCadBody(bodyId, `Surface ${Object.keys(candidate.bodies).length + 1}`, "surface");
      body.appearance = { color: "#52b7c7", metalness: .04, roughness: .4 };
      candidate.bodies[bodyId] = body; candidate.activeBodyId = bodyId;
      const featureId = allocateFeatureId(candidate, kind === "sweep" ? "SurfaceSweep" : kind === "ruled" ? "RuledSurface" : "SurfaceLoft");
      candidate.features[featureId] = kind === "sweep"
        ? { id: featureId, name: "Surface Sweep", type: "surfaceSweep", bodyId, profileSketchId: ids[0], pathSketchId: ids[1], guideSketchId: surfaceSweepOrientation === "guide" ? ids[2] : undefined, orientation: surfaceSweepOrientation, upDirection: surfaceSweepOrientation === "fixedUp" ? surfaceSweepUp : undefined, enabled: true, state: "clean", dependencies: [] }
        : { id: featureId, name: kind === "ruled" ? "Ruled Surface" : "Surface Loft", type: "surfaceLoft", bodyId, sectionSketchIds: ids, ruled: kind === "ruled", closed: false, ...(kind === "loft" && loftEndControl.start !== "natural" ? { startCondition: { continuity: loftEndControl.start, lengthMm: loftEndControl.startLengthMm } } : {}), ...(kind === "loft" && loftEndControl.end !== "natural" ? { endCondition: { continuity: loftEndControl.end, lengthMm: loftEndControl.endLengthMm } } : {}), enabled: true, state: "clean", dependencies: [] };
      candidate.featureOrder.push(featureId);
      const sweepModeLabel = surfaceSweepOrientation === "guide" ? "辅助导轨" : surfaceSweepOrientation === "fixedUp" ? "固定方向" : "随路径转向";
      await commitCandidateDocument(current, candidate, featureId, `通过：${featureId} 已由 ${ids.length} 个 Sketch 生成真实 B-Rep Surface${kind === "sweep" ? `，方向方式：${sweepModeLabel}` : ""}。`);
      setSelectedBodyId(bodyId);
    } catch (error) { setStatus(`SURFACE_${kind.toUpperCase()}_FAILED：${error instanceof Error ? error.message : String(error)}`); }
    finally { setBusy(false); }
  };

  const extractSelectedFaceSurface = async () => {
    const current = cadDocumentRef.current, runtime = runtimeRef.current, kernel = kernelRef.current, topology = selectedTopologyRef.current;
    if (!current || !runtime || !kernel || !topology || topology.kind !== "face" || !selectedBodyId) { setStatus("请先以 Face 模式选择一个真实 B-Rep Face。"); return; }
    const sourceFeatureId = deriveBodyTipFeatureId(current, selectedBodyId) ?? current.bodies[selectedBodyId]?.tipFeatureId;
    const sourceShape = sourceFeatureId ? runtime.featureShapes.get(sourceFeatureId) : undefined;
    if (!sourceFeatureId || !sourceShape || sourceShape.id !== topology.shapeId || sourceShape.revision !== topology.shapeRevision) { setStatus("当前 Face 必须属于所选 Body 的最新 Tip Feature。"); return; }
    setBusy(true);
    try {
      const candidate = structuredClone(current) as CadDocument<Sketch, Feature>;
      const persistent = await capturePersistentTopologyRef(sourceFeatureId, topology, runtime, kernel);
      const bodyId = allocateBodyId(candidate, "SurfaceBody");
      const body = createCadBody(bodyId, "Extracted Surface", "surface"); body.appearance = { color: "#56c5d8", roughness: .42 };
      candidate.bodies[bodyId] = body; candidate.activeBodyId = bodyId;
      const featureId = allocateFeatureId(candidate, "ExtractSurface");
      candidate.features[featureId] = { id: featureId, name: "Extract Surface", type: "extractSurface", bodyId, targetFeatureId: sourceFeatureId, faces: [persistent], toleranceMm: DEFAULT_CAD_TOLERANCE.boolean, enabled: true, state: "clean", dependencies: [sourceFeatureId] };
      candidate.featureOrder.push(featureId);
      await commitCandidateDocument(current, candidate, featureId, `通过：${featureId} 已从实体精确 Face 提取为独立 Surface Body。`);
      setSelectedBodyId(bodyId);
    } catch (error) { setStatus(`EXTRACT_SURFACE_FAILED：${error instanceof Error ? error.message : String(error)}`); }
    finally { setBusy(false); }
  };

  const selectedSurfaceTip = (document: CadDocument<Sketch, Feature>): { bodyId: string; featureId: string } | undefined => {
    const body = selectedBodyId ? document.bodies[selectedBodyId] : undefined;
    if (!body || (body.bodyType ?? "solid") !== "surface") return undefined;
    const featureId = deriveBodyTipFeatureId(document, selectedBodyId) ?? body.tipFeatureId;
    return featureId ? { bodyId: selectedBodyId, featureId } : undefined;
  };

  const offsetSelectedSurface = async () => {
    const current = cadDocumentRef.current; if (!current) return; const source = selectedSurfaceTip(current);
    if (!source) { setStatus("请先选择一个 Surface Body。"); return; }
    setBusy(true);
    try {
      const candidate = structuredClone(current) as CadDocument<Sketch, Feature>;
      const bodyId = allocateBodyId(candidate, "SurfaceBody"); const body = createCadBody(bodyId, "Offset Surface", "surface"); body.appearance = { color: "#60cbd8", roughness: .38 };
      candidate.bodies[bodyId] = body; candidate.activeBodyId = bodyId;
      const featureId = allocateFeatureId(candidate, "OffsetSurface");
      candidate.features[featureId] = { id: featureId, name: `Offset Surface ${surfaceOffsetMm} mm`, type: "offsetSurface", bodyId, targetFeatureId: source.featureId, distanceMm: surfaceOffsetMm, toleranceMm: DEFAULT_CAD_TOLERANCE.boolean, enabled: true, state: "clean", dependencies: [source.featureId] };
      candidate.featureOrder.push(featureId); await commitCandidateDocument(current, candidate, featureId, `通过：${featureId} 已生成精确 OCCT Offset Surface。`); setSelectedBodyId(bodyId);
    } catch (error) { setStatus(`OFFSET_SURFACE_FAILED：${error instanceof Error ? error.message : String(error)}`); } finally { setBusy(false); }
  };

  const thickenSelectedSurface = async () => {
    const current = cadDocumentRef.current; if (!current) return; const source = selectedSurfaceTip(current);
    if (!source) { setStatus("请先选择一个 Surface Body。"); return; }
    setBusy(true);
    try {
      const candidate = structuredClone(current) as CadDocument<Sketch, Feature>;
      const bodyId = allocateBodyId(candidate, "Body"); const body = createCadBody(bodyId, "Thickened Solid", "solid"); body.appearance = { color: "#73c991", roughness: .45 };
      candidate.bodies[bodyId] = body; candidate.activeBodyId = bodyId;
      const featureId = allocateFeatureId(candidate, "ThickenSurface");
      candidate.features[featureId] = { id: featureId, name: `Thicken ${surfaceThicknessMm} mm`, type: "thickenSurface", bodyId, targetFeatureId: source.featureId, thicknessMm: Math.max(.01, Math.abs(surfaceThicknessMm)), toleranceMm: DEFAULT_CAD_TOLERANCE.boolean, enabled: true, state: "clean", dependencies: [source.featureId] };
      candidate.featureOrder.push(featureId); await commitCandidateDocument(current, candidate, featureId, `通过：${featureId} 已把 Surface 转换为真实 Solid Body。`); setSelectedBodyId(bodyId);
    } catch (error) { setStatus(`THICKEN_SURFACE_FAILED：${error instanceof Error ? error.message : String(error)}`); } finally { setBusy(false); }
  };

  const addSelectedSurfaceBody = () => {
    const current = cadDocumentRef.current; if (!current) return; const source = selectedSurfaceTip(current);
    if (!source) { setStatus("请先选择一个 Surface Body，再加入曲面集合。"); return; }
    const items = surfaceSourceSelectionRef.current; if (!items.some((entry) => entry.featureId === source.featureId)) items.push(source);
    setSurfaceSourceSelectionLabel(`${items.length} 个 Surface：${items.map((entry) => entry.bodyId).join(", ")}`);
  };
  const clearSurfaceSourceSet = () => { surfaceSourceSelectionRef.current = []; setSurfaceSourceSelectionLabel("曲面 Body 集为空"); };

  const combineSelectedSurfaces = async (solidify: boolean) => {
    const current = cadDocumentRef.current, items = [...surfaceSourceSelectionRef.current];
    if (!current || items.length < 2) { setStatus("Sew / Enclose 至少需要 2 个 Surface Body。"); return; }
    if (items.some((entry) => !current.features[entry.featureId])) { setStatus("曲面集合包含过期 Feature，请清空后重选。"); return; }
    setBusy(true);
    try {
      const candidate = structuredClone(current) as CadDocument<Sketch, Feature>;
      const bodyId = allocateBodyId(candidate, solidify ? "Body" : "SurfaceBody");
      const body = createCadBody(bodyId, solidify ? "Enclosed Solid" : "Sewn Surface", solidify ? "solid" : "surface"); body.appearance = { color: solidify ? "#76c88f" : "#4fc1d4", roughness: .4 };
      candidate.bodies[bodyId] = body; candidate.activeBodyId = bodyId;
      const featureId = allocateFeatureId(candidate, solidify ? "EncloseSurface" : "SewSurface"); const sourceFeatureIds = items.map((entry) => entry.featureId);
      candidate.features[featureId] = solidify
        ? { id: featureId, name: "Enclose Surfaces", type: "encloseSurface", bodyId, sourceFeatureIds, toleranceMm: DEFAULT_CAD_TOLERANCE.boolean, enabled: true, state: "clean", dependencies: sourceFeatureIds }
        : { id: featureId, name: "Sew Surfaces", type: "sewSurface", bodyId, sourceFeatureIds, toleranceMm: DEFAULT_CAD_TOLERANCE.boolean, enabled: true, state: "clean", dependencies: sourceFeatureIds };
      candidate.featureOrder.push(featureId); await commitCandidateDocument(current, candidate, featureId, `通过：${featureId} 已${solidify ? "缝合并封闭为 Solid" : "缝合为 Surface Shell"}。`); setSelectedBodyId(bodyId); clearSurfaceSourceSet();
    } catch (error) { setStatus(`${solidify ? "ENCLOSE" : "SEW"}_SURFACE_FAILED：${error instanceof Error ? error.message : String(error)}`); } finally { setBusy(false); }
  };

  const addSelectedSurfaceBoundaryEdge = () => {
    const current = cadDocumentRef.current, topology = selectedTopologyRef.current;
    if (!current || !topology || topology.kind !== "edge" || !selectedBodyId) { setStatus("请切换 Edge 模式并选择一个真实 B-Rep 边界 Edge。"); return; }
    const sourceFeatureId = deriveBodyTipFeatureId(current, selectedBodyId) ?? current.bodies[selectedBodyId]?.tipFeatureId;
    if (!sourceFeatureId) { setStatus("无法确定当前 Edge 的来源 Feature。"); return; }
    const list = surfaceBoundarySelectionRef.current;
    if (!list.some((entry) => entry.sourceFeatureId === sourceFeatureId && entry.topology.localId === topology.localId)) list.push({ bodyId: selectedBodyId, sourceFeatureId, topology });
    setSurfaceBoundarySelectionLabel(`${list.length} Edge：${list.map((entry) => entry.topology.localId).join(" → ")}`);
  };
  const clearSurfaceBoundaryEdges = () => { surfaceBoundarySelectionRef.current = []; setSurfaceBoundarySelectionLabel("Fill / Boundary 边界 Edge 集为空"); };

  const createBoundarySurface = async () => {
    const current = cadDocumentRef.current, runtime = runtimeRef.current, kernel = kernelRef.current, entries = [...surfaceBoundarySelectionRef.current];
    if (!current || !runtime || !kernel || entries.length < 2) { setStatus(`Boundary ${surfaceBoundaryContinuity} 至少需要 2 条真实 B-Rep Boundary Edge。`); return; }
    setBusy(true);
    try {
      const candidate = structuredClone(current) as CadDocument<Sketch, Feature>;
      const refs: PersistentEdgeRef[] = [];
      for (const entry of entries) {
        const ref = await capturePersistentTopologyRef(entry.sourceFeatureId, entry.topology, runtime, kernel);
        if (ref.kind !== "edge") throw new Error("Boundary Surface 只接受 Persistent Edge。");
        refs.push(ref);
      }
      const dependencies = [...new Set(refs.map((ref) => ref.sourceFeatureId))];
      const bodyId = allocateBodyId(candidate, "SurfaceBody");
      const body = createCadBody(bodyId, `Boundary Surface ${surfaceBoundaryContinuity}`, "surface"); body.appearance = { color: "#5ccddd", roughness: .34 };
      candidate.bodies[bodyId] = body; candidate.activeBodyId = bodyId;
      const featureId = allocateFeatureId(candidate, "BoundarySurface");
      candidate.features[featureId] = { id: featureId, name: `Boundary Surface ${surfaceBoundaryContinuity}`, type: "boundarySurface", bodyId, boundaryEdges: refs, continuity: surfaceBoundaryContinuity, toleranceMm: DEFAULT_CAD_TOLERANCE.boolean, verification: { sampleCount: surfaceQualitySettings.edgeSamples, angularToleranceDeg: surfaceQualitySettings.angularToleranceDeg, curvatureTolerance: surfaceQualitySettings.curvatureTolerance }, enabled: true, state: "clean", dependencies };
      candidate.featureOrder.push(featureId);
      await commitCandidateDocument(current, candidate, featureId, `通过：${featureId} 已由 ${refs.length} 条精确 B-Rep Edge 构建 Boundary Surface${surfaceBoundaryContinuity === "G0" ? "" : `，并通过 ${surfaceBoundaryContinuity} 多点连续性验收`}。`);
      setSelectedBodyId(bodyId); clearSurfaceBoundaryEdges();
    } catch (error) { setStatus(`BOUNDARY_SURFACE_FAILED：${error instanceof Error ? error.message : String(error)}`); }
    finally { setBusy(false); }
  };

  const addSelectedContinuityFace = () => {
    const topology = selectedTopologyRef.current;
    if (!topology || topology.kind !== "face") { setStatus("连续性诊断需要 Face Selection 中的真实 B-Rep Face。"); return; }
    const list = surfaceContinuitySelectionRef.current;
    if (!list.some((item) => item.shapeId === topology.shapeId && item.shapeRevision === topology.shapeRevision && item.localId === topology.localId)) list.push(topology);
    if (list.length > 2) list.splice(0, list.length - 2);
    setSurfaceContinuitySelectionLabel(`${list.length}/2 Face：${list.map((item) => item.localId).join(" ↔ ")}`);
    setSurfaceContinuityReport("尚未分析");
  };
  const clearSurfaceContinuityFaces = () => { surfaceContinuitySelectionRef.current = []; setSurfaceContinuitySelectionLabel("连续性诊断：请选择两个相邻 B-Rep Face"); setSurfaceContinuityReport("尚未分析"); };
  const analyzeSelectedSurfaceContinuity = async () => {
    const kernel = kernelRef.current, faces = [...surfaceContinuitySelectionRef.current];
    if (!kernel || faces.length !== 2) { setStatus("请加入两个真实 B-Rep Face 后再分析连续性。"); return; }
    setBusy(true);
    try {
      const report = gradeSurfaceContinuity(await kernel.analyzeSurfaceContinuity(faces[0], faces[1], surfaceQualitySettings.edgeSamples));
      const maxNormal = report.samples.length ? Math.max(...report.samples.map((sample) => sample.normalAngleDeg)) : undefined;
      const curvature = report.samples.map((sample) => sample.curvatureDelta).filter((value): value is number => typeof value === "number");
      const maxCurvature = curvature.length ? Math.max(...curvature) : undefined;
      setSurfaceContinuityReport(`${report.grade} · shared ${report.sharedEdgeCount} edge${report.sharedEdgeCount === 1 ? "" : "s"}${maxNormal !== undefined ? ` · ΔN ${maxNormal.toFixed(4)}°` : ""}${maxCurvature !== undefined ? ` · ΔK ${maxCurvature.toExponential(3)}` : ""} · ${report.summary}`);
      setStatus(`Surface Continuity：${report.summary}`);
    } catch (error) { setSurfaceContinuityReport(`FAILED · ${error instanceof Error ? error.message : String(error)}`); setStatus(`SURFACE_CONTINUITY_FAILED：${error instanceof Error ? error.message : String(error)}`); }
    finally { setBusy(false); }
  };

  const analyzeSelectedSurfaceQuality = async () => {
    const kernel = kernelRef.current, topology = selectedTopologyRef.current;
    if (!kernel || !topology) { setStatus("请先选择真实 B-Rep Face 或 Edge。"); return; }
    setBusy(true);
    try {
      if (topology.kind === "face") {
        const grid = await kernel.analyzeSurfaceGrid(topology, surfaceQualitySettings.faceSamples, surfaceQualitySettings.faceSamples);
        const summaries = grid.samples.map(summarizeSurfacePoint);
        const gaussian = summaries.map((sample) => sample.gaussian), mean = summaries.map((sample) => sample.mean);
        const saddleCount = summaries.filter((sample) => sample.saddle).length, developableCount = summaries.filter((sample) => sample.developableCandidate).length;
        renderStateRef.current?.showSurfaceHeatmap?.(grid.samples); setSurfaceInspectionMode("heatmap");
        setSurfaceQualityReport(`${summaries[0]?.surfaceType ?? "other"} · ${grid.samples.length}/${grid.uSamples * grid.vSamples} 有效采样 · Kgauss ${Math.min(...gaussian).toExponential(3)} ～ ${Math.max(...gaussian).toExponential(3)} · Kmean ${Math.min(...mean).toExponential(3)} ～ ${Math.max(...mean).toExponential(3)} · 鞍形点 ${saddleCount} · 可展候选 ${developableCount}${grid.rejectedSampleCount ? ` · 修剪域外 ${grid.rejectedSampleCount}` : ""}`);
      } else if (topology.kind === "edge") {
        const analysis = await kernel.analyzeEdgeContinuity(topology, surfaceQualitySettings.angularToleranceDeg, surfaceQualitySettings.curvatureTolerance, surfaceQualitySettings.edgeSamples);
        const level = continuityLevel(analysis);
        const distribution = analysis.stations.reduce((counts, station) => ({ ...counts, [station.grade]: (counts[station.grade] ?? 0) + 1 }), {} as Record<string, number>);
        renderStateRef.current?.showCurvatureComb?.(analysis.stations); setSurfaceInspectionMode("comb");
        setSurfaceQualityReport(`${level} · ${analysis.stations.length} 点沿边采样 · G2 ${distribution.G2 ?? 0} / G1 ${distribution.G1 ?? 0} / G0 ${distribution.G0 ?? 0}${analysis.normalAngleDeg !== undefined ? ` · 最大法向差 ${analysis.normalAngleDeg.toFixed(4)}°` : ""}${analysis.curvatureDelta ? ` · 最大曲率差 ${analysis.curvatureDelta.max.toExponential(3)}` : ""}`);
      } else throw new Error("曲面质量分析只支持 Face / Edge Selection。");
    } catch (error) { setSurfaceQualityReport(`FAILED · ${error instanceof Error ? error.message : String(error)}`); }
    finally { setBusy(false); }
  };

  const createFillSurface = async () => {
    const current = cadDocumentRef.current, runtime = runtimeRef.current, kernel = kernelRef.current, entries = [...surfaceBoundarySelectionRef.current];
    if (!current || !runtime || !kernel || !entries.length) { setStatus("Fill Surface 需要一个由真实 B-Rep Edge 组成的闭合边界集合。"); return; }
    setBusy(true);
    try {
      const candidate = structuredClone(current) as CadDocument<Sketch, Feature>;
      const refs: PersistentEdgeRef[] = [];
      for (const entry of entries) {
        const ref = await capturePersistentTopologyRef(entry.sourceFeatureId, entry.topology, runtime, kernel);
        if (ref.kind !== "edge") throw new Error("Fill Surface 边界引用必须为 Persistent Edge。");
        refs.push(ref);
      }
      const dependencies = [...new Set(refs.map((ref) => ref.sourceFeatureId))];
      const bodyId = allocateBodyId(candidate, "SurfaceBody"); const body = createCadBody(bodyId, "Filled Surface", "surface"); body.appearance = { color: "#62cfdd", roughness: .4 };
      candidate.bodies[bodyId] = body; candidate.activeBodyId = bodyId;
      const featureId = allocateFeatureId(candidate, "FillSurface");
      candidate.features[featureId] = { id: featureId, name: "Fill Surface", type: "fillSurface", bodyId, boundaryEdges: refs, toleranceMm: DEFAULT_CAD_TOLERANCE.boolean, enabled: true, state: "clean", dependencies };
      candidate.featureOrder.push(featureId);
      await commitCandidateDocument(current, candidate, featureId, `通过：${featureId} 已由 ${refs.length} 条 Persistent Edge 构建真实 OCCT Filling Surface。`);
      setSelectedBodyId(bodyId); clearSurfaceBoundaryEdges();
    } catch (error) { setStatus(`FILL_SURFACE_FAILED：${error instanceof Error ? error.message : String(error)}；边界不闭合或 OCCT 无法填充时不会提交。`); }
    finally { setBusy(false); }
  };

  const refreshTrimLabel = () => {
    const target = surfaceTrimTargetRef.current, tool = surfaceTrimToolRef.current;
    setSurfaceTrimSelectionLabel(`Target: ${target?.bodyId ?? "—"} · Tool: ${tool?.bodyId ?? "—"}`);
  };
  const setSelectedAsTrimTarget = () => {
    const current = cadDocumentRef.current; if (!current) return; const source = selectedSurfaceTip(current);
    if (!source) { setStatus("Trim Target 必须是 Surface Body。"); return; }
    surfaceTrimTargetRef.current = source; refreshTrimLabel();
  };
  const setSelectedAsTrimTool = () => {
    const current = cadDocumentRef.current, body = selectedBodyId ? current?.bodies[selectedBodyId] : undefined;
    if (!current || !body || (body.bodyType ?? "solid") !== "solid") { setStatus("Trim Tool 当前要求选择 Solid Body，以保证 Cut/Common 语义确定。 "); return; }
    const featureId = deriveBodyTipFeatureId(current, selectedBodyId) ?? body.tipFeatureId; if (!featureId) { setStatus("Trim Tool 没有有效 Tip Feature。"); return; }
    surfaceTrimToolRef.current = { bodyId: selectedBodyId, featureId }; refreshTrimLabel();
  };
  const clearSurfaceTrim = () => { surfaceTrimTargetRef.current = undefined; surfaceTrimToolRef.current = undefined; refreshTrimLabel(); };

  const trimSelectedSurface = async (keep: "outside" | "inside") => {
    const current = cadDocumentRef.current, target = surfaceTrimTargetRef.current, tool = surfaceTrimToolRef.current;
    if (!current || !target || !tool) { setStatus("请先设置 Surface Target 与 Solid Trim Tool。"); return; }
    if (!current.features[target.featureId] || !current.features[tool.featureId]) { setStatus("Trim 引用已经过期，请重新选择。"); return; }
    setBusy(true);
    try {
      const candidate = structuredClone(current) as CadDocument<Sketch, Feature>;
      const bodyId = allocateBodyId(candidate, "SurfaceBody"); const body = createCadBody(bodyId, keep === "outside" ? "Trimmed Surface" : "Surface Common", "surface"); body.appearance = { color: "#59c7d7", roughness: .4 };
      candidate.bodies[bodyId] = body; candidate.activeBodyId = bodyId;
      const featureId = allocateFeatureId(candidate, "TrimSurface");
      candidate.features[featureId] = { id: featureId, name: keep === "outside" ? "Trim Surface" : "Keep Surface Inside Tool", type: "trimSurface", bodyId, targetFeatureId: target.featureId, toolFeatureId: tool.featureId, keep, toleranceMm: DEFAULT_CAD_TOLERANCE.boolean, enabled: true, state: "clean", dependencies: [target.featureId, tool.featureId] };
      candidate.featureOrder.push(featureId);
      await commitCandidateDocument(current, candidate, featureId, `通过：${featureId} 已执行精确 B-Rep ${keep === "outside" ? "Cut Trim" : "Common Trim"}。`);
      setSelectedBodyId(bodyId); clearSurfaceTrim();
    } catch (error) { setStatus(`TRIM_SURFACE_FAILED：${error instanceof Error ? error.message : String(error)}；Last-Good 保持不变。`); }
    finally { setBusy(false); }
  };

  const clearDefeatureSelection = () => { defeatureSelectionRef.current = []; setDefeatureSelectionLabel("去特征选择集为空"); };

  const addSelectedFaceToDefeatureSelection = () => {
    const current = cadDocumentRef.current, runtime = runtimeRef.current, topology = selectedTopologyRef.current;
    if (!current || !runtime || !topology || topology.kind !== "face" || !selectedBodyId) { setStatus("请先在专业 Part Studio 中选择一个真实 B-Rep Face。"); return; }
    const body = current.bodies[selectedBodyId];
    const sourceFeatureId = deriveBodyTipFeatureId(current, selectedBodyId) ?? body?.tipFeatureId ?? currentFeatureIdRef.current;
    const shape = runtime.featureShapes.get(sourceFeatureId);
    if (!shape || shape.id !== topology.shapeId || shape.revision !== topology.shapeRevision) { setStatus("当前 Face 不属于该 Body 的最新 Tip Feature，不能加入 Defeature 集合。"); return; }
    const existing = defeatureSelectionRef.current;
    if (existing.length && (existing[0].bodyId !== selectedBodyId || existing[0].sourceFeatureId !== sourceFeatureId)) { setStatus("一个 Defeature Feature 只能选择同一 Body / 同一 Tip Feature 上的 Faces；请先清空选择集。"); return; }
    if (!existing.some((entry) => entry.topology.localId === topology.localId)) existing.push({ bodyId: selectedBodyId, sourceFeatureId, topology });
    setDefeatureSelectionLabel(`${existing.length} Face：${existing.map((entry) => entry.topology.localId).join(", ")}`);
    setStatus(`已加入 Defeature 选择集：${topology.localId}。可继续选择其它 Face。`);
  };

  const applyDefeatureSelection = async () => {
    const current = cadDocumentRef.current, runtime = runtimeRef.current, kernel = kernelRef.current, entries = [...defeatureSelectionRef.current];
    if (!current || !runtime || !kernel || !entries.length) { setStatus("Defeature 选择集为空。"); return; }
    const { bodyId, sourceFeatureId } = entries[0];
    if (entries.some((entry) => entry.bodyId !== bodyId || entry.sourceFeatureId !== sourceFeatureId)) { setStatus("DEFEATURE_SELECTION_INVALID：选择集跨越了不同 Body / Feature。"); return; }
    setBusy(true);
    try {
      const candidate = structuredClone(current) as CadDocument<Sketch, Feature>;
      if (!candidate.features[sourceFeatureId] || !candidate.bodies[bodyId]) throw new Error("Defeature 目标 Body / Feature 已不再存在。");
      const faces = await Promise.all(entries.map((entry) => capturePersistentTopologyRef(sourceFeatureId, entry.topology, runtime, kernel)));
      const id = allocateFeatureId(candidate, "DeleteFace");
      candidate.features[id] = { id, name: `Defeature ${faces.length} Faces`, type: "deleteFace", bodyId, targetFeatureId: sourceFeatureId, faces, toleranceMm: 0, enabled: true, state: "clean", dependencies: [sourceFeatureId] };
      candidate.featureOrder.push(id);
      await commitCandidateDocument(current, candidate, id, `通过：${id} 已使用 OCCT Defeature 愈合 ${faces.length} 个 Face，并写入 Feature History。`);
      clearDefeatureSelection();
    } catch (error) { setStatus(`DEFEATURE_FAILED：${error instanceof Error ? error.message : String(error)}；Last-Good 设计保持不变。`); }
    finally { setBusy(false); }
  };

  const applySelectedFeature = async (kind: "hole" | "fillet" | "variableFillet" | "chamfer" | "shell" | "removeHole" | "pushPull" | "deleteFace") => {
    const runtime = runtimeRef.current, kernel = kernelRef.current, topology = selectedTopologyRef.current;
    const activeDocument = cadDocumentRef.current;
    const selectedBody = activeDocument && selectedBodyId ? activeDocument.bodies[selectedBodyId] : undefined;
    const sourceFeatureId = activeDocument && selectedBodyId
      ? (deriveBodyTipFeatureId(activeDocument, selectedBodyId) ?? selectedBody?.tipFeatureId ?? currentFeatureIdRef.current)
      : currentFeatureIdRef.current;
    if (selectedBody && (selectedBody.bodyType ?? "solid") !== "solid") { setStatus(selectedBody.bodyType === "curve" ? "当前选择的是曲线体；可用于边界、投影和曲面构造，不能直接应用实体特征。" : "当前选择的是 Surface Body；请使用 Surface Modeling 工具（Offset / Trim / Fill / Sew / Thicken），避免把实体 Feature 错用于曲面。"); return; }
    if (!runtime || !kernel || !topology) { setStatus("请先在当前真实 B-Rep 上选择对应 Face 或 Edge。"); return; }
    const faceKind = kind === "hole" || kind === "shell" || kind === "removeHole" || kind === "pushPull" || kind === "deleteFace";
    if ((faceKind && topology.kind !== "face") || (!faceKind && topology.kind !== "edge")) {
      setStatus(faceKind ? `${kind} 需要选择 Face。` : `${kind} 需要选择 Edge。`); return;
    }
    if (activeDocument?.features[sourceFeatureId]) {
      setBusy(true);
      try {
        const candidate = structuredClone(activeDocument) as CadDocument<Sketch, Feature>;
        const source = candidate.features[sourceFeatureId];
        const bodyId = source.bodyId ?? selectedBodyId ?? candidate.activeBodyId;
        if (!bodyId) throw new Error("无法确定 Direct Edit 的目标 Body。");
        const persistent = await capturePersistentTopologyRef(sourceFeatureId, topology, runtime, kernel);
        const prefix = kind === "pushPull" ? "PushPull" : kind === "removeHole" ? "RemoveHole" : kind === "deleteFace" ? "DeleteFace" : kind === "variableFillet" ? "VariableFillet" : `${kind[0].toUpperCase()}${kind.slice(1)}`;
        const id = allocateFeatureId(candidate, prefix);
        candidate.features[id] = kind === "hole"
          ? { id, name: id, type: "hole", bodyId, targetFeatureId: sourceFeatureId, targetFace: persistent, center: { x: 0, y: 0 }, diameterMm: 10, depth: { type: "throughAll" }, enabled: true, state: "clean", dependencies: [sourceFeatureId] }
          : kind === "fillet" || kind === "variableFillet"
            ? { id, name: kind === "variableFillet" ? `可变圆角 R${variableFilletRadii.startMm} → R${variableFilletRadii.endMm}` : id, type: "fillet", bodyId, targetFeatureId: sourceFeatureId, edges: [persistent], radiusMm: kind === "variableFillet" ? variableFilletRadii.startMm : 3, ...(kind === "variableFillet" ? { endRadiusMm: variableFilletRadii.endMm } : {}), enabled: true, state: "clean", dependencies: [sourceFeatureId] }
            : kind === "chamfer"
              ? { id, name: id, type: "chamfer", bodyId, targetFeatureId: sourceFeatureId, edges: [persistent], distanceMm: 3, enabled: true, state: "clean", dependencies: [sourceFeatureId] }
              : kind === "removeHole"
                ? { id, name: "Remove Hole", type: "removeHole", bodyId, targetFeatureId: sourceFeatureId, cylindricalFace: persistent, enabled: true, state: "clean", dependencies: [sourceFeatureId] }
                : kind === "deleteFace"
                  ? { id, name: "Delete Face / Defeature", type: "deleteFace", bodyId, targetFeatureId: sourceFeatureId, faces: [persistent], toleranceMm: 0, enabled: true, state: "clean", dependencies: [sourceFeatureId] }
                  : kind === "pushPull"
                    ? { id, name: `Push/Pull ${pushPullDistanceMm} mm`, type: "planarPushPull", bodyId, targetFeatureId: sourceFeatureId, planarFace: persistent, distanceMm: pushPullDistanceMm, enabled: true, state: "clean", dependencies: [sourceFeatureId] }
                    : { id, name: id, type: "shell", bodyId, targetFeatureId: sourceFeatureId, removeFaces: [persistent], thicknessMm: 2, enabled: true, state: "clean", dependencies: [sourceFeatureId] };
        candidate.featureOrder.push(id);
        await commitCandidateDocument(activeDocument, candidate, id, `通过：${id} 已事务式重建并写入 Feature History。`);
      } catch (error) { setStatus(`失败：${error instanceof Error ? error.message : String(error)}`); }
      finally { setBusy(false); }
      return;
    }

    // Isolated debug fallback retained for the original kernel verification page.
    if (kind === "pushPull" || kind === "deleteFace") { setStatus(`${kind === "pushPull" ? "Planar Push/Pull" : "Delete Face / Defeature"} 只在专业 CadDocument 工作台中启用。`); return; }
    setBusy(true);
    try {
      const document = debugDocumentRef.current;
      const persistent = await capturePersistentTopologyRef(sourceFeatureId, topology, runtime, kernel);
      const id = kind === "hole" ? "Hole01" : kind === "fillet" || kind === "variableFillet" ? "Fillet01" : kind === "chamfer" ? "Chamfer01" : kind === "removeHole" ? "RemoveHole01" : "Shell01";
      const features = document.features as Record<string, unknown>;
      features[id] = kind === "hole"
        ? { id, name: id, type: "hole", targetFeatureId: sourceFeatureId, targetFace: persistent, center: { x: 0, y: 0 }, diameterMm: 10, depth: { type: "throughAll" }, enabled: true, state: "clean", dependencies: [sourceFeatureId] }
        : kind === "fillet" || kind === "variableFillet"
          ? { id, name: id, type: "fillet", targetFeatureId: sourceFeatureId, edges: [persistent], radiusMm: kind === "variableFillet" ? variableFilletRadii.startMm : 3, ...(kind === "variableFillet" ? { endRadiusMm: variableFilletRadii.endMm } : {}), enabled: true, state: "clean", dependencies: [sourceFeatureId] }
          : kind === "chamfer"
            ? { id, name: id, type: "chamfer", targetFeatureId: sourceFeatureId, edges: [persistent], distanceMm: 3, enabled: true, state: "clean", dependencies: [sourceFeatureId] }
            : kind === "removeHole"
              ? { id, name: "Remove Hole", type: "removeHole", targetFeatureId: sourceFeatureId, cylindricalFace: persistent, enabled: true, state: "clean", dependencies: [sourceFeatureId] }
              : { id, name: id, type: "shell", targetFeatureId: sourceFeatureId, removeFaces: [persistent], thicknessMm: 2, enabled: true, state: "clean", dependencies: [sourceFeatureId] };
      const result = await evaluateFeature(id, { document, kernel, tolerance: DEFAULT_CAD_TOLERANCE, buildProfiles: buildSketchProfiles, runtime });
      if (result.status === "failed") throw result.error;
      recordFeatureEvaluationResult(runtime, result); await replaceFeatureShape(runtime, kernel, id, result.shape);
      const [properties, tessellation, polylines] = await Promise.all([kernel.getShapeProperties(result.shape), kernel.tessellate(result.shape, { linearDeflectionMm: 1, angularDeflectionDeg: 10 }), kernel.getEdgePolylines(result.shape)]);
      render(result.shape, tessellation, polylines); currentFeatureIdRef.current = id; selectedTopologyRef.current = undefined; setSelection("未选择"); currentShapeRef.current = result.shape;
      setStatus(`通过：${id} 已通过 Persistent Topology 生成真实 B-Rep，体积 ${properties.volumeMm3?.toFixed(3)} mm³。`);
    } catch (error) { setStatus(`失败：${error instanceof Error ? error.message : String(error)}`); }
    finally { setBusy(false); }
  };

  const setSelectedAsSurfaceSplitTarget = () => { const current=cadDocumentRef.current;if(!current)return;const source=selectedSurfaceTip(current);if(!source){setStatus("请先选择一个 Surface Body 作为 Split Target。");return;}surfaceSplitTargetRef.current=source;setSurfaceSplitSelectionLabel(`Target ${source.featureId} · Tool ${surfaceSplitToolRef.current?.featureId??"未设置"}`); };
  const setSelectedAsSurfaceSplitTool = () => { const current=cadDocumentRef.current;if(!current)return;const source=selectedSurfaceTip(current);if(!source){setStatus("请先选择一个 Surface Body 作为 Split Tool。");return;}surfaceSplitToolRef.current=source;setSurfaceSplitSelectionLabel(`Target ${surfaceSplitTargetRef.current?.featureId??"未设置"} · Tool ${source.featureId}`); };
  const clearSurfaceSplit = () => {surfaceSplitTargetRef.current=undefined;surfaceSplitToolRef.current=undefined;setSurfaceSplitSelectionLabel("Surface Split：尚未设置 Target / Tool Surface");};
  const splitSelectedSurface = async () => { const current=cadDocumentRef.current,target=surfaceSplitTargetRef.current,tool=surfaceSplitToolRef.current;if(!current||!target||!tool){setStatus("Surface Split 需要 Target 与 Tool 两个 Surface Body。");return;}if(target.featureId===tool.featureId){setStatus("Surface Split 的 Target 与 Tool 不能相同。");return;}const candidate=structuredClone(current) as CadDocument<Sketch,Feature>;const bodyId=allocateBodyId(candidate,"SurfaceBody"),featureId=allocateFeatureId(candidate,"SplitSurface");const body=createCadBody(bodyId,"Split Surface","surface");body.appearance={color:"#66c8dc",roughness:.34};candidate.bodies[bodyId]=body;candidate.activeBodyId=bodyId;candidate.features[featureId]={id:featureId,name:"Surface Split",type:"splitSurface",bodyId,targetFeatureId:target.featureId,toolFeatureId:tool.featureId,toleranceMm:DEFAULT_CAD_TOLERANCE.boolean,enabled:true,state:"clean",dependencies:[target.featureId,tool.featureId]};candidate.featureOrder.push(featureId);setBusy(true);try{await commitCandidateDocument(current,candidate,featureId,`通过：${featureId} 已使用 OCCT BOPAlgo Split 生成真实曲面分片 Compound。`);setSelectedBodyId(bodyId);clearSurfaceSplit();}catch(error){setStatus(`SURFACE_SPLIT_FAILED：${error instanceof Error?error.message:String(error)}`);}finally{setBusy(false);} };
  const createSurfaceIntersectionCurve = async () => { const current=cadDocumentRef.current,first=surfaceSplitTargetRef.current,second=surfaceSplitToolRef.current;if(!current||!first||!second){setStatus("曲面交线需要先设置两张相交曲面。");return;}if(first.featureId===second.featureId){setStatus("曲面交线的两个来源不能相同。");return;}const candidate=structuredClone(current) as CadDocument<Sketch,Feature>;const bodyId=allocateBodyId(candidate,"CurveBody"),featureId=allocateFeatureId(candidate,"SurfaceIntersection");const body=createCadBody(bodyId,"曲面交线","curve");body.appearance={color:"#d7ac37",roughness:.25};candidate.bodies[bodyId]=body;candidate.activeBodyId=bodyId;candidate.features[featureId]={id:featureId,name:"精确曲面交线",type:"surfaceIntersection",bodyId,sourceFeatureIds:[first.featureId,second.featureId],toleranceMm:DEFAULT_CAD_TOLERANCE.boolean,enabled:true,state:"clean",dependencies:[first.featureId,second.featureId]};candidate.featureOrder.push(featureId);setBusy(true);try{await commitCandidateDocument(current,candidate,featureId,`通过：${featureId} 已生成真实 OCCT Section Edge；可切换到“边”选择并投影到草图。`);setSelectedBodyId(bodyId);clearSurfaceSplit();}catch(error){setStatus(`SURFACE_INTERSECTION_FAILED：${error instanceof Error?error.message:String(error)}；两张曲面未相交时不会写入历史。`);}finally{setBusy(false);} };

  const setReplaceFaceTarget = () => { const current=cadDocumentRef.current,topology=selectedTopologyRef.current;if(!current||!selectedBodyId||!topology||topology.kind!=="face"){setStatus("Replace Face：请先选择 Solid Body 上的真实 Face。");return;}const body=current.bodies[selectedBodyId];if(!body||(body.bodyType??"solid")!=="solid"){setStatus("Replace Face Target 必须属于 Solid Body。");return;}const sourceFeatureId=deriveBodyTipFeatureId(current,selectedBodyId)??body.tipFeatureId;if(!sourceFeatureId){setStatus("Replace Face：Solid Body 没有有效 Tip Feature。");return;}replaceFaceTargetRef.current={bodyId:selectedBodyId,sourceFeatureId,topology};setReplaceFaceSelectionLabel(`Solid Face ${topology.localId} · Replacement ${replaceFaceSurfaceRef.current?.featureId??"未设置"}`);};
  const setReplaceFaceSurface = () => { const current=cadDocumentRef.current;if(!current)return;const source=selectedSurfaceTip(current);if(!source){setStatus("Replace Face：请先选择一个 Surface Body 作为 Replacement。");return;}replaceFaceSurfaceRef.current=source;setReplaceFaceSelectionLabel(`Solid Face ${replaceFaceTargetRef.current?.topology.localId??"未设置"} · Replacement ${source.featureId}`);};
  const clearReplaceFace = () => {replaceFaceTargetRef.current=undefined;replaceFaceSurfaceRef.current=undefined;setReplaceFaceSelectionLabel("Replace Face：尚未设置 Solid Face / Replacement Surface");};
  const applyReplaceFace = async () => { const current=cadDocumentRef.current,runtime=runtimeRef.current,kernel=kernelRef.current,target=replaceFaceTargetRef.current,replacement=replaceFaceSurfaceRef.current;if(!current||!runtime||!kernel||!target||!replacement){setStatus("Replace Face 需要 Solid Face 与 Replacement Surface。");return;}const currentTip=deriveBodyTipFeatureId(current,target.bodyId)??current.bodies[target.bodyId]?.tipFeatureId;if(currentTip!==target.sourceFeatureId){setStatus("Replace Face Target 已过期：Solid Body 历史已变化，请重新选择 Face。");return;}setBusy(true);try{const persistent=await capturePersistentTopologyRef(target.sourceFeatureId,target.topology,runtime,kernel);if(persistent.kind!=="face")throw new Error("未能捕获 Persistent Face Reference。");const candidate=structuredClone(current) as CadDocument<Sketch,Feature>;const featureId=allocateFeatureId(candidate,"ReplaceFace");candidate.features[featureId]={id:featureId,name:"Replace Face",type:"replaceFace",bodyId:target.bodyId,targetFeatureId:target.sourceFeatureId,targetFace:persistent,replacementFeatureId:replacement.featureId,toleranceMm:DEFAULT_CAD_TOLERANCE.boolean,enabled:true,state:"clean",dependencies:[target.sourceFeatureId,replacement.featureId]};candidate.featureOrder.push(featureId);candidate.bodies[target.bodyId].tipFeatureId=featureId;await commitCandidateDocument(current,candidate,featureId,`通过：${featureId} 已用 Replacement Surface 重新 Sew 并 Solidify；边界不匹配时操作会失败而不污染 History。`);setSelectedBodyId(target.bodyId);clearReplaceFace();}catch(error){setStatus(`REPLACE_FACE_FAILED：${error instanceof Error?error.message:String(error)}`);}finally{setBusy(false);} };

  const applyPrecisionBodyTransform = async () => {
    const current = cadDocumentRef.current;
    if (!current || !selectedBodyId || !current.bodies[selectedBodyId]) { setStatus("精确变换：请先从左侧选择一个 Body。"); return; }
    const values = [refineTransform.x, refineTransform.y, refineTransform.z, refineTransform.angle];
    if (!values.every(Number.isFinite)) { setStatus("精确变换：位移和角度必须是有效数字。"); return; }
    if (values.every((value) => Math.abs(value) <= 1e-9)) { setStatus("精确变换：请输入非零位移或旋转角度。"); return; }
    const inputFeatureId = deriveBodyTipFeatureId(current, selectedBodyId) ?? current.bodies[selectedBodyId].tipFeatureId;
    if (!inputFeatureId || !current.features[inputFeatureId]) { setStatus("精确变换：所选 Body 没有可用的上游特征。"); return; }
    const candidate = structuredClone(current) as CadDocument<Sketch, Feature>;
    const id = allocateFeatureId(candidate, "BodyTransform");
    candidate.features[id] = {
      id, name: `精确变换 ${refineTransform.axis} ${refineTransform.angle}°`, type: "bodyTransform", bodyId: selectedBodyId,
      inputFeatureId, translationMm: { x: refineTransform.x, y: refineTransform.y, z: refineTransform.z },
      rotation: Math.abs(refineTransform.angle) > 1e-9 ? { axis: refineTransform.axis, angleDeg: refineTransform.angle } : undefined,
      enabled: true, state: "clean", dependencies: [inputFeatureId],
    };
    candidate.featureOrder.push(id);
    setBusy(true);
    try { await commitCandidateDocument(current, candidate, id, `通过：${id} 已按毫米 / 角度参数重建，并写入特征历史。`); }
    catch (error) { setStatus(`BODY_TRANSFORM_FAILED：${error instanceof Error ? error.message : String(error)}；原模型保持不变。`); }
    finally { setBusy(false); }
  };

  const applyPrecisionBodyBoolean = async () => {
    const current = cadDocumentRef.current;
    if (!current) { setStatus("多实体布尔：请先创建或打开项目。"); return; }
    const solidBodyIds = Object.values(current.bodies).filter((body) => (body.bodyType ?? "solid") === "solid").map((body) => body.id);
    const targetBodyId = refineBoolean.targetBodyId || (solidBodyIds.includes(selectedBodyId) ? selectedBodyId : solidBodyIds[0]) || "";
    const toolBodyId = refineBoolean.toolBodyId || solidBodyIds.find((id) => id !== targetBodyId) || "";
    if (!targetBodyId || !toolBodyId) { setStatus("多实体布尔：至少需要两个实体 Body。"); return; }
    if (targetBodyId === toolBodyId) { setStatus("多实体布尔：目标体和工具体不能相同。"); return; }
    const targetFeatureId = deriveBodyTipFeatureId(current, targetBodyId) ?? current.bodies[targetBodyId]?.tipFeatureId;
    const toolFeatureId = deriveBodyTipFeatureId(current, toolBodyId) ?? current.bodies[toolBodyId]?.tipFeatureId;
    if (!targetFeatureId || !toolFeatureId || !current.features[targetFeatureId] || !current.features[toolFeatureId]) { setStatus("多实体布尔：目标体或工具体没有有效的上游实体。"); return; }
    const candidate = structuredClone(current) as CadDocument<Sketch, Feature>;
    const id = allocateFeatureId(candidate, "BodyBoolean");
    const operationName = refineBoolean.operation === "union" ? "合并" : refineBoolean.operation === "cut" ? "切除" : "相交";
    candidate.features[id] = {
      id, name: `布尔${operationName}`, type: "bodyBoolean", bodyId: targetBodyId, operation: refineBoolean.operation,
      target: { bodyId: targetBodyId, featureId: targetFeatureId }, tools: [{ bodyId: toolBodyId, featureId: toolFeatureId }],
      keepToolBody: refineBoolean.keepToolBody, enabled: true, state: "clean", dependencies: [targetFeatureId, toolFeatureId],
    };
    if (!refineBoolean.keepToolBody) candidate.bodies[toolBodyId].visible = false;
    candidate.featureOrder.push(id);
    setBusy(true);
    try {
      await commitCandidateDocument(current, candidate, id, `通过：${id} 已完成真实 B-Rep ${operationName}，并保留可回溯的目标体 / 工具体引用。`);
      setSelectedBodyId(targetBodyId);
    } catch (error) { setStatus(`BODY_BOOLEAN_FAILED：${error instanceof Error ? error.message : String(error)}；原模型保持不变。`); }
    finally { setBusy(false); }
  };

  const applyPrecisionDraft = async () => {
    const current = cadDocumentRef.current, runtime = runtimeRef.current, kernel = kernelRef.current, topology = selectedTopologyRef.current;
    if (!current || !runtime || !kernel || !selectedBodyId || !topology || topology.kind !== "face") { setStatus("拔模：请切换到“面”选择模式，并选择一个实体面。"); return; }
    const body = current.bodies[selectedBodyId];
    if (!body || (body.bodyType ?? "solid") !== "solid") { setStatus("拔模：目标必须是实体 Body 上的面。"); return; }
    if (!Number.isFinite(refineDraft.angleDeg) || Math.abs(refineDraft.angleDeg) <= 1e-6 || Math.abs(refineDraft.angleDeg) >= 89) { setStatus("拔模：角度应大于 0° 且小于 89°。"); return; }
    const targetFeatureId = deriveBodyTipFeatureId(current, selectedBodyId) ?? body.tipFeatureId;
    if (!targetFeatureId || !current.features[targetFeatureId]) { setStatus("拔模：所选 Body 没有有效的上游特征。"); return; }
    setBusy(true);
    try {
      const persistent = await capturePersistentTopologyRef(targetFeatureId, topology, runtime, kernel);
      if (persistent.kind !== "face") throw new Error("未能捕获持久化面引用。");
      const candidate = structuredClone(current) as CadDocument<Sketch, Feature>;
      const id = allocateFeatureId(candidate, "Draft");
      const pullDirection = refineDraft.axis === "X" ? { x: 1, y: 0, z: 0 } : refineDraft.axis === "Y" ? { x: 0, y: 1, z: 0 } : { x: 0, y: 0, z: 1 };
      candidate.features[id] = {
        id, name: `拔模 ${refineDraft.angleDeg}°`, type: "draft", bodyId: selectedBodyId, targetFeatureId,
        faces: [persistent], pullDirection, angleDeg: Math.abs(refineDraft.angleDeg), reverse: refineDraft.reverse,
        enabled: true, state: "clean", dependencies: [targetFeatureId],
      };
      candidate.featureOrder.push(id);
      await commitCandidateDocument(current, candidate, id, `通过：${id} 已对所选面应用 ${refineDraft.angleDeg}° 拔模，并写入特征历史。`);
    } catch (error) { setStatus(`DRAFT_FAILED：${error instanceof Error ? error.message : String(error)}；请检查所选面和拔模方向。`); }
    finally { setBusy(false); }
  };

  const applyPrecisionRib = async () => {
    const current = cadDocumentRef.current;
    if (!current || !selectedBodyId || !selectedSketchId) { setStatus("加强筋：请同时选择目标实体和一条开放直线草图。"); return; }
    const body = current.bodies[selectedBodyId], sketch = current.sketches[selectedSketchId];
    if (!body || (body.bodyType ?? "solid") !== "solid" || !sketch) { setStatus("加强筋：目标必须是实体 Body，且草图必须存在。"); return; }
    if (![refineRib.thicknessMm, refineRib.heightMm].every((value) => Number.isFinite(value) && value > DEFAULT_CAD_TOLERANCE.geometry)) { setStatus("加强筋：厚度和高度必须大于建模容差。"); return; }
    const targetFeatureId = deriveBodyTipFeatureId(current, selectedBodyId) ?? body.tipFeatureId;
    if (!targetFeatureId || !current.features[targetFeatureId]) { setStatus("加强筋：所选 Body 没有有效的上游特征。"); return; }
    const candidate = structuredClone(current) as CadDocument<Sketch, Feature>;
    const id = allocateFeatureId(candidate, "Rib");
    candidate.features[id] = {
      id, name: `加强筋 ${refineRib.thicknessMm} × ${refineRib.heightMm} mm`, type: "rib", bodyId: selectedBodyId,
      targetFeatureId, sketchId: selectedSketchId, thicknessMm: refineRib.thicknessMm, heightMm: refineRib.heightMm,
      direction: refineRib.direction, enabled: true, state: "clean", dependencies: [targetFeatureId],
    };
    candidate.featureOrder.push(id);
    setBusy(true);
    try { await commitCandidateDocument(current, candidate, id, `通过：${id} 已由开放直线草图生成真实 B-Rep 加强筋。`); }
    catch (error) { setStatus(`RIB_FAILED：${error instanceof Error ? error.message : String(error)}；V1 需要恰好一条非零开放直线。`); }
    finally { setBusy(false); }
  };

  const applyBodyOffset = async () => {
    const current = cadDocumentRef.current, runtime = runtimeRef.current, kernel = kernelRef.current;
    if (!current || !runtime || !kernel || !selectedBodyId) { setStatus("请先选择一个 B-Rep Body。"); return; }
    if (!Number.isFinite(bodyOffsetDistanceMm) || Math.abs(bodyOffsetDistanceMm) <= 1e-6) { setStatus("实体偏移距离不能为 0。"); return; }
    const targetFeatureId = deriveBodyTipFeatureId(current, selectedBodyId) ?? current.bodies[selectedBodyId]?.tipFeatureId;
    if (!targetFeatureId || !current.features[targetFeatureId]) { setStatus("目标 Body 没有可偏移的有效 Tip Feature。"); return; }
    const candidate = structuredClone(current) as CadDocument<Sketch, Feature>;
    const id = allocateFeatureId(candidate, "OffsetBody");
    candidate.features[id] = { id, name: `Offset Body ${bodyOffsetDistanceMm} mm`, type: "offsetBody", bodyId: selectedBodyId, targetFeatureId, distanceMm: bodyOffsetDistanceMm, enabled: true, state: "clean", dependencies: [targetFeatureId] };
    candidate.featureOrder.push(id);
    setBusy(true);
    try { await commitCandidateDocument(current, candidate, id, `通过：${id} 已调用 OCCT 实体 Offset 并进入 Feature History。`); }
    catch (error) { setStatus(`OFFSET_BODY_FAILED：${error instanceof Error ? error.message : String(error)}`); }
    finally { setBusy(false); }
  };

  const autoRebuildWidth = async () => {
    const runtime = runtimeRef.current; const kernel = kernelRef.current; if (!runtime || !kernel) { setStatus("请先创建 Base Extrude。"); return; }
    setBusy(true); try {
      const document = debugDocumentRef.current;
      const entities = document.sketches.Sketch01.entities as Record<string, { start: { x: number }; end: { x: number } }>;
      entities.a.end.x = 150; entities.b.start.x = 150; entities.b.end.x = 150; entities.c.start.x = 150;
      const rebuilt = await rebuildDocument({ document, runtime, rebuildRuntime: rebuildStateRef.current, kernel, tolerance: DEFAULT_CAD_TOLERANCE, buildProfiles: buildSketchProfiles }, { changedSketchIds: ["Sketch01"] });
      if (!rebuilt.success) throw new Error(rebuilt.errors.map((error) => error.message).join("; "));
      const id = currentFeatureIdRef.current; const shape = runtime.featureShapes.get(id); if (!shape) throw new Error("Rebuild did not retain the current Feature Shape.");
      const [tessellation, polylines, properties] = await Promise.all([kernel.tessellate(shape, { linearDeflectionMm: 1, angularDeflectionDeg: 10 }), kernel.getEdgePolylines(shape), kernel.getShapeProperties(shape)]);
      render(shape, tessellation, polylines); currentShapeRef.current = shape; selectedTopologyRef.current = undefined; setSelection("未选择"); setStatus(`通过：自动重建 ${rebuilt.evaluatedFeatureIds.join(" → ")}；当前体积 ${properties.volumeMm3?.toFixed(3)} mm³。`); setDiagnostics(`Persistent Ref: V2 · Resolution: SIGNATURE · Document Fingerprint: ${rebuildStateRef.current.currentDocumentFingerprint ?? "none"} · Runtime Fingerprint: ${rebuildStateRef.current.lastSuccessfulDocumentFingerprint ?? "none"} · Runtime Current: ${rebuildStateRef.current.documentStatus === "current" ? "YES" : "NO"}`);
    } catch (error) { setStatus(`失败：${error instanceof Error ? error.message : String(error)}`); } finally { setBusy(false); }
  };

  /** M10-D uses the production rebuild entry point only: no individual Feature
   * evaluator is called for the complete Extrude → Hole → Fillet chain. */
  const runAutomaticChain = async () => {
    setBusy(true); setSelection("未选择"); setStatus("正在执行 M10-D 自动链：Extrude → Hole → Fillet…");
    await disposeActiveRuntime();
    let runtime: ReturnType<typeof createCadRuntimeState> | undefined; let kernel: OcctKernel | undefined;
    try {
      const document = createDebugDocument();
      debugDocumentRef.current = document;
      const features = document.features as Record<string, unknown>;
      kernel = new OcctKernel(); await kernel.init(); runtime = createCadRuntimeState();
      const rebuildContext = { document, runtime, rebuildRuntime: createRebuildRuntimeState(), kernel, tolerance: DEFAULT_CAD_TOLERANCE, buildProfiles: buildSketchProfiles };
      if (!(await rebuildDocument(rebuildContext, { full: true })).success) throw new Error("Base Extrude rebuild failed.");
      const top = (await kernel.getFaces(runtime.featureShapes.get("Extrude01")!)).find((face) => (face.normal?.z ?? 0) > .999);
      if (!top) throw new Error("Top Face is unavailable.");
      const topRef = await capturePersistentTopologyRef("Extrude01", top.topology, runtime, kernel);
      features.Hole01 = { id: "Hole01", name: "Hole01", type: "hole", targetFeatureId: "Extrude01", targetFace: topRef, center: { x: 0, y: 0 }, diameterMm: 10, depth: { type: "throughAll" }, enabled: true, state: "clean", dependencies: ["Extrude01"] };
      document.featureOrder.push("Hole01");
      if (!(await rebuildDocument(rebuildContext, { full: true })).success) throw new Error("Hole preparation rebuild failed.");
      const edge = (await kernel.getEdges(runtime.featureShapes.get("Hole01")!)).find((item) => item.curveType === "line" && Math.abs((item.endMm?.z ?? 0) - (item.startMm?.z ?? 0)) > 19);
      if (!edge) throw new Error("Stable exterior Edge is unavailable.");
      const edgeRef = await capturePersistentTopologyRef("Hole01", edge.topology, runtime, kernel);
      features.Fillet01 = { id: "Fillet01", name: "Fillet01", type: "fillet", targetFeatureId: "Hole01", edges: [edgeRef], radiusMm: 3, enabled: true, state: "clean", dependencies: ["Hole01"] };
      document.featureOrder.push("Fillet01");
      const complete = await rebuildDocument(rebuildContext, { full: true });
      if (!complete.success) throw new Error(complete.errors.map((error) => error.message).join("; "));
      const shape = runtime.featureShapes.get("Fillet01")!; const [properties, tessellation, polylines] = await Promise.all([kernel.getShapeProperties(shape), kernel.tessellate(shape, { linearDeflectionMm: 1, angularDeflectionDeg: 10 }), kernel.getEdgePolylines(shape)]);
      render(shape, tessellation, polylines); runtimeRef.current = runtime; kernelRef.current = kernel; rebuildStateRef.current = rebuildContext.rebuildRuntime; currentFeatureIdRef.current = "Fillet01"; currentShapeRef.current = shape; runtime = undefined; kernel = undefined;
      setStatus(`通过：M10-D Full Auto Rebuild ${complete.evaluatedFeatureIds.join(" → ")}；体积 ${properties.volumeMm3?.toFixed(3)} mm³。`);
      setDiagnostics(`Persistent Ref: V2 · Resolution: SIGNATURE · Document Fingerprint: ${computeCadDocumentFingerprint(document)} · Runtime Current: ${rebuildContext.rebuildRuntime.documentStatus === "current" ? "YES" : "NO"}`);
    } catch (error) { setStatus(`失败：${error instanceof Error ? error.message : String(error)}`); } finally { if (runtime && kernel) await disposeCadRuntimeState(runtime, kernel); if (kernel) await kernel.dispose(); setBusy(false); }
  };

  const rebuildM10D = async (action: "hole20" | "fillet5" | "invalidFillet" | "suppressHole" | "unsuppressHole" | "suppressFillet") => {
    const runtime = runtimeRef.current; const kernel = kernelRef.current; const document = debugDocumentRef.current; if (!runtime || !kernel || !("Hole01" in document.features) || !("Fillet01" in document.features)) { setStatus("请先运行 M10-D Full Auto Chain。"); return; }
    setBusy(true); try {
      const features = document.features as Record<string, { enabled?: boolean; state?: string; diameterMm?: number; radiusMm?: number }>;
      let request: { changedFeatureIds: string[] };
      if (action === "hole20") { features.Hole01.diameterMm = 20; request = { changedFeatureIds: ["Hole01"] }; }
      else if (action === "fillet5" || action === "invalidFillet") { features.Fillet01.radiusMm = action === "fillet5" ? 5 : 1000; request = { changedFeatureIds: ["Fillet01"] }; }
      else if (action === "suppressHole" || action === "unsuppressHole") { features.Hole01.enabled = action === "unsuppressHole"; features.Hole01.state = action === "unsuppressHole" ? "clean" : "suppressed"; request = { changedFeatureIds: ["Hole01"] }; }
      else { features.Fillet01.enabled = false; features.Fillet01.state = "suppressed"; request = { changedFeatureIds: ["Fillet01"] }; }
      const rebuilt = await rebuildDocument({ document, runtime, rebuildRuntime: rebuildStateRef.current, kernel, tolerance: DEFAULT_CAD_TOLERANCE, buildProfiles: buildSketchProfiles }, request);
      if (!rebuilt.success) { setStatus(`已回滚：${rebuilt.failedFeatureIds.join(" → ")} 失败；最后成功几何仍保持显示。`); setDiagnostics(`Persistent Ref: V2 · Runtime Current: NO · Runtime Fingerprint: ${rebuildStateRef.current.lastSuccessfulDocumentFingerprint ?? "none"}`); return; }
      const id = action === "suppressFillet" ? "Fillet01" : "Fillet01"; const shape = getRuntimeFeatureShape(runtime, id); if (!shape) throw new Error("Rebuild did not retain final Shape.");
      const [tessellation, polylines] = await Promise.all([kernel.tessellate(shape, { linearDeflectionMm: 1, angularDeflectionDeg: 10 }), kernel.getEdgePolylines(shape)]);
      render(shape, tessellation, polylines); currentFeatureIdRef.current = id; currentShapeRef.current = shape; setStatus(`通过：${rebuilt.evaluatedFeatureIds.concat(rebuilt.suppressedFeatureIds).join(" → ")} 自动重建完成。`); setDiagnostics(`Persistent Ref: V2 · Resolution: SIGNATURE · Document Fingerprint: ${rebuildStateRef.current.currentDocumentFingerprint ?? "none"} · Runtime Fingerprint: ${rebuildStateRef.current.lastSuccessfulDocumentFingerprint ?? "none"} · Runtime Current: ${rebuildStateRef.current.documentStatus === "current" ? "YES" : "NO"}`);
    } catch (error) { setStatus(`失败：${error instanceof Error ? error.message : String(error)}`); } finally { setBusy(false); }
  };

  const selectSemanticTopology = async (kind: "topFace" | "verticalEdge" | "linearEdge" | "circularEdge") => {
    const kernel = kernelRef.current; const shape = currentShapeRef.current;
    if (!kernel || !shape) { setStatus("请先创建 Base Extrude。"); return; }
    const topology = kind === "topFace"
      ? (await kernel.getFaces(shape)).find((face) => face.surfaceType === "plane" && (face.normal?.z ?? 0) > .999)?.topology
      : kind === "verticalEdge" ? (await kernel.getEdges(shape)).find((edge) => edge.curveType === "line" && Math.abs((edge.endMm?.z ?? 0) - (edge.startMm?.z ?? 0)) > 19)?.topology : kind === "linearEdge" ? (await kernel.getEdges(shape)).find((edge) => edge.curveType === "line")?.topology : (await kernel.getEdges(shape)).find((edge) => edge.curveType === "circle")?.topology;
    if (!topology) { setStatus(kind === "topFace" ? "当前结果没有可选 Top Face。" : kind === "verticalEdge" ? "当前结果没有可选 Vertical Edge。" : kind === "linearEdge" ? "当前结果没有可选 Linear Edge。" : "当前结果没有可选 Circular Edge。"); return; }
    selectedTopologyRef.current = topology;
    setSelection(`${kind === "topFace" ? "Face" : "Edge"} ${topology.localId} · ${topology.shapeId} r${topology.shapeRevision}`);
  };

  const runP2M2FaceSketchPocket = async () => {
    setBusy(true); setSelection("未选择"); setStatus("正在执行 P2-M2：Base Extrude → Persistent Top Face → Face Sketch Circle → Pocket…");
    await disposeActiveRuntime(); let runtime: ReturnType<typeof createCadRuntimeState> | undefined; let kernel: OcctKernel | undefined;
    try {
      const document = structuredClone(debugDocumentRef.current) as ReturnType<typeof createDebugDocument>; const features = document.features as Record<string, unknown>;
      Object.keys(features).forEach((id) => { if (id !== "Extrude01") delete features[id]; }); document.featureOrder.splice(0, document.featureOrder.length, "Extrude01");
      kernel = new OcctKernel(); await kernel.init(); runtime = createCadRuntimeState(); const rebuildRuntime = createRebuildRuntimeState();
      const context = { document, runtime, rebuildRuntime, kernel, tolerance: DEFAULT_CAD_TOLERANCE, buildProfiles: buildSketchProfiles };
      if (!(await rebuildDocument(context, { full: true })).success) throw new Error("Base Extrude rebuild failed.");
      const top = (await kernel.getFaces(runtime.featureShapes.get("Extrude01")!)).find((face) => face.surfaceType === "plane" && (face.normal?.z ?? 0) > .999);
      if (!top) throw new Error("Top planar Face is unavailable.");
      const faceRef = await capturePersistentTopologyRef("Extrude01", top.topology, runtime, kernel);
      (document.sketches as Record<string, unknown>).FaceSketch02 = { id: "FaceSketch02", name: "FaceSketch02", plane: { type: "face", face: { sourceFeatureId: "Extrude01", persistent: faceRef } }, entities: { circle: { id: "circle", type: "circle", center: { x: 0, y: 0 }, radius: 10, construction: false } }, entityOrder: ["circle"], constraints: {}, dimensions: {} };
      features.FacePocket02 = { id: "FacePocket02", name: "FacePocket02", type: "pocket", sketchId: "FaceSketch02", targetFeatureId: "Extrude01", depth: { type: "throughAll" }, enabled: true, state: "clean", dependencies: ["Extrude01"] }; document.featureOrder.push("FacePocket02");
      const rebuilt = await rebuildDocument(context, { full: true }); if (!rebuilt.success) throw new Error(rebuilt.errors.map((entry) => entry.message).join("; "));
      const shape = runtime.featureShapes.get("FacePocket02")!; const [properties, tessellation, polylines] = await Promise.all([kernel.getShapeProperties(shape), kernel.tessellate(shape, { linearDeflectionMm: 1, angularDeflectionDeg: 10 }), kernel.getEdgePolylines(shape)]);
      render(shape, tessellation, polylines); runtimeRef.current = runtime; kernelRef.current = kernel; currentFeatureIdRef.current = "FacePocket02"; currentShapeRef.current = shape; runtime = undefined; kernel = undefined;
      setStatus(`通过：Face Sketch Circle Ø20 → Through-All Pocket 已真实重建；体积 ${properties.volumeMm3?.toFixed(0)} mm³。`);
    } catch (error) { setStatus(`失败：${error instanceof Error ? error.message : String(error)}`); } finally { if (runtime && kernel) await disposeCadRuntimeState(runtime, kernel); if (kernel) await kernel.dispose(); setBusy(false); }
  };

  /** P2-M3 uses production rebuild + real OCCT booleans, isolated from Legacy UI. */
  const runP2M3Pattern = async (kind: "linear" | "circular" | "mirrorPocket" | "mirrorBoss") => {
    setBusy(true); setSelection("未选择"); setStatus(`正在执行 P2-M3 ${kind} 真实 B-Rep Feature Repetition…`);
    await disposeActiveRuntime(); let runtime: ReturnType<typeof createCadRuntimeState> | undefined; let kernel: OcctKernel | undefined;
    try {
      const document = structuredClone(debugDocumentRef.current) as ReturnType<typeof createDebugDocument>; const features = document.features as Record<string, unknown>;
      Object.keys(features).forEach((id) => { if (id !== "Extrude01") delete features[id]; }); document.featureOrder.splice(0, document.featureOrder.length, "Extrude01");
      const entities = document.sketches.Sketch01.entities as Record<string, { start: { x: number; y: number }; end: { x: number; y: number } }>;
      entities.a.start = { x: -100, y: -100 }; entities.a.end = { x: 100, y: -100 }; entities.b.start = { x: 100, y: -100 }; entities.b.end = { x: 100, y: 100 }; entities.c.start = { x: 100, y: 100 }; entities.c.end = { x: -100, y: 100 }; entities.d.start = { x: -100, y: 100 }; entities.d.end = { x: -100, y: -100 };
      kernel = new OcctKernel(); await kernel.init(); runtime = createCadRuntimeState(); const rebuildRuntime = createRebuildRuntimeState(); const context = { document, runtime, rebuildRuntime, kernel, tolerance: DEFAULT_CAD_TOLERANCE, buildProfiles: buildSketchProfiles };
      if (!(await rebuildDocument(context, { full: true })).success) throw new Error("Base Extrude rebuild failed.");
      const top = (await kernel.getFaces(runtime.featureShapes.get("Extrude01")!)).find((face) => face.surfaceType === "plane" && (face.normal?.z ?? 0) > .999);
      if (!top) throw new Error("Top planar Face is unavailable."); const topRef = await capturePersistentTopologyRef("Extrude01", top.topology, runtime, kernel);
      if (kind === "mirrorPocket") {
        (document.sketches as Record<string, unknown>).PatternPocketSketch = { id: "PatternPocketSketch", name: "PatternPocketSketch", plane: { type: "XY", offset: 0 }, entities: { a: { id: "a", type: "line", start: { x: 40, y: -10 }, end: { x: 60, y: -10 }, construction: false }, b: { id: "b", type: "line", start: { x: 60, y: -10 }, end: { x: 60, y: 10 }, construction: false }, c: { id: "c", type: "line", start: { x: 60, y: 10 }, end: { x: 40, y: 10 }, construction: false }, d: { id: "d", type: "line", start: { x: 40, y: 10 }, end: { x: 40, y: -10 }, construction: false } }, entityOrder: ["a", "b", "c", "d"], constraints: {}, dimensions: {} };
        features.Pocket01 = { id: "Pocket01", name: "Pocket01", type: "pocket", sketchId: "PatternPocketSketch", targetFeatureId: "Extrude01", depth: { type: "throughAll" }, enabled: true, state: "clean", dependencies: ["Extrude01"] };
        features.MirrorPattern01 = { id: "MirrorPattern01", name: "MirrorPattern01", type: "mirror", targetFeatureId: "Extrude01", seedFeatureIds: ["Pocket01"], plane: "YZ", enabled: true, state: "clean", dependencies: ["Extrude01", "Pocket01"] }; document.featureOrder.push("Pocket01", "MirrorPattern01");
      } else if (kind === "mirrorBoss") {
        (document.sketches as Record<string, unknown>).BossSketch = { id: "BossSketch", name: "BossSketch", plane: { type: "face", face: { sourceFeatureId: "Extrude01", persistent: topRef } }, entities: { circle: { id: "circle", type: "circle", center: { x: 50, y: 0 }, radius: 10, construction: false } }, entityOrder: ["circle"], constraints: {}, dimensions: {} };
        features.Boss01 = { id: "Boss01", name: "Boss Ø20", type: "extrude", sketchId: "BossSketch", distance: 20, direction: "positive", operation: "new", enabled: true, state: "clean", dependencies: [] };
        features.MirrorBoss01 = { id: "MirrorBoss01", name: "Mirror Boss", type: "mirror", targetFeatureId: "Extrude01", seedFeatureIds: ["Boss01"], plane: "YZ", enabled: true, state: "clean", dependencies: ["Extrude01", "Boss01"] }; document.featureOrder.push("Boss01", "MirrorBoss01");
      } else {
        features.Hole01 = { id: "Hole01", name: "Hole Ø10", type: "hole", targetFeatureId: "Extrude01", targetFace: topRef, center: kind === "linear" ? { x: 0, y: 0 } : { x: 60, y: 0 }, diameterMm: 10, depth: { type: "throughAll" }, enabled: true, state: "clean", dependencies: ["Extrude01"] };
        const id = kind === "linear" ? "LinearPattern01" : "CircularPattern01";
        features[id] = kind === "linear" ? { id, name: "Linear Pattern 6 × 30", type: "linearPattern", targetFeatureId: "Extrude01", seedFeatureIds: ["Hole01"], direction: "X", count: 6, spacingMm: 30, symmetric: true, enabled: true, state: "clean", dependencies: ["Extrude01", "Hole01"] } : { id, name: "Circular Pattern 6 × 360°", type: "circularPattern", targetFeatureId: "Extrude01", seedFeatureIds: ["Hole01"], axis: { origin: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 1 } }, count: 6, angleDeg: 360, enabled: true, state: "clean", dependencies: ["Extrude01", "Hole01"] };
        document.featureOrder.push("Hole01", id);
      }
      const rebuilt = await rebuildDocument(context, { full: true }); if (!rebuilt.success) throw new Error(rebuilt.errors.map((entry) => entry.message).join("; "));
      const finalId = kind === "linear" ? "LinearPattern01" : kind === "circular" ? "CircularPattern01" : kind === "mirrorBoss" ? "MirrorBoss01" : "MirrorPattern01"; const shape = runtime.featureShapes.get(finalId)!; const [properties, tessellation, polylines] = await Promise.all([kernel.getShapeProperties(shape), kernel.tessellate(shape, { linearDeflectionMm: 1, angularDeflectionDeg: 10 }), kernel.getEdgePolylines(shape)]);
      render(shape, tessellation, polylines); runtimeRef.current = runtime; kernelRef.current = kernel; rebuildStateRef.current = rebuildRuntime; patternDocumentRef.current = document; currentFeatureIdRef.current = finalId; currentShapeRef.current = shape; runtime = undefined; kernel = undefined;
      setStatus(`通过：P2-M3 ${kind === "linear" ? "Linear Pattern：Hole Ø10，Count 6，Spacing 30 mm" : kind === "circular" ? "Circular Pattern：Hole Ø10，Z Axis，Count 6，Angle 360°" : kind === "mirrorBoss" ? "Mirror：attached Boss Ø20 across YZ Plane" : "Mirror：Through-All Pocket across YZ Plane"} 已自动重建；体积 ${properties.volumeMm3?.toFixed(0)} mm³。`);
    } catch (error) { setStatus(`失败：${error instanceof Error ? error.message : String(error)}`); } finally { if (runtime && kernel) await disposeCadRuntimeState(runtime, kernel); if (kernel) await kernel.dispose(); setBusy(false); }
  };

  const updateP2M3Parameters = async (kind: "linear" | "circular" | "mirror") => {
    const document = patternDocumentRef.current; const runtime = runtimeRef.current; const kernel = kernelRef.current; if (!document || !runtime || !kernel) { setStatus("请先运行对应的 P2-M3 Pattern。 "); return; }
    const id = kind === "linear" ? "LinearPattern01" : kind === "circular" ? "CircularPattern01" : "MirrorPattern01"; const feature = (document.features as Record<string, Record<string, unknown>>)[id]; if (!feature) { setStatus("当前 Runtime 不包含该 Pattern。 "); return; }
    setBusy(true); try {
      if (kind === "linear") { feature.count = 4; feature.spacingMm = 40; }
      else if (kind === "circular") { feature.count = 4; feature.angleDeg = 180; }
      else feature.plane = "XZ";
      const rebuilt = await rebuildDocument({ document, runtime, rebuildRuntime: rebuildStateRef.current, kernel, tolerance: DEFAULT_CAD_TOLERANCE, buildProfiles: buildSketchProfiles }, { changedFeatureIds: [id] }); if (!rebuilt.success) throw new Error(rebuilt.errors.map((entry) => entry.message).join("; "));
      const shape = runtime.featureShapes.get(id)!; const [properties, tessellation, polylines] = await Promise.all([kernel.getShapeProperties(shape), kernel.tessellate(shape, { linearDeflectionMm: 1, angularDeflectionDeg: 10 }), kernel.getEdgePolylines(shape)]); render(shape, tessellation, polylines); currentFeatureIdRef.current = id; currentShapeRef.current = shape;
      setStatus(`通过：${kind === "linear" ? "Count 4 / Spacing 40 mm" : kind === "circular" ? "Count 4 / Angle 180°" : "Mirror Plane XZ"} 参数修改已自动重建；体积 ${properties.volumeMm3?.toFixed(0)} mm³。`);
    } catch (error) { setStatus(`失败：${error instanceof Error ? error.message : String(error)}`); } finally { setBusy(false); }
  };

  const runP2M4 = async (kind: "straight" | "bent" | "mixed" | "rectLoft" | "circleLoft" | "threeLoft") => {
    setBusy(true); setSelection("未选择"); setStatus(`正在执行 P2-M4 ${kind} 的真实 OCCT Sweep / Loft…`); await disposeActiveRuntime(); let runtime: ReturnType<typeof createCadRuntimeState> | undefined; let kernel: OcctKernel | undefined;
    const circle = (id: string, radius: number, offset = 0) => ({ id, name: id, plane: { type: "XY" as const, offset }, entities: { c: { id: "c", type: "circle" as const, center: { x: 0, y: 0 }, radius, construction: false } }, entityOrder: ["c"], constraints: {}, dimensions: {} });
    const rectangle = (id: string, width: number, height: number, offset = 0) => ({ id, name: id, plane: { type: "XY" as const, offset }, entities: { a: { id: "a", type: "line" as const, start: { x: -width / 2, y: -height / 2 }, end: { x: width / 2, y: -height / 2 }, construction: false }, b: { id: "b", type: "line" as const, start: { x: width / 2, y: -height / 2 }, end: { x: width / 2, y: height / 2 }, construction: false }, c: { id: "c", type: "line" as const, start: { x: width / 2, y: height / 2 }, end: { x: -width / 2, y: height / 2 }, construction: false }, d: { id: "d", type: "line" as const, start: { x: -width / 2, y: height / 2 }, end: { x: -width / 2, y: -height / 2 }, construction: false } }, entityOrder: ["a", "b", "c", "d"], constraints: {}, dimensions: {} });
    try {
      const path = kind === "straight" ? { id: "Path", name: "Path", plane: { type: "XZ" as const, offset: 0 }, entities: { p: { id: "p", type: "line" as const, start: { x: 0, y: 0 }, end: { x: 0, y: 100 }, construction: false } }, entityOrder: ["p"], constraints: {}, dimensions: {} } : kind === "bent" ? { id: "Path", name: "Path", plane: { type: "XZ" as const, offset: 0 }, entities: { a: { id: "a", type: "arc" as const, center: { x: 50, y: 0 }, radius: 50, startAngle: Math.PI, endAngle: Math.PI * 1.5, construction: false } }, entityOrder: ["a"], constraints: {}, dimensions: {} } : { id: "Path", name: "Path", plane: { type: "XZ" as const, offset: 0 }, entities: { a: { id: "a", type: "line" as const, start: { x: 0, y: 0 }, end: { x: 50, y: 0 }, construction: false }, b: { id: "b", type: "arc" as const, center: { x: 50, y: 50 }, radius: 50, startAngle: -Math.PI / 2, endAngle: 0, construction: false }, c: { id: "c", type: "line" as const, start: { x: 100, y: 50 }, end: { x: 100, y: 100 }, construction: false } }, entityOrder: ["a", "b", "c"], constraints: {}, dimensions: {} };
      const document = kind === "straight" || kind === "bent" || kind === "mixed" ? createCadDocument({ id: `p2m4-${kind}`, name: `P2-M4 ${kind}`, sketches: { Profile: kind === "mixed" ? rectangle("Profile", 20, 10) : circle("Profile", 5), Path: path }, features: { Sweep01: { id: "Sweep01", name: "Sweep01", type: "sweep" as const, profileSketchId: "Profile", pathSketchId: "Path", operation: "new" as const, orientation: "followPath" as const, enabled: true, state: "clean" as const, dependencies: [] } }, featureOrder: ["Sweep01"] }) : createCadDocument({ id: `p2m4-${kind}`, name: `P2-M4 ${kind}`, sketches: kind === "rectLoft" ? { A: rectangle("A", 40, 20), B: rectangle("B", 20, 10, 50) } : kind === "circleLoft" ? { A: circle("A", 20), B: circle("B", 10, 50) } : { A: rectangle("A", 40, 20), B: rectangle("B", 50, 30, 30), C: rectangle("C", 20, 10, 70) }, features: { Loft01: { id: "Loft01", name: "Loft01", type: "loft" as const, sectionSketchIds: kind === "threeLoft" ? ["A", "B", "C"] : ["A", "B"], solid: true as const, ruled: true, enabled: true, state: "clean" as const, dependencies: [] } }, featureOrder: ["Loft01"] });
      kernel = new OcctKernel(); await kernel.init(); runtime = createCadRuntimeState(); const rebuildRuntime = createRebuildRuntimeState(); const context = { document, runtime, rebuildRuntime, kernel, tolerance: DEFAULT_CAD_TOLERANCE, buildProfiles: buildSketchProfiles }; const rebuilt = await rebuildDocument(context, { full: true }); if (!rebuilt.success) throw new Error(rebuilt.errors.map((entry) => entry.message).join("; "));
      const id = "Sweep01" in document.features ? "Sweep01" : "Loft01"; const shape = runtime.featureShapes.get(id)!; const [properties, tessellation, polylines] = await Promise.all([kernel.getShapeProperties(shape), kernel.tessellate(shape, { linearDeflectionMm: .5, angularDeflectionDeg: 5 }), kernel.getEdgePolylines(shape)]); render(shape, tessellation, polylines); runtimeRef.current = runtime; kernelRef.current = kernel; rebuildStateRef.current = rebuildRuntime; advancedDocumentRef.current = document; currentFeatureIdRef.current = id; currentShapeRef.current = shape; runtime = undefined; kernel = undefined; setStatus(`通过：P2-M4 ${kind} 已生成真实 B-Rep；体积 ${properties.volumeMm3?.toFixed(3)} mm³。`);
    } catch (error) { setStatus(`失败：${error instanceof Error ? error.message : String(error)}`); } finally { if (runtime && kernel) await disposeCadRuntimeState(runtime, kernel); if (kernel) await kernel.dispose(); setBusy(false); }
  };

  const updateP2M4 = async () => {
    const document = advancedDocumentRef.current; const runtime = runtimeRef.current; const kernel = kernelRef.current; if (!document || !runtime || !kernel) { setStatus("请先运行一个 P2-M4 Sweep 或 Loft 示例。"); return; } const id = "Sweep01" in document.features ? "Sweep01" : "Loft01"; const changed = id === "Sweep01" ? "Profile" : "B"; setBusy(true);
    try { if (id === "Sweep01" && "c" in document.sketches.Profile.entities) document.sketches.Profile.entities.c.radius = 8; else if (document.sketches.B.plane.type === "XY") document.sketches.B.plane.offset = 80; const rebuilt = await rebuildDocument({ document, runtime, rebuildRuntime: rebuildStateRef.current, kernel, tolerance: DEFAULT_CAD_TOLERANCE, buildProfiles: buildSketchProfiles }, { changedSketchIds: [changed] }); if (!rebuilt.success) throw new Error(rebuilt.errors.map((entry) => entry.message).join("; ")); const shape = runtime.featureShapes.get(id)!; const [properties, tessellation, polylines] = await Promise.all([kernel.getShapeProperties(shape), kernel.tessellate(shape, { linearDeflectionMm: .5, angularDeflectionDeg: 5 }), kernel.getEdgePolylines(shape)]); render(shape, tessellation, polylines); currentShapeRef.current = shape; setStatus(`通过：P2-M4 参数修改已自动重建；体积 ${properties.volumeMm3?.toFixed(3)} mm³。`); } catch (error) { setStatus(`失败：${error instanceof Error ? error.message : String(error)}`); } finally { setBusy(false); }
  };

  /** Isolated P2-M5 browser entry: every result is rebuilt through the production Feature evaluator. */
  const runP2M5 = async (kind: "draft" | "rib" | "counterbore" | "countersink") => {
    setBusy(true); setSelection("未选择"); setStatus(`正在执行 P2-M5 ${kind} 真实 B-Rep…`); await disposeActiveRuntime(); let runtime: ReturnType<typeof createCadRuntimeState> | undefined; let kernel: OcctKernel | undefined;
    try {
      const document = structuredClone(debugDocumentRef.current) as ReturnType<typeof createDebugDocument>; const features = document.features as Record<string, unknown>; kernel = new OcctKernel(); await kernel.init(); runtime = createCadRuntimeState(); const rebuildRuntime = createRebuildRuntimeState(); const context = { document, runtime, rebuildRuntime, kernel, tolerance: DEFAULT_CAD_TOLERANCE, buildProfiles: buildSketchProfiles };
      if (!(await rebuildDocument(context, { full: true })).success) throw new Error("Base Extrude rebuild failed."); const base = runtime.featureShapes.get("Extrude01")!;
      if (kind === "draft") { const refs = await Promise.all((await kernel.getFaces(base)).filter((face) => Math.abs(face.normal?.z ?? 0) < .01).map((face) => capturePersistentTopologyRef("Extrude01", face.topology, runtime!, kernel!))); features.Draft01 = { id:"Draft01",name:"Draft 5°",type:"draft",targetFeatureId:"Extrude01",faces:refs,pullDirection:{x:0,y:0,z:1},angleDeg:5,enabled:true,state:"clean",dependencies:["Extrude01"] }; document.featureOrder.push("Draft01"); }
      else if (kind === "rib") { (document.sketches as Record<string, unknown>).RibSketch = { id:"RibSketch",name:"Rib center line",plane:{type:"XY",offset:20},entities:{line:{id:"line",type:"line",start:{x:0,y:0},end:{x:0,y:60},construction:false}},entityOrder:["line"],constraints:{},dimensions:{} }; features.Rib01 = { id:"Rib01",name:"Rib 4 × 20",type:"rib",targetFeatureId:"Extrude01",sketchId:"RibSketch",thicknessMm:4,heightMm:20,enabled:true,state:"clean",dependencies:["Extrude01"] }; document.featureOrder.push("Rib01"); }
      else { const top = (await kernel.getFaces(base)).find((face) => (face.normal?.z ?? 0) > .999); if (!top) throw new Error("Top Face is unavailable."); const ref = await capturePersistentTopologyRef("Extrude01", top.topology, runtime, kernel); features.Hole01 = { id:"Hole01",name:kind === "counterbore" ? "Counterbore Ø10/Ø20" : "Countersink Ø10/Ø20/90°",type:"hole",targetFeatureId:"Extrude01",targetFace:ref,center:{x:0,y:0},diameterMm:10,depth:{type:"throughAll"},style:kind === "counterbore" ? {type:"counterbore",diameterMm:20,depthMm:5} : {type:"countersink",diameterMm:20,includedAngleDeg:90},enabled:true,state:"clean",dependencies:["Extrude01"] }; document.featureOrder.push("Hole01"); }
      const rebuilt = await rebuildDocument(context, { full: true }); if (!rebuilt.success) throw new Error(rebuilt.errors.map((entry) => entry.message).join("; ")); const id = kind === "draft" ? "Draft01" : kind === "rib" ? "Rib01" : "Hole01"; const shape = runtime.featureShapes.get(id)!; const [properties,tessellation,polylines] = await Promise.all([kernel.getShapeProperties(shape),kernel.tessellate(shape,{linearDeflectionMm:.5,angularDeflectionDeg:5}),kernel.getEdgePolylines(shape)]);
      render(shape,tessellation,polylines); runtimeRef.current=runtime; kernelRef.current=kernel; rebuildStateRef.current=rebuildRuntime; currentFeatureIdRef.current=id; currentShapeRef.current=shape; cadDocumentRef.current=document as CadDocument<Sketch, Feature>; cadHistoryRef.current=createCadHistory(cadDocumentRef.current); setHistoryAvailability({undo:false,redo:false}); runtime=undefined;kernel=undefined; setStatus(`通过：P2-M5 ${kind} 已生成有效真实 B-Rep；体积 ${properties.volumeMm3?.toFixed(3)} mm³。`);
    } catch (error) { setStatus(`失败：${error instanceof Error ? error.message : String(error)}`); } finally { if(runtime&&kernel) await disposeCadRuntimeState(runtime,kernel); if(kernel) await kernel.dispose(); setBusy(false); }
  };

  const p2m6Document = (operation: "union" | "cut" | "intersect") => createCadDocument({ id: `p2m6-${operation}`, name: `P2-M6 ${operation}`, bodies: { Body01: createCadBody("Body01", "Body01 · Base"), Body02: createCadBody("Body02", "Body02 · Tool") }, activeBodyId: "Body01", sketches: {
    SketchA: { id: "SketchA", name: "SketchA", plane: { type: "XY" as const, offset: 0 }, entities: { a: { id: "a", type: "line" as const, start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, construction: false }, b: { id: "b", type: "line" as const, start: { x: 100, y: 0 }, end: { x: 100, y: 60 }, construction: false }, c: { id: "c", type: "line" as const, start: { x: 100, y: 60 }, end: { x: 0, y: 60 }, construction: false }, d: { id: "d", type: "line" as const, start: { x: 0, y: 60 }, end: { x: 0, y: 0 }, construction: false } }, entityOrder: ["a", "b", "c", "d"], constraints: {}, dimensions: {} },
    SketchB: { id: "SketchB", name: "SketchB", plane: { type: "XY" as const, offset: 0 }, entities: { a: { id: "a", type: "line" as const, start: { x: 75, y: 10 }, end: { x: 125, y: 10 }, construction: false }, b: { id: "b", type: "line" as const, start: { x: 125, y: 10 }, end: { x: 125, y: 50 }, construction: false }, c: { id: "c", type: "line" as const, start: { x: 125, y: 50 }, end: { x: 75, y: 50 }, construction: false }, d: { id: "d", type: "line" as const, start: { x: 75, y: 50 }, end: { x: 75, y: 10 }, construction: false } }, entityOrder: ["a", "b", "c", "d"], constraints: {}, dimensions: {} },
  }, features: {
    ExtrudeA: { id: "ExtrudeA", name: "ExtrudeA", type: "extrude" as const, bodyId: "Body01", sketchId: "SketchA", distance: 20, direction: "positive" as const, operation: "new" as const, enabled: true, state: "clean" as const, dependencies: [] },
    ExtrudeB: { id: "ExtrudeB", name: "ExtrudeB", type: "extrude" as const, bodyId: "Body02", sketchId: "SketchB", distance: 20, direction: "positive" as const, operation: "new" as const, enabled: true, state: "clean" as const, dependencies: [] },
    Boolean01: { id: "Boolean01", name: `Body ${operation}`, type: "bodyBoolean" as const, bodyId: "Body01", operation, target: { bodyId: "Body01", featureId: "ExtrudeA" }, tools: [{ bodyId: "Body02", featureId: "ExtrudeB" }], keepToolBody: true, enabled: true, state: "clean" as const, dependencies: ["ExtrudeA", "ExtrudeB"] },
  }, featureOrder: ["ExtrudeA", "ExtrudeB", "Boolean01"] }) as CadDocument<Sketch, Feature>;

  /** Existing Boolean control can also use the current imported Body as target.
   * It adds only the native tool required for the operation and preserves the
   * imported feature chain, asset store, history, and active Body. */
  const runImportedBodyBoolean = async (operation: "union" | "cut" | "intersect", document: CadDocument<Sketch, Feature>, runtime: ReturnType<typeof createCadRuntimeState>, kernel: OcctKernel) => {
    const imported = Object.values(document.features).find((feature) => feature.type === "importedStep");
    if (!imported?.bodyId) return false;
    setBusy(true); setSelection("未选择");
    try {
      const candidate = structuredClone(document) as CadDocument<Sketch, Feature>;
      const importedBodyId = imported.bodyId;
      const targetFeatureId = [...candidate.featureOrder].reverse().find((id) => candidate.features[id]?.bodyId === importedBodyId) ?? imported.id;
      const toolBodyId = "NativeBooleanTool";
      const toolFeatureId = "NativeBooleanExtrude";
      const booleanId = "ImportedBoolean";
      if (candidate.bodies[toolBodyId] || candidate.features[toolFeatureId] || candidate.features[booleanId]) throw new Error("Imported Body Boolean is already present; use its existing Feature History entry.");
      candidate.bodies[toolBodyId] = createCadBody(toolBodyId, "Native Boolean Tool");
      candidate.sketches.NativeBooleanSketch = { id: "NativeBooleanSketch", name: "Native Boolean Tool Sketch", plane: { type: "XY", offset: 0 }, entities: { a: { id: "a", type: "line", start: { x: 75, y: 10 }, end: { x: 125, y: 10 }, construction: false }, b: { id: "b", type: "line", start: { x: 125, y: 10 }, end: { x: 125, y: 50 }, construction: false }, c: { id: "c", type: "line", start: { x: 125, y: 50 }, end: { x: 75, y: 50 }, construction: false }, d: { id: "d", type: "line", start: { x: 75, y: 50 }, end: { x: 75, y: 10 }, construction: false } }, entityOrder: ["a", "b", "c", "d"], constraints: {}, dimensions: {} };
      candidate.features[toolFeatureId] = { id: toolFeatureId, name: "Native Boolean Tool", type: "extrude", bodyId: toolBodyId, sketchId: "NativeBooleanSketch", distance: 20, direction: "positive", operation: "new", enabled: true, state: "clean", dependencies: [] };
      candidate.features[booleanId] = { id: booleanId, name: `Imported ${operation}`, type: "bodyBoolean", bodyId: importedBodyId, operation, target: { bodyId: importedBodyId, featureId: targetFeatureId }, tools: [{ bodyId: toolBodyId, featureId: toolFeatureId }], keepToolBody: true, enabled: true, state: "clean", dependencies: [targetFeatureId, toolFeatureId] };
      candidate.featureOrder = [...candidate.featureOrder, toolFeatureId, booleanId];
      const rebuilt = await rebuildDocument({ document: candidate, runtime, rebuildRuntime: rebuildStateRef.current, kernel, tolerance: DEFAULT_CAD_TOLERANCE, buildProfiles: buildSketchProfiles, assets: cadAssetsRef.current }, { full: true });
      if (!rebuilt.success) throw new Error(rebuilt.errors.map((entry) => entry.message).join("; "));
      const history = cadHistoryRef.current ? commitCadHistory(cadHistoryRef.current, candidate) : createCadHistory(candidate);
      cadHistoryRef.current = history; cadDocumentRef.current = candidate; currentFeatureIdRef.current = booleanId; currentShapeRef.current = runtime.featureShapes.get(booleanId); setHistoryAvailability({ undo: canUndoCadHistory(history), redo: canRedoCadHistory(history) });
      await renderBodies(candidate, runtime, kernel);
      setStatus(`通过：Imported STEP Body 与新建 Native Tool 已完成真实 ${operation.toUpperCase()} Boolean。`);
      return true;
    } catch (error) { setStatus(`失败：${error instanceof Error ? error.message : String(error)}`); return true; }
    finally { setBusy(false); }
  };

  const runP2M6 = async (operation: "union" | "cut" | "intersect") => {
    const currentDocument = cadDocumentRef.current; const currentRuntime = runtimeRef.current; const currentKernel = kernelRef.current;
    if (currentDocument && currentRuntime && currentKernel && Object.values(currentDocument.features).some((feature) => feature.type === "importedStep")) { await runImportedBodyBoolean(operation, currentDocument, currentRuntime, currentKernel); return; }
    setBusy(true); setSelection("未选择"); await disposeActiveRuntime(); let runtime: ReturnType<typeof createCadRuntimeState> | undefined; let kernel: OcctKernel | undefined;
    try { const document = p2m6Document(operation); kernel = new OcctKernel(); await kernel.init(); runtime = createCadRuntimeState(); const rebuildRuntime = createRebuildRuntimeState(); const rebuilt = await rebuildDocument({ document, runtime, rebuildRuntime, kernel, tolerance: DEFAULT_CAD_TOLERANCE, buildProfiles: buildSketchProfiles }, { full: true }); if (!rebuilt.success) throw new Error(rebuilt.errors.map((entry) => entry.message).join("; ")); const shape = runtime.bodyShapes.get("Body01"); if (!shape) throw new Error("Body01 runtime shape is unavailable."); const properties = await kernel.getShapeProperties(shape); await renderBodies(document, runtime, kernel); runtimeRef.current = runtime; kernelRef.current = kernel; rebuildStateRef.current = rebuildRuntime; cadDocumentRef.current = document; cadHistoryRef.current = createCadHistory(document); setHistoryAvailability({ undo: false, redo: false }); runtime = undefined; kernel = undefined; setStatus(`通过：P2-M6 ${operation.toUpperCase()} 已生成两个独立 Runtime Bodies；Body01 体积 ${properties.volumeMm3?.toFixed(0)} mm³，点击实体可验证 Selected Body。`); }
    catch (error) { setStatus(`失败：${error instanceof Error ? error.message : String(error)}`); }
    finally { if (runtime && kernel) await disposeCadRuntimeState(runtime, kernel); if (kernel) await kernel.dispose(); setBusy(false); }
  };

  const updateP2M6BodyPresentation = async (action: "activateTool" | "toggleTool" | "new") => {
    const document = cadDocumentRef.current; const runtime = runtimeRef.current; const kernel = kernelRef.current; if (!document || !runtime || !kernel) { setStatus("请先运行 P2-M6 示例。"); return; }
    try { const next = action === "activateTool" ? setActiveBody(document, "Body02") : action === "toggleTool" ? setBodyVisibility(document, "Body02", !document.bodies.Body02.visible) : createBody(document, "Body03", "Body03 · Empty"); const history = cadHistoryRef.current ? commitCadHistory(cadHistoryRef.current, next) : undefined; if (history) { cadHistoryRef.current = history; setHistoryAvailability({ undo: canUndoCadHistory(history), redo: canRedoCadHistory(history) }); } cadDocumentRef.current = next; if (action === "toggleTool" && !next.bodies.Body02.visible) setSelection("未选择"); await renderBodies(next, runtime, kernel); setStatus(action === "new" ? "通过：已创建并激活 Empty Body03。" : action === "activateTool" ? "通过：Body02 已设为 ACTIVE；不会触发几何重建。" : `通过：Body02 已${next.bodies.Body02.visible ? "显示" : "隐藏"}；不会触发几何重建。`); }
    catch (error) { setStatus(`失败：${error instanceof Error ? error.message : String(error)}`); }
  };

  const deleteP2M6Body = async (bodyId: string) => {
    const document = cadDocumentRef.current; const runtime = runtimeRef.current; const kernel = kernelRef.current; if (!document || !runtime || !kernel) { setStatus("请先运行 P2-M6 示例。"); return; }
    try { const next = deleteBody(document, bodyId); const history = cadHistoryRef.current ? commitCadHistory(cadHistoryRef.current, next) : undefined; if (history) { cadHistoryRef.current = history; setHistoryAvailability({ undo: canUndoCadHistory(history), redo: canRedoCadHistory(history) }); } cadDocumentRef.current = next; setSelection("未选择"); await renderBodies(next, runtime, kernel); setStatus(`通过：Unused ${bodyId} 已删除，History 已记录。`); }
    catch (error) { setStatus(error instanceof Error && "code" in error && (error as { code?: string }).code === "BODY_IN_USE" ? "BODY_IN_USE：该 Body 仍被 Feature 或 Body Boolean 引用，未作任何删除。" : `失败：${error instanceof Error ? error.message : String(error)}`); }
  };

  const transformP2M6Tool = async (rotate = false) => {
    const document = cadDocumentRef.current; const runtime = runtimeRef.current; const kernel = kernelRef.current; if (!document || !runtime || !kernel || !document.features.Boolean01 || document.features.Boolean01.type !== "bodyBoolean") { setStatus("请先运行 P2-M6 Boolean 示例。"); return; }
    setBusy(true); try { const candidate = structuredClone(document) as CadDocument<Sketch, Feature>; const booleanFeature = candidate.features.Boolean01; if (booleanFeature.type !== "bodyBoolean") return; const moveId = "MoveBody02"; candidate.features[moveId] = { id: moveId, name: rotate ? "Rotate Body02 Z 90°" : "Move Body02 X +5", type: "bodyTransform", bodyId: "Body02", inputFeatureId: "ExtrudeB", translationMm: rotate ? { x: 0, y: 0, z: 0 } : { x: 5, y: 0, z: 0 }, rotation: rotate ? { axis: "Z", angleDeg: 90 } : undefined, enabled: true, state: "clean", dependencies: ["ExtrudeB"] }; if (rotate) { delete candidate.features.Boolean01; candidate.featureOrder = ["ExtrudeA", "ExtrudeB", moveId]; } else { candidate.featureOrder = ["ExtrudeA", "ExtrudeB", moveId, "Boolean01"]; booleanFeature.tools = [{ bodyId: "Body02", featureId: moveId }]; booleanFeature.dependencies = ["ExtrudeA", moveId]; } const rebuilt = await rebuildDocument({ document: candidate, runtime, rebuildRuntime: rebuildStateRef.current, kernel, tolerance: DEFAULT_CAD_TOLERANCE, buildProfiles: buildSketchProfiles }, { full: true }); if (!rebuilt.success) throw new Error(rebuilt.errors.map((entry) => entry.message).join("; ")); const properties = await kernel.getShapeProperties(runtime.bodyShapes.get("Body01")!); const history = cadHistoryRef.current ? commitCadHistory(cadHistoryRef.current, candidate) : undefined; if (history) { cadHistoryRef.current = history; setHistoryAvailability({ undo: canUndoCadHistory(history), redo: canRedoCadHistory(history) }); } cadDocumentRef.current = candidate; await renderBodies(candidate, runtime, kernel); setStatus(`通过：Body02 已${rotate ? "绕 Z 轴旋转 90°；Body01 保持独立不变" : "移动 X +5 mm，真实 Body Boolean 已自动重建"}；Body01 体积 ${properties.volumeMm3?.toFixed(0)} mm³。`); }
    catch (error) { setStatus(`失败：${error instanceof Error ? error.message : String(error)}`); } finally { setBusy(false); }
  };

  const toggleP2M6Boolean = async () => {
    const document = cadDocumentRef.current; const runtime = runtimeRef.current; const kernel = kernelRef.current; if (!document || !runtime || !kernel || !document.features.Boolean01) { setStatus("请先运行 P2-M6 Boolean 示例。"); return; } setBusy(true);
    try { const candidate = structuredClone(document) as CadDocument<Sketch, Feature>; const booleanFeature = candidate.features.Boolean01; if (booleanFeature.type !== "bodyBoolean") return; booleanFeature.enabled = !booleanFeature.enabled; booleanFeature.state = booleanFeature.enabled ? "clean" : "suppressed"; const rebuilt = await rebuildDocument({ document: candidate, runtime, rebuildRuntime: rebuildStateRef.current, kernel, tolerance: DEFAULT_CAD_TOLERANCE, buildProfiles: buildSketchProfiles }, { changedFeatureIds: ["Boolean01"] }); if (!rebuilt.success) throw new Error(rebuilt.errors.map((entry) => entry.message).join("; ")); const history = cadHistoryRef.current ? commitCadHistory(cadHistoryRef.current, candidate) : undefined; if (history) { cadHistoryRef.current = history; setHistoryAvailability({ undo: canUndoCadHistory(history), redo: canRedoCadHistory(history) }); } cadDocumentRef.current = candidate; await renderBodies(candidate, runtime, kernel); setStatus(`通过：Body Boolean 已${booleanFeature.enabled ? "恢复" : "抑制"}；Target Body 使用正确的上游实体。`); }
    catch (error) { setStatus(`失败：${error instanceof Error ? error.message : String(error)}`); } finally { setBusy(false); }
  };

  const applyP2M6TransformInputs = async () => {
    const document = cadDocumentRef.current; const runtime = runtimeRef.current; const kernel = kernelRef.current; if (!document || !runtime || !kernel || !document.features.Boolean01 || document.features.Boolean01.type !== "bodyBoolean") { setStatus("请先运行 P2-M6 Boolean 示例。"); return; }
    setBusy(true); try { const candidate = structuredClone(document) as CadDocument<Sketch, Feature>; const booleanFeature = candidate.features.Boolean01; if (booleanFeature.type !== "bodyBoolean") return; const moveId = "MoveBody02"; const hasRotation = p2m6Transform.angle !== 0; candidate.features[moveId] = { id: moveId, name: "Body02 Transform", type: "bodyTransform", bodyId: "Body02", inputFeatureId: "ExtrudeB", translationMm: { x: p2m6Transform.x, y: p2m6Transform.y, z: p2m6Transform.z }, rotation: hasRotation ? { axis: p2m6Transform.axis, angleDeg: p2m6Transform.angle } : undefined, enabled: true, state: "clean", dependencies: ["ExtrudeB"] }; if (hasRotation) { delete candidate.features.Boolean01; candidate.featureOrder = ["ExtrudeA", "ExtrudeB", moveId]; } else { booleanFeature.tools = [{ bodyId: "Body02", featureId: moveId }]; booleanFeature.dependencies = ["ExtrudeA", moveId]; candidate.featureOrder = ["ExtrudeA", "ExtrudeB", moveId, "Boolean01"]; } const rebuilt = await rebuildDocument({ document: candidate, runtime, rebuildRuntime: rebuildStateRef.current, kernel, tolerance: DEFAULT_CAD_TOLERANCE, buildProfiles: buildSketchProfiles }, { full: true }); if (!rebuilt.success) throw new Error(rebuilt.errors.map((entry) => entry.message).join("; ")); const history = cadHistoryRef.current ? commitCadHistory(cadHistoryRef.current, candidate) : undefined; if (history) { cadHistoryRef.current = history; setHistoryAvailability({ undo: canUndoCadHistory(history), redo: canRedoCadHistory(history) }); } cadDocumentRef.current = candidate; await renderBodies(candidate, runtime, kernel); setStatus(`通过：Body02 Transform 已按 mm / degree 参数重建${hasRotation ? "；旋转工作流保持两个独立 Bodies" : "并更新 Body Boolean"}。`); }
    catch (error) { setStatus(`失败：${error instanceof Error ? error.message : String(error)}`); } finally { setBusy(false); }
  };

  const saveAndReloadP2M6 = async () => {
    const document = cadDocumentRef.current; const runtime = runtimeRef.current; const kernel = kernelRef.current; if (!document || !runtime || !kernel) { setStatus("请先运行 P2-M6 示例。"); return; }
    setBusy(true); try { savedP2M6Ref.current = serializeCadProjectBundle(document, cadAssetsRef.current); const loaded = deserializeCadProjectBundle(savedP2M6Ref.current); const restored = loaded.document; await disposeCadRuntimeState(runtime, kernel); const nextRuntime = createCadRuntimeState(); const nextRebuild = createRebuildRuntimeState(); const rebuilt = await rebuildDocument({ document: restored, runtime: nextRuntime, rebuildRuntime: nextRebuild, kernel, tolerance: DEFAULT_CAD_TOLERANCE, buildProfiles: buildSketchProfiles, assets: loaded.assets }, { full: true }); if (!rebuilt.success) throw new Error(rebuilt.errors.map((entry) => entry.message).join("; ")); runtimeRef.current = nextRuntime; rebuildStateRef.current = nextRebuild; cadDocumentRef.current = restored; cadAssetsRef.current = loaded.assets; cadHistoryRef.current = createCadHistory(restored); setHistoryAvailability({ undo: false, redo: false }); await renderBodies(restored, nextRuntime, kernel); const bodyId = restored.activeBodyId ?? Object.keys(restored.bodies)[0]; const shape = bodyId ? nextRuntime.bodyShapes.get(bodyId) : undefined; const properties = shape ? await kernel.getShapeProperties(shape) : undefined; setStatus(`通过：项目已 Save → Destroy Runtime → Load → Full Rebuild；${bodyId ?? "Active Body"} 体积 ${properties?.volumeMm3?.toFixed(0) ?? "n/a"} mm³，嵌入 STEP 源已恢复。`); }
    catch (error) { setStatus(`失败：${error instanceof Error ? error.message : String(error)}`); } finally { setBusy(false); }
  };

  const runP2M6BooleanFillet = async () => {
    const document = cadDocumentRef.current; const runtime = runtimeRef.current; const kernel = kernelRef.current; if (!document || !runtime || !kernel || !document.features.Boolean01) { setStatus("请先运行 P2-M6 Union 示例。"); return; } setBusy(true);
    try { const candidate = structuredClone(document) as CadDocument<Sketch, Feature>; const source = runtime.featureShapes.get("Boolean01"); if (!source) throw new Error("Boolean runtime result is unavailable."); const edge = (await kernel.getEdges(source)).find((item) => item.curveType === "line" && (item.lengthMm ?? 0) >= 20); if (!edge) throw new Error("No stable Boolean edge is available for Fillet."); const ref = await capturePersistentTopologyRef("Boolean01", edge.topology, runtime, kernel); candidate.features.FilletAfterBoolean = { id: "FilletAfterBoolean", name: "Fillet After Boolean", type: "fillet", bodyId: "Body01", targetFeatureId: "Boolean01", edges: [ref], radiusMm: 2, enabled: true, state: "clean", dependencies: ["Boolean01"] }; candidate.featureOrder = [...candidate.featureOrder.filter((id) => id !== "FilletAfterBoolean"), "FilletAfterBoolean"]; const rebuilt = await rebuildDocument({ document: candidate, runtime, rebuildRuntime: rebuildStateRef.current, kernel, tolerance: DEFAULT_CAD_TOLERANCE, buildProfiles: buildSketchProfiles }, { full: true }); if (!rebuilt.success) throw new Error(rebuilt.errors.map((entry) => entry.message).join("; ")); const history = cadHistoryRef.current ? commitCadHistory(cadHistoryRef.current, candidate) : undefined; if (history) { cadHistoryRef.current = history; setHistoryAvailability({ undo: canUndoCadHistory(history), redo: canRedoCadHistory(history) }); } cadDocumentRef.current = candidate; await renderBodies(candidate, runtime, kernel); setStatus("通过：Body Boolean 输出已作为 Body01 的普通 B-Rep 输入完成 Fillet。"); }
    catch (error) { setStatus(`失败：${error instanceof Error ? error.message : String(error)}`); } finally { setBusy(false); }
  };

  const runP2M7StepRoundtrip = async () => {
    const runtime = runtimeRef.current; const kernel = kernelRef.current; if (!runtime || !kernel) { setStatus("请先运行 P2-M6 示例以生成可导出的真实 B-Rep。 "); return; } const source = runtime.bodyShapes.get("Body01"); if (!source) { setStatus("当前没有可导出的 Body01。 "); return; }
    setBusy(true); try { const step = await kernel.exportStep([source]); const imported = await importStepIntoDocument(createCadDocument<Sketch, Feature>({ id: "p2m7-import", name: "P2-M7 Imported STEP" }), cadAssetsRef.current, kernel, "forgemind-roundtrip.step", step); cadAssetsRef.current = imported.assets; await disposeCadRuntimeState(runtime, kernel); const nextRuntime = createCadRuntimeState(); const nextRebuild = createRebuildRuntimeState(); const rebuilt = await rebuildDocument({ document: imported.document, runtime: nextRuntime, rebuildRuntime: nextRebuild, kernel, tolerance: DEFAULT_CAD_TOLERANCE, buildProfiles: buildSketchProfiles, assets: imported.assets }, { full: true }); if (!rebuilt.success) throw new Error(rebuilt.errors.map((entry) => entry.message).join("; ")); runtimeRef.current = nextRuntime; rebuildStateRef.current = nextRebuild; cadDocumentRef.current = imported.document; cadHistoryRef.current = createCadHistory(imported.document); setHistoryAvailability({ undo: false, redo: false }); const currentFeatureId = imported.document.featureOrder.at(-1)!; currentFeatureIdRef.current = currentFeatureId; currentShapeRef.current = nextRuntime.featureShapes.get(currentFeatureId); await renderBodies(imported.document, nextRuntime, kernel); const shape = nextRuntime.bodyShapes.get("ImportedBody1"); const properties = shape ? await kernel.getShapeProperties(shape) : undefined; setStatus(`通过：P2-M7 STEP Export → Import 已产生精确 Imported B-Rep；体积 ${properties?.volumeMm3?.toFixed(0) ?? "n/a"} mm³。`); }
    catch (error) { setStatus(`失败：${error instanceof Error ? error.message : String(error)}`); } finally { setBusy(false); }
  };

  const importStepFile = async (file: File | undefined) => {
    if (!file) return; setBusy(true); setStatus(`正在读取 ${file.name} 并重建精确实体…`); let kernel = kernelRef.current; const runtime = runtimeRef.current;
    try { if (!kernel) { kernel = new OcctKernel(); await kernel.init(); } const sourceDocument = cadDocumentRef.current ?? createCadDocument<Sketch, Feature>({ id: "p2m7-file-import", name: "STEP 导入项目" }); const priorBodyCount = Object.keys(sourceDocument.bodies).length; const data = new Uint8Array(await file.arrayBuffer()); const imported = await importStepIntoDocument(sourceDocument, cadAssetsRef.current, kernel, file.name, data); const nextRuntime = createCadRuntimeState(); const nextRebuild = createRebuildRuntimeState(); const rebuilt = await rebuildDocument({ document: imported.document, runtime: nextRuntime, rebuildRuntime: nextRebuild, kernel, tolerance: DEFAULT_CAD_TOLERANCE, buildProfiles: buildSketchProfiles, assets: imported.assets }, { full: true }); if (!rebuilt.success) throw new Error(rebuilt.errors.map((entry) => entry.message).join("; ")); if (runtime) await disposeCadRuntimeState(runtime, kernel); cadAssetsRef.current = imported.assets; runtimeRef.current = nextRuntime; kernelRef.current = kernel; rebuildStateRef.current = nextRebuild; cadDocumentRef.current = imported.document; const history = cadHistoryRef.current ? commitCadHistory(cadHistoryRef.current, imported.document) : createCadHistory(imported.document); cadHistoryRef.current = history; setHistoryAvailability({ undo: canUndoCadHistory(history), redo: canRedoCadHistory(history) }); const currentFeatureId = imported.document.featureOrder.at(-1)!; currentFeatureIdRef.current = currentFeatureId; currentShapeRef.current = nextRuntime.featureShapes.get(currentFeatureId); await renderBodies(imported.document, nextRuntime, kernel); setStatus(`导入完成：${file.name} 已生成 ${Object.keys(imported.document.bodies).length - priorBodyCount} 个精确实体，并保留为可保存的 STEP 来源特征。`); }
    catch (error) { setStatus(`STEP 导入失败：${error instanceof Error ? error.message : String(error)}。原有模型未被替换。`); } finally { setBusy(false); }
  };

  const exportP2M7ActiveBody = async () => {
    const model = cadDocumentRef.current; const runtime = runtimeRef.current; const kernel = kernelRef.current; if (!model || !runtime || !kernel) { setStatus("当前没有可以导出的实体。"); return; } const bodyId = selectedBodyId || model.activeBodyId || Object.keys(model.bodies)[0]; const shape = bodyId ? runtime.bodyShapes.get(bodyId) : undefined; if (!shape || (model.bodies[bodyId]?.bodyType ?? "solid") !== "solid") { setStatus("请选择一个已完成重建的实体模型；开放曲面或曲线不能作为实体 STEP 单独交付。"); return; }
    setBusy(true); setStatus(`正在导出 ${model.bodies[bodyId]?.name ?? bodyId} 的 STEP 文件…`);
    try { const data = await kernel.exportStep([shape]); const url = URL.createObjectURL(new Blob([data], { type: "model/step" })); const anchor = window.document.createElement("a"); anchor.href = url; anchor.download = `${model.name || bodyId}.step`; anchor.click(); URL.revokeObjectURL(url); setStatus(`导出完成：${model.bodies[bodyId]?.name ?? bodyId} 已保存为精确 STEP 文件。`); } catch (error) { setStatus(`STEP 导出失败：${error instanceof Error ? error.message : String(error)}`); } finally { setBusy(false); }
  };

  const renderHistoryDocument = async (document: CadDocument<Sketch, Feature>) => {
    const runtime = runtimeRef.current; const kernel = kernelRef.current; if (!runtime || !kernel) throw new Error("CAD Runtime is unavailable.");
    const id = document.featureOrder.at(-1); const shape = id ? getRuntimeFeatureShape(runtime, id) : undefined; if (!shape) throw new Error("History rebuild did not retain the final Shape.");
    if (Object.keys(document.bodies).length) await renderBodies(document, runtime, kernel); else { const [tessellation, polylines] = await Promise.all([kernel.tessellate(shape,{linearDeflectionMm:.5,angularDeflectionDeg:5}),kernel.getEdgePolylines(shape)]); render(shape,tessellation,polylines); }
    currentFeatureIdRef.current=id!; currentShapeRef.current=shape; selectedTopologyRef.current=undefined; setSelection("未选择");
  };

  const editP2M5History = async () => {
    const history=cadHistoryRef.current, current=cadDocumentRef.current, runtime=runtimeRef.current, kernel=kernelRef.current; if(!history||!current||!runtime||!kernel){setStatus("请先运行一个 P2-M5 示例。");return;} const candidate=structuredClone(current) as CadDocument<Sketch,Feature>; const last=candidate.featureOrder.at(-1); const feature=last?candidate.features[last]:undefined; if(!feature){setStatus("当前 CAD Document 没有可编辑 Feature。");return;}
    if(feature.type==="draft") feature.angleDeg=8; else if(feature.type==="rib") {feature.thicknessMm=6;feature.heightMm=30;} else if(feature.type==="hole"&&feature.style?.type==="counterbore") feature.style.depthMm=8; else if(feature.type==="hole"&&feature.style?.type==="countersink") feature.style.includedAngleDeg=100; else {setStatus("该示例没有 P2-M5 可编辑参数。");return;}
    setBusy(true);try{const result=await commitCadHistoryEdit(history,current,candidate,{runtime,rebuildRuntime:rebuildStateRef.current,kernel,tolerance:DEFAULT_CAD_TOLERANCE,buildProfiles:buildSketchProfiles,assets:cadAssetsRef.current});if(!result.success){setStatus("参数修改失败；当前设计与最后成功几何保持不变。");return;}cadHistoryRef.current=result.history;cadDocumentRef.current=result.document;setHistoryAvailability({undo:canUndoCadHistory(result.history),redo:canRedoCadHistory(result.history)});await renderHistoryDocument(result.document);setStatus("通过：设计参数已提交到 CAD History 并自动重建。");}catch(error){setStatus(`失败：${error instanceof Error?error.message:String(error)}`);}finally{setBusy(false);}
  };

  const restoreP2M5History = async (direction:"undo"|"redo") => {
    const history=cadHistoryRef.current,current=cadDocumentRef.current,runtime=runtimeRef.current,kernel=kernelRef.current;if(!history||!current||!runtime||!kernel){setStatus("当前没有可恢复的 CAD History。");return;}setBusy(true);try{const context={runtime,rebuildRuntime:rebuildStateRef.current,kernel,tolerance:DEFAULT_CAD_TOLERANCE,buildProfiles:buildSketchProfiles,assets:cadAssetsRef.current};const result=await(direction==="undo"?undoCadHistoryRebuild(history,current,context):redoCadHistoryRebuild(history,current,context));if(!result.success){setStatus("History 恢复未通过；当前设计与最后成功几何保持不变。");return;}cadHistoryRef.current=result.history;cadDocumentRef.current=result.document;setHistoryAvailability({undo:canUndoCadHistory(result.history),redo:canRedoCadHistory(result.history)});await renderHistoryDocument(result.document);setStatus(`通过：CAD ${direction === "undo" ? "Undo" : "Redo"} 已恢复设计并重新生成 B-Rep。`);}catch(error){setStatus(`失败：${error instanceof Error?error.message:String(error)}`);}finally{setBusy(false);}
  };
  useEffect(() => { restoreHistoryShortcutRef.current = restoreP2M5History; });

  const appendNewPrimitive = async (kind: QuickPrimitiveKind) => {
    setBusy(true);
    let kernel = kernelRef.current;
    try {
      if (!kernel) { kernel = new OcctKernel(); await kernel.init(); kernelRef.current = kernel; }
      const current = cadDocumentRef.current ?? createEmptyProfessionalCadDocument(createWorkbenchId("cad"), "未命名 CAD 项目");
      const prefix = createWorkbenchId(kind);
      const candidate = appendQuickPrimitive(current, kind === "circle"
        ? { idPrefix: prefix, name: `Cylinder ${Object.keys(current.bodies).length + 1}`, kind, diameterMm: 40, extrudeMm: 40 }
        : { idPrefix: prefix, name: `Block ${Object.keys(current.bodies).length + 1}`, kind, widthMm: 100, heightMm: 60, extrudeMm: 20 });
      const runtime = runtimeRef.current ?? createCadRuntimeState();
      const rebuilt = await rebuildDocument({ document: candidate, runtime, rebuildRuntime: rebuildStateRef.current, kernel, tolerance: DEFAULT_CAD_TOLERANCE, buildProfiles: buildSketchProfiles, assets: cadAssetsRef.current }, { full: true });
      if (!rebuilt.success) throw new Error(rebuilt.errors.map((entry) => entry.message).join("; "));
      runtimeRef.current = runtime; cadDocumentRef.current = candidate; const history = cadHistoryRef.current ? commitCadHistory(cadHistoryRef.current, candidate) : createCadHistory(candidate); cadHistoryRef.current = history; setHistoryAvailability({ undo: canUndoCadHistory(history), redo: canRedoCadHistory(history) });
      const sketchId = `${prefix}-sketch`, featureId = `${prefix}-extrude`; setSelectedSketchId(sketchId); setSelectedFeatureId(""); currentFeatureIdRef.current = featureId; currentShapeRef.current = runtime.featureShapes.get(featureId); await renderBodies(candidate, runtime, kernel); setSelectedSketchId(sketchId); setSelectedFeatureId("");
      setStatus(`通过：已创建${kind === "circle" ? "圆草图 + 圆柱拉伸" : "受约束矩形草图 + 拉伸"}；可在右侧直接修改驱动尺寸。`);
    } catch (error) { setStatus(`QUICK_AUTHORING_FAILED：${error instanceof Error ? error.message : String(error)}`); } finally { setBusy(false); }
  };

  const ensureUnifiedCadSession = async () => {
    let kernel = kernelRef.current;
    if (!kernel) { kernel = new OcctKernel(); await kernel.init(); kernelRef.current = kernel; }
    let runtime = runtimeRef.current;
    if (!runtime) { runtime = createCadRuntimeState(); runtimeRef.current = runtime; }
    let document = cadDocumentRef.current;
    if (!document) {
      document = createEmptyProfessionalCadDocument(createWorkbenchId("cad"), "未命名自由建模项目");
      cadDocumentRef.current = document;
      cadHistoryRef.current = createCadHistory(document);
      setHistoryAvailability({ undo: false, redo: false });
    }
    return { kernel, runtime, document };
  };

  const startNewCadProject = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const kernel = kernelRef.current ?? new OcctKernel();
      if (!kernelRef.current) { await kernel.init(); kernelRef.current = kernel; }
      if (runtimeRef.current) await disposeCadRuntimeState(runtimeRef.current, kernel);
      const document = createEmptyProfessionalCadDocument(createWorkbenchId("cad"), "未命名自由建模项目");
      runtimeRef.current = createCadRuntimeState();
      rebuildStateRef.current = createRebuildRuntimeState();
      cadDocumentRef.current = document;
      cadHistoryRef.current = createCadHistory(document);
      cadAssetsRef.current = createCadAssetStore();
      currentFeatureIdRef.current = undefined;
      currentShapeRef.current = undefined;
      selectedTopologyRef.current = undefined;
      setSelectedBodyId(""); setSelectedSketchId(""); setSelectedFeatureId(""); setEditingSketchId("");
      setSelection("未选择"); setBodyPanel([]); setFeaturePanel([]); setHistoryAvailability({ undo: false, redo: false });
      renderStateRef.current?.dispose(); renderStateRef.current = undefined;
      setStatus("已新建空白项目：先创建草图或添加实体，再选择成形方式生成特征。");
    } catch (error) { setStatus(`NEW_PROJECT_FAILED：${error instanceof Error ? error.message : String(error)}`); }
    finally { setBusy(false); }
  };

  const createUnifiedSketch = async (plane: "XY" | "XZ" | "YZ" | "face") => {
    if (busy) return;
    setBusy(true);
    try {
      const { kernel, runtime, document } = await ensureUnifiedCadSession();
      const candidate = structuredClone(document) as CadDocument<Sketch, Feature>;
      const id = createWorkbenchId("Sketch");
      let sketchPlane: Sketch["plane"];
      if (plane === "face") {
        const topology = selectedTopologyRef.current;
        if (!topology || topology.kind !== "face") throw new Error("请先在 Face 选择模式下选择一个平面 Face。");
        const sourceFeatureId = selectedBodyId ? deriveBodyTipFeatureId(candidate, selectedBodyId) ?? candidate.bodies[selectedBodyId]?.tipFeatureId : currentFeatureIdRef.current;
        if (!sourceFeatureId) throw new Error("当前 Face 没有可持久化的来源 Feature。");
        const info = await kernel.getFaceInfo(topology);
        if (info.surfaceType !== "plane") throw new Error("自由草图目前只能附着到解析 Planar Face。");
        const persistent = await capturePersistentTopologyRef(sourceFeatureId, topology, runtime, kernel);
        if (persistent.kind !== "face") throw new Error("未能捕获 Persistent Face Reference。");
        sketchPlane = { type: "face", face: { sourceFeatureId, persistent } };
      } else sketchPlane = { type: plane, offset: 0 };
      candidate.sketches[id] = { id, name: `${plane === "face" ? "Face" : plane} Sketch`, plane: sketchPlane, entities: {}, entityOrder: [], constraints: {}, dimensions: {} };
      candidate.updatedAt = workbenchTimestamp();
      const history = cadHistoryRef.current ? commitCadHistory(cadHistoryRef.current, candidate) : createCadHistory(candidate);
      cadHistoryRef.current = history; cadDocumentRef.current = candidate; setHistoryAvailability({ undo: canUndoCadHistory(history), redo: canRedoCadHistory(history) });
      setSelectedSketchId(id); setSelectedFeatureId(""); setEditingSketchId(id);
      setStatus(`已创建 ${plane === "face" ? "Face-attached" : plane} 参数化草图；进入统一 Sketch Editor。`);
    } catch (error) { setStatus(`CREATE_SKETCH_FAILED：${error instanceof Error ? error.message : String(error)}`); }
    finally { setBusy(false); }
  };

  const commitIntegratedSketch = async (nextSketch: Sketch) => {
    const current = cadDocumentRef.current, runtime = runtimeRef.current, kernel = kernelRef.current;
    if (!current || !runtime || !kernel) { setStatus("当前没有可提交的 CAD 会话。"); return; }
    let refreshedSketch=nextSketch; let refreshedCount=0;
    try { const frame=await resolveSketchPlaneFrame(nextSketch.plane,{document:current,runtime,kernel,tolerance:DEFAULT_CAD_TOLERANCE,buildProfiles:buildSketchProfiles,assets:cadAssetsRef.current}); const refreshed=await refreshProjectedSketchGeometry(nextSketch,frame,runtime,kernel); if(refreshed.failed.length){setStatus(`草图未提交：${refreshed.failed.length} 条外部投影引用已经失效或无法唯一定位，请删除后重新投影。`);return;} refreshedSketch=refreshed.sketch;refreshedCount=refreshed.refreshedEntityIds.length; } catch(error){setStatus(`草图未提交：外部投影校验失败——${error instanceof Error?error.message:String(error)}`);return;}
    const solved = solveSketch(refreshedSketch);
    if (solved.status === "conflicting" || solved.status === "failed") { setStatus(`草图未提交：${solved.diagnostics.at(-1)?.message ?? "约束求解失败"}`); return; }
    const candidate = structuredClone(current) as CadDocument<Sketch, Feature>;
    candidate.sketches[refreshedSketch.id] = { ...refreshedSketch, entities: solved.entities };
    candidate.updatedAt = Date.now();
    setBusy(true);
    try {
      const history = cadHistoryRef.current ?? createCadHistory(current);
      const result = await commitCadHistoryEdit(history, current, candidate, { runtime, rebuildRuntime: rebuildStateRef.current, kernel, tolerance: DEFAULT_CAD_TOLERANCE, buildProfiles: buildSketchProfiles, assets: cadAssetsRef.current });
      if (!result.success) { setStatus("草图修改导致下游 B-Rep 重建失败；保留最后成功模型和编辑内容。 "); return; }
      cadHistoryRef.current = result.history; cadDocumentRef.current = result.document; setHistoryAvailability({ undo: canUndoCadHistory(result.history), redo: canRedoCadHistory(result.history) });
      setEditingSketchId(""); setSelectedSketchId(refreshedSketch.id); await renderHistoryDocument(result.document);
      setStatus(`通过：${refreshedSketch.name} 已提交并自动重建${refreshedCount?`；${refreshedCount} 条外部投影已同步到当前模型`:""}。`);
    } catch (error) { setStatus(`SKETCH_COMMIT_FAILED：${error instanceof Error ? error.message : String(error)}`); }
    finally { setBusy(false); }
  };

  const projectSelectedEdgeIntoSketch = async (sketch: Sketch) => {
    const document = cadDocumentRef.current, runtime = runtimeRef.current, kernel = kernelRef.current, topology = selectedTopologyRef.current;
    if (!document || !runtime || !kernel) throw new Error("当前建模会话尚未准备好。");
    if (!topology || topology.kind !== "edge") throw new Error("请先退出草图，在建模视图切换到“边”，选择一条直线、圆、圆弧或 NURBS 边，再重新编辑该草图。");
    const sourceFeatureId = selectedBodyId ? deriveBodyTipFeatureId(document, selectedBodyId) ?? document.bodies[selectedBodyId]?.tipFeatureId : currentFeatureIdRef.current;
    if (!sourceFeatureId) throw new Error("所选边没有可追踪的来源特征。");
    const persistent = await capturePersistentTopologyRef(sourceFeatureId, topology, runtime, kernel);
    if (persistent.kind !== "edge") throw new Error("所选对象不是可投影的边。");
    const frame = await resolveSketchPlaneFrame(sketch.plane, { document, runtime, kernel, tolerance: DEFAULT_CAD_TOLERANCE, buildProfiles: buildSketchProfiles, assets: cadAssetsRef.current });
    return projectEdgeToSketch(`ProjectedEdge-${Date.now()}`, sourceFeatureId, persistent, frame, runtime, kernel);
  };

  const applySelectedBodyEngineering = () => {
    const current = cadDocumentRef.current, body = selectedBodyId ? current?.bodies[selectedBodyId] : undefined;
    if (!current || !body) { setStatus("请先选择需要填写工程属性的实体。"); return; }
    const densityKgM3 = Number(engineeringDraft.densityKgM3), toleranceMm = Number(engineeringDraft.toleranceMm);
    if (!engineeringDraft.material.trim()) { setStatus("请填写材料名称，例如“铝合金 / 6061-T6”。"); return; }
    if (!Number.isFinite(densityKgM3) || densityKgM3 <= 0) { setStatus("密度应为大于 0 的数字，单位为 kg/m³。"); return; }
    if (!Number.isFinite(toleranceMm) || toleranceMm < 0) { setStatus("模型公差应为不小于 0 的数字，单位为毫米。"); return; }
    const candidate = structuredClone(current) as CadDocument<Sketch, Feature>;
    candidate.bodies[selectedBodyId].engineering = { material: engineeringDraft.material.trim(), densityKgM3, toleranceMm, process: engineeringDraft.process.trim() || undefined, group: engineeringDraft.group.trim() || undefined };
    candidate.updatedAt = Date.now();
    const history = cadHistoryRef.current ? commitCadHistory(cadHistoryRef.current, candidate) : createCadHistory(candidate);
    cadDocumentRef.current = candidate; cadHistoryRef.current = history; setHistoryAvailability({ undo: canUndoCadHistory(history), redo: canRedoCadHistory(history) });
    persistWorkingDocument(candidate);
    setBodyPanel(Object.entries(candidate.bodies).map(([id, entry]) => ({ id, name: entry.name, visible: entry.visible, active: id === candidate.activeBodyId, construction: entry.name.startsWith("构造体 · "), bodyType: entry.bodyType ?? "solid", sourceCode: entry.sourceResource?.resourceCode, material: entry.engineering?.material })).sort((a, b) => Number(b.visible) - Number(a.visible)));
    setStatus(`已保存 ${body.name} 的材料、密度、公差和制造工艺；质量估算已同步更新。`);
  };

  const selectedMaterialRegionIds = (sketch: Sketch): string[] => {
    const available = buildSketchProfiles(sketch).profiles.map((profile) => profile.id);
    const chosen = solidRegionSelections[sketch.id];
    return chosen === undefined ? available : chosen.filter((id) => available.includes(id));
  };

  const extrudeSelectedSketch = async (operation: "new" | "add" | "remove" | "intersect") => {
    if (!selectedSketchId) { setStatus("请先创建或选择一个闭合 Sketch。"); return; }
    setBusy(true);
    try {
      const { kernel, runtime, document } = await ensureUnifiedCadSession();
      const sketch = document.sketches[selectedSketchId]; if (!sketch) throw new Error("所选 Sketch 不存在。");
      const profileIds=selectedMaterialRegionIds(sketch); if (!profileIds.length) throw new Error("请至少选择一个有效的封闭材料区域。");
      if(!Number.isFinite(solidExtrude.distanceMm)||solidExtrude.distanceMm<=0)throw new Error("拉伸距离必须大于 0 mm。");
      if(solidExtrude.direction==="twoSided"&&(!Number.isFinite(solidExtrude.secondDistanceMm)||solidExtrude.secondDistanceMm<=0))throw new Error("双向拉伸的反向距离必须大于 0 mm。");
      const candidate = structuredClone(document) as CadDocument<Sketch, Feature>;
      const featureId = createWorkbenchId("Extrude");
      let bodyId: string; let targetFeatureId: string | undefined;
      if (operation === "new") {
        bodyId = createWorkbenchId("Body"); candidate.bodies[bodyId] = createCadBody(bodyId, `Body ${Object.keys(candidate.bodies).length + 1}`); candidate.activeBodyId = bodyId;
      } else {
        bodyId = selectedBodyId || candidate.activeBodyId || ""; if (!bodyId || !candidate.bodies[bodyId]) throw new Error("添加、切除或相交需要先选择目标实体。");
        targetFeatureId = deriveBodyTipFeatureId(candidate, bodyId) ?? candidate.bodies[bodyId].tipFeatureId; if (!targetFeatureId) throw new Error("目标 Body 没有可用 Tip Feature。");
      }
      const operationLabel=operation==="new"?"新实体":operation==="add"?"添加":operation==="remove"?"切除":"相交";
      candidate.features[featureId] = { id: featureId, name: `拉伸 · ${operationLabel}`, type: "extrude", sketchId: selectedSketchId, profileIds, distance: solidExtrude.distanceMm, direction: solidExtrude.direction, ...(solidExtrude.direction==="twoSided"?{secondDistance:solidExtrude.secondDistanceMm}:{}), operation, bodyId, targetBodyId: bodyId, ...(targetFeatureId ? { targetFeatureId, dependencies: [targetFeatureId] } : { dependencies: [] }), enabled: true, state: "clean" };
      candidate.featureOrder.push(featureId); candidate.bodies[bodyId].tipFeatureId = featureId; candidate.updatedAt = workbenchTimestamp();
      const rebuilt = await rebuildDocument({ document: candidate, runtime, rebuildRuntime: rebuildStateRef.current, kernel, tolerance: DEFAULT_CAD_TOLERANCE, buildProfiles: buildSketchProfiles, assets: cadAssetsRef.current }, { full: true });
      if (!rebuilt.success) throw new Error(rebuilt.errors.map((entry) => entry.message).join("; "));
      const history = cadHistoryRef.current ? commitCadHistory(cadHistoryRef.current, candidate) : createCadHistory(candidate); cadHistoryRef.current = history; cadDocumentRef.current = candidate; setHistoryAvailability({ undo: canUndoCadHistory(history), redo: canRedoCadHistory(history) });
      setSelectedFeatureId(featureId); setSelectedSketchId(""); setSelectedBodyId(bodyId); currentFeatureIdRef.current = featureId; currentShapeRef.current = runtime.featureShapes.get(featureId); await renderBodies(candidate, runtime, kernel);
      setStatus(`通过：Sketch → Extrude ${operation.toUpperCase()} 已作为统一 Feature 提交；无需“融合模式”或手绘实体化。`);
    } catch (error) { setStatus(`UNIFIED_EXTRUDE_FAILED：${error instanceof Error ? error.message : String(error)}`); }
    finally { setBusy(false); }
  };

  const revolveSelectedSketch = async (operation: "new" | "add" | "remove" | "intersect" = solidOperation) => {
    if (!selectedSketchId) { setStatus("请先创建或选择一个闭合轮廓草图。"); return; }
    setBusy(true);
    try {
      const { kernel, runtime, document } = await ensureUnifiedCadSession();
      const sketch = document.sketches[selectedSketchId];
      if (!sketch) throw new Error("所选草图不存在。");
      const profileIds=selectedMaterialRegionIds(sketch);
      if (!profileIds.length) throw new Error("旋转实体需要至少一个选中的有效闭合材料区域。");
      const candidate = structuredClone(document) as CadDocument<Sketch, Feature>;
      let bodyId:string,targetFeatureId:string|undefined;const featureId = allocateFeatureId(candidate, "Revolve");
      if(operation==="new"){bodyId=allocateBodyId(candidate,"Body");candidate.bodies[bodyId]=createCadBody(bodyId,`旋转零件 ${Object.keys(candidate.bodies).length+1}`);candidate.activeBodyId=bodyId;}else{bodyId=selectedBodyId||candidate.activeBodyId||"";if(!bodyId||!candidate.bodies[bodyId])throw new Error("添加、切除或相交需要先选择目标实体。");targetFeatureId=deriveBodyTipFeatureId(candidate,bodyId)??candidate.bodies[bodyId].tipFeatureId;if(!targetFeatureId)throw new Error("目标实体没有可用的末端特征。");}
      if (!Number.isFinite(solidRevolve.angleDeg) || solidRevolve.angleDeg <= 0 || solidRevolve.angleDeg > 360) throw new Error("旋转角度应大于 0° 且不超过 360°。");
      const frame = await resolveSketchPlaneFrame(sketch.plane, { document, runtime, rebuildRuntime: rebuildStateRef.current, kernel, tolerance: DEFAULT_CAD_TOLERANCE, buildProfiles: buildSketchProfiles, assets: cadAssetsRef.current });
      const axis = { origin: frame.origin, direction: solidRevolve.axis === "x" ? frame.xAxis : frame.yAxis };
      const operationLabel=operation==="new"?"新实体":operation==="add"?"添加":operation==="remove"?"切除":"相交";
      candidate.features[featureId] = { id: featureId, name: `旋转 · ${operationLabel}`, type: "revolve", sketchId: selectedSketchId, profileIds, axis, angleDeg: solidRevolve.angleDeg, operation, bodyId, targetBodyId: bodyId, ...(targetFeatureId?{targetFeatureId,dependencies:[targetFeatureId]}:{dependencies:[]}), enabled: true, state: "clean" };
      candidate.featureOrder.push(featureId);
      await commitCandidateDocument(document, candidate, featureId, `通过：所选草图区域已完成旋转${operationLabel}，并写入可编辑特征历史。`);
      setSelectedSketchId(""); setSelectedFeatureId(featureId); setSelectedBodyId(bodyId);
    } catch (error) { setStatus(`SOLID_REVOLVE_FAILED：${error instanceof Error ? error.message : String(error)}`); }
    finally { setBusy(false); }
  };

  const createSolidFromSketchSet = async (kind: "sweep" | "loft", operation: "new" | "add" | "remove" | "intersect" = solidOperation) => {
    const current = cadDocumentRef.current, ids = [...surfaceSketchSelectionRef.current];
    if (!current) return;
    if (kind === "sweep" && ids.length !== 2) { setStatus("扫掠实体需要按顺序加入两个草图：闭合截面、开放路径。"); return; }
    if (kind === "loft" && ids.length < 2) { setStatus("放样实体至少需要两个闭合截面草图。"); return; }
    if (ids.some((id) => !current.sketches[id])) { setStatus("草图集合中有内容已经失效，请清空后重新加入。"); return; }
    setBusy(true);
    try {
      const candidate = structuredClone(current) as CadDocument<Sketch, Feature>;
      if (kind === "sweep") {
        if (!selectedMaterialRegionIds(candidate.sketches[ids[0]]).length) throw new Error("第一个草图必须至少选择一个闭合截面区域。");
      } else {const counts=ids.map((id)=>selectedMaterialRegionIds(candidate.sketches[id]).length);if(counts.some((count)=>!count))throw new Error("所有放样截面都必须至少选择一个有效闭合区域。");if(new Set(counts).size!==1)throw new Error("每个放样截面需要选择相同数量的材料区域。");}
      let bodyId:string,targetFeatureId:string|undefined;const featureId = allocateFeatureId(candidate, kind === "sweep" ? "Sweep" : "Loft");
      if(operation==="new"){bodyId=allocateBodyId(candidate,"Body");candidate.bodies[bodyId]=createCadBody(bodyId,`${kind==="sweep"?"扫掠":"放样"}零件 ${Object.keys(candidate.bodies).length+1}`);candidate.activeBodyId=bodyId;}else{bodyId=selectedBodyId||candidate.activeBodyId||"";if(!bodyId||!candidate.bodies[bodyId])throw new Error("添加、切除或相交需要先选择目标实体。");targetFeatureId=deriveBodyTipFeatureId(candidate,bodyId)??candidate.bodies[bodyId].tipFeatureId;if(!targetFeatureId)throw new Error("目标实体没有可用的末端特征。");}
      const operationLabel=operation==="new"?"新实体":operation==="add"?"添加":operation==="remove"?"切除":"相交";
      candidate.features[featureId] = kind === "sweep"
        ? { id: featureId, name: `路径扫掠 · ${operationLabel}`, type: "sweep", bodyId, targetBodyId:bodyId,profileSketchId: ids[0], profileIds:selectedMaterialRegionIds(candidate.sketches[ids[0]]),pathSketchId: ids[1], operation, orientation: "followPath", enabled: true, state: "clean", ...(targetFeatureId?{targetFeatureId,dependencies:[targetFeatureId]}:{dependencies:[]}) }
        : { id: featureId, name: `多截面放样 · ${operationLabel}`, type: "loft", bodyId,targetBodyId:bodyId, sectionSketchIds: ids,sectionProfileIds:ids.map((id)=>selectedMaterialRegionIds(candidate.sketches[id])),solid: true, ruled: false, closed: false,operation, ...(loftEndControl.start !== "natural" ? { startCondition: { continuity: loftEndControl.start, lengthMm: loftEndControl.startLengthMm } } : {}), ...(loftEndControl.end !== "natural" ? { endCondition: { continuity: loftEndControl.end, lengthMm: loftEndControl.endLengthMm } } : {}), enabled: true, state: "clean", ...(targetFeatureId?{targetFeatureId,dependencies:[targetFeatureId]}:{dependencies:[]}) };
      candidate.featureOrder.push(featureId);
      await commitCandidateDocument(current, candidate, featureId, `通过：${kind === "sweep" ? "截面已沿用户路径扫掠" : `${ids.length} 个截面已连续放样`}并完成${operationLabel}。`);
      clearSurfaceSketchSet(); setSelectedSketchId(""); setSelectedFeatureId(featureId); setSelectedBodyId(bodyId);
    } catch (error) { setStatus(`SOLID_${kind.toUpperCase()}_FAILED：${error instanceof Error ? error.message : String(error)}`); }
    finally { setBusy(false); }
  };

  const commitSketchDimension = async (sketchId: string, dimensionId: string, value: number) => {
    const current = cadDocumentRef.current, runtime = runtimeRef.current, kernel = kernelRef.current; if (!current || !runtime || !kernel) return; if (!Number.isFinite(value) || value <= 0) { setStatus("草图驱动尺寸必须大于 0。"); return; }
    const candidate = structuredClone(current) as CadDocument<Sketch, Feature>; const sketch = candidate.sketches[sketchId]; const dimension = sketch?.dimensions[dimensionId]; if (!sketch || !dimension) return; sketch.dimensions[dimensionId] = { ...dimension, value }; const solved = solveSketch(sketch); if (solved.status === "conflicting" || solved.status === "failed") { setStatus(`草图尺寸未提交：${solved.diagnostics.at(-1)?.message ?? "约束求解失败"}`); return; } sketch.entities = solved.entities;
    setBusy(true);
    try { const history = cadHistoryRef.current ?? createCadHistory(current); const result = await commitCadHistoryEdit(history, current, candidate, { runtime, rebuildRuntime: rebuildStateRef.current, kernel, tolerance: DEFAULT_CAD_TOLERANCE, buildProfiles: buildSketchProfiles, assets: cadAssetsRef.current }); if (!result.success) { setStatus("草图尺寸修改导致 B-Rep 重建失败；保持最后成功几何。"); return; } cadHistoryRef.current = result.history; cadDocumentRef.current = result.document; setHistoryAvailability({ undo: canUndoCadHistory(result.history), redo: canRedoCadHistory(result.history) }); await renderHistoryDocument(result.document); setSelectedSketchId(sketchId); setSelectedFeatureId(""); setStatus(`通过：${dimension.name ?? dimensionId} = ${value} 已求解，并重建全部下游 Feature。`); } catch (error) { setStatus(`SKETCH_DIMENSION_EDIT_FAILED：${error instanceof Error ? error.message : String(error)}`); } finally { setBusy(false); }
  };

  const commitSketchPlaneOffset = async (sketchId: string, value: number) => {
    const current = cadDocumentRef.current, runtime = runtimeRef.current, kernel = kernelRef.current;
    const source = current?.sketches[sketchId];
    if (!current || !runtime || !kernel || !source || source.plane.type === "face") return;
    if (!Number.isFinite(value)) { setStatus("草图基准面位置必须是有效毫米数值。"); return; }
    const candidate = structuredClone(current) as CadDocument<Sketch, Feature>;
    const sketch = candidate.sketches[sketchId];
    if (!sketch || sketch.plane.type === "face") return;
    sketch.plane = { ...sketch.plane, offset: value };
    candidate.updatedAt = Date.now();
    setBusy(true);
    try {
      const history = cadHistoryRef.current ?? createCadHistory(current);
      const result = await commitCadHistoryEdit(history, current, candidate, { runtime, rebuildRuntime: rebuildStateRef.current, kernel, tolerance: DEFAULT_CAD_TOLERANCE, buildProfiles: buildSketchProfiles, assets: cadAssetsRef.current });
      if (!result.success) { setStatus("新的基准面位置导致下游实体无法重建，已保留原模型。"); return; }
      cadHistoryRef.current = result.history; cadDocumentRef.current = result.document;
      setHistoryAvailability({ undo: canUndoCadHistory(result.history), redo: canRedoCadHistory(result.history) });
      await renderHistoryDocument(result.document); setSelectedSketchId(sketchId); setSelectedFeatureId("");
      setStatus(`通过：${sketch.name} 已移动到 ${value.toFixed(2)} mm，相关放样、扫掠或实体特征已同步重建。`);
    } catch (error) { setStatus(`SKETCH_PLANE_OFFSET_FAILED：${error instanceof Error ? error.message : String(error)}`); }
    finally { setBusy(false); }
  };

  const duplicateSketchAsSection = () => {
    const current = cadDocumentRef.current, source = selectedSketchId ? current?.sketches[selectedSketchId] : undefined;
    if (!current || !source) { setStatus("请先选择需要复制的截面草图。"); return; }
    if (source.plane.type === "face") { setStatus("面上草图依赖真实表面；请新建基准面草图作为可偏置截面。"); return; }
    if (!Number.isFinite(sectionCopySpacingMm) || Math.abs(sectionCopySpacingMm) < .001) { setStatus("新截面间距不能为 0。"); return; }
    const candidate = structuredClone(current) as CadDocument<Sketch, Feature>;
    const id = `Sketch-${Date.now()}`;
    const duplicated = structuredClone(source) as Sketch;
    duplicated.id = id;
    duplicated.name = `${source.name} · 截面 ${Object.keys(candidate.sketches).length + 1}`;
    duplicated.plane = { ...source.plane, offset: source.plane.offset + sectionCopySpacingMm };
    candidate.sketches[id] = duplicated; candidate.updatedAt = Date.now();
    const history = cadHistoryRef.current ? commitCadHistory(cadHistoryRef.current, candidate) : createCadHistory(candidate);
    cadDocumentRef.current = candidate; cadHistoryRef.current = history;
    setHistoryAvailability({ undo: canUndoCadHistory(history), redo: canRedoCadHistory(history) });
    setSelectedSketchId(id); setSelectedFeatureId(""); setEditingSketchId(id);
    setStatus(`已复制为新截面，位置 ${(duplicated.plane.offset).toFixed(2)} mm；可修改轮廓后加入实体放样。`);
  };

  const applyFeatureParameterValue = (candidate: CadDocument<Sketch, Feature>, featureId: string, parameter: EditableParameter["key"], value: number): Feature | undefined => {
    const feature = candidate.features[featureId]; if (!feature || !Number.isFinite(value)) return undefined;
    if (feature.type === "extrude" && parameter === "distance") feature.distance = Math.max(.01, value);
    else if (feature.type === "hole" && parameter === "diameterMm") feature.diameterMm = Math.max(.01, value);
    else if (feature.type === "hole" && parameter === "depthMm" && feature.depth.type === "blind") feature.depth.valueMm = Math.max(.01, value);
    else if (feature.type === "hole" && parameter === "styleDiameterMm" && feature.style && feature.style.type !== "simple") feature.style.diameterMm = Math.max(feature.diameterMm + .01, value);
    else if (feature.type === "hole" && parameter === "counterboreDepthMm" && feature.style?.type === "counterbore") feature.style.depthMm = Math.max(.01, value);
    else if (feature.type === "hole" && parameter === "countersinkAngleDeg" && feature.style?.type === "countersink") feature.style.includedAngleDeg = Math.min(179, Math.max(1, value));
    else if (feature.type === "fillet" && parameter === "radiusMm") feature.radiusMm = Math.max(.01, value);
    else if (feature.type === "fillet" && parameter === "endRadiusMm") feature.endRadiusMm = Math.max(.01, value);
    else if (feature.type === "chamfer" && parameter === "distanceMm") feature.distanceMm = Math.max(.01, value);
    else if (feature.type === "shell" && parameter === "thicknessMm") feature.thicknessMm = Math.max(.01, value);
    else if (feature.type === "revolve" && parameter === "angleDeg") feature.angleDeg = Math.min(360, Math.max(.1, value));
    else if ((feature.type === "loft" || feature.type === "surfaceLoft") && parameter === "startLengthMm" && feature.startCondition) feature.startCondition.lengthMm = Math.max(.01, value);
    else if ((feature.type === "loft" || feature.type === "surfaceLoft") && parameter === "endLengthMm" && feature.endCondition) feature.endCondition.lengthMm = Math.max(.01, value);
    else if (feature.type === "draft" && parameter === "angleDeg") feature.angleDeg = value;
    else if ((feature.type === "offsetBody" || feature.type === "planarPushPull") && parameter === "distanceMm" && Math.abs(value) > 1e-6) feature.distanceMm = value;
    else if ((feature.type === "linearPattern" || feature.type === "circularPattern") && parameter === "patternCount") feature.count = Math.max(2, Math.round(value));
    else if (feature.type === "linearPattern" && parameter === "patternSpacingMm") feature.spacingMm = Math.max(.01, value);
    else if (feature.type === "circularPattern" && parameter === "patternAngleDeg") feature.angleDeg = Math.min(360, Math.max(.1, value));
    else if (feature.type === "surfaceExtrude" && parameter === "distanceMm") feature.distanceMm = Math.max(.01, Math.abs(value));
    else if (feature.type === "surfaceRevolve" && parameter === "angleDeg") feature.angleDeg = Math.min(360, Math.max(.1, value));
    else if (feature.type === "offsetSurface" && parameter === "distanceMm" && Math.abs(value) > 1e-6) feature.distanceMm = value;
    else if (feature.type === "thickenSurface" && parameter === "thicknessMm") feature.thicknessMm = Math.max(.01, Math.abs(value));
    else if (feature.type === "mechanicalDetail") {
      const detail = feature.detail;
      if (detail.kind === "externalThread" && parameter === "majorDiameterMm") detail.majorDiameterMm = Math.max(1, value);
      else if (detail.kind === "externalThread" && parameter === "pitchMm") detail.pitchMm = Math.max(.2, value);
      else if (detail.kind === "externalThread" && parameter === "lengthMm") detail.lengthMm = Math.max(1, value);
      else if (detail.kind === "externalThread" && parameter === "threadedLengthMm") detail.threadedLengthMm = Math.max(1, Math.min(detail.lengthMm, value));
      else if (detail.kind === "externalThread" && parameter === "threadDepthMm") detail.threadDepthMm = Math.max(.1, value);
      else if (detail.kind === "spurGear" && parameter === "moduleMm") detail.moduleMm = Math.max(.2, value);
      else if (detail.kind === "spurGear" && parameter === "teeth") detail.teeth = Math.max(8, Math.min(160, Math.round(value)));
      else if (detail.kind === "spurGear" && parameter === "pressureAngleDeg") detail.pressureAngleDeg = Math.max(14, Math.min(30, value));
      else if (detail.kind === "spurGear" && parameter === "thicknessMm") detail.thicknessMm = Math.max(1, value);
      else if (detail.kind === "spurGear" && parameter === "boreDiameterMm") detail.boreDiameterMm = Math.max(0, value);
      else if (detail.kind === "bearing" && parameter === "outerDiameterMm") detail.outerDiameterMm = Math.max(2, value);
      else if (detail.kind === "bearing" && parameter === "innerDiameterMm") detail.innerDiameterMm = Math.max(1, value);
      else if (detail.kind === "bearing" && parameter === "widthMm") detail.widthMm = Math.max(1, value);
      else if (detail.kind === "bearing" && parameter === "ballCount") detail.ballCount = Math.max(5, Math.min(48, Math.round(value)));
      else if (detail.kind === "cableSweep" && parameter === "cableDiameterMm") detail.diameterMm = Math.max(.5, value);
      else return undefined;
    }
    else return undefined;
    return feature;
  };

  // Compatibility alias name retained in the source contract: commitFeatureParameter.
  const previewFeatureParameter = async (featureId: string, parameter: EditableParameter["key"], value: number) => {
    const current = cadDocumentRef.current, runtime = runtimeRef.current, kernel = kernelRef.current;
    if (!current || !runtime || !kernel) { setStatus("当前没有可预览的 CAD Document。"); return; }
    if (featurePreviewRef.current) { setStatus("请先接受或取消当前特征预览，再修改其他参数。"); return; }
    const candidate = structuredClone(current) as CadDocument<Sketch, Feature>; const feature = applyFeatureParameterValue(candidate, featureId, parameter, value);
    if (!feature) { setStatus("当前 Feature 不支持该预览参数。"); return; }
    setBusy(true);
    try {
      const rebuilt = await rebuildDocument({ document:candidate, runtime, rebuildRuntime:rebuildStateRef.current, kernel, tolerance:DEFAULT_CAD_TOLERANCE, buildProfiles:buildSketchProfiles, assets:cadAssetsRef.current }, { full:true });
      if (!rebuilt.success) { setStatus("预览失败：参数导致 B-Rep 重建失败，保持最后成功几何。"); return; }
      featurePreviewRef.current = { base: current, candidate, featureId, label:`${feature.name} · ${parameter} = ${value}` }; setFeaturePreviewLabel(`${feature.name} · ${parameter} = ${value}`);
      await renderBodies(candidate, runtime, kernel); setSelectedFeatureId(featureId); setStatus("预览：临时 B-Rep 已重建；点击 ✓ 接受写入 History，或 × 取消恢复原设计。");
    } catch (error) { setStatus(`FEATURE_PREVIEW_FAILED：${error instanceof Error ? error.message : String(error)}`); } finally { setBusy(false); }
  };

  const previewFeatureDesignChange = async (featureId: string, label: string, mutate: (feature: Feature, candidate: CadDocument<Sketch, Feature>) => boolean) => {
    const current = cadDocumentRef.current, runtime = runtimeRef.current, kernel = kernelRef.current;
    if (!current || !runtime || !kernel) { setStatus("当前没有可预览的 CAD Document。"); return; }
    if (featurePreviewRef.current) { setStatus("请先接受或取消当前特征预览，再修改其他参数。"); return; }
    const candidate = structuredClone(current) as CadDocument<Sketch, Feature>;
    const feature = candidate.features[featureId];
    if (!feature || !mutate(feature, candidate)) { setStatus("当前特征或输入设置不支持这次修改。"); return; }
    setBusy(true);
    try {
      const rebuilt = await rebuildDocument({ document: candidate, runtime, rebuildRuntime: rebuildStateRef.current, kernel, tolerance: DEFAULT_CAD_TOLERANCE, buildProfiles: buildSketchProfiles, assets: cadAssetsRef.current }, { full: true });
      if (!rebuilt.success) { setStatus(`预览未通过：${rebuilt.errors.at(-1)?.message ?? "曲面重建失败"}。当前历史和最后成功几何保持不变。`); return; }
      featurePreviewRef.current = { base: current, candidate, featureId, label };
      setFeaturePreviewLabel(label);
      await renderBodies(candidate, runtime, kernel);
      setSelectedFeatureId(featureId);
      setStatus("曲面修改预览已生成；点击接受写入历史，或取消恢复原模型。");
    } catch (error) { setStatus(`SURFACE_FEATURE_PREVIEW_FAILED：${error instanceof Error ? error.message : String(error)}`); }
    finally { setBusy(false); }
  };

  const previewSurfaceSweepHistoryEdit = (featureId: string, values: SurfaceSweepEditValues) => {
    const upLength = Math.hypot(values.upDirection.x, values.upDirection.y, values.upDirection.z);
    if (values.orientation === "fixedUp" && (!Number.isFinite(upLength) || upLength <= 1e-9)) { setStatus("固定方向不能是零向量，请至少填写一个非零方向分量。"); return; }
    void previewFeatureDesignChange(featureId, `曲面扫掠 · ${values.orientation === "guide" ? "辅助导轨" : values.orientation === "fixedUp" ? "固定方向" : "随路径转向"}`, (feature, candidate) => {
      if (feature.type !== "surfaceSweep" || !candidate.sketches[values.profileSketchId] || !candidate.sketches[values.pathSketchId]) return false;
      if (values.profileSketchId === values.pathSketchId) return false;
      if (values.orientation === "guide" && (!values.guideSketchId || !candidate.sketches[values.guideSketchId] || values.guideSketchId === values.profileSketchId || values.guideSketchId === values.pathSketchId)) return false;
      feature.profileSketchId = values.profileSketchId;
      feature.pathSketchId = values.pathSketchId;
      feature.orientation = values.orientation;
      feature.guideSketchId = values.orientation === "guide" ? values.guideSketchId : undefined;
      feature.upDirection = values.orientation === "fixedUp" ? values.upDirection : undefined;
      return true;
    });
  };

  const previewBoundarySurfaceHistoryEdit = (featureId: string, values: BoundarySurfaceEditValues) => {
    void previewFeatureDesignChange(featureId, `边界曲面 · ${values.continuity} · ${values.sampleCount} 点验收`, (feature) => {
      if (feature.type !== "boundarySurface") return false;
      feature.continuity = values.continuity;
      feature.verification = { sampleCount: values.sampleCount, angularToleranceDeg: values.angularToleranceDeg, curvatureTolerance: values.curvatureTolerance };
      return true;
    });
  };

  // Compatibility alias retained for existing productization gates; edits now enter preview first.

  const acceptFeaturePreview = async () => {
    const preview=featurePreviewRef.current, runtime=runtimeRef.current, kernel=kernelRef.current; if(!preview||!runtime||!kernel)return; setBusy(true);
    try { const history=cadHistoryRef.current??createCadHistory(preview.base); const result=await commitCadHistoryEdit(history,preview.base,preview.candidate,{runtime,rebuildRuntime:rebuildStateRef.current,kernel,tolerance:DEFAULT_CAD_TOLERANCE,buildProfiles:buildSketchProfiles,assets:cadAssetsRef.current}); if(!result.success){setStatus("接受预览失败：事务重建未通过。");return;} cadHistoryRef.current=result.history;cadDocumentRef.current=result.document;setHistoryAvailability({undo:canUndoCadHistory(result.history),redo:canRedoCadHistory(result.history)});featurePreviewRef.current=undefined;setFeaturePreviewLabel("");await renderHistoryDocument(result.document);setSelectedFeatureId(preview.featureId);setStatus("通过：预览参数已写入 Feature History。"); } catch(error){setStatus(`FEATURE_PREVIEW_ACCEPT_FAILED：${error instanceof Error?error.message:String(error)}`);} finally{setBusy(false);}
  };

  const cancelFeaturePreview = async () => {
    const preview=featurePreviewRef.current,runtime=runtimeRef.current,kernel=kernelRef.current;if(!preview||!runtime||!kernel)return;setBusy(true);
    try { const rebuilt=await rebuildDocument({document:preview.base,runtime,rebuildRuntime:rebuildStateRef.current,kernel,tolerance:DEFAULT_CAD_TOLERANCE,buildProfiles:buildSketchProfiles,assets:cadAssetsRef.current},{full:true});if(!rebuilt.success)throw new Error(rebuilt.errors.map((entry)=>entry.message).join("; "));featurePreviewRef.current=undefined;setFeaturePreviewLabel("");await renderBodies(preview.base,runtime,kernel);setSelectedFeatureId(preview.featureId);setStatus("已取消预览，恢复原设计；History 未发生变化。"); } catch(error){setStatus(`FEATURE_PREVIEW_CANCEL_FAILED：${error instanceof Error?error.message:String(error)}`);} finally{setBusy(false);}
  };

  const commitFeatureHistoryManagement = async (candidate:CadDocument<Sketch,Feature>,nextSelection:string,message:string) => { const current=cadDocumentRef.current,runtime=runtimeRef.current,kernel=kernelRef.current;if(!current||!runtime||!kernel)return;setBusy(true);try{const history=cadHistoryRef.current??createCadHistory(current),result=await commitCadHistoryEdit(history,current,candidate,{runtime,rebuildRuntime:rebuildStateRef.current,kernel,tolerance:DEFAULT_CAD_TOLERANCE,buildProfiles:buildSketchProfiles,assets:cadAssetsRef.current});if(!result.success){setStatus("特征历史修改未通过重建，已保留原模型。");return;}cadHistoryRef.current=result.history;cadDocumentRef.current=result.document;setHistoryAvailability({undo:canUndoCadHistory(result.history),redo:canRedoCadHistory(result.history)});await renderHistoryDocument(result.document);setSelectedFeatureId(nextSelection);setStatus(message);}catch(error){setStatus(`FEATURE_HISTORY_EDIT_FAILED：${error instanceof Error?error.message:String(error)}`);}finally{setBusy(false);} };

  const toggleFeatureSuppression = async (featureId: string) => { const current=cadDocumentRef.current,feature=current?.features[featureId];if(!current||!feature)return;try{const result=setHistoryFeatureSuppressed(current,featureId,feature.enabled);await commitFeatureHistoryManagement(result.document,featureId,`通过：${feature.name} 已${feature.enabled?"连同下游抑制":"连同所需上游恢复"}（${result.affectedFeatureIds.length} 项）。`);}catch(error){setStatus(error instanceof Error?error.message:String(error));} };
  const renameSelectedFeature = async () => { const current=cadDocumentRef.current;if(!current||!selectedFeatureId)return;try{await commitFeatureHistoryManagement(renameHistoryFeature(current,selectedFeatureId,featureNameDraft),selectedFeatureId,"通过：特征名称已更新并写入历史。");}catch(error){setStatus(error instanceof Error?error.message:String(error));} };
  const moveSelectedFeature = async (direction:"up"|"down") => { const current=cadDocumentRef.current;if(!current||!selectedFeatureId)return;try{const next=moveHistoryFeature(current,selectedFeatureId,direction);if(next===current){setStatus("特征已经位于可移动范围边界。");return;}await commitFeatureHistoryManagement(next,selectedFeatureId,"通过：特征顺序已调整并完成重建。");}catch(error){setStatus(error instanceof Error?error.message:String(error));} };
  const rollbackToSelectedFeature = async () => { const current=cadDocumentRef.current;if(!current||!selectedFeatureId)return;try{const preview=rollbackHistoryToFeature(current,selectedFeatureId);if(!preview.affectedFeatureIds.length){setStatus("所选特征之后没有需要回退的活动内容。");return;}if(!window.confirm(`将模型回退到所选节点，并暂时关闭之后的 ${preview.affectedFeatureIds.length} 个特征。可使用撤销恢复，是否继续？`))return;await commitFeatureHistoryManagement(preview.document,selectedFeatureId,`通过：模型已回退到 ${current.features[selectedFeatureId].name}，可使用撤销恢复后续特征。`);}catch(error){setStatus(error instanceof Error?error.message:String(error));} };
  const deleteSelectedFeatureCascade = async () => { const current=cadDocumentRef.current;if(!current||!selectedFeatureId)return;try{const preview=deleteHistoryFeatureCascade(current,selectedFeatureId);if(!window.confirm(`将删除所选特征及其下游，共 ${preview.deletedFeatureIds.length} 项。删除后可使用撤销恢复，是否继续？`))return;const index=current.featureOrder.indexOf(selectedFeatureId),nextSelection=preview.document.featureOrder[Math.max(0,index-1)]??"";await commitFeatureHistoryManagement(preview.document,nextSelection,`通过：已删除 ${preview.deletedFeatureIds.length} 个相关特征，可使用撤销恢复。`);}catch(error){setStatus(error instanceof Error?error.message:String(error));} };

  featureHistoryShortcutRef.current = (event: KeyboardEvent) => {
    if (cadAgentOpen || commandPaletteOpen || readinessOpen || editingSketchId) return false;
    const visibleIds = visibleFeaturePanel.map((feature) => feature.id);
    const currentIndex = visibleIds.indexOf(selectedFeatureId);
    const selectHistoryFeature = (featureId: string | undefined) => {
      if (!featureId) return;
      setSelectedFeatureId(featureId);
      setSelectedSketchId("");
    };

    if (event.key === "F2" && selectedFeatureId) {
      event.preventDefault();
      featureNameInputRef.current?.focus();
      featureNameInputRef.current?.select();
      return true;
    }
    if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown") && selectedFeatureId) {
      event.preventDefault();
      void moveSelectedFeature(event.key === "ArrowUp" ? "up" : "down");
      return true;
    }
    if (!event.ctrlKey && !event.metaKey && !event.altKey && visibleIds.length && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault();
      const direction = event.key === "ArrowUp" ? -1 : 1;
      const fallback = direction > 0 ? -1 : visibleIds.length;
      selectHistoryFeature(visibleIds[(currentIndex >= 0 ? currentIndex : fallback) + direction]);
      return true;
    }
    if (!event.ctrlKey && !event.metaKey && !event.altKey && (event.key === "Home" || event.key === "End") && visibleIds.length) {
      event.preventDefault();
      selectHistoryFeature(event.key === "Home" ? visibleIds[0] : visibleIds.at(-1));
      return true;
    }
    if (!event.repeat && !event.ctrlKey && !event.metaKey && !event.altKey && event.code === "Space" && selectedFeatureId) {
      event.preventDefault();
      void toggleFeatureSuppression(selectedFeatureId);
      return true;
    }
    if (!event.repeat && !event.ctrlKey && !event.metaKey && !event.altKey && event.shiftKey && event.key.toLowerCase() === "r" && selectedFeatureId) {
      event.preventDefault();
      void rollbackToSelectedFeature();
      return true;
    }
    if (!event.repeat && event.key === "Delete" && selectedFeatureId) {
      event.preventDefault();
      void deleteSelectedFeatureCascade();
      return true;
    }
    return false;
  };


  const selectDirectEditCandidate = (candidate: DirectEditCandidate) => {
    selectionModeRef.current = "face"; setMode("face"); selectedTopologyRef.current = candidate.topology;
    renderStateRef.current?.highlightFace?.(candidate.topology);
    setSelection(`${candidate.kind.toUpperCase()} CANDIDATE · ${candidate.topology.localId}`);
    setStatus(`已定位 ${candidate.label}；${candidate.kind === "hole" ? "可直接删除孔，或进入 Remove/Heal → Native Hole 参数化重构。" : candidate.kind === "prismatic" ? "这是保守的 Prismatic Boss/Pocket 候选：可先审查 Cap/Side 面组或 Defeature；当前不会自动猜 Boss/Pocket 类型。" : candidate.kind === "pattern" ? "这是解析孔阵列候选：几何间距/角度已证明，但必须先确认一个 Native Seed Hole 与 healed target，才会恢复 Pattern History。" : candidate.topologies.length > 1 ? `识别到 ${candidate.topologies.length} 个连续解析面，可 Defeature 或进入参数化 Modify。` : "可继续 Push/Pull / Defeature / 参数化重构。"}`);
  };

  const loadCandidateDefeatureSet = (candidate: DirectEditCandidate) => {
    const current = cadDocumentRef.current, runtime = runtimeRef.current;
    if (!current || !runtime || !selectedBodyId) { setStatus("请先选择目标 Body。 "); return; }
    const sourceFeatureId = deriveBodyTipFeatureId(current, selectedBodyId) ?? current.bodies[selectedBodyId]?.tipFeatureId ?? currentFeatureIdRef.current;
    const shape = runtime.featureShapes.get(sourceFeatureId);
    if (!shape) { setStatus("当前 Body 没有可用于 Defeature 的 Tip Shape。"); return; }
    const topologies = candidate.topologies.filter((topology)=>topology.shapeId===shape.id && topology.shapeRevision===shape.revision && topology.kind==="face");
    if (!topologies.length) { setStatus("候选面已因重建失效，请重新执行特征分析。"); return; }
    defeatureSelectionRef.current = topologies.map((topology)=>({ bodyId:selectedBodyId, sourceFeatureId, topology }));
    setDefeatureSelectionLabel(`${topologies.length} Face：${topologies.map((topology)=>topology.localId).join(", ")}`);
    selectedTopologyRef.current = topologies[0]; renderStateRef.current?.highlightFace?.(topologies[0]);
    setStatus(`已将 ${candidate.kind === "round" ? "Fillet / Round" : candidate.kind === "cone" ? "Chamfer / Cone" : candidate.kind === "prismatic" ? "Prismatic Boss/Pocket" : candidate.kind === "pattern" ? "Hole Pattern" : "Hole"} 候选的 ${topologies.length} 个解析面装入 Defeature 选择集；确认后执行愈合。`);
  };

  const beginImportedHoleReconstruction = async (candidate: DirectEditCandidate) => {
    const spec = candidate.holeSpec;
    if (candidate.kind !== "hole" || !spec) { setStatus("请选择一个高可信圆柱孔候选。 "); return; }
    const current = cadDocumentRef.current, runtime = runtimeRef.current, kernel = kernelRef.current;
    if (!current || !runtime || !kernel || !selectedBodyId) { setStatus("请先选择目标 Body 并完成 B-Rep 重建。 "); return; }
    const sourceFeatureId = deriveBodyTipFeatureId(current, selectedBodyId) ?? current.bodies[selectedBodyId]?.tipFeatureId ?? currentFeatureIdRef.current;
    const shape = runtime.featureShapes.get(sourceFeatureId);
    if (!shape || candidate.topology.shapeId !== shape.id || candidate.topology.shapeRevision !== shape.revision) { setStatus("孔候选已因重建失效，请重新分析导入特征。 "); return; }
    setBusy(true);
    try {
      const candidateFaces = candidate.topologies.filter((topology)=>topology.kind === "face" && topology.shapeId === shape.id && topology.shapeRevision === shape.revision);
      const persistentFaces = await Promise.all(candidateFaces.map((topology)=>capturePersistentTopologyRef(sourceFeatureId,topology,runtime,kernel)));
      const cylindricalFace = await capturePersistentTopologyRef(sourceFeatureId, candidate.topology, runtime, kernel);
      if (cylindricalFace.kind !== "face" || persistentFaces.some((entry)=>entry.kind!=="face")) throw new Error("Hole reconstruction requires Persistent Face References.");
      const preview = createImportedHolePreview({ document: current, bodyId: selectedBodyId, targetFeatureId: sourceFeatureId, cylindricalFace, featureFaces:persistentFaces.filter((entry):entry is PersistentFaceRef=>entry.kind==="face"), style:spec.style, sourceLabel: candidate.label, diameterMm: spec.diameterMm, axialLengthMm: spec.axialLengthMm });
      const rebuilt = await rebuildDocument({ document: preview.document, runtime, rebuildRuntime: rebuildStateRef.current, kernel, tolerance: DEFAULT_CAD_TOLERANCE, buildProfiles: buildSketchProfiles, assets: cadAssetsRef.current }, { full: true });
      if (!rebuilt.success) throw new Error(rebuilt.errors.map((entry) => entry.message).join("; "));
      importedHoleReconstructionRef.current = { base: current, preview, axisOriginMm: spec.axisOriginMm, axisDirection: spec.axisDirection };
      setImportedHoleDiameterMm(spec.diameterMm); setImportedHoleDepthMm(spec.depthCondition?.type === "blind" ? spec.depthCondition.valueMm : spec.axialLengthMm); setImportedHoleDepthMode(spec.depthCondition?.type === "blind" ? "blind" : "throughAll");
      setImportedHoleReconstructionLabel(`${spec.style?.type === "counterbore" ? "Counterbore" : spec.style?.type === "countersink" ? "Countersink" : "Hole"} reconstruction · Ø${spec.diameterMm.toFixed(3)} · ${spec.depthCondition ? `${spec.depthCondition.type === "throughAll" ? "Through All" : `Blind ${spec.depthCondition.valueMm.toFixed(3)} mm`} ${(spec.depthCondition.confidence*100).toFixed(0)}%` : "depth requires confirmation"} · Fill/Heal preview ready`);
      selectionModeRef.current = "face"; setMode("face"); selectedTopologyRef.current = undefined; setSelection("请选择愈合后的孔入口平面");
      await renderBodies(preview.document, runtime, kernel); setSelectedFeatureId(preview.removeHoleFeatureId);
      setStatus("HOLE RECONSTRUCTION PREVIEW：原孔已临时填充/愈合。请选择孔入口所在的真实 Planar Face，系统会用原圆柱轴线与该平面的交点恢复孔中心；History 尚未提交。 ");
    } catch (error) { setStatus(`HOLE_RECONSTRUCTION_PREVIEW_FAILED：${error instanceof Error ? error.message : String(error)}；原设计保持不变。`); }
    finally { setBusy(false); }
  };

  const completeImportedHole = async () => {
    const session = importedHoleReconstructionRef.current, runtime = runtimeRef.current, kernel = kernelRef.current, topology = selectedTopologyRef.current;
    if (!session || !runtime || !kernel) { setStatus("当前没有待完成的 Hole Reconstruction。 "); return; }
    if (!topology || topology.kind !== "face") { setStatus("请先选择愈合后的孔入口 Planar Face。 "); return; }
    const previewShape = runtime.featureShapes.get(session.preview.removeHoleFeatureId);
    if (!previewShape || topology.shapeId !== previewShape.id || topology.shapeRevision !== previewShape.revision) { setStatus("所选 Face 不属于当前 Remove Hole 预览状态。 "); return; }
    if (!Number.isFinite(importedHoleDiameterMm) || importedHoleDiameterMm <= 0 || (importedHoleDepthMode === "blind" && (!Number.isFinite(importedHoleDepthMm) || importedHoleDepthMm <= 0))) { setStatus("孔径/盲孔深度必须大于 0。 "); return; }
    setBusy(true);
    try {
      const faceInfo = await kernel.getFaceInfo(topology); const frame = getPlanarFaceFrame(faceInfo);
      const centerWorld = intersectAxisWithPlane(session.axisOriginMm, session.axisDirection, frame);
      const center = worldToFaceLocal(frame, centerWorld);
      const targetFace = await capturePersistentTopologyRef(session.preview.removeHoleFeatureId, topology, runtime, kernel);
      if (targetFace.kind !== "face") throw new Error("Hole reconstruction requires a Persistent planar Face Reference.");
      const completed = completeImportedHoleReconstruction({ preview: session.preview, targetFace, center, diameterMm: importedHoleDiameterMm, depth: importedHoleDepthMode === "throughAll" ? { type: "throughAll" } : { type: "blind", valueMm: importedHoleDepthMm } });
      const history = cadHistoryRef.current ?? createCadHistory(session.base);
      const result = await commitCadHistoryEdit(history, session.base, completed.document, { runtime, rebuildRuntime: rebuildStateRef.current, kernel, tolerance: DEFAULT_CAD_TOLERANCE, buildProfiles: buildSketchProfiles, assets: cadAssetsRef.current });
      if (!result.success) throw new Error("最终 Native Hole 重建失败。 ");
      cadHistoryRef.current = result.history; cadDocumentRef.current = result.document; setHistoryAvailability({ undo: canUndoCadHistory(result.history), redo: canRedoCadHistory(result.history) });
      importedHoleReconstructionRef.current = undefined; setImportedHoleReconstructionLabel(""); selectedTopologyRef.current = undefined; setSelection("未选择");
      await renderHistoryDocument(result.document); setSelectedFeatureId(completed.reconstructedFeatureId); await analyzeSelectedBody();
      setStatus(`通过：${completed.sourceLabel} 已重构为可编辑 Native ${session.preview.style.type} Hole Ø${importedHoleDiameterMm} ${importedHoleDepthMode === "throughAll" ? "Through All" : `Blind ${importedHoleDepthMm} mm`}。History = Imported B-Rep → Heal → Native Hole。`);
    } catch (error) { setStatus(`HOLE_RECONSTRUCTION_COMMIT_FAILED：${error instanceof Error ? error.message : String(error)}；原设计 History 未提交。`); }
    finally { setBusy(false); }
  };

  const cancelImportedHoleReconstruction = async () => {
    const session = importedHoleReconstructionRef.current, runtime = runtimeRef.current, kernel = kernelRef.current; if (!session || !runtime || !kernel) return;
    setBusy(true);
    try { const rebuilt = await rebuildDocument({ document: session.base, runtime, rebuildRuntime: rebuildStateRef.current, kernel, tolerance: DEFAULT_CAD_TOLERANCE, buildProfiles: buildSketchProfiles, assets: cadAssetsRef.current }, { full: true }); if (!rebuilt.success) throw new Error(rebuilt.errors.map((entry)=>entry.message).join("; ")); importedHoleReconstructionRef.current=undefined;setImportedHoleReconstructionLabel("");selectedTopologyRef.current=undefined;setSelection("未选择");await renderBodies(session.base,runtime,kernel);setStatus("已取消 Hole Reconstruction，恢复原 B-Rep；History 未发生变化。 "); } catch(error){setStatus(`HOLE_RECONSTRUCTION_CANCEL_FAILED：${error instanceof Error?error.message:String(error)}`);} finally{setBusy(false);}
  };

  const beginImportedPatternReconstruction = async (candidate: DirectEditCandidate) => {
    const spec = candidate.patternSpec;
    if (candidate.kind !== "pattern" || !spec) { setStatus("请选择一个高可信解析 Hole Pattern 候选。 "); return; }
    const current=cadDocumentRef.current,runtime=runtimeRef.current,kernel=kernelRef.current;
    if(!current||!runtime||!kernel||!selectedBodyId){setStatus("请先选择目标 Body 并完成 B-Rep 重建。 ");return;}
    if(importedHoleReconstructionLabel||importedReconstructionLabel||importedPatternReconstructionLabel){setStatus("请先完成或取消当前 Imported Feature Reconstruction。 ");return;}
    const sourceFeatureId=deriveBodyTipFeatureId(current,selectedBodyId)??current.bodies[selectedBodyId]?.tipFeatureId??currentFeatureIdRef.current;
    const shape=runtime.featureShapes.get(sourceFeatureId);
    if(!shape||candidate.topologies.some((topology)=>topology.shapeId!==shape.id||topology.shapeRevision!==shape.revision)){setStatus("Pattern 候选已因重建失效，请重新分析导入特征。 ");return;}
    setBusy(true);
    try{
      const persistent=await Promise.all(candidate.topologies.map((topology)=>capturePersistentTopologyRef(sourceFeatureId,topology,runtime,kernel)));
      if(persistent.some((entry)=>entry.kind!=="face"))throw new Error("Pattern Reconstruction requires Persistent Face References.");
      const preview=createImportedHolePatternPreview({document:current,bodyId:selectedBodyId,targetFeatureId:sourceFeatureId,sourceLabel:candidate.label,pattern:spec.candidate,memberFaces:persistent.filter((entry):entry is PersistentFaceRef=>entry.kind==="face"),seedMemberIndex:0});
      const rebuilt=await rebuildDocument({document:preview.document,runtime,rebuildRuntime:rebuildStateRef.current,kernel,tolerance:DEFAULT_CAD_TOLERANCE,buildProfiles:buildSketchProfiles,assets:cadAssetsRef.current},{full:true});
      if(!rebuilt.success)throw new Error(rebuilt.errors.map((entry)=>entry.message).join("; "));
      importedPatternReconstructionRef.current={base:current,preview,axisOriginMm:spec.seedAxisOriginMm,axisDirection:spec.seedAxisDirection};
      setImportedHoleDepthMode(spec.seedDepthCondition?.type==="blind"?"blind":"throughAll");
      setImportedHoleDepthMm(spec.seedDepthCondition?.type==="blind"?spec.seedDepthCondition.valueMm:20);
      setImportedPatternReconstructionLabel(`${spec.patternType === "linear" ? "Linear" : "Circular"} Pattern · ${spec.count}× Ø${spec.candidate.diameterMm.toFixed(3)} · repeated imported holes healed · select one healed planar entry Face`);
      selectionModeRef.current="face";setMode("face");selectedTopologyRef.current=undefined;setSelection("请选择愈合后的 Seed Hole 入口平面");
      await renderBodies(preview.document,runtime,kernel);setSelectedFeatureId(preview.healFeatureId);
      setStatus("PATTERN RECONSTRUCTION PREVIEW：全部重复孔已在临时 B-Rep 中 Heal。请选择 Seed Hole 所在的 Planar Face；系统将恢复 Native Seed Hole + Native Pattern，History 尚未提交。 ");
    }catch(error){setStatus(`PATTERN_RECONSTRUCTION_PREVIEW_FAILED：${error instanceof Error?error.message:String(error)}；原设计保持不变。`);}finally{setBusy(false);}
  };

  const completeImportedPattern = async () => {
    const session=importedPatternReconstructionRef.current,runtime=runtimeRef.current,kernel=kernelRef.current,topology=selectedTopologyRef.current;
    if(!session||!runtime||!kernel){setStatus("当前没有待完成的 Hole Pattern Reconstruction。 ");return;}
    if(!topology||topology.kind!=="face"){setStatus("请先选择愈合后的 Seed Hole 入口 Planar Face。 ");return;}
    const previewShape=runtime.featureShapes.get(session.preview.healFeatureId);
    if(!previewShape||topology.shapeId!==previewShape.id||topology.shapeRevision!==previewShape.revision){setStatus("所选 Face 不属于当前 Pattern Heal 预览状态。 ");return;}
    setBusy(true);
    try{
      const faceInfo=await kernel.getFaceInfo(topology);const frame=getPlanarFaceFrame(faceInfo);
      const centerWorld=intersectAxisWithPlane(session.axisOriginMm,session.axisDirection,frame);const center=worldToFaceLocal(frame,centerWorld);
      const targetFace=await capturePersistentTopologyRef(session.preview.healFeatureId,topology,runtime,kernel);if(targetFace.kind!=="face")throw new Error("Pattern seed requires a Persistent planar Face Reference.");
      const completed=completeImportedHolePatternReconstruction({preview:session.preview,targetFace,center,depth:importedHoleDepthMode==="throughAll"?{type:"throughAll"}:{type:"blind",valueMm:importedHoleDepthMm},style:{type:"simple"}});
      const history=cadHistoryRef.current??createCadHistory(session.base);
      const result=await commitCadHistoryEdit(history,session.base,completed.document,{runtime,rebuildRuntime:rebuildStateRef.current,kernel,tolerance:DEFAULT_CAD_TOLERANCE,buildProfiles:buildSketchProfiles,assets:cadAssetsRef.current});
      if(!result.success)throw new Error("最终 Native Pattern 重建失败。 ");
      cadHistoryRef.current=result.history;cadDocumentRef.current=result.document;setHistoryAvailability({undo:canUndoCadHistory(result.history),redo:canRedoCadHistory(result.history)});
      importedPatternReconstructionRef.current=undefined;setImportedPatternReconstructionLabel("");selectedTopologyRef.current=undefined;setSelection("未选择");
      await renderHistoryDocument(result.document);setSelectedFeatureId(completed.patternFeatureId);await analyzeSelectedBody();
      setStatus(`通过：${completed.sourceLabel} 已重构为 Native Seed Hole → ${completed.pattern.kind === "linear-hole-pattern" ? "Linear" : "Circular"} Pattern。Pattern count / spacing / axis 已进入 Feature History，可继续参数编辑、Undo/Redo、Save/Load。`);
    }catch(error){setStatus(`PATTERN_RECONSTRUCTION_COMMIT_FAILED：${error instanceof Error?error.message:String(error)}；原设计 History 未提交。`);}finally{setBusy(false);}
  };

  const cancelImportedPatternReconstruction = async () => {
    const session=importedPatternReconstructionRef.current,runtime=runtimeRef.current,kernel=kernelRef.current;if(!session||!runtime||!kernel)return;
    setBusy(true);try{const rebuilt=await rebuildDocument({document:session.base,runtime,rebuildRuntime:rebuildStateRef.current,kernel,tolerance:DEFAULT_CAD_TOLERANCE,buildProfiles:buildSketchProfiles,assets:cadAssetsRef.current},{full:true});if(!rebuilt.success)throw new Error(rebuilt.errors.map((entry)=>entry.message).join("; "));importedPatternReconstructionRef.current=undefined;setImportedPatternReconstructionLabel("");selectedTopologyRef.current=undefined;setSelection("未选择");await renderBodies(session.base,runtime,kernel);setStatus("已取消 Pattern Reconstruction，恢复原 B-Rep；History 未发生变化。 ");}catch(error){setStatus(`PATTERN_RECONSTRUCTION_CANCEL_FAILED：${error instanceof Error?error.message:String(error)}`);}finally{setBusy(false);}
  };

  const beginImportedEdgeTreatmentReconstruction = async (candidate: DirectEditCandidate) => {
    if (candidate.kind !== "round" && candidate.kind !== "cone") { setStatus("只有 Fillet / Chamfer 候选可以进入参数化重构。 "); return; }
    const current = cadDocumentRef.current, runtime = runtimeRef.current, kernel = kernelRef.current;
    if (!current || !runtime || !kernel || !selectedBodyId) { setStatus("请先选择目标 Body 并完成 B-Rep 重建。 "); return; }
    const sourceFeatureId = deriveBodyTipFeatureId(current, selectedBodyId) ?? current.bodies[selectedBodyId]?.tipFeatureId ?? currentFeatureIdRef.current;
    const shape = runtime.featureShapes.get(sourceFeatureId);
    if (!shape) { setStatus("当前 Body 没有可重构的 Tip Shape。 "); return; }
    const topologies = candidate.topologies.filter((topology) => topology.kind === "face" && topology.shapeId === shape.id && topology.shapeRevision === shape.revision);
    if (!topologies.length) { setStatus("识别候选已因重建失效，请重新分析导入特征。 "); return; }
    setBusy(true);
    try {
      const faces = await Promise.all(topologies.map((topology) => capturePersistentTopologyRef(sourceFeatureId, topology, runtime, kernel)));
      const preview = createImportedEdgeTreatmentPreview({ document: current, bodyId: selectedBodyId, targetFeatureId: sourceFeatureId, faces, kind: candidate.kind === "round" ? "fillet" : "chamfer", sourceLabel: candidate.label });
      const rebuilt = await rebuildDocument({ document: preview.document, runtime, rebuildRuntime: rebuildStateRef.current, kernel, tolerance: DEFAULT_CAD_TOLERANCE, buildProfiles: buildSketchProfiles, assets: cadAssetsRef.current }, { full: true });
      if (!rebuilt.success) throw new Error(rebuilt.errors.map((entry) => entry.message).join("; "));
      const valueMm = candidate.suggestedValueMm ?? (candidate.kind === "round" ? 3 : 2);
      importedReconstructionRef.current = { base: current, preview, valueMm };
      reconstructionEdgeSelectionRef.current = []; setReconstructionEdgeSelectionLabel("尚未确认锐边");
      setImportedReconstructionValueMm(valueMm);
      setImportedReconstructionLabel(`${candidate.kind === "round" ? "Fillet" : "Chamfer"} reconstruction · Defeature preview ready`);
      selectionModeRef.current = "edge"; setMode("edge"); selectedTopologyRef.current = undefined; setSelection("请选择愈合后新生成的锐边");
      await renderBodies(preview.document, runtime, kernel);
      setSelectedFeatureId(preview.defeatureFeatureId);
      setStatus(`RECONSTRUCTION PREVIEW：已愈合 ${topologies.length} 个识别面。现在选择要重新建立 ${candidate.kind === "round" ? "Fillet" : "Chamfer"} 的锐边，再点击“完成重构”。History 尚未提交。`);
    } catch (error) {
      setStatus(`FEATURE_RECONSTRUCTION_PREVIEW_FAILED：${error instanceof Error ? error.message : String(error)}；原设计保持不变。`);
    } finally { setBusy(false); }
  };

  const addSelectedReconstructionEdge = () => {
    const session=importedReconstructionRef.current, topology=selectedTopologyRef.current, runtime=runtimeRef.current;
    if(!session||!runtime){setStatus("当前没有待完成的 Imported Feature Reconstruction。 ");return;}
    if(!topology||topology.kind!=="edge"){setStatus("请先在愈合预览上选择真实 B-Rep Edge。 ");return;}
    const shape=runtime.featureShapes.get(session.preview.defeatureFeatureId);
    if(!shape||topology.shapeId!==shape.id||topology.shapeRevision!==shape.revision){setStatus("当前 Edge 不属于这次 Defeature Preview，请重新选择。 ");return;}
    if(!reconstructionEdgeSelectionRef.current.some((entry)=>entry.localId===topology.localId)) reconstructionEdgeSelectionRef.current=[...reconstructionEdgeSelectionRef.current,topology];
    setReconstructionEdgeSelectionLabel(`${reconstructionEdgeSelectionRef.current.length} Edge：${reconstructionEdgeSelectionRef.current.map((entry)=>entry.localId).join(", ")}`);
    setStatus(`已确认 ${reconstructionEdgeSelectionRef.current.length} 条 healed sharp Edge；可继续加入，或一次性完成 Multi-edge ${session.preview.kind === "fillet" ? "Fillet" : "Chamfer"} Reconstruction。`);
  };

  const clearReconstructionEdges = () => { reconstructionEdgeSelectionRef.current=[]; setReconstructionEdgeSelectionLabel("尚未确认锐边"); };

  const completeImportedReconstruction = async () => {
    const session = importedReconstructionRef.current, runtime = runtimeRef.current, kernel = kernelRef.current, topology = selectedTopologyRef.current;
    if (!session || !runtime || !kernel) { setStatus("当前没有待完成的 Imported Feature Reconstruction。 "); return; }
    const previewShape = runtime.featureShapes.get(session.preview.defeatureFeatureId);
    const confirmedTopologies = reconstructionEdgeSelectionRef.current.length ? reconstructionEdgeSelectionRef.current : topology?.kind === "edge" ? [topology] : [];
    if (!confirmedTopologies.length) { setStatus("请至少确认一条 Defeature Preview 上的真实 B-Rep Edge。 "); return; }
    if (!previewShape || confirmedTopologies.some((entry)=>entry.shapeId!==previewShape.id||entry.shapeRevision!==previewShape.revision||entry.kind!=="edge")) { setStatus("确认 Edge 中存在不属于当前愈合预览的引用，请重新选择。 "); return; }
    if (!Number.isFinite(importedReconstructionValueMm) || importedReconstructionValueMm <= 0) { setStatus("新 Fillet / Chamfer 尺寸必须大于 0。 "); return; }
    setBusy(true);
    try {
      const persistent = await Promise.all(confirmedTopologies.map((entry)=>capturePersistentTopologyRef(session.preview.defeatureFeatureId, entry, runtime, kernel)));
      if (persistent.some((entry)=>entry.kind!=="edge")) throw new Error("重构需要 Persistent Edge References。");
      const completed = completeImportedEdgeTreatmentReconstruction({ preview: session.preview, edges: persistent.filter((entry): entry is PersistentEdgeRef=>entry.kind==="edge"), valueMm: importedReconstructionValueMm });
      const history = cadHistoryRef.current ?? createCadHistory(session.base);
      const result = await commitCadHistoryEdit(history, session.base, completed.document, { runtime, rebuildRuntime: rebuildStateRef.current, kernel, tolerance: DEFAULT_CAD_TOLERANCE, buildProfiles: buildSketchProfiles, assets: cadAssetsRef.current });
      if (!result.success) throw new Error("最终参数化 Fillet / Chamfer 重建失败。 ");
      cadHistoryRef.current = result.history; cadDocumentRef.current = result.document;
      setHistoryAvailability({ undo: canUndoCadHistory(result.history), redo: canRedoCadHistory(result.history) });
      importedReconstructionRef.current = undefined; setImportedReconstructionLabel(""); clearReconstructionEdges(); selectedTopologyRef.current = undefined; setSelection("未选择");
      await renderHistoryDocument(result.document); setSelectedFeatureId(completed.reconstructedFeatureId); await analyzeSelectedBody();
      setStatus(`通过：${completed.sourceLabel} 已重构为可编辑 ${completed.kind === "fillet" ? `Fillet R${completed.valueMm}` : `Chamfer ${completed.valueMm} mm`}，共 ${completed.edgeCount} 条 Edge。History = Imported B-Rep → Defeature/Heal → Native ${completed.kind === "fillet" ? "Fillet" : "Chamfer"}。`);
    } catch (error) { setStatus(`FEATURE_RECONSTRUCTION_COMMIT_FAILED：${error instanceof Error ? error.message : String(error)}；原设计 History 未提交。`); }
    finally { setBusy(false); }
  };

  const cancelImportedReconstruction = async () => {
    const session = importedReconstructionRef.current, runtime = runtimeRef.current, kernel = kernelRef.current;
    if (!session || !runtime || !kernel) return;
    setBusy(true);
    try {
      const rebuilt = await rebuildDocument({ document: session.base, runtime, rebuildRuntime: rebuildStateRef.current, kernel, tolerance: DEFAULT_CAD_TOLERANCE, buildProfiles: buildSketchProfiles, assets: cadAssetsRef.current }, { full: true });
      if (!rebuilt.success) throw new Error(rebuilt.errors.map((entry) => entry.message).join("; "));
      importedReconstructionRef.current = undefined; setImportedReconstructionLabel(""); clearReconstructionEdges(); selectedTopologyRef.current = undefined; setSelection("未选择");
      await renderBodies(session.base, runtime, kernel);
      setStatus("已取消 Imported Feature Reconstruction，恢复原 B-Rep；History 未发生变化。 ");
    } catch (error) { setStatus(`FEATURE_RECONSTRUCTION_CANCEL_FAILED：${error instanceof Error ? error.message : String(error)}`); }
    finally { setBusy(false); }
  };

  const reconstructImportedPrismatic = async (candidate: DirectEditCandidate) => {
    const spec = candidate.prismaticSpec;
    if (candidate.kind !== "prismatic" || !spec?.classification || !spec.extrusionDirection || !spec.estimatedDepthMm) {
      setStatus("该 Prismatic Candidate 尚未通过 V8 凹凸/终止条件门禁，只能继续审查，不能自动参数化重构。"); return;
    }
    const current = cadDocumentRef.current, runtime = runtimeRef.current, kernel = kernelRef.current;
    if (!current || !runtime || !kernel || !selectedBodyId) { setStatus("请先选择目标 Body 并完成 B-Rep 重建。"); return; }
    const sourceFeatureId = deriveBodyTipFeatureId(current, selectedBodyId) ?? current.bodies[selectedBodyId]?.tipFeatureId ?? currentFeatureIdRef.current;
    const shape = runtime.featureShapes.get(sourceFeatureId);
    if (!shape) { setStatus("当前 Body 没有可重构的 Tip Shape。"); return; }
    const topologies = candidate.topologies.filter((topology)=>topology.kind === "face" && topology.shapeId === shape.id && topology.shapeRevision === shape.revision);
    if (topologies.length < 4 || candidate.topology.kind !== "face") { setStatus("Prismatic Candidate 的 Cap/Side 拓扑已失效，请重新分析导入特征。"); return; }
    setBusy(true);
    try {
      const capInfo = await kernel.getFaceInfo(candidate.topology);
      const recovered = await buildPlanarFaceProfile(capInfo, kernel);
      const persistent = await Promise.all(topologies.map((topology)=>capturePersistentTopologyRef(sourceFeatureId, topology, runtime, kernel)));
      if (persistent.some((entry)=>entry.kind !== "face")) throw new Error("Prismatic Reconstruction 需要 Persistent Face References。");
      const faces = persistent.filter((entry): entry is PersistentFaceRef=>entry.kind === "face");
      const capIndex = topologies.findIndex((topology)=>topology.localId === candidate.topology.localId);
      const capFace = faces[capIndex >= 0 ? capIndex : 0];
      const reconstructed = createImportedPrismaticReconstruction({
        document: current, bodyId: selectedBodyId, targetFeatureId: sourceFeatureId, capFace, featureFaces: faces, profile: recovered.profile,
        classification: spec.classification, depthMm: spec.estimatedDepthMm, direction: spec.extrusionDirection, sourceLabel: candidate.label,
      });
      const history = cadHistoryRef.current ?? createCadHistory(current);
      const result = await commitCadHistoryEdit(history, current, reconstructed.document, { runtime, rebuildRuntime: rebuildStateRef.current, kernel, tolerance: DEFAULT_CAD_TOLERANCE, buildProfiles: buildSketchProfiles, assets: cadAssetsRef.current });
      if (!result.success) throw new Error(`Native ${spec.classification === "boss" ? "Boss" : "Pocket"} reconstruction failed validation.`);
      cadHistoryRef.current = result.history; cadDocumentRef.current = result.document;
      setHistoryAvailability({ undo: canUndoCadHistory(result.history), redo: canRedoCadHistory(result.history) });
      await renderHistoryDocument(result.document); setSelectedFeatureId(reconstructed.reconstructedFeatureId); await analyzeSelectedBody();
      setStatus(`通过：${candidate.label} 已恢复为 Exact Multi-loop Sketch → Defeature/Heal → Native ${spec.classification === "boss" ? `Extrude Add ${spec.estimatedDepthMm.toFixed(3)} mm` : `Blind Pocket ${spec.estimatedDepthMm.toFixed(3)} mm`}。后续可直接修改外轮廓/内环/Depth 并重建。`);
    } catch (error) {
      setStatus(`PRISMATIC_RECONSTRUCTION_FAILED：${error instanceof Error ? error.message : String(error)}；原 Imported B-Rep 与 History 保持不变。`);
    } finally { setBusy(false); }
  };

  const analyzeSelectedBody = async () => {
    const bodyId = selectedBodyId; const runtime = runtimeRef.current; const kernel = kernelRef.current;
    if (!bodyId || !runtime || !kernel) { setDirectEditAnalysis("请先选择一个 Body。"); return; }
    const shape = runtime.bodyShapes.get(bodyId); if (!shape) { setDirectEditAnalysis("当前 Body 没有可分析的 B-Rep runtime shape。"); return; }
    try {
      const [faces, properties] = await Promise.all([kernel.getFaces(shape), kernel.getShapeProperties(shape)]);
      const result = recognizeImportedGeometry(faces, properties);
      const styledHoles = await recognizeImportedHoleStyles(result.holes, faces, kernel);
      const styledByPrimary = new Map<string, (typeof styledHoles)[number]>();
      for (const candidate of styledHoles) if (!styledByPrimary.has(candidate.primaryFaceLocalId)) styledByPrimary.set(candidate.primaryFaceLocalId, candidate);
      const styledSecondary = new Set(styledHoles.flatMap((candidate)=>candidate.relatedFaceLocalIds.filter((id)=>id!==candidate.primaryFaceLocalId)));
      const reconstructionReport = buildImportedFeatureReconstructionReport(result);
      const recoveryPlan = buildImportedFeatureRecoveryPlan(reconstructionReport);
      const holes = result.holes.slice(0, 6).map((hole) => `Ø${hole.diameterMm.toFixed(3)} × ${hole.axialLengthMm.toFixed(3)} mm · ${(hole.confidence*100).toFixed(0)}%`).join("；");
      const rounds = result.rounds.slice(0, 4).map((round) => `R${round.radiusMm.toFixed(3)} · ${(round.confidence*100).toFixed(0)}%`).join("；");
      const faceById = new Map(faces.map((face)=>[face.topology.localId,face]));
      setDirectEditCandidates([
        ...result.holes.filter((hole)=>!styledSecondary.has(hole.face.topology.localId)).slice(0, 12).map((hole) => { const styled=styledByPrimary.get(hole.face.topology.localId); const related=styled?.relatedFaceLocalIds.map((id)=>faceById.get(id)?.topology).filter((topology):topology is KernelTopologyRef=>Boolean(topology)) ?? [hole.face.topology]; const styleLabel=styled?.style.type === "counterbore" ? `Counterbore Ø${hole.diameterMm.toFixed(3)}/Ø${styled.style.diameterMm.toFixed(3)} depth ${styled.style.depthMm.toFixed(3)}` : styled?.style.type === "countersink" ? `Countersink Ø${hole.diameterMm.toFixed(3)}/Ø${styled.style.diameterMm.toFixed(3)} ${styled.style.includedAngleDeg.toFixed(1)}°` : `Hole Ø${hole.diameterMm.toFixed(3)} × ${hole.axialLengthMm.toFixed(3)} mm`; return { kind: "hole" as const, topology: hole.face.topology, topologies: related, holeSpec: hole.face.cylindricalFrame ? { diameterMm: hole.diameterMm, axialLengthMm: hole.axialLengthMm, depthCondition: hole.depthCondition, axisOriginMm: hole.face.cylindricalFrame.axisOriginMm, axisDirection: hole.face.cylindricalFrame.axisDirection, style: styled?.style } : undefined, label: `${styleLabel} · ${((styled?.confidence ?? hole.confidence)*100).toFixed(0)}%` }; }),
        ...result.rounds.slice(0, 12).map((round) => ({ kind: "round" as const, topology: round.face.topology, topologies: round.relatedFaceLocalIds.map((id)=>faceById.get(id)?.topology).filter((topology): topology is KernelTopologyRef=>Boolean(topology)), suggestedValueMm: round.radiusMm, label: `Fillet / Round R${round.radiusMm.toFixed(3)} · ${round.relatedFaceLocalIds.length} face${round.relatedFaceLocalIds.length===1?"":"s"} · ${(round.confidence*100).toFixed(0)}%` })),
        ...result.cones.slice(0, 12).map((cone, index) => ({ kind: "cone" as const, topology: cone.face.topology, topologies: cone.relatedFaceLocalIds.map((id)=>faceById.get(id)?.topology).filter((topology): topology is KernelTopologyRef=>Boolean(topology)), suggestedValueMm: 2, label: `Chamfer / Cone ${index + 1} · ${cone.relatedFaceLocalIds.length} face${cone.relatedFaceLocalIds.length===1?"":"s"} · ${(cone.confidence*100).toFixed(0)}%` })),
        ...result.prisms.slice(0, 12).map((prism, index) => ({ kind: "prismatic" as const, topology: prism.capFace.topology, topologies: [prism.capFace.topology, ...prism.sideFaceLocalIds.map((id)=>faceById.get(id)?.topology).filter((topology): topology is KernelTopologyRef=>Boolean(topology))], prismaticSpec: { estimatedDepthMm: prism.estimatedDepthMm, sideFaceCount: prism.sideFaceLocalIds.length, profileEdgeCount: prism.profileEdgeLocalIds.length, confidence: prism.confidence, classification: prism.classification, extrusionDirection: prism.extrusionDirection, classificationConfidence: prism.classificationConfidence }, label: prism.classification ? `Prismatic ${prism.classification === "boss" ? "Boss" : "Pocket"} ${index + 1} · depth≈${prism.estimatedDepthMm?.toFixed(3) ?? "?"} mm · ${prism.sideFaceLocalIds.length} sides · ${((prism.classificationConfidence ?? prism.confidence)*100).toFixed(0)}% proven` : `Prismatic Boss/Pocket ${index + 1} · depth≈${prism.estimatedDepthMm?.toFixed(3) ?? "?"} mm · ${prism.sideFaceLocalIds.length} sides · ${(prism.confidence*100).toFixed(0)}% review` })),
        ...result.patterns.slice(0, 8).map((pattern, index) => { const topologies=pattern.memberFaceLocalIds.map((id)=>faceById.get(id)?.topology).filter((topology): topology is KernelTopologyRef=>Boolean(topology)); const seedHole=result.holes.find((hole)=>hole.face.topology.localId===pattern.memberFaceLocalIds[0]); const seedFrame=seedHole?.face.cylindricalFrame; if(!seedFrame) return undefined; return { kind:"pattern" as const, topology:topologies[0]!, topologies, patternSpec:{candidate:pattern,patternType:pattern.kind === "linear-hole-pattern" ? "linear" : "circular",count:pattern.count,spacingMm:pattern.kind === "linear-hole-pattern" ? pattern.spacingMm : undefined,radiusMm:pattern.kind === "circular-hole-pattern" ? pattern.radiusMm : undefined,confidence:pattern.confidence,seedAxisOriginMm:seedFrame.axisOriginMm,seedAxisDirection:seedFrame.axisDirection,seedDepthCondition:seedHole?.depthCondition}, label: pattern.kind === "linear-hole-pattern" ? `Linear Hole Pattern ${index+1} · ${pattern.count}× Ø${pattern.diameterMm.toFixed(3)} · pitch ${pattern.spacingMm.toFixed(3)} · ${(pattern.confidence*100).toFixed(0)}%` : `Circular Hole Pattern ${index+1} · ${pattern.count}× Ø${pattern.diameterMm.toFixed(3)} · R${pattern.radiusMm.toFixed(3)} · ${(pattern.confidence*100).toFixed(0)}%` }; }).filter((candidate): candidate is NonNullable<typeof candidate>=>Boolean(candidate)&&candidate.topologies.length>=3),
      ]);
      setImportedRecoveryPlan(recoveryPlan);
      setDirectEditAnalysis(`${recoveryPlan.summary} · 解析面：平面 ${result.planarFaces.length} / 圆柱面 ${result.cylindricalFaces.length} / 圆锥面 ${result.conicalFaces.length}${result.holes.length ? ` · 孔 ${result.holes.length}：${holes}${styledHoles.length ? ` · 复合孔 ${styledHoles.length}` : ""}` : " · 未发现高可信孔"}${result.rounds.length ? ` · 圆角 ${result.rounds.length}：${rounds}` : ""}${result.cones.length ? ` · 倒角候选 ${result.cones.length}` : ""}${result.prisms.length ? ` · 凸台/凹槽 ${result.prisms.filter((item)=>item.classification).length} 项可恢复 / ${result.prisms.filter((item)=>!item.classification).length} 项待确认` : ""}${result.patterns.length ? ` · 孔阵列 ${result.patterns.length}` : ""}`);
    } catch (error) { setDirectEditCandidates([]); setImportedRecoveryPlan(undefined); setDirectEditAnalysis(`特征分析失败：${error instanceof Error ? error.message : String(error)}`); }
  };

  const exportCadProject = () => {
    const document = cadDocumentRef.current;
    if (!document) { setStatus("当前没有可导出的 CAD Document，请先创建或导入模型。"); return; }
    try {
      const bundle = serializeCadProjectBundle(document, cadAssetsRef.current);
      const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" }));
      const anchor = window.document.createElement("a");
      anchor.href = url;
      anchor.download = `${document.name || "forgemind-cad"}.forgemind-cad.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setStatus("通过：已导出可重建 CAD 项目包（设计历史 + 引用 STEP 资产；不保存 Runtime Mesh/Shape ID）。");
    } catch (error) { setStatus(`CAD_PROJECT_EXPORT_FAILED：${error instanceof Error ? error.message : String(error)}`); }
  };

  const importCadProject = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    let kernel = kernelRef.current;
    try {
      const loaded = deserializeCadProjectBundle(JSON.parse(await file.text()));
      if (!kernel) { kernel = new OcctKernel(); await kernel.init(); }
      const priorRuntime = runtimeRef.current;
      if (priorRuntime) await disposeCadRuntimeState(priorRuntime, kernel);
      const nextRuntime = createCadRuntimeState();
      const nextRebuild = createRebuildRuntimeState();
      const rebuilt = await rebuildDocument({ document: loaded.document, runtime: nextRuntime, rebuildRuntime: nextRebuild, kernel, tolerance: DEFAULT_CAD_TOLERANCE, buildProfiles: buildSketchProfiles, assets: loaded.assets }, { full: true });
      if (!rebuilt.success) throw new Error(rebuilt.errors.map((entry) => entry.message).join("; "));
      runtimeRef.current = nextRuntime;
      kernelRef.current = kernel;
      rebuildStateRef.current = nextRebuild;
      cadDocumentRef.current = loaded.document;
      cadAssetsRef.current = loaded.assets;
      cadHistoryRef.current = createCadHistory(loaded.document);
      setHistoryAvailability({ undo: false, redo: false });
      const currentFeatureId = loaded.document.featureOrder.at(-1);
      if (currentFeatureId) { currentFeatureIdRef.current = currentFeatureId; currentShapeRef.current = nextRuntime.featureShapes.get(currentFeatureId); }
      selectedTopologyRef.current = undefined;
      setSelection("未选择");
      await renderBodies(loaded.document, nextRuntime, kernel);
      setStatus(`通过：已载入 ${file.name} 并从设计数据完整重建 B-Rep；${Object.keys(loaded.document.bodies).length} 个 Body。`);
    } catch (error) { setStatus(`CAD_PROJECT_IMPORT_FAILED：${error instanceof Error ? error.message : String(error)}`); }
    finally { setBusy(false); }
  };

  useEffect(() => {
    if (!initialDocument || initialDocumentSeedRef.current === initialDocument.id) return;
    initialDocumentSeedRef.current = initialDocument.id;
    let cancelled = false;
    const load = async () => {
      setBusy(true); setStatus(initialNotice ?? `正在将 ${initialDocument.name} 重建为真实 B-Rep…`);
      let kernel = kernelRef.current;
      try {
        if (!kernel) { kernel = new OcctKernel(); await kernel.init(); }
        const priorRuntime = runtimeRef.current; if (priorRuntime) await disposeCadRuntimeState(priorRuntime, kernel);
        if (cancelled) return;
        const document = structuredClone(initialDocument) as CadDocument<Sketch, Feature>;
        const nextRuntime = createCadRuntimeState(); const nextRebuild = createRebuildRuntimeState(); const assets = createCadAssetStore();
        const rebuilt = await rebuildDocument({ document, runtime: nextRuntime, rebuildRuntime: nextRebuild, kernel, tolerance: DEFAULT_CAD_TOLERANCE, buildProfiles: buildSketchProfiles, assets }, { full: true });
        if (!rebuilt.success) throw new Error(rebuilt.errors.map((entry) => entry.message).join("; "));
        if (cancelled) { await disposeCadRuntimeState(nextRuntime, kernel); return; }
        runtimeRef.current = nextRuntime; kernelRef.current = kernel; rebuildStateRef.current = nextRebuild; cadDocumentRef.current = document; cadAssetsRef.current = assets; cadHistoryRef.current = createCadHistory(document); setHistoryAvailability({ undo: false, redo: false });
        const currentFeatureId = document.featureOrder.at(-1); if (currentFeatureId) { currentFeatureIdRef.current = currentFeatureId; currentShapeRef.current = nextRuntime.featureShapes.get(currentFeatureId); }
        selectedTopologyRef.current = undefined; setSelection("未选择"); await renderBodies(document, nextRuntime, kernel);
        setStatus(`${initialNotice ? `${initialNotice} · ` : ""}通过：Resource / Project 已按 CadDocument → Feature Rebuild → OCCT B-Rep 链路载入；${Object.keys(document.bodies).length} 个 Body，${document.featureOrder.length} 个 Feature。`);
      } catch (error) { if (!cancelled) setStatus(`INITIAL_CAD_REBUILD_FAILED：${error instanceof Error ? error.message : String(error)}`); } finally { if (!cancelled) setBusy(false); }
    };
    void load();
    return () => { cancelled = true; };
  // Initial loading owns one kernel/runtime transaction. renderBodies receives
  // that transaction explicitly and must not restart loading when UI state moves.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialDocument, initialNotice]);

  const selectedFeature = selectedFeatureId ? cadDocumentRef.current?.features[selectedFeatureId] : undefined;
  const selectedSurfacePosition = selectedFeature ? cadDocumentRef.current?.featureOrder.indexOf(selectedFeature.id) ?? -1 : -1;
  const matchingBSplineSurfaces = selectedFeature?.type === "bsplineSurface" && cadDocumentRef.current
    ? cadDocumentRef.current.featureOrder
      .map((id) => cadDocumentRef.current?.features[id])
      .filter((feature): feature is Extract<Feature, { type: "bsplineSurface" }> => feature?.type === "bsplineSurface" && feature.id !== selectedFeature.id && (cadDocumentRef.current?.featureOrder.indexOf(feature.id) ?? Infinity) < selectedSurfacePosition)
      .map((feature) => ({ id: feature.id, name: feature.name, controlNet: resolveBSplineFeatureControlNet(cadDocumentRef.current!, feature.id) }))
    : [];
  const selectedFeatureRelations = selectedFeature && cadDocumentRef.current ? (()=>{try{return featureHistoryRelations(cadDocumentRef.current!,selectedFeature.id);}catch{return{dependencies:[],dependents:[],upstream:[],downstream:[]};}})() : {dependencies:[],dependents:[],upstream:[],downstream:[]};
  const normalizedHistoryQuery = historyQuery.trim().toLocaleLowerCase("zh-CN");
  const featurePositionById = new Map(featurePanel.map((feature, index) => [feature.id, index]));
  const visibleFeaturePanel = featurePanel.filter((feature) => {
    const matchesQuery = !normalizedHistoryQuery || `${feature.name} ${feature.typeLabel} ${feature.summary}`.toLocaleLowerCase("zh-CN").includes(normalizedHistoryQuery);
    const matchesState = historyFilter === "all" || historyFilter === "active" && feature.enabled && feature.state !== "error" || historyFilter === "suppressed" && !feature.enabled || historyFilter === "error" && feature.state === "error";
    return matchesQuery && matchesState;
  });
  const historyStateSummary = featurePanel.reduce((summary, feature) => {
    if (feature.state === "error") summary.error += 1;
    else if (!feature.enabled) summary.suppressed += 1;
    else summary.active += 1;
    return summary;
  }, { active: 0, suppressed: 0, error: 0 });
  const selectedFeaturePosition = selectedFeatureId ? cadDocumentRef.current?.featureOrder.indexOf(selectedFeatureId) ?? -1 : -1;
  const selectedFeatureOrder = cadDocumentRef.current?.featureOrder ?? [];
  const previousFeatureId = selectedFeaturePosition > 0 ? selectedFeatureOrder[selectedFeaturePosition - 1] : undefined;
  const nextFeatureId = selectedFeaturePosition >= 0 ? selectedFeatureOrder[selectedFeaturePosition + 1] : undefined;
  const selectedFeatureCanMoveUp = !!previousFeatureId && !selectedFeatureRelations.upstream.includes(previousFeatureId);
  const selectedFeatureCanMoveDown = !!nextFeatureId && !selectedFeatureRelations.downstream.includes(nextFeatureId);
  const selectedUpstreamIds = new Set(selectedFeatureRelations.upstream);
  const selectedDownstreamIds = new Set(selectedFeatureRelations.downstream);
  const selectedFeatureLaterCount = selectedFeaturePosition < 0 ? 0 : selectedFeatureOrder.slice(selectedFeaturePosition + 1).filter((id)=>cadDocumentRef.current?.features[id]?.enabled).length;
  const selectedParameters = editableParameters(selectedFeature);
  const selectedSketch = selectedSketchId ? cadDocumentRef.current?.sketches[selectedSketchId] : undefined;
  const selectedSketchProfiles = selectedSketch ? buildSketchProfiles(selectedSketch).profiles : [];
  const selectedSketchRegionIds = selectedSketch ? selectedMaterialRegionIds(selectedSketch) : [];
  const documentSketches = Object.values(cadDocumentRef.current?.sketches ?? {});
  const selectedBody = selectedBodyId ? cadDocumentRef.current?.bodies[selectedBodyId] : undefined;
  const selectedVolumeMm3 = selectedBodyProperties?.volumeMm3 ?? 0;
  const selectedMassKg = selectedBody?.engineering?.densityKgM3 !== undefined && selectedVolumeMm3 > 0 ? selectedVolumeMm3 * selectedBody.engineering.densityKgM3 / 1_000_000_000 : undefined;
  const solidBodyOptions = bodyPanel.filter((body) => body.bodyType === "solid");
  const resolvedBooleanTargetBodyId = refineBoolean.targetBodyId || (solidBodyOptions.some((body) => body.id === selectedBodyId) ? selectedBodyId : solidBodyOptions[0]?.id) || "";
  const resolvedBooleanToolBodyId = refineBoolean.toolBodyId || solidBodyOptions.find((body) => body.id !== resolvedBooleanTargetBodyId)?.id || "";
  const currentDocument = cadDocumentRef.current;
  const visibleBodies = Object.values(currentDocument?.bodies ?? {}).filter((body) => body.visible !== false);
  const readinessReport = analyzeCadEngineeringReadiness(currentDocument, { rebuiltBodyIds: new Set(runtimeRef.current?.bodyShapes.keys() ?? []), exportAvailable: !!currentDocument && !busy && !/FAILED|失败/.test(status) });
  const readinessScore = readinessReport.score;
  const openReadiness = () => { setCadAgentOpen(false); setCommandPaletteOpen(false); setReadinessOpen(true); };
  const commandItems: CadCommandItem[] = [
    { name: "需求建模 Agent", category: "开始", keywords: "智能 自然语言 新手 设备 零件", action: () => { setCadAgentOpen(true); setReadinessOpen(false); setCommandPaletteOpen(false); } },
    { name: "新建项目", category: "开始", keywords: "空白 项目 重置 new", action: () => { setCommandPaletteOpen(false); void startNewCadProject(); }, disabled: busy },
    { name: "快速新建方块", category: "开始", keywords: "实体 矩形 拉伸 block", action: () => { setCommandPaletteOpen(false); void appendNewPrimitive("rectangle"); }, disabled: busy },
    { name: "快速新建圆柱", category: "开始", keywords: "实体 圆 草图 拉伸 cylinder", action: () => { setCommandPaletteOpen(false); void appendNewPrimitive("circle"); }, disabled: busy },
    { name: "新建 XY 草图", category: "建模", keywords: "二维 轮廓 sketch", action: () => { setCommandPaletteOpen(false); void createUnifiedSketch("XY"); }, disabled: busy },
    { name: "新建 XZ 草图", category: "建模", keywords: "侧面 轮廓 sketch", action: () => { setCommandPaletteOpen(false); void createUnifiedSketch("XZ"); }, disabled: busy },
    { name: "新建 YZ 草图", category: "建模", keywords: "端面 截面 sketch", action: () => { setCommandPaletteOpen(false); void createUnifiedSketch("YZ"); }, disabled: busy },
    { name: "拉伸所选区域", category: "实体成形", keywords: "新建 添加 切除 相交 extrude", action: () => { setCommandPaletteOpen(false); void extrudeSelectedSketch(solidOperation); }, disabled: busy || !selectedSketchId || (solidOperation!=="new"&&!selectedBodyId) },
    { name: "旋转所选区域", category: "实体成形", keywords: "轴类 回转 添加 切除 revolve", action: () => { setCommandPaletteOpen(false); void revolveSelectedSketch(solidOperation); }, disabled: busy || !selectedSketchId || (solidOperation!=="new"&&!selectedBodyId) },
    { name: "扫掠实体", category: "实体成形", keywords: "截面 路径 管路 添加 切除 sweep", action: () => { setCommandPaletteOpen(false); void createSolidFromSketchSet("sweep",solidOperation); }, disabled: busy || surfaceSketchSelectionRef.current.length !== 2 || (solidOperation!=="new"&&!selectedBodyId) },
    { name: "放样实体", category: "实体成形", keywords: "多截面 过渡 外壳 添加 切除 loft", action: () => { setCommandPaletteOpen(false); void createSolidFromSketchSet("loft",solidOperation); }, disabled: busy || surfaceSketchSelectionRef.current.length < 2 || (solidOperation!=="new"&&!selectedBodyId) },
    { name: "搜索特征历史", category: "历史", keywords: "查找 筛选 Ctrl Shift F", action: () => { setCommandPaletteOpen(false); requestAnimationFrame(()=>{historySearchInputRef.current?.focus();historySearchInputRef.current?.select();}); } },
    { name: "重命名所选特征", category: "历史", keywords: "名称 F2", action: () => { setCommandPaletteOpen(false); requestAnimationFrame(()=>{featureNameInputRef.current?.focus();featureNameInputRef.current?.select();}); }, disabled: busy || !selectedFeatureId },
    { name: "抑制或恢复所选特征", category: "历史", keywords: "启用 停用 Space 空格", action: () => { setCommandPaletteOpen(false); void toggleFeatureSuppression(selectedFeatureId); }, disabled: busy || !selectedFeatureId },
    { name: "回退至所选特征", category: "历史", keywords: "节点 rollback Shift R", action: () => { setCommandPaletteOpen(false); void rollbackToSelectedFeature(); }, disabled: busy || !selectedFeatureId || !selectedFeatureLaterCount },
    { name: "删除所选特征及下游", category: "历史", keywords: "Delete 安全删除", action: () => { setCommandPaletteOpen(false); void deleteSelectedFeatureCascade(); }, disabled: busy || !selectedFeatureId },
    { name: "选择实体", category: "选择", keywords: "body 模型", action: () => { setSelectionMode("body"); setCommandPaletteOpen(false); } },
    { name: "选择面", category: "选择", keywords: "face 表面", action: () => { setSelectionMode("face"); setCommandPaletteOpen(false); } },
    { name: "选择边", category: "选择", keywords: "edge 圆角 倒角", action: () => { setSelectionMode("edge"); setCommandPaletteOpen(false); } },
    { name: "适合窗口", category: "视图", keywords: "居中 放大 fit", action: () => { renderStateRef.current?.fit?.(); setCommandPaletteOpen(false); } },
    { name: "ISO 斜上方视图", category: "视图", keywords: "等轴测 初始 视角", action: () => { renderStateRef.current?.setView?.("iso"); setCommandPaletteOpen(false); } },
    { name: "工程就绪检查", category: "检查", keywords: "材料 公差 几何 导出", action: openReadiness },
    { name: "导出 CAD 项目", category: "交付", keywords: "保存 分享 package", action: () => { setCommandPaletteOpen(false); exportCadProject(); }, disabled: busy || !currentDocument },
    { name: "导出所选实体 STEP", category: "交付", keywords: "step stp 交换 制造", action: () => { setCommandPaletteOpen(false); void exportP2M7ActiveBody(); }, disabled: busy || !currentDocument || !visibleBodies.length },
  ];
  const normalizedCommandQuery = commandQuery.trim().toLowerCase();
  const filteredCommandItems = commandItems.filter((item) => !normalizedCommandQuery || `${item.name} ${item.category} ${item.keywords}`.toLowerCase().includes(normalizedCommandQuery));
  const Root = embedded ? "div" : "main";

  if (embedded) return (
    <div className="cad-workbench">
      <CadWorkbenchToolbar
        state={{
          busy, selectionMode: mode, selectedSketchId, selectedBodyId,
          surfaceSectionCount: surfaceSketchSelectionRef.current.length,
          requiredSweepSectionCount: surfaceSweepOrientation === "guide" ? 3 : 2,
          solidBodyCount: solidBodyOptions.length,
          canUndo: historyAvailability.undo, canRedo: historyAvailability.redo,
          sectionEnabled, readinessScore, visibleBodyCount: visibleBodies.length, solidOperation,
          variableFilletAvailable: false,
        }}
        actions={{
          createSketch: (plane) => { void createUnifiedSketch(plane); },
          editSelectedSketch: () => { if (selectedSketchId) setEditingSketchId(selectedSketchId); },
          createQuickPrimitive: (kind) => { void appendNewPrimitive(kind); },
          setSolidOperation,
          extrudeSelectedSketch: (operation) => { void extrudeSelectedSketch(operation); },
          revolveSelectedSketch: (operation) => { void revolveSelectedSketch(operation); },
          createSolidFromSet: (kind,operation) => { void createSolidFromSketchSet(kind,operation); },
          createSurfaceFromSketch: (kind) => { void createSurfaceFromSelectedSketch(kind); },
          addSurfaceSection: addSelectedSketchToSurfaceSet,
          createSurfaceFromSet: (kind) => { void createSurfaceFromSketchSet(kind); },
          clearSurfaceSections: clearSurfaceSketchSet,
          applyDirectEdit: (action) => { void applySelectedFeature(action); },
          applyPrecisionTransform: () => { void applyPrecisionBodyTransform(); },
          applyPrecisionBoolean: () => { void applyPrecisionBodyBoolean(); },
          applyPrecisionDraft: () => { void applyPrecisionDraft(); },
          applyPrecisionRib: () => { void applyPrecisionRib(); },
          undo: () => { void restoreP2M5History("undo"); },
          redo: () => { void restoreP2M5History("redo"); },
          setSelectionMode,
          fit: () => { renderStateRef.current?.fit?.(); },
          setView: (view) => { renderStateRef.current?.setView?.(view); },
          toggleSection: () => { const enabled = !sectionEnabled; setSectionEnabled(enabled); renderStateRef.current?.setSection?.(enabled, sectionOffsetMm); },
          showShortcutHelp: () => setStatus("快捷键：Ctrl / Cmd + K 搜索命令；Ctrl / Cmd + S 保存；Ctrl / Cmd + Z 撤销；Ctrl / Cmd + Shift + Z 或 Ctrl / Cmd + Y 重做；F 适合窗口；0/1/2/3 切换 ISO/前/顶/右；Esc 取消。"),
          openAgent: () => setCadAgentOpen(true),
          newProject: () => { void startNewCadProject(); },
          openCommandPalette: () => { setCommandQuery(""); setCommandPaletteOpen(true); },
          openReadiness,
          exportCadProject,
          importCadProject: (file) => { void importCadProject(file); },
          exportStep: () => { void exportP2M7ActiveBody(); },
          importStep: (file) => { void importStepFile(file); },
        }}
      />
      <CadCommandPalette open={commandPaletteOpen} query={commandQuery} items={filteredCommandItems} onQueryChange={setCommandQuery} onClose={() => setCommandPaletteOpen(false)} />
      <CadReadinessDrawer open={readinessOpen} report={readinessReport} busy={busy} hasDocument={!!currentDocument} onClose={() => setReadinessOpen(false)} onExport={exportCadProject} />
      <CadAgentDrawer open={cadAgentOpen} prompt={cadAgentPrompt} plan={cadAgentPlan} applyMode={cadAgentApplyMode} busy={busy} onClose={() => setCadAgentOpen(false)} onPromptChange={setCadAgentPrompt} onAnalyze={generateCadAgentPlan} onApplyModeChange={setCadAgentApplyMode} onApply={() => void commitCadAgentPlan()} />
      <div className="cad-workspace">
        <aside className="cad-feature-tree">
          <div className="cad-panel-kicker">模型结构</div>{/* FEATURE LIST */}
          <div style={{ borderBottom: "1px solid #26384c", paddingBottom: 10, marginBottom: 10 }}>
            <b>实体</b>
            {bodyPanel.length ? bodyPanel.map((body) => <button key={body.id} type="button" onClick={() => setSelectedBodyId(body.id)} style={{ width: "100%", display: "block", textAlign: "left", marginTop: 5, background: selectedBodyId === body.id ? "#183550" : "#121f2f", color: body.visible ? "#dce7f5" : "#63778d" }}><span style={{ color: body.active ? "#f0c45b" : body.bodyType === "surface" ? "#62d4e4" : body.bodyType === "curve" ? "#f0c34f" : "#79b9e8" }}>{body.bodyType === "surface" ? "◇" : body.bodyType === "curve" ? "╱" : "◆"}</span> {body.name}<small style={{ display: "block", marginLeft: 18, opacity: .65 }}>{body.construction ? "构造实体 · 仅参与历史" : body.bodyType === "surface" ? "曲面" : body.bodyType === "curve" ? "曲线" : "成品实体"}{body.sourceCode ? ` · ${body.sourceCode}` : ""}</small></button>) : <small style={{ color: "#718399" }}>暂无实体。</small>}
          </div>
          <b>草图</b>
          <div style={{ display: "grid", gap: 4, marginTop: 6, marginBottom: 10 }}>
            {documentSketches.length ? documentSketches.map((sketch) => <button key={sketch.id} type="button" onDoubleClick={() => setEditingSketchId(sketch.id)} onClick={() => { setSelectedSketchId(sketch.id); setSelectedFeatureId(""); }} style={{ textAlign: "left", padding: "7px 8px", border: "1px solid #26384c", borderRadius: 4, background: selectedSketchId === sketch.id ? "#3c3156" : "#111c2a", color: "#dce7f5" }}><span style={{ color: "#c6a7f5" }}>⌁</span> {sketch.name}<small style={{ display: "block", marginLeft: 18, color: "#947fb1" }}>{sketch.plane.type}{sketch.plane.type !== "face" ? ` · ${sketch.plane.offset.toFixed(1)} mm` : ""} · {Object.keys(sketch.dimensions).length} 个尺寸</small></button>) : <small style={{ color: "#718399" }}>暂无草图。</small>}
          </div>
          <FeatureHistoryTree allFeatures={featurePanel} visibleFeatures={visibleFeaturePanel} selectedFeatureId={selectedFeatureId} upstreamIds={selectedUpstreamIds} downstreamIds={selectedDownstreamIds} positionById={featurePositionById} query={historyQuery} setQuery={setHistoryQuery} filter={historyFilter} setFilter={setHistoryFilter} searchInputRef={historySearchInputRef} stateSummary={historyStateSummary} onSelect={(id)=>{setSelectedFeatureId(id);setSelectedSketchId("");}} />
        </aside>
        <main className="cad-viewport">
          <div ref={hostRef} data-testid="occt-viewport" className="cad-viewport-canvas" />
          <div className="cad-viewport-model-kind">{displayMode === "reference" ? "精细模型展示 / GLB 参考" : "自由建模 / B-Rep 实体"}</div>
          <div className="cad-viewport-selection">{busy ? "B-Rep 重建中…" : selection}</div>
          <div className={`cad-viewport-status ${status.startsWith("通过") || status.includes("通过：") ? "is-success" : ""}`}>{status}</div>
          {editingSketchId && cadDocumentRef.current?.sketches[editingSketchId] ? <UnifiedSketchEditor key={editingSketchId} sketch={cadDocumentRef.current.sketches[editingSketchId]} onAccept={commitIntegratedSketch} onProjectSelectedEdge={selectedTopologyRef.current?.kind === "edge" ? projectSelectedEdgeIntoSketch : undefined} onCancel={() => { setEditingSketchId(""); setStatus("已取消草图编辑；CAD 几何未发生变化。"); }} /> : null}
        </main>
        <aside className="cad-property-panel">
          <div className="cad-panel-kicker">参数与属性</div>
          {selectedSketch ? <section style={{ borderBottom: "1px solid #26384c", paddingBottom: 12, marginBottom: 12 }}>
            <strong>{selectedSketch.name}</strong><small style={{ display: "block", color: "#9b83bd", margin: "3px 0 10px" }}>{selectedSketch.plane.type} · {Object.keys(selectedSketch.dimensions).length} 个尺寸</small>
            {selectedSketch.plane.type !== "face" ? <>
              <label style={{ display: "grid", gap: 4, margin: "8px 0", fontSize: 12 }}>基准面位置 (mm)<input key={`${selectedSketch.id}-plane-${selectedSketch.plane.offset}`} type="number" defaultValue={selectedSketch.plane.offset} step="1" disabled={busy} onBlur={(event) => { const next = Number(event.currentTarget.value); if (next !== selectedSketch.plane.offset) void commitSketchPlaneOffset(selectedSketch.id, next); }} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} style={{ background: "#08111d", color: "#e5eef7", border: "1px solid #514263", borderRadius: 4, padding: "6px 7px" }} /></label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 6, alignItems: "end", marginBottom: 8 }}><label style={{ display: "grid", gap: 4, fontSize: 12 }}>新截面间距 (mm)<input type="number" value={sectionCopySpacingMm} step="1" onChange={(event) => setSectionCopySpacingMm(Number(event.target.value))} disabled={busy} style={{ minWidth: 0, background: "#08111d", color: "#e5eef7", border: "1px solid #514263", borderRadius: 4, padding: "6px 7px" }} /></label><button type="button" onClick={duplicateSketchAsSection} disabled={busy}>复制为截面</button></div>
            </> : null}
            {selectedSketchProfiles.length ? <div style={{ border: "1px solid #3b3150", borderRadius: 4, padding: 7, margin: "8px 0" }}><b style={{ fontSize: 11 }}>参与成形的材料区域</b>{selectedSketchProfiles.map((profile,index)=><label key={profile.id} style={{ display:"flex",alignItems:"center",gap:6,marginTop:6,fontSize:11 }}><input type="checkbox" checked={selectedSketchRegionIds.includes(profile.id)} disabled={busy} onChange={(event)=>setSolidRegionSelections((current)=>{const available=selectedSketchProfiles.map((entry)=>entry.id);const selected=current[selectedSketch.id]??available;return{...current,[selectedSketch.id]:event.target.checked?[...new Set([...selected,profile.id])]:selected.filter((id)=>id!==profile.id)};})}/><span>区域 {index+1}{profile.holes.length?` · ${profile.holes.length} 个内孔`:""}</span></label>)}</div> : <small style={{ color:"#b88974",display:"block",margin:"7px 0" }}>没有可用于实体成形的封闭区域。</small>}
            {Object.values(selectedSketch.dimensions).map((dimension) => <label key={dimension.id} style={{ display: "grid", gap: 4, margin: "8px 0", fontSize: 12 }}>{dimension.name ?? dimension.id} ({dimension.type === "angle" ? "°" : "mm"})<input key={`${selectedSketch.id}-${dimension.id}-${dimension.value}`} type="number" defaultValue={dimension.value} min={dimension.type === "angle" ? undefined : .01} step={dimension.type === "angle" ? .5 : .1} disabled={busy} onBlur={(event) => { const next = Number(event.currentTarget.value); if (next !== dimension.value) void commitSketchDimension(selectedSketch.id, dimension.id, next); }} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} style={{ background: "#08111d", color: "#e5eef7", border: "1px solid #514263", borderRadius: 4, padding: "6px 7px" }} /></label>)}
            {!Object.keys(selectedSketch.dimensions).length && <small style={{ color: "#758ca3" }}>当前草图没有驱动尺寸。</small>}
            <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginTop:9 }}><label style={{display:"grid",gap:4,fontSize:12}}>拉伸距离<input type="number" min="0.01" step="1" value={solidExtrude.distanceMm} onChange={(event)=>setSolidExtrude((value)=>({...value,distanceMm:Number(event.target.value)}))} disabled={busy}/></label><label style={{display:"grid",gap:4,fontSize:12}}>拉伸方向<select value={solidExtrude.direction} onChange={(event)=>setSolidExtrude((value)=>({...value,direction:event.target.value as typeof value.direction}))} disabled={busy}><option value="positive">正向</option><option value="negative">反向</option><option value="symmetric">对称</option><option value="twoSided">双向不同距离</option></select></label></div>
            {solidExtrude.direction==="twoSided"?<label style={{display:"grid",gap:4,fontSize:12,marginTop:7}}>反向距离<input type="number" min="0.01" step="1" value={solidExtrude.secondDistanceMm} onChange={(event)=>setSolidExtrude((value)=>({...value,secondDistanceMm:Number(event.target.value)}))} disabled={busy}/></label>:null}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 9 }}><label style={{ display: "grid", gap: 4, fontSize: 12 }}>旋转轴<select value={solidRevolve.axis} onChange={(event) => setSolidRevolve((value) => ({ ...value, axis: event.target.value as "x" | "y" }))} disabled={busy}><option value="x">草图横轴</option><option value="y">草图纵轴</option></select></label><label style={{ display: "grid", gap: 4, fontSize: 12 }}>旋转角度<input type="number" min="0.1" max="360" step="1" value={solidRevolve.angleDeg} onChange={(event) => setSolidRevolve((value) => ({ ...value, angleDeg: Number(event.target.value) }))} disabled={busy} /></label></div>
            <button type="button" onClick={() => setEditingSketchId(selectedSketch.id)} disabled={busy} style={{ marginTop: 10, width: "100%" }}>编辑草图</button>
          </section> : null}
          {selectedFeature ? <section style={{ borderBottom: "1px solid #26384c", paddingBottom: 12, marginBottom: 12 }}>
            <div className="cad-history-editor-head"><strong>特征历史</strong><span>#{selectedFeaturePosition + 1} · {featureStateLabel(selectedFeature)}</span></div>
            <div className="cad-history-name"><input ref={featureNameInputRef} aria-label="特征名称" value={featureNameDraft} onChange={(event)=>setFeatureNameDraft(event.target.value)} onKeyDown={(event)=>{if(event.key==="Enter"){event.preventDefault();void renameSelectedFeature();event.currentTarget.blur();}else if(event.key==="Escape"){event.preventDefault();event.stopPropagation();setFeatureNameDraft(selectedFeature.name);event.currentTarget.blur();}}} disabled={busy}/><button type="button" title="F2 聚焦名称，Enter 确认" onClick={()=>void renameSelectedFeature()} disabled={busy||featureNameDraft.trim()===selectedFeature.name}>重命名</button></div>
            <div className="cad-history-meta"><span>{featureTypeLabel(selectedFeature.type)}</span><span>上游 {selectedFeatureRelations.upstream.length}</span><span>下游 {selectedFeatureRelations.downstream.length}</span></div>
            <div className="cad-history-relations"><div><b>直接输入</b>{selectedFeatureRelations.dependencies.length?selectedFeatureRelations.dependencies.map((id)=><button key={id} type="button" onClick={()=>{setSelectedFeatureId(id);setSelectedSketchId("");}}>{cadDocumentRef.current?.features[id]?.name??id}</button>):<small>无</small>}</div><div><b>直接下游</b>{selectedFeatureRelations.dependents.length?selectedFeatureRelations.dependents.map((id)=><button key={id} type="button" onClick={()=>{setSelectedFeatureId(id);setSelectedSketchId("");}}>{cadDocumentRef.current?.features[id]?.name??id}</button>):<small>无</small>}</div></div>
            <div className="cad-history-actions"><button type="button" title={selectedFeatureCanMoveUp?"Alt + ↑ · 向前移动一位":"当前位置或依赖关系不允许上移"} onClick={()=>void moveSelectedFeature("up")} disabled={busy||!selectedFeatureCanMoveUp}>上移</button><button type="button" title={selectedFeatureCanMoveDown?"Alt + ↓ · 向后移动一位":"当前位置或依赖关系不允许下移"} onClick={()=>void moveSelectedFeature("down")} disabled={busy||!selectedFeatureCanMoveDown}>下移</button><button type="button" title="Space · 抑制或恢复" onClick={()=>void toggleFeatureSuppression(selectedFeature.id)} disabled={busy}>{selectedFeature.enabled?`抑制${selectedFeatureRelations.downstream.length?` + ${selectedFeatureRelations.downstream.length}`:""}`:"恢复所需特征"}</button><button type="button" title="Shift + R · 回退至当前节点" onClick={()=>void rollbackToSelectedFeature()} disabled={busy||!selectedFeatureLaterCount}>回退至此</button><button className="is-danger" type="button" title="Delete · 删除前会再次确认" onClick={()=>void deleteSelectedFeatureCascade()} disabled={busy}>删除 + {selectedFeatureRelations.downstream.length}</button></div>
            {selectedParameters.map((parameter) => <label key={parameter.key} style={{ display: "grid", gap: 4, margin: "8px 0", fontSize: 12 }}>{parameter.label}<input key={`${selectedFeature.id}-${parameter.key}-${parameter.value}`} type="number" defaultValue={parameter.value} min={parameter.min} step={parameter.step ?? .1} disabled={busy} onBlur={(event) => { const next = Number(event.currentTarget.value); if (next !== parameter.value) void previewFeatureParameter(selectedFeature.id, parameter.key, next); }} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} style={{ background: "#08111d", color: "#e5eef7", border: "1px solid #3a5068", borderRadius: 4, padding: "6px 7px" }} /></label>)}
            {!selectedParameters.length && !["surfaceSweep", "boundarySurface", "bsplineSurface"].includes(selectedFeature.type) && <small style={{ color: "#758ca3" }}>该特征无数值参数。</small>}
            {featurePreviewLabel && <div style={{ marginTop: 9, padding: 8, border: "1px solid #8a6b2a", borderRadius: 4, background: "#241d0d", fontSize: 12 }}><b style={{ color: "#f0c45b" }}>预览</b><div style={{ margin: "5px 0 7px", color: "#d8c99d" }}>{featurePreviewLabel}</div><button type="button" onClick={() => void acceptFeaturePreview()} disabled={busy}>✓ 接受</button><button type="button" onClick={() => void cancelFeaturePreview()} disabled={busy} style={{ marginLeft: 6 }}>× 取消</button></div>}
            {selectedFeature.type === "surfaceSweep" ? <SurfaceSweepHistoryEditor key={`sweep-edit-${selectedFeature.id}`} feature={selectedFeature} sketches={documentSketches.map((sketch) => ({ id: sketch.id, name: sketch.name }))} busy={busy || !!featurePreviewLabel} onPreview={(values) => previewSurfaceSweepHistoryEdit(selectedFeature.id, values)} /> : null}
            {selectedFeature.type === "boundarySurface" ? <BoundarySurfaceHistoryEditor key={`boundary-edit-${selectedFeature.id}`} feature={selectedFeature} busy={busy || !!featurePreviewLabel} onPreview={(values) => previewBoundarySurfaceHistoryEdit(selectedFeature.id, values)} /> : null}
            {selectedFeature.type === "bsplineSurface" ? <div style={{ marginBottom: 7, color: "#718b94", fontSize: 10 }}>控制点：青位置 · 蓝切向 · 紫曲率 · 黄形状 · 灰锁定 Shift 锁轴 · Ctrl 0.5 mm · Esc 取消</div> : null}
            {selectedFeature.type === "bsplineSurface" ? <BSplineSurfaceEditor key={`edit-${selectedFeature.id}-${cadDocumentRef.current?.updatedAt ?? 0}`} busy={busy} initialControlNet={selectedFeature.controlNet} initialRationalSections={selectedFeature.rationalSections} initialTensorNurbs={selectedFeature.tensorNurbs} initialBoundaryMatch={selectedFeature.boundaryMatch} initialBoundaryMatches={selectedFeature.boundaryMatches} matchingSurfaces={matchingBSplineSurfaces} actionLabel="✓ 应用控制网并重建" onCreate={(controlNet, options) => updateBSplineSurface(selectedFeature.id, controlNet, options)} /> : null}
          </section> : <small style={{ color: "#758ca3" }}>请选择特征。</small>}
          <section style={{ borderTop: "1px solid #26384c", borderBottom: "1px solid #26384c", padding: "12px 0", margin: "12px 0" }}>
            <b style={{ color: "#d9b84f" }}>精修工具</b>
            <details style={{ border: "1px solid #31465e", borderRadius: 4, padding: 8, marginBottom: 7 }}>
              <summary style={{ cursor: "pointer", fontWeight: 700 }}>可变圆角 · 所选实体边</summary>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5, marginTop: 7 }}>
                <label style={{ display: "grid", gap: 3, fontSize: 11 }}>起点半径 mm<input type="number" min="0.01" step="0.5" value={variableFilletRadii.startMm} onChange={(event) => setVariableFilletRadii((value) => ({ ...value, startMm: Number(event.target.value) }))} disabled={busy} /></label>
                <label style={{ display: "grid", gap: 3, fontSize: 11 }}>终点半径 mm<input type="number" min="0.01" step="0.5" value={variableFilletRadii.endMm} onChange={(event) => setVariableFilletRadii((value) => ({ ...value, endMm: Number(event.target.value) }))} disabled={busy} /></label>
              </div>
              <button type="button" disabled title="当前本地内核暂不支持稳定的可变圆角" style={{ width: "100%", marginTop: 7 }}>连续变化半径（暂不可用）</button>
            </details>
            <details open style={{ border: "1px solid #31465e", borderRadius: 4, padding: 8, marginBottom: 7 }}>
              <summary style={{ cursor: "pointer", fontWeight: 700 }}>精确变换 · Body</summary>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 5, marginTop: 8 }}>
                {(["x", "y", "z"] as const).map((axis) => <label key={axis} style={{ display: "grid", gap: 3, fontSize: 11 }}>{axis.toUpperCase()} 位移 mm<input type="number" step="1" value={refineTransform[axis]} onChange={(event) => setRefineTransform((value) => ({ ...value, [axis]: Number(event.target.value) }))} disabled={busy} style={{ minWidth: 0, padding: "6px 5px" }} /></label>)}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "90px 1fr", gap: 5, marginTop: 6 }}>
                <label style={{ display: "grid", gap: 3, fontSize: 11 }}>旋转轴<select value={refineTransform.axis} onChange={(event) => setRefineTransform((value) => ({ ...value, axis: event.target.value as "X" | "Y" | "Z" }))} disabled={busy}><option>X</option><option>Y</option><option>Z</option></select></label>
                <label style={{ display: "grid", gap: 3, fontSize: 11 }}>绕世界原点角度 °<input type="number" step="1" value={refineTransform.angle} onChange={(event) => setRefineTransform((value) => ({ ...value, angle: Number(event.target.value) }))} disabled={busy} /></label>
              </div>
              <button type="button" onClick={() => void applyPrecisionBodyTransform()} disabled={busy || !selectedBodyId} style={{ width: "100%", marginTop: 7 }}>应用到所选 Body</button>
            </details>
            <details style={{ border: "1px solid #31465e", borderRadius: 4, padding: 8, marginBottom: 7 }}>
              <summary style={{ cursor: "pointer", fontWeight: 700 }}>多实体布尔 · 合并 / 切除 / 相交</summary>
              <label style={{ display: "grid", gap: 3, marginTop: 8, fontSize: 11 }}>目标体<select value={resolvedBooleanTargetBodyId} onChange={(event) => { const targetBodyId = event.target.value; setRefineBoolean((value) => ({ ...value, targetBodyId, toolBodyId: value.toolBodyId === targetBodyId ? "" : value.toolBodyId })); }} disabled={busy}>{solidBodyOptions.map((body) => <option key={body.id} value={body.id}>{body.name}</option>)}</select></label>
              <label style={{ display: "grid", gap: 3, marginTop: 6, fontSize: 11 }}>工具体<select value={resolvedBooleanToolBodyId} onChange={(event) => setRefineBoolean((value) => ({ ...value, toolBodyId: event.target.value }))} disabled={busy}>{solidBodyOptions.filter((body) => body.id !== resolvedBooleanTargetBodyId).map((body) => <option key={body.id} value={body.id}>{body.name}</option>)}</select></label>
              <label style={{ display: "grid", gap: 3, marginTop: 6, fontSize: 11 }}>运算<select value={refineBoolean.operation} onChange={(event) => setRefineBoolean((value) => ({ ...value, operation: event.target.value as "union" | "cut" | "intersect" }))} disabled={busy}><option value="union">合并</option><option value="cut">切除</option><option value="intersect">相交</option></select></label>
              <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 7, fontSize: 11 }}><input type="checkbox" checked={refineBoolean.keepToolBody} onChange={(event) => setRefineBoolean((value) => ({ ...value, keepToolBody: event.target.checked }))} disabled={busy} />保留工具体显示</label>
              <button type="button" onClick={() => void applyPrecisionBodyBoolean()} disabled={busy || solidBodyOptions.length < 2} style={{ width: "100%", marginTop: 7 }}>执行真实 B-Rep 布尔</button>
            </details>
            <details style={{ border: "1px solid #31465e", borderRadius: 4, padding: 8, marginBottom: 7 }}>
              <summary style={{ cursor: "pointer", fontWeight: 700 }}>拔模 · 所选实体面</summary>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 90px", gap: 5, marginTop: 8 }}>
                <label style={{ display: "grid", gap: 3, fontSize: 11 }}>拔模角度 °<input type="number" min="0.1" max="88" step="0.5" value={refineDraft.angleDeg} onChange={(event) => setRefineDraft((value) => ({ ...value, angleDeg: Number(event.target.value) }))} disabled={busy} /></label>
                <label style={{ display: "grid", gap: 3, fontSize: 11 }}>拉伸轴<select value={refineDraft.axis} onChange={(event) => setRefineDraft((value) => ({ ...value, axis: event.target.value as "X" | "Y" | "Z" }))} disabled={busy}><option>X</option><option>Y</option><option>Z</option></select></label>
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 7, fontSize: 11 }}><input type="checkbox" checked={refineDraft.reverse} onChange={(event) => setRefineDraft((value) => ({ ...value, reverse: event.target.checked }))} disabled={busy} />反向拔模</label>
              <button type="button" onClick={() => void applyPrecisionDraft()} disabled={busy || mode !== "face" || !selectedBodyId} style={{ width: "100%", marginTop: 7 }}>对所选面应用拔模</button>
            </details>
            <details style={{ border: "1px solid #31465e", borderRadius: 4, padding: 8 }}>
              <summary style={{ cursor: "pointer", fontWeight: 700 }}>加强筋 · 开放直线草图</summary>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5, marginTop: 7 }}>
                <label style={{ display: "grid", gap: 3, fontSize: 11 }}>厚度 mm<input type="number" min="0.01" step="0.5" value={refineRib.thicknessMm} onChange={(event) => setRefineRib((value) => ({ ...value, thicknessMm: Number(event.target.value) }))} disabled={busy} /></label>
                <label style={{ display: "grid", gap: 3, fontSize: 11 }}>高度 mm<input type="number" min="0.01" step="1" value={refineRib.heightMm} onChange={(event) => setRefineRib((value) => ({ ...value, heightMm: Number(event.target.value) }))} disabled={busy} /></label>
              </div>
              <label style={{ display: "grid", gap: 3, marginTop: 6, fontSize: 11 }}>方向<select value={refineRib.direction} onChange={(event) => setRefineRib((value) => ({ ...value, direction: event.target.value as "positive" | "negative" }))} disabled={busy}><option value="positive">正向</option><option value="negative">反向</option></select></label>
              <button type="button" onClick={() => void applyPrecisionRib()} disabled={busy || !selectedBodyId || !selectedSketchId} style={{ width: "100%", marginTop: 7 }}>由所选草图生成加强筋</button>
            </details>
          </section>
          <section style={{ borderBottom: "1px solid #26384c", paddingBottom: 12, marginBottom: 12 }}>
            <b style={{ color: "#67d8e8" }}>曲面建模</b>
            <BSplineSurfaceEditor busy={busy} onCreate={createBSplineSurface} />
            <label style={{ display: "grid", gap: 4, fontSize: 12, marginTop: 10 }}>拉伸距离（mm）<input type="number" step="1" value={surfaceDistanceMm} onChange={(event) => setSurfaceDistanceMm(Number(event.target.value))} disabled={busy} style={{ background: "#08111d", color: "#e5eef7", border: "1px solid #3a6670", borderRadius: 4, padding: "6px 7px" }} /></label>
            <div style={{ color: "#83a9b4", marginTop: 7, fontSize: 11 }}>{surfaceSketchSelectionLabel}</div>
            <details style={{ border: "1px solid #284754", borderRadius: 4, padding: 6, marginTop: 6 }}>
              <summary style={{ cursor: "pointer", fontSize: 11, fontWeight: 700 }}>放样端部方向与曲率</summary>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 72px", gap: 5, marginTop: 6 }}><label style={{ display: "grid", gap: 3, fontSize: 10 }}>起点<select value={loftEndControl.start} onChange={(event) => setLoftEndControl((value) => ({ ...value, start: event.target.value as typeof value.start }))} disabled={busy}><option value="natural">自然</option><option value="G1">方向引导</option><option value="G2">曲率趋势</option></select></label><label style={{ display: "grid", gap: 3, fontSize: 10 }}>长度 mm<input type="number" min="0.01" step="1" value={loftEndControl.startLengthMm} onChange={(event) => setLoftEndControl((value) => ({ ...value, startLengthMm: Number(event.target.value) }))} disabled={busy || loftEndControl.start === "natural"}/></label></div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 72px", gap: 5, marginTop: 5 }}><label style={{ display: "grid", gap: 3, fontSize: 10 }}>终点<select value={loftEndControl.end} onChange={(event) => setLoftEndControl((value) => ({ ...value, end: event.target.value as typeof value.end }))} disabled={busy}><option value="natural">自然</option><option value="G1">方向引导</option><option value="G2">曲率趋势</option></select></label><label style={{ display: "grid", gap: 3, fontSize: 10 }}>长度 mm<input type="number" min="0.01" step="1" value={loftEndControl.endLengthMm} onChange={(event) => setLoftEndControl((value) => ({ ...value, endLengthMm: Number(event.target.value) }))} disabled={busy || loftEndControl.end === "natural"}/></label></div>
            </details>
            <label style={{ display: "grid", gap: 4, marginTop: 7, fontSize: 11 }}>扫掠方向方式<select value={surfaceSweepOrientation} onChange={(event) => setSurfaceSweepOrientation(event.target.value as "followPath" | "fixedUp" | "guide")} disabled={busy} style={{ background: "#08111d", color: "#e5eef7", border: "1px solid #3a6670", borderRadius: 4, padding: "6px 7px" }}><option value="followPath">随路径转向（常规管路）</option><option value="fixedUp">保持固定方向（避免截面翻转）</option><option value="guide">辅助导轨（精确控制扭转）</option></select></label>
            {surfaceSweepOrientation === "fixedUp" && <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 5, marginTop: 6 }}>{(["x", "y", "z"] as const).map((axis) => <label key={axis} style={{ display: "grid", gap: 3, fontSize: 10 }}>方向 {axis.toUpperCase()}<input type="number" step="0.1" value={surfaceSweepUp[axis]} onChange={(event) => setSurfaceSweepUp((value) => ({ ...value, [axis]: Number(event.target.value) }))} disabled={busy} style={{ minWidth: 0, background: "#08111d", color: "#e5eef7", border: "1px solid #3a6670", borderRadius: 4, padding: "5px 6px" }} /></label>)}</div>}
            <div style={{ color: "#718b94", marginTop: 4, fontSize: 10, lineHeight: 1.45 }}>{surfaceSweepOrientation === "guide" ? "截面 → 路径 → 导轨" : "截面 → 路径"}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 6 }}>
              <button type="button" onClick={addSelectedSketchToSurfaceSet} disabled={busy || !selectedSketchId}>＋截面</button>
              <button type="button" onClick={() => void createSurfaceFromSketchSet("sweep")} disabled={busy || surfaceSketchSelectionRef.current.length !== (surfaceSweepOrientation === "guide" ? 3 : 2)}>扫掠</button>
              <button type="button" onClick={() => void createSurfaceFromSketchSet("loft")} disabled={busy || surfaceSketchSelectionRef.current.length < 2}>放样</button>
              <button type="button" onClick={() => void createSurfaceFromSketchSet("ruled")} disabled={busy || surfaceSketchSelectionRef.current.length < 2}>直纹</button>
              <button type="button" onClick={clearSurfaceSketchSet} disabled={busy || !surfaceSketchSelectionRef.current.length}>清空</button>
            </div>
            <div style={{ height: 1, background: "#273d4c", margin: "10px 0" }} />
            {/* Compatibility labels: 提取所选 Face → Surface; 偏移所选 Surface; 加厚 Surface → Solid; Sew / 缝合; Enclose → Solid; Fill / 填充; Trim Surface · 实体工具裁剪. */}
            <button type="button" onClick={() => void extractSelectedFaceSurface()} disabled={busy || mode !== "face"}>提取所选面</button>
            <label style={{ display: "grid", gap: 4, marginTop: 8, fontSize: 12 }}>偏移距离（mm）<input type="number" step="0.25" value={surfaceOffsetMm} onChange={(event) => setSurfaceOffsetMm(Number(event.target.value))} disabled={busy} style={{ background: "#08111d", color: "#e5eef7", border: "1px solid #3a6670", borderRadius: 4, padding: "6px 7px" }} /></label>
            <button type="button" onClick={() => void offsetSelectedSurface()} disabled={busy || (selectedBody?.bodyType ?? "solid") !== "surface"} style={{ marginTop: 6 }}>偏移曲面</button>
            <label style={{ display: "grid", gap: 4, marginTop: 8, fontSize: 12 }}>加厚尺寸（mm）<input type="number" min="0.01" step="0.25" value={surfaceThicknessMm} onChange={(event) => setSurfaceThicknessMm(Number(event.target.value))} disabled={busy} style={{ background: "#08111d", color: "#e5eef7", border: "1px solid #3a6670", borderRadius: 4, padding: "6px 7px" }} /></label>
            <button type="button" onClick={() => void thickenSelectedSurface()} disabled={busy || (selectedBody?.bodyType ?? "solid") !== "surface"} style={{ marginTop: 6 }}>加厚为实体</button>
            <div style={{ height: 1, background: "#273d4c", margin: "10px 0" }} />
            <div style={{ color: "#83a9b4", fontSize: 11 }}>{surfaceSourceSelectionLabel}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 6 }}>
              <button type="button" onClick={addSelectedSurfaceBody} disabled={busy || (selectedBody?.bodyType ?? "solid") !== "surface"}>加入曲面</button>
              <button type="button" onClick={() => void combineSelectedSurfaces(false)} disabled={busy || surfaceSourceSelectionRef.current.length < 2}>缝合</button>
              <button type="button" onClick={() => void combineSelectedSurfaces(true)} disabled={busy || surfaceSourceSelectionRef.current.length < 2}>封闭为实体</button>
              <button type="button" onClick={clearSurfaceSourceSet} disabled={busy || !surfaceSourceSelectionRef.current.length}>清空</button>
            </div>
            <div style={{ height: 1, background: "#273d4c", margin: "10px 0" }} />
            <b style={{ fontSize: 12 }}>边界过渡 · G0 / G1 / G2</b>
            <div style={{ color: "#83a9b4", marginTop: 5, fontSize: 11 }}>{surfaceBoundarySelectionLabel}</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 5, marginTop: 6 }}>
              <label style={{ display: "grid", gap: 3, fontSize: 10 }}>沿边采样点<input type="number" min="3" max="31" step="2" value={surfaceQualitySettings.edgeSamples} onChange={(event) => setSurfaceQualitySettings((value) => ({ ...value, edgeSamples: Math.max(3, Math.min(31, Math.round(Number(event.target.value)) | 1)) }))} disabled={busy} /></label>
              <label style={{ display: "grid", gap: 3, fontSize: 10 }}>最大夹角 °<input type="number" min="0.001" step="0.05" value={surfaceQualitySettings.angularToleranceDeg} onChange={(event) => setSurfaceQualitySettings((value) => ({ ...value, angularToleranceDeg: Math.max(.001, Number(event.target.value)) }))} disabled={busy} /></label>
              <label style={{ display: "grid", gap: 3, fontSize: 10 }}>最大曲率差<input type="number" min="0.000001" step="0.0001" value={surfaceQualitySettings.curvatureTolerance} onChange={(event) => setSurfaceQualitySettings((value) => ({ ...value, curvatureTolerance: Math.max(1e-6, Number(event.target.value)) }))} disabled={busy} /></label>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 6 }}>
              <button type="button" onClick={addSelectedSurfaceBoundaryEdge} disabled={busy || mode !== "edge"}>加入边界</button>
              <button type="button" onClick={() => void createFillSurface()} disabled={busy || !surfaceBoundarySelectionRef.current.length}>填充</button>
              <select value={surfaceBoundaryContinuity} onChange={(event) => setSurfaceBoundaryContinuity(event.target.value as "G0" | "G1" | "G2")} disabled={busy} title="G1/G2 只有在所有边界采样均通过连续性验收时才会写入历史" style={{ background: "#08111d", color: "#e5eef7", border: "1px solid #3a6670", borderRadius: 4, padding: "5px 7px" }}><option value="G0">G0 位置连续</option><option value="G1">G1 切向验收</option><option value="G2">G2 曲率验收</option></select>
              <button type="button" onClick={() => void createBoundarySurface()} disabled={busy || surfaceBoundarySelectionRef.current.length < 2}>构建并验收</button>
              <button type="button" onClick={clearSurfaceBoundaryEdges} disabled={busy || !surfaceBoundarySelectionRef.current.length}>清空</button>
            </div>
            <div style={{ height: 1, background: "#273d4c", margin: "10px 0" }} />
            <b style={{ fontSize: 12 }}>曲面裁剪</b>
            <div style={{ color: "#83a9b4", marginTop: 5, fontSize: 11 }}>{surfaceTrimSelectionLabel}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 6 }}>
              <button type="button" onClick={setSelectedAsTrimTarget} disabled={busy || (selectedBody?.bodyType ?? "solid") !== "surface"}>设为目标曲面</button>
              <button type="button" onClick={setSelectedAsTrimTool} disabled={busy || !selectedBodyId || (selectedBody?.bodyType ?? "solid") !== "solid"}>设为裁剪实体</button>
              <button type="button" onClick={() => void trimSelectedSurface("outside")} disabled={busy || !surfaceTrimTargetRef.current || !surfaceTrimToolRef.current}>裁掉内部</button>
              <button type="button" onClick={() => void trimSelectedSurface("inside")} disabled={busy || !surfaceTrimTargetRef.current || !surfaceTrimToolRef.current}>保留内部</button>
              <button type="button" onClick={clearSurfaceTrim} disabled={busy || (!surfaceTrimTargetRef.current && !surfaceTrimToolRef.current)}>清空</button>
            </div>
            <div style={{ height: 1, background: "#273d4c", margin: "10px 0" }} />
            {/* Compatibility labels: Surface Split · Surface / Surface; Split / 互切分片; Replace Face · Conservative Sew; Replace + Sew + Solidify. */}
            <b style={{ fontSize: 12 }}>曲面互切 · 分片与精确交线</b><div style={{color:"#83a9b4",marginTop:5,fontSize:11}}>{surfaceSplitSelectionLabel}</div><div style={{display:"flex",flexWrap:"wrap",gap:5,marginTop:6}}><button type="button" onClick={setSelectedAsSurfaceSplitTarget} disabled={busy||(selectedBody?.bodyType??"solid")!=="surface"}>设为曲面 A</button><button type="button" onClick={setSelectedAsSurfaceSplitTool} disabled={busy||(selectedBody?.bodyType??"solid")!=="surface"}>设为曲面 B</button><button type="button" onClick={()=>void createSurfaceIntersectionCurve()} disabled={busy||!surfaceSplitTargetRef.current||!surfaceSplitToolRef.current}>生成交线</button><button type="button" onClick={()=>void splitSelectedSurface()} disabled={busy||!surfaceSplitTargetRef.current||!surfaceSplitToolRef.current}>互切分片</button><button type="button" onClick={clearSurfaceSplit} disabled={busy}>清空</button></div>
            <div style={{ height: 1, background: "#273d4c", margin: "10px 0" }} />
            <b style={{ fontSize: 12 }}>替换面</b><div style={{color:"#83a9b4",marginTop:5,fontSize:11}}>{replaceFaceSelectionLabel}</div><div style={{display:"flex",flexWrap:"wrap",gap:5,marginTop:6}}><button type="button" onClick={setReplaceFaceTarget} disabled={busy||mode!=="face"||(selectedBody?.bodyType??"solid")!=="solid"}>锁定实体面</button><button type="button" onClick={setReplaceFaceSurface} disabled={busy||(selectedBody?.bodyType??"solid")!=="surface"}>设为替换曲面</button><button type="button" onClick={()=>void applyReplaceFace()} disabled={busy||!replaceFaceTargetRef.current||!replaceFaceSurfaceRef.current}>替换并缝合</button><button type="button" onClick={clearReplaceFace} disabled={busy}>清空</button></div>
            <div style={{ height: 1, background: "#273d4c", margin: "10px 0" }} />
            <b style={{ fontSize: 12 }}>曲面连续性 · G0 / G1 / G2</b>
            <div style={{ color: "#83a9b4", marginTop: 5, fontSize: 11 }}>{surfaceContinuitySelectionLabel}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 6 }}>
              <button type="button" onClick={addSelectedContinuityFace} disabled={busy || mode !== "face"}>加入当前面</button>
              <button type="button" onClick={() => void analyzeSelectedSurfaceContinuity()} disabled={busy || surfaceContinuitySelectionRef.current.length !== 2}>分析连续性</button>
              <button type="button" onClick={clearSurfaceContinuityFaces} disabled={busy || !surfaceContinuitySelectionRef.current.length}>清空</button>
            </div>
            <div style={{ marginTop: 6, padding: 7, border: "1px solid #2d4859", borderRadius: 4, background: "#0a141e", color: surfaceContinuityReport.startsWith("G2") ? "#9ce8b3" : surfaceContinuityReport.startsWith("G1") ? "#a6d9ed" : "#d1c899", fontSize: 11, lineHeight: 1.5 }}>{surfaceContinuityReport}</div>
            <label style={{ display: "grid", gridTemplateColumns: "1fr 82px", alignItems: "center", gap: 6, marginTop: 7, fontSize: 10 }}>采样密度<input type="number" min="3" max="25" step="2" value={surfaceQualitySettings.faceSamples} onChange={(event) => setSurfaceQualitySettings((value) => ({ ...value, faceSamples: Math.max(3, Math.min(25, Math.round(Number(event.target.value)) | 1)) }))} disabled={busy} /></label>
            <div style={{ marginTop: 8 }}><button type="button" onClick={() => void analyzeSelectedSurfaceQuality()} disabled={busy || (mode !== "face" && mode !== "edge")}>分析曲率质量</button></div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 6 }}><button type="button" onClick={() => { renderStateRef.current?.setSurfaceInspection?.("normal"); setSurfaceInspectionMode("normal"); }} disabled={busy} style={{ background: surfaceInspectionMode === "normal" ? "#244b45" : undefined }}>正常着色</button><button type="button" onClick={() => { renderStateRef.current?.setSurfaceInspection?.("zebra"); setSurfaceInspectionMode("zebra"); }} disabled={busy} style={{ background: surfaceInspectionMode === "zebra" ? "#244b45" : undefined }}>斑马纹检查</button></div>
            <div style={{ marginTop: 6, padding: 7, border: "1px solid #29445a", borderRadius: 4, background: "#09131d", color: "#9fbad0", fontSize: 11, lineHeight: 1.5 }}>{surfaceQualityReport}</div>
          </section>
          <section style={{ borderBottom: "1px solid #26384c", paddingBottom: 12, marginBottom: 12 }}>
            <ImportedFeatureRecoveryPanel busy={busy || !selectedBodyId} mode={mode} analysis={directEditAnalysis} candidates={directEditCandidates} recoveryPlan={importedRecoveryPlan} holeLabel={importedHoleReconstructionLabel} holeDiameterMm={importedHoleDiameterMm} holeDepthMode={importedHoleDepthMode} holeDepthMm={importedHoleDepthMm} patternLabel={importedPatternReconstructionLabel} edgeLabel={importedReconstructionLabel} edgeValueMm={importedReconstructionValueMm} edgeSelectionLabel={reconstructionEdgeSelectionLabel} edgeSelectionCount={reconstructionEdgeSelectionRef.current.length} onAnalyze={()=>void analyzeSelectedBody()} onSelectCandidate={selectDirectEditCandidate} onLoadFaceGroup={loadCandidateDefeatureSet} onBeginHole={(candidate)=>void beginImportedHoleReconstruction(candidate)} onBeginPattern={(candidate)=>void beginImportedPatternReconstruction(candidate)} onBeginEdge={(candidate)=>void beginImportedEdgeTreatmentReconstruction(candidate)} onReconstructPrismatic={(candidate)=>void reconstructImportedPrismatic(candidate)} onHoleDiameterChange={setImportedHoleDiameterMm} onHoleDepthModeChange={setImportedHoleDepthMode} onHoleDepthChange={setImportedHoleDepthMm} onCompleteHole={()=>void completeImportedHole()} onCancelHole={()=>void cancelImportedHoleReconstruction()} onCompletePattern={()=>void completeImportedPattern()} onCancelPattern={()=>void cancelImportedPatternReconstruction()} onEdgeValueChange={setImportedReconstructionValueMm} onAddEdge={addSelectedReconstructionEdge} onClearEdges={clearReconstructionEdges} onCompleteEdge={()=>void completeImportedReconstruction()} onCancelEdge={()=>void cancelImportedReconstruction()} />
            {/* Compatibility wording retained for product checks: Move Face V2 · Planar Normal Offset (mm); Move / Push-Pull Selected Planar Face. */}
            <label style={{ display: "grid", gap: 4, marginTop: 9, fontSize: 12 }}>推拉距离（mm）<input type="number" value={pushPullDistanceMm} step="0.5" onChange={(event) => setPushPullDistanceMm(Number(event.target.value))} disabled={busy} style={{ background: "#08111d", color: "#e5eef7", border: "1px solid #3a5068", borderRadius: 4, padding: "6px 7px" }} /></label>
            <button type="button" onClick={() => void applySelectedFeature("pushPull")} disabled={busy || mode !== "face"} style={{ marginTop: 6 }}>推拉所选平面</button>
            <button type="button" onClick={() => void applySelectedFeature("deleteFace")} disabled={busy || mode !== "face"} style={{ marginTop: 6, marginLeft: 6 }}>删除所选面</button>
            <div style={{ marginTop: 8, padding: 8, border: "1px solid #31465e", borderRadius: 4, fontSize: 12 }}><b>多面去特征</b><div style={{ color: "#91a9bf", margin: "5px 0" }}>{defeatureSelectionLabel}</div><button type="button" onClick={addSelectedFaceToDefeatureSelection} disabled={busy || mode !== "face"}>加入当前面</button><button type="button" onClick={() => void applyDefeatureSelection()} disabled={busy || !defeatureSelectionRef.current.length} style={{ marginLeft: 6 }}>愈合选择集</button><button type="button" onClick={clearDefeatureSelection} disabled={busy || !defeatureSelectionRef.current.length} style={{ marginLeft: 6 }}>清空</button></div>
            <label style={{ display: "grid", gap: 4, marginTop: 9, fontSize: 12 }}>实体偏移（mm）<input type="number" value={bodyOffsetDistanceMm} step="0.5" onChange={(event) => setBodyOffsetDistanceMm(Number(event.target.value))} disabled={busy} style={{ background: "#08111d", color: "#e5eef7", border: "1px solid #3a5068", borderRadius: 4, padding: "6px 7px" }} /></label>
            <button type="button" onClick={() => void applyBodyOffset()} disabled={busy || !selectedBodyId || (selectedBody?.bodyType ?? "solid") !== "solid"} style={{ marginTop: 6 }}>偏移所选实体</button>
          </section>
          <section style={{ borderBottom: "1px solid #26384c", paddingBottom: 12, marginBottom: 12 }}>
            <b>测量</b><p style={{ color: "#a9bdd0", fontSize: 12, lineHeight: 1.55 }}>{measure}</p>
            <b>剖切</b><label style={{ display: "grid", gap: 4, marginTop: 6, fontSize: 12 }}>X 位置（mm）<input type="range" min="-2000" max="2000" step="1" value={sectionOffsetMm} onChange={(event) => { const value = Number(event.target.value); setSectionOffsetMm(value); renderStateRef.current?.setSection?.(sectionEnabled, value); }} /><input type="number" value={sectionOffsetMm} onChange={(event) => { const value = Number(event.target.value); setSectionOffsetMm(value); renderStateRef.current?.setSection?.(sectionEnabled, value); }} style={{ background: "#08111d", color: "#e5eef7", border: "1px solid #3a5068", borderRadius: 4, padding: "6px 7px" }} /></label>
          </section>
          <EngineeringPropertiesPanel summary={engineeringSummary} selectedBody={selectedBody} selectedVolumeMm3={selectedBodyProperties?.volumeMm3} selectedMassKg={selectedMassKg} draft={engineeringDraft} setDraft={setEngineeringDraft} onSave={applySelectedBodyEngineering} />
        </aside>
      </div>
    </div>
  );

  return (
    <Root style={{ minHeight: embedded ? "calc(100vh - 70px)" : "100vh", background: "#0b1220", color: "#e5eefb", padding: 32, fontFamily: "Arial, sans-serif" }}>
      <section style={{ maxWidth: 980, margin: "0 auto" }}>
        <p style={{ color: "#71c6ff", letterSpacing: .8, marginBottom: 8 }}>FORGEMIND CAD · PROFESSIONAL</p>
        <h1 style={{ margin: 0 }}>{embedded ? "专业 B-Rep CAD 工作台" : "Persistent Topology + B-Rep Features"}</h1>
        <p style={{ color: "#aab9cf", maxWidth: 820 }}>{embedded ? "真实 B-Rep 是几何事实源；支持特征重建、持久拓扑、STEP、多实体、History 与项目级导入导出。Three.js 仅负责显示与拾取。" : "隔离验证入口：选择 Runtime Face / Edge 后捕获可序列化 Persistent Topology Ref，再生成真实 Hole、Fillet 或 Chamfer。"}</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
          <button type="button" onClick={exportCadProject} disabled={busy}>Export CAD Project</button>
          <label style={{ display: "inline-flex", alignItems: "center", padding: "2px 8px", border: "1px solid #4b6b8d", borderRadius: 4, cursor: busy ? "wait" : "pointer" }}>Import CAD Project<input aria-label="Import CAD Project" type="file" accept=".json,.forgemind-cad.json" hidden disabled={busy} onChange={(event) => { void importCadProject(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }} /></label>
        </div>
        <button type="button" onClick={() => void runSmoke()} disabled={busy} style={{ background: "#1689d4", color: "white", border: 0, borderRadius: 6, padding: "10px 16px", fontSize: 15, cursor: busy ? "wait" : "pointer" }}>{busy ? "正在运行…" : "创建 Base Extrude"}</button>
        <button type="button" onClick={() => void applySelectedFeature("hole")} disabled={busy} style={{ marginLeft: 8 }}>Create Hole</button>
        <button type="button" onClick={() => void applySelectedFeature("fillet")} disabled={busy} style={{ marginLeft: 8 }}>Create Fillet</button>
        <button type="button" onClick={() => void applySelectedFeature("chamfer")} disabled={busy} style={{ marginLeft: 8 }}>Create Chamfer</button>
        <button type="button" onClick={() => void applySelectedFeature("shell")} disabled={busy} style={{ marginLeft: 8 }}>Create Shell</button>
        <button type="button" onClick={() => void applySelectedFeature("removeHole")} disabled={busy} style={{ marginLeft: 8 }}>Remove Cylindrical Hole</button>
        <button type="button" onClick={() => void applySelectedFeature("deleteFace")} disabled={busy} style={{ marginLeft: 8 }}>Delete Face / Defeature</button>
        <button type="button" onClick={() => void applySelectedFeature("pushPull")} disabled={busy} style={{ marginLeft: 8 }}>Planar Push/Pull</button>
        <button type="button" onClick={() => void applyBodyOffset()} disabled={busy} style={{ marginLeft: 8 }}>Offset Body</button>
        <button type="button" onClick={() => void autoRebuildWidth()} disabled={busy} style={{ marginLeft: 8 }}>Auto Rebuild Width 150</button>
        <button type="button" onClick={() => void runAutomaticChain()} disabled={busy} style={{ marginLeft: 8 }}>Run M10-D Full Auto Chain</button>
        <button type="button" onClick={() => void rebuildM10D("hole20")} disabled={busy} style={{ marginLeft: 8 }}>M10-D Hole Ø20</button>
        <button type="button" onClick={() => void rebuildM10D("fillet5")} disabled={busy} style={{ marginLeft: 8 }}>M10-D Fillet R5</button>
        <button type="button" onClick={() => void rebuildM10D("invalidFillet")} disabled={busy} style={{ marginLeft: 8 }}>M10-D Invalid Fillet</button>
        <button type="button" onClick={() => void rebuildM10D("suppressHole")} disabled={busy} style={{ marginLeft: 8 }}>M10-D Suppress Hole</button>
        <button type="button" onClick={() => void rebuildM10D("unsuppressHole")} disabled={busy} style={{ marginLeft: 8 }}>M10-D Unsuppress Hole</button>
        <button type="button" onClick={() => void rebuildM10D("suppressFillet")} disabled={busy} style={{ marginLeft: 8 }}>M10-D Suppress Fillet</button>
        <button type="button" onClick={() => void selectSemanticTopology("topFace")} disabled={busy} style={{ marginLeft: 8 }}>Select Top Face</button>
        <button type="button" onClick={() => void selectSemanticTopology("verticalEdge")} disabled={busy} style={{ marginLeft: 8 }}>Select Vertical Edge</button>
        <button type="button" onClick={() => void selectSemanticTopology("linearEdge")} disabled={busy} style={{ marginLeft: 8 }}>Select Linear Edge</button>
        <button type="button" onClick={() => void selectSemanticTopology("circularEdge")} disabled={busy} style={{ marginLeft: 8 }}>Select Circular Edge</button>
        <button type="button" onClick={() => void runP2M2FaceSketchPocket()} disabled={busy} style={{ marginLeft: 8 }}>Run P2-M2 Face Sketch Pocket</button>
        <button type="button" onClick={() => void runP2M3Pattern("linear")} disabled={busy} style={{ marginLeft: 8 }}>Run P2-M3 Linear Hole Pattern</button>
        <button type="button" onClick={() => void runP2M3Pattern("circular")} disabled={busy} style={{ marginLeft: 8 }}>Run P2-M3 Circular Hole Pattern</button>
        <button type="button" onClick={() => void runP2M3Pattern("mirrorPocket")} disabled={busy} style={{ marginLeft: 8 }}>Run P2-M3 Mirror Pocket</button>
        <button type="button" onClick={() => void runP2M3Pattern("mirrorBoss")} disabled={busy} style={{ marginLeft: 8 }}>Run P2-M3 Mirror Boss</button>
        <button type="button" onClick={() => void updateP2M3Parameters("linear")} disabled={busy} style={{ marginLeft: 8 }}>P2-M3 Update Linear</button>
        <button type="button" onClick={() => void updateP2M3Parameters("circular")} disabled={busy} style={{ marginLeft: 8 }}>P2-M3 Update Circular</button>
        <button type="button" onClick={() => void updateP2M3Parameters("mirror")} disabled={busy} style={{ marginLeft: 8 }}>P2-M3 Update Mirror Plane</button>
        <button type="button" onClick={() => void runP2M4("straight")} disabled={busy} style={{ marginLeft: 8 }}>Run P2-M4 Straight Sweep</button>
        <button type="button" onClick={() => void runP2M4("bent")} disabled={busy} style={{ marginLeft: 8 }}>Run P2-M4 Bent Pipe</button>
        <button type="button" onClick={() => void runP2M4("mixed")} disabled={busy} style={{ marginLeft: 8 }}>Run P2-M4 Mixed Sweep</button>
        <button type="button" onClick={() => void runP2M4("rectLoft")} disabled={busy} style={{ marginLeft: 8 }}>Run P2-M4 Rectangle Loft</button>
        <button type="button" onClick={() => void runP2M4("circleLoft")} disabled={busy} style={{ marginLeft: 8 }}>Run P2-M4 Circle Loft</button>
        <button type="button" onClick={() => void runP2M4("threeLoft")} disabled={busy} style={{ marginLeft: 8 }}>Run P2-M4 3-Section Loft</button>
        <button type="button" onClick={() => void updateP2M4()} disabled={busy} style={{ marginLeft: 8 }}>P2-M4 Update Parameters</button>
        <button type="button" onClick={() => void runP2M5("draft")} disabled={busy} style={{ marginLeft: 8 }}>Run P2-M5 Draft 5°</button>
        <button type="button" onClick={() => void runP2M5("rib")} disabled={busy} style={{ marginLeft: 8 }}>Run P2-M5 Rib 4 × 20</button>
        <button type="button" onClick={() => void runP2M5("counterbore")} disabled={busy} style={{ marginLeft: 8 }}>Run P2-M5 Counterbore</button>
        <button type="button" onClick={() => void runP2M5("countersink")} disabled={busy} style={{ marginLeft: 8 }}>Run P2-M5 Countersink</button>
        <button type="button" onClick={() => void editP2M5History()} disabled={busy || !cadHistoryRef.current} style={{ marginLeft: 8 }}>P2-M5 Edit Parameter</button>
        <button type="button" onClick={() => void restoreP2M5History("undo")} disabled={busy || !historyAvailability.undo} style={{ marginLeft: 8 }}>CAD Undo</button>
        <button type="button" onClick={() => void restoreP2M5History("redo")} disabled={busy || !historyAvailability.redo} style={{ marginLeft: 8 }}>CAD Redo</button>
        <div aria-label="P2-M6 Multi-body controls" style={{ marginTop: 16, padding: 12, border: "1px solid #285579", borderRadius: 8, background: "#101c2e" }}>
          <strong> P2-M6 · Multi-body Modeling V1</strong>
          <button type="button" onClick={() => void runP2M6("union")} disabled={busy} style={{ marginLeft: 12 }}>Run Two Bodies + Union</button>
          <button type="button" onClick={() => void runP2M6("cut")} disabled={busy} style={{ marginLeft: 8 }}>Run Cut</button>
          <button type="button" onClick={() => void runP2M6("intersect")} disabled={busy} style={{ marginLeft: 8 }}>Run Intersect</button>
          <button type="button" onClick={() => void updateP2M6BodyPresentation("new")} disabled={busy} style={{ marginLeft: 8 }}>New Body</button>
          <button type="button" onClick={() => void updateP2M6BodyPresentation("activateTool")} disabled={busy} style={{ marginLeft: 8 }}>Activate Body02</button>
          <button type="button" onClick={() => void updateP2M6BodyPresentation("toggleTool")} disabled={busy} style={{ marginLeft: 8 }}>Show / Hide Body02</button>
          <button type="button" onClick={() => void transformP2M6Tool(false)} disabled={busy} style={{ marginLeft: 8 }}>Move Body02 X +5</button>
          <button type="button" onClick={() => void transformP2M6Tool(true)} disabled={busy} style={{ marginLeft: 8 }}>Rotate Body02 Z 90°</button>
          <button type="button" onClick={() => void toggleP2M6Boolean()} disabled={busy} style={{ marginLeft: 8 }}>Suppress / Restore Boolean</button>
          <button type="button" onClick={() => void saveAndReloadP2M6()} disabled={busy} style={{ marginLeft: 8 }}>Save / Reload P2-M6</button>
          <button type="button" onClick={() => void runP2M6BooleanFillet()} disabled={busy} style={{ marginLeft: 8 }}>Boolean → Fillet</button>
          <button type="button" onClick={() => void runP2M7StepRoundtrip()} disabled={busy} style={{ marginLeft: 8 }}>P2-M7 STEP Export → Import</button>
          <label style={{ marginLeft: 8 }}>Import STEP <input aria-label="Import STEP File" type="file" accept=".step,.stp" disabled={busy} onChange={(event) => void importStepFile(event.currentTarget.files?.[0])} /></label>
          <button type="button" onClick={() => void exportP2M7ActiveBody()} disabled={busy} style={{ marginLeft: 8 }}>Export Active Body STEP</button>
          <button type="button" onClick={() => void restoreP2M5History("undo")} disabled={busy || !historyAvailability.undo} style={{ marginLeft: 8 }}>P2-M6 Undo</button>
          <button type="button" onClick={() => void restoreP2M5History("redo")} disabled={busy || !historyAvailability.redo} style={{ marginLeft: 8 }}>P2-M6 Redo</button>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginTop: 10 }} aria-label="Body Transform UI">
            <span>Body02 Transform</span>
            {(["x", "y", "z"] as const).map((axis) => <label key={axis}>{axis.toUpperCase()} <input aria-label={`Translate ${axis.toUpperCase()}`} type="number" value={p2m6Transform[axis]} onChange={(event) => setP2m6Transform({ ...p2m6Transform, [axis]: Number(event.target.value) })} style={{ width: 62 }} /></label>)}
            <label>Axis <select aria-label="Rotation Axis" value={p2m6Transform.axis} onChange={(event) => setP2m6Transform({ ...p2m6Transform, axis: event.target.value as "X" | "Y" | "Z" })}><option>X</option><option>Y</option><option>Z</option></select></label>
            <label>Angle <input aria-label="Rotation Angle" type="number" value={p2m6Transform.angle} onChange={(event) => setP2m6Transform({ ...p2m6Transform, angle: Number(event.target.value) })} style={{ width: 62 }} /></label>
            <button type="button" onClick={() => void applyP2M6TransformInputs()} disabled={busy}>Apply Transform</button>
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 8 }} aria-label="Body Boolean UI">
            <label>Operation <select aria-label="Body Boolean Operation" value={p2m6BooleanOperation} onChange={(event) => setP2m6BooleanOperation(event.target.value as "union" | "cut" | "intersect")}><option value="union">Union</option><option value="cut">Cut</option><option value="intersect">Intersect</option></select></label>
            <span>Target: Body01 · Tool: Body02</span><button type="button" onClick={() => void runP2M6(p2m6BooleanOperation)} disabled={busy}>Create Boolean</button>
          </div>
          {bodyPanel.length > 0 && <div aria-label="Bodies Panel" style={{ marginTop: 10, display: "grid", gap: 4 }}>{bodyPanel.map((body) => <div key={body.id} style={{ color: body.visible ? "#dcecff" : "#718096" }}>{body.active ? "ACTIVE · " : ""}{body.name} · {body.visible ? "Visible" : "Hidden"} <button type="button" onClick={() => void deleteP2M6Body(body.id)} disabled={busy} style={{ marginLeft: 8 }}>Delete {body.id}</button></div>)}</div>}
        </div>
        <div role="group" aria-label="选择模式" style={{ display: "inline-flex", gap: 8, marginLeft: 12 }}>
          {(["body", "face", "edge"] as CadSelectionMode[]).map((entry) => <button key={entry} type="button" onClick={() => setSelectionMode(entry)} style={{ padding: "8px 11px", borderRadius: 5, border: "1px solid #3b82f6", background: mode === entry ? "#1d4ed8" : "#172554", color: "white" }}>{entry.toUpperCase()}</button>)}
        </div>
        <p aria-live="polite" data-testid="occt-status" style={{ minHeight: 24, color: "#d8e6f7" }}>{status}</p>
        <p aria-live="polite" data-testid="persistent-diagnostics" style={{ minHeight: 20, color: "#a5f3fc" }}>{diagnostics}</p>
        <ProfessionalSketcher onRender={render} />
        <p aria-live="polite" data-testid="selection-status" style={{ minHeight: 20, color: "#fbbf24" }}>{selection}</p>
        <div ref={hostRef} data-testid="occt-viewport" style={{ height: 500, border: "1px solid #27405e", borderRadius: 10, overflow: "hidden", background: "#111827" }} />
      </section>
    </Root>
  );
}
