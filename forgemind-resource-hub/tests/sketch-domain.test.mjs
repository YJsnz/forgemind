import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createCadDocument } from "../core/cad/CadDocument.ts";
import { legacySketchToDomain } from "../core/sketch/LegacySketchAdapter.ts";
import { buildSketchProfiles } from "../core/sketch/SketchProfile.ts";

const rectangle = {
  id: "legacy-rectangle",
  plane: "top",
  kind: "rectangle",
  points: [
    { x: .2, y: .2 },
    { x: .6, y: .2 },
    { x: .6, y: .5 },
    { x: .2, y: .5 },
    { x: .2, y: .2 },
  ],
};

test("legacy rectangle becomes four SketchLine entities", () => {
  const sketch = legacySketchToDomain(rectangle);
  assert.equal(sketch.entityOrder.length, 4);
  assert.deepEqual(sketch.entityOrder, [
    "legacy-rectangle:line:0",
    "legacy-rectangle:line:1",
    "legacy-rectangle:line:2",
    "legacy-rectangle:line:3",
  ]);
  assert.ok(sketch.entityOrder.every((id) => sketch.entities[id].type === "line"));
});

test("rectangle lines form a closed profile", () => {
  const result = buildSketchProfiles(legacySketchToDomain(rectangle));
  assert.equal(result.profiles.length, 1);
  assert.equal(result.profiles[0].outer.length, 4);
  assert.equal(result.openChains.length, 0);
});

test("legacy circle becomes SketchCircle", () => {
  const sketch = legacySketchToDomain({
    id: "legacy-circle", plane: "top", kind: "circle",
    points: [{ x: .7, y: .5 }, { x: .5, y: .3 }, { x: .3, y: .5 }, { x: .5, y: .7 }, { x: .7, y: .5 }],
  });
  const circle = sketch.entities["legacy-circle:circle"];
  assert.equal(circle.type, "circle");
  assert.ok(Math.abs(circle.radius - 1000) < 1e-9);
});

test("legacy line becomes SketchLine", () => {
  const sketch = legacySketchToDomain({ id: "legacy-line", plane: "top", kind: "line", points: [{ x: .2, y: .2 }, { x: .6, y: .2 }] });
  const line = sketch.entities["legacy-line:line"];
  assert.equal(line.type, "line");
  assert.equal(line.start.y, line.end.y);
});

test("legacy arc becomes SketchArc", () => {
  const sketch = legacySketchToDomain({ id: "legacy-arc", plane: "front", kind: "arc", points: [{ x: .7, y: .5 }, { x: .5, y: .3 }, { x: .3, y: .5 }] });
  const arc = sketch.entities["legacy-arc:arc"];
  assert.equal(arc.type, "arc");
  assert.equal(arc.radius, 1000);
  assert.equal(arc.startAngle, 0);
  assert.ok(Math.abs(Math.abs(arc.endAngle) - Math.PI) < 1e-12);
});

test("legacy spline preserves control points", () => {
  const sketch = legacySketchToDomain({ id: "legacy-spline", plane: "right", kind: "spline", points: [{ x: .1, y: .2 }, { x: .3, y: .4 }, { x: .6, y: .7 }] });
  const spline = sketch.entities["legacy-spline:spline"];
  assert.equal(spline.type, "spline");
  assert.equal(spline.controlPoints.length, 3);
  assert.equal(spline.closed, false);
});

test("construction maps to entity.construction", () => {
  const sketch = legacySketchToDomain({ id: "legacy-construction", plane: "top", kind: "construction", construction: true, points: [{ x: .2, y: .2 }, { x: .6, y: .2 }] });
  assert.equal(sketch.entities["legacy-construction:construction"].construction, true);
});

test("horizontal constraint is preserved", () => {
  const sketch = legacySketchToDomain({ id: "horizontal", plane: "top", kind: "line", constraints: ["horizontal"], points: [{ x: .2, y: .2 }, { x: .6, y: .2 }] });
  assert.equal(sketch.constraints["horizontal:constraint:horizontal"].type, "horizontal");
});

test("vertical constraint is preserved", () => {
  const sketch = legacySketchToDomain({ id: "vertical", plane: "top", kind: "line", constraints: ["vertical"], points: [{ x: .2, y: .2 }, { x: .2, y: .6 }] });
  assert.equal(sketch.constraints["vertical:constraint:vertical"].type, "vertical");
});

test("fixed constraint is preserved", () => {
  const sketch = legacySketchToDomain({ id: "fixed", plane: "top", kind: "line", constraints: ["fixed"], points: [{ x: .2, y: .2 }, { x: .2, y: .6 }] });
  assert.equal(sketch.constraints["fixed:constraint:fixed"].type, "fixed");
});

test("legacy-derived dimensions use ForgeMind millimetres", () => {
  const sketch = legacySketchToDomain(rectangle);
  assert.equal(sketch.dimensions["legacy-rectangle:dimension:width"].value, 2000);
  assert.equal(sketch.dimensions["legacy-rectangle:dimension:height"].value, 1500);
});

test("legacy feature data never enters the domain sketch", () => {
  const sketch = legacySketchToDomain({
    ...rectangle,
    feature: { operation: "extrude", depth: 1, bevel: 0, enabled: true },
  });
  assert.doesNotMatch(JSON.stringify(sketch), /extrude|depth|bevel/);
});

test("adapter does not mutate legacy input", () => {
  const legacy = { ...rectangle, constraints: ["fixed"] };
  const before = JSON.stringify(legacy);
  legacySketchToDomain(legacy);
  assert.equal(JSON.stringify(legacy), before);
});

test("adapter entity IDs are stable across repeated conversion", () => {
  const first = legacySketchToDomain(rectangle);
  const second = legacySketchToDomain(rectangle);
  assert.deepEqual(first.entityOrder, second.entityOrder);
});

test("core sketch modules contain no Three.js dependency", async () => {
  const files = ["Sketch.ts", "SketchEntity.ts", "SketchPlane.ts", "SketchConstraint.ts", "SketchDimension.ts", "SketchProfile.ts", "LegacySketchAdapter.ts"];
  const contents = await Promise.all(files.map((file) => readFile(new URL(`../core/sketch/${file}`, import.meta.url), "utf8")));
  assert.ok(contents.every((content) => !/from\s+["']three|THREE\./.test(content)));
});

test("CadDocument can carry a domain sketch without React state", () => {
  const sketch = legacySketchToDomain(rectangle);
  const document = createCadDocument({ id: "cad-with-sketch", name: "文档", sketches: { [sketch.id]: sketch }, updatedAt: 1 });
  assert.equal(document.sketches[sketch.id].entities["legacy-rectangle:line:0"].type, "line");
});

test("open line profile is reported instead of silently closed", () => {
  const sketch = legacySketchToDomain({ id: "open-line", plane: "top", kind: "line", points: [{ x: .2, y: .2 }, { x: .6, y: .2 }] });
  const result = buildSketchProfiles(sketch);
  assert.equal(result.profiles.length, 0);
  assert.equal(result.openChains[0].reason, "open");
});

test("closed rectangle profile is reported as closed", () => {
  const result = buildSketchProfiles(legacySketchToDomain(rectangle));
  assert.equal(result.profiles[0].outer.every((segment) => segment.type === "line"), true);
  assert.deepEqual(result.profiles[0].holes, []);
});
