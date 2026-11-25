import { CONNECTOR_PRESETS } from '../config/connectors';
import { GITHUB_TOOLS, YOUTUBE_TOOLS } from '../services/mcp/virtualConnectors';
import type { AgentProfile, AppSettings, McpServerConfig } from '../types';

export const DEFAULT_STUDY_INSTRUCTIONS =
  '1. Start with a 2-sentence Clear Overview.\n2. Break down Core Concepts with bullet points and simple real-world analogies.\n3. Show a Worked Example or Code/Formula Walkthrough.\n4. End with 3 Quick Self-Check Questions (answers hidden under a short Answers section).';

export const STUDY_INSTRUCTION_PRESETS: Array<{
  id: string;
  label: string;
  shortHint: string;
  instructions: string;
}> = [
  {
    id: 'step_by_step',
    label: 'Step-by-Step Guide',
    shortHint: 'Overview, analogies & worked example',
    instructions: DEFAULT_STUDY_INSTRUCTIONS,
  },
  {
    id: 'socratic_tutor',
    label: 'Socratic Tutor',
    shortHint: 'Guides you one question at a time',
    instructions:
      'Act like a patient Socratic tutor (ChatGPT Study Mode style): do NOT dump the entire solution all at once. Give a crisp 2–3 sentence intuitive explanation of ONLY the current concept, provide 1 concrete example, and end with ONE clear check-in question asking the student to reason or predict the next step before proceeding.',
  },
  {
    id: 'exam_prep',
    label: 'Exam Cheat Sheet',
    shortHint: 'High-yield points, formulas & traps',
    instructions:
      '1. High-Yield Definition (1–2 lines)\n2. Core Rules / Formulas to Memorize (concise numbered list)\n3. Clean Markdown Comparison Table if multiple items exist\n4. Common Exam Mistakes & Traps to Avoid\n5. 3 Practice Questions with brief Answer Explanations.',
  },
  {
    id: 'eli5_deep',
    label: 'Feynman / ELI5',
    shortHint: 'Zero-jargon intuition then deep dive',
    instructions:
      '1. Explain Like I’m New (zero jargon, everyday analogy)\n2. Technical Deep Dive (precise definitions & how parts interact)\n3. Quick Recap Cheat-Sheet Table.',
  },
  {
    id: 'flashcards',
    label: 'Flashcard Pack',
    shortHint: 'Active recall cards ready to flip',
    instructions:
      'Organize the explanation as 5–7 crisp Front/Back study flashcards using headings (### Card N: Topic) followed by **Question:**, **Answer:**, and **Memory Hook:** — OR include a ```study-flashcards JSON block.',
  },
  {
    id: 'compare_table',
    label: 'Compare & Table',
    shortHint: 'Side-by-side matrix & when to use',
    instructions:
      '1. One-sentence summary of why the concepts differ\n2. Clean Markdown Comparison Table with short, scannable cell values (Criteria | Option A | Option B)\n3. Real-World Scenario: When to choose each\n4. Key Takeaway Callout.',
  },
];

export const BUILT_IN_AGENTS: AgentProfile[] = [
  {
    id: 'agent_general',
    name: 'General Assistant',
    icon: 'compass',
    description: 'Balanced assistant for everyday chat, Pro Document exports, or connected MCP tasks.',
    systemPrompt:
      'You are General Assistant inside MCP Hub. Answer clearly and concisely. Follow the active mode instructions strictly — emit artifact blocks for PDF/DOCX/XLSX/PPTX/app requests instead of falling back to generic note tools.',
    defaultModelId: 'gemini-4-hydrogen',
    defaultEffort: 'medium',
    defaultChatMode: 'general',
    studyInstructions: '',
    allowedServerIds: null,
    allowedToolNames: null,
    isBuiltIn: true,
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  },
  {
    id: 'agent_operator',
    name: 'MCP Operator',
    icon: 'terminal',
    description: 'Careful tool-use specialist that validates parameters and verifies state changes.',
    systemPrompt:
      'You are MCP Operator, a careful tool-execution specialist. Always inspect available MCP tool schemas before calling a tool, prefer read-only checks before write operations, explain what write action you are about to perform, and verify outcomes after execution.',
    defaultModelId: 'gemini-4-neon',
    defaultEffort: 'high',
    defaultChatMode: 'professional',
    studyInstructions: '',
    allowedServerIds: null,
    allowedToolNames: null,
    isBuiltIn: true,
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  },
  {
    id: 'agent_study',
    name: 'Study Tutor',
    icon: 'book-open',
    description: 'Structured learning coach that follows your exact study layout without invoking MCPs.',
    systemPrompt:
      'You are Study Tutor, an encouraging, crystal-clear educator. Prioritize understanding, mental models, visual formatting, and strict adherence to the student’s chosen response structure.',
    defaultModelId: 'gemini-4-hydrogen',
    defaultEffort: 'medium',
    defaultChatMode: 'study',
    studyInstructions: DEFAULT_STUDY_INSTRUCTIONS,
    allowedServerIds: null,
    allowedToolNames: null,
    isBuiltIn: true,
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  },
  {
    id: 'agent_researcher',
    name: 'Researcher',
    icon: 'book-open',
    description: 'Deep synthesis specialist for multi-source reading, structured notes, and citations.',
    systemPrompt:
      'You are Researcher. Gather evidence systematically from provided sources, web grounding, or connected MCP tools, cross-check figures, highlight uncertainties explicitly, and structure final findings with clear headings and bullet points.',
    defaultModelId: 'qwen/qwen3-32b',
    defaultEffort: 'high',
    defaultChatMode: 'professional',
    studyInstructions: '',
    allowedServerIds: null,
    allowedToolNames: null,
    isBuiltIn: true,
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  },
  {
    id: 'agent_pro_architect',
    name: 'Pro App & Doc Architect',
    icon: 'terminal',
    description: 'Engineers multi-file web apps, syncs code to GitHub via MCP, and builds PPTX, XLSX, DOCX & PDF files.',
    systemPrompt:
      'You are Pro App & Doc Architect inside MCP Hub Pro Studio. Engineer production-quality multi-file web applications via ```artifact-app JSON bundles (with live previewable HTML/CSS/JS), sync code cleanly to GitHub via connected GitHub MCP tools (`github_create_repo`, `github_push_files_batch`), and build executive PPTX, XLSX, DOCX, and PDF deliverables via structured artifact blocks.',
    defaultModelId: 'gemini-4-neon',
    defaultEffort: 'medium',
    defaultChatMode: 'professional',
    studyInstructions: '',
    allowedServerIds: null,
    allowedToolNames: null,
    isBuiltIn: true,
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  },
];

export const DEFAULT_SANDBOX_SERVER: McpServerConfig = {
  id: 'srv_sandbox',
  name: 'Workspace Sandbox',
  url: 'virtual://mcp-hub-sandbox',
  authType: 'none',
  enabled: true,
  transportPreference: 'auto',
  status: 'disconnected',
  tools: [],
  resources: [],
  prompts: [],
  disabledTools: [],
  presetId: 'sandbox',
};

export const YOUTUBE_DEFAULT_SERVER: McpServerConfig = {
  id: CONNECTOR_PRESETS.youtube.serverId,
  name: CONNECTOR_PRESETS.youtube.name,
  url: CONNECTOR_PRESETS.youtube.defaultUrl,
  authType: CONNECTOR_PRESETS.youtube.defaultAuthType,
  enabled: true,
  transportPreference: 'auto',
  status: 'disconnected',
  tools: YOUTUBE_TOOLS,
  resources: [],
  prompts: [],
  disabledTools: [],
  presetId: 'youtube',
  docsUrl: CONNECTOR_PRESETS.youtube.keyUrl,
};

export const GITHUB_DEFAULT_SERVER: McpServerConfig = {
  id: CONNECTOR_PRESETS.github.serverId,
  name: CONNECTOR_PRESETS.github.name,
  url: CONNECTOR_PRESETS.github.defaultUrl,
  authType: CONNECTOR_PRESETS.github.defaultAuthType,
  enabled: true,
  transportPreference: 'auto',
  status: 'disconnected',
  tools: GITHUB_TOOLS,
  resources: [],
  prompts: [],
  disabledTools: [],
  presetId: 'github',
  docsUrl: CONNECTOR_PRESETS.github.keyUrl,
};

export const CANVA_DEFAULT_SERVER: McpServerConfig = {
  id: CONNECTOR_PRESETS.canva.serverId,
  name: CONNECTOR_PRESETS.canva.name,
  url: CONNECTOR_PRESETS.canva.defaultUrl,
  authType: CONNECTOR_PRESETS.canva.defaultAuthType,
  enabled: true,
  transportPreference: 'auto',
  status: 'disconnected',
  tools: [],
  resources: [],
  prompts: [],
  disabledTools: [],
  presetId: 'canva',
  docsUrl: CONNECTOR_PRESETS.canva.keyUrl,
};

export const DEFAULT_SERVERS: McpServerConfig[] = [
  DEFAULT_SANDBOX_SERVER,
  YOUTUBE_DEFAULT_SERVER,
  GITHUB_DEFAULT_SERVER,
  CANVA_DEFAULT_SERVER,
];

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  accentTheme: 'pixel_blue',
  oledDark: false,
  a2uiEnabled: true,
  a2uiMode: 'smart',
  confirmBeforeWrite: true,
  maxAgentSteps: 10,
  toolOutputBudgetChars: 8000,
  alwaysAllowedTools: [],
  alwaysAllowedRules: [],
  toolPolicies: [],
  biometricLockEnabled: false,
  hapticsEnabled: true,
  onboardingCompleted: false,
};

export const DEFAULT_SAVED_PROMPTS = [
  {
    id: 'macro_study_deep_dive',
    title: 'Study Deep Dive',
    category: 'Study',
    template:
      'Teach me {{topic}} at a {{level}} level. Include a visual Mermaid flowchart, core formulas, and 3 self-check questions.',
    updatedAt: 1700000000000,
  },
  {
    id: 'macro_exec_brief',
    title: 'Executive Brief (.PDF)',
    category: 'Pro',
    template:
      'Create a structured executive PDF report on {{subject}} tailored for {{audience}} including KPI metrics and rollout milestones.',
    updatedAt: 1700000000000,
  },
  {
    id: 'macro_bug_triage',
    title: 'Bug Triage',
    category: 'Engineering',
    template:
      'Diagnose this issue in {{component}}: {{symptom}}. List root causes, verification steps, and a minimal fix.',
    updatedAt: 1700000000000,
  },
  {
    id: 'macro_code_review',
    title: 'Security & Code Review',
    category: 'Engineering',
    template:
      'Review the {{language}} implementation for {{target}}. Check security boundaries, edge cases, concurrency, and test coverage.',
    updatedAt: 1700000000000,
  },
];
