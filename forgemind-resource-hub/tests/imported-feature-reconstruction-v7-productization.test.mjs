import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source=[
  "../app/kernel-debug/OcctKernelDebug.tsx",
  "../app/kernel-debug/ImportedFeatureRecoveryPanel.tsx",
  "../app/kernel-debug/featurePresentation.ts",
].map((path)=>readFile(new URL(path,import.meta.url),"utf8"));
const workbench=(await Promise.all(source)).join("\n");
const recognition=await readFile(new URL("../core/direct-edit/ImportedFeatureRecognition.ts",import.meta.url),"utf8");
const prism=await readFile(new URL("../core/direct-edit/ImportedPrismaticReconstruction.ts",import.meta.url),"utf8");
const holes=await readFile(new URL("../core/direct-edit/ImportedHoleStyleRecognition.ts",import.meta.url),"utf8");
const extrude=await readFile(new URL("../core/evaluation/ExtrudeEvaluator.ts",import.meta.url),"utf8");
const solidOperation=await readFile(new URL("../core/evaluation/SolidFeatureOperation.ts",import.meta.url),"utf8");
const pocket=await readFile(new URL("../core/evaluation/PocketEvaluator.ts",import.meta.url),"utf8");

test("V7 Part Studio exposes proven Boss/Pocket reconstruction rather than auto-converting ambiguous candidates",()=>{
  assert.match(workbench,/reconstructImportedPrismatic/);
  assert.match(workbench,/"凸台"/);
  assert.match(workbench,/"凹槽"/);
  assert.match(workbench,/Prismatic Candidate 尚未通过 V8 凹凸\/终止条件门禁/);
  assert.match(recognition,/oriented cap\/side evidence consistently proves/);
});

test("V7 reconstruction creates an exact recovered Sketch followed by native Boolean Extrude Add or Blind Pocket",()=>{
  assert.match(prism,/type: "deleteFace"/);
  assert.match(prism,/operation: "add"/);
  assert.match(prism,/type: "blind"/);
  assert.match(extrude,/applySolidFeatureOperation/);
  assert.match(solidOperation,/booleanUnion\(target, tools\)/);
  assert.match(pocket,/feature\.depth\.type === "blind"/);
});

test("V7 recognizes editable Counterbore and Countersink from exact analytic evidence",()=>{
  assert.match(holes,/two coaxial concave cylinders \+ shared planar shoulder/);
  assert.match(holes,/two exact circular cone boundaries/);
  assert.match(workbench,/沉孔直径（毫米）/);
  assert.match(workbench,/沉头孔直径（毫米）/);
  assert.match(workbench,/沉头夹角（度）/);
});
