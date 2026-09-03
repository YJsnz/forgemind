const { API_BASE_URL, REQUEST_TIMEOUT } = require('../config/env')
const storage = require('../utils/storage')

function request(path, options = {}) {
  const header = Object.assign({ 'content-type': 'application/json' }, options.header || {})
  const token = storage.getToken()
  if (token && options.auth !== false) header.Authorization = `Bearer ${token}`
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${API_BASE_URL}${path}`, method: options.method || 'GET', data: options.data, header,
      timeout: options.timeout || REQUEST_TIMEOUT,
      success(response) {
        const body = response.data || {}
        if (response.statusCode >= 200 && response.statusCode < 300) return resolve(body)
        reject(new Error(body.error || `后端返回 ${response.statusCode}`))
      },
      fail(error) { reject(new Error(error && error.errMsg ? error.errMsg : '网络请求失败')) }
    })
  })
}

module.exports = {
  login(username, password) { return request('/api/auth/login', { method: 'POST', auth: false, data: { username, password } }) },
  register(username, password) { return request('/api/auth/register', { method: 'POST', auth: false, data: { username, password } }) },
  me() { return request('/api/auth/me') },
  listFactories() { return request('/api/factories') },
  getFactory(id) { return request(`/api/factories/${encodeURIComponent(id)}`) },
  mobileSummary(workspaceId) { return request(`/api/v1/mobile/summary${workspaceId ? `?workspace_id=${encodeURIComponent(workspaceId)}` : ''}`) },
  listTasks(workspaceId) { return request(`/api/v1/tasks${workspaceId ? `?workspace_id=${encodeURIComponent(workspaceId)}` : ''}`) },
  listApprovals(workspaceId) { return request(`/api/v1/approvals${workspaceId ? `?workspace_id=${encodeURIComponent(workspaceId)}` : ''}`) },
  decideApproval(id, status, note) { return request(`/api/v1/approvals/${encodeURIComponent(id)}/decision`, { method: 'POST', data: { status, note } }) },
  createTask(task) { return request('/api/v1/tasks', { method: 'POST', data: Object.assign({ clientMutationId: `forgemove-task-${Date.now()}-${Math.random().toString(16).slice(2)}` }, task) }) },
  updateTask(id, status) { return request(`/api/v1/tasks/${encodeURIComponent(id)}`, { method: 'PATCH', data: { status } }) },
  listCommunity() { return request('/api/forgelab/posts') },
  likePost(id) { return request(`/api/forgelab/posts/${encodeURIComponent(id)}/like`, { method: 'POST' }) },
  reply(id, content) { return request(`/api/forgelab/posts/${encodeURIComponent(id)}/replies`, { method: 'POST', data: { content } }) }
}
