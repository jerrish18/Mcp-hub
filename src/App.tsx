import { lazy, Suspense, useEffect, useState } from 'react';
import { MotionConfig } from 'motion/react';
import { useShallow } from 'zustand/react/shallow';
import { Bot, ChevronRight, Fingerprint, KeyRound, LayoutDashboard, MessageSquare, Server, Settings, UserRound, Workflow } from 'lucide-react';
import { AuthScreen } from './features/auth/AuthScreen';
import { OnboardingModal } from './features/onboarding/OnboardingModal';
import { parseMcpAddDeepLink } from './config/connectors';
import { subscribeGoogleAuth } from './services/auth/appAuth';
import { startBrowserControlBridge } from './services/control/browserBridge';
import { useHubStore, type HubTabId } from './store/useHubStore';
import { CATALOG_TTL } from './services/llm/freeRegistry';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { applyPixelThemeVars } from './utils/theme';

const AgentsScreen = lazy(() => import('./features/agents/AgentsScreen').then(module => ({ default: module.AgentsScreen })));
const ChatScreen = lazy(() => import('./features/chat/ChatScreen').then(module => ({ default: module.ChatScreen })));
const DashboardScreen = lazy(() => import('./features/dashboard/DashboardScreen').then(module => ({ default: module.DashboardScreen })));
const ServersScreen = lazy(() => import('./features/servers/ServersScreen').then(module => ({ default: module.ServersScreen })));
const SettingsScreen = lazy(() => import('./features/settings/SettingsScreen').then(module => ({ default: module.SettingsScreen })));
const NAV_TABS: Array<{ id: HubTabId; label: string; Icon: typeof MessageSquare }> = [
  { id: 'dashboard', label: 'Dashboard', Icon: LayoutDashboard },
  { id: 'chat', label: 'Chat', Icon: MessageSquare },
  { id: 'servers', label: 'Servers', Icon: Server },
  { id: 'agents', label: 'Agents', Icon: Bot },
  { id: 'settings', label: 'Settings', Icon: Settings },
];

export default function App() {
  const {
    initialized,
    isLocked,
    passphraseVaultEnabled,
    vaultLocked,
    authUser,
    authGuestMode,
    activeTab,
    settings,
    setActiveTab,
    setPendingDeepLinkServer,
    setAuthUser,
    continueAsGuest,
    initializeApp,
    unlockApp,
    unlockVault,
    disconnectAllForBackground,
  } = useHubStore(useShallow((state) => ({
    initialized: state.initialized,
    isLocked: state.isLocked,
    passphraseVaultEnabled: state.passphraseVaultEnabled,
    vaultLocked: state.vaultLocked,
    authUser: state.authUser,
    authGuestMode: state.authGuestMode,
    activeTab: state.activeTab,
    settings: state.settings,
    setActiveTab: state.setActiveTab,
    setPendingDeepLinkServer: state.setPendingDeepLinkServer,
    setAuthUser: state.setAuthUser,
    continueAsGuest: state.continueAsGuest,
    initializeApp: state.initializeApp,
    unlockApp: state.unlockApp,
    unlockVault: state.unlockVault,
    disconnectAllForBackground: state.disconnectAllForBackground,
  })));
  const [vaultPassphrase, setVaultPassphrase] = useState('');
  const [vaultUnlockError, setVaultUnlockError] = useState('');
  const [unlockingVault, setUnlockingVault] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const autostart = params.get('autostart') === '1';
    const deepLink = parseMcpAddDeepLink(window.location.href);
    if (deepLink) {
      setPendingDeepLinkServer(deepLink);
      setActiveTab('servers');
      params.delete('mcphub_add');
      params.delete('add_server');
      params.delete('name');
      params.delete('authType');
      const nextSearch = params.toString();
      const cleanUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`;
      window.history.replaceState({}, '', cleanUrl);
    }
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.registerProtocolHandler === 'function') {
        navigator.registerProtocolHandler(
          'web+mcphub',
          `${window.location.origin}/?mcphub_add=%s`
        );
      }
    } catch {
      // ignore unsupported protocol handler environments
    }
    void initializeApp(autostart);
  }, [initializeApp, setActiveTab, setPendingDeepLinkServer]);

  useEffect(() => {
    return subscribeGoogleAuth((googleUser) => {
      if (googleUser) {
        setAuthUser(googleUser);
      } else if (useHubStore.getState().authUser?.provider === 'google') {
        setAuthUser(null);
      }
    });
  }, [setAuthUser]);

  useEffect(() => {
    if (!initialized || (!authUser && !authGuestMode)) return;
    return startBrowserControlBridge();
  }, [initialized, authUser, authGuestMode]);

  useEffect(() => {
    if (!initialized || isLocked || vaultLocked || (!authUser && !authGuestMode)) return;
    const refresh = () => {
      if (document.visibilityState === 'visible') void useHubStore.getState().syncModels();
    };
    refresh();
    const timer = window.setInterval(refresh, CATALOG_TTL - 60_000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [initialized, isLocked, vaultLocked, authUser, authGuestMode]);

  // System + manual theme + Pixel Material You dynamic color sync
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const applyTheme = () => {
      const useDark =
        settings.theme === 'dark' || (settings.theme === 'system' && media.matches);
      document.documentElement.classList.toggle('dark', useDark);
      applyPixelThemeVars(settings.accentTheme ?? 'pixel_blue', useDark, Boolean(settings.oledDark));
    };
    applyTheme();
    media.addEventListener('change', applyTheme);
    return () => media.removeEventListener('change', applyTheme);
  }, [settings.theme, settings.accentTheme, settings.oledDark]);

  // Battery-friendly lifecycle: close active MCP SSE streams when backgrounded
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        disconnectAllForBackground();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [disconnectAllForBackground]);

  if (!initialized) {
    return (
      <div
        style={{ backgroundColor: 'var(--m3-surface)' }}
        className="h-dvh flex items-center justify-center text-slate-600 dark:text-slate-300 text-sm"
      >
        Initializing MCP Hub...
      </div>
    );
  }

  if (isLocked) {
    return (
      <ErrorBoundary>
        <div
          style={{ backgroundColor: 'var(--m3-surface)' }}
          className="h-dvh flex items-center justify-center p-6"
        >
          <div
            style={{
              backgroundColor: 'var(--m3-surface-container)',
              borderColor: 'var(--m3-outline)',
            }}
            className="w-full max-w-sm rounded-[28px] border p-6 text-center space-y-5 shadow-xl"
          >
            <div
              style={{
                backgroundColor: 'var(--m3-primary-container)',
                color: 'var(--m3-on-primary-container)',
              }}
              className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto"
            >
              <Fingerprint className="w-8 h-8" />
            </div>
            <div className="space-y-1">
              <h1 className="font-display text-xl font-bold text-slate-900 dark:text-white">
                MCP Hub Locked
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Verify identity to unlock encrypted API keys and MCP servers.
              </p>
            </div>
            <button
              type="button"
              onClick={unlockApp}
              style={{
                backgroundColor: 'var(--m3-primary)',
                color: 'var(--m3-on-primary)',
              }}
              className="w-full min-h-[48px] rounded-full text-sm font-semibold transition-opacity hover:opacity-90"
            >
              Unlock MCP Hub
            </button>
          </div>
        </div>
      </ErrorBoundary>
    );
  }

  if (passphraseVaultEnabled && vaultLocked) {
    return (
      <ErrorBoundary>
        <div
          style={{ backgroundColor: 'var(--m3-surface)' }}
          className="h-dvh flex items-center justify-center p-6"
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!vaultPassphrase) return;
              setUnlockingVault(true);
              setVaultUnlockError('');
              try {
                const ok = await unlockVault(vaultPassphrase);
                if (!ok) {
                  setVaultUnlockError('Incorrect vault passphrase.');
                } else {
                  setVaultPassphrase('');
                }
              } finally {
                setUnlockingVault(false);
              }
            }}
            style={{
              backgroundColor: 'var(--m3-surface-container)',
              borderColor: 'var(--m3-outline)',
            }}
            className="w-full max-w-sm rounded-[28px] border p-6 space-y-5 shadow-xl"
          >
            <div className="text-center space-y-2">
              <div
                style={{
                  backgroundColor: 'var(--m3-primary-container)',
                  color: 'var(--m3-on-primary-container)',
                }}
                className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto"
              >
                <KeyRound className="w-8 h-8" />
              </div>
              <h1 className="font-display text-xl font-bold text-slate-900 dark:text-white">
                Unlock Secret Vault
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Enter your PBKDF2 vault passphrase to derive the in-memory AES-GCM key for API keys and MCP tokens.
              </p>
            </div>
            <div className="space-y-2">
              <label htmlFor="vault-unlock-passphrase" className="sr-only">
                Vault passphrase
              </label>
              <input
                id="vault-unlock-passphrase"
                type="password"
                autoFocus
                value={vaultPassphrase}
                onChange={(e) => setVaultPassphrase(e.target.value)}
                placeholder="Enter vault passphrase"
                style={{
                  backgroundColor: 'var(--m3-surface)',
                  borderColor: 'var(--m3-outline)',
                }}
                className="w-full min-h-[46px] px-3.5 rounded-2xl border text-sm text-slate-900 dark:text-white"
              />
              {vaultUnlockError && (
                <p className="text-xs text-rose-600 dark:text-rose-400">{vaultUnlockError}</p>
              )}
            </div>
            <button
              type="submit"
              disabled={unlockingVault || !vaultPassphrase}
              style={{
                backgroundColor: 'var(--m3-primary)',
                color: 'var(--m3-on-primary)',
              }}
              className="w-full min-h-[48px] rounded-full text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {unlockingVault ? 'Deriving Key...' : 'Unlock Vault'}
            </button>
          </form>
        </div>
      </ErrorBoundary>
    );
  }

  if (!authUser && !authGuestMode) {
    return (
      <ErrorBoundary>
        <MotionConfig reducedMotion="user">
          <AuthScreen onAuthenticated={setAuthUser} onContinueGuest={continueAsGuest} />
        </MotionConfig>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <MotionConfig reducedMotion="user">
        <div className="workspace-shell">
          <aside className="workspace-sidebar">
            <button type="button" className="workspace-brand" onClick={() => setActiveTab('dashboard')} aria-label="MCP Hub Home">
              <span className="workspace-mark"><Workflow aria-hidden="true" /></span>
              <span>MCP Hub</span>
            </button>
            <nav aria-label="Primary navigation" className="workspace-nav">
              {NAV_TABS.map(({ id, label, Icon }) => (
                <button key={id} type="button" onClick={() => setActiveTab(id)}
                  aria-current={activeTab === id ? 'page' : undefined}>
                  <Icon aria-hidden="true" />
                  <span>{label}</span>
                  {activeTab === id && <ChevronRight aria-hidden="true" className="workspace-nav-chevron" />}
                </button>
              ))}
            </nav>
            <button type="button" className="workspace-account" onClick={() => setActiveTab('settings')}
              aria-label="Account settings">
              {authUser?.photoURL
                ? <img src={authUser.photoURL} alt="" className="workspace-avatar" />
                : <span className="workspace-avatar"><UserRound aria-hidden="true" /></span>}
              <span className="min-w-0 text-left">
                <strong className="block truncate">{authUser?.displayName || (authUser ? 'Your account' : 'Local workspace')}</strong>
                <small>{authUser ? 'Signed in' : 'Guest session'}</small>
              </span>
            </button>
          </aside>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <header className="workspace-topbar">
              <button type="button" className="workspace-brand lg:hidden" onClick={() => setActiveTab('dashboard')} aria-label="MCP Hub Home">
                <span className="workspace-mark"><Workflow aria-hidden="true" /></span>
                <span>MCP Hub</span>
              </button>
              <span className="hidden lg:inline">Workspace</span>
              <ChevronRight aria-hidden="true" className="hidden size-3.5 lg:inline" />
              <span className="workspace-location">{NAV_TABS.find(({ id }) => id === activeTab)?.label}</span>
            </header>
            <main className="flex-1 min-w-0 min-h-0 overflow-hidden">
              <Suspense fallback={<div role="status" className="p-6 text-sm">Loading workspace…</div>}>
                <ErrorBoundary key={activeTab}>
                  {activeTab === 'dashboard' && <DashboardScreen onNavigateTab={setActiveTab} />}
                  {activeTab === 'chat' && <ChatScreen onOpenSettings={() => setActiveTab('settings')} />}
                  {activeTab === 'servers' && <ServersScreen />}
                  {activeTab === 'agents' && <AgentsScreen onOpenChat={() => setActiveTab('chat')} />}
                  {activeTab === 'settings' && <SettingsScreen />}
                </ErrorBoundary>
              </Suspense>
            </main>
          </div>

          <nav aria-label="Mobile navigation" className="workspace-mobile-nav pb-safe">
            {NAV_TABS.map(({ id, label, Icon }) => (
              <button key={id} type="button" onClick={() => setActiveTab(id)}
                aria-current={activeTab === id ? 'page' : undefined}>
                <Icon aria-hidden="true" />
                <span>{label}</span>
              </button>
            ))}
          </nav>

          {!settings.onboardingCompleted && (
            <OnboardingModal
              onComplete={(tab) => {
                if (tab) setActiveTab(tab);
              }}
            />
          )}
        </div>
      </MotionConfig>
    </ErrorBoundary>
  );
}
