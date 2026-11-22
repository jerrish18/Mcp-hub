import type { McpServerConfig } from '../types';

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
    tagline: 'Search repositories, read issues, & create tracked issues',
    setupSummary: 'Paste a GitHub Personal Access Token or sign in via OAuth 2.1 + PKCE.',
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
    samplePrompt: 'List my recent GitHub repositories and summarize any open issues.',
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
