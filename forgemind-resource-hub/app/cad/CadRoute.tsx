"use client";

import { useEffect, useMemo, useState } from "react";
import type { CadDocument } from "../../core/cad/CadDocument";
import { listCadDocumentHandoffs, loadCadDocumentHandoff, type StoredCadDocumentSummary } from "../../core/cad/CadDocumentStore";
import type { Feature } from "../../core/features/Feature";
import type { Sketch } from "../../core/sketch/Sketch";
import { OcctKernelDebug } from "../kernel-debug/OcctKernelDebug";

const resourceReferenceAssets: Record<string, string> = {
  cnc: "/models/industrial/cnc_machining_center.glb",
  robot: "/models/industrial/robot_cell.glb",
  press: "/models/industrial/hydraulic_press_detail.glb",
  buffer: "/models/industrial/pallet_buffer_detail.glb",
};

export function CadRoute() {
  const [document, setDocument] = useState<CadDocument<Sketch, Feature>>();
  const [notice, setNotice] = useState("正在恢复专业 CAD 会话…");
  const [ready, setReady] = useState(false);
  const [projects, setProjects] = useState<StoredCadDocumentSummary[]>([]);
  const query = useMemo(() => typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search), []);

  useEffect(() => {
    const resourceId = query.get("resourceId") ?? undefined;
    const documentId = query.get("documentId") ?? undefined;
    const displayMode = query.get("view") === "detail" ? "reference" : "brep";
    try {
      const session = loadCadDocumentHandoff(window.sessionStorage, { resourceId, documentId, latest: !resourceId && !documentId });
      const persistent = session ?? loadCadDocumentHandoff(window.localStorage, { resourceId, documentId, latest: !resourceId && !documentId });
      if (persistent) {
        // Hydrate the client from the browser's handoff store once on mount.
        // This is an external-storage synchronization, not derived render state.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setDocument(persistent.document);
        setNotice(resourceId
          ? `${displayMode === "reference" ? "精细模型展示" : "自由建模"}：${persistent.document.name}`
          : `已恢复 CAD Document：${persistent.document.name}`);
      } else {
        setNotice("未找到可恢复的 CAD Document；可以从空白 Part Studio 新建草图/拉伸，或从 Resource Hub 重新进入。");
      }
      const combined = [...listCadDocumentHandoffs(window.sessionStorage), ...listCadDocumentHandoffs(window.localStorage)];
      const deduplicated = new Map<string, StoredCadDocumentSummary>();
      combined.forEach((project) => { const previous = deduplicated.get(project.id); if (!previous || project.savedAt > previous.savedAt) deduplicated.set(project.id, project); });
      setProjects([...deduplicated.values()].sort((a, b) => b.savedAt - a.savedAt));
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
      <label className="cad-route-project-switch">工作项目<select value={document?.id ?? ""} onChange={(event) => { const id = event.target.value; if (id) window.location.href = `/cad?mode=part&documentId=${encodeURIComponent(id)}`; }}><option value="" disabled>选择项目</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
      <span className="cad-route-notice">{notice}</span>
      <span className="cad-route-status"><i /> 本地设计模式</span>
    </header>
    <OcctKernelDebug embedded initialDocument={document} initialNotice={notice} displayMode={displayMode} referenceAssetPath={referenceResourceId ? resourceReferenceAssets[referenceResourceId] : undefined} />
  </main>;
}
