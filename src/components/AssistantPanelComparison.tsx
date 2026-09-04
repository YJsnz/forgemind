import type { AssistantPanelId } from '../game/assistantProtocol'

const PANEL_LABELS: Record<AssistantPanelId, string> = {
  'factory-overview': '工厂总览',
  simulation: '仿真控制',
  'object-detail': '对象详情',
  production: '生产资料',
  logistics: '物流视图',
  warehouse: '货物仓储',
  'agent-diagnosis': 'Agent 诊断',
  'generative-planner': '生成式规划',
  inspection: '巡检报告',
  'cloud-runtime': '云端运行舱',
  'activity-history': '活动历史',
}

export function AssistantPanelComparison({
  leftPanelId,
  rightPanelId,
  onClose,
  onOpen,
}: {
  leftPanelId: AssistantPanelId
  rightPanelId: AssistantPanelId
  onClose: () => void
  onOpen: (panelId: AssistantPanelId) => void
}) {
  const panels = [leftPanelId, rightPanelId]
  return (
    <section className="fm-assistant-compare" role="dialog" aria-modal="false" aria-label="助手并排比较视图">
      <header className="fm-assistant-compare-head">
        <div><span>BT / PANEL COMPARE</span><h2>并排比较工作区</h2><p>两侧共享当前工厂上下文，可进入任一完整面板继续操作。</p></div>
        <button type="button" onClick={onClose} aria-label="关闭并排比较">×</button>
      </header>
      <div className="fm-assistant-compare-grid">
        {panels.map((panelId, index) => (
          <article key={`${panelId}-${index}`} className="fm-assistant-compare-card">
            <span className="fm-assistant-compare-index">0{index + 1} / LIVE CONTEXT</span>
            <h3>{PANEL_LABELS[panelId]}</h3>
            <strong>{panelId}</strong>
            <p>已接入当前项目、楼层、仿真和 Agent 上下文。进入面板查看详细数据与操作。</p>
            <button type="button" onClick={() => onOpen(panelId)}>进入此面板 <span>→</span></button>
          </article>
        ))}
      </div>
    </section>
  )
}
