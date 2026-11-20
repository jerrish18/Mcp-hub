import { useEffect, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  Text,
  TextInput,
  View,
  useColorScheme,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { getModelById } from '@core/config/models';
import { runAgentLoop } from '@core/services/llm/agentLoop';
import { BUILT_IN_AGENTS, DEFAULT_SANDBOX_SERVER } from '@core/store/defaults';
import { loadProviderKeys, loadServerSecrets, saveServerSecrets } from '@core/services/storage/secureStorage';
import type { ChatMessage, EffortLevel, ToolCallRecord } from '@core/types';

export default function MobileChatScreen() {
  const isDark = useColorScheme() === 'dark';
  const [effort, setEffort] = useState<EffortLevel>('medium');
  const [agentIndex, setAgentIndex] = useState(0);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [running, setRunning] = useState(false);
  const [abortCtrl, setAbortCtrl] = useState<AbortController | null>(null);

  const agent = BUILT_IN_AGENTS[agentIndex];
  const model = getModelById(agent.defaultModelId);

  useEffect(() => {
    return () => {
      abortCtrl?.abort();
    };
  }, [abortCtrl]);

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed || running) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setInput('');

    const userMsg: ChatMessage = {
      id: `u_${Date.now()}`,
      role: 'user',
      content: trimmed,
      createdAt: Date.now(),
    };
    const assistantId = `a_${Date.now() + 1}`;
    const assistantMsg: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      toolCalls: [],
      createdAt: Date.now(),
      isStreaming: true,
    };
    setMessages((prev) => [...prev, userMsg, assistantMsg]);

    const ctrl = new AbortController();
    setAbortCtrl(ctrl);
    setRunning(true);

    try {
      const keys = await loadProviderKeys();
      const hasKey = Boolean(keys.gemini || keys.groq || keys.openrouter);
      const res = await runAgentLoop({
        agent,
        modelId: hasKey ? model.id : 'demo-sandbox',
        effort,
        keys,
        servers: [DEFAULT_SANDBOX_SERVER],
        history: [{ role: 'user', text: trimmed }],
        maxSteps: 10,
        confirmBeforeWrite: true,
        alwaysAllowedTools: [],
        signal: ctrl.signal,
        callbacks: {
          onTextDelta: (fullText) => {
            setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: fullText } : m)));
          },
          onReasoningDelta: () => {},
          onToolCallsUpdated: (calls: ToolCallRecord[]) => {
            setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, toolCalls: calls } : m)));
          },
          onFallbackNotice: () => {},
          requestApproval: async () => 'approve',
          onAlwaysAllowTool: () => {},
          getServerSecrets: loadServerSecrets,
          saveServerSecrets,
        },
      });
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId ? { ...m, content: res.finalText, isStreaming: false } : m
        )
      );
    } finally {
      setRunning(false);
      setAbortCtrl(null);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: isDark ? '#020617' : '#F8FAFC' }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: 14,
          paddingVertical: 10,
          borderBottomWidth: 1,
          borderBottomColor: isDark ? '#1E293B' : '#E2E8F0',
        }}
      >
        <Pressable
          onPress={() => setAgentIndex((i) => (i + 1) % BUILT_IN_AGENTS.length)}
          style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: isDark ? '#1E293B' : '#E2E8F0' }}
        >
          <Text style={{ fontWeight: '600', color: isDark ? '#F8FAFC' : '#0F172A' }}>{agent.name}</Text>
        </Pressable>
        <Pressable
          onPress={() => {
            const next: Record<EffortLevel, EffortLevel> = { low: 'medium', medium: 'high', high: 'low' };
            setEffort((e) => next[e]);
          }}
          style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: '#2563EB' }}
        >
          <Text style={{ fontWeight: '600', color: '#FFFFFF' }}>Effort: {effort}</Text>
        </Pressable>
      </View>

      <FlatList
        data={messages}
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ padding: 14, gap: 10 }}
        renderItem={({ item }) => (
          <View
            style={{
              alignSelf: item.role === 'user' ? 'flex-end' : 'flex-start',
              backgroundColor: item.role === 'user' ? '#2563EB' : isDark ? '#0F172A' : '#FFFFFF',
              padding: 12,
              borderRadius: 16,
              maxWidth: '88%',
            }}
          >
            <Text style={{ color: item.role === 'user' ? '#FFFFFF' : isDark ? '#F1F5F9' : '#0F172A' }}>
              {item.content || 'Thinking...'}
            </Text>
          </View>
        )}
      />

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={{ flexDirection: 'row', padding: 12, gap: 8 }}>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder={`Message ${agent.name}...`}
            placeholderTextColor="#94A3B8"
            style={{
              flex: 1,
              minHeight: 44,
              paddingHorizontal: 14,
              borderRadius: 16,
              backgroundColor: isDark ? '#0F172A' : '#FFFFFF',
              color: isDark ? '#FFFFFF' : '#0F172A',
              borderWidth: 1,
              borderColor: isDark ? '#1E293B' : '#CBD5E1',
            }}
          />
          <Pressable
            onPress={running ? () => abortCtrl?.abort() : handleSend}
            style={{
              minWidth: 64,
              minHeight: 44,
              borderRadius: 16,
              backgroundColor: running ? '#DC2626' : '#2563EB',
              justifyContent: 'center',
              alignItems: 'center',
              paddingHorizontal: 14,
            }}
          >
            <Text style={{ color: '#FFFFFF', fontWeight: '600' }}>{running ? 'Stop' : 'Send'}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
