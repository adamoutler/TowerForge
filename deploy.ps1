# ============================================================
#  TowerForge Companion — Deploy Script
#  Builds frontend + backend and pushes to the VPS in one go.
#
#  Usage:
#    .\deploy.ps1               new features: 1.18.0 -> 1.19.0
#    .\deploy.ps1 -Bump patch   fixes only:   1.18.0 -> 1.18.1
#    .\deploy.ps1 -Bump major   a big change: 1.18.0 -> 2.0.0
#    .\deploy.ps1 -Bump none    redeploy the same version
#
#  Every deploy gets its own version (the site header shows it, from
#  towerforge.client/package.json). If the deploy fails the bump is undone;
#  if it succeeds the bump is committed as "Release vX.Y.Z", tagged and
#  pushed. History: CHANGELOG.md.
# ============================================================

param(
    [ValidateSet('minor', 'patch', 'major', 'none')]
    [string]$Bump = 'minor'
)

$ErrorActionPreference = "Stop"

try {

$VPS_HOST = "ubuntu@towerforge.net"
$REMOTE_CLIENT = "/var/www/towerforge/client"
$REMOTE_SERVER = "/var/www/towerforge/server"
$STAGING       = "/home/ubuntu/deploy-staging"

Write-Host "=== TowerForge Deploy ===" -ForegroundColor Cyan

# ── Step 0: Version ─────────────────────────────────────────
$PKG = "towerforge.client/package.json"
$oldVersion = (Get-Content $PKG -Raw | ConvertFrom-Json).version
if ($Bump -ne 'none') {
    Push-Location towerforge.client
    npm version $Bump --no-git-tag-version | Out-Null
    Pop-Location
}
$version = (Get-Content $PKG -Raw | ConvertFrom-Json).version
Write-Host "Version: $oldVersion -> $version" -ForegroundColor Cyan

# Puts the version back if the deploy doesn't go through (only the
# version fields change, not anything else in package.json).
function Undo-Version {
    if ($Bump -ne 'none' -and $version -ne $oldVersion) {
        Push-Location (Join-Path $PSScriptRoot 'towerforge.client')
        npm version $oldVersion --no-git-tag-version --allow-same-version | Out-Null
        Pop-Location
        Write-Host "Version put back to $oldVersion." -ForegroundColor Yellow
    }
}

# ── Step 1: Test + build frontend ───────────────────────────
Write-Host "`n[1/6] Testing and building frontend..." -ForegroundColor Yellow
Push-Location towerforge.client
npm test
if ($LASTEXITCODE -ne 0) {
    Write-Host "Tests failed - nothing was deployed." -ForegroundColor Red
    Pop-Location
    Undo-Version
    exit 1
}
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "Frontend build failed!" -ForegroundColor Red
    Pop-Location
    Undo-Version
    exit 1
}
Pop-Location

# The server's own tests (the Tower-only check for live streams).
dotnet test TowerForge.Server.Tests --nologo
if ($LASTEXITCODE -ne 0) {
    Write-Host "Server tests failed - nothing was deployed." -ForegroundColor Red
    Undo-Version
    exit 1
}

# ── Step 2: Build backend ───────────────────────────────────
Write-Host "`n[2/6] Building backend..." -ForegroundColor Yellow
dotnet publish TowerForge.Server -c Release -r linux-x64 --self-contained true -o publish
if ($LASTEXITCODE -ne 0) {
    Write-Host "Backend build failed!" -ForegroundColor Red
    Undo-Version
    exit 1
}

# ── Step 2b: TowerForge Link (Windows helper) into the site's downloads ─
# After the backend: publishing the server rebuilds the client, which
# empties dist/.
Write-Host "`n[2b/6] Building TowerForge Link (downloads/TowerForgeLink.exe)..." -ForegroundColor Yellow
dotnet publish TowerForge.Link -c Release -o towerforge.client/dist/downloads
if ($LASTEXITCODE -ne 0) {
    Write-Host "TowerForge Link build failed!" -ForegroundColor Red
    Undo-Version
    exit 1
}

# ── Step 2c: TowerForge Link for Android into the site's downloads ─
# Signed with the key in %USERPROFILE%\.towerforge (never in the repo):
# Android only installs an update signed with the same key, so a lost
# key means players reinstall. Restore that folder from its backup.
Write-Host "`n[2c/6] Building TowerForge Link for Android (downloads/TowerForgeLink.apk)..." -ForegroundColor Yellow
if (-not (Test-Path (Join-Path $env:USERPROFILE '.towerforge\link-android-signing.properties'))) {
    Write-Host "No Android signing key in $env:USERPROFILE\.towerforge - restore it from the backup (TowerForge.Link.Android\build.ps1)." -ForegroundColor Red
    Undo-Version
    exit 1
}
powershell -ExecutionPolicy Bypass -File TowerForge.Link.Android/build.ps1 -Out towerforge.client/dist/downloads/TowerForgeLink.apk
if ($LASTEXITCODE -ne 0 -or -not (Test-Path towerforge.client/dist/downloads/TowerForgeLink.apk)) {
    Write-Host "TowerForge Link for Android build failed!" -ForegroundColor Red
    Undo-Version
    exit 1
}

# ── Step 3: Prepare staging dirs on VPS ─────────────────────
Write-Host "`n[3/6] Preparing staging directories..." -ForegroundColor Yellow
ssh $VPS_HOST "rm -rf $STAGING && mkdir -p $STAGING/client $STAGING/server"

# ── Step 4: Upload to staging (ubuntu-owned, no perms issue) ─
Write-Host "`n[4/6] Uploading files to staging..." -ForegroundColor Yellow
scp -r towerforge.client/dist/* "${VPS_HOST}:${STAGING}/client/"
scp -r publish/* "${VPS_HOST}:${STAGING}/server/"

# ── Step 5: Stop backend before swapping files ──────────────
Write-Host "`n[5/6] Stopping backend service..." -ForegroundColor Yellow
ssh $VPS_HOST "sudo systemctl stop towerforge"

# ── Step 6: Move into place, fix perms, restart ─────────────
Write-Host "`n[6/6] Deploying and restarting services..." -ForegroundColor Yellow

$remoteCmd = "sudo rm -rf $REMOTE_CLIENT/* && " +
             "sudo cp -r $STAGING/client/* $REMOTE_CLIENT/ && " +
             "sudo chown -R www-data:www-data $REMOTE_CLIENT && " +
             "sudo chmod -R 755 $REMOTE_CLIENT && " +
             "sudo rm -rf $REMOTE_SERVER/* && " +
             "sudo cp -r $STAGING/server/* $REMOTE_SERVER/ && " +
             "sudo chown -R towerforge:towerforge $REMOTE_SERVER && " +
             "sudo chmod +x $REMOTE_SERVER/TowerForge.Server && " +
             "sudo systemctl start towerforge && " +
             "sudo systemctl reload nginx && " +
             "rm -rf $STAGING"

ssh $VPS_HOST $remoteCmd
if ($LASTEXITCODE -ne 0) {
    Write-Host "Putting the files in place on the server failed!" -ForegroundColor Red
    Undo-Version
    exit 1
}

Write-Host "`n=== Deploy complete! v$version ===" -ForegroundColor Green
Write-Host "Live at https://towerforge.net" -ForegroundColor Green

# ── Step 7: Record the release ──────────────────────────────
if ($Bump -ne 'none') {
    Write-Host "`n[7/7] Committing and tagging v$version..." -ForegroundColor Yellow
    git commit -m "Release v$version" -- towerforge.client/package.json towerforge.client/package-lock.json CHANGELOG.md
    git tag "v$version"
    git push origin main
    git push origin "v$version"
}

} catch {
    Write-Host "`n=== DEPLOY FAILED ===" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    Undo-Version
}

Write-Host "`nPress Enter to close..." -ForegroundColor Gray
Read-Host