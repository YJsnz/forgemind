import type { UUID, Vec3 } from "../cad/CadTypes.ts";
import { applyRigidDelta, cloneRigidTransform, crossVec3, dotVec3, lengthVec3, normalizeQuaternion, normalizeVec3, quaternionAngularDistanceRad, scaleVec3, subVec3, transformDirection, transformPoint } from "./RigidTransform.ts";
import type { AssemblyDocument, AssemblyGeometryProvider, AssemblyMate, AssemblyRuntimeState, AssemblySolveDiagnostic, LocalCylinderGeometry, LocalMateConnectorFrame, LocalMateGeometry, LocalPlaneGeometry, MateAlignment, Quaternion, RevoluteMate, RigidTransform, SliderMate } from "./AssemblyTypes.ts";
import { connectorSignedTwistRad, transformMateConnectorFrame } from "./MateConnector.ts";

export const ASSEMBLY_SOLVER_TOLERANCE = {
  positionMm: 1e-7,
  angularRad: 1e-8,
  residualNorm: 1e-6,
  jacobianRank: 1e-7,
  translationStepMm: 1e-5,
  rotationStepRad: 1e-6,
  orientationResidualScaleMm: 10,
  maxIterations: 80,
} as const;

interface PreparedTopologyMate { mate: Extract<AssemblyMate,{type:"coincident"|"distance"|"concentric"|"angle"}>; a: LocalMateGeometry; b: LocalMateGeometry; }
interface PreparedConnectorMate { mate: RevoluteMate|SliderMate; a: LocalMateConnectorFrame; b: LocalMateConnectorFrame; }
interface PreparedAssembly { topologyMates: PreparedTopologyMate[]; connectorMates: PreparedConnectorMate[]; fixedMates: Extract<AssemblyMate, { type: "fixed" }>[]; diagnostics: AssemblySolveDiagnostic[]; }
interface VariableLayout { ids: UUID[]; offsets: Map<UUID, number>; bases: Map<UUID, RigidTransform>; }

const clonePlacements = (placements: ReadonlyMap<UUID, RigidTransform>): Map<UUID, RigidTransform> => new Map([...placements].map(([id, placement]) => [id, cloneRigidTransform(placement)]));
const nominalPlacements = (document: AssemblyDocument): Map<UUID, RigidTransform> => new Map(document.componentOrder.map((id) => [id, cloneRigidTransform(document.components[id].nominalPlacement)]));
export const createAssemblyRuntimeState = (document?: AssemblyDocument): AssemblyRuntimeState => { const initial = document ? nominalPlacements(document) : new Map<UUID, RigidTransform>(); return { solvedPlacements: clonePlacements(initial), lastGoodPlacements: clonePlacements(initial), status: "under-constrained", dof: document ? document.componentOrder.filter((id) => !document.components[id].grounded).length * 6 : 0, iterations: 0, residualNorm: 0, diagnostics: [] }; };

const requirePlane = (geometry: LocalMateGeometry, mateId: string): LocalPlaneGeometry => { if (geometry.kind !== "plane") throw Object.assign(new Error(`Mate ${mateId} requires planar Faces.`), { code: "MATE_REQUIRES_PLANAR_FACE" }); return geometry; };
const requireCylinder = (geometry: LocalMateGeometry, mateId: string): LocalCylinderGeometry => { if (geometry.kind !== "cylinder") throw Object.assign(new Error(`Mate ${mateId} requires cylindrical Faces.`), { code: "MATE_REQUIRES_CYLINDRICAL_FACE" }); return geometry; };

const prepareAssembly = async (document: AssemblyDocument, geometry: AssemblyGeometryProvider): Promise<PreparedAssembly> => {
  const topologyMates: PreparedTopologyMate[] = []; const connectorMates:PreparedConnectorMate[]=[]; const fixedMates: Extract<AssemblyMate, { type: "fixed" }>[] = []; const diagnostics: AssemblySolveDiagnostic[] = [];
  for (const mateId of document.mateOrder) {
    const mate = document.mates[mateId]; if (!mate?.enabled) continue;
    if (mate.type === "fixed") { fixedMates.push(mate); continue; }
    try {
      if(mate.type === "revolute" || mate.type === "slider") { const [a,b]=await Promise.all([geometry.resolveConnector(mate.a),geometry.resolveConnector(mate.b)]); connectorMates.push({mate,a,b}); continue; }
      const [a, b] = await Promise.all([geometry.resolve(mate.a), geometry.resolve(mate.b)]);
      if (mate.type === "coincident" || mate.type === "distance" || mate.type === "angle") { requirePlane(a, mate.id); requirePlane(b, mate.id); }
      if (mate.type === "concentric") { requireCylinder(a, mate.id); requireCylinder(b, mate.id); }
      topologyMates.push({ mate, a, b });
    } catch (error) {
      diagnostics.push({ code: typeof (error as { code?: unknown })?.code === "string" ? (error as { code: string }).code : "MATE_REFERENCE_LOST", message: error instanceof Error ? error.message : String(error), mateId: mate.id });
    }
  }
  return { topologyMates, connectorMates, fixedMates, diagnostics };
};

const variableLayout = (document: AssemblyDocument): VariableLayout => {
  const ids = document.componentOrder.filter((id) => !document.components[id].grounded); const offsets = new Map<UUID, number>(); const bases = new Map<UUID, RigidTransform>();
  ids.forEach((id, index) => { offsets.set(id, index * 6); bases.set(id, cloneRigidTransform(document.components[id].nominalPlacement)); });
  return { ids, offsets, bases };
};
const paramsToPlacements = (document: AssemblyDocument, layout: VariableLayout, parameters: readonly number[]): Map<UUID, RigidTransform> => {
  const placements = nominalPlacements(document);
  for (const id of layout.ids) { const offset = layout.offsets.get(id)!; const base = layout.bases.get(id)!; placements.set(id, applyRigidDelta(base, { x: parameters[offset], y: parameters[offset + 1], z: parameters[offset + 2] }, { x: parameters[offset + 3], y: parameters[offset + 4], z: parameters[offset + 5] })); }
  return placements;
};

const alignmentSign = (alignment: MateAlignment): number => alignment === "same" ? 1 : -1;
const normalAlignmentRotationVector = (fromInput: Vec3, toInput: Vec3): Vec3 => {
  const from = normalizeVec3(fromInput), to = normalizeVec3(toInput);
  const cross = crossVec3(from, to), sine = lengthVec3(cross), cosine = Math.max(-1, Math.min(1, dotVec3(from, to)));
  if (sine > 1e-10) return scaleVec3(cross, Math.atan2(sine, cosine) / sine);
  if (cosine >= 0) return { x: 0, y: 0, z: 0 };
  // 180° is singular for a plain cross-product residual. Choose a deterministic
  // perpendicular axis so SAME/OPPOSITE face alignment cannot falsely accept
  // the exact reversed orientation.
  const basis = Math.abs(from.x) <= Math.abs(from.y) && Math.abs(from.x) <= Math.abs(from.z)
    ? { x: 1, y: 0, z: 0 }
    : Math.abs(from.y) <= Math.abs(from.z) ? { x: 0, y: 1, z: 0 } : { x: 0, y: 0, z: 1 };
  return scaleVec3(normalizeVec3(crossVec3(from, basis)), Math.PI);
};
const planeWorld = (plane: LocalPlaneGeometry, transform: RigidTransform) => ({ pointMm: transformPoint(transform, plane.pointMm), normal: transformDirection(transform, plane.normal) });
const cylinderWorld = (cylinder: LocalCylinderGeometry, transform: RigidTransform) => ({ axisOriginMm: transformPoint(transform, cylinder.axisOriginMm), axisDirection: transformDirection(transform, cylinder.axisDirection), radiusMm: cylinder.radiusMm });
const pushVector = (target: number[], vector: Vec3, scale = 1) => { target.push(vector.x * scale, vector.y * scale, vector.z * scale); };

const quaternionRotationVector = (fromInput: Quaternion, toInput: Quaternion): Vec3 => {
  const from = normalizeQuaternion(fromInput), to = normalizeQuaternion(toInput);
  const inverse = { x: -from.x, y: -from.y, z: -from.z, w: from.w };
  let q = normalizeQuaternion({ x: to.w * inverse.x + to.x * inverse.w + to.y * inverse.z - to.z * inverse.y, y: to.w * inverse.y - to.x * inverse.z + to.y * inverse.w + to.z * inverse.x, z: to.w * inverse.z + to.x * inverse.y - to.y * inverse.x + to.z * inverse.w, w: to.w * inverse.w - to.x * inverse.x - to.y * inverse.y - to.z * inverse.z });
  if (q.w < 0) q = { x: -q.x, y: -q.y, z: -q.z, w: -q.w };
  const sine = Math.hypot(q.x, q.y, q.z); if (sine <= 1e-15) return { x: 0, y: 0, z: 0 };
  const angle = 2 * Math.atan2(sine, Math.max(-1, Math.min(1, q.w))); return scaleVec3({ x: q.x, y: q.y, z: q.z }, angle / sine);
};

const residualForMate = (prepared: PreparedTopologyMate, placements: Map<UUID, RigidTransform>, residual: number[]): void => {
  const { mate } = prepared; const aPlacement = placements.get(mate.a.instanceId)!; const bPlacement = placements.get(mate.b.instanceId)!; const orientationScale = ASSEMBLY_SOLVER_TOLERANCE.orientationResidualScaleMm;
  if (mate.type === "coincident" || mate.type === "distance") {
    const a = planeWorld(prepared.a as LocalPlaneGeometry, aPlacement), b = planeWorld(prepared.b as LocalPlaneGeometry, bPlacement); const sign = alignmentSign(mate.alignment); const targetBNormal = scaleVec3(a.normal, sign);
    pushVector(residual, normalAlignmentRotationVector(b.normal, targetBNormal), orientationScale);
    const signed = dotVec3(subVec3(b.pointMm, a.pointMm), a.normal); residual.push(signed - (mate.type === "distance" ? mate.distanceMm : 0)); return;
  }
  if (mate.type === "concentric") {
    const a = cylinderWorld(prepared.a as LocalCylinderGeometry, aPlacement), b = cylinderWorld(prepared.b as LocalCylinderGeometry, bPlacement); const directionB = dotVec3(a.axisDirection, b.axisDirection) < 0 ? scaleVec3(b.axisDirection, -1) : b.axisDirection;
    pushVector(residual, crossVec3(a.axisDirection, directionB), orientationScale);
    const delta = subVec3(b.axisOriginMm, a.axisOriginMm); const transverse = subVec3(delta, scaleVec3(a.axisDirection, dotVec3(delta, a.axisDirection))); pushVector(residual, transverse); return;
  }
  if (mate.type === "angle") {
    const a = planeWorld(prepared.a as LocalPlaneGeometry, aPlacement), b = planeWorld(prepared.b as LocalPlaneGeometry, bPlacement); const dot = Math.max(-1, Math.min(1, dotVec3(a.normal, b.normal))); const crossLength = lengthVec3(crossVec3(a.normal, b.normal)); const angle = Math.atan2(crossLength, dot); residual.push((angle - mate.angleDeg * Math.PI / 180) * orientationScale);
  }
};

const residualForConnectorMate=(prepared:PreparedConnectorMate,placements:Map<UUID,RigidTransform>,residual:number[]):void=>{
  const {mate}=prepared; const aPlacement=placements.get(mate.a.instanceId)!; const bPlacement=placements.get(mate.b.instanceId)!; const a=transformMateConnectorFrame(prepared.a,aPlacement),b=transformMateConnectorFrame(prepared.b,bPlacement); const orientationScale=ASSEMBLY_SOLVER_TOLERANCE.orientationResidualScaleMm;
  const directionB=dotVec3(a.primaryAxis,b.primaryAxis)<0?scaleVec3(b.primaryAxis,-1):b.primaryAxis;
  pushVector(residual,crossVec3(a.primaryAxis,directionB),orientationScale);
  const delta=subVec3(b.originMm,a.originMm);
  if(mate.type==="revolute"){pushVector(residual,delta); if(mate.angleLimit.enabled){const twist=connectorSignedTwistRad(a,b)*180/Math.PI; const clamped=Math.max(mate.angleLimit.min,Math.min(mate.angleLimit.max,twist));residual.push((twist-clamped)*Math.PI/180*orientationScale);} return;}
  const axial=dotVec3(delta,a.primaryAxis); const transverse=subVec3(delta,scaleVec3(a.primaryAxis,axial)); pushVector(residual,transverse);
  const twist=connectorSignedTwistRad(a,b); residual.push(twist*orientationScale);
  if(mate.distanceLimit.enabled){const clamped=Math.max(mate.distanceLimit.min,Math.min(mate.distanceLimit.max,axial));residual.push(axial-clamped);}
};

const residualVector = (document: AssemblyDocument, prepared: PreparedAssembly, placements: Map<UUID, RigidTransform>): number[] => {
  const residual: number[] = []; const orientationScale = ASSEMBLY_SOLVER_TOLERANCE.orientationResidualScaleMm;
  for (const mate of prepared.fixedMates) { const placement = placements.get(mate.componentId); if (!placement) continue; const delta = subVec3(placement.translationMm, mate.lockedPlacement.translationMm); pushVector(residual, delta); pushVector(residual, quaternionRotationVector(mate.lockedPlacement.rotation, placement.rotation), orientationScale); }
  for (const mate of prepared.topologyMates) residualForMate(mate, placements, residual);
  for (const mate of prepared.connectorMates) residualForConnectorMate(mate,placements,residual);
  return residual;
};

const norm = (values: readonly number[]): number => Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
const jacobian = (document: AssemblyDocument, prepared: PreparedAssembly, layout: VariableLayout, parameters: readonly number[], baseResidual: readonly number[]): number[][] => {
  const result = Array.from({ length: baseResidual.length }, () => Array(parameters.length).fill(0));
  for (let column = 0; column < parameters.length; column += 1) { const step = column % 6 < 3 ? ASSEMBLY_SOLVER_TOLERANCE.translationStepMm : ASSEMBLY_SOLVER_TOLERANCE.rotationStepRad; const shifted = [...parameters]; shifted[column] += step; const shiftedResidual = residualVector(document, prepared, paramsToPlacements(document, layout, shifted)); for (let row = 0; row < baseResidual.length; row += 1) result[row][column] = (shiftedResidual[row] - baseResidual[row]) / step; }
  return result;
};

const solveLinear = (matrix: number[][], rhs: number[]): number[] | undefined => {
  const n = rhs.length; const augmented = matrix.map((row, index) => [...row, rhs[index]]);
  for (let column = 0; column < n; column += 1) { let pivot = column; for (let row = column + 1; row < n; row += 1) if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row; if (Math.abs(augmented[pivot][column]) < 1e-14) return undefined; [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]]; const scale = augmented[column][column]; for (let j = column; j <= n; j += 1) augmented[column][j] /= scale; for (let row = 0; row < n; row += 1) { if (row === column) continue; const factor = augmented[row][column]; if (Math.abs(factor) <= 1e-18) continue; for (let j = column; j <= n; j += 1) augmented[row][j] -= factor * augmented[column][j]; } }
  return augmented.map((row) => row[n]);
};

const normalEquationStep = (j: number[][], residual: readonly number[], damping: number): number[] | undefined => {
  const columns = j[0]?.length ?? 0; if (!columns) return [];
  const normal = Array.from({ length: columns }, () => Array(columns).fill(0)); const rhs = Array(columns).fill(0);
  for (let row = 0; row < j.length; row += 1) for (let a = 0; a < columns; a += 1) { rhs[a] -= j[row][a] * residual[row]; for (let b = 0; b < columns; b += 1) normal[a][b] += j[row][a] * j[row][b]; }
  for (let index = 0; index < columns; index += 1) normal[index][index] += damping;
  return solveLinear(normal, rhs);
};

const matrixRank = (matrix: number[][], tolerance = ASSEMBLY_SOLVER_TOLERANCE.jacobianRank): number => {
  if (!matrix.length || !matrix[0]?.length) return 0; const a = matrix.map((row) => [...row]); const rows = a.length, columns = a[0].length; let rank = 0;
  for (let column = 0; column < columns && rank < rows; column += 1) { let pivot = rank; for (let row = rank + 1; row < rows; row += 1) if (Math.abs(a[row][column]) > Math.abs(a[pivot][column])) pivot = row; const pivotValue = Math.abs(a[pivot][column]); if (pivotValue <= tolerance) continue; [a[rank], a[pivot]] = [a[pivot], a[rank]]; const divisor = a[rank][column]; for (let j = column; j < columns; j += 1) a[rank][j] /= divisor; for (let row = 0; row < rows; row += 1) { if (row === rank) continue; const factor = a[row][column]; for (let j = column; j < columns; j += 1) a[row][j] -= factor * a[rank][j]; } rank += 1; }
  return rank;
};

const placementParameters = (document: AssemblyDocument, layout: VariableLayout, initial: ReadonlyMap<UUID, RigidTransform>): number[] => {
  const values = Array(layout.ids.length * 6).fill(0);
  for (const id of layout.ids) { const current = initial.get(id); const base = layout.bases.get(id); if (!current || !base) continue; const offset = layout.offsets.get(id)!; const translation = subVec3(current.translationMm, base.translationMm); values[offset] = translation.x; values[offset + 1] = translation.y; values[offset + 2] = translation.z; const rotation = quaternionRotationVector(base.rotation, current.rotation); values[offset + 3] = rotation.x; values[offset + 4] = rotation.y; values[offset + 5] = rotation.z; }
  return values;
};

export interface AssemblySolveResult { success: boolean; placements: Map<UUID, RigidTransform>; dof: number; iterations: number; residualNorm: number; diagnostics: AssemblySolveDiagnostic[]; status: AssemblyRuntimeState["status"]; }

export const solveAssembly = async (document: AssemblyDocument, geometry: AssemblyGeometryProvider, initialPlacements?: ReadonlyMap<UUID, RigidTransform>): Promise<AssemblySolveResult> => {
  const prepared = await prepareAssembly(document, geometry); const layout = variableLayout(document); const initial = initialPlacements ?? nominalPlacements(document); let parameters = placementParameters(document, layout, initial); let placements = paramsToPlacements(document, layout, parameters); let residual = residualVector(document, prepared, placements); let residualNorm = norm(residual); let damping = 1e-6; let iterations = 0;
  for (; parameters.length && residual.length && iterations < ASSEMBLY_SOLVER_TOLERANCE.maxIterations && residualNorm > ASSEMBLY_SOLVER_TOLERANCE.residualNorm; iterations += 1) {
    const j = jacobian(document, prepared, layout, parameters, residual); const step = normalEquationStep(j, residual, damping); if (!step) { damping *= 100; if (damping > 1e12) break; continue; }
    let accepted = false;
    for (const scale of [1, .5, .25, .1, .05, .01]) { const candidate = parameters.map((value, index) => value + step[index] * scale); const candidatePlacements = paramsToPlacements(document, layout, candidate); const candidateResidual = residualVector(document, prepared, candidatePlacements); const candidateNorm = norm(candidateResidual); if (candidateNorm + 1e-12 < residualNorm) { parameters = candidate; placements = candidatePlacements; residual = candidateResidual; residualNorm = candidateNorm; damping = Math.max(1e-12, damping * .2); accepted = true; break; } }
    if (!accepted) { damping *= 10; if (damping > 1e12 || norm(step) < 1e-11) break; }
  }
  placements = paramsToPlacements(document, layout, parameters); residual = residualVector(document, prepared, placements); residualNorm = norm(residual); const finalJacobian = residual.length && parameters.length ? jacobian(document, prepared, layout, parameters, residual) : []; const rank = matrixRank(finalJacobian); const dof = Math.max(0, parameters.length - rank); const conflict = residualNorm > ASSEMBLY_SOLVER_TOLERANCE.residualNorm; const degraded = prepared.diagnostics.length > 0; const status: AssemblyRuntimeState["status"] = conflict ? "conflict" : degraded ? "degraded" : dof === 0 ? "fully-constrained" : "under-constrained";
  const diagnostics = [...prepared.diagnostics]; if (conflict) diagnostics.push({ code: "ASSEMBLY_SOLVE_CONFLICT", message: `Assembly constraints did not converge; residual norm ${residualNorm}.` });
  return { success: !conflict, placements, dof, iterations, residualNorm, diagnostics, status };
};

/** Transactional runtime update: failed solves preserve every last-good placement. */
export const solveAssemblyRuntime = async (document: AssemblyDocument, geometry: AssemblyGeometryProvider, runtime: AssemblyRuntimeState): Promise<AssemblySolveResult> => {
  // A solve always starts from the current design nominal placements. This makes
  // manual placement edits deterministic instead of allowing stale solved runtime
  // state to override the user's new design input. Last-good is used only for rollback.
  const result = await solveAssembly(document, geometry);
  runtime.iterations = result.iterations; runtime.residualNorm = result.residualNorm; runtime.dof = result.dof; runtime.diagnostics = result.diagnostics; runtime.status = result.status;
  if (result.success) { runtime.solvedPlacements = clonePlacements(result.placements); runtime.lastGoodPlacements = clonePlacements(result.placements); }
  else if (runtime.lastGoodPlacements.size) runtime.solvedPlacements = clonePlacements(runtime.lastGoodPlacements);
  return result;
};

export const componentPlacement = (document: AssemblyDocument, runtime: AssemblyRuntimeState, componentId: UUID): RigidTransform => runtime.solvedPlacements.get(componentId) ?? document.components[componentId]?.nominalPlacement ?? (() => { throw new Error(`Component ${componentId} is unavailable.`); })();

export const componentTranslationDriftMm = (a: RigidTransform, b: RigidTransform): number => lengthVec3(subVec3(a.translationMm, b.translationMm));
export const componentAngularDriftDeg = (a: RigidTransform, b: RigidTransform): number => quaternionAngularDistanceRad(a.rotation, b.rotation) * 180 / Math.PI;
