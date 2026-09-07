import * as THREE from "three";

const referenceModelTemplates = new Map<string, Promise<THREE.Object3D>>();

const loadTemplate = (assetPath: string): Promise<THREE.Object3D> => {
  const cached = referenceModelTemplates.get(assetPath);
  if (cached) return cached;

  const pending = import("three/examples/jsm/loaders/GLTFLoader.js")
    .then(({ GLTFLoader }) => new GLTFLoader().loadAsync(assetPath))
    .then((gltf) => gltf.scene)
    .catch((error) => {
      referenceModelTemplates.delete(assetPath);
      throw error;
    });
  referenceModelTemplates.set(assetPath, pending);
  return pending;
};

/**
 * Reuses the parsed static GLB hierarchy while giving each viewport its own
 * material instances. Geometry remains immutable and shared; presentation
 * changes therefore cannot damage the detailed demonstration asset.
 */
export const cloneReferenceModelTemplate = (template: THREE.Object3D): THREE.Object3D => {
  const instance = template.clone(true);
  instance.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    const sourceMaterials = Array.isArray(node.material) ? node.material : [node.material];
    const instanceMaterials = sourceMaterials.map((material) => material.clone());
    node.material = Array.isArray(node.material) ? instanceMaterials : instanceMaterials[0];
  });
  return instance;
};

export const loadCachedReferenceModel = async (assetPath: string): Promise<THREE.Object3D> =>
  cloneReferenceModelTemplate(await loadTemplate(assetPath));

/** Dispose only per-viewport materials. Shared template geometry is retained. */
export const disposeReferenceModelInstance = (root: THREE.Object3D): void => {
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    (Array.isArray(node.material) ? node.material : [node.material]).forEach((material) => material.dispose());
  });
};
