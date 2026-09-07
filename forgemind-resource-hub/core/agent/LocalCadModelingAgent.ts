import { deriveBodyTipFeatureId, withDerivedBodyTips } from "../cad/CadBodies.ts";
import type { CadDocument } from "../cad/CadDocument.ts";
import type { Feature } from "../features/Feature.ts";
import { buildCadDocumentFromResourceTemplate } from "../resource/ResourceCadBridge.ts";
import type { ModelingResourceTemplate, ResourceModelPart, ResourcePrimitiveKind } from "../resource/ResourceModeling.ts";
import type { Sketch } from "../sketch/Sketch.ts";
import { compileAgentCadFeatureProgram, type AgentCadFeatureProgram, type AgentFeaturePartProgram, type AgentProfile } from "./CadFeatureProgram.ts";

export type LocalCadAgentIntent = "cnc" | "robot" | "conveyor" | "enclosure" | "bracket" | "flange" | "shaft" | "generic";
export type LocalCadAgentApplyMode = "replace" | "append";

export interface LocalCadAgentFeatureRequests {
  holeCount?: number;
  holeDiameterMm?: number;
  filletRadiusMm?: number;
  chamferDistanceMm?: number;
  observationWindow: boolean;
  louverCount?: number;
  conveyorType?: "roller" | "belt";
  robotEndEffector?: "gripper" | "welder" | "suction";
  cncType?: "mill" | "lathe";
  loadKg?: number;
  speedMMin?: number;
}

export interface LocalCadAgentUnderstanding {
  normalizedRequest: string;
  confidence: "high" | "medium" | "low";
  interpretedAs: string;
  recognized: string[];
  inferred: string[];
  warnings: string[];
}

export interface LocalCadAgentPlan {
  id: string;
  prompt: string;
  intent: LocalCadAgentIntent;
  title: string;
  summary: string;
  dimensionsMm: { length: number; width: number; height: number };
  operations: string[];
  assumptions: string[];
  understanding: LocalCadAgentUnderstanding;
  template: ModelingResourceTemplate;
  /** Ordered semantic features generated from the request. When present this
   * is the modeling source of truth; the resource template is only a preview
   * and compatibility description. */
  featureProgram?: AgentCadFeatureProgram;
  /** Equipment plans may replace only rough proxy parts while retaining real
   * bearings, gears, fasteners and other separate components. */
  featureProgramReplaces?: string[];
  booleanCuts?: Array<{ targetPartId: string; toolPartIds: string[] }>;
  featureRequests: LocalCadAgentFeatureRequests;
  finishTargetPartId?: string;
}

const chineseDigits: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

const chineseInteger = (value: string): number | undefined => {
  if (!value) return undefined;
  let total = 0, current = 0;
  for (const character of value) {
    if (character in chineseDigits) { current = chineseDigits[character]; continue; }
    if (character === "十") { total += (current || 1) * 10; current = 0; continue; }
    if (character === "百") { total += (current || 1) * 100; current = 0; continue; }
    return undefined;
  }
  return total + current;
};

const normalizePromptText = (input: string) => input
  .normalize("NFKC")
  .replace(/[零〇一二两三四五六七八九十百]+(?=\s*(?:毫米|厘米|公分|米|个|条|排|孔|公斤|千克|吨))/g, (value) => String(chineseInteger(value) ?? value))
  .replace(/(\d+(?:\.\d+)?)\s*米\s*半/g, (_, value) => `${Number(value) + .5}米`)
  .replace(/(\d+)\s*米\s*([一二两三四五六七八九1-9])(?!\d)/g, (_, whole, decimal) => `${whole}.${typeof decimal === "string" && decimal in chineseDigits ? chineseDigits[decimal] : decimal}米`)
  .replace(/公分/g, "厘米")
  .replace(/[＊*X]/g, "×")
  .replace(/\s+/g, " ")
  .trim();

const mmValue = (value: string, unit: string | undefined) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return undefined;
  const normalizedUnit = unit?.toLowerCase();
  if (normalizedUnit === "m" || unit === "米") return numeric * 1000;
  if (normalizedUnit === "cm" || unit === "厘米" || unit === "公分") return numeric * 10;
  return numeric;
};

const clampDimension = (value: number | undefined, fallback: number) => Math.min(20000, Math.max(5, value ?? fallback));

const namedDimension = (prompt: string, labels: string[]): number | undefined => {
  for (const label of labels) {
    const after = prompt.match(new RegExp(`(?:${label})\\s*(?:为|是|[:：])?\\s*(?:大约|约|差不多)?\\s*(\\d+(?:\\.\\d+)?)\\s*(mm|毫米|cm|厘米|公分|m|米)?(?:左右)?`, "i"));
    if (after) return mmValue(after[1], after[2]);
    const before = prompt.match(new RegExp(`(?:大约|约|差不多)?\\s*(\\d+(?:\\.\\d+)?)\\s*(mm|毫米|cm|厘米|公分|m|米)?(?:左右)?\\s*(?:的)?(?:${label})`, "i"));
    if (before) return mmValue(before[1], before[2]);
  }
  return undefined;
};

const overallDimensions = (prompt: string) => {
  const match = prompt.match(/(\d+(?:\.\d+)?)\s*(mm|毫米|cm|厘米|公分|m|米)?\s*×\s*(\d+(?:\.\d+)?)\s*(mm|毫米|cm|厘米|公分|m|米)?\s*×\s*(\d+(?:\.\d+)?)\s*(mm|毫米|cm|厘米|公分|m|米)?/i);
  if (!match) return undefined;
  const specifiedUnits = [match[2], match[4], match[6]].filter(Boolean);
  const sharedUnit = specifiedUnits.length === 1 ? specifiedUnits[0] : undefined;
  return [mmValue(match[1], match[2] ?? sharedUnit)!, mmValue(match[3], match[4] ?? sharedUnit)!, mmValue(match[5], match[6] ?? sharedUnit)!] as const;
};

const intentRules: Record<Exclude<LocalCadAgentIntent, "generic">, Array<[RegExp, number, string]>> = {
  cnc: [[/数控|CNC|加工中心|机床/i, 8, "数控机床"], [/铣床|车床|雕刻机|钻攻中心/i, 6, "机加工设备"], [/夹住.*圆棒.*加工|加工.*圆棒|工件旋转.*加工/i, 6, "车削用途"], [/主轴.*工作台|工作台.*主轴/i, 3, "主轴与工作台"], [/切削|铣削|车削/i, 2, "切削用途"]],
  robot: [[/机器人|机械臂|机械手|robot/i, 8, "工业机器人"], [/六轴|6轴/i, 5, "六轴结构"], [/上下料|码垛|搬运|抓取|焊接工作站/i, 4, "自动化作业"], [/末端夹具|吸盘|焊枪/i, 3, "机器人末端工具"]],
  conveyor: [[/输送|传送|流水线|滚筒线|皮带线|conveyor/i, 8, "输送设备"], [/滚筒|传送带|输送带|链板/i, 5, "输送结构"], [/物料.*移动|工件.*流转/i, 3, "物料流转用途"]],
  enclosure: [[/控制柜|电控柜|配电柜|机柜|机箱|壳体|外壳|enclosure|cabinet/i, 8, "设备柜体"], [/钣金盒|防护罩|电气箱|箱子/i, 5, "箱体结构"], [/装电器|放电气元件|保护内部/i, 3, "电气防护用途"]],
  bracket: [[/支架|角码|托架|bracket/i, 8, "安装支架"], [/固定.*(?:电机|设备|零件)|(?:电机|设备|零件).*固定/i, 5, "固定用途"], [/承托|支撑件|安装座/i, 4, "承托结构"]],
  flange: [[/法兰|flange/i, 9, "法兰"], [/圆盘.*(?:中心孔|安装孔)|(?:中心孔|安装孔).*圆盘/i, 5, "带孔圆盘"]],
  shaft: [[/阶梯轴|传动轴|输出轴|轴套|联轴器|联轴结构|shaft/i, 8, "轴类零件"], [/(?:建立|设计|制作|做)(?:一根|一个|一套)?[^，。；]{0,12}(?:轴|轴类零件)/i, 4, "轴类结构"]],
};

const detectIntent = (prompt: string) => {
  const scored = Object.entries(intentRules).map(([intent, rules]) => {
    const matched = rules.filter(([pattern]) => pattern.test(prompt));
    return { intent: intent as Exclude<LocalCadAgentIntent, "generic">, score: matched.reduce((sum, [, score]) => sum + score, 0), evidence: matched.map(([, , label]) => label) };
  }).sort((a, b) => b.score - a.score);
  const winner = scored[0];
  if (!winner || winner.score === 0) return { intent: "generic" as LocalCadAgentIntent, confidence: "low" as const, evidence: [] as string[], alternative: undefined };
  const freeformHousing = /外壳|壳体|防护罩/.test(prompt) && !/控制柜|电控柜|配电柜|机柜|机箱|电气箱|装电器|放电气元件/.test(prompt);
  if (winner.intent === "enclosure" && freeformHousing) return { intent: "generic" as LocalCadAgentIntent, confidence: "medium" as const, evidence: ["自由外形壳体"], alternative: undefined };
  const margin = winner.score - (scored[1]?.score ?? 0);
  return { intent: winner.intent as LocalCadAgentIntent, confidence: winner.score >= 8 && margin >= 3 ? "high" as const : "medium" as const, evidence: winner.evidence, alternative: margin <= 2 && scored[1]?.score ? scored[1].intent : undefined };
};

const parseFeatureRequests = (prompt: string): LocalCadAgentFeatureRequests => {
  const countMatch = prompt.match(/(\d+)\s*个\s*M\s*\d+(?:\.\d+)?\s*孔/i)
    ?? prompt.match(/(\d+)\s*个\s*(?:安装|螺栓|螺纹|定位)?孔/i)
    ?? prompt.match(/带\s*(\d+)\s*(?:个)?\s*(?:安装|螺栓|螺纹|定位)?孔/i);
  const metricMatch = prompt.match(/M\s*(\d+(?:\.\d+)?)/i);
  const diameterMatch = prompt.match(/(?:孔径|孔直径|安装孔直径)\s*(?:为|是|[:：Ø⌀])?\s*(\d+(?:\.\d+)?)\s*(mm|毫米|cm|厘米|m|米)?/i);
  const filletMatch = prompt.match(/(?:圆角|倒圆)\s*R?\s*(\d+(?:\.\d+)?)\s*(mm|毫米)?/i) ?? prompt.match(/R\s*(\d+(?:\.\d+)?)\s*(?:mm|毫米)?\s*(?:圆角|倒圆)/i);
  const chamferMatch = prompt.match(/倒角\s*C?\s*(\d+(?:\.\d+)?)\s*(mm|毫米)?/i) ?? prompt.match(/C\s*(\d+(?:\.\d+)?)\s*(?:mm|毫米)?\s*倒角/i);
  const louverMatch = prompt.match(/(\d+)\s*(?:个|排|条)?\s*百叶(?:孔|窗)?/i);
  const loadMatch = prompt.match(/(?:载重|负载|承重|搬运)\s*(?:为|是|约|大约|[:：])?\s*(\d+(?:\.\d+)?)\s*(kg|公斤|千克|t|吨)/i);
  const speedMatch = prompt.match(/(?:速度|线速|输送速度)\s*(?:为|是|约|大约|[:：])?\s*(\d+(?:\.\d+)?)\s*(?:m\/min|米\/分|米每分钟)/i);
  const vagueHoles = /几个|若干|一些/.test(prompt) && /孔/.test(prompt);
  return {
    holeCount: countMatch ? Math.min(24, Math.max(1, Number(countMatch[1]))) : vagueHoles ? 4 : undefined,
    holeDiameterMm: diameterMatch ? mmValue(diameterMatch[1], diameterMatch[2]) : metricMatch ? Number(metricMatch[1]) : undefined,
    filletRadiusMm: filletMatch ? Math.max(.1, Number(filletMatch[1])) : /边角(?:别|不要)太尖|圆润一些|圆滑一些|去尖角/.test(prompt) ? 3 : undefined,
    chamferDistanceMm: chamferMatch ? Math.max(.1, Number(chamferMatch[1])) : /去锐边|倒一下边/.test(prompt) ? 1 : undefined,
    observationWindow: /观察窗|检视窗|视窗/i.test(prompt),
    louverCount: /百叶/i.test(prompt) ? Math.min(12, Math.max(3, Number(louverMatch?.[1] ?? 5))) : undefined,
    conveyorType: /皮带|传送带|输送带/.test(prompt) ? "belt" : /输送|传送|滚筒|流水线/.test(prompt) ? "roller" : undefined,
    robotEndEffector: /焊接|焊枪/.test(prompt) ? "welder" : /吸盘|真空|吸取|吸起|吸附/.test(prompt) ? "suction" : /抓取|夹取|拿取|上下料|码垛|夹爪/.test(prompt) ? "gripper" : undefined,
    cncType: /车床|车削|夹住.*圆棒.*加工|加工.*圆棒|工件旋转.*加工/.test(prompt) ? "lathe" : /数控|CNC|加工中心|铣床|铣削|钻攻/.test(prompt) ? "mill" : undefined,
    loadKg: loadMatch ? Number(loadMatch[1]) * (/t|吨/i.test(loadMatch[2]) ? 1000 : 1) : undefined,
    speedMMin: speedMatch ? Number(speedMatch[1]) : undefined,
  };
};

const defaults: Record<LocalCadAgentIntent, [number, number, number]> = {
  cnc: [1400, 1100, 1900], robot: [2200, 1800, 2200], conveyor: [3000, 900, 900], enclosure: [800, 500, 1200],
  bracket: [220, 140, 180], flange: [200, 200, 24], shaft: [500, 120, 120], generic: [300, 200, 120],
};

const titles: Record<LocalCadAgentIntent, string> = {
  cnc: "数控加工中心参数化模型", robot: "机器人工作单元参数化模型", conveyor: "模块化输送设备参数化模型",
  enclosure: "工业设备壳体参数化模型", bracket: "加强型安装支架", flange: "带孔工业法兰", shaft: "阶梯轴与联轴结构", generic: "用户需求参数化零件",
};

const resolveDimensions = (prompt: string, intent: LocalCadAgentIntent) => {
  const fallback = defaults[intent], triple = overallDimensions(prompt);
  const diameter = namedDimension(prompt, ["直径", "外径", "diameter"]);
  const explicit: Array<number | undefined> = [
    namedDimension(prompt, ["总长", "长度", "长", "length"]) ?? triple?.[0],
    namedDimension(prompt, ["总宽", "宽度", "宽", "width"]) ?? triple?.[1],
    namedDimension(prompt, ["总高", "高度", "厚度", "厚", "高", "height", "thickness"]) ?? triple?.[2],
  ];
  if (diameter !== undefined && intent === "flange") { explicit[0] ??= diameter; explicit[1] ??= diameter; }
  if (diameter !== undefined && (intent === "shaft" || intent === "generic")) { explicit[1] ??= diameter; explicit[2] ??= diameter; }
  if (explicit[2] === undefined && intent === "robot" && /一人高|和人差不多高|人那么高/.test(prompt)) explicit[2] = 1700;
  const semanticScale = /手掌大|巴掌大|手持|很小/.test(prompt) ? .48
    : /桌面|台式|小型|迷你/.test(prompt) ? .65
      : /紧凑|空间有限|占地小/.test(prompt) ? .8
        : /大型|大尺寸/.test(prompt) ? 1.25
          : /重型|重载/.test(prompt) ? 1.4 : 1;
  const ratios = explicit.map((value, index) => value === undefined ? undefined : value / fallback[index]).filter((value): value is number => value !== undefined && Number.isFinite(value));
  const inferredScale = ratios.length ? ratios.reduce((sum, value) => sum + value, 0) / ratios.length : semanticScale;
  const values = explicit.map((value, index) => clampDimension(value, fallback[index] * inferredScale)) as [number, number, number];
  const inferredAxes = ["长度", "宽度", "高度"].filter((_, index) => explicit[index] === undefined);
  const conflicts: string[] = [];
  if (triple) {
    const named = [namedDimension(prompt, ["总长", "长度", "长", "length"]), namedDimension(prompt, ["总宽", "宽度", "宽", "width"]), namedDimension(prompt, ["总高", "高度", "厚度", "厚", "高", "height", "thickness"])];
    named.forEach((value, index) => { if (value !== undefined && Math.abs(value - triple[index]) / Math.max(value, triple[index]) > .05) conflicts.push(`${["长度", "宽度", "高度"][index]}同时出现两个不同数值，已优先采用带名称的尺寸 ${value.toFixed(1)} mm。`); });
  }
  return { length: values[0], width: values[1], height: values[2], explicit, inferredAxes, diameter, triple, semanticScale, conflicts };
};

const resolveMaterial = (prompt: string, intent: LocalCadAgentIntent) => {
  if (/6061|铝合金|铝制|用铝/.test(prompt)) return { material: "铝合金 / 6061-T6", density: 2700, inferred: false };
  if (/304|不锈钢/.test(prompt)) return { material: "不锈钢 / 304", density: 7930, inferred: false };
  if (/铸铁|HT250/i.test(prompt)) return { material: "灰铸铁 / HT250", density: 7250, inferred: false };
  if (/工程塑料|尼龙|POM/i.test(prompt)) return { material: "工程塑料 / POM", density: 1410, inferred: false };
  if (/碳钢|Q235|钢制|普通钢/.test(prompt)) return { material: "碳钢 / Q235", density: 7850, inferred: false };
  if (/食品|洁净|潮湿|防水/.test(prompt)) return { material: "不锈钢 / 304", density: 7930, inferred: true };
  if (/户外|室外/.test(prompt)) return { material: "碳钢 / Q235（防腐涂层）", density: 7850, inferred: true };
  if (intent === "cnc") return { material: "灰铸铁 / HT250（床身）", density: 7250, inferred: true };
  if (intent === "enclosure") return { material: "冷轧钢板 / Q235", density: 7850, inferred: true };
  return { material: "碳钢 / Q235", density: 7850, inferred: true };
};

const contextEvidence = (prompt: string, requests: LocalCadAgentFeatureRequests) => [
  ...(requests.loadKg !== undefined ? [`额定负载约 ${requests.loadKg} kg`] : []),
  ...(requests.speedMMin !== undefined ? [`运行速度约 ${requests.speedMMin} m/min`] : []),
  ...(/户外|室外/.test(prompt) ? ["户外使用环境"] : []),
  ...(/防尘|粉尘/.test(prompt) ? ["需要防尘"] : []),
  ...(/防水|潮湿/.test(prompt) ? ["需要防水/防潮"] : []),
  ...(/食品|洁净|无尘/.test(prompt) ? ["洁净使用环境"] : []),
  ...(/高温/.test(prompt) ? ["高温使用环境"] : []),
];

const part = (id: string, type: ResourcePrimitiveKind, label: string, x: number, y: number, z: number, width: number, height: number, depth: number, color = "#526661", rotationX?: number, rotationY?: number, rotationZ?: number): ResourceModelPart => ({
  id, type, label, x: x / 1000, y: y / 1000, z: z / 1000, width: width / 1000, height: height / 1000, depth: depth / 1000,
  color, metalness: type === "box" ? .55 : .72, roughness: type === "box" ? .3 : .2, rotationX, rotationY, rotationZ,
});

type DetailAxis = "x" | "y" | "z";

const cylinderOnAxis = (id: string, label: string, x: number, y: number, z: number, diameter: number, length: number, axis: DetailAxis, color: string) =>
  part(id, "cylinder", label, x, y, z, diameter, length, diameter, color, axis === "z" ? Math.PI / 2 : undefined, undefined, axis === "x" ? Math.PI / 2 : undefined);

const torusOnAxis = (id: string, label: string, x: number, y: number, z: number, outerDiameter: number, tubeDiameter: number, axis: DetailAxis, color: string) =>
  part(id, "torus", label, x, y, z, outerDiameter, tubeDiameter, outerDiameter, color, axis === "z" ? Math.PI / 2 : undefined, undefined, axis === "x" ? Math.PI / 2 : undefined);

const axisOffset = (axis: DetailAxis, amount: number) => axis === "x" ? { x: amount, y: 0, z: 0 } : axis === "y" ? { x: 0, y: amount, z: 0 } : { x: 0, y: 0, z: amount };

const addCableSweep = (parts: ResourceModelPart[], options: { id: string; label: string; points: Array<{ x: number; y: number; z: number }>; diameter: number; color: string }) => {
  const min = { x: Math.min(...options.points.map((point) => point.x)), y: Math.min(...options.points.map((point) => point.y)), z: Math.min(...options.points.map((point) => point.z)) };
  const max = { x: Math.max(...options.points.map((point) => point.x)), y: Math.max(...options.points.map((point) => point.y)), z: Math.max(...options.points.map((point) => point.z)) };
  const center = { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2, z: (min.z + max.z) / 2 };
  parts.push({
    ...part(options.id, "box", `${options.label} · 平滑扫掠路径`, center.x, center.y, center.z, Math.max(options.diameter, max.x - min.x), Math.max(options.diameter, max.y - min.y), Math.max(options.diameter, max.z - min.z), options.color),
    mechanicalDetail: { kind: "cableSweep", diameterMm: options.diameter, pathPointsMm: options.points.map((point) => ({ x: point.x - center.x, y: point.y - center.y, z: point.z - center.z })) },
  });
};

const addThreadedFastener = (parts: ResourceModelPart[], options: { id: string; label: string; x: number; y: number; z: number; diameter: number; length: number; axis?: DetailAxis; color: string }) => {
  const axis = options.axis ?? "y", headThickness = options.diameter * .55, shaftOffset = axisOffset(axis, options.length / 2 + headThickness / 2);
  const pitchMm = Math.max(1, options.diameter * .18);
  parts.push({ ...cylinderOnAxis(`${options.id}-shaft`, `${options.label} · 连续参数化螺纹牙`, options.x, options.y, options.z, options.diameter, options.length, axis, options.color), mechanicalDetail: { kind: "externalThread", majorDiameterMm: options.diameter, pitchMm, lengthMm: options.length, threadedLengthMm: Math.min(options.length, Math.max(pitchMm * 4, options.diameter * 1.8)), threadDepthMm: Math.max(.35, options.diameter * .075) } });
  parts.push(cylinderOnAxis(`${options.id}-head`, `${options.label} · 六角头等效体`, options.x + shaftOffset.x, options.y + shaftOffset.y, options.z + shaftOffset.z, options.diameter * 1.7, headThickness, axis, options.color));
};

const addBearing = (parts: ResourceModelPart[], options: { id: string; label: string; x: number; y: number; z: number; outerDiameter: number; width: number; axis: DetailAxis; color: string }) => {
  parts.push({ ...cylinderOnAxis(`${options.id}-bearing`, `${options.label} · 参数化内外圈与滚动体`, options.x, options.y, options.z, options.outerDiameter, options.width, options.axis, options.color), mechanicalDetail: { kind: "bearing", outerDiameterMm: options.outerDiameter, innerDiameterMm: options.outerDiameter * .48, widthMm: options.width, ballCount: Math.max(7, Math.min(16, Math.round(options.outerDiameter / Math.max(5, options.width)))) } });
};

const addSpurGear = (parts: ResourceModelPart[], options: { id: string; label: string; x: number; y: number; z: number; outerDiameter: number; thickness: number; axis?: DetailAxis; teeth?: number; color: string }) => {
  const axis = options.axis ?? "y", teeth = Math.max(8, Math.min(40, options.teeth ?? 12));
  const moduleMm = options.outerDiameter / (teeth + 2);
  parts.push({ ...cylinderOnAxis(`${options.id}-gear`, `${options.label} · 参数化渐开线直齿`, options.x, options.y, options.z, options.outerDiameter, options.thickness, axis, options.color), mechanicalDetail: { kind: "spurGear", moduleMm, teeth, pressureAngleDeg: 20, thicknessMm: options.thickness, boreDiameterMm: options.outerDiameter * .24 } });
};

const addBoltCircle = (parts: ResourceModelPart[], options: { id: string; label: string; x: number; y: number; z: number; radius: number; boltDiameter: number; length: number; axis: DetailAxis; count?: number; color: string }) => {
  const count = Math.max(3, Math.min(12, options.count ?? 6));
  for (let index = 0; index < count; index += 1) {
    const angle = index * Math.PI * 2 / count;
    const offset = options.axis === "x" ? { x: 0, y: Math.cos(angle) * options.radius, z: Math.sin(angle) * options.radius }
      : options.axis === "y" ? { x: Math.cos(angle) * options.radius, y: 0, z: Math.sin(angle) * options.radius }
        : { x: Math.cos(angle) * options.radius, y: Math.sin(angle) * options.radius, z: 0 };
    parts.push(cylinderOnAxis(`${options.id}-${index + 1}`, `${options.label} ${index + 1}`, options.x + offset.x, options.y + offset.y, options.z + offset.z, options.boltDiameter, options.length, options.axis, options.color));
  }
};

const equipmentParts = (intent: LocalCadAgentIntent, prompt: string, length: number, width: number, height: number, requests: LocalCadAgentFeatureRequests) => {
  const parts: ResourceModelPart[] = [];
  const cuts: LocalCadAgentPlan["booleanCuts"] = [];
  let primaryPartId = "main";
  const dark = "#29423d", mid = "#60756f", metal = "#aeb8b2", yellow = "#d7ac37", aqua = "#4faaa5";
  if (intent === "flange") {
    primaryPartId = "flange";
    const diameter = Math.min(length, width), thickness = height, bore = diameter * .28, bolt = Math.max(2, requests.holeDiameterMm ?? diameter * .075), radius = diameter * .34;
    const holeCount = requests.holeCount ?? 4;
    parts.push(part("flange", "cylinder", "法兰盘 · 旋转基体", 0, thickness / 2, 0, diameter, thickness, diameter, metal));
    parts.push(part("center-bore", "cylinder", "中心通孔 · 布尔工具", 0, thickness / 2, 0, bore, thickness * 3, bore, yellow));
    for (let index = 0; index < holeCount; index += 1) { const angle = index * Math.PI * 2 / holeCount; parts.push(part(`bolt-hole-${index + 1}`, "cylinder", `安装孔 ${index + 1} · Ø${bolt.toFixed(1)} mm`, Math.cos(angle) * radius, thickness / 2, Math.sin(angle) * radius, bolt, thickness * 3, bolt, yellow)); }
    cuts.push({ targetPartId: "flange", toolPartIds: ["center-bore", ...Array.from({ length: holeCount }, (_, index) => `bolt-hole-${index + 1}`)] });
  } else if (intent === "bracket") {
    primaryPartId = "base";
    const t = Math.max(8, Math.min(length, width, height) * .09);
    parts.push(part("base", "box", "安装底板", 0, t / 2, 0, length, t, width, dark));
    parts.push(part("upright", "box", "垂直支承板", -length / 2 + t / 2, height / 2, 0, t, height, width, mid));
    parts.push(part("rib", "box", "加强筋", -length * .25, height * .28, 0, length * .42, t, width * .7, yellow, 0, 0, Math.PI / 4));
    const holeDiameter = Math.max(2, requests.holeDiameterMm ?? Math.min(length, width) * .07);
    const holeCount = requests.holeCount ?? 4;
    const holes = Array.from({ length: holeCount }, (_, index) => { const angle = index * Math.PI * 2 / holeCount + Math.PI / 4; return [Math.cos(angle) * length * .36, Math.sin(angle) * width * .36] as const; });
    holes.forEach(([x, z], index) => parts.push(part(`mount-hole-${index + 1}`, "cylinder", `底板安装孔 ${index + 1} · 布尔工具`, x, t / 2, z, holeDiameter, t * 3, holeDiameter, yellow)));
    cuts.push({ targetPartId: "base", toolPartIds: holes.map((_, index) => `mount-hole-${index + 1}`) });
  } else if (intent === "shaft") {
    primaryPartId = "shaft-main";
    const diameter = Math.min(width, height), axisY = diameter / 2;
    parts.push(part("shaft-main", "cylinder", "主轴段", 0, axisY, 0, diameter * .72, length * .62, diameter * .72, metal, 0, 0, Math.PI / 2));
    parts.push(part("shaft-left", "cylinder", "左轴颈", -length * .39, axisY, 0, diameter * .45, length * .2, diameter * .45, metal, 0, 0, Math.PI / 2));
    parts.push(part("shaft-right", "cylinder", "右轴颈", length * .39, axisY, 0, diameter * .45, length * .2, diameter * .45, metal, 0, 0, Math.PI / 2));
    parts.push(part("collar", "torus", "定位环", length * .2, axisY, 0, diameter, diameter * .16, diameter, dark, 0, 0, Math.PI / 2));
  } else if (intent === "enclosure") {
    primaryPartId = "door";
    const t = Math.max(8, Math.min(length, width) * .025);
    parts.push(part("base", "box", "壳体底板", 0, t / 2, 0, length, t, width, dark));
    parts.push(part("top", "box", "壳体顶板", 0, height - t / 2, 0, length, t, width, mid));
    parts.push(part("left", "box", "左侧板", -length / 2 + t / 2, height / 2, 0, t, height, width, mid));
    parts.push(part("right", "box", "右侧板", length / 2 - t / 2, height / 2, 0, t, height, width, mid));
    parts.push(part("back", "box", "后背板", 0, height / 2, width / 2 - t / 2, length, height, t, dark));
    parts.push(part("door", "box", "检修门", 0, height / 2, -width / 2 + t / 2, length * .88, height * .86, t, "#dfe5df"));
    parts.push(part("console", "box", "操作面板", length * .28, height * .64, -width / 2 + t * 1.5, length * .22, height * .16, t * 2, aqua));
    const doorTools: string[] = [];
    if (requests.observationWindow) {
      parts.push(part("observation-window", "box", "观察窗开口 · 布尔工具", -length * .12, height * .61, -width / 2 + t / 2, length * .42, height * .25, t * 4, yellow));
      doorTools.push("observation-window");
    }
    if (requests.louverCount) {
      for (let index = 0; index < requests.louverCount; index += 1) {
        const y = height * (.27 + .035 * index);
        const id = `louver-${index + 1}`;
        parts.push(part(id, "box", `百叶孔 ${index + 1} · 布尔工具`, length * .25, y, -width / 2 + t / 2, length * .2, Math.max(6, height * .012), t * 4, yellow));
        doorTools.push(id);
      }
    }
    if (doorTools.length) cuts.push({ targetPartId: "door", toolPartIds: doorTools });
  } else if (intent === "conveyor") {
    primaryPartId = "rail-left";
    const rail = Math.max(45, width * .07), rollerDiameter = Math.max(35, height * .07), bearingDiameter = rollerDiameter * 1.35;
    const rollerY = height - bearingDiameter / 2, bedY = rollerY - rail * .55;
    const railZ = width / 2 - rail / 2, rollerLength = Math.max(rail * 2, width - rail * 2.1);
    parts.push(part("rail-left", "box", "左侧精密机架", 0, bedY, -railZ, length, rail, rail, dark));
    parts.push(part("rail-right", "box", "右侧精密机架", 0, bedY, railZ, length, rail, rail, dark));
    for (const x of [-length * .4, length * .4]) for (const z of [-railZ, railZ]) parts.push(part(`leg-${x}-${z}`, "box", "可调支腿", x, bedY / 2, z, rail, bedY, rail, mid));
    for (const x of [-length * .25, length * .25]) parts.push(part(`cross-member-${x}`, "box", "横向承载梁", x, bedY - rail * .58, 0, rail, rail, width - rail * 2, dark));
    const count = requests.conveyorType === "belt" ? 2 : Math.max(5, Math.min(12, Math.round(length / 260)));
    for (let index = 0; index < count; index += 1) {
      const x = -length * .43 + (length * .86 * index) / (count - 1);
      parts.push(cylinderOnAxis(`roller-${index + 1}`, `${requests.conveyorType === "belt" ? "皮带驱动滚筒" : "输送滚筒"} ${index + 1} · 精密筒体`, x, rollerY, 0, rollerDiameter, rollerLength, "z", metal));
      if (index === 0 || index === Math.floor(count / 2) || index === count - 1) {
        for (const side of [-1, 1]) addBearing(parts, { id: `roller-${index + 1}-bearing-${side < 0 ? "l" : "r"}`, label: `滚筒 ${index + 1} 轴承`, x, y: rollerY, z: side * (rollerLength / 2 + rail * .3), outerDiameter: bearingDiameter, width: rail * .32, axis: "z", color: dark });
      }
    }
    if (requests.conveyorType === "belt") parts.push(part("conveyor-belt", "box", "连续输送皮带与承载面", 0, rollerY + rollerDiameter / 2 + 4, 0, length * .86, 8, rollerLength * .96, dark));
    parts.push(part("drive", "cylinder", "驱动电机", length * .43, Math.max(rollerDiameter * 1.15, bedY - rollerDiameter * .65), width * .4, rollerDiameter * 2.3, width * .2, rollerDiameter * 2.3, yellow, Math.PI / 2));
    addSpurGear(parts, { id: "drive-gear", label: "驱动齿轮", x: length * .38, y: rollerY - rollerDiameter * 1.45, z: railZ - rail * .24, outerDiameter: rollerDiameter * 2.05, thickness: rail * .28, axis: "z", teeth: 12, color: yellow });
    addSpurGear(parts, { id: "roller-gear", label: "从动齿轮", x: length * .335, y: rollerY - rollerDiameter * .72, z: railZ - rail * .24, outerDiameter: rollerDiameter * 1.55, thickness: rail * .28, axis: "z", teeth: 10, color: metal });
    parts.push(part("chain-guard", "box", "链轮传动防护罩", length * .36, rollerY - rollerDiameter * 1.08, railZ - rail * .08, length * .13, rollerDiameter * 2.7, rail * .2, aqua));
    addCableSweep(parts, { id: "power-cable", label: "驱动电机动力线缆", diameter: Math.max(8, rail * .14), color: dark, points: [
      { x: length * .14, y: bedY * .36, z: railZ - rail * .35 },
      { x: length * .34, y: bedY * .36, z: railZ - rail * .35 },
      { x: length * .42, y: bedY * .5, z: railZ - rail * .35 },
      { x: length * .42, y: bedY * .76, z: railZ - rail * .35 },
    ] });
    for (const x of [-length * .4, length * .4]) for (const z of [-railZ, railZ]) addThreadedFastener(parts, { id: `foot-bolt-${x}-${z}`, label: "支腿调平螺栓", x, y: rail * .25, z, diameter: Math.max(8, rail * .18), length: rail * .5, color: metal });
  } else if (intent === "robot") {
    primaryPartId = "cell-base";
    const base = Math.min(length, width) * .28, shell = "#dce3df", shellAccent = "#91a7a1";
    parts.push(part("cell-base", "box", "机器人单元底板", 0, 30, 0, length, 60, width, dark));
    parts.push(part("pedestal", "cylinder", "回转底座", 0, height * .12, 0, base, height * .22, base, yellow));
    parts.push(part("shoulder", "cylinder", "肩部关节", 0, height * .27, 0, base * .72, base * .58, base * .72, mid, Math.PI / 2));
    parts.push(part("upper-arm", "box", "上臂", length * .11, height * .46, 0, base * .32, height * .42, base * .3, yellow, 0, 0, -Math.PI / 7));
    parts.push(part("elbow", "cylinder", "肘部关节", length * .21, height * .66, 0, base * .48, base * .42, base * .48, mid, Math.PI / 2));
    parts.push(part("forearm", "box", "前臂", length * .33, height * .77, 0, base * .25, height * .32, base * .24, metal, 0, 0, -Math.PI / 3));
    parts.push(part("wrist", "cylinder", "腕部与法兰", length * .46, height - base * .15, 0, base * .3, base * .28, base * .3, yellow, 0, 0, Math.PI / 2));
    parts.push(part("fixture", "box", "工作台与工装", -length * .3, height * .28, 0, length * .26, height * .5, width * .32, mid));
    // Fine-surface layer: analytic cylinders and tori create smooth cast-shell
    // silhouettes around the editable structural cores.  Each cover remains
    // an independent B-Rep Body so it can be hidden, measured or replaced.
    parts.push(part("j1-cast-shell", "cylinder", "J1 铸造回转外壳", 0, height * .13, 0, base * .9, height * .16, base * .9, shell));
    parts.push(torusOnAxis("j1-lower-seam", "J1 底座装配缝", 0, height * .065, 0, base * .91, base * .035, "y", dark));
    parts.push(torusOnAxis("j1-upper-seam", "J1 回转壳装配缝", 0, height * .195, 0, base * .76, base * .028, "y", dark));
    parts.push(part("j2-rounded-shell", "cylinder", "J2 肩部圆角外壳", 0, height * .28, 0, base * .78, base * .7, base * .78, shell, Math.PI / 2));
    parts.push(cylinderOnAxis("j2-left-cap", "J2 左侧精密端盖", 0, height * .28, -base * .36, base * .66, base * .065, "z", shellAccent));
    parts.push(cylinderOnAxis("j2-right-cap", "J2 右侧精密端盖", 0, height * .28, base * .36, base * .66, base * .065, "z", shellAccent));
    parts.push(torusOnAxis("j2-cover-seam", "J2 端盖密封圈", 0, height * .28, -base * .398, base * .61, base * .025, "z", dark));
    parts.push(part("upper-arm-cast-shell", "cylinder", "上臂流线铸造外壳", length * .11, height * .46, 0, base * .36, height * .42, base * .36, shell, undefined, undefined, -Math.PI / 7));
    for (const side of [-1, 1]) parts.push(part(`upper-arm-service-panel-${side}`, "box", `上臂${side < 0 ? "左" : "右"}检修盖板`, length * .11, height * .47, side * base * .185, base * .17, height * .2, base * .018, shellAccent, undefined, undefined, -Math.PI / 7));
    parts.push(part("upper-arm-center-rib", "box", "上臂外壳中心加强脊", length * .105, height * .475, -base * .198, base * .055, height * .27, base * .022, dark, undefined, undefined, -Math.PI / 7));
    parts.push(part("j3-rounded-shell", "cylinder", "J3 肘部圆角外壳", length * .21, height * .66, 0, base * .56, base * .48, base * .56, shell, Math.PI / 2));
    parts.push(cylinderOnAxis("j3-left-cap", "J3 左侧编码器端盖", length * .21, height * .66, -base * .275, base * .47, base * .055, "z", shellAccent));
    parts.push(cylinderOnAxis("j3-right-cap", "J3 右侧减速器端盖", length * .21, height * .66, base * .275, base * .47, base * .055, "z", shellAccent));
    parts.push(torusOnAxis("j3-cover-seam", "J3 端盖密封圈", length * .21, height * .66, -base * .307, base * .43, base * .022, "z", dark));
    parts.push(part("forearm-cast-shell", "cylinder", "前臂流线铸造外壳", length * .33, height * .77, 0, base * .29, height * .32, base * .29, shell, undefined, undefined, -Math.PI / 3));
    for (const side of [-1, 1]) parts.push(part(`forearm-service-panel-${side}`, "box", `前臂${side < 0 ? "左" : "右"}检修盖板`, length * .33, height * .78, side * base * .15, base * .13, height * .14, base * .016, shellAccent, undefined, undefined, -Math.PI / 3));
    parts.push(cylinderOnAxis("j4-roll-shell", "J4 前臂回转壳", length * .395, height - base * .22, 0, base * .25, length * .105, "x", shell));
    parts.push(torusOnAxis("j4-seam", "J4 回转密封圈", length * .41, height - base * .22, 0, base * .255, base * .025, "x", dark));
    parts.push(cylinderOnAxis("j5-pitch-shell", "J5 腕部摆动壳", length * .435, height - base * .19, 0, base * .27, base * .2, "z", shellAccent));
    parts.push(torusOnAxis("j5-seam", "J5 腕部密封圈", length * .435, height - base * .19, -base * .115, base * .235, base * .022, "z", dark));
    parts.push(cylinderOnAxis("j6-flange-shell", "J6 末端回转法兰", length * .463, height - base * .15, 0, base * .24, length * .055, "x", shell));
    parts.push(torusOnAxis("j6-flange-seam", "J6 法兰密封圈", length * .477, height - base * .15, 0, base * .215, base * .018, "x", dark));
    addBoltCircle(parts, { id: "j1-shell-bolt", label: "J1 壳体紧固螺钉", x: 0, y: height * .205, z: 0, radius: base * .31, boltDiameter: base * .026, length: base * .035, axis: "y", count: 8, color: metal });
    addBoltCircle(parts, { id: "j2-cover-bolt", label: "J2 端盖紧固螺钉", x: 0, y: height * .28, z: -base * .405, radius: base * .235, boltDiameter: base * .022, length: base * .035, axis: "z", count: 8, color: metal });
    addBoltCircle(parts, { id: "j3-cover-bolt", label: "J3 端盖紧固螺钉", x: length * .21, y: height * .66, z: -base * .313, radius: base * .16, boltDiameter: base * .018, length: base * .03, axis: "z", count: 6, color: metal });
    addBoltCircle(parts, { id: "j6-tool-bolt", label: "J6 工具法兰螺钉", x: length * .48, y: height - base * .15, z: 0, radius: base * .075, boltDiameter: base * .016, length: length * .012, axis: "x", count: 6, color: metal });
    parts.push(cylinderOnAxis("upper-arm-cable-gland", "上臂线缆密封接头", length * .03, height * .36, -base * .23, base * .075, base * .08, "z", dark));
    parts.push(cylinderOnAxis("forearm-cable-gland", "前臂线缆密封接头", length * .255, height * .69, -base * .205, base * .06, base * .07, "z", dark));
    parts.push(part("robot-nameplate", "box", "机器人铭牌与安全标识", length * .09, height * .5, -base * .205, base * .12, height * .07, base * .012, yellow, undefined, undefined, -Math.PI / 7));
    parts.push(cylinderOnAxis("status-lamp-green", "运行状态指示灯", -base * .31, height * .22, -base * .33, base * .035, base * .025, "z", aqua));
    addBearing(parts, { id: "joint-1-bearing", label: "J1 回转轴承", x: 0, y: height * .105, z: 0, outerDiameter: base * .78, width: base * .12, axis: "y", color: metal });
    addBearing(parts, { id: "joint-2-bearing", label: "J2 肩部轴承", x: 0, y: height * .28, z: 0, outerDiameter: base * .62, width: base * .12, axis: "z", color: metal });
    addBearing(parts, { id: "joint-3-bearing", label: "J3 肘部轴承", x: length * .21, y: height * .66, z: 0, outerDiameter: base * .42, width: base * .1, axis: "z", color: metal });
    addBearing(parts, { id: "joint-5-bearing", label: "J5 腕部轴承", x: length * .43, y: height - base * .17, z: 0, outerDiameter: base * .24, width: base * .08, axis: "x", color: metal });
    addSpurGear(parts, { id: "joint-1-gear", label: "J1 精密减速齿轮", x: 0, y: height * .16, z: 0, outerDiameter: base * .58, thickness: base * .09, axis: "y", teeth: 14, color: yellow });
    parts.push(part("joint-2-servo", "box", "J2 伺服电机", -base * .24, height * .3, 0, base * .24, base * .22, base * .25, dark));
    parts.push(part("joint-3-servo", "box", "J3 伺服电机", length * .19, height * .67, -base * .2, base * .2, base * .2, base * .2, dark));
    parts.push(part("wrist-servo", "cylinder", "J4/J5/J6 中空腕部电机", length * .405, height - base * .17, 0, base * .2, length * .12, base * .2, dark, 0, 0, Math.PI / 2));
    parts.push(part("upper-arm-cable", "box", "上臂动力与编码器线缆", length * .1, height * .47, -base * .19, base * .045, height * .3, base * .045, dark, 0, 0, -Math.PI / 7));
    parts.push(part("forearm-cable", "box", "前臂动力与编码器线缆", length * .34, height * .79, -base * .16, base * .04, height * .15, base * .04, dark, 0, 0, -Math.PI / 3));
    parts.push(cylinderOnAxis("wrist-cable", "中空腕部线缆", length * .41, height - base * .1, -base * .1, base * .035, length * .16, "x", dark));
    if (requests.robotEndEffector === "welder") {
      parts.push(cylinderOnAxis("welding-torch", "焊接末端执行器 · 焊枪", length * .472, height - base * .09, 0, base * .08, length * .04, "x", dark));
      parts.push(part("welding-nozzle", "cone", "焊枪喷嘴", length * .492, height - base * .09, 0, base * .055, length * .016, base * .055, metal, 0, 0, Math.PI / 2));
      parts.push(cylinderOnAxis("welding-cable", "焊接电缆与保护气管", length * .44, height - base * .04, -base * .11, base * .035, length * .1, "x", dark));
    } else if (requests.robotEndEffector === "suction") {
      parts.push(part("suction-manifold", "box", "真空吸取末端 · 分配板", length * .49, height - base * .09, 0, length * .025, base * .08, base * .28, dark));
      for (const z of [-base * .1, base * .1]) parts.push(cylinderOnAxis(`suction-cup-${z}`, "真空吸盘", length * .49, height - base * .09, z, base * .065, length * .018, "x", metal));
    } else {
      parts.push(part("gripper-body", "box", "末端夹具本体", length * .477, height - base * .09, 0, length * .032, base * .12, base * .25, dark));
      parts.push(part("gripper-jaw-left", "box", "左夹爪", length * .492, height - base * .055, -base * .09, length * .016, base * .08, base * .055, metal));
      parts.push(part("gripper-jaw-right", "box", "右夹爪", length * .492, height - base * .055, base * .09, length * .016, base * .08, base * .055, metal));
    }
    parts.push(part("controller-cabinet", "box", "机器人控制柜与驱动器", -length * .4, height * .16, width * .32, length * .18, height * .3, width * .2, dark));
    for (const x of [-base * .15, base * .15]) for (const z of [-base * .15, base * .15]) addThreadedFastener(parts, { id: `robot-anchor-${x}-${z}`, label: "机器人底座锚栓", x, y: 30, z, diameter: Math.max(10, base * .025), length: 44, color: metal });
  } else if (intent === "cnc" && requests.cncType === "lathe") {
    primaryPartId = "lathe-base";
    parts.push(part("lathe-base", "box", "数控车床减振床身", 0, height * .08, 0, length, height * .16, width, dark));
    parts.push(part("lathe-headstock", "box", "主轴箱与齿轮腔", -length * .31, height * .48, width * .06, length * .28, height * .58, width * .58, mid));
    parts.push(cylinderOnAxis("lathe-spindle", "车削主轴", -length * .15, height * .5, -width * .08, width * .12, length * .22, "x", metal));
    addBearing(parts, { id: "lathe-spindle-bearing-front", label: "主轴前端精密轴承", x: -length * .18, y: height * .5, z: -width * .08, outerDiameter: width * .15, width: length * .035, axis: "x", color: metal });
    addBearing(parts, { id: "lathe-spindle-bearing-rear", label: "主轴后端精密轴承", x: -length * .28, y: height * .5, z: -width * .08, outerDiameter: width * .14, width: length * .03, axis: "x", color: metal });
    parts.push(cylinderOnAxis("lathe-chuck", "三爪液压卡盘", -length * .03, height * .5, -width * .08, width * .24, length * .075, "x", dark));
    for (let index = 0; index < 3; index += 1) { const angle = index * Math.PI * 2 / 3; parts.push(part(`chuck-jaw-${index + 1}`, "box", `卡盘夹爪 ${index + 1}`, length * .015, height * .5 + Math.cos(angle) * width * .07, -width * .08 + Math.sin(angle) * width * .07, length * .055, width * .045, width * .045, metal, angle)); }
    for (const z of [-width * .16, width * .16]) parts.push(part(`lathe-guide-${z}`, "box", "车床精密直线导轨", length * .08, height * .255, z, length * .58, height * .025, width * .04, metal));
    parts.push(part("lathe-carriage", "box", "纵向滑鞍", length * .07, height * .31, 0, length * .2, height * .09, width * .5, mid));
    parts.push(part("lathe-cross-slide", "box", "横向滑板", length * .07, height * .37, -width * .04, length * .15, height * .045, width * .38, metal));
    parts.push(cylinderOnAxis("lathe-turret", "八工位刀塔", length * .07, height * .46, -width * .1, width * .24, height * .1, "y", yellow));
    for (let index = 0; index < 8; index += 1) { const angle = index * Math.PI / 4; parts.push(part(`lathe-tool-${index + 1}`, "box", `刀塔刀位 ${index + 1}`, length * .07 + Math.cos(angle) * width * .09, height * .46, -width * .1 + Math.sin(angle) * width * .09, length * .08, height * .025, width * .025, metal, undefined, -angle)); }
    parts.push(part("lathe-tailstock", "box", "液压尾座", length * .34, height * .39, 0, length * .18, height * .28, width * .34, mid));
    parts.push(cylinderOnAxis("lathe-tailstock-quill", "尾座套筒与顶尖", length * .23, height * .5, -width * .08, width * .085, length * .17, "x", metal));
    parts.push(cylinderOnAxis("lathe-lead-screw", "Z 轴滚珠丝杠", length * .05, height * .2, width * .2, width * .035, length * .62, "x", metal));
    addBearing(parts, { id: "lathe-screw-bearing-fixed", label: "丝杠固定端轴承", x: -length * .26, y: height * .2, z: width * .2, outerDiameter: width * .075, width: length * .025, axis: "x", color: dark });
    addBearing(parts, { id: "lathe-screw-bearing-free", label: "丝杠支承端轴承", x: length * .36, y: height * .2, z: width * .2, outerDiameter: width * .07, width: length * .02, axis: "x", color: dark });
    addSpurGear(parts, { id: "lathe-spindle-gear", label: "主轴变速齿轮", x: -length * .36, y: height * .64, z: width * .08, outerDiameter: width * .15, thickness: length * .035, axis: "x", teeth: 12, color: yellow });
    parts.push(part("lathe-spindle-servo", "box", "主轴伺服电机", -length * .36, height * .73, width * .08, length * .15, height * .14, width * .15, dark));
    parts.push(part("lathe-guard-left", "box", "左侧安全防护", -length * .4825, height * .54, 0, length * .035, height * .92, width * .9, aqua));
    parts.push(part("lathe-guard-right", "box", "右侧安全防护", length * .4825, height * .54, 0, length * .035, height * .92, width * .9, aqua));
    parts.push(part("lathe-door", "box", "前滑动防护门", length * .06, height * .58, -width * .44, length * .48, height * .66, width * .025, "#dfe5df"));
    parts.push(part("lathe-control", "box", "数控操作面板", length * .4, height * .63, -width * .38, length * .12, height * .28, width * .13, dark));
    parts.push(cylinderOnAxis("lathe-control-cable", "控制与伺服线缆", length * .3, height * .45, -width * .31, width * .022, height * .28, "y", dark));
    for (const x of [-length * .28, length * .18]) for (const z of [-width * .16, width * .16]) addThreadedFastener(parts, { id: `lathe-tool-bolt-${x}-${z}`, label: "刀架紧固螺栓", x, y: height * .34, z, diameter: Math.max(10, width * .012), length: height * .045, color: yellow });
  } else if (intent === "cnc") {
    primaryPartId = "base";
    parts.push(part("base", "box", "减振床身", 0, height * .08, 0, length, height * .16, width, dark));
    parts.push(part("column", "box", "机床立柱", length * .2, height * .48, width * .18, length * .28, height * .76, width * .38, mid));
    parts.push(part("table", "box", "精密工作台", -length * .12, height * .23, 0, length * .46, height * .08, width * .46, metal));
    parts.push(part("spindle", "cylinder", "加工主轴", length * .12, height * .68, -width * .05, width * .13, height * .28, width * .13, yellow));
    parts.push(part("head", "box", "主轴箱", length * .12, height * .78, width * .02, length * .28, height * .22, width * .3, dark));
    parts.push(part("guard-left", "box", "左侧防护", -length * .46, height * .52, 0, length * .035, height * .96, width * .9, aqua));
    parts.push(part("guard-right", "box", "右侧防护", length * .46, height * .52, 0, length * .035, height * .96, width * .9, aqua));
    parts.push(part("door", "box", "前检修门", -length * .12, height * .55, -width * .43, length * .5, height * .68, width * .025, "#dfe5df"));
    parts.push(part("control", "box", "数控操作箱", length * .39, height * .62, -width * .37, length * .12, height * .3, width * .14, dark));
    parts.push(part("chip", "box", "排屑装置", -length * .29, height * .14, width * .4, length * .38, height * .12, width * .12, mid));
    for (const z of [-width * .16, width * .16]) parts.push(part(`linear-guide-${z}`, "box", "工作台直线导轨", -length * .1, height * .285, z, length * .48, height * .025, width * .035, metal));
    parts.push(cylinderOnAxis("ball-screw", "X 轴滚珠丝杠", -length * .1, height * .31, width * .02, width * .035, length * .48, "x", metal));
    addBearing(parts, { id: "ballscrew-bearing-fixed", label: "丝杠固定端角接触轴承", x: -length * .34, y: height * .31, z: width * .02, outerDiameter: width * .07, width: length * .025, axis: "x", color: dark });
    addBearing(parts, { id: "ballscrew-bearing-free", label: "丝杠支承端轴承", x: length * .14, y: height * .31, z: width * .02, outerDiameter: width * .065, width: length * .02, axis: "x", color: dark });
    addBearing(parts, { id: "spindle-bearing-upper", label: "主轴上端精密轴承", x: length * .12, y: height * .76, z: -width * .05, outerDiameter: width * .12, width: height * .035, axis: "y", color: metal });
    addBearing(parts, { id: "spindle-bearing-lower", label: "主轴下端精密轴承", x: length * .12, y: height * .58, z: -width * .05, outerDiameter: width * .12, width: height * .035, axis: "y", color: metal });
    parts.push(part("tool-holder", "cone", "BT 刀柄与刀具", length * .12, height * .505, -width * .05, width * .075, height * .13, width * .075, metal));
    addSpurGear(parts, { id: "spindle-drive-gear", label: "主轴传动齿轮", x: length * .12, y: height * .84, z: width * .02, outerDiameter: width * .11, thickness: height * .03, axis: "y", teeth: 12, color: yellow });
    addSpurGear(parts, { id: "servo-drive-gear", label: "伺服电机齿轮", x: length * .23, y: height * .84, z: width * .02, outerDiameter: width * .085, thickness: height * .03, axis: "y", teeth: 10, color: metal });
    parts.push(part("spindle-servo", "box", "主轴伺服电机", length * .27, height * .84, width * .02, length * .11, height * .16, width * .14, dark));
    parts.push(cylinderOnAxis("tool-magazine", "圆盘式刀库", -length * .31, height * .6, width * .18, Math.min(length, height) * .2, width * .055, "z", dark));
    for (let index = 0; index < 8; index += 1) { const angle = index * Math.PI / 4; parts.push(cylinderOnAxis(`magazine-tool-${index + 1}`, `刀库刀位 ${index + 1}`, -length * .31 + Math.cos(angle) * length * .07, height * .6 + Math.sin(angle) * length * .07, width * .145, width * .025, width * .06, "z", metal)); }
    parts.push(cylinderOnAxis("control-cable-horizontal", "控制柜动力线缆 · 横向段", length * .31, height * .46, -width * .3, width * .022, length * .16, "x", dark));
    parts.push(cylinderOnAxis("control-cable-vertical", "控制柜动力线缆 · 垂直段", length * .23, height * .57, -width * .3, width * .022, height * .22, "y", dark));
    for (const x of [-length * .31, length * .08]) for (const z of [-width * .16, width * .16]) addThreadedFastener(parts, { id: `table-bolt-${x}-${z}`, label: "工作台 T 槽紧固螺栓", x, y: height * .285, z, diameter: Math.max(10, width * .012), length: height * .045, color: yellow });
  } else {
    const type: ResourcePrimitiveKind = /圆柱|圆棒|圆盘|cylinder/i.test(prompt) ? "cylinder" : "box";
    parts.push(part("main", type, "Agent 参数化基体", 0, height / 2, 0, length, height, width, mid));
    const holeCount = requests.holeCount ?? (/中心孔|通孔|带孔/i.test(prompt) ? 1 : 0);
    if (holeCount) {
      const holeDiameter = Math.max(2, requests.holeDiameterMm ?? Math.min(length, width) * .12);
      const toolIds: string[] = [];
      for (let index = 0; index < holeCount; index += 1) {
        const angle = index * Math.PI * 2 / holeCount;
        const radius = holeCount === 1 ? 0 : Math.min(length, width) * .3;
        const id = `hole-${index + 1}`;
        parts.push(part(id, "cylinder", `通孔 ${index + 1} · Ø${holeDiameter.toFixed(1)} mm`, Math.cos(angle) * radius, height / 2, Math.sin(angle) * radius, holeDiameter, height * 3, holeDiameter, yellow));
        toolIds.push(id);
      }
      cuts.push({ targetPartId: "main", toolPartIds: toolIds });
    }
  }
  return { parts, cuts, primaryPartId };
};

const polygon = (points: Array<[number, number]>): AgentProfile => ({ kind: "polygon", points: points.map(([x, y]) => ({ x, y })) });
const circle = (x: number, y: number, radiusMm: number): AgentProfile => ({ kind: "circle", center: { x, y }, radiusMm });
const rectangle = (minX: number, minY: number, maxX: number, maxY: number): AgentProfile => polygon([[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]]);
const roundedOctagon = (centerX: number, centerY: number, width: number, height: number, cornerRatio = .18): AgentProfile => {
  const halfWidth = width / 2, halfHeight = height / 2;
  const corner = Math.min(halfWidth, halfHeight) * Math.max(.05, Math.min(.42, cornerRatio));
  return polygon([
    [centerX - halfWidth + corner, centerY - halfHeight], [centerX + halfWidth - corner, centerY - halfHeight],
    [centerX + halfWidth, centerY - halfHeight + corner], [centerX + halfWidth, centerY + halfHeight - corner],
    [centerX + halfWidth - corner, centerY + halfHeight], [centerX - halfWidth + corner, centerY + halfHeight],
    [centerX - halfWidth, centerY + halfHeight - corner], [centerX - halfWidth, centerY - halfHeight + corner],
  ]);
};

const featureDrivenProgram = (
  id: string,
  title: string,
  intent: LocalCadAgentIntent,
  prompt: string,
  dimensions: { length: number; width: number; height: number },
  requests: LocalCadAgentFeatureRequests,
  material: { material: string; density: number },
): { program?: AgentCadFeatureProgram; replaces?: string[] } => {
  const { length, width, height } = dimensions;
  const engineering = { material: material.material, densityKgM3: material.density, toleranceMm: intent === "shaft" || intent === "flange" ? .03 : .1, process: intent === "enclosure" ? "钣金 / 机加工" : "机加工", group: `Agent 特征设计 / ${title}` };
  const dark = { color: "#29423d", metalness: .62, roughness: .26 };
  const metal = { color: "#aeb8b2", metalness: .78, roughness: .18 };
  const accent = { color: "#d7ac37", metalness: .68, roughness: .2 };
  let parts: AgentFeaturePartProgram[] = [];
  let primaryPartId = "main";
  let replaces: string[] | undefined;

  if (intent === "bracket") {
    primaryPartId = "base";
    const thickness = Math.max(8, Math.min(length, width, height) * .09);
    const ribWidth = Math.max(thickness, width * .16);
    const steps: AgentFeaturePartProgram["steps"] = [
      { id: "l-profile", name: "L 形承载轮廓", kind: "extrude", plane: { type: "XY", offset: -width / 2 }, profile: polygon([[-length / 2, 0], [length / 2, 0], [length / 2, thickness], [-length / 2 + thickness, thickness], [-length / 2 + thickness, height], [-length / 2, height]]), distanceMm: width, operation: "new" },
      { id: "gusset", name: "三角加强筋", kind: "extrude", plane: { type: "XY", offset: -ribWidth / 2 }, profile: polygon([[-length / 2 + thickness, thickness], [-length / 2 + thickness, Math.min(height * .62, thickness + length * .28)], [-length / 2 + Math.min(length * .34, height * .55), thickness]]), distanceMm: ribWidth, operation: "add" },
    ];
    const count = Math.max(2, requests.holeCount ?? 4);
    for (let index = 0; index < count; index += 1) {
      const columns = Math.ceil(count / 2), column = Math.floor(index / 2), side = index % 2 ? 1 : -1;
      const x = columns === 1 ? length * .18 : -length * .18 + (length * .5 * column) / Math.max(1, columns - 1);
      const z = side * width * .3;
      steps.push({ id: `mount-hole-${index + 1}`, name: `安装孔 ${index + 1}`, kind: "extrude", plane: { type: "XZ", offset: -thickness }, profile: circle(x, z, Math.max(2, (requests.holeDiameterMm ?? thickness * .55) / 2)), distanceMm: thickness * 1.5, operation: "remove" });
    }
    parts = [{ id: "base", name: "一体式加强安装支架", steps, appearance: dark, engineering }];
  } else if (intent === "shaft") {
    primaryPartId = "shaft-main";
    const diameter = Math.min(width, height), radius = diameter / 2;
    const steps: AgentFeaturePartProgram["steps"] = [{
      id: "stepped-revolve", name: "阶梯轴连续旋转轮廓", kind: "revolve", plane: { type: "XY", offset: 0 }, axis: { origin: { x: 0, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 } },
      profile: polygon([[-length / 2, 0], [-length / 2, radius * .48], [-length * .3, radius * .48], [-length * .3, radius * .72], [-length * .14, radius * .72], [-length * .14, radius], [length * .18, radius], [length * .18, radius * .72], [length * .34, radius * .72], [length * .34, radius * .48], [length / 2, radius * .48], [length / 2, 0]]),
    }];
    if (/空心|通孔|中心孔/.test(prompt)) steps.push({ id: "axial-bore", name: "轴向中心通孔", kind: "extrude", plane: { type: "YZ", offset: -length / 2 }, profile: circle(0, 0, radius * .2), distanceMm: length, operation: "remove" });
    steps.push({ id: "ground", name: "轴件基准定位", kind: "transform", translationMm: { x: 0, y: radius, z: 0 } });
    parts = [{ id: "shaft-main", name: "连续轮廓阶梯轴", steps, appearance: metal, engineering }];
  } else if (intent === "flange") {
    primaryPartId = "flange";
    const diameter = Math.min(length, width), radius = diameter / 2, hubRadius = radius * .54, thickness = height;
    const steps: AgentFeaturePartProgram["steps"] = [{
      id: "hubbed-revolve", name: "法兰盘与凸台连续旋转", kind: "revolve", plane: { type: "XY", offset: 0 }, axis: { origin: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 1, z: 0 } },
      profile: polygon([[0, 0], [hubRadius, 0], [hubRadius, thickness * .2], [radius, thickness * .2], [radius, thickness * .8], [hubRadius, thickness * .8], [hubRadius, thickness], [0, thickness]]),
    }];
    const bore = diameter * .28;
    steps.push({ id: "center-bore", name: "中心通孔", kind: "extrude", plane: { type: "XZ", offset: -thickness }, profile: circle(0, 0, bore / 2), distanceMm: thickness * 1.2, operation: "remove" });
    const holeCount = Math.max(3, requests.holeCount ?? 4), pitchRadius = diameter * .34, holeRadius = Math.max(2, (requests.holeDiameterMm ?? diameter * .075) / 2);
    for (let index = 0; index < holeCount; index += 1) {
      const angle = index * Math.PI * 2 / holeCount;
      steps.push({ id: `bolt-hole-${index + 1}`, name: `法兰安装孔 ${index + 1}`, kind: "extrude", plane: { type: "XZ", offset: -thickness }, profile: circle(Math.cos(angle) * pitchRadius, Math.sin(angle) * pitchRadius, holeRadius), distanceMm: thickness * 1.2, operation: "remove" });
    }
    parts = [{ id: "flange", name: "带凸台整体法兰", steps, appearance: metal, engineering }];
  } else if (intent === "enclosure") {
    primaryPartId = "door";
    const thickness = Math.max(6, Math.min(length, width) * .025);
    parts = [{
      id: "cabinet", name: "整体薄壁柜体", appearance: dark, engineering, steps: [
        { id: "outer", name: "柜体外轮廓", kind: "extrude", plane: { type: "XY", offset: -width / 2 }, profile: rectangle(-length / 2, 0, length / 2, height), distanceMm: width, operation: "new" },
        { id: "cavity", name: "内部空间与前部开口", kind: "extrude", plane: { type: "XY", offset: -width / 2 - .1 }, profile: rectangle(-length / 2 + thickness, thickness, length / 2 - thickness, height - thickness), distanceMm: width - thickness + .1, operation: "remove" },
      ],
    }, {
      id: "door", name: "可拆检修门", appearance: metal, engineering, steps: [
        { id: "panel", name: "门板轮廓", kind: "extrude", plane: { type: "XY", offset: -width / 2 }, profile: roundedOctagon(0, height / 2, length * .88, height * .86, .08), distanceMm: thickness, operation: "new" },
        ...(requests.observationWindow ? [{ id: "window", name: "观察窗开口", kind: "extrude" as const, plane: { type: "XY" as const, offset: -width / 2 - .1 }, profile: roundedOctagon(-length * .1, height * .62, length * .42, height * .25, .12), distanceMm: thickness * 1.2, operation: "remove" as const }] : []),
        ...(requests.louverCount ? Array.from({ length: requests.louverCount }, (_, index) => {
          const span = Math.max(1, requests.louverCount! - 1);
          const centerY = height * (.24 + .24 * index / span);
          return { id: `louver-${index + 1}`, name: `通风百叶孔 ${index + 1}`, kind: "extrude" as const, plane: { type: "XY" as const, offset: -width / 2 - .1 }, profile: roundedOctagon(length * .2, centerY, length * .32, Math.max(5, height * .018), .38), distanceMm: thickness * 1.2, operation: "remove" as const };
        }) : []),
      ],
    }];
  } else if (intent === "generic") {
    primaryPartId = "main";
    if (/管|软管|线缆|弯曲路径/.test(prompt)) {
      const radius = Math.max(2, Math.min(width, height) * .16);
      parts = [{ id: "main", name: "路径驱动扫掠件", appearance: accent, engineering, steps: [{ id: "path-sweep", name: "沿用户意图路径扫掠", kind: "sweep", profilePlane: { type: "YZ", offset: -length / 2 }, profile: circle(height * .25, 0, radius), pathPlane: { type: "XY", offset: 0 }, path: [{ x: -length / 2, y: height * .25 }, { x: -length * .12, y: height * .72 }, { x: length * .22, y: height * .58 }, { x: length / 2, y: height * .82 }] }] }];
    } else if (/流线|外壳|罩|过渡|曲面|收口|渐变/.test(prompt)) {
      const frontNarrow = /前窄后宽|前小后大|前端?收窄|前端?尖/.test(prompt);
      const rearNarrow = /前宽后窄|前大后小|后端?收窄|尾部收窄/.test(prompt);
      const bulged = /中间(?:鼓|饱满|加宽)|鼓包|梭形/.test(prompt);
      const flat = /扁平|低矮|薄型/.test(prompt);
      const rounded = /圆润|圆滑|柔和|平滑/.test(prompt);
      const sectionScales = frontNarrow ? [.46, .62, .84, 1] : rearNarrow ? [1, .84, .62, .46] : bulged ? [.58, 1, .92, .54] : [.62, 1, .9, .58];
      const heightScale = flat ? .66 : 1;
      const cornerRatio = rounded ? .34 : .18;
      parts = [{ id: "main", name: "多截面流线实体", appearance: metal, engineering, steps: [{ id: "shape-loft", name: "按外形意图生成多截面放样", kind: "loft", sections: [
        { plane: { type: "YZ", offset: -length / 2 }, profile: roundedOctagon(height * .5, 0, height * sectionScales[0] * heightScale, width * sectionScales[0], cornerRatio) },
        { plane: { type: "YZ", offset: -length * .16 }, profile: roundedOctagon(height * .5, 0, height * sectionScales[1] * heightScale, width * sectionScales[1], cornerRatio) },
        { plane: { type: "YZ", offset: length * .18 }, profile: roundedOctagon(height * .52, 0, height * sectionScales[2] * heightScale, width * sectionScales[2], cornerRatio) },
        { plane: { type: "YZ", offset: length / 2 }, profile: roundedOctagon(height * .48, 0, height * sectionScales[3] * heightScale, width * sectionScales[3], cornerRatio) },
      ] }] }];
    } else {
      parts = [{ id: "main", name: "用户轮廓参数化实体", appearance: metal, engineering, steps: [{ id: "profile", name: "非矩形设计轮廓", kind: "extrude", plane: { type: "XY", offset: -width / 2 }, profile: polygon([[-length / 2, 0], [length * .38, 0], [length / 2, height * .22], [length * .34, height], [-length * .32, height * .9], [-length / 2, height * .25]]), distanceMm: width, operation: "new" }] }];
    }
  } else if (intent === "robot") {
    const base = Math.min(length, width) * .28;
    primaryPartId = "upper-arm";
    replaces = ["upper-arm", "upper-arm-cast-shell", "forearm", "forearm-cast-shell"];
    parts = [{ id: "upper-arm", name: "J2–J3 多截面流线型上臂", appearance: accent, engineering, steps: [{ id: "loft", name: "上臂铸件多截面放样", kind: "loft", sections: [
      { plane: { type: "YZ", offset: length * .015 }, profile: roundedOctagon(height * .31, 0, base * .52, base * .46) },
      { plane: { type: "YZ", offset: length * .1 }, profile: roundedOctagon(height * .45, 0, base * .42, base * .34) },
      { plane: { type: "YZ", offset: length * .205 }, profile: roundedOctagon(height * .645, 0, base * .38, base * .4) },
    ] }] }, { id: "forearm", name: "J3–J5 多截面流线型前臂", appearance: metal, engineering, steps: [{ id: "loft", name: "前臂铸件多截面放样", kind: "loft", sections: [
      { plane: { type: "YZ", offset: length * .215 }, profile: roundedOctagon(height * .66, 0, base * .36, base * .38) },
      { plane: { type: "YZ", offset: length * .34 }, profile: roundedOctagon(height * .79, 0, base * .28, base * .3) },
      { plane: { type: "YZ", offset: length * .445 }, profile: roundedOctagon(height - base * .17, 0, base * .24, base * .26) },
    ] }] }];
  }

  if (!parts.length) return {};
  return { program: { id, name: title, resourceCode: "AGENT-CAD", resourceTitle: title, strategy: "feature-driven", primaryPartId, parts }, replaces };
};

export const createLocalCadAgentPlan = (promptInput: string, options: { planId?: string } = {}): LocalCadAgentPlan => {
  const originalPrompt = promptInput.trim();
  if (!originalPrompt) throw new Error("请先描述需要建立的设备或零件。即使不知道专业名称，也可以说明它要做什么、放在哪里以及大概多大。");
  const prompt = normalizePromptText(originalPrompt);
  const detection = detectIntent(prompt), intent = detection.intent;
  const dimensions = resolveDimensions(prompt, intent), { length, width, height } = dimensions;
  const id = (options.planId ?? `agent-${Date.now()}`).replace(/[^a-zA-Z0-9_-]+/g, "-");
  const featureRequests = parseFeatureRequests(prompt);
  const conveyorTypeWasExplicit = /皮带|传送带|输送带|滚筒/.test(prompt);
  const robotToolWasExplicit = /焊接|焊枪|吸盘|真空|吸取|吸起|吸附|抓取|夹取|拿取|上下料|码垛|夹爪/.test(prompt);
  const cncTypeWasExplicit = /车床|车削|加工中心|铣床|铣削|钻攻|夹住.*圆棒.*加工|加工.*圆棒|工件旋转.*加工/.test(prompt);
  if (intent === "conveyor") featureRequests.conveyorType ??= "roller";
  if (intent === "robot") featureRequests.robotEndEffector ??= "gripper";
  if (intent === "cnc") featureRequests.cncType ??= "mill";
  const material = resolveMaterial(prompt, intent);
  const resolvedTitle = intent === "cnc" && featureRequests.cncType === "lathe" ? "数控车床参数化模型"
    : intent === "conveyor" && featureRequests.conveyorType === "belt" ? "模块化皮带输送设备参数化模型"
      : intent === "robot" && featureRequests.robotEndEffector === "welder" ? "六轴焊接机器人工作单元"
        : intent === "robot" && featureRequests.robotEndEffector === "suction" ? "六轴真空搬运机器人工作单元"
          : intent === "generic" && /外壳|壳体|防护罩/.test(prompt) ? "自由曲面壳体参数化模型" : titles[intent];
  const generated = equipmentParts(intent, prompt, length, width, height, featureRequests);
  const hasEngineeringDetail = intent === "cnc" || intent === "robot" || intent === "conveyor";
  const template: ModelingResourceTemplate = {
    resourceId: id, resourceCode: "AGENT-CAD", resourceTitle: resolvedTitle, projectName: resolvedTitle,
    materialSpec: material.material,
    density: material.density,
    tolerance: intent === "cnc" || intent === "shaft" || intent === "flange" ? .03 : .1,
    process: intent === "enclosure" ? "钣金折弯 / 焊接装配" : intent === "robot" || intent === "conveyor" || intent === "cnc" ? "机加工 / 焊接装配" : "机加工",
    parts: generated.parts,
  };
  const featureProgramResult = featureDrivenProgram(id, resolvedTitle, intent, prompt, { length, width, height }, featureRequests, material);
  const featureStepCount = featureProgramResult.program?.parts.reduce((count, entry) => count + entry.steps.length, 0) ?? 0;
  const recognized = [
    ...detection.evidence,
    ...dimensions.explicit.flatMap((value, index) => value === undefined ? [] : [`${["长度", "宽度", "高度"][index]} ${value.toFixed(0)} mm`]),
    ...(!material.inferred ? [`材料：${material.material}`] : []),
    ...(featureRequests.holeCount ? [`${featureRequests.holeCount} 个孔位${featureRequests.holeDiameterMm ? `，孔径 ${featureRequests.holeDiameterMm} mm` : ""}`] : []),
    ...(featureRequests.observationWindow ? ["门板观察窗"] : []),
    ...(featureRequests.louverCount ? [`${featureRequests.louverCount} 条百叶孔`] : []),
    ...(featureRequests.filletRadiusMm ? [`圆角 R${featureRequests.filletRadiusMm} mm`] : []),
    ...(featureRequests.chamferDistanceMm ? [`倒角 ${featureRequests.chamferDistanceMm} mm`] : []),
    ...contextEvidence(prompt, featureRequests),
  ];
  const inferred = [
    ...(dimensions.inferredAxes.length ? [`未给出的${dimensions.inferredAxes.join("、")}已根据${resolvedTitle}常用比例补全。`] : []),
    ...(material.inferred ? [`未指定材料，暂按${material.material}建立工程属性。`] : []),
    ...(intent === "conveyor" && !conveyorTypeWasExplicit ? ["未说明输送形式，默认采用通用滚筒输送结构。"] : []),
    ...(intent === "robot" && !robotToolWasExplicit ? ["未说明末端任务，默认配置通用两指夹具。"] : []),
    ...(intent === "cnc" && !cncTypeWasExplicit ? ["未说明加工方式，默认采用立式铣削加工中心结构。"] : []),
    ...(/几个|若干|一些/.test(prompt) && /孔/.test(prompt) ? ["“几个孔”按常用四孔安装方式处理。"] : []),
  ];
  const warnings = [
    ...dimensions.conflicts,
    ...(detection.alternative ? [`描述也可能指“${titles[detection.alternative]}”，当前按“${resolvedTitle}”生成。`] : []),
    ...(intent === "generic" && !detection.evidence.length ? ["没有识别出明确设备类别，当前按自由轮廓零件生成；补充用途或类似设备名称可得到更准确结构。"] : []),
    ...((featureRequests.loadKg !== undefined || featureRequests.speedMMin !== undefined) ? ["载荷和速度已记录为设计依据；当前不会自动替代正式的强度、功率与安全校核。"] : []),
  ];
  const explicitDimensionCount = dimensions.explicit.filter((value) => value !== undefined).length;
  const confidence: LocalCadAgentUnderstanding["confidence"] = intent === "generic" && !detection.evidence.length ? "low" : detection.confidence === "high" && explicitDimensionCount >= 2 ? "high" : "medium";
  const understanding: LocalCadAgentUnderstanding = {
    normalizedRequest: prompt,
    confidence,
    interpretedAs: `${resolvedTitle}，整体约 ${length.toFixed(0)} × ${width.toFixed(0)} × ${height.toFixed(0)} mm，${material.material}。`,
    recognized: [...new Set(recognized)], inferred: [...new Set(inferred)], warnings: [...new Set(warnings)],
  };
  const assumptions = [
    dimensions.inferredAxes.length ? `已采用用户给出的尺寸，并按设备常用比例补全${dimensions.inferredAxes.join("、")}。` : "已按文字中的米制尺寸建立外形包络。",
    featureProgramResult.program
      ? "零件按设计意图由草图和有顺序的特征生成；添加、切除与曲面过渡发生在同一零件历史中，不把基础几何体堆成成品。"
      : "设备按具有工程含义的组件组织，便于继续定位、精修与装配。",
    generated.cuts.length ? "孔结构使用精确圆柱工具体执行 B-Rep 切除。" : hasEngineeringDetail ? "螺纹、齿轮、轴承和线缆使用可编辑机械参数生成，并可随特征历史稳定重建与导出。" : "首版优先建立可编辑主体结构，细节可继续使用精修工具补充。",
    ...(intent === "conveyor" ? [`输送线采用${featureRequests.conveyorType === "belt" ? "皮带" : "滚筒"}结构，包含轴承、齿轮、电机、传动防护、线缆与调平紧固件。`] : []),
    ...(intent === "robot" ? [`机器人包含关节轴承、减速齿轮、伺服驱动、中空腕部、线缆、${featureRequests.robotEndEffector === "welder" ? "焊枪" : featureRequests.robotEndEffector === "suction" ? "真空吸盘" : "两指夹具"}和控制柜。`, "机械臂外观采用独立精细表面层，包含流线铸造外壳、关节端盖、装配缝、检修盖和法兰紧固件。"] : []),
    ...(intent === "cnc" ? [featureRequests.cncType === "lathe" ? "数控车床包含主轴箱、卡盘、刀塔、尾座、导轨、滚珠丝杠、轴承和伺服传动。" : "数控机床包含导轨、滚珠丝杠、主轴轴承、伺服齿轮、刀柄刀库、线缆和工作台紧固件。"] : []),
    ...(featureRequests.filletRadiusMm ? [`按需求在主体稳定边上建立 R${featureRequests.filletRadiusMm} mm 圆角。`] : []),
    ...(featureRequests.chamferDistanceMm ? [`按需求在主体稳定边上建立 ${featureRequests.chamferDistanceMm} mm 倒角。`] : []),
  ];
  const detailOperations = [
    ...(featureRequests.holeCount ? [`生成 ${featureRequests.holeCount} 个${featureRequests.holeDiameterMm ? ` Ø${featureRequests.holeDiameterMm} mm` : ""}孔位`] : []),
    ...(featureRequests.observationWindow ? ["切除门板观察窗"] : []),
    ...(featureRequests.louverCount ? [`切除 ${featureRequests.louverCount} 条百叶孔`] : []),
    ...(featureRequests.filletRadiusMm ? [`建立 R${featureRequests.filletRadiusMm} mm 真实圆角特征`] : []),
    ...(featureRequests.chamferDistanceMm ? [`建立 ${featureRequests.chamferDistanceMm} mm 真实倒角特征`] : []),
    ...(intent === "conveyor" ? ["建立滚筒—轴承—齿轮—电机传动链"] : []),
    ...(intent === "robot" ? ["建立六轴关节轴承、减速齿轮、伺服与末端夹具", "生成 J1–J6 流线外壳、端盖、密封圈、检修盖板与表面紧固件"] : []),
    ...(intent === "cnc" ? [featureRequests.cncType === "lathe" ? "建立主轴—卡盘—刀塔—尾座—丝杠传动机构" : "建立导轨—滚珠丝杠—主轴轴承—伺服齿轮—刀库内部机构"] : []),
    ...(hasEngineeringDetail ? ["生成紧固件螺纹牙、动力/编码器线缆与维护细节"] : []),
  ];
  return {
    id, prompt: originalPrompt, intent, title: resolvedTitle, dimensionsMm: { length, width, height },
    summary: featureProgramResult.program
      ? `根据需求生成 ${featureProgramResult.program.parts.length} 个设计零件和 ${featureStepCount} 项有序建模特征，整体包络约 ${length.toFixed(0)} × ${width.toFixed(0)} × ${height.toFixed(0)} mm。`
      : `根据需求生成 ${generated.parts.length} 个工程组件，整体包络约 ${length.toFixed(0)} × ${width.toFixed(0)} × ${height.toFixed(0)} mm。`,
    operations: featureProgramResult.program
      ? ["把用途、外形和接口要求转换为零件级特征程序", "建立非矩形轮廓、连续旋转轮廓、多截面放样或路径扫掠", "在同一零件内依次执行添加与切除", ...detailOperations, "写入 Feature History，用户可继续修改草图、参数与特征顺序"]
      : ["生成受约束草图与真实 B-Rep 基础特征", "按设备结构完成工程组件定位", ...(generated.cuts.length ? ["使用多实体布尔生成精确切除"] : []), ...detailOperations, "写入 Feature History，保留后续精修入口"],
    assumptions, understanding, template, booleanCuts: generated.cuts, featureRequests, finishTargetPartId: generated.primaryPartId,
    featureProgram: featureProgramResult.program, featureProgramReplaces: featureProgramResult.replaces,
  };
};

const buildPlanDocument = (plan: LocalCadAgentPlan) => {
  if (plan.featureProgram && !plan.featureProgramReplaces?.length) return compileAgentCadFeatureProgram(plan.featureProgram);
  const built = buildCadDocumentFromResourceTemplate(plan.template, { documentId: `local-${plan.id}`, documentName: plan.title, instanceKey: plan.id });
  const document = structuredClone(built.document) as CadDocument<Sketch, Feature>;
  let replacementActiveBodyId: string | undefined;
  for (const [index, cut] of (plan.booleanCuts ?? []).entries()) {
    const targetBodyId = built.sourcePartToBody[cut.targetPartId];
    const toolBodyIds = cut.toolPartIds.map((partId) => built.sourcePartToBody[partId]).filter(Boolean);
    const targetFeatureId = targetBodyId && deriveBodyTipFeatureId(document, targetBodyId);
    const tools = toolBodyIds.map((bodyId) => ({ bodyId, featureId: deriveBodyTipFeatureId(document, bodyId)! })).filter((entry) => entry.featureId);
    if (!targetBodyId || !targetFeatureId || !tools.length) continue;
    const featureId = `${plan.id}-boolean-cut-${index + 1}`;
    document.features[featureId] = { id: featureId, name: "Agent 精确孔组", type: "bodyBoolean", bodyId: targetBodyId, operation: "cut", target: { bodyId: targetBodyId, featureId: targetFeatureId }, tools, keepToolBody: false, enabled: true, state: "clean", dependencies: [targetFeatureId, ...tools.map((entry) => entry.featureId)] };
    document.featureOrder.push(featureId);
    toolBodyIds.forEach((bodyId) => { document.bodies[bodyId].visible = false; });
  }
  if (plan.featureProgram && plan.featureProgramReplaces?.length) {
    const replacementIds = new Set(plan.featureProgramReplaces);
    const removedBodyIds = new Set(Object.values(document.bodies).filter((body) => body.sourceResource?.sourcePartId && replacementIds.has(body.sourceResource.sourcePartId)).map((body) => body.id));
    const removedFeatureIds = new Set(Object.values(document.features).filter((feature) => removedBodyIds.has(feature.bodyId)).map((feature) => feature.id));
    const removedSketchIds = new Set<string>();
    for (const featureId of removedFeatureIds) {
      const feature = document.features[featureId];
      if (!feature) continue;
      if ("sketchId" in feature && typeof feature.sketchId === "string") removedSketchIds.add(feature.sketchId);
      if ("profileSketchId" in feature && typeof feature.profileSketchId === "string") removedSketchIds.add(feature.profileSketchId);
      if ("pathSketchId" in feature && typeof feature.pathSketchId === "string") removedSketchIds.add(feature.pathSketchId);
      if ("sectionSketchIds" in feature && Array.isArray(feature.sectionSketchIds)) feature.sectionSketchIds.forEach((id) => removedSketchIds.add(id));
    }
    removedBodyIds.forEach((bodyId) => { delete document.bodies[bodyId]; });
    removedFeatureIds.forEach((featureId) => { delete document.features[featureId]; });
    removedSketchIds.forEach((sketchId) => { delete document.sketches[sketchId]; });
    document.featureOrder = document.featureOrder.filter((featureId) => !removedFeatureIds.has(featureId));
    const replacement = compileAgentCadFeatureProgram(plan.featureProgram);
    replacementActiveBodyId = replacement.activeBodyId;
    Object.assign(document.sketches, replacement.sketches);
    Object.assign(document.features, replacement.features);
    Object.assign(document.bodies, replacement.bodies);
    document.featureOrder.push(...replacement.featureOrder);
  }
  const primaryBodyId = plan.finishTargetPartId ? built.sourcePartToBody[plan.finishTargetPartId] : undefined;
  if (primaryBodyId && document.bodies[primaryBodyId]) document.activeBodyId = primaryBodyId;
  else if (replacementActiveBodyId) document.activeBodyId = replacementActiveBodyId;
  return withDerivedBodyTips(document);
};

export const applyLocalCadAgentPlan = (plan: LocalCadAgentPlan, current: CadDocument<Sketch, Feature>, mode: LocalCadAgentApplyMode): CadDocument<Sketch, Feature> => {
  const generated = buildPlanDocument(plan);
  if (mode === "replace") return withDerivedBodyTips({ ...generated, id: current.id, name: plan.title, updatedAt: Date.now() });
  return withDerivedBodyTips({
    ...current, name: current.name, sketches: { ...current.sketches, ...generated.sketches }, features: { ...current.features, ...generated.features },
    featureOrder: [...current.featureOrder, ...generated.featureOrder], bodies: { ...current.bodies, ...generated.bodies }, activeBodyId: generated.activeBodyId ?? current.activeBodyId, updatedAt: Date.now(),
  });
};
