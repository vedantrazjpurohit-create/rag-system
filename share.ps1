# Share your local site publicly via tunnel (no GitHub / no cloud deploy)
$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot

Write-Host "=== RAG System — public share mode ===" -ForegroundColor Cyan
Write-Host "Starts API + web, then exposes port 3000 via localtunnel." -ForegroundColor DarkGray

$env:CHROMA_PATH = "$Root\data\chroma"
$env:HF_HOME = "$Root\.hf_cache"
$env:PYTHONPATH = "$Root\api;$Root\eval"
$env:CORS_ORIGINS = "http://localhost:3000,http://127.0.0.1:3000"

if (Test-Path "$Root\.env") {
    Get-Content "$Root\.env" | ForEach-Object {
        if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
            Set-Item -Path "env:$($matches[1].Trim())" -Value $matches[2].Trim()
        }
    }
}

Write-Host "Starting API..." -ForegroundColor Green
$apiJob = Start-Job -ScriptBlock {
    param($Root)
    $env:HF_HOME = "$Root\.hf_cache"
    $env:PYTHONPATH = "$Root\api;$Root\eval"
    $env:CHROMA_PATH = "$Root\data\chroma"
    Set-Location $Root
    & "$Root\.venv\Scripts\python.exe" -m uvicorn app.main:app --host 127.0.0.1 --port 8000
} -ArgumentList $Root

Start-Sleep -Seconds 4

Push-Location "$Root\web"
if (-not (Test-Path "node_modules")) { npm install }
if (-not (Test-Path ".env.local")) { Copy-Item ".env.local.example" ".env.local" }

# Use API proxy — browser hits /api-proxy, no separate API tunnel needed
if (Test-Path ".env.local") {
    (Get-Content ".env.local") | Where-Object { $_ -notmatch '^NEXT_PUBLIC_API_URL=' } | Set-Content ".env.local"
}

Write-Host "Building web..." -ForegroundColor Green
npm run build

$webJob = Start-Job -ScriptBlock {
    Set-Location $using:Root\web
    npm start -- --hostname 127.0.0.1 --port 3000 2>&1
}

Start-Sleep -Seconds 5
Write-Host "Opening public tunnel on port 3000..." -ForegroundColor Green
Write-Host "Your shareable URL will appear below. Paste it on LinkedIn / resume." -ForegroundColor Yellow
Write-Host "Press Ctrl+C to stop." -ForegroundColor DarkGray

try {
    npx --yes localtunnel --port 3000
} finally {
    Pop-Location
    Stop-Job $apiJob, $webJob -ErrorAction SilentlyContinue
    Remove-Job $apiJob, $webJob -Force -ErrorAction SilentlyContinue
}