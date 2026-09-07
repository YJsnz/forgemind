import { createCadBody, withDerivedBodyTips } from "../cad/CadBodies.ts";
import { createCadDocument, type CadDocument } from "../cad/CadDocument.ts";
import type { CadBodyAppearance, CadBodyEngineering, Vec2, Vec3 } from "../cad/CadTypes.ts";
import type { BodyTransformFeature } from "../features/BodyTransformFeature.ts";
import type { ExtrudeFeature } from "../features/ExtrudeFeature.ts";
import type { Feature } from "../features/Feature.ts";
import type { LoftFeature } from "../features/LoftFeature.ts";
import type { RevolveFeature } from "../features/RevolveFeature.ts";
import type { SweepFeature } from "../features/SweepFeature.ts";
import type { Sketch } from "../sketch/Sketch.ts";

export type AgentDatumPlane = { type: "XY" | "XZ" | "YZ"; offset: number };
export type AgentProfile =
  | { kind: "circle"; center: Vec2; radiusMm: number }
  | { kind: "polygon"; points: Vec2[] };

export type AgentFeatureStep =
  | { id: string; name: string; kind: "extrude"; plane: AgentDatumPlane; profile: AgentProfile; distanceMm: number; direction?: "positive" | "negative"; operation: "new" | "add" | "remove" }
  | { id: string; name: string; kind: "revolve"; plane: AgentDatumPlane; profile: AgentProfile; axis: { origin: Vec3; direction: Vec3 }; angleDeg?: number }
  | { id: string; name: string; kind: "loft"; sections: Array<{ plane: AgentDatumPlane; profile: AgentProfile }>; ruled?: boolean }
  | { id: string; name: string; kind: "sweep"; profilePlane: AgentDatumPlane; profile: AgentProfile; pathPlane: AgentDatumPlane; path: Vec2[] }
  | { id: string; name: string; kind: "transform"; translationMm: Vec3; rotation?: { axis: "X" | "Y" | "Z"; angleDeg: number } };

export interface AgentFeaturePartProgram {
  id: string;
  name: string;
  steps: AgentFeatureStep[];
  appearance?: CadBodyAppearance;
  engineering?: CadBodyEngineering;
}

export interface AgentCadFeatureProgram {
  id: string;
  name: string;
  resourceCode: string;
  resourceTitle: string;
  strategy: "feature-driven";
  primaryPartId: string;
  parts: AgentFeaturePartProgram[];
}

const safe = (value: string) => value.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "feature";

const createProfileSketch = (id: string, name: string, plane: AgentDatumPlane, profile: AgentProfile): Sketch => {
  if (profile.kind === "circle") {
    return {
      id, name, plane,
      entities: { profile: { id: "profile", type: "circle", center: profile.center, radius: profile.radiusMm, construction: false } },
      entityOrder: ["profile"], constraints: {},
      dimensions: { radius: { id: "radius", name: "半径", type: "radius", entityIds: ["profile"], value: profile.radiusMm, driving: true } },
    };
  }
  if (profile.points.length < 3) throw new Error(`${name} 至少需要三个轮廓点。`);
  const entities: Sketch["entities"] = {};
  const entityOrder: string[] = [];
  profile.points.forEach((point, index) => {
    const entityId = `edge-${index + 1}`;
    entities[entityId] = { id: entityId, type: "line", start: point, end: profile.points[(index + 1) % profile.points.length], construction: false };
    entityOrder.push(entityId);
  });
  return { id, name, plane, entities, entityOrder, constraints: {}, dimensions: {} };
};
const createPathSketch = (id: string, name: string, plane: AgentDatumPlane, points: Vec2[]): Sketch => {
  if (points.length < 2) throw new Error(`${name} 至少需要两个路径点。`);
  const entities: Sketch["entities"] = {};
  const entityOrder: string[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const entityId = `path-${index + 1}`;
    entities[entityId] = { id: entityId, type: "line", start: points[index], end: points[index + 1], construction: false };
    entityOrder.push(entityId);
  }
  return { id, name, plane, entities, entityOrder, constraints: {}, dimensions: {} };
};

/** Compiles semantic, ordered modeling intent directly into editable CAD
 * Features. Primitive resource templates are deliberately not involved. */
export const compileAgentCadFeatureProgram = (program: AgentCadFeatureProgram): CadDocument<Sketch, Feature> => {
  const sketches: Record<string, Sketch> = {};
  const features: Record<string, Feature> = {};
  const featureOrder: string[] = [];
  const bodies: CadDocument<Sketch, Feature>["bodies"] = {};
  const programKey = safe(program.id);

  for (const part of program.parts) {
    if (!part.steps.length) throw new Error(`${part.name} 没有建模步骤。`);
    const partKey = safe(part.id);
    const bodyId = `${programKey}-${partKey}-body`;
    bodies[bodyId] = {
      ...createCadBody(bodyId, part.name), appearance: part.appearance, engineering: part.engineering,
      sourceResource: { resourceId: program.id, resourceCode: program.resourceCode, resourceTitle: program.resourceTitle, sourcePartId: part.id },
    };
    let previousFeatureId: string | undefined;
    for (const step of part.steps) {
      const stepId = `${programKey}-${partKey}-${safe(step.id)}`;
      let feature: Feature;
      if (step.kind === "extrude") {
        if (step.operation !== "new" && !previousFeatureId) throw new Error(`${step.name} 缺少上游实体。`);
        const sketchId = `${stepId}-sketch`;
        sketches[sketchId] = createProfileSketch(sketchId, `${step.name} · 草图`, step.plane, step.profile);
        feature = {
          id: stepId, name: step.name, type: "extrude", bodyId, targetBodyId: bodyId, sketchId,
          distance: step.distanceMm, direction: step.direction ?? "positive", operation: step.operation,
          targetFeatureId: step.operation === "new" ? undefined : previousFeatureId,
          enabled: true, state: "clean", dependencies: step.operation === "new" ? [] : [previousFeatureId!],
        } satisfies ExtrudeFeature;
      } else if (step.kind === "revolve") {
        if (previousFeatureId) throw new Error(`${step.name} 必须作为零件的首个实体特征。`);
        const sketchId = `${stepId}-sketch`;
        sketches[sketchId] = createProfileSketch(sketchId, `${step.name} · 旋转轮廓`, step.plane, step.profile);
        feature = { id: stepId, name: step.name, type: "revolve", bodyId, targetBodyId: bodyId, sketchId, axis: step.axis, angleDeg: step.angleDeg ?? 360, operation: "new", enabled: true, state: "clean", dependencies: [] } satisfies RevolveFeature;
      } else if (step.kind === "loft") {
        if (previousFeatureId) throw new Error(`${step.name} 必须作为零件的首个实体特征。`);
        const sectionSketchIds = step.sections.map((section, index) => {
          const sketchId = `${stepId}-section-${index + 1}`;
          sketches[sketchId] = createProfileSketch(sketchId, `${step.name} · 截面 ${index + 1}`, section.plane, section.profile);
          return sketchId;
        });
        feature = { id: stepId, name: step.name, type: "loft", bodyId, sectionSketchIds, solid: true, ruled: step.ruled ?? false, enabled: true, state: "clean", dependencies: [] } satisfies LoftFeature;
      } else if (step.kind === "sweep") {
        if (previousFeatureId) throw new Error(`${step.name} 必须作为零件的首个实体特征。`);
        const profileSketchId = `${stepId}-profile`;
        const pathSketchId = `${stepId}-path`;
        sketches[profileSketchId] = createProfileSketch(profileSketchId, `${step.name} · 截面`, step.profilePlane, step.profile);
        sketches[pathSketchId] = createPathSketch(pathSketchId, `${step.name} · 路径`, step.pathPlane, step.path);
        feature = { id: stepId, name: step.name, type: "sweep", bodyId, profileSketchId, pathSketchId, operation: "new", orientation: "followPath", enabled: true, state: "clean", dependencies: [] } satisfies SweepFeature;
      } else {
        if (!previousFeatureId) throw new Error(`${step.name} 缺少可以定位的上游实体。`);
        feature = { id: stepId, name: step.name, type: "bodyTransform", bodyId, inputFeatureId: previousFeatureId, translationMm: step.translationMm, rotation: step.rotation, enabled: true, state: "clean", dependencies: [previousFeatureId] } satisfies BodyTransformFeature;
      }
      features[stepId] = feature;
      featureOrder.push(stepId);
      previousFeatureId = stepId;
    }
  }

  const primaryBodyId = `${programKey}-${safe(program.primaryPartId)}-body`;
  return withDerivedBodyTips(createCadDocument<Sketch, Feature>({ id: `local-${programKey}`, name: program.name, sketches, features, featureOrder, bodies, activeBodyId: bodies[primaryBodyId] ? primaryBodyId : Object.keys(bodies)[0] }));
};
