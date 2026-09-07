import type { Vec3 } from "../cad/CadTypes.ts";
import type { CadKernel } from "../kernel/CadKernel.ts";
import type { KernelEdgeGeometry, KernelEdgeInfo, KernelFaceInfo, KernelShapeProperties, KernelTopologyRef } from "../kernel/KernelTypes.ts";
import { getRuntimeFeatureShape, type CadRuntimeState } from "../evaluation/CadRuntimeState.ts";
import { migratePersistentTopologyRefV1ToV2, type NurbsEdgeFingerprint, type PersistentTopologyRef, type PersistentTopologyRefV2 } from "./PersistentTopologyRef.ts";

export class TopologyResolutionError extends Error {
  readonly code: "TOPOLOGY_REFERENCE_LOST" | "TOPOLOGY_REFERENCE_AMBIGUOUS";
  constructor(code: "TOPOLOGY_REFERENCE_LOST" | "TOPOLOGY_REFERENCE_AMBIGUOUS", message: string) { super(message); this.name = "TopologyResolutionError"; this.code = code; }
}

export interface TopologyResolutionResult { status: "resolved" | "lost" | "ambiguous"; topology?: KernelTopologyRef; confidence?: number; strategy?: "signature" | "legacy-v1"; bestScore?: number; secondBestScore?: number; candidatesConsidered: number; }
/** Centralised V2 score policy. Prefer an explicit refusal to a weak match. */
export const TOPOLOGY_MATCH_TOLERANCE = { maximumScore: .56, minimumWinnerMargin: .025, positionWeight: 4, orientationWeight: 4, ratioWeight: .45, adjacencyWeight: 1.2 } as const;

const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const distance = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const unit = (point: Vec3): Vec3 | undefined => { const length = Math.hypot(point.x, point.y, point.z); return length > 1e-12 && Number.isFinite(length) ? { x: point.x / length, y: point.y / length, z: point.z / length } : undefined; };
const normalisedPoint = (point: Vec3 | undefined, properties: KernelShapeProperties): Vec3 => { const p = point ?? { x: 0, y: 0, z: 0 }; const { min, max } = properties.boundingBox; const axis = (value: number, low: number, high: number): number => Math.abs(high - low) <= 1e-9 ? .5 : (value - low) / (high - low); return { x: axis(p.x, min.x, max.x), y: axis(p.y, min.y, max.y), z: axis(p.z, min.z, max.z) }; };
const midpoint = (edge: KernelEdgeInfo): Vec3 | undefined => edge.startMm && edge.endMm ? { x: (edge.startMm.x + edge.endMm.x) / 2, y: (edge.startMm.y + edge.endMm.y) / 2, z: (edge.startMm.z + edge.endMm.z) / 2 } : undefined;
const edgeDirection = (edge: KernelEdgeInfo): Vec3 | undefined => edge.startMm && edge.endMm ? unit({ x: edge.endMm.x - edge.startMm.x, y: edge.endMm.y - edge.startMm.y, z: edge.endMm.z - edge.startMm.z }) : undefined;
const sameSet = (left: readonly string[] | undefined, right: readonly string[] | undefined): number => !left || !left.length ? 0 : [...left].sort().join("|") === [...(right ?? [])].sort().join("|") ? 0 : 1;
const sampledIndexes = (count: number, limit = 7): number[] => Array.from(new Set(Array.from({length:Math.min(limit,count)},(_,index)=>Math.round(index*(count-1)/Math.max(1,Math.min(limit,count)-1)))));
const nurbsFingerprint = (geometry: KernelEdgeGeometry, properties: KernelShapeProperties): NurbsEdgeFingerprint | undefined => {
  if(geometry.type!=="bspline"||!geometry.knots.length||!geometry.polesMm.length)return undefined;
  const start=geometry.knots[0],end=geometry.knots.at(-1)!,span=end-start;if(!Number.isFinite(span)||Math.abs(span)<=1e-12)return undefined;
  return {degree:geometry.degree,rational:geometry.rational,periodic:geometry.periodic,poleCount:geometry.polesMm.length,normalizedKnots:geometry.knots.map((knot)=>(knot-start)/span),multiplicities:[...geometry.multiplicities],normalizedPoles:sampledIndexes(geometry.polesMm.length).map((index)=>normalisedPoint(geometry.polesMm[index],properties))};
};
const numericSequenceDistance=(left:readonly number[],right:readonly number[]):number=>{if(left.length!==right.length)return 1;return left.length?left.reduce((sum,value,index)=>sum+Math.abs(value-right[index]),0)/left.length:0;};
const nurbsFingerprintScore=(desired:NurbsEdgeFingerprint,actual:NurbsEdgeFingerprint|undefined):number=>{
  if(!actual||desired.periodic!==actual.periodic)return .32;
  let score=Math.min(.2,Math.abs(desired.degree-actual.degree)*.08)+Math.min(.12,Math.abs(desired.poleCount-actual.poleCount)/Math.max(1,desired.poleCount)*.2);
  if(desired.rational!==actual.rational)score+=.08;
  score+=Math.min(.12,numericSequenceDistance(desired.normalizedKnots,actual.normalizedKnots)*.25);
  score+=Math.min(.08,numericSequenceDistance(desired.multiplicities,actual.multiplicities)*.04);
  if(desired.normalizedPoles.length===actual.normalizedPoles.length&&desired.normalizedPoles.length)score+=Math.min(.2,desired.normalizedPoles.reduce((sum,point,index)=>sum+distance(point,actual.normalizedPoles[index]),0)/desired.normalizedPoles.length*.35);
  return score;
};
const readEdgeGeometry = async (kernel: CadKernel, topology: KernelTopologyRef): Promise<KernelEdgeGeometry | undefined> => typeof kernel.getEdgeGeometry === "function" ? kernel.getEdgeGeometry(topology).catch(() => undefined) : undefined;

/** Capture creates V2 design data only; no runtime identifier is persisted. */
export const capturePersistentTopologyRef = async (sourceFeatureId: string, topology: KernelTopologyRef, runtime: CadRuntimeState, kernel: CadKernel): Promise<PersistentTopologyRefV2> => {
  const shape = getRuntimeFeatureShape(runtime, sourceFeatureId);
  if (!shape || shape.id !== topology.shapeId || shape.revision !== topology.shapeRevision) throw new TopologyResolutionError("TOPOLOGY_REFERENCE_LOST", "The selected topology does not belong to the source Feature's current result.");
  const properties = await kernel.getShapeProperties(shape);
  if (topology.kind === "face") {
    const face = await kernel.getFaceInfo(topology);
    return { version: 2, sourceFeatureId, kind: "face", signature: { kind: "face", surfaceType: face.surfaceType ?? "other", normal: face.normal, normalizedCenter: normalisedPoint(face.centerMm, properties), areaRatio: face.areaMm2 && properties.surfaceAreaMm2 ? face.areaMm2 / properties.surfaceAreaMm2 : undefined, boundaryEdgeCount: face.boundaryEdgeCount, adjacentSurfaceTypes: face.adjacentSurfaceTypes } };
  }
  if (topology.kind === "edge") {
    const edge = await kernel.getEdgeInfo(topology);
    const geometry=await readEdgeGeometry(kernel,topology);
    return { version: 2, sourceFeatureId, kind: "edge", signature: { kind: "edge", curveType: edge.curveType ?? "other", normalizedMidpoint: normalisedPoint(midpoint(edge), properties), direction: edgeDirection(edge), lengthRatio: edge.lengthMm && properties.surfaceAreaMm2 ? edge.lengthMm / Math.sqrt(properties.surfaceAreaMm2) : undefined, adjacentFaceSurfaceTypes: edge.adjacentFaceSurfaceTypes, adjacentFaceNormals: edge.adjacentFaceNormals, boundaryRole: edge.boundaryRole, nurbsFingerprint: geometry?nurbsFingerprint(geometry,properties):undefined } };
  }
  throw new TopologyResolutionError("TOPOLOGY_REFERENCE_LOST", "Only Face and Edge runtime selections can be persisted.");
};

const faceScore = (signature: Extract<PersistentTopologyRefV2, { kind: "face" }> ["signature"], face: KernelFaceInfo, properties: KernelShapeProperties): number => {
  if ((face.surfaceType ?? "other") !== signature.surfaceType) return Infinity;
  let score = distance(normalisedPoint(face.centerMm, properties), signature.normalizedCenter) * TOPOLOGY_MATCH_TOLERANCE.positionWeight;
  const left = signature.normal && unit(signature.normal); const right = face.normal && unit(face.normal); if (left && right) score += (1 - Math.max(-1, Math.min(1, dot(left, right)))) * TOPOLOGY_MATCH_TOLERANCE.orientationWeight;
  if (signature.areaRatio !== undefined && face.areaMm2 && properties.surfaceAreaMm2) score += Math.abs(face.areaMm2 / properties.surfaceAreaMm2 - signature.areaRatio) * TOPOLOGY_MATCH_TOLERANCE.ratioWeight;
  if (signature.boundaryEdgeCount !== undefined && face.boundaryEdgeCount !== undefined) score += Math.min(1, Math.abs(signature.boundaryEdgeCount - face.boundaryEdgeCount) / Math.max(1, signature.boundaryEdgeCount)) * TOPOLOGY_MATCH_TOLERANCE.adjacencyWeight;
  score += sameSet(signature.adjacentSurfaceTypes, face.adjacentSurfaceTypes) * TOPOLOGY_MATCH_TOLERANCE.adjacencyWeight;
  return score;
};
const edgeScore = (signature: Extract<PersistentTopologyRefV2, { kind: "edge" }> ["signature"], edge: KernelEdgeInfo, properties: KernelShapeProperties): number => {
  if ((edge.curveType ?? "other") !== signature.curveType) return Infinity;
  let score = distance(normalisedPoint(midpoint(edge), properties), signature.normalizedMidpoint) * TOPOLOGY_MATCH_TOLERANCE.positionWeight;
  const direction = edgeDirection(edge); const desired = signature.direction && unit(signature.direction); if (desired && direction) score += (1 - Math.abs(dot(desired, direction))) * TOPOLOGY_MATCH_TOLERANCE.orientationWeight;
  if (signature.lengthRatio !== undefined && edge.lengthMm && properties.surfaceAreaMm2) score += Math.abs(edge.lengthMm / Math.sqrt(properties.surfaceAreaMm2) - signature.lengthRatio) * TOPOLOGY_MATCH_TOLERANCE.ratioWeight;
  score += sameSet(signature.adjacentFaceSurfaceTypes, edge.adjacentFaceSurfaceTypes) * TOPOLOGY_MATCH_TOLERANCE.adjacencyWeight;
  if (signature.boundaryRole && edge.boundaryRole && signature.boundaryRole !== edge.boundaryRole) score += TOPOLOGY_MATCH_TOLERANCE.adjacencyWeight;
  return score;
};

/** Structured V2 resolver. It deliberately has no array-order fallback. */
export const resolvePersistentTopologyRefV2 = async (reference: PersistentTopologyRef, runtime: CadRuntimeState, kernel: CadKernel): Promise<TopologyResolutionResult> => {
  const persistent = migratePersistentTopologyRefV1ToV2(reference); const shape = getRuntimeFeatureShape(runtime, persistent.sourceFeatureId);
  if (!shape) return { status: "lost", candidatesConsidered: 0, strategy: reference.version === 1 ? "legacy-v1" : "signature" };
  const properties = await kernel.getShapeProperties(shape); const candidates = persistent.kind === "face" ? await kernel.getFaces(shape) : await kernel.getEdges(shape);
  const scored = (await Promise.all(candidates.map(async(candidate) => {let score=persistent.kind === "face" ? faceScore(persistent.signature, candidate as KernelFaceInfo, properties) : edgeScore(persistent.signature, candidate as KernelEdgeInfo, properties);if(Number.isFinite(score)&&persistent.kind==="edge"&&persistent.signature.nurbsFingerprint){const geometry=await readEdgeGeometry(kernel,candidate.topology);score+=nurbsFingerprintScore(persistent.signature.nurbsFingerprint,geometry?nurbsFingerprint(geometry,properties):undefined);}return{candidate,score};}))).filter((entry) => Number.isFinite(entry.score)).sort((left, right) => left.score - right.score || left.candidate.topology.localId.localeCompare(right.candidate.topology.localId));
  const best = scored[0]; const second = scored[1]; const strategy = reference.version === 1 ? "legacy-v1" as const : "signature" as const;
  if (!best || best.score > TOPOLOGY_MATCH_TOLERANCE.maximumScore) return { status: "lost", candidatesConsidered: candidates.length, strategy, bestScore: best?.score, secondBestScore: second?.score };
  if (second && second.score - best.score < TOPOLOGY_MATCH_TOLERANCE.minimumWinnerMargin) return { status: "ambiguous", candidatesConsidered: candidates.length, strategy, bestScore: best.score, secondBestScore: second.score };
  return { status: "resolved", topology: best.candidate.topology, candidatesConsidered: candidates.length, strategy, bestScore: best.score, secondBestScore: second?.score, confidence: Math.max(0, Math.min(1, 1 - best.score / TOPOLOGY_MATCH_TOLERANCE.maximumScore)) };
};

export const resolvePersistentTopologyRef = async (persistent: PersistentTopologyRef, runtime: CadRuntimeState, kernel: CadKernel): Promise<KernelTopologyRef> => {
  const resolution = await resolvePersistentTopologyRefV2(persistent, runtime, kernel);
  if (resolution.status === "resolved" && resolution.topology) return resolution.topology;
  throw new TopologyResolutionError(resolution.status === "ambiguous" ? "TOPOLOGY_REFERENCE_AMBIGUOUS" : "TOPOLOGY_REFERENCE_LOST", resolution.status === "ambiguous" ? "Topology candidates are too similar to resolve safely." : "No topology candidate matches the saved semantic signature.");
};

/** Explicit re-anchor hook for a future user-approved repair workflow. */
export const refreshPersistentTopologyRef = capturePersistentTopologyRef;
