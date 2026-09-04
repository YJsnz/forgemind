import { AnimatePresence, motion } from 'motion/react'
import { Activity, AlertTriangle, ArrowRight, Bot, Check, CheckCircle2, Circle, Clock3, Cpu, Factory, FileDiff, Gauge, LoaderCircle, LocateFixed, PackageOpen, Play, RefreshCw, ShieldCheck, Square, Undo2, Workflow, XCircle } from 'lucide-react'
import { Activity as ActivityData, Circle as CircleData, CircleCheck as CircleCheckData, CircleX as CircleXData, FileDiff as FileDiffData, LoaderCircle as LoaderCircleData } from 'lucide'
import { MorphingIcon } from './MorphingIcon'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { applyFactoryPatchToSave, createFactoryVersion, validateFactoryPatch } from '../game/factoryAgent'
import { runAgentInWorker, type AgentWorkerTask } from '../game/agentWorker'
import type { AutopilotBaseline } from '../game/factoryAutopilot'
import { runAutopilotCycleInWorker, type AutopilotWorkerHandle } from '../game/autopilotWorker'
import type { MetricsSample } from '../game/metricsHistory'
import { narratePatrolReport } from '../game/patrolNarrative'
import { askAssistant } from '../game/api'
import { dispatchAssistantNotice, dispatchAssistantState, resolveAssistantNotice } from '../game/assistantRuntime'
import { rememberAssistantProjectRun } from '../game/assistantProjectMemory'
import { consumeAssistantAgentTask, getAssistantTaskState, isAssistantAgentTaskCancelled, readAssistantTaskHistory, resumeAssistantAgentTask, updateAssistantTaskProgress, updateAssistantTaskState, type AssistantAgentTaskCommand } from '../game/assistantTasks'
import { mergeAssistantAnalyses, planAssistantSubtasks } from '../game/assistantTaskPlan'
import { autopilotSource, recordAssistantProactiveEvent } from '../game/assistantProactiveEvents'
import { compareAgentBranches } from '../game/agentBranch'
import type { AgentAnalysisResult, AgentFinding, AgentMetrics, AgentMode, BranchSimulationResult, FactoryPatch } from '../game/agentTypes'
import { useForgeMindStore } from '../store/forgeMind'
import { agentApi, remotePatchToLocal, subscribeAgent, type AgentReport, type RemoteRun } from '../api/agent'
import { fetchFactoryProject, type FactoryProjectSummary } from '../api/factoryProjects'
import type { FactorySave } from '../game/save'
import '../forgecore-agent.css'
import '../forgecore-agent-mode.css'

const ease = [0.16, 1, 0.3, 1] as const
const DEFAULT_OBJECTIVE = '检查当前工厂的生产、库存和物流瓶颈'
const PATROL_INTERVAL_SEC = 60
type PostApplyReview = {
  before: AgentMetrics
  after: AgentMetrics
  delta: Pick<AgentMetrics, 'throughputPerHour' | 'utilization' | 'wip' | 'blockedObjects' | 'produced' | 'averageTransportSec' | 'inventoryTotal'>
}

export function FactoryAgentWorkspace({ onLocate, currentProject, focusedTaskId, onEnterGenerative }: { onLocate?: () => void; currentProject: FactoryProjectSummary | null; focusedTaskId?: string | null; onEnterGenerative?: () => void }) {
  const store = useForgeMindStore()
  const { factoryId, factoryName, objects, recipes, items, simSnapshot: snapshot, floorCount, select } = store
  const [objective, setObjective] = useState(DEFAULT_OBJECTIVE)
  const [mode, setMode] = useState<AgentMode>('diagnose')
  const [analysis, setAnalysis] = useState<AgentAnalysisResult | null>(null)
  const [history, setHistory] = useState<AgentAnalysisResult[]>([])
  const [patch, setPatch] = useState<FactoryPatch | null>(null)
  const [branch, setBranch] = useState<BranchSimulationResult | null>(null)
  const [postApplyReview, setPostApplyReview] = useState<PostApplyReview | null>(null)
  const [busy, setBusy] = useState(false)
  const [auditStatus, setAuditStatus] = useState<'idle'|'syncing'|'completed'|'failed'>('idle')
  const [auditError, setAuditError] = useState<string | null>(null)
  const [patchBusy, setPatchBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rejectionReason, setRejectionReason] = useState('')
  const [remoteRun, setRemoteRun] = useState<RemoteRun | null>(null)
  const [serverReport, setServerReport] = useState<AgentReport | null>(null)
  const [recoverableRun, setRecoverableRun] = useState<RemoteRun | null>(null)
  const [autopilotNote, setAutopilotNote] = useState<string | null>(null)
  const [patrolOn, setPatrolOn] = useState(false)
  const [patrolReport, setPatrolReport] = useState<string | null>(null)
  const autopilotRef = useRef<{ baseline: AutopilotBaseline | null; samples: MetricsSample[] }>({ baseline: null, samples: [] })
  const patrolTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const patrolWorkerRef = useRef<AutopilotWorkerHandle | null>(null)
  const patrolRunningRef = useRef(false)
  const narrationSeqRef = useRef(0)
  const agentTaskRef = useRef<AgentWorkerTask | null>(null)
  const auditSeqRef = useRef(0)
  const remoteRunIdRef = useRef<string | null>(null)
  const remoteCancelRequestedRef = useRef(false)
  const serverRecoveryStopRef = useRef<(() => void) | null>(null)
  const context = useMemo(() => ({ objects, recipes, items, snapshot, floorCount }), [floorCount, items, objects, recipes, snapshot])
  const contextRef = useRef(context)
  contextRef.current = context
  const version = useMemo(() => createFactoryVersion(context), [context])
  const status = busy ? 'executing_tools' : patch?.status === 'draft' ? 'awaiting_approval' : patch?.status === 'rejected' ? 'rejected' : analysis ? 'completed' : 'created'
  const focusedTask = focusedTaskId ? readAssistantTaskHistory().find((item) => item.taskId === focusedTaskId) : null

  useEffect(() => {
    setAnalysis(null); setPatch(null); setBranch(null); setPostApplyReview(null); setError(null)
    auditSeqRef.current += 1
    setRemoteRun(null); setServerReport(null); setAuditStatus('idle'); setAuditError(null); setAutopilotNote(null)
    setPatrolOn(false); setPatrolReport(null)
    autopilotRef.current = { baseline: null, samples: [] }
    if (currentProject) {
      void agentApi.listRuns(currentProject.id)
        .then((runs) => {
          setHistory(runs.flatMap((run) => run.result?.local_result ? [run.result.local_result] : []).slice(0, 8))
          setRecoverableRun(runs.find((run) => ['created', 'planning', 'contextualizing', 'executing_tools', 'synthesizing'].includes(run.status)) ?? null)
        })
        .catch(() => setHistory([]))
    } else { setHistory([]); setRecoverableRun(null) }
    return () => { agentTaskRef.current?.cancel(); serverRecoveryStopRef.current?.(); serverRecoveryStopRef.current = null }
  }, [factoryId, currentProject?.id])

  const remember = (result: AgentAnalysisResult) => {
    setAnalysis(result)
    setHistory((current) => {
      const next = [result, ...current.filter((run) => run.runId !== result.runId)].slice(0, 8)
      return next
    })
  }
  const runAnalysis = async (resumeRun?: RemoteRun) => {
    const activeObjective = resumeRun?.objective ?? objective
    const activeMode = resumeRun?.mode === 'plan_design' ? 'plan_design' : mode
    if (!activeObjective.trim() || busy) return
    const subtasks = planAssistantSubtasks(activeObjective, activeMode)
    const currentTask = getAssistantTaskState()
    if (!resumeRun && !(currentTask && ['queued', 'running'].includes(currentTask.status) && currentTask.kind === 'agent')) {
      resumeAssistantAgentTask({ kind: 'agent', objective: activeObjective, mode: activeMode })
    }
    if (resumeRun) resumeAssistantAgentTask({ kind: 'agent', objective: activeObjective, mode: activeMode })
    updateAssistantTaskState('running', activeMode === 'plan_design' ? '正在生成受控方案' : '正在执行只读诊断')
    updateAssistantTaskProgress(0.12, subtasks[0].id, '正在读取工厂结构与运行信号')
    dispatchAssistantState({ phase: 'thinking', message: activeMode === 'plan_design' ? '正在生成受控方案' : '正在执行只读诊断' })
    const auditSeq = ++auditSeqRef.current
    remoteRunIdRef.current = null
    remoteCancelRequestedRef.current = false
    setBusy(true); setAuditStatus('idle'); setAuditError(null); setError(null); setAnalysis(null); setPatch(null); setBranch(null); setPostApplyReview(null); setRemoteRun(null); setServerReport(null)
    const remoteRunPromise = resumeRun
      ? Promise.resolve(resumeRun)
      : currentProject
        ? agentApi.createRun(currentProject.id, activeObjective, activeMode === 'plan_design' ? 'plan_design' : 'read_only', useForgeMindStore.getState().exportSave())
      : null
    let remoteRunId: string | null = null
    let remoteProgressQueue = Promise.resolve()
    const syncRemoteProgress = (stepKey: string, status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled', detail: string) => {
      if (!remoteRunPromise) return
      remoteProgressQueue = remoteProgressQueue.then(async () => {
        if (!remoteRunId) {
          const created = await remoteRunPromise
          remoteRunId = created.id
          remoteRunIdRef.current = created.id
          if (auditSeq === auditSeqRef.current) setRemoteRun(created)
        }
        if (remoteCancelRequestedRef.current) {
          await agentApi.cancelRun(remoteRunId)
          return
        }
        await agentApi.updateProgress(remoteRunId, stepKey, status, detail)
      }).catch(() => undefined)
    }
    if (remoteRunPromise) setAuditStatus('syncing')
    try {
      syncRemoteProgress('compile_goal', 'completed', '目标约束已编译')
      updateAssistantTaskProgress(0.28, subtasks[0].id, '正在整理相关证据与约束')
      syncRemoteProgress('load_context', 'running', '正在读取服务端权威工厂存档')
      syncRemoteProgress('load_context', 'completed', '服务端存档与当前上下文一致')
      syncRemoteProgress('execute_tools', 'running', '正在执行只读结构工具')
      const subtaskResults: Array<{ analysis: AgentAnalysisResult; patch: FactoryPatch | null }> = []
      for (let subtaskIndex = 0; subtaskIndex < subtasks.length; subtaskIndex += 1) {
        const subtask = subtasks[subtaskIndex]
        if (isAssistantAgentTaskCancelled()) throw new Error('Agent 运行已取消')
        updateAssistantTaskProgress(0.32 + (subtaskIndex / subtasks.length) * 0.42, subtask.id, `正在执行子任务：${subtask.label}`)
        let workerResult: { analysis: AgentAnalysisResult; patch: FactoryPatch | null } | null = null
        let workerFailure: unknown = null
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const task = runAgentInWorker({ objective: subtask.objective, context, mode: activeMode, buildPatch: subtask.buildPatch === true })
        agentTaskRef.current = task
        try {
          workerResult = await task.promise
          workerFailure = null
          break
        } catch (reason) {
          workerFailure = reason
          agentTaskRef.current = null
          const message = reason instanceof Error ? reason.message : '工具执行失败'
          if (message.includes('取消') || attempt === 1) throw reason
          updateAssistantTaskProgress(0.32 + (subtaskIndex / subtasks.length) * 0.42, subtask.id, `${subtask.label} 首次失败，正在自动重试`)
          syncRemoteProgress('execute_tools', 'failed', `${subtask.label} 首次执行失败：${message}`)
          syncRemoteProgress('execute_tools', 'running', `正在重试子任务：${subtask.label}`)
        }
        }
        if (workerFailure || !workerResult) throw workerFailure instanceof Error ? workerFailure : new Error(`${subtask.label} 执行失败`)
        agentTaskRef.current = null
        subtaskResults.push(workerResult)
        updateAssistantTaskProgress(0.32 + ((subtaskIndex + 1) / subtasks.length) * 0.42, subtask.id, `${subtask.label} 已完成`)
      }
      const result = mergeAssistantAnalyses(subtaskResults.map((entry) => entry.analysis), activeObjective, activeMode)
      const proposal = activeMode === 'plan_design'
        ? subtaskResults[subtaskResults.length - 1]?.patch ?? null
        : subtaskResults.find((entry) => entry.patch)?.patch ?? null
      agentTaskRef.current = null
      updateAssistantTaskProgress(activeMode === 'plan_design' ? 0.76 : 0.82, subtasks[subtasks.length - 1].id, activeMode === 'plan_design' ? '正在生成受控方案草案' : '正在整理确定性诊断结果')
      syncRemoteProgress('execute_tools', 'completed', '只读结构工具已完成')
      syncRemoteProgress('synthesize', 'running', '正在汇总本地确定性分析结果')
      remember(result)
      if (currentProject) rememberAssistantProjectRun({ projectId: currentProject.id, projectName: currentProject.name, result })
      updateAssistantTaskProgress(0.95, subtasks[subtasks.length - 1].id, '正在汇总证据与下一步')
      updateAssistantTaskState('completed', `Agent 任务完成：${result.headline}`, result.summary)
      syncRemoteProgress('synthesize', 'completed', '分析结论与证据已汇总')
      if (activeMode === 'plan_design') syncRemoteProgress('validate_patch', 'running', '正在校验方案草案')
      dispatchAssistantState({ phase: 'speaking', message: `Agent 任务完成：${result.headline}` })
      setBusy(false)
      if (!currentProject) {
        setError('本次已完成浏览器本地诊断，但当前没有正式项目，结果未写入服务端。')
        return
      }
      setAuditStatus('syncing')
      void (async () => {
        try {
          const created = await remoteRunPromise
          if (!created) throw new Error('后台 Agent 运行未创建')
          remoteRunId = created.id
          remoteRunIdRef.current = created.id
          await remoteProgressQueue
          if (auditSeq !== auditSeqRef.current) return
          let completed: RemoteRun | null = null
          let completionError: unknown = null
          for (let attempt = 0; attempt < 2; attempt += 1) {
            try {
              completed = await agentApi.analyzeRun(created.id, result, proposal)
              completionError = null
              break
            } catch (reason) {
              completionError = reason
              if (attempt === 0) {
                setAuditError('后台结果回传暂时失败，正在进行一次受控重试')
                await new Promise((resolve) => globalThis.setTimeout(resolve, 450))
              }
            }
          }
          if (!completed) throw completionError instanceof Error ? completionError : new Error('后台 Agent 结果回传失败')
          if (auditSeq !== auditSeqRef.current) return
          setRemoteRun(completed)
          const persisted = completed.patches[completed.patches.length - 1]
          if (proposal && persisted) setPatch(remotePatchToLocal(persisted, proposal))
          setAuditStatus('completed')
        } catch (reason) {
          if (auditSeq !== auditSeqRef.current) return
          setAuditStatus('failed')
          setAuditError(reason instanceof Error ? reason.message : '后台同步审计失败；本地诊断结果已保留')
        }
      })()
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Agent 暂时无法执行'
      syncRemoteProgress('execute_tools', message.includes('取消') ? 'cancelled' : 'failed', message)
      updateAssistantTaskState(message.includes('取消') ? 'cancelled' : 'failed', message)
      agentTaskRef.current = null
      setError(message)
    }
    finally { setBusy(false) }
  }
  const startAnalysis = () => { void runAnalysis() }
  const resumeRecoverableRun = () => {
    if (!recoverableRun || busy) return
    const run = recoverableRun
    setObjective(run.objective)
    setMode(run.mode === 'plan_design' ? 'plan_design' : 'diagnose')
    setRecoverableRun(null)
    void runAnalysis(run)
  }
  const resumeRecoverableRunOnServer = async () => {
    if (!recoverableRun || busy) return
    const run = recoverableRun
    setRecoverableRun(null)
    setServerReport(null)
    setAuditStatus('syncing')
    try {
      const queued = await agentApi.orchestrateRun(run.id)
      setRemoteRun(queued)
      const refresh = () => { void agentApi.getReport(run.id).then(setServerReport).catch(() => undefined) }
      refresh()
      serverRecoveryStopRef.current?.()
      serverRecoveryStopRef.current = subscribeAgent(run.id, refresh)
    } catch (reason) {
      setAuditStatus('failed')
      setAuditError(reason instanceof Error ? reason.message : '服务端续跑请求失败')
    }
  }
  const locate = (finding: AgentFinding) => {
    const id = finding.objectIds[0] ?? finding.evidence.find((entry) => entry.objectIds?.[0])?.objectIds?.[0]
    if (id) { select(id); onLocate?.() }
  }
  const doPatrol = async (manual: boolean) => {
    if (contextRef.current.objects.length === 0) return
    if (patrolRunningRef.current) {
      if (manual) setError('自动巡检正在运行，请稍候')
      return
    }
    patrolRunningRef.current = true
    updateAssistantTaskProgress(0.12, 'observe', '正在读取当前运行信号')
    const request = runAutopilotCycleInWorker({
      context: contextRef.current,
      baseline: autopilotRef.current.baseline,
      previousSamples: autopilotRef.current.samples,
      options: { cycleIntervalSec: PATROL_INTERVAL_SEC },
    })
    patrolWorkerRef.current = request
    try {
      updateAssistantTaskProgress(0.42, 'sample', '正在采集只读证据窗口')
      const result = await request.promise
      updateAssistantTaskProgress(0.78, 'analyze', '正在对比基线并分析劣化')
      autopilotRef.current = { baseline: result.baseline, samples: result.samples }
      remember(result.analysis)
      setMode('diagnose')
      setAutopilotNote(result.summaryText)
      updateAssistantTaskProgress(0.95, 'report', '正在汇总巡检结论')
      updateAssistantTaskState('completed', `自动巡检完成：${result.summaryText}`, result.summaryText)
      dispatchAssistantState({ phase: 'speaking', message: `自动巡检完成：${result.summaryText}` })
      if (!manual && result.degraded) {
        result.analysis.findings.filter((finding) => finding.code.startsWith('autopilot_')).forEach((finding) => {
          recordAssistantProactiveEvent({ fingerprint: 'autopilot:degraded', source: autopilotSource(finding.code), severity: 'warning', message: finding.title })
        })
        dispatchAssistantNotice({
          severity: 'warning',
          message: `主动巡检发现运行劣化：${result.summaryText}`,
          openPanel: 'agent-diagnosis',
          dedupeKey: 'autopilot:degraded',
          source: manual ? 'manual-patrol' : 'scheduled-patrol',
        })
      } else if (!result.degraded) {
        void resolveAssistantNotice('autopilot:degraded')
      }
      const seq = ++narrationSeqRef.current
      void narratePatrolReport(result, (question, reportContext) => askAssistant(question, reportContext).then((reply) => reply.answer))
        .then((narration) => { if (narrationSeqRef.current === seq) setPatrolReport(narration.text) })
      if (manual && result.degraded) setObjective('自动巡检发现运行劣化：请生成消除瓶颈与背压的受控修复方案。')
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : '自动巡检失败'
      updateAssistantTaskState(message === '自动巡检已取消' ? 'cancelled' : 'failed', message)
      if ((reason instanceof Error ? reason.message : '') !== '自动巡检已取消') {
        setError(message)
      }
    } finally {
      if (patrolWorkerRef.current === request) patrolWorkerRef.current = null
      patrolRunningRef.current = false
    }
  }
  useEffect(() => {
    if (!patrolOn) return
    let cancelled = false
    const tick = async () => {
      if (cancelled) return
      await doPatrol(false)
      if (!cancelled) patrolTimerRef.current = setTimeout(() => void tick(), PATROL_INTERVAL_SEC * 1000)
    }
    void tick()
    return () => {
      cancelled = true
      if (patrolTimerRef.current) clearTimeout(patrolTimerRef.current)
      patrolWorkerRef.current?.cancel()
    }
  }, [patrolOn])
  useEffect(() => {
    const onAssistantTaskCancel = () => {
      agentTaskRef.current?.cancel()
      patrolWorkerRef.current?.cancel()
      remoteCancelRequestedRef.current = true
      const runId = remoteRunIdRef.current ?? remoteRun?.id
      if (runId) void agentApi.cancelRun(runId)
    }
    window.addEventListener('forgemind:assistant-task-cancel', onAssistantTaskCancel)
    return () => window.removeEventListener('forgemind:assistant-task-cancel', onAssistantTaskCancel)
  }, [remoteRun])
  const runAutopilot = () => {
    if (busy) return
    if (objects.length === 0) { setError('当前工厂没有对象，请先放置设备再巡检'); return }
    setError(null)
    updateAssistantTaskState('running', '正在执行只读自动巡检')
    void doPatrol(true)
  }
  const assistantTaskRef = useRef<(command: AssistantAgentTaskCommand) => void>(() => undefined)
  assistantTaskRef.current = (command) => {
    if (command.kind === 'autopilot') {
      runAutopilot()
      return
    }
    setObjective(command.objective)
    setMode(command.mode)
    window.setTimeout(() => void startAnalysis(), 0)
  }
  useEffect(() => {
    const onAssistantAgentTask = (event: Event) => {
      const command = (event as CustomEvent<AssistantAgentTaskCommand>).detail
      if (command) assistantTaskRef.current(command)
    }
    window.addEventListener('forgemind:assistant-agent-task', onAssistantAgentTask)
    const pending = consumeAssistantAgentTask()
    if (pending) assistantTaskRef.current(pending)
    return () => window.removeEventListener('forgemind:assistant-agent-task', onAssistantAgentTask)
  }, [])
  const proposePatch = async () => {
    if (!analysis || !currentProject || busy) return
    setBusy(true); setError(null); setMode('plan_design')
    try {
      const task = runAgentInWorker({ objective, context, mode: 'plan_design', buildPatch: true, analysis })
      agentTaskRef.current = task
      const { analysis: result, patch: proposal } = await task.promise
      agentTaskRef.current = null
      if (!proposal) throw new Error('当前结论没有可安全自动执行的修改。')
      const created = await agentApi.createRun(currentProject.id, objective, 'plan_design', useForgeMindStore.getState().exportSave())
      const completed = await agentApi.analyzeRun(created.id, result, proposal)
      setRemoteRun(completed); remember(result)
      const persisted = completed.patches[completed.patches.length - 1]
      if (!persisted) throw new Error('服务端没有持久化变更方案。')
      setPatch(remotePatchToLocal(persisted, proposal))
    } catch (reason) { agentTaskRef.current = null; setError(reason instanceof Error ? reason.message : '方案生成失败') }
    finally { setBusy(false) }
  }
  const approveAndApply = async () => {
    if (!patch || patchBusy) return
    setPatchBusy(true); setError(null)
    try {
      const beforeMetrics = analysis?.metrics ?? null
      const activeRemoteRun = remoteRun
      const approved = { ...patch, status: 'approved' as const }
      const errors = validateFactoryPatch(approved, context)
      if (errors.length) throw new Error(errors[0])
      await agentApi.approvePatch(patch.id)
      const persisted = await agentApi.applyPatch(patch.id)
      const save = persisted.applied_save ?? applyFactoryPatchToSave(useForgeMindStore.getState().exportSave(), approved)
      useForgeMindStore.getState().importSave(save)
      setPatch(remotePatchToLocal(persisted, approved))
      const refreshedTask = runAgentInWorker({ objective, context: {
        objects: save.objects,
        recipes: save.recipes,
        items: save.items,
        snapshot: useForgeMindStore.getState().simSnapshot,
        floorCount: save.floorCount,
      }, mode: 'diagnose', buildPatch: false })
      agentTaskRef.current = refreshedTask
      const { analysis: refreshed } = await refreshedTask.promise
      agentTaskRef.current = null
      setAnalysis(refreshed)
      if (beforeMetrics) {
        const review = createPostApplyReview(beforeMetrics, refreshed.metrics)
        setPostApplyReview(review)
        updateAssistantTaskState('completed', `应用后复核完成：${reviewSummary(review)}`, reviewSummary(review))
        dispatchAssistantState({ phase: 'speaking', message: `应用后复核完成：${reviewSummary(review)}` })
        if (activeRemoteRun) {
          void agentApi.appendEvent(activeRemoteRun.id, 'post_apply_review', {
            source: 'browser_deterministic_evidence',
            before: beforeMetrics,
            after: refreshed.metrics,
            delta: review.delta,
            summary: reviewSummary(review),
          }).catch(() => undefined)
        }
      }
      if (activeRemoteRun) setRemoteRun(await agentApi.getRun(activeRemoteRun.id))
    } catch (reason) { agentTaskRef.current = null; setError(reason instanceof Error ? reason.message : 'Patch 应用失败') }
    finally { setPatchBusy(false) }
  }
  const compareBranches = async () => {
    if (!patch) return
    setPatchBusy(true); setError(null)
    try {
      const candidate = patch.status === 'draft' ? { ...patch, status: 'approved' as const } : patch
      const errors = validateFactoryPatch(candidate, context)
      if (errors.length) throw new Error(errors[0])
      setBranch(await compareAgentBranches(candidate, context, analysis?.goal.timeHorizonSec ?? 60))
    } catch (reason) { setError(reason instanceof Error ? reason.message : '仿真分支运行失败') }
    finally { setPatchBusy(false) }
  }
  const rejectPatch = async () => {
    if (!patch) return
    try {
      const persisted = await agentApi.rejectPatch(patch.id, rejectionReason || '用户拒绝当前方案')
      setPatch(remotePatchToLocal(persisted, patch))
    } catch (reason) { setError(reason instanceof Error ? reason.message : '拒绝方案失败') }
  }
  const replanPatch = async () => {
    if (!rejectionReason.trim()) { setError('请先填写拒绝或冲突原因'); return }
    const nextObjective = `${objective}\n必须满足用户补充约束：${rejectionReason.trim()}`
    setObjective(nextObjective); setBusy(true)
    try {
      if (!patch) return
      const next = await agentApi.replanPatch(patch.id, rejectionReason.trim())
      const task = runAgentInWorker({ objective: nextObjective, context, mode: 'plan_design', buildPatch: true })
      agentTaskRef.current = task
      const { analysis: result, patch: proposal } = await task.promise
      agentTaskRef.current = null
      const completed = await agentApi.analyzeRun(next.id, result, proposal)
      setRemoteRun(completed); remember(result)
      const persisted = completed.patches[completed.patches.length - 1]
      setPatch(proposal && persisted ? remotePatchToLocal(persisted, proposal) : proposal)
      setRejectionReason('')
    } catch (reason) { agentTaskRef.current = null; setError(reason instanceof Error ? reason.message : '重新规划失败') }
    finally { setBusy(false) }
  }
  const rollbackPatch = async () => {
    if (!patch || patch.status !== 'applied') return
    try {
      if (!currentProject) throw new Error('当前项目不存在')
      const persisted = await agentApi.rollbackPatch(patch.id)
      const detail = await fetchFactoryProject(currentProject.id)
      useForgeMindStore.getState().importSave(detail.save as FactorySave)
      setPatch(remotePatchToLocal(persisted, patch))
    } catch (reason) { setError(reason instanceof Error ? reason.message : '回滚失败') }
  }

  const steps = planAssistantSubtasks(objective, mode).map((subtask) => subtask.label)
  const finished = Object.values(snapshot.stats.produced).reduce((sum, value) => sum + value, 0)
  return <section className="fc-agent-window" aria-label="ForgeCore Factory Agent"><div className="fc-agent-scroll page page--agent">
    <header className="page-heading agent-heading"><div><h1>Factory Agent</h1></div><div className="page-heading__actions">{onEnterGenerative && <button className="agent-mode-switch" disabled={busy} onClick={onEnterGenerative}><Workflow /><span>生成式工厂</span><small>黛玉规划</small></button>}{auditStatus !== 'idle' && <span className={`agent-audit-status agent-audit-status--${auditStatus}`}><AuditStatusIcon status={auditStatus} />{auditStatusLabel(auditStatus)}</span>}<span className={`agent-status agent-status--${status}`}><StatusIcon status={status} />{statusLabel(status)}</span>{busy && <button className="button button--secondary" onClick={() => { remoteCancelRequestedRef.current = true; agentTaskRef.current?.cancel(); const runId = remoteRunIdRef.current ?? remoteRun?.id; if (runId) void agentApi.cancelRun(runId); setBusy(false) }}><Square />停止</button>}</div></header>
    <section className="agent-command"><Bot className="agent-command__icon" /><textarea value={objective} maxLength={2000} onChange={(event) => setObjective(event.target.value)} aria-label="工厂分析目标" /><div className="agent-command__modes"><button className={`agent-command__mode ${mode === 'diagnose' ? 'is-active' : ''}`} disabled={busy} onClick={() => setMode('diagnose')}><ShieldCheck />只读分析</button><button className={`agent-command__mode ${mode === 'plan_design' ? 'is-active' : ''}`} disabled={busy} onClick={() => setMode('plan_design')}><FileDiff />方案设计</button></div><button className="agent-command__mode agent-command__patrol" disabled={busy || objects.length === 0} onClick={runAutopilot} title="运行一次只读证据副本，记录指标时序并对比基线"><Activity />自动巡检</button><button className={`agent-command__mode agent-command__patrol ${patrolOn ? 'is-active' : ''}`} disabled={objects.length === 0} onClick={() => setPatrolOn((value) => !value)} title={`每 ${PATROL_INTERVAL_SEC} 秒自动运行一次只读巡检`}><RefreshCw className={patrolOn ? 'fc-spin' : undefined} />定时巡检</button><button className="agent-command__run" disabled={busy || !objective.trim()} onClick={startAnalysis}>{busy ? <LoaderCircle className="fc-spin" /> : <Play />}<span>{busy ? '分析中' : mode === 'plan_design' ? '生成方案' : '开始分析'}</span></button></section>
    {recoverableRun && !busy && <div className="agent-audit-note"><RefreshCw /><strong>发现未完成任务</strong><span>服务端保留了“{recoverableRun.objective.slice(0, 80)}”的步骤记录。</span><button className="button button--secondary" onClick={resumeRecoverableRun}>浏览器恢复</button>{recoverableRun.mode === 'read_only' && <button className="button button--secondary" onClick={() => void resumeRecoverableRunOnServer()}>服务端续跑</button>}</div>}
    {serverReport && <div className="agent-audit-note"><CheckCircle2 /><strong>服务端编排报告</strong><span>{serverReport.summary || '只读结构分析已完成'}</span><small>状态：{serverReport.status} · 下一步：{serverReport.next_action} · 来源：服务端确定性结构证据</small></div>}
    {focusedTask && <div className="agent-task-focus"><strong>BT 正在查看任务</strong><span>{focusedTask.objective ?? focusedTask.kind}</span><small>{focusedTask.status} · {focusedTask.progress === undefined ? '步骤状态已保留' : `${Math.round(focusedTask.progress * 100)}%`}</small></div>}
    {error && <div className="agent-error"><AlertTriangle /><strong>{error}</strong></div>}
    {auditError && <div className="agent-audit-note"><AlertTriangle /><strong>后台同步审计</strong><span>{auditError}；本地诊断结果不受影响。</span></div>}
    {autopilotNote && !error && <div className="agent-autopilot-note"><Activity /><strong>自动巡检</strong><span>{autopilotNote}</span></div>}
    {patrolReport && !error && <div className="agent-autopilot-report">{patrolReport}</div>}
    {analysis && <section className="agent-goal-summary"><strong>{goalIntentLabel(analysis.goal.intent)}</strong><span>{goalStatusLabel(analysis.goal.status)}</span>{analysis.goal.metrics.targetThroughputPerHour && <span>吞吐 ≥ {analysis.goal.metrics.targetThroughputPerHour} 件/小时</span>}{Object.entries(analysis.goal.hardConstraints).map(([key, value]) => <span key={key}>{goalConstraintLabel(key)} {String(value)}</span>)}<span>{formatDuration(analysis.goal.timeHorizonSec)} 窗口</span><span>确定性分析</span></section>}
    {analysis || busy ? <motion.div className="agent-workspace" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .6, ease }}>
      <aside className="agent-plan"><SectionTitle label="执行计划" value={`${remoteRun?.steps.filter((step) => step.status === 'completed').length ?? (analysis ? steps.length : 0)}/${remoteRun?.steps.length ?? steps.length}`} /><ol className="agent-steps">{(remoteRun?.steps ?? steps.map((title, index) => ({ id: title, title, status: analysis ? 'completed' : index === 0 ? 'running' : 'pending', detail: '', key: title, position: index }))).map((step) => <li key={step.id} className={step.status === 'completed' ? 'is-completed' : step.status === 'running' ? 'is-running' : ''}><span>{step.status === 'completed' ? <Check /> : step.status === 'running' ? <LoaderCircle className="fc-spin" /> : <Circle />}</span><div><strong>{step.title}</strong><p>{step.status === 'completed' ? '已完成并持久化' : step.status === 'running' ? '正在执行' : '等待执行'}</p></div></li>)}</ol><SectionTitle label="工具活动" value={String(remoteRun?.tool_calls.length ?? analysis?.toolCalls.length ?? 0)} /><ol className="agent-tools">{remoteRun ? remoteRun.tool_calls.map((tool) => <li key={tool.id}><Cpu /><span>{toolLabel(tool.tool_name)}</span><strong>{tool.duration_ms ?? 0}ms</strong></li>) : analysis?.toolCalls.map((tool, index) => <li key={`${tool.name}-${index}`}><Cpu /><span>{toolLabel(tool.name)}</span><strong>0ms</strong></li>)}{!remoteRun?.tool_calls.length && !analysis?.toolCalls.length && <li className="is-empty"><Clock3 /><span>等待工具调用</span></li>}</ol></aside>
      <section className="agent-findings"><div className="agent-result-head"><div><span>诊断结果</span><h2>{analysis?.headline ?? '正在检查工厂'}</h2></div>{analysis && <strong>{analysis.confidence}% 置信度</strong>}</div>
        {patch && <article className={`agent-patch agent-patch--${patch.status}`}><div className="agent-patch__head"><div><span>方案变更</span><h3>{patchStatusLabel(patch.status)} · {riskLabel(patch.risk)}</h3><p>{patch.operations.length} 项操作 · 基线 {patch.baseVersion.slice(-8)}</p></div><FileDiff /></div><ol className="agent-patch__ops">{patch.operations.map((op) => <li key={op.id}><strong>{opKindLabel(op.kind)}</strong><span>{op.reason}</span><small>{riskLabel(patch.risk)}</small></li>)}</ol>{patch.operations.length > 0 && !['applied','rolled_back','rejected'].includes(patch.status) && <button className="agent-branch-run" disabled={patchBusy || busy} onClick={compareBranches}><Activity />{patchBusy ? '分支运行中' : '运行双分支对比'}</button>}{branch && <BranchComparison result={branch} />}<div className="agent-patch__actions">{patch.status === 'draft' && <><button className="button" onClick={approveAndApply}><Check />批准并应用</button><button className="button button--secondary" onClick={() => void rejectPatch()}><XCircle />拒绝</button></>}{patch.status === 'applied' && <button className="button button--secondary" onClick={rollbackPatch}><Undo2 />回滚</button>}</div>{patch.status === 'rejected' && <div className="agent-replan"><label>拒绝或冲突原因</label><textarea rows={3} value={rejectionReason} onChange={(event) => setRejectionReason(event.target.value)} placeholder="例如：入口区域需要留空，改到厂房右侧" /><button className="button" disabled={!rejectionReason.trim()} onClick={replanPatch}><RefreshCw />重新规划</button></div>}</article>}
        {postApplyReview && <PostApplyReviewPanel review={postApplyReview} />}
        {analysis && !patch && <button className="agent-create-patch" onClick={() => void proposePatch()}><FileDiff />根据当前结论生成修复方案</button>}
        <AnimatePresence mode="popLayout">{analysis?.findings.map((finding, index) => <motion.article className={`agent-finding agent-finding--${finding.severity}`} key={finding.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .5, delay: index * .06, ease }}><div className="agent-finding__signal"><FindingIcon severity={finding.severity} /></div><div className="agent-finding__body"><span>{categoryLabel(finding.code)}</span><h3>{finding.title}</h3><p>{finding.detail}</p><div className="agent-evidence-row">{finding.evidence.map((entry) => <span key={`${entry.label}-${entry.value}`}><small>{entry.label}</small><strong>{entry.value}</strong></span>)}</div><div className="agent-recommendation"><ArrowRight />{finding.recommendation}</div></div>{finding.objectIds.length > 0 && <button className="agent-locate" onClick={() => locate(finding)}><LocateFixed /><span>定位</span></button>}</motion.article>)}</AnimatePresence>
        {!analysis && <div className="agent-analyzing"><div className="agent-analyzing__pulse"><Bot /></div><strong>正在建立工厂证据链</strong></div>}
      </section>
      <aside className="agent-evidence"><SectionTitle label="运行证据" icon={<Gauge />} /><dl className="agent-metrics"><Metric label="当前吞吐" value={((analysis?.metrics.throughputPerHour ?? 0) / 60).toFixed(1)} unit="件/分钟" /><Metric label="在制品" value={String(analysis?.metrics.wip ?? snapshot.itemLots.length)} unit="批次" /><Metric label="仓储库存" value={String(analysis?.metrics.inventoryTotal ?? 0)} unit="件" /><Metric label="平均运输" value={(analysis?.metrics.averageTransportSec ?? 0).toFixed(1)} unit="秒/趟" /><Metric label="成品" value={String(finished)} unit="件" /><Metric label="仿真时间" value={formatDuration(snapshot.timeSec)} /></dl><SectionTitle label="工厂版本" icon={<Factory />} /><dl className="agent-facts"><Fact icon={<Factory />} label="对象" value={objects.length} /><Fact icon={<Workflow />} label="配方" value={recipes.length} /><Fact icon={<PackageOpen />} label="物品" value={items.length} /><Fact icon={<Gauge />} label="工厂图节点" value={analysis?.graph.nodes.length ?? 0} /></dl><button className="agent-rerun" disabled={busy} onClick={startAnalysis}><RefreshCw />重新分析当前版本</button></aside>
    </motion.div> : <div className="agent-empty"><div><Bot /><strong>{factoryName}</strong></div><span>生产</span><span>库存</span><span>物流</span><span>配方</span><span>设备</span></div>}
    {history.length > 0 && <section className="agent-history"><SectionTitle label="历史运行" value={String(history.length)} /><div>{history.slice(0, 6).map((item) => <button key={item.runId} className={item.runId === analysis?.runId ? 'is-active' : ''} onClick={() => { setAnalysis(item); setObjective(item.goal.objective); setMode(item.mode); setPatch(null); setBranch(null) }}><StatusIcon status="completed" /><span><strong>{item.summary || item.headline}</strong><small>{formatDate(item.createdAt)} · {item.mode === 'plan_design' ? '方案设计' : '只读分析'}</small></span><ArrowRight /></button>)}</div></section>}
    <footer className="fc-agent-source">FORGECORE AGENT PAGE · LOCAL FORGEMIND FACTORY ADAPTER · {version.slice(-8)}</footer>
  </div></section>
}

function BranchComparison({ result }: { result: BranchSimulationResult }) { const rows: Array<[string,number,number,number]> = [['吞吐/小时',result.baseline.throughputPerHour,result.proposal.throughputPerHour,result.delta.throughputPerHour],['累计成品',result.baseline.produced,result.proposal.produced,result.delta.produced],['在制品',result.baseline.wip,result.proposal.wip,result.delta.wip],['阻塞对象',result.baseline.blockedObjects,result.proposal.blockedObjects,result.delta.blockedObjects],['平均运输秒',result.baseline.averageTransportSec,result.proposal.averageTransportSec,result.delta.averageTransportSec],['库存总量',result.baseline.inventoryTotal,result.proposal.inventoryTotal,result.delta.inventoryTotal]]; return <section className="agent-branch-result"><header><div><span>SIMULATION BRANCH</span><strong>{({apply:'建议应用',iterate:'建议迭代',discard:'建议放弃'} as const)[result.recommendation]}</strong></div><b>{result.delta.throughputPerHour.toFixed(1)}</b></header><div className="agent-branch-table"><span>指标</span><span>当前</span><span>候选</span><span>差异</span>{rows.map(([label,a,b,d]) => <div key={label}><strong>{label}</strong><span>{a.toFixed(1)}</span><span>{b.toFixed(1)}</span><b>{signed(d)}</b></div>)}</div><small>{result.explanation}</small></section> }
function PostApplyReviewPanel({ review }: { review: PostApplyReview }) {
  const rows: Array<[string, keyof PostApplyReview['delta'], number, number, string]> = [
    ['吞吐/小时', 'throughputPerHour', review.before.throughputPerHour, review.after.throughputPerHour, '件/小时'],
    ['利用率', 'utilization', review.before.utilization, review.after.utilization, '%'],
    ['在制品', 'wip', review.before.wip, review.after.wip, '批次'],
    ['阻塞对象', 'blockedObjects', review.before.blockedObjects, review.after.blockedObjects, '个'],
    ['累计成品', 'produced', review.before.produced, review.after.produced, '件'],
    ['平均运输', 'averageTransportSec', review.before.averageTransportSec, review.after.averageTransportSec, '秒/趟'],
    ['库存总量', 'inventoryTotal', review.before.inventoryTotal, review.after.inventoryTotal, '件'],
  ]
  return <section className="agent-branch-result agent-post-apply-review"><header><div><span>POST-APPLY REVIEW</span><strong>应用后确定性复核</strong></div><b>{signed(review.delta.throughputPerHour)}</b></header><div className="agent-branch-table"><span>指标</span><span>应用前</span><span>应用后</span><span>差异</span>{rows.map(([label, key, before, after, unit]) => <div key={key}><strong>{label}</strong><span>{before.toFixed(1)}{unit}</span><span>{after.toFixed(1)}{unit}</span><b>{signed(review.delta[key])}</b></div>)}</div><small>{reviewSummary(review)} 数据来自应用后的浏览器确定性复核，并已写入 Agent 事件链。</small></section>
}

function createPostApplyReview(before: AgentMetrics, after: AgentMetrics): PostApplyReview {
  const keys: Array<keyof PostApplyReview['delta']> = ['throughputPerHour', 'utilization', 'wip', 'blockedObjects', 'produced', 'averageTransportSec', 'inventoryTotal']
  const delta = Object.fromEntries(keys.map((key) => [key, after[key] - before[key]])) as PostApplyReview['delta']
  return { before, after, delta }
}

function reviewSummary(review: PostApplyReview): string {
  const throughput = signed(review.delta.throughputPerHour)
  const blocked = signed(review.delta.blockedObjects)
  return `应用后复核完成：吞吐差异 ${throughput}/小时，阻塞对象差异 ${blocked}`
}
function SectionTitle({ label, value, icon }: { label:string; value?:string; icon?:ReactNode }) { return <div className="agent-section-title"><span>{label}</span>{icon ?? <strong>{value}</strong>}</div> }
function StatusIcon({ status }: { status:string }) { if(status==='completed')return <MorphingIcon icon={CircleCheckData}/>; if(status==='rejected'||status==='failed')return <MorphingIcon icon={CircleXData}/>; if(status==='awaiting_approval')return <MorphingIcon icon={FileDiffData}/>; if(status==='executing_tools')return <MorphingIcon icon={LoaderCircleData}/>; return <MorphingIcon icon={CircleData}/> }
function AuditStatusIcon({ status }: { status:string }) { if(status==='completed')return <MorphingIcon icon={CircleCheckData}/>; if(status==='failed')return <MorphingIcon icon={CircleXData}/>; return <MorphingIcon icon={ActivityData}/> }
function FindingIcon({ severity }: Pick<AgentFinding,'severity'>) { return severity==='success'?<CheckCircle2/>:severity==='critical'||severity==='warning'?<AlertTriangle/>:<Gauge/> }
function Metric({label,value,unit}:{label:string;value:string;unit?:string}) { return <div><dt>{label}</dt><dd>{value}<small>{unit}</small></dd></div> }
function Fact({icon,label,value}:{icon:ReactNode;label:string;value:number}) { return <div><dt>{icon}{label}</dt><dd>{value}</dd></div> }
const map=(value:string,values:Record<string,string>)=>values[value]??value
function statusLabel(v:string){return map(v,{created:'准备就绪',executing_tools:'分析中',syncing:'同步审计',awaiting_approval:'待审批',completed:'分析完成',rejected:'已拒绝'})}
function auditStatusLabel(v:string){return map(v,{syncing:'后台审计中',completed:'审计已同步',failed:'审计同步失败'})}
function categoryLabel(v:string){if(/inventory|stock|supply/i.test(v))return'库存';if(/route|logistic|agv|drone|conveyor/i.test(v))return'物流';if(/recipe|machine|capacity|throughput/i.test(v))return'生产';return'系统'}
function toolLabel(v:string){return map(v,{explain_constraint:'编译目标约束',get_factory_snapshot:'读取工厂快照',get_factory_graph:'构建依赖图',get_simulation_metrics:'读取仿真指标',query_event_timeline:'读取事件时间线',inspect_inventory:'检查库存',inspect_machine:'检查机器',inspect_recipe_chain:'检查配方链',inspect_conveyors:'检查传送带',inspect_logistics:'检查物流',calculate_capacity:'计算理论产能',inspect_bottlenecks:'诊断瓶颈'})}
function goalIntentLabel(v:string){return map(v,{diagnose:'诊断',explain:'解释',optimize:'优化',monitor:'监控'})}
function goalStatusLabel(v:string){return map(v,{compiled:'目标就绪',needs_input:'待澄清',conflicted:'约束冲突'})}
function goalConstraintLabel(v:string){return map(v,{floorWidth:'场地宽度',floorDepth:'场地深度',machineLimit:'机器上限',agvLimit:'AGV 上限',droneLimit:'无人机上限',maxChanges:'最大变更',maxEnergyKw:'功率上限',floorId:'目标楼层',preserveExistingAssets:'保留现有资产'})}
function patchStatusLabel(v:string){return map(v,{draft:'待审批',approved:'已批准',rejected:'已拒绝',applied:'已应用',rolled_back:'已回滚'})}
function riskLabel(v:string){return map(v,{low:'低风险',medium:'中风险',high:'高风险'})}
function opKindLabel(v:string){return map(v,{move_object:'移动对象',update_config:'更新配置',add_object:'新增对象',remove_object:'删除对象',adjust_inventory:'调整库存'})}
function signed(v:number){return`${v>0?'+':''}${v.toFixed(1)}`}
function formatDuration(seconds:number){const m=Math.floor(seconds/60),s=Math.floor(seconds%60);return`${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`}
function formatDate(value:string){return new Intl.DateTimeFormat('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(value))}
