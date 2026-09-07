import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { createCadDocument } from "../core/cad/CadDocument.ts";
import { DEFAULT_CAD_TOLERANCE } from "../core/cad/Tolerance.ts";
import { createCadRuntimeState, disposeCadRuntimeState, replaceFeatureShape } from "../core/evaluation/CadRuntimeState.ts";
import { evaluateFeature } from "../core/evaluation/FeatureEvaluation.ts";
import { extrudeClosedProfile } from "../core/evaluation/ProfileExtrusion.ts";
import { applySolidFeatureOperation } from "../core/evaluation/SolidFeatureOperation.ts";
import { OcctKernel } from "../core/kernel/OcctKernel.ts";
import { buildSketchProfiles } from "../core/sketch/SketchProfile.ts";

const wasmUrl=new URL("../node_modules/occt-wasm/dist/occt-wasm.wasm",import.meta.url);
const plane={origin:{x:0,y:0,z:0},xAxis:{x:1,y:0,z:0},yAxis:{x:0,y:1,z:0},normal:{x:0,y:0,z:1}};
const rectangle=(id,width,height,offset=0)=>({id,name:id,plane:{type:"XY",offset},entities:{a:{id:"a",type:"line",start:{x:-width/2,y:-height/2},end:{x:width/2,y:-height/2},construction:false},b:{id:"b",type:"line",start:{x:width/2,y:-height/2},end:{x:width/2,y:height/2},construction:false},c:{id:"c",type:"line",start:{x:width/2,y:height/2},end:{x:-width/2,y:height/2},construction:false},d:{id:"d",type:"line",start:{x:-width/2,y:height/2},end:{x:-width/2,y:-height/2},construction:false}},entityOrder:["a","b","c","d"],constraints:{},dimensions:{}});
const circle=(id,x,radius,offset=0)=>({id,name:id,plane:{type:"XY",offset},entities:{c:{id:"c",type:"circle",center:{x,y:0},radius,construction:false}},entityOrder:["c"],constraints:{},dimensions:{}});
let kernel;
before(async()=>{kernel=new OcctKernel({wasm:wasmUrl});await kernel.init();});
after(async()=>{await kernel?.dispose();});

test("symmetric and unequal two-sided Extrude preserve exact requested extents",async()=>{
  const profile={id:"p",outer:[{type:"circle",center:[0,0],radius:10}],holes:[]};
  const symmetric=await extrudeClosedProfile(kernel,profile,plane,{distanceMm:20,direction:"symmetric"});
  const twoSided=await extrudeClosedProfile(kernel,profile,plane,{distanceMm:12,direction:"twoSided",secondDistanceMm:8});
  try{
    for(const shape of [symmetric,twoSided])assert.ok(Math.abs((await kernel.getShapeProperties(shape)).volumeMm3-Math.PI*100*20)<.02);
    const box=await kernel.getShapeProperties(twoSided);assert.ok(Math.abs(box.boundingBox.min.z+8)<1e-6);assert.ok(Math.abs(box.boundingBox.max.z-12)<1e-6);
  }finally{await kernel.disposeShape(symmetric);await kernel.disposeShape(twoSided);}
});

test("multiple material regions can be created together and one region can be selected",async()=>{
  const sketch={id:"Regions",name:"Regions",plane:{type:"XY",offset:0},entities:{a:{id:"a",type:"circle",center:{x:-20,y:0},radius:6,construction:false},b:{id:"b",type:"circle",center:{x:20,y:0},radius:8,construction:false}},entityOrder:["a","b"],constraints:{},dimensions:{}};
  const profiles=buildSketchProfiles(sketch).profiles;
  assert.equal(profiles.length,2);
  const document=createCadDocument({id:"regions",name:"regions",sketches:{Regions:sketch},features:{E:{id:"E",name:"E",type:"extrude",sketchId:"Regions",profileIds:[profiles[1].id],distance:10,direction:"positive",operation:"new",enabled:true,state:"clean",dependencies:[]}},featureOrder:["E"]});
  const runtime=createCadRuntimeState();
  try{const result=await evaluateFeature("E",{document,runtime,kernel,tolerance:DEFAULT_CAD_TOLERANCE,buildProfiles:buildSketchProfiles});assert.equal(result.status,"success",result.status==="failed"?result.error.message:"");if(result.status==="success"){assert.ok(Math.abs((await kernel.getShapeProperties(result.shape)).volumeMm3-Math.PI*64*10)<.02);await kernel.disposeShape(result.shape);}}
  finally{await disposeCadRuntimeState(runtime,kernel);}
});

test("Revolve add uses the same feature target and produces a valid combined B-Rep",async()=>{
  const baseSketch=rectangle("BaseSketch",100,100),toolSketch=circle("ToolSketch",30,10);
  const document=createCadDocument({id:"revolve-add",name:"revolve-add",sketches:{BaseSketch:baseSketch,ToolSketch:toolSketch},features:{Base:{id:"Base",name:"Base",type:"extrude",sketchId:"BaseSketch",distance:20,direction:"positive",operation:"new",bodyId:"Body",enabled:true,state:"clean",dependencies:[]},Revolve:{id:"Revolve",name:"Revolve add",type:"revolve",sketchId:"ToolSketch",axis:{origin:{x:0,y:0,z:0},direction:{x:0,y:1,z:0}},angleDeg:360,operation:"add",targetFeatureId:"Base",targetBodyId:"Body",bodyId:"Body",enabled:true,state:"clean",dependencies:["Base"]}},featureOrder:["Base","Revolve"],bodies:{Body:{id:"Body",name:"Body",visible:true,tipFeatureId:"Revolve"}},activeBodyId:"Body"});
  const runtime=createCadRuntimeState();
  try{
    const base=await evaluateFeature("Base",{document,runtime,kernel,tolerance:DEFAULT_CAD_TOLERANCE,buildProfiles:buildSketchProfiles});assert.equal(base.status,"success");if(base.status!=="success")return;await replaceFeatureShape(runtime,kernel,"Base",base.shape);
    const result=await evaluateFeature("Revolve",{document,runtime,kernel,tolerance:DEFAULT_CAD_TOLERANCE,buildProfiles:buildSketchProfiles});assert.equal(result.status,"success",result.status==="failed"?result.error.message:"");if(result.status==="success"){assert.equal((await kernel.validate(result.shape)).valid,true);assert.ok((await kernel.getShapeProperties(result.shape)).volumeMm3>200000);await kernel.disposeShape(result.shape);}
  }finally{await disposeCadRuntimeState(runtime,kernel);}
});

test("shared solid operation helper supports add, remove and intersect while releasing tools",async()=>{
  const base=await kernel.extrude({profile:{id:"base",outer:[{type:"circle",center:[0,0],radius:20}],holes:[]},plane},{distanceMm:20,direction:"positive"});
  try{
    for(const operation of ["add","remove","intersect"]){const tool=await kernel.extrude({profile:{id:`tool-${operation}`,outer:[{type:"circle",center:[10,0],radius:12}],holes:[]},plane},{distanceMm:20,direction:"positive"});const result=await applySolidFeatureOperation(kernel,[tool],operation,base);try{assert.equal((await kernel.validate(result)).valid,true);}finally{await kernel.disposeShape(result);}}
  }finally{await kernel.disposeShape(base);}
});
