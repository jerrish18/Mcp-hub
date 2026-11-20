import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Moon,
  Shield,
  Sun,
  Trash2,
  Zap,
} from 'lucide-react';
import { FREE_MODELS, PROVIDER_INFO } from '../../config/models';
import { testModelConnection } from '../../services/llm/provider';
import { useHubStore } from '../../store/useHubStore';
import type { ProviderKeys } from '../../types';
import { triggerHaptic } from '../../utils/haptics';
import { safeErrorMessage } from '../../utils/redact';

export function SettingsScreen() {
  const {
    providerKeys,
    settings,
    setProviderKeys,
    updateSettings,
    revokeAlwaysAllowedTool,
    lockApp,
  } = useHubStore();

  const [geminiKey, setGeminiKey] = useState(providerKeys.gemini ?? '');
  const [groqKey, setGroqKey] = useState(providerKeys.groq ?? '');
  const [openrouterKey, setOpenrouterKey] = useState(providerKeys.openrouter ?? '');
  const [showKeys, setShowKeys] = useState(false);
  const [keysSavedNotice, setKeysSavedNotice] = useState(false);

  const [testModelId, setTestModelId] = useState(FREE_MODELS[0].id);
  const [testingModel, setTestingModel] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    setGeminiKey(providerKeys.gemini ?? '');
    setGroqKey(providerKeys.groq ?? '');
    setOpenrouterKey(providerKeys.openrouter ?? '');
  }, [providerKeys]);

  const handleSaveKeys = async (e: React.FormEvent) => {
    e.preventDefault();
    const next: ProviderKeys = {
      gemini: geminiKey.trim() || undefined,
      groq: groqKey.trim() || undefined,
      openrouter: openrouterKey.trim() || undefined,
    };
    await setProviderKeys(next);
    triggerHaptic(settings.hapticsEnabled, 'success');
    setKeysSavedNotice(true);
    setTimeout(() => setKeysSavedNotice(false), 2000);
  };

  const handleTestModel = async () => {
    setTestingModel(true);
    setTestResult(null);
    try {
      const currentKeys: ProviderKeys = {
        gemini: geminiKey.trim() || providerKeys.gemini,
        groq: groqKey.trim() || providerKeys.groq,
        openrouter: openrouterKey.trim() || providerKeys.openrouter,
      };
      const res = await testModelConnection({
        modelId: testModelId,
        keys: currentKeys,
      });
      setTestResult({
        ok: true,
        text: `Success (${res.latencyMs}ms): ${res.preview}`,
      });
    } catch (err) {
      setTestResult({
        ok: false,
        text: safeErrorMessage(err, [geminiKey, groqKey, openrouterKey]),
      });
    } finally {
      setTestingModel(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-slate-50 dark:bg-slate-950 p-4 sm:p-6">
      <div className="max-w-3xl mx-auto space-y-6 pb-8">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
            Settings
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Encrypted BYOK credentials, model testing, safety confirmations, and device lock
          </p>
        </div>

        {/* Provider API Keys */}
        <form
          onSubmit={handleSaveKeys}
          className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <KeyRound className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              <div>
                <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                  Free-Tier Provider API Keys
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  AES-GCM encrypted locally (expo-secure-store on mobile). Never sent to any proxy.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowKeys((v) => !v)}
              aria-label={showKeys ? 'Hide API keys' : 'Show API keys'}
              className="min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              {showKeys ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>

          <div className="space-y-3">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label htmlFor="key-gemini" className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  Google Gemini API Key
                </label>
                <a
                  href={PROVIDER_INFO.gemini.signupUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                >
                  Get free key
                </a>
              </div>
              <input
                id="key-gemini"
                type={showKeys ? 'text' : 'password'}
                value={geminiKey}
                onChange={(e) => setGeminiKey(e.target.value)}
                placeholder={PROVIDER_INFO.gemini.keyHint}
                className="w-full min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm font-mono text-slate-900 dark:text-white"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label htmlFor="key-groq" className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  Groq API Key
                </label>
                <a
                  href={PROVIDER_INFO.groq.signupUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                >
                  Get free key
                </a>
              </div>
              <input
                id="key-groq"
                type={showKeys ? 'text' : 'password'}
                value={groqKey}
                onChange={(e) => setGroqKey(e.target.value)}
                placeholder={PROVIDER_INFO.groq.keyHint}
                className="w-full min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm font-mono text-slate-900 dark:text-white"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label htmlFor="key-openrouter" className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  OpenRouter API Key
                </label>
                <a
                  href={PROVIDER_INFO.openrouter.signupUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                >
                  Get free key
                </a>
              </div>
              <input
                id="key-openrouter"
                type={showKeys ? 'text' : 'password'}
                value={openrouterKey}
                onChange={(e) => setOpenrouterKey(e.target.value)}
                placeholder={PROVIDER_INFO.openrouter.keyHint}
                className="w-full min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm font-mono text-slate-900 dark:text-white"
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 pt-1">
            <button
              type="submit"
              className="min-h-[44px] px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors"
            >
              Save Encrypted Keys
            </button>
            {keysSavedNotice && (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="w-4 h-4" />
                Saved to vault
              </span>
            )}
          </div>
        </form>

        {/* Test Model */}
        <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                Test Model Connectivity
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Model IDs are centralized in <code className="font-mono">src/config/models.ts</code>
              </p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-2">
            <select
              aria-label="Select model to test"
              value={testModelId}
              onChange={(e) => setTestModelId(e.target.value)}
              className="flex-1 min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm text-slate-900 dark:text-white"
            >
              {FREE_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label} ({m.id})
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleTestModel}
              disabled={testingModel}
              className="min-h-[44px] px-4 rounded-xl bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 dark:hover:bg-slate-700 text-white text-sm font-medium whitespace-nowrap"
            >
              {testingModel ? 'Testing...' : 'Test model'}
            </button>
          </div>

          {testResult && (
            <div
              data-testid="test-model-result"
              className={`rounded-xl px-3.5 py-2.5 text-xs border ${
                testResult.ok
                  ? 'border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300'
                  : 'border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-300'
              }`}
            >
              {testResult.text}
            </div>
          )}
        </section>

        {/* Agent Loop & Tool Safety */}
        <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
              Agent Loop & Safety
            </h2>
          </div>

          <div className="flex items-center justify-between gap-4 min-h-[44px]">
            <div>
              <div className="text-sm font-medium text-slate-900 dark:text-white">
                Confirm before write actions
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Require tap-to-approve for MCP tools without readOnlyHint
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.confirmBeforeWrite}
              aria-label="Confirm before write actions"
              onClick={() => updateSettings({ confirmBeforeWrite: !settings.confirmBeforeWrite })}
              className={`w-12 h-7 rounded-full p-0.5 transition-colors shrink-0 ${
                settings.confirmBeforeWrite ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-700'
              }`}
            >
              <span
                className={`block w-6 h-6 rounded-full bg-white shadow transition-transform ${
                  settings.confirmBeforeWrite ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          <div className="flex items-center justify-between gap-4 min-h-[44px] pt-2 border-t border-slate-100 dark:border-slate-800">
            <div>
              <div className="text-sm font-medium text-slate-900 dark:text-white">
                Max agent loop steps
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Caps consecutive tool-calling turns (default 10)
              </div>
            </div>
            <input
              type="number"
              min={1}
              max={25}
              aria-label="Max agent loop steps"
              value={settings.maxAgentSteps}
              onChange={(e) =>
                updateSettings({
                  maxAgentSteps: Math.max(1, Math.min(25, Number(e.target.value) || 10)),
                })
              }
              className="w-20 min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm text-center tabular-nums font-mono text-slate-900 dark:text-white"
            />
          </div>

          {settings.alwaysAllowedTools.length > 0 && (
            <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2">
              <div className="text-xs font-semibold text-slate-600 dark:text-slate-400">
                Always-allowed write tools
              </div>
              {settings.alwaysAllowedTools.map((key) => (
                <div
                  key={key}
                  className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 text-xs font-mono"
                >
                  <span className="truncate text-slate-700 dark:text-slate-300">{key}</span>
                  <button
                    type="button"
                    onClick={() => revokeAlwaysAllowedTool(key)}
                    aria-label={`Revoke always allow for ${key}`}
                    className="min-h-[36px] px-2 text-rose-600 dark:text-rose-400 hover:underline inline-flex items-center gap-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Revoke
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Appearance & Biometric Lock */}
        <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-slate-900 dark:text-white">Theme</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Follows system preference by default
              </div>
            </div>
            <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800 self-start sm:self-auto">
              {(['system', 'light', 'dark'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => updateSettings({ theme: t })}
                  className={`min-h-[38px] px-3 rounded-lg text-xs font-medium capitalize inline-flex items-center gap-1.5 transition-colors ${
                    settings.theme === t
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {t === 'light' && <Sun className="w-3.5 h-3.5" />}
                  {t === 'dark' && <Moon className="w-3.5 h-3.5" />}
                  <span>{t}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between gap-4 min-h-[44px] pt-2 border-t border-slate-100 dark:border-slate-800">
            <div>
              <div className="text-sm font-medium text-slate-900 dark:text-white">Haptic feedback</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Subtle vibration on send, approvals, and toggles
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.hapticsEnabled}
              aria-label="Haptic feedback"
              onClick={() => updateSettings({ hapticsEnabled: !settings.hapticsEnabled })}
              className={`w-12 h-7 rounded-full p-0.5 transition-colors shrink-0 ${
                settings.hapticsEnabled ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-700'
              }`}
            >
              <span
                className={`block w-6 h-6 rounded-full bg-white shadow transition-transform ${
                  settings.hapticsEnabled ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          <div className="flex items-center justify-between gap-4 min-h-[44px] pt-2 border-t border-slate-100 dark:border-slate-800">
            <div>
              <div className="text-sm font-medium text-slate-900 dark:text-white">
                App Lock on open
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Biometric prompt on Expo mobile / lock gate on web
              </div>
            </div>
            <div className="flex items-center gap-2">
              {settings.biometricLockEnabled && (
                <button
                  type="button"
                  onClick={lockApp}
                  className="min-h-[38px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium inline-flex items-center gap-1"
                >
                  <Lock className="w-3.5 h-3.5" />
                  Lock Now
                </button>
              )}
              <button
                type="button"
                role="switch"
                aria-checked={settings.biometricLockEnabled}
                aria-label="App Lock on open"
                onClick={() => updateSettings({ biometricLockEnabled: !settings.biometricLockEnabled })}
                className={`w-12 h-7 rounded-full p-0.5 transition-colors shrink-0 ${
                  settings.biometricLockEnabled ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-700'
                }`}
              >
                <span
                  className={`block w-6 h-6 rounded-full bg-white shadow transition-transform ${
                    settings.biometricLockEnabled ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
