import { useMemo, useState } from 'react'
import { DRONE_DOCK, DRONE_LIFT_SHAFT, FLOOR_DELIVERY_POINTS, FLOOR_LINE_DOCKS, droneRouteLabels, getDroneRoute } from '../game/droneNavigation'
import { getFloorElevation } from '../scene/FactoryFloorSystem'
import { useForgeMindStore } from '../store/forgeMind'

type DroneTargetFloor = 2 | 3

export function DroneNavigationControl() {
  const objects = useForgeMindStore((state) => state.objects)
  const snapshot = useForgeMindStore((state) => state.simSnapshot)
  const drones = useMemo(() => objects.filter((object) => object.type === 'drone'), [objects])
  const [targetFloor, setTargetFloor] = useState<DroneTargetFloor>(2)
  const target = FLOOR_LINE_DOCKS[targetFloor]
  const deliveryPoints = FLOOR_DELIVERY_POINTS[targetFloor]
  const route = useMemo(() => getDroneRoute(targetFloor, getFloorElevation(targetFloor)), [targetFloor])
  const routeDistance = useMemo(() => route.slice(1).reduce((sum, point, index) => sum + Math.hypot(point[0] - route[index][0], point[1] - route[index][1], point[2] - route[index][2]), 0), [route])
  const labels = droneRouteLabels(targetFloor)
  const liveDrone = snapshot.drones[0]
  const liveStatus = liveDrone
    ? liveDrone.motionStatus === 'moving'
      ? `${liveDrone.phase === 'ascending' ? '垂直上升' : liveDrone.phase === 'to-input' ? `L${liveDrone.targetFloor} 输入点配送` : liveDrone.phase === 'returning' ? '返航中' : '外围环线飞行'} · ${liveDrone.distanceTravelled.toFixed(1)}M`
      : `L1 停靠 · 下一站 L${liveDrone.targetFloor}`
    : '未接入仿真'

  return (
    <section className="fm-drone-control" aria-label="无人机导航控制">
      <div className="fm-drone-control-heading">
        <div>
          <span className="fm-production-label">DRONE NAVIGATION / AIR CARGO</span>
          <h3>无人机导航</h3>
          <p>从 L1 停机位起飞，经固定升降井和外围高位环线，为 L2 / L3 产线输入点配送轻载物料。</p>
        </div>
        <div className="fm-drone-control-summary"><b>{drones.length.toString().padStart(2, '0')}</b><span>DRONES</span><small>{liveStatus}</small></div>
      </div>

      <div className="fm-drone-control-body">
        <aside className="fm-drone-fleet" aria-label="无人机机队">
          <div className="fm-agv-control-subhead"><span>AIR CARGO FLEET</span><b>{drones.length} UNITS</b></div>
          {drones.map((drone) => (
            <div key={drone.id} className="fm-drone-fleet-item">
              <span className="fm-drone-fleet-icon">◇</span>
              <span><b>{drone.id.replace(/^a01_/, 'A01 / ')}</b><small>L1 停靠 · 跨层待命</small></span>
              <i />
            </div>
          ))}
          {drones.length === 0 && <div className="fm-agv-control-empty">当前场地没有货运无人机。</div>}
          <div className="fm-drone-dock-readout"><span>L1 DOCK</span><b>18.5 / −13.5</b><small>固定停靠位 · 升降井前置</small></div>
        </aside>

        <div className="fm-drone-route-panel">
          <div className="fm-drone-target-switcher">
            <span>目标楼层</span>
            <div>{([2, 3] as DroneTargetFloor[]).map((floor) => <button key={floor} type="button" className={targetFloor === floor ? 'is-active' : ''} onClick={() => setTargetFloor(floor)} aria-pressed={targetFloor === floor}>L{floor}<small>{floor === 2 ? '工艺层' : '装配层'}</small></button>)}</div>
          </div>

          <div className="fm-drone-route-flow" aria-label={`L1 到 L${targetFloor} 的无人机路线`}>
            <DroneRouteNode index="01" title="L1 停机位" detail={`X ${DRONE_DOCK[0]} / Z ${DRONE_DOCK[1]}`} />
            <span className="fm-drone-route-arrow">→</span>
            <DroneRouteNode index="02" title="东侧升降井" detail={`X ${DRONE_LIFT_SHAFT[0]} / Z ${DRONE_LIFT_SHAFT[1]}`} accent />
            <span className="fm-drone-route-arrow">⇧</span>
            <DroneRouteNode index="03" title={`L${targetFloor} 物料枢纽`} detail={`X ${target[0]} / Z ${target[1]}`} accent />
          </div>

          <div className="fm-drone-route-designer">
            <div className="fm-drone-route-designer-head"><div><span className="fm-production-label">FIXED AIRWAY / ROUTE PLAN</span><b>L1 → L{targetFloor} 补给航路</b><small>先升降、后环线、再按输入点分流；路线不穿越设备区。</small></div><strong>{routeDistance.toFixed(1)} M</strong></div>
            <div className="fm-drone-route-list">{labels.map((label, index) => <div key={label} className="fm-drone-route-stop"><span>{String(index + 1).padStart(2, '0')}</span><div><b>{label}</b><small>{index < 3 ? '主航路节点' : index < labels.length - 1 ? '外围高位环线' : '楼层物料枢纽'}</small></div><i className={index === labels.length - 1 ? 'is-target' : ''} /></div>)}</div>
            <div className="fm-drone-delivery-points"><span>INPUT DOCKS / {deliveryPoints.length}</span>{deliveryPoints.map(([x, z], index) => <span key={`${x}-${z}`} className="fm-drone-delivery-chip">0{index + 1} · {x} / {z}</span>)}</div>
          </div>

          <div className="fm-drone-live-route"><span>LIVE ROUTE</span><b>{liveStatus}</b><small>三维视图中以自研渲染层显示实体无人机 · 金色外围主航线和青色输入支线 · 目标层高程 {getFloorElevation(targetFloor).toFixed(1)}M</small></div>
        </div>
      </div>
    </section>
  )
}

function DroneRouteNode({ index, title, detail, accent = false }: { index: string; title: string; detail: string; accent?: boolean }) {
  return <div className={`fm-drone-route-node${accent ? ' is-accent' : ''}`}><span>{index}</span><b>{title}</b><small>{detail}</small></div>
}
