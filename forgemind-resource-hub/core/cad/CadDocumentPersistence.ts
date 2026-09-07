import { createCadDocument, toSerializableCadDocument, CAD_DOCUMENT_SCHEMA_VERSION, type CadDocument, type SerializableCadDocument } from "./CadDocument.ts";
import type { Feature } from "../features/Feature.ts";
import type { Sketch } from "../sketch/Sketch.ts";
import { migratePersistentTopologyRefV1ToV2 } from "../topology/PersistentTopologyRef.ts";
import { DEFAULT_LEGACY_BODY_ID, createCadBody } from "./CadBodies.ts";
import { validateRationalBSplineSections } from "../surface/RationalBSplineSections.ts";
import { validateTensorProductNurbs } from "../surface/TensorProductNurbs.ts";
import { validateNurbsCurve2D } from "../curve/NurbsCurve.ts";
import { nurbsParameterTolerance } from "../curve/NurbsTolerance.ts";
import { validateMechanicalDetail, type MechanicalDetailDefinition } from "../mechanical/MechanicalDetail.ts";

export class CadDocumentError extends Error {
  readonly code: "CAD_DOCUMENT_INVALID" | "CAD_DOCUMENT_VERSION_UNSUPPORTED";
  constructor(code: "CAD_DOCUMENT_INVALID" | "CAD_DOCUMENT_VERSION_UNSUPPORTED", message: string) { super(message); this.name = "CadDocumentError"; this.code = code; }
}

const invalid = (message: string): never => { throw new CadDocumentError("CAD_DOCUMENT_INVALID", message); };
const record = (value: unknown, label: string): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : invalid(`${label} must be an object.`);
const finiteTree = (value: unknown, path = "document"): void => { if (typeof value === "number" && !Number.isFinite(value)) invalid(`${path} contains a non-finite number.`); if (Array.isArray(value)) value.forEach((item, index) => finiteTree(item, `${path}[${index}]`)); else if (value && typeof value === "object") Object.entries(value).forEach(([key, item]) => finiteTree(item, `${path}.${key}`)); };
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const knownFeatures = new Set(["extrude", "pocket", "revolve", "sweep", "loft", "pattern", "linearPattern", "circularPattern", "mirror", "boolean", "hole", "fillet", "chamfer", "shell", "draft", "rib", "bodyTransform", "bodyBoolean", "importedStep", "removeHole", "offsetBody", "planarPushPull", "deleteFace", "healHolePattern", "surfacePatch", "surfaceExtrude", "surfaceRevolve", "surfaceSweep", "surfaceLoft", "extractSurface", "offsetSurface", "sewSurface", "thickenSurface", "encloseSurface", "fillSurface", "trimSurface", "bsplineSurface", "boundarySurface", "splitSurface", "replaceFace", "surfaceIntersection", "mechanicalDetail"]);
const stripRuntimeFields = (feature: Record<string, unknown>): Record<string, unknown> => {
  const design = { ...feature };
  for (const key of ["runtimeShapeId", "shapeId", "shapeRevision", "dirty", "rebuilding", "failed", "blocked", "aliases", "selection"]) delete design[key];
  return design;
};
const migrateRef = (value: unknown): unknown => {
  const ref = record(value, "Persistent topology reference");
  if (ref.version !== 1 && ref.version !== 2) invalid("Persistent topology reference version is unsupported.");
  if ((ref.kind !== "face" && ref.kind !== "edge") || typeof ref.sourceFeatureId !== "string" || !ref.signature || typeof ref.signature !== "object") invalid("Persistent topology reference is malformed.");
  return migratePersistentTopologyRefV1ToV2(ref as Parameters<typeof migratePersistentTopologyRefV1ToV2>[0]);
};
const migrateFeatureRefs = (feature: Record<string, unknown>): Record<string, unknown> => {
  const next = stripRuntimeFields(feature);
  // Pre-P2-M5 holes were all simple cylindrical holes. Make that migration
  // explicit once at the document boundary while keeping in-memory callers
  // backward compatible with an omitted style.
  if (next.type === "hole" && next.style === undefined) next.style = { type: "simple" };
  if (next.targetFace) next.targetFace = migrateRef(next.targetFace);
  if (next.planarFace) next.planarFace = migrateRef(next.planarFace);
  if (Array.isArray(next.edges)) next.edges = next.edges.map(migrateRef);
  if (Array.isArray(next.removeFaces)) next.removeFaces = next.removeFaces.map(migrateRef);
  if (Array.isArray(next.faces)) next.faces = next.faces.map(migrateRef);
  if (next.cylindricalFace) next.cylindricalFace = migrateRef(next.cylindricalFace);
  if (Array.isArray(next.cylindricalFaces)) next.cylindricalFaces = next.cylindricalFaces.map(migrateRef);
  if (Array.isArray(next.boundaryEdges)) next.boundaryEdges = next.boundaryEdges.map(migrateRef);
  if (next.type === "extractSurface" && Array.isArray(next.faces)) next.faces = next.faces.map(migrateRef);
  return next;
};

/** Loads V1/V2 design documents through one deterministic migration boundary. */
export const deserializeCadDocument = (input: unknown): CadDocument<Sketch, Feature> => {
  finiteTree(input); const source = record(input, "CAD document"); const version = source.schemaVersion;
  if (!Number.isInteger(version)) invalid("schemaVersion must be an integer.");
  if ((version as number) > CAD_DOCUMENT_SCHEMA_VERSION) throw new CadDocumentError("CAD_DOCUMENT_VERSION_UNSUPPORTED", `Document schema ${version} is newer than supported schema ${CAD_DOCUMENT_SCHEMA_VERSION}.`);
  if (version !== 1 && version !== 2) invalid(`Unsupported CAD document schema ${version}.`);
  if (typeof source.id !== "string" || !source.id || typeof source.name !== "string" || source.unit !== "mm") invalid("Document id, name and mm unit are required.");
  // Sketch references are migrated on a private clone so loading never mutates
  // caller-owned JSON while every external entity crosses the same boundary.
  const sketches = clone(record(source.sketches, "sketches")); const featureInput = record(source.features, "features"); const order = source.featureOrder;
  if (!Array.isArray(order) || !order.every((id) => typeof id === "string")) invalid("featureOrder must contain feature ids.");
  if (new Set(order).size !== order.length) invalid("featureOrder contains duplicate ids.");
  const sketchIds = Object.keys(sketches); for (const id of sketchIds) {
    const sketch = record(sketches[id], `sketch ${id}`); if (sketch.id !== id) invalid(`Sketch key ${id} does not match its id.`);
    const entities = record(sketch.entities, `sketch ${id}.entities`);
    for (const [entityId, inputEntity] of Object.entries(entities)) {
      const entity = record(inputEntity, `sketch ${id}.entity ${entityId}`);
      if (entity.id !== entityId) invalid(`Sketch ${id} entity key ${entityId} does not match its id.`);
      const validPoint = (input: unknown): boolean => {
        if (!input || typeof input !== "object" || Array.isArray(input)) return false;
        const value = input as { x?: unknown; y?: unknown };
        return typeof value.x === "number" && Number.isFinite(value.x) && typeof value.y === "number" && Number.isFinite(value.y);
      };
      const validVec3 = (input: unknown): boolean => {
        if (!input || typeof input !== "object" || Array.isArray(input)) return false;
        const value = input as { x?: unknown; y?: unknown; z?: unknown };
        return typeof value.x === "number" && Number.isFinite(value.x) && typeof value.y === "number" && Number.isFinite(value.y) && typeof value.z === "number" && Number.isFinite(value.z);
      };
      if (["external-line", "external-circle", "external-arc", "external-bspline"].includes(entity.type as string)) {
        if (typeof entity.sourceFeatureId !== "string" || !entity.sourceFeatureId || !entity.sourceEdge || typeof entity.sourceEdge !== "object") invalid(`External entity ${entityId} has malformed source metadata.`);
        const migrated = migrateRef(entity.sourceEdge) as Record<string, unknown>;
        if (migrated.kind !== "edge" || migrated.sourceFeatureId !== entity.sourceFeatureId) invalid(`External entity ${entityId} must reference an edge from the same source Feature.`);
        const signature = record(migrated.signature, `External entity ${entityId} edge signature`);
        if (signature.kind !== "edge" || typeof signature.curveType !== "string" || !validVec3(signature.normalizedMidpoint)) invalid(`External entity ${entityId} has an invalid persistent edge signature.`);
        if(signature.nurbsFingerprint!==undefined){const fingerprint=record(signature.nurbsFingerprint,`External entity ${entityId} NURBS fingerprint`);
          if(!Number.isInteger(fingerprint.degree)||(fingerprint.degree as number)<1||typeof fingerprint.rational!=="boolean"||typeof fingerprint.periodic!=="boolean"||!Number.isInteger(fingerprint.poleCount)||(fingerprint.poleCount as number)<2||!Array.isArray(fingerprint.normalizedKnots)||!fingerprint.normalizedKnots.every((value)=>typeof value==="number"&&Number.isFinite(value))||!Array.isArray(fingerprint.multiplicities)||!fingerprint.multiplicities.every((value)=>Number.isInteger(value)&&(value as number)>0)||!Array.isArray(fingerprint.normalizedPoles)||!fingerprint.normalizedPoles.every(validVec3))invalid(`External entity ${entityId} has an invalid NURBS topology fingerprint.`);
        }
        entity.sourceEdge = migrated;
      }
      if (entity.type === "external-bspline") {
        const degree = entity.degree;
        if (!Array.isArray(entity.controlPoints)) invalid(`External NURBS ${entityId} has invalid degree or control points.`);
        const controlPoints = entity.controlPoints as unknown[];
        if (!Number.isInteger(degree) || (degree as number) < 1 || controlPoints.length < (degree as number) + 1 || !controlPoints.every(validPoint)) invalid(`External NURBS ${entityId} has invalid degree or control points.`);
        if (!Array.isArray(entity.weights) || entity.weights.length !== controlPoints.length || !entity.weights.every((weight) => typeof weight === "number" && Number.isFinite(weight) && weight > 0)) invalid(`External NURBS ${entityId} has invalid rational weights.`);
        if (!Array.isArray(entity.knots) || !Array.isArray(entity.multiplicities) || entity.knots.length === 0 || entity.knots.length !== entity.multiplicities.length || !entity.knots.every((knot, index) => typeof knot === "number" && Number.isFinite(knot) && (index === 0 || knot > (entity.knots as number[])[index - 1])) || !entity.multiplicities.every((value) => Number.isInteger(value) && (value as number) > 0)) invalid(`External NURBS ${entityId} has invalid knots or multiplicities.`);
        if (typeof entity.firstParameter !== "number" || typeof entity.lastParameter !== "number" || typeof entity.rational !== "boolean" || typeof entity.periodic !== "boolean" || entity.construction !== true || entity.projectionMode !== "coplanar") invalid(`External NURBS ${entityId} has malformed projection metadata.`);
        const multiplicities = entity.multiplicities as number[];
        const knotCount = multiplicities.reduce((sum, value) => sum + value, 0);
        const periodicPoleCount = multiplicities.slice(0, -1).reduce((sum, value) => sum + value, 0);
        if (entity.periodic ? periodicPoleCount !== controlPoints.length : knotCount !== controlPoints.length + (degree as number) + 1) invalid(`External NURBS ${entityId} knot vector does not match its degree and control points.`);
        try { validateNurbsCurve2D(entity as unknown as Parameters<typeof validateNurbsCurve2D>[0]); }
        catch { invalid(`External NURBS ${entityId} has an invalid exact curve domain.`); }
        continue;
      }
      if (entity.type !== "bspline") continue;
      if (!Array.isArray(entity.fitPoints) || entity.fitPoints.length < 3) invalid(`B-Spline ${entityId} requires at least three fit points.`);
      if (!entity.fitPoints.every(validPoint) || typeof entity.closed !== "boolean" || typeof entity.construction !== "boolean") invalid(`B-Spline ${entityId} has malformed fit-point data.`);
      const hasStartTangent = entity.startTangent !== undefined; const hasEndTangent = entity.endTangent !== undefined;
      if (hasStartTangent !== hasEndTangent) invalid(`B-Spline ${entityId} must define both endpoint tangents together.`);
      if (entity.closed && hasStartTangent) invalid(`Closed B-Spline ${entityId} cannot define endpoint tangents.`);
      if (hasStartTangent) {
        if (!validPoint(entity.startTangent) || !validPoint(entity.endTangent)) invalid(`B-Spline ${entityId} has malformed endpoint tangents.`);
        const start = entity.startTangent as { x: number; y: number }; const end = entity.endTangent as { x: number; y: number };
        if (Math.hypot(start.x, start.y) <= 1e-9 || Math.hypot(end.x, end.y) <= 1e-9) invalid(`B-Spline ${entityId} endpoint tangents must be non-zero.`);
      }
      if (entity.nurbs !== undefined) {
        const basis = record(entity.nurbs, `B-Spline ${entityId}.nurbs`);
        try {
          validateNurbsCurve2D({
            degree: basis.degree as number,
            rational: Array.isArray(basis.weights) && (basis.weights as number[]).some((weight) => Math.abs(weight - 1) > 1e-12),
            periodic: basis.periodic as boolean,
            knots: basis.knots as number[],
            multiplicities: basis.multiplicities as number[],
            controlPoints: entity.fitPoints as import("../cad/CadTypes.ts").Vec2[],
            weights: basis.weights as number[],
            firstParameter: basis.firstParameter as number,
            lastParameter: basis.lastParameter as number,
          });
        } catch { invalid(`B-Spline ${entityId} has an invalid exact NURBS basis.`); }
        if (basis.periodic !== entity.closed) invalid(`B-Spline ${entityId} NURBS periodic state must match its closed state.`);
        if (hasStartTangent) invalid(`Exact NURBS ${entityId} cannot also store interpolation endpoint tangents.`);
      }
    }
    const validatePointReferences = (collectionInput: unknown, label: string): void => {
      const collection=record(collectionInput, `sketch ${id}.${label}`);
      for(const [itemId,itemInput] of Object.entries(collection)){
        const item=record(itemInput, `${label} ${itemId}`);if(item.pointRefs===undefined)continue;
        if(!Array.isArray(item.pointRefs))invalid(`${label} ${itemId} pointRefs must be an array.`);
        for(const inputRef of item.pointRefs){const ref=record(inputRef,`${label} ${itemId} point reference`);const entity=entities[ref.entityId as string] as Record<string,unknown>|undefined;
          if(typeof ref.entityId!=="string"||!entity||!["start","end","center","position","curve"].includes(ref.role as string))invalid(`${label} ${itemId} has an invalid point reference.`);
          if(ref.role==="curve"){
            if(entity.type!=="external-bspline"||typeof ref.parameter!=="number"||!Number.isFinite(ref.parameter))invalid(`${label} ${itemId} curve reference requires a finite external NURBS parameter.`);
            const first=entity.firstParameter as number,last=entity.lastParameter as number,tolerance=nurbsParameterTolerance(first,last);
            if((ref.parameter as number)<first-tolerance||(ref.parameter as number)>last+tolerance)invalid(`${label} ${itemId} curve parameter lies outside the trimmed NURBS edge.`);
          }else if(ref.parameter!==undefined)invalid(`${label} ${itemId} stores a parameter on a non-curve point reference.`);
        }
      }
    };
    validatePointReferences(sketch.constraints,"constraints");validatePointReferences(sketch.dimensions,"dimensions");
  }
  const features: Record<string, Record<string, unknown>> = {};
  for (const [id, inputFeature] of Object.entries(featureInput)) {
    const feature = migrateFeatureRefs(record(inputFeature, `feature ${id}`));
    if (feature.id !== id || typeof feature.type !== "string" || !knownFeatures.has(feature.type)) invalid(`Feature ${id} has an invalid id or type.`);
    if (!Array.isArray(feature.dependencies) || !feature.dependencies.every((dependency) => typeof dependency === "string")) invalid(`Feature ${id} has invalid dependencies.`);
    features[id] = feature;
  }
  // Early surface-matching builds stored a one-time copied net plus an explicit
  // dependency, but no reproducible relation parameters. Preserve that shape
  // and remove only the inert dependency so those local documents still open.
  for (const feature of Object.values(features)) {
    if (feature.type === "bsplineSurface" && feature.boundaryMatch === undefined && feature.boundaryMatches === undefined && Array.isArray(feature.dependencies) && feature.dependencies.length) {
      feature.dependencies = [];
    }
  }
  const featureIds = Object.keys(features); if (order.length !== featureIds.length || order.some((id) => !features[id])) invalid("featureOrder must contain every feature exactly once.");
  for (const [id, feature] of Object.entries(features)) {
    for (const dependency of feature.dependencies as string[]) if (!features[dependency]) invalid(`Feature ${id} has a dangling dependency ${dependency}.`);
    if (["extrude", "pocket", "revolve", "surfacePatch", "surfaceExtrude", "surfaceRevolve"].includes(feature.type as string) && (typeof feature.sketchId !== "string" || !sketches[feature.sketchId])) invalid(`Feature ${id} has a dangling sketch reference.`);
    if ((feature.type === "sweep" || feature.type === "surfaceSweep") && (typeof feature.profileSketchId !== "string" || typeof feature.pathSketchId !== "string" || !sketches[feature.profileSketchId] || !sketches[feature.pathSketchId])) invalid(`Feature ${id} has a dangling Sweep sketch reference.`);
    if (feature.type === "surfaceSweep") {
      if (!['followPath','fixedUp','guide'].includes(feature.orientation as string)) invalid(`Feature ${id} has an invalid Surface Sweep orientation.`);
      if (feature.guideSketchId !== undefined && (typeof feature.guideSketchId !== "string" || !sketches[feature.guideSketchId])) invalid(`Feature ${id} has a dangling Surface Sweep guide sketch reference.`);
      if (feature.orientation === "guide" && (typeof feature.guideSketchId !== "string" || !sketches[feature.guideSketchId])) invalid(`Feature ${id} requires a valid Surface Sweep guide sketch.`);
      if (feature.orientation === "fixedUp") {
        const up = record(feature.upDirection, `Feature ${id}.upDirection`);
        const components = [up.x, up.y, up.z];
        if (!components.every((value) => typeof value === "number" && Number.isFinite(value)) || Math.hypot(...components as number[]) <= 1e-9) invalid(`Feature ${id} requires a finite non-zero Surface Sweep direction.`);
      }
    }
    if ((feature.type === "loft" || feature.type === "surfaceLoft") && (!Array.isArray(feature.sectionSketchIds) || feature.sectionSketchIds.length < 2 || !feature.sectionSketchIds.every((section) => typeof section === "string" && !!sketches[section]))) invalid(`Feature ${id} has invalid Loft section sketches.`);
    if (feature.type === "loft" || feature.type === "surfaceLoft") for (const key of ["startCondition", "endCondition"] as const) if (feature[key] !== undefined) {
      if (feature.ruled || feature.closed) invalid(`Feature ${id} cannot combine Loft end controls with ruled or closed mode.`);
      const condition = record(feature[key], `Feature ${id}.${key}`);
      if (!['G1','G2'].includes(condition.continuity as string) || typeof condition.lengthMm !== "number" || !Number.isFinite(condition.lengthMm) || (condition.lengthMm as number) <= 0) invalid(`Feature ${id} has an invalid Loft end condition.`);
      if (condition.direction !== undefined) { const direction = record(condition.direction, `Feature ${id}.${key}.direction`); if (![direction.x, direction.y, direction.z].every((value) => typeof value === "number" && Number.isFinite(value)) || Math.hypot(direction.x as number, direction.y as number, direction.z as number) <= 1e-12) invalid(`Feature ${id} has an invalid Loft end direction.`); }
    }
    if (["extrude","revolve","sweep","loft"].includes(feature.type as string)) {
      const operation=feature.type==="loft"?(feature.operation??"new"):feature.operation;
      if(!["new","add","remove","intersect"].includes(operation as string))invalid(`Feature ${id} has an invalid solid operation.`);
      if(operation!=="new"&&(typeof feature.targetFeatureId!=="string"||!features[feature.targetFeatureId]))invalid(`Feature ${id} has a dangling Boolean target Feature.`);
      if(feature.profileIds!==undefined&&(!Array.isArray(feature.profileIds)||!feature.profileIds.every((profileId)=>typeof profileId==="string")))invalid(`Feature ${id} has invalid selected Sketch regions.`);
    }
    if(feature.type==="extrude"){
      const direction=feature.direction??"positive";
      if(!["positive","negative","symmetric","twoSided"].includes(direction as string))invalid(`Feature ${id} has an invalid Extrude direction.`);
      if(direction==="twoSided"&&(typeof feature.secondDistance!=="number"||feature.secondDistance<=0))invalid(`Feature ${id} requires a positive opposite-side Extrude distance.`);
    }
    if(feature.type==="loft"&&feature.sectionProfileIds!==undefined){
      if(!Array.isArray(feature.sectionProfileIds)||feature.sectionProfileIds.length!==(feature.sectionSketchIds as unknown[]).length||!feature.sectionProfileIds.every((entry)=>Array.isArray(entry)&&entry.every((profileId)=>typeof profileId==="string")))invalid(`Feature ${id} has invalid Loft region selections.`);
    }
    if (["pocket", "hole", "fillet", "chamfer", "shell", "draft", "rib", "linearPattern", "circularPattern", "mirror", "removeHole", "offsetBody", "planarPushPull", "deleteFace", "healHolePattern", "extractSurface", "offsetSurface", "thickenSurface", "trimSurface", "splitSurface", "replaceFace"].includes(feature.type as string) && (typeof feature.targetFeatureId !== "string" || !features[feature.targetFeatureId])) invalid(`Feature ${id} has a dangling target Feature.`);
    if (["linearPattern", "circularPattern", "mirror"].includes(feature.type as string) && (!Array.isArray(feature.seedFeatureIds) || !feature.seedFeatureIds.every((seed) => typeof seed === "string" && !!features[seed]))) invalid(`Feature ${id} has invalid Pattern seed Features.`);
    if (feature.type === "linearPattern" && typeof feature.direction === "object") { const direction = record(feature.direction, `Feature ${id}.direction`); for (const key of ["x","y","z"]) if (typeof direction[key] !== "number" || !Number.isFinite(direction[key] as number)) invalid(`Feature ${id} has invalid arbitrary Pattern direction.`); }
    const refs = [feature.targetFace, feature.cylindricalFace, feature.planarFace, ...(Array.isArray(feature.faces) ? feature.faces : []), ...(Array.isArray(feature.edges) ? feature.edges : []), ...(Array.isArray(feature.removeFaces) ? feature.removeFaces : []), ...(Array.isArray(feature.cylindricalFaces) ? feature.cylindricalFaces : []), ...(Array.isArray(feature.boundaryEdges) ? feature.boundaryEdges : [])].filter(Boolean) as Array<{ sourceFeatureId: string }>;
    for (const ref of refs) if (!features[ref.sourceFeatureId]) invalid(`Feature ${id} has a dangling topology source.`);
    if (feature.type === "hole" && (!(typeof feature.diameterMm === "number") || feature.diameterMm <= 0)) invalid(`Feature ${id} has an invalid Hole diameter.`);
    if (feature.type === "fillet" && (!(typeof feature.radiusMm === "number") || !Number.isFinite(feature.radiusMm) || feature.radiusMm <= 0 || (feature.endRadiusMm !== undefined && (!(typeof feature.endRadiusMm === "number") || feature.endRadiusMm <= 0 || !Number.isFinite(feature.endRadiusMm))))) invalid(`Feature ${id} has invalid Fillet radii.`);
    if (feature.type === "fillet" && feature.endRadiusMm !== undefined && (!Array.isArray(feature.edges) || feature.edges.length !== 1)) invalid(`Feature ${id} Variable Fillet requires exactly one Edge.`);
    if (feature.type === "rib" && (typeof feature.sketchId !== "string" || !sketches[feature.sketchId] || !(typeof feature.thicknessMm === "number") || feature.thicknessMm <= 0 || !(typeof feature.heightMm === "number") || feature.heightMm <= 0)) invalid(`Feature ${id} has invalid Rib parameters.`);
    if (feature.type === "shell" && (!(typeof feature.thicknessMm === "number") || feature.thicknessMm <= 0)) invalid(`Feature ${id} has an invalid Shell thickness.`);
    if ((feature.type === "offsetBody" || feature.type === "planarPushPull") && (typeof feature.distanceMm !== "number" || Math.abs(feature.distanceMm) <= 1e-12)) invalid(`Feature ${id} has an invalid direct-edit distance.`);
    if (feature.type === "deleteFace" && (!Array.isArray(feature.faces) || feature.faces.length === 0 || typeof feature.toleranceMm !== "number" || feature.toleranceMm < 0)) invalid(`Feature ${id} has invalid Defeature parameters.`);
    if (feature.type === "healHolePattern" && (!Array.isArray(feature.cylindricalFaces) || feature.cylindricalFaces.length < 2)) invalid(`Feature ${id} has invalid imported Hole Pattern member references.`);
    if (feature.type === "surfaceExtrude" && (typeof feature.distanceMm !== "number" || Math.abs(feature.distanceMm) <= 1e-12)) invalid(`Feature ${id} has an invalid Surface Extrude distance.`);
    if (feature.type === "surfaceRevolve" && (typeof feature.angleDeg !== "number" || Math.abs(feature.angleDeg) <= 1e-12)) invalid(`Feature ${id} has an invalid Surface Revolve angle.`);
    if (feature.type === "extractSurface" && (!Array.isArray(feature.faces) || feature.faces.length === 0)) invalid(`Feature ${id} has no extracted Faces.`);
    if (feature.type === "offsetSurface" && (typeof feature.distanceMm !== "number" || Math.abs(feature.distanceMm) <= 1e-12)) invalid(`Feature ${id} has an invalid Surface Offset.`);
    if (feature.type === "sewSurface" && (!Array.isArray(feature.sourceFeatureIds) || feature.sourceFeatureIds.length < 2 || !feature.sourceFeatureIds.every((source) => typeof source === "string" && !!features[source]))) invalid(`Feature ${id} has invalid Surface Sew sources.`);
    if (feature.type === "thickenSurface" && (typeof feature.thicknessMm !== "number" || Math.abs(feature.thicknessMm) <= 1e-12)) invalid(`Feature ${id} has an invalid Surface Thicken thickness.`);
    if (feature.type === "encloseSurface" && (!Array.isArray(feature.sourceFeatureIds) || feature.sourceFeatureIds.length < 2 || !feature.sourceFeatureIds.every((source) => typeof source === "string" && !!features[source]))) invalid(`Feature ${id} has invalid Surface Enclose sources.`);
    if (feature.type === "fillSurface" && (!Array.isArray(feature.boundaryEdges) || feature.boundaryEdges.length === 0 || typeof feature.toleranceMm !== "number" || feature.toleranceMm < 0)) invalid(`Feature ${id} has invalid Fill Surface boundary.`);
    if (feature.type === "trimSurface" && (typeof feature.toolFeatureId !== "string" || !features[feature.toolFeatureId] || (feature.keep !== "outside" && feature.keep !== "inside") || typeof feature.toleranceMm !== "number" || feature.toleranceMm < 0)) invalid(`Feature ${id} has invalid Trim Surface parameters.`);
    if (feature.type === "bsplineSurface") {
      if (!Array.isArray(feature.controlNet) || feature.controlNet.length < 2 || !Array.isArray(feature.controlNet[0]) || feature.controlNet[0].length < 2) invalid(`Feature ${id} has an invalid B-spline control net.`);
      const cols = feature.controlNet[0].length;
      if (!feature.controlNet.every((row: unknown) => Array.isArray(row) && row.length === cols && row.every((point: unknown) => { const p = point as {x?:unknown;y?:unknown;z?:unknown}; return typeof p?.x === "number" && Number.isFinite(p.x) && typeof p?.y === "number" && Number.isFinite(p.y) && typeof p?.z === "number" && Number.isFinite(p.z); }))) invalid(`Feature ${id} has a malformed B-spline control net.`);
      if (feature.rationalSections !== undefined) {
        const definition = record(feature.rationalSections, `Feature ${id}.rationalSections`);
        const validation = validateRationalBSplineSections(feature.controlNet as import("../cad/CadTypes.ts").Vec3[][], definition as unknown as import("../surface/RationalBSplineSections.ts").RationalBSplineSectionDefinition);
        if (!validation.valid) invalid(`Feature ${id} has invalid rational B-spline sections: ${validation.issues.join(" ")}`);
      }
      if (feature.tensorNurbs !== undefined) {
        const definition = record(feature.tensorNurbs, `Feature ${id}.tensorNurbs`);
        const validation = validateTensorProductNurbs(feature.controlNet as import("../cad/CadTypes.ts").Vec3[][], definition as unknown as import("../surface/TensorProductNurbs.ts").TensorProductNurbsDefinition);
        if (!validation.valid) invalid(`Feature ${id} has invalid tensor-product NURBS data: ${validation.issues.join(" ")}`);
        if (feature.rationalSections !== undefined) invalid(`Feature ${id} cannot contain both tensor-product NURBS and legacy rational-section data.`);
      }
      if (feature.boundaryMatch !== undefined && feature.boundaryMatches !== undefined) invalid(`Feature ${id} cannot contain both legacy and multi-edge B-spline relations.`);
      const matchesInput = feature.boundaryMatches !== undefined ? feature.boundaryMatches : feature.boundaryMatch !== undefined ? [feature.boundaryMatch] : [];
      if (!Array.isArray(matchesInput) || matchesInput.length > 4) invalid(`Feature ${id} has an invalid number of B-spline boundary relations.`);
      const targetEdges = new Set<string>(); const sourceIds: string[] = [];
      for (const [matchIndex, matchInput] of matchesInput.entries()) {
        const match = record(matchInput, `Feature ${id}.boundaryMatches[${matchIndex}]`);
        if (typeof match.sourceFeatureId !== "string" || match.sourceFeatureId === id || !features[match.sourceFeatureId as string] || (features[match.sourceFeatureId as string] as Feature).type !== "bsplineSurface") invalid(`Feature ${id} has an invalid B-spline match source.`);
        if (!['uMin','uMax','vMin','vMax'].includes(match.sourceEdge as string) || !['uMin','uMax','vMin','vMax'].includes(match.targetEdge as string) || !['G0','G1','G2'].includes(match.continuity as string)) invalid(`Feature ${id} has invalid B-spline boundary match settings.`);
        if (targetEdges.has(match.targetEdge as string)) invalid(`Feature ${id} drives the same B-spline target edge more than once.`); targetEdges.add(match.targetEdge as string);
        if (match.tangentScale !== undefined && (typeof match.tangentScale !== "number" || !Number.isFinite(match.tangentScale) || (match.tangentScale as number) <= 0)) invalid(`Feature ${id} has an invalid B-spline tangent scale.`);
        if (match.reverse !== undefined && typeof match.reverse !== "boolean") invalid(`Feature ${id} has an invalid B-spline boundary direction.`);
        if (match.adaptTargetBoundaryCount !== undefined && typeof match.adaptTargetBoundaryCount !== "boolean") invalid(`Feature ${id} has an invalid B-spline boundary adaptation flag.`);
        sourceIds.push(match.sourceFeatureId as string);
        if (order.indexOf(match.sourceFeatureId as string) >= order.indexOf(id)) invalid(`Feature ${id} B-spline match source must appear earlier in feature history.`);
      }
      if (matchesInput.length) {
        const expected = [...new Set(sourceIds)]; const actual = [...new Set(feature.dependencies as string[])];
        if (expected.length !== actual.length || expected.some((sourceId) => !actual.includes(sourceId))) invalid(`Feature ${id} B-spline dependencies do not match its boundary relations.`);
      } else if ((feature.dependencies as unknown[]).length) {
        invalid(`Feature ${id} has B-spline dependencies without a boundary relation.`);
      }
    }
    if (feature.type === "boundarySurface" && (!Array.isArray(feature.boundaryEdges) || feature.boundaryEdges.length < 2 || !["G0","G1","G2"].includes(feature.continuity) || typeof feature.toleranceMm !== "number" || feature.toleranceMm < 0)) invalid(`Feature ${id} has invalid Boundary Surface parameters.`);
    if (feature.type === "boundarySurface" && feature.verification !== undefined) {
      const verification = record(feature.verification, `Feature ${id}.verification`);
      if (!Number.isInteger(verification.sampleCount) || (verification.sampleCount as number) < 3 || (verification.sampleCount as number) > 31 || typeof verification.angularToleranceDeg !== "number" || !Number.isFinite(verification.angularToleranceDeg) || (verification.angularToleranceDeg as number) <= 0 || typeof verification.curvatureTolerance !== "number" || !Number.isFinite(verification.curvatureTolerance) || (verification.curvatureTolerance as number) <= 0) invalid(`Feature ${id} has invalid Boundary Surface verification settings.`);
    }
    if (feature.type === "splitSurface" && (typeof feature.toolFeatureId !== "string" || !features[feature.toolFeatureId] || typeof feature.toleranceMm !== "number" || feature.toleranceMm < 0)) invalid(`Feature ${id} has invalid Split Surface parameters.`);
    if (feature.type === "replaceFace" && (typeof feature.replacementFeatureId !== "string" || !features[feature.replacementFeatureId] || !feature.targetFace || typeof feature.toleranceMm !== "number" || feature.toleranceMm < 0)) invalid(`Feature ${id} has invalid Replace Face parameters.`);
    if (feature.type === "surfaceIntersection" && (!Array.isArray(feature.sourceFeatureIds) || feature.sourceFeatureIds.length !== 2 || feature.sourceFeatureIds[0] === feature.sourceFeatureIds[1] || !feature.sourceFeatureIds.every((source) => typeof source === "string" && !!features[source]) || typeof feature.toleranceMm !== "number" || feature.toleranceMm < 0)) invalid(`Feature ${id} has invalid Surface Intersection sources.`);
    if (feature.type === "mechanicalDetail") {
      const detail = record(feature.detail, `Feature ${id}.detail`) as unknown as MechanicalDetailDefinition;
      if (!["externalThread", "spurGear", "bearing", "cableSweep"].includes(detail.kind)) invalid(`Feature ${id} has an unsupported mechanical detail kind.`);
      const issues = validateMechanicalDetail(detail);
      if (issues.length) invalid(`Feature ${id} has invalid mechanical detail parameters: ${issues.join(" ")}`);
      if ((feature.dependencies as unknown[]).length) invalid(`Feature ${id} mechanical detail must not contain dependencies.`);
    }
  }
  const sourceBodies = source.bodies === undefined ? {} : record(source.bodies, "bodies");
  const bodies = clone(sourceBodies) as Record<string, import("./CadTypes.ts").CadBody>;
  // A feature-bearing document created before P2-M6 was single-body by
  // definition. Materialize that fact once at the persistence boundary so
  // legacy data loads deterministically without changing IDs or sketches.
  if (Object.keys(bodies).length === 0 && featureIds.length) bodies[DEFAULT_LEGACY_BODY_ID] = createCadBody(DEFAULT_LEGACY_BODY_ID);
  for (const [id, body] of Object.entries(bodies)) {
    if (!body || body.id !== id || typeof body.name !== "string" || (body.backend !== "brep" && body.backend !== "legacy-mesh") || (body.bodyType !== undefined && body.bodyType !== "solid" && body.bodyType !== "surface" && body.bodyType !== "curve") || typeof body.visible !== "boolean") invalid(`Body ${id} is malformed.`);
    if (body.appearance !== undefined) {
      const appearance = record(body.appearance, `Body ${id}.appearance`);
      if (appearance.color !== undefined && typeof appearance.color !== "string") invalid(`Body ${id} has an invalid appearance color.`);
      for (const key of ["metalness", "roughness"] as const) if (appearance[key] !== undefined && (typeof appearance[key] !== "number" || !Number.isFinite(appearance[key]))) invalid(`Body ${id} has invalid appearance metadata.`);
    }
    if (body.engineering !== undefined) {
      const engineering = record(body.engineering, `Body ${id}.engineering`);
      for (const key of ["material", "process", "group"] as const) if (engineering[key] !== undefined && typeof engineering[key] !== "string") invalid(`Body ${id} has invalid engineering metadata.`);
      for (const key of ["densityKgM3", "toleranceMm"] as const) if (engineering[key] !== undefined && (typeof engineering[key] !== "number" || !Number.isFinite(engineering[key]))) invalid(`Body ${id} has invalid engineering numeric metadata.`);
    }
    if (body.sourceResource !== undefined) {
      const sourceResource = record(body.sourceResource, `Body ${id}.sourceResource`);
      if (typeof sourceResource.resourceId !== "string" || typeof sourceResource.resourceCode !== "string" || typeof sourceResource.resourceTitle !== "string" || (sourceResource.sourcePartId !== undefined && typeof sourceResource.sourcePartId !== "string")) invalid(`Body ${id} has invalid Resource Hub provenance.`);
    }
  }
  const defaultBodyId = Object.keys(bodies).sort()[0];
  for (const feature of Object.values(features)) {
    if (defaultBodyId && feature.bodyId === undefined && !(feature.type === "extrude" && typeof feature.targetBodyId === "string")) feature.bodyId = defaultBodyId;
    if (feature.bodyId !== undefined && (typeof feature.bodyId !== "string" || !bodies[feature.bodyId as string])) invalid(`Feature ${feature.id as string} references a missing Body.`);
    if (feature.type === "bodyTransform" && (typeof feature.inputFeatureId !== "string" || !features[feature.inputFeatureId as string] || feature.bodyId === undefined)) invalid(`Body Transform ${feature.id as string} is malformed.`);
    if (feature.type === "bodyBoolean") {
      const target = record(feature.target, `Body Boolean ${feature.id as string}.target`); const tools = feature.tools;
      if (feature.bodyId === undefined || target.bodyId !== feature.bodyId || typeof target.featureId !== "string" || !features[target.featureId] || !Array.isArray(tools) || tools.length === 0) invalid(`Body Boolean ${feature.id as string} is malformed.`);
      for (const tool of tools) { const ref = record(tool, `Body Boolean ${feature.id as string}.tool`); if (typeof ref.bodyId !== "string" || typeof ref.featureId !== "string" || !bodies[ref.bodyId] || !features[ref.featureId]) invalid(`Body Boolean ${feature.id as string} has a missing Body state reference.`); }
    }
    if (feature.type === "importedStep" && (typeof feature.bodyId !== "string" || typeof feature.stepAssetId !== "string" || (feature.solidKey !== undefined && typeof feature.solidKey !== "string") || !Number.isInteger(feature.solidOrdinal) || feature.solidOrdinal < 0 || !feature.sourceSignature || typeof feature.sourceSignature !== "object")) invalid(`Imported STEP ${feature.id as string} is malformed.`);
  }
  const activeBodyId = typeof source.activeBodyId === "string" ? source.activeBodyId : defaultBodyId;
  if (activeBodyId !== undefined && !bodies[activeBodyId]) invalid("activeBodyId references a missing Body.");
  return createCadDocument<Sketch, Feature>({ id: source.id, name: source.name, unit: "mm", sketches: clone(sketches) as Record<string, Sketch>, features: clone(features) as Record<string, Feature>, featureOrder: [...order], bodies, activeBodyId, updatedAt: typeof source.updatedAt === "number" && Number.isFinite(source.updatedAt) ? source.updatedAt : 0 });
};

const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((key) => [key, stable((value as Record<string, unknown>)[key])])) : value;
/** Canonical design-only output: execution order is retained, object insertion order is not. */
export const canonicalSerializeCadDocument = (document: CadDocument): string => JSON.stringify(stable(toSerializableCadDocument(document)));
/** Stable non-cryptographic design fingerprint for runtime currency diagnostics. */
export const computeCadDocumentFingerprint = (document: CadDocument): string => { let hash = 2166136261; for (const character of canonicalSerializeCadDocument(document)) { hash ^= character.charCodeAt(0); hash = Math.imul(hash, 16777619); } return `cad-${(hash >>> 0).toString(16).padStart(8, "0")}`; };
export const serializeCadDocument = (document: CadDocument): SerializableCadDocument => JSON.parse(canonicalSerializeCadDocument(document)) as SerializableCadDocument;
