[CmdletBinding()]
param(
  [switch]$Check,
  [switch]$NoBrowser,
  [int]$Port = 3000,
  [switch]$SkipInstall
)

$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

function Invoke-Npm {
  param([Parameter(Mandatory)][string[]]$Arguments)
  & npm.cmd @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "npm $($Arguments -join ' ') failed with exit code $LASTEXITCODE"
  }
}

if (-not (Test-Path -LiteralPath "package.json" -PathType Leaf)) {
  throw "This is not the ForgeMind project root: package.json was not found."
}

$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
$npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $nodeCommand) { throw "Node.js was not found. Install Node.js 22.13 or newer." }
if (-not $npmCommand) { throw "npm was not found. Reinstall Node.js with npm enabled." }

$nodeVersion = (& node.exe -p "process.versions.node").Trim()
$nodeMajor = [int](($nodeVersion -split '\.')[0])
if ($nodeMajor -lt 22) { throw "ForgeMind requires Node.js 22.13 or newer. Current version: $nodeVersion." }

$hasDependencies = Test-Path -LiteralPath "node_modules\.bin\vinext.cmd" -PathType Leaf
if (-not $hasDependencies -and -not $SkipInstall) {
  Write-Host "Dependencies are missing. Installing project dependencies..." -ForegroundColor Yellow
  if (Test-Path -LiteralPath "package-lock.json" -PathType Leaf) { Invoke-Npm @("ci") } else { Invoke-Npm @("install") }
  $hasDependencies = Test-Path -LiteralPath "node_modules\.bin\vinext.cmd" -PathType Leaf
}
if (-not $hasDependencies) { throw "The vinext dependency is missing. Run npm ci or remove -SkipInstall." }

$url = "http://localhost:$Port/cad?mode=part"
if ($Check) {
  Write-Host "ForgeMind startup environment is ready" -ForegroundColor Green
  Write-Host "Node.js $nodeVersion"
  Write-Host "npm $((& npm.cmd --version).Trim())"
  Write-Host "Entry $url"
  exit 0
}

Write-Host "Starting the ForgeMind development server..." -ForegroundColor Cyan
Write-Host "Entry: $url" -ForegroundColor Cyan
Write-Host "Stop the server with Ctrl+C in this window" -ForegroundColor DarkGray

if (-not $Check) {
  $existingUrl = $null
  $candidatePorts = @($Port, 3000) | Select-Object -Unique
  foreach ($candidatePort in $candidatePorts) {
    $candidateUrl = "http://localhost:$candidatePort/cad?mode=part"
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri $candidateUrl -TimeoutSec 2
      if ($response.StatusCode -eq 200 -and $response.Content -match "ForgeMind") {
        $existingUrl = $candidateUrl
        break
      }
    } catch {
      # No service is listening on this candidate port.
    }
  }
  if ($existingUrl) {
    Write-Host "An existing ForgeMind server is already running: $existingUrl" -ForegroundColor Green
    if (-not $NoBrowser) { Start-Process $existingUrl }
    exit 0
  }
}

$browserJob = $null
if (-not $NoBrowser) {
  $browserJob = Start-Job -ScriptBlock {
    param($TargetUrl)
    for ($attempt = 0; $attempt -lt 80; $attempt++) {
      try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri $TargetUrl -TimeoutSec 2
        if ($response.StatusCode -eq 200) {
          Start-Process $TargetUrl
          return
        }
      } catch {
        # The development server is still compiling.
      }
      Start-Sleep -Milliseconds 250
    }
  } -ArgumentList $url
}

$serverExitCode = 1
try {
  & npm.cmd run dev -- --port $Port
  $serverExitCode = $LASTEXITCODE
} finally {
  if ($browserJob) {
    if ($browserJob.State -eq "Running") { Stop-Job -Job $browserJob }
    Remove-Job -Job $browserJob -Force
  }
}
exit $serverExitCode
