function percent(value) { return `${Math.max(0, Math.min(100, Number(value) || 0))}%` }
function initials(name) { return String(name || 'FM').replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || 'FM' }
function mergeFactory(detail) {
  const source = detail || {}
  const project = source.project || {}
  const save = source.save || {}
  const objects = Array.isArray(save.objects) ? save.objects : []
  const floors = Array.isArray(save.floorNames) ? save.floorNames.length : Number(save.floorCount) || 1
  return { ...require('./mock').factory, id: project.id || source.id || 'live-factory', name: project.name || save.name || '未命名工厂', version: save.version || project.version || 6, floors, objects: objects.length || 0, items: Array.isArray(save.items) ? save.items.length : 0, recipes: Array.isArray(save.recipes) ? save.recipes.length : 0, status: 'synced', statusText: '结构已同步 · 运行态需在 Web 工作台查看' }
}
module.exports = { percent, initials, mergeFactory }

