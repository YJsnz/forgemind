[CmdletBinding()]
param(
  [switch]$Clean,
  [switch]$SkipFullTest,
  [switch]$SkipLint
)

$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

function Invoke-Npm {
  param([Parameter(Mandatory)][string[]]$Arguments)
  Write-Host ("> npm " + ($Arguments -join " ")) -ForegroundColor DarkGray
  & npm.cmd @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "npm $($Arguments -join ' ') failed with exit code $LASTEXITCODE"
  }
}

if (-not (Test-Path -LiteralPath "package.json" -PathType Leaf)) {
  throw "This is not the ForgeMind project root: package.json was not found."
}
if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) {
  throw "Node.js was not found. Install Node.js 22.13 or newer."
}
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
  throw "npm was not found. Reinstall Node.js with npm enabled."
}

$nodeVersion = (& node.exe -p "process.versions.node").Trim()
$nodeMajor = [int](($nodeVersion -split '\.')[0])
if ($nodeMajor -lt 22) { throw "ForgeMind requires Node.js 22.13 or newer. Current version: $nodeVersion." }

if (-not (Test-Path -LiteralPath "node_modules\.bin\vinext.cmd" -PathType Leaf)) {
  Write-Host "Dependencies are missing. Installing project dependencies..." -ForegroundColor Yellow
  if (Test-Path -LiteralPath "package-lock.json" -PathType Leaf) { Invoke-Npm @("ci") } else { Invoke-Npm @("install") }
}

if ($Clean) {
  Write-Host "Cleaning build caches..." -ForegroundColor Yellow
  foreach ($cachePath in @(".next", "dist")) {
    if (Test-Path -LiteralPath $cachePath) { Remove-Item -LiteralPath $cachePath -Recurse -Force }
  }
}

Write-Host "ForgeMind verification started: Node.js $nodeVersion" -ForegroundColor Cyan
if (-not $SkipLint) { Invoke-Npm @("run", "lint") }
if ($SkipFullTest) {
  Invoke-Npm @("run", "test:resource")
  Invoke-Npm @("run", "build")
} else {
  # npm test already performs the production build before the complete suite.
  # Calling build separately here used to compile the same source twice.
  Invoke-Npm @("test")
}

Write-Host "ForgeMind verification complete: requested checks passed." -ForegroundColor Green
if ($SkipFullTest) { Write-Host "Full test suite was skipped; remove -SkipFullTest for complete regression." -ForegroundColor Yellow }
