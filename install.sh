#!/bin/sh
# install.sh — Download and install the ixora CLI
# Usage: curl -LsSf https://raw.githubusercontent.com/ibmi-agi/ixora-cli/main/install.sh | sh
set -e

REPO="ibmi-agi/ixora-cli"
BIN_DIR="$HOME/.local/bin"
BIN_PATH="$BIN_DIR/ixora"

# ---------------------------------------------------------------------------
# Color helpers (only when connected to a terminal)
# ---------------------------------------------------------------------------
if [ -t 1 ]; then
    RED=$(printf '\033[0;31m')
    GREEN=$(printf '\033[0;32m')
    YELLOW=$(printf '\033[1;33m')
    BLUE=$(printf '\033[0;34m')
    BOLD=$(printf '\033[1m')
    DIM=$(printf '\033[2m')
    RESET=$(printf '\033[0m')
else
    RED='' GREEN='' YELLOW='' BLUE='' BOLD='' DIM='' RESET=''
fi

info()    { printf "${BLUE}==>${RESET} ${BOLD}%s${RESET}\n" "$*"; }
success() { printf "${GREEN}==>${RESET} ${BOLD}%s${RESET}\n" "$*"; }
warn()    { printf "${YELLOW}Warning:${RESET} %s\n" "$*"; }
error()   { printf "${RED}Error:${RESET} %s\n" "$*" >&2; }
die()     { error "$*"; exit 1; }

# ---------------------------------------------------------------------------
# Detect download tool
# ---------------------------------------------------------------------------
download() {
    _url="$1"
    _dest="$2"
    if command -v curl >/dev/null 2>&1; then
        curl -fsSL "$_url" -o "$_dest"
    elif command -v wget >/dev/null 2>&1; then
        wget -qO "$_dest" "$_url"
    else
        die "Neither curl nor wget found. Please install one and retry."
    fi
}

# ---------------------------------------------------------------------------
# Resolve latest version from GitHub API (optional, falls back to main)
# ---------------------------------------------------------------------------
resolve_url() {
    # Try to get the latest release asset first
    _api_url="https://api.github.com/repos/${REPO}/releases/latest"
    _asset_url=""

    if command -v curl >/dev/null 2>&1; then
        _release_json=$(curl -fsSL "$_api_url" 2>/dev/null || echo "")
    elif command -v wget >/dev/null 2>&1; then
        _release_json=$(wget -qO- "$_api_url" 2>/dev/null || echo "")
    fi

    if [ -n "$_release_json" ]; then
        # Extract ixora.sh asset URL (portable: no jq dependency)
        _asset_url=$(printf '%s' "$_release_json" \
            | grep -o '"browser_download_url"[[:space:]]*:[[:space:]]*"[^"]*ixora\.sh"' \
            | head -1 \
            | grep -o 'https://[^"]*' || true)
    fi

    if [ -n "$_asset_url" ]; then
        printf '%s' "$_asset_url"
    else
        # Fall back to raw main branch
        printf 'https://raw.githubusercontent.com/%s/main/ixora.sh' "$REPO"
    fi
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
main() {
    printf '\n'
    info "Installing ixora CLI"
    printf '\n'

    # Resolve download URL
    _url=$(resolve_url)
    info "Downloading from: ${DIM}${_url}${RESET}"

    # Create bin directory
    mkdir -p "$BIN_DIR"

    # Download to a temp file first, then move (atomic-ish)
    _tmp="${BIN_PATH}.tmp.$$"
    trap 'rm -f "$_tmp"' EXIT

    download "$_url" "$_tmp"

    # Verify we got a shell script (not an HTML error page)
    if ! head -1 "$_tmp" | grep -q '^#!/bin/sh'; then
        die "Downloaded file does not appear to be a valid script. Check the URL and try again."
    fi

    mv "$_tmp" "$BIN_PATH"
    chmod +x "$BIN_PATH"

    # Check PATH
    case ":$PATH:" in
        *":$BIN_DIR:"*)
            ;;
        *)
            warn "$BIN_DIR is not in your PATH"
            _shell_name="$(basename "${SHELL:-/bin/sh}")"
            case "$_shell_name" in
                zsh)  _rc_file="~/.zshrc" ;;
                bash) _rc_file="~/.bashrc" ;;
                *)    _rc_file="~/.profile" ;;
            esac
            printf "  Add it with: ${BOLD}echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> %s${RESET}\n" "$_rc_file"
            printf "  Then: ${BOLD}source %s${RESET}\n" "$_rc_file"
            printf '\n'
            ;;
    esac

    success "Installed ixora to $BIN_PATH"
    printf '\n'
    printf "  Get started:\n"
    printf "    ${BOLD}ixora install${RESET}    # Interactive setup (IBM i connection, model provider)\n"
    printf "    ${BOLD}ixora --help${RESET}     # See all commands\n"
    printf '\n'
}

main
