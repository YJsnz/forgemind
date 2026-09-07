export type ResourcePrimitiveKind = "box" | "cylinder" | "cone" | "torus";
import type { MechanicalDetailDefinition } from "../mechanical/MechanicalDetail.ts";

export type ResourceModelPart = {
  id: string;
  type: ResourcePrimitiveKind;
  label: string;
  x: number;
  y: number;
  z: number;
  rotationX?: number;
  rotationY?: number;
  rotationZ?: number;
  width: number;
  height: number;
  depth: number;
  color: string;
  metalness: number;
  roughness: number;
  selected?: boolean;
  locked?: boolean;
  hidden?: boolean;
  sourceResourceId?: string;
  sourceResourceCode?: string;
  sourceResourceTitle?: string;
  /** Optional exact CAD intent. The primitive remains as a lightweight resource-browser fallback envelope. */
  mechanicalDetail?: MechanicalDetailDefinition;
};

export type ResourceEngineeringProperties = {
  material: string;
  density: number;
  tolerance: number;
  process: string;
  group: string;
};

export type ModelingResourceTemplate = {
  resourceId: string;
  resourceCode: string;
  resourceTitle: string;
  projectName: string;
  materialSpec: string;
  density: number;
  tolerance: number;
  process: string;
  assetPath?: string;
  parts: ResourceModelPart[];
};

export type ResourceInstantiation = {
  parts: ResourceModelPart[];
  engineering: Record<string, ResourceEngineeringProperties>;
};

const finite = (value: number, fallback = 0) => Number.isFinite(value) ? value : fallback;
const extent = (part: ResourceModelPart, axis: "x" | "y" | "z", side: "min" | "max") => {
  const size = axis === "x" ? Math.abs(part.width) : axis === "y" ? Math.abs(part.height) : Math.abs(part.depth);
  const center = finite(part[axis]);
  return side === "min" ? center - size / 2 : center + size / 2;
};

export const resourceBounds = (parts: readonly ResourceModelPart[]) => {
  if (!parts.length) return { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0, width: 0, height: 0, depth: 0 };
  const minX = Math.min(...parts.map((part) => extent(part, "x", "min")));
  const maxX = Math.max(...parts.map((part) => extent(part, "x", "max")));
  const minY = Math.min(...parts.map((part) => extent(part, "y", "min")));
  const maxY = Math.max(...parts.map((part) => extent(part, "y", "max")));
  const minZ = Math.min(...parts.map((part) => extent(part, "z", "min")));
  const maxZ = Math.max(...parts.map((part) => extent(part, "z", "max")));
  return { minX, maxX, minY, maxY, minZ, maxZ, width: maxX - minX, height: maxY - minY, depth: maxZ - minZ };
};

export const nextResourceInsertionOffset = (
  existingParts: readonly ResourceModelPart[],
  incomingParts: readonly ResourceModelPart[],
  gapM = 0.6,
) => {
  if (!existingParts.length || !incomingParts.length) return { x: 0, y: 0, z: 0 };
  const existing = resourceBounds(existingParts);
  const incoming = resourceBounds(incomingParts);
  return {
    x: existing.maxX + Math.max(0.05, gapM) - incoming.minX,
    y: Math.max(0, -incoming.minY),
    z: 0,
  };
};

const safeKey = (value: string) => value.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "resource";

export const instantiateResourceTemplate = (
  template: ModelingResourceTemplate,
  existingParts: readonly ResourceModelPart[] = [],
  options: { placement?: "origin" | "next-to-existing"; instanceKey?: string; gapM?: number } = {},
): ResourceInstantiation => {
  const placement = options.placement ?? (existingParts.length ? "next-to-existing" : "origin");
  const offset = placement === "next-to-existing" ? nextResourceInsertionOffset(existingParts, template.parts, options.gapM) : { x: 0, y: 0, z: 0 };
  const instanceKey = safeKey(options.instanceKey ?? `${template.resourceId}-${Date.now()}`);
  const group = `资源库 / ${template.resourceCode}`;
  const parts = template.parts.map((part, index) => ({
    ...part,
    id: `${instanceKey}-${safeKey(part.id || `part-${index + 1}`)}`,
    label: part.label,
    x: finite(part.x) + offset.x,
    y: finite(part.y) + offset.y,
    z: finite(part.z) + offset.z,
    selected: index === 0,
    sourceResourceId: template.resourceId,
    sourceResourceCode: template.resourceCode,
    sourceResourceTitle: template.resourceTitle,
  }));
  const engineering = Object.fromEntries(parts.map((part) => [part.id, {
    material: template.materialSpec,
    density: template.density,
    tolerance: template.tolerance,
    process: template.process,
    group,
  }]));
  return { parts, engineering };
};

export const mergeResourceInstantiation = (
  existingParts: readonly ResourceModelPart[],
  existingEngineering: Readonly<Record<string, ResourceEngineeringProperties>>,
  instantiation: ResourceInstantiation,
) => ({
  parts: [
    ...existingParts.map((part) => ({ ...part, selected: false })),
    ...instantiation.parts,
  ],
  engineering: { ...existingEngineering, ...instantiation.engineering },
  activePartId: instantiation.parts[0]?.id ?? existingParts[0]?.id ?? "",
});

export type ResourceModelingPayload = {
  resourceId: string;
  resourceCode: string;
  resourceTitle: string;
  parts: ResourceModelPart[];
  engineeringProperties?: Readonly<Record<string, ResourceEngineeringProperties>>;
  fallbackEngineering: ResourceEngineeringProperties;
};

/**
 * Re-instances a modeling payload coming from a Resource Pack. Source part ids
 * are never reused directly, so importing the same resource more than once is
 * safe. Engineering data is remapped to the newly-created ids.
 */
export const instantiateResourceModelingPayload = (
  payload: ResourceModelingPayload,
  existingParts: readonly ResourceModelPart[] = [],
  options: { placement?: "origin" | "next-to-existing"; instanceKey?: string; gapM?: number } = {},
): ResourceInstantiation => {
  const placement = options.placement ?? (existingParts.length ? "next-to-existing" : "origin");
  const offset = placement === "next-to-existing" ? nextResourceInsertionOffset(existingParts, payload.parts, options.gapM) : { x: 0, y: 0, z: 0 };
  const instanceKey = safeKey(options.instanceKey ?? `${payload.resourceId}-${Date.now()}`);
  const engineering: Record<string, ResourceEngineeringProperties> = {};
  const parts = payload.parts.map((part, index) => {
    const sourceId = part.id || `part-${index + 1}`;
    const id = `${instanceKey}-${safeKey(sourceId)}`;
    engineering[id] = {
      ...payload.fallbackEngineering,
      ...(payload.engineeringProperties?.[sourceId] ?? {}),
      group: payload.engineeringProperties?.[sourceId]?.group || payload.fallbackEngineering.group,
    };
    return {
      ...part,
      id,
      x: finite(part.x) + offset.x,
      y: finite(part.y) + offset.y,
      z: finite(part.z) + offset.z,
      selected: index === 0,
      sourceResourceId: payload.resourceId,
      sourceResourceCode: payload.resourceCode,
      sourceResourceTitle: payload.resourceTitle,
    };
  });
  return { parts, engineering };
};
