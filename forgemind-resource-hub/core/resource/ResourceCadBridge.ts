import { createCadBody, withDerivedBodyTips } from "../cad/CadBodies.ts";
import { createCadDocument, type CadDocument } from "../cad/CadDocument.ts";
import type { CadBody } from "../cad/CadTypes.ts";
import type { BodyTransformFeature } from "../features/BodyTransformFeature.ts";
import type { ExtrudeFeature } from "../features/ExtrudeFeature.ts";
import type { Feature } from "../features/Feature.ts";
import type { RevolveFeature } from "../features/RevolveFeature.ts";
import type { MechanicalDetailFeature } from "../features/MechanicalDetailFeature.ts";
import type { Sketch } from "../sketch/Sketch.ts";
import type { ResourceModelPart, ModelingResourceTemplate } from "./ResourceModeling.ts";

const METERS_TO_MM = 1000;
const EPSILON_MM = 0.01;
const safeKey = (value: string) => value.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "resource";
const mm = (value: number, fallback = 1) => Math.max(EPSILON_MM, Math.abs(Number.isFinite(value) ? value * METERS_TO_MM : fallback));
const positionMm = (value: number) => (Number.isFinite(value) ? value : 0) * METERS_TO_MM;
const radiansToDegrees = (value: number | undefined) => Number.isFinite(value) ? (value! * 180) / Math.PI : 0;

export interface ResourceCadBuildResult {
  document: CadDocument<Sketch, Feature>;
  warnings: string[];
  sourcePartToBody: Record<string, string>;
}

const rectangleSketch = (id: string, name: string, widthMm: number, depthMm: number, heightMm: number): Sketch => ({
  id,
  name,
  plane: { type: "XZ", offset: -heightMm / 2 },
  entities: {
    a: { id: "a", type: "line", start: { x: -widthMm / 2, y: -depthMm / 2 }, end: { x: widthMm / 2, y: -depthMm / 2 }, construction: false },
    b: { id: "b", type: "line", start: { x: widthMm / 2, y: -depthMm / 2 }, end: { x: widthMm / 2, y: depthMm / 2 }, construction: false },
    c: { id: "c", type: "line", start: { x: widthMm / 2, y: depthMm / 2 }, end: { x: -widthMm / 2, y: depthMm / 2 }, construction: false },
    d: { id: "d", type: "line", start: { x: -widthMm / 2, y: depthMm / 2 }, end: { x: -widthMm / 2, y: -depthMm / 2 }, construction: false },
  },
  entityOrder: ["a", "b", "c", "d"],
  constraints: {
    c1: { id: "c1", type: "coincident", entityIds: ["a", "b"], pointRefs: [{ entityId: "a", role: "end" }, { entityId: "b", role: "start" }], enabled: true },
    c2: { id: "c2", type: "coincident", entityIds: ["b", "c"], pointRefs: [{ entityId: "b", role: "end" }, { entityId: "c", role: "start" }], enabled: true },
    c3: { id: "c3", type: "coincident", entityIds: ["c", "d"], pointRefs: [{ entityId: "c", role: "end" }, { entityId: "d", role: "start" }], enabled: true },
    c4: { id: "c4", type: "coincident", entityIds: ["d", "a"], pointRefs: [{ entityId: "d", role: "end" }, { entityId: "a", role: "start" }], enabled: true },
    h1: { id: "h1", type: "horizontal", entityIds: ["a"], enabled: true }, h2: { id: "h2", type: "horizontal", entityIds: ["c"], enabled: true },
    v1: { id: "v1", type: "vertical", entityIds: ["b"], enabled: true }, v2: { id: "v2", type: "vertical", entityIds: ["d"], enabled: true },
    anchor: { id: "anchor", type: "fixed", entityIds: ["a"], pointRefs: [{ entityId: "a", role: "start" }], enabled: true },
  },
  dimensions: {
    width: { id: "width", name: "Width", type: "horizontalDistance", entityIds: ["a"], pointRefs: [{ entityId: "a", role: "start" }, { entityId: "a", role: "end" }], value: widthMm, driving: true },
    depth: { id: "depth", name: "Depth", type: "verticalDistance", entityIds: ["a", "b"], pointRefs: [{ entityId: "a", role: "end" }, { entityId: "b", role: "end" }], value: depthMm, driving: true },
  },
});

const circleExtrudeSketch = (id: string, name: string, radiusMm: number, heightMm: number): Sketch => ({
  id,
  name,
  plane: { type: "XZ", offset: -heightMm / 2 },
  entities: { circle: { id: "circle", type: "circle", center: { x: 0, y: 0 }, radius: radiusMm, construction: false } },
  entityOrder: ["circle"],
  constraints: { center: { id: "center", type: "fixed", entityIds: ["circle"], pointRefs: [{ entityId: "circle", role: "center" }], enabled: true } },
  dimensions: { radius: { id: "radius", name: "Radius", type: "radius", entityIds: ["circle"], value: radiusMm, driving: true } },
});

const coneSketch = (id: string, name: string, radiusMm: number, heightMm: number): Sketch => ({
  id,
  name,
  plane: { type: "XY", offset: 0 },
  entities: {
    axis: { id: "axis", type: "line", start: { x: 0, y: -heightMm / 2 }, end: { x: 0, y: heightMm / 2 }, construction: false },
    slope: { id: "slope", type: "line", start: { x: 0, y: heightMm / 2 }, end: { x: radiusMm, y: -heightMm / 2 }, construction: false },
    base: { id: "base", type: "line", start: { x: radiusMm, y: -heightMm / 2 }, end: { x: 0, y: -heightMm / 2 }, construction: false },
  },
  entityOrder: ["axis", "slope", "base"],
  constraints: {},
  dimensions: {},
});

const torusSketch = (id: string, name: string, majorRadiusMm: number, tubeRadiusMm: number): Sketch => ({
  id,
  name,
  plane: { type: "XY", offset: 0 },
  entities: { circle: { id: "circle", type: "circle", center: { x: majorRadiusMm, y: 0 }, radius: tubeRadiusMm, construction: false } },
  entityOrder: ["circle"],
  constraints: {},
  dimensions: {},
});

const createPrimitiveFeature = (
  part: ResourceModelPart,
  bodyId: string,
  sketchId: string,
  featureId: string,
  sketches: Record<string, Sketch>,
  warnings: string[],
): Feature => {
  if (part.mechanicalDetail) {
    return { id: featureId, name: part.label, type: "mechanicalDetail", detail: structuredClone(part.mechanicalDetail), bodyId, enabled: true, state: "clean", dependencies: [] } satisfies MechanicalDetailFeature;
  }
  const widthMm = mm(part.width);
  const heightMm = mm(part.height);
  const depthMm = mm(part.depth);
  if (part.type === "box") {
    sketches[sketchId] = rectangleSketch(sketchId, `${part.label} · Base Sketch`, widthMm, depthMm, heightMm);
    return { id: featureId, name: `${part.label} · Extrude`, type: "extrude", sketchId, distance: heightMm, direction: "positive", operation: "new", bodyId, targetBodyId: bodyId, enabled: true, state: "clean", dependencies: [] } satisfies ExtrudeFeature;
  }
  if (part.type === "cylinder") {
    if (Math.abs(widthMm - depthMm) > 0.1) warnings.push(`${part.label}: legacy cylinder has non-uniform X/Z scale; B-Rep bridge uses the smaller radial diameter to keep an exact analytic cylinder.`);
    const radiusMm = Math.min(widthMm, depthMm) / 2;
    sketches[sketchId] = circleExtrudeSketch(sketchId, `${part.label} · Circle`, radiusMm, heightMm);
    return { id: featureId, name: `${part.label} · Cylinder`, type: "extrude", sketchId, distance: heightMm, direction: "positive", operation: "new", bodyId, targetBodyId: bodyId, enabled: true, state: "clean", dependencies: [] } satisfies ExtrudeFeature;
  }
  if (part.type === "cone") {
    if (Math.abs(widthMm - depthMm) > 0.1) warnings.push(`${part.label}: legacy cone has non-uniform X/Z scale; B-Rep bridge converts it to an exact circular cone.`);
    const radiusMm = Math.min(widthMm, depthMm) / 2;
    sketches[sketchId] = coneSketch(sketchId, `${part.label} · Revolve Profile`, radiusMm, heightMm);
    return { id: featureId, name: `${part.label} · Revolve`, type: "revolve", sketchId, axis: { origin: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 1, z: 0 } }, angleDeg: 360, operation: "new", bodyId, targetBodyId: bodyId, enabled: true, state: "clean", dependencies: [] } satisfies RevolveFeature;
  }
  if (Math.abs(widthMm - depthMm) > 0.1) warnings.push(`${part.label}: legacy torus has non-uniform X/Z scale; B-Rep bridge converts it to an exact rotational torus.`);
  const outerRadiusMm = Math.min(widthMm, depthMm) / 2;
  const tubeRadiusMm = Math.min(heightMm / 2, outerRadiusMm * 0.45);
  const majorRadiusMm = Math.max(tubeRadiusMm + EPSILON_MM, outerRadiusMm - tubeRadiusMm);
  sketches[sketchId] = torusSketch(sketchId, `${part.label} · Torus Profile`, majorRadiusMm, tubeRadiusMm);
  return { id: featureId, name: `${part.label} · Torus Revolve`, type: "revolve", sketchId, axis: { origin: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 1, z: 0 } }, angleDeg: 360, operation: "new", bodyId, targetBodyId: bodyId, enabled: true, state: "clean", dependencies: [] } satisfies RevolveFeature;
};

const addTransforms = (part: ResourceModelPart, bodyId: string, previousFeatureId: string, features: Record<string, Feature>, featureOrder: string[]): string => {
  let previous = previousFeatureId;
  const rotations: Array<["X" | "Y" | "Z", number]> = [
    ["X", radiansToDegrees(part.rotationX)],
    ["Y", radiansToDegrees(part.rotationY)],
    ["Z", radiansToDegrees(part.rotationZ)],
  ];
  for (const [axis, angleDeg] of rotations) {
    if (Math.abs(angleDeg) < 1e-9) continue;
    const id = `${previousFeatureId}-rotate-${axis.toLowerCase()}`;
    const feature: BodyTransformFeature = { id, name: `${part.label} · Rotate ${axis}`, type: "bodyTransform", bodyId, inputFeatureId: previous, translationMm: { x: 0, y: 0, z: 0 }, rotation: { axis, angleDeg }, enabled: true, state: "clean", dependencies: [previous] };
    features[id] = feature; featureOrder.push(id); previous = id;
  }
  const translation = { x: positionMm(part.x), y: positionMm(part.y), z: positionMm(part.z) };
  if ([translation.x, translation.y, translation.z].some((value) => Math.abs(value) > 1e-9)) {
    const id = `${previousFeatureId}-position`;
    const feature: BodyTransformFeature = { id, name: `${part.label} · Position`, type: "bodyTransform", bodyId, inputFeatureId: previous, translationMm: translation, enabled: true, state: "clean", dependencies: [previous] };
    features[id] = feature; featureOrder.push(id); previous = id;
  }
  return previous;
};

/**
 * Converts a Resource Hub procedural template into real parametric CAD design
 * intent. The resulting document contains sketches, features and separate
 * B-Rep Bodies; no Three.js mesh or runtime OCCT handle is persisted.
 */
export const buildCadDocumentFromResourceTemplate = (
  template: ModelingResourceTemplate,
  options: { documentId?: string; documentName?: string; instanceKey?: string } = {},
): ResourceCadBuildResult => {
  const sketches: Record<string, Sketch> = {};
  const features: Record<string, Feature> = {};
  const featureOrder: string[] = [];
  const bodies: Record<string, CadBody> = {};
  const warnings: string[] = [];
  const sourcePartToBody: Record<string, string> = {};
  const resourceKey = safeKey(options.instanceKey ? `${template.resourceId}-${options.instanceKey}` : template.resourceId);

  template.parts.forEach((part, index) => {
    const partKey = safeKey(part.id || `part-${index + 1}`);
    const bodyId = `${resourceKey}-${partKey}-body`;
    const sketchId = `${resourceKey}-${partKey}-sketch`;
    const featureId = `${resourceKey}-${partKey}-base`;
    const baseFeature = createPrimitiveFeature(part, bodyId, sketchId, featureId, sketches, warnings);
    features[featureId] = baseFeature;
    featureOrder.push(featureId);
    const tipFeatureId = addTransforms(part, bodyId, featureId, features, featureOrder);
    const body = createCadBody(bodyId, part.label);
    bodies[bodyId] = {
      ...body,
      tipFeatureId,
      appearance: { color: part.color, metalness: part.metalness, roughness: part.roughness },
      engineering: { material: template.materialSpec, densityKgM3: template.density, toleranceMm: template.tolerance, process: template.process, group: `资源库 / ${template.resourceCode}` },
      sourceResource: { resourceId: template.resourceId, resourceCode: template.resourceCode, resourceTitle: template.resourceTitle, sourcePartId: part.id },
    };
    sourcePartToBody[part.id] = bodyId;
  });

  const document = withDerivedBodyTips(createCadDocument<Sketch, Feature>({
    id: options.documentId ?? `resource-${resourceKey}-${Date.now()}`,
    name: options.documentName ?? template.projectName,
    sketches,
    features,
    featureOrder,
    bodies,
    activeBodyId: Object.keys(bodies)[0],
  }));
  return { document, warnings, sourcePartToBody };
};

/**
 * Builds a single multi-body Part Studio document from a Resource Hub queue.
 * Every resource keeps its own Sketch/Feature/Body design intent. Resource
 * groups are spaced along X by explicit BodyTransform Features, so the queue
 * never falls back to legacy Three.js ParametricPart geometry.
 */
export const buildCadDocumentFromResourceTemplates = (
  templates: ModelingResourceTemplate[],
  options: { documentId?: string; documentName?: string; spacingMm?: number } = {},
): ResourceCadBuildResult => {
  const sketches: Record<string, Sketch> = {};
  const features: Record<string, Feature> = {};
  const featureOrder: string[] = [];
  const bodies: Record<string, CadBody> = {};
  const warnings: string[] = [];
  const sourcePartToBody: Record<string, string> = {};
  let cursorX = 0;
  const spacingMm = Math.max(10, options.spacingMm ?? 250);

  templates.forEach((template, resourceIndex) => {
    const built = buildCadDocumentFromResourceTemplate(template, { documentId: `queue-${safeKey(template.resourceId)}-${resourceIndex}` });
    Object.assign(sketches, built.document.sketches);
    Object.assign(features, built.document.features);
    featureOrder.push(...built.document.featureOrder);
    warnings.push(...built.warnings);
    Object.assign(sourcePartToBody, built.sourcePartToBody);

    const xs = template.parts.flatMap((part) => [positionMm(part.x) - mm(part.width) / 2, positionMm(part.x) + mm(part.width) / 2]);
    const minX = xs.length ? Math.min(...xs) : 0;
    const maxX = xs.length ? Math.max(...xs) : 100;
    const width = Math.max(1, maxX - minX);
    const offsetX = cursorX - minX;

    for (const sourceBody of Object.values(built.document.bodies)) {
      const body = { ...sourceBody };
      if (Math.abs(offsetX) > 1e-9) {
        const inputFeatureId = body.tipFeatureId;
        const id = `${inputFeatureId}-queue-position-${resourceIndex}`;
        const move: BodyTransformFeature = { id, name: `${template.resourceTitle} · Queue Position`, type: "bodyTransform", bodyId: body.id, inputFeatureId, translationMm: { x: offsetX, y: 0, z: 0 }, enabled: true, state: "clean", dependencies: [inputFeatureId] };
        features[id] = move; featureOrder.push(id); body.tipFeatureId = id;
      }
      bodies[body.id] = body;
    }
    cursorX += width + spacingMm;
  });

  const document = withDerivedBodyTips(createCadDocument<Sketch, Feature>({
    id: options.documentId ?? `resource-queue-${Date.now()}`,
    name: options.documentName ?? `资源组合 · ${templates.length} 项`,
    sketches, features, featureOrder, bodies, activeBodyId: Object.keys(bodies)[0],
  }));
  return { document, warnings, sourcePartToBody };
};
