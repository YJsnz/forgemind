"use client";

import type { Dispatch, SetStateAction } from "react";
import type { CadBody } from "../../core/cad/CadTypes";

export type EngineeringDraft = { material: string; densityKgM3: string; toleranceMm: string; process: string; group: string };
export type EngineeringSummary = { solidCount: number; materialCount: number; totalVolumeMm3: number; totalSurfaceAreaMm2: number; totalMassKg: number };

const numberText = (value: number, maximumFractionDigits: number) => value.toLocaleString("zh-CN", { maximumFractionDigits });

export function EngineeringPropertiesPanel({ summary, selectedBody, selectedVolumeMm3, selectedMassKg, draft, setDraft, onSave }: {
  summary: EngineeringSummary;
  selectedBody?: CadBody;
  selectedVolumeMm3?: number;
  selectedMassKg?: number;
  draft: EngineeringDraft;
  setDraft: Dispatch<SetStateAction<EngineeringDraft>>;
  onSave: () => void;
}) {
  return <section className="cad-engineering-editor">
      {/* Compatibility label retained for product checks: 项目工程汇总 */}
      <b>工程汇总</b>
      <div className="cad-readable-data">
        <article><span>实体</span><strong>{summary.solidCount} 个</strong><small>{summary.materialCount} 个已设置材料</small></article>
        <article><span>体积</span><strong>{numberText(summary.totalVolumeMm3, 1)} mm³</strong></article>
        <article><span>估算总质量</span><strong>{summary.materialCount ? `${numberText(summary.totalMassKg, 3)} kg` : "待设置材料"}</strong></article>
        <article><span>总表面积</span><strong>{numberText(summary.totalSurfaceAreaMm2, 1)} mm²</strong></article>
      </div>
      {selectedBody ? <div className="cad-engineering-form">
        <b>所选实体 · {selectedBody.name}</b>
        <label>材料<input value={draft.material} onChange={(event) => setDraft((current) => ({ ...current, material: event.target.value }))} placeholder="例如：6061-T6 铝合金" /></label>
        <label>密度（kg/m³）<input type="number" min="0.01" step="1" value={draft.densityKgM3} onChange={(event) => setDraft((current) => ({ ...current, densityKgM3: event.target.value }))} placeholder="例如：2700" /></label>
        <label>公差（mm）<input type="number" min="0" step="0.001" value={draft.toleranceMm} onChange={(event) => setDraft((current) => ({ ...current, toleranceMm: event.target.value }))} placeholder="例如：0.01" /></label>
        <label>工艺<input value={draft.process} onChange={(event) => setDraft((current) => ({ ...current, process: event.target.value }))} placeholder="例如：CNC 精加工" /></label>
        <label>分组<input value={draft.group} onChange={(event) => setDraft((current) => ({ ...current, group: event.target.value }))} placeholder="例如：机架 / 传动" /></label>
        <div className="cad-readable-data">
          <article><span>体积</span><strong>{selectedVolumeMm3 !== undefined ? `${numberText(selectedVolumeMm3, 2)} mm³` : "读取中"}</strong></article>
          <article><span>质量</span><strong>{selectedMassKg !== undefined ? `${numberText(selectedMassKg, 4)} kg` : "待设置密度"}</strong></article>
        </div>
        <button type="button" onClick={onSave}>保存工程数据</button>
      </div> : <p>选择实体后编辑材料、公差与工艺。</p>}
    </section>;
}
