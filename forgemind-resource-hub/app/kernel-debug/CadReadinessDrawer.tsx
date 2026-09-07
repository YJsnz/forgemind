import type { CadEngineeringReadinessReport } from "../../core/engineering/CadEngineeringReadiness";

type CadReadinessDrawerProps = {
  open: boolean;
  report: CadEngineeringReadinessReport;
  busy: boolean;
  hasDocument: boolean;
  onClose: () => void;
  onExport: () => void;
};

export function CadReadinessDrawer({ open, report, busy, hasDocument, onClose, onExport }: CadReadinessDrawerProps) {
  if (!open) return null;
  return <aside className="cad-readiness-drawer" aria-label="工程就绪检查">
    <header><div><p>ENGINEERING READINESS</p><strong>工程就绪检查</strong></div><button type="button" onClick={onClose} aria-label="关闭工程检查">×</button></header>
    <div className="cad-readiness-score"><strong>{report.score}</strong><span>%<small>当前完成度</small></span></div>
    <div className="cad-readiness-list">{report.checks.map((check) => <article key={check.id} className={check.passed ? "is-passed" : "is-pending"}><b>{check.passed ? "✓" : "!"}</b><div><strong>{check.label}</strong><span>{check.detail}</span></div></article>)}</div>
    {report.issues.length ? <section className="cad-readiness-issues"><strong>需要留意</strong>{report.issues.slice(0,12).map((issue,index)=><article key={`${issue.code}-${issue.featureId??issue.bodyId??index}`} data-severity={issue.severity}><b>{issue.severity==="error"?"错误":issue.severity==="warning"?"建议":"信息"}</b><span>{issue.message}</span></article>)}</section> : <p className="cad-readiness-clear">当前未发现阻止交付的问题。</p>}
    <p className="cad-readiness-note">设计预检，不替代正式工程图、强度分析、装配干涉和制造工艺验证。</p>
    <button type="button" className="cad-readiness-export" onClick={onExport} disabled={busy || !hasDocument}>保存并导出 CAD 项目</button>
  </aside>;
}
