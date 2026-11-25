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
import { summarizeWorkspaceUsage } from '../../utils/workspaceInsights';
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

  const usage = summarizeWorkspaceUsage(conversations);
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
      className="workspace-scroll"
    >
      <motion.div
        variants={cardStaggerContainer}
        initial="initial"
        animate="animate"
        className="workspace-content dashboard-content"
      >
        <motion.section variants={cardStaggerItem} className="dashboard-hero">
          <div className="dashboard-hero-pattern" aria-hidden="true" />
          <div className="dashboard-hero-content">
            <div className="dashboard-hero-heading">
              <div>
                <h1>Your AI workspace</h1>
                <p>Work with AI agents, connect MCP tools, and build in Canvas.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => setAppApiSheetOpen(true)}
                  data-testid="dashboard-app-api-btn" aria-label="App API Keys & External Control" className="dashboard-hero-secondary">
                  <Terminal aria-hidden="true" className="size-4" />
                  App API
                </button>
                <button type="button" onClick={() => {
                  startNewConversation(activeAgent?.id);
                  onNavigateTab('chat');
                }} className="dashboard-hero-primary">
                  <MessageSquarePlus aria-hidden="true" className="size-4" />
                  New Chat
                </button>
              </div>
            </div>
            <form onSubmit={handleQuickLaunch} className="dashboard-quick-launch">
              <input type="text" value={quickPrompt} onChange={(event) => setQuickPrompt(event.target.value)}
                placeholder="Ask an agent to research, analyze, or build something"
                aria-label="Quick launch prompt" />
              <button type="submit" aria-label="Run in Chat" className="dashboard-hero-primary">
                <span className="hidden sm:inline">Run in Chat</span>
                <ArrowRight aria-hidden="true" className="size-4" />
              </button>
            </form>
          </div>
        </motion.section>

        {/* 4-Column Real Data KPI Strip */}
        <motion.section variants={cardStaggerItem} className="dashboard-card-grid">
          <button
            type="button"
            onClick={() => onNavigateTab('servers')}
            style={{
              backgroundColor: 'var(--m3-surface-container)',
              borderColor: 'var(--m3-outline)',
            }}
            className="workspace-card dashboard-stat rounded-2xl border p-4 text-left"
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
            className="workspace-card dashboard-stat rounded-2xl border p-4 text-left"
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
            className="workspace-card dashboard-stat rounded-2xl border p-4 text-left"
          >
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <span>LLM API Keys</span>
              <KeyRound className="w-4 h-4" />
            </div>
            <div className="mt-2 font-display text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
              {configuredProviderCount} / 3
            </div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {configuredProviderCount > 0 ? 'Cloud models active' : 'Set up providers in Settings'}
            </div>
          </button>

          <button
            type="button"
            onClick={() => onNavigateTab('chat')}
            style={{
              backgroundColor: 'var(--m3-surface-container)',
              borderColor: 'var(--m3-outline)',
            }}
            className="workspace-card dashboard-stat rounded-2xl border p-4 text-left"
          >
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <span>Saved Chats</span>
              <MessageSquare className="w-4 h-4" />
            </div>
            <div className="mt-2 font-display text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
              {conversations.length}
            </div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Conversation history
            </div>
          </button>
        </motion.section>

        {/* Pro Document & Coding Canvas Quick Studio */}
        <motion.section variants={cardStaggerItem} className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-lg font-bold text-slate-900 dark:text-white">
                Create in Canvas
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Start with a document, workbook, presentation, or website.
              </p>
            </div>
          </div>
          <div className="dashboard-card-grid">
            {[
              {
                id: 'pptx',
                title: 'Presentation',
                subtitle: 'Slides, KPI cards & speaker notes',
                Icon: Presentation,
                prompt: 'Build a 4-slide Q3 executive presentation deck (.pptx) with KPI metrics and rollout milestones.',
              },
              {
                id: 'xlsx',
                title: 'Excel workbook',
                subtitle: 'Multi-sheet models & budgets',
                Icon: FileSpreadsheet,
                prompt: 'Generate a multi-sheet Q3 financial Excel workbook (.xlsx) with P&L and department budgets.',
              },
              {
                id: 'pdf_docx',
                title: 'PDF or Word report',
                subtitle: 'Executive briefs & tables',
                Icon: FileText,
                prompt: 'Write an Enterprise MCP Implementation Brief report as a downloadable PDF.',
              },
              {
                id: 'canvas',
                title: 'Website project',
                subtitle: 'Live preview, source & GitHub sync',
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
                className="workspace-card dashboard-studio-card rounded-2xl border p-4 text-left space-y-2"
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
        <motion.section variants={cardStaggerItem} className="workspace-card border p-5 space-y-3">
          <h2 className="font-semibold">Model usage</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">Estimated prompt tokens and recorded response times.</p>
          {!usage.length ? <p className="text-sm">Complete a chat to see your usage.</p> : <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr><th>Model</th><th>Runs</th><th>Est. tokens</th><th>Avg. latency</th><th>Errors</th></tr></thead><tbody>{usage.map(row => <tr key={row.modelId}><td className="py-2 pr-2">{getModelById(row.modelId, dynamicModels)?.label ?? row.modelId}</td><td>{row.runs}</td><td>{row.promptTokens.toLocaleString()}</td><td>{(row.averageMs / 1000).toFixed(2)}s</td><td>{row.errors}</td></tr>)}</tbody></table></div>}
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
