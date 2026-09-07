import { createCadBody, withDerivedBodyTips } from "../cad/CadBodies.ts";
import { createCadAssetStore } from "../cad/CadAssets.ts";
import type { CadDocument } from "../cad/CadDocument.ts";
import { extractCadDocumentPart } from "../cad/CadDocumentSubset.ts";
import type { Feature } from "../features/Feature.ts";
import { createAssemblyDocument } from "../assembly/AssemblyDocument.ts";
import { addMate, insertComponent } from "../assembly/AssemblyOperations.ts";
import { createPartDefinitionFromCadDocument, createPartDefinitionStore } from "../assembly/PartDefinitions.ts";
import type { RigidTransform } from "../assembly/AssemblyTypes.ts";
import { buildCadDocumentFromResourceTemplate } from "../resource/ResourceCadBridge.ts";
import type { ModelingResourceTemplate, ResourceModelPart } from "../resource/ResourceModeling.ts";
import type { Sketch } from "../sketch/Sketch.ts";

export const COMPREHENSIVE_DEMO_RESOURCE_ID = "demo-adaptive-precision-cell-v5";

const finish = {
  frame: { color: "#263b37", metalness: .72, roughness: .25 },
  steel: { color: "#aeb8b3", metalness: .86, roughness: .16 },
  graphite: { color: "#24302d", metalness: .62, roughness: .28 },
  accent: { color: "#c79838", metalness: .76, roughness: .18 },
  motion: { color: "#4fa49d", metalness: .48, roughness: .2 },
  cover: { color: "#86aaa5", metalness: .12, roughness: .3 },
} as const;

const p = (
  id: string,
  type: ResourceModelPart["type"],
  label: string,
  x: number,
  y: number,
  z: number,
  width: number,
  height: number,
  depth: number,
  appearance: keyof typeof finish,
  extra: Partial<ResourceModelPart> = {},
): ResourceModelPart => ({ id, type, label, x, y, z, width, height, depth, ...finish[appearance], ...extra });

const rollerXs = [-.46, -.32, -.18, -.04];
const clampScrewPositions = [
  { id: "clamp-screw-front-left", x: .07, z: .015 },
  { id: "clamp-screw-front-right", x: .21, z: .015 },
  { id: "clamp-screw-rear-left", x: .07, z: .145 },
  { id: "clamp-screw-rear-right", x: .21, z: .145 },
];
const bellowsZs = [.212, .224, .236, .248, .260, .272];
const robotCoverScrews = [
  { id: "robot-cover-screw-a", x: -.365, y: .325, z: .07, rotationZ: Math.PI / 2 },
  { id: "robot-cover-screw-b", x: -.365, y: .325, z: .13, rotationZ: Math.PI / 2 },
  { id: "wrist-cover-screw-a", x: .095, y: .545, z: .07, rotationZ: 0 },
  { id: "wrist-cover-screw-b", x: .095, y: .545, z: .13, rotationZ: 0 },
];

/**
 * One coherent smart manufacturing cell instead of unrelated samples. Its
 * geometry is arranged around a central rotary fixture so every demonstration
 * starts from the same readable machine layout. Separate modules retain
 * editable design intent for solid, surface, mechanical-detail and assembly
 * workflows without replacing the preserved high-detail reference assets.
 */
export const comprehensiveDemoTemplate: ModelingResourceTemplate = {
  resourceId: COMPREHENSIVE_DEMO_RESOURCE_ID,
  resourceCode: "DEMO-CAD-05",
  resourceTitle: "自适应精密装配与检测中心",
  projectName: "ForgeMind 自适应精密装配与检测中心 · 全功能演示",
  materialSpec: "6061-T6 / 40Cr / Q235 / PC",
  density: 4850,
  tolerance: .02,
  process: "CNC 精加工 / 车削 / 齿轮加工 / 曲面成型 / 机器人装配 / 视觉检测",
  parts: [
    p("base", "box", "一体式基准床身 · 约束草图与拉伸", 0, .03, 0, 1.16, .06, .76, "frame"),
    ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => p(`frame-post-${sx}-${sz}`, "box", "安全框架立柱 · 抽壳与拔模对象", sx * .52, .42, sz * .33, .065, .72, .065, "frame"))),
    ...[-1, 1].map((sx) => p(`frame-side-beam-${sx}`, "box", "顶部侧梁 · 圆角对象", sx * .52, .79, 0, .065, .065, .72, "frame")),
    ...[-1, 1].map((sz) => p(`frame-cross-beam-${sz}`, "box", "顶部横梁 · 倒角对象", 0, .79, sz * .33, 1.04, .065, .065, "frame")),
    p("rear-panel", "box", "后部设备背板 · 剖切检查", 0, .43, .37, 1.04, .66, .016, "cover"),
    ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => p(`foot-${sx}-${sz}`, "cylinder", "可调减振脚", sx * .49, -.018, sz * .3, .075, .05, .075, "graphite"))),

    p("conveyor-bed", "box", "上料输送基座 · 口袋与阵列对象", -.25, .12, -.22, .62, .07, .23, "frame"),
    p("conveyor-left-rail", "box", "输送左导轨 · 线性阵列基准", -.25, .165, -.315, .66, .07, .025, "steel"),
    p("conveyor-right-rail", "box", "输送右导轨 · 镜像基准", -.25, .165, -.125, .66, .07, .025, "steel"),
    ...rollerXs.map((x, index) => p(`conveyor-roller-${index + 1}`, "cylinder", `精密滚筒 ${index + 1} · 阵列实例`, x, .19, -.22, .045, .165, .045, "steel", { rotationX: Math.PI / 2 })),
    p("carrier-pallet", "box", "快换定位托盘 · 装配移动件", -.22, .24, -.22, .21, .025, .17, "accent"),
    p("conveyor-stopper", "box", "气动止挡 · 推拉面对象", .045, .265, -.22, .035, .13, .17, "motion"),
    p("conveyor-drive-shaft", "cylinder", "输送驱动轴 · 回转与同心基准", -.535, .19, -.22, .038, .235, .038, "steel", { rotationX: Math.PI / 2 }),
    p("conveyor-drive-bearing", "cylinder", "输送端轴承 · 内外圈与滚动体", -.535, .19, -.335, .058, .022, .058, "steel", { rotationX: Math.PI / 2, mechanicalDetail: { kind: "bearing", outerDiameterMm: 58, innerDiameterMm: 28, widthMm: 22, ballCount: 11 } }),
    p("conveyor-drive-gear", "cylinder", "输送同步齿轮 · 渐开线齿形", -.535, .19, -.36, .06, .016, .06, "accent", { rotationX: Math.PI / 2, mechanicalDetail: { kind: "spurGear", moduleMm: 1.5, teeth: 30, pressureAngleDeg: 20, thicknessMm: 16, boreDiameterMm: 18 } }),

    p("rotary-motor", "cylinder", "直驱伺服电机 · 解析圆柱", .14, .105, .08, .20, .13, .20, "graphite"),
    p("rotary-bearing", "cylinder", "回转支承 · 轴承滚动体", .14, .185, .08, .12, .024, .12, "steel", { mechanicalDetail: { kind: "bearing", outerDiameterMm: 120, innerDiameterMm: 64, widthMm: 24, ballCount: 18 } }),
    p("rotary-gear", "cylinder", "分度驱动齿轮 · 渐开线齿廓", .14, .15, .08, .112, .018, .112, "accent", { mechanicalDetail: { kind: "spurGear", moduleMm: 2, teeth: 28, pressureAngleDeg: 20, thicknessMm: 18, boreDiameterMm: 28 } }),
    p("rotary-shaft", "cylinder", "回转主轴 · 同心配合轴", .14, .205, .08, .056, .20, .056, "steel"),
    p("rotary-platter", "cylinder", "分度工作台 · 圆周阵列对象", .14, .27, .08, .275, .045, .275, "steel"),
    p("rotary-encoder-ring", "torus", "回转编码器刻度环 · 精密回转轮廓", .14, .302, .08, .185, .012, .185, "accent"),
    p("rotary-encoder-head", "box", "绝对值编码器读头 · 位置反馈", .245, .305, .08, .035, .045, .055, "motion"),
    p("fixture-base", "box", "模块化夹具底板 · 孔阵列与去特征", .14, .315, .08, .24, .032, .22, "graphite"),
    p("fixture-guide-left", "box", "夹具左导向座 · 底板一体结构", .07, .345, .08, .038, .05, .18, "graphite"),
    p("fixture-guide-right", "box", "夹具右导向座 · 底板一体结构", .21, .345, .08, .038, .05, .18, "graphite"),
    p("locator", "cone", "工件中心定位锥 · 旋转轮廓", .14, .395, .08, .07, .13, .07, "accent"),
    p("jaw-left", "box", "左夹爪 · 滑动限位", .07, .365, .08, .05, .075, .16, "steel"),
    p("jaw-right", "box", "右夹爪 · 滑动限位", .21, .365, .08, .05, .075, .16, "steel"),
    ...clampScrewPositions.map(({ id, x, z }) => p(id, "cylinder", "M10 夹具螺钉 · 真实螺旋牙型", x, .345, z, .01, .03, .01, "steel", { mechanicalDetail: { kind: "externalThread", majorDiameterMm: 10, pitchMm: 1.5, lengthMm: 30, threadedLengthMm: 24, threadDepthMm: .9 } })),

    p("robot-pedestal", "cylinder", "六轴机器人底座 · 回转基准", -.32, .13, .10, .18, .15, .18, "graphite"),
    p("robot-waist", "cylinder", "机器人腰座 · 第一转轴", -.32, .24, .10, .13, .11, .13, "accent"),
    p("robot-shoulder", "cylinder", "肩部关节 · 轴承配合", -.32, .325, .10, .095, .13, .095, "steel", { rotationZ: Math.PI / 2 }),
    p("robot-elbow", "torus", "肘部关节环 · 旋转特征", -.125, .525, .10, .105, .042, .105, "graphite", { rotationZ: Math.PI / 2 }),
    p("robot-wrist", "cylinder", "腕部快换法兰 · 同心接口", .095, .575, .10, .08, .09, .08, "accent", { rotationZ: Math.PI / 2 }),
    p("gripper-body", "box", "伺服夹爪本体 · 可替换末端工具", .155, .575, .10, .09, .07, .10, "graphite"),
    p("gripper-mount-flange", "cylinder", "夹爪安装法兰 · 壳体构造", .112, .575, .10, .082, .045, .082, "graphite", { rotationZ: Math.PI / 2 }),
    p("gripper-left-guide", "box", "夹爪左导向台 · 壳体构造", .195, .575, .067, .07, .045, .026, "graphite"),
    p("gripper-right-guide", "box", "夹爪右导向台 · 壳体构造", .195, .575, .133, .07, .045, .026, "graphite"),
    p("gripper-finger-left", "box", "左指爪 · 滑动配合", .215, .59, .065, .075, .025, .022, "steel"),
    p("gripper-finger-right", "box", "右指爪 · 滑动配合", .215, .59, .135, .075, .025, .022, "steel"),
    ...robotCoverScrews.map(({ id, x, y, z, rotationZ }) => p(id, "cylinder", "M6 机器人检修盖螺钉 · 螺旋牙型", x, y, z, .006, .018, .006, "steel", { rotationZ, mechanicalDetail: { kind: "externalThread", majorDiameterMm: 6, pitchMm: 1, lengthMm: 18, threadedLengthMm: 14, threadDepthMm: .52 } })),
    p("robot-cable", "box", "机器人动力线缆 · 光顺扫掠", 0, 0, 0, .45, .008, .32, "graphite", { mechanicalDetail: { kind: "cableSweep", diameterMm: 8, pathPointsMm: [{ x: -350, y: 175, z: 145 }, { x: -330, y: 305, z: 155 }, { x: -250, y: 430, z: 150 }, { x: -125, y: 535, z: 138 }, { x: 15, y: 570, z: 125 }, { x: 165, y: 575, z: 112 }] } }),

    p("inspection-front-post", "box", "检测架前立柱 · 基准配合", .42, .36, -.06, .065, .45, .065, "frame"),
    p("inspection-rear-post", "box", "检测架后立柱 · 基准配合", .42, .36, .24, .065, .45, .065, "frame"),
    p("inspection-crossbeam", "box", "检测横梁 · 精修边界对象", .42, .595, .09, .075, .065, .38, "frame"),
    p("vision-camera", "box", "工业视觉相机 · 测量与材料", .42, .515, .09, .10, .09, .10, "motion"),
    p("camera-lens", "cylinder", "远心镜头 · 精密旋转件", .42, .445, .09, .055, .085, .055, "graphite"),
    p("camera-ring-light", "torus", "视觉同轴环形光源 · 旋转曲面", .42, .405, .09, .088, .016, .088, "motion"),
    p("laser-sensor", "box", "激光位移传感器 · 距离检测", .475, .455, .18, .055, .10, .05, "accent"),
    p("touch-probe", "cylinder", "接触式测头 · 同心与距离配合", .36, .42, .02, .022, .18, .022, "accent"),

    p("tool-rack", "box", "快换工具架 · 壳体与加强筋对象", .39, .27, .30, .24, .36, .075, "frame"),
    p("tool-rack-base", "box", "工具架加宽底脚 · 焊接构造", .39, .085, .30, .30, .035, .16, "frame"),
    p("tool-rack-top", "box", "工具架顶部安装梁 · 焊接构造", .39, .445, .30, .28, .035, .12, "frame"),
    p("tool-spindle-sleeve", "cylinder", "主轴伸缩防护套 · 波纹管基体", .39, .31, .242, .052, .085, .052, "graphite", { rotationX: Math.PI / 2 }),
    ...bellowsZs.map((z, index) => p(`tool-spindle-bellows-${index + 1}`, "torus", `主轴波纹护套 ${index + 1} · 回转阵列细节`, .39, .31, z, .072, .011, .072, "graphite", { rotationX: Math.PI / 2 })),
    p("tool-spindle-bearing", "cylinder", "工具主轴轴承 · 内外圈与滚动体", .34, .31, .255, .065, .022, .065, "steel", { rotationX: Math.PI / 2, mechanicalDetail: { kind: "bearing", outerDiameterMm: 65, innerDiameterMm: 30, widthMm: 22, ballCount: 12 } }),
    p("tool-drive-gear", "cylinder", "换刀驱动齿轮 · 渐开线参数", .39, .31, .255, .064, .018, .064, "accent", { rotationX: Math.PI / 2, mechanicalDetail: { kind: "spurGear", moduleMm: 1.5, teeth: 32, pressureAngleDeg: 20, thicknessMm: 18, boreDiameterMm: 16 } }),
    p("tool-holder", "cone", "锥柄刀具 · 回转与装配接口", .45, .31, .255, .045, .13, .045, "steel", { rotationX: Math.PI / 2 }),
    p("control-panel", "box", "触控操作箱 · 孔与薄壁对象", .50, .38, -.25, .14, .23, .065, "cover", { rotationZ: -.12 }),
    p("safety-door-handle", "cylinder", "安全门人体工学把手 · 扫掠外观", .50, .43, .285, .025, .16, .025, "steel"),
    p("safety-door-handle-upper", "box", "安全门把手上支座", .50, .51, .285, .055, .025, .04, "steel"),
    p("safety-door-handle-lower", "box", "安全门把手下支座", .50, .35, .285, .055, .025, .04, "steel"),
  ],
};

const engineeringBySourcePart = (sourcePartId: string) => {
  if (/robot|gripper/.test(sourcePartId)) return { material: "6061-T6 / 40Cr", densityKgM3: 4200, toleranceMm: .025, process: "CNC 精加工 / 阳极氧化 / 关节装配", group: "柔性单元 / 搬运机器人" };
  if (/rotary|fixture|locator|jaw|clamp-screw/.test(sourcePartId)) return { material: "40Cr / GCr15", densityKgM3: 7810, toleranceMm: .01, process: "车削 / 磨削 / 齿轮加工 / 精密装配", group: "柔性单元 / 回转夹具" };
  if (/conveyor|carrier/.test(sourcePartId)) return { material: "6061-T6 / 聚氨酯", densityKgM3: 2850, toleranceMm: .05, process: "铣削 / 辊筒装配 / 表面处理", group: "柔性单元 / 输送模块" };
  if (/inspection|camera|probe|laser|lofted-camera/.test(sourcePartId)) return { material: "6061-T6 / 光学玻璃", densityKgM3: 3100, toleranceMm: .02, process: "精密加工 / 光学标定 / 电气装配", group: "柔性单元 / 检测模块" };
  if (/tool|control|swept-service/.test(sourcePartId)) return { material: "40Cr / 6061-T6", densityKgM3: 5200, toleranceMm: .02, process: "车削 / 精磨 / 装配 / 电气接线", group: "柔性单元 / 工具与控制" };
  return { material: "Q235 / 6061-T6", densityKgM3: 4850, toleranceMm: .05, process: "焊接 / CNC 精加工 / 喷涂", group: "柔性单元 / 机架与防护" };
};

/**
 * Construction Bodies stay in history so every union remains editable, while
 * only the resulting manufactured part is visible in the viewport. This is
 * closer to a real Part Studio than presenting every primitive as a finished
 * component.
 */
export const comprehensiveDemoLogicalParts = [
  {
    id: "welded-frame",
    name: "一体式焊接机架",
    targetSourcePartId: "base",
    toolSourcePartIds: ["frame-post--1--1", "frame-post--1-1", "frame-post-1--1", "frame-post-1-1", "frame-side-beam--1", "frame-side-beam-1", "frame-cross-beam--1", "frame-cross-beam-1"],
  },
  { id: "conveyor-chassis", name: "输送机一体导轨底架", targetSourcePartId: "conveyor-bed", toolSourcePartIds: ["conveyor-left-rail", "conveyor-right-rail"] },
  { id: "fixture-slide-base", name: "夹具底板与导向座", targetSourcePartId: "fixture-base", toolSourcePartIds: ["fixture-guide-left", "fixture-guide-right"] },
  { id: "gripper-housing", name: "伺服夹爪一体壳体", targetSourcePartId: "gripper-body", toolSourcePartIds: ["gripper-mount-flange", "gripper-left-guide", "gripper-right-guide"] },
  { id: "inspection-gantry", name: "检测门架焊接件", targetSourcePartId: "inspection-front-post", toolSourcePartIds: ["inspection-rear-post", "inspection-crossbeam"] },
  { id: "tool-rack-weldment", name: "快换工具架焊接件", targetSourcePartId: "tool-rack", toolSourcePartIds: ["tool-rack-base", "tool-rack-top"] },
  { id: "tool-spindle-bellows", name: "主轴一体式波纹防护套", targetSourcePartId: "tool-spindle-sleeve", toolSourcePartIds: bellowsZs.map((_, index) => `tool-spindle-bellows-${index + 1}`) },
] as const;

const findSourceBody = (document: CadDocument<Sketch, Feature>, sourcePartId: string) =>
  Object.values(document.bodies).find((body) => body.sourceResource?.sourcePartId === sourcePartId);

const appendLogicalPartUnion = (
  document: CadDocument<Sketch, Feature>,
  definition: typeof comprehensiveDemoLogicalParts[number],
) => {
  const targetBody = findSourceBody(document, definition.targetSourcePartId);
  const toolBodies = definition.toolSourcePartIds.map((sourcePartId) => findSourceBody(document, sourcePartId));
  if (!targetBody?.tipFeatureId || toolBodies.some((body) => !body?.tipFeatureId)) {
    throw new Error(`Logical part ${definition.id} has an incomplete construction-body chain.`);
  }
  const featureId = `smart-cell-${definition.id}-union`;
  const tools = toolBodies.map((body) => ({ bodyId: body!.id, featureId: body!.tipFeatureId! }));
  document.features[featureId] = {
    id: featureId,
    name: `${definition.name} · B-Rep 合并`,
    type: "bodyBoolean",
    bodyId: targetBody.id,
    operation: "union",
    target: { bodyId: targetBody.id, featureId: targetBody.tipFeatureId },
    tools,
    keepToolBody: false,
    enabled: true,
    state: "clean",
    dependencies: [targetBody.tipFeatureId, ...tools.map((tool) => tool.featureId)],
  };
  document.featureOrder.push(featureId);
  targetBody.name = definition.name;
  for (const toolBody of toolBodies) {
    toolBody!.visible = false;
    toolBody!.name = `构造体 · ${toolBody!.name}`;
    toolBody!.engineering = { ...toolBody!.engineering, group: `构造体 / ${definition.name}` };
  }
};

const sourceResource = (sourcePartId: string) => ({
  resourceId: COMPREHENSIVE_DEMO_RESOURCE_ID,
  resourceCode: comprehensiveDemoTemplate.resourceCode,
  resourceTitle: comprehensiveDemoTemplate.resourceTitle,
  sourcePartId,
});

const appendLoftedRobotMember = (
  document: CadDocument<Sketch, Feature>,
  options: {
    id: string;
    name: string;
    sourcePartId: string;
    sections: Array<{ offset: number; x: number; z: number; radius: number }>;
    translationMm: { x: number; y: number; z: number };
    rotationZDeg: number;
    appearance: { color: string; metalness: number; roughness: number };
  },
) => {
  const bodyId = `smart-cell-${options.id}-body`;
  const sectionIds = options.sections.map((section, index) => {
    const sketchId = `smart-cell-${options.id}-section-${index + 1}`;
    document.sketches[sketchId] = {
      id: sketchId,
      name: `${options.name} · 控制截面 ${index + 1}`,
      plane: { type: "XZ", offset: section.offset },
      entities: { profile: { id: "profile", type: "circle", center: { x: section.x, y: section.z }, radius: section.radius, construction: false } },
      entityOrder: ["profile"],
      constraints: { center: { id: "center", type: "fixed", entityIds: ["profile"], pointRefs: [{ entityId: "profile", role: "center" }], enabled: true } },
      dimensions: { radius: { id: "radius", name: "截面半径", type: "radius", entityIds: ["profile"], value: section.radius, driving: true } },
    };
    return sketchId;
  });
  const loftId = `smart-cell-${options.id}-loft`;
  const positionId = `smart-cell-${options.id}-position`;
  document.bodies[bodyId] = {
    ...createCadBody(bodyId, options.name, "solid"),
    appearance: options.appearance,
    engineering: engineeringBySourcePart(options.sourcePartId),
    sourceResource: sourceResource(options.sourcePartId),
  };
  document.features[loftId] = {
    id: loftId,
    name: `${options.name} · 多截面光顺放样`,
    type: "loft",
    bodyId,
    sectionSketchIds: sectionIds,
    solid: true,
    ruled: false,
    enabled: true,
    state: "clean",
    dependencies: [],
  };
  document.features[positionId] = {
    id: positionId,
    name: `${options.name} · 关节安装位置`,
    type: "bodyTransform",
    bodyId,
    inputFeatureId: loftId,
    translationMm: options.translationMm,
    rotation: { axis: "Z", angleDeg: options.rotationZDeg },
    enabled: true,
    state: "clean",
    dependencies: [loftId],
  };
  document.featureOrder.push(loftId, positionId);
};

const appendPatternedPocket = (
  document: CadDocument<Sketch, Feature>,
  options: {
    id: string;
    name: string;
    targetSourcePartId: string;
    planeOffset: number;
    profile: { kind: "circle"; x: number; z: number; radius: number } | { kind: "rectangle"; x: number; z: number; width: number; depth: number };
    pattern: { kind: "linear"; direction: "X" | "Y" | "Z"; count: number; spacingMm: number } | { kind: "circular"; axisOrigin: { x: number; y: number; z: number }; count: number; angleDeg: number };
  },
) => {
  const body = findSourceBody(document, options.targetSourcePartId);
  if (!body?.tipFeatureId) throw new Error(`${options.name} has no target body state.`);
  const targetFeatureId = body.tipFeatureId;
  const sketchId = `smart-cell-${options.id}-sketch`;
  const pocketId = `smart-cell-${options.id}-pocket`;
  const patternId = `smart-cell-${options.id}-pattern`;
  if (options.profile.kind === "circle") {
    document.sketches[sketchId] = {
      id: sketchId,
      name: `${options.name} · 驱动草图`,
      plane: { type: "XZ", offset: options.planeOffset },
      entities: { profile: { id: "profile", type: "circle", center: { x: options.profile.x, y: options.profile.z }, radius: options.profile.radius, construction: false } },
      entityOrder: ["profile"], constraints: {},
      dimensions: { diameter: { id: "diameter", name: "孔径", type: "diameter", entityIds: ["profile"], value: options.profile.radius * 2, driving: true } },
    };
  } else {
    const { x, z, width, depth } = options.profile;
    const x0 = x - width / 2; const x1 = x + width / 2; const z0 = z - depth / 2; const z1 = z + depth / 2;
    document.sketches[sketchId] = {
      id: sketchId,
      name: `${options.name} · 驱动草图`,
      plane: { type: "XZ", offset: options.planeOffset },
      entities: {
        a: { id: "a", type: "line", start: { x: x0, y: z0 }, end: { x: x1, y: z0 }, construction: false },
        b: { id: "b", type: "line", start: { x: x1, y: z0 }, end: { x: x1, y: z1 }, construction: false },
        c: { id: "c", type: "line", start: { x: x1, y: z1 }, end: { x: x0, y: z1 }, construction: false },
        d: { id: "d", type: "line", start: { x: x0, y: z1 }, end: { x: x0, y: z0 }, construction: false },
      },
      entityOrder: ["a", "b", "c", "d"], constraints: {},
      dimensions: {
        width: { id: "width", name: "槽宽", type: "horizontalDistance", entityIds: ["a"], pointRefs: [{ entityId: "a", role: "start" }, { entityId: "a", role: "end" }], value: width, driving: true },
        depth: { id: "depth", name: "槽长", type: "verticalDistance", entityIds: ["b"], pointRefs: [{ entityId: "b", role: "start" }, { entityId: "b", role: "end" }], value: depth, driving: true },
      },
    };
  }
  document.features[pocketId] = {
    id: pocketId,
    name: `${options.name} · 单个切除种子`,
    type: "pocket",
    bodyId: body.id,
    sketchId,
    targetFeatureId,
    targetBodyId: body.id,
    depth: { type: "throughAll" },
    enabled: true,
    state: "clean",
    dependencies: [targetFeatureId],
  };
  document.features[patternId] = options.pattern.kind === "linear" ? {
    id: patternId,
    name: `${options.name} · ${options.pattern.count} 实例线性阵列`,
    type: "linearPattern",
    bodyId: body.id,
    targetFeatureId,
    seedFeatureIds: [pocketId],
    direction: options.pattern.direction,
    count: options.pattern.count,
    spacingMm: options.pattern.spacingMm,
    enabled: true,
    state: "clean",
    dependencies: [targetFeatureId, pocketId],
  } : {
    id: patternId,
    name: `${options.name} · ${options.pattern.count} 实例圆周阵列`,
    type: "circularPattern",
    bodyId: body.id,
    targetFeatureId,
    seedFeatureIds: [pocketId],
    axis: { origin: options.pattern.axisOrigin, direction: { x: 0, y: 1, z: 0 } },
    count: options.pattern.count,
    angleDeg: options.pattern.angleDeg,
    enabled: true,
    state: "clean",
    dependencies: [targetFeatureId, pocketId],
  };
  document.featureOrder.push(pocketId, patternId);
};

export const comprehensiveDemoAssemblyModules = [
  { id: "Frame", definitionName: "智能工作站 · 基准机架", componentName: "基准机架", sourcePartIds: ["base", "frame-post--1--1", "frame-post--1-1", "frame-post-1--1", "frame-post-1-1", "frame-side-beam--1", "frame-side-beam-1", "frame-cross-beam--1", "frame-cross-beam-1", "rear-panel", "foot--1--1", "foot--1-1", "foot-1--1", "foot-1-1"] },
  { id: "Conveyor", definitionName: "柔性单元 · 精密输送与托盘", componentName: "精密输送与托盘模块", sourcePartIds: ["conveyor-bed", "conveyor-left-rail", "conveyor-right-rail", ...rollerXs.map((_, index) => `conveyor-roller-${index + 1}`), "carrier-pallet", "conveyor-stopper", "conveyor-drive-shaft", "conveyor-drive-bearing", "conveyor-drive-gear"] },
  { id: "Rotary", definitionName: "柔性单元 · 伺服回转夹具", componentName: "伺服回转夹具", sourcePartIds: ["rotary-motor", "rotary-bearing", "rotary-gear", "rotary-shaft", "rotary-platter", "rotary-encoder-ring", "rotary-encoder-head", "fixture-base", "fixture-guide-left", "fixture-guide-right", "locator", "jaw-left", "jaw-right", ...clampScrewPositions.map(({ id }) => id)] },
  { id: "Robot", definitionName: "柔性单元 · 六轴精密装配机器人", componentName: "六轴精密装配机器人", sourcePartIds: ["robot-pedestal", "robot-waist", "robot-shoulder", "robot-upper-arm", "robot-elbow", "robot-forearm", "robot-wrist", "gripper-body", "gripper-mount-flange", "gripper-left-guide", "gripper-right-guide", "gripper-finger-left", "gripper-finger-right", ...robotCoverScrews.map(({ id }) => id), "robot-cable"] },
  { id: "Inspection", definitionName: "柔性单元 · 视觉与测头复合检测", componentName: "视觉与测头复合检测模组", sourcePartIds: ["inspection-front-post", "inspection-rear-post", "inspection-crossbeam", "vision-camera", "camera-lens", "camera-ring-light", "laser-sensor", "touch-probe", "lofted-camera-hood"] },
  { id: "Tooling", definitionName: "柔性单元 · 快换工具与控制", componentName: "快换工具与控制模组", sourcePartIds: ["tool-rack", "tool-rack-base", "tool-rack-top", "tool-spindle-sleeve", ...bellowsZs.map((_, index) => `tool-spindle-bellows-${index + 1}`), "tool-spindle-bearing", "tool-drive-gear", "tool-holder", "control-panel", "swept-service-duct"] },
  { id: "SafetyDoor", definitionName: "柔性单元 · NURBS 曲面安全门", componentName: "NURBS 曲面安全门", sourcePartIds: ["nurbs-cover", "safety-door-handle", "safety-door-handle-upper", "safety-door-handle-lower"] },
] as const;

export const createComprehensiveDemoCadDocument = (): CadDocument<Sketch, Feature> => {
  const built = buildCadDocumentFromResourceTemplate(comprehensiveDemoTemplate, {
    documentId: "forgemind-smart-precision-cell-demo",
    documentName: comprehensiveDemoTemplate.projectName,
    instanceKey: "smart-cell",
  });
  const document = structuredClone(built.document) as CadDocument<Sketch, Feature>;
  for (const body of Object.values(document.bodies)) {
    const sourcePartId = body.sourceResource?.sourcePartId;
    if (sourcePartId) body.engineering = engineeringBySourcePart(sourcePartId);
  }
  for (const logicalPart of comprehensiveDemoLogicalParts) appendLogicalPartUnion(document, logicalPart);

  appendLoftedRobotMember(document, {
    id: "robot-upper-arm",
    name: "机器人上臂 · 五截面光顺铸件",
    sourcePartId: "robot-upper-arm",
    sections: [
      { offset: -135, x: -3, z: 0, radius: 54 },
      { offset: -82, x: -8, z: 0, radius: 50 },
      { offset: -18, x: 3, z: 0, radius: 43 },
      { offset: 67, x: 10, z: 0, radius: 42 },
      { offset: 135, x: 0, z: 0, radius: 50 },
    ],
    translationMm: { x: -225, y: 430, z: 100 },
    rotationZDeg: -40,
    appearance: finish.accent,
  });
  appendLoftedRobotMember(document, {
    id: "robot-forearm",
    name: "机器人前臂 · 五截面轻量化铸件",
    sourcePartId: "robot-forearm",
    sections: [
      { offset: -118, x: 0, z: 0, radius: 46 },
      { offset: -62, x: 4, z: 0, radius: 42 },
      { offset: 0, x: 7, z: 0, radius: 36 },
      { offset: 68, x: 3, z: 0, radius: 32 },
      { offset: 118, x: 0, z: 0, radius: 38 },
    ],
    translationMm: { x: -20, y: 550, z: 100 },
    rotationZDeg: -69,
    appearance: finish.steel,
  });

  appendPatternedPocket(document, {
    id: "fixture-mounting-hole-array",
    name: "夹具底板 Ø12 安装孔",
    targetSourcePartId: "fixture-base",
    planeOffset: 400,
    profile: { kind: "circle", x: 220, z: 80, radius: 6 },
    pattern: { kind: "circular", axisOrigin: { x: 140, y: 315, z: 80 }, count: 8, angleDeg: 360 },
  });
  appendPatternedPocket(document, {
    id: "conveyor-lightening-slot-array",
    name: "输送底架减重槽",
    targetSourcePartId: "conveyor-bed",
    planeOffset: 220,
    profile: { kind: "rectangle", x: -470, z: -220, width: 34, depth: 96 },
    pattern: { kind: "linear", direction: "X", count: 5, spacingMm: 105 },
  });

  const ductBodyId = "smart-cell-service-duct-body";
  const ductProfileId = "smart-cell-service-duct-profile";
  const ductPathId = "smart-cell-service-duct-path";
  const ductSweepId = "smart-cell-service-duct-sweep";
  const ductPositionId = "smart-cell-service-duct-position";
  document.sketches[ductProfileId] = {
    id: ductProfileId,
    name: "顶部管线截面 · Ø20",
    plane: { type: "YZ", offset: -280 },
    entities: { profile: { id: "profile", type: "circle", center: { x: 0, y: 0 }, radius: 10, construction: false } },
    entityOrder: ["profile"],
    constraints: {},
    dimensions: { diameter: { id: "diameter", name: "管线直径", type: "diameter", entityIds: ["profile"], value: 20, driving: true } },
  };
  document.sketches[ductPathId] = {
    id: ductPathId,
    name: "顶部管线路径 · 560 mm",
    plane: { type: "XZ", offset: 0 },
    entities: { path: { id: "path", type: "line", start: { x: -280, y: 0 }, end: { x: 280, y: 0 }, construction: false } },
    entityOrder: ["path"],
    constraints: {},
    dimensions: {},
  };
  document.bodies[ductBodyId] = {
    ...createCadBody(ductBodyId, "顶部工艺管线 · 实体扫掠", "solid"),
    appearance: { color: "#32433f", metalness: .65, roughness: .25 },
    engineering: engineeringBySourcePart("swept-service-duct"),
    sourceResource: { resourceId: COMPREHENSIVE_DEMO_RESOURCE_ID, resourceCode: comprehensiveDemoTemplate.resourceCode, resourceTitle: comprehensiveDemoTemplate.resourceTitle, sourcePartId: "swept-service-duct" },
  };
  document.features[ductSweepId] = { id: ductSweepId, name: "顶部管线 · 截面扫掠", type: "sweep", bodyId: ductBodyId, profileSketchId: ductProfileId, pathSketchId: ductPathId, operation: "new", orientation: "followPath", enabled: true, state: "clean", dependencies: [] };
  document.features[ductPositionId] = { id: ductPositionId, name: "顶部管线 · 安装位置", type: "bodyTransform", bodyId: ductBodyId, inputFeatureId: ductSweepId, translationMm: { x: 0, y: 720, z: 300 }, enabled: true, state: "clean", dependencies: [ductSweepId] };
  document.featureOrder.push(ductSweepId, ductPositionId);

  const hoodBodyId = "smart-cell-camera-hood-body";
  const hoodSectionIds = ["smart-cell-hood-section-a", "smart-cell-hood-section-b", "smart-cell-hood-section-c"];
  [
    { id: hoodSectionIds[0], offset: 0, radius: 42 },
    { id: hoodSectionIds[1], offset: 55, radius: 33 },
    { id: hoodSectionIds[2], offset: 105, radius: 24 },
  ].forEach(({ id, offset, radius }, index) => {
    document.sketches[id] = {
      id,
      name: `检测罩截面 ${index + 1}`,
      plane: { type: "XY", offset },
      entities: { profile: { id: "profile", type: "circle", center: { x: 0, y: 0 }, radius, construction: false } },
      entityOrder: ["profile"],
      constraints: {},
      dimensions: { radius: { id: "radius", name: "截面半径", type: "radius", entityIds: ["profile"], value: radius, driving: true } },
    };
  });
  const hoodLoftId = "smart-cell-camera-hood-loft";
  const hoodPositionId = "smart-cell-camera-hood-position";
  document.bodies[hoodBodyId] = {
    ...createCadBody(hoodBodyId, "视觉检测罩 · 三截面放样", "solid"),
    appearance: { color: "#4faaa5", metalness: .42, roughness: .22 },
    engineering: engineeringBySourcePart("lofted-camera-hood"),
    sourceResource: { resourceId: COMPREHENSIVE_DEMO_RESOURCE_ID, resourceCode: comprehensiveDemoTemplate.resourceCode, resourceTitle: comprehensiveDemoTemplate.resourceTitle, sourcePartId: "lofted-camera-hood" },
  };
  document.features[hoodLoftId] = { id: hoodLoftId, name: "视觉检测罩 · 三截面实体放样", type: "loft", bodyId: hoodBodyId, sectionSketchIds: hoodSectionIds, solid: true, ruled: false, enabled: true, state: "clean", dependencies: [] };
  document.features[hoodPositionId] = { id: hoodPositionId, name: "视觉检测罩 · 安装位置", type: "bodyTransform", bodyId: hoodBodyId, inputFeatureId: hoodLoftId, translationMm: { x: 420, y: 515, z: 90 }, rotation: { axis: "X", angleDeg: 90 }, enabled: true, state: "clean", dependencies: [hoodLoftId] };
  document.featureOrder.push(hoodLoftId, hoodPositionId);

  const surfaceBodyId = "smart-cell-nurbs-surface-body";
  const surfaceFeatureId = "smart-cell-nurbs-surface";
  document.bodies[surfaceBodyId] = {
    ...createCadBody(surfaceBodyId, "安全门外观母面 · NURBS 控制网", "surface"),
    visible: false,
    appearance: { color: "#46a9bd", metalness: .12, roughness: .24 },
    engineering: { material: "安全门母面 / NURBS", densityKgM3: 0, toleranceMm: .05, process: "A级曲面设计 / 边界连续性检查", group: "柔性单元 / 曲面安全门" },
    sourceResource: { resourceId: COMPREHENSIVE_DEMO_RESOURCE_ID, resourceCode: comprehensiveDemoTemplate.resourceCode, resourceTitle: comprehensiveDemoTemplate.resourceTitle, sourcePartId: "nurbs-surface" },
  };
  document.features[surfaceFeatureId] = {
    id: surfaceFeatureId,
    name: "流线型安全门母面 · 4×4 NURBS",
    type: "bsplineSurface",
    bodyId: surfaceBodyId,
    controlNet: [
      [{ x: 260, y: 90, z: 330 }, { x: 335, y: 90, z: 372 }, { x: 425, y: 90, z: 372 }, { x: 500, y: 90, z: 330 }],
      [{ x: 250, y: 280, z: 340 }, { x: 330, y: 280, z: 395 }, { x: 430, y: 280, z: 395 }, { x: 510, y: 280, z: 340 }],
      [{ x: 250, y: 505, z: 335 }, { x: 330, y: 505, z: 390 }, { x: 430, y: 505, z: 390 }, { x: 510, y: 505, z: 335 }],
      [{ x: 270, y: 715, z: 315 }, { x: 345, y: 715, z: 355 }, { x: 415, y: 715, z: 355 }, { x: 490, y: 715, z: 315 }],
    ],
    enabled: true,
    state: "clean",
    dependencies: [],
  };
  document.featureOrder.push(surfaceFeatureId);

  const clearanceSurfaceBodyId = "smart-cell-nurbs-clearance-body";
  const clearanceSurfaceFeatureId = "smart-cell-nurbs-clearance-offset";
  document.bodies[clearanceSurfaceBodyId] = {
    ...createCadBody(clearanceSurfaceBodyId, "安全门装配间隙检查面 · 偏移曲面", "surface"),
    visible: false,
    appearance: { color: "#c79838", metalness: .08, roughness: .32 },
    engineering: { material: "工艺检查曲面", densityKgM3: 0, toleranceMm: .02, process: "曲面偏移 / 装配间隙检查", group: "柔性单元 / 曲面安全门" },
    sourceResource: sourceResource("nurbs-clearance-surface"),
  };
  document.features[clearanceSurfaceFeatureId] = {
    id: clearanceSurfaceFeatureId,
    name: "安全门装配间隙面 · 偏移 12 mm",
    type: "offsetSurface",
    bodyId: clearanceSurfaceBodyId,
    targetFeatureId: surfaceFeatureId,
    distanceMm: 12,
    toleranceMm: .02,
    enabled: true,
    state: "clean",
    dependencies: [surfaceFeatureId],
  };
  document.featureOrder.push(clearanceSurfaceFeatureId);

  const coverBodyId = "smart-cell-nurbs-cover-body";
  const coverFeatureId = "smart-cell-nurbs-cover-thicken";
  document.bodies[coverBodyId] = {
    ...createCadBody(coverBodyId, "曲面安全门 · 加厚实体", "solid"),
    appearance: { color: "#79aaa5", metalness: .1, roughness: .27 },
    engineering: { material: "透明聚碳酸酯 / PC", densityKgM3: 1200, toleranceMm: .08, process: "热成型 / 五轴修边", group: "柔性单元 / 曲面安全门" },
    sourceResource: { resourceId: COMPREHENSIVE_DEMO_RESOURCE_ID, resourceCode: comprehensiveDemoTemplate.resourceCode, resourceTitle: comprehensiveDemoTemplate.resourceTitle, sourcePartId: "nurbs-cover" },
  };
  document.features[coverFeatureId] = {
    id: coverFeatureId,
    name: "安全门母面加厚 4 mm",
    type: "thickenSurface",
    bodyId: coverBodyId,
    targetFeatureId: surfaceFeatureId,
    thicknessMm: 4,
    toleranceMm: .02,
    enabled: true,
    state: "clean",
    dependencies: [surfaceFeatureId],
  };
  document.featureOrder.push(coverFeatureId);
  document.activeBodyId = Object.keys(document.bodies)[0];
  return withDerivedBodyTips(document);
};

const demoIdentityPlacement = (): RigidTransform => ({ translationMm: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } });

/** Shared factory for the UI and regression tests. The installed modules start
 * fixed at their modeled location; rotary tooling and the robot remain free so
 * a live demonstration can add face mates, connector mates and motion limits. */
export const createComprehensiveDemoAssembly = () => {
  const cad = createComprehensiveDemoCadDocument();
  const definitions = comprehensiveDemoAssemblyModules.map((moduleDefinition) => createPartDefinitionFromCadDocument(
    `${moduleDefinition.id}DemoDefinition`,
    moduleDefinition.definitionName,
    extractCadDocumentPart(cad, { id: `${moduleDefinition.id}DemoPart`, name: moduleDefinition.componentName, sourcePartIds: [...moduleDefinition.sourcePartIds] }),
    createCadAssetStore(),
  ));
  const definitionStore = createPartDefinitionStore(definitions);
  let assembly = createAssemblyDocument({ id: "AssemblyDebug", name: "ForgeMind 自适应精密装配与检测中心" });
  for (const moduleDefinition of comprehensiveDemoAssemblyModules) {
    assembly = insertComponent(assembly, { id: `${moduleDefinition.id}Module`, name: moduleDefinition.componentName, definitionId: `${moduleDefinition.id}DemoDefinition`, nominalPlacement: demoIdentityPlacement(), grounded: moduleDefinition.id === "Frame", visible: true });
  }
  for (const componentId of ["ConveyorModule", "InspectionModule", "ToolingModule", "SafetyDoorModule"]) {
    assembly = addMate(assembly, { id: `Fixed-${componentId}`, name: `${assembly.components[componentId].name} · 固定安装`, type: "fixed", enabled: true, componentId, lockedPlacement: demoIdentityPlacement() });
  }
  return { cad, assembly, definitions: definitionStore };
};
