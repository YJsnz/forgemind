import { lazy, Suspense, type ReactNode } from 'react'

const MachineManufacturingWorkspace = lazy(() => import('./MachineManufacturingWorkspace').then((module) => ({ default: module.MachineManufacturingWorkspace })))
const ItemDetailWorkspace = lazy(() => import('./ItemDetailWorkspace').then((module) => ({ default: module.ItemDetailWorkspace })))
const WarehouseWorkspace = lazy(() => import('./WarehouseWorkspace').then((module) => ({ default: module.WarehouseWorkspace })))

export type FactoryCatalogSection = 'manufacturing' | 'itemDetails' | 'warehouse'

const SECTIONS: Array<{ key: FactoryCatalogSection; code: string; label: string; detail: string }> = [
  { key: 'manufacturing', code: '01', label: '机械制造', detail: '机器定义与模型库' },
  { key: 'itemDetails', code: '02', label: '物品详情', detail: '物品与参数化模型' },
  { key: 'warehouse', code: '03', label: '货物仓储', detail: '库存与运输控制' },
]

export function FactoryCatalogWorkspace({ activeSection, onSectionChange, onClose }: { activeSection: FactoryCatalogSection; onSectionChange: (section: FactoryCatalogSection) => void; onClose: () => void }) {
  return (
    <section className="fm-catalog-workspace" aria-label="生产资料工作区">
      <header className="fm-catalog-workspace-head">
        <div>
          <span className="fm-eyebrow">FACTORY LIBRARY / PRODUCTION DATA</span>
          <h2>生产资料</h2>
          <p>在一个工作台中维护机器、物品和货物仓储，三类资料可以直接互相引用。</p>
        </div>
        <button type="button" className="fm-catalog-workspace-close" onClick={onClose} aria-label="关闭生产资料工作区">×</button>
      </header>
      <nav className="fm-catalog-workspace-tabs" aria-label="生产资料分类">
        {SECTIONS.map((section) => (
          <button key={section.key} type="button" className={activeSection === section.key ? 'is-active' : ''} onClick={() => onSectionChange(section.key)} aria-current={activeSection === section.key ? 'page' : undefined}>
            <span>{section.code}</span>
            <strong>{section.label}</strong>
            <small>{section.detail}</small>
          </button>
        ))}
      </nav>
      <main className="fm-catalog-workspace-body">
        <Suspense fallback={<CatalogLoading />}>
          {activeSection === 'manufacturing' && <MachineManufacturingWorkspace embedded onClose={onClose} />}
          {activeSection === 'itemDetails' && <ItemDetailWorkspace embedded onClose={onClose} />}
          {activeSection === 'warehouse' && <WarehouseWorkspace embedded onClose={onClose} />}
        </Suspense>
      </main>
    </section>
  )
}

function CatalogLoading(): ReactNode {
  return <div className="fm-catalog-workspace-loading"><span className="fm-context-dot" /> 正在打开生产资料…</div>
}
