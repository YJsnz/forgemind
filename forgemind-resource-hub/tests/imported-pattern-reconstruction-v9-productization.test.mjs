import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source=["../app/kernel-debug/OcctKernelDebug.tsx","../app/kernel-debug/ImportedFeatureRecoveryPanel.tsx","../app/kernel-debug/featurePresentation.ts"].map((path)=>fs.readFileSync(new URL(path,import.meta.url),"utf8")).join("\n");

test("V9 Part Studio exposes imported hole pattern reconstruction instead of the V8 seed placeholder",()=>{
  assert.match(source,/重构阵列/);
  assert.match(source,/beginImportedPatternReconstruction/);
  assert.match(source,/completeImportedPattern/);
  assert.match(source,/孔阵列恢复/);
  assert.match(source,/repeated imported holes healed/);
  assert.doesNotMatch(source,/>待种子<\/button>/);
});

test("V9 reconstructed native patterns expose editable count spacing and angle through command preview",()=>{
  assert.match(source,/阵列数量（个）/);
  assert.match(source,/相邻间距（毫米）/);
  assert.match(source,/覆盖角度（度）/);
  assert.match(source,/patternCount/);
  assert.match(source,/patternSpacingMm/);
  assert.match(source,/patternAngleDeg/);
  assert.match(source,/FEATURE_PREVIEW/);
});
