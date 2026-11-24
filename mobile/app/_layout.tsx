import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus, Pressable, Text, View, useColorScheme } from 'react-native';
import * as Linking from 'expo-linking';
import { Stack, useRouter } from 'expo-router';
import * as LocalAuthentication from 'expo-local-authentication';
import { parseMcpAddDeepLink } from '@core/config/connectors';
import { setSecureStorageAdapter } from '@core/services/storage/secureStorage';
import { closeAllMcpConnections } from '@core/services/mcp/client';
import { expoSecureStorageAdapter } from '../services/storage/expoSecureStore';
import { loadMobilePrefs, subscribeMobilePrefs } from '../services/storage/mobilePrefs';

setSecureStorageAdapter(expoSecureStorageAdapter);

const BIOMETRIC_GRACE_MS = 15_000;

export default function RootLayout() {
  const scheme = useColorScheme();
  const router = useRouter();
  const incomingUrl = Linking.useURL();
  const [ready, setReady] = useState(false);
  const [locked, setLocked] = useState(false);
  const [lockError, setLockError] = useState('');
  const biometricEnabledRef = useRef(false);
  const backgroundedAtRef = useRef<number | null>(null);
  const lastAppStateRef = useRef<AppStateStatus>(AppState.currentState);
  const lastHandledDeepLinkRef = useRef<string | null>(null);

  const handleUnlock = useCallback(async () => {
    setLockError('');
    try {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();
      if (!hasHardware || !isEnrolled) {
        setLocked(false);
        return;
      }
      const res = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Unlock MCP Hub',
        fallbackLabel: 'Use device passcode',
        cancelLabel: 'Cancel',
      });
      if (res.success) {
        setLocked(false);
      } else {
        setLockError('Authentication required to access your MCP servers and keys.');
      }
    } catch {
      setLockError('Biometric authentication failed. Tap to retry.');
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    void loadMobilePrefs().then((prefs) => {
      if (!mounted) return;
      const enabled = Boolean(prefs.settings.biometricLockEnabled);
      biometricEnabledRef.current = enabled;
      if (enabled) {
        setLocked(true);
        void handleUnlock();
      }
      setReady(true);
    });

    const unsubPrefs = subscribeMobilePrefs((prefs) => {
      biometricEnabledRef.current = Boolean(prefs.settings.biometricLockEnabled);
    });

    const sub = AppState.addEventListener('change', (nextState) => {
      const prevState = lastAppStateRef.current;
      lastAppStateRef.current = nextState;

      if (nextState === 'background' || nextState === 'inactive') {
        if (backgroundedAtRef.current === null) {
          backgroundedAtRef.current = Date.now();
        }
        closeAllMcpConnections();
      } else if (nextState === 'active' && (prevState === 'background' || prevState === 'inactive')) {
        const elapsed =
          backgroundedAtRef.current !== null ? Date.now() - backgroundedAtRef.current : 0;
        backgroundedAtRef.current = null;
        if (biometricEnabledRef.current && elapsed >= BIOMETRIC_GRACE_MS) {
          setLocked(true);
        }
      }
    });

    return () => {
      mounted = false;
      unsubPrefs();
      sub.remove();
    };
  }, [handleUnlock]);

  useEffect(() => {
    if (!ready || !incomingUrl || lastHandledDeepLinkRef.current === incomingUrl) return;
    const parsed = parseMcpAddDeepLink(incomingUrl);
    if (parsed) {
      lastHandledDeepLinkRef.current = incomingUrl;
      router.push({
        pathname: '/(tabs)/servers',
        params: {
          addUrl: parsed.url,
          addName: parsed.name,
          addAuthType: parsed.authType ?? 'bearer',
        },
      });
      return;
    }

    try {
      const url = new URL(incomingUrl);
      const sharedText =
        url.searchParams.get('shared_text') ??
        url.searchParams.get('text') ??
        (url.hostname === 'share' ? url.searchParams.get('body') : null);
      if (sharedText && sharedText.trim()) {
        lastHandledDeepLinkRef.current = incomingUrl;
        router.push({
          pathname: '/(tabs)',
          params: { sharedText: sharedText.trim() },
        });
      }
    } catch {
      // Ignore malformed URLs
    }
  }, [ready, incomingUrl, router]);

  if (!ready) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: scheme === 'dark' ? '#020617' : '#F8FAFC',
        }}
      >
        <Text style={{ color: scheme === 'dark' ? '#CBD5E1' : '#475569' }}>
          Loading MCP Hub...
        </Text>
      </View>
    );
  }

  if (locked) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          padding: 24,
          backgroundColor: scheme === 'dark' ? '#020617' : '#F8FAFC',
        }}
      >
        <Text
          style={{
            fontSize: 22,
            fontWeight: '700',
            marginBottom: 8,
            color: scheme === 'dark' ? '#FFFFFF' : '#0F172A',
          }}
        >
          MCP Hub Locked
        </Text>
        <Text
          style={{
            fontSize: 13,
            textAlign: 'center',
            marginBottom: 18,
            color: scheme === 'dark' ? '#94A3B8' : '#475569',
          }}
        >
          Verify your biometrics or device passcode to unlock encrypted API keys and MCP tools.
        </Text>
        {lockError ? (
          <Text style={{ color: '#EF4444', fontSize: 12, marginBottom: 12, textAlign: 'center' }}>
            {lockError}
          </Text>
        ) : null}
        <Pressable
          onPress={() => void handleUnlock()}
          style={{ backgroundColor: '#2563EB', paddingHorizontal: 24, paddingVertical: 14, borderRadius: 14 }}
        >
          <Text style={{ color: '#FFFFFF', fontWeight: '600' }}>Unlock with Biometrics</Text>
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
