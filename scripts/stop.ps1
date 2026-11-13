$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$dataPath = Join-Path $projectRoot '.local'
$controlPath = Join-Path $dataPath 'control.json'
$control = Get-Content -LiteralPath $controlPath -Raw | ConvertFrom-Json
$runtime = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + [int]$control.pid)
if ($runtime) {
  if ($runtime.Name -ne 'node.exe' -or $runtime.CommandLine -notmatch 'src[\\/]server\.mjs') { throw 'PID is not the expected ModelBridge server; refusing to stop it.' }
  Stop-Process -Id $runtime.ProcessId
}
foreach ($name in @('runtime.lock','control.json')) {
  $target = [System.IO.Path]::GetFullPath((Join-Path $dataPath $name))
  if ((Split-Path -Parent $target) -ne [System.IO.Path]::GetFullPath($dataPath)) { throw 'Unexpected cleanup path' }
  if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target }
}
Write-Output 'ModelBridge stopped; encrypted account credentials preserved.'
