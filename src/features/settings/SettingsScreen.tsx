import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import {
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  LogIn,
  LogOut,
  Moon,
  Palette,
  Plus,
  RefreshCw,
  Shield,
  Sun,
  Trash2,
  UserCheck,
  Zap,
} from 'lucide-react';
import { PROVIDER_INFO } from '../../config/models';
import { mergeModelCatalog, testModelConnection } from '../../services/llm/provider';
import { useHubStore } from '../../store/useHubStore';
import type {
  A2uiMode,
  PixelAccentTheme,
  ProviderId,
  ProviderKeys,
  ToolPermissionPolicy,
} from '../../types';
import { M3Switch } from '../../ui/M3Switch';
import { resolveA2uiMode } from '../../utils/a2ui';
import { triggerHaptic } from '../../utils/haptics';
import { cardStaggerContainer, cardStaggerItem } from '../../utils/motion';
import { safeErrorMessage } from '../../utils/redact';
import { getProviderQuotaStatus } from '../../utils/quotaTracker';
import { PIXEL_PALETTES } from '../../utils/theme';
import { AppApiKeySection } from './AppApiKeySection';

export function SettingsScreen() {
  const {
    authUser,
    syncStatus,
    syncError,
    providerKeys,
    dynamicModels,
    settings,
    passphraseVaultEnabled,
    setProviderKeys,
    syncModels,
    addCustomModel,
    updateSettings,
    revokeAlwaysAllowedTool,
    revokeAlwaysAllowedRule,
    addToolPolicy,
    removeToolPolicy,
    lockApp,
    enableVaultPassphrase,
    disableVaultPassphrase,
    lockVaultSession,
    signOutAccount,
    syncWorkspaceNow,
  } = useHubStore();

  const allModels = mergeModelCatalog(dynamicModels);

  const [geminiKey, setGeminiKey] = useState(providerKeys.gemini ?? '');
  const [groqKey, setGroqKey] = useState(providerKeys.groq ?? '');
  const [openrouterKey, setOpenrouterKey] = useState(providerKeys.openrouter ?? '');
  const [showKeys, setShowKeys] = useState(false);
  const [keysSavedNotice, setKeysSavedNotice] = useState(false);

  const [testModelId, setTestModelId] = useState(allModels[0]?.id ?? 'gemini-4-hydrogen');
  const [testingModel, setTestingModel] = useState(false);
  const [syncingModels, setSyncingModels] = useState(false);
  const [syncNotice, setSyncNotice] = useState('');
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    text: string;
    isTransientOrMissing?: boolean;
  } | null>(null);

  const [customProvider, setCustomProvider] = useState<ProviderId>('openrouter');
  const [customSlug, setCustomSlug] = useState('');
  const [newVaultPassphrase, setNewVaultPassphrase] = useState('');
  const [vaultStatusMsg, setVaultStatusMsg] = useState('');
  const [vaultBusy, setVaultBusy] = useState(false);

  const [policyToolKey, setPolicyToolKey] = useState('');
  const [policyLevel, setPolicyLevel] = useState<ToolPermissionPolicy>('ask');
  const [policyArgPattern, setPolicyArgPattern] = useState('');

  useEffect(() => {
    setGeminiKey(providerKeys.gemini ?? '');
    setGroqKey(providerKeys.groq ?? '');
    setOpenrouterKey(providerKeys.openrouter ?? '');
  }, [providerKeys]);

  const currentKeysPayload = (): ProviderKeys => ({
    gemini: geminiKey.trim() || providerKeys.gemini,
    groq: groqKey.trim() || providerKeys.groq,
    openrouter: openrouterKey.trim() || providerKeys.openrouter,
  });

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

  const handleSyncLiveModels = async () => {
    setSyncingModels(true);
    setSyncNotice('');
    try {
      const res = await syncModels(currentKeysPayload());
      if (res.count > 0) {
        setSyncNotice(`Synced ${res.count} live models from ${res.providers.join(', ')}.`);
        triggerHaptic(settings.hapticsEnabled, 'success');
      } else {
        setSyncNotice('Add an API key above first to sync live models from your account.');
      }
    } catch (err) {
      setSyncNotice(safeErrorMessage(err));
    } finally {
      setSyncingModels(false);
    }
  };

  const handleAddCustomModel = (e: React.FormEvent) => {
    e.preventDefault();
    const slug = customSlug.trim();
    if (!slug) return;
    addCustomModel(customProvider, slug);
    setTestModelId(slug);
    setCustomSlug('');
    triggerHaptic(settings.hapticsEnabled, 'success');
  };

  const effectiveTestModelId = allModels.some((m) => m.id === testModelId)
    ? testModelId
    : (allModels[0]?.id ?? 'gemini-4-hydrogen');

  const handleTestModel = async (overrideId?: string) => {
    const targetId = overrideId ?? effectiveTestModelId;
    setTestingModel(true);
    setTestResult(null);
    try {
      const res = await testModelConnection({
        modelId: targetId,
        keys: currentKeysPayload(),
        dynamicModels,
      });
      setTestResult({
        ok: true,
        text: `Success (${res.latencyMs}ms): ${res.preview}`,
      });
      triggerHaptic(settings.hapticsEnabled, 'success');
    } catch (err) {
      const msg = safeErrorMessage(err, [geminiKey, groqKey, openrouterKey]);
      const isTransientOrMissing =
        msg.includes('503') || msg.includes('404') || msg.toLowerCase().includes('unavailable');
      setTestResult({
        ok: false,
        text: msg,
        isTransientOrMissing,
      });
      triggerHaptic(settings.hapticsEnabled, 'warning');
    } finally {
      setTestingModel(false);
    }
  };

  return (
    <div
      style={{ backgroundColor: 'var(--m3-surface)' }}
      className="h-full overflow-y-auto p-4 sm:p-6"
    >
      <motion.div
        variants={cardStaggerContainer}
        initial="initial"
        animate="animate"
        className="max-w-3xl mx-auto space-y-5 pb-10"
      >
        <motion.div variants={cardStaggerItem}>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
            Settings
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Account sign-in, Pixel Material You appearance, encrypted API keys & safety
          </p>
        </motion.div>

        {/* Account & Sign-In Section */}
        <motion.section
          variants={cardStaggerItem}
          style={{
            backgroundColor: 'var(--m3-surface-container)',
            borderColor: 'var(--m3-outline)',
          }}
          className="rounded-[24px] border p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
        >
          <div className="flex items-center gap-3 min-w-0">
            {authUser?.photoURL ? (
              <img
                src={authUser.photoURL}
                alt={authUser.displayName}
                className="w-11 h-11 rounded-2xl object-cover shrink-0"
              />
            ) : (
              <div
                style={{
                  backgroundColor: 'var(--m3-primary-container)',
                  color: 'var(--m3-on-primary-container)',
                }}
                className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0"
              >
                <UserCheck className="w-5 h-5" />
              </div>
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white truncate">
                  {authUser ? authUser.displayName : 'Local Guest Session'}
                </h2>
                {authUser && (
                  <span
                    style={{
                      backgroundColor: 'var(--m3-primary-container)',
                      color: 'var(--m3-on-primary-container)',
                    }}
                    className="px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase"
                  >
                    {authUser.provider === 'google' ? 'Google' : 'App Account'}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                {authUser
                  ? authUser.email
                  : 'Sign in with Google or an App account to personalize your hub'}
              </p>
              {authUser && (
                <p
                  data-testid="account-sync-status"
                  className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mt-0.5 truncate"
                >
                  {syncStatus === 'syncing'
                    ? 'Syncing account database…'
                    : syncStatus === 'error'
                      ? `Sync notice: ${syncError || 'Offline or pending retry'}`
                      : 'Cloud & account workspace synced across sessions'}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            {authUser && (
              <button
                type="button"
                data-testid="account-sync-now-btn"
                disabled={syncStatus === 'syncing'}
                onClick={() => void syncWorkspaceNow()}
                style={{
                  backgroundColor: 'var(--m3-primary-container)',
                  color: 'var(--m3-on-primary-container)',
                }}
                className="min-h-[42px] px-3.5 rounded-full text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-60 hover:opacity-90"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${syncStatus === 'syncing' ? 'animate-spin' : ''}`} />
                <span>{syncStatus === 'syncing' ? 'Syncing…' : 'Sync now'}</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => void signOutAccount()}
              style={{
                backgroundColor: 'var(--m3-surface-container-high)',
                borderColor: 'var(--m3-outline)',
              }}
              className="min-h-[42px] px-4 rounded-full border text-xs font-semibold text-slate-900 dark:text-white inline-flex items-center justify-center gap-1.5 shrink-0 hover:opacity-90"
            >
              {authUser ? (
                <>
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Sign Out</span>
                </>
              ) : (
                <>
                  <LogIn className="w-3.5 h-3.5" />
                  <span>Sign In / Google</span>
                </>
              )}
            </button>
          </div>
        </motion.section>

        {/* Pixel Material You & Appearance Studio */}
        <motion.section
          variants={cardStaggerItem}
          style={{
            backgroundColor: 'var(--m3-surface-container)',
            borderColor: 'var(--m3-outline)',
          }}
          className="rounded-[24px] border p-5 space-y-4"
        >
          <div className="flex items-center gap-2.5">
            <Palette style={{ color: 'var(--m3-primary)' }} className="w-5 h-5 shrink-0" />
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                Pixel Material You
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Dynamic color palette & OLED dark surfaces
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {(Object.keys(PIXEL_PALETTES) as PixelAccentTheme[]).map((key) => {
              const p = PIXEL_PALETTES[key];
              const active = (settings.accentTheme ?? 'pixel_blue') === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    updateSettings({ accentTheme: key });
                    triggerHaptic(settings.hapticsEnabled, 'light');
                  }}
                  style={
                    active
                      ? {
                          backgroundColor: 'var(--m3-primary-container)',
                          color: 'var(--m3-on-primary-container)',
                          borderColor: 'var(--m3-primary)',
                        }
                      : {
                          backgroundColor: 'var(--m3-surface-container-high)',
                          borderColor: 'var(--m3-outline)',
                        }
                  }
                  className="min-h-[42px] px-3 py-1.5 rounded-full border text-xs font-medium inline-flex items-center gap-2 transition-colors"
                >
                  <span
                    style={{ backgroundColor: p.swatch }}
                    className="w-4 h-4 rounded-full shrink-0 border border-white/40"
                  />
                  <span>{p.label}</span>
                </button>
              );
            })}
          </div>

          <label className="block text-sm font-medium">Desktop chat layout
            <select value={settings.chatLayout ?? 'standard'} onChange={event => updateSettings({ chatLayout: event.target.value === 'focus' ? 'focus' : 'standard' })} className="block mt-1 min-h-[44px] w-full rounded-xl border bg-transparent px-3 text-xs">
              <option value="standard">Standard — show conversation sidebar</option>
              <option value="focus">Focus — hide conversation sidebar</option>
            </select>
          </label>

          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-2 border-t border-slate-200/60 dark:border-slate-800">
            <div>
              <div className="text-sm font-medium text-slate-900 dark:text-white">Theme Mode</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Follows Android system dark theme by default
              </div>
            </div>
            <div
              style={{ backgroundColor: 'var(--m3-surface-container-high)' }}
              className="flex items-center gap-1 p-1 rounded-full self-start sm:self-auto"
            >
              {(['system', 'light', 'dark'] as const).map((t) => {
                const active = settings.theme === t;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => updateSettings({ theme: t })}
                    style={
                      active
                        ? {
                            backgroundColor: 'var(--m3-primary-container)',
                            color: 'var(--m3-on-primary-container)',
                          }
                        : undefined
                    }
                    className={`min-h-[38px] px-3.5 rounded-full text-xs font-semibold capitalize inline-flex items-center gap-1.5 transition-colors ${
                      active ? 'shadow-xs' : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    {t === 'light' && <Sun className="w-3.5 h-3.5" />}
                    {t === 'dark' && <Moon className="w-3.5 h-3.5" />}
                    <span>{t}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-between gap-4 min-h-[44px] pt-2 border-t border-slate-200/60 dark:border-slate-800">
            <div>
              <div className="text-sm font-medium text-slate-900 dark:text-white">
                OLED Pure Black Dark Mode
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                True #000000 background for Pixel 8 OLED battery savings
              </div>
            </div>
            <M3Switch
              checked={Boolean(settings.oledDark)}
              ariaLabel="OLED Pure Black Dark Mode"
              onChange={() => updateSettings({ oledDark: !settings.oledDark })}
            />
          </div>
        </motion.section>

        {/* Provider API Keys */}
        <motion.form
          variants={cardStaggerItem}
          onSubmit={handleSaveKeys}
          style={{
            backgroundColor: 'var(--m3-surface-container)',
            borderColor: 'var(--m3-outline)',
          }}
          className="rounded-[24px] border p-5 space-y-4"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <KeyRound style={{ color: 'var(--m3-primary)' }} className="w-5 h-5 shrink-0" />
              <div className="min-w-0">
                <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                  Free-Tier Provider API Keys
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  AES-GCM encrypted locally (expo-secure-store on mobile). Direct HTTPS only.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowKeys((v) => !v)}
              aria-label={showKeys ? 'Hide API keys' : 'Show API keys'}
              className="min-h-[44px] min-w-[44px] rounded-full flex items-center justify-center text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-slate-800"
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
                  style={{ color: 'var(--m3-primary)' }}
                  className="text-xs hover:underline"
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
                style={{
                  backgroundColor: 'var(--m3-surface)',
                  borderColor: 'var(--m3-outline)',
                }}
                className="w-full min-h-[44px] px-3.5 rounded-2xl border text-sm font-mono text-slate-900 dark:text-white"
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
                  style={{ color: 'var(--m3-primary)' }}
                  className="text-xs hover:underline"
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
                style={{
                  backgroundColor: 'var(--m3-surface)',
                  borderColor: 'var(--m3-outline)',
                }}
                className="w-full min-h-[44px] px-3.5 rounded-2xl border text-sm font-mono text-slate-900 dark:text-white"
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
                  style={{ color: 'var(--m3-primary)' }}
                  className="text-xs hover:underline"
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
                style={{
                  backgroundColor: 'var(--m3-surface)',
                  borderColor: 'var(--m3-outline)',
                }}
                className="w-full min-h-[44px] px-3.5 rounded-2xl border text-sm font-mono text-slate-900 dark:text-white"
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 pt-1">
            <button
              type="submit"
              style={{
                backgroundColor: 'var(--m3-primary)',
                color: 'var(--m3-on-primary)',
              }}
              className="min-h-[44px] px-5 rounded-full text-sm font-semibold transition-opacity hover:opacity-90"
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

          {/* Optional PBKDF2 Passphrase Protection */}
          <div className="pt-3 border-t border-slate-200/60 dark:border-slate-800 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-xs font-semibold text-slate-900 dark:text-white">
                  Passphrase-Derived Vault Key (PBKDF2-SHA256)
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  {passphraseVaultEnabled
                    ? 'Active: encryption key stays in memory only and locks on reload.'
                    : 'Optional: replace the localStorage device key with an in-memory passphrase key.'}
                </div>
              </div>
              {passphraseVaultEnabled && (
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={lockVaultSession}
                    className="min-h-[34px] px-3 rounded-full border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-800 dark:text-slate-200 inline-flex items-center gap-1"
                  >
                    <Lock className="w-3 h-3" />
                    Lock Vault
                  </button>
                  <button
                    type="button"
                    disabled={vaultBusy}
                    onClick={async () => {
                      setVaultBusy(true);
                      setVaultStatusMsg('');
                      try {
                        await disableVaultPassphrase();
                        setVaultStatusMsg('Passphrase protection disabled; migrated keys to device key.');
                      } catch (err) {
                        setVaultStatusMsg(safeErrorMessage(err));
                      } finally {
                        setVaultBusy(false);
                      }
                    }}
                    className="min-h-[34px] px-3 rounded-full border border-rose-300 dark:border-rose-800 text-xs font-semibold text-rose-700 dark:text-rose-300"
                  >
                    Disable
                  </button>
                </div>
              )}
            </div>

            {!passphraseVaultEnabled && (
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="password"
                  value={newVaultPassphrase}
                  onChange={(e) => setNewVaultPassphrase(e.target.value)}
                  placeholder="Set vault passphrase (min 6 chars)"
                  aria-label="Set vault passphrase"
                  style={{
                    backgroundColor: 'var(--m3-surface)',
                    borderColor: 'var(--m3-outline)',
                  }}
                  className="flex-1 min-h-[40px] px-3 rounded-2xl border text-xs text-slate-900 dark:text-white"
                />
                <button
                  type="button"
                  disabled={vaultBusy || newVaultPassphrase.trim().length < 6}
                  onClick={async () => {
                    setVaultBusy(true);
                    setVaultStatusMsg('');
                    try {
                      await enableVaultPassphrase(newVaultPassphrase.trim());
                      setNewVaultPassphrase('');
                      setVaultStatusMsg('PBKDF2 passphrase vault enabled and secrets migrated.');
                    } catch (err) {
                      setVaultStatusMsg(safeErrorMessage(err));
                    } finally {
                      setVaultBusy(false);
                    }
                  }}
                  style={{
                    backgroundColor: 'var(--m3-primary-container)',
                    color: 'var(--m3-on-primary-container)',
                  }}
                  className="min-h-[40px] px-4 rounded-full text-xs font-semibold disabled:opacity-50"
                >
                  {vaultBusy ? 'Encrypting...' : 'Enable Passphrase'}
                </button>
              </div>
            )}

            {vaultStatusMsg && (
              <div className="text-[11px] text-slate-600 dark:text-slate-300">{vaultStatusMsg}</div>
            )}
          </div>
        </motion.form>

        {/* App API & External Agent Control */}
        <motion.div variants={cardStaggerItem}>
          <AppApiKeySection />
        </motion.div>

        {/* Live Model Sync & Connectivity Test */}
        <motion.section
          variants={cardStaggerItem}
          style={{
            backgroundColor: 'var(--m3-surface-container)',
            borderColor: 'var(--m3-outline)',
          }}
          className="rounded-[24px] border p-5 space-y-4"
        >
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <Zap style={{ color: 'var(--m3-primary)' }} className="w-5 h-5 shrink-0" />
              <div className="min-w-0">
                <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                  Models & Connectivity
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Auto-fallback triggers on 429, 503 high demand, or 404 deprecated slugs
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void handleSyncLiveModels()}
              disabled={syncingModels}
              style={{
                backgroundColor: 'var(--m3-primary-container)',
                color: 'var(--m3-on-primary-container)',
              }}
              className="min-h-[40px] px-3.5 rounded-full text-xs font-semibold inline-flex items-center gap-1.5 self-start sm:self-auto"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncingModels ? 'animate-spin' : ''}`} />
              <span>{syncingModels ? 'Syncing...' : 'Sync live models'}</span>
            </button>
          </div>

          {syncNotice && (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3.5 py-2 text-xs text-slate-700 dark:text-slate-200">
              {syncNotice}
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-2">
            <select
              aria-label="Select model to test"
              value={effectiveTestModelId}
              onChange={(e) => setTestModelId(e.target.value)}
              style={{
                backgroundColor: 'var(--m3-surface)',
                borderColor: 'var(--m3-outline)',
              }}
              className="flex-1 min-w-0 min-h-[44px] px-3 rounded-2xl border text-sm text-slate-900 dark:text-white"
            >
              {allModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void handleTestModel()}
              disabled={testingModel}
              style={{
                backgroundColor: 'var(--m3-surface-container-high)',
                borderColor: 'var(--m3-outline)',
              }}
              className="min-h-[44px] px-5 rounded-full border text-slate-900 dark:text-white text-sm font-semibold whitespace-nowrap"
            >
              {testingModel ? 'Testing...' : 'Test model'}
            </button>
          </div>

          {testResult && (
            <div
              data-testid="test-model-result"
              className={`rounded-2xl px-3.5 py-3 text-xs border [overflow-wrap:anywhere] overflow-hidden space-y-2 ${
                testResult.ok
                  ? 'border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300'
                  : 'border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-200'
              }`}
            >
              <div className="[overflow-wrap:anywhere] leading-relaxed">{testResult.text}</div>
              {testResult.isTransientOrMissing && (
                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setTestModelId('gemini-3.1-flash-lite');
                      void handleTestModel('gemini-3.1-flash-lite');
                    }}
                    className="px-3 py-1.5 rounded-full bg-white/80 dark:bg-slate-900 text-slate-900 dark:text-white font-semibold border border-rose-200 dark:border-rose-800"
                  >
                    Test Gemini Flash-Lite
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSyncLiveModels()}
                    className="px-3 py-1.5 rounded-full bg-white/80 dark:bg-slate-900 text-slate-900 dark:text-white font-semibold border border-rose-200 dark:border-rose-800"
                  >
                    Sync Live Models
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Free-Tier Quota Meter */}
          <div className="pt-2 border-t border-slate-200/60 dark:border-slate-800 space-y-2.5" data-testid="free-tier-quota-meter">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                Free-Tier Rate & Daily Quota Monitor
              </span>
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                Tracked locally on this device
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              {(['gemini', 'groq', 'openrouter'] as const).map((prov) => {
                const status = getProviderQuotaStatus(prov);
                if (!status) return null;
                const rpmPct = Math.min(100, Math.round((status.rpmUsed / Math.max(1, status.rpmLimit)) * 100));
                const rpdPct = Math.min(100, Math.round((status.rpdUsed / Math.max(1, status.rpdLimit)) * 100));
                return (
                  <div
                    key={prov}
                    style={{
                      backgroundColor: 'var(--m3-surface)',
                      borderColor: status.rateLimitedRecently
                        ? '#f43f5e'
                        : status.nearLimit
                          ? '#f59e0b'
                          : 'var(--m3-outline)',
                    }}
                    className="rounded-2xl border p-3 space-y-2"
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-xs font-semibold text-slate-900 dark:text-white">
                        {PROVIDER_INFO[prov].name}
                      </span>
                      {status.rateLimitedRecently ? (
                        <span className="text-[10px] font-semibold text-rose-600 dark:text-rose-400">
                          429 active
                        </span>
                      ) : status.nearLimit ? (
                        <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                          Near limit
                        </span>
                      ) : (
                        <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
                          Healthy
                        </span>
                      )}
                    </div>
                    <div className="space-y-1 text-[11px] tabular-nums">
                      <div className="flex justify-between text-slate-600 dark:text-slate-300">
                        <span>RPM (60s)</span>
                        <span>
                          {status.rpmUsed}/{status.rpmLimit}
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            status.rateLimitedRecently
                              ? 'bg-rose-500'
                              : status.nearLimit
                                ? 'bg-amber-500'
                                : 'bg-blue-500'
                          }`}
                          style={{ width: `${rpmPct}%` }}
                        />
                      </div>
                      <div className="flex justify-between text-slate-500 dark:text-slate-400 pt-0.5">
                        <span>Today (RPD)</span>
                        <span>
                          {status.rpdUsed}/{status.rpdLimit}
                        </span>
                      </div>
                      <div className="h-1 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-emerald-500"
                          style={{ width: `${rpdPct}%` }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Add Custom Model Slug */}
          <form onSubmit={handleAddCustomModel} className="pt-2 border-t border-slate-200/60 dark:border-slate-800 space-y-2">
            <div className="text-xs font-medium text-slate-600 dark:text-slate-400">
              Add custom model slug
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <select
                aria-label="Custom model provider"
                value={customProvider}
                onChange={(e) => setCustomProvider(e.target.value as ProviderId)}
                style={{
                  backgroundColor: 'var(--m3-surface)',
                  borderColor: 'var(--m3-outline)',
                }}
                className="sm:w-36 min-h-[42px] px-3 rounded-2xl border text-xs text-slate-900 dark:text-white"
              >
                <option value="gemini">Gemini</option>
                <option value="groq">Groq</option>
                <option value="openrouter">OpenRouter</option>
              </select>
              <input
                type="text"
                value={customSlug}
                onChange={(e) => setCustomSlug(e.target.value)}
                placeholder="e.g. openrouter/free or qwen/qwen3.7-plus:free"
                style={{
                  backgroundColor: 'var(--m3-surface)',
                  borderColor: 'var(--m3-outline)',
                }}
                className="flex-1 min-h-[42px] px-3 rounded-2xl border text-xs font-mono text-slate-900 dark:text-white"
              />
              <button
                type="submit"
                disabled={!customSlug.trim()}
                className="min-h-[42px] px-4 rounded-full bg-slate-900 dark:bg-slate-800 disabled:opacity-40 text-white text-xs font-semibold inline-flex items-center justify-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add</span>
              </button>
            </div>
          </form>
        </motion.section>

        {/* Agent Loop & Safety */}
        <motion.section
          variants={cardStaggerItem}
          style={{
            backgroundColor: 'var(--m3-surface-container)',
            borderColor: 'var(--m3-outline)',
          }}
          className="rounded-[24px] border p-5 space-y-4"
        >
          <div className="flex items-center gap-2.5">
            <Shield style={{ color: 'var(--m3-primary)' }} className="w-5 h-5 shrink-0" />
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
            <M3Switch
              checked={settings.confirmBeforeWrite}
              ariaLabel="Confirm before write actions"
              onChange={() => updateSettings({ confirmBeforeWrite: !settings.confirmBeforeWrite })}
            />
          </div>

          <div className="space-y-2.5 pt-2 border-t border-slate-200/60 dark:border-slate-800">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <div className="text-sm font-medium text-slate-900 dark:text-white">
                  Interactive A2UI Widgets
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  Smart (default) renders cards, checklists & forms only when structured input/output helps — saving tokens on simple chat.
                </div>
              </div>
              <div
                role="radiogroup"
                aria-label="Interactive A2UI widget mode"
                data-testid="settings-a2ui-mode-group"
                style={{
                  backgroundColor: 'var(--m3-surface)',
                  borderColor: 'var(--m3-outline)',
                }}
                className="inline-flex rounded-2xl border p-1 gap-1 shrink-0"
              >
                {(
                  [
                    { id: 'off', label: 'Off' },
                    { id: 'smart', label: 'Smart' },
                    { id: 'always', label: 'Always' },
                  ] as Array<{ id: A2uiMode; label: string }>
                ).map((opt) => {
                  const currentA2uiMode = resolveA2uiMode(settings);
                  const active = currentA2uiMode === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      data-testid={`settings-a2ui-${opt.id}`}
                      onClick={() => {
                        triggerHaptic(settings.hapticsEnabled, 'light');
                        updateSettings({
                          a2uiMode: opt.id,
                          a2uiEnabled: opt.id !== 'off',
                        });
                      }}
                      style={
                        active
                          ? {
                              backgroundColor: 'var(--m3-primary-container)',
                              color: 'var(--m3-on-primary-container)',
                            }
                          : undefined
                      }
                      className={`min-h-[44px] px-3.5 rounded-xl text-xs font-semibold transition-colors ${
                        active
                          ? 'shadow-xs'
                          : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between gap-4 min-h-[44px] pt-2 border-t border-slate-200/60 dark:border-slate-800">
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
              className="w-20 min-h-[44px] px-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-center tabular-nums font-mono text-slate-900 dark:text-white"
            />
          </div>

          <div className="flex items-center justify-between gap-4 min-h-[44px] pt-2 border-t border-slate-200/60 dark:border-slate-800">
            <div>
              <div className="text-sm font-medium text-slate-900 dark:text-white">
                Tool output budget (chars)
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Truncates oversized MCP responses before LLM context (1,000–32,000)
              </div>
            </div>
            <input
              type="number"
              min={1000}
              max={32000}
              step={500}
              aria-label="Tool output budget characters"
              value={settings.toolOutputBudgetChars ?? 8000}
              onChange={(e) =>
                updateSettings({
                  toolOutputBudgetChars: Math.max(
                    1000,
                    Math.min(32000, Number(e.target.value) || 8000)
                  ),
                })
              }
              className="w-24 min-h-[44px] px-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-center tabular-nums font-mono text-slate-900 dark:text-white"
            />
          </div>

          <div className="flex items-center justify-between gap-4 min-h-[44px] pt-2 border-t border-slate-200/60 dark:border-slate-800">
            <div>
              <div className="text-sm font-medium text-slate-900 dark:text-white">Haptic feedback</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Pixel tactile feedback on send, approvals, and toggles
              </div>
            </div>
            <M3Switch
              checked={settings.hapticsEnabled}
              ariaLabel="Haptic feedback"
              onChange={() => updateSettings({ hapticsEnabled: !settings.hapticsEnabled })}
            />
          </div>

          <div className="flex items-center justify-between gap-4 min-h-[44px] pt-2 border-t border-slate-200/60 dark:border-slate-800">
            <div>
              <div className="text-sm font-medium text-slate-900 dark:text-white">
                App Lock on open
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Android BiometricPrompt on mobile / lock gate on web
              </div>
            </div>
            <div className="flex items-center gap-2">
              {settings.biometricLockEnabled && (
                <button
                  type="button"
                  onClick={lockApp}
                  className="min-h-[38px] px-3 rounded-full border border-slate-300 dark:border-slate-700 text-xs font-medium inline-flex items-center gap-1"
                >
                  <Lock className="w-3.5 h-3.5" />
                  Lock
                </button>
              )}
              <M3Switch
                checked={settings.biometricLockEnabled}
                ariaLabel="App Lock on open"
                onChange={() => updateSettings({ biometricLockEnabled: !settings.biometricLockEnabled })}
              />
            </div>
          </div>

          {/* Per-Tool Permission Policies */}
          <div className="pt-3 border-t border-slate-200/60 dark:border-slate-800 space-y-2.5">
            <div>
              <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Per-tool permission policies
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                Set allow / ask / deny overrides per tool key (e.g. srv_github:github_push_file) and optional argument pattern.
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
              <input
                type="text"
                value={policyToolKey}
                onChange={(e) => setPolicyToolKey(e.target.value)}
                placeholder="serverId:toolName or toolName"
                aria-label="Tool policy key"
                style={{
                  backgroundColor: 'var(--m3-surface)',
                  borderColor: 'var(--m3-outline)',
                }}
                className="sm:col-span-5 min-h-[40px] px-3 rounded-2xl border text-xs font-mono text-slate-900 dark:text-white"
              />
              <select
                aria-label="Tool policy level"
                value={policyLevel}
                onChange={(e) => setPolicyLevel(e.target.value as ToolPermissionPolicy)}
                style={{
                  backgroundColor: 'var(--m3-surface)',
                  borderColor: 'var(--m3-outline)',
                }}
                className="sm:col-span-2 min-h-[40px] px-2.5 rounded-2xl border text-xs text-slate-900 dark:text-white"
              >
                <option value="ask">Ask</option>
                <option value="allow">Allow</option>
                <option value="deny">Deny</option>
              </select>
              <input
                type="text"
                value={policyArgPattern}
                onChange={(e) => setPolicyArgPattern(e.target.value)}
                placeholder="Optional arg pattern (*main*)"
                aria-label="Tool policy argument pattern"
                style={{
                  backgroundColor: 'var(--m3-surface)',
                  borderColor: 'var(--m3-outline)',
                }}
                className="sm:col-span-3 min-h-[40px] px-3 rounded-2xl border text-xs font-mono text-slate-900 dark:text-white"
              />
              <button
                type="button"
                disabled={!policyToolKey.trim()}
                onClick={() => {
                  addToolPolicy({
                    qualifiedKey: policyToolKey.trim(),
                    policy: policyLevel,
                    argPattern: policyArgPattern.trim() || undefined,
                  });
                  setPolicyToolKey('');
                  setPolicyArgPattern('');
                }}
                style={{
                  backgroundColor: 'var(--m3-primary-container)',
                  color: 'var(--m3-on-primary-container)',
                }}
                className="sm:col-span-2 min-h-[40px] px-3 rounded-full text-xs font-semibold disabled:opacity-40"
              >
                Add Rule
              </button>
            </div>
            {(settings.toolPolicies ?? []).length > 0 && (
              <div className="space-y-1.5">
                {(settings.toolPolicies ?? []).map((rule, idx) => (
                  <div
                    key={`${rule.qualifiedKey}-${rule.argPattern ?? 'any'}-${idx}`}
                    className="flex items-center justify-between gap-2 px-3 py-2 rounded-2xl bg-white dark:bg-slate-950 text-xs"
                  >
                    <div className="min-w-0 flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-slate-800 dark:text-slate-200 truncate">
                        {rule.qualifiedKey}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                          rule.policy === 'deny'
                            ? 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
                            : rule.policy === 'allow'
                              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                              : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                        }`}
                      >
                        {rule.policy}
                      </span>
                      {rule.argPattern && (
                        <span className="font-mono text-[11px] text-slate-500">
                          args~{rule.argPattern}
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => removeToolPolicy(idx)}
                      aria-label={`Remove policy for ${rule.qualifiedKey}`}
                      className="min-h-[34px] px-2 text-rose-600 dark:text-rose-400 hover:underline inline-flex items-center gap-1 shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {((settings.alwaysAllowedRules ?? []).length > 0 || settings.alwaysAllowedTools.length > 0) && (
            <div className="pt-3 border-t border-slate-200/60 dark:border-slate-800 space-y-2">
              <div className="text-xs font-semibold text-slate-600 dark:text-slate-400">
                Always-allowed write tools
              </div>
              {(settings.alwaysAllowedRules ?? []).map((rule, idx) => {
                const remainingMs = rule.expiresAt ? rule.expiresAt - Date.now() : null;
                const expiryLabel =
                  rule.expiresAt == null
                    ? 'Never expires'
                    : remainingMs && remainingMs > 0
                      ? remainingMs >= 86400000
                        ? `Expires in ${Math.ceil(remainingMs / 86400000)}d`
                        : remainingMs >= 3600000
                          ? `Expires in ${Math.ceil(remainingMs / 3600000)}h`
                          : `Expires in ${Math.max(1, Math.ceil(remainingMs / 60000))}m`
                      : 'Expired';
                return (
                  <div
                    key={`${rule.qualifiedKey}-${idx}`}
                    className="flex items-center justify-between gap-2 px-3 py-2 rounded-2xl bg-white dark:bg-slate-950 text-xs font-mono"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-slate-700 dark:text-slate-300">
                        {rule.qualifiedKey}
                      </div>
                      <div className="text-[11px] text-slate-500 tabular-nums">
                        {expiryLabel}
                        {rule.argPattern ? ` · args~${rule.argPattern}` : ''}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => revokeAlwaysAllowedRule(idx)}
                      aria-label={`Revoke always allow rule for ${rule.qualifiedKey}`}
                      className="min-h-[36px] px-2 text-rose-600 dark:text-rose-400 hover:underline inline-flex items-center gap-1 shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Revoke
                    </button>
                  </div>
                );
              })}
              {settings.alwaysAllowedTools
                .filter(
                  (key) => !(settings.alwaysAllowedRules ?? []).some((r) => r.qualifiedKey === key)
                )
                .map((key) => (
                  <div
                    key={key}
                    className="flex items-center justify-between gap-2 px-3 py-2 rounded-2xl bg-white dark:bg-slate-950 text-xs font-mono"
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
        </motion.section>
      </motion.div>
    </div>
  );
}
