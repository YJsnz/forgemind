using System;
using System.Collections;
using ForgeMind.Client.Api;
using ForgeMind.Client.Contracts;
using ForgeMind.Client.Features;
using UnityEngine;

namespace ForgeMind.Client
{
    /// <summary>
    /// Native client shell for the first end-to-end workflow.  It deliberately
    /// uses the same REST contracts as the Web client and never writes a local
    /// business result over the server save.
    /// </summary>
    public sealed class FactoryNativeShell : MonoBehaviour
    {
        private const string TokenKey = "forgemind.native.token";

        [SerializeField] private ForgeMindApiClient apiClient;
        [SerializeField] private FactoryReadOnlyRuntime readOnlyRuntime;
        [SerializeField] private FactoryScenePresenter scenePresenter;

        private string username = string.Empty;
        private string password = string.Empty;
        private string message = "请输入后端地址、账号和密码。";
        private string currentUser = string.Empty;
        private FactoryProjectSummaryData[] projects = Array.Empty<FactoryProjectSummaryData>();
        private string currentProjectId = string.Empty;
        private string agentObjective = "检查当前工厂的结构、物流和产能瓶颈";
        private string agentMessage = string.Empty;
        private string agentResult = string.Empty;
        private bool busy;
        private bool showFeatureMatrix;
        private Vector2 projectScroll;

        public void Configure(ForgeMindApiClient api, FactoryReadOnlyRuntime runtime, FactoryScenePresenter presenter = null)
        {
            apiClient = api;
            readOnlyRuntime = runtime;
            scenePresenter = presenter;
        }

        private void Awake()
        {
            foreach (var argument in Environment.GetCommandLineArgs())
            {
                if (string.Equals(argument, "-forgemindPipe", StringComparison.OrdinalIgnoreCase))
                {
                    enabled = false;
                    return;
                }
            }
            if (apiClient == null) apiClient = GetComponent<ForgeMindApiClient>();
            if (readOnlyRuntime == null) readOnlyRuntime = GetComponent<FactoryReadOnlyRuntime>();
            if (scenePresenter == null) scenePresenter = GetComponent<FactoryScenePresenter>();
            var token = PlayerPrefs.GetString(TokenKey, string.Empty);
            if (!string.IsNullOrWhiteSpace(token) && apiClient != null)
            {
                apiClient.SetAuthToken(token);
                StartCoroutine(LoadProjects());
            }
            // 调试钩子：预置 forgemind.native.autoload=项目ID 时，启动后自动打开该项目，
            // 用于无人值守验证渲染闭环（读 PlayerPrefs，生产流程不触碰）。
            var autoProject = PlayerPrefs.GetString("forgemind.native.autoload", string.Empty);
            if (!string.IsNullOrWhiteSpace(autoProject) && apiClient != null)
            {
                apiClient.SetAuthToken(PlayerPrefs.GetString(TokenKey, string.Empty));
                StartCoroutine(AutoLoadProject(autoProject));
            }
        }

        private IEnumerator AutoLoadProject(string projectId)
        {
            yield return LoadProjects();
            yield return OpenProject(projectId);
        }

        private void OnGUI()
        {
            // Defensive guard for a stale serialized scene or an older player
            // binary: the hybrid client must leave all UI to WebView2.
            if (IsHybridLaunch()) return;
            if (apiClient == null) return;

            var panelWidth = Mathf.Min(430f, Screen.width * 0.42f);
            GUILayout.BeginArea(new Rect(18f, 18f, panelWidth, Screen.height - 36f), GUI.skin.box);
            GUILayout.Label("ForgeMind Native Client", HeaderStyle());
            GUILayout.Label("Unity/Tuanjie Windows · server-authoritative", CaptionStyle());
            GUILayout.Space(8f);

            if (!apiClient.IsAuthenticated)
            {
                DrawConnectionForm();
            }
            else
            {
                DrawAuthenticatedWorkspace();
            }

            GUILayout.EndArea();
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

        private void DrawConnectionForm()
        {
            GUILayout.Label("后端地址", CaptionStyle());
            var baseUrl = GUILayout.TextField(apiClient.BaseUrl);
            if (!string.Equals(baseUrl, apiClient.BaseUrl, StringComparison.Ordinal)) apiClient.ConfigureBaseUrl(baseUrl);
            GUILayout.Space(6f);
            GUILayout.Label("账号", CaptionStyle());
            username = GUILayout.TextField(username);
            GUILayout.Label("密码", CaptionStyle());
            password = GUILayout.PasswordField(password, '*');
            GUILayout.Space(8f);
            GUILayout.BeginHorizontal();
            if (GUILayout.Button("登录", GUILayout.Height(30f))) StartCoroutine(Authenticate("login"));
            if (GUILayout.Button("注册并登录", GUILayout.Height(30f))) StartCoroutine(Authenticate("register"));
            GUILayout.EndHorizontal();
            DrawMessage();
            GUILayout.FlexibleSpace();
            DrawFeatureMatrixButton();
        }

        private void DrawAuthenticatedWorkspace()
        {
            GUILayout.Label($"已登录：{currentUser}", HeaderStyle());
            GUILayout.BeginHorizontal();
            if (GUILayout.Button("刷新项目")) StartCoroutine(LoadProjects());
            if (GUILayout.Button("退出登录")) Logout();
            GUILayout.EndHorizontal();
            DrawMessage();
            GUILayout.Space(8f);
            GUILayout.Label("项目", HeaderStyle());
            projectScroll = GUILayout.BeginScrollView(projectScroll, GUILayout.Height(Mathf.Min(360f, Screen.height * 0.45f)));
            if (projects.Length == 0)
            {
                GUILayout.Label("暂无项目，或当前账号还没有项目。", CaptionStyle());
            }
            else
            {
                foreach (var project in projects)
                {
                    GUILayout.BeginHorizontal(GUI.skin.box);
                    GUILayout.BeginVertical();
                    GUILayout.Label(string.IsNullOrWhiteSpace(project.name) ? "未命名工厂" : project.name);
                    GUILayout.Label($"对象 {project.objectCount} · 楼层 {project.floorCount} · v{project.version}", CaptionStyle());
                    GUILayout.EndVertical();
                    if (GUILayout.Button("打开", GUILayout.Width(64f))) StartCoroutine(OpenProject(project.id));
                    GUILayout.EndHorizontal();
                }
            }
            GUILayout.EndScrollView();
            if (readOnlyRuntime != null && readOnlyRuntime.CurrentSave != null)
            {
                var save = readOnlyRuntime.CurrentSave;
                GUILayout.Space(8f);
                GUILayout.Label($"当前工厂：{save.name} · {save.objects.Length} 个对象 · {save.floorCount} 层", HeaderStyle());
                GUILayout.BeginHorizontal();
                for (var floor = 1; floor <= Mathf.Max(1, save.floorCount); floor++)
                {
                    var floorId = floor;
                    if (GUILayout.Button($"L{floorId}", GUILayout.Width(42f))) scenePresenter?.SetActiveFloor(floorId);
                }
                GUILayout.EndHorizontal();
                GUILayout.Label("当前阶段为只读载入；正式编辑、仿真控制和审批动作继续沿用服务端门禁。", CaptionStyle());
                GUILayout.Space(6f);
                GUILayout.Label("确定性诊断 Agent", HeaderStyle());
                agentObjective = GUILayout.TextField(agentObjective);
                if (GUILayout.Button("运行只读诊断", GUILayout.Height(28f))) StartCoroutine(RunAgentDiagnosis());
                if (!string.IsNullOrWhiteSpace(agentMessage)) GUILayout.Label(agentMessage, CaptionStyle());
                if (!string.IsNullOrWhiteSpace(agentResult)) GUILayout.Label(agentResult, CaptionStyle());
            }
            GUILayout.FlexibleSpace();
            DrawFeatureMatrixButton();
        }

        private void DrawFeatureMatrixButton()
        {
            if (GUILayout.Button(showFeatureMatrix ? "隐藏 Web 功能迁移矩阵" : "查看 Web 功能迁移矩阵")) showFeatureMatrix = !showFeatureMatrix;
            if (!showFeatureMatrix) return;
            GUILayout.BeginVertical(GUI.skin.box);
            foreach (var entry in WebFeatureParityCatalog.All)
            {
                var status = entry.Id == WebFeatureId.AuthenticationAndProjects || entry.Id == WebFeatureId.AgentDiagnostics
                    ? "已接入基础链路"
                    : "迁移中";
                GUILayout.Label($"{entry.DisplayName}  ·  {status}");
            }
            GUILayout.EndVertical();
        }

        private IEnumerator Authenticate(string route)
        {
            if (busy) yield break;
            if (string.IsNullOrWhiteSpace(username) || string.IsNullOrWhiteSpace(password))
            {
                message = "账号和密码不能为空。";
                yield break;
            }

            busy = true;
            message = "正在连接 ForgeMind 后端…";
            var body = JsonUtility.ToJson(new AuthRequestData { username = username.Trim(), password = password });
            string response = null;
            string error = null;
            yield return apiClient.PostJson($"/api/auth/{route}", body, value => response = value, value => error = value);
            busy = false;
            if (!string.IsNullOrWhiteSpace(error))
            {
                message = error;
                yield break;
            }

            if (!ForgeMindJson.TryDeserialize(response, out AuthResponseData auth, out var parseError) || string.IsNullOrWhiteSpace(auth.token))
            {
                message = string.IsNullOrWhiteSpace(parseError) ? "后端没有返回有效会话。" : parseError;
                yield break;
            }

            apiClient.SetAuthToken(auth.token);
            PlayerPrefs.SetString(TokenKey, auth.token);
            PlayerPrefs.Save();
            currentUser = auth.username;
            message = "登录成功。";
            yield return LoadProjects();
        }

        private IEnumerator LoadProjects()
        {
            if (busy) yield break;
            busy = true;
            string response = null;
            string error = null;
            yield return apiClient.GetJson("/api/factories", value => response = value, value => error = value);
            busy = false;
            if (!string.IsNullOrWhiteSpace(error))
            {
                message = error;
                yield break;
            }

            var wrapped = $"{{\"items\":{response}}}";
            if (!ForgeMindJson.TryDeserialize(wrapped, out FactoryProjectListData result, out var parseError))
            {
                message = parseError;
                yield break;
            }

            projects = result.items ?? Array.Empty<FactoryProjectSummaryData>();
            message = $"已读取 {projects.Length} 个项目。";
        }

        private IEnumerator OpenProject(string projectId)
        {
            if (busy || string.IsNullOrWhiteSpace(projectId)) yield break;
            busy = true;
            message = "正在读取工厂存档…";
            string response = null;
            string error = null;
            yield return apiClient.GetJson($"/api/factories/{projectId}", value => response = value, value => error = value);
            busy = false;
            if (!string.IsNullOrWhiteSpace(error))
            {
                message = error;
                yield break;
            }

            if (!ForgeMindJson.TryDeserialize(response, out FactoryProjectResponseData project, out var parseError) || project.save == null || project.project == null)
            {
                message = string.IsNullOrWhiteSpace(parseError) ? "项目响应缺少存档。" : parseError;
                yield break;
            }

            if (readOnlyRuntime == null || !readOnlyRuntime.LoadSaveJson(JsonUtility.ToJson(project.save)))
            {
                message = readOnlyRuntime == null ? "只读运行时未配置。" : readOnlyRuntime.LastError;
                yield break;
            }

            currentProjectId = project.project.id;
            scenePresenter?.SetActiveFloor(1);
            message = $"已打开项目：{project.project.name}。";
        }

        private IEnumerator RunAgentDiagnosis()
        {
            if (busy || string.IsNullOrWhiteSpace(currentProjectId) || readOnlyRuntime?.CurrentSave == null) yield break;
            busy = true;
            agentMessage = "正在创建只读诊断运行…";
            agentResult = string.Empty;
            var createBody = $"{{\"factory_id\":{JsonUtility.ToJson(currentProjectId)},\"objective\":{JsonUtility.ToJson(agentObjective)},\"mode\":\"read_only\",\"context_snapshot\":{JsonUtility.ToJson(readOnlyRuntime.CurrentSave)}}}";
            string createResponse = null;
            string error = null;
            yield return apiClient.PostJson("/api/agent/runs", createBody, value => createResponse = value, value => error = value);
            if (!string.IsNullOrWhiteSpace(error))
            {
                busy = false;
                agentMessage = error;
                yield break;
            }
            if (!ForgeMindJson.TryDeserialize(createResponse, out AgentRunReferenceData run, out var parseError) || string.IsNullOrWhiteSpace(run.id))
            {
                busy = false;
                agentMessage = string.IsNullOrWhiteSpace(parseError) ? "诊断运行创建失败。" : parseError;
                yield break;
            }

            agentMessage = "正在执行确定性工具分析…";
            string analysisResponse = null;
            error = null;
            yield return apiClient.PostJson($"/api/agent/runs/{run.id}/analyze", "{}", value => analysisResponse = value, value => error = value);
            busy = false;
            if (!string.IsNullOrWhiteSpace(error))
            {
                agentMessage = error;
                yield break;
            }
            if (!ForgeMindJson.TryDeserialize(analysisResponse, out AgentRunReferenceData analyzed, out parseError))
            {
                agentMessage = parseError;
                yield break;
            }

            agentMessage = $"诊断完成：{analyzed.status}";
            agentResult = analyzed.result == null
                ? analyzed.summary
                : $"{analyzed.result.headline}\n{analyzed.result.assessment}";
        }

        private void Logout()
        {
            apiClient.ClearAuthToken();
            PlayerPrefs.DeleteKey(TokenKey);
            PlayerPrefs.Save();
            projects = Array.Empty<FactoryProjectSummaryData>();
            currentUser = string.Empty;
            message = "已退出登录。";
        }

        private void DrawMessage()
        {
            GUILayout.Space(5f);
            GUILayout.Label(busy ? "处理中…" : message, CaptionStyle());
        }

        private GUIStyle HeaderStyle()
        {
            return new GUIStyle(GUI.skin.label) { fontSize = 16, fontStyle = FontStyle.Bold, normal = { textColor = Color.white } };
        }

        private GUIStyle CaptionStyle()
        {
            return new GUIStyle(GUI.skin.label) { fontSize = 11, wordWrap = true, normal = { textColor = new Color(0.72f, 0.78f, 0.82f) } };
        }
    }
}
