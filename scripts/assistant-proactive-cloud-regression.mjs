import { spawnSync } from 'node:child_process'

const base = process.env.FORGEMIND_BACKEND_BASE_URL || 'http://127.0.0.1:8080'
const suffix = `${Date.now()}`.slice(-8)
const owner = `bt_event_owner_${suffix}`
const member = `bt_event_member_${suffix}`
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
DELETE FROM assistant_reminder_event WHERE owner_user_id IN (SELECT id FROM app_user WHERE username IN (${users}));
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
  const event = { dedupeKey: `autopilot:cloud:${suffix}`, severity: 'warning', message: '物流与库存出现联合劣化', cooldownMs: 86_400_000, source: 'logistics' }

  const first = await request('/api/assistant/reminders/claim', { method: 'POST', headers: ownerHeaders, body: json(event) })
  assert(first.emit === true && first.count === 1 && first.sources.includes('logistics'), '首个云端事件没有正确落库')
  const second = await request('/api/assistant/reminders/claim', { method: 'POST', headers: ownerHeaders, body: json({ ...event, source: 'inventory' }) })
  assert(second.emit === false && second.count === 2 && second.sources.includes('logistics') && second.sources.includes('inventory'), '冷却内多来源事件没有合并')
  const listed = await request('/api/assistant/reminders?status=open&limit=12', { headers: ownerHeaders })
  assert(Array.isArray(listed.events) && listed.events.some((item) => item.dedupe_key === event.dedupeKey && item.occurrence_count === 2 && item.source_summary.includes('inventory')), '开放提醒查询没有返回聚合来源和次数')
  const isolated = await request('/api/assistant/reminders/claim', { method: 'POST', headers: memberHeaders, body: json({ ...event, source: 'member-check' }) })
  assert(isolated.emit === true && isolated.count === 1 && isolated.sources.includes('member-check'), '云端事件没有按用户隔离')
  const resolved = await request('/api/assistant/reminders/resolve', { method: 'POST', headers: ownerHeaders, body: json({ dedupeKey: event.dedupeKey }) })
  assert(resolved.resolved === true, '云端事件恢复状态写入失败')
  const reopened = await request('/api/assistant/reminders/claim', { method: 'POST', headers: ownerHeaders, body: json({ ...event, severity: 'critical', source: 'energy' }) })
  assert(reopened.emit === true && reopened.count === 3 && reopened.status === 'open' && reopened.sources.includes('energy'), '恢复后的升级事件没有重新打开')
  console.log('✅ 云端主动事件：多来源持久化合并、冷却计数、用户隔离和恢复升级通过')
} finally {
  cleanup()
}
