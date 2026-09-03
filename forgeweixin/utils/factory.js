function asArray(value) {
  return Array.isArray(value) ? value : []
}

function objectLabel(object) {
  return object.displayName || object.name || object.label || object.type || object.kind || object.id || '未命名对象'
}

function isMachine(object) {
  const value = `${object.type || ''} ${object.kind || ''} ${object.category || ''}`.toLowerCase()
  return value.includes('machine') || value.includes('cnc') || value.includes('assembly') || value.includes('inspection') || value.includes('warehouse')
}

function summarize(project) {
  const save = project && project.save ? project.save : {}
  const objects = asArray(save.objects)
  const floors = asArray(save.floorNames).length || Number(save.floorCount) || project.project?.floorCount || 1
  const items = asArray(save.items)
  const recipes = asArray(save.recipes)
  const machines = objects.filter(isMachine)
  return {
    name: project.project?.name || save.name || '未命名工厂',
    version: save.version || project.project?.version || 0,
    floors,
    objects,
    items,
    recipes,
    machines,
    stats: [
      { label: '设备与物流', value: objects.length },
      { label: '生产设备', value: machines.length },
      { label: '物品', value: items.length },
      { label: '配方', value: recipes.length }
    ],
    status: objects.length ? '结构数据已同步' : '空白工厂，等待配置'
  }
}

module.exports = { asArray, objectLabel, summarize }
