import { useState } from 'react';
import { Check, FileText, FolderKanban, Plus, Trash2, Upload, X } from 'lucide-react';
import type { AgentProfile, McpServerConfig, ProjectPinnedFile, ProjectProfile } from '../../types';
import { BottomSheet } from '../../ui/BottomSheet';
import { processUploadedFiles } from '../../utils/attachments';

interface ProjectsModalProps {
  open: boolean;
  onClose: () => void;
  projects: ProjectProfile[];
  activeProjectId: string | null;
  agents: AgentProfile[];
  servers: McpServerConfig[];
  onSelectProject: (projectId: string | null) => void;
  onSaveProject: (project: Omit<ProjectProfile, 'id' | 'updatedAt'> & { id?: string }) => ProjectProfile;
  onDeleteProject: (projectId: string) => void;
}

export function ProjectsModal({
  open,
  onClose,
  projects,
  activeProjectId,
  agents,
  servers,
  onSelectProject,
  onSaveProject,
  onDeleteProject,
}: ProjectsModalProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [instructions, setInstructions] = useState('');
  const [pinnedFiles, setPinnedFiles] = useState<ProjectPinnedFile[]>([]);
  const [defaultAgentId, setDefaultAgentId] = useState('');
  const [restrictServers, setRestrictServers] = useState(false);
  const [selectedServerIds, setSelectedServerIds] = useState<string[]>([]);
  const [uploadError, setUploadError] = useState('');
  const [fileQuery, setFileQuery] = useState('');
  const [previewFileId, setPreviewFileId] = useState<string | null>(null);
  const visibleFiles = pinnedFiles.filter(file => !fileQuery.trim() || `${file.name} ${file.textContent}`.toLowerCase().includes(fileQuery.trim().toLowerCase()));
  const previewFile = pinnedFiles.find(file => file.id === previewFileId);

  const resetForm = () => {
    setEditingId(null);
    setName('');
    setDescription('');
    setInstructions('');
    setPinnedFiles([]);
    setDefaultAgentId('');
    setRestrictServers(false);
    setSelectedServerIds([]);
    setUploadError('');
    setFileQuery('');
    setPreviewFileId(null);
  };

  const loadForEdit = (proj: ProjectProfile) => {
    setEditingId(proj.id);
    setName(proj.name);
    setDescription(proj.description);
    setInstructions(proj.instructions);
    setPinnedFiles(proj.pinnedFiles);
    setDefaultAgentId(proj.defaultAgentId ?? '');
    if (Array.isArray(proj.allowedServerIds)) {
      setRestrictServers(true);
      setSelectedServerIds(proj.allowedServerIds);
    } else {
      setRestrictServers(false);
      setSelectedServerIds([]);
    }
    setUploadError('');
    setFileQuery('');
    setPreviewFileId(null);
  };

  const handlePinFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploadError('');
    const { attachments, errors } = await processUploadedFiles(files);
    if (errors.length > 0) {
      setUploadError(errors[0]);
    }
    const textOnes: ProjectPinnedFile[] = attachments
      .filter((a) => Boolean(a.textContent?.trim()))
      .map((a) => ({
        id: a.id,
        name: a.name,
        size: a.size,
        textContent: a.textContent!,
      }));
    if (textOnes.length > 0) {
      setPinnedFiles((prev) => [...prev, ...textOnes].slice(0, 8));
    } else if (attachments.length > 0 && errors.length === 0) {
      setUploadError('Only text/code/CSV/PDF/XLSX documents with extractable text can be pinned to Project RAG.');
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const saved = onSaveProject({
      id: editingId ?? undefined,
      name: name.trim(),
      description: description.trim(),
      instructions: instructions.trim(),
      pinnedFiles,
      defaultAgentId: defaultAgentId || undefined,
      allowedServerIds: restrictServers ? selectedServerIds : null,
    });
    onSelectProject(saved.id);
    resetForm();
  };

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Projects & Scoped Workspaces"
      subtitle="Attach persistent instructions, pinned RAG files, and server scope to any chat"
    >
      <div className="space-y-5" data-testid="projects-modal">
        {/* Existing Projects List */}
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Your Projects ({projects.length})
            </h3>
            {activeProjectId && (
              <button
                type="button"
                onClick={() => onSelectProject(null)}
                className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline"
              >
                Clear Active Project
              </button>
            )}
          </div>

          {projects.length === 0 ? (
            <div
              style={{
                backgroundColor: 'var(--m3-surface-container)',
                borderColor: 'var(--m3-outline)',
              }}
              className="rounded-2xl border p-4 text-xs text-slate-500 dark:text-slate-400"
            >
              No projects yet. Create one below to give chats shared custom instructions and pinned RAG docs.
            </div>
          ) : (
            <div className="space-y-2">
              {projects.map((proj) => {
                const isActive = proj.id === activeProjectId;
                return (
                  <div
                    key={proj.id}
                    data-testid={`project-card-${proj.id}`}
                    style={
                      isActive
                        ? {
                            backgroundColor: 'var(--m3-primary-container)',
                            borderColor: 'var(--m3-primary)',
                          }
                        : {
                            backgroundColor: 'var(--m3-surface-container)',
                            borderColor: 'var(--m3-outline)',
                          }
                    }
                    className="rounded-2xl border p-3.5 flex items-start justify-between gap-3"
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <FolderKanban className="w-4 h-4 shrink-0 text-blue-600 dark:text-blue-400" />
                        <span className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                          {proj.name}
                        </span>
                        {isActive && (
                          <span className="text-[10px] font-semibold uppercase text-emerald-700 dark:text-emerald-300 inline-flex items-center gap-0.5">
                            <Check className="w-3 h-3" /> Active
                          </span>
                        )}
                      </div>
                      {proj.description && (
                        <p className="text-xs text-slate-600 dark:text-slate-300 truncate">
                          {proj.description}
                        </p>
                      )}
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                        {proj.pinnedFiles.length} pinned file{proj.pinnedFiles.length === 1 ? '' : 's'}
                        {' · '}
                        {Array.isArray(proj.allowedServerIds)
                          ? `${proj.allowedServerIds.length} server(s) scoped`
                          : 'All connected servers'}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          onSelectProject(isActive ? null : proj.id);
                          if (!isActive) onClose();
                        }}
                        style={{
                          backgroundColor: isActive ? 'var(--m3-surface)' : 'var(--m3-primary)',
                          color: isActive ? 'inherit' : 'var(--m3-on-primary)',
                        }}
                        className="min-h-[44px] px-3.5 rounded-full text-xs font-semibold"
                      >
                        {isActive ? 'Unlink' : 'Use'}
                      </button>
                      <button
                        type="button"
                        onClick={() => loadForEdit(proj)}
                        style={{
                          backgroundColor: 'var(--m3-surface)',
                          borderColor: 'var(--m3-outline)',
                        }}
                        className="min-h-[44px] px-3.5 rounded-full border text-xs font-semibold text-slate-700 dark:text-slate-200"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteProject(proj.id)}
                        aria-label={`Delete ${proj.name}`}
                        className="min-h-[44px] min-w-[44px] rounded-full flex items-center justify-center text-rose-500 hover:bg-rose-500/10"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Create / Edit Project Form */}
        <form
          onSubmit={handleSubmit}
          style={{
            backgroundColor: 'var(--m3-surface-container)',
            borderColor: 'var(--m3-outline)',
          }}
          className="rounded-2xl border p-4 space-y-3"
        >
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white inline-flex items-center gap-1.5">
              <Plus className="w-4 h-4" />
              <span>{editingId ? 'Edit Project' : 'New Project'}</span>
            </h3>
            {editingId && (
              <button
                type="button"
                onClick={resetForm}
                className="text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white"
              >
                Cancel edit
              </button>
            )}
          </div>

          {!editingId && <label className="block text-xs font-semibold">Start from a template
            <select defaultValue="" className="block w-full min-h-[42px] rounded-xl border bg-transparent px-3 mt-1" onChange={e => {
              const templates = {
                study: ['Study workspace', 'Organize learning and revision', 'Explain concepts clearly, cite references, and offer practice questions.'],
                writing: ['Writing workspace', 'Draft and revise documents', 'Use a clear structure, distinguish facts from assumptions, and suggest edits.'],
                research: ['Research workspace', 'Collect and compare sources', 'Summarize evidence, cite sources, and identify open questions.'],
              };
              const template = templates[e.target.value as keyof typeof templates];
              if (template) { setName(template[0]); setDescription(template[1]); setInstructions(template[2]); }
            }}><option value="">Blank project</option><option value="study">Study</option><option value="writing">Writing</option><option value="research">Research</option></select>
          </label>}

          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Project name (e.g. Q4 Engineering Docs)"
            data-testid="project-name-input"
            style={{ backgroundColor: 'var(--m3-surface)', borderColor: 'var(--m3-outline)' }}
            className="w-full min-h-[42px] px-3.5 rounded-xl border text-sm text-slate-900 dark:text-white"
          />

          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Short scope or goal (optional)"
            style={{ backgroundColor: 'var(--m3-surface)', borderColor: 'var(--m3-outline)' }}
            className="w-full min-h-[40px] px-3.5 rounded-xl border text-xs text-slate-900 dark:text-white"
          />

          <textarea
            rows={3}
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="Custom instructions always injected when this project is active..."
            data-testid="project-instructions-input"
            style={{ backgroundColor: 'var(--m3-surface)', borderColor: 'var(--m3-outline)' }}
            className="w-full p-3 rounded-xl border text-xs text-slate-900 dark:text-white"
          />

          {/* Pinned RAG Files */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-200">
                Pinned Reference Files (Local RAG)
              </span>
              <label
                style={{
                  backgroundColor: 'var(--m3-surface)',
                  borderColor: 'var(--m3-outline)',
                }}
                className="min-h-[44px] px-3.5 rounded-full border text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer hover:opacity-90"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Pin File</span>
                <input
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    void handlePinFiles(e.target.files);
                    e.target.value = '';
                  }}
                />
              </label>
            </div>
            {uploadError && <div className="text-xs text-rose-500">{uploadError}</div>}
            {pinnedFiles.length > 0 && (
              <div className="space-y-2">
              <input type="search" aria-label="Search project reference files" placeholder="Search file names or text…" value={fileQuery} onChange={event => setFileQuery(event.target.value)} className="w-full min-h-[40px] rounded-xl border bg-transparent px-3 text-xs" />
              <p className="text-xs text-slate-500">{visibleFiles.length} of {pinnedFiles.length} files · {pinnedFiles.reduce((sum, file) => sum + file.size, 0).toLocaleString()} bytes</p>
              <div className="flex flex-wrap gap-1.5">
                {visibleFiles.map((file) => (
                  <span
                    key={file.id}
                    style={{
                      backgroundColor: 'var(--m3-surface)',
                      borderColor: 'var(--m3-outline)',
                    }}
                    className="px-2.5 py-1 rounded-xl border text-[11px] inline-flex items-center gap-1.5 text-slate-700 dark:text-slate-200"
                  >
                    <FileText className="w-3 h-3 shrink-0" />
                    <button type="button" className="truncate max-w-[140px] underline" onClick={() => setPreviewFileId(file.id)}>{file.name}</button>
                    <button
                      type="button"
                      onClick={() => setPinnedFiles((p) => p.filter((f) => f.id !== file.id))}
                      aria-label={`Remove ${file.name}`}
                      className="text-slate-400 hover:text-rose-500"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
              {previewFile && <section className="rounded-xl border p-3 space-y-2"><div className="flex justify-between items-center gap-2"><h4 className="text-xs font-semibold truncate">{previewFile.name}</h4><button type="button" className="text-xs underline" onClick={() => setPreviewFileId(null)}>Close preview</button></div><pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs">{previewFile.textContent.slice(0, 10000)}</pre></section>}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <label className="space-y-1 block">
              <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                Default Agent (optional)
              </span>
              <select
                value={defaultAgentId}
                onChange={(e) => setDefaultAgentId(e.target.value)}
                style={{ backgroundColor: 'var(--m3-surface)', borderColor: 'var(--m3-outline)' }}
                className="w-full min-h-[40px] px-3 rounded-xl border text-xs text-slate-900 dark:text-white"
              >
                <option value="">Keep current agent</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>

            <div className="space-y-1">
              <label className="inline-flex items-center gap-2 min-h-[40px] text-xs font-medium text-slate-700 dark:text-slate-200 cursor-pointer pt-4">
                <input
                  type="checkbox"
                  checked={restrictServers}
                  onChange={(e) => setRestrictServers(e.target.checked)}
                />
                <span>Restrict allowed MCP servers</span>
              </label>
            </div>
          </div>

          {restrictServers && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {servers.map((srv) => {
                const checked = selectedServerIds.includes(srv.id);
                return (
                  <button
                    key={srv.id}
                    type="button"
                    onClick={() =>
                      setSelectedServerIds((prev) =>
                        checked ? prev.filter((id) => id !== srv.id) : [...prev, srv.id]
                      )
                    }
                    style={
                      checked
                        ? {
                            backgroundColor: 'var(--m3-primary-container)',
                            color: 'var(--m3-on-primary-container)',
                            borderColor: 'var(--m3-primary)',
                          }
                        : {
                            backgroundColor: 'var(--m3-surface)',
                            borderColor: 'var(--m3-outline)',
                          }
                    }
                    className="min-h-[44px] px-3.5 rounded-full border text-xs font-medium"
                  >
                    {srv.name}
                  </button>
                );
              })}
            </div>
          )}

          <div className="pt-1 flex justify-end">
            <button
              type="submit"
              data-testid="project-save-btn"
              style={{
                backgroundColor: 'var(--m3-primary)',
                color: 'var(--m3-on-primary)',
              }}
              className="min-h-[44px] px-5 rounded-full text-xs font-semibold hover:opacity-90"
            >
              {editingId ? 'Save & Activate Project' : 'Create & Activate Project'}
            </button>
          </div>
        </form>
      </div>
    </BottomSheet>
  );
}
