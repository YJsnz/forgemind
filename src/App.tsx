import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import { stagger } from 'animejs'
import { ChevronDown as ChevronDownData, CircleHelp as CircleHelpData, GitBranch as GitBranchData, Hammer as HammerData, LayoutDashboard as LayoutDashboardData, MonitorCog as MonitorCogData, Power as PowerData, Settings as SettingsData, Stethoscope as StethoscopeData, X as XData } from 'lucide'
import { FactoryCanvas, type FactoryView } from './scene/FactoryCanvas'
import { BuildMenu } from './components/BuildMenu'
import { InfoPanel } from './components/InfoPanel'
import { SimPanel } from './components/SimPanel'
import { LoginOverlay } from './components/LoginOverlay'
import { SimulationRunner } from './game/SimulationRunner'
import type { SimulationSnapshot } from './game/simulation'
import { useForgeMindStore } from './store/forgeMind'
import { useAuthStore } from './store/auth'
import { isMachineType, isTransportType, objectRole } from './game/types'
import { diagnoseFactory } from './game/factoryDiagnostics'
import { AssistantOrb } from './components/AssistantOrb'
import { AssistantRuntime } from './components/AssistantRuntime'
import { AssistantVoiceButton } from './components/AssistantVoiceButton'
import { FactoryCatalogWorkspace, type FactoryCatalogSection } from './components/FactoryCatalogWorkspace'
const ProductionWorkspace = lazy(() => import('./components/ProductionWorkspace').then((m) => ({ default: m.ProductionWorkspace })))
const ProductionRouteWorkspace = lazy(() => import('./components/ProductionRouteWorkspace').then((m) => ({ default: m.ProductionRouteWorkspace })))
const FactoryAgentWorkspace = lazy(() => import('./components/FactoryAgentWorkspace').then((m) => ({ default: m.FactoryAgentWorkspace })))
const GenerativeFactoryWorkspace = lazy(() => import('./components/GenerativeFactoryWorkspace').then((m) => ({ default: m.GenerativeFactoryWorkspace })))
import { ForgeMindIntro } from './components/ForgeMindIntro'
import { FloorSwitcher } from './components/FloorSwitcher'
import type { FactoryFloorId } from './scene/FactoryFloorSystem'
import { FactoryProjectControls, FactoryProjectDialog } from './components/FactoryProjectDialog'
import './forgemind-intro.css'
import './production.css'
import './generative.css'
import { animateIfAllowed } from './utils/animeMotion'
import { loadImportedResources } from './api/resources'
import { getFactoryFloors, MAX_FACTORY_FLOORS } from './game/floorConfig'
import type { FactoryProjectSummary } from './api/factoryProjects'
import { selectionKeyboardAction } from './game/selection'
import type { DaiyuTargetFps } from './engine/daiyu/config'
import { isUnityBridgeAvailable } from './platform/unityBridge'
import { MorphingIcon } from './components/MorphingIcon'
import { ForgeCloudConsole } from './components/ForgeCloudConsole'
import { ForgePassPage } from './components/ForgePassPage'
import './forgecloud.css'

const TARGET_FPS_STORAGE_KEY = 'forgemind.target-fps'

const VIEW_META: Record<FactoryView, { code: string; label: string; title: string; description: string }> = {
  overview: {
    code: '01',
    label: '总览',
    title: '工业基地总览',
    description: '以基地级视角查看设施布局、生产能力与运行态势。',
  },
  build: {
    code: '02',
    label: '建造',
    title: '工建选址模式',
    description: '切换到网格建造视角，拖拽镜头并放置生产设施。',
  },
  flow: {
    code: '03',
    label: '生产',
    title: '生产连接模式',
    description: '沿着生产链查看物料流向、机器状态与实时产出。',
  },
  diagnostics: {
    code: '04',
    label: '诊断',
    title: 'AI 工厂诊断',
    description: '聚焦瓶颈、利用率和仿真指标，为下一次优化提供依据。',
  },
}

const VIEW_ORDER: FactoryView[] = ['overview', 'build', 'flow', 'diagnostics']
type DiagnosticsSurface = 'diagnose' | 'generate'
type LiveKpiData = {
  productionEfficiency: number
  utilization: number
  outputRatePerMinute: number
  logisticsLoad: number
  producedTotal: number
  activeMachines: number
}

function App() {
  const [portalOpen, setPortalOpen] = useState(() => window.location.pathname !== '/forgecloud')
  const [cloudOpen, setCloudOpen] = useState(() => window.location.pathname === '/forgecloud')
  const [view, setView] = useState<FactoryView>('overview')
  const [diagnosticsSurface, setDiagnosticsSurface] = useState<DiagnosticsSurface>('diagnose')
  const [auxPanel, setAuxPanel] = useState<'catalog' | 'productionRoute' | null>(null)
  const [catalogSection, setCatalogSection] = useState<FactoryCatalogSection>('manufacturing')
  const [topMenu, setTopMenu] = useState<'help' | 'settings' | 'user' | null>(null)
  const [showViewportTools, setShowViewportTools] = useState(true)
  const [showInterfaceHints, setShowInterfaceHints] = useState(true)
  const [reducedMotion, setReducedMotion] = useState(false)
  const [targetFps, setTargetFps] = useState<DaiyuTargetFps>(readTargetFps)
  const [activeFloor, setActiveFloor] = useState<FactoryFloorId>(1)
  const [visibleFloors, setVisibleFloors] = useState<Set<FactoryFloorId>>(() => new Set())
  const [projectReady, setProjectReady] = useState(false)
  const [projectDialogOpen, setProjectDialogOpen] = useState(true)
  const [currentProject, setCurrentProject] = useState<FactoryProjectSummary | null>(null)
  const [trendHistory, setTrendHistory] = useState<number[]>(() => Array.from({ length: 12 }, () => 0))
  const shellRef = useRef<HTMLDivElement>(null)
  const topActionsRef = useRef<HTMLDivElement>(null)
  const objects = useForgeMindStore((s) => s.objects)
  const items = useForgeMindStore((s) => s.items)
  const recipes = useForgeMindStore((s) => s.recipes)
  const snapshot = useForgeMindStore((s) => s.simSnapshot)
  const playing = useForgeMindStore((s) => s.simPlaying)
  const buildType = useForgeMindStore((s) => s.buildType)
  const selectedId = useForgeMindStore((s) => s.selectedId)
  const selectedIds = useForgeMindStore((s) => s.selectedIds)
  const selectedObject = objects.find((object) => object.id === selectedId)
  const selectedIsVehicle = selectedObject?.type === 'agv' || selectedObject?.type === 'drone'
  const select = useForgeMindStore((s) => s.select)
  const setBuildType = useForgeMindStore((s) => s.setBuildType)
  const undo = useForgeMindStore((s) => s.undo)
  const redo = useForgeMindStore((s) => s.redo)
  const factoryName = useForgeMindStore((s) => s.factoryName)
  const floorCount = useForgeMindStore((s) => s.floorCount)
  const floorNames = useForgeMindStore((s) => s.floorNames)
  const addFloor = useForgeMindStore((s) => s.addFloor)
  const renameFloor = useForgeMindStore((s) => s.renameFloor)
  const registerImportedResource = useForgeMindStore((s) => s.registerImportedResource)
  const clearImportedResources = useForgeMindStore((s) => s.clearImportedResources)

  const phase = useAuthStore((s) => s.phase)
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  const restoreSession = useAuthStore((s) => s.restoreSession)
  const token = useAuthStore((s) => s.token)
  const resourceUserToken = useRef<string | null>(null)

  const changeView = (next: FactoryView) => {
    setView(next)
    if (next !== 'diagnostics') setDiagnosticsSurface('diagnose')
    setAuxPanel(null)
    if (next !== 'build') setBuildType(null)
  }

  const changeTargetFps = (next: DaiyuTargetFps) => {
    setTargetFps(next)
    window.localStorage.setItem(TARGET_FPS_STORAGE_KEY, String(next))
  }

  const toggleFloorVisibility = (floorId: FactoryFloorId) => {
    setVisibleFloors((current) => {
      const next = new Set(current)
      if (next.has(floorId)) next.delete(floorId)
      else next.add(floorId)
      return next
    })
  }

  const selectFloor = (floorId: FactoryFloorId) => {
    setBuildType(null)
    select(null)
    setActiveFloor(floorId)
  }

  const handleAddFloor = () => {
    const nextFloor = addFloor()
    selectFloor(nextFloor)
  }

  const handleProjectReady = (project: FactoryProjectSummary | null) => {
    setActiveFloor(1)
    setVisibleFloors(new Set())
    setView('overview')
    setAuxPanel(null)
    setProjectReady(true)
    setCurrentProject(project)
    setTrendHistory(Array.from({ length: 12 }, () => 0))
    setProjectDialogOpen(false)
  }

  const handleLogout = () => {
    setTopMenu(null)
    setAuxPanel(null)
    setProjectReady(false)
    setCurrentProject(null)
    setProjectDialogOpen(true)
    void logout()
  }

  const enterForgeCloud = () => {
    window.history.pushState({}, '', '/forgecloud')
    setCloudOpen(true)
    setPortalOpen(false)
  }

  const exitForgeCloud = () => {
    window.history.pushState({}, '', '/')
    setCloudOpen(false)
    setPortalOpen(true)
  }

  const navigatePortal = (path: string) => {
    window.history.pushState({}, '', path)
    setCloudOpen(false)
    setPortalOpen(true)
  }

  const enterWorkspaceFromCloud = () => {
    window.history.pushState({}, '', '/')
    setCloudOpen(false)
    setPortalOpen(false)
  }

  const enterWorkspaceFromPortal = () => {
    window.history.replaceState({}, '', '/')
    setPortalOpen(false)
  }

  useEffect(() => {
    const onPopState = () => {
      if (window.location.pathname === '/forgecloud') {
        setCloudOpen(true)
        setPortalOpen(false)
      } else if (window.location.pathname === '/') {
        setCloudOpen(false)
        setPortalOpen(true)
      }
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  // 挂载时用本地 token 续登（无 token 则停留在电梯舱）
  useEffect(() => {
    restoreSession()
  }, [restoreSession])

  // 导入设备属于登录用户：切换用户时先清除前一个用户的内存资源，
  // 进入工厂后再从后端加载当前 token 所属用户的资源。
  useEffect(() => {
    if (phase !== 'factory' || !token) {
      resourceUserToken.current = null
      clearImportedResources()
      return
    }
    if (resourceUserToken.current === token) return
    resourceUserToken.current = token
    let cancelled = false
    void loadImportedResources()
      .then((resources) => {
        if (cancelled) return
        resources.forEach((resource) => registerImportedResource(resource, false))
      })
      .catch((error) => {
        if (!cancelled) console.warn('[ForgeMind] 用户设备资源加载失败', error)
      })
    return () => { cancelled = true }
  }, [clearImportedResources, phase, registerImportedResource, token])

  // 登录成功 → 播放 BT-7274 欢迎语音（与舱门开启同步）
  useEffect(() => {
    if (phase !== 'entering') return
    const audio = new Audio('/audio/welcome_home_bt.wav')
    audio.play().catch(() => {})
    return () => audio.pause()
  }, [phase])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)) return

      const selectionAction = selectionKeyboardAction(event.key)
        ?? selectionKeyboardAction(event.code)
        ?? (event.keyCode === 46 ? { type: 'delete' as const } : null)
      const selectionState = useForgeMindStore.getState()
      const currentSelection = [...selectionState.selectedIds]

      if (
        selectionAction?.type === 'delete'
        && useAuthStore.getState().phase === 'factory'
        && currentSelection.length > 0
        && !event.ctrlKey
        && !event.metaKey
        && !event.altKey
      ) {
        event.preventDefault()
        event.stopPropagation()
        selectionState.removeMany(currentSelection)
        return
      }

      if (
        phase === 'factory'
        && !portalOpen
        && projectReady
        && !projectDialogOpen
        && auxPanel === null
        && topMenu === null
        && view !== 'flow'
        && !event.ctrlKey
        && !event.metaKey
        && !event.altKey
      ) {
        if (selectionAction && currentSelection.length > 0) {
          if (currentSelection.length === 1) {
            event.preventDefault()
            event.stopPropagation()
            if (selectionAction.type === 'move') selectionState.moveObject(currentSelection[0], selectionAction.dx, selectionAction.dz)
            else if (selectionAction.type === 'rotate') selectionState.rotateObject(currentSelection[0], selectionAction.direction)
            return
          }
        }
      }

      if (event.key === 'Escape') {
        event.preventDefault()
        setTopMenu(null)
        setAuxPanel(null)
        setBuildType(null)
        if (view !== 'overview') setView('overview')
        return
      }

      const modifier = event.ctrlKey || event.metaKey
      if (!modifier) return
      const key = event.key.toLowerCase()
      if (key === 'z') {
        event.preventDefault()
        if (event.shiftKey) redo()
        else undo()
      } else if (key === 'y') {
        event.preventDefault()
        redo()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [auxPanel, phase, portalOpen, projectDialogOpen, projectReady, redo, setBuildType, topMenu, undo, view])

  useEffect(() => {
    if (!topMenu) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (target && !topActionsRef.current?.contains(target)) setTopMenu(null)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [topMenu])

  useEffect(() => {
    if (portalOpen || phase !== 'factory') return
    const shell = shellRef.current
    if (!shell) return
    // Keep transform-based layout rules out of this batch. In particular, the
    // dock uses translateX(-50%) for centering and should not be rewritten by
    // a generic translateY entrance animation.
    const surfaces = shell.querySelectorAll<HTMLElement>('.fm-viewport-header, .fm-viewport-tools, .fm-viewport-footer, .fm-production-workspace, .fm-route-workspace, .fm-manufacturing-workspace, .fm-item-detail-workspace, .fm-warehouse-workspace')
    const animation = animateIfAllowed(surfaces, {
      opacity: [0, 1],
      translateY: [6, 0],
      delay: stagger(35, { start: 40 }),
      duration: 380,
      ease: 'out(4)',
    })
    const dock = shell.querySelector<HTMLElement>('.fm-dock-cluster')
    const dockAnimation = dock && animateIfAllowed(dock, {
      opacity: [0, 1],
      delay: 140,
      duration: 260,
      ease: 'out(3)',
    })
    return () => {
      animation?.cancel()
      dockAnimation?.cancel()
    }
  }, [phase, portalOpen, view])

  const counts = useMemo(() => ({
    machines: objects.filter((o) => isMachineType(o.type)).length,
    conveyors: objects.filter((o) => isTransportType(o.type)).length,
    sources: objects.filter((o) => objectRole(o.type) === 'source').length,
  }), [objects])

  const liveKpis = useMemo<LiveKpiData>(() => {
    const producedTotal = Object.values(snapshot.stats.produced).reduce((sum, value) => sum + value, 0)
    const outputRatePerMinute = snapshot.timeSec > 0 ? producedTotal / (snapshot.timeSec / 60) : 0
    const theoreticalRatePerMinute = objects
      .filter((object) => objectRole(object.type) === 'machine')
      .reduce((sum, machine) => {
        const recipe = recipes.find((candidate) => candidate.id === machine.recipeId)
        if (!recipe || recipe.durationSec <= 0) return sum
        const outputUnits = recipe.outputs.reduce((outputSum, output) => outputSum + output.qty, 0)
        return sum + (outputUnits * 60) / recipe.durationSec
      }, 0)
    const productionEfficiency = snapshot.timeSec > 0 && theoreticalRatePerMinute > 0
      ? Math.min(100, (outputRatePerMinute / theoreticalRatePerMinute) * 100)
      : 0
    const diagnostic = diagnoseFactory(objects, snapshot, recipes, floorCount)
    const logisticsLoad = counts.conveyors > 0
      ? Math.min(100, (snapshot.itemLots.length / counts.conveyors) * 100)
      : 0
    const activeMachines = snapshot.machines.filter((machine) => machine.state === 'processing' || machine.state === 'output').length

    return {
      productionEfficiency,
      utilization: diagnostic.utilization,
      outputRatePerMinute,
      logisticsLoad,
      producedTotal,
      activeMachines,
    }
  }, [counts.conveyors, floorCount, objects, recipes, snapshot])

  const liveKpisRef = useRef<LiveKpiData>(liveKpis)
  useEffect(() => {
    liveKpisRef.current = liveKpis
  }, [liveKpis])

  useEffect(() => {
    if (!projectReady || phase !== 'factory') return
    const timer = window.setInterval(() => {
      setTrendHistory((current) => [...current.slice(-11), liveKpisRef.current.outputRatePerMinute])
    }, 1200)
    return () => window.clearInterval(timer)
  }, [phase, projectReady])

  const meta = VIEW_META[view]
  const activeTool = auxPanel === 'catalog' ? `${catalogSection === 'manufacturing' ? '机械制造' : catalogSection === 'itemDetails' ? '物品详情' : '货物仓储'}工作区已打开` : auxPanel === 'productionRoute' ? '生产路线工作区已打开' : buildType ? '建造工具已启用' : '浏览与选择'
  const showRackLabels = phase === 'factory'
    && projectReady
    && !projectDialogOpen
    && view === 'overview'
    && buildType === null
    && auxPanel === null
    && selectedIds.length === 0
    && topMenu === null

  if (cloudOpen) {
    return token
      ? <ForgeCloudConsole onExit={exitForgeCloud} onLogout={handleLogout} onEnterWorkspace={enterWorkspaceFromCloud} onNavigatePortal={navigatePortal} />
      : <ForgePassPage onBack={exitForgeCloud} onSuccess={() => undefined} onEnterWorkspace={() => { exitForgeCloud(); window.setTimeout(() => setPortalOpen(false), 0) }} />
  }

  if (portalOpen) {
    return <ForgeMindIntro onEnterWorkspace={enterWorkspaceFromPortal} onOpenForgeCloud={enterForgeCloud} />
  }

  // 未进厂：电梯舱登录界面（舱门打开 + BT 音效 + 推镜进厂在 store phase 中驱动）
  if (phase !== 'factory') {
    return (
      <div className="fm-login-shell">
        <FactoryCanvas view="overview" targetFps={targetFps} activeFloor={1} floorCount={1} showRackLabels={false} />
        <LoginOverlay />
      </div>
    )
  }

  return (
    <div ref={shellRef} className="fm-shell" data-reduced-motion={reducedMotion ? 'true' : 'false'} data-warehouse-open={auxPanel === 'catalog' && catalogSection === 'warehouse' ? 'true' : 'false'} data-panel-open={Boolean(auxPanel || view !== 'overview' || selectedIds.length > 0 || topMenu || projectDialogOpen || portalOpen) ? 'true' : 'false'}>
      <SimulationRunner />
      <AssistantRuntime />

      <header className="fm-topbar">
        <div className="fm-brand-block">
          <div className="fm-brand-mark">
            <img src="/brand/forgemind-emblem.png" alt="ForgeMind" />
          </div>
          <div>
            <img className="fm-brand-wordmark" src="/brand/forgemind-wordmark.png" alt="FORGEMIND" />
            <div className="fm-brand-sub">DIGITAL FACTORY / {factoryName.toUpperCase()}</div>
          </div>
        </div>

        <div className="fm-facility-status">
          <span className="fm-live-dot" />
          <strong className="fm-current-factory">{factoryName}</strong>
          <span className="fm-status-divider" />
          <span className="fm-muted">{floorCount} 层 · 后端存档</span>
          {projectReady && <FactoryProjectControls currentProject={currentProject} onProjectChange={setCurrentProject} onManage={() => setProjectDialogOpen(true)} />}
        </div>

        <div ref={topActionsRef} className="fm-top-actions">
          <button
            type="button"
            className={`fm-icon-button ${topMenu === 'help' ? 'is-active' : ''}`}
            title="帮助"
            aria-label="打开帮助"
            aria-expanded={topMenu === 'help'}
            onClick={() => setTopMenu(topMenu === 'help' ? null : 'help')}
          ><MorphingIcon icon={topMenu === 'help' ? XData : CircleHelpData} size={15} /></button>
          <button
            type="button"
            className={`fm-icon-button ${topMenu === 'settings' ? 'is-active' : ''}`}
            title="设置"
            aria-label="打开设置"
            aria-expanded={topMenu === 'settings'}
            onClick={() => setTopMenu(topMenu === 'settings' ? null : 'settings')}
          ><MorphingIcon icon={topMenu === 'settings' ? XData : SettingsData} size={15} /></button>
          <button
            type="button"
            className={`fm-user-chip ${topMenu === 'user' ? 'is-active' : ''}`}
            aria-label="打开操作员菜单"
            aria-expanded={topMenu === 'user'}
            onClick={() => setTopMenu(topMenu === 'user' ? null : 'user')}
          >
            <span /> {user ? user.toUpperCase() : 'OPERATOR'} <MorphingIcon icon={ChevronDownData} size={13} aria-hidden="true" />
          </button>
          <button type="button" className="fm-icon-button" title="登出" aria-label="退出登录" onClick={handleLogout}><MorphingIcon icon={PowerData} size={15} /></button>

          {topMenu === 'help' && (
            <div className="fm-top-popover fm-help-popover" role="dialog" aria-label="帮助">
              <div className="fm-top-popover-head"><div><span className="fm-top-popover-kicker">HELP / QUICK REFERENCE</span><h2>操作手册</h2></div><button type="button" onClick={() => setTopMenu(null)} aria-label="关闭帮助"><MorphingIcon icon={XData} size={16} /></button></div>
              <p className="fm-top-popover-lead">在工厂视口中直接浏览、选择和调整设备。当前页面的快捷操作如下。</p>
              <div className="fm-top-shortcut-list">
                <div><span><kbd>拖动</kbd></span><small>旋转镜头</small></div>
                <div><span><kbd>右键</kbd></span><small>水平平移 / 建造时取消</small></div>
                <div><span><kbd>滚轮</kbd></span><small>缩放镜头</small></div>
                <div><span><kbd>ESC</kbd></span><small>退出建造或返回总览</small></div>
                <div><span><kbd>CTRL</kbd><kbd>Z</kbd></span><small>撤回上一步操作</small></div>
                <div><span><kbd>R</kbd></span><small>旋转待放置组件</small></div>
                <div><span><kbd>WASD</kbd></span><small>移动单个选中对象</small></div>
                <div><span><kbd>Q</kbd><kbd>E</kbd></span><small>选中对象左旋 / 右旋</small></div>
                <div><span><kbd>SHIFT</kbd><kbd>拖动</kbd></span><small>框选多个对象</small></div>
                <div><span><kbd>DELETE</kbd></span><small>删除全部选中对象</small></div>
              </div>
              <div className="fm-top-popover-foot"><span className="fm-context-dot" /> 系统在线 · BUILD 0.1.0</div>
            </div>
          )}

          {topMenu === 'settings' && (
            <div className="fm-top-popover fm-settings-popover" role="dialog" aria-label="设置">
              <div className="fm-top-popover-head"><div><span className="fm-top-popover-kicker">SYSTEM / DISPLAY</span><h2>界面设置</h2></div><button type="button" onClick={() => setTopMenu(null)} aria-label="关闭设置"><MorphingIcon icon={XData} size={16} /></button></div>
              <div className="fm-settings-list">
                <button type="button" className="fm-setting-row" aria-pressed={showViewportTools} onClick={() => setShowViewportTools(!showViewportTools)}><span><b>视口辅助信息</b><small>显示坐标、网格与镜头提示</small></span><i className={showViewportTools ? 'is-on' : ''}>{showViewportTools ? 'ON' : 'OFF'}</i></button>
                <button type="button" className="fm-setting-row" aria-pressed={showInterfaceHints} onClick={() => setShowInterfaceHints(!showInterfaceHints)}><span><b>操作快捷提示</b><small>显示撤回、旋转和建造提示</small></span><i className={showInterfaceHints ? 'is-on' : ''}>{showInterfaceHints ? 'ON' : 'OFF'}</i></button>
                <button type="button" className="fm-setting-row" aria-pressed={reducedMotion} onClick={() => setReducedMotion(!reducedMotion)}><span><b>减少界面动效</b><small>降低面板进入和状态切换动画</small></span><i className={reducedMotion ? 'is-on' : ''}>{reducedMotion ? 'ON' : 'OFF'}</i></button>
                <div className="fm-setting-row fm-setting-choice-row"><span><b>渲染目标帧率</b><small>{targetFps} FPS · {targetFps === 120 ? '流畅优先，动态降级更积极' : '画质优先，保留更多阴影预算'}</small></span><div className="fm-setting-choice" role="group" aria-label="渲染目标帧率"><button type="button" className={targetFps === 60 ? 'is-active' : ''} aria-pressed={targetFps === 60} onClick={() => changeTargetFps(60)}>60 FPS</button><button type="button" className={targetFps === 120 ? 'is-active' : ''} aria-pressed={targetFps === 120} onClick={() => changeTargetFps(120)}>120 FPS</button></div></div>
              </div>
              <div className="fm-top-popover-foot">帧率选项保存在本机，其余界面设置仅在当前工作台会话中生效</div>
            </div>
          )}

          {topMenu === 'user' && (
            <div className="fm-top-popover fm-user-popover" role="dialog" aria-label="操作员信息">
              <div className="fm-top-popover-head"><div><span className="fm-top-popover-kicker">OPERATOR / SESSION</span><h2>{user ? user.toUpperCase() : 'OPERATOR'}</h2></div><button type="button" onClick={() => setTopMenu(null)} aria-label="关闭操作员菜单"><MorphingIcon icon={XData} size={16} /></button></div>
              <div className="fm-user-status"><span className="fm-live-dot" /><div><b>会话已授权</b><small>当前工厂 · {factoryName}</small></div></div>
              <button type="button" className="fm-top-popover-action" onClick={handleLogout}>退出当前会话 <span>⏻</span></button>
            </div>
          )}
        </div>
      </header>

      <div className="fm-body">
        <aside className="fm-rail" aria-label="工作区导航">
          <div className="fm-rail-group">
            <div className="fm-rail-caption">WORKSPACE</div>
            {VIEW_ORDER.map((key) => {
              const item = VIEW_META[key]
              return (
                <button
                  key={key}
                  className={`fm-rail-item ${view === key ? 'is-active' : ''}`}
                  onClick={() => changeView(key)}
                >
                  <span className="fm-rail-icon"><MorphingIcon icon={key === 'overview' ? LayoutDashboardData : key === 'build' ? HammerData : key === 'flow' ? GitBranchData : StethoscopeData} size={16} /></span>
                  <span>{item.label}</span>
                </button>
              )
            })}
          </div>
          <div className="fm-rail-bottom">
            <button className="fm-rail-item"><span className="fm-rail-icon"><MorphingIcon icon={MonitorCogData} size={16} /></span><span>系统</span></button>
            <div className="fm-rail-version">BUILD<br />0.1.0</div>
          </div>
        </aside>

        <main className="fm-main">
          <section className="fm-viewport" data-building={buildType ? 'true' : 'false'} aria-label="3D 工厂视口">
            <FactoryCanvas view={view} targetFps={targetFps} activeFloor={activeFloor} visibleFloors={[...visibleFloors]} floorCount={floorCount} showRackLabels={showRackLabels} nativeSurfaceEnabled={projectReady && !projectDialogOpen && isUnityBridgeAvailable()} />
            {projectReady && <FloorSwitcher activeFloor={activeFloor} visibleFloors={visibleFloors} floors={getFactoryFloors(floorCount, floorNames)} onChange={selectFloor} onToggleVisibility={toggleFloorVisibility} onAddFloor={handleAddFloor} onRenameFloor={renameFloor} canAddFloor={floorCount < MAX_FACTORY_FLOORS} />}

            {selectedIds.length === 1 && selectedId && view !== 'flow' && (
              <aside className={`fm-device-drawer glass3d ${view === 'build' || auxPanel === 'catalog' ? 'is-workspace-compact' : ''}`} aria-label={selectedIsVehicle ? '载具状态' : '设备详情'}>
                <div className="fm-device-drawer-bar">
                  <span>{selectedIsVehicle ? 'VEHICLE / LIVE STATUS' : 'DEVICE / LIVE INSPECTOR'}</span>
                  <button type="button" onClick={() => select(null)} aria-label={selectedIsVehicle ? '关闭载具状态' : '关闭设备详情'}><MorphingIcon icon={XData} size={16} /></button>
                </div>
                <InfoPanel />
              </aside>
            )}
            {selectedIds.length > 1 && view !== 'flow' && (
              <div className="fm-multi-selection-badge glass3d" role="status" data-testid="multi-selection-count">
                <span>MULTI SELECT</span><b>已选择 {selectedIds.length} 个对象</b><small>DELETE 批量删除 · 点击空白处取消</small>
              </div>
            )}

            {view !== 'flow' && <div className="fm-viewport-header">
              <div>
                <div className="fm-eyebrow"><span>{meta.code}</span> / LIVE VIEW</div>
                <h1>{meta.title}</h1>
                <p>{meta.description}</p>
              </div>
              <div className="fm-view-readout">
                <span className="fm-readout-label">CAMERA</span>
                <strong>{view === 'build' || view === 'diagnostics' ? 'TOP-DOWN' : 'ISOMETRIC'}</strong>
              </div>
            </div>}

            {view !== 'flow' && showViewportTools && <div className="fm-viewport-tools">
              <span className="fm-coord-label">X 00.0 &nbsp; Y 00.0 &nbsp; Z 00.0</span>
              <span className="fm-grid-label">GRID / 1M</span>
              {view === 'overview' && <span className="fm-camera-hint"><b>CAMERA</b> DRAG / ORBIT · RMB / PAN · WHEEL / ZOOM</span>}
            </div>}

            {view !== 'flow' && <div className="fm-viewport-footer">
              {showInterfaceHints && <div className="fm-key-hint fm-key-hint-undo"><kbd>CTRL</kbd><kbd>Z</kbd> 撤回 <kbd>CTRL</kbd><kbd>SHIFT</kbd><kbd>Z</kbd> 重做</div>}
              {showInterfaceHints && <div className="fm-key-hint"><kbd>WASD</kbd> 移动 <kbd>Q/E</kbd> 左右旋转 <kbd>SHIFT+拖动</kbd> 框选 <kbd>DELETE</kbd> 删除</div>}
              <div className={`fm-run-state ${playing ? 'is-running' : ''}`}><span /> {playing ? '仿真运行中' : '仿真已暂停'}</div>
            </div>}

            {view !== 'flow' && <div className={`fm-dock-cluster ${view !== 'overview' ? 'is-mode-open' : ''}`} aria-label="快速视角与业务工作区">
              <div className="fm-view-dock">
                {VIEW_ORDER.map((key) => (
                  <button key={key} className={view === key ? 'is-active' : ''} onClick={() => changeView(key)}>
                    <span>{VIEW_META[key].code}</span>{VIEW_META[key].label}
                  </button>
                ))}
              </div>
              {view === 'overview' && <div className="fm-aux-dock">
                <button type="button" className={auxPanel === 'productionRoute' ? 'is-active' : ''} onClick={() => { setView('overview'); setBuildType(null); setAuxPanel('productionRoute') }}><span>05</span>生产路线</button>
                <button type="button" className={auxPanel === 'catalog' ? 'is-active' : ''} onClick={() => { setView('overview'); setBuildType(null); setAuxPanel('catalog') }}><span>06</span>生产资料</button>
              </div>}
            </div>}

            <Suspense fallback={null}>
              {view === 'flow' ? <ProductionWorkspace /> : view === 'diagnostics' ? diagnosticsSurface === 'generate' ? <GenerativeFactoryWorkspace onSurfaceChange={setDiagnosticsSurface} /> : <FactoryAgentWorkspace currentProject={currentProject} onLocate={() => setView('overview')} onEnterGenerative={() => setDiagnosticsSurface('generate')} /> : view !== 'overview' && (
                <div className={`fm-mode-panel fm-mode-panel-${view} is-open`}>
                  {view === 'build' ? <BuildMenu compact /> : <ViewSummary view={view} counts={counts} />}
                  <div className="fm-mode-shortcuts" aria-label="快捷键">
                    <kbd>ESC</kbd><span>返回</span>
                    <kbd>R</kbd><span>旋转</span>
                    <kbd>CTRL</kbd><kbd>Z</kbd><span>撤回</span>
                    <kbd>CTRL</kbd><kbd>SHIFT</kbd><kbd>Z</kbd><span>重做</span>
                  </div>
                </div>
              )}
            </Suspense>
            <Suspense fallback={null}>
              {auxPanel === 'productionRoute' && <ProductionRouteWorkspace onClose={() => setAuxPanel(null)} />}
              {auxPanel === 'catalog' && <FactoryCatalogWorkspace activeSection={catalogSection} onSectionChange={setCatalogSection} onClose={() => setAuxPanel(null)} />}
            </Suspense>

          </section>

          <section className="fm-kpi-strip" aria-label="工厂关键指标">
            <Kpi label="生产效率" value={`${liveKpis.productionEfficiency.toFixed(1)}%`} trend={snapshot.timeSec > 0 ? `${liveKpis.outputRatePerMinute.toFixed(1)} units / min` : '等待仿真'} tone="amber" />
            <Kpi label="设备利用率" value={`${liveKpis.utilization.toFixed(1)}%`} trend={`${liveKpis.activeMachines} / ${counts.machines} 台运行`} />
            <Kpi label="实时产出" value={liveKpis.outputRatePerMinute.toFixed(1)} trend={`${liveKpis.producedTotal} units / session`} />
            <Kpi label="物流负载" value={`${liveKpis.logisticsLoad.toFixed(1)}%`} trend={`${snapshot.itemLots.length} / ${counts.conveyors} 槽位`} tone="cyan" />
            <AssistantOrb compact />
            <AssistantVoiceButton />
            <div className="fm-kpi-context"><span className="fm-context-dot" /> {activeTool}</div>
          </section>
        </main>

        <aside className="fm-right-panel" aria-label="数据面板">
          <div className="fm-panel-heading">
            <div><span className="fm-eyebrow">FACTORY STATUS</span><h2>基地运行舱</h2></div>
            <span className="fm-panel-index">{floorCount}F</span>
          </div>
          <div className="fm-stat-grid">
            <MiniStat label="设施" value={objects.length} />
            <MiniStat label="物品" value={items.length} />
            <MiniStat label="配方" value={recipes.length} />
            <MiniStat label="物流" value={counts.sources + counts.conveyors} />
          </div>
          <div className="fm-panel-rule" />
          <div className="fm-panel-scroll">
            <SimPanel />
            <RuntimeOverviewCard snapshot={snapshot} liveKpis={liveKpis} counts={counts} trendHistory={trendHistory} playing={playing} />
          </div>
        </aside>
      </div>
      <FactoryProjectDialog
        open={projectDialogOpen}
        required={!projectReady}
        currentProject={currentProject}
        onReady={handleProjectReady}
        onProjectDeleted={(projectId) => setCurrentProject((project) => project?.id === projectId ? null : project)}
        onClose={() => setProjectDialogOpen(false)}
      />
    </div>
  )
}

function Kpi({ label, value, trend, tone = 'default' }: { label: string; value: string; trend: string; tone?: 'default' | 'amber' | 'cyan' }) {
  return <div className={`fm-kpi ${tone}`}><span>{label}</span><strong>{value}</strong><small>{trend}</small></div>
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return <div className="fm-mini-stat"><span>{label}</span><strong>{value.toString().padStart(2, '0')}</strong></div>
}

function RuntimeOverviewCard({ snapshot, liveKpis, counts, trendHistory, playing }: { snapshot: SimulationSnapshot; liveKpis: LiveKpiData; counts: { machines: number; conveyors: number; sources: number }; trendHistory: number[]; playing: boolean }) {
  const producedTotal = Object.values(snapshot.stats.produced).reduce((sum, value) => sum + value, 0)
  const activeSources = snapshot.sources.filter((source) => source.state !== 'idle').length
  const chartPoints = sparklinePoints(trendHistory)

  return (
    <section className={`fm-runtime-card ${playing ? 'is-live' : 'is-paused'}`} aria-label="生产运行状态与物流趋势">
      <header className="fm-runtime-card-head">
        <div><span className="fm-runtime-card-kicker">RUNTIME / FLOW SIGNAL</span><strong>生产运行状态</strong></div>
        <span className="fm-runtime-card-state"><i /> {playing ? 'RUNNING' : 'PAUSED'}</span>
      </header>
      <div className="fm-runtime-status-grid">
        <div><span>逻辑时间</span><strong>{formatRuntimeTime(snapshot.timeSec)}</strong></div>
        <div><span>在途物料</span><strong>{snapshot.itemLots.length}</strong></div>
        <div><span>设备利用率</span><strong>{liveKpis.utilization.toFixed(1)}%</strong></div>
        <div><span>实时产出</span><strong>{liveKpis.outputRatePerMinute.toFixed(1)}<small> / min</small></strong></div>
      </div>
      <div className="fm-runtime-flow">
        <div className="fm-runtime-section-label"><span>物流流向</span><small>{activeSources} 个供料端活动</small></div>
        <div className="fm-runtime-flow-line">
          <div><strong>{counts.sources.toString().padStart(2, '0')}</strong><span>供料端</span></div><b>→</b>
          <div><strong>{liveKpis.activeMachines.toString().padStart(2, '0')}</strong><span>加工中</span></div><b>→</b>
          <div><strong>{snapshot.itemLots.length.toString().padStart(2, '0')}</strong><span>在途</span></div><b>→</b>
          <div><strong>{producedTotal.toString().padStart(2, '0')}</strong><span>已产出</span></div>
        </div>
      </div>
      <div className="fm-runtime-trend">
        <div className="fm-runtime-trend-head"><span>产出趋势 / UNITS PER MINUTE</span><strong>{liveKpis.outputRatePerMinute.toFixed(1)}</strong></div>
        <svg viewBox="0 0 180 42" preserveAspectRatio="none" role="img" aria-label="实时产出趋势图">
          <path className="fm-runtime-trend-grid" d="M0 10H180M0 21H180M0 32H180" />
          <polyline points={chartPoints} />
        </svg>
        <div className="fm-runtime-trend-foot"><span>LIVE SAMPLE</span><span>{counts.conveyors} 条物流段 · {liveKpis.logisticsLoad.toFixed(1)}% 负载</span></div>
      </div>
    </section>
  )
}

function formatRuntimeTime(seconds: number) {
  const minutes = Math.floor(seconds / 60)
  const remainder = (seconds % 60).toFixed(1).padStart(4, '0')
  return `${String(minutes).padStart(2, '0')}:${remainder}`
}

function sparklinePoints(values: number[]) {
  const source = values.length > 1 ? values : [0, 0]
  const max = Math.max(1, ...source)
  return source.map((value, index) => `${(index / (source.length - 1)) * 180},${38 - (Math.max(0, value) / max) * 30}`).join(' ')
}

function readTargetFps(): DaiyuTargetFps {
  if (typeof window === 'undefined') return 60
  return window.localStorage.getItem(TARGET_FPS_STORAGE_KEY) === '120' ? 120 : 60
}

function ViewSummary({ view, counts }: { view: FactoryView; counts: { machines: number; conveyors: number; sources: number } }) {
  const copy: Record<FactoryView, { lead: string; items: string[] }> = {
    overview: { lead: '基地正在以设备、物流和产能三个层面汇总运行状态。选择设备可查看端口与配方。', items: ['设备健康度', `${counts.machines} 台加工单元在线`, `${counts.conveyors} 条物流段`, '点击视口中的设备查看详情'] },
    build: { lead: '', items: [] },
    flow: { lead: '物流视图突出显示入口、出口和物料运动方向。物料沿真实吸附接口逐段传递。', items: ['入口 / 蓝色端口', '出口 / 琥珀端口', '货物沿连接方向移动', '切换到建造页编辑线路'] },
    diagnostics: { lead: '诊断视图聚焦节拍、堵塞和设备利用率，为下一轮布局优化提供依据。', items: ['检查无配方设备', '定位输送带末端堵塞', '观察实时利用率', '使用右侧仿真控制'] },
  }
  const data = copy[view]
  return <div className="fm-view-summary"><p>{data.lead}</p><div className="fm-summary-list">{data.items.map((item) => <div key={item}><span />{item}</div>)}</div><div className="fm-summary-foot">{view === 'flow' ? 'FLOW AXIS / CONNECTED PORTS' : view === 'diagnostics' ? 'DIAGNOSTICS / LIVE SIGNAL' : 'OVERVIEW / LIVE SIGNAL'}</div></div>
}

export default App
