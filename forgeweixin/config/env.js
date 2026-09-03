// 本机开发使用 127.0.0.1；真机/生产环境替换为已备案且配置到微信合法域名的 HTTPS 地址。
module.exports = {
  API_BASE_URL: 'http://127.0.0.1:8080',
  // 微信不允许 WXSS @font-face 直接读取打包目录；部署字体后填 HTTPS 目录即可启用项目字体。
  FONT_BASE_URL: '',
  REQUEST_TIMEOUT: 10000
}
