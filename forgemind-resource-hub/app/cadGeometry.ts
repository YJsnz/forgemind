import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { ParametricPart } from "./ThreeWorkbench";

const safeDimension = (value: number, fallback = 1) => Number.isFinite(value) ? Math.max(Math.abs(value), 0.001) : fallback;

/**
 * The single source of truth for editable primitive geometry.
 *
 * The workbench and the GLB exporter both call this function.  Keeping the
 * geometry here prevents an on-screen rounded box from silently becoming a
 * sharp-cornered box, or a smooth cylinder from exporting at a lower tessellation.
 */
export const createParametricPartGeometry = (part: ParametricPart): THREE.BufferGeometry => {
  const width = safeDimension(part.width);
  const height = safeDimension(part.height);
  const depth = safeDimension(part.depth);

  if (part.type === "cylinder") {
    const geometry = new THREE.CylinderGeometry(.5, .5, height, 96, 4, false);
    geometry.scale(width, 1, depth);
    return geometry;
  }
  if (part.type === "cone") {
    const geometry = new THREE.ConeGeometry(.5, height, 96, 4);
    geometry.scale(width, 1, depth);
    return geometry;
  }
  if (part.type === "torus") {
    const geometry = new THREE.TorusGeometry(.35, .15, 32, 128);
    geometry.rotateX(Math.PI / 2);
    geometry.scale(width, height / .3, depth);
    return geometry;
  }
  return new RoundedBoxGeometry(width, height, depth, 6, Math.min(width, height, depth) * 0.08);
};
