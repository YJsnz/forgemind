using System.Collections.Generic;
using UnityEditor;
using UnityEngine;

namespace ForgeMind.Client.Editor
{
    /// <summary>
    /// Editor-side performance prep for the native client.
    ///
    /// 1. "Enable GPU Instancing on Model Materials" persistently switches the
    ///    shared glTFast materials of every GLB under Assets/ForgeMind/Models to
    ///    enableInstancing = true, so a built player batches identical static
    ///    models into one instanced draw call without any runtime mutation.
    /// 2. "Bake S03 Occlusion Culling" marks the S03 stress instances as
    ///    occludees and runs a synchronous occlusion bake for the S03 scene.
    /// </summary>
    public static class ForgeMindModelInstancing
    {
        [MenuItem("ForgeMind/Enable GPU Instancing on Model Materials")]
        public static void EnableInstancingOnModelMaterials()
        {
            var affected = new HashSet<Material>();
            var prefabCount = 0;
            foreach (var path in FindGlbPaths())
            {
                var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(path);
                if (prefab == null) continue;
                var renderers = prefab.GetComponentsInChildren<Renderer>(true);
                foreach (var renderer in renderers)
                {
                    if (renderer == null) continue;
                    foreach (var material in renderer.sharedMaterials)
                    {
                        if (material == null || !affected.Add(material)) continue;
                        if (!material.enableInstancing)
                        {
                            material.enableInstancing = true;
                            EditorUtility.SetDirty(material);
                        }
                    }
                }
                prefabCount++;
            }
            AssetDatabase.SaveAssets();
            Debug.Log($"ForgeMind GPU instancing enabled on {affected.Count} shared materials across {prefabCount} GLB prefabs.");
        }

        [MenuItem("ForgeMind/Bake S03 Occlusion Culling")]
        public static void BakeS03OcclusionCulling()
        {
            const string scenePath = "Assets/ForgeMind/Scenes/FactoryS03Performance.unity";
            var scene = UnityEditor.SceneManagement.EditorSceneManager.OpenScene(scenePath, UnityEditor.SceneManagement.OpenSceneMode.Single);
            MarkS03Occludees(scene);
            try
            {
                StaticOcclusionCulling.Compute();
            }
            catch (System.Exception error)
            {
                // Batchmode without a graphics device cannot bake; the scene is
                // still saved with occludee flags so a one-time interactive bake
                // (Window > Rendering > Occlusion Culling > Bake) completes it.
                Debug.LogWarning($"ForgeMind S03 occlusion bake unavailable here: {error.Message}");
            }
            UnityEditor.SceneManagement.EditorSceneManager.SaveScene(scene);
            Debug.Log($"ForgeMind S03 occlusion bake finished. isRunning={StaticOcclusionCulling.isRunning}");
        }

        [MenuItem("ForgeMind/Prepare and Build S03 Optimized Player")]
        public static void PrepareAndBuildS03OptimizedPlayer()
        {
            EnableInstancingOnModelMaterials();
            ForgeMindProjectBootstrap.CreateS03PerformanceScene();
            BakeS03OcclusionCulling();
            ForgeMindProjectBootstrap.BuildS03WindowsPlayer();
        }

        [MenuItem("ForgeMind/Prepare and Build S03 Instancing-Only Player")]
        public static void PrepareAndBuildS03InstancingOnlyPlayer()
        {
            EnableInstancingOnModelMaterials();
            ForgeMindProjectBootstrap.CreateS03InstancingOnlyScene();
            ForgeMindProjectBootstrap.BuildS03WindowsPlayer();
        }

        private static void MarkS03Occludees(UnityEngine.SceneManagement.Scene scene)
        {
            foreach (var root in scene.GetRootGameObjects())
            {
                if (root == null || !root.name.StartsWith("S03 Model ", System.StringComparison.Ordinal)) continue;
                foreach (var child in root.GetComponentsInChildren<Transform>(true))
                {
                    GameObjectUtility.SetStaticEditorFlags(child.gameObject, StaticEditorFlags.OccludeeStatic);
                }
                GameObjectUtility.SetStaticEditorFlags(root, StaticEditorFlags.OccludeeStatic);
            }
        }

        private static IEnumerable<string> FindGlbPaths()
        {
            var guids = AssetDatabase.FindAssets(string.Empty, new[] { "Assets/ForgeMind/Models" });
            foreach (var guid in guids)
            {
                var path = AssetDatabase.GUIDToAssetPath(guid);
                if (path.EndsWith(".glb", System.StringComparison.OrdinalIgnoreCase)) yield return path;
            }
        }
    }
}
