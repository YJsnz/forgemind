[CmdletBinding()]
param(
    [switch]$StopOllama,
    [switch]$StopMySql
)

$ErrorActionPreference = 'SilentlyContinue'

function Stop-MatchingProcess([string]$pattern) {
    $processes = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine -match $pattern }
    foreach ($process in $processes) {
        Write-Host "停止 PID $($process.ProcessId): $($process.CommandLine)"
        Stop-Process -Id $process.ProcessId -ErrorAction SilentlyContinue
    }
}

Write-Host '停止 ForgeMind 开发服务...'
Stop-MatchingProcess 'uvicorn main:app.*--port 8000'
Stop-MatchingProcess 'vite(\.cmd)?.*--host 127\.0\.0\.1|vite\.js.*--host 127\.0\.0\.1'
Stop-MatchingProcess 'vinext.*--port 3000'
Stop-MatchingProcess 'bt_tts_server\.py'
Stop-MatchingProcess 'voice_chat\.py'
Stop-MatchingProcess 'forgemind-backend-0\.1\.0\.jar'
if ($StopOllama) { Stop-MatchingProcess 'ollama(\.exe)? serve' }

if ($StopMySql) {
    $dockerPath = (Get-Command docker.exe -ErrorAction SilentlyContinue).Source
    $composeFile = Join-Path (Split-Path -Parent $PSScriptRoot) 'docker-compose.yml'
    if ($dockerPath -and (Test-Path -LiteralPath $composeFile)) {
        & $dockerPath compose -f $composeFile stop mysql | Out-Host
        Write-Host 'MySQL 容器已停止（数据卷保留）。' -ForegroundColor DarkGray
    } else {
        Write-Warning '找不到 Docker 或 docker-compose.yml，未停止 MySQL。'
    }
} else {
    Write-Host 'MySQL 默认保持运行；如需停止请追加 -StopMySql。' -ForegroundColor DarkGray
}
Write-Host '已完成。Ollama 默认不会被停止；如需停止请追加 -StopOllama。' -ForegroundColor Green
