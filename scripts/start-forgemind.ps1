[CmdletBinding()]
param(
    [switch]$IncludeAI,
    [switch]$UseLocalQwen,
    [switch]$IncludeSpring,
    [switch]$SkipSpring,
    [switch]$IncludeVoiceChat,
    [switch]$NoBrowser,
    [switch]$ForceRebuild,
    [switch]$SkipMySql,
    [switch]$SkipForgeHub,
    [ValidateRange(1, 65535)]
    [int]$Port = 5173
)

$ErrorActionPreference = 'Stop'
$rootPath = Split-Path -Parent $PSScriptRoot
$aiPath = Join-Path $rootPath 'ai-service'
$voicePath = Join-Path $rootPath 'voice-chat'
$forgeHubPath = Join-Path $rootPath 'forgemind-resource-hub'
$btPath = if ($env:FORGEMIND_BT_TTS_ROOT) { $env:FORGEMIND_BT_TTS_ROOT } else { 'D:\local\bt7274-space' }
$composeFile = Join-Path $rootPath 'docker-compose.yml'
$logPath = Join-Path $rootPath '.forgemind\logs'
$startSpring = $IncludeSpring -and -not $SkipSpring
$startAI = $IncludeAI -or $IncludeVoiceChat
$startForgeHub = $startSpring -and -not $SkipForgeHub

# The frontend uses the rule path unless AI is explicitly requested.
$env:VITE_AI_ENABLED = if ($startAI) { 'true' } else { 'false' }
$env:VITE_AI_BASE_URL = 'http://127.0.0.1:8000'
$env:VITE_FORGEHUB_URL = 'http://127.0.0.1:3000/'
$env:FORGEMIND_VOICE_ENABLED = if ($IncludeVoiceChat) { 'true' } else { 'false' }
if ($UseLocalQwen) {
    $env:FORGEMIND_LLM_PROVIDER = 'ollama'
    if (-not $env:FORGEMIND_OLLAMA_MODEL) { $env:FORGEMIND_OLLAMA_MODEL = 'qwen2.5:7b' }
    if (-not $env:FORGEMIND_OLLAMA_BASE_URL) { $env:FORGEMIND_OLLAMA_BASE_URL = 'http://127.0.0.1:11434' }
} elseif (-not $env:FORGEMIND_LLM_PROVIDER) {
    $env:FORGEMIND_LLM_PROVIDER = 'rule'
}

$script:stageTotal = 1 + $(if ($startSpring) { 2 } else { 0 }) + $(if ($startAI) { 1 } else { 0 }) + $(if ($IncludeVoiceChat) { 1 } else { 0 }) + $(if ($startForgeHub) { 1 } else { 0 })
$script:completedStages = 0
$script:stageStart = 0
$script:stageEnd = 100
$script:currentPercent = 0
$script:currentStage = 'Preparing'

function Show-StartupProgress {
    param(
        [int]$Percent,
        [string]$Stage,
        [string]$Detail = ''
    )

    $safePercent = [math]::Max(0, [math]::Min(100, $Percent))
    $width = 64
    $filled = [int][math]::Floor($width * $safePercent / 100)
    $bar = ('#' * $filled) + ('-' * ($width - $filled))
    $script:currentPercent = $safePercent
    $script:currentStage = $Stage

    try { Clear-Host } catch { }
    Write-Host 'ForgeMind STARTUP' -ForegroundColor Cyan
    Write-Host 'Single-console launcher / background services use hidden workers' -ForegroundColor DarkGray
    Write-Host ''
    Write-Host ("  [{0}] {1,3}%" -f $bar, $safePercent) -ForegroundColor $(if ($safePercent -eq 100) { 'Green' } else { 'Yellow' })
    Write-Host ''
    Write-Host ("  STAGE   {0}" -f $Stage) -ForegroundColor White
    if ($Detail) { Write-Host ("  DETAIL  {0}" -f $Detail) -ForegroundColor DarkGray }
}

function Start-Stage {
    param([string]$Name, [string]$Detail = '')
    $script:stageStart = [int][math]::Floor(100 * $script:completedStages / $script:stageTotal)
    $script:stageEnd = [int][math]::Floor(100 * ($script:completedStages + 1) / $script:stageTotal)
    Set-StageProgress -Fraction 0 -Stage $Name -Detail $Detail
}

function Set-StageProgress {
    param(
        [int]$Fraction,
        [string]$Stage = $script:currentStage,
        [string]$Detail = ''
    )
    $safeFraction = [math]::Max(0, [math]::Min(100, $Fraction))
    $percent = $script:stageStart + [int][math]::Floor(($script:stageEnd - $script:stageStart) * $safeFraction / 100)
    Show-StartupProgress -Percent $percent -Stage $Stage -Detail $Detail
}

function Complete-Stage {
    param([string]$Name, [string]$Detail = 'Ready')
    Set-StageProgress -Fraction 100 -Stage $Name -Detail $Detail
    $script:completedStages++
}

function Test-LocalPort([int]$PortNumber) {
    $client = [System.Net.Sockets.TcpClient]::new()
    try {
        $async = $client.BeginConnect('127.0.0.1', $PortNumber, $null, $null)
        if (-not $async.AsyncWaitHandle.WaitOne(500)) { return $false }
        $client.EndConnect($async)
        return $true
    } catch {
        return $false
    } finally {
        $client.Dispose()
    }
}

function Test-HttpEndpoint([string]$Uri, [int]$TimeoutSec = 3) {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri $Uri -TimeoutSec $TimeoutSec
        return ([int]$response.StatusCode -ge 200 -and [int]$response.StatusCode -lt 500)
    } catch {
        return $false
    }
}

function Wait-HttpEndpoint {
    param(
        [string]$Uri,
        [int]$Seconds,
        [string]$Stage,
        [string]$ReadyDetail
    )
    for ($index = 0; $index -lt $Seconds; $index++) {
        if (Test-HttpEndpoint -Uri $Uri) {
            Set-StageProgress -Fraction 100 -Stage $Stage -Detail $ReadyDetail
            return $true
        }
        $fraction = [int][math]::Floor(100 * ($index + 1) / $Seconds)
        Set-StageProgress -Fraction $fraction -Stage $Stage -Detail ("Waiting for {0} ({1}/{2}s)" -f $Uri, ($index + 1), $Seconds)
        Start-Sleep -Seconds 1
    }
    return $false
}

function Test-ForgeHubEndpoint([string]$Uri) {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri $Uri -TimeoutSec 3
        return ([int]$response.StatusCode -ge 200 -and [int]$response.StatusCode -lt 500 -and $response.Content -match 'FORGEPASS / FORGEHUB')
    } catch {
        return $false
    }
}

function Wait-ForgeHubEndpoint {
    param([string]$Uri, [int]$Seconds = 180)
    for ($index = 0; $index -lt $Seconds; $index++) {
        if (Test-ForgeHubEndpoint $Uri) {
            Set-StageProgress -Fraction 100 -Stage 'ForgeHub Web CAD' -Detail 'Authenticated CAD workbench is ready on port 3000'
            return $true
        }
        $fraction = [int][math]::Floor(100 * ($index + 1) / $Seconds)
        Set-StageProgress -Fraction $fraction -Stage 'ForgeHub Web CAD' -Detail ("Waiting for authenticated workbench ({0}/{1}s)" -f ($index + 1), $Seconds)
        Start-Sleep -Seconds 1
    }
    return $false
}

function Wait-LocalPort {
    param(
        [int]$PortNumber,
        [int]$Seconds,
        [string]$Stage,
        [string]$ReadyDetail
    )
    for ($index = 0; $index -lt $Seconds; $index++) {
        if (Test-LocalPort $PortNumber) {
            Set-StageProgress -Fraction 100 -Stage $Stage -Detail $ReadyDetail
            return $true
        }
        $fraction = [int][math]::Floor(100 * ($index + 1) / $Seconds)
        Set-StageProgress -Fraction $fraction -Stage $Stage -Detail ("Waiting for port {0} ({1}/{2}s)" -f $PortNumber, ($index + 1), $Seconds)
        Start-Sleep -Seconds 1
    }
    return $false
}

function Wait-VoiceProcessReady {
    param(
        [System.Diagnostics.Process]$Process,
        [int]$Seconds = 90
    )
    $readyLog = Join-Path $logPath 'voice-chat.out.log'
    for ($index = 0; $index -lt $Seconds; $index++) {
        $Process.Refresh()
        if ($Process.HasExited) { throw 'voice-chat exited during startup. See .forgemind/logs/voice-chat.*.log.' }
        $output = ''
        if (Test-Path -LiteralPath $readyLog) {
            try { $output = Get-Content -LiteralPath $readyLog -Raw -ErrorAction Stop } catch { $output = '' }
        }
        if ($output -match 'FORGEMIND_VOICE_READY') {
            Set-StageProgress -Fraction 100 -Stage 'Voice' -Detail 'Standalone voice listener is ready'
            return $true
        }
        $fraction = [int][math]::Floor(100 * ($index + 1) / $Seconds)
        Set-StageProgress -Fraction $fraction -Stage 'Voice' -Detail ("Loading standalone voice listener ({0}/{1}s)" -f ($index + 1), $Seconds)
        Start-Sleep -Seconds 1
    }
    return $false
}

function Wait-AiVoiceReadiness {
    param([int]$Seconds = 180)
    for ($index = 0; $index -lt $Seconds; $index++) {
        $readiness = $null
        try {
            $readiness = Invoke-RestMethod -Uri 'http://127.0.0.1:8000/api/ai/readiness' -TimeoutSec 5
        } catch {
            $readiness = $null
        }
        if ($readiness -and $readiness.ready -eq $true) {
            Set-StageProgress -Fraction 100 -Stage 'AI Gateway' -Detail 'ASR/TTS models are loaded and ready'
            return $true
        }
        if ($readiness -and $readiness.status -eq 'error') {
            throw ("Voice preload failed: {0}" -f $readiness.error)
        }
        $fraction = 60 + [int][math]::Floor(40 * ($index + 1) / $Seconds)
        Set-StageProgress -Fraction $fraction -Stage 'AI Gateway' -Detail ("Loading ASR/TTS models ({0}/{1}s)" -f ($index + 1), $Seconds)
        Start-Sleep -Seconds 1
    }
    return $false
}

function Get-MySqlHealth([string]$DockerPath) {
    if (-not $DockerPath) { return $null }
    $status = & $DockerPath inspect --format '{{.State.Health.Status}}' forgemind-mysql 2>$null
    if ($LASTEXITCODE -ne 0) { return $null }
    return ($status | Out-String).Trim()
}

function Wait-MySqlHealthy([string]$DockerPath, [int]$Seconds = 60) {
    for ($index = 0; $index -lt $Seconds; $index++) {
        if ((Get-MySqlHealth $DockerPath) -eq 'healthy') {
            Set-StageProgress -Fraction 100 -Stage 'MySQL' -Detail 'Docker container is healthy'
            return $true
        }
        $fraction = [int][math]::Floor(100 * ($index + 1) / $Seconds)
        Set-StageProgress -Fraction $fraction -Stage 'MySQL' -Detail ("Waiting for healthy container ({0}/{1}s)" -f ($index + 1), $Seconds)
        Start-Sleep -Seconds 1
    }
    return $false
}

function Start-BackgroundCommand {
    param(
        [string]$Name,
        [string]$WorkingDirectory,
        [string]$Executable,
        [string]$Arguments
    )

    New-Item -ItemType Directory -Force -Path $logPath | Out-Null
    $stdoutPath = Join-Path $logPath ("{0}.out.log" -f $Name)
    $stderrPath = Join-Path $logPath ("{0}.err.log" -f $Name)
    $extension = [IO.Path]::GetExtension($Executable).ToLowerInvariant()
    if ($extension -eq '.cmd' -or $extension -eq '.bat') {
        $commandLine = ('"{0}" {1}' -f $Executable, $Arguments)
        $process = Start-Process -FilePath $env:ComSpec -ArgumentList @('/d', '/c', $commandLine) -WorkingDirectory $WorkingDirectory -WindowStyle Hidden -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru
    } else {
        $process = Start-Process -FilePath $Executable -ArgumentList $Arguments -WorkingDirectory $WorkingDirectory -WindowStyle Hidden -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru
    }
    return $process
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

function Invoke-Startup {
    Show-StartupProgress -Percent 0 -Stage 'Preparing' -Detail 'Checking local dependencies'

    $vitePath = Resolve-Executable @(
        (Join-Path $rootPath 'node_modules\.bin\vite.cmd'),
        (Join-Path $rootPath 'node_modules\.bin\vite.ps1')
    )
    if (-not $vitePath) { throw 'Vite is missing. Run npm install in the project root.' }
    $nodePath = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
    $viteEntry = Join-Path $rootPath 'node_modules\vite\bin\vite.js'

    if ($startSpring) {
        Start-Stage -Name 'MySQL' -Detail 'Preparing database service'
        if ($SkipMySql) {
            Complete-Stage -Name 'MySQL' -Detail 'Skipped by -SkipMySql; using an existing database'
        } else {
            $dockerPath = (Get-Command docker.exe -ErrorAction SilentlyContinue).Source
            if (-not $dockerPath) { throw 'Docker CLI is missing. Start Docker Desktop or use -SkipMySql.' }
            if (-not (Test-Path -LiteralPath $composeFile)) { throw ("Docker Compose file is missing: {0}" -f $composeFile) }
            Set-StageProgress -Fraction 5 -Stage 'MySQL' -Detail 'Starting Docker container'
            # Docker Compose may write normal progress/status lines to stderr. Do not let
            # the script-wide ErrorActionPreference=Stop turn "Container ... Running"
            # into a startup failure before we can inspect the native exit code.
            $composeErrorAction = $ErrorActionPreference
            try {
                $ErrorActionPreference = 'Continue'
                $composeOutput = & $dockerPath compose -f $composeFile up -d mysql 2>&1
                $composeExitCode = $LASTEXITCODE
            } finally {
                $ErrorActionPreference = $composeErrorAction
            }
            if ($composeExitCode -ne 0) {
                $composeError = ($composeOutput | Out-String).Trim()
                if (-not $composeError) { $composeError = 'Check Docker Desktop.' }
                throw ("MySQL container failed to start: {0}" -f $composeError)
            }
            if (-not (Wait-MySqlHealthy -DockerPath $dockerPath -Seconds 60)) { throw 'MySQL did not become healthy within 60 seconds.' }
            Complete-Stage -Name 'MySQL'
        }

        Start-Stage -Name 'Spring Boot' -Detail 'Preparing authenticated persistence API'
        if (Test-HttpEndpoint 'http://127.0.0.1:8080/api/factory/health') {
            Complete-Stage -Name 'Spring Boot' -Detail 'Reused healthy service on port 8080'
        } else {
            $jarPath = Join-Path $rootPath 'backend\target\forgemind-backend-0.1.0.jar'
            $javaPath = (Get-Command java.exe -ErrorAction SilentlyContinue).Source
            if ($javaPath -and (Test-Path -LiteralPath $jarPath)) {
                $null = Start-BackgroundCommand -Name 'spring' -WorkingDirectory (Join-Path $rootPath 'backend') -Executable $javaPath -Arguments (('-jar "{0}"' -f $jarPath))
            } elseif ($ForceRebuild) {
                $mvnPath = (Get-Command mvn.cmd -ErrorAction SilentlyContinue).Source
                if (-not $mvnPath) { throw 'Maven is missing and the backend JAR is unavailable.' }
                $null = Start-BackgroundCommand -Name 'spring' -WorkingDirectory (Join-Path $rootPath 'backend') -Executable $mvnPath -Arguments 'spring-boot:run'
            } else {
                throw 'Backend JAR is missing. Build it first or use -ForceRebuild.'
            }
            if (-not (Wait-HttpEndpoint -Uri 'http://127.0.0.1:8080/api/factory/health' -Seconds 90 -Stage 'Spring Boot' -ReadyDetail 'Healthy API on port 8080')) {
                throw 'Spring Boot did not become healthy within 90 seconds. See .forgemind/logs/spring.*.log.'
            }
            Complete-Stage -Name 'Spring Boot'
        }
    }

    if ($startAI) {
        Start-Stage -Name 'AI Gateway' -Detail $(if ($UseLocalQwen) { 'Starting local Qwen 2.5:7b AI gateway' } else { 'Starting optional rule/remote AI gateway' })
        $aiPython = Resolve-PythonExecutable @((Join-Path $aiPath '.venv\Scripts\python.exe'))
        if (-not $aiPython) { throw 'ai-service Python environment is missing. Create ai-service\.venv and install requirements-core.txt.' }
        if (-not (Test-HttpEndpoint 'http://127.0.0.1:8000/api/ai/health')) {
            $null = Start-BackgroundCommand -Name 'ai-service' -WorkingDirectory $aiPath -Executable $aiPython -Arguments '-m uvicorn main:app --host 127.0.0.1 --port 8000'
            if (-not (Wait-HttpEndpoint -Uri 'http://127.0.0.1:8000/api/ai/health' -Seconds 30 -Stage 'AI Gateway' -ReadyDetail 'Healthy API on port 8000')) {
                throw 'AI gateway did not become healthy within 30 seconds. See .forgemind/logs/ai-service.*.log.'
            }
        }
        if ($UseLocalQwen) {
            try {
                $aiHealth = Invoke-RestMethod -Uri 'http://127.0.0.1:8000/api/ai/health' -TimeoutSec 5
                if ($aiHealth.llm.provider -ne 'ollama') {
                    throw ("port 8000 is already running with provider '{0}'; stop it and retry -UseLocalQwen" -f $aiHealth.llm.provider)
                }
            } catch {
                throw ("Local Qwen mode was requested but the AI gateway is not using Ollama: {0}" -f $_.Exception.Message)
            }
        }
        if ($IncludeVoiceChat -and -not (Wait-AiVoiceReadiness -Seconds 180)) {
            throw 'ASR/TTS models did not finish loading within 180 seconds. See .forgemind/logs/ai-service.*.log.'
        }
        Complete-Stage -Name 'AI Gateway' -Detail $(if ($UseLocalQwen) { 'Healthy; Ollama Qwen 2.5:7b selected' } else { 'Healthy; local LLM remains optional' })
    }

    if ($IncludeVoiceChat) {
        Start-Stage -Name 'Voice' -Detail 'Starting optional voice services'
        $btPython = Resolve-Executable @(
            (Join-Path $btPath 'venv\Scripts\python.exe'),
            (Join-Path $btPath 'venv\Scripts\python3.exe')
        )
        $btScript = Join-Path $btPath 'bt_tts_server.py'
        if (-not $btPython -or -not (Test-Path -LiteralPath $btScript)) {
            throw ("BT TTS is unavailable at {0}. Install it or omit -IncludeVoiceChat." -f $btPath)
        }
        if (-not (Test-LocalPort 8001)) {
            $null = Start-BackgroundCommand -Name 'bt-tts' -WorkingDirectory $btPath -Executable $btPython -Arguments 'bt_tts_server.py'
        }
        if (-not (Wait-HttpEndpoint -Uri 'http://127.0.0.1:8001/health' -Seconds 45 -Stage 'Voice' -ReadyDetail 'BT TTS health endpoint is ready on port 8001')) {
            throw 'BT TTS health endpoint did not become ready on port 8001 within 45 seconds. See .forgemind/logs/bt-tts.*.log.'
        }
        $voicePython = Resolve-Executable @((Join-Path $voicePath 'venv\Scripts\python.exe'))
        $voiceScript = Join-Path $voicePath 'voice_chat.py'
        if (-not $voicePython -or -not (Test-Path -LiteralPath $voiceScript)) {
            throw 'voice-chat environment is missing. Install it or omit -IncludeVoiceChat.'
        }
        $existingVoice = Get-CimInstance Win32_Process | Where-Object {
            $_.CommandLine -and $_.CommandLine -match 'voice_chat\.py'
        } | Select-Object -First 1
        if ($existingVoice) {
            Complete-Stage -Name 'Voice' -Detail 'BT TTS and voice-chat are already running'
        } else {
            $voiceProcess = Start-BackgroundCommand -Name 'voice-chat' -WorkingDirectory $voicePath -Executable $voicePython -Arguments 'voice_chat.py'
            if (-not (Wait-VoiceProcessReady -Process $voiceProcess -Seconds 90)) {
                throw 'Standalone voice listener did not become ready within 90 seconds. See .forgemind/logs/voice-chat.*.log.'
            }
            Complete-Stage -Name 'Voice' -Detail 'BT TTS and voice-chat started in the background'
        }
    }

    if ($startForgeHub) {
        Start-Stage -Name 'ForgeHub Web CAD' -Detail 'Starting authenticated resource and CAD workbench'
        $forgeHubLauncher = Join-Path $forgeHubPath 'START_FORGEMIND_DEV.ps1'
        if (-not (Test-Path -LiteralPath $forgeHubLauncher)) { throw ("ForgeHub launcher is missing: {0}" -f $forgeHubLauncher) }
        $forgeHubUri = 'http://127.0.0.1:3000/'
        if (-not (Test-ForgeHubEndpoint $forgeHubUri)) {
            $hostPowerShell = (Get-Process -Id $PID).Path
            $null = Start-BackgroundCommand -Name 'forgehub' -WorkingDirectory $forgeHubPath -Executable $hostPowerShell -Arguments (('-NoLogo -NoProfile -ExecutionPolicy Bypass -File "{0}" -NoBrowser -Port 3000' -f $forgeHubLauncher))
        }
        if (-not (Wait-ForgeHubEndpoint -Uri $forgeHubUri -Seconds 180)) {
            throw 'ForgeHub did not become healthy within 180 seconds. See .forgemind/logs/forgehub.*.log.'
        }
        Complete-Stage -Name 'ForgeHub Web CAD' -Detail 'Ready at http://127.0.0.1:3000/'
    }

    Start-Stage -Name 'ForgeMind Frontend' -Detail ("Starting Vite on port {0}" -f $Port)
    $frontendUri = "http://127.0.0.1:{0}/" -f $Port
    if (-not (Test-HttpEndpoint $frontendUri)) {
        if ($nodePath -and (Test-Path -LiteralPath $viteEntry)) {
            $null = Start-BackgroundCommand -Name 'frontend' -WorkingDirectory $rootPath -Executable $nodePath -Arguments ((('"{0}" --host 127.0.0.1 --port {1}') -f $viteEntry, $Port))
        } else {
            $null = Start-BackgroundCommand -Name 'frontend' -WorkingDirectory $rootPath -Executable $vitePath -Arguments (('--host 127.0.0.1 --port {0}' -f $Port))
        }
    }
    if (-not (Wait-HttpEndpoint -Uri $frontendUri -Seconds 30 -Stage 'ForgeMind Frontend' -ReadyDetail ("Healthy web app on port {0}" -f $Port))) {
        throw ("Frontend did not become healthy within 30 seconds. See .forgemind/logs/frontend.*.log." )
    }
    Complete-Stage -Name 'ForgeMind Frontend' -Detail ("Ready at {0}" -f $frontendUri)
}

try {
    Invoke-Startup
    Show-StartupProgress -Percent 100 -Stage 'SYSTEM READY' -Detail 'All requested services are healthy. The application is ready to use.'
    Write-Host ''
    Write-Host ("  Frontend : http://127.0.0.1:{0}" -f $Port) -ForegroundColor Green
    if ($startSpring) { Write-Host '  Spring   : http://127.0.0.1:8080/api/factory/health' -ForegroundColor Green }
    if ($startAI) { Write-Host '  AI       : http://127.0.0.1:8000/api/ai/health' -ForegroundColor Green }
    if ($IncludeVoiceChat) { Write-Host '  BT TTS   : http://127.0.0.1:8001/health' -ForegroundColor Green }
    if ($startForgeHub) { Write-Host '  ForgeHub : http://127.0.0.1:3000/' -ForegroundColor Green }
    Write-Host ("  Logs     : {0}" -f $logPath) -ForegroundColor DarkGray
    if (-not $NoBrowser) { Start-Process ("http://127.0.0.1:{0}" -f $Port) }
    exit 0
} catch {
    Show-StartupProgress -Percent $script:currentPercent -Stage 'STARTUP FAILED' -Detail $_.Exception.Message
    Write-Host ''
    Write-Host 'Startup stopped before 100%. Review the error above and the logs directory.' -ForegroundColor Red
    Write-Host ("Logs: {0}" -f $logPath) -ForegroundColor DarkGray
    exit 1
}
