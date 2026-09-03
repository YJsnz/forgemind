import type { Item, Recipe } from './item'
import type { FactoryFloorId, FactoryObject } from './types'
import type { SimulationSnapshot } from './simulation'

export type AgentMode = 'diagnose' | 'plan_design'
export type AgentSeverity = 'success' | 'info' | 'warning' | 'critical'
export type AgentRunStatus = 'completed' | 'failed' | 'cancelled'
export type FactoryPatchStatus = 'draft' | 'approved' | 'rejected' | 'applied' | 'rolled_back'

export interface AgentFactoryContext {
  objects: FactoryObject[]
  recipes: Recipe[]
  items: Item[]
  snapshot: SimulationSnapshot
  floorCount: number
}

export interface FactoryGoal {
  schemaVersion: 1
  objective: string
  intent: 'diagnose' | 'explain' | 'optimize' | 'monitor'
  mode: AgentMode
  status: 'compiled' | 'needs_input' | 'conflicted'
  baselineVersion: string
  metrics: {
    targetThroughputPerHour?: number
    targetItemId?: string
    targetItemName?: string
    targetUtilization?: number
  }
  hardConstraints: Record<string, number | string | boolean>
  softConstraints: string[]
  timeHorizonSec: number
  allowedActions: string[]
  assumptions: string[]
  missingConstraints: string[]
  conflicts: string[]
}

export interface FactoryGraphNode {
  id: string
  kind: 'object' | 'recipe' | 'item'
  label: string
  objectType?: FactoryObject['type']
  floorId?: FactoryFloorId
  status?: 'ok' | 'warning' | 'invalid'
}

export interface FactoryGraphEdge {
  id: string
  from: string
  to: string
  kind: 'recipe_consumes' | 'recipe_produces' | 'machine_binding' | 'conveyor_transport' | 'dependency' | 'inventory_holds' | 'vehicle_transport'
  label?: string
}

export interface FactoryGraph {
  schemaVersion: 1
  baselineVersion: string
  nodes: FactoryGraphNode[]
  edges: FactoryGraphEdge[]
  invalidReferences: Array<{ code: string; message: string; objectIds: string[] }>
}

export interface AgentEvidence {
  kind: 'metric' | 'graph' | 'runtime' | 'inventory' | 'object' | 'timeline'
  label: string
  value: string
  objectIds?: string[]
}

export interface AgentFinding {
  id: string
  severity: AgentSeverity
  code: string
  title: string
  detail: string
  impact: string
  recommendation: string
  objectIds: string[]
  evidence: AgentEvidence[]
}

export interface AgentMetrics {
  timeSec: number
  throughputPerHour: number
  targetThroughputPerHour: number | null
  utilization: number
  wip: number
  activeMachines: number
  machineCount: number
  blockedObjects: number
  waitingVehicles: number
  consumed: number
  produced: number
  averageTransportSec: number
  inventoryTotal: number
}

export interface AgentToolCall {
  name: string
  status: 'completed' | 'skipped'
  summary: string
}

export interface AgentAnalysisResult {
  runId: string
  createdAt: string
  status: AgentRunStatus
  mode: AgentMode
  goal: FactoryGoal
  graph: FactoryGraph
  metrics: AgentMetrics
  findings: AgentFinding[]
  toolCalls: AgentToolCall[]
  headline: string
  confidence: number
  summary: string
}

export type FactoryPatchOperation =
  | { id: string; kind: 'update_config'; objectId: string; path: 'recipeId' | 'itemId' | 'agvProgram' | 'stationProgram' | 'storageConfig' | 'rotation' | 'portConfig' | 'displayName'; value: unknown; reason: string }
  | { id: string; kind: 'move_object'; objectId: string; target: { x: number; z: number }; reason: string }
  | { id: string; kind: 'add_object'; object: FactoryObject; reason: string }
  | { id: string; kind: 'remove_object'; objectId: string; reason: string }
  | { id: string; kind: 'adjust_inventory'; objectId: string; itemId: string; quantity: number; reason: string }

export interface FactoryPatch {
  id: string
  status: FactoryPatchStatus
  baseVersion: string
  createdAt: string
  operations: FactoryPatchOperation[]
  inverseOperations: FactoryPatchOperation[]
  preconditions: string[]
  diffSummary: string[]
  risk: 'low' | 'medium' | 'high'
  sourceFindingIds: string[]
}

export interface BranchSimulationResult {
  baseline: AgentMetrics
  proposal: AgentMetrics
  delta: {
    throughputPerHour: number
    utilization: number
    wip: number
    blockedObjects: number
    produced: number
    averageTransportSec: number
    inventoryTotal: number
  }
  recommendation: 'apply' | 'iterate' | 'discard'
  explanation: string
}
