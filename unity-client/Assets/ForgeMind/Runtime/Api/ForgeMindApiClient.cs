using System;
using System.Collections;
using System.Text;
using UnityEngine;
using UnityEngine.Networking;

namespace ForgeMind.Client.Api
{
    /// <summary>
    /// Thin transport boundary for the native client. It never accesses MySQL
    /// and deliberately exposes raw JSON so contract migration stays explicit.
    /// </summary>
    public sealed class ForgeMindApiClient : MonoBehaviour
    {
        [SerializeField] private string baseUrl = "http://127.0.0.1:8080";
        [SerializeField] private int timeoutSeconds = 30;
        private string authToken;

        public string BaseUrl => baseUrl.TrimEnd('/');
        public bool IsAuthenticated => !string.IsNullOrWhiteSpace(authToken);

        public void ConfigureBaseUrl(string value)
        {
            if (!string.IsNullOrWhiteSpace(value)) baseUrl = value.TrimEnd('/');
        }

        public void SetAuthToken(string token)
        {
            authToken = token ?? string.Empty;
        }

        public void ClearAuthToken()
        {
            authToken = string.Empty;
        }

        public IEnumerator GetJson(string relativePath, Action<string> onSuccess, Action<string> onFailure)
        {
            yield return Send(UnityWebRequest.Get(BuildUrl(relativePath)), onSuccess, onFailure);
        }

        public IEnumerator PostJson(string relativePath, string json, Action<string> onSuccess, Action<string> onFailure)
        {
            using (var request = new UnityWebRequest(BuildUrl(relativePath), UnityWebRequest.kHttpVerbPOST))
            {
                var body = Encoding.UTF8.GetBytes(json ?? string.Empty);
                request.uploadHandler = new UploadHandlerRaw(body);
                request.downloadHandler = new DownloadHandlerBuffer();
                request.SetRequestHeader("Content-Type", "application/json");
                yield return Send(request, onSuccess, onFailure);
            }
        }

        public IEnumerator PutJson(string relativePath, string json, Action<string> onSuccess, Action<string> onFailure)
        {
            using (var request = new UnityWebRequest(BuildUrl(relativePath), UnityWebRequest.kHttpVerbPUT))
            {
                request.uploadHandler = new UploadHandlerRaw(Encoding.UTF8.GetBytes(json ?? string.Empty));
                request.downloadHandler = new DownloadHandlerBuffer();
                request.SetRequestHeader("Content-Type", "application/json");
                yield return Send(request, onSuccess, onFailure);
            }
        }

        public IEnumerator Delete(string relativePath, Action<string> onSuccess, Action<string> onFailure)
        {
            using (var request = UnityWebRequest.Delete(BuildUrl(relativePath)))
            {
                request.downloadHandler = new DownloadHandlerBuffer();
                yield return Send(request, onSuccess, onFailure);
            }
        }

        private IEnumerator Send(UnityWebRequest request, Action<string> onSuccess, Action<string> onFailure)
        {
            request.timeout = Mathf.Max(1, timeoutSeconds);
            if (!string.IsNullOrWhiteSpace(authToken))
            {
                request.SetRequestHeader("Authorization", $"Bearer {authToken}");
            }
            yield return request.SendWebRequest();
            if (request.result == UnityWebRequest.Result.Success)
            {
                onSuccess?.Invoke(request.downloadHandler.text);
                yield break;
            }

            var status = request.responseCode > 0 ? $" HTTP {request.responseCode}" : string.Empty;
            var body = request.downloadHandler == null ? string.Empty : request.downloadHandler.text;
            onFailure?.Invoke($"ForgeMind request failed{status}: {request.error}{(string.IsNullOrWhiteSpace(body) ? string.Empty : $"\n{body}")}");
        }

        private string BuildUrl(string relativePath)
        {
            return $"{BaseUrl}/{relativePath.TrimStart('/')}";
        }
    }
}
