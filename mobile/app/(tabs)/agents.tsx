import { WorkspaceHeading, useWorkspaceTheme } from '../../ui/workspace';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Bot, Check } from 'lucide-react-native';
import type { AgentProfile } from '@core/types';
import { loadMobilePrefs, saveMobilePrefs } from '../../services/storage/mobilePrefs';

export default function MobileAgentsScreen() {
  const theme = useWorkspaceTheme();
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
    <SafeAreaView edges={['top', 'left', 'right']} style={{ flex: 1, backgroundColor: theme.background }}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }}>
        <WorkspaceHeading title="Agents" subtitle="Choose the assistant you want to use in Chat." />
        {agents.map((agent) => {
          const active = agent.id === selectedId;
          return (
            <Pressable
              key={agent.id}
              onPress={() => void handleSelect(agent.id)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              style={{
                padding: 16,
                borderRadius: 16,
                backgroundColor: active ? theme.accentSurface : theme.panel,
                borderWidth: 1,
                borderColor: active ? theme.accent : theme.border,
                gap: 6,
              }}
            >
              <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
                <View style={{ backgroundColor: active ? theme.panel : theme.accentSurface, padding: 8, borderRadius: 9 }}>
                  <Bot size={17} color={theme.accent} />
                </View>
                <Text style={{ flex: 1, fontSize: 16, fontWeight: '700', color: theme.text }}>{agent.name}</Text>
                {active && <Check size={18} color={theme.onAccentSurface} />}
              </View>
              <Text style={{ fontSize: 13, color: theme.muted }}>
                {agent.description}
              </Text>
              <Text style={{ fontSize: 12, color: theme.muted }}>
                Default model: {agent.defaultModelId} · Effort: {agent.defaultEffort}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}
