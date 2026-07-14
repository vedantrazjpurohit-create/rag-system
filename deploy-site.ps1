# Deploy public site (not localhost)
# Option A: Render Blueprint (recommended, free URL like https://rag-system.onrender.com)
# Option B: Instant tunnel while Render builds

param(
    [switch]$TunnelOnly
)

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot

Write-Host ""
Write-Host "  RAG System — Public Site Deploy" -ForegroundColor Cyan
Write-Host "  ===============================" -ForegroundColor Cyan
Write-Host ""

if (-not $TunnelOnly) {
    Write-Host "PERMANENT SITE (Render — free):" -ForegroundColor Green
    Write-Host "  1. Open https://dashboard.render.com/select-repo?type=blueprint"
    Write-Host "  2. Connect GitHub repo: vedantrazjpurohit-create/rag-system"
    Write-Host "  3. Render reads render.yaml and deploys ONE service (API + web)"
    Write-Host "  4. Wait ~10 min for first build (embedder pre-cached)"
    Write-Host "  5. Your URL: https://rag-system.onrender.com (or similar)"
    Write-Host ""
    Write-Host "  If build OOMs on free tier → upgrade to Starter (`$7/mo) in Render." -ForegroundColor Yellow
    Write-Host ""
    Start-Process "https://dashboard.render.com/select-repo?type=blueprint"
}

Write-Host "INSTANT PUBLIC URL (tunnel — PC must stay on):" -ForegroundColor Green
Write-Host "  Starting share.ps1 ..." -ForegroundColor DarkGray
& "$Root\share.ps1"