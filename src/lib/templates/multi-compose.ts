import { readSystems } from "../systems.js";
import { ENV_FILE, SYSTEMS_CONFIG } from "../constants.js";
import { envGet, getApiPortBase } from "../env.js";

export function generateMultiCompose(
  envFile: string = ENV_FILE,
  configFile: string = SYSTEMS_CONFIG,
): string {
  const systems = readSystems(configFile);

  // CLI mode: agents in the api container talk to the local `ibmi` binary
  // (IBMiCLITools) instead of an ibmi-mcp-server. The MCP container(s) are
  // not spun up at all, and the api gets IBM i creds as IBMI_* env vars.
  // Enabled by the `cli` stack profile, or by setting IXORA_CLI_MODE
  // explicitly (an override usable with the `full`/`mcp` profiles too).
  // Truthy parsing mirrors src/lib/banner.ts.
  const profile = (envGet("IXORA_PROFILE", envFile) || "full").trim();
  const cliModeRaw = envGet("IXORA_CLI_MODE", envFile).toLowerCase();
  const cliMode =
    profile === "cli" ||
    cliModeRaw === "true" ||
    cliModeRaw === "1" ||
    cliModeRaw === "yes";

  let content = `# Auto-generated compose file
# Regenerated on every start. Edit ixora-systems.yaml instead.
services:
  agentos-db:
    image: \${IXORA_DB_IMAGE:-agnohq/pgvector:18}
    restart: unless-stopped
    ports:
      - "\${DB_PORT:-5432}:5432"
    environment:
      POSTGRES_USER: \${DB_USER:-ai}
      POSTGRES_PASSWORD: \${DB_PASS:-ai}
      POSTGRES_DB: \${DB_DATABASE:-ai}
    volumes:
      - pgdata:/var/lib/postgresql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U \${DB_USER:-ai}"]
      interval: 5s
      timeout: 5s
      retries: 5

`;

  let apiPort = getApiPortBase(envFile);
  const apiPortBase = apiPort;
  let firstApi = "";

  for (const sys of systems) {
    const idUpper = sys.id.toUpperCase().replace(/-/g, "_");

    if (!cliMode) {
      content += `  mcp-${sys.id}:
    image: ghcr.io/ibmi-agi/ixora-mcp-server:\${IXORA_VERSION:-latest}
    restart: unless-stopped
    environment:
      DB2i_HOST: \${SYSTEM_${idUpper}_HOST}
      DB2i_USER: \${SYSTEM_${idUpper}_USER}
      DB2i_PASS: \${SYSTEM_${idUpper}_PASS}
      DB2_PORT: \${SYSTEM_${idUpper}_PORT:-8076}
      MCP_TRANSPORT_TYPE: http
      MCP_SESSION_MODE: stateless
      YAML_AUTO_RELOAD: "true"
      TOOLS_YAML_PATH: /usr/src/app/tools
      YAML_ALLOW_DUPLICATE_SOURCES: "true"
      IBMI_ENABLE_EXECUTE_SQL: "true"
      IBMI_ENABLE_DEFAULT_TOOLS: "true"
      MCP_AUTH_MODE: "none"
      IBMI_HTTP_AUTH_ENABLED: "false"
      MCP_POOL_QUERY_TIMEOUT_MS: "120000"
    healthcheck:
      test: ["CMD-SHELL", "node -e \\"fetch('http://localhost:3010/healthz').then(function(r){process.exit(r.ok?0:1)}).catch(function(){process.exit(1)})\\""]
      interval: 5s
      timeout: 5s
      retries: 5
      start_period: 3s

`;
    }

    // In CLI mode the api reaches IBM i directly via the `ibmi` binary using
    // each system's stored creds; otherwise it points at the per-system MCP.
    const apiBackendEnv = cliMode
      ? `      IXORA_CLI_MODE: "true"
      IBMI_HOST: \${SYSTEM_${idUpper}_HOST}
      IBMI_USER: \${SYSTEM_${idUpper}_USER}
      IBMI_PASS: \${SYSTEM_${idUpper}_PASS}
      IBMI_PORT: \${SYSTEM_${idUpper}_PORT:-8076}`
      : `      MCP_URL: http://mcp-${sys.id}:3010/mcp`;
    const apiMcpDep = cliMode
      ? ""
      : `
      mcp-${sys.id}:
        condition: service_healthy`;

    content += `  api-${sys.id}:
    image: ghcr.io/ibmi-agi/ixora-api:\${IXORA_VERSION:-latest}
    command: uvicorn app.main:app --host 0.0.0.0 --port 8000
    restart: unless-stopped
    ports:
      - "${apiPort}:8000"
    environment:
      ANTHROPIC_API_KEY: \${ANTHROPIC_API_KEY:-}
      OPENAI_API_KEY: \${OPENAI_API_KEY:-}
      GOOGLE_API_KEY: \${GOOGLE_API_KEY:-}
      OLLAMA_HOST: \${OLLAMA_HOST:-http://host.docker.internal:11434}
      IXORA_OPENAI_BASE_URL: \${IXORA_OPENAI_BASE_URL:-}
      IXORA_MODEL_PROVIDER: \${IXORA_MODEL_PROVIDER:-}
      IXORA_AGENT_MODEL: \${IXORA_AGENT_MODEL:-anthropic:claude-sonnet-4-6}
      IXORA_TEAM_MODEL: \${IXORA_TEAM_MODEL:-anthropic:claude-haiku-4-5}
      DB_HOST: agentos-db
      DB_PORT: "5432"
      DB_USER: \${DB_USER:-ai}
      DB_PASS: \${DB_PASS:-ai}
      DB_DATABASE: \${DB_DATABASE:-ai}
${apiBackendEnv}
      IXORA_SYSTEM_ID: ${sys.id}
      IXORA_SYSTEM_NAME: ${sys.name}
      IAASSIST_DEPLOYMENT_CONFIG: app/config/deployments/${sys.profile || "full"}.yaml
      DATA_DIR: /data
      RUNTIME_ENV: docker
      WAIT_FOR_DB: "True"
      CORS_ORIGINS: \${CORS_ORIGINS:-*}
      AUTH_ENABLED: "false"
      MCP_AUTH_MODE: "none"
      IXORA_ENABLE_BUILDER: \${IXORA_ENABLE_BUILDER:-true}
      IXORA_ENABLE_EXPERIMENTAL: \${IXORA_ENABLE_EXPERIMENTAL:-false}
      A2A_INTERFACE: \${A2A_INTERFACE:-false}
      RAG_API_URL: \${RAG_API_URL:-}
      RAG_API_TIMEOUT: \${RAG_API_TIMEOUT:-120}
      DB2i_HOST: \${SYSTEM_${idUpper}_HOST}
      DB2i_USER: \${SYSTEM_${idUpper}_USER}
      DB2i_PASS: \${SYSTEM_${idUpper}_PASS}
      DB2_PORT: \${SYSTEM_${idUpper}_PORT:-8076}
    volumes:
      - agentos-data:/data
      - type: bind
        source: \${HOME}/.ixora/user_tools
        target: /data/user_tools
        bind:
          create_host_path: true
    depends_on:
      agentos-db:
        condition: service_healthy${apiMcpDep}
    healthcheck:
      test: ["CMD-SHELL", "python -c \\"import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3).getcode()==200 else 1)\\""]
      interval: 10s
      timeout: 5s
      retries: 6
      start_period: 30s

`;

    if (!firstApi) firstApi = `api-${sys.id}`;
    apiPort++;
  }

  // UI points to first system. `profiles: ["full"]` gates the UI behind the
  // `full` stack profile — the `mcp` and `cli` profiles skip it.
  content += `  ui:
    image: ghcr.io/ibmi-agi/ixora-ui:\${IXORA_VERSION:-latest}
    profiles: ["full"]
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      NEXT_PUBLIC_BACKEND_URL: http://localhost:${apiPortBase}
    depends_on:
      ${firstApi}:
        condition: service_healthy

volumes:
  pgdata:
  agentos-data:
`;

  return content;
}
