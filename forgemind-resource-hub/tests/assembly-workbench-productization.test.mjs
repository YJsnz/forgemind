import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const assembly=await readFile(new URL("../app/assembly-debug/AssemblyDebug.tsx",import.meta.url),"utf8");
const home=await readFile(new URL("../app/page.tsx",import.meta.url),"utf8");
const route=await readFile(new URL("../app/assembly/page.tsx",import.meta.url),"utf8");

test("Assembly Workbench exposes exact Mate Connector visualization and separate Select/Drag/Orbit modes",()=>{
  assert.match(assembly,/mateConnectorFrameFromGeometry/);
  assert.match(assembly,/transformMateConnectorFrame/);
  assert.match(assembly,/Drag \+ Solve/);
  assert.match(assembly,/Select Faces/);
  assert.match(assembly,/Orbit/);
  assert.match(assembly,/solveAssembly\(candidate/);
  assert.match(assembly,/Export Project/);
  assert.match(assembly,/\.forgemind-assembly\.json/);
  assert.match(assembly,/deserializeAssemblyProjectBundle/);
  assert.match(assembly,/工程检查/);
  assert.match(assembly,/导出 BOM 表格/);
  assert.match(assembly,/采用求解位置/);
  assert.match(assembly,/removeComponentCascade/);
});

test("Assembly is promoted to a first-class product route from the Resource Hub",()=>{
  assert.match(route,/AssemblyDebug/);
  assert.match(home,/window\.location\.href = "\/assembly"/);
  assert.match(home,/装配工作台/);
  assert.match(home,/Mate Connector \/ DOF \/ 实时求解/);
});

test("Assembly component cards use one native selection control without nesting action buttons",()=>{
  assert.match(assembly,/className="assembly-card-select"/);
  assert.match(assembly,/aria-label=\{`选择组件 \$\{c\.name\}`\}/);
  assert.match(assembly,/aria-pressed=\{selectedComponentId===id\}/);
  assert.doesNotMatch(assembly,/role="button" tabIndex=\{0\}/);
});
