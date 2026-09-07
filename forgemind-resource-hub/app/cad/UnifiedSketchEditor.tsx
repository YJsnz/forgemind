"use client";

import { useMemo, useState, type MouseEvent } from "react";
import type { Sketch } from "../../core/sketch/Sketch";
import type { SketchConstraint, SketchConstraintType, SketchPointRef } from "../../core/sketch/SketchConstraint";
import type { SketchDimension } from "../../core/sketch/SketchDimension";
import type { SketchEntity } from "../../core/sketch/SketchEntity";
import { extendLineToEntity } from "../../core/sketch/operations/Extend";
import { offsetLineChain, offsetSketchEntity } from "../../core/sketch/operations/Offset";
import type { SketchOperationResult } from "../../core/sketch/operations/SketchOperationTypes";
import { trimSketchEntity } from "../../core/sketch/operations/Trim";
import { solveSketch } from "../../core/sketch/solver/SketchSolver";
import { closestNurbsCurvePoint2D, evaluateNurbsCurve2D, nurbsCurveEndpoints2D, sampleNurbsCurve2D } from "../../core/curve/NurbsCurve";

type Tool = "select" | "line" | "rectangle" | "circle" | "arc" | "point" | "bspline";
type Pt = { x: number; y: number };
type Pending = { tool: Exclude<Tool, "select">; points: Pt[] } | undefined;
type ProjectSelectedEdge = (sketch: Sketch) => Promise<Extract<SketchEntity, { type: "external-line" | "external-circle" | "external-arc" | "external-bspline" }>>;

const clone = <T,>(value: T): T => structuredClone(value);
const uid = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const grid = 5;
const snapDistance = 5;
const view = { x: -150, y: -100, w: 300, h: 200 };
const constraintLabels: Record<SketchConstraintType, string> = { horizontal: "水平", vertical: "垂直", fixed: "固定", coincident: "重合", parallel: "平行", perpendicular: "垂直相交", tangent: "相切", concentric: "同心", equal: "相等", midpoint: "中点", symmetric: "对称" };

type SemanticPoint = { point: Pt; entityId: string; role: SketchPointRef["role"]; parameter?: number };
const semanticPoints = (sketch: Sketch): SemanticPoint[] => Object.values(sketch.entities).flatMap((entity): SemanticPoint[] => {
  if (entity.type === "line" || entity.type === "external-line") return [{ point: entity.start, entityId: entity.id, role: "start" as const }, { point: entity.end, entityId: entity.id, role: "end" as const }];
  if (entity.type === "circle" || entity.type === "arc" || entity.type === "external-circle") return [{ point: entity.center, entityId: entity.id, role: "center" as const }];
  if (entity.type === "external-arc") { const start={x:entity.center.x+Math.cos(entity.startAngle)*entity.radius,y:entity.center.y+Math.sin(entity.startAngle)*entity.radius},end={x:entity.center.x+Math.cos(entity.endAngle)*entity.radius,y:entity.center.y+Math.sin(entity.endAngle)*entity.radius};return [{point:start,entityId:entity.id,role:"start" as const},{point:end,entityId:entity.id,role:"end" as const},{point:entity.center,entityId:entity.id,role:"center" as const}]; }
  if (entity.type === "external-bspline") {
    const { start, end } = nurbsCurveEndpoints2D(entity);
    return entity.periodic && Math.hypot(start.x - end.x, start.y - end.y) <= 1e-8
      ? [{ point: start, entityId: entity.id, role: "start" as const }]
      : [{ point: start, entityId: entity.id, role: "start" as const }, { point: end, entityId: entity.id, role: "end" as const }];
  }
  if (entity.type === "point") return [{ point: entity.position, entityId: entity.id, role: "position" as const }];
  if (entity.type === "bspline" && !entity.closed && entity.fitPoints.length) return [{ point: entity.fitPoints[0], entityId: entity.id, role: "start" as const }, { point: entity.fitPoints.at(-1)!, entityId: entity.id, role: "end" as const }];
  return [];
});
const nearestNurbsReference = (sketch: Sketch, point: Pt): SemanticPoint | undefined => {
  let best: SemanticPoint | undefined; let bestDistance = Infinity;
  for (const entity of Object.values(sketch.entities)) {
    if (entity.type !== "external-bspline") continue;
    const closest = closestNurbsCurvePoint2D(entity, point, 32);
    if (closest.distance < bestDistance) { bestDistance = closest.distance; best = { point: closest.point, entityId: entity.id, role: "curve", parameter: closest.parameter }; }
  }
  return best;
};
const referenceAtPoint = (sketch: Sketch, point: Pt): SemanticPoint | undefined => semanticPoints(sketch).find((entry) => Math.hypot(entry.point.x - point.x, entry.point.y - point.y) <= 1e-6) ?? (() => { const curve=nearestNurbsReference(sketch,point);return curve&&Math.hypot(curve.point.x-point.x,curve.point.y-point.y)<=1e-5?curve:undefined; })();
const isLine = (entity: SketchEntity | undefined): entity is Extract<SketchEntity, { type: "line" }> => entity?.type === "line";
const isLineReference = (entity: SketchEntity | undefined): entity is Extract<SketchEntity, { type: "line" | "external-line" }> => entity?.type === "line" || entity?.type === "external-line";
const isCurve = (entity: SketchEntity | undefined): entity is Extract<SketchEntity, { type: "circle" | "arc" | "external-circle" | "external-arc" }> => entity?.type === "circle" || entity?.type === "arc" || entity?.type === "external-circle" || entity?.type === "external-arc";
const isExternal = (entity: SketchEntity | undefined) => entity?.type === "external-line" || entity?.type === "external-circle" || entity?.type === "external-arc" || entity?.type === "external-bspline";

const nearestSnap = (sketch: Sketch, input: Pt): { point: Pt; kind: "endpoint" | "curve" | "grid" | "free"; reference?: SemanticPoint } => {
  let best: SemanticPoint | undefined; let bestD = Infinity;
  for (const candidate of semanticPoints(sketch)) {
    const d = Math.hypot(candidate.point.x - input.x, candidate.point.y - input.y);
    if (d < bestD) { best = candidate; bestD = d; }
  }
  if (best && bestD <= snapDistance) return { point: { ...best.point }, kind: "endpoint", reference: best };
  const curve = nearestNurbsReference(sketch, input);
  if (curve && Math.hypot(curve.point.x - input.x, curve.point.y - input.y) <= snapDistance) return { point: { ...curve.point }, kind: "curve", reference: curve };
  const snapped = { x: Math.round(input.x / grid) * grid, y: Math.round(input.y / grid) * grid };
  if (Math.hypot(snapped.x - input.x, snapped.y - input.y) <= snapDistance) return { point: snapped, kind: "grid" };
  return { point: input, kind: "free" };
};

const addConstraint = (sketch: Sketch, constraint: SketchConstraint) => { sketch.constraints[constraint.id] = constraint; };
const addAutoLineConstraints = (sketch: Sketch, entityId: string, a: Pt, b: Pt) => {
  const dx = Math.abs(b.x - a.x), dy = Math.abs(b.y - a.y);
  if (dy <= 1.5 && dx > 1.5) addConstraint(sketch, { id: uid("horizontal"), type: "horizontal", entityIds: [entityId], enabled: true });
  else if (dx <= 1.5 && dy > 1.5) addConstraint(sketch, { id: uid("vertical"), type: "vertical", entityIds: [entityId], enabled: true });
};

const translatedEntity = (entity: SketchEntity, id: string, dx: number, dy: number): SketchEntity | undefined => {
  const move = (point: Pt) => ({ x: point.x + dx, y: point.y + dy });
  if (isExternal(entity)) return undefined;
  if (entity.type === "line") return { ...entity, id, start: move(entity.start), end: move(entity.end) };
  if (entity.type === "circle") return { ...entity, id, center: move(entity.center) };
  if (entity.type === "arc") return { ...entity, id, center: move(entity.center) };
  if (entity.type === "point") return { ...entity, id, position: move(entity.position) };
  if (entity.type === "bspline") return { ...entity, id, fitPoints: entity.fitPoints.map(move) };
  return { ...entity, id, controlPoints: entity.controlPoints.map(move) };
};

const mirroredEntity = (entity: SketchEntity, id: string, axis: "X" | "Y"): SketchEntity | undefined => {
  if (isExternal(entity)) return undefined;
  const mirror = (point: Pt) => axis === "X" ? { x: point.x, y: -point.y } : { x: -point.x, y: point.y };
  if (entity.type === "line") return { ...entity, id, start: mirror(entity.start), end: mirror(entity.end) };
  if (entity.type === "circle") return { ...entity, id, center: mirror(entity.center) };
  if (entity.type === "point") return { ...entity, id, position: mirror(entity.position) };
  if (entity.type === "spline") return { ...entity, id, controlPoints: entity.controlPoints.map(mirror) };
  if (entity.type === "bspline") { const mirrorVector=(value:Pt|undefined)=>value?axis==="X"?{x:value.x,y:-value.y}:{x:-value.x,y:value.y}:undefined; return { ...entity, id, fitPoints: entity.fitPoints.map(mirror), startTangent: mirrorVector(entity.startTangent), endTangent: mirrorVector(entity.endTangent) }; }
  const start = mirror({ x: entity.center.x + Math.cos(entity.startAngle) * entity.radius, y: entity.center.y + Math.sin(entity.startAngle) * entity.radius });
  const end = mirror({ x: entity.center.x + Math.cos(entity.endAngle) * entity.radius, y: entity.center.y + Math.sin(entity.endAngle) * entity.radius });
  const center = mirror(entity.center);
  return { ...entity, id, center, startAngle: Math.atan2(end.y - center.y, end.x - center.x), endAngle: Math.atan2(start.y - center.y, start.x - center.x) };
};

const bsplineDisplayPath = (points: Pt[], closed = false): string => {
  if (!points.length) return "";
  if (points.length === 1) return `M ${points[0].x} ${-points[0].y}`;
  let path=`M ${points[0].x} ${-points[0].y}`;
  const count=closed?points.length:points.length-1;
  for(let index=0;index<count;index+=1){const before=closed?points[(index-1+points.length)%points.length]:points[Math.max(0,index-1)],start=points[index],end=points[(index+1)%points.length],after=closed?points[(index+2)%points.length]:points[Math.min(points.length-1,index+2)];const c1={x:start.x+(end.x-before.x)/6,y:start.y+(end.y-before.y)/6},c2={x:end.x-(after.x-start.x)/6,y:end.y-(after.y-start.y)/6};path+=` C ${c1.x} ${-c1.y} ${c2.x} ${-c2.y} ${end.x} ${-end.y}`;}
  return closed?`${path} Z`:path;
};

const createEditableNurbsBasis = (pointCount: number, periodic: boolean, preferredDegree = 3) => {
  const degree = Math.max(1, Math.min(preferredDegree, pointCount - 1));
  if (periodic) return {
    degree, periodic: true,
    knots: Array.from({ length: pointCount + 1 }, (_, index) => index),
    multiplicities: Array.from({ length: pointCount + 1 }, () => 1),
    weights: Array.from({ length: pointCount }, () => 1),
    firstParameter: 0, lastParameter: pointCount,
  };
  const spans = pointCount - degree;
  return {
    degree, periodic: false,
    knots: Array.from({ length: spans + 1 }, (_, index) => index),
    multiplicities: Array.from({ length: spans + 1 }, (_, index) => index === 0 || index === spans ? degree + 1 : 1),
    weights: Array.from({ length: pointCount }, () => 1),
    firstParameter: 0, lastParameter: spans,
  };
};

export function UnifiedSketchEditor({ sketch: source, onAccept, onCancel, onProjectSelectedEdge }: { sketch: Sketch; onAccept: (sketch: Sketch) => void | Promise<void>; onCancel: () => void; onProjectSelectedEdge?: ProjectSelectedEdge }) {
  const [draft, setDraft] = useState<Sketch>(() => clone(source));
  const [tool, setTool] = useState<Tool>("select");
  const [construction, setConstruction] = useState(false);
  const [pending, setPending] = useState<Pending>();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedPoints, setSelectedPoints] = useState<SketchPointRef[]>([]);
  const [cursor, setCursor] = useState<Pt>({ x: 0, y: 0 });
  const [offsetDistance, setOffsetDistance] = useState(5);
  const [patternCount, setPatternCount] = useState(3);
  const [patternSpacing, setPatternSpacing] = useState(20);
  const [message, setMessage] = useState("选择几何；按住 Shift 可多选。所有修改都会先经过约束求解，再提交到特征历史。");
  const solve = useMemo(() => solveSketch(draft), [draft]);
  const display = useMemo<Sketch>(() => ({ ...draft, entities: solve.status === "conflicting" || solve.status === "failed" ? draft.entities : solve.entities }), [draft, solve]);
  const externalNurbsPaths = useMemo(() => new Map(display.entityOrder.flatMap((id) => {
    const entity = display.entities[id];
    if (entity?.type !== "external-bspline") return [];
    const points = sampleNurbsCurve2D(entity, { chordTolerance: view.w / 2400, minSegments: 6, maxSegments: 384 });
    return [[id, points.map((point, index) => `${index ? "L" : "M"} ${point.x} ${-point.y}`).join(" ")] as const];
  })), [display]);
  const editableNurbsPaths = useMemo(() => new Map(display.entityOrder.flatMap((id) => {
    const entity = display.entities[id];
    if (entity?.type !== "bspline" || !entity.nurbs) return [];
    try {
      const points = sampleNurbsCurve2D({ ...entity.nurbs, rational: entity.nurbs.weights.some((weight) => Math.abs(weight - 1) > 1e-12), controlPoints: entity.fitPoints }, { chordTolerance: view.w / 2400, minSegments: 8, maxSegments: 384 });
      return [[id, points.map((point, index) => `${index ? "L" : "M"} ${point.x} ${-point.y}`).join(" ")] as const];
    } catch { return []; }
  })), [display]);
  const selectedCurveMarkers = useMemo(() => selectedPoints.flatMap((reference) => {
    const entity=display.entities[reference.entityId];
    return entity?.type==="external-bspline"&&reference.role==="curve"&&Number.isFinite(reference.parameter)?[{...reference,point:evaluateNurbsCurve2D(entity,reference.parameter!)}]:[];
  }), [display, selectedPoints]);
  const selectedId = selectedIds[0] ?? "";

  const svgPoint = (event: MouseEvent<SVGSVGElement>): Pt => { const rect = event.currentTarget.getBoundingClientRect(); return { x: view.x + (event.clientX - rect.left) / rect.width * view.w, y: -(view.y + (event.clientY - rect.top) / rect.height * view.h) }; };
  const snapped = (event: MouseEvent<SVGSVGElement>) => nearestSnap(draft, svgPoint(event));
  const clearSelection = () => { setSelectedIds([]); setSelectedPoints([]); };
  const selectEntity = (id: string, additive: boolean) => { setTool("select"); setPending(undefined); setSelectedPoints([]); setSelectedIds((current) => additive ? current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id] : [id]); };
  const togglePoint = (reference: SketchPointRef, additive: boolean) => { setTool("select"); setPending(undefined); setSelectedIds((current) => additive ? current : []); setSelectedPoints((current) => { const same=(entry:SketchPointRef)=>entry.entityId===reference.entityId&&entry.role===reference.role&&(entry.role!=="curve"||Math.abs((entry.parameter??0)-(reference.parameter??0))<=1e-12);const exists = current.some(same); if (additive) return exists ? current.filter((entry) => !same(entry)) : [...current, reference]; return [reference]; }); };
  const commitEntity = (entity: SketchEntity, constraints: SketchConstraint[] = []) => setDraft((current) => { const next = clone(current); next.entities[entity.id] = entity; next.entityOrder.push(entity.id); constraints.forEach((entry) => { next.constraints[entry.id] = entry; }); return next; });
  const applyOperation = (result: SketchOperationResult, description: string) => { setDraft((current) => { const next = clone(current); next.entities = result.entities; next.entityOrder = result.entityOrder; result.orphanConstraintIds.forEach((id) => delete next.constraints[id]); result.orphanDimensionIds.forEach((id) => delete next.dimensions[id]); return next; }); setSelectedIds(result.createdEntityIds.length ? result.createdEntityIds : selectedIds.filter((id) => !!result.entities[id])); setSelectedPoints([]); setMessage(description); };
  const runOperation = (operation: () => SketchOperationResult, description: string) => { try { applyOperation(operation(), description); } catch (error) { setMessage(`无法完成：${error instanceof Error ? error.message : String(error)}`); } };

  const handleCanvasClick = (event: MouseEvent<SVGSVGElement>) => {
    if (tool === "select") { if (!event.shiftKey) clearSelection(); setPending(undefined); return; }
    const hit = snapped(event); const p = hit.point;
    if (tool === "point") { const id = uid("point"); const constraints=hit.reference?[{id:uid("coincident"),type:"coincident" as const,entityIds:[id,hit.reference.entityId],pointRefs:[{entityId:id,role:"position" as const},{entityId:hit.reference.entityId,role:hit.reference.role,parameter:hit.reference.parameter}],enabled:true}]:[];commitEntity({ id, type: "point", position: p, construction },constraints); setSelectedIds([id]); return; }
    if (!pending || pending.tool !== tool) { setPending({ tool, points: [p] } as Pending); return; }
    const points = [...pending.points, p];
    if (tool === "line" && points.length === 2) { const id = uid("line"); const [a,b] = points; const next = clone(draft); const startRef = referenceAtPoint(draft,a); const endRef = referenceAtPoint(draft,b); const entity: SketchEntity = { id, type: "line", start: a, end: b, construction }; next.entities[id] = entity; next.entityOrder.push(id); addAutoLineConstraints(next,id,a,b); if(startRef) addConstraint(next,{id:uid("coincident"),type:"coincident",entityIds:[id,startRef.entityId],pointRefs:[{entityId:id,role:"start"},{entityId:startRef.entityId,role:startRef.role,parameter:startRef.parameter}],enabled:true}); if(endRef) addConstraint(next,{id:uid("coincident"),type:"coincident",entityIds:[id,endRef.entityId],pointRefs:[{entityId:id,role:"end"},{entityId:endRef.entityId,role:endRef.role,parameter:endRef.parameter}],enabled:true}); setDraft(next); setSelectedIds([id]); setPending({ tool, points: [b] }); return; }
    if (tool === "rectangle" && points.length === 2) { const [a,b] = points; const ids = [uid("line"),uid("line"),uid("line"),uid("line")]; const corners=[a,{x:b.x,y:a.y},b,{x:a.x,y:b.y}]; setDraft((current)=>{const next=clone(current); ids.forEach((id,i)=>{next.entities[id]={id,type:"line",start:corners[i],end:corners[(i+1)%4],construction};next.entityOrder.push(id);addAutoLineConstraints(next,id,corners[i],corners[(i+1)%4]);}); for(let i=0;i<4;i++) addConstraint(next,{id:uid("coincident"),type:"coincident",entityIds:[ids[i],ids[(i+1)%4]],pointRefs:[{entityId:ids[i],role:"end"},{entityId:ids[(i+1)%4],role:"start"}],enabled:true}); return next;}); setSelectedIds(ids); setPending(undefined); setTool("select"); return; }
    if (tool === "circle" && points.length === 2) { const [center, edge] = points; const radius=Math.hypot(edge.x-center.x,edge.y-center.y); if(radius>.01){const id=uid("circle"); const ref=referenceAtPoint(draft,center); const constraints=ref?[{id:uid("coincident"),type:"coincident" as const,entityIds:[id,ref.entityId],pointRefs:[{entityId:id,role:"center" as const},{entityId:ref.entityId,role:ref.role}],enabled:true}]:[];commitEntity({id,type:"circle",center,radius,construction},constraints);setSelectedIds([id]);} setPending(undefined); return; }
    if (tool === "arc" && points.length === 3) { const [center,start,end]=points; const radius=Math.hypot(start.x-center.x,start.y-center.y); if(radius>.01){const id=uid("arc");commitEntity({id,type:"arc",center,radius,startAngle:Math.atan2(start.y-center.y,start.x-center.x),endAngle:Math.atan2(end.y-center.y,end.x-center.x),construction});setSelectedIds([id]);} setPending(undefined); return; }
    setPending({ tool, points } as Pending);
  };

  const deleteSelected = () => { if(!selectedIds.length) return; const ids = new Set(selectedIds); setDraft((current)=>{const next=clone(current); ids.forEach((id) => delete next.entities[id]); next.entityOrder=next.entityOrder.filter((id)=>!ids.has(id)); for(const [id,constraint] of Object.entries(next.constraints)) if(constraint.entityIds.some((entityId) => ids.has(entityId))) delete next.constraints[id]; for(const [id,dimension] of Object.entries(next.dimensions)) if(dimension.entityIds.some((entityId) => ids.has(entityId))) delete next.dimensions[id]; return next;}); clearSelection(); setMessage(`已删除 ${ids.size} 个草图对象及其关联约束。`); };
  const addDimension = () => { const first=draft.entities[selectedIds[0]], second=draft.entities[selectedIds[1]]; let dimension: SketchDimension | undefined; if(selectedIds.length===1&&first?.type==="line") dimension={id:uid("dim"),name:"线段长度",type:"distance",entityIds:[first.id],pointRefs:[{entityId:first.id,role:"start"},{entityId:first.id,role:"end"}],value:Math.hypot(first.end.x-first.start.x,first.end.y-first.start.y),driving:true}; else if(selectedIds.length===1&&(first?.type==="circle"||first?.type==="arc")) dimension={id:uid("dim"),name:first.type==="circle"?"圆直径":"圆弧半径",type:first.type==="circle"?"diameter":"radius",entityIds:[first.id],value:first.radius*(first.type==="circle"?2:1),driving:true}; else if(selectedIds.length===2&&isLine(first)&&isLine(second)){const a={x:first.end.x-first.start.x,y:first.end.y-first.start.y},b={x:second.end.x-second.start.x,y:second.end.y-second.start.y};dimension={id:uid("angle"),name:"夹角",type:"angle",entityIds:[first.id,second.id],value:Math.atan2(a.x*b.y-a.y*b.x,a.x*b.x+a.y*b.y)*180/Math.PI,driving:true};} if(dimension){setDraft((current)=>({...current,dimensions:{...current.dimensions,[dimension!.id]:dimension!}}));setMessage(`已添加${dimension.name}驱动尺寸。`);} };
  const updateDimension = (id:string,value:number) => { if(!Number.isFinite(value)||value<=0)return; setDraft((current)=>({...current,dimensions:{...current.dimensions,[id]:{...current.dimensions[id],value}}})); };
  const toggleConstruction = () => { if(!selectedIds.length){setConstruction((value)=>!value);return;} setDraft((current)=>{const next=clone(current); selectedIds.forEach((id) => { const entity=next.entities[id]; if(entity&&!isExternal(entity)) next.entities[id]={...entity,construction:!entity.construction} as SketchEntity; }); return next;}); };

  const canAddConstraint = (type: SketchConstraintType) => { const first = draft.entities[selectedIds[0]], second = draft.entities[selectedIds[1]]; if (type === "fixed") return selectedIds.length === 1 && !!first && !isExternal(first) && first.type !== "spline"; if (["horizontal", "vertical"].includes(type)) return selectedIds.length === 1 && isLine(first); if (["parallel", "perpendicular"].includes(type)) return selectedIds.length === 2 && isLineReference(first) && isLineReference(second) && (isLine(first)||isLine(second)); if (type === "equal") return selectedIds.length === 2 && ((isLineReference(first) && isLineReference(second) && (isLine(first)||isLine(second))) || (isCurve(first) && isCurve(second))); if (type === "concentric") return selectedIds.length === 2 && isCurve(first) && isCurve(second); if (type === "tangent") { const spline=first?.type==="bspline"?first:second?.type==="bspline"?second:undefined; if(spline){const selectedEndpoint=selectedPoints.find((point)=>point.entityId===spline.id);return !spline.closed&&selectedIds.length===2&&(isLineReference(first)||isLineReference(second))&&(!selectedEndpoint||selectedEndpoint.role==="start"||selectedEndpoint.role==="end");} const externalNurbs=first?.type==="external-bspline"?first:second?.type==="external-bspline"?second:undefined;if(externalNurbs)return selectedIds.length===2&&(isLine(first)||isLine(second));return selectedIds.length === 2 && ((isLineReference(first) && isCurve(second)) || (isLineReference(second) && isCurve(first))); } if (type === "coincident") return selectedPoints.length === 2; if (type === "midpoint") return selectedPoints.length === 1 && draft.entities[selectedPoints[0].entityId]?.type === "point" && selectedIds.length === 1 && isLine(first); return false; };
  const applyConstraint = (type: SketchConstraintType) => {
    if (!canAddConstraint(type)) return;
    const splineTangent=type==="tangent"&&selectedIds.some((id)=>draft.entities[id]?.type==="bspline");
    const externalNurbsTangent=type==="tangent"&&selectedIds.find((id)=>draft.entities[id]?.type==="external-bspline");
    let effectivePoints=selectedPoints;
    if(splineTangent){
      const spline=draft.entities[selectedIds.find((id)=>draft.entities[id]?.type==="bspline")!] as Extract<SketchEntity,{type:"bspline"}>,line=draft.entities[selectedIds.find((id)=>isLineReference(draft.entities[id]))!] as Extract<SketchEntity,{type:"line"|"external-line"}>;
      const explicit=selectedPoints.find((point)=>point.entityId===spline.id&&(point.role==="start"||point.role==="end"));
      if(explicit)effectivePoints=[explicit];else{const start=spline.fitPoints[0],end=spline.fitPoints.at(-1)!;const endpointDistance=(point:Pt)=>Math.min(Math.hypot(point.x-line.start.x,point.y-line.start.y),Math.hypot(point.x-line.end.x,point.y-line.end.y));effectivePoints=[{entityId:spline.id,role:endpointDistance(start)<=endpointDistance(end)?"start":"end"}];}
    } else if(externalNurbsTangent){
      const entity=draft.entities[externalNurbsTangent];
      if(entity?.type==="external-bspline"){const closest=closestNurbsCurvePoint2D(entity,cursor);effectivePoints=[{entityId:entity.id,role:"curve",parameter:closest.parameter}];}
    }
    const pointEntityIds = effectivePoints.map((entry) => entry.entityId); const entityIds = type === "coincident" ? pointEntityIds : type === "midpoint" ? [...selectedIds, ...pointEntityIds] : [...selectedIds];
    const constraint: SketchConstraint = { id: uid(type), type, entityIds, pointRefs: type === "coincident" || type === "midpoint" || splineTangent || !!externalNurbsTangent ? effectivePoints : undefined, enabled: true };
    setDraft((current) => { const next=clone(current); if(splineTangent){const splineId=selectedIds.find((id)=>next.entities[id]?.type==="bspline")!;const entity=next.entities[splineId];if(entity?.type==="bspline"&&!entity.startTangent&&!entity.endTangent){const first=entity.fitPoints[0],second=entity.fitPoints[1],previous=entity.fitPoints.at(-2),last=entity.fitPoints.at(-1);entity.startTangent={x:second.x-first.x,y:second.y-first.y};entity.endTangent={x:last.x-previous.x,y:last.y-previous.y};}} next.constraints[constraint.id]=constraint; return next; });
    setSelectedPoints(effectivePoints);
    setMessage(externalNurbsTangent?"已在光标对应的精确 NURBS 参数位置添加相切约束。":splineTangent?`已自动选择 B-Spline ${effectivePoints[0].role==="start"?"起点":"终点"}并添加 B-Spline 端点方向相切约束；需要接触时再添加重合约束。`:`已添加“${constraintLabels[type]}”约束。`);
  };
  const removeConstraint = (id: string) => setDraft((current) => { const next = clone(current); delete next.constraints[id]; return next; });
  const mirrorSelection = (axis: "X" | "Y") => { const created: string[] = []; setDraft((current) => { const next = clone(current); selectedIds.forEach((sourceId) => { const sourceEntity = current.entities[sourceId]; if (!sourceEntity) return; const id = uid(`${sourceId}-mirror`); const entity = mirroredEntity(sourceEntity, id, axis); if (entity) { next.entities[id] = entity; next.entityOrder.push(id); created.push(id); } }); return next; }); setSelectedIds(created); setMessage(`已将 ${created.length} 个对象关于 ${axis} 轴镜像。`); };
  const patternSelection = () => { const count = Math.max(2, Math.round(patternCount)); const created: string[] = []; setDraft((current) => { const next = clone(current); for (let copyIndex = 1; copyIndex < count; copyIndex += 1) selectedIds.forEach((sourceId) => { const sourceEntity=current.entities[sourceId]; if(!sourceEntity)return; const id=uid(`${sourceId}-array-${copyIndex}`); const entity=translatedEntity(sourceEntity,id,patternSpacing*copyIndex,0); if(entity){next.entities[id]=entity;next.entityOrder.push(id);created.push(id);} }); return next; }); setSelectedIds(created); setMessage(`已沿 X 方向建立 ${count} 组草图阵列，间距 ${patternSpacing} 毫米。`); };
  const projectSelectedEdge = async () => { if (!onProjectSelectedEdge) { setMessage("当前草图没有可用的模型边上下文；请先在建模视图选择一条边，再打开草图编辑。 "); return; } try { const entity=await onProjectSelectedEdge(draft); commitEntity(entity); setSelectedIds([entity.id]); const label=entity.type==="external-line"?"直线":entity.type==="external-circle"?"圆":entity.type==="external-arc"?"圆弧":"NURBS 曲线";setMessage(`已投影选中的 B-Rep ${label}；外部几何保留精确曲线数据和拓扑关联。`); } catch(error){setMessage(`投影失败：${error instanceof Error?error.message:String(error)}`);} };

  const finishBSpline = (closed=false) => { const points=pending?.tool==="bspline"?pending.points:[]; if(points.length<3){setMessage("B-Spline 至少需要 3 个拟合点；请继续单击添加点。");return;} const id=uid("bspline");commitEntity({id,type:"bspline",fitPoints:points,closed,construction});setSelectedIds([id]);setPending(undefined);setTool("select");setMessage(closed?`已直接创建通过 ${points.length} 个拟合点的周期封闭 B-Spline，可用于实体轮廓。`:`已创建通过 ${points.length} 个拟合点的开放 B-Spline，可用于扫掠路径。`); };
  const selectedBSpline = draft.entities[selectedId]?.type === "bspline" ? draft.entities[selectedId] as Extract<SketchEntity,{type:"bspline"}> : undefined;
  const updateBSplinePoint = (index:number,axis:"x"|"y",value:number) => { if(!selectedBSpline||!Number.isFinite(value))return;setDraft((current)=>{const next=clone(current),entity=next.entities[selectedBSpline.id];if(entity?.type!=="bspline"||!entity.fitPoints[index])return current;entity.fitPoints[index][axis]=value;return next;}); };
  const setBSplineTangentsEnabled = (enabled:boolean) => { if(!selectedBSpline)return;setDraft((current)=>{const next=clone(current),entity=next.entities[selectedBSpline.id];if(entity?.type!=="bspline")return current;if(enabled){const first=entity.fitPoints[0],second=entity.fitPoints[1],beforeLast=entity.fitPoints.at(-2),last=entity.fitPoints.at(-1);if(first&&second&&beforeLast&&last){entity.startTangent={x:second.x-first.x,y:second.y-first.y};entity.endTangent={x:last.x-beforeLast.x,y:last.y-beforeLast.y};}}else{entity.startTangent=undefined;entity.endTangent=undefined;}return next;}); };
  const updateBSplineTangent = (end:"start"|"end",axis:"x"|"y",value:number) => { if(!selectedBSpline||!Number.isFinite(value))return;setDraft((current)=>{const next=clone(current),entity=next.entities[selectedBSpline.id];if(entity?.type!=="bspline")return current;const key=end==="start"?"startTangent":"endTangent";entity[key]={...(entity[key]??{x:1,y:0}),[axis]:value};return next;}); };
  const setBSplineClosed = (closed:boolean) => { if(!selectedBSpline)return;setDraft((current)=>{const next=clone(current),entity=next.entities[selectedBSpline.id];if(entity?.type!=="bspline")return current;entity.closed=closed;if(entity.nurbs)entity.nurbs=createEditableNurbsBasis(entity.fitPoints.length,closed,entity.nurbs.degree);if(closed){entity.startTangent=undefined;entity.endTangent=undefined;for(const [id,constraint] of Object.entries(next.constraints))if(constraint.type==="tangent"&&constraint.entityIds.includes(entity.id))delete next.constraints[id];}return next;});setSelectedPoints([]);setMessage(closed?"已封闭为周期 B-Spline，可直接用于拉伸、旋转或放样轮廓。":"已改为开放 B-Spline，可用于曲面扫掠路径。 "); };
  const setExactNurbsEnabled = (enabled:boolean) => { if(!selectedBSpline)return;setDraft((current)=>{const next=clone(current),entity=next.entities[selectedBSpline.id];if(entity?.type!=="bspline")return current;if(enabled){entity.nurbs=createEditableNurbsBasis(entity.fitPoints.length,entity.closed);entity.startTangent=undefined;entity.endTangent=undefined;}else entity.nurbs=undefined;return next;});setMessage(enabled?"已启用精确 NURBS：控制点、次数、节点和权重会保存到特征历史并直接进入 OCCT。":"已切回插值 B-Spline。 "); };
  const updateNurbsDegree = (degree:number) => { if(!selectedBSpline?.nurbs||!Number.isFinite(degree))return;setDraft((current)=>{const next=clone(current),entity=next.entities[selectedBSpline.id];if(entity?.type!=="bspline"||!entity.nurbs)return current;const basis=createEditableNurbsBasis(entity.fitPoints.length,entity.closed,Math.round(degree));basis.weights=[...entity.nurbs.weights];entity.nurbs=basis;return next;}); };
  const updateNurbsWeight = (index:number,weight:number) => { if(!selectedBSpline?.nurbs||!Number.isFinite(weight)||weight<=0)return;setDraft((current)=>{const next=clone(current),entity=next.entities[selectedBSpline.id];if(entity?.type!=="bspline"||!entity.nurbs)return current;entity.nurbs.weights[index]=weight;return next;}); };
  const appendBSplinePoint = () => { if(!selectedBSpline)return;setDraft((current)=>{const next=clone(current),entity=next.entities[selectedBSpline.id];if(entity?.type==="bspline"){const degree=entity.nurbs?.degree;entity.fitPoints.push({...cursor});if(entity.nurbs)entity.nurbs=createEditableNurbsBasis(entity.fitPoints.length,entity.closed,degree);}return next;}); };
  const removeLastBSplinePoint = () => { if(!selectedBSpline||selectedBSpline.fitPoints.length<=3)return;setDraft((current)=>{const next=clone(current),entity=next.entities[selectedBSpline.id];if(entity?.type==="bspline"&&entity.fitPoints.length>3){const degree=entity.nurbs?.degree;entity.fitPoints.pop();if(entity.nurbs)entity.nurbs=createEditableNurbsBasis(entity.fitPoints.length,entity.closed,degree);}return next;}); };

  const statusLabel = solve.status === "fully-constrained" ? "完全约束" : solve.status === "under-constrained" ? "尚有自由度" : solve.status === "conflicting" ? "约束冲突" : "求解失败";
  const selectedPointKeys = new Set(selectedPoints.map((entry) => `${entry.entityId}:${entry.role}`));
  return <div data-testid="unified-sketch-editor" style={{position:"absolute",inset:0,zIndex:20,background:"#08111dcc",backdropFilter:"blur(3px)",display:"grid",gridTemplateRows:"auto 1fr 38px"}}>
    <div style={{display:"flex",alignItems:"center",flexWrap:"wrap",gap:6,padding:"7px 10px",borderBottom:"1px solid #32465d",background:"#0e1928"}}><strong style={{color:"#f0c45b",marginRight:8}}>草图 · {draft.name}</strong>{([["select","选择"],["line","线段"],["rectangle","矩形"],["circle","圆"],["arc","圆弧"],["point","点"],["bspline","B-Spline"]] as [Tool,string][]).map(([id,label])=><button key={id} onClick={()=>{setTool(id);setPending(undefined);}} style={{background:tool===id?"#1d6fa8":undefined}}>{label}</button>)}{tool==="bspline"?<><button onClick={()=>finishBSpline(false)} disabled={pending?.tool!=="bspline"||pending.points.length<3} style={{background:"#277d52"}}>完成开放曲线（{pending?.tool==="bspline"?pending.points.length:0} 点）</button><button onClick={()=>finishBSpline(true)} disabled={pending?.tool!=="bspline"||pending.points.length<3} style={{background:"#6b5722"}}>闭合并完成</button></>:null}<span style={{width:1,height:22,background:"#33465c"}}/><button onClick={toggleConstruction} style={{background:construction?"#765820":undefined}}>构造线</button><button onClick={addDimension} disabled={!selectedIds.length}>添加尺寸</button><button onClick={deleteSelected} disabled={!selectedIds.length}>删除</button><span style={{flex:1}}/><span style={{fontSize:12,color:solve.status==="fully-constrained"?"#8ee8ac":solve.status==="under-constrained"?"#f5cf76":"#ff9292"}}>{statusLabel} · 自由度 {solve.degreesOfFreedom}</span><button onClick={()=>void onAccept({...draft,entities:solve.status==="conflicting"||solve.status==="failed"?draft.entities:solve.entities})} disabled={solve.status==="conflicting"||solve.status==="failed"} style={{background:"#277d52"}}>✓ 完成草图</button><button onClick={onCancel}>× 取消</button></div>
    <div style={{display:"grid",gridTemplateColumns:"1fr 300px",minHeight:0}}><svg viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`} onClick={handleCanvasClick} onMouseMove={(event)=>setCursor(nearestSnap(draft,svgPoint(event)).point)} style={{width:"100%",height:"100%",background:"#08121f",cursor:tool==="select"?"default":"crosshair"}}>
      {Array.from({length:61},(_,i)=>(i-30)*grid).map((x)=><line key={`gx${x}`} x1={x} x2={x} y1={-100} y2={100} stroke={x===0?"#52657a":"#1b2a3a"} strokeWidth={x===0?0.7:0.25}/>)}{Array.from({length:41},(_,i)=>(i-20)*grid).map((y)=><line key={`gy${y}`} x1={-150} x2={150} y1={y} y2={y} stroke={y===0?"#52657a":"#1b2a3a"} strokeWidth={y===0?0.7:0.25}/>) }
      {display.entityOrder.map((id)=>{const entity=display.entities[id];const stroke=selectedIds.includes(id)?"#facc15":isExternal(entity)?"#9b6bd6":entity.construction?"#7c8da0":"#67e8f9";const click=(event:MouseEvent<SVGElement>)=>{event.stopPropagation();selectEntity(id,event.shiftKey)};if(entity.type==="line"||entity.type==="external-line")return <line key={id} x1={entity.start.x} y1={-entity.start.y} x2={entity.end.x} y2={-entity.end.y} stroke={stroke} strokeWidth="1.5" strokeDasharray={entity.construction?"4 3":undefined} onClick={click}/>;if(entity.type==="circle"||entity.type==="external-circle")return <circle key={id} cx={entity.center.x} cy={-entity.center.y} r={entity.radius} fill="none" stroke={stroke} strokeWidth="1.5" strokeDasharray={entity.construction?"4 3":undefined} onClick={click}/>;if(entity.type==="arc"||entity.type==="external-arc"){const start={x:entity.center.x+Math.cos(entity.startAngle)*entity.radius,y:entity.center.y+Math.sin(entity.startAngle)*entity.radius};const end={x:entity.center.x+Math.cos(entity.endAngle)*entity.radius,y:entity.center.y+Math.sin(entity.endAngle)*entity.radius};const large=Math.abs(entity.endAngle-entity.startAngle)>Math.PI?1:0;const sweep=entity.type==="external-arc"&&entity.clockwise?1:0;return <path key={id} d={`M ${start.x} ${-start.y} A ${entity.radius} ${entity.radius} 0 ${large} ${sweep} ${end.x} ${-end.y}`} fill="none" stroke={stroke} strokeWidth="1.5" strokeDasharray={entity.construction?"4 3":undefined} onClick={click}/>}if(entity.type==="external-bspline")return <path key={id} d={externalNurbsPaths.get(id) ?? ""} fill="none" stroke={stroke} strokeWidth="1.8" strokeDasharray="4 3" onClick={click}/>;if(entity.type==="point")return <circle key={id} cx={entity.position.x} cy={-entity.position.y} r="2" fill={stroke} onClick={click}/>;if(entity.type==="bspline")return <g key={id} onClick={click}><path d={editableNurbsPaths.get(id) ?? bsplineDisplayPath(entity.fitPoints,entity.closed)} fill="none" stroke={stroke} strokeWidth="1.8" strokeDasharray={entity.construction?"4 3":undefined}/>{selectedIds.includes(id)?entity.fitPoints.map((point,index)=><circle key={index} cx={point.x} cy={-point.y} r="1.6" fill={!entity.closed&&(index===0||index===entity.fitPoints.length-1)?"#ff9f43":entity.nurbs&&Math.abs(entity.nurbs.weights[index]-1)>1e-12?"#f0c45b":"#f7f8f4"}/>):null}</g>;return null;})}
      {semanticPoints(display).filter((entry)=>selectedIds.includes(entry.entityId)||selectedPoints.some((point)=>point.entityId===entry.entityId)).map((entry)=><circle key={`${entry.entityId}-${entry.role}`} cx={entry.point.x} cy={-entry.point.y} r="2.4" fill={selectedPointKeys.has(`${entry.entityId}:${entry.role}`)?"#ff8f3d":"#f7f8f4"} stroke="#182831" strokeWidth=".7" onClick={(event)=>{event.stopPropagation();togglePoint({entityId:entry.entityId,role:entry.role},event.shiftKey)}}/>)}
      {selectedCurveMarkers.map((entry)=><circle key={`${entry.entityId}-curve-${entry.parameter}`} cx={entry.point.x} cy={-entry.point.y} r="2.7" fill="#ff8f3d" stroke="#182831" strokeWidth=".7"/>)}
      {pending?.tool==="bspline"&&pending.points.length>1?<path d={bsplineDisplayPath([...pending.points,cursor])} fill="none" stroke="#f0c45b" strokeWidth="1.2" strokeDasharray="4 2"/>:null}{pending?.points.map((point,index)=><circle key={index} cx={point.x} cy={-point.y} r="2" fill="#f0c45b"/>)}<circle cx={cursor.x} cy={-cursor.y} r="1.7" fill="#ffffff" opacity=".8"/>
    </svg><aside style={{borderLeft:"1px solid #31445b",padding:10,overflow:"auto",background:"#0d1724"}}><b>草图精修</b><p style={{fontSize:11,color:"#8fa6bc"}}>先单击对象；按住 Shift 可多选。选中对象后，端点和圆心会显示为可选节点。</p>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:4}}><button onClick={()=>runOperation(()=>trimSketchEntity(draft,selectedId,cursor),"已按光标所在位置精确修剪对象。 ")} disabled={!selectedIds.length}>修剪</button><button onClick={()=>{const line=draft.entities[selectedIds[0]];if(!isLine(line)||selectedIds.length!==2){setMessage("延伸需要先选择一条源直线，再按 Shift 选择目标对象。 ");return;}const endpoint=Math.hypot(cursor.x-line.start.x,cursor.y-line.start.y)<Math.hypot(cursor.x-line.end.x,cursor.y-line.end.y)?"start":"end";runOperation(()=>extendLineToEntity(draft,line.id,endpoint,selectedIds[1]),"已将靠近光标的直线端点延伸到目标对象。 ")}} disabled={selectedIds.length!==2}>延伸</button><button onClick={()=>runOperation(()=>selectedIds.length>1&&selectedIds.every((id)=>isLine(draft.entities[id]))?offsetLineChain(draft,selectedIds,offsetDistance,cursor):offsetSketchEntity(draft,selectedId,offsetDistance,cursor),`已按光标方向偏移 ${offsetDistance} 毫米。`)} disabled={!selectedIds.length}>偏移</button><button onClick={()=>mirrorSelection("X")} disabled={!selectedIds.length}>关于 X 镜像</button><button onClick={()=>mirrorSelection("Y")} disabled={!selectedIds.length}>关于 Y 镜像</button><button onClick={patternSelection} disabled={!selectedIds.length}>线性阵列</button><button onClick={()=>void projectSelectedEdge()} disabled={!onProjectSelectedEdge}>投影模型边</button></div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:5,marginTop:7}}><label style={{fontSize:10}}>偏移距离<input type="number" min="0.01" step="0.5" value={offsetDistance} onChange={(event)=>setOffsetDistance(Number(event.target.value))}/></label><label style={{fontSize:10}}>阵列数量<input type="number" min="2" step="1" value={patternCount} onChange={(event)=>setPatternCount(Number(event.target.value))}/></label><label style={{fontSize:10}}>阵列间距<input type="number" min="0.01" step="1" value={patternSpacing} onChange={(event)=>setPatternSpacing(Number(event.target.value))}/></label></div>
      {selectedBSpline?<div style={{marginTop:8,padding:7,border:"1px solid #315e67",borderRadius:4,background:"#0b1d22"}}><b style={{color:"#67d8e8",fontSize:12}}>{selectedBSpline.nurbs?"NURBS 控制点与权重":"B-Spline 拟合点"}</b><p style={{fontSize:10,color:"#83a9b4",lineHeight:1.45,margin:"4px 0 6px"}}>开放曲线用于扫掠路径；封闭后可直接作为实体或曲面轮廓。精确 NURBS 会保留次数、节点和逐点权重。</p><div style={{display:"grid",gap:4,maxHeight:150,overflow:"auto"}}>{selectedBSpline.fitPoints.map((point,index)=><div key={index} style={{display:"grid",gridTemplateColumns:selectedBSpline.nurbs?"30px 1fr 1fr 1fr":"30px 1fr 1fr",gap:4,alignItems:"center",fontSize:10}}><span>P{index+1}</span><input aria-label={`P${index+1} X`} type="number" step="0.5" value={point.x} onChange={(event)=>updateBSplinePoint(index,"x",Number(event.target.value))}/><input aria-label={`P${index+1} Y`} type="number" step="0.5" value={point.y} onChange={(event)=>updateBSplinePoint(index,"y",Number(event.target.value))}/>{selectedBSpline.nurbs?<input aria-label={`P${index+1} 权重`} title="控制点权重" type="number" min="0.01" step="0.05" value={selectedBSpline.nurbs.weights[index]} onChange={(event)=>updateNurbsWeight(index,Number(event.target.value))}/>:null}</div>)}</div><div style={{display:"flex",gap:4,marginTop:6}}><button onClick={appendBSplinePoint}>在末端加入光标点</button><button onClick={removeLastBSplinePoint} disabled={selectedBSpline.fitPoints.length<=3}>删除末点</button></div><label style={{display:"flex",alignItems:"center",gap:5,fontSize:10,marginTop:6}}><input type="checkbox" checked={selectedBSpline.closed} onChange={(event)=>setBSplineClosed(event.target.checked)}/>封闭为周期轮廓</label><label style={{display:"flex",alignItems:"center",gap:5,fontSize:10,marginTop:6}}><input type="checkbox" checked={!!selectedBSpline.nurbs} onChange={(event)=>setExactNurbsEnabled(event.target.checked)}/>启用精确 NURBS 权重</label>{selectedBSpline.nurbs?<label style={{display:"grid",gridTemplateColumns:"80px 1fr",alignItems:"center",gap:5,fontSize:10,marginTop:6}}>曲线次数<input aria-label="NURBS 次数" type="number" min="1" max={selectedBSpline.fitPoints.length-1} step="1" value={selectedBSpline.nurbs.degree} onChange={(event)=>updateNurbsDegree(Number(event.target.value))}/></label>:null}<label style={{display:"flex",alignItems:"center",gap:5,fontSize:10,marginTop:6}}><input type="checkbox" checked={!!selectedBSpline.startTangent&&!!selectedBSpline.endTangent} disabled={selectedBSpline.closed||!!selectedBSpline.nurbs} onChange={(event)=>setBSplineTangentsEnabled(event.target.checked)}/>控制开放曲线首尾切向</label>{!selectedBSpline.closed&&!selectedBSpline.nurbs&&selectedBSpline.startTangent&&selectedBSpline.endTangent?<div style={{display:"grid",gridTemplateColumns:"30px 1fr 1fr",gap:4,marginTop:5,fontSize:10}}><span>起点</span><input aria-label="起点切向 X" type="number" step="0.1" value={selectedBSpline.startTangent.x} onChange={(event)=>updateBSplineTangent("start","x",Number(event.target.value))}/><input aria-label="起点切向 Y" type="number" step="0.1" value={selectedBSpline.startTangent.y} onChange={(event)=>updateBSplineTangent("start","y",Number(event.target.value))}/><span>终点</span><input aria-label="终点切向 X" type="number" step="0.1" value={selectedBSpline.endTangent.x} onChange={(event)=>updateBSplineTangent("end","x",Number(event.target.value))}/><input aria-label="终点切向 Y" type="number" step="0.1" value={selectedBSpline.endTangent.y} onChange={(event)=>updateBSplineTangent("end","y",Number(event.target.value))}/></div>:null}</div>:null}
      <hr style={{borderColor:"#26384c"}}/><b>几何约束</b><div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:4,marginTop:6}}>{(["horizontal","vertical","fixed","coincident","parallel","perpendicular","tangent","concentric","equal","midpoint"] as SketchConstraintType[]).map((type)=><button key={type} onClick={()=>applyConstraint(type)} disabled={!canAddConstraint(type)}>{constraintLabels[type]}</button>)}</div><div style={{display:"flex",flexWrap:"wrap",gap:4,marginTop:7}}>{Object.values(draft.constraints).map((constraint)=><button key={constraint.id} onClick={()=>removeConstraint(constraint.id)} title="单击删除该约束">× {constraintLabels[constraint.type]}</button>)}</div>
      <hr style={{borderColor:"#26384c"}}/><b>驱动尺寸</b>{Object.values(draft.dimensions).map((dimension)=><label key={dimension.id} style={{display:"grid",gap:3,fontSize:12,marginTop:7}}>{dimension.name??dimension.id}（{dimension.type==="angle"?"度":"毫米"}）<input type="number" value={dimension.value} step="0.5" min="0.01" onChange={(event)=>updateDimension(dimension.id,Number(event.target.value))}/></label>)}
      <hr style={{borderColor:"#26384c"}}/><b>当前说明</b><p style={{fontSize:11,color:"#9cc7ad"}}>{message}</p><b>求解诊断</b>{solve.diagnostics.length?solve.diagnostics.map((diagnostic,index)=><p key={index} style={{fontSize:11,color:diagnostic.severity==="error"?"#ff9a9a":"#f4d27b"}}>{diagnostic.message}</p>):<p style={{fontSize:11,color:"#8ee8ac"}}>当前约束没有冲突。</p>}</aside></div>
    <div style={{display:"flex",alignItems:"center",gap:14,padding:"0 10px",borderTop:"1px solid #30445a",fontSize:11,color:"#8fa6bc"}}><span>当前工具：{tool}</span><span>光标：{cursor.x.toFixed(1)}，{cursor.y.toFixed(1)} 毫米</span><span>网格：{grid} 毫米</span><span>已选对象：{selectedIds.length} · 已选节点：{selectedPoints.length}</span><span>草图 → 约束/尺寸 → 特征 → B-Rep</span></div>
  </div>;
}
