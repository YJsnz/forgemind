using ForgeMind.Client.Api;
using ForgeMind.Client.Performance;
using UnityEngine;

namespace ForgeMind.Client
{
    /// <summary>
    /// Composition root for the Unity render side of the WebView2 hybrid
    /// client. Web remains the UI and business authority.
    /// </summary>
    public sealed class FactoryClientBootstrap : MonoBehaviour
    {
        [SerializeField] private ForgeMindApiClient apiClient;
        [SerializeField] private FactoryReadOnlyRuntime readOnlyRuntime;
        [SerializeField] private ForgeMindPerformanceProbe performanceProbe;
        [SerializeField] private FactoryNativeShell nativeShell;
        [SerializeField] private ForgeMindNativeBridge nativeBridge;
        [SerializeField] private FactoryScenePresenter scenePresenter;

        public ForgeMindApiClient ApiClient => apiClient;
        public FactoryReadOnlyRuntime ReadOnlyRuntime => readOnlyRuntime;
        public ForgeMindPerformanceProbe PerformanceProbe => performanceProbe;
        public FactoryNativeShell NativeShell => nativeShell;
        public ForgeMindNativeBridge NativeBridge => nativeBridge;

        private void Start()
        {
            // Safety net for scenes whose static objects are baked directly
            // (for example the S03 stress scene) rather than projected by the
            // presenter: enable GPU instancing on every shared material.
            ForgeMindInstancing.EnableForSceneRoots();
        }

        private void OnEnable()
        {
            if (nativeBridge == null) return;
            nativeBridge.SceneReceived += OnSceneReceived;
            nativeBridge.SnapshotReceived += OnSnapshotReceived;
            nativeBridge.FloorReceived += OnFloorReceived;
            nativeBridge.SelectionReceived += OnSelectionReceived;
            nativeBridge.CameraReceived += OnCameraReceived;
        }

        private void OnDisable()
        {
            if (nativeBridge == null) return;
            nativeBridge.SceneReceived -= OnSceneReceived;
            nativeBridge.SnapshotReceived -= OnSnapshotReceived;
            nativeBridge.FloorReceived -= OnFloorReceived;
            nativeBridge.SelectionReceived -= OnSelectionReceived;
            nativeBridge.CameraReceived -= OnCameraReceived;
        }

        private void OnSceneReceived(ForgeMind.Client.Contracts.FactorySaveData save, int floorId)
        {
            readOnlyRuntime?.ApplySave(save);
            // Apply directly as well: Unity does not guarantee OnEnable order
            // between sibling MonoBehaviours restored from the benchmark scene.
            // The presenter operation is idempotent and this guarantees the
            // packaged hybrid player clears all benchmark previews on its
            // first authoritative Web scene.
            if (scenePresenter != null && !scenePresenter.HasAppliedSave(save)) scenePresenter.ApplySave(save);
            scenePresenter?.SetFloorVisibility(floorId, null);
        }

        private void OnSnapshotReceived(ForgeMind.Client.Contracts.SimulationSnapshotData snapshot)
        {
            readOnlyRuntime?.ApplySnapshot(snapshot);
        }

        private void OnFloorReceived(int floorId, int[] visibleFloors)
        {
            scenePresenter?.SetFloorVisibility(floorId, visibleFloors);
        }

        private void OnSelectionReceived(string[] selectedIds)
        {
            scenePresenter?.SetSelection(selectedIds);
        }

        private void OnCameraReceived(ForgeMind.Client.Contracts.UnityCameraData camera)
        {
            if (camera == null || camera.position == null || camera.target == null) return;
            var mainCamera = Camera.main;
            if (mainCamera == null)
            {
                Debug.LogError("ForgeMind camera message ignored: no MainCamera exists.");
                return;
            }
            var controller = mainCamera.GetComponent<FactoryCameraController>();
            if (controller == null) controller = mainCamera.gameObject.AddComponent<FactoryCameraController>();
            Debug.Log($"ForgeMind camera message: position=({camera.position.x:F2},{camera.position.y:F2},{camera.position.z:F2}); target=({camera.target.x:F2},{camera.target.y:F2},{camera.target.z:F2}); controller={controller != null}");
            controller.SetPose(
                new Vector3(camera.position.x, camera.position.y, camera.position.z),
                new Vector3(camera.target.x, camera.target.y, camera.target.z),
                camera.fov,
                camera.animate);
        }

        public void BeginPerformanceCapture(float seconds = 60f)
        {
            performanceProbe?.BeginCapture(seconds);
        }

        public void EndPerformanceCapture()
        {
            performanceProbe?.FinishCapture();
        }
    }
}
