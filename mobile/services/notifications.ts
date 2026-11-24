import { AppState, Platform } from 'react-native';

type NotificationsModule = typeof import('expo-notifications');

let cachedModule: NotificationsModule | null | undefined;
let permissionRequested = false;

async function getNotificationsModule(): Promise<NotificationsModule | null> {
  if (Platform.OS === 'web') return null;
  if (cachedModule !== undefined) return cachedModule;
  try {
    const mod = await import('expo-notifications');
    cachedModule = mod;
    return mod;
  } catch {
    cachedModule = null;
    return null;
  }
}

export async function ensureNotificationPermission(): Promise<boolean> {
  const mod = await getNotificationsModule();
  if (!mod) return false;
  try {
    const current = await mod.getPermissionsAsync();
    if (current.granted) return true;
    if (permissionRequested) return false;
    permissionRequested = true;
    const req = await mod.requestPermissionsAsync();
    return req.granted;
  } catch {
    return false;
  }
}

export async function scheduleApprovalNeededNotification(
  serverName: string,
  toolName: string
): Promise<void> {
  if (AppState.currentState === 'active') return;
  const mod = await getNotificationsModule();
  if (!mod) return;
  const granted = await ensureNotificationPermission();
  if (!granted) return;

  try {
    await mod.scheduleNotificationAsync({
      content: {
        title: 'Write Approval Required',
        body: `${serverName} wants to run "${toolName}". Open MCP Hub to approve or deny.`,
        data: { kind: 'approval_needed', serverName, toolName },
      },
      trigger: null,
    });
  } catch {
    // Ignore notification scheduling errors in Expo Go / simulator
  }
}

export async function scheduleRunCompleteNotification(previewText: string): Promise<void> {
  if (AppState.currentState === 'active') return;
  const mod = await getNotificationsModule();
  if (!mod) return;
  const granted = await ensureNotificationPermission();
  if (!granted) return;

  const snippet = previewText.replace(/\s+/g, ' ').trim().slice(0, 90) || 'Your agent response is ready.';
  try {
    await mod.scheduleNotificationAsync({
      content: {
        title: 'MCP Hub Response Ready',
        body: snippet,
        data: { kind: 'run_complete' },
      },
      trigger: null,
    });
  } catch {
    // Ignore notification scheduling errors in Expo Go / simulator
  }
}
