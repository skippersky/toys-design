[CmdletBinding()]
param(
  [ValidateSet("auto", "cuda", "directml", "cpu")]
  [string]$RequestedMode = "auto",
  [string]$GpuNameOverride = $env:STATUEFORGE_GPU_NAME,
  [int]$VramMbOverride = 0,
  [string]$DriverVersionOverride = $env:STATUEFORGE_NVIDIA_DRIVER,
  [switch]$AsJson
)

$ErrorActionPreference = "Stop"

$dreamShaper = [ordered]@{
  CheckpointName = "DreamShaper8_LCM.safetensors"
  ModelUrl = "https://huggingface.co/Lykon/dreamshaper-8-lcm/resolve/main/DreamShaper8_LCM.safetensors"
  ModelSha256 = "A4F3E1526C5DC4FCBE342F5C410D83AE202C7A415FCEFCBB92E0F93FCD0A87C3"
  ModelSizeBytes = 2133804992
}
$sdxl = [ordered]@{
  CheckpointName = "sd_xl_base_1.0.safetensors"
  ModelUrl = "https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/resolve/main/sd_xl_base_1.0.safetensors"
  ModelSha256 = "31E35C80FC4829D14F90153F4C74CD59C90B779F6AFE05A74CD6120B893F7E5B"
  ModelSizeBytes = 6938078334
}

$nvidiaName = $null
$nvidiaVramMb = 0
$nvidiaDriver = $null
$nvidiaSmi = Get-Command "nvidia-smi.exe" -ErrorAction SilentlyContinue
if (-not $nvidiaSmi) {
  $nvidiaSmi = Get-Command "nvidia-smi" -ErrorAction SilentlyContinue
}
if ($nvidiaSmi) {
  $rows = & $nvidiaSmi.Source `
    "--query-gpu=name,memory.total,driver_version" `
    "--format=csv,noheader,nounits" 2>$null
  if ($LASTEXITCODE -eq 0) {
    foreach ($row in $rows) {
      $parts = $row -split ","
      if ($parts.Count -lt 3) {
        continue
      }
      $candidateVram = 0
      if (-not [int]::TryParse($parts[1].Trim(), [ref]$candidateVram)) {
        continue
      }
      if ($candidateVram -gt $nvidiaVramMb) {
        $nvidiaName = $parts[0].Trim()
        $nvidiaVramMb = $candidateVram
        $nvidiaDriver = $parts[2].Trim()
      }
    }
  }
}
if ($GpuNameOverride -and $VramMbOverride -gt 0) {
  $nvidiaName = $GpuNameOverride
  $nvidiaVramMb = $VramMbOverride
  $nvidiaDriver = $DriverVersionOverride
}

$runtimeMode = $RequestedMode
if ($RequestedMode -eq "auto") {
  $runtimeMode = if ($nvidiaName) { "cuda" } else { "directml" }
}
if ($runtimeMode -eq "cuda" -and -not $nvidiaName) {
  throw "CUDA mode requires a working NVIDIA driver and nvidia-smi."
}

$gpuName = $nvidiaName
if (-not $gpuName) {
  try {
    $gpuName = Get-CimInstance Win32_VideoController -ErrorAction Stop |
      Sort-Object AdapterRAM -Descending |
      Select-Object -First 1 -ExpandProperty Name
  } catch {
    $gpuName = if ($runtimeMode -eq "cpu") { "CPU only" } else { "DirectML adapter" }
  }
}

if ($runtimeMode -eq "cuda" -and $nvidiaDriver) {
  $driverMajor = 0
  [void][int]::TryParse(($nvidiaDriver -split "\.")[0], [ref]$driverMajor)
  if ($driverMajor -gt 0 -and $driverMajor -lt 550) {
    Write-Warning "NVIDIA driver $nvidiaDriver is older than the recommended 550+ branch for CUDA 12.4."
  }
}

$profile = switch ($runtimeMode) {
  "cuda" {
    if ($nvidiaVramMb -ge 20480) {
      [ordered]@{
        Name = "cuda-sdxl-high"; Model = $sdxl; Sampler = "dpmpp_2m"
        Scheduler = "karras"; DefaultSteps = 25; DefaultCfg = 7
        SquareWidth = 1024; SquareHeight = 1024
        LandscapeWidth = 1216; LandscapeHeight = 832
        PortraitWidth = 832; PortraitHeight = 1216
        ComfyArguments = @("--highvram")
      }
    } elseif ($nvidiaVramMb -ge 12288) {
      [ordered]@{
        Name = "cuda-sdxl-standard"; Model = $sdxl; Sampler = "dpmpp_2m"
        Scheduler = "karras"; DefaultSteps = 22; DefaultCfg = 6.5
        SquareWidth = 1024; SquareHeight = 1024
        LandscapeWidth = 1152; LandscapeHeight = 768
        PortraitWidth = 768; PortraitHeight = 1152
        ComfyArguments = @("--normalvram")
      }
    } elseif ($nvidiaVramMb -ge 8192) {
      [ordered]@{
        Name = "cuda-sdxl-low"; Model = $sdxl; Sampler = "dpmpp_2m"
        Scheduler = "karras"; DefaultSteps = 18; DefaultCfg = 6
        SquareWidth = 768; SquareHeight = 768
        LandscapeWidth = 896; LandscapeHeight = 640
        PortraitWidth = 640; PortraitHeight = 896
        ComfyArguments = @("--lowvram")
      }
    } else {
      [ordered]@{
        Name = "cuda-lcm-lite"; Model = $dreamShaper; Sampler = "lcm"
        Scheduler = "sgm_uniform"; DefaultSteps = 6; DefaultCfg = 2
        SquareWidth = 512; SquareHeight = 512
        LandscapeWidth = 768; LandscapeHeight = 512
        PortraitWidth = 512; PortraitHeight = 768
        ComfyArguments = @("--lowvram")
      }
    }
    break
  }
  "directml" {
    [ordered]@{
      Name = "directml-lcm-lite"; Model = $dreamShaper; Sampler = "lcm"
      Scheduler = "sgm_uniform"; DefaultSteps = 4; DefaultCfg = 2
      SquareWidth = 384; SquareHeight = 384
      LandscapeWidth = 512; LandscapeHeight = 384
      PortraitWidth = 384; PortraitHeight = 512
      ComfyArguments = @("--directml", "--lowvram")
    }
    break
  }
  "cpu" {
    [ordered]@{
      Name = "cpu-lcm-lite"; Model = $dreamShaper; Sampler = "lcm"
      Scheduler = "sgm_uniform"; DefaultSteps = 4; DefaultCfg = 2
      SquareWidth = 384; SquareHeight = 384
      LandscapeWidth = 512; LandscapeHeight = 384
      PortraitWidth = 384; PortraitHeight = 512
      ComfyArguments = @("--cpu")
    }
    break
  }
}

$result = [pscustomobject][ordered]@{
  Name = $profile.Name
  RuntimeMode = $runtimeMode
  Accelerator = if ($runtimeMode -eq "cuda") { "CUDA 12.4" } elseif ($runtimeMode -eq "directml") { "DirectML" } else { "CPU" }
  GpuName = $gpuName
  VramMb = $nvidiaVramMb
  DriverVersion = $nvidiaDriver
  CheckpointName = $profile.Model.CheckpointName
  ModelUrl = $profile.Model.ModelUrl
  ModelSha256 = $profile.Model.ModelSha256
  ModelSizeBytes = $profile.Model.ModelSizeBytes
  Sampler = $profile.Sampler
  Scheduler = $profile.Scheduler
  DefaultSteps = $profile.DefaultSteps
  DefaultCfg = $profile.DefaultCfg
  SquareWidth = $profile.SquareWidth
  SquareHeight = $profile.SquareHeight
  LandscapeWidth = $profile.LandscapeWidth
  LandscapeHeight = $profile.LandscapeHeight
  PortraitWidth = $profile.PortraitWidth
  PortraitHeight = $profile.PortraitHeight
  ComfyArguments = $profile.ComfyArguments
}

if ($AsJson) {
  $result | ConvertTo-Json -Depth 5
} else {
  $result
}
