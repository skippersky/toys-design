[CmdletBinding()]
param([int]$Port = 8188)

$ErrorActionPreference = "Stop"
$response = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/system_stats" -TimeoutSec 5
[pscustomobject]@{
  Healthy = $true
  Url = "http://127.0.0.1:$Port"
  System = $response.system
  Devices = $response.devices
} | ConvertTo-Json -Depth 6
