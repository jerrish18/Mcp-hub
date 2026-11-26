import { ChatReply } from '../../ui/ChatReply';
import { useWorkspaceTheme, workspaceBlue } from '../../ui/workspace';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { ArrowUp, ChevronDown, MessageSquare, Mic, MicOff, Plus, Square } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { fetch as expoFetch } from 'expo/fetch';
import { getAvailableModels, getUnavailableCatalogModels, preserveCatalogForSameCredentials, retainTransientCatalogRoutes, syncLiveProviderModels } from '@core/services/llm/provider';
import { CATALOG_TTL } from '@core/services/llm/freeRegistry';
import { safeErrorMessage } from '@core/utils/redact';
import { getModelById, PROVIDER_INFO } from '@core/config/models';
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
  ChatMode,
  Conversation,
  EffortLevel,
  McpServerConfig,
  ModelConfig,
  ProviderKeys,
  PendingApproval,
  ToolCallRecord,
} from '@core/types';
import {
  scheduleApprovalNeededNotification,
  scheduleRunCompleteNotification,
} from '../../services/notifications';
import {
  loadMobilePrefs,
  registerMobileFlushHandler,
  saveMobilePrefs,
  subscribeMobilePrefs,
} from '../../services/storage/mobilePrefs';
import { sqliteHistoryDb } from '../../services/storage/sqliteHistory';

interface ExpoSpeechRecognitionLike {
  getPermissionsAsync?: () => Promise<{ granted: boolean }>;
  requestPermissionsAsync?: () => Promise<{ granted: boolean }>;
  addListener?: (
    event: 'result' | 'error' | 'end',
    listener: (ev: { results?: Array<{ transcript?: string }>; error?: string }) => void
  ) => { remove: () => void };
  start: (opts: { lang?: string; interimResults?: boolean; continuous?: boolean }) => void;
  stop: () => void;
}

async function tryLoadSpeechRecognitionModule(): Promise<ExpoSpeechRecognitionLike | null> {
  if (Platform.OS === 'web') return null;
  try {
    const pkgName = 'expo-speech-recognition';
    const mod = (await import(pkgName)) as {
      ExpoSpeechRecognitionModule?: ExpoSpeechRecognitionLike;
      default?: ExpoSpeechRecognitionLike;
    };
    return mod.ExpoSpeechRecognitionModule ?? mod.default ?? null;
  } catch {
    return null;
  }
}

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
  const params = useLocalSearchParams<{ sharedText?: string }>();
  const [agents, setAgents] = useState<AgentProfile[]>(BUILT_IN_AGENTS);
  const [selectedAgentId, setSelectedAgentId] = useState<string>(BUILT_IN_AGENTS[0].id);
  const [servers, setServers] = useState<McpServerConfig[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [effort, setEffort] = useState<EffortLevel>('medium');
  const [chatMode, setChatMode] = useState<ChatMode>('professional');
  const [selectedModelId, setSelectedModelId] = useState<string | undefined>();
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [showUnavailableModels, setShowUnavailableModels] = useState(false);
  const catalogKeys = useRef<ProviderKeys>({});
  const [cloudModels, setCloudModels] = useState<ModelConfig[]>([]);
  const [showReasoning, setShowReasoning] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [running, setRunning] = useState(false);
  const [abortCtrl, setAbortCtrl] = useState<AbortController | null>(null);
  const [pendingApproval, setPendingApproval] = useState<Omit<PendingApproval, 'resolve'> | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [voiceHint, setVoiceHint] = useState('');
  const inputRef = useRef<TextInput | null>(null);
  const threadRef = useRef<FlatList<ChatMessage>>(null);
  const followLatest = useRef(true);
  const approvalResolverRef = useRef<((decision: ApprovalDecision) => void) | null>(null);
  const lastSharedRef = useRef<string | null>(null);
  const speechModuleRef = useRef<ExpoSpeechRecognitionLike | null>(null);
  const speechSubsRef = useRef<Array<{ remove: () => void }>>([]);
  const latestMessagesRef = useRef<ChatMessage[]>([]);

  latestMessagesRef.current = messages;

  const agent = agents.find((a) => a.id === selectedAgentId) ?? agents[0] ?? BUILT_IN_AGENTS[0];
  const model = getModelById(selectedModelId ?? agent.defaultModelId, cloudModels);

  useFocusEffect(useCallback(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      let retrySoon = true;
      try {
        const keys = await loadProviderKeys();
        const { models, transientProviders } = await syncLiveProviderModels(keys, expoFetch as unknown as typeof fetch);
        if (!active) return;
        const previousKeys = catalogKeys.current;
        catalogKeys.current = keys;
        setCloudModels((previous) => retainTransientCatalogRoutes(
          models, preserveCatalogForSameCredentials(previous, previousKeys, keys), transientProviders, keys,
        ));
        retrySoon = transientProviders.length > 0;
      } catch {
        retrySoon = true;
      } finally {
        if (active) timer = setTimeout(() => void refresh(), retrySoon ? 60_000 : CATALOG_TTL - 60_000);
      }
    };
    void refresh();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, []));

  useEffect(() => {
    const incoming = typeof params.sharedText === 'string' ? params.sharedText.trim() : '';
    if (incoming && lastSharedRef.current !== incoming) {
      lastSharedRef.current = incoming;
      setInput((prev) => (prev.trim() ? `${prev.trim()}\n\n${incoming}` : incoming));
    }
  }, [params.sharedText]);

  const persistConvSnapshot = useCallback(
    async (nextMessages: ChatMessage[], titleSeed?: string, mode = chatMode, modelId = model.id) => {
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
        modelId,
        effort,
        chatMode: mode,
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
    },
    [activeConvId, agent, chatMode, conversations, effort, model.id]
  );

  useEffect(() => {
    const unregFlush = registerMobileFlushHandler(async () => {
      if (activeConvId && latestMessagesRef.current.length > 0) {
        await persistConvSnapshot(latestMessagesRef.current);
      }
    });
    return unregFlush;
  }, [activeConvId, persistConvSnapshot]);

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
        setChatMode(chosen.chatMode ?? 'professional');
        setSelectedModelId(chosen.modelId);
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
      for (const s of speechSubsRef.current) s.remove();
      speechSubsRef.current = [];
      speechModuleRef.current?.stop();
    };
  }, [abortCtrl]);

  const handleToggleVoice = async () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setVoiceHint('');

    if (isListening && speechModuleRef.current) {
      speechModuleRef.current.stop();
      setIsListening(false);
      return;
    }

    const speechMod = await tryLoadSpeechRecognitionModule();
    if (!speechMod) {
      inputRef.current?.focus();
      setVoiceHint(
        Platform.OS === 'ios'
          ? 'Tap the microphone key on your iOS keyboard to dictate directly.'
          : 'Tap the Gboard microphone key on your Android keyboard to dictate directly.'
      );
      return;
    }

    try {
      const currentPerm = speechMod.getPermissionsAsync ? await speechMod.getPermissionsAsync() : { granted: true };
      const granted = currentPerm.granted
        ? true
        : speechMod.requestPermissionsAsync
          ? (await speechMod.requestPermissionsAsync()).granted
          : false;
      if (!granted) {
        setVoiceHint('Microphone permission denied. Enable it in Settings or use your keyboard mic.');
        return;
      }

      for (const s of speechSubsRef.current) s.remove();
      speechSubsRef.current = [];
      const baseText = input.trim();

      if (speechMod.addListener) {
        speechSubsRef.current.push(
          speechMod.addListener('result', (ev) => {
            const transcript = ev.results?.[0]?.transcript?.trim() ?? '';
            if (transcript) {
              setInput(baseText ? `${baseText} ${transcript}` : transcript);
            }
          }),
          speechMod.addListener('error', () => {
            setIsListening(false);
            setVoiceHint('Speech recognition ended. You can also use your keyboard mic.');
          }),
          speechMod.addListener('end', () => {
            setIsListening(false);
          })
        );
      }

      speechModuleRef.current = speechMod;
      setIsListening(true);
      speechMod.start({ lang: 'en-US', interimResults: true, continuous: false });
    } catch {
      setIsListening(false);
      inputRef.current?.focus();
      setVoiceHint('Native STT unavailable on this device build; use your keyboard mic.');
    }
  };

  const handleNewChat = async () => {
    if (running) return;
    const now = Date.now();
    const conv: Conversation = {
      id: `conv_${now}`,
      title: 'New Chat',
      agentId: agent.id,
      modelId: model.id,
      effort,
      chatMode,
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
    followLatest.current = true;

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
    const ctrl = new AbortController();
    setAbortCtrl(ctrl);
    setRunning(true);

    let latestMessages = nextMessages;
    let keys: ProviderKeys = {};
    try {
      keys = await loadProviderKeys();
      const available = getAvailableModels(keys, cloudModels);
      const modelId = selectedModelId === 'cloud-auto' || (chatMode === 'coding' && !selectedModelId)
        ? 'cloud-auto' : available.some((candidate) => candidate.id === model.id) ? model.id
          : selectedModelId && chatMode === 'coding' ? selectedModelId
            : available.some((candidate) => candidate.routes?.length) ? 'cloud-auto' : 'demo-sandbox';
      const res = await runAgentLoop({
        agent,
        modelId,
        chatMode,
        dynamicModels: cloudModels,
        fetchFn: expoFetch as unknown as typeof fetch,
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
          onReasoningDelta: (reasoning) => {
            latestMessages = latestMessages.map((m) => m.id === assistantId ? { ...m, reasoning } : m);
            setMessages(latestMessages);
          },
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
        m.id === assistantId ? { ...m, content: res.finalText, reasoning: res.finalReasoning, modelId: res.usedModelId, isStreaming: false } : m
      );
      setMessages(finalized);
      await persistConvSnapshot(finalized, trimmed);
      void scheduleRunCompleteNotification(res.finalText);
    } catch (error) {
      const message = safeErrorMessage(error, Object.values(keys).filter((key): key is string => Boolean(key)));
      const finalized = latestMessages.map((m) =>
        m.id === assistantId ? { ...m, error: message, isStreaming: false } : m
      );
      setMessages(finalized);
      await persistConvSnapshot(finalized, trimmed);
    } finally {
      setRunning(false);
      setAbortCtrl(null);
    }
  };

  const pickerModels = getAvailableModels(catalogKeys.current, cloudModels);
  const unavailableModels = getUnavailableCatalogModels(pickerModels, cloudModels);
  const theme = useWorkspaceTheme(Boolean(settings.oledDark));
  const isDark = theme.dark;

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={{ flex: 1, backgroundColor: theme.background }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, gap: 8,
        borderBottomWidth: 1, borderBottomColor: theme.border, backgroundColor: theme.panel }}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Agent ${agent.name}, switch agent`}
          onPress={() => void handleCycleAgent()} style={{ minHeight: 46, flex: 1, minWidth: 0, flexDirection: 'row',
            alignItems: 'center', gap: 7, paddingHorizontal: 10, borderRadius: 10, backgroundColor: theme.mutedPanel }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.muted, fontSize: 11 }}>Chat agent</Text>
            <Text numberOfLines={1} style={{ color: theme.text, fontWeight: '700' }}>{agent.name}</Text>
          </View>
          <ChevronDown color={theme.muted} size={15} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`Reasoning effort: ${effort}, tap to cycle`} onPress={() => {
          const next: Record<EffortLevel, EffortLevel> = { low: 'medium', medium: 'high', high: 'low' };
          setEffort((value) => next[value]);
        }} style={{ minHeight: 46, justifyContent: 'center', paddingHorizontal: 10, borderRadius: 10,
          backgroundColor: theme.mutedPanel }}>
          <Text style={{ color: theme.text, fontWeight: '600', textTransform: 'capitalize' }}>{effort}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Coding mode"
          accessibilityState={{ selected: chatMode === 'coding', disabled: running }}
          disabled={running}
          onPress={() => {
            const next = chatMode === 'coding' ? (agent.defaultChatMode === 'coding' ? 'professional' : agent.defaultChatMode ?? 'professional') : 'coding';
            const nextModelId = next === 'coding' ? 'cloud-auto' : agent.defaultModelId;
            setChatMode(next);
            setSelectedModelId(nextModelId);
            void persistConvSnapshot(messages, undefined, next, nextModelId);
          }}
          style={{ minHeight: 46, justifyContent: 'center', paddingHorizontal: 10, borderRadius: 10,
            backgroundColor: chatMode === 'coding' ? theme.accentSurface : theme.mutedPanel }}>
          <Text style={{ color: chatMode === 'coding' ? theme.onAccentSurface : theme.text, fontWeight: '600' }}>Code</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="New chat" onPress={() => void handleNewChat()}
          style={{ minHeight: 46, minWidth: 46, alignItems: 'center', justifyContent: 'center',
            borderRadius: 10, backgroundColor: theme.accentSurface }}>
          <Plus color={theme.onAccentSurface} size={20} />
        </Pressable>
      </View>

      <Pressable accessibilityRole="button" accessibilityLabel="Choose model" disabled={running}
        onPress={() => setModelPickerOpen(true)}
        style={{ minHeight: 40, paddingHorizontal: 14, backgroundColor: theme.panel, borderBottomWidth: 1,
          borderBottomColor: theme.border, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text numberOfLines={1} style={{ color: theme.muted, flex: 1 }}>
          {model.routes?.length || model.provider === 'demo' || model.provider === 'local' ? model.label : 'Automatic free model'}
        </Text>
        <ChevronDown color={theme.muted} size={16} />
      </Pressable>
      <Modal visible={modelPickerOpen} animationType="slide" onRequestClose={() => setModelPickerOpen(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 }}>
            <Text style={{ color: theme.text, fontSize: 18, fontWeight: '700' }}>Choose model</Text>
            <Pressable accessibilityRole="button" onPress={() => setModelPickerOpen(false)} style={{ padding: 12 }}>
              <Text style={{ color: theme.text }}>Close</Text>
            </Pressable>
          </View>
          <FlatList
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 20, gap: 8 }}
            data={[
              ...(pickerModels.some((entry) => entry.routes?.length) ? [getModelById('cloud-auto')] : []),
              ...pickerModels,
            ]}
            ListFooterComponent={unavailableModels.length ? (
              <View style={{ paddingVertical: 12, gap: 6 }}>
                <Pressable accessibilityRole="button" accessibilityState={{ expanded: showUnavailableModels }}
                  onPress={() => setShowUnavailableModels((value) => !value)}
                  style={{ minHeight: 44, justifyContent: 'center' }}>
                  <Text style={{ color: theme.text, fontWeight: '600' }}>Unavailable models ({unavailableModels.length})</Text>
                </Pressable>
                {showUnavailableModels && (
                  <>
                    <Text style={{ color: theme.muted }}>These models have no verified free route with your current settings.</Text>
                    {unavailableModels.map((entry) => (
                      <Text key={entry.id} style={{ color: theme.muted }}>{entry.label}</Text>
                    ))}
                  </>
                )}
              </View>
            ) : null}
            keyExtractor={(entry) => entry.id}
            renderItem={({ item }) => (
              <Pressable accessibilityRole="button" accessibilityState={{ selected: item.id === model.id }}
                onPress={() => {
                  setSelectedModelId(item.id);
                  setModelPickerOpen(false);
                  void persistConvSnapshot(messages, undefined, chatMode, item.id);
                }}
                style={{ padding: 12, borderRadius: 12, backgroundColor: theme.panel }}>
                <Text style={{ color: theme.text, fontWeight: '600' }}>{item.label}</Text>
                {item.routes?.length ? (
                  <Text style={{ color: theme.muted }}>{item.routes.map((route) => PROVIDER_INFO[route.provider].name).join(' · ')}</Text>
                ) : null}
                {item.routes?.some((route) => route.dataTerms) ? (
                  <Text style={{ color: theme.muted }}>A free route may retain prompts for training.</Text>
                ) : null}
              </Pressable>
            )}
          />
        </SafeAreaView>
      </Modal>

      <FlatList
        ref={threadRef}
        data={messages}
        keyboardShouldPersistTaps="handled"
        onScroll={({ nativeEvent: { contentSize, layoutMeasurement, contentOffset } }) => {
          followLatest.current = contentSize.height - layoutMeasurement.height - contentOffset.y < 64;
        }}
        scrollEventThrottle={32}
        onContentSizeChange={() => {
          if (followLatest.current && messages.length) threadRef.current?.scrollToEnd({ animated: false });
        }}
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ flexGrow: 1, padding: 18, gap: 12 }}
        ListEmptyComponent={
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 24 }}>
            <View style={{ backgroundColor: theme.accentSurface, padding: 12, borderRadius: 14 }}>
              <MessageSquare color={theme.onAccentSurface} size={22} />
            </View>
            <Text style={{ color: theme.text, fontSize: 19, fontWeight: '700' }}>Start a conversation</Text>
            <Text style={{ color: theme.muted, textAlign: 'center' }}>Send a message to {agent.name}.</Text>
          </View>
        }
        renderItem={({ item }) => {
          if (item.role === 'user') {
            return <Text selectable style={{ alignSelf: 'flex-end', maxWidth: '90%', backgroundColor: workspaceBlue,
              color: '#FFFFFF', padding: 12, borderRadius: 14, fontSize: 15, lineHeight: 22 }}>{item.content}</Text>;
          }
          return (
            <View style={{ backgroundColor: theme.panel, padding: 13, borderWidth: 1, borderColor: theme.border,
              borderRadius: 15, gap: 10 }}>
              <Text style={{ color: theme.muted, fontWeight: '600', fontSize: 12 }}>
                {item.role === 'assistant' ? 'Assistant' : 'Workspace'}
              </Text>
              {item.toolCalls && item.toolCalls.length > 0 && (
                <Text style={{ fontSize: 12, lineHeight: 17, color: theme.muted }}>
                  {item.toolCalls.map((tool) => `${tool.toolName} (${tool.status})`).join(' · ')}
                </Text>
              )}
              {!!item.reasoning && (
                <View>
                  <Pressable accessibilityRole="button" accessibilityState={{ expanded: showReasoning === item.id }}
                    onPress={() => setShowReasoning(showReasoning === item.id ? null : item.id)}>
                    <Text style={{ color: theme.muted, paddingVertical: 8 }}>Reasoning details</Text>
                  </Pressable>
                  {showReasoning === item.id && <ChatReply content={item.reasoning} theme={theme} />}
                </View>
              )}
              {item.content && <ChatReply content={item.content} theme={theme} />}
              {item.error && <Text style={{ color: isDark ? '#fca5a5' : '#991b1b', lineHeight: 20 }}>{item.error}</Text>}
              {!item.content && !item.error && item.isStreaming && <Text style={{ color: theme.muted }}>Thinking…</Text>}
            </View>
          );
        }}
      />

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ backgroundColor: theme.panel, borderTopWidth: 1, borderTopColor: theme.border }}>
        {voiceHint ? (
          <View style={{ paddingHorizontal: 14, paddingTop: 6 }}>
            <Text style={{ fontSize: 11, color: isDark ? '#93C5FD' : '#1D4ED8' }}>{voiceHint}</Text>
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', padding: 12, gap: 8 }}>
          <TextInput
            ref={inputRef}
            accessibilityLabel="Chat message"
            value={input}
            onChangeText={setInput}
            placeholder={isListening ? 'Listening...' : `Message ${agent.name}...`}
            placeholderTextColor={theme.muted}
            style={{
              flex: 1,
              minHeight: 44,
              paddingHorizontal: 14,
              borderRadius: 16,
              backgroundColor: theme.panel,
              color: theme.text,
              borderWidth: 1,
              borderColor: theme.border,
            }}
          />
          <Pressable
            onPress={() => void handleToggleVoice()}
            accessibilityRole="button"
            accessibilityLabel={isListening ? 'Stop microphone' : 'Start microphone'}
            style={{
              minWidth: 44,
              minHeight: 44,
              borderRadius: 16,
              backgroundColor: isListening ? '#DC2626' : theme.mutedPanel,
              justifyContent: 'center',
              alignItems: 'center',
              paddingHorizontal: 12,
            }}
          >
            {isListening ? <MicOff size={18} color="#ffffff" /> : <Mic size={18} color={theme.text} />}
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={running ? 'Stop generation' : 'Send message'}
            disabled={!running && !input.trim()}
            onPress={running ? () => abortCtrl?.abort() : () => void handleSend()}
            style={{
              minWidth: 44,
              minHeight: 44,
              borderRadius: 16,
              backgroundColor: running ? '#b91c1c' : input.trim() ? workspaceBlue : theme.mutedPanel,
              justifyContent: 'center',
              alignItems: 'center',
              paddingHorizontal: 14,
            }}
          >
            {running ? <Square size={17} color="#FFFFFF" fill="#FFFFFF" />
              : <ArrowUp size={21} color={input.trim() ? '#FFFFFF' : theme.muted} />}
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
              backgroundColor: theme.panel,
              borderRadius: 20,
              padding: 18,
              gap: 12,
              borderWidth: 1,
              borderColor: isDark ? '#334155' : '#E2E8F0',
            }}
          >
            <Text style={{ fontSize: 17, fontWeight: '700', color: theme.text }}>
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
              {JSON.stringify(pendingApproval?.arguments ?? {}, null, 2)}
            </Text>
            <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'flex-end' }}>
              <Pressable
                onPress={() => resolveApproval('deny')}
                style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 10, backgroundColor: '#DC2626' }}
              >
                <Text style={{ color: '#FFFFFF', fontWeight: '600' }}>Deny</Text>
              </Pressable>
              <Pressable
                onPress={() => resolveApproval('always_allow')}
                style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 10, backgroundColor: '#0F766E' }}
              >
                <Text style={{ color: '#FFFFFF', fontWeight: '600' }}>Always</Text>
              </Pressable>
              <Pressable
                onPress={() => resolveApproval('approve')}
                style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 10, backgroundColor: workspaceBlue }}
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
