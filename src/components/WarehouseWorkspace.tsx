import { useMemo, useState } from 'react'
import { OBJECT_DEFS } from '../game/types'
import { useForgeMindStore } from '../store/forgeMind'
import { AgvNavigationControl } from './AgvNavigationControl'

interface WarehouseWorkspaceProps {
  onClose: () => void
}

/**
 * ForgeCore 仓储语义在 ForgeMind 中的轻量映射：货物仓库/原料货架、
 * 内容物、运输层和运行中在途物料都从当前场地状态读取，避免另起一套存档。
 */
export function WarehouseWorkspace({ onClose }: WarehouseWorkspaceProps) {
  const [tab, setTab] = useState<'inventory' | 'navigation'>('inventory')
  const objects = useForgeMindStore((state) => state.objects)
  const items = useForgeMindStore((state) => state.items)
  const snapshot = useForgeMindStore((state) => state.simSnapshot)
  const select = useForgeMindStore((state) => state.select)

  const storageObjects = useMemo(
    () => objects.filter((object) => object.type === 'storage' || object.type === 'oreMiner'),
    [objects],
  )
  const agvCount = objects.filter((object) => object.type === 'agv').length
  const droneCount = objects.filter((object) => object.type === 'drone').length
  const movingAgvCount = snapshot.agvs.filter((agv) => agv.motionStatus === 'moving').length
  const conveyorCount = objects.filter((object) => object.type === 'conveyor').length
  const activityRows = useMemo(() => {
    const ids = new Set([...Object.keys(snapshot.stats.produced), ...Object.keys(snapshot.stats.consumed)])
    return [...ids].map((id) => ({
      id,
      name: items.find((item) => item.id === id)?.name ?? id,
      produced: snapshot.stats.produced[id] ?? 0,
      consumed: snapshot.stats.consumed[id] ?? 0,
    }))
  }, [items, snapshot.stats.consumed, snapshot.stats.produced])

  const selectStorage = (id: string) => {
    select(id)
    onClose()
  }

  const itemForStorage = (object: (typeof storageObjects)[number]) => items.find((item) => item.id === (object.type === 'oreMiner' ? 'item_steel_blank' : 'item_screw'))

  return (
    <section className="fm-warehouse-workspace glass3d" aria-label="仓储工作区">
      <header className="fm-warehouse-header">
        <div>
          <span className="fm-eyebrow"><b>06</b> / STORAGE CONTROL</span>
          <h2>仓储</h2>
          <p>把货物仓库、原料货架与 AGV / 无人机运输统一放在一张库存控制台中。</p>
          <nav className="fm-warehouse-tabs" aria-label="仓储工作区页面">
            <button type="button" className={tab === 'inventory' ? 'is-active' : ''} onClick={() => setTab('inventory')}>库存控制</button>
            <button type="button" className={tab === 'navigation' ? 'is-active' : ''} onClick={() => setTab('navigation')}>导航控制</button>
          </nav>
        </div>
        <button type="button" className="fm-warehouse-close" onClick={onClose} aria-label="关闭仓储工作区">×</button>
      </header>

      {tab === 'navigation' ? <AgvNavigationControl /> : <>
      <div className="fm-warehouse-kpis" aria-label="仓储统计">
        <WarehouseMetric label="货物仓库" value={storageObjects.filter((object) => object.type === 'storage').length} note="WAREHOUSES" />
        <WarehouseMetric label="原料货架" value={storageObjects.filter((object) => object.type === 'oreMiner').length} note="RAW RACKS" />
        <WarehouseMetric label="AGV / 无人机" value={`${agvCount} / ${droneCount}`} note={`${movingAgvCount} 台 AGV 导航中`} />
        <WarehouseMetric label="在途物料" value={snapshot.itemLots.length} note={`${conveyorCount} 条输送线`} />
      </div>

      <div className="fm-warehouse-grid">
        <section className="fm-warehouse-card fm-warehouse-inventory">
          <div className="fm-warehouse-card-head">
            <div><span className="fm-production-label">INVENTORY RECORDS / 01</span><h3>库存位置</h3></div>
            <span>{storageObjects.length.toString().padStart(2, '0')} LOCATIONS</span>
          </div>
          <div className="fm-warehouse-table-wrap">
            <table className="fm-warehouse-table">
              <thead><tr><th>位置</th><th>内容物</th><th>库存状态</th><th>容量</th></tr></thead>
              <tbody>
                {storageObjects.map((object) => {
                  const isRawRack = object.type === 'oreMiner'
                  const item = itemForStorage(object)
                  const content = `${item?.name ?? (isRawRack ? '钢制毛坯' : '螺丝')}*100`
                  return (
                    <tr key={object.id}>
                      <td><button type="button" className="fm-warehouse-location" onClick={() => selectStorage(object.id)}><i className={isRawRack ? 'is-raw' : 'is-finished'} /><span className="fm-warehouse-location-model">{item?.modelPath && <img src={`/models/forgecore/items/previews/${item.modelPath.replace(/\.glb$/u, '.png')}`} alt="" />}<span><b>{OBJECT_DEFS[object.type].label}</b><small>{object.id}</small></span></span></button></td>
                      <td><strong className="fm-warehouse-content">{content}</strong><small className="fm-warehouse-muted">初始库存</small></td>
                      <td><span className="fm-warehouse-state"><i />{isRawRack ? '有限库存' : '可查询'}</span></td>
                      <td><b>{isRawRack ? '∞' : '240'}</b><small>units</small></td>
                    </tr>
                  )
                })}
                {storageObjects.length === 0 && <tr><td colSpan={4} className="fm-warehouse-empty">当前场地还没有仓储设施，请从物流建造菜单放置货架或缓存仓。</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        <section className="fm-warehouse-card fm-warehouse-flow">
          <div className="fm-warehouse-card-head">
            <div><span className="fm-production-label">INTRALOGISTICS / 02</span><h3>运输层</h3></div>
            <span>LIVE LAYERS</span>
          </div>
          <div className="fm-warehouse-layers">
            <div className="fm-warehouse-layer"><span className="fm-warehouse-layer-icon">⇢</span><div><b>传送带</b><small>仓库端口与生产设备之间的固定线路</small></div><strong>{conveyorCount.toString().padStart(2, '0')}</strong></div>
            <div className="fm-warehouse-layer"><span className="fm-warehouse-layer-icon">▰</span><div><b>AGV 地面运输</b><small>{movingAgvCount} 台正在导航 · 原料库 / 线边库 / 成品缓存之间的托盘搬运</small></div><strong>{agvCount.toString().padStart(2, '0')}</strong></div>
            <div className="fm-warehouse-layer"><span className="fm-warehouse-layer-icon">◇</span><div><b>无人机跨层运输</b><small>轻载物料在不同楼层仓库与货架之间转运</small></div><strong>{droneCount.toString().padStart(2, '0')}</strong></div>
          </div>
          <div className="fm-warehouse-flow-note"><span className="fm-context-dot" /><span>库存数量以仓储记录为准，模型中的纸箱和货架只负责空间表现。</span></div>
        </section>

        <section className="fm-warehouse-card fm-warehouse-activity">
          <div className="fm-warehouse-card-head">
            <div><span className="fm-production-label">MATERIAL LEDGER / 03</span><h3>物料台账</h3></div>
            <span>{snapshot.itemLots.length} IN TRANSIT</span>
          </div>
          {activityRows.length > 0 ? <div className="fm-warehouse-ledger">{activityRows.map((row) => <div key={row.id}><span><i />{row.name}</span><b>+{row.produced}</b><small>−{row.consumed}</small></div>)}</div> : <div className="fm-warehouse-ledger-empty">仿真启动后，生产路线中的消耗、产出和在途物料会同步到这里。</div>}
        </section>
      </div>
      </>}
    </section>
  )
}

function WarehouseMetric({ label, value, note }: { label: string; value: number | string; note: string }) {
  return <div className="fm-warehouse-metric"><span>{label}</span><b>{value}</b><small>{note}</small></div>
}
