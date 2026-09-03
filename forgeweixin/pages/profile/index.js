const api = require('../../services/api')

Page({
  data: { username: '', avatar: 'F', apiBaseUrl: api.baseUrl, loggingOut: false },

  onShow() {
    if (!getApp().hasSession()) {
      wx.redirectTo({ url: '/pages/login/index' })
      return
    }
    const username = getApp().globalData.username || ''
    this.setData({ username, avatar: username.slice(0, 1).toUpperCase() || 'F' })
  },

  logout() {
    this.setData({ loggingOut: true })
    api.logout().catch(() => undefined).finally(() => {
      getApp().clearSession()
      this.setData({ loggingOut: false })
      wx.redirectTo({ url: '/pages/login/index' })
    })
  }
})
