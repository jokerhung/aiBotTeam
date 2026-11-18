#!/usr/bin/env bash
# Installs BotTeam on a new macOS or Linux computer: Git, Node.js, Python and uv when they are missing, then the project's own dependencies.
#
#   bash install.sh                      # from a clone of the repository
#   curl -fsSL https://raw.githubusercontent.com/jokerhung/aiBotTeam/master/install.sh | bash    # on a computer with nothing yet
#
# Options (after `bash -s --` when piped):
#   --dir PATH        where to clone the repository when the script is not inside one (default: ~/aiBotTeam)
#   --repo URL        the repository to clone
#   --claude          also install the Claude Code CLI (npm @anthropic-ai/claude-code); you sign in yourself: run `claude` once
#   --codex           also install the Codex CLI (npm @openai/codex); you sign in yourself: run `codex login`
#   --browser         also download Playwright's Chromium (about 150 MB) for the bots' built-in browser
#   --skip-build      do not build the static web app (`pnpm dev` does not need it; `botteam serve` does)
#   --dry-run         print what would be done and change nothing
#   -h, --help        this text
#
# What it does, skipping whatever is already there: Git, Node.js (20 or newer, 22 is installed), Python (3.10 or newer) and uv; pnpm through Corepack;
# the repository; `pnpm install` (the web app and the Node.js Zalo service in zalo-service/), `uv sync`, a .env made from .env.example and the web build. Nothing is started at the end; the last lines say how.
set -euo pipefail

DIR="$HOME/aiBotTeam"
REPO="https://github.com/jokerhung/aiBotTeam"
BROWSER=0
WANT_CLAUDE=0
WANT_CODEX=0
SKIP_BUILD=0
DRY=0
MIN_NODE=20
MIN_PY_MINOR=10  # Python 3.10

while [ $# -gt 0 ]; do
  case "$1" in
    --dir) DIR="${2:?--dir needs a path}"; shift 2 ;;
    --repo) REPO="${2:?--repo needs a URL}"; shift 2 ;;
    --browser) BROWSER=1; shift ;;
    --claude) WANT_CLAUDE=1; shift ;;
    --codex) WANT_CODEX=1; shift ;;
    --skip-build) SKIP_BUILD=1; shift ;;
    --dry-run) DRY=1; shift ;;
    -h|--help) sed -n '2,15p' "$0" 2>/dev/null | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $1 (see --help)" >&2; exit 2 ;;
  esac
done

if [ -t 1 ]; then C_CYAN=$'\033[36m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_RED=$'\033[31m'; C_DIM=$'\033[2m'; C_OFF=$'\033[0m'; else C_CYAN=""; C_GREEN=""; C_YELLOW=""; C_RED=""; C_DIM=""; C_OFF=""; fi
say()  { printf '%s==> %s%s\n' "$C_CYAN" "$1" "$C_OFF"; }
ok()   { printf '%s    ok: %s%s\n' "$C_GREEN" "$1" "$C_OFF"; }
warn() { printf '%s    warning: %s%s\n' "$C_YELLOW" "$1" "$C_OFF"; }
die()  { printf '%serror: %s%s\n' "$C_RED" "$1" "$C_OFF" >&2; exit 1; }
has()  { command -v "$1" >/dev/null 2>&1; }

run() {  # run <description> <command...>
  local what="$1"; shift
  if [ "$DRY" = 1 ]; then printf '%s    [dry run] %s%s\n' "$C_DIM" "$what" "$C_OFF"; return 0; fi
  "$@" || die "$what failed"
}
run_sh() {  # run_sh <description> <shell text>: for pipes
  local what="$1" text="$2"
  if [ "$DRY" = 1 ]; then printf '%s    [dry run] %s%s\n' "$C_DIM" "$what" "$C_OFF"; return 0; fi
  bash -c "$text" || die "$what failed"
}

# ---- the system --------------------------------------------------------------------------------------------------------------------------
OS="$(uname -s)"
SUDO=""
if [ "$(id -u)" -ne 0 ] && has sudo; then SUDO="sudo"; fi
PM=""
case "$OS" in
  Darwin) PM="brew" ;;
  Linux)
    if has apt-get; then PM="apt"; elif has dnf; then PM="dnf"; elif has yum; then PM="yum"; elif has pacman; then PM="pacman"
    elif has zypper; then PM="zypper"; elif has apk; then PM="apk"; fi ;;
  *) die "this script is for macOS and Linux; on Windows use install.ps1" ;;
esac

pm_install() {  # pm_install <what> <packages...>
  local what="$1"; shift
  case "$PM" in
    brew)   run "brew install $*" brew install "$@" ;;
    apt)    run "apt-get install $*" $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y "$@" ;;
    dnf)    run "dnf install $*" $SUDO dnf install -y "$@" ;;
    yum)    run "yum install $*" $SUDO yum install -y "$@" ;;
    pacman) run "pacman -S $*" $SUDO pacman -S --noconfirm --needed "$@" ;;
    zypper) run "zypper install $*" $SUDO zypper --non-interactive install "$@" ;;
    apk)    run "apk add $*" $SUDO apk add "$@" ;;
    *)      die "no supported package manager found: install $what by hand and run this script again" ;;
  esac
}

ensure_brew() {
  [ "$PM" = "brew" ] || return 0
  if ! has brew; then
    say "Installing Homebrew"
    run_sh "install Homebrew" 'NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'
    for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do [ -x "$b" ] && eval "$("$b" shellenv)"; done
  fi
}

refresh_path() { export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"; }

node_major() { has node && node --version | sed 's/^v//; s/\..*//' || echo 0; }
python_cmd() {  # the first python that is new enough
  for c in python3.13 python3.12 python3.11 python3.10 python3 python; do
    if has "$c" && "$c" -c "import sys; sys.exit(0 if sys.version_info >= (3, $MIN_PY_MINOR) else 1)" 2>/dev/null; then echo "$c"; return 0; fi
  done
  return 1
}

say "Checking this computer ($OS${PM:+, $PM})"
refresh_path
[ "$DRY" = 1 ] || { [ -n "$PM" ] || warn "no package manager found: missing tools will have to be installed by hand"; }

# ---- base tools: curl and certificates (a fresh Linux image may lack them) --------------------------------------------------------------
if [ "$OS" = "Linux" ] && ! has curl; then
  say "Installing curl"
  case "$PM" in apt) run "apt-get update" $SUDO apt-get update ;; esac
  pm_install curl curl ca-certificates
fi
ensure_brew
if [ "$OS" = "Linux" ] && [ "$PM" = "apt" ]; then run "apt-get update" $SUDO apt-get update; fi

# ---- Git ---------------------------------------------------------------------------------------------------------------------------------
HERE="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || true)"
IN_REPO=0
if [ -n "$HERE" ] && [ -f "$HERE/package.json" ] && [ -f "$HERE/server/pyproject.toml" ]; then IN_REPO=1; fi
if [ "$IN_REPO" = 0 ] && ! has git; then
  say "Installing Git"
  pm_install Git git
fi
has git && ok "$(git --version)"

# ---- Node.js -----------------------------------------------------------------------------------------------------------------------------
if [ "$(node_major)" -lt "$MIN_NODE" ]; then
  say "Installing Node.js 22 (found: $(has node && node --version || echo none), needed: $MIN_NODE or newer)"
  case "$PM" in
    brew)   pm_install Node.js node@22; run "link node@22" brew link --overwrite --force node@22 ;;
    apt)    run_sh "add the NodeSource repository for Node.js 22" "curl -fsSL https://deb.nodesource.com/setup_22.x | ${SUDO:+$SUDO -E }bash -"; pm_install Node.js nodejs ;;
    dnf|yum) run_sh "add the NodeSource repository for Node.js 22" "curl -fsSL https://rpm.nodesource.com/setup_22.x | ${SUDO:+$SUDO }bash -"; pm_install Node.js nodejs ;;
    pacman) pm_install Node.js nodejs npm ;;
    zypper) pm_install Node.js nodejs22 npm22 ;;
    apk)    pm_install Node.js nodejs npm ;;
    *)      die "install Node.js $MIN_NODE or newer by hand (https://nodejs.org) and run this script again" ;;
  esac
  hash -r
fi
if [ "$DRY" = 0 ] && [ "$(node_major)" -lt "$MIN_NODE" ]; then die "Node.js $MIN_NODE or newer is still not available (found: $(has node && node --version || echo none))"; fi
has node && ok "node $(node --version)"

# ---- Python ------------------------------------------------------------------------------------------------------------------------------
if ! PY="$(python_cmd)"; then
  say "Installing Python 3 (3.$MIN_PY_MINOR or newer is needed)"
  case "$PM" in
    brew)   pm_install Python python@3.12 ;;
    apt)    pm_install Python python3 python3-venv python3-pip ;;
    dnf|yum) pm_install Python python3 python3-pip ;;
    pacman) pm_install Python python python-pip ;;
    zypper) pm_install Python python3 python3-pip ;;
    apk)    pm_install Python python3 py3-pip ;;
    *)      die "install Python 3.$MIN_PY_MINOR or newer by hand and run this script again" ;;
  esac
  hash -r
  PY="$(python_cmd || true)"
fi
if [ -n "${PY:-}" ]; then ok "python $("$PY" --version 2>&1 | sed 's/Python //')"; elif [ "$DRY" = 0 ]; then warn "no Python 3.$MIN_PY_MINOR or newer on PATH; uv will download its own"; fi

# ---- uv ----------------------------------------------------------------------------------------------------------------------------------
INSTALLED_UV=0
if ! has uv; then
  INSTALLED_UV=1
  say "Installing uv"
  run_sh "install uv with the official installer" "curl -LsSf https://astral.sh/uv/install.sh | sh"
  refresh_path
fi
if [ "$DRY" = 0 ] && ! has uv; then die "uv is still not on PATH: open a new terminal and run this script again"; fi
has uv && ok "uv $(uv --version | sed 's/uv //')"

# ---- the repository ----------------------------------------------------------------------------------------------------------------------
if [ "$IN_REPO" = 1 ]; then
  ROOT="$HERE"
else
  ROOT="$DIR"
  if [ -f "$ROOT/package.json" ]; then
    say "Using the repository already at $ROOT"
  else
    say "Cloning $REPO into $ROOT"
    run "git clone" git clone "$REPO" "$ROOT"
  fi
fi
[ "$DRY" = 1 ] || cd "$ROOT"
ok "project folder: $ROOT"

# ---- pnpm --------------------------------------------------------------------------------------------------------------------------------
say "Preparing pnpm"
PNPM_V="latest"
if [ "$DRY" = 0 ]; then
  v="$(sed -n 's/.*"packageManager"[[:space:]]*:[[:space:]]*"pnpm@\([^"]*\)".*/\1/p' package.json | head -1)"
  [ -n "$v" ] && PNPM_V="$v"
fi
if [ "$DRY" = 1 ]; then
  printf '%s    [dry run] corepack enable and prepare pnpm@%s%s\n' "$C_DIM" "$PNPM_V" "$C_OFF"
else
  (corepack enable 2>/dev/null || $SUDO corepack enable 2>/dev/null || true)
  corepack prepare "pnpm@$PNPM_V" --activate 2>/dev/null || true
  if ! has pnpm; then warn "Corepack could not provide pnpm; installing it with npm"; npm install -g "pnpm@$PNPM_V" 2>/dev/null || $SUDO npm install -g "pnpm@$PNPM_V" || die "could not install pnpm"; fi
  has pnpm && ok "pnpm $(pnpm --version)"
fi

# ---- the project -------------------------------------------------------------------------------------------------------------------------
say "Installing the web dependencies (pnpm install)"
run "pnpm install --frozen-lockfile" pnpm install --frozen-lockfile

say "Installing the server dependencies (uv sync)"
run "uv sync --project server" uv sync --project server

if [ "$DRY" = 1 ]; then
  printf '%s    [dry run] create .env from .env.example when there is none%s
' "$C_DIM" "$C_OFF"
elif [ ! -f .env ] && [ -f .env.example ]; then
  say "Creating .env from .env.example"
  cp .env.example .env
fi

if [ "$SKIP_BUILD" = 0 ]; then
  say "Building the web app that 'botteam serve' serves (pnpm build:static)"
  run "pnpm build:static" pnpm build:static
fi

if [ "$BROWSER" = 1 ]; then
  say "Downloading Chromium for the bots' built-in browser"
  run "playwright install chromium" uv run --project server playwright install chromium
  if [ "$OS" = "Linux" ] && [ "$DRY" = 0 ]; then  # the system libraries Chromium needs; best effort
    $SUDO "$(command -v uv)" run --project server playwright install-deps chromium || warn "could not install Chromium's system libraries; install them by hand if the browser fails to start"
  fi
elif ! has google-chrome && ! has google-chrome-stable && ! has chromium && ! has chromium-browser && [ ! -d "/Applications/Google Chrome.app" ] && [ ! -d "/Applications/Microsoft Edge.app" ]; then
  warn "No Chrome, Chromium or Edge found: run this script again with --browser so the bots' built-in browser has one."
fi

# ---- engines (the CLIs can be installed here with --claude / --codex; signing in needs you and a browser) --------------------------------------
say "AI engines"
for e in "claude:Claude Code:@anthropic-ai/claude-code:$WANT_CLAUDE:claude (it opens a browser to sign in)" "codex:Codex:@openai/codex:$WANT_CODEX:codex login"; do
  IFS=: read -r cmd label pkg want how <<< "$e"
  if ! has "$cmd" && [ "$want" = 1 ]; then
    say "Installing the $label CLI with npm"
    if [ "$DRY" = 1 ]; then
      printf '%s    [dry run] npm install -g %s%s\n' "$C_DIM" "$pkg" "$C_OFF"
    else
      npm install -g "$pkg" 2>/dev/null || $SUDO npm install -g "$pkg" || die "could not install $label"
      hash -r
    fi
  fi
  if has "$cmd"; then
    ok "$label CLI found; sign in once with:  $how"
  elif [ "$DRY" = 1 ] && [ "$want" = 1 ]; then
    printf '%s    %s CLI would be installed; then sign in with:  %s%s\n' "$C_DIM" "$label" "$how" "$C_OFF"
  else
    warn "$label CLI not found: run this script again with --$cmd to install it, or add an OpenAI-compatible endpoint in BotTeam settings."
  fi
done

printf '\n%sBotTeam is installed in %s%s\n' "$C_GREEN" "$ROOT" "$C_OFF"
echo "  Start it for development (API, web, Zalo service):   cd \"$ROOT\" && pnpm dev"
echo "  Start it as one program (needs the web build):       cd \"$ROOT\" && pnpm start:one   (API + web build + Zalo service)"
echo "  Then open http://127.0.0.1:8899 (one program) or http://127.0.0.1:5299 (pnpm dev)."
if [ "$INSTALLED_UV" = 1 ]; then echo "  uv was just installed: open a new terminal, or run   export PATH=\"\$HOME/.local/bin:\$PATH\"   first."; fi
[ "$DRY" = 1 ] && printf '%s(dry run: nothing was changed)%s\n' "$C_YELLOW" "$C_OFF"
exit 0
