import test, { after, before } from "node:test";
import assert from "node:assert/strict";

import { applyLocalCadAgentPlan, createLocalCadAgentPlan } from "../core/agent/LocalCadModelingAgent.ts";
import { createEmptyProfessionalCadDocument } from "../core/authoring/CadAuthoring.ts";
import { DEFAULT_CAD_TOLERANCE } from "../core/cad/Tolerance.ts";
import { createCadRuntimeState, disposeCadRuntimeState } from "../core/evaluation/CadRuntimeState.ts";
import { OcctKernel } from "../core/kernel/OcctKernel.ts";
import { rebuildDocument } from "../core/rebuild/RebuildEngine.ts";
import { createRebuildRuntimeState } from "../core/rebuild/RebuildTypes.ts";
import { buildSketchProfiles } from "../core/sketch/SketchProfile.ts";

let kernel;
const wasm = new URL("../node_modules/occt-wasm/dist/occt-wasm.wasm", import.meta.url);

before(async () => { kernel = new OcctKernel({ wasm }); await kernel.init(); });
after(async () => kernel?.dispose());

test("local CAD Agent recognizes Chinese equipment intent and mixed metric dimensions", () => {
  const plan = createLocalCadAgentPlan("设计一条长 4.5 米、宽 900 mm、高 850 mm 的滚筒输送线", { planId: "conveyor-test" });
  assert.equal(plan.intent, "conveyor");
  assert.deepEqual(plan.dimensionsMm, { length: 4500, width: 900, height: 850 });
  assert.ok(plan.template.parts.some((part) => part.id.startsWith("roller-")));
  assert.ok(plan.template.parts.length >= 10);
});

test("local CAD Agent does not confuse CNC spindles or six-axis robots with shaft parts", () => {
  const cnc = createLocalCadAgentPlan("建立一台 1600×1200×1900 mm 数控加工中心，带加工主轴", { planId: "cnc-intent" });
  const robot = createLocalCadAgentPlan("建立 2200×1800×2400 mm 六轴机器人上下料工作单元", { planId: "robot-intent" });
  assert.equal(cnc.intent, "cnc");
  assert.equal(robot.intent, "robot");
});

test("local CAD Agent adds editable engineering-detail Bodies to production equipment", () => {
  const cases = [
    ["conveyor-detail", "建立 4500×900×850 mm 滚筒输送线", ["轴承", "齿轮", "线缆", "螺纹牙", "电机"]],
    ["robot-detail", "建立 2200×1800×2400 mm 六轴机器人工作单元", ["轴承", "减速齿轮", "伺服", "线缆", "夹爪", "锚栓"]],
    ["cnc-detail", "建立 1600×1200×1900 mm 数控加工中心", ["滚珠丝杠", "主轴", "轴承", "传动齿轮", "刀库", "线缆", "螺纹牙"]],
  ];
  for (const [id, prompt, labels] of cases) {
    const plan = createLocalCadAgentPlan(prompt, { planId: id });
    const text = plan.template.parts.map((part) => part.label).join("\n");
    for (const label of labels) assert.match(text, new RegExp(label), `${id} should contain ${label}`);
    const ids = plan.template.parts.map((part) => part.id);
    assert.equal(new Set(ids).size, ids.length, `${id} should use unique editable part ids`);
    const semanticDetails = plan.template.parts.filter((part) => part.mechanicalDetail).length;
    assert.ok(plan.template.parts.length + semanticDetails * 4 >= 40, `${id} should contain a substantial engineering detail layer`);
    assert.ok(plan.operations.some((entry) => entry.includes("内部机构") || entry.includes("传动链") || entry.includes("六轴关节")));
  }
});

test("local CAD Agent robot reaches the detailed-display surface hierarchy", () => {
  const plan = createLocalCadAgentPlan("建立 2200×1800×2400 mm 六轴精细机械臂工作单元", { planId: "robot-surface-detail" });
  const detailParts = plan.template.parts.filter((part) => /外壳|端盖|密封|盖板|加强脊|法兰螺钉|铭牌|状态/.test(part.label));
  assert.ok(plan.template.parts.length + plan.template.parts.filter((part) => part.mechanicalDetail).length * 4 >= 115);
  assert.ok(detailParts.length >= 40);
  assert.ok(detailParts.some((part) => part.type === "torus"));
  assert.ok(detailParts.some((part) => part.type === "cylinder"));
  assert.match(plan.template.parts.map((part) => part.label).join("\n"), /J1 铸造回转外壳/);
  assert.match(plan.template.parts.map((part) => part.label).join("\n"), /上臂流线铸造外壳/);
  assert.match(plan.template.parts.map((part) => part.label).join("\n"), /J6 工具法兰螺钉/);
  assert.ok(plan.operations.some((entry) => entry.includes("J1–J6") && entry.includes("流线外壳")));
});

test("local CAD Agent parses a compact dimension triple with an independent unit on every axis", () => {
  const plan = createLocalCadAgentPlan("建立 4.5m×900mm×850mm 的滚筒输送线", { planId: "mixed-unit-triple" });
  assert.deepEqual(plan.dimensionsMm, { length: 4500, width: 900, height: 850 });
});

test("local CAD Agent translates novice everyday language into a reviewable engineering plan", () => {
  const plan = createLocalCadAgentPlan("我不懂专业名称，想做一个能固定小电机的东西，大概手掌大，底下留几个安装孔，边角不要太尖", { planId: "novice-bracket" });
  assert.equal(plan.intent, "bracket");
  assert.equal(plan.featureRequests.holeCount, 4);
  assert.equal(plan.featureRequests.filletRadiusMm, 3);
  assert.equal(plan.understanding.confidence, "medium");
  assert.ok(plan.understanding.inferred.some((entry) => entry.includes("长度") && entry.includes("宽度") && entry.includes("高度")));
  assert.ok(plan.understanding.inferred.some((entry) => entry.includes("四孔")));
  assert.ok(plan.dimensionsMm.length < 180 && plan.dimensionsMm.width < 120);
});

test("local CAD Agent understands spoken Chinese dimensions and operating context", () => {
  const plan = createLocalCadAgentPlan("做一条送纸箱的皮带线，四米五长，九十公分宽，八十五厘米高，载重两百公斤，放在食品车间", { planId: "novice-belt" });
  assert.equal(plan.intent, "conveyor");
  assert.deepEqual(plan.dimensionsMm, { length: 4500, width: 900, height: 850 });
  assert.equal(plan.featureRequests.conveyorType, "belt");
  assert.equal(plan.featureRequests.loadKg, 200);
  assert.match(plan.template.materialSpec, /304/);
  assert.ok(plan.template.parts.some((part) => part.id === "conveyor-belt"));
  assert.ok(plan.understanding.recognized.some((entry) => entry.includes("200 kg")));
  assert.ok(plan.understanding.warnings.some((entry) => entry.includes("强度")));
});

test("local CAD Agent infers equipment subtypes and task-specific end effectors", () => {
  const lathe = createLocalCadAgentPlan("做台能夹住圆棒加工的机器，差不多两米长", { planId: "novice-lathe" });
  const robot = createLocalCadAgentPlan("做个机械手帮我吸起纸箱，和人差不多高", { planId: "novice-suction-robot" });
  assert.equal(lathe.intent, "cnc");
  assert.equal(lathe.featureRequests.cncType, "lathe");
  assert.match(lathe.title, /车床/);
  assert.ok(lathe.template.parts.some((part) => part.id === "lathe-chuck"));
  assert.equal(robot.intent, "robot");
  assert.equal(robot.featureRequests.robotEndEffector, "suction");
  assert.equal(robot.dimensionsMm.height, 1700);
  assert.ok(robot.template.parts.some((part) => part.id.startsWith("suction-cup")));
});

test("local CAD Agent creates a rebuildable flange as one ordered feature-driven part", async () => {
  const initial = createEmptyProfessionalCadDocument("agent-test", "Agent Test");
  const plan = createLocalCadAgentPlan("建立一个直径 240 mm、厚 28 mm、带中心孔和四个安装孔的钢制法兰", { planId: "flange-test" });
  const document = applyLocalCadAgentPlan(plan, initial, "replace");
  const flangeBody = Object.values(document.bodies).find((body) => body.sourceResource?.sourcePartId === "flange");
  assert.ok(flangeBody);
  assert.equal(Object.keys(document.bodies).length, 1);
  assert.equal(Object.values(document.features).filter((feature) => feature.type === "revolve").length, 1);
  assert.equal(Object.values(document.features).filter((feature) => feature.type === "extrude" && feature.operation === "remove").length, 5);
  assert.equal(Object.values(document.features).filter((feature) => feature.type === "bodyBoolean").length, 0);
  const runtime = createCadRuntimeState();
  try {
    const result = await rebuildDocument({ document, runtime, rebuildRuntime: createRebuildRuntimeState(), kernel, tolerance: DEFAULT_CAD_TOLERANCE, buildProfiles: buildSketchProfiles }, { full: true });
    assert.equal(result.success, true);
    const shape = runtime.bodyShapes.get(flangeBody.id);
    assert.ok(shape);
    assert.equal((await kernel.validate(shape)).valid, true);
    const properties = await kernel.getShapeProperties(shape);
    assert.ok(properties.volumeMm3 > 500000 && properties.volumeMm3 < 1300000);
  } finally { await disposeCadRuntimeState(runtime, kernel); }
});

test("local CAD Agent turns requested M holes and enclosure openings into exact Boolean tools", () => {
  const flange = createLocalCadAgentPlan("建立直径 300 mm、厚 32 mm、带 8 个 M8 孔并做圆角 R5 的法兰", { planId: "feature-flange" });
  assert.equal(flange.featureRequests.holeCount, 8);
  assert.equal(flange.featureRequests.holeDiameterMm, 8);
  assert.equal(flange.featureRequests.filletRadiusMm, 5);
  assert.equal(flange.booleanCuts?.[0]?.toolPartIds.length, 9);
  assert.ok(flange.operations.some((entry) => entry.includes("8 个") && entry.includes("Ø8")));

  const enclosure = createLocalCadAgentPlan("建立 800×500×1200 mm 控制柜，门板带观察窗和 6 条百叶孔", { planId: "feature-enclosure" });
  assert.equal(enclosure.featureRequests.observationWindow, true);
  assert.equal(enclosure.featureRequests.louverCount, 6);
  assert.equal(enclosure.booleanCuts?.[0]?.toolPartIds.length, 7);
});

test("local CAD Agent rebuilds an enclosure as thin-wall and door feature chains", async () => {
  const plan = createLocalCadAgentPlan("建立 800×500×1200 mm 控制柜，门板带观察窗和 6 条百叶孔", { planId: "enclosure-feature-chain" });
  const document = applyLocalCadAgentPlan(plan, createEmptyProfessionalCadDocument("enclosure", "enclosure"), "replace");
  assert.equal(Object.keys(document.bodies).length, 2);
  const doorBody = Object.values(document.bodies).find((body) => body.sourceResource?.sourcePartId === "door");
  assert.ok(doorBody);
  const doorFeatures = Object.values(document.features).filter((feature) => feature.bodyId === doorBody.id);
  assert.equal(doorFeatures.filter((feature) => feature.type === "extrude" && feature.operation === "new").length, 1);
  assert.equal(doorFeatures.filter((feature) => feature.type === "extrude" && feature.operation === "remove").length, 7);
  const runtime = createCadRuntimeState();
  try {
    const result = await rebuildDocument({ document, runtime, rebuildRuntime: createRebuildRuntimeState(), kernel, tolerance: DEFAULT_CAD_TOLERANCE, buildProfiles: buildSketchProfiles }, { full: true });
    assert.equal(result.success, true, result.errors.map((entry) => entry.message).join("; "));
    for (const body of Object.values(document.bodies)) assert.equal((await kernel.validate(runtime.bodyShapes.get(body.id))).valid, true);
  } finally { await disposeCadRuntimeState(runtime, kernel); }
});

test("local CAD Agent equipment envelopes remain grounded and close to requested dimensions", async () => {
  const cases = [
    ["conveyor-envelope", "建立 4.5m×900mm×850mm 的滚筒输送线"],
    ["enclosure-envelope", "建立 800×500×1200 mm 带观察窗的控制柜"],
    ["cnc-envelope", "建立 1600×1200×1900 mm 的数控加工中心，带主轴"],
    ["lathe-envelope", "建立 2000×1100×1600 mm 的数控车床，加工圆棒"],
    ["robot-envelope", "建立 2200×1800×2400 mm 的六轴机器人工作单元"],
    ["shaft-envelope", "建立 500×120×120 mm 的阶梯轴"],
  ];
  for (const [id, prompt] of cases) {
    const initial = createEmptyProfessionalCadDocument(id, id);
    const plan = createLocalCadAgentPlan(prompt, { planId: id });
    const document = applyLocalCadAgentPlan(plan, initial, "replace");
    const runtime = createCadRuntimeState();
    try {
      const result = await rebuildDocument({ document, runtime, rebuildRuntime: createRebuildRuntimeState(), kernel, tolerance: DEFAULT_CAD_TOLERANCE, buildProfiles: buildSketchProfiles }, { full: true });
      assert.equal(result.success, true, `${id} should rebuild: ${result.errors.map((entry) => `${entry.featureId}: ${entry.message}`).join("; ")}`);
      const boxes = [];
      for (const body of Object.values(document.bodies).filter((entry) => entry.visible !== false)) {
        const shape = runtime.bodyShapes.get(body.id);
        if (shape) boxes.push((await kernel.getShapeProperties(shape)).boundingBox);
      }
      assert.ok(boxes.length > 0);
      const bounds = {
        min: { x: Math.min(...boxes.map((box) => box.min.x)), y: Math.min(...boxes.map((box) => box.min.y)), z: Math.min(...boxes.map((box) => box.min.z)) },
        max: { x: Math.max(...boxes.map((box) => box.max.x)), y: Math.max(...boxes.map((box) => box.max.y)), z: Math.max(...boxes.map((box) => box.max.z)) },
      };
      const actual = { length: bounds.max.x - bounds.min.x, width: bounds.max.z - bounds.min.z, height: bounds.max.y - bounds.min.y };
      assert.ok(bounds.min.y >= -.05, `${id} should rest on the ground plane; minY=${bounds.min.y}`);
      for (const axis of ["length", "width", "height"]) {
        const relativeError = Math.abs(actual[axis] - plan.dimensionsMm[axis]) / plan.dimensionsMm[axis];
        const tolerance = plan.intent === "conveyor" || plan.intent === "cnc" ? .001 : .025;
        assert.ok(relativeError <= tolerance, `${id} ${axis} error ${(relativeError * 100).toFixed(2)}%`);
      }
    } finally { await disposeCadRuntimeState(runtime, kernel); }
  }
});

test("local CAD Agent append mode preserves the current design and adds generated Bodies", () => {
  const current = createEmptyProfessionalCadDocument("append-test", "Current Project");
  const plan = createLocalCadAgentPlan("建立 320×180×240 mm 的加强型支架", { planId: "bracket-test" });
  const appended = applyLocalCadAgentPlan(plan, current, "append");
  assert.equal(appended.id, current.id);
  assert.equal(appended.name, current.name);
  assert.equal(Object.keys(appended.bodies).length, 1);
  assert.ok(appended.featureOrder.length >= 6);
  assert.equal(Object.values(appended.features).filter((feature) => feature.type === "extrude" && feature.operation === "new").length, 1);
  assert.ok(Object.values(appended.features).some((feature) => feature.type === "extrude" && feature.operation === "add"));
  assert.ok(Object.values(appended.features).some((feature) => feature.type === "extrude" && feature.operation === "remove"));
});

test("local CAD Agent chooses loft and sweep instead of primitive stacking for free-form requests", async () => {
  const cases = [
    ["freeform-loft", "做一个前窄后宽、有平滑过渡的流线型传感器外壳，长 260 mm 宽 140 mm 高 120 mm", "loft"],
    ["freeform-sweep", "做一根沿弯曲路径走向的保护管，长 600 mm 宽 160 mm 高 180 mm", "sweep"],
  ];
  for (const [id, prompt, type] of cases) {
    const plan = createLocalCadAgentPlan(prompt, { planId: id });
    assert.equal(plan.featureProgram?.strategy, "feature-driven");
    if (type === "loft") {
      assert.equal(plan.intent, "generic");
      assert.match(plan.title, /自由曲面壳体/);
      const sections = plan.featureProgram.parts[0].steps[0].sections;
      assert.ok(sections[0].profile.points[1].x - sections[0].profile.points[0].x < sections.at(-1).profile.points[1].x - sections.at(-1).profile.points[0].x);
    }
    const document = applyLocalCadAgentPlan(plan, createEmptyProfessionalCadDocument(id, id), "replace");
    assert.equal(Object.keys(document.bodies).length, 1);
    assert.equal(document.features[document.featureOrder[0]].type, type);
    const runtime = createCadRuntimeState();
    try {
      const result = await rebuildDocument({ document, runtime, rebuildRuntime: createRebuildRuntimeState(), kernel, tolerance: DEFAULT_CAD_TOLERANCE, buildProfiles: buildSketchProfiles }, { full: true });
      assert.equal(result.success, true, `${id}: ${result.errors.map((entry) => entry.message).join("; ")}`);
      const shape = runtime.bodyShapes.get(Object.keys(document.bodies)[0]);
      assert.ok(shape);
      assert.equal((await kernel.validate(shape)).valid, true);
    } finally { await disposeCadRuntimeState(runtime, kernel); }
  }
});

test("local CAD Agent replaces rough robot arm blocks with editable lofted arm parts", () => {
  const plan = createLocalCadAgentPlan("建立 2200×1800×2400 mm 六轴精细机械臂工作单元", { planId: "robot-loft-replacement" });
  const document = applyLocalCadAgentPlan(plan, createEmptyProfessionalCadDocument("robot", "robot"), "replace");
  const sourceIds = Object.values(document.bodies).map((body) => body.sourceResource?.sourcePartId);
  assert.equal(sourceIds.includes("upper-arm-cast-shell"), false);
  assert.equal(sourceIds.includes("forearm-cast-shell"), false);
  assert.ok(sourceIds.includes("upper-arm"));
  assert.ok(sourceIds.includes("forearm"));
  assert.equal(Object.values(document.features).filter((feature) => feature.type === "loft").length, 2);
});
