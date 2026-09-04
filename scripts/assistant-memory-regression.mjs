import { spawnSync } from 'node:child_process'

const base = process.env.FORGEMIND_BACKEND_BASE_URL || 'http://127.0.0.1:8080'
const suffix = `${Date.now()}`.slice(-8)
const owner = `bt_memory_owner_${suffix}`
const member = `bt_memory_member_${suffix}`
const password = 'ForgeMind!2026'

async function request(path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  })
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
DELETE FROM assistant_user_memory WHERE owner_user_id IN (SELECT id FROM app_user WHERE username IN (${users}));
DELETE FROM assistant_reminder_event WHERE owner_user_id IN (SELECT id FROM app_user WHERE username IN (${users}));
DELETE FROM assistant_reminder_policy WHERE owner_user_id IN (SELECT id FROM app_user WHERE username IN (${users}));
DELETE FROM auth_session WHERE user_id IN (SELECT id FROM app_user WHERE username IN (${users}));
DELETE FROM factory WHERE owner_user_id IN (SELECT id FROM app_user WHERE username IN (${users}));
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

  const saved = await request('/api/assistant/memory', { method: 'PUT', headers: ownerHeaders, body: json({ key: 'response_style', value: '简洁，先给结论再给证据' }) })
  assert(saved.persisted === true && saved.memory.response_style.includes('先给结论'), '长期记忆写入失败')
  const ownerMemory = await request('/api/assistant/memory', { headers: ownerHeaders })
  assert(ownerMemory.memory.response_style === '简洁，先给结论再给证据', '长期记忆读取失败')
  const memberMemory = await request('/api/assistant/memory', { headers: memberHeaders })
  assert(!memberMemory.memory.response_style, '长期记忆未按用户隔离')

  let liveFactRejected = false
  try { await request('/api/assistant/memory', { method: 'PUT', headers: ownerHeaders, body: json({ key: 'current_inventory', value: '库存 12 件' }) }) } catch (error) { liveFactRejected = String(error.message).includes('实时') }
  assert(liveFactRejected, '实时工厂事实未被长期记忆门禁拦截')

  await request('/api/assistant/memory', { method: 'DELETE', headers: ownerHeaders, body: json({ key: 'response_style' }) })
  const deleted = await request('/api/assistant/memory', { headers: ownerHeaders })
  assert(!deleted.memory.response_style, '长期记忆删除失败')
  console.log('✅ 助手 V28 长期记忆：用户隔离、读写删除和实时事实拦截通过')
} finally {
  cleanup()
}
