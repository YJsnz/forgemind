import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  Activity as ActivityData,
  ArrowRight as ArrowRightData,
  ArrowUpRight as ArrowUpRightData,
  BookOpen as BookOpenData,
  Boxes as BoxesData,
  CheckCircle2 as CheckCircleData,
  ChevronDown as ChevronDownData,
  CloudCog as CloudCogData,
  Cloud as CloudData,
  Database as DatabaseData,
  FileCheck2 as FileCheckData,
  Factory as FactoryData,
  GitBranch as GitBranchData,
  HardDrive as HardDriveData,
  LayoutDashboard as LayoutDashboardData,
  Link2 as LinkData,
  ListChecks as ListChecksData,
  LogOut as LogOutData,
  Menu as MenuData,
  MoreHorizontal as MoreData,
  PackageCheck as PackageCheckData,
  Radio as RadioData,
  Orbit as OrbitData,
  Search as SearchData,
  Settings as SettingsData,
  ShieldCheck as ShieldCheckData,
  Users as UsersData,
  X as XData,
} from 'lucide'
import { MorphingIcon } from './MorphingIcon'
import { fetchFactoryProject } from '../api/factoryProjects'
 import { addForgeCloudMember, addForgeCloudProjectMember, aggregateForgeCloudTelemetryWindow, createForgeCloudApproval, createForgeCloudAsset, createForgeCloudAssetTwin, createForgeCloudAssetVersion, createForgeCloudComment, createForgeCloudConnector, createForgeCloudDataPoint, createForgeCloudProject, createForgeCloudProjectVersion, createForgeCloudPublication, createForgeCloudRelease, createForgeCloudTagMapping, createForgeCloudTask, createForgeCloudTwin, createForgeCloudWorkspace, createForgeCloudMaintenanceRecord, createForgeCloudQualityResult, createForgeCloudWorkOrder, decideForgeCloudApproval, heartbeatForgeCloudDevice, ingestForgeCloudDataEvent, listForgeCloudAssetVersions, listForgeCloudComments, listForgeCloudProjectMembers, loadForgeCloudSnapshot, markForgeCloudNotificationsRead, queueForgeCloudAiTask, registerForgeCloudDevice, runForgeCloudAiTask, runForgeCloudConnectorSync, updateForgeCloudMemberRole, updateForgeCloudTaskStatus, updateForgeCloudWorkOrderStatus, uploadForgeCloudAssetBlob, type ForgeCloudApproval, type ForgeCloudArchive, type ForgeCloudAsset, type ForgeCloudAssetTwin, type ForgeCloudComment, type ForgeCloudConnector, type ForgeCloudConnectorSyncRun, type ForgeCloudDataPoint, type ForgeCloudDatabaseStatus, type ForgeCloudHealth, type ForgeCloudLayer, type ForgeCloudMaintenanceRecord, type ForgeCloudMember, type ForgeCloudProject, type ForgeCloudProjectMember, type ForgeCloudQualityResult, type ForgeCloudRelease, type ForgeCloudRuntimeEvent, type ForgeCloudTagMapping, type ForgeCloudTask, type ForgeCloudTelemetryWindow, type ForgeCloudTwin, type ForgeCloudWorkOrder } from '../api/forgeCloud'

type CloudSection = 'overview' | 'projects' | 'assets' | 'releases' | 'connections' | 'operations' | 'tasks' | 'members' | 'audit' | 'devices' | 'twins' | 'data' | 'ai'

type ForgeCloudConsoleProps = {
  onExit: () => void
  onLogout: () => void
  onEnterWorkspace: () => void
  onNavigatePortal: (path: string) => void
}

type CloudDialog =
  | { kind: 'workspace' }
  | { kind: 'project' }
  | { kind: 'version'; projectId: string; projectName: string; baseVersionId: string }
  | { kind: 'project-access'; projectId: string; projectName: string; members: ForgeCloudProjectMember[] }
  | { kind: 'release' }
  | { kind: 'publication' }
  | { kind: 'asset' }
  | { kind: 'asset-version'; assetId: string; assetName: string; currentVersion: number; currentManifest: unknown }
  | { kind: 'mapping' }
  | { kind: 'asset-twin' }
  | { kind: 'comment'; projectId: string; projectName: string; comments: ForgeCloudComment[] }
  | { kind: 'member' }
  | { kind: 'role'; member: ForgeCloudMember }
  | { kind: 'task' }
  | { kind: 'approval' }
  | { kind: 'connector' }
  | { kind: 'device' }
  | { kind: 'twin' }
  | { kind: 'data-point' }
  | { kind: 'ai-task' }
  | { kind: 'work-order' }
  | { kind: 'quality-result' }
  | { kind: 'maintenance-record' }
  | { kind: 'telemetry-window' }

type CloudDialogPayload = { name: string; username: string; role: string; title: string; detail: string; priority: string; type: string; endpoint: string; deviceKey: string; twinKey: string; pointKey: string; label: string; dataType: string; unit: string; projectId: string; memberUserId: string; notes: string; externalId: string; visibility: string; license: string; manifestText: string; connectorId: string; dataPointId: string; twinId: string; sourceTag: string; semanticKey: string; transformText: string; assetFile: File | null; forgeLabPostId: string; body: string; objectId: string; rollbackAvailable: boolean; windowStart: string; windowEnd: string; metric: string; lotId: string; inspectionType: string; qualityResult: string; faultCode: string; action: string; downtimeSecondsText: string }

const sectionMeta: Record<CloudSection, { label: string; eyebrow: string; title: string; description: string }> = {
  overview: { label: '总览', eyebrow: 'CONTROL PLANE / LIVE STATE', title: '云端中枢', description: '把当前工厂存档、配方产物、共享资源和云端 API 汇聚到同一块可核验的运行面板。' },
  projects: { label: '项目', eyebrow: 'PROJECTS / VERSION LEDGER', title: '项目与版本', description: '管理工厂项目、分支、版本和已发布方案。' },
  assets: { label: '资源', eyebrow: 'ASSETS / REGISTRY', title: '资源注册表', description: '追踪模型、物品、机器和资源包的版本、许可与依赖。' },
  releases: { label: '发布', eyebrow: 'RELEASES / PUBLICATION', title: '发布中心', description: '把经过验证的项目版本和资源版本交给团队或社区复用。' },
  connections: { label: '连接', eyebrow: 'CONNECT / SIGNAL ROUTING', title: '工业连接', description: '管理数据源、设备映射、质量状态和运行摘要。' },
  operations: { label: '运行与质量', eyebrow: 'OPERATE / QUALITY LEDGER', title: '运行与质量', description: '把运行事件聚合成可核验的遥测窗口，并追踪工单、质量结论与维护结果。' },
  tasks: { label: '任务与审批', eyebrow: 'WORK / APPROVAL QUEUE', title: '任务与审批', description: '集中处理 Agent 方案、资源审核、发布和现场任务。' },
  members: { label: '成员', eyebrow: 'WORKSPACE / ACCESS', title: '成员与权限', description: '控制工作空间成员、项目角色和服务账号访问范围。' },
  audit: { label: '审计', eyebrow: 'GOVERNANCE / AUDIT TRAIL', title: '活动与审计', description: '查看每次发布、修改、下载、审批和连接变更的责任链。' },
  devices: { label: '设备', eyebrow: 'DEVICE CLOUD / REGISTRY', title: '设备云', description: '登记设备身份、现场端点、在线心跳和可审计命令队列。' },
  twins: { label: '孪生', eyebrow: 'TWIN CLOUD / STATE', title: '孪生云', description: '管理设备与产线的数字孪生状态、质量码和来源映射。' },
  data: { label: '数据', eyebrow: 'DATA CLOUD / TELEMETRY', title: '数据云', description: '查看数据点、单位、遥测事件和历史接收时间。' },
  ai: { label: 'AI', eyebrow: 'AI CLOUD / INFERENCE', title: 'AI 云', description: '统一查看规则模型、推理任务和后续可接入的模型供应商。' },
}

const navGroups: Array<{ label: string; items: Array<{ id: CloudSection; icon: typeof LayoutDashboardData }> }> = [
  { label: 'CONTROL', items: [{ id: 'overview', icon: LayoutDashboardData }, { id: 'projects', icon: GitBranchData }, { id: 'assets', icon: BoxesData }, { id: 'releases', icon: PackageCheckData }] },
  { label: 'OPERATE', items: [{ id: 'connections', icon: LinkData }, { id: 'operations', icon: ActivityData }, { id: 'tasks', icon: ListChecksData }] },
  { label: 'INTELLIGENCE', items: [{ id: 'devices', icon: RadioData }, { id: 'twins', icon: CloudCogData }, { id: 'data', icon: ActivityData }, { id: 'ai', icon: ShieldCheckData }] },
  { label: 'GOVERN', items: [{ id: 'members', icon: UsersData }, { id: 'audit', icon: FileCheckData }] },
]

type ProjectDisplayRow = { projectId?: string; currentVersionId?: string; accessRole?: string; name: string; code: string; version: string; branch: string; owner: string; state: string; stateTone: string; resources: string; source: string }
type AssetDisplayRow = { assetId?: string; name: string; id: string; version: string; type: string; license: string; usage: string; state: string; tone: string }

const projectRows: ProjectDisplayRow[] = [
  { name: 'WZH 三层轻量完整产线', code: 'FACTORY / WZH-001', version: 'v18', branch: 'main', owner: '王工', state: '已发布', stateTone: 'green', resources: '12 个资源', source: '仿真 + 回放' },
  { name: 'A-02 齿轮箱装配线', code: 'FACTORY / A02-014', version: 'v07', branch: 'proposal/balance', owner: '李工', state: '待审批', stateTone: 'amber', resources: '8 个资源', source: '确定性仿真' },
  { name: '视觉检测单元模板', code: 'TEMPLATE / VISION-003', version: 'v03', branch: 'release', owner: 'ForgeMind', state: '草稿', stateTone: 'muted', resources: '5 个资源', source: '资源模板' },
]

const assetRows: AssetDisplayRow[] = [
  { name: 'CNC 加工中心', id: 'asset_cnc_001', version: 'v3', type: '机器模型', license: 'CC BY 4.0', usage: '12 个项目', state: '已发布', tone: 'green' },
  { name: '精密齿轮箱', id: 'item_gearbox_004', version: 'v2', type: '物品资源', license: 'Forge 私有', usage: '4 个项目', state: '待审核', tone: 'amber' },
  { name: '视觉质检资源包', id: 'pack_vision_003', version: 'v1', type: '资源包', license: '待复核', usage: '0 个项目', state: '草稿', tone: 'muted' },
]

const auditRows = [
  { actor: '王工', source: 'ForgeMind', action: '提交项目版本', target: 'WZH / v18', result: '成功', time: '今天 14:32' },
  { actor: 'ForgeCloud', source: '系统', action: '生成资源校验报告', target: 'asset_cnc_001 / v3', result: '成功', time: '今天 14:21' },
  { actor: '李工', source: 'ForgeMove', action: '确认维护任务', target: 'TASK-031', result: '成功', time: '今天 14:18' },
  { actor: '系统', source: 'MQTT', action: '连接心跳超时', target: 'MQTT-01', result: '需处理', time: '今天 14:05' },
]

function projectRowsFromRemote(rows: ForgeCloudProject[]) {
  return rows.map((row) => ({
    projectId: row.id,
    currentVersionId: row.currentVersionId,
    accessRole: row.accessRole,
    name: row.name,
    code: `FACTORY / ${row.id.slice(0, 8).toUpperCase()}`,
    version: `v${Math.max(1, row.version)}`,
    branch: row.branch || 'main',
    owner: '工作空间成员',
    state: row.status === 'active' ? '已同步' : row.status,
    stateTone: row.status === 'active' ? 'green' : 'muted',
    resources: '云端索引中',
    source: `存档 V${row.schemaVersion}`,
  }))
}

function assetRowsFromRemote(rows: ForgeCloudAsset[]): AssetDisplayRow[] {
  return rows.map((row) => ({
    assetId: row.id,
    name: row.name,
    id: row.externalId || row.id,
    version: `v${Math.max(1, row.version)}`,
    type: row.kind === 'model3d' ? '机器模型' : row.kind,
    license: assetLicense(row.manifest),
    usage: row.fileCount ? `${row.fileCount} 个文件本体` : '尚无文件本体',
    state: row.status === 'published' ? '已发布' : row.status,
    tone: row.status === 'published' ? 'green' : 'muted',
  }))
}

function assetLicense(manifest: ForgeCloudAsset['manifest']) {
  if (!manifest || typeof manifest !== 'object') return '待补许可证'
  const license = (manifest as { license?: { spdx?: string; expression?: string; declaration?: string } }).license
  return license?.spdx || license?.expression || license?.declaration || '待补许可证'
}

function CloudIcon({ icon: Icon, size = 16 }: { icon: typeof LayoutDashboardData; size?: number }) {
  return <MorphingIcon icon={Icon} size={size} strokeWidth={1.7} aria-hidden="true" />
}

function workspaceInitials(name?: string) {
  const value = name?.trim() || '云端'
  const chinese = [...value].filter((character) => /[\u4e00-\u9fff]/.test(character))
  if (chinese.length >= 2) return chinese.slice(0, 2).join('')
  return value.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || 'FC'
}

export function ForgeCloudConsole({ onExit, onLogout, onEnterWorkspace, onNavigatePortal }: ForgeCloudConsoleProps) {
  const [section, setSection] = useState<CloudSection>('overview')
  const [workspaceOpen, setWorkspaceOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [globalNavOpen, setGlobalNavOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [notice, setNotice] = useState('')
  const [remoteSnapshot, setRemoteSnapshot] = useState<Awaited<ReturnType<typeof loadForgeCloudSnapshot>> | null>(null)
  const [remoteState, setRemoteState] = useState<'loading' | 'online' | 'offline'>('loading')
  const [dialog, setDialog] = useState<CloudDialog | null>(null)
  const [dialogBusy, setDialogBusy] = useState(false)
  const [dialogError, setDialogError] = useState('')
  const meta = sectionMeta[section]

  useEffect(() => {
    let cancelled = false
    setRemoteState('loading')
    void loadForgeCloudSnapshot()
      .then((snapshot) => {
        if (cancelled) return
        setRemoteSnapshot(snapshot)
        setRemoteState('online')
      })
      .catch(() => {
        if (!cancelled) setRemoteState('offline')
      })
    return () => { cancelled = true }
  }, [])

  const filteredProjects = useMemo(() => {
    const query = search.trim().toLowerCase()
    const rows = remoteSnapshot ? projectRowsFromRemote(remoteSnapshot.projects) : projectRows
    if (!query) return rows
    return rows.filter((row) => `${row.name} ${row.code} ${row.owner}`.toLowerCase().includes(query))
  }, [remoteSnapshot, search])

  const selectSection = (next: CloudSection) => {
    setSection(next)
    setMobileNavOpen(false)
    setNotice('')
  }

  const navigatePortal = (path: string) => {
    setGlobalNavOpen(false)
    onNavigatePortal(path)
  }

  const showNotice = (message: string) => {
    setNotice(message)
    window.setTimeout(() => setNotice((current) => current === message ? '' : current), 2800)
  }

  const refreshWorkspace = async (workspaceId = remoteSnapshot?.workspace.id) => {
    setRemoteState('loading')
    try {
      const snapshot = await loadForgeCloudSnapshot(workspaceId)
      setRemoteSnapshot(snapshot)
      setRemoteState('online')
      return snapshot
    } catch (error) {
      setRemoteState('offline')
      throw error
    }
  }

  const switchWorkspace = (workspaceId: string) => {
    if (workspaceId === remoteSnapshot?.workspace.id) {
      setWorkspaceOpen(false)
      return
    }
    setWorkspaceOpen(false)
    void refreshWorkspace(workspaceId)
      .then((snapshot) => showNotice(`已切换到 ${snapshot.workspace.name}`))
      .catch((error: unknown) => showNotice(error instanceof Error ? error.message : '工作空间切换失败'))
  }

  const openDialog = (next: CloudDialog) => {
    setDialogError('')
    setDialog(next)
  }

  const openProjectComments = (projectId: string | undefined, projectName: string) => {
    if (!remoteSnapshot || !projectId) {
      showNotice('离线预览没有可用的项目评论对象')
      return
    }
    setDialogError('')
    void listForgeCloudComments(remoteSnapshot.workspace.id, 'project', projectId)
      .then((comments) => setDialog({ kind: 'comment', projectId, projectName, comments }))
      .catch((error: unknown) => showNotice(error instanceof Error ? error.message : '评论加载失败'))
  }

  const openProjectVersion = (projectId: string | undefined, projectName: string, baseVersionId: string | undefined) => {
    if (!remoteSnapshot || !projectId || !baseVersionId) {
      showNotice('当前项目没有可提交的云端版本基线')
      return
    }
    openDialog({ kind: 'version', projectId, projectName, baseVersionId })
  }

  const openProjectAccess = (projectId: string | undefined, projectName: string) => {
    if (!remoteSnapshot || !projectId) {
      showNotice('离线预览没有可用的项目授权对象')
      return
    }
    void listForgeCloudProjectMembers(projectId)
      .then((members) => openDialog({ kind: 'project-access', projectId, projectName, members }))
      .catch((error: unknown) => showNotice(error instanceof Error ? error.message : '项目成员加载失败'))
  }

  const openAssetVersion = (assetId: string | undefined, assetName: string) => {
    if (!remoteSnapshot || !assetId) {
      showNotice('离线预览没有可用的资源版本对象')
      return
    }
    void listForgeCloudAssetVersions(assetId)
      .then((versions) => {
        const current = versions.find((version) => version.current) ?? versions[0]
        if (!current) throw new Error('当前资源没有可用版本')
        openDialog({ kind: 'asset-version', assetId, assetName, currentVersion: current.version, currentManifest: current.manifest })
      })
      .catch((error: unknown) => showNotice(error instanceof Error ? error.message : '资源版本加载失败'))
  }

  const runConnectorReplay = (connectorId: string) => {
    if (!remoteSnapshot) {
      showNotice('请先连接 ForgeCloud')
      return
    }
    void runForgeCloudConnectorSync(connectorId)
      .then((run) => refreshWorkspace(remoteSnapshot.workspace.id).then(() => run))
      .then((run) => showNotice(run.status === 'completed' ? `同步回放完成：读取 ${run.eventsRead} 条事件，写入 ${run.valuesWritten} 个值` : `同步回放未完成：${run.error ?? run.status}`))
      .catch((error: unknown) => showNotice(error instanceof Error ? error.message : '同步回放失败'))
  }

  const submitDialog = async (payload: CloudDialogPayload) => {
    if (!dialog) return
    setDialogBusy(true)
    setDialogError('')
    try {
    if (dialog.kind === 'workspace') {
        const created = await createForgeCloudWorkspace(payload.name)
        const snapshot = await refreshWorkspace(created.id)
        showNotice(`工作空间 ${snapshot.workspace.name} 已创建`)
      } else if (dialog.kind === 'project') {
        if (!remoteSnapshot) throw new Error('请先连接 ForgeCloud')
        await createForgeCloudProject(remoteSnapshot.workspace.id, payload.name)
        await refreshWorkspace(remoteSnapshot.workspace.id)
        showNotice('空白工厂项目已创建，初始版本已登记')
      } else if (dialog.kind === 'version') {
        if (!remoteSnapshot) throw new Error('请先连接 ForgeCloud')
        const project = await fetchFactoryProject(dialog.projectId)
        await createForgeCloudProjectVersion(dialog.projectId, dialog.baseVersionId, project.save, payload.notes || 'ForgeCloud 页面提交版本')
        await refreshWorkspace(remoteSnapshot.workspace.id)
        showNotice(`${dialog.projectName} 已创建新的云端版本`)
      } else if (dialog.kind === 'project-access') {
        if (!remoteSnapshot) throw new Error('请先连接 ForgeCloud')
        if (!payload.memberUserId) throw new Error('请选择工作空间成员')
        await addForgeCloudProjectMember(dialog.projectId, payload.memberUserId, payload.role as 'manager' | 'editor' | 'viewer')
        await refreshWorkspace(remoteSnapshot.workspace.id)
        showNotice(`${dialog.projectName} 的项目访问权限已更新`)
      } else if (dialog.kind === 'asset') {
        if (!remoteSnapshot) throw new Error('请先连接 ForgeCloud')
        const asset = await createForgeCloudAsset({ workspaceId: remoteSnapshot.workspace.id, externalId: payload.externalId, kind: payload.type || 'model3d', name: payload.name, visibility: payload.visibility || 'private', manifest: { manifestVersion: 1, source: 'ForgeCloud metadata registry', license: payload.license ? { declaration: payload.license } : {}, dependencies: [] } })
        if (payload.assetFile) await uploadForgeCloudAssetBlob(asset.id, payload.assetFile)
        await refreshWorkspace(remoteSnapshot.workspace.id)
        showNotice(payload.assetFile ? '资源元数据和文件本体已登记' : '资源元数据和 v1 manifest 已登记')
      } else if (dialog.kind === 'asset-version') {
        if (!remoteSnapshot) throw new Error('请先连接 ForgeCloud')
        let manifest: unknown
        try {
          manifest = JSON.parse(payload.manifestText)
        } catch {
          throw new Error('manifest 必须是合法 JSON')
        }
        const version = await createForgeCloudAssetVersion({ assetId: dialog.assetId, manifest, note: payload.notes || `基于 v${dialog.currentVersion} 的资源更新` })
        await refreshWorkspace(remoteSnapshot.workspace.id)
        showNotice(`${dialog.assetName} 已创建 v${version.version}，历史版本保持不变`)
      } else if (dialog.kind === 'publication') {
        if (!remoteSnapshot) throw new Error('请先连接 ForgeCloud')
        await createForgeCloudPublication({ workspaceId: remoteSnapshot.workspace.id, sourceType: payload.type || 'project_release', sourceId: payload.objectId, forgeLabPostId: payload.forgeLabPostId, licenseSnapshot: { declaration: payload.detail, capturedAt: new Date().toISOString(), source: 'ForgeCloud control plane' } })
        await refreshWorkspace(remoteSnapshot.workspace.id)
        showNotice('ForgeLab 关联已创建，来源版本已锁定')
      } else if (dialog.kind === 'release') {
        if (!remoteSnapshot) throw new Error('请先连接 ForgeCloud')
        const project = remoteSnapshot.projects.find((row) => row.id === payload.projectId)
        if (!project?.currentVersionId) throw new Error('所选项目暂无可发布的当前版本')
        await createForgeCloudRelease(project.id, project.currentVersionId, payload.name, payload.notes)
        await refreshWorkspace(remoteSnapshot.workspace.id)
        showNotice(`${project.name} 的当前版本已发布`)
      } else if (dialog.kind === 'comment') {
        if (!remoteSnapshot) throw new Error('请先连接 ForgeCloud')
        await createForgeCloudComment({ workspaceId: remoteSnapshot.workspace.id, objectType: 'project', objectId: dialog.projectId, body: payload.body })
        await refreshWorkspace(remoteSnapshot.workspace.id)
        showNotice('项目评论已发布并写入审计')
      } else if (dialog.kind === 'member') {
        if (!remoteSnapshot) throw new Error('请先连接 ForgeCloud')
        await addForgeCloudMember(remoteSnapshot.workspace.id, payload.username, payload.role)
        await refreshWorkspace(remoteSnapshot.workspace.id)
        showNotice(`${payload.username} 已加入当前工作空间`)
      } else if (dialog.kind === 'role') {
        if (!remoteSnapshot) throw new Error('请先连接 ForgeCloud')
        await updateForgeCloudMemberRole(remoteSnapshot.workspace.id, dialog.member.userId, payload.role)
        await refreshWorkspace(remoteSnapshot.workspace.id)
        showNotice(`${dialog.member.username} 已更新为 ${payload.role.toUpperCase()}`)
      } else {
        if (!remoteSnapshot) throw new Error('请先连接 ForgeCloud')
        const workspaceId = remoteSnapshot.workspace.id
        if (dialog.kind === 'task') {
          await createForgeCloudTask({ workspaceId, type: payload.type || 'general', title: payload.title, detail: payload.detail, priority: payload.priority || 'normal' })
          await refreshWorkspace(workspaceId)
          showNotice('任务已创建并进入工作队列')
        } else if (dialog.kind === 'approval') {
          await createForgeCloudApproval({ workspaceId, projectId: payload.projectId || undefined, approvalType: payload.type || 'general', objectType: payload.type === 'release' ? 'project_release' : payload.type === 'resource' ? 'asset' : 'project', objectId: payload.objectId, title: payload.title, detail: payload.detail, evidence: { source: 'ForgeCloud control plane', capturedAt: new Date().toISOString() }, rollbackAvailable: payload.rollbackAvailable })
          await refreshWorkspace(workspaceId)
          showNotice('审批请求已提交并写入审计')
        } else if (dialog.kind === 'connector') {
          await createForgeCloudConnector({ workspaceId, name: payload.name, type: payload.type || 'csv', endpoint: payload.endpoint || undefined })
          await refreshWorkspace(workspaceId)
          showNotice('只读连接器已登记')
        } else if (dialog.kind === 'mapping') {
          let transform: unknown = {}
          try { transform = payload.transformText.trim() ? JSON.parse(payload.transformText) : {} } catch { throw new Error('变换规则必须是合法 JSON') }
          await createForgeCloudTagMapping({ workspaceId, connectorId: payload.connectorId, dataPointId: payload.dataPointId || undefined, twinId: payload.twinId || undefined, sourceTag: payload.sourceTag, semanticKey: payload.semanticKey, unit: payload.unit || undefined, transform })
          await refreshWorkspace(workspaceId)
          showNotice('数据映射已创建，可对连接器运行本地回放')
        } else if (dialog.kind === 'asset-twin') {
          await createForgeCloudAssetTwin({ workspaceId, projectId: payload.projectId || undefined, twinId: payload.twinId, factoryObjectId: payload.objectId || undefined, externalAssetId: payload.externalId || undefined, note: payload.notes || undefined })
          await refreshWorkspace(workspaceId)
          showNotice('AssetTwin 绑定已创建，工厂对象状态可追踪')
        } else if (dialog.kind === 'device') {
          await registerForgeCloudDevice({ workspaceId, deviceKey: payload.deviceKey, name: payload.name, type: payload.type || 'machine', endpoint: payload.endpoint || undefined })
          await refreshWorkspace(workspaceId)
          showNotice('设备身份已注册')
        } else if (dialog.kind === 'twin') {
          await createForgeCloudTwin({ workspaceId, twinKey: payload.twinKey, name: payload.name, type: payload.type || 'machine' })
          await refreshWorkspace(workspaceId)
          showNotice('数字孪生已创建')
        } else if (dialog.kind === 'data-point') {
          await createForgeCloudDataPoint({ workspaceId, pointKey: payload.pointKey, label: payload.label, dataType: payload.dataType || 'number', unit: payload.unit || undefined })
          await refreshWorkspace(workspaceId)
          showNotice('数据点已登记')
        } else if (dialog.kind === 'ai-task') {
          await queueForgeCloudAiTask({ workspaceId, type: payload.type || 'agent' })
          await refreshWorkspace(workspaceId)
          showNotice('AI 任务已进入队列')
        } else if (dialog.kind === 'work-order') {
          await createForgeCloudWorkOrder({ workspaceId, projectId: payload.projectId || undefined, twinId: payload.twinId || undefined, externalId: payload.externalId || undefined, type: payload.type || 'maintenance', title: payload.title, detail: payload.detail, priority: payload.priority || 'normal' })
          await refreshWorkspace(workspaceId)
          showNotice('工单已创建并写入运行台账')
        } else if (dialog.kind === 'quality-result') {
          const score = payload.notes.trim() ? Number(payload.notes) : undefined
          if (score !== undefined && (!Number.isFinite(score) || score < 0 || score > 100)) throw new Error('质量分数必须是 0–100 的数字')
          await createForgeCloudQualityResult({ workspaceId, projectId: payload.projectId || undefined, twinId: payload.twinId || undefined, workOrderId: payload.objectId || undefined, lotId: payload.lotId || undefined, inspectionType: payload.inspectionType || 'final_inspection', result: payload.qualityResult || 'unknown', score, evidenceRef: payload.externalId || undefined, detail: payload.detail })
          await refreshWorkspace(workspaceId)
          showNotice('质量结果已登记')
        } else if (dialog.kind === 'maintenance-record') {
          const downtimeSeconds = payload.downtimeSecondsText.trim() ? Number(payload.downtimeSecondsText) : 0
          if (!Number.isFinite(downtimeSeconds) || downtimeSeconds < 0) throw new Error('停机时长必须是非负数字')
          await createForgeCloudMaintenanceRecord({ workspaceId, projectId: payload.projectId || undefined, twinId: payload.twinId || undefined, workOrderId: payload.objectId || undefined, faultCode: payload.faultCode || undefined, action: payload.action, result: payload.qualityResult || 'reported', downtimeSeconds, detail: payload.detail })
          await refreshWorkspace(workspaceId)
          showNotice('维护记录已登记')
        } else if (dialog.kind === 'telemetry-window') {
          if (!payload.windowStart || !payload.windowEnd) throw new Error('请填写遥测窗口起止时间')
          await aggregateForgeCloudTelemetryWindow({ workspaceId, dataPointId: payload.dataPointId || undefined, twinId: payload.twinId || undefined, metric: payload.metric || undefined, windowStart: new Date(payload.windowStart).toISOString(), windowEnd: new Date(payload.windowEnd).toISOString() })
          await refreshWorkspace(workspaceId)
          showNotice('遥测窗口已聚合，异常样本保留在窗口统计中')
        }
      }
      setDialog(null)
    } catch (error) {
      setDialogError(error instanceof Error ? error.message : '操作失败，请稍后重试')
    } finally {
      setDialogBusy(false)
    }
  }

  return (
    <div className="fc-shell">
      <header className="fc-global-nav">
        <button className="fc-global-brand" type="button" onClick={() => navigatePortal('/')} aria-label="返回 ForgeMind 首页">
          <img src="/brand/forgemind-emblem.png" alt="" />
          <span><img src="/brand/forgemind-wordmark.png" alt="ForgeMind" /><small>DIGITAL FACTORY OS</small></span>
        </button>

        <nav className="fc-global-links" aria-label="ForgeMind 生态导航">
          <button type="button" onClick={() => navigatePortal('/product')}><CloudIcon icon={FactoryData} size={15} />产品介绍</button>
          <button type="button" onClick={() => navigatePortal('/docs')}><CloudIcon icon={BookOpenData} size={15} />官方文档</button>
          <button type="button" onClick={() => navigatePortal('/forgehub')}><CloudIcon icon={BoxesData} size={15} />ForgeHub</button>
          <button type="button" className="is-active" onClick={() => { setGlobalNavOpen(false); selectSection('overview') }}><CloudIcon icon={CloudData} size={15} />ForgeCloud</button>
          <button type="button" onClick={() => navigatePortal('/forgelab')}><CloudIcon icon={OrbitData} size={15} />ForgeLab</button>
        </nav>

        <div className="fc-global-actions">
          <button className="fc-global-cta" type="button" onClick={onEnterWorkspace}><span>01</span><span>进入工作台</span><CloudIcon icon={ArrowUpRightData} size={15} /></button>
          <button className="fc-global-menu" type="button" onClick={() => setGlobalNavOpen((open) => !open)} aria-label={globalNavOpen ? '关闭生态导航' : '打开生态导航'} aria-expanded={globalNavOpen}><CloudIcon icon={globalNavOpen ? XData : MenuData} size={19} /></button>
        </div>
      </header>

      {globalNavOpen && <nav className="fc-global-mobile-nav" aria-label="移动端 ForgeMind 生态导航">
        <button type="button" onClick={() => navigatePortal('/product')}><CloudIcon icon={FactoryData} size={16} /><span>产品介绍</span><CloudIcon icon={ArrowRightData} size={15} /></button>
        <button type="button" onClick={() => navigatePortal('/docs')}><CloudIcon icon={BookOpenData} size={16} /><span>官方文档</span><CloudIcon icon={ArrowRightData} size={15} /></button>
        <button type="button" onClick={() => navigatePortal('/forgehub')}><CloudIcon icon={BoxesData} size={16} /><span>ForgeHub</span><CloudIcon icon={ArrowRightData} size={15} /></button>
        <button type="button" className="is-active" onClick={() => { setGlobalNavOpen(false); selectSection('overview') }}><CloudIcon icon={CloudData} size={16} /><span>ForgeCloud</span><CloudIcon icon={ArrowRightData} size={15} /></button>
        <button type="button" onClick={() => navigatePortal('/forgelab')}><CloudIcon icon={OrbitData} size={16} /><span>ForgeLab</span><CloudIcon icon={ArrowRightData} size={15} /></button>
      </nav>}

      <div className="fc-console-shell">
      <header className="fc-topbar">
        <button className="fc-brand" type="button" onClick={() => selectSection('overview')} aria-label="返回 ForgeCloud 总览">
          <span className="fc-brand-emblem"><img src="/brand/forgecloud-logo.png" alt="" /></span>
          <span className="fc-brand-wordmark"><img src="/brand/forgecloud-logo.png" alt="ForgeCloud" /></span>
        </button>

        <div className={`fc-workspace-switcher ${workspaceOpen ? 'is-open' : ''}`}>
          <button className="fc-workspace-trigger" type="button" onClick={() => setWorkspaceOpen((open) => !open)} aria-expanded={workspaceOpen}>
            <span className="fc-workspace-avatar">{workspaceInitials(remoteSnapshot?.workspace.name)}</span>
            <span><small>WORKSPACE</small><strong>{remoteSnapshot?.workspace.name ?? '等待云端工作空间'}</strong></span>
            <CloudIcon icon={ChevronDownData} size={14} />
          </button>
          {workspaceOpen && <div className="fc-workspace-menu">
            <span className="fc-workspace-menu-label">AVAILABLE WORKSPACES</span>
            {remoteSnapshot?.workspaces.map((workspace) => <button type="button" className={workspace.id === remoteSnapshot.workspace.id ? 'is-current' : ''} key={workspace.id} onClick={() => switchWorkspace(workspace.id)}><span className="fc-workspace-option-avatar">{workspaceInitials(workspace.name)}</span><span><b>{workspace.name}</b><small>{workspace.role.toUpperCase()} · {workspace.projectCount} 个项目 · {workspace.memberCount} 位成员</small></span>{workspace.id === remoteSnapshot.workspace.id && <em>当前</em>}</button>)}
            {!remoteSnapshot && <span className="fc-workspace-empty">连接后显示已授权工作空间</span>}
            <button type="button" className="fc-workspace-create" onClick={() => { setWorkspaceOpen(false); openDialog({ kind: 'workspace' }) }}>＋ 创建工作空间</button>
          </div>}
        </div>

        <label className="fc-search"><CloudIcon icon={SearchData} size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索项目、资源、成员或事件" aria-label="搜索 ForgeCloud" /><kbd>⌘ K</kbd></label>
        <div className="fc-top-actions">
          <button type="button" className="fc-top-icon" onClick={() => { const unread = remoteSnapshot?.notifications.filter((item) => !item.readAt) ?? []; if (!unread.length) { showNotice(remoteSnapshot ? '暂无未读通知' : '请先连接 ForgeCloud'); return }; void markForgeCloudNotificationsRead().then(() => refreshWorkspace()).then(() => showNotice(`已查看 ${unread.length} 条通知`)).catch((error: unknown) => showNotice(error instanceof Error ? error.message : '通知同步失败')) }} aria-label="打开通知"><span className={`fc-notice-dot ${remoteSnapshot?.notifications.some((item) => !item.readAt) ? '' : 'is-hidden'}`} /><CloudIcon icon={ActivityData} size={17} /></button>
          <button type="button" className="fc-top-icon" onClick={() => selectSection('members')} aria-label="成员与权限"><CloudIcon icon={UsersData} size={17} /></button>
          <div className={`fc-account-menu ${accountOpen ? 'is-open' : ''}`}>
            <button type="button" className="fc-account" onClick={() => setAccountOpen((open) => !open)} aria-expanded={accountOpen} aria-haspopup="menu"><span>WZ</span><b>{remoteSnapshot?.workspace.role.toUpperCase() ?? 'OFFLINE'}</b><CloudIcon icon={ChevronDownData} size={13} /></button>
            {accountOpen && <div className="fc-account-popover" role="menu" aria-label="账户菜单">
              <div className="fc-account-popover-head"><span className="fc-account-popover-avatar">WZ</span><div><strong>当前工作空间角色</strong><small>{remoteSnapshot?.workspace.role.toUpperCase() ?? 'OFFLINE'}</small></div></div>
              <button type="button" className="fc-account-menu-item" onClick={() => { setAccountOpen(false); selectSection('members') }} role="menuitem"><CloudIcon icon={UsersData} size={15} /><span>成员与权限</span><CloudIcon icon={ArrowRightData} size={14} /></button>
              <button type="button" className="fc-account-menu-item is-danger" onClick={() => { setAccountOpen(false); onLogout() }} role="menuitem"><CloudIcon icon={LogOutData} size={15} /><span>退出登录</span></button>
            </div>}
          </div>
          <button type="button" className="fc-mobile-menu" onClick={() => setMobileNavOpen((open) => !open)} aria-label={mobileNavOpen ? '关闭导航' : '打开导航'}><CloudIcon icon={mobileNavOpen ? XData : MenuData} size={19} /></button>
        </div>
      </header>

      <div className="fc-layout">
        <aside className={`fc-sidebar ${mobileNavOpen ? 'is-open' : ''}`} aria-label="ForgeCloud 导航">
          <nav className="fc-main-nav">
            {navGroups.map((group) => <div className="fc-nav-group" key={group.label}><span className="fc-nav-kicker">{group.label}</span>{group.items.map(({ id, icon }) => <button type="button" key={id} className={section === id ? 'is-active' : ''} onClick={() => selectSection(id)}><CloudIcon icon={icon} size={17} /><span>{sectionMeta[id].label}</span>{id === 'tasks' && remoteSnapshot && <b className="fc-nav-count">{remoteSnapshot.tasks.filter((task) => task.status !== 'done').length + remoteSnapshot.approvals.filter((approval) => approval.status === 'pending' || approval.status === 'replan').length}</b>}</button>)}</div>)}
          </nav>

          <div className="fc-sidebar-bottom"><button type="button" onClick={() => showNotice('设置入口将在统一平台底座接入')}><CloudIcon icon={SettingsData} size={16} /><span>设置</span></button><div className="fc-build-label">CLOUD SHELL<br /><b>V23 / MAPPING LEDGER</b></div><button type="button" className="fc-exit-button" onClick={onExit}><CloudIcon icon={LogOutData} size={15} /><span>返回 ForgeMind</span></button></div>
        </aside>

        <main className="fc-main">
          <div className="fc-breadcrumb"><span>FORGECLOUD</span><i>/</i><span>{meta.eyebrow.split(' / ')[0]}</span><i>/</i><b>{meta.label.toUpperCase()}</b></div>
          <div className="fc-page-heading"><div><span className="fc-eyebrow">{meta.eyebrow}</span><h1>{meta.title}</h1><p>{meta.description}</p></div><div className="fc-heading-actions"><span className={`fc-sync-state ${remoteState}`}><i /> {remoteState === 'online' ? `CLOUD SYNCED / V${remoteSnapshot?.database.migration.version ?? '—'}` : remoteState === 'loading' ? 'CONNECTING / CLOUD API' : 'DEMO DATA / LOCAL SHELL'}</span><button type="button" className="fc-secondary-button" onClick={() => { void refreshWorkspace().then(() => showNotice('云端状态已刷新')).catch((error: unknown) => showNotice(error instanceof Error ? error.message : '同步失败')) }}><CloudIcon icon={DatabaseData} size={15} /> 同步状态</button></div></div>

          {section === 'overview' && <OverviewPanel onSelect={selectSection} onNotice={showNotice} snapshot={remoteSnapshot} />}
          {section === 'projects' && <ProjectsPanel rows={filteredProjects} onNotice={showNotice} onCreate={() => openDialog({ kind: 'project' })} onComments={openProjectComments} onVersion={openProjectVersion} onAccess={openProjectAccess} />}
          {section === 'assets' && <AssetsPanel rows={remoteSnapshot ? assetRowsFromRemote(remoteSnapshot.assets) : assetRows} onNotice={showNotice} onCreate={() => openDialog({ kind: 'asset' })} onVersion={openAssetVersion} />}
          {section === 'releases' && <ReleasesPanel rows={remoteSnapshot?.releases ?? null} publications={remoteSnapshot?.publications ?? null} onNotice={showNotice} onCreate={() => openDialog({ kind: 'release' })} onPublish={() => openDialog({ kind: 'publication' })} />}
          {section === 'connections' && <ConnectionsPanel rows={remoteSnapshot?.connectors ?? null} mappings={remoteSnapshot?.mappings ?? []} assetTwins={remoteSnapshot?.assetTwins ?? []} syncRuns={remoteSnapshot?.syncRuns ?? []} onNotice={showNotice} onCreate={() => openDialog({ kind: 'connector' })} onCreateMapping={() => openDialog({ kind: 'mapping' })} onCreateAssetTwin={() => openDialog({ kind: 'asset-twin' })} onSync={runConnectorReplay} />}
          {section === 'operations' && <OperationsPanel runtimeEvents={remoteSnapshot?.runtimeEvents ?? []} telemetryWindows={remoteSnapshot?.telemetryWindows ?? []} workOrders={remoteSnapshot?.workOrders ?? []} qualityResults={remoteSnapshot?.qualityResults ?? []} maintenanceRecords={remoteSnapshot?.maintenanceRecords ?? []} onCreate={(kind) => openDialog({ kind })} onStatus={(id, status) => { void updateForgeCloudWorkOrderStatus(id, status).then(() => refreshWorkspace()).then(() => showNotice('工单状态已更新')).catch((error: unknown) => showNotice(error instanceof Error ? error.message : '工单状态更新失败')) }} />}
          {section === 'tasks' && <TasksPanel rows={remoteSnapshot?.tasks ?? null} approvals={remoteSnapshot?.approvals ?? null} onNotice={showNotice} onCreate={() => openDialog({ kind: 'task' })} onCreateApproval={() => openDialog({ kind: 'approval' })} onStatus={(taskId, status) => { void updateForgeCloudTaskStatus(taskId, status).then(() => refreshWorkspace()).then(() => showNotice('任务状态已更新')).catch((error: unknown) => showNotice(error instanceof Error ? error.message : '任务状态更新失败')) }} onDecision={(approvalId, status) => { void decideForgeCloudApproval(approvalId, status).then(() => refreshWorkspace()).then(() => showNotice('审批决策已记录')).catch((error: unknown) => showNotice(error instanceof Error ? error.message : '审批决策失败')) }} />}
          {section === 'members' && <MembersPanel rows={remoteSnapshot?.members ?? null} workspaceName={remoteSnapshot?.workspace.name ?? '离线预览'} canManage={remoteSnapshot?.workspace.role === 'owner' || remoteSnapshot?.workspace.role === 'admin'} onInvite={() => openDialog({ kind: 'member' })} onEditRole={(member) => openDialog({ kind: 'role', member })} onNotice={showNotice} />}
          {section === 'audit' && <AuditPanel rows={remoteSnapshot?.audit ?? null} onNotice={showNotice} />}
          {section === 'devices' && <IntelligencePanel kind="devices" rows={remoteSnapshot?.devices ?? []} onNotice={showNotice} onCreate={() => openDialog({ kind: 'device' })} onHeartbeat={(deviceId) => { void heartbeatForgeCloudDevice(deviceId).then(() => refreshWorkspace()).then(() => showNotice('设备心跳已写入')).catch((error: unknown) => showNotice(error instanceof Error ? error.message : '设备心跳写入失败')) }} />}
          {section === 'twins' && <IntelligencePanel kind="twins" rows={remoteSnapshot?.twins ?? []} onNotice={showNotice} onCreate={() => openDialog({ kind: 'twin' })} />}
          {section === 'data' && <IntelligencePanel kind="data" rows={remoteSnapshot?.dataPoints ?? []} onNotice={showNotice} onCreate={() => openDialog({ kind: 'data-point' })} onDataEvent={(pointId, value) => { if (!remoteSnapshot) return; void ingestForgeCloudDataEvent({ workspaceId: remoteSnapshot.workspace.id, pointId, value }).then(() => refreshWorkspace()).then(() => showNotice('手动遥测事件已写入')).catch((error: unknown) => showNotice(error instanceof Error ? error.message : '遥测事件写入失败')) }} />}
          {section === 'ai' && <IntelligencePanel kind="ai" rows={remoteSnapshot?.aiTasks ?? []} onNotice={showNotice} onCreate={() => openDialog({ kind: 'ai-task' })} onAiRun={(taskId) => { void runForgeCloudAiTask(taskId).then(() => refreshWorkspace()).then(() => showNotice('规则 AI 任务已完成并写回结果')).catch((error: unknown) => showNotice(error instanceof Error ? error.message : 'AI 任务执行失败')) }} />}
        </main>
      </div>

      {notice && <div className="fc-toast" role="status"><CloudIcon icon={CheckCircleData} size={16} /><span>{notice}</span></div>}
      {dialog && <CloudControlDialog key={dialog.kind === 'role' ? `${dialog.kind}-${dialog.member.userId}` : dialog.kind === 'comment' ? `${dialog.kind}-${dialog.projectId}` : dialog.kind === 'project-access' ? `${dialog.kind}-${dialog.projectId}` : dialog.kind === 'asset-version' ? `${dialog.kind}-${dialog.assetId}` : dialog.kind} dialog={dialog} projects={remoteSnapshot?.projects ?? []} workspaceMembers={remoteSnapshot?.members ?? []} connectors={remoteSnapshot?.connectors ?? []} dataPoints={remoteSnapshot?.dataPoints ?? []} twins={remoteSnapshot?.twins ?? []} busy={dialogBusy} error={dialogError} onClose={() => { if (!dialogBusy) setDialog(null) }} onSubmit={submitDialog} />}
      </div>
    </div>
  )
}

const fallbackArchive: ForgeCloudArchive = {
  projectId: 'demo-wzh-001', projectName: 'WZH 三层轻量完整产线', version: 18, schemaVersion: 6, branch: 'main',
  objects: 39, machines: 9, conveyors: 18, vehicles: 4, items: 12, recipes: 8, floors: 3,
  floorNames: ['1F 供料层', '2F 加工层', '3F 装配层'],
  outputs: [
    { itemId: 'item_machined_housing', name: '机加工壳体', quantity: 1, recipeCount: 1 },
    { itemId: 'item_clean_part', name: '洁净零件', quantity: 1, recipeCount: 1 },
    { itemId: 'item_motor', name: '电机总成', quantity: 1, recipeCount: 1 },
    { itemId: 'item_inspected_motor', name: '已检电机', quantity: 1, recipeCount: 2 },
  ],
}

const fallbackHealth: ForgeCloudHealth[] = [
  { id: 'api', label: 'ForgeCloud API', state: '演示', tone: 'amber' },
  { id: 'mysql', label: 'MySQL 结构化数据', state: '演示', tone: 'amber' },
  { id: 'object-store', label: '对象存储', state: '未接入', tone: 'muted' },
  { id: 'connectors', label: '工业连接器', state: '未配置', tone: 'muted' },
]

const fallbackLayers: ForgeCloudLayer[] = [
  { id: 'project', label: 'Project Cloud', state: '基础就绪', tone: 'green', detail: '项目、版本和协作' },
  { id: 'device', label: 'Device Cloud', state: '基础就绪', tone: 'cyan', detail: '设备注册与心跳' },
  { id: 'twin', label: 'Twin Cloud', state: '基础就绪', tone: 'cyan', detail: '孪生状态同步' },
  { id: 'asset', label: 'Asset Cloud', state: '基础就绪', tone: 'green', detail: '模型与资源版本' },
  { id: 'data', label: 'Data Cloud', state: '基础就绪', tone: 'cyan', detail: '数据点与运行事件' },
  { id: 'ai', label: 'AI Cloud', state: '规则可用', tone: 'purple', detail: 'Agent 与推理任务' },
]

function OverviewPanel({ onSelect, onNotice, snapshot }: { onSelect: (section: CloudSection) => void; onNotice: (message: string) => void; snapshot: Awaited<ReturnType<typeof loadForgeCloudSnapshot>> | null }) {
  const archive = snapshot?.overview.archive ?? fallbackArchive
  const health = snapshot?.overview.health ?? fallbackHealth
  const layers = snapshot?.overview.layers ?? fallbackLayers
  const healthyCount = health.filter((row) => row.tone === 'green').length
  const outputs = archive.outputs.length ? archive.outputs : [{ itemId: 'none', name: '当前存档没有定义配方产物', quantity: 0, recipeCount: 0 }]
  const tasks = snapshot?.tasks.filter((task) => task.status !== 'done').slice(0, 3) ?? []
  const activityRows = snapshot ? snapshot.activity.length ? snapshot.activity.slice(0, 3).map((row) => ({ id: row.id, actor: row.actor, source: row.source ?? 'ForgeCloud', action: row.action ?? row.eventType, target: `${row.aggregateType ?? 'OBJECT'} / ${row.aggregateId ?? '—'}`, createdAt: row.createdAt })) : snapshot.audit.length ? snapshot.audit.slice(0, 3).map((row) => ({ id: row.id, actor: row.actor, source: row.source, action: row.action, target: `${row.objectType ?? 'OBJECT'} / ${row.objectId ?? '—'}`, createdAt: row.createdAt })) : null : null
  const liveLabel = snapshot ? 'CURRENT ARCHIVE / CLOUD' : 'OFFLINE PREVIEW / DEMO DATA'
  const resourceCounts = snapshot ? [
    { label: '工厂项目', value: snapshot.overview.projects, section: 'projects' as CloudSection, icon: GitBranchData },
    { label: '共享资源', value: snapshot.overview.assets, section: 'assets' as CloudSection, icon: BoxesData },
    { label: '成员', value: snapshot.overview.members, section: 'members' as CloudSection, icon: UsersData },
    { label: '待处理', value: snapshot.overview.pendingNotifications, section: 'tasks' as CloudSection, icon: ListChecksData },
  ] : [
    { label: '工厂项目', value: 3, section: 'projects' as CloudSection, icon: GitBranchData },
    { label: '共享资源', value: 3, section: 'assets' as CloudSection, icon: BoxesData },
    { label: '成员', value: 3, section: 'members' as CloudSection, icon: UsersData },
    { label: '待处理', value: 3, section: 'tasks' as CloudSection, icon: ListChecksData },
  ]

  return <div className="fc-overview-stack">
    <section className="fc-command-board">
      <div className="fc-command-board-head"><div><span className="fc-panel-kicker">{liveLabel}</span><h2>当前工厂与云端资源状态</h2><p>ForgeCloud 只展示已经由存档、数据库和连接 API 返回的事实。</p></div><span className={`fc-live-chip ${snapshot ? 'is-live' : 'is-demo'}`}><i /> {snapshot ? 'LIVE' : 'PREVIEW'}</span></div>
      <div className="fc-command-grid">
        <article className="fc-archive-card"><div className="fc-archive-card-top"><span className="fc-index-mark"><CloudIcon icon={GitBranchData} size={17} /></span><span><small>ACTIVE FACTORY ARCHIVE</small><strong>{archive.projectName}</strong></span><b>v{archive.version}</b></div><div className="fc-archive-id">{archive.projectId} <i /> {archive.branch || 'main'} <i /> schema v{archive.schemaVersion}</div><div className="fc-archive-metrics"><ArchiveMetric value={archive.objects} label="对象" /><ArchiveMetric value={archive.machines} label="生产设备" /><ArchiveMetric value={archive.conveyors} label="传送线" /><ArchiveMetric value={archive.floors} label="楼层" /></div><div className="fc-floor-ledger"><span>楼层结构</span><div>{archive.floorNames.slice(0, archive.floors).map((floor, index) => <em key={`${floor}-${index}`}><i>{String(index + 1).padStart(2, '0')}</i>{floor}</em>)}</div></div><button type="button" className="fc-card-link" onClick={() => onSelect('projects')}>打开项目版本 <CloudIcon icon={ArrowRightData} size={14} /></button></article>
        <article className="fc-output-card"><div className="fc-card-head"><div><span className="fc-panel-kicker">RECIPE OUTPUT LEDGER</span><h2>配方产物</h2></div><span className="fc-panel-meta">{archive.recipes} 条配方</span></div><p className="fc-card-intro">按当前存档中的配方定义汇总，不等同于实时产量。</p><div className="fc-output-list">{outputs.slice(0, 6).map((output) => <div className="fc-output-row" key={output.itemId}><span className="fc-output-symbol"><CloudIcon icon={PackageCheckData} size={15} /></span><span><strong>{output.name}</strong><small>{output.itemId} · {output.recipeCount} 条配方</small></span><b>×{output.quantity}</b></div>)}</div><button type="button" className="fc-card-link" onClick={() => onSelect('projects')}>查看完整工艺链 <CloudIcon icon={ArrowRightData} size={14} /></button></article>
        <article className="fc-api-card"><div className="fc-card-head"><div><span className="fc-panel-kicker">CLOUD API PULSE</span><h2>连接状态</h2></div><span className={`fc-health-badge ${healthyCount === health.length ? 'is-all-good' : ''}`}><i /> {snapshot ? `${healthyCount} / ${health.length} 正常` : '等待连接'}</span></div><div className="fc-health-list">{health.map((row) => <HealthRow key={row.id} row={row} remote={Boolean(snapshot)} />)}</div><button type="button" className="fc-card-link" onClick={() => onSelect('connections')}>查看连接与事件 <CloudIcon icon={ArrowRightData} size={14} /></button></article>
      </div>
    </section>

    <DatabaseStatusPanel status={snapshot?.database ?? null} />

    <section className="fc-layer-panel"><div className="fc-card-head"><div><span className="fc-panel-kicker">INDUSTRIAL INTELLIGENCE CLOUD</span><h2>六层云能力</h2></div><span className="fc-panel-meta">PROJECT → DEVICE → TWIN → DATA → AI</span></div><div className="fc-layer-grid">{layers.map((layer) => <button type="button" key={layer.id} onClick={() => onNotice(`${layer.label}：${layer.detail ?? layer.state}`)}><span className={`fc-layer-icon ${layer.tone}`}><CloudIcon icon={layerIcon(layer.id)} size={16} /></span><span><strong>{layer.label}</strong><small>{layer.detail ?? '等待服务状态'}</small></span><em className={`fc-state-pill ${layer.tone === 'green' ? 'green' : layer.tone === 'purple' ? 'amber' : layer.tone === 'cyan' ? 'green' : 'muted'}`}>{layer.state}</em></button>)}</div></section>

    <div className="fc-overview-grid">
      <section className="fc-card fc-resource-card"><div className="fc-card-head"><div><span className="fc-panel-kicker">RESOURCE LEDGER</span><h2>中枢资源索引</h2></div><span className="fc-panel-meta">{snapshot ? '云端实时' : '本地演示'}</span></div><div className="fc-resource-grid">{resourceCounts.map((entry) => <button type="button" key={entry.label} onClick={() => onSelect(entry.section)}><span><CloudIcon icon={entry.icon} size={15} /></span><strong>{String(entry.value).padStart(2, '0')}</strong><small>{entry.label}</small></button>)}</div><p className="fc-card-intro">项目、资源、成员和任务都从同一工作空间索引进入各自的管理面。</p></section>
      <section className="fc-card fc-attention-card"><div className="fc-card-head"><div><span className="fc-panel-kicker">ACTION QUEUE</span><h2>需要处理</h2></div><b className="fc-card-number">{String(snapshot?.overview.pendingNotifications ?? 3).padStart(2, '0')}</b></div><div className="fc-attention-list">{tasks.length ? tasks.map((task) => <button type="button" key={task.id} onClick={() => onSelect('tasks')}><span className="fc-attention-icon amber"><CloudIcon icon={ListChecksData} size={16} /></span><span><strong>{task.title}</strong><small>{task.type} · {task.priority} · {task.status}</small></span><CloudIcon icon={ArrowRightData} size={15} /></button>) : <><button type="button" onClick={() => onSelect('tasks')}><span className="fc-attention-icon amber"><CloudIcon icon={ListChecksData} size={16} /></span><span><strong>{snapshot ? '当前没有未完成任务' : '连接云端后加载任务队列'}</strong><small>{snapshot ? '工作空间任务已完成或暂无任务' : '演示数据不会覆盖当前存档事实'}</small></span><CloudIcon icon={ArrowRightData} size={15} /></button><button type="button" onClick={() => onSelect('audit')}><span className="fc-attention-icon purple"><CloudIcon icon={ShieldCheckData} size={16} /></span><span><strong>检查资源和版本审计</strong><small>从活动记录核对变更责任链</small></span><CloudIcon icon={ArrowRightData} size={15} /></button></>}</div></section>
    </div>

    <section className="fc-card fc-activity-card"><div className="fc-card-head"><div><span className="fc-panel-kicker">RECENT ACTIVITY</span><h2>最近活动</h2></div><button type="button" className="fc-quiet-action" onClick={() => onSelect('audit')}>全部活动 <CloudIcon icon={ArrowRightData} size={14} /></button></div><div className="fc-activity-table">{activityRows ? activityRows.map((row) => <ActivityRow key={row.id} actor={row.actor ?? '系统'} source={row.source} action={row.action} target={row.target} time={row.createdAt.slice(11, 16) || '—'} />) : <><ActivityRow actor="ForgeCloud" source="本地演示" action="等待云端活动" target="workspace / overview" time="—" /><ActivityRow actor="系统" source="ForgeMind" action="读取工厂存档" target={`${archive.projectName} / v${archive.version}`} time="—" /><ActivityRow actor="系统" source="ForgeCloud" action="汇总配方产物" target={`${archive.recipes} recipes / ${outputs.length} outputs`} time="—" /></>}</div></section>

    <section className="fc-continue-strip"><div><span className="fc-panel-kicker">CURRENT ARCHIVE</span><strong>{archive.projectName}</strong><small>{archive.branch || 'main'} / v{archive.version} · {archive.objects} 个对象 · {archive.floors} 层 · {snapshot ? `更新于 ${archive.updatedAt?.slice(0, 16).replace('T', ' ') ?? '刚刚'}` : '等待 ForgeMind 云端存档'}</small></div><div className="fc-continue-actions"><button type="button" className="fc-secondary-button" onClick={() => onNotice('将在 ForgeMind 中打开当前工厂存档')}>查看项目</button><button type="button" className="fc-primary-button" onClick={() => onSelect('projects')}>打开版本 <CloudIcon icon={ArrowRightData} size={15} /></button></div></section>
  </div>
}

function layerIcon(id: string) {
  if (id === 'project') return GitBranchData
  if (id === 'device') return RadioData
  if (id === 'twin') return CloudCogData
  if (id === 'asset') return BoxesData
  if (id === 'data') return ActivityData
  return ShieldCheckData
}

function ArchiveMetric({ value, label }: { value: number; label: string }) {
  return <span className="fc-archive-metric"><b>{String(value).padStart(2, '0')}</b><small>{label}</small></span>
}

function HealthRow({ row, remote }: { row: ForgeCloudHealth; remote: boolean }) {
  const icon = row.id.includes('mysql') ? DatabaseData : row.id.includes('object') ? HardDriveData : row.id.includes('connector') ? RadioData : CloudCogData
  const tone = row.tone === 'green' || row.tone === 'red' || row.tone === 'amber' ? row.tone : 'muted'
  const detail = remote ? (row.detail ?? (row.id === 'api' ? 'GET /api/v1 · 已响应' : row.id === 'mysql' ? '结构化存档 · 已响应' : row.id === 'connectors' ? '运行事件 · 服务端状态' : '能力预留 · 尚未启用')) : '连接后显示服务端状态'
  return <div className="fc-health-row"><span className="fc-health-icon"><CloudIcon icon={icon} size={16} /></span><span><strong>{row.label}</strong><small>{detail}</small></span><b className={`fc-health-state ${tone}`}><i /> {remote ? row.state : '待连接'}</b></div>
}

function DatabaseStatusPanel({ status }: { status: ForgeCloudDatabaseStatus | null }) {
  const [query, setQuery] = useState('')
  const [tableType, setTableType] = useState<'all' | 'BASE TABLE' | 'VIEW'>('all')
  const stateLabel = status?.status === 'online' ? 'DATABASE ONLINE' : status?.status === 'degraded' ? 'DATABASE DEGRADED' : 'WAITING FOR DATABASE'
  const stateTone = status?.status === 'online' ? 'green' : status?.status === 'degraded' ? 'amber' : 'muted'
  const connectionLabel = status && status.maxConnections > 0 ? `${status.activeConnections} / ${status.maxConnections}` : '—'
  const tables = status?.tables ?? []
  const normalizedQuery = query.trim().toLowerCase()
  const visibleTables = tables.filter((table) => {
    if (tableType !== 'all' && table.type !== tableType) return false
    if (!normalizedQuery) return true
    return `${table.name} ${table.type} ${table.engine} ${table.collation ?? ''}`.toLowerCase().includes(normalizedQuery)
  })
  return <section className="fc-database-panel">
    <div className="fc-database-head"><div><span className="fc-panel-kicker">DATABASE CLOUD / OBSERVABILITY</span><h2>数据库运行状态</h2><p>仅展示服务端探针结果，不暴露 JDBC 地址、账号或密码。</p></div><span className={`fc-database-status ${stateTone}`}><i /> {stateLabel}</span></div>
    <div className="fc-database-grid">
      <DatabaseMetric label="引擎 / 版本" value={status ? `${status.engine} ${status.serverVersion}` : '等待服务端探针'} detail={status?.schema ? `schema · ${status.schema}` : '登录并连接后读取'} />
      <DatabaseMetric label="Flyway 迁移" value={status ? `V${status.migration.version}` : '—'} detail={status?.migration.description ?? '尚未读取迁移记录'} />
      <DatabaseMetric label="业务表" value={status ? `${status.cloudTableCount} / ${status.tableCount}` : '—'} detail="ForgeCloud / 全部表" />
      <DatabaseMetric label="数据库容量" value={status ? `${status.sizeMiB.toFixed(2)} MiB` : '—'} detail="数据 + 索引" />
      <DatabaseMetric label="连接使用" value={connectionLabel} detail="当前 / max_connections" />
      <DatabaseMetric label="探针延迟" value={status ? `${status.latencyMs} ms` : '—'} detail={status?.checkedAt ? `检查于 ${status.checkedAt.slice(11, 19)}` : '等待检查'} />
      <DatabaseMetric label="事件队列" value={status?.eventQueue ? `${status.eventQueue.pending} 待处理` : '—'} detail={status?.eventQueue ? `${status.eventQueue.failed} 失败 · ${status.eventQueue.activity} 条活动` : '等待 V19 消费器'} />
    </div>
    {status?.warnings?.length ? <div className="fc-database-warning"><CloudIcon icon={DatabaseData} size={14} /><span>{status.warnings.join(' · ')}</span></div> : null}
    <section className="fc-database-catalog" aria-labelledby="fc-database-catalog-title">
      <div className="fc-database-catalog-head"><div><span className="fc-panel-kicker">SCHEMA TABLE CATALOG</span><h3 id="fc-database-catalog-title">数据库表目录</h3><p>展示当前 schema 的结构元数据，不读取业务行内容。</p></div><span className="fc-database-catalog-count">{status ? `${visibleTables.length} / ${tables.length} 张表` : '等待连接'}</span></div>
      <div className="fc-database-catalog-tools"><label className="fc-database-filter"><CloudIcon icon={SearchData} size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="筛选表名、类型、引擎或排序规则" aria-label="筛选数据库表" /></label><div className="fc-database-type-filter"><button type="button" className={tableType === 'all' ? 'is-active' : ''} onClick={() => setTableType('all')}>全部 <b>{tables.length}</b></button><button type="button" className={tableType === 'BASE TABLE' ? 'is-active' : ''} onClick={() => setTableType('BASE TABLE')}>数据表 <b>{tables.filter((table) => table.type === 'BASE TABLE').length}</b></button><button type="button" className={tableType === 'VIEW' ? 'is-active' : ''} onClick={() => setTableType('VIEW')}>视图 <b>{tables.filter((table) => table.type === 'VIEW').length}</b></button></div></div>
      <div className="fc-database-table-wrap">{visibleTables.length ? <table className="fc-database-table"><thead><tr><th>表名</th><th>类型</th><th>引擎</th><th>字段</th><th>估算行数</th><th>数据 / 索引</th><th>总大小</th><th>更新时间</th></tr></thead><tbody>{visibleTables.map((table) => <tr key={table.name}><td><strong>{table.name}</strong><small>{table.collation || '—'}</small></td><td><em className={`fc-database-table-type ${table.type === 'VIEW' ? 'is-view' : ''}`}>{table.type === 'VIEW' ? 'VIEW' : 'TABLE'}</em></td><td>{table.engine}</td><td>{table.columns}</td><td>{formatDatabaseInteger(table.rows)}</td><td>{formatDatabaseSize(table.dataMiB)} / {formatDatabaseSize(table.indexMiB)}</td><td><b>{formatDatabaseSize(table.sizeMiB)}</b></td><td>{formatDatabaseTime(table.updatedAt)}</td></tr>)}</tbody></table> : <div className="fc-database-empty">{status ? '没有匹配的数据库表' : '连接 ForgeCloud 后读取当前 schema 的表目录'}</div>}</div>
    </section>
  </section>
}

function formatDatabaseInteger(value: number) {
  return new Intl.NumberFormat('zh-CN').format(value)
}

function formatDatabaseSize(value: number) {
  return `${value.toFixed(2)} MiB`
}

function formatDatabaseTime(value?: string) {
  return value ? value.replace('T', ' ').slice(0, 16) : '—'
}

function DatabaseMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="fc-database-metric"><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>
}

function ActivityRow({ actor, source, action, target, time }: { actor: string; source: string; action: string; target: string; time: string }) {
  return <div className="fc-activity-row"><span className="fc-activity-avatar">{actor.slice(0, 2)}</span><span className="fc-activity-who"><strong>{actor}</strong><small>{source}</small></span><span className="fc-activity-action">{action}</span><code>{target}</code><time>{time}</time><CloudIcon icon={MoreData} size={16} /></div>
}

function ProjectsPanel({ rows, onNotice, onCreate, onComments, onVersion, onAccess }: { rows: ProjectDisplayRow[]; onNotice: (message: string) => void; onCreate: () => void; onComments: (projectId: string | undefined, projectName: string) => void; onVersion: (projectId: string | undefined, projectName: string, baseVersionId: string | undefined) => void; onAccess: (projectId: string | undefined, projectName: string) => void }) {
  return <section className="fc-list-page"><ListToolbar eyebrow="PROJECT REGISTRY" title="项目与版本" action="新建项目" onAction={onCreate} /><div className="fc-table-card"><div className="fc-table-head fc-project-table"><span>项目</span><span>版本 / 分支</span><span>负责人</span><span>项目角色</span><span>数据来源</span><span>状态</span><span /></div>{rows.map((row) => <div className="fc-table-row fc-project-table" key={row.code}><span className="fc-project-name"><i className="fc-project-thumb"><CloudIcon icon={row.name.includes('模板') ? BoxesData : GitBranchData} size={18} /></i><strong>{row.name}</strong><small>{row.code}</small></span><span><b>{row.version}</b><small>{row.branch}</small></span><span>{row.owner}</span><span>{row.accessRole ?? '未分配'}</span><span>{row.source}</span><span><em className={`fc-state-pill ${row.stateTone}`}>{row.state}</em></span><span className="fc-project-actions"><button type="button" className="fc-row-action" onClick={() => row.projectId ? onComments(row.projectId, row.name) : onNotice(`${row.name} 为离线演示项目`)} aria-label={`查看 ${row.name} 协作记录`}><CloudIcon icon={MoreData} size={17} /></button><button type="button" className="fc-row-action" onClick={() => onVersion(row.projectId, row.name, row.currentVersionId)} aria-label={`提交 ${row.name} 新版本`}><CloudIcon icon={GitBranchData} size={16} /></button><button type="button" className="fc-row-action" onClick={() => onAccess(row.projectId, row.name)} aria-label={`管理 ${row.name} 项目权限`}><CloudIcon icon={UsersData} size={16} /></button></span></div>)}</div></section>
}

function AssetsPanel({ rows, onNotice, onCreate, onVersion }: { rows: AssetDisplayRow[]; onNotice: (message: string) => void; onCreate: () => void; onVersion: (assetId: string | undefined, assetName: string) => void }) {
  return <section className="fc-list-page"><div className="fc-list-toolbar"><div><span className="fc-eyebrow">ASSET REGISTRY / VERSION LEDGER</span><h2>资源注册表</h2><p>清单、许可证、文件本体和不可变版本集中在同一条资源责任链中。</p></div><div className="fc-toolbar-actions"><button type="button" className="fc-primary-button" onClick={onCreate}>＋ 创建资源</button></div></div><div className="fc-asset-filters"><button type="button" className="is-active">全部资源 <b>{rows.length}</b></button><button type="button">机器模型 <b>34</b></button><button type="button">物品资源 <b>58</b></button><button type="button">资源包 <b>12</b></button><button type="button">待审核 <b>02</b></button></div><div className="fc-table-card"><div className="fc-table-head fc-asset-table"><span>资源</span><span>类型</span><span>当前版本</span><span>许可证</span><span>项目使用</span><span>状态</span><span /></div>{rows.map((row) => <div className="fc-table-row fc-asset-table" key={row.id}><span className="fc-project-name"><i className="fc-asset-preview"><CloudIcon icon={row.type === '机器模型' ? BoxesData : PackageCheckData} size={17} /></i><strong>{row.name}</strong><small>{row.id}</small></span><span>{row.type}</span><span><b>{row.version}</b><small>不可变版本</small></span><span>{row.license}</span><span>{row.usage}</span><span><em className={`fc-state-pill ${row.tone}`}>{row.state}</em></span><button type="button" className="fc-row-action" onClick={() => row.assetId ? onVersion(row.assetId, row.name) : onNotice(`${row.name} 为离线预览资源`)} aria-label={`创建 ${row.name} 新版本`}><CloudIcon icon={GitBranchData} size={17} /></button></div>)}</div></section>
}

function ReleasesPanel({ rows, publications, onNotice, onCreate, onPublish }: { rows: ForgeCloudRelease[] | null; publications: import('../api/forgeCloud').ForgeCloudPublication[] | null; onNotice: (message: string) => void; onCreate: () => void; onPublish: () => void }) {
  if (!rows) return <section className="fc-list-page"><ListToolbar eyebrow="RELEASE CENTER" title="发布中心" action="创建发布" onAction={onCreate} /><div className="fc-release-grid"><ReleaseCard label="已发布" count="07" title="可复用的工厂和资源版本" tone="green" items={['WZH 三层轻量完整产线 / v18', 'CNC 加工中心 / v3', '视觉检测设备模板 / v2']} onOpen={() => onNotice('离线预览不包含可发布版本')} /><ReleaseCard label="待审核" count="02" title="需要成员确认的内容" tone="amber" items={['A-02 齿轮箱装配线 / v07', '视觉质检资源包 / v1']} onOpen={() => onNotice('请连接 ForgeCloud 查看审批记录')} /><ReleaseCard label="已归档" count="14" title="仍可追溯的历史版本" tone="muted" items={['WZH / v16 · 回滚', 'CNC / v1 · 已替换', 'A-01 / v09 · 历史方案']} onOpen={() => onNotice('请连接 ForgeCloud 查看归档记录')} /></div></section>
  const published = rows.filter((row) => row.status === 'published')
  const linked = publications ?? []
  return <section className="fc-list-page"><div className="fc-list-toolbar"><div><span className="fc-eyebrow">RELEASE CENTER / CLOUD API</span><h2>发布中心</h2><p>不可变版本、ForgeLab 关联和许可证声明统一留在云端责任链。</p></div><div className="fc-toolbar-actions"><button type="button" className="fc-secondary-button" onClick={onPublish}>关联 ForgeLab</button><button type="button" className="fc-primary-button" onClick={onCreate}>＋ 创建发布</button></div></div><div className="fc-release-grid"><ReleaseCard label="已发布" count={String(published.length).padStart(2, '0')} title="当前工作空间的不可变发布" tone="green" items={published.length ? published.map((row) => `${row.projectName} / v${row.version}`) : ['暂无已发布版本']} onOpen={() => onNotice('发布记录已从 ForgeCloud API 同步')} /><ReleaseCard label="ForgeLab 关联" count={String(linked.length).padStart(2, '0')} title="已冻结来源和许可证声明" tone="purple" items={linked.length ? linked.slice(0, 4).map((row) => `${row.postTitle ?? row.forgeLabPostId} · ${row.releaseName ?? row.assetName ?? row.sourceType}`) : ['暂无跨产品发布关联']} onOpen={() => onNotice(linked.length ? 'ForgeLab 关联已从 ForgeCloud API 同步' : '使用“关联 ForgeLab”创建跨产品来源关系')} /><ReleaseCard label="全部记录" count={String(rows.length).padStart(2, '0')} title="版本发布与来源责任链" tone="muted" items={rows.slice(0, 4).map((row) => `${row.name} · ${row.creator ?? '系统'}`)} onOpen={() => onNotice('发布记录已从 ForgeCloud API 同步')} /></div></section>
}

function ReleaseCard({ label, count, title, tone, items, onOpen }: { label: string; count: string; title: string; tone: string; items: string[]; onOpen: () => void }) {
  return <article className={`fc-release-card ${tone}`}><div className="fc-release-card-head"><span><i /> {label}</span><b>{count}</b></div><h3>{title}</h3><div className="fc-release-items">{items.map((item) => <span key={item}><CloudIcon icon={CheckCircleData} size={14} />{item}</span>)}</div><button type="button" className="fc-text-button" onClick={onOpen}>查看列表 <CloudIcon icon={ArrowRightData} size={14} /></button></article>
}

function ConnectionsPanel({ rows, mappings, assetTwins, syncRuns, onNotice, onCreate, onCreateMapping, onCreateAssetTwin, onSync }: { rows: ForgeCloudConnector[] | null; mappings: ForgeCloudTagMapping[]; assetTwins: ForgeCloudAssetTwin[]; syncRuns: ForgeCloudConnectorSyncRun[]; onNotice: (message: string) => void; onCreate: () => void; onCreateMapping: () => void; onCreateAssetTwin: () => void; onSync: (connectorId: string) => void }) {
  if (rows) return <section className="fc-list-page"><div className="fc-list-toolbar"><div><span className="fc-eyebrow">CONNECT / MAPPING LEDGER</span><h2>工业连接与数据路由</h2><p>连接器、数据点、数字孪生和本地回放记录在同一条可追溯链路中。</p></div><div className="fc-toolbar-actions"><button type="button" className="fc-secondary-button" onClick={onCreateMapping}>＋ 新建数据映射</button><button type="button" className="fc-secondary-button" onClick={onCreateAssetTwin}>＋ 绑定 AssetTwin</button><button type="button" className="fc-primary-button" onClick={onCreate}>＋ 添加连接器</button></div></div><div className="fc-table-card"><div className="fc-table-head fc-connection-table"><span>连接器</span><span>类型</span><span>端点</span><span>状态</span><span>映射</span><span>最近回放</span></div>{rows.length ? rows.map((row) => { const mapped = mappings.filter((mapping) => mapping.connectorId === row.id && mapping.status === 'active').length; const lastRun = syncRuns.find((run) => run.connectorId === row.id); return <div className="fc-table-row fc-connection-table" key={row.id}><span className="fc-project-name"><i className="fc-asset-preview"><CloudIcon icon={LinkData} size={17} /></i><strong>{row.name}</strong><small>{row.id}</small></span><span>{row.type}</span><span>{row.endpoint ?? '服务端托管'}</span><span><em className={`fc-state-pill ${row.status === 'online' ? 'green' : row.status === 'error' ? 'red' : 'muted'}`}>{row.status}</em></span><span>{mapped} 条</span><span className="fc-connection-action"><button type="button" onClick={() => onSync(row.id)}>{lastRun ? `${lastRun.valuesWritten} 值 / 再回放` : '回放事件'}</button></span></div> }) : <div className="fc-empty-row">当前工作空间尚未配置工业连接器</div>}</div><div className="fc-cloud-subgrid"><section className="fc-subpanel"><div className="fc-card-head"><div><span className="fc-panel-kicker">DATA ROUTING</span><h2>数据映射</h2></div><span className="fc-panel-meta">{mappings.length} 条映射</span></div>{mappings.length ? <div className="fc-mapping-list">{mappings.slice(0, 12).map((mapping) => <div className="fc-mapping-row" key={mapping.id}><div><strong>{mapping.sourceTag}</strong><small>{mapping.connector ?? mapping.connectorId}</small></div><span className="fc-mapping-arrow">→</span><div><strong>{mapping.pointLabel ?? mapping.pointKey ?? mapping.twin ?? '未绑定目标'}</strong><small>{mapping.semanticKey}{mapping.unit ? ` · ${mapping.unit}` : ''}</small></div><em className={`fc-state-pill ${mapping.status === 'active' ? 'green' : 'muted'}`}>{mapping.status === 'active' ? '启用' : '停用'}</em></div>)}</div> : <div className="fc-empty-row">尚未创建数据点到孪生状态的映射</div>}<div className="fc-subpanel-divider"><span className="fc-panel-kicker">ASSET / TWIN CONTEXT</span><strong>AssetTwin 绑定</strong>{assetTwins.length ? assetTwins.slice(0, 8).map((binding) => <div className="fc-asset-twin-row" key={binding.id}><span><b>{binding.factoryObjectId ?? binding.externalAssetId ?? '未命名资产'}</b><small>{binding.project ?? '工作空间级'} · {binding.twin}</small></span><em className={`fc-state-pill ${binding.status === 'active' ? 'green' : 'muted'}`}>{binding.status === 'active' ? '已绑定' : binding.status}</em></div>) : <small className="fc-muted-copy">尚未绑定工厂对象或外部资产</small>}</div></section><section className="fc-subpanel"><div className="fc-card-head"><div><span className="fc-panel-kicker">SYNC RUN LEDGER</span><h2>同步运行</h2></div><span className="fc-panel-meta">软件回放模式</span></div>{syncRuns.length ? <div className="fc-sync-list">{syncRuns.slice(0, 8).map((run) => <div className="fc-sync-row" key={run.id}><div><strong>{run.connector ?? run.connectorId}</strong><small>{run.mode} · {run.requestedAt?.slice(0, 16).replace('T', ' ') ?? '刚刚'}</small></div><span><b>{run.valuesWritten}</b> 写入 · <b>{run.eventsRead}</b> 事件</span><em className={`fc-state-pill ${run.status === 'completed' ? 'green' : run.status === 'failed' ? 'red' : 'amber'}`}>{run.status}</em></div>)}</div> : <div className="fc-empty-row">尚未运行本地事件回放</div>}</section></div><div className="fc-connection-foot"><span><i className="green" /> 映射写入 Data Cloud / Twin Cloud · 当前仅回放已入库运行事件</span><button type="button" onClick={() => onNotice('连接器仍保持只读；现场 OPC UA / MQTT 接入将在后续阶段启用')}>查看边界说明 <CloudIcon icon={ArrowRightData} size={14} /></button></div></section>
  return <section className="fc-list-page"><ListToolbar eyebrow="CONNECT / SIGNAL ROUTING" title="工业连接" action="添加连接器" onAction={onCreate} /><div className="fc-connection-map"><div className="fc-connection-column"><span className="fc-map-label">SOURCE / FIELD</span><div className="fc-map-node"><CloudIcon icon={RadioData} size={17} /><span><b>PLC-A01</b><small>现场设备 · 5 个数据点</small></span></div><div className="fc-map-node muted"><CloudIcon icon={RadioData} size={17} /><span><b>CSV 回放 / 2026-08</b><small>历史数据 · 已完成</small></span></div></div><div className="fc-map-lines"><i /><i /><i /></div><div className="fc-connection-column"><span className="fc-map-label">CONNECTOR</span><div className="fc-map-node"><CloudIcon icon={LinkData} size={17} /><span><b>OPC UA-01</b><small>只读 · 连接正常</small></span><em className="fc-state-pill green">正常</em></div><div className="fc-map-node error"><CloudIcon icon={LinkData} size={17} /><span><b>MQTT-01</b><small>最后心跳 12 分钟前</small></span><em className="fc-state-pill red">中断</em></div></div><div className="fc-map-lines"><i /><i /><i /></div><div className="fc-connection-column"><span className="fc-map-label">FORGEMIND / TWIN</span><div className="fc-map-node"><CloudIcon icon={GitBranchData} size={17} /><span><b>CNC-01</b><small>machine.state · energy.kw</small></span></div><div className="fc-map-node muted"><CloudIcon icon={ActivityData} size={17} /><span><b>运行摘要</b><small>状态、质量码、时间戳</small></span></div></div></div><div className="fc-connection-foot"><span><i className="green" /> 只读数据接入 · 不控制现场设备</span><button type="button" onClick={() => onNotice('连接器登记完成后，可在当前工作空间创建数据映射和 AssetTwin 绑定')}>查看接入说明 <CloudIcon icon={ArrowRightData} size={14} /></button></div></section>
}

function TasksPanel({ rows, approvals, onNotice, onCreate, onCreateApproval, onStatus, onDecision }: { rows: ForgeCloudTask[] | null; approvals: ForgeCloudApproval[] | null; onNotice: (message: string) => void; onCreate: () => void; onCreateApproval: () => void; onStatus: (taskId: string, status: string) => void; onDecision: (approvalId: string, status: 'approved' | 'rejected' | 'replan') => void }) {
  if (rows || approvals) return <section className="fc-list-page"><div className="fc-list-toolbar"><div><span className="fc-panel-kicker">WORK / APPROVAL QUEUE</span><h2>任务与审批</h2><p>任务状态与审批决策分开记录，所有动作都能回到项目和审计链。</p></div><div className="fc-toolbar-actions"><button type="button" className="fc-secondary-button" onClick={onCreate}>创建任务</button><button type="button" className="fc-primary-button" onClick={onCreateApproval}>发起审批</button></div></div><div className="fc-approval-list">{approvals?.length ? approvals.slice(0, 12).map((approval) => <article className={`fc-approval-card ${approval.status === 'approved' ? 'green' : approval.status === 'rejected' ? 'red' : 'amber'}`} key={approval.id}><div className="fc-approval-head"><span><CloudIcon icon={FileCheckData} size={16} /> {approval.type}</span><em className={`fc-state-pill ${approval.status === 'approved' ? 'green' : approval.status === 'rejected' ? 'red' : 'amber'}`}>{approval.status}</em></div><h3>{approval.title}</h3><p>{approval.projectName ?? '工作空间级'} · {approval.objectType} / {approval.objectId} · {approval.detail ?? '无补充说明'}</p><small>申请人 {approval.requester ?? approval.requestedBy} · {approval.rollbackAvailable ? '支持回滚' : '未声明回滚'}</small>{approval.status === 'pending' || approval.status === 'replan' ? <div className="fc-approval-actions"><button type="button" className="fc-secondary-button" onClick={() => onDecision(approval.id, 'replan')}>要求重新规划</button><button type="button" className="fc-secondary-button" onClick={() => onDecision(approval.id, 'rejected')}>拒绝</button><button type="button" className="fc-primary-button" onClick={() => onDecision(approval.id, 'approved')}>批准</button></div> : <div className="fc-approval-result">{approval.decisionNote ? `决策说明：${approval.decisionNote}` : `由 ${approval.decider ?? '审批人'} 处理`}</div>}</article>) : <div className="fc-empty-row">当前工作空间没有审批请求</div>}</div><div className="fc-task-grid">{rows?.length ? rows.slice(0, 12).map((row) => <TaskCard key={row.id} tone={row.status === 'done' ? 'green' : row.status === 'blocked' ? 'red' : 'amber'} icon={row.status === 'done' ? CheckCircleData : ListChecksData} label={row.status} count="01" title={row.title} detail={`${row.type} · ${row.detail ?? '无补充说明'}${row.assignee ? ` · ${row.assignee}` : ''}`} primary={row.status === 'done' ? '查看活动' : row.status === 'blocked' ? '重新打开' : '标记完成'} onAction={() => row.status === 'done' ? onNotice(`任务 ${row.title} 已完成`) : onStatus(row.id, row.status === 'blocked' ? 'open' : 'done')} />) : <div className="fc-empty-row">当前工作空间没有任务</div>}</div></section>
  return <section className="fc-list-page"><ListToolbar eyebrow="WORK / APPROVAL QUEUE" title="任务与审批" action="创建任务" onAction={() => onNotice('任务创建将在 F3 接入')} /><div className="fc-task-grid"><TaskCard tone="amber" icon={ListChecksData} label="待审批" count="02" title="A-02 工厂版本" detail="ForgeMind Agent · 2 个设备移动 / 1 条物流调整" primary="在 ForgeMind 中检查" onAction={() => onNotice('将在 ForgeMind 中打开审批上下文')} /><TaskCard tone="red" icon={RadioData} label="异常" count="01" title="MQTT-01 连接中断" detail="工业连接 · 最后心跳 12 分钟前 / 需要管理员处理" primary="查看连接" onAction={() => onNotice('连接器详情将在 F4 接入')} /><TaskCard tone="green" icon={CheckCircleData} label="已完成" count="18" title="本周已处理任务" detail="包含 6 条移动端确认、8 条资源审核和 4 条版本动作" primary="查看活动" onAction={() => onNotice('任务历史将在 F3 接入')} /></div></section>
}

function TaskCard({ tone, icon, label, count, title, detail, primary, onAction }: { tone: string; icon: typeof ListChecksData; label: string; count: string; title: string; detail: string; primary: string; onAction: () => void }) {
  return <article className={`fc-task-card ${tone}`}><div className="fc-task-card-head"><span><CloudIcon icon={icon} size={16} /> {label}</span><b>{count}</b></div><h3>{title}</h3><p>{detail}</p><button type="button" className="fc-secondary-button" onClick={onAction}>{primary} <CloudIcon icon={ArrowRightData} size={14} /></button></article>
}

function MembersPanel({ rows, workspaceName, canManage, onInvite, onEditRole, onNotice }: { rows: ForgeCloudMember[] | null; workspaceName: string; canManage: boolean; onInvite: () => void; onEditRole: (member: ForgeCloudMember) => void; onNotice: (message: string) => void }) {
  const displayRows = rows ?? [{ userId: 'demo-owner', username: '王工', role: 'owner', status: 'active', projectCount: 3, joinedAt: '' }, { userId: 'demo-editor', username: '李工', role: 'member', status: 'active', projectCount: 2, joinedAt: '' }, { userId: 'demo-operator', username: '周工', role: 'guest', status: 'inactive', projectCount: 1, joinedAt: '' }]
  return <section className="fc-list-page"><ListToolbar eyebrow="WORKSPACE / ACCESS" title="成员与权限" action="邀请成员" onAction={() => canManage ? onInvite() : onNotice('当前账号没有工作空间管理权限')} /><div className="fc-member-summary"><div><span className="fc-panel-kicker">CURRENT WORKSPACE</span><strong>{workspaceName}</strong><small>{canManage ? '管理员可邀请成员并调整非所有者角色' : '当前账号为只读成员，角色受服务端权限约束'}</small></div><div className="fc-role-count"><span><b>{String(displayRows.filter((row) => row.role === 'owner' || row.role === 'admin').length).padStart(2, '0')}</b><small>管理员</small></span><span><b>{String(displayRows.filter((row) => row.role === 'member').length).padStart(2, '0')}</b><small>成员</small></span><span><b>{String(displayRows.filter((row) => row.role === 'guest').length).padStart(2, '0')}</b><small>访客</small></span></div></div><div className="fc-table-card"><div className="fc-table-head fc-member-table"><span>成员</span><span>工作空间角色</span><span>项目访问</span><span>加入时间</span><span>状态</span><span /></div>{displayRows.map((row) => <div className="fc-table-row fc-member-table" key={row.userId}><span className="fc-member-name"><i>{row.username.slice(0, 1)}</i><strong>{row.username}</strong><small>{rows ? row.userId : 'demo@wzh.factory'}</small></span><span>{row.role.toUpperCase()}</span><span>{row.projectCount} 个项目</span><span>{row.joinedAt ? row.joinedAt.slice(0, 10) : '最近活动'}</span><span><em className={`fc-state-pill ${row.status === 'active' ? 'green' : 'muted'}`}>{row.status === 'active' ? '在线' : '离线'}</em></span><button type="button" className="fc-row-action" disabled={!canManage || row.role === 'owner'} onClick={() => canManage && row.role !== 'owner' ? onEditRole(row) : onNotice(row.role === 'owner' ? '工作空间所有者角色不可修改' : '当前账号没有工作空间管理权限')} aria-label={`编辑 ${row.username} 角色`}><CloudIcon icon={MoreData} size={17} /></button></div>)}</div></section>
}

function OperationsPanel({ runtimeEvents, telemetryWindows, workOrders, qualityResults, maintenanceRecords, onCreate, onStatus }: { runtimeEvents: ForgeCloudRuntimeEvent[]; telemetryWindows: ForgeCloudTelemetryWindow[]; workOrders: ForgeCloudWorkOrder[]; qualityResults: ForgeCloudQualityResult[]; maintenanceRecords: ForgeCloudMaintenanceRecord[]; onCreate: (kind: 'work-order' | 'quality-result' | 'maintenance-record' | 'telemetry-window') => void; onStatus: (id: string, status: string) => void }) {
  const time = (value?: string) => value ? value.slice(0, 16).replace('T', ' ') : '—'
  const tone = (value: string) => value === 'accepted' || value === 'good' || value === 'pass' || value === 'completed' || value === 'done' ? 'green' : value === 'quarantined' || value === 'bad' || value === 'scrap' || value === 'failed' ? 'red' : 'amber'
  return <section className="fc-list-page fc-operations-page">
    <div className="fc-list-toolbar"><div><span className="fc-eyebrow">OPERATE / QUALITY LEDGER</span><h2>运行与质量</h2><p>以事件为事实源，把遥测、工单、质量与维护组织成可回放的中枢台账。</p></div><div className="fc-toolbar-actions"><button type="button" className="fc-secondary-button" onClick={() => onCreate('telemetry-window')}>＋ 聚合窗口</button><button type="button" className="fc-primary-button" onClick={() => onCreate('work-order')}>＋ 新建工单</button></div></div>
    <div className="fc-operations-actions"><button type="button" className="fc-secondary-button" onClick={() => onCreate('quality-result')}>登记质量结果</button><button type="button" className="fc-secondary-button" onClick={() => onCreate('maintenance-record')}>登记维护记录</button><span><i className="green" /> 仅展示已入库软件事实 · 不代表真实仪器已接入</span></div>
    <div className="fc-cloud-subgrid fc-operations-grid"><section className="fc-subpanel"><div className="fc-card-head"><div><span className="fc-panel-kicker">RUNTIME EVENT LEDGER</span><h2>运行事件</h2></div><span className="fc-panel-meta">{runtimeEvents.length} 条</span></div>{runtimeEvents.length ? <div className="fc-runtime-list">{runtimeEvents.slice(0, 10).map((event) => <div className="fc-runtime-row" key={event.id}><span className="fc-runtime-dot" /><div><strong>{event.type}</strong><small>{event.source ?? 'connector'} · {event.pointId ?? event.twinId ?? '未绑定目标'} · {time(event.occurredAt)}</small></div><em className={`fc-state-pill ${tone(event.isolationStatus)}`}>{event.isolationStatus === 'accepted' ? event.quality : event.isolationStatus}</em></div>)}</div> : <div className="fc-empty-row">尚无运行事件；可从连接器回放或数据云写入</div>}</section><section className="fc-subpanel"><div className="fc-card-head"><div><span className="fc-panel-kicker">TELEMETRY WINDOWS</span><h2>遥测窗口</h2></div><span className="fc-panel-meta">{telemetryWindows.length} 个窗口</span></div>{telemetryWindows.length ? <div className="fc-window-list">{telemetryWindows.slice(0, 8).map((window) => <div className="fc-window-row" key={window.id}><div><strong>{window.metric}</strong><small>{window.pointLabel ?? window.pointKey ?? window.twin ?? '工作空间聚合'} · {time(window.windowStart)} → {time(window.windowEnd)}</small></div><span><b>{window.avg ?? '—'}</b>{window.unit ? ` ${window.unit}` : ''}<small>均值 · {window.validCount}/{window.sampleCount} 有效</small></span><em className={`fc-state-pill ${window.invalidCount ? 'amber' : 'green'}`}>{window.invalidCount ? `${window.invalidCount} 异常` : '稳定'}</em></div>)}</div> : <div className="fc-empty-row">尚无聚合窗口；窗口不会凭空生成数据</div>}</section></div>
    <div className="fc-ledger-grid"><section className="fc-subpanel"><div className="fc-card-head"><div><span className="fc-panel-kicker">WORK ORDER</span><h2>运行工单</h2></div><span className="fc-panel-meta">{workOrders.length} 条</span></div>{workOrders.length ? workOrders.slice(0, 8).map((order) => <article className="fc-ledger-card" key={order.id}><div><strong>{order.title}</strong><small>{order.type} · {order.project ?? '工作空间级'} · {order.assignee ?? '未分派'}</small></div><div className="fc-ledger-card-foot"><em className={`fc-state-pill ${tone(order.status)}`}>{order.status}</em>{order.status !== 'done' && order.status !== 'cancelled' ? <button type="button" className="fc-quiet-action" onClick={() => onStatus(order.id, order.status === 'open' ? 'in_progress' : 'done')}>{order.status === 'open' ? '开始处理' : '标记完成'} <CloudIcon icon={ArrowRightData} size={13} /></button> : <time>{time(order.actualAt ?? order.updatedAt)}</time>}</div></article>) : <div className="fc-empty-row">尚无运行工单</div>}</section><section className="fc-subpanel"><div className="fc-card-head"><div><span className="fc-panel-kicker">QUALITY / MAINTENANCE</span><h2>质量与维护</h2></div><span className="fc-panel-meta">{qualityResults.length + maintenanceRecords.length} 条记录</span></div><div className="fc-quality-stack">{qualityResults.slice(0, 4).map((result) => <div className="fc-quality-row" key={`q-${result.id}`}><span className="fc-ledger-icon"><CloudIcon icon={CheckCircleData} size={15} /></span><div><strong>{result.inspectionType}</strong><small>{result.lotId ?? '未标记批次'} · {time(result.occurredAt)}</small></div><em className={`fc-state-pill ${tone(result.result)}`}>{result.result}{result.score !== undefined ? ` · ${result.score}` : ''}</em></div>)}{maintenanceRecords.slice(0, 4).map((record) => <div className="fc-quality-row" key={`m-${record.id}`}><span className="fc-ledger-icon"><CloudIcon icon={SettingsData} size={15} /></span><div><strong>{record.action}</strong><small>{record.faultCode ?? '无故障码'} · 停机 {record.downtimeSeconds}s</small></div><em className={`fc-state-pill ${tone(record.result)}`}>{record.result}</em></div>)}{!qualityResults.length && !maintenanceRecords.length && <div className="fc-empty-row">尚无质量或维护记录</div>}</div></section></div>
  </section>
}

function CloudControlDialog({ dialog, projects, workspaceMembers, connectors, dataPoints, twins, busy, error, onClose, onSubmit }: { dialog: CloudDialog; projects: ForgeCloudProject[]; workspaceMembers: ForgeCloudMember[]; connectors: ForgeCloudConnector[]; dataPoints: ForgeCloudDataPoint[]; twins: ForgeCloudTwin[]; busy: boolean; error: string; onClose: () => void; onSubmit: (payload: CloudDialogPayload) => void }) {
  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  const [role, setRole] = useState(dialog.kind === 'role' ? dialog.member.role : dialog.kind === 'project-access' ? 'viewer' : 'member')
  const [titleValue, setTitleValue] = useState('')
  const [detail, setDetail] = useState('')
  const [priority, setPriority] = useState('normal')
  const [type, setType] = useState('')
  const [endpoint, setEndpoint] = useState('')
  const [deviceKey, setDeviceKey] = useState('')
  const [twinKey, setTwinKey] = useState('')
  const [pointKey, setPointKey] = useState('')
  const [label, setLabel] = useState('')
  const [dataType, setDataType] = useState('number')
  const [unit, setUnit] = useState('')
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '')
  const [memberUserId, setMemberUserId] = useState(dialog.kind === 'project-access' ? dialog.members.find((member) => member.role !== 'manager')?.userId ?? workspaceMembers[0]?.userId ?? '' : '')
  const [notes, setNotes] = useState('')
  const [externalId, setExternalId] = useState('')
  const [visibility, setVisibility] = useState('private')
  const [license, setLicense] = useState('')
  const [manifestText, setManifestText] = useState(dialog.kind === 'asset-version' ? JSON.stringify(dialog.currentManifest ?? {}, null, 2) : '{\n  "manifestVersion": 1,\n  "license": {},\n  "dependencies": []\n}')
  const [connectorId, setConnectorId] = useState(connectors[0]?.id ?? '')
  const [dataPointId, setDataPointId] = useState(dataPoints[0]?.id ?? '')
  const [twinId, setTwinId] = useState('')
  const [sourceTag, setSourceTag] = useState('')
  const [semanticKey, setSemanticKey] = useState('')
  const [transformText, setTransformText] = useState('{}')
  const [assetFile, setAssetFile] = useState<File | null>(null)
  const [body, setBody] = useState('')
  const [objectId, setObjectId] = useState('')
  const [forgeLabPostId, setForgeLabPostId] = useState('')
  const [rollbackAvailable, setRollbackAvailable] = useState(true)
  const [windowStart, setWindowStart] = useState('')
  const [windowEnd, setWindowEnd] = useState('')
  const [metric, setMetric] = useState('')
  const [lotId, setLotId] = useState('')
  const [inspectionType, setInspectionType] = useState('final_inspection')
  const [qualityResult, setQualityResult] = useState('unknown')
  const [faultCode, setFaultCode] = useState('')
  const [action, setAction] = useState('')
  const [downtimeSecondsText, setDowntimeSecondsText] = useState('0')
  const isWorkspace = dialog.kind === 'workspace'
  const isProject = dialog.kind === 'project'
  const isVersion = dialog.kind === 'version'
  const isProjectAccess = dialog.kind === 'project-access'
  const isRelease = dialog.kind === 'release'
  const isAsset = dialog.kind === 'asset'
  const isAssetVersion = dialog.kind === 'asset-version'
  const isMapping = dialog.kind === 'mapping'
  const isAssetTwin = dialog.kind === 'asset-twin'
  const isPublication = dialog.kind === 'publication'
  const isComment = dialog.kind === 'comment'
  const isRole = dialog.kind === 'role'
  const isMember = dialog.kind === 'member'
  const isTask = dialog.kind === 'task'
  const isApproval = dialog.kind === 'approval'
  const isConnector = dialog.kind === 'connector'
  const isDevice = dialog.kind === 'device'
  const isTwin = dialog.kind === 'twin'
  const isDataPoint = dialog.kind === 'data-point'
  const isAiTask = dialog.kind === 'ai-task'
  const isWorkOrder = dialog.kind === 'work-order'
  const isQualityResult = dialog.kind === 'quality-result'
  const isMaintenanceRecord = dialog.kind === 'maintenance-record'
  const isTelemetryWindow = dialog.kind === 'telemetry-window'
  const title = isWorkspace ? '创建工作空间' : isProject ? '创建工厂项目' : isVersion ? '提交当前存档版本' : isProjectAccess ? '管理项目访问' : isAsset ? '登记资源元数据' : isAssetVersion ? `创建 ${dialog.assetName} 新版本` : isMapping ? '创建数据映射' : isAssetTwin ? '绑定 AssetTwin' : isPublication ? '关联 ForgeLab 发布' : isRelease ? '发布项目版本' : isComment ? '项目协作记录' : isRole ? '调整成员角色' : isMember ? '邀请工作空间成员' : isTask ? '创建工作任务' : isApproval ? '发起统一审批' : isConnector ? '登记工业连接器' : isDevice ? '注册设备身份' : isTwin ? '创建数字孪生' : isDataPoint ? '登记数据点' : isWorkOrder ? '新建运行工单' : isQualityResult ? '登记质量结果' : isMaintenanceRecord ? '登记维护记录' : isTelemetryWindow ? '聚合遥测窗口' : '提交 AI 任务'
  const description = isWorkspace ? '创建后当前账号自动成为所有者。' : isProject ? '创建一个空白 ForgeMind 工厂项目，并登记首个可编辑版本。' : isVersion ? `读取 ${dialog.projectName} 当前存档，以当前云端版本为基线提交新版本。` : isProjectAccess ? `为 ${dialog.projectName} 授予当前工作空间成员项目级角色。` : isAsset ? '登记资源标识、类型和 v1 manifest；可选上传文件本体，服务端计算 SHA-256 并保存到对象存储。' : isAssetVersion ? `当前版本 v${dialog.currentVersion} 保持不变；提交后新增版本并原子切换资源当前指针。` : isMapping ? '把连接器源标签映射到 Data Point 或 Twin；当前同步只回放已入库运行事件。' : isAssetTwin ? '把 ForgeMind 工厂对象或外部资产绑定到当前工作空间的 Twin，形成可追踪的状态上下文。' : isPublication ? '将不可变项目发布或资源版本关联到已发布 ForgeLab 帖子，并冻结许可证声明。' : isRelease ? '将项目当前版本写入不可变发布记录，供团队复用和追溯。' : isComment ? `查看 ${dialog.projectName} 的评论，并将新的协作说明写入当前 workspace。` : isRole ? `更新 ${dialog.member.username} 在当前工作空间中的访问级别。` : isMember ? '输入已注册的 ForgeMind 账号用户名，服务端会校验账号并写入成员表。' : isTask ? '创建一条可追踪的工作或审批任务，并写入当前工作空间。' : isApproval ? '审批请求独立于任务保存，必须包含对象、证据边界和回滚声明。' : isConnector ? '登记服务端托管的只读数据源；不会直接控制现场设备。' : isDevice ? '设备身份先进入注册表，后续由现场 Agent 上报心跳。' : isTwin ? '先建立孪生实体，数据同步和来源绑定可在后续更新。' : isDataPoint ? '登记可被连接器或设备事件写入的数据点定义。' : isWorkOrder ? '工单是运行台账中的可追踪动作，可关联项目、Twin 与后续维护记录。' : isQualityResult ? '质量结果只记录明确的检验结论和证据引用，不替代真实检验过程。' : isMaintenanceRecord ? '维护记录保存故障、处置动作和停机影响，支持与工单关联。' : isTelemetryWindow ? '窗口由已入库数据事件确定性聚合，保留有效样本与异常样本数量。' : '提交一个由规则引擎或后续模型服务处理的推理任务。'

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    onSubmit({ name: name.trim(), username: username.trim(), role, title: titleValue.trim(), detail: detail.trim(), priority, type: type.trim(), endpoint: endpoint.trim(), deviceKey: deviceKey.trim(), twinKey: twinKey.trim(), pointKey: pointKey.trim(), label: label.trim(), dataType, unit: unit.trim(), projectId, memberUserId, notes: notes.trim(), externalId: externalId.trim(), visibility, license: license.trim(), manifestText, connectorId, dataPointId, twinId, sourceTag: sourceTag.trim(), semanticKey: semanticKey.trim(), transformText, assetFile, forgeLabPostId: forgeLabPostId.trim(), body: body.trim(), objectId: objectId.trim(), rollbackAvailable, windowStart, windowEnd, metric: metric.trim(), lotId: lotId.trim(), inspectionType: inspectionType.trim(), qualityResult, faultCode: faultCode.trim(), action: action.trim(), downtimeSecondsText: downtimeSecondsText.trim() })
  }

  return <div className="fc-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="fc-dialog" role="dialog" aria-modal="true" aria-labelledby="fc-dialog-title">
      <div className="fc-dialog-head"><div><span className="fc-panel-kicker">CLOUD CONTROL / WRITE ACTION</span><h2 id="fc-dialog-title">{title}</h2><p>{description}</p></div><button type="button" className="fc-dialog-close" onClick={onClose} disabled={busy} aria-label="关闭"><CloudIcon icon={XData} size={17} /></button></div>
      <form onSubmit={submit}>
        {isWorkspace && <label className="fc-form-field"><span>工作空间名称</span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：WZH 智能制造" maxLength={120} required /></label>}
        {isProject && <label className="fc-form-field"><span>项目名称</span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：A-03 新产线" maxLength={120} required /></label>}
        {isVersion && <><div className="fc-form-field"><span>项目</span><div className="fc-dialog-readonly"><b>{dialog.projectName}</b><small>当前版本基线 · {dialog.baseVersionId}</small></div></div><label className="fc-form-field"><span>版本说明（可选）</span><textarea autoFocus value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="例如：完成产能验证后的存档版本" maxLength={500} /></label></>}
        {isProjectAccess && <><div className="fc-form-field"><span>项目</span><div className="fc-dialog-readonly"><b>{dialog.projectName}</b><small>{dialog.members.length} 个项目授权记录</small></div></div><label className="fc-form-field"><span>工作空间成员</span><select autoFocus value={memberUserId} onChange={(event) => setMemberUserId(event.target.value)} required><option value="" disabled>选择成员</option>{workspaceMembers.map((member) => <option key={member.userId} value={member.userId}>{member.username} · {member.role.toUpperCase()}</option>)}</select></label><label className="fc-form-field"><span>项目角色</span><select value={role} onChange={(event) => setRole(event.target.value)}><option value="viewer">VIEWER · 只读查看</option><option value="editor">EDITOR · 提交版本/任务</option><option value="manager">MANAGER · 发布与授权</option></select></label></>}
        {isAsset && <><label className="fc-form-field"><span>资源标识</span><input autoFocus value={externalId} onChange={(event) => setExternalId(event.target.value)} placeholder="例如：machine-cnc-a01" maxLength={96} required /></label><label className="fc-form-field"><span>资源名称</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：A01 CNC 加工中心" maxLength={120} required /></label><label className="fc-form-field"><span>资源类型</span><select value={type || 'model3d'} onChange={(event) => setType(event.target.value)}><option value="model3d">3D 模型</option><option value="item">物品</option><option value="machine">机器</option><option value="recipe_pack">配方包</option><option value="factory_template">工厂模板</option></select></label><label className="fc-form-field"><span>可见范围</span><select value={visibility} onChange={(event) => setVisibility(event.target.value)}><option value="private">私有</option><option value="workspace">工作空间</option><option value="public">公共</option></select></label><label className="fc-form-field"><span>许可证声明（公开资源必填）</span><input value={license} onChange={(event) => setLicense(event.target.value)} placeholder="例如：CC BY 4.0 / MIT / 内部许可" maxLength={200} required={visibility === 'public'} /></label><label className="fc-form-field"><span>文件本体（可选，≤90 MB）</span><input type="file" onChange={(event) => setAssetFile(event.target.files?.[0] ?? null)} /></label></>}
        {isAssetVersion && <><div className="fc-form-field"><span>版本上下文</span><div className="fc-dialog-readonly"><b>{dialog.assetName}</b><small>当前 v{dialog.currentVersion} · 历史版本不可覆盖</small></div></div><label className="fc-form-field"><span>manifest v1（JSON）</span><textarea autoFocus value={manifestText} onChange={(event) => setManifestText(event.target.value)} spellCheck={false} rows={10} required /></label><label className="fc-form-field"><span>版本说明（可选）</span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="例如：替换模型材质并完成兼容性验证" maxLength={500} /></label></>}
        {isPublication && <><label className="fc-form-field"><span>关联来源</span><select autoFocus value={type || 'project_release'} onChange={(event) => setType(event.target.value)}><option value="project_release">项目发布</option><option value="asset">资源版本</option></select></label><label className="fc-form-field"><span>ForgeCloud 来源 ID</span><input value={objectId} onChange={(event) => setObjectId(event.target.value)} placeholder="发布 ID 或资源 ID" maxLength={96} required /></label><label className="fc-form-field"><span>ForgeLab 帖子 ID</span><input value={forgeLabPostId} onChange={(event) => setForgeLabPostId(event.target.value)} placeholder="例如：post-..." maxLength={64} required /></label><label className="fc-form-field"><span>许可证声明</span><textarea value={detail} onChange={(event) => setDetail(event.target.value)} placeholder="例如：CC BY 4.0，保留来源与修改声明" maxLength={1000} required /></label></>}
        {isRelease && <><label className="fc-form-field"><span>项目</span><select autoFocus value={projectId} onChange={(event) => setProjectId(event.target.value)} required><option value="" disabled>选择项目</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name} · v{project.version || 0}</option>)}</select></label><label className="fc-form-field"><span>发布名称</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：A-03 稳定版" maxLength={120} required /></label><label className="fc-form-field"><span>发布说明（可选）</span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="记录验证范围、变更或使用说明" maxLength={500} /></label></>}
        {isComment && <><div className="fc-comment-thread">{dialog.comments.length ? dialog.comments.map((comment) => <article key={comment.id}><div><strong>{comment.author ?? '工作空间成员'}</strong><time>{comment.createdAt.slice(0, 16).replace('T', ' ')}</time></div><p>{comment.body}</p></article>) : <div className="fc-dialog-readonly">暂无评论，先留下第一条协作说明。</div>}</div><label className="fc-form-field"><span>新增评论</span><textarea autoFocus value={body} onChange={(event) => setBody(event.target.value)} placeholder="记录验证结论、风险或下一步动作" maxLength={2000} required /></label></>}
        {(isMember || isRole) && <>
          {isRole ? <div className="fc-form-field"><span>成员账号</span><div className="fc-dialog-readonly"><b>{dialog.member.username}</b><small>{dialog.member.userId}</small></div></div> : <label className="fc-form-field"><span>ForgeMind 用户名</span><input autoFocus value={username} onChange={(event) => setUsername(event.target.value)} placeholder="输入已注册用户名" maxLength={120} required /></label>}
          <label className="fc-form-field"><span>工作空间角色</span><select value={role} onChange={(event) => setRole(event.target.value)}><option value="admin">管理员 · 可管理成员与工作空间</option><option value="member">成员 · 可参与项目协作</option><option value="guest">访客 · 只读访问</option></select></label>
        </>}
        {isTask && <><label className="fc-form-field"><span>任务标题</span><input autoFocus value={titleValue} onChange={(event) => setTitleValue(event.target.value)} placeholder="例如：确认 A-02 版本方案" maxLength={160} required /></label><label className="fc-form-field"><span>任务类型</span><select value={type || 'general'} onChange={(event) => setType(event.target.value)}><option value="general">通用工作</option><option value="approval">版本审批</option><option value="maintenance">维护任务</option><option value="agent">Agent 方案</option></select></label><label className="fc-form-field"><span>优先级</span><select value={priority} onChange={(event) => setPriority(event.target.value)}><option value="normal">普通</option><option value="high">高</option><option value="low">低</option></select></label><label className="fc-form-field"><span>说明</span><textarea value={detail} onChange={(event) => setDetail(event.target.value)} placeholder="补充上下文（可选）" maxLength={500} /></label></>}
        {isApproval && <><label className="fc-form-field"><span>审批标题</span><input autoFocus value={titleValue} onChange={(event) => setTitleValue(event.target.value)} placeholder="例如：发布 A-03 稳定版" maxLength={180} required /></label><label className="fc-form-field"><span>审批类型</span><select value={type || 'release'} onChange={(event) => setType(event.target.value)}><option value="release">项目发布</option><option value="resource">资源审核</option><option value="agent_patch">Agent Patch</option></select></label><label className="fc-form-field"><span>关联项目（可选）</span><select value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="">工作空间级</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label><label className="fc-form-field"><span>对象标识</span><input value={objectId} onChange={(event) => setObjectId(event.target.value)} placeholder="版本、资源或 Patch ID" maxLength={96} required /></label><label className="fc-form-field"><span>证据与影响</span><textarea value={detail} onChange={(event) => setDetail(event.target.value)} placeholder="写明验证范围、风险和影响" maxLength={2000} required /></label><label className="fc-form-check"><input type="checkbox" checked={rollbackAvailable} onChange={(event) => setRollbackAvailable(event.target.checked)} /><span>已有可回滚快照或逆向操作</span></label></>}
        {isConnector && <><label className="fc-form-field"><span>连接器名称</span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：产线 OPC UA" maxLength={120} required /></label><label className="fc-form-field"><span>协议类型</span><select value={type || 'csv'} onChange={(event) => setType(event.target.value)}><option value="csv">CSV / 文件回放</option><option value="opcua">OPC UA</option><option value="mqtt">MQTT</option></select></label><label className="fc-form-field"><span>端点（可选）</span><input value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder="由服务端连接代理托管" maxLength={300} /></label></>}
        {isMapping && <><label className="fc-form-field"><span>连接器</span><select autoFocus value={connectorId} onChange={(event) => setConnectorId(event.target.value)} required><option value="" disabled>选择连接器</option>{connectors.map((connector) => <option key={connector.id} value={connector.id}>{connector.name} · {connector.type}</option>)}</select></label><label className="fc-form-field"><span>源标签</span><input value={sourceTag} onChange={(event) => setSourceTag(event.target.value)} placeholder="例如：cnc-a01.energy.kw 或 tags.energy.kw" maxLength={240} required /></label><label className="fc-form-field"><span>语义键</span><input value={semanticKey} onChange={(event) => setSemanticKey(event.target.value)} placeholder="例如：energy_kw" maxLength={160} required /></label><label className="fc-form-field"><span>目标数据点（可选）</span><select value={dataPointId} onChange={(event) => setDataPointId(event.target.value)}><option value="">不写入数据点</option>{dataPoints.map((point) => <option key={point.id} value={point.id}>{point.label} · {point.pointKey}</option>)}</select></label><label className="fc-form-field"><span>目标孪生（可选）</span><select value={twinId} onChange={(event) => setTwinId(event.target.value)}><option value="">不更新孪生</option>{twins.map((twin) => <option key={twin.id} value={twin.id}>{twin.name} · {twin.twinKey}</option>)}</select></label><label className="fc-form-field"><span>单位（可选）</span><input value={unit} onChange={(event) => setUnit(event.target.value)} placeholder="kW / °C / 件" maxLength={32} /></label><label className="fc-form-field"><span>数值变换（JSON，可选）</span><textarea value={transformText} onChange={(event) => setTransformText(event.target.value)} placeholder={'例如：{\"scale\": 0.001, \"round\": 2}'} spellCheck={false} rows={3} /></label></>}
         {isAssetTwin && <><label className="fc-form-field"><span>目标 Twin</span><select autoFocus value={twinId} onChange={(event) => setTwinId(event.target.value)} required><option value="" disabled>选择数字孪生</option>{twins.map((twin) => <option key={twin.id} value={twin.id}>{twin.name} · {twin.twinKey}</option>)}</select></label><label className="fc-form-field"><span>所属项目（可选）</span><select value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="">工作空间级绑定</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label><label className="fc-form-field"><span>ForgeMind 工厂对象 ID（可选）</span><input value={objectId} onChange={(event) => setObjectId(event.target.value)} placeholder="例如：machine-cnc-a01" maxLength={160} /></label><label className="fc-form-field"><span>外部资产 ID（可选）</span><input value={externalId} onChange={(event) => setExternalId(event.target.value)} placeholder="例如：asset-cnc-a01" maxLength={160} /></label><label className="fc-form-field"><span>绑定说明（可选）</span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="记录该对象与 Twin 的业务关系" maxLength={500} /></label></>}
         {isDevice && <><label className="fc-form-field"><span>设备标识</span><input autoFocus value={deviceKey} onChange={(event) => setDeviceKey(event.target.value)} placeholder="例如：cnc-a01" maxLength={120} required /></label><label className="fc-form-field"><span>显示名称</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：A01 CNC 加工中心" maxLength={120} required /></label><label className="fc-form-field"><span>设备类型</span><input value={type} onChange={(event) => setType(event.target.value)} placeholder="machine" maxLength={80} required /></label><label className="fc-form-field"><span>现场端点（可选）</span><input value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder="由设备 Agent 上报" maxLength={300} /></label></>}
        {isTwin && <><label className="fc-form-field"><span>孪生标识</span><input autoFocus value={twinKey} onChange={(event) => setTwinKey(event.target.value)} placeholder="例如：line-a01" maxLength={120} required /></label><label className="fc-form-field"><span>显示名称</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：A01 产线孪生" maxLength={120} required /></label><label className="fc-form-field"><span>孪生类型</span><input value={type} onChange={(event) => setType(event.target.value)} placeholder="production-line" maxLength={80} required /></label></>}
         {isDataPoint && <><label className="fc-form-field"><span>数据点标识</span><input autoFocus value={pointKey} onChange={(event) => setPointKey(event.target.value)} placeholder="例如：cnc-a01.energy.kw" maxLength={160} required /></label><label className="fc-form-field"><span>显示名称</span><input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="例如：主轴功率" maxLength={120} required /></label><label className="fc-form-field"><span>数据类型</span><select value={dataType} onChange={(event) => setDataType(event.target.value)}><option value="number">数值</option><option value="boolean">布尔</option><option value="string">文本</option></select></label><label className="fc-form-field"><span>单位（可选）</span><input value={unit} onChange={(event) => setUnit(event.target.value)} placeholder="kW / °C / 件" maxLength={40} /></label></>}
         {isWorkOrder && <><label className="fc-form-field"><span>工单标题</span><input autoFocus value={titleValue} onChange={(event) => setTitleValue(event.target.value)} placeholder="例如：A01 主轴温升复核" maxLength={180} required /></label><label className="fc-form-field"><span>工单类型</span><select value={type || 'maintenance'} onChange={(event) => setType(event.target.value)}><option value="maintenance">维护</option><option value="quality">质量</option><option value="incident">运行异常</option><option value="general">通用</option></select></label><label className="fc-form-field"><span>优先级</span><select value={priority} onChange={(event) => setPriority(event.target.value)}><option value="normal">普通</option><option value="high">高</option><option value="urgent">紧急</option><option value="low">低</option></select></label><label className="fc-form-field"><span>关联项目（可选）</span><select value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="">工作空间级</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label><label className="fc-form-field"><span>关联 Twin（可选）</span><select value={twinId} onChange={(event) => setTwinId(event.target.value)}><option value="">不关联</option>{twins.map((twin) => <option key={twin.id} value={twin.id}>{twin.name}</option>)}</select></label><label className="fc-form-field"><span>说明</span><textarea value={detail} onChange={(event) => setDetail(event.target.value)} placeholder="记录异常背景、验收条件或处理边界" maxLength={1000} /></label></>}
         {isQualityResult && <><label className="fc-form-field"><span>检验类型</span><input autoFocus value={inspectionType} onChange={(event) => setInspectionType(event.target.value)} placeholder="final_inspection / incoming" maxLength={80} required /></label><label className="fc-form-field"><span>检验结论</span><select value={qualityResult} onChange={(event) => setQualityResult(event.target.value)}><option value="pass">通过</option><option value="quarantine">隔离</option><option value="rework">返工</option><option value="scrap">报废</option><option value="unknown">未知</option></select></label><label className="fc-form-field"><span>质量分数（可选，0–100）</span><input value={notes} onChange={(event) => setNotes(event.target.value)} inputMode="decimal" placeholder="例如：98.5" /></label><label className="fc-form-field"><span>批次号（可选）</span><input value={lotId} onChange={(event) => setLotId(event.target.value)} placeholder="LOT-20260902-01" maxLength={120} /></label><label className="fc-form-field"><span>证据引用（可选）</span><input value={externalId} onChange={(event) => setExternalId(event.target.value)} placeholder="报告 ID、文件哈希或快照 ID" maxLength={240} /></label><label className="fc-form-field"><span>关联工单（可选）</span><input value={objectId} onChange={(event) => setObjectId(event.target.value)} placeholder="work-order UUID" maxLength={64} /></label><label className="fc-form-field"><span>备注</span><textarea value={detail} onChange={(event) => setDetail(event.target.value)} maxLength={1000} /></label></>}
         {isMaintenanceRecord && <><label className="fc-form-field"><span>维护动作</span><input autoFocus value={action} onChange={(event) => setAction(event.target.value)} placeholder="例如：更换冷却液并复位报警" maxLength={500} required /></label><label className="fc-form-field"><span>结果</span><select value={qualityResult} onChange={(event) => setQualityResult(event.target.value)}><option value="reported">已上报</option><option value="in_progress">处理中</option><option value="completed">已完成</option><option value="failed">失败</option><option value="deferred">延期</option></select></label><label className="fc-form-field"><span>故障码（可选）</span><input value={faultCode} onChange={(event) => setFaultCode(event.target.value)} placeholder="ALARM-000" maxLength={96} /></label><label className="fc-form-field"><span>停机时长（秒）</span><input value={downtimeSecondsText} onChange={(event) => setDowntimeSecondsText(event.target.value)} inputMode="numeric" /></label><label className="fc-form-field"><span>关联工单（可选）</span><input value={objectId} onChange={(event) => setObjectId(event.target.value)} placeholder="work-order UUID" maxLength={64} /></label><label className="fc-form-field"><span>维护说明</span><textarea value={detail} onChange={(event) => setDetail(event.target.value)} maxLength={1000} /></label></>}
         {isTelemetryWindow && <><label className="fc-form-field"><span>数据点（可选，与 Twin 至少选一项）</span><select autoFocus value={dataPointId} onChange={(event) => setDataPointId(event.target.value)}><option value="">不限定数据点</option>{dataPoints.map((point) => <option key={point.id} value={point.id}>{point.label} · {point.pointKey}</option>)}</select></label><label className="fc-form-field"><span>Twin（可选）</span><select value={twinId} onChange={(event) => setTwinId(event.target.value)}><option value="">不限定 Twin</option>{twins.map((twin) => <option key={twin.id} value={twin.id}>{twin.name}</option>)}</select></label><label className="fc-form-field"><span>指标名（可选）</span><input value={metric} onChange={(event) => setMetric(event.target.value)} placeholder="energy_kw" maxLength={96} /></label><label className="fc-form-field"><span>窗口开始</span><input type="datetime-local" value={windowStart} onChange={(event) => setWindowStart(event.target.value)} required /></label><label className="fc-form-field"><span>窗口结束</span><input type="datetime-local" value={windowEnd} onChange={(event) => setWindowEnd(event.target.value)} required /></label></>}
         {isAiTask && <label className="fc-form-field"><span>任务类型</span><select autoFocus value={type || 'agent'} onChange={(event) => setType(event.target.value)}><option value="agent">Agent 诊断</option><option value="vision">视觉分析</option><option value="forecast">产能预测</option></select></label>}
        {error && <div className="fc-dialog-error" role="alert">{error}</div>}
        <div className="fc-dialog-actions"><button type="button" className="fc-secondary-button" onClick={onClose} disabled={busy}>取消</button><button type="submit" className="fc-primary-button" disabled={busy}>{busy ? '提交中…' : isWorkspace ? '创建并进入' : isRole || isProjectAccess ? '保存变更' : isComment ? '发布评论' : isVersion ? '提交新版本' : isApproval ? '提交审批' : '提交到云端'}</button></div>
      </form>
    </section>
  </div>
}

function AuditPanel({ rows, onNotice }: { rows: import('../api/forgeCloud').ForgeCloudAudit[] | null; onNotice: (message: string) => void }) {
  const displayRows = rows?.length ? rows.map((row) => ({
    actor: row.actor ?? '系统',
    source: row.source,
    action: row.action,
    target: `${row.objectType ?? 'OBJECT'} / ${row.objectId ?? '—'}`,
    result: row.result === 'success' ? '成功' : row.result,
    time: row.createdAt.slice(11, 16) || '—',
  })) : auditRows
  const exportAudit = () => {
    if (!rows?.length) { onNotice('当前没有可导出的云端审计记录'); return }
    const escape = (value: string) => `"${value.replace(/"/g, '""')}"`
    const lines = [['actor', 'source', 'action', 'objectType', 'objectId', 'result', 'createdAt'], ...rows.map((row) => [row.actor ?? row.actorUserId ?? 'system', row.source, row.action, row.objectType ?? '', row.objectId ?? '', row.result, row.createdAt])]
    const csv = `\uFEFF${lines.map((line) => line.map(escape).join(',')).join('\n')}`
    const url = window.URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `forgecloud-audit-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    window.setTimeout(() => window.URL.revokeObjectURL(url), 0)
    onNotice(`已导出 ${rows.length} 条审计记录`)
  }
  return <section className="fc-list-page"><ListToolbar eyebrow="GOVERNANCE / AUDIT TRAIL" title="活动与审计" action="导出审计" onAction={exportAudit} /><div className="fc-audit-filter"><button type="button" className="is-active">全部活动</button><button type="button">ForgeMind</button><button type="button">ForgeHub3D</button><button type="button">ForgeMove</button><button type="button">系统与连接</button><span>{rows?.length ? '云端活动 / 最近记录' : '今天 / 最近 24 小时'}</span></div><div className="fc-table-card"><div className="fc-table-head fc-audit-table"><span>主体</span><span>来源</span><span>动作</span><span>目标</span><span>结果</span><span>时间</span></div>{displayRows.map((row) => <div className="fc-table-row fc-audit-table" key={`${row.actor}-${row.action}-${row.time}`}><span className="fc-audit-actor"><i>{row.actor.slice(0, 1)}</i><strong>{row.actor}</strong></span><span>{row.source}</span><span>{row.action}</span><code>{row.target}</code><span><em className={`fc-state-pill ${row.result === '成功' || row.result === 'success' ? 'green' : 'red'}`}>{row.result}</em></span><time>{row.time}</time></div>)}</div></section>
}

function ListToolbar({ eyebrow, title, action, onAction }: { eyebrow: string; title: string; action: string; onAction: () => void }) {
  return <div className="fc-list-toolbar"><div><span className="fc-eyebrow">{eyebrow}</span><h2>{title}</h2></div><button type="button" className="fc-primary-button" onClick={onAction}>＋ {action}</button></div>
}

function IntelligencePanel({ kind, rows, onNotice, onCreate, onHeartbeat, onDataEvent, onAiRun }: { kind: 'devices' | 'twins' | 'data' | 'ai'; rows: unknown[]; onNotice: (message: string) => void; onCreate: () => void; onHeartbeat?: (deviceId: string) => void; onDataEvent?: (pointId: string, value: unknown) => void; onAiRun?: (taskId: string) => void }) {
  const config = {
    devices: { action: '注册设备', empty: '当前工作空间尚未登记设备', icon: RadioData, columns: ['设备', '类型', '状态', '端点', '最后心跳', '操作'] },
    twins: { action: '创建孪生', empty: '当前工作空间尚未创建数字孪生', icon: CloudCogData, columns: ['孪生', '类型', '质量', '来源设备', '最后状态'] },
    data: { action: '新增数据点', empty: '当前工作空间尚未登记数据点', icon: ActivityData, columns: ['数据点', '数据类型', '最新值 / 质量', '设备', '最后事件', '操作'] },
    ai: { action: '提交 AI 任务', empty: '当前工作空间尚未提交 AI 任务', icon: ShieldCheckData, columns: ['任务', '模型', '提供方', '状态', '项目'] },
  }[kind]
  const records = rows as Array<Record<string, unknown>>
  const values = (row: Record<string, unknown>) => {
    if (kind === 'devices') return [row.name, row.type, row.status, row.endpoint ?? '服务端托管', row.lastSeenAt ?? '尚未心跳']
    if (kind === 'twins') return [row.name, row.type, row.quality, row.sourceDevice ?? '未绑定设备', row.lastStateAt ?? '尚未同步']
    if (kind === 'data') return [row.label, row.dataType, row.lastValue ? `${JSON.stringify(row.lastValue)} · ${row.lastQuality ?? 'unknown'}` : '尚无事件', row.device ?? '—', row.lastOccurredAt ?? '尚未采集']
    return [row.type, row.model ?? '确定性规则引擎', row.provider ?? 'rule', row.status, row.project ?? '工作空间级']
  }
  return <section className="fc-list-page"><ListToolbar eyebrow={sectionMeta[kind].eyebrow} title={sectionMeta[kind].title} action={config.action} onAction={onCreate} /><div className="fc-table-card"><div className={`fc-table-head fc-intelligence-table ${kind}`}>{config.columns.map((column) => <span key={column}>{column}</span>)}</div>{records.length ? records.slice(0, 100).map((row, index) => <div className={`fc-table-row fc-intelligence-table ${kind}`} key={String(row.id ?? `${kind}-${index}`)}>{values(row).map((value, valueIndex) => valueIndex === 0 ? <span className="fc-intelligence-name" key={`${valueIndex}-${String(value)}`}><i><CloudIcon icon={config.icon} size={16} /></i><strong>{String(value ?? '—')}</strong><small>{String(row.id ?? '—')}</small></span> : <span key={`${valueIndex}-${String(value)}`}>{String(value ?? '—')}</span>)}{kind === 'devices' && <span className="fc-intelligence-action"><button type="button" onClick={() => onHeartbeat?.(String(row.id))}>接收心跳</button></span>}{kind === 'data' && <span className="fc-intelligence-action"><button type="button" onClick={() => onDataEvent?.(String(row.id), row.dataType === 'boolean' ? true : row.dataType === 'string' ? 'manual' : 0)}>写入事件</button></span>}{kind === 'ai' && <span className="fc-intelligence-action">{row.status === 'queued' || row.status === 'failed' ? <button type="button" onClick={() => onAiRun?.(String(row.id))}>执行规则任务</button> : <span>{row.status === 'completed' ? '已完成' : String(row.status ?? '—')}</span>}</span>}</div>) : <div className="fc-empty-row">{remoteSnapshotHint(rows, config.empty)}</div>}</div><div className="fc-connection-foot"><span><i className="green" /> 数据来自 ForgeCloud V16 API · 默认最少权限</span><button type="button" onClick={() => onNotice(`${sectionMeta[kind].title}数据已按当前工作空间过滤`)}>查看数据边界 <CloudIcon icon={ArrowRightData} size={14} /> </button></div></section>
}

function remoteSnapshotHint(rows: unknown[], empty: string) {
  return rows.length ? '' : empty
}
