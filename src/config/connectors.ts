import type { AuthType, McpServerConfig, ServerSecretPayload } from '../types';

export interface ConnectorPresetMeta {
  presetId: 'youtube' | 'github' | 'canva';
  serverId: string;
  name: string;
  tagline: string;
  setupSummary: string;
  defaultUrl: string;
  alternateRemoteUrl?: string;
  alternateLabel?: string;
  defaultAuthType: McpServerConfig['authType'];
  supportedAuthModes: Array<'bearer' | 'oauth_pkce'>;
  keyLabel: string;
  keyPlaceholder: string;
  keyUrl: string;
  keyUrlLabel: string;
  defaultScopes?: string;
  accentColor: string;
  samplePrompt: string;
}

export interface ProWorkMcpTemplate {
  presetId: 'notion' | 'slack' | 'gdrive' | 'linear' | 'postgres';
  name: string;
  tagline: string;
  defaultUrl: string;
  defaultAuthType: AuthType;
  docsUrl: string;
  defaultScopes?: string;
  setupHint: string;
}

export const CONNECTOR_PRESETS: Record<'youtube' | 'github' | 'canva', ConnectorPresetMeta> = {
  youtube: {
    presetId: 'youtube',
    serverId: 'srv_youtube',
    name: 'YouTube',
    tagline: 'Search videos, inspect channel analytics, & fetch comments',
    setupSummary: 'Paste a free Google YouTube Data API v3 key (or connect a custom remote YouTube MCP URL).',
    defaultUrl: 'virtual://youtube-data-api',
    defaultAuthType: 'bearer',
    supportedAuthModes: ['bearer'],
    keyLabel: 'YouTube Data API v3 Key',
    keyPlaceholder: 'AIzaSy...',
    keyUrl: 'https://console.cloud.google.com/apis/library/youtube.googleapis.com',
    keyUrlLabel: 'Get YouTube API key',
    accentColor: '#DC2626',
    samplePrompt: 'Search YouTube for recent Pixel 8 camera tips and summarize the top 3 videos.',
  },
  github: {
    presetId: 'github',
    serverId: 'srv_github',
    name: 'GitHub',
    tagline: 'Create repos, read/push app code, manage branches & issues',
    setupSummary: 'Paste a GitHub Personal Access Token (with repo scope) or sign in via OAuth 2.1 + PKCE.',
    defaultUrl: 'virtual://github-api',
    alternateRemoteUrl: 'https://api.githubcopilot.com/mcp/',
    alternateLabel: 'Official GitHub Copilot Remote MCP',
    defaultAuthType: 'bearer',
    supportedAuthModes: ['bearer', 'oauth_pkce'],
    keyLabel: 'GitHub Personal Access Token (PAT)',
    keyPlaceholder: 'github_pat_... or ghp_...',
    keyUrl: 'https://github.com/settings/tokens?type=beta',
    keyUrlLabel: 'Create GitHub PAT',
    defaultScopes: 'repo read:user',
    accentColor: '#24292F',
    samplePrompt: 'List my recent GitHub repositories, inspect files, or push my Pro Canvas app.',
  },
  canva: {
    presetId: 'canva',
    serverId: 'srv_canva',
    name: 'Canva',
    tagline: 'Browse Canva designs, templates, & create social graphics',
    setupSummary: 'Authenticate via Canva Official Remote MCP (OAuth 2.1 + PKCE) or paste a Canva Connect token.',
    defaultUrl: 'https://mcp.canva.com/mcp',
    defaultAuthType: 'oauth_pkce',
    supportedAuthModes: ['oauth_pkce', 'bearer'],
    keyLabel: 'Canva Connect Access Token (optional if using OAuth)',
    keyPlaceholder: 'Paste Canva Bearer token',
    keyUrl: 'https://www.canva.dev/docs/connect/',
    keyUrlLabel: 'Canva Connect docs',
    defaultScopes: 'design:content:read design:meta:read asset:read',
    accentColor: '#7C3AED',
    samplePrompt: 'Find my recent Canva presentation designs and suggest layout improvements.',
  },
};

export const DEFAULT_CONNECTOR_LIST: ConnectorPresetMeta[] = [
  CONNECTOR_PRESETS.youtube,
  CONNECTOR_PRESETS.github,
  CONNECTOR_PRESETS.canva,
];

export const PRO_WORK_MCP_TEMPLATES: ProWorkMcpTemplate[] = [
  {
    presetId: 'notion',
    name: 'Notion Workspace',
    tagline: 'Search pages, query databases & create meeting notes',
    defaultUrl: 'https://mcp.notion.com/mcp',
    defaultAuthType: 'oauth_pkce',
    docsUrl: 'https://developers.notion.com/docs/mcp',
    defaultScopes: 'mcp:tools',
    setupHint: 'Official Notion Remote MCP — tap Auto-Discover (RFC 8414) to sign in.',
  },
  {
    presetId: 'linear',
    name: 'Linear Issues',
    tagline: 'Triage sprint issues, inspect cycles & draft specs',
    defaultUrl: 'https://mcp.linear.app/mcp',
    defaultAuthType: 'oauth_pkce',
    docsUrl: 'https://linear.app/docs/mcp',
    defaultScopes: 'read write',
    setupHint: 'Official Linear MCP — supports OAuth 2.1 PKCE dynamic discovery.',
  },
  {
    presetId: 'slack',
    name: 'Slack Workspace',
    tagline: 'Search channels, read project threads & post summaries',
    defaultUrl: 'https://mcp.slack.com/mcp',
    defaultAuthType: 'bearer',
    docsUrl: 'https://api.slack.com/',
    setupHint: 'Enter your Slack MCP endpoint URL and Bot/User Bearer token.',
  },
  {
    presetId: 'gdrive',
    name: 'Google Drive & Docs',
    tagline: 'Read shared specs, Sheets & executive briefs via MCP',
    defaultUrl: 'https://mcp.googleapis.com/drive/mcp',
    defaultAuthType: 'oauth_pkce',
    docsUrl: 'https://developers.google.com/drive',
    defaultScopes: 'https://www.googleapis.com/auth/drive.readonly',
    setupHint: 'Point to your Google Drive MCP endpoint and authorize via OAuth 2.1.',
  },
  {
    presetId: 'postgres',
    name: 'PostgreSQL Gateway',
    tagline: 'Schema inspection & read-only SQL BI reporting',
    defaultUrl: 'https://postgres-mcp.example.com/mcp',
    defaultAuthType: 'bearer',
    docsUrl: 'https://modelcontextprotocol.io/',
    setupHint: 'Replace with your HTTPS PostgreSQL MCP gateway URL and Bearer key.',
  },
];

export function parseMcpServersJsonConfig(rawJson: string): {
  configs: McpServerConfig[];
  secretsById: Record<string, ServerSecretPayload>;
  errors: string[];
} {
  const configs: McpServerConfig[] = [];
  const secretsById: Record<string, ServerSecretPayload> = {};
  const errors: string[] = [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return { configs, secretsById, errors: ['Invalid JSON syntax.'] };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      configs,
      secretsById,
      errors: ['Expected a JSON object with "mcpServers" or a single server { "url": "..." }.'],
    };
  }

  const root = parsed as Record<string, unknown>;
  const serverMap: Record<string, Record<string, unknown>> = {};

  if (root.mcpServers && typeof root.mcpServers === 'object' && !Array.isArray(root.mcpServers)) {
    for (const [k, v] of Object.entries(root.mcpServers as Record<string, unknown>)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        serverMap[k] = v as Record<string, unknown>;
      }
    }
  } else if (typeof root.url === 'string' || typeof root.serverUrl === 'string') {
    const label = typeof root.name === 'string' && root.name.trim() ? root.name.trim() : 'Imported MCP Server';
    serverMap[label] = root;
  } else {
    return {
      configs,
      secretsById,
      errors: ['Missing "mcpServers" map or "url" property in JSON config.'],
    };
  }

  const entries = Object.entries(serverMap);
  if (entries.length === 0) {
    return { configs, secretsById, errors: ['No server entries found inside "mcpServers".'] };
  }

  const baseTs = Date.now();
  entries.forEach(([entryName, def], idx) => {
    const rawUrl = String(def.url ?? def.serverUrl ?? '').trim();
    if (!rawUrl) {
      errors.push(`"${entryName}" is skipped (no remote "url" — stdio local commands require a remote HTTPS bridge).`);
      return;
    }
    if (!rawUrl.startsWith('https://') && !rawUrl.startsWith('virtual://')) {
      errors.push(`"${entryName}" skipped: only https:// remote MCP URLs are supported.`);
      return;
    }

    const headersObj =
      def.headers && typeof def.headers === 'object' && !Array.isArray(def.headers)
        ? (def.headers as Record<string, unknown>)
        : {};

    let authType: AuthType = 'none';
    const secrets: ServerSecretPayload = {};
    const customHeaders: Record<string, string> = {};

    for (const [hk, hv] of Object.entries(headersObj)) {
      const val = String(hv ?? '').trim();
      if (!val) continue;
      if (hk.toLowerCase() === 'authorization' && val.toLowerCase().startsWith('bearer ')) {
        authType = 'bearer';
        secrets.bearerToken = val.slice(7).trim();
      } else {
        customHeaders[hk] = val;
      }
    }

    if (Object.keys(customHeaders).length > 0 && authType === 'none') {
      authType = 'custom_headers';
      secrets.customHeaders = customHeaders;
    } else if (Object.keys(customHeaders).length > 0) {
      secrets.customHeaders = customHeaders;
    }

    const id = `srv_imp_${baseTs}_${idx}`;
    configs.push({
      id,
      name: entryName,
      url: rawUrl,
      authType,
      enabled: true,
      transportPreference: def.type === 'sse' ? 'sse' : 'auto',
      status: 'disconnected',
      tools: [],
      resources: [],
      prompts: [],
      disabledTools: [],
    });
    secretsById[id] = secrets;
  });

  return { configs, secretsById, errors };
}
