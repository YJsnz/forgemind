import * as THREE from "three";

import type { KernelTessellation } from "../kernel/KernelTypes.ts";

/** The shared viewport scale: one Three.js world unit represents one metre. */
export const MM_PER_WORLD_UNIT = 1000;

export const mmToWorld = (millimetres: number): number => millimetres / MM_PER_WORLD_UNIT;
export const worldToMm = (worldUnits: number): number => worldUnits * MM_PER_WORLD_UNIT;

/** Copies immutable CAD tessellation into a render-only Three.js geometry. */
export const kernelTessellationToBufferGeometry = (tessellation: KernelTessellation): THREE.BufferGeometry => {
  if (tessellation.positions.length % 3 !== 0 || tessellation.normals.length !== tessellation.positions.length) {
    throw new Error("Kernel tessellation has invalid position or normal data.");
  }
  const positions = new Float32Array(tessellation.positions.length);
  for (let index = 0; index < tessellation.positions.length; index += 1) {
    positions[index] = mmToWorld(tessellation.positions[index]);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(tessellation.normals), 3));
  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(tessellation.indices), 1));
  geometry.computeBoundingSphere();
  return geometry;
};
