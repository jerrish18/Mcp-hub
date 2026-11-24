import { signInWithGooglePopup, signOutFirebaseUser, subscribeToFirebaseAuth } from '../firebase/client';

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  photoURL?: string;
  provider: 'google' | 'app';
}

// Keep app session Bearer & refresh tokens strictly in memory (never localStorage/sessionStorage)
let appSessionToken = '';
let appRefreshToken = '';

export function getAppSessionToken(): string {
  return appSessionToken;
}

export async function refreshAppSession(): Promise<boolean> {
  if (!appRefreshToken) return false;
  try {
    const res = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-MCPHub-UI': '1',
      },
      body: JSON.stringify({ refreshToken: appRefreshToken }),
    });
    if (!res.ok) return false;
    const body = (await res.json().catch(() => ({}))) as {
      token?: string;
      refreshToken?: string;
    };
    if (!body.token) return false;
    appSessionToken = body.token;
    if (body.refreshToken) appRefreshToken = body.refreshToken;
    return true;
  } catch {
    return false;
  }
}

export async function registerAppAccount(params: {
  displayName: string;
  email: string;
  password: string;
}): Promise<AuthUser> {
  const res = await fetch('/api/auth/register', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-MCPHub-UI': '1',
    },
    body: JSON.stringify(params),
  });
  const body = (await res.json().catch(() => ({}))) as {
    token?: string;
    refreshToken?: string;
    user?: { id: string; email: string; displayName: string };
    error?: string;
  };
  if (!res.ok || !body.token || !body.user) {
    throw new Error(body.error ?? `Registration failed (${res.status})`);
  }
  appSessionToken = body.token;
  appRefreshToken = body.refreshToken ?? '';
  return {
    id: body.user.id,
    email: body.user.email,
    displayName: body.user.displayName,
    provider: 'app',
  };
}

export async function loginAppAccount(params: {
  email: string;
  password: string;
}): Promise<AuthUser> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-MCPHub-UI': '1',
    },
    body: JSON.stringify(params),
  });
  const body = (await res.json().catch(() => ({}))) as {
    token?: string;
    refreshToken?: string;
    user?: { id: string; email: string; displayName: string };
    error?: string;
  };
  if (!res.ok || !body.token || !body.user) {
    throw new Error(body.error ?? `Sign in failed (${res.status})`);
  }
  appSessionToken = body.token;
  appRefreshToken = body.refreshToken ?? '';
  return {
    id: body.user.id,
    email: body.user.email,
    displayName: body.user.displayName,
    provider: 'app',
  };
}

export async function loginWithGoogleAccount(): Promise<AuthUser> {
  const user = await signInWithGooglePopup();
  return {
    id: user.uid,
    email: user.email ?? '',
    displayName: user.displayName || user.email || 'Google User',
    photoURL: user.photoURL ?? undefined,
    provider: 'google',
  };
}

export async function logoutCurrentAccount(): Promise<void> {
  if (appSessionToken || appRefreshToken) {
    const token = appSessionToken;
    const refreshToken = appRefreshToken;
    appSessionToken = '';
    appRefreshToken = '';
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-MCPHub-UI': '1',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ refreshToken }),
    }).catch(() => {});
  }
  await signOutFirebaseUser().catch(() => {});
}

export function subscribeGoogleAuth(onUser: (user: AuthUser | null) => void): () => void {
  return subscribeToFirebaseAuth((fbUser) => {
    if (!fbUser) {
      onUser(null);
      return;
    }
    onUser({
      id: fbUser.uid,
      email: fbUser.email ?? '',
      displayName: fbUser.displayName || fbUser.email || 'Google User',
      photoURL: fbUser.photoURL ?? undefined,
      provider: 'google',
    });
  });
}
