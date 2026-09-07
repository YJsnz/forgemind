import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { OcctKernel } from "../core/kernel/OcctKernel.ts";
import { createDefaultTensorProductNurbs, insertTensorProductNurbsKnot, validateTensorProductNurbs, widestTensorNurbsSpanMidpoint } from "../core/surface/TensorProductNurbs.ts";

const wasm = new URL("../node_modules/occt-wasm/dist/occt-wasm.wasm", import.meta.url);
const controlNet = Array.from({ length: 4 }, (_, row) => Array.from({ length: 5 }, (_, col) => ({ x: col * 20, y: row * 20, z: Math.sin(col) * Math.cos(row) * 10 })));
let kernel;
before(async () => { kernel = new OcctKernel({ wasm }); await kernel.init(); });
after(async () => { await kernel?.dispose(); });

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

test("V17 inserts one rational U knot and increases only the U control count", () => {
  const definition = createDefaultTensorProductNurbs(controlNet, 3); definition.weights[1][1] = 2.4;
  const result = insertTensorProductNurbsKnot(controlNet, definition, "u", .35);
  assert.equal(result.controlNet.length, controlNet.length); assert.equal(result.controlNet[0].length, controlNet[0].length + 1);
  assert.deepEqual(result.definition.u.knots, [0, .35, .5, 1]);
  assert.deepEqual(result.definition.u.multiplicities, [4, 1, 1, 4]);
  assert.deepEqual(validateTensorProductNurbs(result.controlNet, result.definition), { valid: true, issues: [] });
});

test("V17 inserts one rational V knot and increases only the V control count", () => {
  const definition = createDefaultTensorProductNurbs(controlNet, 3); definition.weights[2][3] = 1.8;
  const result = insertTensorProductNurbsKnot(controlNet, definition, "v", .62);
  assert.equal(result.controlNet.length, controlNet.length + 1); assert.equal(result.controlNet[0].length, controlNet[0].length);
  assert.deepEqual(result.definition.v.knots, [0, .62, 1]);
  assert.deepEqual(result.definition.v.multiplicities, [4, 1, 4]);
  assert.deepEqual(validateTensorProductNurbs(result.controlNet, result.definition), { valid: true, issues: [] });
});

test("V17 exact U/V insertion preserves the native OCCT surface point and bounding box", async () => {
  const definition = createDefaultTensorProductNurbs(controlNet, 3); definition.weights[1][1] = 2.3; definition.weights[2][3] = 1.7;
  const original = await kernel.bsplineSurface({ controlNet, tensorNurbs: definition });
  const originalPoint = await kernel.analyzeSurface((await kernel.getFaces(original))[0].topology);
  const originalBox = (await kernel.getShapeProperties(original)).boundingBox;
  for (const direction of ["u", "v"]) {
    const inserted = insertTensorProductNurbsKnot(controlNet, definition, direction, .37);
    const refined = await kernel.bsplineSurface({ controlNet: inserted.controlNet, tensorNurbs: inserted.definition });
    const refinedPoint = await kernel.analyzeSurface((await kernel.getFaces(refined))[0].topology);
    const refinedBox = (await kernel.getShapeProperties(refined)).boundingBox;
    assert.ok(distance(originalPoint.pointMm, refinedPoint.pointMm) < 1e-10);
    assert.ok(distance(originalBox.min, refinedBox.min) < 1e-9); assert.ok(distance(originalBox.max, refinedBox.max) < 1e-9);
    assert.deepEqual(await kernel.validate(refined), { valid: true, issues: [] });
    await kernel.disposeShape(refined);
  }
  await kernel.disposeShape(original);
});

test("V17 preserves a non-uniform rational surface across repeated U/V insertions on a dense grid", async () => {
  let net=Array.from({length:5},(_,row)=>Array.from({length:6},(_,column)=>({x:column*17,y:row*19,z:Math.sin(column*.8)*Math.cos(row*.7)*13+row*column*.35})));
  let definition={u:{degree:3,knots:[0,.2,.7,1],multiplicities:[4,1,1,4]},v:{degree:2,knots:[0,.3,.8,1],multiplicities:[3,1,1,3]},weights:Array.from({length:5},(_,row)=>Array.from({length:6},(_,column)=>.75+((row*7+column*3)%9)*.14))};
  const original=await kernel.bsplineSurface({controlNet:net,tensorNurbs:definition});
  for(const [direction,knot] of [["u",.13],["u",.2],["u",.55],["v",.16],["v",.3],["v",.66]]){const inserted=insertTensorProductNurbsKnot(net,definition,direction,knot);net=inserted.controlNet;definition=inserted.definition;}
  const refined=await kernel.bsplineSurface({controlNet:net,tensorNurbs:definition});
  const originalGrid=await kernel.analyzeSurfaceGrid((await kernel.getFaces(original))[0].topology,21,21);
  const refinedGrid=await kernel.analyzeSurfaceGrid((await kernel.getFaces(refined))[0].topology,21,21);
  assert.equal(originalGrid.samples.length,441);assert.equal(refinedGrid.samples.length,441);
  const maximumError=Math.max(...originalGrid.samples.map((sample,index)=>distance(sample.pointMm,refinedGrid.samples[index].pointMm)));
  assert.ok(maximumError<1e-10,`dense-grid shape error ${maximumError}`);
  assert.equal(net.length,8);assert.equal(net[0].length,9);
  await kernel.disposeShape(refined);await kernel.disposeShape(original);
});

test("V17 enforces internal-knot and multiplicity boundaries", () => {
  let net = structuredClone(controlNet), definition = createDefaultTensorProductNurbs(net, 3);
  assert.throws(() => insertTensorProductNurbsKnot(net, definition, "u", 0), /0 与 1/);
  assert.throws(() => insertTensorProductNurbsKnot(net, definition, "v", 1), /0 与 1/);
  for (let count = 0; count < 2; count += 1) { const result = insertTensorProductNurbsKnot(net, definition, "u", .5); net = result.controlNet; definition = result.definition; }
  assert.throws(() => insertTensorProductNurbsKnot(net, definition, "u", .5), /次数上限/);
  const closeNet=controlNet.map((row)=>[...row,{x:100,y:row[0].y,z:0}]);const tooClose=createDefaultTensorProductNurbs(closeNet,3);
  tooClose.u.knots=[0,.5,.5000000000005,1];tooClose.u.multiplicities=[4,1,1,4];
  const closeValidation=validateTensorProductNurbs(closeNet,tooClose);assert.equal(closeValidation.valid,false);assert.match(closeValidation.issues.join(" "),/参数容差/);
});

test("V17 balanced refinement chooses the widest parameter span", () => {
  assert.equal(widestTensorNurbsSpanMidpoint({ degree: 2, knots: [0, .1, .4, 1], multiplicities: [3, 1, 1, 3] }), .7);
});

test("V17 editor distinguishes shape-preserving NURBS refinement from ordinary shaping", async () => {
  const source = await readFile(new URL("../app/cad/BSplineSurfaceEditor.tsx", import.meta.url), "utf8");
  for (const label of ["insertTensorProductNurbsKnot", "widestTensorNurbsSpanMidpoint", "保持形状插入", "曲面形状保持不变", "最宽参数区间"]) assert.match(source, new RegExp(label));
});
