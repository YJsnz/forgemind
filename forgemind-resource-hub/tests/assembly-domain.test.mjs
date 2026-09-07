import assert from "node:assert/strict";
import { test } from "node:test";
import { createAssemblyDocument } from "../core/assembly/AssemblyDocument.ts";
import { addMate, duplicateComponent, insertComponent, removeComponent, removeComponentCascade, removeMate, renameComponent, setComponentGrounded, setComponentIsolation, setMateEnabled, updateComponentNominalPlacement, updateMate } from "../core/assembly/AssemblyOperations.ts";
import { createAssemblyHistory, commitAssemblyHistory, redoAssemblyHistory, undoAssemblyHistory } from "../core/assembly/AssemblyHistory.ts";
import { canonicalSerializeAssemblyDocument, deserializeAssemblyDocument, deserializeAssemblyProjectBundle, serializeAssemblyDocument, serializeAssemblyProjectBundle } from "../core/assembly/AssemblyPersistence.ts";
import { createAssemblyRuntimeState, solveAssembly, solveAssemblyRuntime, componentAngularDriftDeg, componentTranslationDriftMm } from "../core/assembly/AssemblySolver.ts";
import { eulerDegreesFromQuaternion, quaternionFromAxisAngle, quaternionFromEulerDegrees, transformDirection } from "../core/assembly/RigidTransform.ts";
import { analyzeAssemblyEngineering } from "../core/assembly/AssemblyEngineering.ts";

const identity = () => ({ translationMm: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } });
const placement = (x=0,y=0,z=0) => ({ translationMm:{x,y,z}, rotation:{x:0,y:0,z:0,w:1} });
const component = (id, definitionId="part", p=identity(), grounded=false) => ({ id, name:id, definitionId, nominalPlacement:p, grounded, visible:true });
const topo = (instanceId, key) => ({ instanceId, bodyId:"Body01", topologyRef:{ version:2, sourceFeatureId:key, kind:"face", signature:{ kind:"face", surfaceType:"plane", normalizedCenter:{x:.5,y:.5,z:.5} } } });
const provider = (entries) => ({ async resolve(ref){ const value=entries.get(`${ref.instanceId}:${ref.topologyRef.sourceFeatureId}`); if(!value) throw Object.assign(new Error("missing reference"),{code:"MATE_REFERENCE_LOST"}); return structuredClone(value); } });
const plane = (pointMm, normal) => ({ kind:"plane", pointMm, normal });
const cylinder = (axisOriginMm, axisDirection, radiusMm=10) => ({ kind:"cylinder", axisOriginMm, axisDirection, radiusMm });
const close = (actual, expected, tolerance=1e-5) => assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} != ${expected}`);

const baseAssembly = () => {
  let doc=createAssemblyDocument({id:"assembly",name:"Assembly",updatedAt:0});
  doc=insertComponent(doc,component("Base","base",identity(),true));
  doc=insertComponent(doc,component("Moving","moving",placement(30,20,50),false));
  return doc;
};
const geometries = () => new Map([
  ["Base:top",plane({x:0,y:0,z:0},{x:0,y:0,z:1})],
  ["Moving:bottom",plane({x:0,y:0,z:0},{x:0,y:0,z:-1})],
  ["Base:cyl",cylinder({x:0,y:0,z:0},{x:0,y:0,z:1},10)],
  ["Moving:cyl",cylinder({x:0,y:0,z:0},{x:0,y:0,z:1},12)],
  ["Base:xplane",plane({x:0,y:0,z:0},{x:1,y:0,z:0})],
  ["Moving:xplane",plane({x:0,y:0,z:0},{x:1,y:0,z:0})],
]);

const coincident = {id:"Coincident",name:"Coincident",type:"coincident",enabled:true,a:topo("Base","top"),b:topo("Moving","bottom"),alignment:"opposite"};
const concentric = {id:"Concentric",name:"Concentric",type:"concentric",enabled:true,a:topo("Base","cyl"),b:topo("Moving","cyl")};

test("AssemblyDocument keeps stable component identity and design-only serialization",()=>{
  let doc=baseAssembly(); const before=doc.components.Moving.id;
  doc=renameComponent(doc,"Moving","Bracket"); doc=updateComponentNominalPlacement(doc,"Moving",placement(1,2,3));
  assert.equal(doc.components.Moving.id,before); assert.equal(doc.components.Moving.name,"Bracket");
  const polluted=structuredClone(doc); polluted.components.Moving.solvedPlacement={runtime:true}; polluted.runtimeShape={id:"shape"};
  const serialized=serializeAssemblyDocument(polluted); assert.equal("solvedPlacement" in serialized.components.Moving,false); assert.equal("runtimeShape" in serialized,false);
  assert.deepEqual(deserializeAssemblyDocument(serialized),serialized);
});

test("free component has DOF 6 and grounded component has DOF 0",async()=>{
  let free=createAssemblyDocument({id:"free",name:"Free",updatedAt:0}); free=insertComponent(free,component("A"));
  assert.equal((await solveAssembly(free,provider(new Map()))).dof,6);
  free=setComponentGrounded(free,"A",true); const fixed=await solveAssembly(free,provider(new Map())); assert.equal(fixed.dof,0); assert.equal(fixed.success,true);
});

test("planar Coincident solves exact plane and leaves three DOF",async()=>{
  let doc=baseAssembly(); doc=addMate(doc,coincident); const result=await solveAssembly(doc,provider(geometries()));
  assert.equal(result.success,true); assert.equal(result.dof,3); close(result.placements.get("Moving").translationMm.z,0,1e-5);
});

test("Concentric solves axis offset and leaves axial translation plus spin",async()=>{
  let doc=baseAssembly(); doc=addMate(doc,concentric); const result=await solveAssembly(doc,provider(geometries()));
  assert.equal(result.success,true); assert.equal(result.dof,2); close(result.placements.get("Moving").translationMm.x,0); close(result.placements.get("Moving").translationMm.y,0); close(result.placements.get("Moving").translationMm.z,50);
});

test("Concentric plus Coincident leaves one rotational DOF",async()=>{
  let doc=baseAssembly(); doc=addMate(doc,concentric); doc=addMate(doc,coincident); const result=await solveAssembly(doc,provider(geometries()));
  assert.equal(result.success,true); assert.equal(result.dof,1); close(result.placements.get("Moving").translationMm.x,0); close(result.placements.get("Moving").translationMm.y,0); close(result.placements.get("Moving").translationMm.z,0);
});

test("Angle mate removes final spin and reaches DOF zero",async()=>{
  let doc=baseAssembly(); doc.components.Moving={...doc.components.Moving,nominalPlacement:{translationMm:{x:30,y:20,z:50},rotation:quaternionFromAxisAngle({x:0,y:0,z:1},Math.PI/4)}};
  doc=addMate(doc,concentric); doc=addMate(doc,coincident); doc=addMate(doc,{id:"Angle",name:"Angle",type:"angle",enabled:true,a:topo("Base","xplane"),b:topo("Moving","xplane"),angleDeg:0});
  const result=await solveAssembly(doc,provider(geometries())); assert.equal(result.success,true); assert.equal(result.dof,0); assert.ok(result.residualNorm<1e-5);
});

test("Distance Mate re-solves 10 to 30 mm",async()=>{
  let doc=baseAssembly(); const distance=(value)=>({id:"Distance",name:"Distance",type:"distance",enabled:true,a:topo("Base","top"),b:topo("Moving","bottom"),alignment:"opposite",distanceMm:value}); doc=addMate(doc,distance(10));
  let result=await solveAssembly(doc,provider(geometries())); assert.equal(result.success,true); close(result.placements.get("Moving").translationMm.z,10);
  doc={...doc,mates:{...doc.mates,Distance:distance(30)}}; result=await solveAssembly(doc,provider(geometries()),result.placements); assert.equal(result.success,true); close(result.placements.get("Moving").translationMm.z,30);
});

test("conflicting Distance Mates preserve runtime last-good placement transactionally",async()=>{
  let doc=baseAssembly(); doc=addMate(doc,{id:"D10",name:"D10",type:"distance",enabled:true,a:topo("Base","top"),b:topo("Moving","bottom"),alignment:"opposite",distanceMm:10}); const runtime=createAssemblyRuntimeState(doc); const first=await solveAssemblyRuntime(doc,provider(geometries()),runtime); assert.equal(first.success,true); const lastGood=structuredClone(runtime.solvedPlacements.get("Moving"));
  doc=addMate(doc,{id:"D30",name:"D30",type:"distance",enabled:true,a:topo("Base","top"),b:topo("Moving","bottom"),alignment:"opposite",distanceMm:30}); const conflict=await solveAssemblyRuntime(doc,provider(geometries()),runtime); assert.equal(conflict.success,false); assert.equal(runtime.status,"conflict"); close(runtime.solvedPlacements.get("Moving").translationMm.z,lastGood.translationMm.z);
});

test("AssemblyHistory restores component and Mate design state without runtime data",()=>{
  const initial=createAssemblyDocument({id:"history",name:"History",updatedAt:0}); let doc=insertComponent(initial,component("A")); let history=commitAssemblyHistory(createAssemblyHistory(initial),doc); doc=setComponentGrounded(doc,"A",true); history=commitAssemblyHistory(history,doc); doc=insertComponent(doc,component("B")); doc=addMate(doc,{id:"F",name:"Fixed",type:"fixed",enabled:true,componentId:"B",lockedPlacement:identity()}); history=commitAssemblyHistory(history,doc);
  let transition=undoAssemblyHistory(history); assert.ok(transition); assert.equal(transition.document.components.B,undefined); transition=undoAssemblyHistory(transition.history); assert.ok(transition); assert.equal(transition.document.components.A.grounded,false); const redone=redoAssemblyHistory(transition.history); assert.ok(redone); assert.equal(redone.document.components.A.grounded,true); assert.equal(canonicalSerializeAssemblyDocument(redone.document).includes("solvedPlacement"),false);
});

test("same Part definition instances keep independent nominal and solved placements",async()=>{
  let doc=createAssemblyDocument({id:"instances",name:"Instances",updatedAt:0}); doc=insertComponent(doc,component("A","shared",placement(0,0,0))); doc=insertComponent(doc,component("B","shared",placement(100,0,0))); const result=await solveAssembly(doc,provider(new Map())); assert.equal(result.dof,12); close(result.placements.get("A").translationMm.x,0); close(result.placements.get("B").translationMm.x,100);
});

test("100 repeated solves have no placement drift",async()=>{
  let doc=baseAssembly(); doc=addMate(doc,concentric); doc=addMate(doc,coincident); const runtime=createAssemblyRuntimeState(doc); const first=await solveAssemblyRuntime(doc,provider(geometries()),runtime); assert.equal(first.success,true); const reference=structuredClone(runtime.solvedPlacements.get("Moving")); for(let i=0;i<100;i+=1){const result=await solveAssemblyRuntime(doc,provider(geometries()),runtime); assert.equal(result.success,true);} assert.ok(componentTranslationDriftMm(reference,runtime.solvedPlacements.get("Moving"))<1e-8); assert.ok(componentAngularDriftDeg(reference,runtime.solvedPlacements.get("Moving"))<1e-8);
});

test("Fixed Mate locks all six DOF without mutating nominal placement",async()=>{
  let doc=createAssemblyDocument({id:"fixed",name:"Fixed",updatedAt:0}); doc=insertComponent(doc,component("A","part",placement(12,8,4))); doc=addMate(doc,{id:"FixedMate",name:"FixedMate",type:"fixed",enabled:true,componentId:"A",lockedPlacement:placement(12,8,4)}); const result=await solveAssembly(doc,provider(new Map())); assert.equal(result.success,true); assert.equal(result.dof,0); close(result.placements.get("A").translationMm.x,12);
});

test("component deletion is rejected while referenced by a Mate",async()=>{
  const { removeComponent } = await import("../core/assembly/AssemblyOperations.ts"); let doc=baseAssembly(); doc=addMate(doc,coincident); assert.throws(()=>removeComponent(doc,"Moving"),(error)=>error.code==="COMPONENT_IN_USE_BY_MATE");
});

test("Mate suppression returns constrained DOF to the free component",async()=>{
  const { setMateEnabled } = await import("../core/assembly/AssemblyOperations.ts"); let doc=baseAssembly(); doc=addMate(doc,coincident); assert.equal((await solveAssembly(doc,provider(geometries()))).dof,3); doc=setMateEnabled(doc,"Coincident",false); assert.equal((await solveAssembly(doc,provider(geometries()))).dof,6);
});

test("manual nominal placement is the deterministic initial placement on every solve",async()=>{
  let doc=createAssemblyDocument({id:"nominal",name:"Nominal",updatedAt:0}); doc=insertComponent(doc,component("A","part",placement(0,0,0))); const runtime=createAssemblyRuntimeState(doc); await solveAssemblyRuntime(doc,provider(new Map()),runtime); doc=updateComponentNominalPlacement(doc,"A",placement(75,25,10)); await solveAssemblyRuntime(doc,provider(new Map()),runtime); assert.deepEqual(runtime.solvedPlacements.get("A").translationMm,{x:75,y:25,z:10});
});

test("AssemblyHistory ignores commits that only change updatedAt",()=>{
  const doc=createAssemblyDocument({id:"dedup",name:"Dedup",updatedAt:1}),history=createAssemblyHistory(doc),candidate={...doc,updatedAt:999}; const committed=commitAssemblyHistory(history,candidate); assert.equal(committed.past.length,0); assert.equal(committed,history);
});

test("50 insert/delete design cycles do not accumulate Components",async()=>{
  const { removeComponent } = await import("../core/assembly/AssemblyOperations.ts"); let doc=createAssemblyDocument({id:"cycles",name:"Cycles",updatedAt:0}); for(let i=0;i<50;i++){const id=`I${i}`;doc=insertComponent(doc,component(id));doc=removeComponent(doc,id);} assert.equal(doc.componentOrder.length,0); assert.deepEqual(doc.components,{});
});

test("50 solver cycles keep exact last-good placement and zero drift",async()=>{
  let doc=baseAssembly(); doc=addMate(doc,concentric); doc=addMate(doc,coincident); const runtime=createAssemblyRuntimeState(doc); await solveAssemblyRuntime(doc,provider(geometries()),runtime); const reference=structuredClone(runtime.solvedPlacements.get("Moving")); for(let i=0;i<50;i++){const result=await solveAssemblyRuntime(doc,provider(geometries()),runtime); assert.equal(result.success,true);} assert.ok(componentTranslationDriftMm(reference,runtime.solvedPlacements.get("Moving"))<1e-10); assert.ok(componentAngularDriftDeg(reference,runtime.solvedPlacements.get("Moving"))<1e-10);
});


test("UI Euler display conversion roundtrips the Assembly quaternion design truth",()=>{
  const q=quaternionFromEulerDegrees(20,-35,70),e=eulerDegreesFromQuaternion(q),roundtrip=quaternionFromEulerDegrees(e.xDeg,e.yDeg,e.zDeg);
  assert.ok(componentAngularDriftDeg({translationMm:{x:0,y:0,z:0},rotation:q},{translationMm:{x:0,y:0,z:0},rotation:roundtrip})<1e-9);
});

test("component rename, ground, placement and delete restore through AssemblyHistory",()=>{
  const initial=createAssemblyDocument({id:"component-history",name:"Component History",updatedAt:0});
  let doc=insertComponent(initial,component("A","part",placement(1,2,3))); let history=commitAssemblyHistory(createAssemblyHistory(initial),doc);
  doc=renameComponent(doc,"A","Bracket"); history=commitAssemblyHistory(history,doc);
  doc=setComponentGrounded(doc,"A",true); history=commitAssemblyHistory(history,doc);
  doc=updateComponentNominalPlacement(doc,"A",placement(10,20,30)); history=commitAssemblyHistory(history,doc);
  doc=removeComponent(doc,"A"); history=commitAssemblyHistory(history,doc);
  let transition=undoAssemblyHistory(history); assert.ok(transition); assert.equal(transition.document.components.A.name,"Bracket"); assert.equal(transition.document.components.A.grounded,true); assert.deepEqual(transition.document.components.A.nominalPlacement.translationMm,{x:10,y:20,z:30});
  transition=undoAssemblyHistory(transition.history); assert.ok(transition); assert.deepEqual(transition.document.components.A.nominalPlacement.translationMm,{x:1,y:2,z:3});
  transition=undoAssemblyHistory(transition.history); assert.ok(transition); assert.equal(transition.document.components.A.grounded,false);
  transition=undoAssemblyHistory(transition.history); assert.ok(transition); assert.equal(transition.document.components.A.name,"A");
});

test("Mate add, parameter edit, suppression and delete are design-history edits",()=>{
  let doc=baseAssembly(),history=createAssemblyHistory(doc);
  const distance=(mm)=>({id:"Distance",name:"Distance",type:"distance",enabled:true,a:topo("Base","top"),b:topo("Moving","bottom"),alignment:"opposite",distanceMm:mm});
  doc=addMate(doc,distance(10)); history=commitAssemblyHistory(history,doc);
  doc=updateMate(doc,distance(30)); history=commitAssemblyHistory(history,doc);
  doc=setMateEnabled(doc,"Distance",false); history=commitAssemblyHistory(history,doc);
  doc=removeMate(doc,"Distance"); history=commitAssemblyHistory(history,doc);
  let t=undoAssemblyHistory(history); assert.ok(t); assert.equal(t.document.mates.Distance.enabled,false);
  t=undoAssemblyHistory(t.history); assert.ok(t); assert.equal(t.document.mates.Distance.enabled,true); assert.equal(t.document.mates.Distance.distanceMm,30);
  t=undoAssemblyHistory(t.history); assert.ok(t); assert.equal(t.document.mates.Distance.distanceMm,10);
});

test("Assembly persistence rejects future schemas and broken component references",()=>{
  const doc=baseAssembly(); const future=serializeAssemblyDocument(doc); future.schemaVersion=999; assert.throws(()=>deserializeAssemblyDocument(future),(error)=>error.code==="ASSEMBLY_DOCUMENT_VERSION_UNSUPPORTED");
  let withMate=addMate(doc,coincident); const broken=serializeAssemblyDocument(withMate); delete broken.components.Moving; broken.componentOrder=broken.componentOrder.filter((id)=>id!=="Moving"); assert.throws(()=>deserializeAssemblyDocument(broken),(error)=>error.code==="ASSEMBLY_DOCUMENT_INVALID");
});

test("Assembly project bundle refuses a Component whose PartDefinition is missing",()=>{
  const doc=insertComponent(createAssemblyDocument({id:"missing-def",name:"Missing",updatedAt:0}),component("A","NoSuchDefinition"));
  const empty={definitions:new Map()}; assert.throws(()=>serializeAssemblyProjectBundle(doc,empty),(error)=>error.code==="ASSEMBLY_DEFINITION_MISSING");
  const bundle={version:1,assembly:serializeAssemblyDocument(doc),definitions:[]}; assert.throws(()=>deserializeAssemblyProjectBundle(bundle),(error)=>error.code==="ASSEMBLY_DEFINITION_MISSING");
});

test("lost Mate references degrade safely instead of corrupting other Component placements",async()=>{
  let doc=baseAssembly(); doc=addMate(doc,coincident); const runtime=createAssemblyRuntimeState(doc); const result=await solveAssemblyRuntime(doc,provider(new Map()),runtime);
  assert.equal(result.success,true); assert.equal(result.status,"degraded"); assert.equal(result.diagnostics[0]?.code,"MATE_REFERENCE_LOST"); assert.deepEqual(runtime.solvedPlacements.get("Moving").translationMm,{x:30,y:20,z:50});
});

test("invalid Mate inputs are rejected before the solver",()=>{
  let doc=baseAssembly();
  assert.throws(()=>addMate(doc,{...coincident,id:"Self",a:topo("Moving","top"),b:topo("Moving","bottom")}), (error)=>error.code==="MATE_SAME_COMPONENT_UNSUPPORTED");
  assert.throws(()=>addMate(doc,{id:"AngleBad",name:"AngleBad",type:"angle",enabled:true,a:topo("Base","top"),b:topo("Moving","bottom"),angleDeg:181}), (error)=>error.code==="MATE_ANGLE_INVALID");
  assert.throws(()=>addMate(doc,{id:"DistanceBad",name:"DistanceBad",type:"distance",enabled:true,a:topo("Base","top"),b:topo("Moving","bottom"),alignment:"opposite",distanceMm:Number.NaN}), (error)=>error.code==="MATE_DISTANCE_INVALID");
});


test("Coincident opposite alignment does not falsely accept same-direction Face normals",async()=>{
  let doc=baseAssembly(); const sameNormalGeometry=geometries(); sameNormalGeometry.set("Moving:bottom",plane({x:0,y:0,z:0},{x:0,y:0,z:1})); doc=addMate(doc,coincident);
  const result=await solveAssembly(doc,provider(sameNormalGeometry)); assert.equal(result.success,true); assert.equal(result.dof,3);
  const worldNormal=transformDirection(result.placements.get("Moving"),{x:0,y:0,z:1}); assert.ok(worldNormal.z < -0.999999,`Expected opposite normal, got ${JSON.stringify(worldNormal)}`);
});

test("engineering review finds floating groups, isolated components and a usable BOM",()=>{
  let doc=createAssemblyDocument({id:"review",name:"Review",updatedAt:0});doc=insertComponent(doc,component("Base","frame",identity(),true));doc=insertComponent(doc,component("A","bracket"));doc=insertComponent(doc,component("B","bracket"));
  const report=analyzeAssemblyEngineering(doc,{status:"under-constrained",dof:12,diagnostics:[]},new Map([["frame","机架"],["bracket","支架"]]));
  assert.equal(report.ready,true);assert.equal(report.groups.length,3);assert.equal(report.bom.find((row)=>row.definitionId==="bracket").instanceCount,2);assert.ok(report.issues.some((issue)=>issue.code==="ISOLATED_COMPONENT"));assert.ok(report.issues.some((issue)=>issue.code==="UNRESOLVED_DOF"));
});

test("engineering component operations duplicate, isolate and cascade-delete as design edits",()=>{
  let doc=baseAssembly();doc=addMate(doc,coincident);doc=duplicateComponent(doc,"Moving","Moving2");assert.equal(doc.components.Moving2.definitionId,"moving");assert.notEqual(doc.components.Moving2.nominalPlacement.translationMm.x,doc.components.Moving.nominalPlacement.translationMm.x);
  doc=setComponentIsolation(doc,"Moving2");assert.equal(doc.components.Moving2.visible,true);assert.equal(doc.components.Base.visible,false);
  doc=setComponentIsolation(doc);assert.ok(doc.componentOrder.every((id)=>doc.components[id].visible));
  doc=removeComponentCascade(doc,"Moving");assert.equal(doc.components.Moving,undefined);assert.equal(doc.mates.Coincident,undefined);
});
