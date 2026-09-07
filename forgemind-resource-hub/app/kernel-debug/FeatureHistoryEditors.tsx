"use client";

import { useState } from "react";
import type { Feature } from "../../core/features/Feature";

export type SurfaceSweepEditValues = {
  profileSketchId: string;
  pathSketchId: string;
  guideSketchId?: string;
  orientation: "followPath" | "fixedUp" | "guide";
  upDirection: { x: number; y: number; z: number };
};

export function SurfaceSweepHistoryEditor({ feature, sketches, busy, onPreview }: {
  feature: Extract<Feature, { type: "surfaceSweep" }>;
  sketches: Array<{ id: string; name: string }>;
  busy: boolean;
  onPreview: (values: SurfaceSweepEditValues) => void;
}) {
  const [profileSketchId, setProfileSketchId] = useState(feature.profileSketchId);
  const [pathSketchId, setPathSketchId] = useState(feature.pathSketchId);
  const [guideSketchId, setGuideSketchId] = useState(feature.guideSketchId ?? "");
  const [orientation, setOrientation] = useState(feature.orientation);
  const [upDirection, setUpDirection] = useState(feature.upDirection ?? { x: 0, y: 1, z: 0 });
  const options = sketches.map((sketch) => <option key={sketch.id} value={sketch.id}>{sketch.name} · {sketch.id}</option>);
  const canPreview = !!profileSketchId && !!pathSketchId && profileSketchId !== pathSketchId && (orientation !== "guide" || (!!guideSketchId && guideSketchId !== profileSketchId && guideSketchId !== pathSketchId));
  return <div style={{ marginTop: 9, padding: 8, border: "1px solid #315e67", borderRadius: 4, background: "#0b1d22" }}>
    <b style={{ color: "#67d8e8", fontSize: 12 }}>编辑曲面扫掠</b>
    <label style={{ display: "grid", gap: 3, fontSize: 11, marginTop: 6 }}>截面草图<select value={profileSketchId} onChange={(event) => setProfileSketchId(event.target.value)} disabled={busy}>{options}</select></label>
    <label style={{ display: "grid", gap: 3, fontSize: 11, marginTop: 6 }}>主路径草图<select value={pathSketchId} onChange={(event) => setPathSketchId(event.target.value)} disabled={busy}>{options}</select></label>
    <label style={{ display: "grid", gap: 3, fontSize: 11, marginTop: 6 }}>方向方式<select value={orientation} onChange={(event) => setOrientation(event.target.value as SurfaceSweepEditValues["orientation"])} disabled={busy}><option value="followPath">随路径转向</option><option value="fixedUp">保持固定方向</option><option value="guide">由辅助导轨控制</option></select></label>
    {orientation === "guide" ? <label style={{ display: "grid", gap: 3, fontSize: 11, marginTop: 6 }}>辅助导轨草图<select value={guideSketchId} onChange={(event) => setGuideSketchId(event.target.value)} disabled={busy}><option value="">请选择导轨</option>{options}</select></label> : null}
    {orientation === "fixedUp" ? <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 5, marginTop: 6 }}>{(["x", "y", "z"] as const).map((axis) => <label key={axis} style={{ display: "grid", gap: 3, fontSize: 10 }}>方向 {axis.toUpperCase()}<input type="number" step="0.1" value={upDirection[axis]} onChange={(event) => setUpDirection((value) => ({ ...value, [axis]: Number(event.target.value) }))} disabled={busy} /></label>)}</div> : null}
    {!canPreview ? <small style={{ display: "block", color: "#d1a660", marginTop: 6 }}>截面、主路径和辅助导轨必须使用不同草图。</small> : null}
    <button type="button" onClick={() => onPreview({ profileSketchId, pathSketchId, guideSketchId: orientation === "guide" ? guideSketchId : undefined, orientation, upDirection })} disabled={busy || !canPreview} style={{ width: "100%", marginTop: 7 }}>预览扫掠修改</button>
  </div>;
}

export type BoundarySurfaceEditValues = { continuity: "G0" | "G1" | "G2"; sampleCount: number; angularToleranceDeg: number; curvatureTolerance: number };

export function BoundarySurfaceHistoryEditor({ feature, busy, onPreview }: {
  feature: Extract<Feature, { type: "boundarySurface" }>;
  busy: boolean;
  onPreview: (values: BoundarySurfaceEditValues) => void;
}) {
  const [continuity, setContinuity] = useState(feature.continuity);
  const [sampleCount, setSampleCount] = useState(feature.verification?.sampleCount ?? 11);
  const [angularToleranceDeg, setAngularToleranceDeg] = useState(feature.verification?.angularToleranceDeg ?? .5);
  const [curvatureTolerance, setCurvatureTolerance] = useState(feature.verification?.curvatureTolerance ?? 1e-3);
  return <div style={{ marginTop: 9, padding: 8, border: "1px solid #315e67", borderRadius: 4, background: "#0b1d22" }}>
    <b style={{ color: "#67d8e8", fontSize: 12 }}>编辑边界曲面验收</b>
    <label style={{ display: "grid", gap: 3, fontSize: 11 }}>目标连续性<select value={continuity} onChange={(event) => setContinuity(event.target.value as BoundarySurfaceEditValues["continuity"])} disabled={busy}><option value="G0">G0 · 边界对齐</option><option value="G1">G1 · 切向连续</option><option value="G2">G2 · 曲率连续</option></select></label>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 5, marginTop: 6 }}>
      <label style={{ display: "grid", gap: 3, fontSize: 10 }}>采样点<input type="number" min="3" max="31" step="2" value={sampleCount} onChange={(event) => setSampleCount(Math.max(3, Math.min(31, Math.round(Number(event.target.value)) | 1)))} disabled={busy} /></label>
      <label style={{ display: "grid", gap: 3, fontSize: 10 }}>夹角 °<input type="number" min="0.001" step="0.05" value={angularToleranceDeg} onChange={(event) => setAngularToleranceDeg(Math.max(.001, Number(event.target.value)))} disabled={busy} /></label>
      <label style={{ display: "grid", gap: 3, fontSize: 10 }}>曲率差<input type="number" min="0.000001" step="0.0001" value={curvatureTolerance} onChange={(event) => setCurvatureTolerance(Math.max(1e-6, Number(event.target.value)))} disabled={busy} /></label>
    </div>
    <button type="button" onClick={() => onPreview({ continuity, sampleCount, angularToleranceDeg, curvatureTolerance })} disabled={busy} style={{ width: "100%", marginTop: 7 }}>预览并重新验收</button>
  </div>;
}
