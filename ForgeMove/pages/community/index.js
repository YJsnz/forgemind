const api = require('../../services/api')
const mock = require('../../utils/mock')
const storage = require('../../utils/storage')

const withInitial = (posts) => posts.map((post) => ({ ...post, initial: String(post.author || 'F').slice(0, 1) }))

Page({
  data: { feed: withInitial(mock.feed), visibleFeed: withInitial(mock.feed), filter: 'all', query: '', draft: '', online: false, composer: false },
  onShow() { if (!getApp().hasSession()) { wx.redirectTo({ url: '/pages/login/index' }); return } this.setData({ draft: storage.getDraft() }); this.load() },
  load() { if (getApp().globalData.demo) { this.applyFilter(); return } api.listCommunity().then((posts) => { if (!Array.isArray(posts) || !posts.length) throw new Error('empty'); const mapped = posts.map((post) => ({ id: post.id, author: post.author, initial: String(post.author || 'F').slice(0, 1), role: post.role || 'BUILDER', tag: post.tag || '社区动态', tone: post.section === 'models' ? 'cyan' : post.section === 'notice' ? 'amber' : 'purple', time: post.meta || '刚刚', title: post.title, body: post.summary, likes: post.likes || 0, comments: post.replies || 0, liked: Boolean(post.liked) })); this.setData({ feed: mapped, online: true }, () => this.applyFilter()) }).catch(() => this.setData({ feed: withInitial(mock.feed), online: false }, () => this.applyFilter())) },
  selectFilter(event) { this.setData({ filter: event.currentTarget.dataset.filter }, () => this.applyFilter()) },
  inputQuery(event) { this.setData({ query: event.detail.value }, () => this.applyFilter()) },
  inputDraft(event) { const draft = event.detail.value; storage.setDraft(draft); this.setData({ draft }) },
  applyFilter() { const query = String(this.data.query || '').toLowerCase(); const visible = this.data.feed.filter((post) => (this.data.filter === 'all' || (this.data.filter === 'help' && post.tag === '求助') || (this.data.filter === 'share' && post.tag !== '求助')) && (!query || `${post.title} ${post.body} ${post.author}`.toLowerCase().includes(query))); this.setData({ visibleFeed: visible }) },
  toggleLike(event) { const id = event.currentTarget.dataset.id; const feed = this.data.feed.map((post) => post.id === id ? { ...post, likes: post.likes + (post.liked ? -1 : 1), liked: !post.liked } : post); this.setData({ feed }, () => this.applyFilter()); if (this.data.online) api.likePost(id).catch(() => {}) },
  openComposer() { this.setData({ composer: true }) },
  closeComposer() { this.setData({ composer: false }) },
  publish() { if (!String(this.data.draft).trim()) { wx.showToast({ title: '先写一点内容', icon: 'none' }); return } const author = getApp().globalData.user || '现场工程师'; const post = { id: `local-${Date.now()}`, author, initial: author.slice(0, 1), role: 'FIELD ENGINEER', tag: '我的笔记', tone: 'green', time: '刚刚', title: '现场记录：' + this.data.draft.slice(0, 18), body: this.data.draft, likes: 0, comments: 0, liked: false }; const feed = [post, ...this.data.feed]; storage.clearDraft(); this.setData({ feed, draft: '', composer: false }, () => this.applyFilter()); wx.showToast({ title: '已加入本地动态', icon: 'success' }) },
  openPost(event) { wx.showModal({ title: event.currentTarget.dataset.title, content: event.currentTarget.dataset.body, showCancel: false, confirmText: '知道了' }) }
})
