import type { Vec3 } from "../cad/CadTypes.ts";
import type { LocalMateConnectorFrame, LocalMateGeometry, MateAlignment, PartMateConnectorDefinition, Quaternion, RigidTransform } from "./AssemblyTypes.ts";
import { addVec3, conjugateQuaternion, crossVec3, multiplyQuaternion, normalizeQuaternion, normalizeVec3, quaternionFromAxisAngle, rotateVec3, scaleVec3, subVec3, transformDirection, transformPoint } from "./RigidTransform.ts";

export type MateConnectorFrame = LocalMateConnectorFrame;

const chooseReference = (axis: Vec3): Vec3 => Math.abs(axis.z) < .85 ? { x: 0, y: 0, z: 1 } : { x: 0, y: 1, z: 0 };

/** Deterministic orthonormal connector frame derived only from exact analytic B-Rep geometry. */
export const mateConnectorFrameFromGeometry = (geometry: LocalMateGeometry): MateConnectorFrame => {
  const primaryAxis = normalizeVec3(geometry.kind === "plane" ? geometry.normal : geometry.axisDirection);
  const secondaryAxis = normalizeVec3(crossVec3(chooseReference(primaryAxis), primaryAxis));
  const tertiaryAxis = normalizeVec3(crossVec3(primaryAxis, secondaryAxis));
  return {
    originMm: geometry.kind === "plane" ? { ...geometry.pointMm } : { ...geometry.axisOriginMm },
    primaryAxis,
    secondaryAxis,
    tertiaryAxis,
    sourceKind: geometry.kind,
  };
};

export const applyMateConnectorDefinition = (base: MateConnectorFrame, definition: Pick<PartMateConnectorDefinition, "offsetMm" | "spinDeg" | "flipped">): MateConnectorFrame => {
  const primaryAxis = definition.flipped ? scaleVec3(base.primaryAxis, -1) : { ...base.primaryAxis };
  const baseSecondary = { ...base.secondaryAxis };
  const baseTertiary = definition.flipped ? scaleVec3(base.tertiaryAxis, -1) : { ...base.tertiaryAxis };
  const spin = quaternionFromAxisAngle(primaryAxis, definition.spinDeg * Math.PI / 180);
  const secondaryAxis = normalizeVec3(rotateVec3(spin, baseSecondary));
  const tertiaryAxis = normalizeVec3(rotateVec3(spin, baseTertiary));
  const originMm = addVec3(base.originMm, addVec3(
    scaleVec3(primaryAxis, definition.offsetMm.primary),
    addVec3(scaleVec3(secondaryAxis, definition.offsetMm.secondary), scaleVec3(tertiaryAxis, definition.offsetMm.tertiary)),
  ));
  return { originMm, primaryAxis, secondaryAxis, tertiaryAxis, sourceKind: base.sourceKind };
};

export const transformMateConnectorFrame = (frame: MateConnectorFrame, placement: RigidTransform): MateConnectorFrame => ({
  originMm: transformPoint(placement, frame.originMm),
  primaryAxis: transformDirection(placement, frame.primaryAxis),
  secondaryAxis: transformDirection(placement, frame.secondaryAxis),
  tertiaryAxis: transformDirection(placement, frame.tertiaryAxis),
  sourceKind: frame.sourceKind,
});

const quaternionFromBasis = (xAxis: Vec3, yAxis: Vec3, zAxis: Vec3): Quaternion => {
  const m00=xAxis.x,m01=yAxis.x,m02=zAxis.x,m10=xAxis.y,m11=yAxis.y,m12=zAxis.y,m20=xAxis.z,m21=yAxis.z,m22=zAxis.z;
  const trace=m00+m11+m22; let q:Quaternion;
  if(trace>0){const s=Math.sqrt(trace+1)*2;q={w:.25*s,x:(m21-m12)/s,y:(m02-m20)/s,z:(m10-m01)/s};}
  else if(m00>m11&&m00>m22){const s=Math.sqrt(1+m00-m11-m22)*2;q={w:(m21-m12)/s,x:.25*s,y:(m01+m10)/s,z:(m02+m20)/s};}
  else if(m11>m22){const s=Math.sqrt(1+m11-m00-m22)*2;q={w:(m02-m20)/s,x:(m01+m10)/s,y:.25*s,z:(m12+m21)/s};}
  else {const s=Math.sqrt(1+m22-m00-m11)*2;q={w:(m10-m01)/s,x:(m02+m20)/s,y:(m12+m21)/s,z:.25*s};}
  return normalizeQuaternion(q);
};

/**
 * Computes an absolute Part placement that snaps a Part-local connector onto a world connector.
 * It aligns the full connector frame, not only the origin, so the result is deterministic.
 */
export const snapPlacementByMateConnectors = (movingLocal: MateConnectorFrame, targetWorld: MateConnectorFrame, alignment: MateAlignment = "opposite"): RigidTransform => {
  const desiredPrimary = alignment === "same" ? targetWorld.primaryAxis : scaleVec3(targetWorld.primaryAxis,-1);
  const desiredSecondary = targetWorld.secondaryAxis;
  const desiredTertiary = alignment === "same" ? targetWorld.tertiaryAxis : scaleVec3(targetWorld.tertiaryAxis,-1);
  const localQ=quaternionFromBasis(movingLocal.secondaryAxis,movingLocal.tertiaryAxis,movingLocal.primaryAxis);
  const targetQ=quaternionFromBasis(desiredSecondary,desiredTertiary,desiredPrimary);
  const rotation=multiplyQuaternion(targetQ,conjugateQuaternion(localQ));
  const translationMm=subVec3(targetWorld.originMm,rotateVec3(rotation,movingLocal.originMm));
  return {translationMm,rotation};
};

export const connectorSignedTwistRad = (a: MateConnectorFrame,b: MateConnectorFrame):number => {
  const axis=normalizeVec3(a.primaryAxis); const x=normalizeVec3(a.secondaryAxis); const y=normalizeVec3(crossVec3(axis,x)); const bx=normalizeVec3(b.secondaryAxis);
  return Math.atan2(bx.x*y.x+bx.y*y.y+bx.z*y.z,bx.x*x.x+bx.y*x.y+bx.z*x.z);
};
