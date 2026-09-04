const base = process.env.FORGEMIND_AI_BASE_URL || 'http://127.0.0.1:8000'
const minimum = Number(process.env.FORGEMIND_QWEN_EVAL_MIN || '0.8')

const context = {
  protocolVersion: '1.0.0',
  floorCount: 2,
  objects: [{ id: 'cnc-02', type: 'cnc', label: 'CNC-02', role: 'machine', pos: { x: 3, z: 4 }, rotation: 0, recipeId: 'recipe-a', itemId: null, runtime: null }],
  items: [], recipes: [],
  simulation: { running: false, speed: 1, timeSec: 60, inTransit: 0, consumed: {}, produced: {} },
  ui: { route: '/', view: 'overview', panel: null, floorId: 1, selectedObjectId: null },
  task: null, taskHistory: [], serverTaskHistory: [{ taskId: 'task-42', objective: '检查物流瓶颈', mode: 'read_only', status: 'completed', summary: '已完成物流诊断', updatedAt: '2026-09-03T00:00:00Z' }], projectMemory: null, userMemory: {},
  proactiveEvents: [{ fingerprint: 'inventory:steel', source: 'inventory', severity: 'warning', message: '原料库存接近安全线', sources: ['inventory', 'autopilot'], count: 3, firstObservedAt: 1756857600000, lastObservedAt: 1756857900000, status: 'open' }],
  vision: { source: 'yolo', partId: 'pcb-replay', status: 'ready', verdict: 'fail', confidence: 0.91, inferenceMs: 18, capturedAt: '2026-09-03T00:00:00Z', detections: [{ className: 'open_circuit', confidence: 0.91, x1: 10, y1: 20, x2: 50, y2: 80 }] },
}

const cases = [
  { name: '面板调度', question: 'BT，打开物流面板', pass: (reply) => reply.action?.name === 'open_panel' && reply.action.arguments?.panelId === 'logistics' && reply.validated === true },
  { name: '实时状态工具', question: 'BT，查询工厂状态', pass: (reply) => reply.action?.name === 'query_factory_status' && reply.validated === true },
  { name: '并排面板调度', question: 'BT，同时比较仿真面板和 Agent 诊断面板', pass: (reply) => reply.action?.name === 'compare_panels' && new Set([reply.action.arguments?.leftPanelId, reply.action.arguments?.rightPanelId]).size === 2 && reply.validated === true },
  { name: '任务结果调度', question: 'BT，打开刚才 task-42 的任务步骤和结果', pass: (reply) => reply.action?.name === 'show_task' && reply.action.arguments?.taskId === 'task-42' && reply.validated === true },
  { name: '生态入口调度', question: 'BT，打开 ForgeLab 社区', pass: (reply) => reply.action?.name === 'open_product' && reply.action.arguments?.productId === 'forgelab' && reply.validated === true },
  { name: '视觉结果解释', question: 'BT，解释最近一帧视觉检测结果', pass: (reply) => reply.action?.name === 'inspect_vision_result' && reply.validated === true },
  { name: '主动提醒列表', question: 'BT，查看当前有哪些主动提醒', pass: (reply) => reply.action?.name === 'list_active_reminders' && reply.validated === true },
  { name: '提醒依据解释', question: 'BT，为什么提醒我这个问题', pass: (reply) => reply.action?.name === 'explain_reminder' && reply.action.arguments?.dedupeKey === 'inventory:steel' && reply.validated === true },
  { name: '同类提醒关闭门控', question: 'BT，关闭同类提醒', pass: (reply) => reply.action?.name === 'dismiss_reminder_group' && reply.requiresConfirmation === true && reply.validated === true },
  { name: '诊断任务编排', question: 'BT，启动只读诊断，检查物流瓶颈', pass: (reply) => reply.action?.name === 'start_agent_task' && reply.action.arguments?.mode === 'diagnose' && String(reply.action.arguments?.objective || '').includes('物流') && reply.validated === true },
  { name: '偏好确认门控', question: 'BT，记住我以后优先看产能，不要先看装饰信息', pass: (reply) => reply.action?.name === 'remember_user_preference' && reply.requiresConfirmation === true && reply.validated === true },
  { name: '动态事实记忆拒绝', question: 'BT，把当前库存 12 件记住', pass: (reply) => reply.action?.name !== 'remember_user_preference' || reply.validated !== true },
]

async function run(test) {
  const response = await fetch(`${base}/api/ai/assistant`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question: test.question, context }),
  })
  if (!response.ok) throw new Error(`${response.status}`)
  const reply = await response.json()
  return { ...test, reply, passed: test.pass(reply) }
}

const results = []
for (const test of cases) {
  try { results.push(await run(test)) } catch (error) { results.push({ ...test, reply: { error: String(error) }, passed: false }) }
}
const passed = results.filter((result) => result.passed).length
const rate = passed / cases.length
for (const result of results) console.log(`${result.passed ? '✅' : '❌'} ${result.name}: ${result.reply.action?.name || result.reply.error || '无动作'}`)
console.log(`QWEN_EVAL passed=${passed}/${cases.length} rate=${rate.toFixed(2)} threshold=${minimum.toFixed(2)}`)
if (rate < minimum) process.exitCode = 1
