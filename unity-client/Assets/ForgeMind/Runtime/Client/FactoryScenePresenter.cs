using System;
using System.Collections.Generic;
using ForgeMind.Client.Contracts;
using UnityEngine;

namespace ForgeMind.Client
{
    [Serializable]
    public sealed class FactoryModelBinding
    {
        public string key;
        public GameObject prefab;
    }

    /// <summary>
    /// Lossless save-to-scene projection for the native client. It owns visual
    /// instances only; coordinates, object types and business state stay in
    /// FactoryReadOnlyRuntime and are never mutated here.
    /// </summary>
    public sealed class FactoryScenePresenter : MonoBehaviour
    {
        [SerializeField] private FactoryReadOnlyRuntime readOnlyRuntime;
        [SerializeField] private float floorHeight = 5.25f;
        [SerializeField] private FactoryModelBinding[] modelBindings = Array.Empty<FactoryModelBinding>();

        private readonly List<RenderedInstance> instances = new List<RenderedInstance>();
        private readonly Dictionary<string, GameObject> models = new Dictionary<string, GameObject>(StringComparer.OrdinalIgnoreCase);
        private readonly Dictionary<string, FactoryObjectData> objectById = new Dictionary<string, FactoryObjectData>(StringComparer.OrdinalIgnoreCase);
        private readonly Dictionary<string, GameObject> lotInstances = new Dictionary<string, GameObject>(StringComparer.OrdinalIgnoreCase);
        private readonly Dictionary<string, Vector3> lotTargets = new Dictionary<string, Vector3>(StringComparer.OrdinalIgnoreCase);
        private readonly Dictionary<string, Vector3> vehicleTargets = new Dictionary<string, Vector3>(StringComparer.OrdinalIgnoreCase);
        private readonly Dictionary<string, float> vehicleHeadingTargets = new Dictionary<string, float>(StringComparer.OrdinalIgnoreCase);
        private readonly HashSet<string> selectedIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        private readonly HashSet<int> visibleFloors = new HashSet<int> { 1 };
        private GameObject factoryGround;
        private GameObject factoryMarkings;
        private FactorySaveData lastAppliedSave;

        public int RenderedObjectCount => instances.Count;
        public int ActiveFloorId { get; private set; } = 1;
        public bool HasAppliedSave(FactorySaveData save) => ReferenceEquals(lastAppliedSave, save);

        public void Configure(FactoryReadOnlyRuntime runtime, FactoryModelBinding[] bindings)
        {
            readOnlyRuntime = runtime;
            modelBindings = bindings ?? Array.Empty<FactoryModelBinding>();
            RebuildIndex();
        }

        private void OnEnable()
        {
            if (readOnlyRuntime == null) readOnlyRuntime = GetComponent<FactoryReadOnlyRuntime>();
            RebuildIndex();
            if (readOnlyRuntime != null)
            {
                readOnlyRuntime.SaveChanged += ApplySave;
                readOnlyRuntime.SnapshotChanged += ApplySnapshot;
                if (readOnlyRuntime.CurrentSave != null) ApplySave(readOnlyRuntime.CurrentSave);
                if (readOnlyRuntime.CurrentSnapshot != null) ApplySnapshot(readOnlyRuntime.CurrentSnapshot);
            }
        }

        private void Start()
        {
            // 原生客户端（非混合）与混合客户端都创建地面与区域标记；只有混合模式
            // 额外移除 U1 基准预览并设置相机背景（WebView2 在其上方承载业务 UI）。
            if (IsHybridPlayer()) RemoveBenchmarkPreviews();
            EnsureFactoryGround();
            EnsureFactoryMarkings();
            var camera = Camera.main;
            if (camera != null)
            {
                camera.clearFlags = CameraClearFlags.SolidColor;
                camera.backgroundColor = new Color(0.72f, 0.77f, 0.76f, 1f);
            }
            var groundRenderer = factoryGround != null ? factoryGround.GetComponent<Renderer>() : null;
            Debug.Log($"ForgeMind presenter Start: hybrid={IsHybridPlayer()} ground={(factoryGround != null ? "yes" : "no")} groundShader={(groundRenderer != null && groundRenderer.sharedMaterial != null ? groundRenderer.sharedMaterial.shader.name : "none")} camera={(camera != null ? camera.transform.position.ToString("F1") : "none")}");
        }

        private void OnDisable()
        {
            if (readOnlyRuntime != null) readOnlyRuntime.SaveChanged -= ApplySave;
            if (readOnlyRuntime != null) readOnlyRuntime.SnapshotChanged -= ApplySnapshot;
        }

        private void Update()
        {
            const float smoothing = 18f;
            var blend = 1f - Mathf.Exp(-smoothing * Time.deltaTime);
            foreach (var pair in lotTargets)
            {
                if (lotInstances.TryGetValue(pair.Key, out var instance) && instance != null)
                    instance.transform.position = Vector3.Lerp(instance.transform.position, pair.Value, blend);
            }
            foreach (var pair in vehicleTargets)
            {
                var rendered = FindInstance(pair.Key);
                if (rendered == null || rendered.gameObject == null) continue;
                rendered.gameObject.transform.position = Vector3.Lerp(rendered.gameObject.transform.position, pair.Value, blend);
                if (vehicleHeadingTargets.TryGetValue(pair.Key, out var heading))
                    rendered.gameObject.transform.rotation = Quaternion.Slerp(rendered.gameObject.transform.rotation, Quaternion.Euler(0f, -heading, 0f), blend);
            }
        }

        public void ApplySave(FactorySaveData save)
        {
            lastAppliedSave = save;
            ClearInstances();
            ClearDynamicInstances();
            objectById.Clear();
            RemoveBenchmarkPreviews();
            if (save == null || save.objects == null) return;

            foreach (var data in save.objects)
            {
                if (data == null || data.pos == null) continue;
                if (!string.IsNullOrWhiteSpace(data.id)) objectById[data.id] = data;
                var prefab = ResolvePrefab(data, save);
                if (prefab == null)
                {
                    Debug.LogWarning($"ForgeMind model binding missing for object {data.id} ({data.type}).");
                    continue;
                }

                var instance = Instantiate(prefab, transform);
                instance.name = $"Factory Object {data.id}";
                instance.SetActive(true);
                var spec = ResolveVisualSpec(data, save);
                NormalizeModel(instance, spec);
                AddHitProxy(instance, data.id);
                var center = ResolveWorldCenter(data, save);
                var baseY = Mathf.Max(0, data.floorId - 1) * floorHeight + spec.baseY;
                instance.transform.position += new Vector3(center.x, baseY, center.y);
                instance.transform.rotation = Quaternion.Euler(0f, -data.rotation + spec.rotationOffsetY, 0f);
                instances.Add(new RenderedInstance(instance, data.id, data.type, data.floorId));
            }
            // Shared materials are mutated once; every projected static instance
            // then renders as a GPU-instanced batch with the original meshes.
            ForgeMindInstancing.EnableOnRendererMaterials(GetComponentsInChildren<Renderer>(true));
            for (var i = 0; i < Mathf.Min(6, instances.Count); i++)
            {
                var go = instances[i].gameObject;
                if (go != null) Debug.Log($"ForgeMind object {instances[i].objectId} ({instances[i].type}) at {go.transform.position.ToString("F2")}");
            }
            SetActiveFloor(ActiveFloorId);
            ApplySelectionVisuals();
            Debug.Log($"ForgeMind scene projection applied: save={save.name}; floors={save.floorCount}; objects={save.objects.Length}; rendered={instances.Count}; bindings={models.Count}");
        }

        private void ApplySnapshot(SimulationSnapshotData snapshot)
        {
            if (snapshot == null || lastAppliedSave == null) return;
            var liveLots = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var lot in snapshot.itemLots ?? Array.Empty<ItemLotData>())
            {
                if (lot == null || string.IsNullOrWhiteSpace(lot.id) || !objectById.TryGetValue(lot.conveyorId ?? string.Empty, out var conveyor)) continue;
                var target = ResolveLotPosition(lot, conveyor);
                liveLots.Add(lot.id);
                if (!lotInstances.TryGetValue(lot.id, out var instance) || instance == null)
                {
                    instance = CreateLotVisual(lot.itemId);
                    lotInstances[lot.id] = instance;
                    instance.transform.position = target;
                }
                lotTargets[lot.id] = target;
                instance.SetActive(visibleFloors.Contains(Mathf.Max(1, lot.floorId)));
            }
            var staleLots = new List<string>();
            foreach (var pair in lotInstances) if (!liveLots.Contains(pair.Key)) staleLots.Add(pair.Key);
            foreach (var id in staleLots)
            {
                if (lotInstances[id] != null) Destroy(lotInstances[id]);
                lotInstances.Remove(id);
                lotTargets.Remove(id);
            }

            var liveVehicles = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            UpdateVehicles(snapshot.agvs, liveVehicles, false);
            UpdateVehicles(snapshot.drones, liveVehicles, true);
            foreach (var entry in instances)
            {
                if (entry.gameObject != null && (entry.type == "agv" || entry.type == "drone") && !liveVehicles.Contains(entry.objectId))
                    entry.gameObject.SetActive(visibleFloors.Contains(entry.floorId));
            }
            Debug.Log($"ForgeMind snapshot projection applied: time={snapshot.timeSec}; lots={(snapshot.itemLots ?? Array.Empty<ItemLotData>()).Length}; agvs={(snapshot.agvs ?? Array.Empty<VehicleRuntimeData>()).Length}; drones={(snapshot.drones ?? Array.Empty<VehicleRuntimeData>()).Length}");
        }

        private void UpdateVehicles(VehicleRuntimeData[] vehicles, HashSet<string> liveVehicles, bool drone)
        {
            foreach (var vehicle in vehicles ?? Array.Empty<VehicleRuntimeData>())
            {
                if (vehicle == null || string.IsNullOrWhiteSpace(vehicle.objectId) || vehicle.position == null) continue;
                var rendered = FindInstance(vehicle.objectId);
                if (rendered == null || rendered.gameObject == null) continue;
                liveVehicles.Add(vehicle.objectId);
                var floor = Mathf.Max(1, vehicle.floorId);
                var y = drone ? vehicle.position.y : (floor - 1) * floorHeight + 0.05f;
                vehicleTargets[vehicle.objectId] = new Vector3(vehicle.position.x, y, vehicle.position.z);
                vehicleHeadingTargets[vehicle.objectId] = vehicle.headingY;
                rendered.gameObject.SetActive(visibleFloors.Contains(floor));
            }
        }

        private Vector3 ResolveLotPosition(ItemLotData lot, FactoryObjectData conveyor)
        {
            var offset = Mathf.Clamp01(lot.offset);
            var floor = Mathf.Max(1, lot.floorId);
            if ((conveyor.type == "inclineUp" || conveyor.type == "inclineDown") && conveyor.incline?.lowPos != null && conveyor.incline.highPos != null)
            {
                var low = conveyor.incline.lowPos;
                var high = conveyor.incline.highPos;
                var lowFloor = Mathf.Max(1, conveyor.incline.lowerFloorId);
                var highFloor = Mathf.Max(lowFloor, conveyor.incline.upperFloorId);
                return new Vector3(
                    Mathf.Lerp(low.x + 0.5f, high.x + 0.5f, offset),
                    Mathf.Lerp((lowFloor - 1) * floorHeight, (highFloor - 1) * floorHeight, offset) + 0.62f + 0.15f,
                    Mathf.Lerp(low.z + 0.5f, high.z + 0.5f, offset));
            }
            var dx = 0f;
            var dz = 0f;
            switch (((conveyor.rotation % 360) + 360) % 360)
            {
                case 0: dx = 1f; break;
                case 90: dz = 1f; break;
                case 180: dx = -1f; break;
                default: dz = -1f; break;
            }
            return new Vector3(conveyor.pos.x + 0.5f + dx * (offset - 0.5f), (floor - 1) * floorHeight + 0.62f + 0.15f, conveyor.pos.z + 0.5f + dz * (offset - 0.5f));
        }

        private GameObject CreateLotVisual(string itemId)
        {
            var itemModelId = string.Empty;
            foreach (var item in lastAppliedSave.items ?? Array.Empty<ItemDefinitionData>())
            {
                if (item != null && string.Equals(item.id, itemId, StringComparison.OrdinalIgnoreCase)) { itemModelId = item.modelId ?? string.Empty; break; }
            }
            var lot = models.TryGetValue("item:" + itemModelId, out var itemPrefab) && itemPrefab != null
                ? Instantiate(itemPrefab, transform)
                : GameObject.CreatePrimitive(PrimitiveType.Cube);
            lot.name = $"Item Lot {itemId}";
            if (itemPrefab != null) NormalizeModel(lot, new VisualSpec(0.3f, 0.3f));
            else lot.transform.localScale = new Vector3(0.3f, 0.3f, 0.3f);
            var collider = lot.GetComponent<Collider>();
            if (collider != null) Destroy(collider);
            var renderer = lot.GetComponent<Renderer>();
            var shader = Shader.Find("ForgeMind/FactoryItem");
            if (renderer != null && shader != null)
            {
                var material = new Material(shader);
                var color = new Color(0.85f, 0.9f, 0.92f, 1f);
                foreach (var item in lastAppliedSave.items ?? Array.Empty<ItemDefinitionData>())
                {
                    if (item != null && string.Equals(item.id, itemId, StringComparison.OrdinalIgnoreCase) && ColorUtility.TryParseHtmlString(item.color, out var parsed)) { color = parsed; break; }
                }
                material.SetColor("_BaseColor", color);
                renderer.sharedMaterial = material;
            }
            return lot;
        }

        public void SetActiveFloor(int floorId)
        {
            SetFloorVisibility(floorId, null);
        }

        public void SetFloorVisibility(int floorId, int[] floors)
        {
            ActiveFloorId = Mathf.Max(1, floorId);
            visibleFloors.Clear();
            visibleFloors.Add(ActiveFloorId);
            if (floors != null)
            {
                foreach (var visibleFloor in floors) visibleFloors.Add(Mathf.Max(1, visibleFloor));
            }
            foreach (var entry in instances)
            {
                if (entry.gameObject != null) entry.gameObject.SetActive(visibleFloors.Contains(entry.floorId));
            }
            if (factoryGround != null) factoryGround.transform.position = new Vector3(0f, Mathf.Max(0, ActiveFloorId - 1) * floorHeight - 0.03f, 0f);
            if (factoryMarkings != null) factoryMarkings.transform.position = new Vector3(0f, Mathf.Max(0, ActiveFloorId - 1) * floorHeight, 0f);
        }

        public void SetSelection(string[] ids)
        {
            selectedIds.Clear();
            foreach (var id in ids ?? Array.Empty<string>())
            {
                if (!string.IsNullOrWhiteSpace(id)) selectedIds.Add(id);
            }
            ApplySelectionVisuals();
        }

        private void ApplySelectionVisuals()
        {
            foreach (var entry in instances)
            {
                if (entry.gameObject != null) FactorySelectionVisual.Apply(entry.gameObject, selectedIds.Contains(entry.objectId));
            }
        }

        private static void AddHitProxy(GameObject instance, string objectId)
        {
            if (instance == null || string.IsNullOrWhiteSpace(objectId)) return;
            var renderers = instance.GetComponentsInChildren<Renderer>(true);
            if (renderers == null || renderers.Length == 0) return;
            var worldBounds = renderers[0].bounds;
            for (var index = 1; index < renderers.Length; index++) worldBounds.Encapsulate(renderers[index].bounds);
            var target = instance.GetComponent<FactoryObjectHitTarget>() ?? instance.AddComponent<FactoryObjectHitTarget>();
            target.Configure(objectId);
            var collider = instance.GetComponent<BoxCollider>() ?? instance.AddComponent<BoxCollider>();
            collider.center = instance.transform.InverseTransformPoint(worldBounds.center);
            collider.size = instance.transform.InverseTransformVector(worldBounds.size);
            collider.size = new Vector3(Mathf.Abs(collider.size.x), Mathf.Abs(collider.size.y), Mathf.Abs(collider.size.z));
            collider.isTrigger = false;
        }

        private GameObject ResolvePrefab(FactoryObjectData data, FactorySaveData save)
        {
            if (!string.IsNullOrWhiteSpace(data.resourceId))
            {
                if (models.TryGetValue(data.resourceId, out var resourcePrefab)) return resourcePrefab;
                if (save?.machineDefinitions != null)
                {
                    foreach (var definition in save.machineDefinitions)
                    {
                        if (definition == null || !string.Equals(definition.id, data.resourceId, StringComparison.OrdinalIgnoreCase)) continue;
                        if (!string.IsNullOrWhiteSpace(definition.modelType) && models.TryGetValue(definition.modelType, out var machinePrefab)) return machinePrefab;
                    }
                }
            }
            if (!string.IsNullOrWhiteSpace(data.type) && models.TryGetValue(data.type, out var typePrefab)) return typePrefab;
            foreach (var binding in modelBindings)
            {
                if (binding != null && binding.prefab != null && !string.IsNullOrWhiteSpace(binding.key))
                {
                    if (data.type != null && data.type.IndexOf(binding.key, StringComparison.OrdinalIgnoreCase) >= 0) return binding.prefab;
                }
            }
            return models.TryGetValue("default", out var fallback) ? fallback : null;
        }

        private static VisualSpec ResolveVisualSpec(FactoryObjectData data, FactorySaveData save)
        {
            var type = data.type ?? string.Empty;
            switch (type)
            {
                case "source": return new VisualSpec(4f, 1.69f);
                case "inboundWarehouse":
                case "outboundWarehouse": return new VisualSpec(3.75f, 2.25f);
                case "oreMiner":
                case "storage": return new VisualSpec(2.125f, 1.6875f);
                case "conveyor": return new VisualSpec(1.05f, 0.52f, 90f, 0f, 2.5f);
                case "inclineUp":
                case "inclineDown": return new VisualSpec(Mathf.Max(1f, data.incline?.runM ?? 7f), 1.3f, 90f);
                case "splitter":
                case "merger": return new VisualSpec(1.25f, 0.65f);
                case "smelter": return new VisualSpec(7.5f, 4.75f);
                case "press": return new VisualSpec(4.3f, 4f);
                case "assembler": return new VisualSpec(7.5f, 4.625f);
                case "inspection": return new VisualSpec(5f, 3.875f);
                case "washing": return new VisualSpec(4.25f, 3.625f);
                case "agv": return new VisualSpec(1.85f, 1.35f);
                case "drone": return new VisualSpec(2.25f, 1.8f, 0f, 1.45f);
                case "machine":
                    if (!string.IsNullOrWhiteSpace(data.resourceId) && save?.machineDefinitions != null)
                    {
                        foreach (var definition in save.machineDefinitions)
                        {
                            if (definition == null || !string.Equals(definition.id, data.resourceId, StringComparison.OrdinalIgnoreCase)) continue;
                            var width = Mathf.Max(definition.footprint?.w ?? 1, definition.footprint?.d ?? 1) * 2.5f;
                            return new VisualSpec(width, Mathf.Max(0.2f, definition.height) * 2.5f);
                        }
                    }
                    return new VisualSpec(3.25f, 3f);
                default: return new VisualSpec(3.25f, 3.75f);
            }
        }

        private static Vector2 ResolveWorldCenter(FactoryObjectData data, FactorySaveData save)
        {
            if ((data.type == "inclineUp" || data.type == "inclineDown") && data.incline?.lowPos != null && data.incline.highPos != null)
            {
                return new Vector2(
                    (data.incline.lowPos.x + data.incline.highPos.x) * 0.5f + 0.5f,
                    (data.incline.lowPos.z + data.incline.highPos.z) * 0.5f + 0.5f);
            }
            var footprint = LogicalFootprint(data, save);
            if (data.rotation == 90 || data.rotation == 270)
            {
                var swap = footprint.x;
                footprint.x = footprint.y;
                footprint.y = swap;
            }
            return new Vector2(data.pos.x + footprint.x * 0.5f, data.pos.z + footprint.y * 0.5f);
        }

        private static Vector2 LogicalFootprint(FactoryObjectData data, FactorySaveData save)
        {
            if (data.type == "machine" && save?.machineDefinitions != null)
            {
                foreach (var definition in save.machineDefinitions)
                {
                    if (definition != null && string.Equals(definition.id, data.resourceId, StringComparison.OrdinalIgnoreCase) && definition.footprint != null)
                        return new Vector2(Mathf.Max(1, definition.footprint.w), Mathf.Max(1, definition.footprint.d));
                }
            }
            switch (data.type)
            {
                case "source": return new Vector2(4f, 4f);
                case "inboundWarehouse":
                case "outboundWarehouse": return new Vector2(3f, 3f);
                case "oreMiner":
                case "storage":
                case "press":
                case "inspection":
                case "washing":
                case "agv": return new Vector2(2f, 2f);
                case "drone":
                case "assembler": return new Vector2(3f, 3f);
                case "smelter": return new Vector2(3f, 2f);
                case "machine": return new Vector2(1f, 1f);
                default: return Vector2.one;
            }
        }

        private static void NormalizeModel(GameObject instance, VisualSpec spec)
        {
            instance.transform.SetPositionAndRotation(Vector3.zero, Quaternion.identity);
            instance.transform.localScale = Vector3.one;
            var renderers = instance.GetComponentsInChildren<Renderer>(true);
            if (renderers.Length == 0) return;
            var bounds = renderers[0].bounds;
            for (var index = 1; index < renderers.Length; index++) bounds.Encapsulate(renderers[index].bounds);
            var size = bounds.size;
            var scale = Mathf.Min(spec.targetFootprint / Mathf.Max(size.x, size.z, 0.0001f), spec.targetHeight / Mathf.Max(size.y, 0.0001f));
            instance.transform.localScale = Vector3.one * scale;
            if (spec.crossSectionScale > 1f)
            {
                instance.transform.localScale = Vector3.Scale(instance.transform.localScale, new Vector3(1f, spec.crossSectionScale, spec.crossSectionScale));
            }
            foreach (var renderer in renderers)
            {
                renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.On;
                renderer.receiveShadows = true;
            }
            bounds = renderers[0].bounds;
            for (var index = 1; index < renderers.Length; index++) bounds.Encapsulate(renderers[index].bounds);
            instance.transform.position = new Vector3(-bounds.center.x, -bounds.min.y, -bounds.center.z);
        }

        private readonly struct VisualSpec
        {
            public readonly float targetFootprint;
            public readonly float targetHeight;
            public readonly float rotationOffsetY;
            public readonly float baseY;
            public readonly float crossSectionScale;

            public VisualSpec(float footprint, float height, float rotationOffset = 0f, float baseHeight = 0f, float crossSection = 1f)
            {
                targetFootprint = Mathf.Max(0.1f, footprint);
                targetHeight = Mathf.Max(0.1f, height);
                rotationOffsetY = rotationOffset;
                baseY = baseHeight;
                crossSectionScale = Mathf.Max(1f, crossSection);
            }
        }

        private void RebuildIndex()
        {
            models.Clear();
            foreach (var binding in modelBindings)
            {
                if (binding == null || binding.prefab == null || string.IsNullOrWhiteSpace(binding.key)) continue;
                models[binding.key] = binding.prefab;
            }
        }

        private void ClearInstances()
        {
            foreach (var entry in instances)
            {
                if (entry.gameObject != null) Destroy(entry.gameObject);
            }
            instances.Clear();
            selectedIds.Clear();
        }

        private void ClearDynamicInstances()
        {
            foreach (var instance in lotInstances.Values) if (instance != null) Destroy(instance);
            lotInstances.Clear();
            lotTargets.Clear();
            vehicleTargets.Clear();
            vehicleHeadingTargets.Clear();
        }

        private RenderedInstance FindInstance(string objectId)
        {
            if (string.IsNullOrWhiteSpace(objectId)) return null;
            foreach (var instance in instances)
                if (string.Equals(instance.objectId, objectId, StringComparison.OrdinalIgnoreCase)) return instance;
            return null;
        }

        private sealed class RenderedInstance
        {
            public readonly GameObject gameObject;
            public readonly string objectId;
            public readonly string type;
            public readonly int floorId;

            public RenderedInstance(GameObject value, string id, string objectType, int floor)
            {
                gameObject = value;
                objectId = id ?? string.Empty;
                type = objectType ?? string.Empty;
                floorId = Mathf.Max(1, floor);
            }
        }

        private void RemoveBenchmarkPreviews()
        {
            var previews = new List<GameObject>();
            foreach (var root in gameObject.scene.GetRootGameObjects())
            {
                if (root.name.StartsWith("U1 Model ", StringComparison.Ordinal)) previews.Add(root);
            }
            foreach (var preview in previews) Destroy(preview);
        }

        private void EnsureFactoryGround()
        {
            if (factoryGround != null) return;
            factoryGround = GameObject.CreatePrimitive(PrimitiveType.Plane);
            factoryGround.name = "ForgeMind Factory Grid";
            factoryGround.transform.position = new Vector3(0f, -0.03f, 0f);
            factoryGround.transform.localScale = new Vector3(5f, 1f, 3.4f);
            var collider = factoryGround.GetComponent<Collider>();
            if (collider != null) Destroy(collider);
            var renderer = factoryGround.GetComponent<Renderer>();
            if (renderer == null) return;
            var material = CreateGroundMaterial(renderer.sharedMaterial);
            if (material == null) return;
            renderer.sharedMaterial = material;
        }

        private Material CreateGroundMaterial(Material fallback)
        {
            // The web scene uses an explicit 50×34 m floor plus separate grid
            // geometry. Keep the base opaque enough that an empty factory is
            // still visibly a factory floor instead of blending into WebView2.
            var material = CreateSurfaceMaterial("ForgeMind Runtime Floor", new Color(0.68f, 0.75f, 0.72f, 1f), false, fallback);
            if (material == null) return null;
            material.mainTexture = CreateGridTexture();
            material.mainTextureScale = new Vector2(50f, 34f);
            return material;
        }

        private static Texture2D CreateGridTexture()
        {
            const int size = 64;
            var texture = new Texture2D(size, size, TextureFormat.RGBA32, false)
            {
                name = "ForgeMind Runtime Grid Texture",
                wrapMode = TextureWrapMode.Repeat,
                filterMode = FilterMode.Bilinear,
            };
            var baseColor = new Color32(190, 202, 199, 255);
            var minor = new Color32(146, 165, 162, 255);
            var major = new Color32(105, 129, 126, 255);
            for (var y = 0; y < size; y++)
            {
                for (var x = 0; x < size; x++)
                {
                    var majorLine = x < 2 || y < 2;
                    var minorLine = x < 3 || y < 3;
                    texture.SetPixel(x, y, majorLine ? major : minorLine ? minor : baseColor);
                }
            }
            texture.Apply(false, true);
            return texture;
        }

        private void EnsureFactoryMarkings()
        {
            if (factoryMarkings != null) return;
            factoryMarkings = new GameObject("ForgeMind Factory Zones");
            factoryMarkings.transform.SetParent(transform, false);
            AddGridSurface();
            AddZone("RECEIVING / RAW", new Vector2(-19f, 3.7f), new Vector2(10f, 7f), new Color(0.44f, 0.51f, 0.49f, 0.18f));
            AddZone("MACHINING", new Vector2(-8.5f, 3.7f), new Vector2(11f, 7f), new Color(0.36f, 0.47f, 0.47f, 0.18f));
            AddZone("LINE-SIDE KITTING", new Vector2(-1.5f, -5f), new Vector2(15f, 4f), new Color(0.49f, 0.51f, 0.46f, 0.17f));
            AddZone("FORMING CELL", new Vector2(5.7f, 8f), new Vector2(4.5f, 9f), new Color(0.47f, 0.48f, 0.47f, 0.17f));
            AddZone("ELECTRICAL CELL", new Vector2(5.7f, -6f), new Vector2(4.5f, 9f), new Color(0.37f, 0.47f, 0.47f, 0.17f));
            AddZone("ROBOT ASSEMBLY", new Vector2(5.2f, 1f), new Vector2(7.5f, 8f), new Color(0.35f, 0.45f, 0.46f, 0.17f));
            AddZone("QA / PACK", new Vector2(11f, 1f), new Vector2(7f, 8f), new Color(0.44f, 0.51f, 0.49f, 0.17f));
            AddZone("FINISHED GOODS", new Vector2(17f, 1f), new Vector2(6f, 8f), new Color(0.47f, 0.50f, 0.47f, 0.17f));
            AddZone("AGV AISLE", new Vector2(0f, -13.3f), new Vector2(48f, 2.6f), new Color(0.35f, 0.41f, 0.40f, 0.18f));
            AddAisleMarkings();
        }

        private void AddGridSurface()
        {
            var minor = new List<Vector4>();
            var major = new List<Vector4>();
            for (var x = -25; x <= 25; x++)
                (x % 5 == 0 ? major : minor).Add(new Vector4(x, -17f, x, 17f));
            for (var z = -17; z <= 17; z++)
                (z % 5 == 0 ? major : minor).Add(new Vector4(-25f, z, 25f, z));
            CreateLineMesh("Factory Grid 1m", minor, 0.018f, 0.008f, new Color(0.63f, 0.70f, 0.68f, 0.72f));
            CreateLineMesh("Factory Grid 5m", major, 0.035f, 0.012f, new Color(0.38f, 0.49f, 0.46f, 0.82f));
            CreateLineMesh("Factory Boundary", new List<Vector4>
            {
                new Vector4(-25f, -17f, 25f, -17f), new Vector4(25f, -17f, 25f, 17f),
                new Vector4(25f, 17f, -25f, 17f), new Vector4(-25f, 17f, -25f, -17f),
            }, 0.07f, 0.016f, new Color(0.76f, 0.65f, 0.29f, 0.88f));
        }

        private void AddAisleMarkings()
        {
            var yellow = new Color(0.76f, 0.65f, 0.29f, 0.95f);
            CreateLineMesh("AGV Aisle Sides", new List<Vector4>
            {
                new Vector4(-24f, -14.6f, 24f, -14.6f),
                new Vector4(-24f, -12f, 24f, -12f),
            }, 0.09f, 0.024f, yellow);
            var dashes = new List<Vector4>();
            for (var x = -22f; x <= 22f; x += 2f) dashes.Add(new Vector4(x - 0.4f, -13.3f, x + 0.4f, -13.3f));
            CreateLineMesh("AGV Aisle Dashes", dashes, 0.055f, 0.026f, new Color(0.66f, 0.71f, 0.69f, 0.9f));
            AddGroundLabel("AGV LOGISTICS AISLE / KEEP CLEAR", new Vector3(-12f, 0.038f, -14.05f), 0.22f, TextAnchor.MiddleCenter);
        }

        private void CreateLineMesh(string name, List<Vector4> lines, float width, float y, Color color)
        {
            var vertices = new List<Vector3>(lines.Count * 4);
            var triangles = new List<int>(lines.Count * 6);
            foreach (var line in lines)
            {
                var start = new Vector2(line.x, line.y);
                var end = new Vector2(line.z, line.w);
                var direction = (end - start).normalized;
                var normal = new Vector2(-direction.y, direction.x) * (width * 0.5f);
                var first = vertices.Count;
                vertices.Add(new Vector3(start.x + normal.x, y, start.y + normal.y));
                vertices.Add(new Vector3(start.x - normal.x, y, start.y - normal.y));
                vertices.Add(new Vector3(end.x - normal.x, y, end.y - normal.y));
                vertices.Add(new Vector3(end.x + normal.x, y, end.y + normal.y));
                triangles.Add(first); triangles.Add(first + 1); triangles.Add(first + 2);
                triangles.Add(first); triangles.Add(first + 2); triangles.Add(first + 3);
                triangles.Add(first + 2); triangles.Add(first + 1); triangles.Add(first);
                triangles.Add(first + 3); triangles.Add(first + 2); triangles.Add(first);
            }
            var mesh = new Mesh { name = name + " Mesh" };
            mesh.SetVertices(vertices);
            mesh.SetTriangles(triangles, 0);
            mesh.RecalculateBounds();
            var target = new GameObject(name);
            target.transform.SetParent(factoryMarkings.transform, false);
            target.AddComponent<MeshFilter>().sharedMesh = mesh;
            target.AddComponent<MeshRenderer>().sharedMaterial = CreateSurfaceMaterial(name + " Material", color, true, null);
        }

        private static Material CreateSurfaceMaterial(string name, Color color, bool transparent, Material fallback)
        {
            var shader = Shader.Find(transparent ? "ForgeMind/FactoryZone" : "Unlit/Color");
            if (shader == null || !shader.isSupported) shader = fallback?.shader;
            if (shader == null || !shader.isSupported) shader = Shader.Find("Sprites/Default");
            if (shader == null) return fallback;
            var material = new Material(shader) { name = name };
            if (material.HasProperty("_BaseColor")) material.SetColor("_BaseColor", color);
            if (material.HasProperty("_Color")) material.SetColor("_Color", color);
            return material;
        }

        private void AddZone(string label, Vector2 center, Vector2 size, Color color)
        {
            var zone = GameObject.CreatePrimitive(PrimitiveType.Cube);
            zone.name = label;
            zone.transform.SetParent(factoryMarkings.transform, false);
            zone.transform.localPosition = new Vector3(center.x, 0.006f, center.y);
            zone.transform.localScale = new Vector3(size.x, 0.012f, size.y);
            var collider = zone.GetComponent<Collider>();
            if (collider != null) Destroy(collider);
            var renderer = zone.GetComponent<Renderer>();
            if (renderer != null)
            {
                var material = CreateSurfaceMaterial(label + " Zone Material", color, true, renderer.sharedMaterial);
                if (material != null) material.renderQueue = 3000;
                renderer.sharedMaterial = material;
            }
            var borderColor = new Color(0.55f, 0.62f, 0.59f, 0.72f);
            CreateLineMesh(label + " Border", new List<Vector4>
            {
                new Vector4(center.x - size.x * 0.5f, center.y - size.y * 0.5f, center.x + size.x * 0.5f, center.y - size.y * 0.5f),
                new Vector4(center.x + size.x * 0.5f, center.y - size.y * 0.5f, center.x + size.x * 0.5f, center.y + size.y * 0.5f),
                new Vector4(center.x + size.x * 0.5f, center.y + size.y * 0.5f, center.x - size.x * 0.5f, center.y + size.y * 0.5f),
                new Vector4(center.x - size.x * 0.5f, center.y + size.y * 0.5f, center.x - size.x * 0.5f, center.y - size.y * 0.5f),
            }, 0.055f, 0.02f, borderColor);
            AddGroundLabel(label, new Vector3(center.x, 0.036f, center.y - size.y * 0.5f + 0.34f), 0.2f, TextAnchor.MiddleCenter);
        }

        private void AddGroundLabel(string label, Vector3 position, float characterSize, TextAnchor anchor)
        {
            var target = new GameObject(label + " Label");
            target.transform.SetParent(factoryMarkings.transform, false);
            target.transform.localPosition = position;
            target.transform.localRotation = Quaternion.Euler(90f, 0f, 0f);
            var text = target.AddComponent<TextMesh>();
            text.text = label;
            text.anchor = anchor;
            text.alignment = TextAlignment.Center;
            text.fontSize = 64;
            text.characterSize = characterSize;
            text.color = new Color(0.29f, 0.36f, 0.34f, 0.92f);
            var renderer = target.GetComponent<MeshRenderer>();
            if (renderer != null) renderer.sortingOrder = 4;
        }

        private static bool IsHybridPlayer()
        {
            var args = Environment.GetCommandLineArgs();
            foreach (var argument in args)
            {
                if (string.Equals(argument, "-forgemindPipe", StringComparison.OrdinalIgnoreCase)) return true;
            }
            return false;
        }
    }

    /// <summary>
    /// Render-only hit proxy. The object id comes from FactorySave and is sent
    /// back to Web; this component never opens or mutates a business panel.
    /// </summary>
    public sealed class FactoryObjectHitTarget : MonoBehaviour
    {
        public string ObjectId { get; private set; }

        public void Configure(string objectId)
        {
            ObjectId = objectId ?? string.Empty;
        }
    }

    /// <summary>
    /// Small render-only selection tint. Property blocks preserve shared GLB
    /// materials and GPU instancing for the rest of the factory.
    /// </summary>
    public static class FactorySelectionVisual
    {
        private static readonly int BaseColor = Shader.PropertyToID("_BaseColor");
        private static readonly int ColorProperty = Shader.PropertyToID("_Color");

        public static void Apply(GameObject root, bool selected)
        {
            if (root == null) return;
            var block = new MaterialPropertyBlock();
            foreach (var renderer in root.GetComponentsInChildren<Renderer>(true))
            {
                if (renderer == null) continue;
                if (!selected)
                {
                    renderer.SetPropertyBlock(null);
                    continue;
                }
                renderer.GetPropertyBlock(block);
                var material = renderer.sharedMaterial;
                if (material != null && material.HasProperty(BaseColor))
                {
                    var color = material.GetColor(BaseColor);
                    block.SetColor(BaseColor, UnityEngine.Color.Lerp(color, new UnityEngine.Color(0.25f, 1f, 0.84f, color.a), 0.34f));
                }
                else if (material != null && material.HasProperty(ColorProperty))
                {
                    var color = material.GetColor(ColorProperty);
                    block.SetColor(ColorProperty, UnityEngine.Color.Lerp(color, new UnityEngine.Color(0.25f, 1f, 0.84f, color.a), 0.34f));
                }
                renderer.SetPropertyBlock(block);
            }
        }
    }
}
