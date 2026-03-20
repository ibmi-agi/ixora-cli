#!/bin/sh
# ixora.sh — Self-contained deployment script for ixora AI agents on IBM i
# https://github.com/ibmi-agi/ixora
#
# Usage: ixora.sh [command] [options]
# Run with --help for full usage information.

set -e

# Restore terminal echo on exit (in case we die during a password prompt)
trap 'stty echo 2>/dev/null || true' EXIT

IXORA_DIR="$HOME/.ixora"
COMPOSE_FILE="$IXORA_DIR/docker-compose.yml"
ENV_FILE="$IXORA_DIR/.env"
SCRIPT_VERSION="0.0.5"
HEALTH_TIMEOUT=30

# ---------------------------------------------------------------------------
# Color / formatting helpers
# ---------------------------------------------------------------------------
if [ -t 1 ]; then
    RED=$(printf '\033[0;31m')
    GREEN=$(printf '\033[0;32m')
    YELLOW=$(printf '\033[1;33m')
    BLUE=$(printf '\033[0;34m')
    CYAN=$(printf '\033[0;36m')
    BOLD=$(printf '\033[1m')
    DIM=$(printf '\033[2m')
    RESET=$(printf '\033[0m')
else
    RED='' GREEN='' YELLOW='' BLUE='' CYAN='' BOLD='' DIM='' RESET=''
fi

info()    { printf "${BLUE}==>${RESET} ${BOLD}%s${RESET}\n" "$*"; }
success() { printf "${GREEN}==>${RESET} ${BOLD}%s${RESET}\n" "$*"; }
warn()    { printf "${YELLOW}Warning:${RESET} %s\n" "$*"; }
error()   { printf "${RED}Error:${RESET} %s\n" "$*" >&2; }
die()     { error "$*"; exit 1; }

# ---------------------------------------------------------------------------
# Detect compose command
# ---------------------------------------------------------------------------
COMPOSE_CMD=""

detect_compose_cmd() {
    # If --runtime was specified, use that directly
    if [ -n "$OPT_RUNTIME" ]; then
        case "$OPT_RUNTIME" in
            docker)  COMPOSE_CMD="docker compose" ;;
            podman)  COMPOSE_CMD="podman compose" ;;
            *)       die "Unknown runtime: $OPT_RUNTIME (choose: docker, podman)" ;;
        esac
    elif command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
        COMPOSE_CMD="docker compose"
    elif command -v podman >/dev/null 2>&1 && podman compose version >/dev/null 2>&1; then
        COMPOSE_CMD="podman compose"
    elif command -v docker-compose >/dev/null 2>&1; then
        COMPOSE_CMD="docker-compose"
    else
        die "Neither 'docker compose', 'podman compose', nor 'docker-compose' found. Please install Docker or Podman first."
    fi

    # Verify the container runtime is actually running
    case "$COMPOSE_CMD" in
        docker*)  docker info >/dev/null 2>&1 || die "Docker Desktop is not running. Please start it and try again." ;;
        podman*)  podman info >/dev/null 2>&1 || die "Podman is not running. Please start it and try again." ;;
    esac
}

# ---------------------------------------------------------------------------
# Compose runner — always operates in ~/.ixora with the right files
# ---------------------------------------------------------------------------
run_compose() {
    $COMPOSE_CMD -p ixora -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@" || {
        _rc=$?
        error "Command failed: $COMPOSE_CMD $*"
        printf "  Check ${BOLD}ixora logs${RESET} for details.\n" >&2
        exit $_rc
    }
}

# ---------------------------------------------------------------------------
# Write the embedded docker-compose.yml
# ---------------------------------------------------------------------------
write_compose_file() {
    mkdir -p "$IXORA_DIR"
    cat > "$COMPOSE_FILE" <<'COMPOSEYML'
services:
  agentos-db:
    image: agnohq/pgvector:18
    restart: unless-stopped
    ports:
      - "${DB_PORT:-5432}:5432"
    environment:
      POSTGRES_USER: ${DB_USER:-ai}
      POSTGRES_PASSWORD: ${DB_PASS:-ai}
      POSTGRES_DB: ${DB_DATABASE:-ai}
    volumes:
      - pgdata:/var/lib/postgresql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DB_USER:-ai}"]
      interval: 5s
      timeout: 5s
      retries: 5

  ibmi-mcp-server:
    image: ghcr.io/ibmi-agi/ixora-mcp-server:${IXORA_VERSION:-latest}
    restart: unless-stopped
    ports:
      - "3010:3010"
    environment:
      DB2i_HOST: ${DB2i_HOST}
      DB2i_USER: ${DB2i_USER}
      DB2i_PASS: ${DB2i_PASS}
      DB2_PORT: ${DB2_PORT:-8076}
      MCP_TRANSPORT_TYPE: http
      MCP_SESSION_MODE: stateless
      YAML_AUTO_RELOAD: "true"
      TOOLS_YAML_PATH: /usr/src/app/tools
      YAML_ALLOW_DUPLICATE_SOURCES: "true"
      IBMI_ENABLE_EXECUTE_SQL: "true"
      IBMI_ENABLE_DEFAULT_TOOLS: "true"
      MCP_AUTH_MODE: "none"
      IBMI_HTTP_AUTH_ENABLED: "false"
      MCP_RATE_LIMIT_ENABLED: "true"
      MCP_RATE_LIMIT_MAX_REQUESTS: "5000"
      MCP_RATE_LIMIT_WINDOW_MS: "60000"
      MCP_RATE_LIMIT_SKIP_DEV: "true"
    depends_on:
      agentos-db:
        condition: service_healthy
    healthcheck:
      test: ["CMD-SHELL", "node -e \"fetch('http://localhost:3010/healthz').then(function(r){process.exit(r.ok?0:1)}).catch(function(){process.exit(1)})\""]
      interval: 5s
      timeout: 5s
      retries: 5
      start_period: 3s

  api:
    image: ghcr.io/ibmi-agi/ixora-api:${IXORA_VERSION:-latest}
    command: uvicorn app.main:app --host 0.0.0.0 --port 8000
    restart: unless-stopped
    ports:
      - "8000:8000"
    environment:
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY:-}
      OPENAI_API_KEY: ${OPENAI_API_KEY:-}
      GOOGLE_API_KEY: ${GOOGLE_API_KEY:-}
      OLLAMA_HOST: ${OLLAMA_HOST:-http://host.docker.internal:11434}
      IXORA_AGENT_MODEL: ${IXORA_AGENT_MODEL:-anthropic:claude-sonnet-4-6}
      IXORA_TEAM_MODEL: ${IXORA_TEAM_MODEL:-anthropic:claude-haiku-4-5}
      DB_HOST: agentos-db
      DB_PORT: "5432"
      DB_USER: ${DB_USER:-ai}
      DB_PASS: ${DB_PASS:-ai}
      DB_DATABASE: ${DB_DATABASE:-ai}
      MCP_URL: http://ibmi-mcp-server:3010/mcp
      IAASSIST_DEPLOYMENT_CONFIG: app/config/deployments/${IXORA_PROFILE:-full}.yaml
      DATA_DIR: /data
      RUNTIME_ENV: docker
      WAIT_FOR_DB: "True"
      RAG_API_URL: ${RAG_API_URL:-}
      RAG_API_TIMEOUT: ${RAG_API_TIMEOUT:-120}
      AUTH_ENABLED: "false"
      MCP_AUTH_MODE: "none"
    volumes:
      - agentos-data:/data
    depends_on:
      agentos-db:
        condition: service_healthy
      ibmi-mcp-server:
        condition: service_healthy
    healthcheck:
      test: ["CMD-SHELL", "python -c \"import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3).getcode()==200 else 1)\""]
      interval: 10s
      timeout: 5s
      retries: 6
      start_period: 30s

  ui:
    image: ghcr.io/ibmi-agi/ixora-ui:${IXORA_VERSION:-latest}
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      NEXT_PUBLIC_API_URL: http://localhost:8000
    depends_on:
      api:
        condition: service_healthy

volumes:
  pgdata:
  agentos-data:
COMPOSEYML

    success "Wrote $COMPOSE_FILE"
}

# ---------------------------------------------------------------------------
# .env helpers
# ---------------------------------------------------------------------------

# Escape single quotes for safe embedding in KEY='VALUE' .env lines
_sq_escape() { printf '%s' "$1" | sed "s/'/'\\\\''/g"; }

env_get() {
    _key="$1"
    if [ -f "$ENV_FILE" ]; then
        # Use case pattern matching to avoid regex injection from key names
        _val=""
        while IFS= read -r _line; do
            case "$_line" in
                "${_key}="*) _val="${_line#"${_key}="}"; break ;;
            esac
        done < "$ENV_FILE"
        # Strip surrounding quotes (matched pairs only)
        case "$_val" in
            \"*\") _val="${_val#\"}"; _val="${_val%\"}" ;;
            \'*\') _val="${_val#\'}"; _val="${_val%\'}" ;;
        esac
        printf '%s' "$_val"
    fi
}

# ---------------------------------------------------------------------------
# Write .env file — merges prompted values with any existing keys we want
# to preserve. Arguments are passed as the new values.
# ---------------------------------------------------------------------------
write_env_file() {
    mkdir -p "$IXORA_DIR"

    # Preserve any extra keys the user may have added manually
    _known_keys="ANTHROPIC_API_KEY|OPENAI_API_KEY|GOOGLE_API_KEY|OLLAMA_HOST|DB2i_HOST|DB2i_USER|DB2i_PASS|IXORA_PROFILE|IXORA_VERSION|IXORA_AGENT_MODEL|IXORA_TEAM_MODEL"
    _extra=""
    if [ -f "$ENV_FILE" ]; then
        _extra=$(grep -vE "^(${_known_keys})=" "$ENV_FILE" \
                 | grep -vE '^\s*#' | grep -vE '^\s*$' || true)
    fi

    # Escape single quotes in all values before writing
    _e_agent_model=$(_sq_escape "$CFG_AGENT_MODEL")
    _e_team_model=$(_sq_escape "$CFG_TEAM_MODEL")
    _e_db2_host=$(_sq_escape "$CFG_DB2_HOST")
    _e_db2_user=$(_sq_escape "$CFG_DB2_USER")
    _e_db2_pass=$(_sq_escape "$CFG_DB2_PASS")
    _e_profile=$(_sq_escape "$CFG_PROFILE")
    _e_version=$(_sq_escape "$CFG_VERSION")

    cat > "$ENV_FILE" <<EOF
# Model provider
IXORA_AGENT_MODEL='${_e_agent_model}'
IXORA_TEAM_MODEL='${_e_team_model}'
EOF

    # Write the API key for the selected provider
    if [ -n "$CFG_API_KEY_VAR" ] && [ -n "$CFG_API_KEY_VALUE" ]; then
        printf "%s='%s'\n" "$CFG_API_KEY_VAR" "$(_sq_escape "$CFG_API_KEY_VALUE")" >> "$ENV_FILE"
    fi

    # Write Ollama host if configured
    if [ -n "${CFG_OLLAMA_HOST:-}" ]; then
        printf "OLLAMA_HOST='%s'\n" "$(_sq_escape "$CFG_OLLAMA_HOST")" >> "$ENV_FILE"
    fi

    cat >> "$ENV_FILE" <<EOF

# IBM i connection
DB2i_HOST='${_e_db2_host}'
DB2i_USER='${_e_db2_user}'
DB2i_PASS='${_e_db2_pass}'

# Deployment
IXORA_PROFILE='${_e_profile}'
IXORA_VERSION='${_e_version}'
EOF

    if [ -n "$_extra" ]; then
        printf '\n# Preserved user settings\n%s\n' "$_extra" >> "$ENV_FILE"
    fi

    chmod 600 "$ENV_FILE"
    success "Wrote $ENV_FILE"
}

# ---------------------------------------------------------------------------
# Interactive prompts
# ---------------------------------------------------------------------------
prompt_value() {
    _prompt_label="$1"
    _default="$2"
    _secret="$3"

    if [ -n "$_default" ]; then
        if [ "$_secret" = "yes" ]; then
            _len=${#_default}
            if [ "$_len" -le 4 ]; then
                _display="****"
            else
                _display="****$(printf '%s' "$_default" | tail -c 4)"
            fi
            printf "${CYAN}  %s${RESET} [%s]: " "$_prompt_label" "$_display" >&2
        else
            printf "${CYAN}  %s${RESET} [%s]: " "$_prompt_label" "$_default" >&2
        fi
    else
        printf "${CYAN}  %s${RESET}: " "$_prompt_label" >&2
    fi

    if [ "$_secret" = "yes" ]; then
        stty -echo 2>/dev/null || true
        read -r _input
        stty echo 2>/dev/null || true
        printf '\n' >&2
    else
        read -r _input
    fi

    if [ -z "$_input" ]; then
        _input="$_default"
    fi

    printf '%s' "$_input"
}

_prompt_ollama_setup() {
    printf '\n'
    info "Ollama Setup"
    printf '\n'
    printf "  ${DIM}Ollama must be running on your machine and listening on all interfaces.${RESET}\n"
    printf "  ${DIM}If Ollama only accepts local connections, set OLLAMA_HOST=0.0.0.0${RESET}\n"
    printf "  ${DIM}before starting Ollama.${RESET}\n"
    printf '\n'
    printf "  ${DIM}Default URL works for macOS and Windows (Docker Desktop).${RESET}\n"
    printf "  ${DIM}Linux users: use your host IP (e.g., http://172.17.0.1:11434).${RESET}\n"
    printf '\n'

    _cur_ollama_host=$(env_get OLLAMA_HOST)
    CFG_OLLAMA_HOST=$(prompt_value "Ollama URL" "${_cur_ollama_host:-http://host.docker.internal:11434}" "no")

    _cur_model=$(env_get IXORA_AGENT_MODEL)
    _cur_model_name=""
    case "$_cur_model" in
        ollama:*) _cur_model_name="${_cur_model#ollama:}" ;;
    esac

    _ollama_model=$(prompt_value "Model name" "${_cur_model_name:-llama3.1}" "no")
    CFG_AGENT_MODEL="ollama:${_ollama_model}"
    CFG_TEAM_MODEL="ollama:${_ollama_model}"

    printf '\n'

    # Test connectivity
    if command -v curl >/dev/null 2>&1; then
        # Resolve host.docker.internal to localhost for host-side check
        _test_url="$CFG_OLLAMA_HOST"
        case "$_test_url" in
            *host.docker.internal*) _test_url=$(echo "$_test_url" | sed 's/host\.docker\.internal/localhost/') ;;
        esac
        _status=$(curl -s -o /dev/null -w '%{http_code}' "${_test_url}/api/tags" 2>/dev/null || echo "000")
        if [ "$_status" = "200" ]; then
            success "Ollama is reachable"
        else
            warn "Could not reach Ollama at ${_test_url}"
            printf "  Make sure Ollama is running and accessible from Docker containers.\n"
        fi
    fi
}

prompt_model_provider() {
    _cur_agent_model=$(env_get IXORA_AGENT_MODEL)

    # Detect current provider from existing model string
    _cur_provider="anthropic"
    case "$_cur_agent_model" in
        openai:*)    _cur_provider="openai" ;;
        google:*)    _cur_provider="google" ;;
        ollama:*)    _cur_provider="ollama" ;;
    esac

    info "Select a model provider"
    printf '\n'
    printf "  ${BOLD}1)${RESET} Anthropic     Claude Sonnet 4.6 / Haiku 4.5 ${DIM}(recommended)${RESET}\n"
    printf "  ${BOLD}2)${RESET} OpenAI        GPT-4o / GPT-4o-mini\n"
    printf "  ${BOLD}3)${RESET} Google        Gemini 2.5 Pro / Gemini 2.5 Flash\n"
    printf "  ${BOLD}4)${RESET} Ollama        Local models via Ollama ${DIM}(no API key needed)${RESET}\n"
    printf "  ${BOLD}5)${RESET} Custom        Enter provider:model strings\n"
    printf '\n'

    case "$_cur_provider" in
        anthropic) _def_num=1 ;;
        openai)    _def_num=2 ;;
        google)    _def_num=3 ;;
        ollama)    _def_num=4 ;;
        *)         _def_num=1 ;;
    esac

    printf "${CYAN}  Choose provider${RESET} [%s]: " "$_def_num"
    read -r _choice
    _choice="${_choice:-$_def_num}"

    case "$_choice" in
        1)
            CFG_PROVIDER="anthropic"
            CFG_AGENT_MODEL="anthropic:claude-sonnet-4-6"
            CFG_TEAM_MODEL="anthropic:claude-haiku-4-5"
            CFG_API_KEY_VAR="ANTHROPIC_API_KEY"
            ;;
        2)
            CFG_PROVIDER="openai"
            CFG_AGENT_MODEL="openai:gpt-4o"
            CFG_TEAM_MODEL="openai:gpt-4o-mini"
            CFG_API_KEY_VAR="OPENAI_API_KEY"
            ;;
        3)
            CFG_PROVIDER="google"
            CFG_AGENT_MODEL="google:gemini-2.5-pro"
            CFG_TEAM_MODEL="google:gemini-2.5-flash"
            CFG_API_KEY_VAR="GOOGLE_API_KEY"
            ;;
        4)
            CFG_PROVIDER="ollama"
            CFG_API_KEY_VAR=""
            _prompt_ollama_setup
            ;;
        5)
            CFG_PROVIDER="custom"
            _cur_am=$(env_get IXORA_AGENT_MODEL)
            _cur_tm=$(env_get IXORA_TEAM_MODEL)
            CFG_AGENT_MODEL=$(prompt_value "Agent model (provider:model)" "${_cur_am:-anthropic:claude-sonnet-4-6}" "no")
            CFG_TEAM_MODEL=$(prompt_value "Team model (provider:model)" "${_cur_tm:-anthropic:claude-haiku-4-5}" "no")
            _custom_key_var=$(prompt_value "API key env var name (e.g., ANTHROPIC_API_KEY)" "" "no")
            CFG_API_KEY_VAR="$_custom_key_var"
            ;;
        *)
            warn "Invalid choice, defaulting to Anthropic"
            CFG_PROVIDER="anthropic"
            CFG_AGENT_MODEL="anthropic:claude-sonnet-4-6"
            CFG_TEAM_MODEL="anthropic:claude-haiku-4-5"
            CFG_API_KEY_VAR="ANTHROPIC_API_KEY"
            ;;
    esac

    printf '\n'
    success "Provider: $CFG_PROVIDER ($CFG_AGENT_MODEL)"
}

prompt_api_key() {
    if [ -z "$CFG_API_KEY_VAR" ]; then
        # No API key needed (e.g., Ollama)
        CFG_API_KEY_VALUE=""
        return
    fi

    _cur_key=$(env_get "$CFG_API_KEY_VAR")
    CFG_API_KEY_VALUE=$(prompt_value "$CFG_API_KEY_VAR" "$_cur_key" "yes")
    [ -z "$CFG_API_KEY_VALUE" ] && die "$CFG_API_KEY_VAR is required"
    printf '\n'
}

prompt_ibmi_connection() {
    info "IBM i Connection"
    printf '\n'

    _cur_host=$(env_get DB2i_HOST)
    _cur_user=$(env_get DB2i_USER)
    _cur_pass=$(env_get DB2i_PASS)

    CFG_DB2_HOST=$(prompt_value "IBM i hostname" "$_cur_host" "no")
    [ -z "$CFG_DB2_HOST" ] && die "IBM i hostname is required"

    CFG_DB2_USER=$(prompt_value "IBM i username" "$_cur_user" "no")
    [ -z "$CFG_DB2_USER" ] && die "IBM i username is required"

    CFG_DB2_PASS=$(prompt_value "IBM i password" "$_cur_pass" "yes")
    [ -z "$CFG_DB2_PASS" ] && die "IBM i password is required"

    printf '\n'
}

prompt_profile() {
    _cur_profile=$(env_get IXORA_PROFILE)
    _cur_profile="${_cur_profile:-full}"

    info "Select an agent profile"
    printf '\n'
    printf "  ${BOLD}1)${RESET} full          All agents, teams, and workflows (3 agents, 2 teams, 1 workflow)\n"
    printf "  ${BOLD}2)${RESET} sql-services  SQL Services agent for database queries and performance monitoring\n"
    printf "  ${BOLD}3)${RESET} security      Security agent, multi-system security team, and assessment workflow\n"
    printf "  ${BOLD}4)${RESET} knowledge     Knowledge agent only — documentation retrieval (lightest)\n"
    printf '\n'

    # Determine default number from current profile
    case "$_cur_profile" in
        full)         _def_num=1 ;;
        sql-services) _def_num=2 ;;
        security)     _def_num=3 ;;
        knowledge)    _def_num=4 ;;
        *)            _def_num=1 ;;
    esac

    printf "${CYAN}  Choose profile${RESET} [%s]: " "$_def_num"
    read -r _choice
    _choice="${_choice:-$_def_num}"

    case "$_choice" in
        1) CFG_PROFILE="full" ;;
        2) CFG_PROFILE="sql-services" ;;
        3) CFG_PROFILE="security" ;;
        4) CFG_PROFILE="knowledge" ;;
        *) warn "Invalid choice, defaulting to full"; CFG_PROFILE="full" ;;
    esac

    printf '\n'
    success "Profile: $CFG_PROFILE"
}

# ---------------------------------------------------------------------------
# Wait for the API to become healthy
# ---------------------------------------------------------------------------
wait_for_healthy() {
    info "Waiting for services to become healthy (up to ${HEALTH_TIMEOUT}s)"
    _runtime="${COMPOSE_CMD%% *}"
    _elapsed=0
    while [ "$_elapsed" -lt "$HEALTH_TIMEOUT" ]; do
        # Check API container state directly (works on both docker and podman)
        _state=$($_runtime inspect --format '{{.State.Status}}' ixora-api-1 2>/dev/null || echo "")
        _health=$($_runtime inspect --format '{{.State.Health.Status}}' ixora-api-1 2>/dev/null || echo "")

        case "$_state" in
            exited|dead)
                printf '\n'
                error "API container failed to start"
                run_compose ps
                printf "\n  Run ${BOLD}ixora logs api${RESET} to investigate.\n"
                return 1 ;;
        esac

        if [ "$_health" = "healthy" ]; then
            printf '\n'
            success "Services are healthy"
            return 0
        fi

        printf '.'
        sleep 2
        _elapsed=$((_elapsed + 2))
    done

    printf '\n'
    warn "Services did not become healthy within ${HEALTH_TIMEOUT}s — they may still be starting"
    printf "  Run ${BOLD}ixora logs api${RESET} to investigate.\n"
}

# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------
cmd_install() {
    info "Installing ixora (v${SCRIPT_VERSION})"
    printf '\n'

    detect_compose_cmd
    info "Using: $COMPOSE_CMD"
    printf '\n'

    # Check for existing installation
    if [ -d "$IXORA_DIR" ]; then
        warn "Existing installation found at $IXORA_DIR"
        printf "  ${CYAN}1)${RESET} Reconfigure   — re-run setup prompts (overwrites current config)\n"
        printf "  ${CYAN}2)${RESET} Cancel        — keep existing installation\n"
        printf '\n'
        printf "${CYAN}  Choose${RESET} [1]: "
        read -r _choice
        _choice="${_choice:-1}"
        case "$_choice" in
            1) info "Reconfiguring..." ;;
            *) info "Cancelled"; exit 0 ;;
        esac
        printf '\n'
    fi

    prompt_model_provider
    prompt_api_key
    prompt_ibmi_connection
    prompt_profile

    CFG_VERSION="${OPT_VERSION:-$(env_get IXORA_VERSION)}"
    CFG_VERSION="${CFG_VERSION:-latest}"

    write_compose_file
    write_env_file

    if [ "$OPT_NO_PULL" != "yes" ]; then
        info "Pulling images..."
        run_compose pull
    fi

    info "Starting services..."
    run_compose up -d

    wait_for_healthy

    printf '\n'
    success "ixora is running!"
    printf '\n'
    printf "  ${BOLD}UI:${RESET}   http://localhost:3000\n"
    printf "  ${BOLD}API:${RESET}  http://localhost:8000\n"
    printf "  ${BOLD}Profile:${RESET} %s\n" "$CFG_PROFILE"
    printf '\n'

    # Offer to install the 'ixora' command
    _install_command

    printf "  Manage with: ${BOLD}ixora start|stop|restart|status|upgrade|config|logs${RESET}\n"
    printf "  Config dir:  ${DIM}%s${RESET}\n" "$IXORA_DIR"
    printf '\n'
}

cmd_start() {
    detect_compose_cmd
    [ -f "$COMPOSE_FILE" ] || die "ixora is not installed. Run: ixora install"

    # If --profile was provided, update it in .env before starting
    if [ -n "$OPT_PROFILE" ]; then
        _update_profile "$OPT_PROFILE"
    fi

    info "Starting ixora services..."
    run_compose up -d

    wait_for_healthy

    _profile=$(env_get IXORA_PROFILE)
    printf '\n'
    success "ixora is running!"
    printf "  ${BOLD}UI:${RESET}      http://localhost:3000\n"
    printf "  ${BOLD}API:${RESET}     http://localhost:8000\n"
    printf "  ${BOLD}Profile:${RESET} %s\n" "${_profile:-full}"
    printf '\n'
}

cmd_stop() {
    detect_compose_cmd
    [ -f "$COMPOSE_FILE" ] || die "ixora is not installed. Run: ixora install"

    info "Stopping ixora services..."
    run_compose down

    success "Services stopped"
}

cmd_restart() {
    detect_compose_cmd
    [ -f "$COMPOSE_FILE" ] || die "ixora is not installed. Run: ixora install"

    if [ -n "$1" ]; then
        _svc=$(_resolve_service "$1")
        info "Restarting $_svc..."
        run_compose up -d --force-recreate --no-deps "$_svc"
        success "Restarted $_svc"
    else
        info "Restarting all services..."
        run_compose up -d --force-recreate
        wait_for_healthy
        printf '\n'
        success "All services restarted"
    fi
}

cmd_status() {
    detect_compose_cmd
    [ -f "$COMPOSE_FILE" ] || die "ixora is not installed. Run: ixora install"

    _profile=$(env_get IXORA_PROFILE)
    _profile="${_profile:-full}"
    _version=$(env_get IXORA_VERSION)
    _version="${_version:-latest}"

    printf '\n'
    printf "  ${BOLD}Profile:${RESET}  %s\n" "$_profile"
    printf "  ${BOLD}Version:${RESET}  %s\n" "$_version"
    printf "  ${BOLD}Config:${RESET}   %s\n" "$IXORA_DIR"
    printf '\n'

    run_compose ps
}

cmd_upgrade() {
    detect_compose_cmd
    [ -f "$COMPOSE_FILE" ] || die "ixora is not installed. Run: ixora install"

    info "Upgrading ixora..."

    # Update the embedded compose file in case the script has a newer version
    write_compose_file

    if [ -n "$OPT_VERSION" ]; then
        info "Pinning version to: $OPT_VERSION"
        _update_env_key IXORA_VERSION "$OPT_VERSION"
    fi

    if [ -n "$OPT_PROFILE" ]; then
        _update_profile "$OPT_PROFILE"
    fi

    if [ "$OPT_NO_PULL" != "yes" ]; then
        info "Pulling latest images..."
        run_compose pull
    fi

    info "Restarting services..."
    run_compose up -d

    wait_for_healthy

    printf '\n'
    success "Upgrade complete!"
    printf '\n'
}

cmd_uninstall() {
    detect_compose_cmd

    if [ "$OPT_PURGE" = "yes" ]; then
        printf "${YELLOW}This will remove all containers, images, volumes, and configuration.${RESET}\n"
        printf "${YELLOW}All agent data (sessions, memory) will be permanently deleted.${RESET}\n"
    else
        printf "${YELLOW}This will stop containers and remove images.${RESET}\n"
        printf "${DIM}Configuration in %s will be preserved. Run 'ixora start' to re-pull and restart.${RESET}\n" "$IXORA_DIR"
    fi
    printf "Continue? [y/N]: "
    read -r _confirm
    case "$_confirm" in
        y|Y|yes|YES) ;;
        *) info "Cancelled"; exit 0 ;;
    esac

    if [ -f "$COMPOSE_FILE" ]; then
        info "Stopping services and removing images..."
        if [ "$OPT_PURGE" = "yes" ]; then
            run_compose down --rmi all -v 2>/dev/null || true
        else
            run_compose down --rmi all 2>/dev/null || true
        fi
    fi

    if [ "$OPT_PURGE" = "yes" ]; then
        info "Removing $IXORA_DIR..."
        rm -rf "$IXORA_DIR"
    fi

    success "ixora has been uninstalled"
    if [ "$OPT_PURGE" != "yes" ]; then
        printf "  Configuration preserved in ${DIM}%s${RESET}\n" "$IXORA_DIR"
        printf "  Run ${BOLD}ixora start${RESET} to re-pull images and restart.\n"
        printf "  Run ${BOLD}ixora uninstall --purge${RESET} to remove everything.\n"
    fi

    _bin_path="$HOME/.local/bin/ixora"
    if [ -f "$_bin_path" ]; then
        printf "  The ${BOLD}ixora${RESET} command is still available at ${DIM}%s${RESET}\n" "$_bin_path"
        printf "  To remove it: ${BOLD}rm %s${RESET}\n" "$_bin_path"
    fi
}

cmd_logs() {
    detect_compose_cmd
    [ -f "$COMPOSE_FILE" ] || die "ixora is not installed. Run: ixora install"

    if [ -n "$1" ]; then
        _svc=$(_resolve_service "$1")
        run_compose logs -f "$_svc"
    else
        run_compose logs -f
    fi
}

# ---------------------------------------------------------------------------
# Config command — view and edit deployment configuration
# ---------------------------------------------------------------------------
_mask_value() {
    _val="$1"
    if [ -z "$_val" ]; then
        printf "${DIM}(not set)${RESET}"
        return
    fi
    _len=${#_val}
    if [ "$_len" -le 4 ]; then
        printf '****'
    else
        printf '%s****' "$(printf '%s' "$_val" | cut -c1-4)"
    fi
}

cmd_config() {
    [ -f "$ENV_FILE" ] || die "ixora is not installed. Run: ixora install"

    _subcmd="${1:-show}"

    case "$_subcmd" in
        show)
            _config_show
            ;;
        set)
            [ -n "${2:-}" ] || die "Usage: ixora config set KEY VALUE"
            [ -n "${3:-}" ] || die "Usage: ixora config set KEY VALUE"
            _config_set "$2" "$3"
            ;;
        edit)
            _config_edit
            ;;
        *)
            die "Unknown config subcommand: $_subcmd (use: show, set, edit)"
            ;;
    esac
}

_config_show() {
    printf '\n'
    printf "  ${BOLD}Configuration${RESET}  %s\n" "$ENV_FILE"
    printf '\n'

    # Model
    printf "  ${DIM}── Model ─────────────────────────────────────────${RESET}\n"
    _agent_model=$(env_get IXORA_AGENT_MODEL)
    _team_model=$(env_get IXORA_TEAM_MODEL)
    _anth_key=$(env_get ANTHROPIC_API_KEY)
    _oai_key=$(env_get OPENAI_API_KEY)
    _goog_key=$(env_get GOOGLE_API_KEY)
    _ollama_host=$(env_get OLLAMA_HOST)

    printf "  ${CYAN}IXORA_AGENT_MODEL${RESET}   %s\n" "${_agent_model:-anthropic:claude-sonnet-4-6}"
    printf "  ${CYAN}IXORA_TEAM_MODEL${RESET}    %s\n" "${_team_model:-anthropic:claude-haiku-4-5}"
    [ -n "$_anth_key" ]    && printf "  ${CYAN}ANTHROPIC_API_KEY${RESET}   %s\n" "$(_mask_value "$_anth_key")"
    [ -n "$_oai_key" ]     && printf "  ${CYAN}OPENAI_API_KEY${RESET}      %s\n" "$(_mask_value "$_oai_key")"
    [ -n "$_ollama_host" ] && printf "  ${CYAN}OLLAMA_HOST${RESET}         %s\n" "$_ollama_host"
    [ -n "$_goog_key" ] && printf "  ${CYAN}GOOGLE_API_KEY${RESET}      %s\n" "$(_mask_value "$_goog_key")"
    printf '\n'

    # IBM i Connection
    printf "  ${DIM}── IBM i Connection ──────────────────────────────${RESET}\n"
    _db2_host=$(env_get DB2i_HOST)
    _db2_user=$(env_get DB2i_USER)
    _db2_pass=$(env_get DB2i_PASS)
    _db2_port=$(env_get DB2_PORT)

    printf "  ${CYAN}DB2i_HOST${RESET}           %s\n" "${_db2_host:-${DIM}(not set)${RESET}}"
    printf "  ${CYAN}DB2i_USER${RESET}           %s\n" "${_db2_user:-${DIM}(not set)${RESET}}"
    printf "  ${CYAN}DB2i_PASS${RESET}           %s\n" "$(_mask_value "$_db2_pass")"
    printf "  ${CYAN}DB2_PORT${RESET}            %s\n" "${_db2_port:-8076}"
    printf '\n'

    # Deployment
    printf "  ${DIM}── Deployment ────────────────────────────────────${RESET}\n"
    _profile=$(env_get IXORA_PROFILE)
    _version=$(env_get IXORA_VERSION)

    printf "  ${CYAN}IXORA_PROFILE${RESET}       %s\n" "${_profile:-full}"
    printf "  ${CYAN}IXORA_VERSION${RESET}       %s\n" "${_version:-latest}"
    printf '\n'

    # Any extra user-added keys
    _known_keys="ANTHROPIC_API_KEY|OPENAI_API_KEY|GOOGLE_API_KEY|OLLAMA_HOST|DB2i_HOST|DB2i_USER|DB2i_PASS|DB2_PORT|IXORA_PROFILE|IXORA_VERSION|IXORA_AGENT_MODEL|IXORA_TEAM_MODEL"
    _extra=$(grep -vE "^(${_known_keys})=" "$ENV_FILE" \
             | grep -vE '^\s*#' | grep -vE '^\s*$' || true)
    if [ -n "$_extra" ]; then
        printf "  ${DIM}── Other ─────────────────────────────────────────${RESET}\n"
        echo "$_extra" | while IFS= read -r _line; do
            _key=$(printf '%s' "$_line" | cut -d= -f1)
            _val=$(printf '%s' "$_line" | cut -d= -f2- | sed "s/^[\"']//;s/[\"']$//")
            _key_upper=$(printf '%s' "$_key" | tr '[:lower:]' '[:upper:]')
            case "$_key_upper" in
                *KEY*|*TOKEN*|*PASS*|*SECRET*|*ENCRYPT*)
                    printf "  ${CYAN}%s${RESET}  %s\n" "$_key" "$(_mask_value "$_val")" ;;
                *)
                    printf "  ${CYAN}%s${RESET}  %s\n" "$_key" "$_val" ;;
            esac
        done
        printf '\n'
    fi

    printf "  ${DIM}Edit with: ixora config edit${RESET}\n"
    printf "  ${DIM}Set a value: ixora config set KEY VALUE${RESET}\n"
    printf '\n'
}

_config_set() {
    _key="$1"
    _val="$2"

    _update_env_key "$_key" "$_val"
    success "Set ${_key}"

    printf "  Restart to apply: ${BOLD}ixora restart${RESET}\n"
}

_config_edit() {
    _editor="${EDITOR:-${VISUAL:-}}"
    if [ -z "$_editor" ]; then
        if command -v vim >/dev/null 2>&1; then
            _editor="vim"
        elif command -v vi >/dev/null 2>&1; then
            _editor="vi"
        elif command -v nano >/dev/null 2>&1; then
            _editor="nano"
        else
            die "No editor found. Set \$EDITOR or install vim/nano."
        fi
    fi

    info "Opening $_editor..."
    $_editor "$ENV_FILE"

    printf '\n'
    success "Config saved"
    printf "  Restart to apply: ${BOLD}ixora restart${RESET}\n"
}

# ---------------------------------------------------------------------------
# Install 'ixora' command to PATH
# ---------------------------------------------------------------------------
_install_command() {
    _bin_dir="$HOME/.local/bin"
    _bin_path="$_bin_dir/ixora"

    # Resolve script path — bail if piped (curl | sh) since $0 is the shell
    _script_path="$(cd "$(dirname "$0")" 2>/dev/null && pwd)/$(basename "$0")"
    if [ ! -f "$_script_path" ] || ! grep -Fq 'SCRIPT_VERSION=' "$_script_path" 2>/dev/null; then
        # Running via pipe or $0 doesn't point to this script — skip install
        return
    fi

    # If already installed, check if it needs updating
    if [ -f "$_bin_path" ]; then
        _installed_ver=$(grep '^SCRIPT_VERSION=' "$_bin_path" | head -1 | cut -d'"' -f2)
        if [ "$_installed_ver" = "$SCRIPT_VERSION" ]; then
            return
        fi
        cp "$_script_path" "$_bin_path"
        chmod +x "$_bin_path"
        success "Updated 'ixora' command ($SCRIPT_VERSION)"
        printf '\n'
        return
    fi

    printf "${CYAN}  Install 'ixora' command to %s?${RESET} [Y/n]: " "$_bin_dir" >&2
    read -r _confirm
    case "$_confirm" in
        n|N|no|NO) return ;;
    esac

    mkdir -p "$_bin_dir"
    cp "$_script_path" "$_bin_path"
    chmod +x "$_bin_path"

    # Check if ~/.local/bin is in PATH
    case ":$PATH:" in
        *":$_bin_dir:"*) ;;
        *)
            warn "$_bin_dir is not in your PATH"
            # Detect shell and suggest the right rc file
            _shell_name="$(basename "${SHELL:-/bin/sh}")"
            case "$_shell_name" in
                zsh)  _rc_file="~/.zshrc" ;;
                bash) _rc_file="~/.bashrc" ;;
                *)    _rc_file="~/.profile" ;;
            esac
            printf "  Add it with: ${BOLD}echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> %s${RESET}\n" "$_rc_file"
            printf "  Then restart your shell or run: ${BOLD}source %s${RESET}\n\n" "$_rc_file"
            ;;
    esac

    success "Installed 'ixora' command"
    printf '\n'
}

# ---------------------------------------------------------------------------
# Helpers for updating .env in place
# ---------------------------------------------------------------------------
_update_env_key() {
    _k="$1"
    _v=$(_sq_escape "$2")
    if [ -f "$ENV_FILE" ] && grep -Fq "${_k}=" "$ENV_FILE" && grep -q "^${_k}=" "$ENV_FILE"; then
        # Replace in-place to preserve line ordering
        _tmp="$ENV_FILE.tmp.$$"
        while IFS= read -r _line; do
            case "$_line" in
                "${_k}="*) printf "%s='%s'\n" "$_k" "$_v" ;;
                *) printf '%s\n' "$_line" ;;
            esac
        done < "$ENV_FILE" > "$_tmp"
        mv "$_tmp" "$ENV_FILE"
    else
        # Ensure trailing newline before appending
        if [ -f "$ENV_FILE" ] && [ -s "$ENV_FILE" ]; then
            # Add newline if file doesn't end with one
            tail -c 1 "$ENV_FILE" | grep -q '^$' || printf '\n' >> "$ENV_FILE"
        fi
        printf "%s='%s'\n" "$_k" "$_v" >> "$ENV_FILE"
    fi
    chmod 600 "$ENV_FILE"
}

# Accept either a service name (api) or container name (ixora-api-1) and
# return the service name that docker compose expects.
_resolve_service() {
    _input="$1"
    # Strip "ixora-" prefix and trailing "-N" replica suffix if present
    _stripped=$(printf '%s' "$_input" | sed 's/^ixora-//; s/-[0-9]*$//')
    if [ "$_stripped" != "$_input" ]; then
        printf '%s' "$_stripped"
    else
        printf '%s' "$_input"
    fi
}

_update_profile() {
    _new_profile="$1"
    case "$_new_profile" in
        full|sql-services|security|knowledge) ;;
        *) die "Invalid profile: $_new_profile (choose: full, sql-services, security, knowledge)" ;;
    esac
    info "Setting profile: $_new_profile"
    _update_env_key IXORA_PROFILE "$_new_profile"
}

# ---------------------------------------------------------------------------
# Version command
# ---------------------------------------------------------------------------
cmd_version() {
    printf "ixora %s\n" "$SCRIPT_VERSION"
    if [ -f "$ENV_FILE" ]; then
        _version=$(env_get IXORA_VERSION)
        _agent_model=$(env_get IXORA_AGENT_MODEL)
        printf "  images:  %s\n" "${_version:-latest}"
        printf "  model:   %s\n" "${_agent_model:-anthropic:claude-sonnet-4-6}"
    fi
}

# ---------------------------------------------------------------------------
# Usage
# ---------------------------------------------------------------------------
usage() {
    cat <<USAGE
${BOLD}ixora${RESET} — Manage ixora AI agent deployments

${BOLD}Usage:${RESET}
  ixora [command] [options]

${BOLD}Commands:${RESET}
  install     First-time setup
  start       Start services
  stop        Stop services
  restart     Restart all services, or a specific service by name
  status      Show service status and deployed profile
  upgrade     Pull latest images and restart
  config      View and edit deployment configuration
  uninstall   Stop services and remove images (config preserved)
  logs        Tail service logs (optional service name argument)
  version     Show script and image versions

${BOLD}Options:${RESET}
  --profile <name>   Set agent profile (full|sql-services|security|knowledge)
  --version <tag>    Pin image version (e.g., v1.2.0)
  --no-pull          Skip pulling images
  --purge            Remove images and volumes (use with uninstall)
  --runtime <name>   Force container runtime (docker or podman)
  --help             Show this help

${BOLD}Examples:${RESET}
  ixora install                           # First-time setup (interactive)
  ixora start --profile security          # Start with security profile
  ixora upgrade --version 0.0.3           # Upgrade and pin version
  ixora restart                           # Restart all services
  ixora restart api                       # Restart just the API
  ixora config                            # Show current configuration
  ixora config set DB2i_HOST myibmi.com   # Update a config value
  ixora config edit                       # Open config in editor
  ixora logs api                          # Tail API logs
  ixora status                            # Show running services

${BOLD}Config:${RESET}
  ~/.ixora/docker-compose.yml       # Compose file
  ~/.ixora/.env                     # Environment configuration

USAGE
}

# ---------------------------------------------------------------------------
# Main — parse arguments and dispatch
# ---------------------------------------------------------------------------
main() {
    COMMAND=""
    OPT_PROFILE=""
    OPT_VERSION=""
    OPT_NO_PULL="no"
    OPT_PURGE="no"
    OPT_RUNTIME=""
    LOG_SERVICE=""
    RESTART_SERVICE=""
    CONFIG_ARG1=""
    CONFIG_ARG2=""
    CONFIG_ARG3=""
    _config_argc=0

    while [ $# -gt 0 ]; do
        case "$1" in
            install|start|stop|restart|status|upgrade|uninstall|logs|config|version)
                if [ -n "$COMMAND" ]; then
                    # Already have a command — treat as positional arg for
                    # commands that accept them (e.g. config set KEY VALUE
                    # where KEY happens to match a command name like "version")
                    if [ "$COMMAND" = "logs" ]; then
                        LOG_SERVICE="$1"
                    elif [ "$COMMAND" = "restart" ]; then
                        RESTART_SERVICE="$1"
                    elif [ "$COMMAND" = "config" ]; then
                        _config_argc=$((_config_argc + 1))
                        case "$_config_argc" in
                            1) CONFIG_ARG1="$1" ;;
                            2) CONFIG_ARG2="$1" ;;
                            3) CONFIG_ARG3="$1" ;;
                        esac
                    else
                        die "Unknown argument: $1 (see --help)"
                    fi
                else
                    COMMAND="$1"
                fi
                shift
                ;;
            --profile)
                [ -n "${2:-}" ] || die "--profile requires a value"
                OPT_PROFILE="$2"
                shift 2
                ;;
            --version)
                [ -n "${2:-}" ] || die "--version requires a value (e.g., --version 0.0.3). Use 'ixora version' to show versions."
                OPT_VERSION="${2#v}"
                shift 2
                ;;
            --no-pull)
                OPT_NO_PULL="yes"
                shift
                ;;
            --purge)
                OPT_PURGE="yes"
                shift
                ;;
            --runtime)
                [ -n "${2:-}" ] || die "--runtime requires a value (docker or podman)"
                OPT_RUNTIME="$2"
                shift 2
                ;;
            --help|-h)
                usage
                exit 0
                ;;
            -*)
                die "Unknown option: $1 (see --help)"
                ;;
            *)
                # Positional arg — for logs, restart, and config commands
                if [ "$COMMAND" = "logs" ]; then
                    LOG_SERVICE="$1"
                elif [ "$COMMAND" = "restart" ]; then
                    RESTART_SERVICE="$1"
                elif [ "$COMMAND" = "config" ]; then
                    _config_argc=$((_config_argc + 1))
                    case "$_config_argc" in
                        1) CONFIG_ARG1="$1" ;;
                        2) CONFIG_ARG2="$1" ;;
                        3) CONFIG_ARG3="$1" ;;
                    esac
                else
                    die "Unknown argument: $1 (see --help)"
                fi
                shift
                ;;
        esac
    done

    # Default command is help
    if [ -z "$COMMAND" ]; then
        usage
        exit 0
    fi

    case "$COMMAND" in
        install)   cmd_install ;;
        start)     cmd_start ;;
        stop)      cmd_stop ;;
        restart)   cmd_restart "$RESTART_SERVICE" ;;
        status)    cmd_status ;;
        upgrade)   cmd_upgrade ;;
        uninstall) cmd_uninstall ;;
        logs)      cmd_logs "$LOG_SERVICE" ;;
        config)    cmd_config "$CONFIG_ARG1" "$CONFIG_ARG2" "$CONFIG_ARG3" ;;
        version)   cmd_version ;;
        *)         die "Unknown command: $COMMAND" ;;
    esac
}

main "$@"
