import { useEffect, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  Text,
  TextInput,
  View,
  useColorScheme,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams } from 'expo-router';
import { getModelById } from '@core/config/models';
import { runAgentLoop } from '@core/services/llm/agentLoop';
import type { LlmConversationItem } from '@core/services/llm/types';
import { connectAndInspectServer } from '@core/services/mcp/client';
import { BUILT_IN_AGENTS, DEFAULT_SETTINGS } from '@core/store/defaults';
import { loadProviderKeys, loadServerSecrets, saveServerSecrets } from '@core/services/storage/secureStorage';
import type {
  AgentProfile,
  AppSettings,
  ApprovalDecision,
  ChatMessage,
  Conversation,
  EffortLevel,
  McpServerConfig,
  PendingApproval,
  ToolCallRecord,
} from '@core/types';
import {
  scheduleApprovalNeededNotification,
  scheduleRunCompleteNotification,
} from '../../services/notifications';
import { loadMobilePrefs, saveMobilePrefs, subscribeMobilePrefs } from '../../services/storage/mobilePrefs';
import { sqliteHistoryDb } from '../../services/storage/sqliteHistory';

function buildHistoryFromMessages(msgs: ChatMessage[]): LlmConversationItem[] {
  const items: LlmConversationItem[] = [];
  for (const m of msgs) {
    if (m.role === 'user') {
      items.push({ role: 'user', text: m.content });
    } else if (m.role === 'assistant' && m.content.trim()) {
      const toolSummary =
        m.toolCalls && m.toolCalls.length > 0
          ? `\n\n[Executed tools: ${m.toolCalls.map((t) => t.toolName).join(', ')}]`
          : '';
      items.push({ role: 'assistant', text: `${m.content}${toolSummary}` });
    }
  }
  return items;
}

export default function MobileChatScreen() {
  const isDark = useColorScheme() === 'dark';
  const params = useLocalSearchParams<{ sharedText?: string }>();
  const [agents, setAgents] = useState<AgentProfile[]>(BUILT_IN_AGENTS);
  const [selectedAgentId, setSelectedAgentId] = useState<string>(BUILT_IN_AGENTS[0].id);
  const [servers, setServers] = useState<McpServerConfig[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [effort, setEffort] = useState<EffortLevel>('medium');
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [running, setRunning] = useState(false);
  const [abortCtrl, setAbortCtrl] = useState<AbortController | null>(null);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const [voiceHint, setVoiceHint] = useState('');
  const inputRef = useRef<TextInput | null>(null);
  const approvalResolverRef = useRef<((decision: ApprovalDecision) => void) | null>(null);
  const lastSharedRef = useRef<string | null>(null);

  const agent = agents.find((a) => a.id === selectedAgentId) ?? agents[0] ?? BUILT_IN_AGENTS[0];
  const model = getModelById(agent.defaultModelId);

  useEffect(() => {
    const incoming = typeof params.sharedText === 'string' ? params.sharedText.trim() : '';
    if (incoming && lastSharedRef.current !== incoming) {
      lastSharedRef.current = incoming;
      setInput((prev) => (prev.trim() ? `${prev.trim()}\n\n${incoming}` : incoming));
    }
  }, [params.sharedText]);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      const [prefs, savedConvs] = await Promise.all([
        loadMobilePrefs(),
        sqliteHistoryDb.listConversations(),
      ]);
      if (!mounted) return;

      // Ensure virtual sandbox tools are inspected for mobile
      const hydratedServers = await Promise.all(
        prefs.servers.map(async (srv) => {
          if (srv.enabled && srv.url === 'virtual://mcp-hub-sandbox' && srv.tools.length === 0) {
            try {
              const res = await connectAndInspectServer({ server: srv, secrets: {} });
              return { ...srv, status: 'connected' as const, tools: res.tools, resources: res.resources, prompts: res.prompts };
            } catch {
              return srv;
            }
          }
          return srv;
        })
      );
      if (!mounted) return;

      setAgents(prefs.agents);
      setSelectedAgentId(prefs.selectedAgentId);
      setServers(hydratedServers);
      setSettings(prefs.settings);

      if (savedConvs.length > 0) {
        const chosen =
          savedConvs.find((c) => c.id === prefs.activeConversationId) ?? savedConvs[0];
        setConversations(savedConvs);
        setActiveConvId(chosen.id);
        setMessages(chosen.messages);
        setEffort(chosen.effort);
      } else {
        const now = Date.now();
        const initialConv: Conversation = {
          id: `conv_${now}`,
          title: 'New Chat',
          agentId: prefs.selectedAgentId,
          modelId: getModelById(
            (prefs.agents.find((a) => a.id === prefs.selectedAgentId) ?? prefs.agents[0]).defaultModelId
          ).id,
          effort: 'medium',
          chatMode: 'professional',
          knowledgeSource: 'auto',
          studyInstructions: '',
          messages: [],
          createdAt: now,
          updatedAt: now,
        };
        await sqliteHistoryDb.saveConversation(initialConv);
        await saveMobilePrefs({ activeConversationId: initialConv.id });
        if (!mounted) return;
        setConversations([initialConv]);
        setActiveConvId(initialConv.id);
        setMessages([]);
      }
    })();

    const unsub = subscribeMobilePrefs((prefs) => {
      setAgents(prefs.agents);
      setSelectedAgentId(prefs.selectedAgentId);
      setServers(prefs.servers);
      setSettings(prefs.settings);
    });

    return () => {
      mounted = false;
      unsub();
    };
  }, []);

  useEffect(() => {
    return () => {
      abortCtrl?.abort();
    };
  }, [abortCtrl]);

  const handleNewChat = async () => {
    if (running) return;
    const now = Date.now();
    const conv: Conversation = {
      id: `conv_${now}`,
      title: 'New Chat',
      agentId: agent.id,
      modelId: model.id,
      effort,
      chatMode: agent.defaultChatMode ?? 'professional',
      knowledgeSource: 'auto',
      studyInstructions: agent.studyInstructions ?? '',
      messages: [],
      createdAt: now,
      updatedAt: now,
    };
    await sqliteHistoryDb.saveConversation(conv);
    await saveMobilePrefs({ activeConversationId: conv.id });
    setConversations((prev) => [conv, ...prev]);
    setActiveConvId(conv.id);
    setMessages([]);
  };

  const handleCycleAgent = async () => {
    const idx = agents.findIndex((a) => a.id === agent.id);
    const nextAgent = agents[(idx + 1) % agents.length];
    setSelectedAgentId(nextAgent.id);
    await saveMobilePrefs({ selectedAgentId: nextAgent.id });
  };

  const persistConvSnapshot = async (nextMessages: ChatMessage[], titleSeed?: string) => {
    const now = Date.now();
    const existing = conversations.find((c) => c.id === activeConvId);
    const convId = activeConvId ?? `conv_${now}`;
    const conv: Conversation = {
      id: convId,
      title:
        existing && existing.title !== 'New Chat'
          ? existing.title
          : (titleSeed?.slice(0, 48) || existing?.title || 'New Chat'),
      agentId: agent.id,
      modelId: model.id,
      effort,
      chatMode: agent.defaultChatMode ?? 'professional',
      knowledgeSource: 'auto',
      studyInstructions: agent.studyInstructions ?? '',
      messages: nextMessages,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await sqliteHistoryDb.saveConversation(conv);
    setConversations((prev) => [conv, ...prev.filter((c) => c.id !== conv.id)]);
    if (!activeConvId) {
      setActiveConvId(conv.id);
      await saveMobilePrefs({ activeConversationId: conv.id });
    }
  };

  const resolveApproval = (decision: ApprovalDecision) => {
    const resolver = approvalResolverRef.current;
    approvalResolverRef.current = null;
    setPendingApproval(null);
    resolver?.(decision);
  };

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

    const historyBeforeSend = [...messages, userMsg];
    const nextMessages = [...historyBeforeSend, assistantMsg];
    setMessages(nextMessages);
    await persistConvSnapshot(nextMessages, trimmed);

    const ctrl = new AbortController();
    setAbortCtrl(ctrl);
    setRunning(true);

    let latestMessages = nextMessages;
    try {
      const keys = await loadProviderKeys();
      const hasKey = Boolean(keys.gemini || keys.groq || keys.openrouter);
      const res = await runAgentLoop({
        agent,
        modelId: hasKey ? model.id : 'demo-sandbox',
        effort,
        keys,
        servers: servers.filter((s) => s.enabled),
        history: buildHistoryFromMessages(historyBeforeSend),
        a2uiMode: settings.a2uiMode,
        maxSteps: settings.maxAgentSteps,
        confirmBeforeWrite: settings.confirmBeforeWrite,
        alwaysAllowedTools: settings.alwaysAllowedTools,
        signal: ctrl.signal,
        callbacks: {
          onTextDelta: (fullText) => {
            latestMessages = latestMessages.map((m) =>
              m.id === assistantId ? { ...m, content: fullText } : m
            );
            setMessages(latestMessages);
          },
          onReasoningDelta: () => {},
          onToolCallsUpdated: (calls: ToolCallRecord[]) => {
            latestMessages = latestMessages.map((m) =>
              m.id === assistantId ? { ...m, toolCalls: calls } : m
            );
            setMessages(latestMessages);
          },
          onFallbackNotice: () => {},
          requestApproval: (req) => {
            void scheduleApprovalNeededNotification(req.serverName, req.toolName);
            return new Promise<ApprovalDecision>((resolve) => {
              approvalResolverRef.current = resolve;
              setPendingApproval(req);
            });
          },
          onAlwaysAllowTool: (qualifiedKey) => {
            const updatedAllowed = Array.from(
              new Set([...settings.alwaysAllowedTools, qualifiedKey])
            );
            const nextSettings = { ...settings, alwaysAllowedTools: updatedAllowed };
            setSettings(nextSettings);
            void saveMobilePrefs({ settings: nextSettings });
          },
          getServerSecrets: loadServerSecrets,
          saveServerSecrets,
        },
      });

      const finalized = latestMessages.map((m) =>
        m.id === assistantId ? { ...m, content: res.finalText, isStreaming: false } : m
      );
      setMessages(finalized);
      await persistConvSnapshot(finalized, trimmed);
      void scheduleRunCompleteNotification(res.finalText);
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
          gap: 8,
        }}
      >
        <Pressable
          onPress={() => void handleCycleAgent()}
          style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: isDark ? '#1E293B' : '#E2E8F0' }}
        >
          <Text style={{ fontWeight: '600', color: isDark ? '#F8FAFC' : '#0F172A' }}>{agent.name}</Text>
        </Pressable>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <Pressable
            onPress={() => void handleNewChat()}
            style={{ paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, backgroundColor: isDark ? '#1E293B' : '#E2E8F0' }}
          >
            <Text style={{ fontWeight: '600', color: isDark ? '#F8FAFC' : '#0F172A' }}>New</Text>
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
            {item.toolCalls && item.toolCalls.length > 0 ? (
              <Text style={{ fontSize: 11, color: '#94A3B8', marginBottom: 4 }}>
                Tools: {item.toolCalls.map((t) => `${t.toolName} (${t.status})`).join(', ')}
              </Text>
            ) : null}
            <Text style={{ color: item.role === 'user' ? '#FFFFFF' : isDark ? '#F1F5F9' : '#0F172A' }}>
              {item.content || 'Thinking...'}
            </Text>
          </View>
        )}
      />

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {voiceHint ? (
          <View style={{ paddingHorizontal: 14, paddingTop: 6 }}>
            <Text style={{ fontSize: 11, color: isDark ? '#93C5FD' : '#1D4ED8' }}>{voiceHint}</Text>
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', padding: 12, gap: 8 }}>
          <TextInput
            ref={inputRef}
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
            onPress={() => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              inputRef.current?.focus();
              setVoiceHint(
                Platform.OS === 'ios'
                  ? 'Tap the microphone icon on your iOS keyboard to dictate directly.'
                  : 'Tap the Gboard microphone key on your Android keyboard to dictate directly.'
              );
            }}
            style={{
              minHeight: 44,
              borderRadius: 16,
              backgroundColor: isDark ? '#1E293B' : '#E2E8F0',
              justifyContent: 'center',
              alignItems: 'center',
              paddingHorizontal: 12,
            }}
          >
            <Text style={{ color: isDark ? '#F8FAFC' : '#0F172A', fontWeight: '600', fontSize: 12 }}>
              Mic
            </Text>
          </Pressable>
          <Pressable
            onPress={running ? () => abortCtrl?.abort() : () => void handleSend()}
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

      <Modal visible={Boolean(pendingApproval)} transparent animationType="fade">
        <View
          style={{
            flex: 1,
            backgroundColor: 'rgba(2, 6, 23, 0.72)',
            justifyContent: 'center',
            padding: 20,
          }}
        >
          <View
            style={{
              backgroundColor: isDark ? '#0F172A' : '#FFFFFF',
              borderRadius: 20,
              padding: 18,
              gap: 12,
              borderWidth: 1,
              borderColor: isDark ? '#334155' : '#E2E8F0',
            }}
          >
            <Text style={{ fontSize: 17, fontWeight: '700', color: isDark ? '#FFFFFF' : '#0F172A' }}>
              Approve Write Action
            </Text>
            <Text style={{ fontSize: 13, color: isDark ? '#CBD5E1' : '#334155' }}>
              {pendingApproval?.serverName} · {pendingApproval?.toolName}
            </Text>
            <Text
              style={{
                fontSize: 12,
                fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
                backgroundColor: isDark ? '#020617' : '#F1F5F9',
                color: isDark ? '#E2E8F0' : '#0F172A',
                padding: 10,
                borderRadius: 10,
              }}
            >
              {JSON.stringify(pendingApproval?.args ?? {}, null, 2)}
            </Text>
            <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'flex-end' }}>
              <Pressable
                onPress={() => resolveApproval('deny')}
                style={{ paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, backgroundColor: '#DC2626' }}
              >
                <Text style={{ color: '#FFFFFF', fontWeight: '600' }}>Deny</Text>
              </Pressable>
              <Pressable
                onPress={() => resolveApproval('always_allow')}
                style={{ paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, backgroundColor: '#0F766E' }}
              >
                <Text style={{ color: '#FFFFFF', fontWeight: '600' }}>Always</Text>
              </Pressable>
              <Pressable
                onPress={() => resolveApproval('approve')}
                style={{ paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, backgroundColor: '#2563EB' }}
              >
                <Text style={{ color: '#FFFFFF', fontWeight: '600' }}>Approve</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
