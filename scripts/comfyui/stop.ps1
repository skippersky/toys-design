[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$PidFile = Join-Path $RepoRoot ".runtime\comfyui.pid"

if (-not (Test-Path $PidFile)) {
  Write-Host "[ComfyUI] No managed process is running."
  exit 0
}

$processId = [int](Get-Content $PidFile)
$process = Get-Process -Id $processId -ErrorAction SilentlyContinue
if ($process) {
  Stop-Process -Id $processId
  $process.WaitForExit(10000)
}
Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
Write-Host "[ComfyUI] Stopped."
