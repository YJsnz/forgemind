cmake_minimum_required(VERSION 3.20)
project(ForgeMindHost LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

if(NOT WEBVIEW2_SDK)
  message(FATAL_ERROR "Set WEBVIEW2_SDK to the extracted Microsoft.Web.WebView2 package root")
endif()

add_executable(ForgeMindHost WIN32 ForgeMindHost.cpp)
target_include_directories(ForgeMindHost PRIVATE "${WEBVIEW2_SDK}/build/native/include")
target_link_libraries(ForgeMindHost PRIVATE ole32 user32 shlwapi d3d11 dxgi dcomp)

# WebView2Loader is loaded dynamically so the host does not require a machine-
# wide SDK installation at runtime. The installer supplies the loader DLL.
