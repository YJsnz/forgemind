"use client";

import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { Sketch } from "../../core/sketch/Sketch";
import type { SketchConstraint, SketchConstraintType } from "../../core/sketch/SketchConstraint";
import type { SketchDimension } from "../../core/sketch/SketchDimension";
import type { SketchArc, SketchCircle, SketchEntity, SketchLine, SketchPointEntity } from "../../core/sketch/SketchEntity";
import { solveSketch } from "../../core/sketch/solver/SketchSolver";

type DrawTool = "select" | "line" | "rectangle" | "circle" | "arc" | "point";
type Vec2 = { x: number; y: number };
type Anchor = { entityId: string; role: "start" | "end" | "center" | "position"; point: Vec2 };

type Props = {
  sketch: Sketch;
  busy?: boolean;
  onCommit: (sketch: Sketch) => Promise<void> | void;
  onCancel: () => void;
};

const copy = <T,>(value: T): T => structuredClone(value);
const VIEW = { x: -150, y: -100, width: 300, height: 200 };
const SNAP_MM = 4;
const GRID_MM = 5;

const pointOf = (entity: SketchEntity, role: Anchor["role"]): Vec2 | undefined => {
  if (entity.type === "line" && role === "start") return entity.start;
  if (entity.type === "line" && role === "end") return entity.end;
  if ((entity.type === "circle" || entity.type === "arc") && role === "center") return entity.center;
  if (entity.type === "point" && role === "position") return entity.position;
  return undefined;
};

const anchorsFor = (sketch: Sketch): Anchor[] => Object.values(sketch.entities).flatMap((entity) => {
  const candidates: Anchor["role"][] = entity.type === "line" ? ["start", "end"] : entity.type === "circle" || entity.type === "arc" ? ["center"] : entity.type === "point" ? ["position"] : [];
  return candidates.flatMap((role) => {
    const point = pointOf(entity, role);
    return point ? [{ entityId: entity.id, role, point }] : [];
  });
});

const uid = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

export function IntegratedSketchEditor({ sketch, busy = false, onCommit, onCancel }: Props) {
  const [draft, setDraft] = useState<Sketch>(() => copy(sketch));
  const [tool, setTool] = useState<DrawTool>("select");
  const [construction, setConstruction] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [pending, setPending] = useState<Vec2[]>([]);
  const svgRef = useRef<SVGSVGElement>(null);
  const solve = useMemo(() => solveSketch(draft), [draft]);
  const anchors = useMemo(() => anchorsFor(draft), [draft]);

  const screenToModel = (event: ReactPointerEvent<SVGSVGElement>): Vec2 => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = VIEW.x + ((event.clientX - rect.left) / rect.width) * VIEW.width;
    const svgY = VIEW.y + ((event.clientY - rect.top) / rect.height) * VIEW.height;
    return { x, y: -svgY };
  };

  const snapped = (raw: Vec2): { point: Vec2; anchor?: Anchor } => {
    let nearest: Anchor | undefined;
    let distance = Infinity;
    for (const anchor of anchors) {
      const d = Math.hypot(raw.x - anchor.point.x, raw.y - anchor.point.y);
      if (d < distance) { distance = d; nearest = anchor; }
    }
    if (nearest && distance <= SNAP_MM) return { point: { ...nearest.point }, anchor: nearest };
    return { point: { x: Math.round(raw.x / GRID_MM) * GRID_MM, y: Math.round(raw.y / GRID_MM) * GRID_MM } };
  };

  const addConstraint = (next: Sketch, type: SketchConstraintType, entityIds: string[], pointRefs?: SketchConstraint["pointRefs"]) => {
    const id = uid(`constraint-${type}`);
    next.constraints[id] = { id, type, entityIds, ...(pointRefs?.length ? { pointRefs } : {}), enabled: true };
  };

  const addCoincidentForAnchor = (next: Sketch, newEntityId: string, role: "start" | "end" | "center" | "position", anchor?: Anchor) => {
    if (!anchor) return;
    addConstraint(next, "coincident", [newEntityId, anchor.entityId], [
      { entityId: newEntityId, role },
      { entityId: anchor.entityId, role: anchor.role },
    ]);
  };

  const handleCanvasPointer = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (busy || tool === "select") return;
    const hit = snapped(screenToModel(event));
    const nextPending = [...pending, hit.point];
    if (tool === "point") {
      const next = copy(draft); const id = uid("point");
      next.entities[id] = { id, type: "point", position: hit.point, construction } satisfies SketchPointEntity;
      next.entityOrder.push(id); addCoincidentForAnchor(next, id, "position", hit.anchor); setDraft(next); setPending([]); return;
    }
    if (tool === "line" && nextPending.length === 2) {
      const next = copy(draft); const id = uid("line"); const start = nextPending[0]; let end = nextPending[1];
      const dx = Math.abs(end.x - start.x), dy = Math.abs(end.y - start.y);
      let inferred: "horizontal" | "vertical" | undefined;
      if (dy <= Math.max(1, dx * .06)) { end = { x: end.x, y: start.y }; inferred = "horizontal"; }
      else if (dx <= Math.max(1, dy * .06)) { end = { x: start.x, y: end.y }; inferred = "vertical"; }
      next.entities[id] = { id, type: "line", start, end, construction } satisfies SketchLine; next.entityOrder.push(id);
      if (inferred) addConstraint(next, inferred, [id]);
      addCoincidentForAnchor(next, id, "start", snapped(start).anchor); addCoincidentForAnchor(next, id, "end", snapped(end).anchor);
      setDraft(next); setPending([]); return;
    }
    if (tool === "rectangle" && nextPending.length === 2) {
      const next = copy(draft); const [a, c] = nextPending; const points = [a, { x: c.x, y: a.y }, c, { x: a.x, y: c.y }];
      const ids = Array.from({ length: 4 }, (_, i) => uid(`rect-${i + 1}`));
      ids.forEach((id, i) => { next.entities[id] = { id, type: "line", start: points[i], end: points[(i + 1) % 4], construction } satisfies SketchLine; next.entityOrder.push(id); });
      [0, 2].forEach((i) => addConstraint(next, "horizontal", [ids[i]])); [1, 3].forEach((i) => addConstraint(next, "vertical", [ids[i]]));
      ids.forEach((id, i) => addConstraint(next, "coincident", [id, ids[(i + 1) % 4]], [{ entityId: id, role: "end" }, { entityId: ids[(i + 1) % 4], role: "start" }]));
      addCoincidentForAnchor(next, ids[0], "start", hit.anchor && Math.hypot(a.x-hit.anchor.point.x,a.y-hit.anchor.point.y)<SNAP_MM ? hit.anchor : undefined);
      setDraft(next); setPending([]); return;
    }
    if (tool === "circle" && nextPending.length === 2) {
      const next = copy(draft); const [center, edge] = nextPending; const radius = Math.hypot(edge.x - center.x, edge.y - center.y); if (radius <= .01) return;
      const id = uid("circle"); next.entities[id] = { id, type: "circle", center, radius, construction } satisfies SketchCircle; next.entityOrder.push(id); setDraft(next); setPending([]); return;
    }
    if (tool === "arc" && nextPending.length === 3) {
      const next = copy(draft); const [center, start, end] = nextPending; const radius = Math.hypot(start.x-center.x,start.y-center.y); if (radius <= .01) return;
      const id = uid("arc"); next.entities[id] = { id, type: "arc", center, radius, startAngle: Math.atan2(start.y-center.y,start.x-center.x), endAngle: Math.atan2(end.y-center.y,end.x-center.x), construction } satisfies SketchArc; next.entityOrder.push(id); setDraft(next); setPending([]); return;
    }
    setPending(nextPending);
  };

  const toggleSelection = (id: string) => { if (tool !== "select") return; setSelectedIds((current) => current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]); };
  const deleteSelected = () => {
    if (!selectedIds.length) return;
    const next = copy(draft); selectedIds.forEach((id) => delete next.entities[id]); next.entityOrder = next.entityOrder.filter((id) => !selectedIds.includes(id));
    next.constraints = Object.fromEntries(Object.entries(next.constraints).filter(([, constraint]) => !constraint.entityIds.some((id) => selectedIds.includes(id))));
    next.dimensions = Object.fromEntries(Object.entries(next.dimensions).filter(([, dimension]) => !dimension.entityIds.some((id) => selectedIds.includes(id))));
    setDraft(next); setSelectedIds([]);
  };

  const constrainSelected = (type: "horizontal" | "vertical" | "fixed") => {
    if (selectedIds.length !== 1) return; const entity = draft.entities[selectedIds[0]]; if (!entity || ((type === "horizontal" || type === "vertical") && entity.type !== "line")) return;
    const next = copy(draft); addConstraint(next, type, [entity.id]); setDraft(next);
  };

  const dimensionSelected = () => {
    if (selectedIds.length !== 1) return; const entity = draft.entities[selectedIds[0]]; if (!entity) return; let dimension: SketchDimension | undefined;
    if (entity.type === "line") dimension = { id: uid("dimension"), name: "Length", type: "distance", entityIds: [entity.id], pointRefs: [{ entityId: entity.id, role: "start" }, { entityId: entity.id, role: "end" }], value: Math.hypot(entity.end.x-entity.start.x, entity.end.y-entity.start.y), driving: true };
    else if (entity.type === "circle" || entity.type === "arc") dimension = { id: uid("dimension"), name: "Radius", type: "radius", entityIds: [entity.id], value: entity.radius, driving: true };
    if (!dimension) return; setDraft((current) => ({ ...current, dimensions: { ...current.dimensions, [dimension!.id]: dimension! } }));
  };

  const updateDimension = (id: string, value: number) => { if (!Number.isFinite(value) || value <= 0) return; setDraft((current) => ({ ...current, dimensions: { ...current.dimensions, [id]: { ...current.dimensions[id], value } } })); };
  const finish = async () => {
    const solved = solveSketch(draft); if (solved.status === "conflicting" || solved.status === "failed") return;
    await onCommit({ ...draft, entities: solved.entities });
  };

  const gridLines = [] as JSX.Element[];
  for (let x = -150; x <= 150; x += 10) gridLines.push(<line key={`gx${x}`} x1={x} y1={-100} x2={x} y2={100} stroke="#16283a" strokeWidth=".35" />);
  for (let y = -100; y <= 100; y += 10) gridLines.push(<line key={`gy${y}`} x1={-150} y1={y} x2={150} y2={y} stroke="#16283a" strokeWidth=".35" />);

  return <div data-testid="integrated-sketch-editor" style={{ position:"absolute", inset:10, zIndex:8, border:"1px solid #3a5876", borderRadius:8, background:"#08111ddd", backdropFilter:"blur(6px)", display:"grid", gridTemplateRows:"44px minmax(0,1fr) 48px", overflow:"hidden" }}>
    <div style={{ display:"flex", alignItems:"center", gap:6, padding:"0 10px", borderBottom:"1px solid #26384c", background:"#0d1a29" }}>
      <strong style={{ color:"#f0c45b", marginRight:6 }}>编辑草图 · {draft.name}</strong>
      {([ ["select","选择"], ["line","线"], ["rectangle","矩形"], ["circle","圆"], ["arc","圆弧"], ["point","点"] ] as const).map(([id,label]) => <button key={id} type="button" onClick={()=>{setTool(id);setPending([]);}} style={{ background:tool===id?"#1e6fa8":undefined }}>{label}</button>)}
      <button type="button" onClick={()=>setConstruction((v)=>!v)} style={{ background:construction?"#65511f":undefined }}>构造</button>
      <span style={{ width:1,height:22,background:"#35485f" }}/><button type="button" disabled={selectedIds.length!==1} onClick={()=>constrainSelected("horizontal")}>H</button><button type="button" disabled={selectedIds.length!==1} onClick={()=>constrainSelected("vertical")}>V</button><button type="button" disabled={selectedIds.length!==1} onClick={()=>constrainSelected("fixed")}>固定</button><button type="button" disabled={selectedIds.length!==1} onClick={dimensionSelected}>尺寸</button><button type="button" disabled={!selectedIds.length} onClick={deleteSelected}>删除</button>
      <span style={{ flex:1 }}/><small style={{ color: solve.status === "fully-constrained" ? "#8ee2ac" : solve.status === "conflicting" || solve.status === "failed" ? "#ff9d9d" : "#f3d67a" }}>{solve.status} · DOF {solve.degreesOfFreedom}</small>
    </div>
    <div style={{ display:"grid", gridTemplateColumns:"minmax(0,1fr) 220px", minHeight:0 }}>
      <svg ref={svgRef} viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.width} ${VIEW.height}`} onPointerDown={handleCanvasPointer} style={{ width:"100%",height:"100%",background:"#07101a",touchAction:"none",cursor:tool==="select"?"default":"crosshair" }}>
        {gridLines}<line x1="-150" y1="0" x2="150" y2="0" stroke="#4b6177" strokeWidth=".6"/><line x1="0" y1="-100" x2="0" y2="100" stroke="#4b6177" strokeWidth=".6"/>
        {Object.values(draft.entities).map((entity) => {
          const active=selectedIds.includes(entity.id), stroke=entity.construction?"#718096":active?"#f4cf69":"#5eead4";
          if(entity.type==="line") return <line key={entity.id} x1={entity.start.x} y1={-entity.start.y} x2={entity.end.x} y2={-entity.end.y} stroke={stroke} strokeWidth={active?2:1.3} strokeDasharray={entity.construction?"4 3":undefined} onPointerDown={(e)=>{e.stopPropagation();toggleSelection(entity.id);}}/>;
          if(entity.type==="circle") return <circle key={entity.id} cx={entity.center.x} cy={-entity.center.y} r={entity.radius} fill="none" stroke={stroke} strokeWidth={active?2:1.3} strokeDasharray={entity.construction?"4 3":undefined} onPointerDown={(e)=>{e.stopPropagation();toggleSelection(entity.id);}}/>;
          if(entity.type==="arc") { const sx=entity.center.x+Math.cos(entity.startAngle)*entity.radius, sy=-(entity.center.y+Math.sin(entity.startAngle)*entity.radius), ex=entity.center.x+Math.cos(entity.endAngle)*entity.radius, ey=-(entity.center.y+Math.sin(entity.endAngle)*entity.radius); let delta=entity.endAngle-entity.startAngle; while(delta<0)delta+=Math.PI*2; const large=delta>Math.PI?1:0; return <path key={entity.id} d={`M ${sx} ${sy} A ${entity.radius} ${entity.radius} 0 ${large} 0 ${ex} ${ey}`} fill="none" stroke={stroke} strokeWidth={active?2:1.3} onPointerDown={(e)=>{e.stopPropagation();toggleSelection(entity.id);}}/>; }
          if(entity.type==="point") return <circle key={entity.id} cx={entity.position.x} cy={-entity.position.y} r="2.2" fill={stroke} onPointerDown={(e)=>{e.stopPropagation();toggleSelection(entity.id);}}/>;
          return null;
        })}
        {pending.map((point,index)=><circle key={index} cx={point.x} cy={-point.y} r="2.5" fill="#f0c45b"/>)}
      </svg>
      <aside style={{ borderLeft:"1px solid #26384c", padding:10, overflow:"auto", background:"#0b1624" }}><b>驱动尺寸</b>{Object.values(draft.dimensions).length?Object.values(draft.dimensions).map((dimension)=><label key={dimension.id} style={{ display:"grid",gap:3,marginTop:8,fontSize:11 }}>{dimension.name??dimension.id}<input type="number" value={dimension.value} step="0.1" onChange={(e)=>updateDimension(dimension.id,Number(e.target.value))} style={{ background:"#08111d",color:"#e5eef7",border:"1px solid #3a5068",borderRadius:4,padding:"5px 6px" }}/></label>):<small style={{ display:"block",color:"#6f879d",marginTop:7 }}>选择线/圆后点“尺寸”。</small>}<b style={{ display:"block",marginTop:14 }}>约束</b><div style={{ display:"grid",gap:3,marginTop:6 }}>{Object.values(draft.constraints).slice(0,20).map((constraint)=><small key={constraint.id} style={{ color:"#95abc0" }}>{constraint.type} · {constraint.entityIds.join(", ")}</small>)}</div><p style={{ color:"#6f879d",fontSize:11,lineHeight:1.45 }}>取消旧“手绘轮廓直接实体化”。所有几何先成为参数化 Sketch，再由 Extrude / Add / Remove / Revolve / Sweep / Loft 等 Feature 使用。</p></aside>
    </div>
    <div style={{ display:"flex",alignItems:"center",gap:8,padding:"0 10px",borderTop:"1px solid #26384c",background:"#0d1a29" }}><span style={{ color:"#91a9bf",fontSize:12 }}>网格 5 mm · 端点/圆心捕获 4 mm · 自动 H/V 推断</span><span style={{ flex:1 }}/><button type="button" onClick={onCancel} disabled={busy}>× 取消</button><button type="button" onClick={()=>void finish()} disabled={busy||solve.status==="conflicting"||solve.status==="failed"} style={{ background:"#246f50" }}>✓ 完成草图</button></div>
  </div>;
}
