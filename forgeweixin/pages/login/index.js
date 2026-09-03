const api = require('../../services/api')

Page({
  data: {
    username: '',
    password: '',
    error: '',
    loading: false
  },

  onLoad() {
    const app = getApp()
    if (!app.hasSession()) return
    api.me().then(() => {
      wx.switchTab({ url: '/pages/dashboard/index' })
    }).catch(() => app.clearSession())
  },

  onUsernameInput(event) {
    this.setData({ username: event.detail.value })
  },

  onPasswordInput(event) {
    this.setData({ password: event.detail.value })
  },

  submit() {
    const { username, password } = this.data
    if (!username.trim() || password.length < 6) {
      this.setData({ error: '请输入用户名和至少 6 位密码' })
      return
    }
    this.setData({ loading: true, error: '' })
    api.login(username.trim(), password).then((auth) => {
      getApp().saveSession(auth)
      wx.switchTab({ url: '/pages/dashboard/index' })
    }).catch((error) => {
      this.setData({ error: error.message || '登录失败' })
    }).finally(() => {
      this.setData({ loading: false })
    })
  }
})
