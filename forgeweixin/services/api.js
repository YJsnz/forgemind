const { API_BASE_URL, REQUEST_TIMEOUT } = require('../config/env')
const storage = require('../utils/storage')

function request(path, options = {}) {
  const token = storage.getToken()
  const header = Object.assign({
    'content-type': 'application/json'
  }, options.header || {})
  if (token && options.auth !== false) header.Authorization = `Bearer ${token}`

  return new Promise((resolve, reject) => {
    wx.request({
      url: `${API_BASE_URL}${path}`,
      method: options.method || 'GET',
      data: options.data,
      header,
      timeout: options.timeout || REQUEST_TIMEOUT,
      success(response) {
        const body = response.data || {}
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve(body)
          return
        }
        const message = body.error || `后端返回 ${response.statusCode}`
        if (response.statusCode === 401 || message === '未登录' || message === '登录已失效') {
          storage.clearSession()
          const app = typeof getApp === 'function' ? getApp() : null
          if (app && app.clearSession) app.clearSession()
        }
        reject(new Error(message))
      },
      fail(error) {
        const rawMessage = error && error.errMsg ? error.errMsg : ''
        const message = /request:fail/u.test(rawMessage)
          ? '无法连接 ForgeMind 后端，请启动 8080 服务或检查 API 地址'
          : (rawMessage || '网络请求失败，请检查 API 地址和服务状态')
        reject(new Error(message))
      }
    })
  })
}

module.exports = {
  baseUrl: API_BASE_URL,

  login(username, password) {
    return request('/api/auth/login', {
      method: 'POST',
      auth: false,
      data: { username, password }
    })
  },

  register(username, password) {
    return request('/api/auth/register', {
      method: 'POST',
      auth: false,
      data: { username, password }
    })
  },

  me() {
    return request('/api/auth/me')
  },

  logout() {
    return request('/api/auth/logout', { method: 'POST' })
  },

  listFactories() {
    return request('/api/factories')
  },

  getFactory(projectId) {
    return request(`/api/factories/${encodeURIComponent(projectId)}`)
  }
}
