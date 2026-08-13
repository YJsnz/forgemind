import { useMemo, useState } from 'react'
import { FactoryCanvas, type FactoryView } from './scene/FactoryCanvas'
import { LeftPanel } from './components/LeftPanel'
import { InfoPanel } from './components/InfoPanel'
import { SimPanel } from './components/SimPanel'
import { SimulationRunner } from './game/SimulationRunner'
import { useForgeMindStore } from './store/forgeMind'
import { isMachineType, isTransportType, objectRole } from './game/types'

const VIEW_META: Record<FactoryView, { code: string; label: string; title: string; description: string }> = {
  overview: {
    code: '01',
    label: '总览',
    title: '工业基地总览',
    description: '以基地级视角查看设施布局、生产能力与运行态势。',
  },
  build: {
    code: '02',
    label: '建造',
    title: '工建选址模式',
    description: '切换到网格建造视角，拖拽镜头并放置生产设施。',
  },
  flow: {
    code: '03',
    label: '生产',
    title: '生产连接模式',
    description: '沿着生产链查看物料流向、机器状态与实时产出。',
  },
  diagnostics: {
    code: '04',
    label: '诊断',
    title: 'AI 工厂诊断',
    description: '聚焦瓶颈、利用率和仿真指标，为下一次优化提供依据。',
  },
}

const VIEW_ORDER: FactoryView[] = ['overview', 'build', 'flow', 'diagnostics']

function App() {
  const [view, setView] = useState<FactoryView>('overview')
  const objects = useForgeMindStore((s) => s.objects)
  const items = useForgeMindStore((s) => s.items)
  const recipes = useForgeMindStore((s) => s.recipes)
  const snapshot = useForgeMindStore((s) => s.simSnapshot)
  const playing = useForgeMindStore((s) => s.simPlaying)
  const buildType = useForgeMindStore((s) => s.buildType)
  const setBuildType = useForgeMindStore((s) => s.setBuildType)

  const changeView = (next: FactoryView) => {
    setView(next)
    if (next !== 'build') setBuildType(null)
  }

  const counts = useMemo(() => ({
    machines: objects.filter((o) => isMachineType(o.type)).length,
    conveyors: objects.filter((o) => isTransportType(o.type)).length,
    sources: objects.filter((o) => objectRole(o.type) === 'source').length,
  }), [objects])

  const meta = VIEW_META[view]
  const activeTool = buildType ? '建造工具已启用' : '浏览与选择'

  return (
    <div className="fm-shell">
      <SimulationRunner />

      <header className="fm-topbar">
        <div className="fm-brand-block">
          <div className="fm-brand-mark">FM</div>
          <div>
            <div className="fm-brand-name">FORGEMIND</div>
            <div className="fm-brand-sub">DIGITAL FACTORY / 01</div>
          </div>
        </div>

        <div className="fm-facility-status">
          <span className="fm-live-dot" />
          <span>基地 A-01</span>
          <span className="fm-status-divider" />
          <span className="fm-muted">数字孪生已同步</span>
        </div>

        <nav className="fm-view-switcher" aria-label="视角切换">
          {VIEW_ORDER.map((key) => {
            const item = VIEW_META[key]
            return (
              <button
                key={key}
                className={`fm-view-tab ${view === key ? 'is-active' : ''}`}
                   onClick={() => changeView(key)}
                aria-pressed={view === key}
              >
                <span className="fm-view-code">{item.code}</span>
                <span>{item.label}</span>
              </button>
            )
          })}
        </nav>

        <div className="fm-top-actions">
          <button className="fm-icon-button" title="帮助">?</button>
          <button className="fm-icon-button" title="设置">⚙</button>
          <div className="fm-user-chip"><span /> OPERATOR</div>
        </div>
      </header>

      <div className="fm-body">
        <aside className="fm-rail" aria-label="工作区导航">
          <div className="fm-rail-group">
            <div className="fm-rail-caption">WORKSPACE</div>
            {VIEW_ORDER.map((key) => {
              const item = VIEW_META[key]
              return (
                <button
                  key={key}
                  className={`fm-rail-item ${view === key ? 'is-active' : ''}`}
                  onClick={() => changeView(key)}
                >
                  <span className="fm-rail-icon">{key === 'overview' ? '⌂' : key === 'build' ? '⊞' : key === 'flow' ? '⇢' : '◌'}</span>
                  <span>{item.label}</span>
                </button>
              )
            })}
          </div>
          <div className="fm-rail-bottom">
            <button className="fm-rail-item"><span className="fm-rail-icon">⌁</span><span>系统</span></button>
            <div className="fm-rail-version">BUILD<br />0.1.0</div>
          </div>
        </aside>

        <main className="fm-main">
          <section className="fm-viewport" aria-label="3D 工厂视口">
            <FactoryCanvas view={view} />

            <div className="fm-viewport-header">
              <div>
                <div className="fm-eyebrow"><span>{meta.code}</span> / LIVE VIEW</div>
                <h1>{meta.title}</h1>
                <p>{meta.description}</p>
              </div>
              <div className="fm-view-readout">
                <span className="fm-readout-label">CAMERA</span>
                <strong>{view === 'build' || view === 'diagnostics' ? 'TOP-DOWN' : view === 'flow' ? 'FLOW AXIS' : 'ISOMETRIC'}</strong>
              </div>
            </div>

            <div className="fm-viewport-tools">
              <span className="fm-coord-label">X 00.0 &nbsp; Y 00.0 &nbsp; Z 00.0</span>
              <span className="fm-grid-label">GRID / 1M</span>
            </div>

            <div className="fm-viewport-footer">
              <div className="fm-key-hint"><kbd>R</kbd> 旋转组件 <kbd>ESC</kbd> 退出建造</div>
              <div className={`fm-run-state ${playing ? 'is-running' : ''}`}><span /> {playing ? '仿真运行中' : '仿真已暂停'}</div>
            </div>

            <div className="fm-view-dock" aria-label="快速视角">
              {VIEW_ORDER.map((key) => (
                 <button key={key} className={view === key ? 'is-active' : ''} onClick={() => changeView(key)}>
                  <span>{VIEW_META[key].code}</span>{VIEW_META[key].label}
                </button>
              ))}
            </div>
          </section>

          <section className="fm-kpi-strip" aria-label="工厂关键指标">
            <Kpi label="生产效率" value={snapshot.timeSec > 0 ? '92.3%' : '—'} trend="+4.8%" tone="amber" />
            <Kpi label="设备利用率" value={counts.machines ? '78.6%' : '—'} trend={`${counts.machines} 台设备`} />
            <Kpi label="实时产出" value={String(Object.values(snapshot.stats.produced).reduce((sum, value) => sum + value, 0))} trend="units / min" />
            <Kpi label="物流负载" value={counts.conveyors ? '64%' : '—'} trend={`${counts.conveyors} 条线路`} tone="cyan" />
            <div className="fm-kpi-context"><span className="fm-context-dot" /> {activeTool}</div>
          </section>
        </main>

        <aside className="fm-right-panel" aria-label="数据面板">
          <div className="fm-panel-heading">
            <div><span className="fm-eyebrow">FACTORY STATUS</span><h2>基地运行舱</h2></div>
            <span className="fm-panel-index">A-01</span>
          </div>
          <div className="fm-stat-grid">
            <MiniStat label="设施" value={objects.length} />
            <MiniStat label="物品" value={items.length} />
            <MiniStat label="配方" value={recipes.length} />
            <MiniStat label="物流" value={counts.sources + counts.conveyors} />
          </div>
          <div className="fm-panel-rule" />
          <div className="fm-panel-scroll">
            <SimPanel />
            <div className="fm-panel-rule" />
            <InfoPanel />
          </div>
        </aside>
      </div>

      <aside className={`fm-left-panel ${view === 'build' ? 'is-build' : 'is-overview'}`} aria-label={view === 'build' ? '建造与配置' : '当前视图概览'}>
        <div className="fm-left-panel-head">
          <div><span className="fm-eyebrow">{view === 'build' ? 'CONTROL DECK' : 'VIEW BRIEF'}</span><h2>{view === 'build' ? '工厂配置' : `${meta.label}概览`}</h2></div>
          <span className="fm-panel-index">{view === 'build' ? 'EDIT' : meta.code}</span>
        </div>
        {view === 'build' ? <LeftPanel focus="build" /> : <ViewSummary view={view} counts={counts} />}
      </aside>
    </div>
  )
}

function Kpi({ label, value, trend, tone = 'default' }: { label: string; value: string; trend: string; tone?: 'default' | 'amber' | 'cyan' }) {
  return <div className={`fm-kpi ${tone}`}><span>{label}</span><strong>{value}</strong><small>{trend}</small></div>
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return <div className="fm-mini-stat"><span>{label}</span><strong>{value.toString().padStart(2, '0')}</strong></div>
}

function ViewSummary({ view, counts }: { view: FactoryView; counts: { machines: number; conveyors: number; sources: number } }) {
  const copy: Record<FactoryView, { lead: string; items: string[] }> = {
    overview: { lead: '基地正在以设备、物流和产能三个层面汇总运行状态。选择设备可查看端口与配方。', items: ['设备健康度', `${counts.machines} 台加工单元在线`, `${counts.conveyors} 条物流段`, '点击视口中的设备查看详情'] },
    build: { lead: '', items: [] },
    flow: { lead: '物流视图突出显示入口、出口和物料运动方向。输送带按箭头方向逐段传递货物。', items: ['入口 / 蓝色端口', '出口 / 琥珀端口', '货物沿连接方向移动', '切换到建造页编辑线路'] },
    diagnostics: { lead: '诊断视图聚焦节拍、堵塞和设备利用率，为下一轮布局优化提供依据。', items: ['检查无配方设备', '定位输送带末端堵塞', '观察实时利用率', '使用右侧仿真控制'] },
  }
  const data = copy[view]
  return <div className="fm-view-summary"><p>{data.lead}</p><div className="fm-summary-list">{data.items.map((item) => <div key={item}><span />{item}</div>)}</div><div className="fm-summary-foot">{view === 'flow' ? 'FLOW AXIS / CONNECTED PORTS' : view === 'diagnostics' ? 'DIAGNOSTICS / LIVE SIGNAL' : 'OVERVIEW / LIVE SIGNAL'}</div></div>
}

export default App
