param(
    [string]$Fnpack = (Join-Path $PSScriptRoot "..\fnpackup\fnpackup\fnpack.exe")
)

$ErrorActionPreference = "Stop"
$ProjectRoot = $PSScriptRoot
$AppArchive = Join-Path $ProjectRoot "app.tgz"
$DistDirectory = Join-Path $ProjectRoot "dist"

if (-not (Test-Path -LiteralPath $Fnpack)) {
    throw "fnpack was not found: $Fnpack"
}

& npm --prefix (Join-Path $ProjectRoot "panel") test
if ($LASTEXITCODE -ne 0) {
    throw "Panel tests failed"
}

foreach ($Command in @("main", "install_init", "install_callback", "uninstall_init", "uninstall_callback", "upgrade_init", "upgrade_callback", "config_init", "config_callback")) {
    $Path = Join-Path $ProjectRoot "cmd\$Command"
    $Content = [IO.File]::ReadAllText($Path)
    [IO.File]::WriteAllText($Path, $Content.Replace("`r`n", "`n"), [Text.UTF8Encoding]::new($false))
}

if (Test-Path -LiteralPath $AppArchive) {
    Remove-Item -LiteralPath $AppArchive -Force
}

& tar.exe -czf $AppArchive -C (Join-Path $ProjectRoot "app") .
if ($LASTEXITCODE -ne 0) {
    throw "Failed to create app.tgz"
}

$ManifestPath = Join-Path $ProjectRoot "manifest"
$Manifest = Get-Content -LiteralPath $ManifestPath -Raw
$Manifest = [regex]::Replace($Manifest, "(?m)^checksum\s*=.*\r?\n?", "")
$Hash = (Get-FileHash -LiteralPath $AppArchive -Algorithm MD5).Hash.ToLowerInvariant()
[IO.File]::WriteAllText($ManifestPath, $Manifest.TrimEnd() + "`nchecksum=$Hash`n", [Text.UTF8Encoding]::new($false))

Push-Location $ProjectRoot
try {
    & $Fnpack build
    if ($LASTEXITCODE -ne 0) {
        throw "fnpack build failed"
    }
}
finally {
    Pop-Location
}

New-Item -ItemType Directory -Path $DistDirectory -Force | Out-Null
$ManifestValues = @{}
Get-Content -LiteralPath $ManifestPath | ForEach-Object {
    if ($_ -match "^([^=;]+?)\s*=\s*(.*)$") {
        $ManifestValues[$Matches[1].Trim()] = $Matches[2].Trim()
    }
}
$OutputName = "$($ManifestValues.appname)-$($ManifestValues.version)-$($ManifestValues.platform).fpk"
$FinalPackage = Join-Path $DistDirectory $OutputName
$PackupDirectory = Join-Path $ProjectRoot ".build\packup"
if (Test-Path -LiteralPath $PackupDirectory) {
    Remove-Item -LiteralPath $PackupDirectory -Recurse -Force
}
New-Item -ItemType Directory -Path $PackupDirectory -Force | Out-Null
& tar.exe -xzf (Join-Path $ProjectRoot "$($ManifestValues.appname).fpk") -C $PackupDirectory
if ($LASTEXITCODE -ne 0) { throw "Failed to unpack fnpack output" }
Copy-Item -LiteralPath $AppArchive -Destination (Join-Path $PackupDirectory "app.tgz") -Force
Copy-Item -LiteralPath $ManifestPath -Destination (Join-Path $PackupDirectory "manifest") -Force
$PackageEntries = Get-ChildItem -LiteralPath $PackupDirectory -Force | ForEach-Object Name
& tar.exe -czf $FinalPackage -C $PackupDirectory @PackageEntries
if ($LASTEXITCODE -ne 0) { throw "Failed to package complete app.tgz" }
Remove-Item -LiteralPath (Join-Path $ProjectRoot "$($ManifestValues.appname).fpk") -Force
Write-Output (Join-Path $DistDirectory $OutputName)
