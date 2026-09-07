import { createCadBody, withDerivedBodyTips } from "../cad/CadBodies.ts";
import { createCadDocument, type CadDocument } from "../cad/CadDocument.ts";
import type { Feature } from "../features/Feature.ts";
import type { Sketch } from "../sketch/Sketch.ts";

export type QuickPrimitiveKind = "rectangle" | "circle";

export interface QuickPrimitiveOptions {
  idPrefix: string;
  name: string;
  kind: QuickPrimitiveKind;
  widthMm?: number;
  heightMm?: number;
  diameterMm?: number;
  extrudeMm: number;
}

const positive = (value: number | undefined, fallback: number) => Number.isFinite(value) ? Math.max(.01, Math.abs(value!)) : fallback;

export const createEmptyProfessionalCadDocument = (id = `cad-${Date.now()}`, name = "未命名 CAD 项目"): CadDocument<Sketch, Feature> => createCadDocument<Sketch, Feature>({ id, name });

const rectangleSketch = (id: string, name: string, width: number, height: number): Sketch => ({
  id, name, plane: { type: "XY", offset: 0 },
  entities: {
    a: { id: "a", type: "line", start: { x: -width / 2, y: -height / 2 }, end: { x: width / 2, y: -height / 2 }, construction: false },
    b: { id: "b", type: "line", start: { x: width / 2, y: -height / 2 }, end: { x: width / 2, y: height / 2 }, construction: false },
    c: { id: "c", type: "line", start: { x: width / 2, y: height / 2 }, end: { x: -width / 2, y: height / 2 }, construction: false },
    d: { id: "d", type: "line", start: { x: -width / 2, y: height / 2 }, end: { x: -width / 2, y: -height / 2 }, construction: false },
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
    width: { id: "width", name: "Width", type: "horizontalDistance", entityIds: ["a"], pointRefs: [{ entityId: "a", role: "start" }, { entityId: "a", role: "end" }], value: width, driving: true },
    height: { id: "height", name: "Height", type: "verticalDistance", entityIds: ["a", "b"], pointRefs: [{ entityId: "a", role: "end" }, { entityId: "b", role: "end" }], value: height, driving: true },
  },
});

const circleSketch = (id: string, name: string, radius: number): Sketch => ({
  id, name, plane: { type: "XY", offset: 0 },
  entities: { circle: { id: "circle", type: "circle", center: { x: 0, y: 0 }, radius, construction: false } },
  entityOrder: ["circle"],
  constraints: { center: { id: "center", type: "fixed", entityIds: ["circle"], pointRefs: [{ entityId: "circle", role: "center" }], enabled: true } },
  dimensions: { radius: { id: "radius", name: "Radius", type: "radius", entityIds: ["circle"], value: radius, driving: true } },
});

/** Appends a fully constrained sketch and a real new-body Extrude Feature. */
export const appendQuickPrimitive = (document: CadDocument<Sketch, Feature>, options: QuickPrimitiveOptions): CadDocument<Sketch, Feature> => {
  const prefix = options.idPrefix.replace(/[^a-zA-Z0-9_-]+/g, "-") || `primitive-${Date.now()}`;
  if (document.sketches[`${prefix}-sketch`] || document.features[`${prefix}-extrude`] || document.bodies[`${prefix}-body`]) throw new Error(`Quick primitive idPrefix ${prefix} already exists.`);
  const sketchId = `${prefix}-sketch`, featureId = `${prefix}-extrude`, bodyId = `${prefix}-body`;
  const extrudeMm = positive(options.extrudeMm, 20);
  const sketch = options.kind === "circle"
    ? circleSketch(sketchId, `${options.name} · Sketch`, positive(options.diameterMm, 20) / 2)
    : rectangleSketch(sketchId, `${options.name} · Sketch`, positive(options.widthMm, 100), positive(options.heightMm, 60));
  const feature: Feature = { id: featureId, name: `${options.name} · Extrude`, type: "extrude", sketchId, distance: extrudeMm, direction: "positive", operation: "new", bodyId, targetBodyId: bodyId, enabled: true, state: "clean", dependencies: [] };
  const body = { ...createCadBody(bodyId, options.name), tipFeatureId: featureId };
  return withDerivedBodyTips({ ...document, sketches: { ...document.sketches, [sketchId]: sketch }, features: { ...document.features, [featureId]: feature }, featureOrder: [...document.featureOrder, featureId], bodies: { ...document.bodies, [bodyId]: body }, activeBodyId: bodyId, updatedAt: Date.now() });
};
