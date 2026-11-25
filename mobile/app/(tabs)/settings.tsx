import { useEffect, useState } from 'react';
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
  useColorScheme,
} from 'react-native';
import { syncLiveProviderModels } from '@core/services/llm/provider';
import { loadProviderKeys, saveProviderKeys } from '@core/services/storage/secureStorage';
import { loadMobilePrefs, saveMobilePrefs } from '../../services/storage/mobilePrefs';

export default function MobileSettingsScreen() {
  const isDark = useColorScheme() === 'dark';
  const [gemini, setGemini] = useState('');
  const [groq, setGroq] = useState('');
  const [openrouter, setOpenrouter] = useState('');
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
    });
    void loadMobilePrefs().then((prefs) => {
      setOledBlack(Boolean(prefs.settings.oledDark));
      setBiometricLockEnabled(Boolean(prefs.settings.biometricLockEnabled));
      setConfirmBeforeWrite(Boolean(prefs.settings.confirmBeforeWrite));
    });
  }, []);

  const bgSurface = isDark ? (oledBlack ? '#000000' : '#020617') : '#F8FAFC';
  const bgCard = isDark ? (oledBlack ? '#0A0B0E' : '#0F172A') : '#FFFFFF';
  const border = isDark ? '#1E293B' : '#E2E8F0';

  const handleSave = async () => {
    await saveProviderKeys({
      gemini: gemini.trim() || undefined,
      groq: groq.trim() || undefined,
      openrouter: openrouter.trim() || undefined,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleSync = async () => {
    const res = await syncLiveProviderModels({
      gemini: gemini.trim() || undefined,
      groq: groq.trim() || undefined,
      openrouter: openrouter.trim() || undefined,
    });
    setSyncNotice(
      res.models.length > 0
        ? `Synced ${res.models.length} live models from ${res.syncedProviders.join(', ')}`
        : 'Add an API key above first to sync live models.'
    );
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
    <SafeAreaView style={{ flex: 1, backgroundColor: bgSurface }}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
        <Text style={{ fontSize: 24, fontWeight: '700', color: isDark ? '#FFFFFF' : '#0F172A' }}>
          Settings
        </Text>

        <View
          style={{
            padding: 14,
            borderRadius: 16,
            backgroundColor: bgCard,
            borderWidth: 1,
            borderColor: border,
            gap: 12,
          }}
        >
          <Text style={{ fontSize: 15, fontWeight: '600', color: isDark ? '#FFFFFF' : '#0F172A' }}>
            Appearance & Security
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontWeight: '500', color: isDark ? '#F8FAFC' : '#0F172A' }}>
                OLED Pure Black Dark Mode
              </Text>
              <Text style={{ fontSize: 12, color: '#64748B' }}>
                True #000000 surface for OLED displays
              </Text>
            </View>
            <Switch value={oledBlack} onValueChange={(v) => void toggleSetting('oledDark', v)} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontWeight: '500', color: isDark ? '#F8FAFC' : '#0F172A' }}>
                Biometric App Lock
              </Text>
              <Text style={{ fontSize: 12, color: '#64748B' }}>
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
              <Text style={{ fontSize: 14, fontWeight: '500', color: isDark ? '#F8FAFC' : '#0F172A' }}>
                Confirm before write actions
              </Text>
              <Text style={{ fontSize: 12, color: '#64748B' }}>
                Prompt before running non-read-only MCP tools
              </Text>
            </View>
            <Switch
              value={confirmBeforeWrite}
              onValueChange={(v) => void toggleSetting('confirmBeforeWrite', v)}
            />
          </View>
        </View>

        <View style={{ gap: 10 }}>
          <Text style={{ fontSize: 15, fontWeight: '600', color: isDark ? '#FFFFFF' : '#0F172A' }}>
            Provider API Keys (Keychain / Keystore)
          </Text>
          <TextInput
            value={gemini}
            onChangeText={setGemini}
            secureTextEntry
            placeholder="Google Gemini API Key"
            placeholderTextColor="#94A3B8"
            style={{
              minHeight: 44,
              paddingHorizontal: 12,
              borderRadius: 12,
              backgroundColor: bgCard,
              color: isDark ? '#FFFFFF' : '#0F172A',
              borderWidth: 1,
              borderColor: border,
            }}
          />
          <TextInput
            value={groq}
            onChangeText={setGroq}
            secureTextEntry
            placeholder="Groq API Key"
            placeholderTextColor="#94A3B8"
            style={{
              minHeight: 44,
              paddingHorizontal: 12,
              borderRadius: 12,
              backgroundColor: bgCard,
              color: isDark ? '#FFFFFF' : '#0F172A',
              borderWidth: 1,
              borderColor: border,
            }}
          />
          <TextInput
            value={openrouter}
            onChangeText={setOpenrouter}
            secureTextEntry
            placeholder="OpenRouter API Key"
            placeholderTextColor="#94A3B8"
            style={{
              minHeight: 44,
              paddingHorizontal: 12,
              borderRadius: 12,
              backgroundColor: bgCard,
              color: isDark ? '#FFFFFF' : '#0F172A',
              borderWidth: 1,
              borderColor: border,
            }}
          />
          <Pressable
            onPress={() => void handleSave()}
            style={{ minHeight: 46, justifyContent: 'center', backgroundColor: '#2563EB', borderRadius: 12, alignItems: 'center' }}
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
              borderColor: border,
              borderWidth: 1,
              borderRadius: 12,
              alignItems: 'center',
              backgroundColor: bgCard,
            }}
          >
            <Text style={{ color: isDark ? '#E2E8F0' : '#0F172A', fontWeight: '600' }}>
              Sync Live Free Models
            </Text>
          </Pressable>
          {syncNotice ? (
            <Text style={{ fontSize: 12, color: isDark ? '#CBD5E1' : '#334155' }}>{syncNotice}</Text>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
