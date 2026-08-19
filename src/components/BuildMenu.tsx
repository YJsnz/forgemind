import { useMemo, useState } from 'react'
import { EQUIPMENT_ORDER, OBJECT_DEFS } from '../game/types'
import type { BuildType, EquipmentCategory, ImportedResource } from '../game/types'
import { useForgeMindStore } from '../store/forgeMind'
import { EquipmentThumbnail } from './EquipmentThumbnail'
import { ResourceImportDialog } from './ResourceImportDialog'

const CATEGORIES: Array<{ key: EquipmentCategory; code: string; label: string; description: string }> = [
  { key: '采集', code: 'A', label: '原料采集', description: '从矿脉和资源节点开始生产链' },
  { key: '加工', code: 'B', label: '基础加工', description: '熔炼、冲压与通用工艺设备' },
  { key: '装配', code: 'C', label: '精密装配', description: '把中间件组装为复杂产品' },
  { key: '物流', code: 'D', label: '物流仓储', description: '输送、分流、汇流和物料缓存' },
]

export function BuildMenu({ compact = false }: { compact?: boolean }) {
  const buildType = useForgeMindStore((s) => s.buildType)
  const setBuildType = useForgeMindStore((s) => s.setBuildType)
  const setImportedResourceId = useForgeMindStore((s) => s.setImportedResourceId)
  const registerImportedResource = useForgeMindStore((s) => s.registerImportedResource)
  const importedResources = useForgeMindStore((s) => s.importedResources)
  const selectedImportedResourceId = useForgeMindStore((s) => s.selectedImportedResourceId)
  const objectCount = useForgeMindStore((s) => s.objects.length)
  const [category, setCategory] = useState<EquipmentCategory>('采集')
  const [selectedType, setSelectedType] = useState<BuildType>('oreMiner')
  const [importDialogOpen, setImportDialogOpen] = useState(false)

  const entries = useMemo(
    () => EQUIPMENT_ORDER.filter((type) => OBJECT_DEFS[type].category === category),
    [category],
  )
  const importedEntries = useMemo(() => importedResources.filter((resource) => resource.objectDef.category === category), [category, importedResources])
  const selectedImported = importedResources.find((resource) => resource.id === selectedImportedResourceId)
  const selected = selectedType === 'imported' ? selectedImported?.objectDef ?? OBJECT_DEFS.imported : OBJECT_DEFS[selectedType]

  const selectEquipment = (type: BuildType, resourceId?: string) => {
    setSelectedType(type)
    setImportedResourceId(type === 'imported' ? resourceId ?? null : null)
    setBuildType(type)
  }

  const handleImported = (resource: ImportedResource) => {
    registerImportedResource(resource)
    setCategory(resource.objectDef.category)
    setSelectedType('imported')
    setImportDialogOpen(false)
  }

  return (
    <div className={`fm-build-menu ${compact ? 'is-compact' : ''}`}>
      <div className="fm-build-note fm-build-note-strong">网格 = 1 m · 蓝色端口为入口 · 琥珀端口为出口 · 输送带可按住拖动连续放置</div>
      <div className="fm-build-mode">
        <div>
          <div className="fm-eyebrow"><span>BUILD MODE</span> / TOP-DOWN GRID</div>
          <strong>俯视建造工作台</strong>
        </div>
        <span className="fm-build-mode-led" />
      </div>

      <div className="fm-build-note">选择设备后，移动鼠标预览占地范围。按 R 旋转，左键确认放置。</div>

      <button type="button" className="fm-build-import-button" onClick={() => setImportDialogOpen(true)}><span>＋</span><strong>导入新设备</strong><small>JSON + GLB · 自动生成封面</small><b>↗</b></button>

      <div className="fm-category-tabs" role="tablist" aria-label="设备类别">
        {CATEGORIES.map((item) => (
          <button
            key={item.key}
            className={category === item.key ? 'is-active' : ''}
            onClick={() => {
              setCategory(item.key)
              setImportedResourceId(null)
              const firstType = EQUIPMENT_ORDER.find((type) => OBJECT_DEFS[type].category === item.key)
              if (firstType) setSelectedType(firstType)
            }}
            role="tab"
            aria-selected={category === item.key}
          >
            <span>{item.code}</span>{item.label}
          </button>
        ))}
      </div>

      <div className="fm-category-caption">{CATEGORIES.find((item) => item.key === category)?.description}</div>

      <div className="fm-equipment-list">
        {entries.map((type) => {
          const item = OBJECT_DEFS[type]
          const active = buildType === type
          const inspected = selectedType === type
          return (
            <button
              key={type}
              className={`fm-equipment-card ${active ? 'is-active' : ''} ${inspected ? 'is-inspected' : ''}`}
              style={{ '--equipment-accent': item.accent } as React.CSSProperties}
              onClick={() => selectEquipment(type)}
            >
              <EquipmentThumbnail type={type} />
              <span className="fm-equipment-card-body">
                <span className="fm-equipment-glyph" style={{ '--equipment-accent': item.accent } as React.CSSProperties}>{modelGlyph(type)}</span>
                <span className="fm-equipment-copy">
                  <strong>{item.label}</strong>
                  <small>{item.subtitle}</small>
                  <em className={item.assetPath ? 'is-split-asset' : 'is-procedural'}>
                    {type === 'assembler' ? '7 轴 Panda / 开放单元' : item.assetKind === 'runtime-assembly' ? '双臂运行时组合模型' : item.assetKind === 'center-split' ? '中心拆分资产' : item.assetKind === 'detailed-process' ? '独立高精度工艺资产' : '工艺结构模型'}
                  </em>
                </span>
                <span className="fm-equipment-meta">{item.footprint.w}×{item.footprint.d}<br />{item.power}</span>
              </span>
            </button>
          )
        })}
        {importedEntries.map((resource) => {
          const item = resource.objectDef
          const active = buildType === 'imported' && selectedImportedResourceId === resource.id
          return (
            <button
              key={resource.id}
              className={`fm-equipment-card fm-equipment-card-imported ${active ? 'is-active' : ''} ${active ? 'is-inspected' : ''}`}
              style={{ '--equipment-accent': item.accent } as React.CSSProperties}
              onClick={() => selectEquipment('imported', resource.id)}
            >
              <EquipmentThumbnail type="imported" previewDataUrl={resource.previewDataUrl} />
              <span className="fm-equipment-card-body">
                <span className="fm-equipment-glyph" style={{ '--equipment-accent': item.accent } as React.CSSProperties}>↗</span>
                <span className="fm-equipment-copy"><strong>{item.label}</strong><small>{item.subtitle}</small><em className="is-split-asset">用户导入 · {resource.modelFileName}</em></span>
                <span className="fm-equipment-meta">{item.footprint.w}×{item.footprint.d}<br />{item.power}</span>
              </span>
            </button>
          )
        })}
      </div>

      <div className="fm-equipment-detail">
        <div className="fm-detail-header">
          <div><span className="fm-eyebrow">EQUIPMENT SPEC</span><strong>{selected.label}</strong></div>
          <span className="fm-detail-code">{selected.model}</span>
        </div>
        <div className={`fm-asset-source ${selected.assetPath ? 'is-split-asset' : 'is-procedural'}`}>
          <span>{selectedType === 'assembler' ? '7-AXIS PANDA / OPEN CELL' : selected.assetKind === 'runtime-assembly' ? 'DUAL-ARM / RUNTIME ASSEMBLY' : selected.assetKind === 'center-split' ? 'CENTER CELL / SPLIT ASSET' : selected.assetKind === 'detailed-process' ? 'DETAILED PROCESS ASSET' : 'PROCESS MODEL / PROCEDURAL'}</span>
          <code>{selected.assetPath ?? '本设备在中心模型中无对应节点'}</code>
        </div>
        {selectedType === 'imported' && selectedImported?.warnings.length ? (
          <div className="fm-resource-import-warnings">
            <span>校验提示</span>
            {selectedImported.warnings.map((warning) => <p key={warning}>! {warning}</p>)}
          </div>
        ) : null}
        <p>{selected.function}</p>
        <div className="fm-detail-grid">
          <Spec label="占地" value={`${selected.footprint.w} × ${selected.footprint.d} 格`} />
          <Spec label="吞吐" value={selected.throughput} />
          <Spec label="能耗" value={selected.power} />
          <Spec label="高度" value={`${selected.height.toFixed(1)} m`} />
        </div>
        <div className="fm-io-row">
          <div><span>INPUT</span><strong>{selected.inputs.join(' · ')}</strong></div>
          <div><span>OUTPUT</span><strong>{selected.outputs.join(' · ')}</strong></div>
        </div>
        {selectedType === 'inspection' && <div className="fm-build-inspection-note"><span>WORKFLOW</span><strong>放置后可从设备详情进入 360° 检测工作台</strong></div>}
        <button className={`fm-place-button ${buildType === selectedType ? 'is-cancel' : ''}`} onClick={() => setBuildType(buildType === selectedType ? null : selectedType)}>
          {buildType === selectedType ? '退出当前设备' : `放置 ${selected.label}`}
        </button>
      </div>

      <div className="fm-build-footer"><span>已放置 <b>{objectCount.toString().padStart(2, '0')}</b> 台设施</span><span className="fm-build-shortcuts"><kbd>R</kbd> 旋转 <kbd>ESC</kbd> 退出</span></div>
      <ResourceImportDialog open={importDialogOpen} onClose={() => setImportDialogOpen(false)} onImported={handleImported} />
    </div>
  )
}

function Spec({ label, value }: { label: string; value: string }) {
  return <div className="fm-spec"><span>{label}</span><strong>{value}</strong></div>
}

function modelGlyph(type: BuildType): string {
  switch (type) {
    case 'oreMiner': return '◈'
    case 'smelter': return '▣'
    case 'press': return '▥'
    case 'assembler': return '⌘'
    case 'inspection': return '◎'
    case 'washing': return '≋'
    case 'agv': return '▰'
    case 'drone': return '◇'
    case 'conveyor': return '⇢'
    case 'splitter': return '⑂'
    case 'merger': return '⑃'
    case 'storage': return '▤'
    default: return '◫'
  }
}
