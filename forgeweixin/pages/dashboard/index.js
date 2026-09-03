const api = require('../../services/api')
const { summarize } = require('../../utils/factory')

Page({
  data: {
    loading: true,
    error: '',
    username: '',
    projects: [],
    current: null,
    summary: null
  },

  onShow() {
    if (!getApp().hasSession()) {
      wx.redirectTo({ url: '/pages/login/index' })
      return
    }
    this.load()
  },

  load() {
    this.setData({ loading: true, error: '', username: getApp().globalData.username })
    api.listFactories().then((projects) => {
      const current = projects[0] || null
      this.setData({ projects, current })
      if (!current) return null
      getApp().globalData.currentFactoryId = current.id
      return api.getFactory(current.id)
    }).then((detail) => {
      if (detail) this.setData({ summary: summarize(detail) })
    }).catch((error) => {
      this.setData({ error: error.message || '工厂数据加载失败' })
    }).finally(() => {
      this.setData({ loading: false })
    })
  },

  openCurrent() {
    if (!this.data.current) return
    wx.navigateTo({ url: `/pages/factory/index?id=${encodeURIComponent(this.data.current.id)}` })
  },

  openFactories() {
    wx.switchTab({ url: '/pages/factories/index' })
  }
})
