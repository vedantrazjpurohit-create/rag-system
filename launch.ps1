# Direct local launch — API + production web (no GitHub deploy required)
$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot

Write-Host "=== RAG System — local launch ===" -ForegroundColor Cyan

if (-not (Test-Path "$Root\.venv\Scripts\python.exe")) {
    Write-Host "Creating venv..." -ForegroundColor Yellow
    python -m venv "$Root\.venv"
    & "$Root\.venv\Scripts\pip.exe" install -r "$Root\requirements.txt"
}

$env:HF_HOME = "$Root\.hf_cache"
$env:PYTHONPATH = "$Root\api;$Root\eval"
$env:CHROMA_PATH = "$Root\data\chroma"

# Optional: load .env if present
$envFile = "$Root\.env"
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
            $name = $matches[1].Trim()
            $value = $matches[2].Trim()
            Set-Item -Path "env:$name" -Value $value
        }
    }
    Write-Host "Loaded .env" -ForegroundColor DarkGray
}

if (-not $env:CORS_ORIGINS) {
    $env:CORS_ORIGINS = "http://localhost:3000,http://127.0.0.1:3000"
}

Write-Host "Starting API on http://127.0.0.1:8000 ..." -ForegroundColor Green
$apiJob = Start-Job -ScriptBlock {
    param($Root)
    Set-Location $Root
    $env:HF_HOME = "$Root\.hf_cache"
    $env:PYTHONPATH = "$Root\api;$Root\eval"
    $env:CHROMA_PATH = "$Root\data\chroma"
    & "$Root\.venv\Scripts\python.exe" -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --no-access-log --log-level warning
} -ArgumentList $Root

Start-Sleep -Seconds 3

Push-Location "$Root\web"
if (-not (Test-Path "node_modules")) {
    Write-Host "Installing web dependencies..." -ForegroundColor Yellow
    npm install
}
if (-not (Test-Path ".env.local")) {
    Copy-Item ".env.local.example" ".env.local"
}
Write-Host "Building web app..." -ForegroundColor Green
npm run build
Write-Host "Documents persist in data\chroma across restarts." -ForegroundColor DarkGray
Write-Host "Starting site on http://localhost:3000" -ForegroundColor Green
Write-Host "Public share: .\share.ps1" -ForegroundColor DarkGray
Write-Host "Press Ctrl+C to stop." -ForegroundColor DarkGray
try {
    npm start
} finally {
    Pop-Location
    Stop-Job $apiJob -ErrorAction SilentlyContinue
    Remove-Job $apiJob -Force -ErrorAction SilentlyContinue
}