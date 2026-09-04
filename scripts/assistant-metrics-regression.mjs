import { spawnSync } from 'node:child_process'

const base = process.env.FORGEMIND_BACKEND_BASE_URL || 'http://127.0.0.1:8080'
const suffix = `${Date.now()}`.slice(-8)
const owner = `bt_metric_owner_${suffix}`
const member = `bt_metric_member_${suffix}`
const password = 'ForgeMind!2026'

async function request(path, options = {}) {
  const response = await fetch(`${base}${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`${options.method || 'GET'} ${path} -> ${response.status}: ${body.error || 'request failed'}`)
  return body
}

function auth(token) { return { Authorization: `Bearer ${token}` } }
function json(value) { return JSON.stringify(value) }
function assert(condition, message) { if (!condition) throw new Error(message) }

function cleanup() {
  const users = `'${owner.replaceAll("'", "''")}','${member.replaceAll("'", "''")}'`
  const sql = `
SET FOREIGN_KEY_CHECKS=0;
DELETE FROM assistant_model_metric WHERE owner_user_id IN (SELECT id FROM app_user WHERE username IN (${users}));
DELETE FROM auth_session WHERE user_id IN (SELECT id FROM app_user WHERE username IN (${users}));
DELETE FROM app_user WHERE username IN (${users});
SET FOREIGN_KEY_CHECKS=1;
`
  const result = spawnSync('docker', ['exec', '-i', 'forgemind-mysql', 'mysql', '-uforgemind', '-pforgemind', '-Dforgemind'], { input: sql, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`测试数据清理失败：${result.stderr || result.stdout}`)
}

try {
  const ownerAuth = await request('/api/auth/register', { method: 'POST', body: json({ username: owner, password }) })
  const memberAuth = await request('/api/auth/register', { method: 'POST', body: json({ username: member, password }) })
  const ownerHeaders = auth(ownerAuth.token)
  const memberHeaders = auth(memberAuth.token)
  const sample = { provider: 'llm', firstTokenMs: 120, completeMs: 980, toolCall: true, toolSuccess: true, fallback: false }
  const first = await request('/api/assistant/metrics', { method: 'POST', headers: ownerHeaders, body: json(sample) })
  assert(first.persisted === true && first.metrics.length === 1 && first.metrics[0].sampleCount === 1, '首个助手指标没有落库')
  const second = await request('/api/assistant/metrics', { method: 'POST', headers: ownerHeaders, body: json({ ...sample, provider: 'fallback', fallback: true, toolSuccess: false }) })
  assert(second.metrics.length === 2 && second.metrics.some((row) => row.provider === 'fallback' && row.fallbacks === 1), '模型降级指标没有聚合')
  const isolated = await request('/api/assistant/metrics', { headers: memberHeaders })
  assert(isolated.metrics.length === 0, '助手指标没有按用户隔离')
  console.log('✅ 助手质量指标：延迟、工具成功、降级计数和用户隔离通过')
} finally {
  cleanup()
}
