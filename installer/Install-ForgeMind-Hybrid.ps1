param(
    [string]$InstallRootOverride,
    [switch]$TestOnly
)

$ErrorActionPreference = 'Stop'
$appName = 'ForgeMind'
$installRoot = if ([string]::IsNullOrWhiteSpace($InstallRootOverride)) {
    Join-Path ${env:ProgramFiles} 'ForgeMind'
} else {
    [IO.Path]::GetFullPath($InstallRootOverride)
}
$sourceRoot = $PSScriptRoot

function Test-WebView2Runtime {
    $roots = @(
        (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\EdgeWebView\Application'),
        (Join-Path ${env:ProgramFiles} 'Microsoft\EdgeWebView\Application')
    )
    foreach ($root in $roots) {
        if (-not (Test-Path -LiteralPath $root)) { continue }
        $runtime = Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue |
            Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'msedgewebview2.exe') } |
            Select-Object -First 1
        if ($null -ne $runtime) { return $true }
    }
    return $false
}

if (-not $TestOnly -and -not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    $arguments = @('-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $PSCommandPath)
    if (-not [string]::IsNullOrWhiteSpace($InstallRootOverride)) {
        $arguments += @('-InstallRootOverride', $InstallRootOverride)
    }
    $elevated = Start-Process -FilePath 'powershell.exe' -ArgumentList $arguments -Verb RunAs -Wait -PassThru
    exit $elevated.ExitCode
}

if (-not (Test-WebView2Runtime)) {
    throw 'ForgeMind 需要 Microsoft Edge WebView2 Runtime。请先安装 Evergreen Runtime 后重新运行安装包：https://developer.microsoft.com/microsoft-edge/webview2/'
}

$payload = Join-Path $sourceRoot 'payload.zip'
if (-not (Test-Path -LiteralPath $payload)) { throw "安装包缺少 payload.zip：$payload" }

$extractRoot = Join-Path $env:TEMP ('ForgeMindInstall-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $extractRoot -Force | Out-Null
try {
    Expand-Archive -LiteralPath $payload -DestinationPath $extractRoot -Force
    $payloadRoot = Join-Path $extractRoot 'ForgeMind-Desktop'
    $required = @(
        (Join-Path $payloadRoot 'ForgeMindHost.exe'),
        (Join-Path $payloadRoot 'WebView2Loader.dll'),
        (Join-Path $payloadRoot 'web\dist\index.html'),
        (Join-Path $payloadRoot 'unity\ForgeMind-Client.exe')
    )
    foreach ($path in $required) {
        if (-not (Test-Path -LiteralPath $path)) { throw "安装包文件不完整：$path" }
    }

    New-Item -ItemType Directory -Path $installRoot -Force | Out-Null
    Copy-Item -Path (Join-Path $payloadRoot '*') -Destination $installRoot -Recurse -Force

    $uninstaller = Join-Path $installRoot 'Uninstall-ForgeMind.ps1'
    @(
        '$ErrorActionPreference = "Stop"',
        '$installRoot = Split-Path -Parent $PSCommandPath',
        'Get-Process -Name ForgeMindHost -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue',
        'Get-Process -Name ForgeMind-Client -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue',
        '$uninstallKey = "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\ForgeMind"',
        'Remove-Item -LiteralPath $uninstallKey -Recurse -Force -ErrorAction SilentlyContinue',
        '$shell = New-Object -ComObject WScript.Shell',
        'foreach ($path in @((Join-Path ([Environment]::GetFolderPath("Desktop")) "ForgeMind.lnk"), (Join-Path ([Environment]::GetFolderPath("Programs")) "ForgeMind.lnk"))) { Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue }',
        '$cleanup = Join-Path $env:TEMP ("ForgeMind-uninstall-" + [Guid]::NewGuid().ToString("N") + ".cmd")',
        '@("@echo off", "ping 127.0.0.1 -n 2 > nul", "rmdir /s /q `"$installRoot`"", "del /q `"%~f0`"") | Set-Content -LiteralPath $cleanup -Encoding ASCII',
        'Start-Process -FilePath "cmd.exe" -ArgumentList @("/c", $cleanup) -WindowStyle Hidden'
    ) | Set-Content -LiteralPath $uninstaller -Encoding UTF8

    if (-not $TestOnly) {
        $shell = New-Object -ComObject WScript.Shell
        foreach ($shortcutPath in @(
            (Join-Path ([Environment]::GetFolderPath('Desktop')) 'ForgeMind.lnk'),
            (Join-Path ([Environment]::GetFolderPath('Programs')) 'ForgeMind.lnk')
        )) {
            $shortcut = $shell.CreateShortcut($shortcutPath)
            $shortcut.TargetPath = Join-Path $installRoot 'ForgeMindHost.exe'
            $shortcut.WorkingDirectory = $installRoot
            $shortcut.Description = 'ForgeMind 智慧工厂'
            $shortcut.Save()
        }

        $uninstallKey = 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\ForgeMind'
        New-Item -Path $uninstallKey -Force | Out-Null
        New-ItemProperty -Path $uninstallKey -Name DisplayName -Value $appName -PropertyType String -Force | Out-Null
        New-ItemProperty -Path $uninstallKey -Name InstallLocation -Value $installRoot -PropertyType String -Force | Out-Null
        New-ItemProperty -Path $uninstallKey -Name UninstallString -Value "powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File `"$uninstaller`"" -PropertyType String -Force | Out-Null
        New-ItemProperty -Path $uninstallKey -Name Publisher -Value 'ForgeMind' -PropertyType String -Force | Out-Null
        Start-Process -FilePath (Join-Path $installRoot 'ForgeMindHost.exe') -WorkingDirectory $installRoot
    }
}
finally {
    if (Test-Path -LiteralPath $extractRoot) { Remove-Item -LiteralPath $extractRoot -Recurse -Force -ErrorAction SilentlyContinue }
}
