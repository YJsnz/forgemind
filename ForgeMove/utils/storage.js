const TOKEN_KEY = 'forgemove.token'
const USER_KEY = 'forgemove.user'
const DEMO_KEY = 'forgemove.demo'
const TASK_KEY = 'forgemove.tasks'
const DRAFT_KEY = 'forgemove.community.draft'

function read(key, fallback) {
  try { return wx.getStorageSync(key) || fallback } catch (_) { return fallback }
}

module.exports = {
  getToken() { return read(TOKEN_KEY, '') },
  getUser() { return read(USER_KEY, '') },
  setSession(token, user) { wx.setStorageSync(TOKEN_KEY, token || ''); wx.setStorageSync(USER_KEY, user || '') },
  clearSession() { wx.removeStorageSync(TOKEN_KEY); wx.removeStorageSync(USER_KEY) },
  isDemo() { return Boolean(read(DEMO_KEY, false)) },
  setDemo(value) { wx.setStorageSync(DEMO_KEY, Boolean(value)) },
  getTasks() { return read(TASK_KEY, null) },
  setTasks(tasks) { wx.setStorageSync(TASK_KEY, tasks) },
  getDraft() { return read(DRAFT_KEY, '') },
  setDraft(value) { wx.setStorageSync(DRAFT_KEY, value || '') },
  clearDraft() { wx.removeStorageSync(DRAFT_KEY) }
}

