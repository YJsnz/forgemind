import * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import type { CadDocument } from "../../core/cad/CadDocument";
import type { Feature } from "../../core/features/Feature";
import { bsplineSurfaceBoundaryMatches } from "../../core/features/BSplineSurfaceFeature";
import type { Sketch } from "../../core/sketch/Sketch";
import { bsplineBoundaryRequiredDepth } from "../../core/surface/BSplineControlNet";
import { resolveBSplineFeatureControlNet } from "../../core/surface/BSplineFeatureControlNet";
import { mmToWorld, worldToMm } from "../../core/viewport/KernelMeshAdapter";
import { constrainCadControlPointDrag } from "../../core/viewport/CadControlPointDrag";

export interface CadControlNetEdit {
  featureId: string;
  row: number;
  column: number;
  pointMm: { x: number; y: number; z: number };
}

export interface CadControlNetOverlay {
  group: THREE.Group;
  setActiveFeature: (featureId: string | undefined) => void;
  consumeClick: () => boolean;
  dispose: () => void;
  detach: () => void;
}

const pointLockedByBoundary = (feature: Extract<Feature, { type: "bsplineSurface" }>, row: number, column: number, rows: number, columns: number): boolean =>
  bsplineSurfaceBoundaryMatches(feature).some((match) => {
    const depth = bsplineBoundaryRequiredDepth(match.continuity);
    if (match.targetEdge === "uMin") return column < depth;
    if (match.targetEdge === "uMax") return column >= columns - depth;
    if (match.targetEdge === "vMin") return row < depth;
    return row >= rows - depth;
  });

const updateFeatureVisibility = (group: THREE.Group, featureId: string | undefined) => {
  group.children.forEach((child) => { child.visible = !!featureId && child.userData.featureId === featureId; });
};

type PoleRole = "position" | "tangent" | "curvature" | "shape";
const poleRole = (row: number, column: number, rows: number, columns: number): PoleRole => {
  const boundaryDepth = Math.min(row, column, rows - 1 - row, columns - 1 - column);
  if (boundaryDepth <= 0) return "position";
  if (boundaryDepth === 1) return "tangent";
  if (boundaryDepth === 2) return "curvature";
  return "shape";
};

/** Builds selectable control-pole handles from persisted B-Spline feature data.
 * Geometry edits are reported in millimetres; the overlay never mutates the
 * document and never becomes a source of CAD truth. */
export const createCadControlNetOverlay = (options: {
  document: CadDocument<Sketch, Feature>;
  camera: THREE.Camera;
  controls: OrbitControls;
  element: HTMLElement;
  requestRender: () => void;
  onCommit: (edit: CadControlNetEdit) => void;
}): CadControlNetOverlay => {
  const { document, camera, controls, element, requestRender, onCommit } = options;
  const group = new THREE.Group(); group.name = "cad-control-net-overlay";
  const handles: THREE.Mesh[] = []; const geometries: THREE.BufferGeometry[] = []; const materials: THREE.Material[] = [];
  const lineBindings = new Map<THREE.Mesh, { attribute: THREE.BufferAttribute; indices: number[] }>();
  const handleGeometry = new THREE.SphereGeometry(.0042, 14, 10); geometries.push(handleGeometry);
  const positionMaterial = new THREE.MeshBasicMaterial({ color: 0x39a7a2, depthTest: false });
  const tangentMaterial = new THREE.MeshBasicMaterial({ color: 0x4ba3ff, depthTest: false });
  const curvatureMaterial = new THREE.MeshBasicMaterial({ color: 0xb777e8, depthTest: false });
  const shapeMaterial = new THREE.MeshBasicMaterial({ color: 0xf0c34f, depthTest: false });
  const lockedMaterial = new THREE.MeshBasicMaterial({ color: 0x7c8f95, transparent: true, opacity: .7, depthTest: false });
  const lineMaterial = new THREE.LineBasicMaterial({ color: 0x39a7a2, transparent: true, opacity: .72, depthTest: false });
  const roleMaterials: Record<PoleRole, THREE.MeshBasicMaterial> = { position: positionMaterial, tangent: tangentMaterial, curvature: curvatureMaterial, shape: shapeMaterial };
  materials.push(positionMaterial, tangentMaterial, curvatureMaterial, shapeMaterial, lockedMaterial, lineMaterial);

  document.featureOrder.forEach((featureId) => {
    const feature = document.features[featureId]; if (!feature || feature.type !== "bsplineSurface") return;
    let controlNet;
    try { controlNet = resolveBSplineFeatureControlNet(document, featureId); } catch { return; }
    const rows = controlNet.length, columns = controlNet[0]?.length ?? 0; if (!rows || !columns) return;
    const positions: number[] = []; const vertexBindings = new Map<string, number[]>(); const featureHandles = new Map<string, THREE.Mesh>();
    const key = (row: number, column: number) => `${row}:${column}`;
    const bind = (pointKey: string, vertexIndex: number) => vertexBindings.set(pointKey, [...(vertexBindings.get(pointKey) ?? []), vertexIndex]);
    const segment = (a: typeof controlNet[number][number], b: typeof a, aKey: string, bKey: string) => {
      const first = positions.length / 3;
      positions.push(mmToWorld(a.x), mmToWorld(a.y), mmToWorld(a.z), mmToWorld(b.x), mmToWorld(b.y), mmToWorld(b.z));
      bind(aKey, first); bind(bKey, first + 1);
    };
    for (let row = 0; row < rows; row += 1) for (let column = 0; column < columns; column += 1) {
      const point = controlNet[row][column];
      if (column + 1 < columns) segment(point, controlNet[row][column + 1], key(row, column), key(row, column + 1));
      if (row + 1 < rows) segment(point, controlNet[row + 1][column], key(row, column), key(row + 1, column));
      const locked = pointLockedByBoundary(feature, row, column, rows, columns);
      const role = poleRole(row, column, rows, columns);
      const weight = feature.tensorNurbs?.weights[row]?.[column] ?? feature.rationalSections?.weights[row]?.[column] ?? 1;
      const handle = new THREE.Mesh(handleGeometry, locked ? lockedMaterial : roleMaterials[role]);
      handle.position.set(mmToWorld(point.x), mmToWorld(point.y), mmToWorld(point.z));
      handle.renderOrder = 30; handle.userData = { featureId, row, column, role, weight, editable: !locked };
      handle.onBeforeRender = (_renderer, _scene, renderCamera) => {
        const viewportHeight = Math.max(1, element.clientHeight); let worldRadius = .0042;
        if (renderCamera instanceof THREE.PerspectiveCamera) worldRadius = 7 * (2 * renderCamera.position.distanceTo(handle.position) * Math.tan(THREE.MathUtils.degToRad(renderCamera.fov) / 2) / viewportHeight);
        else if (renderCamera instanceof THREE.OrthographicCamera) worldRadius = 7 * ((renderCamera.top - renderCamera.bottom) / Math.max(.001, renderCamera.zoom) / viewportHeight);
        const weightScale = Math.max(.65, Math.min(1.8, Math.sqrt(Math.max(.01, Number(handle.userData.weight) || 1))));
        handle.scale.setScalar(Math.max(.35, Math.min(8, worldRadius / .0042)) * weightScale);
      };
      handle.visible = false; handles.push(handle); featureHandles.set(key(row, column), handle); group.add(handle);
    }
    const geometry = new THREE.BufferGeometry(); const attribute = new THREE.Float32BufferAttribute(positions, 3); geometry.setAttribute("position", attribute); geometries.push(geometry);
    vertexBindings.forEach((indices, pointKey) => { const handle = featureHandles.get(pointKey); if (handle) lineBindings.set(handle, { attribute, indices }); });
    const lines = new THREE.LineSegments(geometry, lineMaterial); lines.renderOrder = 29; lines.frustumCulled = false; lines.userData.featureId = featureId; lines.visible = false; group.add(lines);
  });

  const raycaster = new THREE.Raycaster(); const pointer = new THREE.Vector2(); const dragPlane = new THREE.Plane(); const planeNormal = new THREE.Vector3(); const hitPoint = new THREE.Vector3();
  let active: THREE.Mesh | undefined; let startPosition: THREE.Vector3 | undefined; let moved = false; let suppressClick = false;
  const updateBoundLines = (handle: THREE.Mesh, position: THREE.Vector3) => {
    const binding = lineBindings.get(handle); if (!binding) return;
    binding.indices.forEach((index) => binding.attribute.setXYZ(index, position.x, position.y, position.z)); binding.attribute.needsUpdate = true;
  };
  const setPointer = (event: PointerEvent) => { const bounds = element.getBoundingClientRect(); pointer.set((event.clientX - bounds.left) / Math.max(1, bounds.width) * 2 - 1, -(event.clientY - bounds.top) / Math.max(1, bounds.height) * 2 + 1); };
  const pointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return; setPointer(event); camera.updateMatrixWorld(); raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(handles.filter((handle) => handle.visible && handle.userData.editable), false)[0]; if (!hit) return;
    active = hit.object as THREE.Mesh; startPosition = active.position.clone(); moved = false; controls.enabled = false; element.style.cursor = "grabbing"; renderLoopInteraction(true);
    camera.getWorldDirection(planeNormal); dragPlane.setFromNormalAndCoplanarPoint(planeNormal, active.position); element.setPointerCapture?.(event.pointerId); event.preventDefault(); event.stopPropagation();
  };
  const pointerMove = (event: PointerEvent) => {
    if (!active) { setPointer(event); raycaster.setFromCamera(pointer, camera); element.style.cursor = raycaster.intersectObjects(handles.filter((handle) => handle.visible && handle.userData.editable), false).length ? "grab" : ""; return; }
    setPointer(event); raycaster.setFromCamera(pointer, camera); if (!raycaster.ray.intersectPlane(dragPlane, hitPoint)) return;
    const constrained = constrainCadControlPointDrag(
      { x: worldToMm(startPosition?.x ?? hitPoint.x), y: worldToMm(startPosition?.y ?? hitPoint.y), z: worldToMm(startPosition?.z ?? hitPoint.z) },
      { x: worldToMm(hitPoint.x), y: worldToMm(hitPoint.y), z: worldToMm(hitPoint.z) },
      { axisLock: event.shiftKey, snapMm: event.ctrlKey || event.metaKey ? .5 : undefined },
    );
    const next = new THREE.Vector3(mmToWorld(constrained.x), mmToWorld(constrained.y), mmToWorld(constrained.z));
    active.position.copy(next); updateBoundLines(active, next); moved = !!startPosition && active.position.distanceToSquared(startPosition) > 1e-14; requestRender(); event.preventDefault();
  };
  const endDrag = (commit: boolean, pointerId?: number) => {
    if (!active) return; const handle = active; const original = startPosition; active = undefined; startPosition = undefined; controls.enabled = true; element.style.cursor = ""; renderLoopInteraction(false);
    if (pointerId !== undefined && element.hasPointerCapture?.(pointerId)) element.releasePointerCapture(pointerId);
    if (!commit && original) { handle.position.copy(original); updateBoundLines(handle, original); moved = false; }
    if (commit && moved) {
      suppressClick = true;
      onCommit({ featureId: String(handle.userData.featureId), row: Number(handle.userData.row), column: Number(handle.userData.column), pointMm: { x: worldToMm(handle.position.x), y: worldToMm(handle.position.y), z: worldToMm(handle.position.z) } });
    }
    requestRender();
  };
  const finish = (event: PointerEvent) => endDrag(true, event.pointerId);
  const cancel = (event: PointerEvent) => endDrag(false, event.pointerId);
  const keyDown = (event: KeyboardEvent) => { if (event.key !== "Escape" || !active) return; event.preventDefault(); event.stopPropagation(); endDrag(false); };
  // OrbitControls owns the actual render loop; toggling it through synthetic
  // start/end events keeps damping active while a pole is dragged.
  const renderLoopInteraction = (value: boolean) => controls.dispatchEvent({ type: value ? "start" : "end" });
  element.addEventListener("pointerdown", pointerDown, true); element.addEventListener("pointermove", pointerMove, true); element.addEventListener("pointerup", finish, true); element.addEventListener("pointercancel", cancel, true); window.addEventListener("keydown", keyDown, true);
  const detach = () => { element.removeEventListener("pointerdown", pointerDown, true); element.removeEventListener("pointermove", pointerMove, true); element.removeEventListener("pointerup", finish, true); element.removeEventListener("pointercancel", cancel, true); window.removeEventListener("keydown", keyDown, true); element.style.cursor = ""; };
  return {
    group,
    setActiveFeature: (featureId) => { updateFeatureVisibility(group, featureId); requestRender(); },
    consumeClick: () => { const value = suppressClick; suppressClick = false; return value; },
    detach,
    dispose: () => { detach(); geometries.forEach((geometry) => geometry.dispose()); materials.forEach((material) => material.dispose()); group.clear(); },
  };
};
