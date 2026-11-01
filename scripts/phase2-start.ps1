# Run ONLY when Tho explicitly says so. This starts a networked server and tunnel.
# Tho must first apply migrations 048-058 (including 054-058) and approve the test env.
param([switch]$IConfirmThoApproved)

$ErrorActionPreference = 'Stop'
if (-not $IConfirmThoApproved) { throw 'Tho approval required: pass -IConfirmThoApproved only after approval.' }
if ($env:LINE_TEST_MODE -cne 'true') { throw 'Refusing to start: LINE_TEST_MODE must be exactly true in this shell.' }
$tunnel = Get-Command cloudflared -ErrorAction SilentlyContinue
if (-not $tunnel) { throw 'cloudflared is not installed. Installation is pending Tho approval (see PHASE2_TUNNEL_PREP.md).' }
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $projectRoot
try {
    # Inspected: this checker reads process.env only; no DB, S3, filesystem or network access.
    # Export required variables in the parent shell; the checker does not load .env.local.
    & node scripts/check-line-test-env.cjs
    if ($LASTEXITCODE -ne 0) { throw 'Environment preflight failed; nothing started.' }
    # Read-only catalog check; fail before launching any server or tunnel.
    & node scripts/check-phase2-schema.cjs
    if ($LASTEXITCODE -ne 0) { throw 'Schema prerequisites failed; nothing started.' }
    # Avoid Next silently selecting a different port when 3000 is occupied.
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 3000)
    try { $listener.Start() } finally { $listener.Stop() }
    # Separate visible windows explicitly requested for this operator startup helper.
    # The tunnel window displays the assigned hostname. Environment is inherited.
    Start-Process -FilePath 'cmd.exe' -ArgumentList '/k', 'npm run dev -- --hostname 127.0.0.1 --port 3000' -WorkingDirectory $projectRoot -WindowStyle Normal
    Start-Process -FilePath $tunnel.Source -ArgumentList 'tunnel', '--url', 'http://localhost:3000' -WorkingDirectory $projectRoot -WindowStyle Normal
    Write-Host 'Webhook URL: https://<random>.trycloudflare.com/api/line/webhook'
    Write-Host 'Read the assigned random hostname in the cloudflared window.'
    Write-Host 'Set REVIEW_PUBLIC_ORIGIN to that origin and restart the test server/worker before review testing.'
    Write-Host 'Separate test worker (only after Tho approval): $env:LINE_TEST_MODE="true"; npm run worker'
} finally { Pop-Location }
