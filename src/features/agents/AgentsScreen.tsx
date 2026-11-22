import React, { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  BookOpen,
  Bot,
  Briefcase,
  ChevronDown,
  ChevronRight,
  Compass,
  Copy,
  MessageCircle,
  MessageSquare,
  Pencil,
  Plus,
  Search,
  Terminal,
  Trash2,
  Wrench,
} from 'lucide-react';
import { mergeModelCatalog } from '../../services/llm/provider';
import { STUDY_INSTRUCTION_PRESETS } from '../../store/defaults';
import { useHubStore } from '../../store/useHubStore';
import {
  type AgentProfile,
  AgentProfileSchema,
  type ChatMode,
  type EffortLevel,
} from '../../types';
import { BottomSheet } from '../../ui/BottomSheet';
import { M3Switch } from '../../ui/M3Switch';
import { triggerHaptic } from '../../utils/haptics';
import { cardStaggerContainer, cardStaggerItem } from '../../utils/motion';

const AGENT_ICONS: Record<string, typeof Bot> = {
  bot: Bot,
  compass: Compass,
  terminal: Terminal,
  'book-open': BookOpen,
};

const MODE_LABELS: Record<ChatMode, { label: string; Icon: typeof Briefcase }> = {
  general: { label: 'General', Icon: MessageCircle },
  professional: { label: 'MCP Pro', Icon: Briefcase },
  study: { label: 'Study', Icon: BookOpen },
};

interface AgentsScreenProps {
  onOpenChat: () => void;
}

export function AgentsScreen({ onOpenChat }: AgentsScreenProps) {
  const {
    agents,
    servers,
    dynamicModels,
    settings,
    saveAgent,
    duplicateAgent,
    deleteAgent,
    startNewConversation,
  } = useHubStore();

  const allModels = mergeModelCatalog(dynamicModels);

  const [searchQuery, setSearchQuery] = useState('');
  const [modeFilter, setModeFilter] = useState<'all' | ChatMode>('all');

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [icon, setIcon] = useState('bot');
  const [description, setDescription] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [defaultModelId, setDefaultModelId] = useState(allModels[0]?.id ?? 'gemini-4-hydrogen');
  const [defaultEffort, setDefaultEffort] = useState<EffortLevel>('medium');
  const [defaultChatMode, setDefaultChatMode] = useState<ChatMode>('professional');
  const [studyInstructions, setStudyInstructions] = useState('');
  const [allServersAllowed, setAllServersAllowed] = useState(true);
  const [selectedServerIds, setSelectedServerIds] = useState<string[]>([]);
  const [allToolsAllowed, setAllToolsAllowed] = useState(true);
  const [selectedToolNames, setSelectedToolNames] = useState<string[]>([]);
  const [expandedServerId, setExpandedServerId] = useState<string | null>(null);
  const [formError, setFormError] = useState('');

  const filteredAgents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return agents.filter((a) => {
      const mode = a.defaultChatMode ?? 'professional';
      if (modeFilter !== 'all' && mode !== modeFilter) return false;
      if (!q) return true;
      return (
        a.name.toLowerCase().includes(q) ||
        a.description.toLowerCase().includes(q) ||
        a.systemPrompt.toLowerCase().includes(q)
      );
    });
  }, [agents, searchQuery, modeFilter]);

  const openCreate = () => {
    setEditingId(null);
    setName('');
    setIcon('bot');
    setDescription('');
    setSystemPrompt('You are a helpful AI assistant inside MCP Hub.');
    setDefaultModelId(allModels[0]?.id ?? 'gemini-4-hydrogen');
    setDefaultEffort('medium');
    setDefaultChatMode('professional');
    setStudyInstructions('');
    setAllServersAllowed(true);
    setSelectedServerIds(servers.map((s) => s.id));
    setAllToolsAllowed(true);
    setSelectedToolNames([]);
    setExpandedServerId(null);
    setFormError('');
    setEditorOpen(true);
  };

  const openEdit = (agent: AgentProfile) => {
    setEditingId(agent.id);
    setName(agent.name);
    setIcon(agent.icon);
    setDescription(agent.description);
    setSystemPrompt(agent.systemPrompt);
    setDefaultModelId(agent.defaultModelId);
    setDefaultEffort(agent.defaultEffort);
    setDefaultChatMode(agent.defaultChatMode ?? 'professional');
    setStudyInstructions(agent.studyInstructions ?? '');
    setAllServersAllowed(agent.allowedServerIds === null);
    setSelectedServerIds(agent.allowedServerIds ?? servers.map((s) => s.id));
    setAllToolsAllowed(agent.allowedToolNames === null);
    setSelectedToolNames(agent.allowedToolNames ?? []);
    setExpandedServerId(null);
    setFormError('');
    setEditorOpen(true);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    const existing = editingId ? agents.find((a) => a.id === editingId) : undefined;
    const now = Date.now();
    const candidate: AgentProfile = {
      id: existing?.id ?? `agent_${now}`,
      name: name.trim(),
      icon,
      description: description.trim(),
      systemPrompt: systemPrompt.trim(),
      defaultModelId,
      defaultEffort,
      defaultChatMode,
      studyInstructions: studyInstructions.trim(),
      allowedServerIds: allServersAllowed ? null : selectedServerIds,
      allowedToolNames: allToolsAllowed ? null : selectedToolNames,
      isBuiltIn: existing?.isBuiltIn ?? false,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    const parsed = AgentProfileSchema.safeParse(candidate);
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? 'Invalid agent profile.');
      return;
    }

    saveAgent(parsed.data);
    triggerHaptic(settings.hapticsEnabled, 'success');
    setEditorOpen(false);
  };

  const toggleToolName = (toolName: string) => {
    setSelectedToolNames((prev) =>
      prev.includes(toolName) ? prev.filter((t) => t !== toolName) : [...prev, toolName]
    );
  };

  return (
    <div
      style={{ backgroundColor: 'var(--m3-surface)' }}
      className="h-full overflow-y-auto p-4 sm:p-6"
    >
      <div className="max-w-4xl mx-auto space-y-5 pb-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
              Agents
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Tailored personas with default chat modes, study templates & granular MCP tool scopes
            </p>
          </div>
          <button
            type="button"
            onClick={openCreate}
            style={{
              backgroundColor: 'var(--m3-primary)',
              color: 'var(--m3-on-primary)',
            }}
            className="min-h-[44px] px-4 py-2 rounded-full text-sm font-semibold inline-flex items-center justify-center gap-1.5 shrink-0 transition-opacity hover:opacity-90"
          >
            <Plus className="w-4 h-4" />
            <span>New Agent</span>
          </button>
        </div>

        {/* Search + Chat Mode Filter Bar */}
        <div className="flex flex-col sm:flex-row gap-2.5 sm:items-center justify-between">
          <div className="relative flex-1 max-w-sm">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search agents..."
              aria-label="Search agents"
              style={{
                backgroundColor: 'var(--m3-surface-container)',
                borderColor: 'var(--m3-outline)',
              }}
              className="w-full min-h-[42px] pl-10 pr-3.5 rounded-full border text-sm text-slate-900 dark:text-white placeholder:text-slate-400"
            />
          </div>

          <div
            role="group"
            aria-label="Filter agents by mode"
            className="flex items-center gap-1.5 overflow-x-auto no-scrollbar"
          >
            {(
              [
                { id: 'all', label: `All (${agents.length})` },
                { id: 'professional', label: 'MCP Pro' },
                { id: 'study', label: 'Study' },
                { id: 'general', label: 'General' },
              ] as const
            ).map(({ id, label }) => {
              const active = modeFilter === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setModeFilter(id)}
                  style={
                    active
                      ? {
                          backgroundColor: 'var(--m3-primary-container)',
                          color: 'var(--m3-on-primary-container)',
                          borderColor: 'var(--m3-primary)',
                        }
                      : {
                          backgroundColor: 'var(--m3-surface-container)',
                          borderColor: 'var(--m3-outline)',
                        }
                  }
                  className="min-h-[38px] px-3.5 rounded-full border text-xs font-semibold whitespace-nowrap transition-colors"
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {filteredAgents.length === 0 ? (
          <div
            style={{
              backgroundColor: 'var(--m3-surface-container)',
              borderColor: 'var(--m3-outline)',
            }}
            className="rounded-[24px] border p-8 text-center text-sm text-slate-500 dark:text-slate-400"
          >
            No agents match your search or filter.
          </div>
        ) : (
          <motion.div
            variants={cardStaggerContainer}
            initial="initial"
            animate="animate"
            className="grid grid-cols-1 md:grid-cols-2 gap-3.5"
          >
            {filteredAgents.map((agent) => {
              const Icon = AGENT_ICONS[agent.icon] ?? Bot;
              const modelLabel =
                allModels.find((m) => m.id === agent.defaultModelId)?.label ?? agent.defaultModelId;
              const modeMeta = MODE_LABELS[agent.defaultChatMode ?? 'professional'];
              const ModeIcon = modeMeta.Icon;

              const scopeLabel =
                agent.defaultChatMode === 'study' || agent.defaultChatMode === 'general'
                  ? 'Direct mode (no MCP calls)'
                  : agent.allowedToolNames !== null
                    ? `${agent.allowedToolNames.length} selected tool(s)`
                    : agent.allowedServerIds === null
                      ? 'All connected servers & tools'
                      : `${agent.allowedServerIds.length} server(s)`;

              return (
                <motion.div
                  key={agent.id}
                  variants={cardStaggerItem}
                  data-testid="agent-card"
                  style={{
                    backgroundColor: 'var(--m3-surface-container)',
                    borderColor: 'var(--m3-outline)',
                  }}
                  className="rounded-[24px] border p-4 flex flex-col justify-between gap-4"
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-2.5">
                      <div className="flex items-center gap-3 min-w-0">
                        <span
                          style={{
                            backgroundColor: 'var(--m3-primary-container)',
                            color: 'var(--m3-on-primary-container)',
                          }}
                          className="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0"
                        >
                          <Icon className="w-5 h-5" />
                        </span>
                        <div className="min-w-0">
                          <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white truncate">
                            {agent.name}
                          </h2>
                          <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                            {agent.isBuiltIn ? 'Built-in' : 'Custom'}
                            <span aria-hidden="true"> · </span>
                            <span className="capitalize">{agent.defaultEffort} effort</span>
                          </div>
                        </div>
                      </div>

                      <span
                        style={{
                          backgroundColor: 'var(--m3-surface-container-high)',
                          borderColor: 'var(--m3-outline)',
                        }}
                        className="px-2.5 py-1 rounded-full border text-[11px] font-semibold text-slate-700 dark:text-slate-200 inline-flex items-center gap-1 shrink-0"
                      >
                        <ModeIcon className="w-3 h-3" />
                        <span>{modeMeta.label}</span>
                      </span>
                    </div>

                    <p className="text-sm text-slate-600 dark:text-slate-300 line-clamp-2">
                      {agent.description || agent.systemPrompt}
                    </p>

                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                      <span className="truncate max-w-[200px] font-medium text-slate-700 dark:text-slate-300">
                        {modelLabel}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="inline-flex items-center gap-1 truncate">
                        <Wrench className="w-3 h-3 shrink-0" />
                        {scopeLabel}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-2.5 border-t border-slate-200/60 dark:border-slate-800">
                    <button
                      type="button"
                      onClick={() => {
                        startNewConversation(agent.id);
                        onOpenChat();
                      }}
                      style={{
                        backgroundColor: 'var(--m3-primary-container)',
                        color: 'var(--m3-on-primary-container)',
                      }}
                      className="min-h-[42px] px-4 rounded-full text-xs font-semibold inline-flex items-center gap-1.5 transition-opacity hover:opacity-90"
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                      <span>Start Chat</span>
                    </button>

                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          duplicateAgent(agent.id);
                          triggerHaptic(settings.hapticsEnabled, 'light');
                        }}
                        aria-label={`Duplicate ${agent.name}`}
                        className="min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <Copy className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => openEdit(agent)}
                        aria-label={`Edit ${agent.name}`}
                        className="min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      {!agent.isBuiltIn && (
                        <button
                          type="button"
                          onClick={() => deleteAgent(agent.id)}
                          aria-label={`Delete ${agent.name}`}
                          className="min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </motion.div>
        )}
      </div>

      <BottomSheet
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        title={editingId ? 'Edit Agent' : 'Create Agent'}
        subtitle="Configure chat mode, system prompt, study structure, and per-tool permissions"
      >
        <form onSubmit={handleSave} className="space-y-4">
          {formError && (
            <div className="rounded-xl border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
              {formError}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <label htmlFor="ag-name" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Name
              </label>
              <input
                id="ag-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                placeholder="e.g. Exam Coach or Repo Operator"
                className="w-full min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm text-slate-900 dark:text-white"
              />
            </div>

            <div>
              <label htmlFor="ag-icon" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Icon
              </label>
              <select
                id="ag-icon"
                value={icon}
                onChange={(e) => setIcon(e.target.value)}
                className="w-full min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm text-slate-900 dark:text-white"
              >
                <option value="bot">Bot</option>
                <option value="compass">Compass</option>
                <option value="terminal">Terminal</option>
                <option value="book-open">Study / Research</option>
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="ag-desc" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Short Description
            </label>
            <input
              id="ag-desc"
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this agent specializes in"
              className="w-full min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm text-slate-900 dark:text-white"
            />
          </div>

          {/* Default Chat Mode */}
          <div>
            <span className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              Default Chat Mode
            </span>
            <div className="grid grid-cols-3 gap-1.5 p-1 rounded-full bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
              {(['general', 'professional', 'study'] as ChatMode[]).map((m) => {
                const active = defaultChatMode === m;
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setDefaultChatMode(m)}
                    style={
                      active
                        ? {
                            backgroundColor: 'var(--m3-primary-container)',
                            color: 'var(--m3-on-primary-container)',
                          }
                        : undefined
                    }
                    className={`min-h-[38px] rounded-full text-xs font-semibold transition-colors ${
                      active ? 'shadow-xs' : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    {m === 'professional' ? 'Professional (MCP)' : m === 'study' ? 'Study Session' : 'General'}
                  </button>
                );
              })}
            </div>
          </div>

          {defaultChatMode === 'study' && (
            <div className="space-y-2 rounded-2xl border border-slate-200 dark:border-slate-800 p-3">
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor="ag-study-instr"
                  className="text-xs font-semibold text-slate-800 dark:text-slate-200"
                >
                  Default Study Response Instructions
                </label>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {STUDY_INSTRUCTION_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setStudyInstructions(p.instructions)}
                    className="px-2.5 py-1 rounded-full border border-slate-200 dark:border-slate-700 text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <textarea
                id="ag-study-instr"
                rows={3}
                value={studyInstructions}
                onChange={(e) => setStudyInstructions(e.target.value)}
                placeholder="Structure rules this Study agent follows automatically..."
                className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs text-slate-900 dark:text-white"
              />
            </div>
          )}

          <div>
            <label htmlFor="ag-prompt" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              System Prompt
            </label>
            <textarea
              id="ag-prompt"
              rows={3}
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              required
              className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm text-slate-900 dark:text-white"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="ag-model" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Default Model
              </label>
              <select
                id="ag-model"
                value={defaultModelId}
                onChange={(e) => setDefaultModelId(e.target.value)}
                className="w-full min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm text-slate-900 dark:text-white"
              >
                {allModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="ag-effort" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Default Effort
              </label>
              <select
                id="ag-effort"
                value={defaultEffort}
                onChange={(e) => setDefaultEffort(e.target.value as EffortLevel)}
                className="w-full min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm text-slate-900 dark:text-white"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
          </div>

          {/* Granular MCP Server & Tool Permissions */}
          <div className="space-y-3 rounded-2xl border border-slate-200 dark:border-slate-800 p-3.5">
            <div className="flex items-center justify-between gap-2 text-sm font-medium text-slate-900 dark:text-white">
              <span>Allow all connected MCP servers</span>
              <M3Switch
                checked={allServersAllowed}
                ariaLabel="Allow all connected MCP servers"
                onChange={() => setAllServersAllowed((v) => !v)}
              />
            </div>

            <div className="flex items-center justify-between gap-2 text-sm font-medium text-slate-900 dark:text-white pt-2 border-t border-slate-100 dark:border-slate-800">
              <span>Allow all tools on allowed servers</span>
              <M3Switch
                checked={allToolsAllowed}
                ariaLabel="Allow all tools on allowed servers"
                onChange={() => setAllToolsAllowed((v) => !v)}
              />
            </div>

            {(!allServersAllowed || !allToolsAllowed) && (
              <div className="pt-2 space-y-2 border-t border-slate-100 dark:border-slate-800">
                {servers.map((srv) => {
                  const serverChecked = allServersAllowed || selectedServerIds.includes(srv.id);
                  const isExpanded = expandedServerId === srv.id;
                  return (
                    <div
                      key={srv.id}
                      className="rounded-xl border border-slate-200/70 dark:border-slate-800 p-2.5 space-y-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <label className="flex items-center gap-2 text-xs font-medium text-slate-800 dark:text-slate-200">
                          {!allServersAllowed && (
                            <input
                              type="checkbox"
                              checked={serverChecked}
                              onChange={(e) => {
                                setSelectedServerIds((prev) =>
                                  e.target.checked
                                    ? [...prev, srv.id]
                                    : prev.filter((id) => id !== srv.id)
                                );
                              }}
                              className="w-4 h-4 accent-blue-600"
                            />
                          )}
                          <span>{srv.name}</span>
                          <span className="text-[11px] text-slate-400">
                            ({srv.tools.length} tools)
                          </span>
                        </label>

                        {!allToolsAllowed && srv.tools.length > 0 && (
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedServerId((prev) => (prev === srv.id ? null : srv.id))
                            }
                            aria-expanded={isExpanded}
                            className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 inline-flex items-center gap-0.5"
                          >
                            {isExpanded ? (
                              <ChevronDown className="w-3.5 h-3.5" />
                            ) : (
                              <ChevronRight className="w-3.5 h-3.5" />
                            )}
                            <span>Tools</span>
                          </button>
                        )}
                      </div>

                      {!allToolsAllowed && isExpanded && srv.tools.length > 0 && (
                        <div className="pl-2 pt-1.5 border-t border-slate-100 dark:border-slate-800 space-y-1.5">
                          <div className="flex items-center gap-2 text-[11px]">
                            <button
                              type="button"
                              onClick={() => {
                                const names = srv.tools.map((t) => t.name);
                                setSelectedToolNames((prev) => Array.from(new Set([...prev, ...names])));
                              }}
                              className="text-blue-600 dark:text-blue-400 hover:underline"
                            >
                              Select all
                            </button>
                            <span className="text-slate-400">·</span>
                            <button
                              type="button"
                              onClick={() => {
                                const names = new Set(srv.tools.map((t) => t.name));
                                setSelectedToolNames((prev) => prev.filter((n) => !names.has(n)));
                              }}
                              className="text-slate-500 hover:underline"
                            >
                              Clear
                            </button>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                            {srv.tools.map((tool) => (
                              <label
                                key={tool.name}
                                className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300"
                              >
                                <input
                                  type="checkbox"
                                  checked={selectedToolNames.includes(tool.name)}
                                  onChange={() => toggleToolName(tool.name)}
                                  className="w-3.5 h-3.5 accent-blue-600"
                                />
                                <span className="font-mono text-[11px] truncate">{tool.name}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <button
            type="submit"
            style={{
              backgroundColor: 'var(--m3-primary)',
              color: 'var(--m3-on-primary)',
            }}
            className="w-full min-h-[48px] rounded-full text-sm font-semibold transition-opacity hover:opacity-90"
          >
            Save Agent
          </button>
        </form>
      </BottomSheet>
    </div>
  );
}
