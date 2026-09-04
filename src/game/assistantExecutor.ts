import { useForgeMindStore } from '../store/forgeMind'
import {
  createFactoryAssistantContext,
  validateAssistantToolCall,
  type AssistantToolCall,
  type FactoryAssistantContext,
  type AssistantPanelId,
} from './assistantProtocol'
import { dispatchAssistantPanelCommand } from './assistantPanels'
import { cancelAssistantAgentTask, dispatchAssistantAgentTask, readAssistantServerTaskHistory, readAssistantTaskHistory, retryAssistantAgentTask } from './assistantTasks'
import { forgetAssistantPreference, readAssistantMemory, rememberAssistantPreference } from './assistantMemory'
import { readAssistantReminderPolicy, writeAssistantReminderPolicy } from './assistantReminderPolicy'
import { readAssistantVisionSnapshot } from './assistantVision'
import { dismissAssistantNoticeInBackground, readAssistantProactiveEvents } from './assistantProactiveEvents'

export type AssistantExecutionResult =
  | { status: 'rejected'; answer: string }
  | { status: 'awaiting_confirmation'; answer: string; call: AssistantToolCall; summary: string }
  | { status: 'executed'; answer: string; data?: unknown }

export function getCurrentFactoryAssistantContext(): FactoryAssistantContext {
  const state = useForgeMindStore.getState()
  return createFactoryAssistantContext({
    objects: state.objects,
    items: state.items,
    recipes: state.recipes,
    snapshot: state.simSnapshot,
    running: state.simPlaying,
    speed: state.simSpeed,
    floorCount: state.floorCount,
    taskIds: [...readAssistantTaskHistory().map((item) => item.taskId), ...readAssistantServerTaskHistory().map((item) => item.taskId)],
    vision: readAssistantVisionSnapshot(),
    proactiveEvents: readAssistantProactiveEvents(),
  })
}

export function executeAssistantToolCall(raw: unknown, options: { confirmed?: boolean } = {}): AssistantExecutionResult {
  const context = getCurrentFactoryAssistantContext()
  const validation = validateAssistantToolCall(raw, context)
  if (!validation.ok) return { status: 'rejected', answer: validation.message }
  if (validation.requiresConfirmation && !options.confirmed) {
    return {
      status: 'awaiting_confirmation',
      answer: `该操作需要确认：${validation.summary}。`,
      call: validation.call,
      summary: validation.summary,
    }
  }

  const state = useForgeMindStore.getState()
  const call = validation.call
  switch (call.name) {
    case 'query_factory_status':
      return { status: 'executed', answer: factoryStatusAnswer(context), data: context.simulation }
    case 'inspect_object': {
      const object = context.objects.find((candidate) => candidate.id === call.arguments.objectId)!
      return { status: 'executed', answer: `${object.label}状态已读取。`, data: object }
    }
    case 'select_object':
      state.select(call.arguments.objectId)
      return { status: 'executed', answer: '目标设备已定位。' }
    case 'set_simulation_running':
      state.setSimPlaying(call.arguments.running)
      return { status: 'executed', answer: call.arguments.running ? '工厂仿真已启动。' : '工厂仿真已暂停。' }
    case 'set_simulation_speed':
      state.setSimSpeed(call.arguments.speed)
      return { status: 'executed', answer: `仿真倍率已设为 ${call.arguments.speed}。` }
    case 'reset_simulation':
      state.requestSimReset()
      return { status: 'executed', answer: '仿真运行进度已重置。' }
    case 'change_machine_recipe':
      state.bindRecipe(call.arguments.objectId, call.arguments.recipeId)
      return { status: 'executed', answer: '设备配方已更新。' }
    case 'bind_source_item':
      state.bindItem(call.arguments.objectId, call.arguments.itemId)
      return { status: 'executed', answer: '来料站物品已更新。' }
    case 'open_panel':
      dispatchAssistantPanelCommand({ action: 'open_panel', panelId: call.arguments.panelId })
      return { status: 'executed', answer: `已打开${panelLabel(call.arguments.panelId)}面板。` }
    case 'close_panel':
      dispatchAssistantPanelCommand({ action: 'close_panel', panelId: call.arguments.panelId })
      return { status: 'executed', answer: `已关闭${panelLabel(call.arguments.panelId)}面板。` }
    case 'focus_panel':
      dispatchAssistantPanelCommand({ action: 'focus_panel', panelId: call.arguments.panelId })
      return { status: 'executed', answer: `已聚焦${panelLabel(call.arguments.panelId)}面板。` }
    case 'select_floor':
      dispatchAssistantPanelCommand({ action: 'select_floor', floorId: call.arguments.floorId })
      return { status: 'executed', answer: `已切换到 ${call.arguments.floorId}F。` }
    case 'locate_object':
      state.select(call.arguments.objectId)
      dispatchAssistantPanelCommand({ action: 'locate_object', objectId: call.arguments.objectId })
      return { status: 'executed', answer: '已定位目标对象并打开对象详情。' }
    case 'compare_panels':
      dispatchAssistantPanelCommand({ action: 'compare_panels', leftPanelId: call.arguments.leftPanelId, rightPanelId: call.arguments.rightPanelId })
      return { status: 'executed', answer: '已打开并排比较视图。' }
    case 'show_task':
      dispatchAssistantPanelCommand({ action: 'show_task', taskId: call.arguments.taskId })
      return { status: 'executed', answer: '已打开该 Agent 任务的步骤与结果。' }
    case 'inspect_vision_result':
      return { status: 'executed', answer: context.vision?.verdict === 'fail' ? `最近视觉检测发现 ${context.vision.detections.length} 个缺陷${context.vision.frameAvailable ? '，当前帧已同步到检测面板' : ''}。` : '最近视觉检测未发现缺陷。', data: context.vision }
    case 'open_product':
      dispatchAssistantPanelCommand({ action: 'open_product', productId: call.arguments.productId })
      return { status: 'executed', answer: `已打开 ${call.arguments.productId} 产品入口。` }
    case 'start_agent_task':
      dispatchAssistantAgentTask({ kind: 'agent', objective: call.arguments.objective.trim(), mode: call.arguments.mode })
      return { status: 'executed', answer: call.arguments.mode === 'plan_design' ? '已启动方案设计任务，结果会进入待审批状态。' : '已启动只读诊断任务，完成后我会报告证据和结论。' }
    case 'run_autopilot':
      dispatchAssistantAgentTask({ kind: 'autopilot' })
      return { status: 'executed', answer: '已启动一轮只读自动巡检，完成后我会报告趋势和异常。' }
    case 'retry_agent_task':
      return retryAssistantAgentTask()
        ? { status: 'executed', answer: '已重新排队最近一次失败或取消的 Agent 任务。' }
        : { status: 'rejected', answer: '当前没有可重试的失败或取消任务。' }
    case 'cancel_agent_task':
      return cancelAssistantAgentTask()
        ? { status: 'executed', answer: '已发出任务取消请求，当前步骤将停止并记录为已取消。' }
        : { status: 'rejected', answer: '当前没有正在排队或运行的 Agent 任务。' }
    case 'list_agent_task_history': {
      const history = readAssistantTaskHistory()
      const serverHistory = readAssistantServerTaskHistory()
      const merged = [...serverHistory, ...history.filter((item) => !serverHistory.some((remote) => remote.taskId === item.taskId))]
      return { status: 'executed', answer: merged.length ? `已读取最近 ${merged.length} 条 Agent 任务记录。` : '当前没有 Agent 任务历史。', data: merged }
    }
    case 'list_active_reminders': {
      const reminders = context.proactiveEvents.filter((event) => event.status === 'open')
      return { status: 'executed', answer: reminders.length ? `当前有 ${reminders.length} 条仍开放的主动提醒。` : '当前没有仍开放的主动提醒。', data: reminders }
    }
    case 'explain_reminder': {
      const reminder = context.proactiveEvents.find((event) => event.fingerprint === call.arguments.dedupeKey)!
      const firstObserved = new Date(reminder.firstObservedAt).toLocaleString('zh-CN', { hour12: false })
      const lastObserved = new Date(reminder.lastObservedAt).toLocaleString('zh-CN', { hour12: false })
      return { status: 'executed', answer: `这条提醒来自 ${reminder.sources.join('、')}，首次观测于 ${firstObserved}，最近观测于 ${lastObserved}，累计出现 ${reminder.count} 次；当前状态为${reminder.status === 'open' ? '开放' : '已恢复'}。提醒内容：${reminder.message}`, data: reminder }
    }
    case 'dismiss_reminder_group': {
      const dismissed = dismissAssistantNoticeInBackground(call.arguments.dedupeKey)
      return dismissed
        ? { status: 'executed', answer: '已关闭这条提醒对应的同类事件，后续恢复状态仍可重新触发。' }
        : { status: 'rejected', answer: '提醒不存在或已不在当前用户范围内。' }
    }
    case 'get_reminder_policy':
      return { status: 'executed', answer: '已读取主动提醒策略。', data: readAssistantReminderPolicy() }
    case 'set_reminder_policy':
      return { status: 'executed', answer: '主动提醒策略已更新。', data: writeAssistantReminderPolicy(call.arguments) }
    case 'list_user_memory':
      return { status: 'executed', answer: Object.keys(readAssistantMemory()).length ? '已读取保存的用户偏好。' : '当前没有保存的用户偏好。', data: readAssistantMemory() }
    case 'remember_user_preference':
      rememberAssistantPreference(call.arguments.key, call.arguments.value)
      return { status: 'executed', answer: `已记住“${call.arguments.key}”这一项偏好。` }
    case 'forget_user_preference':
      forgetAssistantPreference(call.arguments.key)
      return { status: 'executed', answer: `已删除“${call.arguments.key}”这一项偏好。` }
  }
}

function panelLabel(panelId: AssistantPanelId): string {
  return {
    'factory-overview': '工厂总览',
    simulation: '仿真',
    'object-detail': '对象详情',
    production: '生产',
    logistics: '物流',
    warehouse: '仓储',
    'agent-diagnosis': 'Agent 诊断',
    'generative-planner': '生成式工厂',
    inspection: '视觉检测',
    'cloud-runtime': '云端运行',
    'activity-history': '活动历史',
  }[panelId]
}

function factoryStatusAnswer(context: FactoryAssistantContext): string {
  const produced = Object.values(context.simulation.produced).reduce((sum, quantity) => sum + quantity, 0)
  const state = context.simulation.running ? '运行中' : '已暂停'
  return `工厂${state}，在途物料 ${context.simulation.inTransit} 件，累计产出 ${produced} 件。`
}
