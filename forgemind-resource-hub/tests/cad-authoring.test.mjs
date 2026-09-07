import test from "node:test";
import assert from "node:assert/strict";
import { appendQuickPrimitive, createEmptyProfessionalCadDocument } from "../core/authoring/CadAuthoring.ts";
import { solveSketch } from "../core/sketch/solver/SketchSolver.ts";

test("Today mainline quick rectangle authoring creates a fully constrained sketch, body and extrude", () => {
  const document = appendQuickPrimitive(createEmptyProfessionalCadDocument("authoring", "Authoring"), { idPrefix: "box01", name: "Box01", kind: "rectangle", widthMm: 100, heightMm: 60, extrudeMm: 20 });
  const sketch = document.sketches["box01-sketch"];
  assert.equal(document.features["box01-extrude"].type, "extrude");
  assert.equal(document.features["box01-extrude"].distance, 20);
  assert.equal(document.bodies["box01-body"].tipFeatureId, "box01-extrude");
  assert.equal(sketch.dimensions.width.value, 100);
  assert.equal(sketch.dimensions.height.value, 60);
  assert.equal(solveSketch(sketch).status, "fully-constrained");
});

test("Today mainline quick circle authoring exposes a driving radius dimension", () => {
  const document = appendQuickPrimitive(createEmptyProfessionalCadDocument("authoring-circle", "Authoring"), { idPrefix: "cyl01", name: "Cylinder01", kind: "circle", diameterMm: 30, extrudeMm: 50 });
  const sketch = document.sketches["cyl01-sketch"];
  assert.equal(sketch.entities.circle.radius, 15);
  assert.equal(sketch.dimensions.radius.value, 15);
  assert.equal(solveSketch(sketch).status, "fully-constrained");
});
