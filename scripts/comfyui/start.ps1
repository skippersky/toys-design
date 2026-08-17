[CmdletBinding()]
param(
  [ValidateSet("auto", "cuda", "directml", "cpu")]
  [string]$Mode = "auto",
  [int]$Port = 8188,
  [int]$HealthTimeoutSeconds = 240
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$RuntimeRoot = Join-Path $RepoRoot ".runtime"
$PythonExe = Join-Path $RuntimeRoot "python311\python.exe"
$ComfyRoot = Join-Path $RuntimeRoot "comfyui"
$LogRoot = Join-Path $RuntimeRoot "logs"
$PidFile = Join-Path $RuntimeRoot "comfyui.pid"
$ProfilePath = Join-Path $RuntimeRoot "ai-profile.json"
$StdoutLog = Join-Path $LogRoot "comfyui.out.log"
$StderrLog = Join-Path $LogRoot "comfyui.err.log"

if (-not (Test-Path $PythonExe) -or -not (Test-Path (Join-Path $ComfyRoot "main.py"))) {
  throw "ComfyUI is not installed. Run scripts\comfyui\install.ps1 first."
}

$Profile = if ($Mode -eq "auto" -and (Test-Path $ProfilePath)) {
  Get-Content $ProfilePath -Raw | ConvertFrom-Json
} else {
  & (Join-Path $PSScriptRoot "hardware-profile.ps1") -RequestedMode $Mode
}

if ($Profile.RuntimeMode -eq "cuda") {
  $nvidiaSmi = Get-Command "nvidia-smi.exe" -ErrorAction SilentlyContinue
  if (-not $nvidiaSmi) {
    $nvidiaSmi = Get-Command "nvidia-smi" -ErrorAction SilentlyContinue
  }
  if (-not $nvidiaSmi) {
    throw "The selected CUDA profile requires a working NVIDIA driver and nvidia-smi."
  }
}
$checkpointPath = Join-Path $ComfyRoot "models\checkpoints\$($Profile.CheckpointName)"
if (-not (Test-Path $checkpointPath)) {
  throw "Checkpoint $($Profile.CheckpointName) is missing. Run the installer first."
}

if (Test-Path $PidFile) {
  $existingPid = [int](Get-Content $PidFile -ErrorAction SilentlyContinue)
  if ($existingPid -and (Get-Process -Id $existingPid -ErrorAction SilentlyContinue)) {
    Write-Host "[ComfyUI] Already running with PID $existingPid."
    exit 0
  }
  Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
}

New-Item -ItemType Directory -Force -Path $LogRoot | Out-Null
$arguments = @(
  "main.py",
  "--listen", "127.0.0.1",
  "--port", $Port,
  "--preview-method", "none",
  "--disable-auto-launch"
)
$arguments += @($Profile.ComfyArguments)

$process = Start-Process `
  -FilePath $PythonExe `
  -ArgumentList $arguments `
  -WorkingDirectory $ComfyRoot `
  -RedirectStandardOutput $StdoutLog `
  -RedirectStandardError $StderrLog `
  -WindowStyle Hidden `
  -PassThru

Set-Content -Encoding ascii -Path $PidFile -Value $process.Id
Write-Host "[ComfyUI] Starting profile $($Profile.Name) with PID $($process.Id)..."

$deadline = (Get-Date).AddSeconds($HealthTimeoutSeconds)
do {
  Start-Sleep -Seconds 2
  if (-not (Get-Process -Id $process.Id -ErrorAction SilentlyContinue)) {
    $errorTail = Get-Content $StderrLog -Tail 40 -ErrorAction SilentlyContinue
    throw "ComfyUI exited during startup.`n$errorTail"
  }
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/system_stats" -TimeoutSec 3
    if ($response.StatusCode -eq 200) {
      Write-Host "[ComfyUI] Ready at http://127.0.0.1:$Port"
      Write-Host "[ComfyUI] Profile: $($Profile.Name), checkpoint: $($Profile.CheckpointName)"
      exit 0
    }
  } catch {
    # Continue until the health timeout is reached.
  }
} while ((Get-Date) -lt $deadline)

throw "ComfyUI did not become healthy within $HealthTimeoutSeconds seconds. See $StderrLog."
