export function generateSingleCompose(): string {
  return `services:
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

  ibmi-mcp-server:
    image: ghcr.io/ibmi-agi/ixora-mcp-server:\${IXORA_VERSION:-latest}
    restart: unless-stopped
    ports:
      - "3010:3010"
    environment:
      DB2i_HOST: \${DB2i_HOST}
      DB2i_USER: \${DB2i_USER}
      DB2i_PASS: \${DB2i_PASS}
      DB2_PORT: \${DB2_PORT:-8076}
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
      MCP_POOL_QUERY_TIMEOUT_MS: "120000"
    healthcheck:
      test: ["CMD-SHELL", "node -e \\"fetch('http://localhost:3010/healthz').then(function(r){process.exit(r.ok?0:1)}).catch(function(){process.exit(1)})\\""]
      interval: 5s
      timeout: 5s
      retries: 5
      start_period: 3s

  api:
    image: ghcr.io/ibmi-agi/ixora-api:\${IXORA_VERSION:-latest}
    command: uvicorn app.main:app --host 0.0.0.0 --port 8000
    restart: unless-stopped
    ports:
      - "8000:8000"
    environment:
      ANTHROPIC_API_KEY: \${ANTHROPIC_API_KEY:-}
      OPENAI_API_KEY: \${OPENAI_API_KEY:-}
      GOOGLE_API_KEY: \${GOOGLE_API_KEY:-}
      OLLAMA_HOST: \${OLLAMA_HOST:-http://host.docker.internal:11434}
      IXORA_AGENT_MODEL: \${IXORA_AGENT_MODEL:-anthropic:claude-sonnet-4-6}
      IXORA_TEAM_MODEL: \${IXORA_TEAM_MODEL:-anthropic:claude-haiku-4-5}
      DB_HOST: agentos-db
      DB_PORT: "5432"
      DB_USER: \${DB_USER:-ai}
      DB_PASS: \${DB_PASS:-ai}
      DB_DATABASE: \${DB_DATABASE:-ai}
      MCP_URL: http://ibmi-mcp-server:3010/mcp
      IXORA_SYSTEM_ID: default
      IXORA_SYSTEM_NAME: \${DB2i_HOST}
      IAASSIST_DEPLOYMENT_CONFIG: app/config/deployments/\${IXORA_PROFILE:-full}.yaml
      DATA_DIR: /data
      RUNTIME_ENV: docker
      WAIT_FOR_DB: "True"
      RAG_API_URL: \${RAG_API_URL:-}
      RAG_API_TIMEOUT: \${RAG_API_TIMEOUT:-120}
      AUTH_ENABLED: "false"
      MCP_AUTH_MODE: "none"
      CORS_ORIGINS: \${CORS_ORIGINS:-*}
      IXORA_ENABLE_BUILDER: "true"
      DB2i_HOST: \${DB2i_HOST}
      DB2i_USER: \${DB2i_USER}
      DB2i_PASS: \${DB2i_PASS}
      DB2_PORT: \${DB2_PORT:-8076}
    volumes:
      - agentos-data:/data
      - type: bind
        source: \${HOME}/.ixora/user_tools
        target: /data/user_tools
        bind:
          create_host_path: true
    depends_on:
      agentos-db:
        condition: service_healthy
      ibmi-mcp-server:
        condition: service_healthy
    healthcheck:
      test: ["CMD-SHELL", "python -c \\"import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3).getcode()==200 else 1)\\""]
      interval: 10s
      timeout: 5s
      retries: 6
      start_period: 30s

  ui:
    image: ghcr.io/ibmi-agi/ixora-ui:\${IXORA_VERSION:-latest}
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
`;
}
