import test from "node:test";
import assert from "node:assert/strict";

import { createCadBody } from "../core/cad/CadBodies.ts";
import { createCadDocument } from "../core/cad/CadDocument.ts";
import { analyzeCadEngineeringReadiness } from "../core/engineering/CadEngineeringReadiness.ts";

const feature = (id, detail, bodyId=id) => ({id,name:id,type:"mechanicalDetail",bodyId,detail,enabled:true,state:"clean",dependencies:[]});

test("V23 readiness explains an empty project without inventing a score",()=>{
  const report=analyzeCadEngineeringReadiness(undefined);
  assert.equal(report.score,0); assert.equal(report.ready,false); assert.equal(report.issues[0].code,"DOCUMENT_MISSING");
});

test("V23 readiness gives a complete, rebuilt engineering model full credit",()=>{
  const gear={kind:"spurGear",moduleMm:2,teeth:24,pressureAngleDeg:20,thicknessMm:12,boreDiameterMm:10};
  const bodies={A:{...createCadBody("A","主动齿轮"),tipFeatureId:"GearA",engineering:{material:"40Cr",densityKgM3:7850,toleranceMm:.02,process:"滚齿"}},B:{...createCadBody("B","从动齿轮"),tipFeatureId:"GearB",engineering:{material:"40Cr",densityKgM3:7850,toleranceMm:.02,process:"滚齿"}}};
  const document=createCadDocument({id:"ready",name:"Ready",sketches:{},bodies,activeBodyId:"A",features:{GearA:feature("GearA",gear,"A"),GearB:feature("GearB",gear,"B")},featureOrder:["GearA","GearB"]});
  const report=analyzeCadEngineeringReadiness(document,{rebuiltBodyIds:new Set(["A","B"]),exportAvailable:true});
  assert.equal(report.score,100); assert.equal(report.ready,true); assert.equal(report.summary.reusableMechanicalDefinitionCount,1);
});

test("V23 readiness turns difficult engineering parameters into readable actions",()=>{
  const details={
    Thread:feature("Thread",{kind:"externalThread",majorDiameterMm:12,pitchMm:1,lengthMm:60,threadedLengthMm:40,threadDepthMm:.5}),
    Gear:feature("Gear",{kind:"spurGear",moduleMm:2,teeth:10,pressureAngleDeg:20,thicknessMm:8,boreDiameterMm:4}),
    Cable:feature("Cable",{kind:"cableSweep",diameterMm:10,pathPointsMm:[{x:0,y:0,z:0},{x:10,y:0,z:0},{x:10,y:2,z:0}]})
  };
  const bodies=Object.fromEntries(Object.keys(details).map((id)=>[id,{...createCadBody(id,id),tipFeatureId:id}]));
  const document=createCadDocument({id:"review",name:"Review",sketches:{},bodies,activeBodyId:"Thread",features:details,featureOrder:Object.keys(details)});
  const report=analyzeCadEngineeringReadiness(document,{rebuiltBodyIds:new Set(Object.keys(details)),exportAvailable:true});
  const codes=new Set(report.issues.map((issue)=>issue.code));
  assert.ok(codes.has("THREAD_REBUILD_COST")); assert.ok(codes.has("GEAR_UNDERCUT_RISK")); assert.ok(codes.has("CABLE_BEND_RADIUS"));
  assert.ok(codes.has("MATERIAL_MISSING")); assert.ok(report.score<100);
});
