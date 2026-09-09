"use client";

import { useEffect, useRef, useState } from "react";
import { createUnifiedCadDocument } from "../../core/authoring/UnifiedCadWorkspace";
import type { CadDocument } from "../../core/cad/CadDocument";
import { isObsoleteGeneratedCadDocument, listCadDocumentHandoffs, loadCadDocumentHandoff, pruneObsoleteResourceCadDocuments, saveCadDocumentHandoff, type StoredCadDocumentSummary } from "../../core/cad/CadDocumentStore";
import type { Feature } from "../../core/features/Feature";
import type { Sketch } from "../../core/sketch/Sketch";
import { createHighDetailResourceCadDocument, highDetailResourceCatalog, highDetailResourceIds } from "../../core/resource/HighDetailResourceCad";
import { OcctKernelDebug } from "../kernel-debug/OcctKernelDebug";

const resourceReferenceAssets: Record<string, string> = {
  cnc: "/models/industrial/cnc_machining_center.glb",
  robot: "/models/industrial/robot_cell.glb",
  press: "/models/industrial/hydraulic_press_detail.glb",
  conveyor: "/models/industrial/roller_conveyor.glb",
  buffer: "/models/industrial/pallet_buffer_detail.glb",
};

const currentPrecisionDocumentIds = Object.fromEntries(highDetailResourceIds.map((resourceId) => [resourceId, `cad-resource-${resourceId}-precision-v2`]));
const canonicalPrecisionProjects: StoredCadDocumentSummary[] = highDetailResourceCatalog.map((entry) => ({
  id: entry.documentId,
  name: entry.name,
  savedAt: 0,
  sourceResourceId: entry.resourceId,
}));

const inferLegacyResourceId = (name: string): string | undefined => {
  const normalized = name.toLocaleLowerCase("zh-CN");
  if (/vmc|数控|加工中心/.test(normalized)) return "cnc";
  if (/机器人|机械臂/.test(normalized)) return "robot";
  if (/冲压|压力机/.test(normalized)) return "press";
  if (/输送|滚筒|传送/.test(normalized)) return "conveyor";
  if (/缓存|托盘仓/.test(normalized)) return "buffer";
  if (/伺服电机|电机总成/.test(normalized)) return "motor";
  if (/机加工壳体|壳体零件/.test(normalized)) return "housing";
  if (/接口盒|router/.test(normalized)) return "router-box";
  return undefined;
};

export function CadRoute() {
  const [document, setDocument] = useState<CadDocument<Sketch, Feature>>();
  const [notice, setNotice] = useState("正在恢复专业 CAD 会话…");
  const [ready, setReady] = useState(false);
  const [projects, setProjects] = useState<StoredCadDocumentSummary[]>([]);
  const projectsLoadedRef = useRef(false);
  const [query, setQuery] = useState(() => typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search));

  useEffect(() => {
    const restoreBrowserLocation = () => setQuery(new URLSearchParams(window.location.search));
    window.addEventListener("popstate", restoreBrowserLocation);
    return () => window.removeEventListener("popstate", restoreBrowserLocation);
  }, []);

  const openProjectWithoutReload = (project: StoredCadDocumentSummary) => {
    const next = new URLSearchParams();
    next.set("mode", "part");
    if (project.sourceResourceId && currentPrecisionDocumentIds[project.sourceResourceId] === project.id) next.set("resourceId", project.sourceResourceId);
    else next.set("documentId", project.id);
    window.history.pushState({}, "", `/cad?${next.toString()}`);
    setQuery(next);
  };

  const loadAvailableProjects = () => {
    if (projectsLoadedRef.current) return;
    projectsLoadedRef.current = true;
    try {
      pruneObsoleteResourceCadDocuments(window.sessionStorage, currentPrecisionDocumentIds);
      pruneObsoleteResourceCadDocuments(window.localStorage, currentPrecisionDocumentIds);
      const combined = [...canonicalPrecisionProjects, ...listCadDocumentHandoffs(window.sessionStorage), ...listCadDocumentHandoffs(window.localStorage)];
      const deduplicated = new Map<string, StoredCadDocumentSummary>();
      combined.forEach((project) => { const previous = deduplicated.get(project.id); if (!previous || project.savedAt > previous.savedAt) deduplicated.set(project.id, project); });
      const precisionOrder = new Map(canonicalPrecisionProjects.map((project, index) => [project.id, index]));
      setProjects([...deduplicated.values()].sort((a, b) => {
        const aOrder = precisionOrder.get(a.id);
        const bOrder = precisionOrder.get(b.id);
        if (aOrder !== undefined || bOrder !== undefined) return (aOrder ?? Number.MAX_SAFE_INTEGER) - (bOrder ?? Number.MAX_SAFE_INTEGER);
        return b.savedAt - a.savedAt;
      }));
    } catch { projectsLoadedRef.current = false; /* A project list failure must never block opening the workbench. */ }
  };

  useEffect(() => {
    const resourceId = query.get("resourceId") ?? undefined;
    const documentId = query.get("documentId") ?? undefined;
    const displayMode = query.get("view") === "detail" ? "reference" : "brep";
    try {
      // A plain /cad entry is the user's "new free modeling" action.  Do not
      // silently restore the last (potentially very large) factory model here:
      // that made the workbench appear frozen before the user selected a job.
      const hasExplicitProject = Boolean(resourceId || documentId);
      const session = hasExplicitProject ? loadCadDocumentHandoff(window.sessionStorage, { resourceId, documentId }) : undefined;
      const persistent = session ?? (hasExplicitProject ? loadCadDocumentHandoff(window.localStorage, { resourceId, documentId }) : undefined);
      const resolvedResourceId = resourceId ?? (persistent ? inferLegacyResourceId(persistent.document.name) : undefined);
      const isKnownPrecisionResource = Boolean(resolvedResourceId && highDetailResourceIds.includes(resolvedResourceId as (typeof highDetailResourceIds)[number]));
      const hasCurrentPrecisionDocument = !isKnownPrecisionResource || persistent?.document.id === `cad-resource-${resolvedResourceId}-precision-v2`;
      const obsoleteGeneratedDocument = persistent ? isObsoleteGeneratedCadDocument(persistent.document, persistent.record.sourceResourceId, currentPrecisionDocumentIds) : false;
      if (persistent && hasCurrentPrecisionDocument && !obsoleteGeneratedDocument) {
        // Hydrate the client from the browser's handoff store once on mount.
        // This is an external-storage synchronization, not derived render state.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setDocument(persistent.document);
        setProjects([{ id: persistent.document.id, name: persistent.document.name, savedAt: persistent.record.savedAt, sourceResourceId: persistent.record.sourceResourceId }]);
        setNotice(resourceId
          ? `${displayMode === "reference" ? "精细模型展示" : "自由建模"}：${persistent.document.name}`
          : `已恢复 CAD Document：${persistent.document.name}`);
        pruneObsoleteResourceCadDocuments(window.sessionStorage, currentPrecisionDocumentIds);
        pruneObsoleteResourceCadDocuments(window.localStorage, currentPrecisionDocumentIds);
      } else if (isKnownPrecisionResource) {
        // A resource card may be opened in a fresh browser profile (or after
        // its old handoff was cleared). Rebuild the authored precision
        // document directly instead of falling back to the legacy primitive
        // workbench. Persist it so the project switcher and later sessions use
        // the same feature-driven document.
        const generated = createHighDetailResourceCadDocument(resolvedResourceId!);
        if (!generated) throw new Error("精细模型定义不存在");
        saveCadDocumentHandoff(window.sessionStorage, generated, { sourceResourceId: resolvedResourceId });
        saveCadDocumentHandoff(window.localStorage, generated, { sourceResourceId: resolvedResourceId });
        pruneObsoleteResourceCadDocuments(window.sessionStorage, currentPrecisionDocumentIds);
        pruneObsoleteResourceCadDocuments(window.localStorage, currentPrecisionDocumentIds);
        setDocument(generated);
        setProjects([{ id: generated.id, name: generated.name, savedAt: generated.updatedAt, sourceResourceId: resolvedResourceId }]);
        setNotice(`${displayMode === "reference" ? "精细模型展示" : "自由建模"}：${generated.name}`);
      } else if (!hasExplicitProject) {
        pruneObsoleteResourceCadDocuments(window.sessionStorage, currentPrecisionDocumentIds);
        pruneObsoleteResourceCadDocuments(window.localStorage, currentPrecisionDocumentIds);
        const blank = createUnifiedCadDocument("未命名自由建模项目");
        setDocument(blank);
        setProjects([{ id: blank.id, name: blank.name, savedAt: blank.updatedAt }]);
        setNotice("已打开空白自由建模项目；可以新建草图、实体或使用需求建模 Agent。");
      } else if (obsoleteGeneratedDocument) {
        pruneObsoleteResourceCadDocuments(window.sessionStorage, currentPrecisionDocumentIds);
        pruneObsoleteResourceCadDocuments(window.localStorage, currentPrecisionDocumentIds);
        const blank = createUnifiedCadDocument("未命名自由建模项目");
        setDocument(blank);
        setProjects([{ id: blank.id, name: blank.name, savedAt: blank.updatedAt }]);
        setNotice("旧版组合模型已清理；请选择上方工作项目中的精细模型继续。");
      } else {
        pruneObsoleteResourceCadDocuments(window.sessionStorage, currentPrecisionDocumentIds);
        pruneObsoleteResourceCadDocuments(window.localStorage, currentPrecisionDocumentIds);
        setNotice("未找到指定的 CAD 项目；请从工作项目列表选择，或返回资源库重新进入。");
      }
    } catch (error) {
      setNotice(`CAD 会话恢复失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setReady(true);
    }
  }, [query]);

  if (!ready) return <main className="cad-loading">正在恢复 ForgeMind CAD…</main>;

  const displayMode = query.get("view") === "detail" ? "reference" : "brep";
  const referenceResourceId = document ? Object.values(document.bodies).map((body) => body.sourceResource?.resourceId).find((resourceId): resourceId is string => Boolean(resourceId && resourceReferenceAssets[resourceId])) : undefined;

  return <main className="cad-route">
    <header className="cad-route-header">
      <button type="button" onClick={() => { window.location.href = "/?screen=library"; }}>← 返回资源库</button>
      <div className="cad-route-brand"><b>FORGEMIND</b><span>自由建模 / PART STUDIO</span></div>
      <label className="cad-route-project-switch">工作项目<select value={document?.id ?? ""} onFocus={loadAvailableProjects} onPointerDown={loadAvailableProjects} onChange={(event) => { const project = projects.find((entry) => entry.id === event.target.value); if (project) openProjectWithoutReload(project); }}><option value="" disabled>选择项目</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
      {referenceResourceId && <div className="cad-route-view-switch" aria-label="模型显示方式">
        <button type="button" className={displayMode === "brep" ? "active" : ""} onClick={() => { const next = new URLSearchParams(query); next.delete("view"); window.location.href = `/cad?${next.toString()}`; }}>可编辑模型</button>
        <button type="button" className={displayMode === "reference" ? "active" : ""} onClick={() => { const next = new URLSearchParams(query); next.set("view", "detail"); window.location.href = `/cad?${next.toString()}`; }}>高精细展示</button>
      </div>}
      <span className="cad-route-notice">{notice}</span>
      <span className="cad-route-status"><i /> 本地设计模式</span>
    </header>
    <OcctKernelDebug embedded initialDocument={document} initialNotice={notice} displayMode={displayMode} referenceAssetPath={referenceResourceId ? resourceReferenceAssets[referenceResourceId] : undefined} />
  </main>;
}
