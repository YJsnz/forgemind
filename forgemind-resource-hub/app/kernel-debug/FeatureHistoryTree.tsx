"use client";

import type { Dispatch, RefObject, SetStateAction } from "react";
import type { FeaturePanelItem } from "./workbenchTypes";

export type FeatureHistoryFilter = "all" | "active" | "suppressed" | "error";

export function FeatureHistoryTree({
  allFeatures,
  visibleFeatures,
  selectedFeatureId,
  upstreamIds,
  downstreamIds,
  positionById,
  query,
  setQuery,
  filter,
  setFilter,
  searchInputRef,
  stateSummary,
  onSelect,
}: {
  allFeatures: FeaturePanelItem[];
  visibleFeatures: FeaturePanelItem[];
  selectedFeatureId: string;
  upstreamIds: ReadonlySet<string>;
  downstreamIds: ReadonlySet<string>;
  positionById: ReadonlyMap<string, number>;
  query: string;
  setQuery: Dispatch<SetStateAction<string>>;
  filter: FeatureHistoryFilter;
  setFilter: Dispatch<SetStateAction<FeatureHistoryFilter>>;
  searchInputRef: RefObject<HTMLInputElement | null>;
  stateSummary: { active: number; suppressed: number; error: number };
  onSelect: (id: string) => void;
}) {
  const clear = () => { setQuery(""); setFilter("all"); };
  return <>
    <div className="cad-history-list-head"><b>历史特征</b><span>{visibleFeatures.length}/{allFeatures.length}</span></div>
    <div className="cad-history-list-tools">
      <input ref={searchInputRef} aria-label="搜索历史特征" placeholder="搜索名称或类型" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); clear(); event.currentTarget.blur(); } }} />
      <select aria-label="筛选历史特征" value={filter} onChange={(event) => setFilter(event.target.value as FeatureHistoryFilter)}><option value="all">全部</option><option value="active">正常</option><option value="suppressed">已抑制</option><option value="error">有错误</option></select>
      <button type="button" aria-label="清除历史搜索和筛选" title="清除搜索和筛选" disabled={!query && filter === "all"} onClick={clear}>×</button>
    </div>
    <div className="cad-history-summary"><span>正常 {stateSummary.active}</span><span>抑制 {stateSummary.suppressed}</span><span className={stateSummary.error ? "has-error" : ""}>错误 {stateSummary.error}</span></div>
    <div className="cad-history-list">
      {visibleFeatures.length ? visibleFeatures.map((feature) => {
        const upstream = upstreamIds.has(feature.id), downstream = downstreamIds.has(feature.id);
        return <button aria-current={selectedFeatureId === feature.id ? "true" : undefined} className={`cad-history-item ${selectedFeatureId === feature.id ? "is-selected" : ""} ${upstream ? "is-upstream" : ""} ${downstream ? "is-downstream" : ""} ${feature.enabled ? "" : "is-suppressed"} ${feature.state === "error" ? "is-error" : ""}`} key={feature.id} type="button" title={`${upstream ? "上游 · " : downstream ? "下游 · " : ""}${feature.stateLabel} · ${feature.summary}`} onClick={() => onSelect(feature.id)}>
          <span className="cad-history-index">{(positionById.get(feature.id) ?? 0) + 1}</span>
          <span className="cad-history-content"><b>{feature.name}</b><small>{feature.typeLabel}{feature.dependencyCount ? ` · ${feature.dependencyCount} 个输入` : ""}</small></span>
          <i>{upstream ? "上游" : downstream ? "下游" : feature.state === "error" ? "错误" : feature.enabled ? "正常" : "抑制"}</i>
        </button>;
      }) : <small className="cad-history-empty">{allFeatures.length ? "没有符合条件的特征。" : "暂无历史特征。"}</small>}
    </div>
  </>;
}
