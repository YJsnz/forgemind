import type { CadDocument } from "../cad/CadDocument.ts";
import type { Feature } from "../features/Feature.ts";
import type { PersistentFaceRef } from "../topology/PersistentTopologyRef.ts";
import type { ClosedProfile, ProfileSegment } from "../sketch/SketchProfile.ts";
import type { Sketch } from "../sketch/Sketch.ts";
import type { SketchEntity } from "../sketch/SketchEntity.ts";

export type PrismaticClassification = "boss" | "pocket";

export interface ImportedPrismaticReconstruction {
  document: CadDocument<Sketch, Feature>;
  bodyId: string;
  baseFeatureId: string;
  defeatureFeatureId: string;
  sketchId: string;
  reconstructedFeatureId: string;
  classification: PrismaticClassification;
  depthMm: number;
  direction: "positive" | "negative";
  sourceLabel: string;
}

const clone = <T>(value: T): T => structuredClone(value);
const radians = (degrees: number): number => degrees * Math.PI / 180;

const freeFeatureId = (document: CadDocument<Sketch, Feature>, preferred: string): string => {
  if (!document.features[preferred]) return preferred;
  let ordinal = 2;
  while (document.features[`${preferred}${ordinal}`]) ordinal += 1;
  return `${preferred}${ordinal}`;
};

const freeSketchId = (document: CadDocument<Sketch, Feature>, preferred: string): string => {
  if (!document.sketches[preferred]) return preferred;
  let ordinal = 2;
  while (document.sketches[`${preferred}${ordinal}`]) ordinal += 1;
  return `${preferred}${ordinal}`;
};

const entityFromSegment = (segment: ProfileSegment, id: string): SketchEntity => {
  if (segment.type === "line") return {
    id,
    type: "line",
    start: { x: segment.start[0], y: segment.start[1] },
    end: { x: segment.end[0], y: segment.end[1] },
    construction: false,
  };
  if (segment.type === "circle") return {
    id,
    type: "circle",
    center: { x: segment.center[0], y: segment.center[1] },
    radius: segment.radius,
    construction: false,
  };
  const startAngleDeg = segment.clockwise ? segment.endAngleDeg : segment.startAngleDeg;
  const endAngleDeg = segment.clockwise ? segment.startAngleDeg : segment.endAngleDeg;
  return {
    id,
    type: "arc",
    center: { x: segment.center[0], y: segment.center[1] },
    radius: segment.radius,
    startAngle: radians(startAngleDeg),
    endAngle: radians(endAngleDeg),
    construction: false,
  };
};

/**
 * V8 promotes a proven planar prismatic candidate including exact nested
 * analytic loops. The original cap boundary becomes a real editable Sketch;
 * the imported feature is first removed/healed, then recreated as a native
 * Boolean Extrude (boss) or Pocket. No tessellated profile is accepted.
 */
export const createImportedPrismaticReconstruction = (options: {
  document: CadDocument<Sketch, Feature>;
  bodyId: string;
  targetFeatureId: string;
  capFace: PersistentFaceRef;
  featureFaces: PersistentFaceRef[];
  profile: ClosedProfile;
  classification: PrismaticClassification;
  depthMm: number;
  direction: "positive" | "negative";
  sourceLabel: string;
}): ImportedPrismaticReconstruction => {
  if (!options.document.features[options.targetFeatureId]) throw new Error(`Target Feature ${options.targetFeatureId} does not exist.`);
  if (!options.document.bodies[options.bodyId]) throw new Error(`Body ${options.bodyId} does not exist.`);
  if (!Number.isFinite(options.depthMm) || options.depthMm <= 1e-6) throw new Error("Prismatic reconstruction depth must be positive and finite.");
  if (options.capFace.sourceFeatureId !== options.targetFeatureId) throw new Error("Recovered cap Face must belong to the target imported Feature state.");
  if (!options.featureFaces.length || options.featureFaces.some((face) => face.sourceFeatureId !== options.targetFeatureId)) throw new Error("Every prismatic Defeature Face must belong to the target imported Feature state.");
  if (!options.profile.outer.length) throw new Error("Recovered prismatic cap profile is empty.");

  const document = clone(options.document);
  const defeatureFeatureId = freeFeatureId(document, options.classification === "boss" ? "RecognizedBossDefeature" : "RecognizedPocketDefeature");
  const sketchId = freeSketchId(document, options.classification === "boss" ? "RecoveredBossSketch" : "RecoveredPocketSketch");
  const reconstructedFeatureId = freeFeatureId(document, options.classification === "boss" ? "ReconstructedBoss" : "ReconstructedPocket");

  const uniqueFaces = new Map<string, PersistentFaceRef>();
  for (const face of [options.capFace, ...options.featureFaces]) uniqueFaces.set(JSON.stringify(face.signature), clone(face));
  document.features[defeatureFeatureId] = {
    id: defeatureFeatureId,
    name: `${options.classification === "boss" ? "Recognized Boss" : "Recognized Pocket"} · Remove / Heal`,
    type: "deleteFace",
    bodyId: options.bodyId,
    targetFeatureId: options.targetFeatureId,
    faces: [...uniqueFaces.values()],
    toleranceMm: 0,
    enabled: true,
    state: "clean",
    dependencies: [options.targetFeatureId],
  };
  document.featureOrder.push(defeatureFeatureId);

  const entities: Record<string, SketchEntity> = {};
  const entityOrder: string[] = [];
  const appendLoop = (segments: ProfileSegment[], prefix: string) => segments.forEach((segment, index) => {
    const id = `${sketchId}:${prefix}:edge:${index + 1}`;
    entities[id] = entityFromSegment(segment, id);
    entityOrder.push(id);
  });
  appendLoop(options.profile.outer, "outer");
  options.profile.holes.forEach((loop, index) => appendLoop(loop, `hole:${index + 1}`));
  document.sketches[sketchId] = {
    id: sketchId,
    name: `${options.classification === "boss" ? "Recovered Boss" : "Recovered Pocket"} Profile`,
    plane: { type: "face", face: { sourceFeatureId: options.targetFeatureId, persistent: clone(options.capFace) } },
    entities,
    entityOrder,
    constraints: {},
    dimensions: {},
  };

  if (options.classification === "boss") {
    document.features[reconstructedFeatureId] = {
      id: reconstructedFeatureId,
      name: `Reconstructed Boss ${options.depthMm.toFixed(3)} mm`,
      type: "extrude",
      bodyId: options.bodyId,
      sketchId,
      distance: options.depthMm,
      direction: options.direction,
      operation: "add",
      targetFeatureId: defeatureFeatureId,
      targetBodyId: options.bodyId,
      enabled: true,
      state: "clean",
      dependencies: [defeatureFeatureId],
    };
  } else {
    document.features[reconstructedFeatureId] = {
      id: reconstructedFeatureId,
      name: `Reconstructed Pocket ${options.depthMm.toFixed(3)} mm`,
      type: "pocket",
      bodyId: options.bodyId,
      sketchId,
      targetFeatureId: defeatureFeatureId,
      targetBodyId: options.bodyId,
      depth: { type: "blind", value: options.depthMm },
      direction: options.direction,
      enabled: true,
      state: "clean",
      dependencies: [defeatureFeatureId],
    };
  }
  document.featureOrder.push(reconstructedFeatureId);
  document.bodies[options.bodyId].tipFeatureId = reconstructedFeatureId;
  document.updatedAt = Date.now();

  return {
    document,
    bodyId: options.bodyId,
    baseFeatureId: options.targetFeatureId,
    defeatureFeatureId,
    sketchId,
    reconstructedFeatureId,
    classification: options.classification,
    depthMm: options.depthMm,
    direction: options.direction,
    sourceLabel: options.sourceLabel,
  };
};
