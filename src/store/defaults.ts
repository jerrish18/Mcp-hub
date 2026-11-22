import { CONNECTOR_PRESETS } from '../config/connectors';
import { GITHUB_TOOLS, YOUTUBE_TOOLS } from '../services/mcp/virtualConnectors';
import type { AgentProfile, AppSettings, McpServerConfig } from '../types';

export const DEFAULT_STUDY_INSTRUCTIONS =
  '1. Start with a 2-sentence Clear Overview.\n2. Break down Core Concepts with bullet points and simple real-world analogies.\n3. Show a Worked Example or Code/Formula Walkthrough.\n4. End with 3 Quick Self-Check Questions (answers hidden under a short Answers section).';

export const STUDY_INSTRUCTION_PRESETS: Array<{ id: string; label: string; instructions: string }> = [
  {
    id: 'step_by_step',
    label: 'Step-by-Step Guide',
    instructions: DEFAULT_STUDY_INSTRUCTIONS,
  },
  {
    id: 'exam_prep',
    label: 'Exam Notes',
    instructions:
      '1. High-Yield Definition (1–2 lines)\n2. Key Points to Memorize (concise numbered list)\n3. Common Mistakes & Traps to Avoid\n4. 2 Exam-Style Practice Questions with Brief Solutions.',
  },
  {
    id: 'flashcards',
    label: 'Flashcard Q&A',
    instructions:
      'Organize the explanation as 5–7 crisp Front/Back study flashcards using headings (### Card N: Topic) followed by **Question:** and **Answer:** with a one-line memory hook.',
  },
  {
    id: 'eli5_deep',
    label: 'Simple + Deep Dive',
    instructions:
      '1. Explain Like I’m New (intuitive analogy, zero jargon)\n2. Technical Deep Dive (precise definitions & mechanics)\n3. Quick Summary Table or Key Takeaways.',
  },
];

export const BUILT_IN_AGENTS: AgentProfile[] = [
  {
    id: 'agent_general',
    name: 'General Assistant',
    icon: 'compass',
    description: 'Balanced everyday assistant for day-to-day chat or connected MCP tasks.',
    systemPrompt:
      'You are General Assistant inside MCP Hub. Answer clearly and concisely. Adapt smoothly to the active chat mode.',
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
  confirmBeforeWrite: true,
  maxAgentSteps: 10,
  alwaysAllowedTools: [],
  biometricLockEnabled: false,
  hapticsEnabled: true,
  onboardingCompleted: false,
};
