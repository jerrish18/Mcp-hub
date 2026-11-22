import { useEffect } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { Bot, Fingerprint, LayoutDashboard, MessageSquare, Server, Settings, Sparkles } from 'lucide-react';
import { AgentsScreen } from './features/agents/AgentsScreen';
import { ChatScreen } from './features/chat/ChatScreen';
import { DashboardScreen } from './features/dashboard/DashboardScreen';
import { OnboardingModal } from './features/onboarding/OnboardingModal';
import { ServersScreen } from './features/servers/ServersScreen';
import { SettingsScreen } from './features/settings/SettingsScreen';
import { startBrowserControlBridge } from './services/control/browserBridge';
import { useHubStore, type HubTabId } from './store/useHubStore';
import { M3_SPRING, screenTransitionVariants } from './utils/motion';
import { applyPixelThemeVars } from './utils/theme';

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
    activeTab,
    settings,
    setActiveTab,
    initializeApp,
    unlockApp,
    disconnectAllForBackground,
  } = useHubStore();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const autostart = params.get('autostart') === '1';
    void initializeApp(autostart);
  }, [initializeApp]);

  useEffect(() => {
    if (!initialized) return;
    return startBrowserControlBridge();
  }, [initialized]);

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
    );
  }

  return (
    <MotionConfig reducedMotion="user">
      <div
        style={{ backgroundColor: 'var(--m3-surface)' }}
        className="h-dvh flex flex-col lg:flex-row text-slate-900 dark:text-slate-100 overflow-hidden"
      >
        {/* Desktop Material 3 Navigation Rail */}
        <nav
          aria-label="Primary navigation"
          style={{
            backgroundColor: 'var(--m3-surface-container)',
            borderColor: 'var(--m3-outline)',
          }}
          className="hidden lg:flex w-20 shrink-0 flex-col items-center py-4 gap-2.5 border-r"
        >
          <button
            type="button"
            onClick={() => setActiveTab('dashboard')}
            aria-label="MCP Hub Home"
            style={{
              backgroundColor: 'var(--m3-primary)',
              color: 'var(--m3-on-primary)',
            }}
            className="w-12 h-12 rounded-2xl flex items-center justify-center mb-2 shadow-xs transition-transform active:scale-95"
          >
            <Sparkles className="w-5 h-5" />
          </button>
          {NAV_TABS.map(({ id, label, Icon }) => {
            const active = activeTab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id)}
                aria-current={active ? 'page' : undefined}
                className="w-16 min-h-[54px] flex flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors group"
              >
                <span className="relative w-14 h-8 rounded-full flex items-center justify-center">
                  {active && (
                    <motion.span
                      layoutId="rail-nav-pill"
                      transition={M3_SPRING}
                      style={{ backgroundColor: 'var(--m3-primary-container)' }}
                      className="absolute inset-0 rounded-full"
                    />
                  )}
                  <Icon
                    style={active ? { color: 'var(--m3-on-primary-container)' } : undefined}
                    className={`relative z-10 w-5 h-5 transition-colors ${
                      active ? '' : 'text-slate-600 dark:text-slate-400 group-hover:text-slate-900 dark:group-hover:text-white'
                    }`}
                  />
                </span>
                <span
                  className={
                    active
                      ? 'font-semibold text-slate-900 dark:text-white'
                      : 'text-slate-600 dark:text-slate-400'
                  }
                >
                  {label}
                </span>
              </button>
            );
          })}
        </nav>

        {/* Main Content Area with Material 3 Transitions */}
        <main className="flex-1 min-w-0 min-h-0 overflow-hidden">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              variants={screenTransitionVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              className="h-full min-h-0"
            >
              {activeTab === 'dashboard' && <DashboardScreen onNavigateTab={setActiveTab} />}
              {activeTab === 'chat' && <ChatScreen onOpenSettings={() => setActiveTab('settings')} />}
              {activeTab === 'servers' && <ServersScreen />}
              {activeTab === 'agents' && <AgentsScreen onOpenChat={() => setActiveTab('chat')} />}
              {activeTab === 'settings' && <SettingsScreen />}
            </motion.div>
          </AnimatePresence>
        </main>

        {/* Pixel Android Material 3 NavigationBar with Animated Tonal Pill */}
        <nav
          aria-label="Mobile navigation"
          style={{
            backgroundColor: 'var(--m3-surface-container)',
            borderColor: 'var(--m3-outline)',
          }}
          className="lg:hidden shrink-0 border-t pb-safe"
        >
          <div className="grid grid-cols-5 h-[66px] items-center px-1">
            {NAV_TABS.map(({ id, label, Icon }) => {
              const active = activeTab === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setActiveTab(id)}
                  aria-current={active ? 'page' : undefined}
                  className="min-h-[52px] flex flex-col items-center justify-center gap-0.5 transition-colors"
                >
                  <span className="relative w-12 h-7 rounded-full flex items-center justify-center">
                    {active && (
                      <motion.span
                        layoutId="mobile-nav-pill"
                        transition={M3_SPRING}
                        style={{ backgroundColor: 'var(--m3-primary-container)' }}
                        className="absolute inset-0 rounded-full"
                      />
                    )}
                    <Icon
                      style={active ? { color: 'var(--m3-on-primary-container)' } : undefined}
                      className={`relative z-10 w-[19px] h-[19px] ${
                        active ? '' : 'text-slate-600 dark:text-slate-400'
                      }`}
                    />
                  </span>
                  <span
                    className={`text-[10px] tracking-tight whitespace-nowrap ${
                      active
                        ? 'font-semibold text-slate-900 dark:text-white'
                        : 'font-medium text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    {label}
                  </span>
                </button>
              );
            })}
          </div>
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
  );
}
