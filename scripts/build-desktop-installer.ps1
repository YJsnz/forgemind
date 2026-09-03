[CmdletBinding()]
param(
    [switch]$SkipWebBuild,
    [switch]$SkipUnityBuild,
    [switch]$SkipHostBuild,
    [string]$EditorPath = 'D:\Unity\2022.3.62t13\Editor\Tuanjie.exe'
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$unityRoot = Join-Path $repoRoot 'unity-client'
$outputRoot = Join-Path $unityRoot 'Builds'
$playerRoot = Join-Path $outputRoot 'ForgeMind-Client'
$hostRoot = Join-Path $repoRoot 'desktop-host'
$hostBuildRoot = Join-Path $hostRoot 'build'
$stagingRoot = Join-Path $outputRoot 'ForgeMind-Desktop-Setup-Staging'
$payloadRoot = Join-Path $stagingRoot 'ForgeMind-Desktop'
$payloadZip = Join-Path $stagingRoot 'payload.zip'
$installerPath = Join-Path $outputRoot 'ForgeMind-Setup.exe'
$sedPath = Join-Path $stagingRoot 'ForgeMind-Setup.sed'
$unityLog = Join-Path $unityRoot 'Logs\final-hybrid-build-installer.log'
$backendJar = Join-Path $repoRoot 'backend\target\forgemind-backend-0.1.0.jar'
$runtimeRoot = Join-Path $outputRoot 'ForgeMind-Desktop-Runtime'

if (-not $SkipWebBuild) {
    Push-Location $repoRoot
    try { npm.cmd run build:desktop } finally { Pop-Location }
}

Push-Location (Join-Path $repoRoot 'backend')
try {
    $maven = (Get-Command mvn.cmd -ErrorAction SilentlyContinue).Source
    if ([string]::IsNullOrWhiteSpace($maven)) { throw 'mvn.cmd was not found; Maven 3.9+ is required to build the desktop backend.' }
    & $maven package -DskipTests
    if ($LASTEXITCODE -ne 0) { throw "Spring Boot backend package failed with exit code $LASTEXITCODE." }
}
finally { Pop-Location }

if (Test-Path -LiteralPath $runtimeRoot) { Remove-Item -LiteralPath $runtimeRoot -Recurse -Force }
$jlink = (Get-Command jlink.exe -ErrorAction SilentlyContinue).Source
if ([string]::IsNullOrWhiteSpace($jlink)) { throw 'jlink.exe was not found; Java 17+ JDK is required to build the standalone desktop runtime.' }
$runtimeModules = @(
    'java.base', 'java.compiler', 'java.datatransfer', 'java.desktop', 'java.instrument',
    'java.logging', 'java.management', 'java.management.rmi', 'java.naming', 'java.net.http',
    'java.prefs', 'java.rmi', 'java.scripting', 'java.security.jgss', 'java.security.sasl',
    'java.smartcardio', 'java.sql', 'java.sql.rowset', 'java.transaction.xa', 'java.xml',
    'java.xml.crypto', 'jdk.crypto.cryptoki', 'jdk.crypto.ec', 'jdk.httpserver', 'jdk.jfr',
    'jdk.management', 'jdk.management.agent', 'jdk.naming.dns', 'jdk.naming.rmi',
    'jdk.unsupported', 'jdk.zipfs'
) -join ','
& $jlink --add-modules $runtimeModules --strip-debug --no-header-files --no-man-pages --compress=2 --output $runtimeRoot
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath (Join-Path $runtimeRoot 'bin\javaw.exe'))) {
    throw "Standalone Java runtime build failed: $runtimeRoot"
}

if (-not $SkipUnityBuild) {
    if (-not (Test-Path -LiteralPath $EditorPath)) { throw "找不到 Tuanjie/Unity 编辑器：$EditorPath" }
    $unityArgs = @('-batchmode', '-quit', '-projectPath', $unityRoot, '-executeMethod', 'ForgeMind.Client.Editor.ForgeMindProjectBootstrap.BuildFinalHybridWindowsPlayer', '-logFile', $unityLog)
    $process = Start-Process -FilePath $EditorPath -ArgumentList $unityArgs -WorkingDirectory $unityRoot -PassThru -Wait
    if ($process.ExitCode -ne 0) { throw "Unity 最终 Player 构建失败，退出码：$($process.ExitCode)；日志：$unityLog" }
}

if (-not $SkipHostBuild) {
    $vsDevCmd = Get-ChildItem -Path "C:\Program Files\Microsoft Visual Studio\2022" -Recurse -Filter "VsDevCmd.bat" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -eq $vsDevCmd) { throw "Visual Studio VsDevCmd.bat was not found." }
    New-Item -ItemType Directory -Path $hostBuildRoot -Force | Out-Null
    $sdkRoot = $env:FORGEMIND_WEBVIEW2_SDK
    if ([string]::IsNullOrWhiteSpace($sdkRoot)) { $sdkRoot = "D:\deps\Microsoft.Web.WebView2" }
    $sdkInclude = Join-Path $sdkRoot "build\native\include"
    $sdkLoaderLib = Join-Path $sdkRoot "build\native\x64\WebView2Loader.dll.lib"
    if (-not (Test-Path -LiteralPath $sdkInclude)) { throw "WebView2 SDK include was not found: $sdkInclude" }
    if (-not (Test-Path -LiteralPath $sdkLoaderLib)) { throw "WebView2 x64 loader library was not found: $sdkLoaderLib" }
    $hostExe = Join-Path $hostBuildRoot "ForgeMindHost.exe"
    $hostSource = Join-Path $hostRoot "ForgeMindHost.cpp"
    $quote = [char]34
    $hostObj = Join-Path $hostBuildRoot "ForgeMindHost.obj"
    $command = "call $quote$($vsDevCmd.FullName)$quote -arch=x64 -host_arch=x64 " + "&& cl.exe /nologo /utf-8 /EHsc /std:c++17 /DWIN32 /I$quote$sdkInclude$quote /Fo$quote$hostObj$quote $quote$hostSource$quote $quote$sdkLoaderLib$quote user32.lib gdi32.lib ole32.lib shlwapi.lib shell32.lib d3d11.lib dxgi.lib dcomp.lib /link /SUBSYSTEM:WINDOWS /OUT:$quote$hostExe$quote"
    & cmd.exe /d /s /c $command
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $hostExe)) { throw "Desktop host compilation failed: $hostExe" }
}

$playerExe = Join-Path $playerRoot "ForgeMind-Client.exe"
$hostExe = Join-Path $hostBuildRoot "ForgeMindHost.exe"
$loader = "D:\deps\Microsoft.Web.WebView2\build\native\x64\WebView2Loader.dll"
foreach ($path in @((Join-Path $repoRoot "dist\index.html"), $playerExe, $hostExe, $loader, $backendJar, (Join-Path $runtimeRoot 'bin\javaw.exe'))) {
    if (-not (Test-Path -LiteralPath $path)) { throw "Final package input is missing: $path" }
}

if (Test-Path -LiteralPath $stagingRoot) { Remove-Item -LiteralPath $stagingRoot -Recurse -Force }
New-Item -ItemType Directory -Path (Join-Path $payloadRoot "web\dist") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $payloadRoot "unity") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $payloadRoot "backend") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $payloadRoot "runtime") -Force | Out-Null
Copy-Item -Path (Join-Path $repoRoot "dist\*") -Destination (Join-Path $payloadRoot "web\dist") -Recurse -Force
Copy-Item -Path (Join-Path $playerRoot "*") -Destination (Join-Path $payloadRoot "unity") -Recurse -Force
Copy-Item -LiteralPath $hostExe -Destination (Join-Path $payloadRoot "ForgeMindHost.exe") -Force
Copy-Item -LiteralPath $loader -Destination (Join-Path $payloadRoot "WebView2Loader.dll") -Force
Copy-Item -LiteralPath $backendJar -Destination (Join-Path $payloadRoot "backend\forgemind-backend-0.1.0.jar") -Force
Copy-Item -Path (Join-Path $runtimeRoot '*') -Destination (Join-Path $payloadRoot 'runtime') -Recurse -Force
Copy-Item -LiteralPath (Join-Path $repoRoot "installer\Install-ForgeMind-Hybrid.ps1") -Destination (Join-Path $stagingRoot "Install-ForgeMind-Hybrid.ps1") -Force
Compress-Archive -Path $payloadRoot -DestinationPath $payloadZip -CompressionLevel Optimal -Force

$sourceRoot = $stagingRoot.Replace([char]47, [IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
$setupStubSource = Join-Path $hostRoot "ForgeMindSetupStub.cpp"
$setupStub = Join-Path $hostBuildRoot "ForgeMindSetupStub.exe"
$setupStubObj = Join-Path $hostBuildRoot "ForgeMindSetupStub.obj"
$quote = [char]34
$stubCommand = "call $quote$($vsDevCmd.FullName)$quote -arch=x64 -host_arch=x64 " + "&& cl.exe /nologo /utf-8 /EHsc /std:c++17 /DWIN32 /Fo$quote$setupStubObj$quote $quote$setupStubSource$quote user32.lib /link /SUBSYSTEM:WINDOWS /OUT:$quote$setupStub$quote"
if ($SkipHostBuild) {
    throw "The SFX installer stub must be compiled; omit -SkipHostBuild when building the final installer."
}
& cmd.exe /d /s /c $stubCommand
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $setupStub)) { throw "SFX installer stub compilation failed: $setupStub" }

$installScript = Join-Path $repoRoot "installer\Install-ForgeMind-Hybrid.ps1"
$stubLength = [UInt64](Get-Item -LiteralPath $setupStub).Length
$payloadLength = [UInt64](Get-Item -LiteralPath $payloadZip).Length
$scriptLength = [UInt64](Get-Item -LiteralPath $installScript).Length
$payloadOffset = $stubLength
$scriptOffset = $payloadOffset + $payloadLength
$footer = New-Object byte[] 56
$magicBytes = [Text.Encoding]::ASCII.GetBytes("FORGEMIND_SFX1")
[Buffer]::BlockCopy($magicBytes, 0, $footer, 0, $magicBytes.Length)
$fields = @($stubLength, $payloadOffset, $payloadLength, $scriptOffset, $scriptLength)
for ($index = 0; $index -lt $fields.Count; $index++) {
    $bytes = [BitConverter]::GetBytes([UInt64]$fields[$index])
    [Buffer]::BlockCopy($bytes, 0, $footer, 16 + (8 * $index), 8)
}

$output = [IO.File]::Open($installerPath, [IO.FileMode]::Create, [IO.FileAccess]::Write, [IO.FileShare]::None)
try {
    foreach ($inputPath in @($setupStub, $payloadZip, $installScript)) {
        $input = [IO.File]::OpenRead($inputPath)
        try { $input.CopyTo($output) } finally { $input.Dispose() }
    }
    $output.Write($footer, 0, $footer.Length)
}
finally { $output.Dispose() }
if (-not (Test-Path -LiteralPath $installerPath)) { throw "SFX installer generation failed: $installerPath" }

$hash = (Get-FileHash -LiteralPath $installerPath -Algorithm SHA256).Hash
$size = (Get-Item -LiteralPath $installerPath).Length
Write-Output "ForgeMind final installer built: $installerPath; size=$size bytes; sha256=$hash"
