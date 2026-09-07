import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";

import {
  applyCadInspectionMaterial,
  clearCadInspectionOverlay,
  createCadZebraMaterial,
  populateCadCurvatureComb,
  populateCadSurfaceHeatmap,
} from "../app/kernel-debug/CadViewportInspection.ts";
import {
  applyCadBodySelection,
  highlightCadFace,
  highlightCadTopologyFace,
  resetCadFaceHighlights,
} from "../app/kernel-debug/CadViewportSelection.ts";

const topology = (localId) => ({ shapeId: "shape-1", shapeRevision: 1, kind: "face", localId });

const createFaceMesh = (bodyId = "body-a") => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([
    0, 0, 0, 1, 0, 0, 0, 1, 0,
    1, 0, 0, 1, 1, 0, 0, 1, 0,
  ], 3));
  geometry.setIndex([0, 1, 2, 3, 4, 5]);
  const baseMaterial = new THREE.MeshStandardMaterial({ color: 0x445566 });
  const selectedFaceMaterial = new THREE.MeshStandardMaterial({ color: 0xffcc33 });
  const zebraMaterial = createCadZebraMaterial();
  const mesh = new THREE.Mesh(geometry, [baseMaterial, selectedFaceMaterial]);
  mesh.userData = {
    bodyId,
    baseMaterial,
    selectedFaceMaterial,
    zebraMaterial,
    tessellation: {
      positions: new Float32Array(18),
      normals: new Float32Array(18),
      indices: new Uint32Array([0, 1, 2, 3, 4, 5]),
      triangleFaceIndices: new Uint32Array([0, 1]),
      faces: [{ topology: topology("face-a") }, { topology: topology("face-b") }],
    },
  };
  return mesh;
};

test("CAD viewport face highlighting isolates one topology and can reset safely", () => {
  const mesh = createFaceMesh();
  assert.equal(highlightCadFace([mesh], mesh, 1), true);
  assert.deepEqual(mesh.geometry.groups.map((group) => group.materialIndex), [0, 1]);
  assert.equal(highlightCadTopologyFace([mesh], topology("face-a")), true);
  assert.deepEqual(mesh.geometry.groups.map((group) => group.materialIndex), [1, 0]);
  assert.equal(highlightCadTopologyFace([mesh], topology("missing")), false);
  assert.deepEqual(mesh.geometry.groups, [{ start: 0, count: 6, materialIndex: 0 }], "a stale topology must clear the previous highlight");
  assert.equal(highlightCadFace([mesh], mesh, 99), false);
  assert.deepEqual(mesh.geometry.groups, [{ start: 0, count: 6, materialIndex: 0 }], "an invalid triangle must not leave a stale highlight");
  resetCadFaceHighlights([mesh]);
  assert.deepEqual(mesh.geometry.groups, [{ start: 0, count: 6, materialIndex: 0 }]);
});

test("CAD body selection tolerates display-only meshes without CAD materials", () => {
  const selected = createFaceMesh("body-a");
  const displayOnly = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  displayOnly.userData.bodyId = "reference-model";
  assert.doesNotThrow(() => applyCadBodySelection([selected, displayOnly], new Map([["body-a", new THREE.Color(0xabcdef)]]), "body-a"));
  assert.equal(selected.userData.baseMaterial.color.getHex(), 0xabcdef);
  assert.equal(selected.userData.baseMaterial.emissive.getHex(), 0x153d5b);
  assert.equal(selected.userData.baseMaterial.emissiveIntensity, .6);
  applyCadBodySelection([selected], new Map(), "body-b");
  assert.equal(selected.userData.baseMaterial.color.getHex(), 0x65d68a, "missing palette entries restore the CAD fallback color");
  assert.equal(selected.userData.baseMaterial.emissiveIntensity, 0);
});

test("surface inspection switches materials without corrupting incomplete viewport entries", () => {
  const mesh = createFaceMesh();
  const incomplete = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
  incomplete.userData.baseMaterial = incomplete.material;
  applyCadInspectionMaterial([mesh, incomplete], true);
  assert.equal(mesh.material[0], mesh.userData.zebraMaterial);
  applyCadInspectionMaterial([mesh, incomplete], false);
  assert.equal(mesh.material[0], mesh.userData.baseMaterial);
  assert.ok(Array.isArray(incomplete.material));
  assert.equal(incomplete.material[0], incomplete.material[1], "both face-group slots stay visible when no highlight material exists");
});

test("surface heatmap and curvature comb reject invalid samples and dispose overlays", () => {
  const overlay = new THREE.Group();
  const sample = (x, mean) => ({ pointMm: { x, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 }, u: 0, v: 0, curvature: { min: mean, max: mean, gaussian: 0, mean } });
  assert.equal(populateCadSurfaceHeatmap(overlay, [sample(0, -1), sample(10, 1), sample(Number.NaN, 0)]), 2);
  assert.ok(overlay.children[0] instanceof THREE.Points);
  let disposed = 0;
  overlay.children[0].geometry.addEventListener("dispose", () => { disposed += 1; });
  const sharedMaterial = overlay.children[0].material;
  const duplicate = new THREE.Points(overlay.children[0].geometry, sharedMaterial);
  overlay.add(duplicate);
  let materialDisposed = 0;
  sharedMaterial.addEventListener("dispose", () => { materialDisposed += 1; });
  clearCadInspectionOverlay(overlay);
  assert.equal(overlay.children.length, 0);
  assert.equal(disposed, 1);
  assert.equal(materialDisposed, 1);

  const station = (x, grade, direction, magnitude) => ({ pointMm: { x, y: 0, z: 0 }, parameterRatio: 0, grade, combDirection: direction, combMagnitude: magnitude });
  const bounds = new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));
  assert.equal(populateCadCurvatureComb(overlay, [
    station(0, "G2", { x: 0, y: 1, z: 0 }, .1),
    station(1, "G0", { x: 0, y: 0, z: 0 }, .2),
    station(2, "G1", { x: 1, y: 0, z: 0 }, Number.NaN),
    station(3, "G1", { x: 1, y: 0, z: 0 }, -.1),
  ], bounds), 1);
  assert.ok(overlay.children[0] instanceof THREE.LineSegments);
  clearCadInspectionOverlay(overlay);
});
