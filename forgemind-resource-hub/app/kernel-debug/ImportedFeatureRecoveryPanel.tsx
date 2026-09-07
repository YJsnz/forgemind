"use client";

import type { CadSelectionMode } from "../../core/selection/SelectionTypes";
import type { ImportedFeatureRecoveryPlan } from "../../core/direct-edit/ImportedFeatureRecoveryPlan";
import type { DirectEditCandidate } from "./workbenchTypes";

type DepthMode = "throughAll" | "blind";

export function ImportedFeatureRecoveryPanel({
  busy, mode, analysis, candidates, recoveryPlan,
  holeLabel, holeDiameterMm, holeDepthMode, holeDepthMm,
  patternLabel, edgeLabel, edgeValueMm, edgeSelectionLabel, edgeSelectionCount,
  onAnalyze, onSelectCandidate, onLoadFaceGroup, onBeginHole, onBeginPattern, onBeginEdge, onReconstructPrismatic,
  onHoleDiameterChange, onHoleDepthModeChange, onHoleDepthChange,
  onCompleteHole, onCancelHole, onCompletePattern, onCancelPattern,
  onEdgeValueChange, onAddEdge, onClearEdges, onCompleteEdge, onCancelEdge,
}: {
  busy: boolean;
  mode: CadSelectionMode;
  analysis: string;
  candidates: DirectEditCandidate[];
  recoveryPlan?: ImportedFeatureRecoveryPlan;
  holeLabel: string;
  holeDiameterMm: number;
  holeDepthMode: DepthMode;
  holeDepthMm: number;
  patternLabel: string;
  edgeLabel: string;
  edgeValueMm: number;
  edgeSelectionLabel: string;
  edgeSelectionCount: number;
  onAnalyze: () => void;
  onSelectCandidate: (candidate: DirectEditCandidate) => void;
  onLoadFaceGroup: (candidate: DirectEditCandidate) => void;
  onBeginHole: (candidate: DirectEditCandidate) => void;
  onBeginPattern: (candidate: DirectEditCandidate) => void;
  onBeginEdge: (candidate: DirectEditCandidate) => void;
  onReconstructPrismatic: (candidate: DirectEditCandidate) => void;
  onHoleDiameterChange: (value: number) => void;
  onHoleDepthModeChange: (value: DepthMode) => void;
  onHoleDepthChange: (value: number) => void;
  onCompleteHole: () => void;
  onCancelHole: () => void;
  onCompletePattern: () => void;
  onCancelPattern: () => void;
  onEdgeValueChange: (value: number) => void;
  onAddEdge: () => void;
  onClearEdges: () => void;
  onCompleteEdge: () => void;
  onCancelEdge: () => void;
}) {
  const reconstructionBusy = !!holeLabel || !!patternLabel || !!edgeLabel;
  return <>
    <b>导入特征</b>
    <p style={{ color: "#a9bdd0", fontSize: 12, lineHeight: 1.55 }}>{analysis}</p>
    <button type="button" onClick={onAnalyze} disabled={busy}>分析导入特征</button>

    {recoveryPlan ? <div className="cad-import-recovery-plan">
      <b>恢复队列</b><div>{recoveryPlan.summary}</div>
      <div className="cad-import-recovery-steps">{recoveryPlan.steps.filter((step) => step.action !== "skip-covered").slice(0, 6).map((step) => <div key={step.id}><span>{step.order}</span><span>{step.item.label}</span><small data-action={step.action}>{step.action === "reconstruct" ? "可恢复" : step.action === "confirm" ? "需确认" : "仅审查"}</small></div>)}</div>
    </div> : null}

    {candidates.length ? <div className="cad-import-candidates">{candidates.map((candidate, index) => <div key={`${candidate.kind}-${candidate.topology.localId}-${index}`}>
      <button type="button" onClick={() => onSelectCandidate(candidate)} disabled={busy}>{candidate.kind === "hole" ? "◉" : candidate.kind === "round" ? "◒" : candidate.kind === "cone" ? "△" : "▱"} {candidate.label}</button>
      {candidate.kind !== "hole" ? <button type="button" onClick={() => onLoadFaceGroup(candidate)} disabled={busy} title={candidate.kind === "prismatic" ? "把顶面和侧面装入去特征审查集合" : "将识别到的连续解析面装入去特征选择集"}>{candidate.kind === "prismatic" ? "审查面组" : "选面组"}</button> : null}
      {candidate.kind === "hole" ? <button type="button" onClick={() => onBeginHole(candidate)} disabled={busy || reconstructionBusy}>重构孔</button>
        : candidate.kind === "prismatic" ? <button type="button" onClick={() => candidate.prismaticSpec?.classification ? onReconstructPrismatic(candidate) : onSelectCandidate(candidate)} disabled={busy}>{candidate.prismaticSpec?.classification ? `重构${candidate.prismaticSpec.classification === "boss" ? "凸台" : "凹槽"}` : "待确认"}</button>
          : candidate.kind === "pattern" ? <button type="button" onClick={() => onBeginPattern(candidate)} disabled={busy || reconstructionBusy}>重构阵列</button>
            : <button type="button" onClick={() => onBeginEdge(candidate)} disabled={busy || reconstructionBusy}>{candidate.kind === "round" ? "修改圆角" : "修改倒角"}</button>}
    </div>)}</div> : null}

    {holeLabel ? <div className="cad-import-session is-hole"><b>孔特征恢复</b><div>{holeLabel}</div>
      <label>直径（毫米）<input type="number" min="0.01" step="0.25" value={holeDiameterMm} onChange={(event) => onHoleDiameterChange(Number(event.target.value))} disabled={busy} /></label>
      <label>深度<select value={holeDepthMode} onChange={(event) => onHoleDepthModeChange(event.target.value as DepthMode)} disabled={busy}><option value="throughAll">贯穿</option><option value="blind">盲孔</option></select></label>
      {holeDepthMode === "blind" ? <label>盲孔深度（毫米）<input type="number" min="0.01" step="0.5" value={holeDepthMm} onChange={(event) => onHoleDepthChange(Number(event.target.value))} disabled={busy} /></label> : null}
      <button type="button" onClick={onCompleteHole} disabled={busy || mode !== "face"}>完成孔重构</button><button type="button" onClick={onCancelHole} disabled={busy}>取消并恢复</button>
    </div> : null}

    {patternLabel ? <div className="cad-import-session is-pattern"><b>孔阵列恢复</b><div>{patternLabel}</div>
      <label>种子孔深度<select value={holeDepthMode} onChange={(event) => onHoleDepthModeChange(event.target.value as DepthMode)} disabled={busy}><option value="throughAll">贯穿</option><option value="blind">盲孔</option></select></label>
      {holeDepthMode === "blind" ? <label>盲孔深度（毫米）<input type="number" min="0.01" step="0.5" value={holeDepthMm} onChange={(event) => onHoleDepthChange(Number(event.target.value))} disabled={busy} /></label> : null}
      <button type="button" onClick={onCompletePattern} disabled={busy || mode !== "face"}>完成阵列重构</button><button type="button" onClick={onCancelPattern} disabled={busy}>取消并恢复</button>
    </div> : null}

    {edgeLabel ? <div className="cad-import-session is-edge"><b>圆角 / 倒角恢复</b><div>{edgeLabel}</div><div>{edgeSelectionLabel}</div>
      <button type="button" onClick={onAddEdge} disabled={busy || mode !== "edge"}>加入当前边</button><button type="button" onClick={onClearEdges} disabled={busy || !edgeSelectionCount}>清空边</button>
      <label>新尺寸（毫米）<input type="number" min="0.01" step="0.25" value={edgeValueMm} onChange={(event) => onEdgeValueChange(Number(event.target.value))} disabled={busy} /></label>
      <button type="button" onClick={onCompleteEdge} disabled={busy || mode !== "edge"}>完成参数化重构</button><button type="button" onClick={onCancelEdge} disabled={busy}>取消并恢复</button>
    </div> : null}
  </>;
}
