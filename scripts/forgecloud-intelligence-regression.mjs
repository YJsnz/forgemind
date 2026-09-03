import { spawnSync } from 'node:child_process'

const base = process.env.FORGECLOUD_BASE_URL || 'http://127.0.0.1:8080'
const suffix = `${Date.now()}`.slice(-8)
const owner = `fc_int_owner_${suffix}`
const member = `fc_int_member_${suffix}`
const password = 'ForgeCloud!2026'

async function request(path, options = {}) {
  const response = await fetch(`${base}${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`${options.method || 'GET'} ${path} -> ${response.status}: ${body.error || body.message || 'request failed'}`)
  return body
}

function auth(token) { return { Authorization: `Bearer ${token}` } }
function json(value) { return JSON.stringify(value) }
function assert(condition, message) { if (!condition) throw new Error(message) }

function cleanup() {
  const quoted = [owner, member].map((value) => value.replaceAll("'", "''")).map((value) => `'${value}'`).join(',')
  const sql = `
SET FOREIGN_KEY_CHECKS=0;
DELETE FROM cloud_data_event WHERE device_id IN (SELECT id FROM cloud_device WHERE created_by IN (SELECT id FROM app_user WHERE username IN (${quoted}))) OR twin_id IN (SELECT id FROM cloud_twin WHERE created_by IN (SELECT id FROM app_user WHERE username IN (${quoted})));
DELETE FROM cloud_device_command WHERE requested_by IN (SELECT id FROM app_user WHERE username IN (${quoted}));
DELETE FROM cloud_data_point WHERE created_by IN (SELECT id FROM app_user WHERE username IN (${quoted}));
DELETE FROM cloud_twin WHERE created_by IN (SELECT id FROM app_user WHERE username IN (${quoted}));
DELETE FROM cloud_device WHERE created_by IN (SELECT id FROM app_user WHERE username IN (${quoted}));
DELETE FROM cloud_ai_task WHERE requested_by IN (SELECT id FROM app_user WHERE username IN (${quoted}));
DELETE FROM cloud_ai_model WHERE created_by IN (SELECT id FROM app_user WHERE username IN (${quoted}));
DELETE FROM cloud_project WHERE owner_user_id IN (SELECT id FROM app_user WHERE username IN (${quoted}));
DELETE FROM cloud_workspace WHERE owner_user_id IN (SELECT id FROM app_user WHERE username IN (${quoted}));
DELETE FROM factory WHERE owner_user_id IN (SELECT id FROM app_user WHERE username IN (${quoted}));
DELETE FROM auth_session WHERE user_id IN (SELECT id FROM app_user WHERE username IN (${quoted}));
DELETE FROM app_user WHERE username IN (${quoted});
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
  const memberWorkspace = (await request('/api/v1/workspaces', { headers: memberHeaders }))[0]
  const workspace = (await request('/api/v1/workspaces', { headers: ownerHeaders }))[0]
  assert(workspace?.id && memberWorkspace?.id, '工作空间未自动创建')

  const device = await request('/api/v1/devices', { method: 'POST', headers: ownerHeaders, body: json({ workspaceId: workspace.id, deviceKey: 'cnc-01', name: 'CNC 加工中心 01', type: 'cnc', endpoint: 'opc.tcp://demo/cnc-01', metadata: { line: 'A-01' } }) })
  assert(device.status === 'registered' && device.deviceKey === 'cnc-01', '设备注册失败')
  const heartbeat = await request(`/api/v1/devices/${device.id}/heartbeat`, { method: 'POST', headers: ownerHeaders, body: json({ status: 'online', metadata: { spindle: 'ready' } }) })
  assert(heartbeat.status === 'online' && heartbeat.lastSeenAt, '设备心跳未更新')
  await request(`/api/v1/workspaces/${workspace.id}/members`, { method: 'POST', headers: ownerHeaders, body: json({ username: member, role: 'member' }) })
  const memberDevices = await request(`/api/v1/devices?workspace_id=${workspace.id}`, { headers: memberHeaders })
  assert(memberDevices.some((row) => row.id === device.id), '成员无法读取设备')

  const twin = await request('/api/v1/twins', { method: 'POST', headers: ownerHeaders, body: json({ workspaceId: workspace.id, twinKey: 'cnc-01-twin', name: 'CNC-01 数字孪生', type: 'device', sourceDeviceId: device.id, state: { mode: 'idle' } }) })
  const twinState = await request(`/api/v1/twins/${twin.id}/state`, { method: 'POST', headers: ownerHeaders, body: json({ quality: 'good', state: { mode: 'running', energyKw: 12.4 } }) })
  assert(twinState.quality === 'good' && twinState.state.mode === 'running', '孪生状态未更新')
  const point = await request('/api/v1/data/points', { method: 'POST', headers: ownerHeaders, body: json({ workspaceId: workspace.id, pointKey: 'cnc-01.energy.kw', label: '主轴功率', dataType: 'number', unit: 'kW', deviceId: device.id, twinId: twin.id }) })
  const event = await request('/api/v1/data/events', { method: 'POST', headers: ownerHeaders, body: json({ workspaceId: workspace.id, eventType: 'telemetry', quality: 'good', value: { value: 12.4 }, deviceId: device.id, twinId: twin.id, pointId: point.id }) })
  const events = await request(`/api/v1/data/events?workspace_id=${workspace.id}&point_id=${point.id}`, { headers: memberHeaders })
  const points = await request(`/api/v1/data/points?workspace_id=${workspace.id}`, { headers: memberHeaders })
  assert(event.pointId === point.id && events.length === 1 && points.find((row) => row.id === point.id)?.lastQuality === 'good', '数据事件没有落库或数据点最新状态未刷新')

  const command = await request(`/api/v1/devices/${device.id}/commands`, { method: 'POST', headers: ownerHeaders, body: json({ type: 'inspect', command: { requestedMode: 'read_only' } }) })
  assert(command.status === 'pending', '设备命令没有进入 pending 队列')
  let memberCommandDenied = false
  try { await request(`/api/v1/devices/${device.id}/commands`, { method: 'POST', headers: memberHeaders, body: json({ type: 'inspect', command: {} }) }) } catch (error) { memberCommandDenied = String(error.message).includes('400') }
  assert(memberCommandDenied, '普通成员不应拥有设备控制命令权限')

  const models = await request(`/api/v1/ai/models?workspace_id=${workspace.id}`, { headers: memberHeaders })
  assert(models.some((model) => model.provider === 'rule' && model.status === 'active'), '规则 AI 模型未提供')
  const aiTask = await request('/api/v1/ai/tasks', { method: 'POST', headers: ownerHeaders, body: json({ workspaceId: workspace.id, type: 'factory_diagnosis', input: { deviceId: device.id, evidence: 'read_only' } }) })
  const aiTasks = await request(`/api/v1/ai/tasks?workspace_id=${workspace.id}`, { headers: memberHeaders })
  assert(aiTask.status === 'queued' && aiTasks.some((task) => task.id === aiTask.id), 'AI 任务没有进入队列')
  const completedAiTask = await request(`/api/v1/ai/tasks/${aiTask.id}/run`, { method: 'POST', headers: ownerHeaders })
  assert(completedAiTask.status === 'completed' && completedAiTask.output?.deterministic === true && completedAiTask.output?.provider === 'rule', '规则 AI 任务没有完成确定性执行')
  let crossWorkspaceDenied = false
  try { await request(`/api/v1/devices?workspace_id=${memberWorkspace.id}`, { headers: ownerHeaders }) } catch { crossWorkspaceDenied = true }
  assert(crossWorkspaceDenied, '跨工作空间设备访问未被拒绝')
  result = { status: 'PASS', migration: 'V25', deviceStatus: heartbeat.status, twinQuality: twinState.quality, dataEvents: events.length, commandStatus: command.status, memberCommandDenied, aiModelCount: models.length, aiTaskStatus: completedAiTask.status, aiOutputDeterministic: completedAiTask.output.deterministic, crossWorkspaceDenied, owner: ownerMe.username }
} finally {
  try { cleanup() } catch (error) { console.error(error.message); process.exitCode = 1 }
}

if (result) console.log(JSON.stringify(result))
