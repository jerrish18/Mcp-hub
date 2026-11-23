import React, { useState } from 'react';
import { motion } from 'motion/react';
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  Code2,
  Cpu,
  Database,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  GitBranch,
  KeyRound,
  Layers,
  MessageSquare,
  MessageSquarePlus,
  Palette,
  PlaySquare,
  Presentation,
  Server,
  ShieldAlert,
  Terminal,
  Wrench,
} from 'lucide-react';
import { CONNECTOR_PRESETS } from '../../config/connectors';
import { getModelById } from '../../config/models';
import { buildAgentToolCatalog } from '../../services/llm/agentLoop';
import { useHubStore } from '../../store/useHubStore';
import type { McpServerConfig } from '../../types';
import { BottomSheet } from '../../ui/BottomSheet';
import { cardStaggerContainer, cardStaggerItem, M3_SPRING } from '../../utils/motion';
import { QuickConnectSheet } from '../servers/QuickConnectSheet';
import { AppApiKeySection } from '../settings/AppApiKeySection';

interface DashboardScreenProps {
  onNavigateTab: (tab: 'dashboard' | 'chat' | 'servers' | 'agents' | 'settings') => void;
}

function getServerIcon(srv: McpServerConfig) {
  if (srv.presetId === 'youtube') return PlaySquare;
  if (srv.presetId === 'github') return GitBranch;
  if (srv.presetId === 'canva') return Palette;
  if (srv.presetId === 'notion') return FileText;
  if (srv.presetId === 'linear') return Layers;
  if (srv.presetId === 'slack') return MessageSquare;
  if (srv.presetId === 'gdrive') return FolderOpen;
  if (srv.presetId === 'postgres') return Database;
  return Server;
}

export function DashboardScreen({ onNavigateTab }: DashboardScreenProps) {
  const {
    servers,
    agents,
    conversations,
    activeConversationId,
    providerKeys,
    dynamicModels,
    startNewConversation,
    selectConversation,
    sendMessage,
  } = useHubStore();

  const [quickPrompt, setQuickPrompt] = useState('');
  const [quickConnectPreset, setQuickConnectPreset] = useState<'youtube' | 'github' | 'canva' | null>(null);
  const [appApiSheetOpen, setAppApiSheetOpen] = useState(false);

  const activeAgent = agents[0];
  const connectedServers = servers.filter((s) => s.status === 'connected');
  const { tools: activeTools } = buildAgentToolCatalog(activeAgent, servers);
  const configuredProviderCount = [providerKeys.gemini, providerKeys.groq, providerKeys.openrouter].filter(
    (k) => Boolean(k?.trim())
  ).length;

  const recentConversations = conversations.slice(0, 4);

  const handleQuickLaunch = (e: React.FormEvent) => {
    e.preventDefault();
    const prompt = quickPrompt.trim();
    startNewConversation(activeAgent?.id);
    onNavigateTab('chat');
    if (prompt) {
      setQuickPrompt('');
      void sendMessage(prompt);
    }
  };

  const handleAskServer = (srv: McpServerConfig) => {
    const preset =
      srv.presetId === 'youtube' || srv.presetId === 'github' || srv.presetId === 'canva'
        ? CONNECTOR_PRESETS[srv.presetId]
        : null;
    startNewConversation(activeAgent?.id);
    onNavigateTab('chat');
    if (preset) {
      void sendMessage(preset.samplePrompt);
    }
  };

  const handleLaunchProStudio = (prompt: string) => {
    const architect = agents.find((a) => a.id === 'agent_pro_architect') ?? activeAgent;
    startNewConversation(architect?.id);
    onNavigateTab('chat');
    void sendMessage(prompt);
  };

  return (
    <div
      style={{ backgroundColor: 'var(--m3-surface)' }}
      className="h-full overflow-y-auto p-4 sm:p-6"
    >
      <motion.div
        variants={cardStaggerContainer}
        initial="initial"
        animate="animate"
        className="max-w-6xl mx-auto space-y-6 pb-8"
      >
        {/* Hero Workspace Action Header */}
        <motion.section
          variants={cardStaggerItem}
          style={{
            backgroundColor: 'var(--m3-surface-container)',
            borderColor: 'var(--m3-outline)',
          }}
          className="rounded-[28px] border p-5 sm:p-6 space-y-5"
        >
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="space-y-1">
              <h1 className="font-display text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white tracking-tight text-balance">
                MCP Hub Workspace
              </h1>
              <p className="text-sm text-slate-600 dark:text-slate-300">
                Direct HTTPS orchestration across your connected MCP servers and free-tier cloud models
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0 flex-wrap">
              <button
                type="button"
                onClick={() => setAppApiSheetOpen(true)}
                data-testid="dashboard-app-api-btn"
                aria-label="App API Keys & External Control"
                style={{
                  backgroundColor: 'var(--m3-surface-container-high)',
                  borderColor: 'var(--m3-outline)',
                }}
                className="min-h-[46px] px-4 rounded-full border text-sm font-semibold text-slate-900 dark:text-white inline-flex items-center justify-center gap-2 shrink-0 whitespace-nowrap transition-transform active:scale-[0.98]"
              >
                <Terminal className="w-4 h-4" />
                <span>App API</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  startNewConversation(activeAgent?.id);
                  onNavigateTab('chat');
                }}
                style={{
                  backgroundColor: 'var(--m3-primary)',
                  color: 'var(--m3-on-primary)',
                }}
                className="min-h-[46px] px-5 rounded-full text-sm font-semibold inline-flex items-center justify-center gap-2 shrink-0 whitespace-nowrap transition-transform active:scale-[0.98]"
              >
                <MessageSquarePlus className="w-4 h-4" />
                <span>New Chat</span>
              </button>
            </div>
          </div>

          <form onSubmit={handleQuickLaunch} className="flex flex-col sm:flex-row gap-2.5">
            <input
              type="text"
              value={quickPrompt}
              onChange={(e) => setQuickPrompt(e.target.value)}
              placeholder="Ask an agent to search YouTube, check GitHub issues, or query notes..."
              aria-label="Quick launch prompt"
              style={{
                backgroundColor: 'var(--m3-surface)',
                borderColor: 'var(--m3-outline)',
              }}
              className="flex-1 min-h-[48px] px-4 rounded-2xl border text-sm text-slate-900 dark:text-white placeholder:text-slate-500 dark:placeholder:text-slate-400"
            />
            <button
              type="submit"
              style={{
                backgroundColor: 'var(--m3-primary-container)',
                color: 'var(--m3-on-primary-container)',
              }}
              className="min-h-[48px] px-5 rounded-2xl text-sm font-semibold inline-flex items-center justify-center gap-1.5 shrink-0 whitespace-nowrap transition-transform active:scale-[0.98]"
            >
              <span>Run in Chat</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>
        </motion.section>

        {/* 4-Column Real Data KPI Strip */}
        <motion.section variants={cardStaggerItem} className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <button
            type="button"
            onClick={() => onNavigateTab('servers')}
            style={{
              backgroundColor: 'var(--m3-surface-container)',
              borderColor: 'var(--m3-outline)',
            }}
            className="rounded-[24px] border p-4 text-left transition-transform hover:-translate-y-0.5 active:scale-[0.99]"
          >
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <span>Connected Servers</span>
              <Server className="w-4 h-4" />
            </div>
            <div className="mt-2 font-display text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
              {connectedServers.length} / {servers.length}
            </div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Live MCP endpoints
            </div>
          </button>

          <button
            type="button"
            onClick={() => onNavigateTab('servers')}
            style={{
              backgroundColor: 'var(--m3-surface-container)',
              borderColor: 'var(--m3-outline)',
            }}
            className="rounded-[24px] border p-4 text-left transition-transform hover:-translate-y-0.5 active:scale-[0.99]"
          >
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <span>Active MCP Tools</span>
              <Wrench className="w-4 h-4" />
            </div>
            <div className="mt-2 font-display text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
              {activeTools.length}
            </div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Ready for tool calls
            </div>
          </button>

          <button
            type="button"
            onClick={() => onNavigateTab('settings')}
            style={{
              backgroundColor: 'var(--m3-surface-container)',
              borderColor: 'var(--m3-outline)',
            }}
            className="rounded-[24px] border p-4 text-left transition-transform hover:-translate-y-0.5 active:scale-[0.99]"
          >
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <span>LLM API Keys</span>
              <KeyRound className="w-4 h-4" />
            </div>
            <div className="mt-2 font-display text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
              {configuredProviderCount} / 3
            </div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {configuredProviderCount > 0 ? 'Cloud models active' : 'Using Simulator'}
            </div>
          </button>

          <button
            type="button"
            onClick={() => onNavigateTab('chat')}
            style={{
              backgroundColor: 'var(--m3-surface-container)',
              borderColor: 'var(--m3-outline)',
            }}
            className="rounded-[24px] border p-4 text-left transition-transform hover:-translate-y-0.5 active:scale-[0.99]"
          >
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <span>Saved Chats</span>
              <MessageSquare className="w-4 h-4" />
            </div>
            <div className="mt-2 font-display text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
              {conversations.length}
            </div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Local encrypted history
            </div>
          </button>
        </motion.section>

        {/* Pro Document & Coding Canvas Quick Studio */}
        <motion.section variants={cardStaggerItem} className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-lg font-bold text-slate-900 dark:text-white">
                Pro Document & Canvas Studio
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Create real PowerPoint decks, Excel workbooks, Word/PDF briefs & live HTML apps
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              {
                id: 'pptx',
                title: 'Presentation (.PPTX)',
                subtitle: 'Slides, KPI cards & speaker notes',
                Icon: Presentation,
                prompt: 'Build a 4-slide Q3 executive presentation deck (.pptx) with KPI metrics and rollout milestones.',
              },
              {
                id: 'xlsx',
                title: 'Excel Workbook (.XLSX)',
                subtitle: 'Multi-sheet models & budgets',
                Icon: FileSpreadsheet,
                prompt: 'Generate a multi-sheet Q3 financial Excel workbook (.xlsx) with P&L and department budgets.',
              },
              {
                id: 'pdf_docx',
                title: 'PDF & Word Report',
                subtitle: 'Executive briefs & tables',
                Icon: FileText,
                prompt: 'Write an Enterprise MCP Implementation Brief report as a downloadable PDF.',
              },
              {
                id: 'canvas',
                title: 'App IDE & GitHub Sync',
                subtitle: 'Multi-file HTML/JS/CSS & push',
                Icon: Code2,
                prompt: 'Build a multi-file web app Sprint Taskboard (index.html, styles.css, app.js) ready for Pro Canvas IDE and GitHub sync.',
              },
            ].map(({ id, title, subtitle, Icon, prompt }) => (
              <button
                key={id}
                type="button"
                data-testid={`dashboard-studio-${id}`}
                onClick={() => handleLaunchProStudio(prompt)}
                style={{
                  backgroundColor: 'var(--m3-surface-container)',
                  borderColor: 'var(--m3-outline)',
                }}
                className="rounded-[24px] border p-4 text-left space-y-2 transition-transform hover:-translate-y-0.5 active:scale-[0.99]"
              >
                <span
                  style={{
                    backgroundColor: 'var(--m3-primary-container)',
                    color: 'var(--m3-on-primary-container)',
                  }}
                  className="w-9 h-9 rounded-xl flex items-center justify-center"
                >
                  <Icon className="w-4 h-4" />
                </span>
                <div>
                  <div className="font-display text-sm font-semibold text-slate-900 dark:text-white truncate">
                    {title}
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                    {subtitle}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </motion.section>

        {/* Platform Connectors & MCP Integrations */}
        <motion.section variants={cardStaggerItem} className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-lg font-bold text-slate-900 dark:text-white">
                Platform Integrations
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                1-tap setup for YouTube, GitHub, Canva, and your custom MCP servers
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigateTab('servers')}
              style={{ color: 'var(--m3-primary)' }}
              className="min-h-[44px] px-3 text-xs font-semibold hover:underline whitespace-nowrap shrink-0"
            >
              Manage all
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {servers.map((srv) => {
              const Icon = getServerIcon(srv);
              const presetKey =
                srv.presetId === 'youtube' || srv.presetId === 'github' || srv.presetId === 'canva'
                  ? srv.presetId
                  : null;
              const presetMeta = presetKey ? CONNECTOR_PRESETS[presetKey] : null;
              const isConnected = srv.status === 'connected';
              const enabledTools = srv.tools.length - srv.disabledTools.length;

              return (
                <motion.div
                  key={srv.id}
                  layout
                  transition={M3_SPRING}
                  data-testid={`dashboard-connector-${srv.id}`}
                  style={{
                    backgroundColor: 'var(--m3-surface-container)',
                    borderColor: 'var(--m3-outline)',
                  }}
                  className="rounded-[24px] border p-4 flex flex-col justify-between gap-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <span
                        style={
                          isConnected
                            ? {
                                backgroundColor: 'var(--m3-primary-container)',
                                color: 'var(--m3-on-primary-container)',
                              }
                            : undefined
                        }
                        className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 ${
                          isConnected
                            ? ''
                            : 'bg-slate-200/70 dark:bg-slate-800 text-slate-700 dark:text-slate-200'
                        }`}
                      >
                        <Icon className="w-5 h-5" />
                      </span>
                      <div className="min-w-0">
                        <h3 className="font-display text-base font-semibold text-slate-900 dark:text-white truncate">
                          {srv.name}
                        </h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 mt-0.5">
                          {presetMeta ? presetMeta.tagline : srv.url}
                        </p>
                      </div>
                    </div>

                    <div className="shrink-0">
                      {isConnected ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Connected
                        </span>
                      ) : srv.status === 'error' || srv.status === 'auth_expired' ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-rose-700 dark:text-rose-400 whitespace-nowrap">
                          <ShieldAlert className="w-3.5 h-3.5" />
                          Needs auth
                        </span>
                      ) : (
                        <span className="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                          Setup required
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-3 pt-2 border-t border-slate-200/60 dark:border-slate-800">
                    <div className="text-xs text-slate-500 dark:text-slate-400 tabular-nums truncate">
                      {srv.tools.length > 0
                        ? `${enabledTools}/${srv.tools.length} tools`
                        : 'Tools discovered on connect'}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {isConnected ? (
                        <button
                          type="button"
                          onClick={() => handleAskServer(srv)}
                          aria-label={`Ask ${srv.name}`}
                          style={{
                            backgroundColor: 'var(--m3-primary-container)',
                            color: 'var(--m3-on-primary-container)',
                          }}
                          className="min-h-[44px] px-4 rounded-full text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap"
                        >
                          <MessageSquare className="w-3.5 h-3.5" />
                          <span>Ask</span>
                        </button>
                      ) : presetKey ? (
                        <button
                          type="button"
                          onClick={() => setQuickConnectPreset(presetKey)}
                          aria-label={`Connect ${srv.name}`}
                          style={{
                            backgroundColor: 'var(--m3-primary)',
                            color: 'var(--m3-on-primary)',
                          }}
                          className="min-h-[44px] px-4 rounded-full text-xs font-semibold whitespace-nowrap"
                        >
                          Connect
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onNavigateTab('servers')}
                          aria-label={`Configure ${srv.name}`}
                          style={{
                            backgroundColor: 'var(--m3-surface-container-high)',
                            borderColor: 'var(--m3-outline)',
                          }}
                          className="min-h-[44px] px-4 rounded-full border text-xs font-semibold whitespace-nowrap"
                        >
                          Configure
                        </button>
                      )}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </motion.section>

        {/* Two-column Lower Grid: Recent Chats + Agents */}
        <motion.section variants={cardStaggerItem} className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Recent Conversations */}
          <div
            style={{
              backgroundColor: 'var(--m3-surface-container)',
              borderColor: 'var(--m3-outline)',
            }}
            className="rounded-[24px] border p-5 space-y-3"
          >
            <div className="flex items-center justify-between">
              <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
                Recent Conversations
              </h2>
              <button
                type="button"
                onClick={() => onNavigateTab('chat')}
                style={{ color: 'var(--m3-primary)' }}
                className="text-xs font-semibold hover:underline"
              >
                Open Chat
              </button>
            </div>

            {recentConversations.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400 py-4">
                No conversations yet. Start one above!
              </p>
            ) : (
              <div className="divide-y divide-slate-200/60 dark:divide-slate-800">
                {recentConversations.map((conv) => {
                  const model = getModelById(conv.modelId, dynamicModels);
                  const isCurrent = conv.id === activeConversationId;
                  return (
                    <button
                      key={conv.id}
                      type="button"
                      onClick={() => {
                        selectConversation(conv.id);
                        onNavigateTab('chat');
                      }}
                      className="w-full min-h-[54px] py-2.5 flex items-center justify-between gap-3 text-left hover:opacity-80 transition-opacity"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-slate-900 dark:text-white truncate">
                          {conv.title}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5 tabular-nums">
                          {model.label} · {conv.messages.length} msgs
                          {isCurrent ? ' · Active' : ''}
                        </div>
                      </div>
                      <ArrowRight className="w-4 h-4 text-slate-400 shrink-0" />
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Agent Profiles Quick Launch */}
          <div
            style={{
              backgroundColor: 'var(--m3-surface-container)',
              borderColor: 'var(--m3-outline)',
            }}
            className="rounded-[24px] border p-5 space-y-3"
          >
            <div className="flex items-center justify-between">
              <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
                Quick-Start Agents
              </h2>
              <button
                type="button"
                onClick={() => onNavigateTab('agents')}
                style={{ color: 'var(--m3-primary)' }}
                className="text-xs font-semibold hover:underline"
              >
                All Agents
              </button>
            </div>

            <div className="divide-y divide-slate-200/60 dark:divide-slate-800">
              {agents.slice(0, 4).map((agent) => {
                const model = getModelById(agent.defaultModelId, dynamicModels);
                return (
                  <button
                    key={agent.id}
                    type="button"
                    onClick={() => {
                      startNewConversation(agent.id);
                      onNavigateTab('chat');
                    }}
                    className="w-full min-h-[54px] py-2.5 flex items-center justify-between gap-3 text-left hover:opacity-80 transition-opacity"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span
                        style={{
                          backgroundColor: 'var(--m3-primary-container)',
                          color: 'var(--m3-on-primary-container)',
                        }}
                        className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                      >
                        <Bot className="w-4 h-4" />
                      </span>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                          {agent.name}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 truncate flex items-center gap-1.5">
                          <Cpu className="w-3 h-3 shrink-0" />
                          <span className="truncate">{model.label}</span>
                          <span aria-hidden="true">·</span>
                          <span className="capitalize">{agent.defaultEffort}</span>
                        </div>
                      </div>
                    </div>
                    <ArrowRight className="w-4 h-4 text-slate-400 shrink-0" />
                  </button>
                );
              })}
            </div>
          </div>
        </motion.section>
      </motion.div>

      <QuickConnectSheet
        presetId={quickConnectPreset}
        server={
          quickConnectPreset
            ? servers.find(
                (s) =>
                  s.presetId === quickConnectPreset ||
                  s.id === CONNECTOR_PRESETS[quickConnectPreset].serverId
              )
            : undefined
        }
        onClose={() => setQuickConnectPreset(null)}
      />

      <BottomSheet
        open={appApiSheetOpen}
        onClose={() => setAppApiSheetOpen(false)}
        title="App API & External Control"
        subtitle="Generate API keys to control MCP Hub from external agents"
      >
        <AppApiKeySection compact />
      </BottomSheet>
    </div>
  );
}
