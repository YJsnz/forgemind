const storage = require('./utils/storage')
const { FONT_BASE_URL } = require('./config/env')

const projectFonts = [
  ['Forge MaiCai', 'TaoBaoMaiCaiTi-Regular.woff2', '400'],
  ['Forge Doto', 'Doto-Regular.ttf', '400'],
  ['Forge Doto', 'Doto-SemiBold.ttf', '600'],
  ['Forge Bigger', 'BiggerDisplay.otf', '700']
]

function loadProjectFonts() {
  const baseUrl = String(FONT_BASE_URL || '').replace(/\/$/u, '')
  if (!/^https:\/\//u.test(baseUrl) || typeof wx.loadFontFace !== 'function') return
  projectFonts.forEach(([family, file, weight]) => {
    wx.loadFontFace({
      family,
      global: true,
      source: `url("${baseUrl}/${file}")`,
      desc: { weight },
      fail() {}
    })
  })
}

App({
  globalData: {
    token: '',
    username: '',
    currentFactoryId: ''
  },

  onLaunch() {
    this.globalData.token = storage.getToken()
    this.globalData.username = storage.getUsername()
    loadProjectFonts()
  },

  saveSession(auth) {
    this.globalData.token = auth.token || ''
    this.globalData.username = auth.username || ''
    storage.setSession(this.globalData.token, this.globalData.username)
  },

  clearSession() {
    this.globalData.token = ''
    this.globalData.username = ''
    this.globalData.currentFactoryId = ''
    storage.clearSession()
  },

  hasSession() {
    return Boolean(this.globalData.token || storage.getToken())
  }
})
