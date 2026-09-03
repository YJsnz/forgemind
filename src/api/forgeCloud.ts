import { BACKEND_BASE } from './backendBase'

export type ForgeCloudWorkspace = {
  id: string
  name: string
  slug: string
  type: string
  status: string
  role: string
  projectCount: number
  memberCount: number
  createdAt: string
  updatedAt: string
}

export type ForgeCloudProject = {
  id: string
  name: string
  type: string
  visibility: string
  status: string
  accessRole?: 'manager' | 'editor' | 'viewer'
  currentVersionId?: string
  version: number
  branch: string
  schemaVersion: number
  contentHash?: string
  createdAt: string
  updatedAt: string
  versionCreatedAt?: string
}

export type ForgeCloudAsset = {
  id: string
  externalId: string
  kind: string
  name: string
  visibility: string
  status: string
  currentVersionId?: string
  version: number
  contentHash?: string
  fileCount?: number
  manifest?: unknown
  createdAt: string
  updatedAt: string
}

export type ForgeCloudAssetVersion = {
  id: string
  assetId: string
  version: number
  manifestVersion: number
  manifest: unknown
  contentHash: string
  note?: string
  createdBy: string
  creator?: string
  createdAt: string
  current: boolean
  fileCount: number
}

export type ForgeCloudAudit = {
  id: number
  actorUserId?: string
  actor?: string
  source: string
  action: string
  objectType?: string
  objectId?: string
  result: string
  requestId?: string
  createdAt: string
}
export type ForgeCloudActivity = {
  id: number
  outboxEventId: string
  workspaceId: string
  eventType: string
  aggregateType?: string
  aggregateId?: string
  actorUserId?: string
  actor?: string
  source?: string
  action?: string
  result?: string
  payload?: unknown
  createdAt: string
}
export type ForgeCloudNotification = { id: string; type: string; title: string; body: string; objectType?: string; objectId?: string; readAt?: string; createdAt: string }
export type ForgeCloudComment = { id: string; objectType: string; objectId: string; body: string; authorUserId: string; author?: string; createdAt: string; updatedAt: string }

export type ForgeCloudHealth = { id: string; label: string; state: string; tone: string; detail?: string }
export type ForgeCloudLayer = { id: string; label: string; state: string; tone: string; detail?: string }
export type ForgeCloudDevice = { id: string; deviceKey: string; name: string; type: string; endpoint?: string; status: string; lastSeenAt?: string; metadata?: unknown; createdBy?: string; createdAt: string; updatedAt: string }
export type ForgeCloudTwin = { id: string; twinKey: string; name: string; type: string; sourceDeviceId?: string; sourceDevice?: string; status: string; state: unknown; quality: string; lastStateAt?: string; updatedAt: string }
export type ForgeCloudDataPoint = { id: string; pointKey: string; label: string; dataType: string; unit?: string; status: string; deviceId?: string; device?: string; twinId?: string; twin?: string; lastValue?: unknown; lastQuality?: string; lastOccurredAt?: string; createdAt: string }
export type ForgeCloudDataEvent = { id: number; deviceId?: string; device?: string; twinId?: string; twin?: string; pointId?: string; pointKey?: string; type: string; quality: string; value: unknown; occurredAt: string; receivedAt: string }
export type ForgeCloudAiModel = { id: string; workspaceId?: string; name: string; provider: string; modelKey: string; type: string; status: string; config?: unknown; createdAt: string; updatedAt: string }
export type ForgeCloudAiTask = { id: string; projectId?: string; project?: string; modelId?: string; model?: string; provider?: string; type: string; status: string; input: unknown; output?: unknown; error?: string; createdAt: string; startedAt?: string; completedAt?: string; updatedAt: string }
export type ForgeCloudArchiveOutput = { itemId: string; name: string; quantity: number; recipeCount: number }
export type ForgeCloudArchive = {
  projectId: string
  projectName: string
  version: number
  schemaVersion: number
  branch: string
  objects: number
  machines: number
  conveyors: number
  vehicles: number
  items: number
  recipes: number
  floors: number
  floorNames: string[]
  outputs: ForgeCloudArchiveOutput[]
  updatedAt?: string
}

export type ForgeCloudMember = { userId: string; username: string; role: string; status: string; projectCount: number; joinedAt: string }
export type ForgeCloudProjectMember = { userId: string; username: string; role: 'manager' | 'editor' | 'viewer'; status: string; joinedAt: string }
export type ForgeCloudRelease = { id: string; projectId: string; projectName: string; versionId: string; version: number; branch: string; name: string; notes?: string; status: string; createdBy: string; creator?: string; createdAt: string }
export type ForgeCloudPublication = { id: string; sourceType: string; sourceId: string; sourceVersionId?: string; forgeLabPostId: string; postTitle?: string; releaseName?: string; assetName?: string; licenseSnapshot?: unknown; status: string; createdBy: string; createdAt: string }
export type ForgeCloudTask = { id: string; projectId?: string; projectName?: string; type: string; title: string; detail?: string; status: string; priority: string; assigneeUserId?: string; assignee?: string; source: string; createdBy: string; creator?: string; createdAt: string; updatedAt: string }
export type ForgeCloudApproval = { id: string; workspaceId: string; projectId?: string; projectName?: string; type: string; objectType: string; objectId: string; title: string; detail?: string; evidence?: unknown; rollbackAvailable: boolean; status: 'pending' | 'replan' | 'approved' | 'rejected'; requestedBy: string; requester?: string; decidedBy?: string; decider?: string; decisionNote?: string; createdAt: string; updatedAt: string; decidedAt?: string }
export type ForgeCloudConnector = { id: string; name: string; type: string; endpoint?: string; status: string; readOnly: boolean; lastHeartbeatAt?: string; creator?: string; eventCount: number; createdAt: string; updatedAt: string }
export type ForgeCloudTagMapping = { id: string; connectorId: string; connector?: string; dataPointId?: string; pointKey?: string; pointLabel?: string; twinId?: string; twin?: string; sourceTag: string; semanticKey: string; unit?: string; transform: unknown; status: string; createdBy: string; createdAt: string; updatedAt: string }
export type ForgeCloudAssetTwin = { id: string; projectId?: string; project?: string; twinId: string; twin: string; factoryObjectId?: string; externalAssetId?: string; status: string; note?: string; createdBy: string; createdAt: string; updatedAt: string }
export type ForgeCloudConnectorSyncRun = { id: string; connectorId: string; connector?: string; mode: string; status: string; cursorBefore: number; cursorAfter: number; eventsRead: number; valuesWritten: number; skippedValues: number; error?: string; clientMutationId?: string; requestedBy: string; requestedAt: string; startedAt?: string; completedAt?: string }
export type ForgeCloudRuntimeEvent = { id: number; connectorId: string; connector?: string; source?: string; externalEventId?: string; deviceId?: string; twinId?: string; pointId?: string; unit?: string; isolationStatus: string; isolationReason?: string; type: string; quality: string; payload: unknown; occurredAt: string; receivedAt: string }
export type ForgeCloudTelemetryWindow = { id: string; twinId?: string; twin?: string; dataPointId?: string; pointKey?: string; pointLabel?: string; metric: string; windowStart: string; windowEnd: string; unit?: string; min?: number; max?: number; avg?: number; sampleCount: number; validCount: number; invalidCount: number; aggregationVersion: number; source?: string; createdAt: string; updatedAt: string }
export type ForgeCloudWorkOrder = { id: string; projectId?: string; project?: string; twinId?: string; twin?: string; externalId?: string; type: string; title: string; detail?: string; status: string; priority: string; plannedAt?: string; dueAt?: string; actualAt?: string; assignedTo?: string; assignee?: string; createdBy: string; creator?: string; createdAt: string; updatedAt: string }
export type ForgeCloudQualityResult = { id: string; projectId?: string; project?: string; twinId?: string; twin?: string; workOrderId?: string; lotId?: string; inspectionType: string; result: string; score?: number; evidenceRef?: string; detail?: string; occurredAt: string; createdBy: string; creator?: string; createdAt: string }
export type ForgeCloudMaintenanceRecord = { id: string; projectId?: string; project?: string; twinId?: string; twin?: string; workOrderId?: string; faultCode?: string; action: string; result: string; startedAt?: string; completedAt?: string; downtimeSeconds: number; detail?: string; createdBy: string; creator?: string; createdAt: string }
export type ForgeCloudDatabaseTable = { name: string; type: string; engine: string; columns: number; rows: number; dataMiB: number; indexMiB: number; sizeMiB: number; collation?: string; updatedAt?: string }
export type ForgeCloudDatabaseStatus = {
  status: 'online' | 'degraded' | 'offline'
  engine: string
  serverVersion: string
  schema: string
  migration: { version: string; description: string; installedAt?: string }
  tableCount: number
  cloudTableCount: number
  sizeMiB: number
  activeConnections: number
  maxConnections: number
  latencyMs: number
  workspaceId: string
  checkedAt: string
  eventQueue?: { pending: number; processing: number; failed: number; processed: number; activity: number }
  tables?: ForgeCloudDatabaseTable[]
  warnings?: string[]
}

export type ForgeCloudOverview = {
  workspace: ForgeCloudWorkspace
  projects: number
  assets: number
  members: number
  pendingNotifications: number
  events: ForgeCloudAudit[]
  health: ForgeCloudHealth[]
  layers?: ForgeCloudLayer[]
  archive?: ForgeCloudArchive
}

function headers(json = false): Record<string, string> {
  const token = localStorage.getItem('forgemind.token')
  return {
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

function clientMutationId(prefix: string) {
  const uuid = typeof globalThis.crypto?.randomUUID === 'function' ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return `${prefix}-${uuid}`
}

async function readError(response: Response): Promise<string> {
  try {
    const body = await response.json() as { error?: string }
    return body.error ?? `后端返回 ${response.status}`
  } catch {
    return `后端返回 ${response.status}`
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${BACKEND_BASE}${path}`, {
    ...init,
    headers: { ...headers(typeof init.body === 'string'), ...(init.headers ?? {}) },
  })
  if (!response.ok) throw new Error(await readError(response))
  return await response.json() as T
}

export function listForgeCloudWorkspaces() {
  return request<ForgeCloudWorkspace[]>('/api/v1/workspaces')
}

export function loadForgeCloudOverview(workspaceId: string) {
  return request<ForgeCloudOverview>(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/overview`)
}

export function loadForgeCloudDatabaseStatus(workspaceId: string) {
  return request<ForgeCloudDatabaseStatus>(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/database-status`)
}

export function createForgeCloudWorkspace(name: string) {
  return request<ForgeCloudWorkspace>('/api/v1/workspaces', { method: 'POST', body: JSON.stringify({ name }) })
}

export function listForgeCloudProjects(workspaceId: string) {
  return request<ForgeCloudProject[]>(`/api/v1/projects?workspace_id=${encodeURIComponent(workspaceId)}`)
}

export type ForgeCloudProjectVersion = { id: string; parentVersionId?: string; version: number; branch: string; schemaVersion: number; contentHash?: string; note?: string; createdBy: string; createdAt: string }

export function createForgeCloudProject(workspaceId: string, name: string) {
  const save = { version: 6, name, floorCount: 1, floorNames: ['1F 生产层'], objects: [], items: [], recipes: [], machineDefinitions: [] }
  return request<ForgeCloudProject>('/api/v1/projects', { method: 'POST', body: JSON.stringify({ workspaceId, name, save }) })
}

export function listForgeCloudProjectVersions(projectId: string) {
  return request<ForgeCloudProjectVersion[]>(`/api/v1/projects/${encodeURIComponent(projectId)}/versions`)
}

export function listForgeCloudProjectMembers(projectId: string) {
  return request<ForgeCloudProjectMember[]>(`/api/v1/projects/${encodeURIComponent(projectId)}/members`)
}

export function addForgeCloudProjectMember(projectId: string, userId: string, role: ForgeCloudProjectMember['role']) {
  return request<ForgeCloudProjectMember>(`/api/v1/projects/${encodeURIComponent(projectId)}/members`, { method: 'POST', body: JSON.stringify({ userId, role }) })
}

export function updateForgeCloudProjectMember(projectId: string, userId: string, role: ForgeCloudProjectMember['role']) {
  return request<ForgeCloudProjectMember>(`/api/v1/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(userId)}`, { method: 'PATCH', body: JSON.stringify({ userId, role }) })
}

export function removeForgeCloudProjectMember(projectId: string, userId: string) {
  return request<void>(`/api/v1/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(userId)}`, { method: 'DELETE' })
}

export function createForgeCloudProjectVersion(projectId: string, baseVersionId: string, save: unknown, note?: string, mutationId = clientMutationId('project-version')) {
  return request<ForgeCloudProjectVersion>(`/api/v1/projects/${encodeURIComponent(projectId)}/versions`, { method: 'POST', body: JSON.stringify({ baseVersionId, branchName: 'main', note, save, clientMutationId: mutationId }) })
}

export function createForgeCloudRelease(projectId: string, versionId: string, name: string, notes?: string) {
  return request<ForgeCloudRelease>(`/api/v1/projects/${encodeURIComponent(projectId)}/releases`, { method: 'POST', body: JSON.stringify({ versionId, name, notes }) })
}

export function listForgeCloudAssets(workspaceId: string) {
  return request<ForgeCloudAsset[]>(`/api/v1/assets?workspace_id=${encodeURIComponent(workspaceId)}`)
}

export function listForgeCloudPublications(workspaceId: string) {
  return request<ForgeCloudPublication[]>(`/api/v1/publications?workspace_id=${encodeURIComponent(workspaceId)}`)
}

export function createForgeCloudPublication(input: { workspaceId: string; sourceType: string; sourceId: string; forgeLabPostId: string; licenseSnapshot: unknown }) {
  return request<ForgeCloudPublication>('/api/v1/publications', { method: 'POST', body: JSON.stringify(input) })
}

export function createForgeCloudAsset(input: { workspaceId: string; externalId: string; kind: string; name: string; visibility: string; manifest?: unknown }) {
  return request<ForgeCloudAsset>('/api/v1/assets', { method: 'POST', body: JSON.stringify({ ...input, manifest: input.manifest ?? { manifestVersion: 1, source: 'ForgeCloud metadata registry', license: {}, dependencies: [] } }) })
}

export function listForgeCloudAssetVersions(assetId: string) {
  return request<ForgeCloudAssetVersion[]>(`/api/v1/assets/${encodeURIComponent(assetId)}/versions`)
}

export function createForgeCloudAssetVersion(input: { assetId: string; manifest: unknown; note?: string; mutationId?: string }) {
  return request<ForgeCloudAssetVersion>(`/api/v1/assets/${encodeURIComponent(input.assetId)}/versions`, { method: 'POST', body: JSON.stringify({ manifest: input.manifest, note: input.note, clientMutationId: input.mutationId ?? clientMutationId('asset-version') }) })
}

export type ForgeCloudAssetBlob = {
  id: string
  assetId: string
  assetVersionId: string
  fileName: string
  mediaType: string
  sizeBytes: number
  contentHash: string
  storageProvider: string
  status: string
  version: number
  createdAt: string
}

export function uploadForgeCloudAssetBlob(assetId: string, file: File) {
  const form = new FormData()
  form.append('file', file)
  return request<ForgeCloudAssetBlob>(`/api/v1/assets/${encodeURIComponent(assetId)}/blobs`, { method: 'POST', body: form })
}

export function listForgeCloudAssetBlobs(assetId: string) {
  return request<ForgeCloudAssetBlob[]>(`/api/v1/assets/${encodeURIComponent(assetId)}/blobs`)
}

export function deleteForgeCloudAssetBlob(blobId: string) {
  return request<void>(`/api/v1/assets/blobs/${encodeURIComponent(blobId)}`, { method: 'DELETE' })
}

export function listForgeCloudAudit(workspaceId: string) {
  return request<ForgeCloudAudit[]>(`/api/v1/audit?workspace_id=${encodeURIComponent(workspaceId)}`)
}

export function listForgeCloudActivity(workspaceId: string, eventType?: string, beforeId?: number, limit = 50) {
  const params = new URLSearchParams({ workspace_id: workspaceId, limit: String(limit) })
  if (eventType) params.set('event_type', eventType)
  if (beforeId !== undefined) params.set('before_id', String(beforeId))
  return request<ForgeCloudActivity[]>(`/api/v1/activity?${params.toString()}`)
}

export function markForgeCloudNotificationsRead() {
  return request<{ marked: number }>('/api/v1/notifications/read-all', { method: 'POST' })
}

export function listForgeCloudNotifications() {
  return request<ForgeCloudNotification[]>('/api/v1/notifications')
}

export function listForgeCloudMembers(workspaceId: string) {
  return request<ForgeCloudMember[]>(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/members`)
}

export function addForgeCloudMember(workspaceId: string, username: string, role: string) {
  return request<ForgeCloudMember>(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/members`, { method: 'POST', body: JSON.stringify({ username, role }) })
}

export function updateForgeCloudMemberRole(workspaceId: string, userId: string, role: string) {
  return request<ForgeCloudMember>(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(userId)}`, { method: 'PATCH', body: JSON.stringify({ role }) })
}

export function listForgeCloudComments(workspaceId: string, objectType: string, objectId: string) {
  return request<ForgeCloudComment[]>(`/api/v1/comments?workspace_id=${encodeURIComponent(workspaceId)}&objectType=${encodeURIComponent(objectType)}&objectId=${encodeURIComponent(objectId)}`)
}

export function createForgeCloudComment(input: { workspaceId: string; objectType: string; objectId: string; body: string }) {
  return request<ForgeCloudComment>('/api/v1/comments', { method: 'POST', body: JSON.stringify(input) })
}

export function createForgeCloudTask(input: { workspaceId: string; projectId?: string; type: string; title: string; detail?: string; priority: string; clientMutationId?: string }) {
  return request<ForgeCloudTask>('/api/v1/tasks', { method: 'POST', body: JSON.stringify({ ...input, clientMutationId: input.clientMutationId ?? clientMutationId('task') }) })
}

export function updateForgeCloudTaskStatus(taskId: string, status: string) {
  return request<ForgeCloudTask>(`/api/v1/tasks/${encodeURIComponent(taskId)}`, { method: 'PATCH', body: JSON.stringify({ status }) })
}

export function listForgeCloudApprovals(workspaceId: string) {
  return request<ForgeCloudApproval[]>(`/api/v1/approvals?workspace_id=${encodeURIComponent(workspaceId)}`)
}

export function createForgeCloudApproval(input: { workspaceId: string; projectId?: string; approvalType: string; objectType: string; objectId: string; title: string; detail?: string; evidence?: unknown; rollbackAvailable: boolean; clientMutationId?: string }) {
  return request<ForgeCloudApproval>('/api/v1/approvals', { method: 'POST', body: JSON.stringify({ ...input, clientMutationId: input.clientMutationId ?? clientMutationId('approval') }) })
}

export function decideForgeCloudApproval(approvalId: string, status: 'approved' | 'rejected' | 'replan', note?: string) {
  return request<ForgeCloudApproval>(`/api/v1/approvals/${encodeURIComponent(approvalId)}/decision`, { method: 'POST', body: JSON.stringify({ status, note }) })
}

export function createForgeCloudConnector(input: { workspaceId: string; name: string; type: string; endpoint?: string }) {
  return request<ForgeCloudConnector>('/api/v1/connectors', { method: 'POST', body: JSON.stringify(input) })
}

export function listForgeCloudTagMappings(workspaceId: string) {
  return request<ForgeCloudTagMapping[]>(`/api/v1/data/mappings?workspace_id=${encodeURIComponent(workspaceId)}`)
}

export function createForgeCloudTagMapping(input: { workspaceId: string; connectorId: string; dataPointId?: string; twinId?: string; sourceTag: string; semanticKey: string; unit?: string; transform?: unknown }) {
  return request<ForgeCloudTagMapping>('/api/v1/data/mappings', { method: 'POST', body: JSON.stringify({ ...input, transform: input.transform ?? {} }) })
}

export function updateForgeCloudTagMapping(mappingId: string, input: { dataPointId?: string; twinId?: string; sourceTag?: string; semanticKey?: string; unit?: string; transform?: unknown; status?: 'active' | 'disabled' }) {
  return request<ForgeCloudTagMapping>(`/api/v1/data/mappings/${encodeURIComponent(mappingId)}`, { method: 'PATCH', body: JSON.stringify(input) })
}

export function listForgeCloudAssetTwins(workspaceId: string) {
  return request<ForgeCloudAssetTwin[]>(`/api/v1/twins/mappings?workspace_id=${encodeURIComponent(workspaceId)}`)
}

export function createForgeCloudAssetTwin(input: { workspaceId: string; projectId?: string; twinId: string; factoryObjectId?: string; externalAssetId?: string; note?: string }) {
  return request<ForgeCloudAssetTwin>('/api/v1/twins/mappings', { method: 'POST', body: JSON.stringify(input) })
}

export function listForgeCloudConnectorSyncRuns(workspaceId: string, connectorId: string) {
  return request<ForgeCloudConnectorSyncRun[]>(`/api/v1/connectors/${encodeURIComponent(connectorId)}/sync-runs?workspace_id=${encodeURIComponent(workspaceId)}`)
}

export function runForgeCloudConnectorSync(connectorId: string, input: { mode?: string; sinceEventId?: number; clientMutationId?: string } = {}) {
  return request<ForgeCloudConnectorSyncRun>(`/api/v1/connectors/${encodeURIComponent(connectorId)}/sync-runs`, { method: 'POST', body: JSON.stringify({ mode: input.mode ?? 'replay', sinceEventId: input.sinceEventId, clientMutationId: input.clientMutationId ?? clientMutationId('connector-sync') }) })
}

export function listForgeCloudRuntimeEvents(workspaceId: string) {
  return request<ForgeCloudRuntimeEvent[]>(`/api/v1/runtime/events?workspace_id=${encodeURIComponent(workspaceId)}`)
}

export function listForgeCloudTelemetryWindows(workspaceId: string, dataPointId?: string, twinId?: string) {
  const params = new URLSearchParams({ workspace_id: workspaceId })
  if (dataPointId) params.set('point_id', dataPointId)
  if (twinId) params.set('twin_id', twinId)
  return request<ForgeCloudTelemetryWindow[]>(`/api/v1/data/windows?${params.toString()}`)
}

export function aggregateForgeCloudTelemetryWindow(input: { workspaceId: string; dataPointId?: string; twinId?: string; metric?: string; windowStart: string; windowEnd: string }) {
  return request<ForgeCloudTelemetryWindow>('/api/v1/data/windows/aggregate', { method: 'POST', body: JSON.stringify(input) })
}

export function listForgeCloudWorkOrders(workspaceId: string) {
  return request<ForgeCloudWorkOrder[]>(`/api/v1/work-orders?workspace_id=${encodeURIComponent(workspaceId)}`)
}

export function createForgeCloudWorkOrder(input: { workspaceId: string; projectId?: string; twinId?: string; externalId?: string; type: string; title: string; detail?: string; status?: string; priority?: string; plannedAt?: string; dueAt?: string; assignedTo?: string; clientMutationId?: string }) {
  return request<ForgeCloudWorkOrder>('/api/v1/work-orders', { method: 'POST', body: JSON.stringify({ ...input, clientMutationId: input.clientMutationId ?? clientMutationId('work-order') }) })
}

export function updateForgeCloudWorkOrderStatus(workOrderId: string, status: string) {
  return request<ForgeCloudWorkOrder>(`/api/v1/work-orders/${encodeURIComponent(workOrderId)}`, { method: 'PATCH', body: JSON.stringify({ status }) })
}

export function listForgeCloudQualityResults(workspaceId: string) {
  return request<ForgeCloudQualityResult[]>(`/api/v1/quality/results?workspace_id=${encodeURIComponent(workspaceId)}`)
}

export function createForgeCloudQualityResult(input: { workspaceId: string; projectId?: string; twinId?: string; workOrderId?: string; lotId?: string; inspectionType: string; result?: string; score?: number; evidenceRef?: string; detail?: string; occurredAt?: string; clientMutationId?: string }) {
  return request<ForgeCloudQualityResult>('/api/v1/quality/results', { method: 'POST', body: JSON.stringify({ ...input, clientMutationId: input.clientMutationId ?? clientMutationId('quality-result') }) })
}

export function listForgeCloudMaintenanceRecords(workspaceId: string) {
  return request<ForgeCloudMaintenanceRecord[]>(`/api/v1/maintenance/records?workspace_id=${encodeURIComponent(workspaceId)}`)
}

export function createForgeCloudMaintenanceRecord(input: { workspaceId: string; projectId?: string; twinId?: string; workOrderId?: string; faultCode?: string; action: string; result?: string; startedAt?: string; completedAt?: string; downtimeSeconds?: number; detail?: string; clientMutationId?: string }) {
  return request<ForgeCloudMaintenanceRecord>('/api/v1/maintenance/records', { method: 'POST', body: JSON.stringify({ ...input, clientMutationId: input.clientMutationId ?? clientMutationId('maintenance') }) })
}

export function registerForgeCloudDevice(input: { workspaceId: string; deviceKey: string; name: string; type: string; endpoint?: string }) {
  return request<ForgeCloudDevice>('/api/v1/devices', { method: 'POST', body: JSON.stringify(input) })
}

export function heartbeatForgeCloudDevice(deviceId: string, status = 'online') {
  return request<ForgeCloudDevice>(`/api/v1/devices/${encodeURIComponent(deviceId)}/heartbeat`, { method: 'POST', body: JSON.stringify({ status }) })
}

export function createForgeCloudTwin(input: { workspaceId: string; twinKey: string; name: string; type: string; sourceDeviceId?: string }) {
  return request<ForgeCloudTwin>('/api/v1/twins', { method: 'POST', body: JSON.stringify(input) })
}

export function createForgeCloudDataPoint(input: { workspaceId: string; pointKey: string; label: string; dataType: string; unit?: string }) {
  return request<ForgeCloudDataPoint>('/api/v1/data/points', { method: 'POST', body: JSON.stringify(input) })
}

export function ingestForgeCloudDataEvent(input: { workspaceId: string; pointId: string; value: unknown; quality?: string; eventType?: string }) {
  return request<ForgeCloudDataEvent>('/api/v1/data/events', { method: 'POST', body: JSON.stringify({ ...input, quality: input.quality ?? 'good', eventType: input.eventType ?? 'manual_telemetry' }) })
}

export function queueForgeCloudAiTask(input: { workspaceId: string; projectId?: string; modelId?: string; type: string }) {
  return request<ForgeCloudAiTask>('/api/v1/ai/tasks', { method: 'POST', body: JSON.stringify({ ...input, input: {} }) })
}

export function runForgeCloudAiTask(taskId: string) {
  return request<ForgeCloudAiTask>(`/api/v1/ai/tasks/${encodeURIComponent(taskId)}/run`, { method: 'POST' })
}

export function listForgeCloudReleases(workspaceId: string) {
  return request<ForgeCloudRelease[]>(`/api/v1/releases?workspace_id=${encodeURIComponent(workspaceId)}`)
}

export function listForgeCloudTasks(workspaceId: string) {
  return request<ForgeCloudTask[]>(`/api/v1/tasks?workspace_id=${encodeURIComponent(workspaceId)}`)
}

export function listForgeCloudConnectors(workspaceId: string) {
  return request<ForgeCloudConnector[]>(`/api/v1/connectors?workspace_id=${encodeURIComponent(workspaceId)}`)
}

export function listForgeCloudDevices(workspaceId: string) {
  return request<ForgeCloudDevice[]>(`/api/v1/devices?workspace_id=${encodeURIComponent(workspaceId)}`)
}

export function listForgeCloudTwins(workspaceId: string) {
  return request<ForgeCloudTwin[]>(`/api/v1/twins?workspace_id=${encodeURIComponent(workspaceId)}`)
}

export function listForgeCloudDataPoints(workspaceId: string) {
  return request<ForgeCloudDataPoint[]>(`/api/v1/data/points?workspace_id=${encodeURIComponent(workspaceId)}`)
}

export function listForgeCloudDataEvents(workspaceId: string) {
  return request<ForgeCloudDataEvent[]>(`/api/v1/data/events?workspace_id=${encodeURIComponent(workspaceId)}`)
}

export function listForgeCloudAiModels(workspaceId: string) {
  return request<ForgeCloudAiModel[]>(`/api/v1/ai/models?workspace_id=${encodeURIComponent(workspaceId)}`)
}

export function listForgeCloudAiTasks(workspaceId: string) {
  return request<ForgeCloudAiTask[]>(`/api/v1/ai/tasks?workspace_id=${encodeURIComponent(workspaceId)}`)
}

export async function loadForgeCloudSnapshot(requestedWorkspaceId?: string) {
  const workspaces = await listForgeCloudWorkspaces()
  const workspace = workspaces.find((entry) => entry.id === requestedWorkspaceId) ?? workspaces[0]
  if (!workspace) throw new Error('当前账号没有可访问的工作空间')
  const [overview, database, projects, assets, publications, audit, activity, notifications, members, releases, tasks, approvals, connectors, devices, twins, dataPoints, dataEvents, aiModels, aiTasks, mappings, assetTwins, runtimeEvents, telemetryWindows, workOrders, qualityResults, maintenanceRecords] = await Promise.all([
    loadForgeCloudOverview(workspace.id),
    loadForgeCloudDatabaseStatus(workspace.id),
    listForgeCloudProjects(workspace.id),
    listForgeCloudAssets(workspace.id),
    listForgeCloudPublications(workspace.id),
    listForgeCloudAudit(workspace.id),
    listForgeCloudActivity(workspace.id),
    listForgeCloudNotifications(),
    listForgeCloudMembers(workspace.id),
    listForgeCloudReleases(workspace.id),
    listForgeCloudTasks(workspace.id),
    listForgeCloudApprovals(workspace.id),
    listForgeCloudConnectors(workspace.id),
    listForgeCloudDevices(workspace.id),
    listForgeCloudTwins(workspace.id),
    listForgeCloudDataPoints(workspace.id),
    listForgeCloudDataEvents(workspace.id),
    listForgeCloudAiModels(workspace.id),
    listForgeCloudAiTasks(workspace.id),
    listForgeCloudTagMappings(workspace.id),
    listForgeCloudAssetTwins(workspace.id),
    listForgeCloudRuntimeEvents(workspace.id),
    listForgeCloudTelemetryWindows(workspace.id),
    listForgeCloudWorkOrders(workspace.id),
    listForgeCloudQualityResults(workspace.id),
    listForgeCloudMaintenanceRecords(workspace.id),
  ])
  const syncRuns = (await Promise.all(connectors.map((connector) => listForgeCloudConnectorSyncRuns(workspace.id, connector.id)))).flat()
  return { workspaces, workspace, overview, database, projects, assets, publications, audit, activity, notifications, members, releases, tasks, approvals, connectors, devices, twins, dataPoints, dataEvents, aiModels, aiTasks, mappings, assetTwins, syncRuns, runtimeEvents, telemetryWindows, workOrders, qualityResults, maintenanceRecords }
}
