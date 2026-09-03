using System.Collections.Generic;
using System.IO;
using ForgeMind.Client;
using ForgeMind.Client.Api;
using ForgeMind.Client.Performance;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.Build.Reporting;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.SceneManagement;

namespace ForgeMind.Client.Editor
{
    public static class ForgeMindProjectBootstrap
    {
        /// <summary>Set false by the instancing-only S03 build to isolate occlusion effects.</summary>
        public static bool MarkS03Occludees = true;
        private const string ScenePath = "Assets/ForgeMind/Scenes/FactoryBenchmark.unity";
        private const string S03ScenePath = "Assets/ForgeMind/Scenes/FactoryS03Performance.unity";
        private static readonly string[] AllowlistedModelPaths =
        {
            "Assets/ForgeMind/Models/industrial/api_tank.glb",
            "Assets/ForgeMind/Models/industrial/cnc_machining_center.glb",
            "Assets/ForgeMind/Models/industrial/control_cabinet.glb",
            "Assets/ForgeMind/Models/industrial/flow_node_detail.glb",
            "Assets/ForgeMind/Models/industrial/hydraulic_press_detail.glb",
            "Assets/ForgeMind/Models/industrial/pallet_buffer_detail.glb",
            "Assets/ForgeMind/Models/industrial/realvirtual_chain_transfer_left.glb",
            "Assets/ForgeMind/Models/industrial/realvirtual_chain_transfer_right.glb",
            "Assets/ForgeMind/Models/industrial/realvirtual_high_detail.glb",
            "Assets/ForgeMind/Models/industrial/realvirtual_roll_conveyor_1m.glb",
            "Assets/ForgeMind/Models/industrial/realvirtual_turntable.glb",
            "Assets/ForgeMind/Models/industrial/robot_cell.glb",
            "Assets/ForgeMind/Models/industrial/roller_conveyor_segment.glb",
            "Assets/ForgeMind/Models/industrial/roller_conveyor.glb",
            "Assets/ForgeMind/Models/industrial/safety_fence.glb",
            "Assets/ForgeMind/Models/industrial/sensor_pack.glb",
            "Assets/ForgeMind/Models/industrial/vision_inspection.glb",
            "Assets/ForgeMind/Models/industrial/wash_deburr_detail.glb",
            "Assets/ForgeMind/Models/industrial/workstation.glb",
            "Assets/ForgeMind/Models/forgecore/forgecore_agv.glb",
            "Assets/ForgeMind/Models/forgecore/forgecore_drone.glb",
        };

        [MenuItem("ForgeMind/Create U1 Benchmark Scene")]
        public static void CreateBenchmarkScene()
        {
            EnsureDirectory("Assets/ForgeMind/Scenes");
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);

            var cameraObject = new GameObject("Main Camera");
            var camera = cameraObject.AddComponent<Camera>();
            camera.transform.position = new Vector3(25f, 31f, 29f);
            camera.transform.LookAt(Vector3.zero);
            camera.tag = "MainCamera";
            var cameraTarget = new GameObject("Camera Target");
            cameraTarget.transform.position = Vector3.zero;
            SceneManager.MoveGameObjectToScene(cameraTarget, scene);
            var cameraController = cameraObject.AddComponent<FactoryCameraController>();
            ConfigureCamera(cameraController, cameraTarget.transform);

            var lightObject = new GameObject("Key Light");
            var light = lightObject.AddComponent<Light>();
            light.type = LightType.Directional;
            light.intensity = 1.2f;
            light.transform.rotation = Quaternion.Euler(50f, -30f, 0f);

            var root = new GameObject("ForgeMind Client");
            var api = root.AddComponent<ForgeMindApiClient>();
            var runtime = root.AddComponent<FactoryReadOnlyRuntime>();
            var probe = root.AddComponent<ForgeMindPerformanceProbe>();
            var bootstrap = root.AddComponent<FactoryClientBootstrap>();
            var shell = root.AddComponent<FactoryNativeShell>();
            var bridge = root.AddComponent<ForgeMindNativeBridge>();
            var presenter = root.AddComponent<FactoryScenePresenter>();
            var snapshotReceiver = root.AddComponent<SnapshotReceiver>();
            var input = root.AddComponent<FactoryNativeInput>();
            Assign(bootstrap, api, runtime, probe, shell, bridge, presenter);
            shell.Configure(api, runtime, presenter);
            input.Configure(camera, bridge);

            var modelCount = AddModelPreviewInstances(scene);
            presenter.Configure(runtime, CreateModelBindings());

            EditorSceneManager.SaveScene(scene, ScenePath);
            Selection.activeGameObject = root;
            Debug.Log($"ForgeMind U1 benchmark scene created: {ScenePath}; modelInstances={modelCount}. Original GLB geometry/material references retained.");
        }

        [MenuItem("ForgeMind/Refresh Hybrid Bridge Scripts")]
        public static void RefreshHybridBridgeScripts()
        {
            AssetDatabase.ImportAsset("Assets/ForgeMind/Runtime/Client/ForgeMindNativeBridge.cs", ImportAssetOptions.ForceUpdate);
            AssetDatabase.ImportAsset("Assets/ForgeMind/Runtime/Contracts/ForgeMindJson.cs", ImportAssetOptions.ForceUpdate);
            AssetDatabase.Refresh(ImportAssetOptions.ForceUpdate);
            Debug.Log("ForgeMind hybrid bridge scripts refreshed.");
        }

        [MenuItem("ForgeMind/Create S03 Performance Scene (520 Models)")]
        public static void CreateS03PerformanceScene()
        {
            EnsureDirectory("Assets/ForgeMind/Scenes");
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            var cameraObject = new GameObject("Main Camera");
            var camera = cameraObject.AddComponent<Camera>();
            camera.transform.position = new Vector3(52f, 58f, 52f);
            camera.transform.LookAt(Vector3.zero);
            camera.tag = "MainCamera";
            var cameraTarget = new GameObject("Camera Target");
            SceneManager.MoveGameObjectToScene(cameraTarget, scene);
            var cameraController = cameraObject.AddComponent<FactoryCameraController>();
            ConfigureCamera(cameraController, cameraTarget.transform);

            var lightObject = new GameObject("Key Light");
            var light = lightObject.AddComponent<Light>();
            light.type = LightType.Directional;
            light.intensity = 1.2f;
            light.transform.rotation = Quaternion.Euler(50f, -30f, 0f);

            var root = new GameObject("ForgeMind S03 Client");
            var api = root.AddComponent<ForgeMindApiClient>();
            var runtime = root.AddComponent<FactoryReadOnlyRuntime>();
            var probe = root.AddComponent<ForgeMindPerformanceProbe>();
            var bootstrap = root.AddComponent<FactoryClientBootstrap>();
            var shell = root.AddComponent<FactoryNativeShell>();
            var bridge = root.AddComponent<ForgeMindNativeBridge>();
            var presenter = root.AddComponent<FactoryScenePresenter>();
            var input = root.AddComponent<FactoryNativeInput>();
            Assign(bootstrap, api, runtime, probe, shell, bridge, presenter);
            shell.Configure(api, runtime, presenter);
            input.Configure(camera, bridge);
            presenter.Configure(runtime, CreateModelBindings());
            ConfigureProbe(probe, true, 60f);

            var modelCount = AddStressInstances(scene, 520);
            EditorSceneManager.SaveScene(scene, S03ScenePath);
            Selection.activeGameObject = root;
            Debug.Log($"ForgeMind S03 performance scene created: {S03ScenePath}; modelInstances={modelCount}; original GLB geometry/material references retained.");
        }

        /// <summary>
        /// S03 scene with GPU instancing only: no occludee flags and no baked
        /// occlusion data, used to isolate instancing from occlusion effects.
        /// </summary>
        [MenuItem("ForgeMind/Create S03 Instancing-Only Scene")]
        public static void CreateS03InstancingOnlyScene()
        {
            MarkS03Occludees = false;
            CreateS03PerformanceScene();
            UnityEditor.SceneManagement.EditorSceneManager.SaveOpenScenes();
            Debug.Log($"ForgeMind S03 instancing-only scene saved: {S03ScenePath}");
        }

        private static FactoryModelBinding[] CreateModelBindings()
        {
            return new[]
            {
                Binding("default", "Assets/ForgeMind/Models/industrial/realvirtual_high_detail.glb"),
                Binding("source", "Assets/ForgeMind/Models/industrial/robot_cell.glb"),
                Binding("machine", "Assets/ForgeMind/Models/industrial/realvirtual_high_detail.glb"),
                Binding("smelter", "Assets/ForgeMind/Models/industrial/cnc_machining_center.glb"),
                Binding("press", "Assets/ForgeMind/Models/industrial/hydraulic_press_detail.glb"),
                Binding("inspection", "Assets/ForgeMind/Models/industrial/vision_inspection.glb"),
                Binding("washing", "Assets/ForgeMind/Models/industrial/wash_deburr_detail.glb"),
                Binding("oreMiner", "Assets/ForgeMind/Models/industrial/pallet_buffer_detail.glb"),
                Binding("storage", "Assets/ForgeMind/Models/industrial/pallet_buffer_detail.glb"),
                Binding("inboundWarehouse", "Assets/ForgeMind/Models/industrial/pallet_buffer_detail.glb"),
                Binding("outboundWarehouse", "Assets/ForgeMind/Models/industrial/pallet_buffer_detail.glb"),
                Binding("conveyor", "Assets/ForgeMind/Models/industrial/roller_conveyor_segment.glb"),
                Binding("inclineUp", "Assets/ForgeMind/Models/industrial/roller_conveyor_segment.glb"),
                Binding("inclineDown", "Assets/ForgeMind/Models/industrial/roller_conveyor_segment.glb"),
                Binding("splitter", "Assets/ForgeMind/Models/industrial/flow_node_detail.glb"),
                Binding("merger", "Assets/ForgeMind/Models/industrial/flow_node_detail.glb"),
                Binding("assembler", "Assets/ForgeMind/Models/industrial/robot_cell.glb"),
                Binding("apiTank", "Assets/ForgeMind/Models/industrial/api_tank.glb"),
                Binding("visionInspection", "Assets/ForgeMind/Models/industrial/vision_inspection.glb"),
                Binding("workstation", "Assets/ForgeMind/Models/industrial/workstation.glb"),
                Binding("imported", "Assets/ForgeMind/Models/industrial/realvirtual_high_detail.glb"),
                Binding("item:RAW_INGOT", "Assets/ForgeMind/Models/forgecore/items/material/ingot.glb"),
                Binding("item:MATERIAL_PLATE", "Assets/ForgeMind/Models/forgecore/items/material/plate.glb"),
                Binding("item:MATERIAL_WIRE_COIL", "Assets/ForgeMind/Models/forgecore/items/material/wire-coil.glb"),
                Binding("item:PART_BOLT", "Assets/ForgeMind/Models/forgecore/items/mechanical/bolt.glb"),
                Binding("item:PACK_BOX", "Assets/ForgeMind/Models/forgecore/items/package/box.glb"),
                Binding("item:RAW_CHUNK", "Assets/ForgeMind/Models/forgecore/items/material/chunk.glb"),
                Binding("item:PART_GEAR", "Assets/ForgeMind/Models/forgecore/items/mechanical/gear.glb"),
                Binding("item:MATERIAL_COIL", "Assets/ForgeMind/Models/forgecore/items/material/coil.glb"),
                Binding("item:ELEC_MOTOR", "Assets/ForgeMind/Models/forgecore/items/electronic/motor.glb"),
                Binding("agv", "Assets/ForgeMind/Models/forgecore/forgecore_agv.glb"),
                Binding("drone", "Assets/ForgeMind/Models/forgecore/forgecore_drone.glb"),
            };
        }

        private static FactoryModelBinding Binding(string key, string path)
        {
            return new FactoryModelBinding
            {
                key = key,
                prefab = AssetDatabase.LoadAssetAtPath<GameObject>(path),
            };
        }

        [MenuItem("ForgeMind/Validate U0 Project")]
        public static void ValidateProject()
        {
            var versionPath = Path.GetFullPath("ProjectSettings/ProjectVersion.txt");
            var manifestPath = Path.GetFullPath("Packages/manifest.json");
            Debug.Log(File.Exists(versionPath) && File.Exists(manifestPath)
                ? "ForgeMind U0 project files are present."
                : "ForgeMind U0 project files are incomplete.");
        }

        [MenuItem("ForgeMind/Validate Allowlisted Model Importers")]
        public static void ValidateAllowlistedModelImporters()
        {
            var modelRoot = "Assets/ForgeMind/Models";
            var guids = AssetDatabase.FindAssets("", new[] { modelRoot });
            var imported = 0;
            foreach (var guid in guids)
            {
                var path = AssetDatabase.GUIDToAssetPath(guid);
                if (!path.EndsWith(".glb", System.StringComparison.OrdinalIgnoreCase)) continue;
                var importer = AssetImporter.GetAtPath(path);
                var mainType = AssetDatabase.GetMainAssetTypeAtPath(path);
                Debug.Log($"ForgeMind model import: {path}; importer={importer?.GetType().FullName ?? "none"}; mainAsset={mainType?.FullName ?? "none"}");
                if (mainType != null) imported++;
            }

            Debug.Log($"ForgeMind allowlisted model import summary: {imported} GLB files have a main asset.");
        }

        private static int AddModelPreviewInstances(Scene scene)
        {
            var added = 0;
            for (var index = 0; index < AllowlistedModelPaths.Length; index++)
            {
                var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(AllowlistedModelPaths[index]);
                if (prefab == null) continue;

                var instance = Object.Instantiate(prefab);
                instance.name = $"U1 Model {Path.GetFileNameWithoutExtension(AllowlistedModelPaths[index])}";
                instance.transform.position = new Vector3((index % 4) * 12f - 18f, 0f, (index / 4) * 12f - 6f);
                instance.transform.rotation = Quaternion.identity;
                SceneManager.MoveGameObjectToScene(instance, scene);
                added++;
            }

            return added;
        }

        [MenuItem("ForgeMind/Build U1 Windows Player")]
        public static void BuildU1WindowsPlayer()
        {
            ConfigureWindowsGraphicsApis();
            var outputDirectory = Path.GetFullPath("Builds/ForgeMind-U1");
            Directory.CreateDirectory(outputDirectory);
            var outputPath = Path.Combine(outputDirectory, "ForgeMind-U1.exe");
            var report = BuildPipeline.BuildPlayer(new[] { ScenePath }, outputPath, BuildTarget.StandaloneWindows64, BuildOptions.None);
            if (report.summary.result != BuildResult.Succeeded)
            {
                throw new BuildFailedException($"ForgeMind U1 Windows Player failed: {report.summary.result}");
            }

            Debug.Log($"ForgeMind U1 Windows Player built: {outputPath}; size={report.summary.totalSize} bytes; duration={report.summary.totalTime}");
        }

        [MenuItem("ForgeMind/Regenerate Scene and Build U1")]
        public static void RegenerateSceneAndBuildU1()
        {
            CreateBenchmarkScene();
            BuildU1WindowsPlayer();
        }

        [MenuItem("ForgeMind/Build Final Hybrid Windows Player")]
        public static void BuildFinalHybridWindowsPlayer()
        {
            ConfigureWindowsGraphicsApis();
            RefreshHybridBuildScene();
            PlayerSettings.productName = "ForgeMind";
            PlayerSettings.companyName = "ForgeMind";
            PlayerSettings.fullScreenMode = FullScreenMode.Windowed;
            PlayerSettings.defaultScreenWidth = 1600;
            PlayerSettings.defaultScreenHeight = 900;
            PlayerSettings.runInBackground = true;
            PlayerSettings.allowFullscreenSwitch = false;

            // Do not reopen the high-model benchmark scene here just to toggle
            // debug components.  The final player is launched with
            // -forgemindPipe and both IMGUI components disable themselves at
            // runtime, while avoiding a second large scene load keeps the
            // editor's peak memory stable during packaging.
            var outputDirectory = Path.GetFullPath("Builds/ForgeMind-Client");
            Directory.CreateDirectory(outputDirectory);
            var outputPath = Path.Combine(outputDirectory, "ForgeMind-Client.exe");
            var report = BuildPipeline.BuildPlayer(new[] { ScenePath }, outputPath, BuildTarget.StandaloneWindows64, BuildOptions.None);
            if (report.summary.result != BuildResult.Succeeded)
            {
                throw new BuildFailedException($"ForgeMind final hybrid Windows Player failed: {report.summary.result}");
            }

            Debug.Log($"ForgeMind final hybrid Windows Player built: {outputPath}; size={report.summary.totalSize} bytes; duration={report.summary.totalTime}; native shell disabled by hybrid runtime gate; WebView2 host owns the UI.");
        }

        private static void RefreshHybridBuildScene()
        {
            if (!File.Exists(ScenePath))
            {
                CreateBenchmarkScene();
                return;
            }

            var scene = EditorSceneManager.OpenScene(ScenePath, OpenSceneMode.Single);
            var presenter = Object.FindFirstObjectByType<FactoryScenePresenter>();
            if (presenter == null) throw new BuildFailedException($"FactoryScenePresenter is missing from {ScenePath}.");
            presenter.Configure(Object.FindFirstObjectByType<FactoryReadOnlyRuntime>(), CreateModelBindings());
            foreach (var root in scene.GetRootGameObjects())
            {
                if (root.name.StartsWith("U1 Model ", System.StringComparison.Ordinal)) Object.DestroyImmediate(root);
            }
            EditorSceneManager.MarkSceneDirty(scene);
            EditorSceneManager.SaveScene(scene);
            AssetDatabase.SaveAssets();
        }

        [MenuItem("ForgeMind/Build S03 Performance Windows Player")]
        public static void BuildS03WindowsPlayer()
        {
            ConfigureWindowsGraphicsApis();
            PlayerSettings.runInBackground = true;
            QualitySettings.vSyncCount = 0;
            var outputDirectory = Path.GetFullPath("Builds/ForgeMind-S03");
            Directory.CreateDirectory(outputDirectory);
            var outputPath = Path.Combine(outputDirectory, "ForgeMind-S03.exe");
            var report = BuildPipeline.BuildPlayer(new[] { S03ScenePath }, outputPath, BuildTarget.StandaloneWindows64, BuildOptions.None);
            if (report.summary.result != BuildResult.Succeeded)
            {
                throw new BuildFailedException($"ForgeMind S03 Windows Player failed: {report.summary.result}");
            }

            Debug.Log($"ForgeMind S03 Windows Player built: {outputPath}; size={report.summary.totalSize} bytes; duration={report.summary.totalTime}");
        }

        private static void ConfigureWindowsGraphicsApis()
        {
            PlayerSettings.enableFrameTimingStats = true;
            PlayerSettings.SetUseDefaultGraphicsAPIs(BuildTarget.StandaloneWindows64, false);
            PlayerSettings.SetGraphicsAPIs(BuildTarget.StandaloneWindows64, new[]
            {
                GraphicsDeviceType.Direct3D12,
                GraphicsDeviceType.Direct3D11,
            });
            var gridShader = Shader.Find("ForgeMind/FactoryGrid");
            if (gridShader == null) throw new BuildFailedException("ForgeMind/FactoryGrid shader is missing.");
            var zoneShader = Shader.Find("ForgeMind/FactoryZone");
            var itemShader = Shader.Find("ForgeMind/FactoryItem");
            if (zoneShader == null || itemShader == null) throw new BuildFailedException("ForgeMind runtime overlay shaders are missing.");
            var graphicsSettingsAsset = AssetDatabase.LoadAllAssetsAtPath("ProjectSettings/GraphicsSettings.asset")[0];
            var serializedGraphicsSettings = new SerializedObject(graphicsSettingsAsset);
            var includedShaders = serializedGraphicsSettings.FindProperty("m_AlwaysIncludedShaders");
            var shadersToInclude = new List<Shader> { gridShader, zoneShader, itemShader };
            CollectModelMaterialShaders(shadersToInclude);
            foreach (var shader in shadersToInclude)
            {
                if (shader == null) continue;
                var alreadyIncluded = false;
                for (var index = 0; index < includedShaders.arraySize; index++)
                {
                    if (includedShaders.GetArrayElementAtIndex(index).objectReferenceValue == shader)
                    {
                        alreadyIncluded = true;
                        break;
                    }
                }
                if (!alreadyIncluded)
                {
                    includedShaders.InsertArrayElementAtIndex(includedShaders.arraySize);
                    includedShaders.GetArrayElementAtIndex(includedShaders.arraySize - 1).objectReferenceValue = shader;
                }
            }
            serializedGraphicsSettings.ApplyModifiedPropertiesWithoutUndo();
            Debug.Log($"ForgeMind Windows graphics APIs configured: Direct3D12 primary, Direct3D11 fallback; {shadersToInclude.Count} shaders always included.");
        }

        /// <summary>
        /// Collects the shaders backing every model GLB's materials so a built
        /// player can never drop them (missing-shader materials render pink).
        /// </summary>
        private static void CollectModelMaterialShaders(List<Shader> target)
        {
            var seen = new HashSet<Shader>(target);
            foreach (var path in FindModelGlbPaths())
            {
                var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(path);
                if (prefab == null) continue;
                foreach (var renderer in prefab.GetComponentsInChildren<Renderer>(true))
                {
                    if (renderer == null) continue;
                    foreach (var material in renderer.sharedMaterials)
                    {
                        if (material == null || material.shader == null || !seen.Add(material.shader)) continue;
                        target.Add(material.shader);
                    }
                }
            }
        }

        private static IEnumerable<string> FindModelGlbPaths()
        {
            var guids = AssetDatabase.FindAssets(string.Empty, new[] { "Assets/ForgeMind/Models" });
            foreach (var guid in guids)
            {
                var path = AssetDatabase.GUIDToAssetPath(guid);
                if (path.EndsWith(".glb", System.StringComparison.OrdinalIgnoreCase)) yield return path;
            }
        }

        private static void Assign(FactoryClientBootstrap bootstrap, ForgeMindApiClient api, FactoryReadOnlyRuntime runtime, ForgeMindPerformanceProbe probe, FactoryNativeShell shell, ForgeMindNativeBridge bridge, FactoryScenePresenter presenter)
        {
            var serialized = new SerializedObject(bootstrap);
            serialized.FindProperty("apiClient").objectReferenceValue = api;
            serialized.FindProperty("readOnlyRuntime").objectReferenceValue = runtime;
            serialized.FindProperty("performanceProbe").objectReferenceValue = probe;
            serialized.FindProperty("nativeShell").objectReferenceValue = shell;
            serialized.FindProperty("nativeBridge").objectReferenceValue = bridge;
            serialized.FindProperty("scenePresenter").objectReferenceValue = presenter;
            serialized.ApplyModifiedPropertiesWithoutUndo();
        }

        private static void ConfigureCamera(FactoryCameraController controller, Transform target)
        {
            var serialized = new SerializedObject(controller);
            serialized.FindProperty("target").objectReferenceValue = target;
            serialized.FindProperty("distance").floatValue = 34f;
            serialized.FindProperty("yaw").floatValue = 42f;
            serialized.FindProperty("pitch").floatValue = 48f;
            serialized.ApplyModifiedPropertiesWithoutUndo();
        }

        private static void ConfigureProbe(ForgeMindPerformanceProbe probe, bool captureOnStart, float captureSeconds)
        {
            var serialized = new SerializedObject(probe);
            serialized.FindProperty("captureOnStart").boolValue = captureOnStart;
            serialized.FindProperty("captureSeconds").floatValue = captureSeconds;
            serialized.ApplyModifiedPropertiesWithoutUndo();
        }

        private static int AddStressInstances(Scene scene, int requestedCount)
        {
            var added = 0;
            for (var index = 0; index < requestedCount; index++)
            {
                var path = AllowlistedModelPaths[index % AllowlistedModelPaths.Length];
                var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(path);
                if (prefab == null) continue;
                var instance = Object.Instantiate(prefab);
                instance.name = $"S03 Model {index + 1:000}";
                var column = index % 26;
                var row = (index / 26) % 20;
                var floor = index / (26 * 20);
                instance.transform.position = new Vector3((column - 12.5f) * 7f, floor * 5.25f, (row - 9.5f) * 7f);
                instance.transform.rotation = Quaternion.Euler(0f, (index % 4) * 90f, 0f);
                // Occludee-only: keep GPU instancing enabled (global isStatic /
                // BatchingStatic would merge meshes and disable instancing).
                if (MarkS03Occludees) GameObjectUtility.SetStaticEditorFlags(instance, StaticEditorFlags.OccludeeStatic);
                SceneManager.MoveGameObjectToScene(instance, scene);
                added++;
            }
            return added;
        }

        private static void EnsureDirectory(string path)
        {
            if (!AssetDatabase.IsValidFolder(path))
            {
                var parent = Path.GetDirectoryName(path.Replace('\\', '/'));
                var leaf = Path.GetFileName(path);
                if (!string.IsNullOrEmpty(parent) && !AssetDatabase.IsValidFolder(parent)) EnsureDirectory(parent);
                AssetDatabase.CreateFolder(parent, leaf);
            }
        }
    }
}
