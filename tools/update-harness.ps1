param(
  [string]$ProjectPath = (Split-Path -Parent $PSScriptRoot),
  [string]$BackupRoot = (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
)

$ErrorActionPreference = 'Stop'
$source = (Resolve-Path -LiteralPath $ProjectPath).Path
$root = (Resolve-Path -LiteralPath $BackupRoot).Path
$name = Split-Path -Leaf $source
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$destination = Join-Path $root "$name-backup-$stamp"

if (Test-Path -LiteralPath $destination) {
  throw "Backup already exists: $destination"
}

New-Item -ItemType Directory -Path $destination | Out-Null
$excluded = @(
  (Join-Path $source '.git') + '\',
  (Join-Path $source 'test\node_modules') + '\',
  (Join-Path $source 'test\artifacts') + '\'
)
$sourceFiles = Get-ChildItem -LiteralPath $source -Recurse -Force -File | Where-Object {
  $full = $_.FullName
  -not ($excluded | Where-Object { $full.StartsWith($_, [StringComparison]::OrdinalIgnoreCase) })
}

foreach ($file in $sourceFiles) {
  $relative = $file.FullName.Substring($source.Length).TrimStart([char]'\', [char]'/')
  $target = Join-Path $destination $relative
  $targetDir = Split-Path -Parent $target
  if (-not (Test-Path -LiteralPath $targetDir)) {
    New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
  }
  Copy-Item -LiteralPath $file.FullName -Destination $target
}

$verified = 0
foreach ($file in $sourceFiles) {
  $relative = $file.FullName.Substring($source.Length).TrimStart([char]'\', [char]'/')
  $copy = Join-Path $destination $relative
  if (-not (Test-Path -LiteralPath $copy)) {
    throw "Backup is missing: $relative"
  }
  $left = (Get-FileHash -Algorithm SHA256 -LiteralPath $file.FullName).Hash
  $right = (Get-FileHash -Algorithm SHA256 -LiteralPath $copy).Hash
  if ($left -ne $right) {
    throw "Backup hash mismatch: $relative"
  }
  $verified++
}

[pscustomobject]@{
  source = $source
  backup = $destination
  files = $verified
  verified = $true
} | ConvertTo-Json
