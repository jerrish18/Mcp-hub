import { useState } from 'react';
import { Pressable, SafeAreaView, ScrollView, Text, TextInput, View, useColorScheme } from 'react-native';
import { saveProviderKeys } from '@core/services/storage/secureStorage';

export default function MobileSettingsScreen() {
  const isDark = useColorScheme() === 'dark';
  const [gemini, setGemini] = useState('');
  const [groq, setGroq] = useState('');
  const [openrouter, setOpenrouter] = useState('');
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    await saveProviderKeys({
      gemini: gemini.trim() || undefined,
      groq: groq.trim() || undefined,
      openrouter: openrouter.trim() || undefined,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: isDark ? '#020617' : '#F8FAFC' }}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
        <Text style={{ fontSize: 24, fontWeight: '700', color: isDark ? '#FFFFFF' : '#0F172A' }}>
          Settings
        </Text>
        <View style={{ gap: 10 }}>
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
