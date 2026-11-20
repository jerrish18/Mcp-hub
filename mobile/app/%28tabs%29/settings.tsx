import { useState } from 'react';
import { Pressable, SafeAreaView, ScrollView, Switch, Text, TextInput, View, useColorScheme } from 'react-native';
import { syncLiveProviderModels } from '@core/services/llm/provider';
import { saveProviderKeys } from '@core/services/storage/secureStorage';

export default function MobileSettingsScreen() {
  const isDark = useColorScheme() === 'dark';
  const [oledBlack, setOledBlack] = useState(false);
  const [gemini, setGemini] = useState('');
  const [groq, setGroq] = useState('');
  const [openrouter, setOpenrouter] = useState('');
  const [saved, setSaved] = useState(false);
  const [syncNotice, setSyncNotice] = useState('');

  const bgSurface = isDark ? (oledBlack ? '#000000' : '#111318') : '#F8FAFD';
  const bgCard = isDark ? (oledBlack ? '#0A0B0E' : '#1A1D24') : '#EEF3FA';
  const primary = isDark ? '#A8C7FA' : '#0B57D0';
  const onPrimary = isDark ? '#062E6F' : '#FFFFFF';
  const border = isDark ? '#2A2D35' : '#D3DCE9';

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

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: bgSurface }}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
        <Text style={{ fontSize: 24, fontWeight: '700', color: isDark ? '#FFFFFF' : '#0F172A' }}>
          Settings
        </Text>

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: bgCard,
            borderColor: border,
            borderWidth: 1,
            borderRadius: 22,
            padding: 14,
          }}
        >
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={{ fontWeight: '600', color: isDark ? '#FFFFFF' : '#0F172A' }}>
              OLED Pure Black Dark Mode
            </Text>
            <Text style={{ fontSize: 12, color: isDark ? '#94A3B8' : '#64748B', marginTop: 2 }}>
              True #000000 surface for Pixel OLED displays
            </Text>
          </View>
          <Switch value={oledBlack} onValueChange={setOledBlack} />
        </View>

        <View style={{ gap: 10, backgroundColor: bgCard, borderColor: border, borderWidth: 1, borderRadius: 22, padding: 14 }}>
          <TextInput
            value={gemini}
            onChangeText={setGemini}
            secureTextEntry
            placeholder="Google Gemini API Key"
            placeholderTextColor="#94A3B8"
            style={{
              minHeight: 44,
              paddingHorizontal: 14,
              borderRadius: 16,
              backgroundColor: bgSurface,
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
              paddingHorizontal: 14,
              borderRadius: 16,
              backgroundColor: bgSurface,
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
              paddingHorizontal: 14,
              borderRadius: 16,
              backgroundColor: bgSurface,
              color: isDark ? '#FFFFFF' : '#0F172A',
              borderWidth: 1,
              borderColor: border,
            }}
          />
          <Pressable
            onPress={() => void handleSave()}
            style={{ backgroundColor: primary, paddingVertical: 14, borderRadius: 999, alignItems: 'center' }}
          >
            <Text style={{ color: onPrimary, fontWeight: '600' }}>
              {saved ? 'Saved to Keychain / Keystore' : 'Save Encrypted Keys'}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => void handleSync()}
            style={{
              borderColor: border,
              borderWidth: 1,
              paddingVertical: 12,
              borderRadius: 999,
              alignItems: 'center',
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
