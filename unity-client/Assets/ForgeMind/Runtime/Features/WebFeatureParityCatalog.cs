using System.Text;

namespace ForgeMind.Client.Features
{
    public enum WebFeatureId
    {
        Portal,
        AuthenticationAndProjects,
        FactoryEditing,
        MultiFloor,
        ProductionCatalog,
        IndustrialLogistics,
        Simulation,
        Agv,
        Drone,
        AgentDiagnostics,
        Autopilot,
        GenerativeFactory,
        PatchWorkflow,
        ResourceImport,
        VisualInspection,
        AssistantAndVoice,
    }

    public enum FeatureParityStatus
    {
        /// <summary>Declared in scope, not yet exercised in the hybrid client.</summary>
        Planned,
        /// <summary>Exercised in the WebView2 hybrid client against the WebView2 page.</summary>
        Verified,
        /// <summary>Not reachable in the current environment; precondition recorded.</summary>
        Blocked,
    }

    public sealed class WebFeatureParityEntry
    {
        public WebFeatureId Id;
        public string DisplayName;
        public FeatureParityStatus Status = FeatureParityStatus.Planned;
        public string Evidence = string.Empty;
    }

    /// <summary>
    /// Sign-off matrix for the WebView2 hybrid client. Coverage means the same
    /// React page runs inside WebView2 with the expected behavior; it is not a
    /// Unity re-implementation. Update Status + Evidence after each feature is
    /// exercised on a real desktop run.
    /// </summary>
    public static class WebFeatureParityCatalog
    {
        public static WebFeatureParityEntry[] All { get; } = Build();

        public static WebFeatureParityEntry Get(WebFeatureId id)
        {
            foreach (var entry in All)
            {
                if (entry.Id == id) return entry;
            }
            return null;
        }

        public static void MarkVerified(WebFeatureId id, string evidence)
        {
            var entry = Get(id);
            if (entry == null) return;
            entry.Status = FeatureParityStatus.Verified;
            entry.Evidence = evidence;
        }

        public static void MarkBlocked(WebFeatureId id, string evidence)
        {
            var entry = Get(id);
            if (entry == null) return;
            entry.Status = FeatureParityStatus.Blocked;
            entry.Evidence = evidence;
        }

        public static string ExportJson()
        {
            var output = new StringBuilder();
            output.Append('[');
            for (var index = 0; index < All.Length; index++)
            {
                var entry = All[index];
                if (index > 0) output.Append(',');
                output.Append('{');
                output.Append("\"id\":\"").Append(entry.Id).Append('"');
                output.Append(",\"displayName\":\"").Append(Escape(entry.DisplayName)).Append('"');
                output.Append(",\"status\":\"").Append(entry.Status).Append('"');
                output.Append(",\"evidence\":\"").Append(Escape(entry.Evidence)).Append('"');
                output.Append('}');
            }
            output.Append(']');
            return output.ToString();
        }

        private static WebFeatureParityEntry[] Build()
        {
            return new[]
            {
                Entry(WebFeatureId.Portal, "官网门户"),
                Entry(WebFeatureId.AuthenticationAndProjects, "认证与项目"),
                Entry(WebFeatureId.FactoryEditing, "工厂编辑"),
                Entry(WebFeatureId.MultiFloor, "多楼层"),
                Entry(WebFeatureId.ProductionCatalog, "生产资料"),
                Entry(WebFeatureId.IndustrialLogistics, "工业物流"),
                Entry(WebFeatureId.Simulation, "仿真运行"),
                Entry(WebFeatureId.Agv, "AGV"),
                Entry(WebFeatureId.Drone, "无人机"),
                Entry(WebFeatureId.AgentDiagnostics, "诊断 Agent"),
                Entry(WebFeatureId.Autopilot, "自动巡检"),
                Entry(WebFeatureId.GenerativeFactory, "生成式工厂"),
                Entry(WebFeatureId.PatchWorkflow, "Patch 闭环"),
                Entry(WebFeatureId.ResourceImport, "资源导入"),
                Entry(WebFeatureId.VisualInspection, "视觉检测"),
                Entry(WebFeatureId.AssistantAndVoice, "AI 管家与语音"),
            };
        }

        private static WebFeatureParityEntry Entry(WebFeatureId id, string displayName)
        {
            return new WebFeatureParityEntry { Id = id, DisplayName = displayName };
        }

        private static string Escape(string value)
        {
            return (value ?? string.Empty).Replace("\\", "\\\\").Replace("\"", "\\\"");
        }
    }
}
