import type { FeatureEvaluationContext } from "./FeatureEvaluationContext.ts";
import type { SketchPlane } from "../sketch/SketchPlane.ts";
import type { KernelPlaneFrame } from "../kernel/KernelTypes.ts";
import { resolvePersistentTopologyRef } from "../topology/TopologyResolver.ts";
import { getPlanarFaceFrame } from "../topology/PlanarFaceFrame.ts";
import { sketchPlaneToKernelFrame } from "./SketchPlaneFrame.ts";

export const resolveSketchPlaneFrame=async(plane:SketchPlane,context:FeatureEvaluationContext):Promise<KernelPlaneFrame>=>{if(plane.type==="XY"||plane.type==="XZ"||plane.type==="YZ")return sketchPlaneToKernelFrame(plane);if(plane.type==="datum")return sketchPlaneToKernelFrame({type:plane.datum.base,offset:plane.datum.offsetMm});if(!("persistent" in plane.face))throw new Error("Legacy face SketchPlane cannot resolve without a PersistentTopologyRef.");if(!context.runtime)throw new Error("Face-attached Sketch requires CadRuntimeState.");const topology=await resolvePersistentTopologyRef(plane.face.persistent,context.runtime,context.kernel);const face=await context.kernel.getFaceInfo(topology);return getPlanarFaceFrame(face);};
