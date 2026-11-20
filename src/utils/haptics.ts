export function triggerHaptic(enabled: boolean, pattern: 'light' | 'medium' | 'success' | 'warning' = 'light'): void {
  if (!enabled) return;
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  try {
    switch (pattern) {
      case 'light':
        navigator.vibrate(10);
        break;
      case 'medium':
        navigator.vibrate(20);
        break;
      case 'success':
        navigator.vibrate([12, 30, 18]);
        break;
      case 'warning':
        navigator.vibrate([25, 40, 25]);
        break;
    }
  } catch {
    // ignore unsupported browsers
  }
}
