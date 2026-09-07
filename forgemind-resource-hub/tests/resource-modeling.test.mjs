import test from "node:test";
import assert from "node:assert/strict";
import { instantiateResourceModelingPayload, instantiateResourceTemplate, mergeResourceInstantiation, nextResourceInsertionOffset, resourceBounds } from "../core/resource/ResourceModeling.ts";

const template = {
  resourceId: "fixture",
  resourceCode: "TEST-FIXTURE",
  resourceTitle: "测试工装",
  projectName: "测试工装项目",
  materialSpec: "碳钢 / Q235",
  density: 7850,
  tolerance: 0.05,
  process: "机加工",
  parts: [
    { id: "base", type: "box", label: "底座", x: 0, y: 0.1, z: 0, width: 1, height: 0.2, depth: 0.6, color: "#999999", metalness: 0.5, roughness: 0.3 },
    { id: "post", type: "box", label: "立柱", x: 0.25, y: 0.6, z: 0, width: 0.2, height: 1, depth: 0.2, color: "#888888", metalness: 0.5, roughness: 0.3 },
  ],
};

test("Resource modeling instantiation creates editable parts with durable provenance", () => {
  const result = instantiateResourceTemplate(template, [], { placement: "origin", instanceKey: "fixture-01" });
  assert.equal(result.parts.length, 2);
  assert.equal(result.parts[0].id, "fixture-01-base");
  assert.equal(result.parts[0].sourceResourceId, "fixture");
  assert.equal(result.parts[0].sourceResourceCode, "TEST-FIXTURE");
  assert.equal(result.parts[0].selected, true);
  assert.equal(result.parts[1].selected, false);
  assert.deepEqual(result.engineering[result.parts[0].id], {
    material: "碳钢 / Q235",
    density: 7850,
    tolerance: 0.05,
    process: "机加工",
    group: "资源库 / TEST-FIXTURE",
  });
});

test("Resource modeling insertion places incoming geometry beside the current model", () => {
  const existing = [{ id: "existing", type: "box", label: "Existing", x: 0, y: 0.5, z: 0, width: 2, height: 1, depth: 1, color: "#fff", metalness: 0, roughness: 1 }];
  const offset = nextResourceInsertionOffset(existing, template.parts, 0.5);
  const result = instantiateResourceTemplate(template, existing, { placement: "next-to-existing", instanceKey: "fixture-02", gapM: 0.5 });
  const existingBounds = resourceBounds(existing);
  const insertedBounds = resourceBounds(result.parts);
  assert.equal(offset.x > 0, true);
  assert.ok(insertedBounds.minX >= existingBounds.maxX + 0.499999);
  assert.ok(insertedBounds.minY >= -1e-12);
});

test("Resource modeling merge preserves existing parts and selects the new resource instance", () => {
  const existing = [{ id: "existing", type: "box", label: "Existing", x: 0, y: 0.5, z: 0, width: 1, height: 1, depth: 1, color: "#fff", metalness: 0, roughness: 1, selected: true }];
  const instance = instantiateResourceTemplate(template, existing, { placement: "next-to-existing", instanceKey: "fixture-03" });
  const merged = mergeResourceInstantiation(existing, { existing: { material: "A", density: 1, tolerance: 1, process: "P", group: "G" } }, instance);
  assert.equal(merged.parts.length, 3);
  assert.equal(merged.parts[0].selected, false);
  assert.equal(merged.activePartId, "fixture-03-base");
  assert.equal(merged.engineering.existing.material, "A");
  assert.equal(merged.engineering["fixture-03-base"].group, "资源库 / TEST-FIXTURE");
});

test("Resource bounds account for part extents rather than only part centers", () => {
  const bounds = resourceBounds(template.parts);
  assert.equal(bounds.minX, -0.5);
  assert.equal(bounds.maxX, 0.5);
  assert.equal(bounds.minY, 0);
  assert.equal(bounds.maxY, 1.1);
  assert.equal(bounds.width, 1);
  assert.equal(bounds.height, 1.1);
});


test("Resource Pack modeling payload remaps source engineering to new instance ids", () => {
  const result = instantiateResourceModelingPayload({
    resourceId: "packed", resourceCode: "PACK-01", resourceTitle: "打包资源", parts: template.parts,
    engineeringProperties: { base: { material: "铝合金 / 6061", density: 2700, tolerance: 0.02, process: "精加工", group: "原始分组" } },
    fallbackEngineering: { material: "碳钢 / Q235", density: 7850, tolerance: 0.1, process: "机加工", group: "资源包 / PACK-01" },
  }, [], { instanceKey: "packed-01" });
  assert.equal(result.parts[0].id, "packed-01-base");
  assert.equal(result.parts[0].sourceResourceCode, "PACK-01");
  assert.equal(result.engineering["packed-01-base"].material, "铝合金 / 6061");
  assert.equal(result.engineering["packed-01-base"].group, "原始分组");
  assert.equal(result.engineering["packed-01-post"].material, "碳钢 / Q235");
});
