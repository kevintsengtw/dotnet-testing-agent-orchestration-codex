param(
    [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
    [string]$CodexHome,
    [switch]$RemoveLegacyFullScripts
)

$ErrorActionPreference = "Stop"

$nodeInstaller = Join-Path $PSScriptRoot "install-codex-assets.mjs"
$arguments = @($nodeInstaller, "--repo-root", $RepoRoot)
if (-not [string]::IsNullOrWhiteSpace($CodexHome)) {
    $arguments += @("--codex-home", $CodexHome)
}
if ($RemoveLegacyFullScripts) {
    $arguments += "--remove-legacy-full-scripts"
}

& node @arguments
if ($LASTEXITCODE -ne 0) {
    throw "Codex asset installer failed with exit code $LASTEXITCODE."
}
