$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$dataPath = Join-Path $projectRoot '.local'
New-Item -ItemType Directory -Path $dataPath -Force | Out-Null
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$existingAcl = Get-Acl -LiteralPath $dataPath
if (-not $existingAcl.AreAccessRulesProtected) {
  & icacls.exe $dataPath '/inheritance:r' '/grant:r' ('*' + $identity.Value + ':(OI)(CI)F') | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Cannot protect ModelBridge data directory' }
}
if (Test-Path -LiteralPath (Join-Path $dataPath 'runtime.lock')) { throw 'ModelBridge runtime lock exists. Check or stop the running instance first.' }
$nodePath = (Get-Command node.exe).Source
$entry = Join-Path $projectRoot 'src\server.mjs'
$process = Start-Process -FilePath $nodePath -ArgumentList @('--use-env-proxy',('"' + $entry + '"')) -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $dataPath 'server.out.log') -RedirectStandardError (Join-Path $dataPath 'server.err.log') -PassThru
Write-Output ('ModelBridge started, PID ' + $process.Id)
