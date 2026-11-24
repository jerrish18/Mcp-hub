import { useEffect, useState } from 'react';
import { Pressable, SafeAreaView, ScrollView, Text, View, useColorScheme } from 'react-native';
import type { AgentProfile } from '@core/types';
import { loadMobilePrefs, saveMobilePrefs } from '../../services/storage/mobilePrefs';

export default function MobileAgentsScreen() {
  const isDark = useColorScheme() === 'dark';
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');

  useEffect(() => {
    void loadMobilePrefs().then((prefs) => {
      setAgents(prefs.agents);
      setSelectedId(prefs.selectedAgentId);
    });
  }, []);

  const handleSelect = async (agentId: string) => {
    setSelectedId(agentId);
    await saveMobilePrefs({ selectedAgentId: agentId });
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: isDark ? '#020617' : '#F8FAFC' }}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        <Text style={{ fontSize: 24, fontWeight: '700', color: isDark ? '#FFFFFF' : '#0F172A' }}>
          Agents
        </Text>
        <Text style={{ fontSize: 13, color: '#64748B' }}>
          Tap an agent profile to use it as the active assistant in Chat.
        </Text>
        {agents.map((agent) => {
          const active = agent.id === selectedId;
          return (
            <Pressable
              key={agent.id}
              onPress={() => void handleSelect(agent.id)}
              style={{
                padding: 16,
                borderRadius: 16,
                backgroundColor: isDark ? '#0F172A' : '#FFFFFF',
                borderWidth: active ? 2 : 1,
                borderColor: active ? '#2563EB' : isDark ? '#1E293B' : '#E2E8F0',
                gap: 6,
              }}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ fontSize: 16, fontWeight: '600', color: isDark ? '#FFFFFF' : '#0F172A' }}>
                  {agent.name}
                </Text>
                {active ? (
                  <Text style={{ fontSize: 12, fontWeight: '700', color: '#2563EB' }}>ACTIVE</Text>
                ) : null}
              </View>
              <Text style={{ fontSize: 13, color: isDark ? '#CBD5E1' : '#475569' }}>
                {agent.description}
              </Text>
              <Text style={{ fontSize: 12, color: '#64748B' }}>
                Default model: {agent.defaultModelId} · Effort: {agent.defaultEffort}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}
