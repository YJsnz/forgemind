const TOKEN_KEY = 'forgeweixin.token'
const USERNAME_KEY = 'forgeweixin.username'

module.exports = {
  getToken() {
    return wx.getStorageSync(TOKEN_KEY) || ''
  },

  getUsername() {
    return wx.getStorageSync(USERNAME_KEY) || ''
  },

  setSession(token, username) {
    wx.setStorageSync(TOKEN_KEY, token || '')
    wx.setStorageSync(USERNAME_KEY, username || '')
  },

  clearSession() {
    wx.removeStorageSync(TOKEN_KEY)
    wx.removeStorageSync(USERNAME_KEY)
  }
}
