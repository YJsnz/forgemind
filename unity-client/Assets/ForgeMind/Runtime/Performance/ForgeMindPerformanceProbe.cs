using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using UnityEngine;

namespace ForgeMind.Client.Performance
{
    /// <summary>
    /// Lightweight native-player probe for U1. It records CPU frame time and
    /// labels GPU timing as pending until the render Spike wires backend timing.
    /// </summary>
    public sealed class ForgeMindPerformanceProbe : MonoBehaviour
    {
        [SerializeField] private int targetFps = 120;
        [SerializeField] private bool showOverlay = true;
        [SerializeField] private bool captureOnStart;
        [SerializeField] private float captureSeconds = 60f;

        private readonly List<float> samples = new List<float>(8192);
        private readonly List<float> gpuSamples = new List<float>(8192);
        private readonly FrameTiming[] timingBuffer = new FrameTiming[1];
        private float captureElapsed;
        private bool capturing;
        private int timingFrame;
        private string lastReport = "not captured";

        public IReadOnlyList<float> Samples => samples;
        public string LastReport => lastReport;

        private void Awake()
        {
            // The final desktop client renders the existing Web workbench in
            // WebView2.  This probe is for standalone U1/S03 measurements and
            // must never paint an IMGUI overlay over the browser surface.
            if (IsHybridLaunch())
            {
                enabled = false;
                return;
            }
            Application.targetFrameRate = Mathf.Max(30, targetFps);
            QualitySettings.vSyncCount = 0;
            Application.runInBackground = true;
            capturing = captureOnStart;
            captureElapsed = 0f;
            timingFrame = 0;
            samples.Clear();
            gpuSamples.Clear();
            Debug.Log($"ForgeMind frame timing stats enabled={FrameTimingManager.IsFeatureEnabled()}; gpuTimerFrequency={FrameTimingManager.GetGpuTimerFrequency()}");
        }

        private static bool IsHybridLaunch()
        {
            var arguments = Environment.GetCommandLineArgs();
            for (var index = 0; index < arguments.Length; index++)
            {
                if (string.Equals(arguments[index], "-forgemindPipe", StringComparison.OrdinalIgnoreCase)) return true;
            }
            return false;
        }

        private void Update()
        {
            if (!capturing) return;
            samples.Add(Time.unscaledDeltaTime * 1000f);
            timingFrame++;
            if ((timingFrame & 3) == 0) CaptureGpuTiming();
            captureElapsed += Time.unscaledDeltaTime;
            if (captureElapsed >= Mathf.Max(1f, captureSeconds)) FinishCapture();
        }

        public void BeginCapture(float seconds = -1f)
        {
            if (seconds > 0f) captureSeconds = seconds;
            samples.Clear();
            gpuSamples.Clear();
            timingFrame = 0;
            captureElapsed = 0f;
            capturing = true;
        }

        public void FinishCapture()
        {
            capturing = false;
            if (samples.Count == 0)
            {
                lastReport = "no CPU frame samples";
                return;
            }

            var sorted = new List<float>(samples);
            sorted.Sort();
            lastReport = string.Format(CultureInfo.InvariantCulture,
                "samples={0}; cpuAvg={1:0.00}ms; cpuP50={2:0.00}ms; cpuP95={3:0.00}ms; cpuP99={4:0.00}ms; gpuAvg={5}; gpuP95={6}; gpuP99={7}",
                samples.Count, Average(samples), Percentile(sorted, 0.50f), Percentile(sorted, 0.95f), Percentile(sorted, 0.99f),
                FormatGpuPercentile(0.50f), FormatGpuPercentile(0.95f), FormatGpuPercentile(0.99f));
            SaveReport();
            Debug.Log($"ForgeMind U1 performance capture: {lastReport}");
        }

        private void OnGUI()
        {
            if (!showOverlay) return;
            var frameMs = Time.unscaledDeltaTime * 1000f;
            var fps = frameMs > 0.001f ? 1000f / frameMs : 0f;
            GUI.color = Color.white;
            var gpu = gpuSamples.Count == 0 ? "pending" : $"{gpuSamples[gpuSamples.Count - 1]:0.00}ms";
            GUI.Label(new Rect(16f, 16f, 760f, 24f), $"FORGEMIND U1  FPS {fps:0.0}  CPU {frameMs:0.00}ms  GPU {gpu}");
            GUI.Label(new Rect(16f, 40f, 900f, 24f), $"capture={(capturing ? $"{captureElapsed:0.0}/{captureSeconds:0.0}s" : lastReport)}");
        }

        private void SaveReport()
        {
            var path = Path.Combine(Application.persistentDataPath, "forgemind-u1-performance.csv");
            var output = new StringBuilder("frameIndex,cpuFrameMs,gpuFrameMs\n");
            for (var index = 0; index < samples.Count; index++)
            {
                output.Append(index.ToString(CultureInfo.InvariantCulture));
                output.Append(',');
                output.Append(samples[index].ToString("0.000", CultureInfo.InvariantCulture));
                output.Append(',');
                var gpuIndex = index / 4;
                output.AppendLine(gpuIndex < gpuSamples.Count ? gpuSamples[gpuIndex].ToString("0.000", CultureInfo.InvariantCulture) : string.Empty);
            }
            File.WriteAllText(path, output.ToString(), Encoding.UTF8);
        }

        private void CaptureGpuTiming()
        {
            FrameTimingManager.CaptureFrameTimings();
            if (FrameTimingManager.GetLatestTimings(1, timingBuffer) == 0) return;
            var gpuMs = (float)timingBuffer[0].gpuFrameTime;
            if (gpuMs > 0f && gpuMs < 1000f) gpuSamples.Add(gpuMs);
        }

        private string FormatGpuPercentile(float percentile)
        {
            if (gpuSamples.Count == 0) return "pending";
            var sorted = new List<float>(gpuSamples);
            sorted.Sort();
            return Percentile(sorted, percentile).ToString("0.00", CultureInfo.InvariantCulture) + "ms";
        }

        private static float Average(List<float> values)
        {
            var total = 0f;
            for (var index = 0; index < values.Count; index++) total += values[index];
            return total / values.Count;
        }

        private static float Percentile(List<float> sorted, float percentile)
        {
            var position = (sorted.Count - 1) * Mathf.Clamp01(percentile);
            var lower = Mathf.FloorToInt(position);
            var upper = Mathf.Min(lower + 1, sorted.Count - 1);
            return Mathf.Lerp(sorted[lower], sorted[upper], position - lower);
        }
    }
}
