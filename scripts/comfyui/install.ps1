[CmdletBinding()]
param(
  [ValidateSet("auto", "cuda", "directml", "cpu")]
  [string]$Mode = "auto",
  [switch]$SkipModel,
  [switch]$ForceDependencies
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$RuntimeRoot = Join-Path $RepoRoot ".runtime"
$DownloadsRoot = Join-Path $RuntimeRoot "downloads"
$PythonRoot = Join-Path $RuntimeRoot "python311"
$PythonExe = Join-Path $PythonRoot "python.exe"
$ComfyRoot = Join-Path $RuntimeRoot "comfyui"
$ModelRoot = Join-Path $ComfyRoot "models\checkpoints"
$PythonInstaller = Join-Path $DownloadsRoot "python-3.11.9-amd64.exe"
$ProfilePath = Join-Path $RuntimeRoot "ai-profile.json"
$PidFile = Join-Path $RuntimeRoot "comfyui.pid"

$PythonUrl = "https://www.python.org/ftp/python/3.11.9/python-3.11.9-amd64.exe"
$ComfyRepository = "https://github.com/Comfy-Org/ComfyUI.git"
$ComfyCommit = "72212fef660bcd7d9702fa52011d089c027a64d8"
$TorchVersion = "2.4.1"
$TorchvisionVersion = "0.19.1"
$TorchaudioVersion = "2.4.1"
$Profile = & (Join-Path $PSScriptRoot "hardware-profile.ps1") -RequestedMode $Mode
$ModelPath = Join-Path $ModelRoot $Profile.CheckpointName
$DependencyMarker = Join-Path $RuntimeRoot "comfyui-dependencies-v4-$($Profile.RuntimeMode).txt"

function Invoke-External {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string[]]$Arguments
  )

  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$FilePath exited with code $LASTEXITCODE."
  }
}

function Download-File {
  param(
    [Parameter(Mandatory = $true)][string]$Url,
    [Parameter(Mandatory = $true)][string]$Destination
  )

  $curl = (Get-Command curl.exe -ErrorAction Stop).Source
  Invoke-External -FilePath $curl -Arguments @(
    "--location",
    "--fail",
    "--retry", "5",
    "--retry-delay", "3",
    "--connect-timeout", "20",
    "--continue-at", "-",
    "--output", $Destination,
    $Url
  )
}

New-Item -ItemType Directory -Force -Path $RuntimeRoot, $DownloadsRoot | Out-Null

if (-not (Test-Path $PythonExe)) {
  Write-Host "[ComfyUI] Downloading Python 3.11 runtime..."
  if (-not (Test-Path $PythonInstaller)) {
    Download-File -Url $PythonUrl -Destination $PythonInstaller
  }
  Write-Host "[ComfyUI] Installing isolated Python runtime..."
  Invoke-External -FilePath $PythonInstaller -Arguments @(
    "/quiet",
    "InstallAllUsers=0",
    "TargetDir=$PythonRoot",
    "Include_pip=1",
    "Include_launcher=0",
    "Include_test=0",
    "Shortcuts=0",
    "AssociateFiles=0",
    "PrependPath=0"
  )
}

if (-not (Test-Path $PythonExe)) {
  throw "Python runtime installation did not produce $PythonExe."
}

if (-not (Test-Path (Join-Path $ComfyRoot ".git"))) {
  Write-Host "[ComfyUI] Cloning pinned ComfyUI source..."
  Invoke-External -FilePath "git" -Arguments @(
    "clone",
    "--filter=blob:none",
    "--no-checkout",
    $ComfyRepository,
    $ComfyRoot
  )
}

Invoke-External -FilePath "git" -Arguments @(
  "-c", "safe.directory=$($ComfyRoot.Replace('\', '/'))",
  "-C", $ComfyRoot, "fetch", "--depth", "1", "origin", $ComfyCommit
)
Invoke-External -FilePath "git" -Arguments @(
  "-c", "safe.directory=$($ComfyRoot.Replace('\', '/'))",
  "-C", $ComfyRoot, "checkout", "--detach", $ComfyCommit
)

$dependenciesRequired = $ForceDependencies -or -not (Test-Path $DependencyMarker)
if ($dependenciesRequired -and (Test-Path $PidFile)) {
  $runningPid = [int](Get-Content $PidFile -ErrorAction SilentlyContinue)
  if ($runningPid -and (Get-Process -Id $runningPid -ErrorAction SilentlyContinue)) {
    throw "Stop ComfyUI before changing PyTorch dependencies (PID $runningPid)."
  }
}

if ($dependenciesRequired) {
  Write-Host "[ComfyUI] Installing $($Profile.Accelerator) dependencies for profile $($Profile.Name)..."
  Invoke-External -FilePath $PythonExe -Arguments @(
    "-m", "pip", "install", "--upgrade", "pip", "setuptools", "wheel"
  )

  if ($Profile.RuntimeMode -ne "directml") {
    Invoke-External -FilePath $PythonExe -Arguments @(
      "-m", "pip", "uninstall", "--yes", "torch-directml"
    )
  }

  switch ($Profile.RuntimeMode) {
    "cuda" {
      Invoke-External -FilePath $PythonExe -Arguments @(
        "-m", "pip", "install", "--upgrade",
        "torch==$TorchVersion",
        "torchvision==$TorchvisionVersion",
        "torchaudio==$TorchaudioVersion",
        "--index-url", "https://download.pytorch.org/whl/cu124"
      )
      break
    }
    "directml" {
      Invoke-External -FilePath $PythonExe -Arguments @(
        "-m", "pip", "install", "--upgrade",
        "torch-directml==0.2.5.dev240914",
        "torchvision==$TorchvisionVersion",
        "torchaudio==$TorchaudioVersion"
      )
      break
    }
    "cpu" {
      Invoke-External -FilePath $PythonExe -Arguments @(
        "-m", "pip", "install", "--upgrade",
        "torch==$TorchVersion",
        "torchvision==$TorchvisionVersion",
        "torchaudio==$TorchaudioVersion",
        "--index-url", "https://download.pytorch.org/whl/cpu"
      )
      break
    }
  }

  Invoke-External -FilePath $PythonExe -Arguments @(
    "-m", "pip", "install", "--upgrade",
    "numpy==1.26.4",
    "transformers==4.49.0",
    "tokenizers==0.21.4"
  )
  Invoke-External -FilePath $PythonExe -Arguments @(
    "-m", "pip", "install", "-r", (Join-Path $ComfyRoot "requirements.txt")
  )
  Invoke-External -FilePath $PythonExe -Arguments @("-m", "pip", "check")
  Set-Content -Encoding ascii -Path $DependencyMarker -Value @(
    $ComfyCommit,
    $Profile.Name,
    $Profile.Accelerator
  )
}

if (-not $SkipModel) {
  New-Item -ItemType Directory -Force -Path $ModelRoot | Out-Null
  $modelValid = $false
  if (Test-Path $ModelPath) {
    $modelFile = Get-Item $ModelPath
    if ($modelFile.Length -eq $Profile.ModelSizeBytes) {
      $modelValid = (Get-FileHash -Algorithm SHA256 $ModelPath).Hash -eq $Profile.ModelSha256
      if (-not $modelValid) {
        Remove-Item -LiteralPath $ModelPath -Force
      }
    } elseif ($modelFile.Length -gt $Profile.ModelSizeBytes) {
      Remove-Item -LiteralPath $ModelPath -Force
    }
  }
  if (-not $modelValid) {
    $sizeGb = [math]::Round($Profile.ModelSizeBytes / 1GB, 2)
    Write-Host "[ComfyUI] Downloading $($Profile.CheckpointName) ($sizeGb GB)..."
    Download-File -Url $Profile.ModelUrl -Destination $ModelPath
    $actualHash = (Get-FileHash -Algorithm SHA256 $ModelPath).Hash
    if ($actualHash -ne $Profile.ModelSha256) {
      throw "Checkpoint SHA256 mismatch. Expected $($Profile.ModelSha256), got $actualHash."
    }
  }
}

$Profile | ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8 -Path $ProfilePath
Write-Host "[ComfyUI] Installation complete."
Write-Host "[ComfyUI] Profile: $($Profile.Name)"
Write-Host "[ComfyUI] GPU: $($Profile.GpuName) ($($Profile.VramMb) MB VRAM)"
Write-Host "[ComfyUI] Checkpoint: $($Profile.CheckpointName)"
