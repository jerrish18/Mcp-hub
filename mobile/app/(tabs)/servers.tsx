import { useEffect, useState } from 'react';
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
  useColorScheme,
} from 'react-native';
import { connectAndInspectServer } from '@core/services/mcp/client';
import { loadServerSecrets, saveServerSecrets } from '@core/services/storage/secureStorage';
import type { McpServerConfig } from '@core/types';
import { runExpoOAuthPkceFlow } from '../../services/auth/expoOAuth';
import { loadMobilePrefs, saveMobilePrefs } from '../../services/storage/mobilePrefs';

export default function MobileServersScreen() {
  const isDark = useColorScheme() === 'dark';
  const [servers, setServers] = useState<McpServerConfig[]>([]);
  const [statusMsg, setStatusMsg] = useState('');
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [newBearer, setNewBearer] = useState('');

  useEffect(() => {
    void loadMobilePrefs().then((prefs) => {
      setServers(prefs.servers);
    });
  }, []);

  const persistServers = async (next: McpServerConfig[]) => {
    setServers(next);
    await saveMobilePrefs({ servers: next });
  };

  const handleTest = async (srv: McpServerConfig) => {
    try {
      const secrets = await loadServerSecrets(srv.id);
      const res = await connectAndInspectServer({ server: srv, secrets });
      const next = servers.map((s) =>
        s.id === srv.id
          ? {
              ...s,
              status: 'connected' as const,
              enabled: true,
              tools: res.tools,
              resources: res.resources,
              prompts: res.prompts,
              lastConnectedAt: Date.now(),
            }
          : s
      );
      await persistServers(next);
      setStatusMsg(`Connected to ${srv.name}: ${res.tools.length} tools`);
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : 'Connection failed');
    }
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
      authType: hasBearer ? 'bearer' : 'none',
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
    <SafeAreaView style={{ flex: 1, backgroundColor: isDark ? '#020617' : '#F8FAFC' }}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        <Text style={{ fontSize: 24, fontWeight: '700', color: isDark ? '#FFFFFF' : '#0F172A' }}>
          MCP Servers
        </Text>
        {statusMsg ? (
          <Text style={{ color: '#2563EB', fontSize: 13 }}>{statusMsg}</Text>
        ) : null}

        <View
          style={{
            padding: 14,
            borderRadius: 16,
            backgroundColor: isDark ? '#0F172A' : '#FFFFFF',
            borderWidth: 1,
            borderColor: isDark ? '#1E293B' : '#E2E8F0',
            gap: 8,
          }}
        >
          <Text style={{ fontSize: 14, fontWeight: '600', color: isDark ? '#FFFFFF' : '#0F172A' }}>
            Add Remote MCP Server
          </Text>
          <TextInput
            value={newName}
            onChangeText={setNewName}
            placeholder="Server name (e.g. GitHub MCP)"
            placeholderTextColor="#94A3B8"
            style={{
              minHeight: 40,
              paddingHorizontal: 12,
              borderRadius: 10,
              backgroundColor: isDark ? '#020617' : '#F8FAFC',
              color: isDark ? '#FFFFFF' : '#0F172A',
              borderWidth: 1,
              borderColor: isDark ? '#1E293B' : '#CBD5E1',
            }}
          />
          <TextInput
            value={newUrl}
            onChangeText={setNewUrl}
            autoCapitalize="none"
            placeholder="https://mcp.example.com/mcp"
            placeholderTextColor="#94A3B8"
            style={{
              minHeight: 40,
              paddingHorizontal: 12,
              borderRadius: 10,
              backgroundColor: isDark ? '#020617' : '#F8FAFC',
              color: isDark ? '#FFFFFF' : '#0F172A',
              borderWidth: 1,
              borderColor: isDark ? '#1E293B' : '#CBD5E1',
            }}
          />
          <TextInput
            value={newBearer}
            onChangeText={setNewBearer}
            secureTextEntry
            placeholder="Optional Bearer token"
            placeholderTextColor="#94A3B8"
            style={{
              minHeight: 40,
              paddingHorizontal: 12,
              borderRadius: 10,
              backgroundColor: isDark ? '#020617' : '#F8FAFC',
              color: isDark ? '#FFFFFF' : '#0F172A',
              borderWidth: 1,
              borderColor: isDark ? '#1E293B' : '#CBD5E1',
            }}
          />
          <Pressable
            onPress={() => void handleAddServer()}
            style={{ backgroundColor: '#2563EB', paddingVertical: 10, borderRadius: 10, alignItems: 'center' }}
          >
            <Text style={{ color: '#FFFFFF', fontWeight: '600' }}>Add Server</Text>
          </Pressable>
        </View>

        {servers.map((srv) => (
          <View
            key={srv.id}
            style={{
              padding: 16,
              borderRadius: 16,
              backgroundColor: isDark ? '#0F172A' : '#FFFFFF',
              borderWidth: 1,
              borderColor: isDark ? '#1E293B' : '#E2E8F0',
              gap: 8,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <Text style={{ fontSize: 16, fontWeight: '600', color: isDark ? '#FFFFFF' : '#0F172A', flex: 1 }}>
                {srv.name}
              </Text>
              <Switch
                value={srv.enabled}
                onValueChange={(v) => void handleToggleEnabled(srv, v)}
              />
            </View>
            <Text style={{ fontSize: 12, color: '#64748B' }}>
              {srv.url} · {srv.status} · {srv.tools.length} tools
            </Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Pressable
                onPress={() => void handleTest(srv)}
                style={{ backgroundColor: '#2563EB', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10 }}
              >
                <Text style={{ color: '#FFFFFF', fontWeight: '600' }}>Test Connection</Text>
              </Pressable>
              {srv.authType === 'oauth_pkce' && (
                <Pressable
                  onPress={() => void runExpoOAuthPkceFlow({ serverUrl: srv.url })}
                  style={{ backgroundColor: '#0F172A', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10 }}
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
