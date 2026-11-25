import { WorkspaceCard, WorkspaceHeading, useWorkspaceTheme, workspaceBlue } from '../../ui/workspace';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import {
  connectAndInspectServer,
  disconnectMcpServer,
  pingMcpServer,
} from '@core/services/mcp/client';
import { loadServerSecrets, saveServerSecrets } from '@core/services/storage/secureStorage';
import type { AuthType, McpServerConfig } from '@core/types';
import { runExpoOAuthPkceFlow } from '../../services/auth/expoOAuth';
import { loadMobilePrefs, saveMobilePrefs } from '../../services/storage/mobilePrefs';

export default function MobileServersScreen() {
  const theme = useWorkspaceTheme();
  const params = useLocalSearchParams<{ addUrl?: string; addName?: string; addAuthType?: string }>();
  const [servers, setServers] = useState<McpServerConfig[]>([]);
  const [statusMsg, setStatusMsg] = useState('');
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [newBearer, setNewBearer] = useState('');
  const [newAuthType, setNewAuthType] = useState<AuthType>('bearer');

  useEffect(() => {
    void loadMobilePrefs().then((prefs) => {
      setServers(prefs.servers);
    });
  }, []);

  useEffect(() => {
    if (params.addUrl) {
      setNewUrl(String(params.addUrl));
      setNewName(String(params.addName ?? 'Imported MCP Server'));
      const at = String(params.addAuthType ?? 'bearer');
      setNewAuthType(
        at === 'none' || at === 'bearer' || at === 'oauth_pkce' ? at : 'bearer'
      );
      setStatusMsg(`Prefilled deep-link server: ${params.addName ?? params.addUrl}`);
    }
  }, [params.addUrl, params.addName, params.addAuthType]);

  const persistServers = async (next: McpServerConfig[]) => {
    setServers(next);
    await saveMobilePrefs({ servers: next });
  };

  const handleTest = async (srv: McpServerConfig) => {
    try {
      const secrets = await loadServerSecrets(srv.id);
      const res = await connectAndInspectServer({ server: srv, secrets });
      const now = Date.now();
      const next = servers.map((s) =>
        s.id === srv.id
          ? {
              ...s,
              status: 'connected' as const,
              enabled: true,
              tools: res.tools,
              resources: res.resources,
              prompts: res.prompts,
              protocolVersion: res.protocolVersion,
              latencyMs: res.latencyMs,
              lastPingAt: now,
              lastConnectedAt: now,
            }
          : s
      );
      await persistServers(next);
      setStatusMsg(`Connected to ${srv.name}: ${res.tools.length} tools (${res.latencyMs}ms)`);
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : 'Connection failed');
    }
  };

  const handlePing = async (srv: McpServerConfig) => {
    const secrets = await loadServerSecrets(srv.id);
    const outcome = await pingMcpServer({ server: srv, secrets });
    const now = Date.now();
    const next = servers.map((s) =>
      s.id === srv.id
        ? {
            ...s,
            status: (outcome.ok ? 'connected' : 'error') as McpServerConfig['status'],
            latencyMs: outcome.latencyMs,
            lastPingAt: now,
            lastError: outcome.ok ? undefined : outcome.error,
          }
        : s
    );
    await persistServers(next);
    setStatusMsg(outcome.ok ? `${srv.name} ping: ${outcome.latencyMs}ms` : outcome.error ?? 'Ping failed');
  };

  const handleDisconnect = async (srv: McpServerConfig) => {
    await disconnectMcpServer(srv.id);
    const next = servers.map((s) =>
      s.id === srv.id ? { ...s, status: 'disconnected' as const } : s
    );
    await persistServers(next);
    setStatusMsg(`Disconnected ${srv.name}`);
  };

  const handleToggleEnabled = async (srv: McpServerConfig, enabled: boolean) => {
    const next = servers.map((s) => (s.id === srv.id ? { ...s, enabled } : s));
    await persistServers(next);
  };

  const handleAddServer = async () => {
    const name = newName.trim();
    const url = newUrl.trim();
    if (!name || !url) return;
    if (!url.startsWith('https://') && !url.startsWith('http://localhost') && !url.startsWith('http://127.0.0.1')) {
      setStatusMsg('Remote MCP servers must use HTTPS.');
      return;
    }
    const id = `srv_${Date.now()}`;
    const hasBearer = Boolean(newBearer.trim());
    const created: McpServerConfig = {
      id,
      name,
      url,
      authType: hasBearer ? 'bearer' : newAuthType,
      enabled: true,
      transportPreference: 'auto',
      status: 'disconnected',
      tools: [],
      resources: [],
      prompts: [],
      disabledTools: [],
    };
    if (hasBearer) {
      await saveServerSecrets(id, { bearerToken: newBearer.trim() });
    }
    await persistServers([...servers, created]);
    setNewName('');
    setNewUrl('');
    setNewBearer('');
    setStatusMsg(`Added ${name}. Tap Test Connection to discover tools.`);
  };

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={{ flex: 1, backgroundColor: theme.background }}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }}>
        <WorkspaceHeading title="MCP Servers" subtitle="Connect and manage remote MCP tools." />
        {statusMsg ? (
          <Text style={{ color: theme.accent, fontSize: 13 }}>{statusMsg}</Text>
        ) : null}

        <WorkspaceCard>
          <Text style={{ fontSize: 14, fontWeight: '600', color: theme.text }}>
            Add Remote MCP Server
          </Text>
          <TextInput
            value={newName}
            onChangeText={setNewName}
            placeholder="Server name"
            accessibilityLabel="Server name"
            placeholderTextColor={theme.muted}
            style={{
              minHeight: 44,
              paddingHorizontal: 12,
              borderRadius: 10,
              backgroundColor: theme.background,
              color: theme.text,
              borderWidth: 1,
              borderColor: theme.border,
            }}
          />
          <TextInput
            value={newUrl}
            onChangeText={setNewUrl}
            autoCapitalize="none"
            placeholder="https://mcp.example.com/mcp"
            accessibilityLabel="Server URL"
            placeholderTextColor={theme.muted}
            style={{
              minHeight: 44,
              paddingHorizontal: 12,
              borderRadius: 10,
              backgroundColor: theme.background,
              color: theme.text,
              borderWidth: 1,
              borderColor: theme.border,
            }}
          />
          <TextInput
            value={newBearer}
            onChangeText={setNewBearer}
            secureTextEntry
            placeholder="Optional bearer token"
            accessibilityLabel="Bearer token"
            placeholderTextColor={theme.muted}
            style={{
              minHeight: 44,
              paddingHorizontal: 12,
              borderRadius: 10,
              backgroundColor: theme.background,
              color: theme.text,
              borderWidth: 1,
              borderColor: theme.border,
            }}
          />
          <Pressable
            onPress={() => void handleAddServer()}
            style={{ minHeight: 44, justifyContent: 'center', backgroundColor: workspaceBlue, borderRadius: 10, alignItems: 'center' }}
          >
            <Text style={{ color: '#FFFFFF', fontWeight: '600' }}>Add Server</Text>
          </Pressable>
        </WorkspaceCard>

        {servers.map((srv) => (
          <View
            key={srv.id}
            style={{
              padding: 16,
              borderRadius: 16,
              backgroundColor: theme.panel,
              borderWidth: 1,
              borderColor: theme.border,
              gap: 8,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <Text style={{ fontSize: 16, fontWeight: '600', color: theme.text, flex: 1 }}>
                {srv.name}
              </Text>
              <Switch
                accessibilityLabel={`Enable ${srv.name}`}
                value={srv.enabled}
                onValueChange={(v) => void handleToggleEnabled(srv, v)}
              />
            </View>
            <Text style={{ fontSize: 13, color: theme.muted }}>{srv.url}</Text>
            <Text style={{ fontSize: 12, fontWeight: '600', color: theme.accent }}>
              {srv.status} · {srv.tools.length} tools
              {srv.protocolVersion ? ` · ${srv.protocolVersion}` : ''}
              {typeof srv.latencyMs === 'number' && srv.status === 'connected' ? ` · ${srv.latencyMs}ms` : ''}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <Pressable
                onPress={() => void handleTest(srv)}
                style={{ minHeight: 44, justifyContent: 'center', backgroundColor: workspaceBlue, paddingHorizontal: 14, borderRadius: 10 }}
              >
                <Text style={{ color: '#FFFFFF', fontWeight: '600' }}>Test Connection</Text>
              </Pressable>
              {srv.status === 'connected' && (
                <>
                  <Pressable
                    onPress={() => void handlePing(srv)}
                    style={{ minHeight: 44, justifyContent: 'center', backgroundColor: '#0EA5E9', paddingHorizontal: 14, borderRadius: 10 }}
                  >
                    <Text style={{ color: '#FFFFFF', fontWeight: '600' }}>Ping</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => void handleDisconnect(srv)}
                    style={{ minHeight: 44, justifyContent: 'center', backgroundColor: '#475569', paddingHorizontal: 14, borderRadius: 10 }}
                  >
                    <Text style={{ color: '#FFFFFF', fontWeight: '600' }}>Disconnect</Text>
                  </Pressable>
                </>
              )}
              {srv.authType === 'oauth_pkce' && (
                <Pressable
                  onPress={() => void runExpoOAuthPkceFlow({ serverUrl: srv.url })}
                  style={{ minHeight: 44, justifyContent: 'center', backgroundColor: '#0F172A', paddingHorizontal: 14, borderRadius: 10 }}
                >
                  <Text style={{ color: '#FFFFFF', fontWeight: '600' }}>OAuth Sign-In</Text>
                </Pressable>
              )}
            </View>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
