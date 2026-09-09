import test from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import * as THREE from "three";

import { cloneReferenceModelTemplate, disposeReferenceModelInstance } from "../app/kernel-debug/ReferenceModelCache.ts";

test("reference model instances reuse immutable geometry but isolate presentation materials", () => {
  const template = new THREE.Group();
  const geometry = new THREE.BoxGeometry(1, 2, 3);
  const templateMaterial = new THREE.MeshStandardMaterial({ color: 0x336699 });
  template.add(new THREE.Mesh(geometry, templateMaterial));

  const instance = cloneReferenceModelTemplate(template);
  const instanceMesh = instance.children[0];
  assert.ok(instanceMesh instanceof THREE.Mesh);
  assert.equal(instanceMesh.geometry, geometry);
  assert.notEqual(instanceMesh.material, templateMaterial);

  let instanceDisposed = false;
  let templateDisposed = false;
  instanceMesh.material.addEventListener("dispose", () => { instanceDisposed = true; });
  templateMaterial.addEventListener("dispose", () => { templateDisposed = true; });
  disposeReferenceModelInstance(instance);
  assert.equal(instanceDisposed, true);
  assert.equal(templateDisposed, false);
  geometry.dispose();
  templateMaterial.dispose();
});

test("precision demonstration GLB assets remain present and substantial", async () => {
  const assets = [
    ["../public/models/industrial/cnc_machining_center.glb", 10_000_000],
    ["../public/models/industrial/robot_cell.glb", 5_000_000],
    ["../public/models/industrial/roller_conveyor.glb", 3_000_000],
    ["../public/models/robot_arm_6dof_white.glb", 1_000_000],
  ];
  for (const [path, minimumBytes] of assets) {
    const info = await stat(new URL(path, import.meta.url));
    assert.ok(info.size >= minimumBytes, `${path} must retain its detailed presentation data`);
  }

  const demoSource = await readFile(new URL("../core/demo/ComprehensiveDemoProject.ts", import.meta.url), "utf8");
  assert.match(demoSource, /自适应精密装配与检测中心/);
  assert.match(demoSource, /smart-cell-nurbs-surface/);

  const workbenchSource = await readFile(new URL("../app/kernel-debug/OcctKernelDebug.tsx", import.meta.url), "utf8");
  assert.match(workbenchSource, /loadCachedReferenceModel/);
  assert.doesNotMatch(workbenchSource, /new GLTFLoader/);

  const cacheSource = await readFile(new URL("../app/kernel-debug/ReferenceModelCache.ts", import.meta.url), "utf8");
  assert.match(cacheSource, /import\("three\/examples\/jsm\/loaders\/GLTFLoader\.js"\)/);
});

test("all bundled ForgeHub GLB models are selectable and copied into the production build", async () => {
  const manifest = JSON.parse(await readFile(new URL("../public/models/industrial/manifest.json", import.meta.url), "utf8"));
  const relativePaths = [
    ...manifest.components.map((component) => `industrial/${component.file}`),
    "forklift_agv.glb",
    "robot_arm_6dof_white.glb",
  ];
  assert.equal(relativePaths.length, 13);

  const pageSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  for (const relativePath of relativePaths) {
    const publicAsset = new URL(`../public/models/${relativePath}`, import.meta.url);
    const builtAsset = new URL(`../dist/client/models/${relativePath}`, import.meta.url);
    assert.ok((await stat(publicAsset)).size > 0, `${relativePath} must exist in ForgeHub public assets`);
    assert.ok((await stat(builtAsset)).size > 0, `${relativePath} must be copied into the ForgeHub production build`);
    assert.match(pageSource, new RegExp(relativePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${relativePath} must be selectable in the reference model list`);
  }
});
