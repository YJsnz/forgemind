import * as THREE from "three";

import type { KernelEdgeContinuityStation, KernelSurfacePointAnalysis } from "../../core/kernel/KernelTypes.ts";
import { mmToWorld } from "../../core/viewport/KernelMeshAdapter.ts";

const materialFromUserData = (mesh: THREE.Mesh, key: "baseMaterial" | "selectedFaceMaterial" | "zebraMaterial"): THREE.Material | undefined => {
  const material = mesh.userData[key];
  return material instanceof THREE.Material ? material : undefined;
};

const finitePoint = (point: { x: number; y: number; z: number }): boolean =>
  Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z);

export const createCadZebraMaterial = (clippingPlanes: THREE.Plane[] = []): THREE.ShaderMaterial => new THREE.ShaderMaterial({
  side: THREE.DoubleSide,
  clipping: true,
  clippingPlanes,
  vertexShader: `
    #include <clipping_planes_pars_vertex>
    varying vec3 vViewNormal;
    varying vec3 vViewPosition;
    void main() {
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      vViewPosition = mvPosition.xyz;
      vViewNormal = normalize(normalMatrix * normal);
      gl_Position = projectionMatrix * mvPosition;
      #include <clipping_planes_vertex>
    }
  `,
  fragmentShader: `
    #include <clipping_planes_pars_fragment>
    varying vec3 vViewNormal;
    varying vec3 vViewPosition;
    void main() {
      #include <clipping_planes_fragment>
      vec3 normalDirection = normalize(vViewNormal);
      vec3 viewDirection = normalize(-vViewPosition);
      vec3 reflectionDirection = reflect(-viewDirection, normalDirection);
      float coordinate = reflectionDirection.x * 0.72 + reflectionDirection.y + reflectionDirection.z * 0.31;
      float wave = 0.5 + 0.5 * sin(coordinate * 52.0);
      float stripe = smoothstep(0.42, 0.58, wave);
      float grazing = pow(1.0 - abs(dot(normalDirection, viewDirection)), 2.0);
      vec3 darkBand = vec3(0.025, 0.035, 0.033);
      vec3 lightBand = vec3(0.94, 0.96, 0.91);
      vec3 color = mix(darkBand, lightBand, stripe);
      color = mix(color, vec3(0.20, 0.72, 0.68), grazing * 0.22);
      gl_FragColor = vec4(color, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `,
});

export const clearCadInspectionOverlay = (overlay: THREE.Group): void => {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  for (const child of [...overlay.children]) {
    overlay.remove(child);
    child.traverse((node: THREE.Object3D) => {
      if (!(node instanceof THREE.Points || node instanceof THREE.LineSegments || node instanceof THREE.Line)) return;
      geometries.add(node.geometry);
      (Array.isArray(node.material) ? node.material : [node.material]).forEach((material: THREE.Material) => materials.add(material));
    });
  }
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
};

export const applyCadInspectionMaterial = (meshes: THREE.Mesh[], zebra: boolean): void => {
  for (const mesh of meshes) {
    const primary = materialFromUserData(mesh, zebra ? "zebraMaterial" : "baseMaterial");
    const selected = materialFromUserData(mesh, "selectedFaceMaterial");
    if (!primary) continue;
    // Keep both geometry material slots valid. A missing highlight material
    // must never make triangles assigned to group 1 disappear.
    mesh.material = [primary, selected ?? primary];
  }
};

export const populateCadSurfaceHeatmap = (overlay: THREE.Group, samples: KernelSurfacePointAnalysis[]): number => {
  const drawable = samples.filter((sample) => finitePoint(sample.pointMm) && Number.isFinite(sample.curvature.mean));
  if (!drawable.length) return 0;

  const positions = new Float32Array(drawable.length * 3);
  const colors = new Float32Array(drawable.length * 3);
  let maxAbs = 1e-9;
  for (const sample of drawable) maxAbs = Math.max(maxAbs, Math.abs(sample.curvature.mean));
  const negativeStart = new THREE.Color(0x2784d6), negativeEnd = new THREE.Color(0x53c7b8);
  const positiveStart = new THREE.Color(0xf2d65c), positiveEnd = new THREE.Color(0xd84a3a);
  const color = new THREE.Color();
  drawable.forEach((sample, index) => {
    positions.set([mmToWorld(sample.pointMm.x), mmToWorld(sample.pointMm.y), mmToWorld(sample.pointMm.z)], index * 3);
    const signed = THREE.MathUtils.clamp(sample.curvature.mean / maxAbs, -1, 1);
    if (signed < 0) color.copy(negativeStart).lerp(negativeEnd, signed + 1);
    else color.copy(positiveStart).lerp(positiveEnd, signed);
    colors.set([color.r, color.g, color.b], index * 3);
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  overlay.add(new THREE.Points(geometry, new THREE.PointsMaterial({ size: 6, sizeAttenuation: false, vertexColors: true, depthTest: false, depthWrite: false })));
  return drawable.length;
};

export const populateCadCurvatureComb = (overlay: THREE.Group, stations: KernelEdgeContinuityStation[], bounds: THREE.Box3): number => {
  const drawable = stations.filter((station) => {
    const direction = station.combDirection;
    return direction
      && finitePoint(station.pointMm)
      && finitePoint(direction)
      && station.combMagnitude !== undefined
      && Number.isFinite(station.combMagnitude)
      && station.combMagnitude >= 0
      && new THREE.Vector3(direction.x, direction.y, direction.z).lengthSq() > 1e-12;
  });
  if (!drawable.length) return 0;

  const measuredDiagonal = bounds.isEmpty() ? 0 : bounds.getSize(new THREE.Vector3()).length();
  const diagonal = Number.isFinite(measuredDiagonal) ? Math.max(measuredDiagonal, .1) : .1;
  let maxMagnitude = 1e-9;
  for (const station of drawable) maxMagnitude = Math.max(maxMagnitude, station.combMagnitude ?? 0);
  const positions = new Float32Array(drawable.length * 6);
  const colors = new Float32Array(drawable.length * 6);
  drawable.forEach((station, index) => {
    const start = new THREE.Vector3(mmToWorld(station.pointMm.x), mmToWorld(station.pointMm.y), mmToWorld(station.pointMm.z));
    const direction = new THREE.Vector3(station.combDirection!.x, station.combDirection!.y, station.combDirection!.z).normalize();
    const relative = Math.sqrt(Math.max(station.combMagnitude ?? 0, 0) / maxMagnitude);
    const end = start.clone().add(direction.multiplyScalar(diagonal * (.025 + relative * .085)));
    positions.set([start.x, start.y, start.z, end.x, end.y, end.z], index * 6);
    const color = new THREE.Color(station.grade === "G2" ? 0x43b97f : station.grade === "G1" ? 0xe0a832 : station.grade === "G0" ? 0xd75245 : 0x7b8b94);
    colors.set([color.r, color.g, color.b, color.r, color.g, color.b], index * 6);
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  overlay.add(new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, depthWrite: false, transparent: true, opacity: .95 })));
  return drawable.length;
};
