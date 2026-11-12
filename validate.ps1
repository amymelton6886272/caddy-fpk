param(
    [string]$Caddy = ""
)

$ErrorActionPreference = "Stop"
$ProjectRoot = $PSScriptRoot

Get-Content -LiteralPath (Join-Path $ProjectRoot "app\ui\config") -Raw | ConvertFrom-Json | Out-Null
Get-Content -LiteralPath (Join-Path $ProjectRoot "config\privilege") -Raw | ConvertFrom-Json | Out-Null
Get-Content -LiteralPath (Join-Path $ProjectRoot "config\resource") -Raw | ConvertFrom-Json | Out-Null
Get-Content -LiteralPath (Join-Path $ProjectRoot "wizard\install") -Raw | ConvertFrom-Json | Out-Null
Get-Content -LiteralPath (Join-Path $ProjectRoot "wizard\uninstall") -Raw | ConvertFrom-Json | Out-Null

$Package = Get-ChildItem -LiteralPath (Join-Path $ProjectRoot "dist") -Filter "*.fpk" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($null -eq $Package) {
    throw "No FPK was found. Run build.ps1 first."
}

$Entries = (& tar.exe -tzf $Package.FullName) | ForEach-Object { $_ -replace '^\./', '' }
foreach ($Required in @("app.tgz", "manifest", "cmd/main", "cmd/install_callback", "cmd/uninstall_callback", "config/resource", "ICON.PNG", "ICON_256.PNG", "wizard/install", "wizard/uninstall")) {
    if ($Entries -notcontains $Required) {
        throw "FPK is missing $Required"
    }
}

$BuildDirectory = Join-Path $ProjectRoot ".build"
New-Item -ItemType Directory -Path $BuildDirectory -Force | Out-Null
$PackagedAppArchive = Join-Path $BuildDirectory "packaged-app.tgz"
$ExtractDirectory = Join-Path $BuildDirectory "package-contents"
New-Item -ItemType Directory -Path $ExtractDirectory -Force | Out-Null
& tar.exe -xzf $Package.FullName -C $ExtractDirectory app.tgz manifest
if ($LASTEXITCODE -ne 0) {
    throw "Could not extract the packaged app.tgz"
}
Copy-Item -LiteralPath (Join-Path $ExtractDirectory "app.tgz") -Destination $PackagedAppArchive -Force
$ManifestText = Get-Content -LiteralPath (Join-Path $ExtractDirectory "manifest") -Raw
$ExpectedChecksum = [regex]::Match($ManifestText, "(?m)^checksum\s*=\s*([a-f0-9]{32})").Groups[1].Value
if ($ExpectedChecksum -ne (Get-FileHash -LiteralPath $PackagedAppArchive -Algorithm MD5).Hash.ToLowerInvariant()) {
    throw "The app.tgz checksum does not match the manifest"
}

$PackagedAppEntries = (& tar.exe -tzf $PackagedAppArchive) | ForEach-Object { $_ -replace '^\./', '' }
foreach ($Required in @("docker/Dockerfile", "docker/docker-compose.yaml", "panel/cli.js", "defaults/panel-start.sh")) {
    if ($PackagedAppEntries -notcontains $Required) {
        throw "app.tgz is missing $Required"
    }
}

if ($Caddy) {
    & $Caddy fmt --diff (Join-Path $ProjectRoot "app\defaults\Caddyfile")
    if ($LASTEXITCODE -ne 0) {
        throw "Caddyfile is not formatted"
    }
    & $Caddy validate --config (Join-Path $ProjectRoot "app\defaults\Caddyfile") --adapter caddyfile
    if ($LASTEXITCODE -ne 0) {
        throw "Caddyfile validation failed"
    }
}

Write-Output "FPK structure, JSON files, and checksum validated: $($Package.FullName)"
