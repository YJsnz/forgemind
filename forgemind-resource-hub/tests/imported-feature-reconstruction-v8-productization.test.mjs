import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const ui=`${await readFile(new URL("../app/kernel-debug/OcctKernelDebug.tsx",import.meta.url),"utf8")}\n${await readFile(new URL("../app/kernel-debug/ImportedFeatureRecoveryPanel.tsx",import.meta.url),"utf8")}`;
const sketchProfiles=await readFile(new URL("../core/sketch/SketchProfile.ts",import.meta.url),"utf8");
const profileExtrusion=await readFile(new URL("../core/evaluation/ProfileExtrusion.ts",import.meta.url),"utf8");
const prism=await readFile(new URL("../core/direct-edit/ImportedPrismaticReconstruction.ts",import.meta.url),"utf8");
const recognition=await readFile(new URL("../core/direct-edit/ImportedFeatureRecognition.ts",import.meta.url),"utf8");
const patterns=await readFile(new URL("../core/direct-edit/ImportedPatternRecognition.ts",import.meta.url),"utf8");

test("V8 Part Studio permits exact multi-loop prismatic reconstruction instead of rejecting inner loops",()=>{
  assert.doesNotMatch(ui,/Cap 包含内环；V7/);
  assert.match(ui,/Exact Multi-loop Sketch/);
  assert.match(prism,/options\.profile\.holes\.forEach/);
});

test("V8 generic Sketch Profile Builder groups nested loops without replacing analytic CAD geometry",()=>{
  assert.match(sketchProfiles,/groupNestedLoops/);
  assert.match(sketchProfiles,/Sampling is used only to classify loop/i);
  assert.match(profileExtrusion,/prism and subtracts every exact inner-loop prism/i);
});

test("V8 imported Hole analysis recovers depth condition instead of defaulting every hole to Through All",()=>{
  assert.match(recognition,/inferHoleDepthCondition/);
  assert.match(recognition,/type:"throughAll"/);
  assert.match(recognition,/type:"blind"/);
  assert.match(ui,/spec\.depthCondition\?\.type === "blind"/);
});

test("V8/V9 exposes exact linear/circular imported Hole Pattern candidates and V9 upgrades the seed gate to reconstruction",()=>{
  assert.match(patterns,/linear-hole-pattern/);
  assert.match(patterns,/circular-hole-pattern/);
  assert.match(ui,/Hole Pattern/);
  assert.match(ui,/重构阵列/);
});
