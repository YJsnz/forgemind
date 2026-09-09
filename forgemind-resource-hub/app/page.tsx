"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import * as THREE from "three";
import { ThreeWorkbench, type ParametricPart, type PrimitiveKind, type SketchConstraintKind, type SketchEntityKind, type SketchExtrudeFeature, type SketchOutline, type SketchPlane, type SketchPoint } from "./ThreeWorkbench";
import { createParametricPartGeometry } from "./cadGeometry";
import { LEGACY_SKETCH_CANVAS_SPAN_MM } from "../core/sketch/LegacySketchUnits";
import { instantiateResourceTemplate, resourceBounds, type ModelingResourceTemplate } from "../core/resource/ResourceModeling";
import { loadCadDocumentHandoff, saveCadDocumentHandoff } from "../core/cad/CadDocumentStore";
import { COMPREHENSIVE_DEMO_RESOURCE_ID, comprehensiveDemoLogicalParts, comprehensiveDemoTemplate } from "../core/demo/ComprehensiveDemoProject";

type ResourceKind = "设备" | "材料" | "产品";
type ModelView = "editable" | "reference";
type Resource = { id: string; kind: ResourceKind; title: string; code: string; description: string; tags: string[]; color: string; icon: string; size: string; process?: string; ports?: Array<{ id: string; role: "input" | "output"; side: string; sizeM: string }> };
type PartEngineering = { material: string; density: number; tolerance: number; process: string; group: string };
type SketchStroke = SketchOutline;
type DesignRecord = { id: string; name: string; mode: "parametric" | "sketch" | "hybrid"; modelView?: ModelView; savedAt: string; parts: ParametricPart[]; strokes: SketchStroke[]; assetPath: string; projectMaterial: string; partEngineering: Record<string, PartEngineering>; sketchDepth: number; sketchBevel: number };
type AgentPlan = { kind: "cnc" | "robot" | "conveyor" | "manual"; title: string; summary: string; steps: string[]; parameters?: string[]; checks?: string[] };
type CustomModelSnapshot = { name: string; mode: "parametric" | "sketch" | "hybrid"; modelView: ModelView; parts: ParametricPart[]; strokes: SketchStroke[]; material: string; partEngineering: Record<string, PartEngineering>; assetPath: string; depth: number; bevel: number };
// Version 2 is the first complete CAD document snapshot.  It keeps the
// engineering metadata next to the geometry so it follows the project through
// save/load, undo/redo and local recovery instead of living only in the UI.
type ProjectSnapshot = { format: "forgemind-project"; version: 1 | 2; name: string; mode: "parametric" | "sketch" | "hybrid"; modelView?: ModelView; parts: ParametricPart[]; strokes: SketchStroke[]; material: string; partEngineering?: Record<string, PartEngineering>; accent: string; assetPath: string; depth: number; bevel: number; grid: number; snap: boolean; savedAt: string };
type ManufacturingIssue = { severity: "warning" | "error" | "pass"; title: string; detail: string };
type ResourceModeling = { mode: "parametric" | "sketch" | "hybrid"; modelView: ModelView; projectName: string; materialSpec: string; widthM: number; depthM: number; heightM: number; accent: string; assetPath: string; localModelName?: string; modelReference: { kind: "asset-path" | "local-glb"; uri?: string; fileName?: string; embedded: false }; parametricParts: ParametricPart[]; engineeringProperties: Record<string, PartEngineering>; manualSketch: SketchStroke[]; sketchDepthM: number; sketchBevelM: number; snapGrid: number | false };
type ResourcePackArtifact = { format: "forgemind-resource-pack"; schema: "https://forgemind.local/schemas/resource-pack/v1"; schemaVersion: "1.0.0"; version: 4; exportedAt: string; compatibility: { minimumImporterVersion: "1.0.0"; migrations: string[] }; resources: Array<Resource & { modeling?: ResourceModeling }> };

let localIdSequence = 0;
const createLocalId = (prefix: string) => `${prefix}-${Date.now()}-${++localIdSequence}`;

const validateResourcePack = (artifact: ResourcePackArtifact) => {
  const errors: string[] = [];
  if (artifact.format !== "forgemind-resource-pack" || artifact.schemaVersion !== "1.0.0") errors.push("资源包格式或版本不受支持");
  if (!artifact.resources.length) errors.push("资源包中没有资源");
  const ids = new Set<string>();
  artifact.resources.forEach((resource) => {
    if (!resource.id || !resource.code || !resource.title) errors.push("存在缺少编号或名称的资源");
    if (ids.has(resource.id)) errors.push(`资源编号重复：${resource.id}`); ids.add(resource.id);
    if (resource.ports?.some((port) => !port.id || !port.side || !["input", "output"].includes(port.role))) errors.push(`资源“${resource.title}”存在无效物流接口`);
    const modeling = resource.modeling;
    if (!modeling) return;
    if (![modeling.widthM, modeling.depthM, modeling.heightM, modeling.sketchDepthM].every((value) => Number.isFinite(value) && value > 0)) errors.push(`资源“${resource.title}”的尺寸参数无效`);
    if (!modeling.projectName.trim() || !modeling.modelReference.kind) errors.push(`资源“${resource.title}”缺少模型引用或项目名称`);
    if (modeling.parametricParts.some((part) => !part.id || ![part.width, part.height, part.depth, part.x, part.y, part.z].every(Number.isFinite))) errors.push(`资源“${resource.title}”存在无效参数化部件`);
    if (modeling.manualSketch.some((stroke) => !["top", "front", "right"].includes(stroke.plane) || stroke.points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y)))) errors.push(`资源“${resource.title}”存在无效草图坐标`);
  });
  return errors;
};
const snapshotSignature = (snapshot: ProjectSnapshot) => JSON.stringify({ ...snapshot, savedAt: undefined });
const defaultPartEngineering = (): PartEngineering => ({ material: "碳钢 / Q235", density: 7850, tolerance: 0.1, process: "机加工", group: "结构件" });
const normalizePartEngineering = (value: unknown): Record<string, PartEngineering> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.entries(value as Record<string, unknown>).reduce<Record<string, PartEngineering>>((result, [partId, properties]) => {
    if (!properties || typeof properties !== "object" || Array.isArray(properties)) return result;
    const source = properties as Partial<PartEngineering>;
    const fallback = defaultPartEngineering();
    result[partId] = {
      material: typeof source.material === "string" && source.material.trim() ? source.material : fallback.material,
      density: Number.isFinite(source.density) ? Number(source.density) : fallback.density,
      tolerance: Number.isFinite(source.tolerance) ? Number(source.tolerance) : fallback.tolerance,
      process: typeof source.process === "string" && source.process.trim() ? source.process : fallback.process,
      group: typeof source.group === "string" && source.group.trim() ? source.group : fallback.group,
    };
    return result;
  }, {});
};
const sketchEntityKinds: SketchEntityKind[] = ["line", "circle", "arc", "spline", "rectangle", "construction", "point"];
const sketchConstraintKinds: SketchConstraintKind[] = ["horizontal", "vertical", "fixed"];
const isClosedSketchProfile = (kind: SketchEntityKind | undefined) => ["rectangle", "circle", "spline"].includes(kind ?? "spline");
const normalizeSketchStrokes = (value: unknown): SketchStroke[] => Array.isArray(value) ? value.flatMap((stroke, index) => {
  if (Array.isArray(stroke)) return [{ id: `legacy-sketch-${index}`, plane: "top" as const, kind: "spline" as const, points: stroke.filter((point): point is SketchPoint => Boolean(point) && Number.isFinite(point.x) && Number.isFinite(point.y)) }];
  if (stroke && typeof stroke === "object" && Array.isArray((stroke as SketchStroke).points)) { const outline = stroke as SketchStroke; const feature = outline.feature; const normalizedFeature: SketchExtrudeFeature | undefined = feature && ["extrude", "pocket", "revolve"].includes(feature.operation) && Number.isFinite(feature.depth) && feature.depth > 0 && Number.isFinite(feature.bevel) && feature.bevel >= 0 ? { operation: feature.operation, depth: feature.depth, bevel: feature.bevel, enabled: feature.enabled !== false, targetId: typeof feature.targetId === "string" ? feature.targetId : undefined, angle: Number.isFinite(feature.angle) ? Math.max(.1, Math.min(360, feature.angle as number)) : undefined, patternCount: Number.isFinite(feature.patternCount) ? Math.max(1, Math.min(24, Math.round(feature.patternCount as number))) : undefined, patternAngle: Number.isFinite(feature.patternAngle) ? Math.max(.1, Math.min(360, feature.patternAngle as number)) : undefined, patternMode: feature.patternMode === "linear" ? "linear" : feature.patternMode === "circular" ? "circular" : undefined, patternSpacing: Number.isFinite(feature.patternSpacing) ? Math.max(.001, Math.min(10, feature.patternSpacing as number)) : undefined } : undefined; return [{ id: outline.id || `sketch-${index}`, plane: ["top", "front", "right"].includes(outline.plane) ? outline.plane : "top", kind: sketchEntityKinds.includes(outline.kind ?? "spline") ? outline.kind ?? "spline" : "spline", construction: Boolean(outline.construction), constraints: Array.isArray(outline.constraints) ? outline.constraints.filter((constraint): constraint is SketchConstraintKind => sketchConstraintKinds.includes(constraint)) : [], feature: normalizedFeature, points: outline.points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y)) }]; }
  return [];
}) : [];

const resources: Resource[] = [
  { id: "cnc", kind: "设备", title: "CNC 加工中心", code: "MACH-CNC-04", description: "三轴精加工单元，适合壳体、法兰与小型精密件。", tags: ["加工", "3×2 格", "GLB"], color: "#d4ad43", icon: "▣", size: "3.0 × 2.0 × 1.9 m", process: "铣削 / 钻孔 / 攻丝" },
  { id: "robot", kind: "设备", title: "协作机器人单元", code: "ASM-ROBOT-06", description: "可配置夹具和末端工具的通用装配工作站。", tags: ["装配", "3×3 格", "参数化"], color: "#68c6c2", icon: "⌘", size: "3.0 × 3.0 × 1.8 m", process: "拧紧 / 装配 / 分拣" },
  { id: "press", kind: "设备", title: "液压冲压机", code: "FORM-PRESS-02", description: "适用于板材成型、折弯和连续冲压工序。", tags: ["加工", "2×2 格", "GLB"], color: "#ca9555", icon: "▥", size: "2.0 × 2.0 × 1.6 m", process: "冲压 / 折弯" },
  { id: "steel", kind: "材料", title: "冷轧钢板", code: "MAT-STEEL-CR", description: "面向冲压与钣金工序的低碳钢板材基准模型。", tags: ["钢材", "板材", "原料"], color: "#9cabb0", icon: "▱", size: "1200 × 800 × 1.5 mm" },
  { id: "aluminum", kind: "材料", title: "铝合金毛坯", code: "MAT-AL-6061", description: "轻量化机加工件的方坯材料，可编辑密度与尺寸。", tags: ["铝", "方坯", "原料"], color: "#b9c4c6", icon: "◇", size: "160 × 90 × 45 mm" },
  { id: "housing", kind: "产品", title: "机加工壳体", code: "PART-HOUSING-01", description: "带螺孔与定位面的设备壳体，可作为装配配方中间品。", tags: ["中间品", "CNC", "可编辑"], color: "#658f94", icon: "◫", size: "180 × 120 × 68 mm" },
  { id: "motor", kind: "产品", title: "伺服电机总成", code: "PROD-MOTOR-08", description: "由壳体、线圈、紧固件装配而成的成品资源。", tags: ["成品", "装配", "配方"], color: "#5aa88d", icon: "◎", size: "220 × 160 × 150 mm" },
  { id: "buffer", kind: "设备", title: "托盘缓存架", code: "LOG-BUFFER-03", description: "用于工序间缓存和出货暂存的紧凑型货架。", tags: ["物流", "2×2 格", "参数化"], color: "#829389", icon: "▤", size: "2.0 × 2.0 × 1.4 m", process: "缓存 / 转运" },
  { id: "router-box", kind: "设备", title: "对向输送接口盒", code: "LOG-ROUTER-01", description: "按 ForgeMind 单段滚筒输送模型的实际包围尺寸校准，左右两侧设置同轴矩形输送管道。", tags: ["物流", "接口", "直通管道", "IN / OUT"], color: "#d7ac37", icon: "✣", size: "0.78 × 0.46 × 0.46 m", process: "接收 / 直通 / 输出", ports: [{ id: "IN-01", role: "input", side: "左侧", sizeM: "0.35 × 0.12" }, { id: "OUT-01", role: "output", side: "右侧", sizeM: "0.35 × 0.12" }] },
  { id: COMPREHENSIVE_DEMO_RESOURCE_ID, kind: "设备", title: "自适应精密装配与检测中心", code: "DEMO-CAD-05", description: "集成精密输送、伺服回转夹具、光顺六轴机械臂、视觉与测头检测、快换工具和 NURBS 曲面安全门；可完整演示参数化特征、机械细节、曲面精修与装配求解。", tags: ["全功能演示", "光顺曲面", "精密机械", "装配"], color: "#3f9e9b", icon: "◈", size: "1160 × 860 × 760 mm", process: "CNC 精加工 / 曲面成型 / 机器人装配 / 质量检测" },
];
const kinds: Array<ResourceKind | "全部"> = ["全部", "设备", "材料", "产品"];
const modelAssets = [
  { label: "自定义工业部件", path: "procedural" },
  { label: "数控加工中心 / 原项目模型", path: "/models/industrial/cnc_machining_center.glb" },
  { label: "机器人工作单元 / 原项目模型", path: "/models/industrial/robot_cell.glb" },
  { label: "安全围栏与门 / 原项目模型", path: "/models/industrial/safety_fence.glb" },
  { label: "滚筒输送线 / 原项目模型", path: "/models/industrial/roller_conveyor.glb" },
  { label: "单段滚筒输送机 / 原项目模型", path: "/models/industrial/roller_conveyor_segment.glb" },
  { label: "立式控制柜 / 原项目模型", path: "/models/industrial/control_cabinet.glb" },
  { label: "进出料传感器组 / 原项目模型", path: "/models/industrial/sensor_pack.glb" },
  { label: "液压冲压机 / 原项目模型", path: "/models/industrial/hydraulic_press_detail.glb" },
  { label: "清洗去毛刺单元 / 原项目模型", path: "/models/industrial/wash_deburr_detail.glb" },
  { label: "托盘缓存仓 / 原项目模型", path: "/models/industrial/pallet_buffer_detail.glb" },
  { label: "物流流向节点 / 原项目模型", path: "/models/industrial/flow_node_detail.glb" },
  { label: "AGV 叉车 / 原项目模型", path: "/models/forklift_agv.glb" },
  { label: "六轴机器人 / 原项目模型", path: "/models/robot_arm_6dof_white.glb" },
];
const defaultParts: ParametricPart[] = [
  { id: "base", type: "box", label: "焊接床身", x: 0, y: 0.18, z: 0, width: 4.2, height: 0.36, depth: 2.55, color: "#536560", metalness: 0.58, roughness: 0.42 },
  { id: "plinth", type: "box", label: "减振基础", x: 0, y: 0.46, z: 0, width: 3.75, height: 0.22, depth: 2.18, color: "#354743", metalness: 0.5, roughness: 0.48 },
  { id: "enclosure", type: "box", label: "安全围护", x: 0, y: 1.55, z: 0.2, width: 3.72, height: 1.95, depth: 2.05, color: "#73847f", metalness: 0.34, roughness: 0.48 },
  { id: "bed", type: "box", label: "精密工作台", x: 0.2, y: 1.03, z: 0.1, width: 2.15, height: 0.22, depth: 1.28, color: "#9aa39e", metalness: 0.75, roughness: 0.24 },
  { id: "column", type: "box", label: "立柱", x: -1.35, y: 2.08, z: 0.58, width: 0.62, height: 2.85, depth: 0.56, color: "#5d6e68", metalness: 0.5, roughness: 0.38 },
  { id: "gantry", type: "box", label: "横向滑枕", x: -0.3, y: 2.75, z: 0.48, width: 1.65, height: 0.42, depth: 0.54, color: "#687873", metalness: 0.55, roughness: 0.32 },
  { id: "head", type: "box", label: "主轴箱", x: 0.32, y: 2.28, z: 0.22, width: 0.82, height: 0.95, depth: 0.74, color: "#d1aa43", metalness: 0.62, roughness: 0.26 },
  { id: "spindle", type: "cylinder", label: "加工主轴", x: 0.32, y: 1.62, z: 0.22, width: 0.28, height: 0.92, depth: 0.28, color: "#253431", metalness: 0.82, roughness: 0.16 },
  { id: "door-left", type: "box", label: "左侧防护门", x: -0.78, y: 1.53, z: -0.87, width: 1.33, height: 1.46, depth: 0.06, color: "#79a9a8", metalness: 0.25, roughness: 0.22 },
  { id: "door-right", type: "box", label: "右侧防护门", x: 0.76, y: 1.53, z: -0.87, width: 1.33, height: 1.46, depth: 0.06, color: "#79a9a8", metalness: 0.25, roughness: 0.22 },
  { id: "panel", type: "box", label: "数控操作箱", x: 2.02, y: 1.42, z: -0.55, width: 0.44, height: 1.32, depth: 0.62, color: "#e2e6df", metalness: 0.22, roughness: 0.32 },
  { id: "magazine", type: "cylinder", label: "刀库", x: -1.62, y: 1.34, z: -0.5, width: 0.78, height: 1.16, depth: 0.78, color: "#c79043", metalness: 0.7, roughness: 0.26 },
  { id: "conveyor", type: "box", label: "排屑输送机", x: 2.35, y: 0.47, z: 0.4, width: 1.25, height: 0.24, depth: 0.76, color: "#4c5c57", metalness: 0.55, roughness: 0.4 },
];
const modelPresets: Record<string, { label: string; description: string; detailAssetPath?: string; parts: ParametricPart[] }> = {
  cnc: { label: "VMC-850 立式加工中心", description: "床身、围护、工作台、立柱、主轴、刀库、控制箱与排屑单元。", detailAssetPath: "/models/industrial/cnc_machining_center.glb", parts: defaultParts },
  robot: { label: "六轴机器人装配单元", description: "采用原工厂项目的完整机器人工作单元模型，包含安全围栏、底座、关节臂、末端执行器与工装台。", detailAssetPath: "/models/industrial/robot_cell.glb", parts: [
    { id: "cell-base", type: "box", label: "单元底板", x: 0, y: 0.12, z: 0, width: 5.2, height: 0.24, depth: 4.2, color: "#4e605c", metalness: 0.52, roughness: 0.42 },
    { id: "fixture", type: "box", label: "定位工装台", x: 1.35, y: 0.85, z: 0.35, width: 1.75, height: 1.22, depth: 1.15, color: "#aab4ae", metalness: 0.62, roughness: 0.28 },
    { id: "pedestal", type: "cylinder", label: "机器人底座", x: -0.75, y: 0.5, z: 0, width: 0.95, height: 0.75, depth: 0.95, color: "#d4ad43", metalness: 0.58, roughness: 0.25 },
    { id: "shoulder", type: "cylinder", label: "肩部回转关节", x: -0.75, y: 1.08, z: 0, width: 0.78, height: 0.48, depth: 0.78, color: "#d4ad43", metalness: 0.58, roughness: 0.25 },
    { id: "upper-arm", type: "box", label: "大臂", x: -0.1, y: 1.62, z: 0, width: 1.5, height: 0.36, depth: 0.42, color: "#d4ad43", metalness: 0.58, roughness: 0.25 },
    { id: "elbow", type: "cylinder", label: "肘部关节", x: 0.65, y: 1.65, z: 0, width: 0.52, height: 0.46, depth: 0.52, color: "#384944", metalness: 0.7, roughness: 0.2 },
    { id: "forearm", type: "box", label: "小臂", x: 1.1, y: 2.05, z: 0, width: 0.9, height: 0.28, depth: 0.33, color: "#d4ad43", metalness: 0.58, roughness: 0.25 },
    { id: "wrist", type: "cylinder", label: "腕部", x: 1.57, y: 2.08, z: 0, width: 0.36, height: 0.45, depth: 0.36, color: "#384944", metalness: 0.7, roughness: 0.2 },
    { id: "gripper", type: "box", label: "平行夹爪", x: 1.86, y: 2.08, z: 0, width: 0.42, height: 0.3, depth: 0.72, color: "#8ca49e", metalness: 0.56, roughness: 0.24 },
    { id: "fence-rear", type: "box", label: "后侧围栏", x: 0, y: 1.45, z: 1.85, width: 4.9, height: 2.55, depth: 0.05, color: "#698f89", metalness: 0.35, roughness: 0.48 },
  ] },
  conveyor: { label: "模块化滚筒输送设备", description: "采用原工厂项目的完整滚筒输送线模型，包含机架、滚筒模组、驱动电机、侧护栏、光电位与进出料接口。", detailAssetPath: "/models/industrial/roller_conveyor.glb", parts: [
    { id: "conv-frame", type: "box", label: "铝型材机架", x: 0, y: 0.48, z: 0, width: 5.8, height: 0.28, depth: 1.15, color: "#52645f", metalness: 0.67, roughness: 0.28 },
    { id: "conv-bed", type: "box", label: "滚筒床面", x: 0, y: 0.72, z: 0, width: 5.5, height: 0.16, depth: 0.9, color: "#9da9a2", metalness: 0.74, roughness: 0.22 },
    { id: "drive", type: "cylinder", label: "驱动电机", x: -2.55, y: 0.76, z: -0.62, width: 0.48, height: 0.8, depth: 0.48, color: "#d4ad43", metalness: 0.7, roughness: 0.2 },
    { id: "side-left", type: "box", label: "左侧护栏", x: 0, y: 1.05, z: 0.55, width: 5.5, height: 0.62, depth: 0.05, color: "#71857f", metalness: 0.5, roughness: 0.35 },
    { id: "side-right", type: "box", label: "右侧护栏", x: 0, y: 1.05, z: -0.55, width: 5.5, height: 0.62, depth: 0.05, color: "#71857f", metalness: 0.5, roughness: 0.35 },
    { id: "sensor", type: "box", label: "光电传感器", x: -1.6, y: 1.02, z: -0.63, width: 0.16, height: 0.26, depth: 0.16, color: "#68c6c2", metalness: 0.35, roughness: 0.22 },
  ] },
  routerBox: { label: "对向输送接口盒 / LOG-ROUTER-01", description: "依据原项目传送带 1.050 × 0.398 × 0.298 m 的实际显示包围尺寸校准，开口中心与输送面衔接。", parts: ([
    { id: "router-foot", type: "box", label: "减振底座", x: 0, y: 0.08, z: 0, width: 1.72, height: 0.16, depth: 1.72, color: "#1d2626", metalness: 0.65, roughness: 0.32 },
    { id: "router-shell-top", type: "box", label: "贯通腔体上壳", x: 0, y: 0.74, z: 0, width: 1.62, height: 0.24, depth: 1.62, color: "#11191a", metalness: 0.72, roughness: 0.22 },
    { id: "router-shell-bottom", type: "box", label: "贯通腔体下壳", x: 0, y: 0.20, z: 0, width: 1.62, height: 0.18, depth: 1.62, color: "#11191a", metalness: 0.72, roughness: 0.22 },
    { id: "router-shell-front", type: "box", label: "贯通腔体前侧壳", x: 0, y: 0.47, z: -0.66, width: 1.62, height: 0.42, depth: 0.30, color: "#11191a", metalness: 0.72, roughness: 0.22 },
    { id: "router-shell-rear", type: "box", label: "贯通腔体后侧壳", x: 0, y: 0.47, z: 0.66, width: 1.62, height: 0.42, depth: 0.30, color: "#11191a", metalness: 0.72, roughness: 0.22 },
    { id: "router-top", type: "box", label: "顶部维护盖", x: 0, y: 0.87, z: 0, width: 1.48, height: 0.12, depth: 1.48, color: "#2a3536", metalness: 0.64, roughness: 0.25 },
    { id: "router-in-top", type: "box", label: "IN-01 输入管道上壁", x: -1.02, y: 0.67, z: 0, width: 0.54, height: 0.08, depth: 0.78, color: "#172224", metalness: 0.58, roughness: 0.25 },
    { id: "router-in-bottom", type: "box", label: "IN-01 输入管道下壁", x: -1.02, y: 0.25, z: 0, width: 0.54, height: 0.08, depth: 0.78, color: "#172224", metalness: 0.58, roughness: 0.25 },
    { id: "router-in-front", type: "box", label: "IN-01 输入管道前壁", x: -1.02, y: 0.46, z: -0.39, width: 0.54, height: 0.42, depth: 0.08, color: "#172224", metalness: 0.58, roughness: 0.25 },
    { id: "router-in-rear", type: "box", label: "IN-01 输入管道后壁", x: -1.02, y: 0.46, z: 0.39, width: 0.54, height: 0.42, depth: 0.08, color: "#172224", metalness: 0.58, roughness: 0.25 },
    { id: "router-out-top", type: "box", label: "OUT-01 输出管道上壁", x: 1.02, y: 0.67, z: 0, width: 0.54, height: 0.08, depth: 0.78, color: "#172224", metalness: 0.58, roughness: 0.25 },
    { id: "router-out-bottom", type: "box", label: "OUT-01 输出管道下壁", x: 1.02, y: 0.25, z: 0, width: 0.54, height: 0.08, depth: 0.78, color: "#172224", metalness: 0.58, roughness: 0.25 },
    { id: "router-out-front", type: "box", label: "OUT-01 输出管道前壁", x: 1.02, y: 0.46, z: -0.39, width: 0.54, height: 0.42, depth: 0.08, color: "#172224", metalness: 0.58, roughness: 0.25 },
    { id: "router-out-rear", type: "box", label: "OUT-01 输出管道后壁", x: 1.02, y: 0.46, z: 0.39, width: 0.54, height: 0.42, depth: 0.08, color: "#172224", metalness: 0.58, roughness: 0.25 },
    { id: "router-bolt-fl", type: "cylinder", label: "左前维护螺栓", x: -0.59, y: 0.98, z: -0.59, width: 0.12, height: 0.08, depth: 0.12, color: "#4d5a5c", metalness: 0.82, roughness: 0.18 },
    { id: "router-bolt-fr", type: "cylinder", label: "右前维护螺栓", x: 0.59, y: 0.98, z: -0.59, width: 0.12, height: 0.08, depth: 0.12, color: "#4d5a5c", metalness: 0.82, roughness: 0.18 },
    { id: "router-bolt-bl", type: "cylinder", label: "左后维护螺栓", x: -0.59, y: 0.98, z: 0.59, width: 0.12, height: 0.08, depth: 0.12, color: "#4d5a5c", metalness: 0.82, roughness: 0.18 },
    { id: "router-bolt-br", type: "cylinder", label: "右后维护螺栓", x: 0.59, y: 0.98, z: 0.59, width: 0.12, height: 0.08, depth: 0.12, color: "#4d5a5c", metalness: 0.82, roughness: 0.18 },
  ] as ParametricPart[]).map((part) => {
    const scaled = { ...part, x: part.x * (0.78 / 2.58), y: part.y * (0.46 / 1.02), z: part.z * (0.46 / 1.72), width: part.width * (0.78 / 2.58), height: part.height * (0.46 / 1.02), depth: part.depth * (0.46 / 1.72) };
    const isPipe = part.id.startsWith("router-in-") || part.id.startsWith("router-out-");
    if (part.id === "router-shell-front" || part.id === "router-shell-rear") return { ...scaled, z: part.z < 0 ? -0.20 : 0.20, depth: 0.05 };
    if (!isPipe) return scaled;
    if (part.id.endsWith("-top")) return { ...scaled, y: 0.36, height: 0.04, depth: 0.45 };
    if (part.id.endsWith("-bottom")) return { ...scaled, y: 0.18, height: 0.04, depth: 0.45 };
    return { ...scaled, y: 0.27, z: part.z < 0 ? -0.20 : 0.20, height: 0.22, depth: 0.05 };
  }) },
};

const resourceModelingTemplates: Record<string, ModelingResourceTemplate> = {
  [COMPREHENSIVE_DEMO_RESOURCE_ID]: comprehensiveDemoTemplate,
  cnc: { resourceId: "cnc", resourceCode: "MACH-CNC-04", resourceTitle: "CNC 加工中心", projectName: modelPresets.cnc.label, materialSpec: "焊接钢结构 / Q235", density: 7850, tolerance: 0.1, process: "机加工 / 装配", assetPath: modelPresets.cnc.detailAssetPath, parts: modelPresets.cnc.parts },
  robot: { resourceId: "robot", resourceCode: "ASM-ROBOT-06", resourceTitle: "协作机器人单元", projectName: modelPresets.robot.label, materialSpec: "铝型材与铸铝 / 6061", density: 2700, tolerance: 0.08, process: "装配 / 机器人集成", assetPath: modelPresets.robot.detailAssetPath, parts: modelPresets.robot.parts },
  press: { resourceId: "press", resourceCode: "FORM-PRESS-02", resourceTitle: "液压冲压机", projectName: "液压冲压机结构单元", materialSpec: "焊接钢结构 / Q235", density: 7850, tolerance: 0.15, process: "焊接 / 机加工 / 装配", assetPath: "/models/industrial/hydraulic_press_detail.glb", parts: [
    { id: "press-base", type: "box", label: "冲压机底座", x: 0, y: .12, z: 0, width: 2, height: .24, depth: 2, color: "#455753", metalness: .62, roughness: .34 },
    { id: "press-left", type: "box", label: "左立柱", x: -.72, y: .86, z: 0, width: .28, height: 1.25, depth: .52, color: "#60716c", metalness: .58, roughness: .32 },
    { id: "press-right", type: "box", label: "右立柱", x: .72, y: .86, z: 0, width: .28, height: 1.25, depth: .52, color: "#60716c", metalness: .58, roughness: .32 },
    { id: "press-crown", type: "box", label: "上横梁", x: 0, y: 1.46, z: 0, width: 1.72, height: .28, depth: .62, color: "#ca9555", metalness: .62, roughness: .28 },
    { id: "press-bed", type: "box", label: "冲压工作台", x: 0, y: .48, z: 0, width: 1.35, height: .18, depth: 1.05, color: "#9fa8a3", metalness: .74, roughness: .22 },
    { id: "press-ram", type: "box", label: "液压滑块", x: 0, y: 1.03, z: 0, width: .92, height: .32, depth: .76, color: "#d4ad43", metalness: .66, roughness: .24 },
  ] },
  steel: { resourceId: "steel", resourceCode: "MAT-STEEL-CR", resourceTitle: "冷轧钢板", projectName: "冷轧钢板毛坯", materialSpec: "冷轧钢板 / DC01", density: 7850, tolerance: 0.05, process: "冲压 / 钣金", parts: [
    { id: "steel-sheet", type: "box", label: "1200×800×1.5 冷轧钢板", x: 0, y: .00075, z: 0, width: 1.2, height: .0015, depth: .8, color: "#9cabb0", metalness: .82, roughness: .24 },
  ] },
  aluminum: { resourceId: "aluminum", resourceCode: "MAT-AL-6061", resourceTitle: "铝合金毛坯", projectName: "6061 铝合金毛坯", materialSpec: "铝合金 / 6061", density: 2700, tolerance: 0.05, process: "CNC 机加工", parts: [
    { id: "aluminum-stock", type: "box", label: "160×90×45 铝合金毛坯", x: 0, y: .0225, z: 0, width: .16, height: .045, depth: .09, color: "#b9c4c6", metalness: .74, roughness: .2 },
  ] },
  housing: { resourceId: "housing", resourceCode: "PART-HOUSING-01", resourceTitle: "机加工壳体", projectName: "机加工壳体零件", materialSpec: "铝型材与铸铝 / 6061", density: 2700, tolerance: 0.03, process: "CNC 铣削 / 钻孔", parts: [
    { id: "housing-base", type: "box", label: "壳体底板", x: 0, y: .006, z: 0, width: .18, height: .012, depth: .12, color: "#658f94", metalness: .62, roughness: .24 },
    { id: "housing-left", type: "box", label: "左侧壁", x: -.084, y: .038, z: 0, width: .012, height: .064, depth: .12, color: "#658f94", metalness: .62, roughness: .24 },
    { id: "housing-right", type: "box", label: "右侧壁", x: .084, y: .038, z: 0, width: .012, height: .064, depth: .12, color: "#658f94", metalness: .62, roughness: .24 },
    { id: "housing-front", type: "box", label: "前壁", x: 0, y: .038, z: -.054, width: .156, height: .064, depth: .012, color: "#658f94", metalness: .62, roughness: .24 },
    { id: "housing-rear", type: "box", label: "后壁", x: 0, y: .038, z: .054, width: .156, height: .064, depth: .012, color: "#658f94", metalness: .62, roughness: .24 },
  ] },
  motor: { resourceId: "motor", resourceCode: "PROD-MOTOR-08", resourceTitle: "伺服电机总成", projectName: "伺服电机总成", materialSpec: "铝型材与铸铝 / 6061", density: 2700, tolerance: 0.04, process: "机加工 / 装配", parts: [
    { id: "motor-body", type: "cylinder", label: "电机壳体", x: 0, y: .08, z: 0, width: .15, height: .16, depth: .15, color: "#5aa88d", metalness: .66, roughness: .25 },
    { id: "motor-flange", type: "cylinder", label: "安装法兰", x: 0, y: .012, z: 0, width: .19, height: .024, depth: .19, color: "#697e78", metalness: .72, roughness: .22 },
    { id: "motor-shaft", type: "cylinder", label: "输出轴", x: 0, y: -.025, z: 0, width: .035, height: .075, depth: .035, color: "#b8bfba", metalness: .9, roughness: .12 },
    { id: "motor-terminal", type: "box", label: "接线盒", x: .085, y: .105, z: 0, width: .07, height: .065, depth: .09, color: "#344944", metalness: .45, roughness: .32 },
  ] },
  buffer: { resourceId: "buffer", resourceCode: "LOG-BUFFER-03", resourceTitle: "托盘缓存架", projectName: "托盘缓存仓", materialSpec: "焊接钢结构 / Q235", density: 7850, tolerance: 0.15, process: "焊接 / 物流装配", assetPath: "/models/industrial/pallet_buffer_detail.glb", parts: [
    { id: "buffer-base", type: "box", label: "缓存架底座", x: 0, y: .08, z: 0, width: 2, height: .16, depth: 2, color: "#52645f", metalness: .58, roughness: .38 },
    { id: "buffer-post-lf", type: "box", label: "左前立柱", x: -.82, y: .72, z: -.82, width: .12, height: 1.28, depth: .12, color: "#829389", metalness: .55, roughness: .35 },
    { id: "buffer-post-rf", type: "box", label: "右前立柱", x: .82, y: .72, z: -.82, width: .12, height: 1.28, depth: .12, color: "#829389", metalness: .55, roughness: .35 },
    { id: "buffer-post-lb", type: "box", label: "左后立柱", x: -.82, y: .72, z: .82, width: .12, height: 1.28, depth: .12, color: "#829389", metalness: .55, roughness: .35 },
    { id: "buffer-post-rb", type: "box", label: "右后立柱", x: .82, y: .72, z: .82, width: .12, height: 1.28, depth: .12, color: "#829389", metalness: .55, roughness: .35 },
    { id: "buffer-shelf-1", type: "box", label: "一级托盘位", x: 0, y: .38, z: 0, width: 1.7, height: .08, depth: 1.7, color: "#a4aea8", metalness: .68, roughness: .26 },
    { id: "buffer-shelf-2", type: "box", label: "二级托盘位", x: 0, y: .82, z: 0, width: 1.7, height: .08, depth: 1.7, color: "#a4aea8", metalness: .68, roughness: .26 },
    { id: "buffer-shelf-3", type: "box", label: "三级托盘位", x: 0, y: 1.26, z: 0, width: 1.7, height: .08, depth: 1.7, color: "#a4aea8", metalness: .68, roughness: .26 },
  ] },
  "router-box": { resourceId: "router-box", resourceCode: "LOG-ROUTER-01", resourceTitle: "对向输送接口盒", projectName: modelPresets.routerBox.label, materialSpec: "焊接钢结构 / Q235", density: 7850, tolerance: 0.08, process: "物流接口 / 装配", parts: modelPresets.routerBox.parts },
};

const getResourceModelingTemplate = (resourceId: string) => resourceModelingTemplates[resourceId];

const inferMaintainedResourceId = (name: string, parts: ParametricPart[]): string | undefined => {
  const explicit = parts.map((part) => part.sourceResourceId).find((id): id is string => Boolean(id && resourceModelingTemplates[id]));
  if (explicit) return explicit;
  const normalized = name.toLocaleLowerCase("zh-CN");
  if (/vmc|数控|加工中心/.test(normalized)) return "cnc";
  if (/机器人|机械臂/.test(normalized)) return "robot";
  if (/输送|滚筒|传送/.test(normalized)) return "conveyor";
  if (/冲压|压力机/.test(normalized)) return "press";
  if (/缓存|托盘仓/.test(normalized)) return "buffer";
  if (/伺服电机|电机总成/.test(normalized)) return "motor";
  if (/机加工壳体|壳体零件/.test(normalized)) return "housing";
  if (/接口盒|router/.test(normalized)) return "router-box";
  return undefined;
};

const resourceTemplateToModeling = (template: ModelingResourceTemplate): ResourceModeling => {
  const instantiated = instantiateResourceTemplate(template, [], { placement: "origin", instanceKey: `resource-${template.resourceId}` });
  const bounds = resourceBounds(instantiated.parts);
  return {
    mode: "parametric",
    // Resource cards with a maintained reference asset must never fall back to
    // the legacy box/cylinder preview. Editing still opens the matching
    // feature-driven CadDocument through the Part Studio entry.
    modelView: template.assetPath ? "reference" : "editable",
    projectName: template.projectName,
    materialSpec: template.materialSpec,
    widthM: Math.max(bounds.width, .001),
    depthM: Math.max(bounds.depth, .001),
    heightM: Math.max(bounds.height, .001),
    accent: instantiated.parts[0]?.color ?? "#d4ad43",
    assetPath: template.assetPath ?? "procedural",
    modelReference: template.assetPath ? { kind: "asset-path", uri: template.assetPath, embedded: false } : { kind: "asset-path", uri: "procedural", embedded: false },
    parametricParts: instantiated.parts as ParametricPart[],
    engineeringProperties: instantiated.engineering,
    manualSketch: [],
    sketchDepthM: 1,
    sketchBevelM: .035,
    snapGrid: 20,
  };
};

export default function Home() {
  const [screen, setScreen] = useState<"overview" | "library" | "workbench" | "contract">("overview");
  const [kind, setKind] = useState<ResourceKind | "全部">("全部");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("cnc");
  const [pack, setPack] = useState<string[]>(["cnc", "steel"]);
  const [tone, setTone] = useState("#d4ad43");
  const [modelMode, setModelMode] = useState<"parametric" | "sketch" | "hybrid">("parametric");
  const [modelView, setModelView] = useState<ModelView>("editable");
  const [strokes, setStrokes] = useState<SketchStroke[]>([]);
  const [parts, setParts] = useState<ParametricPart[]>([]);
  const [assetPath, setAssetPath] = useState("procedural");
  const [uploadedModel, setUploadedModel] = useState<string | null>(null);
  const [uploadedModelName, setUploadedModelName] = useState("");
  const [sketchDepth, setSketchDepth] = useState(1);
  const [sketchBevel, setSketchBevel] = useState(0.035);
  const [sketchTool, setSketchTool] = useState<SketchEntityKind>("spline");
  const [activeSketchId, setActiveSketchId] = useState("");
  const [nextPocketTargetId, setNextPocketTargetId] = useState("");
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [gridDivisions, setGridDivisions] = useState(20);
  const [activePartId, setActivePartId] = useState("");
  const [projectName, setProjectName] = useState("VMC-850 加工单元");
  const [projectMaterial, setProjectMaterial] = useState("焊接钢结构 / Q235");
  const [partEngineering, setPartEngineering] = useState<Record<string, PartEngineering>>({});
  const [patternCount, setPatternCount] = useState(3);
  const [patternSpacing, setPatternSpacing] = useState(0.25);
  const [designRecords, setDesignRecords] = useState<DesignRecord[]>([]);
  const [historyReady, setHistoryReady] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [workbenchSessionStarted, setWorkbenchSessionStarted] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const [agentQuestion, setAgentQuestion] = useState("");
  const [agentPlan, setAgentPlan] = useState<AgentPlan | null>(null);
  const [prototypeMode, setPrototypeMode] = useState(false);
  const [customModelSnapshot, setCustomModelSnapshot] = useState<CustomModelSnapshot>({ name: "未命名设计", mode: "parametric", modelView: "editable", parts: [], strokes: [], material: "焊接钢结构 / Q235", partEngineering: {}, assetPath: "procedural", depth: 1, bevel: .035 });
  const [undoStack, setUndoStack] = useState<ProjectSnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<ProjectSnapshot[]>([]);
  const [projectStorageReady, setProjectStorageReady] = useState(false);
  const [autoSaveLabel, setAutoSaveLabel] = useState("本地草稿尚未保存");
  const [workPlane, setWorkPlane] = useState<"XY" | "XZ" | "YZ">("XY");
  const [sketchPlane, setSketchPlane] = useState<SketchPlane>("top");
  const [sketchCamera, setSketchCamera] = useState<"iso" | "top" | "front" | "right">("iso");
  const [parametricCamera, setParametricCamera] = useState<"iso" | "top" | "front" | "right">("iso");
  const [parametricCameraReset, setParametricCameraReset] = useState(0);
  const [directEditOutline, setDirectEditOutline] = useState<SketchStroke | null>(null);
  const [directEditDraft, setDirectEditDraft] = useState<SketchStroke | null>(null);
  const [transformSnap, setTransformSnap] = useState(true);
  const [transformStep, setTransformStep] = useState(.05);
  const [transformMode, setTransformMode] = useState<"translate" | "rotate">("translate");
  const [modelLoadStatus, setModelLoadStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [exportingGlb, setExportingGlb] = useState(false);
  const [notice, setNotice] = useState("准备导入 02 个资源");
  const sketchCanvas = useRef<HTMLCanvasElement>(null);
  const sketching = useRef(false);
  const directEditDraftRef = useRef<SketchStroke | null>(null);
  const projectImportInput = useRef<HTMLInputElement>(null);
  const resourcePackImportInput = useRef<HTMLInputElement>(null);
  const snapshotRef = useRef<ProjectSnapshot | null>(null);
  const autoSaveTimer = useRef<number | null>(null);
  // Browser navigation is an external source; hydrate it once after mounting.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("screen") === "library") setScreen("library"); }, []);
  // Pointer events arrive much faster than a React/Three scene can be rebuilt.
  // Keep the in-progress stroke outside React and publish it to the solid preview
  // at a steady cadence; the complete stroke is committed when the pointer lifts.
  const strokesRef = useRef<SketchStroke[]>([]);
  const previewTimer = useRef<number | null>(null);
  const visible = useMemo(() => resources.filter((item) => (kind === "全部" || item.kind === kind) && `${item.title} ${item.code} ${item.description} ${item.tags.join(" ")}`.toLowerCase().includes(query.trim().toLowerCase())), [kind, query]);
  const selected = resources.find((item) => item.id === selectedId) ?? resources[0];
  const packResources = resources.filter((item) => pack.includes(item.id));
  const makeProjectSnapshot = useCallback((): ProjectSnapshot => ({ format: "forgemind-project", version: 2, name: projectName, mode: modelMode, modelView, parts, strokes, material: projectMaterial, partEngineering, accent: tone, assetPath: uploadedModel ? "procedural" : assetPath, depth: sketchDepth, bevel: sketchBevel, grid: gridDivisions, snap: snapEnabled, savedAt: new Date().toISOString() }), [assetPath, gridDivisions, modelMode, modelView, partEngineering, parts, projectMaterial, projectName, sketchBevel, sketchDepth, snapEnabled, strokes, tone, uploadedModel]);
  const applyProjectSnapshot = useCallback((snapshot: ProjectSnapshot, message: string) => {
    const normalizedStrokes = normalizeSketchStrokes(snapshot.strokes); const normalizedSnapshot: ProjectSnapshot = { ...snapshot, version: 2, strokes: normalizedStrokes, partEngineering: normalizePartEngineering(snapshot.partEngineering) };
    const nextActivePartId = normalizedSnapshot.parts.find((part) => part.selected)?.id ?? normalizedSnapshot.parts[0]?.id ?? "";
    setProjectName(normalizedSnapshot.name); setModelMode(normalizedSnapshot.mode); setModelView(normalizedSnapshot.modelView === "reference" && normalizedSnapshot.assetPath !== "procedural" ? "reference" : "editable"); setParts(normalizedSnapshot.parts.map((part) => ({ ...part, selected: part.id === nextActivePartId }))); setStrokes(normalizedStrokes); strokesRef.current = normalizedStrokes; setActiveSketchId(normalizedStrokes.at(-1)?.id ?? ""); setProjectMaterial(normalizedSnapshot.material); setPartEngineering(normalizedSnapshot.partEngineering ?? {}); setTone(normalizedSnapshot.accent); setAssetPath(normalizedSnapshot.assetPath); setUploadedModel(null); setUploadedModelName(""); setSketchDepth(normalizedSnapshot.depth); setSketchBevel(normalizedSnapshot.bevel); setGridDivisions(normalizedSnapshot.grid); setSnapEnabled(normalizedSnapshot.snap); setActivePartId(nextActivePartId); setDirectEditOutline(null); setDirectEditDraft(null); directEditDraftRef.current = null; snapshotRef.current = normalizedSnapshot; setNotice(message);
  }, []);
  const undoProject = useCallback(() => {
    const previous = undoStack[undoStack.length - 1]; if (!previous) return;
    const current = makeProjectSnapshot(); setUndoStack((items) => items.slice(0, -1)); setRedoStack((items) => [current, ...items].slice(0, 40)); applyProjectSnapshot(previous, "已撤销上一步建模修改");
  }, [applyProjectSnapshot, makeProjectSnapshot, undoStack]);
  const redoProject = useCallback(() => {
    const next = redoStack[0]; if (!next) return;
    const current = makeProjectSnapshot(); setRedoStack((items) => items.slice(1)); setUndoStack((items) => [...items, current].slice(-40)); applyProjectSnapshot(next, "已恢复下一步建模修改");
  }, [applyProjectSnapshot, makeProjectSnapshot, redoStack]);
  const exportProject = () => {
    const snapshot = makeProjectSnapshot(); const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" })); const link = document.createElement("a"); link.href = url; link.download = `${projectName || "forgemind-project"}.forgemind-project.json`; link.click(); URL.revokeObjectURL(url); void exportGlb(); setNotice("正在导出项目 JSON 与 GLB 三维模型…");
  };
  const exportGlb = async () => {
    if (exportingGlb) return;
    setExportingGlb(true);
    const root = new THREE.Group(); root.name = projectName || "ForgeMindDevice";
    try {
      if (modelView === "reference" && (uploadedModel || assetPath !== "procedural")) {
        const response = await fetch(uploadedModel ?? assetPath); if (!response.ok) throw new Error("reference fetch failed"); const source = await response.blob();
        const url = URL.createObjectURL(source); const link = document.createElement("a"); link.href = url; link.download = `${projectName || "forgemind-reference"}.glb`; link.click(); URL.revokeObjectURL(url); setNotice("已导出当前高精度参考 GLB；项目 JSON 中同时保留可编辑部件数据。"); return;
      }
      parts.forEach((part) => {
        if (part.hidden) return;
        const geometry = createParametricPartGeometry(part);
        const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: part.color, metalness: Math.max(0, part.metalness), roughness: Math.max(.03, part.roughness) }));
        mesh.name = part.label; mesh.position.set(part.x, part.y, part.z); mesh.rotation.set(THREE.MathUtils.degToRad(part.rotationX ?? 0), THREE.MathUtils.degToRad(part.rotationY ?? 0), THREE.MathUtils.degToRad(part.rotationZ ?? 0));
        root.add(mesh);
      });
      const closedSketchProfiles = strokes.filter((stroke) => isClosedSketchProfile(stroke.kind) && !stroke.construction && stroke.feature?.enabled !== false && stroke.points.length >= 3);
      const addSketchPath = (path: THREE.Path, points: THREE.Vector2[]) => { path.moveTo(points[0].x, points[0].y); if (points.length > 8) path.splineThru(points.slice(1)); else points.slice(1).forEach((point) => path.lineTo(point.x, point.y)); path.closePath(); };
      strokes.forEach((stroke, index) => {
        if (!closedSketchProfiles.includes(stroke) || stroke.feature?.operation === "pocket") return;
        const operation = stroke.feature?.operation ?? "extrude";
        const shape = new THREE.Shape(); const points = stroke.points.map((point) => new THREE.Vector2((point.x - .5) * 5, (.5 - point.y) * 5));
        addSketchPath(shape, points);
        if (operation === "extrude") closedSketchProfiles.filter((pocket) => pocket.feature?.operation === "pocket" && pocket.feature.targetId === stroke.id && pocket.plane === stroke.plane).forEach((pocket) => { const pocketPoints = pocket.points.map((point) => new THREE.Vector2((point.x - .5) * 5, (.5 - point.y) * 5)); const patternCount = Math.max(1, Math.min(24, Math.round(pocket.feature?.patternCount ?? 1))); const patternMode = pocket.feature?.patternMode ?? "circular"; const patternAngle = Math.max(.1, Math.min(360, pocket.feature?.patternAngle ?? 360)); const patternSpacing = Math.max(.001, Math.min(10, pocket.feature?.patternSpacing ?? .2)); const step = patternCount < 2 ? 0 : THREE.MathUtils.degToRad(patternAngle >= 359.999 ? patternAngle / patternCount : patternAngle / (patternCount - 1)); for (let instance = 0; instance < patternCount; instance += 1) { const holePoints = patternMode === "linear" ? pocketPoints.map((point) => point.clone().add(new THREE.Vector2(patternSpacing * instance, 0))) : pocketPoints.map((point) => point.clone().rotateAround(new THREE.Vector2(), step * instance)); const hole = new THREE.Path(); addSketchPath(hole, holePoints); shape.holes.push(hole); } });
        const featureDepth = stroke.feature?.depth ?? sketchDepth; const featureBevel = stroke.feature?.bevel ?? sketchBevel;
        const geometry = operation === "revolve" ? new THREE.LatheGeometry(points.map((point) => new THREE.Vector2(Math.abs(point.x), point.y)), 96, 0, THREE.MathUtils.degToRad(Math.max(.1, Math.min(360, stroke.feature?.angle ?? 360))) ) : new THREE.ExtrudeGeometry(shape, { depth: Math.max(.001, featureDepth), bevelEnabled: featureBevel > .0001, bevelSize: featureBevel, bevelThickness: featureBevel, bevelSegments: 3, curveSegments: Math.min(96, Math.max(12, points.length)) });
        if (operation !== "revolve" && stroke.plane === "top") geometry.rotateX(-Math.PI / 2); else if (operation !== "revolve" && stroke.plane === "right") geometry.rotateY(Math.PI / 2);
        const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: tone, metalness: .58, roughness: .3 })); mesh.name = `草图实体 ${index + 1}`; root.add(mesh);
      });
      const { GLTFExporter } = await import("three/examples/jsm/exporters/GLTFExporter.js");
      const exported = await new GLTFExporter().parseAsync(root, { binary: true, onlyVisible: true });
      const binary = exported instanceof ArrayBuffer ? exported : null;
      if (!binary) throw new Error("GLB export did not return binary data");
      const url = URL.createObjectURL(new Blob([binary], { type: "model/gltf-binary" })); const link = document.createElement("a"); link.href = url; link.download = `${projectName || "forgemind-device"}.glb`; link.click(); URL.revokeObjectURL(url); setNotice("GLB 三维模型已导出；如需继续修改，请同时保留项目 JSON 文件。");
    } catch {
      setNotice("GLB 导出失败；项目 JSON 未受影响，可继续保存或重试。");
    } finally {
      root.traverse((node) => { if (node instanceof THREE.Mesh) { node.geometry.dispose(); const materials = Array.isArray(node.material) ? node.material : [node.material]; materials.forEach((material) => material.dispose()); } });
      setExportingGlb(false);
    }
  };
  const importProject = (file: File | undefined) => {
    if (!file) return; const reader = new FileReader();
    reader.onload = () => { try { const snapshot = JSON.parse(String(reader.result)) as ProjectSnapshot; if (snapshot.format !== "forgemind-project" || ![1, 2].includes(snapshot.version) || !Array.isArray(snapshot.parts) || !Array.isArray(snapshot.strokes)) throw new Error("invalid"); setUndoStack((items) => [...items, makeProjectSnapshot()].slice(-40)); setRedoStack([]); applyProjectSnapshot(snapshot, `已导入项目“${snapshot.name}”${snapshot.version === 1 ? "（已迁移工程属性）" : ""}`); setWorkbenchSessionStarted(true); setScreen("workbench"); } catch { setNotice("项目文件无效，未导入任何内容"); } };
    reader.readAsText(file);
  };
  const importResourcePackForModeling = (file: File | undefined) => {
    if (!file) return; const reader = new FileReader();
    reader.onload = async () => {
      try {
        const raw = JSON.parse(String(reader.result)) as Partial<ResourcePackArtifact>;
        if (raw.format !== "forgemind-resource-pack" || raw.schemaVersion !== "1.0.0" || !Array.isArray(raw.resources)) throw new Error("invalid resource pack");
        const artifact = raw as ResourcePackArtifact; const errors = validateResourcePack(artifact); if (errors.length) throw new Error(errors[0]);
        const modelingResources = artifact.resources.filter((item) => item.modeling && Array.isArray(item.modeling.parametricParts));
        if (!modelingResources.length) { setNotice("资源包有效，但其中没有可转换为 CAD 的建模定义"); return; }
        const [{ buildCadDocumentFromResourceTemplate }, { createUnifiedCadDocument, mergeCadDocuments }, { createHighDetailResourceCadDocument }] = await Promise.all([
          import("../core/resource/ResourceCadBridge"),
          import("../core/authoring/UnifiedCadWorkspace"),
          import("../core/resource/HighDetailResourceCad"),
        ]);
        let document = createUnifiedCadDocument(`资源包建模 · ${file.name.replace(/\.json$/i, "")}`); let applied = 0;
        modelingResources.forEach((item, index) => {
          const modeling = item.modeling!; const firstEngineering = Object.values(modeling.engineeringProperties ?? {})[0];
          const template: ModelingResourceTemplate = {
            resourceId: item.id, resourceCode: item.code, resourceTitle: item.title, projectName: modeling.projectName || item.title,
            materialSpec: modeling.materialSpec || firstEngineering?.material || "碳钢 / Q235", density: firstEngineering?.density ?? 7850,
            tolerance: firstEngineering?.tolerance ?? .1, process: firstEngineering?.process ?? item.process ?? "机加工", assetPath: modeling.assetPath,
            parts: modeling.parametricParts,
          };
          const highDetail = createHighDetailResourceCadDocument(item.id);
          const incoming = highDetail ?? buildCadDocumentFromResourceTemplate(template, { instanceKey: createLocalId(`pack-${item.id}-${index}`) }).document;
          document = mergeCadDocuments(document, incoming); applied += 1;
        });
        document = { ...document, name: `资源包建模 · ${applied} 项`, updatedAt: Date.now() };
        saveCadDocumentHandoff(window.sessionStorage, document); saveCadDocumentHandoff(window.localStorage, document);
        setNotice(`已将资源包中的 ${applied} 个资源转换为统一 CadDocument；正在进入自由建模 Part Studio。`);
        window.location.href = `/cad?mode=part&documentId=${encodeURIComponent(document.id)}`;
      } catch (error) { setNotice(`资源包导入失败：${error instanceof Error ? error.message : "格式无效"}`); }
    };
    reader.readAsText(file);
  };
  const togglePack = (id: string) => setPack((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  const addSelected = () => { if (!pack.includes(selected.id)) setPack((current) => [...current, selected.id]); setNotice(`${selected.title} 已同步到待导入清单`); };
  // The professional Part Studio is the exact CAD route.  The visual equipment
  // workbench remains available for rapid project creation, presentation and
  // high-detail factory asset review.
  const createNewProfessionalCad = async () => {
    const { createUnifiedCadDocument } = await import("../core/authoring/UnifiedCadWorkspace");
    const document = createUnifiedCadDocument("未命名自由建模项目");
    saveCadDocumentHandoff(window.sessionStorage, document); saveCadDocumentHandoff(window.localStorage, document);
    window.location.href = `/cad?mode=part&documentId=${encodeURIComponent(document.id)}&new=1`;
  };
  const openComprehensiveDemoProject = async () => {
    const { createComprehensiveDemoCadDocument } = await import("../core/demo/ComprehensiveDemoProject");
    const document = createComprehensiveDemoCadDocument();
    saveCadDocumentHandoff(window.sessionStorage, document, { sourceResourceId: COMPREHENSIVE_DEMO_RESOURCE_ID });
    saveCadDocumentHandoff(window.localStorage, document, { sourceResourceId: COMPREHENSIVE_DEMO_RESOURCE_ID });
    setSelectedId(COMPREHENSIVE_DEMO_RESOURCE_ID);
    const visiblePartCount = Object.values(document.bodies).filter((body) => body.visible).length;
    setNotice(`智能精密工作站已加载：${visiblePartCount} 个成品零件、${comprehensiveDemoLogicalParts.length} 个一体结构件、${document.featureOrder.length} 项可编辑历史。`);
    window.location.assign(`/cad?mode=part&documentId=${encodeURIComponent(document.id)}`);
  };
  const openResourceInWorkbench = (resourceId: string) => { void openResourceInProfessionalCad(resourceId, "detail"); };
  const openResourceInProfessionalCad = async (resourceId: string, view: "free" | "detail" = "free") => {
    if (resourceId === COMPREHENSIVE_DEMO_RESOURCE_ID) { await openComprehensiveDemoProject(); return; }
    const resource = resources.find((item) => item.id === resourceId);
    const template = getResourceModelingTemplate(resourceId);
    if (!resource || !template) { setNotice("该资源暂未配置可转换为 B-Rep 的建模模板"); return; }
    try {
      const [{ buildCadDocumentFromResourceTemplate }, { createHighDetailResourceCadDocument }] = await Promise.all([
        import("../core/resource/ResourceCadBridge"),
        import("../core/resource/HighDetailResourceCad"),
      ]);
      const expectedPrecisionId = `cad-resource-${resourceId}-precision-v2`;
      const stored = loadCadDocumentHandoff(window.sessionStorage, { resourceId }) ?? loadCadDocumentHandoff(window.localStorage, { resourceId });
      const document = stored?.document.id === expectedPrecisionId
        ? stored.document
        : createHighDetailResourceCadDocument(resourceId)
          ?? buildCadDocumentFromResourceTemplate(template, { documentName: `${template.projectName} · B-Rep` }).document;
      saveCadDocumentHandoff(window.sessionStorage, document, { sourceResourceId: resourceId });
      saveCadDocumentHandoff(window.localStorage, document, { sourceResourceId: resourceId });
      setSelectedId(resourceId);
      setNotice(`已将资源“${resource.title}”写入专业 CAD 会话：${Object.keys(document.bodies).length} 个 Body、${document.featureOrder.length} 个 Feature。`);
      window.location.assign(`/cad?mode=part&resourceId=${encodeURIComponent(resourceId)}${view === "detail" ? "&view=detail" : ""}`);
    } catch (error) {
      setNotice(`专业 CAD 转换失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };
  const openProfessionalCad = () => { void createNewProfessionalCad(); };
  const openAssemblyWorkbench = () => { window.location.href = "/assembly"; };
  const openResourcePackInFreeModeling = async (resourceIds: string[]) => {
    const entries = resourceIds.map((id) => ({ id, template: getResourceModelingTemplate(id) })).filter((value): value is { id: string; template: ModelingResourceTemplate } => Boolean(value.template));
    if (!entries.length) { setNotice("请先选择可建模资源"); return; }
    try {
      const [{ buildCadDocumentFromResourceTemplate }, { createUnifiedCadDocument, mergeCadDocuments }, { createHighDetailResourceCadDocument }] = await Promise.all([
        import("../core/resource/ResourceCadBridge"),
        import("../core/authoring/UnifiedCadWorkspace"),
        import("../core/resource/HighDetailResourceCad"),
      ]);
      let document = createUnifiedCadDocument(`资源组合装配项目 · ${entries.length} 项`);
      entries.forEach(({ id, template }, index) => {
        const incoming = createHighDetailResourceCadDocument(id)
          ?? buildCadDocumentFromResourceTemplate(template, { instanceKey: createLocalId(`pack-${id}-${index}`) }).document;
        document = mergeCadDocuments(document, incoming);
      });
      saveCadDocumentHandoff(window.sessionStorage, document); saveCadDocumentHandoff(window.localStorage, document);
      setNotice(`已将 ${entries.length} 个资源转换为统一 Multi-body CadDocument；正在进入自由建模 Part Studio。`);
      window.location.href = `/cad?mode=part&documentId=${encodeURIComponent(document.id)}`;
    } catch (error) { setNotice(`资源组合 B-Rep 转换失败：${error instanceof Error ? error.message : String(error)}`); }
  };
  const updatePart = (id: string, key: keyof ParametricPart, value: string | number | boolean) => { setModelView("editable"); setParts((current) => current.map((part) => {
    if (part.id !== id || (part.locked && ["x", "y", "z"].includes(key))) return part;
    const snapped = transformSnap && typeof value === "number" && ["x", "y", "z"].includes(key) ? Math.round(value / Math.max(.001, transformStep)) * Math.max(.001, transformStep) : value;
    return { ...part, [key]: snapped };
  })); };
  const selectPart = (id: string) => { setActivePartId(id); setParts((current) => current.map((part) => ({ ...part, selected: part.id === id }))); };
  const togglePartVisibility = (id: string) => setParts((current) => current.map((part) => part.id === id ? { ...part, hidden: !part.hidden } : part));
  const isolateActivePart = () => { if (!activePart) return; setParts((current) => current.map((part) => ({ ...part, hidden: part.id !== activePart.id }))); };
  const showAllParts = () => setParts((current) => current.map((part) => part.hidden ? { ...part, hidden: false } : part));
  const commitViewportTransform = (id: string, transform: { x: number; y: number; z: number; rotationX: number; rotationY: number; rotationZ: number }) => setParts((current) => current.map((part) => {
    if (part.id !== id || part.locked) return part;
    const snapPosition = (value: number) => transformSnap ? Math.round(value / Math.max(.001, transformStep)) * Math.max(.001, transformStep) : value;
    return { ...part, x: snapPosition(transform.x), y: snapPosition(transform.y), z: snapPosition(transform.z), rotationX: transform.rotationX, rotationY: transform.rotationY, rotationZ: transform.rotationZ };
  }));
  const outlineFromPart = (part: ParametricPart, plane: SketchPlane = "top"): SketchStroke => {
    const toSketchPoint = (u: number, v: number): SketchPoint => ({ x: u / 5 + .5, y: .5 - v / 5 });
    const axes = plane === "top" ? { u: part.x, v: part.z, width: part.width, height: part.depth } : plane === "front" ? { u: part.x, v: part.y, width: part.width, height: part.height } : { u: -part.z, v: part.y, width: part.depth, height: part.height };
    if (part.type === "cylinder" || part.type === "cone" || part.type === "torus") {
      const radiusU = Math.abs(axes.width) / 2; const radiusV = Math.abs(axes.height) / 2;
      return { id: createLocalId(`part-outline-${part.id}`), plane, points: Array.from({ length: 49 }, (_, index) => { const theta = (index / 48) * Math.PI * 2; return toSketchPoint(axes.u + Math.cos(theta) * radiusU, axes.v + Math.sin(theta) * radiusV); }) };
    }
    const halfWidth = Math.abs(axes.width) / 2; const halfHeight = Math.abs(axes.height) / 2;
    const corners = [[-halfWidth, -halfHeight], [halfWidth, -halfHeight], [halfWidth, halfHeight], [-halfWidth, halfHeight], [-halfWidth, -halfHeight]];
    return { id: createLocalId(`part-outline-${part.id}`), plane, points: corners.map(([u, v]) => toSketchPoint(axes.u + u, axes.v + v)) };
  };
  const beginDirectEdit = (part: ParametricPart, plane: SketchPlane = "top") => {
    setModelView("editable"); setSketchPlane(plane); setSketchCamera(plane); setDirectEditDraft(null); directEditDraftRef.current = null; setDirectEditOutline(outlineFromPart(part, plane)); selectPart(part.id); setNotice(`正在修整“${part.label}”的参数包络：重绘 ${plane === "top" ? "俯视" : plane === "front" ? "前视" : "右视"}边界后，将更新该部件对应方向的尺寸与位置。`);
  };
  // Kept as the common selection handler for the tree and the 3D context menu.
  // It deliberately creates only a temporary editing projection, never a sketch solid.
  const selectPartAndSyncSketch = (part: ParametricPart) => beginDirectEdit(part, sketchPlane);
  const addPart = (type: PrimitiveKind) => { const id = createLocalId("part"); setModelView("editable"); setActivePartId(id); setParts((current) => [...current.map((part) => ({ ...part, selected: false })), { id, selected: true, type, label: `自定义${type}部件`, x: 0, y: 1, z: 0, width: 1, height: 1, depth: 1, color: tone, metalness: 0.5, roughness: 0.35 }]); };
  const removeActivePart = () => {
    if (!activePart) return;
    const nextParts = parts.filter((part) => part.id !== activePart.id).map((part, index) => ({ ...part, selected: index === 0 }));
    setParts(nextParts); setActivePartId(nextParts[0]?.id ?? ""); setPartEngineering((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== activePart.id))); setNotice(`已删除部件“${activePart.label}”`);
  };
  const createNewProject = () => {
    void createNewProfessionalCad();
  };
  const applyPreset = async (presetKey: string) => {
    const resourceId = presetKey === "routerBox" ? "router-box" : presetKey;
    const { createHighDetailResourceCadDocument } = await import("../core/resource/HighDetailResourceCad");
    const document = createHighDetailResourceCadDocument(resourceId);
    if (document) {
      saveCadDocumentHandoff(window.sessionStorage, document, { sourceResourceId: resourceId });
      saveCadDocumentHandoff(window.localStorage, document, { sourceResourceId: resourceId });
      setSelectedId(resourceId);
      setNotice(`已打开 ${document.name}：参考外观与可编辑结构现在使用同一套精细模型。`);
      window.location.href = `/cad?mode=part&resourceId=${encodeURIComponent(resourceId)}${modelPresets[presetKey]?.detailAssetPath ? "&view=detail" : ""}`;
      return;
    }
    if (!prototypeMode) setCustomModelSnapshot({ name: projectName, mode: modelMode, modelView, parts, strokes, material: projectMaterial, partEngineering, assetPath, depth: sketchDepth, bevel: sketchBevel });
    const preset = modelPresets[presetKey]; const freshParts = preset.parts.map((part, index) => ({ ...part, id: createLocalId(`${presetKey}-${part.id}-${index}`), selected: index === 0 }));
    setParts(freshParts); setPartEngineering({}); setActivePartId(freshParts[0]?.id ?? ""); setProjectName(preset.label); setModelMode("parametric"); setUploadedModel(null); setUploadedModelName(""); setAssetPath(preset.detailAssetPath ?? "procedural"); setModelView(preset.detailAssetPath ? "reference" : "editable"); setDirectEditOutline(null); setDirectEditDraft(null); directEditDraftRef.current = null; setPrototypeMode(true);
    setNotice(`已加载 ${preset.label} 的可编辑设备装配原型`);
  };
  const returnToCustomModel = useCallback(() => { setProjectName(customModelSnapshot.name); setModelMode(customModelSnapshot.mode); setModelView(customModelSnapshot.modelView); setParts(customModelSnapshot.parts.map((part, index) => ({ ...part, selected: index === 0 }))); setActivePartId(customModelSnapshot.parts[0]?.id ?? ""); setStrokes(customModelSnapshot.strokes); strokesRef.current = customModelSnapshot.strokes; setProjectMaterial(customModelSnapshot.material); setPartEngineering(customModelSnapshot.partEngineering); setSketchDepth(customModelSnapshot.depth); setSketchBevel(customModelSnapshot.bevel); setAssetPath(customModelSnapshot.assetPath); setUploadedModel(null); setUploadedModelName(""); setDirectEditOutline(null); setDirectEditDraft(null); directEditDraftRef.current = null; setPrototypeMode(false); setNotice("已完整恢复进入工业设备原型前的自定义建模状态"); }, [customModelSnapshot]);
  const enterHybridEditing = () => { setModelMode("hybrid"); setModelView("editable"); setUploadedModel(null); setUploadedModelName(""); setNotice(assetPath === "procedural" ? "已进入融合编辑：草图将修整参数化部件包络。" : "已进入融合编辑并切换到可编辑结构；高精度 GLB 保留为只读参考，可随时切回对照。 "); };
  const saveDesignRecord = (name = projectName) => { const record: DesignRecord = { id: createLocalId("design"), name: name || "未命名设计", mode: modelMode, modelView, savedAt: new Date().toLocaleString("zh-CN"), parts, strokes, assetPath, projectMaterial, partEngineering, sketchDepth, sketchBevel }; setDesignRecords((current) => [record, ...current].slice(0, 30)); setNotice(`已保存“${record.name}”，可在设计历史中随时切换`); };
  const restoreDesignRecord = (record: DesignRecord) => { const normalizedStrokes = normalizeSketchStrokes(record.strokes); setProjectName(record.name); setModelMode(record.mode); setModelView(record.modelView === "reference" && record.assetPath !== "procedural" ? "reference" : "editable"); setParts(record.parts.map((part, index) => ({ ...part, selected: index === 0 }))); setActivePartId(record.parts[0]?.id ?? ""); setStrokes(normalizedStrokes); strokesRef.current = normalizedStrokes; setAssetPath(record.assetPath); setProjectMaterial(record.projectMaterial); setPartEngineering(normalizePartEngineering(record.partEngineering)); setSketchDepth(record.sketchDepth); setSketchBevel(record.sketchBevel); setDirectEditOutline(null); setDirectEditDraft(null); directEditDraftRef.current = null; setHistoryOpen(false); setNotice(`已切换到已保存设计：${record.name}`); };
  const continueRecentProject = () => {
    const maintainedResourceId = inferMaintainedResourceId(projectName, parts);
    if (maintainedResourceId) { void openResourceInProfessionalCad(maintainedResourceId); return; }
    setWorkbenchSessionStarted(true);
  };
  const openSavedDesignRecord = (record: DesignRecord) => {
    const maintainedResourceId = inferMaintainedResourceId(record.name, record.parts);
    if (maintainedResourceId) { void openResourceInProfessionalCad(maintainedResourceId); return; }
    restoreDesignRecord(record); setWorkbenchSessionStarted(true);
  };
  const createAgentPlan = () => { const prompt = agentQuestion.trim().toLowerCase(); const plan: AgentPlan = prompt.includes("机械臂") || prompt.includes("机器人") ? { kind: "robot", title: "六轴机器人装配方案", summary: "采用底板、机器人本体、夹爪、工装台与安全围栏的标准装配结构，并加载高精度机械臂外观。", steps: ["加载六轴机器人单元原型", "确认工装台与机器人底座的地面位置", "编辑末端夹爪、围栏和安全距离", "补充材料、公差与装配工艺"] } : prompt.includes("输送") || prompt.includes("滚筒") || prompt.includes("传送") ? { kind: "conveyor", title: "模块化输送设备方案", summary: "采用铝型材机架、滚筒床面、驱动电机、护栏和传感器的模块化布局。", steps: ["加载滚筒输送原型", "按产线长度调整机架与床面", "设置驱动、电机和传感器位置", "用线性阵列扩展重复模组"] } : prompt.includes("草图") || prompt.includes("手绘") || prompt.includes("外形") || prompt.includes("壳体") ? { kind: "manual", title: "自定义壳体草图方案", summary: "创建带圆角过渡的多段闭合轮廓，并设置实体厚度和倒角作为概念壳体。", steps: ["切换到约束草图", "启用网格吸附并绘制外形", "设定厚度和倒角", "继续增加孔位或附加轮廓"] } : { kind: "cnc", title: "数控加工单元方案", summary: "采用床身、围护、工作台、主轴、刀库、控制箱与排屑装置的完整加工中心结构。", steps: ["加载 VMC-850 原型", "确认床身与减振基础对齐地面", "编辑主轴、工作台与围护尺寸", "设置材料、公差和机加工工艺"] };
    const specifiedDimensions = [...prompt.matchAll(/(\d+(?:\.\d+)?)\s*(?:m|米)/g)].map((match) => `${match[1]} m`);
    plan.parameters = [`目标工艺：${plan.kind === "robot" ? "装配 / 搬运" : plan.kind === "conveyor" ? "连续输送" : plan.kind === "manual" ? "壳体概念设计" : "精密机加工"}`, `建议材料：${plan.kind === "manual" ? "不锈钢钣金 / 304" : "焊接钢结构 / Q235"}`, specifiedDimensions.length ? `识别到的尺寸意图：${specifiedDimensions.join("、")}` : "未给出尺寸：先采用原型比例，应用后可按米制参数精调"] ;
    plan.checks = ["确认与地面基准 Y=0 的定位关系", "复核相邻部件的包络干涉候选", plan.kind === "conveyor" ? "补充 IN / OUT 接口高度与方向" : "确认安全空间与维护开口"];
    setAgentPlan(plan);
  };
  const applyAgentPlan = async () => { if (!agentPlan) return; if (agentPlan.kind === "manual") { const generated: SketchStroke[] = [{ id: createLocalId("agent-sketch"), plane: "top", kind: "spline", points: [{ x: .22, y: .35 }, { x: .32, y: .22 }, { x: .68, y: .22 }, { x: .78, y: .35 }, { x: .75, y: .72 }, { x: .62, y: .8 }, { x: .36, y: .8 }, { x: .25, y: .72 }, { x: .22, y: .35 }] }]; setModelMode("sketch"); setSketchPlane("top"); setSketchCamera("iso"); setProjectName("Agent 生成的自定义壳体"); setSketchTool("spline"); setStrokes(generated); strokesRef.current = generated; setSketchDepth(.16); setSketchBevel(.012); } else { await applyPreset(agentPlan.kind); setModelMode("parametric"); return; } setAgentOpen(false); setNotice(`Agent 已应用“${agentPlan.title}”，可继续在工作台细化。`); };
  const updateEngineering = (id: string, key: keyof PartEngineering, value: string | number) => setPartEngineering((current) => ({ ...current, [id]: { ...defaultPartEngineering(), ...current[id], [key]: value } }));
  const duplicateActive = (mode: "copy" | "mirror" | "pattern") => { if (!activePart) return; setModelView("editable"); const amount = mode === "pattern" ? Math.min(40, Math.max(1, Math.floor(patternCount))) : 1; const fresh = Array.from({ length: amount }, (_, index) => { const ordinal = index + 1; const id = createLocalId(`${activePart.id}-${mode}-${ordinal}`); return { ...activePart, id, selected: ordinal === amount, label: `${activePart.label} ${mode === "mirror" ? "镜像" : mode === "pattern" ? `阵列 ${ordinal}` : "副本"}`, x: mode === "mirror" ? -activePart.x : activePart.x + patternSpacing * ordinal, rotationY: mode === "mirror" ? -(activePart.rotationY ?? 0) : activePart.rotationY }; }); setParts((current) => [...current.map((part) => ({ ...part, selected: false })), ...fresh]); setActivePartId(fresh[fresh.length - 1].id); setNotice(mode === "pattern" ? `已沿 X 轴生成 ${amount} 个阵列实例` : mode === "mirror" ? "已生成 XZ 基准面的镜像部件" : "已生成可独立编辑的部件副本"); };
  const handleModelUpload = (file: File | undefined) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".glb")) { setNotice("当前本地预览支持单文件 GLB；GLTF 可先打包为 GLB 后导入。"); return; }
    if (uploadedModel) URL.revokeObjectURL(uploadedModel);
    setUploadedModel(URL.createObjectURL(file)); setUploadedModelName(file.name); setModelMode("parametric"); setModelView("reference"); setNotice(`已将本地模型“${file.name}”作为只读参考外观加载；可切换到可编辑结构继续建模。`);
  };
  const redrawSketch = useCallback((draft: SketchStroke[] = strokesRef.current) => {
    const canvas = sketchCanvas.current;
    if (!canvas) return;
    const bounds = canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const ratio = window.devicePixelRatio || 1;
    const pixelWidth = Math.max(1, Math.floor(bounds.width * ratio));
    const pixelHeight = Math.max(1, Math.floor(bounds.height * ratio));
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) { canvas.width = pixelWidth; canvas.height = pixelHeight; }
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, bounds.width, bounds.height);
    context.strokeStyle = "rgba(32,48,45,.12)"; context.lineWidth = 1;
    for (let step = 0; step <= gridDivisions; step += 1) { const x = (step / gridDivisions) * bounds.width; const y = (step / gridDivisions) * bounds.height; context.beginPath(); context.moveTo(x, 0); context.lineTo(x, bounds.height); context.stroke(); context.beginPath(); context.moveTo(0, y); context.lineTo(bounds.width, y); context.stroke(); }
    const drawStroke = (stroke: SketchStroke, color: string, lineWidth = 2.5) => {
      if (!stroke.points.length) return;
      context.lineCap = "round"; context.lineJoin = "round"; context.lineWidth = lineWidth; context.strokeStyle = stroke.construction ? "#6680a2" : color;
      context.setLineDash(stroke.construction ? [7, 5] : []);
      if (stroke.kind === "point") { context.beginPath(); context.arc(stroke.points[0].x * bounds.width, stroke.points[0].y * bounds.height, Math.max(3, lineWidth * 1.4), 0, Math.PI * 2); context.fillStyle = stroke.construction ? "#6680a2" : color; context.fill(); context.setLineDash([]); return; }
      context.beginPath(); context.moveTo(stroke.points[0].x * bounds.width, stroke.points[0].y * bounds.height);
      stroke.points.slice(1).forEach((point) => context.lineTo(point.x * bounds.width, point.y * bounds.height));
      context.stroke();
      context.setLineDash([]);
    };
    // Direct edit is a temporary projection of the existing part. It is not
    // added to strokes, so it can never generate a duplicate solid in 3D.
    if (directEditOutline) {
      if (directEditOutline.plane === sketchPlane) drawStroke(directEditOutline, "#147f7a", 2.8);
      const liveDirectDraft = directEditDraftRef.current ?? directEditDraft;
      if (liveDirectDraft?.plane === sketchPlane) drawStroke(liveDirectDraft, "#d09a20", 3.2);
      return;
    }
    draft.filter((stroke) => stroke.plane === sketchPlane).forEach((stroke) => drawStroke(stroke, tone));
  }, [directEditDraft, directEditOutline, gridDivisions, sketchPlane, tone]);
  const publishSketchPreview = (immediately = false) => {
    const publish = () => { previewTimer.current = null; setStrokes(strokesRef.current.map((stroke) => ({ ...stroke, points: [...stroke.points] }))); };
    if (immediately) {
      if (previewTimer.current !== null) window.clearTimeout(previewTimer.current);
      publish();
      return;
    }
    if (previewTimer.current === null) previewTimer.current = window.setTimeout(publish, 140);
  };
  const pointFromEvent = (event: PointerEvent<HTMLCanvasElement>): SketchPoint => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)); const y = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
    const divisions = Math.max(2, gridDivisions);
    return snapEnabled ? { x: Math.round(x * divisions) / divisions, y: Math.round(y * divisions) / divisions } : { x, y };
  };
  const pointsForSketchTool = (tool: SketchEntityKind, start: SketchPoint, current: SketchPoint, previous: SketchPoint[] = [start]): SketchPoint[] => {
    if (tool === "rectangle") return [start, { x: current.x, y: start.y }, current, { x: start.x, y: current.y }, start];
    if (tool === "circle") { const radius = Math.max(Math.abs(current.x - start.x), Math.abs(current.y - start.y)); return Array.from({ length: 49 }, (_, index) => { const angle = (index / 48) * Math.PI * 2; return { x: start.x + Math.cos(angle) * radius, y: start.y + Math.sin(angle) * radius }; }); }
    if (tool === "arc") { const radius = Math.max(.001, Math.hypot(current.x - start.x, current.y - start.y)); return Array.from({ length: 25 }, (_, index) => { const angle = (index / 24) * Math.PI; return { x: start.x + Math.cos(angle) * radius, y: start.y - Math.sin(angle) * radius }; }); }
    if (tool === "line" || tool === "construction") return [start, current];
    return [...previous, current];
  };
  const startSketch = (event: PointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget;
    const point = pointFromEvent(event);
    canvas.setPointerCapture(event.pointerId);
    sketching.current = true;
    if (modelMode === "hybrid") {
      if (!activePart || !directEditOutline) { sketching.current = false; setNotice("请先在部件树中单击部件，或在三维视图中右键选择部件后再进行直接修整。"); return; }
      const nextDraft = { id: createLocalId("direct-edit"), plane: sketchPlane, kind: sketchTool, construction: sketchTool === "construction", points: [point] };
      directEditDraftRef.current = nextDraft; redrawSketch();
      return;
    }
    const pocketTarget = nextPocketTargetId ? strokesRef.current.find((stroke) => stroke.id === nextPocketTargetId && isClosedSketchProfile(stroke.kind) && (stroke.feature?.operation ?? "extrude") === "extrude") : undefined;
    const nextStroke: SketchStroke = { id: createLocalId("sketch"), plane: sketchPlane, kind: sketchTool, construction: sketchTool === "construction", feature: isClosedSketchProfile(sketchTool) ? pocketTarget ? { operation: "pocket", depth: pocketTarget.feature?.depth ?? sketchDepth, bevel: 0, enabled: true, targetId: pocketTarget.id } : { operation: "extrude", depth: sketchDepth, bevel: sketchBevel, enabled: true } : undefined, points: [point] };
    setNextPocketTargetId("");
    strokesRef.current = [...strokesRef.current, nextStroke];
    setActiveSketchId(nextStroke.id);
    if (sketchTool === "point") { sketching.current = false; canvas.releasePointerCapture(event.pointerId); redrawSketch(); publishSketchPreview(true); return; }
    redrawSketch();
    publishSketchPreview(true);
  };
  const extendSketch = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!sketching.current) return;
    const point = pointFromEvent(event);
    const directDraft = directEditDraftRef.current;
    if (directDraft) {
      const start = directDraft.points[0]; const previous = directDraft.points[directDraft.points.length - 1];
      if (sketchTool === "spline" && previous && Math.hypot(point.x - previous.x, point.y - previous.y) < 0.002) return;
      const nextPoints = pointsForSketchTool(sketchTool, start, point, directDraft.points);
      const nextDraft = { ...directDraft, points: nextPoints };
      directEditDraftRef.current = nextDraft; redrawSketch();
      return;
    }
    const current = strokesRef.current;
    if (!current.length) return;
    const activeStroke = current[current.length - 1];
    const start = activeStroke.points[0];
    const previous = activeStroke.points[activeStroke.points.length - 1];
    // Ignore sub-pixel jitter. It adds no visible detail but used to create a
    // costly new React state and a new 3D extrusion for every pointer event.
    if (sketchTool === "spline" && previous && Math.hypot(point.x - previous.x, point.y - previous.y) < 0.002) return;
    const nextPoints = pointsForSketchTool(sketchTool, start, point, activeStroke.points);
    const nextStroke = { ...activeStroke, points: nextPoints };
    strokesRef.current = [...current.slice(0, -1), nextStroke];
    // Spline drawing stays responsive by drawing the new segment directly to the
    // canvas. Shape tools redraw their generated outline, which is tiny.
    if (sketchTool === "spline" && previous) {
      const context = sketchCanvas.current?.getContext("2d");
      const bounds = sketchCanvas.current?.getBoundingClientRect();
      if (context && bounds) { context.beginPath(); context.moveTo(previous.x * bounds.width, previous.y * bounds.height); context.lineTo(point.x * bounds.width, point.y * bounds.height); context.stroke(); }
      else redrawSketch();
    } else redrawSketch();
    publishSketchPreview();
  };
  const endSketch = () => {
    if (!sketching.current) return;
    sketching.current = false;
    const directDraft = directEditDraftRef.current;
    if (directDraft) {
      directEditDraftRef.current = null; setDirectEditDraft(null);
      if (directDraft.points.length < 3 || !activePart) { redrawSketch(); setNotice("直接修整已取消：请绘制至少三个点的闭合外形。"); return; }
      const xs = directDraft.points.map((point) => point.x); const ys = directDraft.points.map((point) => point.y);
      const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
      const centerU = ((minX + maxX) / 2 - .5) * 5; const centerV = (.5 - (minY + maxY) / 2) * 5;
      const spanU = Math.max(.001, (maxX - minX) * 5); const spanV = Math.max(.001, (maxY - minY) * 5);
      const partId = activePart.id; const plane = directDraft.plane;
      const position = activePart.locked ? {} : plane === "top" ? { x: centerU, z: centerV } : plane === "front" ? { x: centerU, y: centerV } : { z: -centerU, y: centerV };
      const updatedPart = plane === "top" ? { ...activePart, ...position, width: spanU, depth: spanV } : plane === "front" ? { ...activePart, ...position, width: spanU, height: spanV } : { ...activePart, ...position, depth: spanU, height: spanV };
      setParts((current) => current.map((part) => part.id === partId ? updatedPart : part));
      setDirectEditOutline(outlineFromPart(updatedPart, plane));
      setNotice(`已按 ${plane === "top" ? "XY" : plane === "front" ? "XZ" : "YZ"} 手绘边界更新“${activePart.label}”的参数包络；画布已回显实际生成的轮廓。`);
      return;
    }
    redrawSketch(); publishSketchPreview(true);
  };
  const activeSketch = strokes.find((stroke) => stroke.id === activeSketchId) ?? strokes.at(-1) ?? null;
  const sketchBounds = (stroke: SketchStroke) => {
    const xs = stroke.points.map((point) => point.x); const ys = stroke.points.map((point) => point.y);
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  };
  const sketchDimensionMm = (stroke: SketchStroke, dimension: "width" | "height" | "diameter" | "length" | "radius" | "centerX" | "centerY") => {
    if (stroke.points.length < 1) return 0;
    const bounds = sketchBounds(stroke);
    if (dimension === "width") return (bounds.maxX - bounds.minX) * LEGACY_SKETCH_CANVAS_SPAN_MM;
    if (dimension === "height") return (bounds.maxY - bounds.minY) * LEGACY_SKETCH_CANVAS_SPAN_MM;
    if (dimension === "diameter") return Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) * LEGACY_SKETCH_CANVAS_SPAN_MM;
    if (dimension === "length") return stroke.points.length < 2 ? 0 : Math.hypot(stroke.points[1].x - stroke.points[0].x, stroke.points[1].y - stroke.points[0].y) * LEGACY_SKETCH_CANVAS_SPAN_MM;
    if (dimension === "centerX") return ((bounds.minX + bounds.maxX) / 2 - .5) * LEGACY_SKETCH_CANVAS_SPAN_MM;
    if (dimension === "centerY") return (.5 - (bounds.minY + bounds.maxY) / 2) * LEGACY_SKETCH_CANVAS_SPAN_MM;
    return (bounds.maxX - bounds.minX) * LEGACY_SKETCH_CANVAS_SPAN_MM / 2;
  };
  const solveSketchConstraints = (stroke: SketchStroke): SketchStroke => {
    const constraints = stroke.constraints ?? [];
    if (stroke.points.length < 2 || !["line", "construction"].includes(stroke.kind ?? "spline")) return stroke;
    const points = stroke.points.map((point) => ({ ...point }));
    if (constraints.includes("horizontal")) points[1].y = points[0].y;
    else if (constraints.includes("vertical")) points[1].x = points[0].x;
    return { ...stroke, points };
  };
  const toggleSketchConstraint = (constraint: SketchConstraintKind) => {
    if (!activeSketch) return;
    const current = activeSketch.constraints ?? [];
    const nextConstraints = current.includes(constraint)
      ? current.filter((item) => item !== constraint)
      : [...current.filter((item) => constraint === "horizontal" || constraint === "vertical" ? !["horizontal", "vertical"].includes(item) : true), constraint];
    const solved = solveSketchConstraints({ ...activeSketch, constraints: nextConstraints });
    const nextStrokes = strokesRef.current.map((stroke) => stroke.id === activeSketch.id ? solved : stroke);
    strokesRef.current = nextStrokes; setStrokes(nextStrokes);
    setNotice(`${constraint === "horizontal" ? "水平" : constraint === "vertical" ? "垂直" : "固定"}约束已${current.includes(constraint) ? "移除" : "应用"}`);
  };
  const updateSketchFeature = (changes: Partial<SketchExtrudeFeature>, target = activeSketch) => {
    if (!target || !isClosedSketchProfile(target.kind)) return;
    const operation = changes.operation ?? target.feature?.operation ?? "extrude";
    const targetId = operation === "pocket" ? changes.targetId ?? target.feature?.targetId ?? strokesRef.current.find((stroke) => stroke.id !== target.id && stroke.plane === target.plane && isClosedSketchProfile(stroke.kind) && (stroke.feature?.operation ?? "extrude") === "extrude")?.id : undefined;
    const angle = operation === "revolve" ? Math.max(.1, Math.min(360, changes.angle ?? target.feature?.angle ?? 360)) : undefined;
    const feature: SketchExtrudeFeature = { operation, depth: sketchDepth, bevel: sketchBevel, enabled: true, ...target.feature, ...changes, targetId, angle };
    const nextStrokes = strokesRef.current.map((stroke) => stroke.id === target.id ? { ...stroke, feature } : stroke);
    strokesRef.current = nextStrokes; setStrokes(nextStrokes);
  };
  const startPocketSketch = (target: SketchStroke) => {
    setModelMode("sketch"); setSketchPlane(target.plane); setSketchCamera(target.plane); setSketchTool("circle"); setActiveSketchId(""); setNextPocketTargetId(target.id);
    setNotice(`已进入 ${target.plane === "top" ? "XY" : target.plane === "front" ? "XZ" : "YZ"} 末端面草图；绘制的下一个闭合轮廓将默认贯穿切除所选拉伸。`);
  };
  const updateSketchDimension = (dimension: "width" | "height" | "diameter" | "length" | "radius" | "centerX" | "centerY", valueMm: number) => {
    if (!activeSketch || !Number.isFinite(valueMm) || valueMm <= 0) return;
    if (activeSketch.constraints?.includes("fixed")) { setNotice("该草图实体已固定；请先移除固定约束再修改尺寸"); return; }
    const requested = valueMm / LEGACY_SKETCH_CANVAS_SPAN_MM;
    const current = Math.max(.000001, dimension === "radius" ? sketchDimensionMm(activeSketch, "radius") / LEGACY_SKETCH_CANVAS_SPAN_MM : sketchDimensionMm(activeSketch, dimension) / LEGACY_SKETCH_CANVAS_SPAN_MM);
    const ratio = requested / current;
    const bounds = sketchBounds(activeSketch);
    const centerX = (bounds.minX + bounds.maxX) / 2; const centerY = (bounds.minY + bounds.maxY) / 2;
    const updated = activeSketch.points.map((point, index) => {
      if (dimension === "centerX") return { ...point, x: point.x + (requested - (centerX - .5)) };
      if (dimension === "centerY") return { ...point, y: point.y - (requested - (.5 - centerY)) };
      if (dimension === "width") return { ...point, x: centerX + (point.x - centerX) * ratio };
      if (dimension === "height") return { ...point, y: centerY + (point.y - centerY) * ratio };
      if (dimension === "diameter") return { x: centerX + (point.x - centerX) * ratio, y: centerY + (point.y - centerY) * ratio };
      if (dimension === "length") return index === 0 ? point : { x: activeSketch.points[0].x + (point.x - activeSketch.points[0].x) * ratio, y: activeSketch.points[0].y + (point.y - activeSketch.points[0].y) * ratio };
      const arcCenter = { x: centerX, y: bounds.maxY };
      return { x: arcCenter.x + (point.x - arcCenter.x) * ratio, y: arcCenter.y + (point.y - arcCenter.y) * ratio };
    });
    const nextStrokes = strokesRef.current.map((stroke) => stroke.id === activeSketch.id ? solveSketchConstraints({ ...stroke, points: updated }) : stroke);
    strokesRef.current = nextStrokes; setStrokes(nextStrokes);
  };
  // Keep the visual source consistent with the selected editor mode.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (modelMode !== "parametric" && modelView === "reference") setModelView("editable"); if (modelMode !== "hybrid") { setDirectEditOutline(null); setDirectEditDraft(null); directEditDraftRef.current = null; } }, [modelMode, modelView]);
  // Local storage is an external source and is intentionally hydrated once.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { try { const saved = window.localStorage.getItem("forgemind-design-history"); if (saved) { const records = JSON.parse(saved) as DesignRecord[]; setDesignRecords(Array.isArray(records) ? records.filter((record) => !inferMaintainedResourceId(record.name, record.parts ?? [])) : []); } } catch { /* local history is optional */ } finally { setHistoryReady(true); } }, []);
  useEffect(() => { if (!historyReady) return; try { window.localStorage.setItem("forgemind-design-history", JSON.stringify(designRecords)); } catch { /* local history is optional */ } }, [designRecords, historyReady]);
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const preparePrecisionCopies = async () => {
      const { createHighDetailResourceCadDocument, highDetailResourceIds } = await import("../core/resource/HighDetailResourceCad");
      const pending = [...highDetailResourceIds];
      const prepareNext = () => {
        if (cancelled) return;
        const resourceId = pending.shift();
        if (!resourceId) return;
        try {
          const expectedId = `cad-resource-${resourceId}-precision-v2`;
          const stored = loadCadDocumentHandoff(window.localStorage, { resourceId });
          if (stored?.document.id !== expectedId) {
            const document = createHighDetailResourceCadDocument(resourceId);
            if (document) saveCadDocumentHandoff(window.localStorage, document, { sourceResourceId: resourceId, markLatest: false });
          }
        } catch { /* A failed optional pre-copy must not delay the Resource Hub. */ }
        if (pending.length) timer = window.setTimeout(prepareNext, 60);
      };
      timer = window.setTimeout(prepareNext, 700);
    };
    void preparePrecisionCopies();
    return () => { cancelled = true; if (timer !== undefined) window.clearTimeout(timer); };
  }, []);
  // Project recovery synchronizes the component with browser storage once.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { try { const saved = window.localStorage.getItem("forgemind-active-project"); if (saved) { const snapshot = JSON.parse(saved) as ProjectSnapshot; if (snapshot.format === "forgemind-project" && [1, 2].includes(snapshot.version) && Array.isArray(snapshot.parts) && Array.isArray(snapshot.strokes)) { if (inferMaintainedResourceId(snapshot.name, snapshot.parts)) { window.localStorage.removeItem("forgemind-active-project"); snapshotRef.current = null; } else applyProjectSnapshot(snapshot, "已恢复本机自动保存的项目草稿"); } else snapshotRef.current = null; } else snapshotRef.current = null; } catch { snapshotRef.current = null; } finally { setProjectStorageReady(true); } }, [applyProjectSnapshot]);
  useEffect(() => {
    if (!projectStorageReady) return;
    const next = makeProjectSnapshot(); const previous = snapshotRef.current;
    if (previous && snapshotSignature(previous) === snapshotSignature(next)) return;
    if (autoSaveTimer.current !== null) window.clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = window.setTimeout(() => {
      if (previous) { setUndoStack((items) => [...items, previous].slice(-40)); setRedoStack([]); }
      snapshotRef.current = next;
      try { window.localStorage.setItem("forgemind-active-project", JSON.stringify(next)); setAutoSaveLabel(`本地草稿已保存 ${new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`); } catch { setAutoSaveLabel("本地草稿保存失败"); }
      autoSaveTimer.current = null;
    }, 420);
    return () => { if (autoSaveTimer.current !== null) window.clearTimeout(autoSaveTimer.current); };
  }, [makeProjectSnapshot, projectStorageReady]);
  useEffect(() => { if (screen !== "workbench") return; const handleHistoryShortcut = (event: KeyboardEvent) => { if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z") return; event.preventDefault(); if (event.shiftKey) redoProject(); else undoProject(); }; window.addEventListener("keydown", handleHistoryShortcut); return () => window.removeEventListener("keydown", handleHistoryShortcut); }, [redoProject, screen, undoProject]);
  useEffect(() => { if (screen !== "workbench" || !prototypeMode) return; const handleEscape = (event: KeyboardEvent) => { if (event.key !== "Escape") return; if (agentOpen) { setAgentOpen(false); return; } if (historyOpen) { setHistoryOpen(false); return; } returnToCustomModel(); }; window.addEventListener("keydown", handleEscape); return () => window.removeEventListener("keydown", handleEscape); }, [agentOpen, historyOpen, prototypeMode, returnToCustomModel, screen]);
  useEffect(() => { strokesRef.current = strokes; redrawSketch(strokes); }, [modelMode, redrawSketch, screen, strokes]);
  useEffect(() => () => { if (previewTimer.current !== null) window.clearTimeout(previewTimer.current); }, []);
  const exportPack = () => {
    const currentBounds = resourceBounds(parts);
    const currentModeling: ResourceModeling = { mode: modelMode, modelView, projectName, materialSpec: projectMaterial, widthM: parts.length ? Math.max(currentBounds.width, .001) : width, depthM: parts.length ? Math.max(currentBounds.depth, .001) : depth, heightM: parts.length ? Math.max(currentBounds.height, .001) : height, accent: tone, assetPath: uploadedModel ? "local-glb" : assetPath, localModelName: uploadedModelName || undefined, modelReference: uploadedModel ? { kind: "local-glb", fileName: uploadedModelName || "unnamed.glb", embedded: false } : { kind: "asset-path", uri: assetPath, embedded: false }, parametricParts: parts, engineeringProperties: partEngineering, manualSketch: strokes, sketchDepthM: sketchDepth, sketchBevelM: sketchBevel, snapGrid: snapEnabled ? gridDivisions : false };
    const artifactResources = packResources.map((item) => {
      const template = getResourceModelingTemplate(item.id); const isCurrentResourceModel = parts.some((part) => part.sourceResourceId === item.id);
      return { ...item, modeling: isCurrentResourceModel && item.id === selected.id ? currentModeling : template ? resourceTemplateToModeling(template) : undefined };
    });
    const artifact: ResourcePackArtifact = { format: "forgemind-resource-pack", schema: "https://forgemind.local/schemas/resource-pack/v1", schemaVersion: "1.0.0", version: 4, exportedAt: new Date().toISOString(), compatibility: { minimumImporterVersion: "1.0.0", migrations: [] }, resources: artifactResources };
    const errors = validateResourcePack(artifact);
    if (errors.length) { setNotice(`资源包未导出：${errors[0]}`); return; }
    const url = URL.createObjectURL(new Blob([JSON.stringify(artifact, null, 2)], { type: "application/json" })); const link = document.createElement("a"); link.href = url; link.download = `${selected.code.toLowerCase()}-forgemind-resource-pack.json`; link.click(); URL.revokeObjectURL(url); setNotice(`资源包已通过 v${artifact.schemaVersion} 规范校验并导出`);
  };
  const activePart = parts.find((part) => part.id === activePartId) ?? parts[0];
  const displayedAssetPath = modelView === "reference" ? assetPath : "procedural";
  const activeEngineering = activePart ? (partEngineering[activePart.id] ?? defaultPartEngineering()) : null;
  const selectedResourceKind = selected.kind;
  const selectedResourceHasPorts = Boolean(selected.ports?.length);
  const sketchEntityLabel: Record<SketchEntityKind, string> = { line: "线段", circle: "圆", arc: "圆弧", spline: "样条", rectangle: "矩形", construction: "构造线", point: "点" };
  const sketchDimensionPanel = screen === "workbench" && modelMode !== "parametric" ? <details className="inspector-details sketch-dimensions" open>
    <summary>草图实体与尺寸 <span>{strokes.filter((stroke) => stroke.plane === sketchPlane).length}</span></summary>
    <div className="sketch-toolset"><span>当前平面实体</span><div>{strokes.filter((stroke) => stroke.plane === sketchPlane).map((stroke, index) => <button className={stroke.id === activeSketchId ? "active" : ""} key={stroke.id} onClick={() => setActiveSketchId(stroke.id)}>{sketchEntityLabel[stroke.kind ?? "spline"]} {index + 1}</button>)}</div></div>
    {activeSketch?.plane === sketchPlane ? <div className="sketch-params"><b>{sketchEntityLabel[activeSketch.kind ?? "spline"]}{activeSketch.construction ? " / 参考几何" : ""}</b>{["line", "construction"].includes(activeSketch.kind ?? "spline") && <div className="sketch-toolset constraint-toolset"><span>方向约束</span><div><button className={activeSketch.constraints?.includes("horizontal") ? "active" : ""} onClick={() => toggleSketchConstraint("horizontal")}>水平</button><button className={activeSketch.constraints?.includes("vertical") ? "active" : ""} onClick={() => toggleSketchConstraint("vertical")}>垂直</button></div></div>}<div className="sketch-toolset constraint-toolset"><span>状态约束</span><div><button className={activeSketch.constraints?.includes("fixed") ? "active" : ""} onClick={() => toggleSketchConstraint("fixed")}>固定</button></div></div>{["rectangle", "spline"].includes(activeSketch.kind ?? "spline") ? <><label>宽度 (mm)<input type="number" min="0.1" step="0.1" disabled={activeSketch.constraints?.includes("fixed")} value={Number(sketchDimensionMm(activeSketch, "width").toFixed(2))} onChange={(event) => updateSketchDimension("width", Number(event.target.value))} /></label><label>高度 (mm)<input type="number" min="0.1" step="0.1" disabled={activeSketch.constraints?.includes("fixed")} value={Number(sketchDimensionMm(activeSketch, "height").toFixed(2))} onChange={(event) => updateSketchDimension("height", Number(event.target.value))} /></label></> : activeSketch.kind === "circle" ? <label>直径 (mm)<input type="number" min="0.1" step="0.1" disabled={activeSketch.constraints?.includes("fixed")} value={Number(sketchDimensionMm(activeSketch, "diameter").toFixed(2))} onChange={(event) => updateSketchDimension("diameter", Number(event.target.value))} /></label> : activeSketch.kind === "arc" ? <label>半径 (mm)<input type="number" min="0.1" step="0.1" disabled={activeSketch.constraints?.includes("fixed")} value={Number(sketchDimensionMm(activeSketch, "radius").toFixed(2))} onChange={(event) => updateSketchDimension("radius", Number(event.target.value))} /></label> : ["line", "construction"].includes(activeSketch.kind ?? "spline") ? <label>长度 (mm)<input type="number" min="0.1" step="0.1" disabled={activeSketch.constraints?.includes("fixed")} value={Number(sketchDimensionMm(activeSketch, "length").toFixed(2))} onChange={(event) => updateSketchDimension("length", Number(event.target.value))} /></label> : <small>点实体目前只记录定位坐标。</small>}{isClosedSketchProfile(activeSketch.kind) && <div className="sketch-toolset feature-params"><span>实体特征</span><div><button className={(activeSketch.feature?.enabled ?? true) ? "active" : ""} onClick={() => updateSketchFeature({ enabled: !(activeSketch.feature?.enabled ?? true) })}>{(activeSketch.feature?.enabled ?? true) ? "已启用" : "已抑制"}</button></div><label>厚度 (m)<input type="number" min="0.001" step="any" value={activeSketch.feature?.depth ?? sketchDepth} onChange={(event) => updateSketchFeature({ depth: Math.max(.001, Number(event.target.value)) })} /></label><label>倒角 (m)<input type="number" min="0" step="any" value={activeSketch.feature?.bevel ?? sketchBevel} onChange={(event) => updateSketchFeature({ bevel: Math.max(0, Number(event.target.value))})} /></label></div>}<small>{activeSketch.constraints?.length ? `已应用：${activeSketch.constraints.map((constraint) => constraint === "horizontal" ? "水平" : constraint === "vertical" ? "垂直" : "固定").join("、")}` : "尚未应用几何约束"}</small></div> : <small>绘制或选择一个草图实体后，可在这里输入尺寸。</small>}
  </details> : null;
  const sketchPositionPanel = screen === "workbench" && modelMode !== "parametric" && activeSketch?.plane === sketchPlane ? <details className="inspector-details sketch-position" open>
    <summary>定位尺寸 / POSITION <span>基准点</span></summary>
    <div className="sketch-params">
      <label>中心 X (mm)<input type="number" step="0.1" disabled={activeSketch.constraints?.includes("fixed")} value={Number(sketchDimensionMm(activeSketch, "centerX").toFixed(2))} onChange={(event) => updateSketchDimension("centerX", Number(event.target.value))} /></label>
      <label>中心 Y (mm)<input type="number" step="0.1" disabled={activeSketch.constraints?.includes("fixed")} value={Number(sketchDimensionMm(activeSketch, "centerY").toFixed(2))} onChange={(event) => updateSketchDimension("centerY", Number(event.target.value))} /></label>
    </div>
    <small>以草图原点为 0,0；X 向右为正，Y 向上为正。修改孔位或轮廓位置后，相关拉伸和贯穿切除会自动重建。</small>
  </details> : null;
  const sketchFeatureOperationPanel = screen === "workbench" && modelMode !== "parametric" && activeSketch && isClosedSketchProfile(activeSketch.kind) ? <details className="inspector-details sketch-feature-operation" open>
    <summary>FEATURE OPERATION / 特征操作</summary>
    <div className="sketch-toolset"><span>当前操作</span><div><button className={(activeSketch.feature?.operation ?? "extrude") === "extrude" ? "active" : ""} onClick={() => updateSketchFeature({ operation: "extrude" })}>拉伸</button><button className={(activeSketch.feature?.operation ?? "extrude") === "pocket" ? "active" : ""} onClick={() => updateSketchFeature({ operation: "pocket" })} disabled={!strokes.some((stroke) => stroke.id !== activeSketch.id && stroke.plane === activeSketch.plane && isClosedSketchProfile(stroke.kind) && (stroke.feature?.operation ?? "extrude") === "extrude")}>贯穿切除</button><button className={(activeSketch.feature?.operation ?? "extrude") === "revolve" ? "active" : ""} onClick={() => updateSketchFeature({ operation: "revolve", angle: activeSketch.feature?.angle ?? 360 })} disabled={activeSketch.plane === "top"}>旋转</button></div></div>
    {(activeSketch.feature?.operation ?? "extrude") === "pocket" ? <><label className="project-field">切除目标<select value={activeSketch.feature?.targetId ?? ""} onChange={(event) => updateSketchFeature({ targetId: event.target.value })}>{strokes.filter((stroke) => stroke.id !== activeSketch.id && stroke.plane === activeSketch.plane && isClosedSketchProfile(stroke.kind) && (stroke.feature?.operation ?? "extrude") === "extrude").map((stroke, index) => <option key={stroke.id} value={stroke.id}>Sketch{index + 1} / Extrude</option>)}</select></label><div className="sketch-toolset"><span>孔阵列方式</span><div><button className={(activeSketch.feature?.patternMode ?? "circular") === "circular" ? "active" : ""} onClick={() => updateSketchFeature({ patternMode: "circular" })}>圆周</button><button className={(activeSketch.feature?.patternMode ?? "circular") === "linear" ? "active" : ""} onClick={() => updateSketchFeature({ patternMode: "linear" })}>线性</button></div></div><div className="sketch-params"><label>{(activeSketch.feature?.patternMode ?? "circular") === "linear" ? "线性数量" : "圆周数量"}<input type="number" min="1" max="24" step="1" value={activeSketch.feature?.patternCount ?? 1} onChange={(event) => updateSketchFeature({ patternCount: Math.max(1, Math.min(24, Math.round(Number(event.target.value)))) })} /></label>{(activeSketch.feature?.patternMode ?? "circular") === "linear" ? <label>间距 (m)<input type="number" min="0.001" max="10" step="0.001" value={activeSketch.feature?.patternSpacing ?? .2} onChange={(event) => updateSketchFeature({ patternSpacing: Number(event.target.value) })} /></label> : <label>覆盖角度 (°)<input type="number" min="0.1" max="360" step="0.1" value={activeSketch.feature?.patternAngle ?? 360} onChange={(event) => updateSketchFeature({ patternAngle: Number(event.target.value) })} /></label>}</div></> : (activeSketch.feature?.operation ?? "extrude") === "revolve" ? <label className="project-field">旋转角度 (°)<input type="number" min="0.1" max="360" step="0.1" value={activeSketch.feature?.angle ?? 360} onChange={(event) => updateSketchFeature({ angle: Number(event.target.value) })} /></label> : <small>拉伸特征会根据自身的厚度和倒角生成实体。</small>}
    <small>{(activeSketch.feature?.operation ?? "extrude") === "pocket" ? "切除轮廓可按圆周或草图 X 轴线性复制；阵列结果会同步进入视口和 GLB 导出。" : (activeSketch.feature?.operation ?? "extrude") === "revolve" ? "前视或右视的闭合轮廓会绕竖直 Y 轴旋转生成实体；可设置 0.1° 到 360°。" : "选择“贯穿切除”后，可将当前闭合轮廓作为目标拉伸的孔洞。"}</small>
  </details> : null;
  const manufacturingIssues: ManufacturingIssue[] = (() => {
    const issues: ManufacturingIssue[] = [];
    parts.forEach((part) => {
      const smallest = Math.min(Math.abs(part.width), Math.abs(part.height), Math.abs(part.depth));
      if (smallest < .015) issues.push({ severity: "warning", title: `${part.label} 壁厚候选过小`, detail: `最小特征约 ${(smallest * 1000).toFixed(1)} mm，建议复核工艺能力。` });
      if (part.y - Math.abs(part.height) / 2 < -.01) issues.push({ severity: "error", title: `${part.label} 穿过地面`, detail: "底部低于 Y=0 基准面，请检查定位高度。" });
    });
    for (let left = 0; left < parts.length; left += 1) for (let right = left + 1; right < parts.length; right += 1) {
      const a = parts[left]; const b = parts[right];
      const overlap = Math.abs(a.x - b.x) < (Math.abs(a.width) + Math.abs(b.width)) / 2 && Math.abs(a.y - b.y) < (Math.abs(a.height) + Math.abs(b.height)) / 2 && Math.abs(a.z - b.z) < (Math.abs(a.depth) + Math.abs(b.depth)) / 2;
      if (overlap && issues.filter((issue) => issue.title.includes("干涉候选")).length < 4) issues.push({ severity: "warning", title: "装配干涉候选", detail: `“${a.label}”与“${b.label}”的包络范围相交，请确认是否为设计接触。` });
    }
    if (selectedResourceKind === "设备" && !selectedResourceHasPorts) issues.push({ severity: "warning", title: "未定义物流接口", detail: "设备资源建议定义 IN / OUT 端口及对应高度。" });
    if (!issues.length) issues.push({ severity: "pass", title: "基础制造检查通过", detail: "尺寸、基准面和包络检查未发现明显问题。" });
    return issues;
  })();
  const closedFeatureStrokes = strokes.filter((stroke) => isClosedSketchProfile(stroke.kind));
  const sketchFeatureName = (stroke: SketchStroke) => {
    const index = closedFeatureStrokes.findIndex((candidate) => candidate.id === stroke.id);
    return `Sketch${String(index + 1).padStart(2, "0")}`;
  };
  const featureName = (stroke: SketchStroke) => {
    const operation = stroke.feature?.operation ?? "extrude";
    const index = closedFeatureStrokes.findIndex((candidate) => candidate.id === stroke.id);
    const operationIndex = closedFeatureStrokes.slice(0, index + 1).filter((candidate) => (candidate.feature?.operation ?? "extrude") === operation).length;
    return `${operation === "pocket" ? "Pocket" : operation === "revolve" ? "Revolve" : "Extrude"}${String(operationIndex).padStart(2, "0")}`;
  };
  const featureDependencyText = (stroke: SketchStroke) => {
    if (stroke.feature?.enabled === false) return "已抑制";
    if (stroke.feature?.operation === "pocket") {
      const target = closedFeatureStrokes.find((candidate) => candidate.id === stroke.feature?.targetId);
      const patternSuffix = (stroke.feature?.patternCount ?? 1) > 1 ? ` · ${stroke.feature?.patternMode === "linear" ? "线性" : "圆周"} ×${stroke.feature?.patternCount}` : "";
      return target ? `贯穿 ${featureName(target)}${patternSuffix}` : "未指定切除目标";
    }
    if (stroke.feature?.operation === "revolve") return `绕 Y 轴 · ${(stroke.feature?.angle ?? 360).toFixed(1)}°`;
    return `基于 ${sketchFeatureName(stroke)}`;
  };
  const precisionPanel = screen === "workbench" && (modelMode === "parametric" || modelMode === "hybrid") && activePart && activeEngineering ? <div className="precision-panel" aria-label="参数化精细控制">
    <div className="precision-head"><div><p>PRECISION PARAMETERS</p><strong>{activePart.label}</strong></div><span>{activePart.type.toUpperCase()}</span></div>
    {activePart.sourceResourceCode && <div className="resource-origin"><span>RESOURCE SOURCE</span><b>{activePart.sourceResourceTitle ?? activePart.sourceResourceCode}</b><small>{activePart.sourceResourceCode}</small><button onClick={() => { if (activePart.sourceResourceId) { setSelectedId(activePart.sourceResourceId); setScreen("library"); } }}>返回资源</button></div>}
    {assetPath !== "procedural" && <section className="model-view-switch"><b>模型显示来源</b><div><button className={modelView === "reference" ? "active" : ""} onClick={() => { setModelMode("parametric"); setModelView("reference"); setDirectEditOutline(null); setNotice("已切换到高精度参考外观；该视图只用于比例和细节对照。"); }}>高精度参考</button><button className={modelView === "editable" ? "active" : ""} onClick={() => { setModelView("editable"); setNotice("已切换到可编辑结构；当前修改将进入项目文件和 GLB 导出结果。"); }}>可编辑结构</button></div><small>{modelView === "reference" ? "只读 GLB，不与参数部件叠加。" : "参数部件是实际修改与导出的对象。"}</small></section>}
    <details className="precision-group" open><summary>定位、姿态与尺寸</summary><div className="reference-controls"><label>工作基准面<select value={workPlane} onChange={(event) => setWorkPlane(event.target.value as "XY" | "XZ" | "YZ")}><option value="XY">XY / 顶视</option><option value="XZ">XZ / 前视</option><option value="YZ">YZ / 侧视</option></select></label><label>定位步距 (m)<input type="number" min=".001" step=".001" value={transformStep} onChange={(event) => setTransformStep(Math.max(.001, Number(event.target.value) || .001))} /></label><label className="switch-row"><input type="checkbox" checked={transformSnap} onChange={(event) => setTransformSnap(event.target.checked)} /> 位置吸附</label><label className="switch-row"><input type="checkbox" checked={Boolean(activePart.locked)} onChange={(event) => updatePart(activePart.id, "locked", event.target.checked)} /> 锁定定位</label></div><div className="sketch-toolset transform-toolset"><span>视口操纵器</span><div><button className={transformMode === "translate" ? "active" : ""} onClick={() => setTransformMode("translate")}>移动</button><button className={transformMode === "rotate" ? "active" : ""} onClick={() => setTransformMode("rotate")}>旋转</button></div></div><div className="precision-grid">{(["x", "y", "z", "rotationX", "rotationY", "rotationZ"] as const).map((key) => <label key={key}>{key.startsWith("rotation") ? `R${key.slice(-1)}` : key.toUpperCase()}<input type="number" step="any" disabled={Boolean(activePart.locked) && ["x", "y", "z"].includes(key)} value={activePart[key] ?? 0} onChange={(event) => updatePart(activePart.id, key, Number(event.target.value))} /><small>{key.startsWith("rotation") ? "deg" : "m"}</small></label>)}</div><small>当前基准：{workPlane} · 外形 {activePart.width.toFixed(3)} × {activePart.height.toFixed(3)} × {activePart.depth.toFixed(3)} m</small></details>
    <details className="precision-group"><summary>视口显示</summary><div className="feature-actions"><button onClick={() => togglePartVisibility(activePart.id)}>{activePart.hidden ? "显示选中部件" : "隐藏选中部件"}</button><button onClick={isolateActivePart} disabled={Boolean(activePart.hidden)}>隔离选中部件</button><button onClick={showAllParts}>全部显示</button></div><small>{activePart.hidden ? "该部件已从视口和 GLB 导出中排除。" : "显示状态会随项目保存；隔离可快速检查单个部件。"}</small></details>
    <details className="precision-group"><summary>材料与制造</summary><label>材料牌号<select value={activeEngineering.material} onChange={(event) => updateEngineering(activePart.id, "material", event.target.value)}>{!["碳钢 / Q235", "不锈钢 / 304", "铝合金 / 6061-T6", "铝合金 / 6061", "冷轧钢板 / DC01", "球墨铸铁 / QT500", "PA66-GF30"].includes(activeEngineering.material) && <option>{activeEngineering.material}</option>}<option>碳钢 / Q235</option><option>不锈钢 / 304</option><option>铝合金 / 6061-T6</option><option>铝合金 / 6061</option><option>冷轧钢板 / DC01</option><option>球墨铸铁 / QT500</option><option>PA66-GF30</option></select></label><div className="precision-grid"><label>密度<input type="number" step="any" value={activeEngineering.density} onChange={(event) => updateEngineering(activePart.id, "density", Number(event.target.value))} /><small>kg/m³</small></label><label>公差<input type="number" step="any" value={activeEngineering.tolerance} onChange={(event) => updateEngineering(activePart.id, "tolerance", Number(event.target.value))} /><small>mm</small></label></div><label>制造工艺<select value={activeEngineering.process} onChange={(event) => updateEngineering(activePart.id, "process", event.target.value)}>{!["机加工", "钣金折弯", "焊接装配", "铸造成型", "注塑成型"].includes(activeEngineering.process) && <option>{activeEngineering.process}</option>}<option>机加工</option><option>钣金折弯</option><option>焊接装配</option><option>铸造成型</option><option>注塑成型</option></select></label><label>装配分组<select value={activeEngineering.group} onChange={(event) => updateEngineering(activePart.id, "group", event.target.value)}>{!["结构件", "运动件", "安全围护", "电气与控制"].includes(activeEngineering.group) && <option>{activeEngineering.group}</option>}<option>结构件</option><option>运动件</option><option>安全围护</option><option>电气与控制</option></select></label></details>
    <details className="precision-group"><summary>复制、镜像与阵列</summary><div className="feature-actions"><button onClick={() => duplicateActive("copy")}>复制偏移</button><button onClick={() => duplicateActive("mirror")}>X 镜像</button></div><div className="pattern-row"><label>数量<input type="number" min="1" max="40" value={patternCount} onChange={(event) => setPatternCount(Number(event.target.value))} /></label><label>间距 (m)<input type="number" step="any" value={patternSpacing} onChange={(event) => setPatternSpacing(Number(event.target.value))} /></label><button onClick={() => duplicateActive("pattern")}>线性阵列</button></div></details>
  </div> : null;
  const manufacturingPanel = screen === "workbench" ? <aside className="manufacturing-panel" aria-label="基础制造检查"><div><p>MANUFACTURING CHECK</p><strong>基础可制造性检查</strong></div><span>{manufacturingIssues.filter((issue) => issue.severity !== "pass").length ? `${manufacturingIssues.filter((issue) => issue.severity !== "pass").length} 项待复核` : "通过"}</span><div className="manufacturing-list">{manufacturingIssues.slice(0, 5).map((issue) => <article className={issue.severity} key={`${issue.title}-${issue.detail}`}><b>{issue.severity === "error" ? "!" : issue.severity === "warning" ? "△" : "✓"}</b><p><strong>{issue.title}</strong><small>{issue.detail}</small></p></article>)}</div></aside> : null;
  const hybridTools = screen === "workbench" && modelMode === "hybrid" ? <aside className="hybrid-tools"><p>DIRECT SOLID EDIT</p><strong>手绘直接修整选中部件</strong><span>当前选择：{activePart?.label ?? "未选择"}</span><small>从部件树单击，或在右侧三维预览中右键单击部件。工作台只显示该部件的临时基准面轮廓；重新绘制后，外形会直接回写到实体，不会生成重叠模型。可切换 XY、XZ、YZ 三个视图分别修整宽深、高度与位置。</small></aside> : null;
  const sketchViewportDock = screen === "workbench" && modelMode !== "parametric" ? <aside className="sketch-viewport-dock" aria-label="草图基准面与实体视角"><p>SKETCH / VIEWPORT</p><div><span>草图平面</span>{([ ["top", "俯视 XY"], ["front", "前视 XZ"], ["right", "右视 YZ"] ] as const).map(([plane, label]) => <button className={sketchPlane === plane ? "active" : ""} key={plane} onClick={() => { if (modelMode === "hybrid" && activePart) beginDirectEdit(activePart, plane); else { setSketchPlane(plane); setSketchCamera(plane); } }}>{label}</button>)}</div><div><span>实体视角</span>{([ ["iso", "透视"], ["top", "俯视"], ["front", "前视"], ["right", "右视"] ] as const).map(([view, label]) => <button className={sketchCamera === view ? "active" : ""} key={view} onClick={() => setSketchCamera(view)}>{label}</button>)}</div><small>{modelMode === "hybrid" ? "三视图直接修整同一个实体；黄色为正在重绘的轮廓。" : "草图按当前基准面写入；实体预览可独立切换视角。"}</small></aside> : null;
  const prototypeExit = screen === "workbench" && prototypeMode ? <button className="prototype-exit" onClick={returnToCustomModel}><b>←</b><span>返回我的初始建模<small>ESC 也可退出工业设备原型</small></span></button> : null;
  const agentDrawer = screen === "workbench" && agentOpen ? <aside className="agent-drawer"><div className="drawer-head"><div><p>LOCAL MODELING AGENT</p><strong>建模方案助手</strong></div><button onClick={() => setAgentOpen(false)}>×</button></div><p className="agent-intro">描述你想制作的设备、产品或外形。助手会给出可直接应用到当前前端工作台的首版方案，并标出建模参数与复核项。</p><textarea value={agentQuestion} onChange={(event) => setAgentQuestion(event.target.value)} placeholder="例如：我想设计一套 4.5 m 长、带安全围栏的六轴机器人上下料单元" /><div className="agent-prompts"><button onClick={() => setAgentQuestion("设计一台带自动换刀和排屑装置的数控加工中心")}>加工中心</button><button onClick={() => setAgentQuestion("设计一套机器人上下料单元")}>机器人单元</button><button onClick={() => setAgentQuestion("设计一条带传感器的滚筒输送线")}>输送设备</button><button onClick={() => setAgentQuestion("手绘一个设备壳体外形")}>手绘壳体</button></div><button className="agent-ask" onClick={createAgentPlan}>生成建模方案 →</button>{agentPlan && <div className="agent-plan"><p>建议方案</p><h3>{agentPlan.title}</h3><span>{agentPlan.summary}</span><ol>{agentPlan.steps.map((step) => <li key={step}>{step}</li>)}</ol>{agentPlan.parameters && <><b>参数建议</b><ul>{agentPlan.parameters.map((item) => <li key={item}>{item}</li>)}</ul></>}{agentPlan.checks && <><b>应用后复核</b><ul>{agentPlan.checks.map((item) => <li key={item}>{item}</li>)}</ul></>}<button onClick={applyAgentPlan}>应用这版模型</button></div>}<small className="agent-note">本地规则型 Agent：不会上传你的设计数据；它会基于设备类型、文字尺寸和当前工作台规则生成首版与检查清单。</small></aside> : null;
  const historyDrawer = screen === "workbench" && historyOpen ? <aside className="history-drawer"><div className="drawer-head"><div><p>LOCAL DESIGN HISTORY</p><strong>已保存设计</strong></div><button onClick={() => setHistoryOpen(false)}>×</button></div><button className="save-record" onClick={() => saveDesignRecord()}><b>＋</b> 保存当前设计</button><p className="history-intro">设计记录保存于本机浏览器。点击条目可恢复参数化装配或草图状态。</p><div className="history-list">{designRecords.length ? designRecords.map((record) => <button key={record.id} onClick={() => restoreDesignRecord(record)}><i>{record.mode === "parametric" ? "▣" : "✎"}</i><span><b>{record.name}</b><small>{record.mode === "parametric" ? `${record.parts.length} 个装配部件` : `${record.strokes.length} 条草图轮廓`} · {record.savedAt}</small></span></button>) : <p>尚未保存设计。完成一个阶段后点击“保存当前设计”。</p>}</div></aside> : null;
  const designConsole = screen === "workbench" && workbenchSessionStarted ? <div className="designer-console" aria-label="设备设计工作台">
    <div className="designer-ribbon">
      <div><p>DEVICE DESIGN / CONCEPT → ASSEMBLY → MANUFACTURE</p><strong>{projectName}</strong><small>{autoSaveLabel}</small></div>
      <div className="designer-actions">
        <button onClick={createNewProject}>＋ 新建</button>
        <button onClick={undoProject} disabled={!undoStack.length}>↶ 撤销</button>
        <button onClick={redoProject} disabled={!redoStack.length}>↷ 重做</button>
        <button onClick={() => { setAgentOpen(true); setHistoryOpen(false); }}>✦ Agent</button>
        <button onClick={() => { setHistoryOpen(true); setAgentOpen(false); }}>▤ 历史 {designRecords.length}</button>
        <button onClick={exportProject}>导出</button>
        <button className="more-action" onClick={() => projectImportInput.current?.click()}>导入</button>
        <input ref={projectImportInput} className="visually-hidden" type="file" accept=".json,.forgemind-project.json" onChange={(event) => { importProject(event.target.files?.[0]); event.currentTarget.value = ""; }} />
        <button className="more-action" onClick={() => setScreen("library")}>资源目录</button>
        <button onClick={() => { addSelected(); setNotice("当前设备定义已写入待导入资源包"); }}>保存资源</button>
      </div>
    </div>
    <div className="designer-workspace">
      <aside className="assembly-browser">
        <p className="panel-kicker">ASSEMBLY / 部件树</p>
        <label className="project-field">设备名称<input value={projectName} onChange={(event) => setProjectName(event.target.value)} /></label>
        <label className="project-field">结构材料<select value={projectMaterial} onChange={(event) => setProjectMaterial(event.target.value)}><option>焊接钢结构 / Q235</option><option>不锈钢钣金 / 304</option><option>铝型材与铸铝 / 6061</option><option>铝合金 / 6061</option><option>冷轧钢板 / DC01</option><option>工程塑料与复材</option></select></label>
        <div className="preset-stack"><span>工业设备原型</span>{Object.entries(modelPresets).map(([key, preset]) => <button key={key} onClick={() => applyPreset(key)}><b>{preset.label}</b><small>{preset.description}</small></button>)}</div>
        <div className="tree-head"><span>装配部件 / {parts.length}</span><div><button onClick={() => addPart("box")}>+ 结构</button><button onClick={() => addPart("cylinder")}>+ 传动</button><button className="tree-delete" onClick={removeActivePart} disabled={!activePart}>删除选中</button></div></div>
        <div className="assembly-tree">{parts.map((part, index) => <button className={part.id === activePart?.id ? "selected" : ""} key={part.id} onClick={() => modelMode === "hybrid" ? selectPartAndSyncSketch(part) : selectPart(part.id)}><i>{index < 4 ? "▣" : index < 8 ? "◉" : "◇"}</i><span>{part.label}<small>{part.type.toUpperCase()} · {part.width.toFixed(2)} m{part.sourceResourceCode ? ` · ${part.sourceResourceCode}` : ""}</small></span></button>)}</div>
        <details className="inspector-details feature-history" open>
          <summary>FEATURE HISTORY / 特征树 <span>{closedFeatureStrokes.length}</span></summary>
          <div className="assembly-tree">
            {closedFeatureStrokes.map((stroke) => <div key={stroke.id}>
              <button className={stroke.id === activeSketchId ? "selected" : ""} onClick={() => { setModelMode("sketch"); setSketchPlane(stroke.plane); setSketchCamera(stroke.plane); setActiveSketchId(stroke.id); }}><i>⌁</i><span>{sketchFeatureName(stroke)}<small>{sketchEntityLabel[stroke.kind ?? "spline"]} · {stroke.plane.toUpperCase()}</small></span></button>
              <button className={stroke.feature?.enabled === false ? "" : "selected"} onClick={() => { setModelMode("sketch"); setSketchPlane(stroke.plane); setSketchCamera(stroke.plane); setActiveSketchId(stroke.id); updateSketchFeature({ enabled: !(stroke.feature?.enabled ?? true) }, stroke); }}><i>↳</i><span>{featureName(stroke)}<small>{stroke.feature?.enabled === false ? "已抑制" : `${featureDependencyText(stroke)} · ${(stroke.feature?.depth ?? sketchDepth).toFixed(3)} m`}</small></span></button>
              {(stroke.feature?.operation ?? "extrude") === "extrude" && stroke.feature?.enabled !== false && <button className="feature-child-action" onClick={() => startPocketSketch(stroke)}>＋ 顶面切除草图</button>}
            </div>)}
          </div>
        </details>
        {modelMode === "hybrid" && <small className="tree-sync-note">点击部件会选中并同步其顶视外形到草图。</small>}
      </aside>
    <main className="designer-stage"><div className="cad-toolbar"><span>坐标系：{modelMode === "parametric" ? workPlane : sketchPlane === "top" ? "XY" : sketchPlane === "front" ? "XZ" : "YZ"} / m</span><span>左键拖拽旋转 · 单击选择 · 中键旋转 · 右键平移 · 滚轮缩放</span><span>{modelView === "reference" ? "高精度参考 / 只读" : modelMode === "parametric" ? `${parts.length} 个可编辑部件` : `草图基准：${sketchPlane === "top" ? "俯视" : sketchPlane === "front" ? "前视" : "右视"}`}</span>{modelMode === "parametric" && <div className="viewport-navigation" aria-label="视图导航"><b>视图</b>{([ ["iso", "透视"], ["top", "顶"], ["front", "前"], ["right", "右"] ] as const).map(([view, label]) => <button key={view} className={parametricCamera === view ? "active" : ""} onClick={() => { setParametricCamera(view); setParametricCameraReset((value) => value + 1); }}>{label}</button>)}<button onClick={() => setParametricCameraReset((value) => value + 1)}>适合窗口</button></div>}</div>{modelMode === "parametric" ? <ThreeWorkbench mode="parametric" parts={parts} assetPath={displayedAssetPath} uploadedModel={modelView === "reference" ? uploadedModel : null} sketch={strokes} sketchDepth={sketchDepth} sketchBevel={sketchBevel} accent={tone} cameraView={parametricCamera} cameraResetToken={parametricCameraReset} transformMode={transformMode} onPartSelect={(part) => selectPart(part.id)} onPartTransform={commitViewportTransform} onModelStatus={setModelLoadStatus} /> : <div className="manual-cad"><div className="sketch-plane"><canvas ref={sketchCanvas} className="sketch-canvas" onPointerDown={startSketch} onPointerMove={extendSketch} onPointerUp={endSketch} onPointerCancel={endSketch} aria-label="带网格与吸附的草图画布" /><div className="plane-label">{sketchPlane === "top" ? "XY / 俯视草图" : sketchPlane === "front" ? "XZ / 前视草图" : "YZ / 右视草图"}</div></div><div className="solid-preview"><ThreeWorkbench mode="sketch" parts={parts} assetPath="procedural" uploadedModel={null} sketch={strokes} sketchDepth={sketchDepth} sketchBevel={sketchBevel} accent={tone} cameraView={sketchCamera} onPartContextSelect={modelMode === "hybrid" ? selectPartAndSyncSketch : undefined} /><div className="preview-label">{sketchCamera === "iso" ? "透视" : sketchCamera === "top" ? "俯视" : sketchCamera === "front" ? "前视" : "右视"}实体 / {modelMode === "hybrid" ? `${parts.length} 个可编辑部件` : `${strokes.length} 个轮廓`}</div></div></div>}<div className="stage-readout" data-model-load-status={modelLoadStatus}><b>{projectMaterial}</b><span>{modelView === "reference" ? "当前显示原项目高精度 GLB，仅用于外观和比例对照；参数编辑与导出结构不在此视图中进行。" : modelMode === "parametric" ? "当前显示可编辑参数结构；尺寸、位置与材料修改会同步到导出结果。" : modelMode === "hybrid" ? "当前对参数部件进行三视图包络修整；不会生成与部件重叠的新实体。" : "独立草图会作为单独实体保存并导出。"}</span></div></main>
      <aside className="designer-inspector">
        <div className="inspector-heading">
          <div><p className="panel-kicker">LEGACY / 兼容操作</p><strong>{modelMode === "parametric" ? "旧参数部件" : modelMode === "hybrid" ? "旧融合精修" : "旧手绘草图"}</strong></div>
          <small>{activePart ? activePart.label : "未选部件"}</small>
        </div>
        <div className="designer-mode designer-mode-three" role="tablist" aria-label="建模方法切换">
          <button className={modelMode === "parametric" ? "active" : ""} onClick={() => setModelMode("parametric")}><b>01</b> 参数</button>
          <button className={modelMode === "hybrid" ? "active" : ""} onClick={enterHybridEditing}><b>02</b> 融合</button>
          <button className={modelMode === "sketch" ? "active" : ""} onClick={() => setModelMode("sketch")}><b>03</b> 草图</button>
        </div>

        {modelMode === "parametric" && <section className="inspector-block reference-block">
          <label className="project-field">外观参考模型<select value={assetPath} onChange={(event) => { setAssetPath(event.target.value); setUploadedModel(null); setUploadedModelName(""); }}>{modelAssets.map((asset) => <option key={asset.path} value={asset.path}>{asset.label}</option>)}</select></label>
          <label className="model-upload">导入参考 GLB<input type="file" accept=".glb,model/gltf-binary" onChange={(event) => handleModelUpload(event.target.files?.[0])} /><span>{uploadedModelName || "仅作比例与细节对照"}</span></label>
        </section>}

        {hybridTools}
        {sketchViewportDock}
        {precisionPanel}

        {modelMode !== "parametric" && <section className="inspector-block sketch-controls">
          <div className="sketch-toolset"><span>草图实体</span><div>{([ ["line", "线段"], ["circle", "圆"], ["arc", "圆弧"], ["spline", "样条"], ["rectangle", "矩形"], ["construction", "构造线"], ["point", "点"] ] as const).map(([tool, label]) => <button className={sketchTool === tool ? "active" : ""} key={tool} onClick={() => setSketchTool(tool)}>{label}</button>)}</div></div>
          <div className="compact-control-row"><label className="switch-row"><input type="checkbox" checked={snapEnabled} onChange={(event) => setSnapEnabled(event.target.checked)} /> 网格吸附</label><label className="project-field">网格<input type="number" min="2" step="1" value={gridDivisions} onChange={(event) => setGridDivisions(Math.max(2, Number(event.target.value) || 2))} /></label></div>
          <details className="inspector-details"><summary>实体化参数</summary><div className="sketch-params"><label>厚度 (m)<input type="number" min="0.001" step="any" value={sketchDepth} onChange={(event) => setSketchDepth(Math.max(.001, Number(event.target.value)))} /></label><label>倒角 (m)<input type="number" min="0" step="any" value={sketchBevel} onChange={(event) => setSketchBevel(Math.max(0, Number(event.target.value)))} /></label></div></details>
          <small className="tree-sync-note">线段、圆弧、构造线和点是草图参考实体；只有闭合的矩形、圆和样条轮廓会生成实体。</small>
          <div className="sketch-actions"><button onClick={() => setStrokes((current) => current.slice(0, -1))} disabled={!strokes.length}>撤销草图实体</button><button onClick={() => setStrokes([])} disabled={!strokes.length}>清空草图</button></div>
        </section>}
        {sketchDimensionPanel}
        {sketchPositionPanel}
        {sketchFeatureOperationPanel}

        {activePart && <details className="inspector-details part-appearance">
          <summary>部件名称与外观</summary>
          <label className="project-field">部件名称<input value={activePart.label} onChange={(event) => updatePart(activePart.id, "label", event.target.value)} /></label>
          <label className="project-field">表面颜色<input className="color-input" type="color" value={activePart.color} onChange={(event) => updatePart(activePart.id, "color", event.target.value)} /></label>
          <button className="danger" onClick={removeActivePart}>移除选中部件</button>
        </details>}

        <details className="inspector-details manufacturing-review">
          <summary>制造检查 <span>{manufacturingIssues.filter((issue) => issue.severity !== "pass").length || "✓"}</span></summary>
          {manufacturingPanel}
        </details>
        <label className="project-field global-coating">全局涂装<input className="color-input" type="color" value={tone} onChange={(event) => setTone(event.target.value)} /></label>
      </aside>
    </div>
  </div> : null;
  const workbenchWelcome = screen === "workbench" && !workbenchSessionStarted ? <section className="workbench-welcome">
    <aside className="welcome-rail"><div className="welcome-mark">FM</div><div><strong>ForgeMind</strong><small>LEGACY PROJECT COMPATIBILITY</small></div><nav aria-label="欢迎页导航"><button className="active">项目</button><button onClick={() => setScreen("library")}>资源库</button><button onClick={openProfessionalCad}>自由建模</button><button onClick={openAssemblyWorkbench}>装配</button><button onClick={() => setScreen("contract")}>导入规范</button></nav><small className="welcome-version">LOCAL CAD / v0.1</small></aside>
    <div className="welcome-main"><div className="welcome-copy"><p>FORGEMIND / START</p><h1>开始一个新的<br />工业设计项目。</h1><span>从空白参数化模型、资源库模板，或已有的 ForgeMind 项目文件开始。</span></div><div className="welcome-actions"><button className="welcome-action primary" onClick={createNewProfessionalCad}><b>＋</b><span>新建自由建模项目<small>统一 Sketch / Feature / B-Rep Part Studio</small></span></button><button className="welcome-action" onClick={openComprehensiveDemoProject}><b>◈</b><span>加载全功能精细建模演示<small>参数化实体 / 光顺曲面 / 机械细节 / 装配</small></span></button><button className="welcome-action" onClick={() => setScreen("library")}><b>▤</b><span>从资源库开始<small>设备 / 产品 / 材料直接建模</small></span></button><button className="welcome-action" onClick={openAssemblyWorkbench}><b>⌘</b><span>装配工作台<small>Mate Connector / DOF / 实时求解</small></span></button><button className="welcome-action" onClick={() => projectImportInput.current?.click()}><b>▰</b><span>打开项目<small>导入 .forgemind-project.json</small></span></button><button className="welcome-action" onClick={continueRecentProject}><b>↻</b><span>继续最近项目<small>{projectStorageReady ? projectName : "读取本机草稿…"}</small></span></button><input ref={projectImportInput} className="visually-hidden" type="file" accept=".json,.forgemind-project.json" onChange={(event) => { importProject(event.target.files?.[0]); event.currentTarget.value = ""; }} /></div>{designRecords.length > 0 && <div className="welcome-recent"><div><p>RECENT DESIGNS</p><strong>最近保存的设计</strong></div>{designRecords.slice(0, 3).map((record) => <button key={record.id} onClick={() => openSavedDesignRecord(record)}><i>⌁</i><span><b>{record.name}</b><small>{record.mode === "parametric" ? `${record.parts.length} 个部件` : `${record.strokes.length} 条草图`} · {record.savedAt}</small></span><em>→</em></button>)}</div>}</div>
  </section> : null;
  return <main className="app-shell">
    <header className="topbar"><button className="brand brand-button" onClick={() => setScreen("overview")} aria-label="ForgeMind Resource Hub 首页"><span>FM</span><div><strong>FORGEMIND</strong><small>RESOURCE HUB / v0.1</small></div></button><nav aria-label="主导航"><button className={screen === "library" ? "active" : ""} onClick={() => setScreen("library")}>资源库</button><button onClick={openProfessionalCad}>自由建模</button><button onClick={openAssemblyWorkbench}>装配</button><button className={screen === "contract" ? "active" : ""} onClick={() => setScreen("contract")}>导入规范</button></nav><div className="topbar-actions"><button className="forgemind-return" type="button" onClick={() => window.location.assign(`${window.location.protocol}//${window.location.hostname}:5173/`)}>← 返回 ForgeMind</button><div className="top-status"><i /> LOCAL DESIGN MODE</div></div></header>
    <section className={`screen hero ${screen === "overview" ? "screen-active" : ""}`}><div className="hero-copy"><p className="eyebrow">FORGE ASSET NETWORK / 01</p><h1>把设备、材料与产品<br /><em>装配成你的工厂语言。</em></h1><p className="lead">面向 ForgeMind 的工业资源中枢。资源可直接作为可编辑模型插入工作台，也可继续调整尺寸、材料和工艺属性并导出交换资源包。</p><div className="hero-actions"><button onClick={() => setScreen("library")} className="button primary">浏览资源库 <b>→</b></button><button onClick={createNewProfessionalCad} className="button ghost">自由建模</button></div></div><div className="hero-schematic" aria-label="工厂资源链路示意图"><div className="schematic-grid" /><span className="schematic-label label-a">MATERIAL</span><span className="schematic-label label-b">PROCESS</span><span className="schematic-label label-c">PRODUCT</span><div className="schematic-node material">◇</div><div className="schematic-line line-a" /><div className="schematic-node machine">▣</div><div className="schematic-line line-b" /><div className="schematic-node product">◎</div><div className="schematic-readout"><span>READY TO BUILD</span><strong>{String(resources.length).padStart(2, "0")}</strong><small>CURATED ASSETS</small></div></div></section>
    <section className={`screen library section ${screen === "library" ? "screen-active" : ""}`}>
      <div className="section-heading">
        <div><p className="eyebrow">01 / RESOURCE LIBRARY</p><h2>资源库</h2></div>
        <p>资源可进入自由 B-Rep Part Studio 做精确建模，也可在设备工作台中查看工厂项目的精细模型、快速新建部件并继续编辑。</p>
      </div>
      <div className="library-tools">
        <div className="filter-tabs" role="tablist" aria-label="资源类别">{kinds.map((value) => <button className={kind === value ? "chosen" : ""} key={value} onClick={() => setKind(value)}>{value}</button>)}</div>
        <label className="search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索设备、材料、工艺…" /></label>
      </div>
      <div className="resource-layout">
        <div className="resource-grid">{visible.map((item) => <article className={`resource-card ${selected.id === item.id ? "selected" : ""}`} key={item.id}>
          <button type="button" className="resource-card-select" aria-label={`查看 ${item.title}`} aria-pressed={selected.id === item.id} onClick={() => { setSelectedId(item.id); setTone(item.color); }} />
          <div className="card-visual" style={{ "--asset-color": item.color } as CSSProperties}><span>{item.icon}</span><i /><b>{item.kind}</b></div>
          <div className="card-copy"><div><p>{item.code}</p><h3>{item.title}</h3></div><button onClick={(event) => { event.stopPropagation(); togglePack(item.id); }}>{pack.includes(item.id) ? "已加入" : "+ 加入"}</button></div>
          <p className="card-description">{item.description}</p>
          <div className="tags">{item.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
          <div className="resource-model-actions">
            <button onClick={(event) => { event.stopPropagation(); openResourceInProfessionalCad(item.id); }}>自由建模 <b>→</b></button>
            {item.id === COMPREHENSIVE_DEMO_RESOURCE_ID && <button className="secondary" onClick={(event) => { event.stopPropagation(); openAssemblyWorkbench(); }}>装配演示 <b>⌘</b></button>}
            {getResourceModelingTemplate(item.id)?.assetPath && <button className="secondary" onClick={(event) => { event.stopPropagation(); openResourceInWorkbench(item.id); }}>精细模型展示 <b>◈</b></button>}
            {item.kind === "材料" && <button className="secondary" onClick={(event) => { event.stopPropagation(); openResourceInProfessionalCad(item.id); }}>作为毛坯打开 <b>◈</b></button>}
          </div>
        </article>)}</div>
        <aside className="import-dock">
          <div className="dock-head"><p>MODELING QUEUE</p><strong>{String(pack.length).padStart(2, "0")}</strong></div>
          <p className="dock-description">{notice}</p>
          <div className="queue-list">{packResources.length ? packResources.map((item) => <div key={item.id}><span style={{ color: item.color }}>{item.icon}</span><p><b>{item.title}</b><small>{item.code}</small></p><button onClick={() => togglePack(item.id)} aria-label={`移除 ${item.title}`}>×</button></div>) : <p className="empty">从资源卡加入待建模资源。</p>}</div>
          <button className="resource-apply-button" disabled={!pack.length} onClick={() => openResourcePackInFreeModeling(pack)}>从清单自由建模 <b>→</b></button>
          <button className="export-button resource-export-button" disabled={!pack.length} onClick={exportPack}>导出资源包 <b>↓</b></button>
          <button className="resource-pack-import" onClick={() => resourcePackImportInput.current?.click()}>从资源包恢复资源 <b>↥</b></button>
          <input ref={resourcePackImportInput} className="visually-hidden" type="file" accept=".json" onChange={(event) => { importResourcePackForModeling(event.target.files?.[0]); event.currentTarget.value = ""; }} />
          <small className="dock-note">可选择精确 B-Rep 建模，或进入设备工作台查看精细模型并快速新建、编辑与保存项目。</small>
        </aside>
      </div>
    </section>
    <section className={`screen contract section ${screen === "contract" ? "screen-active" : ""}`}><div className="contract-copy"><p className="eyebrow">03 / FORGEMIND CONTRACT</p><h2>资源不是孤立模型，<br />而是可直接实例化的工厂定义。</h2><p>资源既能作为 JSON 交换定义，也能直接生成工作台中的可编辑部件。设备保留模型与接口语义，材料可创建毛坯或应用到部件，产品可作为可复用零件继续编辑。</p></div><div className="contract-list"><div><span>01</span><p><b>设备定义</b><small>角色、尺寸、端口、模型引用</small></p></div><div><span>02</span><p><b>物料定义</b><small>类别、规格、外观、属性</small></p></div><div><span>03</span><p><b>工艺定义</b><small>输入、输出、时长、能力标签</small></p></div><div><span>04</span><p><b>建模定义</b><small>可编辑部件、工程属性、资源来源与工作台实例化</small></p></div></div></section>
    <footer><button className="brand brand-button" onClick={() => setScreen("overview")}><span>FM</span><div><strong>FORGEMIND</strong><small>RESOURCE HUB</small></div></button><p>DESIGNED FOR DIGITAL FACTORY BUILDERS</p><button className="footer-home" onClick={() => setScreen("overview")}>返回总览 ↑</button></footer>{workbenchWelcome}{designConsole}{prototypeExit}{agentDrawer}{historyDrawer}
  </main>;
}
