import { FACTORY_FLOORS } from '../scene/FactoryFloorSystem'
import type { FactoryFloorId } from '../game/types'

export function FloorSwitcher({ activeFloor, onChange }: { activeFloor: FactoryFloorId; onChange: (floor: FactoryFloorId) => void }) {
  const current = FACTORY_FLOORS.find((floor) => floor.id === activeFloor) ?? FACTORY_FLOORS[0]
  return (
    <div className="fm-floor-switcher" aria-label="楼层切换">
      <div className="fm-floor-switcher-head">
        <span>VERTICAL GRID</span>
        <b>{String(activeFloor).padStart(2, '0')} / 03</b>
      </div>
      <div className="fm-floor-switcher-list">
        {FACTORY_FLOORS.map((floor) => (
          <button
            key={floor.id}
            type="button"
            className={floor.id === activeFloor ? 'is-active' : ''}
            aria-pressed={floor.id === activeFloor}
            onClick={() => onChange(floor.id)}
          >
            <span>{floor.code}</span>
            <strong>{floor.name}</strong>
          </button>
        ))}
      </div>
      <div className="fm-floor-switcher-foot">
        <strong>{current.description}</strong>
        <span>{current.elevation.toFixed(1)}M DATUM / ACTIVE VIEW</span>
      </div>
    </div>
  )
}
