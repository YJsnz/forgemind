import { useEffect, useRef, useState } from 'react'
import { useForgeMindStore } from '../store/forgeMind'
import { BuildMenu } from './BuildMenu'
import { ItemPanel } from './ItemPanel'
import { RecipePanel } from './RecipePanel'
import { downloadSave, parseSave, readFileAsText } from '../game/save'
import { fetchRemoteSave, pushRemoteSave, isBackendOnline } from '../game/api'

type Tab = 'build' | 'item' | 'recipe'

/**
 * 左侧栏主容器：tab 切换（建造/物品/配方）+ 底部保存/加载/清空/云同步。
 */
export function LeftPanel({ focus }: { focus?: Tab }) {
  const [tab, setTab] = useState<Tab>('build')
  const exportSave = useForgeMindStore((s) => s.exportSave)
  const importSave = useForgeMindStore((s) => s.importSave)
  const clearAll = useForgeMindStore((s) => s.clearAll)
  const fileInput = useRef<HTMLInputElement>(null)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    if (focus) setTab(focus)
  }, [focus])

  const tabs: { key: Tab; label: string }[] = [
    { key: 'build', label: '建造' },
    { key: 'item', label: '物品' },
    { key: 'recipe', label: '配方' },
  ]

  const flash = (text: string) => {
    setMsg(text)
    setTimeout(() => setMsg(null), 2000)
  }

  const onSave = () => {
    downloadSave(exportSave())
    flash('已导出存档')
  }

  const onLoadClick = () => fileInput.current?.click()

  const onLoadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    try {
      const text = await readFileAsText(f)
      const save = parseSave(text)
      importSave(save)
      flash('已加载存档')
    } catch (err) {
      flash(`加载失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // 云同步：推送到 Spring Boot / 从 Spring Boot 拉取
  const onPush = async () => {
    try {
      if (!(await isBackendOnline())) {
        flash('后端未在线（http://localhost:8080）')
        return
      }
      await pushRemoteSave(exportSave())
      flash('已推送到后端')
    } catch (err) {
      flash(`推送失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const onPull = async () => {
    try {
      if (!(await isBackendOnline())) {
        flash('后端未在线（http://localhost:8080）')
        return
      }
      const save = await fetchRemoteSave()
      importSave(save)
      flash('已从后端拉取')
    } catch (err) {
      flash(`拉取失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* tab 栏 */}
      <div className="flex border-b" style={{ borderColor: 'var(--fm-edge)' }}>
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className="flex-1 border-r px-1 py-1.5 text-xs transition-colors last:border-r-0"
            style={{
              borderColor: 'var(--fm-edge)',
              color: tab === t.key ? 'var(--fm-accent)' : 'var(--fm-text-dim)',
              background: tab === t.key ? 'rgba(79,195,247,0.08)' : 'transparent',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto">
        {tab === 'build' && <BuildMenu />}
        {tab === 'item' && <ItemPanel />}
        {tab === 'recipe' && <RecipePanel />}
      </div>

      {/* 底部操作区 */}
      <div className="border-t p-2" style={{ borderColor: 'var(--fm-edge)' }}>
        <div className="flex gap-1">
          <button
            onClick={onSave}
            className="flex-1 border px-1 py-1 text-xs text-[var(--fm-ok)] transition-colors hover:bg-[rgba(102,187,106,0.10)]"
            style={{ borderColor: 'var(--fm-ok)' }}
          >
            保存
          </button>
          <button
            onClick={onLoadClick}
            className="flex-1 border px-1 py-1 text-xs text-[var(--fm-accent)] transition-colors hover:bg-[rgba(79,195,247,0.10)]"
            style={{ borderColor: 'var(--fm-accent)' }}
          >
            加载
          </button>
          <button
            onClick={() => {
              if (window.confirm('清空当前工厂（对象/物品/配方）？')) {
                clearAll()
                flash('已清空')
              }
            }}
            className="flex-1 border px-1 py-1 text-xs text-[var(--fm-danger)] transition-colors hover:bg-[rgba(239,83,80,0.10)]"
            style={{ borderColor: 'var(--fm-danger)' }}
          >
            清空
          </button>
        </div>
        {/* 云同步（可选演进：接 Spring Boot 后端） */}
        <div className="mt-1 flex gap-1">
          <button
            onClick={onPush}
            className="flex-1 border px-1 py-1 text-[10px] text-[var(--fm-text-dim)] transition-colors hover:bg-[rgba(79,195,247,0.08)]"
            style={{ borderColor: 'var(--fm-edge)' }}
          >
            ⬆ 推后端
          </button>
          <button
            onClick={onPull}
            className="flex-1 border px-1 py-1 text-[10px] text-[var(--fm-text-dim)] transition-colors hover:bg-[rgba(79,195,247,0.08)]"
            style={{ borderColor: 'var(--fm-edge)' }}
          >
            ⬇ 拉后端
          </button>
        </div>
        <input ref={fileInput} type="file" accept=".json,application/json" className="hidden" onChange={onLoadFile} />
        {msg && (
          <p className="mt-1.5 text-center font-mono text-[10px] text-[var(--fm-text-dim)]">{msg}</p>
        )}
      </div>
    </div>
  )
}
