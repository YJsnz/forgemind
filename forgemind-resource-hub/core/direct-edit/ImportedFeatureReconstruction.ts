import type { CadDocument } from "../cad/CadDocument.ts";
import type { Feature } from "../features/Feature.ts";
import type { Sketch } from "../sketch/Sketch.ts";
import type { PersistentEdgeRef, PersistentFaceRef } from "../topology/PersistentTopologyRef.ts";
import type { HoleStyle } from "../features/HoleFeature.ts";

export type ImportedEdgeTreatmentKind = "fillet" | "chamfer";

export interface ImportedEdgeTreatmentPreview {
  document: CadDocument<Sketch, Feature>;
  baseFeatureId: string;
  defeatureFeatureId: string;
  bodyId: string;
  kind: ImportedEdgeTreatmentKind;
  sourceLabel: string;
}

export interface ImportedEdgeTreatmentReconstruction extends ImportedEdgeTreatmentPreview {
  reconstructedFeatureId: string;
  valueMm: number;
  edgeCount: number;
}

const clone = <T>(value: T): T => structuredClone(value);

const ensureFreeId = (document: CadDocument<Sketch, Feature>, preferred: string): string => {
  if (!document.features[preferred]) return preferred;
  let ordinal = 2;
  while (document.features[`${preferred}${ordinal}`]) ordinal += 1;
  return `${preferred}${ordinal}`;
};

/**
 * Stage 1 of imported edge-treatment reconstruction.
 * The recognized analytic faces are removed/healed first, producing a real
 * sharp-edge B-Rep preview. The returned document is design-only and can be
 * rebuilt without committing to CadHistory.
 */
export const createImportedEdgeTreatmentPreview = (options: {
  document: CadDocument<Sketch, Feature>;
  bodyId: string;
  targetFeatureId: string;
  faces: PersistentFaceRef[];
  kind: ImportedEdgeTreatmentKind;
  sourceLabel: string;
}): ImportedEdgeTreatmentPreview => {
  if (!options.faces.length) throw new Error("Imported feature reconstruction requires at least one recognized Face.");
  if (!options.document.features[options.targetFeatureId]) throw new Error(`Target Feature ${options.targetFeatureId} does not exist.`);
  if (!options.document.bodies[options.bodyId]) throw new Error(`Body ${options.bodyId} does not exist.`);
  if (options.faces.some((face) => face.sourceFeatureId !== options.targetFeatureId)) throw new Error("All reconstruction Faces must belong to the same target Feature state.");

  const document = clone(options.document);
  const defeatureFeatureId = ensureFreeId(document, options.kind === "fillet" ? "RecognizedFilletDefeature" : "RecognizedChamferDefeature");
  document.features[defeatureFeatureId] = {
    id: defeatureFeatureId,
    name: `${options.kind === "fillet" ? "Recognized Fillet" : "Recognized Chamfer"} · Remove / Heal`,
    type: "deleteFace",
    bodyId: options.bodyId,
    targetFeatureId: options.targetFeatureId,
    faces: clone(options.faces),
    toleranceMm: 0,
    enabled: true,
    state: "clean",
    dependencies: [options.targetFeatureId],
  };
  document.featureOrder.push(defeatureFeatureId);
  document.updatedAt = Date.now();
  return { document, baseFeatureId: options.targetFeatureId, defeatureFeatureId, bodyId: options.bodyId, kind: options.kind, sourceLabel: options.sourceLabel };
};

/**
 * Stage 2. After the healed preview is rebuilt, the user selects the exact new
 * sharp Edge. That persistent reference is then used by the ordinary native
 * Fillet/Chamfer evaluator. This avoids guessing an edge after OCCT healing.
 */
export const completeImportedEdgeTreatmentReconstruction = (options: {
  preview: ImportedEdgeTreatmentPreview;
  /** Backward-compatible single-edge confirmation. */
  edge?: PersistentEdgeRef;
  /** V6: one native Fillet/Chamfer may be reconstructed from multiple healed sharp edges. */
  edges?: PersistentEdgeRef[];
  valueMm: number;
}): ImportedEdgeTreatmentReconstruction => {
  if (!Number.isFinite(options.valueMm) || options.valueMm <= 0) throw new Error("Reconstructed Fillet/Chamfer size must be positive and finite.");
  const confirmed = (options.edges?.length ? options.edges : options.edge ? [options.edge] : []).map(clone);
  if (!confirmed.length) throw new Error("Imported Fillet/Chamfer reconstruction requires at least one confirmed healed Edge.");
  if (confirmed.some((edge) => edge.sourceFeatureId !== options.preview.defeatureFeatureId)) throw new Error("Every confirmed Edge must come from the healed Defeature preview state.");
  const unique = new Map<string, PersistentEdgeRef>();
  for (const edge of confirmed) unique.set(JSON.stringify(edge.signature), edge);
  const edges = [...unique.values()];

  const document = clone(options.preview.document);
  const reconstructedFeatureId = ensureFreeId(document, options.preview.kind === "fillet" ? "ReconstructedFillet" : "ReconstructedChamfer");
  document.features[reconstructedFeatureId] = options.preview.kind === "fillet"
    ? {
        id: reconstructedFeatureId,
        name: `Reconstructed Fillet R${options.valueMm}${edges.length > 1 ? ` · ${edges.length} edges` : ""}`,
        type: "fillet",
        bodyId: options.preview.bodyId,
        targetFeatureId: options.preview.defeatureFeatureId,
        edges,
        radiusMm: options.valueMm,
        enabled: true,
        state: "clean",
        dependencies: [options.preview.defeatureFeatureId],
      }
    : {
        id: reconstructedFeatureId,
        name: `Reconstructed Chamfer ${options.valueMm} mm${edges.length > 1 ? ` · ${edges.length} edges` : ""}`,
        type: "chamfer",
        bodyId: options.preview.bodyId,
        targetFeatureId: options.preview.defeatureFeatureId,
        edges,
        distanceMm: options.valueMm,
        enabled: true,
        state: "clean",
        dependencies: [options.preview.defeatureFeatureId],
      };
  document.featureOrder.push(reconstructedFeatureId);
  document.updatedAt = Date.now();
  return { ...options.preview, document, reconstructedFeatureId, valueMm: options.valueMm, edgeCount: edges.length };
};

export interface ImportedHolePreview {
  document: CadDocument<Sketch, Feature>;
  baseFeatureId: string;
  /** Compatibility name: may hold RemoveHole or multi-face Defeature heal Feature. */
  removeHoleFeatureId: string;
  bodyId: string;
  sourceLabel: string;
  diameterMm: number;
  axialLengthMm: number;
  style: HoleStyle;
}

export interface ImportedHoleReconstruction extends ImportedHolePreview {
  reconstructedFeatureId: string;
}

export const createImportedHolePreview = (options: {
  document: CadDocument<Sketch, Feature>;
  bodyId: string;
  targetFeatureId: string;
  cylindricalFace: PersistentFaceRef;
  sourceLabel: string;
  diameterMm: number;
  axialLengthMm: number;
  /** V7: complete recognized Hole feature group for Counterbore/Countersink healing. */
  featureFaces?: PersistentFaceRef[];
  style?: HoleStyle;
}): ImportedHolePreview => {
  if (!options.document.features[options.targetFeatureId] || !options.document.bodies[options.bodyId]) throw new Error("Imported Hole reconstruction target is missing.");
  if (options.cylindricalFace.sourceFeatureId !== options.targetFeatureId) throw new Error("Recognized Hole Face must belong to the target Feature state.");
  if (!Number.isFinite(options.diameterMm) || options.diameterMm <= 0 || !Number.isFinite(options.axialLengthMm) || options.axialLengthMm <= 0) throw new Error("Recognized Hole dimensions must be positive and finite.");
  const document = clone(options.document);
  const style = clone(options.style ?? { type: "simple" as const });
  const featureFaces = options.featureFaces?.length ? options.featureFaces.map(clone) : [];
  if (featureFaces.some((face)=>face.sourceFeatureId!==options.targetFeatureId)) throw new Error("Recognized advanced Hole Faces must belong to the target imported Feature state.");
  const advancedHeal = style.type !== "simple" && featureFaces.length > 1;
  const removeHoleFeatureId = ensureFreeId(document, advancedHeal ? "RecognizedAdvancedHoleDefeature" : "RecognizedHoleFill");
  document.features[removeHoleFeatureId] = advancedHeal ? {
    id: removeHoleFeatureId,
    name: `Recognized ${style.type === "counterbore" ? "Counterbore" : "Countersink"} · Remove / Heal`,
    type: "deleteFace",
    bodyId: options.bodyId,
    targetFeatureId: options.targetFeatureId,
    faces: featureFaces,
    toleranceMm: 0,
    enabled: true,
    state: "clean",
    dependencies: [options.targetFeatureId],
  } : {
    id: removeHoleFeatureId,
    name: `Recognized Hole Ø${options.diameterMm} · Fill / Heal`,
    type: "removeHole",
    bodyId: options.bodyId,
    targetFeatureId: options.targetFeatureId,
    cylindricalFace: clone(options.cylindricalFace),
    enabled: true,
    state: "clean",
    dependencies: [options.targetFeatureId],
  };
  document.featureOrder.push(removeHoleFeatureId); document.updatedAt = Date.now();
  return { document, baseFeatureId: options.targetFeatureId, removeHoleFeatureId, bodyId: options.bodyId, sourceLabel: options.sourceLabel, diameterMm: options.diameterMm, axialLengthMm: options.axialLengthMm, style };
};

export const completeImportedHoleReconstruction = (options: {
  preview: ImportedHolePreview;
  targetFace: PersistentFaceRef;
  center: { x: number; y: number };
  diameterMm: number;
  depth: { type: "throughAll" } | { type: "blind"; valueMm: number };
}): ImportedHoleReconstruction => {
  if (options.targetFace.sourceFeatureId !== options.preview.removeHoleFeatureId) throw new Error("The confirmed planar Face must come from the healed Remove Hole preview state.");
  if (!Number.isFinite(options.center.x) || !Number.isFinite(options.center.y)) throw new Error("Reconstructed Hole center must be finite.");
  if (!Number.isFinite(options.diameterMm) || options.diameterMm <= 0) throw new Error("Reconstructed Hole diameter must be positive and finite.");
  if (options.depth.type === "blind" && (!Number.isFinite(options.depth.valueMm) || options.depth.valueMm <= 0)) throw new Error("Blind Hole depth must be positive and finite.");
  const document = clone(options.preview.document);
  const reconstructedFeatureId = ensureFreeId(document, "ReconstructedHole");
  document.features[reconstructedFeatureId] = {
    id: reconstructedFeatureId,
    name: `Reconstructed Hole Ø${options.diameterMm}`,
    type: "hole",
    bodyId: options.preview.bodyId,
    targetFeatureId: options.preview.removeHoleFeatureId,
    targetFace: clone(options.targetFace),
    center: { ...options.center },
    diameterMm: options.diameterMm,
    depth: clone(options.depth),
    style: clone(options.preview.style),
    enabled: true,
    state: "clean",
    dependencies: [options.preview.removeHoleFeatureId],
  };
  document.featureOrder.push(reconstructedFeatureId); document.updatedAt = Date.now();
  return { ...options.preview, document, reconstructedFeatureId };
};

export const intersectAxisWithPlane = (axisOrigin: {x:number;y:number;z:number}, axisDirection: {x:number;y:number;z:number}, plane: {origin:{x:number;y:number;z:number};normal:{x:number;y:number;z:number}}) => {
  const denominator = axisDirection.x*plane.normal.x + axisDirection.y*plane.normal.y + axisDirection.z*plane.normal.z;
  if (!Number.isFinite(denominator) || Math.abs(denominator) <= 1e-9) throw new Error("Recognized Hole axis is parallel to the selected planar Face.");
  const delta = {x:plane.origin.x-axisOrigin.x,y:plane.origin.y-axisOrigin.y,z:plane.origin.z-axisOrigin.z};
  const t = (delta.x*plane.normal.x + delta.y*plane.normal.y + delta.z*plane.normal.z)/denominator;
  return {x:axisOrigin.x+axisDirection.x*t,y:axisOrigin.y+axisDirection.y*t,z:axisOrigin.z+axisDirection.z*t};
};
