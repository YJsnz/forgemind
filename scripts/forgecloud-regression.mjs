import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'

const base = process.env.FORGECLOUD_BASE_URL || 'http://127.0.0.1:8080'
const suffix = `${Date.now()}`.slice(-8)
const owner = `fc_reg_owner_${suffix}`
const member = `fc_reg_member_${suffix}`
const password = 'ForgeCloud!2026'
const createdUsers = [owner, member]
let uploadedObjectPath = null

async function request(path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: { ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...(options.headers || {}) },
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`${options.method || 'GET'} ${path} -> ${response.status}: ${body.error || body.message || 'request failed'}`)
  return body
}

function auth(token) { return { Authorization: `Bearer ${token}` } }
function json(value) { return JSON.stringify(value) }
function assert(condition, message) { if (!condition) throw new Error(message) }
async function waitFor(fetchRows, predicate, timeoutMs = 16000) {
  const deadline = Date.now() + timeoutMs
  let latest = []
  while (Date.now() < deadline) {
    latest = await fetchRows()
    if (predicate(latest)) return latest
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  return latest
}

function cleanup() {
  const quotedOwner = owner.replaceAll("'", "''")
  const quotedMember = member.replaceAll("'", "''")
  const sql = `
SET FOREIGN_KEY_CHECKS=0;
DELETE FROM cloud_runtime_event WHERE connector_id IN (SELECT id FROM cloud_connector WHERE created_by IN (SELECT id FROM app_user WHERE username IN ('${quotedOwner}','${quotedMember}')));
DELETE FROM cloud_telemetry_window WHERE workspace_id IN (SELECT id FROM cloud_workspace WHERE owner_user_id IN (SELECT id FROM app_user WHERE username IN ('${quotedOwner}','${quotedMember}')));
DELETE FROM cloud_quality_result WHERE workspace_id IN (SELECT id FROM cloud_workspace WHERE owner_user_id IN (SELECT id FROM app_user WHERE username IN ('${quotedOwner}','${quotedMember}')));
DELETE FROM cloud_maintenance_record WHERE workspace_id IN (SELECT id FROM cloud_workspace WHERE owner_user_id IN (SELECT id FROM app_user WHERE username IN ('${quotedOwner}','${quotedMember}')));
DELETE FROM cloud_work_order WHERE workspace_id IN (SELECT id FROM cloud_workspace WHERE owner_user_id IN (SELECT id FROM app_user WHERE username IN ('${quotedOwner}','${quotedMember}')));
DELETE FROM cloud_connector WHERE created_by IN (SELECT id FROM app_user WHERE username IN ('${quotedOwner}','${quotedMember}'));
DELETE FROM cloud_comment WHERE author_user_id IN (SELECT id FROM app_user WHERE username IN ('${quotedOwner}','${quotedMember}'));
DELETE FROM cloud_task WHERE created_by IN (SELECT id FROM app_user WHERE username IN ('${quotedOwner}','${quotedMember}')) OR assignee_user_id IN (SELECT id FROM app_user WHERE username IN ('${quotedOwner}','${quotedMember}'));
DELETE FROM cloud_project_release WHERE created_by IN (SELECT id FROM app_user WHERE username IN ('${quotedOwner}','${quotedMember}'));
DELETE FROM cloud_audit_log WHERE actor_user_id IN (SELECT id FROM app_user WHERE username IN ('${quotedOwner}','${quotedMember}'));
DELETE FROM cloud_notification WHERE recipient_user_id IN (SELECT id FROM app_user WHERE username IN ('${quotedOwner}','${quotedMember}'));
DELETE FROM cloud_project WHERE owner_user_id IN (SELECT id FROM app_user WHERE username IN ('${quotedOwner}','${quotedMember}'));
DELETE FROM cloud_workspace WHERE owner_user_id IN (SELECT id FROM app_user WHERE username IN ('${quotedOwner}','${quotedMember}'));
DELETE FROM forgelab_post WHERE author_user_id IN (SELECT id FROM app_user WHERE username IN ('${quotedOwner}','${quotedMember}'));
DELETE FROM factory WHERE owner_user_id IN (SELECT id FROM app_user WHERE username IN ('${quotedOwner}','${quotedMember}'));
DELETE FROM auth_session WHERE user_id IN (SELECT id FROM app_user WHERE username IN ('${quotedOwner}','${quotedMember}'));
    DELETE FROM app_user WHERE username IN ('${quotedOwner}','${quotedMember}');
SET FOREIGN_KEY_CHECKS=1;
`
  const result = spawnSync('docker', ['exec', '-i', 'forgemind-mysql', 'mysql', '-uforgemind', '-pforgemind', '-Dforgemind'], { input: sql, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`测试数据清理失败：${result.stderr || result.stdout}`)
}

let result
try {
  const ownerAuth = await request('/api/auth/register', { method: 'POST', body: json({ username: owner, password }) })
  const memberAuth = await request('/api/auth/register', { method: 'POST', body: json({ username: member, password }) })
  const ownerHeaders = auth(ownerAuth.token)
  const memberHeaders = auth(memberAuth.token)
  const ownerMe = await request('/api/auth/me', { headers: ownerHeaders })
  const memberMe = await request('/api/auth/me', { headers: memberHeaders })
  const workspace = (await request('/api/v1/workspaces', { headers: ownerHeaders }))[0]
  const memberWorkspace = (await request('/api/v1/workspaces', { headers: memberHeaders }))[0]
  assert(workspace?.id && memberWorkspace?.id, '个人工作空间未自动创建')
  const createdWorkspace = await request('/api/v1/workspaces', { method: 'POST', headers: ownerHeaders, body: json({ name: 'ForgeCloud F1 Regression' }) })
  assert(createdWorkspace.role === 'owner' && createdWorkspace.name === 'ForgeCloud F1 Regression', '工作空间创建未返回所有者上下文')
  const database = await request(`/api/v1/workspaces/${workspace.id}/database-status`, { headers: ownerHeaders })
  assert((database.status === 'online' || database.status === 'degraded') && database.engine === 'MySQL' && database.schema, '数据库状态接口未返回可观测信息')
  const ownerWorkspaces = await request('/api/v1/workspaces', { headers: ownerHeaders })
  assert(ownerWorkspaces.some((row) => row.id === createdWorkspace.id), '新建工作空间未出现在工作空间列表')
  const cloudProjectSave = { version: 6, name: 'ForgeCloud Team Project', floorCount: 1, floorNames: ['L1'], objects: [], items: [], recipes: [], machineDefinitions: [] }
  const cloudProject = await request('/api/v1/projects', { method: 'POST', headers: ownerHeaders, body: json({ workspaceId: createdWorkspace.id, name: cloudProjectSave.name, save: cloudProjectSave }) })
  assert(cloudProject.id && cloudProject.currentVersionId, 'ForgeCloud 项目创建未返回当前版本')
  const teamProjects = await request(`/api/v1/projects?workspace_id=${createdWorkspace.id}`, { headers: ownerHeaders })
  assert(teamProjects.some((row) => row.id === cloudProject.id), '项目没有归属到当前创建的工作空间')
  const cloudAsset = await request('/api/v1/assets', { method: 'POST', headers: ownerHeaders, body: json({ workspaceId: createdWorkspace.id, externalId: 'asset-regression-cnc', kind: 'model3d', name: 'Regression CNC', visibility: 'workspace', manifest: { source: 'regression' } }) })
  assert(cloudAsset.currentVersionId && cloudAsset.status === 'draft', '资源元数据创建未生成初始版本')
  let publicManifestDenied = false
  try { await request('/api/v1/assets', { method: 'POST', headers: ownerHeaders, body: json({ workspaceId: createdWorkspace.id, externalId: 'asset-regression-public-invalid', kind: 'model3d', name: 'Invalid Public Asset', visibility: 'public', manifest: { manifestVersion: 1, dependencies: [] } }) }) } catch (error) { publicManifestDenied = String(error.message).includes('许可证') }
  assert(publicManifestDenied, '公开资源缺少许可证时未被服务端拒绝')
  const publicAsset = await request('/api/v1/assets', { method: 'POST', headers: ownerHeaders, body: json({ workspaceId: createdWorkspace.id, externalId: 'asset-regression-public', kind: 'model3d', name: 'Public Licensed Asset', visibility: 'public', manifest: { manifestVersion: 1, license: { spdx: 'MIT' }, dependencies: [{ id: 'forge-runtime', version: '1' }] } }) })
  assert(publicAsset.manifestVersion === 1 && publicAsset.manifest?.license?.spdx === 'MIT' && publicAsset.manifest?.dependencies?.length === 1, '资源 manifest v1 未被规范化保存')
  const assetVersionRequest = { manifest: { manifestVersion: 1, source: 'regression-v2', license: { spdx: 'MIT' }, dependencies: [{ id: 'forge-runtime', version: '2' }] }, note: 'immutable asset version regression', clientMutationId: `regression-asset-version-${suffix}` }
  const assetVersion = await request(`/api/v1/assets/${cloudAsset.id}/versions`, { method: 'POST', headers: ownerHeaders, body: json(assetVersionRequest) })
  const replayedAssetVersion = await request(`/api/v1/assets/${cloudAsset.id}/versions`, { method: 'POST', headers: ownerHeaders, body: json(assetVersionRequest) })
  const assetVersions = await request(`/api/v1/assets/${cloudAsset.id}/versions`, { headers: ownerHeaders })
  assert(assetVersion.version === 2 && assetVersion.current === true && replayedAssetVersion.id === assetVersion.id && assetVersions.length === 2, '资源版本生命周期或幂等重试未通过')
  assert(assetVersions.some((version) => version.version === 1 && version.current === false && version.note == null), '资源历史版本不可变账本未保留')
  const labPostForm = new FormData()
  labPostForm.append('metadata', JSON.stringify({ section: 'archive', tag: 'regression', title: 'ForgeCloud Regression Publication', summary: 'Cross-product publication regression', content: 'Immutable ForgeCloud source link.' }))
  const labPost = await request('/api/forgelab/posts', { method: 'POST', headers: ownerHeaders, body: labPostForm })
  assert(labPost.id, 'ForgeLab 测试帖子创建失败')
  const form = new FormData()
  form.append('file', new Blob(['ForgeCloud blob regression'], { type: 'text/plain' }), 'regression.txt')
  const uploadedBlob = await request(`/api/v1/assets/${cloudAsset.id}/blobs`, { method: 'POST', headers: ownerHeaders, body: form })
  assert(uploadedBlob.status === 'available' && uploadedBlob.storageProvider === 'local' && uploadedBlob.sizeBytes > 0 && uploadedBlob.contentHash, '资源文件本体未进入对象存储')
  const assetBlobs = await request(`/api/v1/assets/${cloudAsset.id}/blobs`, { headers: ownerHeaders })
  assert(assetBlobs.some((blob) => blob.id === uploadedBlob.id && blob.contentHash === uploadedBlob.contentHash), '资源 Blob 元数据未返回')
  const downloadResponse = await fetch(`${base}/api/v1/assets/blobs/${uploadedBlob.id}/download`, { headers: ownerHeaders })
  assert(downloadResponse.ok && (await downloadResponse.text()) === 'ForgeCloud blob regression', '资源私有下载未通过服务端授权')
  await request(`/api/v1/assets/blobs/${uploadedBlob.id}`, { method: 'DELETE', headers: ownerHeaders })
  const deletedBlobs = await request(`/api/v1/assets/${cloudAsset.id}/blobs`, { headers: ownerHeaders })
  assert(deletedBlobs.some((blob) => blob.id === uploadedBlob.id && blob.status === 'deleted'), '资源 Blob 软删除未写回')
  uploadedObjectPath = `backend/data/objects/assets/${cloudAsset.id}/${uploadedBlob.contentHash}`

  const save = { version: 6, name: 'ForgeCloud Regression', objects: [], items: [], recipes: [], floorNames: ['L1'], machineDefinitions: [] }
  const created = await request('/api/factories', { method: 'POST', headers: ownerHeaders, body: json({ name: save.name, save }) })
  const projectId = created.project.id
  const projects = await request(`/api/v1/projects?workspace_id=${encodeURIComponent(workspace.id)}`, { headers: ownerHeaders })
  const project = projects.find((row) => row.id === projectId)
  assert(project?.currentVersionId, '工厂保存后未生成云端当前版本')
  const initialVersionId = project.currentVersionId
  const committedSave = { ...save, name: 'ForgeCloud Regression v2' }
  const versionMutationId = `regression-version-${suffix}`
  const committedVersionRequest = { baseVersionId: initialVersionId, branchName: 'main', note: 'regression commit', save: committedSave, clientMutationId: versionMutationId }
  const committedVersion = await request(`/api/v1/projects/${projectId}/versions`, { method: 'POST', headers: ownerHeaders, body: json(committedVersionRequest) })
  assert(committedVersion.id && committedVersion.version === 2, '版本提交未生成 v2')
  const replayedVersion = await request(`/api/v1/projects/${projectId}/versions`, { method: 'POST', headers: ownerHeaders, body: json(committedVersionRequest) })
  assert(replayedVersion.id === committedVersion.id, '版本重复重试未返回首次事实')
  let conflict = false
  try { await request(`/api/v1/projects/${projectId}/versions`, { method: 'POST', headers: ownerHeaders, body: json({ baseVersionId: initialVersionId, branchName: 'main', note: 'stale commit', save: committedSave }) }) } catch (error) { conflict = String(error.message).includes('409') }
  assert(conflict, '过期基线未返回 VERSION_CONFLICT')
  const versions = await request(`/api/v1/projects/${projectId}/versions`, { headers: ownerHeaders })
  assert(versions.length === 2, '云端版本数量不正确')

  await request(`/api/v1/workspaces/${workspace.id}/members`, { method: 'POST', headers: ownerHeaders, body: json({ username: member, role: 'member' }) })
  const members = await request(`/api/v1/workspaces/${workspace.id}/members`, { headers: memberHeaders })
  assert(members.some((row) => row.userId === ownerMe.id) && members.some((row) => row.userId === memberMe.id), '成员列表未反映双账号关系')
  const projectGrant = await request(`/api/v1/projects/${projectId}/members`, { method: 'POST', headers: ownerHeaders, body: json({ userId: memberMe.id, role: 'editor' }) })
  assert(projectGrant.userId === memberMe.id && projectGrant.role === 'editor', '项目级授权未生效')
  const editorVersion = await request(`/api/v1/projects/${projectId}/versions`, { method: 'POST', headers: memberHeaders, body: json({ baseVersionId: committedVersion.id, branchName: 'main', note: 'editor commit', save: { ...committedSave, name: 'ForgeCloud Regression editor v3' } }) })
  assert(editorVersion.version === 3, '项目 editor 无法提交版本')
  const changedMember = await request(`/api/v1/workspaces/${workspace.id}/members/${memberMe.id}`, { method: 'PATCH', headers: ownerHeaders, body: json({ role: 'guest' }) })
  assert(changedMember.role === 'guest', '成员角色更新未生效')
  let ownerRoleBlocked = false
  try { await request(`/api/v1/workspaces/${workspace.id}/members/${ownerMe.id}`, { method: 'PATCH', headers: ownerHeaders, body: json({ role: 'guest' }) }) } catch (error) { ownerRoleBlocked = String(error.message).includes('所有者') }
  assert(ownerRoleBlocked, '工作空间所有者角色保护未生效')
  const memberProjects = await request(`/api/v1/projects?workspace_id=${workspace.id}`, { headers: memberHeaders })
  assert(memberProjects.some((row) => row.id === projectId), '工作空间成员无法读取授权项目')

  const release = await request(`/api/v1/projects/${projectId}/releases`, { method: 'POST', headers: ownerHeaders, body: json({ versionId: editorVersion.id, name: 'Regression Release', notes: 'automated' }) })
  const publication = await request('/api/v1/publications', { method: 'POST', headers: ownerHeaders, body: json({ workspaceId: workspace.id, sourceType: 'project_release', sourceId: release.id, forgeLabPostId: labPost.id, licenseSnapshot: { declaration: 'Regression license', source: 'regression' } }) })
  const publications = await request(`/api/v1/publications?workspace_id=${workspace.id}`, { headers: ownerHeaders })
  assert(publication.status === 'active' && publications.some((row) => row.id === publication.id && row.forgeLabPostId === labPost.id), 'ForgeLab 不可变发布关联未写入')
  const taskRequest = { workspaceId: workspace.id, projectId, type: 'maintenance', title: 'Regression Task', detail: 'automated', priority: 'high', assigneeUserId: memberMe.id, clientMutationId: `regression-task-${suffix}` }
  const task = await request('/api/v1/tasks', { method: 'POST', headers: ownerHeaders, body: json(taskRequest) })
  const replayedTask = await request('/api/v1/tasks', { method: 'POST', headers: ownerHeaders, body: json(taskRequest) })
  assert(replayedTask.id === task.id, '任务重复重试未返回首次事实')
  const doneTask = await request(`/api/v1/tasks/${task.id}`, { method: 'PATCH', headers: ownerHeaders, body: json({ status: 'done' }) })
  const comment = await request('/api/v1/comments', { method: 'POST', headers: memberHeaders, body: json({ workspaceId: workspace.id, objectType: 'project', objectId: projectId, body: 'Regression comment' }) })
  const comments = await request(`/api/v1/comments?workspace_id=${workspace.id}&objectType=project&objectId=${projectId}`, { headers: ownerHeaders })
  const approvalRequest = { workspaceId: workspace.id, projectId, approvalType: 'release', objectType: 'project_release', objectId: editorVersion.id, title: 'Regression approval', detail: 'deterministic evidence and rollback available', evidence: { source: 'regression' }, rollbackAvailable: true, clientMutationId: `regression-approval-${suffix}` }
  const approval = await request('/api/v1/approvals', { method: 'POST', headers: memberHeaders, body: json(approvalRequest) })
  const replayedApproval = await request('/api/v1/approvals', { method: 'POST', headers: memberHeaders, body: json(approvalRequest) })
  assert(replayedApproval.id === approval.id, '审批重复重试未返回首次事实')
  assert(approval.status === 'pending' && approval.rollbackAvailable === true, '统一审批请求未进入 pending')
  const decidedApproval = await request(`/api/v1/approvals/${approval.id}/decision`, { method: 'POST', headers: ownerHeaders, body: json({ status: 'approved', note: 'Regression approved' }) })
  assert(decidedApproval.status === 'approved' && decidedApproval.decider, '统一审批决策未写回')
  const notifications = await request('/api/v1/notifications', { headers: memberHeaders })
  assert(notifications.some((row) => row.type === 'approval_decided' && row.objectId === editorVersion.id), '审批结果通知未生成')
   const connector = await request('/api/v1/connectors', { method: 'POST', headers: ownerHeaders, body: json({ workspaceId: workspace.id, name: 'Regression CSV', type: 'csv', endpoint: 'local://regression' }) })
   const twin = await request('/api/v1/twins', { method: 'POST', headers: ownerHeaders, body: json({ workspaceId: workspace.id, twinKey: 'regression-line', name: 'Regression Line', type: 'production-line', state: { state: 'idle' } }) })
   const dataPoint = await request('/api/v1/data/points', { method: 'POST', headers: ownerHeaders, body: json({ workspaceId: workspace.id, pointKey: 'regression.energy.kw', label: 'Regression Energy', dataType: 'number', unit: 'kW', twinId: twin.id }) })
   const mapping = await request('/api/v1/data/mappings', { method: 'POST', headers: ownerHeaders, body: json({ workspaceId: workspace.id, connectorId: connector.id, dataPointId: dataPoint.id, twinId: twin.id, sourceTag: 'tags.energy.kw', semanticKey: 'energy_kw', unit: 'kW', transform: { scale: 0.001, round: 2 } }) })
   const assetTwin = await request('/api/v1/twins/mappings', { method: 'POST', headers: ownerHeaders, body: json({ workspaceId: workspace.id, projectId, twinId: twin.id, factoryObjectId: 'regression-machine-01', note: 'software-only AssetTwin binding' }) })
   const runtimeEventRequest = { eventType: 'telemetry', quality: 'good', source: 'regression-replay', externalEventId: `runtime-${suffix}`, twinId: twin.id, pointId: dataPoint.id, unit: 'kW', payload: { state: 'running', tags: { energy: { kw: 12500 } } } }
   const runtimeEvent = await request(`/api/v1/connectors/${connector.id}/events`, { method: 'POST', headers: ownerHeaders, body: json(runtimeEventRequest) })
   const replayedRuntimeEvent = await request(`/api/v1/connectors/${connector.id}/events`, { method: 'POST', headers: ownerHeaders, body: json(runtimeEventRequest) })
   const syncMutationId = `regression-sync-${suffix}`
   const syncRun = await request(`/api/v1/connectors/${connector.id}/sync-runs`, { method: 'POST', headers: ownerHeaders, body: json({ mode: 'replay', clientMutationId: syncMutationId }) })
   const replayedSyncRun = await request(`/api/v1/connectors/${connector.id}/sync-runs`, { method: 'POST', headers: ownerHeaders, body: json({ mode: 'replay', clientMutationId: syncMutationId }) })
   const mappings = await request(`/api/v1/data/mappings?workspace_id=${workspace.id}`, { headers: ownerHeaders })
   const syncRuns = await request(`/api/v1/connectors/${connector.id}/sync-runs`, { headers: ownerHeaders })
   const assetTwins = await request(`/api/v1/twins/mappings?workspace_id=${workspace.id}`, { headers: ownerHeaders })
   const mappedDataEvents = await request(`/api/v1/data/events?workspace_id=${workspace.id}&point_id=${dataPoint.id}`, { headers: ownerHeaders })
   const twins = await request(`/api/v1/twins?workspace_id=${workspace.id}`, { headers: ownerHeaders })
   assert(mapping.id && mapping.status === 'active' && mappings.some((row) => row.id === mapping.id), '数据点映射未写入或未返回')
   assert(assetTwin.id && assetTwins.some((row) => row.id === assetTwin.id && row.factoryObjectId === 'regression-machine-01'), 'AssetTwin 工厂对象绑定未写入')
   assert(syncRun.status === 'completed' && syncRun.eventsRead === 1 && syncRun.valuesWritten === 1 && syncRun.skippedValues === 0, '连接器本地回放未写入映射值')
   assert(replayedSyncRun.id === syncRun.id && syncRuns.some((row) => row.id === syncRun.id), '连接器回放幂等或运行账本未通过')
   assert(mappedDataEvents.some((row) => Number(row.value) === 12.5 || Number(row.valueJson) === 12.5), 'Data Cloud 未收到变换后的回放值')
   const syncedTwin = twins.find((row) => row.id === twin.id)
   assert(Number(syncedTwin?.state?.energy_kw) === 12.5 && syncedTwin.quality === 'good', 'Twin Cloud 未收到映射状态')
   const windowRequest = { workspaceId: workspace.id, dataPointId: dataPoint.id, twinId: twin.id, metric: 'regression.energy.kw', windowStart: new Date(Date.now() - 60000).toISOString(), windowEnd: new Date(Date.now() + 60000).toISOString() }
   const telemetryWindow = await request('/api/v1/data/windows/aggregate', { method: 'POST', headers: ownerHeaders, body: json(windowRequest) })
   const telemetryWindows = await request(`/api/v1/data/windows?workspace_id=${workspace.id}`, { headers: ownerHeaders })
   assert(telemetryWindow.sampleCount >= 1 && Number(telemetryWindow.avg) === 12.5 && telemetryWindows.some((row) => row.id === telemetryWindow.id), '遥测窗口聚合未保留有效样本统计')
   const workOrderRequest = { workspaceId: workspace.id, projectId, twinId: twin.id, type: 'maintenance', title: 'Regression runtime work order', detail: 'software-only work order', priority: 'high', clientMutationId: `regression-work-order-${suffix}` }
   const workOrder = await request('/api/v1/work-orders', { method: 'POST', headers: ownerHeaders, body: json(workOrderRequest) })
   const replayedWorkOrder = await request('/api/v1/work-orders', { method: 'POST', headers: ownerHeaders, body: json(workOrderRequest) })
   const doneWorkOrder = await request(`/api/v1/work-orders/${workOrder.id}`, { method: 'PATCH', headers: ownerHeaders, body: json({ status: 'done' }) })
   const workOrders = await request(`/api/v1/work-orders?workspace_id=${workspace.id}`, { headers: ownerHeaders })
   assert(replayedWorkOrder.id === workOrder.id && doneWorkOrder.status === 'done' && workOrders.some((row) => row.id === workOrder.id), '运行工单生命周期或幂等重试未通过')
   const qualityRequest = { workspaceId: workspace.id, projectId, twinId: twin.id, workOrderId: workOrder.id, lotId: `LOT-${suffix}`, inspectionType: 'final_inspection', result: 'pass', score: 98.5, evidenceRef: 'software-evidence://regression', detail: 'deterministic quality ledger', clientMutationId: `regression-quality-${suffix}` }
   const qualityResult = await request('/api/v1/quality/results', { method: 'POST', headers: ownerHeaders, body: json(qualityRequest) })
   const replayedQualityResult = await request('/api/v1/quality/results', { method: 'POST', headers: ownerHeaders, body: json(qualityRequest) })
   const qualityResults = await request(`/api/v1/quality/results?workspace_id=${workspace.id}`, { headers: ownerHeaders })
   assert(replayedQualityResult.id === qualityResult.id && Number(qualityResult.score) === 98.5 && qualityResults.some((row) => row.id === qualityResult.id), '质量结果记录或幂等重试未通过')
   const maintenanceRequest = { workspaceId: workspace.id, projectId, twinId: twin.id, workOrderId: workOrder.id, faultCode: 'REG-001', action: 'software reset and verification', result: 'completed', downtimeSeconds: 42, detail: 'no real instrument involved', clientMutationId: `regression-maintenance-${suffix}` }
   const maintenanceRecord = await request('/api/v1/maintenance/records', { method: 'POST', headers: ownerHeaders, body: json(maintenanceRequest) })
   const replayedMaintenanceRecord = await request('/api/v1/maintenance/records', { method: 'POST', headers: ownerHeaders, body: json(maintenanceRequest) })
   const maintenanceRecords = await request(`/api/v1/maintenance/records?workspace_id=${workspace.id}`, { headers: ownerHeaders })
   assert(replayedMaintenanceRecord.id === maintenanceRecord.id && maintenanceRecord.downtimeSeconds === 42 && maintenanceRecords.some((row) => row.id === maintenanceRecord.id), '维护记录或幂等重试未通过')
   const events = await request(`/api/v1/connectors/${connector.id}/events?workspace_id=${workspace.id}`, { headers: memberHeaders })
  let mobile = await request(`/api/v1/mobile/summary?workspace_id=${workspace.id}`, { headers: memberHeaders })
  let denied = false
  try { await request(`/api/v1/workspaces/${memberWorkspace.id}/overview`, { headers: ownerHeaders }) } catch { denied = true }
  assert(denied, '跨工作空间访问未被拒绝')
  const activity = await waitFor(
    () => request(`/api/v1/activity?workspace_id=${workspace.id}&limit=100`, { headers: ownerHeaders }),
    (rows) => rows.some((row) => row.eventType === 'audit.recorded' && row.aggregateId === projectId)
  )
  mobile = await request(`/api/v1/mobile/summary?workspace_id=${workspace.id}`, { headers: memberHeaders })
  const filteredActivity = await request(`/api/v1/activity?workspace_id=${workspace.id}&event_type=audit.recorded&limit=20`, { headers: memberHeaders })
  const activityDatabase = await request(`/api/v1/workspaces/${workspace.id}/database-status`, { headers: ownerHeaders })
  let activityDenied = false
  try { await request(`/api/v1/activity?workspace_id=${memberWorkspace.id}&limit=20`, { headers: ownerHeaders }) } catch { activityDenied = true }
  assert(activity.some((row) => row.eventType === 'audit.recorded' && row.action === 'project.released'), 'Outbox 未投影为发布活动')
  assert(filteredActivity.length > 0 && filteredActivity.every((row) => row.eventType === 'audit.recorded'), '活动事件类型过滤或成员读取失败')
  assert((activityDatabase.eventQueue?.failed ?? 1) === 0 && (activityDatabase.eventQueue?.activity ?? 0) >= activity.length, '事件队列仍有失败或 Activity 计数不一致')
  assert(Array.isArray(mobile.activity) && mobile.activity.some((row) => row.eventType === 'audit.recorded'), 'ForgeMove 摘要未返回统一活动流')
  assert(activityDenied, '跨工作空间活动访问未被拒绝')
    result = { status: 'PASS', migration: 'V25', workspaceId: workspace.id, createdWorkspaceId: createdWorkspace.id, cloudProjectId: cloudProject.id, cloudAssetId: cloudAsset.id, publicAssetId: publicAsset.id, publicManifestDenied, assetVersionId: assetVersion.id, assetVersionNumber: assetVersion.version, assetVersionIdempotent: replayedAssetVersion.id === assetVersion.id, assetVersionHistory: assetVersions.length, assetBlobId: uploadedBlob.id, assetBlobProvider: uploadedBlob.storageProvider, publicationId: publication.id, databaseStatus: database.status, databaseTables: database.tableCount, eventQueue: activityDatabase.eventQueue, activityCount: activity.length, mobileActivityCount: mobile.activity.length, members: members.length, projectId, projectGrantRole: projectGrant.role, editorVersion: editorVersion.version, versions: versions.length, conflictDetected: conflict, roleUpdated: changedMember.role, ownerRoleBlocked, releaseId: release.id, taskStatus: doneTask.status, commentId: comment.id, commentCount: comments.length, approvalId: approval.id, approvalStatus: decidedApproval.status, notificationCount: notifications.length, connectorId: connector.id, eventCount: events.length, runtimeEventId: runtimeEvent.id, runtimeEventIdempotent: replayedRuntimeEvent.id === runtimeEvent.id, mappingId: mapping.id, assetTwinId: assetTwin.id, assetTwinCount: assetTwins.length, syncRunId: syncRun.id, syncRunIdempotent: replayedSyncRun.id === syncRun.id, mappedDataValue: mappedDataEvents.find((row) => row.id)?.value ?? mappedDataEvents.find((row) => row.id)?.valueJson, twinStateValue: syncedTwin?.state?.energy_kw, telemetryWindowId: telemetryWindow.id, telemetryWindowSamples: telemetryWindow.sampleCount, workOrderId: workOrder.id, workOrderIdempotent: replayedWorkOrder.id === workOrder.id, qualityResultId: qualityResult.id, qualityResultIdempotent: replayedQualityResult.id === qualityResult.id, maintenanceRecordId: maintenanceRecord.id, maintenanceIdempotent: replayedMaintenanceRecord.id === maintenanceRecord.id, syncRuns: syncRuns.length, mobileTasks: mobile.tasks.length, mobileConnectors: mobile.connectors.length, crossWorkspaceDenied: denied, activityCrossWorkspaceDenied: activityDenied, idempotency: { version: replayedVersion.id === committedVersion.id, task: replayedTask.id === task.id, approval: replayedApproval.id === approval.id } }
} finally {
  if (uploadedObjectPath) rmSync(uploadedObjectPath, { force: true })
  try { cleanup() } catch (error) { console.error(error.message); process.exitCode = 1 }
}

if (result) console.log(JSON.stringify(result))
