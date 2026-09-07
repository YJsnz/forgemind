import { createLocalCadAgentPlan, applyLocalCadAgentPlan } from "../agent/LocalCadModelingAgent.ts";
import { compileAgentCadFeatureProgram, type AgentCadFeatureProgram, type AgentFeaturePartProgram, type AgentProfile } from "../agent/CadFeatureProgram.ts";
import type { CadDocument } from "../cad/CadDocument.ts";
import type { Feature } from "../features/Feature.ts";
import type { Sketch } from "../sketch/Sketch.ts";
import { createUnifiedCadDocument } from "../authoring/UnifiedCadWorkspace.ts";

type ResourceSpecification = {
  code: string;
  title: string;
  projectName: string;
  prompt?: string;
  program?: () => AgentCadFeatureProgram;
};

const roundedRectangle = (x: number, y: number, widthMm: number, heightMm: number, radiusMm: number): AgentProfile => ({
  kind: "roundedRectangle",
  center: { x, y },
  widthMm,
  heightMm,
  radiusMm,
});
const circle = (x: number, y: number, radiusMm: number): AgentProfile => ({ kind: "circle", center: { x, y }, radiusMm });
const polygon = (points: Array<[number, number]>): AgentProfile => ({ kind: "polygon", points: points.map(([x, y]) => ({ x, y })) });

const appearance = {
  dark: { color: "#263735", metalness: .68, roughness: .25 },
  frame: { color: "#586b66", metalness: .62, roughness: .28 },
  metal: { color: "#aeb8b2", metalness: .82, roughness: .17 },
  accent: { color: "#d7ac37", metalness: .64, roughness: .2 },
  glass: { color: "#72aaa7", metalness: .12, roughness: .16, opacity: .52 },
  black: { color: "#182523", metalness: .52, roughness: .26 },
};

const engineering = (group: string, material = "碳钢 / Q235", densityKgM3 = 7850, toleranceMm = .05) => ({
  material,
  densityKgM3,
  toleranceMm,
  process: "精密机加工 / 表面处理 / 装配",
  group,
});

const housingProgram = (): AgentCadFeatureProgram => {
  const group = "资源库 / PART-HOUSING-01";
  const bodySteps: AgentFeaturePartProgram["steps"] = [
    { id: "outer", name: "壳体圆角整体毛坯", kind: "extrude", plane: { type: "XZ", offset: 0 }, profile: roundedRectangle(0, 0, 180, 120, 12), distanceMm: 68, operation: "new" },
    { id: "cavity", name: "内部功能腔精加工", kind: "extrude", plane: { type: "XZ", offset: 7 }, profile: roundedRectangle(0, 0, 154, 94, 7), distanceMm: 62, operation: "remove" },
    { id: "connector-window", name: "侧面连接器窗口", kind: "extrude", plane: { type: "XY", offset: -61 }, profile: roundedRectangle(36, 37, 42, 24, 4), distanceMm: 14, operation: "remove" },
  ];
  [[-72, -42], [72, -42], [-72, 42], [72, 42]].forEach(([x, z], index) => bodySteps.push({
    id: `mount-hole-${index + 1}`,
    name: `底部沉头安装孔 ${index + 1}`,
    kind: "extrude",
    plane: { type: "XZ", offset: -.1 },
    profile: circle(x, z, 3.3),
    distanceMm: 9,
    operation: "remove",
  }));
  return {
    id: "resource-housing-precision-v2", name: "机加工壳体 · 精细可编辑模型", resourceCode: "PART-HOUSING-01", resourceTitle: "机加工壳体", strategy: "feature-driven", primaryPartId: "housing-body",
    parts: [
      { id: "housing-body", name: "一体式机加工壳体", appearance: appearance.frame, engineering: engineering(group, "铝合金 / 6061-T6", 2700, .03), steps: bodySteps },
      { id: "lid", name: "密封检修盖", appearance: appearance.metal, engineering: engineering(group, "铝合金 / 6061-T6", 2700, .03), steps: [{ id: "lid-profile", name: "检修盖圆角轮廓", kind: "extrude", plane: { type: "XZ", offset: 68 }, profile: roundedRectangle(0, 0, 174, 114, 10), distanceMm: 4, operation: "new" }] },
      ...[[0, -43], [0, 43]].map(([x, z], index): AgentFeaturePartProgram => ({ id: `locating-boss-${index + 1}`, name: `精定位凸台 ${index + 1}`, appearance: appearance.metal, engineering: engineering(group, "轴承钢 / GCr15", 7810, .01), steps: [{ id: "boss", name: "定位凸台精车", kind: "extrude", plane: { type: "XZ", offset: 0 }, profile: circle(x, z, 8), distanceMm: 12, operation: "new" }] })),
    ],
  };
};

const motorProgram = (): AgentCadFeatureProgram => {
  const group = "资源库 / PROD-MOTOR-08";
  const casingProfile: AgentProfile = polygon([
    [0, 0], [86, 0], [86, 10], [78, 16], [72, 24], [72, 126], [66, 137], [56, 145], [0, 145],
  ]);
  const shaftProfile: AgentProfile = polygon([[0, -34], [11, -34], [11, -4], [18, -4], [18, 12], [0, 12]]);
  return {
    id: "resource-motor-precision-v2", name: "伺服电机总成 · 精细可编辑模型", resourceCode: "PROD-MOTOR-08", resourceTitle: "伺服电机总成", strategy: "feature-driven", primaryPartId: "motor-casing",
    parts: [
      { id: "motor-casing", name: "一体式阶梯电机壳体", appearance: appearance.frame, engineering: engineering(group, "压铸铝合金 / ADC12", 2680, .04), steps: [
        { id: "casing-revolve", name: "壳体连续母线旋转", kind: "revolve", plane: { type: "XY", offset: 0 }, profile: casingProfile, axis: { origin: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 1, z: 0 } } },
        ...[[58, 0], [-58, 0], [0, 58], [0, -58]].map(([x, z], index) => ({ id: `flange-hole-${index + 1}`, name: `法兰安装孔 ${index + 1}`, kind: "extrude" as const, plane: { type: "XZ" as const, offset: -.1 }, profile: circle(x, z, 4.5), distanceMm: 13, operation: "remove" as const })),
      ] },
      { id: "output-shaft", name: "精磨输出轴", appearance: appearance.metal, engineering: engineering(group, "合金结构钢 / 40Cr", 7850, .01), steps: [{ id: "shaft-revolve", name: "输出轴阶梯旋转", kind: "revolve", plane: { type: "XY", offset: 0 }, profile: shaftProfile, axis: { origin: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 1, z: 0 } } }] },
      { id: "terminal-box", name: "密封动力接线盒", appearance: appearance.dark, engineering: engineering(group, "阻燃工程塑料 / PA66", 1140, .08), steps: [{ id: "terminal-loft", name: "接线盒三截面圆角放样", kind: "loft", sections: [
        { plane: { type: "XY", offset: -80 }, profile: roundedRectangle(75, 92, 56, 62, 8) },
        { plane: { type: "XY", offset: -58 }, profile: roundedRectangle(77, 92, 62, 66, 9) },
        { plane: { type: "XY", offset: -34 }, profile: roundedRectangle(74, 92, 55, 60, 8) },
      ] }] },
      { id: "encoder-cover", name: "后端编码器罩", appearance: appearance.black, engineering: engineering(group), steps: [{ id: "cover-loft", name: "编码器罩渐缩曲面", kind: "loft", sections: [
        { plane: { type: "XZ", offset: 145 }, profile: circle(0, 0, 58) },
        { plane: { type: "XZ", offset: 158 }, profile: circle(0, 0, 55) },
        { plane: { type: "XZ", offset: 166 }, profile: circle(0, 0, 47) },
      ] }] },
      ...[32, 57, 82, 107, 132].map((y, index): AgentFeaturePartProgram => ({ id: `cooling-fin-${index + 1}`, name: `壳体散热加强环 ${index + 1}`, appearance: appearance.dark, engineering: engineering(group, "压铸铝合金 / ADC12", 2680, .06), steps: [{ id: "fin", name: "散热环精加工", kind: "extrude", plane: { type: "XZ", offset: y }, profile: circle(0, 0, 75), distanceMm: 3.5, operation: "new" }] })),
    ],
  };
};

const bufferProgram = (): AgentCadFeatureProgram => {
  const group = "资源库 / LOG-BUFFER-03";
  const parts: AgentFeaturePartProgram[] = [];
  const postPositions: Array<[number, number]> = [[-820, -820], [820, -820], [-820, 820], [820, 820]];
  postPositions.forEach(([x, z], index) => parts.push({ id: `post-${index + 1}`, name: `高强度圆角立柱 ${index + 1}`, appearance: appearance.frame, engineering: engineering(group), steps: [{ id: "post-loft", name: "立柱拔模放样", kind: "loft", sections: [
    { plane: { type: "XZ", offset: 80 }, profile: roundedRectangle(x, z, 150, 150, 20) },
    { plane: { type: "XZ", offset: 690 }, profile: roundedRectangle(x, z, 124, 124, 17) },
    { plane: { type: "XZ", offset: 1360 }, profile: roundedRectangle(x, z, 142, 142, 20) },
  ] }] }));
  [360, 790, 1220].forEach((y, level) => {
    const steps: AgentFeaturePartProgram["steps"] = [
      { id: "outer", name: `第 ${level + 1} 层承载框整体轮廓`, kind: "extrude", plane: { type: "XZ", offset: y }, profile: roundedRectangle(0, 0, 1740, 1740, 45), distanceMm: 58, operation: "new" },
      { id: "opening", name: `第 ${level + 1} 层中部减重通道`, kind: "extrude", plane: { type: "XZ", offset: y - .1 }, profile: roundedRectangle(0, 0, 1410, 1280, 32), distanceMm: 59, operation: "remove" },
    ];
    parts.push({ id: `shelf-frame-${level + 1}`, name: `第 ${level + 1} 层一体式托盘框`, appearance: appearance.dark, engineering: engineering(group), steps });
    for (let roller = 0; roller < 5; roller += 1) {
      const x = -560 + roller * 280;
      parts.push({ id: `level-${level + 1}-roller-${roller + 1}`, name: `第 ${level + 1} 层输送滚筒 ${roller + 1}`, appearance: appearance.metal, engineering: engineering(group, "镀锌钢 / 45#", 7850, .04), steps: [{ id: "roller", name: "精车滚筒", kind: "extrude", plane: { type: "XY", offset: -640 }, profile: circle(x, y + 54, 34), distanceMm: 1280, operation: "new" }] });
    }
  });
  parts.push(
    { id: "base", name: "缓存架减振底座", appearance: appearance.dark, engineering: engineering(group), steps: [{ id: "base-loft", name: "底座四截面圆角放样", kind: "loft", sections: [
      { plane: { type: "XZ", offset: 0 }, profile: roundedRectangle(0, 0, 1960, 1960, 75) },
      { plane: { type: "XZ", offset: 45 }, profile: roundedRectangle(0, 0, 2000, 2000, 82) },
      { plane: { type: "XZ", offset: 120 }, profile: roundedRectangle(0, 0, 1900, 1900, 68) },
      { plane: { type: "XZ", offset: 160 }, profile: roundedRectangle(0, 0, 1840, 1840, 62) },
    ] }] },
    { id: "lift-drive", name: "缓存升降伺服电机", appearance: appearance.accent, engineering: engineering(group, "压铸铝合金 / ADC12", 2680, .05), steps: [{ id: "motor", name: "驱动电机阶梯壳体", kind: "revolve", plane: { type: "XY", offset: -900 }, profile: polygon([[0, 160], [90, 160], [110, 180], [110, 360], [92, 385], [0, 385]]), axis: { origin: { x: -930, y: 0, z: -900 }, direction: { x: 0, y: 1, z: 0 } } }] },
    { id: "safety-sensor", name: "托盘到位激光传感器", appearance: appearance.accent, engineering: engineering(group, "工业传感器总成", 1800, .1), steps: [{ id: "sensor", name: "传感器圆角壳体", kind: "extrude", plane: { type: "XY", offset: -885 }, profile: roundedRectangle(690, 1015, 100, 150, 15), distanceMm: 70, operation: "new" }] },
  );
  return { id: "resource-buffer-precision-v2", name: "托盘缓存架 · 精细可编辑模型", resourceCode: "LOG-BUFFER-03", resourceTitle: "托盘缓存架", strategy: "feature-driven", primaryPartId: "base", parts };
};

const routerProgram = (): AgentCadFeatureProgram => {
  const group = "资源库 / LOG-ROUTER-01";
  const port = (id: string, name: string, offset: number): AgentFeaturePartProgram => ({ id, name, appearance: appearance.dark, engineering: engineering(group), steps: [
    { id: "outer", name: `${name}圆角法兰`, kind: "extrude", plane: { type: "YZ", offset }, profile: roundedRectangle(230, 0, 300, 360, 26), distanceMm: 145, operation: "new" },
    { id: "opening", name: `${name}贯通开口`, kind: "extrude", plane: { type: "YZ", offset: offset - .1 }, profile: roundedRectangle(230, 0, 220, 280, 18), distanceMm: 146, operation: "remove" },
  ] });
  return {
    id: "resource-router-box-precision-v2", name: "对向输送接口盒 · 精细可编辑模型", resourceCode: "LOG-ROUTER-01", resourceTitle: "对向输送接口盒", strategy: "feature-driven", primaryPartId: "router-shell",
    parts: [
      { id: "router-shell", name: "一体式圆角贯通机壳", appearance: appearance.black, engineering: engineering(group), steps: [
        { id: "outer", name: "机壳整体圆角轮廓", kind: "extrude", plane: { type: "XY", offset: -230 }, profile: roundedRectangle(0, 230, 520, 430, 42), distanceMm: 460, operation: "new" },
        { id: "through-channel", name: "输送通道贯穿切除", kind: "extrude", plane: { type: "XY", offset: -231 }, profile: roundedRectangle(0, 225, 420, 250, 24), distanceMm: 462, operation: "remove" },
        { id: "service-pocket", name: "顶部维护腔", kind: "extrude", plane: { type: "XZ", offset: 350 }, profile: roundedRectangle(0, 0, 390, 320, 24), distanceMm: 82, operation: "remove" },
      ] },
      port("input-port", "IN-01 输入接口", -390),
      port("output-port", "OUT-01 输出接口", 245),
      { id: "service-cover", name: "顶部快拆检修盖", appearance: appearance.frame, engineering: engineering(group), steps: [{ id: "cover", name: "检修盖圆角成形", kind: "extrude", plane: { type: "XZ", offset: 432 }, profile: roundedRectangle(0, 0, 430, 360, 30), distanceMm: 12, operation: "new" }] },
      ...[-150, -50, 50, 150].map((x, index): AgentFeaturePartProgram => ({ id: `roller-${index + 1}`, name: `内置动力滚筒 ${index + 1}`, appearance: appearance.metal, engineering: engineering(group, "不锈钢 / 304", 7930, .04), steps: [{ id: "roller", name: "滚筒精车表面", kind: "extrude", plane: { type: "XY", offset: -150 }, profile: circle(x, 205, 28), distanceMm: 300, operation: "new" }] })),
      { id: "drive-motor", name: "输送驱动减速电机", appearance: appearance.accent, engineering: engineering(group), steps: [{ id: "motor-loft", name: "减速机壳体圆角放样", kind: "loft", sections: [
        { plane: { type: "XY", offset: 230 }, profile: roundedRectangle(165, 115, 130, 155, 22) },
        { plane: { type: "XY", offset: 285 }, profile: roundedRectangle(165, 115, 145, 170, 25) },
        { plane: { type: "XY", offset: 345 }, profile: roundedRectangle(165, 115, 118, 145, 20) },
      ] }] },
      { id: "photoelectric-sensor", name: "通道到位光电传感器", appearance: appearance.accent, engineering: engineering(group, "工业传感器总成", 1800, .1), steps: [{ id: "sensor", name: "传感器圆角外壳", kind: "extrude", plane: { type: "XY", offset: -215 }, profile: roundedRectangle(-175, 310, 72, 92, 13), distanceMm: 42, operation: "new" }] },
    ],
  };
};

const resources: Record<string, ResourceSpecification> = {
  cnc: { code: "MACH-CNC-04", title: "CNC 加工中心", projectName: "VMC-850 立式加工中心 · 精细可编辑模型", prompt: "设计 4200×2550×3500 mm 的立式数控加工中心，包含圆角铸造床身、立柱、主轴箱、安全门观察窗、操作面板、工作台导轨、滚珠丝杠、主轴轴承、伺服齿轮、刀库、排屑装置、线缆和紧固件" },
  robot: { code: "ASM-ROBOT-06", title: "协作机器人单元", projectName: "六轴机器人装配单元 · 精细可编辑模型", prompt: "建立 5200×4200×2500 mm 六轴精细机械臂工作单元，包含流线型多截面铸造上臂与前臂、关节端盖、轴承、减速齿轮、伺服驱动、密封圈、检修盖、线缆、控制柜、定位工装和两指夹具" },
  press: { code: "FORM-PRESS-02", title: "液压冲压机", projectName: "液压冲压机结构单元 · 精细可编辑模型", prompt: "建立 2000×2000×1800 mm 液压冲压机，包含圆角闭式一体机架、真实工作窗口、承压工作台、四导向滑块、上下模、液压缸、活塞杆、泵站、阀块、压力表、液压软管、安全光幕、操作箱和紧固件" },
  conveyor: { code: "LOG-CONVEYOR-02", title: "模块化滚筒输送设备", projectName: "模块化滚筒输送设备 · 精细可编辑模型", prompt: "建立 5800×1150×1200 mm 模块化滚筒输送线，包含精密机架、承载梁、滚筒、轴承、齿轮、减速电机、传动防护罩、动力线缆、光电传感器和调平紧固件" },
  housing: { code: "PART-HOUSING-01", title: "机加工壳体", projectName: "机加工壳体 · 精细可编辑模型", program: housingProgram },
  motor: { code: "PROD-MOTOR-08", title: "伺服电机总成", projectName: "伺服电机总成 · 精细可编辑模型", program: motorProgram },
  buffer: { code: "LOG-BUFFER-03", title: "托盘缓存架", projectName: "托盘缓存仓 · 精细可编辑模型", program: bufferProgram },
  "router-box": { code: "LOG-ROUTER-01", title: "对向输送接口盒", projectName: "对向输送接口盒 · 精细可编辑模型", program: routerProgram },
};

const precisionDocumentTemplates = new Map<string, CadDocument<Sketch, Feature>>();

const normalizeIdentity = (document: CadDocument<Sketch, Feature>, resourceId: string, specification: ResourceSpecification) => {
  const normalized = structuredClone(document) as CadDocument<Sketch, Feature>;
  normalized.id = `cad-resource-${resourceId}-precision-v2`;
  normalized.name = specification.projectName;
  for (const body of Object.values(normalized.bodies)) {
    if (!body.sourceResource) continue;
    body.sourceResource.resourceId = resourceId;
    body.sourceResource.resourceCode = specification.code;
    body.sourceResource.resourceTitle = specification.title;
  }
  normalized.updatedAt = Date.now();
  return normalized;
};

/** Builds the editable source of truth for every legacy equipment/product
 * resource. Raw stock intentionally remains in ResourceCadBridge because a
 * sheet or billet is already correct as a single prismatic manufacturing blank. */
export const createHighDetailResourceCadDocument = (resourceId: string): CadDocument<Sketch, Feature> | undefined => {
  const cached = precisionDocumentTemplates.get(resourceId);
  if (cached) {
    const copy = structuredClone(cached) as CadDocument<Sketch, Feature>;
    copy.updatedAt = Date.now();
    return copy;
  }
  const specification = resources[resourceId];
  if (!specification) return undefined;
  const built = specification.program
    ? normalizeIdentity(compileAgentCadFeatureProgram(specification.program()), resourceId, specification)
    : normalizeIdentity(
      applyLocalCadAgentPlan(
        createLocalCadAgentPlan(specification.prompt!, { planId: `resource-${resourceId}-precision-v2` }),
        createUnifiedCadDocument(specification.projectName, `cad-resource-${resourceId}-precision-v2`),
        "replace",
      ),
      resourceId,
      specification,
    );
  // Keep an immutable design-data prototype in memory. Every caller receives
  // its own deep copy so edits never leak into another project instance.
  precisionDocumentTemplates.set(resourceId, structuredClone(built) as CadDocument<Sketch, Feature>);
  return built;
};

export const highDetailResourceIds = Object.freeze(Object.keys(resources));

/** Stable catalog used by project selectors without constructing every B-Rep
 * document up front. Geometry is generated only when the user opens an item. */
export const highDetailResourceCatalog = Object.freeze(Object.entries(resources).map(([resourceId, specification]) => ({
  resourceId,
  documentId: `cad-resource-${resourceId}-precision-v2`,
  name: specification.projectName,
})));
