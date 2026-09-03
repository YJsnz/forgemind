#define WIN32_LEAN_AND_MEAN
#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <shellapi.h>
#include <shlwapi.h>
#include <wrl.h>
#include <WebView2.h>
#include <atomic>
#include <algorithm>
#include <chrono>
#include <condition_variable>
#include <cwctype>
#include <deque>
#include <filesystem>
#include <fstream>
#include <mutex>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

#pragma comment(lib, "Shlwapi.lib")
#pragma comment(lib, "Ws2_32.lib")

using Microsoft::WRL::Callback;
using Microsoft::WRL::ComPtr;

namespace {
constexpr wchar_t kWindowClass[] = L"ForgeMindDesktopHost";
constexpr UINT kPipeMessage = WM_APP + 11;
constexpr UINT kPipeClosed = WM_APP + 12;
constexpr UINT_PTR kEagerUnityTimer = 7;
constexpr size_t kMaxBridgeMessage = 4 * 1024 * 1024;

std::wstring ModuleDirectory() {
    wchar_t buffer[MAX_PATH]{};
    const DWORD length = GetModuleFileNameW(nullptr, buffer, MAX_PATH);
    return length == 0 ? L"." : std::filesystem::path(buffer, buffer + length).parent_path().wstring();
}

void HostLog(const std::wstring& message) {
    static std::mutex logMutex;
    std::lock_guard<std::mutex> lock(logMutex);
    std::wofstream log(std::filesystem::path(ModuleDirectory()) / L"ForgeMindHost.log", std::ios::app);
    log << message << std::endl;
}

std::wstring ResolveDefaultPath(const std::wstring& root, const std::wstring& installedRelative, const std::wstring& developmentRelative) {
    const auto installed = std::filesystem::path(root) / installedRelative;
    if (std::filesystem::exists(installed)) return installed.wstring();
    const auto development = std::filesystem::path(root) / developmentRelative;
    return development.wstring();
}

bool IsLocalPortOpen(unsigned short port) {
    WSADATA data{};
    if (WSAStartup(MAKEWORD(2, 2), &data) != 0) return false;
    SOCKET socketHandle = ::socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (socketHandle == INVALID_SOCKET) {
        WSACleanup();
        return false;
    }
    u_long nonBlocking = 1;
    ioctlsocket(socketHandle, FIONBIO, &nonBlocking);
    sockaddr_in address{};
    address.sin_family = AF_INET;
    address.sin_port = htons(port);
    inet_pton(AF_INET, "127.0.0.1", &address.sin_addr);
    bool open = connect(socketHandle, reinterpret_cast<const sockaddr*>(&address), sizeof(address)) == 0;
    if (!open && WSAGetLastError() == WSAEWOULDBLOCK) {
        fd_set writable;
        FD_ZERO(&writable);
        FD_SET(socketHandle, &writable);
        timeval timeout{0, 250000};
        if (select(0, nullptr, &writable, nullptr, &timeout) > 0) {
            int error = 0;
            int errorLength = sizeof(error);
            getsockopt(socketHandle, SOL_SOCKET, SO_ERROR, reinterpret_cast<char*>(&error), &errorLength);
            open = error == 0;
        }
    }
    closesocket(socketHandle);
    WSACleanup();
    return open;
}

std::wstring GetOption(const std::vector<std::wstring>& args, const wchar_t* name, const std::wstring& fallback) {
    for (size_t index = 0; index + 1 < args.size(); ++index) {
        if (_wcsicmp(args[index].c_str(), name) == 0) return args[index + 1];
    }
    return fallback;
}

std::vector<std::wstring> CommandLineArgs() {
    int count = 0;
    LPWSTR* raw = CommandLineToArgvW(GetCommandLineW(), &count);
    std::vector<std::wstring> result;
    if (raw) {
        for (int index = 0; index < count; ++index) result.emplace_back(raw[index]);
        LocalFree(raw);
    }
    return result;
}

std::wstring JsonStringValue(const std::wstring& json, const wchar_t* key) {
    const std::wstring needle = std::wstring(L"\"") + key + L"\"";
    const size_t begin = json.find(needle);
    if (begin == std::wstring::npos) return {};
    size_t valueBegin = begin + needle.size();
    while (valueBegin < json.size() && iswspace(json[valueBegin])) ++valueBegin;
    if (valueBegin >= json.size() || json[valueBegin] != L':') return {};
    ++valueBegin;
    while (valueBegin < json.size() && iswspace(json[valueBegin])) ++valueBegin;
    if (valueBegin >= json.size() || json[valueBegin] != L'\"') return {};
    ++valueBegin;
    const size_t valueEnd = json.find(L'\"', valueBegin);
    return valueEnd == std::wstring::npos ? std::wstring{} : json.substr(valueBegin, valueEnd - valueBegin);
}

double JsonNumberValue(const std::wstring& json, const wchar_t* key, double fallback) {
    const std::wstring needle = std::wstring(L"\"") + key + L"\":";
    const size_t begin = json.find(needle);
    if (begin == std::wstring::npos) return fallback;
    const wchar_t* start = json.c_str() + begin + needle.size();
    wchar_t* end = nullptr;
    const double value = wcstod(start, &end);
    return end == start ? fallback : value;
}

bool JsonBoolValue(const std::wstring& json, const wchar_t* key, bool fallback) {
    const std::wstring needle = std::wstring(L"\"") + key + L"\":";
    const size_t begin = json.find(needle);
    if (begin == std::wstring::npos) return fallback;
    const size_t valueBegin = begin + needle.size();
    if (json.compare(valueBegin, 4, L"true") == 0) return true;
    if (json.compare(valueBegin, 5, L"false") == 0) return false;
    return fallback;
}

bool TryParseDouble(const std::wstring& text, double* value) {
    if (!value) return false;
    wchar_t* end = nullptr;
    const double parsed = wcstod(text.c_str(), &end);
    if (end == text.c_str() || (end && *end != L'\0')) return false;
    *value = parsed;
    return true;
}

std::vector<std::wstring> Split(const std::wstring& value, wchar_t delimiter) {
    std::vector<std::wstring> result;
    std::wistringstream stream(value);
    std::wstring token;
    while (std::getline(stream, token, delimiter)) result.push_back(token);
    return result;
}

class ForgeMindHost {
public:
    ForgeMindHost(std::wstring webRoot, std::wstring unityExe, std::wstring backendJar, std::wstring javaExe, bool eagerUnity)
        : webRoot_(std::move(webRoot)), unityExe_(std::move(unityExe)), backendJar_(std::move(backendJar)),
          javaExe_(std::move(javaExe)), eagerUnity_(eagerUnity) {}

    int Run() {
        CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
        WNDCLASSEXW klass{sizeof(WNDCLASSEXW)};
        klass.lpfnWndProc = &ForgeMindHost::WindowProc;
        klass.hInstance = GetModuleHandleW(nullptr);
        klass.hCursor = LoadCursor(nullptr, IDC_ARROW);
        klass.hbrBackground = reinterpret_cast<HBRUSH>(COLOR_WINDOW + 1);
        klass.lpszClassName = kWindowClass;
        RegisterClassExW(&klass);

        hwnd_ = CreateWindowExW(0, kWindowClass, L"ForgeMind", WS_OVERLAPPEDWINDOW,
            CW_USEDEFAULT, CW_USEDEFAULT, 1600, 900, nullptr, nullptr, klass.hInstance, this);
        if (!hwnd_) return 2;
        ShowWindow(hwnd_, SW_SHOW);
        UpdateWindow(hwnd_);
        StartBackend();
        CreateWebView();

        MSG message{};
        while (GetMessageW(&message, nullptr, 0, 0) > 0) {
            TranslateMessage(&message);
            DispatchMessageW(&message);
        }
        StopUnity();
        StopBackend();
        webView_.Reset();
        controller_.Reset();
        environment_.Reset();
        CoUninitialize();
        return static_cast<int>(message.wParam);
    }

private:
    static LRESULT CALLBACK WindowProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam) {
        auto* self = reinterpret_cast<ForgeMindHost*>(GetWindowLongPtrW(hwnd, GWLP_USERDATA));
        if (message == WM_NCCREATE) {
            auto* create = reinterpret_cast<CREATESTRUCTW*>(lParam);
            self = reinterpret_cast<ForgeMindHost*>(create->lpCreateParams);
            SetWindowLongPtrW(hwnd, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(self));
            self->hwnd_ = hwnd;
        }
        if (self) return self->HandleMessage(message, wParam, lParam);
        return DefWindowProcW(hwnd, message, wParam, lParam);
    }

    LRESULT HandleMessage(UINT message, WPARAM wParam, LPARAM lParam) {
        switch (message) {
        case WM_MOVE:
            PositionUnity();
            return 0;
        case WM_SIZE:
            if (controller_) {
                RECT bounds{};
                GetClientRect(hwnd_, &bounds);
                controller_->put_Bounds(bounds);
            }
            if (wParam == SIZE_MINIMIZED && unityWindow_) {
                ShowWindow(unityWindow_, SW_HIDE);
                return 0;
            }
            PositionUnity();
            return 0;
        case WM_ACTIVATE:
            if (LOWORD(wParam) != WA_INACTIVE) PositionUnity();
            return 0;
        case WM_TIMER:
            if (wParam == kEagerUnityTimer) {
                KillTimer(hwnd_, kEagerUnityTimer);
                StartUnity();
            }
            return 0;
        case WM_APP + 1:
            StartUnity();
            return 0;
        case kPipeMessage: {
            auto* messageText = reinterpret_cast<std::wstring*>(lParam);
            if (messageText) {
                if (webView_) webView_->PostWebMessageAsJson(messageText->c_str());
                delete messageText;
            }
            return 0;
        }
        case kPipeClosed:
            pipeConnected_ = false;
            PostBridgeError(L"unity_disconnected", L"Unity 三维渲染进程已断开，已保留 WebGL 回退。", L"");
            return 0;
        case WM_DESTROY:
            StopUnity();
            PostQuitMessage(0);
            return 0;
        default:
            return DefWindowProcW(hwnd_, message, wParam, lParam);
        }
    }

    void CreateWebView() {
        const auto localAppData = [] {
            wchar_t buffer[32768]{};
            const DWORD length = GetEnvironmentVariableW(L"LOCALAPPDATA", buffer, ARRAYSIZE(buffer));
            return length == 0 ? std::wstring(L".") : std::wstring(buffer, length);
        }();
        const auto userData = (std::filesystem::path(localAppData) / L"ForgeMind" / L"WebView2").wstring();
        auto options = Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>(
            [this](HRESULT error, ICoreWebView2Environment* environment) -> HRESULT {
                if (FAILED(error) || !environment) return error;
                environment_ = environment;
                return environment_->CreateCoreWebView2Controller(hwnd_,
                    Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
                        [this](HRESULT controllerError, ICoreWebView2Controller* controller) -> HRESULT {
                            if (FAILED(controllerError) || !controller) return controllerError;
                            controller_ = controller;
                            controller_->get_CoreWebView2(&webView_);
                            ComPtr<ICoreWebView2Controller2> controller2;
                            if (SUCCEEDED(controller_.As(&controller2)) && controller2) {
                                const COREWEBVIEW2_COLOR transparent{0, 0, 0, 0};
                                controller2->put_DefaultBackgroundColor(transparent);
                            }
                            controller_->put_IsVisible(TRUE);
                            RECT bounds{};
                            GetClientRect(hwnd_, &bounds);
                            controller_->put_Bounds(bounds);
                            ConfigureWebView();
                            return S_OK;
                        }).Get());
            });
        const HRESULT result = CreateCoreWebView2EnvironmentWithOptions(nullptr, userData.c_str(), nullptr, options.Get());
        if (FAILED(result)) MessageBoxW(hwnd_, L"WebView2 Runtime 初始化失败。", L"ForgeMind", MB_ICONERROR);
    }

    void ConfigureWebView() {
        if (!webView_) return;
        webView_->AddScriptToExecuteOnDocumentCreated(
            L"window.__FORGEMIND_UNITY_HOST__=true;",
            Callback<ICoreWebView2AddScriptToExecuteOnDocumentCreatedCompletedHandler>(
                [](HRESULT, PCWSTR) -> HRESULT { return S_OK; }).Get());
        webView_->add_WebMessageReceived(
            Callback<ICoreWebView2WebMessageReceivedEventHandler>(
                [this](ICoreWebView2*, ICoreWebView2WebMessageReceivedEventArgs* args) -> HRESULT {
                    LPWSTR raw = nullptr;
                    if (!args || FAILED(args->get_WebMessageAsJson(&raw)) || !raw) return S_OK;
                    const std::wstring json(raw);
                    CoTaskMemFree(raw);
                    if (json.size() <= kMaxBridgeMessage) HandleWebMessage(json);
                    return S_OK;
                }).Get(), &webMessageToken_);
        // ES modules loaded from file:// are subject to opaque-origin/CORS
        // restrictions in WebView2. Map the desktop dist to a local HTTPS
        // origin so the exact Vite output works like the browser build.
        ComPtr<ICoreWebView2_3> webView3;
        const HRESULT queryWebView3 = webView_.As(&webView3);
        const HRESULT mapping = SUCCEEDED(queryWebView3) && webView3
            ? webView3->SetVirtualHostNameToFolderMapping(
                L"forgemind.local", webRoot_.c_str(), COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_ALLOW)
            : queryWebView3;
        if (FAILED(mapping)) {
            MessageBoxW(hwnd_, L"ForgeMind Web 资源映射失败。", L"ForgeMind", MB_ICONERROR);
            return;
        }
        webView_->Navigate(L"https://forgemind.local/index.html");
        webView_->ExecuteScript(
            L"(function(){var w=window.chrome&&window.chrome.webview;return JSON.stringify({chrome:typeof window.chrome,webview:typeof w,postMessage:typeof (w&&w.postMessage),desktop:window.__FORGEMIND_UNITY_HOST__===true});})()",
            Callback<ICoreWebView2ExecuteScriptCompletedHandler>(
                [](HRESULT error, LPCWSTR result) -> HRESULT {
                    HostLog(std::wstring(L"webview capability error=") + std::to_wstring(static_cast<long>(error))
                        + L" result=" + (result ? result : L"<null>"));
                    return S_OK;
                }).Get());
        if (eagerUnity_) SetTimer(hwnd_, kEagerUnityTimer, 2500, nullptr);
    }

    void HandleWebMessage(const std::wstring& json) {
        const std::wstring protocol = JsonStringValue(json, L"protocol");
        const std::wstring type = JsonStringValue(json, L"type");
        if (type != L"viewport.rect") HostLog(L"web->host type=" + type + L" protocol=" + protocol);
        if (protocol != L"forgemind.unity.bridge.v1") return;
        if (type == L"bridge.start") {
            if (pipeConnected_) {
                SendPipe(L"{\"protocol\":\"forgemind.unity.bridge.v1\",\"type\":\"bridge.ping\",\"requestId\":\"\",\"payload\":{}}");
            } else {
                PostMessageW(hwnd_, WM_APP + 1, 0, 0);
            }
        } else if (type == L"bridge.shutdown") {
            StopUnity();
        } else if (type == L"viewport.rect") {
            ApplyViewport(json);
        } else if (pipeConnected_) {
            SendPipe(json);
        } else {
            HostLog(L"drop web message before pipe connected: " + type);
        }
    }

    void ApplyViewport(const std::wstring& json) {
        const double scale = GetDpiForWindow(hwnd_) / 96.0;
        const int x = static_cast<int>(JsonNumberValue(json, L"x", 0) * scale);
        const int y = static_cast<int>(JsonNumberValue(json, L"y", 0) * scale);
        const int width = static_cast<int>(JsonNumberValue(json, L"width", 0) * scale);
        const int height = static_cast<int>(JsonNumberValue(json, L"height", 0) * scale);
        viewport_ = {x, y, width, height};
        viewportVisible_ = JsonBoolValue(json, L"visible", false) && width > 0 && height > 0;
        viewportOcclusions_ = JsonStringValue(json, L"occlusions");
        PositionUnity();
    }

    void PositionUnity() {
        if (!unityWindow_) return;
        if (!viewportVisible_ || IsIconic(hwnd_)) {
            ShowWindow(unityWindow_, SW_HIDE);
            return;
        }
        POINT viewportOrigin{viewport_.left, viewport_.top};
        ClientToScreen(hwnd_, &viewportOrigin);
        SetWindowPos(unityWindow_, HWND_TOP, viewportOrigin.x, viewportOrigin.y, viewport_.right, viewport_.bottom,
            SWP_NOACTIVATE | SWP_SHOWWINDOW);
        ApplyOcclusionRegion();
    }

    void ApplyOcclusionRegion() {
        if (!unityWindow_ || viewport_.right <= 0 || viewport_.bottom <= 0) return;
        HRGN region = CreateRectRgn(0, 0, viewport_.right, viewport_.bottom);
        for (const auto& item : Split(viewportOcclusions_, L';')) {
            const auto fields = Split(item, L',');
            if (fields.size() != 4) continue;
            double values[4]{};
            if (!TryParseDouble(fields[0], &values[0]) || !TryParseDouble(fields[1], &values[1])
                || !TryParseDouble(fields[2], &values[2]) || !TryParseDouble(fields[3], &values[3])) continue;
            const double scale = GetDpiForWindow(hwnd_) / 96.0;
            const int left = static_cast<int>(values[0] * scale) - viewport_.left;
            const int top = static_cast<int>(values[1] * scale) - viewport_.top;
            const int right = left + static_cast<int>(values[2] * scale);
            const int bottom = top + static_cast<int>(values[3] * scale);
            HRGN subtract = CreateRectRgn(left, top, right, bottom);
            CombineRgn(region, region, subtract, RGN_DIFF);
            DeleteObject(subtract);
        }
        SetWindowRgn(unityWindow_, region, TRUE);
    }

    void StartUnity() {
        if (unityProcess_) return;
        stopRequested_ = false;
        pipeName_ = L"forgemind-unity-" + std::to_wstring(GetCurrentProcessId());
        std::wstring command = L"\"" + unityExe_
            + L"\" -popupwindow -screen-fullscreen 0 -forgemindPipe " + pipeName_;
        std::vector<wchar_t> commandBuffer(command.begin(), command.end());
        commandBuffer.push_back(L'\0');
        STARTUPINFOW startup{sizeof(startup)};
        PROCESS_INFORMATION process{};
        if (!CreateProcessW(nullptr, commandBuffer.data(), nullptr, nullptr, FALSE, CREATE_NO_WINDOW, nullptr,
            ModuleDirectory().c_str(), &startup, &process)) {
            PostBridgeError(L"unity_start_failed", L"Unity Player 启动失败。", L"");
            return;
        }
        unityProcess_ = process.hProcess;
        CloseHandle(process.hThread);
        pipeThread_ = std::thread([this] { ConnectPipe(); });
        windowThread_ = std::thread([this, processId = process.dwProcessId] {
            for (int attempt = 0; attempt < 100 && !unityWindow_ && !stopRequested_; ++attempt) {
                std::this_thread::sleep_for(std::chrono::milliseconds(100));
                std::pair<DWORD, HWND*> state(processId, &unityWindow_);
                EnumWindows([](HWND candidate, LPARAM data) -> BOOL {
                    DWORD candidateProcess = 0;
                    GetWindowThreadProcessId(candidate, &candidateProcess);
                    auto* state = reinterpret_cast<std::pair<DWORD, HWND*>*>(data);
                    if (candidateProcess == state->first && IsWindowVisible(candidate)) {
                        *state->second = candidate;
                        return FALSE;
                    }
                    return TRUE;
                }, reinterpret_cast<LPARAM>(&state));
                if (unityWindow_) {
                    SetWindowLongPtrW(unityWindow_, GWL_STYLE, WS_POPUP | WS_VISIBLE | WS_CLIPSIBLINGS | WS_CLIPCHILDREN);
                    const auto extendedStyle = GetWindowLongPtrW(unityWindow_, GWL_EXSTYLE);
                    SetWindowLongPtrW(unityWindow_, GWL_EXSTYLE, (extendedStyle | WS_EX_TOOLWINDOW) & ~WS_EX_APPWINDOW);
                    SetWindowLongPtrW(unityWindow_, GWLP_HWNDPARENT, reinterpret_cast<LONG_PTR>(hwnd_));
                    HostLog(L"unity overlay attached hwnd=" + std::to_wstring(reinterpret_cast<uintptr_t>(unityWindow_))
                        + L" owner=" + std::to_wstring(reinterpret_cast<uintptr_t>(GetWindow(unityWindow_, GW_OWNER))));
                    PositionUnity();
                    break;
                }
            }
        });
    }

    void StartBackend() {
        if (backendProcess_ || backendJar_.empty() || javaExe_.empty()
            || !std::filesystem::exists(backendJar_)) return;
        if (IsLocalPortOpen(8080)) return;
        std::wstring command = L"\"" + javaExe_ + L"\" -Dserver.address=127.0.0.1 -jar \"" + backendJar_ + L"\"";
        std::vector<wchar_t> commandBuffer(command.begin(), command.end());
        commandBuffer.push_back(L'\0');
        STARTUPINFOW startup{sizeof(startup)};
        PROCESS_INFORMATION process{};
        const auto workingDirectory = std::filesystem::path(backendJar_).parent_path().wstring();
        if (!CreateProcessW(nullptr, commandBuffer.data(), nullptr, nullptr, FALSE, CREATE_NO_WINDOW,
            nullptr, workingDirectory.c_str(), &startup, &process)) {
            return;
        }
        backendProcess_ = process.hProcess;
        CloseHandle(process.hThread);
    }

    void ConnectPipe() {
        const std::wstring commandPath = L"\\\\.\\pipe\\" + pipeName_ + L"-in";
        const std::wstring eventPath = L"\\\\.\\pipe\\" + pipeName_ + L"-out";
        HANDLE commandPipe = INVALID_HANDLE_VALUE;
        HANDLE eventPipe = INVALID_HANDLE_VALUE;
        for (int attempt = 0; attempt < 120 && unityProcess_ && !stopRequested_; ++attempt) {
            commandPipe = CreateFileW(commandPath.c_str(), GENERIC_WRITE, 0, nullptr, OPEN_EXISTING, 0, nullptr);
            if (commandPipe != INVALID_HANDLE_VALUE) break;
            std::this_thread::sleep_for(std::chrono::milliseconds(100));
        }
        if (commandPipe == INVALID_HANDLE_VALUE) return;
        for (int attempt = 0; attempt < 120 && unityProcess_ && !stopRequested_; ++attempt) {
            eventPipe = CreateFileW(eventPath.c_str(), GENERIC_READ, 0, nullptr, OPEN_EXISTING, 0, nullptr);
            if (eventPipe != INVALID_HANDLE_VALUE) break;
            std::this_thread::sleep_for(std::chrono::milliseconds(100));
        }
        if (eventPipe == INVALID_HANDLE_VALUE) {
            CloseHandle(commandPipe);
            return;
        }
        {
            std::lock_guard<std::mutex> lock(pipeMutex_);
            pipe_ = commandPipe;
            pipeRead_ = eventPipe;
            pipeConnected_ = true;
        }
        HostLog(L"unity pipe connected: " + pipeName_);
        pipeWriteThread_ = std::thread([this] { WritePipeLoop(); });
        std::string buffer;
        char chunk[8192];
        DWORD read = 0;
        while (pipeConnected_ && !stopRequested_ && ReadFile(eventPipe, chunk, sizeof(chunk), &read, nullptr) && read > 0) {
            buffer.append(chunk, chunk + read);
            if (buffer.size() > kMaxBridgeMessage * 2) { buffer.clear(); continue; }
            size_t lineEnd = 0;
            while ((lineEnd = buffer.find('\n')) != std::string::npos) {
                std::string line = buffer.substr(0, lineEnd);
                buffer.erase(0, lineEnd + 1);
                if (line.empty()) continue;
                int length = MultiByteToWideChar(CP_UTF8, 0, line.data(), static_cast<int>(line.size()), nullptr, 0);
                std::wstring wide(length, L'\0');
                MultiByteToWideChar(CP_UTF8, 0, line.data(), static_cast<int>(line.size()), wide.data(), length);
                const auto type = JsonStringValue(wide, L"type");
                if (type == L"render.stats") {
                    HostLog(L"unity render fps=" + std::to_wstring(JsonNumberValue(wide, L"fps", 0))
                        + L" cpuMs=" + std::to_wstring(JsonNumberValue(wide, L"cpuFrameMs", 0))
                        + L" gpuMs=" + std::to_wstring(JsonNumberValue(wide, L"gpuFrameMs", 0)));
                } else {
                    HostLog(L"unity->host type=" + type + L" bytes=" + std::to_wstring(wide.size()));
                }
                PostMessageW(hwnd_, kPipeMessage, 0, reinterpret_cast<LPARAM>(new std::wstring(std::move(wide))));
            }
        }
        {
            std::lock_guard<std::mutex> lock(pipeMutex_);
            pipe_ = INVALID_HANDLE_VALUE;
            pipeRead_ = INVALID_HANDLE_VALUE;
            pipeConnected_ = false;
        }
        pipeWriteCondition_.notify_all();
        if (pipeWriteThread_.joinable()) pipeWriteThread_.join();
        CloseHandle(commandPipe);
        CloseHandle(eventPipe);
        PostMessageW(hwnd_, kPipeClosed, 0, 0);
    }

    void SendPipe(const std::wstring& json) {
        const int length = WideCharToMultiByte(CP_UTF8, 0, json.data(), static_cast<int>(json.size()), nullptr, 0, nullptr, nullptr);
        std::string utf8(length, '\0');
        WideCharToMultiByte(CP_UTF8, 0, json.data(), static_cast<int>(json.size()), utf8.data(), length, nullptr, nullptr);
        utf8.push_back('\n');
        {
            std::lock_guard<std::mutex> lock(pipeMutex_);
            if (!pipeConnected_ || pipe_ == INVALID_HANDLE_VALUE) {
                HostLog(L"drop pipe message connected=" + std::to_wstring(pipeConnected_.load())
                    + L" handle=" + std::to_wstring(reinterpret_cast<uintptr_t>(pipe_)));
                return;
            }
            // Scene.replace can be several megabytes. Never synchronously
            // block the WebView2 UI thread while Unity imports that scene.
            if (outgoingPipe_.size() >= 64) outgoingPipe_.pop_front();
            outgoingPipe_.push_back(std::move(utf8));
        }
        pipeWriteCondition_.notify_one();
    }

    void WritePipeLoop() {
        HostLog(L"pipe writer started");
        while (!stopRequested_) {
            std::string message;
            HANDLE currentPipe = INVALID_HANDLE_VALUE;
            {
                std::unique_lock<std::mutex> lock(pipeMutex_);
                pipeWriteCondition_.wait(lock, [this] {
                    return stopRequested_ || !pipeConnected_ || !outgoingPipe_.empty();
                });
                if (stopRequested_ || !pipeConnected_ || outgoingPipe_.empty()) break;
                message = std::move(outgoingPipe_.front());
                outgoingPipe_.pop_front();
                currentPipe = pipe_;
            }
            if (currentPipe == INVALID_HANDLE_VALUE) break;
            DWORD written = 0;
            if (!WriteFile(currentPipe, message.data(), static_cast<DWORD>(message.size()), &written, nullptr)) {
                HostLog(L"pipe write failed error=" + std::to_wstring(GetLastError()));
                std::lock_guard<std::mutex> lock(pipeMutex_);
                pipeConnected_ = false;
                pipeWriteCondition_.notify_all();
                break;
            }
        }
    }

    void PostBridgeError(const std::wstring& code, const std::wstring& message, const std::wstring& requestId) {
        std::wstring json = L"{\"protocol\":\"forgemind.unity.bridge.v1\",\"type\":\"bridge.error\",\"requestId\":\""
            + requestId + L"\",\"payload\":{\"code\":\"" + code + L"\",\"message\":\"" + message + L"\"}}";
        if (webView_) webView_->PostWebMessageAsJson(json.c_str());
    }

    void StopUnity() {
        stopRequested_ = true;
        pipeConnected_ = false;
        pipeWriteCondition_.notify_all();
        {
            std::lock_guard<std::mutex> lock(pipeMutex_);
            if (pipe_ != INVALID_HANDLE_VALUE) { CancelIoEx(pipe_, nullptr); CloseHandle(pipe_); pipe_ = INVALID_HANDLE_VALUE; }
            if (pipeRead_ != INVALID_HANDLE_VALUE) { CancelIoEx(pipeRead_, nullptr); CloseHandle(pipeRead_); pipeRead_ = INVALID_HANDLE_VALUE; }
        }
        if (pipeThread_.joinable()) pipeThread_.join();
        if (pipeWriteThread_.joinable()) pipeWriteThread_.join();
        if (windowThread_.joinable()) windowThread_.join();
        if (unityWindow_) { DestroyWindow(unityWindow_); unityWindow_ = nullptr; }
        if (unityProcess_) { TerminateProcess(unityProcess_, 0); CloseHandle(unityProcess_); unityProcess_ = nullptr; }
    }

    void StopBackend() {
        if (!backendProcess_) return;
        TerminateProcess(backendProcess_, 0);
        CloseHandle(backendProcess_);
        backendProcess_ = nullptr;
    }

    std::wstring webRoot_;
    std::wstring unityExe_;
    std::wstring backendJar_;
    std::wstring javaExe_;
    std::wstring pipeName_;
    HWND hwnd_ = nullptr;
    HWND unityWindow_ = nullptr;
    HANDLE unityProcess_ = nullptr;
    HANDLE backendProcess_ = nullptr;
    HANDLE pipe_ = INVALID_HANDLE_VALUE;
    HANDLE pipeRead_ = INVALID_HANDLE_VALUE;
    std::thread pipeThread_;
    std::thread pipeWriteThread_;
    std::thread windowThread_;
    std::mutex pipeMutex_;
    std::condition_variable pipeWriteCondition_;
    std::deque<std::string> outgoingPipe_;
    std::atomic_bool pipeConnected_{false};
    std::atomic_bool stopRequested_{false};
    RECT viewport_{0, 0, 0, 0};
    bool viewportVisible_ = false;
    std::wstring viewportOcclusions_;
    bool eagerUnity_ = false;
    ComPtr<ICoreWebView2Environment> environment_;
    ComPtr<ICoreWebView2Controller> controller_;
    ComPtr<ICoreWebView2> webView_;
    EventRegistrationToken webMessageToken_{};
};
}

int WINAPI wWinMain(HINSTANCE, HINSTANCE, PWSTR, int) {
    // WebView2 reports viewport geometry in CSS pixels while the Unity overlay
    // is a separate per-monitor-aware process. Opt the host into the same DPI
    // model before creating either window so viewport scaling is applied once.
    SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    const auto root = ModuleDirectory();
    const auto args = CommandLineArgs();
    const auto webRoot = GetOption(args, L"-forgemindWebRoot", (std::filesystem::path(root) / L"web" / L"dist").wstring());
    const auto unityExe = GetOption(args, L"-forgemindUnity", (std::filesystem::path(root) / L"unity" / L"ForgeMind-Client.exe").wstring());
    const auto backendJar = GetOption(args, L"-forgemindBackend",
        ResolveDefaultPath(root, L"backend/forgemind-backend-0.1.0.jar", L"../../backend/target/forgemind-backend-0.1.0.jar"));
    const auto installedJava = std::filesystem::path(root) / L"runtime" / L"bin" / L"javaw.exe";
    const auto javaDefault = std::filesystem::exists(installedJava) ? installedJava.wstring() : L"javaw.exe";
    const auto javaExe = GetOption(args, L"-forgemindJava", javaDefault);
    const bool eagerUnity = std::find(args.begin(), args.end(), L"-forgemindEagerUnity") != args.end();
    return ForgeMindHost(webRoot, unityExe, backendJar, javaExe, eagerUnity).Run();
}
