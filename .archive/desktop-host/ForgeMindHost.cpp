#define UNICODE
#define _UNICODE
#include <windows.h>
#include <windowsx.h>
#include <shlwapi.h>
#include <d3d11.h>
#include <dcomp.h>
#include <dxgi.h>
#include <wrl.h>
#include <WebView2.h>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <deque>
#include <filesystem>
#include <fstream>
#include <memory>
#include <mutex>
#include <sstream>
#include <string>
#include <thread>

using Microsoft::WRL::Callback;
using Microsoft::WRL::ComPtr;
namespace fs = std::filesystem;

static constexpr UINT WM_BRIDGE_MESSAGE = WM_APP + 41;
static constexpr UINT_PTR UNITY_POLL_TIMER = 0xF04E;
using CreateEnvironmentWithOptions = HRESULT(STDAPICALLTYPE *)(
    PCWSTR, PCWSTR, ICoreWebView2EnvironmentOptions *,
    ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler *);

struct HostState {
  HWND window = nullptr;
  HMODULE loader = nullptr;
  ComPtr<ICoreWebView2Controller> controller;
  ComPtr<ICoreWebView2CompositionController> compositionController;
  ComPtr<ICoreWebView2> webview;
  ComPtr<ID3D11Device> d3dDevice;
  ComPtr<IDXGIDevice> dxgiDevice;
  ComPtr<IDCompositionDevice> dcompDevice;
  ComPtr<IDCompositionTarget> dcompTarget;
  ComPtr<IDCompositionVisual> dcompRootVisual;
  ComPtr<IDCompositionVisual> dcompWebViewVisual;
  HANDLE unityProcess = nullptr;
  HANDLE unityJob = nullptr;
  DWORD unityProcessId = 0;
  HWND unityWindow = nullptr;
  HANDLE pipe = INVALID_HANDLE_VALUE;
  std::wstring pipeName;
  std::atomic<bool> stopping = false;
  std::thread pipeThread;
  std::thread pipeWriterThread;
  std::mutex outboundMutex;
  std::condition_variable outboundReady;
  std::deque<std::string> outboundMessages;
  fs::path root;
  EventRegistrationToken webMessageToken{};
  RECT webViewBounds{};
  bool trackingMouse = false;
  bool capturingMouse = false;
  bool unityStarted = false;
  bool unityViewportActive = false;
  std::wstring pendingViewportMessage;
  HANDLE backendProcess = nullptr;
  HANDLE backendJob = nullptr;
};

static HostState g_host;

static void StartUnity();

static void StartBackend() {
  const auto backendJar = g_host.root / L"backend" / L"forgemind-backend-0.1.0.jar";
  if (!fs::exists(backendJar)) return;

  auto java = g_host.root / L"runtime" / L"bin" / L"javaw.exe";
  std::wstring executable = fs::exists(java) ? java.wstring() : L"javaw.exe";
  std::wstring command = L"\"" + executable +
      L"\" -Dfile.encoding=UTF-8 -Djava.awt.headless=true -jar \"" +
      backendJar.wstring() + L"\"";
  STARTUPINFOW startup{sizeof(startup)};
  PROCESS_INFORMATION process{};
  if (!CreateProcessW(
          fs::exists(java) ? java.c_str() : nullptr, command.data(), nullptr, nullptr,
          FALSE, CREATE_NO_WINDOW, nullptr, backendJar.parent_path().c_str(),
          &startup, &process)) {
    return;
  }
  CloseHandle(process.hThread);
  g_host.backendProcess = process.hProcess;
  g_host.backendJob = CreateJobObjectW(nullptr, nullptr);
  if (g_host.backendJob) {
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    if (!SetInformationJobObject(g_host.backendJob, JobObjectExtendedLimitInformation,
                                 &limits, sizeof(limits)) ||
        !AssignProcessToJobObject(g_host.backendJob, g_host.backendProcess)) {
      CloseHandle(g_host.backendJob);
      g_host.backendJob = nullptr;
    }
  }
}

static std::wstring Utf8ToWide(const std::string &value) {
  if (value.empty()) return {};
  const int length = MultiByteToWideChar(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), nullptr, 0);
  std::wstring result(length, L'\0');
  MultiByteToWideChar(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), result.data(), length);
  return result;
}

static std::string WideToUtf8(const std::wstring &value) {
  if (value.empty()) return {};
  const int length = WideCharToMultiByte(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), nullptr, 0, nullptr, nullptr);
  std::string result(length, '\0');
  WideCharToMultiByte(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), result.data(), length, nullptr, nullptr);
  return result;
}

static std::wstring ToFileUrl(const fs::path &path) {
  std::wstring value = path.wstring();
  for (auto &character : value) if (character == L'\\') character = L'/';
  return L"file:///" + value;
}

static std::wstring JsonStringField(const std::wstring &json, const std::wstring &key) {
  const auto marker = L"\"" + key + L"\"";
  const auto start = json.find(marker);
  if (start == std::wstring::npos) return {};
  const auto colon = json.find(L':', start + marker.size());
  const auto quote = json.find(L'\"', colon);
  if (colon == std::wstring::npos || quote == std::wstring::npos) return {};
  const auto end = json.find(L'\"', quote + 1);
  return end == std::wstring::npos ? std::wstring{} : json.substr(quote + 1, end - quote - 1);
}

static double JsonNumberField(const std::wstring &json, const std::wstring &key, double fallback) {
  const auto marker = L"\"" + key + L"\"";
  const auto start = json.find(marker);
  if (start == std::wstring::npos) return fallback;
  const auto colon = json.find(L':', start + marker.size());
  if (colon == std::wstring::npos) return fallback;
  wchar_t *end = nullptr;
  const double value = wcstod(json.c_str() + colon + 1, &end);
  return end == json.c_str() + colon + 1 ? fallback : value;
}

static bool BuildCompositionTree() {
  D3D_FEATURE_LEVEL featureLevels[] = {
      D3D_FEATURE_LEVEL_11_1, D3D_FEATURE_LEVEL_11_0,
      D3D_FEATURE_LEVEL_10_1, D3D_FEATURE_LEVEL_10_0};
  D3D_FEATURE_LEVEL selectedLevel{};
  const HRESULT deviceResult = D3D11CreateDevice(
      nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr, D3D11_CREATE_DEVICE_BGRA_SUPPORT,
      featureLevels, ARRAYSIZE(featureLevels), D3D11_SDK_VERSION,
      &g_host.d3dDevice, &selectedLevel, nullptr);
  if (FAILED(deviceResult)) return false;
  if (FAILED(g_host.d3dDevice.As(&g_host.dxgiDevice))) return false;
  if (FAILED(DCompositionCreateDevice(
          g_host.dxgiDevice.Get(), __uuidof(IDCompositionDevice),
          reinterpret_cast<void **>(g_host.dcompDevice.GetAddressOf())))) {
    return false;
  }
  if (FAILED(g_host.dcompDevice->CreateTargetForHwnd(
          g_host.window, TRUE, &g_host.dcompTarget))) return false;
  if (FAILED(g_host.dcompDevice->CreateVisual(&g_host.dcompRootVisual))) return false;
  if (FAILED(g_host.dcompDevice->CreateVisual(&g_host.dcompWebViewVisual))) return false;
  if (FAILED(g_host.dcompRootVisual->AddVisual(
          g_host.dcompWebViewVisual.Get(), TRUE, nullptr))) return false;
  if (FAILED(g_host.dcompTarget->SetRoot(g_host.dcompRootVisual.Get()))) return false;
  return SUCCEEDED(g_host.dcompDevice->Commit());
}

static void SendToUnity(const std::wstring &message) {
  std::string utf8 = WideToUtf8(message);
  utf8.push_back('\n');
  const bool replaceSnapshot = message.find(L"\"type\":\"simulation.snapshot\"") != std::wstring::npos;
  const bool replaceViewport = message.find(L"\"type\":\"viewport.rect\"") != std::wstring::npos;
  {
    std::lock_guard<std::mutex> lock(g_host.outboundMutex);
    if (replaceSnapshot || replaceViewport) {
      const char *marker = replaceSnapshot ? "\"type\":\"simulation.snapshot\"" : "\"type\":\"viewport.rect\"";
      for (auto it = g_host.outboundMessages.begin(); it != g_host.outboundMessages.end();) {
        if (it->find(marker) != std::string::npos) it = g_host.outboundMessages.erase(it);
        else ++it;
      }
    }
    g_host.outboundMessages.emplace_back(std::move(utf8));
  }
  g_host.outboundReady.notify_one();
}

static void PipeWriter() {
  while (!g_host.stopping) {
    std::string message;
    {
      std::unique_lock<std::mutex> lock(g_host.outboundMutex);
      g_host.outboundReady.wait_for(lock, std::chrono::milliseconds(100), [] {
        return g_host.stopping || !g_host.outboundMessages.empty();
      });
      if (g_host.stopping) break;
      if (g_host.outboundMessages.empty()) continue;
      message = std::move(g_host.outboundMessages.front());
      g_host.outboundMessages.pop_front();
    }
    while (!g_host.stopping) {
      const HANDLE pipe = g_host.pipe;
      if (pipe == INVALID_HANDLE_VALUE) {
        Sleep(20);
        continue;
      }
      DWORD written = 0;
      if (WriteFile(pipe, message.data(), static_cast<DWORD>(message.size()), &written, nullptr)
          && written == message.size()) {
        break;
      }
      Sleep(20);
    }
  }
}

static BOOL CALLBACK FindUnityWindowCallback(HWND window, LPARAM parameter) {
  auto *result = reinterpret_cast<HWND *>(parameter);
  DWORD processId = 0;
  GetWindowThreadProcessId(window, &processId);
  if (processId == g_host.unityProcessId) {
    *result = window;
    return FALSE;
  }
  return TRUE;
}

static HWND FindUnityWindow() {
  if (g_host.unityProcessId == 0) return nullptr;
  HWND window = nullptr;
  EnumChildWindows(g_host.window, FindUnityWindowCallback, reinterpret_cast<LPARAM>(&window));
  if (!window) EnumWindows(FindUnityWindowCallback, reinterpret_cast<LPARAM>(&window));
  return window;
}

static bool PrepareUnityWindow() {
  if (!g_host.unityWindow || !IsWindow(g_host.unityWindow)) {
    g_host.unityWindow = FindUnityWindow();
  }
  if (!g_host.unityWindow) return false;
  // Unity is started with -parentHWND. Do not force a cross-process SetParent
  // from the host message loop: some Unity player versions block while their
  // graphics window is being reparented. We can safely support both a child
  // Unity window and a top-level fallback by converting coordinates below.
  if (!g_host.unityViewportActive) {
    // Unity may show its native window again after graphics initialization.
    // Keep it hidden until the WebView explicitly reports a live 3D viewport;
    // otherwise it would cover the browser UI and steal every click.
    ShowWindowAsync(g_host.unityWindow, SW_HIDE);
  }
  return true;
}

static void PositionUnityFromViewport(const std::wstring &message) {
  g_host.pendingViewportMessage = message;
  const double devicePixelRatio = JsonNumberField(message, L"devicePixelRatio", 1.0);
  const double scale = devicePixelRatio > 0.25 ? devicePixelRatio : 1.0;
  const int x = static_cast<int>(JsonNumberField(message, L"x", 0) * scale + 0.5);
  const int y = static_cast<int>(JsonNumberField(message, L"y", 0) * scale + 0.5);
  const int width = static_cast<int>(JsonNumberField(message, L"width", 0) * scale + 0.5);
  const int height = static_cast<int>(JsonNumberField(message, L"height", 0) * scale + 0.5);
  if (width <= 0 || height <= 0) {
    g_host.unityViewportActive = false;
    if (g_host.unityWindow) ShowWindowAsync(g_host.unityWindow, SW_HIDE);
    return;
  }
  g_host.unityViewportActive = true;
  if (!g_host.unityStarted) StartUnity();
  if (!PrepareUnityWindow()) return;
  int windowX = x;
  int windowY = y;
  if (GetParent(g_host.unityWindow) != g_host.window) {
    POINT origin{x, y};
    if (ClientToScreen(g_host.window, &origin)) {
      windowX = origin.x;
      windowY = origin.y;
    }
  }
  ShowWindowAsync(g_host.unityWindow, SW_SHOWNA);
  // Unity owns the actual 3D pixels. Cut the existing Web UI rectangles out of
  // its native window region so those pixels and input remain owned by the
  // standard windowed WebView2 controller beneath it.
  HRGN visibleRegion = CreateRectRgn(0, 0, width, height);
  const std::wstring occlusions = JsonStringField(message, L"occlusions");
  std::wistringstream rectangles(occlusions);
  std::wstring rectangle;
  while (std::getline(rectangles, rectangle, L';')) {
    if (rectangle.empty()) continue;
    std::wistringstream values(rectangle);
    std::wstring part;
    double fields[4]{};
    int fieldCount = 0;
    while (fieldCount < 4 && std::getline(values, part, L',')) {
      wchar_t *end = nullptr;
      fields[fieldCount] = wcstod(part.c_str(), &end);
      if (end == part.c_str()) break;
      ++fieldCount;
    }
    if (fieldCount != 4 || fields[2] <= 0 || fields[3] <= 0) continue;
    const double viewportX = JsonNumberField(message, L"x", 0);
    const double viewportY = JsonNumberField(message, L"y", 0);
    const int left = max(0, static_cast<int>((fields[0] - viewportX) * scale) - 2);
    const int top = max(0, static_cast<int>((fields[1] - viewportY) * scale) - 2);
    const int right = min(width, static_cast<int>((fields[0] + fields[2] - viewportX) * scale + 0.5) + 2);
    const int bottom = min(height, static_cast<int>((fields[1] + fields[3] - viewportY) * scale + 0.5) + 2);
    if (right <= left || bottom <= top) continue;
    HRGN hole = CreateRectRgn(left, top, right, bottom);
    CombineRgn(visibleRegion, visibleRegion, hole, RGN_DIFF);
    DeleteObject(hole);
  }
  if (!SetWindowRgn(g_host.unityWindow, visibleRegion, TRUE)) DeleteObject(visibleRegion);
  SetWindowPos(g_host.unityWindow, HWND_TOP, windowX, windowY, width, height,
               SWP_NOACTIVATE | SWP_NOOWNERZORDER | SWP_ASYNCWINDOWPOS);
}

static void PipeReader() {
  std::string buffer;
  char chunk[4096];
  while (!g_host.stopping) {
    g_host.pipe = CreateFileW(g_host.pipeName.c_str(), GENERIC_READ | GENERIC_WRITE, 0, nullptr, OPEN_EXISTING, 0, nullptr);
    if (g_host.pipe == INVALID_HANDLE_VALUE) {
      Sleep(100);
      continue;
    }
    DWORD mode = PIPE_READMODE_BYTE;
    SetNamedPipeHandleState(g_host.pipe, &mode, nullptr, nullptr);
    while (!g_host.stopping) {
      DWORD read = 0;
      if (!ReadFile(g_host.pipe, chunk, sizeof(chunk), &read, nullptr) || read == 0) break;
      buffer.append(chunk, chunk + read);
      size_t newline = 0;
      while ((newline = buffer.find('\n')) != std::string::npos) {
        const std::string line = buffer.substr(0, newline);
        buffer.erase(0, newline + 1);
        const std::wstring wide = Utf8ToWide(line);
        auto *copy = new std::wstring(wide);
        PostMessageW(g_host.window, WM_BRIDGE_MESSAGE, 0, reinterpret_cast<LPARAM>(copy));
      }
    }
    CloseHandle(g_host.pipe);
    g_host.pipe = INVALID_HANDLE_VALUE;
  }
}

static void StartUnity() {
  if (g_host.unityStarted) return;
  auto player = g_host.root / L"unity" / L"ForgeMind-Client.exe";
  if (!fs::exists(player)) player = g_host.root / L"unity" / L"ForgeMind-U1.exe";
  if (!fs::exists(player)) return;
  g_host.pipeName = L"\\\\.\\pipe\\ForgeMind-" + std::to_wstring(GetCurrentProcessId());
  std::wstring command = L"\"" + player.wstring() + L"\" -forgemindPipe ForgeMind-" + std::to_wstring(GetCurrentProcessId()) + L" -parentHWND " + std::to_wstring(reinterpret_cast<UINT_PTR>(g_host.window));
  STARTUPINFOW startup{sizeof(startup)};
  PROCESS_INFORMATION process{};
  if (!CreateProcessW(player.c_str(), command.data(), nullptr, nullptr, FALSE, 0, nullptr, player.parent_path().c_str(), &startup, &process)) return;
  g_host.unityStarted = true;
  CloseHandle(process.hThread);
  g_host.unityProcess = process.hProcess;
  g_host.unityProcessId = process.dwProcessId;
  g_host.unityJob = CreateJobObjectW(nullptr, nullptr);
  if (g_host.unityJob) {
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    if (!SetInformationJobObject(g_host.unityJob, JobObjectExtendedLimitInformation,
                                  &limits, sizeof(limits)) ||
        !AssignProcessToJobObject(g_host.unityJob, g_host.unityProcess)) {
      CloseHandle(g_host.unityJob);
      g_host.unityJob = nullptr;
    }
  }
  // Hide the player immediately. It will only be shown after WebView2 sends
  // the actual .fm-viewport rectangle.
  SetTimer(g_host.window, UNITY_POLL_TIMER, 100, nullptr);
  g_host.pipeThread = std::thread(PipeReader);
  g_host.pipeWriterThread = std::thread(PipeWriter);
}

static void StartWebView() {
  g_host.loader = LoadLibraryW(L"WebView2Loader.dll");
  if (!g_host.loader) return;
  auto create = reinterpret_cast<CreateEnvironmentWithOptions>(GetProcAddress(g_host.loader, "CreateCoreWebView2EnvironmentWithOptions"));
  if (!create) return;
  const auto callback = Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>(
      [](HRESULT result, ICoreWebView2Environment *environment) -> HRESULT {
        if (FAILED(result) || !environment) return result;
        // Use the standard windowed WebView2 controller. It preserves the
        // browser's native mouse, wheel, keyboard, IME and focus behavior.
        // Unity is a separate top-level overlay, shown only over the reported
        // 3D viewport, so the rest of the Web UI remains a normal browser page.
        return environment->CreateCoreWebView2Controller(g_host.window,
            Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
                [](HRESULT controllerResult, ICoreWebView2Controller *controller) -> HRESULT {
                  if (FAILED(controllerResult) || !controller) return controllerResult;
                  g_host.controller = controller;
                  g_host.controller->get_CoreWebView2(&g_host.webview);
                  RECT bounds{};
                  GetClientRect(g_host.window, &bounds);
                  g_host.webViewBounds = bounds;
                  g_host.controller->put_Bounds(bounds);
                  g_host.controller->put_IsVisible(TRUE);
                  COREWEBVIEW2_COLOR transparent{0, 0, 0, 0};
                  ComPtr<ICoreWebView2Controller2> controller2;
                  if (SUCCEEDED(g_host.controller.As(&controller2))) {
                    controller2->put_DefaultBackgroundColor(transparent);
                  }
                  g_host.webview->add_WebMessageReceived(
                      Callback<ICoreWebView2WebMessageReceivedEventHandler>(
                          [](ICoreWebView2 *, ICoreWebView2WebMessageReceivedEventArgs *args) -> HRESULT {
                            LPWSTR raw = nullptr;
                            if (SUCCEEDED(args->get_WebMessageAsJson(&raw)) && raw) {
                              const std::wstring message(raw);
                              CoTaskMemFree(raw);
                              if (message.find(L"\"type\":\"bridge.start\"") != std::wstring::npos) StartUnity();
                              if (message.find(L"\"type\":\"viewport.rect\"") != std::wstring::npos) PositionUnityFromViewport(message);
                              SendToUnity(message);
                            }
                            return S_OK;
                          }).Get(), &g_host.webMessageToken);
                  const auto webRoot = g_host.root / L"web" / L"dist";
                  ComPtr<ICoreWebView2_3> webview3;
                  if (SUCCEEDED(g_host.webview.As(&webview3))) {
                    webview3->SetVirtualHostNameToFolderMapping(
                        L"forgemind.local", webRoot.c_str(),
                        COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_ALLOW);
                    g_host.webview->Navigate(L"https://forgemind.local/index.html");
                  } else {
                    const auto index = webRoot / L"index.html";
                    g_host.webview->Navigate(ToFileUrl(index).c_str());
                  }
                  return S_OK;
                }).Get());
      });
  create(nullptr, nullptr, nullptr, callback.Get());
}

static bool IsMouseMessage(UINT message) {
  switch (message) {
    case WM_MOUSEMOVE:
    case WM_LBUTTONDOWN:
    case WM_LBUTTONUP:
    case WM_LBUTTONDBLCLK:
    case WM_RBUTTONDOWN:
    case WM_RBUTTONUP:
    case WM_RBUTTONDBLCLK:
    case WM_MBUTTONDOWN:
    case WM_MBUTTONUP:
    case WM_MBUTTONDBLCLK:
    case WM_XBUTTONDOWN:
    case WM_XBUTTONUP:
    case WM_XBUTTONDBLCLK:
    case WM_MOUSEWHEEL:
    case WM_MOUSEHWHEEL:
    case WM_MOUSELEAVE:
      return true;
    default:
      return false;
  }
}

static COREWEBVIEW2_MOUSE_EVENT_KIND ToWebViewMouseKind(UINT message) {
  switch (message) {
    case WM_MOUSEMOVE: return COREWEBVIEW2_MOUSE_EVENT_KIND_MOVE;
    case WM_MOUSELEAVE: return COREWEBVIEW2_MOUSE_EVENT_KIND_LEAVE;
    case WM_LBUTTONDOWN: return COREWEBVIEW2_MOUSE_EVENT_KIND_LEFT_BUTTON_DOWN;
    case WM_LBUTTONUP: return COREWEBVIEW2_MOUSE_EVENT_KIND_LEFT_BUTTON_UP;
    case WM_LBUTTONDBLCLK: return COREWEBVIEW2_MOUSE_EVENT_KIND_LEFT_BUTTON_DOUBLE_CLICK;
    case WM_RBUTTONDOWN: return COREWEBVIEW2_MOUSE_EVENT_KIND_RIGHT_BUTTON_DOWN;
    case WM_RBUTTONUP: return COREWEBVIEW2_MOUSE_EVENT_KIND_RIGHT_BUTTON_UP;
    case WM_RBUTTONDBLCLK: return COREWEBVIEW2_MOUSE_EVENT_KIND_RIGHT_BUTTON_DOUBLE_CLICK;
    case WM_MBUTTONDOWN: return COREWEBVIEW2_MOUSE_EVENT_KIND_MIDDLE_BUTTON_DOWN;
    case WM_MBUTTONUP: return COREWEBVIEW2_MOUSE_EVENT_KIND_MIDDLE_BUTTON_UP;
    case WM_MBUTTONDBLCLK: return COREWEBVIEW2_MOUSE_EVENT_KIND_MIDDLE_BUTTON_DOUBLE_CLICK;
    case WM_XBUTTONDOWN: return COREWEBVIEW2_MOUSE_EVENT_KIND_X_BUTTON_DOWN;
    case WM_XBUTTONUP: return COREWEBVIEW2_MOUSE_EVENT_KIND_X_BUTTON_UP;
    case WM_XBUTTONDBLCLK: return COREWEBVIEW2_MOUSE_EVENT_KIND_X_BUTTON_DOUBLE_CLICK;
    case WM_MOUSEHWHEEL: return COREWEBVIEW2_MOUSE_EVENT_KIND_HORIZONTAL_WHEEL;
    case WM_MOUSEWHEEL: return COREWEBVIEW2_MOUSE_EVENT_KIND_WHEEL;
    default: return COREWEBVIEW2_MOUSE_EVENT_KIND_MOVE;
  }
}

static bool ForwardMouseMessage(UINT message, WPARAM wParam, LPARAM lParam) {
  if (!g_host.compositionController || !IsMouseMessage(message)) return false;

  POINT point{GET_X_LPARAM(lParam), GET_Y_LPARAM(lParam)};
  if (message == WM_MOUSEWHEEL || message == WM_MOUSEHWHEEL) {
    ScreenToClient(g_host.window, &point);
  }

  const bool inside = PtInRect(&g_host.webViewBounds, point) != FALSE;
  if (message == WM_MOUSEMOVE && !g_host.trackingMouse) {
    TRACKMOUSEEVENT tracking{sizeof(TRACKMOUSEEVENT), TME_LEAVE, g_host.window, 0};
    TrackMouseEvent(&tracking);
    g_host.trackingMouse = true;
  }
  if (message == WM_MOUSELEAVE) g_host.trackingMouse = false;
  if (!inside && message != WM_MOUSELEAVE && !g_host.capturingMouse) return false;

  DWORD mouseData = 0;
  if (message == WM_MOUSEWHEEL || message == WM_MOUSEHWHEEL) {
    mouseData = static_cast<DWORD>(GET_WHEEL_DELTA_WPARAM(wParam));
  } else if (message == WM_XBUTTONDOWN || message == WM_XBUTTONUP || message == WM_XBUTTONDBLCLK) {
    mouseData = GET_XBUTTON_WPARAM(wParam);
  }

  const bool buttonDown = message == WM_LBUTTONDOWN || message == WM_RBUTTONDOWN ||
      message == WM_MBUTTONDOWN || message == WM_XBUTTONDOWN;
  const bool buttonUp = message == WM_LBUTTONUP || message == WM_RBUTTONUP ||
      message == WM_MBUTTONUP || message == WM_XBUTTONUP;
  if (buttonDown && inside && !g_host.capturingMouse) {
    SetFocus(g_host.window);
    SetActiveWindow(g_host.window);
    SetCapture(g_host.window);
    g_host.capturingMouse = true;
  }

  POINT localPoint = point;
  localPoint.x -= g_host.webViewBounds.left;
  localPoint.y -= g_host.webViewBounds.top;
  g_host.compositionController->SendMouseInput(
      ToWebViewMouseKind(message),
      static_cast<COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS>(GET_KEYSTATE_WPARAM(wParam)),
      mouseData, localPoint);

  if (buttonUp && g_host.capturingMouse && GetCapture() == g_host.window) {
    ReleaseCapture();
    g_host.capturingMouse = false;
  }
  return true;
}

static LRESULT CALLBACK WindowProc(HWND window, UINT message, WPARAM wParam, LPARAM lParam) {
  if (message == WM_MOUSEACTIVATE) {
    SetFocus(window);
    return MA_ACTIVATE;
  }
  if (message == WM_BRIDGE_MESSAGE) {
    std::unique_ptr<std::wstring> payload(reinterpret_cast<std::wstring *>(lParam));
    if (g_host.webview && payload) g_host.webview->PostWebMessageAsJson(payload->c_str());
    return 0;
  }
  if (message == WM_SIZE) {
    if (g_host.controller) {
      RECT bounds{};
      GetClientRect(window, &bounds);
      g_host.webViewBounds = bounds;
      g_host.controller->put_Bounds(bounds);
      if (g_host.dcompDevice) g_host.dcompDevice->Commit();
    }
  }
  if (message == WM_TIMER && wParam == UNITY_POLL_TIMER) {
    if (PrepareUnityWindow() && g_host.unityViewportActive && !g_host.pendingViewportMessage.empty()) {
      PositionUnityFromViewport(g_host.pendingViewportMessage);
      KillTimer(window, UNITY_POLL_TIMER);
    }
    return 0;
  }
  if (ForwardMouseMessage(message, wParam, lParam)) return 0;
  if (message == WM_DESTROY) {
    KillTimer(window, UNITY_POLL_TIMER);
    g_host.stopping = true;
    g_host.outboundReady.notify_all();
    if (g_host.pipe != INVALID_HANDLE_VALUE) CloseHandle(g_host.pipe);
    if (g_host.pipeThread.joinable()) g_host.pipeThread.join();
    if (g_host.pipeWriterThread.joinable()) g_host.pipeWriterThread.join();
    if (g_host.unityProcess) {
      WaitForSingleObject(g_host.unityProcess, 1500);
      CloseHandle(g_host.unityProcess);
    }
    if (g_host.unityJob) {
      CloseHandle(g_host.unityJob);
      g_host.unityJob = nullptr;
    }
    if (g_host.backendJob) {
      CloseHandle(g_host.backendJob);
      g_host.backendJob = nullptr;
    }
    if (g_host.backendProcess) {
      WaitForSingleObject(g_host.backendProcess, 3000);
      CloseHandle(g_host.backendProcess);
      g_host.backendProcess = nullptr;
    }
    if (g_host.loader) FreeLibrary(g_host.loader);
    PostQuitMessage(0);
    return 0;
  }
  return DefWindowProcW(window, message, wParam, lParam);
}

int WINAPI wWinMain(HINSTANCE instance, HINSTANCE, PWSTR, int show) {
  CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
  wchar_t modulePath[MAX_PATH]{};
  GetModuleFileNameW(nullptr, modulePath, MAX_PATH);
  g_host.root = fs::path(modulePath).parent_path();
  WNDCLASSW windowClass{};
  windowClass.hInstance = instance;
  windowClass.lpfnWndProc = WindowProc;
  windowClass.lpszClassName = L"ForgeMindHybridHost";
  RegisterClassW(&windowClass);
  SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
  g_host.window = CreateWindowExW(0, windowClass.lpszClassName, L"ForgeMind · 工业工厂数字孪生", WS_OVERLAPPEDWINDOW | WS_CLIPCHILDREN | WS_CLIPSIBLINGS, CW_USEDEFAULT, CW_USEDEFAULT, 1600, 960, nullptr, nullptr, instance, nullptr);
  if (!g_host.window) return 1;
  ShowWindow(g_host.window, show);
  StartBackend();
  StartWebView();
  MSG message{};
  while (GetMessageW(&message, nullptr, 0, 0) > 0) {
    TranslateMessage(&message);
    DispatchMessageW(&message);
  }
  CoUninitialize();
  return static_cast<int>(message.wParam);
}
