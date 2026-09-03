import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const root = path.resolve('ForgeMove')
const required = [
  'app.js', 'app.json', 'app.wxss', 'project.config.json', 'sitemap.json',
  'config/env.js', 'services/api.js', 'utils/mock.js', 'utils/storage.js',
  'pages/login/index.js', 'pages/dashboard/index.js', 'pages/monitor/index.js',
  'pages/tasks/index.js', 'pages/inventory/index.js', 'pages/community/index.js',
  'pages/factory/index.js', 'pages/profile/index.js', 'components/status-orb/index.js'
]

const failures = []
for (const file of required) if (!fs.existsSync(path.join(root, file))) failures.push(`缺少 ${file}`)

for (const file of fs.readdirSync(root, { recursive: true })) {
  if (!String(file).endsWith('.json')) continue
  try { JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')) } catch (error) { failures.push(`${file}: JSON ${error.message}`) }
}

const jsFiles = fs.readdirSync(root, { recursive: true }).filter((file) => String(file).endsWith('.js'))
for (const file of jsFiles) {
  const result = spawnSync(process.execPath, ['--check', path.join(root, file)], { encoding: 'utf8' })
  if (result.status !== 0) failures.push(`${file}: JavaScript 语法错误\n${result.stderr}`)
}

const wxssFiles = fs.readdirSync(root, { recursive: true }).filter((file) => String(file).endsWith('.wxss'))
for (const file of wxssFiles) {
  const source = fs.readFileSync(path.join(root, file), 'utf8')
  if (/[>+~]/u.test(source)) failures.push(`${file}: 含微信 WXSS 不稳定的组合选择器`)
  if (/@font-face|url\s*\(/u.test(source)) failures.push(`${file}: 不允许本地字体或资源 URL，避免开发者工具路径错误`)
}

const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'))
for (const page of app.pages) for (const ext of ['.js', '.json', '.wxml', '.wxss']) if (!fs.existsSync(path.join(root, `${page}${ext}`))) failures.push(`页面 ${page} 缺少 ${ext}`)
if (!app.tabBar || app.tabBar.list.length !== 5) failures.push('app.json 应配置 5 个底部导航入口')

if (failures.length) { console.error(`ForgeMove 校验失败（${failures.length} 项）`); failures.forEach((item) => console.error(`- ${item}`)); process.exit(1) }
console.log(`ForgeMove 校验通过：${required.length} 个核心文件、${jsFiles.length} 个 JavaScript、${wxssFiles.length} 个 WXSS、${app.pages.length} 个页面`)

