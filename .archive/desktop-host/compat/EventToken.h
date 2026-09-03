#pragma once

// MinGW's Windows SDK uses the lower-case eventtoken.h name while the
// Microsoft WebView2 SDK includes EventToken.h. Keep this tiny ABI-compatible
// declaration local to the host build; MSVC builds use the SDK/Windows header.
typedef struct EventRegistrationToken {
  __int64 value;
} EventRegistrationToken;
