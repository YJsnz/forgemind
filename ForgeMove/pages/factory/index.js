const mock = require('../../utils/mock')
Page({ data: { factory: mock.factory }, onLoad() { if (!getApp().hasSession()) { wx.redirectTo({ url: '/pages/login/index' }); return } this.setData({ factory: getApp().globalData.factory || mock.factory }) }, back() { wx.navigateBack() }, copyId() { wx.setClipboardData({ data: this.data.factory.id }); wx.showToast({ title: '项目 ID 已复制', icon: 'success' }) } })

