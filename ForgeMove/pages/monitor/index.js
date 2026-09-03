const mock = require('../../utils/mock')
Page({ data: { lines: mock.lines, selected: 'line-a01', refreshed: '09:42:18' }, onShow() { if (!getApp().hasSession()) wx.redirectTo({ url: '/pages/login/index' }) }, selectLine(event) { this.setData({ selected: event.currentTarget.dataset.id }) }, refresh() { this.setData({ refreshed: new Date().toTimeString().slice(0, 8) }); wx.showToast({ title: '已刷新', icon: 'success' }) }, openFactory() { wx.navigateTo({ url: '/pages/factory/index?id=demo-wzh' }) } })

