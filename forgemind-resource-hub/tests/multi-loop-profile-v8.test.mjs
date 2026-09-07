import test from "node:test";
import assert from "node:assert/strict";
import { buildSketchProfiles } from "../core/sketch/SketchProfile.ts";
import { extrudeClosedProfile } from "../core/evaluation/ProfileExtrusion.ts";
import { createImportedPrismaticReconstruction } from "../core/direct-edit/ImportedPrismaticReconstruction.ts";
import { createCadDocument } from "../core/cad/CadDocument.ts";
import { createCadBody } from "../core/cad/CadBodies.ts";

const rectangle=(id,w,h)=>({
  [`${id}a`]:{id:`${id}a`,type:"line",start:{x:-w/2,y:-h/2},end:{x:w/2,y:-h/2},construction:false},
  [`${id}b`]:{id:`${id}b`,type:"line",start:{x:w/2,y:-h/2},end:{x:w/2,y:h/2},construction:false},
  [`${id}c`]:{id:`${id}c`,type:"line",start:{x:w/2,y:h/2},end:{x:-w/2,y:h/2},construction:false},
  [`${id}d`]:{id:`${id}d`,type:"line",start:{x:-w/2,y:h/2},end:{x:-w/2,y:-h/2},construction:false},
});

test("V8 Sketch Profile Builder nests an inner circle as a true exact hole",()=>{
  const outer=rectangle("o",100,60);
  const sketch={id:"S",name:"S",plane:{type:"XY",offset:0},entities:{...outer,h:{id:"h",type:"circle",center:{x:0,y:0},radius:10,construction:false}},entityOrder:[...Object.keys(outer),"h"],constraints:{},dimensions:{}};
  const built=buildSketchProfiles(sketch);
  assert.equal(built.profiles.length,1);
  assert.equal(built.profiles[0].outer.length,4);
  assert.equal(built.profiles[0].holes.length,1);
  assert.equal(built.profiles[0].holes[0][0].type,"circle");
  assert.equal(built.profiles[0].holes[0][0].radius,10);
});

test("V8 nesting parity keeps an island inside a hole as a separate material profile",()=>{
  const outer=rectangle("o",100,100), middle=rectangle("m",60,60), island=rectangle("i",20,20);
  const entities={...outer,...middle,...island};
  const sketch={id:"S",name:"S",plane:{type:"XY",offset:0},entities,entityOrder:Object.keys(entities),constraints:{},dimensions:{}};
  const built=buildSketchProfiles(sketch);
  assert.equal(built.profiles.length,2);
  const primary=built.profiles.find((profile)=>profile.holes.length===1);
  const recoveredIsland=built.profiles.find((profile)=>profile.holes.length===0);
  assert.ok(primary);
  assert.ok(recoveredIsland);
});

test("V8 exact multi-loop extrusion builds outer and hole prisms then Boolean-cuts them",async()=>{
  const calls=[]; let next=0;
  const kernel={
    extrude:async(input,options)=>{calls.push(["extrude",input.profile.id,options.distanceMm]);return{id:`s${++next}`,revision:1};},
    booleanCut:async(target,tools)=>{calls.push(["cut",target.id,tools.map((tool)=>tool.id)]);return{id:`s${++next}`,revision:1};},
    disposeShape:async(shape)=>{calls.push(["dispose",shape.id]);},
  };
  const profile={id:"ring",outer:[{type:"circle",center:[0,0],radius:20}],holes:[[{type:"circle",center:[0,0],radius:10}]]};
  const plane={origin:{x:0,y:0,z:0},xAxis:{x:1,y:0,z:0},yAxis:{x:0,y:1,z:0},normal:{x:0,y:0,z:1}};
  const result=await extrudeClosedProfile(kernel,profile,plane,{distanceMm:12,direction:"positive"});
  assert.equal(result.id,"s3");
  assert.deepEqual(calls.slice(0,3),[["extrude","ring:outer",12],["extrude","ring:hole:1",12],["cut","s1",["s2"]]]);
  assert.ok(calls.some((entry)=>entry[0]==="dispose"&&entry[1]==="s1"));
  assert.ok(calls.some((entry)=>entry[0]==="dispose"&&entry[1]==="s2"));
});

const persistent=(id)=>({version:2,sourceFeatureId:"Imported01",kind:"face",signature:{kind:"face",surfaceType:"plane",normal:{x:0,y:0,z:1},normalizedCenter:{x:id.length/10,y:0,z:0},boundaryEdgeCount:4}});
const makeDoc=()=>createCadDocument({id:"doc",name:"doc",bodies:{Body1:{...createCadBody("Body1"),tipFeatureId:"Imported01"}},activeBodyId:"Body1",features:{Imported01:{id:"Imported01",name:"Imported",type:"importedStep",bodyId:"Body1",stepAssetId:"asset",solidOrdinal:0,sourceSignature:{sizeBytes:4,hash32:"abcd"},enabled:true,state:"clean",dependencies:[]}},featureOrder:["Imported01"]});

test("V8 imported prismatic reconstruction preserves exact inner loops in the recovered Sketch",()=>{
  const profile={id:"cap",outer:[{type:"line",start:[-20,-20],end:[20,-20]},{type:"line",start:[20,-20],end:[20,20]},{type:"line",start:[20,20],end:[-20,20]},{type:"line",start:[-20,20],end:[-20,-20]}],holes:[[{type:"circle",center:[0,0],radius:5}]]};
  const result=createImportedPrismaticReconstruction({document:makeDoc(),bodyId:"Body1",targetFeatureId:"Imported01",capFace:persistent("cap"),featureFaces:[persistent("cap"),persistent("s1"),persistent("s2"),persistent("s3")],profile,classification:"boss",depthMm:10,direction:"negative",sourceLabel:"Boss with bore"});
  const sketch=result.document.sketches[result.sketchId];
  assert.equal(sketch.entityOrder.length,5);
  const built=buildSketchProfiles(sketch);
  assert.equal(built.profiles.length,1);
  assert.equal(built.profiles[0].holes.length,1);
  assert.equal(result.document.features[result.reconstructedFeatureId].operation,"add");
});
