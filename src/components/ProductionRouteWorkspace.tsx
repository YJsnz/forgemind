import { useEffect, useMemo, useState } from 'react'
import { useForgeMindStore } from '../store/forgeMind'
import type { Recipe, RecipePort } from '../game/item'

interface ProductionRouteWorkspaceProps {
  onClose: () => void
}

export function ProductionRouteWorkspace({ onClose }: ProductionRouteWorkspaceProps) {
  const items = useForgeMindStore((state) => state.items)
  const recipes = useForgeMindStore((state) => state.recipes)
  const addRecipe = useForgeMindStore((state) => state.addRecipe)
  const removeRecipe = useForgeMindStore((state) => state.removeRecipe)
  const [selectedId, setSelectedId] = useState(recipes[0]?.id ?? '')
  const [createOpen, setCreateOpen] = useState(false)

  useEffect(() => {
    if (selectedId && recipes.some((recipe) => recipe.id === selectedId)) return
    setSelectedId(recipes[0]?.id ?? '')
  }, [recipes, selectedId])

  const selected = useMemo(
    () => recipes.find((recipe) => recipe.id === selectedId) ?? recipes[0],
    [recipes, selectedId],
  )

  return (
    <section className="fm-route-workspace glass3d" aria-label="生产路线工作区">
      <header className="fm-route-header">
        <div>
          <span className="fm-production-kicker"><i>05</i> / PROCESS DEFINITION / RECIPE FLOW</span>
          <h1>配方与工艺路线</h1>
          <p>定义输入、输出和处理时间；仿真会直接读取这里的生产关系。</p>
        </div>
        <div className="fm-route-header-actions">
          <span>{recipes.length.toString().padStart(2, '0')} RECIPES</span>
          <button type="button" className="fm-route-primary" onClick={() => setCreateOpen(true)}>＋ 新建配方</button>
          <button type="button" className="fm-route-close" onClick={onClose} aria-label="关闭生产路线">×</button>
        </div>
      </header>

      <div className="fm-route-layout">
        <section className="fm-route-panel fm-route-list-panel">
          <div className="fm-route-panel-heading"><span>RECIPE CATALOG</span><b>生产配方</b></div>
          <div className="fm-route-list">
            {recipes.map((recipe, index) => (
              <button key={recipe.id} type="button" className={selected?.id === recipe.id ? 'is-active' : ''} onClick={() => setSelectedId(recipe.id)}>
                <span className="fm-route-index">{String(index + 1).padStart(2, '0')}</span>
                <span className="fm-route-list-name"><strong>{recipe.name}</strong><small>{recipe.id.toUpperCase()}</small></span>
                <em>参与仿真</em>
              </button>
            ))}
            {recipes.length === 0 && <div className="fm-route-empty">还没有配方。创建第一条输入→输出关系。</div>}
          </div>
        </section>

        <section className="fm-route-panel fm-route-detail-panel">
          <div className="fm-route-panel-heading"><span>RECIPE DEFINITION</span><b>{selected?.name ?? '请选择配方'}</b></div>
          {selected ? <RecipeDetail recipe={selected} items={items} onDelete={() => removeRecipe(selected.id)} /> : <div className="fm-route-empty fm-route-empty-large">从左侧选择配方，查看输入、处理周期和输出。</div>}
        </section>

        <section className="fm-route-panel fm-route-flow-panel">
          <div className="fm-route-panel-heading"><span>MATERIAL FLOW</span><b>当前工艺链</b></div>
          <div className="fm-route-flow-list">
            {recipes.map((recipe, index) => (
              <div key={recipe.id} className="fm-route-flow-step">
                <span className="fm-route-flow-node"><i>{String(index + 1).padStart(2, '0')}</i>{lineSummary(recipe.inputs, items)}</span>
                <span className="fm-route-flow-connector"><b>→</b><small>{recipe.durationSec}s</small></span>
                <span className="fm-route-flow-node is-output">{lineSummary(recipe.outputs, items)}</span>
              </div>
            ))}
            {recipes.length === 0 && <div className="fm-route-empty">暂无工艺链。</div>}
          </div>
          <div className="fm-route-audit"><b>执行口径</b><span>配方定义业务加工关系，设备在生产控制台中绑定并执行。</span></div>
        </section>
      </div>

      {createOpen && <RecipeCreateDialog items={items} onClose={() => setCreateOpen(false)} onCreate={(name, inputs, outputs, duration) => { addRecipe(name, inputs, outputs, duration); setCreateOpen(false) }} />}
    </section>
  )
}

function RecipeDetail({ recipe, items, onDelete }: { recipe: Recipe; items: ReturnType<typeof useForgeMindStore.getState>['items']; onDelete: () => void }) {
  return (
    <div className="fm-route-detail">
      <p className="fm-route-detail-copy">{recipe.name} 将输入物料转化为输出物料，并在仿真中作为机器可绑定的工艺关系。</p>
      <div className="fm-route-definition">
        <RouteGroup label="INPUT / 输入" lines={recipe.inputs} items={items} />
        <div className="fm-route-process"><span>处理周期</span><strong>{recipe.durationSec} 秒</strong><small>标准处理时间</small></div>
        <div className="fm-route-arrow">→</div>
        <RouteGroup label="OUTPUT / 输出" lines={recipe.outputs} items={items} output />
      </div>
      <dl className="fm-route-meta">
        <div><dt>配方编码</dt><dd>{recipe.id}</dd></div>
        <div><dt>输入种类</dt><dd>{recipe.inputs.length}</dd></div>
        <div><dt>输出种类</dt><dd>{recipe.outputs.length}</dd></div>
        <div><dt>运行状态</dt><dd>参与仿真</dd></div>
      </dl>
      <footer className="fm-route-detail-actions"><span>修改配方请从当前数据模型重新创建关系</span><button type="button" onClick={onDelete}>删除配方</button></footer>
    </div>
  )
}

function RouteGroup({ label, lines, items, output = false }: { label: string; lines: RecipePort[]; items: ReturnType<typeof useForgeMindStore.getState>['items']; output?: boolean }) {
  return <div className={`fm-route-group ${output ? 'is-output' : ''}`}><span>{label}</span>{lines.map((line, index) => <div key={`${line.itemId}-${index}`}><strong>{itemName(items, line.itemId)}</strong><small>× {line.qty}</small></div>)}</div>
}

function RecipeCreateDialog({ items, onClose, onCreate }: { items: ReturnType<typeof useForgeMindStore.getState>['items']; onClose: () => void; onCreate: (name: string, inputs: RecipePort[], outputs: RecipePort[], duration: number) => void }) {
  const [name, setName] = useState('新工艺配方')
  const [duration, setDuration] = useState(12)
  const [inputItem, setInputItem] = useState(items[0]?.id ?? '')
  const [outputItem, setOutputItem] = useState(items[1]?.id ?? items[0]?.id ?? '')
  const [inputQty, setInputQty] = useState(1)
  const [outputQty, setOutputQty] = useState(1)
  const valid = Boolean(name.trim() && inputItem && outputItem && duration > 0)

  return <div className="fm-route-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="fm-route-modal" role="dialog" aria-modal="true" aria-label="新建配方">
      <header><div><span>PROCESS DEFINITION / NEW</span><h2>新建配方</h2></div><button type="button" onClick={onClose} aria-label="关闭新建配方">×</button></header>
      {items.length === 0 ? <p className="fm-route-empty">当前没有可引用的物品，请先在建造与物品配置中准备物料。</p> : <form onSubmit={(event) => { event.preventDefault(); if (valid) onCreate(name.trim(), [{ itemId: inputItem, qty: inputQty }], [{ itemId: outputItem, qty: outputQty }], duration) }}>
        <label>配方名称<input value={name} onChange={(event) => setName(event.target.value)} /></label>
        <div className="fm-route-form-grid">
          <label>输入物品<select value={inputItem} onChange={(event) => setInputItem(event.target.value)}>{items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>输入数量<input type="number" min={1} value={inputQty} onChange={(event) => setInputQty(Math.max(1, Number(event.target.value)))} /></label>
          <label>输出物品<select value={outputItem} onChange={(event) => setOutputItem(event.target.value)}>{items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>输出数量<input type="number" min={1} value={outputQty} onChange={(event) => setOutputQty(Math.max(1, Number(event.target.value)))} /></label>
        </div>
        <label>处理时间（秒）<input type="number" min={0.1} step={0.1} value={duration} onChange={(event) => setDuration(Math.max(0.1, Number(event.target.value)))} /></label>
        <footer><button type="button" onClick={onClose}>取消</button><button type="submit" disabled={!valid}>创建并启用</button></footer>
      </form>}
    </section>
  </div>
}

function itemName(items: ReturnType<typeof useForgeMindStore.getState>['items'], id: string) {
  return items.find((item) => item.id === id)?.name ?? id
}

function lineSummary(lines: RecipePort[], items: ReturnType<typeof useForgeMindStore.getState>['items']) {
  return lines.map((line) => `${itemName(items, line.itemId)}×${line.qty}`).join(' + ') || '未绑定'
}
