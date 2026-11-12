param(
    [string]$Registry = "git.wolffya.com",
    [string]$Repository = "wolffy/caddy-fpk",
    [string]$Version = "2.11.9-2",
    [switch]$Load
)

$ErrorActionPreference = "Stop"
$ProjectRoot = $PSScriptRoot
$Tag = "$Registry/$Repository`:$Version"

& npm --prefix (Join-Path $ProjectRoot "panel") test
if ($LASTEXITCODE -ne 0) { throw "Panel tests failed" }

if ($Load) {
    & docker build -f (Join-Path $ProjectRoot "app\docker\Dockerfile") -t $Tag --load (Join-Path $ProjectRoot "app")
} else {
    & docker buildx build -f (Join-Path $ProjectRoot "app\docker\Dockerfile") --platform linux/amd64,linux/arm64 -t $Tag --push (Join-Path $ProjectRoot "app")
}
if ($LASTEXITCODE -ne 0) { throw "Docker build failed" }
Write-Output "Published: $Tag"
