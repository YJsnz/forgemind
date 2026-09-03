$ErrorActionPreference = 'Stop'
$env:FORGEMIND_DESKTOP = '1'
try {
  & npm.cmd run build
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
finally {
  Remove-Item Env:FORGEMIND_DESKTOP -ErrorAction SilentlyContinue
}
