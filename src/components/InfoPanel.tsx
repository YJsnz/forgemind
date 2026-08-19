import { useEffect, useState } from 'react'
import { useForgeMindStore } from '../store/forgeMind'
import { getObjectDef } from '../game/types'
import { Model3DViewer } from './Model3DViewer'
import { StorageContentOverlay } from './StorageContentOverlay'

export function InfoPanel() {
  const selectedId = useForgeMindStore((s) => s.selectedId)
  const objects = useForgeMindStore((s) => s.objects)
  const recipes = useForgeMindStore((s) => s.recipes)
  const items = useForgeMindStore((s) => s.items)
  const rotateObject = useForgeMindStore((s) => s.rotateObject)
  const remove = useForgeMindStore((s) => s.remove)
  const bindRecipe = useForgeMindStore((s) => s.bindRecipe)
  const bindItem = useForgeMindStore((s) => s.bindItem)
  const [show3D, setShow3D] = useState(false)
  const [showStorageQuery, setShowStorageQuery] = useState(false)
  const obj = objects.find((item) => item.id === selectedId)

  useEffect(() => {
    setShowStorageQuery(false)
  }, [selectedId])

  if (!obj) {
    return <div className="fm-inspector fm-inspector-empty"><div className="fm-eyebrow">OBJECT INSPECTOR</div><strong>未选中设备</strong><p>从 3D 工厂中点击设备，查看它的职能、接口和运行状态。</p></div>
  }

  const def = getObjectDef(obj.type, obj.resourceId)
  const machine = def.role === 'machine'
  const source = def.role === 'source'

  return (
    <div className="fm-inspector">
      <div className="fm-inspector-title">
        <div><div className="fm-eyebrow">OBJECT / {obj.id.slice(-6)}</div><h3>{def.label}</h3><span>{def.subtitle}</span></div>
        <div className="fm-inspector-mark" style={{ '--equipment-accent': def.accent } as React.CSSProperties}>{def.model.slice(0, 2).toUpperCase()}</div>
      </div>
      <p className="fm-inspector-function">{def.function}</p>
      <section className="fm-inspector-section">
        <div className="fm-inspector-section-heading"><span>POSITION / CAPACITY</span><b>LIVE DATA</b></div>
        <div className="fm-inspector-specs">
          <Spec label="安装坐标" value={`(${obj.pos.x}, ${obj.pos.z})`} />
          <Spec label="朝向" value={`${obj.rotation}°`} />
          <Spec label="占地" value={`${def.footprint.w} × ${def.footprint.d}`} />
          <Spec label="标准吞吐" value={def.throughput} />
        </div>
      </section>
      {machine && <label className="fm-inspector-field"><span>生产配方 / RECIPE</span><select value={obj.recipeId ?? ''} onChange={(event) => bindRecipe(obj.id, event.target.value || null)}><option value="">未绑定配方</option>{recipes.map((recipe) => <option key={recipe.id} value={recipe.id}>{recipe.name}</option>)}</select></label>}
      {source && <label className="fm-inspector-field"><span>输出物品 / OUTPUT ITEM</span><select value={obj.itemId ?? ''} onChange={(event) => bindItem(obj.id, event.target.value || null)}><option value="">未绑定物品</option>{items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
      <section className="fm-inspector-section fm-inspector-io-section">
        <div className="fm-inspector-section-heading"><span>CONNECTIONS</span><b>ROUTE MAP</b></div>
        <div className="fm-inspector-io"><div><span>INPUT / BLUE</span><b>{def.inputs.join(' · ') || '无'}</b><small>后侧进料口</small></div><div><span>OUTPUT / AMBER</span><b>{def.outputs.join(' · ') || '无'}</b><small>前侧出料口</small></div></div>
      </section>
      {obj.type === 'inspection' && <InspectionEntry />}
      {(obj.type === 'assembler' || obj.type === 'machine') && <RobotWorkPanel />}
      <footer className="fm-inspector-footer">
        <div className="fm-port-legend"><span><i className="fm-port-dot input" />入口 / INPUT</span><span><i className="fm-port-dot output" />出口 / OUTPUT</span></div>
        <div className="fm-inspector-actions"><button onClick={() => rotateObject(obj.id)}><span>TRANSFORM</span>旋转 90°</button><button className="danger" onClick={() => remove(obj.id)}><span>REMOVE UNIT</span>拆除设备</button></div>
      </footer>
      <div className="fm-inspector-extra-actions">
        <button className="fm-3d-btn" onClick={() => setShow3D(true)}>3D 观测</button>
        {def.role === 'storage' && <button className="fm-storage-query-btn" onClick={() => setShowStorageQuery(true)}>内容物查询</button>}
      </div>
      {show3D && <Model3DViewer obj={obj} def={def} onClose={() => setShow3D(false)} />}
      {showStorageQuery && def.role === 'storage' && <StorageContentOverlay obj={obj} label={def.label} onClose={() => setShowStorageQuery(false)} />}
    </div>
  )
}

function InspectionEntry() {
  return <section className="fm-inspection-entry">
    <div className="fm-inspection-entry-head"><div><span className="fm-eyebrow">LIVE INSPECTION</span><strong>视觉检测工作台</strong></div><span className="fm-inspection-entry-led" /></div>
    <p>进入独立检测页，查看夹取臂、摄像头臂和 360° 环绕扫描流程。</p>
    <div className="fm-inspection-entry-tags"><span>双臂协同</span><span>安全隔离</span><span>手动接管</span></div>
    <a className="fm-inspection-entry-button" href="/inspection.html" target="_blank" rel="noreferrer">进入检测详情 <b>↗</b></a>
  </section>
}

function RobotWorkPanel() {
  const [mode, setMode] = useState<'auto' | 'manual'>('auto')
  const [task, setTask] = useState<'sort' | 'weld' | 'assemble'>('sort')
  const [pad, setPad] = useState(false)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === '1') setTask('sort')
      if (event.key === '2') setTask('weld')
      if (event.key === '3') setTask('assemble')
      if (event.key.toLowerCase() === 'm') setMode((value) => value === 'auto' ? 'manual' : 'auto')
      if (event.code === 'Space') window.dispatchEvent(new CustomEvent('forgemind:robot-command', { detail: { action: 'grip', task } }))
    }
    const poll = window.setInterval(() => {
      const gamepads = navigator.getGamepads?.() ?? []
      setPad(Array.from(gamepads).some((gamepad) => Boolean(gamepad?.connected)))
    }, 500)
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey); window.clearInterval(poll) }
  }, [task])

  const activate = (nextMode: 'auto' | 'manual') => {
    setMode(nextMode)
    window.dispatchEvent(new CustomEvent('forgemind:robot-command', { detail: { mode: nextMode, task } }))
  }

  return <div className="fm-robot-work-panel">
    <div className="fm-robot-work-head"><span>ROBOT WORKCELL</span><b>{pad ? 'GAMEPAD READY' : 'KEYBOARD READY'}</b></div>
    <div className="fm-robot-task-row">{(['sort', 'weld', 'assemble'] as const).map((name, index) => <button key={name} className={task === name ? 'is-active' : ''} onClick={() => { setTask(name); window.dispatchEvent(new CustomEvent('forgemind:robot-command', { detail: { task: name, mode } })) }}><strong>0{index + 1}</strong>{name === 'sort' ? '分拣' : name === 'weld' ? '焊接' : '装配'}</button>)}</div>
    <div className="fm-robot-controls"><button className={mode === 'auto' ? 'is-active' : ''} onClick={() => activate('auto')}>自动循环</button><button className={mode === 'manual' ? 'is-active' : ''} onClick={() => activate('manual')}>手动手柄</button></div>
    <div className="fm-robot-hint">
      <div className="fm-robot-hint-grid">
        <span><kbd>左摇杆</kbd><b>末端 XY</b></span>
        <span><kbd>右摇杆</kbd><b>高度 / 偏航</b></span>
        <span><kbd>空格</kbd><b>夹爪</b></span>
      </div>
      <span className="fm-robot-mode">MODE / {mode.toUpperCase()}</span>
    </div>
  </div>
}

function Spec({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><strong>{value}</strong></div>
}
