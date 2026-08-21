[CmdletBinding()]
param(
    # 保留该开关与文档/voice-chat 启动脚本兼容；当前一键启动默认包含 AI 服务。
    [switch]$IncludeAI,
    [switch]$IncludeSpring,
    [switch]$SkipSpring,
    [switch]$IncludeVoiceChat,
    [switch]$NoBrowser,
    [switch]$ForceRebuild,
    [switch]$SkipMySql
)

$ErrorActionPreference = 'Stop'
$rootPath = Split-Path -Parent $PSScriptRoot
$aiPath = Join-Path $rootPath 'ai-service'
$voicePath = Join-Path $rootPath 'voice-chat'
$btPath = if ($env:FORGEMIND_BT_TTS_ROOT) { $env:FORGEMIND_BT_TTS_ROOT } else { 'D:\local\bt7274-space' }
$ollamaModelsPath = if ($env:FORGEMIND_OLLAMA_MODELS) { $env:FORGEMIND_OLLAMA_MODELS } else { 'D:\local\ollama\models' }
$ollamaModel = if ($env:FORGEMIND_OLLAMA_MODEL) { $env:FORGEMIND_OLLAMA_MODEL } else { 'qwen2.5:7b' }
$composeFile = Join-Path $rootPath 'docker-compose.yml'

# Vite 在构建/启动时读取 VITE_* 环境变量。若不在启动前注入，
# AssistantVoiceButton 会把语音和关键字唤醒入口判断为未启用，即使
# FastAPI 已经监听 8000 端口也无法使用。
$env:VITE_AI_ENABLED = 'true'
$env:VITE_AI_BASE_URL = 'http://127.0.0.1:8000'
$env:FORGEMIND_VOICE_ENABLED = 'true'

function Test-LocalPort([int]$port) {
    $client = [System.Net.Sockets.TcpClient]::new()
    try {
        $async = $client.BeginConnect('127.0.0.1', $port, $null, $null)
        if (-not $async.AsyncWaitHandle.WaitOne(500)) { return $false }
        $client.EndConnect($async)
        return $true
    } catch {
        return $false
    } finally {
        $client.Dispose()
    }
}

function Wait-LocalPort([int]$port, [int]$seconds = 30) {
    for ($index = 0; $index -lt $seconds; $index++) {
        if (Test-LocalPort $port) { return $true }
        Start-Sleep -Seconds 1
    }
    return $false
}

function Get-MySqlHealth([string]$dockerPath) {
    if (-not $dockerPath) { return $null }
    $status = & $dockerPath inspect --format '{{.State.Health.Status}}' forgemind-mysql 2>$null
    if ($LASTEXITCODE -ne 0) { return $null }
    return ($status | Out-String).Trim()
}

function Wait-MySqlHealthy([string]$dockerPath, [int]$seconds = 60) {
    for ($index = 0; $index -lt $seconds; $index++) {
        if ((Get-MySqlHealth $dockerPath) -eq 'healthy') { return $true }
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

function Test-PythonExecutable([string]$Candidate) {
    if (-not $Candidate -or -not (Test-Path -LiteralPath $Candidate)) { return $false }
    try {
        & $Candidate -c 'import sys; print(sys.version_info[:2])' 1>$null 2>$null
        return $LASTEXITCODE -eq 0
    } catch {
        return $false
    }
}

function Resolve-PythonExecutable([string[]]$Candidates) {
    foreach ($candidate in $Candidates) {
        if ($candidate -and (Test-PythonExecutable $candidate)) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }
    return $null
}

function Test-OllamaModel([string]$Model) {
    try {
        $tags = Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/tags' -TimeoutSec 5
        $prefix = "$Model" + ':'
        return @($tags.models | Where-Object { $_.name -eq $Model -or $_.name.StartsWith($prefix) }).Count -gt 0
    } catch {
        return $false
    }
}

function Stop-OllamaServer {
    foreach ($process in @(Get-Process -Name 'ollama', 'ollama app' -ErrorAction SilentlyContinue)) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    }
    for ($index = 0; $index -lt 15; $index++) {
        if (-not (Test-LocalPort 11434)) { return $true }
        Start-Sleep -Seconds 1
    }
    return $false
}

function Wait-OllamaModel {
    $warmBody = @{ model = $ollamaModel; messages = @(); stream = $false; keep_alive = '30m' } | ConvertTo-Json -Compress
    try {
        Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/chat' -Method Post -ContentType 'application/json' -Body $warmBody -TimeoutSec 120 | Out-Null
        return $true
    } catch {
        Write-Warning "$ollamaModel 预热失败：$($_.Exception.Message)"
        return $false
    }
}

Write-Host 'ForgeMind 一键启动' -ForegroundColor Cyan
Write-Host "项目目录: $rootPath"
$startSpring = -not $SkipSpring

if (-not $SkipMySql -and $startSpring) {
    $dockerPath = (Get-Command docker.exe -ErrorAction SilentlyContinue).Source
    if (-not $dockerPath) { throw '找不到 Docker CLI，请先启动 Docker Desktop，或使用 -SkipMySql。' }
    if (-not (Test-Path -LiteralPath $composeFile)) { throw "找不到 Docker Compose 配置：$composeFile" }
    Write-Host '[0/4] 启动 MySQL 容器...' -ForegroundColor Yellow
    & $dockerPath compose -f $composeFile up -d mysql
    if ($LASTEXITCODE -ne 0) { throw 'MySQL 容器启动失败，请检查 Docker Desktop。' }
    if (-not (Wait-MySqlHealthy $dockerPath 60)) { throw 'MySQL 在 60 秒内没有进入 healthy 状态。' }
    Write-Host 'MySQL 已就绪。' -ForegroundColor Green
} elseif ($SkipMySql) {
    Write-Host '[0/4] 跳过 MySQL（-SkipMySql）。' -ForegroundColor DarkGray
} else {
    Write-Host '[0/4] 跳过 MySQL（-SkipSpring）。' -ForegroundColor DarkGray
}

$pythonPath = Resolve-PythonExecutable @(
    (Join-Path $aiPath '.venv\Scripts\python.exe'),
    (Join-Path $voicePath 'venv\Scripts\python.exe')
)
if (-not $pythonPath) {
    throw '找不到可运行的 Python 环境：请重新创建 ai-service\.venv（旧环境可能仍指向已卸载的 Python 3.10）。'
}

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
$env:OLLAMA_MODELS = $ollamaModelsPath
if (-not (Test-LocalPort 11434)) {
    if (-not $ollamaPath) { throw '找不到 Ollama，请安装 Ollama。' }
    Write-Host '[1/4] 启动 Ollama...' -ForegroundColor Yellow
    Start-Process -FilePath $ollamaPath -ArgumentList 'serve' -WorkingDirectory $rootPath -WindowStyle Normal | Out-Null
    if (-not (Wait-LocalPort 11434 45)) { throw 'Ollama 在 45 秒内没有监听 11434。' }
} elseif (Test-OllamaModel $ollamaModel) {
    Write-Host "[1/4] Ollama 已运行，复用 $ollamaModel。" -ForegroundColor DarkGray
} elseif ((Test-Path -LiteralPath (Join-Path $ollamaModelsPath 'manifests')) -and $ollamaPath) {
    Write-Warning "当前 Ollama 实例找不到 $ollamaModel，正在切换到 $ollamaModelsPath ..."
    if (-not (Stop-OllamaServer)) { throw '无法停止当前 Ollama 服务，无法切换到项目模型目录。' }
    Start-Process -FilePath $ollamaPath -ArgumentList 'serve' -WorkingDirectory $rootPath -WindowStyle Normal | Out-Null
    if (-not (Wait-LocalPort 11434 45)) { throw '切换模型目录后 Ollama 在 45 秒内没有监听 11434。' }
} else {
    Write-Warning "Ollama 已运行，但未找到模型 $ollamaModel；请执行 ollama pull $ollamaModel，或检查 FORGEMIND_OLLAMA_MODELS。"
}

Write-Host "[1.5/4] 预热 $ollamaModel（首次启动会占用几秒，完成后保持 GPU 常驻）..." -ForegroundColor Yellow
if (Wait-OllamaModel) { Write-Host "$ollamaModel 已加载。" -ForegroundColor Green }

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

$aiPython = Resolve-PythonExecutable @((Join-Path $aiPath '.venv\Scripts\python.exe'))
if (-not $aiPython) { throw '找不到可运行的 ai-service\.venv\Scripts\python.exe，请重新创建虚拟环境并安装 AI 服务依赖。' }
if (-not (Test-LocalPort 8000)) {
    Write-Host '[3/4] 启动 FastAPI AI 服务...' -ForegroundColor Yellow
    Start-VisibleCommand -Title 'ForgeMind - AI Service' -WorkingDirectory $aiPath -Executable $aiPython -Arguments '-m uvicorn main:app --host 127.0.0.1 --port 8000 --reload'
    if (-not (Wait-LocalPort 8000 30)) { throw 'AI 服务在 30 秒内没有监听 8000。' }
} else { Write-Host '[3/4] AI 服务已运行，复用 8000。' -ForegroundColor DarkGray }

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
