const api = require('../../services/api')
const mock = require('../../utils/mock')
const format = require('../../utils/format')

Page({
  data: { loading: true, online: false, user: '', factory: mock.factory, pulse: mock.pulse, lines: mock.lines, alerts: [], activity: [] },
  onShow() {
    if (!getApp().hasSession()) { wx.redirectTo({ url: '/pages/login/index' }); return }
    this.load()
  },
  load() {
    const app = getApp()
    this.setData({ loading: true, user: app.globalData.user || '现场工程师', online: !app.globalData.demo, factory: app.globalData.factory || mock.factory, alerts: [{ label: 'A-02 生产线', title: '检测工位持续等待', tone: 'warning', detail: '已生成移动确认任务' }, { label: '库存提醒', title: '铜线库存低于安全线', tone: 'amber', detail: '当前 42 / 120 件' }], activity: [{ time: '09:42', title: '结构数据已同步', detail: 'WZH 三层轻量产线 · v6' }, { time: '09:18', title: '自动巡检完成一轮', detail: '发现 1 条需要关注的信号' }, { time: '昨天', title: '社区有 3 条新回复', detail: 'ForgeLab · 跨层布局讨论' }] })
    if (app.globalData.demo) { this.setData({ loading: false }); return }
    api.mobileSummary().then((summary) => {
      const tasks = Array.isArray(summary.tasks) ? summary.tasks : []
      const activity = Array.isArray(summary.activity) ? summary.activity : []
      this.setData({ activity: activity.length ? activity.slice(0, 5).map((event) => ({ time: format.relativeTime ? format.relativeTime(event.createdAt) : '刚刚', title: event.action || event.eventType || '平台事件', detail: `${event.aggregateType || 'workspace'} · ${event.aggregateId || event.result || '已记录'}` })) : tasks.slice(0, 3).map((task) => ({ time: format.relativeTime ? format.relativeTime(task.updatedAt) : '刚刚', title: task.title, detail: `${task.status} · ${task.type}` })) })
      const projects = Array.isArray(summary.projects) ? summary.projects : []
      const first = Array.isArray(projects) ? projects[0] : null
      if (!first || !first.id) throw new Error('没有可访问的工厂项目')
      return api.getFactory(first.id)
    }).then((detail) => {
      const live = format.mergeFactory(detail)
      app.globalData.factory = live
      this.setData({ factory: live, online: true })
    }).catch(() => {
      this.setData({ online: false, factory: mock.factory })
    }).finally(() => this.setData({ loading: false }))
  },
  openFactory() { wx.navigateTo({ url: `/pages/factory/index?id=${encodeURIComponent(this.data.factory.id)}` }) },
  openPage(event) { const page = event.currentTarget.dataset.page; if (page) wx.switchTab({ url: `/pages/${page}/index` }) },
  refresh() { wx.showLoading({ title: '同步中' }); this.load(); setTimeout(() => wx.hideLoading(), 500) },
  formatPercent(event) { return format.percent(event) }
})
