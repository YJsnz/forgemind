param(
    [string]$InstallRootOverride,
    [switch]$TestOnly
)

$ErrorActionPreference = 'Stop'

$appName = 'ForgeMind Native Client'
$installRoot = if ([string]::IsNullOrWhiteSpace($InstallRootOverride)) { Join-Path ${env:ProgramFiles} 'ForgeMind\Native Client' } else { [IO.Path]::GetFullPath($InstallRootOverride) }
$sourceRoot = $PSScriptRoot

if (-not $TestOnly -and -not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    $arguments = '-NoLogo -NoProfile -ExecutionPolicy Bypass -File "{0}"' -f $PSCommandPath
    Start-Process -FilePath 'powershell.exe' -ArgumentList $arguments -Verb RunAs -Wait
    exit $LASTEXITCODE
}

$payload = Join-Path $sourceRoot 'payload.zip'
if (-not (Test-Path -LiteralPath $payload)) { throw "安装包缺少 payload.zip：$payload" }

$extractRoot = Join-Path $env:TEMP ('ForgeMindInstall-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $extractRoot -Force | Out-Null
try {
    Expand-Archive -LiteralPath $payload -DestinationPath $extractRoot -Force
    $playerRoot = Join-Path $extractRoot 'ForgeMind-U1'
    if (-not (Test-Path -LiteralPath (Join-Path $playerRoot 'ForgeMind-U1.exe'))) {
        throw '安装包中的 Unity Player 不完整。'
    }

    New-Item -ItemType Directory -Path $installRoot -Force | Out-Null
    Copy-Item -Path (Join-Path $playerRoot '*') -Destination $installRoot -Recurse -Force

    $uninstaller = Join-Path $installRoot 'Uninstall-ForgeMind.ps1'
    $uninstallerContent = @(
        '$ErrorActionPreference = "Stop"',
        '$installRoot = Split-Path -Parent $PSCommandPath',
        'if ((Get-Process -Name ForgeMind-U1 -ErrorAction SilentlyContinue)) { Stop-Process -Name ForgeMind-U1 -Force -ErrorAction SilentlyContinue }',
        'Remove-Item -LiteralPath $installRoot -Recurse -Force'
    )
    $uninstallerContent | Set-Content -LiteralPath $uninstaller -Encoding UTF8

    $shell = New-Object -ComObject WScript.Shell
    $desktop = Join-Path ([Environment]::GetFolderPath('Desktop')) 'ForgeMind Native Client.lnk'
    $startMenu = Join-Path ([Environment]::GetFolderPath('Programs')) 'ForgeMind Native Client.lnk'
    foreach ($shortcutPath in @($desktop, $startMenu)) {
        $shortcutObject = $shell.CreateShortcut($shortcutPath)
        $shortcutObject.TargetPath = Join-Path $installRoot 'ForgeMind-U1.exe'
        $shortcutObject.WorkingDirectory = $installRoot
        $shortcutObject.Description = $appName
        $shortcutObject.Save()
    }

    if (-not $TestOnly) {
        $uninstallKey = 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\ForgeMindNativeClient'
        New-Item -Path $uninstallKey -Force | Out-Null
        New-ItemProperty -Path $uninstallKey -Name DisplayName -Value $appName -PropertyType String -Force | Out-Null
        New-ItemProperty -Path $uninstallKey -Name InstallLocation -Value $installRoot -PropertyType String -Force | Out-Null
        New-ItemProperty -Path $uninstallKey -Name UninstallString -Value "powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File `"$uninstaller`"" -PropertyType String -Force | Out-Null
        New-ItemProperty -Path $uninstallKey -Name Publisher -Value 'ForgeMind' -PropertyType String -Force | Out-Null
    }

    if (-not $TestOnly) { Start-Process -FilePath (Join-Path $installRoot 'ForgeMind-U1.exe') -WorkingDirectory $installRoot }
}
finally {
    if (Test-Path -LiteralPath $extractRoot) { Remove-Item -LiteralPath $extractRoot -Recurse -Force -ErrorAction SilentlyContinue }
}
