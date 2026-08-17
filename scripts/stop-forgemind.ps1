[CmdletBinding()]
param([switch]$StopOllama)

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
Stop-MatchingProcess 'vite(\.cmd)?.*--host 127\.0\.0\.1'
Stop-MatchingProcess 'bt_tts_server\.py'
Stop-MatchingProcess 'forgemind-backend-0\.1\.0\.jar'
if ($StopOllama) { Stop-MatchingProcess 'ollama(\.exe)? serve' }
Write-Host '已完成。Ollama 默认不会被停止；如需停止请追加 -StopOllama。' -ForegroundColor Green
