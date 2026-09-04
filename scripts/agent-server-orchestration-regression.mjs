import { spawnSync } from 'node:child_process'

const base = process.env.FORGEMIND_BACKEND_URL || 'http://127.0.0.1:8080'
const suffix = `${Date.now()}`.slice(-8)
const username = `agent_orch_${suffix}`
const password = 'ForgeMind!2026'

async function request(path, options = {}) {
  const response = await fetch(`${base}${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`${options.method || 'GET'} ${path} -> ${response.status}: ${body.error || 'request failed'}`)
  return body
}
function json(value) { return JSON.stringify(value) }
function auth(token) { return { Authorization: `Bearer ${token}` } }
function assert(condition, message) { if (!condition) throw new Error(message) }
function cleanup() {
  const quoted = username.replaceAll("'", "''")
  const sql = `
SET FOREIGN_KEY_CHECKS=0;
DELETE FROM agent_run WHERE owner_user_id IN (SELECT id FROM app_user WHERE username='${quoted}');
DELETE FROM factory WHERE owner_user_id IN (SELECT id FROM app_user WHERE username='${quoted}');
DELETE FROM auth_session WHERE user_id IN (SELECT id FROM app_user WHERE username='${quoted}');
DELETE FROM app_user WHERE username='${quoted}';
SET FOREIGN_KEY_CHECKS=1;
`
  const result = spawnSync('docker', ['exec', '-i', 'forgemind-mysql', 'mysql', '-uforgemind', '-pforgemind', '-Dforgemind'], { input: sql, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`Agent 编排回归清理失败：${result.stderr || result.stdout}`)
}

try {
  const registered = await request('/api/auth/register', { method: 'POST', body: json({ username, password }) })
  const headers = auth(registered.token)
  const save = { version: 6, name: 'Agent orchestration regression', floorCount: 1, floorNames: ['L1'], objects: [], items: [], recipes: [], machineDefinitions: [] }
  const factory = await request('/api/factories', { method: 'POST', headers, body: json({ name: save.name, save }) })
  const factoryId = factory.project?.id
  assert(factoryId, '工厂项目创建未返回项目 ID')
  const run = await request('/api/agent/runs', { method: 'POST', headers, body: json({ factory_id: factoryId, objective: '服务端只读编排回归', mode: 'read_only', context_snapshot: save }) })
  assert(run.status === 'created' && run.steps?.length === 4, 'Agent run 未建立只读步骤计划')
  const queued = await request(`/api/agent/runs/${run.id}/orchestrate`, { method: 'POST', headers })
  assert(queued.status === 'planning', '服务端编排未进入 planning 状态')
  const deadline = Date.now() + 15000
  let report = null
  while (Date.now() < deadline) {
    report = await request(`/api/agent/runs/${run.id}/report`, { headers })
    if (report.status === 'completed' || report.status === 'failed') break
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  assert(report?.status === 'completed', `服务端只读编排未完成：${report?.status}`)
  assert(report.next_action === 'inspect_result' && report.source === 'server_authoritative_structural_evidence', '统一报告缺少来源或下一步')
  assert(report.result?.server_verification?.verified_context === true, '服务端报告未包含权威上下文校验')
  console.log('Agent server orchestration PASS: queued -> async deterministic analysis -> report')
} finally {
  cleanup()
}
