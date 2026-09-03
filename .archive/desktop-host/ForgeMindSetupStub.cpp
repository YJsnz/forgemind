#define UNICODE
#define _UNICODE
#include <windows.h>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <string>
#include <vector>

namespace fs = std::filesystem;

#pragma pack(push, 1)
struct SfxFooter {
  char magic[16];
  std::uint64_t stubSize;
  std::uint64_t payloadOffset;
  std::uint64_t payloadLength;
  std::uint64_t scriptOffset;
  std::uint64_t scriptLength;
};
#pragma pack(pop)

static constexpr char kMagic[] = "FORGEMIND_SFX1";

static bool CopyRange(const fs::path &source, std::uint64_t offset, std::uint64_t length, const fs::path &target) {
  std::ifstream input(source, std::ios::binary);
  if (!input) return false;
  input.seekg(static_cast<std::streamoff>(offset));
  std::ofstream output(target, std::ios::binary | std::ios::trunc);
  if (!output) return false;
  std::vector<char> buffer(1024 * 1024);
  std::uint64_t remaining = length;
  while (remaining > 0) {
    const auto request = static_cast<std::streamsize>((remaining > buffer.size()) ? buffer.size() : remaining);
    input.read(buffer.data(), request);
    const auto actual = input.gcount();
    if (actual <= 0) return false;
    output.write(buffer.data(), actual);
    if (!output) return false;
    remaining -= static_cast<std::uint64_t>(actual);
  }
  return true;
}

static bool ReadFooter(const fs::path &source, SfxFooter &footer) {
  std::ifstream input(source, std::ios::binary);
  if (!input) return false;
  input.seekg(0, std::ios::end);
  const auto size = input.tellg();
  if (size < static_cast<std::streamoff>(sizeof(SfxFooter))) return false;
  input.seekg(size - static_cast<std::streamoff>(sizeof(SfxFooter)));
  input.read(reinterpret_cast<char *>(&footer), sizeof(footer));
  return input.good() && std::string(footer.magic, sizeof(footer.magic)).compare(0, sizeof(kMagic) - 1, kMagic) == 0;
}

static fs::path MakeTempDirectory() {
  wchar_t tempPath[MAX_PATH]{};
  const DWORD length = GetTempPathW(ARRAYSIZE(tempPath), tempPath);
  if (length == 0 || length >= ARRAYSIZE(tempPath)) return {};
  const auto path = fs::path(tempPath) / (L"ForgeMindInstall-" + std::to_wstring(GetCurrentProcessId()));
  fs::create_directories(path);
  return path;
}

static int RunInstaller(const fs::path &script, const wchar_t *forwardedArguments) {
  std::wstring command = L"powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File \"" + script.wstring() + L"\"";
  if (forwardedArguments != nullptr && *forwardedArguments != L'\0') {
    command += L" ";
    command += forwardedArguments;
  }
  STARTUPINFOW startup{sizeof(startup)};
  PROCESS_INFORMATION process{};
  if (!CreateProcessW(nullptr, command.data(), nullptr, nullptr, FALSE, CREATE_NO_WINDOW, nullptr, script.parent_path().c_str(), &startup, &process)) {
    return static_cast<int>(GetLastError());
  }
  WaitForSingleObject(process.hProcess, INFINITE);
  DWORD exitCode = 1;
  GetExitCodeProcess(process.hProcess, &exitCode);
  CloseHandle(process.hThread);
  CloseHandle(process.hProcess);
  return static_cast<int>(exitCode);
}

int WINAPI wWinMain(HINSTANCE, HINSTANCE, PWSTR commandLine, int) {
  wchar_t modulePath[MAX_PATH]{};
  GetModuleFileNameW(nullptr, modulePath, ARRAYSIZE(modulePath));
  const fs::path self(modulePath);
  SfxFooter footer{};
  if (!ReadFooter(self, footer) || footer.stubSize == 0 || footer.payloadLength == 0 || footer.scriptLength == 0) {
    MessageBoxW(nullptr, L"ForgeMind package is incomplete.", L"ForgeMind", MB_ICONERROR | MB_OK);
    return 2;
  }

  const auto temp = MakeTempDirectory();
  if (temp.empty()) {
    MessageBoxW(nullptr, L"Cannot create the ForgeMind temporary installation directory.", L"ForgeMind", MB_ICONERROR | MB_OK);
    return 3;
  }
  const auto payload = temp / L"payload.zip";
  const auto script = temp / L"Install-ForgeMind-Hybrid.ps1";
  const bool extracted = CopyRange(self, footer.payloadOffset, footer.payloadLength, payload)
      && CopyRange(self, footer.scriptOffset, footer.scriptLength, script);
  const int result = extracted ? RunInstaller(script, commandLine) : 4;
  std::error_code error;
  fs::remove_all(temp, error);
  if (!extracted) MessageBoxW(nullptr, L"ForgeMind package extraction failed.", L"ForgeMind", MB_ICONERROR | MB_OK);
  return result;
}
