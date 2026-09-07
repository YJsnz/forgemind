import type { CadKernel } from "../kernel/CadKernel.ts";
import type { KernelExtrudeOptions, KernelPlaneFrame, KernelShapeRef } from "../kernel/KernelTypes.ts";
import type { ClosedProfile, ProfileSegment } from "../sketch/SketchProfile.ts";

const loopProfile = (id: string, outer: ProfileSegment[]): ClosedProfile => ({ id, outer, holes: [] });

/**
 * Extrudes an exact analytic profile including inner loops without asking the
 * kernel adapter to invent multi-wire face semantics. V8 constructs the outer
 * prism and subtracts every exact inner-loop prism. The returned shape is owned
 * by the caller; all intermediate shapes are disposed here.
 */
export const extrudeClosedProfile = async (
  kernel: CadKernel,
  profile: ClosedProfile,
  plane: KernelPlaneFrame,
  options: KernelExtrudeOptions,
): Promise<KernelShapeRef> => {
  if (options.direction === "symmetric" || options.direction === "twoSided") {
    const positiveDistance = options.direction === "symmetric" ? options.distanceMm / 2 : options.distanceMm;
    const negativeDistance = options.direction === "symmetric" ? options.distanceMm / 2 : options.secondDistanceMm;
    if (!Number.isFinite(negativeDistance) || (negativeDistance ?? 0) <= 0) throw new Error("Two-sided extrusion requires a positive opposite-side distance.");
    let positive: KernelShapeRef | undefined;
    let negative: KernelShapeRef | undefined;
    try {
      positive = await extrudeClosedProfile(kernel, profile, plane, { distanceMm: positiveDistance, direction: "positive" });
      negative = await extrudeClosedProfile(kernel, profile, plane, { distanceMm: negativeDistance!, direction: "negative" });
      return await kernel.booleanUnion(positive, [negative]);
    } finally {
      if (positive) await kernel.disposeShape(positive).catch(() => undefined);
      if (negative) await kernel.disposeShape(negative).catch(() => undefined);
    }
  }
  if (!profile.holes.length) return kernel.extrude({ profile, plane }, options);
  let outer: KernelShapeRef | undefined;
  const holeShapes: KernelShapeRef[] = [];
  try {
    outer = await kernel.extrude({ profile: loopProfile(`${profile.id}:outer`, profile.outer), plane }, options);
    for (let index = 0; index < profile.holes.length; index += 1) {
      const loop = profile.holes[index];
      holeShapes.push(await kernel.extrude({ profile: loopProfile(`${profile.id}:hole:${index + 1}`, loop), plane }, options));
    }
    return await kernel.booleanCut(outer, holeShapes);
  } finally {
    if (outer) await kernel.disposeShape(outer).catch(() => undefined);
    for (const shape of holeShapes) await kernel.disposeShape(shape).catch(() => undefined);
  }
};
