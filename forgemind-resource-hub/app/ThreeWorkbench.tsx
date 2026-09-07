"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { createParametricPartGeometry } from "./cadGeometry";

export type PrimitiveKind = "box" | "cylinder" | "cone" | "torus";
export type ParametricPart = {
  id: string;
  selected?: boolean;
  locked?: boolean;
  hidden?: boolean;
  type: PrimitiveKind;
  label: string;
  x: number; y: number; z: number;
  rotationX?: number; rotationY?: number; rotationZ?: number;
  width: number; height: number; depth: number;
  color: string; metalness: number; roughness: number;
  /** Stable provenance for assets instantiated from the Resource Hub. */
  sourceResourceId?: string;
  sourceResourceCode?: string;
  sourceResourceTitle?: string;
};
export type SketchPlane = "top" | "front" | "right";
export type SketchPoint = { x: number; y: number };
export type SketchEntityKind = "line" | "circle" | "arc" | "spline" | "rectangle" | "construction" | "point";
export type SketchConstraintKind = "horizontal" | "vertical" | "fixed";
export type SketchExtrudeFeature = { operation: "extrude" | "pocket" | "revolve"; depth: number; bevel: number; enabled: boolean; targetId?: string; angle?: number; patternCount?: number; patternAngle?: number; patternMode?: "circular" | "linear"; patternSpacing?: number };
export type SketchOutline = { id: string; plane: SketchPlane; points: SketchPoint[]; kind?: SketchEntityKind; construction?: boolean; constraints?: SketchConstraintKind[]; feature?: SketchExtrudeFeature };

const disposeRenderable = (root: THREE.Object3D) => {
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh || node instanceof THREE.Line || node instanceof THREE.LineSegments)) return;
    node.geometry.dispose();
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    materials.forEach((material) => material.dispose());
  });
};

export function ThreeWorkbench({
  mode,
  parts,
  assetPath,
  uploadedModel,
  sketch,
  sketchDepth,
  sketchBevel = 0.035,
  accent,
  cameraView = "iso",
  cameraResetToken = 0,
  onPartContextSelect,
  onPartSelect,
  onPartTransform,
  transformMode = "translate",
  onModelStatus,
}: {
  mode: "parametric" | "sketch";
  parts: ParametricPart[];
  assetPath: string;
  uploadedModel: string | null;
  sketch: SketchOutline[];
  sketchDepth: number;
  sketchBevel?: number;
  accent: string;
  cameraView?: "iso" | "top" | "front" | "right";
  /** Increment to reframe the same standard view without changing the view id. */
  cameraResetToken?: number;
  onPartContextSelect?: (part: ParametricPart) => void;
  onPartSelect?: (part: ParametricPart) => void;
  onPartTransform?: (partId: string, transform: { x: number; y: number; z: number; rotationX: number; rotationY: number; rotationZ: number }) => void;
  transformMode?: "translate" | "rotate";
  onModelStatus?: (status: "idle" | "loading" | "ready" | "error") => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const refreshSketchSolids = useRef<(outlines: SketchOutline[]) => void>(() => undefined);
  const refreshParametricParts = useRef<(nextParts: ParametricPart[]) => void>(() => undefined);
  const setGizmoMode = useRef<(mode: "translate" | "rotate") => void>(() => undefined);
  const onPartContextSelectRef = useRef(onPartContextSelect);
  const onPartSelectRef = useRef(onPartSelect);
  const onPartTransformRef = useRef(onPartTransform);
  const onModelStatusRef = useRef(onModelStatus);
  useEffect(() => { onPartContextSelectRef.current = onPartContextSelect; }, [onPartContextSelect]);
  useEffect(() => { onPartSelectRef.current = onPartSelect; }, [onPartSelect]);
  useEffect(() => { onPartTransformRef.current = onPartTransform; }, [onPartTransform]);
  useEffect(() => { onModelStatusRef.current = onModelStatus; }, [onModelStatus]);
  useEffect(() => { setGizmoMode.current(transformMode); }, [transformMode]);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#d8ded4");
    const camera: THREE.PerspectiveCamera | THREE.OrthographicCamera = cameraView === "iso"
      ? new THREE.PerspectiveCamera(42, 1, 0.01, 1000)
      : new THREE.OrthographicCamera(-5, 5, 5, -5, 0.01, 1000);
    const viewPosition = cameraView === "top" ? new THREE.Vector3(0, 9, 0.01) : cameraView === "front" ? new THREE.Vector3(0, 2.4, 9) : cameraView === "right" ? new THREE.Vector3(9, 2.4, 0) : new THREE.Vector3(6, 4.8, 7);
    camera.position.copy(viewPosition);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    // The sketch viewport is an editing aid, so favour input responsiveness on
    // high-DPI displays while retaining the high-resolution parametric view.
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, mode === "sketch" ? 1.35 : 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = false;
    element.replaceChildren(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = .12;
    // A click selects; a left-drag rotates. Middle-drag is kept as an
    // alternative for CAD users, with right-drag used for panning.
    controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    controls.mouseButtons.MIDDLE = THREE.MOUSE.ROTATE;
    controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
    controls.enableRotate = true;
    controls.enablePan = true;
    controls.enableZoom = true;
    controls.rotateSpeed = .72;
    controls.panSpeed = .82;
    controls.zoomSpeed = .92;
    controls.target.set(0, cameraView === "top" ? 0 : .8, 0);
    controls.minDistance = 1;
    controls.maxDistance = 1000;
    controls.minPolarAngle = .02;
    controls.maxPolarAngle = Math.PI - .02;
    const transformControls = new TransformControls(camera, renderer.domElement);
    // Three r185 exposes the visible gizmo as a separate Object3D helper.
    // Adding the controls object itself is no longer supported.
    const transformHelper = transformControls.getHelper();
    transformControls.setMode(transformMode);
    transformControls.size = .82;
    scene.add(transformHelper);
    setGizmoMode.current = (nextMode) => transformControls.setMode(nextMode);
    transformControls.addEventListener("dragging-changed", (event) => { controls.enabled = !event.value; });

    // Imported industrial assets must keep the dimensions authored in their
    // source file.  Fit the camera to the imported bounds instead of scaling
    // the model into an arbitrary viewport-sized proxy.
    const fitCameraToObject = (object: THREE.Object3D) => {
      const bounds = new THREE.Box3().setFromObject(object);
      if (bounds.isEmpty()) return;
      const size = bounds.getSize(new THREE.Vector3());
      const center = bounds.getCenter(new THREE.Vector3());
      const largestDimension = Math.max(size.x, size.y, size.z, .001);
      const viewDirection = camera.position.clone().sub(controls.target).normalize();
      const fallbackDirection = cameraView === "top" ? new THREE.Vector3(0, 1, .001) : cameraView === "front" ? new THREE.Vector3(0, 0, 1) : cameraView === "right" ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(1, .7, 1).normalize();
      const direction = viewDirection.lengthSq() > .0001 ? viewDirection : fallbackDirection;
      if (camera instanceof THREE.OrthographicCamera) {
        const viewHeight = largestDimension * 1.35;
        const aspect = Math.max(.1, camera.right - camera.left) / Math.max(.1, camera.top - camera.bottom);
        camera.left = -(viewHeight * aspect) / 2;
        camera.right = (viewHeight * aspect) / 2;
        camera.top = viewHeight / 2;
        camera.bottom = -viewHeight / 2;
        camera.position.copy(center).addScaledVector(direction, largestDimension * 2);
      } else {
        const distance = (largestDimension / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2))) * 1.35;
        camera.position.copy(center).addScaledVector(direction, distance);
      }
      camera.near = Math.max(.001, largestDimension / 10_000);
      camera.far = Math.max(1_000, largestDimension * 100);
      camera.updateProjectionMatrix();
      controls.target.copy(center);
      controls.minDistance = Math.max(.01, largestDimension / 100);
      controls.maxDistance = Math.max(1_000, largestDimension * 100);
      controls.update();
    };

    const grid = new THREE.GridHelper(20, 20, "#9da9a1", "#bec8bf");
    scene.add(grid);
    const axes = new THREE.AxesHelper(1.2);
    axes.position.set(-8.5, 0.02, 8.5);
    scene.add(axes);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshStandardMaterial({ color: "#cfd7ce", roughness: 0.95, metalness: 0 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);
    scene.add(new THREE.HemisphereLight("#edf1e9", "#354640", 2.4));
    const key = new THREE.DirectionalLight("#fff5db", 2.6);
    key.position.set(4, 7, 5); key.castShadow = true; scene.add(key);
    const rim = new THREE.DirectionalLight(accent, 1.5);
    rim.position.set(-5, 3, -4); scene.add(rim);
    const modelRoot = new THREE.Group();
    scene.add(modelRoot);
    const parametricLayer = new THREE.Group();
    modelRoot.add(parametricLayer);
    const sketchLayer = new THREE.Group();
    modelRoot.add(sketchLayer);
    const numeric = (value: number, fallback = 1) => Number.isFinite(value) ? Math.max(Math.abs(value), 0.001) : fallback;
    let selectedMesh: THREE.Mesh | null = null;
    let hasInitialFrame = false;

    const addParametricPart = (part: ParametricPart) => {
      const width = numeric(part.width); const height = numeric(part.height); const depth = numeric(part.depth);
      const geometry = createParametricPartGeometry(part);
      const selected = Boolean(part.selected);
      const material = new THREE.MeshStandardMaterial({ color: part.color, metalness: Math.max(0, part.metalness), roughness: Math.max(0.03, part.roughness), emissive: selected ? new THREE.Color("#258f8a") : new THREE.Color("#000000"), emissiveIntensity: selected ? 0.55 : 0, transparent: !selected, opacity: selected ? 1 : 0.78 });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(part.x, part.y, part.z); mesh.rotation.set(THREE.MathUtils.degToRad(part.rotationX ?? 0), THREE.MathUtils.degToRad(part.rotationY ?? 0), THREE.MathUtils.degToRad(part.rotationZ ?? 0)); mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.visible = !part.hidden;
      mesh.userData.parametricPart = part;
      parametricLayer.add(mesh);
      const edge = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 25), new THREE.LineBasicMaterial({ color: selected ? "#2fc7c0" : "#182725", transparent: true, opacity: selected ? 1 : 0.22 }));
      edge.position.copy(mesh.position); edge.rotation.copy(mesh.rotation); edge.visible = !part.hidden; parametricLayer.add(edge);
      if (selected && !part.hidden) {
        if (!part.locked && onPartTransformRef.current) selectedMesh = mesh;
        const bounds = new THREE.Box3().setFromObject(mesh);
        parametricLayer.add(new THREE.Box3Helper(bounds, "#36d5cc"));
        const pivot = new THREE.AxesHelper(Math.max(width, height, depth) * 0.72);
        pivot.position.copy(mesh.position);
        parametricLayer.add(pivot);
      }
    };
    const updateParametricParts = (nextParts: ParametricPart[]) => {
      disposeRenderable(parametricLayer);
      parametricLayer.clear();
      selectedMesh = null;
      nextParts.forEach(addParametricPart);
      if (selectedMesh) transformControls.attach(selectedMesh); else transformControls.detach();
      // Position the first view around the actual device, not a hard-coded
      // world origin. Later selections and edits keep the user's camera pose.
      if (!hasInitialFrame && parametricLayer.children.length) {
        fitCameraToObject(parametricLayer);
        hasInitialFrame = true;
      }
      renderer.shadowMap.needsUpdate = true;
    };
    refreshParametricParts.current = updateParametricParts;
    const commitTransform = () => {
      const part = selectedMesh?.userData.parametricPart as ParametricPart | undefined;
      if (!part || !selectedMesh || !onPartTransformRef.current) return;
      onPartTransformRef.current(part.id, {
        x: selectedMesh.position.x,
        y: selectedMesh.position.y,
        z: selectedMesh.position.z,
        rotationX: THREE.MathUtils.radToDeg(selectedMesh.rotation.x),
        rotationY: THREE.MathUtils.radToDeg(selectedMesh.rotation.y),
        rotationZ: THREE.MathUtils.radToDeg(selectedMesh.rotation.z),
      });
    };
    transformControls.addEventListener("mouseUp", commitTransform);

    const addSketchSolids = (outlines: SketchOutline[]) => {
      disposeRenderable(sketchLayer);
      sketchLayer.clear();
      const profiles = outlines.filter((stroke) => !stroke.construction && stroke.feature?.enabled !== false && ["rectangle", "circle", "spline"].includes(stroke.kind ?? "spline") && stroke.points.length >= 3);
      const addPath = (path: THREE.Path, points: SketchPoint[]) => {
        path.moveTo(points[0].x, points[0].y);
        if (points.length > 8) path.splineThru(points.slice(1)); else points.slice(1).forEach((point) => path.lineTo(point.x, point.y));
        path.closePath();
      };
      outlines.forEach(({ id, points: outline, plane, kind = "spline", construction = false, feature }) => {
        // Reference geometry and open entities define the sketch but must never
        // create a solid.  Only closed profiles are eligible for extrusion.
        const operation = feature?.operation ?? "extrude";
        if (construction || feature?.enabled === false || operation === "pocket" || !["rectangle", "circle", "spline"].includes(kind) || outline.length < 3) return;
        // The editor retains every source point. The viewport only samples very
        // dense freehand paths so an in-progress stroke does not create thousands
        // of spline and bevel segments on every preview refresh.
        const previewLimit = 240;
        const stride = Math.max(1, Math.ceil(outline.length / previewLimit));
        const previewOutline = stride === 1 ? outline : outline.filter((_, index) => index % stride === 0 || index === outline.length - 1);
        const points = previewOutline.map((point) => new THREE.Vector2((point.x - 0.5) * 5, (0.5 - point.y) * 5));
        const shape = new THREE.Shape();
        addPath(shape, points);
        if (operation === "extrude") profiles.filter((candidate) => candidate.feature?.operation === "pocket" && candidate.feature.targetId === id && candidate.plane === plane).forEach((pocket) => {
          const pocketPoints = pocket.points.map((point) => new THREE.Vector2((point.x - .5) * 5, (.5 - point.y) * 5));
          if (pocketPoints.length < 3) return;
          const patternCount = Math.max(1, Math.min(24, Math.round(pocket.feature?.patternCount ?? 1)));
          const patternMode = pocket.feature?.patternMode ?? "circular";
          const patternAngle = Math.max(.1, Math.min(360, pocket.feature?.patternAngle ?? 360));
          const patternSpacing = Math.max(.001, Math.min(10, pocket.feature?.patternSpacing ?? .2));
          const step = patternCount < 2 ? 0 : THREE.MathUtils.degToRad(patternAngle >= 359.999 ? patternAngle / patternCount : patternAngle / (patternCount - 1));
          for (let instance = 0; instance < patternCount; instance += 1) {
            const holePoints = patternMode === "linear" ? pocketPoints.map((point) => point.clone().add(new THREE.Vector2(patternSpacing * instance, 0))) : pocketPoints.map((point) => point.clone().rotateAround(new THREE.Vector2(), step * instance));
            const hole = new THREE.Path(); addPath(hole, holePoints); shape.holes.push(hole);
          }
        });
        const featureDepth = feature?.depth ?? sketchDepth;
        const featureBevel = feature?.bevel ?? sketchBevel;
        const bevel = Math.min(numeric(featureBevel, 0.02), numeric(featureDepth) * 0.45);
        const geometry = operation === "revolve"
          ? new THREE.LatheGeometry(points.map((point) => new THREE.Vector2(Math.abs(point.x), point.y)), 96, 0, THREE.MathUtils.degToRad(Math.max(.1, Math.min(360, feature?.angle ?? 360))))
          : new THREE.ExtrudeGeometry(shape, {
              depth: numeric(featureDepth),
              bevelEnabled: bevel > 0.0001,
              bevelSegments: 3,
              bevelSize: bevel,
              bevelThickness: bevel,
              curveSegments: Math.min(128, Math.max(32, previewOutline.length)),
            });
        if (operation !== "revolve" && plane === "top") geometry.rotateX(-Math.PI / 2);
        else if (operation !== "revolve" && plane === "right") geometry.rotateY(Math.PI / 2);
        const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: accent, metalness: 0.58, roughness: 0.3 }));
        if (plane === "top") mesh.position.y = 0;
        mesh.castShadow = true; mesh.receiveShadow = true; sketchLayer.add(mesh);
        sketchLayer.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 20), new THREE.LineBasicMaterial({ color: "#172724", opacity: 0.48, transparent: true })));
      });
      renderer.shadowMap.needsUpdate = true;
    };
    refreshSketchSolids.current = addSketchSolids;

    let cancelled = false;
    const normalizeImported = (imported: THREE.Object3D) => {
      const box = new THREE.Box3().setFromObject(imported);
      const center = box.getCenter(new THREE.Vector3());
      imported.position.x -= center.x;
      imported.position.z -= center.z;
      imported.position.y -= box.min.y;
      imported.updateMatrixWorld(true);
      imported.traverse((node) => { if (node instanceof THREE.Mesh) { node.castShadow = true; node.receiveShadow = true; } });
      modelRoot.add(imported);
      fitCameraToObject(imported);
      hasInitialFrame = true;
    };
    if (mode === "sketch") {
      updateParametricParts(parts); addSketchSolids(sketch); onModelStatusRef.current?.("ready");
    }
    else if (uploadedModel || assetPath !== "procedural") {
      onModelStatusRef.current?.("loading");
      new GLTFLoader().load(uploadedModel ?? assetPath, (gltf) => { if (!cancelled) { normalizeImported(gltf.scene); onModelStatusRef.current?.("ready"); } }, undefined, () => { if (!cancelled) { updateParametricParts(parts); onModelStatusRef.current?.("error"); } });
    } else { updateParametricParts(parts); onModelStatusRef.current?.("ready"); }

      const resize = () => {
      const { width, height } = element.getBoundingClientRect();
      renderer.setSize(Math.max(1, width), Math.max(1, height), false);
      const aspect = Math.max(1, width) / Math.max(1, height);
      if (camera instanceof THREE.OrthographicCamera) {
        const viewHeight = camera.top - camera.bottom;
        camera.left = -(viewHeight * aspect) / 2;
        camera.right = (viewHeight * aspect) / 2;
      } else camera.aspect = aspect;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize); observer.observe(element); resize();
    const raycaster = new THREE.Raycaster();
    const pickPart = (event: MouseEvent) => {
      const isContextMenu = event.type === "contextmenu";
      if (isContextMenu && !onPartContextSelectRef.current) return;
      if (!isContextMenu && !onPartSelectRef.current) return;
      if (isContextMenu) event.preventDefault();
      const bounds = renderer.domElement.getBoundingClientRect();
      const pointer = new THREE.Vector2(((event.clientX - bounds.left) / bounds.width) * 2 - 1, -((event.clientY - bounds.top) / bounds.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(modelRoot.children, true).find((intersection) => intersection.object.userData.parametricPart) ?? null;
      if (!hit) return;
      const part = hit.object.userData.parametricPart as ParametricPart;
      if (isContextMenu) onPartContextSelectRef.current?.(part);
      else onPartSelectRef.current?.(part);
    };
    renderer.domElement.addEventListener("contextmenu", pickPart);
    renderer.domElement.addEventListener("click", pickPart);
    let frame = 0;
    let disposed = false;
    const render = () => { controls.update(); renderer.render(scene, camera); frame = requestAnimationFrame(render); };
    render();
    return () => {
      // React development mode and viewport-mode switches can both request a
      // cleanup. Make the Three.js teardown idempotent so the second request
      // never calls removeEventListener/dispose on an already released control.
      if (disposed) return;
      disposed = true;
      cancelled = true;
      refreshSketchSolids.current = () => undefined;
      refreshParametricParts.current = () => undefined;
      setGizmoMode.current = () => undefined;
      cancelAnimationFrame(frame);
      observer.disconnect();
      const canvas = renderer.domElement;
      canvas?.removeEventListener?.("contextmenu", pickPart);
      canvas?.removeEventListener?.("click", pickPart);
      transformControls.removeEventListener("mouseUp", commitTransform);
      transformControls.detach();
      transformControls.disconnect();
      scene.remove(transformHelper);
      // TransformControls.dispose() in the installed Three r185 build can
      // throw while tearing down its internal root during React mode changes.
      // The helper owns the same renderables, so dispose them directly after
      // disconnecting the DOM listeners.
      disposeRenderable(transformHelper);
      controls.dispose();
      disposeRenderable(scene);
      renderer.dispose();
      if (canvas?.parentElement === element) element.replaceChildren();
    };
    // Sketch geometry and parametric parts refresh in their own layers below so
    // normal editing never re-creates the renderer, controls, grid or lights.
  // Renderer ownership is initialized once for this asset/view combination;
  // the focused effects below update parts and sketches without rebuilding it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accent, assetPath, cameraResetToken, cameraView, mode, uploadedModel]);

  useEffect(() => {
    if (mode === "sketch") refreshSketchSolids.current(sketch);
  }, [accent, mode, sketch, sketchBevel, sketchDepth]);

  useEffect(() => {
    if (mode === "sketch" || (!uploadedModel && assetPath === "procedural")) refreshParametricParts.current(parts);
  }, [assetPath, mode, parts, uploadedModel]);

  return <div ref={host} className="three-workbench" aria-label="可旋转的三维模型预览" />;
}
