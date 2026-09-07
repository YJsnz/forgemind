import type { CadDocument } from "../cad/CadDocument.ts";
import type { UUID } from "../cad/CadTypes.ts";
import type { Feature } from "../features/Feature.ts";
import { validateMechanicalDetail } from "../mechanical/MechanicalDetail.ts";
import type { Sketch } from "../sketch/Sketch.ts";

export type CadEngineeringSeverity = "error" | "warning" | "info";

export interface CadEngineeringIssue {
  code: string;
  severity: CadEngineeringSeverity;
  message: string;
  bodyId?: UUID;
  featureId?: UUID;
}

export interface CadReadinessCheck {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
  weight: number;
}

export interface CadEngineeringReadinessReport {
  ready: boolean;
  score: number;
  checks: CadReadinessCheck[];
  issues: CadEngineeringIssue[];
  summary: { bodyCount: number; rebuiltBodyCount: number; featureCount: number; mechanicalDetailCount: number; reusableMechanicalDefinitionCount: number };
}

const cableTurnRadius = (a: {x:number;y:number;z:number}, b: {x:number;y:number;z:number}, c: {x:number;y:number;z:number}) => {
  const ab = Math.hypot(b.x-a.x,b.y-a.y,b.z-a.z), bc = Math.hypot(c.x-b.x,c.y-b.y,c.z-b.z), ac = Math.hypot(c.x-a.x,c.y-a.y,c.z-a.z);
  const cross = { x:(b.y-a.y)*(c.z-a.z)-(b.z-a.z)*(c.y-a.y), y:(b.z-a.z)*(c.x-a.x)-(b.x-a.x)*(c.z-a.z), z:(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x) };
  const twiceArea = Math.hypot(cross.x,cross.y,cross.z);
  return twiceArea <= 1e-9 ? Infinity : ab*bc*ac/(2*twiceArea);
};

/** Pure design/runtime readiness analysis; it never changes or persists a project. */
export const analyzeCadEngineeringReadiness = (
  document: CadDocument<Sketch, Feature> | undefined,
  options: { rebuiltBodyIds?: ReadonlySet<UUID>; exportAvailable?: boolean } = {},
): CadEngineeringReadinessReport => {
  if (!document) return { ready:false,score:0,checks:[{id:"geometry",label:"B-Rep 几何",passed:false,detail:"当前没有建模项目",weight:30}],issues:[{code:"DOCUMENT_MISSING",severity:"error",message:"当前没有可检查的建模项目。"}],summary:{bodyCount:0,rebuiltBodyCount:0,featureCount:0,mechanicalDetailCount:0,reusableMechanicalDefinitionCount:0} };
  const bodies = Object.values(document.bodies).filter((body)=>body.visible !== false);
  const features = document.featureOrder.map((id)=>document.features[id]).filter((feature):feature is Feature=>Boolean(feature));
  const mechanical = features.filter((feature):feature is Extract<Feature,{type:"mechanicalDetail"}>=>feature.type === "mechanicalDetail");
  const rebuiltBodyCount = bodies.filter((body)=>options.rebuiltBodyIds?.has(body.id)).length;
  const engineeringCount = bodies.filter((body)=>!!body.engineering?.material && Number.isFinite(body.engineering?.densityKgM3) && (body.engineering?.densityKgM3 ?? 0)>0 && Number.isFinite(body.engineering?.toleranceMm) && (body.engineering?.toleranceMm ?? -1)>=0 && !!body.engineering?.process).length;
  const issues: CadEngineeringIssue[] = [];
  for (const feature of features) {
    if (feature.state === "error") issues.push({code:"FEATURE_ERROR",severity:"error",message:`特征“${feature.name}”重建失败，当前显示的是上一次正确结果。`,featureId:feature.id,bodyId:feature.bodyId});
    if (feature.type !== "mechanicalDetail") continue;
    for (const message of validateMechanicalDetail(feature.detail)) issues.push({code:"MECHANICAL_PARAMETER_INVALID",severity:"error",message:`${feature.name}：${message}`,featureId:feature.id,bodyId:feature.bodyId});
    const detail = feature.detail;
    if (detail.kind === "externalThread") {
      const turns = (detail.threadedLengthMm ?? detail.lengthMm)/detail.pitchMm;
      if (turns > 24) issues.push({code:"THREAD_REBUILD_COST",severity:"warning",message:`“${feature.name}”包含约 ${turns.toFixed(0)} 圈完整牙型；若只是远景或重复紧固件，可缩短有效牙长。`,featureId:feature.id,bodyId:feature.bodyId});
    } else if (detail.kind === "spurGear") {
      const undercutLimit = Math.ceil(2/Math.pow(Math.sin(detail.pressureAngleDeg*Math.PI/180),2));
      if (detail.teeth < undercutLimit) issues.push({code:"GEAR_UNDERCUT_RISK",severity:"warning",message:`“${feature.name}”在 ${detail.pressureAngleDeg}° 压力角下齿数较少，标准全齿高齿形可能出现根切，建议变位或增加齿数。`,featureId:feature.id,bodyId:feature.bodyId});
    } else if (detail.kind === "bearing") {
      const radialGap = (detail.outerDiameterMm-detail.innerDiameterMm)/2;
      const approximateBallDiameter = Math.min(detail.widthMm*.6,Math.max(.6,(radialGap-radialGap*.56)*.96));
      const spacing = Math.PI*(detail.outerDiameterMm+detail.innerDiameterMm)/2/detail.ballCount;
      if (spacing < approximateBallDiameter*1.08) issues.push({code:"BEARING_BALL_PACKING",severity:"error",message:`“${feature.name}”的滚动体数量超过当前滚道空间，请减少数量或增大轴承尺寸。`,featureId:feature.id,bodyId:feature.bodyId});
    } else {
      for (let index=1;index<detail.pathPointsMm.length-1;index+=1) {
        const radius=cableTurnRadius(detail.pathPointsMm[index-1],detail.pathPointsMm[index],detail.pathPointsMm[index+1]);
        if (radius < detail.diameterMm*3) { issues.push({code:"CABLE_BEND_RADIUS",severity:"warning",message:`“${feature.name}”第 ${index+1} 个转弯过紧；建议弯曲半径不小于线缆直径的 3 倍。`,featureId:feature.id,bodyId:feature.bodyId}); break; }
      }
    }
  }
  for (const body of bodies) {
    if (!body.engineering?.material) issues.push({code:"MATERIAL_MISSING",severity:"warning",message:`实体“${body.name}”尚未设置材料。`,bodyId:body.id});
    if (!Number.isFinite(body.engineering?.toleranceMm)) issues.push({code:"TOLERANCE_MISSING",severity:"warning",message:`实体“${body.name}”尚未设置制造公差。`,bodyId:body.id});
    if (!body.engineering?.process) issues.push({code:"PROCESS_MISSING",severity:"info",message:`实体“${body.name}”尚未设置制造工艺。`,bodyId:body.id});
  }
  const definitionCounts=new Map<string,number>();
  for(const feature of mechanical){const key=JSON.stringify(feature.detail);definitionCounts.set(key,(definitionCounts.get(key)??0)+1);}
  const reusableMechanicalDefinitionCount=[...definitionCounts.values()].filter((count)=>count>1).length;
  const mechanicalErrors=issues.filter((issue)=>issue.featureId&&issue.severity==="error").length;
  const checks: CadReadinessCheck[] = [
    {id:"geometry",label:"B-Rep 几何",passed:bodies.length>0&&rebuiltBodyCount===bodies.length,detail:bodies.length?`${rebuiltBodyCount}/${bodies.length} 个可见实体已完成重建`:"尚未建立实体",weight:30},
    {id:"history",label:"可编辑历史",passed:features.length>0&&!features.some((feature)=>feature.state==="error"),detail:`${features.length} 个特征，${features.filter((feature)=>feature.state==="error").length} 个错误`,weight:15},
    {id:"mechanical",label:"机械细节",passed:mechanicalErrors===0,detail:mechanical.length?`${mechanical.length} 个参数化机械细节，${reusableMechanicalDefinitionCount} 组可复用定义`:"当前模型没有专用机械细节",weight:20},
    {id:"engineering",label:"材料、公差与工艺",passed:bodies.length>0&&engineeringCount===bodies.length,detail:`${engineeringCount}/${bodies.length} 个实体资料完整`,weight:20},
    {id:"save",label:"本地保存",passed:true,detail:"设计意图可保存到本机项目",weight:5},
    {id:"export",label:"交付准备",passed:options.exportAvailable===true&&bodies.length>0&&!issues.some((issue)=>issue.severity==="error"),detail:options.exportAvailable?"可导出 CAD 项目包和 STEP":"等待当前操作完成",weight:10},
  ];
  const totalWeight=checks.reduce((sum,check)=>sum+check.weight,0);
  const score=Math.round(checks.filter((check)=>check.passed).reduce((sum,check)=>sum+check.weight,0)/totalWeight*100);
  return {ready:!issues.some((issue)=>issue.severity==="error")&&checks.find((check)=>check.id==="geometry")!.passed,score,checks,issues,summary:{bodyCount:bodies.length,rebuiltBodyCount,featureCount:features.length,mechanicalDetailCount:mechanical.length,reusableMechanicalDefinitionCount}};
};
