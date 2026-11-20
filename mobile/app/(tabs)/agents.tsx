import { SafeAreaView, ScrollView, Text, View, useColorScheme } from 'react-native';
import { BUILT_IN_AGENTS } from '@core/store/defaults';

export default function MobileAgentsScreen() {
  const isDark = useColorScheme() === 'dark';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: isDark ? '#020617' : '#F8FAFC' }}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        <Text style={{ fontSize: 24, fontWeight: '700', color: isDark ? '#FFFFFF' : '#0F172A' }}>
          Agents
        </Text>
        {BUILT_IN_AGENTS.map((agent) => (
          <View
            key={agent.id}
            style={{
              padding: 16,
              borderRadius: 16,
              backgroundColor: isDark ? '#0F172A' : '#FFFFFF',
              borderWidth: 1,
              borderColor: isDark ? '#1E293B' : '#E2E8F0',
              gap: 6,
            }}
          >
            <Text style={{ fontSize: 16, fontWeight: '600', color: isDark ? '#FFFFFF' : '#0F172A' }}>
              {agent.name}
            </Text>
            <Text style={{ fontSize: 13, color: isDark ? '#CBD5E1' : '#475569' }}>
              {agent.description}
            </Text>
            <Text style={{ fontSize: 12, color: '#64748B' }}>
              Default model: {agent.defaultModelId} · Effort: {agent.defaultEffort}
            </Text>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
