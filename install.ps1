<#
.SYNOPSIS
  Installs BotTeam on a new Windows computer: Git, Node.js, Python and uv when they are missing, then the project's own dependencies.

.DESCRIPTION
  Run it from a clone of the repository, or on its own (it then clones the repository first):

    powershell -ExecutionPolicy Bypass -File install.ps1
    # on a computer with nothing yet: download the script, then run it
    iwr -useb https://raw.githubusercontent.com/jokerhung/aiBotTeam/master/install.ps1 -OutFile install.ps1
    powershell -ExecutionPolicy Bypass -File install.ps1

  What it does, skipping whatever is already there:
    1. Git, Node.js (LTS, 20 or newer), Python (3.10 or newer; 3.12 is installed) and uv, through winget
    2. pnpm (through Corepack, at the version package.json asks for)
    3. the repository (only when the script is not already inside one)
    4. `pnpm install` (the web app and the Node.js Zalo service, zalo-service/), `uv sync`, a .env made from .env.example, and the web build the one-command server serves
    5. with -Browser, the Chromium that the bots' built-in browser can use when Edge and Chrome are missing

  Nothing is started at the end; the last lines say how.

.PARAMETER Dir        Where to clone the repository when the script is not inside one (default: $HOME\aiBotTeam).
.PARAMETER RepoUrl    The repository to clone.
.PARAMETER Browser    Also download Playwright's Chromium (about 150 MB).
.PARAMETER Claude     Also install the Claude Code CLI (npm package @anthropic-ai/claude-code). You still sign in yourself: run `claude` once.
.PARAMETER Codex      Also install the Codex CLI (npm package @openai/codex). You still sign in yourself: run `codex login`.
.PARAMETER SkipBuild  Do not build the static web app (`pnpm dev` does not need it; `botteam serve` does).
.PARAMETER DryRun     Print what would be done and change nothing.
#>
[CmdletBinding()]
param(
  [string]$Dir = (Join-Path $HOME "aiBotTeam"),
  [string]$RepoUrl = "https://github.com/jokerhung/aiBotTeam",
  [switch]$Browser,
  [switch]$Claude,
  [switch]$Codex,
  [switch]$SkipBuild,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$MinNode = 20
$MinPython = [version]"3.10"

$script:Installed = $false

function Say([string]$m) { Write-Host "==> $m" -ForegroundColor Cyan }
function Ok([string]$m) { Write-Host "    ok: $m" -ForegroundColor Green }
function Warn([string]$m) { Write-Host "    warning: $m" -ForegroundColor Yellow }
function Fail([string]$m) { Write-Host "error: $m" -ForegroundColor Red; exit 1 }

function Has([string]$name) { return [bool](Get-Command $name -ErrorAction SilentlyContinue) }

# A tool installed a moment ago is not on this session's PATH yet: read it again from the registry.
function Update-Path {
  $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $user = [Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = (($machine, $user) -join ";") + ";" + (Join-Path $HOME ".local\bin") + ";" + (Join-Path $HOME ".cargo\bin")
}

function Run([string]$what, [scriptblock]$block) {
  if ($DryRun) { Write-Host "    [dry run] $what" -ForegroundColor DarkGray; return }
  $global:LASTEXITCODE = 0
  & $block
  if ($LASTEXITCODE -ne 0) { Fail "$what failed (exit code $LASTEXITCODE)" }
}

function Winget-Install([string]$id, [string]$label) {
  if (-not (Has "winget")) {
    Fail "$label is missing and winget is not available. Install '$label' by hand (or update 'App Installer' from the Microsoft Store), then run this script again."
  }
  if ($DryRun) { Write-Host "    [dry run] winget install $id" -ForegroundColor DarkGray; return }
  $global:LASTEXITCODE = 0
  winget install --id $id -e --silent --accept-package-agreements --accept-source-agreements
  # -1978335189 is winget saying the package is already installed and there is nothing newer
  if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne -1978335189) { Fail "winget could not install $label (exit code $LASTEXITCODE)" }
  $script:Installed = $true
  Update-Path
}

function Node-Major {
  if (-not (Has "node")) { return 0 }
  $v = (& node --version) -replace "^v", ""
  return [int]($v.Split(".")[0])
}

function Python-Version {
  foreach ($c in @("python", "python3", "py")) {
    if (Has $c) {
      try {
        $out = & $c --version 2>&1
        if ("$out" -match "Python (\d+\.\d+)") { return [version]$Matches[1] }
      } catch { }
    }
  }
  return $null
}

Say "Checking this computer"
Update-Path

# ---- Git ----------------------------------------------------------------------------------------------------------------------------
$here = $PSScriptRoot
$inRepo = $here -and (Test-Path (Join-Path $here "package.json")) -and (Test-Path (Join-Path $here "server\pyproject.toml"))
if (-not $inRepo -and -not (Has "git")) {
  Say "Installing Git"
  Winget-Install "Git.Git" "Git"
}
if (Has "git") { Ok "git $((& git --version) -replace 'git version ', '')" }

# ---- Node.js ------------------------------------------------------------------------------------------------------------------------
if ((Node-Major) -lt $MinNode) {
  Say "Installing Node.js LTS (found: $(if (Has 'node') { & node --version } else { 'none' }), needed: $MinNode or newer)"
  Winget-Install "OpenJS.NodeJS.LTS" "Node.js"
}
if (-not $DryRun -and (Node-Major) -lt $MinNode) { Fail "Node.js $MinNode or newer is still not on PATH. Open a new terminal and run this script again." }
if (Has "node") { Ok "node $(& node --version)" }

# ---- Python -------------------------------------------------------------------------------------------------------------------------
$py = Python-Version
if (-not $py -or $py -lt $MinPython) {
  Say "Installing Python 3.12 (found: $(if ($py) { $py } else { 'none' }), needed: $MinPython or newer)"
  Winget-Install "Python.Python.3.12" "Python"
  $py = Python-Version
}
if ($py) { Ok "python $py" } elseif (-not $DryRun) { Warn "Python is not on PATH in this window yet; uv will use its own copy." }

# ---- uv (runs the Python side) --------------------------------------------------------------------------------------------------------
if (-not (Has "uv")) {
  Say "Installing uv"
  if (Has "winget") {
    Winget-Install "astral-sh.uv" "uv"
  } else {
    Run "install uv with the official installer" { Invoke-RestMethod https://astral.sh/uv/install.ps1 | Invoke-Expression }
    Update-Path
  }
}
if (-not $DryRun -and -not (Has "uv")) { Fail "uv is still not on PATH. Open a new terminal and run this script again." }
if (Has "uv") { Ok "uv $(((& uv --version) -split ' ')[1])" }

# ---- the repository -----------------------------------------------------------------------------------------------------------------
if ($inRepo) {
  $root = $here
} else {
  $root = $Dir
  if (Test-Path (Join-Path $root "package.json")) {
    Say "Using the repository already at $root"
  } else {
    Say "Cloning $RepoUrl into $root"
    Run "git clone" { git clone $RepoUrl $root }
  }
}
if (-not $DryRun) { Set-Location $root }
Ok "project folder: $root"

# ---- pnpm ---------------------------------------------------------------------------------------------------------------------------
Say "Preparing pnpm"
$pnpmVersion = "latest"
if (Test-Path (Join-Path $root "package.json")) {
  $pkg = Get-Content (Join-Path $root "package.json") -Raw | ConvertFrom-Json
  if ($pkg.packageManager -match "^pnpm@(.+)$") { $pnpmVersion = $Matches[1] }
}
function Pnpm-Version { if (Has "pnpm") { try { return ((& pnpm --version 2>$null) | Select-Object -First 1).ToString().Trim() } catch { return "" } } return "" }
if ((Pnpm-Version) -ne $pnpmVersion) {
  # Corepack comes with Node.js up to version 24 (Node 25 and newer no longer ship it): use it when it is there, otherwise npm installs pnpm.
  if (Has "corepack") {
    if ($DryRun) {
      Write-Host "    [dry run] corepack enable and prepare pnpm@$pnpmVersion" -ForegroundColor DarkGray
    } else {
      try { & corepack enable 2>$null } catch { }
      try { & corepack prepare "pnpm@$pnpmVersion" --activate 2>$null } catch { }
      Update-Path
    }
  }
  if (-not $DryRun -and (Pnpm-Version) -eq "") {
    if (-not (Has "npm")) { Fail "Neither Corepack nor npm was found next to Node.js. Open a new terminal and run this script again, or install pnpm by hand (https://pnpm.io/installation)." }
    Say "Installing pnpm with npm (Corepack is not part of this Node.js)"
    Run "npm install -g pnpm@$pnpmVersion" { npm install -g "pnpm@$pnpmVersion" }
    Update-Path
    if ((Pnpm-Version) -eq "") {
      # npm's global folder is not on PATH on this computer: add it for this window and for the user, so that pnpm (and start.bat) find it
      $npmBin = ((& npm prefix -g 2>$null) | Select-Object -First 1).ToString().Trim()
      if ($npmBin -and (Test-Path (Join-Path $npmBin "pnpm.cmd"))) {
        $env:Path = "$npmBin;$env:Path"
        $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
        if (($userPath -split ";") -notcontains $npmBin) { [Environment]::SetEnvironmentVariable("Path", "$npmBin;$userPath", "User") }
        $script:Installed = $true
        Ok "added $npmBin to PATH"
      }
    }
  } elseif ($DryRun -and -not (Has "corepack")) {
    Write-Host "    [dry run] npm install -g pnpm@$pnpmVersion" -ForegroundColor DarkGray
  }
}
if (-not $DryRun -and (Pnpm-Version) -eq "") { Fail "pnpm is still not on PATH. Open a new terminal and run this script again." }
if (Has "pnpm") { Ok "pnpm $(& pnpm --version)" }

# ---- the project --------------------------------------------------------------------------------------------------------------------
Say "Installing the web dependencies (pnpm install)"
Run "pnpm install --frozen-lockfile" { pnpm install --frozen-lockfile }

Say "Installing the server dependencies (uv sync)"
Run "uv sync --project server" { uv sync --project server }

if (-not (Test-Path ".env") -and (Test-Path ".env.example")) {
  Say "Creating .env from .env.example"
  Run "copy .env.example .env" { Copy-Item ".env.example" ".env" }
}

if (-not $SkipBuild) {
  Say "Building the web app that 'botteam serve' serves (pnpm build:static)"
  Run "pnpm build:static" { pnpm build:static }
}

if ($Browser) {
  Say "Downloading Chromium for the bots' built-in browser"
  Run "playwright install chromium" { uv run --project server playwright install chromium }
} else {
  $hasBrowser = (Test-Path "$env:ProgramFiles\Google\Chrome\Application\chrome.exe") -or (Test-Path "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe") -or (Test-Path "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe")
  if (-not $hasBrowser) { Warn "Neither Edge nor Chrome was found: run this script again with -Browser so the bots' built-in browser has one." }
}

# ---- engines (the CLIs can be installed here with -Claude / -Codex; signing in needs you and a browser) ------------------------------------
Say "AI engines"
$engines = @(@("claude", "Claude Code", "@anthropic-ai/claude-code", $Claude, "claude   (it opens a browser to sign in)"), @("codex", "Codex", "@openai/codex", $Codex, "codex login"))
foreach ($e in $engines) {
  if (-not (Has $e[0]) -and $e[3]) {
    Say "Installing the $($e[1]) CLI with npm"
    Run "npm install -g $($e[2])" { npm install -g $e[2] }
    Update-Path
    if (-not $DryRun -and -not (Has $e[0])) {
      $npmBin = ((& npm prefix -g 2>$null) | Select-Object -First 1).ToString().Trim()
      if ($npmBin -and (Test-Path $npmBin)) { $env:Path = "$npmBin;$env:Path" }
    }
  }
  if (Has $e[0]) {
    Ok "$($e[1]) CLI found; sign in once with:  $($e[4])"
  } elseif ($DryRun -and $e[3]) {
    Write-Host "    $($e[1]) CLI would be installed; then sign in with:  $($e[4])" -ForegroundColor DarkGray
  } else {
    Write-Host "    $($e[1]) CLI not found: run this script again with -$($e[1].Split(' ')[0]) to install it, or add an OpenAI-compatible endpoint in BotTeam's settings." -ForegroundColor Yellow
  }
}

# Antigravity (agy) has its own installer from Google, so this script only looks for it and says how to sign in.
$agy = (Has "agy") -or (Test-Path (Join-Path $env:LOCALAPPDATA "agy\bin\agy.exe"))
if ($agy) { Ok "Antigravity CLI found; sign in once with:  agy   (it opens a browser to sign in)" }
else { Write-Host "    Antigravity CLI (agy) not found: optional. Install it from antigravity.google, then sign in once with:  agy" -ForegroundColor DarkGray }

Write-Host ""
Write-Host "BotTeam is installed in $root" -ForegroundColor Green
Write-Host "  Start it for development (API, web, Zalo service):   .\start.bat        (frees the ports first, then runs pnpm dev)"
Write-Host "  Start it as one program (needs the web build):       pnpm start:one        (API + web build + Zalo service)"
Write-Host "  Then open http://127.0.0.1:8899 (one program) or http://127.0.0.1:5299 (pnpm dev)."
if ($script:Installed) { Write-Host "  Tools were just installed: open a new terminal window before running the commands above, so that they are on PATH." -ForegroundColor Yellow }
if ($DryRun) { Write-Host "(dry run: nothing was changed)" -ForegroundColor Yellow }
