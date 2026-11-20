import { useEffect, useState } from 'react';
import { Bot, Fingerprint, MessageSquare, Server, Settings, Sparkles } from 'lucide-react';
import { AgentsScreen } from './features/agents/AgentsScreen';
import { ChatScreen } from './features/chat/ChatScreen';
import { OnboardingModal } from './features/onboarding/OnboardingModal';
import { ServersScreen } from './features/servers/ServersScreen';
import { SettingsScreen } from './features/settings/SettingsScreen';
import { useHubStore } from './store/useHubStore';
import { applyPixelThemeVars } from './utils/theme';

type TabId = 'chat' | 'servers' | 'agents' | 'settings';

const NAV_TABS: Array<{ id: TabId; label: string; Icon: typeof MessageSquare }> = [
  { id: 'chat', label: 'Chat', Icon: MessageSquare },
  { id: 'servers', label: 'Servers', Icon: Server },
  { id: 'agents', label: 'Agents', Icon: Bot },
  { id: 'settings', label: 'Settings', Icon: Settings },
];

export default function App() {
  const {
    initialized,
    isLocked,
    settings,
    initializeApp,
    unlockApp,
    disconnectAllForBackground,
  } = useHubStore();

  const [activeTab, setActiveTab] = useState<TabId>('chat');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const autostart = params.get('autostart') === '1';
    void initializeApp(autostart);
  }, [initializeApp]);

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
        className="hidden lg:flex w-20 shrink-0 flex-col items-center py-4 gap-3 border-r"
      >
        <div
          style={{
            backgroundColor: 'var(--m3-primary)',
            color: 'var(--m3-on-primary)',
          }}
          className="w-12 h-12 rounded-2xl flex items-center justify-center mb-2 shadow-xs"
        >
          <Sparkles className="w-5 h-5" />
        </div>
        {NAV_TABS.map(({ id, label, Icon }) => {
          const active = activeTab === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              aria-current={active ? 'page' : undefined}
              className="w-16 min-h-[56px] flex flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors group"
            >
              <span
                style={
                  active
                    ? {
                        backgroundColor: 'var(--m3-primary-container)',
                        color: 'var(--m3-on-primary-container)',
                      }
                    : undefined
                }
                className={`w-14 h-8 rounded-full flex items-center justify-center transition-colors ${
                  active
                    ? ''
                    : 'text-slate-600 dark:text-slate-400 group-hover:bg-slate-200/70 dark:group-hover:bg-slate-800'
                }`}
              >
                <Icon className="w-5 h-5" />
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

      {/* Main Content Area */}
      <main className="flex-1 min-w-0 min-h-0 overflow-hidden">
        {activeTab === 'chat' && <ChatScreen onOpenSettings={() => setActiveTab('settings')} />}
        {activeTab === 'servers' && <ServersScreen />}
        {activeTab === 'agents' && <AgentsScreen onOpenChat={() => setActiveTab('chat')} />}
        {activeTab === 'settings' && <SettingsScreen />}
      </main>

      {/* Pixel Android Material 3 NavigationBar with Tonal Pill Indicator */}
      <nav
        aria-label="Mobile navigation"
        style={{
          backgroundColor: 'var(--m3-surface-container)',
          borderColor: 'var(--m3-outline)',
        }}
        className="lg:hidden shrink-0 border-t pb-safe"
      >
        <div className="grid grid-cols-4 h-[72px] items-center px-1">
          {NAV_TABS.map(({ id, label, Icon }) => {
            const active = activeTab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id)}
                aria-current={active ? 'page' : undefined}
                className="min-h-[56px] flex flex-col items-center justify-center gap-1 transition-colors"
              >
                <span
                  style={
                    active
                      ? {
                          backgroundColor: 'var(--m3-primary-container)',
                          color: 'var(--m3-on-primary-container)',
                        }
                      : undefined
                  }
                  className={`w-16 h-8 rounded-full flex items-center justify-center transition-all duration-200 ${
                    active ? '' : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  <Icon className="w-[20px] h-[20px]" />
                </span>
                <span
                  className={`text-[11px] tracking-tight ${
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
  );
}
