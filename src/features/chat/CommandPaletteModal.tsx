import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  BookOpen,
  Briefcase,
  Columns2,
  FileText,
  FolderKanban,
  MessageSquare,
  PanelRight,
  Plus,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import type { ChatMode, McpServerConfig, ProjectProfile, SavedPrompt } from '../../types';

export interface CommandPaletteAction {
  id: string;
  group: 'Actions' | 'Modes & Projects' | 'Slash Macros (/)' | 'MCP Resources (@)' | 'MCP Prompts';
  title: string;
  subtitle: string;
  keywords: string;
  run: () => void;
}

interface CommandPaletteModalProps {
  open: boolean;
  onClose: () => void;
  savedPrompts: SavedPrompt[];
  servers: McpServerConfig[];
  projects: ProjectProfile[];
  onInsertPrompt: (text: string) => void;
  onSwitchMode: (mode: ChatMode) => void;
  onSelectProject: (projectId: string | null) => void;
  onStartNewChat: () => void;
  onToggleCompare: () => void;
  onOpenTrace: () => void;
  onOpenCanvas: () => void;
}

export function CommandPaletteModal({
  open,
  onClose,
  savedPrompts,
  servers,
  projects,
  onInsertPrompt,
  onSwitchMode,
  onSelectProject,
  onStartNewChat,
  onToggleCompare,
  onOpenTrace,
  onOpenCanvas,
}: CommandPaletteModalProps) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [open, onClose]);

  const actions = useMemo<CommandPaletteAction[]>(() => {
    const list: CommandPaletteAction[] = [
      {
        id: 'act_new_chat',
        group: 'Actions',
        title: 'New Conversation',
        subtitle: 'Start a fresh chat thread',
        keywords: 'new chat reset thread',
        run: onStartNewChat,
      },
      {
        id: 'act_compare',
        group: 'Actions',
        title: '/compare — Side-by-Side Model Arena',
        subtitle: 'Compare 2-3 free-tier models on the same prompt',
        keywords: 'compare arena benchmark models /compare',
        run: onToggleCompare,
      },
      {
        id: 'act_trace',
        group: 'Actions',
        title: 'Open Run Trace Waterfall',
        subtitle: 'Inspect latency, model fallbacks, and tool replay',
        keywords: 'trace debug waterfall latency tools',
        run: onOpenTrace,
      },
      {
        id: 'act_canvas',
        group: 'Actions',
        title: 'Toggle Pro Canvas Workspace',
        subtitle: 'Open live app IDE, document studio, or data explorer',
        keywords: 'canvas preview ide document',
        run: onOpenCanvas,
      },
      {
        id: 'mode_general',
        group: 'Modes & Projects',
        title: 'Switch Mode: General Chat',
        subtitle: 'Fast everyday Q&A without MCP tool calls',
        keywords: 'mode general everyday',
        run: () => onSwitchMode('general'),
      },
      {
        id: 'mode_pro',
        group: 'Modes & Projects',
        title: 'Switch Mode: Pro Workspace',
        subtitle: 'MCP tools, coding apps, GitHub sync & Document Studio',
        keywords: 'mode pro professional coding github pdf',
        run: () => onSwitchMode('professional'),
      },
      {
        id: 'mode_study',
        group: 'Modes & Projects',
        title: 'Switch Mode: Study Session',
        subtitle: 'Mermaid diagrams, flashcards, quizzes & web visual cards',
        keywords: 'mode study flashcards quiz learn',
        run: () => onSwitchMode('study'),
      },
    ];

    for (const proj of projects) {
      list.push({
        id: `proj_${proj.id}`,
        group: 'Modes & Projects',
        title: `Project: ${proj.name}`,
        subtitle: proj.description || `${proj.pinnedFiles.length} pinned file(s)`,
        keywords: `project ${proj.name} ${proj.description}`,
        run: () => onSelectProject(proj.id),
      });
    }

    for (const macro of savedPrompts) {
      list.push({
        id: `macro_${macro.id}`,
        group: 'Slash Macros (/)',
        title: `/${macro.title}`,
        subtitle: macro.template.slice(0, 90),
        keywords: `/${macro.title} ${macro.category ?? ''} ${macro.template}`,
        run: () => onInsertPrompt(macro.template),
      });
    }

    for (const srv of servers) {
      if (!srv.enabled || srv.status !== 'connected') continue;
      for (const prompt of srv.prompts) {
        list.push({
          id: `mcpp_${srv.id}_${prompt.name}`,
          group: 'MCP Prompts',
          title: `/${prompt.name}`,
          subtitle: `${srv.name} · ${prompt.description || 'MCP prompt template'}`,
          keywords: `/${prompt.name} ${srv.name} ${prompt.description ?? ''}`,
          run: () => onInsertPrompt(`Use MCP prompt "${prompt.name}" from ${srv.name}: `),
        });
      }
      for (const res of srv.resources) {
        list.push({
          id: `mcpr_${srv.id}_${res.uri}`,
          group: 'MCP Resources (@)',
          title: `@${res.name}`,
          subtitle: `${srv.name} · ${res.uri}`,
          keywords: `@${res.name} ${res.uri} ${srv.name}`,
          run: () => onInsertPrompt(`@${res.uri} `),
        });
      }
    }

    return list;
  }, [
    savedPrompts,
    servers,
    projects,
    onInsertPrompt,
    onSwitchMode,
    onSelectProject,
    onStartNewChat,
    onToggleCompare,
    onOpenTrace,
    onOpenCanvas,
  ]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return actions.slice(0, 24);
    return actions
      .filter(
        (a) =>
          a.title.toLowerCase().includes(q) ||
          a.subtitle.toLowerCase().includes(q) ||
          a.keywords.toLowerCase().includes(q)
      )
      .slice(0, 30);
  }, [actions, query]);

  if (!open) return null;

  const renderIcon = (action: CommandPaletteAction) => {
    if (action.id === 'act_new_chat') return <Plus className="w-4 h-4" />;
    if (action.id === 'act_compare') return <Columns2 className="w-4 h-4" />;
    if (action.id === 'act_trace') return <Activity className="w-4 h-4" />;
    if (action.id === 'act_canvas') return <PanelRight className="w-4 h-4" />;
    if (action.id === 'mode_general') return <MessageSquare className="w-4 h-4" />;
    if (action.id === 'mode_pro') return <Briefcase className="w-4 h-4" />;
    if (action.id === 'mode_study') return <BookOpen className="w-4 h-4" />;
    if (action.id.startsWith('proj_')) return <FolderKanban className="w-4 h-4" />;
    if (action.group === 'MCP Resources (@)') return <FileText className="w-4 h-4" />;
    return <Sparkles className="w-4 h-4" />;
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Command Palette"
      data-testid="command-palette-modal"
      className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-xs flex items-start justify-center p-4 pt-14 sm:pt-20"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: 'var(--m3-surface)',
          borderColor: 'var(--m3-outline)',
        }}
        className="w-full max-w-xl rounded-[18px] border shadow-xl overflow-hidden flex flex-col max-h-[75dvh]"
      >
        <div
          style={{ borderColor: 'var(--m3-outline)' }}
          className="px-4 py-3 border-b flex items-center gap-2.5"
        >
          <Search className="w-4 h-4 text-slate-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && filtered[0]) {
                e.preventDefault();
                filtered[0].run();
                onClose();
              }
            }}
            aria-label="Search commands"
            placeholder="Search commands, projects, or macros"
            className="min-w-0 flex-1 bg-transparent text-sm text-slate-900 dark:text-white focus:outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close command palette"
            className="min-h-[44px] min-w-[44px] rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {filtered.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-500 dark:text-slate-400">
              No matching commands, macros, or resources.
            </div>
          ) : (
            filtered.map((item) => (
              <button
                key={item.id}
                type="button"
                data-testid={`cmd-item-${item.id}`}
                onClick={() => {
                  item.run();
                  onClose();
                }}
                className="w-full min-h-[48px] px-3 py-2 rounded-2xl text-left flex items-center justify-between gap-3 hover:bg-slate-100 dark:hover:bg-slate-800/70 transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span
                    style={{
                      backgroundColor: 'var(--m3-primary-container)',
                      color: 'var(--m3-on-primary-container)',
                    }}
                    className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
                  >
                    {renderIcon(item)}
                  </span>
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                      {item.title}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                      {item.subtitle}
                    </div>
                  </div>
                </div>
                <span className="text-[10px] font-medium text-slate-400 shrink-0">
                  {item.group}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
