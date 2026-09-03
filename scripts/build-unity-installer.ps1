[CmdletBinding()]
param(
    [switch]$SkipPlayerBuild,
    [string]$EditorPath = 'D:\Unity\2022.3.62t13\Editor\Tuanjie.exe'
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$unityRoot = Join-Path $repoRoot 'unity-client'
$playerRoot = Join-Path $unityRoot 'Builds\ForgeMind-U1'
$outputRoot = Join-Path $unityRoot 'Builds'
$stagingRoot = Join-Path $outputRoot 'ForgeMind-Setup-Staging'
$payloadRoot = Join-Path $stagingRoot 'ForgeMind-U1'
$payloadZip = Join-Path $stagingRoot 'payload.zip'
$installerPath = Join-Path $outputRoot 'ForgeMind-Setup.exe'
$sedPath = Join-Path $stagingRoot 'ForgeMind-Setup.sed'
$buildLog = Join-Path $unityRoot 'Logs\u1-player-build-installer.log'

if (-not $SkipPlayerBuild) {
    if (-not (Test-Path -LiteralPath $EditorPath)) { throw "找不到 Tuanjie/Unity 编辑器：$EditorPath" }
    $args = @('-batchmode', '-nographics', '-quit', '-projectPath', $unityRoot, '-executeMethod', 'ForgeMind.Client.Editor.ForgeMindProjectBootstrap.BuildU1WindowsPlayer', '-logFile', $buildLog)
    $process = Start-Process -FilePath $EditorPath -ArgumentList $args -WorkingDirectory $unityRoot -PassThru -Wait
    if ($process.ExitCode -ne 0) { throw "Unity Player 构建失败，退出码：$($process.ExitCode)；日志：$buildLog" }
}

$playerExe = Join-Path $playerRoot 'ForgeMind-U1.exe'
if (-not (Test-Path -LiteralPath $playerExe)) { throw "找不到 Player：$playerExe" }

if (Test-Path -LiteralPath $stagingRoot) { Remove-Item -LiteralPath $stagingRoot -Recurse -Force }
New-Item -ItemType Directory -Path $payloadRoot -Force | Out-Null
Copy-Item -Path (Join-Path $playerRoot '*') -Destination $payloadRoot -Recurse -Force
Copy-Item -LiteralPath (Join-Path $repoRoot 'installer\Install-ForgeMind.ps1') -Destination (Join-Path $stagingRoot 'Install-ForgeMind.ps1') -Force
Compress-Archive -Path $payloadRoot -DestinationPath $payloadZip -CompressionLevel Optimal -Force

$sourceRoot = $stagingRoot.Replace('/', '\') + '\'
$targetInstaller = $installerPath.Replace('/', '\')
$sed = @"
[Version]
Class=IEXPRESS
SEDVersion=3
[Options]
PackagePurpose=InstallApp
ShowInstallProgramWindow=1
HideExtractAnimation=1
UseLongFileName=1
InsideCompressed=1
CAB_FixedSize=0
CAB_ResvCodeSigning=0
RebootMode=I
InstallPrompt=%InstallPrompt%
DisplayLicense=%DisplayLicense%
FinishMessage=%FinishMessage%
TargetName=%TargetName%
FriendlyName=%FriendlyName%
AppLaunched=%AppLaunched%
PostInstallCmd=%PostInstallCmd%
AdminQuietInstCmd=%AdminQuietInstCmd%
UserQuietInstCmd=%UserQuietInstCmd%
SourceFiles=SourceFiles
[Strings]
InstallPrompt=
DisplayLicense=
FinishMessage=ForgeMind Native Client 安装完成。
TargetName=$targetInstaller
FriendlyName=ForgeMind Native Client
AppLaunched=PowerShell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File Install-ForgeMind.ps1
PostInstallCmd=<None>
AdminQuietInstCmd=
UserQuietInstCmd=
FILE0="payload.zip"
FILE1="Install-ForgeMind.ps1"
[SourceFiles]
SourceFiles0=$sourceRoot
[SourceFiles0]
%FILE0%=
%FILE1%=
"@
$sed | Set-Content -LiteralPath $sedPath -Encoding ASCII

& "$env:WINDIR\System32\iexpress.exe" /N /Q $sedPath
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $installerPath)) {
    throw "IExpress 安装包生成失败：$installerPath"
}

$hash = (Get-FileHash -LiteralPath $installerPath -Algorithm SHA256).Hash
$size = (Get-Item -LiteralPath $installerPath).Length
Write-Output "ForgeMind installer built: $installerPath; size=$size bytes; sha256=$hash"
