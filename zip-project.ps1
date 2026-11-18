<#
.SYNOPSIS
  Zips the project to copy it to another computer: without .venv, node_modules and the build folders, which the other computer makes again.

.DESCRIPTION
    powershell -ExecutionPolicy Bypass -File zip-project.ps1
    powershell -ExecutionPolicy Bypass -File zip-project.ps1 -KeepBuild       # with the build folders (about 650 MB)
    powershell -ExecutionPolicy Bypass -File zip-project.ps1 -Output D:\backup\botteam.zip -ExcludeGit

  The archive is written next to the project folder (not inside it), named <folder>-<date>-<time>.zip, and holds one top-level folder with the project's
  name so that it unpacks into a folder of its own. Files another program has open (a running dev server's database, for example) are read without
  locking them; a file that still cannot be read is skipped and listed at the end.

.PARAMETER Output      The zip file to write (default: ..\<project folder>-<yyyyMMdd-HHmm>.zip).
.PARAMETER ExcludeGit  Also leave out the .git folder (the history).
.PARAMETER Exclude     More folder or file names to leave out, at any depth, for example -Exclude .next,.next-export.
.PARAMETER KeepBuild  Keep the build folders in the archive (by default they are left out: .next (the dev cache, about 600 MB), .next-export, webui (the web build the
                      server serves), dist, .turbo, __pycache__ and *.pyc, .pytest_cache, .ruff_cache, *.tsbuildinfo, and the e2e shots and actual folders).
.PARAMETER NoRootFolder  Put the files at the top of the archive instead of inside a folder with the project's name.
#>
[CmdletBinding()]
param(
  [string]$Output,
  [switch]$ExcludeGit,
  [switch]$KeepBuild,
  [string[]]$Exclude = @(),
  [switch]$NoRootFolder
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$root = (Resolve-Path $PSScriptRoot).Path.TrimEnd('\')
$name = Split-Path $root -Leaf
if (-not $Output) { $Output = Join-Path (Split-Path $root -Parent) ("{0}-{1}.zip" -f $name, (Get-Date -Format "yyyyMMdd-HHmm")) }
$Output = [System.IO.Path]::GetFullPath($Output)
if (Test-Path $Output) { Remove-Item $Output -Force }
New-Item -ItemType Directory -Force -Path (Split-Path $Output -Parent) | Out-Null

$skip = @(".venv", "node_modules", "workspaces") + $Exclude  # workspaces/ holds the working folders of bots: data, not code
if ($ExcludeGit) { $skip += ".git" }
$skipFiles = @()
if (-not $KeepBuild) {
  $skip += @(".next", ".next-export", "webui", "dist", ".turbo", "__pycache__", ".pytest_cache", ".ruff_cache", "shots", "actual")
  $skipFiles = @("*.pyc", "*.tsbuildinfo")
}
$skip = $skip | ForEach-Object { $_.ToLowerInvariant() }

$prefix = if ($NoRootFolder) { "" } else { "$name/" }
$count = 0
$bytes = 0L
$skipped = New-Object System.Collections.Generic.List[string]
$dirs = 0

$stream = [System.IO.File]::Open($Output, [System.IO.FileMode]::Create)
$zip = New-Object System.IO.Compression.ZipArchive($stream, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  $pending = New-Object System.Collections.Generic.Stack[string]
  $pending.Push($root)
  while ($pending.Count -gt 0) {
    $dir = $pending.Pop()
    $dirs++
    $rel = if ($dir.Length -gt $root.Length) { $dir.Substring($root.Length + 1).Replace('\', '/') } else { "" }
    $entries = @(Get-ChildItem -LiteralPath $dir -Force -ErrorAction SilentlyContinue)
    if ($rel -ne "" -and $entries.Count -eq 0) { [void]$zip.CreateEntry("$prefix$rel/") }  # an empty folder is kept
    foreach ($item in $entries) {
      if ($skip -contains $item.Name.ToLowerInvariant()) { continue }
      if (-not $item.PSIsContainer -and ($skipFiles | Where-Object { $item.Name -like $_ })) { continue }
      if ($item.PSIsContainer) {
        if ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) { continue }  # a link could lead out of the project or loop
        $pending.Push($item.FullName)
        continue
      }
      if ($item.FullName -ieq $Output) { continue }  # never the archive itself
      $entryName = ("$prefix" + $(if ($rel) { "$rel/" } else { "" }) + $item.Name)
      try {
        $in = New-Object System.IO.FileStream($item.FullName, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, ([System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete))
        try {
          $entry = $zip.CreateEntry($entryName, [System.IO.Compression.CompressionLevel]::Optimal)
          $entry.LastWriteTime = [DateTimeOffset]$item.LastWriteTime
          $out = $entry.Open()
          try { $in.CopyTo($out) } finally { $out.Dispose() }
        } finally { $in.Dispose() }
        $count++
        $bytes += $item.Length
      } catch {
        $skipped.Add("$($item.FullName.Substring($root.Length + 1)): $($_.Exception.Message.Split("`n")[0])")
      }
    }
  }
} finally {
  $zip.Dispose()
  $stream.Dispose()
}

$size = (Get-Item $Output).Length
Write-Host ("Zipped {0} files from {1} folders ({2:N1} MB) into {3:N1} MB:" -f $count, $dirs, ($bytes / 1MB), ($size / 1MB)) -ForegroundColor Green
Write-Host "  $Output"
Write-Host ("  left out: {0}" -f (($skip | Select-Object -Unique) -join ", ")) -ForegroundColor DarkGray
if ($skipped.Count -gt 0) {
  Write-Host ("{0} file(s) could not be read and are not in the archive:" -f $skipped.Count) -ForegroundColor Yellow
  $skipped | Select-Object -First 20 | ForEach-Object { Write-Host "  $_" -ForegroundColor Yellow }
}
