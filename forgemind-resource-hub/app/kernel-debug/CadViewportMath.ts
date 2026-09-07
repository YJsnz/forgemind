import * as THREE from "three";

import type { StandardCadView } from "./workbenchTypes";

export interface CadCameraFrame {
  center: THREE.Vector3;
  viewDirection: THREE.Vector3;
  cameraUp: THREE.Vector3;
  distance: number;
  near: number;
  far: number;
}

export interface CadGridSpec {
  size: number;
  divisions: number;
  position: THREE.Vector3;
}

const finiteDirection = (direction: THREE.Vector3): THREE.Vector3 =>
  direction.lengthSq() > 1e-12 ? direction.clone().normalize() : new THREE.Vector3(1, 1, -1).normalize();

const stableUp = (viewDirection: THREE.Vector3, preferredUp: THREE.Vector3): THREE.Vector3 => {
  let up = preferredUp.lengthSq() > 1e-12 ? preferredUp.clone().normalize() : new THREE.Vector3(0, 1, 0);
  if (Math.abs(viewDirection.dot(up)) > .999) {
    up = Math.abs(viewDirection.z) < .9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
  }
  return up;
};

/** Computes a projected-box fit without depending on a renderer or DOM size. */
export const computeCadCameraFrame = (
  box: THREE.Box3,
  direction: THREE.Vector3,
  preferredUp: THREE.Vector3,
  verticalFovDeg: number,
  aspect: number,
  padding = 1.48,
): CadCameraFrame | undefined => {
  if (box.isEmpty()) return undefined;
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const viewDirection = finiteDirection(direction);
  const up = stableUp(viewDirection, preferredUp);
  const cameraRight = new THREE.Vector3().crossVectors(viewDirection, up).normalize();
  const cameraUp = new THREE.Vector3().crossVectors(cameraRight, viewDirection).normalize();
  let halfWidth = 0;
  let halfHeight = 0;
  let halfDepth = 0;
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
    const offset = new THREE.Vector3(x, y, z).sub(center);
    halfWidth = Math.max(halfWidth, Math.abs(offset.dot(cameraRight)));
    halfHeight = Math.max(halfHeight, Math.abs(offset.dot(cameraUp)));
    halfDepth = Math.max(halfDepth, Math.abs(offset.dot(viewDirection)));
  }
  const halfVerticalFov = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(verticalFovDeg, 1, 179)) / 2;
  const tangent = Math.max(Math.tan(halfVerticalFov), 1e-6);
  const verticalDistance = halfHeight / tangent;
  const horizontalDistance = halfWidth / (tangent * Math.max(aspect, .01));
  const distance = Math.max(verticalDistance, horizontalDistance, .035) * Math.max(padding, 1) + halfDepth;
  return {
    center,
    viewDirection,
    cameraUp,
    distance,
    near: Math.max(distance / 2000, .0001),
    far: Math.max(distance + Math.max(size.length(), .1) * 8, 10),
  };
};

export const standardCadViewVectors = (view: StandardCadView): { direction: THREE.Vector3; up: THREE.Vector3 } => {
  if (view === "front") return { direction: new THREE.Vector3(0, 0, 1), up: new THREE.Vector3(0, 1, 0) };
  if (view === "top") return { direction: new THREE.Vector3(0, 1, 0), up: new THREE.Vector3(0, 0, -1) };
  if (view === "right") return { direction: new THREE.Vector3(1, 0, 0), up: new THREE.Vector3(0, 1, 0) };
  return { direction: new THREE.Vector3(1, 1, -1), up: new THREE.Vector3(0, 1, 0) };
};

export const computeCadGridSpec = (box: THREE.Box3): CadGridSpec | undefined => {
  if (box.isEmpty()) return undefined;
  const size = box.getSize(new THREE.Vector3());
  const span = Math.max(size.x, size.z, .2);
  const rawSize = span * 1.35;
  const power = Math.pow(10, Math.floor(Math.log10(rawSize)));
  const gridSize = Math.ceil(rawSize / power) * power;
  const divisions = THREE.MathUtils.clamp(Math.round(gridSize / (power / 2)), 8, 32);
  const center = box.getCenter(new THREE.Vector3());
  return {
    size: gridSize,
    divisions,
    position: new THREE.Vector3(center.x, box.min.y - Math.max(size.y * .015, .002), center.z),
  };
};
