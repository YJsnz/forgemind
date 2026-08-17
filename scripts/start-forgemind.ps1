[CmdletBinding()]
param(
    [switch]$IncludeSpring,
    [switch]$SkipSpring,
    [switch]$IncludeVoiceChat,
    [switch]$NoBrowser,
    [switch]$ForceRebuild
)

$ErrorActionPreference = 'Stop'
$rootPath = Split-Path -Parent $PSScriptRoot
$aiPath = Join-Path $rootPath 'ai-service'
$voicePath = Join-Path $rootPath 'voice-chat'
$btPath = if ($env:FORGEMIND_BT_TTS_ROOT) { $env:FORGEMIND_BT_TTS_ROOT } else { 'D:\local\bt7274-space' }
$ollamaModelsPath = if ($env:FORGEMIND_OLLAMA_MODELS) { $env:FORGEMIND_OLLAMA_MODELS } else { 'D:\local\ollama\models' }

function Test-LocalPort([int]$port) {
    return [bool](Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
}

function Wait-LocalPort([int]$port, [int]$seconds = 30) {
    for ($index = 0; $index -lt $seconds; $index++) {
        if (Test-LocalPort $port) { return $true }
        Start-Sleep -Seconds 1
    }
    return $false
}

function Start-VisibleCommand {
    param(
        [string]$Title,
        [string]$WorkingDirectory,
        [string]$Executable,
        [string]$Arguments
    )

    $cleanTitle = $Title.Replace('"', '')
    $command = "title $cleanTitle && cd /d `"$WorkingDirectory`" && `"$Executable`" $Arguments"
    Start-Process -FilePath 'cmd.exe' -ArgumentList @('/k', $command) -WorkingDirectory $WorkingDirectory | Out-Null
}

function Resolve-Executable([string[]]$Candidates) {
    foreach ($candidate in $Candidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate)) { return (Resolve-Path -LiteralPath $candidate).Path }
    }
    return $null
}

function Wait-OllamaModel {
    $warmBody = @{ model = 'qwen2.5:7b'; messages = @(); stream = $false; keep_alive = '30m' } | ConvertTo-Json -Compress
    try {
        Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/chat' -Method Post -ContentType 'application/json' -Body $warmBody -TimeoutSec 120 | Out-Null
        return $true
    } catch {
        Write-Warning "Qwen 预热失败：$($_.Exception.Message)"
        return $false
    }
}

Write-Host 'ForgeMind 一键启动' -ForegroundColor Cyan
Write-Host "项目目录: $rootPath"

$pythonPath = Resolve-Executable @(
    (Join-Path $aiPath '.venv\Scripts\python.exe'),
    (Join-Path $voicePath 'venv\Scripts\python.exe')
)
if (-not $pythonPath) { throw '找不到 Python 3.10：请先创建 ai-service\.venv。' }

$vitePath = Resolve-Executable @(
    (Join-Path $rootPath 'node_modules\.bin\vite.cmd'),
    (Join-Path $rootPath 'node_modules\.bin\vite.ps1')
)
if (-not $vitePath) { throw '找不到 Vite，请先在项目根目录执行 npm install。' }

$ollamaPath = Resolve-Executable @(
    $env:FORGEMIND_OLLAMA_EXE,
    "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe",
    "$env:ProgramFiles\Ollama\ollama.exe",
    (Get-Command ollama.exe -ErrorAction SilentlyContinue).Source
)
$env:OLLAMA_FLASH_ATTENTION = '1'
if (-not (Test-LocalPort 11434)) {
    if (-not $ollamaPath) { throw '找不到 Ollama，请安装 Ollama。' }
    $env:OLLAMA_MODELS = $ollamaModelsPath
    Write-Host '[1/4] 启动 Ollama...' -ForegroundColor Yellow
    Start-Process -FilePath $ollamaPath -ArgumentList 'serve' -WorkingDirectory $rootPath -WindowStyle Normal | Out-Null
    if (-not (Wait-LocalPort 11434 45)) { throw 'Ollama 在 45 秒内没有监听 11434。' }
} else { Write-Host '[1/4] Ollama 已运行，复用 11434。' -ForegroundColor DarkGray }

Write-Host '[1.5/4] 预热 Qwen2.5:7b（首次启动会占用几秒，完成后保持 GPU 常驻）...' -ForegroundColor Yellow
if (Wait-OllamaModel) { Write-Host 'Qwen2.5:7b 已加载。' -ForegroundColor Green }

$btPython = Resolve-Executable @(
    (Join-Path $btPath 'venv\Scripts\python.exe'),
    (Join-Path $btPath 'venv\Scripts\python3.exe')
)
$btScript = Join-Path $btPath 'bt_tts_server.py'
if (-not (Test-LocalPort 8001)) {
    if (-not (Test-Path -LiteralPath $btScript) -or -not $btPython) {
        Write-Warning "找不到 BT TTS（$btPath），AI 服务会在需要时回退到 sherpa VITS。"
    } else {
        Write-Host '[2/4] 启动 BT-7274 TTS...' -ForegroundColor Yellow
        Start-VisibleCommand -Title 'ForgeMind - BT-7274 TTS' -WorkingDirectory $btPath -Executable $btPython -Arguments 'bt_tts_server.py'
        if (-not (Wait-LocalPort 8001 45)) { Write-Warning 'BT TTS 未在 45 秒内就绪，将使用 sherpa 备用音色。' }
    }
} else { Write-Host '[2/4] BT-7274 TTS 已运行，复用 8001。' -ForegroundColor DarkGray }

$aiPython = Resolve-Executable @((Join-Path $aiPath '.venv\Scripts\python.exe'))
if (-not $aiPython) { throw '找不到 ai-service\.venv\Scripts\python.exe，请先安装 AI 服务依赖。' }
if (-not (Test-LocalPort 8000)) {
    Write-Host '[3/4] 启动 FastAPI AI 服务...' -ForegroundColor Yellow
    Start-VisibleCommand -Title 'ForgeMind - AI Service' -WorkingDirectory $aiPath -Executable $aiPython -Arguments '-m uvicorn main:app --host 127.0.0.1 --port 8000 --reload'
    if (-not (Wait-LocalPort 8000 30)) { throw 'AI 服务在 30 秒内没有监听 8000。' }
} else { Write-Host '[3/4] AI 服务已运行，复用 8000。' -ForegroundColor DarkGray }

$startSpring = -not $SkipSpring
if ($startSpring -and -not (Test-LocalPort 8080)) {
    $jarPath = Join-Path $rootPath 'backend\target\forgemind-backend-0.1.0.jar'
    $javaPath = (Get-Command java.exe -ErrorAction SilentlyContinue).Source
    if (-not $javaPath) { Write-Warning '找不到 Java，跳过 Spring Boot 8080。' }
    elseif (Test-Path -LiteralPath $jarPath) {
        Start-VisibleCommand -Title 'ForgeMind - Spring Boot' -WorkingDirectory (Join-Path $rootPath 'backend') -Executable $javaPath -Arguments "-jar `"$jarPath`""
        if (-not (Wait-LocalPort 8080 30)) { Write-Warning 'Spring Boot 未在 30 秒内就绪。' }
    } elseif ($ForceRebuild) {
        $mvnPath = (Get-Command mvn.cmd -ErrorAction SilentlyContinue).Source
        if ($mvnPath) { Start-VisibleCommand -Title 'ForgeMind - Spring Boot' -WorkingDirectory (Join-Path $rootPath 'backend') -Executable $mvnPath -Arguments 'spring-boot:run' }
        else { Write-Warning '找不到 Maven，跳过 Spring Boot。' }
    } else { Write-Warning '找不到后端 JAR，使用 -ForceRebuild 通过 Maven 启动。' }
} elseif ($startSpring) { Write-Host '[3.5/4] Spring Boot 已运行，复用 8080。' -ForegroundColor DarkGray }

if ($IncludeVoiceChat) {
    $voicePython = Resolve-Executable @((Join-Path $voicePath 'venv\Scripts\python.exe'))
    $voiceScript = Join-Path $voicePath 'voice_chat.py'
    if ($voicePython -and (Test-Path -LiteralPath $voiceScript)) { Start-VisibleCommand -Title 'ForgeMind - Voice Chat Console' -WorkingDirectory $voicePath -Executable $voicePython -Arguments 'voice_chat.py' }
    else { Write-Warning '找不到 voice-chat 虚拟环境，跳过独立语音助手。' }
}

if (-not (Test-LocalPort 5173)) {
    Write-Host '[4/4] 启动 ForgeMind 前端...' -ForegroundColor Yellow
    Start-VisibleCommand -Title 'ForgeMind - Frontend' -WorkingDirectory $rootPath -Executable $vitePath -Arguments '--host 127.0.0.1'
    if (-not (Wait-LocalPort 5173 30)) { throw '前端在 30 秒内没有监听 5173。' }
} else { Write-Host '[4/4] 前端已运行，复用 5173。' -ForegroundColor DarkGray }

Write-Host ''
Write-Host 'ForgeMind 已启动：' -ForegroundColor Green
Write-Host '  前端:   http://127.0.0.1:5173'
Write-Host '  AI:     http://127.0.0.1:8000/api/ai/health'
Write-Host '  BT TTS: http://127.0.0.1:8001/health'
if ($startSpring) { Write-Host '  Spring: http://127.0.0.1:8080' }
if (-not $NoBrowser) { Start-Process 'http://127.0.0.1:5173' }
