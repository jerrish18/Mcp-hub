import { useEffect, useState } from 'react';
import { AppState, Pressable, Text, View, useColorScheme } from 'react-native';
import { Stack } from 'expo-router';
import * as LocalAuthentication from 'expo-local-authentication';
import { setSecureStorageAdapter } from '@core/services/storage/secureStorage';
import { closeAllMcpConnections } from '@core/services/mcp/client';
import { expoSecureStorageAdapter } from '../services/storage/expoSecureStore';

setSecureStorageAdapter(expoSecureStorageAdapter);

export default function RootLayout() {
  const scheme = useColorScheme();
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background' || state === 'inactive') {
        closeAllMcpConnections();
      }
    });
    return () => sub.remove();
  }, []);

  const handleUnlock = async () => {
    const res = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Unlock MCP Hub',
      fallbackLabel: 'Use passcode',
    });
    if (res.success) setLocked(false);
  };

  if (locked) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 }}>
        <Text style={{ fontSize: 20, fontWeight: '700', marginBottom: 12 }}>MCP Hub Locked</Text>
        <Pressable
          onPress={handleUnlock}
          style={{ backgroundColor: '#2563EB', paddingHorizontal: 20, paddingVertical: 14, borderRadius: 12 }}
        >
          <Text style={{ color: '#FFFFFF', fontWeight: '600' }}>Authenticate</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: scheme === 'dark' ? '#020617' : '#F8FAFC' },
      }}
    >
      <Stack.Screen name="(tabs)" />
    </Stack>
  );
}
