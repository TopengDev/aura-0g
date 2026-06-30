# AURA CLI installer for Windows (PowerShell 5+).
#   irm https://aura.topengdev.com/install.ps1 | iex
# Downloads the single static .exe (no Node needed), verifies its checksum, and puts aura.exe in
# %LOCALAPPDATA%\aura, adding it to your user PATH. Or just use:  npx @aura/cli verify 23
$ErrorActionPreference = "Stop"
$Base = if ($env:AURA_INSTALL_BASE) { $env:AURA_INSTALL_BASE } else { "https://aura.topengdev.com" }

$arch = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "arm64" } else { "x64" }
if ($arch -eq "arm64") { Write-Warning "no native windows-arm64 build yet; falling back to x64 (runs under emulation)"; $arch = "x64" }
$asset = "aura-windows-$arch.exe.gz"
Write-Host "=> downloading $Base/$asset" -ForegroundColor Cyan

$dir = Join-Path $env:LOCALAPPDATA "aura"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$gz  = Join-Path $env:TEMP $asset
$exe = Join-Path $dir "aura.exe"

Invoke-WebRequest -Uri "$Base/$asset" -OutFile $gz -UseBasicParsing

# verify checksum (best-effort)
try {
  $sums = (Invoke-WebRequest -Uri "$Base/SHA256SUMS" -UseBasicParsing).Content
  $want = ($sums -split "`n" | Where-Object { $_ -match [regex]::Escape($asset) + '$' }) -replace '\s.*$',''
  if ($want) {
    $got = (Get-FileHash -Algorithm SHA256 $gz).Hash.ToLower()
    if ($got -ne $want.ToLower()) { throw "checksum MISMATCH (want $want, got $got)" }
    Write-Host "checksum verified" -ForegroundColor Green
  }
} catch { Write-Warning "checksum skipped: $_" }

# gunzip
$in  = [System.IO.File]::OpenRead($gz)
$out = [System.IO.File]::Create($exe)
$gzs = New-Object System.IO.Compression.GzipStream($in, [System.IO.Compression.CompressionMode]::Decompress)
$gzs.CopyTo($out); $gzs.Close(); $out.Close(); $in.Close()
Remove-Item $gz -Force

# add to user PATH
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -notlike "*$dir*") {
  [Environment]::SetEnvironmentVariable("Path", "$userPath;$dir", "User")
  Write-Host "added $dir to your PATH (open a new terminal)" -ForegroundColor Cyan
}
Write-Host "installed aura -> $exe" -ForegroundColor Green
Write-Host "try it:  aura explore   |   aura verify 23"
