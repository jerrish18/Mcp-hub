import { useState } from 'react';
import { Pressable, SafeAreaView, ScrollView, Text, View, useColorScheme } from 'react-native';
import { connectAndInspectServer } from '@core/services/mcp/client';
import { DEFAULT_SANDBOX_SERVER } from '@core/store/defaults';
import { loadServerSecrets } from '@core/services/storage/secureStorage';
import type { McpServerConfig } from '@core/types';
import { runExpoOAuthPkceFlow } from '../../services/auth/expoOAuth';

export default function MobileServersScreen() {
  const isDark = useColorScheme() === 'dark';
  const [servers, setServers] = useState<McpServerConfig[]>([DEFAULT_SANDBOX_SERVER]);
  const [statusMsg, setStatusMsg] = useState('');

  const handleTest = async (srv: McpServerConfig) => {
    try {
      const secrets = await loadServerSecrets(srv.id);
      const res = await connectAndInspectServer({ server: srv, secrets });
      setServers((prev) =>
        prev.map((s) => (s.id === srv.id ? { ...s, status: 'connected', tools: res.tools } : s))
      );
      setStatusMsg(`Connected to ${srv.name}: ${res.tools.length} tools`);
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : 'Connection failed');
    }
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
            <Text style={{ fontSize: 16, fontWeight: '600', color: isDark ? '#FFFFFF' : '#0F172A' }}>
              {srv.name}
            </Text>
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
