import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const text=async(path)=>{
  const primary=await readFile(new URL(path,import.meta.url),"utf8");
  if(path!=="../app/kernel-debug/OcctKernelDebug.tsx") return primary;
  const recoveryPanel=await readFile(new URL("../app/kernel-debug/ImportedFeatureRecoveryPanel.tsx",import.meta.url),"utf8");
  const presentation=await readFile(new URL("../app/kernel-debug/featurePresentation.ts",import.meta.url),"utf8");
  return `${primary}\n${recoveryPanel}\n${presentation}`;
};

test("V6 Part Studio supports multi-edge healed-edge confirmation",async()=>{
  const source=await text("../app/kernel-debug/OcctKernelDebug.tsx");
  assert.match(source,/reconstructionEdgeSelectionRef/);
  assert.match(source,/addSelectedReconstructionEdge/);
  assert.match(source,/完成参数化重构/);
  assert.match(source,/一次性完成 Multi-edge/);
  assert.match(source,/共 \$\{completed\.edgeCount\} 条 Edge/);
});

test("V6 surfaces conservative Prismatic Boss/Pocket review without auto-conversion",async()=>{
  const source=await text("../app/kernel-debug/OcctKernelDebug.tsx");
  assert.match(source,/Prismatic Boss[/]Pocket/);
  assert.match(source,/待确认/);
  assert.match(source,/不会自动猜 Boss\/Pocket 类型/);
  assert.match(source,/buildImportedFeatureReconstructionReport/);
});

test("V6 Move Face wording is limited to exact planar normal offset",async()=>{
  const source=await text("../app/kernel-debug/OcctKernelDebug.tsx");
  assert.match(source,/Move Face V2 · Planar Normal Offset/);
  assert.match(source,/Move \/ Push-Pull Selected Planar Face/);
  assert.doesNotMatch(source,/Arbitrary Face Rotate COMPLETE|Universal Move Face COMPLETE/);
});
