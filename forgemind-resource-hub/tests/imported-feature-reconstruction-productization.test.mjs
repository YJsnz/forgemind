import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const read=(path)=>readFile(new URL(path,import.meta.url),"utf8");
const text=async(path)=>path==="../app/kernel-debug/OcctKernelDebug.tsx" ? `${await read(path)}\n${await read("../app/kernel-debug/ImportedFeatureRecoveryPanel.tsx")}` : read(path);

test("V5 Part Studio exposes two-stage Fillet/Chamfer reconstruction without committing preview history",async()=>{
  const source=await text("../app/kernel-debug/OcctKernelDebug.tsx");
  assert.match(source,/beginImportedEdgeTreatmentReconstruction/);
  assert.match(source,/completeImportedReconstruction/);
  assert.match(source,/cancelImportedReconstruction/);
  assert.match(source,/RECONSTRUCTION PREVIEW/);
  assert.match(source,/Defeature preview ready/);
  assert.match(source,/完成参数化重构/);
  assert.match(source,/History 尚未提交/);
});

test("V5 Part Studio reconstructs recognized holes from analytic cylinder axis and a healed planar face",async()=>{
  const source=await text("../app/kernel-debug/OcctKernelDebug.tsx");
  assert.match(source,/beginImportedHoleReconstruction/);
  assert.match(source,/completeImportedHole/);
  assert.match(source,/intersectAxisWithPlane/);
  assert.match(source,/worldToFaceLocal/);
  assert.match(source,/Through All/);
  assert.match(source,/Blind/);
  assert.match(source,/完成孔重构/);
});

test("V5 reconstruction uses native design Features rather than a new opaque direct-edit blob",async()=>{
  const source=await text("../core/direct-edit/ImportedFeatureReconstruction.ts");
  assert.match(source,/type: "deleteFace"/);
  assert.match(source,/type: "fillet"/);
  assert.match(source,/type: "chamfer"/);
  assert.match(source,/type: "removeHole"/);
  assert.match(source,/type: "hole"/);
  assert.doesNotMatch(source,/runtimeShapeId|triangleIndex|faceIndex/);
});
