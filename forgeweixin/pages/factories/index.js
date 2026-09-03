const api = require('../../services/api')

Page({
  data: { loading: true, error: '', projects: [] },

  onShow() {
    if (!getApp().hasSession()) {
      wx.redirectTo({ url: '/pages/login/index' })
      return
    }
    this.load()
  },

  load() {
    this.setData({ loading: true, error: '' })
    api.listFactories().then((projects) => {
      this.setData({ projects })
    }).catch((error) => {
      this.setData({ error: error.message || '项目列表加载失败' })
    }).finally(() => this.setData({ loading: false }))
  },

  open(event) {
    const id = event.currentTarget.dataset.id
    wx.navigateTo({ url: `/pages/factory/index?id=${encodeURIComponent(id)}` })
  }
})
