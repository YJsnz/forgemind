import type { Vec3 } from "../cad/CadTypes.ts";
import type { LoftEndCondition } from "../features/LoftEndCondition.ts";
import type { KernelPlaneFrame } from "../kernel/KernelTypes.ts";

type LoftSection<T> = T & { plane: KernelPlaneFrame };

const subtract = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const normalize = (value: Vec3): Vec3 => { const length = Math.hypot(value.x, value.y, value.z); if (!Number.isFinite(length) || length <= 1e-12) throw new Error("Loft 端部方向不能为零。"); return { x: value.x / length, y: value.y / length, z: value.z / length }; };
const shifted = <T>(section: LoftSection<T>, direction: Vec3, distance: number): LoftSection<T> => ({ ...section, plane: { ...section.plane, origin: { x: section.plane.origin.x + direction.x * distance, y: section.plane.origin.y + direction.y * distance, z: section.plane.origin.z + direction.z * distance } } });
const inwardDirection = <T>(condition: LoftEndCondition, endpoint: LoftSection<T>, neighbor: LoftSection<T>): Vec3 => {
  const towardNeighbor = subtract(neighbor.plane.origin, endpoint.plane.origin);
  let direction = normalize(condition.direction ?? endpoint.plane.normal);
  if (dot(direction, towardNeighbor) < 0) direction = { x: -direction.x, y: -direction.y, z: -direction.z };
  return direction;
};
const validate = (condition: LoftEndCondition | undefined): void => {
  if (!condition) return;
  if (!["G1", "G2"].includes(condition.continuity) || !Number.isFinite(condition.lengthMm) || condition.lengthMm <= 0) throw new Error("Loft 端部控制需要有效的 G1/G2 类型和正数长度。");
  if (condition.direction && ![condition.direction.x, condition.direction.y, condition.direction.z].every(Number.isFinite)) throw new Error("Loft 端部方向必须是有限向量。");
};

/** Inserts design-visible guide sections; OCCT still builds the final exact B-Rep loft. */
export const applyLoftEndConditions = <T>(sections: readonly LoftSection<T>[], start?: LoftEndCondition, end?: LoftEndCondition, options: { ruled?: boolean; closed?: boolean } = {}): LoftSection<T>[] => {
  if (sections.length < 2) throw new Error("Loft 至少需要两个截面。");
  validate(start); validate(end);
  if (!start && !end) return [...sections];
  if (options.ruled || options.closed) throw new Error("端部形状控制只适用于开放的平滑放样，请关闭直纹或闭合选项。");
  const directions = new Map<LoftEndCondition, Vec3>();
  const checkEnd = (condition: LoftEndCondition | undefined, endpoint: LoftSection<T>, neighbor: LoftSection<T>): number => {
    if (!condition) return 0;
    const displacement = subtract(neighbor.plane.origin, endpoint.plane.origin);
    const axis = normalize(displacement);
    const direction = inwardDirection(condition, endpoint, neighbor);
    // Bound by the next authored section plane, not by world Z or the length
    // of a diagonal between origins. This also handles flipped plane normals.
    const normal = normalize(neighbor.plane.normal);
    const gap = dot(displacement, normal);
    const advance = dot(direction, normal) * condition.lengthMm;
    if (Math.abs(gap) <= 1e-8 || advance / gap <= 1e-8 || advance / gap >= 1 - 1e-8) {
      throw new Error("放样端部控制截面越界或方向无效，请缩短控制长度，并使方向指向下一截面。");
    }
    const progress = dot(direction, axis) * condition.lengthMm;
    if (progress <= 1e-8) throw new Error("放样端部方向必须朝向相邻截面。");
    directions.set(condition, direction);
    return progress;
  };
  const startProgress = checkEnd(start, sections[0], sections[1]);
  const endProgress = checkEnd(end, sections.at(-1)!, sections.at(-2)!);
  if (sections.length === 2 && startProgress + endProgress >= Math.hypot(...Object.values(subtract(sections[1].plane.origin, sections[0].plane.origin))) - 1e-8) {
    throw new Error("起点与终点的放样控制区域发生重叠，请缩短两端控制长度。");
  }
  const result: LoftSection<T>[] = [sections[0]];
  if (start) {
    const direction = directions.get(start)!;
    if (start.continuity === "G2") result.push(shifted(sections[0], direction, start.lengthMm * .5));
    result.push(shifted(sections[0], direction, start.lengthMm));
  }
  result.push(...sections.slice(1, -1));
  if (end) {
    const direction = directions.get(end)!;
    result.push(shifted(sections.at(-1)!, direction, end.lengthMm));
    if (end.continuity === "G2") result.push(shifted(sections.at(-1)!, direction, end.lengthMm * .5));
  }
  result.push(sections.at(-1)!);
  return result;
};
