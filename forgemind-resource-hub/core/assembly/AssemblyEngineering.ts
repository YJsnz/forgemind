import type { UUID } from "../cad/CadTypes.ts";
import type { AssemblyDocument, AssemblyMate, AssemblyRuntimeState } from "./AssemblyTypes.ts";

export type AssemblyEngineeringSeverity = "error" | "warning" | "info";

export interface AssemblyEngineeringIssue {
  code: string;
  severity: AssemblyEngineeringSeverity;
  message: string;
  componentIds: UUID[];
  mateIds: UUID[];
}

export interface AssemblyConnectionGroup {
  id: string;
  componentIds: UUID[];
  enabledMateCount: number;
  anchored: boolean;
}

export interface AssemblyBomRow {
  definitionId: UUID;
  definitionName: string;
  instanceCount: number;
  visibleCount: number;
  componentIds: UUID[];
}

export interface AssemblyEngineeringReport {
  ready: boolean;
  issues: AssemblyEngineeringIssue[];
  groups: AssemblyConnectionGroup[];
  bom: AssemblyBomRow[];
  summary: {
    componentCount: number;
    mateCount: number;
    enabledMateCount: number;
    groundedCount: number;
    hiddenCount: number;
    unresolvedDof: number;
  };
}

const mateComponentIds = (mate: AssemblyMate): UUID[] => mate.type === "fixed" ? [mate.componentId] : [mate.a.instanceId, mate.b.instanceId];
const matePairKey = (mate: AssemblyMate): string => {
  if (mate.type === "fixed") return `fixed:${mate.componentId}`;
  return `${mate.type}:${[mate.a.instanceId, mate.b.instanceId].sort().join("|")}`;
};

/** Derived engineering state. It is intentionally excluded from persistence and history. */
export const analyzeAssemblyEngineering = (
  document: AssemblyDocument,
  runtime?: Pick<AssemblyRuntimeState, "status" | "dof" | "diagnostics">,
  definitionNames: ReadonlyMap<UUID, string> = new Map(),
): AssemblyEngineeringReport => {
  const issues: AssemblyEngineeringIssue[] = [];
  const neighbors = new Map<UUID, Set<UUID>>(document.componentOrder.map((id) => [id, new Set()]));
  const anchored = new Set(document.componentOrder.filter((id) => document.components[id]?.grounded));
  const enabledMates = document.mateOrder.map((id) => document.mates[id]).filter((mate): mate is AssemblyMate => Boolean(mate?.enabled));
  const pairOwners = new Map<string, UUID>();

  for (const mate of enabledMates) {
    const ids = mateComponentIds(mate);
    if (mate.type === "fixed") anchored.add(mate.componentId);
    else { neighbors.get(ids[0])?.add(ids[1]); neighbors.get(ids[1])?.add(ids[0]); }
    const pairKey = matePairKey(mate), existing = pairOwners.get(pairKey);
    if (existing) issues.push({ code: "DUPLICATE_MATE_PAIR", severity: "warning", message: `配合“${mate.name}”与“${document.mates[existing]?.name ?? existing}”作用于同一组件对，请确认是否重复。`, componentIds: ids, mateIds: [existing, mate.id] });
    else pairOwners.set(pairKey, mate.id);
    if (ids.some((id) => document.components[id] && !document.components[id].visible)) issues.push({ code: "MATE_USES_HIDDEN_COMPONENT", severity: "info", message: `配合“${mate.name}”引用了隐藏组件，求解仍会生效。`, componentIds: ids, mateIds: [mate.id] });
  }

  const visited = new Set<UUID>(), groups: AssemblyConnectionGroup[] = [];
  for (const start of document.componentOrder) {
    if (visited.has(start)) continue;
    const queue = [start], componentIds: UUID[] = []; visited.add(start);
    while (queue.length) { const id = queue.shift()!; componentIds.push(id); for (const next of neighbors.get(id) ?? []) if (!visited.has(next)) { visited.add(next); queue.push(next); } }
    const memberSet = new Set(componentIds);
    groups.push({ id: `Group${groups.length + 1}`, componentIds, anchored: componentIds.some((id) => anchored.has(id)), enabledMateCount: enabledMates.filter((mate) => mateComponentIds(mate).every((id) => memberSet.has(id))).length });
  }

  if (!document.componentOrder.length) issues.push({ code: "ASSEMBLY_EMPTY", severity: "warning", message: "装配中还没有组件。", componentIds: [], mateIds: [] });
  else if (!anchored.size) issues.push({ code: "ASSEMBLY_NOT_ANCHORED", severity: "warning", message: "没有固定的基准组件；整个装配仍可整体移动。", componentIds: [...document.componentOrder], mateIds: [] });
  for (const group of groups) {
    if (!group.anchored && document.componentOrder.length > 1) issues.push({ code: "FLOATING_COMPONENT_GROUP", severity: "warning", message: `${group.componentIds.map((id) => document.components[id]?.name ?? id).join("、")} 尚未连接到固定基准。`, componentIds: group.componentIds, mateIds: [] });
    if (group.componentIds.length === 1 && !group.anchored && document.componentOrder.length > 1) issues.push({ code: "ISOLATED_COMPONENT", severity: "warning", message: `组件“${document.components[group.componentIds[0]]?.name ?? group.componentIds[0]}”没有启用的配合。`, componentIds: group.componentIds, mateIds: [] });
  }
  if (runtime?.status === "conflict") issues.push({ code: "SOLVER_CONFLICT", severity: "error", message: "当前配合互相冲突，模型保持在上一次正确位置。", componentIds: [], mateIds: runtime.diagnostics.flatMap((entry) => entry.mateId ? [entry.mateId] : []) });
  else if (runtime?.status === "degraded") issues.push({ code: "SOLVER_DEGRADED", severity: "error", message: "存在无法解析的配合引用，请检查下方诊断。", componentIds: [], mateIds: runtime.diagnostics.flatMap((entry) => entry.mateId ? [entry.mateId] : []) });
  if ((runtime?.dof ?? 0) > 0) issues.push({ code: "UNRESOLVED_DOF", severity: "info", message: `装配还保留 ${runtime!.dof} 个运动自由度；需要固定装配时请继续添加配合。`, componentIds: [], mateIds: [] });

  const bomMap = new Map<UUID, AssemblyBomRow>();
  for (const id of document.componentOrder) {
    const component = document.components[id], row = bomMap.get(component.definitionId) ?? { definitionId: component.definitionId, definitionName: definitionNames.get(component.definitionId) ?? component.definitionId, instanceCount: 0, visibleCount: 0, componentIds: [] };
    row.instanceCount += 1; row.visibleCount += component.visible ? 1 : 0; row.componentIds.push(id); bomMap.set(component.definitionId, row);
  }
  const blocking = issues.some((issue) => issue.severity === "error");
  return { ready: !blocking, issues, groups, bom: [...bomMap.values()], summary: { componentCount: document.componentOrder.length, mateCount: document.mateOrder.length, enabledMateCount: enabledMates.length, groundedCount: anchored.size, hiddenCount: document.componentOrder.filter((id) => !document.components[id].visible).length, unresolvedDof: runtime?.dof ?? 0 } };
};
