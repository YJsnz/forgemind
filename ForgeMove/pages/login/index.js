const api = require('../../services/api')

Page({
  data: { username: '', password: '', loading: false, error: '', mode: 'login' },
  onLoad() {
    if (getApp().hasSession()) wx.switchTab({ url: '/pages/dashboard/index' })
  },
  inputUsername(event) { this.setData({ username: event.detail.value }) },
  inputPassword(event) { this.setData({ password: event.detail.value }) },
  switchMode() { this.setData({ mode: this.data.mode === 'login' ? 'register' : 'login', error: '' }) },
  submit() {
    const username = String(this.data.username).trim()
    const password = String(this.data.password)
    if (!username || password.length < 3) { this.setData({ error: '请输入账号和至少 3 位密码' }); return }
    this.setData({ loading: true, error: '' })
    const action = this.data.mode === 'login' ? api.login(username, password) : api.register(username, password)
    action.then((auth) => {
      getApp().saveSession(auth)
      wx.switchTab({ url: '/pages/dashboard/index' })
    }).catch((error) => {
      this.setData({ error: /request:fail|网络/u.test(error.message) ? '当前无法连接后端，可先进入离线演示模式' : error.message })
    }).finally(() => this.setData({ loading: false }))
  },
  demo() { getApp().enterDemo(); wx.switchTab({ url: '/pages/dashboard/index' }) }
})

