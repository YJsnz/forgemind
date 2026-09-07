import * as THREE from "three";

import type { KernelTessellation, KernelTopologyRef } from "../../core/kernel/KernelTypes.ts";

const tessellationFor = (mesh: THREE.Mesh): KernelTessellation | undefined => {
  const candidate = mesh.userData.tessellation as KernelTessellation | undefined;
  return candidate?.indices && candidate?.triangleFaceIndices && candidate?.faces ? candidate : undefined;
};

const topologyMatches = (left: KernelTopologyRef, right: KernelTopologyRef): boolean =>
  left.shapeId === right.shapeId
  && left.shapeRevision === right.shapeRevision
  && left.kind === right.kind
  && left.localId === right.localId;

const ensureFaceMaterialSlots = (mesh: THREE.Mesh): boolean => {
  const current = Array.isArray(mesh.material) ? mesh.material.filter((material: THREE.Material): material is THREE.Material => material instanceof THREE.Material) : [mesh.material];
  const primary = current[0];
  if (!primary) return false;
  const selected = mesh.userData.selectedFaceMaterial;
  mesh.material = [primary, current[1] ?? (selected instanceof THREE.Material ? selected : primary)];
  return true;
};

export const resetCadFaceHighlights = (meshes: THREE.Mesh[]): void => {
  for (const mesh of meshes) {
    const geometry = mesh.geometry;
    const tessellation = tessellationFor(mesh);
    if (!(geometry instanceof THREE.BufferGeometry) || !tessellation) continue;
    geometry.clearGroups();
    geometry.addGroup(0, tessellation.indices.length, 0);
  }
};

export const highlightCadFace = (meshes: THREE.Mesh[], mesh: THREE.Mesh, triangleIndex: number): boolean => {
  resetCadFaceHighlights(meshes);
  const geometry = mesh.geometry;
  const tessellation = tessellationFor(mesh);
  const selectedFaceIndex = tessellation?.triangleFaceIndices[triangleIndex];
  if (!(geometry instanceof THREE.BufferGeometry) || !tessellation || selectedFaceIndex === undefined || selectedFaceIndex >= tessellation.faces.length || !ensureFaceMaterialSlots(mesh)) return false;

  geometry.clearGroups();
  for (let triangle = 0; triangle < tessellation.triangleFaceIndices.length; triangle += 1) {
    geometry.addGroup(triangle * 3, 3, tessellation.triangleFaceIndices[triangle] === selectedFaceIndex ? 1 : 0);
  }
  return true;
};

export const highlightCadTopologyFace = (meshes: THREE.Mesh[], topology: KernelTopologyRef): boolean => {
  resetCadFaceHighlights(meshes);
  const mesh = meshes.find((entry) => tessellationFor(entry)?.faces.some((face) => topologyMatches(face.topology, topology)));
  if (!mesh || !ensureFaceMaterialSlots(mesh)) return false;
  const tessellation = tessellationFor(mesh)!;
  const selectedFaceIndex = tessellation.faces.findIndex((face) => topologyMatches(face.topology, topology));
  if (selectedFaceIndex < 0) return false;

  const geometry = mesh.geometry as THREE.BufferGeometry;
  geometry.clearGroups();
  for (let triangle = 0; triangle < tessellation.triangleFaceIndices.length; triangle += 1) {
    geometry.addGroup(triangle * 3, 3, tessellation.triangleFaceIndices[triangle] === selectedFaceIndex ? 1 : 0);
  }
  return true;
};

export const applyCadBodySelection = (meshes: THREE.Mesh[], bodyColors: ReadonlyMap<string, THREE.Color>, selectedBodyId: string): void => {
  const fallbackColor = new THREE.Color("#65d68a");
  for (const mesh of meshes) {
    const bodyId = String(mesh.userData.bodyId ?? "");
    const material = mesh.userData.baseMaterial;
    if (!(material instanceof THREE.MeshStandardMaterial)) continue;
    material.color.copy(bodyColors.get(bodyId) ?? fallbackColor);
    material.emissive.set(bodyId === selectedBodyId ? 0x153d5b : 0x000000);
    material.emissiveIntensity = bodyId === selectedBodyId ? .6 : 0;
  }
};
