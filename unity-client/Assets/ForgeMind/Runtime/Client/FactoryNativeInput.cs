using UnityEngine;

namespace ForgeMind.Client
{
    /// <summary>
    /// Handles only input that lands on the Unity render surface. WebView2
    /// remains responsible for all surrounding controls and business actions.
    /// </summary>
    public sealed class FactoryNativeInput : MonoBehaviour
    {
        [SerializeField] private Camera renderCamera;
        [SerializeField] private ForgeMindNativeBridge bridge;
        [SerializeField] private LayerMask hitMask = ~0;
        [SerializeField] private float clickThreshold = 8f;

        private Vector3 pointerDown;
        private bool tracking;

        public void Configure(Camera camera, ForgeMindNativeBridge nativeBridge)
        {
            renderCamera = camera;
            bridge = nativeBridge;
        }

        private void Awake()
        {
            if (renderCamera == null) renderCamera = Camera.main;
            if (bridge == null) bridge = GetComponent<ForgeMindNativeBridge>();
        }

        private void Update()
        {
            if (renderCamera == null || bridge == null) return;
            if (Input.GetMouseButtonDown(0))
            {
                pointerDown = Input.mousePosition;
                tracking = true;
            }
            if (!Input.GetMouseButtonUp(0) || !tracking) return;
            tracking = false;
            if ((Input.mousePosition - pointerDown).sqrMagnitude > clickThreshold * clickThreshold) return;

            var ray = renderCamera.ScreenPointToRay(Input.mousePosition);
            if (Physics.Raycast(ray, out var hit, 1000f, hitMask, QueryTriggerInteraction.Ignore))
            {
                var target = hit.collider.GetComponentInParent<FactoryObjectHitTarget>();
                bridge.SendObjectSelected(target == null ? string.Empty : target.ObjectId);
            }
            else
            {
                bridge.SendObjectSelected(string.Empty);
            }
        }
    }
}
