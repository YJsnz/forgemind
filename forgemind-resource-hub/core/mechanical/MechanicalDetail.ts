import type { Vec3 } from "../cad/CadTypes.ts";

/** Persisted millimetre-based design intent for detailed mechanical parts. */
export type MechanicalDetailDefinition =
  | {
    kind: "externalThread";
    majorDiameterMm: number;
    pitchMm: number;
    lengthMm: number;
    /** Effective threaded portion. Omitted means the full shank length. */
    threadedLengthMm?: number;
    threadDepthMm: number;
    leftHanded?: boolean;
  }
  | {
    kind: "spurGear";
    moduleMm: number;
    teeth: number;
    pressureAngleDeg: number;
    thicknessMm: number;
    boreDiameterMm: number;
  }
  | {
    kind: "bearing";
    outerDiameterMm: number;
    innerDiameterMm: number;
    widthMm: number;
    ballCount: number;
  }
  | {
    kind: "cableSweep";
    diameterMm: number;
    pathPointsMm: Vec3[];
  };

export type MechanicalDetailKind = MechanicalDetailDefinition["kind"];

export const validateMechanicalDetail = (detail: MechanicalDetailDefinition): string[] => {
  const issues: string[] = [];
  const positive = (value: number, label: string) => {
    if (!Number.isFinite(value) || value <= 0) issues.push(`${label}必须是大于 0 的有限数值。`);
  };
  if (detail.kind === "externalThread") {
    positive(detail.majorDiameterMm, "螺纹大径"); positive(detail.pitchMm, "螺距"); positive(detail.lengthMm, "螺纹长度"); positive(detail.threadDepthMm, "牙深");
    if (detail.threadedLengthMm !== undefined) {
      positive(detail.threadedLengthMm, "有效牙长");
      if (detail.threadedLengthMm > detail.lengthMm) issues.push("有效牙长不能超过螺杆总长。");
    }
    if (detail.threadDepthMm >= detail.majorDiameterMm * .25) issues.push("牙深必须小于螺纹大径的四分之一。");
    if (detail.pitchMm <= detail.threadDepthMm * 1.1) issues.push("螺距过小，无法形成稳定且互不重叠的螺旋牙型。");
  } else if (detail.kind === "spurGear") {
    positive(detail.moduleMm, "模数"); positive(detail.thicknessMm, "齿宽");
    if (!Number.isInteger(detail.teeth) || detail.teeth < 8 || detail.teeth > 160) issues.push("齿数必须是 8 到 160 之间的整数。");
    if (!Number.isFinite(detail.pressureAngleDeg) || detail.pressureAngleDeg < 14 || detail.pressureAngleDeg > 30) issues.push("压力角必须在 14° 到 30° 之间。");
    if (!Number.isFinite(detail.boreDiameterMm) || detail.boreDiameterMm < 0) issues.push("轴孔直径不能为负数。");
    const rootDiameter = detail.moduleMm * Math.max(1, detail.teeth - 2.5);
    if (detail.boreDiameterMm >= rootDiameter) issues.push("轴孔直径必须小于齿根直径。");
  } else if (detail.kind === "bearing") {
    positive(detail.outerDiameterMm, "轴承外径"); positive(detail.innerDiameterMm, "轴承内径"); positive(detail.widthMm, "轴承宽度");
    if (detail.innerDiameterMm >= detail.outerDiameterMm) issues.push("轴承内径必须小于外径。");
    if (!Number.isInteger(detail.ballCount) || detail.ballCount < 5 || detail.ballCount > 48) issues.push("滚动体数量必须是 5 到 48 之间的整数。");
  } else {
    positive(detail.diameterMm, "线缆直径");
    if (!Array.isArray(detail.pathPointsMm) || detail.pathPointsMm.length < 2) issues.push("线缆路径至少需要两个控制点。");
    else if (!detail.pathPointsMm.every((point) => [point.x, point.y, point.z].every(Number.isFinite))) issues.push("线缆路径包含无效坐标。");
    else if (detail.pathPointsMm.some((point, index) => index > 0 && Math.hypot(point.x - detail.pathPointsMm[index - 1].x, point.y - detail.pathPointsMm[index - 1].y, point.z - detail.pathPointsMm[index - 1].z) <= 1e-6)) issues.push("线缆路径不能包含重合的相邻控制点。");
  }
  return issues;
};
