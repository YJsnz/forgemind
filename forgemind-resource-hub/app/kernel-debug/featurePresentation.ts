import type { Feature } from "../../core/features/Feature";
import type { EditableParameter } from "./workbenchTypes";

const FEATURE_TYPE_LABELS: Partial<Record<Feature["type"], string>> = {
  extrude: "拉伸", pocket: "凹槽切除", revolve: "旋转成型", hole: "孔", fillet: "圆角", chamfer: "倒角", shell: "抽壳",
  draft: "拔模", rib: "加强筋", bodyTransform: "实体位置", bodyBoolean: "实体布尔", linearPattern: "线性阵列", circularPattern: "圆周阵列",
  importedStep: "导入的 STEP", removeHole: "删除孔", deleteFace: "删除面并修复", offsetBody: "整体偏移", planarPushPull: "推拉平面",
  healHolePattern: "孔阵列修复", surfacePatch: "曲面片", surfaceExtrude: "曲面拉伸", surfaceRevolve: "曲面旋转", surfaceSweep: "曲面扫掠",
  surfaceLoft: "曲面放样", bsplineSurface: "B 样条曲面", boundarySurface: "边界曲面", splitSurface: "曲面分割", replaceFace: "替换表面",
  extractSurface: "提取曲面", offsetSurface: "曲面偏移", sewSurface: "曲面缝合", thickenSurface: "曲面加厚", encloseSurface: "封闭为实体",
  fillSurface: "填补曲面", trimSurface: "修剪曲面", nurbsSurface: "NURBS 曲面",
  surfaceIntersection: "曲面交线",
  mechanicalDetail: "机械细节",
};

export const featureTypeLabel = (type: Feature["type"]): string => FEATURE_TYPE_LABELS[type] ?? type;

export const featureStateLabel = (feature: Feature): string => !feature.enabled || feature.state === "suppressed"
  ? "已停用，不参与当前模型"
  : feature.state === "error" ? "存在错误，保留上一次有效结果" : "正常，已参与模型重建";

export const featureSummary = (feature: Feature): string => {
  switch (feature.type) {
    case "extrude": return `距离 ${feature.distance} 毫米 · ${feature.operation === "new" ? "新建实体" : feature.operation === "add" ? "添加材料" : "切除材料"}`;
    case "hole": return `直径 Ø${feature.diameterMm} 毫米 · ${feature.depth.type === "throughAll" ? "贯穿" : `深 ${feature.depth.valueMm} 毫米`}${feature.style?.type === "counterbore" ? ` · 沉孔 Ø${feature.style.diameterMm} × ${feature.style.depthMm} 毫米` : feature.style?.type === "countersink" ? ` · 沉头 Ø${feature.style.diameterMm} / ${feature.style.includedAngleDeg}°` : ""}`;
    case "fillet": return feature.endRadiusMm === undefined ? `半径 R${feature.radiusMm} 毫米` : `可变半径 R${feature.radiusMm} → R${feature.endRadiusMm} 毫米`;
    case "chamfer": return `宽度 ${feature.distanceMm} 毫米`;
    case "shell": return `壁厚 ${feature.thicknessMm} 毫米`;
    case "revolve": return `旋转 ${feature.angleDeg}°`;
    case "loft": return `${feature.sectionSketchIds.length} 个截面${feature.startCondition ? ` · 起点 ${feature.startCondition.continuity === "G2" ? "曲率趋势" : "方向引导"}` : ""}${feature.endCondition ? ` · 终点 ${feature.endCondition.continuity === "G2" ? "曲率趋势" : "方向引导"}` : ""}`;
    case "bodyTransform": return `位移 X ${feature.translationMm.x}、Y ${feature.translationMm.y}、Z ${feature.translationMm.z} 毫米${feature.rotation ? ` · 绕 ${feature.rotation.axis} 轴旋转 ${feature.rotation.angleDeg.toFixed(1)}°` : ""}`;
    case "bodyBoolean": return feature.operation === "union" ? "合并两个实体" : feature.operation === "cut" ? "用工具体切除" : "保留相交部分";
    case "rib": return `厚 ${feature.thicknessMm} × 高 ${feature.heightMm} 毫米 · ${feature.direction === "negative" ? "反向" : "正向"}`;
    case "importedStep": return "来自 STEP 文件的实体";
    case "removeHole": return "直接编辑：填补并删除孔";
    case "deleteFace": return `直接编辑：删除并修复 ${feature.faces.length} 个面`;
    case "offsetBody": return `整体偏移 ${feature.distanceMm} 毫米`;
    case "planarPushPull": return `平面移动 ${feature.distanceMm} 毫米`;
    case "healHolePattern": return `修复导入模型中的 ${feature.cylindricalFaces.length} 个孔`;
    case "linearPattern": return `${feature.count} 个 · 间距 ${feature.spacingMm} 毫米`;
    case "circularPattern": return `${feature.count} 个 · 覆盖 ${feature.angleDeg}°`;
    case "surfacePatch": return "平面曲面片";
    case "surfaceExtrude": return `拉伸 ${feature.distanceMm} 毫米 · 仅生成曲面`;
    case "surfaceRevolve": return `旋转 ${feature.angleDeg}° · 仅生成曲面`;
    case "surfaceSweep": return `截面 ${feature.profileSketchId} 沿路径 ${feature.pathSketchId} · ${feature.orientation === "guide" ? `辅助导轨 ${feature.guideSketchId ?? "未设置"}` : feature.orientation === "fixedUp" ? "固定方向" : "随路径转向"}`;
    case "surfaceLoft": return `${feature.sectionSketchIds.length} 个截面 · ${feature.ruled ? "直纹连接" : "平滑连接"}${feature.startCondition ? ` · 起点 ${feature.startCondition.continuity === "G2" ? "曲率趋势" : "方向引导"}` : ""}${feature.endCondition ? ` · 终点 ${feature.endCondition.continuity === "G2" ? "曲率趋势" : "方向引导"}` : ""}`;
    case "bsplineSurface": { const matches=feature.boundaryMatches?.length?feature.boundaryMatches:feature.boundaryMatch?[feature.boundaryMatch]:[];return `${feature.controlNet.length} × ${feature.controlNet[0]?.length ?? 0} 控制点网格${feature.tensorNurbs ? ` · U${feature.tensorNurbs.u.degree}/V${feature.tensorNurbs.v.degree} 完整 NURBS` : feature.rationalSections ? ` · ${feature.rationalSections.direction.toUpperCase()} 向有理截面` : ""}${matches.length ? ` · ${matches.length} 边关联（${matches.map((match)=>match.continuity).join("/")}）` : ""}`; }
    case "boundarySurface": return `${feature.boundaryEdges.length} 条边界 · 连续性 ${feature.continuity}`;
    case "splitSurface": return `使用 ${feature.toolFeatureId} 分割`;
    case "replaceFace": return `使用曲面 ${feature.replacementFeatureId} 替换`;
    case "extractSurface": return `从实体提取 ${feature.faces.length} 个面`;
    case "offsetSurface": return `偏移 ${feature.distanceMm} 毫米`;
    case "sewSurface": return `缝合 ${feature.sourceFeatureIds.length} 组曲面`;
    case "thickenSurface": return `加厚 ${feature.thicknessMm} 毫米`;
    case "encloseSurface": return `封闭 ${feature.sourceFeatureIds.length} 组曲面并生成实体`;
    case "fillSurface": return `填补由 ${feature.boundaryEdges.length} 条边组成的开口`;
    case "trimSurface": return `${feature.keep === "outside" ? "保留外侧" : "保留内侧"} · 工具 ${feature.toolFeatureId}`;
    case "surfaceIntersection": return `${feature.sourceFeatureIds[0]} 与 ${feature.sourceFeatureIds[1]} 的精确交线`;
    case "mechanicalDetail": return feature.detail.kind === "externalThread" ? `外螺纹 Ø${feature.detail.majorDiameterMm} · 螺距 ${feature.detail.pitchMm} · 杆长 ${feature.detail.lengthMm} · 有效牙长 ${feature.detail.threadedLengthMm ?? feature.detail.lengthMm} 毫米`
      : feature.detail.kind === "spurGear" ? `直齿轮 · 模数 ${feature.detail.moduleMm.toFixed(2)} · ${feature.detail.teeth} 齿 · 压力角 ${feature.detail.pressureAngleDeg}°`
        : feature.detail.kind === "bearing" ? `滚动轴承 Ø${feature.detail.outerDiameterMm} / Ø${feature.detail.innerDiameterMm} × ${feature.detail.widthMm} · ${feature.detail.ballCount} 个滚动体`
          : `平滑线缆 Ø${feature.detail.diameterMm} · ${feature.detail.pathPointsMm.length} 个路径点`;
    case "nurbsSurface": return `${feature.rows} × ${feature.cols} 控制点网格 · B 样条`;
    default: return feature.type;
  }
};

export const editableParameters = (feature: Feature | undefined): EditableParameter[] => {
  if (!feature) return [];
  switch (feature.type) {
    case "extrude": return [{ key: "distance", label: "拉伸距离（毫米）", value: feature.distance, min: 0.01, step: 1 }];
    case "hole": return [
      { key: "diameterMm", label: "孔直径（毫米）", value: feature.diameterMm, min: 0.01, step: 0.5 },
      ...(feature.depth.type === "blind" ? [{ key: "depthMm" as const, label: "孔深（毫米）", value: feature.depth.valueMm, min: 0.01, step: 0.5 }] : []),
      ...(feature.style?.type === "counterbore" ? [
        { key: "styleDiameterMm" as const, label: "沉孔直径（毫米）", value: feature.style.diameterMm, min: 0.01, step: 0.5 },
        { key: "counterboreDepthMm" as const, label: "沉孔深度（毫米）", value: feature.style.depthMm, min: 0.01, step: 0.5 },
      ] : feature.style?.type === "countersink" ? [
        { key: "styleDiameterMm" as const, label: "沉头孔直径（毫米）", value: feature.style.diameterMm, min: 0.01, step: 0.5 },
        { key: "countersinkAngleDeg" as const, label: "沉头夹角（度）", value: feature.style.includedAngleDeg, min: 1, step: 1 },
      ] : []),
    ];
    case "fillet": return [
      { key: "radiusMm", label: feature.endRadiusMm === undefined ? "圆角半径（毫米）" : "起点半径（毫米）", value: feature.radiusMm, min: 0.01, step: 0.5 },
      ...(feature.endRadiusMm === undefined ? [] : [{ key: "endRadiusMm", label: "终点半径（毫米）", value: feature.endRadiusMm, min: 0.01, step: 0.5 }]),
    ];
    case "chamfer": return [{ key: "distanceMm", label: "倒角宽度（毫米）", value: feature.distanceMm, min: 0.01, step: 0.5 }];
    case "shell": return [{ key: "thicknessMm", label: "壁厚（毫米）", value: feature.thicknessMm, min: 0.01, step: 0.5 }];
    case "revolve": return [{ key: "angleDeg", label: "旋转角度（度）", value: feature.angleDeg, min: 0.1, step: 1 }];
    case "loft":
    case "surfaceLoft": return [
      ...(feature.startCondition ? [{ key: "startLengthMm", label: "起点方向控制长度（毫米）", value: feature.startCondition.lengthMm, min: .01, step: .5 }] : []),
      ...(feature.endCondition ? [{ key: "endLengthMm", label: "终点方向控制长度（毫米）", value: feature.endCondition.lengthMm, min: .01, step: .5 }] : []),
    ];
    case "draft": return [{ key: "angleDeg", label: "拔模角度（度）", value: feature.angleDeg, step: 0.5 }];
    case "offsetBody": return [{ key: "distanceMm", label: "实体整体偏移（毫米）", value: feature.distanceMm, step: 0.5 }];
    case "planarPushPull": return [{ key: "distanceMm", label: "平面移动距离（毫米）", value: feature.distanceMm, step: 0.5 }];
    case "linearPattern": return [{ key: "patternCount", label: "阵列数量（个）", value: feature.count, min: 2, step: 1 }, { key: "patternSpacingMm", label: "相邻间距（毫米）", value: feature.spacingMm, min: .01, step: .5 }];
    case "circularPattern": return [{ key: "patternCount", label: "阵列数量（个）", value: feature.count, min: 2, step: 1 }, { key: "patternAngleDeg", label: "覆盖角度（度）", value: feature.angleDeg, min: .1, step: 1 }];
    case "surfaceExtrude": return [{ key: "distanceMm", label: "曲面拉伸距离（毫米）", value: feature.distanceMm, min: .01, step: .5 }];
    case "surfaceRevolve": return [{ key: "angleDeg", label: "曲面旋转角度（度）", value: feature.angleDeg, min: .1, step: 1 }];
    case "offsetSurface": return [{ key: "distanceMm", label: "曲面偏移距离（毫米）", value: feature.distanceMm, step: .25 }];
    case "thickenSurface": return [{ key: "thicknessMm", label: "曲面加厚厚度（毫米）", value: feature.thicknessMm, min: .01, step: .25 }];
    case "mechanicalDetail": return feature.detail.kind === "externalThread" ? [
      { key: "majorDiameterMm", label: "螺纹大径（毫米）", value: feature.detail.majorDiameterMm, min: 1, step: .5 },
      { key: "pitchMm", label: "螺距（毫米）", value: feature.detail.pitchMm, min: .2, step: .1 },
      { key: "lengthMm", label: "螺纹长度（毫米）", value: feature.detail.lengthMm, min: 1, step: 1 },
      { key: "threadedLengthMm", label: "有效牙长（毫米）", value: feature.detail.threadedLengthMm ?? feature.detail.lengthMm, min: 1, step: 1 },
      { key: "threadDepthMm", label: "牙深（毫米）", value: feature.detail.threadDepthMm, min: .1, step: .1 },
    ] : feature.detail.kind === "spurGear" ? [
      { key: "moduleMm", label: "模数（毫米）", value: feature.detail.moduleMm, min: .2, step: .1 },
      { key: "teeth", label: "齿数（个）", value: feature.detail.teeth, min: 8, step: 1 },
      { key: "pressureAngleDeg", label: "压力角（度）", value: feature.detail.pressureAngleDeg, min: 14, step: 1 },
      { key: "thicknessMm", label: "齿宽（毫米）", value: feature.detail.thicknessMm, min: 1, step: .5 },
      { key: "boreDiameterMm", label: "轴孔直径（毫米）", value: feature.detail.boreDiameterMm, min: 0, step: .5 },
    ] : feature.detail.kind === "bearing" ? [
      { key: "outerDiameterMm", label: "轴承外径（毫米）", value: feature.detail.outerDiameterMm, min: 2, step: 1 },
      { key: "innerDiameterMm", label: "轴承内径（毫米）", value: feature.detail.innerDiameterMm, min: 1, step: 1 },
      { key: "widthMm", label: "轴承宽度（毫米）", value: feature.detail.widthMm, min: 1, step: .5 },
      { key: "ballCount", label: "滚动体数量（个）", value: feature.detail.ballCount, min: 5, step: 1 },
    ] : [{ key: "cableDiameterMm", label: "线缆直径（毫米）", value: feature.detail.diameterMm, min: .5, step: .5 }];
    default: return [];
  }
};
