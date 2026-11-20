import React, { useState } from 'react';
import {
  BookOpen,
  Bot,
  Compass,
  Copy,
  MessageSquare,
  Pencil,
  Plus,
  Terminal,
  Trash2,
} from 'lucide-react';
import { mergeModelCatalog } from '../../services/llm/provider';
import { useHubStore } from '../../store/useHubStore';
import { type AgentProfile, AgentProfileSchema, type EffortLevel } from '../../types';
import { BottomSheet } from '../../ui/BottomSheet';
import { M3Switch } from '../../ui/M3Switch';
import { triggerHaptic } from '../../utils/haptics';

const AGENT_ICONS: Record<string, typeof Bot> = {
  bot: Bot,
  compass: Compass,
  terminal: Terminal,
  'book-open': BookOpen,
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

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [icon, setIcon] = useState('bot');
  const [description, setDescription] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [defaultModelId, setDefaultModelId] = useState(allModels[0]?.id ?? 'gemini-4-hydrogen');
  const [defaultEffort, setDefaultEffort] = useState<EffortLevel>('medium');
  const [allServersAllowed, setAllServersAllowed] = useState(true);
  const [selectedServerIds, setSelectedServerIds] = useState<string[]>([]);
  const [formError, setFormError] = useState('');

  const openCreate = () => {
    setEditingId(null);
    setName('');
    setIcon('bot');
    setDescription('');
    setSystemPrompt('You are a helpful MCP agent.');
    setDefaultModelId(allModels[0]?.id ?? 'gemini-4-hydrogen');
    setDefaultEffort('medium');
    setAllServersAllowed(true);
    setSelectedServerIds(servers.map((s) => s.id));
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
    setAllServersAllowed(agent.allowedServerIds === null);
    setSelectedServerIds(agent.allowedServerIds ?? servers.map((s) => s.id));
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
      allowedServerIds: allServersAllowed ? null : selectedServerIds,
      allowedToolNames: existing?.allowedToolNames ?? null,
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

  return (
    <div
      style={{ backgroundColor: 'var(--m3-surface)' }}
      className="h-full overflow-y-auto p-4 sm:p-6"
    >
      <div className="max-w-4xl mx-auto space-y-5 pb-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
              Agents
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Saved system prompts, model defaults, MCP tool scopes, and effort presets
            </p>
          </div>
          <button
            type="button"
            onClick={openCreate}
            style={{
              backgroundColor: 'var(--m3-primary)',
              color: 'var(--m3-on-primary)',
            }}
            className="min-h-[44px] px-4 py-2 rounded-full text-sm font-semibold inline-flex items-center gap-1.5 shrink-0 transition-opacity hover:opacity-90"
          >
            <Plus className="w-4 h-4" />
            <span>New Agent</span>
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {agents.map((agent) => {
            const Icon = AGENT_ICONS[agent.icon] ?? Bot;
            const modelLabel = allModels.find((m) => m.id === agent.defaultModelId)?.label ?? agent.defaultModelId;
            return (
              <div
                key={agent.id}
                data-testid="agent-card"
                style={{
                  backgroundColor: 'var(--m3-surface-container)',
                  borderColor: 'var(--m3-outline)',
                }}
                className="rounded-[24px] border p-4 flex flex-col justify-between gap-4"
              >
                <div className="space-y-2.5">
                  <div className="flex items-start justify-between gap-3">
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
                  </div>

                  <p className="text-sm text-slate-600 dark:text-slate-300 line-clamp-2">
                    {agent.description || agent.systemPrompt}
                  </p>

                  <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                    Default: {modelLabel}
                    <span aria-hidden="true"> · </span>
                    {agent.allowedServerIds === null
                      ? 'All connected servers'
                      : `${agent.allowedServerIds.length} server(s)`}
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-200/60 dark:border-slate-800">
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
                    <span>Chat</span>
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
              </div>
            );
          })}
        </div>
      </div>

      <BottomSheet
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        title={editingId ? 'Edit Agent' : 'Create Agent'}
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
                placeholder="e.g. Ops Reviewer"
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
                <option value="book-open">Research</option>
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

          <div>
            <label htmlFor="ag-prompt" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              System Prompt
            </label>
            <textarea
              id="ag-prompt"
              rows={4}
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

          <div className="space-y-2 rounded-2xl border border-slate-200 dark:border-slate-800 p-3.5">
            <div className="flex items-center justify-between gap-2 text-sm font-medium text-slate-900 dark:text-white">
              <span>Allow all connected MCP servers</span>
              <M3Switch
                checked={allServersAllowed}
                ariaLabel="Allow all connected MCP servers"
                onChange={() => setAllServersAllowed((v) => !v)}
              />
            </div>
            {!allServersAllowed && (
              <div className="pt-2 space-y-1.5 border-t border-slate-100 dark:border-slate-800">
                {servers.map((srv) => {
                  const checked = selectedServerIds.includes(srv.id);
                  return (
                    <label key={srv.id} className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          setSelectedServerIds((prev) =>
                            e.target.checked ? [...prev, srv.id] : prev.filter((id) => id !== srv.id)
                          );
                        }}
                        className="w-4 h-4 accent-blue-600"
                      />
                      <span>{srv.name}</span>
                    </label>
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
