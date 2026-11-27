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
import { PROVIDER_INFO } from '@core/config/models';
import { syncLiveProviderModels, validateAllConfiguredProviderKeys } from '@core/services/llm/provider';
import { loadProviderKeys, saveProviderKeys } from '@core/services/storage/secureStorage';
import type { CloudProvider, ProviderKeys, ProviderValidationResult } from '@core/types';
import { loadMobilePrefs, saveMobilePrefs } from '../../services/storage/mobilePrefs';

export default function MobileSettingsScreen() {
  const [gemini, setGemini] = useState('');
  const [groq, setGroq] = useState('');
  const [openrouter, setOpenrouter] = useState('');
  const [modelscope, setModelscope] = useState('');
  const [amd, setAmd] = useState('');
  const [nvidia, setNvidia] = useState('');
  const [cloudflare, setCloudflare] = useState('');
  const [cloudflareAccountId, setCloudflareAccountId] = useState('');
  const [oledBlack, setOledBlack] = useState(false);
  const [biometricLockEnabled, setBiometricLockEnabled] = useState(false);
  const [confirmBeforeWrite, setConfirmBeforeWrite] = useState(true);
  const [localModelToolsEnabled, setLocalModelToolsEnabled] = useState(false);
  const [providerValidation, setProviderValidation] = useState<Partial<Record<CloudProvider, ProviderValidationResult>>>({});
  const [saved, setSaved] = useState(false);
  const [syncNotice, setSyncNotice] = useState('');

  useEffect(() => {
    void loadProviderKeys().then((keys) => {
      setGemini(keys.gemini ?? '');
      setGroq(keys.groq ?? '');
      setOpenrouter(keys.openrouter ?? '');
      setNvidia(keys.nvidia ?? '');
      setModelscope(keys.modelscope ?? '');
      setAmd(keys.amd ?? '');
      setCloudflare(keys.cloudflare ?? '');
      setCloudflareAccountId(keys.cloudflareAccountId ?? '');
      void validateAllConfiguredProviderKeys(keys, expoFetch as unknown as typeof fetch)
        .then(({ validation }) => setProviderValidation(validation))
        .catch(() => {});
    });
    void loadMobilePrefs().then((prefs) => {
      setOledBlack(Boolean(prefs.settings.oledDark));
      setBiometricLockEnabled(Boolean(prefs.settings.biometricLockEnabled));
      setConfirmBeforeWrite(Boolean(prefs.settings.confirmBeforeWrite));
      setLocalModelToolsEnabled(Boolean(prefs.settings.localModelToolsEnabled));
    });
  }, []);

  const theme = useWorkspaceTheme(oledBlack);
  const isDark = theme.dark;

  const currentKeysFromInputs = (): ProviderKeys => ({
    gemini: gemini.trim() || undefined,
    groq: groq.trim() || undefined,
    openrouter: openrouter.trim() || undefined,
    nvidia: nvidia.trim() || undefined,
    modelscope: modelscope.trim() || undefined,
    amd: amd.trim() || undefined,
    cloudflare: cloudflare.trim() || undefined,
    cloudflareAccountId: cloudflareAccountId.trim() || undefined,
  });

  const handleSave = async () => {
    const nextKeys = currentKeysFromInputs();
    await saveProviderKeys(nextKeys);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    const { validation } = await validateAllConfiguredProviderKeys(
      nextKeys,
      expoFetch as unknown as typeof fetch
    );
    setProviderValidation(validation);
  };

  const handleSync = async () => {
    const keys = await loadProviderKeys();
    const [res, keyRes] = await Promise.all([
      syncLiveProviderModels(keys, expoFetch as unknown as typeof fetch),
      validateAllConfiguredProviderKeys(keys, expoFetch as unknown as typeof fetch),
    ]);
    setProviderValidation(keyRes.validation);
    setSyncNotice(`${res.models.length} verified models available. ${res.pending.length} free routes awaiting live verification.`);
  };

  const toggleSetting = async (
    key: 'oledDark' | 'biometricLockEnabled' | 'confirmBeforeWrite' | 'localModelToolsEnabled',
    next: boolean
  ) => {
    if (key === 'oledDark') setOledBlack(next);
    if (key === 'biometricLockEnabled') setBiometricLockEnabled(next);
    if (key === 'confirmBeforeWrite') setConfirmBeforeWrite(next);
    if (key === 'localModelToolsEnabled') setLocalModelToolsEnabled(next);
    const current = await loadMobilePrefs();
    await saveMobilePrefs({
      settings: { ...current.settings, [key]: next },
    });
  };

  const configuredStatuses = (['gemini', 'groq', 'openrouter', 'nvidia', 'modelscope', 'amd', 'cloudflare'] as CloudProvider[])
    .map((p) => providerValidation[p])
    .filter((v): v is ProviderValidationResult => Boolean(v && v.status !== 'unconfigured'));

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
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontWeight: '500', color: theme.text }}>
                Enable MCP tools for local models
              </Text>
              <Text style={{ fontSize: 12, color: theme.muted }}>
                Allow local models on 127.0.0.1:11434 to invoke enabled MCP tools
              </Text>
            </View>
            <Switch
              value={localModelToolsEnabled}
              onValueChange={(v) => void toggleSetting('localModelToolsEnabled', v)}
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
            ['ModelScope access token', modelscope, setModelscope],
            ['AMD Token Factory key', amd, setAmd],
            ['Cloudflare Workers AI token', cloudflare, setCloudflare],
            ['Cloudflare account ID', cloudflareAccountId, setCloudflareAccountId],
          ] as const).map(([label, value, onChangeText]) => (
            <TextInput key={label} value={value} onChangeText={onChangeText} secureTextEntry
              autoCapitalize="none" placeholder={label} accessibilityLabel={label}
              placeholderTextColor={theme.muted}
              style={{ minHeight: 44, paddingHorizontal: 12, borderRadius: 12, backgroundColor: theme.panel,
                color: theme.text, borderWidth: 1, borderColor: theme.border }} />
          ))}
          {configuredStatuses.length > 0 && (
            <View style={{ gap: 4 }}>
              {configuredStatuses.map((status) => (
                <Text
                  key={status.provider}
                  style={{
                    fontSize: 12,
                    color: status.status === 'valid' ? '#10B981' : status.status === 'invalid_key' ? '#EF4444' : '#F59E0B',
                  }}
                >
                  {PROVIDER_INFO[status.provider].name}: {status.badge}
                </Text>
              ))}
            </View>
          )}
          <Text style={{ fontSize: 12, color: theme.muted }}>
            Saving keys checks each provider directly via /models. Non-free or blocked routes can still be enabled individually in the chat Model Picker.
          </Text>
          <Pressable
            onPress={() => void handleSave()}
            style={{ minHeight: 46, justifyContent: 'center', backgroundColor: workspaceBlue, borderRadius: 12, alignItems: 'center' }}
          >
            <Text style={{ color: '#FFFFFF', fontWeight: '600' }}>
              {saved ? 'Saved to Keychain / Keystore' : 'Save & Verify Encrypted Keys'}
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
              Sync &amp; Verify Models
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

