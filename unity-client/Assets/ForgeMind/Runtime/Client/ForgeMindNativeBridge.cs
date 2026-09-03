using System;
using System.Collections.Concurrent;
using System.IO;
using System.IO.Pipes;
using System.Text;
using System.Threading;
using ForgeMind.Client.Contracts;
using UnityEngine;
using UnityEngine.Profiling;

namespace ForgeMind.Client
{
    /// <summary>
    /// WebView2 host bridge. This process owns only render-side state: the Web
    /// app remains the business/UI authority. Messages are newline-delimited
    /// JSON over a local named pipe owned by the desktop host.
    /// </summary>
    public sealed class ForgeMindNativeBridge : MonoBehaviour
    {
        private const string Protocol = "forgemind.unity.bridge.v1";
        private const int MaxMessageLength = 4 * 1024 * 1024;

        [SerializeField] private string pipeName = "forgemind-unity";
        [SerializeField] private bool autoStart = true;
        [SerializeField] private string clientVersion = "0.1.0-u1";

        private readonly ConcurrentQueue<string> incoming = new ConcurrentQueue<string>();
        private readonly object writeLock = new object();
        private CancellationTokenSource cancellation;
        private Thread serverThread;
        private NamedPipeServerStream pipe;
        private NamedPipeServerStream outputPipe;
        private StreamWriter writer;
        private bool readySent;
        private string graphicsApi = "Unknown";
        private readonly FrameTiming[] frameTimings = new FrameTiming[1];
        private float smoothedFrameMs;
        private float statsElapsed;

        public event Action<UnityBridgeEnvelopeData> MessageReceived;
        public event Action<FactorySaveData, int> SceneReceived;
        public event Action<SimulationSnapshotData> SnapshotReceived;
        public event Action<int, int[]> FloorReceived;
        public event Action<string[]> SelectionReceived;
        public event Action<UnityCameraData> CameraReceived;
        public bool IsConnected { get; private set; }

        private void Start()
        {
            // Unity APIs, including SystemInfo, must be read on the main thread.
            // The named-pipe server sends bridge.ready from a worker thread.
            graphicsApi = SystemInfo.graphicsDeviceType.ToString();
            QualitySettings.vSyncCount = 0;
            Application.targetFrameRate = 60;
            Application.runInBackground = true;
            Debug.Log($"ForgeMind bridge Start: autoStart={autoStart}; cmdPipe={ReadPipeNameFromCommandLine()}");
            if (autoStart) StartBridge();
        }

        private void Update()
        {
            while (incoming.TryDequeue(out var json)) Dispatch(json);
            var frameMs = Mathf.Max(0.01f, Time.unscaledDeltaTime * 1000f);
            smoothedFrameMs = smoothedFrameMs <= 0f ? frameMs : Mathf.Lerp(smoothedFrameMs, frameMs, 0.08f);
            statsElapsed += Time.unscaledDeltaTime;
            if (!IsConnected || statsElapsed < 1f) return;
            statsElapsed = 0f;
            FrameTimingManager.CaptureFrameTimings();
            var gpuFrameMs = 0f;
            if (FrameTimingManager.GetLatestTimings(1, frameTimings) > 0)
                gpuFrameMs = (float)frameTimings[0].gpuFrameTime;
            SendRenderStats(new ForgeMindBridgeRenderStats
            {
                fps = 1000f / Mathf.Max(0.01f, smoothedFrameMs),
                cpuFrameMs = smoothedFrameMs,
                gpuFrameMs = gpuFrameMs,
                drawCalls = 0,
                triangles = 0,
                allocatedMemoryBytes = Profiler.GetTotalAllocatedMemoryLong(),
                graphicsApi = graphicsApi,
            });
        }

        public void StartBridge()
        {
            if (serverThread != null) return;
            var configuredPipe = ReadPipeNameFromCommandLine();
            if (!string.IsNullOrWhiteSpace(configuredPipe)) pipeName = configuredPipe;
            Debug.Log($"ForgeMind bridge StartBridge: pipe={pipeName}");
            cancellation = new CancellationTokenSource();
            serverThread = new Thread(ServerLoop) { IsBackground = true, Name = "ForgeMind.WebView2Bridge" };
            serverThread.Start();
        }

        public void StopBridge()
        {
            cancellation?.Cancel();
            try { pipe?.Dispose(); } catch { /* shutdown is best effort */ }
            try { outputPipe?.Dispose(); } catch { /* shutdown is best effort */ }
            pipe = null;
            outputPipe = null;
            writer = null;
            IsConnected = false;
            serverThread = null;
        }

        private void OnDestroy()
        {
            StopBridge();
        }

        private void ServerLoop()
        {
            try
            {
                while (cancellation != null && !cancellation.IsCancellationRequested)
                {
                    using (var nextPipe = new NamedPipeServerStream(pipeName + "-in", PipeDirection.In, 1, PipeTransmissionMode.Byte))
                    using (var nextOutputPipe = new NamedPipeServerStream(pipeName + "-out", PipeDirection.Out, 1, PipeTransmissionMode.Byte))
                    {
                        pipe = nextPipe;
                        outputPipe = nextOutputPipe;
                        Debug.Log($"ForgeMind bridge waiting on pipe {pipeName}...");
                        nextPipe.WaitForConnection();
                        nextOutputPipe.WaitForConnection();
                        if (cancellation.IsCancellationRequested) break;
                        IsConnected = true;
                        Debug.Log($"ForgeMind bridge connected: pipe={pipeName}");
                        using (var reader = new StreamReader(nextPipe, new UTF8Encoding(false), false, 4096, true))
                        using (var nextWriter = new StreamWriter(nextOutputPipe, new UTF8Encoding(false), 4096, true) { AutoFlush = true })
                        {
                            writer = nextWriter;
                            SendReady();
                            string line;
                            while (!cancellation.IsCancellationRequested && (line = reader.ReadLine()) != null)
                            {
                                if (line.Length > MaxMessageLength)
                                {
                                    SendError("message_too_large", "Bridge message exceeds the maximum length.", string.Empty);
                                    continue;
                                }
                                incoming.Enqueue(line);
                            }
                        }
                    }
                    IsConnected = false;
                    readySent = false;
                    writer = null;
                    pipe = null;
                    outputPipe = null;
                }
            }
            catch (Exception error)
            {
                Debug.LogWarning($"ForgeMind bridge stopped: {error.Message}");
                IsConnected = false;
            }
        }

        private void Dispatch(string json)
        {
            if (!ForgeMindJson.TryDeserialize(json, out UnityBridgeEnvelopeData message, out var error))
            {
                SendError("invalid_json", error, string.Empty);
                return;
            }
            if (message == null || message.protocol != Protocol)
            {
                SendError("protocol_mismatch", "Unsupported ForgeMind bridge protocol.", message?.requestId);
                return;
            }

            Debug.Log($"ForgeMind bridge received: type={message.type}; bytes={json.Length}");
            MessageReceived?.Invoke(message);
            var payload = message.payload;
            switch (message.type)
            {
                case "bridge.ping":
                    SendReady(true);
                    break;
                case "scene.replace":
                    if (payload?.save == null) SendError("missing_scene", "scene.replace requires payload.save.", message.requestId);
                    else SceneReceived?.Invoke(payload.save, Mathf.Max(1, payload.activeFloor));
                    Send("scene.ack", message.requestId, new UnityBridgeSceneAckData { objectCount = payload?.save?.objects?.Length ?? 0 });
                    break;
                case "simulation.snapshot":
                    if (payload?.simSnapshot != null) SnapshotReceived?.Invoke(payload.simSnapshot);
                    break;
                case "view.floor":
                    FloorReceived?.Invoke(Mathf.Max(1, payload?.activeFloor ?? 1), payload?.visibleFloors ?? Array.Empty<int>());
                    break;
                case "selection.set":
                    SelectionReceived?.Invoke(payload?.selectedIds ?? Array.Empty<string>());
                    break;
                case "camera.set":
                    if (payload?.camera != null) CameraReceived?.Invoke(payload.camera);
                    break;
                case "render.configure":
                    QualitySettings.vSyncCount = 0;
                    Application.targetFrameRate = Mathf.Clamp(payload?.targetFps ?? 60, 30, 240);
                    break;
                case "bridge.shutdown":
                    StopBridge();
                    break;
            }
        }

        public void SendObjectSelected(string objectId)
        {
            Send("object.selected", string.Empty, new UnityBridgeObjectSelectedData { objectId = objectId ?? string.Empty });
        }

        public void SendRenderStats(ForgeMindBridgeRenderStats stats)
        {
            if (stats == null) return;
            Send("render.stats", string.Empty, stats);
        }

        public void SendCameraChanged(Vector3 position, Vector3 target, float fov, float distance)
        {
            Send("camera.changed", string.Empty, new UnityCameraData
            {
                position = ToRuntimePosition(position),
                target = ToRuntimePosition(target),
                fov = fov,
                distance = distance,
                animate = false,
            });
        }

        private static RuntimePositionData ToRuntimePosition(Vector3 value)
        {
            return new RuntimePositionData { x = value.x, y = value.y, z = value.z };
        }

        private void SendReady(bool force = false)
        {
            if (readySent && !force) return;
            readySent = true;
            Debug.Log("ForgeMind bridge sending ready");
            Send("bridge.ready", string.Empty, new UnityBridgeReadyData
            {
                protocol = Protocol,
                clientVersion = clientVersion,
                graphicsApi = this.graphicsApi,
                nativeSurface = true,
            });
        }

        private void SendError(string code, string message, string requestId)
        {
            Send("bridge.error", requestId, new UnityBridgeErrorData { code = code, message = message });
        }

        private void Send(string type, string requestId, object payload)
        {
            if (writer == null) return;
            var envelope = new UnityBridgeOutboundData { protocol = Protocol, type = type, requestId = requestId ?? string.Empty, payloadJson = ForgeMindJson.Serialize(payload) };
            var json = "{\"protocol\":" + ForgeMindJson.Quote(envelope.protocol)
                + ",\"type\":" + ForgeMindJson.Quote(envelope.type)
                + ",\"requestId\":" + ForgeMindJson.Quote(envelope.requestId)
                + ",\"payload\":" + envelope.payloadJson + "}";
            lock (writeLock)
            {
                try { writer.WriteLine(json); }
                catch (IOException) { IsConnected = false; }
                catch (ObjectDisposedException) { IsConnected = false; }
            }
        }

        private static string ReadPipeNameFromCommandLine()
        {
            var args = Environment.GetCommandLineArgs();
            for (var i = 0; i + 1 < args.Length; i++)
            {
                if (string.Equals(args[i], "-forgemindPipe", StringComparison.OrdinalIgnoreCase)) return args[i + 1];
            }
            return string.Empty;
        }

        [Serializable]
        public sealed class ForgeMindBridgeRenderStats
        {
            public float fps;
            public float cpuFrameMs;
            public float gpuFrameMs;
            public int drawCalls;
            public int triangles;
            public long allocatedMemoryBytes;
            public string graphicsApi;
        }

        [Serializable]
        private sealed class UnityBridgeSceneAckData
        {
            public int objectCount;
        }

        [Serializable]
        private sealed class UnityBridgeObjectSelectedData
        {
            public string objectId;
        }

        [Serializable]
        private sealed class UnityBridgeErrorData
        {
            public string code;
            public string message;
        }

        [Serializable]
        private sealed class UnityBridgeOutboundData
        {
            public string protocol;
            public string type;
            public string requestId;
            public string payloadJson;
        }
    }
}
