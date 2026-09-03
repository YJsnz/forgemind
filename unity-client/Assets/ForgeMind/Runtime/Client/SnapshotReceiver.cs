using System;
using System.Collections.Concurrent;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;
using UnityEngine;

namespace ForgeMind.Client
{
    /// <summary>
    /// HTTP snapshot receiver for the native client. The web front-end runs the
    /// authoritative TS simulation and pushes its SimulationSnapshot here (via
    /// VITE_UNITY_SNAPSHOT_URL); Unity renders that snapshot and never runs a
    /// second business truth. The presenter interpolates item lots / AGV /
    /// drones from the snapshot exactly like the web renderer.
    /// </summary>
    public sealed class SnapshotReceiver : MonoBehaviour
    {
        [SerializeField] private FactoryReadOnlyRuntime readOnlyRuntime;
        [SerializeField] private int port = 9101;

        private readonly ConcurrentQueue<string> pending = new ConcurrentQueue<string>();
        private HttpListener listener;
        private Thread listenerThread;

        private void OnEnable()
        {
            if (readOnlyRuntime == null) readOnlyRuntime = GetComponent<FactoryReadOnlyRuntime>();
            StartListener();
        }

        private void OnDisable()
        {
            StopListener();
        }

        private void Update()
        {
            string json;
            while (pending.TryDequeue(out json))
            {
                readOnlyRuntime?.ApplySnapshotJson(json);
            }
        }

        private void StartListener()
        {
            if (listener != null) return;
            listener = new HttpListener();
            listener.Prefixes.Add($"http://127.0.0.1:{port}/");
            try
            {
                listener.Start();
            }
            catch (Exception error)
            {
                Debug.LogWarning($"ForgeMind SnapshotReceiver failed to listen on {port}: {error.Message}");
                listener.Close();
                listener = null;
                return;
            }
            listenerThread = new Thread(ServerLoop) { IsBackground = true, Name = "ForgeMind.SnapshotReceiver" };
            listenerThread.Start();
            Debug.Log($"ForgeMind SnapshotReceiver listening on http://127.0.0.1:{port}/snapshot");
        }

        private void StopListener()
        {
            if (listener == null) return;
            try { listener.Stop(); } catch { /* best effort */ }
            try { listener.Close(); } catch { /* best effort */ }
            listener = null;
            listenerThread = null;
        }

        private void ServerLoop()
        {
            while (listener != null && listener.IsListening)
            {
                HttpListenerContext context;
                try
                {
                    context = listener.GetContext();
                }
                catch (Exception)
                {
                    break;
                }

                try
                {
                    var request = context.Request;
                    AddCorsHeaders(context.Response);
                    if (string.Equals(request.HttpMethod, "OPTIONS", StringComparison.OrdinalIgnoreCase))
                    {
                        context.Response.StatusCode = 200;
                        context.Response.Close();
                        continue;
                    }
                    if (string.Equals(request.HttpMethod, "POST", StringComparison.OrdinalIgnoreCase) &&
                        string.Equals(request.Url.AbsolutePath, "/snapshot", StringComparison.OrdinalIgnoreCase))
                    {
                        using (var reader = new StreamReader(request.InputStream, Encoding.UTF8))
                        {
                            var body = reader.ReadToEnd();
                            if (!string.IsNullOrWhiteSpace(body)) pending.Enqueue(body);
                        }
                        context.Response.StatusCode = 200;
                        context.Response.Close();
                        continue;
                    }
                    context.Response.StatusCode = 404;
                    context.Response.Close();
                }
                catch (Exception)
                {
                    try { context.Response.StatusCode = 500; context.Response.Close(); }
                    catch { /* client gone */ }
                }
            }
        }

        private static void AddCorsHeaders(HttpListenerResponse response)
        {
            response.AddHeader("Access-Control-Allow-Origin", "*");
            response.AddHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
            response.AddHeader("Access-Control-Allow-Headers", "Content-Type");
        }
    }
}
