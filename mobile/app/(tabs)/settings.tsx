import { WorkspaceCard, WorkspaceHeading, useWorkspaceTheme, workspaceBlue } from '../../ui/workspace';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { fetch as expoFetch } from 'expo/fetch';
import { syncLiveProviderModels } from '@core/services/llm/provider';
import { loadProviderKeys, saveProviderKeys } from '@core/services/storage/secureStorage';
import { loadMobilePrefs, saveMobilePrefs } from '../../services/storage/mobilePrefs';

export default function MobileSettingsScreen() {
  const [gemini, setGemini] = useState('');
  const [groq, setGroq] = useState('');
  const [openrouter, setOpenrouter] = useState('');
  const [nvidia, setNvidia] = useState('');
  const [cloudflare, setCloudflare] = useState('');
  const [cloudflareAccountId, setCloudflareAccountId] = useState('');
  const [oledBlack, setOledBlack] = useState(false);
  const [biometricLockEnabled, setBiometricLockEnabled] = useState(false);
  const [confirmBeforeWrite, setConfirmBeforeWrite] = useState(true);
  const [saved, setSaved] = useState(false);
  const [syncNotice, setSyncNotice] = useState('');

  useEffect(() => {
    void loadProviderKeys().then((keys) => {
      setGemini(keys.gemini ?? '');
      setGroq(keys.groq ?? '');
      setOpenrouter(keys.openrouter ?? '');
      setNvidia(keys.nvidia ?? '');
      setCloudflare(keys.cloudflare ?? '');
      setCloudflareAccountId(keys.cloudflareAccountId ?? '');
    });
    void loadMobilePrefs().then((prefs) => {
      setOledBlack(Boolean(prefs.settings.oledDark));
      setBiometricLockEnabled(Boolean(prefs.settings.biometricLockEnabled));
      setConfirmBeforeWrite(Boolean(prefs.settings.confirmBeforeWrite));
    });
  }, []);

  const theme = useWorkspaceTheme(oledBlack);
  const isDark = theme.dark;

  const handleSave = async () => {
    await saveProviderKeys({
      gemini: gemini.trim() || undefined,
      groq: groq.trim() || undefined,
      openrouter: openrouter.trim() || undefined,
      nvidia: nvidia.trim() || undefined,
      cloudflare: cloudflare.trim() || undefined,
      cloudflareAccountId: cloudflareAccountId.trim() || undefined,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleSync = async () => {
    const res = await syncLiveProviderModels(await loadProviderKeys(), expoFetch as unknown as typeof fetch);
    setSyncNotice(`${res.models.length} verified models available. ${res.pending.length} free routes awaiting live verification.`);
  };

  const toggleSetting = async (
    key: 'oledDark' | 'biometricLockEnabled' | 'confirmBeforeWrite',
    next: boolean
  ) => {
    if (key === 'oledDark') setOledBlack(next);
    if (key === 'biometricLockEnabled') setBiometricLockEnabled(next);
    if (key === 'confirmBeforeWrite') setConfirmBeforeWrite(next);
    const current = await loadMobilePrefs();
    await saveMobilePrefs({
      settings: { ...current.settings, [key]: next },
    });
  };

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={{ flex: 1, backgroundColor: theme.background }}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }}>
        <WorkspaceHeading title="Settings" subtitle="Manage security, appearance, and provider keys." />

        <WorkspaceCard oledDark={oledBlack}>
          <Text style={{ fontSize: 15, fontWeight: '600', color: theme.text }}>
            Appearance & Security
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontWeight: '500', color: theme.text }}>
                OLED Pure Black Dark Mode
              </Text>
              <Text style={{ fontSize: 12, color: theme.muted }}>
                True #000000 surface for OLED displays
              </Text>
            </View>
            <Switch value={oledBlack} onValueChange={(v) => void toggleSetting('oledDark', v)} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontWeight: '500', color: theme.text }}>
                Biometric App Lock
              </Text>
              <Text style={{ fontSize: 12, color: theme.muted }}>
                Require biometrics on cold start and after 15s in background
              </Text>
            </View>
            <Switch
              value={biometricLockEnabled}
              onValueChange={(v) => void toggleSetting('biometricLockEnabled', v)}
            />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontWeight: '500', color: theme.text }}>
                Confirm before write actions
              </Text>
              <Text style={{ fontSize: 12, color: theme.muted }}>
                Prompt before running non-read-only MCP tools
              </Text>
            </View>
            <Switch
              value={confirmBeforeWrite}
              onValueChange={(v) => void toggleSetting('confirmBeforeWrite', v)}
            />
          </View>
        </WorkspaceCard>

        <WorkspaceCard oledDark={oledBlack}>
          <Text style={{ fontSize: 15, fontWeight: '600', color: theme.text }}>
            Provider API keys
          </Text>
          <TextInput
            value={gemini}
            onChangeText={setGemini}
            secureTextEntry
            placeholder="Google Gemini API key"
            accessibilityLabel="Google Gemini API key"
            placeholderTextColor={theme.muted}
            style={{
              minHeight: 44,
              paddingHorizontal: 12,
              borderRadius: 12,
              backgroundColor: theme.panel,
              color: theme.text,
              borderWidth: 1,
              borderColor: theme.border,
            }}
          />
          <TextInput
            value={groq}
            onChangeText={setGroq}
            secureTextEntry
            placeholder="Groq API key"
            accessibilityLabel="Groq API key"
            placeholderTextColor={theme.muted}
            style={{
              minHeight: 44,
              paddingHorizontal: 12,
              borderRadius: 12,
              backgroundColor: theme.panel,
              color: theme.text,
              borderWidth: 1,
              borderColor: theme.border,
            }}
          />
          <TextInput
            value={openrouter}
            onChangeText={setOpenrouter}
            secureTextEntry
            placeholder="OpenRouter API key"
            accessibilityLabel="OpenRouter API key"
            placeholderTextColor={theme.muted}
            style={{
              minHeight: 44,
              paddingHorizontal: 12,
              borderRadius: 12,
              backgroundColor: theme.panel,
              color: theme.text,
              borderWidth: 1,
              borderColor: theme.border,
            }}
          />
          {([
            ['NVIDIA Build API key', nvidia, setNvidia],
            ['Cloudflare Workers AI token', cloudflare, setCloudflare],
            ['Cloudflare account ID', cloudflareAccountId, setCloudflareAccountId],
          ] as const).map(([label, value, onChangeText]) => (
            <TextInput key={label} value={value} onChangeText={onChangeText} secureTextEntry
              autoCapitalize="none" placeholder={label} accessibilityLabel={label}
              placeholderTextColor={theme.muted}
              style={{ minHeight: 44, paddingHorizontal: 12, borderRadius: 12, backgroundColor: theme.panel,
                color: theme.text, borderWidth: 1, borderColor: theme.border }} />
          ))}
          <Text style={{ fontSize: 12, color: theme.muted }}>
            Kilo uses anonymous free access. Gemini, Groq, and Cloudflare need a verifiable no-charge account policy.
          </Text>
          <Pressable
            onPress={() => void handleSave()}
            style={{ minHeight: 46, justifyContent: 'center', backgroundColor: workspaceBlue, borderRadius: 12, alignItems: 'center' }}
          >
            <Text style={{ color: '#FFFFFF', fontWeight: '600' }}>
              {saved ? 'Saved to Keychain / Keystore' : 'Save Encrypted Keys'}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => void handleSync()}
            style={{
              minHeight: 44,
              justifyContent: 'center',
              borderColor: theme.border,
              borderWidth: 1,
              borderRadius: 12,
              alignItems: 'center',
              backgroundColor: theme.panel,
            }}
          >
            <Text style={{ color: isDark ? '#E2E8F0' : '#0F172A', fontWeight: '600' }}>
              Sync Live Free Models
            </Text>
          </Pressable>
          {syncNotice ? (
            <Text style={{ fontSize: 12, color: isDark ? '#CBD5E1' : '#334155' }}>{syncNotice}</Text>
          ) : null}
        </WorkspaceCard>
      </ScrollView>
    </SafeAreaView>
  );
}
