const storage = require('./utils/storage')

App({
  globalData: { token: '', user: '', demo: false, factory: null },

  onLaunch() {
    this.globalData.token = storage.getToken()
    this.globalData.user = storage.getUser()
    this.globalData.demo = storage.isDemo()
  },

  saveSession(auth) {
    this.globalData.token = auth.token || ''
    this.globalData.user = auth.username || auth.user || ''
    this.globalData.demo = false
    storage.setDemo(false)
    storage.setSession(this.globalData.token, this.globalData.user)
  },

  enterDemo() {
    this.globalData.token = ''
    this.globalData.user = '现场工程师'
    this.globalData.demo = true
    storage.setDemo(true)
  },

  clearSession() {
    this.globalData.token = ''
    this.globalData.user = ''
    this.globalData.demo = false
    this.globalData.factory = null
    storage.clearSession()
    storage.setDemo(false)
  },

  hasSession() { return Boolean(this.globalData.token || this.globalData.demo || storage.getToken() || storage.isDemo()) }
})

