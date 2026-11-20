import { useEffect, useState } from 'react';
import { Bot, Fingerprint, MessageSquare, Server, Settings, Sparkles } from 'lucide-react';
import { AgentsScreen } from './features/agents/AgentsScreen';
import { ChatScreen } from './features/chat/ChatScreen';
import { OnboardingModal } from './features/onboarding/OnboardingModal';
import { ServersScreen } from './features/servers/ServersScreen';
import { SettingsScreen } from './features/settings/SettingsScreen';
import { useHubStore } from './store/useHubStore';

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

  // System + manual theme sync
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const applyTheme = () => {
      const useDark =
        settings.theme === 'dark' || (settings.theme === 'system' && media.matches);
      document.documentElement.classList.toggle('dark', useDark);
    };
    applyTheme();
    media.addEventListener('change', applyTheme);
    return () => media.removeEventListener('change', applyTheme);
  }, [settings.theme]);

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
      <div className="h-dvh flex items-center justify-center bg-slate-50 dark:bg-slate-950 text-slate-600 dark:text-slate-300 text-sm">
        Initializing MCP Hub...
      </div>
    );
  }

  if (isLocked) {
    return (
      <div className="h-dvh flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-6">
        <div className="w-full max-w-sm rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 text-center space-y-5 shadow-xl">
          <div className="w-14 h-14 rounded-2xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center mx-auto">
            <Fingerprint className="w-7 h-7" />
          </div>
          <div className="space-y-1">
            <h1 className="font-display text-lg font-bold text-slate-900 dark:text-white">
              MCP Hub Locked
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Authenticate to access encrypted API keys and MCP servers.
            </p>
          </div>
          <button
            type="button"
            onClick={unlockApp}
            className="w-full min-h-[48px] rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors"
          >
            Unlock MCP Hub
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-dvh flex flex-col lg:flex-row bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 overflow-hidden">
      {/* Desktop Left Navigation Rail */}
      <nav
        aria-label="Primary navigation"
        className="hidden lg:flex w-20 shrink-0 flex-col items-center py-4 gap-3 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
      >
        <div className="w-11 h-11 rounded-2xl bg-blue-600 text-white flex items-center justify-center mb-2">
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
              className={`w-16 min-h-[56px] rounded-2xl flex flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors ${
                active
                  ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span>{label}</span>
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

      {/* Mobile Bottom Tab Bar (Thumb Zone) */}
      <nav
        aria-label="Mobile navigation"
        className="lg:hidden shrink-0 border-t border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md pb-safe"
      >
        <div className="grid grid-cols-4 h-16 items-center">
          {NAV_TABS.map(({ id, label, Icon }) => {
            const active = activeTab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id)}
                aria-current={active ? 'page' : undefined}
                className={`min-h-[48px] flex flex-col items-center justify-center gap-1 transition-colors ${
                  active
                    ? 'text-blue-600 dark:text-blue-400'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Icon className="w-[22px] h-[22px]" />
                <span className="text-[11px] font-medium tracking-tight">{label}</span>
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
