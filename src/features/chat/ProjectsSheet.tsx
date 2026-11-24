import { useState } from 'react';
import type { AgentProfile, McpServerConfig } from '../../types';
import { BottomSheet } from '../../ui/BottomSheet';
import { processUploadedFiles } from '../../utils/attachments';
import {
  attachConversationToProject, listWorkspaceProjects, saveWorkspaceProjects, type WorkspaceProject,
} from '../../utils/projects';

const CONTROL = 'min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900';
const newProject = (): WorkspaceProject => ({
  id: globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2), name: '', instructions: '', serverIds: null, pinnedFiles: [], conversationIds: [],
});

export function ProjectsSheet({
  open, scope, currentConversation, projects, agents, servers, onClose, onUpdate, onUse, onNewChat,
}: {
  open: boolean;
  scope: string;
  currentConversation?: string;
  projects: WorkspaceProject[];
  agents: AgentProfile[];
  servers: McpServerConfig[];
  onClose: () => void;
  onUpdate: () => void;
  onUse: (project: WorkspaceProject) => void;
  onNewChat: (project: WorkspaceProject) => void;
}) {
  const [draft, setDraft] = useState<WorkspaceProject>(() => newProject());
  const [error, setError] = useState('');
  const selected = projects.find((project) => project.id === draft.id);
  const write = (next: WorkspaceProject[]) => {
    try {
      saveWorkspaceProjects(scope, next);
      setError('');
      onUpdate();
      return true;
    } catch {
      setError('Could not save the project to this device.');
      return false;
    }
  };

  return (
    <BottomSheet open={open} onClose={onClose} title="Projects">
      <div className="space-y-3 text-slate-900 dark:text-slate-100">
        <div className="flex gap-2">
          <select aria-label="Choose project" className={CONTROL + ' min-w-0 flex-1'} value={selected?.id ?? ''}
            onChange={(event) => { setDraft(projects.find((item) => item.id === event.target.value) ?? newProject()); setError(''); }}>
            <option value="">New project</option>
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
          <button type="button" className={CONTROL} onClick={() => { setDraft(newProject()); setError(''); }}>New project</button>
        </div>
        <form className="space-y-3" onSubmit={(event) => {
          event.preventDefault();
          if (!draft.name.trim()) return;
          const latest = listWorkspaceProjects(scope);
          const updated = { ...draft, name: draft.name.trim(), conversationIds: latest.find((project) => project.id === draft.id)?.conversationIds ?? [] };
          if (write([...latest.filter((project) => project.id !== draft.id), updated])) setDraft(updated);
        }}>
          <label className="block text-xs">Project name
            <input title="Project name" className={CONTROL + ' mt-1 w-full'} required maxLength={80} value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
          </label>
          <label className="block text-xs">Project instructions
            <textarea className={CONTROL + ' mt-1 w-full p-2'} rows={3} maxLength={5000} value={draft.instructions}
              onChange={(event) => setDraft({ ...draft, instructions: event.target.value })} />
          </label>
          <label className="block text-xs">Default agent
            <select className={CONTROL + ' mt-1 w-full'} value={draft.defaultAgentId ?? ''}
              onChange={(event) => setDraft({ ...draft, defaultAgentId: event.target.value || undefined })}>
              <option value="">Use the current agent</option>
              {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
            </select>
          </label>
          <fieldset className="rounded-lg border border-slate-300 px-3 dark:border-slate-700">
            <legend className="px-1 text-xs">Default servers</legend>
            <label className="flex min-h-[44px] items-center gap-2 text-xs">
              <input type="checkbox" checked={draft.serverIds === null}
                onChange={(event) => setDraft({ ...draft, serverIds: event.target.checked ? null : [] })} />
              Use all available servers
            </label>
            {draft.serverIds !== null && servers.map((server) => (
              <label key={server.id} className="flex min-h-[44px] items-center gap-2 text-xs">
                <input type="checkbox" checked={draft.serverIds?.includes(server.id)}
                  onChange={(event) => setDraft({ ...draft, serverIds: event.target.checked
                    ? [...(draft.serverIds ?? []), server.id] : (draft.serverIds ?? []).filter((id) => id !== server.id) })} />
                {server.name}
              </label>
            ))}
          </fieldset>
          <label className="block text-xs">Pin text files for local search
            <input type="file" multiple className="mt-1 block min-h-[44px] w-full file:min-h-[44px]"
              onChange={(event) => {
                const files = Array.from(event.target.files ?? []);
                const draftId = draft.id;
                event.target.value = '';
                void processUploadedFiles(files).then(({ attachments, errors }) => {
                  const texts = attachments.filter((file) => file.textContent?.trim());
                  setDraft((old) => old.id === draftId
                    ? { ...old, pinnedFiles: [...new Map([...old.pinnedFiles, ...texts].map((item) => [item.name, item])).values()] }
                    : old);
                  setError(errors[0] ?? (texts.length < files.length ? 'Only files with readable text can be pinned.' : ''));
                });
              }} />
          </label>
          {draft.pinnedFiles.map((file) => (
            <div key={file.id} className="flex items-center justify-between gap-2 text-xs">
              <span>{file.name}</span>
              <button type="button" className={CONTROL} onClick={() => setDraft({ ...draft, pinnedFiles: draft.pinnedFiles.filter((item) => item.id !== file.id) })}>
                Remove
              </button>
            </div>
          ))}
          <button type="submit" className="min-h-[44px] rounded-lg bg-blue-700 px-3 text-sm font-semibold text-white">Save project</button>
        </form>
        {error && <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">{error}</p>}
        {selected && (
          <div className="flex flex-wrap gap-2">
            {currentConversation && <button type="button" className={CONTROL} onClick={() => {
              if (write(attachConversationToProject(listWorkspaceProjects(scope), currentConversation, selected.id))) {
                onUse(selected);
                onClose();
              }
            }}>Use in this chat</button>}
            <button type="button" className={CONTROL} onClick={() => {
              try { onNewChat(selected); onClose(); }
              catch { setError('Could not save the new chat to this project.'); }
            }}>New chat in project</button>
            {currentConversation && selected.conversationIds.includes(currentConversation) && (
              <button type="button" className={CONTROL} onClick={() => {
                if (write(attachConversationToProject(listWorkspaceProjects(scope), currentConversation))) onClose();
              }}>Remove from this chat</button>
            )}
          </div>
        )}
      </div>
    </BottomSheet>
  );
}
