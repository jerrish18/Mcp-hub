import type { ReactNode } from 'react';
import { StyleSheet, Text, View, useColorScheme } from 'react-native';
import { PIXEL_PALETTES } from '@core/utils/theme';

export const workspaceBlue = PIXEL_PALETTES.pixel_blue.light.primary;

export function useWorkspaceTheme(oledDark = false) {
  const dark = useColorScheme() === 'dark';
  const tokens = dark ? PIXEL_PALETTES.pixel_blue.dark : PIXEL_PALETTES.pixel_blue.light;
  return {
    dark,
    background: dark && oledDark ? '#000000' : tokens.surface,
    panel: dark && oledDark ? '#111317' : tokens.surfaceContainer,
    mutedPanel: dark && oledDark ? '#1b1e24' : tokens.surfaceContainerHigh,
    border: tokens.outline,
    text: dark ? '#f1f5f9' : '#12203a',
    muted: dark ? '#a7b4cf' : '#526480',
    accent: tokens.primary,
    accentSurface: tokens.primaryContainer,
    onAccentSurface: tokens.onPrimaryContainer,
  };
}

export function WorkspaceHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  const theme = useWorkspaceTheme();
  return (
    <View style={styles.heading}>
      <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>{title}</Text>
      {subtitle ? <Text style={[styles.subtitle, { color: theme.muted }]}>{subtitle}</Text> : null}
    </View>
  );
}

export function WorkspaceCard({ children, oledDark = false }: { children: ReactNode; oledDark?: boolean }) {
  const theme = useWorkspaceTheme(oledDark);
  return (
    <View style={[styles.card, { backgroundColor: theme.panel, borderColor: theme.border }]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  heading: { gap: 5, marginBottom: 4 },
  title: { fontSize: 30, fontWeight: '700', letterSpacing: -1.3 },
  subtitle: { fontSize: 13, lineHeight: 19 },
  card: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 12 },
});
