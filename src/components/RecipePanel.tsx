import { useState } from 'react'
import { useForgeMindStore } from '../store/forgeMind'
import type { RecipePort } from '../game/item'

/**
 * 配方（Recipe）面板：多输入 → 多输出 + 加工时长（Day 3）。
 */
export function RecipePanel() {
  const items = useForgeMindStore((s) => s.items)
  const recipes = useForgeMindStore((s) => s.recipes)
  const addRecipe = useForgeMindStore((s) => s.addRecipe)
  const removeRecipe = useForgeMindStore((s) => s.removeRecipe)

  const [name, setName] = useState('')
  const [duration, setDuration] = useState('1')
  const [inputs, setInputs] = useState<RecipePort[]>([])
  const [outputs, setOutputs] = useState<RecipePort[]>([])
  const [inItem, setInItem] = useState('')
  const [inQty, setInQty] = useState('1')
  const [outItem, setOutItem] = useState('')
  const [outQty, setOutQty] = useState('1')

  const itemName = (id: string) => items.find((i) => i.id === id)?.name ?? id

  const addInput = () => {
    if (!inItem || Number(inQty) <= 0) return
    setInputs((p) => [...p, { itemId: inItem, qty: Number(inQty) }])
    setInItem('')
    setInQty('1')
  }
  const addOutput = () => {
    if (!outItem || Number(outQty) <= 0) return
    setOutputs((p) => [...p, { itemId: outItem, qty: Number(outQty) }])
    setOutItem('')
    setOutQty('1')
  }

  const reset = () => {
    setName('')
    setDuration('1')
    setInputs([])
    setOutputs([])
  }

  const submit = () => {
    const n = name.trim()
    if (!n || inputs.length === 0 || outputs.length === 0) return
    addRecipe(n, inputs, outputs, Number(duration) || 1)
    reset()
  }

  const portLine = (p: RecipePort, list: RecipePort[], setList: (v: RecipePort[]) => void) => (
    <div className="flex items-center justify-between text-xs">
      <span className="text-[var(--fm-text)]">
        {itemName(p.itemId)} <span className="font-mono text-[var(--fm-text-dim)]">×{p.qty}</span>
      </span>
      <button
        onClick={() => setList(list.filter((x) => x !== p))}
        className="font-mono text-[10px] text-[var(--fm-danger)]"
      >
        ×
      </button>
    </div>
  )

  const selectStyle: React.CSSProperties = {
    borderColor: 'var(--fm-edge)',
    background: 'var(--fm-bg-2)',
    color: 'var(--fm-text)',
  }

  return (
    <div className="flex flex-col gap-3 px-3 py-2">
      {/* 新建表单 */}
      <div className="space-y-2 border-b pb-3" style={{ borderColor: 'var(--fm-edge)' }}>
        <p className="font-mono text-[10px] tracking-widest text-[var(--fm-text-dim)]">
          NEW RECIPE
        </p>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="配方名称"
          className="w-full border bg-transparent px-2 py-1 text-sm text-[var(--fm-text)] outline-none placeholder:text-[var(--fm-text-dim)]"
          style={{ borderColor: 'var(--fm-edge)' }}
        />

        {/* 输入 */}
        <div className="space-y-1">
          <div className="flex gap-1">
            <select
              value={inItem}
              onChange={(e) => setInItem(e.target.value)}
              className="flex-1 border px-1 py-1 text-xs"
              style={selectStyle}
            >
              <option value="">选择输入物品…</option>
              {items.map((i) => (
                <option key={i.id} value={i.id}>{i.name}</option>
              ))}
            </select>
            <input
              value={inQty}
              onChange={(e) => setInQty(e.target.value)}
              className="w-12 border bg-transparent px-1 py-1 text-center font-mono text-xs text-[var(--fm-text)]"
              style={{ borderColor: 'var(--fm-edge)' }}
            />
            <button
              onClick={addInput}
              className="border px-2 text-xs text-[var(--fm-accent)]"
              style={{ borderColor: 'var(--fm-edge)' }}
            >
              +
            </button>
          </div>
          {inputs.length > 0 && (
            <div className="space-y-1 border-l-2 pl-2" style={{ borderColor: 'var(--fm-accent)' }}>
              {inputs.map((p, i) => (
                <div key={i}>{portLine(p, inputs, setInputs)}</div>
              ))}
            </div>
          )}
        </div>

        {/* 输出 */}
        <div className="space-y-1">
          <div className="flex gap-1">
            <select
              value={outItem}
              onChange={(e) => setOutItem(e.target.value)}
              className="flex-1 border px-1 py-1 text-xs"
              style={selectStyle}
            >
              <option value="">选择输出物品…</option>
              {items.map((i) => (
                <option key={i.id} value={i.id}>{i.name}</option>
              ))}
            </select>
            <input
              value={outQty}
              onChange={(e) => setOutQty(e.target.value)}
              className="w-12 border bg-transparent px-1 py-1 text-center font-mono text-xs text-[var(--fm-text)]"
              style={{ borderColor: 'var(--fm-edge)' }}
            />
            <button
              onClick={addOutput}
              className="border px-2 text-xs text-[var(--fm-accent)]"
              style={{ borderColor: 'var(--fm-edge)' }}
            >
              +
            </button>
          </div>
          {outputs.length > 0 && (
            <div className="space-y-1 border-l-2 pl-2" style={{ borderColor: 'var(--fm-ok)' }}>
              {outputs.map((p, i) => (
                <div key={i}>{portLine(p, outputs, setOutputs)}</div>
              ))}
            </div>
          )}
        </div>

        {/* 时长 */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--fm-text-dim)]">加工时长</span>
          <input
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            className="w-20 border bg-transparent px-2 py-1 text-center font-mono text-xs text-[var(--fm-text)]"
            style={{ borderColor: 'var(--fm-edge)' }}
          />
          <span className="font-mono text-[10px] text-[var(--fm-text-dim)]">秒</span>
        </div>

        <button
          onClick={submit}
          disabled={inputs.length === 0 || outputs.length === 0}
          className="w-full border px-2 py-1 text-xs text-[var(--fm-accent)] transition-colors hover:bg-[rgba(79,195,247,0.10)] disabled:opacity-40"
          style={{ borderColor: 'var(--fm-accent)' }}
        >
          + 添加配方
        </button>
      </div>

      {/* 列表 */}
      <div className="space-y-2">
        <p className="font-mono text-[10px] tracking-widest text-[var(--fm-text-dim)]">
          RECIPES ({recipes.length})
        </p>
        {recipes.length === 0 ? (
          <p className="text-xs text-[var(--fm-text-dim)]">暂无配方。</p>
        ) : (
          recipes.map((r) => (
            <div key={r.id} className="border px-2 py-1.5" style={{ borderColor: 'var(--fm-edge)' }}>
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--fm-text)]">{r.name}</span>
                <button
                  onClick={() => removeRecipe(r.id)}
                  className="font-mono text-[10px] text-[var(--fm-danger)]"
                >
                  ×
                </button>
              </div>
              <div className="mt-1 font-mono text-[10px] text-[var(--fm-text-dim)]">
                <div>
                  入{' '}
                  {r.inputs.map((p) => `${itemName(p.itemId)}×${p.qty}`).join(' + ') || '—'}
                </div>
                <div>
                  出{' '}
                  {r.outputs.map((p) => `${itemName(p.itemId)}×${p.qty}`).join(' + ') || '—'}
                </div>
                <div>{r.durationSec}s</div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
