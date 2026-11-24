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
import { loadProviderKeys, saveProviderKeys } from '@core/services/storage/secureStorage';
import { loadMobilePrefs, saveMobilePrefs } from '../../services/storage/mobilePrefs';

export default function MobileSettingsScreen() {
  const isDark = useColorScheme() === 'dark';
  const [gemini, setGemini] = useState('');
  const [groq, setGroq] = useState('');
  const [openrouter, setOpenrouter] = useState('');
  const [biometricLockEnabled, setBiometricLockEnabled] = useState(false);
  const [confirmBeforeWrite, setConfirmBeforeWrite] = useState(true);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void loadProviderKeys().then((keys) => {
      setGemini(keys.gemini ?? '');
      setGroq(keys.groq ?? '');
      setOpenrouter(keys.openrouter ?? '');
    });
    void loadMobilePrefs().then((prefs) => {
      setBiometricLockEnabled(Boolean(prefs.settings.biometricLockEnabled));
      setConfirmBeforeWrite(Boolean(prefs.settings.confirmBeforeWrite));
    });
  }, []);

  const handleSave = async () => {
    await saveProviderKeys({
      gemini: gemini.trim() || undefined,
      groq: groq.trim() || undefined,
      openrouter: openrouter.trim() || undefined,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const toggleBiometric = async (next: boolean) => {
    setBiometricLockEnabled(next);
    const current = await loadMobilePrefs();
    await saveMobilePrefs({
      settings: { ...current.settings, biometricLockEnabled: next },
    });
  };

  const toggleConfirmWrite = async (next: boolean) => {
    setConfirmBeforeWrite(next);
    const current = await loadMobilePrefs();
    await saveMobilePrefs({
      settings: { ...current.settings, confirmBeforeWrite: next },
    });
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: isDark ? '#020617' : '#F8FAFC' }}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
        <Text style={{ fontSize: 24, fontWeight: '700', color: isDark ? '#FFFFFF' : '#0F172A' }}>
          Settings
        </Text>

        <View
          style={{
            padding: 14,
            borderRadius: 16,
            backgroundColor: isDark ? '#0F172A' : '#FFFFFF',
            borderWidth: 1,
            borderColor: isDark ? '#1E293B' : '#E2E8F0',
            gap: 12,
          }}
        >
          <Text style={{ fontSize: 15, fontWeight: '600', color: isDark ? '#FFFFFF' : '#0F172A' }}>
            Security & Safety
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontWeight: '500', color: isDark ? '#F8FAFC' : '#0F172A' }}>
                Biometric App Lock
              </Text>
              <Text style={{ fontSize: 12, color: '#64748B' }}>
                Require biometrics on cold start and after 15s in background
              </Text>
            </View>
            <Switch value={biometricLockEnabled} onValueChange={(v) => void toggleBiometric(v)} />
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
            <Switch value={confirmBeforeWrite} onValueChange={(v) => void toggleConfirmWrite(v)} />
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
              backgroundColor: isDark ? '#0F172A' : '#FFFFFF',
              color: isDark ? '#FFFFFF' : '#0F172A',
              borderWidth: 1,
              borderColor: isDark ? '#1E293B' : '#CBD5E1',
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
              backgroundColor: isDark ? '#0F172A' : '#FFFFFF',
              color: isDark ? '#FFFFFF' : '#0F172A',
              borderWidth: 1,
              borderColor: isDark ? '#1E293B' : '#CBD5E1',
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
              backgroundColor: isDark ? '#0F172A' : '#FFFFFF',
              color: isDark ? '#FFFFFF' : '#0F172A',
              borderWidth: 1,
              borderColor: isDark ? '#1E293B' : '#CBD5E1',
            }}
          />
          <Pressable
            onPress={() => void handleSave()}
            style={{ backgroundColor: '#2563EB', paddingVertical: 14, borderRadius: 12, alignItems: 'center' }}
          >
            <Text style={{ color: '#FFFFFF', fontWeight: '600' }}>
              {saved ? 'Saved to Keychain / Keystore' : 'Save Encrypted Keys'}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
