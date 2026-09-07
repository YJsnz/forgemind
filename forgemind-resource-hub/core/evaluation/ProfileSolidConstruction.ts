import type { CadKernel } from "../kernel/CadKernel.ts";
import type { KernelAxis, KernelPathInput, KernelPlaneFrame, KernelShapeRef } from "../kernel/KernelTypes.ts";
import type { ClosedProfile, ProfileSegment } from "../sketch/SketchProfile.ts";

const loopProfile = (id: string, outer: ProfileSegment[]): ClosedProfile => ({ id, outer, holes: [] });

const cutInnerLoops = async (
  kernel: CadKernel,
  outerFactory: (profile: ClosedProfile) => Promise<KernelShapeRef>,
  profile: ClosedProfile,
): Promise<KernelShapeRef> => {
  if (!profile.holes.length) return outerFactory(profile);
  let outer: KernelShapeRef | undefined;
  const holes: KernelShapeRef[] = [];
  try {
    outer = await outerFactory(loopProfile(`${profile.id}:outer`, profile.outer));
    for (let index = 0; index < profile.holes.length; index += 1) holes.push(await outerFactory(loopProfile(`${profile.id}:hole:${index + 1}`, profile.holes[index])));
    return await kernel.booleanCut(outer, holes);
  } finally {
    if (outer) await kernel.disposeShape(outer).catch(() => undefined);
    for (const hole of holes) await kernel.disposeShape(hole).catch(() => undefined);
  }
};

export const revolveClosedProfile = (
  kernel: CadKernel,
  profile: ClosedProfile,
  plane: KernelPlaneFrame,
  axis: KernelAxis,
  angleDeg: number,
): Promise<KernelShapeRef> => cutInnerLoops(kernel, (loop) => kernel.revolve({ profile: loop, plane }, { axis, angleDeg }), profile);

export const sweepClosedProfile = (
  kernel: CadKernel,
  profile: ClosedProfile,
  plane: KernelPlaneFrame,
  path: KernelPathInput,
): Promise<KernelShapeRef> => cutInnerLoops(kernel, (loop) => kernel.sweep({ profile: loop, plane }, path, { orientation: "followPath" }), profile);

/** Builds one lofted material region, including corresponding holes. */
export const loftClosedProfiles = async (
  kernel: CadKernel,
  sections: Array<{ profile: ClosedProfile; plane: KernelPlaneFrame }>,
  options: { ruled: boolean; closed?: boolean },
): Promise<KernelShapeRef> => {
  const holeCount = sections[0]?.profile.holes.length ?? 0;
  if (sections.some(({ profile }) => profile.holes.length !== holeCount)) throw new Error("Every loft section in one region must contain the same number of inner loops.");
  let outer: KernelShapeRef | undefined;
  const holes: KernelShapeRef[] = [];
  let keepOuter = false;
  try {
    outer = await kernel.loft(sections.map(({ profile, plane }) => ({ profile: loopProfile(`${profile.id}:outer`, profile.outer), plane })), { solid: true, ruled: options.ruled, closed: options.closed });
    for (let holeIndex = 0; holeIndex < holeCount; holeIndex += 1) {
      holes.push(await kernel.loft(sections.map(({ profile, plane }) => ({ profile: loopProfile(`${profile.id}:hole:${holeIndex + 1}`, profile.holes[holeIndex]), plane })), { solid: true, ruled: options.ruled, closed: options.closed }));
    }
    if (holes.length) return await kernel.booleanCut(outer, holes);
    keepOuter = true;
    return outer;
  } finally {
    if (outer && !keepOuter) await kernel.disposeShape(outer).catch(() => undefined);
    for (const hole of holes) await kernel.disposeShape(hole).catch(() => undefined);
  }
};
