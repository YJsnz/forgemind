import type { Vec3 } from "../cad/CadTypes.ts";
import type { NurbsAxisDefinition, TensorProductNurbsDefinition } from "../surface/TensorProductNurbs.ts";
import { validateTensorProductNurbs } from "../surface/TensorProductNurbs.ts";

const number = (value: number): string => String(Object.is(value, -0) ? 0 : value);
const point = (value: Vec3, weight?: number): string => `${number(value.x)} ${number(value.y)} ${number(value.z)}${weight === undefined ? "" : ` ${number(weight)}`}`;
const knotLines = (axis: NurbsAxisDefinition): string => axis.knots.map((value, index) => `${number(value)} ${axis.multiplicities[index]}`).join("\n");

const curve = (poles: Vec3[], weights: number[], axis: NurbsAxisDefinition): string =>
  `7 1 0  ${axis.degree} ${poles.length} ${axis.knots.length}  ${poles.map((pole, index) => point(pole, weights[index])).join("  ")}\n ${knotLines(axis)}`;

const replaceSection = (source: string, start: string, end: string, replacement: string): string => {
  const startIndex = source.indexOf(start), endIndex = source.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endIndex < 0) throw new Error(`OCCT B-Rep 模板缺少 ${start.trim()} 段。`);
  return `${source.slice(0, startIndex)}${replacement}${source.slice(endIndex)}`;
};

/** Builds an exact Face BREP while retaining OCCT-authored unit-patch topology/p-curves. */
export const createTensorProductNurbsBrep = (template: string, controlNet: Vec3[][], definition: TensorProductNurbsDefinition): string => {
  const validation = validateTensorProductNurbs(controlNet, definition);
  if (!validation.valid) throw new Error(validation.issues.join(" "));
  const rows = controlNet.length, cols = controlNet[0].length;
  const bottom = curve(controlNet[0], definition.weights[0], definition.u);
  const left = curve(controlNet.map((row) => row[0]), definition.weights.map((row) => row[0]), definition.v);
  const top = curve(controlNet.at(-1)!, definition.weights.at(-1)!, definition.u);
  const right = curve(controlNet.map((row) => row.at(-1)!), definition.weights.map((row) => row.at(-1)!), definition.v);
  // The OCCT-authored template maps its first surface parameter to control-net rows.
  // Keep that mapping so its boundary p-curves remain exact, while the public model
  // continues to call columns U and rows V.
  const surfacePoles = controlNet.map((row, rowIndex) => row
    .map((pole, colIndex) => point(pole, definition.weights[rowIndex][colIndex]))
    .join("  ")).join("  \n");
  const surface = `Surfaces 1\n9 1 1 0 0 ${definition.v.degree} ${definition.u.degree} ${rows} ${cols} ${definition.v.knots.length} ${definition.u.knots.length} ${surfacePoles}\n\n${knotLines(definition.v)}\n\n${knotLines(definition.u)}\n\n`;
  let result = replaceSection(template, "Curves 4\n", "Polygon3D 0", `Curves 4\n${bottom}\n${left}\n${top}\n${right}\n`);
  result = replaceSection(result, "Surfaces 1\n", "Triangulations 0", surface);
  const corners = [controlNet[0][0], controlNet[0].at(-1)!, controlNet.at(-1)![0], controlNet.at(-1)!.at(-1)!];
  let vertexIndex = 0;
  result = result.replace(/(Ve\r?\n[^\r\n]+\r?\n)[^\r\n]+(\r?\n0 0)/g, (match, prefix: string, suffix: string) => {
    const corner = corners[vertexIndex++];
    return corner ? `${prefix}${point(corner)}${suffix}` : match;
  });
  if (vertexIndex !== 4) throw new Error("OCCT B-Rep 模板顶点结构发生变化。");
  return result;
};
