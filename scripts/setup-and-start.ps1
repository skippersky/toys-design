[CmdletBinding()]
param(
  [ValidateSet("auto", "cuda", "directml", "cpu")]
  [string]$ComfyMode = "auto",
  [switch]$SkipInstall,
  [switch]$Production
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$RuntimeRoot = Join-Path $RepoRoot ".runtime"
$DownloadsRoot = Join-Path $RuntimeRoot "downloads"
$EnvFile = Join-Path $RepoRoot ".env.local"
$EnvExample = Join-Path $RepoRoot ".env.local.example"
$NodeVersion = "22.16.0"
$PnpmVersion = "10.12.1"
$NodeArchiveName = "node-v$NodeVersion-win-x64.zip"
$NodeRoot = Join-Path $RuntimeRoot "node-v$NodeVersion-win-x64"
$NodeArchive = Join-Path $DownloadsRoot $NodeArchiveName
$NodeSha256 = "21C2D9735C80B8F86DAB19305AA6A9F6F59BBC808F68DE3EEF09D5832E3BFBBD"

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
    [Parameter(Mandatory = $true)][string]$FallbackUrl,
    [Parameter(Mandatory = $true)][string]$Destination
  )

  $curl = (Get-Command curl.exe -ErrorAction Stop).Source
  $arguments = @(
      "--location",
      "--fail",
      "--retry", "1",
      "--retry-delay", "3",
      "--connect-timeout", "10",
      "--max-time", "60",
      "--continue-at", "-",
      "--output", $Destination
    )
  try {
    Invoke-External -FilePath $curl -Arguments ($arguments + $Url)
  } catch {
    Write-Warning "Primary download failed. Retrying with the verified mirror."
    Invoke-External -FilePath $curl -Arguments ($arguments + $FallbackUrl)
  }
}

function Install-PortableNode {
  $nodeExe = Join-Path $NodeRoot "node.exe"
  $corepackCmd = Join-Path $NodeRoot "corepack.cmd"
  if (-not (Test-Path $nodeExe)) {
    New-Item -ItemType Directory -Force -Path $RuntimeRoot, $DownloadsRoot | Out-Null
    $baseUrl = "https://nodejs.org/dist/v$NodeVersion"
    $fallbackBaseUrl = "https://npmmirror.com/mirrors/node/v$NodeVersion"
    Write-Host "[App] Downloading portable Node.js $NodeVersion..."
    if (-not (Test-Path $NodeArchive)) {
      Download-File `
        -Url "$baseUrl/$NodeArchiveName" `
        -FallbackUrl "$fallbackBaseUrl/$NodeArchiveName" `
        -Destination $NodeArchive
    }

    $actualHash = (Get-FileHash -Algorithm SHA256 $NodeArchive).Hash
    if ($actualHash -ne $NodeSha256) {
      throw "Node.js archive SHA256 mismatch. Delete $NodeArchive and retry."
    }

    Expand-Archive -Path $NodeArchive -DestinationPath $RuntimeRoot -Force
  }

  if (-not (Test-Path $nodeExe) -or -not (Test-Path $corepackCmd)) {
    throw "Portable Node.js installation is incomplete under $NodeRoot."
  }

  $env:COREPACK_HOME = Join-Path $RuntimeRoot "corepack"
  $env:COREPACK_ENABLE_DOWNLOAD_PROMPT = "0"
  $env:PATH = "$NodeRoot;$env:PATH"
  Invoke-External -FilePath $corepackCmd -Arguments @(
      "enable", "--install-directory", $NodeRoot
    ) | Out-Host
  Invoke-External -FilePath $corepackCmd -Arguments @(
      "prepare", "pnpm@$PnpmVersion", "--activate"
    ) | Out-Host
  return (Join-Path $NodeRoot "pnpm.cmd")
}

function Set-EnvironmentValues {
  param([Parameter(Mandatory = $true)][System.Collections.IDictionary]$Values)

  $envLines = [System.Collections.Generic.List[string]](Get-Content $EnvFile)
  foreach ($entry in $Values.GetEnumerator()) {
    $pattern = "^$([regex]::Escape([string]$entry.Key))="
    $replacement = "$($entry.Key)=`"$($entry.Value)`""
    $index = -1
    for ($i = 0; $i -lt $envLines.Count; $i++) {
      if ($envLines[$i] -match $pattern) {
        $index = $i
        break
      }
    }
    if ($index -ge 0) {
      $envLines[$index] = $replacement
    } else {
      $envLines.Add($replacement)
    }
  }
  Set-Content -Encoding utf8 -Path $EnvFile -Value $envLines
}

function Get-ProfileEnvironment {
  param([Parameter(Mandatory = $true)]$Profile)

  return [ordered]@{
    COMFYUI_HTTP_URL = "http://127.0.0.1:8188"
    COMFYUI_WS_URL = "ws://127.0.0.1:8188"
    COMFYUI_CHECKPOINT_NAME = $Profile.CheckpointName
    COMFYUI_SAMPLER_NAME = $Profile.Sampler
    COMFYUI_SCHEDULER = $Profile.Scheduler
    AI_DEPLOYMENT_PROFILE = $Profile.Name
    NEXT_PUBLIC_AI_DEPLOYMENT_PROFILE = $Profile.Name
    NEXT_PUBLIC_AI_DEFAULT_STEPS = $Profile.DefaultSteps
    NEXT_PUBLIC_AI_DEFAULT_CFG = $Profile.DefaultCfg
    NEXT_PUBLIC_AI_SQUARE_WIDTH = $Profile.SquareWidth
    NEXT_PUBLIC_AI_SQUARE_HEIGHT = $Profile.SquareHeight
    NEXT_PUBLIC_AI_LANDSCAPE_WIDTH = $Profile.LandscapeWidth
    NEXT_PUBLIC_AI_LANDSCAPE_HEIGHT = $Profile.LandscapeHeight
    NEXT_PUBLIC_AI_PORTRAIT_WIDTH = $Profile.PortraitWidth
    NEXT_PUBLIC_AI_PORTRAIT_HEIGHT = $Profile.PortraitHeight
  }
}

if (-not (Test-Path $EnvFile)) {
  Copy-Item $EnvExample $EnvFile
  Write-Warning "Created .env.local. Add real Supabase public credentials before using the app."
}

$profilePath = Join-Path $RuntimeRoot "ai-profile.json"
if (-not $SkipInstall) {
  & (Join-Path $PSScriptRoot "comfyui\stop.ps1")
  & (Join-Path $PSScriptRoot "comfyui\install.ps1") -Mode $ComfyMode
}
$profile = if ($SkipInstall -and $ComfyMode -eq "auto" -and (Test-Path $profilePath)) {
  Get-Content $profilePath -Raw | ConvertFrom-Json
} else {
  & (Join-Path $PSScriptRoot "comfyui\hardware-profile.ps1") -RequestedMode $ComfyMode
}
$profile | ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8 -Path $profilePath
Set-EnvironmentValues -Values (Get-ProfileEnvironment -Profile $profile)

try {
  & (Join-Path $PSScriptRoot "comfyui\start.ps1") -Mode "auto"
} catch {
  if ($profile.RuntimeMode -ne "directml") {
    throw
  }
  Write-Warning "DirectML startup failed. Retrying ComfyUI in CPU mode."
  & (Join-Path $PSScriptRoot "comfyui\stop.ps1")
  $profile = & (Join-Path $PSScriptRoot "comfyui\hardware-profile.ps1") -RequestedMode "cpu"
  $profile | ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8 -Path $profilePath
  Set-EnvironmentValues -Values (Get-ProfileEnvironment -Profile $profile)
  & (Join-Path $PSScriptRoot "comfyui\start.ps1") -Mode "auto"
}

$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
$pnpmCommand = Get-Command pnpm.cmd -ErrorAction SilentlyContinue
$pnpmExe = if ($nodeCommand -and $pnpmCommand) {
  $pnpmCommand.Source
} else {
  Install-PortableNode
}

Push-Location $RepoRoot
try {
  $previousCi = $env:CI
  $env:CI = "true"
  try {
    Invoke-External -FilePath $pnpmExe -Arguments @("install", "--frozen-lockfile")
  } finally {
    $env:CI = $previousCi
  }

  if ($Production) {
    Invoke-External -FilePath $pnpmExe -Arguments @("run", "build")
    Invoke-External -FilePath $pnpmExe -Arguments @("start")
  } else {
    Invoke-External -FilePath $pnpmExe -Arguments @("dev")
  }
} finally {
  Pop-Location
}
