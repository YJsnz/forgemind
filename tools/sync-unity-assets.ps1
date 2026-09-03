param(
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
)

$ErrorActionPreference = 'Stop'
$sourceRoot = Join-Path $ProjectRoot 'public\models'
$targetRoot = Join-Path $ProjectRoot 'unity-client\Assets\ForgeMind\Models'

$allowlist = @(
  'assembly_fixture.glb'
  'forklift_agv.glb'
  'industrial_line_demo.glb'
  'robot_arm_6dof_white.glb'
  'robot_irb2400.glb'
)
$allowlist += @(Get-ChildItem -LiteralPath (Join-Path $sourceRoot 'industrial') -Filter '*.glb' | ForEach-Object { "industrial\$($_.Name)" })
$allowlist += @('forgecore\forgecore_agv.glb', 'forgecore\forgecore_drone.glb')

foreach ($relativePath in $allowlist) {
  $source = Join-Path $sourceRoot $relativePath
  $target = Join-Path $targetRoot $relativePath
  if (-not (Test-Path -LiteralPath $source)) { throw "Missing allowlisted model: $source" }
  $targetDir = Split-Path -Parent $target
  New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
  Copy-Item -LiteralPath $source -Destination $target -Force
  Write-Output "Synced $relativePath"
}

$itemSource = Join-Path $sourceRoot 'forgecore\items'
$itemTarget = Join-Path $targetRoot 'forgecore\items'
if (-not (Test-Path -LiteralPath $itemSource)) { throw "Missing ForgeCore item model library: $itemSource" }
New-Item -ItemType Directory -Path $itemTarget -Force | Out-Null
Copy-Item -LiteralPath $itemSource -Destination (Split-Path -Parent $itemTarget) -Recurse -Force
Write-Output "Synced ForgeCore item model library"

$pandaSource = Join-Path $sourceRoot 'panda'
$pandaTarget = Join-Path $targetRoot 'panda'
if (Test-Path -LiteralPath $pandaSource) {
  New-Item -ItemType Directory -Path (Split-Path -Parent $pandaTarget) -Force | Out-Null
  Copy-Item -LiteralPath $pandaSource -Destination (Split-Path -Parent $pandaTarget) -Recurse -Force
  Write-Output "Synced Panda inspection source assets"
}

Write-Output "Unity asset sync complete. Re-run the asset/license audit before packaging."
