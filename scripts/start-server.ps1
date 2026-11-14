$ErrorActionPreference = 'Stop'
$root = 'C:\Users\gusol\projects\periferia-reto-03\reto-03'
if (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue) { exit 0 }
Set-Location $root
New-Item -ItemType Directory -Path (Join-Path $root 'out') -Force | Out-Null
& 'C:\Program Files\nodejs\node.exe' (Join-Path $root 'node_modules\tsx\dist\cli.mjs') (Join-Path $root 'src\server.ts') *>> (Join-Path $root 'out\server.log')
