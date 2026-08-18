import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { FactoryObject } from '../game/types'

interface Props {
  obj: FactoryObject
  label: string
  onClose: () => void
}

/** 存储类设备的内容物查询窗口。当前库存基线为螺丝*100。 */
export function StorageContentOverlay({ obj, label, onClose }: Props) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const node = (
    <div className="fm-storage-query-layer" role="presentation" onClick={onClose}>
      <section className="fm-storage-query" role="dialog" aria-modal="true" aria-label={`${label}内容物`} onClick={(event) => event.stopPropagation()}>
        <header className="fm-storage-query-head">
          <div>
            <span className="fm-eyebrow">CONTENTS / {obj.id.slice(-6)}</span>
            <h3>{label} · 内容物查询</h3>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭内容物查询">×</button>
        </header>
        <div className="fm-storage-query-body">
          <span className="fm-storage-query-label">当前存储物</span>
          <div className="fm-storage-query-item">
            <span className="fm-storage-query-dot" />
            <strong>螺丝*100</strong>
          </div>
        </div>
      </section>
    </div>
  )

  return createPortal(node, document.body)
}
