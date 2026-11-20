import { useState } from 'react';
import { ArrowRight, CheckCircle2, KeyRound, MessageSquare, Server, Sparkles } from 'lucide-react';
import { PROVIDER_INFO } from '../../config/models';
import { useHubStore } from '../../store/useHubStore';

interface OnboardingModalProps {
  onComplete: (navigateTab?: 'chat' | 'servers') => void;
}

export function OnboardingModal({ onComplete }: OnboardingModalProps) {
  const { setProviderKeys, updateSettings, enableDemoSandbox, servers, setActiveModel } = useHubStore();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [provider, setProvider] = useState<'gemini' | 'groq' | 'openrouter'>('gemini');
  const [apiKeyInput, setApiKeyInput] = useState('');

  const handleSaveKeyAndNext = async () => {
    const trimmed = apiKeyInput.trim();
    if (trimmed) {
      await setProviderKeys({ [provider]: trimmed });
      if (provider === 'gemini') setActiveModel('gemini-4-hydrogen');
      if (provider === 'groq') setActiveModel('openai/gpt-oss-120b');
      if (provider === 'openrouter') setActiveModel('openrouter/free');
    }
    setStep(2);
  };

  const handleUseDemo = async () => {
    await enableDemoSandbox();
    onComplete('chat');
  };

  const handleFinish = () => {
    updateSettings({ onboardingCompleted: true });
    onComplete('chat');
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to MCP Hub"
    >
      <div
        style={{
          backgroundColor: 'var(--m3-surface-container)',
          borderColor: 'var(--m3-outline)',
        }}
        className="w-full max-w-md rounded-[28px] border p-6 shadow-2xl space-y-6"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span
              style={{
                backgroundColor: 'var(--m3-primary-container)',
                color: 'var(--m3-on-primary-container)',
              }}
              className="w-9 h-9 rounded-2xl flex items-center justify-center"
            >
              <Sparkles className="w-5 h-5" />
            </span>
            <div>
              <h1 className="font-display text-lg font-bold text-slate-900 dark:text-white">
                Welcome to MCP Hub
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Step {step} of 3 · Zero-backend mobile client
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleUseDemo}
            className="min-h-[40px] px-2.5 text-xs font-medium text-slate-500 hover:text-slate-900 dark:hover:text-white"
          >
            Try Demo
          </button>
        </div>

        {step === 1 && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
              <KeyRound className="w-4 h-4 text-blue-600" />
              <span>1. Add a free LLM API key</span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              Your key is encrypted locally and talks directly to the provider over HTTPS. Or skip to try the built-in Sandbox Simulator.
            </p>

            <div className="grid grid-cols-3 gap-1.5 p-1 rounded-xl bg-slate-100 dark:bg-slate-800">
              {(['gemini', 'groq', 'openrouter'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setProvider(p)}
                  className={`min-h-[40px] rounded-lg text-xs font-medium capitalize transition-colors ${
                    provider === p
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {p === 'openrouter' ? 'OpenRouter' : p}
                </button>
              ))}
            </div>

            <div>
              <input
                type="password"
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder={`Paste ${PROVIDER_INFO[provider].name} key (${PROVIDER_INFO[provider].keyHint})`}
                aria-label="Provider API key"
                className="w-full min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm font-mono text-slate-900 dark:text-white"
              />
              <a
                href={PROVIDER_INFO[provider].signupUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-block mt-1.5 text-xs text-blue-600 dark:text-blue-400 hover:underline"
              >
                Get a free {PROVIDER_INFO[provider].name} API key
              </a>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={handleUseDemo}
                className="flex-1 min-h-[44px] rounded-full border border-slate-200 dark:border-slate-700 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                Explore Demo
              </button>
              <button
                type="button"
                onClick={handleSaveKeyAndNext}
                style={{
                  backgroundColor: 'var(--m3-primary)',
                  color: 'var(--m3-on-primary)',
                }}
                className="flex-1 min-h-[44px] rounded-full text-sm font-semibold inline-flex items-center justify-center gap-1.5"
              >
                <span>{apiKeyInput.trim() ? 'Save & Next' : 'Skip'}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
              <Server className="w-4 h-4 text-blue-600" />
              <span>2. Connect an MCP server</span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              The built-in <strong>Workspace Sandbox</strong> MCP server is pre-connected with 4 tools (notes & calculator). You can add remote HTTPS MCP servers anytime in the Servers tab.
            </p>

            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 p-3.5 flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-slate-900 dark:text-white">
                  {servers[0]?.name ?? 'Workspace Sandbox'}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                  {servers[0]?.tools.length ?? 4} tools ready
                </div>
              </div>
              <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  updateSettings({ onboardingCompleted: true });
                  onComplete('servers');
                }}
                className="flex-1 min-h-[44px] rounded-full border border-slate-200 dark:border-slate-700 text-sm font-medium text-slate-700 dark:text-slate-200"
              >
                Add Remote Server
              </button>
              <button
                type="button"
                onClick={() => setStep(3)}
                style={{
                  backgroundColor: 'var(--m3-primary)',
                  color: 'var(--m3-on-primary)',
                }}
                className="flex-1 min-h-[44px] rounded-full text-sm font-semibold inline-flex items-center justify-center gap-1.5"
              >
                <span>Next</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
              <MessageSquare className="w-4 h-4 text-blue-600" />
              <span>3. Ready to chat with MCP tools</span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              Write actions ask for your approval before running, you can switch agents or effort mid-chat, and all history stays locally on your device.
            </p>
            <button
              type="button"
              onClick={handleFinish}
              style={{
                backgroundColor: 'var(--m3-primary)',
                color: 'var(--m3-on-primary)',
              }}
              className="w-full min-h-[48px] rounded-full text-sm font-semibold transition-opacity hover:opacity-90"
            >
              Start Chatting
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
