import { useState } from 'react'
import { useForgeMindStore } from '../store/forgeMind'
import { CATEGORY_COLORS, CATEGORY_LABELS } from '../game/item'
import type { ItemCategory } from '../game/item'

/**
 * 物品（Item）面板：列表 + 新建表单（Day 3）。
 */
export function ItemPanel() {
  const items = useForgeMindStore((s) => s.items)
  const addItem = useForgeMindStore((s) => s.addItem)
  const removeItem = useForgeMindStore((s) => s.removeItem)

  const [name, setName] = useState('')
  const [category, setCategory] = useState<ItemCategory>('raw')

  const submit = () => {
    const n = name.trim()
    if (!n) return
    addItem(n, category, CATEGORY_COLORS[category])
    setName('')
  }

  return (
    <div className="flex flex-col gap-3 px-3 py-2">
      {/* 新建表单 */}
      <div className="space-y-2 border-b pb-3" style={{ borderColor: 'var(--fm-edge)' }}>
        <p className="font-mono text-[10px] tracking-widest text-[var(--fm-text-dim)]">
          NEW ITEM
        </p>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="名称"
          className="w-full border bg-transparent px-2 py-1 text-sm text-[var(--fm-text)] outline-none placeholder:text-[var(--fm-text-dim)]"
          style={{ borderColor: 'var(--fm-edge)' }}
        />
        <div className="flex gap-1">
          {(Object.keys(CATEGORY_LABELS) as ItemCategory[]).map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className="flex-1 border px-1 py-1 text-[10px] transition-colors"
              style={{
                borderColor: category === c ? 'var(--fm-accent)' : 'var(--fm-edge)',
                color: category === c ? 'var(--fm-accent)' : 'var(--fm-text-dim)',
                background: category === c ? 'rgba(79,195,247,0.10)' : 'transparent',
              }}
            >
              {CATEGORY_LABELS[c]}
            </button>
          ))}
        </div>
        <button
          onClick={submit}
          className="w-full border px-2 py-1 text-xs text-[var(--fm-accent)] transition-colors hover:bg-[rgba(79,195,247,0.10)]"
          style={{ borderColor: 'var(--fm-accent)' }}
        >
          + 添加物品
        </button>
      </div>

      {/* 列表 */}
      <div className="space-y-1">
        <p className="font-mono text-[10px] tracking-widest text-[var(--fm-text-dim)]">
          ITEMS ({items.length})
        </p>
        {items.length === 0 ? (
          <p className="text-xs text-[var(--fm-text-dim)]">暂无物品，先添加一个。</p>
        ) : (
          items.map((it) => (
            <div
              key={it.id}
              className="flex items-center justify-between border px-2 py-1"
              style={{ borderColor: 'var(--fm-edge)' }}
            >
              <div className="flex items-center gap-2">
                <span
                  className="inline-block h-2 w-2"
                  style={{ background: it.color }}
                />
                <span className="text-xs text-[var(--fm-text)]">{it.name}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] text-[var(--fm-text-dim)]">
                  {CATEGORY_LABELS[it.category]}
                </span>
                <button
                  onClick={() => removeItem(it.id)}
                  className="font-mono text-[10px] text-[var(--fm-danger)]"
                >
                  ×
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
