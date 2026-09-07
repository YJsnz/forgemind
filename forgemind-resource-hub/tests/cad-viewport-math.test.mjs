import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";

import { computeCadCameraFrame, computeCadGridSpec, standardCadViewVectors } from "../app/kernel-debug/CadViewportMath.ts";

test("CAD camera fit honors both projected viewport axes", () => {
  const box = new THREE.Box3(new THREE.Vector3(-5, -1, -.5), new THREE.Vector3(5, 1, .5));
  const direction = new THREE.Vector3(0, 0, 1);
  const up = new THREE.Vector3(0, 1, 0);
  const wide = computeCadCameraFrame(box, direction, up, 42, 2);
  const narrow = computeCadCameraFrame(box, direction, up, 42, .5);
  assert.ok(wide && narrow);
  assert.ok(narrow.distance > wide.distance);
  assert.deepEqual(wide.center.toArray(), [0, 0, 0]);
});

test("CAD camera fit remains finite when current direction is parallel to preferred up", () => {
  const box = new THREE.Box3(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 4, 1));
  const frame = computeCadCameraFrame(box, new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 1, 0), 42, 1.4);
  assert.ok(frame);
  assert.ok([frame.distance, frame.near, frame.far, ...frame.cameraUp.toArray()].every(Number.isFinite));
  assert.ok(Math.abs(frame.cameraUp.dot(frame.viewDirection)) < 1e-10);
});

test("standard CAD views and adaptive grid produce stable engineering framing", () => {
  for (const view of ["iso", "front", "top", "right"]) {
    const vectors = standardCadViewVectors(view);
    assert.ok(vectors.direction.length() > 0);
    assert.ok(Math.abs(vectors.direction.clone().normalize().dot(vectors.up.clone().normalize())) < 1);
  }
  const box = new THREE.Box3(new THREE.Vector3(10, 2, -5), new THREE.Vector3(30, 12, 15));
  const grid = computeCadGridSpec(box);
  assert.ok(grid);
  assert.ok(grid.size >= 20);
  assert.ok(grid.divisions >= 8 && grid.divisions <= 32);
  assert.equal(grid.position.x, 20);
  assert.equal(grid.position.z, 5);
  assert.ok(grid.position.y < box.min.y);
});
