export const SAMPLE_ENV = `# Model provider
IXORA_AGENT_MODEL='anthropic:claude-sonnet-4-6'
IXORA_TEAM_MODEL='anthropic:claude-haiku-4-5'
ANTHROPIC_API_KEY='sk-ant-api03-test1234567890'

# IBM i connection
DB2i_HOST='myibmi.example.com'
DB2i_USER='QSECOFR'
DB2i_PASS='secret123'

# Deployment
IXORA_PROFILE='full'
IXORA_VERSION='latest'
`;

export const SAMPLE_ENV_WITH_SYSTEM = `# Model provider
IXORA_AGENT_MODEL='anthropic:claude-sonnet-4-6'
IXORA_TEAM_MODEL='anthropic:claude-haiku-4-5'
ANTHROPIC_API_KEY='sk-ant-api03-test1234567890'

# IBM i connection
DB2i_HOST='myibmi.example.com'
DB2i_USER='QSECOFR'
DB2i_PASS='secret123'

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

# IBM i connection
DB2i_HOST='myibmi.example.com'
DB2i_USER='QSECOFR'
DB2i_PASS='secret123'

# Deployment
IXORA_PROFILE='full'
IXORA_VERSION='latest'

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
    profile: full
    agents: []
  - id: dev
    name: 'Development'
    profile: security
    agents: [ibmi-security-assistant, ibmi-system-health]
  - id: prod
    name: 'Production'
    profile: full
    agents: [ibmi-security-assistant, ibmi-system-health, ibmi-db-explorer]
`;

export const SAMPLE_SYSTEMS_YAML_SINGLE = `# yaml-language-server: $schema=
# Ixora Systems Configuration
systems:
  - id: default
    name: 'myibmi.example.com'
    profile: full
    agents: []
`;
