import assert from "node:assert/strict";
import { test } from "node:test";
import { createAssemblyDocument } from "../core/assembly/AssemblyDocument.ts";
import { addMate, insertComponent } from "../core/assembly/AssemblyOperations.ts";
import { solveAssembly } from "../core/assembly/AssemblySolver.ts";
import { quaternionFromAxisAngle, transformDirection } from "../core/assembly/RigidTransform.ts";
import { snapPlacementByMateConnectors, transformMateConnectorFrame } from "../core/assembly/MateConnector.ts";

const identity=()=>({translationMm:{x:0,y:0,z:0},rotation:{x:0,y:0,z:0,w:1}});
const component=(id,p=identity(),grounded=false)=>({id,name:id,definitionId:`${id}Def`,nominalPlacement:p,grounded,visible:true});
const ref=(instanceId,connectorId="MC")=>({instanceId,connectorId});
const frame={originMm:{x:0,y:0,z:0},primaryAxis:{x:0,y:0,z:1},secondaryAxis:{x:1,y:0,z:0},tertiaryAxis:{x:0,y:1,z:0},sourceKind:"plane"};
const provider={async resolve(){throw new Error("topology geometry unused");},async resolveConnector(){return structuredClone(frame);}};
const close=(actual,expected,tolerance=1e-4)=>assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} != ${expected}`);

const assembly=(movingPlacement)=>{let d=createAssemblyDocument({id:"A",name:"A",updatedAt:0});d=insertComponent(d,component("Base",identity(),true));d=insertComponent(d,component("Moving",movingPlacement));return d;};

test("V4 Revolute Mate retains exactly one rotational DOF",async()=>{
 let d=assembly({translationMm:{x:25,y:-10,z:12},rotation:quaternionFromAxisAngle({x:0,y:0,z:1},Math.PI/3)});
 d=addMate(d,{id:"R",name:"R",type:"revolute",enabled:true,a:ref("Base"),b:ref("Moving"),angleLimit:{enabled:false,min:-180,max:180}});
 const result=await solveAssembly(d,provider);assert.equal(result.success,true);assert.equal(result.dof,1);const p=result.placements.get("Moving");close(p.translationMm.x,0);close(p.translationMm.y,0);close(p.translationMm.z,0);
});

test("V4 Slider Mate retains exactly one axial translation DOF",async()=>{
 let d=assembly({translationMm:{x:18,y:-9,z:45},rotation:quaternionFromAxisAngle({x:0,y:0,z:1},Math.PI/4)});
 d=addMate(d,{id:"S",name:"S",type:"slider",enabled:true,a:ref("Base"),b:ref("Moving"),distanceLimit:{enabled:false,min:-100,max:100}});
 const result=await solveAssembly(d,provider);assert.equal(result.success,true);assert.equal(result.dof,1);const p=result.placements.get("Moving");close(p.translationMm.x,0);close(p.translationMm.y,0);close(p.translationMm.z,45);const x=transformDirection(p,{x:1,y:0,z:0});close(x.x,1);close(x.y,0);
});

test("V4 Slider limit is enforced by solver residual",async()=>{
 let d=assembly({translationMm:{x:0,y:0,z:80},rotation:{x:0,y:0,z:0,w:1}});
 d=addMate(d,{id:"S",name:"S",type:"slider",enabled:true,a:ref("Base"),b:ref("Moving"),distanceLimit:{enabled:true,min:0,max:20}});
 const result=await solveAssembly(d,provider);assert.equal(result.success,true);close(result.placements.get("Moving").translationMm.z,20,2e-3);
});

test("V4 Revolute angle limit is enforced by solver residual",async()=>{
 let d=assembly({translationMm:{x:0,y:0,z:0},rotation:quaternionFromAxisAngle({x:0,y:0,z:1},Math.PI/2)});
 d=addMate(d,{id:"R",name:"R",type:"revolute",enabled:true,a:ref("Base"),b:ref("Moving"),angleLimit:{enabled:true,min:-30,max:30}});
 const result=await solveAssembly(d,provider);assert.equal(result.success,true);const x=transformDirection(result.placements.get("Moving"),{x:1,y:0,z:0});const angle=Math.atan2(x.y,x.x)*180/Math.PI;close(angle,30,2e-2);
});

test("V4 Snap aligns the complete connector frame and origin",()=>{
 const moving={...frame,originMm:{x:10,y:0,z:0}};const target={...frame,originMm:{x:100,y:50,z:25},primaryAxis:{x:0,y:1,z:0},secondaryAxis:{x:1,y:0,z:0},tertiaryAxis:{x:0,y:0,z:-1}};
 const placement=snapPlacementByMateConnectors(moving,target,"same");const world=transformMateConnectorFrame(moving,placement);close(world.originMm.x,100);close(world.originMm.y,50);close(world.originMm.z,25);close(world.primaryAxis.y,1);close(world.secondaryAxis.x,1);
});

import { deserializeAssemblyDocument, serializeAssemblyDocument } from "../core/assembly/AssemblyPersistence.ts";
import { createPartDefinitionStore } from "../core/assembly/PartDefinitions.ts";

test("V4 assembly schema migrates V1 documents and persists connector mates",()=>{
 let d=assembly(identity());d=addMate(d,{id:"R",name:"R",type:"revolute",enabled:true,a:ref("Base"),b:ref("Moving"),angleLimit:{enabled:true,min:-45,max:60}});
 const saved=serializeAssemblyDocument(d);const loaded=deserializeAssemblyDocument(saved);assert.equal(loaded.schemaVersion,2);assert.deepEqual(loaded.mates.R.angleLimit,{enabled:true,min:-45,max:60});
 const legacy=structuredClone(saved);legacy.schemaVersion=1;delete legacy.mates.R;legacy.mateOrder=[];assert.equal(deserializeAssemblyDocument(legacy).schemaVersion,2);
});

test("V4 old PartDefinitions normalize to empty explicit connector collections",()=>{
 const old={id:"Old",name:"Old",fingerprint:"f",project:{version:1,document:{},assets:[]}};const store=createPartDefinitionStore([old]);const normalized=store.definitions.get("Old");assert.deepEqual(normalized.mateConnectorOrder,[]);assert.deepEqual(normalized.mateConnectors,{});
});

import { serializeAssemblyProjectBundle, deserializeAssemblyProjectBundle } from "../core/assembly/AssemblyPersistence.ts";
import { createPartDefinitionRevisionWithMateConnector } from "../core/assembly/PartDefinitions.ts";
import { applyMateConnectorDefinition } from "../core/assembly/MateConnector.ts";

test("V4 explicit connector offset spin flip is deterministic",()=>{
 const adjusted=applyMateConnectorDefinition(frame,{offsetMm:{primary:10,secondary:2,tertiary:3},spinDeg:90,flipped:true});close(adjusted.originMm.z,-10);close(adjusted.originMm.y,-2);close(adjusted.originMm.x,-3);close(adjusted.primaryAxis.z,-1);
});

test("V4 immutable PartDefinition revision and connector survive Assembly project bundle",()=>{
 const source={id:"P",name:"Part",fingerprint:"cad",project:{version:1,document:{},assets:[]},mateConnectors:{},mateConnectorOrder:[]};
 const connector={id:"MC1",name:"MC1",bodyId:"Body01",topologyRef:{version:2,sourceFeatureId:"E",kind:"face",signature:{kind:"face",surfaceType:"plane",normalizedCenter:{x:.5,y:.5,z:1}}},offsetMm:{primary:1,secondary:2,tertiary:3},spinDeg:15,flipped:false};
 const revision=createPartDefinitionRevisionWithMateConnector(source,"P-MC1",connector);assert.equal(source.mateConnectorOrder.length,0);assert.equal(revision.mateConnectorOrder[0],"MC1");
 let d=createAssemblyDocument({id:"bundle",name:"bundle",updatedAt:0});d=insertComponent(d,{...component("C"),definitionId:revision.id});const bundle=serializeAssemblyProjectBundle(d,createPartDefinitionStore([revision]));const loaded=deserializeAssemblyProjectBundle(bundle);assert.deepEqual(loaded.definitions.definitions.get("P-MC1").mateConnectors.MC1.offsetMm,{primary:1,secondary:2,tertiary:3});
});
