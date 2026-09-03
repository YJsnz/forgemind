using System.Collections.Generic;
using UnityEngine;

namespace ForgeMind.Client
{
    /// <summary>
    /// Enables built-in GPU instancing on shared materials so URP batches
    /// identical static models into one instanced draw call. Original geometry,
    /// materials, textures and per-object transforms are untouched; objects
    /// that do not repeat (or use unsupported shaders) simply keep rendering
    /// as single draw calls.
    /// </summary>
    public static class ForgeMindInstancing
    {
        /// <summary>
        /// Enables instancing on the distinct shared materials backing the given
        /// renderers. Materials are mutated in place (shared), never cloned, so a
        /// single call covers every instance that references the same asset.
        /// </summary>
        public static void EnableOnRendererMaterials(IEnumerable<Renderer> renderers)
        {
            if (renderers == null) return;
            var seen = new HashSet<Material>();
            foreach (var renderer in renderers)
            {
                if (renderer == null) continue;
                var materials = renderer.sharedMaterials;
                if (materials == null) continue;
                for (var index = 0; index < materials.Length; index++)
                {
                    var material = materials[index];
                    if (material == null || !seen.Add(material)) continue;
                    if (!material.enableInstancing)
                    {
                        material.enableInstancing = true;
                    }
                }
            }
        }

        /// <summary>
        /// Applies instancing to every renderer in the active scene. Used as a
        /// runtime safety net for scenes whose static objects are baked directly
        /// (for example the S03 stress scene) rather than projected by the
        /// presenter.
        /// </summary>
        public static void EnableForSceneRoots()
        {
            foreach (var root in UnityEngine.SceneManagement.SceneManager.GetActiveScene().GetRootGameObjects())
            {
                if (root == null) continue;
                var renderers = root.GetComponentsInChildren<Renderer>(true);
                if (renderers == null || renderers.Length == 0) continue;
                EnableOnRendererMaterials(renderers);
            }
        }
    }
}
