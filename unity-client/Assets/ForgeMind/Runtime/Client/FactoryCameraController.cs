using UnityEngine;

namespace ForgeMind.Client
{
    /// <summary>
    /// Lightweight native orbit/pan/zoom camera. It updates one transform and
    /// does not touch the factory data or rebuild the render world.
    /// </summary>
    public sealed class FactoryCameraController : MonoBehaviour
    {
        [SerializeField] private Transform target;
        [SerializeField] private float distance = 34f;
        [SerializeField] private float minDistance = 3f;
        [SerializeField] private float maxDistance = 160f;
        [SerializeField] private float yaw = 42f;
        [SerializeField] private float pitch = 48f;
        [SerializeField] private float orbitSpeed = 0.22f;
        [SerializeField] private float panSpeed = 0.018f;
        [SerializeField] private float zoomSpeed = 4f;

        private bool poseTransition;
        private float poseTransitionStarted;
        private Vector3 poseFromTarget;
        private float poseFromDistance;
        private float poseFromYaw;
        private float poseFromPitch;
        private Vector3 poseToTarget;
        private float poseToDistance;
        private float poseToYaw;
        private float poseToPitch;

        private void Awake()
        {
            EnsureTarget();
        }

        private void EnsureTarget()
        {
            if (target != null) return;
            var targetObject = new GameObject("ForgeMind Runtime Camera Target");
            targetObject.transform.position = Vector3.zero;
            target = targetObject.transform;
        }

        public void SetPose(Vector3 position, Vector3 lookTarget, float fieldOfView, bool animate)
        {
            EnsureTarget();
            var direction = position - lookTarget;
            var newDistance = Mathf.Clamp(direction.magnitude, minDistance, maxDistance);
            var camera = GetComponent<Camera>();
            if (camera != null && fieldOfView > 1f) camera.fieldOfView = fieldOfView;
            target.position = lookTarget;
            distance = newDistance;
            poseTransition = false;
            transform.position = position;
            transform.LookAt(lookTarget, Vector3.up);
            var euler = transform.rotation.eulerAngles;
            yaw = euler.y;
            pitch = Mathf.Clamp(euler.x > 180f ? euler.x - 360f : euler.x, 12f, 82f);
            Debug.Log($"ForgeMind camera pose applied: position={transform.position.ToString("F2")}; target={lookTarget.ToString("F2")}; yaw={yaw:F1}; pitch={pitch:F1}; distance={distance:F1}; animateRequested={animate}");
        }

        public void Focus(Vector3 position)
        {
            if (target != null) target.position = position;
            distance = Mathf.Clamp(distance, minDistance, maxDistance);
            ApplyTransform();
        }

        private void LateUpdate()
        {
            if (target == null) return;
            if (poseTransition)
            {
                var t = Mathf.Clamp01((Time.unscaledTime - poseTransitionStarted) / 1.1f);
                var eased = t * t * t * (t * (t * 6f - 15f) + 10f);
                target.position = Vector3.Lerp(poseFromTarget, poseToTarget, eased);
                distance = Mathf.Lerp(poseFromDistance, poseToDistance, eased);
                yaw = Mathf.LerpAngle(poseFromYaw, poseToYaw, eased);
                pitch = Mathf.Lerp(poseFromPitch, poseToPitch, eased);
                ApplyTransform();
                if (t >= 1f) poseTransition = false;
                return;
            }
            if (Input.GetMouseButton(0) && !Input.GetKey(KeyCode.LeftAlt) && !Input.GetKey(KeyCode.RightAlt))
            {
                yaw += Input.GetAxis("Mouse X") * orbitSpeed * 10f;
                pitch = Mathf.Clamp(pitch - Input.GetAxis("Mouse Y") * orbitSpeed * 10f, 12f, 82f);
            }
            if (Input.GetMouseButton(2))
            {
                var right = transform.right;
                var up = Vector3.ProjectOnPlane(transform.up, Vector3.up).normalized;
                target.position += (-right * Input.GetAxis("Mouse X") - up * Input.GetAxis("Mouse Y")) * distance * panSpeed;
            }
            var scroll = Input.GetAxis("Mouse ScrollWheel");
            if (Mathf.Abs(scroll) > 0.0001f) distance = Mathf.Clamp(distance - scroll * zoomSpeed, minDistance, maxDistance);
            ApplyTransform();
        }

        private void ApplyTransform()
        {
            var rotation = Quaternion.Euler(pitch, yaw, 0f);
            transform.position = target.position - rotation * Vector3.forward * distance;
            transform.rotation = rotation;
        }
    }
}
