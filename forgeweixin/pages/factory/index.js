const api = require('../../services/api')
const { objectLabel, summarize } = require('../../utils/factory')

Page({
  data: { loading: true, error: '', summary: null, objects: [] },

  onLoad(options) {
    if (!getApp().hasSession()) {
      wx.redirectTo({ url: '/pages/login/index' })
      return
    }
    this.projectId = options.id || ''
    this.load()
  },

  load() {
    if (!this.projectId) {
      this.setData({ error: '缺少工厂项目 ID', loading: false })
      return
    }
    this.setData({ loading: true, error: '' })
    api.getFactory(this.projectId).then((detail) => {
      const summary = summarize(detail)
      const objects = summary.objects.slice(0, 60).map((object) => ({
        id: object.id,
        label: objectLabel(object),
        floor: object.floor ?? object.floorIndex ?? 1,
        type: object.type || object.kind || 'object'
      }))
      this.setData({ summary, objects })
    }).catch((error) => {
      this.setData({ error: error.message || '工厂详情加载失败' })
    }).finally(() => this.setData({ loading: false }))
  }
})
