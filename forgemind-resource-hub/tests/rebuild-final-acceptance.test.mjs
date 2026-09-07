import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { createCadDocument, toSerializableCadDocument } from "../core/cad/CadDocument.ts";
import { DEFAULT_CAD_TOLERANCE } from "../core/cad/Tolerance.ts";
import { createCadRuntimeState, disposeCadRuntimeState, getRuntimeFeatureShape } from "../core/evaluation/CadRuntimeState.ts";
import { OcctKernel } from "../core/kernel/OcctKernel.ts";
import { rebuildDocument } from "../core/rebuild/RebuildEngine.ts";
import { createRebuildRuntimeState } from "../core/rebuild/RebuildTypes.ts";
import { buildSketchProfiles } from "../core/sketch/SketchProfile.ts";
import { capturePersistentTopologyRef } from "../core/topology/TopologyResolver.ts";

const wasm = new URL("../node_modules/occt-wasm/dist/occt-wasm.wasm", import.meta.url); let kernel;
const rectangle = (id, width) => ({ id, name:id, plane:{type:"XY",offset:0}, entities:{ a:{id:"a",type:"line",start:{x:0,y:0},end:{x:width,y:0},construction:false}, b:{id:"b",type:"line",start:{x:width,y:0},end:{x:width,y:60},construction:false}, c:{id:"c",type:"line",start:{x:width,y:60},end:{x:0,y:60},construction:false}, d:{id:"d",type:"line",start:{x:0,y:60},end:{x:0,y:0},construction:false} }, entityOrder:["a","b","c","d"],constraints:{},dimensions:{} });
const torusSketch = () => ({id:"Sketch99",name:"Sketch99",plane:{type:"XY",offset:0},entities:{circle:{id:"circle",type:"circle",center:{x:30,y:0},radius:10,construction:false}},entityOrder:["circle"],constraints:{},dimensions:{}});
const baseFeature = () => ({id:"Extrude01",name:"Extrude01",type:"extrude",sketchId:"Sketch01",distance:20,direction:"positive",operation:"new",enabled:true,state:"clean",dependencies:[]});
const doc = ({width=100,hole=10,fillet=3,topRef,edgeRef,branch=false}={}) => {
  const features={Extrude01:baseFeature()}; const sketches={Sketch01:rectangle("Sketch01",width)}; const order=["Extrude01"];
  if(topRef){features.Hole01={id:"Hole01",name:"Hole01",type:"hole",targetFeatureId:"Extrude01",targetFace:topRef,center:{x:0,y:0},diameterMm:hole,depth:{type:"throughAll"},enabled:true,state:"clean",dependencies:["Extrude01"]};order.push("Hole01");}
  if(edgeRef){features.Fillet01={id:"Fillet01",name:"Fillet01",type:"fillet",targetFeatureId:"Hole01",edges:[edgeRef],radiusMm:fillet,enabled:true,state:"clean",dependencies:["Hole01"]};order.push("Fillet01");}
  if(branch){sketches.Sketch99=torusSketch();features.Revolve99={id:"Revolve99",name:"Revolve99",type:"revolve",sketchId:"Sketch99",axis:{origin:{x:0,y:0,z:0},direction:{x:0,y:1,z:0}},angleDeg:360,operation:"new",enabled:true,state:"clean",dependencies:[]};order.push("Revolve99");}
  return createCadDocument({id:"m10d",name:"M10-D",sketches,features,featureOrder:order});
};
const ctx=(document,runtime,state)=>({document,runtime,rebuildRuntime:state,kernel,tolerance:DEFAULT_CAD_TOLERANCE,buildProfiles:buildSketchProfiles});
const ids=(runtime)=>Object.fromEntries(["Extrude01","Hole01","Fillet01","Revolve99"].map(id=>[id,runtime.featureShapes.get(id)?.id]));

const references = async () => {
  const runtime=createCadRuntimeState(), state=createRebuildRuntimeState();
  try {
    const first=doc(); assert.equal((await rebuildDocument(ctx(first,runtime,state),{full:true})).success,true);
    const top=(await kernel.getFaces(runtime.featureShapes.get("Extrude01"))).find(face=>face.normal?.z>.999);
    const topRef=await capturePersistentTopologyRef("Extrude01",top.topology,runtime,kernel);
    const withHole=doc({topRef}); assert.equal((await rebuildDocument(ctx(withHole,runtime,state),{full:true})).success,true);
    const edge=(await kernel.getEdges(runtime.featureShapes.get("Hole01"))).find(edge=>edge.curveType==="line"&&Math.abs((edge.endMm?.z??0)-(edge.startMm?.z??0))>19);
    return {topRef,edgeRef:await capturePersistentTopologyRef("Hole01",edge.topology,runtime,kernel)};
  } finally { await disposeCadRuntimeState(runtime,kernel); }
};

before(async()=>{kernel=new OcctKernel({wasm});await kernel.init();});
after(async()=>kernel?.dispose());

test("M10-D automatic full chain, staged propagation, incremental branches and tessellation", async () => {
  const refs=await references(), runtime=createCadRuntimeState(), state=createRebuildRuntimeState();
  try {
    let current=doc({...refs,branch:true}); let result=await rebuildDocument(ctx(current,runtime,state),{full:true});
    assert.equal(result.success,true,JSON.stringify(result.errors)); assert.deepEqual(result.evaluatedFeatureIds,["Extrude01","Hole01","Fillet01","Revolve99"]);
    const final=getRuntimeFeatureShape(runtime,"Fillet01"); assert.equal((await kernel.validate(final)).valid,true);
    const mesh=await kernel.tessellate(final,{linearDeflectionMm:.2,angularDeflectionDeg:2}); assert.ok(mesh.indices.length>0);assert.equal(mesh.indices.length/3,mesh.triangleFaceIndices.length);assert.ok(mesh.faces.length>0);
    const initial=ids(runtime), revolve=initial.Revolve99;
    current=doc({width:150,...refs,branch:true}); result=await rebuildDocument(ctx(current,runtime,state),{changedSketchIds:["Sketch01"]});
    assert.equal(result.success,true,JSON.stringify(result.errors));assert.deepEqual(result.evaluatedFeatureIds,["Extrude01","Hole01","Fillet01"]);assert.equal(runtime.featureShapes.get("Revolve99").id,revolve);
    const afterWidth=ids(runtime); assert.notEqual(afterWidth.Extrude01,initial.Extrude01);assert.notEqual(afterWidth.Hole01,initial.Hole01);assert.notEqual(afterWidth.Fillet01,initial.Fillet01);
    current=doc({width:150,hole:20,...refs,branch:true}); result=await rebuildDocument(ctx(current,runtime,state),{changedFeatureIds:["Hole01"]});
    assert.equal(result.success,true,JSON.stringify(result.errors));assert.deepEqual(result.evaluatedFeatureIds,["Hole01","Fillet01"]);assert.equal(runtime.featureShapes.get("Extrude01").id,afterWidth.Extrude01);const afterHole=ids(runtime);assert.notEqual(afterHole.Hole01,afterWidth.Hole01);assert.notEqual(afterHole.Fillet01,afterWidth.Fillet01);
    current=doc({width:150,hole:20,fillet:5,...refs,branch:true}); result=await rebuildDocument(ctx(current,runtime,state),{changedFeatureIds:["Fillet01"]});
    assert.equal(result.success,true,JSON.stringify(result.errors));assert.deepEqual(result.evaluatedFeatureIds,["Fillet01"]);assert.equal(runtime.featureShapes.get("Extrude01").id,afterHole.Extrude01);assert.equal(runtime.featureShapes.get("Hole01").id,afterHole.Hole01);assert.notEqual(runtime.featureShapes.get("Fillet01").id,afterHole.Fillet01);
  } finally {await disposeCadRuntimeState(runtime,kernel);}
});

test("M10-D rollback, recovery, suppression aliases, save/load and undo restore", async () => {
  const refs=await references(), runtime=createCadRuntimeState(), state=createRebuildRuntimeState();
  try {
    let current=doc({...refs}); assert.equal((await rebuildDocument(ctx(current,runtime,state),{full:true})).success,true); const good=ids(runtime); const jsonA=JSON.stringify(toSerializableCadDocument(current));
    const invalid=doc({width:150,hole:10,fillet:1000,...refs}); let result=await rebuildDocument(ctx(invalid,runtime,state),{changedSketchIds:["Sketch01"]});
    assert.equal(result.success,false);assert.deepEqual(result.evaluatedFeatureIds,["Extrude01","Hole01"]);assert.deepEqual(result.failedFeatureIds,["Fillet01"]);assert.deepEqual(ids(runtime),good);assert.equal(state.documentStatus,"last-good");assert.equal(getRuntimeFeatureShape(runtime,"Fillet01").id,good.Fillet01);
    current=doc({width:150,hole:10,fillet:5,...refs}); result=await rebuildDocument(ctx(current,runtime,state),{changedSketchIds:["Sketch01"]});assert.equal(result.success,true,JSON.stringify(result.errors));assert.equal(state.documentStatus,"current");
    current.features.Hole01={...current.features.Hole01,enabled:false,state:"suppressed"}; result=await rebuildDocument(ctx(current,runtime,state),{changedFeatureIds:["Hole01"]});assert.equal(result.success,true,JSON.stringify(result.errors));assert.deepEqual(result.suppressedFeatureIds,["Hole01"]);assert.equal(runtime.featureShapes.has("Hole01"),false);assert.equal(runtime.featureAliases.get("Hole01"),"Extrude01");assert.equal(getRuntimeFeatureShape(runtime,"Hole01").id,runtime.featureShapes.get("Extrude01").id);
    current.features.Hole01={...current.features.Hole01,enabled:true,state:"clean"}; result=await rebuildDocument(ctx(current,runtime,state),{changedFeatureIds:["Hole01"]});assert.equal(result.success,true,JSON.stringify(result.errors));assert.deepEqual(result.evaluatedFeatureIds,["Hole01","Fillet01"]);assert.equal(runtime.featureShapes.has("Hole01"),true);
    current.features.Fillet01={...current.features.Fillet01,enabled:false,state:"suppressed"};result=await rebuildDocument(ctx(current,runtime,state),{changedFeatureIds:["Fillet01"]});assert.equal(result.success,true);assert.equal(runtime.featureShapes.has("Fillet01"),false);assert.equal(runtime.featureAliases.get("Fillet01"),"Hole01");assert.equal(getRuntimeFeatureShape(runtime,"Fillet01").id,getRuntimeFeatureShape(runtime,"Hole01").id);
    current.features.Extrude01={...current.features.Extrude01,enabled:false,state:"suppressed"};result=await rebuildDocument(ctx(current,runtime,state),{changedFeatureIds:["Extrude01"]});assert.equal(result.success,false);assert.deepEqual(result.blockedFeatureIds,["Extrude01","Hole01","Fillet01"]);assert.equal(state.documentStatus,"last-good");
    const saved=JSON.stringify(toSerializableCadDocument(doc({...refs})));assert.doesNotMatch(saved,/shape-|shapeRevision|face-\d|edge-\d|dirty|rebuilding|failed|blocked|aliases|last-good/i);
    await disposeCadRuntimeState(runtime,kernel);const restoredRuntime=createCadRuntimeState(),restoredState=createRebuildRuntimeState(),restored=JSON.parse(saved);assert.equal(restoredRuntime.featureShapes.size,0);assert.equal((await rebuildDocument(ctx(restored,restoredRuntime,restoredState),{full:true})).success,true);assert.equal((await kernel.validate(restoredRuntime.featureShapes.get("Fillet01"))).valid,true);await disposeCadRuntimeState(restoredRuntime,kernel);
    const undoRuntime=createCadRuntimeState(),undoState=createRebuildRuntimeState(),undo=JSON.parse(jsonA);assert.equal((await rebuildDocument(ctx(undo,undoRuntime,undoState),{full:true})).success,true);assert.equal((await kernel.getShapeProperties(undoRuntime.featureShapes.get("Fillet01"))).boundingBox.max.x,100);await disposeCadRuntimeState(undoRuntime,kernel);
  } finally { if(runtime.featureShapes.size||runtime.featureAliases.size) await disposeCadRuntimeState(runtime,kernel); }
});

test("M10-D runtime disposal releases aliases once and repeated rebuilds retain only active owned shapes", async () => {
  const refs=await references(), runtime=createCadRuntimeState(), state=createRebuildRuntimeState();
  const originalDispose=kernel.disposeShape.bind(kernel), releases=new Map(); kernel.disposeShape=async(shape)=>{releases.set(shape.id,(releases.get(shape.id)??0)+1);return originalDispose(shape);};
  try {
    let current=doc({...refs});assert.equal((await rebuildDocument(ctx(current,runtime,state),{full:true})).success,true);
    for(let index=0;index<30;index++){current=doc({width:index%2?100:150,...refs});const result=await rebuildDocument(ctx(current,runtime,state),{changedSketchIds:["Sketch01"]});assert.equal(result.success,true,JSON.stringify(result.errors));}
    assert.equal(runtime.featureShapes.size,3);current.features.Hole01={...current.features.Hole01,enabled:false,state:"suppressed"};assert.equal((await rebuildDocument(ctx(current,runtime,state),{changedFeatureIds:["Hole01"]})).success,true);assert.equal(runtime.featureShapes.size,2);assert.equal(runtime.featureAliases.size,1);assert.equal([...kernel.shapes.values()].filter(record=>!record.released).length,2);
  } finally {await disposeCadRuntimeState(runtime,kernel);kernel.disposeShape=originalDispose;assert.equal(runtime.featureShapes.size,0);assert.equal(runtime.featureAliases.size,0);assert.ok([...releases.values()].every(count=>count===1));}
});
