import type { PixelAccentTheme } from '../types';

export interface PixelPaletteTokens {
  id: PixelAccentTheme;
  label: string;
  swatch: string;
  light: {
    primary: string;
    onPrimary: string;
    primaryContainer: string;
    onPrimaryContainer: string;
    surface: string;
    surfaceContainer: string;
    surfaceContainerHigh: string;
    outline: string;
  };
  dark: {
    primary: string;
    onPrimary: string;
    primaryContainer: string;
    onPrimaryContainer: string;
    surface: string;
    surfaceContainer: string;
    surfaceContainerHigh: string;
    outline: string;
  };
}

export const PIXEL_PALETTES: Record<PixelAccentTheme, PixelPaletteTokens> = {
  pixel_blue: {
    id: 'pixel_blue',
    label: 'Pixel Blue',
    swatch: '#0B57D0',
    light: {
      primary: '#0B57D0',
      onPrimary: '#FFFFFF',
      primaryContainer: '#D3E3FD',
      onPrimaryContainer: '#041E49',
      surface: '#F8FAFD',
      surfaceContainer: '#EFF3F9',
      surfaceContainerHigh: '#E4EAF4',
      outline: '#D2D9E5',
    },
    dark: {
      primary: '#A8C7FA',
      onPrimary: '#062E6F',
      primaryContainer: '#0842A0',
      onPrimaryContainer: '#D3E3FD',
      surface: '#111318',
      surfaceContainer: '#1B1F27',
      surfaceContainerHigh: '#262B35',
      outline: '#2E3440',
    },
  },
  sage: {
    id: 'sage',
    label: 'Pixel Sage',
    swatch: '#2E6B4E',
    light: {
      primary: '#246B49',
      onPrimary: '#FFFFFF',
      primaryContainer: '#C4EED4',
      onPrimaryContainer: '#072716',
      surface: '#F6FAF7',
      surfaceContainer: '#ECF3EE',
      surfaceContainerHigh: '#E0EBE3',
      outline: '#CDD9D0',
    },
    dark: {
      primary: '#9CD6B5',
      onPrimary: '#083820',
      primaryContainer: '#135134',
      onPrimaryContainer: '#C4EED4',
      surface: '#101412',
      surfaceContainer: '#1A201D',
      surfaceContainerHigh: '#242B27',
      outline: '#2D3631',
    },
  },
  clay: {
    id: 'clay',
    label: 'Terracotta',
    swatch: '#9C4234',
    light: {
      primary: '#9C4234',
      onPrimary: '#FFFFFF',
      primaryContainer: '#FFDAD3',
      onPrimaryContainer: '#3F0C05',
      surface: '#FCF8F7',
      surfaceContainer: '#F5EEEC',
      surfaceContainerHigh: '#ECE2DF',
      outline: '#DED2CF',
    },
    dark: {
      primary: '#FFB4A8',
      onPrimary: '#5F160C',
      primaryContainer: '#7D2B1F',
      onPrimaryContainer: '#FFDAD3',
      surface: '#151211',
      surfaceContainer: '#211C1B',
      surfaceContainerHigh: '#2C2523',
      outline: '#382F2D',
    },
  },
  lavender: {
    id: 'lavender',
    label: 'Iris Violet',
    swatch: '#6750A4',
    light: {
      primary: '#6750A4',
      onPrimary: '#FFFFFF',
      primaryContainer: '#EADDFF',
      onPrimaryContainer: '#21005D',
      surface: '#FAF8FC',
      surfaceContainer: '#F2EEF7',
      surfaceContainerHigh: '#E8E2F0',
      outline: '#D8D1E3',
    },
    dark: {
      primary: '#D0BCFF',
      onPrimary: '#381E72',
      primaryContainer: '#4F378B',
      onPrimaryContainer: '#EADDFF',
      surface: '#131217',
      surfaceContainer: '#1E1B24',
      surfaceContainerHigh: '#292531',
      outline: '#35303F',
    },
  },
  monochrome: {
    id: 'monochrome',
    label: 'Ink Mono',
    swatch: '#3B3E44',
    light: {
      primary: '#2A2D33',
      onPrimary: '#FFFFFF',
      primaryContainer: '#E2E4E9',
      onPrimaryContainer: '#16181C',
      surface: '#F9F9FB',
      surfaceContainer: '#F0F1F4',
      surfaceContainerHigh: '#E5E7EC',
      outline: '#D4D7DF',
    },
    dark: {
      primary: '#E2E2E6',
      onPrimary: '#1A1C1E',
      primaryContainer: '#3B3F46',
      onPrimaryContainer: '#F1F2F4',
      surface: '#111214',
      surfaceContainer: '#1B1D20',
      surfaceContainerHigh: '#26292D',
      outline: '#32363C',
    },
  },
};

export function applyPixelThemeVars(
  accentTheme: PixelAccentTheme,
  isDark: boolean,
  oledDark: boolean
): void {
  if (typeof document === 'undefined') return;
  const palette = PIXEL_PALETTES[accentTheme] ?? PIXEL_PALETTES.pixel_blue;
  const tokens = isDark ? palette.dark : palette.light;
  const root = document.documentElement.style;

  root.setProperty('--m3-primary', tokens.primary);
  root.setProperty('--m3-on-primary', tokens.onPrimary);
  root.setProperty('--m3-primary-container', tokens.primaryContainer);
  root.setProperty('--m3-on-primary-container', tokens.onPrimaryContainer);
  root.setProperty('--m3-surface', isDark && oledDark ? '#000000' : tokens.surface);
  root.setProperty(
    '--m3-surface-container',
    isDark && oledDark ? '#111317' : tokens.surfaceContainer
  );
  root.setProperty(
    '--m3-surface-container-high',
    isDark && oledDark ? '#1B1E24' : tokens.surfaceContainerHigh
  );
  root.setProperty('--m3-outline', tokens.outline);
}
