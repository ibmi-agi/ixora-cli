export const SAMPLE_ENV = `# Model provider
IXORA_AGENT_MODEL='anthropic:claude-sonnet-4-6'
IXORA_TEAM_MODEL='anthropic:claude-haiku-4-5'
ANTHROPIC_API_KEY='sk-ant-api03-test1234567890'

# Deployment
IXORA_PROFILE='full'
IXORA_VERSION='latest'
SYSTEM_DEFAULT_HOST='myibmi.example.com'
SYSTEM_DEFAULT_PORT='8076'
SYSTEM_DEFAULT_USER='QSECOFR'
SYSTEM_DEFAULT_PASS='secret123'
`;

export const SAMPLE_ENV_WITH_SYSTEM = `# Model provider
IXORA_AGENT_MODEL='anthropic:claude-sonnet-4-6'
IXORA_TEAM_MODEL='anthropic:claude-haiku-4-5'
ANTHROPIC_API_KEY='sk-ant-api03-test1234567890'

# Deployment
IXORA_PROFILE='full'
IXORA_VERSION='latest'
SYSTEM_DEFAULT_HOST='myibmi.example.com'
SYSTEM_DEFAULT_PORT='8076'
SYSTEM_DEFAULT_USER='QSECOFR'
SYSTEM_DEFAULT_PASS='secret123'
`;

export const SAMPLE_ENV_WITH_EXTRAS = `# Model provider
IXORA_AGENT_MODEL='anthropic:claude-sonnet-4-6'
IXORA_TEAM_MODEL='anthropic:claude-haiku-4-5'
ANTHROPIC_API_KEY='sk-ant-api03-test1234567890'

# Deployment
IXORA_PROFILE='full'
IXORA_VERSION='latest'
SYSTEM_DEFAULT_HOST='myibmi.example.com'
SYSTEM_DEFAULT_PORT='8076'
SYSTEM_DEFAULT_USER='QSECOFR'
SYSTEM_DEFAULT_PASS='secret123'

# Preserved user settings
CUSTOM_VAR='custom_value'
RAG_API_URL='http://rag.example.com'
`;

export const SAMPLE_SYSTEMS_YAML = `# yaml-language-server: $schema=
# Ixora Systems Configuration
# Manage with: ixora system add|remove|list
# Credentials stored in .env (SYSTEM_<ID>_USER, SYSTEM_<ID>_PASS)
systems:
  - id: default
    name: 'myibmi.example.com'
    mode: full
  - id: dev
    name: 'Development'
    mode: custom
  - id: prod
    name: 'Production'
    mode: full
`;

export const SAMPLE_SYSTEMS_YAML_SINGLE = `# yaml-language-server: $schema=
# Ixora Systems Configuration
systems:
  - id: default
    name: 'myibmi.example.com'
    mode: full
`;

// `docker compose ps --format json` — docker compose v2 emits NDJSON with
// top-level Name/Service keys and dash-separated container names.
export const DOCKER_PS_NDJSON = `{"ID":"abc123","Name":"ixora-agentos-db-1","Service":"agentos-db","State":"running","Health":"healthy"}
{"ID":"def456","Name":"ixora-mcp-default-1","Service":"mcp-default","State":"running","Health":"healthy"}
{"ID":"ghi789","Name":"ixora-api-default-1","Service":"api-default","State":"running","Health":"healthy"}
{"ID":"jkl012","Name":"ixora-ui-1","Service":"ui","State":"running","Health":""}
`;

// `compose ps --format json` under podman-compose — delegates to `podman ps`,
// which emits a single JSON array with NO top-level Name/Service keys: the
// container name is in the Names array and the service only in Labels.
// Captured verbatim (trimmed) from podman 5.8.2 + podman-compose 1.6.0.
export const PODMAN_PS_JSON = JSON.stringify([
  {
    Id: "f9456942b215",
    Names: ["ixora_agentos-db_1"],
    State: "running",
    Status: "Up 6 minutes (healthy)",
    Labels: {
      "com.docker.compose.project": "ixora",
      "com.docker.compose.service": "agentos-db",
      "io.podman.compose.project": "ixora",
      "io.podman.compose.service": "agentos-db",
      "io.podman.compose.version": "1.6.0",
    },
  },
  {
    Id: "88b2b3b56777",
    Names: ["ixora_mcp-default_1"],
    State: "running",
    Status: "Up 6 minutes (healthy)",
    Labels: {
      "com.docker.compose.project": "ixora",
      "com.docker.compose.service": "mcp-default",
      "io.podman.compose.service": "mcp-default",
    },
  },
  {
    Id: "7e5e084b5f69",
    Names: ["ixora_api-default_1"],
    State: "running",
    Status: "Up 6 minutes (healthy)",
    Labels: {
      "com.docker.compose.project": "ixora",
      "com.docker.compose.service": "api-default",
      "io.podman.compose.service": "api-default",
    },
  },
  {
    Id: "9d35bad5a8e6",
    Names: ["ixora_ui_1"],
    State: "running",
    Status: "Up 6 minutes",
    Labels: {
      "com.docker.compose.project": "ixora",
      "com.docker.compose.service": "ui",
      "io.podman.compose.service": "ui",
    },
  },
]);
