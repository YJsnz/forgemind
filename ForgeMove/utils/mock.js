const pulse = {
  throughput: 84,
  utilization: 71,
  oee: 88,
  energy: 12.6,
  window: '最近 60 分钟',
  updated: '刚刚更新'
}

const lines = [
  { id: 'line-a01', name: 'A-01 精密壳体线', code: 'LINE / A01', status: 'running', statusText: '稳定运行', utilization: 86, output: '142', target: '160', note: '节拍 25.4s · 3 台设备' },
  { id: 'line-a02', name: 'A-02 装配检测线', code: 'LINE / A02', status: 'warning', statusText: '需要关注', utilization: 64, output: '58', target: '80', note: '检测工位等待 6m · 4 条告警' },
  { id: 'line-lab', name: '实验与验证单元', code: 'CELL / LAB', status: 'idle', statusText: '待命', utilization: 0, output: '—', target: '—', note: '无活动订单 · 可用于方案验证' }
]

const tasks = [
  { id: 'task-1', type: 'urgent', label: '异常确认', title: 'A-02 检测工位出现持续等待', detail: '确认来料缓存与出料传送带是否同时受阻', owner: 'Lina', due: '今天 14:30', done: false },
  { id: 'task-2', type: 'maintenance', label: '维护计划', title: '检查 CNC Housing 端口与首段传送带', detail: '来自自动巡检：连续 3 轮吞吐下降', owner: 'Mori', due: '今天 16:00', done: false },
  { id: 'task-3', type: 'review', label: '方案评审', title: '复核 WZH 三层物流路线', detail: '对照 v6 存档与 600 秒确定性仿真证据', owner: 'Qiao', due: '明天 10:00', done: false },
  { id: 'task-4', type: 'done', label: '已完成', title: '同步本周物料库存快照', detail: '数据来源：ForgeMind Spring Boot', owner: 'You', due: '昨天', done: true }
]

const inventory = [
  { id: 'steel-blank', name: '钢制毛坯', code: 'MAT / STEEL-BLANK', stock: 128, capacity: 200, inTransit: 32, trend: '+12%', tone: 'cyan', source: 'L1 入货仓库' },
  { id: 'copper-wire', name: '铜线', code: 'MAT / COPPER-WIRE', stock: 42, capacity: 120, inTransit: 0, trend: '-18%', tone: 'amber', source: 'L2 普通货架' },
  { id: 'housing', name: '加工壳体', code: 'WIP / HOUSING', stock: 76, capacity: 160, inTransit: 18, trend: '+6%', tone: 'purple', source: 'A-01 产出缓存' },
  { id: 'finished', name: '已检成品', code: 'OUT / VERIFIED', stock: 58, capacity: 80, inTransit: 12, trend: '+21%', tone: 'green', source: 'L3 出货仓库' }
]

const feed = [
  { id: 'feed-1', author: 'ForgeMind Studio', role: 'MAINTAINER', tag: '运行笔记', tone: 'purple', time: '12 分钟前', title: 'A-02 检测单元的等待信号已经进入移动巡检', body: '移动端先展示证据摘要，布局与 Patch 仍回到 Web 工作台审批。', likes: 42, comments: 8, liked: false },
  { id: 'feed-2', author: 'Mori', role: 'MODEL MAKER', tag: '资源分享', tone: 'cyan', time: '1 小时前', title: 'CNC Housing 模型包更新了端口说明', body: '新说明增加最低点、原点和 4 个朝向的接缝检查，许可保持 CC BY 4.0。', likes: 28, comments: 5, liked: false },
  { id: 'feed-3', author: 'Lin / Layout Lab', role: 'DESIGNER', tag: '求助', tone: 'amber', time: '3 小时前', title: '跨层接口旁边怎样留出检修通道？', body: '我在 L2 落点附近遇到 AGV 回转空间和坡道足迹冲突，想听听大家的排查顺序。', likes: 19, comments: 11, liked: false },
  { id: 'feed-4', author: 'Qiao', role: 'PRODUCT DESIGNER', tag: '经验分享', tone: 'green', time: '昨天', title: '先画信号，再画设备', body: '把输入、加工、输出和诊断信号作为第一层关系，设备造型反而会更快收敛。', likes: 51, comments: 9, liked: false }
]

const factory = {
  id: 'demo-wzh', name: 'WZH 三层轻量产线', code: 'FM / WZH-3F', version: 6,
  floors: 3, objects: 39, machines: 11, items: 9, recipes: 3,
  status: 'running', statusText: '结构已同步 · 仿真证据可用', updated: '今天 09:42', owner: 'WZH / demo workspace',
  summary: '从钢制毛坯到已检成品的三层轻量示范线，包含 2 台 AGV、2 架跨层无人机与有限货架。',
  floorsInfo: [
    { name: 'L1 · 毛坯与首段加工', objects: 14, signal: 'running', note: '入货仓库 → CNC Housing' },
    { name: 'L2 · 中间装配与缓冲', objects: 13, signal: 'warning', note: '装配等待 6m' },
    { name: 'L3 · 检测与出货', objects: 12, signal: 'running', note: '出货 58 · 质量状态稳定' }
  ]
}

module.exports = { pulse, lines, tasks, inventory, feed, factory }

